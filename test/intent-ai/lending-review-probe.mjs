/**
 * FBT INTENT AI — local LENDING REVIEW probe.
 * ---------------------------------------------------------------------------
 * The chat's lending turn is built from what THIS turn read from the Aave
 * reserves, the protocol oracle and the connected account. The contract this
 * pins, all of it about not inventing money:
 *
 *   · a review card (and an executable action) exists ONLY from a live, fresh,
 *     active reserve with a valid oracle price and — for a borrow — a verified
 *     collateral/debt/capacity read and a projected health factor ≥ 1.20;
 *   · the action carries exactly the terms the user was shown (exact token
 *     amount and unit, price, rate, health factor) so the venue executor can
 *     re-read the pool and refuse on any drift;
 *   · stale / partial / unavailable / registry-only data is named as such and
 *     never turned into a card, a rate or a confident number;
 *   · FARM is not an Aave supply: it never produces a lending review, and the
 *     supported-asset registry is never presented as a live rate.
 *
 * Pure Node: the human layer is driven with real-shaped tool results.
 */
import { fileURLToPath } from 'node:url';
import { understandIntent } from '../../src/lib/intent-ai/os/intentUnderstanding.js';
import { buildHumanResponse } from '../../src/lib/intent-ai/os/humanResponse.js';

const rows = [];
const t = (name, ok, extra = null) => rows.push([name, Boolean(ok), extra]);

const NOW = Date.now();
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const market = (over = {}) => ({
  id: 'usdc-8453', symbol: 'USDC', name: 'USD Coin', address: USDC_BASE, decimals: 6,
  chainId: 8453, chainName: 'Base', protocol: 'Aave V3', venue: 'aave-base-usdc',
  supplyApyPct: 4.31, borrowApyPct: 5.12,
  rateStatus: 'live', borrowRateStatus: 'live', dataStatus: 'live',
  available: true, borrowAvailable: true, borrowingEnabled: true,
  reserveStatus: 'active', reserveAddress: USDC_BASE,
  availableLiquidityWei: String(6n * 10n ** 14n),
  priceUsd: 1, priceStatus: 'live', priceSource: 'protocol-oracle',
  source: 'aave-rpc', fetchedAt: NOW - 5_000, ...over
});
const scan = (marketOver = {}, over = {}) => ({
  ok: true, scope: 'lending', chainId: 8453, opportunities: [],
  lendingMarkets: [market(marketOver)],
  supportedLendingMarkets: [{ symbol: 'USDC', chainId: 8453 }, { symbol: 'WETH', chainId: 8453 }],
  lendingDataStatus: 'live', lendingFetchedAt: NOW - 5_000, lendingSource: 'aave-rpc',
  updatedAt: NOW - 5_000, ...over
});
const assetPosition = (over = {}) => ({ ok: true, dataStatus: 'live', walletWei: '5000000000', ...over });
const account = (over = {}) => ({
  ok: true, dataStatus: 'live', totalCollateralUsd: 10000, totalDebtUsd: 1000,
  availableBorrowsUsd: 5000, liquidationThresholdPct: 82, ...over
});
const wallet = { connected: true, address: '0x1111111111111111111111111111111111111111', chainId: 8453 };

const respond = (message, results, { locale = 'en', ctx = { wallet } } = {}) => {
  const understood = understandIntent(message, { locale });
  const intent = understood.intent || understood;
  return buildHumanResponse({ intent, context: { ...ctx, lastMessage: message }, results, locale });
};
const noCard = (r) => r.card == null && (r.actions || []).length === 0 && r.requiresConfirmation !== true && r.ui?.type !== 'ACTION_CARD';

/* ── 1. an informational question: live rates, no action, no promise ─────── */
{
  const r = respond('what are the lending rates on Base?', { yieldOpportunities: scan() });
  t('a rates question answers from the live reserve read and creates NO action', noCard(r) && r.yieldMarkets?.status === 'live');
  t('the rate card carries the live supply rate and oracle price',
    r.yieldMarkets.markets[0]?.supplyApyPct === 4.31 && r.yieldMarkets.markets[0]?.priceUsd === 1);
  t('the reply says the APY is variable, not guaranteed, and not an instruction',
    /not guaranteed/i.test(r.message) && /variable/i.test(r.message), r.message);
}

/* ── 2. a reviewed supply: exact amount, unit, price, rate — and nothing signed ── */
{
  const r = respond('supply 100 USDC on Base', { yieldOpportunities: scan(), lendingAssetPosition: assetPosition() });
  const a = r.actions?.[0] || {};
  t('a fresh live supply request builds ONE review card', r.card?.kind === 'LENDING_REVIEW' && r.actions.length === 1 && r.requiresConfirmation === true, JSON.stringify(r.code));
  t('the action is an Aave lending SUPPLY on the verified Base venue', a.type === 'LEND' && a.chainId === 8453 && a.venue === 'aave-base-usdc', JSON.stringify(a));
  t('the amount is the exact token amount in the token\'s own unit (USDC, not USD)', a.amount === '100' && a.amountUnit === 'USDC', `${a.amount}/${a.amountUnit}`);
  t('the action carries the reviewed terms the executor re-checks',
    a.parameters?.requireLiveRateReview === true && a.parameters.reviewedPriceUsd === 1
      && a.parameters.reviewedSupplyApyPct === 4.31 && Number.isFinite(a.parameters.reviewedAt));
  t('the review says nothing was signed and shows balance, price and rate',
    r.card.review.walletBalance === '5000' && r.card.review.priceUsd === 1 && r.card.review.ratePct === 4.31 && r.card.review.rateStatus === 'live');
  t('the message states APY is variable, not guaranteed, and nothing is signed without confirmation',
    /not guaranteed/i.test(r.message) && /nothing is signed or sent without your confirmation/i.test(r.message), r.message);
  t('a review is never a transaction (no hash, no execution claim)', !r.execution && r.executed !== true && !a.txHash);
}

/* ── 3. a supply is refused — with a named reason — on any unproven input ── */
{
  const cases = [
    ['a stale reserve rate', scan({ rateStatus: 'stale' }), assetPosition(), 'LENDING_RATE_STALE'],
    ['a partial reserve read', scan({ rateStatus: 'partial', dataStatus: 'partial', available: false }), assetPosition(), 'LENDING_RATE_UNAVAILABLE'],
    ['a paused/inactive reserve', scan({ reserveStatus: 'paused', available: false }), assetPosition(), 'LENDING_RATE_UNAVAILABLE'],
    ['a missing oracle price', scan({ priceUsd: null, priceStatus: 'unavailable' }), assetPosition(), 'ORACLE_PRICE_UNAVAILABLE'],
    ['a stale oracle price', scan({ priceStatus: 'stale' }), assetPosition(), 'ORACLE_PRICE_UNAVAILABLE'],
    ['an unverifiable wallet balance', scan(), { ok: false, dataStatus: 'unavailable' }, 'BALANCE_UNVERIFIED'],
    ['a wallet balance below the amount', scan(), assetPosition({ walletWei: '1000000' }), 'INSUFFICIENT_FUNDS'],
    ['a read older than the confirmation window', scan({ fetchedAt: NOW - 10 * 60_000 }, { lendingFetchedAt: NOW - 10 * 60_000 }), assetPosition(), 'LENDING_REVIEW_EXPIRED']
  ];
  for (const [name, results, position, code] of cases) {
    const r = respond('supply 100 USDC on Base', { yieldOpportunities: results, lendingAssetPosition: position });
    t(`${name} → ${code}, no card and no action`, noCard(r) && r.code === code, `${r.code} card=${r.card?.kind}`);
  }
  const noChain = respond('supply 100 USDC', { yieldOpportunities: scan({}, { chainId: null }) }, { ctx: { wallet: { connected: true, address: wallet.address } } });
  t('no network named and none on the wallet → asks, never defaults a chain', noCard(noChain) && noChain.code === 'LENDING_CHAIN_REQUIRED', noChain.code);
  const noWallet = respond('supply 100 USDC on Base', { yieldOpportunities: scan() }, { ctx: { wallet: { connected: false } } });
  t('no wallet → connect prompt, nothing built', noCard(noWallet) && noWallet.code === 'WALLET_REQUIRED' && noWallet.ui?.type === 'CONNECT_WALLET', `${noWallet.code}/${noWallet.ui?.type}`);
  const unlisted = respond('supply 100 USDC on Base', { yieldOpportunities: { ...scan(), lendingMarkets: [], supportedLendingMarkets: [{ symbol: 'USDC', chainId: 8453 }] } });
  t('a supported-registry asset with no live reserve read is NOT presented as a live rate',
    noCard(unlisted) && unlisted.code === 'LENDING_RATE_UNAVAILABLE' && /registry/i.test(unlisted.message), `${unlisted.code} ${unlisted.message}`);
  const notSupported = respond('supply 100 USDC on Base', { yieldOpportunities: { ...scan(), lendingMarkets: [], supportedLendingMarkets: [] } });
  t('an asset outside the registry is refused as unsupported', noCard(notSupported) && notSupported.code === 'ASSET_NOT_LISTED', notSupported.code);
}

/* ── 4. BORROW: capacity, health factor — or nothing ─────────────────────── */
{
  const base = { yieldOpportunities: scan({}, { chainId: 42161 }), lendingPosition: account() };
  const arb = market({ id: 'usdc-42161', chainId: 42161, chainName: 'Arbitrum', venue: 'lend-aave', borrowApyPct: 5.12 });
  const arbScan = (over = {}) => ({ ...scan(), chainId: 42161, lendingMarkets: [{ ...arb, ...over }], supportedLendingMarkets: [{ symbol: 'USDC', chainId: 42161 }] });
  const ctx = { wallet: { ...wallet, chainId: 42161 } };
  const ok = respond('borrow 500 USDC on Arbitrum', { yieldOpportunities: arbScan(), lendingPosition: account() }, { ctx });
  const a = ok.actions?.[0] || {};
  t('a verified borrow builds a review with capacity and a projected health factor',
    ok.card?.kind === 'LENDING_REVIEW' && ok.card.review.side === 'borrow'
      && ok.card.review.availableBorrowsUsd === 5000 && Math.abs(ok.card.review.projectedHealthFactor - 5.4667) < 0.01, JSON.stringify(ok.code));
  t('the borrow action is BORROW on the generic Aave venue with the reviewed risk terms',
    a.type === 'BORROW' && a.venue === 'lend-aave' && a.amount === '500' && a.amountUnit === 'USDC'
      && a.parameters?.reviewedBorrowApyPct === 5.12 && a.parameters.reviewedAvailableBorrowsUsd === 5000
      && Math.abs(a.parameters.reviewedProjectedHealthFactor - 5.4667) < 0.01, JSON.stringify(a.parameters));
  t('the borrow message warns of variable rate and liquidation risk',
    /variable/i.test(ok.message) && (/liquidat/i.test(ok.message) || /health/i.test(JSON.stringify(ok.card))), ok.message);

  const cases = [
    ['a health factor below 1.20', account({ totalDebtUsd: 8000 }), 'HEALTH_FACTOR_TOO_LOW', {}],
    ['an amount beyond 99% of the borrowing capacity', account({ availableBorrowsUsd: 300 }), 'BORROW_LIMIT_EXCEEDED', {}],
    ['an unreadable collateral/debt position', { ok: false, dataStatus: 'unavailable' }, 'RISK_DATA_UNAVAILABLE', {}],
    ['no collateral at all', account({ totalCollateralUsd: 0 }), 'BORROW_CAPACITY_UNAVAILABLE', {}],
    ['a reserve with borrowing unavailable', account(), 'LENDING_RATE_UNAVAILABLE', { borrowAvailable: false, borrowRateStatus: 'unavailable' }],
    ['a stale borrow rate', account(), 'LENDING_RATE_STALE', { borrowRateStatus: 'stale' }]
  ];
  for (const [name, position, code, marketOver] of cases) {
    const r = respond('borrow 500 USDC on Arbitrum', { yieldOpportunities: arbScan(marketOver), lendingPosition: position }, { ctx });
    t(`a borrow with ${name} → ${code}, no card and no action`, noCard(r) && r.code === code, `${r.code} card=${r.card?.kind}`);
  }
}

/* ── 5. FARM is not Aave ─────────────────────────────────────────────────── */
{
  const withLpRows = {
    yieldOpportunities: scan({}, {
      opportunities: [
        { kind: 'farm', symbol: 'SOL-USDC', protocol: 'Orca', chainId: 501, apy: 18.4, rateStatus: 'live', dataStatus: 'live' },
        { kind: 'lending', symbol: 'USDC', protocol: 'Aave V3', chainId: 8453, apy: 4.31, rateStatus: 'live', dataStatus: 'live' }
      ]
    }),
    lendingAssetPosition: assetPosition()
  };
  const r = respond('farm 100 USDC on Base', withLpRows);
  t('FARM never yields a lending review card or an executable action',
    r.card == null && (r.actions || []).every((x) => !x.type) && r.requiresConfirmation === false && r.ui?.type === 'TEXT');
  t('FARM states that a single-asset Aave supply is not LP farming', /not LP farming|Aave supply is not/i.test(r.message), r.message);
  t('FARM offers only an inspection route to the farm page', r.actions.length === 1 && r.actions[0].route === '/farm');
  t('only LP/farm rows are surfaced as farm opportunities — never the Aave lending rate',
    Array.isArray(r.opportunities) && r.opportunities.length === 1 && r.opportunities[0].kind === 'farm');
  t('FARM has a stable machine code distinguishing "no executor" from "no data"', ['FARM_EXECUTOR_UNAVAILABLE', 'FARM_DATA_UNAVAILABLE'].includes(r.code), r.code);
  const fa = respond('farm 100 USDC on Base', withLpRows, { locale: 'fa' });
  t('the Persian FARM reply says the same and builds nothing', fa.card == null && /فارم/.test(fa.message) && fa.requiresConfirmation === false);
}

/* ── 6. Persian: same gates, same words ──────────────────────────────────── */
{
  const r = respond('۱۰۰ USDC در Base وام بده', { yieldOpportunities: scan({ rateStatus: 'stale' }), lendingAssetPosition: assetPosition() }, { locale: 'fa' });
  t('a stale rate in Persian is also withheld with a Persian explanation', noCard(r) && /stale|کهنه|تازه/.test(r.message) && r.code === 'LENDING_RATE_STALE', `${r.code} ${r.message}`);
}

/* ── 7. the amount is never rounded silently ─────────────────────────────── */
{
  const r = respond('supply 1.1234567 USDC on Base', { yieldOpportunities: scan(), lendingAssetPosition: assetPosition() });
  t('an amount beyond the token precision is refused, not rounded', noCard(r) && r.code === 'AMOUNT_PRECISION_INVALID', `${r.code}`);
}

/* ── 8. a token amount is a token amount; a dollar amount goes through the oracle ── */
{
  const priced = { yieldOpportunities: scan({ priceUsd: 1.0001 }), lendingAssetPosition: assetPosition() };
  const token = respond('supply 100 USDC on Base', priced);
  t('"100 USDC" stays EXACTLY 100 token units even when the oracle price is not 1',
    token.actions?.[0]?.amount === '100' && token.actions[0].amountUnit === 'USDC', token.actions?.[0]?.amount);
  t('…and its USD value is derived from the oracle, not assumed', Math.abs(token.actions?.[0]?.amountUsd - 100.01) < 1e-9, token.actions?.[0]?.amountUsd);
  const dollars = respond('supply $100 USDC on Base', priced);
  t('"$100 USDC" is converted through the protocol oracle and rounded DOWN, never up',
    dollars.actions?.[0]?.amount === '99.99' && dollars.actions[0].amountUnit === 'USDC', dollars.actions?.[0]?.amount);
}

/* Run directly: print and set the exit code. Imported by test/run.mjs: only
   export the rows and let the runner report them. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const failed = rows.filter((r) => !r[1]);
  console.log(`\nlending-review probe: ${rows.length - failed.length}/${rows.length} passed`);
  if (failed.length) {
    console.error(failed.map((r) => `  ✗ ${r[0]}${r[2] ? ` [${r[2]}]` : ''}`).join('\n'));
    process.exit(1);
  }
  console.log('OK: intent-ai/lending-review-probe');
}

export default rows;
