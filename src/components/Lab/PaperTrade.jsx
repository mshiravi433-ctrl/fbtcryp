/**
 * Paper Trading — open and close a virtual position with full
 * stop-loss / take-profit / risk discipline.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LabBack, AICoach, Panel, Row, Notice, ResultCard, Sparkline } from './Shared';
import { COINS, getPrices, tickPrice } from '../../lib/lab/marketData';
import { calcPositionSize } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

export default function PaperTrade({ onBack }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const balance = useLabStore((s) => s.balance);
  const openTrade = useLabStore((s) => s.openPaperTrade);
  const closeTrade = useLabStore((s) => s.closePaperTrade);
  const trades = useLabStore((s) => s.paperTrades);
  const winRateFn = useLabStore((s) => s.winRate);

  const [coinId, setCoinId] = useState('bitcoin');
  const [side, setSide] = useState('buy');
  const [entry, setEntry] = useState(null);
  const [qty, setQty] = useState(0.05);
  const [stop, setStop] = useState('');
  const [tp, setTp] = useState('');
  const [livePrice, setLivePrice] = useState(null);
  const [history, setHistory] = useState([]);
  const [result, setResult] = useState(null); // last closed trade
  const [now, setNow] = useState(Date.now());

  // Fetch + tick
  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await getPrices([coinId]);
      if (!alive) return;
      const px = p[coinId];
      setLivePrice(px);
      setEntry(px);
      // Default stop/tp around entry
      setStop((px * 0.97).toFixed(px < 1 ? 5 : 2));
      setTp((px * 1.08).toFixed(px < 1 ? 5 : 2));
      const h = [];
      for (let i = 0; i < 30; i++) h.push(tickPrice(coinId, px, -i));
      setHistory(h.reverse());
    })();
    return () => { alive = false; };
  }, [coinId]);

  useEffect(() => {
    const t = setInterval(() => {
      setLivePrice((prev) => (prev ? tickPrice(coinId, prev, 0) : prev));
    }, 3000);
    return () => clearInterval(t);
  }, [coinId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const open = trades.filter((t) => !t.closed)[0];
  const closed = trades.filter((t) => t.closed).slice(0, 5);

  // Auto-close when SL/TP hit (paper-trade simulator)
  useEffect(() => {
    if (!open || !livePrice) return;
    if (open.stop && ((open.side === 'buy' && livePrice <= open.stop) || (open.side === 'sell' && livePrice >= open.stop))) {
      closeTrade(open.id, open.stop);
      setResult({ reason: 'stop' });
      haptic?.('warning');
    } else if (open.tp && ((open.side === 'buy' && livePrice >= open.tp) || (open.side === 'sell' && livePrice <= open.tp))) {
      closeTrade(open.id, open.tp);
      setResult({ reason: 'tp' });
      haptic?.('success');
    }
  }, [livePrice, open, closeTrade, haptic]);

  const submit = () => {
    if (!entry) return;
    if (open) {
      // Close at current
      closeTrade(open.id, livePrice ?? entry);
      setResult({ reason: 'manual' });
      haptic?.('select');
      return;
    }
    const stopN = Number(stop) || 0;
    const tpN = Number(tp) || 0;
    openTrade({
      symbol: coinId,
      side,
      qty: Number(qty) || 0,
      entry: Number(entry),
      stop: stopN || null,
      tp: tpN || null
    });
    haptic?.('success');
  };

  // Position sizing hint
  const sizing = useMemo(() => {
    if (!entry) return null;
    return calcPositionSize({ capital: balance, riskPct: 1, stopLossPct: 2, entryPrice: entry });
  }, [entry, balance]);

  const riskPctEntry = useMemo(() => {
    if (!entry || !Number(stop)) return 0;
    return Math.abs((Number(stop) - entry) / entry) * 100;
  }, [entry, stop]);

  const rewardPctEntry = useMemo(() => {
    if (!entry || !Number(tp)) return 0;
    return Math.abs((Number(tp) - entry) / entry) * 100;
  }, [entry, tp]);

  const rr = riskPctEntry > 0 ? rewardPctEntry / riskPctEntry : 0;
  const positionValue = (Number(qty) || 0) * (entry || 0);
  const sizePct = balance > 0 ? (positionValue / balance) * 100 : 0;
  const potentialLoss = positionValue * (riskPctEntry / 100);
  const potentialProfit = positionValue * (rewardPctEntry / 100);

  // Coach triggers
  const coachMsg = open
    ? t('lab2.paper.coachLive')
    : !Number(stop)
    ? t('lab2.paper.coachNoStop')
    : !Number(tp)
    ? t('lab2.paper.coachNoTp')
    : sizePct > 10
    ? t('lab2.paper.coachOverSize')
    : rr < 1.5
    ? t('lab2.paper.coachBadRr')
    : t('lab2.paper.coachGood');

  if (result && !open) {
    const last = trades.find((t) => t.closed);
    if (last && !result.closed) {
      result.closed = last;
    }
  }

  const reasonLabel = result?.reason === 'stop'
    ? t('lab2.paper.stopLossHit')
    : result?.reason === 'tp'
    ? t('lab2.paper.takeProfitHit')
    : t('lab2.paper.closedManually');

  const symbol = COINS.find((c) => c.id === coinId)?.symbol;

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title={`📈 ${t('lab2.screens.paper.title')}`} sub={t('lab2.screens.paper.sub')} />

      <Panel title={`${symbol} · ${t('lab2.paper.livePrice')}`}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div className="lab2-num" style={{ fontSize: 28, fontWeight: 700 }}>
            ${livePrice?.toLocaleString('en-US', { maximumFractionDigits: livePrice < 1 ? 5 : 2 }) ?? '—'}
          </div>
        </div>
        <Sparkline data={history} />
      </Panel>

      <Panel title={t('lab2.paper.coin')}>
        <div className="lab2-defi-tabs">
          {COINS.slice(0, 6).map((c) => (
            <button
              key={c.id}
              className={`lab2-defi-tab ${coinId === c.id ? 'active' : ''}`}
              onClick={() => setCoinId(c.id)}
            >
              {c.symbol}
            </button>
          ))}
        </div>
      </Panel>

      {!open ? (
        <>
          <Panel title={t('lab2.paper.side')}>
            <div className="lab2-choices">
              <button className={`lab2-btn buy full ${side === 'buy' ? '' : 'ghost'}`} onClick={() => setSide('buy')}>
                📈 {t('lab2.paper.buyLong')}
              </button>
              <button className={`lab2-btn sell full ${side === 'sell' ? '' : 'ghost'}`} onClick={() => setSide('sell')}>
                📉 {t('lab2.paper.sellShort')}
              </button>
            </div>
          </Panel>

          <Panel title={t('lab2.paper.order')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="lab2-input-label">{t('lab2.paper.quantity')}</label>
                <input
                  className="lab2-input lab2-num"
                  type="number"
                  step="0.001"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
              <div>
                <label className="lab2-input-label">{t('lab2.paper.stopLossPrice')}</label>
                <input
                  className="lab2-input lab2-num"
                  type="number"
                  step="0.01"
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                  placeholder="—"
                />
              </div>
              <div>
                <label className="lab2-input-label">{t('lab2.paper.takeProfitPrice')}</label>
                <input
                  className="lab2-input lab2-num"
                  type="number"
                  step="0.01"
                  value={tp}
                  onChange={(e) => setTp(e.target.value)}
                  placeholder="—"
                />
              </div>
            </div>
          </Panel>

          <Panel title={t('lab2.paper.tradeMath')}>
            <Row label={t('lab2.paper.positionValue')} value={<span className="lab2-num">${positionValue.toFixed(2)}</span>} />
            <Row label={t('lab2.paper.size')} value={t('lab2.paper.ofBalance', { pct: sizePct.toFixed(1) })} valueClass={sizePct > 10 ? 'neg' : sizePct > 5 ? '' : 'pos'} />
            <Row label={t('lab2.paper.risk')} value={<span className="lab2-num">{riskPctEntry.toFixed(2)}% · ${potentialLoss.toFixed(2)}</span>} valueClass="neg" />
            <Row label={t('lab2.paper.reward')} value={<span className="lab2-num">{rewardPctEntry.toFixed(2)}% · ${potentialProfit.toFixed(2)}</span>} valueClass="pos" />
            <Row label={t('lab2.paper.rr')} value={<span className="lab2-num">1 : {rr.toFixed(2)}</span>} valueClass={rr >= 3 ? 'pos' : rr >= 1.5 ? '' : 'neg'} />
          </Panel>

          <button className={`lab2-btn ${side === 'buy' ? 'buy' : 'sell'} full`} onClick={submit}>
            {t('lab2.paper.execute', { action: side === 'buy' ? t('lab2.paper.buy') : t('lab2.paper.sell') })}
          </button>
        </>
      ) : (
        <OpenPosition open={open} livePrice={livePrice} now={now} onClose={submit} />
      )}

      <AICoach message={coachMsg} />

      {result && !open && result.closed && (
        <ResultCard
          kind={result.closed.pnl >= 0 ? 'win' : 'loss'}
          emoji={result.closed.pnl >= 0 ? '🏆' : '📉'}
          title={`${t('lab2.paper.positionClosed')} · ${reasonLabel}`}
          sub={result.closed.pnl >= 0 ? t('lab2.paper.disciplinePays') : t('lab2.paper.lossGoodTrade')}
        >
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            <Row label={t('lab2.paper.entry')} value={<span className="lab2-num">${result.closed.entry.toFixed(2)}</span>} />
            <Row label={t('lab2.paper.exit')} value={<span className="lab2-num">${result.closed.exit.toFixed(2)}</span>} />
            <Row label={t('lab2.paper.pnl')} value={<span className="lab2-num">{result.closed.pnl >= 0 ? '+' : ''}${result.closed.pnl.toFixed(2)} ({result.closed.pnlPct.toFixed(2)}%)</span>} valueClass={result.closed.pnl >= 0 ? 'pos' : 'neg'} />
            <Row label={t('lab2.paper.riskMgmtScore')} value={<span className="lab2-num">{result.closed.riskScore}/100</span>} valueClass={result.closed.riskScore >= 80 ? 'pos' : result.closed.riskScore >= 50 ? '' : 'neg'} />
          </div>
        </ResultCard>
      )}

      {closed.length > 0 && (
        <Panel title={t('lab2.paper.recentTrades')}>
          {closed.map((t) => (
            <div key={t.id} className="lab2-row">
              <span>{COINS.find((c) => c.id === t.symbol)?.symbol} · {t.side === 'buy' ? 'L' : 'S'}</span>
              <strong className={t.pnl >= 0 ? 'pos' : 'neg'}>
                <span className="lab2-num">{t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} · {t.riskScore}/100</span>
              </strong>
            </div>
          ))}
        </Panel>
      )}

      <Panel title={t('lab2.paper.stats')}>
        <Row label={t('lab2.paper.totalTrades')} value={<span className="lab2-num">{trades.filter((t) => t.closed).length}</span>} />
        <Row label={t('lab2.paper.winRate')} value={<span className="lab2-num">{winRateFn()}%</span>} />
        <Row label={t('lab2.paper.balance')} value={<span className="lab2-num">${balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>} />
      </Panel>
    </div>
  );
}

function OpenPosition({ open, livePrice, now, onClose }) {
  const { t } = useTranslation();
  const pnl = open.side === 'buy' ? (livePrice - open.entry) * open.qty : (open.entry - livePrice) * open.qty;
  const pnlPct = ((pnl / (open.entry * open.qty)) * 100);
  return (
    <Panel title={t('lab2.paper.openPosition')}>
      <Row label={t('lab2.paper.symbol')} value={COINS.find((c) => c.id === open.symbol)?.symbol ?? open.symbol} />
      <Row label={t('lab2.paper.side')} value={open.side === 'buy' ? `📈 ${t('lab2.long')}` : `📉 ${t('lab2.short')}`} />
      <Row label={t('lab2.paper.entry')} value={<span className="lab2-num">${open.entry.toFixed(2)}</span>} />
      <Row label={t('lab2.paper.quantity')} value={<span className="lab2-num">{open.qty}</span>} />
      <Row label={t('lab2.paper.current')} value={<span className="lab2-num">${livePrice?.toFixed(2) ?? '—'}</span>} />
      <Row label={t('lab2.paper.stopLoss')} value={open.stop ? <span className="lab2-num">${open.stop.toFixed(2)}</span> : '—'} />
      <Row label={t('lab2.paper.takeProfit')} value={open.tp ? <span className="lab2-num">${open.tp.toFixed(2)}</span> : '—'} />
      <Row label={t('lab2.paper.unrealizedPnl')} value={<span className="lab2-num">{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnlPct.toFixed(2)}%)</span>} valueClass={pnl >= 0 ? 'pos' : 'neg'} />
      <button className="lab2-btn ghost full" onClick={onClose}>
        {t('lab2.paper.closeAtMarket')}
      </button>
    </Panel>
  );
}
