/**
 * FBT WALLET ENGINE — WALLETCONNECT SESSION MANAGER
 * ---------------------------------------------------------------------------
 * A dapp session is a standing permission, not a one-off. This module is the
 * inventory and the kill-switch: which sessions are active, which chains each
 * one has used, what it is allowed to do, when it expires — and a clean
 * disconnect.
 *
 * It models the session the wallet signed (`session.namespaces.*`), which is
 * the honest source of truth — the same lesson `src/lib/wcChain.js` encodes
 * for chain id. A session whose namespace lists only `eip155:1` is recorded as
 * an Ethereum-only session even if the provider later claims chain 56.
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · Permissions are read FROM the session record, never assumed. A session
 *   with no readable permissions has `permissions: []`, not "everything".
 * · `expired()` returns true only against real expiry data; a session with no
 *   expiry is `active` but flagged `expiryUnknown:true`.
 */

export const SESSION_SCHEMA = 'fbt.wc-session.v1';

/** Extract the chains a session namespace actually approves (CAIP-2 refs). */
export function sessionChains(session = {}) {
  const chains = new Set();
  const namespaces = session?.namespaces || {};
  for (const ns of Object.values(namespaces)) {
    for (const acct of ns?.accounts || []) {
      if (typeof acct === 'string') {
        const parts = acct.split(':');
        if (parts.length >= 2) chains.add(`${parts[0]}:${parts[1]}`);
      }
    }
  }
  return [...chains];
}

/** Extract the approved methods for a namespace key (e.g. 'eip155'). */
export function sessionMethods(session = {}, namespaceKey = 'eip155') {
  return [...(session?.namespaces?.[namespaceKey]?.methods || [])];
}

export function createSessionManager() {
  const sessions = new Map();

  const api = {
    schema: SESSION_SCHEMA,

    /** Record a session. `session` is the WalletConnect session object. */
    add({ session, peer = {}, now = Date.now() } = {}) {
      if (!session?.topic) return { ok: false, code: 'TOPIC_REQUIRED' };
      const record = {
        schema: SESSION_SCHEMA,
        topic: String(session.topic),
        peer: {
          name: peer.name || session.peer?.metadata?.name || null,
          url: peer.url || session.peer?.metadata?.url || null,
          icon: peer.icon || session.peer?.metadata?.icons?.[0] || null
        },
        chains: sessionChains(session),
        permissions: sessionMethods(session),
        expiry: Number.isFinite(Number(session.expiry)) ? Number(session.expiry) : null,
        createdAt: now,
        lastUsed: now
      };
      sessions.set(record.topic, record);
      return { ok: true, code: 'ADDED', record };
    },

    list() {
      return [...sessions.values()].map((s) => ({ ...s }));
    },

    /** Active sessions (not expired). Expiry-unknown sessions stay active. */
    active(now = Date.now()) {
      return [...sessions.values()]
        .filter((s) => s.expiry == null || s.expiry > now)
        .map((s) => ({ ...s, expiryUnknown: s.expiry == null }));
    },

    get(topic) {
      const s = sessions.get(topic);
      return s ? { ...s } : null;
    },

    expired(topic, now = Date.now()) {
      const s = sessions.get(topic);
      if (!s || s.expiry == null) return { expired: false, expiryUnknown: true };
      return { expired: s.expiry <= now, expiryUnknown: false };
    },

    /** Disconnect (remove) a session — the revoke path. */
    disconnect(topic) {
      const had = sessions.delete(topic);
      return { ok: had, code: had ? 'DISCONNECTED' : 'NOT_FOUND' };
    },

    /** Chains a session has been used on (records the wallet's own reports). */
    recordChainUse(topic, chainRef) {
      const s = sessions.get(topic);
      if (!s) return null;
      if (!s.usedChains) s.usedChains = [];
      if (!s.usedChains.includes(chainRef)) s.usedChains.push(chainRef);
      s.lastUsed = Date.now();
      return { ...s };
    }
  };

  return api;
}
