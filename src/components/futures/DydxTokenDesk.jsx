import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import FullScreenSheet from '../FullScreenSheet';
import '../../styles/futures-surface.css';
import FuturesAiRisk from './FuturesAiRisk';
import { IconRefresh, IconChevronRight, IconShield, IconSparkle, IconTrend } from '../Icons';
import { getDydxCandles } from '../../lib/dydx';
import { analyseMarket, scanTokenSetups, fundingAprPct } from '../../lib/futures/dydxTokenBrain';
import { liquidationDistance } from '../../lib/futures-engine/risk.js';
import { fmtCompact, fmtPct, fmtPrice } from '../../lib/format';
import '../../styles/dydx-token-desk.css';

/* The venue's own builder fee, the one the page already prints on the ticket.
   The risk engine is told about it so the liquidation distance it computes is
   not one fee narrower than reality. */
const EMPTY_CANDLES = [];
const BUILDER_FEE_RATE = 0.001;

const TABS = [
  { id: 'ai', key: 'dydx.desk.tabs.ai', Icon: IconSparkle },
  { id: 'risk', key: 'dydx.desk.tabs.risk', Icon: IconShield },
  { id: 'opp', key: 'dydx.desk.tabs.opp', Icon: IconTrend }
];

/** The candles one read needs: a week of hours. */
const RESOLUTION = '1HOUR';
const CANDLE_LIMIT = 168;

/* ─── small parts ─────────────────────────────────────────────────────────── */

function Meter({ value, tone = 'neutral', testId }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <span className={`dtd-meter dtd-tone-${tone}`} data-testid={testId}>
      <span className="dtd-meter-fill" style={{ width: `${v}%` }} />
    </span>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="row-between dtd-row">
      <span className="faint">{label}</span>
      <span className={`mono${tone ? ` dtd-${tone}` : ''}`}>{value}</span>
    </div>
  );
}

/**
 * An evidence value, formatted by the UNIT the engine declared for it. The
 * unit travels with the number because «0.0000125» is a funding rate, a price
 * and a percentage depending on which box it lands in.
 */
function EvidenceValue({ k, v, unit }) {
  const { t } = useTranslation();
  let shown = '—';
  if (v != null) {
    if (unit === 'usd') shown = `$${fmtPrice(v)}`;
    else if (unit === 'pct') shown = fmtPct(v, 2);
    else if (unit === 'x') shown = `${Number(v).toFixed(2)}×`;
    else shown = fmtPrice(v);
  }
  return <Row label={t(`dydx.desk.opp.evidence.${k}`, { defaultValue: k })} value={shown} />;
}

/* ─── room 1: the read ────────────────────────────────────────────────────── */

function AiRoom({ analysis, side }) {
  const { t } = useTranslation();
  const a = analysis;
  const plan = side === 'sell' ? a.levels.short : a.levels.long;
  return (
    <div className="dtd-room" data-testid="dydx-desk-ai">
      <div className={`dtd-verdict dtd-verdict-${a.read.id}`}>
        <div className="dtd-verdict-label">{t(`dydx.desk.ai.read.${a.read.id}`)}</div>
        <div className="dtd-verdict-score">
          {a.read.bullScore == null ? '—' : `${a.read.bullScore}/100`}
        </div>
      </div>

      <div className="dtd-pods">
        <div className="dtd-pod">
          <div className="faint">{t('dydx.desk.ai.metrics.change')}</div>
          <div className={`dtd-pod-val ${(a.changePct ?? 0) >= 0 ? 'dtd-up' : 'dtd-down'}`}>{fmtPct(a.changePct, 2)}</div>
        </div>
        <div className="dtd-pod">
          <div className="faint">{t('dydx.desk.ai.metrics.rsi')}</div>
          <div className="dtd-pod-val">{a.momentum.rsi == null ? '—' : a.momentum.rsi}</div>
        </div>
        <div className="dtd-pod">
          <div className="faint">{t('dydx.desk.ai.metrics.atr')}</div>
          <div className="dtd-pod-val">{a.volatility.atrPct == null ? '—' : `${a.volatility.atrPct}%`}</div>
        </div>
        <div className="dtd-pod">
          <div className="faint">{t('dydx.desk.ai.metrics.position')}</div>
          <div className="dtd-pod-val">{a.range.position == null ? '—' : `${Math.round(a.range.position * 100)}%`}</div>
        </div>
      </div>

      <div className="dtd-block">
        <div className="dtd-block-head">{t('dydx.desk.ai.levels')}</div>
        <Row label={t('dydx.desk.ai.support')} value={a.levels.support == null ? '—' : `$${fmtPrice(a.levels.support)}`} />
        <Row label={t('dydx.desk.ai.resistance')} value={a.levels.resistance == null ? '—' : `$${fmtPrice(a.levels.resistance)}`} />
      </div>

      {plan && (
        <div className="dtd-block">
          <div className="dtd-block-head">{t('dydx.desk.ai.plan')}</div>
          <Row label={t('dydx.desk.ai.stop')} value={`$${fmtPrice(plan.stop)}`} />
          <Row label={t('dydx.desk.ai.target')} value={`$${fmtPrice(plan.target)}`} />
          <Row label={t('dydx.desk.ai.rr')} value={`${plan.rr}×`} />
        </div>
      )}

      {!!a.caveats.length && (
        <ul className="dtd-caveats">
          {a.caveats.map((c) => (
            <li key={c}>{t(`dydx.desk.ai.caveat.${c}`, { defaultValue: c })}</li>
          ))}
        </ul>
      )}

      <p className="dtd-fine">{t('dydx.desk.ai.notAdvice')}</p>
    </div>
  );
}

/* ─── room 2: the risk engine ─────────────────────────────────────────────── */

function RiskRoom({ market, side, notionalUsd, collateralUsd, availableBalanceUsd, leverage, entryPrice, fundingApr, onApplyLeverage }) {
  const { t } = useTranslation();
  const liq = useMemo(
    () => liquidationDistance({
      providerId: 'dydx',
      side: side === 'sell' ? 'short' : 'long',
      entryPrice,
      leverage,
      maxLeverage: market?.maxLeverage ?? null,
      maintenanceMarginFraction: market?.maintenanceMarginFraction ?? null,
      takerFeeRate: BUILDER_FEE_RATE
    }),
    [side, entryPrice, leverage, market?.maxLeverage, market?.maintenanceMarginFraction]
  );

  const marginRequired = useMemo(() => {
    const imf = Number(market?.initialMarginFraction);
    const n = Number(notionalUsd);
    return Number.isFinite(imf) && imf > 0 && Number.isFinite(n) && n > 0 ? n * imf : null;
  }, [market?.initialMarginFraction, notionalUsd]);

  return (
    <div className="dtd-room" data-testid="dydx-desk-risk">
      {/*
        The engine is the SHARED one — lib/futures-engine/risk.js, the same
        module the confirmation sheet and the ledger call — fed with this
        ticket's numbers so it re-scores the order being built, not a generic
        "futures are risky" lecture. Its suggested leverage lands in the ticket
        through `onApplyLeverage`.
      */}
      <FuturesAiRisk
        providerId="dydx"
        side={side === 'sell' ? 'short' : 'long'}
        collateralUsd={collateralUsd}
        leverage={leverage}
        maxLeverage={market?.maxLeverage ?? null}
        entryPrice={entryPrice}
        /* The wallet balance that can still back a NEW order is the venue's
           free collateral, not the equity already committed to the open ones.
           Passing equity here would let the engine call an unaffordable order
           affordable. */
        availableBalanceUsd={availableBalanceUsd ?? collateralUsd}
        fundingAprPct={fundingApr}
        maintenanceMarginFraction={market?.maintenanceMarginFraction ?? null}
        takerFeeBps={BUILDER_FEE_RATE * 10_000}
        onApplyLeverage={onApplyLeverage}
        testId="dydx-desk-ai-risk"
      />

      <div className="dtd-block" style={{ marginTop: 10 }}>
        <div className="dtd-block-head">{t('dydx.desk.risk.title')}</div>
        <Row label={t('dydx.desk.risk.notional')} value={notionalUsd > 0 ? fmtCompact(notionalUsd) : '—'} />
        <Row label={t('dydx.desk.risk.margin')} value={marginRequired == null ? '—' : fmtCompact(marginRequired)} />
        <Row
          label={t('dydx.desk.risk.liq')}
          value={liq.distancePct == null ? '—' : `${Number(liq.distancePct).toFixed(2)}%`}
          tone={liq.distancePct != null && liq.distancePct < 5 ? 'down' : undefined}
        />
        <Row
          label={t('dydx.desk.risk.liqPrice')}
          value={liq.liquidationPrice == null ? '—' : `$${fmtPrice(liq.liquidationPrice)}`}
          tone={liq.liquidationPrice != null ? 'down' : undefined}
        />
      </div>
      <p className="dtd-fine">{t('dydx.desk.risk.hint')}</p>
    </div>
  );
}

/* ─── room 3: the opportunity engine ──────────────────────────────────────── */

function OpportunityRoom({ scan }) {
  const { t } = useTranslation();
  if (!scan.setups.length) {
    return (
      <div className="dtd-room" data-testid="dydx-desk-opp">
        <div className="empty">
          <strong>{t('dydx.desk.opp.empty')}</strong>
          <p className="dtd-fine" style={{ marginTop: 6 }}>{t('dydx.desk.opp.emptyBody')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dtd-room" data-testid="dydx-desk-opp">
      {scan.setups.map((s) => (
        <div className={`dtd-setup dtd-tone-${s.tone}`} key={s.id} data-testid={`dydx-desk-setup-${s.id}`}>
          <div className="row-between">
            <strong className="dtd-setup-title">{t(`dydx.desk.opp.title.${s.id}`, { defaultValue: s.id })}</strong>
            <span className="dtd-setup-score">{s.score}</span>
          </div>
          <Meter value={s.score} tone={s.tone} />
          <div className="dtd-setup-meta">
            {t('dydx.desk.opp.confidence')}: {s.confidence}%
          </div>
          <div className="dtd-setup-evidence">
            {s.evidence.map((e) => <EvidenceValue key={e.k} {...e} />)}
          </div>
          {!!s.why.length && (
            <ul className="dtd-setup-why">
              {s.why.map((w) => <li key={w}>{t(`dydx.desk.opp.why.${w}`, { defaultValue: w })}</li>)}
            </ul>
          )}
          {!!s.missing.length && (
            <div className="dtd-setup-missing">
              {t('dydx.desk.opp.missing')}: {s.missing.map((m) => t(`dydx.desk.opp.missingItem.${m}`, { defaultValue: m })).join(' · ')}
            </div>
          )}
        </div>
      ))}
      <p className="dtd-fine">{t('dydx.desk.opp.caveat.notASignal')}</p>
    </div>
  );
}

/* ─── the box ─────────────────────────────────────────────────────────────── */

export default function DydxTokenDesk({
  ticker,
  market = null,
  side = 'buy',
  notionalUsd = null,
  collateralUsd = null,
  availableBalanceUsd = null,
  leverage = null,
  entryPrice = null,
  onApplyLeverage = null,
  defaultOpen = false,
  testId = 'dydx-desk'
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [tab, setTab] = useState('ai');
  const [snapshot, setSnapshot] = useState(null);
  const candles = snapshot?.ticker === ticker ? snapshot.candles : EMPTY_CANDLES;
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [nonce, setNonce] = useState(0);

  /*
   * ─── THE READ IS NOT FETCHED UNTIL THE BOX IS OPENED ────────────────────
   * A closed accordion must cost nothing: the dYdX tab already polls markets
   * every 20s, and a second always-on candle read per market would be a second
   * bill on a screen most visitors never expand. `open` gates the request, and
   * `ticker` keys it — switching the pair re-reads, and a stale market's candles
   * are never shown under a new one.
   */
  useEffect(() => {
    if (!open || !ticker) return undefined;
    let alive = true;
    setLoading(true);
    getDydxCandles(ticker, RESOLUTION, CANDLE_LIMIT)
      .then((r) => {
        if (!alive) return;
        setSnapshot({ ticker, candles: Array.isArray(r?.candles) ? r.candles : [], checkedAt: Date.now() });
        setLive(Boolean(r?.live));
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setSnapshot(null);
        setLive(false);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [open, ticker, nonce]);

  const analysis = useMemo(() => analyseMarket({ candles, market }), [candles, market]);
  const scan = useMemo(() => scanTokenSetups({ candles, market }), [candles, market]);

  const fundingApr = useMemo(() => {
    const apr = analysis?.funding?.aprPct;
    if (apr != null) return apr;
    return fundingAprPct(market?.nextFundingRate);
  }, [analysis?.funding?.aprPct, market?.nextFundingRate]);

  const verdictLabel = analysis?.ready
    ? t(`dydx.desk.ai.read.${analysis.read.id}`)
    : t('dydx.desk.noRead');

  return (
    <motion.section
      className={`card dtd-box ${open ? 'is-open' : ''}`}
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
      initial="hidden"
      animate="show"
      style={{ marginTop: 12, width: '100%', boxSizing: 'border-box' }}
      data-testid={testId}
    >
      <button
        type="button"
        className="dtd-head"
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        data-testid={`${testId}-toggle`}
      >
        <span className="dtd-head-mark" aria-hidden="true"><IconSparkle width={15} height={15} /></span>
        <span className="dtd-head-text">
          <span className="dtd-head-title">{t('dydx.desk.title', { ticker: String(ticker || '—').replace('-USD', '') })}</span>
          <span className="dtd-head-sub">{open ? t('dydx.desk.close') : verdictLabel}</span>
        </span>
        {market?.oraclePrice > 0 && <span className="mono dtd-head-price">${fmtPrice(market.oraclePrice)}</span>}
        <motion.span className="dtd-chev" animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18 }} aria-hidden="true">
          <IconChevronRight width={15} height={15} />
        </motion.span>
      </button>

      <FullScreenSheet manageFocus open={open} onClose={() => setOpen(false)} className="futures-full-sheet dtd-screen"
        title={t('dydx.desk.title', { ticker: String(ticker || '—').replace('-USD', '') })}
        icon={<IconSparkle width={19} height={19} />} closeLabel={t('common.close')} testId={`${testId}-screen`}
        headerAction={<button type="button" className="fsh-close dtd-refresh-icon" disabled={loading}
          aria-label={t('dydx.desk.refresh')} title={t('dydx.desk.refresh')}
          onClick={() => setNonce((n) => n + 1)} data-testid={`${testId}-refresh`}><IconRefresh width={19} height={19} /></button>}>
            <div className="dtd-body">
              <div className="segmented dtd-tabs" role="tablist">
                {TABS.map((tb) => (
                  <button
                    key={tb.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === tb.id}
                    className={tab === tb.id ? 'active' : ''}
                    onClick={() => setTab(tb.id)}
                    style={{ isolation: 'isolate' }}
                    data-testid={`${testId}-tab-${tb.id}`}
                  >
                    {tab === tb.id && <span className="seg-indicator" aria-hidden="true" />}
                    <tb.Icon width={13} height={13} />
                    {t(tb.key)}
                  </button>
                ))}
              </div>

              {loading && !candles.length ? (
                <div className="spinner" style={{ margin: '14px auto' }} />
              ) : !analysis.ready ? (
                <p className="notice dtd-unavailable" data-testid={`${testId}-unavailable`}>
                  {t(`dydx.desk.unavailable.${analysis.reason}`, { min: analysis.minBars, defaultValue: t('dydx.desk.noData') })}
                </p>
              ) : (
                <>
                  {!live && <p className="notice dtd-unavailable">{t('dydx.desk.stale')}</p>}
                  <div className="dtd-bars">
                    {t('dydx.desk.bars', { count: analysis.bars })}
                    {snapshot?.ticker === ticker && <> · <time dateTime={new Date(snapshot.checkedAt).toISOString()}>{new Date(snapshot.checkedAt).toLocaleTimeString()}</time></>}
                    {analysis.read.coverage != null && ` · ${t('dydx.desk.ai.coverage')}: ${Math.round(analysis.read.coverage * 100)}%`}
                  </div>

                  {tab === 'ai' && <AiRoom analysis={analysis} side={side} />}
                  {tab === 'opp' && <OpportunityRoom scan={scan} />}
                </>
              )}

              {/* The risk engine needs no candles: it scores the TICKET. It is
                  rendered outside the readiness gate so a trader with an
                  unreachable indexer still gets the risk read on the order
                  they are about to sign. */}
              {tab === 'risk' && (
                <RiskRoom
                  market={market}
                  side={side}
                  notionalUsd={notionalUsd}
                  collateralUsd={collateralUsd}
                  availableBalanceUsd={availableBalanceUsd}
                  leverage={leverage}
                  entryPrice={entryPrice}
                  fundingApr={fundingApr}
                  onApplyLeverage={onApplyLeverage}
                />
              )}

            </div>
      </FullScreenSheet>
    </motion.section>
  );
}
