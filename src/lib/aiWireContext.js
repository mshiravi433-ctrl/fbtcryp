/**
 * WHAT THE AI REQUEST CARRIES OVER THE WIRE — AND WHAT STAYS IN THE BROWSER.
 * ---------------------------------------------------------------------------
 * Reported on production: every chat turn the local OS handed to the server,
 * and every intent that needed a confirmation card, answered
 *   «فعلاً پاسخ‌گویی هوش مصنوعی در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.»
 * (or, for a «چه خبر» message, the offline «الان به سرور دسترسی ندارم» line) —
 * instantly, with no retry, on a deployment whose providers were healthy.
 *
 * ─── ROOT CAUSE ─────────────────────────────────────────────────────────────
 * The chat screen keeps ONE context object (`aiContext`) for two readers: the
 * in-browser Intent OS and the server. `portfolio.marketRows` was added to it
 * so the local portfolio card could measure 24h/7d returns — 250 market rows,
 * each with a 168-point sparkline. That is ~300 KB+ of JSON. The same object
 * was posted verbatim to `/api/v1/ai/chat`, `/execute`, `/confirm` and
 * `/api/system/state`, whose JSON parser stops at 256 KB:
 *
 *     POST /api/v1/ai/chat  →  413 (HTML)  →  INVALID_RESPONSE  →  the error
 *
 * The server never read those rows. It reads at most 80 balances, 80 holdings
 * and a handful of portfolio scalars (see `sanitize*` in server/aiIntentOS.js).
 *
 * ─── THE RULE ───────────────────────────────────────────────────────────────
 * The in-browser reader keeps the full object. Anything that leaves the
 * browser goes through `encodeWireBody`, which
 *   1. drops the browser-only market feed and per-row series (sparklines);
 *   2. caps every list at what the widest server reader takes, cutting from
 *      the least valuable end;
 *   3. enforces a hard byte budget with a degradation ladder, so a request can
 *      never again be rejected for its size — whatever a future change adds to
 *      the context object.
 *
 * Pure functions, no React, no DOM: importable from the browser and from the
 * Node test runner alike.
 */

/** Hard ceiling for one AI request body, in UTF-8 bytes. Well under the 256 KB
    the oldest deployed server accepts, so a new client works against any server. */
export const MAX_AI_BODY_BYTES = 150_000;

/**
 * Lists are capped at what the WIDEST server reader takes, so the standard
 * encoding loses nothing any reader would have used: the central state store
 * keeps 120 balances (`ingestClientData` in server/central/stateStore.js) and
 * the chat sanitizers read the first 80 (`sanitizeClientArray(…, 80)` in
 * server/aiIntentOS.js). A list is only reordered when it has to be cut — then
 * by value, so the rows both readers get are the ones that matter.
 */
const LIST_CAP = 120;
/** An array longer than this is a series, not a fact. */
const SERIES_MIN = 16;
/** The feed this module exists for: kept for the in-browser portfolio card,
    read by no server route under any name path. Always left behind. */
const CLIENT_ONLY_FEED = 'marketRows';
/** Names a chart series usually travels under. Left behind only when the value
    IS a series (an array longer than SERIES_MIN): a short list or an object
    under the same name is data, and stays. */
const SERIES_KEYS = ['markets', 'sparkline', 'sparklines', 'history', 'chart', 'candles'];
const FEED_KEYS = [CLIENT_ONLY_FEED, ...SERIES_KEYS];
const isBrowserOnlyFeed = (key, value) => key === CLIENT_ONLY_FEED
  || (SERIES_KEYS.includes(key) && Array.isArray(value) && value.length > SERIES_MIN);
/** Row decorations: picture URLs and inline sparklines. No server reader takes them. */
const BROWSER_ONLY_ROW_KEYS = new Set(['sparkline', 'sparkline7d', 'sparkline_in_7d', 'image', 'icon', 'logo', 'logoURI']);
/** Top-level context lists the server maps row by row. */
const CONTEXT_LIST_KEYS = ['balances', 'openOrders', 'orders', 'positions', 'activeIntents', 'intents', 'activeAutomations', 'automations', 'recentActivity', 'activity'];

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null));

/** UTF-8 size of a string. Persian text is two bytes a letter, so `length` lies. */
export function utf8ByteLength(text) {
  const str = String(text ?? '');
  if (!str) return 0;
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
  } catch { /* fall through to the arithmetic estimate */ }
  let bytes = 0;
  for (let i = 0; i < str.length; i += 1) {
    const c = str.charCodeAt(i);
    bytes += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xd800 && c <= 0xdbff) ? (i += 1, 4) : 3;
  }
  return bytes;
}

/** One row without its series and decorations. Scalars are kept as they are. */
function slimRow(row) {
  if (!isPlainObject(row)) return row;
  let out = null;
  for (const key of Object.keys(row)) {
    const value = row[key];
    const drop = BROWSER_ONLY_ROW_KEYS.has(key)
      || (Array.isArray(value) && value.length > SERIES_MIN)
      || (isPlainObject(value) && Array.isArray(value.price) && value.price.length > SERIES_MIN);
    if (drop) {
      if (!out) out = { ...row };
      delete out[key];
    }
  }
  return out || row;
}

/** Most valuable first: a held, priced row outranks a zero row of a tracked token. */
function rankRows(rows) {
  const score = (r) => {
    const value = finite(r?.valueUsd ?? r?.value);
    const amount = finite(r?.amount);
    if (value != null && value > 0) return 2e15 + value;
    if (amount != null && amount > 0) return 1e15;
    return 0;
  };
  return rows
    .map((row, index) => ({ row, index, score: score(row) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((entry) => entry.row);
}

function capList(value, cap = LIST_CAP, { rank = false } = {}) {
  if (!Array.isArray(value)) return value;
  const rows = value.length > cap ? (rank ? rankRows(value) : value).slice(0, cap) : value;
  let changed = rows !== value;
  const slim = rows.map((row) => {
    const next = slimRow(row);
    if (next !== row) changed = true;
    return next;
  });
  return changed ? slim : value;
}

function compactPortfolio(portfolio, cap) {
  if (!isPlainObject(portfolio)) return portfolio;
  const out = {};
  for (const key of Object.keys(portfolio)) {
    const value = portfolio[key];
    if (isBrowserOnlyFeed(key, value)) continue;
    if (key === 'holdings' || key === 'rows' || key === 'tokens') out[key] = capList(value, cap, { rank: true });
    else if (Array.isArray(value)) out[key] = capList(value, cap);
    else out[key] = value;
  }
  return out;
}

/**
 * The context as the server reads it: same shape, same field names, without
 * the browser-only feeds. Never mutates its input — the in-browser OS keeps
 * using the original object.
 */
export function compactWireContext(context, { cap = LIST_CAP } = {}) {
  if (!isPlainObject(context)) return context;
  const out = { ...context };
  if (isPlainObject(out.portfolio)) out.portfolio = compactPortfolio(out.portfolio, cap);
  for (const key of CONTEXT_LIST_KEYS) {
    if (Array.isArray(out[key])) out[key] = capList(out[key], cap, { rank: key === 'balances' });
  }
  /* A market feed must not ride at the top level either. */
  for (const key of FEED_KEYS) {
    if (key in out && isBrowserOnlyFeed(key, out[key])) delete out[key];
  }
  if (typeof out.conversationSummary === 'string' && out.conversationSummary.length > 2400) {
    out.conversationSummary = out.conversationSummary.slice(-2400);
  }
  return out;
}

/* `/v1/ai/context` and `/system/state` post the context fields at the TOP level
   of the body instead of under `context`. */
const carriesContextFields = (body) => isPlainObject(body)
  && (isPlainObject(body.portfolio) || Array.isArray(body.balances));

/**
 * Run one transform over wherever the context lives in this body. Every
 * transform only rewrites known context keys, so applying it to a body that
 * also carries an action plan or a message leaves those untouched.
 */
function applyContext(body, transform) {
  if (!isPlainObject(body)) return body;
  let out = body;
  if (carriesContextFields(out)) {
    const nested = out.context;
    out = transform(out);
    if (nested !== undefined) out = { ...out, context: nested };
  }
  if (isPlainObject(out.context)) out = { ...out, context: transform(out.context) };
  return out;
}

/** The last rung: keep identity, page and plan; drop every measured list. */
function stripMeasuredLists(context) {
  if (!isPlainObject(context)) return context;
  const out = { ...context };
  delete out.portfolio;
  for (const key of CONTEXT_LIST_KEYS) delete out[key];
  for (const key of FEED_KEYS) delete out[key];
  if (typeof out.conversationSummary === 'string') out.conversationSummary = out.conversationSummary.slice(-300);
  return out;
}

/** Only the fields the server's sanitizers read, for the tightest rung. */
function essentialRow(row) {
  if (!isPlainObject(row)) return row;
  const out = {};
  for (const key of ['symbol', 'chain', 'chainId', 'amount', 'valueUsd', 'value', 'priceUsd', 'priceProvenance', 'dataProvenance', 'balanceFreshness', 'decimals', 'address', 'mint', 'dataStatus']) {
    if (row[key] !== undefined && row[key] !== null) out[key] = row[key];
  }
  return out;
}

function essentialContext(context, cap) {
  const compact = compactWireContext(context, { cap });
  if (!isPlainObject(compact)) return compact;
  const out = { ...compact };
  if (Array.isArray(out.balances)) out.balances = out.balances.map(essentialRow);
  if (isPlainObject(out.portfolio)) {
    const p = { ...out.portfolio };
    if (Array.isArray(p.holdings)) p.holdings = p.holdings.map(essentialRow);
    delete p.chains;
    out.portfolio = p;
  }
  for (const key of ['openOrders', 'orders', 'positions', 'activeIntents', 'intents', 'recentActivity', 'activity']) {
    if (Array.isArray(out[key])) out[key] = out[key].slice(0, Math.min(cap, 20));
  }
  if (typeof out.conversationSummary === 'string') out.conversationSummary = out.conversationSummary.slice(-900);
  return out;
}

function trimHistory(body, { rows, chars }) {
  if (!isPlainObject(body) || !Array.isArray(body.messages)) return body;
  return {
    ...body,
    messages: body.messages.slice(-rows).map((row) => (isPlainObject(row)
      ? { role: row.role, content: String(row.content ?? '').slice(0, chars) }
      : row))
  };
}

/**
 * Serialize a request body for an AI endpoint, guaranteed to fit the budget.
 *
 * @returns {{ text: string, bytes: number, rung: number }} `rung` is 0 when the
 *   standard compaction was enough; higher numbers name how far the ladder had
 *   to go (useful in a bug report, harmless otherwise).
 */
export function encodeWireBody(body, { maxBytes = MAX_AI_BODY_BYTES } = {}) {
  if (body === null || body === undefined) return { text: undefined, bytes: 0, rung: 0 };
  const ladder = [
    (b) => applyContext(b, (ctx) => compactWireContext(ctx)),
    (b) => applyContext(b, (ctx) => essentialContext(ctx, 40)),
    (b) => trimHistory(applyContext(b, (ctx) => essentialContext(ctx, 40)), { rows: 4, chars: 600 }),
    (b) => trimHistory(applyContext(b, (ctx) => essentialContext(ctx, 12)), { rows: 2, chars: 400 }),
    /* Last rung: the wallet identity, the page and the plan — no measured
       lists. The server reads live market data itself and reports the
       portfolio as unavailable instead of the whole turn failing. */
    (b) => trimHistory(applyContext(b, stripMeasuredLists), { rows: 1, chars: 300 })
  ];
  let text = '';
  let bytes = 0;
  for (let rung = 0; rung < ladder.length; rung += 1) {
    try {
      text = JSON.stringify(ladder[rung](body));
    } catch {
      /* A cyclic or exotic value: retry on the next, plainer rung. */
      continue;
    }
    bytes = utf8ByteLength(text);
    if (bytes <= maxBytes) return { text, bytes, rung };
  }
  if (!text) {
    /* No rung could serialize it (a cyclic value OUTSIDE the context). Behave
       exactly like the plain `JSON.stringify` this function replaced — throw
       to the caller — rather than post an empty body. */
    text = JSON.stringify(body);
    bytes = utf8ByteLength(text);
  }
  return { text, bytes, rung: ladder.length };
}
