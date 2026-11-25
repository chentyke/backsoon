import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { DEMO_SECONDS, demoReading } from '../src/demo.js';
import { parseReport } from '../src/progress.js';
import { entry } from '../src/store.js';
import { catalogs, translator } from '../src/web/i18n.js';
import { port, sandbox, until } from './helpers.js';

test('the sample task moves forward on one timeline and ends with every job done', () => {
  let last = -1;
  for (let t = 0; t <= DEMO_SECONDS + 2; t += 0.5) {
    const reading = demoReading(t);
    parseReport(JSON.stringify(reading));
    assert.ok(reading.percent >= last, 'percent never goes back at ' + t);
    last = reading.percent;
    assert.equal(Boolean(reading.blocker), t >= 8 && t < 16);
  }
  const end = demoReading(DEMO_SECONDS);
  assert.equal(end.percent, 100);
  assert.equal(end.eta_seconds, 0);
  assert.ok(end.steps.every(step => step.state === 'succeeded' && step.done === step.total));
  assert.ok(demoReading(0).steps.every(step => step.state === 'inQueue'));
});

test('demo starts the sample task with its progress script and reports to the chat', async t => {
  const h = sandbox(t);
  const id = await h.cli('demo');
  const task = h.state(id);
  assert.equal(task.name, catalogs.en.demoName);
  assert.deepEqual(task.argv, [entry, '_demo']);
  assert.equal(task.notify, 'steer');
  assert.equal(task.notify_thread, 'origin');
  assert.match(task.progress_script, /demo-progress\.js$/);
  const shown = await until(async () => {
    const state = JSON.parse(await h.cli('show', id));
    return state.activities?.length === 4 && state;
  });
  assert.equal(shown.stage, catalogs.en.demoInstalling);
  assert.match(await h.cli('logs', id), /^Resolving packages…/);
  await h.cli('stop', id);
  assert.equal((await h.ended(id)).status, 'stopped');

  // Outside a Codex chat the demo runs for the panel alone.
  delete h.env.CODEX_THREAD_ID;
  const local = await h.cli('demo');
  assert.equal(h.state(local).notify, 'off');
  await h.cli('stop', local);
});

// A stand-in for the Codex app server that records what the guide sends.
async function appServer(t, dir) {
  const socket = path.join(dir, 'ws.sock'), server = http.createServer(), ws = new WebSocketServer({ server });
  server.listen(socket);
  await once(server, 'listening');
  t.after(() => { ws.close(); server.close(); });
  const fake = { active: true, requests: [] };
  ws.on('connection', client => client.on('message', raw => {
    const q = JSON.parse(raw);
    fake.requests.push(q);
    if (!q.id) return;
    let result = {};
    if (q.method === 'thread/read') result = { thread: { status: { type: fake.active ? 'active' : 'idle' } } };
    if (q.method === 'thread/turns/list') result = { data: [{ id: 'turn', status: 'inProgress' }] };
    if (q.method === 'turn/steer') result = { turnId: 'turn' };
    client.send(JSON.stringify({ id: q.id, result }));
  }));
  fake.remote = 'unix://' + socket;
  return fake;
}

async function guide(t, env) {
  const child = fork(entry, ['_onboard'], { cwd: env.dir, env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  t.after(() => child.kill());
  const [{ value }] = await once(child, 'message');
  const url = new URL(value);
  const post = (body, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request(new URL('/api/demo', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BackSoon-Guide': '1', Origin: url.origin,
        'X-BackSoon-Token': url.hash.slice(1), ...headers },
    }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data: text && JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  const status = async () => {
    const response = await fetch(new URL('/api/setup', url), { headers: { 'X-BackSoon-Guide': '1' } });
    assert.equal(response.status, 200);
    return response.json();
  };
  return { post, status };
}

// The guide's own sandbox: tasks, panel state and a free panel port.
async function guideEnv(h, extra) {
  return { ...h.env, dir: h.dir, CODEX_HOME: path.join(h.dir, 'codex-home'), BACKSOON_PORT: String(await port()), ...extra };
}
const demoTasks = h => fs.existsSync(h.env.BACKSOON_HOME) ? fs.readdirSync(h.env.BACKSOON_HOME) : [];

test('the setup guide starts the demo itself and asks its chat to open the panel, once', async t => {
  const h = sandbox(t), fake = await appServer(t, h.dir);
  const env = await guideEnv(h, { CODEX_THREAD_ID: 'setup-chat', BACKSOON_REMOTE: fake.remote });
  const { post, status } = await guide(t, env);
  assert.equal((await status()).demo, 'ready');

  // Only the guide itself, with its token, can start it.
  assert.equal((await post({ locale: 'ja' }, { 'X-BackSoon-Token': 'wrong' })).status, 403);
  assert.equal((await post({ locale: 'ja' }, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await post({ locale: 'fr' })).status, 400);
  assert.equal(fake.requests.length, 0);
  assert.deepEqual(demoTasks(h), []);

  const sent = await post({ locale: 'ja' });
  assert.deepEqual(sent, { status: 200, data: { state: 'steered', detail: '' } });
  // The task runs from the guide, reporting to the chat that ran setup.
  const [id] = demoTasks(h);
  assert.equal(h.state(id).name, catalogs.en.demoName);
  assert.equal(h.state(id).notify_thread, 'setup-chat');
  const steers = fake.requests.filter(q => q.method === 'turn/steer');
  assert.equal(steers.length, 1);
  assert.equal(steers[0].params.threadId, 'setup-chat');
  const panel = JSON.parse(fs.readFileSync(h.panelFile, 'utf8')).url + 'chats/setup-chat';
  assert.deepEqual(steers[0].params.input, [{ type: 'text', text: translator('ja')('demoPrompt', { id, url: panel }) }]);

  // A second click, or a reload, never starts or sends it again.
  assert.deepEqual(await post({ locale: 'en' }), sent);
  assert.equal(fake.requests.filter(q => q.method === 'turn/steer').length, 1);
  assert.deepEqual(demoTasks(h), [id]);
  assert.equal((await status()).demo, 'steered');
});

test('the guide resumes an idle chat, and a failed delivery is retried without a second task', async t => {
  const h = sandbox(t), fake = await appServer(t, h.dir);
  fake.active = false;
  const env = await guideEnv(h, { CODEX_THREAD_ID: 'idle-chat', BACKSOON_REMOTE: fake.remote,
    QUEUE_CODE: '1', QUEUE_REPLY: 'Error: failed to connect to local app server' });
  const { post } = await guide(t, env);
  const failed = await post({ locale: 'en' });
  assert.equal(failed.status, 502);
  assert.equal(failed.data.state, 'failed');
  assert.match(failed.data.detail, /failed to connect/);
  const [id] = demoTasks(h);
  const [args] = h.calls();
  assert.deepEqual(args.slice(0, 4), ['queue', '--resume', '--thread', 'idle-chat']);
  assert.match(args[args.indexOf('--message') + 1], new RegExp(id));

  // By the retry the chat has a turn running, so the prompt goes into it.
  fake.active = true;
  assert.deepEqual(await post({ locale: 'en' }), { status: 200, data: { state: 'steered', detail: '' } });
  assert.deepEqual(await post({ locale: 'en' }), { status: 200, data: { state: 'steered', detail: '' } });
  assert.equal(h.calls().filter(call => call.includes('--message')).length, 1);
  assert.equal(fake.requests.filter(q => q.method === 'turn/steer').length, 1);
  assert.deepEqual(demoTasks(h), [id]);
});

test('a guide opened outside a Codex chat offers no demo', async t => {
  const h = sandbox(t);
  const env = await guideEnv(h);
  delete env.CODEX_THREAD_ID;
  const { post, status } = await guide(t, env);
  assert.equal((await status()).demo, null);
  assert.equal((await post({ locale: 'en' })).status, 409);
  assert.equal(h.calls().length, 0);
  assert.deepEqual(demoTasks(h), []);
});
