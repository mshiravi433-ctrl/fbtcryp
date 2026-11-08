/**
 * OPPORTUNITY UI PRIMITIVES
 * ---------------------------------------------------------------------------
 * Small, dependency-light pieces shared by the engine room and the deep-analysis
 * page: formatters, the category glyph, the score dial and the empty/unknown
 * block. Kept in one file so the two screens can never format the same number
 * two different ways.
 */
import {
  IconPools, IconBank, IconTrend, IconSparkle,
  IconBuilding, IconSmartMoney, IconChevronRight, IconExternal, IconAlertTriangle
} from '../Icons.jsx';

/* ─── formatters ─────────────────────────────────────────────────────────── */

export const isFa = (locale) => String(locale || '').toLowerCase().startsWith('fa');

/** $1,240 · $12.4K · $3.1M — compact money, never a fake precision. */
export function money(value, { dash = '—' } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dash;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs >= 0.01) return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: abs < 1 ? 2 : 0 })}`;
  if (abs > 0) return `${sign}$${abs.toPrecision(2)}`;
  return '$0';
}

/** 12.4% · -3.1% — the sign is explicit where it matters. */
export function pct(value, { digits = 1, dash = '—', signed = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dash;
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

export function num(value, { digits = 0, dash = '—' } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dash;
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** «۴ ساعت» / «4h» — remaining validity, coarse on purpose. */
export function remaining(expiresAt, locale, now = Date.now()) {
  const at = Number(expiresAt);
  if (!Number.isFinite(at)) return null;
  const ms = at - now;
  if (ms <= 0) return isFa(locale) ? 'منقضی' : 'expired';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return isFa(locale) ? `${mins} دقیقه` : `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return isFa(locale) ? `${hours} ساعت` : `${hours}h`;
  return isFa(locale) ? `${Math.round(hours / 24)} روز` : `${Math.round(hours / 24)}d`;
}

export function timeAgo(ts, locale, now = Date.now()) {
  const at = Number(ts);
  if (!Number.isFinite(at) || at <= 0) return '—';
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 60) return isFa(locale) ? 'همین حالا' : 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return isFa(locale) ? `${mins} دقیقه پیش` : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return isFa(locale) ? `${hours} ساعت پیش` : `${hours}h ago`;
  return isFa(locale) ? `${Math.round(hours / 24)} روز پیش` : `${Math.round(hours / 24)}d ago`;
}

/* ─── category vocabulary ────────────────────────────────────────────────── */

export const CATEGORIES = Object.freeze([
  { id: 'LIQUIDITY_POOL', fa: 'استخر نقدینگی', en: 'Liquidity pool', tone: 'cyan', Icon: IconPools },
  { id: 'FARMING', fa: 'فارم', en: 'Farming', tone: 'mint', Icon: IconSparkle },
  { id: 'LENDING', fa: 'وام‌دهی', en: 'Lending', tone: 'sky', Icon: IconBank },
  { id: 'ARBITRAGE', fa: 'آربیتراژ', en: 'Arbitrage', tone: 'amber', Icon: IconTrend },
  { id: 'EMERGING_TOKEN', fa: 'توکن نوظهور', en: 'Emerging token', tone: 'violet', Icon: IconSparkle },
  { id: 'RWA', fa: 'دارایی واقعی', en: 'RWA', tone: 'gold', Icon: IconBuilding },
  { id: 'WHALE_FLOW', fa: 'جریان نهنگ', en: 'Whale flow', tone: 'rose', Icon: IconSmartMoney }
]);

export const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
export const categoryLabel = (id, locale) => {
  const c = categoryOf(id);
  return isFa(locale) ? c.fa : c.en;
};

export const RISK_LABELS = Object.freeze({
  LOW: { fa: 'کم', en: 'Low', tone: 'mint' },
  MEDIUM: { fa: 'متوسط', en: 'Medium', tone: 'amber' },
  HIGH: { fa: 'زیاد', en: 'High', tone: 'rose' },
  CRITICAL: { fa: 'بحرانی', en: 'Critical', tone: 'rose' },
  UNKNOWN: { fa: 'نامشخص', en: 'Unknown', tone: 'slate' }
});

export const riskLabel = (level, locale) => {
  const r = RISK_LABELS[level] || RISK_LABELS.UNKNOWN;
  return isFa(locale) ? r.fa : r.en;
};

/** Exclusion reason → a sentence a person can act on. */
export function exclusionText(code, locale, extra = {}) {
  const fa = isFa(locale);
  switch (code) {
    case 'risk-above-tolerance':
      return fa
        ? `ریسک ${Number(extra.riskScore ?? 0).toFixed(1)} از سقف پروفایل شما (${Number(extra.tolerance ?? 0).toFixed(1)}) بالاتر است`
        : `Risk ${Number(extra.riskScore ?? 0).toFixed(1)} is above your profile ceiling (${Number(extra.tolerance ?? 0).toFixed(1)})`;
    case 'capital-below-min-viable':
      return fa
        ? `حداقل سرمایه لازم ${money(extra.minViableCapitalUsd)} است`
        : `Needs at least ${money(extra.minViableCapitalUsd)}`;
    case 'net-profit-not-positive-after-fees':
      return fa ? 'سود پس از کارمزد و لغزش مثبت نیست' : 'Net profit after fees and slippage is not positive';
    default:
      return fa ? 'خارج از معیارهای انتخابی' : 'Outside the selected criteria';
  }
}

/* ─── small components ───────────────────────────────────────────────────── */

/** The category glyph in its tone ring. */
export function CategoryBadge({ category, size = 34 }) {
  const c = categoryOf(category);
  const Glyph = c.Icon;
  return (
    <span className="oep-cat-badge" style={{ width: size, height: size }} aria-hidden="true">
      <Glyph width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} />
    </span>
  );
}

/** Score dial: a conic ring with the number inside. */
export function ScoreDial({ score, tone = 'cyan' }) {
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  return (
    <span
      className="oep-score"
      data-tone={tone}
      style={{ '--score': value }}
      title={`${Math.round(value)}/100`}
    >
      <i>{Math.round(value)}</i>
      <small>/100</small>
    </span>
  );
}

export function Bar({ value, max = 100, warn = false }) {
  const v = Math.max(0, Math.min(100, (Number(value) / max) * 100));
  return (
    <span className={`oep-bar${warn ? ' is-warn' : ''}`}>
      <i style={{ width: `${v}%` }} />
    </span>
  );
}

export function Tag({ tone = '', children }) {
  return <span className={`oep-tag${tone ? ` is-${tone}` : ''}`}>{children}</span>;
}

/** The honest "we could not look" block. Used by every analysis section. */
export function Unavailable({ fa, en, locale }) {
  return (
    <p className="oed-unavailable">
      <IconAlertTriangle width={13} height={13} style={{ verticalAlign: '-2px', marginInlineEnd: 6 }} />
      {isFa(locale) ? fa : en}
    </p>
  );
}

/** A section header: icon, title, one-line description. */
export function BlockHead({ Icon = IconSparkle, title, sub }) {
  return (
    <header className="oed-block-head">
      <span className="oed-block-icon"><Icon width={15} height={15} /></span>
      <div>
        <p className="oed-block-title">{title}</p>
        {sub ? <p className="oed-block-sub">{sub}</p> : null}
      </div>
    </header>
  );
}

export { IconChevronRight, IconExternal };
