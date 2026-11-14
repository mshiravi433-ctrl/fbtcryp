/**
 * THE BRIDGE BETWEEN THE CENTRAL BRAIN AND THE FIRST-PARTY PLUGINS
 * -----------------------------------------------------------------------
 *
 * WHY THIS FILE EXISTS
 *
 * `server/agentHub/native/agents.js` holds ELEVEN working plugins — a yield
 * optimizer that ranks DefiLlama pools, a token risk scanner that reads
 * GoPlus, a wallet exposure auditor, a strategy backtester, a smart-money
 * tracker. Each one is real code with a real data source and an honest
 * «the source did not answer» path. Measured on 2026-11-11: importing all
 * eleven costs 4 ms and 1.2 MB, and running one costs 0.4 ms warm when its
 * source is unavailable — they are the cheapest capability in the product.
 *
 * And a chat turn could not reach a single one of them. `runNativeAgent` had
 * ZERO call sites outside the Agent Hub page: the plugins were reachable from
 * their own dock, and dark to the brain that answers every question. So
 * «بهترین بازده استیبل‌کوین روی Arbitrum چیه» — a question a first-party
 * plugin answers from live data with no model call — arrived at the brain as
 * UNSUPPORTED, and the brain spent one of its 50 daily provider calls on a
 * generic model answer, or refused.
 *
 * The same ORDERING problem as `fitBridge.js` and `globalIntelBridge.js`:
 *
 *   · the agent hub is built AFTER the brain (it is mounted in `app.js`
 *     beside `ensureCentralIntelligence()`);
 *   · the brain is built BEFORE the hub, and sits on the boot path of every
 *     serverless cold start.
 *
 * So the same one-slot bridge, with the same three rules:
 *
 *   1. **The provider is optional.** Until the hub exists the bridge reports
 *      `PLUGIN_PROVIDER_NOT_WIRED` — a named reason, never a fabricated
 *      answer and never a throw.
 *   2. **The provider is per-turn.** The brain passes the message, the locale
 *      and the owner; a plugin's data access belongs to one request.
 *   3. **A failure is named, not thrown.** A plugin that crashes, times out
 *      or has no data must not take the turn down: the brain falls through to
 *      the next honest option (the model fallback, then the refusal).
 *
 * WHY NOT IMPORT THE PLUGINS DIRECTLY
 *
 * `server/agentHub/native/agents.js` pulls in the data-access layer and, on
 * first use, `providers.js` / `yields.js` / `tokenRisk.js`. The bridge keeps
 * all of it lazily loaded, which is what §5 of
 * `docs/PHASE-CPU-AND-DARK-PHASES.md` was written to protect.
 *
 * AND THE COST RULE THIS FILE OBEYS
 *
 * Matching happens in the PROVIDER, not here, and the provider is only
 * consulted on a turn the registry could not route AND the verified corpus
 * declined. On every other turn this module is never called: the attach costs
 * zero CPU on the hot path, which is the measurement that decided «upgrade»
 * instead of «remove».
 */

export const PLUGIN_BRIDGE_SCHEMA = 'fbt.ci.plugin-bridge.v1';

/** Never let a plugin's network read hold a chat turn open. */
export const PLUGIN_ATTACH_TIMEOUT_MS = 8_000;

/* A plugin body is generated per language by the plugin itself (`fa` is
   derived from the request text), but the bridge does not TRUST that: a
   Persian turn must never publish an English paragraph. The check is one
   regex over the answer, and a wrong-language answer is treated as no answer
   at all, so the brain falls through to its next honest option. */
const PERSIAN_RE = /[\u0600-\u06FF]/;

let provider = null;

/**
 * Register the plugin attach provider.
 *
 * @param {(req: { message: string, locale: string, owner: string|null, timeoutMs: number }) => Promise<any>} fn
 *   The closure from `server/agentHub/pluginAttach.js`.
 * @returns {() => void} a disposer, so a test can restore the previous state.
 */
export function setPluginProvider(fn) {
  const previous = provider;
  provider = typeof fn === 'function' ? fn : null;
  return () => { provider = previous; };
}

/** Test/diagnostic helper: drop the provider without knowing the old one. */
export function clearPluginProvider() {
  provider = null;
}

export function hasPluginProvider() {
  return typeof provider === 'function';
}

/**
 * Ask the first-party plugins whether one of them can answer this question.
 *
 * The contract is deliberately narrow: the bridge returns TEXT that is safe
 * to publish, plus the identity of the plugin that produced it and that
 * plugin's own `dataStatus`. It never returns a number of its own — every
 * figure in the text was read by the plugin from a named source, and a plugin
 * that could not read says so in its own text.
 *
 * @returns {Promise<{ ok: true, text: string, slug: string, title: string, dataStatus: string, citations: any[], matched: string[] }
 *   | { ok: false, code: string, detail: string|null }>}
 */
export async function consultPlugins({ message = '', locale = 'fa', owner = null, timeoutMs = PLUGIN_ATTACH_TIMEOUT_MS } = {}) {
  if (typeof provider !== 'function') {
    return {
      ok: false,
      code: 'PLUGIN_PROVIDER_NOT_WIRED',
      detail: 'the first-party plugins are not mounted in this process'
    };
  }
  const text = String(message || '').trim();
  if (!text) return { ok: false, code: 'EMPTY_QUESTION', detail: 'there is no question to attach a plugin to' };
  const budgetMs = Math.max(500, Math.min(PLUGIN_ATTACH_TIMEOUT_MS, Number(timeoutMs) || PLUGIN_ATTACH_TIMEOUT_MS));
  try {
    const out = await provider({ message: text.slice(0, 400), locale, owner, timeoutMs: budgetMs });
    if (!out || typeof out !== 'object') {
      return { ok: false, code: 'PLUGIN_NO_ANSWER', detail: 'the plugin layer answered with nothing' };
    }
    /* A plugin that found no match, or whose source did not answer, reports
       `ok:false` with its own code. That is an honest answer and it travels
       unchanged — the brain must be able to tell «no plugin fits» from «the
       plugin fits but its source is down». */
    if (out.ok !== true) {
      return { ok: false, code: out.code || 'PLUGIN_NO_ANSWER', detail: out.detail || null };
    }
    const answer = String(out.text || '').trim();
    if (answer.length < 20) {
      return { ok: false, code: 'PLUGIN_ANSWER_TOO_SHORT', detail: 'the plugin returned a fragment, not an answer' };
    }
    if (String(locale || 'fa') === 'fa' && !PERSIAN_RE.test(answer)) {
      return { ok: false, code: 'PLUGIN_ANSWER_WRONG_LANGUAGE', detail: 'the plugin answered in a language the turn is not in' };
    }
    /* The LEAD is the sentence the reply will headline, and it is checked
       separately: a Persian report whose verdict line came out English would
       pass the whole-text check and still leak into the headline. */
    const lead = String(out.lead || '').trim();
    if (lead.length < 8) {
      return { ok: false, code: 'PLUGIN_NO_LEAD', detail: 'the plugin report held no publishable verdict line' };
    }
    if (String(locale || 'fa') === 'fa' && !PERSIAN_RE.test(lead)) {
      return { ok: false, code: 'PLUGIN_LEAD_WRONG_LANGUAGE', detail: 'the plugin verdict line is not in the turn language' };
    }
    return {
      ok: true,
      lead,
      text: answer,
      slug: String(out.slug || 'plugin'),
      title: String(out.title || out.slug || 'plugin'),
      dataStatus: String(out.dataStatus || 'live'),
      citations: Array.isArray(out.citations) ? out.citations.slice(0, 8) : [],
      matched: Array.isArray(out.matched) ? out.matched.slice(0, 6).map((m) => String(m)) : []
    };
  } catch (err) {
    return {
      ok: false,
      code: 'PLUGIN_ATTACH_FAILED',
      detail: String(err?.message || err || 'unknown').slice(0, 160)
    };
  }
}

export default { PLUGIN_BRIDGE_SCHEMA, PLUGIN_ATTACH_TIMEOUT_MS, setPluginProvider, clearPluginProvider, hasPluginProvider, consultPlugins };
