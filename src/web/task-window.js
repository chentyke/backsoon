import { finishedCount, formatCommand } from '../task.js';
import { ordered } from './task-view.js';
import { locale, msg, format } from './language.js';
import { smoothDetails, swapText, tween } from './motion.js';
import { setGlyph } from './glyphs.js';

const dialog = document.querySelector('#task-window');
const sheet = dialog.querySelector('.sheet');
const groupsBox = sheet.querySelector('#activities');
const notices = {received: 'received', steered: 'steered', queued: 'queued', wake_warning: 'wakeWarning', failed: 'deliveryFailed', unknown: 'deliveryUnknown'};

function renderDetails(task) {
  const box = sheet.querySelector("dl");
  const delivery = task.notice;
  const fields = [
    [msg('taskId'), task.id], [msg('cwd'), task.attached_cwd || task.cwd],
    [msg('checked'), task.checked_at && new Date(task.checked_at * 1000).toLocaleString(locale)],
    [msg('progressAt'), task.progress_at && new Date(task.progress_at * 1000).toLocaleString(locale)],
    [msg('verified'), task.resolution?.reason],
    [msg('thread'), task.thread], [msg('match'), task.match],
    [msg('alerts'), new Intl.ListFormat(locale).format(Object.keys(task.alert_on || {}))], [msg('lastAlert'), task.last_alert],
    [msg('started'), new Date(task.started * 1000).toLocaleString(locale)],
    [msg('warnTime'), task.warn_after && format.duration(task.warn_after)], [msg('pid'), task.attached_pid],
    [msg('originalResult'), task.resolution && msg(task.status)], [msg('exitCode'), task.code], [msg('progressScript'), task.progress_script],
    [msg('sampledAt'), task.sampled_at && new Date(task.sampled_at * 1000).toLocaleTimeString(locale)],
    [msg('stage'), task.stage], [msg('blocker'), task.blocker], [msg('progressError'), task.progress_error],
    [msg('notifyMode'), msg(task.notify ?? (task.thread ? "resume" : "off"))],
    [msg('chatNotice'), delivery ? msg(notices[delivery.state]) : task.notify !== "off" ? msg('pending') : msg('disabled')],
    [msg('retryNotice'), delivery?.retryMessage && 'backsoon retry-notice ' + task.id],
    [msg('issues'), delivery?.issues || null], [msg('detail'), delivery?.detail],
  ];
  const signature = JSON.stringify(fields);
  if (box.dataset.signature === signature) return;
  box.dataset.signature = signature;
  box.replaceChildren();
  for (const [name, value] of fields) {
    if (value == null || value === "") continue;
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = value;
    box.append(dt, dd);
  }
}

function activityLine(item) {
  const line = document.createElement('div');
  line.className = 'activity';
  line.dataset.state = item.state;
  const name = document.createElement('strong'), state = document.createElement('span');
  name.textContent = format.activityText(item);
  if (item.kind === 'chat') name.title = item.id;
  state.className = 'status';
  state.textContent = msg(item.state);
  line.append(name, state);
  if (item.detail) {
    const detail = document.createElement('small');
    detail.textContent = item.detail;
    line.append(detail);
  }
  return line;
}

function renderActivities(items) {
  const signature = JSON.stringify([locale, items]);
  if (signature === groupsBox.dataset.signature) return;
  const open = new Set([...groupsBox.querySelectorAll('details[open]')].map(el => el.dataset.group));
  groupsBox.dataset.signature = signature;
  groupsBox.replaceChildren();
  groupsBox.hidden = !items.length;
  const groups = new Map();
  for (const item of ordered(items)) {
    const key = item.kind === 'checks' ? item.group :
      item.kind === 'chat' && item.state === 'succeeded' ? msg('succeeded') : item.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const [key, members] of groups) {
    if (members.length === 1 && !(members[0].kind === 'chat' && members[0].state === 'succeeded')) {
      groupsBox.append(activityLine(members[0]));
      continue;
    }
    const group = document.createElement('details'), title = document.createElement('summary');
    group.className = 'group';
    group.dataset.group = key;
    group.dataset.state = members[0].state;
    const count = finishedCount(members);
    title.textContent = key + '  ' + count + '/' + members.length + '  ' + msg(members[0].state);
    group.append(title, ...members.map(activityLine));
    group.open = open.has(key);
    smoothDetails(group);
    groupsBox.append(group);
  }
}

smoothDetails(sheet.querySelector('#metadata'));

function renderHero(task, view) {
  const big = sheet.querySelector('.big-num');
  tween(big, view.percent, format.percentText);
  const eta = view.eta;
  sheet.querySelector('.big-eta').textContent = eta;
  const hint = sheet.querySelector('.hint');
  const exit = view.state === 'failed' && task.code != null ? msg('exitCode') + ' ' + task.code : '';
  const parts = [task.resolution?.reason || task.stage, task.blocker && msg('waitingFor', { reason: task.blocker }),
    task.progress_error && msg('progressUnavailable'),
    view.active && task.warned_at && msg('overTime'), view.layout === 'progress' ? '' : eta, exit];
  const items = task.activities || [];
  if (view.active && task.attached_pid && !task.progress_script && !items.length &&
      !task.output_files?.length && !task.latest && !task.stage) parts.push(msg('processOnly'));
  const needs = items.find(item => item.state === 'needsInput');
  if (needs) parts.unshift(format.activityText(needs) + ' — ' + msg('needsInput'));
  hint.textContent = parts.filter(Boolean).join(' / ');
  hint.hidden = !hint.textContent;
  dialog.toggleAttribute('data-alert', Boolean(view.alert));
  sheet.querySelector('.hero').hidden = !['progress', 'indeterminate', 'checks'].includes(view.layout) && hint.hidden;
  const tally = sheet.querySelector('.tally');
  if (!view.checks) return;
  const counts = new Map();
  for (const item of ordered(view.checks)) counts.set(item.state, (counts.get(item.state) || 0) + 1);
  const order = ['succeeded', 'failed', 'needsInput', 'running', 'pendingCheck', 'inQueue', 'skipped', 'stopped'];
  const states = order.filter(state => counts.has(state));
  const stack = tally.querySelector('.stack'), legend = tally.querySelector('.legend');
  const segs = new Map([...stack.children].map(el => [el.dataset.state, el]));
  for (const [state, el] of segs) if (!counts.has(state)) el.remove();
  for (const state of states) {
    let seg = segs.get(state);
    if (!seg) { seg = document.createElement('span'); seg.className = 'seg'; seg.dataset.state = state; }
    stack.append(seg);
    seg.style.setProperty('--n', counts.get(state));
  }
  legend.replaceChildren(...states.map(state => {
    const key = document.createElement('span'), count = document.createElement('b');
    key.className = 'key';
    key.dataset.state = state;
    count.textContent = counts.get(state);
    key.append(count, ' ' + msg(state));
    return key;
  }));
}

export function renderWindow(task, view) {
  if (!dialog.open) {
    groupsBox.replaceChildren();
    delete groupsBox.dataset.signature;
    sheet.querySelector('pre').textContent = '';
    sheet.querySelector('#metadata').open = false;
    sheet.querySelector('.big-num')._value = null;
    copy.removeAttribute('data-done');
  }
  dialog.dataset.state = view.state;
  dialog.dataset.tone = view.tone;
  dialog.dataset.layout = view.layout;
  dialog.dataset.active = String(view.active);
  dialog.style.setProperty('--p', String((view.percent ?? 0) / 100));
  setGlyph(sheet.querySelector('.glyph'), view.glyph, dialog.open);
  sheet.querySelector('h2').textContent = task.name;
  swapText(sheet.querySelector('.status'), view.label, dialog.open);
  sheet.querySelector('.duration').textContent = view.duration;
  const observerCommand = task.attached_pid && !('attached_cwd' in task) && task.argv[0] === 'backsoon' && task.argv[1] === 'attach';
  sheet.querySelector('.command-box').hidden = !task.argv.length || observerCommand;
  sheet.querySelector('.command').textContent = formatCommand(task.argv);
  const logHeading = sheet.querySelector('.loghead [data-msg]');
  logHeading.dataset.msg = task.attached_pid && !task.output_files?.length ? 'observerOutput' : 'recentOutput';
  logHeading.textContent = msg(logHeading.dataset.msg);
  sheet.querySelector('.console').hidden = Boolean(task.attached_pid && !task.latest);
  renderHero(task, view);
  renderActivities(task.activities || []);
  renderDetails(task);
}

const copy = sheet.querySelector('.copy');
copy.onclick = async () => {
  try { await navigator.clipboard.writeText(sheet.querySelector('.command').textContent); } catch { return; }
  copy.toggleAttribute('data-done', true);
  copy.setAttribute('aria-label', msg('copied'));
  clearTimeout(copy._timer);
  copy._timer = setTimeout(() => { copy.removeAttribute('data-done'); copy.setAttribute('aria-label', msg('copyCommand')); }, 1600);
};
