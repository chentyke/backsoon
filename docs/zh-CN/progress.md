# 自定义进度

[README](../../README.zh-CN.md) · 自定义进度 · [English](../progress.md)

## 进度脚本

如果命令会打印整项任务的百分比，可以直接运行。Bazel 构建按它报告的已完成项数和总数显示进度，子工具的百分比只留在日志中。其他多步骤命令如果只有单步百分比，或没有进度输出，可以让模型写一个独立脚本，读取实际完成的工作量。比如转换一批文件时，任务把待处理文件列在 `manifest.json` 中，每成功转换一个就原子地写出对应的结果文件。

```js
// progress.mjs
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const names = JSON.parse(readFileSync('manifest.json', 'utf8'));
const done = names.filter(name => statSync(join('results', name), { throwIfNoEntry: false })?.isFile()).length;
console.log(JSON.stringify({
  percent: names.length ? 100 * done / names.length : null,
  stage: `已转换 ${done}/${names.length} 个文件`,
}));
```

```sh
backsoon start --name "转换文件" --notify off \
  --progress-script ./progress.mjs --progress-interval 5 -- node convert.mjs
```

脚本在任务工作目录执行，每次输出一个 JSON 对象。可填写 `percent`（0 到 100）、`stage`（当前步骤）、`blocker`（实际在等什么）。至少填写一项，每次成功输出会替换上一份报告。省略 `blocker` 即可清除等待原因。提供了脚本时，以脚本测量的进度为准。

默认每次脚本结束后等 5 秒再运行。脚本可读取 `BACKSOON_TASK_ID`、`BACKSOON_TASK_PID`、`BACKSOON_TASK_DIR` 和 `BACKSOON_TASK_LOG`，分别是任务编号、主进程编号、任务记录目录和输出日志路径。支持 JavaScript 文件（推荐 `.mjs`）或带执行权限的脚本。单次运行超过 5 秒、输出超过 8 KiB 或格式有误时，面板显示错误并保留上次测量，下一次检查会重试。任务停止或结束时，正在运行的进度脚本也会结束。

脚本知道剩余字节数和下载速度等信息时，可返回 `eta_seconds`（预计剩余秒数），面板优先使用它。脚本也可返回固定的阶段名 `phase`，例如 `download` 或 `compile`。阶段切换时重新估算，`stage` 仍可随时更新当前文件或步骤。

如果有可比任务的实测耗时，可以只给某个阶段估算范围。比如脚本此刻根据历史记录算出还需 2 到 4 分钟，就返回 `{"eta_stage":"编译","eta_range_seconds":[120,240]}`。每次测量都按同一预计结束时刻重新计算剩余秒数。已过去的下限填 0，超过上限或进入下一阶段就撤下旧估计。历史记录可以来自其他目录，先确认工作内容、运行条件和计时起点相近。只有算得出预计完成时间时，详情窗口才会显示。

只有脚本确认百分比代表耗时相近的工作量，才返回 `"uniform_work": true` 启用按速度估算。例如按字节计算的连续传输可以使用，同一批中耗时不同的步骤只显示进度。最近三分钟内至少要有五次不同读数，跨越一分钟。面板用前后两段的速度分别推算完成时间，显示两者之间的本地时间范围。同一分钟只显示一次。速度相差超过一倍、剩余时间短于一次典型读数间隔、总数改变、进度回退或遇到卡点时，隐藏旧时间。没有新进展时只会撤下失效的估计。

其余命令可以参考以往用时。面板在同一任务目录中查找工作目录、命令参数和进度脚本相同的最近三次成功记录。三次耗时相差不超过一倍时，显示按最快和最慢两次推算的完成时间，并标明估算依据。超过范围后撤下。等待聊天、观察已有进程和记录不足的首次构建都不会据此推算。

训练和批量实验可以用 `steps` 分项报告。每次返回当前的完整列表，例如 `{"steps":[{"name":"模型 A","state":"succeeded","done":5,"total":5},{"name":"模型 B","state":"running","done":4,"total":5}]}`。等待中的步骤用 `inQueue` 或 `pending`，成功的步骤用 `succeeded` 或 `completed`。其他状态包括 `running`、`failed`、`needsInput`、`stopped` 和 `skipped`。保留已完成的模型，就能在窗口里同时看到结果和新进展。
