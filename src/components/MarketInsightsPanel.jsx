import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtPct, fmtCompact, timeAgo } from '../lib/format';
import { getSolanaAssets } from '../lib/solanaAssetsClient';
import { deriveMarketInsights } from '../lib/marketInsights';
import { publishInsightEquities } from '../lib/insightSession';
import {
  IconBuilding,
  IconClock,
  IconExternal,
  IconGlobe,
  IconInfo,
  IconNews,
  IconTrend
} from './Icons';

function AssetMark({ item, fallback: Fallback = IconTrend }) {
  const src = item?.image || item?.icon;
  return (
    <span className="insight-mark" aria-hidden="true">
      <Fallback width={20} height={20} />
      {src && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(event) => { event.currentTarget.hidden = true; }}
        />
      )}
    </span>
  );
}

function MetricCard({ title, item, source, tone = 'up', note, fallback, emptyText = '—' }) {
  return (
    <article className="insight-metric" data-tone={tone}>
      <div className="insight-card-top">
        <AssetMark item={item} fallback={fallback} />
        <span className="insight-card-kicker">{title}</span>
      </div>
      {item ? (
        <>
          <div className="insight-asset-row">
            <div className="insight-asset-copy">
              <strong>{item.name}</strong>
              <span className="mono">{item.symbol}</span>
            </div>
            <span className={Number(item.change24h) >= 0 ? 'up insight-change' : 'down insight-change'}>
              {fmtPct(Number(item.change24h))}
            </span>
          </div>
          <div className="insight-source">{source}</div>
          {note && <p className="insight-note">{note}</p>}
        </>
      ) : (
        <div className="insight-card-empty" data-text={emptyText === '—' ? 'false' : 'true'}>{emptyText}</div>
      )}
    </article>
  );
}

/**
 * Market intelligence assembled only from feeds already verified by the app.
 * Key indicators (Volume, Market Cap, Volatility) are computed from live market
 * data and kept strictly factual.
 */
export default function MarketInsightsPanel({
  markets = [],
  newsItems = [],
  marketsLoading = false,
  marketsUpdatedAt = 0,
  newsUpdatedAt = 0
}) {
  const { t, i18n } = useTranslation();
  const [equities, setEquities] = useState([]);
  const [equityState, setEquityState] = useState('loading');
  const [equityAt, setEquityAt] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setEquityState('loading');

    // The request may resolve after a tab change on a slow phone. Check the
    // cancellation flag after the await boundary before every state/session
    // update so an unmounted panel cannot publish stale rows or trigger a
    // React update warning.
    getSolanaAssets()
      .then((data) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.equities) ? data.equities : [];
        setEquities(rows);
        setEquityAt(Number(data?.at) || Date.now());
        publishInsightEquities(rows);
        setEquityState(rows.length ? 'ready' : 'unavailable');
      })
      .catch(() => {
        if (cancelled) return;
        setEquities([]);
        publishInsightEquities([]);
        setEquityState('unavailable');
      });

    return () => { cancelled = true; };
  }, [reloadKey]);

  const insights = useMemo(
    () => deriveMarketInsights({ markets, equities, news: newsItems }),
    [markets, equities, newsItems]
  );
  // Only timestamp rows that are actually eligible for display. `usePoll`
  // also timestamps deterministic offline fallbacks; treating that as a live
  // refresh would undermine the explicit unavailable state on the cards.
  const freshestAt = Math.max(
    insights.cryptoLeader || insights.cryptoLaggard || insights.volumeLeader ? Number(marketsUpdatedAt) || 0 : 0,
    insights.tokenizedLeader || insights.companyLeader ? equityAt : 0,
    insights.eventStories.length ? Number(newsUpdatedAt) || 0 : 0
  );
  const stillLoading = marketsLoading || equityState === 'loading';

  return (
    <section className="insights-panel" aria-labelledby="market-intelligence-title">
      <div className="insights-hero">
        <div>
          <div className="insights-eyebrow"><IconTrend width={15} height={15} /> {t('insights.liveWindow')}</div>
          <h2 id="market-intelligence-title">{t('insights.title')}</h2>
          <p>{t('insights.subtitle')}</p>
        </div>
        <div className="insights-freshness" data-live={freshestAt ? 'true' : 'false'}>
          <span className="insights-live-dot" />
          {freshestAt
            ? t('insights.updated', { ago: timeAgo(freshestAt, i18n.language) })
            : t(stillLoading ? 'insights.loading' : 'insights.unavailable')}
        </div>
      </div>

      <div className="insights-grid">
        {marketsLoading && !insights.cryptoLeader ? (
          <><div className="skel insight-skeleton" /><div className="skel insight-skeleton" /></>
        ) : (
          <>
            <MetricCard
              title={t('insights.cryptoLeader')}
              item={insights.cryptoLeader}
              source={t('insights.cryptoSource')}
              tone="up"
              emptyText={t('insights.marketUnavailable')}
            />
            <MetricCard
              title={t('insights.cryptoLaggard')}
              item={insights.cryptoLaggard}
              source={t('insights.cryptoSource')}
              tone="down"
              emptyText={t('insights.marketUnavailable')}
            />
            {insights.volumeLeader && (
              <MetricCard
                title={t('insights.volumeLeader', 'بیشترین حجم معاملات ۲۴ ساعته')}
                item={insights.volumeLeader}
                source={t('insights.volumeSource', 'پوشش زنده بازار کریپتو · حجم معاملات ۲۴ ساعته')}
                tone="blue"
                emptyText={t('insights.marketUnavailable')}
              />
            )}
            {insights.marketCapLeader && (
              <MetricCard
                title={t('insights.marketCapLeader', 'برترین دارایی از نظر ارزش بازار')}
                item={insights.marketCapLeader}
                source={t('insights.marketCapSource', 'ارزش بازار زنده دارایی‌های برتر')}
                tone="violet"
                emptyText={t('insights.marketUnavailable')}
              />
            )}
          </>
        )}

        {equityState === 'loading' ? (
          <><div className="skel insight-skeleton" /><div className="skel insight-skeleton" /></>
        ) : (
          <>
            <MetricCard
              title={t('insights.tokenizedLeader')}
              item={insights.tokenizedLeader}
              source={equityState === 'ready' ? t('insights.tokenizedSource') : t('insights.equityUnavailable')}
              tone="violet"
              fallback={IconBuilding}
              emptyText={t('insights.equityUnavailable')}
            />
            <MetricCard
              title={t('insights.companyLeader')}
              item={insights.companyLeader}
              source={equityState === 'ready' ? t('insights.tokenizedSource') : t('insights.equityUnavailable')}
              tone="blue"
              fallback={IconBuilding}
              note={insights.companyLeader ? t('insights.performanceNotProfit') : null}
              emptyText={t('insights.equityUnavailable')}
            />
            {/* Flow and accounting metrics stay EXPLICIT source gaps: price,
                market cap and open interest prove neither country-level capital
                flow nor company profit, so the cards say so instead of
                pretending a proxy metric exists. */}
            <MetricCard
              title={t('insights.countryFlow')}
              item={null}
              source={insights.countryFlow?.reason ?? 'NO_VERIFIED_COUNTRY_FLOW_SOURCE'}
              tone="violet"
              fallback={IconGlobe}
              emptyText={t('insights.countryUnavailable')}
            />
            <MetricCard
              title={t('insights.companyProfit')}
              item={null}
              source={insights.companyProfit?.reason ?? 'NO_ACCOUNTING_PROFIT_SOURCE'}
              tone="blue"
              fallback={IconBuilding}
              emptyText={t('insights.profitUnavailable')}
            />
            <MetricCard
              title={t('insights.capitalOutflow')}
              item={null}
              source={insights.capitalOutflow?.reason ?? 'NO_VERIFIED_FLOW_SOURCE'}
              tone="up"
              fallback={IconTrend}
              emptyText={t('insights.outflowUnavailable')}
            />
          </>
        )}
      </div>

      {equityState === 'unavailable' && (
        <button className="insights-retry" type="button" onClick={() => setReloadKey((n) => n + 1)}>
          {t('insights.retryEquities')}
        </button>
      )}

      <div className="insights-section-heading insights-events-heading">
        <IconClock width={17} height={17} />
        <div><strong>{t('insights.eventsTitle')}</strong><span>{t('insights.eventsSub')}</span></div>
      </div>
      <div className="insight-events">
        {insights.eventStories.length ? insights.eventStories.map((event) => (
          <a
            key={event.id || event.url || event.title}
            className="insight-event"
            href={event.url || undefined}
            target={event.url ? '_blank' : undefined}
            rel={event.url ? 'noopener noreferrer' : undefined}
            aria-disabled={!event.url}
            onClick={(e) => { if (!event.url) e.preventDefault(); }}
          >
            <AssetMark item={event} fallback={IconNews} />
            <span className="insight-event-copy">
              <strong>{event.title}</strong>
              <small>{event.source || t('insights.publisherSource')} · {timeAgo(event.at, i18n.language)}</small>
            </span>
            {event.url && <IconExternal width={15} height={15} />}
          </a>
        )) : (
          <div className="insight-events-empty"><IconNews width={21} height={21} /> {t('insights.eventsEmpty')}</div>
        )}
      </div>

      <p className="insights-disclaimer">{t('insights.disclaimer')}</p>
    </section>
  );
}
