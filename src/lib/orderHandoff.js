/** Pure routing only: signing and transaction submission remain in Swap. */
export function findExecutableOrder(orders, id) {
  if (!id) return null;
  return orders.find((order) => String(order.id) === id && order.status === 'active') || null;
}

export function orderSwapParams(order, defaults = []) {
  const params = new URLSearchParams({
    from: order.fromToken.symbol,
    to: order.toToken.symbol,
    amount: order.amountIn,
    chain: String(order.chainId),
    fromOrder: String(order.id)
  });
  for (const side of ['from', 'to']) {
    const address = order[`${side}Token`]?.address;
    if (/^0x[a-fA-F0-9]{40}$/.test(address || '') &&
        !defaults.some((token) => token.address?.toLowerCase() === address.toLowerCase())) {
      params.set(`${side}Address`, address);
    }
  }
  return params;
}
