import { celebrate } from './celebrate.js';
import { setGlyph } from './glyphs.js';
import { rulesLines } from './i18n.js';
import { bindLanguage, locale, msg } from './language.js';
import { RISE, swapText, still } from './motion.js';

// Each state maps to the panel's scenarios: a glyph, a tone and a short label.
const LOOK = {
  checking: { glyph: 'spin', tone: 'blue', label: 'guideChecking' },
  saving: { glyph: 'spin', tone: 'blue', label: 'guideSaving' },
  ready: { glyph: 'succeeded', tone: 'green', label: 'guideStateReady' },
  action: { glyph: 'needsInput', tone: 'amber', label: 'guideStateAction' },
  unknown: { glyph: 'warning', tone: 'grey', label: 'guideStateUnknown' },
  added: { glyph: 'succeeded', tone: 'green', label: 'guideStateAdded' },
  offer: { glyph: 'recommended', tone: 'blue', label: 'guideStateRecommended' },
  skipped: { glyph: 'skipped', tone: 'grey', label: 'guideStateSkipped' },
};
const SKIP_KEY = 'backsoon-rules-skipped';
const $ = selector => document.querySelector(selector);
const setup = $('#setup'), button = $('#recheck'), pips = $('#hook-pips');
// The server puts a one-time token in the URL fragment; only this page can
// send it back, so only this page can change AGENTS.md.
const token = location.hash.slice(1);
const WHERE_KEY = 'backsoon-hooks-where';
const CELEBRATED_KEY = 'backsoon-celebrated';
let complete, celebrated = false;
let status, checking = true, saving = false, error = '', checkedAt, painted = false, skipped = false, where;
try {
  skipped = localStorage.getItem(SKIP_KEY) === '1';
  where = localStorage.getItem(WHERE_KEY);
  celebrated = localStorage.getItem(CELEBRATED_KEY) === '1';
} catch {}

function hooksState() {
  if (checking && !status) return 'checking';
  if (status?.trusted == null) return 'unknown';
  return status.trusted === status.total ? 'ready' : 'action';
}
function rulesState() {
  if (saving) return 'saving';
  if (checking && !status) return 'checking';
  if (status?.rules === true) return 'added';
  if (status?.rules !== false) return 'unknown';
  return skipped ? 'skipped' : 'offer';
}

// Messages with placeholders get inline code, keeping the translated word
// order intact.
const MARK = '\u0000';
const CODE = { command: '/hooks', name: 'BackSoon completion notices' };
// Names of controls in the Codex app, quoted exactly as the app labels them
// in each language.
const UI = { settings: 'guideAppSettings', hooks: 'guideAppHooks', trust: 'guideAppTrust', trustAll: 'guideAppTrustAll',
  review: 'guideAppReview', allowAll: 'guideAppAllowAll' };
function rich(el, key, extra = {}) {
  const values = Object.fromEntries(['command', 'name', 'key', 'file', ...Object.keys(UI)].map(name => [name, MARK + name + MARK]));
  const parts = msg(key, values).split(MARK);
  const text = document.createElement('span');
  el.replaceChildren(text);
  text.append(...parts.map((part, i) => {
    if (i % 2 === 0) return part;
    if (part === 'key') return Object.assign(document.createElement('kbd'), { textContent: 't' });
    if (UI[part]) return Object.assign(document.createElement('b'), { className: 'ui', textContent: msg(UI[part]) });
    const code = Object.assign(document.createElement('code'), { textContent: extra[part] ?? CODE[part] });
    if (part === 'command') code.className = 'chip';
    if (part === 'file' && extra.title) code.title = extra.title;
    return code;
  }));
}

// Prose reads in the UI font; the markers, heading and `commands` stay in
// the code font so what will be written is still recognizable.
function showRules(pre, lines) {
  if (pre.dataset.locale === locale) return;
  pre.dataset.locale = locale;
  const code = text => Object.assign(document.createElement('span'), { className: 'code', textContent: text });
  pre.replaceChildren(...lines.flatMap((line, i) => [
    ...(i ? ['\n'] : []),
    ...(/^(<!--|#)/.test(line) ? [code(line)] : line.split(/(`[^`]+`)/).map((part, j) => j % 2 ? code(part) : part)),
  ]));
}

function paintStep(step, state, text, animate) {
  const look = LOOK[state];
  step.dataset.tone = look.tone;
  step.dataset.state = state;
  setGlyph(step.querySelector('.glyph'), look.glyph, animate);
  swapText(step.querySelector('.step-state'), msg(look.label), animate);
  if (text != null) swapText(step.querySelector('[role=status]'), text, animate);
}

const RULES_TEXT = { added: 'guideAdded', offer: 'guideMissing', skipped: 'guideSkipped', unknown: 'guideRulesUnknown' };
function render() {
  const animate = painted;
  const hooks = hooksState(), rules = rulesState();
  paintStep($('#step-hooks'), hooks, hooks === 'checking' ? '' : hooks === 'ready' ? msg('guideReady') :
    hooks === 'action' ? msg('guideCount', status) : msg('guideUnknown'), animate);
  paintStep($('#step-rules'), rules, rules === 'checking' ? '' : RULES_TEXT[rules] && msg(RULES_TEXT[rules]), animate);

  const total = status?.total ?? 4, trusted = status?.trusted ?? 0;
  if (pips.childElementCount !== total)
    pips.replaceChildren(...Array.from({ length: total }, () => Object.assign(document.createElement('span'), { className: 'pip' })));
  [...pips.children].forEach((pip, i) => { pip.dataset.state = hooks === 'checking' ? 'running' : i < trusted ? 'succeeded' : 'skipped'; });
  pips.hidden = hooks === 'ready';
  $('#hooks-fix').dataset.open = String(hooks === 'action' || hooks === 'unknown');
  $('#how').hidden = hooks === 'ready' || hooks === 'checking';
  // Trust is granted in the Codex app's settings or the CLI's /hooks; start
  // with the one setup ran from.
  const shown = where ?? (status?.desktop === false ? 'cli' : 'desktop');
  for (const tab of document.querySelectorAll('[data-where]')) {
    const on = tab.dataset.where === shown;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  $('#how-desktop').hidden = $('#desk-tip').hidden = shown !== 'desktop';
  $('#how-cli').hidden = shown !== 'cli';

  // The rule is optional: offer it with a preview, and keep the choice
  // reversible from the same card.
  const offering = rules === 'offer' || (rules === 'unknown' && Boolean(status)) ||
    (rules === 'saving' && $('#rules-fix').dataset.open === 'true');
  $('#rules-fix').dataset.open = String(offering);
  $('#rules-more').dataset.open = String(rules === 'added' || rules === 'skipped' ||
    (rules === 'saving' && $('#rules-more').dataset.open === 'true'));
  // The preview is exactly what gets written, in the page's language.
  showRules($('#preview'), rulesLines(locale));
  rich($('#preview-file'), 'guidePreview', { file: 'AGENTS.md', title: status?.file });
  if (rules === 'added' || rules === 'skipped')
    $('#rules-toggle').textContent = msg(rules === 'added' ? 'guideRemoveRules' : 'guideReconsider');
  for (const control of document.querySelectorAll('#add-rules, #skip-rules, #rules-toggle')) control.disabled = saving;
  const failure = $('#rules-error');
  failure.hidden = !error;
  failure.textContent = error && msg('guideRulesError', { error });

  // Only the hooks are required; the header and the lede follow them.
  const overall = hooks;
  // Once nothing is left to do (hooks trusted, the rule added or declined),
  // the sign is hung. It celebrates the moment that happens on this page, or
  // the first time the page finds it already done.
  const done = hooks === 'ready' && (rules === 'saving' ? complete : rules === 'added' || rules === 'skipped');
  const hang = Boolean(status && !checking && done && (complete === false || (complete === undefined && !celebrated)));
  if (status && !checking) complete = done;
  setup.toggleAttribute('data-complete', Boolean(done));
  if (hang) {
    celebrated = true;
    try { localStorage.setItem(CELEBRATED_KEY, '1'); } catch {}
    celebrate(setup.querySelector('.tile'));
  }
  const wasReady = setup.dataset.state === 'ready';
  setup.dataset.state = overall;
  setup.dataset.tone = LOOK[overall].tone;
  setup.setAttribute('aria-busy', String(checking || saving));
  setGlyph($('#overall-glyph'), LOOK[overall].glyph, animate);
  swapText($('#overall'), msg(overall === 'ready' ? 'guideAllSet' : LOOK[overall].label), animate);
  swapText($('#lede'), msg(overall === 'ready' ? 'guideDoneBody' : 'guideLede'), animate && wasReady !== (overall === 'ready'));
  for (const li of document.querySelectorAll('[data-rich]')) rich(li, li.dataset.rich);
  $('#checked').textContent = checkedAt ? msg('guideChecked', {
    time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(checkedAt),
  }) : '';
  button.toggleAttribute('data-spinning', checking);
  painted = true;
}

// Keep a spinner up long enough to read as work, not a flicker.
async function settle(started, least) {
  const wait = still() ? 0 : least - (performance.now() - started);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
}

async function check() {
  if (button.disabled) return;
  button.disabled = checking = true;
  render();
  const started = performance.now();
  try {
    const response = await fetch('/api/setup', { headers: { 'X-BackSoon-Guide': '1' } });
    if (!response.ok) throw Error();
    status = await response.json();
  } catch {
    status = undefined;
  } finally {
    await settle(started, 420);
    button.disabled = checking = false;
    checkedAt = new Date();
    render();
  }
}

function remember(skip) {
  skipped = skip;
  try { skip ? localStorage.setItem(SKIP_KEY, '1') : localStorage.removeItem(SKIP_KEY); } catch {}
}

async function changeRules(enabled) {
  if (saving) return;
  saving = true;
  error = '';
  render();
  const started = performance.now();
  try {
    const response = await fetch('/api/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BackSoon-Guide': '1', 'X-BackSoon-Token': token },
      body: JSON.stringify({ enabled, locale }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'HTTP ' + response.status);
    status = data;
    remember(false);
    checkedAt = new Date();
  } catch (failure) {
    error = failure.message;
  } finally {
    await settle(started, 360);
    saving = false;
    render();
  }
}

for (const tab of document.querySelectorAll('[data-where]')) {
  tab.onclick = () => {
    where = tab.dataset.where;
    try { localStorage.setItem(WHERE_KEY, where); } catch {}
    render();
  };
  tab.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const other = document.querySelector(`[data-where]:not([data-where="${tab.dataset.where}"])`);
    other.click();
    other.focus();
  };
}
$('#add-rules').onclick = () => changeRules(true);
$('#skip-rules').onclick = () => { remember(true); error = ''; render(); };
$('#rules-toggle').onclick = () => {
  if (status?.rules === true) return changeRules(false);
  remember(false);
  render();
};

bindLanguage(render);
render();
if (!still()) setup.animate(RISE, { duration: 520, easing: 'cubic-bezier(.22, 1, .36, 1)' });
button.onclick = check;
window.addEventListener('focus', check);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void check(); });
void check();
