/**
 * SOLANA TOKEN METADATA + AI SENTIMENT — logos, names and an honest opinion.
 * ===========================================================================
 *
 * WHY THIS EXISTS (report 2026-09-23, the Solana swap screen)
 * A pasted memecoin mint used to land in the picker as «AbCd…WxYz» — no name,
 * no logo, no context — because the only metadata path was the CHAIN, and the
 * chain cannot tell you what a token calls itself. Meanwhile Jupiter (the very
 * router the swap quotes through) indexes every tradable Solana token with a
 * name, an icon, a price, a liquidity figure, holder counts, audit facts and an
 * organic-score. This module surfaces that index through OUR origin so the
 * token picker can look like 2026 instead of a debug log.
 *
 * ─── WHAT IT SERVES ─────────────────────────────────────────────────────────
 *   GET /api/solana/token-search?query=<symbol|name|mint>   (meta + sentiment)
 *   GET /api/solana/token-sentiment?mint=<mint>&lang=fa     (single, + AI line)
 *
 * Keyless upstream (lite-api.jup.ag), read from the SERVER for the same three
 * reasons every other upstream is: no key can leak, no CORS question exists,
 * and one shared cache turns N user searches into one upstream call. Cached
 * hard — a token list is browsing data, not a price the user signs against;
 * the swap's own quote still comes from the live order endpoints.
 *
 * ─── THE SENTIMENT HALF, AND ITS HONESTY CONTRACT ───────────────────────────
 * «هوش مصنوعی برای توکن» was the request. What is honest to ship:
 *
 *   · A DETERMINISTIC score (0–100) computed from Jupiter's own published
 *     facts — liquidity, organic score, mint/freeze authority, holder
 *     concentration, dev holdings, age. Every input is a number someone else
 *     published; every driver is returned WITH the score as a translation key
 *     plus the numbers that produced it. Nothing is invented.
 *   · An OPTIONAL one-line summary written by the LLM the rest of the app
 *     already uses (server/ai.js), ONLY when a key is configured, ALWAYS
 *     labelled as generated, and ALWAYS beside the deterministic score — a
 *     sentence can persuade where a number informs, so the number leads.
 *
 * Both fail closed: missing data lowers nothing and invents nothing — an
 * unread field produces `unknown`, never a green badge. The same discipline as
 * src/lib/tokenRisk.js and server/solanaIntel.js, because all three answer the
 * same class of question («is this safe to touch?») and a green badge on
 * missing data is how people buy rugs in every one of them.
 */

import { withCache } from './cache.js';
import { aiConfigured, chat } from './ai.js';

const JUP_SEARCH = String(process.env.JUP_TOKEN_SEARCH_URL || 'https://lite-api.jup.ag/tokens/v2/search');

const SEARCH_TIMEOUT_MS = Number(process.env.SOLANA_TOKEN_META_TIMEOUT_MS || 7000);

/** Browsing data, not money-adjacent: a couple of minutes shared per process. */
const SEARCH_TTL_MS = Number(process.env.SOLANA_TOKEN_META_TTL_MS || 180_000);

/** A sentiment line lives longer than a search: it describes structure. */
const SENTIMENT_TTL_MS = Number(process.env.SOLANA_SENTIMENT_TTL_MS || 30 * 60_000);

/** Same base58 shape guard the rest of the Solana surface uses. */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSolanaMintShape(value) {
  return typeof value === 'string' && BASE58.test(value.trim());
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const strOrNull = (v, max = 64) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

/* ── normalisation ─────────────────────────────────────────────────────────── */

/**
 * Jupiter's search row → the flat shape the picker renders.
 * Exported for tests: fixtures in, no network.
 */
export function normalizeJupiterToken(row) {
  if (!row || typeof row !== 'object') return null;
  const mint = strOrNull(row.id, 50);
  if (!mint || !isSolanaMintShape(mint)) return null;
  const stats = row.stats24h && typeof row.stats24h === 'object' ? row.stats24h : {};
  const audit = row.audit && typeof row.audit === 'object' ? row.audit : {};
  const firstPool = row.firstPool && typeof row.firstPool === 'object' ? row.firstPool : {};
  const createdAt = strOrNull(firstPool.createdAt, 40);
  const tags = Array.isArray(row.tags) ? row.tags.map((t2) => String(t2).slice(0, 24)).slice(0, 12) : [];
  return {
    mint,
    symbol: strOrNull(row.symbol, 24),
    name: strOrNull(row.name, 64),
    icon: typeof row.icon === 'string' && /^https:\/\//i.test(row.icon) ? row.icon.slice(0, 400) : null,
    decimals: Number.isInteger(Number(row.decimals)) ? Number(row.decimals) : null,
    verified: row.isVerified === true || tags.includes('verified') || tags.includes('strict'),
    usdPrice: numOrNull(row.usdPrice),
    liquidity: numOrNull(row.liquidity),
    holders: numOrNull(row.holderCount),
    fdv: numOrNull(row.fdv),
    priceChange24h: numOrNull(stats.priceChange),
    volume24h: numOrNull(stats.volume),
    organicScore: numOrNull(row.organicScore),
    organicScoreLabel: strOrNull(row.organicScoreLabel, 16),
    /* TRI-STATE on purpose: `true` = revoked, `false` = the audit feed
       EXPLICITLY says still live, `null` = the feed did not say. USDC's audit
       row carries neither boolean and a live mint authority — collapsing
       «not reported» into «live» would stamp one of the deepest tokens in
       Solana with a penalty for a fact nobody asserted. Only an explicit
       false may be penalised; see deriveSentiment. */
    mintAuthorityDisabled: typeof audit.mintAuthorityDisabled === 'boolean' ? audit.mintAuthorityDisabled : null,
    freezeAuthorityDisabled: typeof audit.freezeAuthorityDisabled === 'boolean' ? audit.freezeAuthorityDisabled : null,
    topHoldersPct: numOrNull(audit.topHoldersPercentage),
    devBalancePct: numOrNull(audit.devBalancePercentage),
    createdAt,
    tags,
    isMeme: tags.includes('meme') || tags.includes('pump')
  };
}

/* ── the deterministic score ──────────────────────────────────────────────── */

const clampScore = (n) => Math.max(0, Math.min(100, Math.round(n)));

/** Days since the token's first pool, or null when Jupiter does not say. */
export function ageInDays(createdAt, now = Date.now()) {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / 86_400_000);
}

/**
 * The rule-based part of «هوش مصنوعی». Pure, exported for tests.
 *
 * @returns {{score:number, label:'positive'|'neutral'|'risky'|'unknown',
 *            drivers:Array<{key:string, value:number|null}>, data:boolean}}
 */
export function deriveSentiment(tk, { now = Date.now() } = {}) {
  if (!tk || typeof tk !== 'object') {
    return { score: 0, label: 'unknown', drivers: [], data: false };
  }
  const drivers = [];
  const knowStructure = tk.mintAuthorityDisabled != null || tk.freezeAuthorityDisabled != null || tk.topHoldersPct != null;
  /* Nothing measured → nothing claimed. A score on two missing fields would be
     theatre, and the picker would show a green dot on a token nobody read. */
  if (!knowStructure && tk.organicScore == null && tk.liquidity == null) {
    return { score: 0, label: 'unknown', drivers: [], data: false };
  }

  let score = 40; /* neutral centre — evidence moves it, never the lack of it */

  /* 1. Liquidity — can a user actually get out? The single most expensive fact. */
  if (tk.liquidity != null) {
    if (tk.liquidity >= 1_000_000) { score += 22; drivers.push({ key: 'sentLiqDeep', value: Math.round(tk.liquidity) }); }
    else if (tk.liquidity >= 100_000) { score += 14; drivers.push({ key: 'sentLiqOk', value: Math.round(tk.liquidity) }); }
    else if (tk.liquidity >= 10_000) { score += 4; drivers.push({ key: 'sentLiqThin', value: Math.round(tk.liquidity) }); }
    else { score -= 18; drivers.push({ key: 'sentLiqDust', value: Math.round(tk.liquidity) }); }
  }

  /* 2. Jupiter's organic score — real volume vs wash trading, 0..100. */
  if (tk.organicScore != null) {
    const organic = clamp01(tk.organicScore / 100);
    score += Math.round((organic - 0.5) * 24);
    drivers.push({ key: tk.organicScore >= 60 ? 'sentOrganicHigh' : tk.organicScore >= 30 ? 'sentOrganicMid' : 'sentOrganicLow', value: Math.round(tk.organicScore) });
  }

  /* 3. Authority keys — can the issuer mint or freeze holdings?
     Only an EXPLICIT report moves the score: `null` (the feed did not say)
     must stay silent, or every token the feed under-reports would inherit a
     penalty for a fact nobody asserted. */
  if (tk.mintAuthorityDisabled === true) { score += 10; drivers.push({ key: 'sentMintRevoked', value: 1 }); }
  else if (tk.mintAuthorityDisabled === false) { score -= 16; drivers.push({ key: 'sentMintLive', value: 1 }); }
  if (tk.freezeAuthorityDisabled === true) { score += 8; drivers.push({ key: 'sentFreezeRevoked', value: 1 }); }
  else if (tk.freezeAuthorityDisabled === false) { score -= 20; drivers.push({ key: 'sentFreezeLive', value: 1 }); }

  /* 4. Holder concentration. */
  if (tk.topHoldersPct != null) {
    if (tk.topHoldersPct <= 30) { score += 8; drivers.push({ key: 'sentHoldersSpread', value: Math.round(tk.topHoldersPct) }); }
    else if (tk.topHoldersPct >= 60) { score -= 20; drivers.push({ key: 'sentHoldersConcentrated', value: Math.round(tk.topHoldersPct) }); }
    else { score -= 4; drivers.push({ key: 'sentHoldersMid', value: Math.round(tk.topHoldersPct) }); }
  }

  /* 5. Dev holdings still in hand. */
  if (tk.devBalancePct != null) {
    if (tk.devBalancePct >= 5) { score -= 18; drivers.push({ key: 'sentDevHeavy', value: Math.round(tk.devBalancePct * 10) / 10 }); }
    else if (tk.devBalancePct <= 0.5) { score += 4; drivers.push({ key: 'sentDevGone', value: Math.round(tk.devBalancePct * 10) / 10 }); }
  }

  /* 6. Verification and age. */
  if (tk.verified === true) { score += 5; drivers.push({ key: 'sentVerified', value: 1 }); }
  const age = ageInDays(tk.createdAt, now);
  if (age != null && age < 3) { score -= 10; drivers.push({ key: 'sentVeryNew', value: Math.round(age * 10) / 10 }); }
  else if (age != null && age > 365) { score += 4; drivers.push({ key: 'sentSeasoned', value: Math.round(age) }); }

  /* 7. A violent day either way is risk, not a buying signal. */
  const ch = tk.priceChange24h;
  if (ch != null) {
    if (ch >= 100 || ch <= -60) { score -= 8; drivers.push({ key: 'sentVolatile', value: Math.round(ch) }); }
    else if (ch >= 3 && ch <= 40) { score += 4; drivers.push({ key: 'sentTrending', value: Math.round(ch) }); }
  }

  const final = clampScore(score);
  const label = final >= 62 ? 'positive' : final >= 40 ? 'neutral' : 'risky';
  /* The UI shows the first three; the rest travel for tests, the Settings
     panel and whoever debugs a verdict later. */
  return { score: final, label, drivers: drivers.slice(0, 10), data: true };
}

/* ── upstream ──────────────────────────────────────────────────────────────── */

async function jupSearchRaw(query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${JUP_SEARCH}?query=${encodeURIComponent(query)}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0' }
    });
    if (!res.ok) return { ok: false, status: res.status, rows: [] };
    const body = await res.json().catch(() => null);
    const list = Array.isArray(body) ? body : [];
    return { ok: true, status: res.status, rows: list };
  } catch (err) {
    return { ok: false, status: 0, detail: String(err?.message || err).slice(0, 140), rows: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Search rows → normalised + scored, best first (Jupiter already ranks). */
function decorate(rows) {
  return rows
    .map(normalizeJupiterToken)
    .filter(Boolean)
    .map((tk) => ({ ...tk, sentiment: deriveSentiment(tk) }));
}

/**
 * GET /api/solana/token-search — metadata for the token picker.
 *
 * @returns {Promise<{ok:true, query:string, rows:Array, cached:boolean, stale?:boolean}
 *                  |{ok:false, code:string, detail?:string|null}>}
 */
export async function searchSolanaTokens({ query } = {}) {
  const q = String(query ?? '').trim().slice(0, 120);
  if (!q) return { ok: false, code: 'BAD_QUERY' };
  try {
    const { value, cached, stale } = await withCache(`solana:tkmeta:${q.toLowerCase()}`, SEARCH_TTL_MS, async () => {
      const up = await jupSearchRaw(q);
      if (!up.ok) return { ok: false, code: 'UPSTREAM_FAILED', status: up.status, detail: up.detail || null, rows: [] };
      return { ok: true, query: q, rows: decorate(up.rows.slice(0, 30)), at: Date.now() };
    }, { swr: true });
    /* `ok: true` is part of the contract the route checks. Without it the
       only honest 200 is unreachable and the endpoint answers 502 forever. */
    return { ok: true, ...value, cached, stale: stale || undefined };
  } catch (err) {
    return { ok: false, code: 'UPSTREAM_FAILED', detail: String(err?.message || err).slice(0, 140) };
  }
}

/**
 * Batch mode — metadata for a KNOWN list of mints (the curated swap list).
 *
 * `?mints=a,b,c` exists because the picker needs real icons for the tokens it
 * already ships: the curated Solana assets carry no artwork of their own, and
 * one comma-joined upstream call answers for all of them where N single
 * searches would burn N round trips on the same free endpoint. Same
 * normalisation, same sentiment decoration, same cache.
 *
 * @returns {Promise<{ok:true, rows:Array, cached:boolean, stale?:boolean}
 *                  |{ok:false, code:string}>}
 */
export async function searchSolanaTokensByMints({ mints } = {}) {
  const list = [...new Set(
    String(mints ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter((m) => isSolanaMintShape(m))
  )].slice(0, 100);
  if (!list.length) return { ok: false, code: 'BAD_QUERY' };
  const key = `solana:tkmeta:batch:${list.join(',')}`;
  try {
    const { value, cached, stale } = await withCache(key, SEARCH_TTL_MS, async () => {
      const up = await jupSearchRaw(list.join(','));
      if (!up.ok) return { ok: false, code: 'UPSTREAM_FAILED', status: up.status, rows: [] };
      return { ok: true, rows: decorate(up.rows), at: Date.now() };
    }, { swr: true });
    /* `ok: true` is part of the contract the route checks. Without it the
       only honest 200 is unreachable and the endpoint answers 502 forever. */
    return { ok: true, ...value, cached, stale: stale || undefined };
  } catch (err) {
    return { ok: false, code: 'UPSTREAM_FAILED', detail: String(err?.message || err).slice(0, 140) };
  }
}

/* ── the token UNIVERSE ────────────────────────────────────────────────────── */

/**
 * GET /api/solana/tokens — the swap screen's browsable catalogue.
 * ---------------------------------------------------------------------------
 *   «تعداد توکن ها کم است» — on the Solana swap page.
 *
 * The screen shipped with three hand-written rows (SOL, USDC, USDT) plus the
 * liquid-staking and tokenized-equity mints, and everything else arrived only
 * if the user already knew a mint address to paste. On the one chain where
 * the trade IS the browse, that is the wrong default: the deep end of Solana
 * — Jito, Raydium, ORCA, W, PYTH, the whole meme complex — is what people come
 * to this app for, and none of it was one tap away.
 *
 * ─── WHAT THE LIST IS, AND WHAT IT IS NOT ──────────────────────────────────
 * It is BROWSE data: names, logos, liquidity, the 24h move, and whether
 * Jupiter's own index marks the token verified. It is never the price
 * anything is signed against — that still comes from the live order endpoint
 * at quote time, exactly as before.
 *
 * The upstream is the SAME keyless index the search already uses, read
 * through its ranked "top" listings rather than a query, so this costs no new
 * dependency, no key, and no new class of failure. The curated mints this app
 * already ships are merged in FIRST and are never displaced by a remote row,
 * so the assets Stocks and the gold screen hand off by mint keep their
 * identity even if the upstream renames something.
 *
 * A failed upstream is NOT an error page: the curated list still answers, and
 * the response says `source: 'curated'` so the client can say so honestly.
 */
const UNIVERSE_LIMIT = 60;

/** Short, stable digest for a cache key. Not security — de-duplication. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Ranked endpoints, most trusted first. A dead one costs a smaller list. */
const JUP_UNIVERSE_PATHS = [
  'https://lite-api.jup.ag/tokens/v2/toporganicscore/24h',
  'https://lite-api.jup.ag/tokens/v2/toptraded/24h',
  'https://lite-api.jup.ag/tokens/v2/topliquidity/24h'
];

/**
 * Longer than a search. The ranking of a token list moves over hours, not
 * seconds, and this is the payload behind the swap screen's first paint.
 */
const UNIVERSE_TTL_MS = Number(process.env.SOLANA_TOKEN_UNIVERSE_TTL_MS || 10 * 60_000);

/**
 * A fetch seam the test suite overrides. Production reads the global; the
 * tests hand in a fake that returns canned Jupiter envelopes so the ranking,
 * the normalization and the CACHE are asserted without spending a request.
 */
let jupFetchImpl = (url, opts) => globalThis.fetch(url, opts);

/** Test-only fetch override. Restored with `__setJupFetchForTests(null)`. */
export function __setJupFetchForTests(fn) {
  jupFetchImpl = fn || ((url, opts) => globalThis.fetch(url, opts));
}

/**
 * One ranked listing, as a plain array of raw Jupiter rows.
 *
 * ─── WHY THE ENVELOPE HANDLING IS LOAD-BEARING ───────────────────────────
 * Jupiter's three ranked endpoints do NOT agree on a shape:
 *
 *     toporganicscore/24h → { data: [...] }
 *     toptraded/24h       → { data: [...] }
 *     topliquidity/24h    → [ ... ]            (older build)
 *
 * Reading only `Array.isArray(body)` therefore worked against the liquidity
 * list and silently returned ZERO rows from the other two — which is precisely
 * the reported symptom, a short token list with no error anywhere. Accepting
 * all three costs three lines and is the difference between ~20 tokens and a
 * real catalogue.
 */
async function jupListRaw(path, limit) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS * 2);
  try {
    const res = await jupFetchImpl(`${path}?limit=${Math.max(10, Math.min(100, limit))}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0' }
    });
    if (!res?.ok) return [];
    const body = await res.json().catch(() => null);
    return unwrapList(body);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Every envelope Jupiter is known to answer a ranked list with. */
export function unwrapList(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['data', 'tokens', 'rows', 'results']) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

/**
 * Rank the catalogue the way a trader reads it: liquidity first for anything
 * the user could actually get filled on, then the organic-score rows the
 * upstream already ranked. A token with no liquidity at all is dropped — a
 * swap into it cannot quote, and offering it is a dead button.
 */
export function rankUniverse(rows, { limit = UNIVERSE_LIMIT, minLiquidity = 500 } = {}) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.mint && Number(r.liquidity ?? 0) >= minLiquidity)
    .sort((a, b) => {
      const la = Number(a.liquidity ?? 0);
      const lb = Number(b.liquidity ?? 0);
      if (la !== lb) return lb - la;
      return (b.organicScore ?? 0) - (a.organicScore ?? 0);
    })
    .slice(0, limit);
}

/**
 * The browsable catalogue for the swap screen.
 *
 * `curated` is used to EXCLUDE, never to inject. The client owns the curated
 * table — it carries the verified decimals, the trust marks and the artwork
 * the Stocks and gold screens hand off by mint — and it merges curated FIRST,
 * so a remote row never displaces a curated identity. Excluding them here
 * also stops the rank budget being spent on rows the client will drop.
 *
 * @param {Array<{mint:string, symbol?:string, name?:string}>} curated
 * @returns {Promise<{ok:true, rows:Array, source:'curated'|'jupiter', cached:boolean}
 *                  |{ok:false, code:string, detail?:string}>}
 */
export async function solanaTokenUniverse({ curated = [], limit = UNIVERSE_LIMIT } = {}) {
  const curatedMints = new Set(curated.map((t) => t.mint).filter(Boolean));
  /* The cache key MUST include the exclusion set. The rows depend on it, so
     keying on the path alone would let one caller's answer — with its own
     curated mints already filtered out — be served to a caller that asked
     for a different set. */
  const key = `solana:token-universe:v2:${fnv1a([...curatedMints].sort().join(','))}`;
  try {
    const { value, cached, stale } = await withCache(
      key,
      UNIVERSE_TTL_MS,
      async () => {
        const seen = new Set(curatedMints);
        const rows = [];
        for (const path of JUP_UNIVERSE_PATHS) {
          if (rows.length >= limit) break;
          for (const raw of await jupListRaw(path, limit)) {
            const tk = normalizeJupiterToken(raw);
            if (!tk || seen.has(tk.mint)) continue;
            seen.add(tk.mint);
            rows.push(tk);
            if (rows.length >= limit) break;
          }
        }
        return { rows: rankUniverse(rows, { limit }), at: Date.now(), source: rows.length ? 'jupiter' : 'curated' };
      },
      { swr: true }
    );
    /* `ok: true` is part of the contract the route checks. Without it the
       only honest 200 is unreachable and the endpoint answers 502 forever. */
    return { ok: true, ...value, cached, stale: stale || undefined };
  } catch (err) {
    return { ok: false, code: 'UPSTREAM_FAILED', detail: String(err?.message || err).slice(0, 140) };
  }
}

/* ── the LLM half (optional, labelled, never load-bearing) ─────────────────── */

const aiLineCache = new Map();
const AI_LINE_TTL_MS = 30 * 60_000;

/**
 * ONE short sentence about a token, from the same facts the score used.
 *
 * Deliberately narrow: the model gets NUMBERS ONLY (no narrative, no web) and
 * is told to summarise, not to recommend. If anything at all goes wrong the
 * caller falls back to the deterministic label — the feature degrades to the
 * score, never to a hallucinated paragraph.
 */
async function aiSentimentLine(tk, lang = 'fa') {
  if (!aiConfigured()) return null;
  if (!tk || tk.sentiment?.data !== true) return null;
  const key = `${tk.mint}|${lang}|${Math.round((tk.usdPrice ?? 0) > 0 ? 1 : 0)}`;
  const hit = aiLineCache.get(key);
  if (hit && Date.now() - hit.at < AI_LINE_TTL_MS) return hit.line;

  const facts = {
    symbol: tk.symbol,
    verified: tk.verified === true,
    liquidityUsd: tk.liquidity,
    holders: tk.holders,
    organicScore: tk.organicScore,
    priceChange24hPct: tk.priceChange24h,
    mintAuthorityDisabled: tk.mintAuthorityDisabled,
    freezeAuthorityDisabled: tk.freezeAuthorityDisabled,
    topHoldersPct: tk.topHoldersPct,
    devBalancePct: tk.devBalancePct,
    deterministicScore: tk.sentiment.score,
    deterministicLabel: tk.sentiment.label
  };
  const langName = lang === 'fa' ? 'Persian (Farsi)' : lang === 'en' ? 'English' : lang;
  try {
    const { text } = await chat({
      taskType: 'token-sentiment',
      system:
        'You are a careful crypto data summariser. You get structured facts about a Solana token. ' +
        `Write ONE sentence (max 28 words) in ${langName} describing its CURRENT STRUCTURE and activity. ` +
        'Rules: summarise the numbers only; never tell the user to buy or sell; never invent a fact that is not in the input; ' +
        'if data is missing say what is unknown. Plain text only — no markdown, no emoji, no quotes.',
      user: JSON.stringify(facts),
      temperature: 0.2,
      maxTokens: 120,
      json: false
    });
    const line = String(text || '').trim().replace(/^["'«»]+|["'«»]+$/g, '').slice(0, 220);
    if (!line) return null;
    aiLineCache.set(key, { at: Date.now(), line });
    return line;
  } catch {
    return null;
  }
}

/**
 * GET /api/solana/token-sentiment — one mint, full treatment.
 *
 * @returns {Promise<{ok:true, mint:string, token:object|null, sentiment:object,
 *                     ai:{text:string}|null, cached:boolean}
 *                  |{ok:false, code:string}>}
 */
export async function solanaSentimentDetail({ mint, lang = 'fa', wantAi = true } = {}) {
  const m = String(mint ?? '').trim();
  if (!isSolanaMintShape(m)) return { ok: false, code: 'BAD_MINT' };
  const safeLang = String(lang || 'fa').slice(0, 8);
  try {
    const { value, cached } = await withCache(`solana:tksent:${m}:${safeLang}`, SENTIMENT_TTL_MS, async () => {
      const up = await jupSearchRaw(m);
      const row = up.ok ? up.rows.find((r) => r?.id === m) : null;
      const tk = row ? normalizeJupiterToken(row) : null;
      const sentiment = tk ? deriveSentiment(tk) : { score: 0, label: 'unknown', drivers: [], data: false };
      const payload = { ok: true, mint: m, token: tk, sentiment, ai: null, at: Date.now() };
      if (wantAi !== false) {
        /* The LLM sits behind the deterministic answer and can only ADD a
           sentence, never change the score. Its absence degrades silently. */
        const line = await aiSentimentLine(tk && { ...tk, sentiment }, safeLang);
        payload.ai = line ? { text: line } : null;
      }
      return payload;
    });
    return { ...value, cached };
  } catch (err) {
    return { ok: false, code: 'UPSTREAM_FAILED', detail: String(err?.message || err).slice(0, 140) };
  }
}

/** Test hook. */
export function _resetSolanaTokenMetaCaches() {
  aiLineCache.clear();
}
