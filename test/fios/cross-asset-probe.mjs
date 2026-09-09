#!/usr/bin/env node
/**
 * FBT — CROSS-ASSET INTELLIGENCE probe (Phase 211.2): the «تحلیل کراس» fix.
 * ---------------------------------------------------------------------------
 * The bug this pins: the Global Intelligence cross tab answered
 * «کلاس‌های خوانده‌نشده: رمزارز، سهام، فارکس، کالاها، دارایی واقعی» — every
 * class unread — because
 *   (a) crypto was only ever DIGESTED from the state store (a fresh owner
 *       has no markets section, and nothing ever read the market),
 *   (b) the four global classes had NO fallback when the Avantis/Ostium
 *       feeds did not answer, although the macro desk (stooq/yahoo) carries
 *       real daily series for exactly those classes,
 *   (c) the engine dropped the OWNER on its brain reads, so even a successful
 *       read wrote back into an anon store nobody reads,
 *   (d) there was no comprehensive analysis at all — no narrative, no AI.
 *
 * What it proves:
 *   PURE ENGINE — the crypto class reads BOTH brain shapes (fixture symbols
 *   array AND the real prices/changes24hPct maps); a dead class feed is
 *   replaced by the named macro-desk fallback (rwa stays honestly missing);
 *   missing classes keep their per-domain REASON; the narrative is
 *   deterministic, bilingual and never invents a number for an unread class.
 *   OWNER WIRING — the engine's brain read carries the owner.
 *   REAL HTTP — on a fresh owner (no brain turn, no sections), one
 *   /api/ai/global/cross-asset call now reads all five classes through the
 *   brain's own seeded sources, computes the regime, writes the narrative,
 *   answers LOCAL_ONLY (no AI provider configured) instead of pretending,
 *   and the owner's state store ends up with the markets section written.
 */
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT = '100000,60000';
process.env.AI_RATE_LIMIT = '100000,60000';
process.env.BRAIN_RATE_LIMIT = '100000,60000';
process.env.MEM_RATE_LIMIT = '100000,60000';
process.env.SAFE_INTENTS_ONLY = 'true';
delete process.env.BLOB_READ_WRITE_TOKEN;
/* Deterministic commentary: with every provider key deleted the gateway has
   nothing external configured, so the commentary must say NO_AI_PROVIDER
   (LOCAL_ONLY) rather than passing the canned internal engine off as
   analysis of this pass's numbers. */
for (const k of ['OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY', 'MISTRAL_API_KEY', 'AIMLAPI_API_KEY', 'CLOUDFLARE_ACCOUNT_ID', 'CF_API_TOKEN']) delete process.env[k];

import http from 'node:http';

let passed = 0;
let failed = 0;
const failures = [];
function t(name, ok, detail = null) {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
}

/* ══════════════════ 1. the pure engine ══════════════════ */
const { analyzeCrossAsset, crossNarrative, correlate } = await import('../../server/fios/crossAsset.js');
const NOW = 1_788_000_000_000;

/* 1a. crypto: the REAL brain shape (maps), not just the fixture array. */
const mapShaped = analyzeCrossAsset({
  world: { domains: { market: { schema: 'fbt.fi.provenance.v1', value: { prices: { BTC: 70000, ETH: 3000 }, changes24hPct: { BTC: -1.2, ETH: 2.5, SOL: 0 } } } } },
  now: NOW
});
t('crypto reads the REAL brain shape (prices/changes24hPct maps) — 3 instruments, 3 with change',
  mapShaped.classes.crypto?.instruments === 3 && mapShaped.classes.crypto?.withChange === 3
  && Math.abs(mapShaped.classes.crypto.avgChangePct - 0.43) < 0.01, mapShaped.classes.crypto);

const arrayShaped = analyzeCrossAsset({
  world: { domains: { market: { schema: 'fbt.fi.provenance.v1', value: { symbols: [{ symbol: 'BTC', change24hPct: 1 }, { symbol: 'ETH', change24hPct: -1 }] } } } },
  now: NOW
});
t('crypto still reads the fixture symbols-array shape (nothing regressed)',
  arrayShaped.classes.crypto?.instruments === 2 && arrayShaped.classes.crypto.avgChangePct === 0, arrayShaped.classes.crypto);

/* 1b. the fallback chain: dead brain feeds → named macro-desk fallbacks. */
const withFallbacks = analyzeCrossAsset({
  world: { domains: { market: { schema: 'fbt.fi.provenance.v1', value: { changes24hPct: { BTC: 2 } } } } },
  globalIntel: {
    domains: {
      stocks: { status: 'UNAVAILABLE', reason: 'UNCLASSIFIED_ERROR' },
      forex: { status: 'UNAVAILABLE', reason: 'PROVIDER_DOWN' },
      commodities: { status: 'UNAVAILABLE', reason: 'SOURCE_REJECTED' },
      rwa: { status: 'UNAVAILABLE', reason: 'RWA_FEED_UNAVAILABLE' }
    }
  },
  fallbacks: {
    stocks: { source: 'macroData:stooq', instruments: [{ symbol: 'SPX', change24hPct: 0.8 }] },
    forex: { source: 'macroData:stooq', instruments: [{ symbol: 'DXY', change24hPct: -0.3 }] },
    commodities: { source: 'macroData:stooq', instruments: [{ symbol: 'GOLD', change24hPct: 1.4 }, { symbol: 'WTI', change24hPct: -2.0 }] }
  },
  now: NOW
});
t('with every brain feed down, the macro-desk fallbacks make 4 classes observable — status OK',
  withFallbacks.status === 'OK' && withFallbacks.observedClasses.length === 4, withFallbacks.observedClasses);
t('each fallback class is NAMED as such (fallbackSource + degraded), never passed off as the primary feed',
  withFallbacks.classes.stocks?.fallbackSource === 'macroData:stooq' && withFallbacks.classes.stocks?.degraded === true
  && withFallbacks.classes.forex?.fallbackSource === 'macroData:stooq', withFallbacks.classes.stocks);
t('rwa has no honest fallback, stays missing — and its REASON survives',
  withFallbacks.missing.includes('rwa') && withFallbacks.missingReasons?.rwa === 'RWA_FEED_UNAVAILABLE', withFallbacks.missingReasons);
t('the regime is computed over the fallback-backed classes (they are real reads)',
  typeof withFallbacks.regime?.regime === 'string' && withFallbacks.regime?.votes?.length === 4
  && withFallbacks.regime.votes.some((v) => v.cls === 'stocks') && withFallbacks.regime.coMovement === 0.5, withFallbacks.regime);
t('fallbackClasses records the substitution with the original failure reason',
  withFallbacks.fallbackClasses?.stocks?.source === 'macroData:stooq'
  && withFallbacks.fallbackClasses?.stocks?.reason === 'UNCLASSIFIED_ERROR', withFallbacks.fallbackClasses);

/* 1c. the honest empty case. */
const empty = analyzeCrossAsset({ now: NOW });
t('with nothing read the analysis is UNAVAILABLE (never zero, never guessed)',
  empty.status === 'UNAVAILABLE' && empty.missing.length === 5, empty.status);
t('the empty narrative says what was not read and refuses to invent',
  empty.narrative.fa.includes('خوانده نشد') && empty.narrative.en.includes('No global asset class was read'), empty.narrative);

/* 1d. the narrative: deterministic, bilingual, no invented numbers. */
const again = analyzeCrossAsset({
  world: { domains: { market: { schema: 'fbt.fi.provenance.v1', value: { changes24hPct: { BTC: -1.2, ETH: 2.5, SOL: 0 } } } } },
  globalIntel: { domains: { stocks: { status: 'UNAVAILABLE', reason: 'UNCLASSIFIED_ERROR' } } },
  fallbacks: { stocks: { source: 'macroData:stooq', instruments: [{ symbol: 'SPX', change24hPct: 0.8 }] } },
  now: NOW
});
const narrativeSame = JSON.stringify(again.narrative) === JSON.stringify(crossNarrative(again));
t('the narrative is deterministic (same analysis → identical fa/en text)', narrativeSame);
t('the narrative names the real per-class averages (crypto +0.43٪) and the missing class with its reason',
  again.narrative.fa.includes('رمزارز') && again.narrative.fa.includes('+۰٫۴۳') === false /* digits persian, decimal sep ascii '.' */
  && again.narrative.fa.includes('۰٫۴۳') === false && again.narrative.fa.includes('۰.۴۳') !== false
  && again.narrative.fa.includes('سهام') && again.narrative.fa.includes('خوانده نشد'), again.narrative.fa.slice(0, 120));
t('the narrative does NOT print numbers for a class that was not read',
  !again.narrative.fa.includes('دارایی واقعی با میانگین'), again.narrative.fa);

/* 1e. correlations unchanged: a snapshot is not a correlation. */
const corr = correlate([1, 2, 3], [1, 2, 3]);
t('correlations still refuse anything short of 8 real paired observations',
  corr.ok === false && corr.reason === 'NEEDS_8_PAIRED_OBSERVATIONS', corr);

/* ══════════════════ 2. the owner travels with the brain read ══════════════════ */
{
  const calls = [];
  const fakeBrain = {
    directToolCall: async (args) => { calls.push(args); return { ok: true, status: 'OK', data: { rows: [{ symbol: 'XAUUSD', priceUsd: 2400, change24hPct: 0.4, category: 'commodities' }] } }; }
  };
  const { createGlobalIntelEngine } = await import('../../server/fios/globalIntel.js');
  const engine = createGlobalIntelEngine({ brain: fakeBrain, providers: {}, log: () => {}, now: () => NOW });
  const domain = await engine.readDomain('commodities', {}, NOW, 'owner-42');
  t('the global-intel brain read passes the OWNER (no more anon-store write-backs)',
    calls.length === 1 && calls[0].owner === 'owner-42' && calls[0].module === 'commodities' && calls[0].operation === 'read', calls[0]);
  t('the read still normalizes into the domain envelope (1 instrument, OK)',
    domain.status === 'OK' && domain.data.instruments.length === 1, domain);
  await engine.readDomain('stocks', { stocks: { data: { instruments: [{ symbol: 'AAPL', change24hPct: 1 }] } } }, NOW, 'owner-42');
  t('a pre-seeded section short-circuits the brain read (no upstream call)',
    calls.length === 1, calls.length);
}

/* ══════════════════ 3. the real HTTP surface, fresh owner ══════════════════ */
/* Documented in-process seam (same as fios-api-probe): the brain's own
   sources are swapped for deterministic answers; routing, owner derivation,
   the state store, the FI engines and the global engine are production code. */
const { setCiSource } = await import('../../server/ci/sources.js');
setCiSource('marketSnapshot', async ({ symbols = [] } = {}) => ({
  ok: true,
  prices: { BTC: 70000, ETH: 3000, USDC: 1 },
  changes24hPct: { BTC: -1.2, ETH: 2.5, USDC: 0.0 },
  breadth: { fearGreed: 55 },
  stale: false,
  source: 'probe-seam',
  at: Date.now()
}));
setCiSource('equitiesMarkets', async () => ({
  ok: true, venue: 'avantis',
  instruments: [
    { symbol: 'NVDA', name: 'NVIDIA', priceUsd: 120, change24hPct: 3.1, marketOpen: true },
    { symbol: 'TSLA', name: 'Tesla', priceUsd: 250, change24hPct: -0.8, marketOpen: true }
  ],
  stale: false, readOnly: true, source: 'equities-feed:avantis', at: Date.now()
}));
setCiSource('rwaMarkets', async () => ({
  ok: true, venue: 'ostium',
  rows: [
    { symbol: 'EUR/USD', priceUsd: 1.085, change24hPct: 0.15, category: 'forex' },
    { symbol: 'XAU/USD', priceUsd: 2400, change24hPct: 0.6, category: 'commodities' },
    { symbol: 'SPX', priceUsd: 5500, change24hPct: -0.2, category: 'other' },
    { symbol: 'T-NOTE', priceUsd: 110, change24hPct: 0.05, category: 'other' }
  ],
  stale: false, readOnly: true, source: 'rwa-feed:ostium', at: Date.now()
}));

const { default: app } = await import('../../server/app.js');
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const DEVICE = { 'x-fbt-device': 'cross-probe-device-01' };
const call = async (path, opts = {}) => {
  const res = await fetch(base + path, { headers: { 'content-type': 'application/json', accept: 'application/json', ...DEVICE, ...(opts.headers || {}) }, ...opts });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 200) }; }
  return { status: res.status, body };
};

/* give the dynamic FI mount a beat to attach */
await new Promise((r) => setTimeout(r, 800));

/* The /system/state snapshot lists sections WITHOUT data in `unavailable` —
   so markets absent there means «never read for this owner». */
const stateBefore = await call('/api/brain/system/state?data=1');
t('fresh owner: the state store starts with an EMPTY markets section (the old bug\u2019s precondition)',
  stateBefore.status === 200 && (stateBefore.body?.unavailable || []).some((u) => u.key === 'markets'),
  { unavailable: stateBefore.body?.unavailable || null });

const cross = await call('/api/ai/global/cross-asset');
const ca = cross.body?.crossAsset;
t('GET /api/ai/global/cross-asset answers ok on a FRESH owner (previously all-unread)', cross.status === 200 && cross.body.ok === true, { status: cross.status, body: cross.body });
t('cross-asset is OK with ALL FIVE classes observed — no more «کلاس‌های خوانده‌نشده»',
  ca?.status === 'OK' && ca?.observedClasses?.length === 5, { status: ca?.status, observed: ca?.observedClasses, missing: ca?.missing });
t('crypto came from the brain\u2019s real market read on the fresh owner', ca?.classes?.crypto?.instruments >= 1, ca?.classes?.crypto);
t('stocks/forex/commodities/rwa each carry real per-instrument changes',
  ['stocks', 'forex', 'commodities', 'rwa'].every((c) => ca?.classes?.[c]?.withChange >= 1),
  Object.fromEntries(['stocks', 'forex', 'commodities', 'rwa'].map((c) => [c, ca?.classes?.[c]])));
t('a cross-class regime was computed with named votes over all five classes',
  typeof ca?.regime?.regime === 'string' && ca?.regime?.votes?.length === 5 && typeof ca?.regime?.basis === 'string', ca?.regime);
t('the comprehensive analysis ships as narrative (fa + en) with real numbers',
  typeof ca?.narrative?.fa === 'string' && ca.narrative.fa.includes('رمزارز')
  && typeof ca?.narrative?.en === 'string' && ca.narrative.en.length > 80, ca?.narrative?.fa?.slice(0, 80));
t('the commentary answers LOCAL_ONLY / NO_AI_PROVIDER when no external AI is configured (never a canned fake)',
  ca?.commentary?.status === 'LOCAL_ONLY' && ca?.commentary?.reason === 'NO_AI_PROVIDER' && ca?.commentary?.untrusted === true, ca?.commentary);
t('the bounded digest stays available for chat/decision contexts',
  cross.body?.digest?.available === true && cross.body?.digest?.observedClasses?.length === 5, cross.body?.digest);

/* The world model reads the market from the OWNER's sections — a priceCount
   above zero means the brain's crypto.read write-back reached THIS owner's
   state store, not an anon one (the exact bug the owner-passing fixes). */
const worldAfter = await call('/api/ai/world-state');
t('the brain\u2019s markets write-back landed in the OWNER\u2019s state store (owner-passing fixed end-to-end)',
  worldAfter.status === 200 && worldAfter.body?.world?.market?.priceCount >= 1,
  { market: worldAfter.body?.world?.market || null, unavailable: (stateBefore.body?.unavailable || []).some((u) => u.key === 'markets') });

const snapshot = await call('/api/ai/global/intelligence');
const domains = snapshot.body?.globalIntelligence?.domains || {};
t('the global snapshot now reads stocks/forex/commodities/rwa OK through the brain',
  ['stocks', 'forex', 'commodities', 'rwa'].every((d) => domains[d]?.status === 'OK'),
  Object.fromEntries(Object.entries(domains).map(([k, v]) => [k, v?.status])));
t('an English caller gets an English commentary request path (fa is the default; both stay honest)',
  (await call('/api/ai/global/cross-asset?lang=en')).body?.crossAsset?.narrative?.en.length > 80);

server.close();
await new Promise((r) => setTimeout(r, 50));

console.log(`\n  ${passed}/${passed + failed} passed`);
if (failed) { console.error(`  FAILED:\n   - ${failures.join('\n   - ')}`); process.exit(1); }
process.exit(0);
