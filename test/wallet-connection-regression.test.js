import { describe, it, expect, vi } from 'vitest';
import { waitForEmailConnection } from '../src/lib/emailConnection.js';
import { probeRelay, probeRelaySet } from '../src/lib/wcRelayProbe.js';
import { verifyJWT } from '@walletconnect/relay-auth';

function modalMock(open) {
  const state = { account: null, state: null, connected: false, address: undefined };
  const unsubs = [vi.fn(), vi.fn()];
  const modal = {
    subscribeAccount: (cb) => { state.account = cb; return unsubs[0]; },
    subscribeState: (cb) => { state.state = cb; cb({ open: false }); return unsubs[1]; },
    getIsConnectedState: () => state.connected,
    getAddress: () => state.address,
    open: open || (() => { state.state({ open: true }); return Promise.resolve(); })
  };
  return { state, modal, unsubs };
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

describe('email connection lifecycle', () => {
  it('handles an asynchronous modal.open rejection and unsubscribes', async () => {
    const { modal, unsubs } = modalMock(() => Promise.reject(new Error('chunk failed')));
    const onError = vi.fn();
    expect(await waitForEmailConnection(modal, vi.fn(), { onError })).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    unsubs.forEach((u) => expect(u).toHaveBeenCalledTimes(1));
  });
  it('ignores the initial closed state; attaches once and waits through auto-close', async () => {
    const { modal, state, unsubs } = modalMock();
    let finish;
    const attach = vi.fn(() => new Promise((r) => { finish = r; }));
    const result = waitForEmailConnection(modal, attach);
    state.account({ isConnected: true, address: '0xabc' });
    state.account({ isConnected: true, address: '0xabc' });
    state.state({ open: false });
    await pause(300);
    expect(attach).toHaveBeenCalledTimes(1);
    finish(true);
    expect(await result).toBe(true);
    unsubs.forEach((u) => expect(u).toHaveBeenCalledTimes(1));
  });
  it('accepts an account update immediately after modal close', async () => {
    const { modal, state } = modalMock();
    const attach = vi.fn(async () => true);
    const result = waitForEmailConnection(modal, attach);
    state.state({ open: false });
    await pause(10);
    state.account({ isConnected: true, address: '0xabc' });
    expect(await result).toBe(true);
  });
  it('settles a genuine cancel without a connection error', async () => {
    const { modal, state } = modalMock();
    const onError = vi.fn();
    const result = waitForEmailConnection(modal, vi.fn(), { onError });
    state.state({ open: false });
    expect(await result).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });
  it('reports attachment failure and ignores stale callbacks', async () => {
    const { modal, state } = modalMock();
    const attach = vi.fn(async () => { throw new Error('provider failed'); });
    const onError = vi.fn();
    const result = waitForEmailConnection(modal, attach, { onError });
    state.account({ isConnected: true, address: '0xabc' });
    expect(await result).toBe(false);
    state.account({ isConnected: true, address: '0xabc' });
    expect(attach).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });
  it('bounds a modal that never opens', async () => {
    const { modal, unsubs } = modalMock(() => new Promise(() => {}));
    expect(await waitForEmailConnection(modal, vi.fn(), { openTimeoutMs: 10 })).toBe(false);
    unsubs.forEach((u) => expect(u).toHaveBeenCalledTimes(1));
  });
});

describe('relay diagnostic authentication', () => {
  it('sends a valid, short-lived audience-bound JWT and never leaks it in the report', async () => {
    let target;
    class Socket {
      constructor(url) { target = new URL(url); queueMicrotask(() => this.onopen()); }
      close() {}
    }
    const result = await probeRelay('wss://relay.walletconnect.org', { projectId: 'project', WebSocketImpl: Socket });
    expect(result.ok).toBe(true);
    expect(target.searchParams.get('projectId')).toBe('project');
    const auth = target.searchParams.get('auth');
    expect(await verifyJWT(auth)).toBe(true);
    const payload = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url'));
    expect(payload.aud).toBe('wss://relay.walletconnect.org');
    expect(payload.exp - payload.iat).toBe(300);
    expect(JSON.stringify(result)).not.toContain(auth);
  });
  it('runs HTTPS concurrently with the socket, preserving opaque error details', async () => {
    let fetched = false;
    class Socket {
      constructor() { queueMicrotask(() => this.onclose({ code: 1006 })); }
      close() { expect(fetched).toBe(true); }
    }
    const result = await probeRelaySet({
      urls: ['wss://relay.walletconnect.org'], WebSocketImpl: Socket,
      fetchImpl: async () => { fetched = true; return { type: 'opaque' }; }
    });
    expect(result.hosts[0].socket.closeCode).toBe(1006);
    expect(result.hosts[0].socket.error).toBe('SOCKET_ERROR');
  });
});
