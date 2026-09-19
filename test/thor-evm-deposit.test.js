/**
 * THE IN-SITE THORCHAIN SIGNING PATH — unit suite.
 * ---------------------------------------------------------------------------
 * executeThorEvmDeposit is the function that turns "the customer just signs
 * on our site" into bytes on a chain, so its suite pins:
 *
 *   - the pure helpers (chain map, token parsing, BigInt unit conversion,
 *     memo receiver matching, THORNode status normalisation) with known
 *     answers, including the precision traps (floats past 2^53, 7 decimals
 *     on a 6-decimal token);
 *   - the money path against a fake ethers Contract + fake signer: what is
 *     validated BEFORE the wallet is touched, what value the native deposit
 *     carries, that a token deposit approves the exact amount to the router
 *     and nothing more, that ONE review fires before the first signature,
 *     and that every refusal code really refuses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A fake ethers, hoisted like the app's other test boundaries. Contracts are
 * recorded so assertions can read what was encoded and approved; calldata is
 * valid lowercase hex so the REAL validateBridgeRequest (imported by the
 * module under test, not mocked) judges it honestly. `allowanceValue` seeds
 * every fresh Contract's allowance() — the "already approved" case needs the
 * value in place BEFORE the contract is constructed inside the call.
 */
const fakeEth = vi.hoisted(() => ({ instances: [], allowanceValue: 0n }));
vi.mock('ethers', () => ({
  Contract: class {
    constructor(address, abi, runner) {
      this.address = address;
      this.runner = runner;
      this.encodeCalls = [];
      this.interface = {
        encodeFunctionData: (fn, args) => {
          this.encodeCalls.push({ fn, args });
          return '0x' + '0c'.repeat(72);
        }
      };
      this.allowance = vi.fn(async () => fakeEth.allowanceValue);
      this.decimals = vi.fn(async () => 6);
      this.approve = vi.fn(async () => ({ wait: vi.fn(async () => ({})) }));
      fakeEth.instances.push(this);
    }
  }
}));

import {
  executeThorEvmDeposit,
  memoReceiverMatches,
  normalizeThorTxStatus,
  thorEvmChainId,
  thorEvmToken,
  toEvmBaseUnits
} from '../src/lib/thorEvmDeposit';

const SENDER = '0x3456789012345678901234567890123456789012';
const ROUTER = '0x1111111111111111111111111111111111111111';
const VAULT = '0x2222222222222222222222222222222222222222';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const BTC_DEST = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
const TX_HASH = '0x' + 'ab'.repeat(32);

const makeSigner = (chainId) => ({
  getAddress: async () => SENDER,
  provider: {
    getNetwork: async () => ({ chainId }),
    getCode: async () => '0x6080604052'
  },
  sendTransaction: vi.fn(async () => ({ hash: TX_HASH }))
});

const readyQuote = () => ({
  inbound_address: VAULT,
  router: ROUTER,
  memo: `=:BTC.BTC:${BTC_DEST}:1000`,
  expiry: Math.floor(Date.now() / 1000) + 600
});

const makeWallet = (chainId, signer) => ({
  address: SENDER,
  chainId,
  getSigner: () => signer,
  switchChain: vi.fn(async () => true)
});

const routerInstance = () => fakeEth.instances.find((c) => c.address === ROUTER);
const tokenInstance = () => fakeEth.instances.find((c) => c.address === USDC.toLowerCase());

beforeEach(() => {
  fakeEth.instances.length = 0;
  fakeEth.allowanceValue = 0n;
});

describe('pure helpers', () => {
  it('maps THORChain EVM chains to chainIds and everything else to null', () => {
    expect(thorEvmChainId('ETH.ETH')).toBe(1);
    expect(thorEvmChainId('BSC.BNB')).toBe(56);
    expect(thorEvmChainId('AVAX.AVAX')).toBe(43114);
    expect(thorEvmChainId('BASE.USDC-0X833589FCD6EDB6E08F4C7C32D4F71B54BDA02913')).toBe(8453);
    /* Bitcoin-family and Cosmos sources can never be signed by an EVM wallet. */
    expect(thorEvmChainId('BTC.BTC')).toBeNull();
    expect(thorEvmChainId('LTC.LTC')).toBeNull();
    expect(thorEvmChainId('GAIA.ATOM')).toBeNull();
    expect(thorEvmChainId(null)).toBeNull();
  });

  it('extracts the token contract and treats the native coin as value, not a token', () => {
    expect(thorEvmToken('ETH.ETH')).toBeNull();
    expect(thorEvmToken('BTC.BTC')).toBeNull();
    expect(thorEvmToken(`ETH.USDC-0x${USDC.slice(2)}`)).toBe(USDC);
    /* Uppercase long-form (THORChain's canonical shape, uppercase 0X
       included) is accepted and LOWERCASED — the form every downstream
       address check is defined on. */
    expect(thorEvmToken('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48')).toBe(USDC);
    expect(thorEvmToken('ETH.USDT-GARBAGE')).toBeNull();
  });

  it('converts decimal amounts to base units as exact BigInts', () => {
    expect(toEvmBaseUnits('0.01', 18)).toBe(10n ** 16n);
    expect(toEvmBaseUnits('1.5', 6)).toBe(1500000n);
    expect(toEvmBaseUnits('123', 0)).toBe(123n);
    /* More precision than the asset has is rejected, not rounded. */
    expect(toEvmBaseUnits('0.0000001', 6)).toBeNull();
    expect(toEvmBaseUnits('0', 18)).toBeNull();
    expect(toEvmBaseUnits('', 18)).toBeNull();
    expect(toEvmBaseUnits('abc', 18)).toBeNull();
    expect(toEvmBaseUnits('1e5', 18)).toBeNull();
    expect(toEvmBaseUnits('-1', 18)).toBeNull();
  });

  it('checks the memo receiver against the destination the same way thorDepositState does', () => {
    expect(memoReceiverMatches('=:BTC.BTC:bc1qxyz', 'bc1qxyz', 'BTC.BTC')).toBe(true);
    expect(memoReceiverMatches(`=:BTC.BTC:${BTC_DEST}`, BTC_DEST, 'BTC.BTC')).toBe(true);
    /* EVM receivers compare case-insensitively. */
    expect(memoReceiverMatches('=:ETH.ETH:0xABC', '0xabc', 'ETH.ETH')).toBe(true);
    /* A memo paying anyone else is a refusal, not a detail. */
    expect(memoReceiverMatches('=:BTC.BTC:bc1qother', BTC_DEST, 'BTC.BTC')).toBe(false);
    expect(memoReceiverMatches(`=:BTC.BTC:${BTC_DEST}:1000`, BTC_DEST, 'BTC.BTC')).toBe(true);
    expect(memoReceiverMatches(`s:BTC.BTC:${BTC_DEST}`, BTC_DEST, 'BTC.BTC')).toBe(true);
    expect(memoReceiverMatches(`SWAP:BTC.BTC:${BTC_DEST}`, BTC_DEST, 'BTC.BTC')).toBe(true);
    expect(memoReceiverMatches(`refund:BTC.BTC:${BTC_DEST}`, BTC_DEST, 'BTC.BTC')).toBe(false);
    expect(memoReceiverMatches('', BTC_DEST, 'BTC.BTC')).toBe(false);
  });

  it('normalises every THORNode status shape it can meet', () => {
    const none = normalizeThorTxStatus(null);
    expect(none.delivered).toBe(false);
    expect(none.pending).toBe('seen');
    expect(none.stages.map((s) => s.key)).toEqual([
      'inbound_observed', 'inbound_finalised', 'swap_finalised', 'outbound_signed'
    ]);

    const partial = normalizeThorTxStatus({
      stages: { inbound_observed: { completed: true }, inbound_finalised: { completed: false } }
    });
    expect(partial.pending).toBe('confirmed');

    const complete = normalizeThorTxStatus({
      stages: {
        inbound_observed: { completed: true },
        inbound_finalised: { completed: true },
        swap_finalised: { completed: true },
        outbound_signed: { completed: true }
      }
    });
    expect(complete.delivered).toBe(true);
    expect(complete.pending).toBeNull();

    /* A future node that answers with status strings still reads correctly. */
    const stringly = normalizeThorTxStatus({
      stages: { inbound_observed: { status: 'success' }, outbound_signed: { status: 'pending' } }
    });
    expect(stringly.stages[0].completed).toBe(true);
    expect(stringly.delivered).toBe(false);
  });
});

describe('executeThorEvmDeposit — the money path', () => {
  it('sends a native-coin deposit with value = the quoted amount and no approval', async () => {
    const signer = makeSigner(1);
    const onStep = vi.fn();
    const q = readyQuote();
    const res = await executeThorEvmDeposit({
      wallet: makeWallet(1, signer),
      quote: q,
      from: 'ETH.ETH',
      to: 'BTC.BTC',
      amount: '0.01',
      destination: BTC_DEST,
      confirmSigning: vi.fn(async () => true),
      onStep
    });

    expect(res.hash).toBe(TX_HASH);
    expect(res.chainId).toBe(1);

    /* The router was called with depositWithExpiry: vault, 0x0 asset, the
       exact 1e18-scaled amount, THORChain's own memo, THORChain's expiry. */
    const enc = routerInstance().encodeCalls;
    expect(enc).toHaveLength(1);
    expect(enc[0].fn).toBe('depositWithExpiry');
    expect(enc[0].args[0]).toBe(VAULT);
    expect(enc[0].args[1]).toBe('0x0000000000000000000000000000000000000000');
    expect(enc[0].args[2]).toBe(10n ** 16n);
    expect(enc[0].args[4]).toBe(BigInt(q.expiry));

    /* The native coin travels in value, and the signer saw exactly the
       validated transaction. */
    const sent = signer.sendTransaction.mock.calls[0][0];
    expect(sent.to).toBe(ROUTER);
    expect(sent.value).toBe(10n ** 16n);
    expect(sent.chainId).toBe(1);
    expect(onStep).toHaveBeenCalledWith('deposit');
    /* Native coin: no allowance step exists at all. */
    expect(onStep).not.toHaveBeenCalledWith('allowance');
  });

  it('approves the EXACT amount to the router after ONE review, then deposits the token', async () => {
    const signer = makeSigner(1);
    const confirmSigning = vi.fn(async () => true);
    await executeThorEvmDeposit({
      wallet: makeWallet(1, signer),
      quote: readyQuote(),
      from: `ETH.USDC-0x${USDC.slice(2)}`,
      to: 'BTC.BTC',
      amount: '12.5',
      destination: BTC_DEST,
      confirmSigning,
      onStep: vi.fn()
    });

    const token = fakeEth.instances.find(
      (c) => c.address.toLowerCase() === USDC
    );
    expect(token.decimals).toHaveBeenCalled();
    /* 12.5 USDC at 6 decimals — exact, never more. */
    expect(token.approve).toHaveBeenCalledWith(ROUTER, 12500000n, { chainId: 1 });
    expect(confirmSigning).toHaveBeenCalledTimes(1);
    /* The review names the router as spender before any signature. */
    expect(confirmSigning.mock.calls[0][0].spender).toBe(ROUTER);
    expect(confirmSigning.mock.calls[0][0].token).toBe(USDC);
    /* Token deposit carries no value — the coins move via the approval. */
    expect(signer.sendTransaction.mock.calls[0][0].value).toBe(0n);
  });

  it('skips the approval entirely when the existing allowance already covers the amount', async () => {
    /* 10 USDC of standing allowance: a deposit of 5 must not re-approve and
       must not open a review — there is nothing left to agree to. */
    fakeEth.allowanceValue = 10n * 10n ** 6n;
    const signer = makeSigner(1);
    const confirmSigning = vi.fn(async () => true);
    await executeThorEvmDeposit({
      wallet: makeWallet(1, signer),
      quote: readyQuote(),
      from: `ETH.USDC-0x${USDC.slice(2)}`,
      to: 'BTC.BTC',
      amount: '5',
      destination: BTC_DEST,
      confirmSigning,
      onStep: vi.fn()
    });
    const token = fakeEth.instances.find((c) => c.address.toLowerCase() === USDC);
    expect(token.approve).not.toHaveBeenCalled();
    expect(confirmSigning).not.toHaveBeenCalled();
    /* The deposit itself still went out, signed. */
    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it('refuses every malformed or hostile input BEFORE the wallet is touched', async () => {
    const signer = makeSigner(1);
    const wallet = makeWallet(1, signer);

    /* Non-EVM source: no EVM wallet can ever sign a UTXO spend. */
    await expect(executeThorEvmDeposit({
      wallet, quote: readyQuote(), from: 'BTC.BTC', to: 'ETH.ETH',
      amount: '0.01', destination: '0xabc'
    })).rejects.toThrow('NOT_EVM_SOURCE');

    /* router === vault: a malformed or hostile quote. */
    await expect(executeThorEvmDeposit({
      wallet, quote: { ...readyQuote(), inbound_address: ROUTER },
      from: 'ETH.ETH', to: 'BTC.BTC', amount: '0.01', destination: BTC_DEST
    })).rejects.toThrow('BAD_DEPOSIT_TARGET');

    /* The memo pays someone else: refuse, never send. */
    await expect(executeThorEvmDeposit({
      wallet, quote: { ...readyQuote(), memo: '=:BTC.BTC:bc1qsomeoneelse:1000' },
      from: 'ETH.ETH', to: 'BTC.BTC', amount: '0.01', destination: BTC_DEST
    })).rejects.toThrow('MEMO_MISMATCH');

    /* Too close to expiry: an approval could outlive the quote. */
    await expect(executeThorEvmDeposit({
      wallet, quote: { ...readyQuote(), expiry: Math.floor(Date.now() / 1000) + 60 },
      from: 'ETH.ETH', to: 'BTC.BTC', amount: '0.01', destination: BTC_DEST
    })).rejects.toThrow('EXPIRING');

    /* No router in the quote: nothing safe to build. */
    await expect(executeThorEvmDeposit({
      wallet, quote: { ...readyQuote(), router: null },
      from: 'ETH.ETH', to: 'BTC.BTC', amount: '0.01', destination: BTC_DEST
    })).rejects.toThrow('BAD_DEPOSIT_TARGET');

    /* Nothing was signed by any of the refusals above. */
    expect(signer.sendTransaction).not.toHaveBeenCalled();
  });

  it('maps a rejected review to USER_REJECTED with nothing signed', async () => {
    const signer = makeSigner(1);
    await expect(executeThorEvmDeposit({
      wallet: makeWallet(1, signer),
      quote: readyQuote(),
      from: `ETH.USDC-0x${USDC.slice(2)}`,
      to: 'BTC.BTC',
      amount: '1',
      destination: BTC_DEST,
      confirmSigning: vi.fn(async () => false)
    })).rejects.toThrow('USER_REJECTED');
    expect(signer.sendTransaction).not.toHaveBeenCalled();
  });

  it('switches networks when the wallet sits on the wrong chain, and refuses when it will not', async () => {
    /* The wallet's React state still says 56, but the signer has followed the
       switch — the honest post-switch condition. */
    const signer = makeSigner(1);
    const wallet = makeWallet(56, signer);
    await executeThorEvmDeposit({
      wallet,
      quote: readyQuote(),
      from: 'ETH.ETH',
      to: 'BTC.BTC',
      amount: '0.01',
      destination: BTC_DEST
    });
    expect(wallet.switchChain).toHaveBeenCalledWith(1);
    expect(signer.sendTransaction).toHaveBeenCalledTimes(1);

    /* switchChain says no and the chain never moved: refuse before signing. */
    const stuck = { ...makeWallet(56, makeSigner(56)), switchChain: vi.fn(async () => false) };
    await expect(executeThorEvmDeposit({
      wallet: stuck,
      quote: readyQuote(),
      from: 'ETH.ETH',
      to: 'BTC.BTC',
      amount: '0.01',
      destination: BTC_DEST
    })).rejects.toThrow('WRONG_NETWORK');
  });
});
