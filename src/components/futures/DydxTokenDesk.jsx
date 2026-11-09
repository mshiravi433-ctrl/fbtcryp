/**
 * dYdX TOKEN DESK — one folded box above the account, about the selected token.
 * ===========================================================================
 *   «برای هر توکن انتخابی، باکس هوش مصنوعی، موتور ریسک و موتور فرصت را در یک
 *    باکس بازشونده زیر آن بگذار و از هوش مصنوعی هم بپرس اضافه کن»
 *
 * THREE ROOMS, ONE BOX, ONE TOKEN
 *   The dYdX tab used to end at the order button: the chart said where the
 *   price had been and the ticket said how big the order was, and nothing in
 *   between asked whether the trade made sense. Worse, the page's warnings
 *   were a column of amber boxes the reader scrolled past — the mechanism by
 *   which safety copy stops working.
 *
 *   So the three things a trader actually wants live in ONE collapsed panel
 *   above the account controls for the token they selected:
 *
 *     · هوش مصنوعی   — the read: trend, momentum, volatility, the range the
 *                      price sits in and ATR-sized levels (lib/futures/
 *                      dydxTokenBrain.js, computed on this device from dYdX's
 *                      own candles — no prediction, no server call);
 *     · موتور ریسک   — components/futures/FuturesAiRisk, the SAME engine the
 *                      confirmation sheet and the ledger use, re-scoring THIS
 *                      ticket, with its suggested leverage applied in one tap;
 *     · موتور فرصت   — the setup scanner: breakout, momentum, volume spike,
 *                      mean reversion, crowded funding, chop — each with the
 *                      arithmetic that produced it;
 *     · and underneath all three, «از هوش مصنوعی بپرس» — a real question box
 *                      that sends the market's numbers and the user's own
 *                      words to our AI gateway.
 *
 * WHY IT IS COLLAPSED BY DEFAULT
 *   A collapsed box with a real title is READ; an expanded wall of metrics is
 *   skipped. The title line carries the verdict, so the box is informative
 *   even closed — and nothing on a trading screen is fetched until it is open.
 *
 * WHAT IS NEVER DONE HERE
 *   · no read is shown without candles behind it: `ready: false` prints why;
 *   · no number is invented for a field the indexer did not send — volume and
 *     funding are reported as missing, not as zero;
 *   · no setup is a signal. Every panel prints the same caveat, and the AI
 *     answer is labelled with the model that produced it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import SegIndicator from '../SegIndicator';
import FuturesAiRisk from './FuturesAiRisk';
import { IconArrowUpRight, IconChevronRight, IconShield, IconSparkle, IconTrend } from '../Icons';
import { getDydxCandles } from '../../lib/dydx';
import { analyseMarket, scanTokenSetups, fundingAprPct, earlyTokenSignal, normaliseCandles } from '../../lib/futures/dydxTokenBrain';
import { liquidationDistance } from '../../lib/futures-engine/risk.js';
import { fmtCompact, fmtPct, fmtPrice } from '../../lib/format';
import '../../styles/dydx-token-desk.css';

/* The venue's own builder fee, the one the page already prints on the ticket.
   The risk engine is told about it so the liquidation distance it computes is
   not one fee narrower than reality. */
const BUILDER_FEE_RATE = 0.001;

const TABS = [
  { id: 'ai', key: 'dydx.desk.tabs.ai', Icon: IconSparkle },
  { id: 'risk', key: 'dydx.desk.tabs.risk', Icon: IconShield },
  { id: 'opp', key: 'dydx.desk.tabs.opp', Icon: IconTrend },
  { id: 'early', key: 'dydx.desk.tabs.early', Icon: IconTrend }
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
        availableBalanceUsd={availableBalanceUsd}
        fundingAprPct={fundingApr == null ? null : (side === 'sell' ? -fundingApr : fundingApr)}
        maintenanceMarginFraction={market?.maintenanceMarginFraction ?? null}
        takerFeeBps={BUILDER_FEE_RATE * 10_000}
        onApplyLeverage={onApplyLeverage}
        testId="dydx-desk-ai-risk"
      />

      <p className="dtd-fine">{t('dydx.desk.risk.crossMarginNote')}</p>
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

/* ─── the ask box ─────────────────────────────────────────────────────────── */

const QUICK_PROMPTS = ['why', 'risk', 'stop'];

function AskRoom({ ticker, analysis, scan, market, side, leverage, notionalUsd, live, early }) {
  const { t, i18n } = useTranslation();
  const [question, setQuestion] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | asking | done | error
  const [answer, setAnswer] = useState(null);
  const [errorKey, setErrorKey] = useState('UNKNOWN');
  /*
   * Set on MOUNT, not at creation: StrictMode (and any future double-render)
   * mounts, unmounts and re-mounts the same ref object, and a flag that is
   * only ever set false would silence every answer on the second mount —
   * a bug that appears in development and nowhere else.
   */
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const ask = async (raw) => {
    const q = String(raw || '').trim();
    if (!q || inFlight.current) return;
    inFlight.current = true;
    setPhase('asking');
    setErrorKey('UNKNOWN');
    try {
      /* The gateway client is imported on the first question, not on page
         load: the dYdX chunk must not pay for AI plumbing a reader may never
         ask for. */
      const { executeAiGatewayChat } = await import('../../lib/aiGatewayClient.js');
      const lang = String(i18n?.language || 'fa').slice(0, 2);
      const context = [
        `market: ${ticker}`,
        `candle source: ${live ? 'available (verify timestamps)' : 'unavailable or stale'}`,
        `early watch: ${early?.status ?? 'unavailable'}${early?.direction ? ` (${early.direction})` : ''}`,
        'Liquidation is an estimate and does not account for the complete cross-margin portfolio.',
        `price: ${market?.oraclePrice ?? 'unknown'}`,
        `window change: ${analysis?.changePct ?? 'unknown'}%`,
        `RSI14: ${analysis?.momentum?.rsi ?? 'unknown'}`,
        `ATR%: ${analysis?.volatility?.atrPct ?? 'unknown'}`,
        `range: ${analysis?.range?.low ?? '?'} .. ${analysis?.range?.high ?? '?'}`,
        `funding APR: ${analysis?.funding?.aprPct ?? 'unknown'}%`,
        `max leverage: ${market?.maxLeverage ?? 'unknown'}`,
        `side: ${side}, leverage: ${leverage ?? 'unknown'}, notional USD: ${notionalUsd || 'unknown'}`,
        `read: ${analysis?.read?.id ?? 'unknown'}`,
        `setups: ${scan ? (scan.setups || []).map((s) => s.id).join(', ') || 'none' : 'unknown'}`
      ].join('\n');
      const res = await executeAiGatewayChat({
        taskType: 'market_intelligence',
        system: [
          'You are the analyst inside a perpetual-futures trading screen.',
          'You are given measured market facts and the trader\'s own ticket. Answer only from them.',
          'Never promise a price, a return or a probability of profit. Never say "buy" or "sell" — describe the trade-off and name the risk.',
          `Answer in ${lang === 'fa' ? 'Persian (فارسی)' : lang === 'en' ? 'English' : lang}. Keep it under 140 words.`
        ].join(' '),
        user: `Market facts:\n${context}\n\nQuestion: ${q}`,
        json: false,
        maxTokens: 700
      });
      if (!alive.current) return;
      const text = String(res?.text || '').trim();
      if (!res?.ok || !text) {
        setErrorKey(res?.error === 'TIMEOUT' ? 'TIMEOUT' : res?.error === 'NETWORK_UNAVAILABLE' ? 'NETWORK_UNAVAILABLE' : 'NO_ANSWER');
        setPhase('error');
        return;
      }
      setAnswer({ text, provider: res?.providerName || res?.provider || null, model: res?.model || null, notice: res?.degraded ? (res?.notice?.[lang] || res?.notice?.en || t('dydx.desk.ask.degraded')) : null });
      setPhase('done');
    } catch {
      if (alive.current) {
        setErrorKey('UNKNOWN');
        setPhase('error');
      }
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <div className="dtd-ask" data-testid="dydx-desk-ask">
      <div className="dtd-ask-head">
        <IconSparkle width={14} height={14} />
        {t('dydx.desk.ask.title')}
      </div>

      <div className="dtd-quick">
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            className="dtd-chip"
            disabled={phase === 'asking'}
            onClick={() => ask(t(`dydx.desk.ask.quick.${p}`))}
            data-testid={`dydx-desk-ask-quick-${p}`}
          >
            {t(`dydx.desk.ask.quick.${p}`)}
          </button>
        ))}
      </div>

      <div className="dtd-ask-input">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(question); }}
          placeholder={t('dydx.desk.ask.placeholder', { ticker })}
          aria-label={t('dydx.desk.ask.title')}
          data-testid="dydx-desk-ask-input"
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={phase === 'asking' || !String(question).trim()}
          onClick={() => ask(question)}
          data-testid="dydx-desk-ask-send"
        >
          {phase === 'asking' ? t('dydx.desk.ask.sending') : t('dydx.desk.ask.send')}
          <IconArrowUpRight width={13} height={13} />
        </button>
      </div>

      {phase === 'asking' && <div className="dtd-ask-pending">{t('dydx.desk.ask.sending')}</div>}

      {phase === 'error' && (
        <p className="notice notice-danger dtd-ask-error" data-testid="dydx-desk-ask-error">
          {t(`dydx.desk.ask.err.${errorKey}`)}
        </p>
      )}

      {phase === 'done' && answer && (
        <div className="dtd-answer" data-testid="dydx-desk-answer">
          <div className="dtd-answer-text">{answer.text}</div>
          {answer.notice && <p className="dtd-fine" role="status">{answer.notice}</p>}
          {answer.provider && (
            <div className="dtd-answer-meta">
              {t('dydx.desk.ask.answeredBy', { provider: answer.provider, model: answer.model || '—' })}
            </div>
          )}
        </div>
      )}

      <p className="dtd-fine">{t('dydx.desk.ask.disclaimer')}</p>
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
  const [candles, setCandles] = useState([]);
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
        setCandles(Array.isArray(r?.candles) ? r.candles : []);
        setLive(Boolean(r?.live));
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setCandles([]);
        setLive(false);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [open, ticker, nonce]);

  const analysis = useMemo(() => analyseMarket({ candles, market }), [candles, market]);
  const scan = useMemo(() => scanTokenSetups({ candles, market }), [candles, market]);
  const fresh = useMemo(() => {
    const last = normaliseCandles(candles).at(-1);
    const age = last ? Date.now() - last.t : Infinity;
    return live && age >= 0 && age <= 3 * 3600_000;
  }, [candles, live]);
  const early = useMemo(() => earlyTokenSignal({ candles, live: fresh }), [candles, fresh]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setInterval(() => setNonce((n) => n + 1), 60_000);
    return () => clearInterval(timer);
  }, [open]);

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
        aria-expanded={open}
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

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
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
                    {tab === tb.id && <SegIndicator id={`dtd-${tb.id}`} />}
                    <tb.Icon width={13} height={13} />
                    {t(tb.key)}
                  </button>
                ))}
                <button
                  type="button"
                  className="dtd-refresh"
                  onClick={() => setNonce((n) => n + 1)}
                  disabled={loading}
                  title={t('dydx.desk.refresh')}
                  data-testid={`${testId}-refresh`}
                >
                  {loading ? t('common.loading') : t('dydx.desk.refresh')}
                </button>
              </div>

              {loading && !candles.length ? (
                <div className="spinner" style={{ margin: '14px auto' }} />
              ) : !analysis.ready ? (
                <p className="notice dtd-unavailable" data-testid={`${testId}-unavailable`}>
                  {t(`dydx.desk.unavailable.${analysis.reason}`, { min: analysis.minBars, defaultValue: t('dydx.desk.noData') })}
                </p>
              ) : (
                <>
                  {!fresh && <p className="notice dtd-unavailable">{t('dydx.desk.stale')}</p>}
                  <div className="dtd-bars">
                    {t('dydx.desk.bars', { count: analysis.bars })}
                    {analysis.read.coverage != null && ` · ${t('dydx.desk.ai.coverage')}: ${Math.round(analysis.read.coverage * 100)}%`}
                  </div>

                  {tab === 'ai' && <AiRoom analysis={analysis} side={side} />}
                  {tab === 'opp' && <OpportunityRoom scan={scan} />}
                </>
              )}

              {tab === 'early' && (
                <div className="dtd-signal" data-testid="dydx-desk-early" role="status">
                  <strong>{t(`dydx.desk.early.${early.status}`)}</strong>
                  {early.status === 'watch' && <>
                    <span>{t(`dydx.desk.early.${early.direction}`)}</span>
                    <Row label={t('dydx.desk.early.boundary')} value={`$${fmtPrice(early.boundary)}`} />
                    <Row label={t('dydx.desk.early.distance')} value={`${early.distanceAtr} ATR`} />
                  </>}
                  {early.status === 'unavailable' && <span>{t(`dydx.desk.early.${early.reason}`)}</span>}
                  <p className="dtd-fine">{t('dydx.desk.early.disclaimer')}</p>
                </div>
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

              <AskRoom
                ticker={ticker}
                live={fresh}
                early={early}
                analysis={analysis?.ready ? analysis : null}
                scan={scan?.ready ? scan : null}
                market={market}
                side={side === 'sell' ? 'short' : 'long'}
                leverage={leverage}
                notionalUsd={notionalUsd}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
