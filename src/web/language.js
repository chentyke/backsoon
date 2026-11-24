import { selectLocale, translator } from './i18n.js';
import { createTaskFormatter } from './task-view.js';

const picker = document.querySelector('#language');
let saved;
try { saved = localStorage.getItem('backsoon-language'); } catch {}
export let locale = selectLocale(saved || navigator.languages);
export let msg = translator(locale);
export let format = createTaskFormatter(locale);

function translate(root) {
  for (const el of root.querySelectorAll('[data-msg]')) el.textContent = msg(el.dataset.msg);
  for (const el of root.querySelectorAll('[data-label]')) el.setAttribute('aria-label', msg(el.dataset.label));
}
function translatePanel() {
  document.documentElement.lang = locale;
  picker.value = locale;
  translate(document);
  const template = document.querySelector('#task');
  if (template) translate(template.content);
}

export function bindLanguage(onChange) {
  translatePanel();
  picker.onchange = () => {
    locale = selectLocale(picker.value);
    msg = translator(locale);
    format = createTaskFormatter(locale);
    try { localStorage.setItem('backsoon-language', locale); } catch {}
    translatePanel();
    onChange();
  };
}
