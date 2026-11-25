import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { msg } from './locale.js';
import { codexCommand } from './codex.js';
export class Rejected extends Error {
  constructor(error, method) {
    super(String(error.message || msg('rpcRejected')).slice(0, 400));
    this.code = error.code;
    this.method = method;
  }
}
export class Rpc {
  constructor(send) {
    this.send = send;
    this.pending = new Map();
    this.id = 0;
  }
  receive(raw) {
    let reply;
    try {
      reply = JSON.parse(raw);
    } catch (e) {
      this.close(e);
      return;
    }
    const entry = this.pending.get(reply.id);
    if (!entry) return;
    if (reply.error) entry.reject(new Rejected(reply.error, entry.method));
    else entry.resolve(reply.result);
  }
  close(error = Error(msg('rpcClosed'))) {
    this.error = error;
    for (const entry of this.pending.values()) entry.reject(error);
  }
  async call(method, params, deadline = Date.now() + 15000) {
    if (this.error) throw this.error;
    if (deadline <= Date.now()) throw Error(msg('rpcTimeout'));
    const id = ++this.id;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, method });
        timer = setTimeout(
          () => reject(Error(msg('rpcTimeout'))),
          Math.min(deadline - Date.now(), 15000),
        );
        this.send({ id, method, params });
      });
    } finally {
      this.pending.delete(id);
      clearTimeout(timer);
    }
  }
  async initialize(deadline, capabilities) {
    await this.call('initialize', { clientInfo: { name: 'backsoon', version: '1' }, capabilities }, deadline);
    this.send({ method: 'initialized' });
  }
}

export function openAppServer(command = codexCommand()) {
  const child = spawn(command, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const api = new Rpc((msg) => child.stdin.write(JSON.stringify(msg) + '\n'));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => api.receive(line));
  child.on('error', (e) => api.close(e));
  child.stdin.on('error', (e) => api.close(e));
  child.on('close', () => api.close());
  return { api, close() { lines.close(); child.kill('SIGKILL'); } };
}
