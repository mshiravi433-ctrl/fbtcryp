import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Switch from '../components/Switch';
import { gaslessEligible, getGaslessPrice, getGaslessQuote, submitGasless, summariseGasless } from '../lib/gasless';
import AdBanner from '../components/AdBanner';
import Sheet from '../components/Sheet';
import WalletConnectSheet from '../components/WalletConnectSheet';
import AnimatedNumber from '../components/AnimatedNumber';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { EVM_CHAINS, TOKENS, explorerTx } from '../lib/chains';
import {
  getTokensSync,
  importTokenByAddress,
  loadTokens,
  searchTokens,
  tokenKey
} from '../lib/tokenLists';
import { notifyTrade, primeAudio } from '../lib/notify';
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
import { NATIVE_GAS_FLOOR, formatUnitsExact } from '../lib/swap';
import { AnimatedSearch, AnimatedSettings, AnimatedSwap, useStill } from '../components/AnimatedIcon';
import { PAYOUT_DIRECTORY } from '../lib/payout';
import { useHideBalances } from '../hooks/useHideBalances';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Real on-chain swap screen.
 *
 * Every transaction is signed by the user's own wallet and broadcast from it;
 * we hold no funds and have no deposit address anywhere in the flow. A 0.5%
 * platform fee is taken on-chain in the same transaction and always shown
 * before signing.
 *
 * TOKEN UNIVERSE
 * The picker is not a curated shortlist. It loads the public token lists for
 * the active chain — thousands of tokens — with ranked search over ticker,
 * name and contract address, exactly like PancakeSwap. Anything too new to be
 * in a list can be imported by pasting its contract address.
 *
 * BALANCES
 * We only read balances for the curated set plus whatever is currently
 * selected. Reading four thousand ERC-20 balances on every render would
 * hammer the RPC and freeze a cheap phone; the picker shows balances where we
 * have them and stays silent where we don't, rather than blocking on it.
 */
export default function Swap() {
  // Subscribe so the figures re-render the moment the switch moves;
  // the masking itself lives in the formatters.
  useHideBalances();
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  const chainId = wallet.chainId ?? 56;
  const cfg = EVM_CHAINS[chainId] ?? EVM_CHAINS[56];
  const curated = TOKENS[chainId] ?? TOKENS[56];

  // Whole token universe for this chain: curated first, then public lists.
  const [tokens, setTokens] = useState(() => getTokensSync(chainId));
  const [listLoading, setListLoading] = useState(false);

  const [fromToken, setFromToken] = useState(() => curated[0]);
  const [toToken, setToToken] = useState(() => curated[1] ?? curated[0]);
  const [amount, setAmount] = useState('');
  /*
   * Seeded from the user's setting, not from the module default.
   *
   * REAL BUG: Settings had a "default slippage" picker offering 0.1 / 0.5 / 1
   * / 3 %. It wrote the value, redrew its own label from it, and NOTHING ELSE
   * EVER READ IT — this line hardcoded DEFAULT_SLIPPAGE. Someone who set 3%
   * for thin memecoin pairs got 0.5% on every swap and watched them revert;
   * someone who set 0.1% for safety was quoted 0.5% and could lose more than
   * they agreed to. Same dead-control family as the auto-lock and
   * hide-balances toggles.
   *
   * Read once as the initial value rather than subscribed: this is the
   * STARTING point, and the per-swap control below must stay free to override
   * it without Settings yanking it back.
   */
  const [slippage, setSlippage] = useState(
    () => useSettingsStore.getState().defaultSlippage ?? DEFAULT_SLIPPAGE
  );

  /*
   * ─── AUTO SLIPPAGE ──────────────────────────────────────────────────────
   * On by default. See `suggestSlippage` in lib/swap.js for why a single fixed
   * number is wrong in both directions — the short version is that the 3% a
   * user sets to get a thin token through then STAYS SET for their next USDT
   * swap, where it is free money for a sandwich bot.
   *
   * Turning it off is sticky for the session: an override that keeps reverting
   * is worse than no override.
   */
  const [autoSlippage, setAutoSlippage] = useState(true);

  /*
   * The transaction deadline, in minutes.
   *
   * `executeSwap` and `executeAggregatorSwap` have both accepted
   * `deadlineMinutes` since they were written and NOTHING ever passed it, so
   * every swap this app has made used the hardcoded 20. It is now a real
   * control and is actually forwarded at the call site.
   */
  const [deadlineMin, setDeadlineMin] = useState(DEFAULT_DEADLINE_MIN);

  const expertMode = useSettingsStore((s) => s.expertMode);
  const storedSlippage = useSettingsStore((s) => s.defaultSlippage);

  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [impact, setImpact] = useState(null);

  /*
   * ─── THE SLIPPAGE ACTUALLY USED ─────────────────────────────────────────
   * One derived value, so the number shown in Settings, the number shown in
   * the review sheet, and the number sent to the router can never disagree.
   * Keeping three copies in sync by hand is precisely how a user ends up
   * consenting to one figure and signing another.
   *
   * ─── AND WHY IT IS DECLARED HERE, NOT NEXT TO THE OTHER DERIVED VALUES ──
   * `const` is hoisted but not initialised, so a reference before this line is
   * a ReferenceError, not `undefined`. Declared lower down it read fine and
   * crashed the whole screen on mount — the quote effect closes over it ~250
   * lines earlier. The render test caught it; the browser would have shown a
   * blank page. It has to sit above its first use.
   */
  const slippageAdvice = useMemo(
    () => suggestSlippage({
      priceImpact: impact,
      bothStable: isStableSymbol(fromToken?.symbol) && isStableSymbol(toToken?.symbol)
    }),
    [impact, fromToken?.symbol, toToken?.symbol]
  );
  const effectiveSlippage = autoSlippage ? slippageAdvice.slippage : slippage;

  /*
   * PRE-FILL FROM A LIMIT ORDER / DCA PLAN.
   *
   * The Orders screen hands off with ?from=BNB&to=USDT&amount=1. Without this
   * the "Swap now" button on a triggered order would land on an empty form and
   * make the user re-enter everything they already specified — at which point
   * the feature is worse than a plain reminder.
   *
   * Applied once, then the params are cleared from the URL: leaving them means
   * a later refresh silently resets whatever the user has since typed.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const prefillDone = useRef(false);

  useEffect(() => {
    if (prefillDone.current) return;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const amt = searchParams.get('amount');
    if (!from && !to && !amt) return;

    /*
     * ─── HONOUR `?chain=` HERE TOO ────────────────────────────────────────
     * `curated` is the token list FOR THE CURRENT CHAIN. A symbol that only
     * exists on another chain therefore finds nothing, and the prefill fails
     * silently — the screen opens on its defaults and the user is left
     * wondering why the link did nothing.
     *
     * That is why tokenised gold looked unsellable: PAXG and XAUt are
     * Ethereum-only, so a link to them while the wallet sat on BNB Chain
     * matched no entry at all. Reported as «الان توکن rwa هم نمیشه درامد
     * زایی کرد» — the tokens were listed and routable, but nothing could
     * reach them. The same defect silently broke the new Farm staking links,
     * which are also Ethereum-only.
     *
     * The address prefill below already solved this; the symbol prefill was
     * simply never given the same treatment. Switch first and let the effect
     * re-run once the chain matches, rather than matching against the wrong
     * list and giving up.
     */
    const wantedChain = Number(searchParams.get('chain'));
    if (EVM_CHAINS[wantedChain] && wantedChain !== chainId) {
      wallet.switchChain?.(wantedChain).catch(() => {});
      return;
    }

    prefillDone.current = true;

    // Match against the curated list only. A symbol from the URL must never
    // select an arbitrary imported token — two different contracts can share
    // a ticker, and picking the wrong one sends funds to the wrong asset.
    const pick = (sym) => curated.find((x) => x.symbol === sym);
    const f = from && pick(from);
    const tk = to && pick(to);
    if (f) setFromToken(f);
    if (tk) setToToken(tk);
    if (amt && Number(amt) > 0) setAmount(String(amt));

    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, curated, chainId, wallet]);

  /*
   * ─── PRE-FILL BY CONTRACT ADDRESS, FROM A COIN PAGE ─────────────────────
   * `?chain=56&toAddress=0x…`
   *
   * The coin page used to say "cannot be swapped here" for anything outside
   * the 46-entry curated table — reported as «بعضی از کویین ها مثل پنگوئن
   * میگه نمیشه سواپ کرد». It now resolves the coin's real contract (see
   * lib/coinVenue.js) and hands it over HERE.
   *
   * ─── WHY IT IS A SEPARATE PARAMETER FROM `?to=` ─────────────────────────
   * `?to=` is a SYMBOL and is matched against the curated list only, on
   * purpose: a symbol from a URL must never select an arbitrary token,
   * because dozens of contracts share a ticker and scam tokens copy real ones
   * deliberately. That guarantee must survive.
   *
   * An ADDRESS carries no such ambiguity — it names exactly one contract — so
   * it gets its own parameter and its own path: look it up in the loaded
   * lists, and if it is not there, import it by reading `symbol`/`decimals`
   * off-chain. The imported token is flagged `verified: false`, so the swap
   * screen's existing unverified-token warning fires exactly as it would for
   * a hand-pasted address. The user is told; they are not turned away.
   */
  const addressPrefill = useRef(false);
  useEffect(() => {
    if (addressPrefill.current) return;
    const wanted = searchParams.get('toAddress');
    if (!wanted || !/^0x[a-fA-F0-9]{40}$/.test(wanted)) return;

    const wantedChain = Number(searchParams.get('chain'));
    /*
     * The address belongs to ONE chain. Applying it while the wallet is on a
     * different chain would select a contract that does not exist there — at
     * best a failed quote, at worst a different token at the same address.
     * So we wait until the chain matches instead of guessing.
     */
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
        } catch {
          /*
           * Import failed — a dead RPC, or an address that is not an ERC-20 on
           * this chain. Leave the form on its defaults rather than half-set:
           * a `to` field showing a token we could not read is worse than one
           * the user picks themselves.
           */
        }
      }
      if (!alive) return;
      /*
       * Pay with the stablecoin, not with the token being bought. Without
       * this the form opens with the same token on both sides, which the
       * quote engine rejects as SAME_TOKEN and reads as a broken link.
       */
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

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, chainId]);
  const [balances, setBalances] = useState({});
  /* `impact` is declared earlier, beside the quote state: `slippageAdvice`
     derives from it and must not sit in its temporal dead zone. */
  const [gasCost, setGasCost] = useState(null);
  const [picker, setPicker] = useState(null); // 'from' | 'to'
  const [pickerQuery, setPickerQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [txState, setTxState] = useState(null); // { stage, hash, error }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flipCount, setFlipCount] = useState(0);
  const still = useStill();

  const fromSym = fromToken?.symbol;
  const toSym = toToken?.symbol;

  /* --------------------------- token list load --------------------------- */

  useEffect(() => {
    let alive = true;
    // Paint whatever is cached immediately, then refresh in the background.
    setTokens(getTokensSync(chainId));
    setListLoading(true);
    loadTokens(chainId)
      .then((list) => alive && setTokens(list))
      .catch(() => {})
      .finally(() => alive && setListLoading(false));
    return () => {
      alive = false;
    };
  }, [chainId]);

  // Switching chains invalidates the selected pair — a BSC token address means
  // nothing on Arbitrum, and quoting it would fail confusingly.
  useEffect(() => {
    const list = TOKENS[chainId] ?? [];
    if (!list.length) return;
    setFromToken(list[0]);
    setToToken(list[1] ?? list[0]);
    setAmount('');
    setQuote(null);
  }, [chainId]);

  const quoteSeq = useRef(0);

  /* ------------------------------ picker ------------------------------- */

  const pickerResults = useMemo(
    () => searchTokens(tokens, pickerQuery, 150),
    [tokens, pickerQuery]
  );

  // A contract address that matches nothing in any list — offer to import it.
  const importable = useMemo(() => {
    const q = pickerQuery.trim();
    return /^0x[a-fA-F0-9]{40}$/.test(q) && pickerResults.length === 0 ? q : null;
  }, [pickerQuery, pickerResults]);

  const choose = (tk) => {
    const other = picker === 'from' ? toToken : fromToken;
    if (tokenKey(tk) === tokenKey(other)) {
      // Selecting the token already on the other side means "flip", which is
      // what every DEX does and what the user obviously meant.
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

  /* ------------------------------ balances ------------------------------ */

  /**
   * Read balances for the curated set plus the two selected tokens.
   *
   * Deliberately NOT the whole universe: four thousand `balanceOf` calls per
   * chain switch would rate-limit the public RPC and lock up a low-end phone
   * for seconds. Keyed by contract address, because symbols are not unique
   * once you load public lists — there are dozens of tokens called "USDT".
   */
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
    } catch {
      /* leave stale balances rather than blanking the UI */
    }
  }, [wallet, chainId, curated, fromToken, toToken]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  /* ------------------------------- quoting ------------------------------- */

  useEffect(() => {
    const n = Number(amount);
    if (!n || n <= 0 || !fromToken || !toToken || tokenKey(fromToken) === tokenKey(toToken)) {
      setQuote(null);
      setImpact(null);
      return undefined;
    }

    const seq = ++quoteSeq.current;
    setQuoting(true);

    const timer = setTimeout(async () => {
      try {
        const provider = await wallet.getReadProvider(chainId);
        const q = await getQuote({
          provider, chainId, fromToken, toToken, amountIn: amount,
          /* The value the router will actually use - see effectiveSlippage. */
          slippage: effectiveSlippage
        });
        if (seq !== quoteSeq.current) return; // a newer request superseded this one
        setQuote(q);
        if (q && !q.error) {
          getPriceImpact({ provider, chainId, fromToken, toToken, amountIn: amount, quote: q })
            .then((i) => seq === quoteSeq.current && setImpact(i))
            .catch(() => {});
          estimateGasCost(provider)
            .then((g) => seq === quoteSeq.current && setGasCost(g))
            .catch(() => {});
        }
      } catch {
        if (seq === quoteSeq.current) setQuote({ error: 'QUOTE_FAILED' });
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 420); // debounce typing

    return () => clearTimeout(timer);
  }, [amount, fromToken, toToken, effectiveSlippage, chainId, wallet, fromSym, toSym]);

  // refresh the quote every 15s so it can't go stale under the user
  useEffect(() => {
    if (!quote || quote.error) return undefined;
    const id = setInterval(() => setAmount((a) => a), 15000);
    return () => clearInterval(id);
  }, [quote]);

  /* -------------------------------- actions ------------------------------ */

  function flip() {
    haptic?.('select');
    setFlipCount((n) => n + 1);
    setFromToken(toToken);
    setToToken(fromToken);
    setAmount('');
    setQuote(null);
  }

  /**
   * MAX had three real bugs, all of which end in a reverted transaction that
   * still burns gas:
   *
   * 1. `toFixed(8)` ROUNDS. On a large balance it rounds UP, producing an
   *    amount fractionally greater than what the wallet holds — the swap then
   *    reverts on transfer. Truncating is the only safe direction here.
   * 2. `toFixed(8)` also floors any 18-decimal token below 1e-8 to exactly
   *    zero, so MAX on a small holding filled in "0".
   * 3. The gas reserve was a flat 0.002 native coin. That is ~$1 of BNB but
   *    ~$7 of ETH, and on a chain with expensive gas it can still be too
   *    little. We now reserve the live estimate with headroom and fall back to
   *    a per-chain floor.
   *
   * Working from the raw BigInt balance avoids float error entirely; the
   * float is only used for display.
   */
  /**
   * Fill a PERCENTAGE of the balance. `setMax()` is `setPortion(100)`.
   *
   * ─── WHY 100% IS NOT "THE WHOLE BALANCE" ────────────────────────────────
   * On a native coin the gas reserve still has to come off, or the swap
   * reverts and burns the gas anyway. 100% therefore means "everything you
   * can actually spend", which is the only definition that does not produce
   * a failed transaction.
   *
   * The partial fractions deliberately do NOT subtract the reserve: 25% of a
   * balance already leaves three quarters behind, far more than any gas cost.
   * Subtracting it as well would quietly short-change the user.
   *
   * ─── WHY THE MATH STAYS IN BigInt ───────────────────────────────────────
   * `raw * 25n / 100n` is exact. Doing it in floats and converting back is
   * how you get an amount one wei above the balance on an 18-decimal token,
   * which reverts on transfer having already charged gas. Integer division
   * truncates, and truncating is the only safe direction here — the same
   * reasoning as the toFixed bug documented below.
   */
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
      // Reserve real gas, not a guess. gasCost is in native units; scale it
      // into wei and add 60% headroom for a gas-price spike between the quote
      // and the signature.
      const estimated = gasCost != null && gasCost > 0 ? gasCost * 1.6 : 0;
      const floor = NATIVE_GAS_FLOOR[chainId] ?? 0.002;
      const reserve = Math.max(estimated, floor);

      // parseUnits via string to avoid float→BigInt precision loss.
      const reserveWei = BigInt(Math.floor(reserve * 1e9)) * 10n ** BigInt(fromToken.decimals - 9);
      usableWei = raw > reserveWei ? raw - reserveWei : 0n;
    }

    if (usableWei <= 0n) {
      setAmount('');
      return;
    }

    setAmount(formatUnitsExact(usableWei, fromToken.decimals));
  };

  /* Kept as a named alias so existing callers read clearly. */
  const setMax = () => setPortion(100);

  /**
   * Execute WITHOUT the user holding any native coin.
   *
   * ─── HOW THIS DIFFERS FROM A NORMAL SWAP, AND WHY IT IS SEPARATE ────────
   * A normal swap builds a transaction the wallet broadcasts. This builds one
   * or two EIP-712 MESSAGES the wallet signs, which we relay to 0x, who submit
   * them and pay the gas. Different approval mechanism (Permit2), different
   * failure modes, different response shape. Threading it through `runSwap`
   * would put four more branches inside the one function on this screen that
   * moves real money.
   *
   * ─── THE USER SIGNS; WE NEVER HOLD ANYTHING ─────────────────────────────
   * We relay a signature. We cannot alter what it authorises, cannot execute
   * it twice, and never take custody. The non-custodial property is unchanged
   * — what changes is only who pays the gas.
   */
  const runGasless = async () => {
    const signer = wallet.getSigner?.();
    if (!signer) return;

    setTxState({ stage: 'preparing' });
    try {
      /*
       * The EXACT integer, taken from the quote rather than re-derived from
       * the typed string. `Number(amount) * 10 ** decimals` loses precision
       * well inside the range users type — 0.1 at 18 decimals does not come
       * out clean — and 0x reject a non-integer amount. The quote already
       * holds it as a BigInt for precisely this reason.
       */
      const raw = quote?.amountInWei != null ? quote.amountInWei.toString() : null;
      if (!raw) throw new Error('BAD_AMOUNT');

      /*
       * Re-quote at the moment of signing rather than reusing the indicative
       * price. A gasless quote carries the exact payload to be signed and it
       * expires; signing a stale one fails upstream after the user has already
       * approved it in their wallet.
       */
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

      setTxState({ stage: 'signing' });

      /*
       * Two signatures at most, and the approval one is often absent — a token
       * that already has a Permit2 allowance returns only `trade`. Treating a
       * missing `approval` as an error would break the second swap of every
       * token the user has already used.
       */
      const signed = {};
      for (const kind of ['approval', 'trade']) {
        const obj = q?.[kind];
        if (!obj?.eip712) continue;
        const { domain, types, message } = obj.eip712;
        /*
         * EIP712Domain is implicit in ethers and MUST be removed, or signing
         * throws on an ambiguous primary type. This is the single most common
         * mistake integrating 0x gasless.
         */
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

      /*
       * 0x return a tradeHash, not a transaction hash — they have not
       * submitted it on-chain yet. Showing it as a tx hash would send the user
       * to an explorer page that does not exist, which reads as "my money is
       * gone" at the worst moment. It is reported as a pending trade instead.
       */
      setTxState({ stage: 'success', gaslessHash: res?.tradeHash ?? null, gasless: true });
      haptic?.('success');
      notifyTrade?.({ from: fromToken.symbol, to: toToken.symbol, amount });
    } catch (e) {
      setTxState({ stage: 'error', message: e?.shortMessage || e?.message || 'TX_FAILED' });
      haptic?.('error');
    }
  };

  const runSwap = async () => {
    if (useGasless) return runGasless();

    const signer = wallet.getSigner?.();
    if (!signer || !quote || quote.error) return;

    setTxState({ stage: 'preparing' });
    try {
      // 1. approve if the router can't move enough of the input token yet
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
        await approval.wait();
      }

      // 2. re-quote right before sending — prices move while you approve
      setTxState({ stage: 'quoting' });
      const fresh = await getQuote({
        provider, chainId, fromToken, toToken, amountIn: amount,
        slippage: effectiveSlippage
      });
      if (!fresh || fresh.error) throw new Error('QUOTE_EXPIRED');

      setTxState({ stage: 'signing' });
      /*
       * `deadlineMinutes` is forwarded for the first time here. It has been a
       * parameter of executeSwap since the file was written, defaulting to 20,
       * and no caller ever supplied one — so the Settings control that now
       * exists would have been pure decoration without this line.
       */
      const tx = await executeSwap({
        signer, chainId, fromToken, toToken, quote: fresh, deadlineMinutes: deadlineMin
      });
      setTxState({ stage: 'pending', hash: tx.hash });
      haptic?.('medium');

      const receipt = await tx.wait();
      const ok = receipt.status === 1;
      /*
       * Carry the RECEIPT DETAILS into the result state.
       *
       * The success screen used to be a green tick and one word. After a swap
       * that takes a minute to confirm, that answers none of the questions the
       * user actually has — what did I send, what did I get, on which network,
       * and where can I verify it. People re-checked their wallet to find out,
       * and a couple resubmitted because they could not tell it had worked.
       *
       * `fresh` is the re-quote that was actually executed, not the older one
       * shown before signing, so these are the real numbers.
       */
      setTxState({
        stage: ok ? 'success' : 'failed',
        hash: tx.hash,
        paid: amount,
        paidSymbol: fromToken.symbol,
        got: fresh.amountOut,
        gotSymbol: toToken.symbol,
        chainName: cfg?.name ?? null
      });

      // Ring + vibrate the moment the trade settles. A swap can take a minute
      // to confirm and people put the phone down — a silent success is a
      // success they miss, and then they resubmit.
      notifyTrade({
        ok,
        haptic,
        title: t(ok ? 'notify.tradeDoneTitle' : 'notify.tradeFailTitle'),
        body: ok
          ? t('notify.tradeDoneBody', { amount, from: fromToken.symbol, to: toToken.symbol })
          : t('notify.tradeFailBody')
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
        : /INSUFFICIENT_OUTPUT_AMOUNT/i.test(msg) ? 'SLIPPAGE'
        : 'TX_FAILED';
      setTxState({ stage: 'error', error: code, detail: msg.slice(0, 140) });
      // A rejection in the wallet is the user's own choice — buzzing at them
      // for it is noise. Everything else is a real failure worth signalling.
      if (code !== 'USER_REJECTED') {
        notifyTrade({ ok: false, haptic, title: t('notify.tradeFailTitle'), body: t(`swap.err.${code}`) });
      } else {
        haptic?.('warning');
      }
    }
  };

  const fromBal = balances[tokenKey(fromToken)]?.formatted ?? 0;
  /**
   * Compare against the RAW balance, not the float.
   *
   * `Number(amount) > fromBal` compares two doubles, and an 18-decimal balance
   * does not fit in one. The classic failure: tap MAX on a large holding, the
   * float comparison says it fits, the chain disagrees, and the transaction
   * reverts after the user has already paid gas. `quote.amountInWei` is the
   * exact integer the router will actually pull, so that is what we check.
   */
  const fromRaw = balances[tokenKey(fromToken)]?.raw;
  const insufficient =
    quote?.amountInWei != null && fromRaw != null
      ? quote.amountInWei > fromRaw
      : Number(amount) > fromBal;
  const canSwap = wallet.isConnected && quote && !quote.error && !insufficient && Number(amount) > 0;
  const highImpact = impact != null && impact > 5;


  /**
   * Gas warning. The native balance has to cover the estimated gas AND, when
   * the input token IS the native coin, the amount being swapped. Warning
   * before the wallet does is cheaper than a reverted transaction that still
   * burns the gas it failed on.
   */
  const nativeBal = wallet.nativeBalance ?? 0;
  const gasNeeded = (gasCost ?? 0) * 1.35; // headroom for a gas-price bump
  const spendingNative = Boolean(fromToken?.native);
  const lowGas =
    wallet.isConnected &&
    gasCost != null &&
    nativeBal < gasNeeded + (spendingNative ? Number(amount) || 0 : 0);

  /** The side we are buying into, when it isn't hand-verified. */
  const unverifiedTarget = toToken && !toToken.verified && !toToken.native ? toToken : null;

  /*
   * ─── GASLESS: THE DEAD END THIS OPENS ───────────────────────────────────
   * Someone holding USDT with no BNB can do NOTHING here — every EVM action
   * needs the chain's native coin, and buying that coin is itself a
   * transaction needing gas. `server/gasless.js` has solved this since it
   * shipped and no screen could reach it.
   *
   * Offered rather than forced. It costs more than a normal swap (0x take a
   * cut on top of ours, and the gas is priced into the token), so defaulting
   * to it would quietly overcharge everyone who does have gas. It appears as
   * an option, and is RECOMMENDED only when the user genuinely cannot pay gas.
   */
  const gaslessOk = gaslessEligible({ chainId, fromToken, toToken });
  const [useGasless, setUseGasless] = useState(false);
  const [gaslessQuote, setGaslessQuote] = useState(null);
  const [gaslessBusy, setGaslessBusy] = useState(false);

  /*
   * The user cannot pay gas at all. This is the case the feature exists for,
   * and the only case where we actively recommend it.
   *
   * `nativeBal <= 0` rather than `lowGas`: lowGas also fires when the balance
   * is merely tight, and nudging somebody onto a costlier route because they
   * are close to the line would be us profiting from a scare.
   */
  const cannotPayGas = wallet.isConnected && gaslessOk && nativeBal <= 0;

  /* Switching pair or chain must drop a stale quote — it is priced for the
     old pair and would be signed against the new one. */
  useEffect(() => {
    setGaslessQuote(null);
    if (!gaslessOk) setUseGasless(false);
  }, [gaslessOk, chainId, fromSym, toSym, amount]);

  const gaslessSummary = useMemo(
    () => summariseGasless(gaslessQuote, toToken?.decimals ?? 6),
    [gaslessQuote, toToken?.decimals]
  );

  /* --------------------------------- UI ---------------------------------- */

  /*
   * ─── EVM AND SOLANA, ONE SCREEN ─────────────────────────────────────────
   * Requested: «سواپ و سواپ سولانا را داخل یک صفحه در دو تب بزار و از منو
   * سواپ سولانا را پاک کن».
   *
   * The old comment in BottomNav argued Solana deserved its own screen
   * because it uses a different wallet. That was true and still is — but it
   * is an implementation detail, not a user-facing distinction. From the
   * user's side both tabs answer the same question: "swap this for that".
   * Making them hunt through the More menu for half the answer was the
   * mistake.
   *
   * The panels stay as SEPARATE COMPONENTS rather than being merged into one
   * form. They genuinely differ — different wallet adapters, different
   * address formats, different aggregators — and folding them together would
   * produce a form where half the fields change meaning depending on a
   * dropdown. Two tabs is honest; one confused form is not.
   */
  const [chainTab, setChainTab] = useState('evm');

  return (
    <PageTransition>
      <motion.div className="row-between" variants={riseIn} initial="hidden" animate="show">
        <div>
          <h1 className="h1">{t('swap.title')}</h1>
          <p className="muted">{t('swap.subtitle', { dex: cfg.dexName })}</p>
        </div>
        {/* Was a bare "⚙" character: renders differently on every OS, can't
            be recoloured, and looked nothing like the rest of the icon set. */}
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
            onClick={() => {
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

      {/*
        `embedded` so it does not open a second PageTransition inside this
        one — nesting them animates the same subtree twice and produces a
        visible double-fade every time the tab changes.
      */}
      {chainTab === 'solana' && <SolanaSwap embedded />}

      {chainTab === 'evm' && (
      <>
      {/*
        ─── THE POLICY EXPLANATION COLLAPSES; THE PER-TAP WARNINGS DO NOT ────
        Asked for: «همه هشدارها و نظرات را در هر صفحه بزار تو باکس باز شونده
        تا صفحه شلوغ بنظر نرسد».

        This block is three sentences of "how custody works here". True,
        important, and read once. It sat directly between the heading and the
        swap form, so on a phone the form itself began below the fold.

        Everything further down this file stays an inline `.notice` on
        purpose, and the line is not arbitrary: high price impact, insufficient
        balance, a quote error, a >3% slippage setting and the review sheet all
        describe what THIS TAP is about to do with real money. Those must not
        be one tap away from being read.
      */}
      <InfoBox title={t('swap.custodyTitle')} tone="info" id="swap-custody">
        <p>{t('swap.nonCustodialNotice')}</p>
        <p>{t('swap.verifyContracts')}</p>
      </InfoBox>

      {/*
        ─── THE ISSUER-FREEZE WARNING, SHOWN ONLY WHEN IT APPLIES ─────────────
        Tokenised gold is the one real-world-asset category with open DEX
        liquidity, so PAXG and XAUt are listed. But they are NOT like the other
        tokens on this screen in one specific way: the issuer can freeze a
        balance, and Paxos's contract can also BURN one.

        That is a real risk for our users rather than boilerplate. It is shown
        inline — not folded into the collapsible box above — because someone
        buying "gold" reasonably assumes they will own it outright, and this
        contradicts the assumption. It renders only when a gold token is
        actually selected, so it stays a fact about this trade instead of
        another permanent warning people learn to scroll past.
      */}
      {(fromToken?.rwa || toToken?.rwa) && (
        <p className="notice" style={{ marginTop: 11 }}>
          {t('swap.rwaFreezeNotice')}
        </p>
      )}

      {/* connection status */}
      <motion.div className="card card-tight row-between" variants={riseIn} initial="hidden" animate="show">
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
      </motion.div>

      {/* --------------------------- chain selector -------------------------- */}
      <div className="tag-scroll">
        {Object.values(EVM_CHAINS).map((c) => (
          <motion.button
            key={c.id}
            className={`tag ${chainId === c.id ? 'active' : ''}`}
            whileTap={{ scale: 0.94 }}
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
          </motion.button>
        ))}
      </div>

      {/* ------------------------------ ticket ------------------------------ */}
      <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />

        {/* FROM */}
        <div className="row-between" style={{ marginBottom: 6 }}>
          <span className="field-label" style={{ margin: 0 }}>{t('swap.from')}</span>
          <span className="faint mono">
            {t('swap.balance')}: {fmtQty(fromBal)}
          </span>
        </div>
        {/*
          ─── PERCENTAGE SHORTCUTS ──────────────────────────────────────────
          Requested: the Trust Wallet pattern. It replaces the single MAX
          button, which was the only shortcut and the least useful one — MAX
          is the amount people are most hesitant to commit, so a lone MAX
          button gets ignored and the field gets typed into by hand.

          Rendered only when connected: with no wallet there is no balance to
          take a percentage of, and four dead buttons on the first screen a
          new user sees is worse than none.
        */}
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

        <div className="row" style={{ gap: 8 }}>
          <button className="tag" style={{ padding: '10px 12px' }} onClick={() => setPicker('from')}>
            {fromToken.symbol} ▾
          </button>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            min="0"
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            style={{ flex: 1, textAlign: 'end' }}
          />
        </div>

        {/* flip */}
        <div style={{ display: 'grid', placeItems: 'center', margin: '10px 0' }}>
          {/* The arrows physically trade places, which is the action. */}
          <motion.button
            className="icon-btn swap-flip"
            whileTap={{ scale: 0.86 }}
            animate={still ? {} : { rotate: flipCount * 180 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            onClick={flip}
            style={{ borderColor: 'var(--rgb-1)', color: 'var(--rgb-1)' }}
            aria-label={t('swap.flip')}
          >
            <AnimatedSwap key={flipCount} active still={still} width={19} height={19} />
          </motion.button>
        </div>

        {/* TO */}
        <div className="row-between" style={{ marginBottom: 6 }}>
          <span className="field-label" style={{ margin: 0 }}>{t('swap.to')}</span>
          <span className="faint mono">
            {t('swap.balance')}: {fmtQty(balances[tokenKey(toToken)]?.formatted ?? 0)}
          </span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="tag" style={{ padding: '10px 12px' }} onClick={() => setPicker('to')}>
            {toToken.symbol} ▾
          </button>
          <div
            style={{
              flex: 1,
              textAlign: 'end',
              padding: 12,
              borderRadius: 12,
              background: 'var(--bg-raised)',
              border: '1px solid var(--line)',
              fontFamily: 'var(--font-mono)',
              fontSize: 15,
              color: quote?.amountOut ? 'var(--text-1)' : 'var(--text-3)'
            }}
          >
            {quoting ? (
              <span className="skel" style={{ display: 'inline-block', width: 70, height: 16 }} />
            ) : quote?.amountOut ? (
              <AnimatedNumber value={quote.amountOut} format={(v) => fmtQty(v)} />
            ) : (
              '0.0'
            )}
          </div>
        </div>

        {/* quote details */}
        <AnimatePresence>
          {quote && !quote.error && (
            <motion.div
              className="stack"
              style={{ gap: 6, marginTop: 14 }}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="row-between">
                <span className="faint">{t('swap.rate')}</span>
                <span className="mono" style={{ fontSize: 11.5 }}>
                  1 {fromToken.symbol} ≈ {fmtQty(quote.rate)} {toToken.symbol}
                </span>
              </div>
              <div className="row-between">
                <span className="faint">{t('swap.minReceived')}</span>
                <span className="mono" style={{ fontSize: 11.5 }}>{fmtQty(quote.minOut)} {toToken.symbol}</span>
              </div>
              {quote.feeBps > 0 && (
                <div className="row-between">
                  <span className="faint">{t('swap.platformFee', { pct: quote.feeBps / 100 })}</span>
                  <span className="mono" style={{ fontSize: 11.5 }}>
                    {fmtQty(quote.platformFee)} {fromToken.symbol}
                  </span>
                </div>
              )}
              {impact != null && (
                <div className="row-between">
                  <span className="faint">{t('swap.priceImpact')}</span>
                  <span className={`mono ${highImpact ? 'down' : ''}`} style={{ fontSize: 11.5 }}>
                    {impact.toFixed(2)}%
                  </span>
                </div>
              )}
              {gasCost != null && (
                <div className="row-between">
                  <span className="faint">{t('swap.networkFee')}</span>
                  <span className="mono" style={{ fontSize: 11.5 }}>≈{fmtQty(gasCost)} {cfg.native.symbol}</span>
                </div>
              )}
              <div className="row-between">
                <span className="faint">{t('swap.route')}</span>
                <span className="mono faint" style={{ fontSize: 10.5 }}>
                  {quote.source === 'aggregator'
                    ? t('swap.bestOf', { n: quote.hops })
                    : `${quote.hops} ${t('swap.hops')}`}
                </span>
              </div>

              {/*
                ─── "COMPARED N SOURCES", WHICH WAS COMPUTED AND NEVER SHOWN ───
                `getQuote` has been returning `routesChecked` and `beatenBy`,
                with a comment in lib/swap.js saying routesChecked "drives the
                'compared N routes' line in the UI". No such line existed —
                nothing in the app read either field. The work of quoting three
                aggregators was being done on every keystroke and thrown away.

                It is worth showing for a reason beyond decoration: the single
                most common objection to a wallet swap is "you are hiding a
                worse price behind convenience". Naming the number of venues
                checked answers that, and it is a claim we can actually back.
              */}
              {quote.routesChecked > 1 && (
                <div className="row-between">
                  <span className="faint">{t('swap.compared')}</span>
                  <span className="mono faint" style={{ fontSize: 10.5 }}>
                    {t('swap.comparedN', { n: quote.routesChecked })}
                  </span>
                </div>
              )}

              {/*
                And when a source we CANNOT execute quoted better, say so.

                Hiding it would be the easy choice. But `beatenBy` exists
                precisely because bestQuote.js refuses to sign a quote-only
                route, and a user who later checks that venue and finds a
                better number should have heard it from us first. Only shown
                above 0.1% — below that it is noise, not a shortfall.
              */}
              {quote.beatenBy > 10 && (
                <div className="row-between">
                  <span className="faint">{t('swap.beatenBy')}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
                    {(quote.beatenBy / 100).toFixed(2)}%
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {quote?.error && (
          <p className="notice notice-danger" style={{ marginTop: 12 }}>{t(`swap.err.${quote.error}`)}</p>
        )}
        {highImpact && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('swap.highImpact')}</p>}
        {insufficient && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('swap.insufficient')}</p>}

        {/* Gas is paid in the chain's own coin, from the same wallet, and it
            is NOT covered by the platform fee. Saying which coin, per chain,
            removes the single most common support question. */}
        {lowGas && !useGasless && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {t('swap.needGas', { coin: cfg.native.symbol, chain: cfg.name })}
          </p>
        )}

        {/*
          ─── THE GASLESS OPTION ────────────────────────────────────────────
          Placed directly under the gas warning, because that warning is the
          moment the user learns they are stuck. Answering the objection where
          it appears is the difference between a feature and a setting nobody
          finds — and this one was previously reachable from nowhere at all.

          It is an OPTION, never the default. 0x take a cut on top of ours and
          the gas is priced into the token, so it costs more than a normal
          swap. Defaulting to it would quietly overcharge every user who does
          have gas.
        */}
        {gaslessOk && (
          <div className="card card-tight" style={{ marginTop: 10 }}>
            <div className="set-row" style={{ padding: 0 }}>
              <span className="set-row-label">
                <div>{t('swap.gaslessTitle')}</div>
                <div className="set-row-sub">
                  {cannotPayGas ? t('swap.gaslessNeeded', { coin: cfg.native.symbol }) : t('swap.gaslessSub')}
                </div>
              </span>
              <Switch
                on={useGasless}
                label={t('swap.gaslessTitle')}
                onChange={async () => {
                  haptic?.('select');
                  const next = !useGasless;
                  setUseGasless(next);
                  if (!next || !quote?.amountInWei) return;
                  /*
                   * Price it only when switched ON. A firm quote costs more
                   * upstream and expires, so it is requested at signing time;
                   * this is the cheap indicative one, used to show the real
                   * cost BEFORE the user commits to the route.
                   */
                  setGaslessBusy(true);
                  try {
                    setGaslessQuote(await getGaslessPrice({
                      chainId,
                      sellToken: fromToken.address,
                      buyToken: toToken.address,
                      sellAmount: quote.amountInWei.toString(),
                      taker: wallet.address,
                      slippageBps: String(Math.round(effectiveSlippage * 100))
                    }));
                  } catch {
                    /* Swallowed: the toggle still works and the firm quote at
                       signing time is the one that matters. A failed preview
                       must not block the route. */
                    setGaslessQuote(null);
                  } finally {
                    setGaslessBusy(false);
                  }
                }}
              />
            </div>

            {gaslessBusy && <p className="faint" style={{ marginTop: 8, fontSize: 12 }}>{t('swap.quoting')}</p>}

            {/*
              Every deduction, named. Three come out of the sell token: ours,
              0x's, and the gas 0x is fronting. The gas line especially has to
              be visible — "no ETH needed" means "paid in the token instead",
              and hiding that would make an honest feature look dishonest the
              first time somebody did the arithmetic.
            */}
            {useGasless && gaslessSummary && !gaslessBusy && (
              <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                <div className="row-between">
                  <span className="faint">{t('swap.gaslessGasFee')}</span>
                  <span className="mono" style={{ fontSize: 11.5 }}>
                    {fmtQty(gaslessSummary.gasFee)} {fromToken.symbol}
                  </span>
                </div>
                {gaslessSummary.zeroExFee > 0 && (
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
              </div>
            )}

            <InfoBox title={t('swap.gaslessWhat')} tone="info" id="swap-gasless-help">
              <p>{t('swap.gaslessHelp')}</p>
            </InfoBox>
          </div>
        )}

        {/* Being in a public token list is not an endorsement. */}
        {unverifiedTarget && (
          <p className="notice" style={{ marginTop: 10 }}>
            {t('swap.unverifiedWarning', { symbol: unverifiedTarget.symbol })}
          </p>
        )}

        <button
          className="btn btn-primary"
          style={{ marginTop: 14 }}
          disabled={!canSwap}
          onClick={() => {
            if (!wallet.isConnected) return setConnectOpen(true);
            /*
             * Expert mode skips the review sheet.
             *
             * REAL BUG: the toggle promised "Skip confirmation screens and
             * allow high slippage" and `expertMode` was read by nothing — the
             * review sheet always appeared. A user who turned it on got the
             * same flow and reasonably concluded the setting was decoration.
             *
             * The sheet still OPENS in expert mode; it just goes straight into
             * the transaction instead of waiting for a second tap. The wallet's
             * own signature prompt is still there and is not ours to skip —
             * that is the confirmation that actually protects the funds.
             */
            setReviewing(true);
            if (useSettingsStore.getState().expertMode) {
              runSwap();
              return;
            }
          }}
        >
          {!wallet.isConnected ? t('wallet.connect') : quoting ? t('swap.quoting') : t('swap.review')}
        </button>
      </motion.section>

      {/* ------------------------- gas / networks card ----------------------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
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
      </motion.section>

      <AdBanner slot="p2p" />

      {/* ---------------------------- token picker --------------------------- */}
      <Sheet
        open={Boolean(picker)}
        onClose={() => {
          setPicker(null);
          setPickerQuery('');
          setImportError(null);
        }}
        title={t('swap.selectToken')}
      >
        {/* Search over the whole list: ticker, name, or a pasted contract. */}
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <span className="icon-btn" style={{ pointerEvents: 'none' }}>
            <AnimatedSearch active={Boolean(pickerQuery)} still={still} width={16} height={16} />
          </span>
          {/*
            NO autoFocus HERE — it was the second half of the "token picker
            flashes twice" bug.

            Focusing an input the instant the dialog mounts makes Android raise
            the soft keyboard immediately. The activity is adjustResize (the
            platform default, and what Capacitor relies on), so the WebView
            viewport shrinks by roughly 40% WHILE the dialog's open spring is
            still running. The sheet lays out at full height, then re-lays out
            at keyboard height mid-animation: two distinct paints, which is
            exactly the "flashes like a fluorescent tube starting up" the user
            described.

            The list is immediately usable without focus, and the six curated
            pairs at the top are one tap away — which is what most people
            actually use. Anyone who wants to search taps the field, and then
            the keyboard appears against a dialog that has already settled.
          */}
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

        {/*
          Common pairs, so the frequent case stays one tap.
          
          Now with icons: a row of six bare tickers is read letter by letter,
          while a logo is recognised at a glance. This is the control most
          users hit, so it is the one worth making instant.
        */}
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

        {/* Virtualisation would be overkill: the result set is capped at 150,
            which scrolls smoothly even on a slow device. */}
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
                {/*
                  TokenIcon walks logoURI -> TrustWallet (by contract address)
                  -> CoinGecko -> a coloured monogram. The old code hid the
                  <img> on error, which left an empty circle - and no built-in
                  token had a logoURI at all, so that was every stock token.
                */}
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
                    {/* Show the contract for anything we did not hand-verify —
                        a familiar ticker is exactly how clones get bought. */}
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

        {/* Import by contract address — the escape hatch for tokens that
            launched an hour ago and are in no public list yet. */}
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

      {/* ------------------------------ settings ----------------------------- */}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title={t('swap.settings')}>
        {/*
          ─── THE SOLANA TAB GETS ITS OWN SHEET ────────────────────────────────
          Reported that swap settings did not work on the Solana tab. They did
          not, and the gear being in the SHARED header is exactly why: it looked
          like it governed whichever tab you were on, while every control inside
          wrote to EVM-only state.

          Auto-slippage, the deadline and expert mode are all genuinely
          EVM-specific — auto-slippage derives from an EVM price impact, the
          deadline is a router argument, and expert mode skips the EVM review
          sheet. Showing them on the Solana tab would repeat the original
          mistake in a new place.

          So the sheet now shows what actually applies. The one setting both
          paths share is the stored default slippage, and SolanaSwap now reads
          it from the same store and sends it as `slippageBps` on both the
          quote and the swap.
        */}
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

            {/*
              Named honestly rather than hidden. Someone who opened this sheet
              looking for the deadline should be told it does not exist here,
              not left hunting for a control that was silently removed.
            */}
            <InfoBox title={t('swap.solanaOnlyTitle')} tone="info" id="sol-only">
              <p>{t('swap.solanaOnlyBody')}</p>
            </InfoBox>
          </>
        ) : (
        <>
        <label className="field-label">{t('swap.slippage')}</label>

        {/*
          ─── AUTO IS THE DEFAULT, AND IT IS NOT COSMETIC ──────────────────────
          A fixed slippage is wrong in both directions: 0.5% fails constantly on
          a thin token, and the 3% someone sets to escape that stays set on the
          next USDT swap, where it is an invitation to be sandwiched.

          `autoSlippage` derives it from the pair being quoted — see
          `suggestSlippage` in lib/swap.js. The user can still pin a number, and
          pinning is remembered for the session, because an override that keeps
          silently reverting is worse than no override at all.
        */}
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
            type="number"
            step="0.1"
            min="0.05"
            max="50"
            value={slippage}
            onChange={(e) => setSlippage(Math.min(50, Math.max(0.05, Number(e.target.value) || 0.5)))}
            style={{ marginTop: 10 }}
          />
        )}

        <InfoBox title={t('swap.slippageWhat')} tone="info" id="swap-slippage-help">
          <p>{t('swap.slippageHelp')}</p>
        </InfoBox>

        {/*
          Stays a plain inline notice, never folded away: this one describes
          what the NEXT tap will do with the user's money. InfoBox is for
          explaining how a market works, not for hiding live risk.
        */}
        {effectiveSlippage > 3 && (
          <p className="notice notice-danger" style={{ marginTop: 8 }}>{t('swap.slippageHigh')}</p>
        )}

        {/*
          ─── TRANSACTION DEADLINE ─────────────────────────────────────────────
          `deadlineMinutes` has been a parameter of `executeSwap` and
          `executeAggregatorSwap` since they were written, defaulting to 20, and
          NOTHING has ever passed it — so the value was unreachable and every
          swap silently used 20 minutes.

          It matters on a congested chain: a transaction that sits pending for
          twenty minutes and then executes does so at a price from twenty
          minutes ago. A short deadline makes it revert instead, which costs gas
          but not the difference.
        */}
        <label className="field-label" style={{ marginTop: 16 }}>{t('swap.deadline')}</label>
        <div className="row" style={{ gap: 6 }}>
          {[5, 20, 60].map((m) => (
            <button
              key={m}
              className={`tag ${deadlineMin === m ? 'active' : ''}`}
              style={{ flex: 1, textAlign: 'center' }}
              onClick={() => { haptic?.('select'); setDeadlineMin(m); }}
            >
              {t('swap.minutes', { n: m })}
            </button>
          ))}
        </div>
        <InfoBox title={t('swap.deadlineWhat')} tone="info" id="swap-deadline-help">
          <p>{t('swap.deadlineHelp')}</p>
        </InfoBox>

        {/*
          ─── EXPERT MODE, SHOWN WHERE IT APPLIES ──────────────────────────────
          It already exists in Settings and is read by this screen to decide
          whether the review sheet can be skipped. Mirroring it here is not a
          duplicate control — it is the same store value — but it is the only
          place the user is actually about to feel its effect.
        */}
        <div className="set-row" style={{ marginTop: 16 }}>
          <span className="set-row-label">
            <div>{t('swap.expert')}</div>
            <div className="set-row-sub">{t('swap.expertSub')}</div>
          </span>
          {/*
            The real Switch component, not `<input type="checkbox">`.
            `.switch` in index.css styles a BUTTON with `data-on` and an
            animated `.switch-knob` child — a checkbox with that class matches
            the selector, inherits the track, and then draws the browser's
            native tick inside it with no knob. It would look broken rather
            than fail loudly, which is the same shape as the invented
            `className="seg"` that shipped here once before.
          */}
          <Switch
            on={expertMode}
            label={t('swap.expert')}
            onChange={() => { haptic?.('select'); useSettingsStore.getState().toggle('expertMode'); }}
          />
        </div>
        {expertMode && (
          <p className="notice notice-danger" style={{ marginTop: 8 }}>{t('swap.expertWarn')}</p>
        )}

        {/*
          Persisting the per-swap choice as the new default. Without this the
          user re-sets the same number on every visit, because the screen seeds
          from `defaultSlippage` on mount.
        */}
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

      {/* ------------------------------- review ------------------------------ */}
      <Sheet
        open={reviewing}
        onClose={() => {
          if (txState?.stage && !['success', 'error', 'failed'].includes(txState.stage)) return; // don't close mid-flight
          setReviewing(false);
          setTxState(null);
        }}
      >
        <h2 className="h2" style={{ marginBottom: 12 }}>{t('swap.confirmTitle')}</h2>

        {!txState && quote && (
          <>
            <div className="card card-tight stack" style={{ gap: 9 }}>
              <div className="row-between">
                <span className="faint">{t('swap.youPay')}</span>
                <span className="mono" style={{ fontWeight: 700 }}>{amount} {fromToken.symbol}</span>
              </div>
              <div className="row-between">
                <span className="faint">{t('swap.youReceive')}</span>
                <span className="mono up" style={{ fontWeight: 700 }}>≈{fmtQty(quote.amountOut)} {toToken.symbol}</span>
              </div>
              <div className="row-between">
                <span className="faint">{t('swap.minReceived')}</span>
                <span className="mono">{fmtQty(quote.minOut)} {toToken.symbol}</span>
              </div>
              {quote.feeBps > 0 && (
                <div className="row-between">
                  <span className="faint">{t('swap.platformFee', { pct: quote.feeBps / 100 })}</span>
                  <span className="mono">{fmtQty(quote.platformFee)} {fromToken.symbol}</span>
                </div>
              )}
              <div className="row-between">
                <span className="faint">{t('swap.slippage')}</span>
                <span className="mono">{effectiveSlippage}%</span>
              </div>
              <div className="row-between">
                <span className="faint">{t('swap.recipient')}</span>
                <span className="mono" style={{ fontSize: 11 }}>{shortAddress(wallet.address)}</span>
              </div>
            </div>

            <p className="notice" style={{ marginTop: 12 }}>{t('swap.reviewNotice')}</p>

            <div className="row" style={{ gap: 10, marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => setReviewing(false)}>{t('common.cancel')}</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  // Browsers only unlock audio inside a user gesture; do it
                  // here so the chime can actually play a minute later when
                  // the transaction settles.
                  primeAudio();
                  runSwap();
                }}
              >
                {t('swap.confirmSwap')}
              </button>
            </div>
          </>
        )}

        {txState && (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            {['preparing', 'approving', 'quoting', 'signing', 'pending'].includes(txState.stage) && (
              <>
                <div className="spinner" style={{ margin: '0 auto 14px', width: 30, height: 30 }} />
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{t(`swap.stage.${txState.stage}`)}</div>
                <p className="faint">{t('swap.dontClose')}</p>
              </>
            )}

            {/*
              A RECEIPT, NOT A TICK.

              This was a green checkmark and the word "success". After waiting
              a minute for a confirmation, that answers none of the questions
              the user has: what left my wallet, what arrived, on which chain.
              Some people re-opened their wallet to check; a couple resubmitted
              because they could not tell it had worked.

              The phone also chimes at this moment (notifyTrade below), so this
              is what someone sees when they pick it back up. It has to be
              self-explanatory on its own.
            */}
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
                      <span className="faint">{t('swap.youReceive')}</span>
                      <span className="mono up" style={{ fontSize: 13, fontWeight: 700 }}>
                        {fmtQty(Number(txState.got))} {txState.gotSymbol}
                      </span>
                    </div>
                    {txState.chainName && (
                      <div className="row-between">
                        <span className="faint">{t('swap.network')}</span>
                        <span style={{ fontSize: 12.5 }}>{txState.chainName}</span>
                      </div>
                    )}
                  </div>
                )}

                {/*
                  The balance takes a moment to re-read from the chain, so say
                  where the coins went rather than leaving the user to guess
                  why the wallet has not updated yet.
                */}
                <p className="faint" style={{ fontSize: 11.5, marginTop: 10, lineHeight: 1.7 }}>
                  {txState.gasless ? t('swap.gaslessSubmitted') : t('swap.successWhere')}
                </p>

                {/*
                  ─── A tradeHash IS NOT A TRANSACTION HASH ──────────────────
                  0x return a trade identifier and submit the transaction
                  themselves a moment later. Rendering it as a tx hash would
                  link to an explorer page that does not exist yet — which
                  reads as "my money has vanished" at the most anxious point
                  in the whole flow. Shown as a reference, deliberately not as
                  a link.
                */}
                {txState.gaslessHash && (
                  <p className="mono faint" style={{ fontSize: 10, marginTop: 8, wordBreak: 'break-all' }}>
                    {txState.gaslessHash}
                  </p>
                )}
              </motion.div>
            )}

            {/*
              FAILURE MUST ANSWER "DID IT TAKE MY MONEY?"

              That is the only question anyone has here, and the screen did not
              answer it. The two failure modes are genuinely different and the
              distinction matters:

                'error'  — the transaction never reached the chain (rejected in
                           the wallet, quote expired, not enough gas to send).
                           Nothing moved. No gas was spent.
                'failed' — it WAS mined and reverted on-chain. The tokens are
                           still yours, but the gas is gone. Saying "nothing
                           happened" here would be a lie.
            */}
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
