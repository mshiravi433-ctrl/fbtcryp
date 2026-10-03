// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * OPEN FUTURES POSITIONS — the surface that did not exist.
 * ===========================================================================
 * Reported across the three futures tabs:
 *
 *   «وقتی کاربر پوزیشن باز می‌کند، هیچ جا نشون نمی‌ده که پوزیشن باز داره،
 *    نفروشه، ببندش، یا خارج بشه.»
 *
 * The Perpetual tab could open a leveraged position and then forgot it. This
 * file mounts the replacement and asserts the things that make it safe rather
 * than merely present:
 *
 *   · it reads EVERY connected wallet family, so a position cannot hide by
 *     virtue of which venue it happens to live on;
 *   · a close is a TWO-STEP action with the percentage stated on the confirm,
 *     because "close" that fires on the first tap is how half a position gets
 *     sold by accident;
 *   · the close goes through the venue's own reduce-only call — never a hand
 *     assembled opposite order that could flip the position;
 *   · a venue that fails to answer says so, and NEVER renders as "no positions"
 *     (that sentence is an assurance, and a wrong one is worse than silence);
 *   · a failed close reports failure and does not claim a fill.
 */

const SOL = 'So1anaWa11etAddre55xxxxxxxxxxxxxxxxxxxxxxx';
const EVM = '0x1111111111111111111111111111111111111111';

const h = vi.hoisted(() => ({
  solAddress: 'So1anaWa11etAddre55xxxxxxxxxxxxxxxxxxxxxxx',
  evmAddress: '0x1111111111111111111111111111111111111111',
  closed: [],
  positions: { ok: true, data: { positions: [] } },
  velocity: { positions: [] },
  closeResult: { signature: '5' + 'x'.repeat(63) },
  closeThrows: false
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key, opts) => (opts && opts.n != null ? `${key}:${opts.n}` : (opts?.pct != null ? `${key}:${opts.pct}` : key)) })
}));

vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));

vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => ({
    address: h.evmAddress,
    isConnected: true,
    ensureSigner: async () => ({ sendTransaction: async () => ({ hash: '0xdead', wait: async () => {} }) }),
    getSigner: () => null
  }),
  shortAddress: (a) => String(a).slice(0, 6)
}));

vi.mock('../src/hooks/useSolanaWallet', () => ({
  useSolanaWallet: () => ({ address: h.solAddress, isConnected: Boolean(h.solAddress), connect: async () => {} })
}));

vi.mock('../src/lib/format', () => ({
  fmtUsd: (n) => `$${Number(n).toFixed(2)}`,
  fmtPrice: (n) => String(Number(n)),
  fmtPct: (n) => `${n}%`
}));

vi.mock('../src/lib/futuresClient', () => ({
  getFuturesPositions: async () => h.positions,
  getFuturesMarkets: async () => ({ ok: true, data: { markets: [{ marketId: 1, symbol: 'BTC-PERP', mid: 65000 }] } }),
  manageFuturesPosition: async () => ({ ok: true, data: { executionId: 'ex-1', transactions: [] } }),
  verifyFutures: async () => ({ ok: true })
}));

vi.mock('../src/lib/velocityTrade.js', () => ({
  getVelocityPositions: async () => h.velocity,
  closeVelocityPosition: async (args) => {
    h.closed.push(args);
    if (h.closeThrows) throw Object.assign(new Error('nope'), { code: 'BROADCAST_FAILED' });
    return h.closeResult;
  }
}));

const { default: FuturesPositionsCard } = await import('../src/components/FuturesPositionsCard.jsx');

const reset = () => {
  h.closed.length = 0;
  h.closeThrows = false;
  h.solAddress = SOL;
  h.evmAddress = EVM;
  h.positions = { ok: true, data: { positions: [] } };
  h.velocity = { positions: [] };
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  reset();
});

describe('open positions', () => {
  it('lists a Solana position with the venue it lives on', async () => {
    // 0.05 BTC at 1e9 base precision; the venue's raw integer is 50 000 000.
    h.velocity = { positions: [{ marketIndex: 1, baseAssetAmount: '50000000', quoteAssetAmount: '-3250000000', openOrders: 0, takeProfit: null, stopLoss: null }] };
    render(<FuturesPositionsCard />);

    const row = await screen.findByTestId('fut-pos-row');
    expect(row.textContent).toContain('BTC-PERP');
    // Size × mid, NOT the raw 1e9 integer printed as dollars (that bug showed
    // a 0.05 BTC position as $65,000,000).
    expect(row.textContent).toContain('$3250.00');
    expect(row.textContent).not.toContain('65000000000');
  });

  it('lists an EVM position from the shared client', async () => {
    h.solAddress = null;
    h.positions = {
      ok: true,
      data: {
        positions: [{
          positionId: 'ostium:1:0', symbol: 'ETH/USD', side: 'long',
          collateralUsd: 100, notionalUsd: 500, entryPrice: 3000, markPrice: 3100,
          takeProfit: null, stopLoss: null, grossPnlUsd: 16.6
        }]
      }
    };
    render(<FuturesPositionsCard />);

    const row = await screen.findByTestId('fut-pos-row');
    expect(row.textContent).toContain('ETH/USD');
    expect(row.textContent).toContain('+$16.60');
  });

  it('says "no position" only after a real read', async () => {
    render(<FuturesPositionsCard />);
    // The empty sentence is an assurance; before the read answers, the card
    // says it is reading instead.
    expect(screen.getByText('perp.positions.reading')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('fut-pos-empty')).toBeTruthy());
  });

  it('a venue that fails is reported as unavailable, never as "no positions"', async () => {
    h.solAddress = null;
    h.positions = { ok: false, error: { code: 'PROVIDER_UNAVAILABLE' } };
    render(<FuturesPositionsCard />);
    await waitFor(() => expect(screen.getByText('perp.positions.unavailable')).toBeTruthy());
    expect(screen.queryByTestId('fut-pos-empty')).toBeNull();
  });

  it('a close is two steps, and the percentage is on the confirm button', async () => {
    h.velocity = { positions: [{ marketIndex: 1, baseAssetAmount: '50000000', quoteAssetAmount: '-3250000000', openOrders: 0, takeProfit: null, stopLoss: null }] };
    render(<FuturesPositionsCard />);

    fireEvent.click(await screen.findByTestId('fut-pos-close'));
    // Nothing has been sent yet — the first tap only opens the question.
    expect(h.closed).toHaveLength(0);
    expect(screen.getByTestId('fut-pos-confirm')).toBeTruthy();
    expect(screen.getByTestId('fut-pos-confirm-close').textContent).toBe('perp.positions.confirm:100');
  });

  it('closes through the venue reduce-only path, with the asked-for percentage', async () => {
    h.velocity = { positions: [{ marketIndex: 7, baseAssetAmount: '50000000', quoteAssetAmount: '-3250000000', openOrders: 0, takeProfit: null, stopLoss: null }] };
    render(<FuturesPositionsCard />);

    fireEvent.click(await screen.findByTestId('fut-pos-close'));
    // 25% — the "take a quarter off" case, which all-or-nothing close cannot do.
    fireEvent.click(screen.getByText('25%'));
    fireEvent.click(screen.getByTestId('fut-pos-confirm-close'));

    await waitFor(() => expect(h.closed).toHaveLength(1));
    expect(h.closed[0]).toMatchObject({ wallet: SOL, marketIndex: 7, closePercent: 25 });
    await waitFor(() => expect(screen.getByTestId('fut-pos-tx')).toBeTruthy());
  });

  it('reports a failed close instead of claiming a fill', async () => {
    h.closeThrows = true;
    h.velocity = { positions: [{ marketIndex: 1, baseAssetAmount: '50000000', quoteAssetAmount: '-3250000000', openOrders: 0, takeProfit: null, stopLoss: null }] };
    render(<FuturesPositionsCard />);

    fireEvent.click(await screen.findByTestId('fut-pos-close'));
    fireEvent.click(screen.getByTestId('fut-pos-confirm-close'));

    const err = await screen.findByTestId('fut-pos-error');
    expect(err.textContent).toBe('perp.positions.err.BROADCAST_FAILED');
    expect(screen.queryByTestId('fut-pos-tx')).toBeNull();
  });
});
