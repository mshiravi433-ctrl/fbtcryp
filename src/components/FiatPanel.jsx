import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import { fmtQty } from '../lib/format';
import { FIAT_ASSETS, FIAT_MONEY, getFiatQuote, getFiatStatus } from '../lib/fiat';

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
 * ─── THE FEE IS SHOWN, NOT BURIED ───────────────────────────────────────────
 * Our percentage appears on screen before the user commits. A fee discovered
 * afterwards is the kind that makes someone distrust every other number in
 * the app, and on a fiat purchase — a real bank transaction that cannot be
 * reversed — that distrust is deserved.
 *
 * ─── AND IT REFUSES HONESTLY WHEN IT IS NOT LIVE ────────────────────────────
 * ChangeNOW enable fiat per-partner after a compliance review; an API key
 * alone does not switch it on. So the panel reads `/api/fiat/status` and, when
 * fiat is off, says so plainly instead of rendering a form that fails on every
 * submission. That is the "wired to nothing" failure this project has already
 * shipped twice.
 */

const DEBOUNCE_MS = 550;

export default function FiatPanel({ mode = 'buy' }) {
  const { t } = useTranslation();

  const [status, setStatus] = useState(null);
  const [money, setMoney] = useState('usd');
  const [asset, setAsset] = useState('usdtbsc');
  const [amount, setAmount] = useState('');

  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

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

  const moneyMeta = useMemo(() => FIAT_MONEY.find((m) => m.code === money), [money]);
  const assetMeta = useMemo(() => FIAT_ASSETS.find((a) => a.ticker === asset), [asset]);

  /* Not live yet: say why, offer nothing. */
  if (status && !status.enabled) {
    return (
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 6 }}>{t('fiat.title')}</p>
        <p className="muted" style={{ fontSize: 12.2, margin: 0, lineHeight: 1.85 }}>
          {t('fiat.notEnabled')}
        </p>
      </motion.section>
    );
  }

  return (
    <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
      <p className="section-label" style={{ marginBottom: 6 }}>
        {t(mode === 'sell' ? 'fiat.sellTitle' : 'fiat.title')}
      </p>
      <p className="muted" style={{ fontSize: 12.2, margin: '0 0 10px', lineHeight: 1.8 }}>
        {t(mode === 'sell' ? 'fiat.sellIntro' : 'fiat.intro')}
      </p>

      <div className="row" style={{ gap: 8 }}>
        <label className="ord-field">
          <span className="faint">{t(mode === 'sell' ? 'fiat.youSell' : 'fiat.youPay')}</span>
          <select
            value={mode === 'sell' ? asset : money}
            onChange={(e) => (mode === 'sell' ? setAsset(e.target.value) : setMoney(e.target.value))}
          >
            {(mode === 'sell' ? FIAT_ASSETS : FIAT_MONEY).map((o) => (
              <option key={o.ticker ?? o.code} value={o.ticker ?? o.code}>
                {o.symbol} — {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ord-field">
          <span className="faint">{t(mode === 'sell' ? 'fiat.youReceive' : 'fiat.youGet')}</span>
          <select
            value={mode === 'sell' ? money : asset}
            onChange={(e) => (mode === 'sell' ? setMoney(e.target.value) : setAsset(e.target.value))}
          >
            {(mode === 'sell' ? FIAT_MONEY : FIAT_ASSETS).map((o) => (
              <option key={o.ticker ?? o.code} value={o.ticker ?? o.code}>
                {o.symbol} — {o.name}
              </option>
            ))}
          </select>
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
          {quote.minAmount != null && (
            <div className="row-between" style={{ marginTop: 5 }}>
              <span className="faint">{t('fiat.minimum')}</span>
              <span className="mono" style={{ fontSize: 12 }}>{fmtQty(quote.minAmount)}</span>
            </div>
          )}
          {/* Our cut, on screen, before anything is committed. */}
          <div className="row-between" style={{ marginTop: 5 }}>
            <span className="faint">{t('fiat.ourFee')}</span>
            <span className="mono" style={{ fontSize: 12 }}>{quote.ourFeePercent}%</span>
          </div>
          <p className="faint" style={{ fontSize: 11.3, marginTop: 9, lineHeight: 1.7 }}>
            {t('fiat.feeNote', { pct: quote.ourFeePercent })}
          </p>
        </div>
      )}

      {!loading && err && (
        <p className="notice notice-danger" style={{ marginTop: 12 }}>
          {t(`fiat.err.${err}`, { defaultValue: t('fiat.err.QUOTE_FAILED') })}
        </p>
      )}

      {/*
        The card-network reality, stated where the decision is made rather
        than in a footnote. An Iranian bank card cannot authorise this — that
        is a property of Visa and Mastercard being severed from Iran's banking
        system, not a setting anyone can change.
      */}
      <p className="notice" style={{ marginTop: 12 }}>{t('fiat.cardNotice')}</p>
    </motion.section>
  );
}
