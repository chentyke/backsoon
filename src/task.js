const activeStates = new Set(['starting', 'running', 'stopping']);
const finishedActivityStates = new Set(['succeeded', 'failed', 'stopped', 'skipped']);

export function isActive(status) {
  return activeStates.has(status);
}

export function taskState(task) {
  return task.resolution ? 'resolved' : task.status;
}

export function commandResult(code, attached, stopping) {
  let status;
  if (stopping) status = 'stopped';
  else if (code !== 0) status = 'failed';
  else status = attached ? 'exited' : 'succeeded';
  return { status, code: attached ? null : code };
}

export function finishedCount(items) {
  return items.filter(item => finishedActivityStates.has(item.state)).length;
}

export function taskPercent(task) {
  const state = taskState(task);
  if (state === 'succeeded' || state === 'resolved') return 100;
  if (Number.isFinite(task.percent) && task.percent >= 0 && task.percent <= 100) return task.percent;
  const items = task.activities || [];
  if (items.length && items.every(item => item.kind === 'checks' || item.kind === 'chat'))
    return 100 * finishedCount(items) / items.length;
  if (items.length === 1) {
    const { done, total } = items[0];
    if (Number.isFinite(done) && Number.isFinite(total) && done >= 0 && done <= total && total > 0)
      return 100 * done / total;
  }
  return null;
}

export function formatCommand(argv) {
  return argv.map(arg => /^[\w./:@%+=,-]+$/.test(arg) ? arg :
    "'" + arg.replaceAll("'", "'\\''") + "'").join(" ");
}
