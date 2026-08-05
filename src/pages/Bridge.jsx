import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { fmtUsd } from '../lib/format';
import {
  BRIDGE_CHAINS,
  fromBaseUnits,
  getBridgeQuote,
  summariseQuote,
  toBaseUnits,
  tokensFor
} from '../lib/bridge';
import { IconExternal, IconShield, IconSwap } from '../components/Icons';

/**
 * CROSS-CHAIN BRIDGE.
 *
 * ─── WHY THIS SCREEN EXISTS ─────────────────────────────────────────────────
 * The bridge API shipped a release before any user could reach it. Fees were
 * confirmed live — `registered: true`, our cut visible in the quote's
 * `recipients` array — and earnings were still exactly zero, because there was
 * no route, no button and no screen. A revenue integration nobody can open
 * earns the same as one that does not exist.
 *
 * ─── WHY STABLECOINS ONLY, FOR NOW ──────────────────────────────────────────
 * Bridging takes time, and a volatile token can move while the transfer is in
 * flight — leaving the user unable to judge whether what arrived was fair.
 * With USDC and USDT the expected result is obvious to anybody: roughly what
 * you sent, minus fees you can see. It is also most of real bridge volume.
 *
 * ─── WHY THE USER SIGNS, NOT US ─────────────────────────────────────────────
 * LI.FI returns a ready transaction; the wallet signs and sends it. We never
 * hold funds and never submit on anyone's behalf, exactly like the swap path.
 * If this app ever needs to touch a user's money to work, it has stopped being
 * the product it claims to be.
 */

const DEBOUNCE_MS = 500;

export default function Bridge() {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  const [fromChain, setFromChain] = useState(56);
  const [toChain, setToChain] = useState(42161);
  const [tokenSymbol, setTokenSymbol] = useState('USDT');
  const [amount, setAmount] = useState('');

  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState(null);

  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [txErr, setTxErr] = useState(null);

  const fromTokens = useMemo(() => tokensFor(fromChain), [fromChain]);
  const toTokens = useMemo(() => tokensFor(toChain), [toChain]);

  const fromToken = useMemo(
    () => fromTokens.find((x) => x.symbol === tokenSymbol) ?? fromTokens[0],
    [fromTokens, tokenSymbol]
  );
  /*
   * The destination token is matched by SYMBOL, and falls back to whatever the
   * chain does have. Base, for instance, lists USDC but not USDT — sending
   * someone there expecting USDT would produce an unroutable quote and a
   * confusing error, so the UI quietly lands them on USDC and shows it.
   */
  const toToken = useMemo(
    () => toTokens.find((x) => x.symbol === tokenSymbol) ?? toTokens[0],
    [toTokens, tokenSymbol]
  );

  const summary = useMemo(() => summariseQuote(quote), [quote]);

  /* ------------------------------- quoting ------------------------------- */

  const timerRef = useRef(null);

  const fetchQuote = useCallback(async () => {
    setQuoteErr(null);
    setTxErr(null);

    if (!wallet.isConnected || !wallet.address) return;
    if (!fromToken || !toToken) return;
    if (fromChain === toChain) return;

    const raw = toBaseUnits(amount, fromToken.decimals);
    if (!raw) {
      setQuote(null);
      return;
    }

    setQuoting(true);
    try {
      const q = await getBridgeQuote({
        fromChain,
        toChain,
        fromToken: fromToken.address,
        toToken: toToken.address,
        fromAddress: wallet.address,
        fromAmount: raw
      });
      setQuote(q);
    } catch (e) {
      setQuote(null);
      setQuoteErr(e.code || 'QUOTE_FAILED');
    } finally {
      setQuoting(false);
    }
  }, [wallet.isConnected, wallet.address, fromChain, toChain, fromToken, toToken, amount]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fetchQuote, DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [fetchQuote]);

  /* ------------------------------ execution ------------------------------ */

  const run = async () => {
    const tx = quote?.transactionRequest;
    if (!tx) return;

    setBusy(true);
    setTxErr(null);
    haptic?.('medium');

    try {
      /*
       * The wallet must be ON the source chain before signing. Skipping this
       * produces a transaction broadcast to whichever network happened to be
       * selected — the single most expensive mistake available here, and one
       * the user cannot undo.
       */
      if (wallet.chainId !== fromChain) {
        await wallet.switchChain?.(fromChain);
      }

      const signer = wallet.getSigner?.();
      if (!signer) throw new Error('NO_SIGNER');

      const sent = await signer.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value ?? undefined,
        /*
         * LI.FI's gas estimate is passed through rather than recalculated.
         * A bridge call is a multi-step contract interaction and wallets
         * routinely under-estimate it, which shows up as a failed transaction
         * that still charged gas.
         */
        gasLimit: tx.gasLimit ?? undefined
      });

      setTxHash(sent.hash);
      haptic?.('success');
    } catch (e) {
      setTxErr(e?.shortMessage || e?.message || 'TX_FAILED');
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  const flip = () => {
    setFromChain(toChain);
    setToChain(fromChain);
    setAmount('');
    setQuote(null);
    haptic?.('select');
  };

  const chainName = (id) => BRIDGE_CHAINS.find((c) => c.id === id)?.name ?? String(id);

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('bridge.title')}</h1>
        <p className="muted">{t('bridge.subtitle')}</p>
      </motion.div>

      {/* what this is, before anything is tapped */}
      <motion.section className="card card-rgb card-glow-cyan" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-1)', flexShrink: 0 }}>
            <IconSwap width={22} height={22} />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('bridge.whatTitle')}</div>
            <p className="muted" style={{ fontSize: 12.3, margin: 0 }}>{t('bridge.whatBody')}</p>
          </div>
        </div>
      </motion.section>

      {/* ------------------------------ ticket ------------------------------ */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="field-label">{t('bridge.from')}</div>
        <div className="brg-row">
          <select
            className="brg-select"
            value={fromChain}
            onChange={(e) => {
              setFromChain(Number(e.target.value));
              setQuote(null);
            }}
          >
            {BRIDGE_CHAINS.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select
            className="brg-select"
            value={tokenSymbol}
            onChange={(e) => {
              setTokenSymbol(e.target.value);
              setQuote(null);
            }}
          >
            {fromTokens.map((tk) => (
              <option key={tk.symbol} value={tk.symbol}>{tk.symbol}</option>
            ))}
          </select>
        </div>

        <input
          className="brg-amount"
          type="number"
          inputMode="decimal"
          min="0"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <button type="button" className="brg-flip" onClick={flip} aria-label={t('bridge.flip')}>
          ⇅
        </button>

        <div className="field-label">{t('bridge.to')}</div>
        <div className="brg-row">
          <select
            className="brg-select"
            value={toChain}
            onChange={(e) => {
              setToChain(Number(e.target.value));
              setQuote(null);
            }}
          >
            {BRIDGE_CHAINS.filter((c) => c.id !== fromChain).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {/*
            Read-only. The destination token is decided by what that chain
            actually lists, not by the user — offering a token the chain does
            not have produces an unroutable quote and a useless error.
          */}
          <div className="brg-select brg-select-static">{toToken?.symbol ?? '—'}</div>
        </div>

        {quoting && <p className="faint" style={{ marginTop: 10 }}>{t('bridge.quoting')}</p>}

        {quoteErr && !quoting && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {t(`bridge.err.${quoteErr}`, { defaultValue: t('bridge.err.QUOTE_FAILED') })}
          </p>
        )}

        {/*
          ─── EVERY COST, ITEMISED ─────────────────────────────────────────
          A bridge quote carries several separate charges: LI.FI's 0.25%,
          ours, the relayer's fee, the relayer's gas and the chain gas.
          Showing only "you receive X" would be technically honest and would
          still hide the thing people complain about afterwards. Our own cut
          is named rather than folded into "fees" — a fee the user cannot see
          is a fee they will feel tricked by later.
        */}
        {summary && !quoting && (
          <div className="brg-quote">
            <div className="row-between">
              <span className="faint">{t('bridge.youReceive')}</span>
              <span className="mono brg-out">
                {fromBaseUnits(summary.toAmount, toToken?.decimals ?? 6)} {toToken?.symbol}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('bridge.route')}</span>
              <span className="mono" style={{ fontSize: 12 }}>{summary.toolName}</span>
            </div>
            <div className="row-between">
              <span className="faint">{t('bridge.totalCost')}</span>
              <span className="mono" style={{ fontSize: 12 }}>{fmtUsd(summary.totalCostUsd)}</span>
            </div>
            {summary.ourFeeUsd != null && (
              <div className="row-between">
                <span className="faint">{t('bridge.ourFee')}</span>
                <span className="mono" style={{ fontSize: 12 }}>{fmtUsd(summary.ourFeeUsd)}</span>
              </div>
            )}
            {summary.durationSec != null && (
              <div className="row-between">
                <span className="faint">{t('bridge.eta')}</span>
                <span className="mono" style={{ fontSize: 12 }}>~{summary.durationSec}s</span>
              </div>
            )}
          </div>
        )}

        {!wallet.isConnected ? (
          <p className="notice" style={{ marginTop: 12 }}>{t('bridge.connectFirst')}</p>
        ) : (
          <button
            className="btn btn-primary"
            style={{ marginTop: 12, width: '100%' }}
            disabled={!quote?.transactionRequest || busy}
            onClick={run}
          >
            {busy ? t('bridge.sending') : t('bridge.send')}
          </button>
        )}

        {txErr && <p className="notice notice-danger" style={{ marginTop: 10 }}>{txErr}</p>}

        {txHash && (
          <div className="notice" style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('bridge.sentTitle')}</div>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7 }}>{t('bridge.sentBody')}</p>
            <a
              className="row"
              style={{ gap: 6, marginTop: 8, fontSize: 12 }}
              href={`https://scan.li.fi/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('bridge.track')} <IconExternal width={14} height={14} />
            </a>
          </div>
        )}
      </motion.section>

      {/*
        Placed BELOW the ticket rather than above it. Someone arriving here
        already intends to bridge; the risk that matters is the one they meet
        after tapping send, and that is what this covers.
      */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--rgb-5)', flexShrink: 0 }}>
            <IconShield width={19} height={19} />
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{t('bridge.riskTitle')}</div>
            <p className="muted" style={{ fontSize: 12.2, margin: 0 }}>{t('bridge.riskBody')}</p>
          </div>
        </div>
      </motion.section>

      <p className="notice notice-danger">{t('bridge.disclaimer')}</p>
    </PageTransition>
  );
}
