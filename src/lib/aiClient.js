/**
 * Client for the server-side AI endpoints.
 *
 * The keys never reach the browser — see server/ai.js. This module only knows
 * how to call our own /api/ai/* routes and how to fail gracefully when AI is
 * not configured, so the Signals screen still works on indicators alone.
 */

/**
 * In the browser/Mini App a relative '/api' works because the API is served
 * from the same origin. Inside the Android APK the page is served from
 * https://localhost, so a relative path resolves to nothing — the build must
 * supply an absolute origin via VITE_API_BASE.
 */
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/** True when we have no absolute API to talk to (packaged app, unset base). */
export const apiUnreachable = () =>
  API_BASE.startsWith('/') && typeof window !== 'undefined' && window.location.protocol === 'capacitor:';

async function post(path, body, timeout = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.code = data?.error;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

import { directGeminiAvailable, directBrief, directFaq, directOutlook } from './geminiDirect';
import { localAnswer } from './faqLocal';

/**
 * Resolution order for every AI call:
 *   1. Our backend  — key stays server-side, responses cached, news grounding.
 *   2. Direct Gemini — key ships in the app; only used when no backend exists,
 *      because a dead feature is worse for users than an app-restricted key.
 *
 * `aiStatus()` reports which one is live so the UI can explain itself instead
 * of silently doing nothing.
 */

let cachedStatus = null;

export async function aiStatus(force = false) {
  if (cachedStatus && !force) return cachedStatus;

  // Probe the backend, but don't hang the UI on it.
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${API_BASE}/ai/status`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      if (data?.enabled) {
        cachedStatus = { ...data, mode: 'server' };
        return cachedStatus;
      }
    }
  } catch {
    /* no backend reachable — fall through to the direct path */
  }

  // No backend and no packaged key: the assistant still answers, from the
  // built-in knowledge base. `enabled` stays true because the feature really
  // does work — `mode` tells the UI to label the source honestly.
  cachedStatus = directGeminiAvailable()
    ? { enabled: true, news: false, mode: 'direct' }
    : { enabled: true, news: false, mode: 'local' };
  return cachedStatus;
}

async function viaServerOr(directFn, path, payload) {
  const status = await aiStatus();
  if (status.mode === 'server') {
    try {
      return await post(path, payload);
    } catch (e) {
      // A server that's up but erroring shouldn't block us if we can go direct.
      if (!directGeminiAvailable()) throw e;
    }
  }
  if (!directGeminiAvailable()) throw new Error('AI_NOT_CONFIGURED');
  return directFn(payload);
}

export const getOutlook = (payload) => viaServerOr(directOutlook, '/ai/outlook', payload);
export const getMarketBrief = (payload) => viaServerOr(directBrief, '/ai/brief', payload);

/**
 * Answer a support question.
 *
 * Order: backend model -> packaged Gemini -> built-in knowledge base. The
 * local tier is not a stub; for the questions people actually ask about fees,
 * gas and failed swaps it is more accurate than a general model, because we
 * wrote it about this exact app. The response carries `source` so the UI can
 * say where the answer came from instead of implying a live model answered.
 */
export async function askFaq(question, lang) {
  try {
    const res = await viaServerOr((p) => directFaq(p), '/ai/faq', { question, lang });
    if (res?.answer) return { ...res, source: 'model' };
  } catch {
    /* fall through to the offline knowledge base */
  }

  const local = localAnswer(question, lang);
  if (local) return { answer: local.answer, source: 'local', confidence: local.confidence };

  // Nothing matched: say so plainly and point at a human, rather than
  // inventing an answer about someone's money.
  return { answer: null, source: 'none' };
}
