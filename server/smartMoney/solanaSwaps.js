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
 * These rows are intentionally NOT a verified performance ledger yet.
 * Phase 4 separates two provenance tiers: balance-only rows still net every
 * fill in a transaction into one effect, while instruction-corroborated rows
 * also reconcile the parsed SPL transfer fills exactly against those deltas.
 * Even the stronger tier only feeds a shadow-readiness assessment until
 * real-transaction replay fixtures validate each supported DEX; neither tier
 * feeds score, P&L, qualification or consensus.
 */

const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOL_SIG = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const SPL_TOKEN_PROGRAMS = new Map([
  ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'spl-token'],
  ['TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEB', 'spl-token-2022']
]);
export const SOLANA_BALANCE_ONLY_DECODE = 'token-balance-deltas';
export const SOLANA_INSTRUCTION_CORROBORATED_DECODE = 'instruction-corroborated-token-balance-deltas';

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

/**
 * Map token-account pubkeys to the owner/mint proven by the balance rows.
 *
 * `accountIndex` in a token-balance row indexes the transaction's resolved
 * account list: static message keys, then writable and readonly lookup-table
 * addresses. That mapping is what lets a parsed transfer's source/destination
 * token accounts be attributed to THIS wallet instead of to the pool or to
 * another signer. Any conflicting mapping disables corroboration; it never
 * downgrades by guessing an owner from the transfer authority (a delegate can
 * spend from an account it does not own).
 */
function tokenAccountMap(tx) {
  const keys = accountKeyStrings(tx);
  const out = new Map();
  const rows = [
    ...(Array.isArray(tx?.meta?.preTokenBalances) ? tx.meta.preTokenBalances : []),
    ...(Array.isArray(tx?.meta?.postTokenBalances) ? tx.meta.postTokenBalances : [])
  ];
  for (const row of rows) {
    const account = Number.isInteger(row?.accountIndex) ? keys[row.accountIndex] : null;
    const owner = String(row?.owner || '');
    const mint = String(row?.mint || '');
    const decimals = Number(row?.uiTokenAmount?.decimals);
    if (!account || !SOL_ADDR.test(owner) || !SOL_ADDR.test(mint)
      || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) continue;
    const prev = out.get(account);
    if (prev && (prev.owner !== owner || prev.mint !== mint || prev.decimals !== decimals)) return null;
    out.set(account, { owner, mint, decimals });
  }
  return out;
}

function instructionProgramId(ix, keys) {
  if (typeof ix?.programId === 'string') return ix.programId;
  if (Number.isInteger(ix?.programIdIndex) && keys[ix.programIdIndex]) return keys[ix.programIdIndex];
  if (typeof ix?.program === 'string' && SOL_ADDR.test(ix.program)) return ix.program;
  return null;
}

function collectParsedTokenTransfers(instructions, keys, out) {
  for (const ix of Array.isArray(instructions) ? instructions : []) {
    const programId = instructionProgramId(ix, keys);
    const programLabel = String(ix?.program || '');
    const isTokenProgram = SPL_TOKEN_PROGRAMS.has(programId)
      || programLabel === 'spl-token' || programLabel === 'spl-token-2022';
    const type = String(ix?.parsed?.type || '');
    if (isTokenProgram && (type === 'transfer' || type === 'transferChecked')) {
      const info = ix?.parsed?.info || {};
      const tokenAmount = info.tokenAmount && typeof info.tokenAmount === 'object' ? info.tokenAmount : {};
      out.push({
        source: String(info.source || ''),
        destination: String(info.destination || ''),
        mint: String(info.mint || ''),
        rawAmount: String(tokenAmount.amount ?? info.amount ?? ''),
        decimals: tokenAmount.decimals == null ? null : Number(tokenAmount.decimals),
        authority: String(info.authority || info.multisigAuthority || '')
      });
    }
    if (Array.isArray(ix?.instructions)) collectParsedTokenTransfers(ix.instructions, keys, out);
  }
}

/**
 * Cross-check net balance deltas against the individual SPL transfer fills.
 *
 * Balance deltas alone net a whole transaction: a swap, a fee rebate and an
 * unrelated same-mint transfer can collapse into one plausible pair. The
 * parsed `transfer`/`transferChecked` instructions are the transaction's own
 * fill list, so phase 4 requires their wallet-boundary sum, mint-by-mint and
 * in raw BigInt units, to equal the balance delta EXACTLY for both legs, with
 * no third wallet mint moving at instruction level. Anything less stays a
 * balance-only observation — useful evidence, weaker provenance.
 */
function instructionCorroboration(tx, wallet, target, quote) {
  const empty = { corroborated: false, fillCount: 0, targetTransfers: 0, quoteTransfers: 0 };
  const tokenAccounts = tokenAccountMap(tx);
  if (!tokenAccounts || !tokenAccounts.size) return empty;
  const keys = accountKeyStrings(tx);
  const transfers = [];
  collectParsedTokenTransfers(tx?.transaction?.message?.instructions || tx?.message?.instructions, keys, transfers);
  for (const group of tx?.meta?.innerInstructions || []) {
    collectParsedTokenTransfers(group?.instructions, keys, transfers);
  }
  if (!transfers.length) return empty;

  const byMint = new Map();
  for (const transfer of transfers) {
    const source = tokenAccounts.get(transfer.source);
    const destination = tokenAccounts.get(transfer.destination);
    const entersWallet = destination?.owner === wallet;
    const leavesWallet = source?.owner === wallet;
    if (!entersWallet && !leavesWallet) continue;
    if (!/^\d+$/.test(transfer.rawAmount)) return empty;
    let raw;
    try { raw = BigInt(transfer.rawAmount); } catch { return empty; }
    if (raw <= 0n) return empty;
    const mint = transfer.mint || source?.mint || destination?.mint || '';
    if (!SOL_ADDR.test(mint)) return empty;
    if ((transfer.mint && source && transfer.mint !== source.mint)
      || (transfer.mint && destination && transfer.mint !== destination.mint)
      || (source && destination && source.mint !== destination.mint)) return empty;
    const knownDecimals = source?.decimals ?? destination?.decimals;
    if (transfer.decimals != null && (!Number.isInteger(transfer.decimals)
      || (knownDecimals != null && transfer.decimals !== knownDecimals))) return empty;
    const deltaForMint = mint === target.mint ? target : mint === quote.mint ? quote : null;
    if (deltaForMint && transfer.decimals != null && transfer.decimals !== deltaForMint.decimals) return empty;

    const net = (entersWallet ? raw : 0n) - (leavesWallet ? raw : 0n);
    const prev = byMint.get(mint) || { netRaw: 0n, count: 0 };
    prev.netRaw += net;
    if (net !== 0n) prev.count++;
    byMint.set(mint, prev);
  }

  const targetAgg = byMint.get(target.mint);
  const quoteAgg = byMint.get(quote.mint);
  if (!targetAgg || !quoteAgg || !targetAgg.count || !quoteAgg.count) return empty;
  if (targetAgg.netRaw !== target.deltaRaw || quoteAgg.netRaw !== quote.deltaRaw) return empty;
  for (const [mint, agg] of byMint) {
    if (mint !== target.mint && mint !== quote.mint && agg.netRaw !== 0n) return empty;
  }
  return {
    corroborated: true,
    fillCount: targetAgg.count + quoteAgg.count,
    targetTransfers: targetAgg.count,
    quoteTransfers: quoteAgg.count
  };
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
  const corroboration = instructionCorroboration(tx, owner, target, quote);

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
    decodeMethod: corroboration.corroborated
      ? SOLANA_INSTRUCTION_CORROBORATED_DECODE : SOLANA_BALANCE_ONLY_DECODE,
    instructionCorroborated: corroboration.corroborated,
    instructionFillCount: corroboration.fillCount,
    instructionTransfers: {
      target: corroboration.targetTransfers,
      quote: corroboration.quoteTransfers
    },
    evidence: 'decoded-solana-token-balance-deltas',
    classification: 'observed-only',
    admission: 'excluded-from-verified-score-and-consensus'
  };
}

/** Decode and chronologically sort a bounded sampled transaction set. */
export function reconstructSolanaSwaps({ address, transactions = [], symbols = null, now = Date.now() } = {}) {
  const seen = new Set();
  const swaps = [];
  for (const tx of Array.isArray(transactions) ? transactions.slice(0, 300) : []) {
    const swap = decodeSolanaSwap(tx, address, { symbols, now });
    if (!swap || seen.has(swap.id)) continue;
    seen.add(swap.id);
    swaps.push(swap);
  }
  return swaps.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

/** A decoded Solana row whose balance proof also passed instruction-level
 * fill reconciliation. This is a provenance check, not verified admission. */
export function isInstructionCorroboratedSolanaSwap(swap) {
  return !!swap
    && swap.chain === 'solana'
    && swap.evidence === 'decoded-solana-token-balance-deltas'
    && swap.decodeMethod === SOLANA_INSTRUCTION_CORROBORATED_DECODE
    && swap.instructionCorroborated === true
    && Number.isInteger(swap.instructionFillCount) && swap.instructionFillCount >= 2
    && ['BUY', 'SELL'].includes(swap.side)
    && Number.isFinite(Number(swap.amount)) && Number(swap.amount) > 0
    && Number.isFinite(Number(swap.valueUsd)) && Number(swap.valueUsd) > 0
    && Number.isFinite(Number(swap.timestamp)) && Number(swap.timestamp) > 0
    && !!SOLANA_DEX_PROGRAMS[swap.dexProgram];
}

/**
 * Phase-4 Solana shadow-ledger gate — deliberately NOT a promotion.
 *
 * A wallet sample is only *ready to be shadow-scored* when all three facts
 * are independently true: signature pagination reached the RPC's end of
 * history, every requested transaction detail was fetched, and every decoded
 * paired swap reconciled at instruction level. One balance-only row blocks
 * the sample for the same reason one unpriced EVM native row does: excluding
 * it would let the surviving rows close lots they never opened.
 *
 * `promoted` stays false and every row keeps its observed-only admission.
 * Real-transaction replay fixtures per supported DEX are still required
 * before these rows may feed a user-visible score, P&L or consensus vote.
 */
export function assessSolanaSwapLedger({ swaps = [], signatureCoverage = null, transactionCoverage = null } = {}) {
  const rows = Array.isArray(swaps) ? swaps : [];
  const corroborated = rows.filter(isInstructionCorroboratedSolanaSwap);
  const ids = rows.map((s) => String(s?.id || ''));
  const blockers = [];
  if (signatureCoverage?.complete !== true) blockers.push('signature-history-incomplete');
  if (transactionCoverage?.complete !== true) blockers.push('transaction-details-incomplete');
  if (!rows.length) blockers.push('no-decoded-paired-swaps');
  if (rows.length && corroborated.length !== rows.length) blockers.push('instruction-corroboration-incomplete');
  if (new Set(ids).size !== ids.length || ids.some((id) => !id)) blockers.push('duplicate-or-unidentified-swaps');
  const shadowEligible = blockers.length === 0;
  return {
    status: shadowEligible ? 'shadow-ready' : 'observed-only',
    shadowEligible,
    promoted: false,
    admission: 'excluded-from-verified-score-and-consensus',
    swaps: rows.length,
    corroboratedSwaps: corroborated.length,
    balanceOnlySwaps: rows.length - corroborated.length,
    signatureHistoryComplete: signatureCoverage?.complete === true,
    transactionDetailsComplete: transactionCoverage?.complete === true,
    blockers,
    gate: 'complete-signature-history+complete-transaction-details+all-decoded-swaps-instruction-corroborated',
    nextGate: 'real-transaction-replay-fixtures-per-supported-dex'
  };
}
