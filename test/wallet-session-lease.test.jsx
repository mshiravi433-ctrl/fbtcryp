// @vitest-environment jsdom
/**
 * THE REPORTED BUG, AS A TEST: a refresh must not disconnect the wallet.
 *
 * «پس از رفرش کیف پول متصل دیسکانکت می‌شه» — the user reloads the page and the
 * connected wallet is gone. This mounts the REAL WalletProvider twice, exactly
 * like a reload does (a fresh document, the same localStorage), and asserts
 * what the user asked for:
 *
 *   1. an injected wallet is re-attached SILENTLY from the lease — no prompt;
 *   2. the re-attach asks for no approval (`eth_requestAccounts` is never sent,
 *      `eth_accounts` is);
 *   3. once the window the user chose has lapsed, nothing re-attaches;
 *   4. an explicit disconnect leaves nothing behind for the next document.
 *
 * The WalletConnect SDK is the only thing stubbed: the lease, the plan and the
 * component under test are the real ones. That is the point — the decision this
 * bug lives in is plain JavaScript, and it is asserted as such.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

/** A WalletConnect session that never restores — this file is about injected. */
vi.mock('../src/lib/wc', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createWcSession: () => ({
      on: () => () => {},
      connect: async () => ({ ok: false, code: 'WC_STUB' }),
      restore: async () => ({ ok: false, code: 'WC_STUB' }),
      cancel: async () => false,
      disconnect: async () => true,
      busy: () => false,
      session: () => null,
      hasStoredSession: () => false
    })
  };
});

const { WalletProvider, useWallet } = await import('../src/context/WalletContext');

const LEASE_KEY = 'fbt-wallet-session-v1';
const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

/** What an EIP-1193 wallet in the page looks like to the app. */
function stubEthereum({ accounts = [WALLET], chainId = '0x38' } = {}) {
  const calls = [];
  const provider = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      calls.push(method);
      if (method === 'eth_accounts') return accounts;
      if (method === 'eth_requestAccounts') return accounts;
      if (method === 'eth_chainId') return chainId;
      if (method === 'net_version') return String(parseInt(chainId, 16));
      if (method === 'eth_getBalance') return '0x0';
      if (method === 'eth_blockNumber') return '0x1';
      if (method === 'eth_call') return '0x';
      throw new Error(`UNSTUBBED ${method} ${JSON.stringify(params ?? [])}`);
    },
    on: () => {},
    removeListener: () => {},
    removeAllListeners: () => {}
  };
  window.ethereum = provider;
  return calls;
}

function Probe() {
  const wallet = useWallet();
  return (
    <div>
      <span data-testid="mode">{wallet.mode ?? 'none'}</span>
      <span data-testid="address">{wallet.address ?? 'none'}</span>
      <button type="button" data-testid="disconnect" onClick={() => wallet.disconnect?.()}>x</button>
    </div>
  );
}

/** A lease as the app writes it, with only the clock under the test's control. */
function seedLease({ mode = 'injected', address = WALLET, minutes = 60, ageMs = 0 }) {
  const issuedAt = Date.now() - ageMs;
  window.localStorage.setItem(LEASE_KEY, JSON.stringify({
    v: 1,
    mode,
    address: address.toLowerCase(),
    chainId: 56,
    rdns: null,
    minutes,
    issuedAt,
    expiresAt: minutes > 0 ? issuedAt + minutes * 60_000 : 0
  }));
}

/* An idle-callback/timer-free mount: the retry ladder must not keep the test
   process alive while it waits for a relay that is never coming. */
const realSetTimeout = globalThis.setTimeout;
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete window.ethereum;
  globalThis.setTimeout = realSetTimeout;
  vi.restoreAllMocks();
});
beforeEach(() => {
  window.localStorage.clear();
});

describe('a refresh keeps the wallet (the reported bug)', () => {
  it('re-attaches an injected wallet from the lease, without asking for approval', async () => {
    const calls = stubEthereum();
    seedLease({ mode: 'injected' });

    render(<WalletProvider><Probe /></WalletProvider>);

    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(WALLET));
    expect(screen.getByTestId('mode').textContent).toBe('injected');
    /* THE POINT: silence. `eth_requestAccounts` is a prompt; a refresh must
       never show one. */
    expect(calls).toContain('eth_accounts');
    expect(calls).not.toContain('eth_requestAccounts');
  });

  it('honours the account the wallet now reports, not the one the lease remembers', async () => {
    stubEthereum({ accounts: [OTHER] });
    seedLease({ mode: 'injected', address: WALLET });

    render(<WalletProvider><Probe /></WalletProvider>);

    /* The wallet is the authority on its own active account; the lease only
       ever remembers. Showing the stale one would sign with the wrong key. */
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(OTHER));
  });

  it('re-attaches nothing once the chosen window has lapsed', async () => {
    const calls = stubEthereum();
    seedLease({ mode: 'injected', minutes: 15, ageMs: 16 * 60_000 });

    render(<WalletProvider><Probe /></WalletProvider>);

    /* Give the cold start its chance to (wrongly) attach. */
    await act(async () => { await new Promise((r) => realSetTimeout(r, 60)); });
    expect(screen.getByTestId('address').textContent).toBe('none');
    expect(calls).not.toContain('eth_accounts');
    /* And the lapsed record is gone, so the next document starts clean. */
    expect(window.localStorage.getItem(LEASE_KEY)).toBeNull();
  });

  it('leaves nothing behind after an explicit disconnect', async () => {
    stubEthereum();
    seedLease({ mode: 'injected' });

    render(<WalletProvider><Probe /></WalletProvider>);
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(WALLET));

    await act(async () => {
      screen.getByTestId('disconnect').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe('none'));
    expect(window.localStorage.getItem(LEASE_KEY)).toBeNull();
  });

  it('a wallet connected now is written down, so the NEXT document has it', async () => {
    stubEthereum();

    /* Connect through the app's own path, exactly as the sheet does. */
    let wallet = null;
    function Grab() { wallet = useWallet(); return null; }
    const { unmount } = render(<WalletProvider><Grab /></WalletProvider>);
    await act(async () => { await wallet.connectInjected(); });
    unmount();

    const record = JSON.parse(window.localStorage.getItem(LEASE_KEY) || 'null');
    expect(record?.address).toBe(WALLET.toLowerCase());
    expect(record?.mode).toBe('injected');
    expect(record?.expiresAt).toBeGreaterThan(Date.now());
  });
});
