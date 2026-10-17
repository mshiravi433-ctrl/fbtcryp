import { useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useFbtRadioStore } from '../store/useFbtRadioStore';
import { autoplayOnce, play, pause, seek, skip, toggleMute, cycleRate } from '../lib/fbtRadioEngine';
import '../styles/fbt-radio.css';

/**
 * FBT LIVE RADIO — the box on News → Radio.
 * ---------------------------------------------------------------------------
 * ─── WHAT WAS ASKED FOR ─────────────────────────────────────────────────────
 *   «در صفحه اخبار، تب رادیو یک باکس خیلی مدرن ایجاد کن و رادیو پخش خودکار
 *    باشد و مدرن باشد خیلی و تنها در زبان فارسی بیاد»
 *
 * So: one box, Persian only, autoplaying, and it has to look designed rather
 * than assembled. This is the 2-hour broadcast built for FBT — 42 chapters,
 * eight original music beds, the interview block and the whale radar — not a
 * podcast list.
 *
 * ─── WHY IT IS GATED ON THE LANGUAGE ────────────────────────────────────────
 * The programme is recorded in Persian. Showing a Persian-only audio box to a
 * reader whose interface is English, Arabic or Russian is a dead control: the
 * player works, the content is unintelligible, and nothing on screen explains
 * why. `started` is checked so the gate never tears down playback that is
 * already running (it would not, but a remount while playing is a bad time to
 * find out) — see `useEffect` below.
 *
 * ─── THE PLAY BUTTON IS REAL ────────────────────────────────────────────────
 * Autoplay is attempted on mount. If the browser refuses (cold load without a
 * gesture) the cover shows a labelled start button instead of an equaliser
 * animating over silence. A control that lies about what it is doing is worse
 * than a control that asks.
 */
const CHAPTERS = [
  { t: 9, label: 'معرفی رادیو FBT' },
  { t: 637.08, label: 'کریپتو چیست؟' },
  { t: 690.56, label: 'بیت‌کوین، پادشاه بازار' },
  { t: 740.36, label: 'اتریوم و آلت‌کوین‌ها' },
  { t: 1120.42, label: 'مصاحبه ویژه' },
  { t: 1223.98, label: 'رادار نهنگ‌ها' },
  { t: 2080.05, label: 'اخبار داغ کریپتو' },
  { t: 2132.05, label: 'آینده کریپتو' },
  { t: 2470.53, label: 'استیبل‌کوین و دیفای' },
  { t: 2528.17, label: 'ان‌اف‌تی و متاورس' },
  { t: 2584.85, label: 'آموزش ترید' },
  { t: 2640.17, label: 'امنیت کیف پول' }
];

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const faNum = (value) =>
  String(value).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

/** 3725 → «۱:۰۲:۰۵» — hours only when there is one. */
export function faClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => faNum(String(n).padStart(2, '0'));
  return h > 0 ? `${faNum(h)}:${pad(m)}:${pad(r)}` : `${faNum(m)}:${pad(r)}`;
}

const BARS = Array.from({ length: 16 });

export default function FbtRadioBox() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();

  const isFa = String(i18n.language || 'fa').toLowerCase().startsWith('fa');

  const playing = useFbtRadioStore((s) => s.playing);
  const started = useFbtRadioStore((s) => s.started);
  const blocked = useFbtRadioStore((s) => s.blocked);
  const error = useFbtRadioStore((s) => s.error);
  const time = useFbtRadioStore((s) => s.time);
  const duration = useFbtRadioStore((s) => s.duration);
  const buffered = useFbtRadioStore((s) => s.buffered);
  const muted = useFbtRadioStore((s) => s.muted);
  const rate = useFbtRadioStore((s) => s.rate);

  const barRef = useRef(null);

  /* Autoplay on arrival at the tab. Guarded on `isFa` so the station does not
     start making noise for a reader who cannot see the box it belongs to. */
  useEffect(() => {
    if (!isFa) return undefined;
    const id = window.setTimeout(() => autoplayOnce(), 240);
    return () => window.clearTimeout(id);
  }, [isFa]);

  const activeChapter = useMemo(() => {
    let idx = -1;
    CHAPTERS.forEach((c, i) => {
      if (time >= c.t) idx = i;
    });
    return idx;
  }, [time]);

  if (!isFa) return null;

  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;

  const onScrub = (event) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    /* The card is RTL, the rail is LTR: compute against the rail itself. */
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    seek(ratio * (duration || 7200));
  };

  return (
    <motion.section
      className={`fbr ${playing ? 'is-live' : ''} ${blocked && !started ? 'is-armed' : ''}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      dir="rtl"
      aria-label="رادیو زنده اف‌بی‌تی"
    >
      {/* Decorative light. Purely presentational, hidden from AT. */}
      <span className="fbr-aurora" aria-hidden="true" />
      <span className="fbr-grain" aria-hidden="true" />

      <header className="fbr-head">
        <span className="fbr-live">
          <i aria-hidden="true" />
          پخش زنده
        </span>
        <span className="fbr-brand">FBT RADIO</span>
        <button
          type="button"
          className="fbr-link"
          onClick={() => navigate('/news?tab=read')}
          title="بازگشت به تیترها"
        >
          تیترها
        </button>
      </header>

      <div className="fbr-main">
        <div className="fbr-art" aria-hidden="true">
          <img src="/radio/fbt-radio-cover.jpg" alt="" loading="lazy" />
          <span className="fbr-art-ring" />
          {!started && !error && (
            <button
              type="button"
              className="fbr-start"
              onClick={() => play()}
              aria-label="شروع پخش رادیو"
            >
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                <path d="M8 5.2v13.6a1 1 0 0 0 1.53.85l10.2-6.8a1 1 0 0 0 0-1.7L9.53 4.35A1 1 0 0 0 8 5.2Z" />
              </svg>
            </button>
          )}
        </div>

        <div className="fbr-body">
          <p className="fbr-kicker">برنامه دو ساعته · دنیای کریپتو</p>
          <h2 className="fbr-title">
            رادیو <b>اف‌بی‌تی</b>
            <span className="fbr-wave" aria-hidden="true">
              {BARS.map((_, i) => (
                <i key={i} style={{ animationDelay: `${(i % 8) * -0.12}s` }} />
              ))}
            </span>
          </h2>
          <p className="fbr-sub">
            {error
              ? 'ارتباط با استودیو برقرار نشد؛ اتصال اینترنت را بررسی کن.'
              : playing
                ? activeChapter >= 0
                  ? CHAPTERS[activeChapter].label
                  : 'در حال پخش…'
                : blocked && !started
                  ? 'برای شروع، دکمهٔ پخش را لمس کن'
                  : 'آمادهٔ پخش — خودکار شروع می‌شود'}
          </p>

          <div className="fbr-chips">
            <span className="fbr-chip">۲ ساعت پیوسته</span>
            <span className="fbr-chip">۴۲ فصل</span>
            <span className="fbr-chip">۸ ترک اختصاصی</span>
            <span className="fbr-chip fbr-chip-whale">🐋 رادار نهنگ‌ها</span>
          </div>
        </div>
      </div>

      <div className="fbr-rail-wrap">
        <div
          className="fbr-rail"
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label="زمان پخش"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={faClock(time)}
          onClick={onScrub}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') skip(-15);
            if (e.key === 'ArrowRight') skip(15);
          }}
        >
          <span className="fbr-rail-buf" style={{ width: `${bufPct}%` }} />
          <span className="fbr-rail-fill" style={{ width: `${pct}%` }} />
          <span className="fbr-rail-knob" style={{ left: `${pct}%` }} />
          {CHAPTERS.map((c) => (
            <span
              key={c.t}
              className="fbr-rail-tick"
              style={{ left: `${(c.t / (duration || 7200)) * 100}%` }}
            />
          ))}
        </div>
        <div className="fbr-times">
          <span>{faClock(time)}</span>
          <span className="fbr-remain">−{faClock((duration || 7200) - time)}</span>
          <span>{faClock(duration || 7200)}</span>
        </div>
      </div>

      <div className="fbr-controls">
        <button type="button" className="fbr-ctl" onClick={() => skip(-30)} aria-label="۳۰ ثانیه عقب">
          <span className="fbr-ctl-g">↺</span>
          <small>۳۰</small>
        </button>

        <button
          type="button"
          className="fbr-play"
          onClick={() => (playing ? pause() : play())}
          aria-label={playing ? 'توقف پخش' : 'پخش رادیو'}
          aria-pressed={playing}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
              <rect x="6" y="4.5" width="4.2" height="15" rx="1.6" />
              <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
              <path d="M8 5.2v13.6a1 1 0 0 0 1.53.85l10.2-6.8a1 1 0 0 0 0-1.7L9.53 4.35A1 1 0 0 0 8 5.2Z" />
            </svg>
          )}
        </button>

        <button type="button" className="fbr-ctl" onClick={() => skip(30)} aria-label="۳۰ ثانیه جلو">
          <span className="fbr-ctl-g">↻</span>
          <small>۳۰</small>
        </button>

        <button
          type="button"
          className="fbr-ctl"
          onClick={toggleMute}
          aria-label={muted ? 'وصل صدا' : 'قطع صدا'}
          aria-pressed={muted}
        >
          {muted ? '🔇' : '🔊'}
        </button>

        <button
          type="button"
          className="fbr-ctl fbr-rate"
          onClick={cycleRate}
          aria-label={`سرعت پخش ${faNum(rate)} برابر`}
        >
          ×{faNum(rate)}
        </button>

        <a className="fbr-ctl fbr-dl" href="/radio/fbt-radio-2h.mp3" download aria-label="دانلود فایل رادیو">
          ⤓
        </a>
      </div>

      <div className="fbr-chapters" role="list" aria-label="فصل‌های برنامه">
        {CHAPTERS.map((c, i) => (
          <button
            type="button"
            role="listitem"
            key={c.t}
            className={`fbr-ch ${i === activeChapter && started ? 'is-on' : ''}`}
            onClick={() => {
              seek(c.t);
              if (!playing) play();
            }}
            title={c.label}
          >
            <span className="fbr-ch-time">{faClock(c.t)}</span>
            <span className="fbr-ch-label">{c.label}</span>
          </button>
        ))}
      </div>

      <p className="fbr-note">
        موسیقی و صداها اختصاصی رادیو اف‌بی‌تی است · برنامه آموزشی است و توصیهٔ مالی نیست.
      </p>
    </motion.section>
  );
}
