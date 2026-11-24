import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { entry } from '../src/store.js';
import { exec, port, until } from './helpers.js';
import { catalogs } from '../src/web/i18n.js';

test.use({ channel: process.env.BACKSOON_TEST_BROWSER || undefined });

let dir, url;
test.beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(tmpdir(), 'backsoon-browser-'));
  const env = { ...process.env, BACKSOON_HOME: path.join(dir, 'tasks'), XDG_STATE_HOME: dir, BACKSOON_PORT: String(await port()) };
  const run = (...args) => exec(entry, args, { env, cwd: dir }).then(result => result.stdout.trim());
  const id = await run('start', '--no-panel', '--notify', 'off', '--name', 'Demo', '--', 'echo', 'hello 世界');
  await until(async () => JSON.parse(await run('show', id)).ended);
  url = await run('panel', '--task', id);
});
test.afterAll(() => {
  if (!dir) return;
  const file = path.join(dir, 'backsoon/panel.json');
  if (fs.existsSync(file)) process.kill(JSON.parse(fs.readFileSync(file)).pid);
  fs.rmSync(dir, { recursive: true, force: true });
});

for (const [locale, messages] of Object.entries(catalogs)) {
  test.describe(locale, () => {
    test.use({ locale });
    test('renders task details, accepts a language change and remembers it', async ({ page }) => {
      await page.goto(url);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page).toHaveTitle(messages.pageTitle);
      const dialog = page.getByRole('dialog', { name: 'Demo' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.status')).toHaveText(messages.succeeded);
      await expect(dialog.getByText(messages.command, { exact: true })).toBeVisible();
      await expect(dialog.locator('pre')).toHaveText('hello 世界');
      await page.goto(new URL('/', url).href);
      const row = page.getByRole('button', { name: /Demo/ });
      await row.click();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('pre')).toHaveText('hello 世界');
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(row).toBeFocused();
      await row.press('Enter');
      await dialog.getByRole('button', { name: messages.closeWindow }).click();
      await expect(dialog).not.toBeVisible();
      const next = locale === 'en' ? 'ja' : 'en';
      await page.getByRole('combobox', { name: messages.language }).selectOption(next);
      await expect(page.locator('html')).toHaveAttribute('lang', next);
      await expect(row.locator('.status')).toHaveText(catalogs[next].succeeded);
      await page.goto(url);
      await expect(dialog.getByRole('button', { name: catalogs[next].closeWindow })).toBeVisible();
      await expect(page.locator('pre')).toHaveText('hello 世界');
    });
  });
}

test('compact sidebar keeps checks grouped and unchanged polls preserve expanded shards', async ({ page }) => {
  await page.setViewportSize({ width: 370, height: 650 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const task = { id:'demo', name:'PR checks', status:'running', argv:['gh','pr','checks','--watch'], started:100,
    activities: [{id:'2',kind:'checks',name:'UI (2/2)',group:'UI',state:'inQueue'},
      {id:'1',kind:'checks',name:'UI (1/2)',group:'UI',state:'failed'}] };
  await page.route('**/api/tasks', route => route.fulfill({json:[task]}));
  await page.route('**/api/logs/demo', route => route.fulfill({json:['sample log']}));
  await page.goto(new URL('/', url).href);
  const row = page.getByRole('button',{name:/PR checks/});
  await expect(row).toContainText('UI (1/2)');
  const rect = await row.boundingBox();
  expect(rect.height).toBeLessThan(60);
  await row.click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#activities summary').click();
  await expect(dialog.locator('.activity').first()).toContainText('UI (1/2)');
  task.activities[0].state = 'running';
  await expect(dialog.locator('.activity').last()).toContainText('Running');
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  await page.mouse.click(1,1);
  await expect(dialog).not.toBeVisible();
  await expect(row).toBeFocused();
});

test('an attached download shows measured work and observation time alongside the original command', async ({ page }) => {
  const task = { id:'download', name:'ISO', status:'running', argv:['curl','-o','download.iso','https://example.org/image.iso'], attached_cwd:'/downloads',
    attached_pid:123, started:Date.now()/1000 - 15, percent:75, stage:'6 / 8 GB', activities:[
      {id:'iso', name:'Download',kind:'step',state:'running'}, {id:'verify',name:'Checksum',kind:'step',state:'inQueue'}] };
  await page.route('**/api/tasks', route => route.fulfill({json:[task]}));
  await page.route('**/api/logs/download', route => route.fulfill({json:[]}));
  await page.goto(new URL('/', url).href);
  const row = page.getByRole('button',{name:/ISO/});
  await expect(row).toContainText('6 / 8 GB');
  await row.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.dialog-head .duration')).toContainText('Monitoring for');
  await expect(dialog.locator('.big-num')).toHaveText('75%');
  await expect(dialog.locator('#activities')).toContainText('Checksum');
  await expect(dialog.locator('.console')).toBeHidden();
  await expect(dialog.locator('.command')).toHaveText('curl -o download.iso https://example.org/image.iso');
  task.progress_error = 'Checksum: invalid step state';
  await expect(dialog.locator('.hint')).toContainText('Progress update unavailable');
  await dialog.locator('#metadata summary').click();
  await expect(dialog.locator('#metadata')).toContainText(task.progress_error);
});

test('an open observation follows its row into Finished without inventing a result', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const task = { id: 'observe', name: 'Observer', status: 'running', argv: ['sleep', '30'],
    started: 100, attached_pid: 123, percent: null };
  await page.route('**/api/tasks', route => route.fulfill({ json: [task] }));
  await page.route('**/api/logs/observe', route => route.fulfill({ json: [] }));
  await page.goto(new URL('/', url).href);
  await page.locator('#running .summary').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAttribute('data-layout', 'indeterminate');
  Object.assign(task, { status: 'exited', ended: 115, code: null });
  const row = page.locator('#ended .card');
  for (const surface of [row, dialog]) {
    await expect(surface).toHaveAttribute('data-state', 'exited');
    await expect(surface.locator('.glyph')).toHaveAttribute('data-key', 'exited');
    await expect(surface.locator('.status')).toHaveText(catalogs.en.exited);
    await expect(surface.locator('.duration')).toHaveText('Monitoring for 15s');
  }
  await expect(row.locator('progress')).not.toHaveAttribute('value', /.+/);
  await page.keyboard.press('Escape');
  await expect(row.getByRole('button')).toBeFocused();
});


test('setup guide shows partial, unavailable and confirmed access and supports five languages', async ({ page }) => {
  const child = fork(entry, ['_onboard'], { cwd: dir, env: { ...process.env, CODEX_HOME: path.join(dir, 'codex-mock') },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    const [reply] = await once(child, 'message');
    const status = { rules: true, trusted: 1, total: 4, file: '~/.codex/AGENTS.md', preview: '<!-- BackSoon: start -->' };
    await page.route('**/api/setup', route => route.fulfill({json:status}));
    await page.goto(reply.value);
    for (const [locale, messages] of Object.entries(catalogs)) {
      await page.locator('#language').selectOption(locale);
      await expect(page).toHaveTitle(messages.guideTitle);
      await expect(page.locator('#rules')).toHaveText(messages.guideAdded);
      await expect(page.locator('#hooks')).toHaveText(messages.guideCount.replace('{trusted}', '1').replace('{total}', '4'));
    }
    await page.locator('#language').selectOption('en');
    status.trusted = null;
    status.rules = false;
    await page.getByRole('button', {name:'Check again'}).click();
    await expect(page.locator('#rules')).toHaveText(catalogs.en.guideMissing);
    await expect(page.locator('#hooks')).toHaveText(catalogs.en.guideUnknown);
    await expect(page.locator('#rules-fix')).toHaveAttribute('data-open', 'true');
    await expect(page.locator('#preview-file')).toHaveText(catalogs.en.guidePreview.replace('{file}', 'AGENTS.md'));
    await expect(page.locator('#preview-file code')).toHaveAttribute('title', '~/.codex/AGENTS.md');
    // Trust is explained for the Codex app, naming its controls, and for the CLI.
    await expect(page.locator('#how-desktop')).toBeVisible();
    await expect(page.locator('#how-desktop')).toContainText(catalogs.en.guideAppTrustAll);
    await page.getByRole('tab', { name: catalogs.en.guideTabCli }).click();
    await expect(page.locator('#how-cli')).toContainText('/hooks');
    await expect(page.locator('#how-desktop')).toBeHidden();
    await page.locator('#language').selectOption('zh-TW');
    await page.getByRole('tab', { name: catalogs['zh-TW'].guideTabDesktop }).click();
    await expect(page.locator('#how-desktop')).toContainText(catalogs['zh-TW'].guideAppHooks);
    await expect(page.locator('#preview')).toContainText(catalogs['zh-TW'].agentsRuleStart);
    await page.locator('#language').selectOption('en');
    await expect(page.locator('#overall')).toHaveText(catalogs.en.guideStateUnknown);
    status.trusted = 4;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('#hooks')).toHaveText(catalogs.en.guideReady);
    await expect(page.locator('#how')).toBeHidden();
    // Only the hooks are required: the optional rule stays on offer.
    await expect(page.locator('#overall')).toHaveText(catalogs.en.guideAllSet);
    await expect(page.locator('#lede')).toHaveText(catalogs.en.guideDoneBody);
    await expect(page.locator('#step-rules')).toHaveAttribute('data-state', 'offer');
    await expect(page.locator('#setup')).not.toHaveAttribute('data-complete');
    await expect(page.locator('#setup .mark')).toBeHidden();
    // Settling the rule leaves nothing to do: the sign is hung, with confetti
    // that clears itself away.
    await page.getByRole('button', { name: catalogs.en.guideSkip }).click();
    await expect(page.locator('#setup')).toHaveAttribute('data-complete');
    await expect(page.locator('#setup .mark')).toBeVisible();
    await expect(page.locator('.confetti i').first()).toBeAttached();
    await expect(page.locator('.confetti')).toHaveCount(0, { timeout: 5000 });
    // Checking again does not celebrate a second time.
    await page.getByRole('button', { name: 'Check again' }).click();
    await expect(page.locator('#recheck')).toBeEnabled();
    await expect(page.locator('.confetti')).toHaveCount(0);
  } finally {
    child.kill();
  }
});

test('setup guide adds the recommended rule only after confirmation, and can skip or remove it', async ({ page }) => {
  const codex = path.join(dir, 'codex-guide'), file = path.join(codex, 'AGENTS.md');
  const child = fork(entry, ['_onboard'], { cwd: dir, env: { ...process.env, CODEX_HOME: codex },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    const [reply] = await once(child, 'message');
    await page.goto(reply.value);
    await page.locator('#language').selectOption('en');
    const rules = page.locator('#step-rules');
    await expect(rules).toHaveAttribute('data-state', 'offer', { timeout: 15000 });
    await expect(page.locator('#preview')).toContainText('backsoon start -- COMMAND');
    expect(fs.existsSync(file)).toBe(false);

    await page.getByRole('button', { name: catalogs.en.guideSkip }).click();
    await expect(rules).toHaveAttribute('data-state', 'skipped');
    await page.reload();
    await expect(rules).toHaveAttribute('data-state', 'skipped', { timeout: 15000 });
    expect(fs.existsSync(file)).toBe(false);

    await page.getByRole('button', { name: catalogs.en.guideReconsider }).click();
    // The rule is written in the language the page shows.
    await page.locator('#language').selectOption('ja');
    await page.getByRole('button', { name: catalogs.ja.guideAddRules }).click();
    await expect(rules).toHaveAttribute('data-state', 'added');
    await expect(page.locator('#rules')).toHaveText(catalogs.ja.guideAdded);
    expect(fs.readFileSync(file, 'utf8')).toContain(catalogs.ja.agentsRuleFollowUp);
    await page.locator('#language').selectOption('en');

    await page.getByRole('button', { name: catalogs.en.guideRemoveRules }).click();
    await expect(rules).toHaveAttribute('data-state', 'offer');
    expect(fs.readFileSync(file, 'utf8')).toBe('');

    // Without the token from the guide's URL, the write is refused.
    const refused = await page.evaluate(() => fetch('/api/rules', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-BackSoon-Guide': '1' }, body: '{"enabled":true}' }).then(r => r.status));
    expect(refused).toBe(403);
    expect(fs.readFileSync(file, 'utf8')).toBe('');
  } finally {
    child.kill();
  }
});
