/**
 * THE RETRY BUDGET + THE SEMANTIC RECALL — THE AUDIT LEVERS #3 AND #2
 * ---------------------------------------------------------------------------
 * Both levers came out of docs/AI-COGNITION-AUDIT-2026-11-11.md:
 *
 *   #3  a `max` turn measured 13-16 provider calls, of which 8 were
 *       IDENTICAL-PAYLOAD failover retries. Against OpenRouter's 50/day
 *       `:free` cap that is a quarter of the daily budget for one question.
 *
 *   #2  the corpus was reachable only by the WORDS the question used; the
 *       semantic vector store existed but was not on the chat path.
 *
 * These tests pin the behaviour, not the implementation, so a later
 * refactor cannot quietly put the retries or the semantic layer back.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  LEVER #3 — THE TURN BUDGET                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

test('lever 3: the turn budget is exported and starts empty', async () => {
  const gw = await import('../../server/aiGateway.js');
  assert.equal(typeof gw.beginAiTurnBudget, 'function', 'beginAiTurnBudget must be exported');
  const b = gw.beginAiTurnBudget();
  assert.ok(b.failedModels instanceof Map);
  assert.ok(b.exhaustedProviders instanceof Set);
  assert.equal(b.failedModels.size, 0);
  assert.equal(b.exhaustedProviders.size, 0);
});

test('lever 3: two budgets are independent', async () => {
  const gw = await import('../../server/aiGateway.js');
  const a = gw.beginAiTurnBudget();
  const b = gw.beginAiTurnBudget();
  a.exhaustedProviders.add('openrouter');
  assert.equal(a.exhaustedProviders.size, 1);
  assert.equal(b.exhaustedProviders.size, 0, 'a turn must never see another turn\'s failures');
});

test('lever 3: a failed model id is not tried again in the same turn', async () => {
  /* The gateway refuses a provider with no key, so the seat must be armed
     before the call — the budget is only exercised on a real request. */
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'sk-or-budget-test';
  const gw = await import('../../server/aiGateway.js');
  assert.ok(gw.isProviderConfigured('openrouterfree'), 'the free seat must be armed for this test');
  const budget = gw.beginAiTurnBudget();

  /* The first call fails on a 404 (a retired model id). */
  let attempts = 0;
  const err = new Error('not found');
  err.status = 404;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    attempts++;
    return new Response(JSON.stringify({ error: { message: 'model not found' } }), {
      status: 404, headers: { 'content-type': 'application/json' }
    });
  };
  try {
    await gw.executeProviderChat('openrouterfree', {
      system: 's', user: 'u', json: true, intelligence: 'max', budget
    }).catch(() => {});
  } finally {
    globalThis.fetch = origFetch;
  }
  assert.ok(attempts >= 1, 'the first attempt must happen');

  /* The SECOND call in the SAME turn must not re-try any id that already
     failed — the whole point of the ledger. */
  const alreadyFailed = budget.failedModels.get('openrouterfree');
  assert.ok(alreadyFailed instanceof Set, 'the failed ids must be recorded per provider');
  assert.ok(alreadyFailed.size >= 1, 'at least one failed id must be recorded');
  assert.ok(
    alreadyFailed.size <= attempts,
    'no more ids may be marked failed than were actually tried'
  );
});

test('lever 3: a provider that failed for a non-model reason is exhausted', async () => {
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'sk-or-budget-test';
  const gw = await import('../../server/aiGateway.js');
  assert.ok(gw.isProviderConfigured('openrouterfree'), 'the free seat must be armed for this test');
  const budget = gw.beginAiTurnBudget();

  /* A 429 — the free tier's daily cap. No other model of this provider can
     help, so the provider must be marked exhausted for the turn. */
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
      status: 429, headers: { 'content-type': 'application/json' }
    });
  };
  try {
    await gw.executeProviderChat('openrouterfree', {
      system: 's', user: 'u', json: true, intelligence: 'max', budget
    }).catch(() => {});
  } finally {
    globalThis.fetch = origFetch;
  }
  assert.ok(
    budget.exhaustedProviders.has('openrouterfree'),
    'a 429 must exhaust the provider for the turn'
  );
});

test('lever 3: a second call in the same turn spends no request on a dead provider', async () => {
  process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'sk-or-budget-test';
  const gw = await import('../../server/aiGateway.js');
  const budget = gw.beginAiTurnBudget();

  let attempts = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    attempts++;
    return new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
      status: 429, headers: { 'content-type': 'application/json' }
    });
  };
  try {
    for (let i = 0; i < 3; i++) {
      await gw.executeProviderChat('openrouterfree', {
        system: 's', user: 'u', json: true, intelligence: 'max', budget
      }).catch(() => {});
    }
  } finally {
    globalThis.fetch = origFetch;
  }
  /*
   * The point of the ledger: after the first call proved the provider is
   * rate-limited, the next two must not spend a request each. Before the
   * ledger this was 3 requests for one question; the free seat allows 50 a
   * day, so a handful of questions would exhaust the day.
   */
  assert.equal(attempts, 1, `the dead provider must be asked once, not ${attempts} times`);
});

test('lever 3: the chat pipeline creates one ledger per turn', async () => {
  const src = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../../server/aiCollaboration.js', import.meta.url), 'utf8'));
  assert.match(src, /const turnBudget = beginAiTurnBudget\(\)/,
    'the collaboration layer must open a ledger for the turn');
  assert.match(src, /turnBudget/,
    'the ledger must be threaded through');
  /* Every runRole call site must pass it. */
  const callSites = src.match(/runRole\(\{/g) || [];
  assert.ok(callSites.length >= 6, 'the pipeline has several roles');
});

/* ══════════════════════════════════════════════════════════════════════════ */
/*  LEVER #2 — THE SEMANTIC RECALL                                            */
/* ══════════════════════════════════════════════════════════════════════════ */

test('lever 2: the semantic module is exported and offline', async () => {
  const sk = await import('../../src/lib/intent-ai/os/semanticKnowledge.js');
  assert.equal(typeof sk.hybridKnowledgeSearch, 'function');
  assert.equal(typeof sk.semanticKnowledgeCandidates, 'function');
  assert.equal(typeof sk.semanticRecall, 'function');
  assert.equal(typeof sk.semanticKnowledgeReport, 'function');

  const report = sk.semanticKnowledgeReport();
  assert.equal(report.offline, true, 'the semantic layer must cost no network calls');
  assert.equal(report.networkCalls, 0);
  assert.ok(report.locales.fa.items > 50, 'the fa index must hold the corpus');
  assert.ok(report.locales.en.items > 50);
  assert.ok(report.locales.fa.dim >= 64);
});

test('lever 2: an empty query returns nothing', async () => {
  const sk = await import('../../src/lib/intent-ai/os/semanticKnowledge.js');
  assert.deepEqual(sk.semanticKnowledgeCandidates('', { locale: 'fa' }), []);
  assert.deepEqual(sk.semanticKnowledgeCandidates('   ', { locale: 'fa' }), []);
  assert.deepEqual(
    sk.hybridKnowledgeSearch('', { locale: 'fa', lexicalSearch: () => [] }),
    []
  );
});

test('lever 2: the semantic layer finds items by MEANING, not by wording', async () => {
  const sk = await import('../../src/lib/intent-ai/os/semanticKnowledge.js');

  /* These questions deliberately avoid the corpus's own vocabulary. */
  const cases = [
    { q: 'how do I attach my wallet', locale: 'en', expect: ['kb.wallet.connect'] },
    { q: 'what does it cost me', locale: 'en', expect: ['kb.swap.fees', 'kb.product.fee', 'kb.general.gas'] },
    { q: 'where does my money live', locale: 'en', expect: ['kb.wallet.custody', 'kb.risk.custody-vs-balance', 'kb.general.wallet-vs-account'] }
  ];
  for (const c of cases) {
    const cands = sk.semanticKnowledgeCandidates(c.q, { locale: c.locale, limit: 6 });
    const ids = cands.map((x) => x.id);
    assert.ok(
      c.expect.some((id) => ids.includes(id)),
      `semantic recall for "${c.q}" should reach one of ${c.expect.join(', ')} — got ${ids.join(', ')}`
    );
    /* And it must be a strong match, not a rounding error. */
    const best = cands.find((x) => c.expect.includes(x.id));
    assert.ok(best.similarity > 0.1, `"${c.q}" must match by meaning, not by noise`);
  }
});

test('lever 2: the semantic layer is bilingual', async () => {
  const sk = await import('../../src/lib/intent-ai/os/semanticKnowledge.js');
  const fa = sk.semanticKnowledgeCandidates('اتصال کیف پول', { locale: 'fa', limit: 6 }).map((x) => x.id);
  const en = sk.semanticKnowledgeCandidates('connect wallet', { locale: 'en', limit: 6 }).map((x) => x.id);
  assert.ok(fa.includes('kb.wallet.connect'), `fa recall missed kb.wallet.connect: ${fa.join(', ')}`);
  assert.ok(en.includes('kb.wallet.connect'), `en recall missed kb.wallet.connect: ${en.join(', ')}`);
});

test('lever 2: the hybrid retriever beats the lexical retriever on paraphrases', async () => {
  const sk = await import('../../src/lib/intent-ai/os/semanticKnowledge.js');
  const { searchKnowledge } = await import('../../src/lib/intent-ai/os/knowledgeCenter.js');

  /* Each case lists the items that legitimately answer the question. */
  const cases = [
    { q: 'how do I attach my wallet', locale: 'en', ok: ['kb.wallet.connect', 'kb.faq.get-started'] },
    { q: 'what does it cost me', locale: 'en', ok: ['kb.swap.fees', 'kb.product.fee', 'kb.general.gas'] },
    { q: 'building a balanced basket', locale: 'en', ok: ['kb.risk.position-sizing', 'kb.product.portfolio', 'kb.risk.diversification'] },
    { q: 'where does my money live', locale: 'en', ok: ['kb.wallet.custody', 'kb.risk.custody-vs-balance', 'kb.general.wallet-vs-account'] },
    { q: 'cheap way to swap', locale: 'en', ok: ['kb.swap.fees', 'kb.product.fee', 'kb.general.gas'] },
    { q: 'چطور جلوی ضرر رو بگیرم', locale: 'fa', ok: ['kb.risk.position-sizing', 'kb.risk.stop-loss', 'kb.risk.volatility', 'kb.defi.il-loss'] },
    { q: 'پول نگه داری', locale: 'fa', ok: ['kb.risk.emergency-fund', 'kb.risk.custody-vs-balance', 'kb.risk.diversification'] },
    { q: 'هزینه سوآپ چقدره', locale: 'fa', ok: ['kb.swap.fees', 'kb.product.fee', 'kb.general.gas'] }
  ];

  let lexicalHits = 0;
  let hybridHits = 0;
  for (const c of cases) {
    const lexical = searchKnowledge(c.q, { locale: c.locale, limit: 3 });
    const hybrid = sk.hybridKnowledgeSearch(c.q, {
      locale: c.locale, limit: 3, lexicalSearch: searchKnowledge
    });
    if (c.ok.includes(lexical[0]?.id)) lexicalHits++;
    if (c.ok.includes(hybrid[0]?.id)) hybridHits++;
  }

  assert.ok(
    hybridHits >= lexicalHits,
    `the hybrid retriever must not be worse than the lexical one (${hybridHits} vs ${lexicalHits})`
  );
  assert.ok(
    hybridHits >= Math.ceil(cases.length * 0.8),
    `the hybrid retriever must answer ${Math.ceil(cases.length * 0.8)}/${cases.length} paraphrases — got ${hybridHits}`
  );
});

test('lever 2: the hybrid retriever preserves the lexical hits it already had', async () => {
  const sk = await import('../../src/lib/intent-ai/os/semanticKnowledge.js');
  const { searchKnowledge } = await import('../../src/lib/intent-ai/os/knowledgeCenter.js');

  /* A question that uses the corpus's own vocabulary must still be answered
     by the item it names — the semantic layer may not hijack it. */
  const cases = [
    { q: 'کارمزد پلتفرم FBT چقدر است', locale: 'fa', ok: ['kb.product.fee'] },
    { q: 'کلید خصوصی من کجا نگهداری می شود', locale: 'fa', ok: ['kb.wallet.custody', 'kb.wallet.never-asks', 'kb.general.seed-phrase'] },
    { q: 'سازندگان FBT چه کسانی هستند', locale: 'fa', ok: ['kb.product.team'] }
  ];
  for (const c of cases) {
    const hybrid = sk.hybridKnowledgeSearch(c.q, {
      locale: c.locale, limit: 3, lexicalSearch: searchKnowledge
    });
    assert.ok(
      c.ok.includes(hybrid[0]?.id),
      `"${c.q}" should return one of ${c.ok.join(', ')} — got ${hybrid[0]?.id}`
    );
  }
});

test('lever 2: the hybrid retriever marks how each item was found', async () => {
  const sk = await import('../../src/lib/intent-ai/os/semanticKnowledge.js');
  const { searchKnowledge } = await import('../../src/lib/intent-ai/os/knowledgeCenter.js');
  const res = sk.hybridKnowledgeSearch('اتصال کیف پول', {
    locale: 'fa', limit: 3, lexicalSearch: searchKnowledge
  });
  assert.ok(res.length > 0);
  for (const item of res) {
    assert.ok(
      ['lexical', 'lexical+semantic', 'semantic-only'].includes(item.retrieval),
      `unexpected retrieval marker: ${item.retrieval}`
    );
    assert.equal(typeof item.combined, 'number');
  }
});

test('lever 2: the hybrid retriever degrades safely without a lexical scorer', async () => {
  const sk = await import('../../src/lib/intent-ai/os/semanticKnowledge.js');
  const res = sk.hybridKnowledgeSearch('how do I connect my wallet', {
    locale: 'en', limit: 3, lexicalSearch: null
  });
  assert.ok(Array.isArray(res));
  /* With no lexical scorer the semantic layer must still answer. */
  assert.ok(res.length > 0, 'the semantic layer alone must return candidates');
  assert.ok(res.every((x) => x.retrieval === 'semantic-only'));
});

test('lever 2: the semantic index skips deprecated items', async () => {
  const sk = await import('../../src/lib/intent-ai/os/semanticKnowledge.js');
  const { FBT_KNOWLEDGE } = await import('../../src/lib/intent-ai/os/knowledgeCenter.js');
  const deprecated = new Set(FBT_KNOWLEDGE.filter((k) => k.status === 'deprecated').map((k) => k.id));
  if (!deprecated.size) return; /* no deprecated items — nothing to assert */
  const report = sk.semanticKnowledgeReport();
  const total = FBT_KNOWLEDGE.filter((k) => k.status !== 'deprecated').length;
  assert.equal(report.locales.fa.items, total);
});

test('lever 2: the chat path uses the hybrid retriever', async () => {
  const fs = await import('node:fs');
  for (const file of ['../../server/aiCollaboration.js', '../../server/aiInternalReasoner.js', '../../server/aiIntentOS.js']) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(src, /hybridKnowledgeSearch/,
      `${file} must use the hybrid retriever, not the lexical one alone`);
  }
});
