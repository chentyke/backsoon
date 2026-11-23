import { bindLanguage, format, msg } from './language.js';
import { renderList } from './task-list.js';
import { renderWindow } from './task-window.js';
import { bindWindowMotion } from './window-motion.js';

const dialog = document.querySelector('#task-window');
const connection = document.querySelector('#connection');
const log = dialog.querySelector('pre');
const page = location.pathname;
const api = page === '/' ? '/api/tasks' : '/api' + page;
let data = [];
let selected = page.startsWith('/tasks/') ? page.slice(7) : null;
let logRequest = 0;
const motion = bindWindowMotion(dialog, () => {
  selected = null;
  render();
});

function select(id) {
  selected = id;
  render();
  loadLogs(id);
}

function render() {
  const now = Date.now();
  const tasks = data.map(task => ({ task, view: format.describe(task, now) }));
  const row = renderList(tasks, selected, select);
  const item = tasks.find(({ task }) => task.id === selected);
  if (item) {
    renderWindow(item.task, item.view);
    if (!dialog.open) motion.open(row);
  } else if (dialog.open) {
    motion.close();
  } else {
    selected = null;
  }
}

async function get(path) {
  const response = await fetch(path, {cache: "no-store"});
  if (!response.ok) throw Error(String(response.status));
  return response.json();
}

async function loadLogs(id) {
  const request = ++logRequest;
  let text;
  try {
    const lines = await get('/api/logs/' + id);
    text = lines.join('\n') || msg('noOutput');
  } catch {
    text = msg('logError');
  }
  if (selected !== id || request !== logRequest || log.textContent === text) return;
  const atEnd = log.scrollHeight - log.clientHeight - log.scrollTop < 5;
  log.textContent = text;
  if (atEnd) log.scrollTop = log.scrollHeight;
}

async function refresh() {
  try {
    data = await get(api);
    render();
    connection.dataset.msg = 'connected';
    connection.textContent = msg('connected');
    connection.className = "online";
    const expanded = selected;
    if (expanded && !motion.closing) await loadLogs(expanded);
  } catch {
    connection.dataset.msg = 'disconnected';
    connection.textContent = msg('disconnected');
    connection.className = "";
  } finally {
    setTimeout(refresh, 1000);
  }
}

bindLanguage(() => {
  render();
  if (selected) loadLogs(selected);
});
refresh();
