import { msg } from './locale.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { now, read, records } from './store.js';

export function pastRange(root, task) {
  if (task.watch || task.attached_pid) return null;
  const times = [];
  for (const dir of records(root)) {
    try {
      const past = read(path.join(dir, 'task.json'));
      if (
        past.status !== 'succeeded' ||
        past.watch ||
        past.attached_pid ||
        past.ended > task.started ||
        past.cwd !== task.cwd ||
        past.progress_script !== task.progress_script ||
        JSON.stringify(past.argv) !== JSON.stringify(task.argv)
      )
        continue;
      const duration = past.ended - past.started;
      if (Number.isFinite(duration) && duration > 0) times.push([past.ended, duration]);
    } catch {
      /* A removed or incomplete record cannot contribute an estimate. */
    }
  }
  const recent = times
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .map((pair) => pair[1]);
  const low = Math.min(...recent),
    high = Math.max(...recent);
  return recent.length === 3 && high <= 2 * low ? [task.started + low, task.started + high] : null;
}

export class Estimate {
  constructor(history = null) {
    this.history = history;
    this.reset();
  }
  reset() {
    this.points = [];
    this.window = null;
  }
  forecast() {
    const p = this.points;
    if (p.length < 5) return null;
    const [start, first] = p[0],
      [end, last] = p.at(-1);
    const span = end - start;
    if (span < 60) return null;
    const center = (start + end) / 2;
    const [middle, percent] = p
      .slice(2, -2)
      .reduce((a, b) => (Math.abs(a[0] - center) <= Math.abs(b[0] - center) ? a : b));
    if (Math.min(middle - start, end - middle) < span / 3) return null;
    const remaining = 100 - last;
    const rates = [
      (remaining * (middle - start)) / (percent - first),
      (remaining * (end - middle)) / (last - percent),
    ].sort((a, b) => a - b);
    if (!Number.isFinite(rates[1]) || rates[0] < span / (p.length - 1) || rates[1] > rates[0] * 2)
      return null;
    return rates.map((v) => end + v);
  }
  update(task, time) {
    const source = JSON.stringify([
      task.progress_source,
      task.action_total,
      task.progress_script,
      task.phase,
      task.uniform_work,
    ]);
    if (this.source !== source) this.reset();
    this.source = source;
    const pct = task.percent;
    if (task.status !== 'running' || task.blocker || task.watch || task.progress_error || pct === 100) {
      this.reset();
      return null;
    }
    if (task.eta_range_seconds && task.sampled_at != null) {
      this.reset();
      const [a, b] = task.eta_range_seconds.map((n) => n + task.sampled_at);
      if (time >= b) return null;
      this.window = [a, b];
      return (a + b) / 2;
    }
    if (task.eta_seconds != null && task.sampled_at != null) {
      this.reset();
      const end = task.eta_seconds + task.sampled_at;
      return end > time ? end : null;
    }
    if (!task.uniform_work) {
      this.reset();
      if (!this.history || time >= this.history[1]) return null;
      this.window = this.history;
      return (this.history[0] + this.history[1]) / 2;
    }
    if (pct == null) {
      this.reset();
      return null;
    }
    const observed = task.progress_script ? (task.sampled_at ?? time) : time;
    let last = this.points.at(-1);
    if (last && (pct < last[1] || time - last[0] > 90)) {
      if (pct === last[1]) {
        this.window = null;
        return null;
      }
      this.reset();
      last = null;
    }
    if (!last || (pct > last[1] && observed - last[0] >= 5)) {
      this.points.push([observed, pct]);
      this.points = this.points.filter(([t]) => observed - t <= 180);
      this.window = this.forecast();
    }
    if (this.window && time < this.window[0]) return (this.window[0] + this.window[1]) / 2;
    this.window = null;
    return null;
  }
}

const seconds = (n) => Number.isFinite(n) && n >= 0 && n <= 8.6e12;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const stepStates = ['running', 'succeeded', 'failed', 'needsInput', 'inQueue', 'stopped', 'skipped'];
export function parseReport(raw) {
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    throw Error(msg('reportJson'));
  }
  if (!object(report)) throw Error(msg('reportObject'));
  const {
    percent = null,
    eta_seconds = null,
    eta_range_seconds = null,
    uniform_work = false,
    alerts = {},
  } = report;
  if (percent != null && (!Number.isFinite(percent) || percent < 0 || percent > 100))
    throw Error(msg('badPercent'));
  if (eta_seconds != null && !seconds(eta_seconds)) throw Error(msg('badEta'));
  if (
    eta_range_seconds != null &&
    (!Array.isArray(eta_range_seconds) ||
      eta_range_seconds.length !== 2 ||
      !eta_range_seconds.every(seconds) ||
      eta_range_seconds[0] > eta_range_seconds[1] ||
      eta_seconds != null)
  )
    throw Error(msg('badRange'));
  if (typeof uniform_work !== 'boolean') throw Error(msg('badUniform'));
  if (
    !object(alerts) ||
    Object.entries(alerts).some(([k, v]) => !k.trim() || typeof v !== 'string' || !v.trim())
  )
    throw Error(msg('badAlerts'));
  const steps = report.steps ?? [];
  if (!Array.isArray(steps) || steps.length > 128) throw Error(msg('badSteps'));
  const names = new Set();
  const activities = steps.map(step => {
    if (!object(step)) throw Error(msg('badSteps'));
    const { name, done, total, detail } = step;
    if (typeof name !== 'string' || !name.trim() || name.length > 160 || names.has(name))
      throw Error(msg('badSteps'));
    names.add(name);
    let state = step.state;
    if (state === 'pending') state = 'inQueue';
    if (state === 'completed') state = 'succeeded';
    if (!stepStates.includes(state))
      throw Error(msg('badStepState', { name, state: JSON.stringify(step.state)?.slice(0, 80) ?? 'undefined', allowed: stepStates.join(', ') }));
    if ((done != null || total != null) && !(Number.isFinite(done) && Number.isFinite(total) &&
        total > 0 && done >= 0 && done <= total)) throw Error(msg('badStepCounts', { name }));
    if (detail != null && typeof detail !== 'string') throw Error(msg('reportText', { key: name + '.detail' }));
    return { id: name, name, kind: 'step', state, done, total, detail: detail?.slice(0, 500) };
  });
  const result = { activities, percent, eta_seconds, eta_range_seconds, uniform_work, alerts };
  for (const key of ['stage', 'blocker', 'phase', 'eta_stage']) {
    const value = report[key] === undefined ? '' : report[key];
    if (typeof value !== 'string') throw Error(msg('reportText', { key }));
    result[key] = value.trim().slice(0, 500);
  }
  if (
    percent == null &&
    eta_seconds == null &&
    !eta_range_seconds &&
    !result.stage &&
    !result.blocker &&
    !('steps' in report) && !('alerts' in report)
  )
    throw Error(msg('emptyReport'));
  return result;
}

const js = (file) => /\.(?:mjs|cjs|js)$/.test(file);
export function scriptPath(value, cwd) {
  const file = fs.realpathSync(path.resolve(cwd, value));
  if (!fs.statSync(file).isFile()) throw Error(msg('scriptFile'));
  if (!js(file)) fs.accessSync(file, fs.constants.X_OK);
  return file;
}
export function signalGroup(pid, signal) {
  if (!pid) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch (e) {
    if (e.code === 'ESRCH') return false;
    throw e;
  }
}
export function sample(task, dir, pid, signal) {
  const script = task.progress_script;
  const child = spawn(js(script) ? process.execPath : script, js(script) ? [script] : [], {
    cwd: task.cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      BACKSOON_TASK_ID: task.id,
      BACKSOON_TASK_PID: String(pid),
      BACKSOON_TASK_DIR: dir,
      BACKSOON_TASK_LOG: path.join(dir, 'output.log'),
    },
  });
  return new Promise((resolve, reject) => {
    let error,
      bytes = 0;
    const chunks = [];
    function stop(message) {
      if (error) return;
      error = Error(message);
      try {
        signalGroup(child.pid, 'SIGKILL');
      } catch {
        // The group can disappear or become unsignalable while its pipes still have data.
        child.stdout.destroy();
        child.stderr.destroy();
        try {
          child.kill('SIGKILL');
        } catch {
          // Preserve the sampling error if the OS also refuses the child signal.
        }
        child.unref();
        reject(error);
      }
    }
    const abort = () => stop(msg('scriptStopped'));
    const timer = setTimeout(() => stop(msg('scriptTimeout')), 5000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes <= 8192) chunks.push(chunk);
        else stop(msg('scriptLarge'));
      });
    child.on('error', (e) => {
      error ??= e;
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      try {
        signalGroup(child.pid, 'SIGKILL');
        if (error) throw error;
        const raw = Buffer.concat(chunks).toString();
        if (code !== 0) throw Error(msg('scriptExit', { code, output: raw.trim().slice(-240) }));
        resolve({ ...parseReport(raw), sampled_at: now(), progress_error: null });
      } catch (e) {
        reject(error ?? e);
      }
    });
  });
}
