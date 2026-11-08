/**
 * «AI ترید» — NEURAL DESK. The tab on /perp, and the only screen in the app
 * that puts an AI between the reader and a live order book.
 *
 * SIX STEP STATIONS, one on screen at a time:
 *   1 اتصال      — public address + agent key (format check, session memory only)
 *   2 حساب       — live account, exposure, today's realised and open PnL
 *   3 سقف‌ها     — per-order, total, daily loss, leverage, markets, kill switch
 *   4 تحلیل       — BYOK AI proposes intents; the user's rules shape the prompt
 *   5 تأیید       — every intent is previewed; executes only after a 500 ms hold
 *   6 گزارش       — this session's record, plus realised PnL from Hyperliquid
 *
 * The AI never sends anything. Keys live only in this component's state and
 * are wiped on lock, after 10 minutes idle, or 2 minutes hidden.
 *
 * ─── THE DESIGN, AND WHY IT LOOKS LIKE THIS ────────────────────────────────
 * «بهترین و مدرن‌ترین UI/UX را بساز و خیلی مدرن‌تر و خاص‌تر کن از همه نظر»
 *
 * The old sheet was glass panels on a flat wash: correct, and identical to
 * five other routes. This pass gives the tab a ROOM and a LANGUAGE of its
 * own, and every added element is decorative, aria-hidden, and painted in
 * CSS — no number, no series, no route is invented to make the screen look
 * busier than it is.
 *
 *   · THE ROOM   a painted obsidian vault behind the whole tab: one drifting
 *                aurora, a fine instrument mesh, a slow vertical sweep, and
 *                photographic grain. Nothing is read back from the page.
 *   · THE CORE   the hero badge is a neural core — two counter-rotating
 *                orbits and a breathing halo — and it encodes state: it goes
 *                amber for «آماده», red and still for «توقف اضطراری».
 *   · THE RAIL   the stepper is a signal rail: numbered stations over a
 *                progress line with a travelling pulse, so "where am I" is
 *                answered at a glance and without reading.
 *   · THE TICKET every proposal is a decision docket with a side ribbon, a
 *                risk dial, a TTL ring and the analyst's rationale as a
 *                quote — the shape of an order confirmation, not a card.
 *   · THE HOLD   each money-moving action is a dial that fills for 500 ms.
 *                The dial is the ring, the ring is the commitment.
 *
 * Mobile-first, RTL-native, both themes, `data-lite` and reduced-motion aware,
 * 44px touch targets, and the hold gesture is unchanged.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconLock, IconSparkle, IconCheck, IconShield, IconKey, IconWallet, IconChart, IconDoc, IconAlertTriangle } from '../Icons';
import { validateAgentKeyFormat } from '../../lib/hyperliquid/agentKey';
import { agentAddress } from '../../lib/hyperliquid/signing';
import { isValidHlAddress, readAccountSummary } from '../../lib/hyperliquid/readonly';
import { defaultCapsSettings, validateCapsSettings } from '../../lib/hyperliquid/capsSettings';
import { fetchMarkets, eligibleMarkets, fetchCandles, fetchRealisedSince } from '../../lib/hyperliquid/market';
import { executeIntent, makeNonceSource } from '../../lib/hyperliquid/exchangeOps';
import {
  normalizeRules, buildPreview, createPending, approvePending, createLedger, recordEntry,
  tradesSince, lastTradeTimes, startOfLocalDay, STRATEGIES, RULE_DEFAULTS, MIN_MARKET_VOLUME_USD
} from '../../lib/hyperliquid/engine';
import { requestProposals, buildAnalystMessages, AI_DEFAULT_ENDPOINT } from '../../lib/hyperliquid/aiClient';
import { AI_TRADE_COPY as C, AI_TRADE_TAB_LABEL } from '../../lib/hyperliquid/aiTradeCopy';
import '../../styles/ai-trade.css';
import { pollWhileVisible } from '../../lib/visibilityPoll';

const STEPS = ['connect', 'account', 'limits', 'ai', 'approve', 'report'];
const FRESH_MS = 120000;
const IDLE_LOCK_MS = 10 * 60000;
const HIDDEN_LOCK_MS = 2 * 60000;
const HOLD_MS = 500;
const LEVERAGE_CHOICES = [1, 2, 3, 5, 10];
const TOP_ANALYSIS_COINS = 6;
const MAX_PICK = 40;

/* One glyph per station, so the rail says what each step IS. */
const STEP_ICONS = {
  connect: IconKey,
  account: IconWallet,
  limits: IconShield,
  ai: IconSparkle,
  approve: IconCheck,
  report: IconDoc
};

const volText = (v) => (!Number.isFinite(v) ? '–'
  : v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${(v / 1e3).toFixed(0)}K`);

const EMPTY_SESSION = Object.freeze({ address: '', agentKey: '', aiKey: '', aiEndpoint: AI_DEFAULT_ENDPOINT, aiModel: '', connected: false });

const num = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : C.account.unknown);
const signed = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : C.account.unknown);
const tone = (v) => (Number.isFinite(v) ? (v >= 0 ? 'up' : 'down') : undefined);
const timeFa = (t) => new Date(t).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

function formFromDefaults() {
  const d = defaultCapsSettings();
  return {
    totalExposureUsd: String(d.totalExposureUsd),
    maxOrderUsd: String(d.maxOrderUsd),
    dailyLossUsd: String(d.dailyLossUsd),
    maxLeverage: String(d.maxLeverage),
    allowedCoins: [...d.allowedCoins],
    killSwitch: d.killSwitch
  };
}

/**
 * Reads everything the caps and the rules need, in one go. Anything that cannot
 * be read becomes null, and caps then refuse (fail closed).
 */
async function readFresh(address, now = Date.now()) {
  const [summary, fills] = await Promise.all([
    readAccountSummary(address),
    fetchRealisedSince(address, startOfLocalDay(now))
  ]);
  if (!summary.ok) return { ok: false, code: summary.code };
  if (!fills.ok) return { ok: false, code: fills.code };
  const unrealised = summary.positions.every((p) => Number.isFinite(p.unrealizedPnl))
    ? summary.positions.reduce((a, p) => a + p.unrealizedPnl, 0)
    : null;
  return {
    ok: true,
    at: now,
    summary,
    fills,
    state: {
      currentExposureUsd: summary.notionalPositionUsd,
      dailyRealisedPnlUsd: fills.realisedPnlUsd,
      dailyUnrealisedPnlUsd: unrealised
    }
  };
}

function lossUsed(fresh, dailyLoss) {
  if (!fresh?.ok || !Number.isFinite(dailyLoss) || dailyLoss <= 0) return null;
  const s = fresh.state;
  if (!Number.isFinite(s.dailyRealisedPnlUsd) || !Number.isFinite(s.dailyUnrealisedPnlUsd)) return null;
  const loss = Math.max(0, -(s.dailyRealisedPnlUsd + Math.min(0, s.dailyUnrealisedPnlUsd)));
  return { loss, pct: Math.min(100, (loss / dailyLoss) * 100) };
}

/* ── hold to confirm ──────────────────────────────────────────────────────
 * Unchanged semantics, new gesture: the commitment is a ring that closes over
 * 500 ms. A tap does nothing; releasing early drains it. `kind="reject"` keeps
 * a plain sweep, because saying no is not a commitment.
 */
export function HoldButton({ onConfirm, disabled, kind = 'approve', children, label }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onConfirm();
    }, HOLD_MS);
  };
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  return (
    <button
      type="button"
      className={`ai-trade-btn ai-trade-hold${holding ? ' is-holding' : ''}`}
      data-kind={kind}
      disabled={disabled}
      aria-label={label}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); start(); } }}
      onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') cancel(); }}
      onBlur={cancel}
    >
      {kind === 'approve' && (
        <span className="ai-trade-hold-dial" aria-hidden="true">
          <svg viewBox="0 0 44 44" focusable="false">
            <circle className="ai-trade-hold-track" cx="22" cy="22" r="19" />
            <circle className="ai-trade-hold-fill" cx="22" cy="22" r="19" />
          </svg>
        </span>
      )}
      <span className="ai-trade-hold-label">{children}</span>
    </button>
  );
}

/* ── plates and nodes ──────────────────────────────────────────────────────
 * A Plate is the tab's only surface. Three painted planes (prismatic rim,
 * smoked body, top skylight) plus an optional accent and a head that can carry
 * a kicker, an icon and one action.
 */
function Card({ title, kicker, action, icon, children, className = '', span = '', accent, bare = false }) {
  return (
    <section
      className={`ai-trade-card ${span} ${className}`.trim()}
      data-accent={accent}
      data-bare={bare ? 'true' : undefined}
    >
      {(title || action) && (
        <header className="ai-trade-card-head">
          {title && (
            <div className="ai-trade-card-title">
              {icon && <span className="ai-trade-card-ico" aria-hidden="true">{icon}</span>}
              <span className="ai-trade-card-heading">
                {kicker && <span className="ai-trade-kicker">{kicker}</span>}
                <h2>{title}</h2>
              </span>
            </div>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/* A KPI is a number with a provenance: caption, value, foot hint, and a level
   bar that only appears when the caller has a real 0..1 to draw. */
function Kpi({ label, value, toneName, hint, level, icon, suffix }) {
  return (
    <div className="ai-trade-kpi" data-tone={toneName}>
      <span className="ai-trade-kpi-top">
        <span className="ai-trade-kpi-label">{label}</span>
        {icon && <span className="ai-trade-kpi-ico" aria-hidden="true">{icon}</span>}
      </span>
      <span className="ai-trade-kpi-line">
        <span className="ai-trade-kpi-value" data-unknown={value === C.account.unknown ? 'true' : undefined}>{value}</span>
        {suffix && value !== C.account.unknown && <span className="ai-trade-kpi-suffix">{suffix}</span>}
      </span>
      {Number.isFinite(level) && (
        <span className="ai-trade-kpi-level" aria-hidden="true"><span style={{ '--p': clamp01(level) }} /></span>
      )}
      {hint && <span className="ai-trade-small ai-trade-muted">{hint}</span>}
    </div>
  );
}

/* The risk dial: one 0..1 value, drawn as an arc. Used for the daily-loss
   budget and for a proposal's worst case, so risk is read the same way twice. */
function RiskDial({ value, label, caption, toneName }) {
  const p = clamp01(value);
  return (
    <div className="ai-trade-dial" data-tone={toneName} data-warn={p >= 0.7 ? 'true' : 'false'}>
      <div className="ai-trade-dial-face" style={{ '--p': p }} aria-hidden="true">
        <span className="ai-trade-dial-ring" />
        <span className="ai-trade-dial-core">
          <b>{Math.round(p * 100)}%</b>
          <small>{label}</small>
        </span>
      </div>
      {caption && <p className="ai-trade-small ai-trade-muted">{caption}</p>}
    </div>
  );
}

/* ── step 1: connect ────────────────────────────────────────────────────── */
function ConnectStep({ session, setSession, onConnect, busy, error }) {
  const addressOk = isValidHlAddress(session.address.trim());
  const keyCheck = session.agentKey ? validateAgentKeyFormat(session.agentKey) : null;
  const keyOk = keyCheck?.ok === true;
  let shown = null;
  if (keyOk) { try { const a = agentAddress(session.agentKey.trim()); shown = `${a.slice(0, 6)}…${a.slice(-4)}`; } catch { shown = null; } }
  const keyError = keyCheck && !keyCheck.ok ? C.connect.errors[keyCheck.code] || C.connect.errors.AGENT_KEY_BAD_FORMAT : null;
  const ready = addressOk && keyOk && !busy;

  return (
    <div className="ai-trade-bento">
      <Card title={C.connect.title} kicker="STATION 01" icon={<IconKey width={18} height={18} />} span="ai-trade-span-2" accent="cyan">
        <p className="ai-trade-muted">{C.connect.help}</p>
        <div className="ai-trade-form">
          <label className="ai-trade-field ai-trade-field-wide">
            <span className="ai-trade-field-label">{C.connect.addressLabel}</span>
            <span className="ai-trade-input-shell" data-ok={addressOk ? 'true' : undefined}>
              <span className="ai-trade-input-ico" aria-hidden="true"><IconWallet width={16} height={16} /></span>
              <input
                type="text" inputMode="text" dir="ltr" autoComplete="off" spellCheck={false}
                value={session.address} placeholder="0x…"
                onChange={(e) => setSession((s) => ({ ...s, address: e.target.value, connected: false }))}
              />
              {addressOk && <span className="ai-trade-input-mark" aria-hidden="true"><IconCheck width={14} height={14} /></span>}
            </span>
          </label>
          <label className="ai-trade-field ai-trade-field-wide">
            <span className="ai-trade-field-label">{C.connect.keyLabel}</span>
            <span className="ai-trade-input-shell" data-ok={keyOk ? 'true' : undefined}>
              <span className="ai-trade-input-ico" aria-hidden="true"><IconLock width={16} height={16} /></span>
              <input
                type="password" dir="ltr" autoComplete="off" spellCheck={false} data-lpignore="true"
                value={session.agentKey} placeholder="0x…"
                onChange={(e) => setSession((s) => ({ ...s, agentKey: e.target.value, connected: false }))}
              />
              {keyOk && <span className="ai-trade-input-mark" aria-hidden="true"><IconCheck width={14} height={14} /></span>}
            </span>
          </label>
        </div>
        {keyError && <p className="ai-trade-error" role="alert">{keyError}</p>}
        {keyOk && shown && <p className="ai-trade-ok">{C.connect.ok} <span className="ai-trade-small" dir="ltr">{C.connect.agentShown}{shown}</span></p>}
        {error && <p className="ai-trade-error" role="alert">{C.account.errors[error] || C.exec.HL_HTTP_ERROR}</p>}
        <div className="ai-trade-actions">
          <button type="button" className="ai-trade-btn ai-trade-btn-primary" disabled={!ready} onClick={onConnect}>
            {busy ? <><span className="ai-trade-spin" aria-hidden="true" />{C.ai.analyzing}</> : <><IconSparkle width={17} height={17} aria-hidden="true" />{C.connect.connectBtn}</>}
          </button>
          <span className="ai-trade-small ai-trade-muted">{C.connect.notStored}</span>
        </div>
      </Card>

      <Card title="راهنمای سریع" kicker="CHECKLIST" icon={<IconSparkle width={18} height={18} />} span="ai-trade-span-2" accent="violet">
        <ol className="ai-trade-steps-list">
          {C.connect.steps.map((t) => <li key={t}>{t}</li>)}
        </ol>
        <div className="ai-trade-note ai-trade-warn" role="note">
          <IconAlertTriangle width={16} height={16} aria-hidden="true" />
          <span>{C.connect.mainKeyWarning}</span>
        </div>
      </Card>
    </div>
  );
}

/* ── step 2: account ────────────────────────────────────────────────────── */
function AccountStep({ session, account, onRefresh, refreshing, dailyLoss, onGo }) {
  if (!session.connected) return <Gate onGo={onGo} />;
  if (!account || !account.ok) {
    return (
      <Card title={C.account.title} icon={<IconWallet width={18} height={18} />} accent="amber">
        <p className="ai-trade-error" role="alert">{C.account.errors[account?.code] || C.account.errors.HL_NETWORK}</p>
        <div className="ai-trade-actions">
          <button type="button" className="ai-trade-btn" onClick={onRefresh} disabled={refreshing}>{C.account.refresh}</button>
        </div>
      </Card>
    );
  }
  const { summary, fills, state, at } = account;
  const used = lossUsed(account, dailyLoss);
  const stale = Date.now() - at > FRESH_MS;
  const equity = Number.isFinite(summary.accountValueUsd) ? summary.accountValueUsd : null;
  const exposureLevel = Number.isFinite(dailyLoss) && dailyLoss > 0 && Number.isFinite(state.currentExposureUsd)
    ? state.currentExposureUsd / (dailyLoss * 10) : NaN;

  return (
    <div className="ai-trade-bento">
      <Kpi label={C.account.equity} value={num(summary.accountValueUsd)} suffix="$" icon={<IconWallet width={14} height={14} />} />
      <Kpi label={C.account.exposure} value={num(state.currentExposureUsd)} suffix="$" level={exposureLevel}
        hint={`قابل برداشت: ${num(summary.withdrawableUsd)}`} icon={<IconChart width={14} height={14} />} />
      <Kpi label={C.account.unrealised} value={signed(state.dailyUnrealisedPnlUsd)} suffix="$" toneName={tone(state.dailyUnrealisedPnlUsd)} />
      <Kpi label={C.account.realisedToday} value={signed(fills.realisedPnlUsd)} suffix="$" toneName={tone(fills.realisedPnlUsd)}
        hint={`${fills.fillCount} پرشدن امروز`} />

      <Card title={C.account.dailyUsed} kicker="RISK BUDGET" icon={<IconShield width={18} height={18} />} span="ai-trade-span-2" accent={used && used.pct >= 70 ? 'down' : 'mint'}>
        <div className="ai-trade-budget">
          <RiskDial
            value={used ? used.pct / 100 : 0}
            label={used ? `${num(used.loss)}$` : '—'}
            caption={used ? `${num(used.loss)} از ${num(dailyLoss)} دلار` : C.account.unknown}
            toneName={used && used.pct >= 70 ? 'down' : 'up'}
          />
          <div className="ai-trade-budget-body">
            <div className="ai-trade-meter" data-warn={used && used.pct >= 70 ? 'true' : 'false'}
              role="progressbar" aria-valuenow={Math.round(used?.pct ?? 0)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${used ? used.pct : 0}%` }} />
            </div>
            <p className="ai-trade-small ai-trade-muted">
              {used ? `${num(used.loss)} از ${num(dailyLoss)} دلار` : C.account.unknown}
            </p>
            <span className="ai-trade-tag" data-tone={used && used.pct >= 70 ? 'down' : 'up'}>
              {used && used.pct >= 70 ? 'نزدیک سقف' : 'در محدودهٔ امن'}
            </span>
          </div>
        </div>
      </Card>

      <Card title={C.account.positions} kicker="OPEN BOOK" icon={<IconWallet width={18} height={18} />} span="ai-trade-span-2"
        action={(
          <button type="button" className="ai-trade-btn ai-trade-btn-ghost ai-trade-btn-sm" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? C.ai.analyzing : C.account.refresh}
          </button>
        )}>
        {summary.positions.length === 0
          ? <p className="ai-trade-muted">{C.account.noPositions}</p>
          : (
            <ul className="ai-trade-rows">
              {summary.positions.map((p) => (
                <li key={p.coin} className="ai-trade-row" data-tone={tone(p.unrealizedPnl)}>
                  <span className="ai-trade-row-lead">
                    <strong>{p.coin}</strong>
                    <span className="ai-trade-tag" data-tone={p.size > 0 ? 'up' : 'down'}>{p.size > 0 ? 'long' : 'short'}</span>
                  </span>
                  <span className="ai-trade-small">{num(Math.abs(p.size))}</span>
                  <span className="ai-trade-small">ورود <b>{num(p.entryPx)}</b></span>
                  <span className="ai-trade-small">uPnL <b>{signed(p.unrealizedPnl)}</b></span>
                </li>
              ))}
            </ul>
          )}
        <p className="ai-trade-small ai-trade-muted ai-trade-stamp">
          <span className="ai-trade-live-dot" aria-hidden="true" />
          {C.account.updated}{timeFa(at)}{stale ? ` · ${C.account.stale}` : ''}
        </p>
      </Card>

      {Number.isFinite(equity) && (
        <p className="ai-trade-strip ai-trade-span-4 ai-trade-small ai-trade-muted">
          این اعداد از حساب Hyperliquid خوانده شده‌اند؛ هر عددی که خوانده نشود «{C.account.unknown}» می‌ماند.
        </p>
      )}
    </div>
  );
}

function Gate({ onGo }) {
  return (
    <Card className="ai-trade-gate" accent="violet" bare>
      <span className="ai-trade-gate-ico" aria-hidden="true"><IconLock width={26} height={26} /></span>
      <p className="ai-trade-muted">{C.needConnect}</p>
      <div className="ai-trade-actions" style={{ justifyContent: 'center' }}>
        <button type="button" className="ai-trade-btn ai-trade-btn-primary" onClick={onGo}>{C.steps.connect}</button>
      </div>
    </Card>
  );
}

/* ── step 3: limits and markets ─────────────────────────────────────────── */
function LimitsStep({ form, setForm, result, markets, marketsError, marketsLoading, onLoadMarkets }) {
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const [query, setQuery] = useState('');
  const eligible = useMemo(() => (markets ? eligibleMarkets(markets, { minVolumeUsd: MIN_MARKET_VOLUME_USD }) : []), [markets]);
  const selected = form.allowedCoins;
  const setCoins = (coins) => setForm((f) => ({ ...f, allowedCoins: coins }));
  const toggle = (coin) => {
    if (selected.includes(coin)) setCoins(selected.filter((c) => c !== coin));
    else if (selected.length < MAX_PICK) setCoins([...selected, coin]);
  };
  const q = query.trim().toUpperCase();
  const shown = eligible.filter((m) => !q || m.coin.toUpperCase().includes(q)).slice(0, 80);
  const current = Number(form.maxLeverage);
  return (
    <div className="ai-trade-bento">
      <Card title={C.limits.title} kicker="GUARDRAILS" icon={<IconShield width={18} height={18} />} span="ai-trade-span-2" accent="cyan">
        <div className="ai-trade-form">
          <label className="ai-trade-field"><span className="ai-trade-field-label">{C.limits.total}</span>
            <span className="ai-trade-input-shell"><input type="number" inputMode="decimal" dir="ltr" value={form.totalExposureUsd} onChange={set('totalExposureUsd')} /></span></label>
          <label className="ai-trade-field"><span className="ai-trade-field-label">{C.limits.perOrder}</span>
            <span className="ai-trade-input-shell"><input type="number" inputMode="decimal" dir="ltr" value={form.maxOrderUsd} onChange={set('maxOrderUsd')} /></span></label>
          <label className="ai-trade-field"><span className="ai-trade-field-label">{C.limits.dailyLoss}</span>
            <span className="ai-trade-input-shell"><input type="number" inputMode="decimal" dir="ltr" value={form.dailyLossUsd} onChange={set('dailyLossUsd')} /></span></label>
          <div className="ai-trade-field">
            <span className="ai-trade-field-label">{C.limits.leverage}</span>
            <div className="ai-trade-chips ai-trade-chips-even" role="radiogroup" aria-label={C.limits.leverage}>
              {LEVERAGE_CHOICES.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={current === n} className="ai-trade-chip"
                  onClick={() => setForm((f) => ({ ...f, maxLeverage: String(n) }))}>{n}x</button>
              ))}
            </div>
          </div>
        </div>
        <p className="ai-trade-small ai-trade-muted">{C.limits.stopRule}</p>
        {!result.ok && result.errors.map((code) => <p key={code} className="ai-trade-error" role="alert">{C.limits.errors[code]}</p>)}
        {result.ok && <p className="ai-trade-ok"><IconCheck width={15} height={15} aria-hidden="true" /> {C.limits.saved}</p>}
      </Card>

      <Card title={C.limits.killSwitch} kicker="CIRCUIT BREAKER" icon={<IconShield width={18} height={18} />} span="ai-trade-span-2" accent={form.killSwitch ? 'down' : 'mint'}>
        <button type="button" role="switch" aria-checked={form.killSwitch} className="ai-trade-kill"
          onClick={() => setForm((f) => ({ ...f, killSwitch: !f.killSwitch }))}>
          <span className="ai-trade-kill-text">
            <span className="ai-trade-kill-state">
              <span className="ai-trade-pulse" aria-hidden="true" />
              <strong>{form.killSwitch ? C.statusLabel.stopped : C.statusLabel.ready}</strong>
            </span>
            <span className="ai-trade-small ai-trade-muted">{C.limits.killSwitchHelp}</span>
          </span>
          <span className="ai-trade-switch" aria-hidden="true" />
        </button>
      </Card>

      <Card title={C.markets.title} kicker="UNIVERSE" icon={<IconChart width={18} height={18} />} span="ai-trade-span-4" accent="violet"
        action={<span className="ai-trade-pill ai-trade-pill-flat">{C.markets.selected}: {selected.length} / {MAX_PICK}</span>}>
        <p className="ai-trade-small ai-trade-muted">{C.markets.hint}</p>
        {!markets && (
          <div className="ai-trade-actions">
            <button type="button" className="ai-trade-btn ai-trade-btn-primary" onClick={onLoadMarkets} disabled={marketsLoading}>
              {marketsLoading ? C.markets.loading : C.markets.load}
            </button>
          </div>
        )}
        {marketsError && <p className="ai-trade-error" role="alert">{C.markets.errors[marketsError] || C.markets.errors.HL_NETWORK}</p>}
        {markets && (
          <>
            <div className="ai-trade-actions">
              <button type="button" className="ai-trade-btn ai-trade-btn-ghost ai-trade-btn-sm" disabled={eligible.length === 0}
                onClick={() => setCoins(eligible.slice(0, 10).map((m) => m.coin))}>{C.markets.top10}</button>
              <button type="button" className="ai-trade-btn ai-trade-btn-ghost ai-trade-btn-sm"
                onClick={() => setCoins(['BTC', 'ETH'].filter((c) => eligible.some((m) => m.coin === c)))}>{C.markets.btcEth}</button>
              <button type="button" className="ai-trade-btn ai-trade-btn-ghost ai-trade-btn-sm" onClick={() => setCoins([])}>{C.markets.clear}</button>
            </div>
            <label className="ai-trade-field">
              <span className="ai-trade-field-label">{C.markets.search}</span>
              <span className="ai-trade-input-shell">
                <input type="search" dir="ltr" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="BTC" />
              </span>
            </label>
            {shown.length === 0
              ? <p className="ai-trade-muted">{C.markets.empty}</p>
              : (
                <div className="ai-trade-market-grid" role="group" aria-label={C.markets.title}>
                  {shown.map((m) => {
                    const on = selected.includes(m.coin);
                    return (
                      <button key={m.coin} type="button" className="ai-trade-market" aria-pressed={on} onClick={() => toggle(m.coin)}
                        title={`${C.markets.volume}: ${volText(m.dayNtlVlm)} · ${C.markets.maxLev} ${m.maxLeverage ?? '–'}x${m.onlyIsolated ? ' · isolated' : ''}`}>
                        <span className="ai-trade-market-coin">
                          <b>{m.coin}</b>
                          <span className="ai-trade-market-check" aria-hidden="true">{on ? '✓' : ''}</span>
                        </span>
                        <span className="ai-trade-market-meta">
                          <small>{volText(m.dayNtlVlm)}</small>
                          <small>{m.maxLeverage ?? '–'}x</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
          </>
        )}
      </Card>
    </div>
  );
}

/* ── step 4: AI and rules ───────────────────────────────────────────────── */
function AiStep({ session, setSession, rules, setRules, onAnalyze, analyzing, gate, lastRun }) {
  const setS = (key) => (e) => setSession((s) => ({ ...s, [key]: e.target.value }));
  const setR = (key) => (e) => setRules((r) => normalizeRules({ ...r, [key]: e.target.value }));
  return (
    <div className="ai-trade-bento">
      <Card title={C.ai.title} kicker="ANALYST · BYOK" icon={<IconSparkle width={18} height={18} />} span="ai-trade-span-2" accent="violet">
        <div className="ai-trade-form">
          <label className="ai-trade-field ai-trade-field-wide"><span className="ai-trade-field-label">{C.ai.keyLabel}</span>
            <span className="ai-trade-input-shell">
              <span className="ai-trade-input-ico" aria-hidden="true"><IconKey width={16} height={16} /></span>
              <input type="password" dir="ltr" autoComplete="off" spellCheck={false} data-lpignore="true" value={session.aiKey} onChange={setS('aiKey')} placeholder="sk-…" />
            </span>
          </label>
          <label className="ai-trade-field"><span className="ai-trade-field-label">{C.ai.modelLabel}</span>
            <span className="ai-trade-input-shell"><input type="text" dir="ltr" autoComplete="off" value={session.aiModel} onChange={setS('aiModel')} placeholder="model-name" /></span></label>
        </div>
        <p className="ai-trade-small ai-trade-muted">{C.ai.keyHelp}</p>
        <details className="ai-trade-adv">
          <summary>تنظیمات پیشرفته</summary>
          <label className="ai-trade-field" style={{ marginTop: 10 }}><span className="ai-trade-field-label">{C.ai.endpointLabel}</span>
            <span className="ai-trade-input-shell"><input type="url" dir="ltr" value={session.aiEndpoint} onChange={setS('aiEndpoint')} /></span></label>
        </details>
        <div className="ai-trade-actions">
          <button type="button" className="ai-trade-btn ai-trade-btn-primary" onClick={onAnalyze} disabled={analyzing || !!gate}>
            {analyzing
              ? <><span className="ai-trade-spin" aria-hidden="true" />{C.ai.analyzing}</>
              : <><IconSparkle width={18} height={18} aria-hidden="true" /> {C.ai.analyze}</>}
          </button>
          {gate && <span className="ai-trade-small ai-trade-muted">{gate}</span>}
        </div>
        {lastRun && <p className={lastRun.tone === 'error' ? 'ai-trade-error' : 'ai-trade-ok'} role="status">{lastRun.text}</p>}
      </Card>

      <Card title={C.ai.strategyTitle} kicker="PLAYBOOK" icon={<IconChart width={18} height={18} />} span="ai-trade-span-2" accent="cyan">
        <div className="ai-trade-seg" role="radiogroup" aria-label={C.ai.strategyTitle}>
          {STRATEGIES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={rules.strategy === s}
              onClick={() => setRules((r) => ({ ...r, strategy: s }))}>{C.ai.strategies[s]}</button>
          ))}
        </div>
        <div className="ai-trade-form">
          <label className="ai-trade-field"><span className="ai-trade-field-label">{C.ai.maxTrades}</span>
            <span className="ai-trade-input-shell"><input type="number" dir="ltr" min={1} max={10} value={rules.maxTradesPerDay} onChange={setR('maxTradesPerDay')} /></span></label>
          <label className="ai-trade-field"><span className="ai-trade-field-label">{C.ai.cooldown}</span>
            <span className="ai-trade-input-shell"><input type="number" dir="ltr" min={0} max={1440} value={rules.cooldownMinutes} onChange={setR('cooldownMinutes')} /></span></label>
          <label className="ai-trade-field ai-trade-field-wide"><span className="ai-trade-field-label">{C.ai.notes}</span>
            <span className="ai-trade-input-shell"><textarea value={rules.notes} maxLength={300} onChange={setR('notes')} placeholder={C.ai.notesHint} /></span></label>
        </div>
        <p className="ai-trade-small ai-trade-muted">{C.ai.none}</p>
      </Card>
    </div>
  );
}

/* ── step 5: approve ────────────────────────────────────────────────────── */
function PendingCard({ item, onApprove, onReject, now }) {
  const { intent, preview } = item;
  const expired = item.status === 'pending' && now > item.expiresAt;
  const status = expired ? 'expired' : item.status;
  const secs = Math.max(0, Math.ceil((item.expiresAt - now) / 1000));
  const ttl = clamp01((item.expiresAt - now) / 60000);
  const blockers = [];
  if (!preview.capsOk && preview.capsCode) blockers.push(C.approve.errors[preview.capsCode] || preview.capsCode);
  if (!preview.rulesOk && preview.rulesCode) blockers.push(C.approve.errors[preview.rulesCode] || preview.rulesCode);
  const canHold = status === 'pending' && preview.canApprove && !expired;
  /* worst-case loss as a share of the notional, so the dial means the same
     thing on a 20$ ticket and a 2,000$ one. */
  const risk = Number.isFinite(preview.worstCaseLossUsd) && intent.notionalUsd > 0
    ? clamp01(preview.worstCaseLossUsd / intent.notionalUsd) : 0;
  return (
    <section className="ai-trade-card ai-trade-ticket" data-state={status} data-side={intent.side} data-accent={intent.side === 'long' ? 'up' : 'down'}>
      <span className="ai-trade-ticket-ribbon" aria-hidden="true" />
      <div className="ai-trade-card-head">
        <div className="ai-trade-ticket-head">
          <span className="ai-trade-side" data-side={intent.side}>{intent.coin} · {C.approve.side[intent.side]}</span>
          <span className="ai-trade-pill" data-tone={status === 'executed' ? 'ready' : status === 'failed' ? 'stopped' : undefined}>{C.approve.statusLabels[status]}</span>
        </div>
        {status === 'pending' && (
          <span className="ai-trade-ttl-ring" style={{ '--p': ttl }} title={`${secs}s`} aria-hidden="true">
            <span className="ai-trade-ttl-ring-face"><b>{secs}</b><small>s</small></span>
          </span>
        )}
      </div>

      <div className="ai-trade-ticket-body">
        <div className="ai-trade-ticket-hero">
          <span className="ai-trade-ticket-notional">
            <b>{num(intent.notionalUsd)}</b><small>$</small>
          </span>
          <span className="ai-trade-ticket-lev">{intent.leverage}x</span>
        </div>

        <dl className="ai-trade-facts">
          <div><dt>{C.approve.labels.marketMax}</dt><dd>{preview.marketMaxLeverage ? `${preview.marketMaxLeverage}x` : C.account.unknown}</dd></div>
          <div><dt>{C.approve.labels.margin}</dt><dd>{num(preview.marginUsd)}$</dd></div>
          <div><dt>{C.approve.labels.stop}</dt><dd>{preview.estimatedStopPx ? `${num(preview.estimatedStopPx)} (${(intent.stopLossPct * 100).toFixed(1)}%)` : C.account.unknown}</dd></div>
          <div><dt>{C.approve.labels.worst}</dt><dd className="ai-trade-ticket-worst">{num(preview.worstCaseLossUsd)}$</dd></div>
        </dl>

        <div className="ai-trade-ticket-risk">
          <RiskDial value={risk} label="ریسک" toneName={risk >= 0.6 ? 'down' : 'up'} />
          <div className="ai-trade-ticket-risk-body">
            {intent.rationale
              ? (
                <blockquote className="ai-trade-quote">
                  <span className="ai-trade-quote-k">{C.approve.labels.rationale}</span>
                  {intent.rationale}
                </blockquote>
              )
              : <p className="ai-trade-small ai-trade-muted">—</p>}
            {blockers.length > 0 && (
              <div className="ai-trade-blocked" role="alert">
                <IconAlertTriangle width={15} height={15} aria-hidden="true" />
                <span>{C.approve.blockedBy}<br />{blockers.join(' · ')}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {status === 'pending' && (
        <div className="ai-trade-actions ai-trade-ticket-actions">
          <HoldButton onConfirm={() => onApprove(item.id)} disabled={!canHold} label={`${C.approve.hold}: ${intent.coin}`}>
            <IconCheck width={18} height={18} aria-hidden="true" /> {C.approve.hold}
          </HoldButton>
          <HoldButton kind="reject" onConfirm={() => onReject(item.id)} label={C.approve.reject}>{C.approve.reject}</HoldButton>
        </div>
      )}
      {status === 'pending' && <p className="ai-trade-small ai-trade-muted">{C.approve.holdHint}</p>}
      {status === 'executing' && <p className="ai-trade-muted" role="status"><span className="ai-trade-spin" aria-hidden="true" />{C.approve.working}</p>}
      {item.resultText && <p className={item.failed ? 'ai-trade-error' : 'ai-trade-ok'} role="status">{item.resultText}</p>}
      {expired && <p className="ai-trade-small ai-trade-muted">{C.approve.expired}</p>}
    </section>
  );
}

function ApproveStep({ pending, onApprove, onReject }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    /* A hold-timer display. Gated like every other ticker in the app: a hidden
       tab has no clock on screen, and coming back ticks immediately, so the
       first frame a user sees is the correct remaining time. */
    return pollWhileVisible(() => setNow(Date.now()), 1000);
  }, []);
  if (pending.length === 0) {
    return (
      <Card accent="violet" bare className="ai-trade-empty">
        <span className="ai-trade-empty-ico" aria-hidden="true"><IconCheck width={22} height={22} /></span>
        <p className="ai-trade-muted">{C.approve.empty}</p>
        <p className="ai-trade-small ai-trade-muted">{C.approve.holdHint}</p>
      </Card>
    );
  }
  return (
    <div className="ai-trade-bento">
      {pending.map((item) => (
        <div key={item.id} className="ai-trade-span-2">
          <PendingCard item={item} onApprove={onApprove} onReject={onReject} now={now} />
        </div>
      ))}
    </div>
  );
}

/* ── step 6: report ─────────────────────────────────────────────────────── */
function ReportStep({ ledger, account, onRefresh, refreshing }) {
  const executed = ledger.entries.filter((e) => e.status === 'executed');
  const fills = account?.ok ? account.fills : null;
  const rejected = ledger.entries.filter((e) => e.status === 'rejected').length;
  const failed = ledger.entries.filter((e) => e.status === 'failed').length;
  return (
    <div className="ai-trade-bento">
      <Kpi label={C.report.executed} value={String(executed.length)} icon={<IconCheck width={14} height={14} />} />
      <Kpi label={C.report.realised} value={signed(fills?.realisedPnlUsd)} suffix="$" toneName={tone(fills?.realisedPnlUsd)} />
      <Kpi label={C.report.fees} value={num(fills?.feesUsd)} suffix="$" />
      <Kpi label={C.report.fills} value={String(fills?.fillCount ?? C.account.unknown)} />
      <Card title={C.report.title} kicker="SESSION LEDGER" icon={<IconDoc width={18} height={18} />} span="ai-trade-span-4" accent="cyan"
        action={<button type="button" className="ai-trade-btn ai-trade-btn-ghost ai-trade-btn-sm" onClick={onRefresh} disabled={refreshing}>{C.report.refresh}</button>}>
        {(rejected + failed) > 0 && (
          <div className="ai-trade-ledger-sum">
            <span className="ai-trade-tag" data-tone="up">{C.approve.statusLabels.executed}: {executed.length}</span>
            <span className="ai-trade-tag" data-tone="down">{C.approve.statusLabels.rejected}: {rejected}</span>
            <span className="ai-trade-tag" data-tone="down">{C.approve.statusLabels.failed}: {failed}</span>
          </div>
        )}
        {ledger.entries.length === 0
          ? <p className="ai-trade-muted">{C.report.empty}</p>
          : (
            <ul className="ai-trade-timeline">
              {[...ledger.entries].reverse().map((e) => (
                <li key={e.id} className="ai-trade-tl" data-tone={e.status === 'executed' ? 'up' : e.status === 'failed' ? 'down' : undefined}>
                  <span className="ai-trade-tl-node" aria-hidden="true" />
                  <div className="ai-trade-tl-body">
                    <span className="ai-trade-tl-head">
                      <strong>{e.coin}</strong>
                      <span className="ai-trade-tag" data-tone={e.status === 'executed' ? 'up' : e.status === 'failed' ? 'down' : undefined}>
                        {C.approve.statusLabels[e.status]}
                      </span>
                      <span className="ai-trade-tl-time">{timeFa(e.at)}</span>
                    </span>
                    <span className="ai-trade-small ai-trade-muted">
                      {C.approve.side[e.side]} · {num(e.notionalUsd)}$
                      {e.entryPx ? ` · ${C.report.entryLine}${num(e.entryPx)}` : ''}
                      {e.stopPx ? ` · ${C.report.stopLine}${num(e.stopPx)}` : ''}
                    </span>
                    {e.message && <span className="ai-trade-small ai-trade-error">{e.message}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        <p className="ai-trade-small ai-trade-muted">{C.report.disclaimer}</p>
      </Card>
    </div>
  );
}

/* ── the room ─────────────────────────────────────────────────────────────
 * Painted, aria-hidden, pointer-events: none. Four layers: aurora, mesh,
 * sweep, grain. Lite mode drops the moving ones; nothing here is data.
 */
function Room() {
  return (
    <div className="ai-trade-room" aria-hidden="true">
      <span className="ai-trade-room-aurora" />
      <span className="ai-trade-room-mesh" />
      <span className="ai-trade-room-sweep" />
      <span className="ai-trade-room-grain" />
    </div>
  );
}

/* The neural core: two orbits, a halo, a glyph. The tone mirrors the session
   state, so the hero answers "is this thing armed?" before any word does. */
function Core({ tone: coreTone }) {
  return (
    <div className="ai-trade-core" data-tone={coreTone} aria-hidden="true">
      <span className="ai-trade-core-halo" />
      <span className="ai-trade-core-orbit" />
      <span className="ai-trade-core-orbit ai-trade-core-orbit-2" />
      <span className="ai-trade-core-orb"><IconSparkle width={22} height={22} /></span>
    </div>
  );
}

/* ── the tab ────────────────────────────────────────────────────────────── */
export default function AiTradePanel() {
  const [step, setStep] = useState('connect');
  const [session, setSession] = useState(EMPTY_SESSION);
  const [lockNotice, setLockNotice] = useState('');
  const [capsForm, setCapsForm] = useState(formFromDefaults);
  const capsResult = useMemo(() => validateCapsSettings(capsForm), [capsForm]);
  const [rules, setRules] = useState(() => normalizeRules(RULE_DEFAULTS));
  const [account, setAccount] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connectError, setConnectError] = useState(null);
  const [ledger, setLedger] = useState(createLedger);
  const [pending, setPending] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const nextNonce = useRef(makeNonceSource());
  const [markets, setMarkets] = useState(null);
  const [marketsError, setMarketsError] = useState(null);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const analysisRound = useRef(0);

  const loadMarkets = async () => {
    setMarketsLoading(true);
    setMarketsError(null);
    const res = await fetchMarkets();
    setMarketsLoading(false);
    if (!res.ok) { setMarketsError(res.code); return { ok: false, code: res.code }; }
    setMarkets(res.markets);
    return { ok: true, markets: res.markets };
  };
  useEffect(() => {
    if (step === 'limits' && !markets && !marketsLoading) loadMarkets();
    // loads once when the limits step opens; the button retries after an error
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const hasSecrets = !!(session.agentKey || session.aiKey);
  const lock = (notice = '') => {
    setSession((s) => ({ ...EMPTY_SESSION, aiEndpoint: s.aiEndpoint || AI_DEFAULT_ENDPOINT }));
    setAccount(null);
    setPending([]);
    setLockNotice(notice);
  };

  // Auto-lock: idle for 10 minutes, or hidden for 2 minutes.
  useEffect(() => {
    if (!hasSecrets) return undefined;
    let idle = null;
    let hidden = null;
    const reset = () => {
      clearTimeout(idle);
      idle = setTimeout(() => lock(C.autoLock), IDLE_LOCK_MS);
    };
    const onVis = () => {
      clearTimeout(hidden);
      if (document.hidden) hidden = setTimeout(() => lock(C.autoLock), HIDDEN_LOCK_MS);
    };
    reset();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(idle);
      clearTimeout(hidden);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [hasSecrets]);

  const killed = capsResult.ok && capsResult.value.killSwitch;
  const aiReady = !!session.aiKey && !!session.aiModel.trim();
  const status = !session.connected && !hasSecrets ? 'locked'
    : killed ? 'stopped'
      : session.connected && capsResult.ok && aiReady ? 'ready'
        : 'connected';
  const statusText = C.statusLabel[status];
  const statusTone = status === 'locked' ? undefined : status;

  const refresh = async () => {
    if (!session.connected) return null;
    setRefreshing(true);
    const fresh = await readFresh(session.address.trim());
    setRefreshing(false);
    setAccount(fresh.ok ? fresh : { ok: false, code: fresh.code, at: Date.now() });
    return fresh;
  };

  const connect = async () => {
    setConnectError(null);
    setRefreshing(true);
    const fresh = await readFresh(session.address.trim());
    setRefreshing(false);
    if (!fresh.ok) { setConnectError(fresh.code); return; }
    setSession((s) => ({ ...s, connected: true }));
    setAccount(fresh);
    loadMarkets();
    setStep('account');
  };

  const setPendingItem = (id, patch) => setPending((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const approve = async (id) => {
    const item = pending.find((p) => p.id === id);
    const gate = item && approvePending(item, { now: Date.now() });
    if (!item || !gate.ok) { setPendingItem(id, { status: 'expired' }); return; }
    setPendingItem(id, { status: 'executing', resultText: null });
    const now = Date.now();
    const coin = item.intent.coin;
    const fail = (message, code) => {
      setPendingItem(id, { status: 'failed', failed: true, resultText: message });
      setLedger((l) => recordEntry(l, { id, at: now, coin, side: item.intent.side, notionalUsd: item.intent.notionalUsd, status: 'failed', message, code }));
    };
    // Everything the decision needs is read again right now, not taken from the analysis time.
    const fresh = await readFresh(session.address.trim(), now);
    if (!fresh.ok) { fail(C.account.errors[fresh.code] || C.exec.HL_EXEC_NETWORK, fresh.code); return; }
    setAccount(fresh);
    const mk = await loadMarkets();
    if (!mk.ok) { fail(C.markets.errors[mk.code] || C.exec.HL_EXEC_NETWORK, mk.code); return; }
    const market = mk.markets[coin];
    const mid = market ? (market.midPx ?? market.markPx ?? 0) : 0;
    const preview = buildPreview(item.intent, {
      mid, caps: capsResult.value, state: fresh.state, rules,
      tradesToday: tradesSince(ledger, startOfLocalDay(now)), lastTradeAtByCoin: lastTradeTimes(ledger), now, market
    });
    if (!preview.canApprove) {
      const code = !preview.capsOk ? preview.capsCode : !preview.rulesOk ? preview.rulesCode : !preview.marketOk ? preview.marketCode : 'NO_PRICE';
      fail(C.approve.errors[code] || C.exec.HL_EXEC_NO_PRICE, code);
      return;
    }
    const report = await executeIntent({
      privateKey: session.agentKey.trim(), intent: item.intent, market, mid,
      caps: capsResult.value, state: fresh.state, nextNonce: nextNonce.current
    });
    const filled = !!report.entry;
    const entryPx = report.entry?.avgPx ?? null;
    const stopPx = report.stop?.triggerPx ?? null;
    const message = report.ok ? null : (C.exec[report.code] || C.exec.HL_EXEC_REJECTED);
    setLedger((l) => recordEntry(l, {
      id, at: now, coin, side: item.intent.side, notionalUsd: item.intent.notionalUsd,
      status: filled ? 'executed' : 'failed', code: report.code, message, entryPx, stopPx
    }));
    setPendingItem(id, report.ok
      ? { status: 'executed', resultText: `اجرا شد. ورود ${num(entryPx)} · حد ضرر ${num(stopPx)}` }
      : { status: filled ? 'executed' : 'failed', failed: !filled || !report.stop, resultText: message });
    refresh();
  };

  const reject = (id) => {
    setPendingItem(id, { status: 'rejected' });
    const item = pending.find((p) => p.id === id);
    if (item) setLedger((l) => recordEntry(l, { id, at: Date.now(), coin: item.intent.coin, side: item.intent.side, notionalUsd: item.intent.notionalUsd, status: 'rejected' }));
  };

  const analyze = async () => {
    if (!aiReady) { setLastRun({ tone: 'error', text: C.ai.needAi }); return; }
    if (!capsResult.ok) { setLastRun({ tone: 'error', text: C.limits.errors[capsResult.errors[0]] || C.ai.needFresh }); return; }
    setAnalyzing(true);
    const now = Date.now();
    const fresh = await readFresh(session.address.trim(), now);
    if (!fresh.ok) { setAnalyzing(false); setLastRun({ tone: 'error', text: C.account.errors[fresh.code] || C.account.errors.HL_NETWORK }); return; }
    setAccount(fresh);
    const mk = await loadMarkets();
    if (!mk.ok) { setAnalyzing(false); setLastRun({ tone: 'error', text: C.markets.errors[mk.code] || C.markets.errors.HL_NETWORK }); return; }
    const caps = capsResult.value;
    // Allowed AND liquid, busiest first. Each run takes the next batch, so repeated runs cover more pairs.
    const pool = eligibleMarkets(mk.markets, { minVolumeUsd: MIN_MARKET_VOLUME_USD })
      .map((m) => m.coin).filter((c) => caps.allowedCoins.includes(c));
    if (pool.length === 0) { setAnalyzing(false); setLastRun({ tone: 'error', text: C.markets.noneAllowed }); return; }
    const offset = (analysisRound.current * TOP_ANALYSIS_COINS) % pool.length;
    analysisRound.current += 1;
    const batch = [...pool.slice(offset), ...pool.slice(0, offset)].slice(0, TOP_ANALYSIS_COINS);
    const candleSets = await Promise.all(batch.map((c) => fetchCandles(c, { interval: '1h', count: 48, now })));
    const candles = Object.fromEntries(batch.map((c, i) => [c, candleSets[i].ok ? candleSets[i].candles : []]));
    const mids = Object.fromEntries(batch.map((c) => [c, mk.markets[c].midPx ?? mk.markets[c].markPx ?? null]));
    const aiCaps = { ...caps, allowedCoins: batch };
    const messages = buildAnalystMessages({
      rules, caps: aiCaps,
      account: { accountValueUsd: fresh.summary.accountValueUsd, exposureUsd: fresh.state.currentExposureUsd, dailyRealisedPnlUsd: fresh.state.dailyRealisedPnlUsd, dailyUnrealisedPnlUsd: fresh.state.dailyUnrealisedPnlUsd, positions: fresh.summary.positions.map((p) => ({ coin: p.coin, size: p.size, entryPx: p.entryPx, unrealizedPnl: p.unrealizedPnl })) },
      mids, candles
    });
    const res = await requestProposals({
      apiKey: session.aiKey.trim(), endpoint: session.aiEndpoint.trim(), model: session.aiModel.trim(), messages,
      limits: { allowedCoins: batch, maxLeverage: caps.maxLeverage, maxStopLossPct: caps.maxStopLossPct }
    });
    setAnalyzing(false);
    if (!res.ok) { setLastRun({ tone: 'error', text: C.ai.errors[res.code] || C.ai.errors.AI_NETWORK }); return; }
    if (res.proposals.length === 0) { setLastRun({ tone: 'ok', text: C.ai.none }); return; }
    const tradesToday = tradesSince(ledger, startOfLocalDay(now));
    const lastAt = lastTradeTimes(ledger);
    const items = res.proposals.map((intent, i) => {
      const market = mk.markets[intent.coin];
      const preview = buildPreview(intent, {
        mid: market ? (market.midPx ?? market.markPx ?? 0) : 0, caps, state: fresh.state, rules,
        tradesToday, lastTradeAtByCoin: lastAt, now, market
      });
      return createPending(intent, preview, { id: `${now}-${i}`, now });
    });
    setPending((list) => [...items, ...list].slice(0, 20));
    setLastRun({ tone: 'ok', text: `${C.ai.done}${res.dropped.length ? ` ${C.ai.dropped}` : ''}` });
    setStep('approve');
  };

  const stepDone = {
    connect: session.connected,
    limits: capsResult.ok,
    ai: aiReady,
    approve: ledger.entries.some((e) => e.status === 'executed'),
    report: false
  };
  const analyzeGate = !session.connected ? C.needConnect
    : !aiReady ? C.ai.needAi
      : !capsResult.ok ? C.ai.needFresh
        : killed ? C.limits.killSwitchHelp
          : null;
  const dailyLoss = capsResult.ok ? capsResult.value.dailyLossUsd : Number(capsForm.dailyLossUsd);
  const stepIndex = STEPS.indexOf(step);
  const waitingApprovals = pending.filter((p) => p.status === 'pending').length;

  /* the hero's vitals: only what has actually been read */
  const vitals = [
    { k: 'مرحله', v: `${stepIndex + 1}/${STEPS.length}` },
    { k: 'ارزش حساب', v: account?.ok ? `${num(account.summary.accountValueUsd)}$` : C.account.unknown },
    { k: 'پوزیشن باز', v: account?.ok ? `${num(account.state.currentExposureUsd)}$` : C.account.unknown },
    { k: 'در صف تأیید', v: String(waitingApprovals) }
  ];

  return (
    <section className="ai-trade" aria-label={AI_TRADE_TAB_LABEL} data-status={status}>
      <Room />

      <header className="ai-trade-hero">
        <Core tone={status} />
        <div className="ai-trade-hero-text">
          <span className="ai-trade-eyebrow">
            <span className="ai-trade-eyebrow-line" aria-hidden="true" />
            FBT · NEURAL DESK
          </span>
          <h1 className="ai-trade-title">{C.title}</h1>
          <p className="ai-trade-sub">{C.subtitle}</p>
        </div>
        <div className="ai-trade-hero-side">
          <span className="ai-trade-pill" data-tone={statusTone}>{statusText}</span>
          <span className="ai-trade-hero-risk">
            <IconShield width={14} height={14} aria-hidden="true" />
            {C.riskNotice}
          </span>
        </div>

        <ul className="ai-trade-vitals">
          {vitals.map((x) => (
            <li key={x.k}>
              <span className="ai-trade-vitals-k">{x.k}</span>
              <span className="ai-trade-vitals-v">{x.v}</span>
            </li>
          ))}
        </ul>
      </header>

      {lockNotice && (
        <div className="ai-trade-note ai-trade-warn" role="status">
          <IconAlertTriangle width={16} height={16} aria-hidden="true" />
          <span>{lockNotice}</span>
        </div>
      )}

      <nav className="ai-trade-rail" role="tablist" aria-label={AI_TRADE_TAB_LABEL}>
        {STEPS.map((id, i) => {
          const Icon = STEP_ICONS[id];
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`ai-tab-${id}`}
              aria-selected={step === id}
              aria-controls={`ai-panel-${id}`}
              className="ai-trade-step"
              data-done={stepDone[id] ? 'true' : 'false'}
              data-pos={i <= stepIndex ? 'past' : 'ahead'}
              onClick={() => setStep(id)}
            >
              <span className="ai-trade-step-node" aria-hidden="true">
                <span className="ai-trade-step-n">{stepDone[id] ? '✓' : i + 1}</span>
                <span className="ai-trade-step-ico"><Icon width={16} height={16} /></span>
              </span>
              <span className="ai-trade-step-label">{C.steps[id]}</span>
              {id === 'approve' && waitingApprovals > 0 && (
                <span className="ai-trade-step-badge" aria-hidden="true">{waitingApprovals}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="ai-trade-stage" role="tabpanel" id={`ai-panel-${step}`} aria-labelledby={`ai-tab-${step}`} key={step}>
        {step === 'connect' && (
          <ConnectStep session={session} setSession={setSession} onConnect={connect} busy={refreshing} error={connectError} />
        )}
        {step === 'account' && (
          <AccountStep session={session} account={account} onRefresh={refresh} refreshing={refreshing} dailyLoss={dailyLoss} onGo={() => setStep('connect')} />
        )}
        {step === 'limits' && (
          <LimitsStep form={capsForm} setForm={setCapsForm} result={capsResult} markets={markets}
            marketsError={marketsError} marketsLoading={marketsLoading} onLoadMarkets={loadMarkets} />
        )}
        {step === 'ai' && (
          <AiStep session={session} setSession={setSession} rules={rules} setRules={setRules}
            onAnalyze={analyze} analyzing={analyzing} gate={analyzeGate} lastRun={lastRun} />
        )}
        {step === 'approve' && <ApproveStep pending={pending} onApprove={approve} onReject={reject} />}
        {step === 'report' && (
          <ReportStep ledger={ledger} account={account} onRefresh={refresh} refreshing={refreshing} />
        )}
      </div>

      <footer className="ai-trade-console">
        <span className="ai-trade-console-state" data-tone={statusTone}>
          <span className="ai-trade-pulse" aria-hidden="true" />
          <span className="ai-trade-small">{C.steps[step]}</span>
        </span>
        <span className="ai-trade-console-bar" aria-hidden="true">
          <span style={{ '--p': stepIndex / (STEPS.length - 1) }} />
        </span>
        {session.connected ? (
          <button type="button" className="ai-trade-btn ai-trade-btn-ghost ai-trade-btn-sm" onClick={() => lock(C.lockNotice)}>
            <IconLock width={16} height={16} aria-hidden="true" /> {C.lockNow}
          </button>
        ) : (
          <span className="ai-trade-small ai-trade-muted">{C.connect.notStored}</span>
        )}
      </footer>
    </section>
  );
}
