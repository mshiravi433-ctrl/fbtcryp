/**
 * Route wrapper for the Intent AI panel.
 * -----------------------------------------------------------------------
 * Phase 51: the panel itself stays free of wallet-library imports (it is
 * mounted headless by the test suite), so the CONNECTED wallet is handed to it
 * here as a plain EIP-1193 runtime: { provider, account, chainId, connected }.
 *
 * When nothing is connected this is `null` — and the panel then reports an
 * honest "wallet signature required" instead of signing with a stand-in.
 *
 * Phase 153b: this wrapper is also where the chat's draft hand-off gets its
 * legs. The panel renders an "Open in swap screen" button ONLY when an
 * `onDraftReady` callback is passed — and nothing passed one, so in the real
 * app the button never existed and a confirmed plan had nowhere to go. The
 * panel stays router-free (it also mounts headless); navigation lives here.
 */
import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import useIntentBroadcast from '../hooks/useIntentBroadcast';
import { useMultiChainPortfolio } from '../hooks/useMultiChainPortfolio';
import IntentAIPanel from './IntentAIPanel';

/** Deterministic, URL-safe positive number formatting. */
const cleanAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
};

/**
 * Where a prepared draft should be reviewed. The swap screen can only review
 * a swap PAIR, the bridge screen a token + two chains. Every other kind ALSO
 * has a real destination inside the app — the farm, lending, futures, send
 * and wallet screens — so a confirmed plan never dead-ends in the chat:
 *
 *   swap   → /swap?from=…&to=…&amount=…&chain=…
 *   bridge → /bridge?fromChain=…&toChain=…&token=…&amount=…
 *   futures_*           → /perp?tab=onchain&market=…&side=…&collateral=…&leverage=…
 *                         (Futures Engine v3: the On-Chain tab pre-fills the
 *                         draft and the user still walks the review → confirm
 *                         → sign gate there; a URL never executes anything)
 *   farm_*              → /farm
 *   lend, borrow, repay → /loan
 *   send                → /wallet?tab=send
 *   anything else       → /intent compose prefill
 *
 * An unknown or same-symbol pair never goes to /swap — it would arrive as a
 * dead USDT → USDT quote.
 */
const VENUE_ROUTES = Object.freeze({
  futures_open: '/perp?tab=onchain',
  futures_close: '/perp?tab=onchain&panel=positions',
  farm_deposit: '/farm',
  farm_withdraw: '/farm',
  lend_supply: '/loan',
  lend_withdraw: '/loan',
  borrow: '/loan',
  repay: '/loan'
});
export function draftHandoffRoute({ plan, drafts } = {}) {
  const first = Array.isArray(drafts) && drafts.length
    ? (drafts.find((d) => d?.order?.kind === 'swap') || drafts.find((d) => d?.order) || null)
    : null;
  const order = first?.order || null;
  if (!order) return null;

  const amount = cleanAmount(order.amountIn);
  if (order.kind === 'swap' && order.fromSymbol && order.toSymbol && order.fromSymbol !== order.toSymbol) {
    const params = new URLSearchParams();
    params.set('from', order.fromSymbol);
    params.set('to', order.toSymbol);
    if (amount) params.set('amount', amount);
    if (order.chainId) params.set('chain', String(order.chainId));
    return `/swap?${params.toString()}`;
  }
  if (order.kind === 'bridge') {
    /* The draft drops the destination chain; the plan step still has it. */
    const bridgeStep = (Array.isArray(plan?.steps) ? plan.steps : [])
      .find((s) => s?.action === 'bridge' && s?.fromChain && s?.toChain);
    const params = new URLSearchParams();
    if (bridgeStep) {
      params.set('fromChain', String(bridgeStep.fromChain));
      params.set('toChain', String(bridgeStep.toChain));
    } else if (order.chainId) {
      params.set('fromChain', String(order.chainId));
    }
    if (order.fromSymbol) params.set('token', order.fromSymbol);
    if (amount) params.set('amount', amount);
    return `/bridge?${params.toString()}`;
  }
  /*
   * Futures drafts carry the leg the chat resolved (market, side, collateral,
   * leverage). Handing them over as query params means the On-Chain tab opens
   * on the right market with the same numbers — and nothing more: the quote,
   * the fee breakdown and the risk verdict are re-derived by the backend
   * there, and the user confirms before any signature.
   */
  if (order.kind === 'futures_open') {
    const params = new URLSearchParams({ tab: 'onchain' });
    if (order.fromSymbol && order.fromSymbol !== 'USDC' && order.fromSymbol !== 'USD') params.set('market', order.fromSymbol);
    else if (order.toSymbol) params.set('market', order.toSymbol);
    const side = String(order.side || order.direction || order.route?.side || '').toLowerCase();
    if (side === 'long' || side === 'short') params.set('side', side);
    const collateral = cleanAmount(order.amountUsd ?? order.amountIn);
    if (collateral) params.set('collateral', collateral);
    if (Number.isFinite(Number(order.leverage)) && Number(order.leverage) >= 1) params.set('leverage', String(order.leverage));
    return `/perp?${params.toString()}`;
  }
  /* The other executable venues have a real screen, reached by its name. */
  if (VENUE_ROUTES[order.kind]) return VENUE_ROUTES[order.kind];
  if (order.kind === 'send') {
    const sendParams = new URLSearchParams({ tab: 'send' });
    if (order.fromSymbol) sendParams.set('token', order.fromSymbol);
    if (amount) sendParams.set('amount', amount);
    return `/wallet?${sendParams.toString()}`;
  }
  /* Custom legs have no venue screen yet: prefill compose. */
  const params = new URLSearchParams({ tab: 'compose' });
  if (order.fromSymbol) params.set('from', order.fromSymbol);
  if (order.toSymbol && order.toSymbol !== order.fromSymbol) params.set('to', order.toSymbol);
  if (order.chainId) params.set('chain', String(order.chainId));
  return `/intent?${params.toString()}`;
}

export default function IntentAIRoute(props) {
  const wallet = useWallet();
  const navigate = useNavigate();
  const {
    executeIntentBroadcast,
    trackIntentTx,
    explorerUrl,
    broadcastSupportedKind
  } = useIntentBroadcast(wallet);

  const onDraftReady = useCallback((payload) => {
    const route = draftHandoffRoute(payload || {});
    if (route) navigate(route);
  }, [navigate]);

  const walletRuntime = useMemo(() => {
    if (typeof wallet?.getWalletRuntime === 'function') return wallet.getWalletRuntime();
    return null;
    // The identity of the runtime only changes with the connection itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.address, wallet?.chainId, wallet?.locked, wallet?.isConnected, wallet?.getWalletRuntime]);

  /*
   * The "✦ AI Portfolio" card on the AI page reads the SAME aggregation the
   * portfolio screen uses — one source for a number that decides plans.
   *
   * It is built here, not in the panel, for the same reason the wallet runtime
   * is: the panel must stay mountable without a wallet, a router or a provider
   * (the test suite does exactly that). And it is only asked for when a wallet
   * is actually readable, because this aggregation walks every EVM network in
   * order — running it for an anonymous visitor would be a page of RPC calls
   * whose answer nobody can use.
   *
   * `dataStatus` is what lets the card be honest: `live` prints the total,
   * anything else prints an em-dash and the reason, never a confident $0.
   */
  const canReadPortfolio = Boolean(wallet?.isConnected && wallet?.address && !wallet?.locked);
  const multi = useMultiChainPortfolio(canReadPortfolio ? wallet : null);
  const aiPortfolio = useMemo(() => {
    const holdings = (multi?.rows || [])
      .filter((r) => Number(r?.value) > 0)
      .map((r) => ({ symbol: r.symbol, valueUsd: Number(r.value), chainId: r.chainId ?? null }));
    return {
      holdings,
      totalValueUsd: Number(multi?.totalValue) || 0,
      change24hPct: null,
      dataStatus: !canReadPortfolio
        ? 'none'
        : multi?.loading
          ? 'loading'
          : holdings.length
            ? (multi?.partial ? 'partial' : 'live')
            : 'empty'
    };
  }, [multi?.rows, multi?.totalValue, multi?.partial, multi?.loading, canReadPortfolio]);

  return (
    <IntentAIPanel
      {...props}
      aiPortfolio={aiPortfolio}
      onDraftReady={onDraftReady}
      walletRuntime={walletRuntime}
      executeIntentBroadcast={executeIntentBroadcast}
      trackIntentTx={trackIntentTx}
      explorerUrl={explorerUrl}
      broadcastSupportedKind={broadcastSupportedKind}
    />
  );
}
