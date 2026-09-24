// @vitest-environment jsdom
/**
 * SOLANA LOAN — «does it connect, does it show my positions, and why is the
 * amount box an egg?» (2026-09-24)
 *
 *   1. A WALLET WITH NO KAMINO OBLIGATION IS NOT AN RPC FAILURE. klend-sdk's
 *      `getUserVanillaObligation` throws «Could not find vanilla obligation.»
 *      for any wallet that never deposited; every caller read that as a failed
 *      read, so a brand-new wallet saw «RPC error · retry» and dashes instead of
 *      an empty position, and a borrow on it answered RPC_ERROR instead of
 *      «deposit collateral first». `readVanillaObligation` turns the SDK's
 *      sentence into `null` and lets real transport failures through.
 *   2. AFTER A TRANSACTION THE POSITION IS RE-READ FRESH. The server door caches
 *      snapshots for 20 s; the refresh after a deposit now asks `refresh=1`.
 *   3. A BROWSER SNAPSHOT THAT GOT THE MARKET BUT NOT THE WALLET waits briefly
 *      for the server door, and takes its snapshot when that one read the wallet.
 *   4. THE AMOUNT FIELD OWNS ITS ROW. It shared a flex row with a `.btn`
 *      (globally `width: 100%`), which squeezed it into a tiny pill.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import en from '../src/i18n/locales/en.json';

const root = resolve(__dirname, '..');
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

const t = (key, values = {}) => {
  const text = key.split('.').reduce((node, part) => node?.[part], en) ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '');
};

let walletAddress = '7vXfQmQ9pQZjK2nR5tYwU8sVbNcD4eF6gHjK1mNoPqRs';
const connectSpy = vi.fn(async () => walletAddress);
vi.mock('../src/hooks/useSolanaWallet.js', () => ({
  useSolanaWallet: () => ({
    address: walletAddress,
    isConnected: Boolean(walletAddress),
    walletName: 'Phantom',
    connect: connectSpy,
    disconnect: vi.fn(),
    signAndSendTransaction: vi.fn()
  })
}));

let marketAnswer = null;
const marketCalls = [];
vi.mock('../src/lib/solanaLending.js', async () => {
  const actual = await vi.importActual('../src/lib/solanaLending.js');
  return {
    ...actual,
    readSolanaLendingMarket: (args) => {
      marketCalls.push(args);
      return marketAnswer instanceof Error ? Promise.reject(marketAnswer) : Promise.resolve(marketAnswer);
    }
  };
});

const lending = await vi.importActual('../src/lib/solanaLending.js');
const { default: Panel, normalizeAmountInput } = await import('../src/components/SolanaLendingPanel.jsx');

const USDC = {
  id: 'reserveUsdc', symbol: 'USDC', name: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  decimals: 6, listed: true, status: 'active', supplyApyPct: 4.3, borrowApyPct: 5.1, loanToValuePct: 65
};
const SOL = { ...USDC, id: 'reserveSol', symbol: 'SOL', name: 'SOL', address: 'So11111111111111111111111111111111111111112', decimals: 9 };

const snapshot = (overrides = {}) => ({
  ok: true,
  via: 'browser',
  dataStatus: 'live',
  assets: [USDC, SOL],
  positions: {
    reserveUsdc: { supplied: '0', borrowed: '0', suppliedUsd: 0, borrowedUsd: 0, walletBalance: '25.5' },
    reserveSol: { supplied: '0', borrowed: '0', suppliedUsd: 0, borrowedUsd: 0, walletBalance: '1.2' }
  },
  balances: { reserveUsdc: '25500000', reserveSol: '1200000000' },
  account: { ok: false, unknown: false, balancesUnknown: false, totalCollateralUsd: 0, totalDebtUsd: 0, availableBorrowsUsd: 0 },
  ...overrides
});

const mount = (tab = 'supply') => render(<Panel t={t} tab={tab} setTab={() => {}} preset={null} />);

beforeEach(() => {
  walletAddress = '7vXfQmQ9pQZjK2nR5tYwU8sVbNcD4eF6gHjK1mNoPqRs';
  marketAnswer = snapshot();
  marketCalls.length = 0;
  connectSpy.mockClear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ═══════════════ 1. no obligation yet is an answer, not a failure ═══════════ */

describe('a wallet that never deposited', () => {
  const missing = () => { throw new Error('Could not find vanilla obligation.'); };

  it('reads as «no obligation», not as a failed read', async () => {
    expect(await lending.readVanillaObligation({ getUserVanillaObligation: async () => missing() }, 'owner')).toBeNull();
    const obligation = { deposits: new Map() };
    expect(await lending.readVanillaObligation({ getUserVanillaObligation: async () => obligation }, 'owner')).toBe(obligation);
  });

  it('a real transport failure still throws', async () => {
    await expect(lending.readVanillaObligation({ getUserVanillaObligation: async () => { throw new Error('fetch failed'); } }, 'owner'))
      .rejects.toThrow('fetch failed');
  });

  it('the serialized account is KNOWN (empty), so the panel does not say «RPC error»', async () => {
    const market = { getReserves: () => [], getUserVanillaObligation: async () => missing() };
    const out = await lending.serializeKaminoMarket({ market, wallet: walletAddress, readBalances: async () => ({ x: '1' }) });
    expect(out.account.unknown).toBe(false);
    expect(out.account.ok).toBe(false);
    expect(out.account.availableBorrowsUsd).toBe(0);
  });

  it('a network failure on the obligation is still reported as unknown', async () => {
    const market = { getReserves: () => [], getUserVanillaObligation: async () => { throw new Error('429 Too Many Requests'); } };
    const out = await lending.serializeKaminoMarket({ market, wallet: walletAddress, readBalances: async () => ({ x: '1' }) });
    expect(out.account.unknown).toBe(true);
  });

  it('every obligation read in both doors goes through the helper', () => {
    const client = read('src/lib/solanaLending.js');
    const server = read('server/solanaLending.js');
    const direct = /await [\w.]*getUserVanillaObligation\(/g;
    const clientCalls = client.match(direct) || [];
    expect(clientCalls, 'only the helper itself calls the SDK method').toHaveLength(1);
    expect(server.match(direct) || []).toHaveLength(0);
    expect(server).toContain('readVanillaObligation(holder.market, owner)');
  });
});

/* ═══════════════ 2 + 3. fresh after a transaction; prefer the door that read the wallet ═ */

describe('the market read', () => {
  it('asks the server door to skip its cache when told to', async () => {
    const seen = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ ok: true, snapshot: snapshot({ via: 'server' }) }), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const { readSolanaLendingMarketViaServer } = await import('../src/lib/solanaLendingServer.js');
    await readSolanaLendingMarketViaServer({ wallet: walletAddress, fresh: true });
    await readSolanaLendingMarketViaServer({ wallet: walletAddress });
    expect(seen[0]).toContain('refresh=1');
    expect(seen[1]).not.toContain('refresh=1');
  });

  it('the panel mounts with a normal read (fresh is only for after a transaction)', async () => {
    mount();
    await screen.findByTestId('solana-loan-amount');
    expect(marketCalls[0]).toMatchObject({ wallet: walletAddress, fresh: false });
    const src = read('src/components/SolanaLendingPanel.jsx');
    expect((src.match(/await refresh\(\{ fresh: true \}\)/g) || []).length, 'both success endings re-read fresh').toBe(2);
    expect(src).not.toMatch(/await refresh\(\);/);
  });

  it('knows when a snapshot has the market but not the wallet', () => {
    expect(lending.walletReadIncomplete(snapshot())).toBe(false);
    expect(lending.walletReadIncomplete(snapshot({ account: { unknown: true } }))).toBe(true);
    expect(lending.walletReadIncomplete(snapshot({ account: { unknown: false, balancesUnknown: true } }))).toBe(true);
    expect(lending.walletReadIncomplete({})).toBe(false);
  });
});

/* ═══════════════ 4. the amount field ═══════════ */

describe('the amount field', () => {
  it('owns its row, full width, with the asset beside the number', async () => {
    mount();
    const input = await screen.findByTestId('solana-loan-amount');
    const field = screen.getByTestId('solana-loan-amount-field');
    expect(input.parentElement).toBe(field);
    expect(field.className).toContain('sol-loan-amount-field');
    expect(field.textContent).toContain('USDC');
    /* The action button is NOT a sibling in the same flex row any more. */
    const action = screen.getByTestId('solana-loan-action');
    expect(action.parentElement).not.toBe(field);
    expect(field.contains(action)).toBe(false);
  });

  it('is sized like a real field in the stylesheet', () => {
    const css = read('src/styles/solana-loan.css');
    expect(css).toMatch(/\.sol-loan-amount-field\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.sol-loan-amount-field\s*\{[^}]*min-height:\s*56px/);
    expect(css).toMatch(/\.sol-loan-amount-input\s*\{[^}]*height:\s*54px/);
    expect(css).toMatch(/\.sol-loan-action\s*\{[^}]*width:\s*100%/);
  });

  it('accepts what a Persian keyboard types', async () => {
    expect(normalizeAmountInput('۱۲٫۵')).toBe('12.5');
    expect(normalizeAmountInput('٣,٢٥')).toBe('3.25');
    expect(normalizeAmountInput('1.2.3')).toBe('1.23');
    expect(normalizeAmountInput('abc10')).toBe('10');
    mount();
    const input = await screen.findByTestId('solana-loan-amount');
    fireEvent.change(input, { target: { value: '۲۵' } });
    expect(input.value).toBe('25');
  });

  it('offers to connect in place of the action when no wallet is connected', async () => {
    walletAddress = null;
    mount();
    const connect = await screen.findByTestId('solana-loan-action-connect');
    expect(screen.queryByTestId('solana-loan-action')).toBeNull();
    fireEvent.click(connect);
    expect(connectSpy).toHaveBeenCalledOnce();
  });
});

/* ═══════════════ positions tab ═══════════ */

describe('the positions tab', () => {
  it('lists an open position with its USD value', async () => {
    marketAnswer = snapshot({
      positions: {
        reserveUsdc: { supplied: '100', borrowed: '0', suppliedUsd: 100.02, borrowedUsd: 0, walletBalance: '25.5' },
        reserveSol: { supplied: '0', borrowed: '0.5', suppliedUsd: 0, borrowedUsd: 71.4, walletBalance: '1.2' }
      },
      account: { ok: true, unknown: false, balancesUnknown: false, totalCollateralUsd: 100.02, totalDebtUsd: 71.4, availableBorrowsUsd: 0 }
    });
    const { container } = mount('positions');
    await screen.findByText(en.loan.withdraw);
    expect(container.textContent).toContain('$100.02');
    expect(container.textContent).toContain('$71.4');
    expect(screen.getByText(en.loan.repay)).toBeTruthy();
    expect(screen.queryByTestId('solana-loan-positions-empty')).toBeNull();
  });

  it('says «no position» for a connected wallet with none — never a blank tab', async () => {
    mount('positions');
    expect(await screen.findByTestId('solana-loan-positions-empty')).toBeTruthy();
  });

  it('offers to connect when no wallet is connected', async () => {
    walletAddress = null;
    mount('positions');
    const box = await screen.findByTestId('solana-loan-positions-connect');
    fireEvent.click(box.querySelector('button'));
    expect(connectSpy).toHaveBeenCalledOnce();
  });
});
