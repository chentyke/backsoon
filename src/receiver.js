import fs from 'node:fs';
import net from 'node:net';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { optional, save, taskId, withFileLock } from './store.js';

export const receiverEvents = ['UserPromptSubmit', 'PostToolUse', 'Stop', 'Interrupt'];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const outcomes = new Set(['succeeded', 'failed', 'exited', 'stopped', 'interrupted']);

function mailbox(chat) {
  if (!uuid.test(chat)) return null;
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'backsoon-receivers', chat);
}

// Only identifiers and process results enter hook context. Names, commands and
// subprocess output are user-controlled and stay in the task record.
function summary(ticket) {
  if (!taskId.test(ticket.id) || !outcomes.has(ticket.status)) return null;
  const code = Number.isSafeInteger(ticket.code) ? ', exit code ' + ticket.code : '';
  return '[BackSoon ' + ticket.id + ' done] ' + ticket.status + code;
}

export async function receive({session_id: chat, turn_id: turn, hook_event_name: event},
  write = value => fs.writeSync(1, JSON.stringify(value) + '\n')) {
  const dir = mailbox(chat);
  if (!dir || !uuid.test(turn) || !receiverEvents.includes(event)) return;
  if (event === 'UserPromptSubmit') fs.mkdirSync(dir, {recursive:true, mode:0o700});
  else if (!fs.existsSync(dir)) return;
  await withFileLock(path.join(dir, 'lock'), () => {
    const active = path.join(dir, 'turn.json');
    if (event === 'UserPromptSubmit') save(active, turn);
    else if (optional(active) !== turn) return;
    const pending = [];
    for (const name of fs.readdirSync(dir)) {
      if (!/^[a-f0-9]{12}\.json$/.test(name)) continue;
      const file = path.join(dir, name), ticket = optional(file);
      if (ticket?.state === 'pending' && summary(ticket)) pending.push({file,ticket});
    }
    if (event === 'Interrupt') {
      fs.rmSync(active, {force:true});
      for (const {file,ticket} of pending) finish(file, ticket, 'released');
      return;
    }
    if (!pending.length) {
      if (event === 'Stop') fs.rmSync(active, {force:true});
      return;
    }
    const text = pending.map(({ticket}) => summary(ticket)).join('\n');
    // If the hook dies during stdout delivery the worker cannot safely resend.
    for (const {file,ticket} of pending) save(file, {...ticket, state:'claimed'});
    write(event === 'Stop' ? {decision:'block', reason:text}
      : {hookSpecificOutput:{hookEventName:event, additionalContext:text}});
    for (const {file,ticket} of pending) finish(file, ticket, 'received');
  });
}

// The acknowledgement connection carries no data. The worker checks its private
// ticket under the chat lock before deciding whether it may send anything else.
function finish(file, ticket, state) {
  save(file, {...ticket, state});
  const socket = net.connect({host:'127.0.0.1', port:ticket.port});
  socket.on('connect', () => socket.end());
  socket.on('error', () => {});
  socket.setTimeout(500, () => socket.destroy());
}

export async function offerCompletion(task, timeout = 60_000) {
  const dir = mailbox(task.notify_thread);
  if (!dir || task.remote || !summary(task) || !fs.existsSync(path.join(dir, 'turn.json'))) return 'fallback';
  const active = path.join(dir, 'turn.json'), file = path.join(dir, task.id + '.json');
  let offered = false, server, timer;
  try {
    let wake;
    const changed = new Promise(resolve => { wake = resolve; });
    server = net.createServer(socket => {
      socket.destroy();
      if (offered && optional(file)?.state !== 'pending') wake();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    server.on('error', wake);
    const lock = path.join(dir, 'lock');
    await withFileLock(lock, () => {
      if (!optional(active)) return;
      save(file, {id:task.id, status:task.status, code:task.code, state:'pending', port:server.address().port});
      offered = true;
    });
    if (!offered) return 'fallback';

    timer = setTimeout(wake, timeout);
    await changed;
    return await withFileLock(lock, () => {
      const state = optional(file)?.state;
      fs.rmSync(file, {force:true});
      if (state === 'pending' || state === 'released') return 'fallback';
      return state === 'received' ? 'received' : 'unknown';
    });
  } catch {
    return offered ? 'unknown' : 'fallback';
  } finally {
    clearTimeout(timer);
    if (server?.listening) server.close();
  }
}
