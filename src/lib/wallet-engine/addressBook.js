/**
 * FBT WALLET ENGINE — SMART ADDRESS BOOK
 * ---------------------------------------------------------------------------
 * Named addresses across EVM / Solana / Bitcoin, plus the two behaviors that
 * make an address book "smart":
 *
 *   · recency + frequency — which addresses you actually use, surfaced first
 *   · wrong-network detection — "this address is a Solana address but you are
 *     on Ethereum" is caught BEFORE the user pastes it into a send.
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · `checkNetwork` uses the same structural validators as the adapters, so a
 *   verdict is a real family mismatch, never a heuristic guess.
 * · Recency/frequency come from recorded usage (`touch`), not from reading the
 *   user's history behind their back — the caller decides what counts as use.
 */

import { validateAddress, chainFamily } from './adapters.js';

export const ADDRESS_BOOK_SCHEMA = 'fbt.address-book.v1';

export function createAddressBook({ storage = null } = {}) {
  const entries = new Map();

  const api = {
    schema: ADDRESS_BOOK_SCHEMA,
    storage,

    /** Add or update a named entry. */
    add({ address, label, family = null, chainId = null }) {
      if (!address) return { ok: false, code: 'ADDRESS_REQUIRED' };
      const fam = family || chainFamily(chainId) || detectFamily(address);
      const entry = {
        schema: ADDRESS_BOOK_SCHEMA,
        address: String(address),
        label: label ? String(label) : null,
        family: fam,
        chainId: chainId ?? null,
        createdAt: Date.now(),
        lastUsed: null,
        useCount: 0
      };
      entries.set(String(address).toLowerCase(), entry);
      return { ok: true, code: 'SAVED', entry };
    },

    /** Record a use — feeds recency + frequency. */
    touch(address, { chainId = null } = {}) {
      const e = entries.get(String(address || '').toLowerCase());
      if (!e) return null;
      e.lastUsed = Date.now();
      e.useCount += 1;
      if (chainId != null) e.chainId = chainId;
      return { ...e };
    },

    get(address) {
      const e = entries.get(String(address || '').toLowerCase());
      return e ? { ...e } : null;
    },

    /** All entries, most-frequently-and-recently-used first. */
    list() {
      return [...entries.values()]
        .sort((a, b) => (b.useCount - a.useCount) || ((b.lastUsed ?? 0) - (a.lastUsed ?? 0)))
        .map((e) => ({ ...e }));
    },

    /** Entries actually used, newest-first. */
    recent(limit = 10) {
      return [...entries.values()]
        .filter((e) => e.lastUsed != null)
        .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
        .slice(0, limit)
        .map((e) => ({ ...e }));
    },

    /** Most-used entries. */
    frequent(limit = 10) {
      return [...entries.values()]
        .sort((a, b) => b.useCount - a.useCount)
        .filter((e) => e.useCount > 0)
        .slice(0, limit)
        .map((e) => ({ ...e }));
    }
  };

  return api;
}

/** Best-effort family for a bare address (structural detection only). */
export function detectFamily(address) {
  if (validateAddress('evm', address)) return 'evm';
  if (validateAddress('solana', address)) return 'solana';
  if (validateAddress('bitcoin', address)) return 'bitcoin';
  return null;
}

/**
 * Detect a wrong-network paste before anything is sent.
 * `chainId`/`family` is where the user IS; `address` is what they pasted.
 */
export function checkNetwork(address, { family = null, chainId = null } = {}) {
  const where = family || chainFamily(chainId);
  const fam = detectFamily(address);
  if (!fam) return { ok: false, code: 'INVALID_ADDRESS', where, addressFamily: null };
  const match = where == null || where === fam;
  return {
    ok: match,
    code: match ? 'NETWORK_MATCH' : 'NETWORK_MISMATCH',
    where,
    addressFamily: fam
  };
}
