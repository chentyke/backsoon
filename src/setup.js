import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { locale as terminalLocale, msg } from './locale.js';
import { catalogs, rulesLines } from './web/i18n.js';
import { receiverEvents } from './receiver.js';
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


function readInstructions(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function markers(content) {
  const marks = [...content.matchAll(/^<!-- BackSoon: (start|end) -->(?=\r?$)/gm)];
  if (marks.length && (marks.length !== 2 || marks[0][1] !== 'start' || marks[1][1] !== 'end'))
    throw Error(msg('setupMarkers'));
  return marks;
}

function updatedInstructions(content, locale) {
  const marks = markers(content);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const block = rulesLines(locale).join(newline);
  if (!marks.length) {
    const gap = !content || content.endsWith(newline + newline) ? '' : content.endsWith(newline) ? newline : newline + newline;
    return content + gap + block + newline;
  }
  return content.slice(0, marks[0].index) + block + content.slice(marks[1].index + marks[1][0].length);
}

// Removing undoes what adding did: the block, its line break and the blank
// line that separated it from earlier content.
function removedInstructions(content) {
  const marks = markers(content);
  if (!marks.length) return content;
  let before = content.slice(0, marks[0].index);
  let after = content.slice(marks[1].index + marks[1][0].length).replace(/^\r?\n/, '');
  if (!after) before = before.replace(/(\r?\n)\r?\n$/, '$1');
  else if (/\n\r?\n$/.test(before)) after = after.replace(/^\r?\n/, '');
  return before + after;
}

function writeAtomically(target, content) {
  const temp = target + '.' + randomUUID() + '.tmp';
  try {
    const mode = fs.statSync(target, { throwIfNoEntry: false })?.mode;
    fs.writeFileSync(temp, content, { flag: 'wx', mode: 0o600 });
    if (mode != null) fs.chmodSync(temp, mode & 0o777);
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

const defaultCodexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
export const rulesPath = (codexHome = defaultCodexHome()) => path.resolve(codexHome, 'AGENTS.md');
// Paths shown to people start from ~ when they are inside the home folder.
export function shortPath(file) {
  const home = os.homedir();
  return file.startsWith(home + path.sep) ? '~' + file.slice(home.length) : file;
}

// enabled: true adds or refreshes the block, false removes it, and undefined
// refreshes it only where the user added it before. Returns whether the
// block is present afterwards.
// The language of a current block, if the file holds one.
function rulesLocale(content) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  return Object.keys(catalogs).find(locale => content.includes(rulesLines(locale).join(newline)));
}

function applyRules(codexHome, enabled, locale) {
  const file = rulesPath(codexHome);
  const target = fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() ? fs.realpathSync(file) : file;
  const original = readInstructions(target);
  const present = markers(original).length > 0;
  const keep = enabled ?? present;
  // A refresh keeps the language the user chose; an explicit add uses the one given.
  const language = enabled === undefined ? rulesLocale(original) ?? locale : locale;
  const updated = keep ? updatedInstructions(original, language) : removedInstructions(original);
  if (updated !== original) writeAtomically(target, updated);
  return { present: keep, changed: updated !== original };
}

export async function setRules(enabled, codexHome = defaultCodexHome(), locale = terminalLocale) {
  fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  return withFileLock(path.join(codexHome, '.backsoon-setup.lock'), () => applyRules(codexHome, enabled, locale));
}

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export const receiverCommand = quote(process.execPath) + ' ' + quote(entry) + ' _hook';
export const receiverLabel = 'BackSoon completion notices';

function installReceiver(codexHome) {
  const command = receiverCommand, statusMessage = receiverLabel;
  const file = path.join(codexHome, 'hooks.json');
  const target = fs.existsSync(file) ? fs.realpathSync(file) : file;
  const original = readInstructions(target);
  const config = original ? JSON.parse(original) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw Error('Expected a Codex hooks configuration object');
  config.hooks ??= {};
  if (typeof config.hooks !== 'object' || Array.isArray(config.hooks))
    throw Error('Expected a Codex hooks object');
  let changed = false;
  for (const event of receiverEvents) {
    const groups = config.hooks[event] ??= [];
    const existing = groups.flatMap(group => group.hooks || []).find(h =>
      h.type === 'command' && h.statusMessage === statusMessage && h.command?.endsWith(' _hook'));
    if (existing?.command === command) continue;
    if (existing) existing.command = command;
    else groups.push({hooks:[{type:'command', command, statusMessage}]});
    changed = true;
  }
  if (!changed) return;
  const temp = target + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', {flag:'wx', mode:0o600});
    fs.renameSync(temp, target);
  } finally {
    fs.rmSync(temp, {force:true});
  }
}

export async function setup({ skillOnly = false, rules, locale = terminalLocale, userHome = os.homedir(),
  codexHome = defaultCodexHome(), output = process.stdout } = {}) {
  const link = installSkill(userHome);
  output.write(msg('skillInstalled', { path: link }) + '\n');
  if (skillOnly) return { rules: null };
  fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  const result = await withFileLock(path.join(codexHome, '.backsoon-setup.lock'), () => {
    installReceiver(codexHome);
    return applyRules(codexHome, rules, locale);
  });
  if (result.present) output.write(msg('setupEnabled', { path: shortPath(rulesPath(codexHome)) }) + '\n');
  output.write(msg('hookSetup') + '\n');
  return { rules: result.present };
}

export function rulesInstalled(codexHome) {
  return Boolean(rulesLocale(readInstructions(path.join(codexHome, 'AGENTS.md'))));
}
