# Getting started

[README](../README.md) / Getting started / [简体中文](zh-CN/getting-started.md)

## Try it

You need macOS or Linux and Node.js 22 or later with npm. Try a task straight from npm, without installing anything globally or connecting a chat:

```sh
task=$(npx --yes backsoon start --notify off --no-panel -- sh -c 'echo Starting; sleep 3; echo Done')
npx --yes backsoon panel --task "$task"
```

Open the printed URL. After three seconds the task shows **Completed**. Select it to open the detail window and see both lines of output.

## Install for everyday use

```sh
npm i -g backsoon
backsoon setup
```

To install directly from backsoon.dev, use the same setup command after installing the archive.

```sh
npm i -g https://backsoon.dev/backsoon.tgz && backsoon setup
```

During setup, enter `y` to add the BackSoon rule to `~/.codex/AGENTS.md` (or `$CODEX_HOME/AGENTS.md`). Press Enter to install only the skill. For unattended installation with the rule, run `backsoon setup --yes`. To remove the rule, delete the block between the BackSoon comments, including the comments.

The first command installs the CLI and panel. The second makes the skill available to Codex for this user. Check that your Codex CLI supports `codex queue --resume` with `codex queue --help`. Then open a new chat and ask “Use BackSoon to run `sleep 3` and tell me when it finishes.”

Run the install command again to update. To uninstall, remove the skill link created by setup at `~/.agents/skills/backsoon`, then run `npm uninstall -g backsoon`.

## Language

English is the fallback. The terminal and chat notifications use the first nonempty setting among `BACKSOON_LANG`, `LC_ALL`, `LC_MESSAGES` and `LANG`. For example, run `BACKSOON_LANG=ja backsoon --help` or export the variable before starting a task. Supported values are `en`, `zh-CN`, `zh-TW`, `ja` and `ko`. Regional forms such as `zh-HK` and `ko_KR.UTF-8` also work.

The panel follows the browser's preferred languages. Use the language menu to save a different choice for that browser. Commands, log output, script-provided text, task IDs and JSON field names are preserved.

## Next steps

See [usage](usage.md) for every command, the panel and chat notifications, and [progress and alerts](progress.md) to measure your own work.
