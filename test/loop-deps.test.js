import { describe, expect, it } from 'vitest';
import { createBrowserLoopDeps } from '../src/lib/loopDeps.js';

const wallet = '0x00000000000000000000000000000000000000aa';
const other = '0x00000000000000000000000000000000000000bb';
const signer = (address, chainId) => ({
  getAddress: async () => address,
  provider: { getNetwork: async () => ({ chainId: BigInt(chainId) }) }
});
const RUNTIME_OPERATIONS = [
  'readAccount', 'readReserve', 'readPrices', 'readTokenBalance', 'readNativeBalance',
  'readPoolAllowance', 'simulateLending', 'executeLending', 'assertSigner',
  'getQuote', 'swapNeedsApproval', 'approveSwap', 'executeSwap'
];

describe('collateral-loop browser wiring', () => {
  it('exposes every operation the loop runtime calls', () => {
    const deps = createBrowserLoopDeps({ getReadProvider: async () => null, getSigner: () => null });
    for (const key of RUNTIME_OPERATIONS) expect(typeof deps[key]).toBe('function');
  });

  it('re-asserts the signer before a prompt and maps failures to stable codes', async () => {
    const make = (s) => createBrowserLoopDeps({ getReadProvider: async () => null, getSigner: () => s });
    expect(await make(null).assertSigner({ chainId: 42161, wallet })).toEqual({ ok: false, code: 'WALLET_NOT_CONNECTED' });
    expect((await make(signer(wallet, 8453)).assertSigner({ chainId: 42161, wallet })).code).toBe('WRONG_NETWORK');
    expect((await make(signer(other, 42161)).assertSigner({ chainId: 42161, wallet })).code).toBe('ACCOUNT_CHANGED');
    expect(await make(signer(wallet, 42161)).assertSigner({ chainId: 42161, wallet })).toEqual({ ok: true });
  });

  it('refuses to sign a lending step without a signer', async () => {
    const deps = createBrowserLoopDeps({ getReadProvider: async () => ({}), getSigner: () => null });
    await expect(deps.executeLending({ chainId: 42161, wallet, asset: {}, steps: [] })).rejects.toThrow('WALLET_NOT_CONNECTED');
  });

  it('reads the native balance through one cached read provider per chain', async () => {
    let created = 0;
    const deps = createBrowserLoopDeps({
      getReadProvider: async () => { created += 1; return { getBalance: async () => 123n }; },
      getSigner: () => null
    });
    expect(await deps.readNativeBalance({ chainId: 42161, owner: wallet })).toBe(123n);
    expect(await deps.readNativeBalance({ chainId: 42161, owner: wallet })).toBe(123n);
    expect(created).toBe(1);
  });

  it('does not cache a read provider that failed to build', async () => {
    let attempts = 0;
    const deps = createBrowserLoopDeps({
      getReadProvider: async () => { attempts += 1; if (attempts === 1) throw new Error('rpc down'); return { getBalance: async () => 7n }; },
      getSigner: () => null
    });
    await expect(deps.readNativeBalance({ chainId: 42161, owner: wallet })).rejects.toThrow('rpc down');
    expect(await deps.readNativeBalance({ chainId: 42161, owner: wallet })).toBe(7n);
  });
});
