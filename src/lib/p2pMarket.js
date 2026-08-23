/**
 * P2P MARKET — client side. Thin by design.
 * ---------------------------------------------------------------------------
 * Everything that decides money lives on the server (server/hodlhodl.js):
 * parameter allow-listing, offer normalisation, the give/get arithmetic, the
 * fee parsing and — above all — the referral link, which the server builds
 * from HODLHODL_REF so no browser code can point the revenue at another
 * code. This module carries no key and no fee logic. If it is ever taught
 * to build trade URLs itself, it has become the theft vector the server
 * boundary exists to remove.
 *
 * ─── THIS FILE MUST NEVER LEARN TO PRICE SWAPS ────────────────────────────
 * Same boundary as src/lib/fiat.js: this is fiat<->BTC market data for the
 * Buy and P2P screens ONLY. The swap path prices itself through its own
 * aggregators; nothing here may feed a crypto-to-crypto quote, and nothing
 * on those screens may import this file (enforced by a wiring check — a
 * diverted swapper costs ~25x the revenue of everything this market earns).
 *
 * ─── META IS FETCHED ONCE, NOT PER KEYSTROKE ──────────────────────────────
 * Upstream's anonymous budget is tight (2 reads/minute, answered 429), so
 * currencies/countries/payment methods are requested once per session and
 * memoized; the offers call is debounced and aborted in the component. No
 * waterfall, ever.
 */

import { apiBase } from './apiBase.js';

async function request(path, { signal, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  /* Link the caller's abort into ours so either cancels the fetch. */
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body?.error || 'REQUEST_FAILED',
        detail: body?.detail || null,
        retryable: body?.retryable !== false
      };
    }
    return { ok: true, status: res.status, data: body };
  } catch (err) {
    if (err?.name === 'AbortError') {
      /* The component's own cancellation is not an error state — it just
         means a newer request won. */
      return { ok: false, aborted: true, error: 'ABORTED' };
    }
    return { ok: false, status: 0, error: 'NETWORK', detail: err?.message || 'unreachable', retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live offers.
 *
 * @param {object} p
 *   side: 'buy' | 'sell'   — the USER's direction; the server maps it onto
 *                            Hodl Hodl's inverted offer vocabulary.
 *   currency, paymentMethod, country, amount, layer, workingNow, limit, offset
 */
export function fetchP2POffers(p, { signal } = {}) {
  const q = new URLSearchParams();
  q.set('side', p.side === 'sell' ? 'sell' : 'buy');
  if (p.currency) q.set('currency', p.currency);
  if (p.paymentMethod) q.set('paymentMethod', p.paymentMethod);
  if (p.country) q.set('country', p.country);
  if (p.amount) q.set('amount', String(p.amount));
  if (p.layer && p.layer !== 'any') q.set('layer', p.layer);
  if (p.workingNow) q.set('workingNow', '1');
  if (p.limit) q.set('limit', String(p.limit));
  if (p.offset) q.set('offset', String(p.offset));
  return request(`/p2p/offers?${q.toString()}`, { signal });
}

export function fetchP2PStatus() {
  return request('/p2p/status');
}

/* ------------------------------------------------------------------------- */
/* Meta (currencies / payment methods), memoized per session                  */
/* ------------------------------------------------------------------------- */

const META_TTL_MS = 10 * 60 * 1000;
const metaCache = new Map(); /* key -> { at, value, inflight } */

async function memoized(key, loader) {
  const hit = metaCache.get(key);
  if (hit?.value && Date.now() - hit.at < META_TTL_MS) return hit.value;
  if (hit?.inflight) return hit.inflight;
  const inflight = (async () => {
    const r = await loader();
    const value = r.ok ? r.data : null;
    /* Keep the previous good value on failure — a currency list that is ten
       minutes older beats a picker that renders empty. */
    metaCache.set(key, { at: Date.now(), value: value ?? hit?.value ?? null, inflight: null });
    return metaCache.get(key).value;
  })().catch(() => metaCache.get(key)?.value ?? null);
  metaCache.set(key, { at: hit?.at ?? 0, value: hit?.value ?? null, inflight });
  return inflight;
}

/**
 * One parallel fetch of every picker list the market UI needs. The component
 * calls this ONCE per mount session; filter changes never re-request it.
 */
export async function fetchP2PMeta() {
  const [currencies, countries, paymentMethods] = await Promise.all([
    memoized('currencies', () => request('/p2p/currencies')),
    memoized('countries', () => request('/p2p/countries')),
    memoized('payment-methods', () => request('/p2p/payment-methods'))
  ]);
  return {
    currencies: currencies?.currencies ?? [],
    countries: countries?.countries ?? [],
    paymentMethods: paymentMethods?.paymentMethods ?? []
  };
}

/** Test seam. */
export function _clearP2PMetaCache() {
  metaCache.clear();
}
