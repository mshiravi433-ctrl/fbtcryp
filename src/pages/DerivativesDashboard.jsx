import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import FundingPanel from '../components/FundingPanel';
import { useMarkets } from '../hooks/useMarket';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { getDydxMarkets, getDydxOrderbook } from '../lib/dydx';
import '../styles/derivatives-glass.css';

const COINGECKO = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', DOGE: 'dogecoin', BNB: 'binancecoin', ADA: 'cardano', AVAX: 'avalanche-2', LINK: 'chainlink' };

export default function DerivativesDashboard() {
  const { t } = useTranslation();
  const { data: spot } = useMarkets(100);
  const [markets, setMarkets] = useState([]);
  const [ticker, setTicker] = useState('BTC-USD');
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getDydxMarkets()
      .then((r) => alive && setMarkets(r.markets))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    getDydxOrderbook(ticker).then((b) => alive && setBook(b));
    return () => { alive = false; };
  }, [ticker]);

  const spotMap = useMemo(() => Object.fromEntries((spot || []).map((c) => [c.id, c.price])), [spot]);
  const rows = useMemo(() => markets.map((m) => {
    const base = m.ticker.split('-')[0];
    const spotPx = spotMap[COINGECKO[base]];
    return { ...m, spotPx, basis: spotPx ? ((m.oraclePrice / spotPx) - 1) * 100 : null, oiUsd: m.openInterest * m.oraclePrice };
  }).sort((a, b) => b.oiUsd - a.oiUsd), [markets, spotMap]);
  const selected = rows.find((r) => r.ticker === ticker) || rows[0];

  return (
    <PageTransition>
      <div className="derivatives-hall">
        <div className="derivatives-aurora" aria-hidden="true" />

        {/* HERO — glass + neon */}
        <motion.section className="derivatives-hero" variants={riseIn} initial="hidden" animate="show">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="derivatives-title">
                <span className="derivatives-title-glow">{t('derivatives.title')}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: 1.2 }}>• GLASS HALL</span>
              </div>
              <p className="derivatives-subtitle">{t('derivatives.subtitle')}</p>
            </div>
            <span className="derivatives-badge" title={t('derivatives.title')}>
              <span className="derivatives-badge-dot" />
              LIVE
            </span>
          </div>
        </motion.section>

        {/* notice — glass */}
        <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 12 }}>
          <div className="glass-notice">{t('derivatives.notice')}</div>
        </motion.div>

        {/* funding — stays but inside hall it becomes glass via CSS */}
        <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 12 }}>
          <FundingPanel />
        </motion.div>

        {/* BOARD — glass */}
        <motion.section className="glass-board" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 14 }}>
          <div className="glass-board-label">
            <span>{t('derivatives.marketTable')}</span>
            <i aria-hidden="true" />
            <span style={{ fontSize: 10, color: 'var(--text-3)', letterSpacing: 0.6 }}>{rows.length ? `${rows.length} MARKETS` : ''}</span>
          </div>

          {loading ? (
            <div className="stack" style={{ gap: 8 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="skel"
                  style={{ height: 56, borderRadius: 14 }}
                  animate={{ opacity: [0.45, 0.85, 0.45] }}
                  transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.08 }}
                />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="empty" style={{ padding: '18px 0' }}>
              <span className="empty-icon">◎</span>
              <span className="muted" style={{ fontSize: 12.5 }}>بازاری برای نمایش نیست — فید لحظه‌ای در دسترس نیست</span>
            </div>
          ) : (
            <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
              {rows.slice(0, 30).map((r) => {
                const active = selected?.ticker === r.ticker;
                const basisUp = r.basis == null ? null : r.basis >= 0;
                return (
                  <motion.button
                    key={r.ticker}
                    className="glass-row"
                    data-active={active ? 'true' : 'false'}
                    variants={riseIn}
                    whileTap={{ scale: 0.985 }}
                    onClick={() => setTicker(r.ticker)}
                    aria-pressed={active}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="glass-row-symbol">{r.ticker}</div>
                      <div className="glass-row-price">${fmtPrice(r.oraclePrice)}</div>
                    </div>

                    <div className="glass-row-basis" data-up={basisUp === null ? 'null' : basisUp ? 'true' : 'false'}>
                      {r.basis == null ? '—' : fmtPct(r.basis, 2)}
                    </div>

                    <div className="glass-row-oi">
                      <div className="glass-row-oi-label">OI</div>
                      <div className="glass-row-oi-value">{fmtUsd(r.oiUsd)}</div>
                    </div>
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </motion.section>

        {/* DETAIL — big glass card */}
        {selected && (
          <motion.section className="glass-detail" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 14 }}>
            <div className="glass-detail-head">
              <div className="glass-detail-ticker">{selected.ticker}</div>
              <span className="glass-detail-pill">dYdX • PERP</span>
            </div>

            <div className="glass-metrics">
              <div className="glass-metric" style={{ '--metric-accent': 'var(--rgb-1)' }}>
                <div className="glass-metric-label">{t('derivatives.perpPrice')}</div>
                <div className="glass-metric-value">${fmtPrice(selected.oraclePrice)}</div>
                <div className="glass-metric-sub">oracle • live</div>
              </div>
              <div className="glass-metric" style={{ '--metric-accent': 'var(--rgb-2)' }}>
                <div className="glass-metric-label">{t('derivatives.spotPrice')}</div>
                <div className="glass-metric-value">{selected.spotPx ? `$${fmtPrice(selected.spotPx)}` : '—'}</div>
                <div className="glass-metric-sub">CoinGecko • spot</div>
              </div>
              <div className="glass-metric" style={{ '--metric-accent': 'var(--rgb-3)' }}>
                <div className="glass-metric-label">{t('derivatives.openInterest')}</div>
                <div className="glass-metric-value">{fmtUsd(selected.oiUsd)}</div>
                <div className="glass-metric-sub">OI × price</div>
              </div>
              <div className="glass-metric" style={{ '--metric-accent': 'var(--rgb-4)' }}>
                <div className="glass-metric-label">{t('derivatives.nextFunding')}</div>
                <div className="glass-metric-value" style={{ direction: 'ltr' }}>{selected.nextFundingRate != null ? `${selected.nextFundingRate.toFixed(6)}%` : '—'}</div>
                <div className="glass-metric-sub">next • 8h</div>
              </div>
              <div className="glass-metric" style={{ '--metric-accent': 'var(--rgb-5)' }}>
                <div className="glass-metric-label">{t('derivatives.spread')}</div>
                <div className="glass-metric-value">{book?.live ? `${book.spreadBps.toFixed(2)} bps` : '—'}</div>
                <div className="glass-metric-sub">{book?.live ? 'best bid/ask' : '—'}</div>
              </div>
              <div className="glass-metric" style={{ '--metric-accent': 'var(--rgb-1)' }}>
                <div className="glass-metric-label">{t('derivatives.bidDepth')}</div>
                <div className="glass-metric-value">{book?.live ? fmtUsd(book.bidDepth1Pct) : '—'}</div>
                <div className="glass-metric-sub">1% depth</div>
              </div>
              <div className="glass-metric" style={{ '--metric-accent': 'var(--rgb-2)' }}>
                <div className="glass-metric-label">{t('derivatives.askDepth')}</div>
                <div className="glass-metric-value">{book?.live ? fmtUsd(book.askDepth1Pct) : '—'}</div>
                <div className="glass-metric-sub">1% depth</div>
              </div>
              <div className="glass-metric" style={{ '--metric-accent': basisUpColor(selected.basis) }}>
                <div className="glass-metric-label">{t('derivatives.basis')}</div>
                <div className="glass-metric-value" style={{ color: basisColor(selected.basis) }}>{selected.basis == null ? '—' : fmtPct(selected.basis, 3)}</div>
                <div className="glass-metric-sub">perp vs spot</div>
              </div>
            </div>

            <p className="faint" style={{ marginTop: 12, fontSize: 11, lineHeight: 1.7, position: 'relative' }}>
              بورد شیشه‌ای است — هر سلول با نئون خودش نفس می‌کشد. سطر انتخاب‌شده لبهٔ نئونی می‌گیرد و بقیه آرام می‌مانند تا چشم فقط روی انتخاب بماند.
            </p>
          </motion.section>
        )}
      </div>
    </PageTransition>
  );
}

function basisColor(basis) {
  if (basis == null) return 'var(--text-3)';
  return basis >= 0 ? 'var(--up)' : 'var(--down)';
}
function basisUpColor(basis) {
  if (basis == null) return 'rgba(255,255,255,0.18)';
  return basis >= 0 ? 'var(--up)' : 'var(--down)';
}
