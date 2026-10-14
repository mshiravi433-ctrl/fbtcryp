import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useWallet } from '../../context/WalletContext';
import { useMarkets } from '../../hooks/useMarket';
import { useHideBalances } from '../../hooks/useHideBalances';
import { useTelegram } from '../../context/TelegramContext';
import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS, DEFAULT_CHAIN, explorerTx } from '../../lib/chains';
import {
  DEFAULT_DEADLINE_MIN,
  DEFAULT_SLIPPAGE,
  NATIVE_GAS_FLOOR,
  approveToken,
  estimateGasCost,
  executeSwap,
  getPriceImpact,
  getQuote,
  getTokenBalance,
  isStableSymbol,
  needsApproval
} from '../../lib/swap';
import { recordSwap, confirmSwap, failSwap, cancelSwap } from '../../lib/swapHistory';
import { balancesHidden, fmtUsd } from '../../lib/format';
import {
  SPOT_QUOTE_MAX_AGE_MS,
  defaultQuoteAsset,
  directedPair,
  formatWeiFloor,
  impactLevel,
  isQuoteStale,
  parseAmountWei,
  slippageLevel
} from '../../lib/spot/spotMath';
import { SPOT_STATUS, runSpotOrder } from '../../lib/spot/spotFlow';
import {
  SOLANA_GAS_ESTIMATE,
  SOLANA_GAS_FLOOR,
  SOLANA_SPOT_CHAIN,
  SOLANA_SPOT_ID,
  SOLANA_SPOT_TOKENS,
  getSolanaSpotBalances,
  getSolanaSpotQuote,
  runSolanaSpotOrder,
  solanaTxLink
} from '../../lib/spot/solanaSpot';
import Sheet from '../Sheet';
import WalletConnectSheet from '../WalletConnectSheet';
import SolanaConnectSheet from '../SolanaConnectSheet';
import SwapHistoryPanel from '../SwapHistoryPanel';
import SegIndicator from '../SegIndicator';
import AssetIcon from '../AssetIcon';
import {
  IconCheck,
  IconChevronRight,
  IconClock,
  IconInfo,
  IconRefresh,
  IconShield,
  IconWallet,
  IconX
} from '../Icons';
import SpotMarketList from './SpotMarketList';
import Trade from '../../pages/Trade';
import '../../styles/spot-trade.css';

/* The networks this tab can trade on: a chain with a curated token list. */
export const SPOT_CHAINS = EVM_CHAIN_ORDER.filter((id) => EVM_CHAINS[id] && (TOKENS[id]?.length ?? 0) >= 2);
const PERCENTS = [25, 50, 75, 100];
const SLIPPAGE_PRESETS = [0.1, 0.5, 1];

/* A status for every outcome: colour + icon + text (never colour alone). */
const OUTCOME_VIEW = {
  confirmed: { cls: 'is-ok', Icon: IconCheck, key: 'spot.status.confirmed' },
  failed: { cls: 'is-bad', Icon: IconX, key: 'spot.status.failed' },
  cancelled: { cls: 'is-muted', Icon: IconInfo, key: 'spot.status.cancelled' },
  stale: { cls: 'is-warn', Icon: IconClock, key: 'spot.status.stale' },
  working: { cls: 'is-busy', Icon: IconRefresh, key: 'spot.status.preparing' }
};

const STAGE_KEY = {
  preparing: 'spot.status.preparing',
  approving: 'spot.status.approving',
  'approval-sent': 'spot.status.approvalSent',
  quoting: 'spot.status.quoting',
  signing: 'spot.status.signing',
  pending: 'spot.status.pending'
};

/** Any refusal code → a user sentence. Unknown codes get the generic line. */
function errorKey(code) {
  return `spot.err.${code || 'TX_FAILED'}`;
}

/** The dropdown caret every modern select in the app wears (a rotated chevron). */
function Caret() {
  return (
    <span className="spot-select-chev" aria-hidden="true">
      <IconChevronRight width={16} height={16} style={{ transform: 'rotate(90deg)' }} />
    </span>
  );
}

export default function SpotTrade() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const { haptic } = useTelegram();
  const reduceMotion = useReducedMotion();
  useHideBalances();
  const { data: markets } = useMarkets(250);

  /* ─── network ─────────────────────────────────────────────────────────── */
  const [chainId, setChainId] = useState(() =>
    SPOT_CHAINS.includes(Number(wallet.chainId)) ? Number(wallet.chainId) : SPOT_CHAINS.includes(DEFAULT_CHAIN) ? DEFAULT_CHAIN : SPOT_CHAINS[0]
  );
  const isSol = chainId === SOLANA_SPOT_ID;
  const tokens = useMemo(() => (isSol ? SOLANA_SPOT_TOKENS : TOKENS[chainId] ?? []), [isSol, chainId]);
  const cfg = isSol ? SOLANA_SPOT_CHAIN : EVM_CHAINS[chainId];

  /* The Solana wallet is connected from the wallet screen (or its own sheet
     here). It is module-global state with one lightweight change event — the
     same contract pages/SolanaSwap.jsx follows — never a second connection
     flow living inside a trade form. */
  const [solAddress, setSolAddress] = useState(null);
  useEffect(() => {
    let alive = true;
    const onWalletChange = (event) => {
      if (alive) setSolAddress(event?.detail?.address || null);
    };
    window.addEventListener('solana:wallet-change', onWalletChange);
    import('../../lib/solanaWallet.js')
      .then((m) => {
        if (alive) setSolAddress(m.solanaAddress() || null);
      })
      .catch(() => {});
    return () => {
      alive = false;
      window.removeEventListener('solana:wallet-change', onWalletChange);
    };
  }, []);

  const connected = isSol ? Boolean(solAddress) : wallet.isConnected;
  const walletOnOrderChain = isSol ? Boolean(solAddress) : wallet.isConnected && Number(wallet.chainId) === Number(chainId);
  const walletOnOtherChain = !isSol && wallet.isConnected && !walletOnOrderChain;

  /* ─── pair and direction (derived, so the pair can never disagree) ───── */
  const [mode, setMode] = useState('real'); // 'real' | 'paper' — paper is off by default
  const [side, setSide] = useState('buy');
  const [quoteSym, setQuoteSym] = useState(null);
  const [assetSym, setAssetSym] = useState(null);
  const quoteAsset = useMemo(
    () => tokens.find((tk) => tk.symbol === quoteSym) ?? defaultQuoteAsset(tokens),
    [tokens, quoteSym]
  );
  const assetChoices = useMemo(
    () => tokens.filter((tk) => !quoteAsset || tk.symbol !== quoteAsset.symbol),
    [tokens, quoteAsset]
  );
  const asset = useMemo(
    () =>
      assetChoices.find((tk) => tk.symbol === assetSym) ??
      assetChoices.find((tk) => !isStableSymbol(tk.symbol)) ??
      assetChoices[0] ??
      null,
    [assetChoices, assetSym]
  );
  const directed = useMemo(() => directedPair({ side, asset, quoteAsset }), [side, asset, quoteAsset]);
  const fromToken = directed?.fromToken ?? null;
  const toToken = directed?.toToken ?? null;

  /* ─── amount and slippage ─────────────────────────────────────────────── */
  const [amountText, setAmountText] = useState('');
  const [slippageText, setSlippageText] = useState(String(DEFAULT_SLIPPAGE));
  const slipNum = Number(slippageText);
  const slipLevel = slippageLevel(slipNum);
  const amountParse = useMemo(
    () => (fromToken ? parseAmountWei(amountText, fromToken.decimals) : { ok: false, code: 'AMOUNT_REQUIRED' }),
    [amountText, fromToken]
  );
  const amountNorm = amountParse.ok ? amountText.trim() : '';

  /* ─── balances: a failed read is «unavailable» (null), never zero ─────── */
  const [balances, setBalances] = useState({});
  const [balanceNonce, setBalanceNonce] = useState(0);
  useEffect(() => {
    if (isSol) {
      if (!solAddress) {
        setBalances({});
        return undefined;
      }
      let alive = true;
      getSolanaSpotBalances({ owner: solAddress, tokens, formatFloor: formatWeiFloor })
        .then((map) => {
          if (alive) setBalances(map);
        })
        .catch(() => {
          if (alive) setBalances(Object.fromEntries(tokens.map((tk) => [tk.symbol, null])));
        });
      return () => {
        alive = false;
      };
    }
    if (!wallet.isConnected || !wallet.address) {
      setBalances({});
      return undefined;
    }
    let alive = true;
    (async () => {
      let provider = null;
      try {
        provider = await wallet.getReadProvider(chainId);
      } catch {
        provider = null;
      }
      const entries = await Promise.all(
        tokens.map(async (tk) => {
          if (!provider) return [tk.symbol, null];
          try {
            const b = await getTokenBalance(provider, tk, wallet.address);
            return [tk.symbol, { raw: b.raw, formatted: formatWeiFloor(b.raw, tk.decimals, 6) }];
          } catch {
            return [tk.symbol, null];
          }
        })
      );
      if (alive) setBalances(Object.fromEntries(entries));
    })();
    return () => {
      alive = false;
    };
  }, [isSol, solAddress, wallet.isConnected, wallet.address, chainId, tokens, balanceNonce, wallet.getReadProvider]);

  const balanceFor = (tk) => (balances[tk.symbol] === undefined ? undefined : balances[tk.symbol]);
  const fromBal = fromToken ? balances[fromToken.symbol] : undefined;
  // The gas coin keeps a floor so a max-amount order can still pay its fee.
  const isGasCoin = Boolean(fromToken && (fromToken.native || fromToken.address == null));
  const gasFloorWei = useMemo(() => {
    if (isSol) {
      const r = parseAmountWei(SOLANA_GAS_FLOOR, 9);
      return r.ok ? r.wei : 0n;
    }
    return amountParseWei(NATIVE_GAS_FLOOR[chainId]) ?? 0n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSol, chainId]);
  const availableWei = fromBal
    ? isGasCoin
      ? (fromBal.raw > gasFloorWei ? fromBal.raw - gasFloorWei : 0n)
      : fromBal.raw
    : null;

  /* ─── quote: debounced, sequenced, time-limited ───────────────────────── */
  const [quoteView, setQuoteView] = useState({ status: 'idle' });
  const [nonce, setNonce] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const seqRef = useRef(0);
  const currentKey = [chainId, side, fromToken?.symbol, toToken?.symbol, amountNorm, slipNum].join('|');
  const walletAddress = wallet.address ?? null;
  const orderAddress = isSol ? solAddress : walletAddress;

  useEffect(() => {
    if (!fromToken || !toToken || !amountParse.ok || slipLevel === 'invalid') {
      setQuoteView({ status: 'idle', key: currentKey });
      return undefined;
    }
    const seq = ++seqRef.current;
    setQuoteView((prev) => ({ ...prev, status: 'loading', key: currentKey }));
    const timer = setTimeout(async () => {
      try {
        if (isSol) {
          const q = await getSolanaSpotQuote({
            fromToken,
            toToken,
            amountWei: amountParse.wei,
            slippagePct: slipNum,
            address: orderAddress
          });
          if (seq !== seqRef.current) return;
          if (!q || q.error) {
            setQuoteView({ status: 'error', key: currentKey, code: q?.error ?? 'NO_ROUTE' });
            return;
          }
          const fetchedAt = Date.now();
          // The route echoes its own impact and the network's fee is a known
          // floor — no second estimation round trip on this chain.
          setQuoteView({
            status: 'ok',
            key: currentKey,
            quote: q,
            fetchedAt,
            impact: q.impactPct,
            gasCost: SOLANA_GAS_ESTIMATE
          });
          return;
        }
        const provider = await wallet.getReadProvider(chainId);
        if (seq !== seqRef.current) return;
        const q = await getQuote({
          provider,
          chainId,
          fromToken,
          toToken,
          amountIn: amountNorm,
          slippage: slipNum,
          fromAddress: walletAddress
        });
        if (seq !== seqRef.current) return;
        if (!q || q.error) {
          setQuoteView({ status: 'error', key: currentKey, code: q?.error ?? 'NO_ROUTE' });
          return;
        }
        const fetchedAt = Date.now();
        setQuoteView({ status: 'ok', key: currentKey, quote: q, fetchedAt, impact: null, gasCost: null });
        getPriceImpact({ provider, chainId, fromToken, toToken, amountIn: amountNorm, quote: q })
          .then((i) => seq === seqRef.current && setQuoteView((v) => (v.fetchedAt === fetchedAt ? { ...v, impact: i } : v)))
          .catch(() => {});
        estimateGasCost(provider)
          .then((g) => seq === seqRef.current && setQuoteView((v) => (v.fetchedAt === fetchedAt ? { ...v, gasCost: g } : v)))
          .catch(() => {});
      } catch (err) {
        if (seq === seqRef.current) {
          // The Solana routes throw plain Error(code); a code the UI knows is
          // shown as itself, anything else becomes the generic line.
          const msg = String(err?.message ?? '');
          const code = ['NO_ROUTE', 'NO_LIQUIDITY', 'QUOTE_NETWORK', 'QUOTE_FAILED'].includes(msg) ? msg : 'QUOTE_FAILED';
          setQuoteView({ status: 'error', key: currentKey, code });
        }
      }
    }, 380);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey, nonce, chainId, orderAddress, isSol]);

  // The countdown only runs while a quote is on screen and idle. When it
  // expires, a NEW quote is requested. The old one is never executed.
  useEffect(() => {
    if (quoteView.status !== 'ok') return undefined;
    const id = setInterval(() => {
      const n = Date.now();
      setClock(n);
      if (isQuoteStale(quoteView.fetchedAt, n, SPOT_QUOTE_MAX_AGE_MS)) setNonce((x) => x + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [quoteView.status, quoteView.fetchedAt]);

  const quoteMatches = quoteView.key === currentKey && quoteView.status === 'ok';
  const quoteFresh = quoteMatches && !isQuoteStale(quoteView.fetchedAt, clock, SPOT_QUOTE_MAX_AGE_MS);
  const quote = quoteMatches ? quoteView.quote : null;
  const quoteAgeSec = quoteMatches ? Math.max(0, Math.floor((clock - quoteView.fetchedAt) / 1000)) : null;
  const quoteLeftSec = quoteMatches ? Math.max(0, Math.ceil((quoteView.fetchedAt + SPOT_QUOTE_MAX_AGE_MS - clock) / 1000)) : null;

  /* ─── order gating: the reasons are shown, in order, to the user ──────── */
  const blockers = [];
  if (!connected) blockers.push('WALLET_NOT_CONNECTED');
  else if (walletOnOtherChain) blockers.push('WRONG_NETWORK');
  if (slipLevel === 'invalid') blockers.push('SLIPPAGE_INVALID');
  if (!amountParse.ok) blockers.push(amountParse.code);
  else if (availableWei !== null && amountParse.wei > availableWei) blockers.push('INSUFFICIENT_BALANCE');
  if (amountParse.ok && slipLevel !== 'invalid') {
    if (quoteView.status === 'error' && quoteView.key === currentKey) blockers.push(quoteView.code);
    else if (!quoteFresh) blockers.push('QUOTE_LOADING');
  }
  const canReview = blockers.length === 0;

  /* ─── review and submit ───────────────────────────────────────────────── */
  const [reviewing, setReviewing] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState(null);
  const [outcome, setOutcome] = useState(null); // { status, code?, hash?, detail? }
  const [connectOpen, setConnectOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');

  const openReview = () => {
    if (!canReview || !quote || !fromToken || !toToken) return;
    haptic?.('medium');
    setOutcome(null);
    setSnapshot({
      side,
      quote,
      fetchedAt: quoteView.fetchedAt,
      slippage: slipNum,
      fromToken,
      toToken,
      amountText: amountNorm
    });
    setReviewing(true);
  };

  /*
   * THE ONLY PLACE `confirmed: true` IS PASSED. It is reached from the
   * «تایید و ارسال» button inside the review sheet and from nowhere else.
   */
  const onConfirm = async () => {
    if (!snapshot || submitting) return;
    if (isSol) {
      if (!solAddress) {
        setOutcome({ status: SPOT_STATUS.BLOCKED, code: 'WALLET_NOT_CONNECTED' });
        setReviewing(false);
        return;
      }
    } else if (Number(wallet.chainId) !== Number(chainId)) {
      setOutcome({ status: SPOT_STATUS.BLOCKED, code: 'WRONG_NETWORK' });
      setReviewing(false);
      return;
    }
    setSubmitting(true);
    setStage('preparing');
    setOutcome({ status: 'working' });
    haptic?.('medium');

    let recordId = null;

    if (isSol) {
      const parsed = parseAmountWei(snapshot.amountText, snapshot.fromToken.decimals);
      if (!parsed.ok) {
        setOutcome({ status: SPOT_STATUS.BLOCKED, code: parsed.code });
        setSubmitting(false);
        setStage(null);
        setReviewing(false);
        return;
      }
      const result = await runSolanaSpotOrder({
        confirmed: true,
        reviewed: snapshot,
        context: { address: solAddress, amountWei: parsed.wei },
        onStage: (s, extra) => {
          setStage(s);
          // Recorded at SIGNING, so the history shows «در حال اجرا» while the
          // wallet prompt is up — the same choice the Solana swap screen made.
          if (s === 'signing' && !recordId) {
            recordId = recordSwap({
              network: 'solana',
              chainId: null,
              chainName: cfg?.name ?? null,
              from: snapshot.amountText,
              fromSymbol: snapshot.fromToken.symbol,
              to: formatWeiFloor(snapshot.quote.minOutWei, snapshot.toToken.decimals, 6),
              toSymbol: snapshot.toToken.symbol,
              amountIn: Number(snapshot.amountText),
              amountOut: Number(formatWeiFloor(snapshot.quote.amountOutWei, snapshot.toToken.decimals, 6)),
              txHash: extra?.hash ?? null,
              status: 'pending',
              source: 'spot'
            }).id;
          }
        }
      });

      if (recordId) {
        if (result.status === SPOT_STATUS.CONFIRMED) confirmSwap(recordId, result.hash);
        else if (result.status === SPOT_STATUS.CANCELLED) cancelSwap(recordId, result.code);
        else failSwap(recordId, result.code ?? 'TX_FAILED');
      }

      setSubmitting(false);
      setStage(null);
      setReviewing(false);
      setOutcome(result);
      setBalanceNonce((n) => n + 1);
      if (result.status === SPOT_STATUS.CONFIRMED) {
        haptic?.('success');
        setAmountText('');
      } else {
        haptic?.('error');
      }
      if (result.status === SPOT_STATUS.STALE || result.code === 'QUOTE_EXPIRED') setNonce((n) => n + 1);
      return;
    }

    let signer = null;
    let provider = null;
    try {
      signer = (await wallet.ensureSigner?.()) ?? wallet.getSigner?.() ?? null;
      provider = await wallet.getReadProvider(chainId);
    } catch {
      signer = null;
    }
    if (!signer) {
      setSubmitting(false);
      setReviewing(false);
      setStage(null);
      setOutcome({ status: SPOT_STATUS.FAILED, code: 'WALLET_NOT_CONNECTED' });
      return;
    }

    const result = await runSpotOrder({
      confirmed: true,
      reviewed: snapshot,
      context: { signer, provider, chainId, owner: wallet.address, deadlineMinutes: DEFAULT_DEADLINE_MIN },
      deps: { getQuote, needsApproval, approveToken, executeSwap },
      onStage: (s, extra) => {
        setStage(s);
        if (s === 'pending' && extra?.hash && !recordId) {
          recordId = recordSwap({
            network: 'evm',
            chainId,
            chainName: cfg?.name ?? null,
            from: snapshot.amountText,
            fromSymbol: snapshot.fromToken.symbol,
            to: formatWeiFloor(snapshot.quote.minOutWei, snapshot.toToken.decimals, 6),
            toSymbol: snapshot.toToken.symbol,
            amountIn: Number(snapshot.amountText),
            amountOut: Number(formatWeiFloor(snapshot.quote.amountOutWei, snapshot.toToken.decimals, 6)),
            txHash: extra.hash,
            status: 'pending',
            source: 'spot'
          }).id;
        }
      }
    });

    if (recordId) {
      if (result.status === SPOT_STATUS.CONFIRMED) confirmSwap(recordId, result.hash);
      else if (result.status === SPOT_STATUS.CANCELLED) cancelSwap(recordId, result.code);
      else failSwap(recordId, result.code ?? 'TX_FAILED');
    }

    setSubmitting(false);
    setStage(null);
    setReviewing(false);
    setOutcome(result);
    setBalanceNonce((n) => n + 1);
    if (result.status === SPOT_STATUS.CONFIRMED) {
      haptic?.('success');
      setAmountText('');
    } else {
      haptic?.('error');
    }
    // A price that moved, or an expired quote, is fetched again at once.
    if (result.status === SPOT_STATUS.STALE || result.code === 'QUOTE_EXPIRED') setNonce((n) => n + 1);
  };

  /* ─── helpers for display ─────────────────────────────────────────────── */
  const pick = (tk) => {
    setAssetSym(tk.symbol);
    setPickerOpen(false);
    setQuery('');
    haptic?.('select');
  };
  const setPercent = (pct) => {
    if (availableWei === null || !fromToken) return;
    const wei = (availableWei * BigInt(pct)) / 100n;
    setAmountText(formatWeiFloor(wei, fromToken.decimals, fromToken.decimals));
    haptic?.('select');
  };
  const explorer = outcome?.hash ? (isSol ? solanaTxLink(outcome.hash) : explorerTx(chainId, outcome.hash)) : null;
  const assetInfo = asset ? markets?.find((c) => c.id === asset.coingeckoId) : null;
  const impact = quoteMatches ? quoteView.impact : null;
  const impactTier = impactLevel(impact);
  const fromDec = fromToken?.decimals ?? 18;
  const toDec = toToken?.decimals ?? 18;
  const feeBps = quote?.feeBps ?? 0;
  const priceFor = (tk) => {
    const c = markets?.find((m) => m.id === tk.coingeckoId);
    return c ? { price: c.price, change24h: c.change24h } : null;
  };
  const blockerKey = blockers[0];
  const blockerText = blockerKey
    ? blockerKey === 'INSUFFICIENT_BALANCE'
      ? t('spot.err.INSUFFICIENT_BALANCE')
      : blockerKey === 'TOO_MANY_DECIMALS'
        ? t(errorKey(blockerKey), { decimals: fromDec })
        : blockerKey === 'QUOTE_LOADING'
          ? t('spot.quoteLoading')
          : t(errorKey(blockerKey))
    : null;

  const reduce = Boolean(reduceMotion);
  const enter = reduce ? {} : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.18 } };

  /* ─── render ──────────────────────────────────────────────────────────── */
  const shell = (
    <>
      <div className="spot-mode" role="tablist" aria-label={t('spot.modeLabel')}>
        <button type="button" role="tab" aria-selected={mode === 'real'} className={`spot-mode-tab${mode === 'real' ? ' is-active' : ''}`} onClick={() => setMode('real')}>
          {mode === 'real' && <SegIndicator id="spot-mode-ind" />}
          <span className="spot-mode-ico" aria-hidden="true">
            <IconWallet width={18} height={18} />
          </span>
          <span>{t('spot.mode.real')}</span>
        </button>
        <button type="button" role="tab" aria-selected={mode === 'paper'} className={`spot-mode-tab${mode === 'paper' ? ' is-active' : ''}`} onClick={() => setMode('paper')}>
          {mode === 'paper' && <SegIndicator id="spot-mode-ind" />}
          <span className="spot-mode-ico" aria-hidden="true">
            <IconShield width={18} height={18} />
          </span>
          <span>{t('spot.mode.paper')}</span>
        </button>
      </div>

      {mode === 'paper' ? (
        <section className="spot-paper" aria-label={t('spot.mode.paper')}>
          <p className="spot-paper-badge"><IconInfo width={14} height={14} aria-hidden="true" /> {t('spot.paperBanner')}</p>
          <Trade embedded />
        </section>
      ) : (
        <div className="spot-grid">
          <aside className="spot-market-col" aria-label={t('spot.market.title')}>
            <h2 className="spot-h2">{t('spot.market.title')}</h2>
            <SpotMarketList
              chainId={isSol ? 'solana' : chainId}
              tokens={assetChoices}
              activeSymbol={asset?.symbol}
              priceFor={priceFor}
              balanceFor={balanceFor}
              connected={connected}
              query={query}
              onQuery={setQuery}
              onPick={pick}
              ariaLabel={t('spot.market.title')}
            />
          </aside>

          <section className="spot-form-col" aria-label={t('spot.form.title')}>
            <div className="spot-card spot-ticket">
              {/* network */}
              <div className="spot-field">
                <label className="spot-label" htmlFor="spot-chain">{t('spot.network')}</label>
                <div className="spot-select-wrap">
                  <span className="spot-select-ico" aria-hidden="true">
                    <AssetIcon chain={isSol ? 'solana' : chainId} size={22} />
                  </span>
                  <select
                    id="spot-chain"
                    className="spot-select"
                    value={String(chainId)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setChainId(v === SOLANA_SPOT_ID ? SOLANA_SPOT_ID : Number(v));
                      setQuoteSym(null);
                      setAssetSym(null);
                      setAmountText('');
                      setOutcome(null);
                    }}
                  >
                    {SPOT_CHAINS.map((id) => (
                      <option key={id} value={id}>{EVM_CHAINS[id].name}</option>
                    ))}
                    <option value={SOLANA_SPOT_ID}>{SOLANA_SPOT_CHAIN.name}</option>
                  </select>
                  <Caret />
                </div>
              </div>

              {/* wallet state: connect, or the wrong network */}
              {!connected && (
                <div className="spot-card spot-notice is-info" role="status">
                  <strong>{t('spot.connectCard.title')}</strong>
                  <p>{t('spot.connectCard.body')}</p>
                  <button type="button" className="spot-btn spot-btn-primary" onClick={() => setConnectOpen(true)}>
                    {wallet.locked ? t('wallet.unlock') : t('wallet.connect')}
                  </button>
                </div>
              )}
              {walletOnOtherChain && (
                <div className="spot-card spot-notice is-warn" role="alert">
                  <strong>{t('spot.wrongNetwork.title')}</strong>
                  <p>
                    {t('spot.wrongNetwork.body', {
                      wallet: EVM_CHAINS[wallet.chainId]?.name ?? String(wallet.chainId),
                      order: cfg?.name ?? ''
                    })}
                  </p>
                  <button
                    type="button"
                    className="spot-btn spot-btn-ghost"
                    onClick={() => wallet.switchChain?.(chainId).catch(() => {})}
                  >
                    {t('spot.wrongNetwork.switch', { network: cfg?.name ?? '' })}
                  </button>
                </div>
              )}

              {/* side + pair */}
              <div className="spot-side" role="group" aria-label={t('spot.side.label')}>
                {['buy', 'sell'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={side === s}
                    className={`spot-side-btn is-${s}${side === s ? ' is-active' : ''}`}
                    onClick={() => {
                      setSide(s);
                      setAmountText('');
                      haptic?.('select');
                    }}
                  >
                    {side === s && (
                      <SegIndicator
                        id="spot-side-ind"
                        style={{ background: s === 'buy' ? 'linear-gradient(90deg, var(--up), var(--rgb-1))' : 'linear-gradient(90deg, var(--down), var(--rgb-4))' }}
                      />
                    )}
                    <span>{t(`spot.side.${s}`)}</span>
                  </button>
                ))}
              </div>

              <div className="spot-pair">
                <button type="button" className="spot-asset-btn spot-picker-btn" onClick={() => setPickerOpen(true)}>
                  <AssetIcon symbol={asset?.symbol ?? '?'} chain={isSol ? 'solana' : chainId} size={28} />
                  <span className="spot-asset-text">
                    <span className="spot-asset-sym" dir="ltr">{asset?.symbol ?? '—'}</span>
                    <span className="spot-asset-name">{asset?.name ?? ''}</span>
                  </span>
                  {assetInfo?.price != null && (
                    <span className="mono spot-asset-price" dir="ltr">{fmtUsd(assetInfo.price)}</span>
                  )}
                  <Caret />
                </button>
                <div className="spot-field spot-quote-field">
                  <label className="spot-label" htmlFor="spot-quote">{t('spot.quoteAsset')}</label>
                  <div className="spot-select-wrap">
                    <span className="spot-select-ico" aria-hidden="true">
                      <AssetIcon symbol={quoteAsset?.symbol ?? '?'} size={22} />
                    </span>
                    <select
                      id="spot-quote"
                      className="spot-select"
                      value={quoteAsset?.symbol ?? ''}
                      onChange={(e) => {
                        setQuoteSym(e.target.value);
                        setAmountText('');
                      }}
                    >
                      {tokens
                        .filter((tk) => !asset || tk.symbol !== asset.symbol)
                        .map((tk) => (
                          <option key={tk.symbol} value={tk.symbol}>{tk.symbol}</option>
                        ))}
                    </select>
                    <Caret />
                  </div>
                </div>
              </div>

              {/* amount */}
              <div className="spot-field">
                <label className="spot-label" htmlFor="spot-amount">
                  {t('spot.payAmount', { symbol: fromToken?.symbol ?? '' })}
                </label>
                <div className="spot-amount-row">
                  <span className="spot-amount-ico" aria-hidden="true">
                    <AssetIcon symbol={fromToken?.symbol ?? '?'} size={26} />
                  </span>
                  <input
                    id="spot-amount"
                    className="spot-input spot-amount-input mono"
                    dir="ltr"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.0"
                    value={amountText}
                    aria-invalid={!amountParse.ok && amountText.trim() !== ''}
                    aria-describedby="spot-amount-hint"
                    onChange={(e) => setAmountText(e.target.value.replace(',', '.'))}
                  />
                  <span className="spot-amount-sym" dir="ltr">{fromToken?.symbol ?? ''}</span>
                </div>
                <div className="spot-pct" role="group" aria-label={t('spot.percentLabel')}>
                  {PERCENTS.map((p) => (
                    <button key={p} type="button" className="spot-chip" disabled={availableWei === null || availableWei <= 0n} onClick={() => setPercent(p)}>
                      {p === 100 ? t('swap.max') : `${p}%`}
                    </button>
                  ))}
                </div>
                <div id="spot-amount-hint" className="spot-hint">
                  {t('spot.balance')}:{' '}
                  <span dir="ltr" className="mono">
                    {fromBal === undefined
                      ? '…'
                      : fromBal === null
                        ? t('spot.balanceUnavailable')
                        : balancesHidden()
                          ? '•••'
                          : `${fromBal.formatted} ${fromToken?.symbol ?? ''}`}
                  </span>
                  {amountText.trim() !== '' && !amountParse.ok && (
                    <span className="spot-error"> · {t(errorKey(amountParse.code), { decimals: fromDec })}</span>
                  )}
                </div>
              </div>

              {/* estimate */}
              <div className="spot-card spot-estimate" aria-live="polite">
                <div className="spot-estimate-head">
                  <span className="spot-muted">{t('spot.receiveEstimate')}</span>
                  <span className="spot-big mono" dir="ltr">
                    {quote && quoteFresh
                      ? `${formatWeiFloor(quote.amountOutWei, toDec, 6)} ${toToken?.symbol ?? ''}`
                      : quoteView.status === 'error' && quoteView.key === currentKey
                        ? '—'
                        : '…'}
                  </span>
                </div>
                {quote && (
                  <dl className="spot-dl">
                    <div><dt>{t('swap.minReceived')}</dt><dd dir="ltr" className="mono">{formatWeiFloor(quote.minOutWei, toDec, 6)} {toToken?.symbol}</dd></div>
                    <div><dt>{t('spot.platformFee', { pct: (feeBps / 100).toFixed(2) })}</dt><dd dir="ltr" className="mono">{feeBps && quote.platformFeeWei != null ? `${formatWeiFloor(quote.platformFeeWei, fromDec, 6)} ${fromToken?.symbol}` : '—'}</dd></div>
                    <div><dt>{t('swap.networkFee')}</dt><dd dir="ltr" className="mono">{quoteView.gasCost != null ? `≈ ${Number(quoteView.gasCost).toPrecision(3)} ${cfg?.native?.symbol ?? ''}` : '…'}</dd></div>
                    <div><dt>{t('swap.route')}</dt><dd dir="ltr">{routeText(t, quote, fromToken, toToken)}</dd></div>
                  </dl>
                )}
                {impactTier && (
                  <p className={`spot-notice-line ${impactTier === 'high' ? 'is-bad' : 'is-warn'}`} role="status">
                    <strong>⚠ {t('spot.impact.title')}</strong> {t(impactTier === 'high' ? 'spot.impact.high' : 'spot.impact.warn', { pct: Number(impact).toFixed(2) })}
                  </p>
                )}
                {quoteView.status === 'error' && quoteView.key === currentKey && (
                  <p className="spot-notice-line is-bad" role="alert">{errorText(t, quoteView.code)}</p>
                )}
                <div className="spot-freshness">
                  <span className="spot-muted">
                    {!amountParse.ok || slipLevel === 'invalid'
                      ? ''
                      : quoteFresh
                        ? t('spot.quoteRefreshIn', { s: quoteLeftSec })
                        : quoteMatches
                          ? t('spot.quoteExpired')
                          : t('spot.quoteLoading')}
                    {quoteFresh && quoteAgeSec != null && <> · {t('spot.quoteAge', { s: quoteAgeSec })}</>}
                  </span>
                  <button type="button" className="spot-btn-link" onClick={() => setNonce((n) => n + 1)} disabled={!amountParse.ok}>
                    <IconRefresh width={14} height={14} aria-hidden="true" /> {t('spot.refreshQuote')}
                  </button>
                </div>
              </div>

              {/* slippage */}
              <div className="spot-field">
                <span className="spot-label" id="spot-slip-label">{t('swap.slippage')}</span>
                <div className="spot-pct" role="group" aria-labelledby="spot-slip-label">
                  {SLIPPAGE_PRESETS.map((p) => (
                    <button key={p} type="button" className={`spot-chip${slipNum === p ? ' is-active' : ''}`} aria-pressed={slipNum === p} onClick={() => setSlippageText(String(p))}>
                      {p}%
                    </button>
                  ))}
                  <label className="spot-slip-custom">
                    <span className="sr-only">{t('swap.slippage')}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      className={`spot-input spot-slip-input mono${slipLevel === 'invalid' ? ' is-invalid' : ''}`}
                      value={slippageText}
                      onChange={(e) => setSlippageText(e.target.value.replace(',', '.'))}
                      aria-invalid={slipLevel === 'invalid'}
                    />
                    <span>%</span>
                  </label>
                </div>
                {slipLevel === 'invalid' && <p className="spot-error">{t('spot.slippageInvalid')}</p>}
                {slipLevel === 'high' && <p className="spot-notice-line is-bad" role="status">{t('spot.slippageHigh')}</p>}
              </div>

              {/* the single action */}
              <div className="spot-cta-wrap">
                <button
                  type="button"
                  className={`spot-cta ${side === 'buy' ? 'is-buy' : 'is-sell'}`}
                  disabled={!canReview || submitting}
                  onClick={openReview}
                >
                  {t('spot.reviewOrder')}
                </button>
                {!canReview && blockerText && <p className="spot-hint" role="status">{blockerText}</p>}
              </div>

              {/* outcome of the last attempt */}
              {outcome && outcome.status !== 'blocked' && (
                <OutcomeCard t={t} outcome={outcome} stage={stage} explorer={explorer} />
              )}
              {outcome?.status === SPOT_STATUS.BLOCKED && (
                <p className="spot-error" role="alert">{errorText(t, outcome.code)}</p>
              )}
            </div>

            <div className="spot-disclaimers">
              <p>{t('spot.notice.own')}</p>
              <p>{t('spot.notice.price')}</p>
              <p>{t('spot.notice.gas')}</p>
            </div>

            <div className="spot-history">
              <SwapHistoryPanel network={isSol ? 'solana' : 'evm'} limit={12} source="spot" />
            </div>
          </section>
        </div>
      )}

      {/* market list as a sheet on phones */}
      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title={t('spot.market.sheetTitle')}>
        <SpotMarketList
          chainId={isSol ? 'solana' : chainId}
          tokens={assetChoices}
          activeSymbol={asset?.symbol}
          priceFor={priceFor}
          balanceFor={balanceFor}
          connected={connected}
          query={query}
          onQuery={setQuery}
          onPick={pick}
          ariaLabel={t('spot.market.sheetTitle')}
        />
      </Sheet>

      {/* the review: the ONLY screen with the confirm button */}
      <Sheet open={reviewing} onClose={() => { if (!submitting) setReviewing(false); }} title={t('spot.review.title')}>
        {snapshot && (
          <ReviewBody
            t={t}
            snap={snapshot}
            side={side}
            chainName={cfg?.name ?? ''}
            nativeSymbol={cfg?.native?.symbol ?? ''}
            gasCost={quoteView.gasCost}
            impact={quoteView.impact}
            owner={isSol ? solAddress : wallet.address}
            fresh={!isQuoteStale(snapshot.fetchedAt, clock, SPOT_QUOTE_MAX_AGE_MS)}
            submitting={submitting}
            stage={stage}
            onConfirm={onConfirm}
            onBack={() => setReviewing(false)}
          />
        )}
      </Sheet>

      <WalletConnectSheet open={connectOpen && !isSol} onClose={() => setConnectOpen(false)} />
      <SolanaConnectSheet open={connectOpen && isSol} onClose={() => setConnectOpen(false)} />
    </>
  );

  return (
    <motion.div className="spot-root" {...enter} data-testid="spot-trade">
      {shell}
    </motion.div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────────── */

function amountParseWei(text) {
  const r = parseAmountWei(String(text ?? ''), 18);
  return r.ok ? r.wei : null;
}

/** The route as the user reads it: the pair and how many router hops it takes. */
function routeText(t, quote, fromTk, toTk) {
  if (!quote || !fromTk || !toTk) return '—';
  return t('spot.route.value', { from: fromTk.symbol, to: toTk.symbol, hops: Number(quote.hops ?? 1) });
}

/** An error code → sentence. Unknown codes fall back to the generic line. */
function errorText(t, code) {
  return t(errorKey(code), { defaultValue: t('spot.err.TX_FAILED') });
}

function OutcomeCard({ t, outcome, stage, explorer }) {
  const view = OUTCOME_VIEW[outcome.status] ?? OUTCOME_VIEW.failed;
  const Icon = view.Icon;
  const text = outcome.status === 'working'
    ? t(STAGE_KEY[stage] ?? 'spot.status.preparing')
    : t(view.key);
  return (
    <div className={`spot-card spot-outcome ${view.cls}`} role="status" aria-live="polite">
      <div className="spot-outcome-head">
        <Icon width={18} height={18} aria-hidden="true" />
        <strong>{text}</strong>
      </div>
      {outcome.status === 'failed' && outcome.code && <p>{errorText(t, outcome.code)}</p>}
      {outcome.status === 'stale' && outcome.code && <p>{errorText(t, outcome.code)}</p>}
      {explorer && (
        <a className="spot-btn-link" href={explorer} target="_blank" rel="noopener noreferrer">
          {t('swap.viewOnExplorer')}
        </a>
      )}
    </div>
  );
}

function ReviewBody({ t, snap, side, chainName, nativeSymbol, gasCost, impact, owner, fresh, submitting, stage, onConfirm, onBack }) {
  const q = snap.quote;
  const toDec = snap.toToken.decimals;
  const fromDec = snap.fromToken.decimals;
  const impactTier = impactLevel(impact);
  const actionToken = side === 'buy' ? snap.toToken.symbol : snap.fromToken.symbol;
  const rows = [
    [t('spot.review.action'), `${t(`spot.side.${side}`)} ${actionToken}`],
    [t('swap.youPay'), `${snap.amountText} ${snap.fromToken.symbol}`],
    [t('swap.youReceive'), `${formatWeiFloor(q.amountOutWei, toDec, 6)} ${snap.toToken.symbol}`],
    [t('swap.minReceived'), `${formatWeiFloor(q.minOutWei, toDec, 6)} ${snap.toToken.symbol}`],
    [t('swap.slippage'), `${snap.slippage}%`],
    [t('spot.platformFee', { pct: ((q.feeBps ?? 0) / 100).toFixed(2) }), q.platformFeeWei != null && q.feeBps ? `${formatWeiFloor(q.platformFeeWei, fromDec, 6)} ${snap.fromToken.symbol}` : '—'],
    [t('swap.networkFee'), gasCost != null ? `≈ ${Number(gasCost).toPrecision(3)} ${nativeSymbol}` : t('spot.networkFeeUnknown')],
    [t('swap.route'), routeText(t, q, snap.fromToken, snap.toToken)],
    [t('swap.network'), chainName]
  ];
  return (
    <div className="spot-review">
      <dl className="spot-dl spot-dl-review">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd dir="ltr" className="mono">{v}</dd>
          </div>
        ))}
        <div>
          <dt>{t('swap.recipient')}</dt>
          <dd dir="ltr" className="mono" title={owner ?? ''}>{owner ? `${owner.slice(0, 6)}…${owner.slice(-4)}` : '—'}</dd>
        </div>
      </dl>
      {impactTier && (
        <p className={`spot-notice-line ${impactTier === 'high' ? 'is-bad' : 'is-warn'}`} role="status">
          {t(impactTier === 'high' ? 'spot.impact.high' : 'spot.impact.warn', { pct: Number(impact).toFixed(2) })}
        </p>
      )}
      <div className="spot-disclaimers">
        <p>{t('spot.notice.own')}</p>
        <p>{t('spot.notice.price')}</p>
        <p>{t('spot.notice.gas')}</p>
      </div>
      {!fresh && <p className="spot-notice-line is-warn" role="status">{t('spot.quoteExpiredReview')}</p>}
      {submitting && <p className="spot-muted" role="status">{t(STAGE_KEY[stage] ?? 'spot.status.preparing')}</p>}
      <div className="spot-review-actions">
        <button type="button" className="spot-btn spot-btn-ghost" onClick={onBack} disabled={submitting}>{t('spot.review.back')}</button>
        <button type="button" className="spot-btn spot-btn-confirm" disabled={!fresh || submitting} onClick={onConfirm}>
          {t('spot.review.confirm')}
        </button>
      </div>
    </div>
  );
}
