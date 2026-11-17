/**
 * First-party research that may be explicitly attached to a Hyperliquid AI
 * proposal. This is evidence only: it cannot create an intent or authorize an
 * order. Both the task origin and the task's live-data status are checked here
 * so a third-party agent, stale fragment, partial read, or error report cannot
 * be smuggled into the trading prompt as if FBT verified it.
 */
export const TRADE_RESEARCH_MAX_CHARS = 2_200;
export const TRADE_RESEARCH_MAX_AGE_MS = 15 * 60_000;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function clean(value, limit) {
  return String(value ?? '').replace(CONTROL_RE, '').trim().slice(0, limit);
}

function privateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^\[(?:::1|::|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(host)) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((part) => part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function safeCitations(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    try {
      const url = new URL(String(raw));
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || privateHost(url.hostname)) continue;
      const safe = url.toString();
      if (safe.length > 200 || out.includes(safe)) continue;
      out.push(safe);
      if (out.length === 3) break;
    } catch {
      // An invalid citation is omitted, never repaired into a link.
    }
  }
  return out;
}

function nativeSlug(active) {
  if (!(active?.native === true || active?.source === 'native')) return null;
  const raw = String(active.id || '').trim().toLowerCase();
  const slug = raw.replace(/^fbt-native[:-]/, '');
  return SLUG_RE.test(slug) ? slug : null;
}

/**
 * Project a completed Hub task onto the small allow-listed object the trader
 * can read. `dataStatus === 'live'` is deliberate: partial is not evidence.
 */
export function tradeResearchFromTask(task, active, { now = Date.now(), maxAgeMs = TRADE_RESEARCH_MAX_AGE_MS } = {}) {
  if (!task || task.state !== 'completed' || task.terminal !== true || task.active !== false || task.providerId !== 'fbt-native') return null;
  const slug = nativeSlug(active);
  if (!slug) return null;
  const taskAgent = String(task.agentId || '').trim().toLowerCase();
  const taskSlug = taskAgent.replace(/^fbt-native[:-]/, '');
  if (!SLUG_RE.test(taskSlug) || taskSlug !== slug) return null;
  const data = task.result?.data;
  if (!data || data.dataStatus !== 'live' || data.needsInput === true) return null;
  const resultSlug = clean(data.agent || slug, 48).toLowerCase();
  if (!SLUG_RE.test(resultSlug) || resultSlug !== slug) return null;
  const report = clean(task.result?.text, TRADE_RESEARCH_MAX_CHARS);
  const readAt = Number(data.readAt);
  if (!report || !Number.isFinite(readAt) || readAt <= 0) return null;
  if (!Number.isFinite(now) || now < readAt || now - readAt > maxAgeMs) return null;
  const title = clean(data.title || active.nameFa || active.name || slug, 100);
  if (!title) return null;
  return Object.freeze({
    schema: 'fbt.ai-trade.first-party-research.v1',
    slug,
    title,
    text: report,
    citations: safeCitations(data.citations || task.result?.citations),
    readAt,
    dataStatus: 'live'
  });
}

/** Re-check the boundary immediately before including the report in a prompt. */
export function normalizeTradeResearch(value, { now = Date.now(), maxAgeMs = TRADE_RESEARCH_MAX_AGE_MS } = {}) {
  if (!value || value.schema !== 'fbt.ai-trade.first-party-research.v1' || value.dataStatus !== 'live') return null;
  const slug = clean(value.slug, 48).toLowerCase();
  const title = clean(value.title, 100);
  const text = clean(value.text, TRADE_RESEARCH_MAX_CHARS);
  const readAt = Number(value.readAt);
  if (!SLUG_RE.test(slug) || !title || !text) return null;
  if (!Number.isFinite(readAt) || readAt <= 0 || !Number.isFinite(now) || now < readAt || now - readAt > maxAgeMs) return null;
  return Object.freeze({
    schema: 'fbt.ai-trade.first-party-research.v1',
    slug,
    title,
    text,
    citations: safeCitations(value.citations),
    readAt,
    dataStatus: 'live'
  });
}

/* In-memory hand-off only. Reports are never put in localStorage or sent to
   the FBT server; the trader must opt in again on every analysis run. */
let queuedResearch = null;
const researchListeners = new Set();

function notifyResearchListeners(value) {
  for (const listener of researchListeners) {
    try { listener(value); } catch { /* one view cannot break the hand-off */ }
  }
}

export function queueTradeResearchForAiTrade(value, { now = Date.now() } = {}) {
  const safe = normalizeTradeResearch(value, { now });
  if (!safe) return false;
  queuedResearch = safe;
  let delivered = false;
  for (const listener of researchListeners) {
    try { listener(safe); delivered = true; } catch { /* a failed view leaves the hand-off queued */ }
  }
  if (delivered) queuedResearch = null;
  return true;
}

/** The route consumes a queued hand-off once; it is never persisted. */
export function takeQueuedTradeResearch({ now = Date.now() } = {}) {
  const value = normalizeTradeResearch(queuedResearch, { now });
  queuedResearch = null;
  return value;
}

export function clearQueuedTradeResearch() {
  queuedResearch = null;
  notifyResearchListeners(null);
}

export function subscribeTradeResearch(listener) {
  if (typeof listener !== 'function') return () => {};
  researchListeners.add(listener);
  return () => researchListeners.delete(listener);
}
