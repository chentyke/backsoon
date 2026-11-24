import { msg } from '../src/locale.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Estimate, parseReport, pastRange, sample } from '../src/progress.js';
import { sandbox } from './helpers.js';

test('only measured uniform progress produces a speed estimate', () => {
  const e = new Estimate(),
    task = { status: 'running', uniform_work: true };
  for (const time of [0, 12, 30, 48, 60]) e.update({ ...task, percent: time / 2 }, time);
  assert.deepEqual(e.window, [200, 200]);
  assert.equal(e.update({ ...task, percent: 30 }, 120), 200);
  assert.equal(e.update({ ...task, percent: 30 }, 151), null);
  for (const change of [
    { percent: 2 },
    { action_total: 20 },
    { phase: 'pack' },
    { blocker: 'wait' },
    { progress_error: 'failed' },
  ]) {
    const f = new Estimate();
    [10, 15, 20, 24, 28].forEach((percent, i) => f.update({ ...task, percent }, i * 15));
    assert.deepEqual(f.window, [276, 330]);
    assert.equal(f.update({ ...task, percent: 30, ...change }, 75), null);
  }
  for (const values of [
    [10, 25, 40, 42, 44],
    [87, 90, 93, 96, 99],
  ]) {
    const f = new Estimate();
    values.forEach((percent, i) => f.update({ ...task, percent }, i * 15));
    assert.equal(f.window, null);
  }
  const f = new Estimate();
  for (let i = 0; i < 10; i++)
    assert.equal(f.update({ status: 'running', percent: i * 10 }, i * 10), null);
});
test('time alone cannot move a forecast', () => {
  const e = new Estimate(),
    task = { status: 'running', uniform_work: true };
  let finish;
  for (let t = 0; t <= 180; t += 15) {
    task.percent = t < 90 ? t / 5 : 18 + (t - 90) / 6;
    finish = e.update(task, t);
  }
  assert.ok(finish);
  for (const t of [181, 196, 211, 241]) assert.equal(e.update(task, t), finish);
});
test('reported finish times expire and invalid reports are rejected', () => {
  const e = new Estimate(),
    task = { status: 'running', sampled_at: 100 };
  Object.assign(task, parseReport('{"eta_range_seconds":[20,50],"eta_stage":"打包"}'));
  assert.equal(e.update(task, 130), 135);
  assert.deepEqual(e.window, [120, 150]);
  assert.equal(e.update(task, 150), null);
  Object.assign(task, parseReport('{"eta_seconds":65}'));
  assert.equal(e.update(task, 105), 165);
  assert.equal(e.update(task, 166), null);
  assert.equal(e.update({ ...task, blocker: 'wait' }, 105), null);
  Object.assign(task, parseReport('{"stage":"next"}'));
  assert.equal(e.update(task, 110), null);
  assert.equal(task.eta_stage, '');
  for (const value of [
    [],
    {},
    { percent: 101 },
    { percent: true },
    { eta_seconds: -1 },
    { eta_range_seconds: [3, 2] },
    { eta_range_seconds: [false, 2] },
    { eta_range_seconds: [1, 2], eta_seconds: 1 },
    { uniform_work: 'false', percent: 1 },
    { alerts: [] },
    { alerts: { a: '' } },
    { stage: null },
  ])
    assert.throws(() => parseReport(JSON.stringify(value)));
});
test('historical estimate uses only comparable completed runs', (t) => {
  const h = sandbox(t),
    task = { status: 'running', started: 1000, cwd: '/work', argv: ['batch'] };
  const add = (i, started, duration, extra = {}) => {
    const folder = path.join(h.dir, i.toString(16).padStart(12, '0'));
    fs.mkdirSync(folder);
    fs.writeFileSync(
      path.join(folder, 'task.json'),
      JSON.stringify({ ...task, started, ended: started + duration, status: 'succeeded', ...extra }),
    );
  };
  add(1, 0, 10);
  add(2, 200, 100);
  add(3, 400, 110);
  assert.equal(pastRange(h.dir, task), null);
  add(4, 600, 120);
  add(5, 800, 10, { status: 'failed' });
  add(6, 800, 20, { cwd: '/elsewhere' });
  add(7, 800, 30, { argv: ['other'] });
  add(8, 800, 5, { progress_script: 'x.mjs' });
  add(9, 999, 100);
  const window = pastRange(h.dir, task);
  assert.deepEqual(window, [1100, 1120]);
  assert.equal(pastRange(h.dir, { ...task, attached_pid: 10 }), null);
  const e = new Estimate(window);
  assert.equal(e.update(task, 1105), 1110);
  assert.equal(e.update(task, 1121), null);
  assert.equal(e.update({ ...task, eta_seconds: 200, sampled_at: 1050 }, 1060), 1250);
});
test('sampling enforces byte and time limits', async (t) => {
  const h = sandbox(t),
    file = path.join(h.dir, 'sample.mjs');
  const run = () =>
    sample(
      { progress_script: file, cwd: h.dir, id: 'abc' },
      h.dir,
      process.pid,
      new AbortController().signal,
    );
  h.write('sample.mjs', "process.stdout.write('x'.repeat(9000))");
  await assert.rejects(run(), /8 KiB/);
  h.write('sample.mjs', 'setInterval(()=>{},1000)');
  await assert.rejects(run(), { message: msg('scriptTimeout') });
});

test('a refused group signal preserves the output limit error', async t => {
  const h = sandbox(t);
  h.write('sample.mjs', "process.stdout.write('x'.repeat(9000)); setInterval(() => {}, 1000)");
  const kill = process.kill.bind(process);
  t.mock.method(process, 'kill', (pid, signal) => {
    if (pid < 0 && signal === 'SIGKILL') throw Object.assign(Error('kill EPERM'), {code:'EPERM'});
    return kill(pid, signal);
  });
  const task = { id:'limit', cwd:h.dir, progress_script:path.join(h.dir, 'sample.mjs') };
  await assert.rejects(sample(task, h.dir, process.pid, new AbortController().signal), {message:msg('scriptLarge')});
});

for (const file of ['docs/progress.md', 'docs/zh-CN/progress.md']) {
  test(file + ' conversion example reports partial, completed and empty batches', async t => {
    const h = sandbox(t);
    const docs = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    const [, script] = docs.match(/^`{3}js\n([\s\S]*?)^`{3}/m);
    h.write('progress.mjs', script);
    const task = { id: 'batch', cwd: h.dir, progress_script: path.join(h.dir, 'progress.mjs') };
    const read = () => sample(task, h.dir, process.pid, new AbortController().signal);
    fs.mkdirSync(path.join(h.dir, 'results'));
    h.write('manifest.json', '["one", "two"]');
    h.write('results/one', 'converted');
    assert.equal((await read()).percent, 50);
    h.write('results/two', 'converted');
    assert.equal((await read()).percent, 100);
    h.write('manifest.json', '[]');
    const empty = await read();
    assert.equal(empty.percent, null);
    assert.match(empty.stage, /0\/0/);
  });
}

test('custom step states preserve each outcome and identify invalid fields', () => {
  const read = steps => parseReport(JSON.stringify({ steps })).activities;
  const states = ['inQueue', 'running', 'succeeded', 'failed', 'needsInput', 'skipped', 'stopped'];
  assert.deepEqual(read(states.map(state => ({ name: state, state }))).map(a => a.state), states);
  assert.throws(() => read([{name:'Training B',state:'typo'}]), e => e.message.includes('Training B') && e.message.includes('"typo"'));
  assert.throws(() => read([{name:'Copy files',state:'running',done:4,total:2}]), e => e.message.includes('Copy files') && e.message.includes('total'));
});

test('an executable shell script reports queued, running and finished batch steps', async t => {
  const h = sandbox(t);
  const script = path.join(h.dir, 'batch.sh');
  h.write('batch.sh', '#!/bin/sh\ncat batch.json\n');
  fs.chmodSync(script, 0o700);
  for (const [reported, expected] of [['pending','inQueue'], ['running','running'], ['completed','succeeded']]) {
    h.write('batch.json', JSON.stringify({steps:[
      {name:'Batch A',state:'completed',done:4,total:4},
      {name:'Batch B',state:reported}
    ]}));
    const reading = await sample({id:'batch', cwd:h.dir, progress_script:script}, h.dir, process.pid, new AbortController().signal);
    assert.deepEqual(reading.activities.map(item => item.state), ['succeeded', expected]);
    assert.equal(reading.percent, null);
  }
});
