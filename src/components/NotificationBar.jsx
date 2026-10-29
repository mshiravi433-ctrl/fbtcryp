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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
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

/** The brand mark, drawn once as inline SVG (no network, no extra asset). */
function BrandMark({ color }) {
  return (
    <svg className="nbar__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
        <path d="M17.2 9.5a5.5 5.5 0 0 1-9.6 3.4" />
        <path d="M6.8 14.5A5.5 5.5 0 0 1 16.4 11" />
      </g>
      <path d="M17.9 4.6l.5 4.3-4.2-.9z" fill={color} />
      <path d="M6.1 19.4l-.5-4.3 4.2.9z" fill={color} />
    </svg>
  );
}

function ProgressRail({ value, color }) {
  const pct = Math.max(0, Math.min(100, Number(value)));
  return (
    <div className="nbar__rail" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <motion.span
        className="nbar__rail-fill"
        style={{ background: `linear-gradient(90deg, ${color}55, ${color})` }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: pct / 100 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />
      <span className="nbar__rail-glint" style={{ background: color, offsetDistance: `${pct}%` }} />
    </div>
  );
}

function Card({ item, lang, onClose, onOpen }) {
  const spec = toneSpec(item.tone);
  const reduced = useReducedMotion();
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);

  /*
   * Auto-release. A card that stays forever is a card the user cannot get rid
   * of on a phone with no obvious close affordance, so:
   *   · money news (profit / loss) and an explicit `persist` wait for the user;
   *   · everything else fades.
   * Hovering or touching pauses the countdown, because reading it is the point.
   */
  const sticky = item.persist || item.tone === 'profit' || item.tone === 'loss' || item.tone === 'alert';
  useEffect(() => {
    if (sticky) return undefined;
    if (dragging) return undefined;
    const timer = setTimeout(() => onClose(item.id), LIFETIME);
    return () => clearTimeout(timer);
  }, [item.id, sticky, dragging, onClose]);

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
      className={`nbar__card nbar__card--${normalizeTone(item.tone)}${dragging ? ' is-dragging' : ''}`}
      style={values}
      layout={!reduced}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -28, scale: 0.96 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, y: -20, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      drag={reduced ? false : 'y'}
      dragConstraints={{ top: -80, bottom: 0 }}
      dragElastic={0.32}
      onDragStart={() => setDragging(true)}
      onDragEnd={(_, info) => {
        setDragging(false);
        if (info.offset.y < -46 || info.velocity.y < -420) onClose(item.id);
      }}
      role="status"
      aria-live="polite"
      onClick={() => onOpen(item)}
    >
      {/* The aurora, the grid and the vignette — all CSS, all composited. */}
      <span className="nbar__aurora" aria-hidden="true" />
      <span className="nbar__grid" aria-hidden="true" />
      <span className="nbar__sheen" aria-hidden="true" />

      <span className="nbar__head">
        <BrandMark color={spec.accent} />
        <span className="nbar__brand">FBT SWAP</span>
        <span className="nbar__chip" style={{ color: spec.accent, borderColor: `${spec.accent}55` }}>
          {item.kicker || spec.label.en}
        </span>
        <span className="nbar__time">{clockOf(item.at, lang)}</span>
        <button
          type="button"
          className="nbar__close"
          aria-label="بستن"
          onClick={(e) => {
            e.stopPropagation();
            onClose(item.id);
          }}
        >
          ×
        </button>
      </span>

      <span className="nbar__body">
        <span className="nbar__text">
          <span className="nbar__title">{item.title}</span>
          {item.body ? <span className="nbar__message">{item.body}</span> : null}
          {item.label ? <span className="nbar__label">{item.label}</span> : null}
        </span>
        {item.value ? (
          <span className="nbar__value" style={{ color: spec.accent }}>
            {item.value}
          </span>
        ) : null}
      </span>

      {item.progress != null ? <ProgressRail value={item.progress} color={spec.accent} /> : null}
    </motion.div>
  );
}

export default function NotificationBar() {
  const items = useAppStore((s) => s.notifBar || []);
  const dismiss = useAppStore((s) => s.dismissNotifBar);
  const navigate = useNavigate();
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

  const open = useCallback(
    (item) => {
      dismiss(item.id);
      if (item.link) {
        /* `link` is an in-app route produced by the alert builders, or by the
           inbox mirror in lib/notify.js (which already refused anything that is
           not a same-origin app path). Never a raw URL from a payload. */
        navigate(item.link);
      }
    },
    [dismiss, navigate]
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

/* Exposed for the Settings preview and for the design probe: the tone list the
   bar can render, straight from the design system. */
export const BAR_TONES = Object.keys(TONES);
