/**
 * «AI ترید» — the tab on /perp. Six steps, one on screen at a time:
 *   1 اتصال      — public address + agent key (format check, session memory only)
 *   2 حساب       — live account, exposure, today's realised and open PnL
 *   3 سقف‌ها     — per-order, total, daily loss, leverage, markets, kill switch
 *   4 تحلیل       — BYOK AI proposes intents; the user's rules shape the prompt
 *   5 تأیید       — every intent is previewed; executes only after a 500 ms hold
 *   6 گزارش       — this session's record, plus realised PnL from Hyperliquid
 *
 * The AI never sends anything. Keys live only in this component's state and
 * are wiped on lock, after 10 minutes idle, or 2 minutes hidden.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconLock, IconSparkle, IconCheck, IconShield } from '../Icons';
import { validateAgentKeyFormat } from '../../lib/hyperliquid/agentKey';
import { agentAddress } from '../../lib/hyperliquid/signing';
import { isValidHlAddress, readAccountSummary, fetchHyperliquidInfo } from '../../lib/hyperliquid/readonly';
import { defaultCapsSettings, validateCapsSettings } from '../../lib/hyperliquid/capsSettings';
import { fetchMeta, fetchCandles, fetchRealisedSince } from '../../lib/hyperliquid/market';
import { executeIntent, makeNonceSource } from '../../lib/hyperliquid/exchangeOps';
import {
  normalizeRules, buildPreview, createPending, approvePending, createLedger, recordEntry,
  tradesSince, lastTradeTimes, startOfLocalDay, evaluateRules, STRATEGIES, RULE_DEFAULTS
} from '../../lib/hyperliquid/engine';
import { requestProposals, buildAnalystMessages, AI_DEFAULT_ENDPOINT } from '../../lib/hyperliquid/aiClient';
import { AI_TRADE_COPY as C, AI_TRADE_TAB_LABEL } from '../../lib/hyperliquid/aiTradeCopy';
import '../../styles/ai-trade.css';

const STEPS = ['connect', 'account', 'limits', 'ai', 'approve', 'report'];
const FRESH_MS = 120000;
const IDLE_LOCK_MS = 10 * 60000;
const HIDDEN_LOCK_MS = 2 * 60000;
const HOLD_MS = 500;
const LEVERAGE_CHOICES = [1, 2, 3, 5, 10];
const COINS = ['BTC', 'ETH'];

const EMPTY_SESSION = Object.freeze({ address: '', agentKey: '', aiKey: '', aiEndpoint: AI_DEFAULT_ENDPOINT, aiModel: '', connected: false });

const num = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : C.account.unknown);
const signed = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : C.account.unknown);
const tone = (v) => (Number.isFinite(v) ? (v >= 0 ? 'up' : 'down') : undefined);
const timeFa = (t) => new Date(t).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

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

/* ── hold to confirm ──────────────────────────────────────────────────── */
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
      {children}
    </button>
  );
}

function Card({ title, action, children, className = '', span = '' }) {
  return (
    <section className={`ai-trade-card ${span} ${className}`.trim()}>
      {(title || action) && (
        <header className="ai-trade-card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

function Kpi({ label, value, toneName, hint }) {
  return (
    <div className="ai-trade-kpi">
      <span className="ai-trade-kpi-label">{label}</span>
      <span className="ai-trade-kpi-value" data-tone={toneName}>{value}</span>
      {hint && <span className="ai-trade-small ai-trade-muted">{hint}</span>}
    </div>
  );
}

/* ── step 1: connect ──────────────────────────────────────────────────── */
function ConnectStep({ session, setSession, onConnect, busy, error }) {
  const addressOk = isValidHlAddress(session.address.trim());
  const keyCheck = session.agentKey ? validateAgentKeyFormat(session.agentKey) : null;
  const keyOk = keyCheck?.ok === true;
  let shown = null;
  if (keyOk) { try { const a = agentAddress(session.agentKey.trim()); shown = `${a.slice(0, 6)}…${a.slice(-4)}`; } catch { shown = null; } }
  const keyError = keyCheck && !keyCheck.ok ? C.connect.errors[keyCheck.code] || C.connect.errors.AGENT_KEY_BAD_FORMAT : null;

  return (
    <div className="ai-trade-bento">
      <Card title={C.connect.title} span="ai-trade-span-2">
        <p className="ai-trade-muted">{C.connect.help}</p>
        <div className="ai-trade-form">
          <label className="ai-trade-field ai-trade-field-wide"><span>{C.connect.addressLabel}</span>
            <input
              type="text" inputMode="text" dir="ltr" autoComplete="off" spellCheck={false}
              value={session.address} placeholder="0x…"
              onChange={(e) => setSession((s) => ({ ...s, address: e.target.value, connected: false }))}
            /></label>
          <label className="ai-trade-field ai-trade-field-wide"><span>{C.connect.keyLabel}</span>
            <input
              type="password" dir="ltr" autoComplete="off" spellCheck={false} data-lpignore="true"
              value={session.agentKey} placeholder="0x…"
              onChange={(e) => setSession((s) => ({ ...s, agentKey: e.target.value, connected: false }))}
            /></label>
        </div>
        {keyError && <p className="ai-trade-error" role="alert">{keyError}</p>}
        {keyOk && shown && <p className="ai-trade-ok">{C.connect.ok} <span className="ai-trade-small" dir="ltr">{C.connect.agentShown}{shown}</span></p>}
        {error && <p className="ai-trade-error" role="alert">{C.account.errors[error] || C.exec.HL_HTTP_ERROR}</p>}
        <div className="ai-trade-actions">
          <button type="button" className="ai-trade-btn ai-trade-btn-primary" disabled={!addressOk || !keyOk || busy} onClick={onConnect}>
            {busy ? C.ai.analyzing : C.connect.connectBtn}
          </button>
          <span className="ai-trade-small ai-trade-muted">{C.connect.notStored}</span>
        </div>
      </Card>

      <Card title="راهنمای سریع" span="ai-trade-span-2">
        <ol className="ai-trade-steps-list">{C.connect.steps.map((t) => <li key={t}>{t}</li>)}</ol>
        <div className="ai-trade-note ai-trade-warn" role="note">{C.connect.mainKeyWarning}</div>
      </Card>
    </div>
  );
}

/* ── step 2: account ──────────────────────────────────────────────────── */
function AccountStep({ session, account, onRefresh, refreshing, dailyLoss, onGo }) {
  if (!session.connected) return <Gate onGo={onGo} />;
  if (!account || !account.ok) {
    return (
      <Card title={C.account.title}>
        <p className="ai-trade-error" role="alert">{C.account.errors[account?.code] || C.account.errors.HL_NETWORK}</p>
        <div className="ai-trade-actions"><button type="button" className="ai-trade-btn" onClick={onRefresh} disabled={refreshing}>{C.account.refresh}</button></div>
      </Card>
    );
  }
  const { summary, fills, state, at } = account;
  const used = lossUsed(account, dailyLoss);
  const stale = Date.now() - at > FRESH_MS;
  return (
    <div className="ai-trade-bento">
      <Kpi label={C.account.equity} value={num(summary.accountValueUsd)} />
      <Kpi label={C.account.exposure} value={num(state.currentExposureUsd)} hint={`قابل برداشت: ${num(summary.withdrawableUsd)}`} />
      <Kpi label={C.account.unrealised} value={signed(state.dailyUnrealisedPnlUsd)} toneName={tone(state.dailyUnrealisedPnlUsd)} />
      <Kpi label={C.account.realisedToday} value={signed(fills.realisedPnlUsd)} toneName={tone(fills.realisedPnlUsd)} hint={`${fills.fillCount} پرشدن امروز`} />

      <Card title={C.account.dailyUsed} span="ai-trade-span-2">
        <div className="ai-trade-meter" data-warn={used && used.pct >= 70 ? 'true' : 'false'} role="progressbar" aria-valuenow={Math.round(used?.pct ?? 0)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${used ? used.pct : 0}%` }} />
        </div>
        <p className="ai-trade-muted ai-trade-small">
          {used ? `${num(used.loss)} از ${num(dailyLoss)} دلار` : C.account.unknown}
        </p>
      </Card>

      <Card title={C.account.positions} span="ai-trade-span-2"
        action={<button type="button" className="ai-trade-btn ai-trade-btn-ghost" onClick={onRefresh} disabled={refreshing}>{refreshing ? C.ai.analyzing : C.account.refresh}</button>}>
        {summary.positions.length === 0
          ? <p className="ai-trade-muted">{C.account.noPositions}</p>
          : (
            <ul className="ai-trade-rows">
              {summary.positions.map((p) => (
                <li key={p.coin} className="ai-trade-row" data-tone={tone(p.unrealizedPnl)}>
                  <span><strong>{p.coin}</strong> · {p.size > 0 ? 'long' : 'short'} · {num(Math.abs(p.size))}</span>
                  <span className="ai-trade-small">ورود <b>{num(p.entryPx)}</b></span>
                  <span className="ai-trade-small">uPnL <b>{signed(p.unrealizedPnl)}</b></span>
                </li>
              ))}
            </ul>
          )}
        <p className="ai-trade-small ai-trade-muted">{C.account.updated}{timeFa(at)}{stale ? ` · ${C.account.stale}` : ''}</p>
      </Card>
    </div>
  );
}

function Gate({ onGo }) {
  return (
    <Card className="ai-trade-gate">
      <IconLock width={28} height={28} aria-hidden="true" />
      <p className="ai-trade-muted">{C.needConnect}</p>
      <div className="ai-trade-actions" style={{ justifyContent: 'center' }}>
        <button type="button" className="ai-trade-btn ai-trade-btn-primary" onClick={onGo}>{C.steps.connect}</button>
      </div>
    </Card>
  );
}

/* ── step 3: limits ───────────────────────────────────────────────────── */
function LimitsStep({ form, setForm, result }) {
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleCoin = (coin) => setForm((f) => ({
    ...f,
    allowedCoins: f.allowedCoins.includes(coin) ? f.allowedCoins.filter((c) => c !== coin) : [...f.allowedCoins, coin]
  }));
  const current = Number(form.maxLeverage);
  return (
    <div className="ai-trade-bento">
      <Card title={C.limits.title} span="ai-trade-span-3">
        <div className="ai-trade-form">
          <label className="ai-trade-field"><span>{C.limits.total}</span>
            <input type="number" inputMode="decimal" dir="ltr" value={form.totalExposureUsd} onChange={set('totalExposureUsd')} /></label>
          <label className="ai-trade-field"><span>{C.limits.perOrder}</span>
            <input type="number" inputMode="decimal" dir="ltr" value={form.maxOrderUsd} onChange={set('maxOrderUsd')} /></label>
          <label className="ai-trade-field"><span>{C.limits.dailyLoss}</span>
            <input type="number" inputMode="decimal" dir="ltr" value={form.dailyLossUsd} onChange={set('dailyLossUsd')} /></label>
          <div className="ai-trade-field">
            <span>{C.limits.leverage}</span>
            <div className="ai-trade-chips" role="radiogroup" aria-label={C.limits.leverage}>
              {LEVERAGE_CHOICES.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={current === n} className="ai-trade-chip"
                  onClick={() => setForm((f) => ({ ...f, maxLeverage: String(n) }))}>{n}x</button>
              ))}
            </div>
          </div>
        </div>
        <div className="ai-trade-field">
          <span>{C.limits.coins}</span>
          <div className="ai-trade-chips" role="group" aria-label={C.limits.coins}>
            {COINS.map((c) => (
              <button key={c} type="button" aria-pressed={form.allowedCoins.includes(c)} className="ai-trade-chip" onClick={() => toggleCoin(c)}>{c}</button>
            ))}
          </div>
        </div>
        <p className="ai-trade-small ai-trade-muted">{C.limits.stopRule}</p>
        {!result.ok && result.errors.map((code) => <p key={code} className="ai-trade-error" role="alert">{C.limits.errors[code]}</p>)}
        {result.ok && <p className="ai-trade-ok">{C.limits.saved}</p>}
      </Card>

      <Card title={C.limits.killSwitch} span="ai-trade-span-3">
        <button type="button" role="switch" aria-checked={form.killSwitch} className="ai-trade-kill"
          onClick={() => setForm((f) => ({ ...f, killSwitch: !f.killSwitch }))}>
          <span>
            <strong>{form.killSwitch ? C.statusLabel.stopped : C.statusLabel.ready}</strong>
            <span className="ai-trade-small ai-trade-muted" style={{ display: 'block' }}>{C.limits.killSwitchHelp}</span>
          </span>
          <span className="ai-trade-switch" aria-hidden="true" />
        </button>
      </Card>
    </div>
  );
}

/* ── step 4: AI and rules ─────────────────────────────────────────────── */
function AiStep({ session, setSession, rules, setRules, onAnalyze, analyzing, gate, lastRun }) {
  const setS = (key) => (e) => setSession((s) => ({ ...s, [key]: e.target.value }));
  const setR = (key) => (e) => setRules((r) => normalizeRules({ ...r, [key]: e.target.value }));
  return (
    <div className="ai-trade-bento">
      <Card title={C.ai.title} span="ai-trade-span-2">
        <div className="ai-trade-form">
          <label className="ai-trade-field ai-trade-field-wide"><span>{C.ai.keyLabel}</span>
            <input type="password" dir="ltr" autoComplete="off" spellCheck={false} data-lpignore="true" value={session.aiKey} onChange={setS('aiKey')} placeholder="sk-…" /></label>
          <label className="ai-trade-field"><span>{C.ai.modelLabel}</span>
            <input type="text" dir="ltr" autoComplete="off" value={session.aiModel} onChange={setS('aiModel')} placeholder="model-name" /></label>
        </div>
        <p className="ai-trade-small ai-trade-muted">{C.ai.keyHelp}</p>
        <details className="ai-trade-adv">
          <summary>تنظیمات پیشرفته</summary>
          <label className="ai-trade-field" style={{ marginTop: 10 }}><span>{C.ai.endpointLabel}</span>
            <input type="url" dir="ltr" value={session.aiEndpoint} onChange={setS('aiEndpoint')} /></label>
        </details>
        <div className="ai-trade-actions">
          <button type="button" className="ai-trade-btn ai-trade-btn-primary" onClick={onAnalyze} disabled={analyzing || !!gate}>
            <IconSparkle width={18} height={18} aria-hidden="true" /> {analyzing ? C.ai.analyzing : C.ai.analyze}
          </button>
          {gate && <span className="ai-trade-small ai-trade-muted">{gate}</span>}
        </div>
        {lastRun && <p className={lastRun.tone === 'error' ? 'ai-trade-error' : 'ai-trade-ok'} role="status">{lastRun.text}</p>}
      </Card>

      <Card title={C.ai.strategyTitle} span="ai-trade-span-2">
        <div className="ai-trade-seg" role="radiogroup" aria-label={C.ai.strategyTitle}>
          {STRATEGIES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={rules.strategy === s}
              onClick={() => setRules((r) => ({ ...r, strategy: s }))}>{C.ai.strategies[s]}</button>
          ))}
        </div>
        <div className="ai-trade-form">
          <label className="ai-trade-field"><span>{C.ai.maxTrades}</span>
            <input type="number" dir="ltr" min={1} max={10} value={rules.maxTradesPerDay} onChange={setR('maxTradesPerDay')} /></label>
          <label className="ai-trade-field"><span>{C.ai.cooldown}</span>
            <input type="number" dir="ltr" min={0} max={1440} value={rules.cooldownMinutes} onChange={setR('cooldownMinutes')} /></label>
          <label className="ai-trade-field ai-trade-field-wide"><span>{C.ai.notes}</span>
            <textarea value={rules.notes} maxLength={300} onChange={setR('notes')} placeholder={C.ai.notesHint} /></label>
        </div>
        <p className="ai-trade-small ai-trade-muted">{C.ai.none}</p>
      </Card>
    </div>
  );
}

/* ── step 5: approve ──────────────────────────────────────────────────── */
function PendingCard({ item, onApprove, onReject, now }) {
  const { intent, preview } = item;
  const expired = item.status === 'pending' && now > item.expiresAt;
  const status = expired ? 'expired' : item.status;
  const secs = Math.max(0, Math.ceil((item.expiresAt - now) / 1000));
  const blockers = [];
  if (!preview.capsOk && preview.capsCode) blockers.push(C.approve.errors[preview.capsCode] || preview.capsCode);
  if (!preview.rulesOk && preview.rulesCode) blockers.push(C.approve.errors[preview.rulesCode] || preview.rulesCode);
  const canHold = status === 'pending' && preview.canApprove && !expired;
  return (
    <section className="ai-trade-card ai-trade-proposal" data-state={status}>
      <div className="ai-trade-card-head">
        <span className="ai-trade-side" data-side={intent.side}>{intent.coin} · {C.approve.side[intent.side]}</span>
        <span className="ai-trade-pill" data-tone={status === 'executed' ? 'ready' : status === 'failed' ? 'stopped' : undefined}>{C.approve.statusLabels[status]}</span>
      </div>
      <dl className="ai-trade-facts">
        <div><dt>{C.approve.labels.notional}</dt><dd>{num(intent.notionalUsd)}$</dd></div>
        <div><dt>{C.approve.labels.leverage}</dt><dd>{intent.leverage}x</dd></div>
        <div><dt>{C.approve.labels.margin}</dt><dd>{num(preview.marginUsd)}$</dd></div>
        <div><dt>{C.approve.labels.stop}</dt><dd>{preview.estimatedStopPx ? `${num(preview.estimatedStopPx)} (${(intent.stopLossPct * 100).toFixed(1)}%)` : C.account.unknown}</dd></div>
        <div><dt>{C.approve.labels.worst}</dt><dd>{num(preview.worstCaseLossUsd)}$</dd></div>
        <div><dt>مهلت</dt><dd className="ai-trade-timer">{expired ? '—' : `${secs}s`}</dd></div>
      </dl>
      {intent.rationale && <p className="ai-trade-muted ai-trade-small"><strong>{C.approve.labels.rationale}: </strong>{intent.rationale}</p>}
      {blockers.length > 0 && <div className="ai-trade-blocked" role="alert">{C.approve.blockedBy}<br />{blockers.join(' · ')}</div>}
      {status === 'pending' && (
        <div className="ai-trade-actions">
          <HoldButton onConfirm={() => onApprove(item.id)} disabled={!canHold} label={`${C.approve.hold}: ${intent.coin}`}>
            <IconCheck width={18} height={18} aria-hidden="true" /> {C.approve.hold}
          </HoldButton>
          <HoldButton kind="reject" onConfirm={() => onReject(item.id)} label={C.approve.reject}>{C.approve.reject}</HoldButton>
        </div>
      )}
      {status === 'pending' && <p className="ai-trade-small ai-trade-muted">{C.approve.holdHint}</p>}
      {status === 'executing' && <p className="ai-trade-muted" role="status">{C.approve.working}</p>}
      {item.resultText && <p className={item.failed ? 'ai-trade-error' : 'ai-trade-ok'} role="status">{item.resultText}</p>}
      {expired && <p className="ai-trade-small ai-trade-muted">{C.approve.expired}</p>}
    </section>
  );
}

function ApproveStep({ pending, onApprove, onReject }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (pending.length === 0) return <Card><p className="ai-trade-muted">{C.approve.empty}</p></Card>;
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

/* ── step 6: report ───────────────────────────────────────────────────── */
function ReportStep({ ledger, account, onRefresh, refreshing }) {
  const executed = ledger.entries.filter((e) => e.status === 'executed');
  const fills = account?.ok ? account.fills : null;
  return (
    <div className="ai-trade-bento">
      <Kpi label={C.report.executed} value={String(executed.length)} />
      <Kpi label={C.report.realised} value={signed(fills?.realisedPnlUsd)} toneName={tone(fills?.realisedPnlUsd)} />
      <Kpi label={C.report.fees} value={num(fills?.feesUsd)} />
      <Kpi label={C.report.fills} value={String(fills?.fillCount ?? C.account.unknown)} />
      <Card title={C.report.title} span="ai-trade-span-4"
        action={<button type="button" className="ai-trade-btn ai-trade-btn-ghost" onClick={onRefresh} disabled={refreshing}>{C.report.refresh}</button>}>
        {ledger.entries.length === 0
          ? <p className="ai-trade-muted">{C.report.empty}</p>
          : (
            <ul className="ai-trade-rows">
              {[...ledger.entries].reverse().map((e) => (
                <li key={e.id} className="ai-trade-row" data-tone={e.status === 'executed' ? 'up' : e.status === 'failed' ? 'down' : undefined}>
                  <span><strong>{e.coin}</strong> · {C.approve.side[e.side]} · {num(e.notionalUsd)}$</span>
                  <span className="ai-trade-small">{timeFa(e.at)} · {C.approve.statusLabels[e.status]}</span>
                  {e.entryPx && <span className="ai-trade-small">{C.report.entryLine}<b>{num(e.entryPx)}</b></span>}
                  {e.stopPx && <span className="ai-trade-small">{C.report.stopLine}<b>{num(e.stopPx)}</b></span>}
                  {e.message && <span className="ai-trade-small ai-trade-error">{e.message}</span>}
                </li>
              ))}
            </ul>
          )}
        <p className="ai-trade-small ai-trade-muted">{C.report.disclaimer}</p>
      </Card>
    </div>
  );
}

/* ── the tab ──────────────────────────────────────────────────────────── */
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
    setStep('account');
  };

  const setPendingItem = (id, patch) => setPending((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const approve = async (id) => {
    const item = pending.find((p) => p.id === id);
    const gate = item && approvePending(item, { now: Date.now() });
    if (!item || !gate.ok) { setPendingItem(id, { status: 'expired' }); return; }
    setPendingItem(id, { status: 'executing', resultText: null });
    const now = Date.now();
    const fresh = await readFresh(session.address.trim(), now);
    const coin = item.intent.coin;
    const fail = (message, code) => {
      setPendingItem(id, { status: 'failed', failed: true, resultText: message });
      setLedger((l) => recordEntry(l, { id, at: now, coin, side: item.intent.side, notionalUsd: item.intent.notionalUsd, status: 'failed', message, code }));
    };
    if (!fresh.ok) { fail(C.account.errors[fresh.code] || C.exec.HL_EXEC_NETWORK, fresh.code); return; }
    setAccount(fresh);
    const rule = evaluateRules(rules, {
      tradesToday: tradesSince(ledger, startOfLocalDay(now)),
      lastTradeAtByCoin: lastTradeTimes(ledger), coin, now
    });
    if (!rule.ok) { fail(C.approve.errors[rule.code] || rule.code, rule.code); return; }
    const meta = await fetchMeta();
    const market = meta.ok ? meta.markets[coin] : null;
    const midRes = await fetchHyperliquidInfo('allMids', null);
    const mid = Number(midRes.ok ? midRes.data?.[coin] : NaN);
    const report = await executeIntent({
      privateKey: session.agentKey.trim(), intent: item.intent, market, mid: Number.isFinite(mid) ? mid : 0,
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
    const mids = await fetchHyperliquidInfo('allMids', null);
    const candleSets = await Promise.all(COINS.map((c) => fetchCandles(c, { interval: '1h', count: 48, now })));
    const candles = Object.fromEntries(COINS.map((c, i) => [c, candleSets[i].ok ? candleSets[i].candles : []]));
    const caps = capsResult.value;
    const messages = buildAnalystMessages({
      rules, caps,
      account: { accountValueUsd: fresh.summary.accountValueUsd, exposureUsd: fresh.state.currentExposureUsd, dailyRealisedPnlUsd: fresh.state.dailyRealisedPnlUsd, dailyUnrealisedPnlUsd: fresh.state.dailyUnrealisedPnlUsd, positions: fresh.summary.positions.map((p) => ({ coin: p.coin, size: p.size, entryPx: p.entryPx, unrealizedPnl: p.unrealizedPnl })) },
      mids: mids.ok ? Object.fromEntries(COINS.map((c) => [c, mids.data?.[c] ?? null])) : {},
      candles
    });
    const res = await requestProposals({
      apiKey: session.aiKey.trim(), endpoint: session.aiEndpoint.trim(), model: session.aiModel.trim(), messages,
      limits: { allowedCoins: caps.allowedCoins, maxLeverage: caps.maxLeverage, maxStopLossPct: caps.maxStopLossPct }
    });
    setAnalyzing(false);
    if (!res.ok) { setLastRun({ tone: 'error', text: C.ai.errors[res.code] || C.ai.errors.AI_NETWORK }); return; }
    if (res.proposals.length === 0) { setLastRun({ tone: 'ok', text: C.ai.none }); return; }
    const tradesToday = tradesSince(ledger, startOfLocalDay(now));
    const lastAt = lastTradeTimes(ledger);
    const items = res.proposals.map((intent, i) => {
      const mid = Number(mids.ok ? mids.data?.[intent.coin] : NaN);
      const preview = buildPreview(intent, { mid, caps, state: fresh.state, rules, tradesToday, lastTradeAtByCoin: lastAt, now });
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

  return (
    <section className="ai-trade" aria-label={AI_TRADE_TAB_LABEL}>
      <header className="ai-trade-hero">
        <div className="ai-trade-hero-ico"><IconShield width={24} height={24} aria-hidden="true" /></div>
        <div className="ai-trade-hero-text">
          <h1 className="ai-trade-title">{C.title}</h1>
          <p className="ai-trade-sub">{C.subtitle}</p>
        </div>
        <span className="ai-trade-pill" data-tone={statusTone}>{statusText}</span>
      </header>

      {lockNotice && <div className="ai-trade-note ai-trade-warn" role="status">{lockNotice}</div>}
      <p className="ai-trade-small ai-trade-muted" style={{ margin: 0 }}>{C.riskNotice}</p>

      <nav className="ai-trade-steps" role="tablist" aria-label={AI_TRADE_TAB_LABEL}>
        {STEPS.map((id, i) => (
          <button key={id} type="button" role="tab" id={`ai-tab-${id}`} aria-selected={step === id} aria-controls={`ai-panel-${id}`}
            className="ai-trade-step" data-done={stepDone[id] ? 'true' : 'false'} onClick={() => setStep(id)}>
            <span className="ai-trade-step-n">{stepDone[id] ? '✓' : i + 1}</span>
            <span>{C.steps[id]}</span>
          </button>
        ))}
      </nav>

      <div className="ai-trade-stage" role="tabpanel" id={`ai-panel-${step}`} aria-labelledby={`ai-tab-${step}`}>
        {step === 'connect' && (
          <ConnectStep session={session} setSession={setSession} onConnect={connect} busy={refreshing} error={connectError} />
        )}
        {step === 'account' && (
          <AccountStep session={session} account={account} onRefresh={refresh} refreshing={refreshing} dailyLoss={dailyLoss} onGo={() => setStep('connect')} />
        )}
        {step === 'limits' && <LimitsStep form={capsForm} setForm={setCapsForm} result={capsResult} />}
        {step === 'ai' && (
          <AiStep session={session} setSession={setSession} rules={rules} setRules={setRules}
            onAnalyze={analyze} analyzing={analyzing} gate={analyzeGate} lastRun={lastRun} />
        )}
        {step === 'approve' && <ApproveStep pending={pending} onApprove={approve} onReject={reject} />}
        {step === 'report' && (
          <ReportStep ledger={ledger} account={account} onRefresh={refresh} refreshing={refreshing} />
        )}
      </div>

      {session.connected && (
        <div className="ai-trade-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="ai-trade-btn ai-trade-btn-ghost" onClick={() => lock(C.lockNotice)}>
            <IconLock width={16} height={16} aria-hidden="true" /> {C.lockNow}
          </button>
        </div>
      )}
    </section>
  );
}
