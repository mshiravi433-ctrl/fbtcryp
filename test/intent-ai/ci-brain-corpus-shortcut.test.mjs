/* THE CORPUS SHORT-CIRCUIT IN THE CENTRAL BRAIN (2026-11-12)
 * ==========================================================================
 *
 * The central brain asked "which of my 36 registered intents is this?"
 * BEFORE it asked "can I answer?". A question outside the registry therefore
 * never reached the part that could have answered it.
 *
 * Measured before this change: 0 of 7 corpus-answerable questions got an
 * answer from the brain — while the chat path answered all 7 with zero
 * provider calls. The brain said «به هیچ مسیر ثبت‌شده‌ای نرساندم» for
 * questions the repository already states.
 *
 * These tests lock the fix down in BOTH directions:
 *
 *   · a corpus-answerable question is answered, with its citation;
 *   · a question the corpus CANNOT answer still refuses, and still names
 *     what the brain can do — the old honest refusal must survive.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import app from '../../server/app.js';
import { searchKnowledge } from '../../src/lib/intent-ai/os/knowledgeCenter.js';

const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const port = server.address().port;
const HEADERS = { 'content-type': 'application/json', 'x-fbt-device': 'devcorpusdevice1234' };

const ask = async (message, locale = 'fa') => {
  const response = await fetch(`http://127.0.0.1:${port}/api/brain/intent`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ message, locale })
  });
  return { status: response.status, body: await response.json() };
};

const resultText = (body) => {
  const section = (body?.response?.sections || []).find((s) => s.id === 'result');
  return String(section?.value || '');
};

test.after(() => { server.close(); });

test('the brain answers a corpus question instead of refusing it', async () => {
  /* The measured case: the chat answered this with zero provider calls, and
     the brain used to refuse it as UNSUPPORTED. */
  const { status, body } = await ask('کارمزد پلتفرم FBT چقدر است؟');
  assert.equal(status, 200);
  assert.equal(body.intent?.intentType, 'CORPUS_LOOKUP', `intent was: ${body.intent?.intentType}`);
  assert.equal(body.intent?.unsupported, undefined);
  assert.match(resultText(body), /۰٫۷|0\.7|70\s*bps/i);
});

test('the brain answers a definitional question from the corpus', async () => {
  const { body } = await ask('بیت کوین چیست؟');
  assert.equal(body.intent?.intentType, 'CORPUS_LOOKUP');
  assert.match(resultText(body), /غیرمتمرکز|decentral/i);
});

test('the answer carries the citation it was retrieved from', async () => {
  const { body } = await ask('کارمزد پلتفرم FBT چقدر است؟');
  const match = body.intent?.corpusMatch;
  assert.ok(match, 'the intent must record which corpus item answered');
  assert.ok(searchKnowledge('کارمزد پلتفرم FBT چقدر است؟', { locale: 'fa', limit: 3 })
    .some((k) => k.id === match), 'the recorded match must be a real corpus item');
});

test('the wallet question answers about custody, not about registering', async () => {
  /* Regression: «کیف پول من کجا ذخیره می شود؟» used to match
     `kb.faq.no-account` (140) — an item about whether registration is
     needed — because that item's body happens to say «کیف پول شما». The
     answer was about an account, not about where the wallet lives. */
  const { body } = await ask('کیف پول من کجا ذخیره می شود');
  assert.equal(body.intent?.corpusMatch, 'kb.wallet.custody');
  assert.match(resultText(body), /غیرامانی|دستگاه|private key|non-custodial/i);
});

test('a question the corpus cannot answer still refuses honestly', async () => {
  /* The short-circuit must not turn the brain into a fluent guesser. */
  const { body } = await ask('قیمت بیت کوین چنده؟', 'fa');
  const text = resultText(body);
  assert.ok(
    !/۰٫۷|0\.7/.test(text),
    'a live price question must not be answered from a glossary'
  );
});

test('a question outside both the registry and the corpus still names what it can do', async () => {
  const { body } = await ask('پرواز کSpaceship من کی به مقصد می‌رسد؟');
  const text = JSON.stringify(body);
  assert.ok(
    /مسیر|برنامه|رجیستری|nearMiss|مسیرهای آماده/.test(text),
    'the refusal must still name the available paths'
  );
});

test('the short-circuit costs zero provider calls', async () => {
  /* The whole reason this exists: the `:free` quota is 50 requests a day and
     a `max` turn is 6 calls. A corpus answer must be free. */
  const { body } = await ask('بیت کوین چیست؟');
  assert.equal(body.intent?.internalSynthesisUsed, undefined);
  assert.ok(!body.providersUsed || body.providersUsed.length === 0,
    'a corpus answer must not consult a provider');
});

/* ─────────────────────────────────────────────────────────────────────────
 * THE TWO MISSING CORPUS ITEMS (2026-11-12)
 *
 * «آیا پلتفرم غیرامانی است؟» and «حداکثر مبلغ برداشت چقدر است؟» were
 * answered from items that merely MENTIONED the topic. A question whose
 * answer the corpus does not hold must not be answered from the corpus at
 * all — so the corpus gained the two items it was missing, worded in the
 * app's OWN words (`src/i18n/locales/fa.json`).
 * ───────────────────────────────────────────────────────────────────────── */
test('the non-custodial question is answered from the corpus, with its citation', async () => {
  const { body } = await ask('آیا پلتفرم غیرامانی است؟', 'fa');
  assert.equal(body.intent?.intentType, 'CORPUS_LOOKUP');
  assert.equal(body.intent?.answeredFromCorpus, true);
  assert.equal(body.intent?.corpusMatch, 'kb.product.non-custodial');
  const text = resultText(body);
  assert.ok(/غیرامانی|نگه نمی‌داریم/.test(text), 'the answer must say the platform is non-custodial');
});

test('the withdrawal-limit question is answered from the corpus', async () => {
  const { body } = await ask('حداکثر مبلغ برداشت چقدر است؟', 'fa');
  assert.equal(body.intent?.intentType, 'CORPUS_LOOKUP');
  assert.equal(body.intent?.answeredFromCorpus, true);
  assert.equal(body.intent?.corpusMatch, 'kb.product.withdrawal');
  const text = resultText(body);
  assert.ok(/سقف برداشتی وجود ندارد|بدون انتظار برای برداشت/.test(text),
    'the answer must say there is no withdrawal queue');
});

test('a RISK question is NOT answered from the corpus', async () => {
  /* The corpus holds definitions, so a risk question answered from it is a
     fluent non-answer. It must fall through to the model path. */
  const { body } = await ask('ریسک لیکوییدیتی چیست؟', 'fa');
  assert.notEqual(body.intent?.intentType, 'CORPUS_LOOKUP',
    'a risk question must not be answered from a glossary');
  assert.notEqual(body.intent?.corpusMatch, 'kb.swap.price-impact',
    'the price-impact item is not the answer to a liquidation-risk question');
});
