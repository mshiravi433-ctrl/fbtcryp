/**
 * FBT FINANCIAL INTELLIGENCE OS — Cross-Asset AI Commentary (Phase 211.2).
 * ---------------------------------------------------------------------------
 * The local narrative (crossAsset.js → crossNarrative) is deterministic
 * arithmetic rendered as prose. This module adds the layer the owner asked
 * for with «تحلیل جامع با کمک هوش مصنوعی»: an LLM synthesis OVER the same
 * numbers, via the ONE gateway every other AI surface uses
 * (server/aiGateway.js → routedChat, with its own provider failover).
 *
 * ─── THE HONESTY LINE ──────────────────────────────────────────────────────
 *   · the prompt carries ONLY the already-computed, bounded digest + the
 *     local narrative facts — no keys, no owner identifiers, no raw state;
 *   · the model is instructed to use ONLY those numbers and to name what is
 *     missing instead of filling gaps (§49: data, not authority);
 *   · the result is stamped `untrusted: true` and its provider/model are
 *     named on the object, so the screen can show exactly who said it;
 *   · with no external provider configured the module says NO_AI_PROVIDER
 *     and the screen keeps the local narrative — the canned internal engine
 *     is NOT passed off as analysis of this pass's numbers;
 *   · a dead/timeout provider is an honest UNAVAILABLE, never a crash and
 *     never a silent empty string.
 *
 * Caching: keyed by the CONTENT of the analysis (regime + per-class averages
 * + outlook label), TTL 2 minutes, single-flight per key — the panel polls
 * every 60s and must not burn provider quota re-synthesizing an unchanged
 * market.
 */
import { createHash } from 'node:crypto';
import { routedChat, getPreferredProvidersForTask } from '../aiGateway.js';

export const CROSS_COMMENTARY_SCHEMA = 'fbt.fi.cross-commentary.v1';

const TTL_MS = 120_000;
const MAX_CHARS = 1600;
const TIMEOUT_MS = 15_000;
const cache = new Map(); // contentKey → { at, value }
const inFlight = new Map(); // contentKey → Promise

const contentKeyOf = (analysis) => {
  const votes = (analysis?.regime?.votes || []).map((v) => `${v.cls}:${v.avg}`).join('|');
  return createHash('sha256').update(JSON.stringify({
    regime: analysis?.regime?.regime || null,
    votes,
    outlook: analysis?.outlook?.label || null,
    score: analysis?.outlook?.score ?? null,
    macro: (analysis?.macro?.indicators || []).map((q) => `${q.symbol}:${q.change1dPct}`).join('|'),
    missing: (analysis?.missing || []).join(',')
  })).digest('hex').slice(0, 24);
};

/** Bounded, model-safe facts: ONLY numbers the engine actually computed. */
function factsOf(analysis, { persian }) {
  const lines = [];
  const observed = analysis?.observedClasses || [];
  lines.push(`observed_classes: ${observed.join(', ') || 'none'}`);
  for (const cls of observed) {
    const c = analysis.classes?.[cls];
    if (!c) continue;
    const top = (c.top || []).slice(0, 3).map((r) => `${r.symbol} ${r.changePct > 0 ? '+' : ''}${r.changePct}%`).join(', ');
    const bottom = (c.bottom || []).slice(0, 3).map((r) => `${r.symbol} ${r.changePct > 0 ? '+' : ''}${r.changePct}%`).join(', ');
    lines.push(`class ${cls}: avg ${c.avgChangePct}% over ${c.withChange}/${c.instruments} instruments, advancing ${c.advancing}, declining ${c.declining}${c.fallbackSource ? ` (fallback source: ${c.fallbackSource})` : ''}; leaders: ${top || 'n/a'}; laggards: ${bottom || 'n/a'}`);
  }
  if (analysis.regime?.regime) lines.push(`regime: ${analysis.regime.regime} (co-movement ${analysis.regime.coMovement})`);
  for (const d of (analysis.divergences || []).slice(0, 3)) {
    lines.push(`divergence: ${d.classes[0]} ${d.avgChangePct[d.classes[0]]}% vs ${d.classes[1]} ${d.avgChangePct[d.classes[1]]}% (${d.gapPct}pp)`);
  }
  const quotes = (analysis.macro?.indicators || []).filter((q) => q.change1dPct !== null || q.change7dPct !== null).slice(0, 8);
  if (quotes.length) {
    lines.push(`macro_quotes: ${quotes.map((q) => `${q.symbol} ${q.priceUsd} (1d ${q.change1dPct ?? 'n/a'}%, 7d ${q.change7dPct ?? 'n/a'}%)`).join('; ')}`);
  }
  if (analysis.macro?.curve && analysis.macro.curve.spreadPct !== null && analysis.macro.curve.spreadPct !== undefined) {
    lines.push(`yield_curve_2s10s: ${analysis.macro.curve.spreadPct}pp`);
  }
  if (analysis.outlook && analysis.outlook.label && analysis.outlook.label !== 'UNAVAILABLE') {
    lines.push(`economic_outlook: ${analysis.outlook.label} score ${analysis.outlook.score}`);
    for (const s of (analysis.outlook.signals || []).slice(0, 4)) lines.push(`outlook_signal: ${s.name} → ${s.evidence}`);
  }
  const miss = analysis?.missing || [];
  if (miss.length) {
    lines.push(`unread_classes: ${miss.map((c) => `${c}${analysis.missingReasons?.[c] ? ` (reason: ${analysis.missingReasons[c]})` : ''}`).join(', ')}`);
  }
  lines.push(`local_analysis_${persian ? 'fa' : 'en'}: ${persian ? analysis.narrative?.fa : analysis.narrative?.en}`.slice(0, 1200));
  return lines.join('\n').slice(0, 3400);
}

const SYSTEM_FA = [
  'تو تحلیل‌گر مالی «FBT» هستی و یک پاراگراف تحلیل جامع کراس-است می‌نویسی.',
  'قوانین غیرقابل‌مذاکره:',
  '۱) فقط از اعداد «facts» استفاده کن؛ هیچ عددی از خودت نساز و هیچ داده‌ای را پر نکن.',
  '۲) کلاس‌ها/ابزارهایی که خوانده نشده‌اند را «خوانده‌نشده» نام ببر؛ جای خالی را حدس نزن.',
  '۳) هیچ توصیهٔ خرید/فروش، هیچ هدف قیمتی و هیچ وعده‌ای نده — این داده است، نه سیگنال معامله.',
  '۴) حداکثر ۹۰ کلمه، یک پاراگراف روان فارسی، بدون فهرست گلوله‌ای، بدون markdown.',
  '۵) اگر ورودی‌ها ناکافی بود، صریح بگو چه چیزی خوانده نشده و تحلیل را محدود به همان‌ها کن.'
].join(' ');
const SYSTEM_EN = [
  'You are FBT\u2019s financial analyst writing ONE comprehensive cross-asset paragraph.',
  'Non-negotiable rules:',
  '1) use ONLY the numbers in the facts; invent no number and fill no gap.',
  '2) name unread classes/instruments as unread; never guess over a gap.',
  '3) no buy/sell advice, no price targets, no promises — this is data, not a trade signal.',
  '4) at most 90 words, one flowing paragraph, no bullet lists, no markdown.',
  '5) if the inputs are thin, say plainly what was not read and scope the analysis to what was.'
].join(' ');

/**
 * The LLM commentary over one analysis.
 *
 * @param {object} p
 * @param {object} p.analysis      the analyzeCrossAsset() result (carries .narrative)
 * @param {string} [p.language]    'fa' | 'en' — the requested output language
 * @returns {object} { schema, status, text?, provider?, model?, at, untrusted, reason? }
 */
export async function crossCommentary({ analysis = null, language = 'fa' } = {}) {
  if (!analysis || analysis.status === 'UNAVAILABLE') {
    return { schema: CROSS_COMMENTARY_SCHEMA, status: 'UNAVAILABLE', reason: 'NO_CROSS_ASSET_DATA', at: Date.now(), untrusted: true };
  }
  const persian = String(language).toLowerCase().startsWith('fa');
  const key = `${contentKeyOf(analysis)}:${persian ? 'fa' : 'en'}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...hit.value, cached: true };
  if (inFlight.has(key)) return inFlight.get(key);

  const run = (async () => {
    /* Only EXTERNAL providers count as «AI». The internal engine's canned
       text is not an analysis of this pass's numbers, so when nothing
       external is configured the honest answer is NO_AI_PROVIDER and the
       screen keeps the local narrative. */
    const providers = getPreferredProvidersForTask('market', { configuredOnly: true }).filter((p) => p !== 'internal');
    if (!providers.length) {
      const value = { schema: CROSS_COMMENTARY_SCHEMA, status: 'LOCAL_ONLY', reason: 'NO_AI_PROVIDER', at: Date.now(), untrusted: true };
      cache.set(key, { at: Date.now(), value });
      return value;
    }
    try {
      const routed = await Promise.race([
        routedChat({
          taskType: 'market',
          system: persian ? SYSTEM_FA : SYSTEM_EN,
          user: `${persian ? 'حقایق همین دور (فقط همین‌ها):' : 'This pass\u2019s facts (only these):'}\n${factsOf(analysis, { persian })}\n\n${persian ? 'یک پاراگراف تحلیل جامع فارسی بنویس.' : 'Write the one comprehensive English paragraph.'}`,
          temperature: 0.2,
          maxTokens: 420
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('COMMENTARY_TIMEOUT')), TIMEOUT_MS).unref?.())
      ]);
      const text = String(routed?.text || '').replace(/```[a-z]*\n?/gi, '').trim().slice(0, MAX_CHARS);
      /* A refusal/empty/echo answer is not a commentary — name it and stop. */
      if (!text || text.length < 40 || /^\s*(error|خطا)\b/i.test(text)) {
        const value = { schema: CROSS_COMMENTARY_SCHEMA, status: 'UNAVAILABLE', reason: 'COMMENTARY_UNUSABLE', at: Date.now(), untrusted: true, provider: routed?.provider || null };
        cache.set(key, { at: Date.now(), value });
        return value;
      }
      const value = {
        schema: CROSS_COMMENTARY_SCHEMA,
        status: 'OK',
        text,
        provider: routed?.provider || null,
        providerName: routed?.providerName || null,
        model: routed?.model || null,
        degraded: routed?.degraded === true,
        at: Date.now(),
        untrusted: true,
        note: 'AI synthesis over this pass\u2019s real reads — data, not authority; the numbers live in the cards, not in this text'
      };
      cache.set(key, { at: Date.now(), value });
      return value;
    } catch (err) {
      const value = {
        schema: CROSS_COMMENTARY_SCHEMA,
        status: 'UNAVAILABLE',
        reason: String(err?.message || err).includes('COMMENTARY_TIMEOUT') ? 'COMMENTARY_TIMEOUT' : 'COMMENTARY_PROVIDER_FAILED',
        at: Date.now(),
        untrusted: true
      };
      cache.set(key, { at: Date.now(), value });
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, run);
  return run;
}

/** Test seam: drop every cached commentary (the probes use this). */
export function resetCommentaryCache() {
  cache.clear();
  inFlight.clear();
}

export default crossCommentary;
