import { test, expect } from '@playwright/test';
import fs from 'node:fs';
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
