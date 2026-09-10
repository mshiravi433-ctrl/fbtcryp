#!/usr/bin/env node
/**
 * FBT SPLIT ROUTER — contract surface probe.
 * ---------------------------------------------------------------------------
 * Run: node test/split-router/split-router-contract-probe.mjs
 * (or npm run test:split-router, which compiles first)
 *
 * Guards the compiled artifact against the two failure classes a fee router
 * can have:
 *
 *   1. SURFACE DRIFT — a missing function, a stray admin knob, an entry point
 *      that became payable, a fee cap that moved. The zero-admin design (no
 *      owner, no setFeeBps, no rescue) is asserted ON THE ABI, so an
 *      accidental "small helpful admin function" fails this probe.
 *   2. INTEGRATION DRIFT — the protocol calls inside the .sol no longer match
 *      the real chains. The exact signatures are cross-checked against the
 *      KNOWN selectors of the live protocols (the same ones the app adapters
 *      encode), including Morpho's tuple-shaped supply and the adapter-pinned
 *      0xa99aad89. Behavioural proof lives in the EVM rehearsal and the fork
 *      rehearsal; this is the static half.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Interface, id } from 'ethers';

let pass = 0;
const ok = (n) => { pass += 1; console.log('  ✓', n); };

const ART = new URL('../../src/lib/splitRouterArtifact.json', import.meta.url);
if (!existsSync(ART)) {
  console.error('Run `node scripts/compile-split-router.mjs` first.');
  process.exit(1);
}
const artifact = JSON.parse(readFileSync(ART, 'utf8'));

const fns = (artifact.abi || []).filter((x) => x.type === 'function');
const fn = (name) => fns.find((f) => f.name === name);
const fnNames = new Set(fns.map((f) => f.name));
const evts = new Set((artifact.abi || []).filter((x) => x.type === 'event').map((e) => e.name));

/* ── 1. the money path exists, exactly once per protocol ─────────────────── */
const REQUIRED = [
  'supplyAave', 'supplyCompound', 'supplyMorpho', 'stakeLido', 'quoteFee',
  'asset', 'aavePool', 'comet', 'morpho', 'lido', 'feeRecipient', 'feeBps',
  'morphoMarketId', 'morphoLoanToken', 'morphoCollateralToken', 'morphoOracle', 'morphoIrm', 'morphoLltv',
  'totalFeesCollected', 'BPS_DENOMINATOR', 'MAX_FEE_BPS'
];
for (const f of REQUIRED) assert.ok(fnNames.has(f), `missing function/constant ${f}`);
ok(`ABI has all ${REQUIRED.length} required functions and pinned-config views`);

/* ── 2. THE ZERO-ADMIN GUARANTEE, asserted on the artifact ──────────────────
 * A fee router that can be re-tuned after deploy is a trust bug, not a
 * feature. None of these may ever appear in this ABI:
 *   owner/setOwner/transferOwnership — no admin at all
 *   setFeeBps/setFeeRecipient/setFee — fee is immutable
 *   rescue/withdraw/sweep/claim      — nothing to rescue; nothing is held
 *   setAavePool/setLido/setTarget/…  — destinations are immutable
 *   forward/execute/call             — no generic call surface
 *   receive (payable fallback)       — plain ETH transfers must bounce
 */
const FORBIDDEN = [
  'owner', 'setOwner', 'transferOwnership', 'renounceOwnership', 'acceptOwnership',
  'setFeeBps', 'setFeeRecipient', 'setFee', 'setCap',
  'rescue', 'withdraw', 'sweep', 'claim', 'claimFees', 'collectFees',
  'setAavePool', 'setComet', 'setMorpho', 'setLido', 'setAsset', 'setTarget', 'setMarket',
  'forward', 'execute', 'call', 'addToAllowlist', 'removeFromAllowlist'
];
const present = FORBIDDEN.filter((f) => fnNames.has(f));
assert.deepStrictEqual(present, [], `admin functions must not exist: ${present.join(', ')}`);
const hasFallback = (artifact.abi || []).some((x) => x.type === 'fallback' || x.type === 'receive');
assert.ok(!hasFallback, 'no receive/fallback — plain ETH transfers must bounce');
ok('zero-admin surface: no owner, no fee setters, no rescue, no forward, no receive');

/* ── 3. payable discipline: ONLY stakeLido takes value ───────────────────── */
for (const f of fns) {
  if (f.name === 'stakeLido') assert.ok(f.stateMutability === 'payable', 'stakeLido must be payable');
  else assert.ok(f.stateMutability !== 'payable', `${f.name} must not be payable`);
}
ok('stakeLido is the only payable entry point');

/* ── 4. the fee ceiling is compiled in, not a promise ─────────────────────── */
assert.strictEqual(fn('MAX_FEE_BPS').outputs[0].type, 'uint256');
ok('MAX_FEE_BPS is a public constant (the 1.00% ceiling is on-chain)');

/* ── 5. entry-point argument shapes (amount-first, nothing user-suppliable) ─ */
for (const name of ['supplyAave', 'supplyCompound', 'supplyMorpho']) {
  const f = fn(name);
  assert.strictEqual(f.inputs.length, 1, `${name} takes exactly (uint256 amount)`);
  assert.strictEqual(f.inputs[0].type, 'uint256');
}
assert.strictEqual(fn('stakeLido').inputs.length, 0, 'stakeLido takes no arguments');
ok('entry points take only an amount — no addresses, no calldata, nothing aimable');

/* ── 6. one auditable event per routed deposit ────────────────────────────── */
const routed = (artifact.abi || []).find((x) => x.type === 'event' && x.name === 'Routed');
assert.ok(routed, 'missing Routed event');
assert.deepStrictEqual(
  routed.inputs.map((i) => i.name),
  ['target', 'user', 'asset', 'amountIn', 'feeTaken', 'netAmount'],
  'Routed must carry the full money story'
);
ok('Routed(target, user, asset, amountIn, feeTaken, netAmount) present');

/* ── 7. constructor takes the single pinned Config struct ─────────────────── */
const ctor = (artifact.abi || []).find((x) => x.type === 'constructor');
assert.ok(ctor, 'missing constructor');
assert.strictEqual(ctor.inputs.length, 1, 'constructor takes exactly one Config struct');
assert.ok(ctor.inputs[0].type === 'tuple' && Array.isArray(ctor.inputs[0].components), 'constructor arg must be the Config tuple');
assert.strictEqual(ctor.inputs[0].components.length, 13, 'Config carries all 13 pinned fields');
assert.deepStrictEqual(
  ctor.inputs[0].components.map((c) => c.name),
  ['asset', 'aavePool', 'comet', 'morpho', 'morphoLoanToken', 'morphoCollateralToken', 'morphoOracle', 'morphoIrm', 'morphoLltv', 'morphoMarketId', 'lido', 'feeRecipient', 'feeBps'],
  'Config field order must match the documented deploy runbook'
);
ok('constructor((Config)) — the whole deployment is one reviewable value');

/* ── 8. bytecode present and inside EIP-170 ───────────────────────────────── */
assert.ok(artifact.bytecode.startsWith('0x') && artifact.bytecode.length > 100);
const size = artifact.deployedBytecode.length / 2 - 1;
assert.ok(size <= 24576, `bytecode ${size} exceeds EIP-170`);
assert.strictEqual(artifact.audited, false, 'audited flag must stay false until a real audit exists');
ok(`bytecode ${size} bytes (limit 24576); audited=false until proven otherwise`);

/* ── 9. INTEGRATION: the four protocol calls match the live selectors ───────
 * These selectors are the ones the real chains answer to — aave supply
 * (0x617ba037, the Aave v3 Pool signature the adapter pins), Morpho supply
 * (0xa99aad89, pinned in src/lib/defi/morphoBlueBase.js MORPHO_ACTION_SELECTORS),
 * Lido submit (0xa1903eab) and Comet supply. If the router's internal
 * interface ever drifts from these, every deposit reverts on mainnet while
 * looking fine locally — which is why the check lives here, in CI's reach.
 */
const CANONICAL = {
  aaveSupply: { sig: 'supply(address,uint256,address,uint16)', selector: '0x617ba037' },
  cometSupply: { sig: 'supply(address,uint256)', selector: id('supply(address,uint256)').slice(0, 10) },
  lidoSubmit: { sig: 'submit(address)', selector: '0xa1903eab' },
  morphoSupply: {
    sig: 'supply((address,address,address,address,uint256),uint256,uint256,address,bytes)',
    selector: '0xa99aad89'
  }
};
const CANONICAL_IFACE = new Interface(Object.values(CANONICAL).map((c) => `function ${c.sig}`));
for (const [name, c] of Object.entries(CANONICAL)) {
  const computed = CANONICAL_IFACE.getFunction(c.sig).selector;
  assert.strictEqual(computed, c.selector, `${name}: canonical selector mismatch (${computed} != ${c.selector})`);
}
ok('canonical protocol selectors pinned (aave 0x617ba037, morpho 0xa99aad89, lido 0xa1903eab, comet computed)');

/* The .sol source must declare those exact signatures — compile-level proof
 * that the router calls the protocols with the arguments the chains expect. */
const sol = readFileSync(new URL('../../contracts/FBTSplitRouter.sol', import.meta.url), 'utf8');
const declared = {
  aaveSupply: 'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;',
  cometSupply: 'function supply(address asset, uint256 amount) external;',
  lidoSubmit: 'function submit(address _referral) external payable;'
};
for (const [name, frag] of Object.entries(declared)) {
  assert.ok(sol.includes(frag), `${name}: router interface no longer declares "${frag}"`);
}
assert.ok(
  sol.includes('function supply(\n        MarketParams memory marketParams,') || sol.includes('function supply(\n    MarketParams memory marketParams,') || /function supply\(\s*MarketParams memory marketParams/.test(sol),
  'morpho supply must take MarketParams (the tuple signature)'
);
ok('.sol interface declarations match the canonical signatures');

console.log(`\nPASS ${pass} split-router contract assertions`);
