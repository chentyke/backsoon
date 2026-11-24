import { msg } from './locale.js';
import { offerCompletion } from './receiver.js';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { Rpc, Rejected } from './rpc.js';
import { save, now, optional, withFileLock } from './store.js';

const exec = promisify(execFile);
function socketPath(address) {
  return address.slice(7) || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    'app-server-control/app-server-control.sock');
}

function endpoint(address) {
  return address.startsWith('unix://') ? 'ws+unix://' + socketPath(address) + ':/' : address;
}

// A handshake checks current reachability without waking or changing the chat.
export async function checkNoticeAccess(task) {
  if (task.notify === 'off' || (task.notify === 'queue' && !task.remote)) return null;
  let socket;
  try {
    socket = new WebSocket(endpoint(task.remote || 'unix://'), { handshakeTimeout: 1000 });
    await once(socket, 'open');
    return null;
  } catch (error) {
    if (['EACCES', 'EPERM'].includes(error.code)) return 'noticePermission';
    return task.notify === 'queue' ? 'queueUnavailable' : 'wakeUnavailable';
  } finally {
    socket?.terminate();
  }
}

export async function steer(thread, message, remote = 'unix://') {
  let socket,
    sent = false;
  try {
    socket = new WebSocket(endpoint(remote || 'unix://'), { handshakeTimeout: 3000 });
    const api = new Rpc((msg) => socket.send(JSON.stringify(msg)));
    socket.on('error', (e) => api.close(e));
    socket.on('close', () => api.close());
    socket.on('message', (data) => api.receive(data.toString()));
    await once(socket, 'open');
    const deadline = Date.now() + 6000;
    await api.initialize(deadline);
    const info = await api.call('thread/read', { threadId: thread }, deadline);
    const state = info.thread.status.type;
    if (state !== 'active')
      return [
        'fallback',
        state === 'notLoaded' ? msg('chatUnloaded') : msg('inactiveChat'),
      ];
    const { data } = await api.call(
      'thread/turns/list',
      { threadId: thread, itemsView: 'notLoaded', limit: 1, sortDirection: 'desc' },
      deadline,
    );
    if (data[0]?.status !== 'inProgress') return ['fallback', msg('noTurn')];
    const turn = data[0].id;
    sent = true;
    const result = await api.call(
      'turn/steer',
      {
        threadId: thread,
        expectedTurnId: turn,
        clientUserMessageId: randomUUID(),
        input: [{ type: 'text', text: message }],
      },
      deadline,
    );
    return result.turnId === turn
      ? ['steered', '']
      : ['unknown', msg('wrongTurn')];
  } catch (e) {
    const refused =
      e instanceof Rejected &&
      ([-32601, -32602].includes(e.code) ||
        /no active turn|not loaded|turn.*(?:mismatch|not found)|expected.*turn|not supported/i.test(
          e.message,
        ));
    return [!sent || refused ? 'fallback' : 'unknown', e.message.slice(0, 400)];
  } finally {
    socket?.terminate();
  }
}
async function queue(task, message) {
  const args = ['queue'];
  if (task.notify !== 'queue') args.push('--resume');
  args.push('--thread', task.notify_thread, '--message', message);
  if (task.remote) args.push('--remote', task.remote);
  try {
    const { stdout, stderr } = await exec('codex', args, { timeout: 20000, killSignal: 'SIGKILL' });
    const output = (stdout + '\n' + stderr).trim();
    const wakeWarning = /warn[^\n]*(?:resum|wake)|(?:resum|wake)[^\n]*(?:fail|unable)|could not resume/i.test(output);
    return ['queued', wakeWarning ? output.slice(-1200) : ''];
  } catch (e) {
    if (e.killed || e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
      return ['unknown', msg('partialAck')];
    const retryable = ['ENOENT', 'EACCES', 'EPERM'].includes(e.code) ||
      /^Error: failed to connect to (?:remote |local )?app server/im.test(e.stderr || '');
    return [
      'failed',
      ((e.stdout || '') + '\n' + (e.stderr || '')).trim().slice(-1200) || msg('codexError', { code: e.code }),
      retryable,
    ];
  }
}
async function deliver(file, task, message, finished, issues) {
  let state, detail, retryable;
  if (task.notify === 'steer') {
    state = finished ? await offerCompletion(task) : 'fallback';
    if (state === 'unknown') detail = msg('partialAck');
    if (state === 'fallback') [state, detail] = await steer(task.notify_thread, message, task.remote);
  }
  if (!state || state === 'fallback') {
    const reason = detail;
    [state, detail, retryable] = await queue(task, message);
    if (reason) detail = [msg('queueFallback', { reason }), detail].filter(Boolean).join('\n');
  }
  const notice = { state, detail, time: now(), issues: issues + Number(!['steered', 'received', 'queued'].includes(state)) };
  if (finished && retryable) notice.retryMessage = message;
  save(file, notice);
  return notice;
}

export async function retryNotice(dir, task) {
  const file = path.join(dir, 'notice.json');
  return withFileLock(path.join(dir, 'notice.lock'), async () => {
    const notice = optional(file);
    if (!task.ended || notice?.state !== 'failed' || !notice.retryMessage)
      throw Error(msg('noRetryNotice'));
    // If this process dies during delivery, another caller must not send a duplicate.
    save(file, { state: 'unknown', detail: msg('partialAck'), time: now(), issues: notice.issues });
    return deliver(file, task, notice.retryMessage, true, notice.issues);
  });
}

export class Notifications {
  constructor(dir, task) {
    this.file = path.join(dir, 'notice.json');
    this.task = task;
    this.pending = [];
    this.issues = 0;
    this.chain = Promise.resolve();
    this.count = 0;
  }
  match(line) {
    this.count++;
    this.pending.push(line.slice(0, 500));
    if (this.pending.length > 4) this.pending.shift();
    // While Codex is slow, retain one count and the latest four lines.
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.chain.then(() => this.flush());
      }, 500);
  }
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.count) return;
    const content = msg('matches', { count: this.count, lines: this.pending.join('\n') });
    this.pending = [];
    this.count = 0;
    this.enqueue(content);
  }
  enqueue(content, finished = false) {
    this.chain = this.chain.then(async () => {
      const task = this.task;
      const message = '[BackSoon ' + task.id + (finished ? ' done] ' : '] ') + task.name + '\n' + content;
      const notice = await deliver(this.file, task, message, finished, this.issues);
      this.issues = notice.issues;
    });
  }
  send(content, finished = false) {
    this.flush();
    this.enqueue(content, finished);
    return this.chain;
  }
}
