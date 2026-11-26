import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALERT_LANGS, ORDER_COPY, INTENT_COPY, FILLED_COPY, PREVIEW_COPY,
  alertCopy, normalizeAlertLang
} from '../src/lib/alertCopy.js';
import { buildStageAlert } from '../server/orderAlerts.js';

test('every supported locale has a full alert vocabulary', () => {
  for (const lang of ALERT_LANGS) {
    for (const [table, keys] of [
      [ORDER_COPY, ['pending', 'ready', 'closed']],
      [INTENT_COPY, ['pending', 'ready', 'closed']],
      [PREVIEW_COPY, ['profit', 'loss', 'pending', 'ready', 'alert', 'info']]
    ]) {
      const pack = table[lang];
      assert.ok(pack, `${lang} missing from table`);
      for (const key of keys) {
        assert.ok(pack[key]?.title?.length > 2, `${lang}.${key}.title`);
        assert.ok(pack[key]?.body?.length > 8, `${lang}.${key}.body`);
      }
    }
    assert.ok(FILLED_COPY[lang]?.title && FILLED_COPY[lang]?.body, `${lang} fill copy`);
  }
});

test('regional tags and unknown languages resolve without going blank', () => {
  assert.equal(normalizeAlertLang('en-US'), 'en');
  assert.equal(normalizeAlertLang('fa-IR'), 'fa');
  assert.equal(normalizeAlertLang('xx'), 'en');
  const hindi = buildStageAlert({ stage: 'ready', lang: 'hi-IN', base: 'BTC', quote: 'USDT', rate: '65000', id: 'o9' });
  assert.equal(hindi.title, ORDER_COPY.hi.ready.title);
  assert.match(hindi.body, /BTC.*USDT/);
  assert.notEqual(hindi.title, ORDER_COPY.en.ready.title);
  const preview = alertCopy(PREVIEW_COPY, 'zh-CN', 'ready');
  assert.equal(preview.title, PREVIEW_COPY.zh.ready.title);
});

test('the Persian keeper-fill sentence is preserved exactly', () => {
  const filled = buildStageAlert({ stage: 'closed', filled: true, lang: 'fa', base: 'WETH', quote: 'USDC', id: 'o1' });
  assert.equal(filled.body, FILLED_COPY.fa.body);
  assert.equal(filled.title, 'سفارش حد پر شد');
});
