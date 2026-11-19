/**
 * Client-side map: which DIRECTORY card can be connected with a key.
 *
 * The server owns the bridge table (`server/agentHub/keyBridges.js`) — the host,
 * the auth header and the probe all live there and are never taken from here.
 * This file only answers one question for the UI: pressing "key" on THIS card
 * should open a key form for THAT bridge id, or an honest "no key API" panel.
 *
 * A card whose vendor has no key bridge is not broken: FBT already reads that
 * vendor's data server-side. What must never happen is the reverse — a card
 * claiming to be connected when the server has no bridge for it.
 */
export const BRIDGE_BY_RECOMMENDATION_ID = Object.freeze({
  chatgpt: 'openai',
  claude: 'anthropic',
  gemini: 'gemini',
  coingecko: 'coingecko'
});

/** Category chips for the connectable directory, in render order. Mirrors the
    server's `BRIDGE_CATEGORIES`; the counts are always computed from what the
    server actually returned, never from a local constant. */
export const BRIDGE_CATEGORIES = Object.freeze([
  { id: 'all', fa: 'همه', en: 'All' },
  { id: 'ai', fa: 'صندلی هوش مصنوعی', en: 'AI seats' },
  { id: 'data', fa: 'قیمت و دادهٔ بازار', en: 'Market data' },
  { id: 'onchain', fa: 'آنچین و قرارداد', en: 'On-chain' },
  { id: 'swap', fa: 'سواپ و مسیریابی', en: 'Swap & routing' }
]);

/** Bridge ids the server knows about but that have no directory card. */
export const BRIDGE_ONLY_IDS = Object.freeze([
  'groq',
  'mistral',
  'deepseek',
  'openrouter',
  'xai',
  'cerebras',
  'together',
  'fireworks',
  'sambanova',
  'etherscan'
]);

export function bridgeIdForRecommendation(id) {
  return BRIDGE_BY_RECOMMENDATION_ID[String(id || '')] || null;
}
