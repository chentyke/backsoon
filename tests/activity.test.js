import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ciQuery, checkItems, OutputActivity } from '../src/activity.js';
import { parseReport } from '../src/progress.js';
import { sandbox, until } from './helpers.js';

test('CI readings follow the watched PR or run, repo and interval', () => {
  const pr = ciQuery(['gh','pr','checks','42','--watch','--interval','30','-R','org/repo','--required']);
  assert.equal(pr.interval, 30);
  assert.deepEqual(pr.args.slice(0, 7), ['pr','checks','-R','org/repo','--required','42','--json']);
  assert.ok(ciQuery(['gh','run','watch','100','--compact','--exit-status']));
  assert.equal(ciQuery(['gh','run','watch']), null);
  assert.equal(ciQuery(['echo','gh','pr','checks']), null);
  const checks = checkItems({ jobs: [
    { name: 'UI (1/2)', status: 'completed', conclusion: 'failure' },
    { name: 'UI (2/2)', status: 'queued' },
    { name: 'Unit', status: 'in_progress' },
  ] }, false);
  assert.deepEqual(checks.map(x => [x.group, x.state]), [['UI','failed'],['UI','inQueue'],['Unit','running']]);
});

test('a real CLI launch reads changing check states even when a watch prints nothing', async t => {
  const h = sandbox(t);
  h.write('gh', '#!/bin/sh\ncase " $* " in *" --json "*) cat snapshot;; *) while [ ! -e release ]; do sleep .05; done;; esac');
  fs.chmodSync(path.join(h.dir,'gh'), 0o700);
  h.write('snapshot', JSON.stringify([{name:'UI (1/3)', state:'QUEUED', workflow:'CI'}]));
  const id = await h.cli('start','--notify','off','--','gh','pr','checks','1','--watch');
  await until(() => h.state(id).activities?.[0]?.state === 'inQueue');
  h.write('snapshot', JSON.stringify([{name:'UI (1/3)', state:'SUCCESS', workflow:'CI'}]));
  h.write('release','');
  const done = await h.ended(id);
  assert.equal(done.activities[0].state, 'succeeded');
  assert.ok(done.progress_at <= done.checked_at);
});

test('test results survive independent download progress and repeated observations', () => {
  const task = {}, output = new OutputActivity(task);
  output.read('Running 7 tests using 2 workers', 1);
  output.read('  ✓  1 settings.spec.ts (18ms)', 2);
  output.read('7 passed (7s)', 3);
  output.read('Downloading WebKit 26 from https://example.org/build', 4);
  output.read('|■■            | 50% of 81.8 MiB', 5);
  output.read('|■■            | 50% of 81.8 MiB', 6);
  assert.equal(task.progress_at, 5);
  assert.deepEqual(task.activities.map(s => [s.kind, s.done, s.total, s.state]),
    [['tests',7,7,'succeeded'], ['download',50,100,'running']]);
});

test('scripts can report independent training or batch steps without an overall percentage', () => {
  const steps = [{name:'Model A',state:'succeeded',done:5,total:5}, {name:'Model B',state:'running',done:4,total:5}];
  const { activities, percent } = parseReport(JSON.stringify({steps}));
  assert.equal(percent,null);
  assert.deepEqual(activities.map(s => s.done),[5,4]);
  assert.throws(() => parseReport(JSON.stringify({steps: [steps[0],steps[0]]})));
  assert.throws(() => parseReport(JSON.stringify({steps: [{...steps[0],done:6}]})));
});

test('attaching to an existing gh watcher queries checks in its original directory', async t => {
  const h = sandbox(t);
  const repo = path.join(h.dir, 'original repo');
  fs.mkdirSync(repo);
  // The watched process exposes the same OS argv as gh, without requiring an account.
  fs.writeFileSync(path.join(repo, 'pr'), 'process.stdin.resume();');
  const snapshot = path.join(repo, 'checks.json');
  const update = state => fs.writeFileSync(snapshot, JSON.stringify([{name:'Build', workflow:'CI', state}]));
  update('IN_PROGRESS');
  h.write('gh', '#!/bin/sh\ncase "$*" in "pr checks 103 --json "*) cat checks.json;; *) exit 1;; esac');
  fs.chmodSync(path.join(h.dir, 'gh'), 0o700);
  const watcher = spawn(process.execPath, ['pr','checks','103','--watch'], { cwd:repo, argv0:'gh' });
  t.after(() => watcher.kill());
  await once(watcher,'spawn');
  const id = await h.cli('attach', String(watcher.pid), '--notify', 'off');
  await until(() => h.state(id).activities?.[0]?.state === 'running');
  assert.equal(JSON.parse(await h.cli('show', id)).percent, 0);
  update('SUCCESS');
  watcher.stdin.end();
  const result = await h.ended(id);
  assert.equal(result.activities[0].state, 'succeeded');
  assert.equal(result.code, null);
  assert.equal(result.status, 'exited');
  assert.equal(JSON.parse(await h.cli('show', id)).percent, 100);
});
