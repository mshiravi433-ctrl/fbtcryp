/**
 * DISCOVERY SEARCH + SUGGESTIONS
 * ---------------------------------------------------------------------------
 * The screen used to have one bare `<input>` that did a substring match on
 * English fields, plus a second "AI Discovery" input that did something else
 * entirely. Neither suggested anything, and neither understood Persian.
 *
 * This module is the single search engine behind the new omnibox:
 *
 *  · rankProtocols — relevance-ranked, language-independent protocol search.
 *  · buildSuggestions — grouped suggestions (protocols, categories, networks,
 *    a natural-language "smart filter", and recent queries).
 *
 * Everything is pure and synchronous, so the UI never waits on a network to
 * show a suggestion and the whole engine is unit-testable in plain Node.
 */
import { normalizeText, queryTokens } from './discoveryText.js';
import { protocolHaystack, descriptionFor, aliasesFor } from './discoveryLocalized.js';
import { parseAiQuery } from './discoveryAi.js';

const cache = new WeakMap();

function haystackFor(protocol, lang, categoryLabels) {
  const key = `${lang}:${JSON.stringify(categoryLabels)}`;
  let byKey = cache.get(protocol);
  if (!byKey) { byKey = new Map(); cache.set(protocol, byKey); }
  if (!byKey.has(key)) byKey.set(key, protocolHaystack(protocol, lang, categoryLabels));
  return byKey.get(key);
}

/**
 * Score a protocol against a query. Higher is better; 0 means "not a match".
 * Ranking is intentionally simple and explainable: name > domain > category >
 * chain > description, with a bonus when every token is present somewhere.
 */
export function scoreProtocol(protocol, rawQuery, lang = 'en', categoryLabels = {}) {
  const q = normalizeText(rawQuery);
  if (!q) return 1; // empty query = browse everything, in registry order
  const name = normalizeText(protocol.name || '');
  const domain = normalizeText(`${protocol.domain || ''} ${protocol.url || ''}`);
  const cat = normalizeText(`${protocol.category || ''} ${categoryLabels[protocol.category] || ''}`);
  const chains = normalizeText((protocol.chains || []).join(' '));
  const desc = normalizeText(`${descriptionFor(protocol, 'en')} ${descriptionFor(protocol, 'fa')}`);
  const aliases = normalizeText(aliasesFor(protocol, 'fa').join(' '));
  const hay = haystackFor(protocol, lang, categoryLabels);

  let score = 0;
  if (name === q) score = Math.max(score, 120);
  if (aliases.split(' ').includes(q)) score = Math.max(score, 105);
  if (name.startsWith(q)) score = Math.max(score, 90);
  if (name.includes(q)) score = Math.max(score, 72);
  if (aliases.includes(q)) score = Math.max(score, 68);
  if (domain.includes(q)) score = Math.max(score, 52);
  if (cat.includes(q)) score = Math.max(score, 44);
  if (chains.includes(q)) score = Math.max(score, 38);
  if (desc.includes(q)) score = Math.max(score, 22);
  if (!score && !hay.includes(q)) {
    const tokens = queryTokens(rawQuery);
    if (!tokens.length) return 0;
    if (!tokens.every((tok) => hay.includes(tok))) return 0;
    score = 12;
  }
  // Every token present → small coherence bonus; exact/short queries win ties.
  const tokens = queryTokens(rawQuery);
  if (tokens.length > 1 && tokens.every((tok) => hay.includes(tok))) score += 6;
  if (protocol.verified) score += 1;
  return score;
}

/**
 * A query that IS a category («وام» / «lending» / «dex») is a filter, not a
 * free-text search. Without this, protocols that merely mention "lending" in
 * their description outrank the ones that actually belong to the category.
 */
function exactCategoryFor(q, categoryLabels) {
  for (const [id, label] of Object.entries(categoryLabels)) {
    if (q === normalizeText(id) || q === normalizeText(label)) return id;
  }
  return null;
}

/**
 * Rank the registry. With an empty query the caller can apply its own sort —
 * this returns the list untouched and flags `browse: true`.
 */
export function rankProtocols(list, rawQuery, { lang = 'en', categoryLabels = {}, limit = Infinity } = {}) {
  const q = normalizeText(rawQuery);
  if (!q) return { browse: true, items: limit === Infinity ? list : list.slice(0, limit) };
  const exactCat = exactCategoryFor(q, categoryLabels);
  const source = exactCat ? list.filter((p) => p.category === exactCat) : list;
  const scored = [];
  for (const p of source) {
    const score = scoreProtocol(p, rawQuery, lang, categoryLabels);
    if (score > 0) scored.push({ protocol: p, score });
  }
  scored.sort((a, b) => (b.score - a.score) || a.protocol.name.localeCompare(b.protocol.name));
  const items = scored.map((x) => x.protocol);
  return { browse: false, items: limit === Infinity ? items : items.slice(0, limit) };
}

/**
 * Build the suggestion groups for the omnibox.
 *
 * @param {object} o
 * @param {Array}  o.list           registry
 * @param {string} o.query          raw input
 * @param {string} o.lang           active language
 * @param {Array}  o.categories     {id,label,labelFa}
 * @param {Array}  o.networks       {id,label,short,labelFa?}
 * @param {Array}  o.recentQueries  previously committed searches
 * @param {object} o.categoryLabels id → localized label
 */
export function buildSuggestions({ list = [], query = '', lang = 'en', categories = [], networks = [], recentQueries = [], categoryLabels = {} } = {}) {
  const q = normalizeText(query);
  const empty = !q;

  const protocols = empty ? [] : rankProtocols(list, query, { lang, categoryLabels, limit: 5 }).items;

  const catHits = empty ? [] : categories.filter((c) => c.id !== 'all' && (
    normalizeText(c.label || '').includes(q) ||
    normalizeText(c.labelFa || '').includes(q) ||
    normalizeText(c.id).includes(q) ||
    q.includes(normalizeText(c.id))
  )).slice(0, 3);

  const netHits = empty ? [] : networks.filter((n) => n.id !== 'all' && (
    normalizeText(n.short || '').includes(q) ||
    normalizeText(n.label || '').includes(q) ||
    normalizeText(n.labelFa || '').includes(q) ||
    normalizeText(n.id).includes(q)
  )).slice(0, 3);

  // A natural-language query («وامدهی روی آربیتروم») is offered as one tap
  // that sets category + network + sort together. Only when it really parsed
  // an intent — never for a plain one-word brand name.
  let smart = null;
  if (!empty) {
    const parsed = parseAiQuery(query);
    const hasIntent = parsed && (
      parsed.category || parsed.chain || parsed.wantsSecurity || parsed.wantsNew ||
      parsed.wantsCompare || parsed.sort === 'volume' || parsed.sort === 'new'
    );
    const looksPhrasal = queryTokens(query).length > 1 || /[\u0600-\u06ff]/.test(query);
    if (hasIntent && looksPhrasal) smart = parsed;
  }

  const recents = empty ? (recentQueries || []).filter(Boolean).slice(0, 5) : [];

  return { protocols, categories: catHits, networks: netHits, smart, recents, empty, query: query.trim() };
}

/** Human-readable, localized summary of a parsed smart query. */
export function smartSummary(parsed, { categoryLabel = (id) => id, networkLabel = (id) => id, sortLabel = (id) => id } = {}) {
  if (!parsed) return '';
  const parts = [];
  if (parsed.category && parsed.category !== 'all') parts.push(categoryLabel(parsed.category));
  if (parsed.chain) parts.push(networkLabel(parsed.chain));
  if (parsed.sort && parsed.sort !== 'tvl' && ['new', 'trending', 'volume', 'yield'].includes(parsed.sort)) parts.push(sortLabel(parsed.sort));
  if (parsed.wantsSecurity) parts.push(sortLabel('security'));
  if (parsed.wantsNew) parts.push(sortLabel('new'));
  if (parsed.wantsCompare) parts.push(sortLabel('compare'));
  return parts.join(' · ');
}
