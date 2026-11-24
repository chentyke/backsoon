import { catalogs } from './web/i18n.js';
import { setupStatus } from './onboarding.js';
import { msg } from './locale.js';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import crypto, { createHash } from 'node:crypto';
import { setRules } from './setup.js';
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
  'app', 'onboarding', 'celebrate', 'glyphs', 'i18n', 'language', 'motion', 'task-list', 'task-view', 'task-window', 'window-motion',
  ...Object.keys(catalogs),
];
const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/setup', ['onboarding.html', 'text/html']],
  ...panelModules.map((name) => ['/' + name + '.js', [name + '.js', 'text/javascript']]),
  ['/task.js', ['../task.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ...['mark', 'mark-dark', 'mark-mono', 'logo', 'logo-dark'].map((name) => [
    '/brand/' + name + '.svg',
    ['../../brand/' + name + '.svg', 'image/svg+xml'],
  ]),
]);
function readBody(req, limit = 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > limit) reject(Error('Request too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}
function sendJson(res, code, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  }).end(body);
}
// The guide's only write: add or remove the BackSoon block in AGENTS.md.
// A page on another site cannot reach it: the Host and Origin must be this
// server, the JSON body and custom headers force a CORS preflight that is
// never answered, and the token only exists in the guide's own URL fragment.
async function changeRules(req, res, token, readStatus) {
  const self = ['http://127.0.0.1:' + req.socket.localPort, 'http://localhost:' + req.socket.localPort];
  const sent = String(req.headers['x-backsoon-token'] || '');
  if (!self.includes(req.headers.origin) || req.headers['x-backsoon-guide'] !== '1' ||
      !/^application\/json\b/.test(req.headers['content-type'] || '') ||
      sent.length !== token.length || !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token)))
    return res.writeHead(403).end();
  let enabled, locale;
  try {
    ({ enabled, locale } = JSON.parse(await readBody(req)));
  } catch {
    return res.writeHead(400).end();
  }
  if (typeof enabled !== 'boolean' || !Object.hasOwn(catalogs, locale)) return res.writeHead(400).end();
  try {
    await setRules(enabled, undefined, locale);
  } catch (error) {
    return sendJson(res, 409, { error: error.message });
  }
  sendJson(res, 200, await readStatus(true));
}
async function handle(req, res, onboarding, readStatus, token) {
  const host = req.headers.host,
    port = req.socket.localPort;
  if (host !== '127.0.0.1:' + port && host !== 'localhost:' + port) {
    res.writeHead(403).end();
    return;
  }
  if (onboarding && req.url === '/api/rules') {
    if (req.method !== 'POST') return res.writeHead(405, { Allow: 'POST' }).end();
    return changeRules(req, res, token, readStatus).catch(() => res.writeHead(500).end());
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
    if (onboarding && !asset && route !== '/api/setup') return res.writeHead(404).end();
    if (!onboarding && route === '/setup') return res.writeHead(404).end();
    let body, type;
    if (asset) {
      type = asset[1];
      body = fs.readFileSync(new URL('./web/' + asset[0], import.meta.url));
    } else {
      type = 'application/json';
      let data;
      if (onboarding && route === '/api/setup') {
        if (req.headers['x-backsoon-guide'] !== '1') return res.writeHead(403).end();
        data = await readStatus();
      } else if (route === '/api/tasks' || chat) data = tasks(chat?.[2]);
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
export async function serve(port, { onboarding = false } = {}) {
  let idle, pending;
  // After a write, wait for any check already in flight, then read afresh.
  const readStatus = async (fresh = false) => {
    if (fresh) await pending?.catch(() => {});
    return pending ??= setupStatus().finally(() => { pending = null; });
  };
  const token = crypto.randomBytes(16).toString('hex');
  const server = http.createServer((req, res) => {
    idle?.refresh();
    void handle(req, res, onboarding, readStatus, token);
  });
  server.listen(port, '127.0.0.1');
  try {
    await once(server, 'listening');
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    throw Error(msg('portBusy', { port }));
  }
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  if (onboarding) {
    idle = setTimeout(() => server.close(), 30 * 60 * 1000);
    return url + 'setup#' + token;
  }
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
