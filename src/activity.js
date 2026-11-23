import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Each observation replaces the previous reading for the same piece of work.
export function setActivity(task, item, time) {
  const items = task.activities ??= [];
  const index = items.findIndex(old => old.id === item.id);
  if (index < 0) {
    if (items.length >= 256) return;
    items.push(item);
  } else {
    if (same(items[index], item)) return;
    items[index] = item;
  }
  task.progress_at = task.updated = time;
}

export class OutputActivity {
  constructor(task) {
    this.task = task;
  }
  read(line, time) {
    const put = (item) => setActivity(this.task, item, time);
    let match = /^Running (\d+) tests? using \d+ workers?\b/.exec(line.trim());
    if (match) {
      this.total = Number(match[1]);
      this.results = new Map();
      this.tallies = {};
      put({ id: 'tests', kind: 'tests', state: 'running', done: 0, total: this.total });
      return true;
    }
    if (this.results) {
      // Playwright's list reporter emits one numbered result per completed attempt.
      match = /^\s*([✓✔✘×✗-])\s+(\d+)\s+(.+?)\s+\([^)]*\)\s*$/u.exec(line);
      if (match && !/\(retry #\d+\)/.test(line)) {
        this.results.set(match[2], match[1]);
        put({ id: 'tests', kind: 'tests', state: 'running', done: Math.min(this.total, this.results.size), total: this.total, detail: match[3].slice(0, 180) });
        return true;
      }
      match = /^\s*(\d+) (passed|failed|skipped)(?:\s+\([^)]*\))?\s*$/.exec(line);
      if (match) {
        this.tallies ??= {};
        this.tallies[match[2]] = Number(match[1]);
        const done = Object.values(this.tallies).reduce((sum, n) => sum + n, 0);
        const state = this.tallies.failed ? 'failed' : done >= this.total ? 'succeeded' : 'running';
        put({ id: 'tests', kind: 'tests', state, done: Math.min(done, this.total), total: this.total, detail: line.trim() });
        return true;
      }
    }
    // The line reporter counts started tests; the final summary confirms outcomes.
    match = /^\s*\[(\d+)\/(\d+)\]\s+(.+)$/.exec(line);
    if (this.results && match && Number(match[2]) === this.total) {
      put({ id: 'tests', kind: 'tests', state: 'running', detail: match[0].trim().slice(0, 220) });
      return true;
    }
    // Node emits these totals in both TAP and its default spec reporter.
    match = /^(?:#|ℹ) (tests|pass|fail|skipped) (\d+)\s*$/u.exec(line);
    if (match) {
      this.nodeTotals ??= {};
      this.nodeTotals[match[1]] = Number(match[2]);
      const { tests, pass = 0, fail = 0, skipped = 0 } = this.nodeTotals;
      if (tests) put({ id: 'tests', kind: 'tests', state: fail ? 'failed' : pass + skipped === tests ? 'succeeded' : 'running',
        done: Math.min(tests, pass + fail + skipped), total: tests });
      return true;
    }
    match = /^Downloading (.+?) from https?:\/\//i.exec(line);
    if (match) {
      this.download = match[1].slice(0, 160);
      put({ id: 'download:' + this.download, kind: 'download', name: this.download, state: 'running' });
      return true;
    }
    if (this.download) {
      match = /^\s*\|[^\n]*?\|\s*(\d{1,3})% of ([\d.,]+\s*[KMG]i?B)\b/i.exec(line);
      if (match && Number(match[1]) <= 100) {
        put({ id: 'download:' + this.download, kind: 'download', name: this.download, state: 'running', done: Number(match[1]), total: 100, detail: match[2] });
        return true;
      }
      if (/ downloaded to /i.test(line)) {
        put({ id: 'download:' + this.download, kind: 'download', name: this.download, state: 'succeeded', done: 100, total: 100 });
        this.download = null;
        return true;
      }
    }
    return false;
  }
}

export function ciQuery(argv) {
  const [bin, command, action, ...args] = argv;
  if (!bin || path.basename(bin) !== 'gh') return null;
  const pr = command === 'pr' && action === 'checks' && args.includes('--watch');
  if (!pr && !(command === 'run' && action === 'watch')) return null;
  const query = pr ? ['pr', 'checks'] : ['run', 'view'];
  let seconds = 10, target;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-R' || arg === '--repo') query.push(arg, args[++i]);
    else if (arg.startsWith('--repo=')) query.push(arg);
    else if (arg === '--interval' || arg === '-i') seconds = Number(args[++i]);
    else if (arg.startsWith('--interval=')) seconds = Number(arg.slice(11));
    else if (pr && arg === '--required') query.push(arg);
    else if (['--watch', '--compact', '--exit-status', '--fail-fast'].includes(arg)) continue;
    else if (!arg.startsWith('-') && !target) target = arg;
    else return null;
  }
  if ((!pr && !target) || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (target) query.push(target);
  query.push('--json', pr ? 'name,workflow,state,bucket,link' : 'jobs');
  return { bin, args: query, interval: Math.max(5, seconds), pr };
}

export function checkItems(records, pr) {
  return (pr ? records : records.jobs).slice(0, 256).map(check => {
    const raw = String(check.conclusion || check.status || check.state).toUpperCase();
    const state = ({ QUEUED: 'inQueue', WAITING: 'inQueue', REQUESTED: 'inQueue', IN_PROGRESS: 'running',
      SUCCESS: 'succeeded', NEUTRAL: 'skipped', SKIPPED: 'skipped', CANCELLED: 'stopped',
      FAILURE: 'failed', TIMED_OUT: 'failed', ACTION_REQUIRED: 'needsInput' })[raw] ||
      ({ pass: 'succeeded', fail: 'failed', skipping: 'skipped', cancel: 'stopped' })[check.bucket] || 'pendingCheck';
    const name = String(check.name);
    const normalized = name.replace(/(\([^()]*?),\s*(?:shard\s+)?\d+\s*(?:\/|of)\s*\d+\s*\)$/i, '$1)');
    const base = normalized.replace(/\s*[(\[]\s*(?:shard\s+)?\d+\s*(?:\/|of)\s*\d+\s*[)\]]\s*$/i, '').replace(/\s+[-–]\s+shard\s+\d+\s*(?:\/|of)\s*\d+$/i, '').trim() || name;
    const group = [check.workflow, base].filter(Boolean).join(' / ');
    const id = JSON.stringify([group, name, check.databaseId || check.link]);
    return { id, kind: 'checks', group, name, state };
  });
}

// Preserve the original watch command's output and exit code. Read detailed states
// from the same repository because the text table merges queued and running checks.
export async function sampleCI(source, cwd, signal) {
  const { stdout } = await exec(source.bin, source.args, { cwd, signal, timeout: 8000, maxBuffer: 4 * 1024 * 1024 });
  return checkItems(JSON.parse(stdout), source.pr);
}
