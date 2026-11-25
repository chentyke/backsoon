import { setTimeout as sleep } from 'node:timers/promises';
import { msg } from './locale.js';

// The sample task behind `backsoon demo`: a simulated release check that
// touches nothing and finishes in under a minute. One timeline drives both
// the printed output and the progress readings, so the panel and the log
// always agree.
export const DEMO_SECONDS = 39;
const INSTALL = 6;
const BLOCKED = [8, 16];
const JOBS = [
  { name: 'demoLint', unit: 'files linted', total: 12, start: 6, end: 14 },
  { name: 'demoUnit', unit: 'tests passed', total: 48, start: 6, end: 28 },
  { name: 'demoE2e', unit: 'specs passed', total: 6, start: 8, from: BLOCKED[1], end: 34 },
  { name: 'demoBuild', unit: 'bundles built', total: 4, start: 28, end: 38 },
];
const clamp = value => Math.min(1, Math.max(0, value));
const done = (job, t) => Math.floor(job.total * clamp((t - (job.from ?? job.start)) / (job.end - (job.from ?? job.start))));

export function demoReading(t) {
  const steps = JOBS.map(job => ({
    name: msg(job.name),
    state: t >= job.end ? 'succeeded' : t >= job.start ? 'running' : 'inQueue',
    done: done(job, t),
    total: job.total,
  }));
  const finished = steps.filter(step => step.state === 'succeeded').length;
  const share = JOBS.reduce((sum, job) => sum + done(job, t) / job.total, 0) / JOBS.length;
  const reading = {
    percent: Math.round(10 * (10 * clamp(t / INSTALL) + 90 * share)) / 10,
    phase: t < INSTALL ? 'install' : 'jobs',
    stage: t < INSTALL ? msg('demoInstalling') : msg('demoJobs', { done: finished, total: JOBS.length }),
    eta_seconds: Math.max(0, Math.round(DEMO_SECONDS - t)),
    steps,
    alerts: {},
  };
  if (t >= BLOCKED[0] && t < BLOCKED[1]) reading.blocker = msg('demoBlocker');
  return reading;
}

// Prints what a real pipeline would: one line per change, no percentages,
// so the progress script stays the only source of the numbers.
export async function runDemo(write = line => console.log(line), pace = sleep) {
  const started = Date.now();
  const seen = JOBS.map(() => 0), said = new Set();
  const once = (when, line) => {
    if (when && !said.has(line)) said.add(line) && write(line);
  };
  write('Resolving packages…');
  for (let t = 0; ; t = (Date.now() - started) / 1000) {
    once(t >= INSTALL, 'Added 214 packages in 5.8s');
    once(t >= BLOCKED[0], '[e2e] Waiting for the test browser to start…');
    once(t >= BLOCKED[1], '[e2e] Browser ready');
    JOBS.forEach((job, i) => {
      const count = done(job, t);
      if (count > seen[i]) write(`[${job.name.slice(4).toLowerCase()}] ${count}/${job.total} ${job.unit}`);
      seen[i] = count;
    });
    if (t >= DEMO_SECONDS) break;
    await pace(250);
  }
  write(`Release check passed: ${JOBS.map(job => job.total + ' ' + job.unit).join(', ')} in ${DEMO_SECONDS}s`);
}
