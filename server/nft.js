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

  const url =
    `https://${host}.g.alchemy.com/nft/v3/${ALCHEMY_KEY}/getNFTsForOwner` +
    `?owner=${owner}&withMetadata=true&excludeFilters[]=SPAM&pageSize=${Math.min(100, limit)}`;

  const raw = await req(url);

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
