import { finishedCount, isActive, taskPercent, taskState } from '../task.js';
import { translator } from './i18n.js';

const outcomeTones = {
  succeeded: 'green', resolved: 'teal', failed: 'red', interrupted: 'orange', stopped: 'grey', exited: 'grey',
};

function scenario(task) {
  const state = taskState(task);
  const items = task.activities || [];
  const checks = items.length > 0 && items.every(item => item.kind === 'checks');
  const percent = taskPercent(task);
  const base = { state, active: isActive(state), percent, checks: checks ? items : null };
  if (!base.active) return { ...base, glyph: state, tone: outcomeTones[state], layout: 'outcome' };
  const layout = checks ? 'checks' : percent == null ? 'indeterminate' : 'progress';
  const pick = (glyph, tone, alert) => ({ ...base, glyph, tone, layout, alert });
  if (task.status === 'stopping') return pick('stopping', 'grey');
  if (task.status === 'starting') return pick('starting', 'blue');
  if (items.some(item => item.state === 'needsInput')) return pick('needsInput', 'amber', true);
  if (task.progress_error) return pick('warning', 'amber', true);
  if (task.blocker) return pick('waiting', 'amber', true);
  if (task.warned_at) return pick('overtime', 'amber', true);
  if (checks) return pick('checks', items.some(item => item.state === 'failed') ? 'red' : 'blue');
  if (items.some(item => item.kind === 'chat')) return pick('chat', 'blue');
  return pick(percent == null ? 'spin' : 'progress', 'blue');
}

const priority = { needsInput: 0, failed: 1, running: 2, pendingCheck: 3, inQueue: 4 };

export function ordered(items) {
  return [...items].sort((a, b) => (priority[a.state] ?? 5) - (priority[b.state] ?? 5));
}

export function createTaskFormatter(locale) {
  const msg = translator(locale);
  const timeOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  const time = new Intl.DateTimeFormat(locale, timeOptions);
  const dateTime = new Intl.DateTimeFormat(locale, { ...timeOptions, month: 'numeric', day: 'numeric' });

  function duration(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) return msg('seconds', { s });
    if (s < 3600) return msg('minutes', { m: Math.floor(s / 60), s: s % 60 });
    return msg('hours', { h: Math.floor(s / 3600), m: Math.floor(s / 60) % 60 });
  }

  function finishLabel(task, now) {
    const range = task.estimated_finish_range;
    const expiry = range ? range[task.estimate_from_history || task.eta_range_seconds ? 1 : 0] : task.estimated_finish;
    if (task.status !== "running" || task.watch) return "";
    if (!(expiry > now / 1000)) return "";
    const estimates = range || [task.estimated_finish];
    const times = estimates.map(t => new Date(Math.ceil(t / 60) * 60000));
    if (!times.every(date => Number.isFinite(date.getTime()))) return "";
    const today = new Date(now).toDateString();
    const formatter = times.some(date => date.toDateString() !== today) ? dateTime : time;
    const labels = times.map(date => formatter.format(date));
    const scope = (task.eta_range_seconds || task.eta_seconds != null) ? task.eta_stage : "";
    const stage = scope || (task.progress_source === "bazel" ? msg('build') : "");
    const label = task.estimate_from_history ? msg('fromHistory') :
      stage ? msg('scopeEstimate', { stage }) : msg('estimate');
    return label + " " + [...new Set(labels)].join("–");
  }

  function percentText(percent) {
    return percent == null ? msg('unknown') :
      percent < 100 && percent >= 99.95 ? ">99.9%" : Number(percent.toFixed(1)) + "%";
  }

  function clock(seconds, timestamp) {
    if (!seconds) return '';
    const date = new Date(seconds * 1000), now = new Date(timestamp);
    return (date.toDateString() === now.toDateString() ? time : dateTime).format(date);
  }

  function activityText(item) {
    const name = item.name || msg(item.kind);
    const count = item.total != null && item.done != null ? (item.kind === 'download' ? item.done + '%' : item.done + '/' + item.total) : '';
    return [name, count].filter(Boolean).join(' ');
  }

  function rowContext(task, view) {
    if (view.state === 'resolved') return task.resolution.reason;
    const items = ordered(task.activities || []);
    const first = items[0];
    if (first?.state === 'needsInput' && view.active) return activityText(first) + ' — ' + msg(first.state);
    if (task.progress_error) return msg('progressUnavailable');
    if (task.blocker) return msg('waitingFor', { reason: task.blocker });
    if (task.warned_at && view.active) return msg('overTime');
    if (task.attached_pid && task.stage && !items.some(item => ['failed', 'needsInput'].includes(item.state))) return task.stage;
    if (first) {
      if (view.checks && first.state !== 'failed' && first.state !== 'needsInput')
        return msg('checks') + ' ' + finishedCount(items) + '/' + items.length;
      return activityText(first) + (['failed', 'needsInput'].includes(first.state) ? ' — ' + msg(first.state) : '');
    }
    if (task.network_error && task.status !== 'succeeded') return task.network_error;
    if (task.status === 'failed' && task.code != null) return msg('exitCode') + ' ' + task.code;
    if (task.progress_source === 'bazel') {
      const prefix = task.action_total && task.action_done != null && !task.stage?.startsWith('[') ?
        task.action_done + '/' + task.action_total + ' ' : '';
      return prefix + (task.stage || '');
    }
    if (view.active && task.argv[0]?.split('/').pop() === 'git' &&
        ['pull', 'clone', 'fetch', 'push'].includes(task.argv[1])) return msg('gitWait', { command: task.argv[1] });
    return task.progress_script ? task.stage : '';
  }

  function describe(task, now = Date.now()) {
    const view = scenario(task);
    const age = now / 1000 - task.progress_at;
    const changed = view.active && task.progress_at && age >= 60
      ? msg('progressAgo', { time: duration(Math.floor(age / 60) * 60) }) : '';
    const end = task.ended ?? (view.active ? now / 1000 : task.updated);
    const elapsed = duration(end - task.started);
    return {
      ...view,
      label: msg(view.state),
      duration: task.attached_pid ? msg('observedFor', { time: elapsed }) : elapsed,
      context: [rowContext(task, view), changed].filter(Boolean).join(' / '),
      outcome: view.active ? '' : clock(task.ended ?? task.updated, now),
      eta: finishLabel(task, now),
    };
  }

  return { describe, duration, percentText, activityText };
}
