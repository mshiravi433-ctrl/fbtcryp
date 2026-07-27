/**
 * Client for the server-side AI endpoints.
 *
 * The keys never reach the browser — see server/ai.js. This module only knows
 * how to call our own /api/ai/* routes and how to fail gracefully when AI is
 * not configured, so the Signals screen still works on indicators alone.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

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

export async function aiStatus() {
  try {
    const res = await fetch(`${API_BASE}/ai/status`);
    if (!res.ok) return { enabled: false, news: false };
    return await res.json();
  } catch {
    return { enabled: false, news: false };
  }
}

export const getOutlook = (payload) => post('/ai/outlook', payload);
export const getMarketBrief = (payload) => post('/ai/brief', payload);
export const askFaq = (question, lang) => post('/ai/faq', { question, lang }, 45000);
