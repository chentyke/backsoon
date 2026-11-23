import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogs, selectLocale, translator } from '../src/web/i18n.js';
import { terminalLocale } from '../src/locale.js';
import { Watch } from '../src/chat.js';
import { sandbox, until } from './helpers.js';

test('language negotiation respects user preferences, script and POSIX locale precedence', () => {
  for (const [input, expected] of [
    [undefined, 'en'], ['C', 'en'], ['fr-CA', 'en'], ['bad!locale', 'en'],
    ['en_GB.UTF-8', 'en'], ['zh', 'zh-CN'], ['zh_SG.utf8', 'zh-CN'],
    ['zh_TW.UTF-8', 'zh-TW'], ['zh-HK', 'zh-TW'], ['zh-MO', 'zh-TW'],
    ['zh-Hant-CN', 'zh-TW'], ['zh-Hans-TW', 'zh-CN'], ['ja_JP', 'ja'],
    ['ko-KR', 'ko'], [['fr-FR', 'ko'], 'ko'], [['en-US', 'ja'], 'en'],
  ]) assert.equal(selectLocale(input), expected);
  const env = { LANG: 'ja_JP', LC_MESSAGES: 'ko_KR', LC_ALL: 'C', BACKSOON_LANG: 'zh-Hant' };
  for (const [key, expected] of [['BACKSOON_LANG', 'zh-TW'], ['LC_ALL', 'en'], ['LC_MESSAGES', 'ko'], ['LANG', 'ja']]) {
    assert.equal(terminalLocale(env), expected);
    delete env[key];
  }
  assert.equal(terminalLocale(env), 'en');
});

const keys = Object.keys(catalogs.en).sort();
const slots = (text) => text.match(/\{\w+\}/g)?.sort() || [];
for (const [locale, messages] of Object.entries(catalogs)) {
  test(locale + ' has every message and preserves its placeholders', () => {
    assert.deepEqual(Object.keys(messages).sort(), keys);
    for (const key of keys) {
      assert.ok(messages[key].trim(), key);
      assert.deepEqual(slots(messages[key]), slots(catalogs.en[key]), key);
    }
  });

  test(locale + ' localizes help, errors and completion without translating output', async (t) => {
    const h = sandbox(t);
    h.env.BACKSOON_LANG = locale;
    const msg = translator(locale);
    assert.ok((await h.cli('--help')).includes(msg('helpSetup')));
    await assert.rejects(h.cli('show', 'bad'), (e) => e.stderr.includes(msg('badTask')));
    await assert.rejects(h.cli('list', '--typo'), (e) =>
      e.stderr.includes(msg('unknownOption', { option: '--typo' })));
    await assert.rejects(h.cli('start', '--match', '[', '--', 'true'), (e) =>
      e.stderr.includes(msg('badPattern', { option: '--match' })));
    const output = 'Keep $& and {code} 原樣';
    const id = await h.cli('start', '--', 'echo', output);
    await h.ended(id);
    const args = await until(() => h.calls()[0]);
    const notice = args[args.indexOf('--message') + 1];
    assert.ok(notice.endsWith(msg('finished', {
      state: msg('succeeded'), code: msg('noticeExit', { code: 0 }), output,
    })));
    assert.equal(await h.cli('logs', id), output);
    const watch = new Watch({ chat: 'target', after_task: id });
    const call = (method) => ({
      data: method === 'thread/turns/list' ? [{ id: 'turn', status: 'completed' }] : [
        { item: { type: 'agentMessage', text: 'Diagnosis complete' } },
        { item: { type: 'userMessage', content: [{ type: 'text', text: notice }] } },
      ],
    });
    assert.equal((await watch.check(call))[1], 'Diagnosis complete');
  });
}
