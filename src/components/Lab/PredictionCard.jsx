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
 *
 * ─── VISUAL PASS ────────────────────────────────────────────────────────────
 * The price panel now leads with `PriceBlock` (tabular numerals, a pair tag and
 * a blinking LIVE pill) over a smoothed, self-drawing `Sparkline`. Coin and
 * duration pickers are `LabChips` — coin chips carry a monogram tile in the
 * coin's own colour, so the strip reads as a row of assets rather than a row of
 * identical grey pills. Confidence is a `LabSlider`, which shows its filled
 * track and the live percentage while the thumb is under your finger.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AICoach,
  DirGlyph,
  LAB_EASE,
  LabBack,
  LabChips,
  LabSlider,
  Meter,
  Notice,
  Panel,
  PriceBlock,
  Row,
  Sparkline
} from './Shared';
import { IconCheck, IconClock, IconXCircle, LabIcon } from './LabIcons';
import { COINS, getPrices, tickPrice } from '../../lib/lab/marketData';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const DURATIONS = [
  { key: '1m', ms: 60000, icon: 'bolt' },
  { key: '5m', ms: 300000, icon: 'clock' },
  { key: '15m', ms: 900000, icon: 'hourglass' }
];

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
    const id = setInterval(() => {
      setLivePrice((prev) => (prev ? tickPrice(coinId, prev, 0) : prev));
    }, 3000);
    return () => clearInterval(id);
  }, [coinId]);

  // Tick the countdown clock every 1s
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
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
  const coin = COINS.find((c) => c.id === coinId);
  const symbol = coin?.symbol;

  const coinChips = COINS.slice(0, 6).map((c) => ({
    id: c.id,
    label: c.symbol,
    color: c.color,
    initials: c.symbol.slice(0, 3)
  }));

  const durationChips = DURATIONS.map((d) => ({
    id: d.key,
    label: t(`lab2.durations.${d.key}`),
    icon: d.icon
  }));

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        icon="flask"
        accent="violet"
        title={t('lab2.screens.predict.title')}
        sub={t('lab2.screens.predict.sub')}
      />

      <Panel title={`${symbol} · ${t('lab2.prediction.livePrice')}`} icon="activity" accent="cyan">
        <PriceBlock price={livePrice} pair={t('lab2.prediction.vsUsd')} loading={livePrice == null} />
        <Sparkline data={history} />
        <div className="lab2-row">
          <span>
            <LabIcon name="robot" width={14} height={14} style={{ verticalAlign: '-2px', marginInlineEnd: 6 }} />
            {t('lab2.prediction.aiPredicts')}
          </span>
          <strong
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: aiDir === 'up' ? 'var(--up)' : aiDir === 'down' ? 'var(--down)' : 'var(--text-2)'
            }}
          >
            <DirGlyph dir={aiDir} />
            {aiDir === 'up' ? t('lab2.up') : aiDir === 'down' ? t('lab2.down') : t('lab2.neutral')}
          </strong>
        </div>
      </Panel>

      <Panel title={t('lab2.prediction.coin')} icon="coins" accent="amber">
        <LabChips
          items={coinChips}
          value={coinId}
          layoutId="predict-coin"
          accent="amber"
          onChange={(id) => { setCoinId(id); setActiveId(null); }}
        />
      </Panel>

      <Panel title={t('lab2.prediction.duration')} icon="clock" accent="cyan">
        <LabChips
          items={durationChips}
          value={duration.key}
          layoutId="predict-duration"
          accent="cyan"
          onChange={(id) => setDuration(DURATIONS.find((d) => d.key === id) ?? DURATIONS[0])}
        />
      </Panel>

      <Panel title={t('lab2.prediction.confidence')} icon="gauge" accent="violet">
        <LabSlider
          value={confidence}
          min={10}
          max={100}
          step={5}
          accent="violet"
          onChange={setConfidence}
          display={<span className="lab2-num">{confidence}%</span>}
        />
        <div className="lab2-row" style={{ border: 'none', paddingBlock: 0 }}>
          <span className="lab2-muted">{t('lab2.prediction.guess')}</span>
          <span className="lab2-muted">{t('lab2.prediction.strongConviction')}</span>
        </div>
      </Panel>

      <AnimatePresence mode="wait">
        {!activeId ? (
          <motion.div
            key="call"
            className="lab2-choices"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.26, ease: LAB_EASE }}
          >
            <button className="lab2-btn buy full" type="button" onClick={() => onPredict('up')}>
              <DirGlyph dir="up" size={17} />
              {t('lab2.up')}
            </button>
            <button className="lab2-btn sell full" type="button" onClick={() => onPredict('down')}>
              <DirGlyph dir="down" size={17} />
              {t('lab2.down')}
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="round"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.34, ease: LAB_EASE }}
          >
            <ActiveRound myOpen={myOpen} now={now} livePrice={livePrice} coinId={coinId} />
          </motion.div>
        )}
      </AnimatePresence>

      <AICoach
        tone={confidence < 40 ? 'warn' : 'neutral'}
        message={
          activeId
            ? t('lab2.prediction.coachLive')
            : confidence < 40
            ? t('lab2.prediction.coachLowConfidence')
            : t('lab2.prediction.coachNeutral')
        }
      />

      {closed.length > 0 && (
        <Panel title={t('lab2.prediction.recentCalls')} icon="layers" accent="magenta">
          {closed.map((p) => {
            const sym = COINS.find((c) => c.id === p.coinId)?.symbol ?? p.coinId;
            return (
              <div key={p.id} className="lab2-row">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <DirGlyph dir={p.dir} size={14} />
                  {sym} · <span className="lab2-num">{p.confidence}%</span>
                </span>
                <strong
                  className={p.correct ? 'pos' : 'neg'}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {p.correct ? <IconCheck width={14} height={14} /> : <IconXCircle width={14} height={14} />}
                  <span className="lab2-num">{p.accuracy.toFixed(0)}%</span>
                </strong>
              </div>
            );
          })}
        </Panel>
      )}

      {closedMine.length > 0 && (
        <Panel title={t('lab2.prediction.yourAccuracyVsAi')} icon="scale" accent="cyan">
          {closedMine.map((p) => {
            const sym = COINS.find((c) => c.id === p.coinId)?.symbol ?? p.coinId;
            const aiAcc = 50 + Math.random() * 30; // the AI's own accuracy; simulated
            return (
              <div key={p.id} className="lab2-row">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <DirGlyph dir={p.dir} size={14} />
                  {sym}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {t('lab2.you')}
                  <strong className={p.correct ? 'pos' : 'neg'}>
                    <span className="lab2-num">{p.accuracy.toFixed(0)}%</span>
                  </strong>
                  <span className="lab2-vs" style={{ width: 22, height: 22, fontSize: 8 }}>VS</span>
                  {t('lab2.prediction.ai')}
                  <strong>
                    <span className="lab2-num">{aiAcc.toFixed(0)}%</span>
                  </strong>
                </span>
              </div>
            );
          })}
        </Panel>
      )}

      <Panel title={t('lab2.prediction.yourStanding')} icon="medal" accent="amber">
        <Row label={t('lab2.prediction.xp')} value={<span className="lab2-num">{xp.toLocaleString()}</span>} />
        <Row label={t('lab2.prediction.globalRank')} value={`#${rank}`} />
        <Row label={t('lab2.prediction.totalPredictions')} value={<span className="lab2-num">{predictions.length}</span>} />
      </Panel>

      <Notice variant="tip" icon="cap">
        {t('lab2.prediction.notice')}
      </Notice>
    </div>
  );
}

function ActiveRound({ myOpen, now, livePrice, coinId }) {
  const { t } = useTranslation();
  if (!myOpen) return null;
  const remaining = Math.max(0, myOpen.expiry - now);
  const totalMs = Math.max(1, myOpen.expiry - myOpen.at);
  const pct = Math.max(0, Math.min(100, (1 - remaining / totalMs) * 100));
  const symbol = COINS.find((c) => c.id === coinId)?.symbol ?? coinId;
  const inProfit = livePrice != null && (myOpen.dir === 'up' ? livePrice >= myOpen.entryPrice : livePrice <= myOpen.entryPrice);

  return (
    <Panel title={`${t('lab2.prediction.openRound')} · ${symbol}`} icon="clock" accent="magenta">
      <Row label={t('lab2.prediction.entry')} value={<span className="lab2-num">${myOpen.entryPrice?.toLocaleString('en-US', { maximumFractionDigits: myOpen.entryPrice < 1 ? 5 : 2 })}</span>} />
      <Row
        label={t('lab2.prediction.yourCall')}
        value={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <DirGlyph dir={myOpen.dir} size={14} />
            {myOpen.dir === 'up' ? t('lab2.up') : t('lab2.down')}
          </span>
        }
        valueClass={myOpen.dir === 'up' ? 'pos' : 'neg'}
      />
      <Row label={t('lab2.prediction.confidenceLabel')} value={<span className="lab2-num">{myOpen.confidence}%</span>} />

      <div className="lab2-stack" style={{ gap: 6 }}>
        <Meter value={pct} accent={inProfit ? 'mint' : 'magenta'} animate={false} />
        <div className="lab2-row" style={{ border: 'none', paddingBlock: 0, justifyContent: 'center', gap: 6 }}>
          <IconClock width={13} height={13} />
          <span className="lab2-muted lab2-num">{t('lab2.prediction.secondsRemaining', { s: Math.ceil(remaining / 1000) })}</span>
        </div>
      </div>
    </Panel>
  );
}
