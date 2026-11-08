/**
 * OPPORTUNITY — WHAT MAY BE DRAWN AS TEXT
 * ---------------------------------------------------------------------------
 * ─── THE REPORTED BUG ───────────────────────────────────────────────────────
 *   «در موتور فرصت هوش مصنوعی وقتی میزنی روش میگه صفحه به مشکل خورد و دوباره
 *    تلاش کنید»
 *
 * Tapping the opportunity engine landed on the route crash card. The screen was
 * not broken by the engine's maths — it was broken by ONE field of ONE feed row
 * whose type was not what the card assumed:
 *
 *     Error: Objects are not valid as a React child
 *            (found: object with keys {name})
 *
 * `{o.chain}` with `o.chain = { name: 'Base' }` throws during render. React has
 * no boundary between that `<span>` and the route, so the throw travels up past
 * every sibling card — eighty perfectly good rows included — into
 * `RouteBoundary`, which draws «این صفحه به مشکل خورد». Nothing was wrong with
 * the app, the wallet or the data except one field's shape, and the user lost
 * the whole screen plus any reason to trust it.
 *
 * ─── WHERE THE SHAPE COMES FROM (NOT A HYPOTHETICAL) ────────────────────────
 * The engine reads four independent feeds and a device cache:
 *
 *   · the yield feed labels a chain `Base` today, but the same upstream also
 *     emits `{ name, id }` objects for adapters that grow a chain registry;
 *   · `apy` arrives as `7.4`, `'7.4'` and `'7.4%'` from different adapters;
 *   · `url` is sometimes a string, sometimes an object from a proxy wrapper;
 *   · early-token rows carry `symbol: 7` when the upstream row is a numeric id;
 *   · and LAST — the scan is cached in localStorage for four TTLs, so a row
 *     written by an older build can be read by a newer one with no feed
 *     involved at all. A stored shape is not a validated shape.
 *
 * ─── THE RULE ───────────────────────────────────────────────────────────────
 * A value that is about to be DRAWN must be a string. Anything else is either
 * converted (a number, a nested `{ name }`) or dropped to `null`, which every
 * consumer already renders as an honest em-dash. Nothing is invented: an object
 * that names itself `Base` renders as `Base`; one that names nothing renders as
 * nothing.
 *
 * `externalUrl` is stricter, because it becomes a `window.open` target: only an
 * absolute http(s) string survives. A malformed URL is a dead button, and a dead
 * button is worse than an honest "no destination".
 *
 * Kept in its own module so the engine, the cache reader and the two pages can
 * never disagree about what a drawable row looks like.
 */

/** Coerce anything to drawable text, or null. Never `[object Object]`. */
export function text(value, max = 160) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const s = value.trim();
    return s ? s.slice(0, max) : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value).slice(0, max) : null;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    const parts = value.map((v) => text(v, 60)).filter(Boolean);
    return parts.length ? parts.join(' · ').slice(0, max) : null;
  }
  if (typeof value === 'object') {
    /* A feed that names its own chain/asset — `{ name: 'Base' }`,
       `{ symbol: 'USDC' }` — is already telling us the answer. */
    const inner = value.name ?? value.symbol ?? value.label ?? value.title ?? value.id ?? null;
    return inner == null ? null : text(inner, max);
  }
  return null;
}

/** An absolute http(s) URL string, or null. This one becomes a tap target. */
export function httpUrl(value) {
  const s = typeof value === 'string' ? value.trim() : null;
  if (!s) return null;
  return /^https?:\/\/\S+$/i.test(s) ? s.slice(0, 500) : null;
}

/** A short machine code (category, risk level, venue id) — upper/lower as given. */
export const code = (value, max = 48) => text(value, max);

/** One evidence row: `{ type, detail }`, both strings, extra fields preserved. */
export function sanitizeEvidenceRow(row) {
  if (!row || typeof row !== 'object') {
    const only = text(row, 240);
    return only ? { type: 'EVIDENCE', detail: only } : null;
  }
  const detail = text(row.detail ?? row.label ?? row.note ?? row.title, 300);
  if (!detail) return null;
  return { ...row, type: text(row.type, 40) ?? 'EVIDENCE', detail };
}

export function sanitizeEvidence(rows) {
  return (Array.isArray(rows) ? rows : []).map(sanitizeEvidenceRow).filter(Boolean);
}

/**
 * One opportunity row, safe to DRAW. Amounts are untouched — the engine owns
 * the numbers and a coercion here would be a second opinion about them.
 */
export function sanitizeOpportunityRow(row) {
  if (!row || typeof row !== 'object') return null;
  const ref = row.ref && typeof row.ref === 'object' ? {
    tokenId: text(row.ref.tokenId, 80),
    poolId: text(row.ref.poolId, 120),
    venue: text(row.ref.venue, 60),
    externalUrl: httpUrl(row.ref.externalUrl)
  } : null;
  return {
    ...row,
    title: text(row.title, 200),
    symbol: text(row.symbol, 40),
    chain: text(row.chain, 32),
    protocol: text(row.protocol, 80),
    direction: code(row.direction, 16),
    evidence: sanitizeEvidence(row.evidence),
    caveats: (Array.isArray(row.caveats) ? row.caveats : []).map((c) => text(c, 60)).filter(Boolean),
    exclusionReasons: (Array.isArray(row.exclusionReasons) ? row.exclusionReasons : [])
      .filter((r) => r && typeof r === 'object' && text(r.code, 60))
      .map((r) => ({ ...r, code: text(r.code, 60) })),
    ref
  };
}

/** The scanner summary rows the "AI scanner" room draws. */
export function sanitizeScannerRow(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    ...item,
    title: text(item.title, 200),
    chain: text(item.chain, 32),
    category: code(item.category, 40),
    reasons: sanitizeEvidence(item.reasons),
    exclusionCodes: (Array.isArray(item.exclusionCodes) ? item.exclusionCodes : []).map((c) => text(c, 60)).filter(Boolean)
  };
}

/** Coverage + per-feed status rows: every label and status drawn as text. */
export function sanitizeScan(scan) {
  if (!scan || typeof scan !== 'object') return null;
  /* An array is not a feed map: a cached `feeds: []` would otherwise become
     an empty object and be drawn as a row with no label. */
  const feeds = scan.feeds && typeof scan.feeds === 'object' && !Array.isArray(scan.feeds)
    ? Object.fromEntries(Object.entries(scan.feeds).map(([k, f]) => [
      k,
      f && typeof f === 'object' ? { ...f, status: text(f.status, 24), error: text(f.error, 120) } : { status: text(f, 24) }
    ]))
    : null;
  return {
    ...scan,
    opportunities: (Array.isArray(scan.opportunities) ? scan.opportunities : []).map(sanitizeOpportunityRow).filter(Boolean),
    rejected: (Array.isArray(scan.rejected) ? scan.rejected : []).map(sanitizeOpportunityRow).filter(Boolean),
    scanner: (Array.isArray(scan.scanner) ? scan.scanner : []).map(sanitizeScannerRow).filter(Boolean),
    coverage: (Array.isArray(scan.coverage) ? scan.coverage : [])
      .filter((c) => c && typeof c === 'object')
      .map((c) => ({ ...c, id: code(c.id, 40), source: text(c.source, 40), status: text(c.status, 24) })),
    feeds
  };
}

export default { text, httpUrl, code, sanitizeEvidenceRow, sanitizeEvidence, sanitizeOpportunityRow, sanitizeScannerRow, sanitizeScan };
