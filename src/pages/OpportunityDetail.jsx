/**
 * OPPORTUNITY — DEEP ANALYSIS PAGE
 * ---------------------------------------------------------------------------
 * «با کلیک روی هر فرصت، صفحه‌ای باز شود که شامل تحلیل تکنیکال، آن‌چین، نقدینگی،
 *  تاریخچه عملکرد، سناریوهای سود و زیان و ریسک قرارداد هوشمند باشد.»
 *
 * Six blocks, plus the row's own economics and score decomposition. Every block
 * is either MEASURED (live candles, a real yield series, the engine's own fee
 * model) or explicitly UNAVAILABLE with the reason. Nothing here is a placeholder
 * chart invented to fill a box.
 *
 * ─── HOW IT FINDS ITS ROW ───────────────────────────────────────────────────
 * The scan lives in the engine (and in a device cache). The detail page reads the
 * row by id from the stored scan — so a shared link, a reload, or a back-tap all
 * land on the same numbers instead of an empty screen. If the row is genuinely
 * gone (a new scan replaced it), the page says so and offers the way back.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import PageTransition from '../components/PageTransition.jsx';
import {
  IconChevronLeft, IconRefresh, IconChart, IconShield, IconClock,
  IconSparkle, IconGlobe, IconPools, IconAlertTriangle, IconExternal
} from '../components/Icons.jsx';
import {
  BlockHead, Tag, Unavailable, money, pct, num, isFa, categoryLabel,
  riskLabel, remaining, CategoryBadge
} from '../components/opportunity/ui.jsx';
import {
  buildDeepAnalysis
} from '../lib/opportunity/deepAnalysis.js';
import { openActionFor, analysisRoute } from '../lib/opportunity/openAction.js';
import { readStoredOpportunity } from '../hooks/useOpportunityEngine.js';
import { text as label } from '../lib/opportunity/sanitize.js';
import { getOhlc } from '../lib/api.js';
import { getYieldHistory } from '../lib/yields.js';
import '../styles/opportunity-engine.css';

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

export default function OpportunityDetail() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const { opportunityId } = useParams();
  const locale = i18n.language?.startsWith('fa') ? 'fa' : 'en';
  const fa = isFa(locale);

  const row = useMemo(() => readStoredOpportunity(opportunityId), [opportunityId]);
  const [candles, setCandles] = useState(null);
  const [yieldHistory, setYieldHistory] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  const action = useMemo(() => (row ? openActionFor(row) : null), [row]);

  /* Candles and yield history are the only two things this page fetches, and
     both are optional: each has its own failure state that the block renders. */
  useEffect(() => {
    if (!row) return undefined;
    let alive = true;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const tokenId = row.ref?.tokenId;
    const poolId = row.ref?.poolId;

    if (tokenId) {
      getOhlc(tokenId, 90, 'usd')
        .then((rows) => { if (alive) setCandles(Array.isArray(rows) ? rows : []); })
        .catch(() => { if (alive) setCandles([]); });
    }
    if (poolId && (row.category === 'LIQUIDITY_POOL' || row.category === 'FARMING' || row.category === 'LENDING')) {
      setLoadingHistory(true);
      getYieldHistory(poolId, { signal: controller?.signal, range: '30d' })
        .then((result) => { if (alive) { setYieldHistory(result); setHistoryError(null); } })
        .catch((e) => { if (alive) { setYieldHistory(null); setHistoryError(String(e?.message || e)); } })
        .finally(() => { if (alive) setLoadingHistory(false); });
    }
    return () => { alive = false; controller?.abort(); };
  }, [row]);

  const model = useMemo(() => (row ? buildDeepAnalysis(row, {
    capitalUsd: row.metrics?.capitalNeededUsd ?? row.economics?.capitalUsd ?? null,
    horizonDays: row.economics?.horizonDays ?? 30,
    candles,
    yieldHistory
  }) : null), [row, candles, yieldHistory]);

  const goBack = useCallback(() => navigate('/opportunities'), [navigate]);
  const openToken = useCallback(() => {
    if (!action) return;
    if (action.kind === 'external') { try { window.open(action.href, '_blank', 'noopener,noreferrer'); } catch { /* blocked */ } return; }
    if (action.to) navigate(action.to);
  }, [action, navigate]);

  if (!row) {
    return (
      <PageTransition>
        <div className="oep" dir={fa ? 'rtl' : 'ltr'}>
          <button type="button" className="oed-back" onClick={goBack}>
            <IconChevronLeft width={14} height={14} />
            {fa ? 'بازگشت به موتور فرصت' : 'Back to the engine'}
          </button>
          <div className="oep-empty">
            {fa
              ? 'این فرصت در اسکن فعلی دستگاه نیست؛ ممکن است اسکن تازه‌ای جای آن را گرفته باشد. یک اسکن تازه اجرا کنید.'
              : 'This row is not in the current scan on this device — a newer scan may have replaced it. Run a fresh scan.'}
            <div style={{ marginTop: 14 }}>
              <button type="button" className="oep-open" onClick={goBack} style={{ maxWidth: 260, margin: '0 auto' }}>
                {fa ? 'رفتن به موتور فرصت' : 'Go to the engine'}
              </button>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  const econ = row.economics;
  const m = row.metrics || {};
  /* Same law as the card: what this page puts inside a child is text. The row
     is already sanitised by readStoredOpportunity; this is the belt for the
     braces, because a cached row outlives the build that wrote it. */
  const chainLabel = label(row.chain, 32);
  const protocolLabel = label(row.protocol, 80);
  const symbolLabel = label(row.symbol, 40);
  const titleLabel = label(row.title, 200);
  const cat = categoryLabel(row.category, locale);
  const validFor = remaining(row.expiresAt, locale);

  return (
    <PageTransition>
      <div className="oep" dir={fa ? 'rtl' : 'ltr'} data-testid="opportunity-detail">
        <div className="oed">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <button type="button" className="oed-back" onClick={goBack}>
              <IconChevronLeft width={14} height={14} />
              {fa ? 'موتور فرصت' : 'Opportunity engine'}
            </button>
            <span className="oep-eyebrow" style={{ alignSelf: 'center' }}>
              <span className="oep-eyebrow-dot" />
              {cat}
            </span>
          </div>

          {/* ─── HERO: identity, score, capital, actions ─────────────── */}
          <section className="oed-hero">
            <div className="oed-hero-top">
              <CategoryBadge category={row.category} size={40} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <h1 className="oed-hero-title">{protocolLabel ? `${protocolLabel} — ` : ''}{symbolLabel || titleLabel || '—'}</h1>
                <div className="oed-hero-sub">
                  <Tag>{cat}</Tag>
                  {chainLabel ? <Tag>{chainLabel}</Tag> : null}
                  {row.risk?.level ? <Tag tone={row.risk.level === 'LOW' ? 'up' : row.risk.level === 'MEDIUM' ? 'warn' : 'down'}>
                    {fa ? 'ریسک' : 'Risk'}: {riskLabel(row.risk.level, locale)}
                  </Tag> : null}
                  {validFor ? <Tag><IconClock width={9} height={9} /> {validFor}</Tag> : null}
                  {row.score != null ? <Tag>{fa ? 'امتیاز' : 'Score'} {num(row.score)}/100</Tag> : null}
                </div>
              </div>
            </div>

            <div className="oed-kpis">
              <div className="oed-kpi">
                <small>{fa ? 'بازده تخمینی سالانه' : 'Est. annual yield'}</small>
                <b style={{ color: 'var(--oep-up)' }}>
                  {m.grossApyPct != null ? pct(m.grossApyPct) : (econ?.netApyPct != null ? pct(econ.netApyPct) : '—')}
                </b>
              </div>
              <div className="oed-kpi">
                <small>{fa ? 'سرمایه لازم' : 'Capital needed'}</small>
                <b>{money(m.capitalNeededUsd ?? econ?.capitalUsd)}</b>
              </div>
              <div className="oed-kpi">
                <small>{fa ? 'سود خالص' : 'Net profit'}</small>
                <b style={{ color: econ?.netProfitUsd > 0 ? 'var(--oep-up)' : econ?.netProfitUsd < 0 ? 'var(--oep-down)' : undefined }}>
                  {econ ? money(econ.netProfitUsd) : '—'}
                </b>
              </div>
              <div className="oed-kpi">
                <small>{fa ? 'کارمزد کل' : 'Total fees'}</small>
                <b>{econ?.fees?.totalUsd != null ? money(econ.fees.totalUsd) : '—'}</b>
              </div>
              <div className="oed-kpi">
                <small>{fa ? 'اطمینان' : 'Confidence'}</small>
                <b>{model?.score?.confidencePct != null ? `${model.score.confidencePct}%` : '—'}</b>
              </div>
              <div className="oed-kpi">
                <small>{fa ? 'سر‌به‌سر' : 'Break-even'}</small>
                <b>{econ?.breakEvenDays != null ? (fa ? `${num(econ.breakEvenDays)} روز` : `${num(econ.breakEvenDays)}d`) : '—'}</b>
              </div>
            </div>

            <div className="oed-cta-row">
              <button type="button" className="oep-open" onClick={openToken} disabled={!action || action.kind === 'none'}>
                {action?.kind === 'external' ? <IconExternal width={13} height={13} /> : null}
                {action?.kind === 'token' ? (fa ? 'باز کردن صفحه توکن' : 'Open the token page')
                  : action?.kind === 'farm' ? (fa ? 'باز کردن استخر در فارم' : 'Open the pool in Farm')
                    : action?.kind === 'lending' ? (fa ? 'باز کردن بازار وام' : 'Open the lending market')
                      : action?.kind === 'whales' ? (fa ? 'دیدن جریان نهنگ‌ها' : 'See the whale flow')
                        : action?.kind === 'external' ? (fa ? 'صفحه منبع' : 'Source page')
                          : (fa ? 'مقصدی ثبت نشده' : 'No destination')}
              </button>
              <button type="button" className="oep-open is-ghost" onClick={() => navigate(`/coin/${row.ref?.tokenId || 'bitcoin'}`)} disabled={!row.ref?.tokenId}>
                <IconChart width={13} height={13} />
                {fa ? 'نمودار و سواپ' : 'Chart & swap'}
              </button>
            </div>
          </section>

          {/* ─── TECHNICAL ──────────────────────────────────────────── */}
          <section className="oed-block">
            <BlockHead
              Icon={IconChart}
              title={fa ? 'تحلیل تکنیکال' : 'Technical analysis'}
              sub={model?.technical?.status === 'live'
                ? (fa ? `${num(model.technical.bars)} کندل روزانه` : `${num(model.technical.bars)} daily candles`)
                : (fa ? 'بر پایه کندل واقعی؛ اگر نباشد ساخته نمی‌شود' : 'Built from real candles, or not at all')}
            />
            <div className="oed-block-body">
              {model?.technical?.status !== 'live' ? (
                <Unavailable locale={locale} fa={model?.technical?.noteFa} en={model?.technical?.noteEn} />
              ) : (
                <>
                  <div className="oed-kv">
                    <div>
                      <small>{fa ? 'روند' : 'Trend'}</small>
                      <b>{model.technical.trend.label} · {pct(model.technical.trend.slopePct, { digits: 3 })}</b>
                    </div>
                    <div>
                      <small>{fa ? 'بالای SMA۵۰' : 'Above SMA50'}</small>
                      <b>{model.technical.position.aboveSma50 == null ? '—' : model.technical.position.aboveSma50 ? (fa ? 'بله' : 'yes') : (fa ? 'خیر' : 'no')}</b>
                    </div>
                    <div>
                      <small>{fa ? 'نوسان (ATR)' : 'ATR'}</small>
                      <b>{pct(model.technical.volatility.atrPct, { digits: 2 })}</b>
                    </div>
                    <div>
                      <small>{fa ? 'بیشترین افت' : 'Max drawdown'}</small>
                      <b>{pct(model.technical.volatility.drawdownPct, { digits: 1 })}</b>
                    </div>
                  </div>
                  {model.technical.signals.map((s) => (
                    <div key={s.id} className="oed-signal" data-tone={s.tone}>
                      <i />
                      <span>{fa ? s.labelFa : s.labelEn}</span>
                      <b>{s.value == null ? '—' : String(s.value)}</b>
                    </div>
                  ))}
                  {model.technical.levels.length ? (
                    <div className="oed-kv">
                      {model.technical.levels.slice(0, 3).map((l, i) => (
                        <div key={`${l.price}-${i}`}>
                          <small>{l.kind === 'high' ? (fa ? 'مقاومت' : 'Resistance') : l.kind === 'low' ? (fa ? 'حمایت' : 'Support') : (fa ? 'سطح' : 'Level')}</small>
                          <b>{money(l.price)}</b>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>

          {/* ─── ON-CHAIN ───────────────────────────────────────────── */}
          <section className="oed-block">
            <BlockHead
              Icon={IconGlobe}
              title={fa ? 'تحلیل آن‌چین' : 'On-chain analysis'}
              sub={fa ? 'فقط شواهد تأییدشده از فید؛ نه حدس' : 'Verified feed evidence only — no guesswork'}
            />
            <div className="oed-block-body">
              {model?.onchain?.status !== 'live' ? (
                <Unavailable locale={locale} fa={model?.onchain?.noteFa} en={model?.onchain?.noteEn} />
              ) : (
                <>
                  {model.onchain.rows.length ? (
                    <div className="oed-kv">
                      {model.onchain.rows.map((r) => (
                        <div key={r.id}>
                          <small>{fa ? r.labelFa : r.labelEn}</small>
                          <b>{r.unit === 'usd' ? money(r.value) : r.unit === '%' ? pct(r.value) : r.unit === 'days' ? `${num(r.value, { digits: 1 })}d` : num(r.value)}</b>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {model.onchain.evidence.map((e, i) => (
                    <div key={i} className="oed-signal">
                      <i />
                      <span style={{ opacity: 0.85 }}>{e.detail}</span>
                      <b style={{ fontSize: 10, opacity: 0.7 }}>{e.type}</b>
                    </div>
                  ))}
                </>
              )}
            </div>
          </section>

          {/* ─── LIQUIDITY ──────────────────────────────────────────── */}
          <section className="oed-block">
            <BlockHead
              Icon={IconPools}
              title={fa ? 'نقدینگی و خروج' : 'Liquidity & exit'}
              sub={model?.liquidity?.status === 'live'
                ? (fa ? model.liquidity.noteFa : model.liquidity.noteEn)
                : (fa ? 'عمق بازار گزارش نشده' : 'Depth not reported')}
            />
            <div className="oed-block-body">
              {model?.liquidity?.status !== 'live' ? (
                <Unavailable locale={locale} fa={model?.liquidity?.noteFa} en={model?.liquidity?.noteEn} />
              ) : (
                <>
                  <div className="oed-kv">
                    <div><small>{fa ? 'عمق / TVL' : 'Depth / TVL'}</small><b>{money(model.liquidity.depthUsd)}</b></div>
                    <div><small>{fa ? 'سهم پوزیشن شما' : 'Your share of depth'}</small><b>{model.liquidity.depthSharePct != null ? pct(model.liquidity.depthSharePct, { digits: 3 }) : '—'}</b></div>
                    <div><small>{fa ? 'لغزش برآوردی' : 'Est. slippage'}</small><b>{model.liquidity.slippagePct != null ? pct(model.liquidity.slippagePct, { digits: 3 }) : '—'}</b></div>
                    <div><small>{fa ? 'هزینه لغزش' : 'Slippage cost'}</small><b>{model.liquidity.slippageUsd != null ? money(model.liquidity.slippageUsd) : '—'}</b></div>
                    {model.liquidity.volume24hUsd != null ? (
                      <div><small>{fa ? 'حجم ۲۴ ساعته' : '24h volume'}</small><b>{money(model.liquidity.volume24hUsd)}</b></div>
                    ) : null}
                  </div>
                  {model.liquidity.concentration ? (
                    <div className="oed-signal" data-tone={model.liquidity.concentration === 'high' ? 'down' : model.liquidity.concentration === 'medium' ? 'hot' : 'up'}>
                      <i />
                      <span>
                        {model.liquidity.concentration === 'high'
                          ? (fa ? 'پوزیشن شما نسبت به عمق بزرگ است؛ خروج قیمت را جابه‌جا می‌کند' : 'Your position is large relative to depth; exit moves the price')
                          : model.liquidity.concentration === 'medium'
                            ? (fa ? 'پوزیشن شما در محدوده قابل‌قبولِ عمق است' : 'Your position is within a workable share of depth')
                            : (fa ? 'عمق برای این پوزیشن کافی است' : 'Depth comfortably supports this position')}
                      </span>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>

          {/* ─── PERFORMANCE HISTORY ────────────────────────────────── */}
          <section className="oed-block">
            <BlockHead
              Icon={IconClock}
              title={fa ? 'تاریخچه عملکرد' : 'Performance history'}
              sub={loadingHistory
                ? (fa ? 'در حال خواندن نرخ‌های ثبت‌شده…' : 'Reading recorded rates…')
                : model?.performance?.status === 'live'
                  ? (fa ? model.performance.noteFa : model.performance.noteEn)
                  : (fa ? 'تاریخچه‌ای در دسترس نیست' : 'No history available')}
            />
            <div className="oed-block-body">
              {model?.performance?.status !== 'live' ? (
                <Unavailable locale={locale} fa={model?.performance?.noteFa} en={model?.performance?.noteEn} />
              ) : (
                <>
                  {model.performance.kind === 'yield' ? (
                    <>
                      <div className="oed-spark" aria-hidden="true">
                        {(() => {
                          const values = model.performance.points.map((p) => p.value);
                          const max = Math.max(...values, 0.0001);
                          return model.performance.points.slice(-28).map((p, i) => (
                            <i key={i} style={{ height: `${Math.max(4, (p.value / max) * 100)}%` }} />
                          ));
                        })()}
                      </div>
                      <div className="oed-kv">
                        <div><small>{fa ? 'اکنون' : 'Now'}</small><b>{pct(model.performance.stats.lastApyPct)}</b></div>
                        <div><small>{fa ? 'میانگین دوره' : 'Period mean'}</small><b>{pct(model.performance.stats.meanApyPct)}</b></div>
                        <div><small>{fa ? 'کمینه' : 'Min'}</small><b>{pct(model.performance.stats.minApyPct)}</b></div>
                        <div><small>{fa ? 'بیشینه' : 'Max'}</small><b>{pct(model.performance.stats.maxApyPct)}</b></div>
                      </div>
                    </>
                  ) : (
                    <div className="oed-kv">
                      <div><small>{fa ? 'تغییر دوره' : 'Period change'}</small><b>{pct(model.performance.stats.changePct, { signed: true })}</b></div>
                      <div><small>{fa ? 'بیشترین افت' : 'Max drawdown'}</small><b>{pct(model.performance.stats.drawdownPct)}</b></div>
                      <div><small>{fa ? 'کمینه' : 'Min'}</small><b>{money(model.performance.stats.minPrice)}</b></div>
                      <div><small>{fa ? 'بیشینه' : 'Max'}</small><b>{money(model.performance.stats.maxPrice)}</b></div>
                    </div>
                  )}
                </>
              )}
              {historyError ? (
                <p className="oed-disclaimer">{fa ? 'تاریخچه نرخ‌ها خوانده نشد؛ عددی جای آن گذاشته نشد.' : 'The rate history could not be read; no number was substituted.'}</p>
              ) : null}
              {model?.performance?.status === 'live' && model.performance.kind === 'price' ? (
                <p className="oed-disclaimer">{fa ? 'این بلوک سری قیمت است، نه تاریخچه بازده استخر.' : 'This block is a price series, not a pool yield history.'}</p>
              ) : null}
            </div>
          </section>

          {/* ─── SCENARIOS ──────────────────────────────────────────── */}
          <section className="oed-block">
            <BlockHead
              Icon={IconSparkle}
              title={fa ? 'سناریوهای سود و زیان' : 'Profit & loss scenarios'}
              sub={model?.scenarios?.status === 'live'
                ? (fa
                  ? `با سرمایه ${money(model.scenarios.capitalUsd)} و افق ${num(model.scenarios.horizonDays)} روز — همان کارمزدی که کارت نشان داد`
                  : `${money(model.scenarios.capitalUsd)} over ${num(model.scenarios.horizonDays)} days — the same fees the card showed`)
                : (fa ? 'بدون بازده تخمینی، سناریو ساخته نمی‌شود' : 'No scenarios without a return estimate')}
            />
            <div className="oed-block-body">
              {model?.scenarios?.status !== 'live' ? (
                <Unavailable locale={locale} fa={model?.scenarios?.noteFa} en={model?.scenarios?.noteEn} />
              ) : (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="oed-table">
                      <thead>
                        <tr>
                          <th>{fa ? 'حرکت قیمت' : 'Price move'}</th>
                          {model.scenarios.impermanentLoss ? <th>IL</th> : null}
                          <th>{fa ? 'کارمزد' : 'Fees'}</th>
                          <th>{fa ? 'خالص' : 'Net'}</th>
                          <th>{fa ? 'دلار' : 'USD'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {model.scenarios.rows.map((r) => (
                          <tr key={r.movePct}>
                            <td>{r.movePct > 0 ? '+' : ''}{r.movePct}%</td>
                            {model.scenarios.impermanentLoss ? <td className={r.ilPct < 0 ? 'is-down' : ''}>{pct(r.ilPct)}</td> : null}
                            <td className="is-down">-{pct(r.feesPct, { digits: 2 })}</td>
                            <td className={r.netPct >= 0 ? 'is-up' : 'is-down'}>{pct(r.netPct, { signed: true })}</td>
                            <td className={r.netUsd >= 0 ? 'is-up' : 'is-down'}>{money(r.netUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="oed-disclaimer">{fa ? model.scenarios.noteFa : model.scenarios.noteEn}</p>
                </>
              )}
            </div>
          </section>

          {/* ─── CONTRACT RISK ──────────────────────────────────────── */}
          <section className="oed-block">
            <BlockHead
              Icon={IconShield}
              title={fa ? 'ریسک قرارداد هوشمند' : 'Smart-contract risk'}
              sub={model?.contractRisk?.status === 'live'
                ? (fa
                  ? `امتیاز مرکب ${Number(model.contractRisk.score).toFixed(1)} از ۱۰ · سطح ${riskLabel(model.contractRisk.level, locale)}`
                  : `Composite ${Number(model.contractRisk.score).toFixed(1)} / 10 · ${riskLabel(model.contractRisk.level, locale)}`)
                : (fa ? 'مدل ریسک شاخصی ندارد' : 'No risk index')}
            />
            <div className="oed-block-body">
              {model?.contractRisk?.status !== 'live' ? (
                <Unavailable locale={locale} fa={model?.contractRisk?.noteFa} en={model?.contractRisk?.noteEn} />
              ) : (
                <>
                  <div className="oed-risk-meter">
                    <span style={{ fontSize: 11, color: 'var(--oep-muted)' }}>{fa ? 'کم' : 'Low'}</span>
                    <span className="oed-risk-track"><i style={{ width: `${Math.min(100, (Number(model.contractRisk.score) / 10) * 100)}%` }} /></span>
                    <span style={{ fontSize: 11, color: 'var(--oep-muted)' }}>{fa ? 'زیاد' : 'High'}</span>
                  </div>
                  <div className="oed-checks">
                    {model.contractRisk.checks.map((c) => (
                      <div key={c.id} className="oed-check" data-state={c.status === 'unknown' ? 'unknown' : 'scored'}>
                        <span className="oed-check-mark">
                          {c.status === 'unknown' ? <IconAlertTriangle width={10} height={10} /> : '•'}
                        </span>
                        <span>
                          {fa ? c.labelFa : c.labelEn}
                          {c.status === 'unknown' ? <small>{fa ? c.detailFa : c.detailEn}</small> : null}
                        </span>
                        <b>{c.status === 'unknown' ? (fa ? 'نامشخص' : 'unknown') : (isNum(c.value) ? Number(c.value).toFixed(1) : '—')}</b>
                      </div>
                    ))}
                  </div>
                  <p className="oed-disclaimer">{fa ? model.contractRisk.noteFa : model.contractRisk.noteEn}</p>
                </>
              )}
            </div>
          </section>

          {/* ─── SCORE DECOMPOSITION ────────────────────────────────── */}
          {model?.score?.breakdown ? (
            <section className="oed-block">
              <BlockHead
                Icon={IconSparkle}
                title={fa ? 'امتیاز چطور ساخته شد' : 'How the score was built'}
                sub={fa ? 'هر جزء قابل ردیابی است' : 'Every component is traceable'}
              />
              <div className="oed-block-body">
                <div className="oed-kv">
                  {Object.entries(model.score.breakdown).filter(([, v]) => isNum(v)).map(([k, v]) => (
                    <div key={k}><small>{k}</small><b>{Number(v).toFixed(1)}</b></div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          <p className="oed-disclaimer">
            {fa
              ? 'تحلیل عمیق بر پایه داده‌های متصل ساخته می‌شود. بخشی که داده ندارد «نامشخص» نمایش داده می‌شود و در محاسبه‌ها ایمن فرض نمی‌شود. این توصیه مالی نیست.'
              : 'Deep analysis is built from connected data. A block without data is shown as unknown and is never assumed safe in the model. Not financial advice.'}
          </p>
        </div>
      </div>
    </PageTransition>
  );
}

export { analysisRoute };
