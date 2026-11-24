# 快速开始

[README](../../README.zh-CN.md) / 快速开始 / [English](../getting-started.md)

## 试用

需要 macOS 或 Linux、Node.js 22 或更高版本，以及随 Node.js 提供的 npm。命令、网页面板和 Codex Skill 都在同一个 npm 包里。不用全局安装，也不用连接聊天，直接运行以下两行试用。网页地址会打印在终端里。

```sh
task=$(npx --yes backsoon start --name "第一次运行" --notify off --no-panel -- sh -c 'echo 开始; sleep 3; echo 完成')
npx --yes backsoon panel --task "$task"
```

打开网址，约三秒后任务会显示“已完成”。点开任务可看到两行输出。

## 安装和更新

要在不同项目里长期使用，运行：

```sh
npm i -g backsoon
backsoon setup
```

也可以直接从 backsoon.dev 安装并设置。

```sh
npm i -g https://backsoon.dev/backsoon.tgz && backsoon setup
```

setup 会安装技能，并在 `hooks.json` 注册任务完成通知。`~/.codex/AGENTS.md`（设置了 `CODEX_HOME` 时为该目录）中的 BackSoon 规则是推荐项而非必选：加入后，Codex 会主动把耗时命令交给 BackSoon。安装引导会先展示规则内容，你确认后才写入；没有浏览器时 setup 会在终端询问，非交互安装不会修改这个文件。用 `--rules` 加入规则，用 `--no-rules` 移除。加入后重复运行 setup 会保持规则为最新，并保留文件中的其他内容。只安装技能用 `backsoon setup --skill-only`。然后信任名为“BackSoon completion notices”的四个 hook：在 Codex 桌面版打开 **设置 › 钩子**，逐一点按 **信任**；如果只有 BackSoon 需要审核，可点按 **全部信任**。在 Codex 命令行输入 `/hooks`，在事件列表按 `t` 可一次信任全部四项。如果还有其他待审核的 hook，请逐一审核。

第一行安装命令和面板。第二行让 Codex 在其他项目中也能找到 Skill，只需执行一次。更新时重新运行安装命令即可。要卸载，先删除 setup 创建的符号链接 `~/.agents/skills/backsoon`，再运行 `npm uninstall -g backsoon`。

要让结果回到聊天，先用 `codex queue --help` 确认 Codex CLI 支持 `--resume`。然后在新的 Codex 聊天里说：“用 BackSoon 在后台运行 `sleep 3`，结束后通知我。”普通终端可以使用 `--notify off`。

## 语言

终端和聊天通知按 BACKSOON_LANG、LC_ALL、LC_MESSAGES、LANG 的顺序选择语言，默认用英语。可运行 `BACKSOON_LANG=zh-CN backsoon --help` 查看中文帮助。面板跟随浏览器语言，也可用页头的菜单切换，选择会保存在当前浏览器中。命令输出保留原文。

## 下一步

全部命令、面板和聊天通知见[使用说明](usage.md)。要测量自己的工作进度，见[自定义进度](progress.md)。
