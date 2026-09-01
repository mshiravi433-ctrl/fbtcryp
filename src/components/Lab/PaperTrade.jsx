/**
 * Paper Trading — open and close a virtual position with full
 * stop-loss / take-profit / risk discipline.
 *
 * ─── RISK MANAGEMENT SCORE ────────────────────────────────────────────────
 * The exit screen prints a 0–100 score that grades the user's *discipline*,
 * not their P&L. The formula rewards:
 *   • a defined stop loss        (did they decide their max loss up front?)
 *   • a defined take profit      (or did they "let the winners run" forever?)
 *   • a small position size      (<10% of balance, so one bad trade can't
 *                                  blow the account)
 *   • a high R:R                 (≥3:1, the floor for a profitable system
 *                                  even at 50% win rate)
 * The result is a number that a user can improve without ever getting
 * better at predicting prices — which is the point. Discipline is the
 * edge.
 */

import { useEffect, useMemo, useState } from 'react';
import { LabBack, AICoach, Panel, Row, Notice, Empty, ResultCard, Sparkline } from './Shared';
import { COINS, getPrices, tickPrice } from '../../lib/lab/marketData';
import { calcPositionSize } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

export default function PaperTrade({ onBack }) {
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
      setResult({ reason: 'Stop loss hit' });
      haptic?.('warning');
    } else if (open.tp && ((open.side === 'buy' && livePrice >= open.tp) || (open.side === 'sell' && livePrice <= open.tp))) {
      closeTrade(open.id, open.tp);
      setResult({ reason: 'Take profit hit' });
      haptic?.('success');
    }
  }, [livePrice, open, closeTrade, haptic]);

  const submit = () => {
    if (!entry) return;
    if (open) {
      // Close at current
      closeTrade(open.id, livePrice ?? entry);
      setResult({ reason: 'Closed manually' });
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
    ? 'Position is live. Watch the PnL but do not touch the stop — that is the point of having one.'
    : !Number(stop)
    ? 'Every trade needs a stop loss. If you cannot define your loss, you do not have a trade.'
    : !Number(tp)
    ? 'A trade without a target is a trade that will reverse and give back its gains.'
    : sizePct > 10
    ? 'Position above 10% of your balance is reckless. Cut it down or skip this one.'
    : rr < 1.5
    ? 'R:R below 1.5 means you need a 70% win rate to break even. Wait for a better setup.'
    : 'Setup looks disciplined. Execute.';

  if (result && !open) {
    const last = trades.find((t) => t.closed);
    if (last && !result.closed) {
      result.closed = last;
    }
  }

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title="📈 Paper Trading" sub="Trade with virtual money. No risk, all the lessons." />

      <Panel title={`${COINS.find((c) => c.id === coinId)?.symbol} · Live price`}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            ${livePrice?.toLocaleString('en-US', { maximumFractionDigits: livePrice < 1 ? 5 : 2 }) ?? '—'}
          </div>
        </div>
        <Sparkline data={history} />
      </Panel>

      <Panel title="Coin">
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
          <Panel title="Side">
            <div className="lab2-choices">
              <button className={`lab2-btn buy full ${side === 'buy' ? '' : 'ghost'}`} onClick={() => setSide('buy')}>
                📈 Buy / Long
              </button>
              <button className={`lab2-btn sell full ${side === 'sell' ? '' : 'ghost'}`} onClick={() => setSide('sell')}>
                📉 Sell / Short
              </button>
            </div>
          </Panel>

          <Panel title="Order">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="lab2-input-label">Quantity (in coin)</label>
                <input
                  className="lab2-input"
                  type="number"
                  step="0.001"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
              <div>
                <label className="lab2-input-label">Stop Loss (price)</label>
                <input
                  className="lab2-input"
                  type="number"
                  step="0.01"
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                  placeholder="—"
                />
              </div>
              <div>
                <label className="lab2-input-label">Take Profit (price)</label>
                <input
                  className="lab2-input"
                  type="number"
                  step="0.01"
                  value={tp}
                  onChange={(e) => setTp(e.target.value)}
                  placeholder="—"
                />
              </div>
            </div>
          </Panel>

          <Panel title="Trade math">
            <Row label="Position value" value={`$${positionValue.toFixed(2)}`} />
            <Row label="Size" value={`${sizePct.toFixed(1)}% of balance`} valueClass={sizePct > 10 ? 'neg' : sizePct > 5 ? '' : 'pos'} />
            <Row label="Risk" value={`${riskPctEntry.toFixed(2)}% · $${potentialLoss.toFixed(2)}`} valueClass="neg" />
            <Row label="Reward" value={`${rewardPctEntry.toFixed(2)}% · $${potentialProfit.toFixed(2)}`} valueClass="pos" />
            <Row label="R:R" value={`1 : ${rr.toFixed(2)}`} valueClass={rr >= 3 ? 'pos' : rr >= 1.5 ? '' : 'neg'} />
          </Panel>

          <button className={`lab2-btn ${side === 'buy' ? 'buy' : 'sell'} full`} onClick={submit}>
            Execute {side === 'buy' ? 'Buy' : 'Sell'}
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
          title={`Position closed · ${result.reason}`}
          sub={result.closed.pnl >= 0 ? 'Discipline pays off.' : 'Even a loss can be a good trade if the rules were followed.'}
        >
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            <Row label="Entry" value={`$${result.closed.entry.toFixed(2)}`} />
            <Row label="Exit" value={`$${result.closed.exit.toFixed(2)}`} />
            <Row label="P&L" value={`${result.closed.pnl >= 0 ? '+' : ''}$${result.closed.pnl.toFixed(2)} (${result.closed.pnlPct.toFixed(2)}%)`} valueClass={result.closed.pnl >= 0 ? 'pos' : 'neg'} />
            <Row label="Risk Mgmt Score" value={`${result.closed.riskScore}/100`} valueClass={result.closed.riskScore >= 80 ? 'pos' : result.closed.riskScore >= 50 ? '' : 'neg'} />
          </div>
        </ResultCard>
      )}

      {closed.length > 0 && (
        <Panel title="Recent trades">
          {closed.map((t) => (
            <div key={t.id} className="lab2-row">
              <span>{COINS.find((c) => c.id === t.symbol)?.symbol} · {t.side === 'buy' ? 'L' : 'S'}</span>
              <strong className={t.pnl >= 0 ? 'pos' : 'neg'}>
                {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} · {t.riskScore}/100
              </strong>
            </div>
          ))}
        </Panel>
      )}

      <Panel title="Stats">
        <Row label="Total trades" value={trades.filter((t) => t.closed).length} />
        <Row label="Win rate" value={`${winRateFn()}%`} />
        <Row label="Balance" value={`$${balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
      </Panel>
    </div>
  );
}

function OpenPosition({ open, livePrice, now, onClose }) {
  const pnl = open.side === 'buy' ? (livePrice - open.entry) * open.qty : (open.entry - livePrice) * open.qty;
  const pnlPct = ((pnl / (open.entry * open.qty)) * 100);
  return (
    <Panel title="Open position">
      <Row label="Symbol" value={COINS.find((c) => c.id === open.symbol)?.symbol ?? open.symbol} />
      <Row label="Side" value={open.side === 'buy' ? '📈 Long' : '📉 Short'} />
      <Row label="Entry" value={`$${open.entry.toFixed(2)}`} />
      <Row label="Quantity" value={open.qty} />
      <Row label="Current" value={`$${livePrice?.toFixed(2) ?? '—'}`} />
      <Row label="Stop Loss" value={open.stop ? `$${open.stop.toFixed(2)}` : '—'} />
      <Row label="Take Profit" value={open.tp ? `$${open.tp.toFixed(2)}` : '—'} />
      <Row label="Unrealized P&L" value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%)`} valueClass={pnl >= 0 ? 'pos' : 'neg'} />
      <button className="lab2-btn ghost full" onClick={onClose}>
        Close at market
      </button>
    </Panel>
  );
}
