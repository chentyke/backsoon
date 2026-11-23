import { msg } from './locale.js';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { Rpc, Rejected } from './rpc.js';

const notice = /^\[BackSoon ([a-f0-9]{12}) done\] /;
function matches(item, id) {
  return (
    item.type === 'userMessage' &&
    item.content?.some((part) => {
      const match = part.type === 'text' && notice.exec(part.text);
      return match && (id === '*' || match[1] === id);
    })
  );
}
async function* pages(call, method, params) {
  let cursor;
  do {
    const page = await call(method, cursor ? { ...params, cursor } : params);
    yield* page.data;
    cursor = page.nextCursor;
  } while (cursor);
}
function finished(turn, newer = false) {
  if (turn.status === 'interrupted') return newer || turn.completedAt != null || !!turn.error;
  return ['completed', 'failed'].includes(turn.status);
}
export class Watch {
  constructor(config) {
    this.config = config;
    this.first = true;
  }
  async result(call, turn, newer) {
    if (!finished(turn, newer)) return null;
    const { chat, after_task: id, final_line: marker } = this.config;
    let text,
      matched = !id;
    for await (const { item } of pages(call, 'thread/items/list', {
      threadId: chat,
      turnId: turn.id,
      sortDirection: 'desc',
      limit: 16,
      deferOutput: {},
    })) {
      if (
        text === undefined &&
        item.type === 'agentMessage' &&
        (item.phase == null || item.phase === 'final_answer')
      )
        text = item.text.trim();
      if (id && matches(item, id)) matched = true;
      if (matched && text !== undefined) break;
    }
    if (!matched || (marker && turn.status === 'completed' && text?.split(/\r?\n/).at(-1) !== marker))
      return null;
    return [turn, text || ''];
  }
  async check(call) {
    const history = this.first && this.config.after_task && this.config.after_task !== '*';
    const recent = [];
    for await (const turn of pages(call, 'thread/turns/list', {
      threadId: this.config.chat,
      sortDirection: 'desc',
      itemsView: 'notLoaded',
      limit: 16,
    })) {
      if (turn.id === this.anchor) {
        if (!this.anchorFinished) recent.push(turn);
        break;
      }
      if (history) {
        const result = await this.result(call, turn, recent.length > 0);
        if (result) return result;
        if (!recent.length) recent.push(turn);
      } else {
        recent.push(turn);
        if (this.first) break;
      }
    }
    if (!history) {
      for (let i = recent.length - 1; i >= 0; i--) {
        const result = await this.result(call, recent[i], i > 0);
        if (result) return result;
      }
    }
    if (recent.length) {
      this.anchor = recent[0].id;
      this.anchorFinished = finished(recent[0]);
    }
    this.first = false;
    return null;
  }
}
export function chatLabel(id, chats = [id]) {
  const label = value => value.slice(0, 8) + '…' + value.slice(-8);
  return chats.some(other => other !== id && label(other) === label(id)) ? id : label(id);
}

export async function waitChat(config) {
  const watch = new Watch(config);
  const end = config.timeout ? Date.now() + config.timeout * 1000 : Infinity;
  let failures = 0, name = chatLabel(config.chat, config.chats), lastInfo = 0;
  const report = state => process.send?.({ id: config.chat, kind: 'chat', name, state });
  report('running');
  console.log(msg('awaitReply', { chat: config.chat }));
  while (Date.now() < end) {
    const child = spawn('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const api = new Rpc((msg) => child.stdin.write(JSON.stringify(msg) + '\n'));
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => api.receive(line));
    child.on('error', (e) => api.close(e));
    child.stdin.on('error', (e) => api.close(e));
    child.on('close', () => api.close());
    try {
      await api.initialize(end);
      while (Date.now() < end) {
        if (Date.now() - lastInfo >= 10000 && process.send) {
          lastInfo = Date.now();
          try {
            const { thread } = await api.call('thread/read', { threadId: config.chat }, Math.min(end, Date.now() + 2000));
            if (thread) {
              name = thread.name || name;
              report(thread.status?.activeFlags?.includes('waitingOnUserInput') ? 'needsInput' : 'running');
            }
          } catch { /* The turn history can still be available. */ }
        }
        let result;
        try {
          result = await watch.check((method, params) => api.call(method, params, end));
        } catch (e) {
          // A new chat has no turn history until its first prompt is saved.
          const missingHistory = /thread (?:not loaded|not found)|no rollout|not (?:yet )?materialized|list_turns is not supported yet/i;
          if (!(e instanceof Rejected) || e.method !== 'thread/turns/list' || !missingHistory.test(e.message)) throw e;
        }
        failures = 0;
        if (result) {
          const [turn, reply] = result;
          const ok = turn.status === 'completed';
          const text = ok ? reply : turn.error?.message || turn.status;
          console.log(msg('chatTurn', { chat: config.chat, turn: turn.id }));
          if (text) console.log(text);
          console.log(
            msg('chatResult', {
              status: msg(turn.status === 'completed' ? 'succeeded' : turn.status),
              text: text.replace(/\s+/g, ' ').slice(0, 650) || msg('noReply'),
            }),
          );
          report(ok ? 'succeeded' : 'failed');
          return ok ? 0 : 1;
        }
        await sleep(Math.min(2000, Math.max(0, end - Date.now())));
      }
    } catch (e) {
      if (Date.now() >= end) break;
      if (e instanceof Rejected || ++failures >= 3) {
        report('failed');
        console.log(msg('chatReadError', { error: e.message }));
        return 1;
      }
    } finally {
      lines.close();
      child.kill('SIGKILL');
    }
    await sleep(Math.min(1000, Math.max(0, end - Date.now())));
  }
  report('failed');
  console.log(msg('chatTimeout'));
  return 1;
}
