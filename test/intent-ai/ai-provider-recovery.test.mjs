import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAvailableAnalyses, runCollaborativeAnalysis } from '../../server/aiCollaboration.js';
import { answerGap, escalateToProviders } from '../../server/aiEscalation.js';

test('a slow seat does not discard another completed analysis', async () => {
  const good = { ok: true, answer: 'پاسخ واقعی' };
  const out = await collectAvailableAnalyses([Promise.resolve(good), new Promise(() => {})], 25);
  assert.deepEqual(out, [good]);
});

test('balanced role times out a stuck provider and tries the next with an abort signal', async () => {
  const calls = [];
  const deps = {
    selectProviders: () => ['stuck', 'working'],
    execute: (id, opts) => {
      calls.push({ id, opts });
      if (id === 'stuck') return new Promise(() => {});
      return Promise.resolve({ text: JSON.stringify({ answer: 'بلاکچین دفترکلی توزیع‌شده است که تراکنش‌ها را ثبت می‌کند.', claims: [] }) });
    }
  };
  const result = await runCollaborativeAnalysis({
    message: 'بلاکچین چیست و چگونه کار می‌کند؟', intelligence: 'balanced', locale: 'fa',
    analysis: { level: 2, taskTypes: ['research'], freshness: 'STATIC', needsWeb: false, emotion: {}, fomo: {} },
    deadlineMs: 2000, deps
  });
  assert.deepEqual(calls.map(c => c.id), ['stuck', 'working']);
  assert.equal(calls[0].opts.signal.aborted, true);
  assert.match(result.answer, /دفترکلی/);
});

test('empty structured answer does not prevent provider failover', async () => {
  const calls = [];
  const result = await runCollaborativeAnalysis({
    message: 'بلاکچین چیست؟', intelligence: 'balanced', locale: 'fa',
    analysis: { level: 2, taskTypes: ['research'], freshness: 'STATIC', needsWeb: false, emotion: {}, fomo: {} },
    deadlineMs: 2000,
    deps: { selectProviders: () => ['empty', 'working'], execute: async (id) => {
      calls.push(id);
      return { text: id === 'empty' ? '{}' : JSON.stringify({ answer: 'بلاکچین یک دفترکل توزیع‌شده است.', claims: [] }) };
    } }
  });
  assert.deepEqual(calls, ['empty', 'working']);
  assert.match(result.answer, /دفترکل/);
});

test('an unsure answer is a gap, but execution and wallet truth remain protected', () => {
  const args = { text: 'مطمئن نشدم دقیقاً کدام بخش را می‌خواهید.', providersConfigured: 2, confidence: 0.9 };
  assert.equal(answerGap({ ...args, intentType: 'GENERAL' }).escalate, true);
  assert.equal(answerGap({ ...args, hasPendingIntent: true }).escalate, false);
  assert.equal(answerGap({ ...args, hasCard: true }).escalate, false);
  assert.equal(answerGap({ ...args, intentType: 'PORTFOLIO_ANALYSIS' }).escalate, false);
});

test('fallback permits general knowledge while forbidding invented live and personal facts', async () => {
  let prompt = '';
  const out = await escalateToProviders({ message: 'بلاکچین چیست؟', locale: 'fa',
    deps: { providers: ['fake'], execute: async (_id, opts) => {
      prompt = opts.system + '\n' + opts.user;
      return { text: 'بلاکچین نوعی دفترکل توزیع‌شده برای ثبت اطلاعات است.' };
    } } });
  assert.equal(out.ok, true);
  assert.match(prompt, /general knowledge/);
  assert.match(prompt, /do not invent/i);
  assert.match(prompt, /live.*personal/i);
});
