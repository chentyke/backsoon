import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { entry } from '../src/store.js';
import { exec, sandbox, until } from './helpers.js';
import { catalogs } from '../src/web/i18n.js';

test('default notifications interrupt an active turn, resume an idle chat and avoid a second send after a lost acknowledgement', async (t) => {
  const h = sandbox(t),
    socket = path.join(h.dir, 'ws.sock');
  const server = http.createServer(),
    ws = new WebSocketServer({ server });
  server.listen(socket);
  await once(server, 'listening');
  t.after(() => {
    ws.close();
    server.close();
  });
  let behavior, requests;
  ws.on('connection', (client) =>
    client.on('message', (raw) => {
      const q = JSON.parse(raw);
      requests.push(q);
      if (!q.id) return;
      let result = {};
      if (q.method === 'thread/read')
        result = { thread: { status: { type: behavior === 'unloaded' ? 'notLoaded' : behavior.startsWith('idle') ? 'idle' : 'active' } } };
      if (q.method === 'thread/turns/list') result = { data: [{ id: 'turn', status: 'inProgress' }] };
      if (q.method === 'turn/start') {
        assert.equal(q.params.threadId, 'origin');
        assert.match(q.params.input[0].text, /^\[BackSoon [a-f0-9]{12} done\]/);
        if (behavior === 'idle-disconnect') {
          client.terminate();
          return;
        }
        result = { turn: { id: 'new-turn' } };
      }
      if (q.method === 'turn/steer') {
        assert.equal(q.params.expectedTurnId, 'turn');
        if (behavior === 'disconnect') {
          client.terminate();
          return;
        }
        if (behavior === 'rejected') {
          client.send(JSON.stringify({ id: q.id, error: { code: -32602, message: 'turn mismatch' } }));
          return;
        }
        result = { turnId: 'turn' };
      }
      client.send(JSON.stringify({ id: q.id, result }));
    }),
  );
  for (const [mode, expected] of [
    ['active', 'steered'],
    ['idle', 'resumed'],
    ['idle-disconnect', 'unknown'],
    ['unloaded', 'queued'],
    ['rejected', 'queued'],
    ['disconnect', 'unknown'],
  ]) {
    requests = [];
    behavior = mode;
    const count = h.calls().length;
    const id = await h.cli(
      'start',
      '--remote',
      'unix://' + socket,
      '--',
      'echo',
      'finished',
    );
    const n = await until(async () => JSON.parse(await h.cli('show', id)).notice);
    assert.equal(h.state(id).notify, 'steer');
    assert.equal(n.state, expected);
    if (mode === 'idle') assert.equal(n.turnId, 'new-turn');
    if (expected === 'queued') assert.ok(h.calls().at(-1).includes('--resume'));
    assert.equal(h.calls().length - count, expected === 'queued' ? 1 : 0);
    assert.equal(requests.filter((q) => q.method === 'turn/steer').length, mode.startsWith('idle') || mode === 'unloaded' ? 0 : 1);
    assert.equal(requests.filter((q) => q.method === 'turn/start').length, mode.startsWith('idle') ? 1 : 0);
  }
  behavior = 'active';
  for (const mode of ['resume', 'queue', 'off']) {
    requests = [];
    const before = h.calls().length;
    const id = await h.cli('start', '--notify', mode, '--remote', 'unix://' + socket, '--', 'true');
    await h.ended(id);
    if (mode !== 'off') {
      await until(() => h.calls().length > before);
      assert.equal(h.calls().at(-1).includes('--resume'), mode === 'resume');
    }
    assert.equal(h.calls().length, before + Number(mode !== 'off'));
    assert.equal(requests.length, 0);
  }
});

test('concurrent retries deliver one original completion without running the command again', async t => {
  const h = sandbox(t);
  Object.assign(h.env, { QUEUE_CODE: '1', QUEUE_REPLY: 'Error: failed to connect to remote app server: Permission denied' });
  const id = await h.cli('start', '--', 'sh', '-c', 'echo once >> runs; echo final-output; exit 7');
  const getNotice = async () => JSON.parse(await h.cli('show', id)).notice;
  const first = await until(getNotice);
  assert.equal(first.state, 'failed');
  assert.match(first.retryMessage, /done\].*\n.*7.*\n.*final-output/s);

  Object.assign(h.env, { QUEUE_CODE: '0', QUEUE_REPLY: '', BACKSOON_LANG: 'ja' });
  const retries = await Promise.allSettled([h.cli('retry-notice', id), h.cli('retry-notice', id)]);
  assert.deepEqual(retries.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  const [original, retry] = h.calls();
  assert.equal(h.calls().length, 2);
  assert.deepEqual(retry, original);
  assert.equal((await getNotice()).state, 'queued');
  assert.equal(h.state(id).code, 7);
  assert.equal(fs.readFileSync(path.join(h.dir, 'runs'), 'utf8'), 'once\n');
});

test('wake warnings, ambiguous failures and progress alerts cannot be replayed', async t => {
  const h = sandbox(t);
  for (const [code, detail] of [
    ['0', 'Warning: queued but could not resume'],
    ['1', 'connection lost after sending'],
  ]) {
    Object.assign(h.env, { QUEUE_CODE: code, QUEUE_REPLY: detail });
    const id = await h.cli('start', '--', 'echo', 'done');
    await until(async () => JSON.parse(await h.cli('show', id)).notice);
    await assert.rejects(h.cli('retry-notice', id), /no confirmed unsent/);
  }
  Object.assign(h.env, { QUEUE_CODE: '1', QUEUE_REPLY: 'Error: failed to connect to remote app server' });
  const id = await h.cli('start', '--alert-on', 'error', 'ERROR', '--', 'sh', '-c', 'echo ERROR; sleep 5');
  await until(async () => JSON.parse(await h.cli('show', id)).notice);
  await assert.rejects(h.cli('retry-notice', id), /no confirmed unsent/);
});

test('a denied socket warns at launch and the command still runs with its existing permissions', async t => {
  if (process.getuid() === 0) return t.skip('Root bypasses directory access restrictions');
  const h = sandbox(t);
  const restricted = path.join(h.dir, 'restricted');
  fs.mkdirSync(restricted, { mode: 0 });
  try {
    const remote = 'unix://' + path.join(restricted, 'codex.sock');
    const {stdout, stderr} = await exec(entry, ['start', '--no-panel', '--remote', remote, '--', 'echo', 'done'], {cwd:h.dir, env:h.env});
    const id = stdout.trim();
    assert.ok(stderr.includes('backsoon retry-notice ' + id));
    assert.equal((await h.ended(id)).code, 0);
    const local = await exec(entry, ['start', '--notify', 'off', '--remote', remote, '--', 'echo', 'local'], {cwd:h.dir, env:h.env});
    assert.equal(local.stderr, '');
  } finally {
    fs.chmodSync(restricted, 0o700);
  }
});

test('without a resume service, a queued completion counts as resumed only once its turn appears in the chat', async t => {
  const h = sandbox(t);
  delete h.env.BACKSOON_REMOTE;
  // macOS limits socket paths to 103 bytes, shorter than its usual temporary directory plus this socket name.
  const profile = fs.mkdtempSync('/tmp/backsoon-home-');
  t.after(() => fs.rmSync(profile, {recursive:true, force:true}));
  Object.assign(h.env, {
    CODEX_HOME: profile,
    CODEX_APP_TOOLS_PIPE_PATH: 'desktop',
    QUEUE_REPLY: 'Queued message 01a21287-05f5-7923-bb93-ad4dca51bccf for thread origin.\n\nWarning: message was queued, but could not resume thread origin',
  });
  const notice = async (turn) => {
    if (turn) h.env.NOTICE_TURN = turn; else delete h.env.NOTICE_TURN;
    const run = await exec(entry, ['start', '--no-panel', '--', 'sh', '-c', 'echo built'], { cwd:h.dir, env:h.env });
    const id = run.stdout.trim();
    assert.match(run.stderr, /direct resume service is unreachable/);
    assert.doesNotMatch(run.stderr, /Notifications are enabled|lacks permission/);
    const task = await until(async () => {
      const result = JSON.parse(await h.cli('show', id));
      return result.notice && result.notice.state !== 'queued' || result.notice?.resumed === false ? result : null;
    });
    assert.equal(task.status, 'succeeded');
    assert.equal(task.notice.retryMessage, undefined);
    await assert.rejects(h.cli('retry-notice', id), /no confirmed unsent/);
    return task.notice;
  };
  const taken = await notice('desktop-turn');
  assert.equal(taken.state, 'resumed');
  assert.equal(taken.turnId, 'desktop-turn');
  assert.equal(taken.issues, 0);
  const left = await notice(null);
  assert.equal(left.state, 'queued');
  assert.equal(left.resumed, false);
  assert.equal(left.issues, 1);
  assert.match(left.detail, /ENOENT/);
  assert.match(left.detail, /could not resume thread/);
  assert.deepEqual(h.calls().map(call => call.slice(0, 4)), [['queue', '--resume', '--thread', 'origin'], ['queue', '--resume', '--thread', 'origin']]);
  const queued = await exec(entry, ['start', '--notify', 'queue', '--no-panel', '--', 'true'], { cwd:h.dir, env:h.env });
  assert.equal(queued.stderr, '');
});

test('startup checks the selected WebSocket service without issuing chat requests', async t => {
  const { checkNoticeAccess } = await import('../src/notify.js');
  const server = http.createServer(), ws = new WebSocketServer({server});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const remote = 'ws://127.0.0.1:' + server.address().port;
  let messages = 0;
  ws.on('connection', client => client.on('message', () => messages++));
  t.after(() => { if (server.listening) server.close(); });
  assert.equal(await checkNoticeAccess({notify:'resume', remote}), null);
  assert.equal(messages, 0);
  await new Promise(resolve => ws.close(resolve));
  await new Promise(resolve => server.close(resolve));
  assert.equal(await checkNoticeAccess({notify:'steer', remote}), 'wakeUnavailable');
  assert.equal(await checkNoticeAccess({notify:'queue', remote}), 'queueUnavailable');
  assert.equal(await checkNoticeAccess({notify:'off', remote}), null);
});

test('show reports an earlier resume warning as queued and retains its diagnostics', async t => {
  const h = sandbox(t);
  const id = await h.cli('start', '--notify', 'off', '--', 'true');
  await h.ended(id);
  const file = path.join(h.env.BACKSOON_HOME, id, 'notice.json');
  const recorded = { state:'wake_warning', issues:2, detail:'Warning: message queued, but could not resume thread' };
  fs.writeFileSync(file, JSON.stringify(recorded));
  assert.deepEqual(JSON.parse(await h.cli('show', id)).notice, {...recorded, state:'queued', resumed:false, issues:1});
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), recorded);
  await assert.rejects(h.cli('retry-notice', id), /no confirmed unsent/);
  const unconfirmed = { state:'queued', wake:'unconfirmed', issues:1 };
  fs.writeFileSync(file, JSON.stringify(unconfirmed));
  assert.deepEqual(JSON.parse(await h.cli('show', id)).notice, { state:'queued', resumed:false, issues:1 });
});

test('inside the Codex sandbox a task that would notify is refused before anything runs', async t => {
  const h = sandbox(t);
  for (const variable of ['CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED']) {
    const env = { ...h.env, [variable]: variable === 'CODEX_SANDBOX' ? 'seatbelt' : '1' };
    for (const args of [['start', '--', 'sh', '-c', 'echo ran >> runs'], ['demo']])
      await assert.rejects(exec(entry, args, { cwd: h.dir, env }), e => e.stderr.includes(catalogs.en.sandboxed));
    assert.equal(fs.existsSync(path.join(h.dir, 'runs')), false);
    assert.equal(fs.existsSync(h.env.BACKSOON_HOME) ? fs.readdirSync(h.env.BACKSOON_HOME).length : 0, 0);
  }
  // A panel-only task does not need to reach Codex.
  Object.assign(h.env, { CODEX_SANDBOX: 'seatbelt' });
  const id = await h.cli('start', '--notify', 'off', '--', 'true');
  assert.equal((await h.ended(id)).status, 'succeeded');
});

async function idleChatService(t, dir) {
  const socket = path.join(dir, 'ws.sock');
  const server = http.createServer(), ws = new WebSocketServer({ server });
  server.listen(socket);
  await once(server, 'listening');
  t.after(() => { ws.close(); server.close(); });
  ws.on('connection', client => client.on('message', raw => {
    const q = JSON.parse(raw);
    if (q.id) client.send(JSON.stringify({ id: q.id, result: q.method === 'thread/read' ? { thread: { status: { type: 'idle' } } } : {} }));
  }));
  return 'unix://' + socket;
}

test('a CLI without queue --resume is warned about at startup and its accepted result is marked as not resumed', async t => {
  const h = sandbox(t);
  const remote = await idleChatService(t, h.dir);
  Object.assign(h.env, { QUEUE_HELP: '      --remote <ADDR>' });
  const run = await exec(entry, ['start', '--notify', 'resume', '--no-panel', '--remote', remote, '--', 'true'], { cwd: h.dir, env: h.env });
  const id = run.stdout.trim();
  assert.match(run.stderr, /has no queue --resume option, so BackSoon cannot ask Codex to resume this chat/);
  const notice = await until(async () => JSON.parse(await h.cli('show', id)).notice);
  assert.equal(notice.state, 'queued');
  assert.equal(notice.resumed, false);
  assert.match(notice.detail, /no queue --resume option/);
  assert.equal(notice.retryMessage, undefined);
  assert.deepEqual(h.calls().map(call => call.slice(0, 3)), [['queue', '--thread', 'origin']]);
  await assert.rejects(h.cli('retry-notice', id), /no confirmed unsent/);
});

test('a resume request the CLI rejects before queueing can be retried once', async t => {
  const h = sandbox(t);
  Object.assign(h.env, { QUEUE_CODE: '2', QUEUE_REPLY: "error: unexpected argument '--resume' found" });
  const id = await h.cli('start', '--', 'false');
  const notice = await until(async () => JSON.parse(await h.cli('show', id)).notice);
  assert.equal(notice.state, 'failed');
  assert.equal(notice.issues, 1);
  assert.match(notice.retryMessage, new RegExp('\\[BackSoon ' + id + ' done\\]'));
  Object.assign(h.env, { QUEUE_CODE: '0', QUEUE_REPLY: '' });
  assert.equal(await h.cli('retry-notice', id), catalogs.en.queued);
  assert.equal(h.calls().length, 2);
});

test('the CLI that Codex desktop names is used before an older one on PATH', async t => {
  const h = sandbox(t);
  const app = path.join(h.dir, 'app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'codex'), fs.readFileSync(path.join(h.dir, 'codex'), 'utf8').replaceAll('process.env.CAPTURE', "process.env.CAPTURE + '.app'").replace('process.env.QUEUE_HELP', 'undefined'));
  fs.chmodSync(path.join(app, 'codex'), 0o700);
  Object.assign(h.env, { CODEX_APP_RUNTIME_CLI_PATH: path.join(app, 'codex'), QUEUE_HELP: '' });
  const id = await h.cli('start', '--', 'true');
  assert.equal(h.state(id).codex, path.join(app, 'codex'));
  await until(async () => JSON.parse(await h.cli('show', id)).notice);
  assert.deepEqual(h.calls(), []);
  const [call] = fs.readFileSync(h.env.CAPTURE + '.app', 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(call.slice(0, 4), ['queue', '--resume', '--thread', 'origin']);
});

test('a failed task notice carries the diagnostic above trailing output and points to the full log', async t => {
  const h = sandbox(t);
  const script = 'echo "AssertionError: Expected 1 to equal 2" >&2; for i in 1 2 3 4 5 6 7 8; do echo "    at frame $i" >&2; done; echo "Node.js v22.12.0" >&2; exit 1';
  const id = await h.cli('start', '--', 'sh', '-c', script);
  await until(async () => JSON.parse(await h.cli('show', id)).notice);
  const message = h.calls().at(-1).at(h.calls().at(-1).indexOf('--message') + 1);
  assert.match(message, new RegExp('^\\[BackSoon ' + id + ' done\\]'));
  assert.match(message, /exit code 1/);
  assert.match(message, /AssertionError: Expected 1 to equal 2\n…\n/);
  assert.match(message, /Node\.js v22\.12\.0\nFull log: backsoon logs /);
  assert.ok(message.endsWith('backsoon logs ' + id));
});
