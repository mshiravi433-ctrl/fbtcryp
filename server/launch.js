/**
 * FBT LAUNCH — public API (orchestration & data, never a signer).
 *
 * THE BOUNDARY
 * ---------------------------------------------------------------------------
 *   GET  /api/launch/config    networks, DEX registry, fees, factory registry
 *   GET  /api/launch/prepare   config → plan bytes (same builder as the app)
 *   GET  /api/launch/verify    read-only on-chain verification
 *   POST /api/launch/record    public launch record (non-sensitive fields)
 *   GET  /api/launch/records/:chainId
 *
 * Nothing in this module (or reachable from it) holds a key, builds a
 * signature or broadcasts a transaction. `prepare` returns BYTES for the
 * caller's own wallet to sign — the SDK story (docs/LAUNCH-SDK.md) is
 * exactly this surface. The calldata builder is the SAME module the app
 * imports (src/lib/launch/calldata.js), so API and app cannot drift.
 *
 * The record write refuses (503) rather than loses when no durable store is
 * configured — the same honesty rule the ecosystem registry follows.
 */
import { storeDurable, storeGet, storeSet } from './store.js';
import {
  LAUNCH_SCHEMA,
  LAUNCH_CHAINS,
  SOLANA_LAUNCH_STATUS,
  describeAllLaunchChains
} from '../src/lib/launch/networks.js';
import {
  buildLaunchPlan,
  verifyDex
} from '../src/lib/launch/calldata.js';
import { verifyLaunch } from '../src/lib/launch/verify.js';
import { feeSummary } from '../src/lib/launch/fees.js';
import { scoreLaunch } from '../src/lib/launch/risk.js';
import { validateTokenSpec } from '../src/lib/launch/capabilities.js';
import { EVM_CHAINS } from '../src/lib/chains.js';
import { sanitizeRecord } from '../src/lib/launch/history.js';

const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

/* ─────────────────────────── configuration ─────────────────────────── */

/**
 * Per-chain FBTTokenFactory deployments, from the environment. The contract
 * is stateless and identical on every chain, so each deployment is just an
 * address: FBTLAUNCH_FACTORY_<CHAINID>=0x...  (see .env.example).
 */
function factoryRegistry() {
  const out = {};
  for (const chainId of LAUNCH_CHAINS) {
    const raw = String(process.env[`FBTLAUNCH_FACTORY_${chainId}`] || '').trim();
    if (isAddress(raw)) out[String(chainId)] = raw;
  }
  return out;
}

/** Optional DEX factory override per chain (deployments pinning audited pins). */
function dexOverrides() {
  const out = {};
  for (const chainId of LAUNCH_CHAINS) {
    const raw = String(process.env[`FBTLAUNCH_DEX_FACTORY_${chainId}`] || '').trim();
    if (isAddress(raw)) out[chainId] = raw;
  }
  return out;
}

export function launchConfig() {
  const registry = factoryRegistry();
  const networks = describeAllLaunchChains(registry);
  const factories = Object.keys(registry).length;
  return {
    schema: LAUNCH_SCHEMA,
    solana: { status: SOLANA_LAUNCH_STATUS, note: 'SPL + Raydium/Meteora/Orca adapters arrive after the EVM phase is audited' },
    networks,
    /*
     * The token step needs NO operator contract: the deployed token bytecode
     * ships with the client and is sent as a plain CREATE from the user's own
     * wallet (mode 'direct'). A chain only switches to mode 'factory' when a
     * FBTTokenFactory address is pinned for it via FBTLAUNCH_FACTORY_<id> —
     * the path future on-chain fees would need. `factoryRegistry` stays in the
     * response for exactly that reason.
     */
    deploy: {
      defaultMode: 'direct',
      factoryChains: Object.keys(registry).map(Number),
      factoryCount: factories,
      statement: 'Direct mode deploys the token straight from the user\'s wallet: the launch costs nothing but gas, and no FBT contract is in the transaction.'
    },
    fees: feeSummary(),
    factoryRegistry: registry,
    durableRecords: storeDurable(),
    noCustody: Object.freeze({
      holdsFunds: false,
      holdsKeys: false,
      signsUserTransactions: false,
      statement: 'FBT never holds user funds, never receives private keys or seed phrases, and never signs user financial transactions.'
    })
  };
}

/* ─────────────────────────── provider cache ────────────────────────── */

const providerCache = new Map();
async function readProvider(chainId) {
  const chain = EVM_CHAINS[chainId];
  if (!chain) return null;
  if (!providerCache.has(chainId)) {
    const { JsonRpcProvider, FallbackProvider } = await import('ethers');
    const providers = chain.rpc.slice(0, 3).map((url, i) => new JsonRpcProvider(url, chainId, { staticNetwork: true, stallTimeout: 4000 }));
    providerCache.set(chainId, providers.length > 1
      ? new FallbackProvider(providers.map((p, i) => ({ provider: p, priority: i + 1, stallTimeout: 4000, weight: 1 })), chainId, { quorum: 1, cacheTimeout: 5000 })
      : providers[0]);
  }
  return providerCache.get(chainId);
}

/* ─────────────────────────── input parsing ─────────────────────────── */

function parsePrepareQuery(q) {
  const chainId = Number(q.chainId);
  if (!LAUNCH_CHAINS.includes(chainId)) return { error: 'CHAIN_NOT_SUPPORTED' };
  // Phase two (token already exists, pool/liquidity only) does NOT need the
  // token spec again: the SDK/user retries with tokenAddress + amounts and
  // the on-chain token is the source of truth. The spec is only mandatory
  // when we are about to CREATE the token.
  const hasTokenAddress = isAddress(q.tokenAddress);
  let spec;
  if (!hasTokenAddress) {
    spec = validateTokenSpec({
      name: q.name,
      symbol: q.symbol,
      decimals: q.decimals ?? 18,
      supply: q.supply,
      caps: {
        mintable: q.capMintable === 'true',
        burnable: q.capBurnable === 'true',
        pausable: q.capPausable === 'true',
        maxWallet: q.capMaxWallet === 'true',
        maxTx: q.capMaxTx === 'true'
      }
    });
    if (!spec.ok) return { error: 'SPEC_INVALID', errors: spec.errors };
  } else {
    spec = { ok: true, value: null };
  }

  let quote;
  try {
    const raw = q.quote ? JSON.parse(q.quote) : null;
    if (raw && typeof raw === 'object') {
      quote = {
        symbol: String(raw.symbol || '').toUpperCase(),
        address: raw.native ? null : String(raw.address || null),
        decimals: Number(raw.decimals ?? 18),
        native: raw.native === true
      };
      if (!quote.native && !isAddress(quote.address)) return { error: 'QUOTE_INVALID' };
    }
  } catch {
    return { error: 'QUOTE_INVALID' };
  }
  if (!quote) quote = null; // token-only prepare is legal (phase one)

  const tokenAmount = String(q.tokenAmount ?? '').trim();
  const quoteAmount = String(q.quoteAmount ?? '').trim();
  const creator = isAddress(q.creator) ? q.creator : null;
  const tokenAddress = isAddress(q.tokenAddress) ? q.tokenAddress : null;
  const factoryAddress = isAddress(q.factoryAddress) ? q.factoryAddress : factoryRegistry()[String(chainId)] || null;
  /* Direct deploy is the default: no factory address is required to build the
     token bytes, and the deployer nonce (for the CREATE address prediction)
     comes from the caller — the server never reads a user's account state
     without being asked. `mode` may be forced ('direct' | 'factory'); it is
     omitted when not asked for, so the default stays the chain's mode. */
  const nonce = Number.isFinite(Number(q.nonce)) && Number(q.nonce) >= 0 ? Number(q.nonce) : 0;
  const mode = q.mode === 'direct' || q.mode === 'factory' ? q.mode : undefined;
  const withMode = mode ? { mode } : {};

  if (!quote) {
    if (tokenAddress) return { error: 'PHASE_TWO_NEEDS_QUOTE' };
    // Phase one is buildable with OR without a factory — direct mode needs
    // nothing but the spec and the creator's own address.
    if (!factoryAddress && !creator) return { error: 'CREATOR_REQUIRED' };
    return {
      ok: true,
      params: { chainId, factoryAddress, spec: spec.value, tokenAddress: null, quote: null, creator, nonce, ...withMode }
    };
  }

  if (!/^\d+(\.\d+)?$/.test(tokenAmount) || !/^\d+(\.\d+)?$/.test(quoteAmount)) return { error: 'AMOUNT_INVALID' };
  if (!creator) return { error: 'CREATOR_REQUIRED' };

  return {
    ok: true,
    params: {
      chainId,
      factoryAddress,
      spec: spec.value,
      tokenAddress,
      quote,
      tokenAmount,
      quoteAmount,
      slippageBps: Math.max(0, Math.min(5000, Number(q.slippageBps ?? 100))),
      creator,
      nonce,
      ...withMode
    }
  };
}

/* ─────────────────────────── request handlers ──────────────────────── */

export function launchConfigHandler(_req, res) {
  res.json(launchConfig());
}

export async function launchPrepareHandler(req, res) {
  try {
    const parsed = parsePrepareQuery(req.query || {});
    if (!parsed.ok) return res.status(parsed.error === 'SPEC_INVALID' || parsed.error === 'QUOTE_INVALID' || parsed.error === 'AMOUNT_INVALID' ? 400 : 409).json({ ok: false, code: parsed.error, errors: parsed.errors });

    const { params } = parsed;
    const provider = await readProvider(params.chainId).catch(() => null);
    const dexCheck = provider ? await verifyDex(provider, params.chainId) : { ok: false, reason: 'NO_RPC' };

    const plan = await buildLaunchPlan({
      ...params,
      provider,
      // The API is stateless about pair state: without a token it cannot
      // know, so it reports `createPairNeeded: null` = "decide at sign time"
      // and the in-app engine re-checks live. The SDK caller passes
      // tokenAddress + pairAddress for phase two.
      createPairNeeded: params.tokenAddress ? (req.query.createPairNeeded === 'true') : null
    });

    // The server re-scores with the same engine the UI uses, plus the DEX
    // verification result — the plan and its risk verdict leave the API
    // together, so a consumer can never render one without the other.
    const risk = scoreLaunch({
      // Phase two has no spec (the token already exists on-chain) — its
      // capability findings are moot, so score with a clean bitmap.
      capabilities: params.spec ? params.spec.capabilities : 0,
      decimals: params.spec ? params.spec.decimals : 18,
      supplyWei: params.spec ? params.spec.supplyWei : '0',
      tokenAmount: params.quote ? params.tokenAmount : '0',
      quoteAmount: params.quote ? params.quoteAmount : '0',
      quoteDecimals: params.quote ? params.quote.decimals : 0,
      dexVerified: dexCheck.ok,
      /*
       * The token step needs no factory: in direct mode the bytes are sent as
       * a plain CREATE from the caller's wallet, so the "factory not
       * deployed" gate can never apply here. The gate stays in the risk
       * engine for any deployment that pins itself to factory-only mode.
       */
      factoryReady: true,
      lpqToUser: true
    });

    res.json({
      ok: true,
      noCustody: { signsUserTransactions: false, statement: 'The plan below is bytes for YOUR wallet to sign. This API does not sign, send or hold anything.' },
      dex: { verified: dexCheck.ok, reason: dexCheck.reason || null },
      plan,
      risk
    });
  } catch (e) {
    const code = String(e?.message || 'PREPARE_FAILED');
    res.status(code === 'FACTORY_NOT_DEPLOYED' || code === 'CHAIN_NOT_SUPPORTED' ? 409 : 502).json({ ok: false, code });
  }
}

export async function launchVerifyHandler(req, res) {
  const q = req.query || {};
  const chainId = Number(q.chainId);
  if (!LAUNCH_CHAINS.includes(chainId)) return res.status(400).json({ ok: false, code: 'CHAIN_NOT_SUPPORTED' });
  const tokenAddress = isAddress(q.token) ? q.token : null;
  const pairAddress = isAddress(q.pair) ? q.pair : null;
  const creator = isAddress(q.creator) ? q.creator : null;
  if (!tokenAddress || !pairAddress || !creator) return res.status(400).json({ ok: false, code: 'PARAMS_REQUIRED', detail: 'chainId, token, pair and creator are all required' });

  let quote;
  try {
    quote = JSON.parse(q.quote);
  } catch {
    return res.status(400).json({ ok: false, code: 'QUOTE_INVALID' });
  }
  const provider = await readProvider(chainId).catch(() => null);
  if (!provider) return res.status(502).json({ ok: false, code: 'NO_RPC' });

  const result = await verifyLaunch(provider, {
    chainId,
    tokenAddress,
    pairAddress,
    creator,
    quote,
    tokenMin: q.tokenMin || null,
    quoteMin: q.quoteMin || null,
    newPair: q.newPair !== 'false',
    expect: {
      expectName: q.name || null,
      expectSymbol: q.symbol || null,
      expectDecimals: q.decimals ? Number(q.decimals) : null,
      expectSupply: q.supply || null
    }
  }).catch((e) => ({ ok: false, token: null, pool: null, problems: [String(e?.message || 'VERIFY_FAILED')] }));

  res.json({ ok: true, result });
}

/* ─────────────────────────── records (non-sensitive only) ──────────── */

const RECORDS_KEY = (chainId) => `fbt-launch-records-${chainId}`;

export async function launchRecordHandler(req, res) {
  if (!storeDurable()) {
    return res.status(503).json({ ok: false, code: 'NO_DURABLE_STORE', detail: 'This deployment has no durable store configured; records are refused rather than silently lost. Local device history is unaffected.' });
  }
  const clean = sanitizeRecord(req.body || {});
  if (!clean.network) return res.status(400).json({ ok: false, code: 'NETWORK_REQUIRED' });
  const chainId = Number(clean.network);
  if (!LAUNCH_CHAINS.includes(chainId)) return res.status(400).json({ ok: false, code: 'CHAIN_NOT_SUPPORTED' });

  const key = RECORDS_KEY(chainId);
  const list = (await storeGet(key, [])) || [];
  const idx = list.findIndex((r) => r.launchId === clean.launchId);
  if (idx >= 0) list[idx] = { ...list[idx], ...clean, updatedAt: Date.now() };
  else list.unshift({ ...clean, createdAt: clean.createdAt || Date.now() });
  await storeSet(key, list.slice(0, 200));
  res.json({ ok: true, record: clean });
}

export async function launchRecordsHandler(req, res) {
  const chainId = Number(req.params.chainId);
  if (!LAUNCH_CHAINS.includes(chainId)) return res.status(404).json({ ok: false, code: 'CHAIN_NOT_SUPPORTED' });
  const list = (await storeGet(RECORDS_KEY(chainId), [])) || [];
  res.json({
    ok: true,
    durable: storeDurable(),
    count: list.length,
    records: list
  });
}
