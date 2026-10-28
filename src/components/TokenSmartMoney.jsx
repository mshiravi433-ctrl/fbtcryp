import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fetchToken, fmtUsd, shortAddr } from '../lib/smartMoneyClient';
import { EVM_CHAINS } from '../lib/chains';
import '../styles/smart-money-intelligence.css';

/*
 * «شلوعی سرور و cpu … فقط دادهٔ ۲۴ ساعتهٔ هوشمند مانی، بدون لیست کیف‌پول‌ها»
 * ─────────────────────────────────────────────────────────────────────────
 * This card used to be a four-tab (۱ ساعت · ۴ ساعت · ۲۴ ساعت · هفته) view backed
 * by three server reads per visit, including a wallet-consensus index rebuild
 * and a seven-chain whale scan. That is what pushed the instance into CPU and
 * memory trouble, and it answered questions the card does not need:
 *
 *   · 4h / 7d needed a separate candle request per pool — removed;
 *   · the wallet lists (consensus, receipts, top buyers/sellers) needed the
 *     wallet index — removed;
 *   · the whale scan fallback ran exactly when the cheap source was already
 *     rate-limited — removed server-side.
 *
 * What is left is one honest answer to one question: the real DEX buying,
 * selling and net flow of THIS contract over the last 24 hours. The card:
 *
 *   · asks for it ONCE, with `window=24h`, and only when it is actually open
 *     (a collapsed card in the token page costs zero requests);
 *   · never draws a zero it did not measure — `null` renders «—»;
 *   · names the measurement (`basis`) and the upstream that answered, so
 *     «exact individual trades», «estimated from 24h pool counts» and «not
 *     measured» can never be confused with each other.
 */

/* How the numbers below were produced. */
const BASIS_LABEL = {
  trades: 'sm.flow.basisTrades',
  'trades-sample': 'sm.flow.basisTradesSample',
  counts: 'sm.flow.basisCounts',
  volume: 'sm.flow.basisVolume',
  none: 'sm.flow.basisNone'
};

/* Upstream names as the user would find them — never an internal codename. */
const SOURCE_LABEL = {
  geckoterminal: 'GeckoTerminal',
  blockscout: 'Blockscout',
  dexscreener: 'DexScreener',
  'geckoterminal+blockscout': 'GeckoTerminal · Blockscout',
  'dexscreener+blockscout': 'DexScreener · Blockscout',
  none: null
};

const fmtInt = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : '—');

/**
 * Token-level Smart Money card — embedded in the token detail page AND in the
 * /smart-money/token/:chain/:address route. Read-only on-chain signals:
 * 24-hour buying/selling/net flow, accumulation vs distribution, holders,
 * liquidity. Never a buy recommendation.
 */
export default function TokenSmartMoney({ chainId = 1, address, embedded = true, collapsible = true }) {
  const { t } = useTranslation();
  /* 'solana' is a first-class chain here (base58 mints are served by the
     intel route); it must survive the prop instead of being coerced to 1. */
  const chain = chainId === 'solana' ? 'solana' : Number(chainId) || 1;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  /*
   * Embedded in the token page this card sits between the chart and the safety
   * box, so it starts COLLAPSED (the standalone /smart-money/token route starts
   * OPEN, because there the user navigated precisely to read it).
   */
  const [openState, setOpenState] = useState(!embedded);
  const open = collapsible ? openState : true;
  const Head = collapsible ? 'button' : 'div';

  /* A different contract must never inherit the previous one's numbers: the
     identity line would name the OLD symbol next to the NEW address while the
     request is in flight. Clear on identity change, not on open/close. */
  useEffect(() => {
    setData(null);
    setError(null);
  }, [chain, address]);

  /*
   * ONE request, and only while the card is visible.
   *
   * A collapsed card in the token page used to fetch anyway: thousands of
   * token-page views paid for a fan-out nobody looked at. Now the read starts
   * when the card is opened, is cancelled when it closes or the token changes,
   * and the server caches the 24-hour summary for five minutes.
   */
  useEffect(() => {
    if (!address || !open) return undefined;
    const ctrl = new AbortController();
    let on = true;
    setLoading(true);
    setError(null);
    fetchToken(chain, address, '24h', ctrl.signal)
      .then((d) => { if (on) { setData(d); setError(null); } })
      .catch((e) => {
        if (!on) return;
        if (e?.name === 'AbortError' || e?.message === 'ABORTED') return;
        setError(e.message);
      })
      .finally(() => { if (on) setLoading(false); });
    return () => { on = false; ctrl.abort(); };
  }, [chain, address, open]);

  if (!address) return null;

  const flow = data?.smartMoneyFlow;
  const accum = flow ? flow.accumulation : null;
  const distrib = flow ? flow.distribution : null;
  const holders = data?.holders;
  const basis = flow?.basis || null;
  const estimated = !!flow?.estimated;
  const sampled = flow?.sampled || null;
  const flowSource = flow?.coverage?.tradeSource || flow?.coverage?.poolSource || flow?.coverage?.source || null;

  /*
   * WHICH TOKEN THESE NUMBERS BELONG TO.
   * A wrong-chain address is invisible in a tile layout: the meters still
   * draw, they just describe another asset. So the card prints the identity
   * the SERVER read back for this exact contract.
   */
  const chainName = chain === 'solana' ? 'Solana' : (EVM_CHAINS[chain]?.name ?? String(chain));
  const resolvedSymbol = data?.symbol || null;

  const flowTrades = Number.isFinite(flow?.trades) ? flow.trades : null;
  const flowWallets = Number.isFinite(flow?.wallets) ? flow.wallets : null;
  const flowVolume = Number.isFinite(flow?.volumeUsd) ? flow.volumeUsd : null;
  const coveredPct = Number.isFinite(sampled?.coveredPct) ? sampled.coveredPct : null;
  const sourceName = flowSource ? (SOURCE_LABEL[flowSource] || flowSource) : null;
  /* No `basis` means an older server response — do not claim «not measured»
     about numbers that are present. */
  const basisLabel = basis ? t(BASIS_LABEL[basis] || BASIS_LABEL.none, { pct: coveredPct ?? 0 }) : null;

  const headSummary = data && Number.isFinite(flow?.netUsd)
    ? `${flow.netUsd >= 0 ? '+' : '−'}${fmtUsd(Math.abs(flow.netUsd))}`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`sm-section sm-token-card ${open ? 'is-open' : ''}`}
      style={embedded ? { margin: 0 } : undefined}
    >
      {/* ── the header is the collapse toggle, not a decorative h3 ───────── */}
      <Head
        type={collapsible ? 'button' : undefined}
        className={`sm-token-head${collapsible ? '' : ' is-static'}`}
        aria-expanded={collapsible ? open : undefined}
        aria-controls={collapsible ? 'sm-token-card-body' : undefined}
        data-testid={collapsible ? 'sm-token-toggle' : undefined}
        onClick={collapsible ? () => setOpenState((v) => !v) : undefined}
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
          <span className="sm-token-chip ghost" data-testid="sm-token-window-badge">{t('sm.windows.24h')}</span>
        </span>
        {headSummary ? <span className="sm-token-head-summary mono">{headSummary}</span> : null}
        {collapsible && <svg
          className={`sm-token-caret ${open ? 'is-open' : ''}`}
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>}
      </Head>

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

          {/*
            ── WHAT THESE NUMBERS ARE, IN WORDS ────────────────────────────
            The card names the measurement (`basis`), the sample it came from
            and the upstream that answered — and says «نه اندازه‌گیری‌شده»
            when the answer is simply absent instead of drawing a zero.
          */}
          <div className="sm-token-evidence" data-testid="sm-token-evidence">
            <div className="sm-token-evidence-head">
              {basisLabel && (
                <span className={`smi-signal ${basis === 'none' ? 'idle' : estimated ? 'watch' : 'up'}`}
                  data-testid="sm-token-basis">
                  {basisLabel}
                </span>
              )}
              {estimated && <span className="sm-token-chip ghost">{t('sm.flow.estimated')}</span>}
              {sourceName && <span className="sm-token-chip ghost" data-testid="sm-token-source">{sourceName}</span>}
            </div>
            <div className="sm-token-evidence-rows">
              {flowTrades != null && (
                <span>{t('sm.flow.evidenceTrades', {
                  trades: fmtInt(flowTrades),
                  wallets: flowWallets != null ? fmtInt(flowWallets) : '—'
                })}</span>
              )}
              {flowVolume != null && (
                <span>{t('sm.flow.evidenceVolume', { volume: fmtUsd(flowVolume) })}</span>
              )}
              {flow?.buys != null && flow?.sells != null && (
                <span>{t('sm.flow.evidenceCounts', { buys: fmtInt(flow.buys), sells: fmtInt(flow.sells) })}</span>
              )}
              {coveredPct != null && coveredPct < 95 && flowTrades > 0 && (
                <span className="warn">{t('sm.flow.coveragePct', { pct: coveredPct })}</span>
              )}
            </div>
            {basis === 'none' && <p className="smi-footnote" data-testid="sm-token-no-flow-data">{t('sm.flow.noData')}</p>}
            <p className="smi-footnote" data-testid="sm-token-window-note">
              {t('sm.tokenWindow24h')}
            </p>
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
              <div className={`val ${flow?.netUsd == null ? '' : flow.netUsd >= 0 ? 'sm-up' : 'sm-down'}`} style={{ fontSize: 15 }}>
                {fmtUsd(flow?.netUsd)}
              </div>
            </div>
          </div>

          {/* Accumulation vs distribution */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <div style={{ flex: 1 }}>
              <div className="faint" style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>{t('sm.accumulation')}</div>
              <div className="sm-meter" style={{ marginTop: 6 }}><i style={{ width: `${accum?.confidence != null ? Math.max(0, Math.min(100, accum.confidence)) : 0}%`, background: '#2ee6a8' }} /></div>
              <div className="sm-up" style={{ fontSize: 12, fontWeight: 900, marginTop: 4 }}>{accum?.confidence != null ? `${accum.confidence}%` : '—'}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="faint" style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>{t('sm.distribution')}</div>
              <div className="sm-meter" style={{ marginTop: 6 }}><i style={{ width: `${distrib?.confidence != null ? Math.max(0, Math.min(100, distrib.confidence)) : 0}%`, background: '#ff5c7a' }} /></div>
              <div className="sm-down" style={{ fontSize: 12, fontWeight: 900, marginTop: 4 }}>{distrib?.confidence != null ? `${distrib.confidence}%` : '—'}</div>
            </div>
          </div>

          {/* Holder analysis — aggregates only; the address list is not sent */}
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

          {/*
            A COUNT, not a list: how many distinct wallets traded this contract
            in the sample the numbers came from. «—» when the sample cannot
            support a 24-hour wallet count.
          */}
          <div className="sm-row" style={{ cursor: 'default' }}>
            <div className="mid">
              <div className="name">{t('sm.flow.walletsTraded')}</div>
            </div>
            <div className="right usd" data-testid="sm-token-wallets">{flowWallets != null ? fmtInt(flowWallets) : '—'}</div>
          </div>
          <div className="sm-row" style={{ cursor: 'default' }}>
            <div className="mid"><div className="name">{t('sm.liquidity')}</div></div>
            <div className="right usd">{fmtUsd(data.liquidityUsd)}</div>
          </div>

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
