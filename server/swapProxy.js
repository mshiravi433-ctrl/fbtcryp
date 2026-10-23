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
const OO_ENTERPRISE_ROOT = 'https://open-api-enterprise.de1.exchange/v4';
const OO_PUBLIC_ROOT = 'https://open-api.openocean.finance/v4';
const OO_BASE = OO_PUBLIC_ROOT;
const VELORA_BASE = 'https://api.velora.xyz';

export const apiKey = () => process.env.OPENOCEAN_API_KEY || '';

/**
 * OpenOcean root ladder: tries operator override (if configured), then De1 enterprise root,
 * then public root.
 */
export function ooRoots() {
  const roots = [];
  const override = String(process.env.OPENOCEAN_BASE_URL || '').trim().replace(/\/+$/, '');
  if (override) roots.push(override);
  for (const root of [OO_ENTERPRISE_ROOT, OO_PUBLIC_ROOT]) {
    if (!roots.includes(root)) roots.push(root);
  }
  return roots;
}

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
  /* The 2026-09 additions. These MUST stay in lockstep with the slug map in
     lib/aggregator.js: a slug missing HERE (but present client-side) is a
     silent outage for the exact users the proxy exists for — anyone whose
     network cannot reach the aggregator directly. Their client would retry
     through this proxy, get CHAIN_UNSUPPORTED, and the swap screen would
     answer "no route" for a perfectly routable pair.
     NOTE 2026-09-11: Kyber's GATEWAY answers HTTP 404 for the `mantle`,
     `scroll` and `zksync` slugs, so the client no longer routes those chains
     through Kyber at all (KYBER_LIVE in lib/aggregator.js gates them; they
     swap via OpenOcean). The entries stay so this map remains a true mirror
     of the client's NETWORK_SLUG — a forwarded request to a dead slug simply
     relays the upstream 404 as a 502, which is the honest answer. */
  5000: 'mantle',
  80094: 'berachain',
  130: 'unichain',
  143: 'monad',
  /* Robinhood Chain — gateway live-probed 2026-09-13 (routes + fee echo). */
  4663: 'robinhood',
  534352: 'scroll',
  324: 'zksync'
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
  /* Corrected 2026-09-13 against OpenOcean's supported-chains table: their
     chain codes are `bera` and `uni` — the previous `berachain`/`unichain`
     spellings answered 404, so the proxy silently never served the
     second-opinion quote on those two chains. */
  80094: 'bera',
  130: 'uni',
  143: 'monad',
  /* Scroll + zkSync Era — same lockstep rule as above. Since 2026-09-11 these
     two (plus Mantle) are OpenOcean-only chains client-side, so this proxy
     path is their reachability fallback of LAST resort — the one standing
     between a geo-blocked user and «مسیری بین این دو توکن وجود ندارد». */
  534352: 'scroll',
  324: 'zksync',
  /* Robinhood Chain — OpenOcean's chain code for it IS the chain id. */
  4663: '4663'
};

/** Alternate slug candidates for chains that accept mainnet suffixes in some deployments. */
const OO_SLUG_ALTERNATES = {
  324: ['zksync', 'zksync-mainnet'],
  534352: ['scroll', 'scroll-mainnet'],
  5000: ['mantle', 'mantle-mainnet'],
  143: ['monad', 'monad-mainnet'],
  4663: ['4663', 'robinhood']
};

export function ooSlugCandidates(chainId) {
  const cid = Number(chainId);
  const alts = OO_SLUG_ALTERNATES[cid];
  if (alts && alts.length) return alts;
  const primary = ooSlug(cid);
  return primary ? [primary] : [];
}

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

/**
 * Perform an OpenOcean upstream request across the root ladder.
 * Tries the configured roots with API keys where available, handling Cloudflare
 * challenges and auth errors gracefully.
 */
async function ooUpstreamCall(kind, params = {}, { method = 'GET', body = null } = {}) {
  const chainId = params.chainId;
  const slugs = ooSlugCandidates(chainId);
  if (!slugs.length) return { status: 400, body: { error: 'CHAIN_UNSUPPORTED' } };

  const q = new URLSearchParams(params);
  q.delete('chainId');
  const qs = q.toString();

  const roots = ooRoots();
  const key = apiKey();
  let lastFailure = null;

  for (const root of roots) {
    for (const slug of slugs) {
      const pathUrl = `${root}/${slug}/${kind}${qs ? '?' + qs : ''}`;
      const urlObj = new URL(pathUrl);
      const headers = { 'content-type': 'application/json', accept: 'application/json' };
      if (key) {
        headers['x-api-key'] = key;
        urlObj.searchParams.set('apikey', key);
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
      try {
        const res = await fetch(urlObj.toString(), {
          method,
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
          headers
        });
        const text = await res.text();
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = { message: text.slice(0, 300) };
        }

        // OpenOcean standard success: code === 200 or res.ok with data
        if (res.ok && parsed && (parsed.code === 200 || parsed.data || kind === 'decodeInputData')) {
          clearTimeout(timer);
          return { status: res.status, body: parsed };
        }

        const isAuthError =
          (res.status === 401 || res.status === 403) &&
          /api\s*key|unauthorized/i.test(String(parsed?.message || text));
        const isCloudflare =
          (res.status === 403 || res.status === 503) &&
          /cloudflare|just a moment/i.test(text);

        lastFailure = {
          status: res.status === 400 ? 400 : 502,
          body: parsed ?? { error: `UPSTREAM_HTTP_${res.status}`, detail: text.slice(0, 300) }
        };

        // If client passed bad parameters (400) and it's not a Cloudflare or auth rejection, return early
        if (res.status === 400 && !isCloudflare && !isAuthError) {
          clearTimeout(timer);
          return lastFailure;
        }
      } catch (err) {
        lastFailure = { status: 504, body: { error: 'UPSTREAM_UNREACHABLE', detail: err.message } };
      } finally {
        clearTimeout(timer);
      }
    }
  }

  return lastFailure ?? { status: 502, body: { error: 'UPSTREAM_FAILED' } };
}

/** GET /v4/{slug}/quote — OpenOcean price quote. */
export async function proxyOoQuote(params = {}) {
  const slug = ooSlug(params.chainId);
  if (!slug) return { status: 400, body: { error: 'CHAIN_UNSUPPORTED' } };
  return ooUpstreamCall('quote', params);
}

/** GET /v4/{slug}/swap — OpenOcean signable transaction body. */
export async function proxyOoSwap(params = {}) {
  const slug = ooSlug(params.chainId);
  if (!slug) return { status: 400, body: { error: 'CHAIN_UNSUPPORTED' } };
  return ooUpstreamCall('swap', params);
}

/**
 * POST /v4/{slug}/decodeInputData — decode a built swap's calldata so the
 * client can verify our referrer is inside the transaction before signing.
 *
 * Without this proxy, a user whose network cannot reach OpenOcean directly
 * could get a quote (via proxyOoQuote) and build a swap (via proxyOoSwap)
 * but then fail fee verification at the last step and be told FEE_NOT_APPLIED
 * for a route that actually paid us. That is exactly the SCR / ZK / Mantle
 * path: OpenOcean is the only routing source, so a dead verify call is a
 * total swap outage after a working quote.
 *
 * `chainId` is consumed for slug lookup; `data` + optional `method` are the
 * body OpenOcean expects.
 */
export async function proxyOoDecode(params = {}) {
  const slug = ooSlug(params.chainId);
  if (!slug) return { status: 400, body: { error: 'CHAIN_UNSUPPORTED' } };
  const payload = {
    data: params.data,
    method: params.method || 'swap'
  };
  if (payload.data == null || payload.data === '') {
    return { status: 400, body: { error: 'MISSING_CALLDATA' } };
  }
  return ooUpstreamCall('decodeInputData', { chainId: params.chainId }, { method: 'POST', body: payload });
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
