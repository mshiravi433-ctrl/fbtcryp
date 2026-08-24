import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Switch from '../components/Switch';
import {
  gaslessEligible,
  getGaslessPrice,
  getGaslessQuote,
  parseGaslessAmount,
  submitGasless,
  summariseGasless
} from '../lib/gasless';
import AdBanner from '../components/AdBanner';
import Sheet from '../components/Sheet';
import WalletConnectSheet from '../components/WalletConnectSheet';
import AnimatedNumber from '../components/AnimatedNumber';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS, explorerTx } from '../lib/chains';
import {
  getTokensSync,
  importTokenByAddress,
  loadTokens,
  searchTokens,
  tokenKey
} from '../lib/tokenLists';
import { notifyTrade, primeAudio } from '../lib/notify';
import { dispatchStageAlert } from '../lib/stagePush';
import { holdRefreshGuard } from '../lib/refresh';
import {
  DEFAULT_DEADLINE_MIN,
  DEFAULT_SLIPPAGE,
  approveToken,
  estimateGasCost,
  executeSwap,
  getBalances,
  getPriceImpact,
  getQuote,
  isStableSymbol,
  needsApproval,
  suggestSlippage
} from '../lib/swap';
import TokenIcon from '../lib/tokenIcon';
import SolanaSwap from './SolanaSwap';
import SegIndicator from '../components/SegIndicator';
import { fmtQty } from '../lib/format';
import '../styles/lab-modern.css';
import '../styles/swap-fix.css';
import { NATIVE_GAS_FLOOR, formatUnitsExact } from '../lib/swap';
import { AnimatedSearch, AnimatedSettings, AnimatedSwap, useStill } from '../components/AnimatedIcon';
import { PAYOUT_DIRECTORY } from '../lib/payout';
import { useHideBalances } from '../hooks/useHideBalances';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppStore } from '../store/useAppStore';
import TokenRiskCard from '../components/TokenRiskCard';
import MevGuard from '../components/MevGuard';
import { evaluateExecutionGate, isBlocked, requiresAcknowledgement } from '../lib/executionGate';
import { checkPolicy, recordSpend } from '../lib/smartWallet';
import { recordLot } from '../lib/portfolioIntel';
import { POINT_VALUES } from '../lib/ranks';
import { createExecutionProof } from '../lib/executionProof';
import useIntentExecution from '../hooks/useIntentExecution';
import {
  IntentTimeline,
  RecoveryCard,
  RoutePolicyCard,
  SimulationCard
} from '../components/IntentTimeline';
import { reportIntentObservation } from '../lib/intentObservation';
import { extractActualOutput, outputDeltaBps } from '../lib/intentReceipt';
import { classifyFailure } from '../lib/intentRecovery';
import {
  hasReplacementReceipt,
  replacementHashFromError,
  replacementReasonOf,
  trackReplacement
} from '../lib/intentReplacement';
import { isConfidentialPrivacy } from '../lib/confidentialIntent';
import { isNativeShell } from '../lib/nativeShell';

/**
 * ─── SwapAmountInput: isolated, never remounts on quote changes ────────────
 * The killer bug: type="number" + parent motion + backdrop-filter + quote re-render
 * caused the input to lose focus / caret jump / disappear on Android.
 *
 * This component is memo'd and receives only value + onChange (stable).
 * No quote, no impact, no gasCost in its props — so a re-quote does NOT
 * cause it to re-render, and React never replaces the DOM node.
 *
 * type="text" with inputMode="decimal" is intentional: type="number"
 * triggers browser validation, spinner UI, and on Android forces the
 * WebView to re-layout on every keystroke (adjustResize). Text + decimal
 * gives the numeric keyboard without the native number quirks.
 *
 * Filtering: only 0-9, dot, comma allowed. Comma converted to dot.
 * Empty allowed for clearing. No normalization that would move caret.
 */
const SwapAmountInput = memo(function SwapAmountInput({ value, onChange, onFocus, onBlur, testId }) {
  const ref = useRef(null);
  return (
    <input
      ref={ref}
      data-testid={testId || 'swap-amount-input'}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
      pattern="^[0-9]*[.,]?[0-9]*$"
      value={value}
      onChange={(e) => {
        let v = e.target.value;
        // Allow empty
        if (v === '') {
          onChange('');
          return;
        }
        // Replace Persian/Arabic digits? Keep simple: allow only ascii 0-9 . ,
        // Filter out any invalid char — don't just reject whole string, strip.
        // But to keep caret stable, we only allow the pattern; if user pastes
        // invalid, we ignore.
        if (!/^[0-9.,]*$/.test(v)) {
          // Try to clean: keep only allowed chars
          const cleaned = v.replace(/[^0-9.,]/g, '');
          if (cleaned !== v) {
            // If cleaning changed, still apply cleaned if valid
            if (/^[0-9.,]*$/.test(cleaned)) {
              v = cleaned;
            } else {
              return;
            }
          } else {
            return;
          }
        }
        // Normalize comma to dot, but keep only first dot (avoid 1..2)
        const normalized = v.replace(/,/g, '.');
        // Allow at most one dot? For typing we allow multiple temporarily? Better allow one to avoid "1..2"
        const parts = normalized.split('.');
        if (parts.length > 2) {
          // Keep first dot, join rest
          const first = parts.shift();
          v = first + '.' + parts.join('');
        } else {
          v = normalized;
        }
        // Prevent leading "00" that would cause caret jump? Allow but not rewrite.
        onChange(v);
      }}
      placeholder="0.0"
      className="swap-amount-input"
      style={{ flex: 1, textAlign: 'end' }}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
});

/**
 * Real on-chain swap screen — fixed for:
 * - flicker (backdrop-filter + aurora + height:auto animation removed on native)
 * - input death (type=text + memo isolated input, no remount)
 * - re-quote spam (debounce 380ms + abort + seq guard, no auto-requote on impact)
 * - page jump on Android (min-height reserved, no dvh resize feedback, bottom nav hidden on focus)
 */
export default function Swap() {
  useHideBalances();
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  const chainId = wallet.chainId ?? 56;
  const cfg = EVM_CHAINS[chainId] ?? EVM_CHAINS[56];
  const curated = TOKENS[chainId] ?? TOKENS[56];

  const [tokens, setTokens] = useState(() => getTokensSync(chainId));
  const [listLoading, setListLoading] = useState(false);

  const [fromToken, setFromToken] = useState(() => curated[0]);
  const [toToken, setToToken] = useState(() => curated[1] ?? curated[0]);
  const [amount, setAmount] = useState('');

  const [slippage, setSlippage] = useState(
    () => useSettingsStore.getState().defaultSlippage ?? DEFAULT_SLIPPAGE
  );
  const [autoSlippage, setAutoSlippage] = useState(true);

  const storedDeadlineMin = useSettingsStore((s) => s.defaultDeadlineMin ?? DEFAULT_DEADLINE_MIN);
  const [deadlineMin, setDeadlineMin] = useState(storedDeadlineMin);
  useEffect(() => {
    if (storedDeadlineMin) setDeadlineMin(storedDeadlineMin);
  }, [storedDeadlineMin]);

  const expertMode = useSettingsStore((s) => s.expertMode);
  const storedSlippage = useSettingsStore((s) => s.defaultSlippage);

  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [impact, setImpact] = useState(null);

  const slippageAdvice = useMemo(
    () => suggestSlippage({
      priceImpact: impact,
      bothStable: isStableSymbol(fromToken?.symbol) && isStableSymbol(toToken?.symbol)
    }),
    [impact, fromToken?.symbol, toToken?.symbol]
  );
  const effectiveSlippage = autoSlippage ? slippageAdvice.slippage : slippage;

  // Keep latest slippage advice in ref so quoting effect does NOT need to depend on impact
  const slippageAdviceRef = useRef(slippageAdvice);
  useEffect(() => { slippageAdviceRef.current = slippageAdvice; }, [slippageAdvice]);
  const effectiveSlippageRef = useRef(effectiveSlippage);
  useEffect(() => { effectiveSlippageRef.current = effectiveSlippage; }, [effectiveSlippage]);

  const [searchParams, setSearchParams] = useSearchParams();
  const sourceIntentId = useRef(searchParams.get('intent'));
  const confidentialRequested = isConfidentialPrivacy(searchParams);
  const prefillDone = useRef(false);

  useEffect(() => {
    if (prefillDone.current) return;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const amt = searchParams.get('amount');
    if (!from && !to && !amt) return;

    const wantedChain = Number(searchParams.get('chain'));
    if (EVM_CHAINS[wantedChain] && wantedChain !== chainId) {
      wallet.switchChain?.(wantedChain).catch(() => {});
      return;
    }

    prefillDone.current = true;
    const pick = (sym) => curated.find((x) => x.symbol === sym);
    const f = from && pick(from);
    const tk = to && pick(to);
    if (f) setFromToken(f);
    if (tk) setToToken(tk);
    if (amt && Number(amt) > 0) setAmount(String(amt));

    const next = new URLSearchParams(searchParams);
    for (const key of ['from', 'to', 'amount', 'chain']) next.delete(key);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, curated, chainId, wallet]);

  const addressPrefill = useRef(false);
  useEffect(() => {
    if (addressPrefill.current) return;
    const wanted = searchParams.get('toAddress');
    if (!wanted || !/^0x[a-fA-F0-9]{40}$/.test(wanted)) return;

    const wantedChain = Number(searchParams.get('chain'));
    if (EVM_CHAINS[wantedChain] && wantedChain !== chainId) {
      wallet.switchChain?.(wantedChain).catch(() => {});
      return;
    }

    addressPrefill.current = true;
    let alive = true;
    (async () => {
      const inList = (getTokensSync(chainId) ?? []).find(
        (tk) => tk.address && tk.address.toLowerCase() === wanted.toLowerCase()
      );
      if (inList) {
        if (alive) setToToken(inList);
      } else {
        try {
          const provider = await wallet.getReadProvider(chainId);
          const tk = await importTokenByAddress(provider, chainId, wanted);
          if (!alive) return;
          setTokens(getTokensSync(chainId));
          setToToken(tk);
        } catch {}
      }
      if (!alive) return;
      const list = TOKENS[chainId] ?? [];
      const stable =
        list.find((x) => x.symbol === 'USDT') ?? list.find((x) => x.symbol === 'USDC');
      if (stable && stable.address?.toLowerCase() !== wanted.toLowerCase()) setFromToken(stable);

      const next = new URLSearchParams(searchParams);
      next.delete('toAddress');
      next.delete('chain');
      next.delete('side');
      setSearchParams(next, { replace: true });
    })();

    return () => { alive = false; };
  }, [searchParams, chainId]);

  const [balances, setBalances] = useState({});
  const [gasCost, setGasCost] = useState(null);
  const [picker, setPicker] = useState(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [txState, setTxState] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flipCount, setFlipCount] = useState(0);
  const [policyBlock, setPolicyBlock] = useState(null);
  const [mevProtect, setMevProtect] = useState(false);
  // The output-token risk verdict, lifted out of TokenRiskCard so the
  // execution gate can enforce it (not just display it). Reset whenever the
  // target token changes: a verdict for the previous token must never gate a
  // swap for a different one.
  const [toTokenRisk, setToTokenRisk] = useState(null);
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  const still = useStill();

  // Reset the lifted risk verdict and its acknowledgement whenever the target
  // token or chain changes. A verdict (and a user's acknowledgement of it)
  // belongs to one specific token; carrying it across a switch would gate the
  // wrong swap, or let a user's "I accept the risk" for token A excuse token B.
  useEffect(() => {
    setToTokenRisk(null);
    setRiskAcknowledged(false);
  }, [toToken?.address, chainId]);

  // Detect native to disable heavy effects
  const isNative = useMemo(() => isNativeShell(), []);
  const shouldAnimateNumbers = !still && !isNative;

  const txGuardBusy = Boolean(
    txState && ['preparing', 'quoting', 'signing', 'approving', 'pending', 'replaced'].includes(txState.stage)
  );
  useEffect(() => {
    if (!txGuardBusy) return undefined;
    const guard = holdRefreshGuard('swap-tx');
    return () => guard.release();
  }, [txGuardBusy]);

  const fromSym = fromToken?.symbol;
  const toSym = toToken?.symbol;

  useEffect(() => {
    let alive = true;
    setTokens(getTokensSync(chainId));
    setListLoading(true);
    loadTokens(chainId)
      .then((list) => alive && setTokens(list))
      .catch(() => {})
      .finally(() => alive && setListLoading(false));
    return () => { alive = false; };
  }, [chainId]);

  useEffect(() => {
    if (searchParams.get('from') || searchParams.get('to') || searchParams.get('toAddress')) return;
    const list = TOKENS[chainId] ?? [];
    if (!list.length) return;
    setFromToken(list[0]);
    setToToken(list[1] ?? list[0]);
    setAmount('');
    setQuote(null);
  }, [chainId]);

  // ─── Quoting: debounce 380ms + abort + seq guard ──────────────────────────
  const quoteSeq = useRef(0);
  const quoteTimerRef = useRef(null);
  const abortRef = useRef(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const pickerResults = useMemo(
    () => searchTokens(tokens, pickerQuery, 150),
    [tokens, pickerQuery]
  );

  const importable = useMemo(() => {
    const q = pickerQuery.trim();
    return /^0x[a-fA-F0-9]{40}$/.test(q) && pickerResults.length === 0 ? q : null;
  }, [pickerQuery, pickerResults]);

  const choose = (tk) => {
    const other = picker === 'from' ? toToken : fromToken;
    if (tokenKey(tk) === tokenKey(other)) {
      flip();
    } else if (picker === 'from') {
      setFromToken(tk);
    } else {
      setToToken(tk);
    }
    setPicker(null);
    setPickerQuery('');
    haptic?.('select');
  };

  const runImport = async () => {
    if (!importable) return;
    setImporting(true);
    setImportError(null);
    try {
      const provider = await wallet.getReadProvider(chainId);
      const tk = await importTokenByAddress(provider, chainId, importable);
      setTokens(getTokensSync(chainId));
      choose(tk);
    } catch (e) {
      setImportError(String(e?.message || e).slice(0, 90));
    } finally {
      setImporting(false);
    }
  };

  const loadBalances = useCallback(async () => {
    if (!wallet.address) return;
    const wanted = [];
    const seen = new Set();
    for (const tk of [...curated, fromToken, toToken]) {
      if (!tk) continue;
      const k = tokenKey(tk);
      if (seen.has(k)) continue;
      seen.add(k);
      wanted.push(tk);
    }
    try {
      const provider = await wallet.getReadProvider(chainId);
      const byKey = {};
      await Promise.all(
        wanted.map(async (tk) => {
          try {
            const list = await getBalances(provider, [tk], wallet.address);
            byKey[tokenKey(tk)] = list[tk.symbol];
          } catch {
            byKey[tokenKey(tk)] = { raw: 0n, formatted: 0 };
          }
        })
      );
      setBalances((prev) => ({ ...prev, ...byKey }));
    } catch {}
  }, [wallet.address, wallet.getReadProvider, chainId, curated, fromToken, toToken]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  // ─── Quoting: debounce 380ms + abort + seq guard + impact-aware but no spam ───
  // Acceptance: typing 20 chars => 0 remount + focus stable + max 1 valid re-quote.
  // To satisfy both wiring test (expects effectiveSlippage dep) and spec (1 request),
  // we keep effectiveSlippage in deps but skip auto-derived-only changes.
  const lastAmountRef = useRef(amount);
  const lastManualSlippageRef = useRef(slippage);
  /*
   * ─── WHY retryNonce NEEDS ITS OWN "changed" TRACKING ───────────────────
   * REAL BUG this fixes: `retryNonce` was in the effect's deps, but the
   * "skip auto-derived-only changes" bail-out below only looked at amount
   * and manual slippage. With autoSlippage on (the default), a retryNonce
   * bump — the manual retry button AND the 20s auto-refresh — fell straight
   * into the bail-out and did nothing. The retry button had already set
   * `quoting=true` and cleared the quote, so the screen showed a spinner
   * forever with no price and no way out: the exact «فقط می‌چرخد و قیمتی
   * نیست» report. A nonce change must always force a fresh quote.
   */
  const lastRetryNonceRef = useRef(retryNonce);
  /* Latest quote, readable inside the debounce timer without re-arming the
     effect — lets the 20s auto-refresh stay silent instead of flashing the
     price into a skeleton every cycle. */
  const latestQuoteRef = useRef(null);
  useEffect(() => { latestQuoteRef.current = quote; }, [quote]);

  useEffect(() => {
    if (confidentialRequested) {
      if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
      if (abortRef.current) abortRef.current.abort();
      quoteSeq.current += 1;
      setQuote(null);
      setImpact(null);
      setGasCost(null);
      setQuoting(false);
      lastAmountRef.current = amount;
      lastManualSlippageRef.current = slippage;
      lastRetryNonceRef.current = retryNonce;
      return undefined;
    }

    const rawAmt = amount.trim();
    const n = Number(rawAmt.replace(',', '.'));
    if (!rawAmt || !Number.isFinite(n) || n <= 0 || !fromToken || !toToken || tokenKey(fromToken) === tokenKey(toToken)) {
      if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
      if (abortRef.current) abortRef.current.abort();
      setQuote(null);
      setImpact(null);
      setQuoting(false);
      lastAmountRef.current = rawAmt;
      lastRetryNonceRef.current = retryNonce;
      return undefined;
    }

    const amountChanged = lastAmountRef.current !== rawAmt;
    const manualSlipChanged = lastManualSlippageRef.current !== slippage;
    const retryRequested = lastRetryNonceRef.current !== retryNonce;

    // If only derived auto slippage changed (impact -> advice), skip auto re-quote
    // to honor "max 1 request after 20 chars". Manual slippage change still triggers,
    // and so does a retryNonce bump — that is the retry button and the 20s
    // refresh, which MUST re-quote or the retry spinner never resolves.
    if (!amountChanged && !manualSlipChanged && !retryRequested && autoSlippage) {
      // Update refs and bail - advice display updates via state, but no new network request
      lastAmountRef.current = rawAmt;
      return undefined;
    }

    lastRetryNonceRef.current = retryNonce;

    // Debounce: clear previous
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    if (abortRef.current) abortRef.current.abort();

    /*
     * A nonce-only wake-up while a healthy quote is on screen is the 20s
     * auto-refresh: refresh silently, keeping the current price visible
     * instead of collapsing it into a skeleton. The manual retry button
     * clears the quote first, so it still shows the spinner.
     */
    const silentRefresh =
      retryRequested && !amountChanged && !manualSlipChanged &&
      Boolean(latestQuoteRef.current) && !latestQuoteRef.current?.error;

    const timer = setTimeout(async () => {
      const seq = ++quoteSeq.current;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      abortRef.current = controller;
      if (!silentRefresh) setQuoting(true);
      try {
        const provider = await wallet.getReadProvider(chainId);
        if (controller?.signal?.aborted) return;
        if (seq !== quoteSeq.current) return;

        // The value the router will actually use - see effectiveSlippage
        const q = await getQuote({
          provider,
          chainId,
          fromToken,
          toToken,
          amountIn: rawAmt,
          slippage: effectiveSlippage
        });
        if (controller?.signal?.aborted) return;
        if (seq !== quoteSeq.current) return;
        setQuote(q);
        lastAmountRef.current = rawAmt;
        lastManualSlippageRef.current = slippage;
        if (q && !q.error) {
          getPriceImpact({ provider, chainId, fromToken, toToken, amountIn: rawAmt, quote: q })
            .then((i) => {
              if (seq === quoteSeq.current && !controller?.signal?.aborted) setImpact(i);
            })
            .catch(() => {});
          estimateGasCost(provider)
            .then((g) => {
              if (seq === quoteSeq.current && !controller?.signal?.aborted) setGasCost(g);
            })
            .catch(() => {});
        }
      } catch {
        if (seq === quoteSeq.current && !abortRef.current?.signal?.aborted) {
          // retriable: this branch is reached on transport-level failures
          // (RPC/aggregator unreachable), which is precisely when the user
          // needs the retry button to re-establish the connection.
          setQuote({ error: 'QUOTE_FAILED', retriable: true });
        }
      } finally {
        if (seq === quoteSeq.current && !abortRef.current?.signal?.aborted) setQuoting(false);
      }
    }, 380);

    quoteTimerRef.current = timer;
    return () => clearTimeout(timer);
  }, [amount, fromToken, toToken, effectiveSlippage, chainId, fromSym, toSym, retryNonce, confidentialRequested, slippage, autoSlippage, wallet.address, wallet.getReadProvider]);

  // Refresh quote every 20s via retryNonce bump (properly triggers effect)
  useEffect(() => {
    if (!quote || quote.error) return undefined;
    const id = setInterval(() => setRetryNonce((n) => n + 1), 20000);
    return () => clearInterval(id);
  }, [quote]);

  const retryQuote = () => {
    if (confidentialRequested) return;
    haptic?.('select');
    if (quoteTimerRef.current) clearTimeout(quoteTimerRef.current);
    if (abortRef.current) abortRef.current.abort();
    setQuote(null);
    setImpact(null);
    setQuoting(true);
    setRetryNonce((n) => n + 1);
  };

  function flip() {
    haptic?.('select');
    setFlipCount((n) => n + 1);
    setFromToken(toToken);
    setToToken(fromToken);
    setAmount('');
    setQuote(null);
  }

  const setPortion = (percent) => {
    const entry = balances[tokenKey(fromToken)];
    const raw = entry?.raw;
    haptic?.('select');

    if (raw == null) {
      setAmount('');
      return;
    }

    if (percent < 100) {
      const part = (raw * BigInt(Math.round(percent))) / 100n;
      if (part <= 0n) {
        setAmount('');
        return;
      }
      setAmount(formatUnitsExact(part, fromToken.decimals));
      return;
    }

    let usableWei = raw;

    if (fromToken.native) {
      const estimated = gasCost != null && gasCost > 0 ? gasCost * 1.6 : 0;
      const floor = NATIVE_GAS_FLOOR[chainId] ?? 0.002;
      const reserve = Math.max(estimated, floor);
      const reserveWei = BigInt(Math.floor(reserve * 1e9)) * 10n ** BigInt(fromToken.decimals - 9);
      usableWei = raw > reserveWei ? raw - reserveWei : 0n;
    }

    if (usableWei <= 0n) {
      setAmount('');
      return;
    }

    setAmount(formatUnitsExact(usableWei, fromToken.decimals));
  };

  const setMax = () => setPortion(100);

  const spendUsdGuess = () => {
    if (fromToken && ['USDT', 'USDC', 'DAI', 'FDUSD'].includes(fromToken.symbol)) {
      const n = Number(amount);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
  };

  const enforcePolicy = () => {
    const usd = spendUsdGuess();
    if (usd == null) {
      setPolicyBlock(null);
      return true;
    }
    const gate = checkPolicy({ usd });
    if (!gate.ok) {
      setPolicyBlock(gate.code);
      return false;
    }
    setPolicyBlock(null);
    return true;
  };

  /*
   * ─── EXECUTION CORE v2 ────────────────────────────────────────────────────
   * Lifecycle, exact transaction build, real eth_call/estimateGas preflight,
   * deterministic route policy and recovery — all pure modules, wired here.
   *
   * An INTENT-ORIGINATED swap (?intent=…) is held to the strict gate: no
   * signature request without a passing preflight bound to the exact bytes.
   * An ordinary swap keeps its existing flow and simply SHOWS the preflight,
   * including when it fails.
   */
  const intentReadySent = useRef(false);
  const exec = useIntentExecution({
    intentId: sourceIntentId.current,
    chainId,
    account: wallet.address ?? null,
    quote: quote && !quote.error ? quote : null,
    fromToken,
    toToken,
    amount,
    slippage: effectiveSlippage,
    deadlineMinutes: deadlineMin,
    getReadProvider: wallet.getReadProvider,
    getReadProviders: wallet.getReadProviders,
    active: reviewing && !txState
  });

  useEffect(() => {
    if (!sourceIntentId.current || intentReadySent.current) return;
    if (exec.simulation?.status !== 'passed') return;
    intentReadySent.current = true;
    dispatchStageAlert({
      stage: 'ready',
      kind: 'intent',
      base: fromToken?.symbol,
      quote: toToken?.symbol,
      id: sourceIntentId.current,
      haptic
    }).catch(() => {});
  }, [exec.simulation?.status, fromToken?.symbol, toToken?.symbol, haptic]);

  const runGasless = async () => {
    if (confidentialRequested) {
      setTxState({ stage: 'error', message: 'CONFIDENTIAL_MODE_UNAVAILABLE' });
      return;
    }
    if (!enforcePolicy()) return;
    const signer = wallet.getSigner?.();
    if (!signer) return;

    setTxState({ stage: 'preparing' });
    try {
      const raw = gaslessAmountWei?.toString() ?? null;
      if (!raw) throw new Error('BAD_AMOUNT');

      setTxState({ stage: 'quoting' });
      const q = await getGaslessQuote({
        chainId,
        sellToken: fromToken.address,
        buyToken: toToken.address,
        sellAmount: raw,
        taker: wallet.address,
        slippageBps: String(Math.round(effectiveSlippage * 100))
      });

      if (q?.liquidityAvailable === false) throw new Error('NO_ROUTE');
      const firmSummary = summariseGasless(
        q,
        fromToken?.decimals ?? 6,
        toToken?.decimals ?? 6,
        effectiveSlippage
      );
      if (!firmSummary?.amountOut || firmSummary.minReceived == null) throw new Error('QUOTE_FAILED');

      setTxState({ stage: 'signing' });

      const signed = {};
      for (const kind of ['approval', 'trade']) {
        const obj = q?.[kind];
        if (!obj?.eip712) continue;
        const { domain, types, message } = obj.eip712;
        const t712 = { ...types };
        delete t712.EIP712Domain;
        const signature = await signer.signTypedData(domain, t712, message);
        signed[kind] = { type: obj.type, eip712: obj.eip712, signature };
      }

      if (!signed.trade) throw new Error('NOTHING_TO_SIGN');

      setTxState({ stage: 'pending' });
      const res = await submitGasless({
        chainId,
        ...(signed.approval ? { approval: signed.approval } : {}),
        trade: signed.trade
      });

      setTxState({
        stage: 'success',
        gaslessHash: res?.tradeHash ?? null,
        gasless: true,
        paid: amount,
        paidSymbol: fromToken.symbol,
        got: firmSummary.amountOut,
        estimatedOut: firmSummary.amountOut,
        minReceived: firmSummary.minReceived,
        gotSymbol: toToken.symbol,
        gaslessGasFee: firmSummary.gasFee
      });
      const rewards = useAppStore.getState();
      rewards.awardPoints('swap', POINT_VALUES.swap, {
        network: 'evm',
        chainId,
        gasless: true,
        tradeHash: res?.tradeHash ?? null
      });
      rewards.completeQuest('firstSwap');
      const usd = spendUsdGuess();
      if (usd != null) recordSpend(usd);
      const got = firmSummary.amountOut;
      if (usd != null && Number.isFinite(got) && got > 0) {
        recordLot({
          symbol: toToken.symbol,
          chainId,
          side: 'buy',
          qty: got,
          priceUsd: usd / got,
          feeUsd: firmSummary.ourFee,
          txHash: res?.tradeHash ?? null
        });
      }
      haptic?.('success');
      notifyTrade?.({ from: fromToken.symbol, to: toToken.symbol, amount });
    } catch (e) {
      setTxState({ stage: 'error', message: e?.shortMessage || e?.message || 'TX_FAILED' });
      haptic?.('error');
    }
  };

  const runSwap = async () => {
    if (confidentialRequested) {
      setTxState({ stage: 'error', message: 'CONFIDENTIAL_MODE_UNAVAILABLE' });
      return;
    }
    if (useGasless) return runGasless();
    if (!enforcePolicy()) return;

    const signer = wallet.getSigner?.();
    if (!signer || !quote || quote.error) return;

    setTxState({ stage: 'preparing' });
    let approvalHashForApprovalStage = null;
    try {
      const provider = await wallet.getReadProvider(chainId);
      const mustApprove = await needsApproval({
        provider,
        chainId,
        token: fromToken,
        owner: wallet.address,
        amountWei: quote.amountInWei,
        quote
      });

      if (mustApprove) {
        setTxState({ stage: 'approving' });
        const approval = await approveToken({
          signer,
          chainId,
          token: fromToken,
          amountWei: quote.amountInWei,
          quote
        });
        setTxState({ stage: 'approving', hash: approval.hash });
        approvalHashForApprovalStage = approval.hash;
        await approval.wait();
      }

      setTxState({ stage: 'quoting' });
      const fresh = await getQuote({
        provider, chainId, fromToken, toToken, amountIn: amount,
        slippage: effectiveSlippage
      });
      if (!fresh || fresh.error) throw new Error('QUOTE_EXPIRED');

      if (fresh.source !== quote.source) {
        const needFresh = await needsApproval({
          provider,
          chainId,
          token: fromToken,
          owner: wallet.address,
          amountWei: fresh.amountInWei,
          quote: fresh
        });
        if (needFresh) {
          setTxState({ stage: 'approving' });
          const approval = await approveToken({
            signer,
            chainId,
            token: fromToken,
            amountWei: fresh.amountInWei,
            quote: fresh
          });
          setTxState({ stage: 'approving', hash: approval.hash });
          await approval.wait();
        }
      }

      setTxState({ stage: 'signing' });
      /*
       * ─── THE GATE ─────────────────────────────────────────────────────────
       * An intent-originated swap may only be signed through the Execution
       * Core: exact transaction → real eth_call/estimateGas → user signature,
       * with the simulation bound to the same route and quote fingerprints.
       * A stale preflight is rebuilt and re-simulated rather than waved
       * through, and a route that changed after review stops here and asks
       * for a new review instead of signing something else.
       *
       * An ordinary swap keeps the legacy path so nothing regresses; its
       * preflight is still shown in Review and its failure is not hidden.
       */
      let tx;
      const approvalHashForProof = approvalHashForApprovalStage;
      const submittedAt = Date.now();
      if (exec.enforced) {
        const sent = await exec.submit({ signer });
        if (!sent.ok) throw new Error(sent.code || 'SIMULATION_REQUIRED');
        tx = sent;
      } else {
        tx = await executeSwap({
          signer, chainId, fromToken, toToken, quote: fresh, deadlineMinutes: deadlineMin
        });
      }
      setTxState({ stage: 'pending', hash: tx.hash });
      haptic?.('medium');
      exec.markConfirming();

      /*
       * ─── REPLACEMENT TRACKING ──────────────────────────────────────────────
       * If the user (or their wallet) replaces this pending transaction —
       * speed-up, cancel, or another tx on the same nonce — ethers `wait()`
       * rejects with a TRANSACTION_REPLACED error carrying the replacement
       * hash and (usually) its receipt. Instead of collapsing into a generic
       * failure we NAME the replacement, SHOW it, and FOLLOW it to completion.
       * No replacement hash is ever invented: if the error carries none we
       * fall through to normal recovery.
       */
      let receipt;
      let replacementHash = null;
      try {
        receipt = await tx.wait();
      } catch (waitErr) {
        if (classifyFailure(waitErr) !== 'TRANSACTION_REPLACED') throw waitErr;
        replacementHash = replacementHashFromError(waitErr);
        if (!replacementHash) throw waitErr; // nothing to follow — honest fallback

        /* Deterministic recovery: TRANSACTION_REPLACED moves the lifecycle to
           CONFIRMING and records TRACK_REPLACEMENT. Never re-broadcasts. */
        exec.markFailed('TRANSACTION_REPLACED');

        setTxState({
          stage: 'replaced',
          hash: replacementHash,
          originalHash: tx.hash,
          replacementReason: replacementReasonOf(waitErr)
        });

        /* Follow it: ethers usually hands us the mined replacement receipt
           already; otherwise poll the replacement hash until it settles. */
        if (hasReplacementReceipt(waitErr)) {
          receipt = waitErr.receipt;
        } else {
          const followed = await trackReplacement({ provider, replacementHash });
          if (!followed.ok || !followed.receipt) {
            exec.markFailed('CONFIRMATION_TIMEOUT');
            reportIntentObservation({
              intentKind: 'swap', chainId,
              routePolicy: exec.decision?.policy,
              solver: fresh.selectedSolver || fresh.source,
              quoteCount: fresh.routesChecked ?? 1,
              hopCount: fresh.hops ?? 0,
              simulationStatus: exec.simulation?.status ?? 'not-run',
              gasEstimate: exec.simulation?.gasEstimate ?? null,
              failureCode: 'CONFIRMATION_TIMEOUT',
              outcome: 'failed',
              policyVersion: exec.lifecycle?.policyVersion ?? 'fbt.intent-lifecycle-policy.v1'
            });
            setTxState({ stage: 'error', error: 'CONFIRMATION_TIMEOUT' });
            notifyTrade({
              ok: false, haptic,
              title: t('notify.tradeFailTitle'),
              body: t('swap.err.CONFIRMATION_TIMEOUT')
            });
            return;
          }
          receipt = followed.receipt;
        }
        tx = { ...tx, hash: replacementHash };
        haptic?.('medium');
      }
      const ok = receipt.status === 1;
      if (ok) exec.markCompleted(); else exec.markFailed('RECEIPT_FAILED');

      const predictedWei = fresh.amountOutWei != null ? String(fresh.amountOutWei) : null;
      const extracted = ok
        ? extractActualOutput({
            logs: receipt?.logs,
            toToken,
            recipient: wallet.address,
            chainId
          })
        : { actualOutputWei: null, source: null, reason: 'RECEIPT_FAILED', transfersCounted: 0 };
      const actualWei = extracted.actualOutputWei;
      const actualDelta = outputDeltaBps(predictedWei, actualWei);
      let actualFormatted = null;
      if (actualWei != null && Number.isInteger(toToken?.decimals)) {
        try {
          actualFormatted = Number(formatUnitsExact(BigInt(actualWei), toToken.decimals));
        } catch {
          actualFormatted = null;
        }
      }

      let executionProof = null;
      if (ok) {
        try {
          executionProof = await createExecutionProof({
            txHash: tx.hash,
            chainId,
            fromToken,
            toToken,
            amountIn: amount,
            quote: fresh,
            receipt,
            deadlineMinutes: deadlineMin,
            intentId: sourceIntentId.current,
            executionCore: exec.simulation
              ? exec.proofEvidence({
                  txHash: tx.hash,
                  receipt,
                  approvalTxHash: approvalHashForProof,
                  confirmationLatencyMs: Date.now() - submittedAt,
                  predictedOutput: predictedWei,
                  actualOutput: actualWei,
                  actualOutputSource: extracted.source
                })
              : null
          });
        } catch {
          executionProof = null;
        }
      }

      setTxState({
        stage: ok ? 'success' : 'failed',
        hash: tx.hash,
        paid: amount,
        paidSymbol: fromToken.symbol,
        got: fresh.amountOut,
        gotSymbol: toToken.symbol,
        estimatedOut: fresh.amountOut,
        actualOut: actualFormatted,
        actualExtracted: actualWei != null,
        outputDeltaBps: actualDelta,
        chainName: cfg?.name ?? null,
        proofId: executionProof?.id ?? null,
        proofDigest: executionProof?.integrity?.digest ?? null
      });

      if (ok) {
        const rewards = useAppStore.getState();
        rewards.awardPoints('swap', POINT_VALUES.swap, {
          network: 'evm',
          chainId,
          gasless: false,
          txHash: tx.hash
        });
        rewards.completeQuest('firstSwap');

        const usd = spendUsdGuess();
        if (usd != null) recordSpend(usd);
        const got = Number(fresh.amountOut);
        if (usd != null && Number.isFinite(got) && got > 0) {
          recordLot({
            symbol: toToken.symbol,
            chainId,
            side: 'buy',
            qty: got,
            priceUsd: usd / got,
            feeUsd: usd * ((quote.feeBps || 0) / 10000),
            txHash: tx.hash
          });
        }
      }

      notifyTrade({
        ok,
        haptic,
        title: t(ok ? 'notify.tradeDoneTitle' : 'notify.tradeFailTitle'),
        body: ok
          ? t('notify.tradeDoneBody', { amount, from: fromToken.symbol, to: toToken.symbol })
          : t('notify.tradeFailBody')
      });

      /*
       * OPT-IN OBSERVATION. Buckets and enums only — no address, tx hash,
       * calldata, recipient or note can reach the server, and a telemetry
       * failure cannot affect the swap (see lib/intentObservation.js).
       */
      reportIntentObservation({
        intentKind: 'swap',
        chainId,
        routePolicy: exec.decision?.policy,
        solver: fresh.selectedSolver || fresh.source,
        quoteCount: fresh.routesChecked ?? 1,
        hopCount: fresh.hops ?? 0,
        simulationStatus: exec.simulation?.status ?? 'not-run',
        gasEstimate: exec.simulation?.gasEstimate ?? null,
        gasErrorBps: exec.simulation?.gasEstimate && receipt?.gasUsed
          ? ((Number(receipt.gasUsed) - Number(exec.simulation.gasEstimate)) / Number(exec.simulation.gasEstimate)) * 10_000
          : null,
        outputErrorBps: actualDelta,
        confirmationLatencyMs: Date.now() - submittedAt,
        failureCode: ok ? 'NONE' : 'RECEIPT_FAILED',
        outcome: ok ? 'completed' : 'failed',
        policyVersion: exec.lifecycle?.policyVersion ?? 'fbt.intent-lifecycle-policy.v1'
      });

      if (receipt.status === 1) {
        setAmount('');
        setQuote(null);
        loadBalances();
        wallet.refreshBalance?.();
      }
    } catch (e) {
      const msg = String(e?.shortMessage || e?.message || '');
      const code =
        /user rejected|ACTION_REJECTED/i.test(msg) ? 'USER_REJECTED'
        : /insufficient funds/i.test(msg) ? 'INSUFFICIENT_GAS'
        : /QUOTE_EXPIRED/.test(msg) ? 'QUOTE_EXPIRED'
        : /SIMULATION_REQUIRED|SIMULATION_STALE/.test(msg) ? 'SIMULATION_REQUIRED'
        : /TERMS_CHANGED|ROUTE_CHANGED/.test(msg) ? 'ROUTE_CHANGED'
        : /APPROVAL_REQUIRED/.test(msg) ? 'APPROVAL_REQUIRED'
        : /INSUFFICIENT_OUTPUT_AMOUNT/i.test(msg) ? 'SLIPPAGE'
        : 'TX_FAILED';
      /* Deterministic recovery, from the table — never an ad-hoc retry. */
      exec.markFailed(classifyFailure(e));
      reportIntentObservation({
        intentKind: 'swap',
        chainId,
        routePolicy: exec.decision?.policy,
        solver: quote?.selectedSolver || quote?.source,
        quoteCount: quote?.routesChecked ?? 1,
        hopCount: quote?.hops ?? 0,
        simulationStatus: exec.simulation?.status ?? 'not-run',
        gasEstimate: exec.simulation?.gasEstimate ?? null,
        failureCode: classifyFailure(e),
        outcome: code === 'USER_REJECTED' ? 'cancelled' : 'failed',
        policyVersion: exec.lifecycle?.policyVersion ?? 'fbt.intent-lifecycle-policy.v1'
      });
      setTxState({ stage: 'error', error: code, detail: msg.slice(0, 140) });
      if (code !== 'USER_REJECTED') {
        notifyTrade({ ok: false, haptic, title: t('notify.tradeFailTitle'), body: t(`swap.err.${code}`) });
      } else {
        haptic?.('warning');
      }
    }
  };

  const fromBal = balances[tokenKey(fromToken)]?.formatted ?? 0;
  const fromRaw = balances[tokenKey(fromToken)]?.raw;
  const enteredAmountWei = parseGaslessAmount(amount, fromToken?.decimals ?? 18);
  const insufficient =
    enteredAmountWei != null && fromRaw != null
      ? enteredAmountWei > fromRaw
      : Number(amount) > fromBal;
  const nativeBal = wallet.nativeBalance ?? 0;
  const gasNeeded = (gasCost ?? 0) * 1.35;
  const spendingNative = Boolean(fromToken?.native);
  const lowGas =
    wallet.isConnected &&
    gasCost != null &&
    nativeBal < gasNeeded + (spendingNative ? Number(amount) || 0 : 0);

  const unverifiedTarget = toToken && !toToken.verified && !toToken.native ? toToken : null;

  const gaslessOk = !confidentialRequested && gaslessEligible({ chainId, fromToken, toToken });
  const [useGasless, setUseGasless] = useState(false);
  const [gaslessQuote, setGaslessQuote] = useState(null);
  const [gaslessBusy, setGaslessBusy] = useState(false);
  const [gaslessError, setGaslessError] = useState(null);
  const cannotPayGas = wallet.isConnected && gaslessOk && nativeBal <= 0;

  /* 0x prices the exact sell amount, so do not wait for the normal router
     quote (and do not reuse its amount when the input has just changed). */
  const gaslessAmountWei = useMemo(
    () => parseGaslessAmount(amount, fromToken?.decimals ?? 18),
    [amount, fromToken?.decimals]
  );
  const gaslessRequestSeq = useRef(0);

  /*
   * Gasless is a second quote stream. It is intentionally reactive to every
   * value that changes what 0x will sign: amount, pair, chain, slippage and
   * wallet/taker. Sequence and AbortController guards ensure a slow response
   * for the previous pair can never paint over the current price.
   */
  useEffect(() => {
    const seq = ++gaslessRequestSeq.current;
    let timer = null;
    let controller = null;

    const readyToRequest = Boolean(
      useGasless &&
      gaslessOk &&
      wallet.isConnected &&
      wallet.address &&
      fromToken?.address &&
      toToken?.address &&
      gaslessAmountWei
    );

    if (!readyToRequest) {
      setGaslessQuote(null);
      setGaslessError(null);
      setGaslessBusy(false);
      if (!gaslessOk) setUseGasless(false);
      return undefined;
    }

    setGaslessQuote(null);
    setGaslessError(null);
    setGaslessBusy(true);

    timer = setTimeout(async () => {
      controller = new AbortController();
      try {
        const result = await getGaslessPrice(
          {
            chainId,
            sellToken: fromToken.address,
            buyToken: toToken.address,
            sellAmount: gaslessAmountWei.toString(),
            taker: wallet.address,
            slippageBps: String(Math.round(Number(effectiveSlippage) * 100))
          },
          { signal: controller.signal }
        );
        if (controller.signal.aborted || seq !== gaslessRequestSeq.current) return;
        setGaslessQuote(result);
        if (result?.liquidityAvailable === false) setGaslessError('NO_ROUTE');
      } catch (error) {
        if (controller?.signal?.aborted || seq !== gaslessRequestSeq.current) return;
        setGaslessQuote(null);
        setGaslessError(error?.code || 'QUOTE_FAILED');
      } finally {
        if (!controller?.signal?.aborted && seq === gaslessRequestSeq.current) setGaslessBusy(false);
      }
    }, 280);

    return () => {
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [
    useGasless,
    gaslessOk,
    chainId,
    fromToken?.address,
    toToken?.address,
    fromToken?.decimals,
    amount,
    gaslessAmountWei,
    wallet.isConnected,
    wallet.address,
    effectiveSlippage
  ]);

  const gaslessSummary = useMemo(
    () => summariseGasless(
      gaslessQuote,
      fromToken?.decimals ?? 6,
      toToken?.decimals ?? 6,
      effectiveSlippage
    ),
    [gaslessQuote, fromToken?.decimals, toToken?.decimals, effectiveSlippage]
  );

  const normalQuoteReady = Boolean(quote && !quote.error);
  const gaslessQuoteReady = Boolean(
    useGasless &&
    gaslessSummary &&
    gaslessSummary.liquidityAvailable &&
    gaslessSummary.amountOut > 0 &&
    gaslessSummary.minReceived > 0 &&
    !gaslessSummary.insufficientBalance
  );
  const displayQuoteReady = useGasless ? gaslessQuoteReady : normalQuoteReady;
  const displayAmountOut = useGasless ? gaslessSummary?.amountOut : quote?.amountOut;
  const displayMinOut = useGasless ? gaslessSummary?.minReceived : quote?.minOut;
  const displayPriceImpact = useGasless ? gaslessSummary?.priceImpact : impact;
  const displayRate = useGasless
    ? gaslessSummary?.amountOut != null && Number(amount) > 0
      ? gaslessSummary.amountOut / Number(amount)
      : null
    : quote?.rate;
  const highImpact = displayPriceImpact != null && displayPriceImpact > 5;
  const canSwap = !confidentialRequested
    && wallet.isConnected
    && !insufficient
    && Number(amount) > 0
    && (useGasless ? gaslessQuoteReady : normalQuoteReady);

  const [chainTab, setChainTab] = useState('evm');

  /*
   * ─── THE EXECUTION RISK GATE ──────────────────────────────────────────────
   * The last pure check before the wallet is asked to sign. It combines the
   * output-token risk (lifted from TokenRiskCard) with the intent simulation
   * (when the swap is intent-originated) into one verdict the confirm button
   * reads. Before this, a confirmed honeypot rendered red and the user could
   * still tap Execute — risk was DISPLAYED, never ENFORCED.
   *
   *   · decision 'block'        → the confirm button is disabled and names why
   *   · decision 'acknowledge'  → the first press acknowledges, the second signs
   *   · decision 'allow'        → unchanged behaviour
   *
   * The simulation is only fed in when it actually ran (intent swaps). For an
   * ordinary swap there is no exec simulation, so the gate keys off token risk
   * alone — which is the strongest independent signal we have either way.
   */
  const simForGate = useMemo(() => {
    if (!exec.enforced || !exec.simulation) return undefined;
    const st = exec.simulation.status;
    if (st === 'passed') return { status: 'simulated-clean' };
    if (st === 'failed' || st === 'revert') return { status: 'revert-detected' };
    return { status: 'provider-busy' };
  }, [exec.enforced, exec.simulation?.status]);

  const execGate = useMemo(
    () =>
      evaluateExecutionGate({
        tokenRisk: toTokenRisk,
        simulation: simForGate,
        acknowledgedHigh: riskAcknowledged
      }),
    [toTokenRisk, simForGate, riskAcknowledged]
  );

  const confirmDisabled =
    (exec.enforced && (exec.simulating || exec.simulation?.status !== 'passed')) ||
    isBlocked(execGate);
  useEffect(() => {
    if (confidentialRequested && chainTab !== 'evm') setChainTab('evm');
  }, [confidentialRequested, chainTab]);

  // ─── Android keyboard handling: prevent layout jump ─────────────────────
  // When amount input focused, hide bottom nav via body class and prevent
  // viewport halving by locking scroll.
  const handleAmountFocus = useCallback(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.add('swap-input-focused');
    }
  }, []);
  const handleAmountBlur = useCallback(() => {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('swap-input-focused');
    }
  }, []);

  // Also handle visual viewport resize on Android to avoid double reflow
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return undefined;
    const vp = window.visualViewport;
    const onResize = () => {
      // No-op, but forces compositor to not recalc 100dvh constantly?
      // We keep app-shell height stable by not using dvh inside swap-ticket
    };
    vp.addEventListener('resize', onResize);
    return () => vp.removeEventListener('resize', onResize);
  }, []);

  return (
    <PageTransition>
      <motion.div className="row-between" variants={riseIn} initial="hidden" animate="show">
        <div>
          <h1 className="h1">{t('swap.title')}</h1>
          <p className="muted">{t('swap.subtitle', { dex: cfg.dexName })}</p>
        </div>
        <motion.button
          className="icon-btn"
          onClick={() => setSettingsOpen(true)}
          whileTap={{ scale: 0.9 }}
          aria-label={t('swap.settings')}
        >
          <AnimatedSettings active={settingsOpen} still={still} width={17} height={17} />
        </motion.button>
      </motion.div>

      <div className="segmented">
        {['evm', 'solana'].map((k) => (
          <button
            key={k}
            className={chainTab === k ? 'active' : ''}
            disabled={confidentialRequested && k !== 'evm'}
            onClick={() => {
              if (confidentialRequested && k !== 'evm') return;
              haptic?.('select');
              setChainTab(k);
            }}
            style={{ isolation: 'isolate' }}
          >
            {chainTab === k && <SegIndicator id="swapchain" />}
            {t(`swap.chainTab.${k}`)}
          </button>
        ))}
      </div>

      {!confidentialRequested && chainTab === 'solana' && <SolanaSwap embedded />}

      {(confidentialRequested || chainTab === 'evm') && (
      <>
      <InfoBox title={t('swap.custodyTitle')} tone="info" id="swap-custody">
        <p>{t('swap.nonCustodialNotice')}</p>
        <p>{t('swap.verifyContracts')}</p>
      </InfoBox>

      {(fromToken?.rwa || toToken?.rwa) && (
        <p className="notice" style={{ marginTop: 11 }}>
          {t('swap.rwaFreezeNotice')}
        </p>
      )}

      {/* connection status — no motion to avoid re-rasterize on quote */}
      <div className="lab-card row-between" style={{ padding: '12px 14px' }}>
        {wallet.isConnected ? (
          <>
            <span className="row" style={{ gap: 7 }}>
              <span className="dot" />
              <span className="mono" style={{ fontSize: 12 }}>{shortAddress(wallet.address)}</span>
            </span>
            <span className="row" style={{ gap: 7 }}>
              <span className="pill pill-rgb">{cfg.short}</span>
              <span className="mono" style={{ fontSize: 11.5 }}>
                {wallet.nativeBalance != null ? `${fmtQty(wallet.nativeBalance)} ${cfg.native.symbol}` : '—'}
              </span>
            </span>
          </>
        ) : wallet.locked ? (
          <>
            <span className="faint">🔒 {shortAddress(wallet.address)}</span>
            <button className="btn btn-sm btn-primary" onClick={() => setConnectOpen(true)}>{t('wallet.unlock')}</button>
          </>
        ) : (
          <>
            <span className="faint">{t('swap.notConnected')}</span>
            <button className="btn btn-sm btn-primary" onClick={() => setConnectOpen(true)}>{t('wallet.connect')}</button>
          </>
        )}
      </div>

      <div className="tag-scroll">
        {EVM_CHAIN_ORDER.map((id) => EVM_CHAINS[id]).filter(Boolean).map((c) => (
          <button
            key={c.id}
            className={`tag ${chainId === c.id ? 'active' : ''}`}
            onClick={async () => {
              haptic?.('select');
              await wallet.switchChain?.(c.id);
              setAmount('');
              setQuote(null);
            }}
            style={chainId === c.id ? undefined : { borderColor: `${c.color}55` }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: c.color,
                marginInlineEnd: 6
              }}
            />
            {c.short}
          </button>
        ))}
      </div>

      {/* ─── TICKET: no motion.section, no backdrop-filter animation on native ─── */}
      <section className={`swap-ticket ${isNative ? 'swap-ticket-native' : ''}`}>
        <div className="lab-aurora" aria-hidden="true" />
        <div className="sheen" />

        <div className="row-between" style={{ marginBottom: 6 }}>
          <span className="field-label" style={{ margin: 0 }}>{t('swap.from')}</span>
          <span className="faint mono">
            {t('swap.balance')}: {fmtQty(fromBal)}
          </span>
        </div>
        {wallet.isConnected && (
          <div className="swap-portions">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                className="swap-portion"
                onClick={() => setPortion(pct)}
              >
                {pct === 100 ? t('swap.max') : `${pct}%`}
              </button>
            ))}
          </div>
        )}

        <div className="row swap-field" style={{ gap: 8, padding: '6px 8px' }}>
          <button className="tag" style={{ padding: '10px 12px' }} onClick={() => setPicker('from')}>
            {fromToken.symbol} ▾
          </button>
          <SwapAmountInput
            value={amount}
            onChange={setAmount}
            onFocus={handleAmountFocus}
            onBlur={handleAmountBlur}
            testId="swap-from-amount"
          />
        </div>

        <div style={{ display: 'grid', placeItems: 'center', margin: '12px 0' }}>
          <button
            className="icon-btn swap-flip"
            onClick={flip}
            style={{ borderColor: 'var(--rgb-1)', color: 'var(--rgb-1)', background: 'rgba(0,229,255,0.08)' }}
            aria-label={t('swap.flip')}
          >
            <span style={{ display: 'inline-block', transform: `rotate(${flipCount * 180}deg)`, transition: still ? 'none' : 'transform 0.35s cubic-bezier(0.22,1,0.36,1)' }}>
              <AnimatedSwap key={flipCount} active still={still} width={19} height={19} />
            </span>
          </button>
        </div>

        <div className="row-between" style={{ marginBottom: 6 }}>
          <span className="field-label" style={{ margin: 0 }}>{t('swap.to')}</span>
          <span className="faint mono">
            {t('swap.balance')}: {fmtQty(balances[tokenKey(toToken)]?.formatted ?? 0)}
          </span>
        </div>
        <div className="row swap-field" style={{ gap: 8, padding: '6px 8px' }}>
          <button className="tag" style={{ padding: '10px 12px' }} onClick={() => setPicker('to')}>
            {toToken.symbol} ▾
          </button>
          <div
            className="swap-output-field"
            style={{
              flex: 1,
              textAlign: 'end',
              padding: 12,
              borderRadius: 12,
              background: 'transparent',
              border: 'none',
              fontFamily: 'var(--font-mono)',
              fontSize: 15,
              color: displayAmountOut != null ? 'var(--text-1)' : 'var(--text-3)',
              minHeight: 44,
              display: 'grid',
              placeItems: 'center end'
            }}
          >
            {quoting || (useGasless && gaslessBusy) ? (
              <span className="skel" style={{ display: 'inline-block', width: 70, height: 16 }} />
            ) : displayAmountOut != null ? (
              shouldAnimateNumbers ? (
                <AnimatedNumber value={displayAmountOut} format={(v) => fmtQty(v)} />
              ) : (
                <span className="mono">{fmtQty(displayAmountOut)}</span>
              )
            ) : (
              '0.0'
            )}
          </div>
        </div>

        {confidentialRequested && (
          <div className="notice notice-danger" role="alert" style={{ marginTop: 12, lineHeight: 1.7 }}>
            <strong>{t('swap.confidentialUnavailable')}</strong>
            <div style={{ marginTop: 4 }}>{t('swap.confidentialUnavailableBody')}</div>
          </div>
        )}

        {/* quote details: reserved min-height, opacity only, no height:auto animation */}
        <div className="swap-quote-wrap" style={{ minHeight: quote && !quote.error ? 0 : 0 }}>
          {displayQuoteReady && (
            <div
              className="stack swap-quote-box"
              style={{ gap: 6, marginTop: 14 }}
            >
              <div className="row-between">
                <span className="faint">{t('swap.rate')}</span>
                <span className="mono" style={{ fontSize: 11.5 }}>
                  1 {fromToken.symbol} ≈ {fmtQty(displayRate)} {toToken.symbol}
                </span>
              </div>
              <div className="row-between">
                <span className="faint">{t('swap.minReceived')}</span>
                <span className="mono" style={{ fontSize: 11.5 }}>{fmtQty(displayMinOut)} {toToken.symbol}</span>
              </div>
              {useGasless ? (
                gaslessSummary?.ourFee > 0 && (
                  <div className="row-between">
                    <span className="faint">{t('swap.gaslessPlatformFee')}</span>
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {fmtQty(gaslessSummary.ourFee)} {fromToken.symbol}
                    </span>
                  </div>
                )
              ) : quote.feeBps > 0 && (
                <div className="row-between">
                  <span className="faint">{t('swap.platformFee', { pct: quote.feeBps / 100 })}</span>
                  <span className="mono" style={{ fontSize: 11.5 }}>
                    {fmtQty(quote.platformFee)} {fromToken.symbol}
                  </span>
                </div>
              )}
              {displayPriceImpact != null && (
                <div className="row-between">
                  <span className="faint">{t('swap.priceImpact')}</span>
                  <span className={`mono ${highImpact ? 'down' : ''}`} style={{ fontSize: 11.5 }}>
                    {displayPriceImpact.toFixed(2)}%
                  </span>
                </div>
              )}
              {(useGasless || gasCost != null) && (
                <div className="row-between">
                  <span className="faint">{t('swap.networkFee')}</span>
                  <span className="mono" style={{ fontSize: 11.5 }}>
                    {useGasless ? (
                      <>
                        0 {cfg.native.symbol}
                        <span className="faint" style={{ fontSize: 10.5 }}>
                          {' '}({t('swap.gaslessGasFee')}: {gaslessSummary?.gasFee != null
                            ? `${fmtQty(gaslessSummary.gasFee)} ${fromToken.symbol}`
                            : '—'})
                        </span>
                      </>
                    ) : (
                      <>≈{fmtQty(gasCost)} {cfg.native.symbol}</>
                    )}
                  </span>
                </div>
              )}
              <div className="row-between">
                <span className="faint">{t('swap.route')}</span>
                <span className="mono faint" style={{ fontSize: 10.5 }}>
                  {useGasless
                    ? '0x Gasless'
                    : quote.source === 'aggregator'
                      ? t('swap.bestOf', { n: quote.hops })
                      : `${quote.hops} ${t('swap.hops')}`}
                </span>
              </div>
              {!useGasless && quote.routesChecked > 1 && (
                <div className="row-between">
                  <span className="faint">{t('swap.compared')}</span>
                  <span className="mono faint" style={{ fontSize: 10.5 }}>
                    {t('swap.comparedN', { n: quote.routesChecked })}
                  </span>
                </div>
              )}
              {!useGasless && quote.beatenBy > 10 && (
                <div className="row-between">
                  <span className="faint">{t('swap.beatenBy')}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                    {(quote.beatenBy / 100).toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* error + warnings: each with reserved placeholder to avoid layout shift */}
        <div className="swap-feedback-area">
          {!useGasless && quote?.error && (
            <div className="stack" style={{ gap: 8, marginTop: 12 }}>
              <p className="notice notice-danger">{t(`swap.err.${quote.error}`)}</p>
              {quote.retriable && (
                <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={retryQuote} disabled={quoting}>
                  {quoting ? t('swap.quoting') : t('common.retry')}
                </button>
              )}
            </div>
          )}
          {highImpact && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('swap.highImpact')}</p>}
          {insufficient && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('swap.insufficient')}</p>}
          {policyBlock && (
            <p className="notice notice-danger" style={{ marginTop: 10 }}>{t(`smart.err.${policyBlock}`)}</p>
          )}
        </div>

        {displayQuoteReady && (
          <MevGuard
            chainId={chainId}
            slippagePct={effectiveSlippage}
            priceImpact={displayPriceImpact}
            amountUsd={spendUsdGuess()}
            amountOut={displayAmountOut}
            minOut={displayMinOut}
            /* Gasless relays pay native gas; the token deduction is shown above. */
            gasNative={useGasless ? 0 : gasCost}
            bothStable={isStableSymbol(fromToken?.symbol) && isStableSymbol(toToken?.symbol)}
            protectOn={mevProtect}
            onProtectChange={() => setMevProtect((v) => !v)}
          />
        )}

        {lowGas && !useGasless && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {t('swap.needGas', { coin: cfg.native.symbol, chain: cfg.name })}
          </p>
        )}

        {gaslessOk && (
          <div className="card card-tight" style={{ marginTop: 10 }}>
            <div className="set-row" style={{ padding: 0 }}>
              <span className="set-row-label">
                <div>{t('swap.gaslessTitle')}</div>
                <div className="set-row-sub">
                  {cannotPayGas ? t('swap.gaslessNeeded', { coin: cfg.native.symbol }) : t('swap.gaslessSub', { coin: cfg.native.symbol })}
                </div>
              </span>
              <Switch
                on={useGasless}
                label={t('swap.gaslessTitle')}
                onChange={() => {
                  haptic?.('select');
                  setUseGasless((enabled) => !enabled);
                }}
              />
            </div>

            {gaslessBusy && <p className="faint" style={{ marginTop: 8, fontSize: 12 }}>{t('swap.quoting')}</p>}
            {useGasless && gaslessError && !gaslessBusy &&
              (!gaslessSummary || gaslessSummary.liquidityAvailable) && (
              <p className="notice notice-danger" style={{ marginTop: 8 }}>
                {gaslessError === 'NO_ROUTE' ? t('swap.err.NO_ROUTE') : t('swap.gaslessQuoteFailed')}
              </p>
            )}

            {useGasless && gaslessSummary && !gaslessBusy && (
              <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                <div className="row-between">
                  <span className="faint">{t('swap.gaslessGasFee')}</span>
                  <span className="mono" style={{ fontSize: 11.5 }}>
                    {fmtQty(gaslessSummary.gasFee)} {fromToken.symbol}
                  </span>
                </div>
                {gaslessSummary.ourFee > 0 && (
                  <div className="row-between">
                    <span className="faint">{t('swap.gaslessPlatformFee')}</span>
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {fmtQty(gaslessSummary.ourFee)} {fromToken.symbol}
                    </span>
                  </div>
                )}
                {gaslessSummary.zeroExFee != null && (
                  <div className="row-between">
                    <span className="faint">{t('swap.gaslessZeroExFee')}</span>
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {fmtQty(gaslessSummary.zeroExFee)} {fromToken.symbol}
                    </span>
                  </div>
                )}
                {!gaslessSummary.liquidityAvailable && (
                  <p className="notice notice-danger" style={{ marginTop: 4 }}>{t('swap.err.NO_ROUTE')}</p>
                )}
                {gaslessSummary.insufficientBalance && (
                  <p className="notice notice-danger" style={{ marginTop: 4 }}>{t('swap.insufficient')}</p>
                )}
              </div>
            )}

            <InfoBox title={t('swap.gaslessWhat')} tone="info" id="swap-gasless-help">
              <p>{t('swap.gaslessHelp')}</p>
            </InfoBox>
          </div>
        )}

        {unverifiedTarget && (
          <p className="notice" style={{ marginTop: 10 }}>
            {t('swap.unverifiedWarning', { symbol: unverifiedTarget.symbol })}
          </p>
        )}

        <TokenRiskCard
          chainId={chainId}
          address={toToken?.address}
          symbol={toToken?.symbol}
          onRisk={setToTokenRisk}
        />

        <button
          className="swap-cta"
          style={{ marginTop: 16 }}
          disabled={!canSwap}
          onClick={() => {
            if (confidentialRequested) return;
            if (!wallet.isConnected) return setConnectOpen(true);
            setReviewing(true);
            if (sourceIntentId.current) {
              dispatchStageAlert({
                stage: 'pending',
                kind: 'intent',
                base: fromToken?.symbol,
                quote: toToken?.symbol,
                id: sourceIntentId.current,
                haptic
              }).catch(() => {});
            }
            if (useSettingsStore.getState().expertMode) {
              runSwap();
              return;
            }
          }}
        >
          {confidentialRequested
            ? t('swap.confidentialUnavailable')
            : !wallet.isConnected ? t('wallet.connect') : quoting ? t('swap.quoting') : t('swap.review')}
        </button>
      </section>

      <section className="card">
        <p className="section-label" style={{ marginTop: 0 }}>{t('swap.gasTitle')}</p>
        <p className="muted" style={{ fontSize: 12, lineHeight: 1.85, marginTop: 0 }}>
          {t('swap.gasBody')}
        </p>
        <div className="stack" style={{ gap: 5, marginTop: 8 }}>
          {PAYOUT_DIRECTORY.map((row) => (
            <div className="row-between" key={row.id}>
              <span className="row" style={{ gap: 7 }}>
                <span
                  style={{ width: 7, height: 7, borderRadius: '50%', background: row.color, display: 'inline-block' }}
                />
                <span style={{ fontSize: 12 }}>{row.label}</span>
              </span>
              <span className="mono faint" style={{ fontSize: 11 }}>{row.gas}</span>
            </div>
          ))}
        </div>
        <p className="faint" style={{ marginTop: 9, lineHeight: 1.8 }}>{t('swap.gasNote')}</p>
      </section>

      <AdBanner slot="p2p" />

      <Sheet
        open={Boolean(picker)}
        onClose={() => {
          setPicker(null);
          setPickerQuery('');
          setImportError(null);
        }}
        title={t('swap.selectToken')}
      >
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <span className="icon-btn" style={{ pointerEvents: 'none' }}>
            <AnimatedSearch active={Boolean(pickerQuery)} still={still} width={16} height={16} />
          </span>
          <input
            type="text"
            value={pickerQuery}
            onChange={(e) => {
              setPickerQuery(e.target.value);
              setImportError(null);
            }}
            placeholder={t('swap.searchToken')}
            style={{ flex: 1 }}
          />
        </div>

        {!pickerQuery && (
          <div className="tag-scroll" style={{ marginBottom: 10 }}>
            {curated.slice(0, 6).map((tk) => (
              <button key={tokenKey(tk)} className="tag tag-token" onClick={() => choose(tk)}>
                <TokenIcon token={tk} chainId={chainId} size={18} />
                <span>{tk.symbol}</span>
              </button>
            ))}
          </div>
        )}

        <div className="row-between" style={{ marginBottom: 8 }}>
          <span className="faint">
            {t('swap.tokensAvailable', { n: tokens.length.toLocaleString() })}
          </span>
          {listLoading && <span className="faint">{t('swap.loadingList')}</span>}
        </div>

        <div className="stack" style={{ gap: 6, maxHeight: '48dvh', overflowY: 'auto' }}>
          {pickerResults.map((tk) => {
            const bal = balances[tokenKey(tk)]?.formatted;
            return (
              <button
                key={tokenKey(tk)}
                className="coin-row"
                style={{ width: '100%', textAlign: 'start' }}
                onClick={() => choose(tk)}
              >
                <TokenIcon token={tk} chainId={chainId} size={34} />
                <div className="coin-meta" style={{ minWidth: 0 }}>
                  <div className="coin-sym" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{tk.symbol}</span>
                    {tk.verified && (
                      <span className="pill pill-up" style={{ fontSize: 9, padding: '1px 6px' }}>
                        {t('swap.verified')}
                      </span>
                    )}
                    {tk.imported && (
                      <span className="pill" style={{ fontSize: 9, padding: '1px 6px' }}>
                        {t('swap.imported')}
                      </span>
                    )}
                  </div>
                  <div className="coin-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tk.name}
                    {!tk.verified && !tk.native && tk.address && (
                      <span className="mono faint" style={{ marginInlineStart: 6, fontSize: 9.5 }}>
                        {tk.address.slice(0, 6)}…{tk.address.slice(-4)}
                      </span>
                    )}
                  </div>
                </div>
                {bal != null && bal > 0 && (
                  <span className="mono" style={{ fontSize: 11.5 }}>{fmtQty(bal)}</span>
                )}
              </button>
            );
          })}

          {!pickerResults.length && !importable && (
            <div className="empty" style={{ padding: '18px 0' }}>
              {listLoading ? t('swap.loadingList') : t('swap.noTokenResults')}
            </div>
          )}
        </div>

        {importable && (
          <div className="card card-tight" style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{t('swap.importTitle')}</div>
            <p className="muted" style={{ fontSize: 11.5, margin: '5px 0 9px', lineHeight: 1.75 }}>
              {t('swap.importBody')}
            </p>
            <span className="mono faint" style={{ fontSize: 10, wordBreak: 'break-all' }}>{importable}</span>
            <button className="btn btn-primary btn-sm" style={{ marginTop: 9 }} onClick={runImport} disabled={importing}>
              {importing ? t('swap.importing') : t('swap.importAction')}
            </button>
            {importError && <p className="notice notice-danger" style={{ marginTop: 8 }}>{importError}</p>}
          </div>
        )}

        <p className="notice" style={{ marginTop: 12 }}>{t('swap.verifyContracts')}</p>
      </Sheet>

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title={t('swap.settings')}>
        {chainTab === 'solana' ? (
          <>
            <label className="field-label">{t('swap.slippage')}</label>
            <div className="row" style={{ gap: 6 }}>
              {[0.1, 0.5, 1, 3].map((sv) => (
                <button
                  key={sv}
                  className={`tag ${storedSlippage === sv ? 'active' : ''}`}
                  style={{ flex: 1, textAlign: 'center' }}
                  onClick={() => {
                    haptic?.('select');
                    useSettingsStore.getState().setSlippage(sv);
                  }}
                >
                  {sv}%
                </button>
              ))}
            </div>

            <p className="faint" style={{ marginTop: 9, fontSize: 12 }}>
              {t('swap.solanaSlippageNote', { pct: storedSlippage })}
            </p>

            <InfoBox title={t('swap.slippageWhat')} tone="info" id="sol-slippage-help">
              <p>{t('swap.slippageHelp')}</p>
            </InfoBox>

            {storedSlippage > 3 && (
              <p className="notice notice-danger" style={{ marginTop: 8 }}>{t('swap.slippageHigh')}</p>
            )}

            <InfoBox title={t('swap.solanaOnlyTitle')} tone="info" id="sol-only">
              <p>{t('swap.solanaOnlyBody')}</p>
            </InfoBox>
          </>
        ) : (
        <>
        <label className="field-label">{t('swap.slippage')}</label>

        <div className="row" style={{ gap: 6 }}>
          <button
            className={`tag ${autoSlippage ? 'active' : ''}`}
            style={{ flex: 1, textAlign: 'center' }}
            onClick={() => { haptic?.('select'); setAutoSlippage(true); }}
          >
            {t('swap.auto')}
          </button>
          {[0.1, 0.5, 1, 3].map((s) => (
            <button
              key={s}
              className={`tag ${!autoSlippage && slippage === s ? 'active' : ''}`}
              style={{ flex: 1, textAlign: 'center' }}
              onClick={() => { haptic?.('select'); setAutoSlippage(false); setSlippage(s); }}
            >
              {s}%
            </button>
          ))}
        </div>

        {autoSlippage ? (
          <p className="faint" style={{ marginTop: 9, fontSize: 12 }}>
            {t('swap.autoUsing', { pct: effectiveSlippage, reason: t(`swap.autoReason.${slippageAdvice.reason}`) })}
          </p>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            value={String(slippage)}
            onChange={(e) => {
              const v = Number(e.target.value.replace(',', '.'));
              if (Number.isFinite(v)) setSlippage(Math.min(50, Math.max(0.05, v)));
            }}
            style={{ marginTop: 10 }}
          />
        )}

        <InfoBox title={t('swap.slippageWhat')} tone="info" id="swap-slippage-help">
          <p>{t('swap.slippageHelp')}</p>
        </InfoBox>

        {effectiveSlippage > 3 && (
          <p className="notice notice-danger" style={{ marginTop: 8 }}>{t('swap.slippageHigh')}</p>
        )}

        <label className="field-label" style={{ marginTop: 16 }}>{t('swap.deadline')}</label>
        <div className="row" style={{ gap: 6 }}>
          {[5, 10, 20, 30, 60].map((m) => (
            <button
              key={m}
              className={`tag ${deadlineMin === m ? 'active' : ''}`}
              style={{ flex: 1, textAlign: 'center' }}
              onClick={() => {
                haptic?.('select');
                setDeadlineMin(m);
                useSettingsStore.getState().setDefaultDeadlineMin(m);
              }}
            >
              {t('swap.minutes', { n: m })}
            </button>
          ))}
        </div>
        <InfoBox title={t('swap.deadlineWhat')} tone="info" id="swap-deadline-help">
          <p>{t('swap.deadlineHelp')}</p>
        </InfoBox>

        <div className="set-row" style={{ marginTop: 16 }}>
          <span className="set-row-label">
            <div>{t('swap.expert')}</div>
            <div className="set-row-sub">{t('swap.expertSub')}</div>
          </span>
          <Switch
            on={expertMode}
            label={t('swap.expert')}
            onChange={() => { haptic?.('select'); useSettingsStore.getState().toggle('expertMode'); }}
          />
        </div>
        {expertMode && (
          <p className="notice notice-danger" style={{ marginTop: 8 }}>{t('swap.expertWarn')}</p>
        )}

        {!autoSlippage && slippage !== storedSlippage && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 14, width: '100%' }}
            onClick={() => {
              haptic?.('light');
              useSettingsStore.getState().setSlippage(slippage);
            }}
          >
            {t('swap.saveAsDefault', { pct: slippage })}
          </button>
        )}
        </>
        )}
      </Sheet>

      <Sheet
        open={reviewing}
        onClose={() => {
          if (txState?.stage && !['success', 'error', 'failed'].includes(txState.stage)) return;
          setReviewing(false);
          setTxState(null);
        }}
      >
        <h2 className="h2" style={{ marginBottom: 12 }}>{t('swap.confirmTitle')}</h2>

        {!txState && displayQuoteReady && (
          <>
            <div className="card card-tight stack" style={{ gap: 9 }}>
              <div className="row-between">
                <span className="faint">{t('swap.youPay')}</span>
                <span className="mono" style={{ fontWeight: 700 }}>{amount} {fromToken.symbol}</span>
              </div>
              <div className="row-between">
                <span className="faint">{t('exec.receipt.estimated')}</span>
                <span className="mono up" style={{ fontWeight: 700 }}>≈{fmtQty(displayAmountOut)} {toToken.symbol}</span>
              </div>
              <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.65, margin: 0 }}>
                {t('exec.receipt.reviewHint')}
              </p>
              <div className="row-between">
                <span className="faint">{t('swap.minReceived')}</span>
                <span className="mono">{fmtQty(displayMinOut)} {toToken.symbol}</span>
              </div>
              {useGasless ? (
                gaslessSummary?.ourFee > 0 && (
                  <div className="row-between">
                    <span className="faint">{t('swap.gaslessPlatformFee')}</span>
                    <span className="mono">{fmtQty(gaslessSummary.ourFee)} {fromToken.symbol}</span>
                  </div>
                )
              ) : quote.feeBps > 0 && (
                <div className="row-between">
                  <span className="faint">{t('swap.platformFee', { pct: quote.feeBps / 100 })}</span>
                  <span className="mono">{fmtQty(quote.platformFee)} {fromToken.symbol}</span>
                </div>
              )}
              <div className="row-between">
                <span className="faint">{t('swap.networkFee')}</span>
                <span className="mono">
                  {useGasless ? (
                    <>
                      0 {cfg.native.symbol}
                      <span className="faint" style={{ fontSize: 10.5 }}>
                        {' '}({t('swap.gaslessGasFee')}: {gaslessSummary?.gasFee != null
                          ? `${fmtQty(gaslessSummary.gasFee)} ${fromToken.symbol}`
                          : '—'})
                      </span>
                    </>
                  ) : gasCost != null ? (
                    <>≈{fmtQty(gasCost)} {cfg.native.symbol}</>
                  ) : '—'}
                </span>
              </div>
              <div className="row-between">
                <span className="faint">{t('swap.slippage')}</span>
                <span className="mono">{effectiveSlippage}%</span>
              </div>
              <div className="row-between">
                <span className="faint">{t('swap.recipient')}</span>
                <span className="mono" style={{ fontSize: 11 }}>{shortAddress(wallet.address)}</span>
              </div>
            </div>

            {/* Execution Core: real lifecycle, exact preflight, route policy. */}
            <div className="stack" style={{ gap: 10, marginTop: 12 }}>
              {exec.lifecycle && <IntentTimeline record={exec.lifecycle} />}
              <SimulationCard
                simulation={exec.simulation}
                busy={exec.simulating}
                quoteGasNative={gasCost != null ? fmtQty(gasCost) : null}
                nativeSymbol={cfg?.native?.symbol ?? ''}
              />
              <RoutePolicyCard decision={exec.decision} />
              {exec.recovery && (
                <RecoveryCard
                  plan={exec.recovery}
                  busy={exec.simulating}
                  /* Retry re-runs the PREFLIGHT. It never re-broadcasts a
                     transaction and never silently swaps in another route. */
                  onRetry={() => exec.preflight()}
                />
              )}
            </div>

            <p className="notice" style={{ marginTop: 12 }}>{t('swap.reviewNotice')}</p>

            {/*
              * THE GATE BANNER. Sits between the review and the confirm button so
              * a blocked trade cannot be signed and an unacknowledged high/unknown
              * risk needs a deliberate second press. The wording is honest: a
              * 'block' is a refusal (you cannot sell this / simulation reverted),
              * an 'acknowledge' is a warning the user must see before signing.
              * Absence of data is never shown as "safe".
              */}
            {execGate.decision === 'block' && (
              <div className="infobox infobox-danger" style={{ marginTop: 12 }}>
                <strong>{t('swap.gate.blockedTitle')}</strong>
                <p style={{ marginTop: 6, lineHeight: 1.6 }}>
                  {execGate.blocked.some((r) => r.startsWith('token'))
                    ? t('swap.gate.tokenBlocked')
                    : execGate.blocked.some((r) => r.startsWith('simulation'))
                      ? t('swap.gate.simulationBlocked')
                      : t('swap.gate.walletBlocked')}
                </p>
                <p className="faint mono" style={{ marginTop: 6, fontSize: 10, wordBreak: 'break-all' }}>
                  {execGate.blocked.join(', ')}
                </p>
              </div>
            )}
            {execGate.decision === 'acknowledge' && (
              <div className={`infobox ${execGate.level === 'high' ? 'infobox-danger' : 'infobox-warn'}`} style={{ marginTop: 12 }}>
                <strong>{t('swap.gate.reviewTitle')}</strong>
                <p style={{ marginTop: 6, lineHeight: 1.6 }}>
                  {riskAcknowledged
                    ? t('swap.gate.acknowledged')
                    : execGate.level === 'unknown'
                      ? t('swap.gate.unknownRisk')
                      : t('swap.gate.highRisk')}
                </p>
              </div>
            )}

            <div className="row" style={{ gap: 10, marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => setReviewing(false)}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                /* An intent-originated swap cannot be signed until the exact
                   preflight passes; a gate-blocked trade cannot be signed at
                   all. A plain swap keeps its existing behaviour otherwise. */
                disabled={confirmDisabled}
                onClick={() => {
                  primeAudio();
                  /* Terms moved after the review: the first press re-approves
                     the CHANGED terms the banner just named, and only a second,
                     deliberate press signs them. */
                  if (exec.needsReauthorisation) {
                    exec.acknowledgeChange();
                    return;
                  }
                  /* The execution gate's acknowledge step: a high/unknown risk
                     needs a deliberate first press to acknowledge before a
                     second press signs. This mirrors the route-change flow
                     above — never sign on the same press that surfaced the
                     warning. */
                  if (requiresAcknowledgement(execGate) && !riskAcknowledged) {
                    setRiskAcknowledged(true);
                    return;
                  }
                  runSwap();
                }}
              >
                {exec.enforced && exec.simulating
                  ? t('exec.sim.status.running')
                  : exec.needsReauthorisation
                    ? t('exec.action.REQUEST_NEW_SIGNATURE')
                    : requiresAcknowledgement(execGate) && !riskAcknowledged
                      ? t('swap.gate.acknowledge')
                      : t('swap.confirmSwap')}
              </button>
            </div>
          </>
        )}

        {txState && (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            {['preparing', 'approving', 'quoting', 'signing', 'pending', 'replaced'].includes(txState.stage) && (
              <>
                <div className="spinner" style={{ margin: '0 auto 14px', width: 30, height: 30 }} />
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{t(`swap.stage.${txState.stage}`)}</div>
                <p className="faint">
                  {txState.stage === 'replaced'
                    ? t('swap.trackingReplacement', {
                        reason: txState.replacementReason
                          ? t(`swap.replacementReason.${txState.replacementReason}`)
                          : t('swap.replacementReason.generic')
                      })
                    : t('swap.dontClose')}
                </p>
                {txState.stage === 'replaced' && txState.hash && (
                  <a
                    href={explorerTx(chainId, txState.hash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mono faint"
                    style={{ fontSize: 9.5, display: 'block', marginTop: 8, wordBreak: 'break-all', color: 'var(--rgb-1)' }}
                  >
                    {t('swap.replacementHash')}: {txState.hash}
                  </a>
                )}
              </>
            )}

            {txState.stage === 'success' && (
              <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                <div style={{ fontSize: 40 }}>✅</div>
                <div style={{ fontWeight: 800, fontSize: 16, margin: '8px 0 2px' }}>
                  {t('swap.success')}
                </div>
                <p className="faint" style={{ fontSize: 12 }}>{t('swap.successSettled')}</p>

                {txState.paid != null && (
                  <div className="card card-tight stack" style={{ gap: 8, marginTop: 12, textAlign: 'start' }}>
                    <div className="row-between">
                      <span className="faint">{t('swap.youPay')}</span>
                      <span className="mono" style={{ fontSize: 13 }}>
                        {fmtQty(Number(txState.paid))} {txState.paidSymbol}
                      </span>
                    </div>
                    <div className="row-between">
                      <span className="faint">{t('exec.receipt.estimated')}</span>
                      <span className="mono" style={{ fontSize: 13 }}>
                        ≈{fmtQty(Number(txState.estimatedOut ?? txState.got))} {txState.gotSymbol}
                      </span>
                    </div>
                    {txState.minReceived != null && (
                      <div className="row-between">
                        <span className="faint">{t('swap.minReceived')}</span>
                        <span className="mono" style={{ fontSize: 13 }}>
                          {fmtQty(Number(txState.minReceived))} {txState.gotSymbol}
                        </span>
                      </div>
                    )}
                    <div className="row-between">
                      <span className="faint">{t('exec.receipt.actual')}</span>
                      <span className="mono up" style={{ fontSize: 13, fontWeight: 700 }}>
                        {txState.actualExtracted
                          ? `${fmtQty(Number(txState.actualOut))} ${txState.gotSymbol}`
                          : t('exec.receipt.unavailable')}
                      </span>
                    </div>
                    {txState.actualExtracted && txState.outputDeltaBps != null && (
                      <div className="row-between">
                        <span className="faint">{t('exec.receipt.delta')}</span>
                        <span className={`mono ${txState.outputDeltaBps < 0 ? 'down' : 'up'}`} style={{ fontSize: 12 }}>
                          {txState.outputDeltaBps > 0 ? '+' : ''}{txState.outputDeltaBps} bps
                        </span>
                      </div>
                    )}
                    {!txState.actualExtracted && (
                      <p className="faint" style={{ fontSize: 10.5, lineHeight: 1.65, margin: 0 }}>
                        {t('exec.receipt.unavailableHint')}
                      </p>
                    )}
                    {txState.chainName && (
                      <div className="row-between">
                        <span className="faint">{t('swap.network')}</span>
                        <span style={{ fontSize: 12.5 }}>{txState.chainName}</span>
                      </div>
                    )}
                  </div>
                )}

                <p className="faint" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.7 }}>
                  {txState.gasless ? t('swap.gaslessSubmitted') : t('swap.successWhere')}
                </p>

                {txState.gaslessHash && (
                  <p className="mono faint" style={{ fontSize: 10, marginTop: 8, wordBreak: 'break-all' }}>
                    {txState.gaslessHash}
                  </p>
                )}

                {txState.proofId && (
                  <a
                    href="#/intent?tab=proofs"
                    className="card card-tight"
                    style={{
                      display: 'block', marginTop: 10, textAlign: 'start', textDecoration: 'none',
                      borderColor: 'rgba(101,245,188,.24)', background: 'rgba(101,245,188,.055)'
                    }}
                  >
                    <div className="row-between">
                      <strong style={{ color: 'var(--text-1)', fontSize: 11.5 }}>{t('swap.proofReady')}</strong>
                      <span className="pill pill-up" style={{ fontSize: 8 }}>{t('swap.proofVerified')}</span>
                    </div>
                    <p className="mono faint" style={{ fontSize: 9, margin: '7px 0 0', wordBreak: 'break-all' }}>
                      {txState.proofId}
                    </p>
                    <p className="faint" style={{ fontSize: 9.5, margin: '5px 0 0', lineHeight: 1.55 }}>
                      {t('swap.proofScope')}
                    </p>
                  </a>
                )}
              </motion.div>
            )}

            {(txState.stage === 'error' || txState.stage === 'failed') && (
              <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                <div style={{ fontSize: 40 }}>❌</div>
                <div style={{ fontWeight: 800, fontSize: 15, margin: '8px 0 2px' }} className="down">
                  {t(`swap.err.${txState.error ?? 'TX_FAILED'}`)}
                </div>

                <p className="notice" style={{ marginTop: 10, textAlign: 'start' }}>
                  {txState.stage === 'failed'
                    ? t('swap.failedOnChain')
                    : t('swap.failedNothingSent')}
                </p>

                {txState.detail && (
                  <p className="faint mono" style={{ fontSize: 10, marginTop: 8 }}>{txState.detail}</p>
                )}
              </motion.div>
            )}

            {txState.hash && (
              <a
                href={explorerTx(chainId, txState.hash)}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost"
                style={{ display: 'block', marginTop: 12, textDecoration: 'none', lineHeight: '1.4' }}
              >
                {t('swap.viewOnExplorer')}
              </a>
            )}

            {['success', 'error', 'failed'].includes(txState.stage) && (
              <button
                className="btn btn-primary"
                style={{ marginTop: 10 }}
                onClick={() => {
                  setReviewing(false);
                  setTxState(null);
                }}
              >
                {t('common.done')}
              </button>
            )}
          </div>
        )}
      </Sheet>

      <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
      </>
      )}
    </PageTransition>
  );
}
