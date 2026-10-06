/**
 * FBT WORLD CONSOLE — calibration («محک»).
 * ---------------------------------------------------------------------------
 * REPORTED (2026-10): «ایستگاه‌های آب‌وهوای مالی داده معتبر ندارد و باید با محک
 * درست کالیبره شود».
 *
 * The stations used to colour themselves with thresholds nobody could defend:
 * a dollar move of 0.7% was «windy», an oil move of 1.2% was «storm», and the
 * dial was `|move| / 1.5` or `/ 3` — a different invented denominator per
 * station. A reader could not tell whether «+0.6%» was a quiet day or a violent
 * one, because the screen never said what a normal day looks like.
 *
 * The benchmark is now explicit: every market station is read against the
 * TYPICAL DAILY MOVE of that market (one standard deviation of its daily
 * change, rounded) and says how many of those the day produced:
 *
 *     z = move ÷ σ        |z| < 0.5 calm · < 1.5 normal · < 2.5 strong · ≥ 2.5 extreme
 *
 * «+0.9% on gold» is therefore «۱٫۰ برابر نوسان معمول — معمولی», and «+0.9% on
 * the dollar» is «۲٫۰ برابر — قوی». The weather word, the dial and the sentence
 * all come from the same z, so they can no longer disagree.
 *
 * HONESTY: the σ values are MODEL CONSTANTS — long-run typical daily moves, not
 * a measurement of today — and the board prints them in its legend as exactly
 * that. A station whose move was not read has no z, no tone and an empty dial.
 */

export const BENCH = Object.freeze({
  dollar: Object.freeze({ sigma: 0.45, unit: 'pct', fa: 'شاخص دلار', en: 'dollar index' }),
  gold: Object.freeze({ sigma: 0.9, unit: 'pct', fa: 'طلا', en: 'gold' }),
  oil: Object.freeze({ sigma: 2.1, unit: 'pct', fa: 'نفت', en: 'crude oil' }),
  /* a daily move of the 10-year yield is quoted in basis points; ±6bp is a normal day */
  bonds: Object.freeze({ sigma: 6, unit: 'bp', fa: 'بازده ۱۰ ساله', en: '10-year yield' }),
  equity: Object.freeze({ sigma: 1.0, unit: 'pct', fa: 'شاخص سهام', en: 'equity index' }),
  crypto: Object.freeze({ sigma: 2.8, unit: 'pct', fa: 'رمزارز', en: 'crypto' }),
  btc: Object.freeze({ sigma: 2.8, unit: 'pct', fa: 'بیت‌کوین', en: 'bitcoin' }),
  eth: Object.freeze({ sigma: 3.5, unit: 'pct', fa: 'اتریوم', en: 'ether' }),
  rwa: Object.freeze({ sigma: 0.9, unit: 'pct', fa: 'دارایی‌های واقعی', en: 'real-world assets' })
});

/** stablecoin supply: a ±$300M day is a strong one (used for the dial only) */
export const LIQUIDITY_SCALE_USD = 300_000_000;

export const zOf = (move, sigma) => (
  move === null || move === undefined || !Number.isFinite(Number(move)) || !(sigma > 0) ? null : Number(move) / sigma
);

export function bandOf(z) {
  if (z === null || z === undefined) return null;
  const a = Math.abs(z);
  return a < 0.5 ? 'calm' : a < 1.5 ? 'normal' : a < 2.5 ? 'strong' : 'extreme';
}

export const BAND_WORD = Object.freeze({
  calm: { fa: 'آرام', en: 'calm' },
  normal: { fa: 'معمولی', en: 'normal' },
  strong: { fa: 'قوی', en: 'strong' },
  extreme: { fa: 'حدی', en: 'extreme' }
});

/**
 * Weather tone for a z-score. `kind` says which side hurts:
 *   headwind-up  a RISE is the headwind (dollar, oil, bond yields)
 *   tailwind-up  a RISE is the tailwind (equities, crypto)
 *   haven        a rise is a fear bid (gold)
 */
export function toneFor(kind, z) {
  if (z === null || z === undefined) return 'na';
  const a = Math.abs(z);
  const up = z > 0;
  const rungs = (v) => (v < 0.5 ? 'partly' : v < 1.5 ? 'cloud' : v < 2.5 ? 'rain' : 'storm');
  if (kind === 'tailwind-up') return up ? (a < 0.5 ? 'partly' : 'sun') : rungs(a);
  if (kind === 'headwind-up') return up ? rungs(a) : (a >= 2.5 ? 'windy' : a < 0.5 ? 'partly' : 'sun');
  /* haven */
  return up ? (a < 0.5 ? 'partly' : a < 1.5 ? 'partly' : a < 2.5 ? 'cloud' : 'rain') : (a >= 2.5 ? 'windy' : a < 0.5 ? 'partly' : 'sun');
}

/** the dial: 0 → 1 over three sigmas, never fully empty once a move was read */
export const severityFor = (z) => (z === null || z === undefined ? null : Math.min(1, Math.max(0.08, Math.abs(z) / 3)));

/** weekday-safe classification of the 12 station slots, for the board summary */
export function summariseStations(stations) {
  const out = { total: stations.length, valid: 0, measured: 0, proxy: 0, level: 0, stale: 0, unread: 0 };
  for (const s of stations) {
    if (s.tone === 'na' || (!s.valueText && !s.valueTextFa)) { out.unread += 1; continue; }
    const q = s.quality || 'measured';
    if (q === 'level') { out.level += 1; continue; }
    out.valid += 1;
    if (q === 'proxy') out.proxy += 1;
    else if (q === 'stale') out.stale += 1;
    else out.measured += 1;
  }
  return out;
}

/** how a number reached the screen — printed as a badge next to the value */
export const QUALITY_META = Object.freeze({
  measured: { fa: 'خوانش مستقیم', en: 'direct read' },
  proxy: { fa: 'پروکسی', en: 'proxy' },
  level: { fa: 'فقط سطح', en: 'level only' },
  stale: { fa: 'آخرین خوانش', en: 'last good read' }
});
