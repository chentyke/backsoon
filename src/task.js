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

// A failing command often prints its cause above trailing noise such as a
// stack trace or a runtime version banner. Keep the last few lines, and the
// latest unindented diagnostic line when it falls before them.
const diagnostic = /error|fail|fatal|panic|exception|assert|traceback|denied|cannot|unable|not found/i;
export function failureExcerpt(lines, shown = 6) {
  const recent = lines.filter(line => line.trim()).slice(-40).map(line => line.slice(0, 240));
  const end = recent.slice(-shown);
  const cause = recent.findLastIndex(line => /^\S/.test(line) && diagnostic.test(line));
  if (cause < 0 || cause >= recent.length - shown) return end.join('\n');
  return [recent[cause], ...(cause < recent.length - shown - 1 ? ['…'] : []), ...end].join('\n');
}

export function formatCommand(argv) {
  return argv.map(arg => /^[\w./:@%+=,-]+$/.test(arg) ? arg :
    "'" + arg.replaceAll("'", "'\\''") + "'").join(" ");
}
