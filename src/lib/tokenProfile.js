import { apiBase } from './apiBase';

const cache = new Map();
const TTL = 60 * 60 * 1000;

/** Project metadata is optional and is never used as a price or trading quote. */
export function normalizeTokenProfile(raw) {
  if (!raw?.id) return null;
  return {
    id: String(raw.id),
    descriptions: raw.description || {},
    homepage: raw.links?.homepage?.find((url) => typeof url === 'string' && url.trim()) || null,
    whitepaper: raw.links?.whitepaper || null,
    categories: Array.isArray(raw.categories) ? raw.categories.filter((v) => typeof v === 'string' && v.trim()).slice(0, 8) : [],
    genesisDate: typeof raw.genesis_date === 'string' ? raw.genesis_date : null,
    platforms: Object.entries(raw.platforms || {}).filter(([name, address]) => name && typeof address === 'string' && address.trim()).slice(0, 8).map(([name]) => name)
  };
}

async function read(url, signal, timeout) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('Profile unavailable');
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function getTokenProfile(id, { signal } = {}) {
  if (signal?.aborted || !/^[a-z0-9][a-z0-9-]{0,99}$/i.test(String(id || ''))) return null;
  const cached = cache.get(id);
  if (cached && Date.now() - cached.at < TTL) return cached.value;
  const path = encodeURIComponent(id);
  for (const [url, timeout] of [
    [`${apiBase()}/coin/${path}/profile`, 3500],
    [`https://api.coingecko.com/api/v3/coins/${path}?localization=true&tickers=false&market_data=false&community_data=false&developer_data=false`, 5000]
  ]) {
    try {
      const raw = await read(url, signal, timeout);
      const profile = normalizeTokenProfile(raw);
      if (profile && profile.id === id) {
        cache.set(id, { at: Date.now(), value: profile });
        return profile;
      }
    } catch { if (signal?.aborted) return null; }
  }
  return null;
}
