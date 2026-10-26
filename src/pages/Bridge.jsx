import BridgeSigningReview from '../components/BridgeSigningReview';
import { validateBridgeRequest, assertBridgeSigner, assertBridgeContracts } from '../lib/bridgeSafety';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { fmtUsd } from '../lib/format';
import { bridgeErrorFromException, bridgeErrorText, bridgeExecutionCode } from '../lib/bridgeErrors';
import {
  BRIDGE_CHAINS,
  fromBaseUnits,
  toBaseUnits,
  tokensFor
} from '../lib/bridge';
import {
  compareRoutes,
  dlnSupportsChain,
  fixFeeNative,
  fixedFeeBurden,
  getDlnQuote,
  getDlnTx
} from '../lib/dln';
/*
 * ─── THE SHARED CROSS-CHAIN SERVICE ────────────────────────────────────────
 * This page and the Intent OS «میان‌زنجیره‌ای» desk used to be two systems: a
 * real LI.FI integration here, and a hard-coded rate there. Both now go
 * through /services/cross-chain — the same quote engine, the same ranking, the
 * same execution pipeline (balance → allowance → chain → re-quote → signature
 * → broadcast) and the same tracked history.
 *
 * The legacy /api/bridge/quote contract documented in src/pages/Developers.jsx
 * still exists (src/lib/bridge.js), but the screen itself now quotes, ranks
 * and executes through the shared service.
 */
import { crossChainService } from '../services/cross-chain';
import CrossChainStatus from '../components/crosschain/CrossChainStatus';
import CrossChainHistory from '../components/crosschain/CrossChainHistory';
import { IconExternal, IconRoute, IconShield, IconSwap, IconWallet } from '../components/Icons';
import InfoBox from '../components/InfoBox';
import SegIndicator from '../components/SegIndicator';
import FarmPromoBanner from '../components/FarmPromoBanner';
import '../styles/bridge-modern.css';
import ModernSelect from '../components/ModernSelect';
import AssetIcon from '../components/AssetIcon';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppStore } from '../store/useAppStore';
import { POINT_VALUES } from '../lib/ranks';

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
 * The four tabs. `native` (THORChain), `tron` and `solana` are entirely
 * different operations from the LI.FI token path — each pulls its own client
 * library and its own set of rules — so they are loaded on demand rather
 * than paid for on every visit to the bridge. Keeping them behind `lazy()`
 * is the same decision the router already makes for every page; these are
 * sub-pages.
 */
const ThorPanel = lazy(() => import('../components/ThorPanel'));
const TronPanel = lazy(() => import('../components/TronPanel'));
const SolanaBridgePanel = lazy(() => import('../components/SolanaBridgePanel'));

const MODES = ['tokens', 'native', 'tron', 'solana'];
const PROVIDERS = ['lifi', 'dln'];

/*
 * The asset class each route carries, printed under the tab label. Codes
 * rather than prose on purpose: USDT/USDC, BTC/ETH and TRC20 read the same in
 * every language the app ships, so this line never needs a translation and
 * never wraps on a 320px phone.
 */
const MODE_HINTS = {
  tokens: 'USDT · USDC',
  native: 'BTC · ETH',
  tron: 'TRC20',
  solana: 'SOL · SPL'
};

/*
 * A skeleton that matches the quote card it replaces, so the ticket does not
 * jump in height when a quote lands. The generic `.skel` shimmer is reused so
 * the loading state shares the app's existing motion language.
 */
function QuoteSkeleton({ marginTop = 10 }) {
  return (
    <div className="brg-skel" style={{ marginTop }} aria-hidden="true">
      <div className="skel" style={{ height: 12, width: '38%' }} />
      <div className="skel" style={{ height: 12, width: '58%' }} />
    </div>
  );
}

/* The fallback for the lazy tab panels — same skeleton language. */
function PanelSkeleton() {
  return (
    <div className="brg-panel-skel" aria-hidden="true">
      <div className="skel" style={{ height: 46, marginBottom: 10 }} />
      <div className="skel" style={{ height: 46, marginBottom: 10 }} />
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
   * connected wallet. `native` is a THORChain quote plus chain-specific
   * deposit guidance; this panel does not sign the native swap.
   *
   * Folding both into one form would mean half the fields vanishing depending
   * on the pair. Two tabs is honest about them being different acts.
   */
  const [mode, setMode] = useState('tokens');
  const [thorFromAsset, setThorFromAsset] = useState(null);
  const [thorToAsset, setThorToAsset] = useState(null);

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
    const tab = String(searchParams.get('mode') || '').toLowerCase();
    if (MODES.includes(tab)) setMode(tab);
    const thorFrom = searchParams.get('fromAsset');
    const thorTo = searchParams.get('toAsset');
    if (thorFrom) setThorFromAsset(thorFrom);
    if (thorTo) setThorToAsset(thorTo);
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
  const [quoteFormKey, setQuoteFormKey] = useState(null);
  const [dlnFormKey, setDlnFormKey] = useState(null);

  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [txErr, setTxErr] = useState(null);

  /*
   * Execution + tracking state. `tracked` is the ledger row the server owns:
   * it is the only thing allowed to say COMPLETED, and only once a
   * destination transaction hash exists.
   */
  const [routes, setRoutes] = useState([]);
  const [execStep, setExecStep] = useState(null);
  const [changedQuote, setChangedQuote] = useState(null);
  const [signingReview, setSigningReview] = useState(null);
  const signingDecision = useRef(null);
  const confirmSigning = (details) => new Promise((resolve) => {
    signingDecision.current?.(false);
    signingDecision.current = resolve;
    setSigningReview(details);
  });
  const finishSigningReview = (accepted) => {
    signingDecision.current?.(accepted);
    signingDecision.current = null;
    setSigningReview(null);
  };
  useEffect(() => () => { signingDecision.current?.(false); }, []);

  /*
   * ─── THE WAIT THE USER CAN LEAVE ────────────────────────────────────────
   * Reported: «وقتی می‌زنی که امضا کنی و برمی‌گردی بدون انجام کار، هنوز منتظر
   * می‌ماند بدون اینکه بفهمد لغو شده». Two things fix it:
   *
   *   1. The signing boundary keeps the original bounded request alive on
   *      return, so a delayed approval is not discarded while the relay
   *      recovers. Visibility alone cannot distinguish approval from Back.
   *   2. This page never trusts the wallet alone. `runToken` names the attempt
   *      in flight; a «لغو انتظار» button bumps it, so whatever the abandoned
   *      promise eventually resolves to is ignored, and the button is the
   *      user's own way out even if no event ever arrives.
   */
  const runToken = useRef(0);
  const [awaitingWallet, setAwaitingWallet] = useState(false);
  const cancelWaiting = () => {
    runToken.current += 1;
    signingDecision.current?.(false);
    signingDecision.current = null;
    setSigningReview(null);
    setChangedQuote(null);
    setBusy(false);
    setExecStep(null);
    setAwaitingWallet(false);
    setTxErr(bridgeErrorText('CANCELLED', t));
    haptic?.('light');
  };

  const [tracked, setTracked] = useState(null);
  const [historyKey, setHistoryKey] = useState(0);
  const stopTrackRef = useRef(null);
  useEffect(() => () => stopTrackRef.current?.(), []);

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

  /*
   * ─── ONE SHAPE FOR THE SCREEN, WHATEVER THE PROVIDER ────────────────────
   * The quote is already normalised by the shared engine (the same object the
   * Intent OS desk renders). This adapter keeps the field names this screen
   * has always used, so the itemised cost block below did not have to be
   * rewritten to gain a shared engine.
   */
  const summary = useMemo(() => (quote ? {
    tool: quote.tool,
    toolName: quote.toolName ?? quote.tool,
    nativePriceUsd: quote.nativePriceUsd,
    nativeSymbol: quote.nativeSymbol,
    fromAmountUsd: quote.fromAmountUsd,
    toAmountUsd: quote.toAmountUsd,
    toAmount: quote.toAmount,
    toAmountMin: quote.toAmountMin,
    feeUsd: (quote.bridgeFeeUsd || 0) + (quote.protocolFeeUsd || 0),
    gasUsd: quote.gasCostUsd,
    ourFeeUsd: quote.integratorFeeUsd,
    totalCostUsd: quote.totalCostUsd,
    durationSec: quote.estimatedTime
  } : null), [quote]);

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

  const formKey = JSON.stringify([fromChain, toChain, tokenSymbol, amount, wallet.address, toAddress, slippage]);

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
      /*
       * ─── ROUTES FIRST, THEN THE EXECUTABLE QUOTE ────────────────────────
       * "Take the first route" is how a user ends up on a path that is a few
       * cents better on paper and forty minutes slower in practice. The
       * service ranks every route the provider offers on output MINUS gas,
       * minus fees payable on top, minus time in flight, minus how many hops
       * can fail — and only then asks for the signable quote on the winner.
       */
      const params = {
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
      };

      let best = null;
      try {
        const ranked = await crossChainService.getRoutes(params);
        if (seq.current !== mine) return;
        setRoutes(ranked.routes);
        best = ranked.best;
      } catch {
        /* The comparison is an upgrade, not a dependency: a failed route list
           must not stop the quote below from working. */
        if (seq.current === mine) setRoutes([]);
      }

      const q = await crossChainService.getQuote({
        ...params,
        ...(best?.tool ? { preferTool: best.tool } : {})
      });
      if (seq.current !== mine) return;
      setQuote(q);
      setQuoteFormKey(formKey);
    } catch (e) {
      if (seq.current !== mine) return;
      setQuote(null);
      /* Keep the server's prose (0x validation text, upstream bodies) — it
         rides along as an evidence line rather than being discarded. */
      setQuoteErr({
        code: e.code || 'QUOTE_FAILED',
        detail: typeof e?.detail === 'string' && e.detail.trim() ? e.detail.slice(0, 220) : null
      });
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
     *
     * Since 2026-10-25 the chain list is wider than deBridge's own coverage
     * (it serves eight of the fifteen — see DLN_CHAIN_IDS in lib/dln.js).
     * For a pair it cannot serve the question is never asked: the server
     * would only answer UNSUPPORTED_CHAIN, and recording that as a provider
     * failure would make a healthy deBridge look broken in our own health
     * metrics. A leftover `provider: 'dln'` selection from a previous pair
     * falls back to LI.FI here too, so the CTA can never sit disabled behind
     * a comparison box that is never going to render.
     */
    if (!dlnSupportsChain(fromChain) || !dlnSupportsChain(toChain)) {
      if (seq.current === mine) {
        setDln(null);
        setProvider('lifi');
      }
      return;
    }
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
      setDlnFormKey(formKey);
    } catch {
      if (seq.current === mine) setDln(null);
    }
  }, [wallet.isConnected, wallet.address, fromChain, toChain, fromToken, toToken, amount,
      slippage, toAddress, toAddressValid, formKey]);

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
    const token = ++runToken.current;
    const alive = () => runToken.current === token;
    setBusy(true);
    setTxErr(null);
    setAwaitingWallet(true);
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
      // Only the freshly built order can choose the spender, never a stale price quote.
      const spender = order.tx.allowanceTarget || order.tx.to;
      const recipient = toAddress.trim() && toAddressValid ? toAddress.trim() : wallet.address;
      if (!validateBridgeRequest({ token: fromToken.address, spender, transaction: order.tx,
        chainId: fromChain, sender: wallet.address, recipient })) throw new Error('UNSAFE_BRIDGE_REQUEST');
      await assertBridgeSigner(signer, fromChain, wallet.address);
      await assertBridgeContracts(signer.provider, [order.tx.to, spender]);
      if (!await confirmSigning({ token: fromToken.address, spender, contract: order.tx.to,
        recipient, chainId: fromChain, provider: 'deBridge', amount: raw,
        decimals: fromToken.decimals, symbol: fromToken.symbol })) throw new Error('USER_REJECTED');
      await assertBridgeSigner(signer, fromChain, wallet.address);
      const need = BigInt(raw);
      const current = await erc20.allowance(wallet.address, spender);

      if (current < need) {
        /* Some ERC-20s reject a non-zero to non-zero change; zero it first. */
        if (current > 0n) {
          await assertBridgeSigner(signer, fromChain, wallet.address);
          const reset = await erc20.approve(spender, 0n, { chainId: Number(fromChain) });
          await reset.wait();
        }
        await assertBridgeSigner(signer, fromChain, wallet.address);
        const approval = await erc20.approve(spender, need, { chainId: Number(fromChain) });
        await approval.wait();
      }

      await assertBridgeSigner(signer, fromChain, wallet.address);
      const sent = await signer.sendTransaction({
        to: order.tx.to,
        chainId: Number(fromChain),
        data: order.tx.data,
        /*
         * The fixed protocol fee travels in `value`, in native coin. Dropping
         * it produces a revert that costs gas and explains nothing, so it is
         * passed through exactly as returned.
         */
        value: order.tx.value ?? undefined
      });

      if (!alive()) return;
      setTxHash(sent.hash);
      haptic?.('success');
      /* A broadcast bridge move is real rewarded activity: wallet + chain +
         txHash travel as the on-chain evidence. */
      if (sent.hash) {
        const rewards = useAppStore.getState();
        rewards.awardPoints('bridge', POINT_VALUES.bridge, {
          network: 'evm', chainId: fromChain, txHash: sent.hash
        });
      }
    } catch (e) {
      /*
       * Wallet prose (a `shortMessage`, a node's revert text) used to land
       * here RAW — English sentences on a Persian screen. Through
       * bridgeErrorFromException a code stays a translated sentence and prose
       * becomes evidence on a second ltr line instead of the headline.
       */
      if (!alive()) return;
      setTxErr(bridgeErrorFromException(e, t));
      haptic?.('error');
    } finally {
      if (alive()) {
        setBusy(false);
        setAwaitingWallet(false);
      }
    }
  };

  const run = async () => {
    if (busy || quoting) return;
    if (!toAddressValid) { setTxErr(bridgeErrorText('BAD_ADDRESS', t)); return; }
    if ((provider === 'dln' ? dlnFormKey : quoteFormKey) !== formKey) {
      setTxErr(bridgeErrorText('QUOTE_EXPIRED', t)); return;
    }
    if (provider === 'dln') return runDln();

    if (!quote) return;

    const token = ++runToken.current;
    const alive = () => runToken.current === token;
    setBusy(true);
    setTxErr(null);
    setAwaitingWallet(true);
    haptic?.('medium');

    /*
     * ─── ONE EXECUTION PIPELINE, SHARED WITH INTENT OS ──────────────────────
     * This used to be `signer.sendTransaction(quote.transactionRequest)` and
     * nothing else — no allowance check (so an ERC-20 bridge could revert
     * after the user paid gas), no balance check, no re-quote, and no record
     * of the transfer anywhere afterwards.
     *
     * `crossChainService.execute()` does the whole sequence the spec lists:
     * refresh the quote → validate balance → validate allowance (approving
     * the exact amount, never infinite) → validate the chain → validate the
     * destination → build → the USER's wallet signs → broadcast → write the
     * ledger row → track the source, the bridge and the destination.
     */
    let result;
    try {
      result = await crossChainService.execute(quote, {
        wallet,
        destination: toAddress.trim() && toAddressValid ? toAddress.trim() : '',
        slippage: Number(slippage) / 100,
        source: 'bridge',
        confirmSigning,
        onStep: (step) => { if (alive()) setExecStep(step); },
        /* The rate moved between display and signature: stop, show the new
           number and require a second, explicit yes. */
        confirmQuoteChange: async (fresh) => new Promise((resolve) => {
          setChangedQuote({ quote: fresh, resolve });
        })
      });
    } catch (error) {
      /* No unexpected provider/requote exception may strand the bridge in
         «in progress». Resolve it to an explicit rejected/failed result. */
      result = {
        ok: false,
        code: bridgeExecutionCode(error) || 'BROADCAST_FAILED',
        detail: String(error?.shortMessage || error?.message || error).slice(0, 220)
      };
    }

    /* The user already cancelled this attempt: whatever it became is not
       this screen's business any more. */
    if (!alive()) return;
    setBusy(false);
    setExecStep(null);
    setAwaitingWallet(false);

    if (!result.ok) {
      if (result.code === 'QUOTE_CHANGED') {
        setQuote(result.quote);
        setChangedQuote(null);
        return;
      }
      /*
       * `defaultValue: result.detail || result.code` printed the raw RPC
       * message or the machine code itself whenever `bridge.err` had no key
       * for it — which was for most codes. The whole map now exists: the code
       * picks the sentence, unknown codes fall back to a translated generic
       * that KEEPS the code for support, and raw upstream prose becomes an
       * evidence line, never the headline.
       */
      {
        const mapped = bridgeErrorText(result.code, t);
        const rawDetail = typeof result.detail === 'string' ? result.detail.trim() : '';
        const proseDetail = rawDetail && !/^[A-Z][A-Z0-9_]{2,40}$/.test(rawDetail.toUpperCase())
          ? rawDetail.slice(0, 220)
          : null;
        setTxErr({ text: mapped.text, detail: mapped.detail || proseDetail });
      }
      haptic?.('error');
      return;
    }

    setChangedQuote(null);
    setTxHash(result.sourceTxHash);
    haptic?.('success');
    /* LI.FI / cross-chain service success — real source tx, real reward. */
    if (result.sourceTxHash) {
      const rewards = useAppStore.getState();
      rewards.awardPoints('bridge', POINT_VALUES.bridge, {
        network: 'evm',
        chainId: result.srcChainId || fromChain,
        txHash: result.sourceTxHash
      });
    }

    if (result.transaction) {
      setTracked(result.transaction);
      setHistoryKey((n) => n + 1);
      /* Track to the DESTINATION. A confirmed source transaction is not an
         arrival, and this screen no longer implies that it is. */
      stopTrackRef.current?.();
      stopTrackRef.current = crossChainService.trackTransaction(result.transaction.id, {
        onUpdate: (row) => {
          if (!row) return;
          setTracked(row);
          if (row.executionStatus === 'COMPLETED') {
            setHistoryKey((n) => n + 1);
            wallet.refreshBalance?.();
          }
        }
      });
    }
  };

  const flip = () => {
    setFromChain(toChain);
    setToChain(fromChain);
    setAmount('');
    setQuote(null);
    haptic?.('select');
  };

  /*
   * ─── FRESHNESS ────────────────────────────────────────────────────────────
   * `formKey` names the exact form a quote was requested for. A quote whose
   * key no longer matches is STALE: the user has edited the amount, the pair,
   * the destination or the slippage since it arrived. The old screen kept
   * painting a stale receive amount under a fresh-looking input while the
   * debounce was in flight, which is the one number on this page a person
   * actually reads before signing. Stale quotes now render as unavailable
   * instead of as a number.
   */
  const summaryFresh = summary && quoteFormKey === formKey ? summary : null;
  const dlnFresh = dln && dlnFormKey === formKey ? dln : null;
  const receiveAmount = summaryFresh
    ? fromBaseUnits(summaryFresh.toAmount, toToken?.decimals ?? 6)
    : null;

  return (
    <PageTransition className="page bridge-page">
      {/*
        ─── THE HEAD ────────────────────────────────────────────────────────
        The old screen opened with an h1, a line of muted prose, a four-cell
        settings rail, and then a paragraph explaining what a bridge is — so
        the form the user came for started below the fold. The head is now a
        single compact object: one live chip, the title, one sentence, and the
        three facts that answer "is this safe and what will it cost me" in a
        line. The explanation itself moved below the ticket, where it can be
        opened by the people who want it and ignored by everyone else.
      */}
      <motion.header className="brg-head" variants={riseIn} initial="hidden" animate="show">
        <span className="brg-head-glow" aria-hidden="true" />
        <div className="brg-head-copy">
          <span className="brg-eyebrow">
            <span className="brg-pulse" aria-hidden="true" />
            {t('bridge.live')}
          </span>
          <h1 className="brg-title">{t('bridge.title')}</h1>
          <p className="brg-sub">{t('bridge.subtitle')}</p>
          <ul className="brg-facts">
            <li>{t('bridge.factChains', { n: BRIDGE_CHAINS.length })}</li>
            <li>{t('bridge.factSign')}</li>
            <li>{t('bridge.factFee')}</li>
          </ul>
        </div>
        <span className="brg-head-art" aria-hidden="true">
          <svg viewBox="0 0 112 112" fill="none" focusable="false">
            <defs>
              <linearGradient id="brgHeadA" x1="16" y1="14" x2="96" y2="98" gradientUnits="userSpaceOnUse">
                <stop stopColor="#35e0ff" />
                <stop offset="1" stopColor="#8b5cf6" />
              </linearGradient>
            </defs>
            <circle cx="56" cy="56" r="50" stroke="url(#brgHeadA)" strokeOpacity="0.12" />
            <circle cx="56" cy="56" r="37" stroke="url(#brgHeadA)" strokeOpacity="0.26" strokeDasharray="2 7" strokeLinecap="round" />
            <path d="M29 69c8-24 46-24 54 0" stroke="url(#brgHeadA)" strokeOpacity="0.5" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="1 5" />
            <circle cx="29" cy="69" r="7" fill="#0a0f1c" stroke="url(#brgHeadA)" strokeWidth="1.4" />
            <circle cx="29" cy="69" r="2.4" fill="#35e0ff" />
            <circle cx="83" cy="69" r="7" fill="#0a0f1c" stroke="url(#brgHeadA)" strokeWidth="1.4" />
            <circle cx="83" cy="69" r="2.4" fill="#8b5cf6" />
            <g stroke="#9be9ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.8">
              <path d="M49 47h14" />
              <path d="m60 43.5 3.5 3.5-3.5 3.5" />
              <path d="M63 61H49" />
              <path d="m52 57.5-3.5 3.5 3.5 3.5" />
            </g>
          </svg>
        </span>
      </motion.header>

      {/*
        ─── THE MODE RAIL ───────────────────────────────────────────────────
        Four routes, not four settings. Each tab carries a small route glyph, a
        one-word label and the asset class it handles, so the rail answers
        "where is this going to land" before it is tapped. The accessible name
        stays the full translated label (the visual label is shortened, and the
        hint is decorative), so screen readers and the existing tests hear the
        same words as before.
      */}
      <div className="brg-modes" role="tablist" aria-label={t('bridge.title')}>
        {MODES.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={mode === k}
            aria-label={t(`bridge.mode.${k}`)}
            className={mode === k ? 'active' : ''}
            disabled={busy}
            onClick={() => setMode(k)}
            style={{ isolation: 'isolate' }}
          >
            {mode === k && <SegIndicator id="bridgemode" className="seg-indicator brg-tab-pill" />}
            <span className="brg-tab-icon" aria-hidden="true">
              {k === 'tokens' ? <IconSwap /> : k === 'native' ? <IconRoute /> : k === 'tron' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.6 3.2 21.4 6l-6.1 12.6z" />
                  <path d="M2.6 3.2 9.1 9.4l6.2 9.2" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M6 5.4 9 3l3 2.4v3.1L9 10.9 6 8.5z" />
                  <path d="M12 13.2 15 11l3 2.2v3.2L15 18.6l-3-2.2z" opacity="0.75" />
                  <path d="M6 18.6 9 16.4l3 2.2v3.2L9 24l-3-2.2z" opacity="0.5" />
                </svg>
              )}
            </span>
            <span className="brg-modes-label" aria-hidden="true">{t(`bridge.modeShort.${k}`)}</span>
            <span className="brg-tab-hint" aria-hidden="true">{MODE_HINTS[k]}</span>
          </button>
        ))}
      </div>

      {mode === 'solana' ? (
        <Suspense fallback={<PanelSkeleton />}>
          <SolanaBridgePanel />
        </Suspense>
      ) : mode === 'tron' ? (
        <Suspense fallback={<PanelSkeleton />}>
          <TronPanel />
        </Suspense>
      ) : mode === 'native' ? (
        <Suspense fallback={<PanelSkeleton />}>
          <ThorPanel initialFrom={thorFromAsset} initialTo={thorToAsset} />
        </Suspense>
      ) : (
        <>

      {/* ─── THE TICKET ────────────────────────────────────────────────── */}
      <motion.section className="brg-ticket" variants={riseIn} initial="hidden" animate="show" aria-label={t('bridge.transfer')}>
        <div className="brg-ticket-head">
          <span className="brg-ticket-title">{t('bridge.transfer')}</span>
          <span className="brg-ticket-live">
            <i aria-hidden="true" />
            {t('bridge.live')}
          </span>
        </div>

        {/*
          The chain lives in the leg's header as a compact chip; the amount and
          the token share one inset plate. That is one decision per line
          (where → how much → in what) instead of the old two stacked pickers
          plus a third field underneath them, which is what made the ticket
          read as a settings form.
        */}
        <div className="brg-leg">
          <div className="brg-leg-top">
            <span className="brg-leg-label">
              <i className="brg-leg-dot brg-leg-dot--from" aria-hidden="true" />
              {t('bridge.from')}
            </span>
            <div className="brg-chain-chip">
              <ModernSelect
                value={fromChain}
                onChange={(v) => { setFromChain(Number(v)); setQuote(null); }}
                options={BRIDGE_CHAINS.map((c) => ({
                  value: c.id,
                  label: c.name,
                  sublabel: c.symbol,
                  chain: c.id,
                }))}
                title={t('bridge.from')}
                placeholder={t('bridge.from')}
                compact
                testId="bridge-from-chain"
              />
            </div>
          </div>

          <div className="brg-amount-row">
            <input
              className="brg-amount"
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={t('bridge.amount')}
            />
            <div className="brg-token-pick">
              <ModernSelect
                /* The trigger must name the token that will actually move.
                   `fromToken` already falls back to the chain's first
                   stablecoin when the remembered symbol does not exist
                   there (Base, Sonic, Berachain, Unichain and Monad have no
                   USDT), so the picker is bound to `fromToken` rather than
                   to the raw `tokenSymbol` — with the raw symbol the trigger
                   rendered the placeholder text "USDT" while USDC was what
                   would be sent. Display only: quoting and execution read
                   `fromToken` exactly as before. */
                value={fromToken?.symbol ?? tokenSymbol}
                onChange={(v) => { setTokenSymbol(v); setQuote(null); }}
                options={fromTokens.map((tk) => ({
                  value: tk.symbol,
                  label: tk.symbol,
                  /* the chain is already on the row above; the sublabel is the
                     token's own name, so the plate answers "which asset" and
                     "on which network" in one glance */
                  symbol: tk.symbol,
                  chain: fromChain,
                }))}
                title={t('bridge.from')}
                placeholder={fromToken?.symbol || tokenSymbol || 'USDT'}
                compact
                testId="bridge-from-token"
              />
            </div>
          </div>
        </div>

        <button type="button" className="brg-flip" onClick={flip} aria-label={t('bridge.flip')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 4v13" />
            <path d="m3.5 13.5 3.5 4 3.5-4" />
            <path d="M17 20V7" />
            <path d="m13.5 10.5 3.5-4 3.5 4" />
          </svg>
        </button>

        <div className="brg-leg brg-leg--to">
          <div className="brg-leg-top">
            <span className="brg-leg-label">
              <i className="brg-leg-dot brg-leg-dot--to" aria-hidden="true" />
              {t('bridge.to')}
            </span>
            <div className="brg-chain-chip">
              <ModernSelect
                value={toChain}
                onChange={(v) => { setToChain(Number(v)); setQuote(null); }}
                options={BRIDGE_CHAINS.filter((c) => c.id !== fromChain).map((c) => ({
                  value: c.id,
                  label: c.name,
                  sublabel: c.symbol,
                  chain: c.id,
                }))}
                title={t('bridge.to')}
                placeholder={t('bridge.to')}
                compact
                testId="bridge-to-chain"
              />
            </div>
          </div>

          <div className="brg-amount-row brg-amount-row--out">
            <span className={`brg-amount brg-amount--out${receiveAmount ? '' : ' is-empty'}`} aria-live="polite">
              {quoting && !receiveAmount ? <span className="brg-amount-shimmer" aria-hidden="true" /> : (receiveAmount ?? '—')}
            </span>
            <span className="brg-token-static">
              {toToken
                ? <AssetIcon symbol={toToken.symbol} chain={toChain} size={28} />
                : <span className="brg-token-fallback" aria-hidden="true">—</span>}
              <span className="brg-token-static-text">
                <b>{toToken?.symbol ?? '—'}</b>
                {/* only named when it DIFFERS from what was sent — Base, for
                    instance, has no USDT and lands the user on USDC. Print
                    "USDT" twice and say nothing would be the quiet version of
                    a surprise; this is the sentence that prevents it. */}
                {toToken && toToken.symbol !== tokenSymbol && (
                  <em>{t('bridge.arrivesAs', { symbol: toToken.symbol })}</em>
                )}
              </span>
            </span>
          </div>

          <div className="brg-receive-note">
            <span>{receiveAmount ? t('bridge.youReceive') : (quoting ? t('bridge.quoting') : t('bridge.emptyHint'))}</span>
            {summaryFresh?.durationSec != null && <span className="brg-receive-eta">~{summaryFresh.durationSec}s</span>}
          </div>
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
        <div className="brg-options">
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

        {quoteErr && !quoting && (() => {
          /* Unknown quote codes used to collapse into «no route found» — a
             sentence that invites changing the amount even when the real
             reason was a rate-limited provider. Each code now has its own
             words; anything unmapped keeps the code inside a generic line. */
          const { text, detail } = bridgeErrorText(quoteErr?.code ?? quoteErr, t, { fallbackKey: 'bridge.err.QUOTE_FAILED' });
          const rawDetail = quoteErr?.detail || detail;
          return (
            <p className="notice notice-danger brg-alert">
              {text}
              {rawDetail && (
                <span dir="ltr" style={{ display: 'block', marginTop: 4, fontSize: 11, opacity: 0.75, wordBreak: 'break-word' }}>
                  {rawDetail}
                </span>
              )}
            </p>
          );
        })()}

        {/*
          ─── EVERY COST, ITEMISED ─────────────────────────────────────────
          A bridge quote carries several separate charges: LI.FI's 0.25%,
          ours, the relayer's fee, the relayer's gas and the chain gas.
          Showing only "you receive X" would be technically honest and would
          still hide the thing people complain about afterwards. Our own cut
          is named rather than folded into "fees" — a fee the user cannot see
          is a fee they will feel tricked by later.
        */}
        {summaryFresh && !quoting && (
          <div className="brg-costs">
            <div className="brg-cost">
              <span>{t('bridge.route')}</span>
              <b>{summaryFresh.toolName}</b>
            </div>
            <div className="brg-cost">
              <span>{t('bridge.totalCost')}</span>
              <b className="mono">{fmtUsd(summaryFresh.totalCostUsd)}</b>
            </div>
            {/*
              ─── OUR FEE, NAMED AND NUMBERED ────────────────────────────────
              The integrator cut is its own cell rather than folded into
              "fees", with the live percentage next to the dollar figure
              («کارمزد ما میاد»). The percentage is derived from THIS quote, so
              it always matches what the server actually charged — when there
              is no fee the cell simply does not exist.
            */}
            {summaryFresh.ourFeeUsd != null && (
              <div className="brg-cost brg-cost--own">
                <span>{t('bridge.ourFee')}</span>
                <b className="mono">
                  {fmtUsd(summaryFresh.ourFeeUsd)}
                  {summaryFresh.fromAmountUsd > 0 && ` · ${((summaryFresh.ourFeeUsd / summaryFresh.fromAmountUsd) * 100).toFixed(2)}%`}
                </b>
              </div>
            )}
            {summaryFresh.durationSec != null && (
              <div className="brg-cost">
                <span>{t('bridge.eta')}</span>
                <b className="mono">~{summaryFresh.durationSec}s</b>
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
        {dlnFresh?.toAmount && !quoting && (
          <div className="brg-routes">
            <div className="brg-routes-head">
              <span>{t('bridge.routesTitle')}</span>
              {comparison.winner && (
                <span className="brg-routes-best">
                  {t('bridge.best')} · {t(`bridge.provider.${comparison.winner}`)}
                </span>
              )}
            </div>

            <div className="brg-routes-grid">
              {PROVIDERS.map((k) => {
                const isDln = k === 'dln';
                const out = fromBaseUnits(
                  isDln ? dlnFresh.toAmount : summaryFresh?.toAmount,
                  toToken?.decimals ?? 6
                );
                const isWinner = comparison.winner === k;
                return (
                  <button
                    key={k}
                    type="button"
                    className={`brg-route${provider === k ? ' is-on' : ''}${isWinner ? ' is-best' : ''}`}
                    aria-label={t(`bridge.provider.${k}`)}
                    aria-pressed={provider === k}
                    onClick={() => setProvider(k)}
                  >
                    <span className="brg-route-top" aria-hidden="true">
                      <span className={`brg-route-mark brg-route-mark--${k}`}>
                        {isDln ? 'dB' : 'LI'}
                      </span>
                      <span className="brg-route-name">{t(`bridge.provider.${k}`)}</span>
                      <span className="brg-route-radio" />
                    </span>
                    <span className="brg-route-amt" aria-hidden="true">
                      {out ?? '—'} <em>{toToken?.symbol}</em>
                    </span>
                    <span className="brg-route-fee" aria-hidden="true">
                      {isDln
                        ? `${t('bridge.fixedFee')}${dlnFresh.fixFee != null ? ` · ${fixFeeNative(dlnFresh.fixFee)} ${summary?.nativeSymbol ?? ''}` : ''}`
                        : `${t('bridge.totalCost')} · ${fmtUsd(summaryFresh?.totalCostUsd)}`}
                    </span>
                  </button>
                );
              })}
            </div>

            {/*
              The warning that makes this honest. A fixed fee worth 19% of the
              transfer is the single thing that turns the better-paying route
              into the wrong one, and it is invisible in the output amount.
            */}
            {burden?.severe && (
              <p className="notice notice-danger brg-alert">
                {t('bridge.fixedFeeWarn', { pct: burden.percent.toFixed(1) })}
              </p>
            )}

            {/*
              When the native coin could not be priced we say so instead of
              declaring a winner. A comparison that ignores a fee we know
              exists is worse than no comparison.
            */}
            {comparison.reason === 'FIXED_FEE_UNPRICED' && (
              <p className="brg-hint">{t('bridge.cannotCompare')}</p>
            )}
            {comparison.winner && (
              <p className="brg-hint">
                {t('bridge.betterRoute', {
                  name: t(`bridge.provider.${comparison.winner}`),
                  amount: fmtUsd(comparison.differenceUsd)
                })}
              </p>
            )}

            {dlnFresh.fixFee != null && (
              <p className="brg-hint brg-hint--mono">
                {t('bridge.fixedFee')}: {fixFeeNative(dlnFresh.fixFee)} {summary?.nativeSymbol ?? ''}
                {dlnFixedUsd != null ? ` · ${fmtUsd(dlnFixedUsd)}` : ''}
              </p>
            )}
          </div>
        )}

        {/*
          How many routes were actually compared, and which one won. A "best
          route" claim the user cannot check is just a slogan.
        */}
        {routes.length > 1 && !quoting && (
          <p className="brg-hint brg-hint--mono" dir="ltr">
            {t('bridge.routesCompared', {
              defaultValue: '{{count}} routes compared · best: {{name}}',
              count: routes.length,
              name: routes[0]?.toolName || routes[0]?.tool || '—'
            })}
          </p>
        )}

        {!wallet.isConnected ? (
          <p className="brg-connect">
            <IconWallet width={17} height={17} aria-hidden="true" />
            {t('bridge.connectFirst')}
          </p>
        ) : (
          <>
            <button
              className="brg-cta"
              /*
               * Each provider gates on ITS OWN readiness. Gating the DLN button
               * on LI.FI's `transactionRequest` would disable a working route
               * whenever the other provider had no path — which is precisely
               * when the second route is most valuable.
               */
              disabled={busy || quoting || !toAddressValid || !toBaseUnits(amount, fromToken?.decimals)
                || (provider === 'dln' ? !dln?.toAmount || dlnFormKey !== formKey : !quote?.transactionRequest || quoteFormKey !== formKey)}
              onClick={run}
            >
              {busy && <span className="brg-cta-spin" aria-hidden="true" />}
              <span>
                {busy
                  ? t(`crossChain.step.${execStep || 'confirm'}`, { defaultValue: t('bridge.sending') })
                  : t('bridge.send')}
              </span>
              {!busy && (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h13" />
                  <path d="m12.5 5.5 6.5 6.5-6.5 6.5" />
                </svg>
              )}
            </button>
            <p className="brg-cta-note">
              <IconShield width={13} height={13} aria-hidden="true" />
              {t('bridge.sendNote')}
            </p>
          </>
        )}

        {/*
          While the wallet has the request, the user must always have a way
          out on THIS screen. A wallet dismissed with Back never sends a
          rejection; the boundary catches most of those, and this button
          catches the rest.
        */}
        {busy && awaitingWallet && (
          <div className="bridge-waiting brg-waiting">
            <p>
              {t('bridge.waitingHint')}
            </p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancelWaiting}>
              {t('bridge.cancelWaiting')}
            </button>
          </div>
        )}

        {txErr && (
          <p className="notice notice-danger brg-alert">
            {txErr?.text || txErr}
            {txErr?.detail && (
              <span dir="ltr" style={{ display: 'block', marginTop: 4, fontSize: 11, opacity: 0.75, wordBreak: 'break-word' }}>
                {txErr.detail}
              </span>
            )}
          </p>
        )}

        {txHash && (
          <div className="brg-sent">
            <div className="brg-sent-title">
              <span className="brg-sent-check" aria-hidden="true">✓</span>
              {t('bridge.sentTitle')}
            </div>
            <p>{t('bridge.sentBody')}</p>
            <a
              className="brg-sent-link"
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

        {/*
          ─── THE RATE MOVED WHILE CONFIRMING ────────────────────────────────
          A bridge that silently signs a different price than the one on
          screen is indistinguishable from one that lies. Execution pauses
          here until the user says yes to the NEW number.
        */}
        {changedQuote && (
          <div className="notice notice-danger brg-alert">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('bridge.quoteChanged', { defaultValue: 'The rate changed while confirming.' })}</div>
            <p style={{ margin: 0, fontSize: 12 }} dir="ltr">
              ≈ {fromBaseUnits(changedQuote.quote.toAmount, toToken?.decimals ?? 6)} {toToken?.symbol}
            </p>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => { changedQuote.resolve(true); setChangedQuote(null); }}
              >
                {t('bridge.acceptNewRate', { defaultValue: 'Accept new rate' })}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { changedQuote.resolve(false); setChangedQuote(null); }}
              >
                {t('bridge.cancel', { defaultValue: 'Cancel' })}
              </button>
            </div>
          </div>
        )}

        {/*
          The REAL status of the transfer, driven by the server re-reading the
          bridge. This is what replaced "sent, good luck": a source hash is
          only the first of three things that have to happen.
        */}
        {tracked && provider !== 'dln' && (
          <div className="brg-status">
            <CrossChainStatus
              transaction={tracked}
              chains={BRIDGE_CHAINS.map((c) => ({ id: c.id, name: c.name }))}
              onRefresh={async () => {
                try {
                  const payload = await crossChainService.getStatus(tracked.id);
                  setTracked(payload.transaction);
                } catch { /* the row keeps its real status */ }
              }}
              busy={busy}
            />
          </div>
        )}
      </motion.section>

      {/* One history, shared with the Intent OS cross-chain desk. */}
      {wallet.isConnected && wallet.address && (
        <CrossChainHistory
          wallet={wallet.address}
          refreshKey={historyKey}
          chains={BRIDGE_CHAINS.map((c) => ({ id: c.id, name: c.name }))}
        />
      )}

      {/*
        ─── WHAT A BRIDGE IS, AND WHAT IT COSTS WHEN IT GOES WRONG ─────────
        Both used to be permanently-open cards stacked above the form. They are
        now two folded boxes BELOW it: someone arriving here already intends to
        bridge, and the risk that matters is the one they meet after tapping
        send. The disclosure stays tone="danger": "we cannot recover your
        transfer" is the one sentence here that must never look decorative.
      */}
      <InfoBox title={t('bridge.whatTitle')} tone="info" id="bridge-what" icon={<IconSwap width={17} height={17} />}>
        <p>{t('bridge.whatBody')}</p>
      </InfoBox>

      <InfoBox title={t('bridge.riskTitle')} tone="warn" id="bridge-risk" icon={<IconShield width={17} height={17} />}>
        <p>{t('bridge.riskBody')}</p>
      </InfoBox>

        </>
      )}

      {/*
        ─── THE CUSTODY DISCLOSURE, AS A BOX THAT OPENS ──────────────────────
        It used to be a permanently-open red paragraph under every tab. The
        wording is now the trustTitle/trustBody pair — same facts, sentences
        that read like product copy instead of legal rubble — and it lives in
        an InfoBox so the page opens calm and the disclosure is one tap away
        (the same treatment every non-blocking explanation on this screen got).
      */}
      <BridgeSigningReview review={signingReview} onDecision={finishSigningReview} />
      <InfoBox title={t('bridge.trustTitle')} tone="danger" id="bridge-trust">
        <p>{t('bridge.trustBody')}</p>
      </InfoBox>

      {/*
        ─── THE AD SLOT, AT THE FOOT ─────────────────────────────────────────
        Last element on the page and the only thing here that sells: the trust
        disclosure above it is the last thing a cautious user reads, and a
        promotion printed above a warning reads as an attempt to bury it.
      */}
      <FarmPromoBanner />
    </PageTransition>
  );
}
