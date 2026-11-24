// BackSoon landing page: the panel's own motion system, driven by a scripted demo.
import { CATALOGS, LOCALES, NAMES, PANEL, negotiate } from './i18n.js?v=2';
document.documentElement.classList.add('js');

// motion: springs sampled into css linear() so waapi and transitions share one curve
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const still = () => reduce.matches;
const linearOk = CSS.supports('transition-timing-function', 'linear(0, 1)');
const EASE_OUT = 'cubic-bezier(.22, 1, .36, 1)';
function spring(duration, bounce = 0) {
  const zeta = 1 - bounce, w = 2 * Math.PI / duration;
  const wd = w * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
  const x = t => zeta < 1 ? 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + zeta * w / wd * Math.sin(wd * t)) :
    1 - Math.exp(-w * t) * (1 + w * t);
  const envelope = t => zeta < 1 ? Math.exp(-zeta * w * t) * Math.hypot(1, zeta * w / wd) : Math.exp(-w * t) * (1 + w * t);
  let end = duration;
  while (envelope(end) > 0.002 && end < duration * 4) end += 0.01;
  if (!linearOk) return { duration: Math.round(duration * 1000), easing: EASE_OUT };
  const steps = Math.max(24, Math.round(end * 64));
  const points = Array.from({ length: steps + 1 }, (_, i) => i === steps ? 1 : +x(end * i / steps).toFixed(4));
  return { duration: Math.round(end * 1000), easing: 'linear(' + points.join(', ') + ')' };
}
const OPEN = spring(.44, .14);
const CLOSE = spring(.36, .04);
const ICON = spring(.55, .32);
const REORDER = spring(.38, .14);
const BAR = spring(.7, .08);
document.documentElement.style.setProperty('--bar-ease', BAR.easing);
document.documentElement.style.setProperty('--bar-dur', BAR.duration + 'ms');
const RISE = [{ opacity: 0, transform: 'translateY(10px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }];

function swapText(el, text, animate = true) {
  if (el.textContent === text) return;
  el.textContent = text;
  if (!animate || still() || !el.isConnected || !text) return;
  el.animate([{ opacity: 0, transform: 'translateY(5px)', filter: 'blur(3px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }],
    { duration: 360, easing: EASE_OUT });
}
function tween(el, to, format, ms = 650) {
  const from = el._value;
  el._value = to;
  cancelAnimationFrame(el._raf);
  if (to == null || from == null || from === to || still()) { el.textContent = format(to); return; }
  const start = performance.now();
  const step = now => {
    const k = Math.min(1, (now - start) / ms);
    el.textContent = format(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

// glyphs: the panel's drawings, one per scenario on a 24 unit grid
const ring = '<circle class="g-track" cx="12" cy="12" r="9"/>';
const GLYPHS = {
  progress: ring + '<circle class="g-arc" cx="12" cy="12" r="9" pathLength="100" transform="rotate(-90 12 12)"/>',
  spin: ring + '<g class="g-spin"><circle cx="12" cy="12" r="9" pathLength="100" class="g-arc g-short"/></g>',
  starting: '<circle class="g-dash g-rotate" cx="12" cy="12" r="9" stroke-dasharray="1.4 4.25"/><circle class="g-solid g-pulse" cx="12" cy="12" r="3.2"/>',
  waiting: ring + '<g class="g-breathe"><line class="g-line" x1="10" y1="9" x2="10" y2="15"/><line class="g-line" x1="14" y1="9" x2="14" y2="15"/></g>',
  needsInput: '<circle class="g-solid g-halo" cx="12" cy="12" r="10"/><circle class="g-fill" cx="12" cy="12" r="10"/><path class="g-mark" d="M12 7.2v6"/><circle class="g-ink" cx="12" cy="16.6" r="1.35"/>',
  overtime: ring + '<path class="g-line" d="M12 7.5V12"/><path class="g-line g-hand" d="M12 12l3.2 1.8"/>',
  checks: '<circle class="g-dash g-rotate" cx="12" cy="12" r="9" stroke-dasharray="1 3.35"/><path class="g-line" d="M8.2 12.3l2.6 2.5 5-5.4"/>',
  succeeded: '<circle class="g-fill" cx="12" cy="12" r="10"/><path class="g-mark" pathLength="1" d="M7.6 12.4l3 3 5.8-6.4"/>',
  resolved: '<circle class="g-dash g-thin" cx="12" cy="12" r="11.4" stroke-dasharray="1 2.58"/><circle class="g-fill" cx="12" cy="12" r="8.6"/><path class="g-mark" pathLength="1" d="M8.4 12.3l2.4 2.4 4.8-5.2"/>',
  failed: '<circle class="g-fill" cx="12" cy="12" r="10"/><path class="g-mark" d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4"/>',
  interrupted: '<circle class="g-fill" cx="12" cy="12" r="10"/><path class="g-mark" d="M12.8 6.6 9 12.6h4.4l-2.4 5"/>',
  stopped: '<circle class="g-fill" cx="12" cy="12" r="10"/><rect class="g-ink" x="8.6" y="8.6" width="6.8" height="6.8" rx="1.4"/>',
};
function setGlyph(box, key, animate = true) {
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const old = box.querySelector('.g:not([data-leaving])');
  const next = h('span', 'g');
  next.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + GLYPHS[key] + '</svg>';
  box.append(next);
  if (!old) return;
  if (!animate || still()) { old.remove(); return; }
  old.dataset.leaving = '';
  old.animate([{ opacity: 1, transform: 'none', filter: 'blur(0px)' }, { opacity: 0, transform: 'scale(.5) rotate(30deg)', filter: 'blur(4px)' }],
    { duration: 180, easing: 'ease-in', fill: 'forwards' }).finished.then(() => old.remove(), () => old.remove());
  next.animate([{ opacity: 0, transform: 'scale(.5) rotate(-30deg)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }],
    { ...ICON, fill: 'backwards' });
  const svg = next.querySelector('svg');
  if (key === 'succeeded' || key === 'resolved') {
    svg.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 420, easing: EASE_OUT, delay: 80 });
    next.querySelector('.g-fill').animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 280, easing: EASE_OUT, fill: 'backwards' });
    const mark = next.querySelector('.g-mark');
    mark.style.strokeDasharray = '1';
    mark.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 300, delay: 140, easing: EASE_OUT, fill: 'backwards' });
  } else if (key === 'failed' || key === 'interrupted') {
    next.querySelector('.g-mark').animate([0, -2.5, 2.5, -1.6, 1.6, 0].map(x => ({ transform: 'translateX(' + x + 'px)' })),
      { duration: 460, delay: 120 });
  }
}

// rows
function makeRow(tag) {
  const row = h(tag, 'card');
  if (tag === 'button') row.type = 'button';
  row.innerHTML = '<span class="summary"><span class="glyph"></span>' +
    '<span class="identity"><strong></strong><span class="meta"><span class="status"></span><span class="duration"></span><span class="context"></span></span></span>' +
    '<span class="aside"><span class="measurement"><span class="track"><span class="fill"></span></span><span class="pct"></span></span>' +
    '<span class="pips"></span><span class="outcome"></span></span></span>';
  return row;
}
const pctText = p => p == null ? '' : Math.round(p * 100) + '%';
function paintPips(box, checks, animate) {
  if (!checks) { box.replaceChildren(); return; }
  let count = box.querySelector('.pips-count');
  if (!count) { count = h('span', 'pips-count'); box.append(count); }
  const pips = [...box.querySelectorAll('.pip')];
  checks.forEach((state, i) => {
    let pip = pips[i];
    if (!pip) { pip = h('span', 'pip'); box.insertBefore(pip, count); }
    if (pip.dataset.state !== state && pip.dataset.state && animate && !still() && state !== 'running')
      pip.animate([{ transform: 'scale(1.8)' }, { transform: 'scale(1)' }], ICON);
    pip.dataset.state = state;
  });
  const done = checks.filter(s => s === 'succeeded' || s === 'failed').length;
  swapText(count, done + '/' + checks.length, animate);
}
function paintRow(row, s, animate = true) {
  row.dataset.tone = s.tone;
  row.dataset.layout = s.layout;
  row.dataset.active = String(Boolean(s.active));
  setGlyph(row.querySelector('.glyph'), s.glyph, animate);
  row.querySelector('strong').textContent = s.name;
  swapText(row.querySelector('.status'), s.status, animate);
  swapText(row.querySelector('.context'), s.context || '', animate);
  row.querySelector('.duration').textContent = s.duration;
  row.style.setProperty('--p', String(s.p ?? 0));
  tween(row.querySelector('.pct'), s.p == null ? null : s.p, pctText);
  paintPips(row.querySelector('.pips'), s.layout === 'checks' ? s.checks : null, animate);
  row.querySelector('.outcome').textContent = s.outcome || '';
}


// language: ?lang= first, then the saved choice, then the browser's preferences
const store = {
  get() { try { return localStorage.getItem('backsoon-site-language'); } catch { return null; } },
  set(v) { try { localStorage.setItem('backsoon-site-language', v); } catch {} },
};
const fromUrl = new URLSearchParams(location.search).get('lang');
let locale = LOCALES.includes(fromUrl) ? fromUrl : LOCALES.includes(store.get()) ? store.get() : negotiate(navigator.languages);
let T = CATALOGS[locale];
const t = (key, vars = {}) => (T[key] ?? PANEL[locale][key] ?? CATALOGS.en[key] ?? PANEL.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

const elapsed = sec => {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return t('seconds', { s });
  if (s < 3600) return t('minutes', { m: Math.floor(s / 60), s: s % 60 });
  return t('hours', { h: Math.floor(s / 3600), m: Math.floor(s / 60) % 60 });
};
const clock = date => date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const ago = minutes => clock(new Date(Date.now() - minutes * 60000));

// demo: a scripted afternoon of background tasks (program output stays as programs print it)
const LOGS = {
  build: ['Build settings from command line:', '    CONFIGURATION = Release', 'CompileSwift normal arm64 Sources/App/TaskList.swift',
    'CompileSwift normal arm64 Sources/App/Window.swift', 'CompileSwift normal arm64 Sources/App/Springs.swift',
    'CompileAssetCatalog Assets.xcassets', 'Ld BackSoon.app/Contents/MacOS/BackSoon', 'CodeSign BackSoon.app'],
  checks: ['lint\tpass\t12s', 'typecheck\tpass\t41s', 'unit (1/3)\tpass\t1m 02s', 'unit (2/3)\tpass\t58s', 'unit (3/3)\tpass\t1m 06s',
    'e2e (1/2)\tpass\t2m 11s', 'e2e (2/2)\tfail\t2m 40s', 'build\tpass\t1m 30s'],
  deploy: ['Approval received', 'Uploading build 1.4.0 (38 MB)', 'Migrating database: 3 pending', 'Rolling out 1/3 instances',
    'Rolling out 2/3 instances', 'Rolling out 3/3 instances', 'Health check passed'],
  e2e: ['Running 480 tests using 6 workers', '  ✓ [chromium] › panel.spec.js › lists running tasks', '  ✓ [chromium] › panel.spec.js › opens the task window',
    '  ✓ [webkit] › panel.spec.js › folds back into the row', '  ✓ [firefox] › i18n.spec.js › switches language', '  ✓ [webkit] › i18n.spec.js › keeps the saved choice'],
};
const FINAL = { build: '** BUILD SUCCEEDED **', checks: 'Some checks were not successful', deploy: 'Deployed to staging', e2e: '480 passed (2.1m)' };
const CWD = '~/code/backsoon-app';
const THREAD = '019a7c3e-5d21-7b4e-9f0a-2c6d8e1b4a57';
const CHECK_NAMES = [['lint'], ['typecheck'], ['unit (1/3)', 'unit'], ['unit (2/3)', 'unit'], ['unit (3/3)', 'unit'], ['e2e (1/2)', 'e2e'], ['e2e (2/2)', 'e2e'], ['build']];
const checkList = states => CHECK_NAMES.map(([name, group], i) => ({ kind: 'checks', name, group: group || name, state: states[i] }));

function freshTasks() {
  return [
    { id: 'build', key: '3f9c2e17b04a', name: 'nBuild', cmd: 'xcodebuild -scheme BackSoon -configuration Release build', status: 'running', p: .2, rate: 60, t: 188, log: LOGS.build.slice(0, 3) },
    { id: 'checks', key: 'c41d08e2a9f3', name: 'nChecks', cmd: 'gh pr checks 42 --watch --interval 30', status: 'running', t: 241,
      activities: checkList(['succeeded', 'succeeded', 'succeeded', 'running', 'running', 'inQueue', 'inQueue', 'inQueue']), log: LOGS.checks.slice(0, 3) },
    { id: 'deploy', key: '8b2e5f0c71d6', name: 'nDeploy', cmd: './scripts/deploy.sh staging', status: 'running', t: 72, rate: 45, blocker: 'approval', log: ['Waiting for approval: staging'] },
    { id: 'e2e', key: 'e07a3c9d52b1', name: 'nE2e', cmd: 'npx playwright test', status: 'starting', t: 1, rate: 55, log: [] },
    { id: 'weights', key: '5d9f1a3e8c20', name: 'nWeights', cmd: 'curl -fLO https://example.com/models/weights.bin', status: 'succeeded', t: 452, code: 0, ended: ago(9),
      log: ['100  4.2G  100  4.2G    0     0  9611k      0  0:07:32  0:07:32 --:--:-- 9.8M'] },
    { id: 'unit', key: 'a6c8e2f4b193', name: 'nUnit', cmd: 'npm test', status: 'failed', t: 97, code: 1, ended: ago(23),
      log: ['# tests 38', '# pass 37', '# fail 1', 'not ok 12 - delivers to the active turn'] },
  ];
}

// every situation side by side; these rows open the same window as the live ones
function galleryTasks() {
  return [
    ['capProgress', { id: 'g-progress', key: '1b7d4e9a2c05', name: 'nBuild', cmd: 'xcodebuild -scheme BackSoon build', status: 'running', p: .62, rate: 60, t: 252, stage: 'sLink', log: LOGS.build.slice(2, 7) }],
    ['capSpin', { id: 'g-spin', key: '6e2a9c1f7d38', name: 'nUpload', cmd: 'gh release upload v1.4.0 release.zip', status: 'running', p: null, t: 38, stage: 'release.zip', log: ['Uploading release.zip (38 MB)'] }],
    ['capStarting', { id: 'g-starting', key: '9c4f2b8e0a61', name: 'nE2e', cmd: 'npx playwright test', status: 'starting', t: 2, log: [] }],
    ['capChecks', { id: 'g-checks', key: '2d8b6f3a9e14', name: 'nChecks', cmd: 'gh pr checks 42 --watch --interval 30', status: 'running', t: 363,
      activities: checkList(['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded', 'running', 'running', 'inQueue']), log: LOGS.checks.slice(0, 5) }],
    ['capWaiting', { id: 'g-waiting', key: '7a1e5c9d3b82', name: 'nDeploy', cmd: './scripts/deploy.sh staging', status: 'running', t: 72, blocker: 'approval', log: ['Waiting for approval: staging'] }],
    ['capInput', { id: 'g-input', key: '4f6c0a2e8d97', name: 'nMigrate', cmd: './scripts/migrate.sh --plan', status: 'running', t: 220,
      activities: [{ kind: 'steps', name: 'stepPlan', state: 'succeeded' }, { kind: 'steps', name: 'stepConfirm', state: 'needsInput', detail: 'confirmDetail' },
        { kind: 'steps', name: 'stepApply', state: 'inQueue' }], log: ['Planned 3 migrations', 'Waiting for confirmation'] }],
    ['capOvertime', { id: 'g-overtime', key: '0e9b3d7f1a46', name: 'nExport', cmd: 'node scripts/export.mjs --nightly', status: 'running', p: .81, rate: 400, t: 1928, warned: true, warnAfter: 1800,
      log: ['Exported 8,100 of 10,000 records'] }],
    ['capDone', { id: 'g-done', key: '5d9f1a3e8c20', name: 'nWeights', cmd: 'curl -fLO https://example.com/models/weights.bin', status: 'succeeded', t: 452, code: 0, ended: ago(9),
      log: ['100  4.2G  100  4.2G    0     0  9611k      0  0:07:32  0:07:32 --:--:-- 9.8M'] }],
    ['capResolved', { id: 'g-resolved', key: 'b3e7a1c5f902', name: 'nFlaky', cmd: 'npm run test:integration', status: 'resolved', t: 700, code: 1, reason: 'verifiedReason', ended: ago(31),
      log: ['# tests 212', '# fail 1', 'not ok 87 - reconnects after a dropped socket'] }],
    ['capFailed', { id: 'g-failed', key: 'a6c8e2f4b193', name: 'nUnit', cmd: 'npm test', status: 'failed', t: 97, code: 1, ended: ago(23),
      log: ['# tests 38', '# pass 37', '# fail 1', 'not ok 12 - delivers to the active turn'] }],
    ['capInterrupted', { id: 'g-interrupted', key: 'f18c6e4a2d73', name: 'nDocker', cmd: 'docker build -t backsoon-app .', status: 'interrupted', t: 291, ended: ago(47),
      log: ['#12 [build 4/7] RUN npm ci', '#12 41.2 npm warn deprecated inflight@1.0.6'] }],
    ['capStopped', { id: 'g-stopped', key: 'c9a2f7e1b058', name: 'nTail', cmd: "tail -n 0 -F app.log", status: 'stopped', t: 3482, ended: ago(64),
      log: ['GET /health 200 2ms', 'GET /api/tasks 200 14ms'] }],
  ];
}

const ACTIVE = new Set(['running', 'starting']);
const ENDED = { succeeded: ['succeeded', 'green'], failed: ['failed', 'red'], resolved: ['resolved', 'teal'], interrupted: ['interrupted', 'orange'], stopped: ['stopped', 'grey'] };
const PRIORITY = { needsInput: 0, failed: 1, running: 2, pendingCheck: 3, inQueue: 4 };
const FINISHED = new Set(['succeeded', 'skipped', 'stopped', 'failed']);
const ordered = items => [...items].sort((a, b) => (PRIORITY[a.state] ?? 5) - (PRIORITY[b.state] ?? 5));
const phrase = key => key in CATALOGS.en || key in PANEL.en ? t(key) : key;
const stageText = task => task.stage ? (task.stageVars ? t(task.stage, task.stageVars) : phrase(task.stage)) : '';
const checksOf = task => (task.activities || []).length && task.activities.every(item => item.kind === 'checks') ? task.activities : null;

function scenario(task) {
  const base = { name: t(task.name), duration: elapsed(task.t), p: task.p };
  if (!ACTIVE.has(task.status)) {
    const [glyph, tone] = ENDED[task.status];
    return { ...base, glyph, tone, status: t(task.status), layout: 'outcome', outcome: task.ended, p: null,
      context: task.status === 'failed' && task.code ? t('exitCtx', { code: task.code }) : '' };
  }
  const checks = checksOf(task);
  const layout = checks ? 'checks' : task.p == null ? 'indeterminate' : 'progress';
  const pick = (glyph, tone, context = '', alert = false) => ({ ...base, glyph, tone, layout, active: true, alert, context,
    status: t(task.status === 'starting' ? 'starting' : 'running'), checks: checks?.map(item => item.state), p: layout === 'progress' ? task.p : null });
  if (task.status === 'starting') return pick('starting', 'blue');
  if ((task.activities || []).some(item => item.state === 'needsInput')) return pick('needsInput', 'amber', t('jobInput'), true);
  if (task.blocker) return pick('waiting', 'amber', t('waitingFor', { reason: t(task.blocker) }), true);
  if (task.warned) return pick('overtime', 'amber', t('overTime'), true);
  if (checks) {
    const failed = checks.some(item => item.state === 'failed');
    const done = checks.filter(item => item.state === 'succeeded').length;
    return pick('checks', failed ? 'red' : 'blue', failed ? t('sCheckFailed') : t('sPassed', { done, total: checks.length }));
  }
  return pick(task.p == null ? 'spin' : 'progress', 'blue', stageText(task));
}

const demo = document.querySelector('#demo');
const lists = { running: demo.querySelector('[data-list=running]'), ended: demo.querySelector('[data-list=ended]') };
const counts = { running: demo.querySelector('[data-count=running]'), ended: demo.querySelector('[data-count=ended]') };
const emptyRunning = demo.querySelector('[data-empty=running]');
const toasts = document.querySelector('.toasts');
const rowEls = new Map();
let tasks = freshTasks();
let finishOrder = ['weights', 'unit'];
let clockT = 0, settleAt = null, demoOn = false;
let current = null, busyMorph = false;

// gallery: every situation side by side, each row opens its window
const gallery = document.querySelector('.gallery');
const SPECIMENS = galleryTasks();
const GALLERY = SPECIMENS.map(([, task]) => task);
function renderGallery() {
  if (!gallery.childElementCount) gallery.append(...SPECIMENS.map(([caption, task]) => {
    const wrap = h('div', 'specimen');
    wrap.append(h('span', 'caption'), rowFor(task));
    wrap.dataset.caption = caption;
    return wrap;
  }));
  for (const wrap of gallery.children) wrap.querySelector('.caption').textContent = t(wrap.dataset.caption);
  for (const task of GALLERY) paintRow(rowFor(task), scenario(task), false);
}

function rowFor(task) {
  let row = rowEls.get(task.id);
  if (!row) {
    row = makeRow('button');
    row.dataset.id = task.id;
    row.setAttribute('aria-haspopup', 'dialog');
    row.addEventListener('click', event => openWindow(task.id, event.detail === 0));
    rowEls.set(task.id, row);
  }
  return row;
}

// lay the rows out in their sections; anything that moves glides there on a spring
function layout(animate) {
  const movers = [...lists.running.children, ...lists.ended.children, emptyRunning, ...demo.querySelectorAll('h3')];
  const before = new Map(animate && !still() ? movers.map(el => [el, el.getBoundingClientRect()]) : []);
  const running = tasks.filter(task => task.status === 'running' || task.status === 'starting');
  const ended = finishOrder.map(id => tasks.find(task => task.id === id)).filter(Boolean);
  lists.running.replaceChildren(...running.map(rowFor));
  lists.ended.replaceChildren(...ended.map(rowFor));
  emptyRunning.hidden = running.length > 0;
  counts.running.textContent = running.length;
  counts.ended.textContent = ended.length;
  for (const task of tasks) paintRow(rowFor(task), scenario(task), animate);
  for (const [el, a] of before) {
    if (!el.isConnected || el.hidden) continue;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) + Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { ...REORDER, composite: 'add' });
  }
  for (const row of [...lists.running.children, ...lists.ended.children])
    if (!before.has(row) && animate && !still()) row.animate(RISE, { duration: 480, easing: EASE_OUT });
  if (animate && !emptyRunning.hidden && !before.get(emptyRunning)?.height) emptyRunning.animate(RISE, { duration: 420, easing: EASE_OUT });
}
const repaintRows = animate => { for (const task of tasks) paintRow(rowFor(task), scenario(task), animate); };

// the result as it lands in the chat: status, exit code, last output
function noticeInto(el, status, code, output) {
  const b = h('b', null, status);
  el.replaceChildren(b, t('exit', { code }) + t('sep') + t('lastOutput') + ' ', h('code', null, output));
}

function toast(task) {
  const s = scenario(task);
  const el = h('div', 'toast');
  el.dataset.tone = s.tone;
  el.innerHTML = '<span class="toast-head"><svg viewBox="0 0 64 64" aria-hidden="true"><use href="#mark"/></svg><span></span><time></time></span><p></p>';
  el.querySelector('.toast-head span').textContent = t('toastFrom');
  el.querySelector('time').textContent = task.ended;
  noticeInto(el.querySelector('p'), s.status, task.code, task.log.at(-1));
  toasts.append(el);
  while (toasts.children.length > 2) toasts.firstElementChild.remove();
  if (!still()) el.animate([{ opacity: 0, transform: 'translateY(16px) scale(.96)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], OPEN);
  setTimeout(() => {
    if (!el.isConnected) return;
    if (still()) { el.remove(); return; }
    el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-8px) scale(.98)', filter: 'blur(4px)' }], { duration: 320, easing: 'ease-in', fill: 'forwards' })
      .finished.then(() => el.remove(), () => el.remove());
  }, 5200);
}

function finish(task, status, code) {
  Object.assign(task, { status, code, ended: clock(new Date()), endedAt: Date.now(), p: null, blocker: null });
  if (FINAL[task.id]) task.log.push(FINAL[task.id]);
  finishOrder.unshift(task.id);
  toast(task);
  return true;
}
const say = (task, line) => { task.log.push(line); if (task.log.length > 40) task.log.shift(); };

function step() {
  clockT += .5;
  let moved = false;
  for (const task of tasks) {
    if (task.status !== 'running' && task.status !== 'starting') continue;
    task.t += .5;
    const n = task.n = (task.n || 0) + 1;
    if (task.id === 'build') {
      task.p = Math.min(1, task.p + .016 * (.5 + Math.random()));
      task.stage = task.p < .5 ? 'sCompile' : task.p < .85 ? 'sLink' : 'sSign';
      if (n % 3 === 0) say(task, LOGS.build[3 + (n / 3) % (LOGS.build.length - 3)]);
      if (task.p >= 1) moved = finish(task, 'succeeded', 0);
    } else if (task.id === 'checks') {
      if (n % 5 === 0) {
        const list = task.activities;
        const i = list.findIndex(item => item.state === 'running');
        if (i >= 0) {
          list[i].state = i === 6 ? 'failed' : 'succeeded';
          say(task, LOGS.checks[i] || 'check\tpass');
          const q = list.find(item => item.state === 'inQueue');
          if (q) q.state = 'running';
        }
        if (!list.some(item => item.state === 'running')) moved = finish(task, 'failed', 1);
      }
    } else if (task.id === 'deploy') {
      if (task.blocker && clockT >= 8) { task.blocker = null; task.p = 0; task.stage = 'sRoll'; say(task, LOGS.deploy[0]); }
      else if (!task.blocker) {
        task.p = Math.min(1, task.p + .022 * (.6 + Math.random() * .8));
        if (n % 4 === 0) say(task, LOGS.deploy[Math.min(LOGS.deploy.length - 1, 1 + Math.floor(task.p * 6))]);
        if (task.p >= 1) moved = finish(task, 'succeeded', 0);
      }
    } else if (task.id === 'e2e') {
      if (task.status === 'starting' && clockT >= 2.5) { task.status = 'running'; task.p = null; task.stage = 'sBrowsers'; say(task, 'Downloading Chromium 131.0'); }
      else if (task.status === 'running' && task.p == null && clockT >= 7) { task.p = 0; say(task, LOGS.e2e[0]); }
      else if (task.p != null) {
        task.p = Math.min(1, task.p + .018 * (.6 + Math.random() * .8));
        task.stage = 'sTests';
        task.stageVars = { n: Math.round(task.p * 480) };
        if (n % 3 === 0) say(task, LOGS.e2e[1 + (n / 3) % (LOGS.e2e.length - 1)]);
        if (task.p >= 1) moved = finish(task, 'succeeded', 0);
      }
    }
  }
  const busy = tasks.some(task => task.status === 'running' || task.status === 'starting');
  if (!busy && settleAt == null) settleAt = clockT + 6;
  if (settleAt != null && clockT >= settleAt && !current) {
    settleAt = null;
    clockT = 0;
    tasks = freshTasks();
    finishOrder = ['weights', 'unit'];
    moved = true;
  }
  if (moved) layout(true);
  else repaintRows(true);
  if (current) paintWindow(true);
}

let timer = null;
function runDemo(on) {
  demoOn = on;
  clearInterval(timer);
  if (on && !document.hidden) timer = setInterval(step, 500);
}

// task window: grows out of its row and folds back into it
const win = document.querySelector('.window');
const sheet = win.querySelector('.sheet');
const surface = win.querySelector('.surface');
const scrim = win.querySelector('.scrim');

const SLIDE = spring(.34, 0);
const findTask = id => tasks.find(x => x.id === id) || GALLERY.find(x => x.id === id);
const activitiesBox = sheet.querySelector('.activities');
const metadata = sheet.querySelector('.metadata');

// disclosure height glides open and shut, as in the panel
function smoothDetails(details) {
  const summary = details.querySelector('summary');
  summary.addEventListener('click', event => {
    if (still()) return;
    event.preventDefault();
    const opening = details._closing || !details.open;
    const from = details.getBoundingClientRect().height;
    details._motion?.cancel();
    details._closing = !opening;
    details.open = true;
    const to = opening ? details.getBoundingClientRect().height :
      summary.getBoundingClientRect().height + parseFloat(getComputedStyle(details).paddingTop);
    details.style.overflow = 'clip';
    const motion = details._motion = details.animate({ height: [from + 'px', to + 'px'] }, SLIDE);
    if (opening) for (const child of [...details.children].slice(1))
      child.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_OUT });
    motion.onfinish = () => {
      details.style.overflow = '';
      if (details._closing) { details.open = false; details._closing = false; }
    };
  });
}
smoothDetails(metadata);

function activityLine(item) {
  const line = h('div', 'activity');
  line.dataset.state = item.state;
  line.append(h('strong', null, phrase(item.name)), h('span', 'status', t(item.state)));
  if (item.detail) line.append(h('small', null, phrase(item.detail)));
  return line;
}

// one line per check or step; numbered shards fold into a group led by its most urgent state
function renderActivities(items) {
  const signature = JSON.stringify([locale, items]);
  if (signature === activitiesBox.dataset.signature) return;
  const open = new Set([...activitiesBox.querySelectorAll('details[open]')].map(el => el.dataset.group));
  activitiesBox.dataset.signature = signature;
  activitiesBox.hidden = !items.length;
  const groups = new Map();
  for (const item of ordered(items)) {
    const key = item.kind === 'checks' ? item.group : item.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  activitiesBox.replaceChildren(...[...groups].map(([key, members]) => {
    if (members.length === 1) return activityLine(members[0]);
    const group = h('details', 'group'), title = h('summary');
    group.dataset.group = key;
    group.dataset.state = members[0].state;
    const count = members.filter(item => FINISHED.has(item.state)).length;
    title.textContent = key + '  ' + count + '/' + members.length + '  ' + t(members[0].state);
    group.append(title, ...members.map(activityLine));
    group.open = open.has(key);
    smoothDetails(group);
    return group;
  }));
}

function renderHero(task, s) {
  tween(sheet.querySelector('.big-num'), s.p, pctText);
  const eta = s.layout === 'progress' && task.rate && s.p < 1 ?
    t('estimate') + ' ' + clock(new Date(Date.now() + (1 - s.p) * task.rate * 1000 + 60000)) : '';
  swapText(sheet.querySelector('.big-eta'), eta, false);
  const needs = (task.activities || []).find(item => item.state === 'needsInput');
  const failed = (task.activities || []).find(item => item.state === 'failed');
  const parts = [
    needs && phrase(needs.name) + ' — ' + t('needsInput'),
    task.reason && t(task.reason),
    ACTIVE.has(task.status) && stageText(task),
    task.blocker && t('waitingFor', { reason: t(task.blocker) }),
    ACTIVE.has(task.status) && task.warned && t('overTime'),
    failed && failed.name + ' — ' + t('failed'),
    task.status === 'failed' && task.code != null && t('exitCode') + ' ' + task.code,
  ];
  const hint = sheet.querySelector('.hint');
  swapText(hint, parts.filter(Boolean).join(' / '), false);
  hint.hidden = !hint.textContent;
  sheet.querySelector('.win-hero').hidden = !['progress', 'indeterminate', 'checks'].includes(s.layout) && hint.hidden;
  const checks = checksOf(task);
  if (!checks) return;
  const counts = new Map();
  for (const item of ordered(checks)) counts.set(item.state, (counts.get(item.state) || 0) + 1);
  const states = ['succeeded', 'failed', 'needsInput', 'running', 'pendingCheck', 'inQueue', 'skipped', 'stopped'].filter(state => counts.has(state));
  const stack = sheet.querySelector('.stack'), legend = sheet.querySelector('.legend');
  const segs = new Map([...stack.children].map(el => [el.dataset.state, el]));
  for (const [state, el] of segs) if (!counts.has(state)) el.remove();
  for (const state of states) {
    let seg = segs.get(state);
    if (!seg) { seg = h('span', 'seg'); seg.dataset.state = state; }
    stack.append(seg);
    seg.style.setProperty('--n', counts.get(state));
  }
  legend.replaceChildren(...states.map(state => {
    const key = h('span', 'key');
    key.dataset.state = state;
    key.append(h('b', null, String(counts.get(state))), ' ' + t(state));
    return key;
  }));
}

function renderDetails(task) {
  const started = new Date(Date.now() - task.t * 1000).toLocaleString(locale);
  const fields = [
    [t('taskId'), task.key], [t('cwd'), CWD], [t('started'), started], [t('thread'), THREAD],
    [t('stage'), ACTIVE.has(task.status) && stageText(task)], [t('blocker'), task.blocker && t(task.blocker)],
    [t('warnTime'), task.warnAfter && elapsed(task.warnAfter)], [t('verified'), task.reason && t(task.reason)],
    [t('originalResult'), task.status === 'resolved' && t('failed')],
    [t('exitCode'), ACTIVE.has(task.status) || task.code == null ? null : task.code],
    [t('notifyMode'), t('steer')], [t('chatNotice'), ACTIVE.has(task.status) ? t('pending') : t('queued')],
  ];
  const signature = JSON.stringify(fields);
  const box = metadata.querySelector('dl');
  if (box.dataset.signature === signature) return;
  box.dataset.signature = signature;
  box.replaceChildren(...fields.filter(([, value]) => value != null && value !== '' && value !== false)
    .flatMap(([name, value]) => [h('dt', null, name), h('dd', null, String(value))]));
}

function paintWindow(animate) {
  const task = findTask(current);
  if (!task) return;
  const s = scenario(task);
  sheet.dataset.tone = s.tone;
  sheet.dataset.layout = s.layout;
  sheet.dataset.active = String(Boolean(s.active));
  sheet.toggleAttribute('data-alert', Boolean(s.alert));
  sheet.style.setProperty('--p', String(s.p ?? 0));
  setGlyph(sheet.querySelector('.glyph'), s.glyph, animate);
  sheet.querySelector('h2').textContent = s.name;
  swapText(sheet.querySelector('.status'), s.status, animate);
  sheet.querySelector('.duration').textContent = s.duration;
  renderHero(task, s);
  renderActivities(task.activities || []);
  sheet.querySelector('.command').textContent = task.cmd;
  const log = sheet.querySelector('.log');
  const text = task.log.slice(-9).join('\n') || t('noOutput');
  if (log.textContent !== text) { log.textContent = text; log.scrollTop = log.scrollHeight; }
  renderDetails(task);
}
function resetWindow() {
  activitiesBox.replaceChildren();
  delete activitiesBox.dataset.signature;
  metadata.open = false;
  sheet.querySelector('.big-num')._value = null;
  sheet.querySelector('.stack').replaceChildren();
  sheet.querySelector('.cmd-copy').removeAttribute('data-done');
  sheet.querySelector('.win-body').scrollTop = 0;
}
sheet.querySelector('.cmd-copy').addEventListener('click', async event => {
  const button = event.currentTarget;
  try { await navigator.clipboard.writeText(findTask(current)?.cmd || ''); } catch { return; }
  button.dataset.done = '';
  clearTimeout(button._t);
  button._t = setTimeout(() => delete button.dataset.done, 1600);
});

function rectOf(el) { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
function frame(r, radius) { return { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', borderRadius: radius + 'px' }; }
function inset(r, to, radius) {
  return `inset(${r.y - to.y}px ${to.x + to.w - r.x - r.w}px ${to.y + to.h - r.y - r.h}px ${r.x - to.x}px round ${radius}px)`;
}
const parts = () => [...sheet.querySelectorAll('.win-head, .win-body > *')];

async function openWindow(id, keyboard = false) {
  if (current || busyMorph) return;
  current = id;
  const row = rowEls.get(id);
  resetWindow();
  paintWindow(false);
  win.hidden = false;
  document.body.classList.add('locked');
  sheet.querySelector('.win-close').focus({ preventScroll: true, focusVisible: keyboard });
  if (still()) return;
  busyMorph = true;
  const from = rectOf(row), to = rectOf(sheet);
  const ghost = row.cloneNode(true);
  ghost.removeAttribute('data-lifted');
  Object.assign(ghost.style, { position: 'absolute', left: 0, top: 0, width: from.w + 'px', background: 'transparent', boxShadow: 'none', transition: 'none' });
  surface.replaceChildren(surface.firstElementChild, ghost);
  win.dataset.phase = 'morph';
  row.dataset.lifted = '';
  scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
  ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
  surface.querySelector('.shade').animate([{ opacity: 0 }, { opacity: 1 }], OPEN);
  sheet.animate([{ clipPath: inset(from, to, 16) }, { clipPath: inset(to, to, 28) }], OPEN);
  parts().forEach((el, i) => el.animate(RISE, { duration: 480, delay: 24 + i * 26, easing: EASE_OUT, fill: 'backwards' }));
  await surface.animate([frame(from, 16), frame(to, 28)], OPEN).finished.catch(() => {});
  delete win.dataset.phase;
  busyMorph = false;
}

async function closeWindow() {
  if (!current || busyMorph) return;
  const row = rowEls.get(current);
  const done = () => {
    win.hidden = true;
    delete win.dataset.phase;
    document.body.classList.remove('locked');
    delete row.dataset.lifted;
    current = null;
    busyMorph = false;
    row.focus({ preventScroll: true, focusVisible: false });
  };
  if (still() || !row.isConnected) { done(); return; }
  busyMorph = true;
  const from = rectOf(sheet), to = rectOf(row);
  const ghost = surface.lastElementChild;
  if (ghost?.classList.contains('card')) { ghost.style.width = to.w + 'px'; paintRow(ghost, scenario(findTask(current)), false); }
  win.dataset.phase = 'morph';
  scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE.duration, easing: 'ease-out', fill: 'forwards' });
  parts().forEach(el => el.animate([{ opacity: 1 }, { opacity: 0, filter: 'blur(3px)' }], { duration: 140, easing: 'ease-in', fill: 'forwards' }));
  ghost?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 90, easing: 'ease-out', fill: 'both' });
  surface.querySelector('.shade').animate([{ opacity: 1 }, { opacity: 0 }], { ...CLOSE, fill: 'forwards' });
  sheet.animate([{ clipPath: inset(from, from, 28) }, { clipPath: inset(to, from, 16) }], { ...CLOSE, fill: 'forwards' });
  await surface.animate([frame(from, 28), frame(to, 16)], { ...CLOSE, fill: 'forwards' }).finished.catch(() => {});
  done();
  for (const el of [scrim, sheet, surface, surface.firstElementChild, ...parts()]) el.getAnimations().forEach(a => a.cancel());
}
scrim.addEventListener('click', closeWindow);
sheet.querySelector('.win-close').addEventListener('click', closeWindow);
addEventListener('keydown', e => {
  if (e.key === 'Escape') closeWindow();
  if (e.key === 'Tab' && current) { e.preventDefault(); sheet.querySelector('.win-close').focus(); }
});

// with and without: one 14 minute build, played back in a few seconds.
// The timeline has one segment per minute, which is also one poll on the left.
const versus = document.querySelector('.versus');
const lanes = Object.fromEntries([...versus.querySelectorAll('.lane')].map(el => [el.dataset.lane, el]));
const scrub = versus.querySelector('.scrub');
const scrubValue = versus.querySelector('.scrub-value');
for (let i = 0; i < 14; i++) scrub.append(h('i'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let run = 0, minute = 0, versusPlaying = false;

function showMinute(m, animate) {
  minute = m;
  [...scrub.children].forEach((seg, i) => seg.toggleAttribute('data-on', i < m));
  versus.toggleAttribute('data-done', m >= 14);
  swapText(scrubValue, m >= 14 ? t('scrubDone') : t('scrubAt', { m }), animate);
}
function laneSet(lane, calls, lines, meter, animate = true) {
  const fmt = v => Math.round(v).toLocaleString('en-US');
  const c = lane.querySelector('[data-stat=calls]'), l = lane.querySelector('[data-stat=lines]');
  if (animate) { tween(c, calls, fmt, 380); tween(l, lines, fmt, 380); } else { c._value = calls; l._value = lines; c.textContent = fmt(calls); l.textContent = fmt(lines); }
  lane.style.setProperty('--m', String(meter));
}
function post(lane, el, animate = true) {
  const chat = lane.querySelector('.chat');
  chat.append(el);
  while (chat.children.length > 14) chat.firstElementChild.remove();
  if (animate && !still()) el.animate(RISE, { duration: 420, easing: EASE_OUT });
  return el;
}
const bubble = (who, text, code) => {
  const el = h('div', 'msg ' + who, text);
  if (code) el.append(h('code', null, code));
  return el;
};
const chip = (text, tone) => { const el = h('span', 'chip', text); if (tone) el.dataset.tone = tone; return el; };

async function playVersus(instant = false) {
  const id = ++run;
  const alive = () => id === run;
  const wait = ms => instant ? null : sleep(ms);
  const anim = !instant;
  versusPlaying = !instant;
  for (const lane of Object.values(lanes)) { lane.querySelector('.chat').replaceChildren(); delete lane.dataset.done; laneSet(lane, 0, 0, 0, false); }
  showMinute(0, false);
  const { without, with: withB } = lanes;
  for (const lane of [without, withB]) post(lane, bubble('you', t('ask')), anim);
  await wait(650); if (!alive()) return;
  post(without, bubble('codex', t('startBuild'), 'xcodebuild -scheme App build'), anim);
  post(withB, bubble('codex', t('startBg'), 'backsoon start -- xcodebuild -scheme App build'), anim);
  laneSet(without, 1, 0, .02, anim); laneSet(withB, 1, 0, .02, anim);
  await wait(450); if (!alive()) return;
  post(withB, chip(t('turnEnded'), 'green'), anim);
  const quiet = post(withB, h('div', 'quiet'), anim);
  quiet.innerHTML = '<span class="zz"><i></i><i></i><i></i></span><span class="idle"></span><b></b>';
  quiet.querySelector('.idle').textContent = t('idle', { m: 0 });
  quiet.querySelector('b').textContent = t('zero');
  let lines = 0;
  for (let m = 1; m <= 14; m++) {
    await wait(380); if (!alive()) return;
    lines += 200;
    post(without, bubble('codex', t('still')), anim);
    post(without, chip(t('plus'), 'red'), anim);
    laneSet(without, 1 + m, lines, Math.min(.82, .02 + lines / 3400), anim);
    swapText(quiet.querySelector('.idle'), t('idle', { m }), anim);
    showMinute(m, anim);
  }
  await wait(500); if (!alive()) return;
  post(without, bubble('codex', t('built')), anim);
  laneSet(without, 16, lines, .84, anim);
  const note = h('div', 'notice-msg');
  note.innerHTML = '<span class="from"><svg viewBox="0 0 64 64" aria-hidden="true"><use href="#mark"/></svg>BackSoon</span><span></span>';
  noticeInto(note.lastElementChild, t('succeeded'), 0, '** BUILD SUCCEEDED **');
  post(withB, note, anim);
  await wait(420); if (!alive()) return;
  post(withB, bubble('codex', t('built')), anim);
  laneSet(withB, 2, 1, .04, anim);
  without.dataset.done = ''; withB.dataset.done = '';
  versusPlaying = false;
}
versus.querySelector('.replay').addEventListener('click', () => playVersus(still()));

// small loops in the feature tiles
const loop = (ms, fn) => { let i = 0; setInterval(() => { if (!document.hidden && !still()) fn(++i); }, ms); };
const LANG_WORDS = LOCALES.map(code => [code, CATALOGS[code].succeeded]);
const word = document.querySelector('.lang-word');
const names = [...document.querySelectorAll('.lang-names span')];
function showWord(i, animate) {
  const [lang, text] = LANG_WORDS[i % LANG_WORDS.length];
  word.lang = lang;
  if (animate) { word.textContent = ''; swapText(word, text); } else word.textContent = text;
  names.forEach(n => n.classList.toggle('on', n.lang === lang));
}
loop(2000, i => showWord(i, true));
const modes = [...document.querySelectorAll('.modes span')];
const modeNote = document.querySelector('.mode-note');
let modeIndex = 0;
const showMode = animate => {
  const mode = modes[modeIndex % modes.length];
  modes.forEach(m => m.classList.toggle('on', m === mode));
  swapText(modeNote, t(mode.dataset.mode), animate);
};
loop(2800, i => { modeIndex = i; showMode(true); });

// documents and readmes in the reader's language where they exist
const REPO = 'https://github.com/chentyke/backsoon/blob/main/';
const DOCS = {
  readme: l => l === 'en' ? REPO + 'README.md' : REPO + `README.${l}.md`,
  start: l => l === 'en' ? REPO + 'docs/getting-started.md' : REPO + `docs/${l}/getting-started.md`,
  usage: l => l === 'zh-CN' ? REPO + 'docs/zh-CN/usage.md' : REPO + 'docs/usage.md',
  progress: l => l === 'zh-CN' ? REPO + 'docs/zh-CN/progress.md' : REPO + 'docs/progress.md',
  brand: l => l === 'zh-CN' ? REPO + 'brand/README.zh-CN.md' : REPO + 'brand/README.md',
};

// apply a language to everything on the page
const picker = document.querySelector('.picker');
const pickerButton = picker.querySelector('.picker-button');
const pickerValue = picker.querySelector('.picker-value');
const menu = picker.querySelector('.picker-menu');
const hilite = menu.querySelector('.picker-hilite');
const options = LOCALES.map(code => {
  const option = h('div', 'picker-option');
  option.id = 'language-' + code;
  option.lang = code;
  option.setAttribute('role', 'option');
  option.innerHTML = '<svg class="picker-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4 6.6 11.5 12.5 4.8"/></svg>';
  option.append(h('span', null, NAMES[code]));
  return option;
});
menu.append(...options);
function applyLanguage(animate) {
  T = CATALOGS[locale];
  document.documentElement.lang = locale;
  document.title = t('title');
  document.querySelector('meta[name=description]').content = t('description');
  showLanguage(animate);
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const text = t(el.dataset.i18n);
    if (animate && el.getBoundingClientRect().bottom > 0 && el.getBoundingClientRect().top < innerHeight) swapText(el, text);
    else el.textContent = text;
  }
  for (const el of document.querySelectorAll('[data-i18n-html]')) {
    if (el.innerHTML === t(el.dataset.i18nHtml)) continue;
    el.innerHTML = t(el.dataset.i18nHtml);
    if (animate && !still()) el.animate(RISE, { duration: 420, easing: EASE_OUT });
  }
  for (const el of document.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  for (const el of document.querySelectorAll('[data-doc]')) el.href = DOCS[el.dataset.doc](locale);
  document.querySelector('.s3-row').textContent = t('succeeded') + t('exit', { code: 0 });
  noticeInto(document.querySelector('.notice-text'), t('succeeded'), 0, '** BUILD SUCCEEDED **');
  showMode(false);
  repaintRows(animate);
  if (current) paintWindow(animate);
  renderGallery();
  if (versusPlaying) playVersus(); else playVersus(true);
  if (!versusPlaying) showMinute(14, false);
}
// The language menu: the pill springs open into a list on the panel's own
// curves, and works like a listbox from the keyboard.
const MENU_GAP = 8;
let menuOpen = false, active = -1;
document.documentElement.style.setProperty('--menu-ease', REORDER.easing);
document.documentElement.style.setProperty('--menu-dur', REORDER.duration + 'ms');

function showLanguage(animate) {
  const before = pickerButton.offsetWidth;
  swapText(pickerValue, NAMES[locale], animate);
  pickerValue.lang = locale;
  options.forEach((option, i) => option.setAttribute('aria-selected', String(LOCALES[i] === locale)));
  const after = pickerButton.offsetWidth;
  if (animate && !still() && before && before !== after)
    pickerButton.animate([{ width: before + 'px' }, { width: after + 'px' }], REORDER);
}

// One highlight slides between rows instead of each row lighting up alone.
function highlight(index) {
  active = index;
  const option = options[index];
  menu.setAttribute('aria-activedescendant', option.id);
  options.forEach(o => o.toggleAttribute('data-active', o === option));
  const place = () => {
    hilite.style.height = option.offsetHeight + 'px';
    hilite.style.transform = `translateY(${option.offsetTop}px)`;
  };
  if (hilite.style.opacity === '1') return place();
  hilite.style.transition = 'opacity .15s';
  place();
  hilite.offsetWidth;
  hilite.style.transition = '';
  hilite.style.opacity = '1';
}

function openMenu() {
  if (menuOpen) return;
  menuOpen = true;
  menu.hidden = false;
  picker.toggleAttribute('data-open', true);
  pickerButton.setAttribute('aria-expanded', 'true');
  hilite.style.opacity = '0';
  highlight(LOCALES.indexOf(locale));
  menu.focus({ preventScroll: true });
  if (still()) return;
  for (const el of [menu, ...options]) el.getAnimations().forEach(a => a.cancel());
  menu.animate([{ opacity: 0, transform: `translateY(${-MENU_GAP}px) scale(.9)` }, { opacity: 1, transform: 'none' }], OPEN);
  options.forEach((option, i) => option.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
    { duration: 320, delay: 30 + i * 24, easing: EASE_OUT, fill: 'backwards' }));
}

async function closeMenu(refocus = true) {
  if (!menuOpen) return;
  menuOpen = false;
  picker.toggleAttribute('data-open', false);
  pickerButton.setAttribute('aria-expanded', 'false');
  menu.removeAttribute('aria-activedescendant');
  if (refocus) pickerButton.focus({ preventScroll: true });
  if (!still()) {
    options.forEach(option => option.getAnimations().forEach(a => a.cancel()));
    menu.getAnimations().forEach(a => a.cancel());
    await menu.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${-MENU_GAP / 2}px) scale(.96)` }],
      { ...CLOSE, fill: 'forwards' }).finished.catch(() => {});
  }
  // reopened while it was closing: leave it open
  if (menuOpen) return;
  menu.hidden = true;
  menu.getAnimations().forEach(a => a.cancel());
}

function choose(index) {
  closeMenu();
  if (LOCALES[index] === locale) return;
  locale = LOCALES[index];
  store.set(locale);
  const url = new URL(location.href);
  url.searchParams.set('lang', locale);
  history.replaceState(null, '', url);
  applyLanguage(true);
}

pickerButton.addEventListener('click', () => menuOpen ? closeMenu() : openMenu());
pickerButton.addEventListener('keydown', e => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  openMenu();
});
menu.addEventListener('keydown', e => {
  const last = options.length - 1;
  const keys = {
    ArrowDown: () => highlight(active < last ? active + 1 : 0),
    ArrowUp: () => highlight(active > 0 ? active - 1 : last),
    Home: () => highlight(0),
    End: () => highlight(last),
    Enter: () => choose(active),
    ' ': () => choose(active),
    Escape: () => closeMenu(),
  };
  if (e.key === 'Tab') return void closeMenu(false);
  const typed = e.key.length === 1 && e.key !== ' ' ?
    options.findIndex(o => o.textContent.toLowerCase().startsWith(e.key.toLowerCase())) : -1;
  if (typed >= 0) highlight(typed);
  else if (keys[e.key]) keys[e.key]();
  else return;
  e.preventDefault();
  e.stopPropagation();
});
options.forEach((option, i) => {
  option.addEventListener('pointermove', () => { if (active !== i) highlight(i); });
  option.addEventListener('click', () => choose(i));
});
menu.addEventListener('pointerleave', () => { if (menuOpen) highlight(LOCALES.indexOf(locale)); });
document.addEventListener('pointerdown', e => { if (menuOpen && !picker.contains(e.target)) closeMenu(false); });
picker.addEventListener('focusout', e => { if (menuOpen && !picker.contains(e.relatedTarget)) closeMenu(false); });

// first paint
applyLanguage(false);
layout(false);
showWord(LOCALES.indexOf(locale), false);
new IntersectionObserver(([e]) => runDemo(e.isIntersecting)).observe(demo);
document.addEventListener('visibilitychange', () => runDemo(demoOn));
new IntersectionObserver(([e], obs) => {
  if (!e.isIntersecting) return;
  obs.disconnect();
  if (!still()) playVersus();
}, { threshold: .35 }).observe(versus.querySelector('.lanes'));

// copy the one-line install command
const INSTALL = 'npm i -g backsoon && backsoon setup';
for (const button of document.querySelectorAll('.copy')) {
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(INSTALL); } catch { return; }
    button.dataset.done = '';
    clearTimeout(button._t);
    button._t = setTimeout(() => delete button.dataset.done, 1600);
  });
}

// reveal sections as they arrive, and give the nav a hairline once the page scrolls
const reveal = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const siblings = [...e.target.parentElement.children].filter(el => el.hasAttribute('data-reveal'));
    e.target.style.transitionDelay = Math.max(0, siblings.indexOf(e.target)) * 60 + 'ms';
    e.target.dataset.shown = '';
    reveal.unobserve(e.target);
  }
}, { rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => reveal.observe(el));
// in-page links glide, but only after the browser has put a reloaded page
// back where it was
const smooth = () => requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.toggleAttribute('data-smooth', true)));
if (document.readyState === 'complete') smooth(); else addEventListener('load', smooth, { once: true });
const nav = document.querySelector('.nav');
const onScroll = () => nav.toggleAttribute('data-scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();
