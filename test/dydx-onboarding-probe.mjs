#!/usr/bin/env node
/**
 * dYdX onboarding signature — the reported bug:
 *
 *   «اتصال dYdX → could not coalesce error (WALLET_RETURNED_UNSIGNED) …
 *    eth_signTypedData_v4 … "chainId":"0x1"»
 *
 * The wallet sat on BNB Chain (the app default) while the onboarding typed
 * data is bound to Ethereum (domain chainId 1). Real wallets refuse or drop
 * that mismatch, so no prompt appeared. This probe drives the REAL
 * src/lib/dydx.js against a simulated EIP-1193 wallet that behaves like
 * MetaMask/Trust: it rejects typed data whose domain chainId differs from its
 * active chain, and signs with a real secp256k1 key otherwise.
 *
 * Asserts:
 *   1. the wallet is switched to Ethereum BEFORE the signature is requested;
 *   2. the payload is the dydx.trade/viem shape (numeric chainId 1);
 *   3. the signature equals what ethers' signTypedData produced before this
 *      change — so the derived dYdX address is unchanged for every user;
 *   4. the derived dYdX address is a valid dydx1… bech32 address;
 *   5. a refused switch, a legacy return-timeout code and a 4001 each map to
 *      the right `dydx.err.*` code; the WC wallet is put back on its chain.
 *
 * No network.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Wallet } from 'ethers';
import {
  requestDydxOnboardingSignature,
  dydxOnboardingTypedData,
  classifyDydxError,
  DYDX_ONBOARDING_CHAIN_ID
} from '../src/lib/dydx.js';

const require = createRequire(import.meta.url);

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const signer = new Wallet(KEY);

function fakeWallet({ startChain = 56, approved = [1, 56, 42161], refuseSwitch = false, returnUnsigned = false, reject = false } = {}) {
  const log = [];
  const w = {
    chainId: startChain,
    async request({ method, params = [] }) {
      log.push(method);
      if (method === 'eth_chainId') return `0x${w.chainId.toString(16)}`;
      if (method === 'eth_accounts') return [signer.address];
      if (method === 'eth_signTypedData_v4') {
        const [addr, raw] = params;
        const typed = JSON.parse(raw);
        w.lastPayload = typed;
        assert.equal(addr.toLowerCase(), signer.address.toLowerCase());
        if (reject) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
        if (returnUnsigned) throw Object.assign(new Error('WALLET_RETURNED_UNSIGNED'), { code: 'WALLET_RETURNED_UNSIGNED' });
        const domainChain = Number(typed.domain.chainId);
        if (domainChain !== w.chainId) {
          /* MetaMask's exact wording; Trust drops it silently (→ RETURNED_UNSIGNED). */
          throw Object.assign(new Error(`Provided chainId "${domainChain}" must match the active chainId "${w.chainId}"`), { code: -32602 });
        }
        const types = { ...typed.types };
        delete types.EIP712Domain;
        return signer.signTypedData(typed.domain, types, typed.message);
      }
      throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
    }
  };
  const switchChain = async (id) => {
    log.push(`switch:${id}`);
    if (refuseSwitch) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
    if (!approved.includes(id)) return false;
    /* chainChanged lands a beat after the switch resolves, like the SDK. */
    setTimeout(() => { w.chainId = id; }, 120);
    return true;
  };
  return { w, log, switchChain };
}

let passed = 0;
const ok = (name) => { passed += 1; console.log(`  ✓ ${name}`); };

console.log('dYdX onboarding probe');

/* 0 — the typed data is the official one, bound to Ethereum. */
{
  const t = dydxOnboardingTypedData();
  assert.equal(DYDX_ONBOARDING_CHAIN_ID, 1);
  assert.deepEqual(t.domain, { name: 'dYdX Chain', chainId: 1 });
  assert.equal(typeof t.domain.chainId, 'number');
  assert.equal(t.primaryType, 'dYdX');
  assert.deepEqual(t.message, { action: 'dYdX Chain Onboarding' });
  ok('typed data = dYdX Chain / chainId 1 (number) / "dYdX Chain Onboarding"');
}

/* 1 — the reported state: wallet on BSC. Without a switch it would refuse. */
{
  const { w, log, switchChain } = fakeWallet({ startChain: 56 });
  const stages = [];
  const sig = await requestDydxOnboardingSignature({
    getProvider: () => w,
    address: signer.address,
    switchChain,
    restoreChain: true,
    onStage: (s) => stages.push(s)
  });
  assert.ok(log.indexOf('switch:1') >= 0, 'switched to Ethereum');
  assert.ok(log.indexOf('switch:1') < log.indexOf('eth_signTypedData_v4'), 'switch happens before the signature');
  assert.deepEqual(stages, ['switch', 'sign']);
  assert.equal(typeof w.lastPayload.domain.chainId, 'number', 'numeric chainId like viem');
  assert.equal(w.lastPayload.domain.chainId, 1);

  const expected = await signer.signTypedData(
    { name: 'dYdX Chain', chainId: 1 },
    { dYdX: [{ name: 'action', type: 'string' }] },
    { action: 'dYdX Chain Onboarding' }
  );
  assert.equal(sig, expected, 'identical to the previous ethers signature → same dYdX account');
  ok('BSC wallet is moved to Ethereum first, then signs; signature unchanged vs. before');

  await new Promise((r) => setTimeout(r, 50));
  assert.ok(log.includes('switch:56'), 'WalletConnect wallet restored to its original chain');
  ok('wallet is put back on BNB Chain afterwards (restoreChain)');

  const sdk = require('@dydxprotocol/v4-client-js');
  const { mnemonic } = sdk.onboarding.deriveHDKeyFromEthereumSignature(sig);
  const local = await sdk.LocalWallet.fromMnemonic(mnemonic, 'dydx');
  assert.match(local.address, /^dydx1[02-9ac-hj-np-z]{38}$/);
  ok(`derives a valid dYdX address (${local.address.slice(0, 12)}…)`);
}

/* 2 — already on Ethereum: no switch at all. */
{
  const { w, log, switchChain } = fakeWallet({ startChain: 1 });
  await requestDydxOnboardingSignature({ getProvider: () => w, address: signer.address, switchChain });
  assert.ok(!log.some((m) => m.startsWith('switch:')));
  ok('wallet already on Ethereum → no switch request');
}

/* 3 — local vault: no chain requirement. */
{
  const { w, log, switchChain } = fakeWallet({ startChain: 56 });
  /* a local signer does not enforce the domain chain */
  const loose = { request: async (a) => (a.method === 'eth_signTypedData_v4' ? (w.chainId = 1, w.request(a)) : w.request(a)) };
  await requestDydxOnboardingSignature({ getProvider: () => loose, address: signer.address, switchChain, requireChain: false });
  assert.ok(!log.some((m) => m.startsWith('switch:')));
  ok('in-app vault is not switched (requireChain:false)');
}

/* 4 — failures are named, not «could not coalesce». */
{
  const a = fakeWallet({ startChain: 56, approved: [56] });
  await assert.rejects(
    requestDydxOnboardingSignature({ getProvider: () => a.w, address: signer.address, switchChain: a.switchChain }),
    (e) => classifyDydxError(e) === 'NEEDS_ETHEREUM'
  );
  ok('session without Ethereum → NEEDS_ETHEREUM');

  const b = fakeWallet({ startChain: 56, refuseSwitch: true });
  await assert.rejects(
    requestDydxOnboardingSignature({ getProvider: () => b.w, address: signer.address, switchChain: b.switchChain }),
    (e) => classifyDydxError(e) === 'SWITCH_REJECTED'
  );
  ok('declined switch → SWITCH_REJECTED');

  const c = fakeWallet({ startChain: 1, returnUnsigned: true });
  await assert.rejects(
    requestDydxOnboardingSignature({ getProvider: () => c.w, address: signer.address, switchChain: c.switchChain }),
    (e) => classifyDydxError(e) === 'RETURNED_UNSIGNED'
  );
  ok('legacy provider return-timeout code → RETURNED_UNSIGNED');

  const d = fakeWallet({ startChain: 1, reject: true });
  await assert.rejects(
    requestDydxOnboardingSignature({ getProvider: () => d.w, address: signer.address, switchChain: d.switchChain }),
    (e) => classifyDydxError(e) === 'REJECTED'
  );
  ok('user rejected (4001) → REJECTED');

  /* the exact ethers wrapper from the report */
  const coalesced = Object.assign(new Error('could not coalesce error (error={ "code": "WALLET_RETURNED_UNSIGNED" })'), {
    code: 'UNKNOWN_ERROR',
    error: { code: 'WALLET_RETURNED_UNSIGNED', message: 'WALLET_RETURNED_UNSIGNED' }
  });
  assert.equal(classifyDydxError(coalesced), 'RETURNED_UNSIGNED');
  ok('ethers "could not coalesce error" wrapper → RETURNED_UNSIGNED');

  const other = new Wallet('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');
  const e = fakeWallet({ startChain: 1 });
  const liar = { request: async (a) => (a.method === 'eth_signTypedData_v4'
    ? other.signTypedData({ name: 'dYdX Chain', chainId: 1 }, { dYdX: [{ name: 'action', type: 'string' }] }, { action: 'dYdX Chain Onboarding' })
    : e.w.request(a)) };
  await assert.rejects(
    requestDydxOnboardingSignature({ getProvider: () => liar, address: signer.address, switchChain: e.switchChain }),
    (err) => classifyDydxError(err) === 'SIGNER_MISMATCH'
  );
  ok('signature from a different account → SIGNER_MISMATCH (no wrong dYdX account)');
}

console.log(`dYdX onboarding probe: ${passed} checks passed`);
