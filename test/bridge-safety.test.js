import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { validateBridgeRequest, assertBridgeSigner, assertBridgeContracts } from '../src/lib/bridgeSafety.js';
import { thorDepositState, thorRequestKey, thorSourceKind } from '../src/lib/thorDeposit.js';
import { execute } from '../src/services/cross-chain/client.js';

const TOKEN = '0x55d398326f99059ff775485246999027b3197955';
const BRIDGE = '0x1234567890123456789012345678901234567890';
const SPENDER = '0x2345678901234567890123456789012345678901';
const OWNER = '0x3456789012345678901234567890123456789012';
const OTHER = '0x4567890123456789012345678901234567890123';
const base = { token: TOKEN, spender: SPENDER, chainId: 56, sender: OWNER, recipient: OWNER,
  transaction: { to: BRIDGE, data: '0x1234567800', value: '0', chainId: '0x38' } };

describe('bridge structural safety (not a reputation verdict)', () => {
  it('keeps the reported USDT address as a token, separate from spender/bridge', () => {
    expect(validateBridgeRequest(base)).toBe(true);
    expect(validateBridgeRequest({ ...base, transaction: { ...base.transaction, to: TOKEN } })).toBe(false);
    expect(validateBridgeRequest({ ...base, spender: TOKEN })).toBe(false);
  });
  it.each([
    { to: OWNER }, { to: '0x0000000000000000000000000000000000000000' },
    { data: '0x' }, { data: '0x123456789' }, { data: '0xa9059cbb00' },
    { data: '0x095ea7b300' }, { data: '0x23b872dd00' },
    { chainId: 1 }, { from: OTHER }, { value: '-1' }, { value: 'bad' }
  ])('refuses a non-bridge transaction %j', (over) => {
    expect(validateBridgeRequest({ ...base, transaction: { ...base.transaction, ...over } })).toBe(false);
  });
  it('does not invent a missing approval address', () => {
    expect(validateBridgeRequest({ ...base, spender: null })).toBe(false);
  });
  it('native deposits need no token/spender but still need contract calldata', () => {
    expect(validateBridgeRequest({ ...base, native: true, spender: null, token: null })).toBe(true);
  });
  it('rejects the wrong signer, network or an EOA', async () => {
    const signer = { provider: { getNetwork: async () => ({ chainId: 1 }) }, getAddress: async () => OWNER };
    await expect(assertBridgeSigner(signer, 56, OWNER)).rejects.toThrow('WRONG_NETWORK');
    await expect(assertBridgeSigner(signer, 1, OTHER)).rejects.toThrow('BRIDGE_ACCOUNT_CHANGED');
    await expect(assertBridgeContracts({ getCode: async () => '0x' }, [BRIDGE])).rejects.toThrow('UNSAFE_BRIDGE_REQUEST');
  });
});

describe('native deposit quote binding', () => {
  const now = Date.now();
  const req = { from: 'BTC.BTC', to: 'ETH.ETH', amount: '0.01', destination: OWNER };
  const q = { inbound_address: 'bc1qvault', memo: `=:ETH.ETH:${OWNER}:1000`, expiry: Math.floor(now / 1000) + 300, requestKey: thorRequestKey(req) };
  it('only unlocks details for a matching, unexpired destination-bound quote', () => {
    expect(thorDepositState(q, req, now)).toBe('ready');
    expect(thorDepositState(q, { ...req, destination: '' }, now)).toBe('destination');
    expect(thorDepositState(q, { ...req, destination: '0x123' }, now)).toBe('destination');
    for (const change of [{ amount: '0' }, { amount: '0.1' }, { from: 'LTC.LTC' }, { destination: OTHER }, { to: 'BSC.BNB' }]) {
      expect(thorDepositState(q, { ...req, ...change }, now)).not.toBe('ready');
    }
  });
  it.each([undefined, null, 'garbage', 0, Math.floor(now / 1000), Math.floor(now / 1000) + 29])('hides unusable expiry %j', (expiry) => {
    expect(thorDepositState({ ...q, expiry }, req, now)).toBe('expired');
  });
  it('refuses a memo from another request, even if the response arrived last', () => {
    expect(thorDepositState({ ...q, memo: `=:ETH.ETH:${OTHER}:100` }, req, now)).toBe('mismatch');
    expect(thorDepositState({ ...q, memo: '=:ETH.ETH::100' }, req, now)).toBe('mismatch');
  });
  it('selects network-specific instructions', () => {
    for (const asset of ['BTC.BTC', 'BCH.BCH', 'LTC.LTC', 'DOGE.DOGE']) expect(thorSourceKind(asset)).toBe('utxo');
    expect(thorSourceKind('ETH.USDC-0x123')).toBe('evm');
    expect(thorSourceKind('GAIA.ATOM')).toBe('cosmos');
    expect(thorSourceKind('XRP.XRP')).toBe('other');
  });
});

const mocks = vi.hoisted(() => ({ approve: vi.fn(), allowance: vi.fn(), balanceOf: vi.fn() }));
vi.mock('ethers', () => ({
  Contract: class { constructor() { Object.assign(this, mocks); } }, formatUnits: (v) => String(v)
}));

describe('real shared execution pipeline with mocked wallet/RPC', () => {
  let route, signer, wallet, fetcher;
  beforeEach(() => {
    mocks.approve.mockReset().mockResolvedValue({ wait: async () => ({ status: 1 }) });
    mocks.allowance.mockReset().mockResolvedValue(0n);
    mocks.balanceOf.mockReset().mockResolvedValue(10n ** 22n);
    route = { quoteId: 'q1', provider: 'lifi', fromChain: '56', toChain: '1', fromToken: TOKEN, toToken: OTHER,
      fromAmount: '1000000000000000000', fromAddress: OWNER, toAddress: OWNER,
      fromTokenDetail: { decimals: 18, symbol: 'USDT' }, approvalAddress: SPENDER,
      transactionRequest: { ...base.transaction }, expiresAt: Date.now() + 300_000 };
    signer = { provider: { getNetwork: vi.fn(async () => ({ chainId: 56 })), getCode: vi.fn(async () => '0x6000'), getBalance: vi.fn(async () => 10n ** 22n) },
      getAddress: vi.fn(async () => OWNER), sendTransaction: vi.fn(async () => ({ hash: '0xhash' })) };
    wallet = { address: OWNER, isConnected: true, chainId: 56, getSigner: () => signer };
    fetcher = vi.fn(async (url) => ({ ok: true, json: async () => url.includes('/quote?') ? { quote: route } : { transaction: { id: 't1', executionStatus: 'SUBMITTED' } } }));
    vi.stubGlobal('fetch', fetcher);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('reviews exact roles before approving; approval is exact and not a token transfer', async () => {
    const review = vi.fn(async (details) => {
      expect(mocks.approve).not.toHaveBeenCalled();
      expect(details).toMatchObject({ token: TOKEN, spender: SPENDER, contract: BRIDGE, recipient: OWNER });
      return true;
    });
    expect((await execute(route, { wallet, confirmSigning: review })).ok).toBe(true);
    expect(review).toHaveBeenCalledOnce();
    expect(mocks.approve).toHaveBeenCalledWith(SPENDER, 10n ** 18n, { chainId: 56 });
    expect(signer.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ to: BRIDGE, chainId: 56 }));
  });
  it('cancelling review makes zero approval or send requests', async () => {
    expect((await execute(route, { wallet, confirmSigning: async () => false })).code).toBe('USER_REJECTED');
    expect(mocks.approve).not.toHaveBeenCalled(); expect(signer.sendTransaction).not.toHaveBeenCalled();
  });
  it.each(['token-target', 'missing-spender', 'eoa', 'changed-amount', 'changed-recipient'])('blocks %s before approval', async (kind) => {
    const displayed = { ...route };
    if (kind === 'token-target') route.transactionRequest.to = TOKEN;
    if (kind === 'missing-spender') route.approvalAddress = null;
    if (kind === 'eoa') signer.provider.getCode.mockResolvedValue('0x');
    if (kind === 'changed-amount') route.fromAmount = '2';
    if (kind === 'changed-recipient') route.toAddress = OTHER;
    expect((await execute(displayed, { wallet })).code).toBe('UNSAFE_BRIDGE_REQUEST');
    expect(mocks.approve).not.toHaveBeenCalled(); expect(signer.sendTransaction).not.toHaveBeenCalled();
  });
  it('rechecks account after review', async () => {
    const result = await execute(route, { wallet, confirmSigning: async () => {
      signer.getAddress.mockResolvedValue(OTHER); return true;
    } });
    expect(result.code).toBe('BRIDGE_ACCOUNT_CHANGED'); expect(mocks.approve).not.toHaveBeenCalled();
  });
  it('rechecks expiry after review', async () => {
    const result = await execute(route, { wallet, confirmSigning: async () => { route.expiresAt = Date.now() - 1; return true; } });
    expect(result.code).toBe('QUOTE_EXPIRED'); expect(mocks.approve).not.toHaveBeenCalled();
  });
  it('does not approve again when sufficient allowance already exists', async () => {
    mocks.allowance.mockResolvedValue(10n ** 18n);
    expect((await execute(route, { wallet })).ok).toBe(true);
    expect(mocks.approve).not.toHaveBeenCalled(); expect(signer.sendTransaction).toHaveBeenCalledOnce();
  });
  it('resets a partial allowance to zero, then approves only the requested amount', async () => {
    mocks.allowance.mockResolvedValue(1n);
    await execute(route, { wallet });
    expect(mocks.approve.mock.calls.map((c) => c[1])).toEqual([0n, 10n ** 18n]);
  });
});
