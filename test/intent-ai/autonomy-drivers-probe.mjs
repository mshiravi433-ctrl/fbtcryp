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
  buildAutonomyDrivers,
  signerOnChain
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

/* WalletContext exposes `isConnected`, not `connected`. The driver boundary
   must accept that public contract, prefer it over a conflicting legacy alias,
   and never promote an address-only locked wallet into a signing channel. */
const contextOnly = buildAutonomyDrivers({
  wallet: { isConnected: true, address: '0xcontext', chainId: 1, getSigner: () => ({ fake: true }) }
});
check('WalletContext isConnected is normalized by the driver', contextOnly.wallets.evm === true, JSON.stringify(contextOnly.wallets));
check('normalized WalletContext wallet is signable', contextOnly.wallets.signable.includes('evm'), JSON.stringify(contextOnly.wallets.signable));
const staleConnectedAlias = buildAutonomyDrivers({
  wallet: { isConnected: false, connected: true, address: '0xstale', getSigner: () => ({ fake: true }) }
});
check('canonical isConnected=false overrides a stale connected=true alias', staleConnectedAlias.wallets.evm === false, JSON.stringify(staleConnectedAlias.wallets));
check('stale connected alias does not grant signing capability', staleConnectedAlias.wallets.signable.length === 0, JSON.stringify(staleConnectedAlias.wallets.signable));
const lockedContext = buildAutonomyDrivers({
  wallet: { isConnected: false, connected: false, address: '0xlocked', locked: true, getSigner: () => null }
});
check('locked address is not reported as a connected EVM signer', lockedContext.wallets.evm === false, JSON.stringify(lockedContext.wallets));
check('locked address cannot sign', lockedContext.wallets.signable.length === 0, JSON.stringify(lockedContext.wallets.signable));

/* The connected set must report the opposite. */
check('a connected evm wallet is reported', drivers.wallets.evm === true, JSON.stringify(drivers.wallets));
check('a connected solana wallet is reported', drivers.wallets.solana === true, JSON.stringify(drivers.wallets));
check('the connected set hands back the wallet signer', drivers.wallet.getSigner()?.fake === true);

/* ── 4b. A lending write is only ever signed on a PROVEN network ──────────
   lib/lending.js signs against whatever network the signer happens to be on,
   so the driver set must hand the executor a signer whose own provider says it
   is on the reviewed chain — switching the wallet when it is not, and refusing
   (never guessing) when it cannot be proven. */
const netSigner = (chainId) => ({ provider: { getNetwork: async () => ({ chainId: BigInt(chainId) }) }, tag: `on-${chainId}` });
check('the driver set exposes a chain-verifying signer', typeof drivers.wallet.getSignerForChain === 'function');
check('the lending driver exposes the oracle, account and position readers the executor re-reads',
  ['readOraclePrices', 'readUserAccount', 'readAssetPosition', 'readReserve', 'readAllowance'].every((k) => typeof drivers.lending[k] === 'function' || Object.keys(drivers.lending).length === 0));
const onChain = await signerOnChain({ getSigner: () => netSigner(42161) }, 42161);
check('a signer already on the reviewed chain is returned as-is', onChain.ok === true && onChain.signer.tag === 'on-42161', JSON.stringify(onChain));
const noSwitch = await signerOnChain({ getSigner: () => netSigner(1) }, 42161);
check('a wallet on another chain with no switch capability is refused (CHAIN_MISMATCH)', noSwitch.ok === false && noSwitch.code === 'CHAIN_MISMATCH', JSON.stringify(noSwitch));
const refusedSwitch = await signerOnChain({ getSigner: () => netSigner(1), switchChain: async () => false }, 42161);
check('a switch the wallet declines is refused (CHAIN_SWITCH_FAILED)', refusedSwitch.ok === false && refusedSwitch.code === 'CHAIN_SWITCH_FAILED', JSON.stringify(refusedSwitch));
const rejectedSwitch = await signerOnChain({ getSigner: () => netSigner(1), switchChain: async () => { throw Object.assign(new Error('User rejected the request'), { code: 4001 }); } }, 42161);
check('a user who rejects the network switch is reported as USER_REJECTED', rejectedSwitch.ok === false && rejectedSwitch.code === 'USER_REJECTED', JSON.stringify(rejectedSwitch));
let liveChain = 1;
const switching = await signerOnChain({
  getSigner: () => netSigner(liveChain),
  switchChain: async (target) => { liveChain = Number(target); return true; }
}, 42161);
check('a switch is re-verified on the signer\'s own network before it is trusted', switching.ok === true && switching.signer.tag === 'on-42161', JSON.stringify(switching));
const liar = await signerOnChain({ getSigner: () => netSigner(1), switchChain: async () => true }, 42161);
check('a wallet that claims it switched but still reports the old network is refused', liar.ok === false && liar.code === 'CHAIN_MISMATCH', JSON.stringify(liar));
const unreadable = await signerOnChain({ getSigner: () => ({ provider: { getNetwork: async () => { throw new Error('rpc'); } } }) }, 42161);
check('a signer whose network cannot be read is never assumed correct', unreadable.ok === false, JSON.stringify(unreadable));
const noSigner = await signerOnChain({ getSigner: () => null }, 42161);
check('no signer is reported as NO_SIGNER', noSigner.ok === false && noSigner.code === 'NO_SIGNER', JSON.stringify(noSigner));
const badChain = await signerOnChain({ getSigner: () => netSigner(1) }, 'base');
check('a non-numeric chain is refused rather than coerced', badChain.ok === false && badChain.code === 'UNSUPPORTED_CHAIN', JSON.stringify(badChain));

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
