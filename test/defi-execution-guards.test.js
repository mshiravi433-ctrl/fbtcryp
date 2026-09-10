import { describe, expect, it } from 'vitest';
import {
  ExecutionGuardError,
  assertProviderChain,
  assertSignerContext,
  assertSuccessfulReceipt,
  isTransactionReplacement,
  isTransactionTimeout,
  isUserRejection,
  parseReceiptLogs,
  waitForMinedReceipt
} from '../src/lib/defi/executionGuards';
import { simulateGuardedStep } from '../src/lib/defi/guardedExecution';

describe('non-custodial execution guards', () => {
  it('requires the intended provider chain and classifies a changed chain', async () => {
    await expect(assertProviderChain({ getNetwork: async () => ({ chainId: 8453 }) }, 8453)).resolves.toBe(8453);
    await expect(assertProviderChain({ getNetwork: async () => ({ chainId: 1 }) }, 8453))
      .rejects.toMatchObject({ code: 'EXECUTION_WRONG_CHAIN' });
    await expect(assertProviderChain({ getNetwork: async () => { throw new Error('offline'); } }, 8453))
      .rejects.toMatchObject({ code: 'EXECUTION_NETWORK_UNREADABLE' });
  });

  it('recovers from a transient RPC blip instead of surfacing NETWORK_UNREADABLE', async () => {
    // Two public endpoints hiccup, the third answers — the panel must resolve,
    // not show the user «شبکه در دسترس نیست».
    let calls = 0;
    const flaky = { getNetwork: async () => { calls += 1; if (calls < 3) throw new Error('429'); return { chainId: 1 }; } };
    await expect(assertProviderChain(flaky, 1)).resolves.toBe(1);
    expect(calls).toBe(3);
    // A WRONG chain is a deterministic answer — it must never be retried.
    let wrongCalls = 0;
    const wrong = { getNetwork: async () => { wrongCalls += 1; return { chainId: 137 }; } };
    await expect(assertProviderChain(wrong, 1)).rejects.toMatchObject({ code: 'EXECUTION_WRONG_CHAIN' });
    expect(wrongCalls).toBe(1);
  });

  it('re-checks account and chain immediately before a signature', async () => {
    const provider = { getNetwork: async () => ({ chainId: 8453 }) };
    const signer = { provider, getAddress: async () => '0x1111111111111111111111111111111111111111' };
    await expect(assertSignerContext(signer, {
      owner: '0x1111111111111111111111111111111111111111', chainId: 8453
    })).resolves.toMatchObject({ chainId: 8453 });
    await expect(assertSignerContext(signer, {
      owner: '0x2222222222222222222222222222222222222222', chainId: 8453
    })).rejects.toMatchObject({ code: 'EXECUTION_ACCOUNT_CHANGED' });
  });

  it('distinguishes rejection, replacement, timeout and receipt failure', () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection(new Error('User denied signature'))).toBe(true);
    expect(isTransactionReplacement({ code: 'TRANSACTION_REPLACED' })).toBe(true);
    expect(isTransactionTimeout({ code: 'TRANSACTION_TIMEOUT' })).toBe(true);
    expect(() => assertSuccessfulReceipt({ status: 0 })).toThrowError(ExecutionGuardError);
    expect(() => assertSuccessfulReceipt({ status: 1 })).not.toThrow();
  });

  it('waits for a mined successful receipt and times out a pending handle', async () => {
    await expect(waitForMinedReceipt({ hash: '0x1', wait: async () => ({ status: 1, hash: '0x2' }) }, { timeoutMs: 20 }))
      .resolves.toMatchObject({ replaced: false, receipt: { status: 1 } });
    await expect(waitForMinedReceipt({ hash: '0x1', wait: () => new Promise(() => {}) }, { timeoutMs: 5 }))
      .rejects.toMatchObject({ code: 'TRANSACTION_TIMEOUT' });
  });

  it('re-simulates the exact unsigned step and blocks a revert before signing', async () => {
    const step = {
      to: '0x3333333333333333333333333333333333333333',
      data: '0x1234',
      value: 0n,
      kind: 'supply'
    };
    const cleanProvider = {
      call: async () => '0x',
      estimateGas: async () => 120000n
    };
    await expect(simulateGuardedStep({
      provider: cleanProvider,
      owner: '0x1111111111111111111111111111111111111111',
      step
    })).resolves.toMatchObject({ status: 'simulated-clean', provenSafe: true });
    const revertingProvider = {
      call: async () => { throw Object.assign(new Error('execution reverted'), { data: '0x' }); },
      estimateGas: async () => { throw new Error('execution reverted'); }
    };
    await expect(simulateGuardedStep({
      provider: revertingProvider,
      owner: '0x1111111111111111111111111111111111111111',
      step
    })).rejects.toMatchObject({ code: 'EXECUTION_SIMULATION_NOT_CLEAN' });
  });

  it('requires a protocol-specific event rather than accepting arbitrary logs', () => {
    const iface = {
      parseLog: ({ topics }) => topics?.[0] === 'known' ? { name: 'Supply', args: [] } : null
    };
    expect(parseReceiptLogs({ logs: [{ address: '0x1111111111111111111111111111111111111111', topics: ['known'], data: '0x' }] }, iface, '0x1111111111111111111111111111111111111111', 'Supply')).toHaveLength(1);
    expect(parseReceiptLogs({ logs: [{ address: '0x2222222222222222222222222222222222222222', topics: ['known'], data: '0x' }] }, iface, '0x1111111111111111111111111111111111111111', 'Supply')).toHaveLength(0);
  });
});
