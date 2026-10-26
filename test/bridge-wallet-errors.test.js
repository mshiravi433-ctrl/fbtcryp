import { describe, expect, it } from 'vitest';
import { bridgeExecutionCode } from '../src/lib/bridgeErrors.js';

describe('WalletConnect bridge result normalization', () => {
  it.each([
    [{ code: 4001, message: 'User rejected the request' }, 'USER_REJECTED'],
    [{ code: 'ACTION_REJECTED', shortMessage: 'user rejected action' }, 'USER_REJECTED'],
    [{ error: { code: 4001, message: 'User denied transaction' } }, 'USER_REJECTED'],
    [{ code: 'WALLET_NO_RESPONSE', message: 'WALLET_NO_RESPONSE' }, 'WALLET_NO_RESPONSE'],
    [{ message: 'insufficient funds for gas * price + value' }, 'INSUFFICIENT_GAS'],
    [{ message: 'insufficient balance for transfer' }, 'INSUFFICIENT_BALANCE']
  ])('normalizes %j to %s', (error, expected) => {
    expect(bridgeExecutionCode(error)).toBe(expected);
  });

  it('does not infer rejection from returning to the dApp without a response', () => {
    expect(bridgeExecutionCode({ message: 'wallet returned to app' })).toBeNull();
  });
});
