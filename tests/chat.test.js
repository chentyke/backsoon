import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Watch, chatLabel } from '../src/chat.js';
import { sandbox, until } from './helpers.js';

const reply = (text, phase = 'final_answer') => ({ type: 'agentMessage', phase, text });
const message = (text) => ({ type: 'userMessage', content: [{ type: 'text', text }] });
const turn = (id, ...items) => ({ id, status: 'completed', items });
function history(turns) {
  return (method, params) => {
    const items =
      method === 'thread/turns/list'
        ? turns.map(({ items, ...rest }) => rest).reverse()
        : turns
            .find((t) => t.id === params.turnId)
            .items.map((item) => ({ item }))
            .reverse();
    const i = Number(params.cursor || 0);
    return { data: items.slice(i, i + 1), nextCursor: i + 1 < items.length ? String(i + 1) : null };
  };
}
test('waits for diagnosis after terminal notice, including older named jobs', async () => {
  const id = 'abc123abc123',
    prefix = '[BackSoon ' + id + '] build\n';
  const turns = [turn('initial', reply('启动'))],
    call = history(turns);
  const watch = new Watch({ chat: 'target', after_task: '*' });
  assert.equal(await watch.check(call), null);
  turns.push(turn('progress', message(prefix + '匹配到 1 行输出。'), reply('还在运行')));
  assert.equal(await watch.check(call), null);
  const report = turn(
    'report',
    message('[BackSoon ' + id + ' done] build\n失败，退出码 1。\n最后输出：检查结束'),
    reply('checking', 'commentary'),
  );
  report.status = 'inProgress';
  turns.push(report);
  assert.equal(await watch.check(call), null);
  report.items.push(reply('诊断完成'));
  report.status = 'completed';
  turns.push(turn('unrelated', reply('其他')));
  assert.equal((await watch.check(call))[1], '诊断完成');
  assert.equal((await new Watch({ chat: 'target', after_task: id }).check(call))[1], '诊断完成');
  assert.equal(await new Watch({ chat: 'target', after_task: '000000000000' }).check(call), null);
});
test('an interrupted snapshot and commentary cannot satisfy final reply conditions', async () => {
  const turns = [],
    call = history(turns),
    w = new Watch({ chat: 'id' });
  assert.equal(await w.check(call), null);
  turns.push({ ...turn('one'), status: 'inProgress' });
  assert.equal(await w.check(call), null);
  turns[0].status = 'interrupted';
  assert.equal(await w.check(call), null);
  turns[0].completedAt = 10;
  assert.equal((await w.check(call))[0].status, 'interrupted');
  turns.push(turn('two', message('完成'), reply('完成', 'commentary'), reply('等待')));
  const marker = new Watch({ chat: 'id', final_line: '完成' });
  assert.equal(await marker.check(call), null);
  turns.push(turn('three', reply('结果\n完成')), turn('four', reply('其他')));
  assert.equal((await marker.check(call))[1], '结果\n完成');
});
test('wait-chat reads the local app server and queues one result', async (t) => {
  const h = sandbox(t);
  const file = path.join(h.dir, 'codex');
  const fakeQueue = fs.readFileSync(file, 'utf8').split('\n').slice(1).join('\n');
  h.write(
    'codex',
    '#!' +
      process.execPath +
      '\nif(process.argv[2]==="queue"){' +
      fakeQueue +
      '}else{\n' +
      "const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{" +
      'const q=JSON.parse(line);if(!q.id)return;let result={};' +
      "if(q.method==='thread/turns/list'){fs.writeFileSync('observing','');result={data:[{id:'t',status:fs.existsSync('release')?'completed':'inProgress'}]};}" +
      "if(q.method==='thread/items/list')result={data:[{item:{type:'agentMessage',text:'检查完成'}}]};" +
      'console.log(JSON.stringify({id:q.id,result}));});}',
  );
  const id = await h.cli('wait-chat', '00000000-0000-4000-8000-000000000001', '--timeout', '15');
  await until(() => fs.existsSync(path.join(h.dir, 'observing')));
  assert.deepEqual(h.calls(), []);
  h.write('release', '');
  assert.equal((await h.ended(id)).status, 'succeeded');
  await until(() => h.calls().length === 1);
  assert.match(h.calls()[0].join(' '), /检查完成/);
  const expired = await h.cli(
    'wait-chat',
    '00000000-0000-4000-8000-000000000001',
    '--notify',
    'off',
    '--final-line',
    '其他',
    '--timeout',
    '.3',
  );
  assert.equal((await h.ended(expired)).status, 'failed');
  assert.match(await h.cli('logs', expired), /Timed out|超时/);
});

test('several chats share one wait and preserve individual titles and input states', async t => {
  const h = sandbox(t);
  h.write('codex', '#!' + process.execPath + '\n' + `
    const fs = require('node:fs');
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const q = JSON.parse(line);
      if (!q.id) return;
      const first = q.params?.threadId?.endsWith('1');
      let result = {};
      if (q.method === 'thread/read') result = {thread:{name:first ? 'Docs' : 'Build',status:{activeFlags:first ? ['waitingOnUserInput'] : []}}};
      if (q.method === 'thread/turns/list') result = {data:[{id:'t',status:fs.existsSync('release') ? 'completed' : 'inProgress'}]};
      if (q.method === 'thread/items/list') result = {data:[{item:{type:'agentMessage',text:'Done'}}]};
      console.log(JSON.stringify({id:q.id,result}));
    });`);
  const first = '00000000-0000-4000-8000-000000000001', second = first.slice(0,-1) + '2';
  const id = await h.cli('wait-chat', first, second, first, '--notify', 'off', '--timeout','15');
  const items = await until(() => {
    const list = h.state(id).activities;
    return list?.some(i => i.name === 'Docs' && i.state === 'needsInput') && list.some(i => i.name === 'Build') && list;
  });
  assert.equal(items.length, 2);
  h.write('release','');
  const state = await h.ended(id);
  assert.equal(state.status, 'succeeded');
  assert.deepEqual(state.activities.map(i => i.state), ['succeeded','succeeded']);
});

test('an untitled chat stays observable until its first prompt is saved', async t => {
  const h = sandbox(t);
  h.write('codex', '#!' + process.execPath + '\n' + `
    const fs = require('node:fs');
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const q = JSON.parse(line);
      if (!q.id) return;
      let result = {}, error;
      if (q.method === 'thread/turns/list') {
        if (fs.existsSync('release')) result = {data:[{id:'first', status:'completed'}]};
        else {
          const id = q.params.threadId;
          fs.writeFileSync(id, '');
          error = {code:-32600, message:id.endsWith('1') ? 'thread not loaded: ' + id : 'list_turns is not supported yet'};
        }
      }
      if (q.method === 'thread/items/list') result = {data:[{item:{type:'agentMessage',text:'READY'}}]};
      console.log(JSON.stringify({id:q.id, result, error}));
    });`);
  const first = '01234567-0000-4000-8000-000000000001', second = first.slice(0, -1) + '2';
  const id = await h.cli('wait-chat', first, second, '--notify', 'off', '--final-line', 'READY', '--timeout', '15');
  await until(() => [first, second].every(chat => fs.existsSync(path.join(h.dir, chat))));
  h.write('release', '');
  const result = await h.ended(id);
  assert.equal(result.status, 'succeeded');
  assert.equal(new Set(result.activities.map(item => item.name)).size, 2);
  assert.ok(result.activities.every(item => item.state === 'succeeded'));
});

test('abbreviated chat IDs that still collide use the full ID in a group', () => {
  const ids = ['01234567-0000-4000-8000-000000000001', '01234567-0000-4001-8000-000000000001'];
  assert.deepEqual(ids.map(id => chatLabel(id, ids)), ids);
});
