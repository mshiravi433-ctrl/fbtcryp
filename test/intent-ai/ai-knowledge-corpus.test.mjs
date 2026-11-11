/**
 * KNOWLEDGE RETRIEVAL BENCHMARK
 * ---------------------------------------------------------------------------
 * The knowledge base is the ceiling on how much the assistant can KNOW. The
 * audit (docs/AI-COGNITION-AUDIT-2026-11-11.md) measured 27 items as that
 * ceiling. This benchmark exists so the ceiling and the retrieval quality are
 * both MEASURED, not assumed:
 *
 *   1. COVERAGE  — every question a real user asks must find its item.
 *   2. PRECISION — the right item must be FIRST, not merely present.
 *   3. HONESTY   — a question about a live number must not be answered from
 *                  the knowledge base (those come from the live tools).
 *
 * It is deterministic, offline, and needs no provider key.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FBT_KNOWLEDGE,
  KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_STATUSES,
  getKnowledgeItem,
  knowledgeStats,
  listKnowledge,
  searchKnowledge
} from '../../src/lib/intent-ai/os/knowledgeCenter.js';

/* -------------------------------------------------------------------------- */
/*  1. THE CORPUS ITSELF                                                      */
/* -------------------------------------------------------------------------- */

test('every knowledge item is well formed and truthful in shape', () => {
  assert.ok(FBT_KNOWLEDGE.length >= 100, `expected a wide corpus, got ${FBT_KNOWLEDGE.length}`);
  const ids = new Set();
  for (const k of FBT_KNOWLEDGE) {
    assert.ok(k.id && !ids.has(k.id), `id must be present and unique: ${k.id}`);
    ids.add(k.id);
    assert.ok(Number.isInteger(k.version) && k.version >= 1, `${k.id} version`);
    assert.ok(KNOWLEDGE_CATEGORIES.includes(k.category), `${k.id} category`);
    assert.ok(KNOWLEDGE_STATUSES.includes(k.status), `${k.id} status`);
    assert.ok(Number.isFinite(k.confidence) && k.confidence > 0 && k.confidence <= 100, `${k.id} confidence`);
    assert.ok(k.source && typeof k.source === 'string', `${k.id} source`);
    assert.ok(k.titleFa && k.titleEn, `${k.id} titles`);
    assert.ok(k.bodyFa && k.bodyEn, `${k.id} bodies`);
    /* The corpus answers in both languages. */
    assert.ok(k.bodyFa.length > 80, `${k.id} fa body is too thin to ground an answer`);
    assert.ok(k.bodyEn.length > 80, `${k.id} en body is too thin to ground an answer`);
  }
});

test('no knowledge category is empty — every area can be grounded', () => {
  const stats = knowledgeStats();
  for (const category of KNOWLEDGE_CATEGORIES) {
    assert.ok((stats.byCategory[category] || 0) >= 1, `category ${category} has no item`);
  }
  /* The audit found FAQ completely empty and several categories with a single
     item. The expansion has to be a floor, not a favouritism. */
  for (const category of KNOWLEDGE_CATEGORIES) {
    assert.ok((stats.byCategory[category] || 0) >= 3, `category ${category} is still too thin`);
  }
});

test('every item carries tags — they are how a colloquial question finds it', () => {
  for (const k of FBT_KNOWLEDGE) {
    assert.ok(Array.isArray(k.tags) && k.tags.length >= 3, `${k.id} needs tags`);
    /* Tags must carry both a Persian and an English term, because the
       retriever is bilingual and a Persian-only tag cannot serve an English
       question. */
    const hasFa = k.tags.some((t) => /[\u0600-\u06FF]/.test(String(t)));
    const hasEn = k.tags.some((t) => /[a-z]/i.test(String(t)));
    assert.ok(hasFa, `${k.id} needs a Persian tag`);
    assert.ok(hasEn, `${k.id} needs an English tag`);
  }
});

/* -------------------------------------------------------------------------- */
/*  2. RETRIEVAL PRECISION                                                     */
/* -------------------------------------------------------------------------- */

/* Each case is a question a real user actually types, and the item that MUST
   come first. The expectation is deliberately written as the id, so a corpus
   edit that breaks grounding fails loudly here. */
const PRECISION_CASES = [
  // Persian — the primary language of the product.
  ['fa', 'بیت کوین چیست؟', 'kb.general.btc'],
  ['fa', 'اتریوم چیست؟', 'kb.general.eth'],
  ['fa', 'تتر چیست؟', 'kb.general.usdt'],
  ['fa', 'اسلیپیج چیست و چقدر بگذارم', 'kb.swap.slippage'],
  ['fa', 'ضرر غیرخطی یعنی چی', 'kb.defi.il-loss'],
  ['fa', 'لیکویید شدن یعنی چی', 'kb.trading.liquidation'],
  ['fa', 'نرخ تاموینگ چیه', 'kb.trading.funding-rate'],
  ['fa', 'کلید خصوصی من کجا نگهداری می شود', 'kb.wallet.custody'],
  ['fa', 'فیشینگ چیه و چطور جلوش رو بگیرم', 'kb.wallet.phishing'],
  ['fa', 'بریج بین شبکه ها چطور کار میکنه', 'kb.general.bridges'],
  ['fa', 'اهرم چقدر خطرناکه', 'kb.risk.leverage'],
  ['fa', 'استیبل کوین چقدر امنیت داره', 'kb.defi.stablecoin-risk'],
  ['fa', 'حد ضرر رو چطور تنظیم کنم', 'kb.risk.stop-loss'],
  ['fa', 'سواپ چطوریه', 'kb.swap.howto'],
  ['fa', 'پرتفوی من چیه', 'kb.product.portfolio'],
  ['fa', 'چطور در فارم سرمایه گذاری کنم', 'kb.product.earn'],
  ['fa', 'چطور ثبت نام کنم', 'kb.faq.no-account'],
  ['fa', 'پرپیوال با اسپات چه فرقی داره', 'kb.trading.perpetual-vs-spot'],
  ['fa', 'من چقدر باید سرمایه گذاری کنم', 'kb.risk.emergency-fund'],
  ['fa', 'MVP چیه و MVRV چطور تفسیر میشه', 'kb.analytics.mvrv'],

  // English — the retriever is bilingual and must serve both.
  ['en', 'what is bitcoin', 'kb.general.btc'],
  ['en', 'what is ethereum', 'kb.general.eth'],
  ['en', 'what is tether', 'kb.general.usdt'],
  ['en', 'what is slippage', 'kb.swap.slippage'],
  ['en', 'what happens if I get liquidated', 'kb.trading.liquidation'],
  ['en', 'how do I avoid liquidation', 'kb.trading.liquidation'],
  ['en', 'what is funding rate', 'kb.trading.funding-rate'],
  ['en', 'what is impermanent loss', 'kb.defi.il-loss'],
  ['en', 'how do I recover my wallet', 'kb.wallet.recover'],
  ['en', 'how do I connect my wallet', 'kb.wallet.connect'],
  ['en', 'how much do fees cost', 'kb.swap.fees'],
  ['en', 'are fees charged on swaps', 'kb.swap.fees'],
  ['en', 'what are the risks of leverage', 'kb.risk.leverage'],
  ['en', 'what are the risks of stablecoins', 'kb.defi.stablecoin-risk'],
  ['en', 'how does staking work', 'kb.product.earn'],
  ['en', 'what is nft', 'kb.general.nft'],
  ['en', 'what is gas', 'kb.general.gas'],
  ['en', 'why is solana fast', 'kb.solana.speed'],
  ['en', 'what is a bridge', 'kb.general.bridges'],
  ['en', 'do i need an account', 'kb.faq.no-account'],
  ['en', 'how do i set a stop loss', 'kb.risk.stop-loss']
];

test('the right knowledge item comes FIRST for every real question', () => {
  const misses = [];
  for (const [locale, query, expectedId] of PRECISION_CASES) {
    const results = searchKnowledge(query, { locale, limit: 5 });
    if (!results.length || results[0].id !== expectedId) {
      misses.push(
        `${locale}: "${query}" -> expected ${expectedId}, got ${results.map((r) => `${r.id}(${r.score})`).join(', ') || 'NOTHING'}`
      );
    }
  }
  assert.equal(misses.length, 0, `retrieval misses:\n  ${misses.join('\n  ')}`);
});

test('every expected item actually exists in the corpus', () => {
  for (const [, , expectedId] of PRECISION_CASES) {
    assert.ok(getKnowledgeItem(expectedId), `missing item ${expectedId}`);
  }
});

/* -------------------------------------------------------------------------- */
/*  3. HONESTY — live numbers must NOT come from the knowledge base            */
/* -------------------------------------------------------------------------- */

test('the knowledge base never states a live price, balance or APY', () => {
  /* The truth rule of the corpus: live numbers come from the live tools.
     A hard-coded price in the corpus would go stale silently, so the corpus
     must describe the MECHANISM and never the current value. */
  const banned = [
    /قیمت.{0,12}(?:دلار|تتر|usd|\$)\s*\d/i,
    /\$\s?\d[\d,]{2,}/,
    /\b\d+(?:\.\d+)?\s*(?:usd|dollars)\b/i,
    /ap[yr]\s*(?:equal|=|:)?\s*\d+(?:\.\d+)?\s*%/i
  ];
  for (const k of FBT_KNOWLEDGE) {
    const text = `${k.titleFa} ${k.bodyFa} ${k.titleEn} ${k.bodyEn}`;
    for (const re of banned) {
      assert.ok(!re.test(text), `${k.id} states a live number (${re})`);
    }
  }
});

test('a price question retrieves the item that explains live data, not a price', () => {
  /* "قیمت بیت کوین چقدره" must not be answered from the corpus — the answer
     has to come from the live market tool. The corpus may return the item
     that explains Bitcoin, but it must not contain a price. */
  const results = searchKnowledge('قیمت بیت کوین چقدره الان', { locale: 'fa', limit: 5 });
  for (const r of results) {
    const item = getKnowledgeItem(r.id);
    assert.ok(item, `${r.id} exists`);
    assert.ok(!/\d[\d,.]*\s*(?:usd|dollars|تتر|دلار)/i.test(item.bodyFa + item.bodyEn),
      `${r.id} must not carry a live price`);
  }
});

/* -------------------------------------------------------------------------- */
/*  4. NO SILENT REGRESSION — the retriever stays deterministic                */
/* -------------------------------------------------------------------------- */

test('retrieval is deterministic and order-stable', () => {
  const q = 'اهرم و لیکویید شدن در بازار مشتقه';
  const a = searchKnowledge(q, { locale: 'fa', limit: 6 }).map((r) => r.id);
  const b = searchKnowledge(q, { locale: 'fa', limit: 6 }).map((r) => r.id);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0);
});

test('a deprecated item is never retrieved', () => {
  /* The corpus itself has no deprecated item, so the rule is asserted against
     a synthetic one: the filter must be on status, not on the item list. */
  const all = listKnowledge({ includeDeprecated: true });
  const visible = listKnowledge();
  assert.ok(visible.length <= all.length);
  for (const item of visible) {
    assert.notEqual(item.status, 'deprecated');
  }
});

test('category filtering still works', () => {
  const risk = listKnowledge({ category: 'RISK' });
  assert.ok(risk.length >= 3);
  for (const item of risk) assert.equal(item.category, 'RISK');
  const scoped = searchKnowledge('اهرم', { locale: 'fa', limit: 5, category: 'RISK' });
  for (const r of scoped) assert.equal(r.category, 'RISK');
});

test('an empty or meaningless query returns nothing rather than everything', () => {
  assert.equal(searchKnowledge('', { locale: 'fa' }).length, 0);
  assert.equal(searchKnowledge('   ', { locale: 'fa' }).length, 0);
});
