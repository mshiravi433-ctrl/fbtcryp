import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReducedMotion } from 'framer-motion';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMarkets } from '../../hooks/useMarket';
import { SPOT_DEPTH_BANDS, SPOT_DEPTH_TTL_MS, createDepthCache, usdPriceFor } from '../../lib/spotDepth';
import { loadSpotDepth, makeSpotQuoteFn } from '../../lib/spotDepthQuotes';
import '../../styles/spot-depth.css';

/*
 * ─── SPOT DEPTH, AS A CARD ───────────────────────────────────────────────────
 * Shows how the price per unit changes with trade size, from non-binding
 * aggregator quotes. It is NOT an order book, and every view of it says so.
 * The component never sends, signs or reserves anything.
 *
 * Module-level cache: a curve is reused across remounts for SPOT_DEPTH_TTL_MS,
 * keyed by chain and both tokens, so switching tabs does not re-quote.
 */
const cache = createDepthCache({ ttlMs: SPOT_DEPTH_TTL_MS });

const BAND_GLYPH = { low: '●', medium: '◆', high: '▲' };

const fmtRate = (r) => (Number.isFinite(r) ? Number(r).toPrecision(6) : '—');
const fmtPct = (p) => (Number.isFinite(p) ? `${p.toFixed(2)}%` : '—');
const fmtUsdLabel = (n) => `$${Number(n).toLocaleString('en-US')}`;

export default function SpotDepth({
  chainId,
  fromToken,
  toToken,
  fromUsdPrice = null,
  fromAddress = null,
  getProvider,
  fetchCurve = null
}) {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  const [state, setState] = useState({ status: 'idle', curve: [], refreshedAt: null });
  const [bump, setBump] = useState(0);
  const [, setTick] = useState(0);
  const seq = useRef(0);

  const key = fromToken && toToken
    ? `${chainId}|${fromToken.address || fromToken.symbol}|${toToken.address || toToken.symbol}|${Number(fromUsdPrice || 0).toFixed(2)}`
    : null;

  useEffect(() => {
    if (!key) return undefined;
    if (!Number.isFinite(Number(fromUsdPrice)) || Number(fromUsdPrice) <= 0) {
      setState({ status: 'noPrice', curve: [], refreshedAt: null });
      return undefined;
    }
    const mine = ++seq.current;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(async () => {
      setState((s) => ({ ...s, status: 'loading' }));
      try {
        const provider = typeof getProvider === 'function' ? await getProvider() : null;
        if (controller?.signal.aborted || mine !== seq.current) return;
        const run = fetchCurve
          ? () => fetchCurve({ key, signal: controller?.signal })
          : () => loadSpotDepth({
              key,
              cache,
              quoteFn: makeSpotQuoteFn({ provider, chainId, fromToken, toToken, fromUsdPrice, fromAddress }),
              signal: controller?.signal
            });
        const r = await run();
        if (controller?.signal.aborted || mine !== seq.current) return;
        const curve = Array.isArray(r?.curve) ? r.curve : [];
        const anyOk = curve.some((p) => p.status === 'ok');
        setState({ status: anyOk ? 'ready' : 'unsupported', curve, refreshedAt: r?.refreshedAt ?? Date.now() });
      } catch (err) {
        if (err?.name === 'AbortError' || controller?.signal.aborted || mine !== seq.current) return;
        setState((s) => ({ ...s, status: 'error' }));
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller?.abort();
    };
    // `bump` is the explicit refresh; it re-runs the effect and bypasses the cache entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, bump]);

  /* Refresh = drop this pair's cache entry, then run the effect again. */
  const refresh = () => {
    if (key) cache.del(key);
    setBump((n) => n + 1);
  };

  /* Re-render every 10 s so the «قدیمی» label appears without a new request. */
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const stale = state.refreshedAt ? Date.now() - state.refreshedAt > SPOT_DEPTH_TTL_MS : false;
  const timeLabel = useMemo(() => {
    if (!state.refreshedAt) return '';
    try {
      return new Date(state.refreshedAt).toLocaleTimeString(i18n.language || 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return new Date(state.refreshedAt).toISOString().slice(11, 19);
    }
  }, [state.refreshedAt, i18n.language]);

  const points = state.curve.filter((p) => p.status === 'ok');
  const chartData = points.map((p) => ({ label: fmtUsdLabel(p.sizeUsd), impact: Number(p.impactPct.toFixed(4)) }));
  const pair = fromToken && toToken ? `${fromToken.symbol} → ${toToken.symbol}` : '';

  let body;
  if (!key) {
    body = <p className="notice">{t('spot.depth.unsupported')}</p>;
  } else if (state.status === 'noPrice') {
    body = <p className="notice">{t('spot.depth.noPrice')}</p>;
  } else if (state.status === 'error') {
    body = <p className="notice notice-danger">{t('spot.depth.error')}</p>;
  } else if (state.status === 'unsupported') {
    body = <p className="notice">{t('spot.depth.unsupported')}</p>;
  } else if (state.status === 'idle' || state.status === 'loading' || !state.refreshedAt) {
    body = (
      <div className="depth-skeleton" role="status" aria-live="polite">
        <span className="depth-skeleton-bar" />
        <span className="faint">{t('spot.depth.loading')}</span>
      </div>
    );
  } else {
    body = (
      <>
        <div className="depth-chart" role="img" aria-label={t('spot.depth.chartLabel')} dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 6" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-2)', fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fill: 'var(--text-2)', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v) => `${v}%`}
              />
              <ReferenceLine y={0} stroke="var(--line-strong)" />
              <Tooltip
                cursor={{ stroke: 'var(--line-strong)' }}
                contentStyle={{ background: 'var(--bg-panel-solid)', border: '1px solid var(--line)', borderRadius: 10, fontSize: 12 }}
                formatter={(v) => [t('spot.depth.impactTip', { value: Number(v).toFixed(2) }), t('spot.depth.col.impact')]}
              />
              <Area
                type="monotone"
                dataKey="impact"
                stroke="var(--rgb-1)"
                fill="var(--rgb-1)"
                fillOpacity={0.14}
                strokeWidth={2}
                isAnimationActive={!reduced}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="depth-table-wrap">
          <table className="depth-table">
            <caption>{t('spot.depth.tableCaption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('spot.depth.col.size')}</th>
                <th scope="col">{t('spot.depth.col.rate')}</th>
                <th scope="col">{t('spot.depth.col.impact')}</th>
                <th scope="col">{t('spot.depth.col.signal')}</th>
              </tr>
            </thead>
            <tbody>
              {state.curve.map((p) => (
                <tr key={p.sizeUsd} className={p.status === 'ok' ? '' : 'is-unavailable'}>
                  <th scope="row" className="mono" dir="ltr">{fmtUsdLabel(p.sizeUsd)}</th>
                  <td className="mono num" dir="ltr">{p.status === 'ok' ? fmtRate(p.rate) : t('spot.depth.pointUnavailable')}</td>
                  <td className="mono num" dir="ltr">{p.status === 'ok' ? fmtPct(p.impactPct) : '—'}</td>
                  <td>
                    {p.status === 'ok' && p.band ? (
                      <span className={`depth-band depth-band-${p.band}`}>
                        <span aria-hidden="true">{BAND_GLYPH[p.band]}</span>
                        {t(`spot.depth.band.${p.band}`)}
                      </span>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint depth-thresholds">
          {t('spot.depth.thresholds', { medium: SPOT_DEPTH_BANDS.mediumPct, high: SPOT_DEPTH_BANDS.highPct })}
        </p>
      </>
    );
  }

  return (
    <section className="card depth-card" aria-labelledby="spot-depth-title">
      <div className="depth-head">
        <div>
          <h3 id="spot-depth-title" className="depth-title">{t('spot.depth.title')}</h3>
          {pair && <div className="faint depth-pair" dir="ltr">{pair}</div>}
        </div>
        <button type="button" className="btn btn-ghost btn-sm depth-refresh" onClick={refresh} disabled={!key || state.status === 'loading'}>
          {t('spot.depth.refresh')}
        </button>
      </div>

      <p className="notice depth-caveat">{t('spot.depth.caveat')}</p>

      {state.refreshedAt && (
        <div className="depth-meta">
          {stale ? (
            <span className="depth-stale"><span aria-hidden="true">⟳</span> {t('spot.depth.stale')}</span>
          ) : (
            <span className="faint mono" dir="ltr">{t('spot.depth.updatedAt', { time: timeLabel })}</span>
          )}
        </div>
      )}

      {body}

      <p className="faint depth-disclaimer">{t('spot.depth.disclaimer')}</p>
    </section>
  );
}

/**
 * The Swap page's entry point: reads the token's USD price from the market feed
 * (by CoinGecko id, see usdPriceFor) and hands it to the card. Mounted only when
 * SPOT_DEPTH_ENABLED is on, so the market poll is not started otherwise.
 */
export function SpotDepthLive(props) {
  const { data: coins } = useMarkets(250);
  const fromUsdPrice = usdPriceFor(coins, props.fromToken?.coingeckoId);
  return <SpotDepth {...props} fromUsdPrice={fromUsdPrice} />;
}

