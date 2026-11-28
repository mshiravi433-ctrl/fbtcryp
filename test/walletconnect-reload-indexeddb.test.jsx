// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { indexedDB } from 'fake-indexeddb';

const { calls } = vi.hoisted(() => ({ calls: [] }));
vi.mock('../src/lib/wc', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createWcSession: () => {
    const address = '0x1111111111111111111111111111111111111111';
    const provider = { on() {}, removeListener() {}, request: async ({ method }) => {
      calls.push(method);
      if (method === 'eth_accounts') return [address];
      if (method === 'eth_chainId') return '0x38';
      throw new Error(`unexpected ${method}`);
    } };
    return { on: () => () => {}, restore: async () => ({ ok: true, provider, address, chainId: 56 }),
      disconnect: async () => true, cancel: async () => false };
  } };
});
import { WalletProvider, useWallet } from '../src/context/WalletContext';
const ADDRESS = '0x1111111111111111111111111111111111111111';
function Probe() { const w = useWallet(); return <div><span data-testid="address">{w.address || 'none'}</span><span data-testid="mode">{w.mode || 'none'}</span></div>; }
async function seed() {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('WALLET_CONNECT_V2_INDEXED_DB', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keyvaluestorage');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('keyvaluestorage', 'readwrite');
      tx.objectStore('keyvaluestorage').put('[{"topic":"session"}]', 'wc@2:client:0.3:session');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject;
    };
    req.onerror = reject;
  });
}
afterEach(async () => {
  cleanup(); localStorage.clear(); calls.length = 0; delete globalThis.indexedDB;
  await new Promise(resolve => { const req = indexedDB.deleteDatabase('WALLET_CONNECT_V2_INDEXED_DB'); req.onsuccess = req.onerror = resolve; });
});

describe('WalletConnect refresh with the SDK IndexedDB store', () => {
  it('restores the last external wallet even when a local vault also exists', async () => {
    globalThis.indexedDB = indexedDB;
    await seed();
    localStorage.setItem('fbt-wallet-v1', JSON.stringify({ address: '0x2222222222222222222222222222222222222222' }));
    const now = Date.now();
    localStorage.setItem('fbt-wallet-session-v1', JSON.stringify({ v: 1, mode: 'wc', address: ADDRESS, chainId: 56, minutes: 60, issuedAt: now, expiresAt: now + 3600000 }));
    render(<WalletProvider><Probe /></WalletProvider>);
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(ADDRESS), { timeout: 6000 });
    expect(screen.getByTestId('mode').textContent).toBe('wc');
    expect(calls).not.toContain('eth_requestAccounts');
  });
  it('adopts an older IndexedDB session even without a lease', async () => {
    globalThis.indexedDB = indexedDB; await seed();
    render(<WalletProvider><Probe /></WalletProvider>);
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(ADDRESS), { timeout: 6000 });
    expect(screen.getByTestId('mode').textContent).toBe('wc');
  });
});
