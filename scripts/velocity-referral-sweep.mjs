#!/usr/bin/env node
/**
 * VELOCITY REFERRAL SWEEP — collect FBT's due referral revenue share.
 * ---------------------------------------------------------------------------

 * A referred user's taker fees accumulate in the venue's per-market revenue
 * pool as `pendingRevenueShare` rows attributed to that user's
 * `RevenueShareEscrow`. They only land in the REFERRER's `RevenueShare`
 * account when somebody sends `settle_revenue_share` for the escrow — the
 * protocol does not push them automatically. This script is that somebody:
 * run it from cron (e.g. hourly) and it settles every escrow attributed to
 * FBT that actually owes revenue on a live market.
 *
 * Safety rails, per the SDK's own semantics:
 *   · `RevenueShareEscrowMap.syncAll()` first — the owing-escrow query reads
 *     the cache and a partial cache reports too few accounts;
 *   · `getEscrowsOwingRevenueShare(marketIndex)` is the work list; escrows are
 *     additionally filtered to FBT via `getAllByReferrer(FBT)`;
 *   · before EACH settle, `calculateRevenueShareSweepAvailable(perpMarket,
 *     spotMarket, oracle)` is checked — settling more than the market can pay
 *     is the failure mode the SDK documents this helper for;
 *   · the FBT keypair is read from `VELOCITY_KEYPAIR_PATH` (outside the repo)
 *     and never printed.
 *
 * USAGE:
 *   VELOCITY_KEYPAIR_PATH=/abs/path/fbt-velocity.json \
 *   VELOCITY_REFERRER=<authority> \
 *   SOLANA_RPC_URL=https://your-rpc.example/… \
 *   node scripts/velocity-referral-sweep.mjs
 *
 * Optional:
 *   VELOCITY_SWEEP_DRY_RUN=1   print what would be settled, sign nothing.
 */
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DRY_RUN = String(process.env.VELOCITY_SWEEP_DRY_RUN || '') === '1';

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
let insideRepo = false;
try {
  const realKeypair = realpathSync(absKeypair);
  insideRepo = realKeypair === ROOT || realKeypair.startsWith(ROOT + '/');
} catch { insideRepo = absKeypair === ROOT || absKeypair.startsWith(ROOT + '/'); }
if (insideRepo) {
  console.error('✗ refusing to read a keypair from inside the repository — move it outside the repo tree.');
  process.exit(1);
}

const RPC = String(process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC || 'https://api.mainnet-beta.solana.com');

const sdkModule = await import('@velocity-exchange/sdk');
const sdk = sdkModule.VelocityClient ? sdkModule : sdkModule.default;
if (!sdk || typeof sdk.VelocityClient !== 'function') throw new Error('@velocity-exchange/sdk did not load');
const { Connection, PublicKey, Keypair, VersionedTransaction, BN } = await import('@solana/web3.js');

sdk.initialize({ env: 'mainnet-beta' });
const cfg = sdk.getConfig();
if (cfg?.ENV !== 'mainnet-beta') throw new Error(`SDK env is ${cfg?.ENV}, expected mainnet-beta`);
const PROGRAM_ID = new PublicKey(sdk.VELOCITY_PROGRAM_ID);

const REFERRER_RAW = String(
  process.env.VELOCITY_REFERRER || process.env.VITE_VELOCITY_REFERRER || process.env.DRIFT_REFERRER || ''
).trim();
if (!REFERRER_RAW) {
  console.error('✗ VELOCITY_REFERRER is not set — run scripts/velocity-referrer-setup.mjs first and set the printed authority.');
  process.exit(1);
}
const referrer = new PublicKey(REFERRER_RAW);
if (referrer.equals(keypair.publicKey) === false) {
  console.error(`✗ the keypair (${keypair.publicKey}) is not the configured referrer (${referrer}).`);
  console.error('  The sweep signs WITH the referrer authority; pass the referrer\'s own keypair.');
  process.exit(1);
}

const QUOTE_PRECISION = 1_000_000;
const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(absKeypair, 'utf8'))));
const wallet = {
  publicKey: keypair.publicKey,
  async signTransaction(tx) {
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
  connection, wallet, env: 'mainnet-beta', activeSubAccountId: 0, userStats: true, skipLoadUsers: true
});

const toUsdt = (bn) => (bn && typeof bn.toNumber === 'function' ? bn.toNumber() / QUOTE_PRECISION : 0);
/* Best-effort "how much does this escrow owe on this market" — the settle
   decision itself never depends on it (that is getEscrowsOwingRevenueShare +
   calculateRevenueShareSweepAvailable); it is display only, so an unexpected
   account shape degrades to n/a instead of aborting the sweep. */
const owedDisplay = (escrow, marketIndex) => {
  try {
    const row = escrow?.revenueShare?.[marketIndex] ?? escrow?.pendingRevenueShare?.[marketIndex];
    if (row == null) return null;
    if (typeof row.toNumber === 'function') return toUsdt(row);
    const n = Number(row);
    return Number.isFinite(n) && n > 1e12 ? n / QUOTE_PRECISION : n; // raw or precision-scaled
  } catch { return null; }
};

let escrowMap = null;
try {
  await client.subscribe();
  console.log(`referrer ${referrer.toString()} · ${new URL(RPC).host}${DRY_RUN ? ' · DRY RUN' : ''}`);

  /* 1) full escrow cache — the owing query reads the cache, so syncAll() first */
  escrowMap = new sdk.RevenueShareEscrowMap(client);
  await escrowMap.syncAll();
  console.log(`escrows cached: ${escrowMap.size()}`);

  /* 2) the referrer's own escrows, plus the owing work list per market */
  const ours = escrowMap.getAllByReferrer(referrer.toString());
  console.log(`escrows referred by FBT: ${ours.length}`);
  if (!ours.length) {
    console.log('nothing attributed to this referrer yet — done.');
    process.exit(0);
  }
  const oursByAuthority = new Set(ours.map((e) => String(e.authority)));

  let settled = 0;
  let skipped = 0;
  for (const perpMarket of client.getPerpMarketAccounts()) {
    if (!perpMarket) continue;
    const marketIndex = Number(perpMarket.marketIndex);
    const owing = escrowMap.getEscrowsOwingRevenueShare(marketIndex);
    for (const [authorityRaw, escrow] of owing) {
      if (!oursByAuthority.has(String(authorityRaw))) continue; // not FBT-referred

      /* 3) can the market actually pay right now? Settling more than the
         market can pay is the failure mode the SDK documents
         calculateRevenueShareSweepAvailable for. */
      const spotMarket = client.getSpotMarketAccount(0); // USDT quote market
      const oracle = client.getOracleDataForPerpMarket(marketIndex);
      let available = null;
      try {
        available = sdk.calculateRevenueShareSweepAvailable(perpMarket, spotMarket, { price: oracle?.price });
      } catch (e) {
        console.error(`  ✗ market ${marketIndex}: sweep-available check failed (${e?.message || e}) — skipping`);
        skipped += 1;
        continue;
      }
      if (available && available.lte(new BN(0))) {
        console.log(`  · market ${marketIndex} ${String(authorityRaw).slice(0, 8)}… : pool cannot pay yet (${toUsdt(available)} USDT available) — skipped`);
        skipped += 1;
        continue;
      }
      const owed = owedDisplay(escrow, marketIndex);
      if (DRY_RUN) {
        console.log(`  [dry] market ${marketIndex} ${String(authorityRaw).slice(0, 8)}… : owed ${owed == null ? 'n/a' : owed.toFixed(6)} USDT, available ${toUsdt(available)} USDT → would settle`);
        continue;
      }
      const sig = await client.settleRevenueShare(new PublicKey(String(authorityRaw)), escrow, marketIndex);
      settled += 1;
      console.log(`  ✓ market ${marketIndex} ${String(authorityRaw).slice(0, 8)}… settled (owed ${owed == null ? 'n/a' : owed.toFixed(6)} USDT) sig ${sig}`);
    }
  }
  console.log(`done — settled ${settled}${skipped ? `, skipped ${skipped}` : ''}${DRY_RUN ? ' (dry run)' : ''}`);
} catch (err) {
  console.error(`✗ sweep failed: ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  try { await client.unsubscribe(); } catch { /* best effort */ }
  try { await escrowMap?.unsubscribe?.(); } catch { /* best effort */ }
}
