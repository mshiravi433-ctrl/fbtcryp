import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { intelligenceTurnBudgetMs } from '../../src/lib/aiIntelligenceMode.js';
import { chatWithTransientRetry } from '../../src/lib/aiChatRetry.js';
const ui = readFileSync('src/components/IntentAIUnified.jsx', 'utf8');
const server = readFileSync('server/aiIntentOS.js', 'utf8');
test('client waits beyond function limit for cold starts and preserves a single retry', () => {
  assert.ok(intelligenceTurnBudgetMs('max') > 60000);
  assert.match(ui, /chatWithTransientRetry\(chatRequest, aiChat\)/);
  assert.doesNotMatch(ui, /className="iaos-intent-chip"/);
});
test('optional state reads are bounded without bypassing the pending intent write', () => {
  assert.match(server, /optionalRead\(storeGet\(MEMORY_KEY\(userId\), null\), 1000\)/);
  assert.match(server, /optionalRead\(appendMemory\(ownerFor\(req\)/);
  assert.match(server, /if \(pendingIntent\) await writePending/);
  assert.match(server, /finally\(\(\) => clearTimeout\(timer\)\)/);
});
test('header reacts to thread scrolling; trade is beside the composer', () => {
  assert.match(ui, /delta < -6/); assert.match(ui, /delta > 6/);
  assert.match(ui, /data-hidden=\{headerHidden/);
  assert.match(ui, /className="iaos-composer-row"/);
  assert.match(ui, /data-testid="intent-ai-trade-shortcut"/);
});

test('transient failure retries the same turn once, never retries a throttle or a successful result', async () => {
  const calls = [];
  const request = { message: 'test', conversationId: 'session-1', context: { wallet: false } };
  const result = await chatWithTransientRetry(request, async (x) => {
    calls.push(x);
    return calls.length === 1 ? { ok: false, status: 504 } : { ok: true, reply: 'answer' };
  }, async () => {});
  assert.equal(result.reply, 'answer');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { ...request, retry: true });
  for (const response of [{ok:false,status:429}, {ok:false,status:400}, {ok:true,status:200}]) {
    let count = 0;
    const returned = await chatWithTransientRetry(request, async () => { count++; return response; }, async () => {});
    assert.equal(count, 1); assert.equal(returned, response);
  }
  let count = 0;
  await chatWithTransientRetry(request, async () => { count++; return {ok:false,status:0}; }, async () => {});
  assert.equal(count, 2);
});
