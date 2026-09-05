/**
 * SWAP AGGREGATOR PROXY — same-origin fallback for unreachable networks
 * ---------------------------------------------------------------------------
 * The swap screen quotes KyberSwap and OpenOcean straight from the browser.
 * That is fast and decentralised, but it fails hard for a user whose network
 * cannot reach those domains: geo-filtering, an ISP that throttles or blocks
 * them, national censorship. Iranian customers hit all three, and the symptom
 * they reported was the swap screen answering «مسیری برای این تراکنش وجود
 * ندارد» ("no route") on pairs with plenty of liquidity.
 *
 * The app's OWN origin is reachable by anyone who can open the app at all —
 * that is the one network guarantee we actually have. So the client retries
 * a failed direct call through these routes (lib/aggregator.js,
 * lib/openocean.js and lib/velora.js), and this module forwards the
 * IDENTICAL request from a datacenter where the aggregators are reachable.
 *
 * Velora's proxy exists for the same reason as the other two even though it
 * only ever QUOTES (never executes, see lib/velora.js) — a price-comparison
 * source that silently goes dark for exactly the users whose network is
 * already filtered is still worth keeping alive, and Iranian customers are
 * disproportionately the ones who would otherwise never see it win a
 * comparison at all.
 *
 * ─── SECURITY BOUNDARIES ────────────────────────────────────────────────────
 * • No open proxy. Only five fixed upstream shapes exist, each with a
 *   chain-id -> slug allowlist (Velora's is a network-id passthrough, since
 *   its API takes the numeric chain id directly, not a slug); a caller
 *   cannot make this server fetch an arbitrary URL (no SSRF).
 * • The upstream host is always a compile-time constant. The only caller
 *   input is the query string / JSON body, forwarded verbatim.
 * • An upstream that fails or times out returns 502/504 with an opaque
 *   error; it never throws into Express.
 *
 * ─── WHY NOT SERVER-SIDE FEE FIELDS HERE ────────────────────────────────────
 * Unlike the Solana path (server/solanaOcean.js), the EVM fee fields are
 * compiled-in constants verified by the client before signing (KyberSwap's
 * extraFee echo, OpenOcean's decoded referrer), so forwarding the request
 * verbatim keeps ONE source of truth for fee assembly. The proxy is a
 * reachability fix, not a fee boundary — see lib/openocean.js and
 * lib/aggregator.js for the actual fee guarantees.
 */

const KYBER_BASE = 'https://aggregator-api.kyberswap.com';
const OO_BASE = 'https://open-api.openocean.finance/v4';
const VELORA_BASE = 'https://api.velora.xyz';

/** KyberSwap chain id -> network slug. Must mirror lib/aggregator.js. */
const KYBER_SLUG = {
  56: 'bsc',
  1: 'ethereum',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  43114: 'avalanche',
  59144: 'linea',
  146: 'sonic',
  /* The 2026-09 additions. These MUST stay in lockstep with lib/aggregator.js:
     a slug missing HERE (but present client-side) is a silent outage for the
     exact users the proxy exists for — anyone whose network cannot reach the
     aggregator directly. Their client would retry through this proxy, get
     CHAIN_UNSUPPORTED, and the swap screen would answer "no route" for a
     perfectly routable pair. */
  5000: 'mantle',
  80094: 'berachain',
  130: 'unichain',
  143: 'monad'
};

/** OpenOcean chain id -> network slug. Must mirror lib/openocean.js. */
const OO_SLUG = {
  56: 'bsc',
  1: 'eth',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  43114: 'avax',
  /* Same lockstep rule as KYBER_SLUG above. */
  59144: 'linea',
  146: 'sonic',
  5000: 'mantle',
  80094: 'berachain',
  130: 'unichain',
  143: 'monad'
};

/** Chains Velora supports. Must mirror the SUPPORTED set in lib/velora.js. */
const VELORA_CHAINS = new Set([1, 56, 137, 42161, 10, 8453, 43114]);

export const kyberSlug = (chainId) => KYBER_SLUG[Number(chainId)] ?? null;
export const ooSlug = (chainId) => OO_SLUG[Number(chainId)] ?? null;
export const veloraChainOk = (chainId) => VELORA_CHAINS.has(Number(chainId));

/** Identifies our app upstream. Same value the client sends directly. */
const CLIENT_ID = 'fbt-swap';

const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);

/**
 * Build the upstream URL for a KyberSwap request.
 *
 * `params` is the query object the client sent; `chainId` is consumed here
 * (it is our routing key, not an upstream parameter) and everything else is
 * forwarded verbatim.
 */
export function kyberUpstreamUrl(kind, params = {}) {
  const slug = kyberSlug(params.chainId);
  if (!slug) throw new Error('CHAIN_UNSUPPORTED');
  const q = new URLSearchParams(params);
  q.delete('chainId');
  if (kind === 'routes') return `${KYBER_BASE}/${slug}/api/v1/routes?${q.toString()}`;
  if (kind === 'build') return `${KYBER_BASE}/${slug}/api/v1/route/build`;
  throw new Error('BAD_KIND');
}

/** Build the upstream URL for an OpenOcean request (`kind` = quote | swap). */
export function ooUpstreamUrl(kind, params = {}) {
  const slug = ooSlug(params.chainId);
  if (!slug) throw new Error('CHAIN_UNSUPPORTED');
  const q = new URLSearchParams(params);
  q.delete('chainId');
  return `${OO_BASE}/${slug}/${kind}?${q.toString()}`;
}

/**
 * Build the upstream URL for a Velora price request. Velora's API takes the
 * numeric chain id directly as `network` (already present in `params`), so
 * unlike Kyber/OpenOcean there is no slug translation — only the allowlist
 * check, which is what actually prevents an arbitrary upstream host.
 */
export function veloraUpstreamUrl(params = {}) {
  if (!veloraChainOk(params.network)) throw new Error('CHAIN_UNSUPPORTED');
  const q = new URLSearchParams(params);
  return `${VELORA_BASE}/prices?${q.toString()}`;
}

async function upstream({ url, method = 'GET', body = null, headers = {} }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      method,
      body,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...headers }
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON upstream body — pass it through as text */
    }
    if (!res.ok) {
      return {
        status: 502,
        body: { error: `UPSTREAM_HTTP_${res.status}`, detail: json ?? text.slice(0, 300) }
      };
    }
    return { status: res.status, body: json ?? text };
  } catch (e) {
    return { status: 504, body: { error: 'UPSTREAM_UNREACHABLE', detail: e.message } };
  } finally {
    clearTimeout(timer);
  }
}

/** GET /{slug}/api/v1/routes — quote/route search. */
export async function proxyKyberRoutes(params = {}) {
  let url;
  try {
    url = kyberUpstreamUrl('routes', params);
  } catch {
    return { status: 400, body: { error: 'CHAIN_UNSUPPORTED' } };
  }
  return upstream({ url, headers: { 'x-client-id': CLIENT_ID } });
}

/** POST /{slug}/api/v1/route/build — turn a route summary into calldata. */
export async function proxyKyberBuild(body = {}) {
  const slug = kyberSlug(body.chainId);
  if (!slug) return { status: 400, body: { error: 'CHAIN_UNSUPPORTED' } };
  const payload = { ...body };
  delete payload.chainId;
  payload.source = CLIENT_ID;
  return upstream({
    url: `${KYBER_BASE}/${slug}/api/v1/route/build`,
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'x-client-id': CLIENT_ID }
  });
}

/** GET /v4/{slug}/quote — OpenOcean price quote. */
export async function proxyOoQuote(params = {}) {
  let url;
  try {
    url = ooUpstreamUrl('quote', params);
  } catch {
    return { status: 400, body: { error: 'CHAIN_UNSUPPORTED' } };
  }
  return upstream({ url });
}

/** GET /v4/{slug}/swap — OpenOcean signable transaction body. */
export async function proxyOoSwap(params = {}) {
  let url;
  try {
    url = ooUpstreamUrl('swap', params);
  } catch {
    return { status: 400, body: { error: 'CHAIN_UNSUPPORTED' } };
  }
  return upstream({ url });
}

/** GET /prices — Velora's quote-only price comparison. */
export async function proxyVeloraPrices(params = {}) {
  let url;
  try {
    url = veloraUpstreamUrl(params);
  } catch {
    return { status: 400, body: { error: 'CHAIN_UNSUPPORTED' } };
  }
  return upstream({ url });
}
