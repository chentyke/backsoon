import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { receive, offerCompletion } from '../src/receiver.js';
import { setup } from '../src/setup.js';
import { sandbox, until } from './helpers.js';

test('a newer prompt takes ownership, stale Stop cannot consume, and a result reaches only one hook', async t => {
  const h = sandbox(t);
  const profile = path.join(h.dir, 'profile');
  const old = process.env.CODEX_HOME;
  process.env.CODEX_HOME = profile;
  t.after(() => { if (old == null) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = old; });
  const chat = randomUUID(), first = randomUUID(), second = randomUUID();
  const messages = [];
  const run = (turn, event) => receive({session_id:chat,turn_id:turn,hook_event_name:event}, data=>messages.push(data));
  const task = {id:'123456789abc',notify_thread:chat,status:'succeeded',code:0,latest:'private output'};
  await run(first,'UserPromptSubmit');
  await run(second,'UserPromptSubmit');
  await run(first,'Stop');
  const receipt = offerCompletion(task, 1500);
  const ticket = path.join(profile,'backsoon-receivers',chat,task.id+'.json');
  await until(()=>fs.existsSync(ticket));
  await run(first,'PostToolUse');
  assert.equal(messages.length,0);
  await run(second,'Stop');
  assert.equal(await receipt,'received');
  await run(second,'Stop');
  assert.deepEqual(messages,[{decision:'block',reason:'[BackSoon 123456789abc done] succeeded, exit code 0'}]);
  assert.equal(await offerCompletion(task),'fallback');
  await run(second,'UserPromptSubmit');
  assert.equal(await offerCompletion(task,20),'fallback');
  await run(second,'PostToolUse');
  assert.equal(messages.length,1);
});

test('setup keeps other hooks and never accepts hook trust on behalf of the user', async t=>{
  const h=sandbox(t), profile=path.join(h.dir,'profile');
  fs.mkdirSync(profile);
  const other={hooks:[{type:'command',command:'echo custom'}]};
  const file=path.join(profile,'hooks.json');
  fs.writeFileSync(file,JSON.stringify({hooks:{Stop:[other]},extra:12}));
  const opts={userHome:h.dir,codexHome:profile,output:{write(){}}};
  await setup(opts);
  const original=fs.readFileSync(file,'utf8');
  await setup(opts);
  assert.equal(fs.readFileSync(file,'utf8'),original);
  const config=JSON.parse(original);
  assert.equal(config.extra,12);
  assert.deepEqual(config.hooks.Stop[0],other);
  assert.equal(config.hooks.Stop.length,2);
  assert.equal(fs.existsSync(path.join(profile,'config.toml')),false);
});

test('the real worker accepts a hook receipt and an interrupted turn queues its result once', async t => {
  const h = sandbox(t);
  const chat = randomUUID(), turn = randomUUID();
  h.env.CODEX_HOME = h.dir;
  h.env.CODEX_THREAD_ID = chat;
  delete h.env.BACKSOON_REMOTE;
  const original = process.env.CODEX_HOME;
  process.env.CODEX_HOME = h.dir;
  t.after(() => {
    if (original === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = original;
  });
  for (const event of ['PostToolUse', 'Interrupt']) {
    const run = (name, write) => receive({session_id:chat, turn_id:turn, hook_event_name:name}, write);
    await run('UserPromptSubmit');
    const id = await h.cli('start', '--no-panel', '--', 'echo', 'command output');
    await until(() => fs.existsSync(path.join(h.dir, 'backsoon-receivers', chat, id + '.json')));
    const output = [];
    await run(event, value => output.push(value));
    const notice = await until(async () => JSON.parse(await h.cli('show', id)).notice);
    if (event === 'PostToolUse') {
      assert.equal(notice.state, 'received');
      assert.equal(h.calls().length, 0);
      assert.equal(output[0].hookSpecificOutput.additionalContext, '[BackSoon ' + id + ' done] succeeded, exit code 0');
    } else {
      assert.equal(notice.state, 'queued');
      assert.equal(h.calls().length, 1);
      assert.equal(output.length, 0);
    }
  }
});
