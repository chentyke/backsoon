import { isActive, taskPercent } from './task.js';
import { msg } from './locale.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

export const entry = fileURLToPath(new URL('../backsoon', import.meta.url));
export const taskId = /^[a-f0-9]{12}$/;
export const now = () => Date.now() / 1000;
export function home() {
  const dir = path.resolve(process.env.BACKSOON_HOME || '.backsoon');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (path.basename(dir) === '.backsoon') {
    try {
      fs.writeFileSync(path.join(dir, '.gitignore'), '*\n', { flag: 'wx' });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  return dir;
}
export function save(file, data) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
export const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
export function optional(file) {
  try {
    return read(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return null;
  }
}

const require = createRequire(import.meta.url);
let procInfo, flock;
export async function withFileLock(file, operation) {
  const koffi = require('koffi');
  flock ??= koffi.load(null).func('int flock(int, int)');
  const fd = fs.openSync(file, 'a', 0o600);
  try {
    // LOCK_EX | LOCK_NB. Closing the descriptor also releases it after a crash.
    while (flock(fd, 2 | 4) !== 0) {
      const code = koffi.errno();
      if (![os.constants.errno.EAGAIN, os.constants.errno.EINTR].includes(code))
        throw Error(msg('lockError', { code }));
      await sleep(30);
    }
    return await operation();
  } finally {
    fs.closeSync(fd);
  }
}
// Include the start time so that a recycled PID cannot be mistaken for the observed command.
export function identity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error(msg('badPid'));
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return fields[0] === 'Z'
        ? null
        : fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() + ':' + fields[19];
    } catch (e) {
      if (['ENOENT', 'ESRCH'].includes(e.code)) return null;
      throw e;
    }
  }
  if (process.platform !== 'darwin') throw Error(msg('platform'));
  const koffi = require('koffi');
  procInfo ??= koffi
    .load('/usr/lib/libproc.dylib')
    .func('int proc_pidinfo(int, int, uint64_t, void *, int)');
  // Darwin PROC_PIDTBSDINFO, from sys/proc_info.h. Start time has microsecond precision.
  const info = Buffer.alloc(136);
  if (procInfo(pid, 3, 0, info, info.length) !== info.length) {
    if (koffi.errno() === os.constants.errno.ESRCH) return null;
    throw Error(msg('pidError', { pid, code: koffi.errno() }));
  }
  return info.readUInt32LE(4) === 5 ? null : info.readBigUInt64LE(120) + ':' + info.readBigUInt64LE(128);
}
export function folder(id, root = home()) {
  if (!taskId.test(id)) throw Error(msg('badTask'));
  const dir = path.join(root, id);
  if (
    !fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory() ||
    !fs.existsSync(path.join(dir, 'task.json'))
  )
    throw Error(msg('noTask'));
  return dir;
}
export function status(dir) {
  const file = path.join(dir, 'task.json');
  let task = read(file);
  if (isActive(task.status) && (!task.worker_pid || identity(task.worker_pid) !== task.worker_start)) {
    const updated = read(file);
    if (updated.worker_pid === task.worker_pid && isActive(updated.status))
      updated.status = 'interrupted';
    task = updated;
  }
  task.percent = taskPercent(task);
  task.notice = optional(path.join(dir, 'notice.json'));
  return task;
}
export function records(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && taskId.test(d.name))
    .map((d) => path.join(root, d.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'task.json')));
}
export function tail(dir, limit = 80) {
  let lines = [];
  for (const name of ['output.log', 'output.prev']) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) continue;
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const bytes = Buffer.alloc(Math.min(size, 65536));
      const count = fs.readSync(fd, bytes, 0, bytes.length, size - bytes.length);
      const batch = bytes.subarray(0, count).toString().split('\n');
      if (size > bytes.length) batch.shift();
      if (batch.at(-1) === '') batch.pop();
      lines = batch.concat(lines);
    } finally {
      fs.closeSync(fd);
    }
    if (lines.length >= limit) break;
  }
  return lines.slice(-limit);
}
export function detached(args) {
  return new Promise((resolve, reject) => {
    const child = fork(entry, args, {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      execArgv: [],
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(Error(msg('startupError', { code }))));
    child.once('message', (msg) => {
      child.disconnect();
      child.unref();
      if (msg.error) reject(Error(msg.error));
      else resolve(msg.value);
    });
  });
}
