/**
 * FBT WALLET ENGINE — WALLET REGISTRY (Multi-Wallet Manager)
 * ---------------------------------------------------------------------------
 * One place that knows every wallet the user has: EVM wallet 1, EVM wallet 2,
 * the Solana wallet, the BTC wallet, and any external/watch-only wallet. Every
 * engine asks the registry "which wallets do I have and what can they do?"
 * instead of reaching for a global `window.ethereum`.
 *
 * The core store is a synchronous Map wrapped in a plain object, so it is
 * trivially testable and renderable. Persistence is an injected adapter —
 * `persistRegistry`/`loadRegistry` — because the browser store, the server
 * store and the test store are three different sinks and the engine must not
 * care which one it is talking to.
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · Registering a wallet that already exists (same id) REPLACES it — the
 *   registry is a source of truth, not an append-only log.
 * · `primaryWallet` returns null when nothing is registered; a caller that
 *   needs a wallet must handle null, not assume one exists.
 */

import { declareWallet } from './capabilities.js';

export const REGISTRY_SCHEMA = 'fbt.wallet-registry.v1';

export function createWalletRegistry({ storage = null } = {}) {
  const map = new Map();
  return {
    schema: REGISTRY_SCHEMA,
    storage,
    /** Register (or replace) a wallet. Accepts raw input or a declared record. */
    register(input) {
      const wallet = input?.schema === 'fbt.wallet.v1' ? input : declareWallet(input);
      map.set(wallet.id, wallet);
      return wallet;
    },
    update(id, patch = {}) {
      const current = map.get(id);
      if (!current) return null;
      const next = declareWallet({ ...current, ...patch, id });
      map.set(id, next);
      return next;
    },
    remove(id) {
      return map.delete(id);
    },
    get(id) {
      return map.get(id) || null;
    },
    findById(id) {
      return map.get(id) || null;
    },
    findByAddress(address) {
      const a = String(address || '').toLowerCase();
      for (const w of map.values()) {
        if (w.address && String(w.address).toLowerCase() === a) return w;
        if (w.accounts.some((acct) => String(acct).toLowerCase() === a)) return w;
      }
      return null;
    },
    list({ family = null } = {}) {
      const all = [...map.values()];
      if (!family) return all;
      const f = String(family).toLowerCase();
      return all.filter((w) => w.family === f);
    },
    primary({ family = null } = {}) {
      const list = family ? this.list({ family }) : this.list();
      if (!list.length) return null;
      return list.find((w) => !w.watchOnly) || list[0];
    },
    size() {
      return map.size;
    }
  };
}

/** Snapshot the registry into a serializable structure. */
export function serializeRegistry(registry) {
  return {
    schema: REGISTRY_SCHEMA,
    wallets: registry.list().map((w) => ({ ...w, capabilities: [...w.capabilities] }))
  };
}

/** Restore a registry from a serialized snapshot. */
export function hydrateRegistry(registry, snapshot) {
  for (const w of snapshot?.wallets || []) registry.register(w);
  return registry;
}

/** Persist the registry through an injected async storage (`{ save(data) }`). */
export async function persistRegistry(registry, storage) {
  if (!storage || typeof storage.save !== 'function') return { ok: false, code: 'NO_STORAGE' };
  await storage.save(serializeRegistry(registry));
  return { ok: true, code: 'SAVED' };
}

/** Load a registry through an injected async storage (`{ load() }`). */
export async function loadRegistry(registry, storage) {
  if (!storage || typeof storage.load !== 'function') return { ok: false, code: 'NO_STORAGE' };
  const snapshot = await storage.load();
  hydrateRegistry(registry, snapshot);
  return { ok: true, code: 'LOADED', count: registry.size() };
}
