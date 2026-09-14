// @vitest-environment jsdom
/**
 * «مطمئن شو کیف پول داخلی و خارجی همه‌چیز کامله و درست کار میده» — one part of
 * that was quietly wrong: WHICH NETWORK the in-app wallet comes up on.
 *
 * All three vault paths (`attachLocal`, `attachCreatedLocal`, `unlockLocal`)
 * hard-set DEFAULT_CHAIN. So: pick Base, unlock your in-app wallet, and the app
 * is back on BNB Smart Chain with the signer re-pointed at BSC's RPC. Nothing
 * threw — the label and the signer agreed — but the balance on screen was
 * another chain's, and the next "send USDT" was a BSC transfer nobody asked
 * for. That is the failure mode this app exists to refuse: an action on a
 * network the user did not choose.
 *
 * The fix is `localTargetChain()` in WalletContext: keep the selected chain when
 * the registry knows it, fall back to DEFAULT_CHAIN only when there is nothing
 * to keep. This test drives the real provider — no re-implementation of the
 * logic — and asserts the chain survives attaching the vault.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';

vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));

import { WalletProvider, useWallet } from '../src/context/WalletContext';
import { DEFAULT_CHAIN, EVM_CHAINS } from '../src/lib/chains';

const VAULT_ADDRESS = '0x66c14A85E3f0ab12508F5289A3041BEdE1EaE1DE';
const BASE = 8453;

/** A consumer that hands the live context value to the test. */
let ctx = null;
function Probe() {
  ctx = useWallet();
  return null;
}

const mount = () => render(<WalletProvider><Probe /></WalletProvider>);

/** The shape lib/localWallet.js persists; only the address is read here. */
const seedVault = () => localStorage.setItem('fbt-wallet-v1', JSON.stringify({
  v: 1, kdf: 'PBKDF2', iterations: 250_000, salt: 'AAAA', iv: 'AAAA', ct: 'AAAA',
  address: VAULT_ADDRESS, createdAt: Date.now()
}));

beforeEach(() => {
  localStorage.clear();
  ctx = null;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the in-app wallet keeps the network the user chose', () => {
  it('attaching the vault does not throw the app back to the default chain', async () => {
    seedVault();
    await act(async () => { mount(); });

    // The user is on Base before they touch the wallet.
    await act(async () => { await ctx.switchChain(BASE); });
    expect(ctx.chainId).toBe(BASE);
    expect(EVM_CHAINS[BASE]).toBeTruthy();

    // Attaching the stored vault must leave them there.
    await act(async () => { expect(ctx.attachLocal()).toBe(true); });
    expect(ctx.address).toBe(VAULT_ADDRESS);
    expect(ctx.mode).toBe('local');
    expect(ctx.locked).toBe(true);
    expect(ctx.chainId).toBe(BASE);
    expect(ctx.chainOk).toBe(true);
  });

  it('falls back to the default chain when there is nothing selected to keep', async () => {
    seedVault();
    await act(async () => { mount(); });
    /* No prior selection (chainId is the default before any switch), so the
       vault comes up on DEFAULT_CHAIN — the old behaviour, kept exactly where
       it is still correct. */
    await act(async () => { expect(ctx.attachLocal()).toBe(true); });
    expect(ctx.chainId).toBe(DEFAULT_CHAIN);
  });

  it('refuses a chain this app has no registry entry for', async () => {
    seedVault();
    await act(async () => { mount(); });
    /* A wallet can sit on a network we do not support. switchChain refuses it
       outright (no RPC, no explorer, nothing to build a transaction against),
       so the selection stays put and the vault comes up on the default. */
    await act(async () => { expect(await ctx.switchChain(999_999)).toBe(false); });
    expect(EVM_CHAINS[999_999]).toBeUndefined();
    await act(async () => { expect(ctx.attachLocal()).toBe(true); });
    expect(ctx.chainId).toBe(DEFAULT_CHAIN);
    expect(ctx.chainOk).toBe(true);
  });

  it('exposes the runtime the Intent AI execution path reads, on that same chain', async () => {
    /*
     * `getWalletRuntime()` is what the AI execution seam checks before it will
     * offer to build a transaction. It must report the chain the wallet is
     * actually on — a runtime that said DEFAULT_CHAIN while the signer sat on
     * Base would let an intent be built for the wrong network.
     */
    seedVault();
    await act(async () => { mount(); });
    await act(async () => { await ctx.switchChain(BASE); });
    await act(async () => { ctx.attachLocal(); });
    const runtime = ctx.getWalletRuntime();
    expect(runtime.chainId).toBe(BASE);
    expect(runtime.account).toBe(VAULT_ADDRESS);
    // Locked: the phrase is not in memory, so no provider and not "connected".
    expect(runtime.connected).toBe(false);
    expect(ctx.getSigner()).toBe(null);
  });
});
