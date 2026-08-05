import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import SegIndicator from './SegIndicator';
import { fmtCompact, fmtUsd } from '../lib/format';
import { bestVenue, fundingCost, getPerpMarkets } from '../lib/perp';

/**
 * LIVE FUNDING RATES, PER VENUE.
 *
 * ─── WHY THIS COMPONENT EXISTS ──────────────────────────────────────────────
 * The Perp screen explained funding in a paragraph and then showed a spot
 * price. Funding is the cost that decides whether holding a leveraged position
 * is cheap or ruinous, it is charged every few hours whether the trade is
 * winning or losing, and it differs by SEVERAL PERCENT A YEAR between venues
 * for the exact same trade. Nobody checks, because no interface puts the
 * venues side by side.
 *
 * That is the whole product here: a comparison the user cannot easily make
 * themselves, on a cost they are about to pay without seeing it.
 *
 * ─── WHY IT IS HONEST FOR US TO SHOW THIS ───────────────────────────────────
 * We earn nothing from any venue listed. There is no affiliate link, no
 * referral code and no revenue share, and the screen says so. That is exactly
 * why the ranking can be trusted: nothing here is bought, so the cheapest
 * venue is simply the one with the lowest number.
 *
 * ─── WHY NULL IS RENDERED AS "—" AND NEVER AS ZERO ──────────────────────────
 * A missing funding rate and a zero funding rate are opposite statements. Zero
 * means holding is free; missing means we do not know. Collapsing them would
 * make the cheapest-venue row point at whichever venue failed to report,
 * which is the worst possible failure mode for a cost comparison.
 */

/** Refresh cadence. Matches the server's five-minute cache exactly, so a
 *  poll can never be more frequent than the data it is polling. */
const REFRESH_MS = 300_000;

const SIDES = ['long', 'short'];

/** Preset position sizes for the cost calculator, in USD of collateral. */
const SIZES = [100, 500, 1000];
const LEVERAGES = [2, 5, 10, 25];

function pct(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}%`;
}

export default function FundingPanel() {
  const { t } = useTranslation();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [symbol, setSymbol] = useState('BTC');
  const [side, setSide] = useState('long');
  const [collateral, setCollateral] = useState(500);
  const [leverage, setLeverage] = useState(5);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const d = await getPerpMarkets();
        if (!alive) return;
        setData(d);
        setErr(null);
      } catch (e) {
        if (!alive) return;
        /*
         * No cached fallback, deliberately — see lib/perp.js. A stale funding
         * rate presented as live can tell someone a position pays them when it
         * costs them.
         */
        setErr(e.message || 'FUNDING_FAILED');
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const assets = data?.assets ?? [];
  const asset = useMemo(
    () => assets.find((a) => a.symbol === symbol) ?? assets[0] ?? null,
    [assets, symbol]
  );

  const cheapest = useMemo(() => (asset ? bestVenue(asset, side) : null), [asset, side]);

  /*
   * The cost of holding, at the cheapest venue for the chosen direction.
   *
   * The sign flips for a short: positive funding is paid BY longs, so the same
   * rate that costs a long money pays a short. Getting this backwards would
   * invert the single number this panel exists to communicate, so the flip
   * happens once, here, rather than in the rendering.
   */
  const cost = useMemo(() => {
    if (!cheapest || cheapest.fundingApr == null) return null;
    const apr = side === 'short' ? -cheapest.fundingApr : cheapest.fundingApr;
    return fundingCost({ collateralUsd: collateral, leverage, aprPct: apr, days: 30 });
  }, [cheapest, side, collateral, leverage]);

  if (loading) {
    return <div className="skel" style={{ height: 220 }} />;
  }

  if (err || !asset) {
    return (
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('perp.fundingTitle')}</p>
        <p className="muted" style={{ fontSize: 12.3, margin: 0 }}>{t('perp.fundingUnavailable')}</p>
      </motion.section>
    );
  }

  return (
    <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
      <p className="section-label" style={{ marginBottom: 6 }}>{t('perp.fundingTitle')}</p>
      <p className="muted" style={{ fontSize: 12.2, margin: '0 0 10px', lineHeight: 1.8 }}>
        {t('perp.fundingIntro')}
      </p>

      {/* ---------------------------- asset picker ---------------------------- */}
      <div className="tag-scroll">
        {assets.map((a) => (
          <button
            key={a.symbol}
            className={`tag ${asset.symbol === a.symbol ? 'active' : ''}`}
            onClick={() => setSymbol(a.symbol)}
          >
            {a.symbol}
          </button>
        ))}
      </div>

      {/* --------------------------- who is crowded --------------------------- */}
      {asset.crowding && (
        <p className="notice" style={{ marginTop: 10 }}>
          {t(`perp.crowd.${asset.crowding}`, {
            symbol: asset.symbol,
            apr: pct(asset.avgFundingApr, 1)
          })}
        </p>
      )}

      {/* ------------------------------ the table ----------------------------- */}
      <table className="perp-liq" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>{t('perp.fundVenue')}</th>
            <th style={{ textAlign: 'end' }}>{t('perp.fundApr')}</th>
            <th style={{ textAlign: 'end' }}>{t('perp.fundOi')}</th>
          </tr>
        </thead>
        <tbody>
          {asset.venues.map((v) => {
            const isBest = cheapest && v.venue === cheapest.venue;
            return (
              <tr key={v.venue}>
                <td>
                  <span style={{ fontWeight: isBest ? 700 : 500 }}>{v.venue}</span>
                  <span className="set-row-sub" style={{ display: 'block' }}>
                    {t(`perp.custody.${v.custody}`)} · {t('perp.fundEvery', { hours: v.intervalHours })}
                  </span>
                </td>
                {/*
                  Coloured by whether it costs THIS user money, not by sign.
                  A long and a short reading the same row are looking at
                  opposite outcomes, and painting positive-is-red for both
                  would be wrong for one of them every time.
                */}
                <td
                  className="mono"
                  style={{
                    textAlign: 'end',
                    color:
                      v.fundingApr == null
                        ? 'var(--text-3)'
                        : (side === 'long' ? v.fundingApr > 0 : v.fundingApr < 0)
                          ? 'var(--down)'
                          : 'var(--up)'
                  }}
                >
                  {pct(v.fundingApr, 1)}
                </td>
                <td className="mono" style={{ textAlign: 'end', fontSize: 11.5 }}>
                  ${fmtCompact(v.openInterestUsd)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/*
        The spread. This is the sentence that justifies the panel: the same
        position, at the same moment, costs materially more at one venue than
        another, and the difference is invisible unless somebody lines them up.
      */}
      {asset.fundingSpread != null && asset.fundingSpread > 0 && (
        <p className="faint" style={{ fontSize: 11.4, marginTop: 8, lineHeight: 1.7 }}>
          {t('perp.fundSpread', { spread: asset.fundingSpread.toFixed(1), symbol: asset.symbol })}
        </p>
      )}

      {/* --------------------------- cost calculator -------------------------- */}
      <p className="section-label" style={{ margin: '16px 0 8px' }}>{t('perp.costTitle')}</p>

      {/*
        `isolation: isolate` + SegIndicator is the app-wide convention for a
        segmented control — the shared layout animation slides the pill
        between tabs. Omitting it here made this the only segmented control in
        the app that snapped instead of sliding; the wiring audit caught it.
      */}
      <div className="segmented" style={{ marginBottom: 9 }}>
        {SIDES.map((s) => (
          <button
            key={s}
            className={side === s ? 'active' : ''}
            onClick={() => setSide(s)}
            style={{ isolation: 'isolate' }}
          >
            {side === s && <SegIndicator id="perpside" />}
            {t(`perp.side.${s}`)}
          </button>
        ))}
      </div>

      <div className="tag-scroll">
        {SIZES.map((s) => (
          <button
            key={s}
            className={`tag ${collateral === s ? 'active' : ''}`}
            onClick={() => setCollateral(s)}
          >
            ${s}
          </button>
        ))}
      </div>
      <div className="tag-scroll" style={{ marginTop: 6 }}>
        {LEVERAGES.map((x) => (
          <button
            key={x}
            className={`tag ${leverage === x ? 'active' : ''}`}
            onClick={() => setLeverage(x)}
          >
            {x}×
          </button>
        ))}
      </div>

      {cost && cheapest ? (
        <div style={{ marginTop: 12 }}>
          <div className="row-between">
            <span className="faint">{t('perp.costNotional')}</span>
            <span className="mono" style={{ fontSize: 12.5 }}>{fmtUsd(cost.notional)}</span>
          </div>
          <div className="row-between" style={{ marginTop: 5 }}>
            <span className="faint">{t('perp.costMonth', { venue: cheapest.venue })}</span>
            {/*
              Negative cost means funding is paid TO the position. Real, common,
              and not clamped: a screen that only ever shows an outflow would be
              describing a market that does not exist.
            */}
            <span
              className="mono"
              style={{ fontSize: 12.5, color: cost.cost > 0 ? 'var(--down)' : 'var(--up)' }}
            >
              {cost.cost > 0 ? '−' : '+'}{fmtUsd(Math.abs(cost.cost))}
            </span>
          </div>
          <p className="faint" style={{ fontSize: 11.4, marginTop: 8, lineHeight: 1.7 }}>
            {t('perp.costExplain', {
              pct: Math.abs(cost.pctOfCollateral).toFixed(1),
              lev: leverage
            })}
          </p>
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 11.5, marginTop: 10 }}>{t('perp.costNoRate')}</p>
      )}

      <p className="notice" style={{ marginTop: 12 }}>{t('perp.fundingNotice')}</p>
      <p className="faint" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.7 }}>
        {t('perp.fundingCount', { used: data.used, considered: data.considered })}
      </p>
    </motion.section>
  );
}
