import { msg } from '../src/locale.js';
import { panelModules } from '../src/dashboard.js';
import { catalogs } from '../src/web/i18n.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { Readable } from 'node:stream';
import { setup } from '../src/setup.js';
import { entry } from '../src/store.js';
import { exec, sandbox, until, port } from './helpers.js';

test('unattended setup installs the skill and requires explicit consent for the global rule', async t => {
  const h = sandbox(t), codexHome = path.join(h.dir, 'codex-profile');
  const output = { write() {} };
  const options = { userHome: h.dir, codexHome, input: Readable.from([]), output };
  const file = path.join(codexHome, 'AGENTS.md');
  const link = path.join(h.dir, '.agents/skills/backsoon');
  await setup(options);
  assert.ok(fs.existsSync(path.join(link, 'SKILL.md')));
  assert.equal(fs.existsSync(file), false);
  await Promise.all([setup({ ...options, yes: true }), setup({ ...options, yes: true })]);
  const rules = fs.readFileSync(file, 'utf8');
  assert.match(rules, /backsoon attach PID/);
  assert.equal(rules.split('<!-- BackSoon: start -->').length, 2);
  fs.unlinkSync(link);
  fs.mkdirSync(link);
  await assert.rejects(setup(options), { message: msg('skillConflict', { link }) });
  assert.equal(fs.readFileSync(file, 'utf8'), rules);
});

test('interactive setup preserves existing rules, including line endings, and prompts only before adding', async t => {
  const h = sandbox(t), codexHome = path.join(h.dir, '.codex');
  fs.mkdirSync(codexHome);
  const file = path.join(codexHome, 'AGENTS.md'), previous = '# Project rules\r\nKeep this sentence.';
  fs.writeFileSync(file, previous);
  async function run(answer) {
    let transcript = '';
    const input = Readable.from([answer]);
    input.isTTY = true;
    await setup({ userHome: h.dir, codexHome, input, output: { isTTY: true, write(s) { transcript += s; } } });
    return transcript;
  }
  for (const decline of ['n\n', '\n']) {
    assert.match(await run(decline), /\[y\/N\]/);
    assert.equal(fs.readFileSync(file, 'utf8'), previous);
  }
  assert.match(await run('Y\n'), /\[y\/N\]/);
  const applied = fs.readFileSync(file, 'utf8');
  assert.ok(applied.startsWith(previous + '\r\n\r\n'));
  assert.doesNotMatch(applied, /(?<!\r)\n/);
  assert.match(applied, /backsoon start/);
  assert.doesNotMatch(await run('\n'), /\[y\/N\]/);
  assert.equal(fs.readFileSync(file, 'utf8'), applied);
});

test('install the packed npm archive and run it outside the checkout', async (t) => {
  const h = sandbox(t),
    repo = path.dirname(entry),
    prefix = path.join(h.dir, 'install');
  const env = { ...h.env };
  delete env.NODE_PATH;
  delete env.CODEX_THREAD_ID;
  delete env.BACKSOON_HOME;
  const npm = (...args) => exec('npm', args, { cwd: h.dir, env, timeout: 120000 });
  const packed = JSON.parse((await npm('pack', repo, '--json')).stdout)[0];
  assert.equal(packed.name, 'backsoon');
  const names = packed.files.map((f) => f.path);
  const brandFiles = [
    'README.md', 'README.zh-CN.md', 'logo.svg', 'logo-dark.svg', 'mark.svg', 'mark-dark.svg',
    'mark-mono.svg', 'avatar.png', 'social.svg', 'social.png',
  ].map((file) => 'brand/' + file);
  for (const file of brandFiles) assert.ok(names.includes(file), file);
  for (const locale of Object.keys(catalogs)) {
    assert.ok(names.includes('src/web/' + locale + '.js'), locale);
    assert.ok(names.includes(locale === 'en' ? 'README.md' : 'README.' + locale + '.md'), locale);
  }
  assert.ok(names.includes('CONTRIBUTING.md'));
  assert.ok(names.includes('LICENSE'));
  assert.ok(names.includes('skills/backsoon/SKILL.md'));
  const scripts = panelModules.map(name => 'src/web/' + name + '.js');
  for (const file of scripts) assert.ok(names.includes(file), file);
  assert.ok(names.includes('src/web/index.html'));
  assert.ok(
    names.every(
      (f) =>
        ['package.json', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'backsoon', 'skills/backsoon/SKILL.md'].includes(f) ||
        Object.keys(catalogs).some((locale) => f === 'README.' + locale + '.md') ||
        brandFiles.includes(f) || scripts.includes(f) ||
        /^src\/[\w-]+\.js$/.test(f) ||
        /^src\/web\/(index\.html|style\.css)$/.test(f),
    ),
  );
  const archive = fs.readFileSync(path.join(h.dir, packed.filename));
  const server = http.createServer((req, res) => {
    if (req.url !== '/backsoon.tgz') return res.writeHead(404).end();
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream', 'Content-Length': archive.length, 'Cache-Control': 'no-cache',
    }).end(archive);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const tgz = 'http://127.0.0.1:' + server.address().port + '/backsoon.tgz';
  const npx = (...args) =>
    exec('npx', ['--yes', '--package=' + tgz, 'backsoon', ...args], {
      cwd: h.dir,
      env,
      timeout: 120000,
    });
  const trial = await npx(
    'start',
    '--notify',
    'off',
    '--no-panel',
    '--',
    'sh',
    '-c',
    'while [ ! -f release ]; do sleep .05; done; echo 完成',
  );
  const id = trial.stdout.trim();
  assert.match(id, /^[a-f0-9]{12}$/);
  h.write('release', '');
  await npm('install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', tgz);
  const installed = path.join(prefix, 'bin/backsoon');
  const run = (...args) =>
    exec(installed, args, { cwd: h.dir, env, timeout: 10000 }).then((v) => v.stdout.trim());
  assert.equal(await run('--version'), packed.version);
  assert.match(await run('setup', '--help'), /--yes/);
  await until(async () => JSON.parse(await run('show', id)).status === 'succeeded');
  assert.equal(await run('logs', id), '完成');
  env.BACKSOON_PORT = String(await port());
  const url = await run('panel', '--task', id);
  assert.match(await (await fetch(url)).text(), /BackSoon/);
  for (const name of [...panelModules, 'task']) {
    const script = await fetch(new URL('/' + name + '.js', url));
    assert.equal(script.status, 200, name);
    assert.match(script.headers.get('content-type'), /text\/javascript/, name);
  }
  assert.equal((await fetch(new URL('/worker.js', url))).status, 404);
  for (const name of ['logo', 'logo-dark', 'mark', 'mark-dark', 'mark-mono']) {
    const asset = await fetch(new URL('/brand/' + name + '.svg', url));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(await asset.text(), /<title>BackSoon<\/title>/);
  }
  assert.equal(fs.readFileSync(path.join(h.dir, '.backsoon/.gitignore'), 'utf8'), '*\n');
  const result = await npx('show', id);
  assert.equal(JSON.parse(result.stdout).code, 0);
});
