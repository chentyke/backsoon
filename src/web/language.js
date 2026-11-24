import { catalogs, selectLocale, translator } from './i18n.js';
import { CLOSE, EASE_OUT, OPEN, REORDER, still, swapText } from './motion.js';
import { createTaskFormatter } from './task-view.js';

// each language named in its own script, whatever the page language
const NAMES = { en: 'English', 'zh-CN': '简体中文', 'zh-TW': '繁體中文', ja: '日本語', ko: '한국어' };
const LOCALES = Object.keys(catalogs);

let saved;
try { saved = localStorage.getItem('backsoon-language'); } catch {}
export let locale = selectLocale(saved || navigator.languages);
export let msg = translator(locale);
export let format = createTaskFormatter(locale);

const picker = document.querySelector('.picker');
const pickerButton = picker.querySelector('.picker-button');
const pickerValue = picker.querySelector('.picker-value');
const menu = picker.querySelector('.picker-menu');
const hilite = menu.querySelector('.picker-hilite');
const options = LOCALES.map(code => {
  const option = document.createElement('div');
  option.className = 'picker-option';
  option.id = 'language-' + code;
  option.lang = code;
  option.setAttribute('role', 'option');
  option.innerHTML = '<svg class="picker-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4 6.6 11.5 12.5 4.8"/></svg>';
  const name = document.createElement('span');
  name.textContent = NAMES[code];
  option.append(name);
  return option;
});
menu.append(...options);

function translate(root) {
  for (const el of root.querySelectorAll('[data-msg]')) el.textContent = msg(el.dataset.msg);
  for (const el of root.querySelectorAll('[data-label]')) el.setAttribute('aria-label', msg(el.dataset.label));
}
function translatePanel(animate) {
  document.documentElement.lang = locale;
  showLanguage(animate);
  translate(document);
  const template = document.querySelector('#task');
  if (template) translate(template.content);
}

// The language menu: the pill springs open into a list on the panel's own
// curves, and works like a listbox from the keyboard.
const MENU_GAP = 8;
let menuOpen = false, active = -1, changed = () => {};
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
  msg = translator(locale);
  format = createTaskFormatter(locale);
  try { localStorage.setItem('backsoon-language', locale); } catch {}
  translatePanel(true);
  changed();
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

export function bindLanguage(onChange) {
  changed = onChange;
  translatePanel(false);
}
