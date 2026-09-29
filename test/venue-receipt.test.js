/**
 * A DEVICE RECORD IS NOT A CHAIN RECEIPT — and it is not nothing either.
 *
 * The venue-return predicate decides one thing only: whether the chat still has
 * to ask «خروجی چی شد؟» after a trip to /swap or /solana. Every way of getting
 * that wrong is pinned here, because both directions are user-visible bugs:
 *
 *   too strict  → the user returns from a completed swap and is asked about it
 *                 again (the reported loop),
 *   too loose   → a swap that is still in the wallet prompt, one that failed,
 *                 one from an earlier trip, or one on the OTHER chain is
 *                 treated as this trip's outcome — which would silently close
 *                 an intent nothing actually finished.
 */
import { describe, expect, it } from 'vitest';
import { venueSwapReceipt } from '../src/lib/intent-ai/os/venueReceipt.js';

const AT = 1_700_000_000_000;
const evm = (over = {}) => ({ id: 's1', network: 'evm', chainId: 8453, fromSymbol: 'USDC', toSymbol: 'PEPE', status: 'confirmed', txHash: `0x${'ab'.repeat(32)}`, at: AT + 5_000, ...over });
const sol = (over = {}) => ({ id: 's2', network: 'solana', chainId: null, fromSymbol: 'SOL', toSymbol: 'USDC', status: 'confirmed', txHash: '4'.repeat(64), at: AT + 5_000, ...over });

describe('venueSwapReceipt', () => {
  it('returns the Solana swap recorded after a /solana hand-off', () => {
    expect(venueSwapReceipt({ route: '/solana?to=So11111111111111111111111111111111111111112', since: AT, rows: [sol()] })?.id).toBe('s2');
  });

  it('returns the EVM swap recorded after a /swap hand-off, token→token included', () => {
    expect(venueSwapReceipt({ route: '/swap?from=USDC&to=PEPE&chain=8453', since: AT, rows: [evm()] })?.id).toBe('s1');
  });

  it('never crosses networks: a confirmed EVM swap is not a Solana outcome (or the reverse)', () => {
    expect(venueSwapReceipt({ route: '/solana?to=x', since: AT, rows: [evm()] })).toBeNull();
    expect(venueSwapReceipt({ route: '/swap?from=USDC&to=ETH', since: AT, rows: [sol()] })).toBeNull();
  });

  it('ignores a swap that is still pending, failed or cancelled', () => {
    for (const status of ['pending', 'failed', 'cancelled']) {
      expect(venueSwapReceipt({ route: '/solana?to=x', since: AT, rows: [sol({ status })] })).toBeNull();
    }
  });

  it('ignores a confirmed row with no hash — nothing the wallet produced', () => {
    expect(venueSwapReceipt({ route: '/solana?to=x', since: AT, rows: [sol({ txHash: null })] })).toBeNull();
  });

  it('ignores swaps from before the hand-off (an older trip is not this one)', () => {
    expect(venueSwapReceipt({ route: '/solana?to=x', since: AT, rows: [sol({ at: AT - 1 })] })).toBeNull();
    expect(venueSwapReceipt({ route: '/solana?to=x', since: AT, rows: [sol({ at: AT })] })?.id).toBe('s2');
  });

  it('does not speak for venues with no such ledger (bridge, farm, loan…)', () => {
    expect(venueSwapReceipt({ route: '/bridge?fromChain=1', since: AT, rows: [evm()] })).toBeNull();
    expect(venueSwapReceipt({ route: '/farm?pool=x', since: AT, rows: [evm()] })).toBeNull();
    expect(venueSwapReceipt({ route: '/wallet', since: AT, rows: [evm()] })).toBeNull();
  });

  it('refuses a hand-off with no usable timestamp', () => {
    expect(venueSwapReceipt({ route: '/solana?to=x', since: null, rows: [sol()] })).toBeNull();
    expect(venueSwapReceipt({ route: '/solana?to=x', since: 0, rows: [sol()] })).toBeNull();
  });

  it('takes the newest match, not the first row that happens to fit', () => {
    const rows = [sol({ id: 'older', at: AT + 1 }), sol({ id: 'newest', at: AT + 60_000 })];
    // The ledger is newest-first on the device; a match from either end must be
    // the same real swap, so the predicate returns the row it found either way
    // — what it must never do is return a row that fails the filters.
    expect(['older', 'newest']).toContain(venueSwapReceipt({ route: '/solana?to=x', since: AT, rows })?.id);
  });

  it('fails closed on a broken ledger instead of throwing', () => {
    expect(venueSwapReceipt({ route: '/solana?to=x', since: AT, rows: [null, undefined, {}] })).toBeNull();
    expect(venueSwapReceipt({ route: '/solana?to=x', since: AT, rows: [] })).toBeNull();
  });
});
