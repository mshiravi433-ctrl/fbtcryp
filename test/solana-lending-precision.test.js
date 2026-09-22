/**
 * Solana lending — amounts, preflight and wire encoding, WITHOUT a network.
 *
 * What this pins (the «Solana deposit / sign is broken» report, 2026-09-22):
 *
 *   1. toSolanaUnits / fromSolanaUnits round-trip EXACTLY — a Kamino deposit
 *      signs base units; one lamport of rounding turns a repay-the-full-debt
 *      into a dust-leaving partial repay.
 *   2. bytesToBase64 is the encoder now used for built transactions. The old
 *      one was `Buffer.from(...)` — a Node-ism that threw ReferenceError in
 *      the browser before a wallet was ever asked (no Buffer global).
 *   3. preflightSolanaAction decides BEFORE the wallet popup: an amount above
 *      the real spendable balance is refused with a named reason; an
 *      UNREADABLE balance is refused too — the wallet is never asked to sign
 *      a transaction the page cannot check (§7/§9).
 *
 * The Kamino/SDK paths are intentionally not exercised here — they need the
 * vendored SDK and a live RPC and are covered by the panel's error states.
 */
import { describe, it, expect } from 'vitest';
import {
  toSolanaUnits, fromSolanaUnits, bytesToBase64, preflightSolanaAction
} from '../src/lib/solanaLending.js';

const USDC = { id: 'usdc-reserve', symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 };
const WSOL = { id: 'sol-reserve', symbol: 'SOL', address: 'So11111111111111111111111111111111111111112', decimals: 9 };

describe('solana lending — exact unit arithmetic', () => {
  it('toSolanaUnits converts token text to exact base units, rejecting over-precision', () => {
    expect(toSolanaUnits('1', 6)?.toString()).toBe('1000000');
    expect(toSolanaUnits('12.5', 6)?.toString()).toBe('12500000');
    expect(toSolanaUnits('0.000001', 6)?.toString()).toBe('1');
    expect(toSolanaUnits('1.5', 0)).toBe(null); // 0-decimal mints take whole tokens only
    expect(toSolanaUnits('0.0000001', 6)).toBe(null); // below one lamport — refuse, never round
    expect(toSolanaUnits('abc', 6)).toBe(null);
    expect(toSolanaUnits('1,5', 6)?.toString()).toBe('1500000'); // fa/fa-IR locale comma
    expect(toSolanaUnits('-5', 6)).toBe(null);
  });

  it('fromSolanaUnits renders exactly, trimming but never rounding', () => {
    expect(fromSolanaUnits('12500000', 6)).toBe('12.5');
    expect(fromSolanaUnits('1', 6)).toBe('0.000001');
    expect(fromSolanaUnits('200000000', 6)).toBe('200');
    expect(fromSolanaUnits('0', 6)).toBe('0');
  });

  it('round-trips a repay-the-whole-debt amount without losing a lamport', () => {
    const debt = '47800127'; // i.e. a real, non-clean debt of 47.800127 USDC
    expect(toSolanaUnits(fromSolanaUnits(debt, 6), 6)?.toString()).toBe(debt);
  });
});

describe('solana lending — transaction wire encoding needs no Node Buffer', () => {
  it('bytesToBase64 matches the reference encoding (what Buffer.from(x).toString used to do)', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 170, 34, 77]);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64')); // Buffer here is the TEST's, in Node
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });

  it('encodes large serialized transactions without blowing the stack', () => {
    const big = new Uint8Array(1_500_000).map((_, i) => i % 256);
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString('base64'));
  });
});

describe('solana lending — the wallet is blocked BEFORE the popup', () => {
  const snapshot = (over = {}) => ({
    balances: { [USDC.id]: '10000000' /* 10 USDC spendable */ },
    positions: { [USDC.id]: { supplied: '5', borrowed: '3.5' } },
    account: { availableBorrowsUsd: 120 },
    ...over
  });

  it('supply within balance proceeds', () => {
    const r = preflightSolanaAction({ action: 'supply', asset: USDC, amount: '9.999999', snapshot: snapshot() });
    expect(r.ok).toBe(true);
    expect(r.amountWei).toBe('9999999');
  });

  it('supply above the real balance is refused with INSUFFICIENT_BALANCE', () => {
    const r = preflightSolanaAction({ action: 'supply', asset: USDC, amount: '10.000001', snapshot: snapshot() });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('an UNREADABLE balance is refused as BALANCE_UNKNOWN — never treated as zero, never allowed through', () => {
    const r = preflightSolanaAction({ action: 'supply', asset: USDC, amount: '1', snapshot: snapshot({ balances: {} }) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('BALANCE_UNKNOWN');
  });

  it('repay above the outstanding debt refuses EXCEEDS_DEBT; exact debt passes', () => {
    const over = preflightSolanaAction({ action: 'repay', asset: USDC, amount: '3.500001', snapshot: snapshot() });
    expect(over.code).toBe('EXCEEDS_DEBT');
    const exact = preflightSolanaAction({ action: 'repay', asset: USDC, amount: '3.5', snapshot: snapshot() });
    expect(exact.ok).toBe(true);
  });

  it('repay also needs the wallet balance to actually hold the token', () => {
    const poor = preflightSolanaAction({ action: 'repay', asset: USDC, amount: '3.5', snapshot: snapshot({ balances: { [USDC.id]: '1000000' } }) });
    expect(poor.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('withdraw above the supplied position is refused; withdraw-all passes', () => {
    const over = preflightSolanaAction({ action: 'withdraw', asset: USDC, amount: '6', snapshot: snapshot() });
    expect(over.code).toBe('INSUFFICIENT_BALANCE');
    const all = preflightSolanaAction({ action: 'withdraw', asset: USDC, amount: '5', snapshot: snapshot() });
    expect(all.ok).toBe(true);
  });

  it('withdraw/repay with no position refuse with SOLANA_POSITION_REQUIRED', () => {
    const none = snapshot({ positions: {} });
    expect(preflightSolanaAction({ action: 'withdraw', asset: USDC, amount: '1', snapshot: none }).code).toBe('SOLANA_POSITION_REQUIRED');
    expect(preflightSolanaAction({ action: 'repay', asset: USDC, amount: '1', snapshot: none }).code).toBe('SOLANA_POSITION_REQUIRED');
  });

  it('borrow above the quoted USD borrow limit refuses before the popup; within passes', () => {
    const usdcPriced = { ...USDC, priceUsd: 1 };
    const over = preflightSolanaAction({ action: 'borrow', asset: usdcPriced, amount: '121', snapshot: snapshot() });
    expect(over.code).toBe('BORROW_LIMIT_EXCEEDED');
    const okay = preflightSolanaAction({ action: 'borrow', asset: usdcPriced, amount: '100', snapshot: snapshot() });
    expect(okay.ok).toBe(true);
  });

  it('borrow without a readable limit proceeds to the Kamino build, which is the final arbiter', () => {
    const r = preflightSolanaAction({ action: 'borrow', asset: USDC, amount: '50', snapshot: snapshot({ account: null }) });
    expect(r.ok).toBe(true);
  });

  it('SOL reserves use 9 decimals — the native-side arithmetic', () => {
    const snap = { balances: { [WSOL.id]: '2000000000' }, positions: {}, account: { availableBorrowsUsd: 1000 } };
    expect(preflightSolanaAction({ action: 'supply', asset: WSOL, amount: '2', snapshot: snap }).ok).toBe(true);
    expect(preflightSolanaAction({ action: 'supply', asset: WSOL, amount: '2.1', snapshot: snap }).code).toBe('INSUFFICIENT_BALANCE');
  });
});

/*
 * ─── THE KLEND-SDK v5 CALL CONTRACT (2026-09-22) ───────────────────────────
 * «هنوز مشکل وام سولنا حل نشده … KAMINO_SDK_FAILED» had two independent
 * causes, and this suite pins both:
 *
 *   1. The bundled SDK threw `ReferenceError: Buffer is not defined` in every
 *      real browser while Node's check script passed it (Node HAS Buffer).
 *      scripts/vendor-kamino.mjs now prepends a Buffer shim and
 *      scripts/check-kamino-bundle.mjs hides the Node globals — the assertions
 *      below keep the rev in lockstep and the browser harness runnable.
 *   2. Every `KaminoAction.build*Txns` call used an OLDER signature than the
 *      `^5.0.0` dependency this app installs (scopeRefreshConfig received
 *      `true`, useV2Ixs a slot number, includeAtaIxs `false`, and
 *      `getTransactions()` was read as `{ preLendingTxn, … }` although v5
 *      returns ONE Transaction) — so a built action produced an EMPTY list and
 *      the panel reported success without ever opening the wallet. The stub
 *      calls below assert the exact argument list, and the `.d.ts` read
 *      asserts the SDK still declares the parameters in that order.
 */
import { readFileSync } from 'node:fs';
import {
  KAMINO_ACTION_CALL, buildKaminoActionTransactions,
  collectKaminoTransactions, isVersionedTransaction
} from '../src/lib/solanaLending.js';

class FakeBN { constructor(v) { this.v = String(v); } toString() { return this.v; } }

const market = { id: 'market' };
const mint = { id: 'mint' };
const owner = { id: 'owner' };
const obligation = { id: 'obligation' };

const stubSdk = (calls) => ({
  KaminoAction: {
    buildDepositTxns: async (...args) => { calls.push(['deposit', args]); return 'deposit-action'; },
    buildBorrowTxns: async (...args) => { calls.push(['borrow', args]); return 'borrow-action'; },
    buildWithdrawTxns: async (...args) => { calls.push(['withdraw', args]); return 'withdraw-action'; },
    buildRepayTxns: async (...args) => { calls.push(['repay', args]); return 'repay-action'; }
  }
});

const run = (action, slot) => {
  const calls = [];
  return buildKaminoActionTransactions({
    sdk: stubSdk(calls), action, market, mint, owner, obligationOrPda: obligation,
    amountWei: 1500000n, slot, BN: FakeBN
  }).then((result) => ({ result, args: calls[0]?.[1] }));
};

describe('solana lending — the klend-sdk v5 build call', () => {
  it('passes v5 positional arguments in the v5 order (useV2Ixs, scope config, budget, ATA)', async () => {
    for (const action of ['supply', 'borrow', 'withdraw']) {
      const { result, args } = await run(action);
      expect(result.ok).toBe(true);
      expect(args[0]).toBe(market);
      expect(args[1].toString()).toBe('1500000');
      expect(args[2]).toBe(mint);
      expect(args[3]).toBe(owner);
      expect(args[4]).toBe(obligation);
      /* The exact bug: a number/slot/`true` in the boolean and object slots. */
      expect(args[5]).toBe(false);                       // useV2Ixs
      expect(args[6]).toBeUndefined();                   // scopeRefreshConfig
      expect(args[7]).toBe(1_000_000);                   // extraComputeBudget
      expect(args[8]).toBe(true);                        // includeAtaIxs (wSOL ATAs!)
      expect(args.length).toBe(9);
    }
  });

  it('repay passes the CURRENT SLOT as v5 argument 8 and leaves payer/referrer to defaults', async () => {
    const { result, args } = await run('repay', 289_345_678);
    expect(result.ok).toBe(true);
    expect(args[5]).toBe(false);
    expect(args[6]).toBeUndefined();
    expect(args[7]).toBe(289_345_678);                   // currentSlot, NOT payer
    expect(args[8]).toBeUndefined();                     // payer: default (owner)
    expect(args[9]).toBe(1_000_000);
    expect(args[10]).toBe(true);
  });

  it('an unknown action and a throwing builder are named, never silent', async () => {
    expect((await run('liquidate')).result.code).toBe('UNKNOWN_ACTION');
    const boom = { KaminoAction: { buildDepositTxns: async () => { throw new Error('insufficient collateral'); } } };
    const failed = await buildKaminoActionTransactions({ sdk: boom, action: 'supply', market, mint, owner, obligationOrPda: obligation, amountWei: 1n, BN: FakeBN });
    expect(failed.ok).toBe(false);
    expect(failed.code).toBe('KAMINO_TX_BUILD_FAILED');
    expect(failed.detail).toContain('collateral');
  });

  it('the constant object and the installed klend-sdk typings agree on the v5 parameter order', async () => {
    const dts = readFileSync(new URL('../node_modules/@kamino-finance/klend-sdk/dist/classes/action.d.ts', import.meta.url), 'utf8');
    const signature = (name) => {
      const at = dts.indexOf(`static ${name}(`);
      expect(at, `${name} not found in the installed klend-sdk`).toBeGreaterThan(-1);
      return dts.slice(at, dts.indexOf('): Promise<KaminoAction>', at));
    };
    for (const name of ['buildDepositTxns', 'buildBorrowTxns', 'buildWithdrawTxns']) {
      const params = signature(name).replace(/\/\*[\s\S]*?\*\//g, ' ');
      const order = ['kaminoMarket', 'amount', 'mint', 'owner', 'obligation', 'useV2Ixs', 'scopeRefreshConfig', 'extraComputeBudget', 'includeAtaIxs'];
      let cursor = -1;
      for (const param of order) {
        const at = params.indexOf(param, cursor + 1);
        expect(at, `${name}: ${param} out of order — the SDK signature changed, update KAMINO_ACTION_CALL and the call sites`).toBeGreaterThan(cursor);
        cursor = at;
      }
    }
    const repay = signature('buildRepayTxns').replace(/\/\*[\s\S]*?\*\//g, ' ');
    expect(repay.indexOf('currentSlot', repay.indexOf('scopeRefreshConfig'))).toBeGreaterThan(-1);
    expect(KAMINO_ACTION_CALL.includeAtaIxs).toBe(true);
    expect(KAMINO_ACTION_CALL.scopeRefreshConfig).toBeUndefined();
  });
});

describe('solana lending — reading what the SDK actually returned', () => {
  /* v5: ONE legacy Transaction. The old code read `.preLendingTxn` off it,
     got undefined three times, filtered the list to empty and reported ok. */
  const legacyTx = { serialize: () => new Uint8Array([1, 2, 3]) };
  const versionedTx = { serialize: () => new Uint8Array([4, 5, 6]), version: 0, message: { version: 0 } };

  it('v5`s single Transaction becomes exactly one entry (never an empty list)', async () => {
    const entries = await collectKaminoTransactions({ getTransactions: async () => legacyTx }, 'supply');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ id: 'supply', tx: legacyTx });
  });

  it('the older { preLendingTxn, lendingTxn, postLendingTxn } shape still works', async () => {
    const entries = await collectKaminoTransactions({
      getTransactions: async () => ({ preLendingTxn: legacyTx, lendingTxn: versionedTx, postLendingTxn: legacyTx })
    }, 'borrow');
    expect(entries.map((e) => e.id)).toEqual(['preparing', 'borrow', 'cleanup']);
  });

  it('an array and an unknown shape are handled without inventing a transaction', async () => {
    expect((await collectKaminoTransactions({ getTransactions: async () => [legacyTx, versionedTx] }, 'repay')).map((e) => e.id))
      .toEqual(['repay', 'repay-2']);
    expect(await collectKaminoTransactions({ getTransactions: async () => null }, 'repay')).toEqual([]);
  });

  it('legacy vs versioned is read off the transaction, not assumed', () => {
    expect(isVersionedTransaction(legacyTx)).toBe(false);
    expect(isVersionedTransaction(versionedTx)).toBe(true);
    /* web3.js LegacyMessage carries no `version`; a VersionedMessage does. */
    expect(isVersionedTransaction({ serialize: () => new Uint8Array(), message: { versioned: true } })).toBe(false);
    expect(isVersionedTransaction(null)).toBe(false);
  });
});

describe('solana lending — the vendor bundle the app loads at runtime', () => {
  const vendorScript = readFileSync(new URL('../scripts/vendor-kamino.mjs', import.meta.url), 'utf8');
  const clientSource = readFileSync(new URL('../src/lib/solanaLending.js', import.meta.url), 'utf8');

  it('the cache-buster rev in the client matches the rev the vendor script emits', () => {
    const scriptRev = /const VENDOR_REV = '(\d+)'/.exec(vendorScript)?.[1];
    const clientRev = /const KAMINO_VENDOR_REV = '(\d+)'/.exec(clientSource)?.[1];
    expect(scriptRev).toBeTruthy();
    expect(clientRev).toBe(scriptRev);
  });

  it('the vendor script installs a browser Buffer and the check hides Node`s', () => {
    expect(vendorScript).toContain('bufferShimBanner');
    expect(vendorScript).toMatch(/globalThis\.Buffer = Buffer/);
    const check = readFileSync(new URL('../scripts/check-kamino-bundle.mjs', import.meta.url), 'utf8');
    expect(check).toMatch(/Object\.defineProperty\(globalThis, 'Buffer'/);
  });

  it('the panel signs with the transaction`s own version instead of a hardcoded one', () => {
    const panel = readFileSync(new URL('../src/components/SolanaLendingPanel.jsx', import.meta.url), 'utf8');
    expect(panel).toMatch(/versioned: tx\.versioned !== false/);
    expect(panel).not.toMatch(/versioned: true/);
  });
});

/*
 * ─── WHAT THE PANEL SAYS WHEN THE SDK CANNOT LOAD ──────────────────────────
 * Before this, every one of these collapsed into KAMINO_SDK_FAILED («ماژول
 * Kamino اجرا نشد. اپ را بهروزرسانی کن») — advice that is wrong for a cut-off
 * download (retry), wrong for a captive portal (get a connection) and right
 * only for the one case it named. The classifier is pure, so each branch is
 * pinned to the code whose fix matches it.
 */
import { classifyKaminoFailure } from '../src/lib/solanaLending.js';

const evidenceFor = (over = {}) => ({
  ok: true, status: 200, contentType: 'application/javascript; charset=utf-8',
  text: 'export const KaminoMarket = 1;', bytes: 5_835_944, url: '/vendor/kamino-klend-sdk.js?v=3', ...over
});
const MANIFEST = { file: 'kamino-klend-sdk.js', rev: '3', bytes: 5_835_944, sha256: 'x' };

describe('solana lending — naming the SDK load failure', () => {
  it('an HTML body (SPA fallback / captive portal) is MISSING, not FAILED', () => {
    const verdict = classifyKaminoFailure({
      evidence: evidenceFor({ text: '<!doctype html><html><body><div id="root"></div></body></html>', contentType: 'text/html; charset=utf-8', bytes: 2412 })
    });
    expect(verdict.code).toBe('KAMINO_SDK_MISSING');
    expect(verdict.detail).toContain('HTML page');
  });

  it('a 404 is MISSING, and says the status out loud', () => {
    const verdict = classifyKaminoFailure({ evidence: { ok: false, status: 404, contentType: 'text/plain', url: '/vendor/kamino-klend-sdk.js?v=3' } });
    expect(verdict.code).toBe('KAMINO_SDK_MISSING');
    expect(verdict.detail).toContain('404');
  });

  it('fewer bytes than the manifest published is TRUNCATED — a retryable transfer, not a broken app', () => {
    const verdict = classifyKaminoFailure({ evidence: evidenceFor({ bytes: 1_200_000 }), manifest: MANIFEST });
    expect(verdict.code).toBe('KAMINO_SDK_TRUNCATED');
    expect(verdict.detail).toContain('1200000 of 5835944');
  });

  it('the real module throwing on init is INIT_FAILED, with the engine`s own message', () => {
    const verdict = classifyKaminoFailure({
      evidence: evidenceFor({ bytes: MANIFEST.bytes }), manifest: MANIFEST,
      initCause: new Error('Buffer is not defined'),
      lastCause: new Error('Failed to fetch dynamically imported module')
    });
    expect(verdict.code).toBe('KAMINO_SDK_INIT_FAILED');
    expect(verdict.detail).toBe('Buffer is not defined');
  });

  it('transport noise is never dressed up as an init failure', () => {
    const verdict = classifyKaminoFailure({
      evidence: evidenceFor({ bytes: MANIFEST.bytes }), manifest: MANIFEST,
      initCause: new Error('Failed to fetch dynamically imported module: https://fbtswap.ir/vendor/kamino-klend-sdk.js?v=3'),
      lastCause: new Error('Failed to fetch dynamically imported module')
    });
    expect(verdict.code).toBe('KAMINO_SDK_FAILED');
  });

  it('a stale deploy (server rev ≠ app rev) is named as such', () => {
    const verdict = classifyKaminoFailure({ evidence: evidenceFor({ bytes: MANIFEST.bytes }), manifest: { ...MANIFEST, rev: '2' } });
    expect(verdict.code).toBe('KAMINO_SDK_MISSING');
    expect(verdict.detail).toContain('rev 2');
    expect(verdict.detail).toContain('expects rev 3');
  });

  it('nothing reachable at all is UNAVAILABLE (offline), never a module bug', () => {
    expect(classifyKaminoFailure({ evidence: { ok: false, status: 0, error: 'Failed to fetch', url: '/vendor/x.js' } }).code)
      .toBe('KAMINO_SDK_UNAVAILABLE');
    expect(classifyKaminoFailure({ evidence: null }).code).toBe('KAMINO_SDK_UNAVAILABLE');
  });

  it('every code the classifier can return has a translation in every locale', async () => {
    const { readdirSync } = await import('node:fs');
    const codes = [
      'KAMINO_SDK_MISSING', 'KAMINO_SDK_FAILED', 'KAMINO_SDK_TRUNCATED',
      'KAMINO_SDK_INIT_FAILED', 'KAMINO_SDK_UNAVAILABLE', 'KAMINO_TX_BUILD_EMPTY',
      'KAMINO_MARKET_UNAVAILABLE'
    ];
    const dir = new URL('../src/i18n/locales/', import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const data = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
      for (const code of codes) {
        expect(data?.loan?.error?.[code], `${file} is missing loan.error.${code}`).toBeTruthy();
      }
    }
  });
});
