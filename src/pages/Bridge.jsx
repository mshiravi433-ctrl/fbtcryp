import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import {
  compareRoutes,
  fixFeeNative,
  fixedFeeBurden,
  getDlnQuote,
  getDlnTx
} from '../lib/dln';
import { IconExternal, IconShield, IconSwap } from '../components/Icons';
import InfoBox from '../components/InfoBox';
import SegIndicator from '../components/SegIndicator';
import { useSettingsStore } from '../store/useSettingsStore';

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

/*
 * The three tabs. `native` (THORChain) and `tron` are entirely different
 * operations from the LI.FI token path — each pulls its own client library
 * and its own set of rules — so they are loaded on demand rather than paid
 * for on every visit to the bridge. Keeping them behind `lazy()` is the same
 * decision the router already makes for every page; these are sub-pages.
 */
const ThorPanel = lazy(() => import('../components/ThorPanel'));
const TronPanel = lazy(() => import('../components/TronPanel'));

const MODES = ['tokens', 'native', 'tron'];
const PROVIDERS = ['lifi', 'dln'];

/*
 * ─── WHY THESE TWO CARDS ARE MEMOISED ──────────────────────────────────────
 * WalletContext polls the balance every 30s, and every poll re-renders any
 * screen that reads `useWallet()`. These two sections are pure copy — they
 * depend on nothing but the active language — so re-rendering them on every
 * balance tick was wasted reconciliation for zero visual change. `memo` with
 * no props means React keeps the previous element and never descends into it.
 */
const WhatBridge = memo(function WhatBridge() {
  const { t } = useTranslation();
  return (
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
  );
});

const RiskCard = memo(function RiskCard() {
  const { t } = useTranslation();
  return (
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
  );
});

/*
 * A skeleton that matches the quote card it replaces, so the ticket does not
 * jump in height when a quote lands. The generic `.skel` shimmer is reused so
 * the loading state shares the app's existing motion language.
 */
function QuoteSkeleton({ marginTop = 10 }) {
  return (
    <div className="brg-quote" style={{ marginTop }} aria-hidden="true">
      <div className="skel" style={{ height: 13, width: '42%' }} />
      <div className="skel" style={{ height: 13, width: '64%' }} />
      <div className="skel" style={{ height: 13, width: '52%' }} />
    </div>
  );
}

/* The fallback for the lazy tab panels — same skeleton language. */
function PanelSkeleton() {
  return (
    <div className="card" style={{ marginTop: 12 }} aria-hidden="true">
      <div className="skel" style={{ height: 44, marginBottom: 12 }} />
      <div className="skel" style={{ height: 44, marginBottom: 12 }} />
      <div className="skel" style={{ height: 52 }} />
    </div>
  );
}

export default function Bridge() {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  /*
   * ─── TWO DIFFERENT OPERATIONS, TWO TABS ─────────────────────────────────
   * `tokens` is the LI.FI path: ERC-20 between EVM chains, signed by a
   * connected wallet. `native` is THORChain: real BTC for real ETH, executed
   * by sending coins with a memo from whatever wallet holds them — no connect
   * step, and possibly no EVM wallet at all.
   *
   * Folding both into one form would mean half the fields vanishing depending
   * on the pair. Two tabs is honest about them being different acts.
   */
  const [mode, setMode] = useState('tokens');

  const [fromChain, setFromChain] = useState(56);
  const [toChain, setToChain] = useState(42161);
  const [tokenSymbol, setTokenSymbol] = useState('USDT');
  const [amount, setAmount] = useState('');

  /*
   * Deep link prefill (phase 153): the Intent OS cross-chain desk sends the
   * user here for the real bridge handoff with its planned leg as context —
   * ?fromChain=&toChain=&token=&amount=. Values are applied ONLY when they
   * match what this screen can actually quote, and the query is then cleared
   * so a refresh keeps whatever the user has since edited.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const fc = Number(searchParams.get('fromChain'));
    const tc = Number(searchParams.get('toChain'));
    const tk = (searchParams.get('token') || '').toUpperCase();
    const am = searchParams.get('amount');
    if (BRIDGE_CHAINS.some((c) => c.id === fc)) setFromChain(fc);
    if (BRIDGE_CHAINS.some((c) => c.id === tc) && tc !== fc) setToChain(tc);
    if (tk && tokensFor(fc).some((t) => t.symbol === tk)) setTokenSymbol(tk);
    if (am && Number(am) > 0) setAmount(String(am));
    if (searchParams.toString()) setSearchParams(new URLSearchParams(), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState(null);

  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [txErr, setTxErr] = useState(null);

  /*
   * ─── THE SECOND PROVIDER ────────────────────────────────────────────────
   * deBridge DLN pays us 70 bps where LI.FI pays 30, and needs no key and no
   * account. It is quoted ALONGSIDE LI.FI rather than replacing it, because
   * DLN adds a fixed protocol fee in the origin chain's native coin: measured
   * today on Base that is 0.001 ETH, which is 0.19% of a $1,000 transfer and
   * 19% of a $10 one.
   *
   * That asymmetry is why `provider` is a user choice with a default of
   * `lifi`. Silently routing to whichever pays us more would, on small
   * transfers, be routing to whichever costs the user more — and we would be
   * the only party who could see it.
   */
  const [dln, setDln] = useState(null);
  const [provider, setProvider] = useState('lifi');

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

  /*
   * ─── PRICING THE FIXED FEE, WITHOUT A NEW DEPENDENCY ────────────────────
   * The fixed fee is quoted in wei of the origin chain's native coin, and
   * comparing the two providers is meaningless until it is in dollars. LI.FI's
   * own quote already carries that coin's USD price in its gas breakdown, so
   * the figure comes from a request the screen makes anyway — priced at the
   * same moment as everything else it is being compared against.
   *
   * When LI.FI has not answered, this stays null and `compareRoutes` returns
   * no winner rather than guessing.
   */
  const dlnFixedUsd = useMemo(() => {
    if (dln?.fixFee == null || summary?.nativePriceUsd == null) return null;
    const native = Number(fixFeeNative(dln.fixFee));
    if (!Number.isFinite(native)) return null;
    return native * summary.nativePriceUsd;
  }, [dln, summary]);

  const burden = useMemo(
    () => fixedFeeBurden(dlnFixedUsd, summary?.fromAmountUsd),
    [dlnFixedUsd, summary]
  );

  const comparison = useMemo(
    () => compareRoutes(
      { toAmount: summary?.toAmount },
      { toAmount: dln?.toAmount, fixFeeUsd: dlnFixedUsd },
      toToken?.decimals ?? 6
    ),
    [summary, dln, dlnFixedUsd, toToken]
  );

  /* ------------------------------- quoting ------------------------------- */

  const timerRef = useRef(null);
  /*
   * A sequence guard, in addition to the debounce. The debounce stops a
   * keystroke storm; the guard stops the race the debounce cannot: a slow
   * request for an OLD pair that finally resolves AFTER a newer request has
   * already painted its quote. Without it the stale response overwrites the
   * fresh one and the screen shows the wrong route for the selected pair.
   */
  const seq = useRef(0);

  /*
   * ─── THE OPTIONS THE SWAP SCREEN HAS AND THIS ONE DID NOT ───────────────
   * Asked for: «اپشن های موجود که الان هست را در صفحه پل بیار».
   *
   * Two were genuinely missing, and one of them was a silent bug:
   *
   * 1. SLIPPAGE. `server/bridge.js` has always accepted `slippage` in its
   *    allow-list, and this screen never sent one — so every bridge quote
   *    used LI.FI's default while the user's own setting, which the swap
   *    screen respects, was ignored. Someone who set 0.1% for safety was
   *    getting something else here and had no way to know.
   *
   * 2. A DESTINATION ADDRESS. Bridging to an exchange deposit address or to a
   *    different wallet is one of the main reasons people bridge at all, and
   *    LI.FI supports `toAddress`. Without it the funds could only ever land
   *    on the same address they left from.
   *
   * Deliberately NOT copied from the swap screen: expert mode. There it
   * unlocks high-slippage swaps you can retry cheaply. A bridge takes minutes
   * and cannot be retried without paying gas twice, so "let me set 40%
   * slippage" is a foot-gun with a much longer fuse.
   */
  const slippage = useSettingsStore((st) => st.defaultSlippage);

  /*
   * Empty means "same address as the sender", which is both the safe default
   * and what the screen did before. Only a deliberately entered value
   * changes the destination.
   */
  const [toAddress, setToAddress] = useState('');
  const toAddressValid = toAddress === '' || /^0x[a-fA-F0-9]{40}$/.test(toAddress.trim());

  const fetchQuote = useCallback(async () => {
    const mine = ++seq.current;
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
        fromAmount: raw,
        /*
         * LI.FI wants a fraction (0.005), the setting is a percentage (0.5).
         * Getting this wrong by 100x would either fail every quote or accept
         * catastrophic slippage, so the conversion is explicit here rather
         * than assumed to match.
         */
        slippage: Number(slippage) / 100,
        /* Omitted entirely when blank — an empty string would be forwarded
           as a literal and rejected. */
        ...(toAddress.trim() && toAddressValid ? { toAddress: toAddress.trim() } : {})
      });
      if (seq.current !== mine) return;
      setQuote(q);
    } catch (e) {
      if (seq.current !== mine) return;
      setQuote(null);
      setQuoteErr(e.code || 'QUOTE_FAILED');
    } finally {
      if (seq.current === mine) setQuoting(false);
    }

    /*
     * DLN is asked SEPARATELY and its failure is swallowed.
     *
     * A second provider must never be able to break the first. If deBridge is
     * down, rate-limiting us, or has no route for this pair, the LI.FI quote
     * above is already set and the screen keeps working with one option — the
     * comparison row simply does not appear. Awaiting both together, or
     * letting this throw, would turn an optional upgrade into a new way for
     * the whole screen to fail.
     */
    try {
      const d = await getDlnQuote({
        srcChainId: fromChain,
        srcChainTokenIn: fromToken.address,
        srcChainTokenInAmount: raw,
        dstChainId: toChain,
        dstChainTokenOut: toToken.address
      });
      if (seq.current !== mine) return;
      setDln(d);
    } catch {
      if (seq.current === mine) setDln(null);
    }
  }, [wallet.isConnected, wallet.address, fromChain, toChain, fromToken, toToken, amount,
      slippage, toAddress, toAddressValid]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fetchQuote, DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [fetchQuote]);

  /* ------------------------------ execution ------------------------------ */

  /**
   * Execute through deBridge.
   *
   * ─── WHY THIS IS A SEPARATE FUNCTION AND NOT A BRANCH ───────────────────
   * DLN needs three things LI.FI's path does not: its own approval, to its own
   * spender, and a transaction whose `value` carries the fixed protocol fee in
   * native coin. Folding that into the existing `run()` as conditionals would
   * put four `if (provider === …)` branches inside the one function in this
   * screen that moves real money.
   *
   * The order is BUILT HERE rather than reused from the price quote: the price
   * call deliberately sends no addresses, so it cannot produce a signable
   * order. Building it at the moment of signing also re-prices it, which is
   * the same protection the swap screen's re-quote gives.
   */
  const runDln = async () => {
    setBusy(true);
    setTxErr(null);
    haptic?.('medium');

    try {
      if (wallet.chainId !== fromChain) {
        await wallet.switchChain?.(fromChain);
      }
      const signer = wallet.getSigner?.();
      if (!signer) throw new Error('NO_SIGNER');

      const raw = toBaseUnits(amount, fromToken.decimals);
      if (!raw) throw new Error('BAD_AMOUNT');

      const order = await getDlnTx({
        srcChainId: fromChain,
        srcChainTokenIn: fromToken.address,
        srcChainTokenInAmount: raw,
        dstChainId: toChain,
        dstChainTokenOut: toToken.address,
        senderAddress: wallet.address,
        ...(toAddress.trim() && toAddressValid
          ? { dstChainTokenOutRecipient: toAddress.trim() }
          : {})
      });

      if (!order?.tx?.data || !order?.tx?.to) throw new Error('NO_ROUTE');

      /*
       * Approve DLN's own spender, for this amount only.
       *
       * The allowance target differs per chain and is returned by the quote,
       * so it is read from the response rather than hard-coded — a wrong
       * spender here does not fail loudly, it fails at signing time with an
       * opaque revert. Exact-amount approval, never infinite: the same rule
       * lib/swap.js documents.
       */
      const { Contract } = await import('ethers');
      const { ERC20_ABI } = await import('../lib/chains');
      const erc20 = new Contract(fromToken.address, ERC20_ABI, signer);
      const spender = dln?.allowanceTarget || order.tx.to;
      const need = BigInt(raw);
      const current = await erc20.allowance(wallet.address, spender);

      if (current < need) {
        /* Some ERC-20s reject a non-zero to non-zero change; zero it first. */
        if (current > 0n) {
          const reset = await erc20.approve(spender, 0n);
          await reset.wait();
        }
        const approval = await erc20.approve(spender, need);
        await approval.wait();
      }

      const sent = await signer.sendTransaction({
        to: order.tx.to,
        data: order.tx.data,
        /*
         * The fixed protocol fee travels in `value`, in native coin. Dropping
         * it produces a revert that costs gas and explains nothing, so it is
         * passed through exactly as returned.
         */
        value: order.tx.value ?? undefined
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

  const run = async () => {
    if (provider === 'dln') return runDln();

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

  return (
    <PageTransition>
      <motion.div variants={riseIn} initial="hidden" animate="show">
        <h1 className="h1">{t('bridge.title')}</h1>
        <p className="muted">{t('bridge.subtitle')}</p>
      </motion.div>

      <div className="segmented seg-lg" role="tablist">
        {MODES.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={mode === k}
            className={mode === k ? 'active' : ''}
            onClick={() => setMode(k)}
            style={{ isolation: 'isolate' }}
          >
            {mode === k && <SegIndicator id="bridgemode" />}
            {t(`bridge.mode.${k}`)}
          </button>
        ))}
      </div>

      {/*
        A third tab rather than an option inside the first. Tron is not another
        EVM chain: the destination is a different address FORMAT, the fee rules
        differ (0x refuse a fee on a Tron origin), and the flat activation cost
        needs its own warning. Folding it into the token form would produce
        fields that change meaning depending on a dropdown.
      */}
      {mode === 'tron' ? (
        <Suspense fallback={<PanelSkeleton />}>
          <TronPanel />
        </Suspense>
      ) : mode === 'native' ? (
        <Suspense fallback={<PanelSkeleton />}>
          <ThorPanel />
        </Suspense>
      ) : (
        <>

      {/* what this is, before anything is tapped */}
      <WhatBridge />

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

        {quoting && <QuoteSkeleton />}

        {/*
          ─── THE OPTIONS, FOLDED ────────────────────────────────────────────
          Collapsed because the correct answer for almost everyone is the
          default: send to your own address, at the slippage you already set
          once in Settings. Expanding it is for the minority bridging to an
          exchange deposit address, and putting that in front of everybody
          would add two fields to the main path for a case most users never
          have.
        */}
        <div style={{ marginTop: 12 }}>
          <InfoBox title={t('bridge.optionsTitle')} tone="info" id="bridge-options">
            <p>{t('bridge.slippageNote', { pct: slippage })}</p>

            <label className="ord-field" style={{ marginTop: 4 }}>
              <span className="faint">{t('bridge.toAddressLabel')}</span>
              <input
                type="text"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
                placeholder={wallet.address ?? '0x…'}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                style={{
                  direction: 'ltr', textAlign: 'left',
                  fontFamily: 'var(--font-mono)', fontSize: 12
                }}
              />
            </label>

            {/*
              An invalid address must block the quote rather than be silently
              dropped — a bridge that quietly sent to a different destination
              than the one typed would be unrecoverable.
            */}
            {!toAddressValid && (
              <p className="notice notice-danger" style={{ marginTop: 9 }}>
                {t('bridge.badToAddress')}
              </p>
            )}
            <p style={{ marginTop: 9 }}>{t('bridge.toAddressNote')}</p>
          </InfoBox>
        </div>

        {quoteErr && !quoting && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {t(`bridge.err.${quoteErr}`, { defaultValue: t('bridge.err.QUOTE_FAILED') })}
          </p>
        )}

        {/* Empty state: connected, but no amount yet, so nothing to quote. */}
        {!quoting && !quoteErr && !summary && wallet.isConnected && (
          <div className="empty" style={{ padding: '18px 12px 6px', fontSize: 12 }}>
            <span className="empty-icon">⇄</span>
            {t('bridge.emptyHint')}
          </div>
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

        {/*
          ─── THE SECOND ROUTE, SHOWN NOT CHOSEN ───────────────────────────
          deBridge pays us more than twice what LI.FI does, which is exactly
          why the app must not pick it silently. Its fixed protocol fee is
          negligible on a large transfer and can exceed a sixth of a small
          one, so both routes are shown with that fee on its own line and the
          user decides.

          Rendered only when DLN actually answered with a route. An empty
          "compare" box that never populates is worse than no box.
        */}
        {dln?.toAmount && !quoting && (
          <div className="brg-quote" style={{ marginTop: 10 }}>
            <div className="field-label" style={{ marginTop: 0 }}>{t('bridge.routesTitle')}</div>

            <div className="segmented">
              {PROVIDERS.map((k) => (
                <button
                  key={k}
                  className={provider === k ? 'active' : ''}
                  onClick={() => setProvider(k)}
                  style={{ isolation: 'isolate' }}
                >
                  {provider === k && <SegIndicator id="brgprov" />}
                  {t(`bridge.provider.${k}`)}
                </button>
              ))}
            </div>

            <div className="row-between" style={{ marginTop: 8 }}>
              <span className="faint">{t('bridge.provider.dln')}</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {fromBaseUnits(dln.toAmount, toToken?.decimals ?? 6)} {toToken?.symbol}
              </span>
            </div>

            {/*
              The fixed fee is stated in the coin it is actually charged in,
              and in dollars when we can price it. Showing only the dollar
              figure would hide that the user needs that much NATIVE coin in
              the wallet — a separate requirement, and a common reason a
              bridge fails at signing.
            */}
            {dln.fixFee != null && (
              <div className="row-between">
                <span className="faint">{t('bridge.fixedFee')}</span>
                <span className="mono" style={{ fontSize: 12 }}>
                  {fixFeeNative(dln.fixFee)} {summary?.nativeSymbol ?? ''}
                  {dlnFixedUsd != null ? ` · ${fmtUsd(dlnFixedUsd)}` : ''}
                </span>
              </div>
            )}

            {/*
              The warning that makes this honest. A fixed fee worth 19% of the
              transfer is the single thing that turns the better-paying route
              into the wrong one, and it is invisible in the output amount.
            */}
            {burden?.severe && (
              <p className="notice notice-danger" style={{ marginTop: 9 }}>
                {t('bridge.fixedFeeWarn', { pct: burden.percent.toFixed(1) })}
              </p>
            )}

            {/*
              When the native coin could not be priced we say so instead of
              declaring a winner. A comparison that ignores a fee we know
              exists is worse than no comparison.
            */}
            {comparison.reason === 'FIXED_FEE_UNPRICED' && (
              <p className="faint" style={{ marginTop: 9, fontSize: 12 }}>
                {t('bridge.cannotCompare')}
              </p>
            )}
            {comparison.winner && (
              <p className="faint" style={{ marginTop: 9, fontSize: 12 }}>
                {t('bridge.betterRoute', {
                  name: t(`bridge.provider.${comparison.winner}`),
                  amount: fmtUsd(comparison.differenceUsd)
                })}
              </p>
            )}
          </div>
        )}

        {!wallet.isConnected ? (
          <p className="notice" style={{ marginTop: 12 }}>{t('bridge.connectFirst')}</p>
        ) : (
          <button
            className="btn btn-primary"
            style={{ marginTop: 12, width: '100%' }}
            /*
             * Each provider gates on ITS OWN readiness. Gating the DLN button
             * on LI.FI's `transactionRequest` would disable a working route
             * whenever the other provider had no path — which is precisely
             * when the second route is most valuable.
             */
            disabled={busy || (provider === 'dln' ? !dln?.toAmount : !quote?.transactionRequest)}
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
              /*
               * The tracker has to match the provider that actually executed.
               * scan.li.fi knows nothing about a DLN order and would show a
               * "not found" page — which reads as "my money is gone" at the
               * exact moment the user is most anxious.
               */
              href={
                provider === 'dln'
                  ? `https://app.debridge.finance/orders?s=${txHash}`
                  : `https://scan.li.fi/tx/${txHash}`
              }
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
      <RiskCard />

        </>
      )}

      {/* Shared by both modes: the risk applies either way. */}
      <p className="notice notice-danger">{t('bridge.disclaimer')}</p>
    </PageTransition>
  );
}
