/**
 * NFT VIEWER — read-only.
 *
 * Lists the NFTs already held by an address. Nothing here can buy, sell,
 * approve or transfer anything: it is a GET against an indexer and a
 * normalisation pass. That is deliberate — a marketplace needs
 * verified-collection data and a fraud process we do not have, whereas showing
 * someone what they already own carries no such risk.
 *
 * ─── EVERYTHING HERE IS ATTACKER-CONTROLLED ────────────────────────────────
 * Anyone can mint an NFT into anyone else's wallet, for free, with any
 * metadata they like. Airdropped scam NFTs are extremely common and their
 * name/description fields are the payload: "Visit claim-airdrop.xyz to unlock
 * $5,000", often with markup or a lookalike domain.
 *
 * So every string that leaves this module is:
 *   - stripped of angle brackets, quotes and control characters
 *   - stripped of Unicode bidi overrides (which can make a URL render
 *     backwards, so `moc.dab.evil` displays as `evil.bad.com`)
 *   - length-capped
 *
 * and every image URL is forced to https (or ipfs:// rewritten to a gateway).
 * `data:` and `javascript:` image URLs are dropped entirely.
 *
 * The client renders these as plain text, never as HTML.
 */

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY || '';

/**
 * Alchemy's NFT API host per chain.
 *
 * BNB Chain is deliberately absent: Alchemy's NFT endpoints do not cover it,
 * and silently returning an empty list for a chain we claim to support would
 * read as "you own nothing" rather than "we cannot check here". The client is
 * told which chains are supported so it can say so.
 */
const HOSTS = {
  1: 'eth-mainnet',
  137: 'polygon-mainnet',
  42161: 'arb-mainnet',
  8453: 'base-mainnet',
  10: 'opt-mainnet'
};

export const nftChains = () => Object.keys(HOSTS).map(Number);
export const nftConfigured = () => Boolean(ALCHEMY_KEY);

/**
 * Ask Alchemy whether the configured key actually works.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `nftConfigured()` only proves the variable is SET. When the key was replaced
 * and NFTs still failed, there was no way to tell which of these was true:
 *
 *   • the new value never reached the running server (no redeploy)
 *   • the value reached it but is malformed (quotes, whitespace, truncated)
 *   • the key is genuine but the account/network is not enabled
 *
 * All three produce the identical NFT_KEY_REJECTED, so the fix is guesswork.
 * This makes one real request and reports the upstream status code plus a
 * FINGERPRINT of the key — never the key itself, which sits in the URL path
 * and must never be echoed to a caller.
 *
 * The fingerprint is what makes "did my redeploy take effect?" answerable: if
 * it does not change after you save a new value, the server is still running
 * the old one.
 */
export async function nftDiagnose(chainId = 1) {
  if (!ALCHEMY_KEY) return { configured: false, reason: 'NOT_SET' };

  const host = HOSTS[Number(chainId)];
  if (!host) return { configured: true, reason: 'CHAIN_NOT_SUPPORTED' };

  /*
   * Shape checks first — these catch the copy/paste mistakes without spending
   * a request, and they are the most common cause after a manual edit.
   */
  const raw = process.env.ALCHEMY_API_KEY || '';
  const shape = {
    length: ALCHEMY_KEY.length,
    // A pasted value that still carries quotes or spaces is a real and
    // invisible failure: Vercel stores exactly what you typed.
    hasWhitespace: raw !== raw.trim(),
    hasQuotes: /^["']|["']$/.test(raw),
    looksLikeUrl: /^https?:\/\//i.test(ALCHEMY_KEY),
    // First and last 4 characters only. Enough to tell two keys apart,
    // useless to anyone who wants to use it.
    fingerprint:
      ALCHEMY_KEY.length >= 8
        ? `${ALCHEMY_KEY.slice(0, 4)}…${ALCHEMY_KEY.slice(-4)}`
        : '(too short)'
  };

  /*
   * ─── WHY THIS PROBES SEVERAL QUERY SHAPES ───────────────────────────────
   * The first version of this sent only `?owner=&pageSize=1` and reported
   * status 200 while the real NFT call kept failing with KEY_REJECTED. That
   * proved the key and the account are fine and moved the suspicion to the
   * PARAMETERS the real call adds — which the diagnostic was not sending, so
   * it could not see the failure at all.
   *
   * A diagnostic that exercises a different request than the broken one is
   * worse than none: it produces a confident all-clear for a system that is
   * still down. Each variant below is now tested separately so the response
   * names the parameter at fault instead of the caller having to guess.
   */
  const probe = '0x0000000000000000000000000000000000000001';
  const base = `https://${host}.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForOwner`;

  const variants = {
    minimal: `?owner=${probe}&pageSize=1`,
    withMetadata: `?owner=${probe}&withMetadata=true&pageSize=1`,
    // Raw brackets, the old shape — kept so the response shows whether THIS
    // is what Alchemy rejects.
    spamFilterRaw: `?owner=${probe}&excludeFilters[]=SPAM&pageSize=1`,
    spamFilterEncoded: `?owner=${probe}&excludeFilters%5B%5D=SPAM&pageSize=1`,
    // Exactly what fetchNfts() now sends, so a green result here means the
    // real path works and anything else is a genuine, reproducible failure.
    production: (() => {
      const q = new URLSearchParams({ owner: probe, withMetadata: 'true', pageSize: '50' });
      q.append('excludeFilters[]', 'SPAM');
      return `?${q}`;
    })()
  };

  const results = {};
  for (const [name, qs] of Object.entries(variants)) {
    try {
      const res = await fetch(`${base}${qs}`, { headers: { accept: 'application/json' } });
      let detail = null;
      if (!res.ok) {
        // Upstream error text can name the offending parameter. It is
        // truncated and never contains the key, which lives in the path.
        detail = (await res.text()).slice(0, 160).replace(/\s+/g, ' ');
      }
      results[name] = { status: res.status, ok: res.ok, ...(detail ? { detail } : {}) };
    } catch {
      results[name] = { status: 0, ok: false, detail: 'UNREACHABLE' };
    }
  }

  const prod = results.production;
  return {
    configured: true,
    ok: Boolean(prod?.ok),
    status: prod?.status ?? 0,
    reason: prod?.ok
      ? 'OK'
      : prod?.status === 401 || prod?.status === 403
        ? 'KEY_REJECTED'
        : prod?.status === 429
          ? 'RATE_LIMITED'
          : prod?.status === 400
            ? 'BAD_REQUEST'
            : 'UPSTREAM_ERROR',
    // Which parameter breaks it, if any.
    variants: results,
    shape
  };
}

/** Unicode ranges that let text render right-to-left or hide characters. */
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;

export function clean(value, max = 120) {
  return String(value ?? '')
    .replace(BIDI, '')
    // Angle brackets and quotes cannot start markup once removed; control
    // characters can hide the rest of a string in a log or a terminal.
    .replace(/[<>"'`\\\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Only https and ipfs images survive. ipfs:// is rewritten to a public
 * gateway because a WebView cannot resolve the protocol itself.
 */
export function safeImage(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${raw.slice(7).replace(/^ipfs\//, '')}`;
  }
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

async function req(url, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) {
      const err = new Error(`Alchemy ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the NFTs owned by `owner` on `chainId`.
 *
 * `spam` filtering is requested from the indexer, which is a genuine help but
 * not a guarantee — the client still labels unverified items rather than
 * implying anything here has been vetted by us.
 */
export async function fetchNfts(chainId, owner, { limit = 50 } = {}) {
  if (!ALCHEMY_KEY) throw new Error('NFT_NOT_CONFIGURED');
  const host = HOSTS[Number(chainId)];
  if (!host) throw new Error('CHAIN_NOT_SUPPORTED');
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(owner))) throw new Error('BAD_ADDRESS');

  /*
   * Built with URLSearchParams rather than string concatenation.
   *
   * The previous version interpolated `excludeFilters[]=SPAM` directly. Square
   * brackets are not valid unencoded in a query string, and whether a gateway
   * accepts them or rejects the whole request with a 4xx is not something to
   * leave to chance — especially when the resulting error is indistinguishable
   * from a bad API key, which is exactly the confusion this cost.
   *
   * URLSearchParams percent-encodes them correctly, and also removes the
   * possibility of an address ever injecting a parameter of its own (the
   * address is already regex-validated above, but two checks on a URL that
   * carries our API key is the right number).
   */
  const qs = new URLSearchParams({
    owner: String(owner),
    withMetadata: 'true',
    pageSize: String(Math.min(100, limit))
  });
  qs.append('excludeFilters[]', 'SPAM');

  const url = `https://${host}.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForOwner?${qs}`;

  /*
   * TRANSLATE UPSTREAM FAILURES INTO SOMETHING ACTIONABLE.
   *
   * `req` throws `HTTP 403`, which reached the client as the generic
   * UPSTREAM_FAILED and rendered as "something went wrong" — the reported
   * symptom. But 403 from Alchemy has exactly one common cause: the key is
   * revoked, wrong, or has that network disabled on the dashboard. Saying so
   * turns an unactionable error into a two-minute fix.
   *
   * The key itself is in the URL path, so error text must never be echoed to
   * the client verbatim — these are fixed codes, not upstream messages.
   */
  let raw;
  try {
    raw = await req(url);
  } catch (err) {
    const msg = String(err?.message || '');
    if (/\b401\b|\b403\b/.test(msg)) throw new Error('NFT_KEY_REJECTED');
    if (/\b429\b/.test(msg)) throw new Error('NFT_RATE_LIMITED');
    if (/\b5\d\d\b/.test(msg)) throw new Error('NFT_UPSTREAM_DOWN');
    throw new Error('FAILED');
  }

  const items = (raw?.ownedNfts ?? []).map((n) => {
    const contract = n?.contract ?? {};
    return {
      // A composite id: tokenId alone is not unique across collections.
      id: `${contract.address}:${n.tokenId}`,
      contract: clean(contract.address, 42),
      tokenId: clean(n.tokenId, 78),
      name: clean(n.name || `#${n.tokenId}`, 80),
      collection: clean(contract.name || contract.symbol || '', 60),
      image: safeImage(n?.image?.thumbnailUrl || n?.image?.cachedUrl || n?.image?.originalUrl),
      standard: contract.tokenType === 'ERC1155' ? 'ERC1155' : 'ERC721',
      balance: Number(n.balance) || 1,
      /*
       * Alchemy's own verification signal, passed straight through. We do NOT
       * upgrade it to "safe": a verified collection means the indexer
       * recognises it, not that buying it is a good idea.
       */
      verified: contract?.openSeaMetadata?.safelistRequestStatus === 'verified'
    };
  });

  return {
    items: items.slice(0, limit),
    total: Number(raw?.totalCount) || items.length,
    chainId: Number(chainId)
  };
}
