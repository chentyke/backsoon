import { msg } from '../src/locale.js';
import { panelModules } from '../src/dashboard.js';
import { catalogs } from '../src/web/i18n.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { rulesInstalled, setRules, setup } from '../src/setup.js';
import { entry } from '../src/store.js';
import { exec, sandbox, until, port } from './helpers.js';

test('setup installs the skill and hooks, adds the AGENTS.md rule only when asked, and skill-only skips both', async t => {
  const h = sandbox(t), codexHome = path.join(h.dir, 'codex-profile');
  const options = { userHome: h.dir, codexHome, output: { write() {} } };
  const file = path.join(codexHome, 'AGENTS.md');
  const link = path.join(h.dir, '.agents/skills/backsoon');
  await setup({ ...options, skillOnly: true });
  assert.ok(fs.existsSync(path.join(link, 'SKILL.md')));
  assert.equal(fs.existsSync(codexHome), false);
  assert.deepEqual(await setup(options), { rules: false });
  assert.ok(fs.existsSync(path.join(codexHome, 'hooks.json')));
  assert.equal(fs.existsSync(file), false);
  await Promise.all([setup({ ...options, rules: true }), setup({ ...options, rules: true })]);
  const rules = fs.readFileSync(file, 'utf8');
  assert.match(rules, /backsoon attach PID/);
  assert.match(rules, /--after-success BUILD_ID/);
  assert.equal(rules.split('<!-- BackSoon: start -->').length, 2);
  assert.deepEqual(await setup(options), { rules: true });
  assert.equal(fs.readFileSync(file, 'utf8'), rules);
  fs.unlinkSync(link);
  fs.mkdirSync(link);
  await assert.rejects(setup(options), { message: msg('skillConflict', { link }) });
  assert.equal(fs.readFileSync(file, 'utf8'), rules);
});

test('removing the rule restores the file it was added to', async t => {
  const h = sandbox(t), codexHome = path.join(h.dir, '.codex');
  const file = path.join(codexHome, 'AGENTS.md');
  for (const original of ['', '# My rules\n', '# My rules\r\n']) {
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(file, original);
    assert.deepEqual(await setRules(true, codexHome), { present: true, changed: true });
    assert.match(fs.readFileSync(file, 'utf8'), /BackSoon: start/);
    assert.deepEqual(await setRules(false, codexHome), { present: false, changed: true });
    assert.equal(fs.readFileSync(file, 'utf8'), original, JSON.stringify(original));
    assert.deepEqual(await setRules(false, codexHome), { present: false, changed: false });
  }
  // A rule added in one language stays in that language when setup refreshes it.
  fs.writeFileSync(file, '');
  await setRules(true, codexHome, 'ja');
  const japanese = fs.readFileSync(file, 'utf8');
  assert.ok(japanese.includes(catalogs.ja.agentsRuleStart));
  assert.ok(rulesInstalled(codexHome));
  await setup({ userHome: h.dir, codexHome, locale: 'en', output: { write() {} } });
  assert.equal(fs.readFileSync(file, 'utf8'), japanese);
  const around = '# Mine\n\n<!-- BackSoon: start -->\nOld\n<!-- BackSoon: end -->\n\n## Later\n';
  fs.writeFileSync(file, around);
  await setRules(false, codexHome);
  assert.equal(fs.readFileSync(file, 'utf8'), '# Mine\n\n## Later\n');
});

test('rerunning setup replaces only its block, preserves CRLF and leaves malformed markers intact', async t => {
  const h = sandbox(t), codexHome = path.join(h.dir, '.codex');
  fs.mkdirSync(codexHome);
  const options = { userHome: h.dir, codexHome, output: { write() {} } };
  const file = path.join(codexHome, 'AGENTS.md');
  const prefix = '# My rules\r\n', suffix = '\r\n## Local rules\nUntouched';
  const old = prefix + '<!-- BackSoon: start -->\r\nOld rules\r\n<!-- BackSoon: end -->' + suffix;
  fs.writeFileSync(file, old);
  await setup({ ...options, skillOnly: true });
  assert.equal(fs.readFileSync(file, 'utf8'), old);
  await setup(options);
  const result = fs.readFileSync(file, 'utf8');
  assert.ok(result.startsWith(prefix) && result.endsWith(suffix));
  assert.doesNotMatch(result.slice(0, -suffix.length), /(?<!\r)\n|Old rules/);
  await setup(options);
  assert.equal(fs.readFileSync(file, 'utf8'), result);
  for (const broken of ['<!-- BackSoon: start -->', '<!-- BackSoon: end -->', old + '\n' + old]) {
    fs.writeFileSync(file, broken);
    await assert.rejects(setup(options), { message: msg('setupMarkers') });
    assert.equal(fs.readFileSync(file, 'utf8'), broken);
  }
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
  assert.ok(names.includes('src/web/onboarding.html'));
  assert.ok(
    names.every(
      (f) =>
        ['package.json', 'README.md', 'LICENSE', 'CONTRIBUTING.md', 'backsoon', 'skills/backsoon/SKILL.md'].includes(f) ||
        Object.keys(catalogs).some((locale) => f === 'README.' + locale + '.md') ||
        brandFiles.includes(f) || scripts.includes(f) ||
        /^src\/[\w-]+\.js$/.test(f) ||
        /^src\/web\/((?:index|onboarding)\.html|style\.css)$/.test(f),
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
  assert.match(await run('setup', '--help'), /--skill-only/);
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

test('unattended setup leaves AGENTS.md alone unless --rules is given', async t => {
  const h = sandbox(t);
  h.env.HOME = h.dir;
  h.env.CODEX_HOME = path.join(h.dir, 'profile');
  const file = path.join(h.env.CODEX_HOME, 'AGENTS.md');
  const first = await exec(entry, ['setup'], {env:h.env, cwd:h.dir});
  assert.doesNotMatch(first.stderr, /http:\/\//);
  assert.match(first.stdout, /backsoon setup --rules/);
  assert.equal(fs.existsSync(file), false);
  h.env.CODEX_APP_TOOLS_PIPE_PATH = 'desktop';
  const again = await exec(entry, ['setup', '--no-open', '--rules'], {env:h.env, cwd:h.dir});
  assert.doesNotMatch(again.stderr, /open_in_codex/);
  assert.match(fs.readFileSync(file, 'utf8'), /backsoon start/);
  await assert.rejects(exec(entry, ['setup', '--rules', '--no-rules'], {env:h.env, cwd:h.dir}));
  await exec(entry, ['setup', '--no-open', '--no-rules'], {env:h.env, cwd:h.dir});
  assert.equal(fs.readFileSync(file, 'utf8'), '');
});
