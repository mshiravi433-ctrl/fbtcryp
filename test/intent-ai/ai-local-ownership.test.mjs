/**
 * «جواب‌های هوش مصنوعی تغییری نکرده» — the turn that never left the browser.
 * ---------------------------------------------------------------------------
 * The local Intent OS answers in place when it understood the request: that is
 * the whole point of it (no round trip for «پرتفوی»، «بازار» یا «افق جهانی را
 * باز کن»). But it also answered in place when it understood NOTHING, with the
 * «مطمئن نشدم دقیقاً کدام بخش را می‌خواهید» line — `ok: true`, read-only plan —
 * and the host surface returned that as the finished reply.
 *
 * The consequence was invisible from the server: every layer added to
 * `/api/v1/ai/chat` (the product brain, the partial read, the model fleet) was
 * correct, deployed and never reached, because the browser had already decided
 * the turn was over. In a key-less sandbox the same route answered instantly and
 * looked perfect — which is exactly how this shipped as "done" twice.
 *
 * So the OS now says, in the payload, whether it understood: `understood`.
 * `false` means «I have no answer» and the server owns the turn.
 *
 * Every test here is offline: no provider, no network, no key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createIntentOS } from '../../src/lib/intent-ai/os/index.js';
import { readPartialInput } from '../../src/lib/intent-ai/os/conversation/partialInput.js';
import { withPartialReading, partialReadingLine } from '../../src/lib/intent-ai/humanResponse.js';

const UNSURE = 'مطمئن نشدم';

const run = async (message) => {
  const os = createIntentOS({ locale: 'fa' });
  return os.process({
    message,
    locale: 'fa',
    currentPage: '/intent',
    walletState: { connected: false },
    portfolioState: null,
    conversation: []
  });
};

/* ── A. the turns that looked "answered" and were not ─────────────────────── */

test('A1 · «کارمزد FBT چقدره؟» is reported as not understood (so the server takes it)', async () => {
  const r = await run('کارمزد FBT چقدره؟');
  assert.equal(r.ok, true);
  assert.equal(r.understood, false);
  assert.equal(r.human?.code, 'UNSURE');
  assert.match(String(r.human?.message || ''), new RegExp(UNSURE));
});

test('A2 · «بیتکوین؟» is reported as not understood', async () => {
  const r = await run('بیتکوین؟');
  assert.equal(r.understood, false);
});

test('A3 · «FBT چیه؟» is reported as not understood', async () => {
  const r = await run('FBT چیه؟');
  assert.equal(r.understood, false);
});

/* ── B. the turns the local OS must keep ──────────────────────────────────── */

test('B1 · small talk stays local — no server round trip for «سلام»', async () => {
  const r = await run('سلام');
  assert.equal(r.ok, true);
  assert.equal(r.understood, true);
  assert.equal(r.human?.code, undefined);
  assert.match(String(r.human?.message || ''), /سلام/);
});

test('B2 · a read the OS can serve is understood, not deferred', async () => {
  const r = await run('پرتفوی من چقدره؟');
  assert.equal(r.understood, true);
});

/* ── C. the reading is attached to whichever answer ships ────────────────── */

test('C1 · a fragment produces a reading line', () => {
  const read = readPartialInput({ message: 'بیتکوین؟', locale: 'fa', context: {}, priorIntent: null });
  const line = partialReadingLine(read, 'fa');
  assert.match(line, /اگر درست خوانده باشم/);
});

test('C2 · a model answer gets the reading in front of it', () => {
  const read = readPartialInput({ message: 'بیتکوین؟', locale: 'fa', context: {}, priorIntent: null });
  const out = withPartialReading('BTC در ۲۴ ساعت ۲٪ رشد کرده است.', read, { lang: 'fa' });
  assert.ok(out.indexOf('اگر درست خوانده باشم') === 0, 'the reading comes first');
  assert.ok(out.includes('BTC در ۲۴ ساعت'), 'the body is untouched');
});

test('C3 · the deterministic answer is not doubled', () => {
  const read = readPartialInput({ message: 'بیتکوین؟', locale: 'fa', context: {}, priorIntent: null });
  const once = partialReadingLine(read, 'fa');
  assert.equal(withPartialReading(once, read, { lang: 'fa' }), once);
});

test('C4 · the product brain and small talk are exempt', () => {
  const read = readPartialInput({ message: 'بیتکوین؟', locale: 'fa', context: {}, priorIntent: null });
  assert.equal(withPartialReading('کارمزد ۰٫۷٪ است.', read, { lang: 'fa', skip: true }), 'کارمزد ۰٫۷٪ است.');
});

test('C5 · a complete message adds nothing', () => {
  const read = readPartialInput({ message: 'قیمت بیتکوین الان چقدر است؟', locale: 'fa', context: {}, priorIntent: null });
  assert.equal(withPartialReading('پاسخ کامل.', read, { lang: 'fa' }), 'پاسخ کامل.');
});

/* ── D. the wiring itself (a probe: the bug cannot come back silently) ────── */

test('D1 · the chat surface refuses to finish a turn the OS did not understand', () => {
  const ui = readFileSync(new URL('../../src/components/IntentAIUnified.jsx', import.meta.url), 'utf8');
  assert.match(ui, /const isLocalHandled = osResult\.ok && osResult\.understood !== false/);
});

test('D2 · the route attaches the reading to the shipped answer', () => {
  const route = readFileSync(new URL('../../server/aiIntentOS.js', import.meta.url), 'utf8');
  assert.match(route, /withPartialReading\(finalText, partialRead/);
});

test('D3 · the unsure line carries its code', () => {
  const os = readFileSync(new URL('../../src/lib/intent-ai/os/humanResponse.js', import.meta.url), 'utf8');
  assert.match(os, /code: 'UNSURE'/);
});
