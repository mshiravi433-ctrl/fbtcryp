/**
 * AI INTELLIGENCE — PORTFOLIO REVIEW
 * ---------------------------------------------------------------------------
 * «بررسی پرتفوی باید از نظر زیان‌دهی، سود، بهترین و ضعیف‌ترین عملکرد بررسی کند
 *  و داده‌های معتبر بده و همچنین پیشنهادهایی برای بهتر شدن بده»
 *
 * This tab is now a REVIEW, not a dashboard of disconnected numbers. It reads
 * three engines and renders them in the order a person asks the questions:
 *
 *   usePortfolioRoom() → intel       (valuation, lots, cost basis)
 *                      → performance (measured 24h/7d return + attribution)
 *                      → analysis    (allocation, concentration, correlation,
 *                                     risk with its causes, suggestions)
 *                      → review      (verdict, findings, ordered actions)
 *
 * ─── THE ONE RULE THAT SHAPES THE WHOLE SCREEN ──────────────────────────────
 * Performance and P&L are DIFFERENT THINGS and are never merged:
 *
 *   · PERFORMANCE  — «what did the mix I hold today do?» — measured from the
 *     market feed, always available, labelled as price return.
 *   · P&L          — «what did I actually make?» — needs a recorded buy price,
 *     and stays «نامشخص» when the ledger has none.
 *
 * A screen that showed the first and called it the second would let a reader
 * believe they had a profit they never booked. So both are printed, side by
 * side, each with its own label and its own basis line.
 */
import {
  Change, EmptyState, Meter, Pill, ScoreRing, SectionCard, ShareBar, Spark, StatTile
} from './ui.jsx';
import { fmtMoney, fmtNumber, fmtPct, t } from '../../../lib/intelligence/copy.js';
import { findingText, suggestionText } from '../../../lib/intelligence/narrative.js';
import { bucketLabel } from '../../../lib/intelligence/portfolioAnalysis.js';

const RISK_KEY = { high: 'port.riskHigh', medium: 'port.riskMedium', low: 'port.riskLow' };
const RISK_TONE = { high: 'down', medium: 'warn', low: 'up' };

function pctFrom(snapshotChange) {
  if (!snapshotChange || !Number.isFinite(snapshotChange.from) || snapshotChange.from <= 0) return null;
  return (snapshotChange.abs / snapshotChange.from) * 100;
}

const SEVERITY_TONE = {
  critical: 'down', high: 'down', medium: 'warn', low: 'info', none: 'up'
};

/** The hero: the verdict, the two returns that produced it, and its coverage. */
function ReviewHero({ review, performance, locale }) {
  const isFa = String(locale || '').startsWith('fa');
  if (!review?.ok) {
    return (
      <div className="aix-review-hero">
        <div>
          <p className="aix-review-verdict">{review?.headline || t(locale, 'page.insufficient')}</p>
        </div>
      </div>
    );
  }
  const statusKey = review.performance?.status || 'unavailable';
  return (
    <div className={`aix-review-hero is-${review.verdict}`}>
      <div>
        <div className="aix-card-actions" style={{ marginBottom: 8 }}>
          <Pill tone={review.verdict === 'gain' ? 'up' : review.verdict === 'loss' ? 'down' : review.verdict === 'fragile' ? 'warn' : 'calm'} dot>
            {t(locale, `review.verdict.${review.verdict}`)}
          </Pill>
          <Pill tone={statusKey === 'complete' ? 'up' : statusKey === 'partial' ? 'warn' : 'down'}>
            {t(locale, `review.status.${statusKey}`)}
          </Pill>
          <Pill tone="violet">
            {t(locale, 'review.confidence')} {review.confidence}/100
          </Pill>
        </div>
        <p className="aix-review-verdict">{review.headline}</p>
        <p className="aix-review-sub">
          {t(locale, 'review.coverage')}: {performance?.coverage?.coveredSharePct ?? 0}%
          {' · '}
          {t(locale, 'review.breadth')}: {performance?.breadth?.d1?.up ?? 0} ↑ / {performance?.breadth?.d1?.down ?? 0} ↓
          {performance?.dispersion1d != null ? ` · ${t(locale, 'review.dispersion')}: ${performance.dispersion1d.toFixed(2)}%` : ''}
        </p>
      </div>
      {review.risk ? (
        <ScoreRing value={review.risk.score} band={review.risk.band === 'high' ? 'weak' : review.risk.band === 'medium' ? 'cautious' : 'strong'} size={92} caption={t(locale, 'port.risk')} />
      ) : null}
    </div>
  );
}

/** Performance and P&L, side by side, never merged. */
function PerformanceBlock({ review, performance, intel, locale }) {
  const isFa = String(locale || '').startsWith('fa');
  const d1 = performance?.returns?.d1 ?? null;
  const d7 = performance?.returns?.d7 ?? null;
  const abs1 = performance?.returns?.absUsd1d ?? null;
  const pnl = review?.pnl || { status: 'unknown' };

  return (
    <>
      {/* Performance and P&L are deliberately SIDE BY SIDE and never merged:
          the left card is the price return of today's mix, the right card is
          the realised/unrealised money that needs a cost basis. One is always
          available; the other frequently is not, and the layout must not let a
          reader average them into a single "how am I doing". */}
      <div className="aix-two-up aix-review-beside">
      <SectionCard
        data-testid="portfolio-performance"
        mark="◈"
        title={t(locale, 'review.performance')}
        hint={t(locale, 'review.basis')}
      >
        <div className="aix-review-stats">
          <div className="aix-review-stat">
            <small>{t(locale, 'review.performance1d')}</small>
            <strong><Change value={d1} arrow /></strong>
          </div>
          <div className="aix-review-stat">
            <small>{t(locale, 'review.performance7d')}</small>
            <strong><Change value={d7} arrow /></strong>
          </div>
          <div className="aix-review-stat">
            <small>{t(locale, 'review.moveUsd')} · 24h</small>
            <strong className={(abs1 ?? 0) >= 0 ? 'aix-up' : 'aix-down'}>
              {abs1 == null ? '—' : `${abs1 >= 0 ? '+' : ''}${fmtMoney(abs1, locale)}`}
            </strong>
          </div>
          <div className="aix-review-stat">
            <small>{t(locale, 'review.moveUsd')} · 7d</small>
            <strong className={(performance?.returns?.absUsd7d ?? 0) >= 0 ? 'aix-up' : 'aix-down'}>
              {performance?.returns?.absUsd7d == null ? '—' : `${performance.returns.absUsd7d >= 0 ? '+' : ''}${fmtMoney(performance.returns.absUsd7d, locale)}`}
            </strong>
          </div>
        </div>

        {performance?.missing?.length ? (
          <p className="aix-card-hint" style={{ marginTop: 10 }}>
            {t(locale, 'review.missing')}: {performance.missing.join(', ')}
          </p>
        ) : null}
      </SectionCard>

      {/* ── the money the reader actually owns, kept separate ───────────── */}
      <SectionCard
        data-testid="portfolio-pnl"
        mark="±"
        title={t(locale, 'port.pnl')}
        hint={pnl.status === 'unknown' ? t(locale, 'review.note.pnl') : t(locale, 'port.cost')}
      >
        <div className="aix-review-stats">
          <div className="aix-review-stat">
            <small>{t(locale, 'port.realised')}</small>
            <strong className={pnl.status === 'unknown' ? 'aix-na' : (pnl.realised ?? 0) >= 0 ? 'aix-up' : 'aix-down'}>
              {pnl.status === 'unknown' ? t(locale, 'port.unknown') : fmtMoney(pnl.realised ?? null, locale)}
            </strong>
          </div>
          <div className="aix-review-stat">
            <small>{t(locale, 'port.unrealised')}</small>
            <strong className={pnl.status === 'unknown' ? 'aix-na' : (pnl.unrealised ?? 0) >= 0 ? 'aix-up' : 'aix-down'}>
              {pnl.status === 'unknown' ? t(locale, 'port.unknown') : fmtMoney(pnl.unrealised ?? null, locale)}
            </strong>
          </div>
          <div className="aix-review-stat">
            <small>{t(locale, 'port.cost')}</small>
            <strong className={pnl.cost == null ? 'aix-na' : undefined}>
              {pnl.cost == null ? t(locale, 'port.unknown') : fmtMoney(pnl.cost, locale)}
            </strong>
          </div>
        </div>
      </SectionCard>
      </div>

      <div className="aix-tiles">
        <StatTile
          label={t(locale, 'port.value')}
          value={intel?.total != null ? fmtMoney(intel.total, locale) : '—'}
          sub={performance?.coverage ? `${performance.coverage.priced}/${performance.coverage.rows} ${isFa ? 'قیمت‌گذاری‌شده' : 'priced'}` : null}
          icon="◍"
        />
        <StatTile
          label={t(locale, 'port.risk')}
          value={review?.risk ? `${review.risk.score}/100` : '—'}
          sub={review?.risk ? t(locale, RISK_KEY[review.risk.band]) : null}
          tone={RISK_TONE[review?.risk?.band] || 'neutral'}
          gauge={review?.risk?.score ?? null}
          icon="⚠"
        />
        <StatTile label="24h" value={<Change value={pctFrom(intel?.change24h)} />} icon="⏱" />
        <StatTile label="7d" value={<Change value={pctFrom(intel?.change7d)} />} icon="⏱" />
        <StatTile label="30d" value={<Change value={pctFrom(intel?.change30d)} />} icon="⏱" />
      </div>
    </>
  );
}

/** Best / worst / losses — the part of the review that is easy to skip. */
function StandoutBlock({ review, locale, onOpenToken }) {
  const isFa = String(locale || '').startsWith('fa');
  const best = review?.best;
  const worst = review?.worst;
  const losses = review?.losses || [];

  return (
    <div className="aix-two-up" data-testid="portfolio-standout">
      <SectionCard mark="✦" title={t(locale, 'review.best')} hint={isFa ? 'بر اساس بازده ۲۴ ساعته' : 'By 24h return'}>
        {best ? (
          <ShareBar
            badge="1"
            label={best.symbol}
            value={<Change value={best.change} arrow />}
            weight={null}
            tone="mint"
            detail={(
              <>
                {isFa ? 'سهم' : 'weight'} {best.weight != null ? `${best.weight.toFixed(1)}%` : '—'}
                {best.moveUsd != null ? ` · ${best.moveUsd >= 0 ? '+' : ''}${fmtMoney(best.moveUsd, locale)}` : ''}
              </>
            )}
            onClick={onOpenToken && best.symbol ? () => onOpenToken(best.symbol) : undefined}
          />
        ) : <p className="aix-card-hint">{t(locale, 'page.insufficient')}</p>}
      </SectionCard>

      <SectionCard mark="✧" title={t(locale, 'review.worst')} hint={isFa ? 'بر اساس بازده ۲۴ ساعته' : 'By 24h return'}>
        {worst ? (
          <ShareBar
            badge="↓"
            label={worst.symbol}
            value={<Change value={worst.change} arrow />}
            weight={worst.weight != null ? Math.min(100, Math.abs(worst.weight)) : null}
            tone="rose"
            detail={(
              <>
                {isFa ? 'سهم' : 'weight'} {worst.weight != null ? `${worst.weight.toFixed(1)}%` : '—'}
                {worst.moveUsd != null ? ` · ${worst.moveUsd >= 0 ? '+' : ''}${fmtMoney(worst.moveUsd, locale)}` : ''}
              </>
            )}
            onClick={onOpenToken && worst.symbol ? () => onOpenToken(worst.symbol) : undefined}
          />
        ) : <p className="aix-card-hint">{t(locale, 'page.insufficient')}</p>}
      </SectionCard>

      <SectionCard
        mark="⊖"
        className="aix-span-two"
        title={t(locale, 'review.losses')}
        hint={losses.length ? (isFa ? 'اندازه‌گیری‌شده، با اثر دلاری روی پرتفوی' : 'Measured, with the dollar effect on the portfolio') : undefined}
      >
        {losses.length ? (
          <div className="aix-share-list">
            {losses.map((l) => (
              <ShareBar
                key={l.symbol}
                label={l.symbol}
                value={<Change value={l.change} arrow />}
                weight={l.weight != null ? Math.min(100, Math.abs(l.change) * 5) : null}
                tone="rose"
                detail={(
                  <>
                    {isFa ? 'اثر' : 'effect'} {l.moveUsd != null ? fmtMoney(l.moveUsd, locale) : '—'}
                    {' · '}{isFa ? 'سهم' : 'weight'} {l.weight != null ? `${l.weight.toFixed(1)}%` : '—'}
                  </>
                )}
              />
            ))}
          </div>
        ) : <p className="aix-card-hint">{t(locale, 'review.noLosses')}</p>}
      </SectionCard>
    </div>
  );
}

/** The findings, then the ordered actions derived from them. */
function FindingsBlock({ review, locale }) {
  const findings = review?.findings || [];
  const actions = review?.actions || [];
  if (!review?.ok) return null;
  return (
    <>
      <SectionCard
        data-testid="portfolio-findings"
        mark="⌕"
        title={t(locale, 'review.findings')}
        hint={`${findings.length} ${String(locale || '').startsWith('fa') ? 'یافته' : 'findings'} · ${t(locale, 'page.notAdvice')}`}
      >
        {findings.length ? (
          <div className="aix-review-list">
            {findings.map((f, i) => (
              <div key={`${f.kind}-${i}`} className={`aix-review-row is-${f.severity}`}>
                <span className="aix-review-rank">{i + 1}</span>
                <div className="aix-review-copy">
                  <strong>{findingText(locale, f)}</strong>
                  <div className="aix-review-meta">
                    <span>{t(locale, 'port.horizon')}: {t(locale, `port.horizon.${f.horizon}`)}</span>
                    <span>{t(locale, 'page.confidence')}: {f.confidence ?? '—'}</span>
                  </div>
                </div>
                <div className="aix-review-side">
                  <Pill tone={SEVERITY_TONE[f.severity] || 'calm'} dot>
                    {t(locale, `review.severity.${f.severity}`)}
                  </Pill>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="✓"
            title={t(locale, 'review.noActions')}
            hint={review.note || t(locale, 'port.noSuggestions')}
          />
        )}
      </SectionCard>

      {actions.length ? (
        <SectionCard data-testid="portfolio-actions" mark="➤" title={t(locale, 'review.actions')} hint={t(locale, 'page.notAdvice')}>
          <div className="aix-review-list">
            {actions.map((a) => (
              <div key={`${a.kind}-${a.rank}`} className={`aix-review-row is-${a.severity}`}>
                <span className="aix-review-rank">{a.rank}</span>
                <div className="aix-review-copy">
                  <strong>{findingText(locale, a)}</strong>
                  <div className="aix-review-meta">
                    <span>{t(locale, 'port.horizon')}: {t(locale, `port.horizon.${a.horizon}`)}</span>
                    <span>{t(locale, 'page.confidence')}: {a.confidence ?? '—'}</span>
                  </div>
                </div>
                {/*
                  The side cell used to print `a.value` as a bare signed number
                  («+80.00»), which has no unit and therefore no meaning next to
                  a sentence that already names the percentage. What belongs
                  here is the severity and the risk band the action carries.
                */}
                <div className="aix-review-side">
                  <Pill tone={SEVERITY_TONE[a.severity] || 'calm'} dot>
                    {t(locale, `review.severity.${a.severity}`)}
                  </Pill>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </>
  );
}

export default function PortfolioTab({
  connected, intel, analysis, review, performance, locale, onConnect, loading, coverage, onOpenToken
}) {
  if (!connected) {
    return (
      <div className="aix-tab-body">
        <SectionCard mark="◈" title={t(locale, 'port.connect')} hint={t(locale, 'port.connectHint')}>
          <EmptyState
            icon="◈"
            title={t(locale, 'port.connect')}
            hint={t(locale, 'port.connectHint')}
            action={(
              <button type="button" className="aix-cta" onClick={() => onConnect?.('/wallet')}>
                {String(locale || '').startsWith('fa') ? 'رفتن به کیف پول' : 'Open wallet'}
              </button>
            )}
          />
        </SectionCard>
      </div>
    );
  }

  if (!intel) {
    return (
      <div className="aix-tab-body">
        <SectionCard mark="◈" title={t(locale, 'port.value')}>
          <p className="aix-card-hint">{loading ? t(locale, 'page.loading') : t(locale, 'page.insufficient')}</p>
        </SectionCard>
      </div>
    );
  }

  const risk = analysis?.risk;
  const isFa = String(locale || '').startsWith('fa');
  const suggestions = analysis?.suggestions || [];

  return (
    <div className="aix-tab-body">
      <SectionCard
        mark="◎"
        title={t(locale, 'review.title')}
        hint={t(locale, 'review.subtitle')}
      >
        <div className="aix-review">
          <ReviewHero review={review} performance={performance} locale={locale} />
        </div>
      </SectionCard>

      <PerformanceBlock review={review} performance={performance} intel={intel} locale={locale} />

      <StandoutBlock review={review} locale={locale} onOpenToken={onOpenToken} />

      <FindingsBlock review={review} locale={locale} />

      {/* ── allocation ─────────────────────────────────────────────────── */}
      <SectionCard
        mark="◱"
        title={t(locale, 'port.allocation')}
        hint={analysis
          ? `${t(locale, 'port.effectiveHoldings')}: ${analysis.concentration.effectiveHoldings} · HHI ${analysis.concentration.hhi} · ${t(locale, 'port.concentration')} ${analysis.concentration.topShare.toFixed(1)}%`
          : undefined}
      >
        {analysis?.allocation?.length ? (
          <div className="aix-share-list">
            {analysis.allocation.map((b) => (
              <ShareBar
                key={b.id}
                label={isFa ? b.fa : b.en}
                value={fmtMoney(b.value, locale)}
                weight={b.weight}
                tone={b.id === 'stable' ? 'mint' : b.id === 'btc' ? 'amber' : 'violet'}
                detail={bucketLabel(b.id, locale)}
              />
            ))}
          </div>
        ) : <p className="aix-card-hint">{t(locale, 'page.insufficient')}</p>}

        {analysis?.chainAllocation?.length > 1 ? (
          <div style={{ marginTop: 14 }}>
            <p className="aix-card-hint">{isFa ? 'توزیع روی شبکه‌ها' : 'Across networks'}</p>
            <div className="aix-share-list">
              {analysis.chainAllocation.slice(0, 5).map((c) => (
                <ShareBar
                  key={String(c.chainId)}
                  label={`#${c.chainId}`}
                  value={fmtMoney(c.value, locale)}
                  weight={c.weight}
                  tone="cyan"
                />
              ))}
            </div>
          </div>
        ) : null}
      </SectionCard>

      {/* ── risk ───────────────────────────────────────────────────────── */}
      <SectionCard
        mark="⚠"
        title={t(locale, 'port.risk')}
        hint={risk ? t(locale, RISK_KEY[risk.band]) : undefined}
      >
        <Meter
          value={risk?.score ?? null}
          tone={risk?.band === 'high' ? 'rose' : risk?.band === 'medium' ? 'amber' : 'mint'}
          caption={risk ? `${risk.score}/100` : undefined}
        />
        <div className="aix-reasons">
          {(risk?.reasons || []).map((r, i) => (
            <Pill key={`${r.key}-${i}`} tone={r.key === 'measured-daily-drawdown' ? 'down' : 'calm'}>
              {r.key}{Object.keys(r.params || {}).length
                ? ` (${Object.entries(r.params).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${typeof v === 'number' ? Number(v).toFixed(2) : v}`).join(', ')})`
                : ''}
            </Pill>
          ))}
        </div>
        {risk?.unavailable?.length ? (
          <p className="aix-card-hint" style={{ marginTop: 8 }}>
            {isFa ? 'آمار محاسبه‌نشده' : 'Statistics not computed'}: {risk.unavailable.join(' · ')}
          </p>
        ) : null}
      </SectionCard>

      {/* ── correlation ────────────────────────────────────────────────── */}
      <SectionCard
        mark="∿"
        title={t(locale, 'port.correlation')}
        hint={analysis?.correlation?.average != null
          ? t(locale, 'port.pairs', { count: analysis.correlation.pairs.length, avg: analysis.correlation.average.toFixed(2) })
          : undefined}
      >
        {analysis?.correlation?.pairs?.length ? (
          <div className="aix-share-list">
            {analysis.correlation.pairs.map((p) => (
              <ShareBar
                key={`${p.a}-${p.b}`}
                label={`${p.a} / ${p.b}`}
                value={p.r.toFixed(2)}
                weight={Math.abs(p.r) * 100}
                tone={p.r >= 0.75 ? 'rose' : 'mint'}
                detail={`${p.samples}d`}
              />
            ))}
          </div>
        ) : <p className="aix-card-hint">{t(locale, 'port.correlationMissing')}</p>}
        {analysis?.correlation?.insufficient?.length ? (
          <p className="aix-card-hint">
            {isFa ? 'بدون تاریخچه کافی' : 'Not enough history'}: {analysis.correlation.insufficient.join(', ')}
          </p>
        ) : null}
      </SectionCard>

      {/* ── engine suggestions (horizon + confidence + evidence) ────────── */}
      <SectionCard mark="✧" title={t(locale, 'port.suggestions')} hint={t(locale, 'page.notAdvice')}>
        {suggestions.length ? (
          <div className="aix-suggestions">
            {suggestions.map((s, i) => (
              <div key={`${s.action}-${i}`} className="aix-suggestion">
                <div className="aix-suggestion-head">
                  <strong>{suggestionText(locale, s)}</strong>
                  <Pill tone="info">{t(locale, 'opp.confidence')} {s.confidence}</Pill>
                </div>
                <div className="aix-suggestion-meta">
                  <span>{t(locale, 'port.horizon')}: {t(locale, `port.horizon.${s.horizon}`)}</span>
                  <span>{t(locale, 'port.riskLevel')}: {t(locale, RISK_KEY[s.risk] || 'port.riskMedium')}</span>
                  <span>{t(locale, 'port.evidence')}: {s.evidence.join(', ')}</span>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="aix-card-hint">{t(locale, 'port.noSuggestions')}</p>}
      </SectionCard>

      {/* ── holdings, with the per-holding move that drove the review ───── */}
      <SectionCard
        mark="◰"
        title={isFa ? 'دارایی‌ها و سهم هرکدام در حرکت' : 'Holdings and their contribution'}
        hint={isFa ? 'بازده هر دارایی همان چیزی است که بازده پرتفوی از آن ساخته شده' : 'Each holding’s own return is what the portfolio return was built from'}
      >
        <div className="aix-table aix-table-compact">
          <div className="aix-thead">
            <span>{isFa ? 'دارایی' : 'Asset'}</span>
            <span>{isFa ? 'ارزش' : 'Value'}</span>
            <span>{isFa ? 'سهم' : 'Weight'}</span>
            <span>24h</span>
            <span>{isFa ? 'اثر' : 'Effect'}</span>
          </div>
          {(performance?.attribution || intel.rows || []).slice(0, 14).map((r) => (
            <div key={`${r.symbol}-${r.chainId ?? 'x'}`} className="aix-prow aix-prow-hold">
              <span className="aix-token-sym">{r.symbol}</span>
              <span className="aix-mono">{r.valueUsd != null ? fmtMoney(r.valueUsd, locale) : (r.value != null ? fmtMoney(r.value, locale) : '—')}</span>
              <span>{r.weight != null ? `${Number(r.weight).toFixed(1)}%` : '—'}</span>
              <span>
                {r.change1d != null
                  ? <Change value={r.change1d} />
                  : r.pnlPct != null
                    ? <Change value={r.pnlPct} />
                    : <span className="aix-na">{t(locale, 'port.unknown')}</span>}
              </span>
              <span className="aix-mono">
                {r.move1dUsd != null
                  ? <span className={r.move1dUsd >= 0 ? 'aix-up' : 'aix-down'}>{r.move1dUsd >= 0 ? '+' : ''}{fmtMoney(r.move1dUsd, locale)}</span>
                  : <span className="aix-na">—</span>}
              </span>
            </div>
          ))}
        </div>
        {coverage ? (
          <p className="aix-card-hint" style={{ marginTop: 8 }}>
            {coverage.readChains}/{coverage.totalChains} {isFa ? 'شبکه خوانده شد' : 'networks read'}
            {' · '}{coverage.pricedRows}/{coverage.totalRows} {isFa ? 'ردیف قیمت‌گذاری‌شده' : 'rows priced'}
          </p>
        ) : null}
      </SectionCard>
    </div>
  );
}
