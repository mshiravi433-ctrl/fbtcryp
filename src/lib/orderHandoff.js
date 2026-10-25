/** Pure helpers for notification-driven auto-order handoffs. */

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function findActiveOrderById(orders, orderId) {
  if (orderId == null || String(orderId).trim() === '' || String(orderId) === 'x') return null;
  return (Array.isArray(orders) ? orders : []).find(
    (order) => String(order?.id) === String(orderId) && order?.status === 'active'
  ) ?? null;
}

/** Build a safe symbol-based handoff, with addresses for non-curated tokens. */
export function buildOrderSwapParams(order, tokensByChain = {}) {
  const params = new URLSearchParams({
    from: String(order.fromToken?.symbol ?? ''),
    to: String(order.toToken?.symbol ?? ''),
    amount: String(order.amountIn ?? ''),
    chain: String(order.chainId ?? '')
  });
  const knownTokens = tokensByChain?.[order.chainId] ?? [];
  const isCurated = (token) => knownTokens.some(
    (known) => known?.address && token?.address &&
      known.address.toLowerCase() === token.address.toLowerCase()
  );
  for (const [key, token] of [['fromAddress', order.fromToken], ['toAddress', order.toToken]]) {
    if (EVM_ADDRESS.test(String(token?.address ?? '')) && !isCurated(token)) {
      params.set(key, token.address);
    }
  }
  params.set('fromOrder', String(order.id));
  return params;
}
