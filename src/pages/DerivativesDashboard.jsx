import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import AssetIcon from '../components/AssetIcon';
import FundingPanel from '../components/FundingPanel';
import {
  IconActivity,
  IconClock,
  IconCoins,
  IconMarket,
  IconSearch,
  IconSparkle,
  IconTrend
} from '../components/Icons';
import { useMarkets } from '../hooks/useMarket';
import { fmtCompact, fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { getDydxMarkets, getDydxOrderbook } from '../lib/dydx';
import '../styles/derivatives-glass.css';

/**
 * تالار مشتقه — THE DERIVATIVES HALL.
 * ---------------------------------------------------------------------------
 * «خیلی قشنگ‌تر و مدرن‌تر، باکس و آیکن‌ها و همه‌چیز مدرن‌تر بشه.»
 *
 * What was here: a title over a paragraph, then thirty identical rows of three
 * numbers, then a wall of eight metric boxes. Correct, but it read as a table
 * somebody had wrapped in glass — every row looked the same, nothing on the
 * first screen was information, and the only way to find a market was to
 * scroll and squint.
 *
 * What it is now, and why each piece earns its place:
 *   · THE HALL OPENS WITH MEASUREMENTS. Four figures across the venue — how
 *     many markets, how deep in total, how wide the widest basis is, which way
 *     funding is paying — so the first screen already answers "what is the
 *     derivatives market doing right now".
 *   · EVERY ROW CARRIES ITS OWN ARTWORK AND LABELS. AssetIcon is offline
 *     vendored SVG keyed by symbol, which is safe here because every ticker on
 *     this board is venue-curated by dYdX (the rule in lib/tokenIcon.jsx about
 *     user-supplied symbols does not apply; nothing here is imported by a
 *     user). Each of the four figures under the symbol says what it is, so the
 *     row can be read without consulting a header.
 *   · THE BOARD CAN BE CUT. Search plus a three-way sort (open interest,
 *     basis, funding) — a board of 300 markets is only useful if it can be
 *     narrowed to the one you came for.
 *   · DEPTH IS A SHAPE. The bid and ask sides of the book are drawn as opposed
 *     bars; which side is heavier is now something you see, not something you
 *     subtract.
 *
 * ─── THE UNITS, BECAUSE THEY WERE WRONG ─────────────────────────────────────
 * dYdX's `nextFundingRate` is a DECIMAL FRACTION per hour ("0.0000125" is
 * 0.00125%/h — see docs.dydx.xyz/concepts/trading/funding: the one-hour
 * premium, settled hourly). It is printed here as `rate * 100` with the
 * interval named. Showing the raw fraction with a "%" after it understates the
 * cost of holding a leveraged position a hundredfold, which is the one number
 * on this screen that must not be quietly wrong.
 *
 * `openInterest` is in BASE units and `priceChange24H` is an absolute USD
 * move, so OI is multiplied by the oracle price and the change is divided by
 * it — the same reading pages/Dydx.jsx uses.
 *
 * ─── NOTHING IS INVENTED ────────────────────────────────────────────────────
 * The feed's own rule stands: an unreachable indexer renders as unavailable,
 * never as a demo list, and a market with no spot reference shows "—" for its
 * basis rather than 0. Zero and unknown are opposite statements about a price
 * gap somebody might trade on.
 */

/** CoinGecko id for the bases we can reference against spot with certainty. */
const COINGECKO = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', DOGE: 'dogecoin',
  BNB: 'binancecoin', ADA: 'cardano', AVAX: 'avalanche-2', LINK: 'chainlink'
};

/** How often the board re-reads. The server caches this feed for 30s, so a
 *  faster poll would only ever return the same numbers. */
const REFRESH_MS = 60_000;

/** A ticker such as "BTC-USD" carries its artwork key and its quote leg. */
const baseOf = (ticker) => String(ticker || '').split('-')[0].toUpperCase();
const quoteOf = (ticker) => {
  const parts = String(ticker || '').split('-');
  return parts.length > 1 ? parts.slice(1).join('-').toUpperCase() : '';
};

/* ─── formatters ──────────────────────────────────────────────────────────── */
/** Basis in basis points, signed. A gap between two prices is a bps figure. */
const fmtBps = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
};
/** Funding as a percent per hour, signed, from dYdX's decimal fraction. */
const fmtFunding = (rate) => {
  const v = Number(rate);
  if (!Number.isFinite(v) || v === 0) return v === 0 ? '0.0000%' : '—';
  const pct = v * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(4)}%`;
};

/* One signed number, three colours, several call sites. */
function Signed({ value, text, className = '' }) {
  const v = Number(value);
  const tone = Number.isFinite(v) && v > 0 ? 'is-up' : Number.isFinite(v) && v < 0 ? 'is-down' : 'is-flat';
  return <span className={`deriv-signed ${tone}${className ? ` ${className}` : ''}`}>{text}</span>;
}

/* A detail tile: icon, label, value, optional note, optional accent rail. */
function Tile({ icon: Icon, label, value, note, tone = 'flat', ltr = true }) {
  return (
    <div className={`deriv-tile${tone !== 'flat' ? ` is-${tone}` : ''}`}>
      <div className="deriv-tile-head">
        {Icon ? <Icon size={13} /> : null}
        <span>{label}</span>
      </div>
      <div className="deriv-tile-value" dir={ltr ? 'ltr' : undefined}>{value}</div>
      {note ? <div className="deriv-tile-note">{note}</div> : null}
    </div>
  );
}

export default function DerivativesDashboard({ embedded = false }) {
  const { t } = useTranslation();
  const { data: spot } = useMarkets(100);

  const [markets, setMarkets] = useState([]);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(null);
  const [ticker, setTicker] = useState('BTC-USD');
  const [book, setBook] = useState(null);

  /* ── the board ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    const load = () => {
      getDydxMarkets().then((r) => {
        if (!alive) return;
        setMarkets(Array.isArray(r?.markets) ? r.markets : []);
        setUnavailable(Boolean(r?.unavailable));
        setLoadedAt(Date.now());
        setLoading(false);
      });
    };
    load();
    /*
     * Re-read while the screen is actually in front of the reader, and again
     * the moment it comes back. A badge that says LIVE next to numbers nobody
     * refreshed is the kind of lie that costs money; a poll that keeps running
     * on a hidden tab is the kind that costs battery.
     */
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    const id = setInterval(onVisible, REFRESH_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  /* ── the order book of whichever market is selected ────────────────────── */
  useEffect(() => {
    let alive = true;
    getDydxOrderbook(ticker).then((b) => { if (alive) setBook(b); });
    return () => { alive = false; };
  }, [ticker]);

  /*
   * Spot reference for the basis.
   *
   * The curated id map is authoritative: an id is a fact. Where a base is not
   * in it we fall back to matching the coin's SYMBOL inside the fetched list,
   * but only when that symbol appears exactly once — two different coins
   * sharing a ticker would make the "reference price" a coin flip, and a basis
   * measured against the wrong asset is worse than no basis at all.
   */
  const spotByBase = useMemo(() => {
    const byId = Object.fromEntries((spot || []).map((c) => [c.id, c.price]));
    const counts = new Map();
    for (const c of spot || []) {
      const sym = String(c.symbol || '').toUpperCase();
      counts.set(sym, (counts.get(sym) || 0) + 1);
    }
    const out = {};
    for (const c of spot || []) {
      const sym = String(c.symbol || '').toUpperCase();
      if (!sym || counts.get(sym) !== 1) continue;
      out[sym] = c.price;
    }
    return { byId, bySymbol: out };
  }, [spot]);

  const spotPxFor = (base) => {
    const id = COINGECKO[base];
    if (id && Number.isFinite(Number(spotByBase.byId[id]))) return Number(spotByBase.byId[id]);
    const v = spotByBase.bySymbol[base];
    return Number.isFinite(Number(v)) ? Number(v) : null;
  };

  /* ── rows: derived figures + search + sort ─────────────────────────────── */
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState('oi');
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => markets.map((m) => {
    const base = baseOf(m.ticker);
    const spotPx = spotPxFor(base);
    const oracle = Number(m.oraclePrice);
    return {
      ...m,
      base,
      quote: quoteOf(m.ticker),
      spotPx,
      basisBps: spotPx && Number.isFinite(oracle) && oracle > 0 ? ((oracle / spotPx) - 1) * 10_000 : null,
      changePct: Number.isFinite(Number(m.priceChange24H)) && oracle > 0 ? (Number(m.priceChange24H) / oracle) * 100 : null,
      oiUsd: Number.isFinite(Number(m.openInterest)) && Number.isFinite(oracle) ? Number(m.openInterest) * oracle : null
    };
    // spotPxFor closes over spotByBase only; listing it keeps the memo honest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [markets, spotByBase]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    const base = q ? rows.filter((r) => String(r.ticker || '').toUpperCase().includes(q)) : rows;
    const absBasis = (r) => (r.basisBps == null ? -1 : Math.abs(r.basisBps));
    const cmp = {
      oi: (a, b) => Number(b.oiUsd || 0) - Number(a.oiUsd || 0),
      basis: (a, b) => absBasis(b) - absBasis(a),
      funding: (a, b) => Number(b.nextFundingRate || 0) - Number(a.nextFundingRate || 0)
    };
    return base.slice().sort(cmp[sortKey] || cmp.oi);
  }, [rows, query, sortKey]);

  const visible = showAll ? filtered : filtered.slice(0, 30);

  /* ── venue-wide figures for the hero strip ─────────────────────────────── */
  const stats = useMemo(() => {
    if (!rows.length) return null;
    let totalOi = 0;
    let widest = null;
    let fundingSum = 0;
    let fundingN = 0;
    for (const r of rows) {
      if (Number.isFinite(Number(r.oiUsd))) totalOi += Number(r.oiUsd);
      const b = r.basisBps == null ? null : Math.abs(r.basisBps);
      if (b != null && Number.isFinite(b) && (!widest || b > widest.bps)) widest = { bps: b, base: r.base };
      const f = Number(r.nextFundingRate);
      if (Number.isFinite(f)) { fundingSum += f; fundingN += 1; }
    }
    return {
      count: rows.length,
      totalOi,
      widest,
      avgFunding: fundingN ? fundingSum / fundingN : null
    };
  }, [rows]);

  /* Widest OI on screen → the denominator for the row bars, so the bars rank
     markets against each other instead of against themselves. */
  const maxOi = useMemo(() => {
    let max = 0;
    for (const r of visible) max = Math.max(max, Number(r.oiUsd || 0));
    return max > 0 ? max : 1;
  }, [visible]);

  const selected = rows.find((r) => r.ticker === ticker) || rows[0] || null;
  const depthMax = Math.max(Number(book?.bidDepth1Pct || 0), Number(book?.askDepth1Pct || 0), 1);
  const bookLive = Boolean(book?.live);

  return (
    <PageTransition embedded={embedded}>
      <div className="derivatives-hall">
        <div className="derivatives-aurora" aria-hidden="true" />

        {/* ─── hero: the hall's own measurements ─────────────────────────── */}
        <motion.section className="derivatives-hero" variants={riseIn} initial="hidden" animate="show">
          <div className="deriv-hero-top">
            <span className="deriv-hero-ico" aria-hidden="true"><IconMarket size={18} /></span>
            <div className="deriv-hero-copy">
              <div className="derivatives-title">
                <span className="derivatives-title-glow">{t('derivatives.title')}</span>
              </div>
              <p className="derivatives-subtitle">{t('derivatives.subtitle')}</p>
            </div>
            <span className={`derivatives-badge${unavailable || !rows.length ? ' is-quiet' : ''}`}>
              <span className="derivatives-badge-dot" aria-hidden="true" />
              {t('derivatives.liveDot')}
            </span>
          </div>

          {stats ? (
            <div className="deriv-stats">
              <div className="deriv-stat">
                <IconSparkle size={13} />
                <span className="deriv-stat-v" dir="ltr">{stats.count.toLocaleString('en-US')}</span>
                <span className="deriv-stat-l">{t('derivatives.marketsCount')}</span>
              </div>
              <div className="deriv-stat">
                <IconCoins size={13} />
                <span className="deriv-stat-v" dir="ltr">{fmtCompact(stats.totalOi)}</span>
                <span className="deriv-stat-l">{t('derivatives.totalOi')}</span>
              </div>
              <div className="deriv-stat">
                <IconTrend size={13} />
                <span className="deriv-stat-v" dir="ltr">
                  {stats.widest ? `${fmtBps(stats.widest.bps)} bps` : '—'}
                </span>
                <span className="deriv-stat-l">
                  {t('derivatives.bestBasis')}
                  {stats.widest ? ` · ${stats.widest.base}` : ''}
                </span>
              </div>
              <div className="deriv-stat">
                <IconClock size={13} />
                <Signed value={stats.avgFunding} text={fmtFunding(stats.avgFunding)} className="deriv-stat-v" />
                <span className="deriv-stat-l">{t('derivatives.avgFunding')}</span>
              </div>
            </div>
          ) : null}
        </motion.section>

        <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <div className="glass-notice">{t('derivatives.notice')}</div>
        </motion.div>

        {/* Funding stays its own panel: the venue comparison, the annualised
            cost and the calculator are already built and tested there. */}
        <motion.div variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <FundingPanel />
        </motion.div>

        {/* ─── the board ─────────────────────────────────────────────────── */}
        <motion.section className="glass-board" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 18 }}>
          <div className="glass-head">
            <div>
              <div className="glass-eyebrow">{t('derivatives.marketTable')}</div>
              <div className="glass-title" dir="ltr">dYdX</div>
            </div>
            {loadedAt ? (
              <div className="glass-stamp" dir="ltr" title={new Date(loadedAt).toLocaleString()}>
                {new Date(loadedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </div>
            ) : null}
          </div>

          <div className="deriv-controls">
            <label className="deriv-search">
              <IconSearch size={13} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('derivatives.searchPh')}
                aria-label={t('derivatives.searchPh')}
              />
            </label>
            <div className="deriv-sorts" role="group" aria-label={t('derivatives.sortLabel')}>
              {[['oi', 'sortOi'], ['basis', 'sortBasis'], ['funding', 'sortFunding']].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`deriv-sort${sortKey === key ? ' is-on' : ''}`}
                  onClick={() => setSortKey(key)}
                  aria-pressed={sortKey === key}
                >
                  {t(`derivatives.${label}`)}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="stack" style={{ gap: 8 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="skel"
                  style={{ height: 74, borderRadius: 15 }}
                  animate={{ opacity: [0.45, 0.85, 0.45] }}
                  transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.08 }}
                />
              ))}
            </div>
          ) : unavailable ? (
            <div className="glass-error">{t('derivatives.feedDown')}</div>
          ) : !filtered.length ? (
            <div className="empty" style={{ padding: '20px 0' }}>
              <span className="empty-icon">◎</span>
              <span className="muted" style={{ fontSize: 12.5 }}>{t('derivatives.noMatch')}</span>
            </div>
          ) : (
            <>
              <div className="glass-table">
                <div className="glass-thead" aria-hidden="true">
                  <span>{t('derivatives.basis')}</span>
                  <span className="deriv-th-cells">
                    <span>{t('derivatives.perpShort')}</span>
                    <span>{t('derivatives.spotShort')}</span>
                    <span>{t('derivatives.oiShort')}</span>
                    <span>{t('derivatives.fundShort')}</span>
                  </span>
                </div>

                {visible.map((r) => {
                  const active = selected?.ticker === r.ticker;
                  return (
                    <button
                      key={r.ticker}
                      type="button"
                      className={`glass-row${active ? ' is-active' : ''}`}
                      onClick={() => setTicker(r.ticker)}
                      aria-pressed={active}
                    >
                      <span className="deriv-rail" aria-hidden="true" />
                      <span className="deriv-icon">
                        <AssetIcon symbol={r.base} size={32} radius={11} />
                      </span>
                      <span className="deriv-sym">
                        <span className="deriv-sym-b" dir="ltr">{r.base}</span>
                        <span className="deriv-sym-q" dir="ltr">{r.quote}</span>
                      </span>
                      <span className="deriv-basis" dir="ltr">
                        {r.basisBps == null ? '—' : <Signed value={r.basisBps} text={`${fmtBps(r.basisBps)} bps`} />}
                      </span>

                      {/* four labelled cells rather than a bare run of numbers */}
                      <span className="deriv-meta">
                        <span className="deriv-cell">
                          <i>{t('derivatives.perpShort')}</i>
                          <b dir="ltr">{fmtPrice(r.oraclePrice)}</b>
                        </span>
                        <span className="deriv-cell">
                          <i>{t('derivatives.spotShort')}</i>
                          <b dir="ltr" className="is-muted">{r.spotPx ? fmtPrice(r.spotPx) : '—'}</b>
                        </span>
                        <span className="deriv-cell">
                          <i>{t('derivatives.oiShort')}</i>
                          <b dir="ltr">{r.oiUsd == null ? '—' : fmtCompact(r.oiUsd)}</b>
                          <span className="deriv-oi-bar" aria-hidden="true">
                            <span style={{ width: `${Math.min(100, Math.max(2, (Number(r.oiUsd || 0) / maxOi) * 100))}%` }} />
                          </span>
                        </span>
                        <span className="deriv-cell">
                          <i>{t('derivatives.fundShort')}</i>
                          <Signed value={r.nextFundingRate} text={fmtFunding(r.nextFundingRate)} />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {filtered.length > 30 ? (
                <button type="button" className="deriv-more" onClick={() => setShowAll((v) => !v)}>
                  {showAll
                    ? t('derivatives.showFewer')
                    : `${t('derivatives.showAll')} (${filtered.length.toLocaleString('en-US')})`}
                </button>
              ) : null}
            </>
          )}
        </motion.section>

        {/* ─── the selected market ───────────────────────────────────────── */}
        {selected ? (
          <motion.section className="glass-detail" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 18 }}>
            <div className="glass-head">
              <span className="deriv-icon is-lg">
                <AssetIcon symbol={selected.base} size={38} radius={13} />
              </span>
              <div>
                <div className="glass-eyebrow" dir="ltr">dYdX • PERP</div>
                <div className="glass-title" dir="ltr">{selected.ticker}</div>
              </div>
              {selected.basisBps != null ? (
                <span className={`glass-basis${selected.basisBps >= 0 ? ' is-up' : ' is-down'}`} dir="ltr">
                  {fmtBps(selected.basisBps)} bps
                </span>
              ) : null}
            </div>

            <div className="deriv-grid">
              <Tile icon={IconTrend} label={t('derivatives.perpPrice')} value={fmtUsd(selected.oraclePrice)} note="oracle" />
              <Tile icon={IconMarket} label={t('derivatives.spotPrice')} value={selected.spotPx ? fmtUsd(selected.spotPx) : '—'} note={selected.spotPx ? 'CoinGecko' : t('derivatives.noSpot')} />
              <Tile icon={IconCoins} label={t('derivatives.openInterest')} value={selected.oiUsd == null ? '—' : fmtCompact(selected.oiUsd)} note={Number.isFinite(Number(selected.openInterest)) ? `${fmtPrice(selected.openInterest)} ${selected.base}` : null} />
              <Tile
                icon={IconClock}
                label={t('derivatives.nextFunding')}
                value={fmtFunding(selected.nextFundingRate)}
                note={t('derivatives.perHour')}
                tone={Number(selected.nextFundingRate) > 0 ? 'up' : Number(selected.nextFundingRate) < 0 ? 'down' : 'flat'}
              />
              <Tile icon={IconActivity} label={t('derivatives.spread')} value={bookLive ? `${Number(book.spreadBps).toFixed(2)} bps` : '—'} note={bookLive ? 'bid / ask' : t('derivatives.bookDown')} />
              <Tile icon={IconActivity} label={t('derivatives.change24h')} value={selected.changePct == null ? '—' : fmtPct(selected.changePct, 2)} tone={Number(selected.changePct) >= 0 ? 'up' : 'down'} />
              <Tile icon={IconCoins} label={t('derivatives.bidDepth')} value={bookLive ? fmtCompact(book.bidDepth1Pct) : '—'} note="±1%" />
              <Tile icon={IconCoins} label={t('derivatives.askDepth')} value={bookLive ? fmtCompact(book.askDepth1Pct) : '—'} note="±1%" />
            </div>

            {/* The two depth figures as opposed bars. */}
            {bookLive ? (
              <div className="deriv-depth" dir="ltr">
                <div className="deriv-depth-title">{t('derivatives.depthTitle')}</div>
                <div className="deriv-depth-row">
                  <span className="deriv-depth-l">{t('derivatives.bidSide')}</span>
                  <span className="deriv-depth-track is-bid">
                    <span style={{ width: `${(Number(book.bidDepth1Pct || 0) / depthMax) * 100}%` }} />
                  </span>
                  <span className="deriv-depth-v">{fmtCompact(book.bidDepth1Pct)}</span>
                </div>
                <div className="deriv-depth-row">
                  <span className="deriv-depth-l">{t('derivatives.askSide')}</span>
                  <span className="deriv-depth-track is-ask">
                    <span style={{ width: `${(Number(book.askDepth1Pct || 0) / depthMax) * 100}%` }} />
                  </span>
                  <span className="deriv-depth-v">{fmtCompact(book.askDepth1Pct)}</span>
                </div>
              </div>
            ) : null}

            <p className="glass-foot">{t('derivatives.rowNote')}</p>
          </motion.section>
        ) : null}
      </div>
    </PageTransition>
  );
}
