/**
 * FBT INTENT AI — PHASE 81: ASSET SCREENING
 * ---------------------------------------------------------------------------
 * A ticker is not an asset. "USDC" is a string that anyone can deploy, and the
 * most expensive mistake in a swap screen is routing to a contract that merely
 * *calls itself* the thing the user asked for.
 *
 * Every swap target passes through here first:
 *
 *   · IMPOSTOR — the symbol matches a known asset but the contract address
 *     does not. This is a hard reject, never a warning pill next to a live
 *     Swap button.
 *   · BLOCKLIST — an explicitly denied contract is a hard reject.
 *   · NO LIQUIDITY — a pool that cannot fill the size is a hard reject, so the
 *     user is told why instead of watching a hopeless swap fail on-chain.
 *   · UNKNOWN — a token that is on no list and has no liquidity reading is
 *     NOT waved through: it needs an explicit user acknowledgement.
 *
 * Rejections are i18n keys with the offending detail attached, so the panel
 * can say exactly what was wrong. Nothing here ever returns "probably fine".
 */

import { classifyFailure } from './failureModes.js';

export const ASSET_SCREEN_SCHEMA = 'fbt.asset-screening.v1';

export const SCREEN_VERDICTS = Object.freeze(['pass', 'acknowledge', 'reject']);

export const SCREEN_REASONS = Object.freeze({
  IMPOSTOR_CONTRACT: 'intentAI.screen.reason.impostor',
  BLOCKLISTED: 'intentAI.screen.reason.blocklisted',
  NO_LIQUIDITY: 'intentAI.screen.reason.noLiquidity',
  THIN_LIQUIDITY: 'intentAI.screen.reason.thinLiquidity',
  HONEYPOT: 'intentAI.screen.reason.honeypot',
  CANNOT_SELL: 'intentAI.screen.reason.cannotSell',
  UNVERIFIED_CONTRACT: 'intentAI.screen.reason.unverified',
  NOT_ON_ANY_LIST: 'intentAI.screen.reason.notListed',
  NO_ADDRESS: 'intentAI.screen.reason.noAddress',
  CHAIN_MISMATCH: 'intentAI.screen.reason.chainMismatch',
  LIQUIDITY_UNKNOWN: 'intentAI.screen.reason.liquidityUnknown'
});

/** A pool must be able to absorb the trade this many times over. */
export const LIQUIDITY_DEPTH_MULTIPLE = 10;
export const MIN_POOL_LIQUIDITY_USD = 25_000;

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
// Number(null) === 0 and Number('') === 0, so an absent value must be
// rejected BEFORE the finite check or "missing" silently reads as zero.
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));
const norm = (a) => (typeof a === 'string' && ADDRESS.test(a.trim()) ? a.trim().toLowerCase() : null);
const sym = (s) => (typeof s === 'string' && s.trim() ? s.trim().toUpperCase().slice(0, 16) : null);

/**
 * Is this contract the real holder of this ticker?
 * @param {object} token     { symbol, address, chainId }
 * @param {Array}  knownList the trusted token list for the chain
 */
export function detectImpostor(token = {}, knownList = []) {
  const symbol = sym(token.symbol);
  const address = norm(token.address);
  const chainId = num(token.chainId);
  if (!symbol) return { impostor: false, checked: false, reason: 'NO_SYMBOL' };
  if (token.native === true) return { impostor: false, checked: true, native: true };
  if (!address) return { impostor: false, checked: false, reason: 'NO_ADDRESS' };

  const sameSymbol = (Array.isArray(knownList) ? knownList : [])
    .filter((row) => sym(row?.symbol) === symbol)
    .filter((row) => chainId === null || num(row?.chainId) === null || num(row.chainId) === chainId);
  if (!sameSymbol.length) return { impostor: false, checked: true, listed: false };

  const match = sameSymbol.find((row) => norm(row?.address) === address);
  if (match) return { impostor: false, checked: true, listed: true, canonicalAddress: address };
  return {
    impostor: true,
    checked: true,
    listed: true,
    // The whole point: name the address that SHOULD have been used.
    canonicalAddress: norm(sameSymbol[0]?.address),
    presentedAddress: address,
    symbol
  };
}

/** Can this pool actually fill the requested size? */
export function assessLiquidity({ liquidityUsd = null, amountUsd = null, source = null } = {}) {
  const liq = num(liquidityUsd);
  const amount = num(amountUsd);
  if (liq === null || !source) return { known: false, sufficient: false, reason: 'LIQUIDITY_UNKNOWN' };
  if (liq <= 0) return { known: true, sufficient: false, liquidityUsd: liq, reason: 'NO_LIQUIDITY' };
  if (liq < MIN_POOL_LIQUIDITY_USD) return { known: true, sufficient: false, liquidityUsd: liq, reason: 'THIN_LIQUIDITY' };
  if (amount !== null && liq < amount * LIQUIDITY_DEPTH_MULTIPLE) {
    return { known: true, sufficient: false, liquidityUsd: liq, requiredUsd: amount * LIQUIDITY_DEPTH_MULTIPLE, reason: 'THIN_LIQUIDITY' };
  }
  return { known: true, sufficient: true, liquidityUsd: liq, source: String(source).slice(0, 60) };
}

/**
 * Screen a swap target. Called BEFORE a quote is offered, not after.
 * @param {object} token      { symbol, address, chainId, native }
 * @param {object} context    { knownList, blocklist, liquidityUsd, liquiditySource,
 *                              amountUsd, chainId, tokenRisk, verified, acknowledged }
 */
export function screenAsset({ token = {}, context = {}, now = Date.now() } = {}) {
  const rejections = [];
  const warnings = [];
  const symbol = sym(token.symbol);
  const address = norm(token.address);

  /* ---- the address has to exist and belong to this chain ---- */
  if (token.native !== true && !address) {
    rejections.push({ code: 'NO_ADDRESS', i18nKey: SCREEN_REASONS.NO_ADDRESS, params: { symbol } });
  }
  const wantChain = num(context.chainId);
  const tokenChain = num(token.chainId);
  if (wantChain !== null && tokenChain !== null && wantChain !== tokenChain) {
    rejections.push({ code: 'CHAIN_MISMATCH', i18nKey: SCREEN_REASONS.CHAIN_MISMATCH, params: { symbol, expected: wantChain, got: tokenChain } });
  }

  /* ---- an explicit blocklist entry always wins ---- */
  const blocked = (Array.isArray(context.blocklist) ? context.blocklist : []).map(norm).filter(Boolean);
  if (address && blocked.includes(address)) {
    rejections.push({ code: 'BLOCKLISTED', i18nKey: SCREEN_REASONS.BLOCKLISTED, params: { symbol, address } });
  }

  /* ---- a contract wearing someone else's ticker ---- */
  const impostor = detectImpostor(token, context.knownList);
  if (impostor.impostor === true) {
    rejections.push({
      code: 'IMPOSTOR_CONTRACT',
      i18nKey: SCREEN_REASONS.IMPOSTOR_CONTRACT,
      params: { symbol: impostor.symbol, presented: impostor.presentedAddress, canonical: impostor.canonicalAddress }
    });
  }

  /* ---- the risk report we already have ---- */
  const risk = context.tokenRisk && typeof context.tokenRisk === 'object' ? context.tokenRisk : null;
  if (risk?.honeypot === true) rejections.push({ code: 'HONEYPOT', i18nKey: SCREEN_REASONS.HONEYPOT, params: { symbol } });
  if (risk?.cannotSell === true) rejections.push({ code: 'CANNOT_SELL', i18nKey: SCREEN_REASONS.CANNOT_SELL, params: { symbol } });

  /* ---- can the pool fill it ---- */
  const liquidity = assessLiquidity({
    liquidityUsd: context.liquidityUsd,
    amountUsd: context.amountUsd,
    source: context.liquiditySource
  });
  if (liquidity.reason === 'NO_LIQUIDITY') {
    rejections.push({ code: 'NO_LIQUIDITY', i18nKey: SCREEN_REASONS.NO_LIQUIDITY, params: { symbol } });
  } else if (liquidity.reason === 'THIN_LIQUIDITY') {
    rejections.push({
      code: 'THIN_LIQUIDITY',
      i18nKey: SCREEN_REASONS.THIN_LIQUIDITY,
      params: { symbol, liquidity: liquidity.liquidityUsd, required: liquidity.requiredUsd ?? MIN_POOL_LIQUIDITY_USD }
    });
  } else if (liquidity.known === false) {
    warnings.push({ code: 'LIQUIDITY_UNKNOWN', i18nKey: SCREEN_REASONS.LIQUIDITY_UNKNOWN, params: { symbol } });
  }

  /* ---- soft signals that need the user to look ---- */
  if (impostor.checked === true && impostor.listed === false && token.native !== true) {
    warnings.push({ code: 'NOT_ON_ANY_LIST', i18nKey: SCREEN_REASONS.NOT_ON_ANY_LIST, params: { symbol, address } });
  }
  if (context.verified === false) {
    warnings.push({ code: 'UNVERIFIED_CONTRACT', i18nKey: SCREEN_REASONS.UNVERIFIED_CONTRACT, params: { symbol, address } });
  }

  const acknowledged = context.acknowledged === true;
  const verdict = rejections.length ? 'reject' : (warnings.length && !acknowledged ? 'acknowledge' : 'pass');
  return {
    ok: rejections.length === 0,
    schema: ASSET_SCREEN_SCHEMA,
    verdict,
    // A rejected asset is never quotable, whatever the user acknowledges.
    swapAllowed: verdict === 'pass',
    symbol,
    address,
    rejections,
    warnings,
    liquidity,
    impostor,
    // The single sentence the panel shows first.
    primaryReasonKey: rejections[0]?.i18nKey || warnings[0]?.i18nKey || null,
    primaryReasonParams: rejections[0]?.params || warnings[0]?.params || {},
    error: rejections.length ? classifyFailure('RISK_BLOCKED', { detail: rejections[0].code }) : null,
    screenedAt: now
  };
}

/**
 * Fail-closed guard for the quote path: no screen, no quote. A caller that
 * forgot to screen is treated exactly like a caller whose screen failed.
 */
export function assertScreenedBeforeQuote(screen) {
  if (!screen || screen.schema !== ASSET_SCREEN_SCHEMA) {
    return { ok: false, error: classifyFailure('RISK_BLOCKED', { detail: 'ASSET_NOT_SCREENED' }) };
  }
  if (screen.swapAllowed !== true) {
    return { ok: false, error: classifyFailure('RISK_BLOCKED', { detail: screen.rejections?.[0]?.code || 'SCREEN_NOT_PASSED' }) };
  }
  return { ok: true };
}
