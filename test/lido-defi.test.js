import { describe, expect, it } from 'vitest';
import { Interface } from 'ethers';
import {
  LIDO,
  verifyDeployment,
  verifyLidoReceipt
} from '../src/lib/defi/lido';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const EVENTS = new Interface([
  'event Submitted(address indexed sender, uint256 amount, address referral)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event WithdrawalRequested(uint256 indexed requestId, address indexed requestor, address indexed owner, uint256 amountOfStETH, uint256 amountOfShares)',
  'event WithdrawalClaimed(uint256 indexed requestId, address indexed owner, address indexed receiver, uint256 amountOfETH)'
]);
const log = (address, name, values) => {
  const encoded = EVENTS.encodeEventLog(EVENTS.getEvent(name), values);
  return { address, topics: encoded.topics, data: encoded.data };
};

describe('Lido execution proof boundary', () => {
  it('rejects a wrong network before deployment reads', async () => {
    await expect(verifyDeployment({ getNetwork: async () => ({ chainId: 8453 }) }))
      .rejects.toMatchObject({ code: 'LIDO_WRONG_CHAIN' });
  });

  it('requires the real Submitted event and exact owner/amount', async () => {
    const receipt = { status: 1, logs: [log(LIDO.stETH, 'Submitted', [OWNER, 5n * 10n ** 18n, LIDO.referral])] };
    await expect(verifyLidoReceipt({
      provider: {}, receipt, owner: OWNER, action: 'stake', amountWei: 5n * 10n ** 18n
    })).resolves.toMatchObject({ ok: true, event: 'Submitted' });
    await expect(verifyLidoReceipt({
      provider: {}, receipt, owner: OTHER, action: 'stake', amountWei: 5n * 10n ** 18n
    })).rejects.toMatchObject({ code: 'LIDO_STAKE_EVENT_MISMATCH' });
  });

  it('extracts requestId from WithdrawalRequested and verifies ownership/finalization state', async () => {
    const requestId = 123n;
    const queueAbi = ['function getWithdrawalStatus(uint256[] requestIds) view returns (tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])'];
    const queueIface = new Interface(queueAbi);
    const provider = {
      call: async ({ data }) => queueIface.encodeFunctionResult('getWithdrawalStatus', [[[
        5n * 10n ** 18n, 5n * 10n ** 18n, OWNER, 1700000000n, false, false
      ]]])
    };
    const receipt = { status: 1, logs: [log(LIDO.withdrawalQueue, 'WithdrawalRequested', [requestId, OWNER, OWNER, 5n * 10n ** 18n, 5n * 10n ** 18n])] };
    await expect(verifyLidoReceipt({
      provider, receipt, owner: OWNER, action: 'requestWithdraw', amountWei: 5n * 10n ** 18n
    })).resolves.toMatchObject({ ok: true, requestId });
  });

  it('requires a finalized, owned withdrawal for the claim proof', async () => {
    const requestId = 123n;
    const queueAbi = ['function getWithdrawalStatus(uint256[] requestIds) view returns (tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])'];
    const queueIface = new Interface(queueAbi);
    const provider = {
      call: async () => queueIface.encodeFunctionResult('getWithdrawalStatus', [[[
        5n * 10n ** 18n, 5n * 10n ** 18n, OWNER, 1700000000n, true, true
      ]]])
    };
    const receipt = { status: 1, logs: [log(LIDO.withdrawalQueue, 'WithdrawalClaimed', [requestId, OWNER, OWNER, 5n * 10n ** 18n])] };
    await expect(verifyLidoReceipt({ provider, receipt, owner: OWNER, action: 'claim', requestId }))
      .resolves.toMatchObject({ ok: true, event: 'WithdrawalClaimed', requestId });
    await expect(verifyLidoReceipt({ provider, receipt, owner: OTHER, action: 'claim', requestId }))
      .rejects.toMatchObject({ code: 'LIDO_CLAIM_EVENT_MISMATCH' });
  });

  it('uses the official queue address and verifies WstETH through ERC-20 Transfer events', async () => {
    expect(LIDO.withdrawalQueue).toBe('0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1');
    const zero = '0x0000000000000000000000000000000000000000';
    const input = 5n * 10n ** 18n;
    const output = 499n * 10n ** 16n;
    const wrapReceipt = {
      status: 1,
      logs: [
        log(LIDO.wstETH, 'Transfer', [zero, OWNER, output]),
        log(LIDO.stETH, 'Transfer', [OWNER, LIDO.wstETH, input])
      ]
    };
    await expect(verifyLidoReceipt({
      provider: {}, receipt: wrapReceipt, owner: OWNER, action: 'wrap', amountWei: input
    })).resolves.toMatchObject({ ok: true, event: 'Transfer' });

    const unwrapReceipt = {
      status: 1,
      logs: [
        log(LIDO.wstETH, 'Transfer', [OWNER, zero, output]),
        log(LIDO.stETH, 'Transfer', [LIDO.wstETH, OWNER, input])
      ]
    };
    await expect(verifyLidoReceipt({
      provider: {}, receipt: unwrapReceipt, owner: OWNER, action: 'unwrap', amountWei: output
    })).resolves.toMatchObject({ ok: true, event: 'Transfer' });
  });

  it('does not accept a successful receipt with no expected event', async () => {
    await expect(verifyLidoReceipt({
      provider: {}, receipt: { status: 1, logs: [] }, owner: OWNER, action: 'requestWithdraw'
    })).rejects.toMatchObject({ code: 'LIDO_EXPECTED_EVENT_MISSING' });
  });
});


describe('Lido — ROUTED stake receipts (split router)', () => {
  const ROUTER = '0x1234567890123456789012345678901234567890';
  const ETH = 5n * 10n ** 18n;
  const FEE = (ETH * 30n) / 10_000n;
  const NET = ETH - FEE;
  const splitRouter = { address: ROUTER, feeBps: 30n, feeAmount: FEE, netAmount: NET };
  const ROUTED = new Interface([
    'event Routed(address indexed target, address indexed user, address indexed asset, uint256 amountIn, uint256 feeTaken, uint256 netAmount)'
  ]);
  const routedLog = (user, net) => {
    const e = ROUTED.encodeEventLog(ROUTED.getEvent('Routed'), [LIDO.stETH, user, '0x0000000000000000000000000000000000000000', ETH, FEE, net]);
    return { address: ROUTER, topics: e.topics, data: e.data };
  };

  it('proves a routed stake from Routed + the stETH Transfer router → OWNER', async () => {
    /* The router itself calls submit(), so the receipt really does carry a
     * Submitted event — with the ROUTER as sender. That is exactly why the
     * direct-stake proof (sender === owner) cannot be used here. */
    const submitted = log(LIDO.stETH, 'Submitted', [ROUTER, NET, '0x0000000000000000000000000000000000000000']);
    const receipt = { status: 1, logs: [routedLog(OWNER, NET), submitted, log(LIDO.stETH, 'Transfer', [ROUTER, OWNER, NET])] };
    await expect(verifyLidoReceipt({
      provider: {}, receipt, owner: OWNER, action: 'stake', amountWei: ETH, splitRouter
    })).resolves.toMatchObject({ ok: true, event: 'Routed' });
  });

  it('rejects a routed stake that hands the stETH to someone else, or a missing Routed event', async () => {
    const submitted = log(LIDO.stETH, 'Submitted', [ROUTER, NET, '0x0000000000000000000000000000000000000000']);
    const toOther = { status: 1, logs: [routedLog(OWNER, NET), submitted, log(LIDO.stETH, 'Transfer', [ROUTER, OTHER, NET])] };
    await expect(verifyLidoReceipt({
      provider: {}, receipt: toOther, owner: OWNER, action: 'stake', amountWei: ETH, splitRouter
    })).rejects.toMatchObject({ code: 'LIDO_STAKE_EVENT_MISMATCH' });
    const noRouted = { status: 1, logs: [submitted, log(LIDO.stETH, 'Transfer', [ROUTER, OWNER, NET])] };
    await expect(verifyLidoReceipt({
      provider: {}, receipt: noRouted, owner: OWNER, action: 'stake', amountWei: ETH, splitRouter
    })).rejects.toMatchObject({ code: 'SPLIT_ROUTER_PROOF_MISMATCH' });
  });
});
