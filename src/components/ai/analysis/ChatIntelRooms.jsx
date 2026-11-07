/**
 * THE INTELLIGENCE ROOMS, INSIDE THE ANSWER
 * ---------------------------------------------------------------------------
 * «درخواست قبلی این بود که هوش مصنوعی و Intent OS درخواست‌هاش شبیه صفحات
 *  هوش بازار باشه … نه اینکه صفحه ایجاد کنی.»
 *
 * So the page is no longer a destination in the menu — it is the SHAPE of the
 * answer. Every room the analysis centre had is now mounted inside the chat
 * bubble, driven by the exact same hooks, engines and tab components:
 *
 *   «تحلیل بیت کوین»        → ChatTokenRoom      (candles, indicators, score)
 *   «امروز چه خبر»          → ChatMarketRoom     (overview, opportunities…)
 *   «ریسک پرتفوی»           → ChatPortfolioRoom  (allocation, risk, causes)
 *
 * The rules travel with them: a feed that did not answer is NAMED, `null` is an
 * em dash and never a zero, and every room states where its numbers came from.
 *
 * COST: a room is a real poll, so a room renders ONLY while it is open, and a
 * collapsed card in a long thread makes no request at all.
 */
import { useEffect, useState } from 'react';
import { useMarketRoom, usePortfolioRoom, useTokenRoom } from '../../../hooks/useIntelligenceRooms';
import { fmtTimeAgo, t as ct } from '../../../lib/intelligence/copy';
import OverviewTab from './OverviewTab';
import ScreenerTab from './ScreenerTab';
import TokenTab from './TokenTab';
import PortfolioTab from './PortfolioTab';
import OpportunitiesTab from './OpportunitiesTab';
import ReportTab from './ReportTab';
import AnalysisTabs from './AnalysisTabs';
import NeuromorphicRoomStrip from '../NeuromorphicRoomStrip';
import './chat-intel.css';

const MARKET_ROOMS = [
  { id: 'overview', key: 'tab.overview' },
  { id: 'opportunities', key: 'tab.opportunities' },
  { id: 'screener', key: 'tab.screener' },
  { id: 'report', key: 'tab.report' }
];

const PROV_KEY = { live: 'page.live', stale: 'page.stale', offline: 'page.offline', unknown: 'page.unknown' };

const slugOf = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '-');

function fa(locale) {
  return String(locale || 'fa').startsWith('fa');
}

/**
 * A room opens when it is the LATEST answer and closes when a newer one
 * arrives — otherwise a long thread would keep every room it ever opened
 * polling in the background. A room the user opened by hand stays open: the
 * prop did not change, so nothing fires.
 */
function useLatestGate(defaultOpen) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    if (!defaultOpen) setOpen(false);
  }, [defaultOpen]);
  return [open, setOpen];
}

/**
 * The frame every chat room shares: a toggle header that is always readable
 * (title, hint, provenance) and a body that only exists while open.
 */
function RoomFrame({ open, onToggle, mark, title, hint, chip, testId, footer, locale, children }) {
  return (
    <section className={`aix-room${open ? ' is-open' : ''}`} data-testid={testId}>
      <button
        type="button"
        className="aix-room-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="aix-room-mark" aria-hidden="true">{mark}</span>
        <span className="aix-room-copy">
          <strong>{title}</strong>
          {hint ? <small>{hint}</small> : null}
        </span>
        {chip ? <span className="aix-room-chip">{chip}</span> : null}
        <span className="aix-room-chevron" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open ? (
        <div className="aix-room-body aix-page aix-embed" dir={fa(locale) ? 'rtl' : 'ltr'}>
          {children}
          {footer ? <p className="aix-room-foot">{footer}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/* ── ROOM 1 — THE MARKET (overview · opportunities · screener · report) ──── */

function MarketRoomBody({ room, setRoom, locale, onOpenRoute }) {
  const {
    markets, pulse, scan, analysis, updatedAt, loading, error
  } = useMarketRoom();
  const sourceLabel = markets[0]?.marketProvider === 'coingecko' ? 'CoinGecko' : 'FBT market API';

  if (!pulse && loading) return <p className="aix-loading">{ct(locale, 'page.loading')}</p>;
  if (!pulse) {
    return (
      <p className="aix-loading" role="alert">
        {error ? ct(locale, 'page.error') : ct(locale, 'page.loading')}
      </p>
    );
  }

  const openToken = (id) => onOpenRoute?.(`/coin/${id}`);

  return (
    <>
      <div className={`aix-statusbar aix-status-${pulse.provenance || 'unknown'}`}>
        <span className="aix-status-dot" aria-hidden="true" />
        <span>{ct(locale, PROV_KEY[pulse.provenance || 'unknown'])}</span>
        <span className="aix-status-sep">·</span>
        <span>{ct(locale, 'page.updated', { time: fmtTimeAgo(updatedAt, locale) })}</span>
        <span className="aix-status-sep">·</span>
        <span>{ct(locale, 'page.rowsCounted', { counted: pulse.breadth.counted, total: pulse.breadth.total })}</span>
      </div>

      <NeuromorphicRoomStrip markets={markets} pulse={pulse} locale={locale} />

      <AnalysisTabs
        tabs={MARKET_ROOMS}
        active={room}
        onChange={setRoom}
        locale={locale}
        label={ct(locale, 'page.title')}
        className="aix-tabs-chat"
      />

      {room === 'opportunities' ? (
        <OpportunitiesTab scan={scan} locale={locale} onOpenToken={openToken} />
      ) : room === 'screener' ? (
        <ScreenerTab
          markets={markets}
          locale={locale}
          updatedAt={updatedAt}
          provenance={pulse.provenance}
          onOpenToken={openToken}
        />
      ) : room === 'report' ? (
        <ReportTab pulse={pulse} scan={scan} locale={locale} markets={markets} sourceLabel={sourceLabel} />
      ) : (
        <OverviewTab pulse={pulse} analysis={analysis} locale={locale} onOpenToken={openToken} />
      )}
    </>
  );
}

export function ChatMarketRoom({ card = null, locale = 'fa', onOpenRoute, defaultOpen = false }) {
  const [open, setOpen] = useLatestGate(defaultOpen);
  const [room, setRoom] = useState(card?.room || 'overview');
  const isFa = fa(locale);
  return (
    <RoomFrame
      open={open}
      onToggle={() => setOpen((v) => !v)}
      mark="◎"
      title={isFa ? 'هوش بازار' : 'Market intelligence'}
      hint={isFa ? 'نمای بازار، فرصت‌ها، اسکرینر و گزارش روزانه' : 'Overview, opportunities, screener and the daily report'}
      chip={MARKET_ROOMS.find((x) => x.id === room) ? ct(locale, MARKET_ROOMS.find((x) => x.id === room).key) : null}
      testId="intent-ai-market-room"
      locale={locale}
      footer={ct(locale, 'page.notAdvice')}
    >
      <MarketRoomBody room={room} setRoom={setRoom} locale={locale} onOpenRoute={onOpenRoute} />
    </RoomFrame>
  );
}

/* ── ROOM 2 — ONE TOKEN (candles, indicators, weighted score) ────────────── */

function TokenRoomBody({ tokenId, setTokenId, locale, onOpenRoute }) {
  const [days, setDays] = useState(90);
  const market = useMarketRoom();
  const {
    pack, coin, score, loading
  } = useTokenRoom({ tokenId, days, markets: market.markets });

  return (
    <>
      <NeuromorphicRoomStrip
        candles={pack?.series?.candles || null}
        symbol={coin?.symbol || tokenId}
        locale={locale}
      />
      <TokenTab
        markets={market.markets}
        locale={locale}
        selectedId={tokenId}
        onSelect={setTokenId}
        pack={pack}
        score={score}
        coin={coin}
        loading={loading || market.loading}
        days={days}
        onDays={setDays}
        onOpenFull={(id) => onOpenRoute?.(`/coin/${id}`)}
      />
    </>
  );
}

export function ChatTokenRoom({
  card = null, locale = 'fa', onOpenRoute, defaultOpen = false
}) {
  const isFa = fa(locale);
  const seed = card?.coinId || (card?.symbol ? slugOf(card.symbol) : null);
  const [tokenId, setTokenId] = useState(seed);
  const [open, setOpen] = useLatestGate(defaultOpen);
  const symbol = String(card?.symbol || '').toUpperCase();

  return (
    <RoomFrame
      open={open}
      onToggle={() => setOpen((v) => !v)}
      mark="✧"
      title={isFa
        ? `اتاق تحلیل ${symbol || 'توکن'}`
        : `${symbol || 'Token'} analysis room`}
      hint={isFa
        ? 'کندل، اندیکاتورها، حمایت/مقاومت و امتیاز ترکیبی با شواهد'
        : 'Candles, indicators, support/resistance and a composite score with evidence'}
      chip={card?.change24hPct != null ? `${Number(card.change24hPct) >= 0 ? '+' : ''}${Math.round(Number(card.change24hPct) * 100) / 100}%` : null}
      testId="intent-ai-token-room"
      locale={locale}
      footer={ct(locale, 'page.notAdvice')}
    >
      <TokenRoomBody
        tokenId={tokenId}
        setTokenId={setTokenId}
        locale={locale}
        onOpenRoute={onOpenRoute}
      />
    </RoomFrame>
  );
}

/* ── ROOM 3 — THE PORTFOLIO (allocation, concentration, measured risk) ───── */

function PortfolioRoomBody({ locale, onOpenRoute }) {
  const {
    connected, intel, analysis, review, performance, coverage, loading, markets
  } = usePortfolioRoom();
  return (
    <PortfolioTab
      connected={connected}
      intel={intel}
      analysis={analysis}
      review={review}
      performance={performance}
      locale={locale}
      onConnect={(path) => onOpenRoute?.(path)}
      loading={loading}
      coverage={coverage}
      onOpenToken={(symbol) => {
        if (!symbol) return;
        const hit = (markets || []).find((m) => String(m.symbol).toUpperCase() === String(symbol).toUpperCase());
        if (hit) onOpenRoute?.(`/coin/${hit.id}`);
      }}
    />
  );
}

export function ChatPortfolioRoom({
  locale = 'fa', onOpenRoute, defaultOpen = false
}) {
  const [open, setOpen] = useLatestGate(defaultOpen);
  const isFa = fa(locale);
  return (
    <RoomFrame
      open={open}
      onToggle={() => setOpen((v) => !v)}
      mark="◈"
      title={isFa ? 'اتاق پرتفوی هوش بازار' : 'Portfolio intelligence room'}
      hint={isFa
        ? 'سود/زیان، بهترین و ضعیف‌ترین عملکرد، یافته‌ها و پیشنهادهای عملی'
        : 'Profit and loss, strongest and weakest holding, findings and actions'}
      testId="intent-ai-portfolio-room"
      locale={locale}
      footer={ct(locale, 'page.notAdvice')}
    >
      <PortfolioRoomBody locale={locale} onOpenRoute={onOpenRoute} />
    </RoomFrame>
  );
}
