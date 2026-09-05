import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import CoinLogo from '../components/CoinLogo';
import SegIndicator from '../components/SegIndicator';
import { IconChevronLeft, IconSearch } from '../components/Icons';
import { useChart, useCoin, useCoinSearch, useMarkets } from '../hooks/useMarket';
import { fmtCompact, fmtNum, fmtPct, fmtPrice } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import '../styles/compare.css';

/**
 * COMPARE — two tokens, side by side, on everything measurable.
 *
 * ─── WHAT "WINNING" MEANS HERE ──────────────────────────────────────────────
 * Each row names its own rule (higher 24h change wins, LOWER rank wins, LOWER
 * volatility wins) and rows where "better" is meaningless — the price itself —
 * are shown with NO winner. The score tally counts only rows with a rule, so
 * "6–3" reads as "wins six of the measured rounds", never as investment
 * advice. Nothing here says which token to buy.
 *
 * ─── THE CHART IS REBASED, AND SAYS SO ──────────────────────────────────────
 * Bitcoin at $100k and a $0.02 token cannot share a price axis — one of them
 * would be a flat line at zero. Both series are rebased to 100 at the window
 * start, so the chart answers "which one moved more" and ONLY that. The
 * caption states the method; dollars stay in the tooltip.
 */

const RANGES = [
  { key: '7D', days: 7 },
  { key: '30D', days: 30 },
  { key: '90D', days: 90 }
];

const A_COLOR = '#00e5ff';
const B_COLOR = '#ff2d95';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Standard deviation of simple returns — a rough "how shaky" gauge. */
function volatility(series) {
  const pts = (series ?? []).map((d) => d.p).filter(Number.isFinite);
  if (pts.length < 8) return null;
  const rets = [];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i - 1] > 0) rets.push((pts[i] - pts[i - 1]) / pts[i - 1]);
  }
  if (rets.length < 8) return null;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * 100;
}

function windowPerf(series) {
  const pts = (series ?? []).map((d) => d.p).filter((p) => Number.isFinite(p) && p > 0);
  if (pts.length < 2) return null;
  return ((pts[pts.length - 1] - pts[0]) / pts[0]) * 100;
}

function PerfTip({ active, payload, label, aSym, bSym, t }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="chart-tip">
      <div className="faint" style={{ fontSize: 10, marginBottom: 4 }}>
        {row.t ? new Date(row.t).toLocaleDateString() : `#${label}`}
      </div>
      <div className="mono" style={{ fontSize: 11.5, display: 'grid', gap: 3 }}>
        <span style={{ color: A_COLOR }}>
          {aSym} {row.aPa != null ? `$${fmtPrice(row.aPa)}` : '—'}
          <span className="faint"> ({row.a != null ? `${row.a.toFixed(1)}` : '—'})</span>
        </span>
        <span style={{ color: B_COLOR }}>
          {bSym} {row.bPa != null ? `$${fmtPrice(row.bPa)}` : '—'}
          <span className="faint"> ({row.b != null ? `${row.b.toFixed(1)}` : '—'})</span>
        </span>
      </div>
    </div>
  );
}

function PickerSheet({ open, side, coins, onPick, onClose }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const { results: remoteHits, searching } = useCoinSearch(q);

  useEffect(() => {
    if (open) setQ('');
  }, [open, side]);

  const local = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return (coins ?? []).slice(0, 60);
    return (coins ?? [])
      .filter((c) => c.symbol.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle))
      .slice(0, 60);
  }, [coins, q]);

  const extra = useMemo(() => {
    if (!q.trim()) return [];
    const have = new Set(local.map((c) => c.id));
    return (remoteHits ?? []).filter((c) => !have.has(c.id)).slice(0, 15);
  }, [remoteHits, local, q]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="cmp-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="cmp-sheet"
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row-between" style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                {t(side === 'a' ? 'compare.pickA' : 'compare.pickB')}
              </div>
              <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>✕</button>
            </div>
            <label className="disc-search">
              <IconSearch width={15} height={15} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('compare.searchPlaceholder')}
                inputMode="search"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <div className="cmp-list">
              {local.map((c) => (
                <button key={c.id} className="coin-row cmp-row" onClick={() => onPick(c.id)}>
                  <CoinLogo coin={c} />
                  <div className="coin-meta">
                    <div className="coin-sym">{c.symbol}</div>
                    <div className="coin-name">{c.name}</div>
                  </div>
                  <div className="coin-right">
                    <div className="mono" style={{ fontSize: 12 }}>${fmtPrice(c.price)}</div>
                    <div className={`mono ${(c.change24h ?? 0) >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
                      {fmtPct(c.change24h ?? 0, 1)}
                    </div>
                  </div>
                </button>
              ))}
              {extra.map((c) => (
                <button key={c.id} className="coin-row cmp-row" onClick={() => onPick(c.id)}>
                  <CoinLogo coin={c} />
                  <div className="coin-meta">
                    <div className="coin-sym">{c.symbol}</div>
                    <div className="coin-name">{c.name}</div>
                  </div>
                  {c.rank > 0 && <span className="faint mono" style={{ fontSize: 11 }}>#{c.rank}</span>}
                </button>
              ))}
              {local.length === 0 && extra.length === 0 && (
                <div className="empty">
                  <span className="empty-icon">🔍</span>
                  {searching ? t('common.searching') : t('compare.noResults')}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TokenCard({ coin, color, side, onChange, t }) {
  const up = (coin?.change24h ?? 0) >= 0;
  return (
    <button
      type="button"
      className="cmp-token"
      style={{ '--cmp': color }}
      onClick={onChange}
    >
      <span className="cmp-side" style={{ background: color }}>
        {side === 'a' ? t('compare.tokenA') : t('compare.tokenB')}
      </span>
      {coin ? (
        <>
          <CoinLogo coin={coin} px={40} />
          <span className="cmp-tname">{coin.symbol}</span>
          <span className="cmp-tsub">{coin.name}</span>
          <span className="cmp-tprice mono">${fmtPrice(coin.price)}</span>
          <span className={`mono ${up ? 'up' : 'down'}`} style={{ fontSize: 11.5, fontWeight: 700 }}>
            {fmtPct(coin.change24h ?? 0, 2)}
          </span>
        </>
      ) : (
        <>
          <span className="cmp-plus">＋</span>
          <span className="cmp-tname faint">{t('compare.choose')}</span>
        </>
      )}
      <span className="cmp-change">{t('compare.change')}</span>
    </button>
  );
}

function MetricRow({ label, hint, a, b, aText, bText, winner, t }) {
  /* Share bars from absolute magnitude; a missing value concedes the bar. */
  const aa = Math.abs(num(a) ?? NaN);
  const bb = Math.abs(num(b) ?? NaN);
  const total = (Number.isFinite(aa) ? aa : 0) + (Number.isFinite(bb) ? bb : 0);
  const wa = total > 0 && Number.isFinite(aa) ? (aa / total) * 100 : Number.isFinite(aa) ? 50 : 0;
  const wb = total > 0 && Number.isFinite(bb) ? (bb / total) * 100 : Number.isFinite(bb) ? 50 : 0;
  return (
    <motion.div className="cmp-metric" variants={riseIn}>
      <div className="cmp-mhead">
        <span className="cmp-mlabel">{label}</span>
        {hint ? <span className="faint cmp-mhint">{hint}</span> : null}
      </div>
      <div className="cmp-mvals">
        <span className={`mono cmp-mval ${winner === 'a' ? 'cmp-win' : ''}`}>
          {winner === 'a' ? <span className="cmp-crown" aria-hidden="true">●</span> : null}
          {aText}
        </span>
        <span className={`mono cmp-mval ${winner === 'b' ? 'cmp-win' : ''}`}>
          {bText}
          {winner === 'b' ? <span className="cmp-crown cmp-crown-b" aria-hidden="true">●</span> : null}
        </span>
      </div>
      <div className="cmp-bars" aria-hidden="true">
        <div className="cmp-bar-l">
          <motion.div
            className="cmp-fill-l"
            initial={{ width: 0 }}
            animate={{ width: `${wa}%` }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        </div>
        <div className="cmp-bar-r">
          <motion.div
            className="cmp-fill-r"
            initial={{ width: 0 }}
            animate={{ width: `${wb}%` }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        </div>
      </div>
    </motion.div>
  );
}

export default function Compare() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [params, setParams] = useSearchParams();
  const aId = params.get('a') || 'bitcoin';
  const bId = params.get('b') || 'ethereum';

  const [range, setRange] = useState(RANGES[1]);
  const [picker, setPicker] = useState(null); // 'a' | 'b' | null

  const { data: coins } = useMarkets(250);
  const { data: coinA } = useCoin(aId);
  const { data: coinB } = useCoin(bId);
  /* Fall back to the market row so the header paints before the direct fetch. */
  const ca = coinA ?? (coins ?? []).find((c) => c.id === aId) ?? null;
  const cb = coinB ?? (coins ?? []).find((c) => c.id === bId) ?? null;

  const { data: seriesA, loading: loadingA } = useChart(aId, range.days);
  const { data: seriesB, loading: loadingB } = useChart(bId, range.days);

  const set = (a, b) => {
    haptic?.('light');
    setParams({ a, b }, { replace: true });
    setPicker(null);
  };

  /* Both legs rebased to 100 at the window start — see the file header. */
  const perf = useMemo(() => {
    const pa = (seriesA ?? []).map((d) => d.p).filter((p) => Number.isFinite(p) && p > 0);
    const pb = (seriesB ?? []).map((d) => d.p).filter((p) => Number.isFinite(p) && p > 0);
    const ta = (seriesA ?? []).map((d) => d.t);
    if (pa.length < 2 || pb.length < 2) return [];
    /* Same provider, same window → same cadence; align by index on the tail. */
    const n = Math.min(pa.length, pb.length);
    const aa = pa.slice(-n);
    const bb = pb.slice(-n);
    const tt = ta.slice(-n);
    return aa.map((p, i) => ({
      i,
      t: tt[i],
      a: (p / aa[0]) * 100,
      b: (bb[i] / bb[0]) * 100,
      aPa: p,
      bPa: bb[i]
    }));
  }, [seriesA, seriesB]);

  const perfA = perf.length ? perf[perf.length - 1].a - 100 : null;
  const perfB = perf.length ? perf[perf.length - 1].b - 100 : null;
  const volA = useMemo(() => volatility(seriesA), [seriesA]);
  const volB = useMemo(() => volatility(seriesB), [seriesB]);

  /* ─── THE ROUNDS ──────────────────────────────────────────────────────────
     `dir`: 'high' wins with the bigger number, 'low' with the smaller,
     null means "shown, never scored" (a price is not a contest). */
  const rounds = useMemo(() => {
    const R = (key, labelKey, a, b, aText, bText, dir, hintKey = null) => ({ key, labelKey, a, b, aText, bText, dir, hintKey });
    const liqA = ca && ca.mcap > 0 ? (ca.volume ?? 0) / ca.mcap : null;
    const liqB = cb && cb.mcap > 0 ? (cb.volume ?? 0) / cb.mcap : null;
    return [
      R('price', 'compare.m.price', ca?.price, cb?.price,
        ca ? `$${fmtPrice(ca.price)}` : '—', cb ? `$${fmtPrice(cb.price)}` : '—', null),
      R('ch1h', 'compare.m.ch1h', ca?.change1h, cb?.change1h,
        fmtPct(ca?.change1h ?? NaN), fmtPct(cb?.change1h ?? NaN), 'high'),
      R('ch24h', 'compare.m.ch24h', ca?.change24h, cb?.change24h,
        fmtPct(ca?.change24h ?? NaN), fmtPct(cb?.change24h ?? NaN), 'high'),
      R('ch7d', 'compare.m.ch7d', ca?.change7d, cb?.change7d,
        fmtPct(ca?.change7d ?? NaN), fmtPct(cb?.change7d ?? NaN), 'high'),
      R('mcap', 'compare.m.mcap', ca?.mcap, cb?.mcap,
        fmtCompact(ca?.mcap), fmtCompact(cb?.mcap), 'high', 'compare.h.mcap'),
      R('volume', 'compare.m.volume', ca?.volume, cb?.volume,
        fmtCompact(ca?.volume), fmtCompact(cb?.volume), 'high', 'compare.h.volume'),
      R('rank', 'compare.m.rank', ca?.rank, cb?.rank,
        ca?.rank ? `#${fmtNum(ca.rank, 0)}` : '—', cb?.rank ? `#${fmtNum(cb.rank, 0)}` : '—', 'low'),
      R('ath', 'compare.m.ath', ca?.athChange, cb?.athChange,
        fmtPct(ca?.athChange ?? NaN, 1), fmtPct(cb?.athChange ?? NaN, 1), 'high', 'compare.h.ath'),
      R('liq', 'compare.m.liq', liqA, liqB,
        liqA != null ? `${(liqA * 100).toFixed(1)}%` : '—', liqB != null ? `${(liqB * 100).toFixed(1)}%` : '—',
        'high', 'compare.h.liq'),
      R('window', 'compare.m.window', perfA, perfB,
        perfA != null ? fmtPct(perfA, 1) : '—', perfB != null ? fmtPct(perfB, 1) : '—', 'high', 'compare.h.window'),
      R('vol', 'compare.m.vol', volA, volB,
        volA != null ? `${volA.toFixed(2)}%` : '—', volB != null ? `${volB.toFixed(2)}%` : '—', 'low', 'compare.h.vol')
    ];
  }, [ca, cb, perfA, perfB, volA, volB]);

  const scored = useMemo(() => rounds.map((r) => {
    const a = num(r.a);
    const b = num(r.b);
    let winner = null;
    if (r.dir && a != null && b != null && a !== b) {
      winner = r.dir === 'high' ? (a > b ? 'a' : 'b') : (a < b ? 'a' : 'b');
    }
    return { ...r, winner };
  }), [rounds]);

  const winsA = scored.filter((r) => r.winner === 'a').length;
  const winsB = scored.filter((r) => r.winner === 'b').length;
  const total = winsA + winsB;

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('compare.title')}</h1>
      </motion.div>
      <p className="muted">{t('compare.subtitle')}</p>

      {/* ── the two contenders ── */}
      <motion.div className="cmp-duel" variants={stagger} initial="hidden" animate="show">
        <TokenCard coin={ca} color={A_COLOR} side="a" onChange={() => setPicker('a')} t={t} />
        <div className="cmp-mid">
          <span className="cmp-vs">VS</span>
          <button
            type="button"
            className="cmp-swap"
            onClick={() => set(bId, aId)}
            aria-label={t('compare.swap')}
            title={t('compare.swap')}
          >
            ⇄
          </button>
        </div>
        <TokenCard coin={cb} color={B_COLOR} side="b" onChange={() => setPicker('b')} t={t} />
      </motion.div>

      {/* ── scoreboard ── */}
      {total > 0 && (
        <motion.section className="card card-rgb cmp-score" variants={riseIn} initial="hidden" animate="show">
          <div className="sheen" />
          <div className="row-between">
            <span className="mono cmp-score-n" style={{ color: A_COLOR }}>{ca?.symbol ?? '—'} · {winsA}</span>
            <span className="faint" style={{ fontSize: 11 }}>{t('compare.rounds', { n: total })}</span>
            <span className="mono cmp-score-n" style={{ color: B_COLOR }}>{winsB} · {cb?.symbol ?? '—'}</span>
          </div>
          <div className="cmp-scorebar" aria-hidden="true">
            <motion.div
              className="cmp-score-a"
              initial={{ width: 0 }}
              animate={{ width: `${(winsA / total) * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
            <motion.div
              className="cmp-score-b"
              initial={{ width: 0 }}
              animate={{ width: `${(winsB / total) * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          </div>
          <p className="faint" style={{ fontSize: 11, margin: '8px 0 0', lineHeight: 1.7 }}>
            {t(winsA === winsB ? 'compare.tie' : winsA > winsB ? 'compare.leadsA' : 'compare.leadsB', {
              a: ca?.symbol ?? '',
              b: cb?.symbol ?? ''
            })}
          </p>
        </motion.section>
      )}

      {/* ── rebased performance ── */}
      <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <div className="row-between" style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('compare.perfTitle')}</div>
          <div className="segmented cmp-range">
            {RANGES.map((r) => (
              <button
                key={r.key}
                className={range.key === r.key ? 'active' : ''}
                onClick={() => { haptic?.('select'); setRange(r); }}
                style={{ isolation: 'isolate' }}
              >
                {range.key === r.key && <SegIndicator id="cmp-range" />}
                {r.key}
              </button>
            ))}
          </div>
        </div>
        <div className="cmp-plegend">
          <span><span className="tv-dot" style={{ background: A_COLOR }} />{ca?.symbol ?? '—'}</span>
          <span><span className="tv-dot" style={{ background: B_COLOR }} />{cb?.symbol ?? '—'}</span>
        </div>
        <div className="chart-wrap" style={{ height: 190 }} dir="ltr">
          {(loadingA || loadingB) && perf.length === 0 ? (
            <div className="skel" style={{ height: '100%' }} />
          ) : perf.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={perf} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="i" hide />
                <YAxis domain={['auto', 'auto']} hide />
                <Tooltip
                  content={<PerfTip aSym={ca?.symbol} bSym={cb?.symbol} t={t} />}
                  cursor={{ stroke: 'rgba(255,255,255,.2)' }}
                />
                <ReferenceLine y={100} stroke="rgba(255,255,255,.25)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="a" stroke={A_COLOR} strokeWidth={2} dot={false} isAnimationActive animationDuration={800} />
                <Line type="monotone" dataKey="b" stroke={B_COLOR} strokeWidth={2} dot={false} isAnimationActive animationDuration={800} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty" style={{ padding: 16 }}>
              <span className="empty-icon">📉</span>
              {t('compare.noPerf')}
            </div>
          )}
        </div>
        <p className="faint" style={{ fontSize: 11, margin: '8px 0 0', lineHeight: 1.7 }}>
          {t('compare.rebasedNote', { days: range.days })}
        </p>
      </motion.section>

      {/* ── round by round ── */}
      <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
        {scored.map((r) => (
          <MetricRow
            key={r.key}
            label={t(r.labelKey)}
            hint={r.hintKey ? t(r.hintKey) : null}
            a={r.a}
            b={r.b}
            aText={r.aText}
            bText={r.bText}
            winner={r.winner}
            t={t}
          />
        ))}
      </motion.div>

      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="btn btn-ghost btn-sm" onClick={() => ca && navigate(`/coin/${ca.id}`)} disabled={!ca}>
          {t('compare.viewCoin', { symbol: ca?.symbol ?? '' })}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => cb && navigate(`/coin/${cb.id}`)} disabled={!cb}>
          {t('compare.viewCoin', { symbol: cb?.symbol ?? '' })}
        </button>
      </motion.div>

      <PickerSheet
        open={picker != null}
        side={picker ?? 'a'}
        coins={coins}
        onClose={() => setPicker(null)}
        onPick={(id) => (picker === 'b' ? set(aId, id) : set(id, bId))}
      />
    </PageTransition>
  );
}
