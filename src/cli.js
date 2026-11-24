import { formatCommand, isActive, taskState } from './task.js';
import { msg } from './locale.js';
import fs from 'node:fs';
import { observe, processDetails } from './attach.js';
import { rulesPath, setRules, setup, shortPath } from './setup.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  read,
  optional,
  save,
  folder,
  status,
  now,
  home,
  taskId,
  identity,
  detached,
  tail,
  records,
  entry,
  withFileLock,
} from './store.js';
import { registerRoot, launch, serve } from './dashboard.js';
import { guideAvailable, openSetupGuide, printDesktopLink } from './onboarding.js';
import { chatLabel } from './chat.js';
import { checkNoticeAccess, retryNotice } from './notify.js';
import { scriptPath } from './progress.js';

const help = {
  start: msg('helpStart'),
  attach: msg('helpAttach'),
  'wait-chat': msg('helpWatch'),
  panel: msg('helpPanel'),
  list: 'list',
  show: msg('helpShow'),
  logs: msg('helpLogs'),
  stop: msg('helpStop'),
  'retry-notice': 'retry-notice TASK_ID',
  resolve: msg('helpResolve'),
  setup: msg('helpSetup'),
};
const common = {
  name: 'string',
  thread: 'string',
  notify: 'string',
  'no-notify': 'boolean',
  remote: 'string',
  'no-panel': 'boolean',
  'warn-after': 'string',
};
const progress = {
  cwd: 'string',
  match: 'string',
  'progress-script': 'string',
  'progress-interval': 'string',
};
const schema = {
  setup: { rules: 'boolean', 'no-rules': 'boolean', 'skill-only': 'boolean', 'no-open': 'boolean' },
  start: { ...common, ...progress, 'alert-on': 'string', 'after-success': 'string' },
  attach: { ...common, ...progress },
  'wait-chat': { ...common, 'after-task': 'string', 'final-line': 'string', timeout: 'string' },
  resolve: { reason: 'string' },
  panel: { all: 'boolean', chat: 'string', task: 'string' },
};
function usage(action) {
  if (!action)
    return (
      msg('helpIntro') +
      Object.values(help)
        .map((s) => '  backsoon ' + s)
        .join('\n') +
      msg('helpMore')
    );
  const names = Object.entries(schema[action] || {}).map(
    ([key, type]) => '--' + key + (type === 'string' ? msg('helpValue') : ''),
  );
  return 'backsoon ' + help[action] + (names.length ? msg('helpOptions') + names.join(', ') : '');
}
function checkPattern(pattern, option) {
  try {
    new RegExp(pattern);
  } catch {
    throw Error(msg('badPattern', { option }));
  }
}

function parse(action, args) {
  const specification = schema[action] || {};
  const options = Object.fromEntries(
    Object.entries(specification).map(([k, type]) => [k, { type, multiple: k === 'alert-on' }]),
  );
  const normalized = [],
    rules = Object.create(null);
  let argv = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (action === 'start' && (arg === '--' || !arg.startsWith('-'))) {
      argv = args.slice(i + Number(arg === '--'));
      break;
    }
    if (arg === '--alert-on' && action === 'start') {
      const name = args[++i]?.trim(),
        pattern = args[++i];
      if (!name || !pattern?.trim() || Object.hasOwn(rules, name))
        throw Error(msg('badAlert'));
      checkPattern(pattern, '--alert-on');
      rules[name] = pattern;
      continue;
    }
    if (
      arg === '--after-task' &&
      action === 'wait-chat' &&
      (!args[i + 1] || args[i + 1].startsWith('--'))
    ) {
      normalized.push('--after-task=*');
      continue;
    }
    if (arg === '--') {
      normalized.push(...args.slice(i));
      break;
    }
    const option = arg.split('=', 1)[0];
    if (option.startsWith('--') && !Object.hasOwn(specification, option.slice(2)))
      throw Error(msg('unknownOption', { option }));
    normalized.push(arg);
    if (arg.startsWith('--') && specification[arg.slice(2)] === 'string') {
      if (args[i + 1] == null || args[i + 1].startsWith('--')) throw Error(msg('missingValue', { arg }));
      normalized.push(args[++i]);
    }
  }
  let parsed;
  try {
    parsed = parseArgs({ args: normalized, options, allowPositionals: true });
  } catch (error) {
    if (!error.code?.startsWith('ERR_PARSE_ARGS_')) throw error;
    throw Error(msg('invalidOptions', { usage: usage(action) }));
  }
  const { values: v, positionals: p } = parsed;
  if (v['alert-on']) throw Error(msg('alertUsage'));
  return { v, p, argv, rules };
}
function positive(value, label) {
  if (value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw Error(msg('positiveSeconds', { label }));
  return n;
}
async function startWorker(root, task, parentId) {
  const dir = path.join(root, task.id);
  async function start(reservation) {
    fs.mkdirSync(dir, { mode: 0o700 });
    save(path.join(dir, 'task.json'), task);
    // Reserve before spawning: losing the CLI after launch must never run the installation twice.
    if (reservation) save(reservation, { id: task.id });
    await detached(['_run', dir]);
    return task.id;
  }
  if (parentId === undefined) return start();
  const parent = folder(parentId, root);
  return withFileLock(path.join(parent, 'follow-up.lock'), async () => {
    const build = read(path.join(parent, 'task.json'));
    if (build.status !== 'succeeded' || !build.ended) throw Error(msg('followUpNeedsSuccess'));
    const reservation = path.join(parent, 'follow-up.json');
    const previous = optional(reservation);
    if (previous) {
      const saved = read(path.join(folder(previous.id, root), 'task.json'));
      if (saved.cwd !== task.cwd || JSON.stringify(saved.argv) !== JSON.stringify(task.argv))
        throw Error(msg('followUpConflict', { id: saved.id }));
      return saved.id;
    }
    task.after_success = parentId;
    return start(reservation);
  });
}

async function register(action, v, p, argv, rules) {
  if (v.notify && v['no-notify']) throw Error(msg('notifyConflict'));
  const notify = v['no-notify'] ? 'off' : (v.notify ?? 'steer');
  if (!['off', 'resume', 'queue', 'steer'].includes(notify))
    throw Error(msg('badMode'));
  const thread = process.env.CODEX_THREAD_ID || v.thread || null;
  const destination = notify === 'off' ? null : v.thread || thread;
  if (notify !== 'off' && !destination)
    throw Error(msg('noThread'));
  let cwd = fs.realpathSync(v.cwd || '.');
  if (!fs.statSync(cwd).isDirectory()) throw Error(msg('badDirectory'));
  const interval = Number(v['progress-interval'] ?? 5);
  if (!(interval >= 0.25 && interval <= 86400)) throw Error(msg('badInterval'));
  if (v.match) checkPattern(v.match, '--match');
  const extra = {};
  let name = v.name;
  if (action === 'attach') {
    const pid = Number(p[0]);
    const start = identity(pid);
    if (!start) throw Error(msg('noProcess'));
    const source = processDetails(pid);
    if (identity(pid) !== start) throw Error(msg('noProcess'));
    if (!v.cwd && !v['progress-script'] && source.cwd) cwd = source.cwd;
    Object.assign(extra, { attached_pid: pid, process_start: start, attached_cwd: source.cwd || null, output_files: source.files });
    argv = source.argv;
    name ||= argv[0] ? path.basename(argv[0]) : msg('watchPid', { pid });
  } else if (action === 'wait-chat') {
    const chats = [...new Set(p.map(value => value.toLowerCase()))];
    const [chat] = chats;
    if (chats.some(id => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))) throw Error(msg('badChat'));
    if (chats.includes(destination?.toLowerCase())) throw Error(msg('sameChat'));
    const after = v['after-task'] ?? null,
      line = v['final-line']?.trim() ?? null;
    if (after !== null && after !== '*' && !taskId.test(after)) throw Error(msg('badAfter'));
    if (line !== null && (!line || /[\r\n]/.test(line) || after !== null))
      throw Error(msg('badFinal'));
    extra.watch = {
      chat, chats,
      after_task: after,
      final_line: line,
      timeout: positive(v.timeout, '--timeout'),
    };
    argv = ['backsoon', ...process.argv.slice(2)];
    name ||= chats.length > 1 ? msg('chatCount', { count: chats.length }) : msg('watchChat', { id: chatLabel(chat) });
  }
  if (action === 'start' && !argv.length) throw Error(msg('noCommand'));
  const id = randomUUID().replaceAll('-', '').slice(0, 12),
    started = now();
  const task = {
    id,
    name: name || path.basename(argv[0]),
    argv,
    cwd,
    thread,
    notify_thread: destination,
    notify,
    remote: v.remote ?? process.env.BACKSOON_REMOTE ?? null,
    match: v.match || null,
    alert_on: rules,
    progress_script: v['progress-script'] ? scriptPath(v['progress-script'], cwd) : null,
    progress_interval: interval,
    warn_after: positive(v['warn-after'], '--warn-after'),
    warned_at: null,
    started,
    updated: started,
    ended: null,
    code: null,
    percent: null,
    status: 'starting',
    latest: '',
    sampled_at: null,
    stage: '',
    blocker: '',
    progress_error: null,
    worker_pid: process.pid,
    worker_start: identity(process.pid),
    ...extra,
  };
  const noticeWarning = await checkNoticeAccess(task);
  const root = home();
  const startedId = await startWorker(root, task, v['after-success']);
  console.log(startedId);
  if (startedId !== id) {
    console.error(msg('followUpExists', { id: startedId }));
    return;
  }
  if (noticeWarning) console.error(msg(noticeWarning, { id }));
  const desktop = process.env.CODEX_APP_TOOLS_PIPE_PATH;
  try {
    if (desktop && !v['no-panel']) {
      const url = await launch(thread, thread ? null : id);
      printDesktopLink(url);
    } else registerRoot(root);
  } catch (e) {
    console.error(msg('panelLaunchError', { error: e.message }));
    return;
  }
  const notice = desktop && optional(path.join(root, id, 'notice.json'));
  if (notice && ['failed', 'unknown', 'wake_warning'].includes(notice.state)) {
    console.error(msg('handoffNoticeIssue', { id, detail: notice.detail || msg('deliveryUnknown') }));
    return;
  }
  if (noticeWarning !== 'noticePermission' && desktop && ['resume', 'steer'].includes(notify) && destination === process.env.CODEX_THREAD_ID)
    console.error(
      msg('handoff'),
    );
}
async function confirm(question) {
  const { createInterface } = await import('node:readline/promises');
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^(y|yes|)$/i.test((await prompt.question(question)).trim());
  } finally {
    prompt.close();
  }
}

export async function main([action, ...args]) {
  const ready = (value) => {
    if (process.connected) process.send({ value }, () => {});
  };
  if (action === '_run' || action === '_serve' || action === '_onboard') {
    try {
      if (action === '_run') await (await import('./worker.js')).run(args[0], ready);
      else if (action === '_onboard') ready(await serve(0, { onboarding: true }));
      else ready(await serve(Number(args[0])));
    } catch (e) {
      if (process.connected) process.send({ error: e.message }, () => {});
      throw e;
    }
    return;
  }
  if (action === '_hook') {
    const { receive } = await import('./receiver.js');
    let input = '';
    for await (const chunk of process.stdin.setEncoding('utf8')) input += chunk;
    await receive(JSON.parse(input));
    return;
  }
  if (action === '_observe' || action === '_watch') {
    const task = read(path.join(args[0], 'task.json'));
    if (action === '_hook') {
    const { receive } = await import('./receiver.js');
    let input = '';
    for await (const chunk of process.stdin.setEncoding('utf8')) input += chunk;
    await receive(JSON.parse(input));
    return;
  }
  if (action === '_observe') await observe(task);
    else {
      const { waitChat } = await import('./chat.js');
      const results = await Promise.all((task.watch.chats || [task.watch.chat]).map(chat =>
        waitChat({ ...task.watch, chat })));
      process.exitCode = results.some(code => code !== 0) ? 1 : 0;
    }
    return;
  }
  if (!action || ['--help', '-h', 'help'].includes(action)) {
    console.log(usage());
    return;
  }
  if (action === '--version' || action === '-V') {
    console.log(read(path.join(path.dirname(entry), 'package.json')).version);
    return;
  }
  if (!Object.hasOwn(help, action)) throw Error(msg('unknownCommand', { action }));
  if (['-h', '--help'].includes(args[0])) {
    console.log(usage(action));
    return;
  }
  const { v, p, argv, rules } = parse(action, args);
  const expected = ['attach', 'wait-chat', 'show', 'logs', 'stop', 'resolve', 'retry-notice'].includes(action) ? 1 : 0;
  if (action === 'wait-chat' ? !p.length : p.length !== expected) throw Error(usage(action));
  if (['start', 'wait-chat', 'attach'].includes(action)) return register(action, v, p, argv, rules);
  if (action === 'setup') {
    if (v.rules && v['no-rules']) throw Error(msg('rulesConflict'));
    const skillOnly = v['skill-only'];
    const result = await setup({ skillOnly, rules: v.rules ? true : v['no-rules'] ? false : undefined });
    if (skillOnly) return;
    const guide = !v['no-open'] && guideAvailable();
    // The rule is a recommendation: the guide offers it, a terminal asks, and
    // an unattended install leaves AGENTS.md alone unless --rules is given.
    if (!result.rules && !v['no-rules'] && !guide) {
      if (process.stdin.isTTY && process.stdout.isTTY && await confirm(msg('rulesPrompt', { path: shortPath(rulesPath()) }))) {
        await setRules(true);
        console.log(msg('setupEnabled', { path: shortPath(rulesPath()) }));
      } else console.log(msg('rulesSkipped'));
    }
    if (guide) await openSetupGuide();
    return;
  }
  if (action === 'panel') {
    if (Object.keys(v).length > 1) throw Error(msg('panelConflict'));
    console.log(await launch(v.all ? null : v.chat || process.env.CODEX_THREAD_ID, v.task));
    return;
  }
  if (action === 'list') {
    for (const t of records(home())
      .map(status)
      .sort((a, b) => b.started - a.started)) {
      console.log([t.id, taskState(t), t.name, formatCommand(t.argv)].join('\t'));
    }
    return;
  }
  const dir = folder(p[0]),
    task = status(dir);
  if (action === 'show') console.log(JSON.stringify(task, null, 2));
  else if (action === 'logs') console.log(tail(dir).join('\n'));
  else if (action === 'retry-notice') {
    const notice = await retryNotice(dir, task);
    if (notice.state === 'wake_warning') console.error(msg('wakeWarning') + '\n' + notice.detail);
    else if (['queued', 'steered', 'received'].includes(notice.state)) console.log(msg(notice.state));
    else throw Error(notice.detail);
  } else if (action === 'resolve') {
    const reason = v.reason?.trim();
    if (!reason) throw Error(msg('noReason'));
    if (task.status !== 'failed' || !task.ended) throw Error(msg('resolveFailed'));
    await withFileLock(path.join(dir, 'resolution.lock'), () => {
      const file = path.join(dir, 'task.json'),
        latest = read(file);
      if (latest.resolution?.reason !== reason)
        save(file, { ...latest, resolution: { reason, time: now() } });
    });
    console.log(msg('resolvedSaved'));
  } else if (isActive(task.status)) {
    fs.closeSync(fs.openSync(path.join(dir, 'stop'), 'a'));
    console.log(msg('stopRequested'));
  } else console.log(task.status);
}
