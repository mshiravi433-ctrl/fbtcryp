/**
 * FBT FEE ROUTER STATUS — the single read-only truth about the platform's
 * self-deployed FeeRouter, as of THIS moment.
 * ---------------------------------------------------------------------------
 * This is what the AI surfaces (the in-app Intent AI tool registry and the
 * fbt-mcp agent bridge) and every human operator see when they ask "is the
 * FeeRouter connected?".
 *
 * Honesty rules (same discipline as server/providerStatus.js):
 *   • Reports only what was actually measured in this run.
 *   • A chain whose RPCs do not answer reports UNREACHABLE — never a silent
 *     ok, never a fabricated balance or fee.
 *   • A configured address with no code on-chain reports NOT_DEPLOYED.
 *   • The compiled-artifact hash comes from the committed build artifact the
 *     ops-probe policy-contract drill uses — one source of truth.
 *   • Nothing here signs, sends or mutates anything. Every getter is a view.
 *
 * What "connected" means, stated once:
 *   mode 'contract' on a chain = swaps on that chain route the 0.7% platform
 *   fee through our own deployed FeeRouter. Anything else keeps the
 *   fee-carrying aggregator path. No deployment configured anywhere =
 *   aggregator mode everywhere, and this endpoint says exactly that.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVM_CHAINS,
  FEE_MODE,
  FEE_BPS,
  feeRouterFor,
  feeRecipientFor
} from '../src/lib/chains.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const FEE_ROUTER_STATUS_SCHEMA = 'fbt.fee-router-status.v1';

/* Getter selectors for FeeRouter's public view functions. Same selectors
   the ops-probe policy-contract drill already ships (server/intentOperationalDrills.js):
   dexRouter() / feeRecipient() / feeBps() / owner(). */
const GETTERS = Object.freeze({
  dexRouter: '0x0758d924',
  feeRecipient: '0x46904840',
  feeBps: '0x24a9d853',
  owner: '0x8da5cb5b'
});

const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

/* ─────────────────────────── compiled artifact ─────────────────────────── */

/**
 * The committed build artifact (scripts/compile.mjs output) is the local
 * truth for "what our FeeRouter bytecode is". The ops-probe drill hashes it
 * twice; we hash it once and report the same digest.
 */
export function readArtifact() {
  const artifactPath = path.join(ROOT, 'src', 'lib', 'feeRouterArtifact.json');
  if (!fs.existsSync(artifactPath)) {
    return { ok: false, code: 'ARTIFACT_MISSING' };
  }
  let artifact;
  try {
    artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  } catch (e) {
    return { ok: false, code: 'ARTIFACT_MALFORMED', detail: e.message };
  }
  const bytecode = String(artifact.deployedBytecode || '');
  if (!/^0x[0-9a-fA-F]{128,}$/.test(bytecode)) {
    return { ok: false, code: 'ARTIFACT_BYTECODE_INVALID' };
  }
  return {
    ok: true,
    contractName: artifact.contractName || 'FeeRouter',
    compiler: typeof artifact.compiler === 'string' ? artifact.compiler : String(artifact.compiler?.version || ''),
    evmVersion: artifact.evmVersion || null,
    bytecodeBytes: Math.floor((bytecode.length - 2) / 2),
    deployedBytecodeHash: createHash('sha256').update(bytecode).digest('hex')
  };
}

/* ─────────────────────────── live on-chain ─────────────────────────────── */

function parseAddressSlot(hex) {
  if (typeof hex !== 'string') return null;
  const clean = hex.replace(/^0x/, '');
  if (clean.length < 40) return null;
  const addr = '0x' + clean.slice(-40).toLowerCase();
  return isAddr(addr) ? addr : null;
}

function parseUintSlot(hex) {
  if (typeof hex !== 'string') return null;
  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

async function jsonRpc(rpcUrl, method, params, controller) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: controller.signal
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body?.error) throw new Error(body.error.message || 'RPC error');
  return body?.result;
}

/**
 * Read one deployed FeeRouter's code + public state, trying the chain's
 * public RPC list in order. A chain that answers nothing reports UNREACHABLE
 * with the per-RPC errors — an unreachable chain is a fact, not an outage of
 * the status endpoint.
 */
async function observeChain({ chainId, address, perRpcTimeoutMs = 5_000 }) {
  const chain = EVM_CHAINS[chainId];
  const rpcs = chain?.rpc || [];
  const errors = [];

  for (const rpcUrl of rpcs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perRpcTimeoutMs);
    try {
      const code = await jsonRpc(rpcUrl, 'eth_getCode', [address, 'latest'], controller);
      const codeStr = String(code || '');
      if (!/^0x[0-9a-fA-F]+$/.test(codeStr) || codeStr === '0x') {
        return {
          ok: false,
          code: 'NOT_DEPLOYED',
          address,
          chainId,
          rpc: rpcUrl,
          codeBytes: 0,
          detail: 'the address has no contract code on this chain'
        };
      }
      const [dexRaw, recRaw, bpsRaw, ownerRaw] = await Promise.all([
        jsonRpc(rpcUrl, 'eth_call', [{ to: address, data: GETTERS.dexRouter }, 'latest'], controller),
        jsonRpc(rpcUrl, 'eth_call', [{ to: address, data: GETTERS.feeRecipient }, 'latest'], controller),
        jsonRpc(rpcUrl, 'eth_call', [{ to: address, data: GETTERS.feeBps }, 'latest'], controller),
        jsonRpc(rpcUrl, 'eth_call', [{ to: address, data: GETTERS.owner }, 'latest'], controller)
      ]);
      return {
        ok: true,
        address,
        chainId,
        rpc: rpcUrl,
        codeBytes: Math.floor((codeStr.length - 2) / 2),
        codeHash: createHash('sha256').update(codeStr).digest('hex'),
        state: {
          dexRouter: parseAddressSlot(dexRaw),
          feeRecipient: parseAddressSlot(recRaw),
          feeBps: parseUintSlot(bpsRaw) !== null ? Number(parseUintSlot(bpsRaw)) : null,
          owner: parseAddressSlot(ownerRaw)
        }
      };
    } catch (e) {
      errors.push({ rpc: rpcUrl, error: e.name === 'AbortError' ? 'TIMEOUT' : e.message });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ok: false,
    code: 'UNREACHABLE',
    address,
    chainId,
    errors,
    detail: 'none of the chain public RPCs answered'
  };
}

/* ───────────────────────────── the report ──────────────────────────────── */

/**
 * Build the FeeRouter status report.
 *
 * @param {object} opts
 * @param {number} [opts.now]
 * @param {number} [opts.perRpcTimeoutMs]
 */
export async function feeRouterStatus({
  now = Date.now(),
  perRpcTimeoutMs = 5_000
} = {}) {
  const routers = {};
  for (const chainId of Object.keys(EVM_CHAINS)) {
    const address = feeRouterFor(chainId);
    if (isAddr(address)) {
      const chain = EVM_CHAINS[chainId];
      routers[chainId] = {
        address,
        chain: { id: Number(chainId), name: chain?.name || String(chainId), short: chain?.short || '' },
        explorer: `${chain?.explorer || ''}/address/${address}`,
        expectedFeeRecipient: feeRecipientFor(chainId) || null
      };
    }
  }

  const chainIds = Object.keys(routers).map(Number);
  const live = {};
  await Promise.all(chainIds.map(async (chainId) => {
    live[chainId] = await observeChain({
      chainId,
      address: routers[chainId].address,
      perRpcTimeoutMs
    });
  }));

  const artifact = readArtifact();
  const deployed = chainIds
    .filter((chainId) => live[chainId]?.ok === true)
    .map((chainId) => chainId);

  let note;
  if (chainIds.length === 0) {
    note = 'No FeeRouter is configured on any chain: every swap keeps the fee-carrying aggregator path. Deploy with npm run deploy:feerouter and set VITE_FEE_ROUTERS to route a chain through the contract.';
  } else if (deployed.length === chainIds.length) {
    note = `FeeRouter verified on-chain for ${deployed.length} chain(s); swaps on those chains route the platform fee through the contract.`;
  } else if (deployed.length > 0) {
    const problem = chainIds
      .filter((chainId) => live[chainId]?.ok !== true)
      .map((chainId) => `${chainId}:${live[chainId]?.code}`)
      .join(', ');
    note = `FeeRouter verified on ${deployed.length} chain(s); problem chain(s) ${problem}. Unverified chains keep the aggregator path.`;
  } else {
    const problem = chainIds
      .map((chainId) => `${chainId}:${live[chainId]?.code || 'UNKNOWN'}`)
      .join(', ');
    note = `FeeRouter is configured but not verified on any chain (${problem}). Swaps keep the aggregator path until a deployment is confirmed on-chain.`;
  }

  return {
    ok: true,
    schema: FEE_ROUTER_STATUS_SCHEMA,
    at: now,
    /* 'contract' = at least one chain routes through the self-deployed
       FeeRouter; per-chain truth is in routers/live. There is no 'none':
       every swap carries the platform fee either way. */
    mode: FEE_MODE,
    platformFeeBps: FEE_BPS,
    feeRecipient: feeRecipientFor(56) || null,
    routers,
    live,
    deployedOn: deployed,
    artifact,
    /* FeeRouter.sol is production-shaped but NOT professionally audited —
       the same disclosure the Security page carries. The AI must say it. */
    audit: {
      audited: false,
      note: 'FeeRouter.sol was tested on a local EVM but has not had a professional audit. The audited aggregator path is what is used by default.'
    },
    note
  };
}
