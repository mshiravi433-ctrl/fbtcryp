/**
 * ONE OPPORTUNITY, ONE CARD
 * ---------------------------------------------------------------------------
 * «هر فرصت باید کارت اختصاصی داشته باشد» with, on the card itself:
 *
 *   • asset / protocol name and network
 *   • opportunity type (arbitrage, farm, staking, lending, buy, whales, RWA)
 *   • estimated annual yield or expected return
 *   • capital required
 *   • fees, slippage and gas
 *   • opportunity score out of 100
 *   • risk level and analysis confidence
 *   • how long the opportunity is valid for
 *   • a button that OPENS it — the token page, the pool, or the family screen
 *
 * ─── TWO NUMBERS PEOPLE CONFUSE, KEPT APART ─────────────────────────────────
 * The headline is the GROSS estimated yield, because that is what a market pays.
 * Beside it sits the NET profit for the user's own capital after every fee the
 * engine itemised — including estimated slippage and gas. A card that showed
 * only the headline would be an advertisement; a card that showed only the net
 * would hide the market. Both, labelled.
 *
 * ─── AND WHAT HAS NO ESTIMATE ───────────────────────────────────────────────
 * A whale flow or a brand-new token has no honest annual yield, so the headline
 * slot says «بازده تخمینی ندارد» rather than inventing one. The engine already
 * refuses to price them; the card must not paper over that.
 */
import { useMemo } from 'react';
import {
  IconChevronRight, IconExternal, IconClock, IconChart
} from '../Icons.jsx';
import {
  CategoryBadge, ScoreDial, Bar, Tag,
  money, pct, num, remaining, isFa, categoryLabel, categoryOf, riskLabel, exclusionText
} from './ui.jsx';
import { openActionFor, analysisRoute, CATEGORY_TONE, RISK_TONE, msRemaining } from '../../lib/opportunity/openAction.js';

/** The strategy word for a category, in the owner's own vocabulary. */
const STRATEGY_WORD = {
  LIQUIDITY_POOL: { fa: 'استخر', en: 'Pool' },
  FARMING: { fa: 'فارم / استیکینگ', en: 'Farm / staking' },
  LENDING: { fa: 'وام‌دهی', en: 'Lending' },
  ARBITRAGE: { fa: 'آربیتراژ', en: 'Arbitrage' },
  EMERGING_TOKEN: { fa: 'خرید زودهنگام', en: 'Early buy' },
  RWA: { fa: 'دارایی واقعی', en: 'RWA' },
  WHALE_FLOW: { fa: 'نهنگ‌ها', en: 'Whales' }
};

/**
 * @param {object} props
 * @param {object} props.opportunity  one engine row
 * @param {string} props.locale
 * @param {boolean} [props.excluded]  render the exclusion reasons instead of a CTA
 * @param {(to:string)=>void} props.onOpen      in-app navigation
 * @param {(href:string)=>void} props.onExternal
 * @param {(id:string)=>void} props.onDetails   the deep-analysis page
 * @param {number} [props.now]        for the validity countdown (injectable = testable)
 */
export default function OpportunityCard({
  opportunity, locale = 'fa', excluded = false,
  onOpen, onExternal, onDetails, now = Date.now()
}) {
  const fa = isFa(locale);
  const o = opportunity;
  const cat = categoryOf(o.category);
  const tone = CATEGORY_TONE[o.category] || 'cyan';
  const action = useMemo(() => openActionFor(o), [o]);
  const econ = o.economics || null;
  const m = o.metrics || {};
  const validFor = remaining(o.expiresAt, locale, now);
  const expired = msRemaining(o, now) === 0;

  const confidencePct = o.confidence == null ? null : Math.round(Number(o.confidence) * 100);
  const grossApy = m.grossApyPct != null ? Number(m.grossApyPct)
    : econ?.grossProfitUsd != null && econ?.capitalUsd ? (Number(econ.grossProfitUsd) / Number(econ.capitalUsd)) * (365 / (Number(econ.horizonDays) || 30)) * 100
      : null;
  const oneOff = o.category === 'ARBITRAGE' && m.spreadPct != null;
  const netApy = o.category === 'ARBITRAGE' ? econ?.netReturnPct : econ?.netApyPct;

  const openLabel = (() => {
    const key = action.labelKey;
    const table = {
      token: { fa: 'باز کردن توکن', en: 'Open token' },
      pool: { fa: 'باز کردن استخر', en: 'Open pool' },
      lend: { fa: 'باز کردن بازار وام', en: 'Open market' },
      whales: { fa: 'دیدن نهنگ‌ها', en: 'See whales' },
      discover: { fa: 'دیدن در کشف', en: 'Open Discover' },
      compare: { fa: 'مقایسه بازارها', en: 'Compare venues' },
      rwa: { fa: 'دیدن RWA', en: 'Open RWA' },
      external: { fa: 'صفحه منبع', en: 'Source page' }
    };
    return (table[key] || { fa: 'باز کردن', en: 'Open' })[fa ? 'fa' : 'en'];
  })();

  const gasUsd = econ?.fees?.networkGasUsd ?? m.gasUsd;
  const feeUsd = econ?.fees?.totalUsd ?? m.feeUsd;
  const slipUsd = econ?.fees?.slippageUsd ?? m.slippageUsd;
  const capitalNeeded = m.capitalNeededUsd ?? econ?.capitalUsd ?? null;

  return (
    <article
      className={`oep-card${excluded ? ' is-excluded' : ''}`}
      data-tone={tone}
      data-testid="opportunity-card"
      data-category={o.category}
      aria-label={`${categoryLabel(o.category, locale)} — ${o.title}`}
    >
      <header className="oep-card-head">
        <CategoryBadge category={o.category} />
        <div className="oep-card-id">
          <span className="oep-card-cat">
            {STRATEGY_WORD[o.category]?.[fa ? 'fa' : 'en'] || categoryLabel(o.category, locale)}
            {o.chain ? ` · ${o.chain}` : ''}
          </span>
          <h3 className="oep-card-title">{o.protocol ? `${o.protocol} — ` : ''}{o.symbol || o.title}</h3>
          <div className="oep-card-meta">
            {o.chain ? <Tag>{o.chain}</Tag> : null}
            {o.risk?.level ? <Tag tone={RISK_TONE[o.risk.level] === 'mint' ? 'up' : RISK_TONE[o.risk.level] === 'rose' ? 'down' : 'warn'}>
              {fa ? 'ریسک' : 'Risk'}: {riskLabel(o.risk.level, locale)}
            </Tag> : null}
            {validFor ? <Tag tone={expired ? 'warn' : ''}><IconClock width={9} height={9} /> {validFor}</Tag> : null}
          </div>
        </div>
        <ScoreDial score={o.score} tone={tone} />
      </header>

      {/* headline number: gross estimate, or an explicit refusal to invent one */}
      <div className="oep-yield">
        {oneOff ? (
          <>
            <span className="oep-yield-main is-up">{pct(m.spreadPct, { digits: 2 })}</span>
            <span className="oep-yield-label">{fa ? 'اختلاف قیمت (یک‌بار)' : 'Price spread (one-off)'}</span>
          </>
        ) : grossApy != null ? (
          <>
            <span className="oep-yield-main is-up">{pct(grossApy, { digits: 1 })}</span>
            <span className="oep-yield-label">{fa ? 'بازده تخمینی سالانه' : 'Estimated annual yield'}</span>
          </>
        ) : (
          <>
            <span className="oep-yield-main" style={{ fontSize: 14 }}>{fa ? 'بازده تخمینی ندارد' : 'No yield estimate'}</span>
            <span className="oep-yield-label">{fa ? 'این مورد سیگنال بررسی است، نه وعده بازده' : 'A signal to investigate, not a yield claim'}</span>
          </>
        )}
      </div>

      {/* the four numbers the owner asked for, always in this order */}
      <div className="oep-metrics">
        <div className="oep-metric">
          <small>{fa ? 'سرمایه لازم' : 'Capital needed'}</small>
          <b>{money(capitalNeeded)}</b>
        </div>
        <div className="oep-metric">
          <small>{fa ? 'سود خالص شما' : 'Your net profit'}</small>
          <b className={econ?.netProfitUsd > 0 ? 'is-up' : econ?.netProfitUsd < 0 ? 'is-down' : ''}>
            {econ ? money(econ.netProfitUsd) : '—'}
            {netApy != null ? <span style={{ fontSize: 10, opacity: 0.75 }}> · {pct(netApy, { digits: 1 })}</span> : null}
          </b>
        </div>
        <div className="oep-metric">
          <small>{fa ? 'کارمزد + لغزش' : 'Fees + slippage'}</small>
          <b>{feeUsd != null ? money(feeUsd) : '—'}</b>
        </div>
        <div className="oep-metric">
          <small>{fa ? 'گس شبکه' : 'Network gas'}</small>
          <b>{gasUsd != null ? money(gasUsd) : '—'}</b>
        </div>
      </div>

      {/* confidence in the evidence, and the score's own components */}
      <div className="oep-bars">
        <div className="oep-bar-row">
          <span>{fa ? 'اطمینان تحلیل' : 'Analysis confidence'}</span>
          <Bar value={confidencePct ?? 0} warn={(confidencePct ?? 0) < 40} />
          <b>{confidencePct != null ? `${confidencePct}%` : '—'}</b>
        </div>
        <div className="oep-bar-row">
          <span>{fa ? 'امتیاز فرصت' : 'Opportunity score'}</span>
          <Bar value={o.score ?? 0} />
          <b>{o.score != null ? `${num(o.score)} / 100` : '—'}</b>
        </div>
      </div>

      {excluded ? (
        <div className="oep-excl">
          {(o.exclusionReasons || []).map((r, i) => (
            <span key={`${r.code}-${i}`}>{exclusionText(r.code, locale, r)}</span>
          ))}
          {(o.exclusionReasons || []).length === 0 ? (
            <span>{fa ? 'این مورد با معیارهای فعلی شما جور نیست' : 'Does not match your current criteria'}</span>
          ) : null}
        </div>
      ) : null}

      <footer className="oep-card-foot">
        <button
          type="button"
          className="oep-open"
          disabled={action.kind === 'none'}
          onClick={() => {
            if (action.kind === 'external') { onExternal?.(action.href); return; }
            if (action.to) onOpen?.(action.to);
          }}
          title={action.kind === 'none'
            ? (fa ? 'مقصد درون‌برنامه‌ای برای این مورد وجود ندارد' : 'No in-app destination exists for this row')
            : action.href || action.to}
        >
          {action.kind === 'external' ? <IconExternal width={13} height={13} /> : null}
          {action.kind === 'none' ? (fa ? 'مقصدی ثبت نشده' : 'No destination') : openLabel}
          {action.kind !== 'external' && action.kind !== 'none' ? <IconChevronRight width={13} height={13} /> : null}
        </button>
        <button
          type="button"
          className="oep-detail-btn"
          onClick={() => onDetails?.(o.opportunityId)}
          title={fa ? 'تحلیل عمیق این فرصت' : 'Deep analysis'}
          aria-label={fa ? 'تحلیل عمیق این فرصت' : 'Deep analysis'}
        >
          <IconChart width={15} height={15} />
        </button>
      </footer>
    </article>
  );
}

/** Shared by the engine room's Top tab — the "why was this discovered" line. */
export function OpportunityReasonLine({ opportunity, locale }) {
  const first = (opportunity?.evidence || [])[0];
  if (!first) return null;
  return (
    <p className="oep-scan-body" style={{ marginTop: 6 }}>
      <span style={{ fontSize: 10.5, opacity: 0.8 }}>{first.detail}</span>
    </p>
  );
}

export { analysisRoute };
