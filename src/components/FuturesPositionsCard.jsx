import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useSolanaWallet } from '../hooks/useSolanaWallet';
import { useTelegram } from '../context/TelegramContext';
import { fmtPrice, fmtUsd } from '../lib/format';
import {
  getFuturesMarkets,
  getFuturesPositions,
  manageFuturesPosition,
  verifyFutures
} from '../lib/futuresClient';

/**
 * OPEN FUTURES POSITIONS — the screen the user could never find.
 * ===========================================================================
 *
 *   «وقتی کاربر پوزیشن باز می‌کند، هیچ جا نشون نمی‌ده که پوزیشن باز داره،
 *    نفروشه، ببندش، یا خارج بشه.»
 *
 * That report is about the Perpetual tab, and it was literally true: the tab
 * lets you open a position, the sheet closes, and the position exists only on
 * the venue afterwards. Nothing on this page said so, nothing listed it, and
 * there was no way to close it from the app it was opened in. A user who
 * opened a leveraged position and could not find it is a user who assumes the
 * position is gone — until a liquidation notice arrives.
 *
 * ─── WHY THIS IS ONE CARD AND NOT THREE ────────────────────────────────────
 * The three tabs route to three venues (Velocity on Solana, Ostium on
 * Arbitrum, dYdX), and this card does not care which one a position belongs
 * to: it reads BOTH wallet families the user has connected and merges the
 * results into one list, in one place, with the same exit affordance on every
 * row. A user should not have to remember which venue they tapped through —
 * that is our bookkeeping, not their problem.
 *
 * dYdX positions are the one family this card does not read: that venue's
 * positions live behind a derived session key rather than a wallet address, and
 * its tab already lists them. The close button there was added separately.
 *
 * ─── NOTHING IS EVER HELD, AND THE CLOSE IS STILL SIGNED BY THE USER ───────
 * The close path is the same one the on-chain tab uses, and it differs by
 * family in exactly one way:
 *
 *   Solana  — the reduce-only close is BUILT IN THE TAB by the venue SDK and
 *             signed by the user's Solana wallet (server cannot decode the
 *             account; see lib/velocityTrade.js).
 *   EVM     — the close calldata is built by our BFF as an UNSIGNED
 *             transaction and signed by the user's EVM wallet.
 *
 * Both report the hash to /verify before the UI claims anything, and both are
 * *reduce-only* on the venue side: a close can only ever shrink a position,
 * never flip it. That is a property of the venue call, not a promise here.
 *
 * ─── WHY THE PARTIAL CHIPS EXIST AT ALL ────────────────────────────────────
 * "Close" being all-or-nothing is how a user who wanted to take half off ends
 * up with nothing on. 25/50/100 are one tap each, the percentage is stated on
 * the confirm line, and 100% cancels the resting TP/SL on the Solana venue so
 * a closed position cannot be re-opened by a stale trigger.
 */
const CLOSE_STEPS = [25, 50, 100];

export default function FuturesPositionsCard() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const solWallet = useSolanaWallet();
  const { haptic } = useTelegram();

  const solAddress = solWallet?.address ?? null;
  const evmAddress = wallet?.address ?? null;

  const [rows, setRows] = useState([]);
  /* `null` = still reading. Distinguishes "no positions" from "not asked yet",
     which matters because the empty state is an assurance and must not be
     shown before the read has actually happened. */
  const [live, setLive] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { row, pct }
  const [error, setError] = useState(null);
  const [lastTx, setLastTx] = useState(null);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  /**
   * Read both families. A venue that fails reports `live: false` for its own
   * half rather than emptying the other, so a Solana outage can never make an
   * Arbitrum position disappear from the screen.
   */
  const refresh = useCallback(async () => {
    const out = [];
    let anyLive = false;

    if (solAddress) {
      try {
        const { getVelocityPositions } = await import('../lib/velocityTrade.js');
        const [result, markets] = await Promise.all([
          getVelocityPositions({ wallet: solAddress }),
          getFuturesMarkets('drift')
        ]);
        const venueRows = Array.isArray(result) ? result : (result?.positions || []);
        const byIndex = new Map((markets?.ok ? markets.data.markets : []).map((m) => [Number(m.marketId), m]));
        for (const r of venueRows) {
          /*
           * ─── THE SCALING IS NOT COSMETIC ──────────────────────────────────
           * The venue returns both sides of a position as RAW integers, and
           * they are not the same precision: the base amount is in 1e9 base
           * precision (see openVelocityPosition — `notional / price * 1e9`)
           * and the quote side is USDT at 1e6. Printing either one unscaled
           * next to a dollar sign is a wrong number about money — my first
           * version of this row showed a 0.05 BTC position as $65,000,000.
           */
          const rawBase = Number(r.baseAssetAmount) || 0;
          /* A row with a zero size and no resting order is a closed market
             account, not a position. Listing it would invent one. */
          if (rawBase === 0 && !(Number(r.openOrders) > 0)) continue;
          const mk = byIndex.get(Number(r.marketIndex));
          const mid = Number(mk?.mid) > 0 ? Number(mk.mid) : null;
          const baseSize = Math.abs(rawBase) / 1e9;
          /* Quote-denominated value as the venue booked it, for the case where
             the market feed has no mid for this index — still the venue's
             number, just an older one. Null only when neither exists. */
          const quoteUsd = Math.abs(Number(r.quoteAssetAmount) || 0) / 1e6;
          out.push({
            key: `drift:${r.marketIndex}:0`,
            positionId: `drift:${r.marketIndex}:0`,
            provider: 'drift',
            family: 'solana',
            marketIndex: Number(r.marketIndex),
            symbol: mk?.symbol || `MKT-${r.marketIndex}/USDT`,
            side: rawBase >= 0 ? 'long' : 'short',
            baseSize,
            notionalUsd: mid ? baseSize * mid : (quoteUsd > 0 ? quoteUsd : null),
            entryPrice: mid,
            markPrice: mid,
            collateralUsd: quoteUsd > 0 ? quoteUsd : null,
            takeProfit: r.takeProfit ?? null,
            stopLoss: r.stopLoss ?? null,
            pnlUsd: null
          });
        }
        anyLive = true;
      } catch { /* Solana read failed — the EVM half still reports */ }
    }

    if (evmAddress) {
      try {
        const res = await getFuturesPositions(evmAddress, 'ostium');
        if (res?.ok && Array.isArray(res.data?.positions)) {
          for (const p of res.data.positions) {
            out.push({
              key: `ostium:${p.positionId}`,
              positionId: p.positionId,
              provider: 'ostium',
              family: 'evm',
              symbol: p.symbol,
              side: p.side,
              baseSize: Math.abs(Number(p.size) || 0),
              notionalUsd: Number(p.notionalUsd) > 0 ? Number(p.notionalUsd) : null,
              entryPrice: Number(p.entryPrice) || null,
              markPrice: Number(p.markPrice) || null,
              collateralUsd: Number(p.collateralUsd) || null,
              takeProfit: p.takeProfit ?? null,
              stopLoss: p.stopLoss ?? null,
              pnlUsd: Number.isFinite(Number(p.grossPnlUsd)) ? Number(p.grossPnlUsd) : null
            });
          }
          anyLive = true;
        } else if (res?.ok) {
          anyLive = true; // answered, just empty
        }
      } catch { /* same: one venue failing does not hide the other */ }
    }

    if (!aliveRef.current) return;
    setRows(out);
    setLive(anyLive);
  }, [solAddress, evmAddress]);

  useEffect(() => {
    setLive(null);
    refresh();
    /*
     * Positions move with the market, so this polls — but slowly. Ten seconds
     * is a screen a user is watching; this is a card at the foot of a pair
     * list, and polling it every second would buy nothing and cost a venue
     * read per second per open tab.
     */
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  /**
   * Close `pct`% of one position, with the user's own wallet.
   *
   * The order of operations is deliberate and matches the on-chain tab:
   *   1. record the intent with the BFF (an execution the ledger can verify);
   *   2. build + SIGN it with the user's wallet;
   *   3. report the hash to /verify.
   * A step-1 failure never blocks step 2 — a position the user has asked to
   * close must remain closable even if our ledger is unreachable.
   */
  const close = async (row, pct) => {
    if (busyId) return;
    setBusyId(row.key);
    setError(null);
    setLastTx(null);
    try {
      let executionId = null;
      try {
        const recorded = await manageFuturesPosition({
          positionId: row.positionId,
          action: 'close',
          wallet: row.family === 'solana' ? solAddress : evmAddress,
          provider: row.provider,
          closePercent: pct
        });
        if (recorded?.ok && recorded.data?.executionId) executionId = recorded.data.executionId;
      } catch { /* ledger record is best-effort by design */ }

      let hash = null;
      if (row.family === 'solana') {
        const { closeVelocityPosition } = await import('../lib/velocityTrade.js');
        const result = await closeVelocityPosition({
          wallet: solAddress,
          marketIndex: row.marketIndex,
          closePercent: pct
        });
        hash = result?.signature ?? null;
      } else {
        /* Same shape the on-chain tab uses: server-built unsigned calldata,
           signed on the venue's own chain by the user's wallet. */
        const signer = (await wallet.ensureSigner?.()) || wallet.getSigner?.();
        if (!signer) throw Object.assign(new Error('WALLET_NOT_CONNECTED'), { code: 'WALLET_NOT_CONNECTED' });
        const res = await manageFuturesPosition({
          positionId: row.positionId,
          action: 'close',
          wallet: evmAddress,
          provider: row.provider,
          closePercent: pct
        });
        if (!res?.ok) throw Object.assign(new Error(res?.error?.code || 'PROVIDER_UNAVAILABLE'), { code: res?.error?.code || 'PROVIDER_UNAVAILABLE' });
        executionId = res.data?.executionId ?? executionId;
        for (const tx of res.data?.transactions ?? []) {
          const sent = await signer.sendTransaction({ to: tx.to, data: tx.data });
          if (tx.kind === 'approve') { await sent.wait(); continue; }
          hash = sent.hash;
        }
      }

      if (!hash) throw Object.assign(new Error('BROADCAST_FAILED'), { code: 'BROADCAST_FAILED' });
      if (executionId) await verifyFutures({ executionId, txHash: hash }).catch(() => {});
      setLastTx(hash);
      setConfirm(null);
      haptic?.('success');
      /* Re-read rather than editing the row locally: the venue is the only
         thing that knows how much of the position is actually left, and a
         locally-decremented number would be a guess shown as a fact. */
      setTimeout(() => { refresh(); }, 1200);
    } catch (err) {
      const code = /reject|denied|cancel|4001/i.test(String(err?.message || '')) ? 'USER_REJECTED' : (err?.code || 'PROVIDER_UNAVAILABLE');
      setError(code);
      haptic?.('error');
    } finally {
      if (aliveRef.current) setBusyId(null);
    }
  };

  const totalPnl = useMemo(
    () => rows.reduce((sum, r) => sum + (Number.isFinite(r.pnlUsd) ? r.pnlUsd : 0), 0),
    [rows]
  );
  const hasPnl = useMemo(() => rows.some((r) => Number.isFinite(r.pnlUsd)), [rows]);

  /* Nothing connected means there is no account to read — the card is not
     rendered at all rather than shown empty (see the two callers). */
  const anyWallet = Boolean(solAddress || evmAddress);

  return (
    <section className="fut-pos" data-testid="futures-positions" data-live={live === null ? 'reading' : String(live)}>
      <div className="fut-pos-head">
        <span className="fut-pos-mark" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19V9" /><path d="M10 19V5" /><path d="M16 19v-6" /><path d="M22 19H2" />
          </svg>
        </span>
        <div className="fut-pos-title">
          <span>{t('perp.positions.title')}</span>
          <span className="fut-pos-sub">
            {rows.length > 0 ? t('perp.positions.count', { n: rows.length }) : t('perp.positions.sub')}
          </span>
        </div>
        {hasPnl && (
          <span className={`fut-pos-pnl ${totalPnl >= 0 ? 'up' : 'down'}`} data-testid="fut-pos-pnl">
            {totalPnl >= 0 ? '+' : '−'}{fmtUsd(Math.abs(totalPnl))}
          </span>
        )}
      </div>

      {live === null && (
        <p className="fut-pos-note faint">{t('perp.positions.reading')}</p>
      )}

      {live === false && rows.length === 0 && (
        <p className="fut-pos-note faint">{t('perp.positions.unavailable')}</p>
      )}

      {live !== null && rows.length === 0 && live !== false && (
        <p className="fut-pos-note faint" data-testid="fut-pos-empty">{t('perp.positions.empty')}</p>
      )}

      {rows.map((row) => (
        <div className="fut-pos-row" key={row.key} data-testid="fut-pos-row">
          <div className="fut-pos-row-top">
            <span className="fut-pos-sym">{row.symbol}</span>
            <span className={`pill ${row.side === 'long' ? 'pill-up' : 'pill-down'}`}>
              {t(row.side === 'long' ? 'perp.side.long' : 'perp.side.short')}
            </span>
            <span className="fut-pos-venue faint">
              {row.family === 'solana' ? t('perp.positions.venue.solana') : t('perp.positions.venue.evm')}
            </span>
          </div>

          <div className="fut-pos-stats">
            <span>
              <i className="faint">{t('perp.positions.entry')}</i>
              <b className="mono">{row.entryPrice ? `$${fmtPrice(row.entryPrice)}` : '—'}</b>
            </span>
            <span>
              <i className="faint">{t('perp.positions.mark')}</i>
              <b className="mono">{row.markPrice ? `$${fmtPrice(row.markPrice)}` : '—'}</b>
            </span>
            <span>
              <i className="faint">{t('perp.positions.size')}</i>
              <b className="mono">{row.notionalUsd ? fmtUsd(row.notionalUsd) : '—'}</b>
            </span>
            {Number.isFinite(row.pnlUsd) && (
              <span>
                <i className="faint">{t('perp.positions.pnl')}</i>
                <b className={`mono ${row.pnlUsd >= 0 ? 'up' : 'down'}`}>{row.pnlUsd >= 0 ? '+' : '−'}{fmtUsd(Math.abs(row.pnlUsd))}</b>
              </span>
            )}
            {(row.takeProfit || row.stopLoss) && (
              <span>
                <i className="faint">{t('perp.positions.risk')}</i>
                <b className="mono">
                  {row.takeProfit ? `TP $${fmtPrice(row.takeProfit)}` : ''}
                  {row.takeProfit && row.stopLoss ? ' · ' : ''}
                  {row.stopLoss ? `SL $${fmtPrice(row.stopLoss)}` : ''}
                </b>
              </span>
            )}
          </div>

          {confirm?.key === row.key ? (
            <div className="fut-pos-confirm" data-testid="fut-pos-confirm">
              <span className="fut-pos-confirm-q">{t('perp.positions.howMuch')}</span>
              <div className="fut-pos-steps">
                {CLOSE_STEPS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    className={`fut-pos-step ${confirm.pct === pct ? 'is-on' : ''}`}
                    onClick={() => setConfirm({ key: row.key, row, pct })}
                  >
                    {pct === 100 ? t('perp.positions.all') : `${pct}%`}
                  </button>
                ))}
              </div>
              <div className="fut-pos-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)} disabled={busyId === row.key}>
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => close(row, confirm.pct)}
                  disabled={busyId === row.key}
                  data-testid="fut-pos-confirm-close"
                >
                  {busyId === row.key ? t('perp.positions.closing') : t('perp.positions.confirm', { pct: confirm.pct })}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="fut-pos-close"
              onClick={() => { haptic?.('light'); setConfirm({ key: row.key, row, pct: 100 }); }}
              data-testid="fut-pos-close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
              {t('perp.positions.close')}
            </button>
          )}
        </div>
      ))}

      {error && (
        <p className="fut-pos-err" data-testid="fut-pos-error">
          {t(`perp.positions.err.${error}`, { defaultValue: t('perp.terminal.err.UNKNOWN') })}
        </p>
      )}
      {lastTx && (
        <p className="fut-pos-ok" data-testid="fut-pos-tx">
          {t('perp.positions.sent')}
          <span className="mono">{`${lastTx.slice(0, 6)}…${lastTx.slice(-6)}`}</span>
        </p>
      )}

      {!anyWallet && <p className="fut-pos-note faint">{t('perp.positions.noWallet')}</p>}

      {/* The wallets being read, so a position that is missing from this list
          is diagnosable at a glance (wrong wallet connected, not a bug). */}
      {(solAddress || evmAddress) && (
        <p className="fut-pos-wallets faint">
          {solAddress ? <span className="mono">{shortAddress(solAddress)}</span> : null}
          {solAddress && evmAddress ? ' · ' : ''}
          {evmAddress ? <span className="mono">{shortAddress(evmAddress)}</span> : null}
        </p>
      )}
    </section>
  );
}
