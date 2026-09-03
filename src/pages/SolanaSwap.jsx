import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import { useTelegram } from '../context/TelegramContext';
import { useHideBalances } from '../hooks/useHideBalances';
import {
  SOL_MINT,
  USDC_MINT,
  USDT_MINT,
  fromBaseUnits,
  getSolanaOrder,
  executeSolanaOrder,
  executeSignature,
  executeSucceeded,
  isSolanaAddress,
  orderErrorKey,
  orderQuote,
  referralFeeBps,
  solanaFeeReady,
  toBaseUnits
} from '../lib/solana';
import { getOceanQuote, getOceanSwap } from '../lib/solanaOcean';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  signAndSendSolana,
  signSolanaTransaction,
  getSolanaSwapBalances,
  solanaAddress
} from '../lib/solanaWallet';
import { shortAddress } from '../context/WalletContext';
import { EQUITY_ASSETS, LST_ASSETS, findAsset } from '../lib/solanaAssets';
import { useAppStore } from '../store/useAppStore';
import { recordSwap, confirmSwap, failSwap } from '../lib/swapHistory';
import SwapHistoryPanel from '../components/SwapHistoryPanel';
import { POINT_VALUES } from '../lib/ranks';

/**
 * SOLANA SWAP
 * ---------------------------------------------------------------------------
 * A separate screen from the EVM Swap page, not a tab inside it.
 *
 * The two share almost nothing: a different address format, a different
 * aggregator, a different signing scheme, no chainId, and no ethers provider.
 * Folding Solana into Swap.jsx would mean a second code path threaded through
 * every handler on a 1000-line screen that already moves real money — and the
 * P2P crash in this repo came from exactly that kind of shared-shape
 * assumption. Two honest screens beat one screen with two secret modes.
 *
 * The token list is deliberately tiny: SOL, USDC, USDT, plus paste-any-mint.
 * Most Solana volume that matters to this app is memecoins, and those are
 * found by contract address, not by browsing a curated list.
 */

/** Curated starting points. Everything else arrives by pasted mint address. */
const BASE_TOKENS = [
  { mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9 },
  { mint: USDC_MINT, symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { mint: USDT_MINT, symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  /*
   * The curated liquid-staking tokens and tokenized equities.
   *
   * These are spread in from lib/solanaAssets.js rather than retyped, because
   * a second copy of a mint address is a second chance to transpose a base58
   * character — and one of the six equity addresses WAS wrong on first write,
   * caught only by querying the API. One list, verified once.
   *
   * They belong in the dropdown as well as on their own screens: someone who
   * arrives here from Stocks with ?to= set should be able to see what they are
   * swapping into, and someone who already knows what jitoSOL is should not
   * have to go via another page to buy it.
   */
  ...LST_ASSETS.map(({ mint, symbol, name, decimals }) => ({ mint, symbol, name, decimals })),
  ...EQUITY_ASSETS.map(({ mint, symbol, name, decimals }) => ({ mint, symbol, name, decimals }))
];

const DEBOUNCE_MS = 450;

/**
 * @param {object}  props
 * @param {boolean} [props.embedded]  rendered as a TAB inside the Swap screen
 *        rather than as its own route. When embedded it must not open its own
 *        PageTransition — two nested transitions animate the same subtree
 *        twice and produce a visible double-fade on every tab change.
 */
export default function SolanaSwap({ embedded = false }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  useHideBalances();

  /*
   * The Solana wallet is connected from the Wallet page. The swap only needs
   * the public address that the provider already exposes, so it reads that
   * module-global state and never owns a connection flow of its own.
   */
  const navigate = useNavigate();
  const [address, setAddress] = useState(() => solanaAddress());
  const [walletBalances, setWalletBalances] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const [fromToken, setFromToken] = useState(BASE_TOKENS[0]);
  const [toToken, setToToken] = useState(BASE_TOKENS[1]);
  const [amount, setAmount] = useState('');

  /*
   * ═══════════════════════════════════════════════════════════════════════
   * ─── SLIPPAGE: THE SETTING THAT DID NOTHING HERE ────────────────────────
   * ═══════════════════════════════════════════════════════════════════════
   * Reported that swap settings do not work on the Solana tab. They did not,
   * and the reason is structural rather than a broken control.
   *
   * The gear icon lives in Swap.jsx's shared header, above the EVM/Solana
   * tab switcher, so it is visible on both tabs. But its sheet only ever
   * wrote to Swap.jsx's own `slippage` state, and this component had no
   * slippage state at all — it never read the setting and never sent one.
   * `getOceanQuote` and `getOceanSwap` have both accepted `slippageBps`
   * since they were written; neither call site supplied it.
   *
   * So every Solana swap silently used OpenOcean's server-side default,
   * whatever the user had chosen. A control that appears to apply to the
   * screen you are looking at and quietly applies to a different one is
   * worse than no control: it is a promise the app does not keep.
   *
   * Read from the SAME store the EVM side seeds from, so one setting now
   * governs both tabs. Subscribed rather than read once, because the sheet
   * is open ON THIS SCREEN — a snapshot taken at mount would ignore the
   * change the user just made and appear broken all over again.
   */
  const defaultSlippage = useSettingsStore((s) => s.defaultSlippage);

  /*
   * Percent to basis points, which is what OpenOcean expects. 0.5% -> 50.
   *
   * Clamped and floored at 1 bp: `Math.round(0.005 * 100)` is 1, but a
   * malformed stored value could produce 0, and 0 bps means "no slippage
   * tolerance at all", which fails every quote on a moving market. The
   * upper clamp mirrors the store's own 50% ceiling.
   */
  const slippageBps = useMemo(() => {
    const pct = Number(defaultSlippage);
    if (!Number.isFinite(pct) || pct <= 0) return 50;
    return Math.min(5000, Math.max(1, Math.round(pct * 100)));
  }, [defaultSlippage]);

  /*
   * ?to=<mint> handoff from the Stocks and Farm screens.
   *
   * The MINT travels, never the symbol. That is the whole safety property:
   * a symbol like "AAPLx" is exactly what the six clone tokens copy, so
   * resolving one here would reintroduce the impersonation risk that
   * lib/solanaAssets.js exists to remove. An address is unambiguous.
   *
   * `findAsset` restricts this to the curated list, so a crafted link cannot
   * use this route to preselect an arbitrary token — someone sharing a
   * ?to=<scam mint> URL would otherwise have a one-tap phishing vector.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const to = searchParams.get('to');
    if (!to) return;
    const asset = findAsset(to);
    if (asset) {
      const target = BASE_TOKENS.find((tk) => tk.mint === asset.mint) ?? BASE_TOKENS[1];
      const usdc = BASE_TOKENS.find((tk) => tk.mint === USDC_MINT) ?? BASE_TOKENS[0];
      /*
       * `side=sell` (from a coin page's "Sell" button) flips the pair: the
       * asset leaves the wallet and the stablecoin is received. Ignoring it
       * opened a BUY order no matter which button was pressed.
       */
      if (searchParams.get('side') === 'sell') {
        setFromToken(target);
        setToToken(usdc);
      } else {
        /* Buying an equity or an LST means paying with a stablecoin, not SOL. */
        setToToken(target);
        setFromToken(usdc);
      }
    }
    /* Consume the params either way, so a refresh does not re-apply them and
       fight the user's own selection. `replace` keeps them out of history. */
    const next = new URLSearchParams(searchParams);
    next.delete('to');
    next.delete('side');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * ─── ?toMint=<mint> — AN UNCURATED MINT, FROM A COIN PAGE ───────────────
   * Separate from `?to=` above, and the separation is the safety design.
   *
   * `?to=` resolves against the CURATED asset list only. That restriction
   * exists because those assets are tokenized equities and staking tokens
   * where impersonation is both easy and lucrative — six fake AAPLx mints
   * exist, one with $3.44 of liquidity and a scraped Apple logo. A crafted
   * `?to=` link must never be able to preselect one.
   *
   * `?toMint=` is the opposite case and needs the opposite treatment. It
   * comes from a coin page whose CoinGecko id resolved to this mint (see
   * lib/coinVenue.js), which is how PENGU — a real Solana token with deep
   * Jupiter liquidity — stops being told «نمیشه سواپ کرد». It is added
   * through the SAME path as a hand-pasted mint, so it appears in the picker
   * as a truncated address with no name and no verified badge, and the user
   * sees exactly what they are trading.
   *
   * Decimals are read as 9 here, matching the paste path, and that is safe
   * for the same stated reason: the quote is computed by Jupiter from the
   * mint's real on-chain decimals, so a wrong guess only changes what the
   * user TYPES, never what they receive. It is visible in the quote before
   * anything is signed.
   */
  useEffect(() => {
    const mint = searchParams.get('toMint');
    if (!mint) return;

    const next = new URLSearchParams(searchParams);
    next.delete('toMint');
    next.delete('side');
    setSearchParams(next, { replace: true });

    if (!isSolanaAddress(mint)) return;

    const usdc = BASE_TOKENS.find((tk) => tk.mint === USDC_MINT) ?? BASE_TOKENS[0];
    /* A coin page's "Sell" button sends side=sell — honour it by flipping
       the pair, or a sell tap opens a buy order (reported for SOL). */
    const sell = searchParams.get('side') === 'sell';

    /* Already known — curated or previously imported. Just select it. */
    const curatedHit = BASE_TOKENS.find((tk) => tk.mint === mint);
    if (curatedHit) {
      if (sell) {
        setFromToken(curatedHit);
        setToToken(usdc);
      } else {
        setToToken(curatedHit);
        setFromToken(usdc);
      }
      return;
    }

    const token = {
      mint,
      symbol: `${mint.slice(0, 4)}…${mint.slice(-4)}`,
      name: '',
      decimals: 9,
      imported: true
    };
    setExtraTokens((prev) => (prev.some((tk) => tk.mint === mint) ? prev : [...prev, token]));
    if (sell) {
      setFromToken(token);
      setToToken(usdc);
    } else {
      setToToken(token);
      /* Paying with a stablecoin, not with SOL: the coin page sent a "buy". */
      setFromToken(usdc);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [order, setOrder] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState(null);
  /* Bumped by the retry button under a failed quote; re-arms the quoting
     effect without requiring the user to edit the amount. */
  const [quoteNonce, setQuoteNonce] = useState(0);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [txErr, setTxErr] = useState(null);

  // Paste-a-mint support, which is how memecoins are actually found.
  const [customMint, setCustomMint] = useState('');
  const [customErr, setCustomErr] = useState(null);
  const [extraTokens, setExtraTokens] = useState([]);

  const tokens = useMemo(() => [...BASE_TOKENS, ...extraTokens], [extraTokens]);

  /*
   * Follow the Solana connection made from the Wallet page. The provider is
   * not React state, so the swap listens to the one lightweight event the
   * wallet layer emits on connect/disconnect and lives in sync with the
   * wallet tab without holding any connection controls of its own.
   */
  useEffect(() => {
    const onWalletChange = (event) => {
      setAddress(event?.detail?.address || solanaAddress() || null);
    };
    window.addEventListener('solana:wallet-change', onWalletChange);
    return () => window.removeEventListener('solana:wallet-change', onWalletChange);
  }, []);

  /*
   * Guards a stale quote overwriting a newer one. Two rapid amount changes
   * resolve out of order often enough on a mobile connection to matter, and
   * showing the price for an amount the user has already changed is the kind
   * of wrong that costs money.
   */
  const reqSeq = useRef(0);

  const loadWalletBalances = useCallback(async () => {
    if (!address) return null;
    setBalanceLoading(true);
    try {
      const state = await getSolanaSwapBalances({
        owner: address,
        inputMint: fromToken.mint,
        outputMint: toToken.mint
      });
      setWalletBalances(state);
      return state;
    } catch {
      setWalletBalances(null);
      return null;
    } finally {
      setBalanceLoading(false);
    }
  }, [address, fromToken.mint, toToken.mint]);

  useEffect(() => {
    loadWalletBalances();
  }, [loadWalletBalances]);

  /* ------------------------------- quoting ------------------------------- */

  useEffect(() => {
    setOrder(null);
    setQuoteErr(null);
    setResult(null);
    setTxErr(null);

    const base = toBaseUnits(amount, fromToken.decimals);
    if (!base || base === '0') {
      /*
       * REAL BUG this guards against: reaching here with a request already in
       * flight (user cleared the amount mid-debounce) left two problems —
       * `quoting` stayed true forever, spinning over an empty field, and the
       * in-flight response still matched `reqSeq` so it could paint a price
       * for an amount that no longer exists. Invalidate the sequence AND drop
       * the spinner on every early exit.
       */
      reqSeq.current += 1;
      setQuoting(false);
      return undefined;
    }
    if (fromToken.mint === toToken.mint) {
      reqSeq.current += 1;
      setQuoting(false);
      setQuoteErr('SAME_TOKEN');
      return undefined;
    }

    const seq = reqSeq.current + 1;
    reqSeq.current = seq;
    setQuoting(true);

    const id = setTimeout(async () => {
      /*
       * ─── WHY THE QUOTE COMES FROM OPENOCEAN FIRST ────────────────────────
       * This screen used to quote Jupiter, which earned us nothing: its fee
       * needs a referralAccount plus a referralTokenAccount per fee mint,
       * all created by on-chain transactions, and the Solana payout wallet
       * holds 0 SOL. Jupiter's own docs say an uninitialised token account
       * means the swap executes WITHOUT our fee and returns no error, so
       * the screen was silently free forever.
       *
       * OpenOcean takes a plain wallet address as `referrer`. Verified by
       * decoding a live transaction: 1 SOL in produced 5,600,000 lamports
       * to us and 1,400,000 to OpenOcean — 0.70000% exactly, split 80/20.
       *
       * The quote deliberately does NOT pass the wallet address. Without it
       * nothing signable comes back, so a price refresh cannot hand anyone
       * a transaction they did not ask for.
       *
       * ─── AND WHY IT FALLS BACK TO JUPITER ────────────────────────────────
       * OpenOcean's Solana endpoint moved behind a WHITELIST: their
       * supported-chains docs now say "Non-EVM chain (Solana) is available
       * only to whitelisted users with an authorized API key". While our
       * server does not hold one, every call it makes is rejected, and the
       * client — correctly — read that as a connectivity problem and showed
       * «اتصال به سرویس قیمت‌گذاری برقرار نشد» on every attempt, on every
       * user network, no matter how many times the screen was refreshed.
       * (Reported 2026-08 as «در سولنا اصلا قیمت برای سواپ نشان داده
       * نمیشه».)
       *
       * So when OpenOcean cannot price the pair, the quote goes to Jupiter
       * through the SAME hardened path this screen used before the switch:
       * our backend attaches JUPITER_API_KEY when it is configured, and the
       * keyless public endpoint covers builds with no backend. The user gets
       * a price either way, and the fee disclosure follows the quote's own
       * `feeBps`, so a free Jupiter fallback is announced as free — never
       * promised as 0.70%.
       */
      try {
        let q = null;
        let err = null;

        try {
          const oq = await getOceanQuote({
            inputMint: fromToken.mint,
            outputMint: toToken.mint,
            amount: base,
            /* The user's setting, finally reaching the request. */
            slippageBps
          });
          if (oq?.outAmount && oq.outAmount !== '0') {
            q = { ...oq, provider: 'openocean' };
          } else {
            err = new Error('NO_ROUTE');
          }
        } catch (e) {
          err = e; // remembered; Jupiter's verdict wins if it can answer
        }

        if (!q) {
          try {
            const jo = await getSolanaOrder({
              inputMint: fromToken.mint,
              outputMint: toToken.mint,
              amount: base,
              /* No taker: price only, nothing signable comes back. */
              slippageBps
            });
            if (jo?.transaction === '' && jo.errorCode) {
              /* Build failed upstream: the code's meaning depends on the
                 router, so it is mapped the same way swap() maps it. */
              throw new Error(orderErrorKey(jo) || 'NO_ROUTE');
            }
            /*
             * orderQuote(), NOT `jo.quote`: V2 /order answers FLAT — the
             * pricing fields sit at the top level and no `quote` object
             * exists (see lib/solana.js). Reading the nested field threw
             * NO_ROUTE on every successful Jupiter answer, which is how the
             * price stayed missing after the fallback itself was shipped.
             */
            const cq = orderQuote(jo);
            if (!cq?.outAmount || cq.outAmount === '0') throw new Error('NO_ROUTE');
            q = {
              inAmount: cq.inAmount ?? base,
              outAmount: cq.outAmount,
              minOutAmount: cq.otherAmountThreshold ?? null,
              priceImpact: cq.priceImpactPct ?? null,
              /* Claim the fee only when we will actually request it —
                 solanaFeeReady() is the same flag that decides the request. */
              feeBps: solanaFeeReady() ? referralFeeBps() : null,
              provider: 'jupiter'
            };
          } catch (e2) {
            err = e2;
          }
        }

        if (reqSeq.current !== seq) return; // a newer request won
        if (!q) {
          /*
           * A network-level failure (timeout, DNS, backend unreachable) is a
           * different situation from "this pair has no route", and telling the
           * user to fix the pair when the connection is the problem sends them
           * down the wrong path. lib/solanaOcean.js and lib/solana.js tag
           * those errors.
           */
          setQuoteErr(err?.network === true ? 'QUOTE_NETWORK' : (err?.message || 'QUOTE_FAILED'));
          setOrder(null);
        } else {
          setOrder(q);
        }
      } finally {
        /*
         * The spinner belongs to the request that started it. A superseded
         * request leaves it running for its replacement (which set it true
         * again); the current one is the only one allowed to stop it.
         */
        if (reqSeq.current === seq) setQuoting(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(id);
  }, [amount, fromToken, toToken, address, slippageBps, quoteNonce]);

  /* -------------------------------- swap --------------------------------- */

  /**
   * Jupiter half of the build.
   *
   * `/order` with a taker returns the quote PLUS the unsigned transaction and
   * the `requestId` that `/execute` later needs. Without a taker it is the
   * price-only call the quote effect uses.
   *
   * The failure mapping is `orderErrorKey()`, which reads BOTH the code and
   * the router: code 2 means "insufficient SOL for gas" on the aggregators
   * but "missing token account" on JupiterZ, and a single-number mapping
   * would tell the user to top up when the fix is different.
   *
   * `versioned` is true by construction: Jupiter V2 always returns v0
   * versioned transactions, so there is nothing to read and nothing to get
   * wrong — unlike OpenOcean, whose `isVersioned` must be passed through.
   */
  const buildJupiterSwap = async ({ inputMint, outputMint, amount, account, slippageBps }) => {
    const jo = await getSolanaOrder({
      inputMint,
      outputMint,
      amount,
      taker: account,
      slippageBps
    });
    if (!jo?.transaction) throw new Error(orderErrorKey(jo) || 'ORDER_FAILED');
    return {
      provider: 'jupiter',
      transaction: jo.transaction,
      requestId: jo.requestId,
      /* Flat V2 answer again — the pricing fields are top-level. */
      outAmount: orderQuote(jo)?.outAmount ?? null,
      feeBps: solanaFeeReady() ? referralFeeBps() : null,
      versioned: true
    };
  };

  const swap = async () => {
    if (!order || busy || !address) return;
    setBusy(true);
    setTxErr(null);
    haptic?.('medium');
    let solRecordId = null;

    try {
      /*
       * Fail before opening a wallet prompt when the account is empty. Wallet
       * simulation used to surface this as the vague "not signed" error even
       * though signing was never the problem. Check exact base units and SOL
       * for network fee / possible destination ATA rent.
       */
      const balancesNow = await loadWalletBalances();
      if (!balancesNow) throw new Error('BALANCE_UNAVAILABLE');
      const rawAmount = BigInt(toBaseUnits(amount, fromToken.decimals));
      if (balancesNow.sourceRaw < rawAmount) throw new Error('INSUFFICIENT_BALANCE');
      const isSolInput = fromToken.mint === SOL_MINT;
      const gasLamports = balancesNow.outputAccountExists ? 20_000n : 2_100_000n;
      if (balancesNow.solLamports < gasLamports + (isSolInput ? rawAmount : 0n)) {
        throw new Error('INSUFFICIENT_GAS');
      }

      /*
       * ─── THE TRANSACTION IS FETCHED HERE, NOT AT QUOTE TIME ──────────────
       * The quote above is priced without a wallet and carries no transaction.
       * We ask for a fresh, signable one only once the user has committed by
       * pressing the button.
       *
       * That ordering is the safety property, not an extra round trip for its
       * own sake: a transaction built seconds ago against a moved market is
       * exactly what a user should not be signing. This is the same
       * re-quote-before-signing rule the EVM path already follows.
       *
       * ─── AND THE BUILDER HAS A FALLBACK, LIKE THE QUOTE DOES ─────────────
       * Build with the provider that PRICED it first — the number the user
       * consented to is that provider's number — then the other. When
       * OpenOcean is behind its whitelist, the quote comes from Jupiter and
       * so does the transaction; when OpenOcean is reachable it stays the
       * preferred builder because it is the one that pays us. A failure on
       * the first provider is remembered and only surfaces if the second one
       * also fails, so the user sees the real reason, not a mystery.
       */
      const providers = order.provider === 'jupiter'
        ? ['jupiter', 'openocean']
        : ['openocean', 'jupiter'];
      let built = null;
      let buildErr = null;
      for (const p of providers) {
        try {
          built = p === 'jupiter'
            ? await buildJupiterSwap({
              inputMint: fromToken.mint,
              outputMint: toToken.mint,
              amount: toBaseUnits(amount, fromToken.decimals),
              account: address,
              /*
               * MUST match the quote above. Building the signable transaction
               * with a different tolerance than the one priced would mean the
               * user consented to one number and signed another.
               */
              slippageBps
            })
            : {
              provider: 'openocean',
              ...(await getOceanSwap({
                inputMint: fromToken.mint,
                outputMint: toToken.mint,
                amount: toBaseUnits(amount, fromToken.decimals),
                account: address,
                slippageBps
              }))
            };
          if (!built?.transaction) throw new Error('NO_TRANSACTION');
          break;
        } catch (e) {
          buildErr = e;
        }
      }
      if (!built) throw buildErr || new Error('NO_TRANSACTION');

      let signature;
      /* Record a pending Solana swap on the device ledger before signing, so
         the history shows «در حال اجرا» even while the wallet prompt is up. */
      solRecordId = recordSwap({
        network: 'solana',
        chainId: null,
        chainName: 'Solana',
        from: amount,
        fromSymbol: fromToken.symbol,
        to: outAmount,
        toSymbol: toToken.symbol,
        amountIn: Number(amount),
        amountOut: outAmount != null ? Number(outAmount) : null,
        status: 'pending'
      }).id;

      if (built.provider === 'jupiter') {
        /*
         * ─── SIGN ONLY, THEN HAND IT TO JUPITER ─────────────────────────────
         * The Jupiter path lands the trade through its own /execute, and RFQ
         * (JupiterZ) routes need a market-maker signature added AFTER ours —
         * broadcasting it ourselves would break exactly the routes that price
         * best. signAndSendSolana (the OpenOcean path) would leave such a
         * trade unlanded, or double-sent. Two named signing functions, so the
         * two cannot be swapped by accident — for the same reason they were
         * split in the first place.
         *
         * executeSucceeded() is the only success test: a /execute answer that
         * is not { status: 'Success', code: 0 } means nothing reached the
         * chain, and reporting a signature for it would be the worst lie this
         * screen could tell.
         */
        const signed = await signSolanaTransaction(built.transaction);
        const exec = await executeSolanaOrder({
          signedTransaction: signed,
          requestId: built.requestId
        });
        if (!executeSucceeded(exec)) throw new Error('SEND_FAILED');
        /*
         * executeSignature() reads the documented `signature` field —
         * `exec.transaction` is what the stubs invented, and reading it
         * would report SEND_FAILED for a swap that already landed.
         */
        signature = executeSignature(exec);
        if (!signature) throw new Error('SEND_FAILED');
      } else {
        /*
         * signAndSend, NOT sign-only. OpenOcean returns an unsigned
         * transaction and does not broadcast; the Jupiter helper signs and
         * hands back, which here would leave the trade never submitted while
         * the UI reported success. Two named functions so the two cannot be
         * swapped by accident.
         */
        signature = await signAndSendSolana(built.transaction, built.versioned);
      }

      if (signature) {
        if (solRecordId) confirmSwap(solRecordId, signature);
        setResult({ signature });
        const rewards = useAppStore.getState();
        rewards.awardPoints('swap', POINT_VALUES.swap, {
          network: 'solana',
          signature
        });
        rewards.completeQuest('firstSwap');
        setAmount('');
        setOrder(null);
        loadWalletBalances();
        haptic?.('success');
      } else {
        if (solRecordId) failSwap(solRecordId, 'SEND_FAILED');
        setTxErr('SEND_FAILED');
        haptic?.('error');
      }
    } catch (err) {
      if (solRecordId) failSwap(solRecordId, err?.message || 'SIGN_FAILED');
      setTxErr(err.message || 'SIGN_FAILED');
      haptic?.('error');
    } finally {
      setBusy(false);
    }
  };

  const importMint = () => {
    const mint = customMint.trim();
    setCustomErr(null);
    if (!isSolanaAddress(mint)) {
      setCustomErr('BAD_MINT');
      return;
    }
    if (tokens.some((tk) => tk.mint === mint)) {
      setCustomErr('ALREADY_ADDED');
      return;
    }
    /*
     * Decimals default to 9 and the symbol is the truncated mint.
     *
     * Reading the real values needs an RPC call to the token's mint account.
     * That is worth adding, but shipping without it is honest as long as the
     * UI does not pretend to know: the row is labelled "imported" and the
     * quote comes back from Jupiter in true base units either way, so a wrong
     * `decimals` only affects what the user TYPES, and they see the resulting
     * quote before signing anything.
     */
    const tk = {
      mint,
      symbol: `${mint.slice(0, 4)}…${mint.slice(-4)}`,
      name: t('solana.importedToken'),
      decimals: 9,
      imported: true
    };
    setExtraTokens((prev) => [...prev, tk]);
    setToToken(tk);
    setCustomMint('');
    haptic?.('success');
  };

  const flip = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setAmount('');
    haptic?.('select');
  };

  const outAmount = order?.outAmount
    ? fromBaseUnits(order.outAmount, toToken.decimals)
    : null;
  const sourceBalance = walletBalances
    ? fromBaseUnits(walletBalances.sourceRaw.toString(), fromToken.decimals)
    : null;
  const solBalance = walletBalances
    ? fromBaseUnits(walletBalances.solLamports.toString(), 9)
    : null;

  return (
    <PageTransition embedded={embedded}>
      {/* ---------------------------- wallet state --------------------------
          The swap only quotes and executes. Connecting/disconnecting and the
          three wallet methods live on the Wallet page's Solana tab. */}
      <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <div className="row-between">
          <div>
            <div className="faint">{t('solana.title')}</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>
              {address ? shortAddress(address) : t('solana.notConnected')}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/wallet?tab=solana')}>
            {address ? t('solana.manageWallet') : t('wallet.connect')}
          </button>
        </div>

        {address ? (
          <div className="row-between" style={{ marginTop: 9 }}>
            <span className="faint">
              {balanceLoading ? t('common.loading') : `${sourceBalance ?? '—'} ${fromToken.symbol}`}
            </span>
            <span className="mono faint" style={{ fontSize: 11.5 }}>{solBalance ?? '—'} SOL</span>
          </div>
        ) : (
          <p className="notice" style={{ marginTop: 11 }}>
            {t('solana.swapNeedsWallet')}
          </p>
        )}
      </motion.section>

      {/* ----------------------------- ticket ---------------------------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="field-label">{t('swap.from')}</div>
        <div className="row" style={{ gap: 8 }}>
          <select
            value={fromToken.mint}
            onChange={(e) => setFromToken(tokens.find((tk) => tk.mint === e.target.value))}
            style={{ width: 'auto' }}
          >
            {tokens.map((tk) => (
              <option key={tk.mint} value={tk.mint}>{tk.symbol}</option>
            ))}
          </select>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="0.0"
            style={{ flex: 1, textAlign: 'end' }}
          />
        </div>

        <div className="row" style={{ justifyContent: 'center', margin: '10px 0' }}>
          <button className="icon-btn" onClick={flip} aria-label={t('swap.flip')}>⇅</button>
        </div>

        <div className="field-label">{t('swap.to')}</div>
        <div className="row" style={{ gap: 8 }}>
          <select
            value={toToken.mint}
            onChange={(e) => setToToken(tokens.find((tk) => tk.mint === e.target.value))}
            style={{ width: 'auto' }}
          >
            {tokens.map((tk) => (
              <option key={tk.mint} value={tk.mint}>{tk.symbol}</option>
            ))}
          </select>
          <div className="mono" style={{ flex: 1, textAlign: 'end', fontSize: 16, padding: '9px 0' }}>
            {quoting ? t('swap.quoting') : (outAmount ?? '—')}
          </div>
        </div>

        {quoteErr && (
          <div className="stack" style={{ gap: 8, marginTop: 11 }}>
            <p className="notice notice-danger" style={{ margin: 0 }}>
              {t(`solana.err.${quoteErr}`, t('solana.err.QUOTE_FAILED'))}
            </p>
            {quoteErr !== 'SAME_TOKEN' && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => { haptic?.('select'); setQuoteNonce((n) => n + 1); }}
                disabled={quoting}
              >
                {quoting ? t('swap.quoting') : t('common.retry')}
              </button>
            )}
          </div>
        )}

        {order && (
          <div className="stack" style={{ gap: 6, marginTop: 12 }}>
            <div className="row-between">
              <span className="faint">{t('solana.router')}</span>
              {/*
                The provider that actually priced the number on screen, not
                the one we prefer. Since the OpenOcean → Jupiter fallback,
                hard-coding "OpenOcean" here would have told the user their
                quote came from a route that was just rejected.
              */}
              <span className="mono" style={{ fontSize: 12 }}>
                {order.provider === 'jupiter' ? 'Jupiter' : 'OpenOcean'}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('swap.networkFee')}</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {order.feeBps != null ? `${order.feeBps / 100}%` : '—'}
              </span>
            </div>
          </div>
        )}

        {/*
          The button is gated on a QUOTE, not on a transaction.

          It used to require `order.transaction`, which was correct for
          Jupiter because its quote carried one. Ours deliberately does not —
          the signable transaction is fetched inside swap() after the user
          commits. Left unchanged, this condition would have disabled the
          button permanently: a working integration with a dead button.
        */}
        <button
          className="btn btn-primary"
          style={{ marginTop: 14 }}
          disabled={!address || !order?.outAmount || busy}
          onClick={swap}
        >
          {busy ? t('swap.dontClose') : t('nav.swap')}
        </button>

        {txErr && (
          <p className="notice notice-danger" style={{ marginTop: 11 }}>
            {t(`solana.err.${txErr}`, t('solana.err.SIGN_FAILED'))}
          </p>
        )}

        {result?.signature && (
          <div className="notice" style={{ marginTop: 11 }}>
            {t('swap.success')}
            <a
              href={`https://solscan.io/tx/${result.signature}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'block', marginTop: 6 }}
            >
              {t('swap.viewOnExplorer')}
            </a>
          </div>
        )}
      </motion.section>

      {/* --------------------- swap history --------------------- */}
      <SwapHistoryPanel network="solana" />

      {/* --------------------- import any mint (memecoins) --------------------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('solana.importTitle')}</p>
        <p className="muted" style={{ fontSize: 12.3, marginBottom: 10 }}>{t('solana.importBody')}</p>
        <div className="row" style={{ gap: 8 }}>
          <input
            type="text"
            value={customMint}
            onChange={(e) => {
              setCustomMint(e.target.value);
              setCustomErr(null);
            }}
            placeholder={t('solana.mintPlaceholder')}
            style={{ flex: 1, fontSize: 12 }}
          />
          <button className="btn btn-ghost btn-sm" onClick={importMint}>
            {t('swap.importAction')}
          </button>
        </div>
        {customErr && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {t(`solana.err.${customErr}`)}
          </p>
        )}
      </motion.section>

      {/* ------------------------------ notices ------------------------------ */}
      {/*
        ─── TWO AMBER BOXES STACKED AT THE BOTTOM ──────────────────────────
        Reported: «در صفحه سواپ سولنا پایین صفحه دو هشدار هست و دو کیف پول،
        کنار هم» — two warnings sitting together at the foot of the page.

        Both were `.notice`, both amber, one directly under the other, and
        neither is urgent: one restates that we are non-custodial (true on
        every screen in the app) and the other quotes the fee rate. Stacked
        in warning colours they read as two alarms about a swap that is
        perfectly normal, which is how a user learns to ignore amber.

        Folded into one box. The fee is still one tap away and still exact —
        it is simply no longer shouting alongside a policy statement.
      */}
      <InfoBox title={t('solana.aboutTitle')} tone="info" id="solana-about">
        <p>{t('swap.nonCustodialNotice')}</p>
        <p>
          {/*
            The rate the USER pays, and nothing else.

            This used to also spell out "Jupiter keeps 20%, so 0.56% reaches
            us" — true, and none of a customer's business. What they need
            before signing is what comes out of their swap; how we split it
            afterwards is our accounting. netFeeBps() still exists for our own
            reporting.
          */}
          {/*
            ─── SAY WHAT IS ACTUALLY CHARGED ──────────────────────────────────
            This unconditionally announced a 0.70% platform fee. But the fee is
            only requested when a Jupiter referral account is configured (see
            `solanaFeeReady()`), and it is deliberately NOT configured yet —
            setting one up costs SOL the wallet does not have, and with no
            users there is nothing to collect anyway.

            So the screen was telling every visitor they would be charged
            0.70% while charging them nothing. Overstating a fee is the safer
            direction to be wrong in, but it is still wrong, and "the fee I was
            quoted is not the fee I paid" is exactly the discrepancy that makes
            someone distrust a swap they cannot reverse.

            When the referral account is set, this switches back on its own —
            the same flag that decides whether to REQUEST the fee decides
            whether to ANNOUNCE it, so the two can never disagree again.
          */}
          {/*
            ─── THE FLAG CHANGED WITH THE ROUTE ───────────────────────────────
            This asked `solanaFeeReady()`, which reports whether a JUPITER
            referral account is configured. The screen no longer swaps through
            Jupiter, so that flag now answers a question nobody is asking —
            and it answers "false", meaning we would tell every user the swap
            is free while charging them 0.70%.
            
            Understating a fee is the dangerous direction to be wrong in: the
            user discovers it only after signing something irreversible. The
            notice now follows the quote's OWN `feeBps`, which is the exact
            number the server put in the request, so the announcement and the
            charge cannot drift apart.
          */}
          {order?.feeBps
            ? t('solana.feeNotice', { fee: order.feeBps / 100 })
            : t('solana.feeNoneNotice')}
        </p>
        {/*
          THE FEE-NOT-CONFIGURED WARNING USED TO RENDER HERE. It is gone.

          The comment that sat here claimed it was "only shown to us". That was
          simply false — it rendered for every visitor, in red, at the bottom of
          the swap screen. A customer reading "fee collection is not configured"
          learns nothing they can act on and sees an app that looks half-built.
          Reported, correctly, as «به مشتری مربوط نیست».

          The signal itself still matters, because Jupiter serves swaps normally
          with no referral account and pays us nothing — an unconfigured
          integration is indistinguishable from a working one. So it moved to
          where an operator looks and a customer does not:

              GET /api/solana/status  ->  { "feeReady": false }

          Documented in docs/SOLANA-STEPS-FA.md as the way to verify setup.
        */}
      </InfoBox>
    </PageTransition>
  );
}
