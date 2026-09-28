/**
 * Operator-sourced wallet identities. Separate from behavioural classification:
 * FUND/VC/MARKET_MAKER is a *sourced identity claim*, WHALE is capital, and
 * SMART_MONEY is a *measured performance qualification*. None implies another.
 * No invented seed wallets; unidentified wallets retain UNKNOWN identity.
 */
import { storeGet, storeSet, storeDurable } from '../store.js';
import { exchangeFor, routerFor, isFactory } from './registry.js';

const KEY = 'smart-money:identity-registry:v1';
const CHAINS = new Set([1, 56, 137, 42161, 8453, 10, 43114]);
const TYPES = new Set(['FUND', 'VC', 'MARKET_MAKER', 'INSTITUTION', 'KOL', 'WHALE']);
const HEX = /^0x[a-f0-9]{40}$/;
export const REGISTRY_TYPES = [...TYPES];

export function validateIdentity(row = {}) {
  const chain = Number(row.chain);
  const address = String(row.address || '').trim().toLowerCase();
  const kind = String(row.kind || '').trim().toUpperCase();
  if (!CHAINS.has(chain) || !HEX.test(address) || /^0x0{40}$/.test(address)) throw new Error('BAD_WALLET');
  if (!TYPES.has(kind)) throw new Error('BAD_IDENTITY_KIND');
  if (exchangeFor(chain, address) || routerFor(chain, address) || isFactory(chain, address)) throw new Error('NON_WALLET');
  const label = String(row.label || '').trim().slice(0, 80);
  if (label.length < 3) throw new Error('BAD_LABEL');
  let sourceUrl;
  try {
    sourceUrl = new URL(String(row.sourceUrl || ''));
    if (sourceUrl.protocol !== 'https:' || sourceUrl.username || sourceUrl.password
      || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(sourceUrl.hostname)
      || sourceUrl.href.length > 350) throw new Error('BAD_SOURCE');
  } catch { throw new Error('BAD_SOURCE'); }
  return { chain, address, kind, label, sourceUrl: sourceUrl.href,
    basis: String(row.basis || '').trim().slice(0, 240) || null,
    provenance: 'operator-sourced-public-link' };
}

export async function readWalletRegistry() {
  const rows = await storeGet(KEY, []);
  return Array.isArray(rows) ? rows.slice(0, 250) : [];
}

/** Admin-only writer: auth enforced at app.js, never from a public MCP tool. */
export async function putWalletIdentity(row, { now = Date.now() } = {}) {
  const valid = validateIdentity(row);
  const rows = await readWalletRegistry();
  await storeSet(KEY, [...rows.filter((r) => !(r.chain === valid.chain && r.address === valid.address)),
    { ...valid, updatedAt: now }].slice(-250));
  return { ok: true, row: { ...valid, updatedAt: now }, durable: storeDurable() };
}

export async function removeWalletIdentity(chain, address) {
  const rows = await readWalletRegistry();
  const next = rows.filter((r) => !(r.chain === Number(chain) && r.address === String(address).toLowerCase()));
  await storeSet(KEY, next);
  return { ok: true, removed: rows.length - next.length };
}

export function publicRegistry(rows = []) {
  return { schema: 'fbt.smart-money-registry.v1', rows, count: rows.length, durable: storeDurable(),
    note: 'Identity labels are operator-sourced from the linked public page, not proof of ownership or skill. A VC/Fund/Market Maker label never confers SMART_MONEY status.' };
}
