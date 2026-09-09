/**
 * FARM / DEFI ERROR LOCALISATION
 * ---------------------------------------------------------------------------
 * The execution adapters throw machine codes (`LIDO_NETWORK_UNREADABLE`,
 * `AAVE_NETWORK_UNREADABLE`, …) and the panels used to paste those codes
 * straight into the UI — so a Persian device read an English error string
 * that says nothing to a human. Errors must follow the device language, like
 * every other line on the screen.
 *
 * This module is the single door through which a Farm/DeFi error becomes a
 * sentence. Panels keep their own protocol-specific keys (user-rejected,
 * timeout, replaced — see farm.<protocol>.userRejected etc.) and route
 * everything else through `farmErrorLabel()` / `farmErrorText()` here.
 */

const NETWORK_PROTOCOLS = {
  LIDO: 'Lido',
  AAVE: 'Aave',
  COMPOUND: 'Compound',
  MORPHO: 'Morpho'
};

/** code → i18n key. Everything else falls through to the generic form. */
const ERROR_KEY_MAP = {
  LIDO_NETWORK_UNREADABLE: 'farm.errors.network',
  AAVE_NETWORK_UNREADABLE: 'farm.errors.network',
  COMPOUND_NETWORK_UNREADABLE: 'farm.errors.network',
  MORPHO_NETWORK_UNREADABLE: 'farm.errors.network',
  EXECUTION_NETWORK_UNREADABLE: 'farm.errors.network',
  LIDO_STETH_UNREADABLE: 'farm.errors.network',
  LIDO_PROTOCOL_STATUS_UNREADABLE: 'farm.errors.network',
  LIDO_BALANCE_UNREADABLE: 'farm.errors.network',
  LIDO_QUEUE_UNREADABLE: 'farm.errors.network',
  LIDO_WITHDRAWAL_REQUESTS_UNREADABLE: 'farm.errors.network',
  LIDO_WSTETH_STETH_UNREADABLE: 'farm.errors.network',
  LIDO_STETH_IDENTITY_UNREADABLE: 'farm.errors.network',
  AAVE_ADDRESSES_PROVIDER_UNREADABLE: 'farm.errors.network',
  LIDO_STETH_INVALID: 'farm.errors.contract',
  LIDO_WRONG_CHAIN: 'farm.errors.wrongNetwork',
  AAVE_WRONG_CHAIN: 'farm.errors.wrongNetwork',
  COMPOUND_WRONG_CHAIN: 'farm.errors.wrongNetwork',
  MORPHO_WRONG_CHAIN: 'farm.errors.wrongNetwork',
  EXECUTION_WRONG_CHAIN: 'farm.errors.wrongNetwork',
  WRONG_NETWORK: 'farm.errors.wrongNetwork',
  USER_REJECTED: 'farm.errors.userRejected',
  INSUFFICIENT_BALANCE: 'farm.errors.insufficientBalance',
  INSUFFICIENT_ALLOWANCE: 'farm.errors.insufficientAllowance',
  GAS_ESTIMATION_FAILED: 'farm.errors.gas',
  SIMULATION_FAILED: 'farm.errors.simulation',
  CONTRACT_REVERT: 'farm.errors.revert',
  RPC_ERROR: 'farm.errors.rpc',
  PROVIDER_BUSY: 'farm.errors.rpc',
  TIMEOUT: 'farm.errors.timeout',
  TRANSACTION_DROPPED: 'farm.errors.dropped',
  INDEXER_DELAY: 'farm.errors.indexer'
};

const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Turn a thrown adapter error into a LOCALISED sentence.
 *
 * Priority:
 *   1. a known machine code → its translation (with the protocol name for
 *      network errors: «شبکه Lido در دسترس نیست»);
 *   2. a human prose `reason`/`message`/`detail` (e.g. a decoded revert) —
 *      shown as-is, it is already readable;
 *   3. the generic form with the raw code kept for support.
 */
export function farmErrorLabel(err, t) {
  const code = String(err?.code ?? err?.name ?? '').trim();
  if (code) {
    const mapped = ERROR_KEY_MAP[code];
    if (mapped) {
      if (mapped === 'farm.errors.network') {
        const protocol = NETWORK_PROTOCOLS[code.split('_')[0]];
        return protocol
          ? t('farm.errors.network', { protocol })
          : t('farm.errors.networkGeneric');
      }
      const label = t(mapped, { code });
      if (label && label !== mapped) return label;
    }
  }
  const prose = err?.reason ?? err?.message ?? err?.detail;
  if (typeof prose === 'string' && prose.trim() && !CODE_RE.test(prose.trim()) && prose.length <= 220) {
    return prose;
  }
  return t('farm.errors.generic', { code: code || 'UNKNOWN' });
}

/**
 * Panel-friendly wrapper: when the protocol's own revert explainer already
 * resolved a translation key, prefer it; otherwise route through the table
 * above.
 */
export function farmErrorText(err, t, explained = null) {
  if (explained?.key) {
    const label = t(explained.key);
    if (label && label !== explained.key) return label;
  }
  return farmErrorLabel(err, t);
}

/**
 * The yield-feed error line on the Farm header. Feed failures throw plain
 * strings ('Failed to fetch', 'HTTP 429', 'BAD_SHAPE', 'YIELDS_EXPIRED') —
 * those are machine talk too, so they get the same treatment as adapter
 * errors instead of being pasted in English onto a Persian screen.
 */
export function feedErrorLabel(errorText, t) {
  const msg = String(errorText ?? '').trim();
  if (!msg) return null;
  if (msg.includes('YIELDS_EXPIRED')) return t('farm.errors.feedExpired');
  if (msg.includes('BAD_SHAPE')) return t('farm.errors.feedBadShape');
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('load failed') || msg.includes('ERR_INTERNET')) {
    return t('farm.errors.feedOffline');
  }
  if (/^HTTP \d+/.test(msg)) return t('farm.errors.feedHttp', { code: msg });
  return msg;
}
