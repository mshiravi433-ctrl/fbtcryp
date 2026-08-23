import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { useStill } from './AnimatedIcon';
import { IconBitcoin } from './WalletArt';
import { IconCheck, IconChevronRight, IconPlus, IconRefresh, IconX } from './Icons';
import { btcAddressInfo } from '../lib/btcAddress';
import { getBtcAddressInfo } from '../lib/btcApi';
import { addWatch, loadWatch, removeWatch, saveWatch, MAX_WATCH, MAX_LABEL } from '../lib/btcWatch';
import { fmtNum, fmtQty } from '../lib/format';

/**
 * THE BITCOIN POPUP — the wallet action row's bitcoin doorway.
 * ---------------------------------------------------------------------------
 * Two things live here, and they are deliberately the only two:
 *
 *  1. A POINTER to this wallet's own bitcoin card, which is further down the
 *     same page. Not a copy of it — a copy would mount a second BtcCard and
 *     double every balance request for a card the user can already see.
 *
 *  2. WATCH-ONLY addresses: public bitcoin addresses the user holds somewhere
 *     else, showing balance and UTXO count and nothing more.
 *
 * ─── WHY THIS COMPONENT KNOWS NOTHING ABOUT KEYS ────────────────────────────
 * It imports lib/btcWatch (labels + addresses), lib/btcAddress (the shared
 * mainnet validator) and lib/btcApi (our own read-only proxy). It does NOT
 * import lib/btcWallet or lib/btcTx, and it cannot: there is no spend path
 * through this screen, so the derivation and signing code has no reason to be
 * in this chunk and the import-graph rule in the wiring suite keeps it out.
 *
 * The lock state is passed IN as a prop by the Wallet page, which already has
 * the wallet context, rather than derived here — that is what lets this file
 * stay free of the bitcoin wallet module while still telling a locked user the
 * truth.
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

export default function BtcHubSheet({ open, onClose, vaultState = 'none', onOpenCard }) {
  const { t } = useTranslation();
  const still = useStill();

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
    <Sheet open={open} onClose={onClose} title={t('btc.hub.title')} anchor="bottom" size="lg">
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

          {vaultState === 'unlocked' ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', minHeight: 46, borderRadius: 14, gap: 8 }}
              onClick={() => { onClose?.(); onOpenCard?.(); }}
            >
              {t('btc.hub.openCard')}
              <IconChevronRight width={15} height={15} />
            </button>
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
  );
}
