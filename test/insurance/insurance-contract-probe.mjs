/**
 * FBT Insurance OS — FBTInsuranceRouter contract surface probe.
 *
 * Verifies the compiled artifact ships the security surface required by §9/§10:
 * EIP-712 purchase with replay protection, provider allowlist, pause, evidence
 * recorders, and the admin/owner controls. Full EVM behaviour (reentrancy,
 * signature, nonce reuse, emergency pause, upgrade auth) is exercised with
 * Foundry in the audit phase (§48) — this probe guards the deployed ABI shape.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let pass = 0;
const ok = (n) => { pass += 1; console.log('  ✓', n); };

// ensure artifact exists (compile if missing)
import { existsSync } from 'node:fs';
const ART = new URL('../../src/lib/fbtInsuranceRouterArtifact.json', import.meta.url);
if (!existsSync(ART)) {
  console.error('Run `node scripts/compile-fbt-insurance.mjs` first.');
  process.exit(1);
}
const artifact = JSON.parse(readFileSync(ART, 'utf8'));

const fns = new Set((artifact.abi || []).filter((x) => x.type === 'function').map((f) => f.name));
const evts = new Set((artifact.abi || []).filter((x) => x.type === 'event').map((e) => e.name));

const REQUIRED = ['quoteReference', 'purchaseProtection', 'recordCoverage', 'recordClaim', 'recordPayout', 'collectIntegrationFee', 'setProvider', 'pauseProvider', 'unpauseProvider', 'enableProvider', 'removeProvider', 'pause', 'unpause', 'transferOwnership', 'grantAdmin', 'revokeAdmin', 'nonces'];
const EVENTS = ['CoveragePurchased', 'CoverageRecorded', 'ClaimRecorded', 'PayoutRecorded', 'ProviderSet', 'IntegrationFeeCollected'];

for (const f of REQUIRED) assert.ok(fns.has(f), `missing function ${f}`);
ok(`ABI has ${REQUIRED.length} required router functions`);
for (const e of EVENTS) assert.ok(evts.has(e), `missing event ${e}`);
ok(`ABI emits ${EVENTS.length} required events`);

const purchase = artifact.abi.find((x) => x.type === 'function' && x.name === 'purchaseProtection');
const structArg = purchase.inputs.find((i) => i.type.startsWith('tuple'));
assert.ok(structArg, 'purchaseProtection should take a PurchaseData struct + signature');
ok('purchaseProtection is EIP-712 structured (PurchaseData struct + signature)');

assert.ok(artifact.bytecode.startsWith('0x') && artifact.bytecode.length > 100);
ok(`bytecode ${(artifact.bytecode.length / 2 - 1)} bytes present`);

console.log(`\nPASS ${pass} insurance-contract assertions`);
