/**
 * «AI ترید» — the tab on /perp. This slice has six phases on one page:
 *   1 connect   — paste an agent key, format check only (not stored)
 *   2 account   — read-only account view for a PUBLIC address
 *   3 limits    — caps form, validated before it is accepted
 *   4–6         — shown as "next release"; nothing here can trade
 *
 * Nothing on this screen signs or sends an order. The read goes to the
 * Hyperliquid info endpoint; the key is held only in component state and is
 * never written to storage, the URL, a log or the network.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { IconShield, IconSparkle } from '../Icons';
import { validateAgentKeyFormat, maskAgentKey } from '../../lib/hyperliquid/agentKey';
import { isValidHlAddress, readAccountSummary } from '../../lib/hyperliquid/readonly';
import { defaultCapsSettings, validateCapsSettings } from '../../lib/hyperliquid/capsSettings';
import { AI_TRADE_COPY as C } from '../../lib/hyperliquid/aiTradeCopy';
import '../../styles/ai-trade.css';

const fmt = (n) => (n === null || n === undefined || !Number.isFinite(n))
  ? C.account.unknown
  : n.toLocaleString('en-US', { maximumFractionDigits: 2 });

function PhaseCard({ index, title, children, tone }) {
  return (
    <section className={`card ai-trade-phase ${tone ? `is-${tone}` : ''}`} aria-labelledby={`ai-phase-${index}`}>
      <header className="ai-trade-phase-head">
        <span className="ai-trade-index" aria-hidden="true">{index}</span>
        <h2 id={`ai-phase-${index}`} className="ai-trade-phase-title">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function ConnectPhase() {
  const [value, setValue] = useState('');
  const [reveal, setReveal] = useState(false);
  const check = useMemo(() => (value ? validateAgentKeyFormat(value) : null), [value]);

  return (
    <PhaseCard index={1} title={C.phases.connect}>
      <p className="muted">{C.connect.help}</p>
      <div className="ai-trade-warning" role="note">{C.connect.mainKeyWarning}</div>
      <label className="ai-trade-field">
        <span>کلید agent</span>
        <input
          type={reveal ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x…"
          dir="ltr"
        />
      </label>
      <div className="ai-trade-row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReveal((r) => !r)}>
          {reveal ? 'پنهان کن' : 'نمایش'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValue('')} disabled={!value}>
          پاک کن
        </button>
      </div>
      {check && check.ok && (
        <p className="ai-trade-ok" role="status">{C.connect.ok} <span dir="ltr">{maskAgentKey(value)}</span></p>
      )}
      {check && !check.ok && (
        <p className="ai-trade-error" role="alert">{C.connect.errors[check.code]}</p>
      )}
      <p className="muted ai-trade-small">{C.connect.notStored}</p>
    </PhaseCard>
  );
}

function AccountPhase() {
  const [address, setAddress] = useState('');
  const [state, setState] = useState({ status: 'idle', data: null, code: null });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const addressOk = isValidHlAddress(address);

  const read = async () => {
    setState({ status: 'loading', data: null, code: null });
    const res = await readAccountSummary(address.trim());
    if (!alive.current) return;
    if (res.ok) setState({ status: 'ok', data: res, code: null });
    else setState({ status: 'error', data: null, code: res.code });
  };

  return (
    <PhaseCard index={2} title={C.phases.account}>
      <label className="ai-trade-field">
        <span>{C.account.addressLabel}</span>
        <input
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x…"
          dir="ltr"
        />
      </label>
      <p className="muted ai-trade-small">{C.account.addressHint}</p>
      <button type="button" className="btn btn-primary" onClick={read} disabled={!addressOk || state.status === 'loading'}>
        {state.status === 'loading' ? '…' : C.account.read}
      </button>

      {state.status === 'error' && (
        <p className="ai-trade-error" role="alert">{C.account.errors[state.code] || C.account.errors.HL_NETWORK}</p>
      )}

      {state.status === 'ok' && (
        <div className="ai-trade-grid" aria-live="polite">
          <div className="ai-trade-stat"><span className="muted">ارزش حساب (دلار)</span><strong>{fmt(state.data.accountValueUsd)}</strong></div>
          <div className="ai-trade-stat"><span className="muted">قابل برداشت (دلار)</span><strong>{fmt(state.data.withdrawableUsd)}</strong></div>
          <div className="ai-trade-stat"><span className="muted">مارجین استفاده‌شده</span><strong>{fmt(state.data.marginUsedUsd)}</strong></div>
          <div className="ai-trade-stat"><span className="muted">پوزیشن‌های باز</span><strong>{state.data.positions.length}</strong></div>
          {state.data.positions.map((p) => (
            <div key={p.coin} className="ai-trade-position">
              <strong dir="ltr">{p.coin}</strong>
              <span className="muted">اندازه</span><span dir="ltr">{fmt(p.size)}</span>
              <span className="muted">ورود</span><span dir="ltr">{fmt(p.entryPx)}</span>
              <span className="muted">سود/زیان شناور</span>
              <span className={Number.isFinite(p.unrealizedPnl) ? (p.unrealizedPnl >= 0 ? 'ai-trade-up' : 'ai-trade-down') : ''} dir="ltr">
                {fmt(p.unrealizedPnl)}
              </span>
              <span className="muted">لیکوییدیشن</span><span dir="ltr">{fmt(p.liquidationPx)}</span>
            </div>
          ))}
        </div>
      )}
    </PhaseCard>
  );
}

function LimitsPhase() {
  const initial = defaultCapsSettings();
  const [form, setForm] = useState({
    totalExposureUsd: String(initial.totalExposureUsd),
    maxOrderUsd: String(initial.maxOrderUsd),
    dailyLossUsd: String(initial.dailyLossUsd),
    maxLeverage: String(initial.maxLeverage),
    allowedCoins: [...initial.allowedCoins],
    killSwitch: initial.killSwitch
  });
  const [saved, setSaved] = useState(false);
  const result = useMemo(() => validateCapsSettings(form), [form]);

  const set = (key) => (e) => { setSaved(false); setForm((f) => ({ ...f, [key]: e.target.value })); };
  const toggleCoin = (coin) => {
    setSaved(false);
    setForm((f) => ({
      ...f,
      allowedCoins: f.allowedCoins.includes(coin) ? f.allowedCoins.filter((c) => c !== coin) : [...f.allowedCoins, coin]
    }));
  };

  return (
    <PhaseCard index={3} title={C.phases.limits} tone={form.killSwitch ? 'stopped' : null}>
      <div className="ai-trade-grid">
        <label className="ai-trade-field"><span>{C.limits.total}</span>
          <input type="number" inputMode="decimal" value={form.totalExposureUsd} onChange={set('totalExposureUsd')} dir="ltr" /></label>
        <label className="ai-trade-field"><span>{C.limits.perOrder}</span>
          <input type="number" inputMode="decimal" value={form.maxOrderUsd} onChange={set('maxOrderUsd')} dir="ltr" /></label>
        <label className="ai-trade-field"><span>{C.limits.dailyLoss}</span>
          <input type="number" inputMode="decimal" value={form.dailyLossUsd} onChange={set('dailyLossUsd')} dir="ltr" /></label>
        <label className="ai-trade-field"><span>{C.limits.leverage}</span>
          <input type="number" inputMode="numeric" value={form.maxLeverage} onChange={set('maxLeverage')} dir="ltr" /></label>
      </div>

      <fieldset className="ai-trade-coins">
        <legend>{C.limits.coins}</legend>
        {['BTC', 'ETH'].map((coin) => (
          <label key={coin} className="ai-trade-chip">
            <input type="checkbox" checked={form.allowedCoins.includes(coin)} onChange={() => toggleCoin(coin)} />
            <span dir="ltr">{coin}</span>
          </label>
        ))}
      </fieldset>

      <div className="ai-trade-kill">
        <label className="ai-trade-chip ai-trade-chip-danger">
          <input type="checkbox" checked={form.killSwitch} onChange={(e) => { setSaved(false); setForm((f) => ({ ...f, killSwitch: e.target.checked })); }} />
          <span>{C.limits.killSwitch}</span>
        </label>
        <p className="muted ai-trade-small">{C.limits.killSwitchHelp}</p>
      </div>

      {!result.ok && result.errors.map((code) => (
        <p key={code} className="ai-trade-error" role="alert">{C.limits.errors[code]}</p>
      ))}
      {result.ok && (
        <div className="ai-trade-row">
          <button type="button" className="btn btn-primary" onClick={() => setSaved(true)}>ذخیره روی این صفحه</button>
          {saved && <span className="ai-trade-ok" role="status">{C.limits.saved}</span>}
        </div>
      )}
    </PhaseCard>
  );
}

function ComingSoonPhase({ index, title, text }) {
  return (
    <PhaseCard index={index} title={title} tone="soon">
      <p className="muted">{text}</p>
      <span className="ai-trade-tag">{C.comingSoon.tag}</span>
    </PhaseCard>
  );
}

export default function AiTradePanel() {
  return (
    <div className="ai-trade" dir="rtl">
      <header className="ai-trade-hero card">
        <span className="ai-trade-hero-ico" aria-hidden="true"><IconShield width={20} height={20} /></span>
        <div>
          <h1 className="ai-trade-title"><IconSparkle width={16} height={16} aria-hidden="true" /> {C.title}</h1>
          <p className="muted">{C.subtitle}</p>
        </div>
      </header>

      <p className="ai-trade-risk" role="note">{C.riskNotice}</p>
      <p className="muted ai-trade-small">{C.geoNotice}</p>

      <ConnectPhase />
      <AccountPhase />
      <LimitsPhase />
      <ComingSoonPhase index={4} title={C.phases.ai} text={C.comingSoon.ai} />
      <ComingSoonPhase index={5} title={C.phases.rules} text={C.comingSoon.rules} />
      <ComingSoonPhase index={6} title={C.phases.approvals} text={C.comingSoon.approvals} />
    </div>
  );
}
