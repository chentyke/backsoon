import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { entry, withFileLock } from '../src/store.js';
import { exec, port, sandbox, until } from './helpers.js';

for (const timing of ['during handoff', 'after handoff']) {
  test('compile then install once when completion arrives ' + timing, async t => {
    const h = sandbox(t);
    h.env.CODEX_APP_TOOLS_PIPE_PATH = 'desktop';
    h.env.BACKSOON_PORT = String(await port());
    h.write('hello.c', '#include <stdio.h>\nint main(void) { puts("Installed"); }\n');
    const start = () => exec(entry, ['start', '--', 'sh', '-ec',
      'while [ ! -e build-now ]; do sleep .03; done; cc hello.c -o hello'], { env: h.env, cwd: h.dir });
    let handoff;
    if (timing === 'during handoff') {
      // Hold panel startup to keep the original turn in its handoff while the worker reports completion.
      fs.mkdirSync(path.dirname(h.panelFile), { recursive: true });
      await withFileLock(path.join(path.dirname(h.panelFile), 'panel-start.lock'), async () => {
        handoff = start();
        h.write('build-now', '');
        await until(() => h.calls().length === 1);
      });
    } else {
      handoff = await start();
      assert.equal(h.calls().length, 0);
      h.write('build-now', '');
    }
    const { stdout, stderr } = await handoff;
    const build = stdout.trim();
    const callLine = stderr.split('\n').find(line => line.startsWith('mcp__codex_app__open_in_codex '));
    const panel = JSON.parse(callLine.slice(callLine.indexOf(' ') + 1));
    assert.equal(panel.placement, 'right');
    assert.equal(panel.target.type, 'browser');
    assert.equal(new URL(panel.target.url).pathname, '/chats/origin');
    assert.equal((await fetch(panel.target.url)).status, 200);
    assert.match(stderr, /final reply/);
    const [notice] = await until(() => h.calls().length && h.calls());
    assert.deepEqual(notice.slice(0, 4), ['queue', '--resume', '--thread', 'origin']);
    assert.ok(notice[notice.indexOf('--message') + 1].startsWith('[BackSoon ' + build + ' done]'));
    const install = () => h.cli('start', '--after-success', build, '--', 'sh', '-ec',
      'mkdir -p bin; install -m 755 hello bin/hello; echo install >> installs');
    const [first, duplicate] = await Promise.all([install(), install()]);
    assert.equal(first, duplicate);
    assert.equal((await h.ended(first)).code, 0);
    assert.equal(await install(), first);
    assert.equal(fs.readFileSync(path.join(h.dir, 'installs'), 'utf8'), 'install\n');
    assert.equal((await exec(path.join(h.dir, 'bin/hello'))).stdout.trim(), 'Installed');
    await until(() => h.calls().length === 2);
    const other = ['start', '--after-success', build, '--', 'false'];
    await assert.rejects(h.cli(...other), error => error.stderr.includes(first));
  });
}

test('a failed build cannot launch its installation', async t => {
  const h = sandbox(t);
  const build = await h.cli('start', '--', 'false');
  await h.ended(build);
  await assert.rejects(h.cli('start', '--after-success', build, '--', 'touch', 'installed'),
    error => error.stderr.includes('must have finished successfully'));
  assert.equal(fs.existsSync(path.join(h.dir, 'installed')), false);
});
