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
import IntentAIPanel from './IntentAIPanel';

/** Deterministic, URL-safe positive number formatting. */
const cleanAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
};

/**
 * Where a prepared draft should be reviewed. The swap screen can only review
 * a swap PAIR, the bridge screen a token + two chains, and everything else
 * (deposit/borrow/lend/custom) becomes an Intent OS compose prefill. An
 * unknown or same-symbol pair never goes to /swap — it would arrive as a
 * dead USDT → USDT quote.
 */
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
  /* Lending / send / custom legs have no venue screen yet: prefill compose. */
  const params = new URLSearchParams({ tab: 'compose' });
  if (order.fromSymbol) params.set('from', order.fromSymbol);
  if (order.toSymbol && order.toSymbol !== order.fromSymbol) params.set('to', order.toSymbol);
  if (order.chainId) params.set('chain', String(order.chainId));
  return `/intent?${params.toString()}`;
}

export default function IntentAIRoute(props) {
  const wallet = useWallet();
  const navigate = useNavigate();

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

  return <IntentAIPanel {...props} onDraftReady={onDraftReady} walletRuntime={walletRuntime} />;
}
