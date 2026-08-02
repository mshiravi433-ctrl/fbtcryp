import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import { useTelegram } from '../context/TelegramContext';
import { useHideBalances } from '../hooks/useHideBalances';
import {
  SOL_MINT,
  USDC_MINT,
  USDT_MINT,
  executeSolanaOrder,
  executeSucceeded,
  fromBaseUnits,
  getSolanaOrder,
  isSolanaAddress,
  orderErrorKey,
  referralFeeBps,
  toBaseUnits
} from '../lib/solana';
import {
  canInjectSolana,
  connectSolana,
  disconnectSolana,
  signSolanaTransaction,
  solanaAddress,
  solanaWalletAvailable,
  solanaWalletName,
  phantomBrowseLink,
  publicAppUrl,
  solflareBrowseLink
} from '../lib/solanaWallet';
import { shortAddress, useWallet } from '../context/WalletContext';

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
  { mint: USDT_MINT, symbol: 'USDT', name: 'Tether USD', decimals: 6 }
];

const DEBOUNCE_MS = 450;

export default function SolanaSwap() {
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
        const o = await getSolanaOrder({
          inputMint: fromToken.mint,
          outputMint: toToken.mint,
          amount: base,
          taker: address || undefined
        });
        if (reqSeq.current !== seq) return; // a newer request won
        const errKey = orderErrorKey(o);
        if (errKey) {
          setQuoteErr(errKey);
          setOrder(null);
        } else {
          setOrder(o);
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
  }, [amount, fromToken, toToken, address]);

  /* -------------------------------- swap --------------------------------- */

  const swap = async () => {
    if (!order?.transaction || busy) return;
    setBusy(true);
    setTxErr(null);
    haptic?.('medium');

    try {
      const signed = await signSolanaTransaction(order.transaction);
      const res = await executeSolanaOrder({
        signedTransaction: signed,
        requestId: order.requestId
      });

      if (executeSucceeded(res)) {
        setResult(res);
        setAmount('');
        setOrder(null);
        haptic?.('success');
      } else {
        setTxErr(res?.error || `CODE_${res?.code ?? 'UNKNOWN'}`);
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
    <PageTransition>
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
            <button className="btn btn-primary btn-sm" onClick={connect} disabled={connecting || !hasWallet}>
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
        {!hasWallet && (
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

        <p className="notice" style={{ marginTop: 12 }}>{t('solana.noNeedToDisconnect')}</p>
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
              <span className="mono" style={{ fontSize: 12 }}>{order.router ?? '—'}</span>
            </div>
            <div className="row-between">
              <span className="faint">{t('swap.networkFee')}</span>
              <span className="mono" style={{ fontSize: 12 }}>
                {order.feeBps != null ? `${order.feeBps / 100}%` : '—'}
              </span>
            </div>
          </div>
        )}

        <button
          className="btn btn-primary"
          style={{ marginTop: 14 }}
          disabled={!address || !order?.transaction || busy}
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
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="notice">{t('swap.nonCustodialNotice')}</p>
        <p className="notice" style={{ marginTop: 9 }}>
          {/*
            The rate the USER pays, and nothing else.

            This used to also spell out "Jupiter keeps 20%, so 0.56% reaches
            us" — true, and none of a customer's business. What they need
            before signing is what comes out of their swap; how we split it
            afterwards is our accounting. netFeeBps() still exists for our own
            reporting.
          */}
          {t('solana.feeNotice', { fee: referralFeeBps() / 100 })}
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
      </motion.section>
    </PageTransition>
  );
}
