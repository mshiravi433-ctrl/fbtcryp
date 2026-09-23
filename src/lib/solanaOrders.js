/**
 * Local Solana swap handoffs.
 *
 * These are NOT price-watched orders. `createOrder` requires an integer
 * chainId, and the server watcher prices CoinGecko ids — a Solana mint has
 * neither. Saving one here only remembers the pair so the swap screen can be
 * opened with it filled in. Nothing in this file claims a fill.
 */
const KEY = 'fbt.solanaOrders.v1';

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((row) => row && row.id && row.fromMint && row.toMint) : [];
  } catch {
    return [];
  }
}

function writeAll(rows) {
  localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 40)));
  return rows.slice(0, 40);
}

export function loadSolanaHandoffs() {
  return readAll();
}

export function addSolanaHandoff(input) {
  const amountIn = String(input?.amountIn ?? '').trim();
  const fromMint = String(input?.fromMint || '');
  const toMint = String(input?.toMint || '');
  if (!(Number(amountIn) > 0)) return { error: 'BAD_AMOUNT' };
  if (!fromMint || !toMint || fromMint === toMint) return { error: 'SAME_TOKEN' };
  const order = {
    id: `sol-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    network: 'solana',
    fromMint,
    toMint,
    fromSymbol: String(input.fromSymbol || ''),
    toSymbol: String(input.toSymbol || ''),
    fromIcon: input.fromIcon || null,
    toIcon: input.toIcon || null,
    amountIn,
    side: 'sell',
    createdAt: Date.now(),
    watched: false
  };
  const orders = writeAll([order, ...readAll().filter((row) => row.id !== order.id)]);
  return { order, orders };
}

export function removeSolanaHandoff(id) {
  return writeAll(readAll().filter((row) => row.id !== id));
}
