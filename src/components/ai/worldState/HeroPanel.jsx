/**
 * THE HERO — «هوش جهانی».
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10): «بنر بالا خیلی مدرن‌تر و با انیمیشن باشد؛ فقط بنویس
 * هوش جهانی — بدون FBT».
 *
 * An orbital instrument drawn in inline SVG: a globe with meridians, three
 * dashed rings carrying satellites in opposite directions, a radar sweep and
 * a few twinkling points. Beside it, the title, one honest sentence, the
 * nine-segment domain meter (the SAME per-domain statuses the domains tab
 * prints) and four live KPIs taken from this pass — climate index, valid
 * stations, live domains, countries read.
 *
 * MOTION: transform and opacity only, every loop is slow, and everything is
 * switched off under prefers-reduced-motion (see ui.styles.js).
 *
 * 2026-10-07 — REPORTED: «آیکون کره پایین بنر است، برود بالا و سمت چپ؛ دکمهٔ
 * به‌روزرسانی داده‌های زنده را محو کن و وقتی روی کره می‌زنم به‌روزرسانی انجام
 * شود». So the instrument moved to the TOP-LEFT corner of the banner (see the
 * direction-aware grid in ui.styles.js — "physically left" is the LAST column
 * in RTL and the FIRST in LTR), the wide «refresh live data» bar under the tab
 * rail is gone, and the globe itself is now that button: it is a real
 * <button>, it is labelled for screen readers, and while a read is in flight
 * its rings spin faster instead of the bar showing a spinner.
 */
import { faNum } from './format.jsx';
import { TONE_WORD } from './worldModel.js';

function OrbitalGlobe() {
  const O = { transformOrigin: '110px 110px' };
  return (
    <svg className="gw-orbital" viewBox="0 0 220 220" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="gwGlobe" cx="38%" cy="32%" r="75%">
          <stop offset="0" stopColor="#7dd3fc" stopOpacity=".95" />
          <stop offset=".55" stopColor="#6366f1" stopOpacity=".75" />
          <stop offset="1" stopColor="#1e1b4b" stopOpacity=".9" />
        </radialGradient>
        <linearGradient id="gwSweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity=".55" />
        </linearGradient>
        <linearGradient id="gwRing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>

      {/* a soft pulse behind the globe */}
      <circle className="gw-pulse" cx="110" cy="110" r="62" fill="url(#gwRing)" opacity=".16" style={O} />

      {/* the radar sweep */}
      <g className="gw-sweep" style={O}>
        <path d="M110 110 L110 14 A96 96 0 0 1 178 42 Z" fill="url(#gwSweep)" />
      </g>

      {/* rings */}
      <circle cx="110" cy="110" r="98" stroke="url(#gwRing)" strokeOpacity=".28" strokeWidth="1" strokeDasharray="2 7" />
      <circle cx="110" cy="110" r="80" stroke="url(#gwRing)" strokeOpacity=".4" strokeWidth="1" strokeDasharray="1 5" />
      <circle cx="110" cy="110" r="63" stroke="url(#gwRing)" strokeOpacity=".5" strokeWidth="1" />

      {/* satellites on counter-rotating orbits */}
      <g className="gw-spin s1" style={O}>
        <circle cx="110" cy="12" r="4.2" fill="#22d3ee" />
        <circle cx="110" cy="12" r="8" fill="#22d3ee" opacity=".18" />
      </g>
      <g className="gw-spin s2" style={O}>
        <circle cx="30" cy="110" r="3.4" fill="#a78bfa" />
        <circle cx="190" cy="110" r="2.6" fill="#34d399" />
      </g>
      <g className="gw-spin s3" style={O}>
        <circle cx="110" cy="47" r="3" fill="#fbbf24" />
      </g>

      {/* the globe */}
      <circle cx="110" cy="110" r="44" fill="url(#gwGlobe)" />
      <g stroke="#e0f2fe" strokeOpacity=".55" strokeWidth="1" fill="none">
        <ellipse cx="110" cy="110" rx="44" ry="44" strokeOpacity=".7" />
        <ellipse cx="110" cy="110" rx="18" ry="44" />
        <ellipse cx="110" cy="110" rx="32" ry="44" strokeOpacity=".35" />
        <path d="M66 110h88" />
        <path d="M72 90h76" strokeOpacity=".4" />
        <path d="M72 130h76" strokeOpacity=".4" />
      </g>
      <g className="gw-land" style={O}>
        <circle cx="96" cy="98" r="2.2" fill="#e0f2fe" opacity=".85" />
        <circle cx="102" cy="104" r="1.6" fill="#e0f2fe" opacity=".7" />
        <circle cx="124" cy="94" r="2" fill="#e0f2fe" opacity=".8" />
        <circle cx="130" cy="118" r="2.4" fill="#e0f2fe" opacity=".75" />
        <circle cx="112" cy="126" r="1.6" fill="#e0f2fe" opacity=".7" />
      </g>

      {/* twinkles */}
      <circle className="gw-tw t1" cx="26" cy="46" r="1.4" fill="#fff" />
      <circle className="gw-tw t2" cx="188" cy="62" r="1.2" fill="#fff" />
      <circle className="gw-tw t3" cx="166" cy="184" r="1.5" fill="#fff" />
      <circle className="gw-tw t1" cx="48" cy="176" r="1.1" fill="#fff" />
    </svg>
  );
}

export function HeroPanel({ L, isPersian, working, available, meterCells, meterClass, board, updatedLabel, onRefresh }) {
  const climate = board?.climate || null;
  const summary = board?.summary || null;
  const countries = board?.countries || null;
  const toneWord = climate?.label ? (isPersian ? TONE_WORD[climate.label]?.fa : TONE_WORD[climate.label]?.en) : null;
  const n = (v) => (isPersian ? faNum(v) : String(v));

  const kpis = [
    {
      key: 'climate', tone: climate?.label || 'na',
      value: climate && climate.index !== null && climate.index !== undefined ? n(climate.index) : '—',
      label: toneWord ? `${L('اقلیم مالی', 'climate')} · ${toneWord}` : L('اقلیم مالی', 'climate')
    },
    {
      key: 'stations', tone: summary && summary.valid >= summary.total * 0.7 ? 'sun' : summary && summary.valid > 0 ? 'partly' : 'na',
      value: summary ? `${n(summary.valid)}/${n(summary.total)}` : '—', label: L('ایستگاه معتبر', 'valid stations')
    },
    {
      key: 'domains', tone: available >= 7 ? 'sun' : available >= 4 ? 'partly' : 'rain',
      value: available === null || available === undefined ? '—' : `${n(available)}/${n(9)}`, label: L('حوزهٔ زنده', 'live domains')
    },
    {
      key: 'countries', tone: countries && countries.read >= countries.total * 0.7 ? 'sun' : 'partly',
      value: countries ? `${n(countries.read)}/${n(countries.total)}` : '—', label: L('کشور خوانده‌شده', 'countries read')
    }
  ];

  /* the globe IS the refresh control — its accessible name says what a tap does */
  const refreshLabel = working
    ? L('در حال به‌روزرسانی داده‌های زنده…', 'Reading live data…')
    : L('به‌روزرسانی داده‌های زنده', 'Refresh live data');

  return (
    <header className={`gw-hero ${working ? 'is-working' : ''}`}>
      <div className="gw-hero-glow g1" aria-hidden="true" />
      <div className="gw-hero-glow g2" aria-hidden="true" />

      {/* TOP-LEFT of the banner, and a <button>: tapping the globe re-reads
          every domain (`load(true)` in AiGlobalIntelligence). Disabled while a
          read is in flight — the same guard the retired bar had. */}
      <button
        type="button"
        className={`gw-hero-art gw-hero-refresh ${working ? 'is-refreshing' : ''}`}
        onClick={onRefresh}
        disabled={!onRefresh || working}
        aria-label={refreshLabel}
        title={refreshLabel}
      >
        <OrbitalGlobe />
        <span className="gw-hero-refresh-hint" aria-hidden="true">
          {working ? L('در حال خواندن…', 'reading…') : L('به‌روزرسانی', 'refresh')}
        </span>
      </button>

      <div className="gw-hero-copy">
        <span className="gw-eyebrow">
          <i className="gw-live" aria-hidden="true" />
          {working ? L('در حال خواندن…', 'reading…') : L('زنده', 'live')}
          {updatedLabel ? <small>{updatedLabel}</small> : null}
        </span>
        <h1 className="aig-title gw-hero-title"><span>{L('هوش جهانی', 'Global Intelligence')}</span></h1>
        <p className="aig-sub gw-hero-sub">
          {L(
            'نه حوزهٔ داده، یک مغز: هر عددی که می‌بینی از یک خواندن واقعی آمده و اگر نیامده باشد، «خوانده نشد» می‌خوانی.',
            'Nine data domains, one brain — every figure came from a real read; when it did not, you read «unread».'
          )}
        </p>

        {/* The meter reads the SAME per-domain statuses the domains tab prints
            (`d.status`), so the picture at the top and the nine rows can never
            disagree. */}
        <div className="aig-meter gw-meter" role="img" aria-label={`${available ?? 0}/9 ${L('حوزهٔ زنده', 'domains live')}`}>
          {meterCells.map((status, i) => <i key={i} className={meterClass(status)} />)}
        </div>

        <div className="gw-kpis">
          {kpis.map((k) => (
            <div key={k.key} className={`gw-kpi t-${k.tone}`}>
              <b className="aigw-ltr">{k.value}</b>
              <span>{k.label}</span>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}

export default HeroPanel;
