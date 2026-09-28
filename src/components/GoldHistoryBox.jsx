import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Sparkline from './Sparkline';
import TokenIcon from '../lib/tokenIcon';
import { fmtCompact, fmtPct, fmtPrice } from '../lib/format';
import { equitySeriesFacts } from '../lib/equityAnalysis';
import { fetchEquityChart, isUsableSeries } from '../lib/equityChart';
import { usePoll } from '../hooks/useMarket';
import { IconChevronRight } from './Icons';
import '../styles/equity-analysis.css';

/**
 * GOLD — WHAT THE PAST SAYS, IN A GOLD BOX THAT CLOSES.
 * ---------------------------------------------------------------------------
 * «در طلا هم گذشته چه میگوید باید در باکس طلا و باکس جمع شونده و مدرن باشد» —
 * gold needed the same history the equities got, in a box that is visibly about
 * gold, that collapses, and that does not look like a 2019 settings page.
 *
 * ─── WHY GOLD GETS ITS OWN BOX AND THE EQUITIES DO NOT ─────────────────────
 * The equity rows each carry their own panel, because a list of twenty-two
 * companies has twenty-two separate histories and one shared panel would be
 * meaningless. Gold is one market expressed through three tokens: two vault
 * claims (PAXG, XAUt0) and one ETF (GLDx). What someone buying gold wants to
 * know — is this a normal price or a spike — is a question about the METAL, so
 * the three series sit together under one heading.
 *
 * ─── WHY IT IS OPEN BY DEFAULT AND THE WARNINGS ARE NOT ────────────────────
 * The freeze warning starts closed because it describes something that can
 * happen to money you are about to commit, and the tab was carrying two
 * permanently-open danger boxes. This is the opposite: it is the answer to a
 * question the reader came here with, and folding it away by default would be
 * hiding the thing that was asked for. It still closes, because three
 * fact-lists under every row is a lot of screen and the reader decides when
 * they are done with it.
 *
 * ─── WHY IT FETCHES THREE SERIES AND NOT ONE ───────────────────────────────
 * Each token is priced by a different issuer, and a claim on an ounce in a
 * Brink's vault is not the same instrument as a share of an ETF. Measuring all
 * three and showing all three is the honest version; averaging them into one
 * number would hide the spread between them, which is exactly the kind of
 * smoothing that makes a screen look informed while telling you less.
 */

const DAYS = 90;

/** One token's 90-day facts, fetched only while the box is open. */
function GoldFacts({ asset }) {
  const { t } = useTranslation();
  const { data: chart } = usePoll(
    () => (asset?.coingeckoId ? fetchEquityChart(asset.coingeckoId, DAYS) : Promise.resolve([])),
    [asset?.coingeckoId],
    120_000
  );

  const series = useMemo(() => (chart ?? []).map((d) => d.p), [chart]);
  const facts = useMemo(
    () => (isUsableSeries(series) ? equitySeriesFacts(series, { days: DAYS }) : []),
    [series]
  );

  const up = (asset?.change24h ?? 0) >= 0;

  if (!facts.length) {
    return (
      <div className="gold-token">
        <div className="gold-token-head">
          <TokenIcon token={asset} size={26} />
          <div className="gold-token-id">
            <div className="gold-token-sym">{asset?.symbol}</div>
            <div className="faint gold-token-name">{asset?.name}</div>
          </div>
          <div className="gold-token-px">
            <div className="mono">{asset?.usdPrice ? `$${fmtPrice(asset.usdPrice)}` : '—'}</div>
            <div className={`mono ${up ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
              {fmtPct(asset?.change24h ?? 0, 1)}
            </div>
          </div>
        </div>
        <p className="gold-token-nohist">{t('stocks.goldHistory.noHistoryOne')}</p>
      </div>
    );
  }

  const formatFact = (id, values) => {
    const v = { ...values };
    for (const key of ['price', 'low', 'high']) {
      if (v[key] != null) v[key] = fmtPrice(v[key]);
    }
    return t(`history.equity.${id}`, v);
  };

  return (
    <div className="gold-token">
      <div className="gold-token-head">
        <TokenIcon token={asset} size={26} />
        <div className="gold-token-id">
          <div className="gold-token-sym">{asset?.symbol}</div>
          <div className="faint gold-token-name">{asset?.name}</div>
        </div>
        <div className="gold-token-px">
          <div className="mono">{asset?.usdPrice ? `$${fmtPrice(asset.usdPrice)}` : '—'}</div>
          <div className={`mono ${up ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
            {fmtPct(asset?.change24h ?? 0, 1)}
          </div>
        </div>
      </div>
      <ul className="hist-list gold-token-facts">
        {facts.map((f) => (
          <li key={f.id} className={`hist-item hist-${f.kind}`}>
            <span className="hist-dot" aria-hidden="true" />
            <span>{formatFact(f.id, f.values)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function GoldHistoryBox({ assets = [], amountUsd = 1000 }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);

  /* The deepest book is the one whose series the header summarises — it is the
     most tradeable, so its price is the one a reader is most likely to get. */
  const primary = useMemo(
    () =>
      [...assets].sort(
        (a, b) => (Number(b?.liquidity) || 0) - (Number(a?.liquidity) || 0)
      )[0] ?? null,
    [assets]
  );

  const { data: primaryChart } = usePoll(
    () =>
      open && primary?.coingeckoId
        ? fetchEquityChart(primary.coingeckoId, DAYS)
        : Promise.resolve([]),
    [primary?.coingeckoId, open],
    120_000
  );

  const primarySeries = useMemo(() => (primaryChart ?? []).map((d) => d.p), [primaryChart]);
  const primaryUp = (primarySeries.at(-1) ?? 0) >= (primarySeries[0] ?? 0);

  if (!assets.length) return null;

  const avgChange =
    assets.filter((a) => Number.isFinite(Number(a?.change24h))).length > 0
      ? assets.reduce((s, a) => s + (Number(a.change24h) || 0), 0) /
        assets.filter((a) => Number.isFinite(Number(a?.change24h))).length
      : null;

  const totalDepth = assets.reduce((s, a) => s + (Number(a?.liquidity) || 0), 0);

  return (
    <motion.section
      className={`gold-box ${open ? 'is-open' : ''}`}
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
      initial="hidden"
      animate="show"
    >
      <button
        type="button"
        className="gold-box-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="gold-box-orb" aria-hidden="true">
          <TokenIcon token={primary} size={30} />
        </span>
        <span className="gold-box-title">
          <span className="gold-box-h">{t('stocks.goldHistory.historyTitle')}</span>
          <span className="faint gold-box-sub">
            {t('stocks.goldHistory.historySub', { days: DAYS, count: assets.length })}
          </span>
        </span>
        <span className="gold-box-px">
          <span className="mono">
            {primary?.usdPrice ? `$${fmtPrice(primary.usdPrice)}` : '—'}
          </span>
          {avgChange != null && (
            <span className={`mono ${avgChange >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
              {fmtPct(avgChange, 1)}
            </span>
          )}
        </span>
        <span className="gold-box-spark" aria-hidden="true">
          {primarySeries.length > 2 && (
            <Sparkline data={primarySeries} up={primaryUp} width={54} height={24} />
          )}
        </span>
        <span className={`gold-box-chevron ${open ? 'is-open' : ''}`} aria-hidden="true">
          <IconChevronRight width={16} height={16} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="gold-box-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="gold-box-body-inner">
              <div className="gold-box-meta">
                <span className="pill pill-neutral">{t('stocks.depth')} {fmtCompact(totalDepth)}</span>
                <span className="pill pill-neutral">
                  {t('stocks.eq.youGet', { amount: amountUsd })}
                </span>
              </div>

              {assets.map((a) => (
                <GoldFacts key={a.id ?? a.mint} asset={a} />
              ))}

              <p className="notice gold-box-advice">{t('history.notAdvice')}</p>
              <p className="faint gold-box-note">{t('stocks.goldHistory.historyNote')}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
