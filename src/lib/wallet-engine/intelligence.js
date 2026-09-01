/**
 * FBT WALLET ENGINE — TRANSACTION INTELLIGENCE
 * ---------------------------------------------------------------------------
 * A transaction hash is meaningless to a human. This module decodes the RAW
 * facts the indexer already has — calldata method, event logs, direction,
 * counterparties — into a concept the UI can render:
 *
 *   Swap · Send · Receive · Approve · Bridge · Stake · LP · Contract · Unknown
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · Classification is evidence-based and conservative. A transfer to a DEX
 *   router with no decoded method is `send` (it IS a send, of a token), and
 *   the `confidence` field says how sure we are. `unknown` is a real answer.
 * · The module returns i18n keys + facts; it never writes a sentence the
 *   translations would have to re-translate.
 */

export const INTELLIGENCE_SCHEMA = 'fbt.tx-intelligence.v1';

export const TX_KINDS = Object.freeze([
  'swap', 'send', 'receive', 'approve', 'bridge', 'stake', 'lp', 'contract', 'unknown'
]);

const METHOD_SELECTORS = Object.freeze({
  '0x095ea7b3': 'approve',                    // approve(address,uint256)
  '0x38ed1739': 'swap',                       // swapExactTokensForTokens (V2)
  '0x7ff36ab5': 'swap',                       // swapExactETHForTokens
  '0x18cbafe5': 'swap',                       // swapExactTokensForETH
  '0xa9059cbb': 'send',                       // transfer(address,uint256)
  '0x23b872dd': 'send',                       // transferFrom
  '0x42842e0e': 'send',                       // safeTransferFrom (NFT)
  '0x8da5cb5b': 'contract',                   // owner()
  '0x06fdde03': 'contract',                   // name()
  '0x313ce567': 'contract'                    // decimals()
});

const BRIDGE_MARKERS = ['bridge', 'relay', 'holograph', 'layerzero', 'wormhole', 'axelar', 'stargate', 'ccip'];
const STAKE_MARKERS = ['stake', 'deposit', 'delegate', 'claim', 'withdraw'];
const LP_MARKERS = ['addliquidity', 'removeliquidity', 'mint', 'burn'];

/**
 * Classify a transaction from the facts the caller has.
 * `facts`: { method, input, events:[{name}], to, from, selfAddress, direction }
 */
export function classifyTransaction(facts = {}) {
  const method = String(facts.method || '');
  const input = String(facts.input || facts.data || '');
  const events = Array.isArray(facts.events) ? facts.events.map((e) => String(e?.name || e || '').toLowerCase()) : [];
  const to = String(facts.to || '').toLowerCase();
  const from = String(facts.from || '').toLowerCase();
  const self = String(facts.selfAddress || '').toLowerCase();

  const selector = method.toLowerCase() || input.slice(0, 10).toLowerCase();
  const joined = [...events, to, from].join(' ');

  if (METHOD_SELECTORS[selector] === 'approve' || /approval/.test(joined)) {
    return { schema: INTELLIGENCE_SCHEMA, kind: 'approve', confidence: 'high', evidence: ['approve-method'] };
  }

  const direction = String(facts.direction || '').toLowerCase();
  const toSelf = self && to === self;
  const fromSelf = self && from === self;

  if (direction === 'in' || toSelf) {
    return { schema: INTELLIGENCE_SCHEMA, kind: 'receive', confidence: 'high', evidence: ['direction'] };
  }

  if (BRIDGE_MARKERS.some((m) => joined.includes(m))) {
    return { schema: INTELLIGENCE_SCHEMA, kind: 'bridge', confidence: 'medium', evidence: ['bridge-marker'] };
  }
  if (STAKE_MARKERS.some((m) => events.some((e) => e.includes(m)) || method.toLowerCase().includes(m))) {
    return { schema: INTELLIGENCE_SCHEMA, kind: 'stake', confidence: 'medium', evidence: ['stake-marker'] };
  }
  if (LP_MARKERS.some((m) => events.some((e) => e.includes(m)) || method.toLowerCase().includes(m))) {
    return { schema: INTELLIGENCE_SCHEMA, kind: 'lp', confidence: 'medium', evidence: ['lp-marker'] };
  }
  if (METHOD_SELECTORS[selector] === 'swap' || events.some((e) => e.includes('swap'))) {
    return { schema: INTELLIGENCE_SCHEMA, kind: 'swap', confidence: 'high', evidence: ['swap-method'] };
  }
  if (direction === 'out' || fromSelf) {
    return { schema: INTELLIGENCE_SCHEMA, kind: 'send', confidence: 'medium', evidence: ['direction'] };
  }
  if (input && input !== '0x') {
    return { schema: INTELLIGENCE_SCHEMA, kind: 'contract', confidence: 'low', evidence: ['calldata'] };
  }
  return { schema: INTELLIGENCE_SCHEMA, kind: 'unknown', confidence: 'low', evidence: [] };
}

/** i18n key + icon hint for a kind (pure — no translation imports). */
export function describeKind(kind) {
  const keys = {
    swap: 'txKind.swap', send: 'txKind.send', receive: 'txKind.receive',
    approve: 'txKind.approve', bridge: 'txKind.bridge', stake: 'txKind.stake',
    lp: 'txKind.lp', contract: 'txKind.contract', unknown: 'txKind.unknown'
  };
  const k = TX_KINDS.includes(kind) ? kind : 'unknown';
  return { kind: k, key: keys[k], direction: k === 'receive' ? 'in' : k === 'send' ? 'out' : null };
}
