import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { entry, identity, read } from '../src/store.js';

export const exec = promisify(execFile);
export async function until(get, message = 'Timed out waiting for the test condition') {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    const result = await get();
    if (result) return result;
    await sleep(45);
  }
  throw Error(message);
}
export async function port() {
  const server = net.createServer();
  await new Promise((yes, no) => server.once('error', no).listen(0, '127.0.0.1', yes));
  const number = server.address().port;
  await new Promise((yes) => server.close(yes));
  return number;
}
export function sandbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backsoon-test-'));
  const env = {
    ...process.env,
    BACKSOON_LANG: 'en',
    BACKSOON_HOME: path.join(dir, 'tasks'),
    XDG_STATE_HOME: path.join(dir, 'state'),
    CODEX_THREAD_ID: 'origin',
    BACKSOON_REMOTE: 'unix:///unused',
    PATH: dir + path.delimiter + process.env.PATH,
    CAPTURE: path.join(dir, 'queue.jsonl'),
  };
  delete env.CODEX_APP_TOOLS_PIPE_PATH;
  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
  write(
    'codex',
    '#!' +
      process.execPath +
      "\nconst fs = require('node:fs');\n" +
      "if (process.argv[2]!=='queue') process.exit(2);\n" +
      "fs.appendFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2))+'\\n');\n" +
      "console.error(process.env.QUEUE_REPLY || '');process.exit(Number(process.env.QUEUE_CODE || 0));",
  );
  fs.chmodSync(path.join(dir, 'codex'), 0o700);
  const panelFile = path.join(env.XDG_STATE_HOME, 'backsoon/panel.json');
  t.after(async () => {
    for (const tasks of [path.join(dir, 'tasks'), path.join(dir, '.backsoon')]) {
      for (const id of fs.existsSync(tasks) ? fs.readdirSync(tasks) : []) {
        const file = path.join(tasks, id, 'task.json');
        if (!fs.existsSync(file)) continue;
        const task = read(file);
        if (!task.ended) fs.writeFileSync(path.join(tasks, id, 'stop'), '');
        await until(() => identity(task.worker_pid) !== task.worker_start);
      }
    }
    if (fs.existsSync(panelFile)) {
      try {
        process.kill(read(panelFile).pid);
      } catch {}
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const cli = (...args) =>
    exec(entry, args, { cwd: dir, env, timeout: 10000 }).then((v) => v.stdout.trim());
  const state = (id) => JSON.parse(fs.readFileSync(path.join(env.BACKSOON_HOME, id, 'task.json')));
  const ended = (id) =>
    until(() => {
      const s = state(id);
      return s.ended && s;
    });
  const calls = () =>
    fs.existsSync(env.CAPTURE)
      ? fs
          .readFileSync(env.CAPTURE, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((s) => JSON.parse(s))
      : [];
  return { dir, env, write, cli, state, ended, calls, panelFile };
}
