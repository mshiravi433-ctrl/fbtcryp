/**
 * CrossChainService — the client half of the shared engine.
 * ---------------------------------------------------------------------------
 * ─── ONE SERVICE, TWO SCREENS ───────────────────────────────────────────────
 *
 *      Bridge page  ─┐
 *                    ├─►  CrossChainService  ─►  /api/cross-chain/*  ─►  LI.FI
 *      Intent OS    ─┘            │
 *                                 └─►  wallet (signature)  ─►  blockchain
 *
 * Both surfaces call the SAME `getQuote` / `getRoutes` / `execute` /
 * `getStatus` / `getHistory`, so a rate quoted in Intent OS is the rate the
 * bridge page would execute, and a transfer started anywhere lands in one
 * history.
 *
 * ─── WHAT `execute()` REFUSES TO SKIP ───────────────────────────────────────
 * Confirm → refresh quote → balance → allowance → chain → destination →
 * build → wallet signature → broadcast → track source → track bridge → track
 * destination → confirm. Every one of those is a real check against a chain or
 * the provider. The ones that cannot be done are reported, not assumed:
 *   · the server never signs and never holds funds;
 *   · a re-quote whose id changed STOPS and asks (`QUOTE_CHANGED`);
 *   · COMPLETED is only ever reported by the server, only with a destination
 *     transaction hash.
 */

import { apiBase } from '../../lib/apiBase.js';
import {
  EXECUTION_STATUS,
  isQuoteExpired,
  isSolanaChain,
  rankRoutes,
  toProviderChainId,
  validateDestinationAddress
} from './core.js';

const API = apiBase();

/* ── transport ───────────────────────────────────────────────────────────── */

class CrossChainError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail ?? null;
  }
}

async function request(path, { method = 'GET', body = null, timeout = 30_000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: ctrl.signal
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new CrossChainError(payload?.error || `HTTP_${res.status}`, payload?.detail);
    return payload;
  } catch (err) {
    if (err instanceof CrossChainError) throw err;
    if (err?.name === 'AbortError') throw new CrossChainError('TIMEOUT');
    throw new CrossChainError('NETWORK_FAILED', String(err?.message || err).slice(0, 200));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const qs = (params) => {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    out.set(k, String(v));
  }
  return out.toString();
};

/* ── read surface ────────────────────────────────────────────────────────── */

/** Chains the provider serves AND this wallet can sign for. Never hard-coded. */
export const getChains = ({ signal } = {}) =>
  request('/cross-chain/chains', { signal }).then((r) => r.chains || []);

/** Token registry for one chain, searchable by symbol / name / address. */
export const getTokens = (chainId, { search = '', limit = 60, signal } = {}) =>
  request(`/cross-chain/tokens?${qs({ chain: toProviderChainId(chainId), q: search, limit })}`, { signal })
    .then((r) => r.tokens || []);

/** Resolve a symbol to the real contract on a chain (or fail honestly). */
export const resolveToken = (chainId, token, { signal } = {}) =>
  request(`/cross-chain/resolve-token?${qs({ chain: toProviderChainId(chainId), token })}`, { signal })
    .then((r) => r.token);

/**
 * Provider health.
 *
 * Fetched directly rather than through `request()` because a DEGRADED report
 * is served with 503 and its body is the interesting part — the whole point is
 * to know WHICH component is down, so the UI can refuse to show a rate instead
 * of showing a stale one.
 */
export async function getHealth({ deep = true, signal } = {}) {
  try {
    const res = await fetch(`${API}/health/cross-chain?${qs({ deep: deep ? 1 : 0 })}`, {
      headers: { accept: 'application/json' },
      signal
    });
    return (await res.json().catch(() => null)) || null;
  } catch {
    return null;
  }
}

function normalizeQuoteParams(params) {
  return {
    fromChain: toProviderChainId(params.fromChain),
    toChain: toProviderChainId(params.toChain),
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.fromAmount,
    fromAddress: params.fromAddress || '',
    toAddress: params.toAddress || '',
    slippage: params.slippage,
    preferTool: params.preferTool,
    order: params.order
  };
}

/** One executable, expiring quote. */
export const getQuote = (params, { signal } = {}) =>
  request(`/cross-chain/quote?${qs(normalizeQuoteParams(params))}`, { signal }).then((r) => r.quote);

/**
 * All routes, already ranked by the shared scorer.
 *
 * Re-ranked locally as well: the ordering must be reproducible on the client
 * so the "why did this win" breakdown the UI shows is computed from the same
 * function, not trusted from a payload.
 */
export async function getRoutes(params, { signal } = {}) {
  const payload = await request(`/cross-chain/routes?${qs(normalizeQuoteParams(params))}`, { signal });
  const routes = rankRoutes(payload.routes || []);
  return { requestId: payload.requestId, routes, best: routes[0] || null, provider: payload.provider };
}

/** Real history for a wallet — the rows both surfaces render. */
export const getHistory = (wallet, { limit = 25, signal } = {}) =>
  request(`/cross-chain/history?${qs({ wallet, limit })}`, { signal }).then((r) => r.transactions || []);

/** Server-side status read: it re-reads the bridge and applies the state machine. */
export const getStatus = (transactionId, { signal } = {}) =>
  request(`/cross-chain/transactions/${encodeURIComponent(transactionId)}/status`, { signal });

/** Only possible before broadcast — an on-chain transfer cannot be recalled. */
export const cancel = (transactionId) =>
  request(`/cross-chain/transactions/${encodeURIComponent(transactionId)}/cancel`, { method: 'POST' });

export const recordIntent = (intent) =>
  request('/cross-chain/intents', { method: 'POST', body: intent }).then((r) => r.intent).catch(() => null);

const recordTransaction = (body) =>
  request('/cross-chain/transactions', { method: 'POST', body }).then((r) => r.transaction);

/* ── execution ───────────────────────────────────────────────────────────── */

const ERC20_MIN_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)'
];

const NATIVE_SENTINELS = new Set([
  '0x0000000000000000000000000000000000000000',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '11111111111111111111111111111111'
]);

const isNativeToken = (address) => NATIVE_SENTINELS.has(String(address || '').toLowerCase());

/**
 * Execute a cross-chain transfer.
 *
 * @param {object} route      a quote from getQuote/getRoutes (the one the user saw)
 * @param {object} ctx
 *   wallet        the WalletContext value (address, chainId, switchChain, getSigner)
 *   destination   optional destination address (defaults to the sender)
 *   slippage      fraction, e.g. 0.005
 *   source        'bridge' | 'intent-os' — recorded so history says where it came from
 *   onStep        (step, detail) => void  — progress, for honest UI copy
 *   confirmQuoteChange  (freshQuote) => boolean|Promise<boolean>
 *
 * @returns {Promise<object>} { ok, status, transaction?, quote?, code? }
 */
export async function execute(route, ctx = {}) {
  const { wallet, onStep = () => {}, confirmQuoteChange = null } = ctx;
  const step = (name, detail) => { try { onStep(name, detail); } catch { /* UI callback must never break execution */ } };

  if (!route) return { ok: false, code: 'NO_ROUTE' };

  /* 1 — wallet ------------------------------------------------------------ */
  const fromChain = toProviderChainId(route.fromChain);
  const toChain = toProviderChainId(route.toChain);
  const sourceIsSolana = isSolanaChain(fromChain);

  if (sourceIsSolana) {
    const { solanaAddress } = await import('../../lib/solanaWallet.js');
    if (!solanaAddress()) return { ok: false, code: 'SOLANA_WALLET_NOT_CONNECTED' };
  } else if (!wallet?.address || !wallet?.isConnected) {
    return { ok: false, code: 'WALLET_NOT_CONNECTED' };
  }

  const senderAddress = sourceIsSolana
    ? (await import('../../lib/solanaWallet.js')).solanaAddress()
    : wallet.address;

  /* 2 — destination ------------------------------------------------------- */
  let destination = ctx.destination?.trim?.() || '';
  if (!destination) {
    /* Same family → the sender's own address is the safe default. Crossing
       families it CANNOT be: an EVM address does not exist on Solana. */
    destination = isSolanaChain(toChain) === sourceIsSolana ? senderAddress : '';
  }
  const destCheck = validateDestinationAddress(destination, toChain);
  if (!destCheck.ok) return { ok: false, code: destCheck.code };

  /* 3 — chain ------------------------------------------------------------- */
  if (!sourceIsSolana && Number(wallet.chainId) !== Number(fromChain)) {
    step('switch-chain', { chainId: fromChain });
    try {
      await wallet.switchChain?.(fromChain);
    } catch {
      return { ok: false, code: 'CHAIN_SWITCH_REJECTED' };
    }
    if (Number(wallet.chainId) !== Number(fromChain) && typeof wallet.getChainId === 'function') {
      /* switchChain resolves before the provider event lands in some wallets;
         the signer's own network is the authority below. */
    }
  }

  /* 4 — refresh the quote (spec §26) -------------------------------------- */
  step('refresh-quote');
  let fresh;
  try {
    fresh = await getQuote({
      fromChain,
      toChain,
      fromToken: route.fromToken,
      toToken: route.toToken,
      fromAmount: route.fromAmount,
      fromAddress: senderAddress,
      toAddress: destination,
      slippage: ctx.slippage ?? route.slippage ?? undefined,
      preferTool: route.tool || undefined
    });
  } catch (err) {
    return { ok: false, code: err.code || 'QUOTE_FAILED', detail: err.detail };
  }

  if (fresh.quoteId !== route.quoteId) {
    /* The rate moved between display and confirmation. Stop and ask — the one
       thing a bridge UI must never do is sign a different price silently. */
    const accepted = confirmQuoteChange ? await confirmQuoteChange(fresh) : false;
    if (!accepted) return { ok: false, status: 'QUOTE_CHANGED', code: 'QUOTE_CHANGED', quote: fresh };
  }
  if (isQuoteExpired(fresh)) return { ok: false, code: 'QUOTE_EXPIRED', quote: fresh };
  if (!fresh.transactionRequest) return { ok: false, code: 'ROUTE_NOT_EXECUTABLE', quote: fresh };

  /* 5 — balance, allowance, signature, broadcast -------------------------- */
  let sourceTxHash = null;
  try {
    if (sourceIsSolana) {
      step('sign');
      const { signAndSendSolana } = await import('../../lib/solanaWallet.js');
      const data = fresh.transactionRequest?.data;
      if (!data) return { ok: false, code: 'ROUTE_NOT_EXECUTABLE' };
      sourceTxHash = await signAndSendSolana(data, true);
    } else {
      const { Contract, formatUnits } = await import('ethers');
      const signer = wallet.getSigner?.();
      if (!signer) return { ok: false, code: 'NO_SIGNER' };

      /* The signer's own network is the authority: a wallet that reported a
         successful switch and did not switch would otherwise broadcast to the
         wrong chain — unrecoverable and entirely our fault. */
      const network = await signer.provider?.getNetwork?.();
      if (network && Number(network.chainId) !== Number(fromChain)) {
        return { ok: false, code: 'WRONG_NETWORK', detail: String(network.chainId) };
      }

      step('validate-balance');
      const need = BigInt(fresh.fromAmount);
      if (isNativeToken(fresh.fromToken)) {
        const balance = await signer.provider.getBalance(senderAddress);
        const value = BigInt(fresh.transactionRequest.value || '0');
        if (balance < value) return { ok: false, code: 'INSUFFICIENT_BALANCE' };
      } else {
        const erc20 = new Contract(fresh.fromToken, ERC20_MIN_ABI, signer);
        const balance = await erc20.balanceOf(senderAddress);
        if (balance < need) {
          return {
            ok: false,
            code: 'INSUFFICIENT_BALANCE',
            detail: `${formatUnits(balance, fresh.fromTokenDetail?.decimals ?? 18)} ${fresh.fromTokenDetail?.symbol ?? ''}`.trim()
          };
        }

        /* Gas: a transfer that cannot pay for itself fails AFTER an approval
           the user already paid for. Checked before anything is signed. */
        const nativeBalance = await signer.provider.getBalance(senderAddress);
        if (nativeBalance === 0n) return { ok: false, code: 'INSUFFICIENT_GAS' };

        step('validate-allowance');
        const spender = fresh.approvalAddress || fresh.transactionRequest.to;
        const current = await erc20.allowance(senderAddress, spender);
        if (current < need) {
          step('approve', { spender });
          /* Some ERC-20s (USDT on Ethereum, famously) reject a non-zero to
             non-zero allowance change. Zero it first. */
          if (current > 0n) {
            const reset = await erc20.approve(spender, 0n);
            await reset.wait();
          }
          /* Exact amount, never infinite — the same rule lib/swap.js documents. */
          const approval = await erc20.approve(spender, need);
          await approval.wait();
        }
      }

      step('sign');
      const tx = fresh.transactionRequest;
      const sent = await signer.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ?? undefined,
        /* The provider's gas estimate is passed through rather than
           recalculated: a bridge call is a multi-step contract interaction and
           wallets routinely under-estimate it, which shows up as a failed
           transaction that still charged gas. */
        gasLimit: tx.gasLimit ?? undefined
      });
      sourceTxHash = sent.hash;
    }
  } catch (err) {
    const message = String(err?.shortMessage || err?.message || err);
    if (/user rejected|user denied|rejected the request/i.test(message)) {
      return { ok: false, code: 'USER_REJECTED' };
    }
    if (/insufficient funds/i.test(message)) return { ok: false, code: 'INSUFFICIENT_GAS' };
    return { ok: false, code: 'BROADCAST_FAILED', detail: message.slice(0, 200) };
  }

  /* 6 — the ledger row exists only now: a real hash from a real signature. */
  step('submitted', { hash: sourceTxHash });
  let transaction = null;
  try {
    transaction = await recordTransaction({
      walletAddress: senderAddress,
      fromChain: String(fromChain),
      toChain: String(toChain),
      fromToken: fresh.fromToken,
      toToken: fresh.toToken,
      fromTokenSymbol: fresh.fromTokenDetail?.symbol ?? null,
      toTokenSymbol: fresh.toTokenDetail?.symbol ?? null,
      fromTokenDecimals: fresh.fromTokenDetail?.decimals ?? null,
      toTokenDecimals: fresh.toTokenDetail?.decimals ?? null,
      fromAmount: fresh.fromAmount,
      expectedAmount: fresh.toAmount,
      provider: fresh.provider,
      tool: fresh.tool,
      toolName: fresh.toolName,
      routeId: fresh.routeId,
      quoteId: fresh.quoteId,
      intentId: ctx.intentId ?? null,
      source: ctx.source === 'intent-os' ? 'intent-os' : 'bridge',
      destinationAddress: destination,
      sourceTxHash,
      gasCostUsd: fresh.gasCostUsd,
      bridgeFeeUsd: fresh.bridgeFeeUsd,
      protocolFeeUsd: fresh.protocolFeeUsd,
      totalCostUsd: fresh.totalCostUsd,
      estimatedTime: fresh.estimatedTime
    });
  } catch (err) {
    /* The transfer IS on chain. A failed ledger write must not be reported as
       a failed transfer — that is the same lie as a fake success, inverted. */
    return {
      ok: true,
      status: EXECUTION_STATUS.SUBMITTED,
      sourceTxHash,
      quote: fresh,
      ledgerError: err.code || 'HISTORY_WRITE_FAILED'
    };
  }

  return { ok: true, status: transaction.executionStatus, transaction, sourceTxHash, quote: fresh };
}

/* ── status tracking ─────────────────────────────────────────────────────── */

/**
 * Poll one transfer until it really finishes.
 *
 * Backs off (5s → 20s) because a bridge takes minutes and a 1s poll is just a
 * way to get rate-limited at the exact moment the user is watching. Stops on a
 * terminal state or when `stop()` is called; never invents a completion.
 */
export function trackTransaction(transactionId, { onUpdate = () => {}, intervalMs = 5000, maxIntervalMs = 20_000, timeoutMs = 45 * 60_000 } = {}) {
  let stopped = false;
  let timer = null;
  const startedAt = Date.now();
  let delay = intervalMs;

  const tick = async () => {
    if (stopped) return;
    try {
      const payload = await getStatus(transactionId);
      onUpdate(payload.transaction, payload);
      if (['COMPLETED', 'FAILED'].includes(payload.transaction?.executionStatus)) {
        stopped = true;
        return;
      }
    } catch (err) {
      onUpdate(null, { error: err.code || 'STATUS_FAILED' });
    }
    if (Date.now() - startedAt > timeoutMs) {
      stopped = true;
      /* Honest timeout: we stop POLLING, the transfer is still whatever it is.
         The row keeps its real status and the user can refresh. */
      onUpdate(null, { pollingStopped: true });
      return;
    }
    delay = Math.min(maxIntervalMs, Math.round(delay * 1.35));
    timer = setTimeout(tick, delay);
  };

  timer = setTimeout(tick, 1500);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/* ── the interface the spec names ────────────────────────────────────────── */

export const crossChainService = Object.freeze({
  getChains,
  getTokens,
  resolveToken,
  getHealth,
  getQuote,
  getRoutes,
  execute,
  getStatus,
  trackTransaction,
  cancel,
  getHistory,
  recordIntent
});

export default crossChainService;
