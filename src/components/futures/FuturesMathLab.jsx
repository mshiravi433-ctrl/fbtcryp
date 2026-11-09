/**
 * FUTURES MATH LAB — «فیوچرز چطور کار می‌کند؟», rebuilt as a live workshop.
 * ---------------------------------------------------------------------------
 * The old box was four static sentences. This is the same education, but every
 * formula is (a) printed with its variables, (b) evaluated live from the
 * SAME engine functions the trading screens use (lib/futures-engine/risk.js),
 * and (c) attached to sliders, so the reader learns the SHAPE of the function
 * instead of memorising a paragraph.
 *
 * Four rooms, one per equation a futures trader cannot avoid:
 *
 *   PnL       PnL = (P_exit − P_entry)/P_entry × notional × sideSign
 *             ROE = PnL ÷ collateral — «تحلیل» percentage, not
 *             «collateral-relative» percentage; the two are leverage apart.
 *   LIQUIDATION  P_liq, long  = P × (L − 1 + f·L) / (L(1 − MMR))
 *             P_liq, short = P × (L + 1 − f·L) / (L(1 + MMR))
 *             evaluated by `liquidationDistance()` — the identical call the
 *             ticket confirmation makes.
 *   FUNDING   cost = notional × APR × hours ÷ 8760 — sign tells you who pays
 *             whom. Positive ⇒ longs pay shorts.
 *   LEVERAGE  distance-to-liquidation at 1/2/5/10/20/50× — the one picture
 *             that explains why leverage is not free money.
 *
 * No number here is invented; every value is either an input you moved or the
 * engine's answer to it.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { liquidationDistance, fundingCost, RISK_POLICY_DEFAULTS } from '../../lib/futures-engine/risk.js';
import { IconChart, IconTrend, IconActivity, IconShield } from '../Icons';
import '../../styles/futures-math-lab.css';

const usd = (v, d = 2) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(d)}`;
};
const pct = (v, d = 2) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(d)}%` : '—');

const TABS = [
  { id: 'pnl', icon: IconTrend },
  { id: 'liq', icon: IconShield },
  { id: 'funding', icon: IconActivity },
  { id: 'leverage', icon: IconChart }
];

const LEVERAGE_LADDER = [1, 2, 5, 10, 20, 50];

export default function FuturesMathLab({ testId = 'futures-math-lab' }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('pnl');

  /* ── room 1 · PnL / ROE ── */
  const [pnlSide, setPnlSide] = useState('long');
  const [collateral, setCollateral] = useState(100);
  const [pnlLeverage, setPnlLeverage] = useState(5);
  const [movePct, setMovePct] = useState(10);
  const pnl = useMemo(() => {
    const sideSign = pnlSide === 'short' ? -1 : 1;
    const notional = collateral * pnlLeverage;
    const pnlUsd = notional * (movePct / 100) * sideSign;
    const roe = collateral > 0 ? (pnlUsd / collateral) * 100 : null;
    return { notional, pnlUsd, roe };
  }, [pnlSide, collateral, pnlLeverage, movePct]);

  /* ── room 2 · liquidation price ── */
  const [liqEntry, setLiqEntry] = useState(100);
  const [liqLeverage, setLiqLeverage] = useState(10);
  const [mmrPct, setMmrPct] = useState(0.5);
  const liq = useMemo(() => {
    const mmr = Math.min(0.99, Math.max(0, mmrPct / 100));
    const common = { providerId: null, entryPrice: liqEntry, leverage: liqLeverage, maxLeverage: 50, maintenanceMarginFraction: mmr, takerFeeRate: 0.0005 };
    const long = liquidationDistance({ ...common, side: 'long' });
    const short = liquidationDistance({ ...common, side: 'short' });
    return { long, short };
  }, [liqEntry, liqLeverage, mmrPct]);

  /* ── room 3 · funding ── */
  const [fundNotional, setFundNotional] = useState(1000);
  const [fundApr, setFundApr] = useState(12);
  const funding = useMemo(() => {
    const h8 = fundingCost({ notionalUsd: fundNotional, fundingAprPct: fundApr, hours: 8 });
    const h24 = fundingCost({ notionalUsd: fundNotional, fundingAprPct: fundApr, hours: 24 });
    const h720 = fundingCost({ notionalUsd: fundNotional, fundingAprPct: fundApr, hours: 720 });
    return { h8, h24, h720 };
  }, [fundNotional, fundApr]);

  /* ── room 4 · leverage ladder (maintenance-margin model, labelled) ── */
  const ladder = useMemo(() => LEVERAGE_LADDER.map((lev) => {
    const d = liquidationDistance({
      providerId: null, side: 'long', entryPrice: 100, leverage: lev,
      maxLeverage: 50, maintenanceMarginFraction: 0.005, takerFeeRate: 0.0005
    });
    return { lev, distancePct: d.distancePct };
  }), []);

  return (
    <div className="fmath" data-testid={testId}>
      {/* ── tab rail ── */}
      <div className="fmath-tabs" role="tablist" aria-label={t('futures.math.aria', { defaultValue: 'Futures equations' })}>
        {TABS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`fmath-tab ${tab === id ? 'is-on' : ''}`}
            onClick={() => setTab(id)}
            data-testid={`futures-math-tab-${id}`}
          >
            <Icon width={14} height={14} aria-hidden="true" />
            <span>{t(`futures.math.tab.${id}`)}</span>
          </button>
        ))}
      </div>

      {/* ═══════════ ROOM 1 · PnL & ROE ═══════════ */}
      {tab === 'pnl' && (
        <div className="fmath-pane" role="tabpanel" data-testid="futures-math-pane-pnl">
          <p className="fmath-what">{t('futures.math.pnl.what')}</p>
          <code className="fmath-formula" dir="ltr">PnL = (Pₑₓᵢₜ − Pₑₙₜᵣᵧ) / Pₑₙₜᵣᵧ × (collateral × L) × side</code>

          <div className="fmath-controls">
            <div className="fmath-seg" role="group" aria-label={t('perp.terminal.direction', { defaultValue: 'Direction' })}>
              {['long', 'short'].map((s) => (
                <button key={s} type="button" className={`fmath-seg-btn is-${s} ${pnlSide === s ? 'is-on' : ''}`} onClick={() => setPnlSide(s)} aria-pressed={pnlSide === s} data-testid={`futures-math-side-${s}`}>
                  {t(`perp.terminal.${s}`)}
                </button>
              ))}
            </div>
            <label className="fmath-slider">
              <span className="fmath-slider-head"><span>{t('futures.math.collateral')}</span><b className="mono">${collateral}</b></span>
              <input type="range" min="25" max="1000" step="25" value={collateral} onChange={(e) => setCollateral(Number(e.target.value))} aria-label={t('futures.math.collateral')} />
            </label>
            <label className="fmath-slider">
              <span className="fmath-slider-head"><span>{t('perp.terminal.leverage', { defaultValue: 'Leverage' })}</span><b className="mono">{pnlLeverage}×</b></span>
              <input type="range" min="1" max="50" step="1" value={pnlLeverage} onChange={(e) => setPnlLeverage(Number(e.target.value))} aria-label={t('perp.terminal.leverage', { defaultValue: 'Leverage' })} />
            </label>
            <label className="fmath-slider">
              <span className="fmath-slider-head"><span>{t('futures.math.move')}</span><b className="mono">{movePct > 0 ? '+' : ''}{movePct}%</b></span>
              <input type="range" min="-30" max="30" step="0.5" value={movePct} onChange={(e) => setMovePct(Number(e.target.value))} aria-label={t('futures.math.move')} />
            </label>
          </div>

          <div className="fmath-out" data-testid="futures-math-pnl-out">
            <div className="fmath-out-cell"><span>{t('perp.terminal.notional', { defaultValue: 'Notional' })}</span><b className="mono">{usd(pnl.notional, 0)}</b></div>
            <div className="fmath-out-cell"><span>PnL</span><b className={`mono ${pnl.pnlUsd >= 0 ? 'is-up' : 'is-down'}`}>{pnl.pnlUsd >= 0 ? '+' : '−'}{usd(Math.abs(pnl.pnlUsd))}</b></div>
            <div className="fmath-out-cell"><span>ROE</span><b className={`mono ${pnl.roe >= 0 ? 'is-up' : 'is-down'}`}>{pnl.roe >= 0 ? '+' : ''}{pct(pnl.roe, 1)}</b></div>
          </div>
          <p className="fmath-hint">{t('futures.math.pnl.hint')}</p>
        </div>
      )}

      {/* ═══════════ ROOM 2 · LIQUIDATION ═══════════ */}
      {tab === 'liq' && (
        <div className="fmath-pane" role="tabpanel" data-testid="futures-math-pane-liq">
          <p className="fmath-what">{t('futures.math.liq.what')}</p>
          <code className="fmath-formula" dir="ltr">P_liq = P × (L ∓ 1 ± f·L) / (L × (1 ∓ MMR))</code>

          <div className="fmath-controls">
            <label className="fmath-slider">
              <span className="fmath-slider-head"><span>{t('futures.math.liq.leverage')}</span><b className="mono">{liqLeverage}×</b></span>
              <input type="range" min="1" max="50" step="1" value={liqLeverage} onChange={(e) => setLiqLeverage(Number(e.target.value))} aria-label={t('futures.math.liq.leverage')} data-testid="futures-math-liq-leverage" />
            </label>
            <label className="fmath-slider">
              <span className="fmath-slider-head"><span>MMR</span><b className="mono">{mmrPct.toFixed(1)}%</b></span>
              <input type="range" min="0.5" max="5" step="0.5" value={mmrPct} onChange={(e) => setMmrPct(Number(e.target.value))} aria-label="MMR" data-testid="futures-math-liq-mmr" />
            </label>
          </div>

          <div className="fmath-liq-grid" data-testid="futures-math-liq-out">
            <div className="fmath-liq-card is-long">
              <span className="fmath-liq-side">{t('perp.terminal.long', { defaultValue: 'Long' })}</span>
              <b className="mono">{liq.long.liquidationPrice != null ? usd(liq.long.liquidationPrice) : '—'}</b>
              <span className="fmath-liq-dist mono">{liq.long.distancePct != null ? `−${pct(liq.long.distancePct, 2)}` : '—'}</span>
            </div>
            <div className="fmath-liq-card is-short">
              <span className="fmath-liq-side">{t('perp.terminal.short', { defaultValue: 'Short' })}</span>
              <b className="mono">{liq.short.liquidationPrice != null ? usd(liq.short.liquidationPrice) : '—'}</b>
              <span className="fmath-liq-dist mono">{liq.short.distancePct != null ? `+${pct(liq.short.distancePct, 2)}` : '—'}</span>
            </div>
          </div>
          <p className="fmath-hint">{t('futures.math.liq.hint')}</p>
        </div>
      )}

      {/* ═══════════ ROOM 3 · FUNDING ═══════════ */}
      {tab === 'funding' && (
        <div className="fmath-pane" role="tabpanel" data-testid="futures-math-pane-funding">
          <p className="fmath-what">{t('futures.math.funding.what')}</p>
          <code className="fmath-formula" dir="ltr">cost = notional × APR × hours / 8760</code>

          <div className="fmath-controls">
            <label className="fmath-slider">
              <span className="fmath-slider-head"><span>{t('perp.terminal.notional', { defaultValue: 'Notional' })}</span><b className="mono">{usd(fundNotional, 0)}</b></span>
              <input type="range" min="100" max="50000" step="100" value={fundNotional} onChange={(e) => setFundNotional(Number(e.target.value))} aria-label={t('perp.terminal.notional', { defaultValue: 'Notional' })} data-testid="futures-math-fund-notional" />
            </label>
            <label className="fmath-slider">
              <span className="fmath-slider-head"><span>Funding APR</span><b className="mono">{fundApr > 0 ? '+' : ''}{fundApr}%</b></span>
              <input type="range" min="-50" max="50" step="1" value={fundApr} onChange={(e) => setFundApr(Number(e.target.value))} aria-label="Funding APR" data-testid="futures-math-fund-apr" />
            </label>
          </div>

          <div className="fmath-out" data-testid="futures-math-funding-out">
            <div className="fmath-out-cell"><span>8h</span><b className="mono">{usd(funding.h8.usd)}</b></div>
            <div className="fmath-out-cell"><span>24h</span><b className="mono">{usd(funding.h24.usd)}</b></div>
            <div className="fmath-out-cell"><span>30d</span><b className="mono">{usd(funding.h720.usd)}</b></div>
          </div>
          <p className="fmath-hint">{t('futures.math.funding.hint')}</p>
        </div>
      )}

      {/* ═══════════ ROOM 4 · THE LEVERAGE LADDER ═══════════ */}
      {tab === 'leverage' && (
        <div className="fmath-pane" role="tabpanel" data-testid="futures-math-pane-leverage">
          <p className="fmath-what">{t('futures.math.leverage.what')}</p>
          <div className="fmath-ladder" data-testid="futures-math-ladder">
            {ladder.map(({ lev, distancePct }) => {
              const d = distancePct == null ? 0 : Math.min(100, distancePct);
              const tone = d >= 40 ? 'good' : d >= 15 ? 'mid' : d >= 8 ? 'warn' : 'danger';
              return (
                <div className="fmath-ladder-row" key={lev} data-testid={`futures-math-ladder-${lev}`}>
                  <span className="fmath-ladder-lev mono">{lev}×</span>
                  <span className="fmath-ladder-track">
                    <span className={`fmath-ladder-fill is-${tone}`} style={{ width: `${Math.max(2, d)}%` }} />
                  </span>
                  <span className="fmath-ladder-val mono">{distancePct != null ? `${distancePct.toFixed(1)}%` : '—'}</span>
                </div>
              );
            })}
          </div>
          <p className="fmath-hint">{t('futures.math.leverage.hint', { mmr: '0.5', cap: RISK_POLICY_DEFAULTS.hardMaxLeverage })}</p>
        </div>
      )}

      {/* ── the vocabulary strip, always visible ── */}
      <div className="fmath-gloss" aria-hidden="true">
        {['long', 'short', 'funding', 'liquidation', 'margin', 'spread'].map((k) => (
          <span key={k} className="fmath-gloss-chip" title={t(`futures.math.gloss.${k}.d`)}>
            {t(`futures.math.gloss.${k}.t`)}
          </span>
        ))}
      </div>
    </div>
  );
}
