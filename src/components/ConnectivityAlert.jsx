import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { apiBase } from '../lib/apiBase';
import { classifyConnection } from '../lib/connectivity';
import { CONNECTIVITY_FALLBACKS } from '../i18n/connectivityFallbacks';
import { lockBodyScroll } from '../lib/scrollLock';
import '../styles/connectivity-alert.css';

const HEALTH_CHECK_INTERVAL = 45_000;
const QUICK_RETRY_DELAY = 2_500;
const HEALTH_CHECK_TIMEOUT = 5_000;
const SLOW_RESPONSE_THRESHOLD = 4_000;

/**
 * A global, full-screen connection warning.
 *
 * Browser `online` / `offline` events catch a lost network immediately. They
 * do not catch a captive portal, DNS failure, blocked route, or an API that is
 * simply unreachable while `navigator.onLine` remains true, so this also
 * checks the app's tiny /api/health endpoint. The Network Information API is
 * used as an optional hint on browsers that expose it; Safari and older
 * webviews still get the event + reachability checks.
 *
 * The acknowledgement dismisses one outage episode. It does not keep opening
 * over and over while someone is trying to use the app offline, but a healthy
 * connection resets the acknowledgement so a later outage is announced.
 */
export default function ConnectivityAlert() {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReducedMotion();
  const preferredLanguage = typeof document !== 'undefined'
    ? document.documentElement.lang
    : '';
  const locale = (preferredLanguage || i18n.resolvedLanguage || i18n.language || 'en').split('-')[0].toLowerCase();
  const fallbackCopy = CONNECTIVITY_FALLBACKS[locale] || CONNECTIVITY_FALLBACKS.en;
  const translateConnectivity = (key) => {
    const resource = i18n.getResource?.(locale, 'translation', `connectivityAlert.${key}`);
    return typeof resource === 'string' ? resource : (fallbackCopy[key] ?? t(`connectivityAlert.${key}`));
  };
  const [condition, setCondition] = useState(() => classifyConnection());
  const [acknowledged, setAcknowledged] = useState(false);
  const acknowledgeRef = useRef(null);
  const open = condition !== 'online' && !acknowledged;

  useEffect(() => {
    if (condition === 'online') setAcknowledged(false);
  }, [condition]);

  useEffect(() => {
    let mounted = true;
    let timer = null;
    let activeTimeout = null;
    let activeController = null;
    let inFlight = false;
    let failures = 0;
    let slowResponses = 0;
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const connection = nav?.connection || nav?.mozConnection || nav?.webkitConnection;

    const setIfMounted = (value) => {
      if (mounted) setCondition(value);
    };

    const schedule = (delay) => {
      if (!mounted) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(checkReachability, delay);
    };

    async function checkReachability() {
      if (!mounted) return;
      if (document.visibilityState === 'hidden') {
        schedule(HEALTH_CHECK_INTERVAL);
        return;
      }
      if (inFlight) {
        schedule(QUICK_RETRY_DELAY);
        return;
      }

      const hint = classifyConnection(nav);
      if (hint === 'offline') {
        failures = 2;
        setIfMounted('offline');
        schedule(HEALTH_CHECK_INTERVAL);
        return;
      }
      if (hint === 'weak') setIfMounted('weak');

      if (typeof fetch !== 'function' || typeof AbortController === 'undefined') {
        setIfMounted(hint);
        schedule(HEALTH_CHECK_INTERVAL);
        return;
      }

      inFlight = true;
      const controller = new AbortController();
      activeController = controller;
      const startedAt = Date.now();
      activeTimeout = window.setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);

      try {
        const base = apiBase().replace(/\/+$/, '');
        const response = await fetch(`${base}/health?_fbt_probe=${startedAt}`, {
          method: 'GET',
          cache: 'no-store',
          credentials: 'omit',
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`HEALTH_HTTP_${response.status}`);
        const payload = await response.json();
        if (payload?.ok !== true) throw new Error('HEALTH_RESPONSE_INVALID');
        if (!mounted) return;

        failures = 0;
        const roundTrip = Date.now() - startedAt;
        slowResponses = roundTrip >= SLOW_RESPONSE_THRESHOLD ? slowResponses + 1 : 0;
        const latestHint = classifyConnection(nav);
        setIfMounted(latestHint === 'offline'
          ? 'offline'
          : latestHint === 'weak' || slowResponses >= 2
            ? 'weak'
            : 'online');
        /* Confirm one very slow response quickly; ordinary healthy checks stay
           at a low-frequency heartbeat to avoid unnecessary background work. */
        schedule(slowResponses === 1 ? QUICK_RETRY_DELAY : HEALTH_CHECK_INTERVAL);
      } catch {
        if (!mounted) return;
        const latestHint = classifyConnection(nav);
        if (latestHint === 'offline') {
          failures = 2;
          setIfMounted('offline');
          schedule(HEALTH_CHECK_INTERVAL);
        } else {
          failures += 1;
          if (latestHint === 'weak' || failures >= 2) setIfMounted('weak');
          schedule(failures >= 2 ? HEALTH_CHECK_INTERVAL : QUICK_RETRY_DELAY);
        }
      } finally {
        if (activeTimeout !== null) window.clearTimeout(activeTimeout);
        activeTimeout = null;
        if (activeController === controller) activeController = null;
        inFlight = false;
      }
    }

    const onOffline = () => {
      failures = 2;
      setIfMounted('offline');
      schedule(HEALTH_CHECK_INTERVAL);
    };
    const onOnline = () => {
      failures = 0;
      slowResponses = 0;
      schedule(0);
    };
    const onConnectionChange = () => {
      const hint = classifyConnection(nav);
      if (hint === 'offline') {
        onOffline();
        return;
      }
      if (hint === 'weak') setIfMounted('weak');
      schedule(0);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') schedule(0);
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibilityChange);
    connection?.addEventListener?.('change', onConnectionChange);
    checkReachability();

    return () => {
      mounted = false;
      if (timer !== null) window.clearTimeout(timer);
      if (activeTimeout !== null) window.clearTimeout(activeTimeout);
      activeController?.abort();
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      connection?.removeEventListener?.('change', onConnectionChange);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    const unlockScroll = lockBodyScroll();
    const focusFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame(() => acknowledgeRef.current?.focus({ preventScroll: true }))
      : null;
    if (focusFrame === null) acknowledgeRef.current?.focus?.({ preventScroll: true });

    /* There is only one control in this alert, so keep keyboard focus on it
       instead of letting Tab reach controls hidden behind the full-screen
       layer. */
    const keepFocusInDialog = (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        acknowledgeRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', keepFocusInDialog, true);

    return () => {
      if (focusFrame !== null) window.cancelAnimationFrame?.(focusFrame);
      window.removeEventListener('keydown', keepFocusInDialog, true);
      unlockScroll();
      if (previouslyFocused && previouslyFocused !== document.body && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (typeof document === 'undefined') return null;

  const offline = condition === 'offline';
  const title = translateConnectivity(offline ? 'offlineTitle' : 'weakTitle');
  const body = translateConnectivity(offline ? 'offlineBody' : 'weakBody');
  const badge = translateConnectivity(offline ? 'offlineBadge' : 'weakBadge');
  const transition = reduceMotion
    ? { duration: 0.12 }
    : { type: 'spring', stiffness: 280, damping: 27 };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="connectivity-alert-layer" role="presentation">
          <motion.div
            className="connectivity-alert-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.12 : 0.2 }}
            aria-hidden="true"
          />
          <motion.section
            className={`connectivity-alert-screen${offline ? ' is-offline' : ' is-weak'}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="connectivity-alert-title"
            aria-describedby="connectivity-alert-body connectivity-alert-note"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.99 }}
            transition={transition}
          >
            <div className="connectivity-alert-glow" aria-hidden="true" />

            <header className="connectivity-alert-header">
              <span className="connectivity-alert-brand">
                <span className="connectivity-alert-brand-mark" aria-hidden="true">F</span>
                <span>FBT <b>SWAP</b></span>
              </span>
              <span className="connectivity-alert-badge">
                <span className="connectivity-alert-badge-dot" aria-hidden="true" />
                {badge}
              </span>
            </header>

            <div className="connectivity-alert-content">
              <div className="connectivity-alert-visual" aria-hidden="true">
                <span className="connectivity-alert-orbit connectivity-alert-orbit--outer" />
                <span className="connectivity-alert-orbit connectivity-alert-orbit--inner" />
                <div className="connectivity-alert-signal">
                  <SignalAlertIcon />
                </div>
                <span className="connectivity-alert-spark connectivity-alert-spark--one" />
                <span className="connectivity-alert-spark connectivity-alert-spark--two" />
              </div>

              <h1 className="connectivity-alert-title" id="connectivity-alert-title">{title}</h1>
              <p className="connectivity-alert-body" id="connectivity-alert-body">{body}</p>

              <div className="connectivity-alert-note" id="connectivity-alert-note">
                <span className="connectivity-alert-note-icon" aria-hidden="true"><InfoIcon /></span>
                <p>{translateConnectivity('transactionNote')}</p>
              </div>
            </div>

            <footer className="connectivity-alert-footer">
              <button
                ref={acknowledgeRef}
                type="button"
                className="connectivity-alert-acknowledge"
                onClick={() => setAcknowledged(true)}
              >
                <span>{translateConnectivity('acknowledge')}</span>
                <ArrowIcon />
              </button>
            </footer>
          </motion.section>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

function SignalAlertIcon() {
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" fill="none" aria-hidden="true">
      <path d="M9.5 25.2a37.1 37.1 0 0 1 49 0" />
      <path d="M17.7 34.1a24.6 24.6 0 0 1 32.6 0" />
      <path d="M26.2 43a12 12 0 0 1 15.6 0" />
      <circle cx="34" cy="52.7" r="2.8" />
      <path className="connectivity-alert-signal-cut" d="m12 12 44 44" />
      <circle className="connectivity-alert-signal-badge" cx="51.5" cy="18" r="11.5" />
      <path className="connectivity-alert-signal-exclamation" d="M51.5 12.3v6.1" />
      <circle className="connectivity-alert-signal-exclamation" cx="51.5" cy="22.1" r=".8" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="connectivity-alert-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
