import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { entry } from '../src/store.js';
import { exec, sandbox, until } from './helpers.js';

test('unix WebSocket steers active turns, falls back only on known failures', async (t) => {
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
        result = { thread: { status: { type: behavior === 'idle' ? 'idle' : 'active' } } };
      if (q.method === 'thread/turns/list') result = { data: [{ id: 'turn', status: 'inProgress' }] };
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
    ['idle', 'queued'],
    ['rejected', 'queued'],
    ['disconnect', 'unknown'],
  ]) {
    requests = [];
    behavior = mode;
    const count = h.calls().length;
    const id = await h.cli(
      'start',
      '--notify',
      'steer',
      '--remote',
      'unix://' + socket,
      '--',
      'echo',
      'finished',
    );
    const n = await until(async () => JSON.parse(await h.cli('show', id)).notice);
    assert.equal(n.state, expected);
    assert.equal(h.calls().length - count, expected === 'queued' ? 1 : 0);
    assert.equal(requests.filter((q) => q.method === 'turn/steer').length, mode === 'idle' ? 0 : 1);
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
