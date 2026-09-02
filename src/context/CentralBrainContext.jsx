/**
 * FBT CENTRAL INTELLIGENCE OS — the one React context any screen uses to talk to
 * the brain (§14: a single brain, not a per-page assistant).
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this lives ABOVE the router instead of inside a chat page:
 * the brain's session is defined by the user, not by the screen they happen to
 * be on. «انجامش بده» has to resolve from the /swap screen to the intent that
 * /portfolio raised thirty seconds ago, so the thread, the confirmation card and
 * the shared-state digest all have to survive navigation. A provider mounted
 * inside a page would unmount on every route change and take the conversation
 * with it — which is precisely the failure this whole subsystem was built to
 * remove. It is why the old per-page context engine could never hold state: there
 * was nothing durable above the page to hold it.
 *
 * Reading the route from the hash rather than from `useLocation()` is the same
 * reasoning: at this position in the tree the Router may not exist yet (welcome,
 * onboarding, splash and the lock screen all render without it), and the brain
 * must be usable there too — a user asking «چقدر دارم؟» on the welcome screen is
 * a real user, and `resolvePage` on the server turns an unmapped route into
 * `module:'session'` instead of throwing.
 *
 * NOTHING in this file signs, derives, or stores a key (§36). The signature step
 * is the wallet's, and its only route back into the brain is `notifyReceipt`,
 * which carries a tx hash so the server can verify the action and run the
 * after-transaction refresh over every dependent module.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelAction,
  confirmAction,
  openEventStream,
  reportReceipt,
  sendIntent,
  syncPageContext,
  systemCapabilities,
  systemHealth,
  systemState
} from '../lib/central/client.js';
import { buildPageContext } from '../lib/central/pageContext.js';
import { useWallet } from './WalletContext.jsx';

const CentralBrainContext = createContext(null);

/** Events that mean "the numbers you are showing are now wrong" (§16). */
const REFRESH_EVENTS = new Set([
  'WALLET_CONNECTED', 'WALLET_DISCONNECTED', 'BALANCE_CHANGED', 'POSITION_CHANGED', 'RISK_CHANGED',
  'PRICE_CHANGED', 'TRANSACTION_PENDING', 'TRANSACTION_CONFIRMED', 'TRANSACTION_VERIFIED',
  'TRANSACTION_FAILED', 'STATE_REFRESH_STARTED', 'STATE_REFRESH_COMPLETED', 'ACTION_CREATED',
  'ACTION_CONFIRMED', 'ACTION_CANCELLED', 'ACTION_EXPIRED', 'POLICY_BLOCKED', 'SAFE_STOP',
  'ERROR_RECOVERED', 'CAPABILITY_CHANGED', 'HEALTH_CHANGED'
]);

const MAX_TURNS = 40;
const REFRESH_DEBOUNCE_MS = 400;

function currentRoute() {
  if (typeof window === 'undefined') return { pathname: '/', search: '' };
  const hash = String(window.location.hash || '');
  const raw = hash.startsWith('#') ? hash.slice(1) : hash || '/';
  const [pathname, search = ''] = raw.split('?');
  return { pathname: pathname || '/', search };
}

const readLocale = () => {
  try {
    if (typeof localStorage === 'undefined') return 'fa';
    const lang = String(localStorage.getItem('fbt-lang') || 'fa').slice(0, 2).toLowerCase();
    return lang === 'en' ? 'en' : 'fa';
  } catch {
    return 'fa';
  }
};

export function CentralBrainProvider({ children }) {
  const wallet = useWallet();
  const [turns, setTurns] = useState([]);
  const [pending, setPending] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [health, setHealth] = useState(null);
  const [transport, setTransport] = useState('offline');
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState(null);
  const routeRef = useRef(currentRoute());
  const walletRef = useRef(wallet);
  const pageSeq = useRef(0);
  walletRef.current = wallet;

  const page = useCallback(() => buildPageContext({
    pathname: routeRef.current.pathname,
    search: routeRef.current.search,
    wallet: walletRef.current,
    /* An unmapped route is not an error and is not guessed around; the server's
       PAGE_MAP decides what this screen is, and says `known:false` when it
       cannot, which the brain then shows instead of inventing a module. */
    at: Date.now()
  }), []);

  const pushTurn = useCallback((turn) => {
    setTurns((prev) => [...prev, { id: `t_${Date.now().toString(36)}${prev.length}`, at: Date.now(), ...turn }].slice(-MAX_TURNS));
  }, []);

  const refresh = useCallback(async ({ withData = false } = {}) => {
    const [state, caps, hlth] = await Promise.all([
      systemState({ includeData: withData }),
      systemCapabilities(),
      systemHealth()
    ]);
    /* Each surface is stored independently: when /system/capabilities is down but
       the state is fine, the UI keeps showing live sections and marks the
       capability panel stale, rather than blanking the whole brain because one of
       three reads failed. */
    if (state.ok) setSnapshot(state);
    if (caps.ok) setCapabilities(caps);
    if (hlth.ok) setHealth(hlth);
    return { state, caps, hlth };
  }, []);

  /* ── the only write path: a sentence to the brain ─────────────────────── */
  const ask = useCallback(async (message, opts = {}) => {
    const text = String(message || '').trim();
    if (!text) return { ok: false, code: 'EMPTY_MESSAGE' };
    setBusy(true);
    setLastError(null);
    pushTurn({ role: 'user', text, page: routeRef.current.pathname });
    try {
      const out = await sendIntent(text, {
        page: { ...page(), ...(opts.page || {}) },
        locale: opts.locale || readLocale(),
        ...(opts.requestId ? { requestId: opts.requestId } : {}),
        ...(opts.hints ? { hints: opts.hints } : {})
      });
      if (!out.ok) {
        setLastError({ code: out.code, detail: out.detail || out.error || null, at: Date.now() });
        pushTurn({ role: 'brain', text: null, error: { code: out.code, detail: out.detail || out.error || null }, mode: 'ERROR', ok: false });
        return out;
      }
      const res = out.response || {};
      pushTurn({
        role: 'brain',
        ok: true,
        intentId: out.intent?.intentId || null,
        mode: res.mode || null,
        text: res.text || null,
        sections: res.sections || [],
        headline: res.headline || null,
        ask: res.ask || null,
        confidence: res.confidence ?? null,
        provenance: res.provenance || null,
        replay: out.replay === true,
        stateIssues: res.stateIssues || null
      });
      /* The card, not a toast: a confirmation is a UI object with an expiry, and it
         has to survive the user navigating away and back. planDigest is kept with it
         so the confirm can prove it is approving the SAME plan the user read (§15). */
      if (res.requiresConfirmation && out.action?.actionId) {
        setPending({
          actionId: out.action.actionId,
          intentId: out.intent?.intentId || null,
          planDigest: out.action.planDigest || res.confirmationCard?.planDigest || null,
          card: res.confirmationCard || null,
          text: res.confirmationCard?.summary || res.headline || null,
          expiresAt: out.action.expiresAt || null,
          stateRevision: out.state?.revision ?? snapshot?.revision ?? null
        });
      } else if (!res.requiresConfirmation) {
        setPending(null);
      }
      /* Even a read turn moves the shared state (the brain just wrote the sections
         it fetched), so the digest is re-read rather than assumed. */
      if (res.stateIssues || out.state) refresh();
      return out;
    } finally {
      setBusy(false);
    }
  }, [page, pushTurn, refresh, snapshot?.revision]);

  const confirm = useCallback(async ({ execute = true } = {}) => {
    if (!pending?.actionId) return { ok: false, code: 'NO_PENDING_ACTION' };
    const { actionId, planDigest } = pending;
    setBusy(true);
    try {
      const out = await confirmAction(actionId, { planDigest, execute, method: 'button', locale: readLocale() });
      if (!out.ok) {
        /* 409 here means the plan or the state moved under the card. The card is
           dropped instead of being retried: silently re-asking the venue and
           re-presenting a different number as "confirmed" is how a user ends up
           signing something they never read. */
        setLastError({ code: out.code, detail: out.message || out.error || null, at: Date.now() });
        if (out.code === 'PLAN_CHANGED' || out.code === 'CONFIRMATION_EXPIRED' || out.code === 'ACTION_NOT_CONFIRMABLE') setPending(null);
        return out;
      }
      setPending(null);
      pushTurn({
        role: 'brain',
        ok: true,
        mode: 'EXECUTION',
        text: out.handoff ? null : out.summary || null,
        handoff: out.handoff || null,
        actionId: out.action?.actionId || actionId,
        status: out.action?.status || out.status || null
      });
      refresh();
      return out;
    } finally {
      setBusy(false);
    }
  }, [pending, pushTurn, refresh]);

  const cancel = useCallback(async (reason) => {
    if (!pending?.actionId) return { ok: false, code: 'NO_PENDING_ACTION' };
    const out = await cancelAction(pending.actionId, reason || 'cancelled by the user');
    setPending(null);
    pushTurn({ role: 'brain', ok: out.ok !== false, mode: 'CANCELLED', text: out.summary || null, actionId: pending.actionId });
    refresh();
    return out;
  }, [pending, pushTurn, refresh]);

  /** The wallet's callback after a broadcast — the ONLY way an action moves to
      VERIFIED, because verification is a chain read, not a UI event. */
  const notifyReceipt = useCallback(async ({ actionId, txHash, chainId = null, status = 'BROADCAST' }) => {
    const out = await reportReceipt(actionId || pending?.actionId, { txHash, chainId, status });
    if (out.ok) {
      pushTurn({ role: 'brain', ok: true, mode: 'VERIFICATION', text: out.summary || null, actionId: actionId || pending?.actionId, verification: out.verification || null });
      refresh({ withData: false });
    } else {
      setLastError({ code: out.code, detail: out.error || null, at: Date.now() });
    }
    return out;
  }, [pending?.actionId, pushTurn, refresh]);

  /* ── route + wallet are pushed so the brain never has to guess them (§7) ── */
  useEffect(() => {
    const onRoute = () => {
      const next = currentRoute();
      const changed = next.pathname !== routeRef.current.pathname || next.search !== routeRef.current.search;
      routeRef.current = next;
      if (changed) syncPageContext(page());
    };
    window.addEventListener('hashchange', onRoute);
    onRoute();
    return () => window.removeEventListener('hashchange', onRoute);
  }, [page]);

  useEffect(() => {
    /* A wallet change is not a reason to ask the user to repeat themselves, but it
       is a reason for the brain to re-read: `walletConnected` is part of the
       context, and a policy gate keys off the live balance. */
    pageSeq.current += 1;
    syncPageContext(page());
    refresh();
  }, [page, refresh, wallet?.address, wallet?.isConnected ?? wallet?.connected ?? null, wallet?.chainId ?? null]);

  /* ── §17 live sync, §16 cascade landing point ─────────────────────────── */
  useEffect(() => {
    let timer = null;
    const stream = openEventStream({
      onTransport: ({ transport: t }) => setTransport(t),
      onEvent: (evt) => {
        if (!evt || !REFRESH_EVENTS.has(evt.type)) return;
        /* Deliberately a re-read, not a local patch. A screen that applies the
           event payload itself would be a second source of truth, and the next
           feature to "optimise" it would drift from what the server verified.
           Coalesced, because one transaction publishes several events at once and
           they all invalidate the same sections. */
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          refresh();
        }, REFRESH_DEBOUNCE_MS);
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      stream.close();
    };
  }, [refresh]);

  useEffect(() => {
    if (!pending?.expiresAt) return undefined;
    const ms = Number(pending.expiresAt) - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return undefined;
    /* The card disappears on its own schedule. Leaving a stale "Confirm" button
       live past the quote's expiry invites a click that the server must refuse —
       refused clicks are what make users think the app is broken. */
    const timer = setTimeout(() => setPending(null), ms);
    return () => clearTimeout(timer);
  }, [pending?.expiresAt, pending?.actionId]);

  const value = useMemo(() => ({
    ask,
    confirm,
    cancel,
    notifyReceipt,
    refresh,
    /* The thread is exposed read-only on purpose: screens render it, they do not
       append to it. A page that could push a turn could also fake a confirmed one. */
    turns,
    pending,
    snapshot,
    capabilities: capabilities?.capabilities || capabilities || null,
    health: health?.modules || health || null,
    transport,
    busy,
    lastError,
    page
  }), [ask, confirm, cancel, notifyReceipt, refresh, turns, pending, snapshot, capabilities, health, transport, busy, lastError, page]);

  return <CentralBrainContext.Provider value={value}>{children}</CentralBrainContext.Provider>;
}

/**
 * `{}` when no provider is mounted, never a throw: a lazy-loaded screen must
 * still render (and show "the brain is offline") instead of blanking the route on
 * a missing provider during a partial rollout.
 */
export const useCentralBrain = () => useContext(CentralBrainContext) ?? {};

export default CentralBrainContext;
