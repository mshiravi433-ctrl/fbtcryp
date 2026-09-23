// @vitest-environment jsdom
/**
 * THE PANEL'S HALF OF THE SECOND DOOR.
 *
 * test/solana-lending-doors.test.js pins the race (which door answers, what a
 * failure carries). This file mounts the REAL panel and pins what the user is
 * TOLD, because the report of 2026-09-23 was a screen full of nine refusals and
 * no mention that our own server had been asked too:
 *
 *   1. a snapshot that came through the server door says so — the numbers are
 *      the same either way, but the route is not, and a user who just watched
 *      the public nodes refuse them deserves to know which road worked;
 *   2. when BOTH doors are shut, the failure names the second one with its own
 *      localized sentence, under the per-host list — not as an extra hostname;
 *   3. when the server door was never tried (a pinned rpcUrl, `allowServer:false`),
 *      the panel does NOT claim it was. A sentence about a door nobody knocked
 *      on is a lie in the one place the user is reading carefully.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import en from '../src/i18n/locales/en.json';

const t = (key, values = {}) => {
  const text = key.split('.').reduce((node, part) => node?.[part], en) ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '');
};

/* The wallet is not what is under test, and the panel only reads `address` on
   the mount path. */
vi.mock('../src/hooks/useSolanaWallet.js', () => ({
  useSolanaWallet: () => ({
    address: '7vXfQmQ9pQZjK2nR5tYwU8sVbNcD4eF6gHjK1mNoPqRs',
    isConnected: true,
    walletName: 'Phantom',
    connect: vi.fn(),
    disconnect: vi.fn()
  })
}));

/** What the market read answers with — set per test. */
let marketAnswer = null;
vi.mock('../src/lib/solanaLending.js', async () => {
  const actual = await vi.importActual('../src/lib/solanaLending.js');
  return {
    ...actual,
    readSolanaLendingMarket: () => (marketAnswer instanceof Error
      ? Promise.reject(marketAnswer)
      : Promise.resolve(marketAnswer))
  };
});

/* Loaded lazily so the mocks above are registered first. */
const loadPanel = async () => (await import('../src/components/SolanaLendingPanel.jsx')).default;

const SERVER_SNAPSHOT = {
  ok: true,
  via: 'server',
  dataStatus: 'ok',
  assets: [],
  positions: [],
  account: { unknown: false, totalCollateralUsd: 0, totalDebtUsd: 0, availableBorrowsUsd: 0 }
};

const mountPanel = async () => {
  const Panel = await loadPanel();
  return render(<Panel t={t} tab="supply" setTab={() => {}} preset={null} />);
};

beforeEach(() => {
  marketAnswer = SERVER_SNAPSHOT;
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the panel tells the user which door answered', () => {
  it('says so when the numbers came through our own server', async () => {
    await mountPanel();
    const note = await screen.findByTestId('solana-loan-via-server');
    expect(note.textContent).toBe(en.loan.solana.serverDoor);
    expect(screen.queryByTestId('solana-loan-error')).toBeNull();
  });

  it('says nothing about the route when the browser door served it', async () => {
    marketAnswer = { ...SERVER_SNAPSHOT, via: 'browser' };
    await mountPanel();
    await waitFor(() => expect(screen.queryByTestId('solana-loan-via-server')).toBeNull());
  });
});

describe('when both doors are shut, the second one is still named', () => {
  const bothShut = () => {
    const failure = new Error('RPC_BLOCKED');
    failure.code = 'RPC_BLOCKED';
    failure.hosts = [
      { host: 'api.mainnet-beta.solana.com', reason: 'RPC_BLOCKED', relay: false },
      { host: null, reason: 'RELAY_UPSTREAM_UNAVAILABLE', relay: true }
    ];
    failure.serverTried = true;
    failure.serverCode = 'KAMINO_MARKET_UNAVAILABLE';
    failure.serverDetail = 'every upstream refused the market load';
    return failure;
  };

  it('renders the server verdict under the per-host list, in the user’s language', async () => {
    marketAnswer = bothShut();
    await mountPanel();

    const door = await screen.findByTestId('solana-loan-server-door');
    expect(door.textContent).toContain(en.loan.rpc.serverTried);
    expect(door.textContent).toContain(en.loan.rpc.serverHost);
    expect(door.textContent).toContain(en.loan.error.KAMINO_MARKET_UNAVAILABLE);
    /* The raw witness line stays (§28): it is evidence, not the explanation. */
    expect(door.textContent).toContain('every upstream refused the market load');

    /* …and the per-host list is still there — the server line ADDS a door, it
       does not replace the verdicts the user can act on. */
    expect(screen.getByTestId('solana-loan-rpc-incident')).toBeTruthy();
    expect(screen.getByTestId('solana-loan-error').getAttribute('data-code')).toBe('RPC_BLOCKED');
  });

  it('does not claim the second door was tried when it was not', async () => {
    const failure = new Error('RPC_BLOCKED');
    failure.code = 'RPC_BLOCKED';
    failure.hosts = [{ host: 'api.mainnet-beta.solana.com', reason: 'RPC_BLOCKED', relay: false }];
    marketAnswer = failure;

    await mountPanel();
    await screen.findByTestId('solana-loan-error');
    expect(screen.queryByTestId('solana-loan-server-door')).toBeNull();
  });
});
