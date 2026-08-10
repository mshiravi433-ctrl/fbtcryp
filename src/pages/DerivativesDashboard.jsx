import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import FundingPanel from '../components/FundingPanel';
import { useMarkets } from '../hooks/useMarket';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { getDydxMarkets, getDydxOrderbook } from '../lib/dydx';

const COINGECKO = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', DOGE: 'dogecoin', BNB: 'binancecoin', ADA: 'cardano', AVAX: 'avalanche-2', LINK: 'chainlink' };

export default function DerivativesDashboard() {
  const { t } = useTranslation();
  const { data: spot } = useMarkets(100);
  const [markets, setMarkets] = useState([]);
  const [ticker, setTicker] = useState('BTC-USD');
  const [book, setBook] = useState(null);

  useEffect(() => { getDydxMarkets().then((r) => setMarkets(r.markets)); }, []);
  useEffect(() => { getDydxOrderbook(ticker).then(setBook); }, [ticker]);

  const spotMap = useMemo(() => Object.fromEntries((spot || []).map((c) => [c.id, c.price])), [spot]);
  const rows = useMemo(() => markets.map((m) => {
    const base = m.ticker.split('-')[0];
    const spotPx = spotMap[COINGECKO[base]];
    return { ...m, spotPx, basis: spotPx ? ((m.oraclePrice / spotPx) - 1) * 100 : null, oiUsd: m.openInterest * m.oraclePrice };
  }).sort((a, b) => b.oiUsd - a.oiUsd), [markets, spotMap]);
  const selected = rows.find((r) => r.ticker === ticker) || rows[0];

  return <PageTransition>
    <motion.div variants={riseIn} initial="hidden" animate="show"><h1 className="h1">{t('derivatives.title')}</h1><p className="muted">{t('derivatives.subtitle')}</p></motion.div>
    <p className="notice">{t('derivatives.notice')}</p>
    <FundingPanel />

    <section>
      <p className="section-label">{t('derivatives.marketTable')}</p>
      <div className="stack" style={{ gap: 7 }}>
        {rows.slice(0, 30).map((r) => <button key={r.ticker} className="coin-row" style={{ width: '100%' }} onClick={() => setTicker(r.ticker)}>
          <div className="coin-meta"><div className="coin-sym">{r.ticker}</div><div className="coin-name">${fmtPrice(r.oraclePrice)}</div></div>
          <div style={{ textAlign: 'center' }}><div className="faint">{t('derivatives.basis')}</div><div className={`mono ${(r.basis || 0) >= 0 ? 'up' : 'down'}`}>{r.basis == null ? '—' : fmtPct(r.basis, 3)}</div></div>
          <div className="coin-right"><div className="faint">OI</div><div className="mono">{fmtUsd(r.oiUsd)}</div></div>
        </button>)}
      </div>
    </section>

    {selected && <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
      <div className="row-between"><strong>{selected.ticker}</strong><span className="pill pill-rgb">dYdX</span></div>
      <div className="stack" style={{ gap: 7, marginTop: 10 }}>
        <div className="row-between"><span className="faint">{t('derivatives.perpPrice')}</span><span className="mono">${fmtPrice(selected.oraclePrice)}</span></div>
        <div className="row-between"><span className="faint">{t('derivatives.spotPrice')}</span><span className="mono">{selected.spotPx ? `$${fmtPrice(selected.spotPx)}` : '—'}</span></div>
        <div className="row-between"><span className="faint">{t('derivatives.openInterest')}</span><span className="mono">{fmtUsd(selected.oiUsd)}</span></div>
        <div className="row-between"><span className="faint">{t('derivatives.nextFunding')}</span><span className="mono">{selected.nextFundingRate.toFixed(6)}%</span></div>
        <div className="row-between"><span className="faint">{t('derivatives.spread')}</span><span className="mono">{book?.live ? `${book.spreadBps.toFixed(2)} bps` : '—'}</span></div>
        <div className="row-between"><span className="faint">{t('derivatives.bidDepth')}</span><span className="mono">{book?.live ? fmtUsd(book.bidDepth1Pct) : '—'}</span></div>
        <div className="row-between"><span className="faint">{t('derivatives.askDepth')}</span><span className="mono">{book?.live ? fmtUsd(book.askDepth1Pct) : '—'}</span></div>
      </div>
    </motion.section>}
  </PageTransition>;
}
