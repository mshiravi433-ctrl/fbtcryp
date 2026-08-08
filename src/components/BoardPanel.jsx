import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { riseIn, stagger } from './PageTransition';
import InfoBox from './InfoBox';
import { useWallet, shortAddress } from '../context/WalletContext';
import { claimPromotion, deleteListing, fetchBoard, payForPromotion, postListing } from '../lib/board';
import { useAppStore } from '../store/useAppStore';

/**
 * THE CLASSIFIEDS BOARD.
 *
 * ─── WHAT THIS IS, AND THE LINE IT DOES NOT CROSS ───────────────────────────
 * People post "I want to buy/sell X, here is how to reach me". They arrange
 * everything else between themselves. There is no escrow, no dispute button
 * and no fee on the transfer — see server/board.js for the FinCEN language
 * that boundary is drawn from. Crossing it would make us a money transmitter,
 * which is a licensing burden we cannot meet and, unlicensed in the US, a
 * felony.
 *
 * We earn two ways, both of them off the transfer:
 *   1. Pro promotion, $25, paid on-chain and verified on-chain.
 *   2. The swap either party needs anyway, at our normal 70 bps.
 *
 * ─── WHY THE WARNING IS ALWAYS OPEN ─────────────────────────────────────────
 * Every other InfoBox on this screen collapses. This one does not, because the
 * whole failure mode of a classifieds board is somebody believing a platform
 * stands behind the trade. If they read one thing, it must be that nobody is
 * holding the money.
 */

const EMPTY_FORM = {
  side: 'sell',
  asset: 'USDT',
  amount: '',
  price: '',
  method: '',
  city: '',
  contact: '',
  note: ''
};

/** One advert. */
function Row({ row, mine, onDelete, onSwap }) {
  const { t } = useTranslation();

  return (
    <motion.div
      variants={riseIn}
      className={`brd-row${row.promoted ? ' brd-row-promoted' : ''}`}
    >
      <div className="brd-head">
        <span className={`brd-side brd-side-${row.side}`}>{t(`board.side.${row.side}`)}</span>
        <span className="brd-asset">{row.asset}</span>
        {row.amount ? <span className="faint" style={{ fontSize: 12 }}>{row.amount}</span> : null}
        {row.promoted ? <span className="brd-star">★ {t('board.pro')}</span> : null}
      </div>

      <div className="brd-meta">
        {row.price ? <span>{t('board.price')}: <b>{row.price}</b></span> : null}
        {row.method ? <span>{t('board.method')}: <b>{row.method}</b></span> : null}
        {row.city ? <span>{t('board.city')}: <b>{row.city}</b></span> : null}
      </div>

      {row.note ? <p className="brd-note">{row.note}</p> : null}

      <div className="brd-foot">
        <span className="brd-contact">{row.contact}</span>
        {/*
          The swap button is the honest revenue line: whoever takes this trade
          usually needs the token on another chain, or needs it at all. It goes
          to our own swap screen, which already earns 70 bps.
        */}
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginInlineStart: 'auto', flexShrink: 0 }}
          onClick={onSwap}
        >
          {t('board.swapFor')}
        </button>
        {mine ? (
          <button className="btn btn-ghost btn-sm" style={{ flexShrink: 0 }} onClick={onDelete}>
            {t('board.remove')}
          </button>
        ) : null}
      </div>
    </motion.div>
  );
}

export default function BoardPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();
  const notify = useAppStore((s) => s.notify);

  const [state, setState] = useState({ rows: [], terms: null, live: true });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchBoard();
    setState(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await fetchBoard();
      if (!alive) return;
      setState(data);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const address = wallet?.address ?? null;

  /*
   * Case-insensitive: a wallet may report a checksummed address while the row
   * was stored from a lowercase one, and a mismatch would hide the user's own
   * delete button on their own listing.
   */
  const mine = useMemo(
    () => (address ? state.rows.find((r) => r.owner?.toLowerCase() === address.toLowerCase()) : null),
    [state.rows, address]
  );

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!address || busy) return;

    setBusy(true);
    try {
      await postListing({ ...form, owner: address });
      setForm(EMPTY_FORM);
      await load();
      notify?.('boardPosted', 'success');
    } catch (err) {
      /*
       * Server error codes are mapped to real sentences. Rendering BAD_CONTACT
       * to a user is the raw-key leak this project keeps auditing for.
       */
      const code = String(err?.message || '');
      const known = { BAD_ASSET: 'boardBadAsset', BAD_CONTACT: 'boardBadContact', BAD_SIDE: 'boardFailed', BAD_OWNER: 'boardFailed' };
      notify?.(known[code] ?? 'boardFailed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!address || busy) return;
    setBusy(true);
    try {
      await deleteListing(address);
      await load();
      notify?.('boardRemoved', 'info');
    } catch {
      notify?.('boardFailed', 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Pay $25 and claim the promotion. */
  const goPro = async () => {
    if (paying) return;
    if (!mine) {
      notify?.('boardNoListing', 'error');
      return;
    }

    setPaying(true);
    try {
      const paid = await payForPromotion({ terms: state.terms, wallet });
      if (!paid.ok) {
        /*
         * Mapped to toast keys rather than interpolated, so a reason we have
         * no wording for degrades to a real sentence instead of printing
         * "WRONG_CHAIN" at the user.
         */
        const said = {
          REJECTED: 'payRejected',
          INSUFFICIENT: 'payInsufficient',
          WRONG_CHAIN: 'payWrongChain',
          NO_SIGNER: 'payNoSigner',
          NOT_CONNECTED: 'payNoSigner'
        };
        notify?.(said[paid.reason] ?? 'payFailed', 'error');
        return;
      }

      /*
       * The money has left the wallet by this point. If the claim call fails
       * the user must NOT be told "payment failed" — they must be told the
       * payment went through and given the hash, so it can be claimed again
       * rather than paid twice.
       */
      try {
        await claimPromotion(address, paid.hash);
        await load();
        notify?.('boardProActive', 'success');
      } catch {
        notify?.('payClaimLater', 'info');
      }
    } finally {
      setPaying(false);
    }
  };

  const terms = state.terms;

  return (
    <>
      {/*
        Always open. See the note at the top of this file: on a board of
        strangers, "nobody is holding your money" is the one sentence that has
        to be read before anything else.
      */}
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <InfoBox title={t('board.safetyTitle')} tone="danger" defaultOpen id="board-safety">
          <p>{t('board.safetyBody')}</p>
        </InfoBox>
      </motion.div>

      {/* ---------------- post / edit ---------------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 2 }}>
          {mine ? t('board.editTitle') : t('board.postTitle')}
        </p>

        {!address ? (
          <>
            <p className="prose-sm" style={{ marginTop: 8 }}>{t('board.connectFirst')}</p>
            <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => navigate('/wallet')}>
              {t('wallet.connect')}
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="brd-form-grid">
              <div>
                <label className="brd-label" htmlFor="brd-side">{t('board.iWantTo')}</label>
                <select id="brd-side" value={form.side} onChange={set('side')}>
                  <option value="sell">{t('board.side.sell')}</option>
                  <option value="buy">{t('board.side.buy')}</option>
                </select>
              </div>
              <div>
                <label className="brd-label" htmlFor="brd-asset">{t('board.asset')}</label>
                <input id="brd-asset" value={form.asset} onChange={set('asset')} maxLength={12} placeholder="USDT" />
              </div>
              <div>
                <label className="brd-label" htmlFor="brd-amount">{t('board.amount')}</label>
                <input id="brd-amount" value={form.amount} onChange={set('amount')} maxLength={24} placeholder="500" />
              </div>
              <div>
                <label className="brd-label" htmlFor="brd-price">{t('board.price')}</label>
                <input id="brd-price" value={form.price} onChange={set('price')} maxLength={32} />
              </div>
              <div>
                <label className="brd-label" htmlFor="brd-method">{t('board.method')}</label>
                <input id="brd-method" value={form.method} onChange={set('method')} maxLength={28} />
              </div>
              <div>
                <label className="brd-label" htmlFor="brd-city">{t('board.city')}</label>
                <input id="brd-city" value={form.city} onChange={set('city')} maxLength={28} />
              </div>
              <div className="brd-wide">
                <label className="brd-label" htmlFor="brd-contact">{t('board.contact')}</label>
                <input id="brd-contact" value={form.contact} onChange={set('contact')} maxLength={40} placeholder="@telegram" />
              </div>
              <div className="brd-wide">
                <label className="brd-label" htmlFor="brd-note">{t('board.note')}</label>
                <input id="brd-note" value={form.note} onChange={set('note')} maxLength={140} />
              </div>
            </div>

            <button className="btn btn-primary" type="submit" style={{ marginTop: 12 }} disabled={busy}>
              {mine ? t('board.update') : t('board.publish')}
            </button>
            <p className="faint" style={{ marginTop: 8, fontSize: 11.5 }}>
              {t('board.oneEach', { addr: shortAddress(address) })}
            </p>
          </form>
        )}
      </motion.section>

      {/* ---------------- Pro ---------------- */}
      {/*
        THE ONLY PLACE THE PAID PLAN IS ADVERTISED.

        Asked for explicitly: «نمیخام در صفحات دیگر این تبلیغات نشان داده شود».
        There is no Pro badge in the header, no upsell on Swap, no banner
        anywhere else — this panel renders inside the board tab and nowhere
        else, and it is only shown to somebody who already has a listing to
        promote, because selling a promotion for nothing is the fastest way to
        make the feature feel like a scam.
      */}
      {address && mine && !mine.promoted && terms ? (
        <motion.section className="brd-pro" variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 6 }}>{t('board.proTitle')}</p>
          <div className="brd-pro-price">${terms.priceUsd}</div>
          <p className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>
            {t('board.proPer', { days: 30 })}
          </p>

          <ul className="brd-perks">
            {['top', 'badge', 'longer', 'highlight'].map((k) => (
              <li key={k}>{t(`board.perk.${k}`)}</li>
            ))}
          </ul>

          <button className="btn btn-primary" style={{ marginTop: 13 }} onClick={goPro} disabled={paying}>
            {paying ? t('board.paying') : t('board.payWith', { symbol: terms.symbol, chain: terms.chainName })}
          </button>
          <p className="faint" style={{ marginTop: 9, fontSize: 11.3, lineHeight: 1.75 }}>
            {t('board.proNote', { symbol: terms.symbol, chain: terms.chainName })}
          </p>
        </motion.section>
      ) : null}

      {address && mine?.promoted ? (
        <motion.section className="brd-pro" variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 6 }}>{t('board.proTitle')}</p>
          <p className="prose-sm" style={{ margin: 0 }}>
            {t('board.proUntil', { date: new Date(mine.promoUntil).toLocaleDateString('en-GB') })}
          </p>
        </motion.section>
      ) : null}

      {/* ---------------- the board ---------------- */}
      <section>
        <p className="section-label">{t('board.listings')}</p>

        {loading ? (
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            {[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 96 }} />)}
          </div>
        ) : state.rows.length === 0 ? (
          <div className="empty" style={{ marginTop: 10 }}>
            <span className="empty-icon">📋</span>
            {state.live ? t('board.empty') : t('board.offline')}
          </div>
        ) : (
          <motion.div className="stack" style={{ gap: 9, marginTop: 10 }} variants={stagger} initial="hidden" animate="show">
            {state.rows.map((row) => (
              <Row
                key={row.owner}
                row={row}
                mine={Boolean(address) && row.owner?.toLowerCase() === address.toLowerCase()}
                onDelete={remove}
                onSwap={() => navigate(`/swap?to=${encodeURIComponent(row.asset)}`)}
              />
            ))}
          </motion.div>
        )}
      </section>

      <p className="notice">{t('board.footerNotice')}</p>
    </>
  );
}
