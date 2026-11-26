import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import qrcode from 'qrcode-generator';
import Sheet from './Sheet';
import { useStill } from './AnimatedIcon';
import { IconBitcoin } from './WalletArt';
import { IconCheck, IconCopy, IconPlus, IconRefresh, IconX } from './Icons';
import { btcAddressInfo } from '../lib/btcAddress';
import { getBtcAddressInfo } from '../lib/btcApi';
import { getThorQuote, toThorUnits } from '../lib/thorswap';
import { DUST_SATS } from '../lib/btcTx';
import { addWatch, loadWatch, removeWatch, saveWatch, MAX_WATCH, MAX_LABEL } from '../lib/btcWatch';
import { useBtcHolding } from '../hooks/useBtcHolding';
import { useAppStore } from '../store/useAppStore';
import { fmtNum, fmtQty } from '../lib/format';
import BtcSendSheet from './BtcSendSheet';
import BtcReceiveSheet from './BtcReceiveSheet';
import '../styles/wallet-command.css';

/**
 * THE BITCOIN POPUP — the ONLY doorway to the wallet's bitcoin leg.
 * ---------------------------------------------------------------------------
 * The static card at the bottom of the wallet page is gone. Everything a real
 * bitcoin wallet has to do now happens in this sheet:
 *
 *  1. OWN WALLET — the m/84' address of the unlocked local vault, its live
 *     balance, a receive QR, a real signed SEND (BtcSendSheet), and the THOR-
 *     Chain BTC → BTCB route into the EVM leg.
 *
 *  2. WATCH-ONLY addresses — public addresses held elsewhere, showing balance
 *     and UTXO count and nothing more. They are never spendable from here.
 *
 * The own-wallet read comes from useBtcHolding, the SAME hook the wallet's
 * asset row uses. One derivation, one /api/btc/address read, one truth.
 *
 * Keys are still never held by THIS component: the send sheet takes an
 * in-memory signer from the unlocked vault, signs, broadcasts and drops the
 * reference. The lock state is passed IN by the Wallet page, so a locked user
 * gets a sentence rather than an empty balance.
 *
 * ─── NETWORK DISCIPLINE (the BtcCard pattern) ───────────────────────────────
 * Balances are fetched only while the sheet is OPEN, once per open plus an
 * explicit refresh. Each pass is guarded by an `alive` flag and a monotonic
 * sequence, so closing the sheet or refreshing again discards everything in
 * flight and nothing sets state after unmount. Requests are issued one at a
 * time with a small gap: five parallel hits on the same rate-limited proxy is
 * how a user gets a 429 for a screen they only glanced at.
 */

const FETCH_GAP_MS = 120;

export default function BtcHubSheet({ open, onClose, vaultState = 'none', getSigner = null, account = null, refreshKey = 0 }) {
  const { t } = useTranslation();
  const still = useStill();
  const notify = useAppStore((st) => st.notify);
  const unlocked = vaultState === 'unlocked';

  /* Shared with the wallet's BTC asset row — no second derivation, no second
     upstream read when the popup opens. */
  const holding = useBtcHolding({ enabled: open && unlocked, getSigner, account, refreshKey });
  const address = holding.address;
  const sats = (v) => (typeof v === 'number' ? fmtNum(v, 0) : '—');
  const confirmed = holding.balance?.confirmedSats ?? 0;
  const convertible = confirmed > DUST_SATS;

  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendPrefill, setSendPrefill] = useState(null);
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertError, setConvertError] = useState(null);

  /* The receive QR is built from the derived address only while the sheet is
     open. The same encoder and quiet-zone as ReceiveSheet/BtcCard: an SVG path
     that stays sharp on a phone and carries no remote asset. */
  const qrPath = useMemo(() => {
    if (!open || !address) return null;
    try {
      const q = qrcode(0, 'M');
      q.addData(address);
      q.make();
      const count = q.getModuleCount();
      let d = '';
      for (let r = 0; r < count; r += 1) {
        for (let c = 0; c < count; c += 1) {
          if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
        }
      }
      return { d, count };
    } catch {
      return null;
    }
  }, [open, address]);

  const copy = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      notify('addressCopied', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify('copyFailed', 'error');
    }
  }, [address, notify]);

  /* BTC → BTCB stays the honest next step for money that is ALREADY bitcoin:
     the THORChain quote supplies the inbound address and OP_RETURN memo, and
     BtcSendSheet signs the exact sweep. No swap-route cannibalisation. */
  const convert = async () => {
    if (convertBusy || !convertible || !address || !account) return;
    setConvertBusy(true);
    setConvertError(null);
    try {
      const feeReserve = Math.ceil(251 * Number(holding.fees?.normal ?? 12));
      const amountBtc = Math.max(0, (confirmed - feeReserve) / 1e8);
      const amount = toThorUnits(amountBtc.toFixed(8));
      if (!amount || Number(amount) <= 0) throw new Error('AMOUNT_TOO_SMALL');
      const quote = await getThorQuote({
        from: 'BTC.BTC',
        to: 'BSC.BTCB-1DE',
        amount,
        destination: account
      });
      if (!quote?.inbound_address || !quote?.memo) throw new Error('QUOTE_INCOMPLETE');
      setSendPrefill({
        recipient: String(quote.inbound_address).trim(),
        memo: String(quote.memo).trim(),
        thor: { out: quote.expected_amount_out ?? null, dest: account }
      });
      setSendOpen(true);
    } catch (err) {
      setConvertError(err?.message || 'QUOTE_FAILED');
    } finally {
      setConvertBusy(false);
    }
  };

  const [list, setList] = useState([]);
  const [balances, setBalances] = useState({}); /* address -> {sats, utxos} | {failed:true} */
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const [adding, setAdding] = useState(false);
  const [draftAddr, setDraftAddr] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [addError, setAddError] = useState(null);

  const seqRef = useRef(0);

  /* Load from storage on every open, not once on mount: the sheet outlives a
     single open and storage can change from another tab. */
  useEffect(() => {
    if (!open) return;
    setList(loadWatch());
    setAdding(false);
    setDraftAddr('');
    setDraftLabel('');
    setAddError(null);
  }, [open]);

  const addresses = useMemo(() => list.map((e) => e.address), [list]);
  /* A stable primitive so the effect below does not re-run on every render
     just because `addresses` is a fresh array each time. */
  const addressKey = addresses.join(',');

  useEffect(() => {
    if (!open || !addressKey) { setLoading(false); return undefined; }
    let alive = true;
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    setLoading(true);

    (async () => {
      for (const addr of addressKey.split(',')) {
        if (!alive || seqRef.current !== seq) return;
        try {
          const info = await getBtcAddressInfo(addr);
          if (!alive || seqRef.current !== seq) return;
          setBalances((b) => ({
            ...b,
            [addr]: {
              sats: Number(info?.confirmedSats ?? 0),
              unconfirmed: Number(info?.unconfirmedSats ?? 0),
              utxos: Array.isArray(info?.utxos) ? info.utxos.length : 0
            }
          }));
        } catch {
          if (!alive || seqRef.current !== seq) return;
          /* Explicit failure per row. A blank cell would read as "zero", and
             telling someone they hold nothing when the explorer is simply down
             is the worst lie this screen could tell. */
          setBalances((b) => ({ ...b, [addr]: { failed: true } }));
        }
        /* Spread the burst — see the header note on the shared proxy budget. */
        await new Promise((r) => { setTimeout(r, FETCH_GAP_MS); });
      }
      if (alive && seqRef.current === seq) setLoading(false);
    })();

    return () => {
      alive = false;
      setLoading(false);
    };
  }, [open, addressKey, tick]);

  const draftInfo = useMemo(
    () => (draftAddr.trim() ? btcAddressInfo(draftAddr.trim()) : null),
    [draftAddr]
  );

  const commitAdd = useCallback(() => {
    const res = addWatch(list, draftAddr, draftLabel);
    if (!res.ok) { setAddError(res.code); return; }
    setAddError(null);
    setList(saveWatch(res.list));
    setDraftAddr('');
    setDraftLabel('');
    setAdding(false);
  }, [list, draftAddr, draftLabel]);

  const drop = useCallback((address) => {
    setList((cur) => saveWatch(removeWatch(cur, address)));
    setBalances((b) => {
      const next = { ...b };
      delete next[address];
      return next;
    });
  }, []);

  const rise = still
    ? { hidden: {}, show: {} }
    : { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } } };

  const short = (a) => (a.length > 22 ? `${a.slice(0, 12)}…${a.slice(-8)}` : a);

  return (
    <>
    <Sheet open={open} onClose={onClose} title={t('btc.hub.title')} anchor="center" size="lg">
      <div className="stack" style={{ gap: 14 }}>
        {/* ------------------------- this app's wallet ------------------------ */}
        <motion.div variants={rise} initial="hidden" animate="show">
          <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <span
              aria-hidden="true"
              style={{
                width: 34, height: 34, borderRadius: 11, display: 'grid', placeItems: 'center',
                color: '#fff', background: 'linear-gradient(135deg, #f7931a 0%, #ffb300 100%)'
              }}
            >
              <IconBitcoin width={19} height={19} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 13, display: 'block' }}>{t('btc.hub.ownTitle')}</strong>
              <small className="faint" style={{ fontSize: 10.5, lineHeight: 1.6 }}>{t('btc.hub.ownSub')}</small>
            </span>
          </div>

          {unlocked ? (
            <>
              <div className="row-between" style={{ alignItems: 'flex-end', gap: 8 }}>
                <div>
                  <div className="mono" style={{ fontSize: 18, fontWeight: 800 }}>
                    {holding.balance ? `${fmtQty(confirmed / 1e8)} BTC` : (holding.loading ? '…' : '—')}
                  </div>
                  <div className="faint mono" style={{ fontSize: 10.5 }}>
                    {holding.balance ? `${sats(confirmed)} sats` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ borderRadius: 12 }}
                  onClick={() => void holding.refresh()}
                  aria-label={t('common.refresh')}
                >
                  <IconRefresh width={13} height={13} />
                </button>
              </div>

              {holding.balance?.unconfirmedSats > 0 ? (
                <p className="notice" style={{ margin: '8px 0 0', fontSize: 11 }}>
                  {t('btc.card.incoming', { sats: sats(holding.balance.unconfirmedSats) })}
                </p>
              ) : null}

              {address ? (
                <div className="row" style={{ gap: 10, marginTop: 10, alignItems: 'center' }}>
                  {qrPath && (
                    <div style={{ flexShrink: 0, width: 66, height: 66, padding: 4, background: '#fff', borderRadius: 10 }}>
                      <svg viewBox={`0 0 ${qrPath.count} ${qrPath.count}`} width="100%" height="100%" shapeRendering="crispEdges" role="img" aria-label={t('btc.card.title')}>
                        <path d={qrPath.d} fill="#000" />
                      </svg>
                    </div>
                  )}
                  <div className="mono" dir="ltr" style={{ flex: 1, fontSize: 10.5, wordBreak: 'break-all', lineHeight: 1.7 }}>
                    {(address.match(/.{1,4}/g) ?? []).join(' ')}
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ borderRadius: 12 }} onClick={copy} aria-label={t('btc.card.copy')}>
                    {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
                  </button>
                </div>
              ) : (
                <p className="faint" style={{ fontSize: 11.5, margin: '8px 0 0' }}>
                  {holding.error ? t(`btc.card.err.${holding.error}`, { defaultValue: t('btc.card.note') }) : '…'}
                </p>
              )}

              {/* The two doors the wallet page's bitcoin action needs: each
                  opens its own popup, so the hub stays a hub. */}
              <div className="wallet-action-row btc-hub-actions" style={{ gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  className="wallet-action-btn btc-hub-action btc-hub-action-send"
                  onClick={() => { setSendPrefill(null); setSendOpen(true); }}
                >
                  <span aria-hidden="true">↗</span>
                  {t('btc.card.send')}
                </button>
                <button
                  type="button"
                  className="wallet-action-btn btc-hub-action btc-hub-action-recv"
                  onClick={() => setReceiveOpen(true)}
                >
                  <span aria-hidden="true">↙</span>
                  {t('wnew.btcReceive')}
                </button>
              </div>

              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                {convertible ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1.3, minHeight: 44, borderRadius: 13 }}
                    disabled={convertBusy}
                    onClick={convert}
                  >
                    {convertBusy ? t('btc.card.converting') : t('btc.card.convert')}
                  </button>
                ) : null}
              </div>

              {convertError ? (
                <p className="notice notice-danger" role="alert" style={{ margin: '10px 0 0', fontSize: 11.5 }}>
                  {t(`btc.card.err.${convertError}`, { defaultValue: t('btc.card.err.QUOTE_FAILED') })}
                </p>
              ) : (
                <p className="faint" style={{ margin: '8px 0 0', fontSize: 10.5, lineHeight: 1.7 }}>
                  {t(convertible ? 'btc.card.convertNote' : 'btc.card.note')}
                </p>
              )}
            </>
          ) : (
            <p className="notice" style={{ margin: 0, fontSize: 11.5 }}>
              {vaultState === 'locked' ? t('btc.hub.locked') : t('btc.hub.noVault')}
            </p>
          )}
        </motion.div>

        <div className="xfer-summary-divider" style={{ margin: '2px 0' }} />

        {/* -------------------------- watch-only list ------------------------- */}
        <motion.div variants={rise} initial="hidden" animate="show">
          <div className="row-between" style={{ marginBottom: 6 }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 13, display: 'block' }}>{t('btc.watch.title')}</strong>
              <small className="faint" style={{ fontSize: 10.5, lineHeight: 1.6 }}>
                {t('btc.watch.count', { n: list.length, max: MAX_WATCH })}
              </small>
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ borderRadius: 12 }}
              onClick={() => setTick((n) => n + 1)}
              disabled={loading || list.length === 0}
              aria-label={t('btc.watch.refresh')}
            >
              <IconRefresh width={13} height={13} />
            </button>
          </div>

          {/*
            THE LABEL THAT MAKES THIS SAFE. It is not a footnote and it is not
            behind a tooltip: an address list inside a wallet app looks
            spendable, and the only thing preventing that misread is this
            sentence sitting directly above the rows.
          */}
          <p className="notice" style={{ margin: '0 0 10px', fontSize: 11 }}>{t('btc.watch.viewOnly')}</p>

          {list.length === 0 ? (
            <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.75, margin: '0 0 10px' }}>
              {t('btc.watch.empty')}
            </p>
          ) : (
            <div className="stack" style={{ gap: 8 }} role="list">
              {list.map((e) => {
                const b = balances[e.address];
                return (
                  <div
                    key={e.address}
                    role="listitem"
                    className="card card-tight"
                    style={{ padding: '10px 12px', borderRadius: 13, minHeight: 58, display: 'flex', alignItems: 'center', gap: 10 }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <strong
                        style={{
                          fontSize: 12.5, display: 'block',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                        }}
                      >
                        {e.label || t('btc.watch.unnamed')}
                      </strong>
                      {/* dir=ltr so an RTL layout cannot visually reorder bech32. */}
                      <small
                        className="faint mono"
                        dir="ltr"
                        style={{ fontSize: 10, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {short(e.address)}
                      </small>
                    </span>

                    <span style={{ textAlign: 'end', flexShrink: 0 }}>
                      {b == null ? (
                        <span className="skel" style={{ display: 'block', width: 74, height: 15, borderRadius: 7 }} aria-hidden="true" />
                      ) : b.failed ? (
                        <small className="faint" style={{ fontSize: 10.5 }}>{t('btc.watch.failed')}</small>
                      ) : (
                        <>
                          <div className="mono" style={{ fontSize: 12.5, fontWeight: 800 }}>
                            {fmtQty(b.sats / 1e8)} BTC
                          </div>
                          <small className="faint mono" style={{ fontSize: 10 }}>
                            {t('btc.watch.utxos', { n: fmtNum(b.utxos, 0) })}
                          </small>
                        </>
                      )}
                    </span>

                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ borderRadius: 11, flexShrink: 0 }}
                      onClick={() => drop(e.address)}
                      aria-label={t('btc.watch.remove')}
                    >
                      <IconX width={13} height={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ------------------------------ add form --------------------------- */}
          {adding ? (
            <div className="stack" style={{ gap: 8, marginTop: 10 }}>
              <label className="field-label" htmlFor="btc-watch-addr">{t('btc.watch.addressLabel')}</label>
              <input
                id="btc-watch-addr"
                dir="ltr"
                autoComplete="off"
                spellCheck="false"
                className={`mono ${draftInfo ? (draftInfo.valid ? 'p2pm-addr-ok' : 'p2pm-addr-bad') : ''}`}
                placeholder="bc1q…"
                aria-invalid={Boolean(draftInfo && !draftInfo.valid)}
                value={draftAddr}
                onChange={(ev) => { setDraftAddr(ev.target.value.trim()); setAddError(null); }}
              />

              <label className="field-label" htmlFor="btc-watch-label">{t('btc.watch.nameLabel')}</label>
              <input
                id="btc-watch-label"
                autoComplete="off"
                maxLength={MAX_LABEL}
                placeholder={t('btc.watch.namePlaceholder')}
                value={draftLabel}
                onChange={(ev) => setDraftLabel(ev.target.value)}
              />

              {addError && (
                <p className="notice notice-danger" role="alert" style={{ margin: 0, fontSize: 11.5 }}>
                  {t(`btc.watch.err.${addError}`)}
                </p>
              )}

              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1, minHeight: 44, borderRadius: 13 }}
                  onClick={() => { setAdding(false); setAddError(null); setDraftAddr(''); setDraftLabel(''); }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ flex: 1.3, minHeight: 44, borderRadius: 13, gap: 7 }}
                  disabled={!draftInfo?.valid}
                  onClick={commitAdd}
                >
                  <IconCheck width={15} height={15} />
                  {t('btc.watch.save')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', minHeight: 44, borderRadius: 13, marginTop: 10, gap: 7 }}
              disabled={list.length >= MAX_WATCH}
              onClick={() => setAdding(true)}
            >
              <IconPlus width={15} height={15} />
              {list.length >= MAX_WATCH ? t('btc.watch.err.FULL') : t('btc.watch.add')}
            </button>
          )}

          <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.75, margin: '10px 0 0' }}>
            {t('btc.watch.note')}
          </p>
        </motion.div>
      </div>
    </Sheet>
    <BtcSendSheet
      open={sendOpen}
      onClose={() => { setSendOpen(false); setSendPrefill(null); setConvertError(null); }}
      prefill={sendPrefill}
    />
    <BtcReceiveSheet
      open={receiveOpen}
      onClose={() => setReceiveOpen(false)}
      address={address}
      loading={holding.loading}
      error={holding.error}
    />
    </>
  );
}
