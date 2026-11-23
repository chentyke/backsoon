import { finishedCount } from '../task.js';
import { format } from './language.js';
import { setGlyph } from './glyphs.js';
import { EASE_OUT, REORDER, RISE, still, swapText, tween } from './motion.js';

const runningSection = document.querySelector("#running");
const endedSection = document.querySelector("#ended");
const rows = new Map();
let painted = false;

function rowFor(id, onSelect) {
  if (rows.has(id)) return rows.get(id);
  const row = document.querySelector("#task").content.firstElementChild.cloneNode(true);
  const summary = row.querySelector(".summary");
  summary.onclick = () => onSelect(id);
  row.dataset.id = id;
  rows.set(id, row);
  return row;
}

// rows and headings slide to their new places instead of jumping
function tracked() {
  return [...rows.values(), ...document.querySelectorAll('main h2, main .empty')];
}
export function renderList(tasks, selected, onSelect) {
  const animate = painted && !still();
  const before = new Map();
  if (animate) for (const el of tracked()) if (el.isConnected) before.set(el, el.getBoundingClientRect());
  for (const el of before.keys()) el._flip?.cancel();
  const ids = new Set(tasks.map(({ task }) => task.id));
  for (const [id, row] of rows) {
    if (!ids.has(id)) { row.remove(); rows.delete(id); }
  }
  const running = [];
  const ended = [];
  for (const item of tasks) (item.view.active ? running : ended).push(item);
  ended.sort((a, b) => (b.task.ended ?? b.task.updated) - (a.task.ended ?? a.task.updated));
  const fresh = [];
  renderSection(runningSection, running, fresh, selected, onSelect);
  renderSection(endedSection, ended, fresh, selected, onSelect);
  if (!still()) {
    for (const el of tracked()) {
      const from = before.get(el);
      if (!from || !el.isConnected) continue;
      const to = el.getBoundingClientRect();
      if (!to.height) continue;
      const dx = from.left - to.left, dy = from.top - to.top;
      if (Math.abs(dx) < .5 && Math.abs(dy) < .5) continue;
      el._flip = el.animate([{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'none' }], REORDER);
    }
    fresh.forEach((row, index) => row.animate(RISE, { duration: 520, easing: EASE_OUT, delay: painted ? 0 : Math.min(index, 10) * 38, fill: 'backwards' }));
    for (const el of document.querySelectorAll('main .empty')) {
      if (!el.hidden && before.has(el) && !before.get(el).height) el.animate(RISE, { duration: 400, easing: EASE_OUT });
    }
  }
  painted = true;
  return rows.get(selected);
}

function renderSection(section, tasks, fresh, selected, onSelect) {
  const list = section.querySelector(".tasks");
  section.querySelector(".count").textContent = tasks.length;
  section.querySelector(".empty").hidden = tasks.length > 0;
  tasks.forEach(({ task, view }, index) => {
    const known = rows.has(task.id);
    const row = rowFor(task.id, onSelect);
    if (!known) fresh.push(row);
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    paintRow(row, task, view, selected === task.id, known && painted);
  });
}

function paintRow(row, task, view, expanded, animate) {
  row.dataset.state = view.state;
  row.dataset.tone = view.tone;
  row.dataset.layout = view.layout;
  row.dataset.active = String(view.active);
  row.dataset.blocked = String(Boolean(task.blocker));
  setGlyph(row.querySelector('.glyph'), view.glyph, animate);
  row.querySelector("strong").textContent = task.name;
  swapText(row.querySelector(".status"), view.label, animate);
  const context = row.querySelector(".context");
  swapText(context, view.context, animate);
  context.title = context.textContent;
  context.hidden = !context.textContent;
  const percent = view.percent;
  row.style.setProperty('--p', String((percent ?? 0) / 100));
  const bar = row.querySelector("progress");
  if (percent == null) bar.removeAttribute("value");
  else bar.value = percent;
  const progressText = format.percentText(percent);
  tween(row.querySelector(".pct"), percent, format.percentText);
  bar.setAttribute("aria-valuetext", progressText);
  paintPips(row.querySelector('.pips'), view.checks);
  row.querySelector('.outcome').textContent = view.outcome;
  row.querySelector(".duration").textContent = view.duration;
  row.querySelector(".summary").setAttribute("aria-expanded", String(expanded));
}

function paintPips(box, items) {
  if (!items) { if (box.childElementCount) box.replaceChildren(); return; }
  const dense = items.length > (innerWidth < 420 ? 9 : 14);
  box.toggleAttribute('data-dense', dense);
  const pips = [...box.querySelectorAll('.pip')];
  while (pips.length > items.length) pips.pop().remove();
  let count = box.querySelector('.pips-count');
  if (!count) { count = document.createElement('span'); count.className = 'pips-count'; box.append(count); }
  items.forEach((item, index) => {
    let pip = pips[index];
    if (!pip) { pip = document.createElement('span'); pip.className = 'pip'; box.insertBefore(pip, count); }
    pip.dataset.state = item.state;
  });
  count.textContent = finishedCount(items) + '/' + items.length;
}
