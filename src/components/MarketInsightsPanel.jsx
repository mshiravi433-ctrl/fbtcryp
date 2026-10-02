import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fmtPct, fmtCompact, timeAgo } from '../lib/format';
import { getSolanaAssets } from '../lib/solanaAssetsClient';
import { getCapitalFlows } from '../lib/capitalFlows';
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

/** A signed money amount in the display currency, or an em dash. */
function signedMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  const text = fmtCompact(Math.abs(n));
  if (text === '—') return null;
  return `${n < 0 ? '−' : '+'}${text}`;
}

/**
 * VALUE CARD — the shape the flow and profit cards need.
 *
 * `MetricCard` renders an ASSET (logo, name, a 24h percentage). The three
 * cards that used to be permanently empty are not assets: they are a measured
 * amount of money with a named source behind it — «$25.1B attracted by this
 * token», «$412M left this chain», «$34.6B of reported net income». So the
 * same card chrome carries a big signed number, the subject underneath it, and
 * the source line every number in this app is required to have.
 *
 * `href` opens the primary document (the SEC filing) externally; a reported
 * accounting number without its filing is an assertion, not evidence.
 */
function ValueCard({
  title, value, name, meta, source, note, tone = 'up', icon: Icon = IconTrend,
  href, linkLabel, emptyText, loading = false
}) {
  const hasValue = typeof value === 'string' && value.length > 0 && value !== '—';
  const dir = value?.startsWith?.('−') ? 'down' : value?.startsWith?.('+') ? 'up' : null;
  return (
    <article className="insight-metric" data-tone={tone}>
      <div className="insight-card-top">
        <span className="insight-mark" aria-hidden="true"><Icon width={20} height={20} /></span>
        <span className="insight-card-kicker">{title}</span>
      </div>
      {loading ? (
        <div className="skel insight-value-skel" />
      ) : hasValue ? (
        <>
          <div className="insight-asset-row">
            <div className="insight-asset-copy">
              <strong>{name}</strong>
              {meta ? <span>{meta}</span> : null}
            </div>
            <span className={`insight-change insight-value ${dir || ''}`}>{value}</span>
          </div>
          <div className="insight-source">{source}</div>
          {href ? (
            <a className="insight-link" href={href} target="_blank" rel="noopener noreferrer">
              <IconExternal width={12} height={12} /> {linkLabel}
            </a>
          ) : null}
          {note ? <p className="insight-note">{note}</p> : null}
        </>
      ) : (
        <div className="insight-card-empty" data-text="true">{emptyText}</div>
      )}
    </article>
  );
}

/** One ranked flow row: who, how much, and in which direction. */
function FlowRow({ amount, pct, name, meta, dir, image }) {
  return (
    <li className="insight-flow-row">
      <AssetMark item={{ image }} fallback={IconTrend} />
      <span className="insight-flow-copy">
        <strong>{name}</strong>
        {meta ? <small>{meta}</small> : null}
      </span>
      <span className={`insight-flow-amount ${dir}`}>
        {amount}
        {pct ? <small>{pct}</small> : null}
      </span>
    </li>
  );
}

/**
 * Market intelligence assembled only from feeds already verified by the app.
 * Key indicators (Volume, Market Cap, Volatility) are computed from live market
 * data and kept strictly factual.
 *
 * ─── WHAT CHANGED HERE, AND WHY IT IS STILL HONEST ─────────────────────────
 * Three cards («ورود سرمایه … به کشور», «سودده‌ترین شرکت», «بیشترین و کمترین
 * خروج ۲۴ ساعته») were hard-wired to `item={null}` because no connected source
 * could prove them. They now carry REAL numbers from three free public sources
 * — CoinGecko's 24h market-cap change, DefiLlama's stablecoin supply deltas and
 * the SEC's reported net income — and each of them says which one. What did NOT
 * change is the rule: when a source is dark the card shows its old «no verified
 * source» line, and a price move is still never presented as a flow or a profit.
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
  const [flows, setFlows] = useState(null);
  const [flowState, setFlowState] = useState('loading');
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

  /*
   * The flow/profit read. One request per mount (and per retry), cached in
   * lib/capitalFlows.js, single-flighted with the Global tab's copy.
   */
  useEffect(() => {
    let cancelled = false;
    setFlowState('loading');
    getCapitalFlows({ force: reloadKey > 0 })
      .then((data) => {
        if (cancelled) return;
        setFlows(data);
        setFlowState(data?.ok ? 'ready' : 'unavailable');
      })
      .catch(() => {
        if (cancelled) return;
        setFlows(null);
        setFlowState('unavailable');
      });

    return () => { cancelled = true; };
  }, [reloadKey]);

  const insights = useMemo(
    () => deriveMarketInsights({ markets, equities, news: newsItems, flows }),
    [markets, equities, newsItems, flows]
  );
  // Only timestamp rows that are actually eligible for display. `usePoll`
  // also timestamps deterministic offline fallbacks; treating that as a live
  // refresh would undermine the explicit unavailable state on the cards.
  const freshestAt = Math.max(
    insights.cryptoLeader || insights.cryptoLaggard || insights.volumeLeader ? Number(marketsUpdatedAt) || 0 : 0,
    insights.tokenizedLeader || insights.companyLeader ? equityAt : 0,
    insights.eventStories.length ? Number(newsUpdatedAt) || 0 : 0,
    insights.capitalInflow || insights.chainInflow || insights.profitLeader ? Number(insights.flowsAt) || 0 : 0
  );
  const stillLoading = marketsLoading || equityState === 'loading' || flowState === 'loading';

  const inflowList = Array.isArray(flows?.tokenFlows?.inflows) ? flows.tokenFlows.inflows : [];
  const outflowList = Array.isArray(flows?.tokenFlows?.outflows) ? flows.tokenFlows.outflows : [];
  const profitList = Array.isArray(insights.profitLeaders) ? insights.profitLeaders : [];
  const sourceName = (source) => String(source || '').split(':')[0];

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
          </>
        )}

        {/*
          ─── THE FLOW + PROFIT CARDS: REAL SOURCES, NAMED ───────────────────
          Each card below is a measured amount from a free public source, and
          each one prints that source. When a source is dark the card falls
          back to the explicit gap it showed before — the numbers are new, the
          refusal to invent them is not.
        */}
        <ValueCard
          title={t('insights.capitalInflow')}
          tone="up"
          icon={IconTrend}
          loading={flowState === 'loading' && !insights.capitalInflow}
          value={signedMoney(insights.capitalInflow?.mcapChangeUsd)}
          name={insights.capitalInflow?.name || insights.capitalInflow?.symbol || ''}
          meta={insights.capitalInflow
            ? [
              insights.capitalInflow.symbol,
              insights.capitalInflow.mcapChangePct != null ? fmtPct(Number(insights.capitalInflow.mcapChangePct)) : null,
              insights.capitalInflow.change24hPct != null ? `${t('insights.price24h')} ${fmtPct(Number(insights.capitalInflow.change24hPct))}` : null
            ].filter(Boolean).join(' · ')
            : null}
          source={insights.capitalInflow
            ? t('insights.capitalInflowSource', { source: sourceName(insights.capitalInflow.source) })
            : t('insights.flowSourcePending')}
          note={t('insights.capitalInflowNote')}
          emptyText={t('insights.capitalInflowUnavailable')}
        />
        <ValueCard
          title={t('insights.countryFlow')}
          tone="violet"
          icon={IconGlobe}
          loading={flowState === 'loading' && !insights.stablecoinNet}
          value={signedMoney(insights.stablecoinNet?.net24hUsd)}
          name={t('insights.stablecoinSupply')}
          meta={insights.stablecoinNet
            ? [
              `${t('insights.totalCirculating')}: ${fmtCompact(insights.stablecoinNet.totalCirculatingUsd)}`,
              insights.stablecoinNet.net7dUsd != null ? `${t('insights.sevenDay')}: ${signedMoney(insights.stablecoinNet.net7dUsd)}` : null
            ].filter(Boolean).join(' · ')
            : null}
          source={insights.stablecoinNet
            ? t('insights.stablecoinSource', { source: sourceName(insights.stablecoinNet.source) })
            : t('insights.flowSourcePending')}
          note={t('insights.stablecoinNote')}
          emptyText={t('insights.countryUnavailable')}
        />
        <ValueCard
          title={t('insights.chainInflow')}
          tone="up"
          icon={IconGlobe}
          loading={flowState === 'loading' && !insights.chainInflow}
          value={signedMoney(insights.chainInflow?.net24hUsd)}
          name={insights.chainInflow?.chain || ''}
          meta={insights.chainInflow
            ? `${t('insights.chainSupply')}: ${fmtCompact(insights.chainInflow.currentUsd)}${insights.chainInflow.net24hPct != null ? ` · ${fmtPct(Number(insights.chainInflow.net24hPct))}` : ''}`
            : null}
          source={insights.chainInflow
            ? t('insights.stablecoinSource', { source: sourceName(insights.chainInflow.source) })
            : t('insights.flowSourcePending')}
          emptyText={t('insights.countryUnavailable')}
        />
        <ValueCard
          title={t('insights.chainOutflow')}
          tone="down"
          icon={IconGlobe}
          loading={flowState === 'loading' && !insights.chainOutflow}
          value={signedMoney(insights.chainOutflow?.net24hUsd)}
          name={insights.chainOutflow?.chain || ''}
          meta={insights.chainOutflow
            ? `${t('insights.chainSupply')}: ${fmtCompact(insights.chainOutflow.currentUsd)}${insights.chainOutflow.net24hPct != null ? ` · ${fmtPct(Number(insights.chainOutflow.net24hPct))}` : ''}`
            : null}
          source={insights.chainOutflow
            ? t('insights.stablecoinSource', { source: sourceName(insights.chainOutflow.source) })
            : t('insights.flowSourcePending')}
          emptyText={t('insights.outflowUnavailable')}
        />
        <ValueCard
          title={t('insights.capitalOutflow')}
          tone="down"
          icon={IconTrend}
          loading={flowState === 'loading' && !insights.capitalOutflowToken}
          value={signedMoney(insights.capitalOutflowToken?.mcapChangeUsd)}
          name={insights.capitalOutflowToken?.name || insights.capitalOutflowToken?.symbol || ''}
          meta={insights.capitalOutflowToken
            ? [
              insights.capitalOutflowToken.symbol,
              insights.capitalOutflowToken.mcapChangePct != null ? fmtPct(Number(insights.capitalOutflowToken.mcapChangePct)) : null
            ].filter(Boolean).join(' · ')
            : null}
          source={insights.capitalOutflowToken
            ? t('insights.capitalInflowSource', { source: sourceName(insights.capitalOutflowToken.source) })
            : t('insights.flowSourcePending')}
          emptyText={t('insights.outflowUnavailable')}
        />
        <ValueCard
          title={t('insights.companyProfit')}
          tone="blue"
          icon={IconBuilding}
          loading={flowState === 'loading' && !insights.profitLeader}
          value={insights.profitLeader ? fmtCompact(insights.profitLeader.netIncomeUsd) : null}
          name={insights.profitLeader?.name || ''}
          meta={insights.profitLeader
            ? `${t('insights.reportedPeriod')}: ${insights.profitLeader.periodStart} → ${insights.profitLeader.periodEnd}`
            : null}
          source={insights.profitLeader
            ? t('insights.profitSource', { source: sourceName(insights.profitLeader.source), period: insights.profitPeriod || '' })
            : t('insights.flowSourcePending')}
          href={insights.profitLeader?.url || undefined}
          linkLabel={insights.profitLeader?.url ? t('insights.profitFiling') : null}
          note={t('insights.profitNote')}
          emptyText={t('insights.profitUnavailable')}
        />
      </div>

      {(equityState === 'unavailable' || flowState === 'unavailable') && (
        <button className="insights-retry" type="button" onClick={() => setReloadKey((n) => n + 1)}>
          {equityState === 'unavailable' ? t('insights.retryEquities') : t('insights.retryFlows')}
        </button>
      )}

      {/* ── THE RANKINGS BEHIND THE CARDS ─────────────────────────────────
          One card names a winner; a reader who asks «and the rest?» deserves
          the list the winner came from. Both lists are the server's own
          ranking — nothing is re-sorted or re-derived on the phone. */}
      {inflowList.length || outflowList.length ? (
        <>
          <div className="insights-section-heading">
            <IconTrend width={17} height={17} />
            <div>
              <strong>{t('insights.flowRankTitle')}</strong>
              <span>{t('insights.flowRankSub', { rows: flows?.tokenFlows?.count ?? 0 })}</span>
            </div>
          </div>
          <div className="insight-flow-grid">
            <ul className="insight-flow-list">
              <li className="insight-flow-head up">{t('insights.flowRankIn')}</li>
              {inflowList.length ? inflowList.map((row) => (
                <FlowRow
                  key={`in-${row.id}`}
                  image={row.image}
                  dir="up"
                  name={`${row.name} (${row.symbol})`}
                  meta={row.mcapUsd != null ? `${t('insights.mcapShort')}: ${fmtCompact(row.mcapUsd)}` : null}
                  amount={signedMoney(row.mcapChangeUsd)}
                  pct={row.mcapChangePct != null ? fmtPct(Number(row.mcapChangePct)) : null}
                />
              )) : <li className="insight-flow-empty">{t('insights.flowRankEmpty')}</li>}
            </ul>
            <ul className="insight-flow-list">
              <li className="insight-flow-head down">{t('insights.flowRankOut')}</li>
              {outflowList.length ? outflowList.map((row) => (
                <FlowRow
                  key={`out-${row.id}`}
                  image={row.image}
                  dir="down"
                  name={`${row.name} (${row.symbol})`}
                  meta={row.mcapUsd != null ? `${t('insights.mcapShort')}: ${fmtCompact(row.mcapUsd)}` : null}
                  amount={signedMoney(row.mcapChangeUsd)}
                  pct={row.mcapChangePct != null ? fmtPct(Number(row.mcapChangePct)) : null}
                />
              )) : <li className="insight-flow-empty">{t('insights.flowRankEmpty')}</li>}
            </ul>
          </div>
        </>
      ) : null}

      {profitList.length ? (
        <>
          <div className="insights-section-heading">
            <IconBuilding width={17} height={17} />
            <div>
              <strong>{t('insights.profitRankTitle')}</strong>
              <span>{t('insights.profitRankSub', { period: insights.profitPeriod || '', companies: profitList.length })}</span>
            </div>
          </div>
          <ul className="insight-flow-list">
            {profitList.map((row) => (
              <li className="insight-flow-row" key={`profit-${row.cik}`}>
                <span className="insight-mark" aria-hidden="true"><IconBuilding width={20} height={20} /></span>
                <span className="insight-flow-copy">
                  <strong>{row.name}</strong>
                  <small>
                    {row.periodStart} → {row.periodEnd}
                    {row.url ? (
                      <a className="insight-link inline" href={row.url} target="_blank" rel="noopener noreferrer">
                        <IconExternal width={11} height={11} /> {t('insights.profitFiling')}
                      </a>
                    ) : null}
                  </small>
                </span>
                <span className="insight-flow-amount up">{fmtCompact(row.netIncomeUsd)}</span>
              </li>
            ))}
          </ul>
          <p className="insight-note">
            <IconInfo width={12} height={12} /> {t('insights.profitQuarterNote')}
          </p>
        </>
      ) : null}

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

      {flows && !flows.ok ? (
        <p className="insight-note">
          <IconInfo width={12} height={12} /> {t('insights.flowSourceDown', { reason: String(flows.error || flows.tokenFlows?.reason || 'UNAVAILABLE') })}
        </p>
      ) : null}

      <p className="insights-disclaimer">{t('insights.disclaimer')}</p>
    </section>
  );
}
