/**
 * Paper Trading — open and close a virtual position with full
 * stop-loss / take-profit / risk discipline.
 *
 * VISUAL PASS: the ticket reads top-to-bottom like a real order pad — live
 * price with a drawing chart, asset chips, direction, size, then the maths.
 * Every number that matters (risk, reward, R:R, unrealised P&L) is coloured by
 * the same `--up`/`--down` tokens the rest of the app uses, so the screen never
 * has to explain what green means.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AICoach,
  AnimatedNumber,
  DirGlyph,
  LabBack,
  LabChips,
  Meter,
  Panel,
  PriceBlock,
  ResultCard,
  Row,
  Sparkline
} from './Shared';
import { LabIcon } from './LabIcons';
import { COINS, getPrices, tickPrice } from '../../lib/lab/marketData';
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
    const id = setInterval(() => {
      setLivePrice((prev) => (prev ? tickPrice(coinId, prev, 0) : prev));
    }, 3000);
    return () => clearInterval(id);
  }, [coinId]);

  const open = trades.filter((x) => !x.closed)[0];
  const closed = trades.filter((x) => x.closed).slice(0, 5);

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

  const coachTone = open
    ? 'neutral'
    : !Number(stop) || !Number(tp) || sizePct > 10 || rr < 1.5
    ? 'warn'
    : 'good';

  if (result && !open) {
    const last = trades.find((x) => x.closed);
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
  const coinChips = COINS.slice(0, 6).map((c) => ({
    id: c.id,
    label: c.symbol,
    color: c.color,
    initials: c.symbol.slice(0, 3)
  }));

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        icon="trend"
        accent="cyan"
        title={t('lab2.screens.paper.title')}
        sub={t('lab2.screens.paper.sub')}
      />

      <Panel title={`${symbol} · ${t('lab2.paper.livePrice')}`} icon="activity" accent="cyan">
        <PriceBlock price={livePrice} loading={livePrice == null} />
        <Sparkline data={history} />
      </Panel>

      <Panel title={t('lab2.paper.coin')} icon="coins" accent="amber">
        <LabChips items={coinChips} value={coinId} layoutId="paper-coin" accent="amber" onChange={setCoinId} />
      </Panel>

      {!open ? (
        <>
          <Panel title={t('lab2.paper.side')} icon="layers" accent={side === 'buy' ? 'mint' : 'rose'}>
            <div className="lab2-choices">
              <button
                type="button"
                className={`lab2-btn full ${side === 'buy' ? 'buy' : 'ghost'}`}
                onClick={() => setSide('buy')}
                aria-pressed={side === 'buy'}
              >
                <DirGlyph dir="up" size={17} />
                {t('lab2.paper.buyLong')}
              </button>
              <button
                type="button"
                className={`lab2-btn full ${side === 'sell' ? 'sell' : 'ghost'}`}
                onClick={() => setSide('sell')}
                aria-pressed={side === 'sell'}
              >
                <DirGlyph dir="down" size={17} />
                {t('lab2.paper.sellShort')}
              </button>
            </div>
          </Panel>

          <Panel title={t('lab2.paper.order')} icon="wallet" accent="violet">
            <div className="lab2-stack">
              <div>
                <label className="lab2-input-label" htmlFor="paper-qty">{t('lab2.paper.quantity')}</label>
                <input
                  id="paper-qty"
                  className="lab2-input lab2-num"
                  type="number"
                  step="0.001"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
              <div>
                <label className="lab2-input-label" htmlFor="paper-stop">{t('lab2.paper.stopLossPrice')}</label>
                <input
                  id="paper-stop"
                  className="lab2-input lab2-num"
                  type="number"
                  step="0.01"
                  value={stop}
                  onChange={(e) => setStop(e.target.value)}
                  placeholder="—"
                />
              </div>
              <div>
                <label className="lab2-input-label" htmlFor="paper-tp">{t('lab2.paper.takeProfitPrice')}</label>
                <input
                  id="paper-tp"
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

          <Panel title={t('lab2.paper.tradeMath')} icon="gauge" accent="magenta">
            <Row label={t('lab2.paper.positionValue')} value={<span className="lab2-num">${positionValue.toFixed(2)}</span>} />
            <Row
              label={t('lab2.paper.size')}
              value={t('lab2.paper.ofBalance', { pct: sizePct.toFixed(1) })}
              valueClass={sizePct > 10 ? 'neg' : sizePct > 5 ? '' : 'pos'}
            />
            {/* How much of the balance this trade occupies — the number the
                coach complains about, so it gets a bar as well as a digit. */}
            <Meter value={Math.min(100, sizePct * 2)} accent={sizePct > 10 ? 'rose' : sizePct > 5 ? 'amber' : 'mint'} animate={false} />
            <Row label={t('lab2.paper.risk')} value={<span className="lab2-num">{riskPctEntry.toFixed(2)}% · ${potentialLoss.toFixed(2)}</span>} valueClass="neg" />
            <Row label={t('lab2.paper.reward')} value={<span className="lab2-num">{rewardPctEntry.toFixed(2)}% · ${potentialProfit.toFixed(2)}</span>} valueClass="pos" />
            <Row label={t('lab2.paper.rr')} value={<span className="lab2-num">1 : {rr.toFixed(2)}</span>} valueClass={rr >= 3 ? 'pos' : rr >= 1.5 ? '' : 'neg'} />
          </Panel>

          <button type="button" className={`lab2-btn ${side === 'buy' ? 'buy' : 'sell'} full`} onClick={submit}>
            <LabIcon name="play" width={15} height={15} />
            {t('lab2.paper.execute', { action: side === 'buy' ? t('lab2.paper.buy') : t('lab2.paper.sell') })}
          </button>
        </>
      ) : (
        <OpenPosition open={open} livePrice={livePrice} onClose={submit} />
      )}

      <AICoach tone={coachTone} message={coachMsg} />

      {result && !open && result.closed && (
        <ResultCard
          kind={result.closed.pnl >= 0 ? 'win' : 'loss'}
          icon={result.closed.pnl >= 0 ? 'trophy' : 'shield'}
          title={`${t('lab2.paper.positionClosed')} · ${reasonLabel}`}
          sub={result.closed.pnl >= 0 ? t('lab2.paper.disciplinePays') : t('lab2.paper.lossGoodTrade')}
        >
          <div className="lab2-stack" style={{ width: '100%', marginTop: 8 }}>
            <Row label={t('lab2.paper.entry')} value={<span className="lab2-num">${result.closed.entry.toFixed(2)}</span>} />
            <Row label={t('lab2.paper.exit')} value={<span className="lab2-num">${result.closed.exit.toFixed(2)}</span>} />
            <Row
              label={t('lab2.paper.pnl')}
              value={<span className="lab2-num">{result.closed.pnl >= 0 ? '+' : ''}${result.closed.pnl.toFixed(2)} ({result.closed.pnlPct.toFixed(2)}%)</span>}
              valueClass={result.closed.pnl >= 0 ? 'pos' : 'neg'}
            />
            <Row
              label={t('lab2.paper.riskMgmtScore')}
              value={<span className="lab2-num">{result.closed.riskScore}/100</span>}
              valueClass={result.closed.riskScore >= 80 ? 'pos' : result.closed.riskScore >= 50 ? '' : 'neg'}
            />
            <Meter value={result.closed.riskScore} accent={result.closed.riskScore >= 80 ? 'mint' : result.closed.riskScore >= 50 ? 'amber' : 'rose'} />
          </div>
        </ResultCard>
      )}

      {closed.length > 0 && (
        <Panel title={t('lab2.paper.recentTrades')} icon="layers" accent="cyan">
          {closed.map((tr) => (
            <div key={tr.id} className="lab2-row">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <DirGlyph dir={tr.side === 'buy' ? 'up' : 'down'} size={13} />
                {COINS.find((c) => c.id === tr.symbol)?.symbol ?? tr.symbol} · {tr.side === 'buy' ? t('lab2.long') : t('lab2.short')}
              </span>
              <strong className={tr.pnl >= 0 ? 'pos' : 'neg'}>
                <span className="lab2-num">{tr.pnl >= 0 ? '+' : ''}${tr.pnl.toFixed(2)} · {tr.riskScore}/100</span>
              </strong>
            </div>
          ))}
        </Panel>
      )}

      <Panel title={t('lab2.paper.stats')} icon="pie" accent="amber">
        <Row label={t('lab2.paper.totalTrades')} value={<span className="lab2-num">{trades.filter((x) => x.closed).length}</span>} />
        <Row label={t('lab2.paper.winRate')} value={<span className="lab2-num">{winRateFn()}%</span>} />
        <Row
          label={t('lab2.paper.balance')}
          value={<AnimatedNumber value={balance} prefix="$" />}
        />
      </Panel>
    </div>
  );
}

function OpenPosition({ open, livePrice, onClose }) {
  const { t } = useTranslation();
  const pnl = open.side === 'buy' ? (livePrice - open.entry) * open.qty : (open.entry - livePrice) * open.qty;
  const pnlPct = (pnl / (open.entry * open.qty)) * 100;
  const winning = Number.isFinite(pnl) && pnl >= 0;

  return (
    <Panel title={t('lab2.paper.openPosition')} icon="activity" accent={winning ? 'mint' : 'rose'}>
      <div className="lab2-result-figure lab2-num" style={{ textAlign: 'center' }}>
        {Number.isFinite(pnl) ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
      </div>
      <Row label={t('lab2.paper.symbol')} value={COINS.find((c) => c.id === open.symbol)?.symbol ?? open.symbol} />
      <Row
        label={t('lab2.paper.side')}
        value={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <DirGlyph dir={open.side === 'buy' ? 'up' : 'down'} size={14} />
            {open.side === 'buy' ? t('lab2.long') : t('lab2.short')}
          </span>
        }
      />
      <Row label={t('lab2.paper.entry')} value={<span className="lab2-num">${open.entry.toFixed(2)}</span>} />
      <Row label={t('lab2.paper.quantity')} value={<span className="lab2-num">{open.qty}</span>} />
      <Row label={t('lab2.paper.current')} value={<span className="lab2-num">${livePrice?.toFixed(2) ?? '—'}</span>} />
      <Row label={t('lab2.paper.stopLoss')} value={open.stop ? <span className="lab2-num">${open.stop.toFixed(2)}</span> : '—'} valueClass={open.stop ? 'neg' : ''} />
      <Row label={t('lab2.paper.takeProfit')} value={open.tp ? <span className="lab2-num">${open.tp.toFixed(2)}</span> : '—'} valueClass={open.tp ? 'pos' : ''} />
      <Row
        label={t('lab2.paper.unrealizedPnl')}
        value={<span className="lab2-num">{Number.isFinite(pnlPct) ? `${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%` : '—'}</span>}
        valueClass={winning ? 'pos' : 'neg'}
      />
      <button type="button" className="lab2-btn ghost full" onClick={onClose}>
        <LabIcon name="close" width={15} height={15} />
        {t('lab2.paper.closeAtMarket')}
      </button>
    </Panel>
  );
}
