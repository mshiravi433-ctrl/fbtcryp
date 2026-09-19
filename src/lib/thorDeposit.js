import { checkDestination, chainOf } from './thorAddress.js';

export const thorRequestKey = ({ from, to, amount, destination }) =>
  JSON.stringify([from, to, amount, String(destination ?? '').trim()]);

/** Keep a margin for copy/switch-wallet time. This is not a vault liveness check. */
export function thorDepositState(quote, request, now = Date.now()) {
  if (checkDestination(request.destination, request.to) !== 'ok') return 'destination';
  if (!quote || quote.requestKey !== thorRequestKey(request)) return 'stale';
  if (!Number.isFinite(Number(quote.expiry)) || Number(quote.expiry) * 1000 <= now + 30_000) return 'expired';
  if (!quote.inbound_address || !quote.memo) return 'incomplete';
  // The quote must actually encode the receiver we asked for; no price-only memo.
  const [operation, , receiver] = String(quote.memo).split(':');
  const evm = ['ETH', 'BSC', 'AVAX', 'BASE'].includes(chainOf(request.to));
  const dest = request.destination.trim();
  const matches = evm ? receiver?.toLowerCase() === dest.toLowerCase() : receiver === dest;
  if (!['=', 's', 'SWAP'].includes(operation) || !matches) return 'mismatch';
  return 'ready';
}

export function thorSourceKind(asset) {
  const chain = chainOf(asset);
  if (['BTC', 'BCH', 'LTC', 'DOGE'].includes(chain)) return 'utxo';
  if (['ETH', 'BSC', 'AVAX', 'BASE'].includes(chain)) return 'evm';
  if (chain === 'GAIA') return 'cosmos';
  return 'other';
}
