import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { msg } from './locale.js';
import { receiverEvents } from './receiver.js';
import { openAppServer } from './rpc.js';
import { receiverCommand, receiverLabel, rulesInstalled, rulesPath, shortPath } from './setup.js';
import { detached } from './store.js';

export function printDesktopLink(url) {
  console.error(msg('panelLink', { url }));
  console.error('mcp__codex_app__open_in_codex ' + JSON.stringify({
    target: { type: 'browser', url }, placement: 'right',
  }));
}

// The guide opens in the Codex side panel or a local browser; SSH sessions,
// CI and headless Linux get the terminal flow instead.
export function guideAvailable() {
  if (process.env.CODEX_APP_TOOLS_PIPE_PATH) return true;
  return Boolean(process.stdout.isTTY && !process.env.CI && !process.env.SSH_CONNECTION &&
    (process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY));
}

export async function openSetupGuide() {
  const desktop = Boolean(process.env.CODEX_APP_TOOLS_PIPE_PATH);
  if (!guideAvailable()) return;
  try {
    const url = await detached(['_onboard']);
    if (desktop) return printDesktopLink(url);
    console.error(url);
    await promisify(execFile)(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {timeout:10000});
  } catch (error) {
    console.error(msg('guideOpenError', {error:error.message}));
  }
}

export async function setupStatus() {
  const profile = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  const rules = rulesInstalled(profile);
  const offer = { file: shortPath(rulesPath(profile)), desktop: Boolean(process.env.CODEX_APP_TOOLS_PIPE_PATH) };
  const { api, close } = openAppServer();
  try {
    const deadline = Date.now() + 5000;
    await api.initialize(deadline, { experimentalApi: true });
    const { data } = await api.call('hooks/list', { cwds: [process.cwd()] }, deadline);
    const installed = data[0].hooks.filter(h => h.sourcePath === path.join(profile, 'hooks.json') &&
      h.statusMessage === receiverLabel && h.command === receiverCommand);
    const trusted = receiverEvents.filter(event => installed.some(h =>
      h.eventName === event[0].toLowerCase() + event.slice(1) && h.enabled &&
      ['trusted', 'managed'].includes(h.trustStatus))).length;
    return { rules, trusted, total: receiverEvents.length, ...offer };
  } catch {
    return { rules, trusted:null, total:receiverEvents.length, ...offer };
  } finally {
    close();
  }
}
