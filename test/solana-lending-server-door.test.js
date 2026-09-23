/**
 * THE SERVER DOOR FOR THE SOLANA LOAN — the part that runs where the public
 * nodes answer.
 *
 * Report 2026-09-23 (third round): «در وام تب سولنا بهم خورده دوباره» — every
 * candidate the browser tried refused (403/429/unreachable), our own relay
 * answered «no Solana node answered this relay», and the panel showed nine dead
 * hosts. The call that dies on free tiers is the reserve enumeration:
 * `getProgramAccounts(KLend, …)` over ~130 accounts of 8 624 bytes is a ~1.6 MB
 * answer, and a size policy is a refusal no client-side ordering can fix.
 *
 * What is pinned here, without a single mainnet call:
 *
 *   1. the enumeration asks for PUBKEYS ONLY (`dataSlice { offset:0, length:0 }`)
 *      with exactly the filters the SDK uses — the shape a size-limited node
 *      serves — and the account data arrives in chunks of ≤25 through
 *      `getMultipleAccounts`, the method nothing refuses;
 *   2. the pubkey list is REMEMBERED (memory, then a file), so a network where
 *      even the sliced call is refused still loads the market on the next try;
 *   3. a reserve that reads back null, will not decode, or has no oracle is
 *      SKIPPED AND COUNTED — a partial market is labelled, never dressed as a
 *      complete one (§28), and never collapses into «market unavailable»;
 *   4. the wallet's spendable balances fall back from the parsed read to a
 *      hand-decoded raw one, because free tiers serve the second and refuse the
 *      first, and native SOL is counted for the wSOL reserve;
 *   5. a transaction build refuses bad input BEFORE it spends anything — no SDK
 *      load, no upstream call — and never signs or broadcasts (§30).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  reservePubkeys,
  loadMarketViaSlicedReserves,
  readKaminoBalances,
  buildKaminoTransaction,
  resetSolanaLendingServer,
  lendingUpstreams
} from '../server/solanaLending.js';
import { WSOL_MINT, SOLANA_LENDING_CHAIN_ID } from '../src/lib/solanaLending.js';

/** A pubkey stub: the SDK only ever asks these two things of one. */
const pk = (base58) => ({ base58, toBase58: () => base58, toString: () => base58 });

/** Real, valid base58 addresses — `getMultipleAccountsInfo` is handed
    `PublicKey` instances, and a fake string is a test bug, not a code path. */
const syntheticReserves = (count) => Array.from({ length: count }, (_, i) => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(i + 1, 0);
  Buffer.from('kamino-reserve-test').copy(bytes, 8);
  return new PublicKey(bytes).toBase58();
});

/** The reserve-account filters klend-sdk's own `getReservesForMarket` sends. */
const MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
const SPAN = 8616;

/** A stub SDK shaped like the parts of klend-sdk this module touches. */
function stubSdk({ reserves = 3, oraclesMissing = 0, undecodable = 0 } = {}) {
  const calls = { loadWithReserves: [], initialize: [] };
  const addresses = syntheticReserves(reserves).map((address) => pk(address));
  return {
    calls,
    addresses,
    Reserve: { layout: { span: SPAN }, decode: (data) => (data?.undecodable ? null : { config: { tokenInfo: { name: 'x' } } }) },
    LendingMarket: { fetch: async () => ({ version: 0, elevationGroups: [] }) },
    /* The last `oraclesMissing` of whatever was actually decoded come back
       without a price — the count must follow the decoded list, not the pubkey
       list, or a test that also drops accounts cannot see it. */
    getTokenOracleData: async (_connection, states) => states.map((state, i) => [
      state,
      oraclesMissing > 0 && i >= states.length - oraclesMissing ? undefined : { price: 1 }
    ]),
    KaminoReserve: {
      initialize: (info, pubkey, state, oracle, connection, slotDurationMs) => {
        calls.initialize.push({ pubkey, hasInfo: Boolean(info), hasOracle: Boolean(oracle), slotDurationMs });
        return { address: pubkey, state, oracle, connection };
      }
    },
    PubkeyHashMap: class extends Map {},
    KaminoMarket: {
      loadWithReserves: (connection, market, reservesMap, marketAddress, slotDurationMs, programId) => {
        calls.loadWithReserves.push({ marketAddress, size: reservesMap.size, slotDurationMs, programId: String(programId) });
        return { connection, market, reserves: reservesMap, getReserves: () => [...reservesMap.values()] };
      }
    }
  };
}

/** A connection stub that records every call it is asked for. */
function stubConnection({
  pubkeys = [], refuseGpa = false, ignoreDataSlice = false, accounts = null,
  refuseParsed = false, rawAccounts = null, refuseRaw = false,
  balanceLamports = 0, refuseBalance = false
} = {}) {
  const calls = { gpa: [], multiple: [], parsed: [], raw: [], balance: 0 };
  const list = pubkeys.length ? pubkeys : syntheticReserves(3).map((address) => pk(address));
  return {
    calls,
    list,
    async getProgramAccounts(_programId, config = {}) {
      calls.gpa.push(config);
      if (refuseGpa) throw new Error('403 : {"error":"Request blocked"}');
      /* A node that ignores dataSlice answers the full shape; the module must
         accept either. */
      const sliced = Boolean(config.dataSlice) && !ignoreDataSlice;
      return list.map((pubkey) => (sliced
        ? { pubkey, account: { data: Buffer.alloc(0) } }
        : { pubkey, account: { data: Buffer.alloc(SPAN + 8) } }));
    },
    async getMultipleAccountsInfo(keys) {
      calls.multiple.push(keys.length);
      return keys.map((key, i) => {
        const custom = accounts?.[String(key.toBase58?.() || key)];
        if (custom === null) return null;
        if (custom) return custom;
        /* Every third account is gone: a closed reserve must be skipped, not
           turned into a failed market. */
        return i % 3 === 2 ? null : { data: Buffer.alloc(SPAN + 8), lamports: 1, owner: pk('KLend') };
      });
    },
    async getParsedTokenAccountsByOwner() {
      calls.parsed.push(1);
      if (refuseParsed) throw new Error('-32602 Request blocked');
      return { value: [] };
    },
    async getTokenAccountsByOwner() {
      calls.raw.push(1);
      if (refuseRaw) throw new Error('403 : blocked');
      return { value: rawAccounts || [] };
    },
    async getBalance() {
      calls.balance += 1;
      if (refuseBalance) throw new Error('429 : Too Many Requests');
      return balanceLamports;
    }
  };
}

const listFile = () => path.join(os.tmpdir(), `fbt-kamino-reserves-mainnet-beta-${MARKET}.json`);

beforeEach(() => {
  resetSolanaLendingServer();
  try { fs.rmSync(listFile(), { force: true }); } catch { /* nothing to clean */ }
});

afterEach(() => {
  resetSolanaLendingServer();
  try { fs.rmSync(listFile(), { force: true }); } catch { /* nothing to clean */ }
  vi.restoreAllMocks();
});

describe('reserve enumeration — the call free nodes refuse, routed around', () => {
  it('asks for pubkeys only, with the SDK\'s own filters', async () => {
    const sdk = stubSdk();
    const connection = stubConnection();
    const pubkeys = await reservePubkeys({
      sdk, connection, programId: pk('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'), marketPk: pk(MARKET)
    });

    expect(pubkeys).toHaveLength(3);
    expect(connection.calls.gpa).toHaveLength(1);
    const config = connection.calls.gpa[0];
    /* dataSlice { offset:0, length:0 } is the whole trick: same filters, no
       account bytes, so a ~1.6 MB answer becomes ~20 KB. */
    expect(config.dataSlice).toEqual({ offset: 0, length: 0 });
    expect(config.filters[0]).toEqual({ dataSize: SPAN + 8 });
    expect(config.filters[1]).toEqual({ memcmp: { offset: 32, bytes: MARKET } });
  });

  it('remembers the list: a second call makes no RPC at all', async () => {
    const sdk = stubSdk();
    const connection = stubConnection();
    const args = { sdk, connection, programId: pk('KLend'), marketPk: pk(MARKET) };
    await reservePubkeys(args);
    await reservePubkeys(args);
    expect(connection.calls.gpa).toHaveLength(1);
  });

  it('persists the list, and a later refusal falls back to it', async () => {
    const sdk = stubSdk();
    const warm = stubConnection();
    await reservePubkeys({ sdk, connection: warm, programId: pk('KLend'), marketPk: pk(MARKET) });
    expect(fs.existsSync(listFile())).toBe(true);

    /* A fresh instance (memory cleared, as a serverless cold start is) on a
       network where even the sliced enumeration is refused: the persisted list
       is what stands between this and «market unavailable». */
    resetSolanaLendingServer();
    const cold = stubConnection({ pubkeys: warm.list, refuseGpa: true });
    const pubkeys = await reservePubkeys({ sdk, connection: cold, programId: pk('KLend'), marketPk: pk(MARKET) });
    expect(pubkeys).toHaveLength(3);
    expect(cold.calls.multiple).toHaveLength(0);
  });

  it('names the failure when there is no list anywhere', async () => {
    const sdk = stubSdk();
    const connection = stubConnection({ refuseGpa: true });
    await expect(reservePubkeys({ sdk, connection, programId: pk('KLend'), marketPk: pk(MARKET) }))
      .rejects.toMatchObject({ code: 'KAMINO_RESERVE_LIST_UNAVAILABLE' });
  });
});

describe('the sliced market load', () => {
  it('chunks the account data and rebuilds the SDK\'s own market object', async () => {
    const sdk = stubSdk({ reserves: 60 });
    const connection = stubConnection({ pubkeys: sdk.addresses });
    const loaded = await loadMarketViaSlicedReserves({
      sdk, connection, marketPk: pk(MARKET), programId: pk('KLend'), slotDurationMs: 450
    });

    /* 60 reserves at 25 per chunk — never one 1.6 MB response. */
    expect(connection.calls.multiple).toEqual([25, 25, 10]);
    expect(connection.calls.multiple.every((n) => n <= 25)).toBe(true);
    expect(sdk.calls.loadWithReserves).toHaveLength(1);
    expect(sdk.calls.loadWithReserves[0].marketAddress).toBe(MARKET);
    expect(loaded.mode).toBe('sliced');
    expect(loaded.reserves).toBeGreaterThan(0);
  });

  it('skips reserves that vanished or have no oracle, and counts them', async () => {
    const sdk = stubSdk({ reserves: 9, oraclesMissing: 2 });
    const connection = stubConnection({ pubkeys: sdk.addresses });
    const loaded = await loadMarketViaSlicedReserves({
      sdk, connection, marketPk: pk(MARKET), programId: pk('KLend'), slotDurationMs: 450
    });
    /* Every third account reads back null in the stub: skipped, not fatal. */
    expect(loaded.reserves).toBeLessThan(9);
    expect(loaded.missingOracles).toBeGreaterThanOrEqual(2);
    expect(loaded.market.getReserves().length).toBe(loaded.reserves);
  });

  it('refuses to invent a market when nothing decodes', async () => {
    const sdk = stubSdk({ reserves: 3 });
    const connection = stubConnection({
      pubkeys: sdk.addresses,
      accounts: Object.fromEntries(sdk.addresses.map((a) => [a.base58, null]))
    });
    await expect(loadMarketViaSlicedReserves({
      sdk, connection, marketPk: pk(MARKET), programId: pk('KLend'), slotDurationMs: 450
    })).rejects.toMatchObject({ code: 'KAMINO_RESERVES_EMPTY' });
  });
});

describe('spendable balances, server side', () => {
  const assets = [
    { id: 'sol', address: WSOL_MINT, decimals: 9 },
    { id: 'usdc', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 }
  ];

  /** A raw SPL token account: mint(32) owner(32) amount(u64 LE at 64). */
  function tokenAccount(mintBase58, amount) {
    const data = Buffer.alloc(165);
    new PublicKey(mintBase58).toBuffer().copy(data, 0);
    data.writeBigUInt64LE(BigInt(amount), 64);
    return { account: { data: [data.toString('base64'), 'base64'] } };
  }

  it('falls back to the raw read and decodes it by hand', async () => {
    const connection = stubConnection({
      refuseParsed: true,
      rawAccounts: [tokenAccount(assets[1].address, 12_340_000)],
      balanceLamports: 2_500_000_000
    });

    const balances = await readKaminoBalances({ connection, wallet: '11111111111111111111111111111111', assets });
    expect(connection.calls.parsed).toHaveLength(1);
    expect(connection.calls.raw).toHaveLength(1);
    expect(balances.usdc).toBe('12340000');
    /* Native SOL is what a SOL deposit spends, so the wSOL reserve carries it. */
    expect(balances.sol).toBe('2500000000');
  });

  it('answers {} — never zeros — when both reads are refused', async () => {
    const connection = stubConnection({ refuseParsed: true, refuseRaw: true, refuseBalance: true });
    const balances = await readKaminoBalances({ connection, wallet: '11111111111111111111111111111111', assets });
    expect(balances).toEqual({});
  });
});

describe('transaction build — refusals before anything is spent', () => {
  it('refuses an unknown action, a bad wallet and a bad amount without loading the SDK', async () => {
    const spy = vi.spyOn(await import('../server/solanaLending.js'), 'loadKlendSdk');
    expect(await buildKaminoTransaction({ action: 'moon', mint: 'x', amount: '1', decimals: 6, wallet: '11111111111111111111111111111111' }))
      .toMatchObject({ ok: false, code: 'UNKNOWN_ACTION' });
    expect(await buildKaminoTransaction({ action: 'supply', mint: 'x', amount: '1', decimals: 6, wallet: 'not-an-address' }))
      .toMatchObject({ ok: false, code: 'SOLANA_WALLET_REQUIRED' });
    expect(await buildKaminoTransaction({ action: 'supply', mint: '', amount: '1', decimals: 6, wallet: '11111111111111111111111111111111' }))
      .toMatchObject({ ok: false, code: 'SOLANA_ASSET_REQUIRED' });
    expect(await buildKaminoTransaction({ action: 'supply', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: '0', decimals: 6, wallet: '11111111111111111111111111111111' }))
      .toMatchObject({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(await buildKaminoTransaction({ action: 'supply', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: '1.1234567', decimals: 6, wallet: '11111111111111111111111111111111' }))
      .toMatchObject({ ok: false, code: 'AMOUNT_REQUIRED' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('carries the chain id and never claims to sign or broadcast', async () => {
    expect(SOLANA_LENDING_CHAIN_ID).toBe(900001);
    const source = fs.readFileSync(path.resolve('server/solanaLending.js'), 'utf8');
    /* §30: the wallet signs and sends. If a future edit teaches this module to
       broadcast, this assertion is the one that fails. */
    expect(source).not.toMatch(/sendTransaction\s*\(|sendRawTransaction\s*\(|signTransaction\s*\(/);
    expect(lendingUpstreams('mainnet-beta').length).toBeGreaterThan(3);
  });
});
