import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { riseIn, stagger } from './PageTransition';
import InfoBox from './InfoBox';
import { useWallet, shortAddress } from '../context/WalletContext';
import { deleteListing, fetchBoard, payForPromotion, postListing, publishListing } from '../lib/board';
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
 * ─── WHY POSTING COSTS MONEY ────────────────────────────────────────────────
 * Asked for, and it is the right mechanism: a free board fills with adverts
 * from people who have nothing to sell. Charging for the SLOT costs a spammer
 * real money per advert while costing a genuine trader about the price of a
 * coffee. $1 / 1 day, $5 / 7 days, $25 / 30 days.
 *
 * The listing is INVISIBLE until it is paid for. That is enforced on the
 * server — `liveUntil` is only ever set by a verified payment — so a bug in
 * this file cannot publish an unpaid advert.
 *
 * ─── WHY THE PRICES APPEAR TWICE ────────────────────────────────────────────
 * Once in the collapsible warning box (asked for explicitly) and once on the
 * buttons. Both read the SAME list from the server's `terms.tiers`, so they
 * cannot drift apart — a hard-coded price in the UI is how a screen advertises
 * $5 while the server demands $25.
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
      className={`brd-row${row.featured ? ' brd-row-promoted' : ''}`}
    >
      <div className="brd-head">
        <span className={`brd-side brd-side-${row.side}`}>{t(`board.side.${row.side}`)}</span>
        <span className="brd-asset">{row.asset}</span>
        {row.amount ? <span className="faint" style={{ fontSize: 12 }}>{row.amount}</span> : null}
        {row.featured ? <span className="brd-star">★ {t('board.pro')}</span> : null}
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

  const [state, setState] = useState({ rows: [], mine: null, terms: null, live: true });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(null);

  const address = wallet?.address ?? null;

  const load = useCallback(async (addr) => {
    const data = await fetchBoard(addr);
    setState(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const data = await fetchBoard(address);
      if (!alive) return;
      setState(data);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [address]);

  const mine = state.mine;
  const tiers = state.terms?.tiers ?? [];

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!address || busy) return;

    setBusy(true);
    try {
      await postListing({ ...form, owner: address });
      setForm(EMPTY_FORM);
      await load(address);
      /* "Saved, now pay" — never "published", because it is not visible yet. */
      notify?.(mine?.live ? 'boardPosted' : 'boardDraftSaved', 'success');
    } catch (err) {
      /*
       * Server error codes are mapped to real sentences. Rendering BAD_CONTACT
       * to a user is the raw-key leak this project keeps auditing for.
       */
      const code = String(err?.message || '');
      const known = {
        BAD_ASSET: 'boardBadAsset',
        BAD_CONTACT: 'boardBadContact',
        BAD_SIDE: 'boardFailed',
        BAD_OWNER: 'boardFailed'
      };
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
      await load(address);
      notify?.('boardRemoved', 'info');
    } catch {
      notify?.('boardFailed', 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Pay for one tier and publish. */
  const buy = async (tier) => {
    if (paying) return;
    if (!mine) {
      notify?.('boardNoListing', 'error');
      return;
    }

    setPaying(tier.id);
    try {
      const paid = await payForPromotion({ terms: state.terms, tier, wallet });
      if (!paid.ok) {
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
       * The money has left the wallet by this point. If the publish call fails
       * the user must NOT be told "payment failed" — they must be told the
       * payment went through, so they retry the claim rather than pay twice.
       */
      try {
        await publishListing(address, paid.hash);
        await load(address);
        notify?.('boardLive', 'success');
      } catch {
        notify?.('payClaimLater', 'info');
      }
    } finally {
      setPaying(null);
    }
  };

  const priceList = tiers.map((x) => `$${x.usd} / ${x.days}d`).join(' · ');

  return (
    <>
      {/*
        Always open. On a board of strangers, "nobody is holding your money" is
        the one sentence that has to be read before anything else.
      */}
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <InfoBox title={t('board.safetyTitle')} tone="danger" defaultOpen id="board-safety">
          <p>{t('board.safetyBody')}</p>
        </InfoBox>
      </motion.div>

      {/*
        ─── THE PRICE LIST, IN A COLLAPSIBLE WARNING BOX ─────────────────────
        Asked for explicitly. Collapsed by default because it is reference
        material rather than a warning somebody must read to stay safe — the
        danger box above is the one that stays open.

        Built from `terms.tiers`, so it is literally the server's price list
        and cannot drift from what will be charged.
      */}
      {tiers.length > 0 ? (
        <motion.div variants={riseIn} initial="hidden" animate="show">
          <InfoBox title={t('board.costsTitle')} tone="warn" id="board-costs">
            <ul className="brd-perks">
              {tiers.map((x) => (
                <li key={x.id}>{t('board.costRow', { usd: x.usd, days: x.days })}</li>
              ))}
            </ul>
            <p>{t('board.costsBody', {
              symbol: state.terms?.symbol ?? 'USDC',
              chain: state.terms?.chainName ?? 'Base'
            })}</p>
            <p>{t('board.costsRefund')}</p>
          </InfoBox>
        </motion.div>
      ) : null}

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
              {mine ? t('board.update') : t('board.saveDraft')}
            </button>
            <p className="faint" style={{ marginTop: 8, fontSize: 11.5 }}>
              {t('board.oneEach', { addr: shortAddress(address) })}
            </p>
          </form>
        )}
      </motion.section>

      {/* ---------------- pay to publish ---------------- */}
      {/*
        THE ONLY PLACE THE PAID PLAN IS ADVERTISED.

        Asked for: «نمیخام در صفحات دیگر این تبلیغات نشان داده شود». There is no
        upsell in the header, on Swap, or anywhere else — this panel renders
        inside the board tab only, and only for somebody who has a listing to
        publish.
      */}
      {address && mine && tiers.length > 0 ? (
        <motion.section className="brd-pro" variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 6 }}>
            {mine.live ? t('board.extendTitle') : t('board.publishTitle')}
          </p>

          {mine.live ? (
            <p className="prose-sm" style={{ marginTop: 0 }}>
              {t('board.liveUntil', { date: new Date(mine.liveUntil).toLocaleDateString('en-GB') })}
            </p>
          ) : (
            <p className="prose-sm" style={{ marginTop: 0 }}>{t('board.draftHidden')}</p>
          )}

          <div className="brd-tiers">
            {tiers.map((x) => (
              <button
                key={x.id}
                type="button"
                className={`brd-tier${x.id === 'd30' ? ' is-best' : ''}`}
                onClick={() => buy(x)}
                disabled={Boolean(paying)}
              >
                <span className="brd-tier-price">${x.usd}</span>
                <span className="brd-tier-days">{t('board.daysN', { n: x.days })}</span>
                {paying === x.id ? <span className="brd-tier-wait">{t('board.paying')}</span> : null}
              </button>
            ))}
          </div>

          <p className="faint" style={{ marginTop: 10, fontSize: 11.3, lineHeight: 1.75 }}>
            {t('board.proNote', {
              symbol: state.terms?.symbol ?? 'USDC',
              chain: state.terms?.chainName ?? 'Base'
            })}
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

      <p className="notice">{t('board.footerNotice', { prices: priceList })}</p>
    </>
  );
}
