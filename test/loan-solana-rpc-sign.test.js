/**
 * SOLANA LENDING — «server connection» and «it does not sign», pinned.
 *
 * Both halves of the 2026-09-23 report that are NOT about sentences:
 *
 *   1. «اتصال با سرور مشکل داره» — the market read.
 *      The read walks a candidate list and reports ONE reason. The reason was
 *      computed from a merged regex, so a 403 from one node plus a 429 from
 *      another came out as «rate limited» — the user's report — and the same
 *      node that had just refused us was asked FIRST again on the next screen
 *      refresh. What is pinned here:
 *        · 403/401/451 → RPC_BLOCKED, never RPC_RATE_LIMITED;
 *        · 429 → RPC_RATE_LIMITED;
 *        · a node that refuses drops to the BACK of the candidate list for a
 *          while, and the user's own RPC is never re-ordered behind it.
 *
 *   2. «گاهی اصلا امضا نمی‌کند» — the signature.
 *      A wallet accepts one transaction FORMAT. Android (Mobile Wallet
 *      Adapter) advertises v0 only; the vendored Kamino SDK builds legacy
 *      transactions. The old sign path compared the two and refused BEFORE
 *      opening the wallet, which reached the screen as «nothing happened».
 *      What is pinned here: the bytes handed to a wallet are in a format that
 *      wallet accepts, the conversion preserves payer/blockhash/instructions,
 *      and a conversion that would not be faithful is refused BY NAME.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as web3 from '@solana/web3.js';
import { lendingRpcFailure } from '../src/lib/solanaLending.js';
import {
  solanaRpcCandidates, noteSolanaRpcFailure, clearSolanaRpcCooldown, solanaRpcCooldowns
} from '../src/lib/solanaRpc.js';
import {
  convertTransactionVersion, detectTransactionVersion, payloadForWallet,
  walletAcceptsVersion, preferredTransactionVersions, TX_VERSION
} from '../src/lib/solana/txVersion.js';

/* ── a legacy transaction, exactly the kind klend-sdk v5 hands the panel ──── */
const legacyPayload = () => {
  const payer = web3.Keypair.generate();
  const tx = new web3.Transaction().add(
    web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: web3.Keypair.generate().publicKey, lamports: 1234 }),
    web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 })
  );
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = '11111111111111111111111111111111';
  return {
    payer: payer.publicKey.toBase58(),
    blockhash: tx.recentBlockhash,
    base64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
  };
};

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

describe('the market read names the failure that actually happened', () => {
  it('reports a 403 as a block, not as a rate limit — the report’s case', () => {
    const error = lendingRpcFailure([
      { url: 'https://api.mainnet-beta.solana.com', error: 'failed to get info about account 7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF: Error: 403 : {"jsonrpc":"2.0","error":{}}' },
      { url: 'https://solana-rpc.publicnode.com', error: 'Error: 429 : Too many requests' }
    ]);
    expect(error.code).toBe('RPC_BLOCKED');
    expect(error.detail).toContain('RPC_BLOCKED');
    /* the per-host list the panel renders: host → reason, localized there */
    expect(error.hosts).toEqual([
      { host: 'api.mainnet-beta.solana.com', reason: 'RPC_BLOCKED' },
      { host: 'solana-rpc.publicnode.com', reason: 'RPC_RATE_LIMITED' }
    ]);
  });

  it('reports a throttle as a throttle', () => {
    expect(lendingRpcFailure([{ url: 'https://a.rpc', error: 'Error: 429 : slow down' }]).code).toBe('RPC_RATE_LIMITED');
    expect(lendingRpcFailure([{ url: 'https://a.rpc', error: 'rate limit exceeded' }]).code).toBe('RPC_RATE_LIMITED');
  });

  it('does not read a 403’s body as a rate limit', () => {
    /* A provider block page often contains the words «rate limit» — the old
       regex believed the words and ignored the status. */
    const error = lendingRpcFailure([
      { url: 'https://a.rpc', error: 'Error: 403 : {"error":{"message":"rate limit exceeded for your region"}}' }
    ]);
    expect(error.code).toBe('RPC_BLOCKED');
  });

  it('distinguishes an unreachable network from an unreadable market', () => {
    expect(lendingRpcFailure([
      { url: 'https://a.rpc', error: 'TypeError: Failed to fetch' },
      { url: 'https://b.rpc', error: 'net::ERR_CONNECTION_RESET' }
    ]).code).toBe('RPC_ERROR');
    expect(lendingRpcFailure([{ url: 'https://a.rpc', error: 'market account could not be decoded' }]).code)
      .toBe('KAMINO_MARKET_UNAVAILABLE');
    expect(lendingRpcFailure([]).code).toBe('KAMINO_MARKET_UNAVAILABLE');
  });

  it('does not invent a cause from a slot number in the message', () => {
    /* `\b403\b` used to match a slot/height inside an address-adjacent string.
       The status has to look like a status. */
    const error = lendingRpcFailure([{ url: 'https://a.rpc', error: 'block 403884920 produced no result' }]);
    expect(error.code).toBe('KAMINO_MARKET_UNAVAILABLE');
  });
});

describe('a node that refused us is not asked first next time', () => {
  /* The cooldown map is module state — and the funnel above feeds it, so each
     test starts from the configured order. */
  beforeEach(() => clearSolanaRpcCooldown());
  afterEach(() => clearSolanaRpcCooldown());

  it('moves a refused host to the back, and keeps the user’s own RPC in front', () => {
    const before = solanaRpcCandidates({ cluster: 'mainnet-beta' });
    expect(before.length).toBeGreaterThan(1);
    expect(new URL(before[0]).hostname).not.toContain('api.mainnet-beta.solana.com');

    noteSolanaRpcFailure(before[0], 'BLOCKED', { status: 403 });
    const after = solanaRpcCandidates({ cluster: 'mainnet-beta' });
    expect(after[0]).toBe(before[1]);
    expect(after[after.length - 1]).toBe(before[0]);
    expect(solanaRpcCooldowns().map((row) => row.url)).toContain(before[0]);

    /* A custom RPC is a deliberate choice: it stays first even when it 403s. */
    const custom = 'https://my-own-rpc.example.com';
    clearSolanaRpcCooldown();
    noteSolanaRpcFailure(custom, 'BLOCKED', { status: 403 });
    expect(solanaRpcCandidates({ cluster: 'mainnet-beta', custom })[0]).toBe(custom);
  });

  it('cools a throttle for minutes, not forever, and comes back by itself', () => {
    const [first] = solanaRpcCandidates({ cluster: 'mainnet-beta' });
    const until = noteSolanaRpcFailure(first, 'RATE_LIMITED', { status: 429 });
    expect(until).toBeGreaterThan(Date.now());
    expect(solanaRpcCandidates({ cluster: 'mainnet-beta' })[0]).not.toBe(first);
    clearSolanaRpcCooldown(first);
    expect(solanaRpcCandidates({ cluster: 'mainnet-beta' })[0]).toBe(first);
  });

  it('ignores failures that say nothing about the host', () => {
    expect(noteSolanaRpcFailure('https://a.rpc', 'RPC_ERROR')).toBe(null);
    expect(noteSolanaRpcFailure('https://a.rpc', 'HTTP_500', { status: 500 })).toBe(null);
  });
});

describe('the wallet is handed a transaction it can sign', () => {
  it('converts a legacy transaction into v0 for a v0-only wallet — the Android case', async () => {
    const { base64, payer, blockhash } = legacyPayload();
    expect(detectTransactionVersion(base64)).toBe(TX_VERSION.LEGACY);

    const forAndroid = await payloadForWallet(base64, [0], TX_VERSION.LEGACY);
    expect(forAndroid.converted).toBe(true);
    const convertedBase64 = b64(forAndroid.payload);
    expect(detectTransactionVersion(convertedBase64)).toBe(TX_VERSION.V0);

    const decoded = web3.VersionedTransaction.deserialize(Buffer.from(convertedBase64, 'base64'));
    expect(decoded.message.version).toBe(0);
    expect(decoded.message.compiledInstructions).toHaveLength(2);
    expect(decoded.message.staticAccountKeys[0].toBase58()).toBe(payer);
    expect(decoded.message.recentBlockhash).toBe(blockhash);
  });

  it('hands the built bytes over untouched when the wallet accepts them', async () => {
    const { base64 } = legacyPayload();
    const legacyWallet = await payloadForWallet(base64, ['legacy'], TX_VERSION.LEGACY);
    expect(legacyWallet.converted).toBe(false);
    expect(b64(legacyWallet.payload)).toBe(base64);

    /* no published constraint → no conversion, whatever the wallet is */
    const silent = await payloadForWallet(base64, undefined, TX_VERSION.LEGACY);
    expect(silent.converted).toBe(false);
    expect(b64(silent.payload)).toBe(base64);
  });

  it('round-trips v0 → legacy without losing the message', async () => {
    const { base64, payer, blockhash } = legacyPayload();
    const v0 = await convertTransactionVersion(base64, TX_VERSION.V0);
    const back = await convertTransactionVersion(v0, TX_VERSION.LEGACY);
    expect(detectTransactionVersion(back)).toBe(TX_VERSION.LEGACY);
    const tx = web3.Transaction.from(Buffer.from(back, 'base64'));
    expect(tx.instructions).toHaveLength(2);
    expect(tx.feePayer.toBase58()).toBe(payer);
    expect(tx.recentBlockhash).toBe(blockhash);
    /* ...and it is idempotent, so a retry cannot convert twice. */
    expect(await convertTransactionVersion(v0, TX_VERSION.V0)).toBe(v0);
  });

  it('refuses a conversion it cannot make faithfully, by name', async () => {
    const { base64 } = legacyPayload();
    /* A truncated/corrupt payload is not guessed at. */
    await expect(convertTransactionVersion('AAAA', TX_VERSION.V0)).rejects.toThrow('UNSUPPORTED_TRANSACTION');
    /* An unknown target is not silently ignored either. */
    await expect(convertTransactionVersion(base64, 'v9')).rejects.toThrow('UNSUPPORTED_TRANSACTION');
  });

  it('reads the wallet’s version list the way the wallet writes it', () => {
    expect(walletAcceptsVersion([0], 0)).toBe(true);
    expect(walletAcceptsVersion([0], 'legacy')).toBe(false);
    expect(walletAcceptsVersion(['legacy'], 0)).toBe(false);
    expect(walletAcceptsVersion(['legacy', 0], 'legacy')).toBe(true);
    expect(walletAcceptsVersion([], 'legacy')).toBe(true);
    expect(walletAcceptsVersion(undefined, 0)).toBe(true);

    expect(preferredTransactionVersions([0], TX_VERSION.LEGACY)).toEqual([0]);
    expect(preferredTransactionVersions(['legacy'], TX_VERSION.LEGACY)).toEqual(['legacy', 0]);
    expect(preferredTransactionVersions(undefined, TX_VERSION.LEGACY)).toEqual(['legacy']);
  });
});
