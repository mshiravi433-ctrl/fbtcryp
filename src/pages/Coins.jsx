import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { fmtQty } from '../lib/format';
import { getCrosschainQuote, exchangeUrl } from '../lib/crosschain';
import { IconChevronLeft, IconExternal, IconShield } from '../components/Icons';

/**
 * NATIVE COINS — Bitcoin, Litecoin, XRP and friends.
 *
 * ─── THE GAP THIS SCREEN CLOSES ─────────────────────────────────────────────
 * This app is EVM plus Solana. The "BTC" in the swap screen is BTCB, WBTC or
 * cbBTC — wrapped tokens on an EVM chain. Somebody holding actual bitcoin, on
 * the Bitcoin network, can do nothing here at all: not swap it, not bridge
 * it, not even price it against something they could use. Same for Litecoin,
 * Dogecoin, XRP, Cardano.
 *
 * That is a whole category of user who opens the app, discovers their coin
 * is not really supported, and leaves.
 *
 * ─── WHY THIS SCREEN QUOTES BUT DOES NOT EXECUTE ────────────────────────────
 * ChangeNOW can perform these swaps and their API can create the exchange.
 * We deliberately do not, and the reason is in their own Terms of Service
 * rather than in anything technical:
 *
 *   §11.1 excludes users in "United Nations Sanctions Lists and their
 *         equivalent" — OFAC is the standard equivalent, and that covers
 *         most of this app's users.
 *   §11.4 states, verbatim, that they "may seize any funds from the Users in
 *         these jurisdictions and donate them to a charity".
 *   §11.6 they read the IP and may refuse.
 *
 * So the honest design is: show the real numbers, say plainly who may be
 * refused, and hand the user to ChangeNOW's own site where their checks
 * happen BEFORE any coin moves. Embedding the flow would put our name on a
 * transaction we cannot refund, cannot trace and cannot recover.
 *
 * ─── AND WHY THE MINIMUM IS SHOWN FIRST ─────────────────────────────────────
 * Sending below the minimum is how people lose money on services like this:
 * the deposit arrives, cannot be processed, and recovering it costs a $50 fee
 * under their §6.16. So the minimum is fetched with every quote and shown
 * before anything else.
 */

const FROM_COINS = [
  { ticker: 'btc', symbol: 'BTC', name: 'Bitcoin' },
  { ticker: 'ltc', symbol: 'LTC', name: 'Litecoin' },
  { ticker: 'doge', symbol: 'DOGE', name: 'Dogecoin' },
  { ticker: 'xrp', symbol: 'XRP', name: 'XRP' },
  { ticker: 'trx', symbol: 'TRX', name: 'Tron' },
  { ticker: 'ada', symbol: 'ADA', name: 'Cardano' },
  { ticker: 'dot', symbol: 'DOT', name: 'Polkadot' },
  { ticker: 'atom', symbol: 'ATOM', name: 'Cosmos' }
];

const TO_COINS = [
  { ticker: 'usdtbsc', label: 'USDT · BNB Chain' },
  { ticker: 'usdterc20', label: 'USDT · Ethereum' },
  { ticker: 'usdtarb', label: 'USDT · Arbitrum' },
  { ticker: 'usdtsol', label: 'USDT · Solana' },
  { ticker: 'bnbbsc', label: 'BNB' },
  { ticker: 'eth', label: 'ETH' },
  { ticker: 'sol', label: 'SOL' }
];

const DEBOUNCE_MS = 550;

export default function Coins() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();

  const [from, setFrom] = useState('btc');
  const [to, setTo] = useState('usdtbsc');
  const [amount, setAmount] = useState('');

  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  /*
   * ─── AN EXPLICIT TICK, NOT A PARAGRAPH ────────────────────────────────────
   * The owner spoke to ChangeNOW support and confirmed Iranian users are
   * workable *with a warning*. A warning nobody reads is not a warning, and
   * this one covers something irreversible: §11.4 of their terms lets them
   * seize funds from users in restricted jurisdictions, and a crypto transfer
   * cannot be recalled once sent.
   *
   * So the continue button stays disabled until the box is ticked. It resets
   * whenever the pair or amount changes, because an acknowledgement carried
   * over from a different trade is not an acknowledgement of this one.
   */
  const [acknowledged, setAcknowledged] = useState(false);

  const timer = useRef(null);
  /* Guards a slow earlier quote from overwriting a newer one — two rapid
     edits resolve out of order often enough on mobile to matter. */
  const seq = useRef(0);

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
      const q = await getCrosschainQuote({ from, to, amount: amt });
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

  /* A tick belongs to one specific trade. Changing any leg voids it. */
  useEffect(() => { setAcknowledged(false); }, [from, to, amount]);

  const openExchange = () => {
    haptic?.('light');
    const url = exchangeUrl({ from, to, amount });
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const fromMeta = useMemo(() => FROM_COINS.find((c) => c.ticker === from), [from]);

  return (
    <PageTransition>
      <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <IconChevronLeft width={18} height={18} />
        </button>
        <h1 className="h1" style={{ fontSize: 19 }}>{t('coins.title')}</h1>
      </motion.div>
      <p className="muted">{t('coins.intro')}</p>

      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 8 }}>
          <label className="ord-field">
            <span className="faint">{t('coins.youSend')}</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {FROM_COINS.map((c) => (
                <option key={c.ticker} value={c.ticker}>{c.symbol} — {c.name}</option>
              ))}
            </select>
          </label>
          <label className="ord-field">
            <span className="faint">{t('coins.youGet')}</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {TO_COINS.map((c) => (
                <option key={c.ticker} value={c.ticker}>{c.label}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="ord-field" style={{ marginTop: 10 }}>
          <span className="faint">{t('coins.amount', { symbol: fromMeta?.symbol ?? '' })}</span>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
          />
        </label>

        {loading && <div className="skel" style={{ height: 60, marginTop: 12 }} />}

        {!loading && quote && (
          <div style={{ marginTop: 12 }}>
            <div className="row-between">
              <span className="faint">{t('coins.estimated')}</span>
              <span className="mono" style={{ fontSize: 13.5, fontWeight: 700 }}>
                {/* null, never 0 — "cannot price this" is not "you get nothing". */}
                {quote.estimatedAmount == null ? '—' : fmtQty(quote.estimatedAmount)}
              </span>
            </div>
            {quote.minAmount != null && (
              <div className="row-between" style={{ marginTop: 5 }}>
                <span className="faint">{t('coins.minimum')}</span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {fmtQty(quote.minAmount)} {fromMeta?.symbol}
                </span>
              </div>
            )}
            {quote.etaMinutes && (
              <div className="row-between" style={{ marginTop: 5 }}>
                <span className="faint">{t('coins.eta')}</span>
                <span className="mono" style={{ fontSize: 12 }}>{quote.etaMinutes} {t('coins.minutes')}</span>
              </div>
            )}

            {/*
              Below the minimum is the expensive mistake: the deposit arrives,
              cannot be processed, and their §6.16 charges $50 to return it.
              This has to be loud, not a footnote.
            */}
            {quote.belowMinimum && (
              <p className="notice notice-danger" style={{ marginTop: 10 }}>
                {t('coins.belowMin', { min: fmtQty(quote.minAmount), symbol: fromMeta?.symbol })}
              </p>
            )}
            {quote.warning && (
              <p className="notice" style={{ marginTop: 10 }}>{quote.warning}</p>
            )}

            {/*
              The acknowledgement, immediately above the button it unlocks —
              not at the bottom of the screen where it would be read after the
              decision rather than before it.
            */}
            <label className="cn-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span>{t('coins.ackLabel')}</span>
            </label>

            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              onClick={openExchange}
              disabled={quote.belowMinimum === true || !acknowledged}
            >
              <span style={{ display: 'inline-flex', gap: 7, alignItems: 'center', justifyContent: 'center' }}>
                <IconExternal width={15} height={15} />
                {t('coins.continue')}
              </span>
            </button>
          </div>
        )}

        {!loading && err && (
          <p className="notice notice-danger" style={{ marginTop: 12 }}>
            {t(`coins.err.${err}`, { defaultValue: t('coins.err.QUOTE_FAILED') })}
          </p>
        )}
      </motion.section>

      {/*
        Our fee is zero here and the user is told why — it is the reason this
        integration is safe to offer at all. See OUR_FEE_PERCENT in
        server/crosschain.js.
      */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 6 }}>{t('coins.noFeeTitle')}</p>
        <p className="muted" style={{ fontSize: 12.2, margin: 0, lineHeight: 1.85 }}>
          {t('coins.noFeeBody')}
        </p>
      </motion.section>

      {/*
        ─── THE DISCLOSURE, NOT BURIED ───────────────────────────────────────
        Three separate things a user must know before they send a coin we
        cannot recover: this is a third party, they may refuse or seize in
        restricted jurisdictions, and we do not hold the funds at any point.
      */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-5)', flexShrink: 0 }}>
            <IconShield width={19} height={19} />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.2, marginBottom: 4 }}>{t('coins.honestTitle')}</div>
            <p className="muted" style={{ fontSize: 12.2, margin: 0, lineHeight: 1.85 }}>
              {t('coins.honestBody')}
            </p>
          </div>
        </div>
      </motion.section>

      <p className="notice">{t('coins.jurisdictionNotice')}</p>

      {/*
        ─── LINKING THEIR TERMS IS A CONTRACTUAL OBLIGATION, NOT POLITENESS ──
        ChangeNOW's Affiliate Terms §2.5: by using their tools we "represent
        and warrant that your Customers shall agree with ChangeNOW's terms",
        and §2.6 forbids removing that agreement from the integration. Our own
        warning sits alongside it and never replaces it.
      */}
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => {
          const url = 'https://changenow.io/terms-of-use';
          if (tg?.openLink) tg.openLink(url);
          else window.open(url, '_blank', 'noopener,noreferrer');
        }}
      >
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
          <IconExternal width={13} height={13} />
          {t('coins.readTerms')}
        </span>
      </button>
    </PageTransition>
  );
}
