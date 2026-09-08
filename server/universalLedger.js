/**
 * FBT UNIVERSAL LEDGER
 * ---------------------------------------------------------------------------
 * A central, immutable ledger for all accounting events across the FBT OS.
 * (SWAP, BRIDGE, LOAN, REPAY, DEPOSIT, WITHDRAW, FEE, PAY, RWA_TRADE)
 */
import { storeGet, storeSet } from './store.js';
import crypto from 'node:crypto';

export const SCHEMA = 'fbt.universal-ledger.v1';

function ledgerKey(owner) {
  return `ledger:${owner}`;
}

export async function appendLedgerEvent(owner, { type, amount, asset, chain, hash, provider, fee, metadata }) {
  const id = crypto.randomUUID();
  const entry = {
    id,
    type,
    amount: Number(amount) || 0,
    asset,
    chain,
    hash,
    provider,
    fee: Number(fee) || 0,
    metadata: metadata || {},
    timestamp: Date.now(),
    schema: SCHEMA
  };
  
  const current = await storeGet(ledgerKey(owner), []);
  current.push(entry);
  
  // Keep the last 1000 events to avoid hitting memory/blob limits
  if (current.length > 1000) current.shift();
  
  await storeSet(ledgerKey(owner), current);
  
  return entry;
}

export async function getLedger(owner) {
  const current = await storeGet(ledgerKey(owner), []);
  return current.sort((a, b) => b.timestamp - a.timestamp);
}
