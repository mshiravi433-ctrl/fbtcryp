import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fetchToken, fmtUsd, shortAddr } from '../lib/smartMoneyClient';
import { EVM_CHAINS } from '../lib/chains';
import { FlowBar } from '../pages/SmartMoney';
import SegIndicator from './SegIndicator';

/*
 * «تب ۱ ساعت / ۴ ساعت / روز / هفته روی این باکس کار نمی‌کند»
 *
 * Two causes, both real:
 *
 *  · the buttons printed the raw API keys ('1h', '4h', …), so a tap changed
 *    the label's styling only — nothing told the user which window they were
 *    now looking at;
 *  · the accumulation / distribution meters read `data.accumulation` and
 *    `data.distribution`, which come from the token's FIXED 24-hour DEX pair
 *    statistics, not from the window-scoped `smartMoneyFlow`. Buying, selling
 *    and net flow moved with the window; the two meters never did, so half of
 *    the card looked frozen no matter what was selected.
 *
 * The meters now take the window-scoped signal when the server answered with
 * one, and the window the card is showing is printed on the flow block.
 */
const WINDOWS = ['1h', '4h', '24h', '7d'];

/**
 * Token-level Smart Money card — embedded in the token detail page AND in the
 * /smart-money/token/:chain/:address route. Read-only on-chain signals:
 * buying/selling net flow, smart wallets, whale concentration, accumulation vs
 * distribution confidence, top buyers/sellers, holders, liquidity, exchange
 * flow. Never a buy recommendation.
 */
export default function TokenSmartMoney({ chainId = 1, address, embedded = true }) {
  const { t } = useTranslation();
  /* 'solana' is a first-class chain here (base58 mints are served by the
     intel route); it must survive the prop instead of being coerced to 1. */
  const chain = chainId === 'solana' ? 'solana' : Number(chainId) || 1;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [win, setWin] = useState('24h');
  /*
   * «حتماً بزار داخل باکس بازشونده تا صفحه شلوغیش کم بشه»
   *
   * Embedded in the token page this card sits between the chart and the safety
   * box, and it is eleven metric tiles deep — enough to push the page's own
   * content below the fold. So the embedded card starts COLLAPSED and the
   * standalone /smart-money/token route starts OPEN, because there the user
   * navigated precisely to read it.
   */
  const [open, setOpen] = useState(!embedded);

  useEffect(() => {
    if (!address) return undefined;
    let on = true;
    setLoading(true);
    fetchToken(chain, address, win)
      .then((d) => { if (on) { setData(d); setError(null); } })
      .catch((e) => { if (on) setError(e.message); })
      .finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [chain, address, win]);

  if (!address) return null;

  const flow = data?.smartMoneyFlow;
  /* Window-scoped signals first (they are what `window` actually selects);
     the pair-level numbers are the fallback, and they are labelled as such. */
  const accum = flow?.accumulation ?? data?.accumulation;
  const distrib = flow?.distribution ?? data?.distribution;
  const holders = data?.holders;
  const windowScoped = flow?.window === win;

  /*
   * ── WHICH TOKEN THESE NUMBERS BELONG TO ─────────────────────────────────
   * «ارتباط هوشمند مانی را با هر توکن بررسی کن ببین درسته» — the card asked
   * /api/v1/smart-money/token/:chain/:address with the contract the token page
   * resolved, and then showed eleven numbers with nothing on screen tying them
   * back to a token. A wrong-chain address is invisible in that layout: the
   * meters still draw, they just describe another asset.
   *
   * So the card now prints the identity the SERVER read back — the symbol and
   * name DexScreener reports for that exact contract, plus the chain and the
   * address it was asked about. If no pair was found the symbol is null and the
   * line says so, rather than letting the reader assume the numbers are his
   * token's.
   */
  const chainName = chain === 'solana' ? 'Solana' : (EVM_CHAINS[chain]?.name ?? String(chain));
  const resolvedSymbol = data?.symbol || null;
  const netUsd = Number(flow?.netUsd);
  const headSummary = loading
    ? null
    : Number.isFinite(netUsd) && netUsd !== 0
      ? `${netUsd > 0 ? '+' : '−'}${fmtUsd(Math.abs(netUsd))}`
      : t('sm.tokenSummaryFlat');

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`sm-section sm-token-card ${open ? 'is-open' : ''}`}
      style={embedded ? { margin: 0 } : undefined}
    >
      {/* ── the header is the collapse toggle, not a decorative h3 ───────── */}
      <button
        type="button"
        className="sm-token-head"
        aria-expanded={open}
        aria-controls="sm-token-card-body"
        data-testid="sm-token-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sm-token-head-main">
          <svg
            className="sm-token-head-icon"
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
          >
            <path d="M12 2.6 3.4 7.3v9.4L12 21.4l8.6-4.7V7.3z" />
            <path d="M3.4 7.3 12 12l8.6-4.7" />
            <path d="M12 21.4V12" />
          </svg>
          {t('sm.title')}
        </span>
        {headSummary ? <span className="sm-token-head-summary mono">{headSummary}</span> : null}
        <svg
          className={`sm-token-caret ${open ? 'is-open' : ''}`}
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* the identity line — the connection itself, visible and checkable */}
      <div className="sm-token-identity" data-testid="sm-token-identity">
        <span className="sm-token-identity-row">
          <b className="sm-token-symbol">{resolvedSymbol || shortAddr(address)}</b>
          {data?.name ? <span className="sm-token-name">{data.name}</span> : null}
          <span className="sm-token-chip">{chainName}</span>
          {data?.markets ? <span className="sm-token-chip ghost">{data.markets} {t('sm.marketsChip')}</span> : null}
        </span>
        <span className="sm-token-addr mono" title={address}>{address}</span>
        <span className="sm-token-identity-note">
          {t('sm.tokenDataFor', { symbol: resolvedSymbol || shortAddr(address), chain: chainName })}
        </span>
      </div>

      {/*
        ── THE WINDOW RAIL, ON ITS OWN ROW ──────────────────────────────────
        «تبش خیلی دراز شده و از باکس زده بیرون» — the rail used to live INSIDE
        the <h3>, on the same flex line as the title. Four labels (۱ ساعت ·
        ۴ ساعت · ۲۴ ساعت · هفته) plus a title do not fit in one phone-width row,
        so the rail overflowed the card's padding and the last tab was clipped.
        It is now a block-level row of its own, full width, four equal
        segments, each with a real 40px tap target.
      */}
      <div className="sm-seg-window sm-token-windows" role="tablist" aria-label={t('sm.windowAria')} data-testid="sm-token-window-tabs">
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            role="tab"
            aria-selected={win === w}
            className={`sm-seg-window-item ${win === w ? 'active' : ''}`}
            data-testid={`sm-token-window-${w}`}
            onClick={() => setWin(w)}
          >
            {win === w && <SegIndicator id={`sm-token-window-${chain}`} />}
            {t(`sm.windows.${w}`)}
          </button>
        ))}
      </div>

      {open && <div className="sm-token-body" id="sm-token-card-body">

      {loading && (
        <>
          <div className="sm-skel" style={{ width: '70%' }} />
          <div className="sm-skel" style={{ width: '50%' }} />
        </>
      )}

      {error && <div className="sm-empty">{t('sm.tokenUnavailable')}</div>}

      {data && !loading && (
        <>
          {data.dataStatus !== 'live' && (
            <div className="sm-empty" style={{ padding: '8px 0' }}>{t('sm.tokenNoDex')}</div>
          )}

          {/* Buying / selling / net — these three follow the selected window. */}
          <div className="sm-coverage" data-testid="sm-token-window-note">
            {t('sm.tokenWindowNote', { window: t(`sm.windows.${win}`) })}
          </div>
          <div className="sm-metrics" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <div className="sm-metric">
              <div className="lab">{t('sm.buying')}</div>
              <div className="val sm-up" style={{ fontSize: 15 }}>{fmtUsd(flow?.buyUsd)}</div>
            </div>
            <div className="sm-metric">
              <div className="lab">{t('sm.selling')}</div>
              <div className="val sm-down" style={{ fontSize: 15 }}>{fmtUsd(flow?.sellUsd)}</div>
            </div>
            <div className="sm-metric">
              <div className="lab">{t('sm.netFlow')}</div>
              <div className={`val ${(flow?.netUsd || 0) >= 0 ? 'sm-up' : 'sm-down'}`} style={{ fontSize: 15 }}>
                {fmtUsd(flow?.netUsd)}
              </div>
            </div>
          </div>

          {/* Accumulation vs distribution */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <div style={{ flex: 1 }}>
              <div className="faint" style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>{t('sm.accumulation')}</div>
              <div className="sm-meter" style={{ marginTop: 6 }}><i style={{ width: `${accum?.confidence != null ? accum.confidence : 0}%`, background: '#2ee6a8' }} /></div>
              <div className="sm-up" style={{ fontSize: 12, fontWeight: 900, marginTop: 4 }}>{accum?.confidence != null ? `${accum.confidence}%` : '—'}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="faint" style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>{t('sm.distribution')}</div>
              <div className="sm-meter" style={{ marginTop: 6 }}><i style={{ width: `${distrib?.confidence != null ? distrib.confidence : 0}%`, background: '#ff5c7a' }} /></div>
              <div className="sm-down" style={{ fontSize: 12, fontWeight: 900, marginTop: 4 }}>{distrib?.confidence != null ? `${distrib.confidence}%` : '—'}</div>
            </div>
          </div>

          {/* Holder analysis */}
          {holders?.dataStatus === 'live' && (
            <div className="sm-metrics" style={{ gridTemplateColumns: 'repeat(2,1fr)', marginTop: 12 }}>
              <div className="sm-metric">
                <div className="lab">{t('sm.totalHolders')}</div>
                <div className="val" style={{ fontSize: 16 }}>{holders.total?.toLocaleString() ?? '—'}</div>
              </div>
              <div className="sm-metric">
                <div className="lab">{t('sm.top10')}</div>
                <div className="val" style={{ fontSize: 16 }}>{holders.top10Share != null ? `${holders.top10Share}%` : '—'}</div>
              </div>
              <div className="sm-metric">
                <div className="lab">{t('sm.whaleConcentration')}</div>
                <div className={`val ${holders.whaleConcentration === 'HIGH' ? 'sm-down' : holders.whaleConcentration === 'MEDIUM' ? 'sm-risk-MEDIUM' : 'sm-up'}`} style={{ fontSize: 14 }}>
                  {holders.whaleConcentration || '—'}
                </div>
              </div>
              <div className="sm-metric">
                <div className="lab">{t('sm.exchangeSupply')}</div>
                <div className="val" style={{ fontSize: 16 }}>{holders.exchangeSupplyPct != null ? `${holders.exchangeSupplyPct}%` : '—'}</div>
              </div>
            </div>
          )}

          {/* Smart wallets count */}
          <div className="sm-row" style={{ cursor: 'default' }}>
            <div className="mid"><div className="name">{t('sm.smartWalletsTitle')}</div></div>
            <div className="right usd">{flow?.smartWallets ?? '—'}</div>
          </div>
          <div className="sm-row" style={{ cursor: 'default' }}>
            <div className="mid"><div className="name">{t('sm.liquidity')}</div></div>
            <div className="right usd">{fmtUsd(data.liquidityUsd)}</div>
          </div>

          {/* Top buyers / sellers */}
          {flow?.topBuyers?.length > 0 && (
            <>
              <div className="faint" style={{ fontSize: 11, fontWeight: 800, marginTop: 10, textTransform: 'uppercase' }}>{t('sm.topBuyers')}</div>
              {flow.topBuyers.slice(0, 5).map((b) => (
                <div key={b.address} className="sm-row">
                  <div className="mid mono"><div className="name">{b.short || shortAddr(b.address)}</div></div>
                  <div className="right usd sm-up">{fmtUsd(b.usd)}</div>
                </div>
              ))}
            </>
          )}
          {flow?.topSellers?.length > 0 && (
            <>
              <div className="faint" style={{ fontSize: 11, fontWeight: 800, marginTop: 10, textTransform: 'uppercase' }}>{t('sm.topSellers')}</div>
              {flow.topSellers.slice(0, 5).map((s) => (
                <div key={s.address} className="sm-row">
                  <div className="mid mono"><div className="name">{s.short || shortAddr(s.address)}</div></div>
                  <div className="right usd sm-down">{fmtUsd(s.usd)}</div>
                </div>
              ))}
            </>
          )}

          {!windowScoped && (
            <div className="sm-coverage">{t('sm.tokenWindowFallback')}</div>
          )}

          {data.risk && (
            <div style={{ marginTop: 10 }}>
              <span className={`sm-tag ${data.risk === 'HIGH' ? 'warn' : ''}`} style={{ float: 'none' }}>
                {t('sm.risk')}: {data.risk}
              </span>
            </div>
          )}

          <div className="sm-disclaimer">{t('sm.tokenDisclaimer')}</div>
        </>
      )}

      </div>}
    </motion.div>
  );
}
