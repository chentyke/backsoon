import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { entry } from '../src/store.js';
import { exec, sandbox, until } from './helpers.js';

function desktop(t) {
  const h = sandbox(t);
  const thread = randomUUID();
  // Keep the default Unix socket path within the macOS length limit.
  const profile = fs.mkdtempSync('/tmp/backsoon-desktop-');
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const bundled = path.join(h.dir, 'desktop-cli');
  fs.writeFileSync(bundled, '#!' + process.execPath + '\n' + `
    if (process.argv[2] === 'queue') {
      require(${JSON.stringify(path.join(h.dir, 'codex'))});
    } else if (process.argv[2] === 'app-server') {
      const fs = require('node:fs');
      require('node:readline').createInterface({input:process.stdin}).on('line', line => {
        const q = JSON.parse(line);
        if (!q.id) return;
        if (q.params.threadId && q.params.threadId !== process.env.CODEX_THREAD_ID) process.exit(3);
        let result = {};
        if (q.method === 'thread/read') result = {thread:{id:q.params.threadId}};
        if (q.method === 'thread/turns/list') {
          const turns = JSON.parse(fs.readFileSync('turns.json','utf8'));
          if (turns.error) {
            console.log(JSON.stringify({id:q.id,error:turns.error}));
            return;
          }
          fs.writeFileSync('read-receipt', turns[0]?.id ?? '');
          result = {data:turns};
        }
        console.log(JSON.stringify({id:q.id,result}));
      });
    } else process.exit(2);
  `, {mode:0o700});
  h.write('turns.json', '[]');
  delete h.env.BACKSOON_REMOTE;
  Object.assign(h.env, { CODEX_HOME:profile, CODEX_THREAD_ID:thread, CODEX_APP_TOOLS_PIPE_PATH:'desktop',
    CODEX_APP_RUNTIME_CLI_PATH:bundled, BACKSOON_PICKUP_WAIT:'20' });
  return { h, thread, profile };
}

test('an idle Desktop chat receives the completion through its queue without a control socket', async t => {
  const {h, thread} = desktop(t);
  const run = await exec(entry, ['start', '--no-panel', '--', 'sh', '-c', 'echo "Error: wrong total" >&2; exit 1'],
    {cwd:h.dir, env:h.env});
  const id = run.stdout.trim();
  assert.match(run.stderr, /final reply/);
  assert.match(run.stderr, /direct resume service is unreachable/);
  await until(() => fs.existsSync(path.join(h.dir, 'read-receipt')));
  const text = h.calls()[0].at(-1);
  assert.match(text, /Error: wrong total/);
  const recorded = () => JSON.parse(fs.readFileSync(path.join(h.env.BACKSOON_HOME, id, 'notice.json')));
  h.write('turns.json', JSON.stringify([{id:'wrong-turn',items:[
    {type:'agentMessage',text}, {type:'userMessage',content:[{type:'text',text:'[BackSoon different done]'}]},
  ]}]));
  await until(() => fs.readFileSync(path.join(h.dir, 'read-receipt'), 'utf8') === 'wrong-turn');
  assert.equal(recorded().state, 'queued');
  await assert.rejects(h.cli('retry-notice', id), /no confirmed unsent/);
  h.write('turns.json', JSON.stringify([{id:'desktop-turn',items:[{type:'userMessage',content:[{type:'text',text}]}]}]));
  await until(() => recorded().state === 'resumed');
  assert.equal(recorded().turnId, 'desktop-turn');
  assert.equal(recorded().issues, 0);
  assert.deepEqual(h.calls(), [['queue','--thread',thread,'--message',text]]);
});

test('a Desktop completion never asks a separate service to resume its chat', async t => {
  const {h, thread, profile} = desktop(t);
  h.env.BACKSOON_PICKUP_WAIT = '3';
  const sockets = path.join(profile, 'app-server-control');
  fs.mkdirSync(sockets);
  const server = http.createServer(), ws = new WebSocketServer({server});
  server.listen(path.join(sockets, 'app-server-control.sock'));
  await once(server, 'listening');
  t.after(() => { ws.close(); server.close(); });
  const methods = [];
  ws.on('connection', socket => socket.on('message', raw => {
    const q = JSON.parse(raw);
    if (!q.id) return;
    methods.push(q.method);
    socket.send(JSON.stringify({id:q.id,result:q.method === 'thread/read' ? {thread:{status:{type:'notLoaded'}}} : {}}));
  }));
  const id = await h.cli('start','--no-panel','--','false');
  const final = await until(async () => {
    const {notice} = JSON.parse(await h.cli('show',id));
    return notice?.resumed === false && notice;
  });
  assert.equal(final.state, 'queued');
  assert.equal(final.issues, 1);
  assert.deepEqual(methods.filter(m => !['initialize', 'thread/read'].includes(m)), []);
  assert.deepEqual(h.calls().map(call => call.slice(0, 3)), [['queue', '--thread', thread]]);
});

test('an unreadable chat keeps its accepted completion queued and ineligible for resend', async t => {
  const {h} = desktop(t);
  h.write('turns.json', JSON.stringify({error:{code:-32601,message:'method not available'}}));
  const id = await h.cli('start', '--notify', 'resume', '--no-panel', '--', 'false');
  const notice = await until(async () => {
    const {notice} = JSON.parse(await h.cli('show', id));
    return notice?.resumed === false && notice;
  });
  assert.equal(notice.state, 'queued');
  assert.equal(notice.turnId, undefined);
  assert.equal(notice.issues, 1);
  await assert.rejects(h.cli('retry-notice', id), /no confirmed unsent/);
  assert.equal(h.calls().length, 1);
});
