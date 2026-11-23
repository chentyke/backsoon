import fs from 'node:fs';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { identity } from './store.js';

const require = createRequire(import.meta.url);
let darwin;
function mac() {
  if (!darwin) {
    const koffi = require('koffi'), proc = koffi.load('/usr/lib/libproc.dylib');
    darwin = {
      sysctl: koffi.load(null).func('int sysctl(void *, unsigned int, void *, void *, void *, size_t)'),
      info: proc.func('int proc_pidinfo(int, int, uint64_t, void *, int)'),
      fdinfo: proc.func('int proc_pidfdinfo(int, int, int, void *, int)'),
      path: proc.func('int proc_pidpath(int, void *, uint32_t)'),
    };
  }
  return darwin;
}
function stringAt(buffer, start) {
  const end = buffer.indexOf(0, start);
  return end < start ? '' : buffer.toString('utf8', start, end);
}

function macArgs(pid) {
  // KERN_PROCARGS2 contains argc, the executable path, padding, argv, then the environment.
  const mib = new Int32Array([1, 49, pid]), size = new BigUint64Array(1);
  const { sysctl } = mac();
  if (sysctl(mib, 3, null, size, null, 0) !== 0 || size[0] < 5n) return [];
  const buffer = Buffer.alloc(Number(size[0]));
  if (sysctl(mib, 3, buffer, size, null, 0) !== 0) return [];
  const bytes = buffer.subarray(0, Number(size[0]));
  const argc = bytes.readInt32LE();
  let offset = bytes.indexOf(0, 4);
  if (offset < 0) return [];
  while (offset < bytes.length && bytes[offset] === 0) offset++;
  const args = [];
  for (let i = 0; i < argc; i++) {
    const end = bytes.indexOf(0, offset);
    if (end < offset) return [];
    args.push(bytes.toString('utf8', offset, end));
    offset = end + 1;
  }
  return args;
}

function optional(read) {
  try { return read(); } catch (error) {
    if (['ENOENT','ESRCH','EACCES','EPERM','ENOTDIR'].includes(error.code)) return null;
    throw error;
  }
}
function outputFile(pid, fd) {
  let file, dev, ino;
  if (process.platform === 'linux') {
    const descriptor = '/proc/' + pid + '/fd/' + fd;
    const st = fs.statSync(descriptor, { bigint: true });
    if (!st.isFile()) return null;
    file = fs.readlinkSync(descriptor);
    ({ dev, ino } = st);
  } else {
    // PROC_PIDFDVNODEPATHINFO: vnode_fdinfowithpath in sys/proc_info.h.
    const b = Buffer.alloc(1200);
    if (mac().fdinfo(pid, fd, 2, b, b.length) !== b.length ||
        (b.readUInt16LE(28) & 0o170000) !== 0o100000) return null;
    file = stringAt(b, 176);
    dev = BigInt(b.readUInt32LE(24));
    ino = b.readBigUInt64LE(32);
  }
  if (!file.startsWith('/')) return null;
  const st = fs.statSync(file, { bigint:true });
  if (st.dev !== dev || st.ino !== ino || !st.isFile()) return null;
  return { fd, file, dev: String(dev), ino: String(ino), offset: Number(st.size) };
}

export function processDetails(pid) {
  let argv, cwd;
  if (process.platform === 'linux') {
    const raw = optional(() => fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8'));
    argv = raw ? raw.replace(/\0$/, '').split('\0') : [];
    if (!argv.length) {
      const executable = optional(() => fs.readlinkSync('/proc/' + pid + '/exe'));
      if (executable) argv = [executable];
    }
    cwd = optional(() => fs.readlinkSync('/proc/' + pid + '/cwd'));
  } else {
    argv = macArgs(pid);
    if (!argv.length) {
      const buf = Buffer.alloc(4096);
      if (mac().path(pid, buf, buf.length) > 0) argv = [stringAt(buf, 0)];
    }
    // PROC_PIDVNODEPATHINFO: first vnode_info_path describes the working directory.
    const b = Buffer.alloc(2352);
    if (mac().info(pid, 9, 0, b, b.length) === b.length) cwd = stringAt(b, 152);
  }
  const files = [];
  for (const fd of [1, 2]) {
    const source = optional(() => outputFile(pid, fd));
    if (source && !files.some(f => f.dev === source.dev && f.ino === source.ino)) files.push(source);
  }
  return { argv, cwd, files };
}

function openLog(source) {
  let handle;
  try {
    handle = fs.openSync(source.file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(handle, { bigint:true });
    if (st.isFile() && String(st.dev) === source.dev && String(st.ino) === source.ino)
      return { ...source, handle, stream: source.fd === 1 ? process.stdout : process.stderr };
  } catch { /* An unavailable log must not stop process observation. */ }
  if (handle != null) fs.closeSync(handle);
  return null;
}

export async function observe(task) {
  const logs = (task.output_files || []).map(openLog).filter(Boolean);
  const buffer = Buffer.alloc(65536);
  try {
    for (;;) {
      const running = identity(task.attached_pid) === task.process_start;
      for (const log of logs) {
        if (log.disabled) continue;
        const size = fs.fstatSync(log.handle).size;
        if (size < log.offset) log.offset = 0;
        while (log.offset < size) {
          const length = fs.readSync(log.handle, buffer, 0, Math.min(buffer.length, size - log.offset), log.offset);
          if (!length) break;
          log.offset += length;
          const chunk = buffer.subarray(0, length);
          if (chunk.includes(0)) { log.disabled = true; break; }
          if (!log.stream.write(Buffer.from(chunk))) await once(log.stream, 'drain');
        }
      }
      if (!running) break;
      await sleep(350);
    }
  } finally {
    for (const log of logs) fs.closeSync(log.handle);
  }
}
