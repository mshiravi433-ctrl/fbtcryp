/**
 * Solana paired swaps from transaction token-balance deltas — OBSERVED ONLY.
 *
 * A Solana signature alone proves only that a transaction touched a wallet.
 * `getTransaction` metadata, however, contains the wallet-owned SPL balances
 * immediately before and after execution. This decoder admits a row only when
 * one successful transaction changes exactly two of the wallet's mints, in
 * opposite directions, one is canonical USDC/USDT (by mint address, never by
 * symbol), and a known spot-DEX/aggregator program appears in the outer or
 * inner instructions.
 *
 * These rows are intentionally NOT a verified performance ledger yet:
 * the wallet read samples only a bounded number of recent transactions, and
 * pre/post balances net every fill in a transaction into one effect. They are
 * useful, auditable trade observations; they do not feed score, P&L,
 * qualification or consensus.
 */

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOL_SIG = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export const SOLANA_USD_QUOTES = Object.freeze({
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: Object.freeze({ symbol: 'USDC', decimals: 6 }),
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: Object.freeze({ symbol: 'USDT', decimals: 6 })
});

// Program IDs are provenance for a spot swap, not a claim that every call to
// a program is a trade — the exact two-mint balance proof below still has to
// pass. Keep this list to canonical swap programs; unknown venues fail closed.
export const SOLANA_DEX_PROGRAMS = Object.freeze({
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter v6',
  JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB: 'Jupiter v4',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM v4',
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C: 'Raydium CPMM',
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: 'Raydium CLMM',
  '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h': 'Raydium Stable AMM',
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: 'Orca Whirlpools',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP': 'Orca Token Swap',
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo: 'Meteora DLMM',
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG: 'Meteora DAMM v2',
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB: 'Meteora Pools',
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: 'PumpSwap'
});

function accountKeyStrings(tx) {
  const message = tx?.transaction?.message || tx?.message || {};
  const loaded = tx?.meta?.loadedAddresses || {};
  return [
    ...(Array.isArray(message.accountKeys) ? message.accountKeys : []),
    ...(Array.isArray(loaded.writable) ? loaded.writable : []),
    ...(Array.isArray(loaded.readonly) ? loaded.readonly : [])
  ].map((k) => String(typeof k === 'string' ? k : k?.pubkey || '')).filter(Boolean);
}

function collectProgramIds(instructions, keys, out) {
  for (const ix of Array.isArray(instructions) ? instructions : []) {
    if (typeof ix?.programId === 'string') out.add(ix.programId);
    if (typeof ix?.program === 'string' && SOL_ADDR.test(ix.program)) out.add(ix.program);
    if (Number.isInteger(ix?.programIdIndex) && keys[ix.programIdIndex]) out.add(keys[ix.programIdIndex]);
    if (Array.isArray(ix?.instructions)) collectProgramIds(ix.instructions, keys, out);
  }
}

function dexProgram(tx) {
  const keys = accountKeyStrings(tx);
  const programs = new Set();
  collectProgramIds(tx?.transaction?.message?.instructions || tx?.message?.instructions, keys, programs);
  for (const group of tx?.meta?.innerInstructions || []) {
    collectProgramIds(group?.instructions, keys, programs);
  }
  for (const programId of programs) {
    if (SOLANA_DEX_PROGRAMS[programId]) return { programId, name: SOLANA_DEX_PROGRAMS[programId] };
  }
  return null;
}

function balanceMap(rows, wallet) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    // If any token-balance row does not identify its owner, a third wallet
    // mint could be hidden in the very data meant to prove there are only
    // two. Reject the transaction rather than guessing from account indexes.
    if (!SOL_ADDR.test(String(row?.owner || ''))) return null;
    if (row.owner !== wallet) continue;
    const mint = String(row?.mint || '');
    const amountRaw = row?.uiTokenAmount?.amount;
    const decimals = Number(row?.uiTokenAmount?.decimals);
    if (!SOL_ADDR.test(mint) || !/^\d+$/.test(String(amountRaw || ''))
      || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null;
    let raw;
    try { raw = BigInt(String(amountRaw)); } catch { return null; }
    const prev = out.get(mint);
    if (prev && prev.decimals !== decimals) return null;
    out.set(mint, { raw: (prev?.raw || 0n) + raw, decimals });
  }
  return out;
}

function walletDeltas(tx, wallet) {
  const pre = balanceMap(tx?.meta?.preTokenBalances, wallet);
  const post = balanceMap(tx?.meta?.postTokenBalances, wallet);
  if (!pre || !post) return null;
  const mints = new Set([...pre.keys(), ...post.keys()]);
  const deltas = [];
  for (const mint of mints) {
    const before = pre.get(mint);
    const after = post.get(mint);
    if (before && after && before.decimals !== after.decimals) return null;
    const decimals = after?.decimals ?? before?.decimals;
    const deltaRaw = (after?.raw || 0n) - (before?.raw || 0n);
    if (deltaRaw === 0n) continue;
    const amount = Number(deltaRaw) / (10 ** decimals);
    if (!Number.isFinite(amount) || amount === 0) return null;
    deltas.push({ mint, decimals, deltaRaw, amount });
  }
  return deltas;
}

function symbolFor(symbols, mint) {
  if (!symbols) return null;
  const raw = symbols instanceof Map ? symbols.get(mint) : symbols[mint];
  const symbol = typeof raw === 'string' ? raw : raw?.symbol;
  return symbol ? String(symbol).slice(0, 24) : null;
}

/** Decode one `getTransaction` result (or the thin wrapper solTransactions
 * returns) into a paired stable-quoted swap, or null when proof is incomplete. */
export function decodeSolanaSwap(tx, wallet, { symbols = null, now = Date.now() } = {}) {
  const owner = String(wallet || '');
  if (!SOL_ADDR.test(owner) || !tx || tx?.meta?.err) return null;
  const signature = String(tx.signature || tx?.transaction?.signatures?.[0] || '');
  const blockTime = Number(tx.blockTime ?? tx.timestampSeconds);
  const timestamp = Number.isFinite(blockTime) && blockTime > 0
    ? (blockTime > 10_000_000_000 ? blockTime : blockTime * 1000)
    : Number(tx.timestamp);
  if (!SOL_SIG.test(signature) || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + 60_000) return null;

  const dex = dexProgram(tx);
  if (!dex) return null;
  const deltas = walletDeltas(tx, owner);
  if (!deltas || deltas.length !== 2) return null;
  const quote = deltas.find((d) => SOLANA_USD_QUOTES[d.mint]);
  if (!quote || quote.decimals !== SOLANA_USD_QUOTES[quote.mint].decimals) return null;
  const target = deltas.find((d) => d.mint !== quote.mint);
  if (!target || target.mint === WSOL_MINT) return null;

  const buy = quote.amount < 0 && target.amount > 0;
  const sell = quote.amount > 0 && target.amount < 0;
  if (!buy && !sell) return null;
  const quoteAmount = Math.abs(quote.amount);
  const targetAmount = Math.abs(target.amount);
  if (!(quoteAmount > 0) || !(targetAmount > 0)) return null;

  return {
    id: `solana:${owner}:${signature}:${target.mint}`,
    chain: 'solana', wallet: owner, hash: signature, signature, timestamp,
    token: target.mint, symbol: symbolFor(symbols, target.mint),
    side: buy ? 'BUY' : 'SELL', amount: targetAmount,
    // The quote leg itself is the USD amount at the stablecoin's assumed peg;
    // SOL network/priority fees are not token-balance deltas and stay excluded.
    valueUsd: quoteAmount, executionPriceUsd: quoteAmount / targetAmount,
    quoteToken: quote.mint, quoteKind: 'allowlisted-usd-stablecoin',
    quoteSymbol: SOLANA_USD_QUOTES[quote.mint].symbol, quoteAmount,
    dexProgram: dex.programId, dex: dex.name,
    evidence: 'decoded-solana-token-balance-deltas',
    classification: 'observed-only',
    admission: 'excluded-from-verified-score-and-consensus'
  };
}

/** Decode and chronologically sort a bounded sampled transaction set. */
export function reconstructSolanaSwaps({ address, transactions = [], symbols = null, now = Date.now() } = {}) {
  const seen = new Set();
  const swaps = [];
  for (const tx of Array.isArray(transactions) ? transactions.slice(0, 100) : []) {
    const swap = decodeSolanaSwap(tx, address, { symbols, now });
    if (!swap || seen.has(swap.id)) continue;
    seen.add(swap.id);
    swaps.push(swap);
  }
  return swaps.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}
