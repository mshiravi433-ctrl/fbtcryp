/**
 * THE NOTIFICATION BAR — the phone's shade, drawn inside the app
 * ---------------------------------------------------------------------------
 * «دیزاین باید مثل همین نوتفیکیشن بار در اندروید یا ایفون باشد … یک چیز خیلی
 *  حرفه‌ای درست کن که کاربر را مشتاق به ادامهٔ کار با اپ کند.»
 *
 * WHY THIS EXISTS AT ALL, GIVEN THE OS ALREADY HAS A SHADE
 *
 * A system notification can only be raised when the OS lets us: permission
 * granted, app installed, and — on the web — a service worker that is alive. On
 * the APK a foreground alert CAN be posted, but the OS then draws it with its own
 * typography, no artwork on some OEMs, and no progress at all. So the one place
 * the design the owner sent can be reproduced EXACTLY is inside our own app, and
 * this component is that reproduction:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ ◉ FBT SWAP        PROFIT              5:46   │  brand + tone + time
 *   │                                              │
 *   │ به هدف رسید — آمادهٔ سواپ        +12.4%       │  copy + big number
 *   │ BTC → USDT                                   │  label
 *   │ ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░                    │  progress rail
 *   └──────────────────────────────────────────────┘
 *
 * Everything is driven by `tone` from src/lib/notificationDesign.js, which is the
 * SAME table the server uses to paint the artwork in the OS shade. Profit is
 * mint, loss is crimson, pending amber, ready green, alert pink, info blue — and
 * the background of this card is the same two-colour aurora that the pushed
 * artwork uses, so an alert looks identical whether the user sees it in the app
 * or on the lock screen. That is the "هم‌گام با سود و ضرر رنگش تغییر کند" part.
 *
 * ─── WHY IT IS NOT A TOAST ─────────────────────────────────────────────────
 * `<Toasts>` already exists and is the right thing for "saved" / "copied". This
 * is different: it is the notification SURFACE, it stacks at most three, it
 * carries a number and a progress, it is swipeable, and it deep-links. Keeping
 * the two separate is what lets each one be right at its job.
 *
 * ─── PERFORMANCE ───────────────────────────────────────────────────────────
 * No canvas, no image, no timers per card. One CSS gradient (composited), one
 * animated rail (transform only), and a single `setInterval` for the clock that
 * runs only while a card is visible. Motion is disabled wholesale under
 * `prefers-reduced-motion` — see the stylesheet.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { TONES, normalizeTone, toneSpec } from '../lib/notificationDesign.js';
import './../styles/notification-bar.css';

/** How long a non-persistent card stays before it releases the screen. */
const LIFETIME = 6200;

/** Local clock in the same "5:46" form the reference cards use. */
function clockOf(ts, lang) {
  try {
    return new Date(ts).toLocaleTimeString(lang || 'fa-IR', {
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    const d = new Date(ts);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

/** The same two-arrow geometry as the Android status icon and banner. */
function BrandMark({ color }) {
  return (
    <span className="nbar__mark-wrap" aria-hidden="true">
      <svg className="nbar__mark" viewBox="0 0 24 24" focusable="false">
        <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
          <path d="M13.94 4.76 A7.5 7.5 0 0 1 13.94 19.24" />
          <path d="M10.06 19.24 A7.5 7.5 0 0 1 10.06 4.76" />
        </g>
        <path d="M10.08 20.28 L14.61 21.75 L13.27 16.73 Z" fill={color} />
        <path d="M13.92 3.72 L9.39 2.25 L10.73 7.27 Z" fill={color} />
      </svg>
    </span>
  );
}

function ProgressRail({ value, color, reduced, lang }) {
  const pct = Math.max(0, Math.min(100, Number(value)));
  const language = String(lang || 'fa').split('-')[0];
  const label = language === 'fa' ? 'پیشرفت' : language === 'ar' ? 'التقدم' : 'Progress';
  return (
    <div className="nbar__rail" role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <motion.span
        className="nbar__rail-fill"
        style={{ background: `linear-gradient(90deg, ${color}88, ${color})` }}
        initial={{ scaleX: reduced ? pct / 100 : 0 }}
        animate={{ scaleX: pct / 100 }}
        transition={reduced ? { duration: 0 } : { duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

function Card({ item, lang, onClose, onOpen, preview = false }) {
  const spec = toneSpec(item.tone);
  const reduced = useReducedMotion();
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [paused, setPaused] = useState(false);
  const language = String(lang || 'fa').split('-')[0];
  const closeLabel = language === 'fa' ? 'بستن' : language === 'ar' ? 'إغلاق' : 'Close';
  const openLabel = language === 'fa' ? 'باز کردن اعلان' : language === 'ar' ? 'فتح الإشعار' : 'Open notification';

  /*
   * Auto-release. A card that stays forever is a card the user cannot get rid
   * of on a phone with no obvious close affordance, so:
   *   · money news (profit / loss) and an explicit `persist` wait for the user;
   *   · everything else fades.
   * Hovering or touching pauses the countdown, because reading it is the point.
   */
  const sticky = preview || item.persist || item.tone === 'profit' || item.tone === 'loss' || item.tone === 'alert';
  useEffect(() => {
    if (sticky) return undefined;
    if (dragging || paused) return undefined;
    const timer = setTimeout(() => onClose(item.id), LIFETIME);
    return () => clearTimeout(timer);
  }, [item.id, sticky, dragging, paused, onClose]);

  const values = useMemo(
    () => ({
      '--tone-from': spec.from,
      '--tone-to': spec.to,
      '--tone-accent': spec.accent,
      '--tone-ink': spec.ink
    }),
    [spec]
  );

  return (
    <motion.div
      ref={ref}
      className={`nbar__card nbar__card--${normalizeTone(item.tone)}${dragging ? ' is-dragging' : ''}${preview ? ' nbar__card--preview' : ''}`}
      style={values}
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: -28, scale: 0.96 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -20, scale: 0.97 }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
      drag={reduced || preview ? false : 'y'}
      dragConstraints={{ top: -80, bottom: 0 }}
      dragElastic={0.32}
      onDragStart={() => setDragging(true)}
      onDragEnd={(_, info) => {
        setDragging(false);
        if (info.offset.y < -46 || info.velocity.y < -420) onClose(item.id);
      }}
      role={preview ? 'img' : undefined}
      aria-label={preview ? `${item.title} — ${item.body || ''}` : undefined}
      onClick={preview ? undefined : () => onOpen(item)}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') setPaused(true); }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') setPaused(false); }}
      onPointerDown={(event) => { if (event.pointerType === 'touch') setPaused(true); }}
      onPointerUp={(event) => { if (event.pointerType === 'touch') setPaused(false); }}
      onPointerCancel={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
    >
      <span className="nbar__aurora" aria-hidden="true" />
      <span className="nbar__grid" aria-hidden="true" />
      <span className="nbar__orbit" aria-hidden="true" />
      <span className="nbar__sheen" aria-hidden="true" />
      {preview ? null : (
        <button
          type="button"
          className="nbar__hit-target"
          aria-label={`${openLabel}: ${item.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(item);
          }}
        />
      )}

      <span className="nbar__head">
        <BrandMark color={spec.accent} />
        <span className="nbar__brand-lockup" dir="ltr">
          <span className="nbar__brand">FBT SWAP</span>
          <span className="nbar__brand-sub">NOTIFICATIONS</span>
        </span>
        <span className="nbar__chip" style={{ color: spec.accent, borderColor: `${spec.accent}55` }}>
          <span className="nbar__chip-dot" aria-hidden="true" />
          {item.kicker || spec.label[language] || spec.label.en}
        </span>
        <span className="nbar__time">{clockOf(item.at, lang)}</span>
        {preview ? null : (
          <button
            type="button"
            className="nbar__close"
            aria-label={closeLabel}
            onClick={(e) => {
              e.stopPropagation();
              onClose(item.id);
            }}
          >
            ×
          </button>
        )}
      </span>

      <span className="nbar__body">
        <span className="nbar__text">
          <span className="nbar__title">{item.title}</span>
          {item.body ? <span className="nbar__message">{item.body}</span> : null}
          {item.label ? <span className="nbar__label" dir="auto">{item.label}</span> : null}
        </span>
        {item.value ? (
          <span className="nbar__value" dir="ltr" style={{ color: spec.accent }}>
            {item.value}
          </span>
        ) : null}
      </span>

      {item.progress != null ? <ProgressRail value={item.progress} color={spec.accent} reduced={reduced} lang={lang} /> : null}
    </motion.div>
  );
}

/**
 * FALLBACK DEEP LINK, for the case this component has no Router above it.
 *
 * The app is a HashRouter, so assigning the hash IS a navigation and the router
 * hears it as `hashchange`. This exists only as the degraded path: it is the
 * SECOND time this component's router dependency has been able to hurt the app
 * (see the note in App.jsx — a placement outside `<HashRouter>` made
 * `useNavigate()` throw on every route and blanked the whole site), so a missing
 * Router must degrade to "the card opens the page" instead of an exception.
 */
function setHashRoute(link) {
  const path = String(link || '');
  /* Only in-app paths. A payload can never make this navigate to a URL. */
  if (!path.startsWith('/')) return;
  try {
    window.location.hash = `#${path}`;
  } catch {
    /* a navigation that fails leaves the user on the current page, which is
       exactly where they were; never throw out of a dismiss */
  }
}

/**
 * The bar can never take the app down with it.
 *
 * This is an OPTIONAL overlay: it renders the notification design, it owns no
 * data and no route. If it ever throws, the correct outcome is "no card this
 * time", never the global «خطای غیرمنتظره» screen — which is exactly what
 * happened when it was mounted outside the router. `BootBoundary` (main.jsx)
 * remains the last resort; this keeps the bar from reaching it.
 */
class BarBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    /* Written to the console rather than swallowed silently, so the defect is
       still visible to whoever is debugging on a phone. */
    try {
      console.error('[notif-bar]', error);
    } catch { /* nothing to do */ }
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

/** Shared body: the store, the language and the stacking. Presentation only. */
function BarView({ onOpen }) {
  const items = useAppStore((s) => s.notifBar || []);
  const dismiss = useAppStore((s) => s.dismissNotifBar);
  const [lang, setLang] = useState(() => (typeof document !== 'undefined' ? document.documentElement.lang : 'fa'));

  /* The shade follows the app's language, and the app can change it live. */
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const el = document.documentElement;
    const sync = () => setLang(el.lang || 'fa');
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ['lang'] });
    return () => obs.disconnect();
  }, []);

  const close = useCallback((id) => dismiss(id), [dismiss]);

  /* A card is consumed by opening it: it leaves the bar first, then the route
     changes. Doing it in this order means a rejected navigation can never
     leave a card the user has already acted on. */
  const open = useCallback(
    (item) => {
      dismiss(item.id);
      onOpen(item);
    },
    [dismiss, onOpen]
  );

  /*
   * The bar is inset for the status bar / Dynamic Island itself. The OS owns
   * that region; we only make sure a card can never slide UNDER the clock and
   * battery, which is the "island bar" the owner described.
   */
  return (
    <div className="nbar" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {items.slice(0, 3).map((item) => (
          <Card key={item.id} item={item} lang={lang} onClose={close} onOpen={open} />
        ))}
      </AnimatePresence>
    </div>
  );
}

/** The normal path: inside a Router, deep links go through React Router. */
function RoutedBar() {
  const navigate = useNavigate();
  const open = useCallback(
    (item) => {
      /* `link` is an in-app route produced by the alert builders, or by the
         inbox mirror in lib/notify.js (which already refused anything that is
         not a same-origin app path). Never a raw URL from a payload. */
      if (item.link) navigate(item.link);
    },
    [navigate]
  );
  return <BarView onOpen={open} />;
}

/** The degraded path: no Router above us — navigate by hash, never throw. */
function HashBar() {
  const open = useCallback((item) => setHashRoute(item.link), []);
  return <BarView onOpen={open} />;
}

export default function NotificationBar() {
  /*
   * `useInRouterContext` is a plain boolean and does NOT throw, so this is the
   * one router-aware call that is safe unconditionally. The component that
   * actually calls `useNavigate()` is only mounted when a Router exists —
   * hooks stay unconditional per component, which is what the rules require.
   */
  const inRouter = useInRouterContext();
  return <BarBoundary>{inRouter ? <RoutedBar /> : <HashBar />}</BarBoundary>;
}

/* Exposed for the Settings preview and for the design probe: the tone list the
   bar can render, straight from the design system. */
export const BAR_TONES = Object.keys(TONES);

/* -------------------------------------------------------------------------- */
/* the Settings preview                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A NON-INTERACTIVE card, with the copy a real alert of that tone carries.
 *
 * «نوتیفیکیشن‌هایی که در صفحهٔ تنظیمات می‌آید باید روی گوشی هم بیاید با صدا.»
 * The Settings screen needs to SHOW the design before the user has granted
 * permission — that is the honest way to ask for it — and showing it with a
 * second, hand-built markup would be the fifth source of truth this whole
 * exercise exists to remove. So the preview is the SAME `Card`, drained of its
 * timers, drag and close button.
 */
const SAMPLE = {
  fa: {
    profit: ['به هدف رسید — سود', 'BTC→USDT با سود بسته شد.', '+12.4%'],
    loss: ['حد ضرر فعال شد', 'ETH→USDT با ضرر بسته شد.', '-3.75%'],
    pending: ['سفارش خودکار در انتظار', 'BTC→USDT ثبت شد.', '65,240'],
    ready: ['آمادهٔ سواپ', 'اتوماسیون شما به نتیجه رسید.', '68%'],
    alert: ['هشدار امنیتی', 'یک درخواست امضا در انتظار تأیید است.', '!'],
    info: ['خلاصهٔ روزانهٔ FBT', 'بازار امروز را ببین.', '']
  },
  en: {
    profit: ['Target reached — in profit', 'BTC→USDT closed in profit.', '+12.4%'],
    loss: ['Stop-loss triggered', 'ETH→USDT closed at a loss.', '-3.75%'],
    pending: ['Automation pending', 'BTC→USDT is set.', '65,240'],
    ready: ['Ready to swap', 'Your automation reached its result.', '68%'],
    alert: ['Security alert', 'A signing request is waiting.', '!'],
    info: ['FBT daily digest', 'See today’s market at a glance.', '']
  }
};

export function NotificationPreview({ tone = 'ready', lang }) {
  const key = normalizeTone(tone);
  const language = String(lang || 'fa').split('-')[0];
  const pack = SAMPLE[language] || SAMPLE.en;
  const [title, body, value] = pack[key] || pack.ready;
  const spec = toneSpec(key);
  const item = {
    id: `preview-${key}`,
    title,
    body,
    value,
    label: key === 'loss' ? 'ETH > USDT' : ['info', 'alert'].includes(key) ? '' : 'BTC > USDT',
    kicker: spec.label[language] || spec.label.en,
    progress: ['info', 'alert'].includes(key) ? null : key === 'pending' ? 25 : 68,
    tone: key,
    at: Date.now(),
    persist: true
  };
  return (
    <div className="nbar nbar--inline">
      <Card item={item} lang={lang} preview />
    </div>
  );
}
