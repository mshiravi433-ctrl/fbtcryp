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
