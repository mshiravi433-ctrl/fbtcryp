/**
 * Prediction card — interactive up/down call on a coin.
 *
 * ─── WHY A SEPARATE COMPONENT (NOT THE EXISTING Predict.jsx) ────────────────
 * The existing Predict page is built around the `bets` ledger in
 * useAppStore, settled on live ticks. It is wired to the main balance, has
 * a payout multiplier, and is gated by SPECULATION_ENABLED.
 *
 * Lab's prediction is a *learning* tool, not a betting screen. It uses the
 * Lab balance (separate ledger, separate XP system), it compares the user's
 * call against an "AI prediction" and against the real outcome, and the
 * whole point is to teach pattern recognition, not to pay out 1.9×.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { LabBack, AICoach, Panel, Row, Notice, ResultCard, Sparkline } from './Shared';
import { COINS, getPrices, tickPrice } from '../../lib/lab/marketData';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const DURATIONS = [
  { key: '1m', ms: 60000 },
  { key: '5m', ms: 300000 },
  { key: '15m', ms: 900000 }
];

const PREDICTIONS_KEY = 'fbt-lab-predictions-v1';

function aiHeuristic(coin, recent) {
  // Simple: short MA vs long MA, returns 'up' or 'down'.
  if (!recent || recent.length < 10) return 'flat';
  const short = recent.slice(-5).reduce((s, p) => s + p, 0) / 5;
  const long = recent.slice(-15).reduce((s, p) => s + p, 0) / 15;
  return short > long ? 'up' : 'down';
}

export default function PredictionCard({ onBack }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const recordPrediction = useLabStore((s) => s.recordPrediction);
  const settlePrediction = useLabStore((s) => s.settlePrediction);
  const predictions = useLabStore((s) => s.predictions);
  const xp = useLabStore((s) => s.xp);
  const rank = useLabStore((s) => {
    const lb = [...s.leaderboard].sort((a, b) => b.xp - a.xp);
    const idx = lb.findIndex((r) => r.isYou);
    return idx >= 0 ? idx + 1 : '—';
  });

  const [coinId, setCoinId] = useState('bitcoin');
  const [duration, setDuration] = useState(DURATIONS[0]);
  const [confidence, setConfidence] = useState(60);
  const [dir, setDir] = useState(null);
  const [entryPrice, setEntryPrice] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [livePrice, setLivePrice] = useState(null);
  const [history, setHistory] = useState([]);

  // Fetch prices + build a 30-tick history for the AI heuristic
  useEffect(() => {
    let alive = true;
    (async () => {
      const prices = await getPrices([coinId]);
      if (!alive) return;
      const p = prices[coinId];
      setLivePrice(p);
      const h = [];
      for (let i = 0; i < 30; i++) h.push(tickPrice(coinId, p, -i));
      setHistory(h.reverse());
    })();
    return () => { alive = false; };
  }, [coinId]);

  // Tick the live price every 3s for the sparkline feel
  useEffect(() => {
    const t = setInterval(() => {
      setLivePrice((prev) => {
        if (!prev) return prev;
        return tickPrice(coinId, prev, 0);
      });
    }, 3000);
    return () => clearInterval(t);
  }, [coinId]);

  // Tick the countdown clock every 1s
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const aiDir = useMemo(() => aiHeuristic(coinId, history), [history, coinId]);

  const open = predictions.filter((p) => !p.settled);
  const closed = predictions.filter((p) => p.settled).slice(0, 5);
  const myOpen = open.find((p) => p.id === activeId);

  // Auto-settle when an open round expires
  useEffect(() => {
    if (!myOpen) return;
    const remaining = myOpen.expiry - now;
    if (remaining <= 0) {
      const exit = livePrice ?? tickPrice(coinId, myOpen.entryPrice, 99);
      settlePrediction(myOpen.id, exit);
      haptic?.('success');
    }
  }, [now, myOpen, livePrice, coinId, settlePrediction, haptic]);

  const onPredict = (chosenDir) => {
    if (!livePrice || activeId) return;
    haptic?.('select');
    setDir(chosenDir);
    setEntryPrice(livePrice);
    const id = recordPrediction({
      coinId,
      dir: chosenDir,
      confidence,
      entryPrice: livePrice,
      expiry: Date.now() + duration.ms
    });
    setActiveId(id);
  };

  const closedMine = predictions.filter((p) => p.settled && p.coinId === coinId).slice(0, 3);
  const symbol = COINS.find((c) => c.id === coinId)?.symbol;

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title={`🔮 ${t('lab2.screens.predict.title')}`} sub={t('lab2.screens.predict.sub')} />

      <Panel title={`${symbol} · ${t('lab2.prediction.livePrice')}`}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div className="lab2-num" style={{ fontSize: 28, fontWeight: 700 }}>
            ${livePrice?.toLocaleString('en-US', { maximumFractionDigits: livePrice < 1 ? 5 : 2 }) ?? '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t('lab2.prediction.vsUsd')}</div>
        </div>
        <Sparkline data={history} />
        <div className="lab2-row">
          <span>{t('lab2.prediction.aiPredicts')}</span>
          <strong style={{ color: aiDir === 'up' ? 'var(--up)' : aiDir === 'down' ? 'var(--down)' : 'var(--text-2)' }}>
            {aiDir === 'up' ? `📈 ${t('lab2.up')}` : aiDir === 'down' ? `📉 ${t('lab2.down')}` : `➖ ${t('lab2.neutral')}`}
          </strong>
        </div>
      </Panel>

      <Panel title={t('lab2.prediction.coin')}>
        <div className="lab2-defi-tabs">
          {COINS.slice(0, 6).map((c) => (
            <button
              key={c.id}
              className={`lab2-defi-tab ${coinId === c.id ? 'active' : ''}`}
              onClick={() => { setCoinId(c.id); setActiveId(null); }}
            >
              {c.symbol}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={t('lab2.prediction.duration')}>
        <div className="lab2-defi-tabs">
          {DURATIONS.map((d) => (
            <button
              key={d.key}
              className={`lab2-defi-tab ${duration.key === d.key ? 'active' : ''}`}
              onClick={() => setDuration(d)}
            >
              {t(`lab2.durations.${d.key}`)}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={`${t('lab2.prediction.confidence')}: ${confidence}%`}>
        <input
          type="range"
          min="10"
          max="100"
          step="5"
          value={confidence}
          onChange={(e) => setConfidence(Number(e.target.value))}
          className="lab2-slider"
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>
          <span>{t('lab2.prediction.guess')}</span>
          <span>{t('lab2.prediction.strongConviction')}</span>
        </div>
      </Panel>

      {!activeId ? (
        <div className="lab2-choices">
          <button className="lab2-btn buy full" onClick={() => onPredict('up')}>
            📈 {t('lab2.up')}
          </button>
          <button className="lab2-btn sell full" onClick={() => onPredict('down')}>
            📉 {t('lab2.down')}
          </button>
        </div>
      ) : (
        <ActiveRound myOpen={myOpen} now={now} entryPrice={entryPrice} coinId={coinId} />
      )}

      <AICoach
        message={
          activeId
            ? t('lab2.prediction.coachLive')
            : confidence < 40
            ? t('lab2.prediction.coachLowConfidence')
            : t('lab2.prediction.coachNeutral')
        }
      />

      {closed.length > 0 && (
        <Panel title={t('lab2.prediction.recentCalls')}>
          {closed.map((p) => {
            const sym = COINS.find((c) => c.id === p.coinId)?.symbol ?? p.coinId;
            const move = ((p.exitPrice - p.entryPrice) / p.entryPrice) * 100;
            return (
              <div key={p.id} className="lab2-row">
                <span>
                  {sym} · {p.dir === 'up' ? '📈' : '📉'} <span className="lab2-num">{p.confidence}%</span>
                </span>
                <strong className={p.correct ? 'pos' : 'neg'}>
                  {p.correct ? '✓' : '✗'} <span className="lab2-num">{p.accuracy.toFixed(0)}%</span>
                </strong>
              </div>
            );
          })}
        </Panel>
      )}

      {closedMine.length > 0 && (
        <Panel title={t('lab2.prediction.yourAccuracyVsAi')}>
          {closedMine.map((p) => {
            const sym = COINS.find((c) => c.id === p.coinId)?.symbol ?? p.coinId;
            const aiAcc = 50 + Math.random() * 30; // the AI's own accuracy; simulated
            return (
              <div key={p.id} className="lab2-row">
                <span>{sym} · {p.dir === 'up' ? '📈' : '📉'}</span>
                <span>
                  {t('lab2.you')} <strong className={p.correct ? 'pos' : 'neg'}><span className="lab2-num">{p.accuracy.toFixed(0)}%</span></strong> · {t('lab2.prediction.ai')} <strong><span className="lab2-num">{aiAcc.toFixed(0)}%</span></strong>
                </span>
              </div>
            );
          })}
        </Panel>
      )}

      <Panel title={t('lab2.prediction.yourStanding')}>
        <Row label={t('lab2.prediction.xp')} value={<span className="lab2-num">{xp.toLocaleString()}</span>} />
        <Row label={t('lab2.prediction.globalRank')} value={`#${rank}`} />
        <Row label={t('lab2.prediction.totalPredictions')} value={<span className="lab2-num">{predictions.length}</span>} />
      </Panel>

      <Notice icon="🎓">
        {t('lab2.prediction.notice')}
      </Notice>
    </div>
  );
}

function ActiveRound({ myOpen, now, entryPrice, coinId }) {
  const { t } = useTranslation();
  const remaining = Math.max(0, myOpen.expiry - now);
  const totalMs = myOpen.expiry - myOpen.at;
  const pct = Math.max(0, Math.min(100, (1 - remaining / totalMs) * 100));
  const symbol = COINS.find((c) => c.id === coinId)?.symbol ?? coinId;

  return (
    <Panel title={`${t('lab2.prediction.openRound')} · ${symbol}`}>
      <Row label={t('lab2.prediction.entry')} value={<span className="lab2-num">${entryPrice?.toLocaleString('en-US', { maximumFractionDigits: entryPrice < 1 ? 5 : 2 })}</span>} />
      <Row label={t('lab2.prediction.yourCall')} value={myOpen.dir === 'up' ? `📈 ${t('lab2.up')}` : `📉 ${t('lab2.down')}`} />
      <Row label={t('lab2.prediction.confidenceLabel')} value={<span className="lab2-num">{myOpen.confidence}%</span>} />
      <div style={{ marginTop: 6 }}>
        <div className="lab2-bar">
          <motion.div
            className="lab2-bar-fill"
            animate={{ width: `${pct}%` }}
            transition={{ duration: 1, ease: 'linear' }}
          />
        </div>
        <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
          ⏱ {t('lab2.prediction.secondsRemaining', { s: Math.ceil(remaining / 1000) })}
        </div>
      </div>
    </Panel>
  );
}
