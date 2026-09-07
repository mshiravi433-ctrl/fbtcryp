/**
 * FBT Insurance OS — PRODUCTION activation probe.
 *
 * Asserts the production-safety contract end to end (offline-friendly — it
 * never requires provider APIs and treats unreachable providers as the honest
 * UNAVAILABLE/NOT_CONFIGURED states they are):
 *
 *   1. Sandbox is structurally impossible in production.
 *   2. Live adapters degrade honestly (no fabricated quotes/capacity/terms).
 *   3. Fee transparency: FBT Marketplace Fee defaults to 100 bps (1% of the
 *      provider premium — operator decision 2026-09-08), is part of the total
 *      and is disclosed verbatim before any signature; commission is never
 *      assumed. FBT_INSURANCE_FEE_BPS=0 disables the fee.
 *   4. Standard response envelope on every route (HTTP smoke).
 *   5. Provider ranking gates (UNAVAILABLE/PAUSED/STALE/NOT_CONFIGURED/UNKNOWN
 *      never recommended) and multi-factor scoring.
 *   6. Activation requires independent on-chain verification (no receipt → no
 *      coverage, no payout).
 *   7. OpenCover registry honesty (source=opencover, capacity UNKNOWN when the
 *      live lookup fails, never scraped or invented).
 *   8. UI contract: Admin tab gone, loan menu label clean, tab-rail CSS,
 *      i18n coverage, RTL/LTR pairs, dark/light tokens.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let pass = 0;
const ok = (name) => { pass += 1; console.log('  ✓', name); };

const ROOT = new URL('../../', import.meta.url).pathname;

/* ------------------------- 1. sandbox production gate ------------------------- */
{
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    process.env.NODE_ENV = 'production';
    const reg = await import('${ROOT}server/insurance/provider-registry.js');
    const { InsuranceProviderAdapter } = await import('${ROOT}server/insurance/adapter.js');
    class Fake extends InsuranceProviderAdapter {}
    try {
      reg.registerProvider({ id: 'evil', name: 'x', status: 'SANDBOX', configured: true, adapter: new Fake() });
      console.log('REGISTERED'); // must not happen
    } catch (e) { console.log('THREW:' + e.code); }
    const adapters = await import('${ROOT}server/insurance/adapters/index.js');
    adapters.setupProviders();
    const providers = reg.listProviders();
    console.log('SANDBOX_COUNT=' + providers.filter((p) => p.status === 'SANDBOX').length);
    console.log('PROVIDERS=' + providers.map((p) => p.providerId + ':' + p.status).join(','));
  `], { encoding: 'utf8' });
  assert.ok(out.includes('THREW:SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION'), 'sandbox registration must throw in production');
  ok('NODE_ENV=production: registering a SANDBOX provider throws SANDBOX_PROVIDER_DISABLED_IN_PRODUCTION');
  assert.ok(out.includes('SANDBOX_COUNT=0'), 'no sandbox providers registered in production');
  ok('production provider registry contains zero sandbox providers');
  assert.ok(out.includes('nexus-mutual:LIVE') && out.includes('insurace:NOT_CONFIGURED'), out);
  ok(`real providers registered honestly: ${out.match(/PROVIDERS=(.*)/)?.[1]}`);
}

/* --------------------- 2. live adapters degrade honestly ---------------------- */
{
  const { NexusMutualAdapter } = await import('../../server/insurance/adapters/nexus-mutual.js');
  const { InsurAceAdapter } = await import('../../server/insurance/adapters/insurace.js');
  const nexus = new NexusMutualAdapter();
  const info = nexus.getProviderInfo();
  assert.equal(info.providerId, 'nexus-mutual');
  assert.ok(/^0x[a-fA-F0-9]{40}$/.test(info.contractAddresses.CoverBroker), 'CoverBroker address must be the verified official one');
  assert.equal(info.contractAddresses.source, 'npm:@nexusmutual/deployments');
  ok(`nexus contracts pinned to verified official deployments (${info.contractAddresses.packageVersion}, ${info.contractAddresses.verifiedAt})`);
  assert.deepEqual(info.minPeriodDays === 28 && info.maxPeriodDays === 365 ? [] : ['bad'], []);
  ok('nexus period limits are the documented 28–365 days');

  // Offline environment: the API is unreachable → honest failure, never a fake quote.
  const quote = await nexus.getQuote({
    walletAddress: '0x1111111111111111111111111111111111111111', chainId: 1,
    productId: 'nexus-1', coverageAmountMicro: 10_000_000n, durationDays: 30, termsAccepted: true
  });
  assert.equal(quote.ok, false);
  assert.ok(['PROVIDER_UNAVAILABLE', 'QUOTE_REJECTED_BY_PROVIDER'].includes(quote.error), quote.error);
  ok(`nexus quote with unreachable API → ${quote.error} (no fabricated numbers)`);
  const cap = await nexus.capacity(1);
  assert.equal(cap.ok, false);
  ok('nexus capacity with unreachable API → honest failure (no invented capacity)');
  const health = await nexus.health();
  assert.ok(['UNAVAILABLE', 'DEGRADED'].includes(health.status));
  ok(`nexus health with unreachable API → ${health.status}`);

  // Terms gate: live quotes require explicit terms acceptance.
  const noTerms = await nexus.getQuote({
    walletAddress: '0x1111111111111111111111111111111111111111', chainId: 1,
    productId: 'nexus-1', coverageAmountMicro: 10_000_000n, durationDays: 30, termsAccepted: false
  }).catch((e) => ({ ok: false, error: e.code }));
  assert.equal(noTerms.ok, false);
  assert.equal(noTerms.error, 'TERMS_ACCEPTANCE_REQUIRED');
  ok('nexus quote without terms acceptance is refused (TERMS_ACCEPTANCE_REQUIRED)');

  // Duration bounds.
  const badDays = await nexus.getQuote({
    walletAddress: '0x1111111111111111111111111111111111111111', chainId: 1,
    productId: 'nexus-1', coverageAmountMicro: 10_000_000n, durationDays: 10, termsAccepted: true
  });
  assert.equal(badDays.error, 'DURATION_OUT_OF_RANGE');
  ok('nexus quote with 10 days refused (min 28)');

  // InsurAce without a key: NOT_CONFIGURED, purchase impossible.
  const insurace = new InsurAceAdapter();
  assert.equal(insurace.configured, false);
  assert.equal(insurace.getProviderInfo().status, 'NOT_CONFIGURED');
  const insQuote = await insurace.getQuote({ chainId: 1, productId: 'insurace-ETH-1', coverageAmountMicro: 1000000n, durationDays: 30, walletAddress: '0x1111111111111111111111111111111111111111', termsAccepted: true });
  assert.equal(insQuote.ok, false);
  assert.equal(insQuote.error, 'NOT_CONFIGURED');
  ok('insurace without INSURACE_API_CODE → NOT_CONFIGURED (disabled, nothing fabricated)');
}

/* ------------------------------ 3. fee transparency --------------------------- */
{
  const { computeFees } = await import('../../server/insurance/fee-engine.js');
  const fees = computeFees({ premiumMicro: 1_500_000n, provider: {}, network: 1 });
  // Operator decision 2026-09-08: 100 bps (1%) of provider premium by default.
  assert.equal(fees.fbtFeeBps, 100);
  assert.equal(fees.fbtFeeMicro, 15_000n);
  assert.equal(fees.fbtFeeUsd, '0.015');
  assert.equal(fees.fbtMarketplaceFeeDisclosure, 'FBT Marketplace Fee: $0.015');
  assert.equal(fees.totalCostMicro, 1_515_000n);
  ok('fee engine default: FBT Marketplace Fee = 1% of premium (100 bps), part of total, disclosed verbatim');
  // Commission never assumed.
  assert.equal(fees.commissionBps, 0);
  assert.equal(fees.commissionMicro, 0n);
  ok('provider commission defaults to 0 — never assumed');

  // The fee is overridable per env — disabling it is an explicit decision.
  const disabled = execFileSync(process.execPath, ['--input-type=module', '-e', `
    process.env.FBT_INSURANCE_FEE_BPS = '0';
    const { computeFees } = await import('${ROOT}server/insurance/fee-engine.js');
    const f = computeFees({ premiumMicro: 1500000n, provider: {} });
    console.log(JSON.stringify({ micro: f.fbtFeeMicro.toString(), disclosure: f.fbtMarketplaceFeeDisclosure, total: f.totalCostMicro.toString() }));
  `], { encoding: 'utf8' });
  const dis = JSON.parse(disabled);
  assert.equal(dis.micro, '0');
  assert.equal(dis.disclosure, 'FBT Marketplace Fee: $0');
  assert.equal(dis.total, '1500000');
  ok('FBT_INSURANCE_FEE_BPS=0 disables the fee (disclosure $0, total = premium)');

  // Any other rate is an explicit env decision (child process, env read at import).
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    process.env.FBT_INSURANCE_FEE_BPS = '50';
    const { computeFees } = await import('${ROOT}server/insurance/fee-engine.js');
    const f = computeFees({ premiumMicro: 1000000n, provider: {} });
    console.log(JSON.stringify({ micro: f.fbtFeeMicro.toString(), usd: f.fbtFeeUsd, disclosure: f.fbtMarketplaceFeeDisclosure }));
  `], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.micro, '5000');
  assert.equal(parsed.disclosure, 'FBT Marketplace Fee: $0.005');
  ok(`explicit FBT_INSURANCE_FEE_BPS=50 → fee $${parsed.usd}, disclosed pre-signature`);
}

/* --------------------- 4. HTTP smoke: standard envelope ----------------------- */
{
  const express = (await import('express')).default;
  const { insuranceRouter } = await import('../../server/insurance/router.js');
  const app = express();
  app.use(express.json());
  app.use('/api/insurance', insuranceRouter());
  const server = app.listen(0);
  await new Promise((r) => server.on('listening', r));
  const port = server.address().port;
  const get = async (p) => (await fetch(`http://127.0.0.1:${port}/api/insurance${p}`)).json();
  const post = async (p, b) => (await fetch(`http://127.0.0.1:${port}/api/insurance${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) })).json();

  for (const [path, fn] of [['/capabilities', () => get('/capabilities')], ['/providers', () => get('/providers')], ['/products', () => get('/products')], ['/quote', () => post('/quote', { chainId: 1, walletAddress: '0x1111111111111111111111111111111111111111' })], ['/pool', () => get('/pool')], ['/pool/solvency', () => get('/pool/solvency')], ['/vaults', () => get('/vaults')], ['/provider-health', () => get('/provider-health')]]) {
    const body = await fn();
    for (const key of ['requestId', 'timestamp', 'version', 'data', 'warnings', 'errors', 'source', 'freshness']) {
      assert.ok(key in body, `${path} missing envelope key ${key}`);
    }
    assert.ok(body.requestId.startsWith('req-'));
    assert.equal(body.version, 'v1');
    assert.ok('stale' in body.freshness && 'updatedAt' in body.freshness);
  }
  ok('every route answers with the standard envelope (requestId/timestamp/version/data/warnings/errors/source/freshness)');

  const caps = (await get('/capabilities')).data;
  assert.equal(caps.autoExecuteAllowed, false);
  assert.equal(caps.custodyEnabled, false);
  assert.equal(caps.protectionPoolEnabled, false);
  ok('capabilities: autoExecute=false, custody=false, pool=false');

  const quote = await post('/quote', { chainId: 1, walletAddress: '0x1111111111111111111111111111111111111111', protectionType: 'smart-contract', coverageAmount: '10000', durationDays: 28, termsAccepted: true });
  if (quote.ok) {
    // Dev/test: sandbox providers may quote — they must be clearly labelled.
    assert.ok(quote.data.quotes.length >= 1);
    assert.ok(quote.data.quotes.every((q) => q.sandbox === true), 'dev sandbox quotes must carry sandbox:true');
    ok('dev /quote returns sandbox quotes, each explicitly labelled sandbox:true');
  } else {
    assert.equal(quote.errors[0].code, 'NO_ELIGIBLE_PROTECTION');
    assert.ok(quote.warnings.includes('LIVE_QUOTE_NOT_AVAILABLE'));
    ok('quote with no live provider answers honestly: NO_ELIGIBLE_PROTECTION + LIVE_QUOTE_NOT_AVAILABLE (never a fake quote)');
  }
  // PRODUCTION honesty: with sandbox structurally absent and providers
  // unreachable, /quote must refuse to fabricate anything.
  const prodQuoteOut = execFileSync(process.execPath, ['--input-type=module', '-e', `
    process.env.NODE_ENV = 'production';
    const express = (await import('${ROOT}node_modules/express/index.js')).default;
    const { insuranceRouter } = await import('${ROOT}server/insurance/router.js');
    const app = express();
    app.use(express.json());
    app.use('/api/insurance', insuranceRouter());
    const server = app.listen(0);
    await new Promise((r) => server.on('listening', r));
    const port = server.address().port;
    const res = await fetch('http://127.0.0.1:' + port + '/api/insurance/quote', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chainId: 1, walletAddress: '0x1111111111111111111111111111111111111111', protectionType: 'smart-contract', coverageAmount: '10000', durationDays: 28, termsAccepted: true })
    });
    const body = await res.json();
    console.log('QUOTE_OK=' + body.ok);
    console.log('QUOTE_CODE=' + (body.errors?.[0]?.code || 'none'));
    console.log('QUOTE_WARNINGS=' + (body.warnings || []).join('|'));
    server.close();
    process.exit(0);
  `], { encoding: 'utf8' });
  assert.ok(prodQuoteOut.includes('QUOTE_OK=false'), prodQuoteOut);
  assert.ok(prodQuoteOut.includes('QUOTE_CODE=NO_ELIGIBLE_PROTECTION'), prodQuoteOut);
  assert.ok(prodQuoteOut.includes('LIVE_QUOTE_NOT_AVAILABLE'), prodQuoteOut);
  ok('production /quote with unreachable providers: NO_ELIGIBLE_PROTECTION + LIVE_QUOTE_NOT_AVAILABLE — never a fabricated quote');

  const pool = (await get('/pool')).data;
  assert.equal(pool.enabled, false);
  assert.ok(pool.blockedFunctions.includes('depositCapital'));
  const solvency = (await get('/pool/solvency')).data;
  assert.equal(solvency.solvencyModel, 'NOT_CONFIGURED');
  ok('internal pool disabled and honest: no APY, no solvency claims, capital functions blocked');

  const vaults = (await get('/vaults')).data;
  assert.equal(vaults.registry.source, 'opencover');
  assert.ok(vaults.vaults.length >= 10);
  for (const v of vaults.vaults) {
    assert.equal(v.source, 'opencover');
    assert.ok(v.policyUrl && v.annexUrl);
    assert.ok(v.stale === true && v.coveredCapacity === null || v.capacitySource === 'nexus-mutual-api');
  }
  ok(`OpenCover registry: ${vaults.vaults.length} reference vaults, source=opencover, capacity UNKNOWN without a live Nexus lookup (never scraped/invented)`);

  // Admin endpoints not public in production.
  const prodOut = execFileSync(process.execPath, ['--input-type=module', '-e', `
    process.env.NODE_ENV = 'production';
    const express = (await import('${ROOT}node_modules/express/index.js')).default;
    const { insuranceRouter } = await import('${ROOT}server/insurance/router.js');
    const app = express();
    app.use(express.json());
    app.use('/api/insurance', insuranceRouter());
    const server = app.listen(0);
    await new Promise((r) => server.on('listening', r));
    const port = server.address().port;
    const res = await fetch('http://127.0.0.1:' + port + '/api/insurance/admin/dashboard');
    console.log('ADMIN_STATUS=' + res.status);
    server.close();
    process.exit(0);
  `], { encoding: 'utf8' });
  assert.ok(prodOut.includes('ADMIN_STATUS=404'), prodOut);
  ok('production: /admin/* returns 404 — no public admin surface');

  server.close();
}

/* --------------------------- 5. recommendation gates -------------------------- */
{
  const { rankQuotes, recommendable } = await import('../../server/insurance/recommendation.js');
  for (const status of ['UNAVAILABLE', 'PAUSED', 'STALE', 'NOT_CONFIGURED', 'UNKNOWN']) {
    assert.equal(recommendable(status, 'HEALTHY'), false, status);
    assert.equal(recommendable('LIVE', status), false, status);
  }
  assert.equal(recommendable('LIVE', 'HEALTHY'), true);
  ok('recommendable() gates: UNAVAILABLE/PAUSED/STALE/NOT_CONFIGURED/UNKNOWN never recommended for new purchases');

  const quotes = [
    { quoteId: 'cheap', provider: 'a', premiumMicro: '100', coverageAmountMicro: '10000', providerHealth: 'HEALTHY', claimMethod: 'on-chain-proof', termsHash: 'x', chainId: 1 },
    { quoteId: 'solid', provider: 'b', premiumMicro: '140', coverageAmountMicro: '10000', providerHealth: 'HEALTHY', claimMethod: 'on-chain-proof', termsHash: 'x', chainId: 1 }
  ];
  const ranked = rankQuotes(quotes, { providerMeta: { a: { status: 'LIVE', healthStatus: 'HEALTHY', auditStatus: 'provider-published' }, b: { status: 'LIVE', healthStatus: 'HEALTHY', auditStatus: 'provider-published' } } });
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.ok(ranked.every((q) => q.scoreExplain && typeof q.scoreExplain.providerHealth === 'number'));
  ok(`ranking scores multi-factor and is explainable (top score ${ranked[0].score} > ${ranked[1].score})`);
}

/* ------------------- 6. activation requires real verification ----------------- */
{
  const store = await import('../../server/insurance/store.js');
  const coverageApi = await import('../../server/insurance/coverage.js');
  const covId = 'cov-prod-probe-1';
  await store.set('coverage', covId, {
    coverageId: covId, owner: '0x2222222222222222222222222222222222222222',
    providerId: 'nexus-mutual', providerName: 'Nexus Mutual', status: 'PENDING',
    durationDays: 28, chainId: 1, premiumMicro: '1000000', totalCostMicro: '1000000',
    coverageAmountMicro: '10000000', termsHash: 'abc', createdAt: Date.now(), events: []
  });
  let failed = null;
  try {
    await coverageApi.activateCoverage({ coverageId: covId, owner: '0x2222222222222222222222222222222222222222', txHash: '0xdeadbeef', chainId: 1 });
  } catch (e) { failed = e; }
  assert.ok(failed, 'activation must fail without a verifiable receipt');
  assert.equal(failed.code, 'COVERAGE_NOT_VERIFIED');
  const cov = await store.get('coverage', covId);
  assert.equal(cov.status, 'PENDING');
  ok('coverage activation with an unverifiable tx hash → COVERAGE_NOT_VERIFIED, coverage stays PENDING (no fabricated activation)');

  const { verifyEvmReceipt } = await import('../../server/insurance/verification.js');
  const malformed = await verifyEvmReceipt({ chainId: 1, txHash: 'not-a-hash' });
  assert.equal(malformed.verified, false);
  assert.equal(malformed.reason, 'MALFORMED_TX_HASH');
  ok('receipt verification rejects malformed hashes outright');
}

/* ------------------------------- 7. UI contract ------------------------------- */
{
  const app = readFileSync(`${ROOT}src/App.jsx`, 'utf8');
  assert.ok(!app.includes('InsuranceAdmin'), 'App.jsx must not reference InsuranceAdmin');
  assert.ok(!app.includes('insurance/admin'), 'App.jsx must not mount /insurance/admin');
  ok('admin page unmounted: no InsuranceAdmin import, no /insurance/admin route');

  const shell = readFileSync(`${ROOT}src/pages/insurance/InsuranceShell.jsx`, 'utf8');
  assert.ok(!/Admin/.test(shell), 'InsuranceShell must not render an Admin tab');
  assert.ok(shell.includes('role="tablist"') && shell.includes('aria-label'), 'tab rail must expose tablist semantics');
  assert.ok(shell.includes('onKeyDown') && shell.includes('ArrowRight'), 'tab rail must support keyboard navigation');
  assert.ok(shell.includes('<InsuranceExplain />'), 'InsuranceShell must render the shared transparency box');
  const outletIdx = shell.indexOf('<Outlet');
  const explainIdx = shell.indexOf('<InsuranceExplain />');
  assert.ok(outletIdx !== -1 && explainIdx > outletIdx, 'transparency box must sit BELOW the routed page (bottom of every insurance page)');
  ok('InsuranceShell: Admin tab removed; tab rail has role=tablist + aria-label + keyboard navigation');

  const css = readFileSync(`${ROOT}src/pages/insurance/insurance.css`, 'utf8');
  assert.ok(/\.ins-tabs\s*\{[^}]*flex-wrap:\s*nowrap/.test(css), 'ins-tabs must not wrap');
  assert.ok(/\.ins-tabs\s*\{[^}]*overflow-x:\s*auto/.test(css), 'ins-tabs must scroll horizontally');
  assert.ok(/\.ins-tabs\s*\{[^}]*-webkit-overflow-scrolling:\s*touch/.test(css), 'ins-tabs must touch-scroll');
  assert.ok(/\.ins-tabs\s*>\s*\*\s*\{[^}]*flex:\s*0\s*0\s*auto/.test(css), 'tab items must not shrink');
  ok('tab rail CSS: horizontal rail, nowrap, overflow-x auto, touch scrolling, flex: 0 0 auto');

  const market = readFileSync(`${ROOT}src/pages/insurance/InsuranceMarketplace.jsx`, 'utf8');
  assert.ok(!market.includes('<details'), 'marketplace must not duplicate the accordion (shell renders it once)');
  const explain = readFileSync(`${ROOT}src/pages/insurance/InsuranceExplain.jsx`, 'utf8');
  assert.ok(explain.includes('<details'), 'InsuranceExplain needs the expandable accordion');
  for (const icon of ['Icon.Wallet', 'Icon.Shield', 'Icon.Risk', 'Icon.Fee', 'Icon.Chain', 'Icon.Claim']) {
    assert.ok(explain.includes(icon), `accordion missing icon ${icon}`);
  }
  assert.ok(!/Icon\.\w+\(\).*iconfont/i.test(explain));
  ok('transparency accordion lives once in InsuranceExplain (bottom of every page via shell) with inline SVG icons (wallet/shield/risk/fee/chain/claim)');

  const client = readFileSync(`${ROOT}src/lib/insuranceClient.js`, 'utf8');
  assert.ok(!client.includes('/admin/'), 'client must not expose admin endpoints');
  ok('insurance client exposes no admin surface');
}

/* --------------------------- 8. loan label & i18n ----------------------------- */
{
  const BAD = ['protection', 'insurance', 'محافظت', 'بیمه', 'protección', 'protection ', 'versicherung', 'sigorta', 'страхов', 'bảo hiểm'];
  for (const locale of ['en', 'fa', 'ar', 'es', 'fr', 'tr', 'ru', 'hi', 'id', 'pt', 'ur', 'zh']) {
    const doc = JSON.parse(readFileSync(`${ROOT}src/i18n/locales/${locale}.json`, 'utf8'));
    const loan = String(doc.nav?.loan || '');
    assert.ok(loan.length > 0, `${locale}.nav.loan missing`);
    const lower = loan.toLowerCase();
    for (const bad of BAD) {
      if (bad === 'protection ' && locale === 'fr') continue; // 'Prêts' contains no such substring anyway
      assert.ok(!lower.includes(bad.toLowerCase()), `${locale}.nav.loan="${loan}" must not contain "${bad}"`);
    }
    // insurance namespace completeness (fee zero disclosure + tabs + accordion)
    assert.ok(doc.insurance?.tabs?.marketplace, `${locale} missing insurance.tabs.marketplace`);
    assert.ok(doc.insurance?.fee?.zero, `${locale} missing insurance.fee.zero`);
    assert.ok(doc.insurance?.info?.flowTitle, `${locale} missing insurance.info.flowTitle`);
  }
  ok('all locales: nav.loan is a clean loan word (no protection/insurance terms); insurance namespace complete');

  const fa = JSON.parse(readFileSync(`${ROOT}src/i18n/locales/fa.json`, 'utf8'));
  assert.equal(fa.nav.loan, 'وام');
  const en = JSON.parse(readFileSync(`${ROOT}src/i18n/locales/en.json`, 'utf8'));
  assert.ok(['loan', 'loans'].includes(en.nav.loan.toLowerCase()));
  ok('loan menu label: fa=وام, en=Loans');
}

console.log(`\nPASS ${pass} insurance-production assertions`);
