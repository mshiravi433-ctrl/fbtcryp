#!/usr/bin/env node
/**
 * Unit tests for the Hyperliquid read-only view and the risk caps.
 * No network: every request goes through an injected fake fetch.
 * Run: node test/hyperliquid-readonly-units.mjs
 */
import {
  HL_ERRORS,
  HL_INFO_URL,
  buildInfoRequest,
  fetchHyperliquidInfo,
  isValidHlAddress,
  parseAccountSummary,
  readAccountSummary
} from '../src/lib/hyperliquid/readonly.js';
import { HL_CAP_CODES, HL_CAP_DEFAULTS, checkOrderAgainstCaps } from '../src/lib/hyperliquid/caps.js';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.error(`FAIL ${name} ${detail}`); }
};

const USER = '0x' + 'a'.repeat(40);

// ── address and request building ───────────────────────────────────────────
check('valid address accepted', isValidHlAddress(USER));
check('short address rejected', !isValidHlAddress('0x1234'));
check('non-hex address rejected', !isValidHlAddress('0x' + 'g'.repeat(40)));
check('null address rejected', !isValidHlAddress(null));

const bad = buildInfoRequest('clearinghouseState', 'nope');
check('bad address -> BAD_ADDRESS before any request', bad.code === HL_ERRORS.BAD_ADDRESS);
const badType = buildInfoRequest('exchange', USER);
check('non-info type refused (no /exchange path exists here)', badType.code === HL_ERRORS.BAD_TYPE);
const mids = buildInfoRequest('allMids');
check('allMids needs no user', mids.ok && mids.body.type === 'allMids' && !('user' in mids.body));
const state = buildInfoRequest('clearinghouseState', USER);
check('clearinghouseState body', state.ok && state.body.type === 'clearinghouseState' && state.body.user === USER);

// ── parsing ────────────────────────────────────────────────────────────────
const raw = {
  marginSummary: { accountValue: '1234.5', totalMarginUsed: '200', totalNtlPos: '800' },
  withdrawable: '1000.25',
  assetPositions: [
    { position: { coin: 'BTC', szi: '0.01', entryPx: '95000', unrealizedPnl: '12.5', liquidationPx: '60000', leverage: { value: 3 } } },
    { position: { coin: 'ETH', szi: '-0.5', entryPx: null, unrealizedPnl: 'x', liquidationPx: null, leverage: {} } },
    { notAPosition: true }
  ]
};
const sum = parseAccountSummary(raw);
check('parse ok', sum.ok === true);
check('account value', sum.accountValueUsd === 1234.5);
check('withdrawable', sum.withdrawableUsd === 1000.25);
check('positions filtered to real ones', sum.positions.length === 2);
check('btc leverage parsed', sum.positions[0].leverage === 3 && sum.positions[0].size === 0.01);
check('missing entry is null, not zero', sum.positions[1].entryPx === null);
check('garbage pnl is null, not zero', sum.positions[1].unrealizedPnl === null);
check('empty object rejected as BAD_RESPONSE', parseAccountSummary({}).code === HL_ERRORS.BAD_RESPONSE);
check('null rejected as BAD_RESPONSE', parseAccountSummary(null).code === HL_ERRORS.BAD_RESPONSE);

// ── fetch behaviour (fake fetch, no network) ───────────────────────────────
const calls = [];
const fakeOk = async (url, init) => {
  calls.push({ url, init });
  return { ok: true, status: 200, json: async () => raw };
};
const okRes = await readAccountSummary(USER, { fetchImpl: fakeOk });
check('read ok', okRes.ok === true && okRes.accountValueUsd === 1234.5);
check('posts to mainnet info URL', calls[0].url === HL_INFO_URL && calls[0].init.method === 'POST');
check('request body is read-only type', JSON.parse(calls[0].init.body).type === 'clearinghouseState');
check('mainnet URL is not testnet', !HL_INFO_URL.includes('testnet'));

const r429 = await fetchHyperliquidInfo('clearinghouseState', USER, {
  fetchImpl: async () => ({ ok: false, status: 429 })
});
check('429 -> RATE_LIMITED', r429.code === HL_ERRORS.RATE_LIMITED);

const r500 = await fetchHyperliquidInfo('clearinghouseState', USER, {
  fetchImpl: async () => ({ ok: false, status: 500 })
});
check('500 -> HTTP_ERROR with status', r500.code === HL_ERRORS.HTTP_ERROR && r500.status === 500);

const rNet = await fetchHyperliquidInfo('clearinghouseState', USER, {
  fetchImpl: async () => { throw new TypeError('fetch failed'); }
});
check('network failure -> NETWORK', rNet.code === HL_ERRORS.NETWORK);

const rTimeout = await fetchHyperliquidInfo('clearinghouseState', USER, {
  timeoutMs: 10,
  fetchImpl: (_url, init) => new Promise((_res, rej) => {
    init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })
});
check('slow response -> TIMEOUT', rTimeout.code === HL_ERRORS.TIMEOUT);

const rNoFetch = await fetchHyperliquidInfo('allMids', null, { fetchImpl: null });
check('no fetch available -> NETWORK, no throw', rNoFetch.code === HL_ERRORS.NETWORK);

// ── caps ───────────────────────────────────────────────────────────────────
const good = { coin: 'BTC', notionalUsd: 20, leverage: 2 };
const st = { currentExposureUsd: 100, dailyRealisedPnlUsd: 0 };
check('in-cap order passes', checkOrderAgainstCaps(good, st).ok === true);
check('kill switch refuses everything',
  checkOrderAgainstCaps(good, st, { killSwitch: true }).code === HL_CAP_CODES.KILL_SWITCH);
check('coin outside allowlist refused',
  checkOrderAgainstCaps({ ...good, coin: 'DOGE' }, st).code === HL_CAP_CODES.COIN_NOT_ALLOWED);
check('empty allowlist refuses all',
  checkOrderAgainstCaps(good, st, { allowedCoins: [] }).code === HL_CAP_CODES.COIN_NOT_ALLOWED);
check('leverage above cap refused',
  checkOrderAgainstCaps({ ...good, leverage: 5 }, st).code === HL_CAP_CODES.LEVERAGE_TOO_HIGH);
check('single order above per-order cap refused',
  checkOrderAgainstCaps({ ...good, notionalUsd: 20001 }, st).code === HL_CAP_CODES.ORDER_TOO_LARGE);
check('exposure over total refused',
  checkOrderAgainstCaps({ ...good, notionalUsd: 20 }, { currentExposureUsd: 19990, dailyRealisedPnlUsd: 0 }).code
    === HL_CAP_CODES.EXPOSURE_EXCEEDED);
check('daily loss reached refuses new orders',
  checkOrderAgainstCaps(good, { currentExposureUsd: 0, dailyRealisedPnlUsd: -1000 }).code
    === HL_CAP_CODES.DAILY_LOSS_REACHED);
check('small daily loss still allowed',
  checkOrderAgainstCaps(good, { currentExposureUsd: 0, dailyRealisedPnlUsd: -999 }).ok === true);
check('NaN notional refused as BAD_INPUT',
  checkOrderAgainstCaps({ ...good, notionalUsd: NaN }, st).code === HL_CAP_CODES.BAD_INPUT);
check('zero notional refused as BAD_INPUT',
  checkOrderAgainstCaps({ ...good, notionalUsd: 0 }, st).code === HL_CAP_CODES.BAD_INPUT);
check('defaults: per-order not above total',
  HL_CAP_DEFAULTS.maxOrderUsd <= HL_CAP_DEFAULTS.totalExposureUsd);

// fail-closed: unknown inputs must never pass as zero
check('missing daily PnL refused (fail closed)',
  checkOrderAgainstCaps(good, { currentExposureUsd: 0 }).code === HL_CAP_CODES.BAD_INPUT);
check('missing exposure refused (fail closed)',
  checkOrderAgainstCaps(good, { dailyRealisedPnlUsd: 0 }).code === HL_CAP_CODES.BAD_INPUT);
check('null leverage refused, not treated as 1',
  checkOrderAgainstCaps({ ...good, leverage: null }, st).code === HL_CAP_CODES.BAD_INPUT);

console.log(`hyperliquid-readonly-units: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
