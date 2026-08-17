import { apiBase } from './apiBase';
/**
 * Whale tracking client.
 *
 * Calls /api/news/whales server-side. Abort-aware, retries once on network
 * failure only, does not fall back to fake events. Times out at 15s so a
 * wedged upstream never blocks UI.
 */


const DEFAULT_OPTS = {
  minUsd: 100_000,
  chains: [],
  q: '',
  since: 0,
  vs: 'usd',
  limit: 40
};

export const EVENT_KINDS = ['transfer', 'mint', 'burn', 'inflow', 'outflow', 'contract'];

/** Normalise a server event into the shape the UI expects. */
export function normalizeEvent(e) {
  return {
    id: e.id,
    chainId: Number(e.chainId),
    chainShort: e.chainShort,
    chainName: e.chainName,
    chainColor: e.chainColor,
    kind: EVENT_KINDS.includes(e.kind) ? e.kind : 'transfer',
    token: {
      symbol: e.token?.symbol ?? '???',
      name: e.token?.name ?? 'Unknown',
      address: e.token?.address ?? null,
      decimals: Number(e.token?.decimals ?? 18),
      verified: Boolean(e.token?.verified),
      coingeckoId: e.token?.coingeckoId ?? null
    },
    amount: Number(e.amount) || 0,
    valueUsd: e.valueUsd == null ? null : Number(e.valueUsd),
    usdPrice: e.usdPrice == null ? null : Number(e.usdPrice),
    from: {
      address: e.from?.address ?? null,
      label: e.from?.label ?? null,
      short: e.from?.short ?? ''
    },
    to: {
      address: e.to?.address ?? null,
      label: e.to?.label ?? null,
      short: e.to?.short ?? ''
    },
    hash: e.hash,
    blockNumber: e.blockNumber ?? null,
    timestamp: e.timestamp ?? null,
    explorerTx: e.explorerTx ?? null,
    explorerFrom: e.explorerFrom ?? null,
    explorerTo: e.explorerTo ?? null
  };
}

export function validateResponseShape(json) {
  if (!json || typeof json !== 'object') return false;
  if (json.schema !== 'fbt.whales.v1') return false;
  if (!Array.isArray(json.events)) return false;
  for (const e of json.events) {
    if (!e.id || !e.chainId || !e.hash) return false;
    if (!e.token || !e.token.symbol) return false;
  }
  return true;
}

/**
 * Fetch whales.
 *
 * @param {AbortSignal} [signal]
 */
export async function fetchWhales(opts = {}, signal) {
  const params = { ...DEFAULT_OPTS, ...opts };
  const qs = new URLSearchParams();
  qs.set('minUsd', String(params.minUsd));
  if (params.chains?.length) qs.set('chains', params.chains.join(','));
  if (params.q) qs.set('q', params.q);
  if (params.since) qs.set('since', String(params.since));
  if (params.vs) qs.set('vs', params.vs);
  qs.set('limit', String(params.limit));

  const url = `${apiBase()}/news/whales?${qs.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let outerSignal;
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw new Error('ABORTED');
    }
    outerSignal = signal;
    signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (res.status === 429) {
        clearTimeout(timer);
        const retry = res.headers.get('retry-after');
        const err = new Error('RATE_LIMITED');
        err.status = 429;
        err.retryAfter = retry ? Number(retry) : 30;
        throw err;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        lastErr = new Error(`HTTP ${res.status} ${text.slice(0, 80)}`);
        lastErr.status = res.status;
        // do not retry on 4xx other than 429
        if (res.status < 500) break;
        continue;
      }
      const json = await res.json();
      clearTimeout(timer);
      if (!validateResponseShape(json)) {
        throw new Error('BAD_SHAPE');
      }
      return {
        ...json,
        events: json.events.map(normalizeEvent)
      };
    } catch (err) {
      lastErr = err;
      if (err?.name === 'AbortError') break;
      if (err?.status === 429) break;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 700));
      }
    }
  }
  clearTimeout(timer);
  throw lastErr || new Error('WHALES_FAILED');
}
