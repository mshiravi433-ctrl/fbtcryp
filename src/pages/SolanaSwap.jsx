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
import { getLifiSolanaQuote } from '../lib/solanaLifi';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  signAndSendSolana,
  signSolanaTransaction,
  getSolanaSwapBalances,
  getSolanaTokenInfo,
  solanaAddress
} from '../lib/solanaWallet';
import { solanaSwapPreflight, lamportsToSol } from '../lib/solana/swapPreflight';
import { shortAddress } from '../context/WalletContext';
import { COMMODITY_ASSETS, EQUITY_ASSETS, LST_ASSETS, findAsset } from '../lib/solanaAssets';
import { SOLANA_BASE_TOKENS as BASE_TOKENS, loadSolanaUniverse, mergeSolanaUniverse } from '../lib/solanaUniverse';
import { useAppStore } from '../store/useAppStore';
import { recordSwap, confirmSwap, failSwap } from '../lib/swapHistory';
import SwapHistoryPanel from '../components/SwapHistoryPanel';
import SolanaConnectSheet from '../components/SolanaConnectSheet';
import SolanaTokenPicker from '../components/SolanaTokenPicker';
import SolanaTokenChip from '../components/SolanaTokenChip';
import TokenIcon from '../lib/tokenIcon';
import { warmDeeplinkRequest } from '../lib/solana/deeplink.js';
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

/**
 * The name of the route the user is about to take.
 *
 * Kept as a map rather than a ternary so a new provider cannot ship with the
 * previous one's name on screen — the exact bug class that put "OpenOcean" on
 * Jupiter quotes before this screen grew a third source.
 */
const ROUTER_LABEL = { openocean: 'OpenOcean', lifi: 'LI.FI', jupiter: 'Jupiter' };

/** Curated starting points. Everything else arrives by pasted mint address. */
/* The curated list lives in lib/solanaUniverse.js — one list, two screens. */

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
  const [solSheetOpen, setSolSheetOpen] = useState(false);
  const [walletBalances, setWalletBalances] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  /*
   * WHY the balance could not be read, as a named code (RPC_BLOCKED,
   * RPC_RATE_LIMITED, RPC_TIMEOUT, RPC_ERROR, RPC_UNAVAILABLE). Null when the
   * read succeeded.
   *
   * The old screen threw every failure away (`catch { return null }`) and
   * turned all of them into BALANCE_UNAVAILABLE — one sentence, «check the RPC
   * later», for a network path that is BLOCKED and would never answer a retry.
   * Each of these codes has its own translation and its own remedy.
   */
  const [balanceCode, setBalanceCode] = useState(null);
  const [balanceHosts, setBalanceHosts] = useState(null);
  /* What OUR OWN backend answered when the direct RPC path failed (null when
     the server door was never reached, or answered nothing diagnostic). */
  const [balanceServerNote, setBalanceServerNote] = useState(null);
  /* Set when the swap was allowed to proceed WITHOUT a verified balance, so the
     user is told that before they sign, not after. */
  const [preflightNotice, setPreflightNotice] = useState(null);
  /* The refused pre-flight, kept so the sentence can carry the exact shortfall
     («you need 0.0021 SOL more») instead of only its name. */
  const [preCheck, setPreCheck] = useState(null);

  /* Arm the connect request before anyone taps: the hand-off has to come out of
     the tap to be allowed to open the wallet (see lib/solana/deeplink.js). */
  useEffect(() => {
    warmDeeplinkRequest();
  }, []);

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
  const setSolanaCluster = useSettingsStore((s) => s.setSolanaCluster);

  /*
   * ─── THE CLUSTER SETTING, HONESTLY ────────────────────────────────────────
   * Requested: «سولانا مین‌نت یا آزمایشی کار بده وقتی روی آن باشد».
   *
   * The switch does take effect — balances, on-chain reads, the launch lab and
   * the broadcast path all follow it (lib/solanaRpc.js). What it CANNOT do is
   * make this screen work on devnet: the quote comes from Jupiter and
   * OpenOcean, which serve mainnet mints only. Before this, selecting Devnet
   * left the swap quoting real mainnet prices and then handing the wallet a
   * transaction for a network it was not on — a failure with no explanation,
   * which is worse than either working or refusing.
   *
   * So on devnet this screen says what it can and cannot do, offers the one-tap
   * way back, and the swap button is gated. Everything else on the page (the
   * wallet, its devnet balance, the launch lab link) still works.
   */
  const cluster = useSettingsStore((s) => s.solanaCluster);
  const devnet = cluster === 'devnet';

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
    const asset = findAsset(to) ?? (to === SOL_MINT ? BASE_TOKENS.find((tk) => tk.mint === SOL_MINT) : null);
    if (asset) {
      /*
       * A curated asset that is somehow not in BASE_TOKENS is still built from
       * its own verified record — never swapped for USDC. The old `?? USDC`
       * fallback is how every gold Buy landed on a USDC → USDC screen.
       */
      const target = BASE_TOKENS.find((tk) => tk.mint === asset.mint)
        ?? { mint: asset.mint, symbol: asset.symbol, name: asset.name, decimals: asset.decimals, decimalsVerified: true };
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
 * Decimals start as a flagged GUESS here (`decimalsVerified: false`) and are
 * read from the chain immediately after — see resolveTokenScale. The old
 * comment claimed the guess was safe because «the quote is computed by Jupiter
 * from the mint's real on-chain decimals»; Jupiter does use the real scale, but
 * WE convert the typed amount with the guess first, so a 6-decimal token became
 * a 1000× amount and every verdict was «insufficient balance».
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
      /*
       * A PLACEHOLDER, and it is now labelled as one. 9 is the most common
       * Solana scale and it is wrong for most modern tokens (6 decimals), which
       * is why `decimalsVerified: false` travels with it: an amount converted
       * with an unconfirmed scale is never compared against a balance, and the
       * scale is asked for from the chain the moment the token is added.
       */
      decimals: 9,
      decimalsVerified: false,
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

  // One consumer for an orders-page handoff. It has to run after the `?to` and
  // `?toMint` effects: each of those captures the initial params and writes
  // them back, and the last write is the one that sticks.
  useEffect(() => {
    const fromMint = searchParams.get('fromMint');
    const toMint = searchParams.get('toMint');
    const amt = searchParams.get('amount');
    if (!fromMint && !toMint) return;
    const resolve = (mint) => {
      if (!mint || !isSolanaAddress(mint)) return null;
      const curated = BASE_TOKENS.find((tk) => tk.mint === mint);
      if (curated) return curated;
      const asset = findAsset(mint);
      const decimals = Number.isInteger(asset?.decimals) ? asset.decimals : 9;
      return {
        mint,
        symbol: asset?.symbol || `${mint.slice(0, 4)}…${mint.slice(-4)}`,
        name: asset?.name || '',
        decimals,
        decimalsVerified: Number.isInteger(asset?.decimals),
        imported: !asset,
        icon: asset?.icon || asset?.logoURI || null
      };
    };
    const fromTk = resolve(fromMint);
    const toTk = resolve(toMint);
    const sellOnly = searchParams.get('side') === 'sell' && toTk && !fromTk;
    if (fromTk?.imported) {
      setExtraTokens((prev) => (prev.some((tk) => tk.mint === fromTk.mint) ? prev : [...prev, fromTk]));
    }
    if (toTk?.imported) {
      setExtraTokens((prev) => (prev.some((tk) => tk.mint === toTk.mint) ? prev : [...prev, toTk]));
    }
    if (sellOnly) {
      const usdc = BASE_TOKENS.find((tk) => tk.mint === USDC_MINT) ?? BASE_TOKENS[0];
      setFromToken(toTk);
      setToToken(usdc);
    } else {
      if (fromTk) setFromToken(fromTk);
      if (toTk) setToToken(toTk);
    }
    if (amt && Number(amt) > 0) setAmount(String(amt));
    const next = new URLSearchParams(searchParams);
    next.delete('fromMint');
    next.delete('toMint');
    next.delete('amount');
    next.delete('side');
    next.delete('chain');
    if (fromMint || toMint) next.delete('to');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * ─── THE SCALE OF AN IMPORTED TOKEN IS READ, NOT GUESSED ──────────────────
   * A pasted mint used to be stored with `decimals: 9` and a comment claiming
   * that was safe because «the quote is computed by Jupiter from the mint's
   * real on-chain decimals». Half true, and the wrong half: Jupiter does use
   * the real scale, but WE convert the amount the user typed into base units
   * first, with the guess. For a 6-decimal token — most pump.fun and modern
   * SPL tokens — every amount became 1000× too large, so
   *
   *   · the balance line on screen showed a number 1000× smaller than the truth
   *     («موجودی کیف پول کم» for a funded wallet);
   *   · the pre-flight compared 1000× the amount against the real balance and
   *     refused with INSUFFICIENT_BALANCE;
   *   · Jupiter was asked for 1000× the holding and answered errorCode 1, which
   *     maps to the same «موجودی برای این سواپ کافی نیست».
   *
   * So the scale is now asked for, from the chain through whichever door
   * answers (lib/solana/balanceSource.js), and until it is known the token is
   * marked `decimalsVerified: false` — which stops the pre-flight from
   * comparing numbers whose units are a guess (lib/solana/swapPreflight.js).
   *
   * The SYMBOL stays the truncated address even when Jupiter offers a name.
   * That is deliberate and not an oversight: an uncurated mint's symbol is
   * supplied by whoever created it, and the six fake AAPLx tokens in
   * lib/solanaAssets.js exist because a name in a dropdown is a phishing
   * vector. The scale is a fact about the chain; the name is a claim.
   */
  const [scaleErr, setScaleErr] = useState(null);
  /* The modern token picker: null = closed, 'from' | 'to' = which box opened it. */
  const [pickerSide, setPickerSide] = useState(null);
  const scaleInFlight = useRef(new Set());

  const resolveTokenScale = useCallback(async (mint) => {
    if (!mint || scaleInFlight.current.has(mint)) return;
    scaleInFlight.current.add(mint);
    try {
      const info = await getSolanaTokenInfo(mint);
      if (!info?.ok || !Number.isInteger(info.decimals)) {
        setScaleErr(info?.code || 'DECIMALS_UNREADABLE');
        return;
      }
      const patch = (tk) => (tk?.mint === mint && !tk.decimalsVerified
        /* The scale is only worth writing when it is a real answer. */
        ? { ...tk, decimals: info.decimals, decimalsVerified: true, decimalsSource: info.via || 'chain' }
        : tk);
      /*
       * Patch the LIST and the two SELECTED tokens. `fromToken`/`toToken` hold
       * references to the objects as they were when picked, so updating only
       * the list would leave the screen quoting with the old scale — the exact
       * bug this exists to remove. Changing them is also what re-runs the quote
       * effect (it is keyed on the token objects), so a price already on screen
       * is recomputed with the real scale instead of staying 1000× wrong.
       */
      setExtraTokens((prev) => prev.map(patch));
      setFromToken((prev) => patch(prev));
      setToToken((prev) => patch(prev));
      setScaleErr(null);
    } catch {
      setScaleErr('DECIMALS_UNREADABLE');
    } finally {
      scaleInFlight.current.delete(mint);
    }
  }, []);

  useEffect(() => {
    for (const tk of extraTokens) {
      if (!tk?.decimalsVerified) void resolveTokenScale(tk.mint);
    }
  }, [extraTokens, resolveTokenScale]);

  /*
   * ─── THE TOKEN UNIVERSE ────────────────────────────────────────────────
   *   «تعداد توکن ها کم است» (this screen).
   *
   * It used to be exactly three hand-written rows plus a paste-a-mint field.
   * On the one chain where browsing IS the trade, that is the wrong default:
   * the deep end of Solana is what people open this app for, and none of it
   * was one tap away.
   *
   * The order is deliberate and it is the speed budget:
   *
   *   1. `BASE_TOKENS` — the curated set, already in memory, painted on the
   *      first frame with no request and no cache read. The screen is usable
   *      the instant it mounts, offline included.
   *   2. The remembered catalogue (lib/solanaUniverse.js) merges in from
   *      localStorage on the next tick, so a returning user sees the full
   *      list essentially immediately.
   *   3. The network refresh lands last and only ever ADDS rows.
   *
   * A failure at any step leaves exactly what was already there. The screen
   * loses breadth; it never loses the ability to swap a token whose mint the
   * user knows.
   */
  const [universe, setUniverse] = useState([]);
  const [universeLive, setUniverseLive] = useState(false);
  /* The curated mints, as a set — the quick rail needs to know which rows
     came from the app itself, because those have no liquidity figure in the
     catalogue and must not be sorted out of existence by a numeric filter. */
  const curatedMints = useMemo(
    () => new Set(BASE_TOKENS.map((tk) => tk.mint)),
    []
  );
  useEffect(() => {
    let alive = true;
    loadSolanaUniverse((rows) => {
      if (!alive) return;
      setUniverse(rows);
      setUniverseLive(true);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const tokens = useMemo(
    () => mergeSolanaUniverse(BASE_TOKENS, [...universe, ...extraTokens]),
    [universe, extraTokens]
  );

  /*
   * The quick-pick rail. Highest LIQUIDITY first, not highest rank: the
   * upstream already ranked its three lists, and the only fact that decides
   * whether a chip is useful is whether a quote comes back for it. The
   * server drops sub-$500-liquidity rows for exactly this reason.
   *
   * The two legs already on the ticket are excluded — a chip that would flip
   * the pair the user is mid-way through setting up is a trap, and both are
   * already visible in the boxes above.
   */
  const popular = useMemo(
    () => tokens
      .filter((tk) => tk && tk.mint && tk.mint !== fromToken.mint && tk.mint !== toToken.mint)
      .filter((tk) => (Number(tk.liquidity ?? 0) > 0) || curatedMints.has(tk.mint))
      .sort((a, b) => (Number(b.liquidity ?? 0) - Number(a.liquidity ?? 0)))
      .slice(0, 14),
    [tokens, fromToken.mint, toToken.mint]
  );

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

  /* The last balance-read failure, for the code that runs in the same tick as
     the read and therefore cannot see React state yet. */
  const balanceFail = useRef(null);

  /** The amount the user typed, in base units — or null when the scale is a
      guess we must not compare against a real balance. */
  const rawAmountFor = useCallback(() => {
    const base = toBaseUnits(amount, fromToken.decimals);
    if (!base || base === '0') return null;
    try { return BigInt(base); } catch { return null; }
  }, [amount, fromToken.decimals]);

  const loadWalletBalances = useCallback(async ({ rawAmount = null } = {}) => {
    if (!address) return null;
    setBalanceLoading(true);
    try {
      const state = await getSolanaSwapBalances({
        owner: address,
        inputMint: fromToken.mint,
        outputMint: toToken.mint,
        /*
         * Only used to decide whether the third read (does the OUTPUT token
         * account exist?) can change the verdict. When the wallet's SOL already
         * covers the input plus the creation rent, the answer cannot matter and
         * the call is not made — two node requests instead of three, which on a
         * rate-limited public node is the difference between an answer and a
         * 429. See outputAccountCheckNeeded in lib/solana/chainReads.js.
         */
        rawAmount
      });
      setWalletBalances(state);
      balanceFail.current = null;
      setBalanceCode(null);
      setBalanceHosts(null);
      setBalanceServerNote(null);
      return state;
    } catch (err) {
      setWalletBalances(null);
      const code = err?.code || err?.message || 'RPC_UNAVAILABLE';
      const hosts = Array.isArray(err?.hosts) && err.hosts.length ? err.hosts : null;
      /*
       * The ref is for swap(), which runs in the same tick and therefore cannot
       * see the state this catch just set. The state is for the screen. Both are
       * written because the two readers are different, not because one is a
       * backup: a stale closure here would throw the generic code again.
       */
      balanceFail.current = { code, hosts, detail: err?.detail || null };
      setBalanceCode(code);
      setBalanceHosts(hosts);
      setBalanceServerNote(
        err?.serverTried === true
          ? t('solana.serverDoor', {
            code: err?.serverCode || `HTTP_${err?.serverStatus || 0}`
          })
          : null
      );
      return null;
    } finally {
      setBalanceLoading(false);
    }
  }, [address, fromToken.mint, toToken.mint, t]);

  useEffect(() => {
    loadWalletBalances();
  }, [loadWalletBalances]);

  /*
   * A network switch re-reads the balances.
   *
   * `loadWalletBalances` is keyed on the address and the two mints, so picking
   * Devnet in Settings used to leave the numbers from mainnet on screen — the
   * setting had changed and the screen had not. Settings announces the change
   * on `fbt:solana-network`; this answers it. The quote itself is not re-run
   * because on devnet there is no quote to run (see the devnet notice above).
   */
  useEffect(() => {
    const onNetwork = () => { void loadWalletBalances(); };
    window.addEventListener('fbt:solana-network', onNetwork);
    return () => window.removeEventListener('fbt:solana-network', onNetwork);
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

        /*
         * ─── THE FEE-EARNING ROUTES ARE ASKED *IN PARALLEL* ──────────────────
         * De¹ and LI.FI both pay us and both are real quotes; asking them one
         * after the other would make the screen wait for a timeout before
         * showing a price it already had. Whichever answers better WINS — the
         * comparison is on the output the user actually receives, which is the
         * only honest way to pick between two fee-paying routes.
         *
         * LI.FI needs the wallet address even to price (its quote carries the
         * transaction), so it joins only once an account is connected. Until
         * then De¹ is asked alone, exactly as before.
         */
        const attempts = [
          getOceanQuote({
            inputMint: fromToken.mint,
            outputMint: toToken.mint,
            amount: base,
            /* The user's setting, finally reaching the request. */
            slippageBps
          })
            .then((oq) => ((oq?.outAmount && oq.outAmount !== '0')
              ? { ...oq, provider: 'openocean' }
              : Promise.reject(new Error('NO_ROUTE'))))
        ];
        if (address) {
          attempts.push(
            getLifiSolanaQuote({
              inputMint: fromToken.mint,
              outputMint: toToken.mint,
              amount: base,
              account: address,
              slippageBps
            })
              .then((lq) => ((lq?.outAmount && lq.outAmount !== '0')
                ? { ...lq, provider: 'lifi' }
                : Promise.reject(new Error('NO_ROUTE'))))
          );
        }

        /*
         * Which answer wins, and how long we wait for the better one.
         *
         * Both routes are fee-paying, so the user gets the LARGER output (an
         * exact tie keeps De¹, whose total charge is lower because LI.FI adds
         * its own 25 bps). The wait is bounded on purpose: each source has its
         * own 15-second deadline, and without a grace window a dead LI.FI would
         * hold an already-priced screen for its full timeout — the regression
         * this bound exists to prevent. The first SUCCESS starts the window
         * (a failure waits for the other source), and the hard cap keeps the
         * worst case inside the screen's own patience.
         */
        const GRACE_MS = 2500;
        const WINDOW_CAP_MS = 12000;
        const startedAt = Date.now();
        let firstSuccessAt = 0;
        const asOut = (v) => {
          try {
            return BigInt(v);
          } catch {
            return null;
          }
        };
        const consider = (v) => {
          firstSuccessAt = firstSuccessAt || Date.now();
          if (!q) {
            q = v;
            return;
          }
          const candidate = asOut(v.outAmount);
          const current = asOut(q.outAmount);
          if (candidate != null && (current == null || candidate > current)) q = v;
        };
        const track = attempts.map((p) => p.then(consider, (e) => {
          if (!err) err = e;
        }));
        await Promise.race([
          Promise.all(track),
          new Promise((resolve) => {
            const timer = setInterval(() => {
              const graceElapsed = firstSuccessAt && Date.now() - firstSuccessAt >= GRACE_MS;
              if (graceElapsed || Date.now() - startedAt >= WINDOW_CAP_MS) {
                clearInterval(timer);
                resolve();
              }
            }, 100);
          })
        ]);

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

  /**
   * LI.FI half of the build.
   *
   * One request, like the quote above but with the confirmed wallet as the
   * signer: LI.FI returns price AND the unsigned versioned transaction, with
   * our fee already proven inside it by the server's echo gate. The client
   * signs and BROADCASTS (there is no /execute on this route), which is why
   * this lands on the same `signAndSendSolana` call the De¹ path uses.
   */
  const buildLifiSwap = async ({ inputMint, outputMint, amount, account, slippageBps }) => {
    const lq = await getLifiSolanaQuote({
      inputMint,
      outputMint,
      amount,
      account,
      slippageBps
    });
    if (!lq?.transaction) throw new Error('NO_TRANSACTION');
    return {
      provider: 'lifi',
      transaction: lq.transaction,
      versioned: lq.versioned !== false,
      outAmount: lq.outAmount ?? null,
      /* What the USER pays: our share plus LI.FI's fixed 25 bps, both stated
         by the server from the feeCosts array it verified. */
      feeBps: lq.totalFeeBps ?? lq.feeBps ?? null
    };
  };

  const swap = async () => {
    if (!order || busy || !address) return;
    setBusy(true);
    setTxErr(null);
    setPreCheck(null);
    setPreflightNotice(null);
    haptic?.('medium');
    let solRecordId = null;

    try {
      /*
       * ─── PRE-FLIGHT: A KNOWN SHORTFALL BLOCKS, AN UNREADABLE ONE DOES NOT ──
       * Fail before opening a wallet prompt when the account is PROVABLY short:
       * wallet simulation used to surface that as the vague «not signed» error
       * even though signing was never the problem. The decision itself lives in
       * lib/solana/swapPreflight.js so it can be asserted without a browser, a
       * wallet or a node.
       *
       * What changed, and why: an UNREADABLE balance used to throw
       * BALANCE_UNAVAILABLE and the swap died there — that is the «RPC را چک
       * کنید» half of the report, on the networks where the public nodes are
       * blocked. Blocking was not the safety property it looked like. Every
       * path below simulates before it lands (MWA signs with
       * `skipPreflight: false`, the injected provider preflights, Jupiter's
       * /execute refuses a transaction that would fail), so an underfunded swap
       * is rejected by the chain with NOTHING SPENT — while a swap our own read
       * refused never happened at all. Now the read is tried hard (four nodes,
       * then our own backend), and if it still cannot be made, the user is told
       * so on screen BEFORE they press and the chain gets the final word.
       *
       * And a GUESSED SCALE is never compared: `amountScaleVerified` is false
       * for a pasted mint whose decimals the chain has not confirmed, so the
       * amount check is left to the aggregator, which reads the mint's real
       * decimals and answers errorCode 1 — INSUFFICIENT_BALANCE from the source
       * of truth instead of from our arithmetic.
       */
      const rawAmount = rawAmountFor();
      const balancesNow = await loadWalletBalances({ rawAmount });
      const pre = solanaSwapPreflight({
        balances: balancesNow,
        balanceCode: balanceFail.current?.code || null,
        rawAmount,
        amountScaleVerified: fromToken.decimalsVerified !== false && balancesNow?.sourceDecimalsVerified !== false,
        isSolInput: fromToken.mint === SOL_MINT
      });
      setPreCheck(pre.ok ? null : pre);
      setPreflightNotice(pre.ok ? pre.notice : null);
      if (!pre.ok) {
        const err = new Error(pre.code);
        err.preflight = pre;
        throw err;
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
      /*
       * THE PRICING PROVIDER COMES FIRST, THEN THE OTHER TWO.
       *
       * The number the user consented to is the pricing provider's number, so
       * it builds first; the others are fallbacks for the case where that
       * route's upstream degrades between the quote and the tap. All three are
       * ordered deliberately: the two FEE-earning routes before the free
       * Jupiter one, so a failure never quietly converts a paid route into a
       * free one while a paid one was still available.
       */
      const PROVIDERS = ['openocean', 'lifi', 'jupiter'];
      const providers = [order.provider, ...PROVIDERS.filter((p) => p !== order.provider)];
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
            : p === 'lifi'
              ? await buildLifiSwap({
                inputMint: fromToken.mint,
                outputMint: toToken.mint,
                amount: toBaseUnits(amount, fromToken.decimals),
                account: address,
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

  /**
   * Import a mint — from the import card (meta = null, the honest unknown) or
   * from the token picker (meta = Jupiter's index row, when the token is one
   * the index knows: name, logo, price, liquidity).
   *
   * The SCALE stays `decimalsVerified: false` in both cases: Jupiter's number
   * is the router's own index and a far better first guess than 9, but the
   * verified flag is only ever earned by the chain read (resolveTokenScale),
   * and until it lands the pre-flight refuses to compare the amount against a
   * balance — the one guard that keeps a wrong scale from inventing a verdict.
   *
   * The SYMBOL keeps its phishing discipline: when the mint is NOT in the
   * index, the truncated address renders, never a name nobody verified.
   */
  const importMint = (meta = null) => {
    const mint = String(typeof meta === 'object' && meta !== null ? meta.mint : customMint).trim();
    setCustomErr(null);
    if (!isSolanaAddress(mint)) {
      setCustomErr('BAD_MINT');
      return;
    }
    if (tokens.some((tk) => tk.mint === mint)) {
      setCustomErr('ALREADY_ADDED');
      return;
    }
    const known = meta && typeof meta === 'object';
    const tk = {
      mint,
      symbol: (known && meta.symbol) || `${mint.slice(0, 4)}…${mint.slice(-4)}`,
      name: (known && meta.name) || t('solana.importedToken'),
      icon: (known && meta.icon) || null,
      decimals: known && Number.isInteger(meta.decimals) ? meta.decimals : 9,
      decimalsVerified: false,
      verified: known && meta.verified === true,
      imported: true,
      usdPrice: known ? (meta.usdPrice ?? null) : null
    };
    setExtraTokens((prev) => [...prev, tk]);
    setToToken(tk);
    setCustomMint('');
    haptic?.('success');
  };

  /*
   * ─── THE PICKER'S TWO DOORS ───────────────────────────────────────────────
   * `onPick` selects an entry already in the list; `onImport` adds a fresh
   * mint and selects it in one motion. Picking the token already sitting on
   * the OTHER side flips the pair — the quote effect would only answer
   * SAME_TOKEN, and a flip is what anyone tapping the opposite side's token
   * almost always means.
   */
  const pickToken = (side, tk) => {
    if (!tk?.mint) return;
    if (side === 'from') {
      if (tk.mint === toToken.mint) { flip(); return; }
      setFromToken(tk);
    } else if (tk.mint === fromToken.mint) {
      flip();
    } else {
      setToToken(tk);
    }
    haptic?.('select');
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
    ? fromBaseUnits(
      walletBalances.sourceRaw.toString(),
      /*
       * The scale the CHAIN reported for this token wins over the scale in our
       * list. For a curated token they are the same number; for a pasted mint
       * whose scale had not been read yet, the chain's is the only honest one —
       * and displaying a balance with the wrong scale is how a funded wallet
       * came to look empty (a 6-decimal token read at 9 decimals shows 1000×
       * smaller than it is).
       */
      Number.isInteger(Number(walletBalances.sourceDecimals)) && walletBalances.sourceDecimalsVerified !== false
        ? Number(walletBalances.sourceDecimals)
        : fromToken.decimals
    )
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
          <div className="row" style={{ gap: 7 }}>
            {/* Which network this screen is reading — the setting made visible
                where it has its effect, not only where it is stored. */}
            <span className={`sol-net-chip${devnet ? ' is-devnet' : ''}`} title={cluster}>
              <span className="sol-net-dot" aria-hidden="true" />
              {devnet ? 'Devnet' : 'Mainnet'}
            </span>
            {/* Nothing connected: ask the wallet for approval RIGHT HERE — the
                deeplink request is the only route that produces a confirmation
                screen on a phone, and sending the user to another page first
                was half of the reported problem. Once connected, the button
                goes back to being a link to the wallet page. */}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => (address ? navigate('/wallet?tab=solana') : setSolSheetOpen(true))}
              data-testid="solana-swap-connect"
            >
              {address ? t('solana.manageWallet') : t('wallet.connect')}
            </button>
          </div>
        </div>

        {devnet && (
          <div className="sol-devnet-note" role="status">
            <p>{t('solana.devnetSwapTitle')}</p>
            <span>{t('solana.devnetSwapBody')}</span>
            <div className="row" style={{ gap: 8, marginTop: 9, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSolanaCluster('mainnet-beta');
                  try {
                    window.dispatchEvent(new CustomEvent('fbt:solana-network', { detail: { cluster: 'mainnet-beta' } }));
                  } catch { /* the store write is the part that matters */ }
                }}
              >
                {t('solana.devnetSwapBack')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/launch')}>
                {t('solana.devnetSwapLaunch')}
              </button>
            </div>
          </div>
        )}

        {address ? (
          <div className="row-between" style={{ marginTop: 9 }}>
            <span className="faint">
              {/*
                «—», never a number, when the read failed. Showing 0 for a
                wallet that could not be read is the difference between «the
                chain is unreachable from here» and «you are broke» — and the
                second one is a lie that costs a support ticket.
              */}
              {balanceLoading
                ? t('common.loading')
                : walletBalances
                  ? `${sourceBalance ?? '—'} ${fromToken.symbol}`
                  : '—'}
            </span>
            <span className="mono faint" style={{ fontSize: 11.5 }}>
              {walletBalances ? `${solBalance ?? '—'} SOL` : ''}
            </span>
          </div>
        ) : (
          <p className="notice" style={{ marginTop: 11 }}>
            {t('solana.swapNeedsWallet')}
          </p>
        )}

        {/*
          ── A BALANCE THAT COULD NOT BE READ SAYS SO, NAMED ──────────────────
          One sentence used to cover every failure («BALANCE_UNAVAILABLE»), so
          a network path that is BLOCKED told the user to try again later —
          advice that can never work. Each code has its own translation and its
          own remedy, and the per-host line below is what support reads.
        */}
        {address && !balanceLoading && balanceCode ? (
          <div className="notice" role="status" style={{ marginTop: 10 }}>
            <p style={{ margin: 0 }}>
              {t(`solana.err.${balanceCode}`, t('solana.err.BALANCE_UNAVAILABLE'))}
            </p>
            <span className="muted" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
              {t('solana.balanceUnverifiedBody')}
            </span>
            {balanceHosts?.length ? (
              <code
                className="mono"
                style={{ display: 'block', marginTop: 6, fontSize: 10.5, opacity: 0.7, wordBreak: 'break-all' }}
              >
                {balanceHosts.map((h) => `${h.host}: ${h.reason}`).join(' · ')}
              </code>
            ) : null}
            {/*
              ─── THE SECOND DOOR, MADE VISIBLE ──────────────────────────────
              The balance read races the public nodes against our own backend
              (lib/solana/balanceSource.js). When THIS line used to say only
              the public hosts failed, nobody could tell whether the server
              door had even been tried — the operator's first question, asked
              and answered nowhere. Now: what the backend answered, or that it
              was never reachable, sits right under the host list.
            */}
            {balanceServerNote ? (
              <code
                className="mono"
                style={{ display: 'block', marginTop: 4, fontSize: 10.5, opacity: 0.7, wordBreak: 'break-all' }}
              >
                {balanceServerNote}
              </code>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 8 }}
              onClick={() => { haptic?.('select'); void loadWalletBalances({ rawAmount: rawAmountFor() }); }}
            >
              {t('common.retry')}
            </button>
          </div>
        ) : null}

        {/* The scale of a pasted mint is being asked for, or could not be
            answered — stated, because it decides whether an amount on this
            screen can be compared against a balance at all. */}
        {(fromToken?.decimalsVerified === false || toToken?.decimalsVerified === false) ? (
          <p className="notice" style={{ marginTop: 9 }} role="status">
            {scaleErr
              ? t('solana.err.DECIMALS_UNREADABLE')
              : t('solana.decimalsReading')}
          </p>
        ) : null}
      </motion.section>

      {/* ----------------------------- ticket ---------------------------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <div className="sol-swap-box">
          <div className="sol-swap-box-head">
            <span className="faint" style={{ fontSize: 11.5 }}>{t('swap.from')}</span>
            <span className="faint" style={{ fontSize: 11.5 }}>
              {t('swap.balance')}: {balanceLoading ? '…' : (sourceBalance ?? '—')} {fromToken.symbol}
            </span>
          </div>
          <div className="sol-swap-box-body">
            <SolanaTokenChip
              token={fromToken}
              onClick={() => { haptic?.('select'); setPickerSide('from'); }}
              testId="solana-token-from"
            />
            <input
              className="swap-amount-input mono"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0.0"
            />
          </div>
          <div className="sol-swap-box-foot">
            {sourceBalance != null && Number(sourceBalance) > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAmount(sourceBalance)}>{t('swap.max')}</button>
            ) : <span />}
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'center', margin: '10px 0' }}>
          <button className="icon-btn" onClick={flip} aria-label={t('swap.flip')}>⇅</button>
        </div>

        <div className="sol-swap-box">
          <div className="sol-swap-box-head">
            <span className="faint" style={{ fontSize: 11.5 }}>{t('swap.to')}</span>
          </div>
          <div className="sol-swap-box-body">
            <SolanaTokenChip
              token={toToken}
              onClick={() => { haptic?.('select'); setPickerSide('to'); }}
              testId="solana-token-to"
            />
            <span className="mono sol-swap-out">
              {quoting ? t('swap.quoting') : (outAmount ?? '—')}
            </span>
          </div>
        </div>

        {/*
          ─── ONE TAP TO THE DEEP END ──────────────────────────────────────
          «تعداد توکن ها کم است».

          A catalogue nobody has to scroll to is worth more than a longer one
          behind a search box: these are the highest-liquidity mints the
          catalogue knows, offered directly. Tapping one puts it on the TO
          side, which is the direction people arrive wanting — they have the
          stablecoin and they know what they want next.

          Deliberately NOT shown when the list failed to load, and deliberately
          capped: an empty rail under the ticket reads as a broken component,
          and sixty chips is a list, not a rail. The picker still holds
          everything, and a pasted mint still works — this is a shortcut, not
          a gate.
        */}
        {popular.length > 0 && (
          <div className="sol-quick" data-testid="sol-quick-picks">
            <div className="sol-quick-head">
              <span className="faint">{t('solana.picker.popular')}</span>
              <span className="faint mono">{t('solana.picker.universeCount', { count: tokens.length })}</span>
            </div>
            <div className="tag-scroll sol-quick-rail">
              {popular.map((tk) => (
                <button
                  key={tk.mint}
                  type="button"
                  className={`sol-quick-chip${toToken.mint === tk.mint ? ' is-active' : ''}`}
                  onClick={() => pickToken('to', tk)}
                  title={tk.name || tk.symbol}
                >
                  <TokenIcon token={tk} size={18} />
                  <span className="sol-quick-sym">{tk.symbol}</span>
                </button>
              ))}
            </div>
          </div>
        )}

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
                {ROUTER_LABEL[order.provider] || ROUTER_LABEL.openocean}
              </span>
            </div>
            <div className="row-between">
              <span className="faint">{t('swap.networkFee')}</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {/*
                  The TOTAL the user pays, when the quote knows it: a LI.FI
                  Solana route charges our 70 bps AND LI.FI's own fixed 25 bps,
                  and the server reads both out of the feeCosts array it
                  verified. Showing only our share would understate the price
                  of the swap on screen — the dangerous direction to be wrong
                  in, because it is discovered after signing.
                */}
                {order.totalFeeBps != null
                  ? `${order.totalFeeBps / 100}%`
                  : order.feeBps != null ? `${order.feeBps / 100}%` : '—'}
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
          disabled={devnet || !address || !order?.outAmount || busy}
          onClick={swap}
        >
          {busy ? t('swap.dontClose') : devnet ? t('solana.devnetSwapCta') : t('nav.swap')}
        </button>

        {txErr && (
          <div className="notice notice-danger" style={{ marginTop: 11 }}>
            <p style={{ margin: 0 }}>
              {t(`solana.err.${txErr}`, t('solana.err.SIGN_FAILED'))}
            </p>
            {/*
              The shortfall, exactly. «Not enough SOL for the network fee» is a
              true sentence and an unusable one when the missing amount is
              0.0021 SOL and the wallet holds 0.0019 — which is the common case,
              because the fee that is short is usually the RENT for creating the
              destination token account, not the transfer fee.
            */}
            {preCheck?.code === 'INSUFFICIENT_GAS' && preCheck.shortfallLamports != null ? (
              <span className="muted" style={{ display: 'block', marginTop: 6, fontSize: 12 }}>
                {t('solana.gasShortfall', {
                  need: lamportsToSol(preCheck.needLamports),
                  have: lamportsToSol(preCheck.haveLamports),
                  missing: lamportsToSol(preCheck.shortfallLamports)
                })}
              </span>
            ) : null}
          </div>
        )}

        {/*
          Proceeding WITHOUT a verified balance is allowed — the wallet and the
          chain simulate before anything lands, so an underfunded swap costs
          nothing — but it is announced, before the signature rather than after.
        */}
        {preflightNotice ? (
          <p className="notice" style={{ marginTop: 11 }} role="status">
            {t('solana.swapUnverifiedNote')}
          </p>
        ) : null}

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

      <SolanaConnectSheet
        open={solSheetOpen}
        onClose={() => setSolSheetOpen(false)}
        onConnected={(addr) => setAddress(addr || solanaAddress())}
      />

      {/*
        ─── THE TOKEN PICKER ──────────────────────────────────────────────────
        One sheet serves both boxes. `onImport` funnels into the same
        importMint the paste card uses, so the background chain reads
        (decimals, balance) start the moment a mint is chosen — picker or
        card, one path, no second code path to drift.
      */}
      <SolanaTokenPicker
        open={pickerSide !== null}
        side={pickerSide || 'to'}
        tokens={tokens}
        selectedMints={[fromToken.mint, toToken.mint]}
        onClose={() => setPickerSide(null)}
        onPick={(tk) => { pickToken(pickerSide || 'to', tk); setPickerSide(null); }}
        onImport={(tk) => { importMint(tk); setPickerSide(null); }}
      />

      {/* --------------------- import any mint (memecoins) ---------------------
          The picker above is the front door (search, logos, sentiment, and
          paste-a-mint that resolves as you type). This card stays for the one
          flow it does better: pasting an address copied from somewhere else,
          without opening a sheet first. Same importMint, same chain reads. */}
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
          <button className="btn btn-ghost btn-sm" onClick={() => importMint()}>
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
          {order?.totalFeeBps || order?.feeBps
            ? t('solana.feeNotice', { fee: (order.totalFeeBps ?? order.feeBps) / 100 })
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
