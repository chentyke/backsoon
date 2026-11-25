import { msg } from './locale.js';
import { offerCompletion } from './receiver.js';
import { noticeTurn, usesDesktopQueue } from './receipt.js';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { Rpc, Rejected } from './rpc.js';
import { codexCommand, queueOptions } from './codex.js';
import { save, now, optional, withFileLock } from './store.js';

const exec = promisify(execFile);
function socketPath(address) {
  return address.slice(7) || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    'app-server-control/app-server-control.sock');
}

function endpoint(address) {
  return address.startsWith('unix://') ? 'ws+unix://' + socketPath(address) + ':/' : address;
}

function connectRpc(address, timeout) {
  const socket = new WebSocket(endpoint(address || 'unix://'), { handshakeTimeout: timeout });
  const api = new Rpc(msg => socket.send(JSON.stringify(msg)));
  socket.on('error', error => api.close(error));
  socket.on('close', () => api.close());
  socket.on('message', data => api.receive(data.toString()));
  return { socket, api };
}

// A handshake checks current reachability without waking or changing the chat.
// Waking an idle chat also needs a CLI whose queue command accepts --resume.
export async function checkNoticeAccess(task) {
  if (task.notify === 'off' || (task.notify === 'queue' && !task.remote)) return null;
  let socket;
  try {
    socket = new WebSocket(endpoint(task.remote || 'unix://'), { handshakeTimeout: 1000 });
    await once(socket, 'open');
  } catch (error) {
    if (['EACCES', 'EPERM'].includes(error.code)) return 'noticePermission';
    return task.notify === 'queue' ? 'queueUnavailable' : 'wakeUnavailable';
  } finally {
    socket?.terminate();
  }
  if (task.notify !== 'queue' && (await queueOptions(task.codex || codexCommand()))?.resume === false)
    return 'resumeUnsupported';
  return null;
}

// A completion for an idle chat that the connected service has loaded starts a
// turn there, so the result is confirmed by the turn ID it returns.
export async function steer(thread, message, remote = 'unix://', startIdle = false) {
  let socket,
    sent = false;
  try {
    let api;
    ({ socket, api } = connectRpc(remote, 3000));
    await once(socket, 'open');
    const deadline = Date.now() + 6000;
    await api.initialize(deadline);
    const info = await api.call('thread/read', { threadId: thread }, deadline);
    const state = info.thread.status.type;
    const input = [{ type: 'text', text: message }];
    if (startIdle && state === 'idle') {
      sent = true;
      const result = await api.call('turn/start', { threadId: thread, input, clientUserMessageId: randomUUID() }, deadline);
      return result.turn?.id ? ['resumed', '', result.turn.id] : ['unknown', msg('partialAck')];
    }
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
        input,
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
// A resolved result is { state, detail?, turnId?, resumed?, retryable? }.
// `resumed` is false when Codex accepted the message but nothing started the
// idle chat, so it waits in the chat's queue. Resending would deliver it twice.
async function queue(task, message) {
  const command = task.codex || codexCommand();
  const wake = task.notify !== 'queue';
  const resume = wake && (await queueOptions(command))?.resume !== false;
  const args = ['queue'];
  if (resume) args.push('--resume');
  args.push('--thread', task.notify_thread, '--message', message);
  if (task.remote) args.push('--remote', task.remote);
  let output;
  try {
    const { stdout, stderr } = await exec(command, args, { timeout: 20000, killSignal: 'SIGKILL' });
    output = (stdout + '\n' + stderr).trim();
  } catch (e) {
    if (e.killed || e.signal || e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
        /^Queued message \S+ for thread /im.test((e.stdout || '') + '\n' + (e.stderr || '')))
      return { state: 'unknown', detail: msg('partialAck') };
    // A rejected command line, a missing CLI or no connection means nothing was queued.
    const retryable = ['ENOENT', 'EACCES', 'EPERM'].includes(e.code) ||
      /^Error: failed to connect to (?:remote |local )?app server|^error: (?:unexpected argument|unrecognized subcommand)/im.test(e.stderr || '');
    return {
      state: 'failed',
      detail: ((e.stdout || '') + '\n' + (e.stderr || '')).trim().slice(-1200) || msg('codexError', { code: e.code }),
      retryable,
    };
  }
  if (!wake) return { state: 'queued' };
  const wakeWarning = /warn[^\n]*(?:resum|wake)|(?:resum|wake)[^\n]*(?:fail|unable)|could not resume/i.test(output);
  if (resume && !wakeWarning) return { state: 'queued' };
  // A local chat's history settles this later; a remote one cannot be read here.
  const detail = resume ? output.slice(-1200) : msg('resumeMissing', { cli: command });
  return task.remote ? { state: 'queued', resumed: false, detail } : { state: 'queued', detail };
}
// Delivers one message the way the default `steer` mode does: into the active
// turn when there is one, otherwise queued with a request to resume the chat.
export async function sendToChat(thread, message, remote = null) {
  const [state, detail] = await steer(thread, message, remote || undefined);
  if (state !== 'fallback') return { state, detail };
  const result = await queue({ notify: 'resume', notify_thread: thread, remote }, message);
  return { state: result.state, detail: result.detail || '' };
}
async function deliver(file, task, message, finished, issues) {
  let result;
  if (task.notify === 'steer') {
    const state = finished ? await offerCompletion(task) : 'fallback';
    result = { state, detail: state === 'unknown' ? msg('partialAck') : undefined };
    if (state === 'fallback') {
      const [steered, detail, turnId] = await steer(task.notify_thread, message, task.remote, finished);
      result = { state: steered, detail, turnId };
    }
  }
  if (!result || result.state === 'fallback') {
    const reason = result?.detail;
    result = await queue(usesDesktopQueue(task) ? { ...task, notify: 'queue' } : task, message);
    if (reason) result.detail = [msg('queueFallback', { reason }), result.detail].filter(Boolean).join('\n');
    if (finished && !task.remote && task.notify !== 'queue' && result.state === 'queued') {
      // Show the accepted entry while the chat is checked. It must not be resent.
      save(file, { ...result, time: now(), issues });
      const turnId = await noticeTurn(task.codex || codexCommand(), task);
      result = turnId ? { state: 'resumed', turnId } : { ...result, resumed: false };
    }
  }
  const { retryable, ...outcome } = result;
  const issue = ['failed', 'unknown'].includes(result.state) || result.resumed === false;
  const notice = { ...outcome, time: now(), issues: issues + Number(issue) };
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
