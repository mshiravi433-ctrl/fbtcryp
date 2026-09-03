#!/usr/bin/env node
/**
 * VELOCITY REFERRER SETUP — create FBT's own on-chain referral identity.
 * ---------------------------------------------------------------------------

 * Velocity's referral programme pays the referrer a share of the referred
 * user's taker fees (Standard tier: 10% — the referred user even gets a 5%
 * fee discount; Accelerated tier: 20%, needs the Velocity team's approval).
 * A wallet only becomes a referrer when the accounts below exist on chain:
 *
 *   1. `UserStats`  (PDA ["user_stats", authority]) — one per authority; a
 *      user's `initialize_user` with a referrer REQUIRES the referrer's
 *      UserStats to exist, which is exactly why src/lib/velocityTrade.js only
 *      attaches FBT after checking this account over RPC (fbtReferrerInfo).
 *   2. `User` sub-account 0 — created in the same initialize tx as UserStats
 *      when missing (initializeUserAccount does both).
 *   3. `RevenueShare` (PDA ["revenue_share", authority]) — the per-authority
 *      account that ACCUMULATES referrer/builder fee share; without it the
 *      authority cannot earn revenue share at all.
 *
 * After running, set the printed authority as `VELOCITY_REFERRER` (server) and
 * `VITE_VELOCITY_REFERRER` (build) — see .env.example. The referral itself is
 * recorded in each user's FIRST initialize_user only: a wallet that already
 * has a Velocity account can never be referred, and this script never tries.
 *
 * USAGE (the keypair is read from a path and NEVER committed):
 *
 *   VELOCITY_KEYPAIR_PATH=/abs/path/fbt-velocity.json \
 *   SOLANA_RPC_URL=https://your-rpc.example/… \
 *   node scripts/velocity-referrer-setup.mjs
 *
 * The keypair file is the standard Solana CLI JSON ([12,34,…] 64 bytes).
 * A path inside this repository is refused outright so the secret cannot be
 * committed by accident.
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ── inputs ──────────────────────────────────────────────────────────────── */
const keypairPath = process.env.VELOCITY_KEYPAIR_PATH;
if (!keypairPath) {
  console.error('✗ VELOCITY_KEYPAIR_PATH is not set — pass the path to the FBT Solana keypair JSON file.');
  process.exit(1);
}
const absKeypair = resolve(keypairPath);
if (!existsSync(absKeypair)) {
  console.error(`✗ keypair file not found: ${absKeypair}`);
  process.exit(1);
}
/* Refuse a keypair that lives inside the repo — that is how secrets get
   committed. Compare real paths so ../ tricks do not slip through. */
let insideRepo = false;
try {
  const realKeypair = realpathSync(absKeypair);
  insideRepo = realKeypair === ROOT || realKeypair.startsWith(ROOT + '/');
} catch { /* resolve below still validates existence */ insideRepo = absKeypair === ROOT || absKeypair.startsWith(ROOT + '/'); }
if (insideRepo) {
  console.error('✗ refusing to read a keypair from inside the repository — move it outside the repo tree (e.g. ~/.secrets/) and pass that path.');
  process.exit(1);
}

const RPC = String(process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC || 'https://api.mainnet-beta.solana.com');

/* ── the SDK, pinned to mainnet-beta exactly like the browser path ───────── */
const sdkModule = await import('@velocity-exchange/sdk');
const sdk = sdkModule.VelocityClient ? sdkModule : sdkModule.default;
if (!sdk || typeof sdk.VelocityClient !== 'function') throw new Error('@velocity-exchange/sdk did not load');
const { Connection, PublicKey, Keypair, VersionedTransaction } = await import('@solana/web3.js');

sdk.initialize({ env: 'mainnet-beta' });
const cfg = sdk.getConfig();
if (cfg?.ENV !== 'mainnet-beta') throw new Error(`SDK env is ${cfg?.ENV}, expected mainnet-beta`);
if (cfg?.QUOTE_MINT_ADDRESS !== 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB') {
  throw new Error(`quote mint is ${cfg?.QUOTE_MINT_ADDRESS}, expected Velocity mainnet USDT`);
}
const PROGRAM_ID = new PublicKey(sdk.VELOCITY_PROGRAM_ID);

/* ── the local keypair as an anchor-style wallet ─────────────────────────── */
let keypair;
try {
  keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(absKeypair, 'utf8'))));
} catch (e) {
  console.error(`✗ could not parse the keypair file (${e?.message || e}) — expected Solana CLI JSON ([…64 bytes…])`);
  process.exit(1);
}
const authority = keypair.publicKey;
const wallet = {
  publicKey: authority,
  async signTransaction(tx) {
    /* the SDK's tx handler builds legacy AND versioned transactions */
    if (tx instanceof VersionedTransaction) tx.sign([keypair]);
    else tx.partialSign(keypair);
    return tx;
  },
  async signAllTransactions(txs) {
    for (const tx of txs) {
      if (tx instanceof VersionedTransaction) tx.sign([keypair]);
      else tx.partialSign(keypair);
    }
    return txs;
  }
};

const connection = new Connection(RPC, 'confirmed');
const client = new sdk.VelocityClient({
  connection, wallet, env: 'mainnet-beta', activeSubAccountId: 0, userStats: true
});

const say = (s) => console.log(s);
say(`RPC           ${new URL(RPC).host}`);
say(`authority     ${authority.toString()}`);
say('');

const exists = async (pda) => {
  const info = await connection.getAccountInfo(pda, 'confirmed');
  return Boolean(info && info.data && info.data.length);
};

try {
  await client.subscribe();

  /* 1+2) UserStats + User sub-account 0 (one tx when missing) */
  const userStatsPda = sdk.getUserStatsAccountPublicKey(PROGRAM_ID, authority);
  const userPda = await sdk.getUserAccountPublicKey(PROGRAM_ID, authority, 0);
  const [hasStats, hasUser] = [await exists(userStatsPda), await exists(userPda)];
  say(`UserStats     ${userStatsPda.toString()}  ${hasStats ? 'exists' : 'MISSING'}`);
  say(`User (0)      ${userPda.toString()}  ${hasUser ? 'exists' : 'MISSING'}`);
  if (!hasUser || !hasStats) {
    say('→ creating UserStats + User sub-account 0 (initializeUserAccount, name "FBT")…');
    const [sig] = await client.initializeUserAccount(0, 'FBT');
    say(`  ✓ signature ${sig}`);
    await client.fetchAccounts().catch(() => {});
    if (!(await exists(userStatsPda)) || !(await exists(userPda))) {
      /* fetchAccounts refreshes the client cache; the direct read is the truth */
      console.error('  ✗ accounts still missing after the tx — check the signature on an explorer');
      process.exitCode = 1;
    }
  }

  /* 3) RevenueShare — the account referral payouts accumulate into */
  const revenueSharePda = sdk.getRevenueShareAccountPublicKey(PROGRAM_ID, authority);
  const hasRevenue = await exists(revenueSharePda);
  say(`RevenueShare  ${revenueSharePda.toString()}  ${hasRevenue ? 'exists' : 'MISSING'}`);
  if (!hasRevenue) {
    say('→ creating RevenueShare (initializeRevenueShare)…');
    const sig = await client.initializeRevenueShare(authority);
    say(`  ✓ signature ${sig}`);
    if (!(await exists(revenueSharePda))) {
      console.error('  ✗ account still missing after the tx — check the signature on an explorer');
      process.exitCode = 1;
    }
  }

  say('');
  say('Set these environment variables (Vercel → Project → Settings → Environment Variables):');
  say(`  VELOCITY_REFERRER=${authority.toString()}`);
  say(`  VITE_VELOCITY_REFERRER=${authority.toString()}`);
  say('(VITE_* is a build-time value: redeploy after setting it.)');
  say('');
  say('Sweep due referral revenue with: node scripts/velocity-referral-sweep.mjs');
} catch (err) {
  console.error(`✗ setup failed: ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  try { await client.unsubscribe(); } catch { /* best effort */ }
}
