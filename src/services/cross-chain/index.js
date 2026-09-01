/**
 * /services/cross-chain — the single entry point the spec asks for.
 *
 *      Bridge Page
 *           ↕
 *   CrossChainService  ←→  LI.FI  ←→  Wallet  ←→  Blockchain
 *           ↕
 *      Intent OS
 *
 * Import from here, never from a second bridge client. `core.js` is the pure
 * engine (normalisation, ranking, expiry, status, address rules) and is shared
 * byte-for-byte with the server; `client.js` is the browser transport plus the
 * execution pipeline that drives the user's own wallet.
 */

export * from './core.js';
export {
  crossChainService,
  getChains,
  getTokens,
  resolveToken,
  getHealth,
  getQuote,
  getRoutes,
  getHistory,
  getStatus,
  trackTransaction,
  cancel,
  execute,
  recordIntent
} from './client.js';

export { default } from './client.js';
