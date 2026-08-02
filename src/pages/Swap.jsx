import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
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
  DEFAULT_SLIPPAGE,
  approveToken,
  estimateGasCost,
  executeSwap,
  getBalances,
  getPriceImpact,
  getQuote,
  needsApproval
} from '../lib/swap';
import TokenIcon from '../lib/tokenIcon';
import { fmtQty } from '../lib/format';
import { NATIVE_GAS_FLOOR, formatUnitsExact } from '../lib/swap';
import { AnimatedSearch, AnimatedSettings, AnimatedSwap, useStill } from '../components/AnimatedIcon';
import { PAYOUT_DIRECTORY } from '../lib/payout';
import { useHideBalances } from '../hooks/useHideBalances';

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
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);

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
  }, [searchParams, setSearchParams, curated]);
  const [balances, setBalances] = useState({});
  const [impact, setImpact] = useState(null);
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
  const setMax = () => {
    const entry = balances[tokenKey(fromToken)];
    const raw = entry?.raw;
    haptic?.('select');

    if (raw == null) {
      setAmount('');
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

  const runSwap = async () => {
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
      const fresh = await getQuote({ provider, chainId, fromToken, toToken, amountIn: amount, slippage });
      if (!fresh || fresh.error) throw new Error('QUOTE_EXPIRED');

      setTxState({ stage: 'signing' });
      const tx = await executeSwap({ signer, chainId, fromToken, toToken, quote: fresh });
      setTxState({ stage: 'pending', hash: tx.hash });
      haptic?.('medium');

      const receipt = await tx.wait();
      const ok = receipt.status === 1;
      setTxState({ stage: ok ? 'success' : 'failed', hash: tx.hash });

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

  /* --------------------------------- UI ---------------------------------- */

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
        {lowGas && (
          <p className="notice notice-danger" style={{ marginTop: 10 }}>
            {t('swap.needGas', { coin: cfg.native.symbol, chain: cfg.name })}
          </p>
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
            setReviewing(true);
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
