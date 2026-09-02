/**
 * FBT FUTURES — shared state + browser event bus (spec §15).
 * ---------------------------------------------------------------------------
 * One zustand store for the three Futures tabs, the Intent OS and any card
 * that wants to know "which market is selected / which venue is active / what
 * did the last order do". Nothing here is persisted: positions, quotes and
 * balances are re-read from the backend every time, so a stale snapshot can
 * never survive a reload and pretend to be live.
 *
 * `emitFuturesEvent` fans out to (1) store subscribers, (2) the Intent OS
 * event bus (`fbt:ai-event` window event, same shape the OS already listens
 * to) and (3) a `fbt:futures-event` DOM event for non-React listeners.
 */
import { create } from 'zustand';
import { FUTURES_EVENT_SET } from './events.js';

const MAX_EVENTS = 100;

export const useFuturesStore = create((set, get) => ({
  selectedProviderId: null,
  selectedMarketId: null,
  selectedSide: 'long',
  providers: [],
  providersStatus: 'idle',
  lastQuote: null,
  lastRisk: null,
  lastExecution: null,
  positionsByProvider: {},
  events: [],

  setSelection(patch) {
    const prev = get();
    const next = { ...patch };
    set(next);
    if (patch.selectedMarketId && patch.selectedMarketId !== prev.selectedMarketId) {
      emitFuturesEvent('FUTURES_MARKET_SELECTED', { marketId: patch.selectedMarketId, providerId: patch.selectedProviderId ?? prev.selectedProviderId });
    }
    if (patch.selectedProviderId && patch.selectedProviderId !== prev.selectedProviderId) {
      emitFuturesEvent('FUTURES_PROVIDER_CHANGED', { providerId: patch.selectedProviderId });
    }
  },
  setProviders(providers, status = 'live') {
    set({ providers: Array.isArray(providers) ? providers : [], providersStatus: status });
  },
  setQuote(quote) { set({ lastQuote: quote || null }); if (quote) emitFuturesEvent('FUTURES_QUOTE_UPDATED', { providerId: quote.providerId, marketId: quote.marketId, requestId: quote.requestId }); },
  setRisk(risk) { set({ lastRisk: risk || null }); if (risk) emitFuturesEvent('FUTURES_RISK_UPDATED', { riskLevel: risk.riskLevel, riskScore: risk.riskScore, blocked: risk.blocked }); },
  setExecution(execution) { set({ lastExecution: execution || null }); },
  setPositions(providerId, positions) {
    set((s) => ({ positionsByProvider: { ...s.positionsByProvider, [providerId]: positions } }));
  },
  _pushEvent(event) {
    set((s) => ({ events: [...s.events, event].slice(-MAX_EVENTS) }));
  }
}));

export function emitFuturesEvent(type, payload = {}) {
  const name = String(type || '');
  if (!FUTURES_EVENT_SET.has(name)) {
    // Unknown names are refused rather than silently fanned out: the
    // vocabulary in events.js is the contract.
    return null;
  }
  const event = { type: name, payload: payload && typeof payload === 'object' ? payload : {}, at: Date.now(), source: 'futures' };
  useFuturesStore.getState()._pushEvent(event);
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('fbt:futures-event', { detail: event }));
      /* Same envelope the Intent OS event bus uses (schema fbt.ai-event.v1). */
      window.dispatchEvent(new CustomEvent('fbt:ai-event', {
        detail: { id: `${event.at.toString(36)}_fut`, schema: 'fbt.ai-event.v1', type: `futures.${name.replace(/^FUTURES_/, '').toLowerCase()}`, source: 'futures', payload: event.payload, timestamp: event.at, iso: new Date(event.at).toISOString() }
      }));
    }
  } catch { /* the bus must never break the caller */ }
  return event;
}

export function onFuturesEvent(handler) {
  if (typeof window === 'undefined') return () => {};
  const fn = (e) => { try { handler(e.detail); } catch { /* observer must not break the bus */ } };
  window.addEventListener('fbt:futures-event', fn);
  return () => window.removeEventListener('fbt:futures-event', fn);
}
