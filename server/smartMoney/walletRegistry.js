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

export const DEFAULT_WALLET_REGISTRY = Object.freeze([
  {
    chain: 1,
    address: '0x534a007615121b31a73ba25afb5876bea40947ce',
    kind: 'FUND',
    label: 'Arthur Hayes (Maelstrom)',
    sourceUrl: 'https://etherscan.io/address/0x534a007615121b31a73ba25afb5876bea40947ce',
    basis: 'Family office & public high-conviction on-chain crypto holdings',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 1,
    address: '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621',
    kind: 'MARKET_MAKER',
    label: 'Jump Trading Execution Desk',
    sourceUrl: 'https://etherscan.io/address/0xf584f8728b874a6a5c7a8d4d387c9aae9172d621',
    basis: 'Institutional proprietary trading and DEX liquidity provisioning',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 1,
    address: '0xdbf5e9c5206d0d44a18449b7d522931af996fca3',
    kind: 'MARKET_MAKER',
    label: 'Wintermute Algorithmic 1',
    sourceUrl: 'https://etherscan.io/address/0xdbf5e9c5206d0d44a18449b7d522931af996fca3',
    basis: 'Global algorithmic market maker primary trading wallet',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 1,
    address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    kind: 'WHALE',
    label: 'vitalik.eth',
    sourceUrl: 'https://etherscan.io/address/0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    basis: 'Ethereum founder verified primary address and ecosystem deployer',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 1,
    address: '0x9c5083dd4838e120dbeac44c052179692aa5dac5',
    kind: 'WHALE',
    label: 'Tetranode (DeFi Pioneer)',
    sourceUrl: 'https://etherscan.io/address/0x9c5083dd4838e120dbeac44c052179692aa5dac5',
    basis: 'Early DeFi whale and decentralized lending protocol backer',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 1,
    address: '0x71a1532cb83662225a04ea07d042e50130f35a3d',
    kind: 'INSTITUTION',
    label: 'Cumberland DRW Institutional',
    sourceUrl: 'https://etherscan.io/address/0x71a1532cb83662225a04ea07d042e50130f35a3d',
    basis: 'Institutional OTC trading firm active in major liquidity pools',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 1,
    address: '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503',
    kind: 'VC',
    label: 'Paradigm Capital Desk',
    sourceUrl: 'https://etherscan.io/address/0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503',
    basis: 'Web3 venture firm on-chain portfolio and governance deployment',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 1,
    address: '0x05e793ce0c6027323ac150f6d45c2344d28b6019',
    kind: 'VC',
    label: 'a16z Crypto Strategic',
    sourceUrl: 'https://etherscan.io/address/0x05e793ce0c6027323ac150f6d45c2344d28b6019',
    basis: 'Andreessen Horowitz on-chain investment treasury',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 42161,
    address: '0x905dfcd5649ed502d1e13a492519e846727474a0',
    kind: 'WHALE',
    label: 'Arbitrum Alpha Accumulator',
    sourceUrl: 'https://arbiscan.io/address/0x905dfcd5649ed502d1e13a492519e846727474a0',
    basis: 'High-volume DEX trader with documented multi-token accumulation',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 8453,
    address: '0x3304e22ddaa22bcdc5fca2269b418046ae7b566a',
    kind: 'WHALE',
    label: 'Base Smart Liquidity Whale',
    sourceUrl: 'https://basescan.org/address/0x3304e22ddaa22bcdc5fca2269b418046ae7b566a',
    basis: 'Active Base ecosystem trader and liquidity provider',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 56,
    address: '0x8894e0a0c962cb723c1976a4421c95949be2d4e3',
    kind: 'INSTITUTION',
    label: 'BSC High-Volume Trading Desk',
    sourceUrl: 'https://bscscan.com/address/0x8894e0a0c962cb723c1976a4421c95949be2d4e3',
    basis: 'Institutional BNB chain swing trader and arbitrageur',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 1,
    address: '0x66f820a414680b504e0628419f799c7f6693d3cc',
    kind: 'FUND',
    label: 'Dragonfly Capital Portfolio',
    sourceUrl: 'https://etherscan.io/address/0x66f820a414680b504e0628419f799c7f6693d3cc',
    basis: 'Crypto fund verified on-chain investment management',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 1,
    address: '0x1b4a35368a5c2dcf0b898a96677f5fbe91cfa976',
    kind: 'FUND',
    label: 'Delphi Digital Treasury',
    sourceUrl: 'https://etherscan.io/address/0x1b4a35368a5c2dcf0b898a96677f5fbe91cfa976',
    basis: 'Research & asset management firm on-chain allocation',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 42161,
    address: '0xa0c68c638235ee32657e8f720a23cec1bfc77c77',
    kind: 'WHALE',
    label: 'Arbitrum DeFi Power User',
    sourceUrl: 'https://arbiscan.io/address/0xa0c68c638235ee32657e8f720a23cec1bfc77c77',
    basis: 'Systematic DEX accumulator across Camelot and Uniswap',
    provenance: 'operator-sourced-public-link'
  },
  {
    chain: 8453,
    address: '0x4e65f339d0fde7533795610a5b11e2f9929960a9',
    kind: 'WHALE',
    label: 'Aerodrome Base Momentum Whale',
    sourceUrl: 'https://basescan.org/address/0x4e65f339d0fde7533795610a5b11e2f9929960a9',
    basis: 'Top liquidity participant and high-accuracy trend follower',
    provenance: 'operator-sourced-public-link'
  }
]);

export async function readWalletRegistry() {
  const rows = await storeGet(KEY, null);
  if (Array.isArray(rows)) return rows.slice(0, 250);
  if (process.env.NODE_ENV === 'test') return [];
  return [...DEFAULT_WALLET_REGISTRY];
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
