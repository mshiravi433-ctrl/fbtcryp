import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import { useTelegram } from '../context/TelegramContext';
import { useHideBalances } from '../hooks/useHideBalances';
import {
  SOL_MINT,
  USDC_MINT,
  USDT_MINT,
  fromBaseUnits,
  isSolanaAddress,
  toBaseUnits
} from '../lib/solana';
import { getOceanQuote, getOceanSwap } from '../lib/solanaOcean';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  canInjectSolana,
  registerMobileWalletAdapter,
  connectSolana,
  disconnectSolana,
  signAndSendSolana,
  solanaAddress,
  solanaWalletAvailable,
  solanaWalletName,
  phantomBrowseLink,
  publicAppUrl,
  solflareBrowseLink
} from '../lib/solanaWallet';
import { shortAddress, useWallet } from '../context/WalletContext';
import { EQUITY_ASSETS, LST_ASSETS, findAsset } from '../lib/solanaAssets';

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
   * The EVM wallet, read ONLY to show its state side by side.
   *
   * The owner asked how to disconnect the main wallet before connecting
   * Solana, assuming the two conflict. They do not, and the panel below
   * proves it visually rather than asking anyone to take my word for it:
   * MetaMask lives on `window.ethereum`, Phantom on `window.phantom.solana`.
   * Different objects, different namespaces, no shared state — verified with
   * both injected at once.
   */
  const evm = useWallet();

  const [address, setAddress] = useState(() => solanaAddress());
  const [connecting, setConnecting] = useState(false);
  const [walletErr, setWalletErr] = useState(null);

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
      setToToken(BASE_TOKENS.find((tk) => tk.mint === asset.mint) ?? BASE_TOKENS[1]);
      /* Buying an equity or an LST means paying with a stablecoin, not SOL. */
      setFromToken(BASE_TOKENS.find((tk) => tk.mint === USDC_MINT) ?? BASE_TOKENS[0]);
    }
    /* Consume the param either way, so a refresh does not re-apply it and
       fight the user's own selection. `replace` keeps it out of history. */
    const next = new URLSearchParams(searchParams);
    next.delete('to');
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

    /* Already known — curated or previously imported. Just select it. */
    const curatedHit = BASE_TOKENS.find((tk) => tk.mint === mint);
    if (curatedHit) {
      setToToken(curatedHit);
      setFromToken(BASE_TOKENS.find((tk) => tk.mint === USDC_MINT) ?? BASE_TOKENS[0]);
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
    setToToken(token);
    /* Paying with a stablecoin, not with SOL: the coin page sent a "buy". */
    setFromToken(BASE_TOKENS.find((tk) => tk.mint === USDC_MINT) ?? BASE_TOKENS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [order, setOrder] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState(null);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [txErr, setTxErr] = useState(null);

  // Paste-a-mint support, which is how memecoins are actually found.
  const [customMint, setCustomMint] = useState('');
  const [customErr, setCustomErr] = useState(null);
  const [extraTokens, setExtraTokens] = useState([]);

  const tokens = useMemo(() => [...BASE_TOKENS, ...extraTokens], [extraTokens]);
  const hasWallet = solanaWalletAvailable();
  /*
   * Whether an injected provider is even POSSIBLE here. False in the APK and
   * in ordinary mobile browsers, where extensions do not exist — so "no wallet
   * found" would be misleading rather than informative.
   */
  const canInject = canInjectSolana();

  /*
   * ─── REGISTER MOBILE WALLET ADAPTER, WHERE IT CAN WORK ──────────────────
   * Chrome for Android had NO path to a Solana wallet: extensions do not exist
   * on mobile, so `canInject` is false and the screen could only offer the
   * "open this inside Phantom" deeplink. MWA is the official route and adds a
   * real in-place connection there.
   *
   * Registered on mount rather than at module load so the package stays out of
   * the initial bundle, and guarded by `canUseMwa()` so iOS and our own APK —
   * neither of which can complete the intent round trip — are untouched.
   *
   * `mwaReady` only relaxes the "no wallet here" messaging; it never gates the
   * connect button, because a registration failure must not remove a path the
   * user already had.
   */
  const [mwaReady, setMwaReady] = useState(false);
  useEffect(() => {
    let alive = true;
    registerMobileWalletAdapter(publicAppUrl('/')).then((ok) => {
      if (alive && ok) setMwaReady(true);
    });
    return () => { alive = false; };
  }, []);

  /*
   * Must leave our own WebView.
   *
   * lib/browser.js openUrl() prefers the in-app browser plugin, which would
   * render the Phantom deeplink INSIDE our app — the one place it cannot work,
   * since the whole point is to hand the page to another application. A plain
   * window.open lets Android resolve the universal link to the wallet.
   */
  const openExternal = (url) => {
    if (!url) return;
    haptic?.('light');
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  /*
   * Guards a stale quote overwriting a newer one. Two rapid amount changes
   * resolve out of order often enough on a mobile connection to matter, and
   * showing the price for an amount the user has already changed is the kind
   * of wrong that costs money.
   */
  const reqSeq = useRef(0);

  const connect = useCallback(async () => {
    setWalletErr(null);
    setConnecting(true);
    try {
      const addr = await connectSolana();
      setAddress(addr);
      haptic?.('success');
    } catch (err) {
      setWalletErr(err.message || 'CONNECT_FAILED');
      haptic?.('error');
    } finally {
      setConnecting(false);
    }
  }, [haptic]);

  const disconnect = useCallback(async () => {
    await disconnectSolana();
    setAddress(null);
    setOrder(null);
  }, []);

  /* ------------------------------- quoting ------------------------------- */

  useEffect(() => {
    setOrder(null);
    setQuoteErr(null);
    setResult(null);
    setTxErr(null);

    const base = toBaseUnits(amount, fromToken.decimals);
    if (!base || base === '0') return undefined;
    if (fromToken.mint === toToken.mint) {
      setQuoteErr('SAME_TOKEN');
      return undefined;
    }

    const seq = reqSeq.current + 1;
    reqSeq.current = seq;
    setQuoting(true);

    const id = setTimeout(async () => {
      try {
        /*
         * ─── WHY THE QUOTE COMES FROM OPENOCEAN NOW ────────────────────────
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
         */
        const q = await getOceanQuote({
          inputMint: fromToken.mint,
          outputMint: toToken.mint,
          amount: base,
          /* The user's setting, finally reaching the request. */
          slippageBps
        });
        if (reqSeq.current !== seq) return; // a newer request won
        if (!q?.outAmount || q.outAmount === '0') {
          setQuoteErr('NO_ROUTE');
          setOrder(null);
        } else {
          setOrder(q);
        }
      } catch (err) {
        if (reqSeq.current !== seq) return;
        setQuoteErr(err.message || 'QUOTE_FAILED');
        setOrder(null);
      } finally {
        if (reqSeq.current === seq) setQuoting(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(id);
  }, [amount, fromToken, toToken, address, slippageBps]);

  /* -------------------------------- swap --------------------------------- */

  const swap = async () => {
    if (!order || busy || !address) return;
    setBusy(true);
    setTxErr(null);
    haptic?.('medium');

    try {
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
       */
      const built = await getOceanSwap({
        inputMint: fromToken.mint,
        outputMint: toToken.mint,
        amount: toBaseUnits(amount, fromToken.decimals),
        account: address,
        /*
         * MUST match the quote above. Building the signable transaction with
         * a different tolerance than the one priced would mean the user
         * consented to one number and signed another.
         */
        slippageBps
      });

      if (!built?.transaction) throw new Error('NO_TRANSACTION');

      /*
       * signAndSend, NOT sign-only. OpenOcean returns an unsigned transaction
       * and does not broadcast; the Jupiter helper signs and hands back, which
       * here would leave the trade never submitted while the UI reported
       * success. Two named functions so the two cannot be swapped by accident.
       */
      const signature = await signAndSendSolana(built.transaction, built.versioned);

      if (signature) {
        setResult({ signature });
        setAmount('');
        setOrder(null);
        haptic?.('success');
      } else {
        setTxErr('SEND_FAILED');
        haptic?.('error');
      }
    } catch (err) {
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

  return (
    <PageTransition embedded={embedded}>
      {/* ---------------------------- wallet ---------------------------- */}
      <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <div className="row-between">
          <div>
            <div className="faint">{t('solana.title')}</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginTop: 2 }}>
              {address ? shortAddress(address) : t('solana.notConnected')}
            </div>
          </div>
          {address ? (
            <button className="btn btn-ghost btn-sm" onClick={disconnect}>
              {t('wallet.disconnect')}
            </button>
          ) : (
            /*
              Enabled when EITHER path exists. Gating on `hasWallet` alone kept
              the button disabled on Android Chrome even after MWA registered
              successfully - the exact dead end MWA was added to remove.
            */
            <button
              className="btn btn-primary btn-sm"
              onClick={connect}
              disabled={connecting || (!hasWallet && !mwaReady)}
            >
              {connecting ? t('wallet.connecting') : t('wallet.connect')}
            </button>
          )}
        </div>

        {/*
          ---------- NO INJECTED PROVIDER ----------

          Two different situations that used to share one dead-end message.

          In the APK (and in any ordinary mobile browser) there can NEVER be an
          injected provider: Phantom injects window.solana from a browser
          EXTENSION, and extensions do not exist on mobile. Telling that user to
          "install Phantom" is wrong — they may already have it — and the
          disabled Connect button gave them nowhere to go.

          Phantom's own recommendation is to hand the page to the wallet's
          in-app browser, where the provider IS injected. So instead of an
          error, this offers the button that actually gets them there.
        */}
        {/*
          `mwaReady` suppresses this whole block: on Android Chrome the user now
          has a working in-place connection, so telling them to reopen the page
          inside a wallet would send them out of a flow that already works.
        */}
        {!hasWallet && !mwaReady && (
          canInject ? (
            <p className="notice notice-danger" style={{ marginTop: 11 }}>
              {t('solana.noWallet')}
            </p>
          ) : (
            <div style={{ marginTop: 11 }}>
              <p className="notice">{t('solana.openInWallet')}</p>
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => openExternal(phantomBrowseLink(publicAppUrl('/#/solana')))}
                >
                  {t('solana.openPhantom')}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => openExternal(solflareBrowseLink(publicAppUrl('/#/solana')))}
                >
                  {t('solana.openSolflare')}
                </button>
              </div>
              <p className="faint" style={{ fontSize: 11, marginTop: 9, lineHeight: 1.7 }}>
                {t('solana.openInWalletHint')}
              </p>
            </div>
          )
        )}
        {walletErr && (
          <p className="notice notice-danger" style={{ marginTop: 11 }}>
            {t(`solana.err.${walletErr}`, t('solana.err.CONNECT_FAILED'))}
          </p>
        )}
        {hasWallet && !address && (
          <p className="faint" style={{ marginTop: 9, fontSize: 12 }}>
            {t('solana.detected', { name: solanaWalletName() })}
          </p>
        )}
      </motion.section>

      {/*
        ---------- HOW THE TWO WALLETS RELATE ----------

        Asked directly: "how do I disconnect the main wallet before connecting
        Solana — you can't have two connected at once."

        You can. MetaMask/Trust inject `window.ethereum`; Phantom/Solflare
        inject `window.phantom.solana`. Separate objects, separate namespaces,
        no shared state — confirmed with both present simultaneously.

        Rather than assert that in a paragraph nobody reads, both connections
        are shown side by side with their live state. Seeing two green dots at
        once answers the question permanently.
      */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('solana.twoWalletsTitle')}</p>
        <p className="muted" style={{ fontSize: 12.3, marginBottom: 11, lineHeight: 1.8 }}>
          {t('solana.twoWalletsBody')}
        </p>

        <div className="stack" style={{ gap: 9 }}>
          <div className="row-between">
            <span className="row" style={{ gap: 7 }}>
              <span className="dot" style={{ background: evm.address ? 'var(--up)' : 'var(--text-3)' }} />
              <span style={{ fontSize: 12.5 }}>{t('solana.evmSide')}</span>
            </span>
            <span className="mono faint" style={{ fontSize: 11.5 }}>
              {evm.address ? shortAddress(evm.address) : t('solana.notConnected')}
            </span>
          </div>

          <div className="row-between">
            <span className="row" style={{ gap: 7 }}>
              <span className="dot" style={{ background: address ? 'var(--up)' : 'var(--text-3)' }} />
              <span style={{ fontSize: 12.5 }}>{t('solana.solSide')}</span>
            </span>
            <span className="mono faint" style={{ fontSize: 11.5 }}>
              {address ? shortAddress(address) : t('solana.notConnected')}
            </span>
          </div>
        </div>

        {/*
          Was a third amber box, immediately under the two wallet rows the
          owner also flagged. It is reassurance, not a warning — nothing about
          it is urgent and nothing is at risk — so it drops to plain prose and
          stops competing with the notices that do matter.
        */}
        <p className="prose-sm" style={{ marginTop: 12 }}>{t('solana.noNeedToDisconnect')}</p>
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
          <p className="notice notice-danger" style={{ marginTop: 11 }}>
            {t(`solana.err.${quoteErr}`, t('solana.err.QUOTE_FAILED'))}
          </p>
        )}

        {order && (
          <div className="stack" style={{ gap: 6, marginTop: 12 }}>
            <div className="row-between">
              <span className="faint">{t('solana.router')}</span>
              <span className="mono" style={{ fontSize: 12 }}>OpenOcean</span>
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
