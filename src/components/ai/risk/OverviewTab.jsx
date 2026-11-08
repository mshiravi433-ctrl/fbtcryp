/**
 * AI RISK ENGINE — OVERVIEW
 * ===========================================================================
 * «Risk Intelligence Overview: وضعیت ریسک بازار + پرتفوی.»
 *
 * Above the fold, in the order a risk desk reads a book:
 *
 *   1. WHAT IS GOING ON      the market's own state, from the pulse the rest of
 *                            the app already computes — regime, breadth,
 *                            dispersion, and the measured 24h move of THIS book.
 *   2. HOW BAD IS IT          the 0–100 portfolio score, its band, and how much
 *                            of the book it actually saw.
 *   3. WHAT IS DRIVING IT     the ten families, each with the numbers that
 *                            produced it. No family is ever drawn as a zero bar.
 *   4. WHAT IT WILL COST      the parametric VaR at 95% and the tail read from
 *                            the Monte-Carlo, side by side with the method named.
 *
 * The market block cannot be a green light: `pulse.regime.score` is the
 * intelligence page's own reading, and it is printed with its confidence and
 * its provenance so a stale feed cannot present itself as a calm market.
 */
import {
  SectionCard, StatTile, Meter, Change, Pill
} from '../../ai/analysis/ui.jsx';
import { IconActivity, IconGlobe, IconShield } from '../../Icons.jsx';
import { rt } from '../../../lib/risk/copy.js';
import { fmtPct, fmtUsd, fmtCompact } from '../../../lib/format.js';
import {
  BandLegend, FamilyRow, Money, Pct, ReasonList, RiskScoreBlock, TONE_CLASS, bandLabel, toneToBar
} from './parts.jsx';

function MarketStateCard({ locale, pulse, report, performance }) {
  if (!pulse) {
    return (
      <SectionCard title={rt(locale, 'page.title')} hint={rt(locale, 'page.error')}>
        <p className="rk-empty">{rt(locale, 'page.loading')}</p>
      </SectionCard>
    );
  }
  const regime = pulse.regime || {};
  /* The regime score is −100..100 (fear..greed). It is NOT a risk score, so it
     is printed with its own label and never fed into the composite. */
  const regimeTone = regime.score == null ? 'watch' : regime.score >= 55 ? 'raised' : regime.score <= -55 ? 'serious' : 'watch';
  return (
    <SectionCard
      mark={<IconGlobe width={16} height={16} />}
      title={locale === 'fa' ? 'وضعیت ریسک بازار' : 'Market risk state'}
      hint={locale === 'fa'
        ? 'خوانش رژیم بازار از همان پالس هوش بازار؛ این عدد در امتیاز پرتفوی ضرب نمی‌شود.'
        : 'The market regime from the intelligence pulse; this number is not folded into the portfolio score.'}
      actions={<Pill tone={pulse.provenance === 'live' ? 'mint' : 'amber'} dot>{pulse.provenance || 'unknown'}</Pill>}
    >
      <div className="rk-tiles">
        <StatTile
          label={locale === 'fa' ? 'رژیم بازار' : 'Market regime'}
          value={regime.label ? (locale === 'fa' ? regime.labelFa || regime.label : regime.label) : '—'}
          sub={regime.score == null ? '—' : `${regime.score > 0 ? '+' : ''}${Math.round(regime.score)} / ±100`}
          tone={regimeTone === 'raised' ? 'amber' : regimeTone === 'serious' ? 'rose' : 'violet'}
          hint={locale === 'fa' ? 'از buildMarketPulse؛ −۱۰۰ تا +۱۰۰' : 'From buildMarketPulse; −100 to +100'}
          gauge={regime.score == null ? null : (regime.score + 100) / 2}
        />
        <StatTile
          label={locale === 'fa' ? 'اعتماد رژیم' : 'Regime confidence'}
          value={regime.confidence == null ? '—' : `${Math.round(regime.confidence)}%`}
          sub={locale === 'fa' ? 'چند درصد بازار در این خوانش سهیم بود' : 'how much of the market agreed'}
          tone="cyan"
          gauge={regime.confidence ?? null}
        />
        <StatTile
          label={locale === 'fa' ? 'عرض بازار' : 'Breadth'}
          value={pulse.breadth?.counted == null ? '—' : `${pulse.breadth.counted}`}
          sub={pulse.breadth?.total ? `${locale === 'fa' ? 'از' : 'of'} ${pulse.breadth.total}` : '—'}
          tone="violet"
          hint={locale === 'fa' ? 'تعداد دارایی‌هایی که خوانش شدند' : 'assets actually read'}
        />
        <StatTile
          label={locale === 'fa' ? 'پراکندگی' : 'Dispersion'}
          value={pulse.performance?.dispersionPct == null ? '—' : `${pulse.performance.dispersionPct.toFixed(2)}%`}
          sub={locale === 'fa' ? 'انحراف معیار حرکت ۲۴ ساعته' : 'stdev of the 24h moves'}
          tone="amber"
          hint={locale === 'fa' ? 'پراکندگی بالا یعنی بازار یک‌دست نیست' : 'high dispersion means the market is not moving as one'}
        />
      </div>

      <div className="rk-book-line">
        <span className="rk-book-item">
          {rt(locale, 'page.total')}
          <b>{fmtUsd(report.totalUsd)}</b>
        </span>
        <span className="rk-book-item">
          {locale === 'fa' ? 'حرکت ۲۴ ساعتهٔ کتاب' : 'Book 24h move'}
          <Change value={performance?.returns?.d1 ?? null} digits={2} />
        </span>
        <span className="rk-book-item">
          {locale === 'fa' ? 'ریسک اندازه‌گیری‌شده' : 'Measured families'}
          <b>{`${report.score.measured}/10`}</b>
        </span>
      </div>
    </SectionCard>
  );
}

function VarCard({ locale, report, stress }) {
  const varCell = report.families.find((f) => f.facts?.var95Usd != null)?.facts ?? null;
  const mc = (stress || []).find((s) => s.id === 'monte-carlo');
  const volatility = report.families.find((f) => f.id === 'volatility');
  return (
    <SectionCard
      mark={<IconActivity width={16} height={16} />}
      title={locale === 'fa' ? 'چقدر ممکن است از دست برود' : 'What could be lost'}
      hint={locale === 'fa'
        ? 'دو روش، هر دو با نام: VaR پارامتری و صدک‌های مونت‌کارلو. عدد بدون روش، عدد نیست.'
        : 'Two methods, both named: parametric VaR and Monte-Carlo percentiles. A number without its method is not a number.'}
    >
      <div className="rk-tiles rk-tiles-3">
        <StatTile
          label={locale === 'fa' ? 'VaR ۹۵٪ (یک روز)' : 'VaR 95% (1 day)'}
          value={varCell?.var95Usd == null ? '—' : fmtUsd(varCell.var95Usd)}
          sub={varCell?.var95Pct == null ? '—' : `${varCell.var95Pct.toFixed(2)}% ${locale === 'fa' ? 'کتاب' : 'of book'}`}
          tone="rose"
          hint={locale === 'fa' ? 'فرمول پارامتری با همبستگی اندازه‌گیری‌شده' : 'parametric formula on the measured correlation'}
        />
        <StatTile
          label={locale === 'fa' ? 'صدک ۵٪ شبیه‌سازی' : 'Monte-Carlo p05'}
          value={mc?.p05Usd == null ? '—' : fmtUsd(mc.p05Usd)}
          sub={mc?.lossProbPct == null ? '—' : `${locale === 'fa' ? 'در' : 'in'} ${mc.lossProbPct.toFixed(0)}% ${locale === 'fa' ? 'مسیرها زیان' : 'of paths a loss'}`}
          tone="amber"
          hint={locale === 'fa' ? '۴۰۰۰ مسیر با بذر ثابت' : '4,000 paths, fixed seed'}
        />
        <StatTile
          label={locale === 'fa' ? 'سیگمای روزانهٔ کتاب' : 'Book daily sigma'}
          value={volatility?.facts?.bookSigmaPct == null ? '—' : `${volatility.facts.bookSigmaPct.toFixed(2)}%`}
          sub={volatility?.facts?.worst
            ? `${volatility.facts.worst.symbol} ${volatility.facts.worst.sigmaPct?.toFixed(2)}%`
            : '—'}
          tone="violet"
          hint={locale === 'fa' ? 'از اسپارک‌لاین ۷ روزهٔ همان دارایی‌ها' : 'from each asset’s own 7-day sparkline'}
        />
      </div>
      {volatility?.reasons?.length ? (
        <div className="rk-inline-reasons">
          <ReasonList locale={locale} reasons={volatility.reasons} limit={3} />
        </div>
      ) : null}
    </SectionCard>
  );
}

export default function OverviewTab({ locale, report, pulse, performance, stress, bands }) {
  return (
    <div className="rk-stack">
      <RiskScoreBlock locale={locale} report={report} />
      <MarketStateCard locale={locale} pulse={pulse} report={report} performance={performance} />
      <VarCard locale={locale} report={report} stress={stress} />

      <SectionCard
        mark={<IconShield width={16} height={16} />}
        title={rt(locale, 'family.title')}
        hint={rt(locale, 'family.hint')}
        actions={<BandLegend locale={locale} bands={bands} />}
      >
        <div className="rk-families">
          {report.families.map((f) => <FamilyRow key={f.id} locale={locale} family={f} />)}
        </div>
      </SectionCard>
    </div>
  );
}
