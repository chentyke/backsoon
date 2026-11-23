# Progress and alerts

[README](../README.md) · Progress and alerts · [简体中文](zh-CN/progress.md)

## Progress scripts

BackSoon reads percentages and Bazel action counts from output. For multi-stage work, pass `--progress-script ./progress.mjs`. For example, a converter that writes one result file per input can report actual completed work:

```js
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const names = JSON.parse(readFileSync('manifest.json', 'utf8'));
const done = names.filter(name => statSync(join('results', name), { throwIfNoEntry: false })?.isFile()).length;
console.log(JSON.stringify({
  percent: names.length ? 100 * done / names.length : null,
  stage: `Converted ${done}/${names.length} files`,
}));
```

The script runs in the task's working directory. Each reading replaces the previous report. It can read `BACKSOON_TASK_ID`, `BACKSOON_TASK_PID`, `BACKSOON_TASK_DIR` and `BACKSOON_TASK_LOG`. Use JavaScript or a directly executable script. The default interval is five seconds after each reading. Override it with `--progress-interval`. Readings that exceed five seconds or 8 KiB, or contain invalid data, leave the previous reading in place. The panel displays the error and retries at the next interval.

| JSON field | Meaning |
| --- | --- |
| `percent`, `stage`, `blocker` | Percentage (0–100), current step and what the task is waiting for. Omit a cleared blocker in the next report. |
| `eta_seconds` or `eta_range_seconds` | Remaining seconds, or lower and upper bounds. Use `eta_stage` to name the stage being estimated. |
| `phase`, `uniform_work` | A stable phase name resets the estimate when it changes. Set `uniform_work` to true only when similar units take similar time. |
| `steps` | A snapshot of independent jobs. Each needs a unique `name` and a `state` (running, succeeded, failed, needsInput, inQueue, stopped or skipped). A script may also use `pending` for inQueue and `completed` for succeeded. Include optional `done`, `total` and `detail`. Keep completed jobs in subsequent readings to retain them in the window. |
| `alerts` | Map stable condition names to messages. A condition alerts once until it clears. Return an empty object for a reading with no active alerts. |

Without a script estimate, the panel can use recent measured speed or the durations of three comparable successful runs. Unreliable or expired estimates disappear. Use `--warn-after SECONDS` for a one-time time reminder, or repeat `--alert-on NAME PATTERN` to alert on the first matching output line for each named condition.
