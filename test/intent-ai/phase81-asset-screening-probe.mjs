/**
 * PHASE 81 — ASSET SCREENING
 * A ticker is not an asset. A contract wearing a known symbol, a blocked
 * contract, or a pool that cannot fill the size is rejected with an explicit
 * reason BEFORE a quote is offered — never a hopeless swap and a shrug.
 */
import { readFileSync } from 'node:fs';
import {
  detectImpostor, assessLiquidity, screenAsset, assertScreenedBeforeQuote,
  SCREEN_REASONS, MIN_POOL_LIQUIDITY_USD, LIQUIDITY_DEPTH_MULTIPLE, ASSET_SCREEN_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const REAL_USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const FAKE_USDC = '0xdeadbeef00000000000000000000000000001234';
const LIST = [
  { symbol: 'USDC', address: REAL_USDC, chainId: 42161 },
  { symbol: 'WETH', address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', chainId: 42161 }
];
const ctx = (over = {}) => ({
  knownList: LIST, chainId: 42161, amountUsd: 100,
  liquidityUsd: 5_000_000, liquiditySource: 'dex:pools', ...over
});
const screen = (token, over = {}) => screenAsset({ token, context: ctx(over), now: NOW });

try {
  /* ---------- impostor detection ---------- */
  const real = detectImpostor({ symbol: 'usdc', address: REAL_USDC, chainId: 42161 }, LIST);
  check('the canonical contract is not an impostor', real.impostor === false && real.listed === true);
  const fake = detectImpostor({ symbol: 'USDC', address: FAKE_USDC, chainId: 42161 }, LIST);
  check('a different contract wearing a known ticker is an impostor', fake.impostor === true);
  check('the impostor result names the contract that SHOULD have been used', fake.canonicalAddress === REAL_USDC);
  check('the impostor result names the contract presented', fake.presentedAddress === FAKE_USDC);
  check('an unknown ticker is not an impostor, just unlisted',
    detectImpostor({ symbol: 'NEWCOIN', address: FAKE_USDC, chainId: 42161 }, LIST).listed === false);
  check('the native asset is never an impostor', detectImpostor({ symbol: 'ETH', native: true }, LIST).impostor === false);
  check('a known ticker on a different chain is not compared blindly',
    detectImpostor({ symbol: 'USDC', address: FAKE_USDC, chainId: 8453 }, LIST).impostor === false);

  /* ---------- liquidity ---------- */
  check('unreadable liquidity is unknown, not sufficient',
    assessLiquidity({ amountUsd: 100 }).known === false);
  check('unknown liquidity is never reported as sufficient',
    assessLiquidity({ amountUsd: 100 }).sufficient === false);
  check('a zero pool is no liquidity',
    assessLiquidity({ liquidityUsd: 0, source: 'dex', amountUsd: 100 }).reason === 'NO_LIQUIDITY');
  check('a pool under the floor is thin',
    assessLiquidity({ liquidityUsd: MIN_POOL_LIQUIDITY_USD - 1, source: 'dex', amountUsd: 10 }).reason === 'THIN_LIQUIDITY');
  check('a pool that cannot absorb the size is thin',
    assessLiquidity({ liquidityUsd: 100_000, source: 'dex', amountUsd: 50_000 }).reason === 'THIN_LIQUIDITY');
  check('a deep pool is sufficient',
    assessLiquidity({ liquidityUsd: MIN_POOL_LIQUIDITY_USD * 10, source: 'dex', amountUsd: 100 }).sufficient === true);
  check('depth is measured against the size, not just the floor',
    assessLiquidity({ liquidityUsd: MIN_POOL_LIQUIDITY_USD + 1, source: 'dex', amountUsd: MIN_POOL_LIQUIDITY_USD }).sufficient === false
    && LIQUIDITY_DEPTH_MULTIPLE > 1);

  /* ---------- the screen itself ---------- */
  const good = screen({ symbol: 'USDC', address: REAL_USDC, chainId: 42161 });
  check('a real, liquid, listed token passes', good.ok === true && good.verdict === 'pass');
  check('a passing screen allows the swap', good.swapAllowed === true);
  check('the screen declares its schema', good.schema === ASSET_SCREEN_SCHEMA);

  const impostorScreen = screen({ symbol: 'USDC', address: FAKE_USDC, chainId: 42161 });
  check('an impostor contract is rejected', impostorScreen.verdict === 'reject' && impostorScreen.swapAllowed === false);
  check('the rejection names the impostor reason', impostorScreen.rejections[0].code === 'IMPOSTOR_CONTRACT');
  check('the rejection is a translatable key', impostorScreen.primaryReasonKey === SCREEN_REASONS.IMPOSTOR_CONTRACT);
  check('the rejection shows both addresses so the user can compare',
    impostorScreen.primaryReasonParams.presented === FAKE_USDC && impostorScreen.primaryReasonParams.canonical === REAL_USDC);
  check('the rejection carries a classified error', typeof impostorScreen.error?.code === 'string');

  const blocked = screen({ symbol: 'USDC', address: REAL_USDC, chainId: 42161 }, { blocklist: [REAL_USDC] });
  check('a blocklisted contract is rejected', blocked.verdict === 'reject' && blocked.rejections[0].code === 'BLOCKLISTED');

  const dry = screen({ symbol: 'NEWCOIN', address: FAKE_USDC, chainId: 42161 }, { liquidityUsd: 0 });
  check('a pool with no liquidity is rejected, not attempted', dry.verdict === 'reject');
  check('the no-liquidity rejection says exactly that', dry.rejections.some((r) => r.code === 'NO_LIQUIDITY'));

  const thin = screen({ symbol: 'NEWCOIN', address: FAKE_USDC, chainId: 42161 }, { liquidityUsd: 30_000, amountUsd: 20_000 });
  check('a pool too thin for the size is rejected', thin.verdict === 'reject');
  check('the thin-liquidity rejection reports the shortfall',
    thin.rejections.find((r) => r.code === 'THIN_LIQUIDITY').params.liquidity === 30_000);

  const honeypot = screen({ symbol: 'NEWCOIN', address: FAKE_USDC, chainId: 42161 }, { tokenRisk: { honeypot: true } });
  check('a honeypot is rejected', honeypot.verdict === 'reject' && honeypot.rejections.some((r) => r.code === 'HONEYPOT'));
  const unsellable = screen({ symbol: 'NEWCOIN', address: FAKE_USDC, chainId: 42161 }, { tokenRisk: { cannotSell: true } });
  check('a token that cannot be sold is rejected', unsellable.rejections.some((r) => r.code === 'CANNOT_SELL'));

  const wrongChain = screen({ symbol: 'USDC', address: REAL_USDC, chainId: 8453 });
  check('a token from the wrong chain is rejected', wrongChain.rejections.some((r) => r.code === 'CHAIN_MISMATCH'));
  const noAddress = screen({ symbol: 'NEWCOIN', chainId: 42161 });
  check('a token with no contract address is rejected', noAddress.rejections.some((r) => r.code === 'NO_ADDRESS'));

  /* ---------- unknown is not waved through ---------- */
  const unlisted = screen({ symbol: 'NEWCOIN', address: FAKE_USDC, chainId: 42161 });
  check('an unlisted token is not silently passed', unlisted.verdict === 'acknowledge');
  check('an unlisted token is not swappable until acknowledged', unlisted.swapAllowed === false);
  check('the unlisted warning is a translatable key', unlisted.warnings.some((w) => w.i18nKey === SCREEN_REASONS.NOT_ON_ANY_LIST));
  const acked = screen({ symbol: 'NEWCOIN', address: FAKE_USDC, chainId: 42161 }, { acknowledged: true });
  check('an explicitly acknowledged unlisted token may proceed', acked.verdict === 'pass');
  check('acknowledging never overrides a hard rejection',
    screen({ symbol: 'USDC', address: FAKE_USDC, chainId: 42161 }, { acknowledged: true }).swapAllowed === false);
  const unknownLiq = screen({ symbol: 'USDC', address: REAL_USDC, chainId: 42161 }, { liquidityUsd: null, liquiditySource: null });
  check('unreadable liquidity is a warning, not a silent pass', unknownLiq.verdict === 'acknowledge');
  const unverified = screen({ symbol: 'USDC', address: REAL_USDC, chainId: 42161 }, { verified: false });
  check('an unverified contract needs a look', unverified.warnings.some((w) => w.code === 'UNVERIFIED_CONTRACT'));

  /* ---------- the fail-closed guard ---------- */
  check('the guard accepts a passed screen', assertScreenedBeforeQuote(good).ok === true);
  check('the guard rejects a rejected screen', assertScreenedBeforeQuote(impostorScreen).ok === false);
  check('the guard rejects an unacknowledged screen', assertScreenedBeforeQuote(unlisted).ok === false);
  check('a caller that forgot to screen is treated as a failed screen',
    assertScreenedBeforeQuote(null).ok === false);
  check('a hand-made object cannot pass as a screen',
    assertScreenedBeforeQuote({ swapAllowed: true }).ok === false);

  /* ---------- every reason is translated ---------- */
  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  const leafKeys = Object.values(SCREEN_REASONS).map((k) => k.split('.').slice(2));
  check('every screening reason is translated in en, fa and ar',
    locales.every((loc) => leafKeys.every((path) => typeof path.reduce((o, k) => (o || {})[k], loc.intentAI.screen) === 'string')));
  check('no screening string promises a profit',
    locales.every((loc) => !/(guarantee|profit)/i.test(JSON.stringify(loc.intentAI.screen))));

  console.log(JSON.stringify({ probe: 'phase81-asset-screening', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
