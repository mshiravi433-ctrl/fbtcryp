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
 * Global, modern telemetry popup for offline & weak-internet states.
 *
 * Preserves browser online/offline listeners, Network Information API hints,
 * edge-cached `/api/health` reachability probes, offline cold-start locale
 * fallbacks, scroll lock, and single-episode dismissal latch.
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
        const response = await fetch(`${base}/health`, {
          method: 'GET',
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

    const onKeyDown = (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        acknowledgeRef.current?.focus({ preventScroll: true });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setAcknowledged(true);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      if (focusFrame !== null) window.cancelAnimationFrame?.(focusFrame);
      window.removeEventListener('keydown', onKeyDown, true);
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
    : { type: 'spring', stiffness: 310, damping: 28 };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="connectivity-alert-layer" role="presentation">
          <motion.div
            className="connectivity-alert-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.1 : 0.18 }}
            onClick={() => setAcknowledged(true)}
            aria-hidden="true"
          />

          <motion.section
            className={`connectivity-alert-screen connectivity-alert-card${offline ? ' is-offline' : ' is-weak connectivity-alert-weak'}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="connectivity-alert-title"
            aria-describedby="connectivity-alert-body connectivity-alert-note"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }}
            transition={transition}
          >
            {/* Ambient Aurora Mesh & Radar Grid */}
            <span className="connectivity-alert-aurora" aria-hidden="true">
              <i className="connectivity-alert-bloom connectivity-alert-bloom--a" />
              <i className="connectivity-alert-bloom connectivity-alert-bloom--b" />
              <i className="connectivity-alert-grid" />
            </span>

            {/* Top Telemetry Header: Brand Chip + Status Pill + Signal Meter */}
            <header className="connectivity-alert-header">
              <span className="connectivity-alert-brand" aria-hidden="true">
                <span className="connectivity-alert-brand-mark">F</span>
                <span>FBT <b>NET</b></span>
              </span>

              <div className="connectivity-alert-telemetry-meta">
                <span className="connectivity-alert-badge">
                  <span className="connectivity-alert-dot" aria-hidden="true" />
                  {badge}
                </span>
                <div className="connectivity-alert-bars" aria-hidden="true">
                  <i className={!offline ? 'is-lit' : ''} />
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </header>

            <div className="connectivity-alert-content">
              {/* Concentric Radar Visual */}
              <div className="connectivity-alert-hero-stage" aria-hidden="true">
                <div className="connectivity-alert-radar">
                  <span className="connectivity-alert-ring connectivity-alert-ring--outer" />
                  <span className="connectivity-alert-ring connectivity-alert-ring--inner" />
                  <TelemetrySignalSvg offline={offline} />
                </div>
              </div>

              <h1 className="connectivity-alert-title" id="connectivity-alert-title">
                {title}
              </h1>

              <p className="connectivity-alert-lead" id="connectivity-alert-body">
                {body}
              </p>

              {/* On-Chain Transaction Safety Bento Strip */}
              <div className="connectivity-alert-safety" id="connectivity-alert-note">
                <span className="connectivity-alert-safe-ico" aria-hidden="true">
                  <ShieldVaultIcon />
                </span>
                <p className="connectivity-alert-note">
                  {translateConnectivity('transactionNote')}
                </p>
              </div>
            </div>

            <footer className="connectivity-alert-footer">
              <button
                ref={acknowledgeRef}
                type="button"
                className="connectivity-alert-ack connectivity-alert-acknowledge"
                onClick={() => setAcknowledged(true)}
              >
                <span>{translateConnectivity('acknowledge')}</span>
                <CheckCircleIcon />
              </button>
            </footer>
          </motion.section>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

function TelemetrySignalSvg({ offline }) {
  return (
    <svg className="connectivity-alert-glyph" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      {offline ? (
        <>
          <path
            d="M6.8 16a18.2 18.2 0 0 1 26.4 0"
            stroke="currentColor"
            strokeOpacity="0.28"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M11.4 20.8a11.8 11.8 0 0 1 17.2 0"
            stroke="currentColor"
            strokeOpacity="0.52"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M16 25.5a5.6 5.6 0 0 1 8 0"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="20" cy="30.2" r="2.2" fill="currentColor" />
          <path
            d="M9.5 9.5 30.5 30.5"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <path
            d="M6.8 16a18.2 18.2 0 0 1 26.4 0"
            stroke="currentColor"
            strokeOpacity="0.22"
            strokeWidth="2.4"
            strokeDasharray="3.2 3.4"
            strokeLinecap="round"
          />
          <path
            d="M11.4 20.8a11.8 11.8 0 0 1 17.2 0"
            stroke="currentColor"
            strokeOpacity="0.46"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path
            d="M16 25.5a5.6 5.6 0 0 1 8 0"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="20" cy="30.2" r="2.3" fill="currentColor" />
          <circle cx="29.8" cy="11.2" r="4.8" fill="currentColor" fillOpacity="0.2" />
          <path
            d="M29.8 9v2.6M29.8 13.7h.01"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

function ShieldVaultIcon() {
  return (
    <svg viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path
        d="M11 2.4 18 5.2v5.3c0 4.6-3 7.7-7 9.1-4-1.4-7-4.5-7-9.1V5.2L11 2.4Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinejoin="round"
      />
      <path
        d="m8.2 11.2 1.9 1.9 3.8-3.9"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="m4.2 9.4 3.1 3.1 6.5-6.6"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
