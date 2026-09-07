/*
 * AUTONOMY DRIVERS PROBE — does browserDrivers.js actually satisfy the
 * executors, or only compile?
 * ---------------------------------------------------------------------------
 * This module is the seam between the app's real trading primitives and the
 * venue executors. It was build-verified and never executed. If a method name
 * drifts on either side, EVERY venue fails at runtime with
 * VENUE_DRIVER_MISSING while the whole suite stays green — because
 * autonomy-execution-probe drives the executors with fakes that already agree.
 *
 * So this pins the real contract on both ends:
 *   · each executor's hasDrivers() predicate passes against the REAL
 *     buildAutonomyDrivers() output
 *   · before warm(), readiness reports false rather than guessing
 *   · warm() never throws even when a module cannot load here (solanaWallet.js
 *     imports an extensionless './nativeShell', which plain Node cannot
 *     resolve) — it settles, and readiness says honestly what is missing
 *   · a driver set with no wallet hands back a null signer instead of throwing
 */
import {
  warmAutonomyDrivers,
  autonomyDriverReadiness,
  buildAutonomyDrivers
} from '../../src/lib/intent-ai/autonomy/browserDrivers.js';
import { VENUE_EXECUTORS } from '../../src/lib/intent-ai/autonomy/venueExecutors.js';

const results = [];
const check = (name, ok, extra) => results.push({ name, ok: !!ok, extra });

/* ── 1. Before warm(): nothing is claimed ───────────────────────────────── */
const cold = autonomyDriverReadiness();
check('before warm() no venue is claimed ready',
  cold.swap === false && cold.lending === false && cold.aaveBase === false
  && cold.perp === false && cold.equity === false && cold.warmed === false,
  JSON.stringify(cold));

/* ── 2. warm() settles instead of throwing ──────────────────────────────── */
let warmThrew = null;
let warmResult = null;
try { warmResult = await warmAutonomyDrivers(); } catch (err) { warmThrew = err; }
check('warm() never throws even when a module cannot resolve here', warmThrew === null, warmThrew?.message);
check('warm() reports ok', warmResult?.ok === true, JSON.stringify(warmResult));

/* Calling it twice must be safe — the chat warms on every wallet change. */
let secondThrew = null;
try { await warmAutonomyDrivers(); } catch (err) { secondThrew = err; }
check('warm() is safe to call repeatedly', secondThrew === null, secondThrew?.message);

const warm = autonomyDriverReadiness();
check('readiness exposes every venue key',
  ['swap', 'lending', 'aaveBase', 'perp', 'equity', 'warmed'].every((k) => k in warm),
  JSON.stringify(Object.keys(warm)));
check('readiness values are booleans, never undefined',
  Object.values(warm).every((v) => typeof v === 'boolean'), JSON.stringify(warm));

/* Whatever loaded, it must be reported truthfully — this is the module's own
   rule, so assert the shape of the claim rather than a specific outcome. */
console.log('  readiness after warm:', JSON.stringify(warm));

/* ── 3. The driver set satisfies every executor's hasDrivers() ──────────── */
const drivers = buildAutonomyDrivers({
  wallet: { connected: true, address: '0xabc', chainId: 8453, getSigner: () => ({ fake: true }), getReadProvider: async () => null },
  solana: { connected: true, address: 'SoL11111111111111111111111111111111111111111' },
  onStep: () => {},
  priceOf: async () => 100,
  equityAssets: []
});

check('buildAutonomyDrivers returns an object', !!drivers && typeof drivers === 'object');
for (const key of ['wallet', 'swap', 'lending', 'aaveBase', 'perp', 'equity', 'risk', 'market', 'wallets']) {
  check(`driver set exposes \`${key}\``, !!drivers[key], JSON.stringify(Object.keys(drivers || {})));
}

/*
 * The contract that matters — and the one that was broken.
 *
 * `hasDrivers()` must AGREE with `readiness()`. It does not matter which way
 * this particular environment lands (in a browser warm() succeeds and both
 * are true; under plain Node the extensionless imports fail and both are
 * false). What must never happen is hasDrivers saying "ready" for a venue
 * whose module is not loaded, because then the executor passes its gate and
 * the call fails as a raw TypeError instead of the named VENUE_DRIVER_MISSING.
 *
 * An earlier version of this probe asserted `hasDrivers === true` for every
 * executor, which locked in exactly that bug.
 */
const executors = Array.isArray(VENUE_EXECUTORS) ? VENUE_EXECUTORS : Object.values(VENUE_EXECUTORS || {});
check('the executor registry is not empty', executors.length > 0, executors.length);

/* Which readiness flag each gated venue is supposed to honour. */
const VENUE_READINESS_KEY = {
  'lend-aave': 'lending',
  'aave-base-usdc': 'aaveBase',
  'perp-velocity': 'perp',
  'equity-solana': 'equity'
};
for (const ex of executors) {
  if (typeof ex.hasDrivers !== 'function') continue;
  const key = VENUE_READINESS_KEY[ex.id];
  if (!key) continue;
  check(`executor \`${ex.id}\` agrees with readiness.${key}`,
    ex.hasDrivers(drivers) === Boolean(warm[key]),
    `hasDrivers=${ex.hasDrivers(drivers)} readiness.${key}=${warm[key]}`);
}

/* No venue may expose a method its module did not provide. */
const VENUE_METHOD = {
  lending: 'runLendingPlan',
  aaveBase: 'buildSupplyPlan',
  perp: 'openVelocityPosition',
  equity: 'resolveAsset'
};
for (const [venue, method] of Object.entries(VENUE_METHOD)) {
  const exposed = typeof drivers[venue]?.[method] === 'function';
  check(`\`${venue}.${method}\` is exposed only when its module loaded`,
    exposed === Boolean(warm[venue]),
    `exposed=${exposed} readiness.${venue}=${warm[venue]}`);
}

/* swap-evm is the one executor with no module gate — it must stay available,
   because refusing the swapper would break the one path that always worked. */
const swapEx = executors.find((ex) => ex.id === 'swap-evm');
check('swap-evm stays available regardless of warm state', swapEx?.hasDrivers(drivers) === true);

/* And with no drivers at all, every gated executor refuses — which is what
   keeps a missing wallet from falling through to the swap path. */
const alwaysAvailable = executors
  .filter((ex) => typeof ex.hasDrivers === 'function' && ex.hasDrivers({}) === true)
  .map((ex) => ex.id);
check('only swap-evm runs without drivers', alwaysAvailable.join(',') === 'swap-evm', alwaysAvailable.join(','));

/* ── 4. No wallet means no signer, not a throw ──────────────────────────── */
const anon = buildAutonomyDrivers({});
let signerThrew = null;
let signer = 'unset';
try { signer = anon.wallet.getSigner(); } catch (err) { signerThrew = err; }
check('a driver set with no wallet does not throw on getSigner', signerThrew === null, signerThrew?.message);
check('it hands back a null signer rather than inventing one', signer === null, String(signer));
check('it reports no evm wallet', anon.wallets.evm === false, JSON.stringify(anon.wallets));
check('it reports no solana wallet', anon.wallets.solana === false, JSON.stringify(anon.wallets));

let providerThrew = null;
let provider = 'unset';
try { provider = await anon.wallet.getReadProvider(8453); } catch (err) { providerThrew = err; }
check('getReadProvider with no wallet resolves to null', providerThrew === null && provider === null, String(provider));

/* The connected set must report the opposite. */
check('a connected evm wallet is reported', drivers.wallets.evm === true, JSON.stringify(drivers.wallets));
check('a connected solana wallet is reported', drivers.wallets.solana === true, JSON.stringify(drivers.wallets));
check('the connected set hands back the wallet signer', drivers.wallet.getSigner()?.fake === true);

/* ── 5. The risk and market readers degrade to null, never to a guess ───── */
check('the market reader returns the injected price', (await drivers.market.priceOf('BTC')) === 100);
const anonMark = await buildAutonomyDrivers({}).market.priceOf('BTC');
check('with no price reader the mark is null, not zero', anonMark === null, String(anonMark));

const results2 = [];
const main = async () => {
  const passed = results.filter((r) => r.ok).length;
  results2.push(passed);
  console.log(`probe: ${passed}/${results.length} passed`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    for (const f of failed) console.log(`✗ ${f.name}${f.extra ? ` — ${f.extra}` : ''}`);
    process.exit(1);
  }
  console.log('OK: intent-ai/autonomy-drivers-probe');
};
await main();
