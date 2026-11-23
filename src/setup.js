import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { msg } from './locale.js';
import { entry, withFileLock } from './store.js';

function installSkill(userHome) {
  const target = path.join(path.dirname(entry), 'skills/backsoon');
  const link = path.join(userHome, '.agents/skills/backsoon');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  try {
    fs.symlinkSync(target, link);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (
      !fs.lstatSync(link).isSymbolicLink() ||
      path.resolve(path.dirname(link), fs.readlinkSync(link)) !== target
    )
      throw Error(msg('skillConflict', { link }));
  }
  return link;
}

const marker = '<!-- BackSoon: start -->';
const instructions = [
  marker,
  '## BackSoon',
  '',
  'For downloads, builds, tests and other noninteractive commands expected to take minutes, use the BackSoon skill and launch the command through `backsoon start --notify resume -- COMMAND`, including build retries after a fix. For an already-running command, use `backsoon attach PID --notify resume` before the first manual progress check. Keep its original permissions and honor requests to run in the foreground.',
  'When the next step needs the result, keep chat notifications enabled (resume or steer). After receiving the task ID, end the turn and continue on notification. Leave routine progress checks to BackSoon. Read logs for a reported problem or when the user asks.',
  '<!-- BackSoon: end -->',
];

function readInstructions(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function installed(content) {
  return content.split(/\r?\n/).includes(marker);
}

async function confirm(file, input, output) {
  if (!input.isTTY || !output.isTTY) {
    output.write(msg('setupNoninteractive') + '\n');
    return false;
  }
  const lines = createInterface({ input });
  try {
    output.write(msg('setupPrompt', { path: file }) + ' [y/N] ');
    for await (const line of lines) return /^(y|yes)$/i.test(line.trim());
    return false;
  } finally {
    lines.close();
  }
}

export async function setup({ yes = false, userHome = os.homedir(),
  codexHome = process.env.CODEX_HOME || path.join(userHome, '.codex'),
  input = process.stdin, output = process.stdout } = {}) {
  const link = installSkill(userHome);
  output.write(msg('skillInstalled', { path: link }) + '\n');
  const file = path.resolve(codexHome, 'AGENTS.md');
  if (!installed(readInstructions(file))) {
    if (!yes && !await confirm(file, input, output)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    await withFileLock(file, () => {
      const content = readInstructions(file);
      if (installed(content)) return;
      const newline = content.includes('\r\n') ? '\r\n' : '\n';
      let gap = '';
      if (content && !content.endsWith(newline + newline))
        gap = content.endsWith(newline) ? newline : newline + newline;
      fs.appendFileSync(file, gap + instructions.join(newline) + newline);
    });
  }
  output.write(msg('setupEnabled', { path: file }) + '\n');
}
