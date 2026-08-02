import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import Sparkline from '../components/Sparkline';
import AnimatedNumber from '../components/AnimatedNumber';
import { useMarkets } from '../hooks/useMarket';
import { fmtNum, fmtPct, fmtPrice } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import SegIndicator from '../components/SegIndicator';

/**
 * UP / DOWN market prediction rounds.
 *
 * Settlement uses the *live* market price at expiry — no RNG. Payout is
 * 1.9× the stake on a correct call (5% edge), stake returned on an exact tie.
 * Still virtual NX: real-money binary options are a regulated derivative
 * (and banned for retail in the UK/EU), so don't wire real funds into this.
 */

const DURATIONS = [
  { key: '1m', ms: 60000 },
  { key: '5m', ms: 300000 },
  { key: '15m', ms: 900000 }
];

const PAYOUT_X = 1.9;

export default function Predict() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();

  const { data: coins } = useMarkets(30);
  const balance = useAppStore((s) => s.balance);
  const bets = useAppStore((s) => s.bets);
  const debit = useAppStore((s) => s.debit);
  const recordBet = useAppStore((s) => s.recordBet);
  const settleBet = useAppStore((s) => s.settleBet);

  const [coinId, setCoinId] = useState('bitcoin');
  const [duration, setDuration] = useState(DURATIONS[0]);
  const [stake, setStake] = useState('50');
  const [now, setNow] = useState(Date.now());

  const coin = useMemo(() => (coins ?? []).find((c) => c.id === coinId), [coins, coinId]);
  const priceMap = useMemo(() => Object.fromEntries((coins ?? []).map((c) => [c.id, c.price])), [coins]);

  const open = bets.filter((b) => b.game === 'predict' && !b.settled);
  const settled = bets.filter((b) => b.game === 'predict' && b.settled).slice(0, 8);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // settle anything that has expired, using the freshest price we have
  useEffect(() => {
    open.forEach((b) => {
      if (now < b.expiresAt) return;
      const closePrice = priceMap[b.coinId];
      if (!closePrice) return;
      const delta = closePrice - b.openPrice;
      const won = b.dir === 'up' ? delta > 0 : delta < 0;
      const tie = delta === 0;
      settleBet(b.id, {
        won: won && !tie,
        payout: tie ? b.stake : won ? b.stake * PAYOUT_X : 0,
        result: { closePrice, delta }
      });
      haptic?.(won && !tie ? 'success' : 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, priceMap]);

  const amt = Number(stake) || 0;
  const canBet = coin && amt > 0 && amt <= balance;

  const place = (dir) => {
    if (!canBet) return;
    if (!debit(amt)) return;
    haptic?.('medium');
    recordBet({
      game: 'predict',
      coinId: coin.id,
      symbol: coin.symbol,
      dir,
      stake: amt,
      openPrice: coin.price,
      duration: duration.key,
      expiresAt: Date.now() + duration.ms
    });
    useAppStore.getState().notify('predictionPlaced', 'info');
  };

  return (
    <PageTransition>
      <motion.div className="row-between" variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)}>‹</button>
        <div style={{ textAlign: 'center' }}>
          <h1 className="h1" style={{ fontSize: 18 }}>{t('predict.title')}</h1>
          <p className="faint">{t('predict.subtitle')}</p>
        </div>
        <div style={{ width: 34 }} />
      </motion.div>

      <p className="notice notice-danger">{t('predict.riskNotice')}</p>

      {/* ---------- asset strip ---------- */}
      <div className="tag-scroll">
        {(coins ?? []).slice(0, 12).map((c) => (
          <button key={c.id} className={`tag ${coinId === c.id ? 'active' : ''}`} onClick={() => setCoinId(c.id)}>
            {c.symbol}
          </button>
        ))}
      </div>

      {/* ---------- live price ---------- */}
      <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <div className="row-between">
          <div className="row" style={{ gap: 9 }}>
            <div className="coin-logo">{coin?.image ? <img src={coin.image} alt="" /> : coin?.symbol?.slice(0, 3)}</div>
            <div>
              <div style={{ fontWeight: 700 }}>{coin?.symbol}</div>
              <div className="faint">{coin?.name}</div>
            </div>
          </div>
          <div style={{ textAlign: 'end' }}>
            <div className="stat-mini">
              <AnimatedNumber value={coin?.price ?? 0} format={(v) => `$${fmtPrice(v)}`} />
            </div>
            <div className={`mono ${(coin?.change24h ?? 0) >= 0 ? 'up' : 'down'}`} style={{ fontSize: 11 }}>
              {fmtPct(coin?.change24h ?? 0)}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <Sparkline data={coin?.sparkline?.slice(-60) ?? []} up={(coin?.change24h ?? 0) >= 0} width={460} height={56} strokeWidth={2} />
        </div>
      </motion.section>

      <div className="segmented">
        {DURATIONS.map((d) => (
          <button key={d.key} className={duration.key === d.key ? 'active' : ''} onClick={() => setDuration(d)} style={{ isolation: 'isolate' }}>
            {duration.key === d.key && (
              <SegIndicator id="dur-ind" />
            )}
            {d.key}
          </button>
        ))}
      </div>

      <div>
        <label className="field-label">{t('game.stake')}</label>
        <input type="number" value={stake} min="1" onChange={(e) => setStake(e.target.value)} />
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          {[10, 50, 100, 500].map((v) => (
            <button key={v} className="tag" style={{ flex: 1, textAlign: 'center' }} onClick={() => setStake(String(v))}>
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="card card-tight row-between">
        <span className="faint">{t('predict.payout')}</span>
        <span className="mono up">{PAYOUT_X}× → +{fmtNum(amt * PAYOUT_X - amt, 2)} NX</span>
      </div>

      <div className="row" style={{ gap: 10 }}>
        <motion.button className="btn btn-success" whileTap={{ scale: 0.96 }} disabled={!canBet} onClick={() => place('up')}>
          ▲ {t('predict.up')}
        </motion.button>
        <motion.button className="btn btn-danger" whileTap={{ scale: 0.96 }} disabled={!canBet} onClick={() => place('down')}>
          ▼ {t('predict.down')}
        </motion.button>
      </div>

      {/* ---------- open rounds ---------- */}
      {open.length > 0 && (
        <section>
          <p className="section-label">{t('predict.openRounds')}</p>
          <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
            <AnimatePresence>
              {open.map((b) => {
                const remain = Math.max(0, b.expiresAt - now);
                const pct = 100 - (remain / (DURATIONS.find((d) => d.key === b.duration)?.ms ?? 60000)) * 100;
                const live = priceMap[b.coinId] ?? b.openPrice;
                const winning = b.dir === 'up' ? live > b.openPrice : live < b.openPrice;
                return (
                  <motion.div key={b.id} className="card card-tight" layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}>
                    <div className="row-between">
                      <span className={`pill ${b.dir === 'up' ? 'pill-up' : 'pill-down'}`}>
                        {b.dir === 'up' ? '▲' : '▼'} {b.symbol}
                      </span>
                      <span className="mono" style={{ fontSize: 11.5 }}>{fmtNum(b.stake, 0)} NX</span>
                      <span className={`mono ${winning ? 'up' : 'down'}`} style={{ fontSize: 11.5 }}>
                        ${fmtPrice(live)}
                      </span>
                      <span className="mono faint">{Math.ceil(remain / 1000)}s</span>
                    </div>
                    <div className="progress" style={{ marginTop: 8 }}>
                      <motion.div className="progress-fill" animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: 'linear' }} />
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        </section>
      )}

      {/* ---------- results ---------- */}
      {settled.length > 0 && (
        <section>
          <p className="section-label">{t('predict.results')}</p>
          <div className="card card-tight" style={{ marginTop: 8 }}>
            {settled.map((b) => (
              <div key={b.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <span className={`pill ${b.dir === 'up' ? 'pill-up' : 'pill-down'}`}>
                  {b.dir === 'up' ? '▲' : '▼'} {b.symbol}
                </span>
                <span className="mono faint" style={{ fontSize: 11 }}>${fmtPrice(b.openPrice)} → ${fmtPrice(b.result?.closePrice)}</span>
                <span className={`mono ${b.won ? 'up' : 'down'}`} style={{ fontSize: 11.5, fontWeight: 700 }}>
                  {b.won ? `+${fmtNum(b.payout - b.stake, 2)}` : `-${fmtNum(b.stake, 2)}`}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </PageTransition>
  );
}
