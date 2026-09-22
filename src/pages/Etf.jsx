/**
 * ETF + Gold Spot — read-only market panel.
 * ---------------------------------------------------------------------------
 * Categories: Bitcoin spot ETFs, Ethereum spot ETFs, Gold ETFs, Gold spot.
 * No buy/sell/order actions. Funds and Prediction are not on this page.
 *
 * Polling: one list request on an interval that pauses while the tab is
 * hidden (usePoll). Never one poll per symbol.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import { motion } from 'framer-motion';
import { usePoll } from '../hooks/useMarket';
import { fetchEtfList, fetchGoldSpot, fetchEtfGoldStatus } from '../lib/etfGold';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';

const TABS = [
  { id: 'bitcoin', labelKey: 'etf.tabBitcoin', fallback: 'Bitcoin ETFs' },
  { id: 'ethereum', labelKey: 'etf.tabEthereum', fallback: 'Ethereum ETFs' },
  { id: 'gold', labelKey: 'etf.tabGoldEtf', fallback: 'Gold ETFs' },
  { id: 'spot', labelKey: 'etf.tabGoldSpot', fallback: 'Gold Spot' }
];

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3600_000)}h`;
}

function MetaBadges({ meta, stale, isRTL }) {
  if (!meta && !stale) return null;
  const age = formatAge(meta?.cacheAgeMs);
  const delayed = meta?.delayed !== false;
  return (
    <div className="etf-meta-badges" dir={isRTL ? 'rtl' : 'ltr'}>
      {stale || meta?.stale ? (
        <span className="etf-badge etf-badge-stale">
          {isRTL ? 'آخرین داده معتبر' : 'Last valid data'}
        </span>
      ) : null}
      {delayed ? (
        <span className="etf-badge etf-badge-delayed">
          {isRTL ? 'تأخیری' : 'Delayed'}
        </span>
      ) : (
        <span className="etf-badge">{isRTL ? 'لحظه‌ای' : 'Realtime'}</span>
      )}
      {age ? (
        <span className="etf-badge etf-badge-age">
          {isRTL ? `سن کش ${age}` : `cache age ${age}`}
        </span>
      ) : null}
      {meta?.fetchedAt ? (
        <span className="etf-badge etf-badge-time">
          {new Date(meta.fetchedAt).toLocaleString(isRTL ? 'fa-IR' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: 'short'
          })}
        </span>
      ) : null}
    </div>
  );
}

function EtfRow({ row, isRTL }) {
  const change = Number(row.changePct);
  const up = Number.isFinite(change) && change >= 0;
  const down = Number.isFinite(change) && change < 0;
  return (
    <div className="etf-row">
      <div className="etf-row-main">
        <div className="etf-row-sym">{row.symbol}</div>
        <div className="etf-row-name">{row.name || row.symbol}</div>
      </div>
      <div className="etf-row-px">
        <div className="etf-row-price">
          {row.priceUsd != null ? fmtPrice(row.priceUsd) : '—'}
        </div>
        <div className={`etf-row-chg ${up ? 'up' : down ? 'down' : ''}`}>
          {Number.isFinite(change) ? fmtPct(change) : '—'}
        </div>
      </div>
      <div className="etf-row-day">
        {row.latestTradingDay || (isRTL ? '—' : '—')}
      </div>
    </div>
  );
}

export default function Etf() {
  const { t, i18n } = useTranslation();
  const isRTL = (i18n.language || '').startsWith('fa') || (i18n.language || '').startsWith('ar');
  const [tab, setTab] = useState('bitcoin');

  /* One list poll for all ETFs — 15 min, paused when hidden. */
  const list = usePoll(() => fetchEtfList({}), [], 15 * 60_000);
  const gold = usePoll(() => fetchGoldSpot(), [], 12 * 60_000);
  const status = usePoll(() => fetchEtfGoldStatus(), [], 60_000);

  const configured = status.data?.configured !== false
    && status.data?.status !== 'UNAVAILABLE'
    && !(list.data?.error === 'PROVIDER_NOT_CONFIGURED' || gold.data?.error === 'PROVIDER_NOT_CONFIGURED');

  const providerMissing =
    list.data?.error === 'PROVIDER_NOT_CONFIGURED'
    || gold.data?.error === 'PROVIDER_NOT_CONFIGURED'
    || status.data?.status === 'UNAVAILABLE'
    || status.data?.configured === false;

  const rowsForTab = useMemo(() => {
    const by = list.data?.byCategory || {};
    if (tab === 'bitcoin') return by.bitcoin || [];
    if (tab === 'ethereum') return by.ethereum || [];
    if (tab === 'gold') return by.gold || [];
    return [];
  }, [list.data, tab]);

  const loading = (tab === 'spot' ? gold.loading : list.loading) && !(tab === 'spot' ? gold.data : list.data);
  const stale = tab === 'spot' ? (gold.data?.stale || gold.data?.meta?.stale) : (list.data?.stale || list.data?.meta?.stale);
  const meta = tab === 'spot' ? gold.data?.meta : list.data?.meta;
  const error = tab === 'spot' ? (gold.error || gold.data?.error) : (list.error || list.data?.error);

  return (
    <PageTransition className="page etf-page">
      <motion.div className="etf-head" variants={stagger} initial="hidden" animate="show">
        <motion.div variants={riseIn}>
          <h1 className="h1">{t('etf.title', { defaultValue: isRTL ? 'صندوق‌های ETF و طلا' : 'ETFs & Gold' })}</h1>
          <p className="muted etf-sub">
            {t('etf.subtitle', {
              defaultValue: isRTL
                ? 'قیمت‌های واقعی صندوق‌های بیت‌کوین، اتریوم و طلا — فقط خواندنی، بدون خرید و فروش.'
                : 'Live read-only quotes for Bitcoin, Ethereum and Gold ETFs. No trading on this screen.'
            })}
          </p>
        </motion.div>

        <motion.div className="etf-tabs" variants={riseIn} role="tablist">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              type="button"
              role="tab"
              aria-selected={tab === tb.id}
              className={`etf-tab ${tab === tb.id ? 'active' : ''}`}
              onClick={() => setTab(tb.id)}
            >
              {t(tb.labelKey, { defaultValue: tb.fallback })}
            </button>
          ))}
        </motion.div>

        <MetaBadges meta={meta} stale={stale} isRTL={isRTL} />
      </motion.div>

      {providerMissing && !loading ? (
        <div className="etf-empty etf-unavail" role="status">
          <strong>{t('etf.unconfigured', { defaultValue: isRTL ? 'منبع داده ETF تنظیم نشده' : 'ETF data source is not configured' })}</strong>
          <p className="muted">
            {t('etf.unconfiguredBody', {
              defaultValue: isRTL
                ? 'کلید ALPHA_VANTAGE_API_KEY روی سرور تنظیم نشده است. هیچ قیمت ساختگی نمایش داده نمی‌شود.'
                : 'ALPHA_VANTAGE_API_KEY is not set on the server. No synthetic prices are shown.'
            })}
          </p>
        </div>
      ) : null}

      {!providerMissing && loading ? (
        <div className="etf-empty" role="status">
          {t('etf.loading', { defaultValue: isRTL ? 'در حال بارگذاری…' : 'Loading…' })}
        </div>
      ) : null}

      {!providerMissing && !loading && tab !== 'spot' && error && !rowsForTab.length ? (
        <div className="etf-empty etf-fail" role="alert">
          <strong>{t('etf.failed', { defaultValue: isRTL ? 'داده ETF در دسترس نیست' : 'ETF data unavailable' })}</strong>
          <p className="muted">{String(error?.message || error || '').slice(0, 160)}</p>
        </div>
      ) : null}

      {!providerMissing && !loading && tab !== 'spot' && !error && !rowsForTab.length ? (
        <div className="etf-empty" role="status">
          {t('etf.noRows', {
            defaultValue: isRTL
              ? 'هیچ ردیفی از منبع داده نرسید. نمودار یا صفر جعلی نمایش داده نمی‌شود.'
              : 'No rows arrived from the data source. No fake chart or zero is shown.'
          })}
        </div>
      ) : null}

      {!providerMissing && tab !== 'spot' && rowsForTab.length > 0 ? (
        <div className="etf-list">
          <div className="etf-list-head">
            <span>{isRTL ? 'نماد / نام' : 'Symbol / name'}</span>
            <span>{isRTL ? 'قیمت / تغییر' : 'Price / change'}</span>
            <span>{isRTL ? 'آخرین روز' : 'Last day'}</span>
          </div>
          {rowsForTab.map((row) => (
            <EtfRow key={row.symbol} row={row} isRTL={isRTL} />
          ))}
          {stale ? (
            <p className="etf-stale-note muted">
              {t('etf.staleNote', {
                defaultValue: isRTL
                  ? 'منبع موقتاً در دسترس نیست — آخرین داده معتبر با برچسب کهنه نمایش داده شده است.'
                  : 'Upstream is temporarily unavailable — showing last valid data labelled stale.'
              })}
            </p>
          ) : null}
        </div>
      ) : null}

      {!providerMissing && tab === 'spot' ? (
        <div className="etf-spot">
          {gold.loading && !gold.data ? (
            <div className="etf-empty">{t('etf.loading', { defaultValue: isRTL ? 'در حال بارگذاری…' : 'Loading…' })}</div>
          ) : null}
          {gold.data?.ok && gold.data.spot ? (
            <div className="etf-spot-card">
              <div className="etf-spot-label">XAU / USD</div>
              <div className="etf-spot-price">
                {fmtUsd(gold.data.spot.priceUsd)}
              </div>
              <div className="etf-spot-unit">
                {t('etf.goldUnit', {
                  defaultValue: isRTL ? 'دلار آمریکا به ازای هر اونس تروا' : 'USD per troy ounce'
                })}
              </div>
              {Number.isFinite(Number(gold.data.spot.changePct)) ? (
                <div className={`etf-row-chg ${Number(gold.data.spot.changePct) >= 0 ? 'up' : 'down'}`}>
                  {fmtPct(gold.data.spot.changePct)}
                </div>
              ) : null}
              <MetaBadges meta={gold.data.meta} stale={gold.data.stale} isRTL={isRTL} />
            </div>
          ) : !gold.loading ? (
            <div className="etf-empty etf-fail" role="alert">
              <strong>{t('etf.goldFailed', { defaultValue: isRTL ? 'قیمت لحظه‌ای طلا در دسترس نیست' : 'Gold spot unavailable' })}</strong>
              <p className="muted">{String(gold.data?.error || gold.error?.message || '').slice(0, 160)}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="etf-disclaimer muted">
        {t('etf.disclaimer', {
          defaultValue: isRTL
            ? 'این صفحه فقط خواندنی است. خرید، فروش یا ثبت سفارش ETF/طلا از داخل FBT انجام نمی‌شود. صندوق‌های سرمایه‌گذاری (Funds) و بازار پیش‌بینی در این فاز در دسترس نیستند.'
            : 'Read-only. FBT does not place ETF or gold orders. Funds and Prediction markets stay unavailable in this phase.'
        })}
      </p>

      <style>{`
        .etf-page { padding-bottom: 2rem; }
        .etf-sub { margin-top: 0.35rem; max-width: 36rem; }
        .etf-tabs { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 1rem 0 0.6rem; }
        .etf-tab {
          border: 1px solid color-mix(in oklab, var(--border, #333) 80%, transparent);
          background: color-mix(in oklab, var(--card, #111) 90%, transparent);
          color: inherit; border-radius: 999px; padding: 0.35rem 0.85rem;
          font-size: 0.85rem; cursor: pointer;
        }
        .etf-tab.active { background: color-mix(in oklab, var(--accent, #6cf) 25%, transparent); border-color: var(--accent, #6cf); }
        .etf-meta-badges { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.4rem 0 0.8rem; }
        .etf-badge {
          font-size: 0.72rem; padding: 0.15rem 0.5rem; border-radius: 999px;
          background: color-mix(in oklab, var(--card, #222) 100%, transparent);
          border: 1px solid color-mix(in oklab, var(--border, #444) 70%, transparent);
        }
        .etf-badge-stale { border-color: #c90; color: #fc6; }
        .etf-badge-delayed { opacity: 0.85; }
        .etf-list { display: flex; flex-direction: column; gap: 0.35rem; }
        .etf-list-head, .etf-row {
          display: grid; grid-template-columns: 1.4fr 1fr 0.7fr; gap: 0.5rem;
          align-items: center; padding: 0.65rem 0.75rem;
        }
        .etf-list-head { font-size: 0.72rem; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.04em; }
        .etf-row {
          border-radius: 12px;
          background: color-mix(in oklab, var(--card, #151515) 100%, transparent);
          border: 1px solid color-mix(in oklab, var(--border, #2a2a2a) 80%, transparent);
        }
        .etf-row-sym { font-weight: 700; letter-spacing: 0.02em; }
        .etf-row-name { font-size: 0.78rem; opacity: 0.7; }
        .etf-row-price { font-variant-numeric: tabular-nums; font-weight: 600; }
        .etf-row-chg { font-size: 0.85rem; font-variant-numeric: tabular-nums; }
        .etf-row-chg.up { color: #3dce7a; }
        .etf-row-chg.down { color: #f07178; }
        .etf-row-day { font-size: 0.78rem; opacity: 0.65; }
        .etf-empty {
          padding: 1.25rem; border-radius: 14px; margin: 0.75rem 0;
          background: color-mix(in oklab, var(--card, #151515) 100%, transparent);
          border: 1px dashed color-mix(in oklab, var(--border, #333) 90%, transparent);
        }
        .etf-unavail { border-style: solid; border-color: color-mix(in oklab, #c90 50%, transparent); }
        .etf-fail { border-style: solid; border-color: color-mix(in oklab, #f07178 40%, transparent); }
        .etf-spot-card {
          padding: 1.25rem; border-radius: 16px; margin-top: 0.5rem;
          background: linear-gradient(145deg, color-mix(in oklab, #d4af37 18%, transparent), color-mix(in oklab, var(--card, #151515) 100%, transparent));
          border: 1px solid color-mix(in oklab, #d4af37 35%, transparent);
        }
        .etf-spot-label { font-size: 0.85rem; opacity: 0.8; letter-spacing: 0.06em; }
        .etf-spot-price { font-size: 1.8rem; font-weight: 700; font-variant-numeric: tabular-nums; margin: 0.25rem 0; }
        .etf-spot-unit { font-size: 0.85rem; opacity: 0.75; margin-bottom: 0.5rem; }
        .etf-disclaimer { margin-top: 1.25rem; font-size: 0.78rem; max-width: 40rem; line-height: 1.45; }
        .etf-stale-note { margin-top: 0.6rem; font-size: 0.8rem; }
        @media (max-width: 520px) {
          .etf-list-head, .etf-row { grid-template-columns: 1.2fr 1fr; }
          .etf-row-day, .etf-list-head span:last-child { display: none; }
        }
      `}</style>
    </PageTransition>
  );
}
