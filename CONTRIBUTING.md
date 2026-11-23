# Contributing to BackSoon

Start with a problem someone can reproduce. For a bug, include the smallest command that shows it, what you expected, what happened, your OS and the output of `node --version` and `backsoon --version`. Replace private paths, chat IDs, tokens and application output in examples. For a new command or a change to notification behavior, discuss the use case before implementing it.

## Run from source

Use macOS or Linux and Node.js 22 or later. From the project directory:

```sh
npm ci
./backsoon --help
task=$(./backsoon start --notify off --no-panel -- sh -c 'echo Ready')
./backsoon panel --task "$task"
```

Open the printed URL and expand the task. The CLI and panel run from source. Reload the page after editing browser files. The automated tests create temporary task directories and simulate Codex notifications, so no account is needed.

## Where to make a change

- `src/task.js` defines command results and displayed progress. The CLI and browser share these rules. An attached process can end without revealing its exit code.
- `src/worker.js` manages the process lifetime. `src/output.js` reads its output, `src/activity.js` recognizes individual activities, and `src/progress.js` handles progress scripts and time estimates.
- `src/store.js` reads and writes task records. It computes the percentage returned by `backsoon show` and the panel API when reading a task. Time estimates use the original measurements.
- In `src/web/`, `task-view.js` prepares the values used by both the list and the detail window. `app.js` handles selection and refreshes. Register new browser modules in `panelModules` in `src/dashboard.js`.

## Test a change

| Command | What it checks |
| --- | --- |
| `npm test` | CLI, notifications, task lifecycle, progress, all translations, and installing and running the packed archive outside the source directory. |
| `node --test tests/i18n.test.js` | Locale selection, translation coverage, substitution values and completion notifications. |
| `npm run test:panel` | Real browser tests for all five languages, localized task details, language switching and saved preferences. |

Before the first panel test, run `npx --no-install playwright install chromium`. On Linux, add `--with-deps` if system libraries are missing. If Google Chrome is already installed, use `BACKSOON_TEST_BROWSER=chrome npm run test:panel`.

CI runs the command and package tests on Ubuntu and macOS with Node.js 22 and 24. Ubuntu also runs the browser tests. To inspect the package file list locally, run `npm pack --dry-run`.

## Prepare the website download

From the repository root, build the archive served at `https://backsoon.dev/backsoon.tgz`.

```sh
mkdir -p dist
archive=$(npm pack --silent --pack-destination dist) && mv "dist/$archive" dist/backsoon.tgz
```

Upload `dist/backsoon.tgz` at that path when publishing a release. Configure the host to revalidate the file on every request (`Cache-Control: no-cache`) so repeat installations pick up the current version.

## Landing page

The project site lives in `site/` as plain HTML, CSS and JavaScript with no build step. Serve the folder with any static server, for example `npx --yes serve site`, and reload after editing. Its demo reuses the panel's row anatomy, glyphs and springs, so carry visual changes to the panel over to `site/style.css` and `site/main.js`. Its copy for all five languages lives in `site/i18n.js`; open `?lang=ja` and so on to check each one. The site isn't part of the npm package.

## Change user-facing text

English is the primary language for documentation and new messages. The catalogs live in `src/web/`, one JavaScript module per language. The CLI, worker and browser use the same message keys.

1. Add a full message to `en.js` and each translation. Use named placeholders, such as `{seconds}`, so translators can change word order. Keep command names, flags and JSON fields literal.
2. Call `msg(key, values)` where the text appears. Panel HTML uses `data-msg` for text and `data-label` for accessible names. Give static HTML an English default.
3. For a new language, register its catalog and negotiation rules in `src/web/i18n.js`, add its own-language name to the panel menu, write its getting-started guide at `docs/<locale>/getting-started.md`, add its site copy to `site/i18n.js` and link it from the READMEs. Add regional and script variants to the locale tests.
4. Test the public command and panel in that language. Keep task output and user-provided labels verbatim. Machine-readable notification markers and JSON keys must work across languages.

## Send a pull request

Describe who sees the problem, how to reproduce it, and the change in behavior. Include the commands you ran and their results. For a visible panel change, attach a before-and-after screenshot with sample task data. For a CLI change, show a short terminal example. Update the relevant user guides when changing a command or a default.

This guide draws on [Remotion’s contribution guide](https://www.remotion.dev/docs/contributing), especially its use of reproducible examples and separate instructions for testing the CLI and the interface.
