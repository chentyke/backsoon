import { locale, msg } from './locale.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Output } from './output.js';
import { commandResult, failureExcerpt } from './task.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { read, save, now, identity, entry, tail } from './store.js';
import { Estimate, pastRange, sample, signalGroup } from './progress.js';
import { ciQuery, sampleCI, setActivity } from './activity.js';
import { Notifications } from './notify.js';

export async function run(dir, ready) {
  const file = path.join(dir, 'task.json'),
    stopFile = path.join(dir, 'stop');
  const task = read(file);
  Object.assign(task, { worker_pid: process.pid, worker_start: identity(process.pid) });
  save(file, task);
  let requested = false;
  const requestStop = () => {
    requested = true;
  };
  process.on('SIGTERM', requestStop);
  process.on('SIGINT', requestStop);
  const stopping = () => requested || fs.existsSync(stopFile);
  const notices = task.notify_thread ? new Notifications(dir, task) : null;
  const output = new Output(dir, task, notices);
  const ci = !task.progress_script && ciQuery(task.argv);
  if (ci && task.attached_pid) ci.bin = 'gh';
  const ciController = new AbortController();
  let ciRead, nextCI = 0;
  function checkCI() {
    return sampleCI(ci, task.attached_cwd || task.cwd, ciController.signal).then(items => {
      items.sort((a, b) => a.id.localeCompare(b.id));
      if (JSON.stringify(task.activities) !== JSON.stringify(items)) {
        task.activities = items;
        task.progress_at = task.updated = now();
      }
    }).catch(() => {
      // The watched command still owns the outcome if an optional reading fails.
    }).finally(() => { nextCI = now() + ci.interval; ciRead = null; });
  }
  let child,
    sampleController,
    sampling,
    nextSample = 0;
  function startSample() {
    const controller = new AbortController();
    sampleController = controller;
    sampling = sample(task, dir, task.attached_pid || child.pid, controller.signal)
      .then(
        (report) => {
          const fresh = Object.entries(report.alerts).filter(
            ([key]) => !Object.hasOwn(task.alerts || {}, key),
          );
          if (['percent', 'stage', 'blocker', 'phase', 'activities'].some(key =>
            JSON.stringify(task[key]) !== JSON.stringify(report[key]))) task.progress_at = now();
          Object.assign(task, report);
          if (fresh.length && child.exitCode == null && !child.signalCode)
            output.alert(fresh.map(([k, v]) => k + ': ' + v).join('\n'));
        },
        (e) => {
          if (!controller.signal.aborted) task.progress_error = e.message;
        },
      )
      .finally(() => {
        task.updated = now();
        nextSample = now() + task.progress_interval;
        sampling = null;
      });
  }
  ready();
  try {
    if (stopping()) task.status = 'stopped';
    else {
      const argv =
        task.watch || task.attached_pid
          ? [process.execPath, entry, task.watch ? '_watch' : '_observe', dir]
          : task.argv;
      child = spawn(argv[0], argv.slice(1), {
        cwd: task.cwd,
        detached: true,
        stdio: task.watch ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
      });
      if (task.watch) child.on('message', item => setActivity(task, item, now()));
      let closed = false,
        failure;
      child.on('error', (e) => {
        failure = e;
      });
      child.on('close', () => {
        closed = true;
      });
      output.stream(child.stdout);
      output.stream(child.stderr);
      task.status = 'running';
      save(file, task);
      const estimate = new Estimate(pastRange(path.dirname(dir), task));
      let stopAt = null,
        lastWrite = 0,
        savedUpdate;
      while (true) {
        const t = now();
        if (stopAt == null && stopping()) {
          task.status = 'stopping';
          save(file, task);
          sampleController?.abort();
          signalGroup(child.pid, 'SIGTERM');
          stopAt = t;
        }
        if (stopAt != null && t - stopAt >= 1.5) signalGroup(child.pid, 'SIGKILL');
        if (closed && (stopAt == null || t - stopAt >= 1.5 || !signalGroup(child.pid, 0))) break;
        if (stopAt == null && !closed) {
          if (ci && !ciRead && t >= nextCI) ciRead = checkCI();
          if (t - (task.checked_at || 0) >= 5) task.checked_at = task.updated = t;
          if (task.warn_after && !task.warned_at && t - task.started >= task.warn_after) {
            task.warned_at = task.updated = t;
            notices?.send(msg('warnAfter', { seconds: task.warn_after }));
          }
          if (child.pid && task.progress_script && !sampling && t >= nextSample) startSample();
        }
        const finish = estimate.update(task, t);
        if (task.estimated_finish !== finish || task.estimated_finish_range !== estimate.window) {
          task.estimated_finish = finish;
          task.estimated_finish_range = estimate.window;
          task.estimate_from_history = !!estimate.history && estimate.history === estimate.window;
          task.updated = t;
        }
        if (task.updated !== savedUpdate && t - lastWrite >= 0.2) {
          save(file, task);
          lastWrite = t;
          savedUpdate = task.updated;
        }
        await sleep(65);
      }
      sampleController?.abort();
      await sampling;
      if (task.progress_script && !stopping() && child.pid) {
        startSample();
        const check = setInterval(() => {
          if (stopping()) sampleController.abort();
        }, 80);
        try {
          await sampling;
        } finally {
          clearInterval(check);
        }
      }
      if (ci && !stopping() && !failure) {
        await ciRead;
        await checkCI();
      }
      if (failure) throw failure;
      const code = child.signalCode ? -os.constants.signals[child.signalCode] : child.exitCode;
      Object.assign(task, commandResult(code, Boolean(task.attached_pid), stopping()));
      if (task.status === 'succeeded' && output.completed != null)
        Object.assign(task, {
          percent: 100,
          stage: msg('bazelDone', { count: output.completed.toLocaleString(locale) }),
        });
    }
  } catch (e) {
    if (child?.pid && child.exitCode == null && !child.signalCode) signalGroup(child.pid, 'SIGKILL');
    output.line(e.message);
    task.status = 'failed';
  } finally {
    sampleController?.abort();
    await sampling;
    ciController.abort();
    await ciRead;
    output.close();
    process.off('SIGTERM', requestStop);
    process.off('SIGINT', requestStop);
  }
  task.checked_at = task.ended = task.updated = now();
  Object.assign(task, {
    estimated_finish: null,
    estimated_finish_range: null,
    estimate_from_history: false,
  });
  save(file, task);
  const code = task.code == null ? '' : msg('noticeExit', { code: task.code });
  const failed = task.status === 'failed' && failureExcerpt(tail(dir, 40));
  await notices?.send(failed
    ? msg('finishedFailed', { state: msg(task.status), code, output: failed, id: task.id })
    : msg('finished', { state: msg(task.status), code, output: task.latest || msg('none') }), true);
}
