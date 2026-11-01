import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  agoLabel,
  fmtMoney,
  fmtSol,
  getSolanaWhales,
  getSolanaWalletTrack,
  invalidateSolTrack,
  isSolanaAddress,
  loadWatchedAddress,
  saveWatchedAddress,
  shortSolAddress,
  solAddressUrl,
  solTxUrl
} from '../../lib/solTrack';
import '../../styles/sol-track.css';

/**
 * SOLANA TRACKING, INSIDE THE SMART WALLET.
 * ---------------------------------------------------------------------------
 *   «در کیف پول هوشمند ردیابی sol کیف پول و تراکنش و نهنگ های سولانا را اضافه کن»
 *
 * Three segments over two read-only endpoints (server/solanaTrack.js):
 *
 *   کیف پول     one address: SOL balance, its value in the reader's currency,
 *              the SPL tokens the node reports, and how much of it is unread.
 *   تراکنش‌ها   the node's own list of that address's last 25 signatures —
 *              time, success or failure, memo, and a link to the explorer.
 *   نهنگ‌ها     large SOL movements across the chain, with the coverage
 *              statement that belongs to them (one sampled block per refresh,
 *              a stated floor, and which sources answered).
 *
 * ─── WHY IT SITS HERE AND NOT ON A NEW SCREEN ────────────────────────────────
 * The Smart Wallet is the screen about LIMITS: what this app may sign, how much,
 * with whose blessing. A ceiling without a view of the wallet it protects is a
 * number typed into a form. This panel is that view — and it is deliberately
 * read-only: it cannot start a session, move a ceiling, or sign anything, and
 * the note at its foot says so in words rather than leaving the reader to infer
 * it from the absence of a button.
 *
 * ─── HONESTY RULES (the same ones the server keeps) ──────────────────────────
 *   · `tokens: null` prints «خوانده نشد», never «no tokens» — those are
 *     different claims and only one of them is known.
 *   · the 24h counts are printed WITH their window ("in the last 25 signatures")
 *     because a node gives no lifetime count for an address;
 *   · a whale feed with no key and no reachable node says so, and shows the
 *     floor it would have applied;
 *   · no amount is rounded into a zero, and no address is given a label this
 *     app cannot source.
 */

/** Wire source id → locale key. */
const SOURCE_KEYS = { 'rpc-block-sample': 'rpcBlockSample', solscan: 'solscan' };

const TABS = ['wallet', 'tx', 'whales'];
const WALLET_POLL_MS = 60_000;
const WHALE_POLL_MS = 300_000;

/** The connected Solana address, from an injected provider if there is one. */
function injectedSolanaAddress() {
  try {
    const pub = window?.solana?.publicKey;
    const value = typeof pub?.toString === 'function' ? pub.toString() : null;
    return isSolanaAddress(value) ? value : null;
  } catch {
    return null;
  }
}

function Segment({ active, onChange, label, count = null }) {
  return (
    <button
      type="button"
      className="sol-track-seg"
      data-active={active ? 'true' : 'false'}
      aria-pressed={active}
      onClick={() => onChange()}
    >
      <span>{label}</span>
      {count != null && <b className="mono">{count}</b>}
    </button>
  );
}

function StateLine({ tone = 'idle', children }) {
  return <p className="sol-track-state" data-tone={tone}>{children}</p>;
}

export default function SolTrackPanel({ vs = 'usd', currencySymbol = '$' }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('wallet');
  const [draft, setDraft] = useState(() => loadWatchedAddress() || injectedSolanaAddress() || '');
  const [tracked, setTracked] = useState(() => loadWatchedAddress() || injectedSolanaAddress() || null);
  const [wallet, setWallet] = useState(null);
  const [whales, setWhales] = useState(null);
  const [busy, setBusy] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const trackedRef = useRef(tracked);
  trackedRef.current = tracked;

  const readWallet = useCallback(async (address) => {
    if (!isSolanaAddress(address)) return;
    setBusy(true);
    const out = await getSolanaWalletTrack(address, vs);
    if (trackedRef.current !== address) return;   /* a newer address won the race */
    setWallet(out);
    setError(out?.ok ? null : (out?.code || 'NETWORK'));
    setBusy(false);
  }, [vs]);

  const readWhales = useCallback(async () => {
    setBusy(true);
    const out = await getSolanaWhales(vs);
    setWhales(out);
    setBusy(false);
  }, [vs]);

  /* First read, and again whenever the tracked address or the currency changes. */
  useEffect(() => {
    if (!tracked) {
      setWallet(null);
      return;
    }
    readWallet(tracked);
  }, [tracked, vs, readWallet]);

  useEffect(() => {
    readWhales();
  }, [vs, readWhales]);

  /*
   * Polling, the way every live surface here does it: on an interval, only while
   * the tab is visible, and never faster than the server's own cache (60s a
   * wallet, 5min the whales) so a screen left open cannot spend an upstream
   * budget on answers that have not changed.
   */
  useEffect(() => {
    const walletTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && trackedRef.current) readWallet(trackedRef.current);
    }, WALLET_POLL_MS);
    const whaleTimer = setInterval(() => {
      if (document.visibilityState === 'visible') readWhales();
    }, WHALE_POLL_MS);
    /* The clock that ages every "۳ دقیقه پیش" on the panel. Ten seconds, like
       the market screen's own freshness chip. */
    const clock = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      clearInterval(walletTimer);
      clearInterval(whaleTimer);
      clearInterval(clock);
    };
  }, [readWallet, readWhales]);

  const onTrack = () => {
    const value = String(draft || '').trim();
    if (!isSolanaAddress(value)) {
      setError('BAD_ADDRESS');
      return;
    }
    setError(null);
    saveWatchedAddress(value);
    invalidateSolTrack();
    setTracked(value);
  };

  /*
   * «Use my connected wallet» — and WHY IT IS A TAP, NOT AN EFFECT.
   *
   * An injected provider (Phantom and friends) is readable synchronously from
   * `window.solana`. Every other Solana connection this app supports — MWA on
   * Android, a deeplink session inside the packaged APK — is only reachable
   * through lib/solanaWallet.js, and that module carries the wallet ADAPTER with
   * it: web3.js, the wallet-standard registry, the signing stack. Importing it on
   * mount would drag all of that into the Smart Wallet's chunk for a surface that
   * only READS public data. So the panel asks for it when the reader actually
   * asks, through a dynamic import that lands in its own chunk — and a read-only
   * screen never ships a signer it did not request.
   */
  const onUseConnected = async () => {
    const injected = injectedSolanaAddress();
    if (isSolanaAddress(injected)) {
      setDraft(injected);
      saveWatchedAddress(injected);
      invalidateSolTrack();
      setTracked(injected);
      return;
    }
    setProbing(true);
    try {
      const mod = await import('../../lib/solanaWallet');
      const value = typeof mod?.solanaAddress === 'function' ? mod.solanaAddress() : null;
      if (isSolanaAddress(value)) {
        setDraft(value);
        saveWatchedAddress(value);
        invalidateSolTrack();
        setTracked(value);
        setError(null);
      } else {
        setError('NOT_CONNECTED');
      }
    } catch {
      /* No adapter in this build (or a wallet that refused to answer) is a
         normal state, not a crash: the reader can still paste an address. */
      setError('NOT_CONNECTED');
    } finally {
      setProbing(false);
    }
  };

  const onRefresh = () => {
    invalidateSolTrack();
    if (tracked) readWallet(tracked);
    readWhales();
  };

  const data = wallet?.ok ? wallet.data : null;
  const whaleData = whales?.ok ? whales.data : null;
  const native = data?.native ?? null;
  const transactions = data?.transactions ?? null;
  const activity = data?.activity ?? null;
  const transfers = whaleData?.transfers ?? [];
  const coverage = whaleData?.coverage ?? null;

  const updatedAgo = useMemo(() => agoLabel(data?.updatedAt ? Date.parse(data.updatedAt) : null, now), [data?.updatedAt, now]);

  const errorCopy = (code) => ({
    BAD_ADDRESS: t('smart.sol.badAddress'),
    RPC_UNAVAILABLE: t('smart.sol.rpcDown'),
    TIMEOUT: t('smart.sol.timeout'),
    NETWORK: t('smart.sol.network'),
    NOT_CONNECTED: t('smart.sol.notConnected'),
    SOLANA_TRACK_FAILED: t('smart.sol.rpcDown')
  }[code] || t('smart.sol.rpcDown'));

  return (
    <section className="wallet-pie-card sol-track" data-testid="sol-track" aria-labelledby="sol-track-title">
      <header className="sol-track-head">
        <div className="sol-track-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
            {/* Solana's own three-bar mark, drawn: a typed "◎" arrives as
                platform artwork in a different weight on every OS. */}
            <path d="M6.6 8.2h12.1L15.4 5H3.3z" fill="currentColor" />
            <path d="M6.6 13.6h12.1L15.4 10.4H3.3z" fill="currentColor" opacity=".72" />
            <path d="M6.6 19h12.1L15.4 15.8H3.3z" fill="currentColor" opacity=".48" />
          </svg>
        </div>
        <div className="sol-track-heading">
          <h3 id="sol-track-title">{t('smart.sol.title')}</h3>
          <p>{t('smart.sol.subtitle')}</p>
        </div>
        <button
          type="button"
          className="sol-track-refresh"
          onClick={onRefresh}
          disabled={busy}
          data-busy={busy ? 'true' : undefined}
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
          data-testid="sol-track-refresh"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M20 4v4h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      {/* ── the address being tracked ─────────────────────────────────────── */}
      <div className="sol-track-address">
        <label className="field-label" htmlFor="sol-track-input">{t('smart.sol.addressLabel')}</label>
        <div className="sol-track-inputrow">
          <input
            id="sol-track-input"
            className="sw-input sol-track-input mono"
            value={draft}
            dir="ltr"
            spellCheck={false}
            autoComplete="off"
            placeholder={t('smart.sol.addressPlaceholder')}
            onChange={(event) => { setDraft(event.target.value); if (error === 'BAD_ADDRESS') setError(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter') onTrack(); }}
            data-testid="sol-track-input"
          />
          <button type="button" className="btn btn-sm btn-primary sol-track-go" onClick={onTrack} data-testid="sol-track-go">
            {t('smart.sol.track')}
          </button>
        </div>
        <div className="sol-track-addressmeta">
          <button
            type="button"
            className="sol-track-link"
            onClick={onUseConnected}
            disabled={probing}
            data-testid="sol-track-connected"
          >
            {probing ? t('common.loading') : t('smart.sol.useConnected')}
          </button>
          {tracked && (
            <a className="sol-track-link" href={solAddressUrl(tracked)} target="_blank" rel="noopener noreferrer">
              {shortSolAddress(tracked, 6, 6)}
            </a>
          )}
          {updatedAgo && (
            <span className="sol-track-updated mono">
              {t(`smart.sol.ago.${updatedAgo.unit}`, { n: updatedAgo.value })}
            </span>
          )}
        </div>
        {error && <StateLine tone="danger">{errorCopy(error)}</StateLine>}
      </div>

      {/* ── segments ──────────────────────────────────────────────────────── */}
      <div className="sol-track-segs" role="group" aria-label={t('smart.sol.title')}>
        <Segment
          active={tab === 'wallet'}
          onChange={() => setTab('wallet')}
          label={t('smart.sol.tabWallet')}
          count={data?.tokenCount ?? null}
        />
        <Segment
          active={tab === 'tx'}
          onChange={() => setTab('tx')}
          label={t('smart.sol.tabTx')}
          count={transactions?.length ?? null}
        />
        <Segment
          active={tab === 'whales'}
          onChange={() => setTab('whales')}
          label={t('smart.sol.tabWhales')}
          count={transfers.length || null}
        />
      </div>

      {/* ── 1 · WALLET ────────────────────────────────────────────────────── */}
      {tab === 'wallet' && (
        <div className="sol-track-body" data-testid="sol-track-wallet">
          {!tracked && <StateLine>{t('smart.sol.pickAddress')}</StateLine>}
          {tracked && busy && !data && <StateLine tone="busy">{t('common.loading')}</StateLine>}
          {tracked && !data && !busy && error && <StateLine tone="danger">{errorCopy(error)}</StateLine>}

          {data && (
            <>
              <div className="sol-track-hero">
                <div className="sol-track-balance">
                  <span className="sol-track-figure mono" dir="ltr">
                    {fmtSol(native?.balance) ?? '—'}
                    <b>SOL</b>
                  </span>
                  <span className="sol-track-value mono" dir="ltr">
                    {native?.value != null ? `${currencySymbol}${fmtMoney(native.value)}` : t('smart.sol.valueUnknown')}
                  </span>
                </div>
                <div className="sol-track-price">
                  <span className="sol-track-kicker">{t('smart.sol.price')}</span>
                  <span className="mono" dir="ltr">
                    {native?.price != null ? `${currencySymbol}${fmtMoney(native.price, { maximumFractionDigits: native.price >= 100 ? 2 : 4 })}` : '—'}
                  </span>
                  {native?.priceChange24hPct != null && (
                    <span
                      className="sol-track-chg mono"
                      data-tone={native.priceChange24hPct >= 0 ? 'up' : 'down'}
                      dir="ltr"
                    >
                      {native.priceChange24hPct >= 0 ? '+' : ''}{native.priceChange24hPct.toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>

              {/* A partial read is labelled as one: which of the three reads
                  the node actually answered is part of the answer. */}
              {data?.partial?.balance && <StateLine tone="warn">{t('smart.sol.balanceUnread')}</StateLine>}

              <div className="sol-track-sub">
                <h4>{t('smart.sol.tokens')}</h4>
                {data?.tokens === null && <StateLine tone="warn">{t('smart.sol.tokensUnread')}</StateLine>}
                {Array.isArray(data?.tokens) && data.tokens.length === 0 && <StateLine>{t('smart.sol.noTokens')}</StateLine>}
                {Array.isArray(data?.tokens) && data.tokens.length > 0 && (
                  <ul className="sol-track-tokens">
                    {data.tokens.slice(0, 8).map((token) => (
                      <li key={token.mint || `${token.amount}`}>
                        <span className="mono sol-track-token-amount" dir="ltr">{fmtSol(token.amount) ?? '—'}</span>
                        {token.mint
                          ? <a className="mono sol-track-token-mint" href={solAddressUrl(token.mint)} target="_blank" rel="noopener noreferrer" dir="ltr">{shortSolAddress(token.mint, 4, 4)}</a>
                          : <span className="sol-track-token-mint">—</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {data?.tokenCount > 8 && (
                  <span className="sol-track-more mono">{t('smart.sol.tokenMore', { n: data.tokenCount - 8 })}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── 2 · TRANSACTIONS ──────────────────────────────────────────────── */}
      {tab === 'tx' && (
        <div className="sol-track-body" data-testid="sol-track-tx">
          {!tracked && <StateLine>{t('smart.sol.pickAddress')}</StateLine>}
          {tracked && busy && !transactions && <StateLine tone="busy">{t('common.loading')}</StateLine>}

          {activity && (
            <div className="sol-track-activity">
              <span><b className="mono">{activity.last24h}</b> {t('smart.sol.last24h')}</span>
              {activity.failed24h > 0 && (
                <span data-tone="down"><b className="mono">{activity.failed24h}</b> {t('smart.sol.failed')}</span>
              )}
              <span className="sol-track-window">{t('smart.sol.txWindow', { n: activity.windowSize })}</span>
            </div>
          )}

          {transactions && transactions.length === 0 && <StateLine>{t('smart.sol.noTx')}</StateLine>}
          {data?.partial?.transactions && <StateLine tone="warn">{t('smart.sol.txUnread')}</StateLine>}

          {transactions?.length > 0 && (
            <ul className="sol-track-txlist">
              {transactions.map((tx) => {
                const when = agoLabel(tx.at, now);
                return (
                  <li key={tx.signature} data-failed={tx.failed ? 'true' : 'false'}>
                    <a href={solTxUrl(tx.signature)} target="_blank" rel="noopener noreferrer" className="sol-track-tx">
                      <span className="sol-track-tx-dot" aria-hidden="true" />
                      <span className="sol-track-tx-main">
                        <span className="mono sol-track-tx-sig" dir="ltr">{shortSolAddress(tx.signature, 6, 6)}</span>
                        <span className="sol-track-tx-meta">
                          {when ? t(`smart.sol.ago.${when.unit}`, { n: when.value }) : t('smart.sol.noTime')}
                          {tx.slot != null && <i className="mono" dir="ltr"> · slot {tx.slot}</i>}
                          {tx.memo && <i className="sol-track-tx-memo"> · {tx.memo}</i>}
                        </span>
                      </span>
                      <span className="sol-track-tx-state">{tx.failed ? t('smart.sol.failed') : t('smart.sol.ok')}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── 3 · WHALES ────────────────────────────────────────────────────── */}
      {tab === 'whales' && (
        <div className="sol-track-body" data-testid="sol-track-whales">
          {busy && !whaleData && <StateLine tone="busy">{t('common.loading')}</StateLine>}

          {whaleData && (
            <div className="sol-track-coverage">
              <span>{t('smart.sol.whaleFloor', { n: whaleData.floorSol })}</span>
              {coverage?.sources?.length > 0 && (
                /* The wire names a source `rpc-block-sample`; the locale key is
                   `rpcBlockSample`. Translating between them here — rather than
                   naming the key after the wire value — keeps a wire rename from
                   silently printing a key on a wallet screen. */
                <span>{t('smart.sol.whaleSource', {
                  n: coverage.blocksPerRefresh,
                  sources: coverage.sources.map((s) => t(`smart.sol.source.${SOURCE_KEYS[s] || 'rpcBlockSample'}`)).join(' + ')
                })}</span>
              )}
            </div>
          )}

          {whaleData && whaleData.available === false && (
            <StateLine tone="warn">
              {whaleData.reason === 'UPSTREAM_UNAVAILABLE' ? t('smart.sol.whaleUnavailable') : t('smart.sol.whaleEmpty')}
            </StateLine>
          )}
          {!whaleData && !busy && <StateLine tone="warn">{t('smart.sol.whaleUnavailable')}</StateLine>}

          {transfers.length > 0 && (
            <ul className="sol-track-whales">
              {transfers.slice(0, 12).map((row) => {
                const when = agoLabel(row.at, now);
                return (
                  <li key={row.id}>
                    <span className="sol-track-whale-amount mono" dir="ltr">
                      {fmtSol(row.sol) ?? '—'}
                      <b>{row.asset || 'SOL'}</b>
                    </span>
                    <span className="sol-track-whale-path">
                      {row.fromLabel || (row.from ? shortSolAddress(row.from) : '—')}
                      <i aria-hidden="true">→</i>
                      {row.toLabel || (row.to ? shortSolAddress(row.to) : '—')}
                    </span>
                    <span className="sol-track-whale-side">
                      {row.value != null && <span className="mono" dir="ltr">{currencySymbol}{fmtMoney(row.value, { maximumFractionDigits: 0 })}</span>}
                      {when && <span className="sol-track-whale-when">{t(`smart.sol.ago.${when.unit}`, { n: when.value })}</span>}
                      {row.signature && (
                        <a className="sol-track-whale-link" href={solTxUrl(row.signature)} target="_blank" rel="noopener noreferrer">
                          {t('smart.sol.viewTx')}
                        </a>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {/* The coverage sentence is not a footnote: a sample that reads as a
              census is how a whale feed gets traded on. */}
          {coverage && (
            <p className="sol-track-note">{t('smart.sol.whaleCoverage')}</p>
          )}
        </div>
      )}

      <p className="sol-track-readonly">{t('smart.sol.readonlyNote')}</p>
    </section>
  );
}
