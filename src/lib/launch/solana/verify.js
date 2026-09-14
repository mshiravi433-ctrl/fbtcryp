/**
 * SOLANA LAUNCH — live-cluster verification.
 * ============================================================================
 *
 * The EVM launchpad claims LIVE only after reading the chain's own word
 * (code hash, reserves, LP balance). This module is the same promise for
 * Solana: after the create (and optional buy) confirm, it reads back —
 *
 *   · the pool account: exists, owned by the LaunchLab program, decodes as a
 *     PoolState, and names OUR mint, config, platform, creator, vaults and
 *     economics (see verifyPoolState in ./launchlab.js)
 *   · the mint account: owned by the SPL Token program, 6 decimals, the full
 *     supply, NO freeze authority, and a mint authority that is either
 *     revoked or held by the LaunchLab vault authority — reported either way
 *   · both vaults: balances reconcile with the pool's sold/raised counters
 *     (A side exact, B side within the accrued fee counters, per the docs)
 *   · the metadata account: exists and is owned by the Token Metadata
 *     program, with the name/symbol/uri we asked for
 *
 * Anything else is a NAMED problem and the launch is NOT reported live — the
 * same failure-closed rule as verifyLaunch on the EVM side. Reads use the
 * app's own Connection (the user's cluster), with 'confirmed' commitment.
 */

import { Buffer } from 'buffer';
import {
  WSOL_MINT, METADATA_PROGRAM_ID,
  decodeLaunchpadConfig, decodeLaunchpadPlatform, decodeLaunchpadPool,
  verifyPoolState, validateConfigAccount, validatePlatformAccount,
  launchlabClusterConfig, base58Decode
} from './launchlab.js';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

async function readAccountBytes(connection, address) {
  const { PublicKey } = await import('@solana/web3.js');
  const info = await connection.getAccountInfo(new PublicKey(address), 'confirmed');
  if (!info) return { found: false, owner: null, bytes: null };
  return { found: true, owner: info.owner?.toBase58?.() || String(info.owner), bytes: info.data };
}

/**
 * Load + decode the SOL GlobalConfig, and prove it is the config we derived:
 * the PDA derivation must land on this address (the anchor check — Solana's
 * equivalent of the EVM DEX factory proof) and the decoded account must be
 * the constant-product WSOL config the plan binds to.
 */
export async function loadLaunchlabConfig(connection, { cluster, programId, configId }) {
  const cc = launchlabClusterConfig(cluster);
  const { PublicKey } = await import('@solana/web3.js');
  const prog = new PublicKey(programId || cc.programId);
  const [derived] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_config', 'utf8'), new PublicKey(WSOL_MINT).toBuffer(), Uint8Array.from([0]), Uint8Array.from([0, 0])],
    prog
  );
  if (derived.toBase58() !== String(configId)) {
    return { ok: false, problems: ['CONFIG_ANCHOR_MISMATCH'], decoded: null };
  }
  const read = await readAccountBytes(connection, configId).catch(() => ({ found: false }));
  if (!read.found) return { ok: false, problems: ['CONFIG_NOT_FOUND'], decoded: null };
  if (read.owner !== prog.toBase58()) return { ok: false, problems: ['CONFIG_OWNER_NOT_LAUNCHLAB'], decoded: null };
  let decoded;
  try {
    decoded = decodeLaunchpadConfig(read.bytes);
  } catch (e) {
    return { ok: false, problems: [String(e?.message || 'CONFIG_UNREADABLE')], decoded: null };
  }
  const v = validateConfigAccount(decoded, { quoteMint: WSOL_MINT });
  if (!v.ok) return { ok: false, problems: v.problems, decoded };
  return { ok: true, problems: [], decoded };
}

/** Load + decode the platform account (live fee rates + restriction flags). */
export async function loadLaunchlabPlatform(connection, { programId, platformId }) {
  const read = await readAccountBytes(connection, platformId).catch(() => ({ found: false }));
  if (!read.found) return { ok: false, problems: ['PLATFORM_NOT_FOUND'], decoded: null };
  if (read.owner !== String(programId)) return { ok: false, problems: ['PLATFORM_OWNER_NOT_LAUNCHLAB'], decoded: null };
  let decoded;
  try {
    decoded = decodeLaunchpadPlatform(read.bytes);
  } catch (e) {
    return { ok: false, problems: [String(e?.message || 'PLATFORM_UNREADABLE')], decoded: null };
  }
  const v = validatePlatformAccount(decoded);
  if (!v.ok) return { ok: false, problems: v.problems, decoded };
  return { ok: true, problems: [], decoded };
}

function readBorshString(bytes, at) {
  if (at + 4 > bytes.length) throw new Error('METADATA_TRUNCATED');
  const len = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24);
  if (len < 0 || at + 4 + len > bytes.length) throw new Error('METADATA_TRUNCATED');
  return { text: Buffer.from(bytes.subarray(at + 4, at + 4 + len)).toString('utf8').replace(/\0+$/, ''), next: at + 4 + len };
}

/**
 * Minimal Metaplex Metadata decode — just enough to prove OUR fields landed:
 * key u8, update_authority 32, mint 32, then three Borsh strings
 * (name, symbol, uri). Creators/seller-fee live after the uri and are not
 * read: LaunchLab writes none, and claiming more than we check would be
 * exactly the kind of over-verification this module avoids.
 */
export function decodeMetadataCore(raw) {
  const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
  if (bytes.length < 67) throw new Error('METADATA_TRUNCATED');
  const key = bytes[0];
  let at = 1 + 32 + 32;
  const name = readBorshString(bytes, at); at = name.next;
  const symbol = readBorshString(bytes, at); at = symbol.next;
  const uri = readBorshString(bytes, at);
  return { key, name: name.text, symbol: symbol.text, uri: uri.text };
}

/** Parsed mint state via getParsedAccountInfo (the RPC decodes the layout). */
export async function readMintState(connection, mint) {
  const { PublicKey } = await import('@solana/web3.js');
  const info = await connection.getParsedAccountInfo(new PublicKey(mint), 'confirmed');
  const parsed = info?.value?.data?.parsed?.info;
  if (!parsed) return { found: false };
  return {
    found: true,
    owner: info.value.owner?.toBase58?.() || String(info.value.owner),
    decimals: parsed.decimals,
    supply: String(parsed.supply),
    mintAuthority: parsed.mintAuthority ?? null,
    freezeAuthority: parsed.freezeAuthority ?? null
  };
}

async function readTokenBalance(connection, vault) {
  const { PublicKey } = await import('@solana/web3.js');
  try {
    const bal = await connection.getTokenAccountBalance(new PublicKey(vault), 'confirmed');
    return bal?.value?.amount ?? null;
  } catch {
    return null;
  }
}

/**
 * Full post-confirmation verification. `plan` is the object returned by
 * buildLaunchlabPlan; `signatures` is {create, buy?}.
 */
export async function verifySolanaLaunch({ connection, plan, signatures = {} }) {
  const problems = [];
  const facts = { token: null, pool: null, metadata: null, vaults: null };
  const a = plan.addresses;

  // ── pool ──
  const poolRead = await readAccountBytes(connection, a.poolId).catch(() => ({ found: false }));
  if (!poolRead.found) {
    problems.push('POOL_ACCOUNT_MISSING');
    return { ok: false, problems, facts };
  }
  if (poolRead.owner !== plan.programId) problems.push('POOL_OWNER_NOT_LAUNCHLAB');
  let pool = null;
  try {
    pool = decodeLaunchpadPool(poolRead.bytes);
  } catch (e) {
    problems.push(String(e?.message || 'POOL_UNREADABLE'));
  }
  if (pool) {
    const back = verifyPoolState(pool, {
      mintA: a.mintA, mintB: WSOL_MINT, configId: a.configId, platformId: a.platformId,
      creator: a.creator, supply: plan.params.supply, totalSellA: plan.params.totalSellA,
      totalFundRaisingB: plan.params.totalFundRaisingB, vaultA: a.vaultA, vaultB: a.vaultB,
      mintDecimalsA: plan.params.decimals, migrateType: 1
    });
    problems.push(...back.problems);
    facts.pool = {
      address: a.poolId,
      status: pool.status,
      realA: pool.realA,
      realB: pool.realB,
      virtualA: pool.virtualA,
      virtualB: pool.virtualB,
      mintProgramFlag: pool.mintProgramFlag
    };
    if (pool.status !== 0 && pool.status !== 1) problems.push('POOL_STATUS_UNEXPECTED');
    if (pool.mintProgramFlag !== 0) problems.push('POOL_TOKEN_PROGRAM_FLAG_UNEXPECTED');
    // Vault reconciliation: A side exact (no A-side fees exist), B side
    // within the accrued fee counters (docs: quote_vault ↔ real_quote).
    const balA = await readTokenBalance(connection, a.vaultA);
    const balB = await readTokenBalance(connection, a.vaultB);
    facts.vaults = { vaultA: balA, vaultB: balB };
    if (balA == null || balB == null) {
      problems.push('VAULT_BALANCES_UNREADABLE');
    } else {
      const expectA = BigInt(pool.supply) - BigInt(pool.realA);
      if (BigInt(balA) !== expectA) problems.push('VAULT_A_RECONCILIATION_FAILED');
      const drift = BigInt(balB) - BigInt(pool.realB);
      const maxDrift = BigInt(pool.protocolFee) + BigInt(pool.platformFee) + BigInt(pool.migrateFee);
      if (drift < 0n || drift > maxDrift) problems.push('VAULT_B_RECONCILIATION_FAILED');
    }
  }

  // ── mint ──
  const mint = await readMintState(connection, a.mintA).catch(() => ({ found: false }));
  if (!mint.found) {
    problems.push('MINT_ACCOUNT_MISSING');
  } else {
    if (mint.owner !== TOKEN_PROGRAM_ID) problems.push('MINT_OWNER_NOT_TOKEN_PROGRAM');
    if (Number(mint.decimals) !== Number(plan.params.decimals)) problems.push('DECIMALS_MISMATCH');
    if (String(mint.supply) !== String(plan.params.supply)) problems.push('SUPPLY_MISMATCH');
    if (mint.freezeAuthority !== null) problems.push('FREEZE_AUTHORITY_MISMATCH');
    // The docs state the mint authority is revoked in initialize; if the
    // program instead holds it until graduation, that is still custody the
    // user was told about — report which, fail on anything else.
    const heldByProgram = mint.mintAuthority === a.auth;
    if (mint.mintAuthority !== null && !heldByProgram) problems.push('MINT_AUTHORITY_MISMATCH');
    facts.token = {
      address: a.mintA,
      name: plan.identity.name,
      symbol: plan.identity.symbol,
      decimals: mint.decimals,
      supply: mint.supply,
      mintAuthority: mint.mintAuthority,
      mintAuthorityState: mint.mintAuthority === null ? 'revoked' : 'program-held',
      freezeAuthority: mint.freezeAuthority
    };
  }

  // ── metadata ──
  const metaRead = await readAccountBytes(connection, a.metadataId).catch(() => ({ found: false }));
  if (!metaRead.found) {
    problems.push('METADATA_ACCOUNT_MISSING');
  } else if (metaRead.owner !== METADATA_PROGRAM_ID) {
    problems.push('METADATA_OWNER_MISMATCH');
  } else {
    try {
      const meta = decodeMetadataCore(metaRead.bytes);
      facts.metadata = meta;
      if (meta.name !== plan.identity.name) problems.push('METADATA_NAME_MISMATCH');
      if (meta.symbol !== plan.identity.symbol) problems.push('METADATA_SYMBOL_MISMATCH');
      if (meta.uri !== plan.identity.uri) problems.push('METADATA_URI_MISMATCH');
    } catch (e) {
      problems.push(String(e?.message || 'METADATA_UNREADABLE'));
    }
  }

  facts.signatures = { ...signatures };
  return { ok: problems.length === 0, problems, facts };
}
