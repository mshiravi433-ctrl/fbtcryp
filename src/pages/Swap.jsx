import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn } from '../components/PageTransition';
import AdBanner from '../components/AdBanner';
import Sheet from '../components/Sheet';
import WalletConnectSheet from '../components/WalletConnectSheet';
import TokenPicker from '../components/TokenPicker';
import { playFeedback, primeAudio } from '../lib/feedback';
import { hasEnoughGas, scanGas, suggestChain } from '../lib/gas';
import { useSettingsStore } from '../store/useSettingsStore';
import AnimatedNumber from '../components/AnimatedNumber';
import { useWallet, shortAddress } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import { EVM_CHAINS, TOKENS, explorerTx } from '../lib/chains';
import {
  DEFAULT_SLIPPAGE,
  approveToken,
  estimateGasCost,
  executeSwap,
  getBalances,
  getPriceImpact,
  getQuote,
  needsApproval
} from '../lib/swap';
import { fmtQty } from '../lib/format';

/**
 * Real on-chain swap screen (PancakeSwap V2).
 *
 * Every transaction is signed by the user's own wallet and broadcast from it.
 * This app takes no fee, holds no funds, and has no address in the flow.
 */
export default function Swap() {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const wallet = useWallet();

  const tradeSound = useSettingsStore((st) => st.tradeSound);
  const tradeVibrate = useSettingsStore((st) => st.tradeVibrate);
  const fb = (kind) => playFeedback(kind, { sound: tradeSound, vibrate: tradeVibrate });

  const chainId = wallet.chainId ?? 56;
  const tokens = TOKENS[chainId] ?? TOKENS[56];
  const cfg = EVM_CHAINS[chainId] ?? EVM_CHAINS[56];

  // Held as full token objects rather than symbols: a token picked from the
  // multi-thousand list — or resolved from a pasted contract address — does not
  // exist in the curated TOKENS array, so a symbol lookup would find nothing.
  const [fromToken, setFromToken] = useState(() => (TOKENS[56] ?? [])[0]);
  const [toToken, setToToken] = useState(() => (TOKENS[56] ?? [])[1]);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [balances, setBalances] = useState({});
  const [impact, setImpact] = useState(null);
  const [gasCost, setGasCost] = useState(null);
  const [picker, setPicker] = useState(null); // 'from' | 'to'
  const [connectOpen, setConnectOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [txState, setTxState] = useState(null); // { stage, hash, error }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [gasScan, setGasScan] = useState(null);
  const [gasScanning, setGasScanning] = useState(false);

  const fromSym = fromToken?.symbol;
  const toSym = toToken?.symbol;

  // Switching chains invalidates the selected pair — a BSC token address means
  // nothing on Arbitrum, and quoting it would fail confusingly.
  useEffect(() => {
    const list = TOKENS[chainId] ?? [];
    if (!list.length) return;
    setFromToken(list[0]);
    setToToken(list[1] ?? list[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId]);

  const quoteSeq = useRef(0);

  /* ------------------------------ balances ------------------------------ */

  const loadBalances = useCallback(async () => {
    if (!wallet.address) return;
    try {
      const provider = await wallet.getReadProvider(chainId);
      // The curated list plus whatever is actually selected. Without the
      // selected pair, a token chosen from the full list (or pasted as an
      // address) would always read as zero balance and MAX would do nothing.
      const wanted = [...tokens];
      for (const tk of [fromToken, toToken]) {
        if (tk && !wanted.some((x) => x.symbol === tk.symbol)) wanted.push(tk);
      }
      setBalances(await getBalances(provider, wanted, wallet.address));
    } catch {
      /* leave stale balances rather than blanking the UI */
    }
  }, [wallet, chainId, tokens, fromToken, toToken]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  /* ------------------------------- quoting ------------------------------- */

  useEffect(() => {
    const n = Number(amount);
    if (!n || n <= 0 || fromSym === toSym) {
      setQuote(null);
      setImpact(null);
      return undefined;
    }

    const seq = ++quoteSeq.current;
    setQuoting(true);

    const timer = setTimeout(async () => {
      try {
        const provider = await wallet.getReadProvider(chainId);
        const q = await getQuote({ provider, chainId, fromToken, toToken, amountIn: amount, slippage });
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
  }, [amount, fromToken, toToken, slippage, chainId, wallet, fromSym, toSym]);

  // refresh the quote every 15s so it can't go stale under the user
  useEffect(() => {
    if (!quote || quote.error) return undefined;
    const id = setInterval(() => setAmount((a) => a), 15000);
    return () => clearInterval(id);
  }, [quote]);

  /* -------------------------------- actions ------------------------------ */

  const flip = () => {
    haptic?.('select');
    setFromToken(toToken);
    setToToken(fromToken);
    setAmount('');
    setQuote(null);
  };

  const setMax = () => {
    const bal = balances[fromSym]?.formatted ?? 0;
    // leave a little gas behind when spending the native coin
    const usable = fromToken.native ? Math.max(0, bal - 0.002) : bal;
    setAmount(String(Number(usable.toFixed(8))));
    haptic?.('select');
  };

  const runSwap = async () => {
    const signer = wallet.getSigner?.();
    if (!signer || !quote || quote.error) return;

    // Unlock audio inside the tap gesture, or mobile browsers silently swallow
    // the success chime later when no gesture is in progress.
    primeAudio();
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
      const fresh = await getQuote({ provider, chainId, fromToken, toToken, amountIn: amount, slippage });
      if (!fresh || fresh.error) throw new Error('QUOTE_EXPIRED');

      setTxState({ stage: 'signing' });
      const tx = await executeSwap({ signer, chainId, fromToken, toToken, quote: fresh });
      setTxState({ stage: 'pending', hash: tx.hash });
      haptic?.('medium');
      fb('pending');

      const receipt = await tx.wait();
      const ok = receipt.status === 1;
      setTxState({ stage: ok ? 'success' : 'failed', hash: tx.hash });
      haptic?.(ok ? 'success' : 'error');
      // Ring + buzz on the on-chain result. Users routinely put the phone down
      // while a transaction mines, and a silent success looks like a stall.
      fb(ok ? 'success' : 'error');

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
      haptic?.('error');
      // A user-cancelled signature is not a failure worth alarming about.
      if (code !== 'USER_REJECTED') fb('error');
    }
  };

  const fromBal = balances[fromSym]?.formatted ?? 0;
  const insufficient = Number(amount) > fromBal;

  /* ------------------------------- gas check ------------------------------ */
  // Gas is always paid in the chain's OWN coin by the signing account. It
  // cannot be taken from another wallet or another network — no app can change
  // that. So rather than pretend, we check up front and point the user at a
  // network they can actually trade on right now.
  const nativeBal = wallet.nativeBalance ?? balances[cfg?.native?.symbol]?.formatted ?? null;
  const gasShort = wallet.isConnected && nativeBal != null && !hasEnoughGas(chainId, nativeBal);
  const gasAlternative = gasScan ? suggestChain(gasScan, chainId) : null;

  const runGasScan = async () => {
    if (!wallet.address || gasScanning) return;
    setGasScanning(true);
    try {
      setGasScan(await scanGas(wallet.getReadProvider, wallet.address));
    } finally {
      setGasScanning(false);
    }
  };

  // Scan automatically the moment we detect a shortfall, so the answer is
  // already on screen instead of behind another tap.
  useEffect(() => {
    if (gasShort && !gasScan && !gasScanning) runGasScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gasShort]);
  const canSwap = wallet.isConnected && quote && !quote.error && !insufficient && Number(amount) > 0;
  const highImpact = impact != null && impact > 5;

  /* --------------------------------- UI ---------------------------------- */

  return (
    <PageTransition>
      <motion.div className="row-between" variants={riseIn} initial="hidden" animate="show">
        <div>
          <h1 className="h1">{t('swap.title')}</h1>
          <p className="muted">{t('swap.subtitle', { dex: cfg.dexName })}</p>
        </div>
        <button className="icon-btn" onClick={() => setSettingsOpen(true)}>⚙</button>
      </motion.div>

      <p className="notice">{t('swap.nonCustodialNotice')}</p>

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
            {wallet.isConnected && (
              <button className="tag" style={{ marginInlineStart: 6, padding: '2px 8px' }} onClick={setMax}>
                MAX
              </button>
            )}
          </span>
        </div>
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
          <motion.button
            className="icon-btn"
            whileTap={{ scale: 0.86, rotate: 180 }}
            onClick={flip}
            style={{ borderColor: 'var(--rgb-1)', color: 'var(--rgb-1)' }}
          >
            ⇅
          </motion.button>
        </div>

        {/* TO */}
        <div className="row-between" style={{ marginBottom: 6 }}>
          <span className="field-label" style={{ margin: 0 }}>{t('swap.to')}</span>
          <span className="faint mono">
            {t('swap.balance')}: {fmtQty(balances[toSym]?.formatted ?? 0)}
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
            </motion.div>
          )}
        </AnimatePresence>

        {quote?.error && (
          <p className="notice notice-danger" style={{ marginTop: 12 }}>{t(`swap.err.${quote.error}`)}</p>
        )}
        {highImpact && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('swap.highImpact')}</p>}
        {insufficient && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('swap.insufficient')}</p>}

        {/* Gas shortfall — explain the rule, then offer a network that works. */}
        {gasShort && (
          <motion.div
            className="card"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginTop: 10, borderColor: 'rgba(255,179,0,.4)', background: 'rgba(255,179,0,.06)' }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: 'var(--rgb-5)' }}>
              {t('swap.gasTitle')}
            </div>
            <p className="muted" style={{ fontSize: 12.2, margin: 0, lineHeight: 1.8 }}>
              {t('swap.gasBody', { chain: cfg.name, symbol: cfg.native?.symbol })}
            </p>

            {gasScanning && (
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <div className="spinner" style={{ width: 15, height: 15 }} />
                <span className="faint">{t('swap.gasScan')}</span>
              </div>
            )}

            {gasAlternative && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: '100%', marginTop: 10 }}
                onClick={() => wallet.switchChain?.(gasAlternative.chainId)}
              >
                {t('swap.gasSwitch', { chain: gasAlternative.name })}
              </button>
            )}
          </motion.div>
        )}

        <button
          className="btn btn-primary"
          style={{ marginTop: 14 }}
          disabled={!canSwap}
          onClick={() => {
            if (!wallet.isConnected) return setConnectOpen(true);
            setReviewing(true);
          }}
        >
          {!wallet.isConnected ? t('wallet.connect') : quoting ? t('swap.quoting') : t('swap.review')}
        </button>
      </motion.section>

      <AdBanner slot="p2p" />

      {/* ---------------------------- token picker --------------------------- */}
      {/* Full multi-thousand list with search, replacing the 7-token sheet.
          Every pair we can't offer is a fee we don't earn. */}
      <TokenPicker
        open={Boolean(picker)}
        onClose={() => setPicker(null)}
        chainId={chainId}
        selectedSymbol={picker === 'from' ? fromSym : toSym}
        excludeAddress={picker === 'from' ? toToken?.address : fromToken?.address}
        getProvider={wallet.getReadProvider}
        onSelect={(tk) => {
          const other = picker === 'from' ? toToken : fromToken;
          const same =
            (tk.address ?? '').toLowerCase() === (other?.address ?? '').toLowerCase() &&
            Boolean(tk.address) === Boolean(other?.address);
          if (same) flip();
          else if (picker === 'from') setFromToken(tk);
          else setToToken(tk);
          haptic?.('select');
        }}
      />

      {/* ------------------------------ settings ----------------------------- */}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title={t('swap.settings')}>
        <label className="field-label">{t('swap.slippage')}</label>
        <div className="row" style={{ gap: 6 }}>
          {[0.1, 0.5, 1, 3].map((s) => (
            <button
              key={s}
              className={`tag ${slippage === s ? 'active' : ''}`}
              style={{ flex: 1, textAlign: 'center' }}
              onClick={() => setSlippage(s)}
            >
              {s}%
            </button>
          ))}
        </div>
        <input
          type="number"
          step="0.1"
          min="0.05"
          max="50"
          value={slippage}
          onChange={(e) => setSlippage(Math.min(50, Math.max(0.05, Number(e.target.value) || 0.5)))}
          style={{ marginTop: 10 }}
        />
        <p className="notice" style={{ marginTop: 10 }}>{t('swap.slippageHelp')}</p>
        {slippage > 3 && <p className="notice notice-danger" style={{ marginTop: 8 }}>{t('swap.slippageHigh')}</p>}
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
                <span className="mono">{slippage}%</span>
              </div>
              <div className="row-between">
                <span className="faint">{t('swap.recipient')}</span>
                <span className="mono" style={{ fontSize: 11 }}>{shortAddress(wallet.address)}</span>
              </div>
            </div>

            <p className="notice" style={{ marginTop: 12 }}>{t('swap.reviewNotice')}</p>

            <div className="row" style={{ gap: 10, marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={() => setReviewing(false)}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={runSwap}>{t('swap.confirmSwap')}</button>
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

            {txState.stage === 'success' && (
              <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                <div style={{ fontSize: 40 }}>✅</div>
                <div style={{ fontWeight: 700, margin: '8px 0' }}>{t('swap.success')}</div>
              </motion.div>
            )}

            {(txState.stage === 'error' || txState.stage === 'failed') && (
              <motion.div initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                <div style={{ fontSize: 40 }}>❌</div>
                <div style={{ fontWeight: 700, margin: '8px 0' }} className="down">
                  {t(`swap.err.${txState.error ?? 'TX_FAILED'}`)}
                </div>
                {txState.detail && <p className="faint mono" style={{ fontSize: 10 }}>{txState.detail}</p>}
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
    </PageTransition>
  );
}
