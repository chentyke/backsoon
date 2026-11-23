import { catalogs } from './web/i18n.js';
import { msg } from './locale.js';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  home,
  records,
  folder,
  status,
  taskId,
  tail,
  detached,
  identity,
  optional,
  save,
  withFileLock,
} from './store.js';

const panelDir = () =>
  path.resolve(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'backsoon');
const projects = () => path.join(panelDir(), 'projects');
const panelFile = () => path.join(panelDir(), 'panel.json');
export function registerRoot(root) {
  fs.mkdirSync(projects(), { recursive: true, mode: 0o700 });
  const name = createHash('sha256').update(root).digest('hex');
  try {
    fs.symlinkSync(root, path.join(projects(), name));
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}
function roots() {
  return fs
    .readdirSync(projects())
    .map((n) => path.join(projects(), n))
    .filter((p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory());
}
function find(id) {
  for (const root of roots()) {
    if (taskId.test(id) && fs.existsSync(path.join(root, id, 'task.json'))) return folder(id, root);
  }
  throw Error(msg('noTask'));
}
function tasks(chat) {
  const result = [];
  for (const root of roots())
    for (const dir of records(root)) {
      try {
        const task = status(dir);
        if (!chat || task.thread === chat) result.push(task);
      } catch {
        /* Another project may have removed its records. */
      }
    }
  return result.sort((a, b) => b.started - a.started);
}
export const panelModules = [
  'app', 'glyphs', 'i18n', 'language', 'motion', 'task-list', 'task-view', 'task-window', 'window-motion',
  ...Object.keys(catalogs),
];
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ...panelModules.map((name) => ['/' + name + '.js', [name + '.js', 'text/javascript']]),
  ['/task.js', ['../task.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ...['mark', 'mark-dark', 'mark-mono', 'logo', 'logo-dark'].map((name) => [
    '/brand/' + name + '.svg',
    ['../../brand/' + name + '.svg', 'image/svg+xml'],
  ]),
]);
function handle(req, res) {
  const host = req.headers.host,
    port = req.socket.localPort;
  if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) {
    res.writeHead(403).end();
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405).end();
    return;
  }
  try {
    const route = req.url.split('?')[0];
    const chat = /^\/(api\/)?chats\/([A-Za-z0-9_-]{1,128})$/.exec(route);
    const job = /^\/(api\/)?tasks\/([a-f0-9]{12})$/.exec(route);
    const logs = /^\/api\/logs\/([a-f0-9]{12})$/.exec(route);
    const asset = assets.get((chat && !chat[1]) || (job && !job[1]) ? '/' : route);
    let body, type;
    if (asset) {
      type = asset[1];
      body = fs.readFileSync(new URL('./web/' + asset[0], import.meta.url));
    } else {
      type = 'application/json';
      let data;
      if (route === '/api/tasks' || chat) data = tasks(chat?.[2]);
      else if (job) data = [status(find(job[2]))];
      else if (logs) data = tail(find(logs[1]));
      else {
        res.writeHead(404).end();
        return;
      }
      body = Buffer.from(JSON.stringify(data));
    }
    res
      .writeHead(200, {
        'Content-Type': type + '; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
}
function running() {
  const panel = optional(panelFile());
  return panel?.started && identity(panel.pid) === panel.started ? panel.url : null;
}
export async function serve(port) {
  const server = http.createServer(handle);
  server.listen(port, '127.0.0.1');
  try {
    await once(server, 'listening');
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    throw Error(msg('portBusy', { port }));
  }
  const url = 'http://127.0.0.1:' + port + '/';
  try {
    save(panelFile(), { pid: process.pid, started: identity(process.pid), url });
  } catch (e) {
    server.close();
    throw e;
  }
  return url;
}
export async function launch(chat, id) {
  registerRoot(home());
  let route = '';
  if (id) {
    find(id);
    route = 'tasks/' + id;
  } else if (chat) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(chat)) throw Error(msg('badChat'));
    route = 'chats/' + chat;
  }
  const port = Number(process.env.BACKSOON_PORT || 47174);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error(msg('badPort'));
  const url = await withFileLock(
    path.join(panelDir(), 'panel-start.lock'),
    () => running() || detached(['_serve', String(port)]),
  );
  return url + route;
}
