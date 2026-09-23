#!/usr/bin/env node
/**
 * BRIDGE + NOTIFICATION VALIDATION PROBE
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS EXISTS TO CATCH ─────────────────────────────────────────────
 * Two reported bugs, one shape: the app said something untrue with total
 * confidence.
 *
 *   1. «بیت کویین ۴۰ درصد رشد کرد که در واقعیت ۴ دهم رشد کرده» — the price
 *      alert compared a LIVE price against a baseline recorded from the
 *      deterministic OFFLINE snapshot (BTC seed 67,450) and manufactured a
 *      confident, wrong notification. Guards under test: an offline row never
 *      baselines and never alerts; a provenance flip (or a legacy baseline
 *      with no recorded source) re-arms silently; a stale baseline re-arms
 *      silently; a >SHORT_WINDOW_MAX_PCT move inside SHORT_WINDOW_MS re-arms
 *      silently; a genuine qualifying move still alerts; the cooldown and the
 *      fixture (no-provenance) behaviour are unchanged.
 *
 *   2. «گاهی استرینگ هست» / «نبود موجودی وقتی کیف مول وصله» — bridge tabs
 *      rendered machine codes (INSUFFICIENT_BALANCE) and raw wallet prose via
 *      `defaultValue`, and collapsed unknown quote codes into the misleading
 *      «no route found». The contract under test for every code the stack can
 *      throw, in en/fa/ar: known code → translated sentence, never the code;
 *      unmapped code → generic sentence that KEEPS the code for support;
 *      prose → fallback sentence + the prose kept as evidence, not headline;
 *      crossChain-only codes resolve through the shared vocabulary; and every
 *      bridge.err key exists with a {{placeholder}} set identical to English.
 *
 * bridgeErrors.js is imported directly (it has no imports). priceAlerts.js
 * imports './notify' extensionless, which plain Node cannot resolve — so it is
 * bundled with esbuild (a real dependency of the build) into a temp file and
 * the REAL module runs from there. The logic under test is the shipped one.
 */
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { bridgeErrorText, bridgeErrorFromException } from '../src/lib/bridgeErrors.js';

const rows = [];
const row = (name, ok) => rows.push([name, ok]);

/* ─── real locale dictionaries ─────────────────────────────────────────── */
const readJson = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const en = readJson('src/i18n/locales/en.json');
const fa = readJson('src/i18n/locales/fa.json');
const ar = readJson('src/i18n/locales/ar.json');

const makeT = (dict) => (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], dict) ?? values.defaultValue ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
const tEn = makeT(en);
const tFa = makeT(fa);
const tAr = makeT(ar);

/* ─── every code the bridge stack can throw ────────────────────────────── */
const BRIDGE_THROWN = [
  'NO_ROUTE', 'NO_SIGNER', 'NO_RECIPIENT', 'TX_FAILED', 'WRONG_NETWORK',
  'CHAIN_SWITCH_REJECTED', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_GAS',
  'USER_REJECTED', 'ROUTE_NOT_EXECUTABLE', 'BROADCAST_FAILED', 'QUOTE_EXPIRED',
  'PROVIDER_UNAVAILABLE', 'PROVIDER_BAD_RESPONSE', 'PROVIDER_RATE_LIMITED',
  'UPSTREAM_FAILED', 'UPSTREAM_TIMEOUT', 'NETWORK_FAILED', 'TIMEOUT',
  'AMOUNT_TOO_LOW', 'WALLET_REQUIRED', 'WALLET_NOT_CONNECTED', 'BAD_CHAIN',
  'BAD_TOKEN', 'BAD_ORIGIN_ADDRESS', 'DESTINATION_ADDRESS_REQUIRED',
  'CROSSCHAIN_NOT_CONFIGURED', 'QUOTE_FAILED', 'SAME_CHAIN',
  'UNSUPPORTED_CHAIN', 'BAD_AMOUNT', 'BAD_ADDRESS'
];

/* ─── 1. l10n coverage: every thrown code has a key in en/fa/ar ────────── */
{
  const missing = [];
  for (const code of BRIDGE_THROWN) {
    for (const [lang, dict] of [['en', en], ['fa', fa], ['ar', ar]]) {
      if (!dict?.bridge?.err?.[code]) missing.push(`${lang}:${code}`);
    }
  }
  row(`all ${BRIDGE_THROWN.length} thrown bridge codes have en/fa/ar keys`, missing.length === 0);
  if (missing.length) console.log('   missing:', missing.join(', '));

  /* placeholder parity with English (GENERIC carries {{code}}) */
  const ph = (s) => new Set(String(s).match(/\{\{(\w+)\}\}/g) ?? []);
  const phMismatch = [];
  for (const code of Object.keys(en.bridge.err)) {
    for (const [lang, dict] of [['fa', fa], ['ar', ar]]) {
      const mine = dict?.bridge?.err?.[code];
      if (mine != null && String(ph(mine)) !== String(ph(en.bridge.err[code]))) {
        phMismatch.push(`${lang}:${code}`);
      }
    }
  }
  row('bridge.err placeholder sets match English in fa/ar', phMismatch.length === 0);
  if (phMismatch.length) console.log('   mismatch:', phMismatch.join(', '));
}

/* ─── 2. bridgeErrorText contract ──────────────────────────────────────── */
{
  let leak = [];
  for (const code of BRIDGE_THROWN) {
    for (const [lang, t] of [['en', tEn], ['fa', tFa], ['ar', tAr]]) {
      const { text } = bridgeErrorText(code, t);
      if (!text || text.includes(code) || text.includes(`bridge.err.`)) leak.push(`${lang}:${code}`);
    }
  }
  row('known codes render translated sentences, never the code itself', leak.length === 0);
  if (leak.length) console.log('   leaked:', leak.join(', '));

  /* fa must be actual Persian for the reported balance case */
  const faBal = bridgeErrorText('INSUFFICIENT_BALANCE', tFa).text;
  row('fa INSUFFICIENT_BALANCE is a Persian sentence (the reported «نبود موجودی» case)',
    /[\u0600-\u06FF]/.test(faBal) && !faBal.includes('INSUFFICIENT_BALANCE'));

  /* unmapped code → generic keeps the code for support, still a sentence */
  const unm = bridgeErrorText('SOME_FUTURE_CODE', tFa);
  row('unmapped code → generic sentence that keeps the code for support',
    unm.text.includes('SOME_FUTURE_CODE') && /[\u0600-\u06FF]/.test(unm.text) && unm.detail === null);

  /* upstream prose → fallback headline, prose kept as evidence */
  const prose = bridgeErrorText('0x: validation failed: slippage tolerance exceeded', tEn, { fallbackKey: 'bridge.err.QUOTE_FAILED' });
  row('prose → fallback headline + prose kept as evidence (≤220 chars)',
    prose.text === en.bridge.err.QUOTE_FAILED
    && prose.detail === '0x: validation failed: slippage tolerance exceeded');
  const long = bridgeErrorText('x'.repeat(500), tEn).detail;
  row('prose evidence is capped at 220 chars', long.length === 220);

  /* crossChain-only codes resolve through the shared vocabulary */
  const cc = bridgeErrorText('PROVIDER_BAD_RESPONSE', tEn);
  row('crossChain.err keys resolve dynamically (PROVIDER_BAD_RESPONSE — the leaked one)',
    cc.text === en.crossChain.err.PROVIDER_BAD_RESPONSE);
  const hist = bridgeErrorText('HISTORY_WRITE_FAILED', tEn);
  row('desk/ledger codes resolve (HISTORY_WRITE_FAILED)', hist.text === en.crossChain.err.HISTORY_WRITE_FAILED);

  /* exception shape: wallet code-in-message and wallet prose */
  const asCode = bridgeErrorFromException(new Error('NO_SIGNER'), tFa);
  row('exception with code-as-message localises (NO_SIGNER)', asCode.text === fa.bridge.err.NO_SIGNER);
  const asProse = bridgeErrorFromException({ shortMessage: 'user rejected transaction' }, tFa);
  row('wallet prose → sentence headline + prose evidence',
    asProse.text === fa.bridge.err.TX_FAILED && asProse.detail === 'user rejected transaction');
  const codeObj = bridgeErrorFromException({ code: 'USER_REJECTED' }, tFa);
  row('exception with .code localises (USER_REJECTED — the wallet-reject case)',
    codeObj.text === fa.bridge.err.USER_REJECTED);
}

/* ─── 3. price alert guards (real module, bundled for Node) ────────────── */
{
  const dir = mkdtempSync(join(tmpdir(), 'fbt-pa-'));
  const outfile = join(dir, 'priceAlerts.bundle.mjs');
  await build({
    entryPoints: [new URL('../src/lib/priceAlerts.js', import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    logLevel: 'silent'
  });
  const { evaluatePriceAlerts, evaluateTopMovers } = await import(`file://${outfile}`);
  rmSync(dir, { recursive: true, force: true });

  const now = 1_700_000_000_000;
  const LIVE = (price) => ({ id: 'bitcoin', symbol: 'btc', price, dataProvenance: 'live' });
  const OFF = (price) => ({ id: 'bitcoin', symbol: 'btc', price, dataProvenance: 'offline', offline: true });

  /* ── top movers: «۳ ارز اول که بیش از ۵٪ افت یا سود کرد» ───────────── */
  const M = (id, rank, change24h, extra = {}) => ({ id, symbol: id.slice(0, 3), name: id, rank, price: 10, change24h, dataProvenance: 'live', ...extra });
  const market = [
    M('bitcoin', 1, 1.2), M('ethereum', 2, -6.4), M('tether', 3, 0.01), M('solana', 4, 9.9),
    M('xrp', 5, 5.0), M('dogecoin', 6, 12), M('cardano', 7, -7, { dataProvenance: 'offline', offline: true }), M('tron', 8, -8)
  ];
  const tm1 = evaluateTopMovers({ coins: market, store: {}, now });
  row('top movers: first three BY RANK beyond ±5% (exactly 5.0 qualifies), offline rows skipped',
    tm1.alerts.map((a) => a.id).join(',') === 'ethereum,solana,xrp'
    && tm1.movers.length === 3 && !tm1.movers.some((m) => m.id === 'cardano'));
  const tm2 = evaluateTopMovers({ coins: market, store: tm1.store, now: now + 60_000 });
  row('top movers: the same move is not re-announced on the next poll', tm2.alerts.length === 0);
  const grown = market.map((c) => (c.id === 'solana' ? { ...c, change24h: 15.2 } : c));
  const tm3 = evaluateTopMovers({ coins: grown, store: tm1.store, now: now + 120_000 });
  row('top movers: a move that grew by ≥5 points is re-announced early',
    tm3.alerts.length === 1 && tm3.alerts[0].id === 'solana' && tm3.alerts[0].changePct === 15.2);
  const flipped = market.map((c) => (c.id === 'ethereum' ? { ...c, change24h: 6.1 } : c));
  const tm4 = evaluateTopMovers({ coins: flipped, store: tm1.store, now: now + 180_000 });
  row('top movers: a flipped sign is re-announced early', tm4.alerts.length === 1 && tm4.alerts[0].id === 'ethereum');
  const tm5 = evaluateTopMovers({ coins: market, store: tm1.store, now: now + 13 * 3600_000 });
  row('top movers: after the cooldown the same movers may be announced again', tm5.alerts.length === 3);
  row('top movers: an all-offline market announces nothing',
    evaluateTopMovers({ coins: market.map((c) => ({ ...c, dataProvenance: 'offline' })), store: {}, now }).alerts.length === 0);

  /* offline rows never record a baseline, never alert */
  const offOnly = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [OFF(67450)], store: {}, now });
  row('offline row records no baseline and alerts nothing',
    Object.keys(offOnly.store).length === 0 && offOnly.alerts.length === 0);

  /* live → offline → live: the offline sighting is skipped, not compared */
  const armed = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [LIVE(67500)], store: {}, now });
  evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [OFF(67450)], store: armed.store, now: now + 30_000 });
  const afterOff = evaluatePriceAlerts({ favorites: ['bitcoin'], coins: [LIVE(95_000)], store: armed.store, now: now + 60_000 });
  row('offline sighting between live polls is never compared (the reported «۴۰٪» shape is impossible)',
    armed.store.bitcoin.base === 67500 && afterOff.alerts.length === 0 && afterOff.store.bitcoin.base === 95_000);

  /* legacy baseline (no src) re-arms once instead of being trusted */
  const legacy = evaluatePriceAlerts({
    favorites: ['bitcoin'], coins: [LIVE(95_000)],
    store: { bitcoin: { base: 67450, at: now - 1000 } }, now
  });
  row('legacy {base,at} baseline re-arms silently once',
    legacy.alerts.length === 0 && legacy.store.bitcoin.base === 95_000 && legacy.store.bitcoin.src === 'live');

  /* stale baseline re-arms */
  const stale = evaluatePriceAlerts({
    favorites: ['bitcoin'], coins: [LIVE(80_000)],
    store: { bitcoin: { base: 60_000, src: 'live', seen: now - 8 * 86400000 } }, now
  });
  row('baseline older than STALE_BASELINE_MS re-arms silently',
    stale.alerts.length === 0 && stale.store.bitcoin.base === 80_000);

  /* the reported jump: +40% inside 30s is swallowed and re-armed */
  const jump = evaluatePriceAlerts({
    favorites: ['bitcoin'], coins: [LIVE(94_600)],
    store: { bitcoin: { base: 67_450, src: 'live', seen: now - 30_000 } }, now
  });
  row('the reported +40%-in-30s jump re-arms silently (short-window ceiling)',
    jump.alerts.length === 0 && jump.store.bitcoin.base === 94_600);

  /* genuine qualifying move still alerts — the feature is not lobotomised */
  const real = evaluatePriceAlerts({
    favorites: ['bitcoin'], coins: [LIVE(10_600)],
    store: { bitcoin: { base: 10_000, src: 'live', seen: now - 2 * 3600_000 } }, now
  });
  row('genuine +6% over 2h still alerts',
    real.alerts.length === 1 && Math.round(real.alerts[0].changePct) === 6);

  const slow = evaluatePriceAlerts({
    favorites: ['bitcoin'], coins: [LIVE(15_000)],
    store: { bitcoin: { base: 10_000, src: 'live', seen: now - 12 * 3600_000 } }, now
  });
  row('large but SLOW (+50% over 12h) still alerts — the ceiling is short-window only',
    slow.alerts.length === 1);

  /* cooldown unchanged */
  const cooled = evaluatePriceAlerts({
    favorites: ['bitcoin'], coins: [LIVE(10_600)],
    store: { bitcoin: { base: 10_000, src: 'live', seen: now - 3600_000, at: now - 1800_000 } }, now
  });
  row('cooldown after a real alert still applies', cooled.alerts.length === 0);

  /* fixture rows without provenance markers keep working */
  const first = evaluatePriceAlerts({ favorites: ['a'], coins: [{ id: 'a', symbol: 'A', price: 100 }], store: {}, now });
  const second = evaluatePriceAlerts({ favorites: ['a'], coins: [{ id: 'a', symbol: 'A', price: 106 }], store: first.store, now: now + 3600_000 });
  row('rows with no provenance markers (fixtures) still baseline and alert',
    second.alerts.length === 1);
}

export default rows;
