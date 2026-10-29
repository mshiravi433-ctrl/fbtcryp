/**
 * SMART MONEY → SWAP HANDOFF
 * ---------------------------------------------------------------------------
 * «دکمه‌ای بزاری بنام کپی تراکنش که بعد بری داخل صفحه سواپ و همون توکن را
 *  سواپ کنی» — one tap from a receipt a verified wallet actually filled, to
 * the swap screen with THAT contract preselected and the side already set.
 *
 * The hard part is not the navigation, it is the contract of the deep link.
 * Swap.jsx deliberately splits its prefill into three separate paths:
 *
 *   · `?from=` / `?to=` — SYMBOLS, matched against the curated list only.
 *     This is a security boundary (a symbol in a URL selecting an arbitrary
 *     token is a one-tap phishing vector), and the wiring test pins it.
 *   · `?toAddress=` / `?fromAddress=` — CONTRACTS, imported with the
 *     unverified warning. This is the path a token we merely observed must
 *     travel on.
 *   · `/solana?toMint=` (+ `side=sell`) — the Solana screen's own mints.
 *
 * So a copy-trade link never invents a symbol. It carries the address we saw
 * on chain, and lets the swap screen do its own (safe) resolution.
 *
 * Nothing here signs, quotes or promises a fill: it is a prefill, and the
 * swap screen keeps its own risk gate, slippage and confirmation.
 */
import { TOKENS } from './chains.js';

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const STABLE_ORDER = ['USDT', 'USDC', 'DAI'];

/** The counter leg a copy-trade SELL should receive: a curated stablecoin. */
export function counterStable(chain) {
  const list = TOKENS[Number(chain)] || [];
  for (const symbol of STABLE_ORDER) {
    const hit = list.find((tk) => tk.symbol === symbol);
    if (hit) return hit.symbol;
  }
  return null;
}

/**
 * Build the in-app swap URL for a token a smart wallet traded.
 *
 * @param {object} p
 * @param {number|string} p.chain  1, 56, 8453… or 'solana'
 * @param {string} p.token         contract / mint
 * @param {string} [p.side]        'BUY' | 'SELL' (anything else = BUY)
 * @returns {string|null}          null when the address is not a real one —
 *                                 a copy-trade button must never open the swap
 *                                 with an empty or truncated contract.
 */
export function swapDeepLink({ chain, token, side } = {}) {
  const address = String(token || '').trim();
  const sell = String(side || 'BUY').toUpperCase() === 'SELL';

  if (chain === 'solana' || chain === 'sol') {
    if (!SOL_ADDRESS.test(address)) return null;
    /* SolanaSwap resolves `?toMint=` against the mint's own record and imports
       an unknown mint as a labelled address — never as a symbol. `side=sell`
       flips the pair (token → USDC) exactly like the coin page's Sell button. */
    const q = new URLSearchParams({ toMint: address });
    if (sell) q.set('side', 'sell');
    return `/solana?${q.toString()}`;
  }

  const id = Number(chain) || 1;
  if (!EVM_ADDRESS.test(address)) return null;

  const q = new URLSearchParams({ chain: String(id) });
  if (sell) {
    q.set('fromAddress', address);
    q.set('side', 'sell');
    const stable = counterStable(id);
    /* `to=` is a curated SYMBOL, which is the only leg that is allowed to be
       one: the counter side is a stablecoin we list ourselves. */
    if (stable) q.set('to', stable);
  } else {
    q.set('toAddress', address);
  }
  return `/swap?${q.toString()}`;
}

/** A row from the verified ledger / wallet page → its copy-trade link. */
export function swapLinkForRow(row) {
  if (!row) return null;
  return swapDeepLink({
    chain: row.chain ?? row.chainId,
    token: row.token ?? row.address,
    side: row.side || (row.signal === 'DISTRIBUTION' ? 'SELL' : 'BUY')
  });
}
