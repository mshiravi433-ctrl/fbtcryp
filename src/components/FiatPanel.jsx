import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import { fmtQty } from '../lib/format';
import { useWallet } from '../context/WalletContext';
import { openUrl } from '../lib/browser';
import RestrictionsSheet from './RestrictionsSheet';
import {
  FIAT_ASSETS,
  FIAT_MONEY,
  createFiatOrder,
  getFiatQuote,
  getFiatRange,
  getFiatStatus
} from '../lib/fiat';

/**
 * BUY AND SELL CRYPTO FOR MONEY.
 *
 * ─── WHY THIS IS HERE WHEN THE SWAP INTEGRATION WAS DELETED ─────────────────
 * We run a swap. Advertising someone else's swap hands over a customer we
 * already have, which is why the previous ChangeNOW screen was removed.
 *
 * Fiat is the opposite: we do not have an on-ramp and cannot build one
 * without a payment licence, card acquiring and a compliance stack. A partner
 * here competes with nothing of ours, and it is the one place a commission is
 * genuinely earned rather than taken from our own trade.
 *
 * The module behind this (`server/fiat.js`) is structurally incapable of
 * quoting a crypto-to-crypto pair — `assertFiatLeg` rejects it — so this
 * cannot drift back into being a swap.
 *
 * ─── THE PANEL NOW FINISHES THE JOB, WHICH IT DID NOT BEFORE ────────────────
 * The previous version could only display an estimate. There was no address
 * field and no submit, so nothing was ever ordered, and commission is paid on
 * completed transactions rather than on quotes. It was a price display
 * wearing the costume of a shop.
 *
 * The flow is now: pick → quote → address → open the hosted checkout. We
 * never see a card number; the payment happens at the licensed institution,
 * on their domain, and the crypto is delivered to the address the user
 * supplied. We are an introducer, which is exactly why we may be paid.
 *
 * ─── THE FEE IS SHOWN AS THEY ITEMISE IT, NOT AS WE IMAGINE IT ──────────────
 * The old panel printed "our fee: 1%" from an environment variable that
 * nothing ever deducted — a number with no mechanism behind it. What is shown
 * now is ChangeNOW's own `service_fees` breakdown, which is the amount the
 * user is actually charged and inside which our partner commission already
 * sits. A displayed fee that differs from the charged one is how an app loses
 * trust in every other number it prints.
 */

const DEBOUNCE_MS = 550;

export default function FiatPanel({ mode = 'buy' }) {
  const { t } = useTranslation();
  const wallet = useWallet();

  const [status, setStatus] = useState(null);
  const [money, setMoney] = useState('usd');
  const [asset, setAsset] = useState('usdt-bsc');
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');

  const [range, setRange] = useState(null);
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const [restrictOpen, setRestrictOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [orderErr, setOrderErr] = useState(null);
  const [order, setOrder] = useState(null);

  const timer = useRef(null);
  /* Guards a slow earlier quote from overwriting a newer one. */
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    getFiatStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus({ enabled: false }));
    return () => {
      alive = false;
    };
  }, []);

  /*
   * Buying spends money and receives crypto; selling is the reverse. Deriving
   * both sides from one `mode` in a single place means the pair can never be
   * built backwards — the mistake that would quote the opposite trade.
   */
  const from = mode === 'sell' ? asset : money;
  const to = mode === 'sell' ? money : asset;

  /*
   * Limits, fetched per pair and independently of the quote. The upstream
   * range endpoint needs no API key, so this answers even while our fiat
   * access is still pending — the form can state a real minimum rather than
   * letting somebody type an amount that will be refused at checkout.
   */
  useEffect(() => {
    let alive = true;
    setRange(null);
    getFiatRange({ from, to })
      .then((r) => alive && setRange(r))
      .catch(() => {
        /* Silent: a missing range degrades to no hint, never to a blocked form. */
      });
    return () => {
      alive = false;
    };
  }, [from, to]);

  const fetchQuote = useCallback(async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setQuote(null);
      setErr(null);
      return;
    }
    const mine = seq.current + 1;
    seq.current = mine;
    setLoading(true);
    setErr(null);
    try {
      const q = await getFiatQuote({ from, to, amount: amt });
      if (seq.current !== mine) return;
      setQuote(q);
    } catch (e) {
      if (seq.current !== mine) return;
      setQuote(null);
      setErr(e.code || 'QUOTE_FAILED');
    } finally {
      if (seq.current === mine) setLoading(false);
    }
  }, [from, to, amount]);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fetchQuote, DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [fetchQuote]);

  /*
   * A new pair or amount invalidates a placed order. Leaving the old checkout
   * link on screen after the numbers changed is how somebody pays for the
   * previous quote.
   */
  useEffect(() => {
    setOrder(null);
    setOrderErr(null);
  }, [from, to, amount]);

  const moneyMeta = useMemo(() => FIAT_MONEY.find((m) => m.code === money), [money]);
  const assetMeta = useMemo(() => FIAT_ASSETS.find((a) => a.id === asset), [asset]);

  const amt = Number(amount);
  const belowMin = range?.min != null && Number.isFinite(amt) && amt > 0 && amt < range.min;
  const aboveMax = range?.max != null && Number.isFinite(amt) && amt > range.max;

  const canOrder =
    Boolean(quote) && !loading && !belowMin && !aboveMax && address.trim().length >= 16;

  const placeOrder = async () => {
    setPlacing(true);
    setOrderErr(null);
    try {
      const res = await createFiatOrder({
        from,
        to,
        amount: amt,
        address: address.trim(),
        email: email.trim() || undefined
      });
      setOrder(res);
      /*
       * Opened through openUrl(), which uses a Custom Tab where the real
       * domain stays visible. A payment page rendered inside a WebView we
       * control is indistinguishable from a phishing page, and this is the
       * one screen where that distinction is the whole point.
       */
      openUrl(res.redirectUrl);
    } catch (e) {
      setOrderErr(e.code || 'ORDER_FAILED');
    } finally {
      setPlacing(false);
    }
  };

  /* Not live yet: say why, offer nothing. */
  if (status && !status.enabled) {
    return (
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 6 }}>{t('fiat.title')}</p>
        <p className="prose-sm" style={{ margin: 0 }}>{t('fiat.notEnabled')}</p>
      </motion.section>
    );
  }

  return (
    <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
      <p className="section-label" style={{ marginBottom: 6 }}>
        {t(mode === 'sell' ? 'fiat.sellTitle' : 'fiat.title')}
      </p>
      <p className="prose-sm" style={{ margin: '0 0 10px' }}>
        {t(mode === 'sell' ? 'fiat.sellIntro' : 'fiat.intro')}
      </p>

      <div className="row" style={{ gap: 8 }}>
        <label className="ord-field">
          <span className="faint">{t(mode === 'sell' ? 'fiat.youSell' : 'fiat.youPay')}</span>
          {mode === 'sell' ? (
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              {FIAT_ASSETS.map((o) => (
                <option key={o.id} value={o.id}>{o.symbol} · {o.chain}</option>
              ))}
            </select>
          ) : (
            <select value={money} onChange={(e) => setMoney(e.target.value)}>
              {FIAT_MONEY.map((o) => (
                <option key={o.code} value={o.code}>{o.symbol} — {o.name}</option>
              ))}
            </select>
          )}
        </label>
        <label className="ord-field">
          <span className="faint">{t(mode === 'sell' ? 'fiat.youReceive' : 'fiat.youGet')}</span>
          {mode === 'sell' ? (
            <select value={money} onChange={(e) => setMoney(e.target.value)}>
              {FIAT_MONEY.map((o) => (
                <option key={o.code} value={o.code}>{o.symbol} — {o.name}</option>
              ))}
            </select>
          ) : (
            /*
              The chain is printed next to every asset, not tucked into a
              tooltip. USDT appears twice — TRON and BNB Chain — and they are
              different destinations with different addresses. A user who
              picks the wrong one sends real money to a chain their wallet
              cannot reach, and nothing can bring it back.
            */
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              {FIAT_ASSETS.map((o) => (
                <option key={o.id} value={o.id}>{o.symbol} · {o.chain}</option>
              ))}
            </select>
          )}
        </label>
      </div>

      <label className="ord-field" style={{ marginTop: 10 }}>
        <span className="faint">
          {t('fiat.amount', { unit: mode === 'sell' ? assetMeta?.symbol : moneyMeta?.symbol })}
        </span>
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
        />
      </label>

      {/* Real limits from upstream, shown before the amount is committed. */}
      {range?.min != null && (
        <p className="faint" style={{ fontSize: 11.3, marginTop: 6, lineHeight: 1.7 }}>
          {t('fiat.range', { min: fmtQty(range.min), max: fmtQty(range.max) })}
        </p>
      )}
      {belowMin && (
        <p className="notice notice-danger" style={{ marginTop: 8 }}>
          {t('fiat.belowMin', { min: fmtQty(range.min) })}
        </p>
      )}
      {aboveMax && (
        <p className="notice notice-danger" style={{ marginTop: 8 }}>
          {t('fiat.aboveMax', { max: fmtQty(range.max) })}
        </p>
      )}

      {loading && <div className="skel" style={{ height: 54, marginTop: 12 }} />}

      {!loading && quote && (
        <div style={{ marginTop: 12 }}>
          <div className="row-between">
            <span className="faint">{t('fiat.estimated')}</span>
            <span className="mono" style={{ fontSize: 13.5, fontWeight: 700 }}>
              {/* null, never 0 — "cannot price" is not "you get nothing". */}
              {quote.estimatedAmount == null ? '—' : fmtQty(quote.estimatedAmount)}
            </span>
          </div>

          {/*
            Their fee breakdown, itemised and verbatim. Our partner commission
            is already inside these lines; we do not add a number of our own,
            because a fee we display and never charge is worse than no figure
            at all.
          */}
          {quote.serviceFees?.map((f, i) => (
            <div className="row-between" style={{ marginTop: 5 }} key={`${f.name ?? 'fee'}-${i}`}>
              <span className="faint">{f.name || t('fiat.serviceFee')}</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {fmtQty(f.amount)} {f.currency ?? ''}
              </span>
            </div>
          ))}
          {quote.networkFee?.amount != null && (
            <div className="row-between" style={{ marginTop: 5 }}>
              <span className="faint">{t('fiat.networkFee')}</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {fmtQty(quote.networkFee.amount)} {quote.networkFee.currency ?? ''}
              </span>
            </div>
          )}
          <p className="faint" style={{ fontSize: 11.3, marginTop: 9, lineHeight: 1.7 }}>
            {t('fiat.feeNote')}
          </p>
        </div>
      )}

      {!loading && err && (
        <p className="notice notice-danger" style={{ marginTop: 12 }}>
          {t(`fiat.err.${err}`, { defaultValue: t('fiat.err.QUOTE_FAILED') })}
        </p>
      )}

      {/* --------------------------- where it lands --------------------------- */}
      {quote && (
        <>
          <label className="ord-field" style={{ marginTop: 12 }}>
            <span className="faint">
              {t(mode === 'sell' ? 'fiat.payoutAccount' : 'fiat.payoutAddress', {
                chain: assetMeta?.chain ?? ''
              })}
            </span>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={mode === 'sell' ? 'IBAN / IBAN-like' : assetMeta?.chain ?? ''}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </label>

          {/*
            Filling the field from the connected wallet, only when the chain
            matches. Offering it for a Solana purchase while an EVM wallet is
            connected would paste an address the coins can never reach — the
            convenience is only a convenience if it cannot be wrong.
          */}
          {mode === 'buy' && wallet.address && assetMeta && /bsc|eth/.test(assetMeta.id) && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setAddress(wallet.address)}
            >
              {t('fiat.useMyWallet')}
            </button>
          )}

          <label className="ord-field" style={{ marginTop: 10 }}>
            <span className="faint">{t('fiat.emailOptional')}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="—"
              spellCheck={false}
              autoCapitalize="none"
              style={{ direction: 'ltr', textAlign: 'left' }}
            />
          </label>

          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 12 }}
            disabled={!canOrder || placing}
            onClick={placeOrder}
          >
            {placing ? t('fiat.placing') : t(mode === 'sell' ? 'fiat.startSell' : 'fiat.startBuy')}
          </button>

          <p className="faint" style={{ fontSize: 11.3, marginTop: 8, lineHeight: 1.7 }}>
            {t('fiat.checkoutNote')}
          </p>
        </>
      )}

      {orderErr && (
        <p className="notice notice-danger" style={{ marginTop: 10 }}>
          {t(`fiat.err.${orderErr}`, { defaultValue: t('fiat.err.ORDER_FAILED') })}
        </p>
      )}

      {/*
        The checkout link stays on screen after the tab opens. Custom Tabs get
        dismissed by accident, and a user who loses the payment page with no
        way back is a user who has started an order they cannot finish.
      */}
      {order?.redirectUrl && (
        <div className="card card-tight" style={{ marginTop: 10 }}>
          <p className="prose-sm" style={{ margin: 0 }}>{t('fiat.orderCreated')}</p>
          <button
            className="btn btn-ghost btn-sm"
            style={{ width: '100%', marginTop: 8 }}
            onClick={() => openUrl(order.redirectUrl)}
          >
            {t('fiat.reopenCheckout')}
          </button>
        </div>
      )}

      {/*
        ─── THIS WAS A COUNTRY-SPECIFIC WARNING SHOWN TO THE WHOLE WORLD ─────
        It used to render `fiat.cardNotice` unconditionally: a paragraph about
        Iranian bank cards and 2012 sanctions, on the Buy screen, for every
        user on earth. A buyer in Berlin with a German card read three lines
        explaining why a card they do not hold will not work.

        The owner named the problem twice, and it is a product point rather
        than a cosmetic one:

            «ما از همه جهان مشتری داریم نه فقط ایران»
            «محدودیت روی اپ و سایت نزار»

        Two separate harms, and the second is the one that costs money:

          1. To the 95% it does not concern, it is noise — and worse, it is
             noise in a WARNING box. Spending the warning colour on a rule
             most readers are unaffected by is exactly how a reader learns to
             skip warning boxes, including the one that would have saved
             them.

          2. To a first-time visitor it reads as a statement about what this
             APP is, not about what the card networks are. An app whose
             checkout leads with a sanctions paragraph looks restricted. We
             are not restricted — nothing in FBT Swap is geofenced, there is
             no IP check anywhere in this repository, and the swap, wallet,
             charts and orders work for anyone with a wallet.

        What replaces it is a neutral, universally-true line: the purchase is
        settled by a licensed payment partner who decides at checkout based on
        where the card was issued. That is accurate for every reader.

        The Iran detail is NOT deleted — deleting it would send somebody to
        enter card details that cannot be authorised, which is a worse
        outcome than reading an irrelevant paragraph. It moved into the
        Restrictions sheet, one neutral tap away, next to the rows that say
        EUR, GBP, TRY and AED all work.
      */}
      <p className="prose-sm" style={{ marginTop: 12 }}>{t('fiat.settlementNote')}</p>
      <button
        className="btn btn-ghost btn-sm"
        style={{ width: '100%', marginTop: 8 }}
        onClick={() => setRestrictOpen(true)}
      >
        {t('restrict.open')}
      </button>
      <RestrictionsSheet open={restrictOpen} onClose={() => setRestrictOpen(false)} />
    </motion.section>
  );
}
