import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import CoinLogo from '../components/CoinLogo';
import AnimatedNumber from '../components/AnimatedNumber';
import Sparkline from '../components/Sparkline';
import Sheet from '../components/Sheet';
import { useMarkets } from '../hooks/useMarket';
import { fmtNum, fmtPct, fmtPrice, fmtQty, fmtTime } from '../lib/format';
import { useAppStore, valuePortfolio } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import SegIndicator from '../components/SegIndicator';
import { useHideBalances } from '../hooks/useHideBalances';

const FEE = 0.001; // 0.1% simulated taker fee
const PERCENTS = [25, 50, 75, 100];

export default function Trade() {
  // Subscribe so the figures re-render the moment the switch moves;
  // the masking itself lives in the formatters.
  useHideBalances();
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const { data: coins } = useMarkets(60);
  const balance = useAppStore((s) => s.balance);
  const positions = useAppStore((s) => s.positions);
  const orders = useAppStore((s) => s.orders);
  const buy = useAppStore((s) => s.buy);
  const sell = useAppStore((s) => s.sell);

  const [side, setSide] = useState(params.get('side') === 'sell' ? 'sell' : 'buy');
  const [coinId, setCoinId] = useState(params.get('coin') ?? 'bitcoin');
  const [amount, setAmount] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');

  useEffect(() => {
    const next = new URLSearchParams(params);
    next.set('coin', coinId);
    next.set('side', side);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinId, side]);

  const coin = useMemo(() => (coins ?? []).find((c) => c.id === coinId) ?? (coins ?? [])[0], [coins, coinId]);
  const price = coin?.price ?? 0;

  const priceMap = useMemo(() => Object.fromEntries((coins ?? []).map((c) => [c.id, c.price])), [coins]);
  const portfolio = useMemo(() => valuePortfolio(positions, priceMap), [positions, priceMap]);
  const holding = positions.find((p) => p.coinId === coinId);

  // `amount` is USD when buying, coin quantity when selling.
  const numeric = Number(amount) || 0;
  const qty = side === 'buy' ? (price ? numeric / price : 0) : numeric;
  const notional = qty * price;
  const fee = notional * FEE;
  const total = side === 'buy' ? notional + fee : notional - fee;

  const maxSpend = side === 'buy' ? balance / (1 + FEE) : holding?.qty ?? 0;
  const canSubmit = qty > 0 && (side === 'buy' ? total <= balance + 1e-9 : qty <= (holding?.qty ?? 0) + 1e-12);

  const applyPercent = (pct) => {
    haptic?.('select');
    const v = (maxSpend * pct) / 100;
    setAmount(side === 'buy' ? v.toFixed(2) : String(Number(v.toFixed(8))));
  };

  const submit = () => {
    if (!canSubmit || !coin) return;
    const ok =
      side === 'buy'
        ? buy({ coinId: coin.id, symbol: coin.symbol, qty, price, fee: FEE })
        : sell({ coinId: coin.id, symbol: coin.symbol, qty, price, fee: FEE });
    if (ok) {
      haptic?.('success');
      setAmount('');
      setConfirming(false);
      useAppStore.getState().notify(side === 'buy' ? 'buyFilled' : 'sellFilled', 'success');
    } else {
      haptic?.('error');
      setConfirming(false);
    }
  };

  const pickerList = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const src = coins ?? [];
    return q ? src.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) : src;
  }, [coins, pickerQuery]);

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('trade.title')}</h1>
        <p className="muted">{t('trade.subtitle')}</p>
      </motion.div>

      {/* market-type switcher: spot (here), perpetuals, prediction */}
      <div className="tag-scroll">
        <button className="tag active">{t('trade.spot')}</button>
        <button className="tag" onClick={() => navigate('/perp')}>{t('nav.perp')}</button>
        <button className="tag" onClick={() => navigate('/predict')}>{t('nav.predict')}</button>
        <button className="tag" onClick={() => navigate('/swap')}>{t('nav.swap')}</button>
      </div>

      <p className="notice">{t('trade.paperNotice')}</p>

      {/* ---------- portfolio strip ---------- */}
      <motion.section className="card card-tight" variants={riseIn} initial="hidden" animate="show">
        <div className="row-between">
          <div>
            <div className="faint">{t('trade.available')}</div>
            <div className="stat-mini">
              <AnimatedNumber value={balance} format={(v) => `${fmtNum(v, 2)} NX`} />
            </div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <div className="faint">{t('trade.positionsValue')}</div>
            <div className="stat-mini">{fmtNum(portfolio.value, 2)} NX</div>
            <div className={`mono ${portfolio.pnl >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
              {fmtPct(portfolio.pnlPct)}
            </div>
          </div>
        </div>
      </motion.section>

      {/* ---------- order ticket ---------- */}
      <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
        <div className="segmented" style={{ marginBottom: 14 }}>
          {['buy', 'sell'].map((s) => (
            <button
              key={s}
              className={side === s ? 'active' : ''}
              onClick={() => {
                haptic?.('select');
                setSide(s);
                setAmount('');
              }}
              style={{ isolation: 'isolate' }}
            >
              {side === s && (
                <SegIndicator
                  id="side-ind"
                  style={{
                    background:
                      s === 'buy'
                        ? 'linear-gradient(90deg,#00ff9d,#00e5ff)'
                        : 'linear-gradient(90deg,#ff3b6b,#ff2d95)'
                  }}
                />
              )}
              {t(`trade.${s}`)}
            </button>
          ))}
        </div>

        {/* asset selector */}
        <button
          className="coin-row"
          onClick={() => setPickerOpen(true)}
          style={{ width: '100%', border: '1px solid var(--line)' }}
        >
          <CoinLogo coin={coin} />
          <div className="coin-meta" style={{ textAlign: 'start' }}>
            <div className="coin-sym">{coin?.symbol ?? '—'}</div>
            <div className="coin-name">{coin?.name ?? ''}</div>
          </div>
          <Sparkline data={coin?.sparkline?.slice(-40) ?? []} up={(coin?.change24h ?? 0) >= 0} width={54} height={24} />
          <div className="coin-right">
            <div className="mono" style={{ fontSize: 12.5 }}>${fmtPrice(price)}</div>
            <div className={`mono ${(coin?.change24h ?? 0) >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
              {fmtPct(coin?.change24h ?? 0, 1)}
            </div>
          </div>
        </button>

        <div style={{ marginTop: 14 }}>
          <label className="field-label">
            {side === 'buy' ? t('trade.amountUsd') : t('trade.amountCoin', { sym: coin?.symbol ?? '' })}
          </label>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            min="0"
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>

        <div className="row" style={{ gap: 6, marginTop: 9 }}>
          {PERCENTS.map((p) => (
            <button key={p} className="tag" style={{ flex: 1, textAlign: 'center' }} onClick={() => applyPercent(p)}>
              {p}%
            </button>
          ))}
        </div>

        <div className="stack" style={{ gap: 6, marginTop: 14 }}>
          <div className="row-between">
            <span className="faint">{side === 'buy' ? t('trade.youReceive') : t('trade.youGet')}</span>
            <span className="mono" style={{ fontSize: 12.5 }}>
              {side === 'buy' ? `${fmtQty(qty)} ${coin?.symbol ?? ''}` : `${fmtNum(total, 2)} NX`}
            </span>
          </div>
          <div className="row-between">
            <span className="faint">{t('trade.fee')} (0.1%)</span>
            <span className="mono" style={{ fontSize: 12.5 }}>{fmtNum(fee, 2)} NX</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('trade.total')}</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700 }}>{fmtNum(total, 2)} NX</span>
          </div>
          {holding && (
            <div className="row-between">
              <span className="faint">{t('trade.yourPosition')}</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {fmtQty(holding.qty)} {coin?.symbol} @ ${fmtPrice(holding.avgPrice)}
              </span>
            </div>
          )}
        </div>

        <button
          className={`btn ${side === 'buy' ? 'btn-success' : 'btn-danger'}`}
          style={{ marginTop: 14 }}
          disabled={!canSubmit}
          onClick={() => {
            haptic?.('medium');
            setConfirming(true);
          }}
        >
          {side === 'buy' ? t('trade.buyNow', { sym: coin?.symbol ?? '' }) : t('trade.sellNow', { sym: coin?.symbol ?? '' })}
        </button>
      </motion.section>

      {/* ---------- open positions ---------- */}
      {portfolio.rows.length > 0 && (
        <section>
          <p className="section-label">{t('trade.openPositions')}</p>
          <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
            {portfolio.rows.map((p) => (
              <motion.div key={p.id} className="coin-row" variants={riseIn} onClick={() => { setCoinId(p.coinId); setSide('sell'); }}>
                <div className="coin-logo">{p.symbol.slice(0, 3)}</div>
                <div className="coin-meta">
                  <div className="coin-sym">{p.symbol}</div>
                  <div className="coin-name mono">
                    {fmtQty(p.qty)} @ ${fmtPrice(p.avgPrice)}
                  </div>
                </div>
                <div className="coin-right">
                  <div className="mono" style={{ fontSize: 12.5 }}>{fmtNum(p.value, 2)} NX</div>
                  <div className={`mono ${p.pnl >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
                    {p.pnl >= 0 ? '+' : ''}{fmtNum(p.pnl, 2)} ({fmtPct(p.pnlPct, 1)})
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </section>
      )}

      {/* ---------- history ---------- */}
      {orders.length > 0 && (
        <section>
          <p className="section-label">{t('trade.history')}</p>
          <div className="card card-tight" style={{ marginTop: 8 }}>
            <AnimatePresence initial={false}>
              {orders.slice(0, 8).map((o) => (
                <motion.div
                  key={o.id}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="row-between"
                  style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}
                >
                  <span className={`pill ${o.side === 'buy' ? 'pill-up' : 'pill-down'}`}>{t(`trade.${o.side}`)}</span>
                  <span className="mono" style={{ fontSize: 11.5 }}>
                    {fmtQty(o.qty)} {o.symbol}
                  </span>
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-2)' }}>${fmtPrice(o.price)}</span>
                  <span className="faint mono">{fmtTime(o.at)}</span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </section>
      )}

      {/* ---------- asset picker ---------- */}
      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title={t('trade.selectAsset')}>
        <input
          type="text"
          value={pickerQuery}
          onChange={(e) => setPickerQuery(e.target.value)}
          placeholder={t('market.search')}
        />
        <div className="stack" style={{ gap: 6, marginTop: 10 }}>
          {pickerList.slice(0, 40).map((c) => (
            <div
              key={c.id}
              className="coin-row"
              onClick={() => {
                setCoinId(c.id);
                setPickerOpen(false);
                setPickerQuery('');
                haptic?.('select');
              }}
            >
              <CoinLogo coin={c} />
              <div className="coin-meta">
                <div className="coin-sym">{c.symbol}</div>
                <div className="coin-name">{c.name}</div>
              </div>
              <div className="coin-right">
                <div className="mono" style={{ fontSize: 12 }}>${fmtPrice(c.price)}</div>
                <div className={`mono ${c.change24h >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10 }}>
                  {fmtPct(c.change24h, 1)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Sheet>

      {/* ---------- confirm ---------- */}
      <Sheet open={confirming} onClose={() => setConfirming(false)} title={t('trade.confirmTitle')}>
        <div className="card card-tight stack" style={{ gap: 8 }}>
          <div className="row-between">
            <span className="faint">{t('trade.action')}</span>
            <span className={side === 'buy' ? 'up' : 'down'} style={{ fontWeight: 700 }}>
              {t(`trade.${side}`)} {coin?.symbol}
            </span>
          </div>
          <div className="row-between">
            <span className="faint">{t('trade.quantity')}</span>
            <span className="mono">{fmtQty(qty)}</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('trade.price')}</span>
            <span className="mono">${fmtPrice(price)}</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('trade.total')}</span>
            <span className="mono" style={{ fontWeight: 700 }}>{fmtNum(total, 2)} NX</span>
          </div>
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14 }}>
          <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
            {t('common.cancel')}
          </button>
          <button className={`btn ${side === 'buy' ? 'btn-success' : 'btn-danger'}`} onClick={submit}>
            {t('common.confirm')}
          </button>
        </div>
      </Sheet>
    </PageTransition>
  );
}
