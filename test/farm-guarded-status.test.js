import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  assertSignerContext: vi.fn(),
  waitForMinedReceipt: vi.fn(),
  signerSendTransaction: vi.fn()
}));
vi.mock('../src/lib/defi/executionGuards', () => ({
  assertSignerContext: mock.assertSignerContext,
  isTransactionReplacement: vi.fn(),
  isTransactionTimeout: vi.fn(),
  isUserRejection: vi.fn(),
  waitForMinedReceipt: mock.waitForMinedReceipt
}));
vi.mock('../src/lib/preSignSimulation', () => ({
  buildUnsignedTransaction: vi.fn((value) => value),
  simulateUnsignedTransaction: vi.fn()
}));

import { executeGuardedStep } from '../src/lib/defi/guardedExecution.js';

beforeEach(() => {
  mock.assertSignerContext.mockReset().mockResolvedValue(true);
  mock.waitForMinedReceipt.mockReset();
  mock.signerSendTransaction.mockReset();
});

describe('guarded Morpho transaction lifecycle status', () => {
  it('reports the wallet broadcast before receipt confirmation, without signing in the app', async () => {
    let resolveReceipt;
    const receiptPromise = new Promise((resolve) => { resolveReceipt = resolve; });
    mock.waitForMinedReceipt.mockReturnValue(receiptPromise);
    const tx = { hash: `0x${'ab'.repeat(32)}` };
    const signer = { sendTransaction: mock.signerSendTransaction.mockResolvedValue(tx) };
    const onBroadcast = vi.fn();
    const verifyReceipt = vi.fn(async () => ({ ok: true }));

    const result = executeGuardedStep({
      signer,
      owner: '0x1111111111111111111111111111111111111111',
      chainId: 8453,
      step: { to: '0x2222222222222222222222222222222222222222', data: '0x', value: 0n },
      onBroadcast,
      verifyReceipt
    });

    await vi.waitFor(() => expect(onBroadcast).toHaveBeenCalledWith(tx));
    expect(mock.waitForMinedReceipt).toHaveBeenCalledWith(tx, { timeoutMs: 180_000 });
    expect(mock.assertSignerContext).toHaveBeenCalledTimes(1);
    resolveReceipt({ receipt: { status: 1, hash: tx.hash, blockNumber: 12 }, replaced: false });
    await expect(result).resolves.toMatchObject({ tx, proof: { ok: true } });
    expect(verifyReceipt).toHaveBeenCalledWith({ receipt: { status: 1, hash: tx.hash, blockNumber: 12 }, tx, replaced: false });
  });

  it('keeps waiting on the user-signed transaction even if local status reporting throws', async () => {
    const tx = { hash: `0x${'cd'.repeat(32)}` };
    const receipt = { status: 1, hash: tx.hash, blockNumber: 13 };
    mock.signerSendTransaction.mockResolvedValue(tx);
    mock.waitForMinedReceipt.mockResolvedValue({ receipt, replaced: false });
    await expect(executeGuardedStep({
      signer: { sendTransaction: mock.signerSendTransaction },
      owner: '0x1111111111111111111111111111111111111111',
      chainId: 8453,
      step: { to: '0x2222222222222222222222222222222222222222', data: '0x', value: 0n },
      onBroadcast: () => { throw new Error('local storage is unavailable'); }
    })).resolves.toMatchObject({ tx, receipt });
  });
});
