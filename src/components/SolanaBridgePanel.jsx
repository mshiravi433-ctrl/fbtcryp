import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { useHideBalances } from '../hooks/useHideBalances';
import { fmtUsd } from '../lib/format';
import { toBaseUnits, tokensFor, BRIDGE_CHAINS } from '../lib/bridge';
import {
  DLN_SOLANA, dlnHexToBase64, fixFeeNative,
  getDlnQuote, getDlnTx
} from '../lib/dln';
import { solanaAddress, signAndSendSolana } from '../lib/solanaWallet';
import { useAppStore } from '../store/useAppStore';
import { POINT_VALUES } from '../lib/ranks';
import { IconPhone } from './Icons';
import InfoBox from './InfoBox';

/**
 * SOLANA ORIGIN — deBridge DLN, signed in the user's Solana wallet.
 * ---------------------------------------------------------------------------
 * A genuinely different operation from the EVM token tab and deliberately its
 * own panel, the same way THORChain and Tron are:
 *
 *   · the source token is a base58 mint (SOL / USDC / USDT on Solana);
 *   · the fee goes to a Solana address (server/dln.js decides it and the UI
 *     never sees it);
 *   · the order is a serialized VersionedTransaction — `data` only, no ERC-20
 *     approval, no `to`, no `value`;
 *   · execution is `signAndSendSolana`, the same shared wallet path the
 *     Solana swap uses (Phantom/Solflare/Backpack injected, Wallet Standard,
 *     MWA, and RPC broadcast for providers that only sign).
 *
 * Everything is quoted and built by the server (same /api/dln endpoints the
 * EVM path uses); this panel computes no rate and never falls back to one.
 * A destination EVM address is required: a Solana origin always lands on an
 * EVM chain, so there is no "same address" shortcut.
 */

/*
 * Destinations are exactly the chains `tokensFor()` knows, because the
 * destination token must be a canonical address we can verify. Linea is in
 * `DLN_EXTRA_CHAINS` for the EVM comparison, but this panel has no token
 * table for it yet, so offering it would produce a dest-token dropdown that
 * is empty at runtime.
 */
const DLN_DST_CHAINS = BRIDGE_CHAINS.map((c) => ({ id: c.id, name: c.name }));

export default function SolanaBridgePanel() {
  useHideBalances();
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const navigate = useNavigate();
  const evmWallet = useWallet();

  /* Connected or not, read from the shared module state + the same event the
     Solana tab emits; the panel never owns a connection flow. */
  const [address, setAddress] = useState(() => solanaAddress());
  useEffect(() => {
    const onWalletChange = (event) => setAddress(event?.detail?.address || solanaAddress() || null);
    window.addEventListener('solana:wallet-change', onWalletChange);
    return () => window.removeEventListener('solana:wallet-change', onWalletChange);
  }, []);

  const [srcToken, setSrcToken] = useState(DLN_SOLANA.tokens[0]);
  const [dstChain, setDstChain] = useState(8453);
  const [dstTokenSymbol, setDstTokenSymbol] = useState('USDC');
  const [amount, setAmount] = useState('');
  const [toAddress, setToAddress] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [txErr, setTxErr] = useState(null);
  const [ready, setReady] = useState(false);
  const seq = useRef(0);

  const dstTokens = useMemo(() => tokensFor(dstChain), [dstChain]);
  const dstToken = useMemo(
    () => dstTokens.find((x) => x.symbol === dstTokenSymbol) ?? dstTokens[0],
    [dstTokens, dstTokenSymbol]
  );

  const toAddressValid = /^0x[a-fA-F0-9]{40}$/.test(toAddress.trim());
  const hasRecipient = toAddressValid || !!evmWallet?.address;

  /* Default the destination to the user's EVM wallet when one is connected —
     the safe default without hiding the field, and they can still retype it. */
  useEffect(() => {
    if (!toAddress && evmWallet?.address) setToAddress(evmWallet.address);
  }, [evmWallet?.address, toAddress]);

  const fetchQuote = useCallback(async () => {
    const mine = ++seq.current;
    setQuoteErr(null);
    if (!address) return;
    if (!srcToken || !dstToken) return;

    const raw = toBaseUnits(amount, srcToken.decimals);
    if (!raw) {
      setQuote(null);
      return;
    }

    setQuoting(true);
    try {
      const q = await getDlnQuote({
        srcChainId: DLN_SOLANA.chainId,
        srcChainTokenIn: srcToken.address,
        srcChainTokenInAmount: raw,
        dstChainId: dstChain,
        dstChainTokenOut: dstToken.address
      });
      if (seq.current !== mine) return;
      setQuote(q);
    } catch (e) {
      if (seq.current !== mine) return;
      setQuote(null);
      setQuoteErr(e?.code || 'QUOTE_FAILED');
    } finally {
      if (seq.current === mine) setQuoting(false);
    }
  }, [address, srcToken, dstToken, dstChain, amount]);

  useEffect(() => {
    const timer = setTimeout(fetchQuote, 500);
    return () => clearTimeout(timer);
  }, [fetchQuote]);

  /* Fixed fee in SOL (lamports, 9 decimals) + its weight against the transfer.
     The USD conversion needs a SOL price; when the source IS SOL the quote's
     own USD value of the source amount and the typed amount give it without a
     third call. For USDC/USDT sources there is no honest price in the quote
     (the fee is paid in SOL, the input is not), so the SOL amount is shown and
     neither the USD figure nor the warning is invented. */
  const fixedFeeNative = useMemo(
    () => fixFeeNative(quote?.fixFee, DLN_SOLANA.nativeDecimals),
    [quote]
  );
  const burdenPct = useMemo(() => {
    if (!srcToken?.native) return null;
    const fee = Number(fixedFeeNative);
    const fromUsd = Number(quote?.fromAmountUsd);
    const srcUnits = Number(amount) / 10 ** (srcToken.decimals ?? 9);
    if (!Number.isFinite(fee) || fee <= 0) return null;
    if (!Number.isFinite(fromUsd) || fromUsd <= 0) return null;
    if (!Number.isFinite(srcUnits) || srcUnits <= 0) return null;
    const solUsd = fromUsd / srcUnits;
    const feeUsd = fee * solUsd;
    const percent = (feeUsd / fromUsd) * 100;
    return { feeUsd, percent, severe: percent > 3 };
  }, [fixedFeeNative, quote, srcToken, amount]);

  const execute = async () => {
    if (!address) return;
    setBusy(true);
    setTxErr(null);
    haptic?.('medium');
    try {
      const raw = toBaseUnits(amount, srcToken.decimals);
      if (!raw) throw new Error('BAD_AMOUNT');
      if (!toAddressValid) throw new Error('NO_RECIPIENT');

      const order = await getDlnTx({
        srcChainId: DLN_SOLANA.chainId,
        srcChainTokenIn: srcToken.address,
        srcChainTokenInAmount: raw,
        dstChainId: dstChain,
        dstChainTokenOut: dstToken.address,
        senderAddress: address,
        dstChainTokenOutRecipient: toAddress.trim()
      });

      /*
       * Solana tx shape: `data` only (0x-hex of the serialized versioned
       * transaction). No `to`, no `value`, no approval — that is the branch
       * the EVM path never takes. The dead host is refused up front, never
       * sent to the wallet half-converted.
       */
      const base64 = dlnHexToBase64(order?.tx?.data);
      if (!base64) throw new Error('NO_ROUTE');

      const sig = await signAndSendSolana(base64, true);
      if (!sig) throw new Error('TX_FAILED');
      setTxHash(sig);
      haptic?.('success');
      const rewards = useAppStore.getState();
      rewards.awardPoints('bridge', POINT_VALUES.bridge, {
        network: 'solana', chainId: 'solana', txHash: sig
      });
    } catch (e) {
      setTxErr(e?.shortMessage || e?.message || 'TX_FAILED');
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  /* Give the explorer a moment to index before offering the link. */
  useEffect(() => {
    if (!txHash) { setReady(false); return undefined; }
    setReady(false);
    const timer = setTimeout(() => setReady(true), 3500);
    return () => clearTimeout(timer);
  }, [txHash]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <InfoBox title={t('bridge.solana.whatTitle')} tone="info" id="bridge-solana-what">
        <p>{t('bridge.solana.whatBody')}</p>
      </InfoBox>

      <motion.section className="card">
        <div className="field-label">{t('bridge.solana.origin')}</div>
        <div className="brg-row">
          <select
            className="brg-select"
            value={srcToken.symbol}
            onChange={(e) => { setSrcToken(DLN_SOLANA.tokens.find((x) => x.symbol === e.target.value) ?? DLN_SOLANA.tokens[0]); setQuote(null); }}
          >
            {DLN_SOLANA.tokens.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol} · {t('bridge.solana.onSolana')}</option>)}
          </select>
          <input
            className="brg-amount"
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={t('bridge.solana.amount')}
          />
        </div>

        <div className="field-label" style={{ marginTop: 12 }}>{t('bridge.solana.destination')}</div>
        <div className="brg-row">
          <select
            className="brg-select"
            value={dstChain}
            onChange={(e) => { setDstChain(Number(e.target.value)); setQuote(null); }}
          >
            {DLN_DST_CHAINS.map((c) => <option key={c.id} value={c.id}>{c.name} · {dstTokens.length ? dstTokens[0]?.symbol : 'USDC'}</option>)}
          </select>
          <select
            className="brg-select"
            value={dstToken?.symbol ?? ''}
            onChange={(e) => { setDstTokenSymbol(e.target.value); setQuote(null); }}
          >
            {dstTokens.map((x) => <option key={x.symbol} value={x.symbol}>{x.symbol}</option>)}
          </select>
        </div>

        <div className="field-label" style={{ marginTop: 12 }}>{t('bridge.solana.recipient')}</div>
        <input
          className="brg-amount"
          type="text"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="0x…"
          value={toAddress}
          onChange={(e) => setToAddress(e.target.value.trim())}
          style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
        {toAddress !== '' && !toAddressValid && (
          <p className="notice notice-danger" style={{ marginTop: 8 }}>{t('bridge.solana.badDestination')}</p>
        )}
        {!!address && (
          <div className="row" style={{ gap: 7, marginTop: 7 }}>
            <span className="dot" style={{ background: 'var(--up)' }} />
            <span className="faint" style={{ fontSize: 11.5 }}>
              {t('bridge.solana.sender', { address: `${address.slice(0, 4)}…${address.slice(-4)}` })}
            </span>
          </div>
        )}

        {!address ? (
          <button className="btn btn-primary" style={{ marginTop: 12, width: '100%' }} onClick={() => navigate('/wallet?tab=solana')}>
            <IconPhone width={16} height={16} /> {t('bridge.solana.connectSolana')}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            style={{ marginTop: 12, width: '100%' }}
            disabled={busy || quoting || !quote?.toAmount || !toAddressValid}
            onClick={execute}
          >
            {busy ? t('bridge.sending') : t('bridge.send')}
          </button>
        )}

        {address && !toAddressValid && (
          <p className="notice" style={{ margin: '8px 0 0' }}>{t('bridge.solana.recipientRequired')}</p>
        )}

        {quoting && <p className="faint" style={{ marginTop: 10 }}>{t('bridge.quoting')}</p>}

        {quote?.toAmount && (
          <div className="brg-quote" style={{ marginTop: 10 }}>
            <div className="row-between">
              <span className="faint">{t('bridge.youReceive')}</span>
              <span className="mono" style={{ fontWeight: 800 }}>
                {Number(quote.toAmount) / 10 ** (dstToken?.decimals ?? 6)} {dstToken?.symbol}
              </span>
            </div>
            {quote.toAmountUsd != null && (
              <div className="row-between">
                <span className="faint">{t('bridge.solana.value')}</span>
                <span className="mono">{fmtUsd(quote.toAmountUsd)}</span>
              </div>
            )}
            {fixedFeeNative != null && (
              <div className="row-between">
                <span className="faint">{t('bridge.solana.fixedFee')}</span>
                <span className="mono">
                  {fixedFeeNative} SOL{burdenPct?.feeUsd != null ? ` · ${fmtUsd(burdenPct.feeUsd)}` : ''}
                </span>
              </div>
            )}
            {quote.affiliateFee?.bps != null && (
              <div className="row-between">
                <span className="faint">{t('bridge.solana.affiliateFee')}</span>
                <span className="mono">{quote.affiliateFee.bps / 100}%</span>
              </div>
            )}
            {quote.delaySec != null && (
              <div className="row-between">
                <span className="faint">{t('bridge.eta')}</span>
                <span className="mono">{Math.max(1, Math.round(quote.delaySec / 60))} min</span>
              </div>
            )}
            {burdenPct?.severe && (
              <p className="notice notice-danger" style={{ margin: '8px 0 0' }}>
                {t('bridge.solana.fixedFeeWarn', { pct: burdenPct.percent.toFixed(1) })}
              </p>
            )}
          </div>
        )}

        {!quoting && !quote?.toAmount && !quoteErr && address && amount && (
          <p className="faint" style={{ marginTop: 10, fontSize: 11.5 }}>{t('bridge.solana.noRoute')}</p>
        )}
        {quoteErr && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('bridge.solana.quoteFailed')}</p>}
        {txErr && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('bridge.solana.sendFailed')}</p>}
        {ready && txHash && (
          <a
            className="faint"
            style={{ display: 'block', marginTop: 10, fontSize: 11.5, overflowWrap: 'anywhere' }}
            href={`https://solscan.io/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
          >
            {txHash}
          </a>
        )}

        <div className="row" style={{ gap: 7, marginTop: 10 }}>
          <span className="dot" style={{ background: 'var(--up)' }} />
          <span className="faint" style={{ fontSize: 11.5 }}>{t('bridge.solana.affiliateNote')}</span>
        </div>
      </motion.section>

      <InfoBox title={t('bridge.solana.tokensTitle')} tone="warn">
        <p>{t('bridge.solana.tokensBody')}</p>
      </InfoBox>
    </motion.div>
  );
}
