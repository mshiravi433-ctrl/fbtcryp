import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fmtPrice, fmtQty, fmtTime, fmtUsd } from '../lib/format';
import { readSolanaPortfolio } from '../lib/solana/portfolio';
import { holdingsTotalUsd, joinEquityHoldings } from '../lib/solanaSell';
import { shortAddress } from '../context/WalletContext';
import TokenIcon from '../lib/tokenIcon';
import { IconArrowUpRight, IconRefresh, IconWallet } from './Icons';
import '../styles/equity-holdings.css';

/**
 * «سهام من» — what the connected Solana wallet already holds of the tokens
 * the Stocks page lists, with a Sell on every row.
 *
 * ─── WHY THIS CARD EXISTS ────────────────────────────────────────────────────
 * The Stocks page could buy and could not show. A user who tapped «خرید
 * AAPLx», signed in their wallet and came back saw exactly the same page as
 * before — no confirmation, no balance, no way out. The tokens were in their
 * wallet the whole time (this app never custodies anything), but the only
 * place that said so was the Wallet tab, three taps away, and even there the
 * list was display-only. The three questions that kept arriving were «چی
 * خریدم؟», «کجاست؟», «چطور بفروشم؟». This card answers all three on the page
 * where the purchase was made.
 *
 * ─── WHAT IT READS ───────────────────────────────────────────────────────────
 * The chain, through the same readSolanaPortfolio() the wallet screen uses:
 * SOL balance + every SPL token account, then joined BY MINT to the curated
 * equity and gold lists (lib/solanaSell.js). Nothing local, nothing cached:
 * a swap history entry says an order was SENT, a token account says it
 * LANDED, and only the second one is an answer to «چی خریدم؟».
 *
 * ─── THE THREE HONEST STATES ─────────────────────────────────────────────────
 *   no wallet   → says where purchases go and offers to connect (and return)
 *   read failed → says the read failed, with the RPC reason and a retry.
 *                 NEVER an empty list: «شما هیچ سهمی ندارید» after a failed
 *                 read is a lie that would make someone think a buy was lost.
 *   read ok     → the rows, or «هنوز سهمی نیست» when there really are none
 *
 * The dollar value is amount × the row's spot price and is marked ≈; when
 * any row has no price the total is withheld rather than shown too small.
 */

/**
 * The read itself, as a hook, so the page can also hand each EquityRow its
 * own holding (the «در کیف پول شما» line and the Sell button on the row).
 *
 * @param {string|null} address  the connected Solana wallet, or null
 * @param {Array<object>} priced  the page's listed assets with live prices
 */
export function useSolanaEquityHoldings(address, priced) {
  const [state, setState] = useState({ status: 'idle', code: null, holdings: null, partial: false, updatedAt: null });
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!address) {
      seq.current += 1;
      setState({ status: 'idle', code: null, holdings: null, partial: false, updatedAt: null });
      return;
    }
    const my = ++seq.current;
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const res = await readSolanaPortfolio(address);
      if (my !== seq.current) return;
      if (!res?.ok) {
        setState({ status: 'error', code: res?.code || 'RPC_UNAVAILABLE', holdings: null, partial: false, updatedAt: Date.now() });
        return;
      }
      setState({ status: 'ok', code: null, holdings: res.holdings || [], partial: Boolean(res.partial), updatedAt: Date.now() });
    } catch {
      if (my === seq.current) {
        setState({ status: 'error', code: 'RPC_UNAVAILABLE', holdings: null, partial: false, updatedAt: Date.now() });
      }
    }
  }, [address]);

  useEffect(() => { refresh(); }, [refresh]);

  /*
   * Re-read when the app comes back to the foreground. On a phone the swap is
   * signed in the wallet app; the user returns here expecting the new balance,
   * and a list that still shows the old one reads as a failed order.
   */
  useEffect(() => {
    if (!address || typeof document === 'undefined') return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [address, refresh]);

  const rows = useMemo(() => joinEquityHoldings(state.holdings, priced), [state.holdings, priced]);
  const byMint = useMemo(() => new Map(rows.map((r) => [r.mint, r])), [rows]);
  const totalUsd = useMemo(() => holdingsTotalUsd(rows), [rows]);

  return { ...state, rows, byMint, totalUsd, refresh };
}

const riseIn = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } };

/**
 * @param {object} props
 * @param {string|null} props.address
 * @param {ReturnType<typeof useSolanaEquityHoldings>} props.held
 * @param {(asset:object)=>void} props.onSell
 * @param {()=>void} props.onOpenWallet   opens the Solana wallet tab (connect, or see everything)
 */
export default function EquityHoldings({ address, held, onSell, onOpenWallet }) {
  const { t } = useTranslation();
  const { status, code, rows, totalUsd, partial, updatedAt, refresh } = held;
  /* `idle` with an address is the frame before the first read starts — show
     the placeholders, not an empty card that then jumps. */
  const loading = status === 'loading' || (Boolean(address) && status === 'idle');
  const showRows = rows.length > 0;

  return (
    <motion.section
      className={`card eqh ${showRows ? 'has-rows' : ''}`}
      variants={riseIn}
      initial="hidden"
      animate="show"
      data-testid="equity-holdings"
      data-state={address ? status : 'disconnected'}
    >
      <div className="eqh-head">
        <div className="eqh-title-wrap">
          <span className={`eqh-dot ${address && status === 'ok' ? 'is-live' : ''}`} aria-hidden="true" />
          <p className="section-label eqh-title">{t('stocks.held.title')}</p>
          {showRows && (
            <span className="pill pill-neutral eqh-count">{t('stocks.held.count', { count: rows.length })}</span>
          )}
        </div>
        {address && (
          <div className="eqh-tools">
            <button type="button" className="eqh-chip mono" onClick={onOpenWallet} title={address}>
              <IconWallet width={13} height={13} />
              <span dir="ltr">{shortAddress(address, 4)}</span>
            </button>
            <button
              type="button"
              className={`eqh-refresh ${loading ? 'is-busy' : ''}`}
              onClick={refresh}
              disabled={loading}
              aria-label={t('common.refresh')}
              title={t('common.refresh')}
            >
              <IconRefresh width={15} height={15} />
            </button>
          </div>
        )}
      </div>

      {/* ── no wallet: say where purchases go, offer the way in ── */}
      {!address && (
        <div className="eqh-empty">
          <p className="muted eqh-empty-text">{t('stocks.held.connectBody')}</p>
          <button type="button" className="btn btn-ghost btn-sm eqh-connect" onClick={onOpenWallet}>
            <IconWallet width={15} height={15} />
            <span>{t('stocks.held.connectCta')}</span>
          </button>
        </div>
      )}

      {/* ── first read in flight: shaped placeholders, never a false «0» ── */}
      {address && loading && !showRows && (
        <div className="eqh-list" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="skel eqh-skel" style={{ animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
      )}

      {/* ── read failed: the reason and a retry, in place of a list ── */}
      {address && status === 'error' && (
        <div className="eqh-empty">
          <p className="notice notice-danger eqh-notice">
            {t('stocks.held.readFailed')} {t(`solana.err.${code}`, t('solana.err.RPC_UNAVAILABLE'))}
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>{t('common.retry')}</button>
        </div>
      )}

      {/* ── read ok, nothing held ── */}
      {address && status === 'ok' && !showRows && (
        <p className="muted eqh-empty-text">{t('stocks.held.none')}</p>
      )}

      {/* ── the holdings ── */}
      {showRows && (
        <ul className="eqh-list">
          {rows.map((r) => (
            <li key={r.mint} className="eqh-row">
              <TokenIcon token={r.asset} size={36} />
              <div className="eqh-main">
                <strong className="eqh-name">{r.name}</strong>
                <small className="faint mono eqh-sub">
                  {r.symbol}
                  {r.usdPrice != null && <span className="eqh-sub-price"> · ${fmtPrice(r.usdPrice)}</span>}
                </small>
              </div>
              <div className="eqh-amt">
                <span className="mono eqh-qty">{fmtQty(r.amount)} <span className="faint">{r.symbol}</span></span>
                <small className="faint mono eqh-usd">{r.usdValue != null ? `≈ ${fmtUsd(r.usdValue)}` : t('stocks.held.noPrice')}</small>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm eqh-sell"
                data-testid="eqh-sell"
                aria-label={`${t('trade.sell')} ${r.symbol}`}
                onClick={() => onSell(r.asset)}
              >
                <IconArrowUpRight width={14} height={14} />
                <span>{t('trade.sell')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {showRows && (
        <div className="eqh-foot">
          <span className="faint">{t('stocks.held.total')}</span>
          <strong className="mono eqh-total">{totalUsd != null ? `≈ ${fmtUsd(totalUsd)}` : '—'}</strong>
        </div>
      )}

      {address && partial && status === 'ok' && (
        <p className="faint eqh-note">{t('solana.wallet.partial')}</p>
      )}

      {/* ── the trust line: custody and the way out, stated once ── */}
      {address && status !== 'error' && (
        <p className="faint eqh-trust">
          {t('stocks.held.trust')}
          {updatedAt && status === 'ok' ? <span className="mono eqh-stamp"> · {t('stocks.held.readAt', { time: fmtTime(updatedAt) })}</span> : null}
        </p>
      )}
    </motion.section>
  );
}
