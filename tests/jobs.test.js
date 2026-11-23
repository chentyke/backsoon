import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { sandbox, until, port, exec } from './helpers.js';
import { entry, identity } from '../src/store.js';

test('matched output, named alerts, progress and completion go to the selected chat', async (t) => {
  const h = sandbox(t);
  const id = await h.cli(
    'start',
    '--thread',
    'destination',
    '--match',
    'ERROR',
    '--alert-on',
    '容量',
    'FULL',
    '--',
    'sh',
    '-c',
    "printf '15%%\\rERROR FULL\\nFULL\\n'; while [ ! -e release ]; do sleep .05; done; echo 100%",
  );
  await until(() => h.calls().length >= 2);
  const first = JSON.parse(await h.cli('show', id));
  assert.equal(first.percent, 15);
  assert.equal(first.thread, 'origin');
  assert.equal(first.last_alert, '容量\nERROR FULL');
  h.write('release', '');
  const done = await h.ended(id);
  await until(() => h.calls().length === 3);
  for (const call of h.calls()) {
    assert.deepEqual(call.slice(0, 4), ['queue', '--resume', '--thread', 'destination']);
    assert.deepEqual(call.slice(-2), ['--remote', 'unix:///unused']);
  }
  assert.equal(done.status, 'succeeded');
  assert.equal(done.percent, 100);
  assert.equal(await h.cli('logs', id), '15%\nERROR FULL\nFULL\n100%');
});
test('notification modes and delivery errors remain separate from the command result', async (t) => {
  const h = sandbox(t);
  for (const [mode, rc, reply, expected] of [
    ['queue', '0', '', 'queued'],
    ['resume', '0', 'Warning: message was queued, but could not resume thread', 'wake_warning'],
    ['resume', '1', 'unavailable', 'failed'],
    ['off', '0', '', null],
  ]) {
    Object.assign(h.env, { QUEUE_CODE: rc, QUEUE_REPLY: reply });
    const before = h.calls().length;
    const id = await h.cli('start', '--notify', mode, '--', 'sh', '-c', 'echo failure >&2; exit 7');
    assert.equal((await h.ended(id)).code, 7);
    if (expected) {
      const notice = await until(async () => JSON.parse(await h.cli('show', id)).notice);
      assert.equal(notice.state, expected);
      assert.equal(h.calls().at(-1).includes('--resume'), mode === 'resume');
    } else assert.equal(h.calls().length, before);
  }
});
test('command startup failure, resolve and argument validation', async (t) => {
  const h = sandbox(t);
  const id = await h.cli('start', '--notify', 'off', '--', './missing-command');
  assert.equal((await h.ended(id)).status, 'failed');
  assert.match(await h.cli('logs', id), /missing-command/);
  await h.cli('resolve', id, '--reason', '已经检查');
  await h.cli('resolve', id, '--reason', '已经检查');
  assert.match(await h.cli('list'), /resolved/);
  await assert.rejects(h.cli('resolve', id, '--reason', ' '));
  for (const args of [
    ['start', '--progress-interval', '0', '--', 'true'],
    ['start', '--notify', 'invalid', '--', 'true'],
    ['wait-chat', 'bad'],
    ['attach', '0'],
    ['show', '../other'],
    ['panel', '--all', '--chat', 'other'],
  ])
    await assert.rejects(h.cli(...args));
});
test('stop terminates the command group and its progress script', async (t) => {
  const h = sandbox(t);
  h.write(
    'slow.mjs',
    "import fs from 'node:fs';fs.writeFileSync('script-pid',String(process.pid));setInterval(()=>{},1000);",
  );
  const id = await h.cli(
    'start',
    '--no-notify',
    '--progress-script',
    'slow.mjs',
    '--',
    'sh',
    '-c',
    'sleep 60 & echo $!; wait',
  );
  await until(() => fs.existsSync(path.join(h.dir, 'script-pid')));
  const pid = Number(await h.cli('logs', id)),
    script = Number(fs.readFileSync(path.join(h.dir, 'script-pid')));
  await h.cli('stop', id);
  assert.equal((await h.ended(id)).status, 'stopped');
  await until(() => !identity(pid) && !identity(script));
  assert.deepEqual(h.calls(), []);
});
test('stopping an observer preserves the original process and a second observer sees its exit', async (t) => {
  const h = sandbox(t),
    original = spawn('sleep', ['30']);
  t.after(() => original.kill());
  const attach = () => h.cli('attach', String(original.pid), '--notify', 'off');
  const first = await attach();
  await h.cli('stop', first);
  assert.equal((await h.ended(first)).status, 'stopped');
  assert.ok(identity(original.pid));
  const second = await attach(),
    exit = once(original, 'exit');
  original.kill();
  await exit;
  const state = await h.ended(second);
  assert.equal(state.status, 'exited');
  assert.equal(state.code, null);
});
test('a script can recover from invalid readings and alerts rearm after clearing', async (t) => {
  const h = sandbox(t);
  h.write(
    'progress.mjs',
    "import fs from 'node:fs';if (!fs.existsSync(process.env.BACKSOON_TASK_LOG)) process.exit(1);console.log(fs.readFileSync('report','utf8'));",
  );
  function report(data) {
    h.write('report.new', JSON.stringify(data));
    fs.renameSync(path.join(h.dir, 'report.new'), path.join(h.dir, 'report'));
  }
  report({ percent: 35, blocker: '等待', alerts: { 失败率: '25%' } });
  const id = await h.cli(
    'start',
    '--progress-script',
    'progress.mjs',
    '--progress-interval',
    '.25',
    '--',
    'sh',
    '-c',
    'echo 99%; while [ ! -e release ]; do sleep .05; done; exit 2',
  );
  await until(() => h.calls().length === 1);
  report({ percent: 115 });
  await until(() => h.state(id).progress_error);
  assert.equal(h.state(id).percent, 35);
  report({ percent: 50, alerts: { 失败率: '30%' } });
  await until(() => h.state(id).percent === 50);
  assert.equal(h.calls().length, 1);
  report({ alerts: {} });
  await until(() => Object.keys(h.state(id).alerts).length === 0);
  report({ percent: 85, alerts: { 失败率: '26%' } });
  await until(() => h.calls().length === 2);
  report({ stage: '最后读数' });
  h.write('release', '');
  const state = await h.ended(id);
  assert.equal(state.status, 'failed');
  assert.equal(state.stage, '最后读数');
  assert.equal(state.blocker, '');
  await until(() => h.calls().length === 3);
});
test('Bazel progress ignores nested compiler percentages; duration warning fires once', async (t) => {
  const h = sandbox(t);
  const id = await h.cli(
    'start',
    '--warn-after',
    '.1',
    '--notify',
    'queue',
    '--',
    'sh',
    '-c',
    "printf 'Analyzing: target //App\\n[1,200 / 2,000] Compiling\\n[100%%] Built subtool\\n'; while [ ! -e release ]; do sleep .05; done; echo 'INFO: Build completed successfully, 2000 total actions'",
  );
  await until(() => h.state(id).percent === 60 && h.calls().length === 1);
  h.write('release', '');
  const state = await h.ended(id);
  assert.equal(state.percent, 100);
  assert.equal(state.stage, 'Bazel build actions completed: 2,000');
  assert.match(h.calls()[0].join(' '), /still running/);
});
test('concurrent panel launches, chat ownership, assets and Host restriction', async (t) => {
  const h = sandbox(t);
  h.env.BACKSOON_PORT = String(await port());
  const urls = await Promise.all([1, 2, 3].map(() => h.cli('panel', '--all')));
  assert.equal(new Set(urls).size, 1);
  const url = urls[0],
    id = await h.cli('start', '--notify', 'off', '--', 'echo', '你好');
  await h.ended(id);
  assert.equal(await h.cli('panel', '--task', id), url + 'tasks/' + id);
  assert.deepEqual(await (await fetch(url + 'api/logs/' + id)).json(), ['你好']);
  assert.equal((await (await fetch(url + 'api/chats/origin')).json())[0].id, id);
  assert.deepEqual(await (await fetch(url + 'api/chats/other')).json(), []);
  for (const route of ['tasks/' + id, 'chats/origin', 'app.js', 'style.css'])
    assert.equal((await fetch(url + route)).status, 200);
  const result = await exec(process.execPath, [
    '-e',
    "require('http').get(process.argv[1],{headers:{Host:'example.org'}},r=>console.log(r.statusCode))",
    url,
  ]);
  assert.equal(result.stdout.trim(), '403');
});
test('desktop prints panel URL on stderr; panel failure leaves a started job intact', async (t) => {
  const h = sandbox(t);
  Object.assign(h.env, { BACKSOON_PORT: String(await port()), CODEX_APP_TOOLS_PIPE_PATH: 'desktop' });
  const start = (...args) => exec(entry, ['start', ...args, '--', 'true'], { cwd: h.dir, env: h.env });
  const local = await start('--no-panel', '--notify', 'off');
  await h.ended(local.stdout.trim());
  assert.ok(!fs.existsSync(h.panelFile));
  const result = await start('--notify', 'resume');
  assert.match(result.stdout.trim(), /^[a-f0-9]{12}$/);
  assert.match(result.stderr, /chats\/origin/);
  assert.match(result.stderr, /final reply/);
  await until(() => h.calls().length === 1);
  const blocked = path.join(h.dir, 'blocked');
  h.write('blocked', '');
  h.env.XDG_STATE_HOME = blocked;
  const failed = await start('--notify', 'off');
  assert.match(failed.stderr, /Task started/);
  assert.equal((await h.ended(failed.stdout.trim())).status, 'succeeded');
});

test('bounded logs retain the tail and decode UTF-8 split across writes', async (t) => {
  const h = sandbox(t);
  const script = [
    "const fs = require('node:fs');",
    "for (let i = 0; i < 2400; i++) fs.writeSync(1, 'x'.repeat(1024) + '\\n');",
    "const final = Buffer.from('最后一行');",
    'fs.writeSync(1, final.subarray(0,1));',
    'setTimeout(() => fs.writeSync(1, final.subarray(1)), 20);',
  ].join('\n');
  const id = await h.cli('start', '--notify', 'off', '--', process.execPath, '-e', script);
  assert.equal((await h.ended(id)).latest, '最后一行');
  assert.equal((await h.cli('logs', id)).split('\n').at(-1), '最后一行');
  for (const name of ['output.log', 'output.prev']) {
    const size = fs.statSync(path.join(h.env.BACKSOON_HOME, id, name)).size;
    assert.ok(size > 0 && size <= 1024 * 1024 + 1025);
  }
});

test('records from interrupted workers keep their logs', async (t) => {
  const h = sandbox(t);
  const id = await h.cli('start', '--notify', 'off', '--', 'echo', 'recorded');
  await h.ended(id);
  const file = path.join(h.env.BACKSOON_HOME, id, 'task.json');
  const interrupted = { ...h.state(id), status: 'running', worker_start: 'different process' };
  fs.writeFileSync(file, JSON.stringify(interrupted));
  assert.equal(JSON.parse(await h.cli('show', id)).status, 'interrupted');
  assert.equal(await h.cli('logs', id), 'recorded');
});

test('attached download accepts byte counts and tracks checksum separately across readings', async t => {
  const h = sandbox(t);
  const original = spawn('sleep', ['60']);
  t.after(() => original.kill());
  h.write('progress.mjs', `
    import fs from 'node:fs';
    const total = 8852006912;
    const {size, verified} = JSON.parse(fs.readFileSync('reading', 'utf8'));
    const downloaded = size === total;
    console.log(JSON.stringify({stage: verified ? 'Verified' : downloaded ? 'Verifying' : 'Downloading',
      steps: [{name:'ISO',state:downloaded?'completed':'running',done:size,total},
              {name:'Checksum',state:verified?'completed':downloaded?'running':'pending'}]}));
  `);
  const update = (size, verified) => {
    h.write('next', JSON.stringify({ size, verified }));
    fs.renameSync(path.join(h.dir,'next'),path.join(h.dir,'reading'));
  };
  update(6000000000, false);
  const id = await h.cli('attach', String(original.pid), '--notify', 'off', '--progress-script', 'progress.mjs', '--progress-interval', '.25');
  const reading = stage => until(() => { const task = h.state(id); return task.stage === stage && task; });
  const download = await reading('Downloading');
  assert.equal(download.progress_error, null);
  assert.equal(download.activities[0].done, 6000000000);
  assert.deepEqual(download.activities.map(s => s.state), ['running', 'inQueue']);
  update(8852006912, false);
  assert.deepEqual((await reading('Verifying')).activities.map(s => s.state), ['succeeded', 'running']);
  update(8852006912, true);
  assert.deepEqual((await reading('Verified')).activities.map(s => s.state), ['succeeded', 'succeeded']);
  original.kill();
  assert.equal((await h.ended(id)).status, 'exited');
});

test('attach identifies arbitrary commands and parses new stdout and stderr in the same file once', async t => {
  const h = sandbox(t);
  const dir = path.join(h.dir, 'original cwd');
  fs.mkdirSync(dir);
  const log = path.join(dir, 'job.log');
  fs.writeFileSync(log, 'previous run 90%\n');
  const fd = fs.openSync(log, 'a');
  const program = "process.stdin.once('data', () => { console.log('progress 45%'); console.error('detail'); process.stdin.resume(); });";
  const original = spawn(process.execPath, ['-e', program, 'two words', ''], {
    cwd:dir, stdio:['pipe',fd,fd], env:{ ...process.env, ATTACH_TEST_ONLY:'env-must-not-appear' }
  });
  fs.closeSync(fd);
  t.after(() => original.kill());
  await once(original, 'spawn');
  const id = await h.cli('attach', String(original.pid), '--notify','off');
  const task = h.state(id);
  assert.deepEqual(task.argv.slice(1), ['-e',program,'two words','']);
  assert.equal(fs.realpathSync(task.attached_cwd), fs.realpathSync(dir));
  assert.equal(fs.realpathSync(task.cwd), fs.realpathSync(dir));
  assert.equal(task.output_files.length, 1);
  original.stdin.write('go\n');
  await until(() => h.state(id).percent === 45);
  original.stdin.end();
  assert.equal((await h.ended(id)).status, 'exited');
  assert.equal(await h.cli('logs', id), 'progress 45%\ndetail');
});

test('attach leaves piped output for the original reader', async t => {
  const h = sandbox(t);
  const original = spawn(process.execPath,['-e',"process.stdin.once('data', () => console.log('only the original reader'));"]);
  t.after(() => original.kill());
  await once(original, 'spawn');
  const id = await h.cli('attach', String(original.pid), '--notify','off');
  let actual = '';
  original.stdout.on('data', chunk => { actual += chunk; });
  original.stdin.end('go');
  const task = await h.ended(id);
  assert.equal(actual.trim(), 'only the original reader');
  assert.deepEqual(task.output_files, []);
  assert.equal(task.code, null);
  assert.equal(await h.cli('logs',id), '');
});
