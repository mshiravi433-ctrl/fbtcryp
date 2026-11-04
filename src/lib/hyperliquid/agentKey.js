/**
 * HYPERLIQUID — AGENT KEY FORMAT CHECK (pure, no storage, no network)
 * ---------------------------------------------------------------------------
 * Checks only the shape of a value the user pastes. It does not store the key,
 * does not derive an address, and cannot tell a master key from an agent key.
 * The UI must tell the user that in plain words; this check cannot do it.
 */

export const AGENT_KEY_CODES = Object.freeze({
  EMPTY: 'AGENT_KEY_EMPTY',
  BAD_FORMAT: 'AGENT_KEY_BAD_FORMAT',
  ZERO: 'AGENT_KEY_ZERO'
});

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export function validateAgentKeyFormat(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { ok: false, code: AGENT_KEY_CODES.EMPTY };
  if (!KEY_RE.test(raw)) return { ok: false, code: AGENT_KEY_CODES.BAD_FORMAT };
  if (/^0x0+$/.test(raw)) return { ok: false, code: AGENT_KEY_CODES.ZERO };
  return { ok: true, code: null };
}

/** Shows only the first and last 4 characters, for confirmation on screen. */
export function maskAgentKey(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw.length < 12) return '';
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
}
