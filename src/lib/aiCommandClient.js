/**
 * AI COMMAND CENTER — the browser half of the API.
 * ───────────────────────────────────────────────────────────────────────────
 * Every call here is an ENRICHMENT, never a dependency, and that single fact
 * shapes the file:
 *
 *   · the AI page computes plans locally with the same module the server
 *     imports (`src/lib/intent-ai/commandCenter.js`), so a panel with no
 *     backend still classifies, plans, scores risk and enforces the budget;
 *   · when the API answers, its numbers are MERGED (live prices, ranked yield
 *     venues, an intent label from the model) rather than trusted blindly;
 *   · when it does not answer, the result is `null` and the caller paints the
 *     honest empty state. There is no `catch { return defaultData }` anywhere in
 *     here, because a fallback that looks like data is how a dead feed ends up
 *     showing "0 opportunities" as if it had counted them.
 *
 * URLs are RELATIVE (`/api/...`), which is what makes one build work on a
 * phone, a preview host and a self-hosted box without reconfiguration.
 */
import { apiBase } from './apiBase.js';

const TIMEOUT_MS = 8000;

/** Resolved per call, never at module load: in the native shell the base is the
 *  production origin, and a bundle that pinned '/api' at import time would
 *  quietly aim every AI request at the phone's own static server. */
const base = () => {
  try { return (typeof apiBase === 'function' ? apiBase() : '') || '/api'; } catch { return '/api'; }
};

async function call(path, { method = 'GET', body = null, timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${base()}${path}`, {
      method,
      signal: ctrl.signal,
      headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text.slice(0, 200) }; } })() : {};
    if (!res.ok) return { ok: false, status: res.status, ...json };
    return { ok: true, status: res.status, ...json };
  } catch (err) {
    /* Abort (timeout/offline) and network failure are the SAME state to this
       UI: nothing was sent, nothing is pending, say so. */
    return { ok: false, status: 0, error: err?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_UNAVAILABLE' };
  } finally {
    clearTimeout(timer);
  }
}

const payload = (extra = {}) => ({
  locale: typeof document !== 'undefined' ? document.documentElement?.lang || null : null,
  ...extra
});

/** message → intent → agent lanes → plan → firewall verdict. */
export const aiChat = (message, { surface = null, aiControl = null, prior = null } = {}) =>
  call('/ai/chat', { method: 'POST', body: payload({ message, surface, aiControl, prior }) });

/** Build and store a plan for the caller (approve / execute work on its id). */
export const aiBuildPlan = ({ message = '', surface = null, aiControl = null, holdings = null, dailyVolumeUsd = 0, chainId = null, prior = null } = {}) =>
  call('/ai/plan', { method: 'POST', body: payload({ message, surface, aiControl, holdings, dailyVolumeUsd, chainId, prior }) });

/**
 * The dashboard. GET has no portfolio half (the server cannot see a wallet), so
 * a caller with holdings uses POST — the SAME response schema either way, which
 * is the only reason the UI can render one card from both.
 */
export const aiDashboard = (context = {}) => (context.holdings || context.automations
  ? call('/ai/dashboard', { method: 'POST', body: payload(context) })
  : call('/ai/dashboard'));

export const aiApprovePlan = (id, { aiControl = null, dailyVolumeUsd = 0 } = {}) =>
  call(`/ai/plan/${encodeURIComponent(String(id || ''))}/approve`, { method: 'POST', body: { aiControl, dailyVolumeUsd } });

export const aiExecutePlan = (id, { aiControl = null, wallet = null, dailyVolumeUsd = 0 } = {}) =>
  call(`/ai/plan/${encodeURIComponent(String(id || ''))}/execute`, { method: 'POST', body: { aiControl, wallet, dailyVolumeUsd } });

export const aiAutomations = () => call('/ai/automations');
export const aiCreateAutomation = (automation) => call('/ai/automations', { method: 'POST', body: automation });
export const aiDeleteAutomation = (id) => call(`/ai/automations/${encodeURIComponent(String(id || ''))}`, { method: 'DELETE' });

export const aiEmergencyStop = (reason = 'user-stop') => call('/ai/emergency-stop', { method: 'POST', body: { reason } });
export const aiReleaseEmergencyStop = () => call('/ai/emergency-stop/release', { method: 'POST', body: { confirm: true } });

/**
 * The hidden roster: seventeen internal agents, four surfaces, zero of the
 * agents on the main screen. Reachable for the advanced tab and for API
 * consumers; not imported by the deck's default view.
 */
export const aiAgents = () => call('/ai/agents');
