/**
 * PHASE 84 — SIMULATION BEFORE SIGNATURE
 * The wallet is not asked to sign a transaction that has not been run first.
 * A detected revert means no signature and a reason; a missing simulator is
 * "unavailable", which is NOT clean; and a simulation is bound to the exact
 * transaction it ran.
 */
import { readFileSync } from 'node:fs';
import {
  txFingerprint, classifyRevert, simulateBeforeSign, assertSimulatedBeforeSign,
  describeSimulation, SIMULATION_MAX_AGE_MS, PRESIGN_SCHEMA, REVERT_REASON_KEYS
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const TX = {
  from: '0xaaaabbbbccccddddeeeeffff0000111122223333',
  to: '0x1111111254eeb25477b68fb85ed929f73a960582',
  data: '0x38ed1739abcdef',
  value: '0',
  chainId: 42161
};
const clean = async () => ({ status: 'simulated-clean', gasLimit: 210000n, gasCostUsd: 0.42, mempoolPath: 'private-relay' });
const reverts = (reason) => async () => ({ status: 'revert-detected', revertReason: reason });

try {
  /* ---------- the transaction identity ---------- */
  check('a complete transaction has a fingerprint', typeof txFingerprint(TX) === 'string');
  check('an incomplete transaction has none', txFingerprint({ from: TX.from }) === null);
  check('changing the calldata changes the fingerprint', txFingerprint({ ...TX, data: '0xdeadbeef' }) !== txFingerprint(TX));
  check('changing the value changes the fingerprint', txFingerprint({ ...TX, value: '1' }) !== txFingerprint(TX));
  check('changing the chain changes the fingerprint', txFingerprint({ ...TX, chainId: 1 }) !== txFingerprint(TX));
  check('the same transaction has a stable fingerprint', txFingerprint(TX) === txFingerprint({ ...TX }));

  /* ---------- revert reasons are translated, not raw ---------- */
  check('an allowance revert is recognised', classifyRevert('ERC20: insufficient allowance').code === 'INSUFFICIENT_ALLOWANCE');
  check('a balance revert is recognised', classifyRevert('transfer amount exceeds balance').code === 'INSUFFICIENT_BALANCE');
  check('a slippage revert is recognised', classifyRevert('INSUFFICIENT_OUTPUT_AMOUNT').code === 'SLIPPAGE');
  check('a deadline revert is recognised', classifyRevert('UniswapV2Router: EXPIRED').code === 'DEADLINE');
  check('an unknown revert still gets a key', classifyRevert('0x1234').i18nKey === REVERT_REASON_KEYS.UNKNOWN);
  check('an empty revert still gets a key', classifyRevert(null).i18nKey === REVERT_REASON_KEYS.UNKNOWN);

  /* ---------- a proven revert means no signature ---------- */
  const reverted = await simulateBeforeSign({ tx: TX, simulate: reverts('ERC20: insufficient allowance'), now: NOW });
  check('a detected revert is reported as a revert', reverted.status === 'revert');
  check('a detected revert refuses the signature', reverted.signAllowed === false);
  check('a detected revert is never "proven safe"', reverted.provenSafe === false);
  check('the user is told the actual reason', reverted.i18nKey === REVERT_REASON_KEYS.INSUFFICIENT_ALLOWANCE);
  check('the raw revert string is kept for support', /insufficient allowance/i.test(reverted.revertReason));
  check('the revert carries a classified error', reverted.error.code === 'SIMULATION_REVERT');
  check('there is no override for a proven revert',
    assertSimulatedBeforeSign(reverted, TX, { userOverride: true, now: NOW }).ok === false);

  /* ---------- unavailable is not clean ---------- */
  const noSimulator = await simulateBeforeSign({ tx: TX, now: NOW });
  check('no simulator at all is unavailable', noSimulator.status === 'unavailable');
  check('unavailable does not allow signing by itself', noSimulator.signAllowed === false);
  check('unavailable is never "proven safe"', noSimulator.provenSafe === false);
  check('unavailable offers an explicit override path', noSimulator.overrideAvailable === true);
  const throwing = await simulateBeforeSign({ tx: TX, simulate: async () => { throw new Error('rpc down'); }, now: NOW });
  check('a simulator that throws is unavailable, not clean', throwing.status === 'unavailable');
  const empty = await simulateBeforeSign({ tx: TX, simulate: async () => null, now: NOW });
  check('a simulator that returns nothing is unavailable', empty.status === 'unavailable');
  const busy = await simulateBeforeSign({ tx: TX, simulate: async () => ({ status: 'provider-busy' }), now: NOW });
  check('a busy provider is unavailable, not clean', busy.status === 'unavailable');
  const unknownStatus = await simulateBeforeSign({ tx: TX, simulate: async () => ({ status: 'unknown' }), now: NOW });
  check('an unknown simulator status is never read as clean', unknownStatus.provenSafe === false);
  const incomplete = await simulateBeforeSign({ tx: { from: TX.from }, simulate: clean, now: NOW });
  check('an incomplete transaction cannot be simulated or signed', incomplete.signAllowed === false);

  /* ---------- a clean run ---------- */
  const ok = await simulateBeforeSign({ tx: TX, simulate: clean, now: NOW });
  check('a clean run allows the signature', ok.status === 'clean' && ok.signAllowed === true);
  check('a clean run is proven safe', ok.provenSafe === true);
  check('the run declares its schema', ok.schema === PRESIGN_SCHEMA);
  check('the gas estimate travels with the result', ok.gasLimit === '210000');
  check('the submission path is reported', ok.mempoolPath === 'private-relay');
  check('clean now is not clean forever', ok.expiresAt === NOW + SIMULATION_MAX_AGE_MS);
  check('the run is bound to the transaction it ran', ok.fingerprint === txFingerprint(TX));

  /* ---------- the gate the signing button reads ---------- */
  check('a clean, fresh simulation clears the gate',
    assertSimulatedBeforeSign(ok, TX, { now: NOW }).ok === true);
  check('an expired simulation does not clear the gate',
    assertSimulatedBeforeSign(ok, TX, { now: NOW + SIMULATION_MAX_AGE_MS + 1 }).status === 'stale');
  check('a simulation of a DIFFERENT transaction is worthless',
    assertSimulatedBeforeSign(ok, { ...TX, data: '0xdeadbeef' }, { now: NOW }).ok === false);
  check('the mismatch is named as a changed transaction',
    assertSimulatedBeforeSign(ok, { ...TX, value: '5' }, { now: NOW }).status === 'mismatched');
  check('no simulation at all does not clear the gate',
    assertSimulatedBeforeSign(null, TX, { now: NOW }).ok === false);
  check('a hand-made object cannot pass as a simulation',
    assertSimulatedBeforeSign({ status: 'clean', signAllowed: true }, TX, { now: NOW }).ok === false);
  check('an unavailable simulation does not clear the gate without an override',
    assertSimulatedBeforeSign(noSimulator, TX, { now: NOW }).ok === false);

  /* ---------- the override is explicit and recorded ---------- */
  const overridden = assertSimulatedBeforeSign(noSimulator, TX, { userOverride: true, now: NOW });
  check('an explicit user override may proceed', overridden.ok === true);
  check('an override is never silent', overridden.overridden === true);
  check('an override never claims the transaction is proven safe', overridden.provenSafe === false);
  check('the override is recorded with a time and a reason',
    overridden.record.overriddenAt === NOW && overridden.record.reason === 'USER_ACCEPTED_UNSIMULATED');
  check('the override record is immutable', Object.isFrozen(overridden.record));

  /* ---------- the one-line summary ---------- */
  check('a clean run reads as ok', describeSimulation(ok).tone === 'ok');
  check('a revert reads as a block', describeSimulation(reverted).tone === 'block');
  check('a revert summary names the reason', describeSimulation(reverted).i18nKey === REVERT_REASON_KEYS.INSUFFICIENT_ALLOWANCE);
  check('an unavailable run reads as a warning, not an ok', describeSimulation(noSimulator).tone === 'warn');
  check('nothing at all reads as a warning', describeSimulation(null).available === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('every revert reason is translated in en, fa and ar',
    locales.every((loc) => ['insufficientBalance', 'insufficientAllowance', 'slippage', 'deadline', 'transferFailed', 'unknown']
      .every((k) => typeof loc?.intentAI?.presign?.revert?.[k] === 'string')));
  check('the clean, unavailable and override lines are translated in en, fa and ar',
    locales.every((loc) => ['clean', 'unavailable', 'noTransaction', 'overrideAccepted']
      .every((k) => typeof loc?.intentAI?.presign?.[k] === 'string')));
  check('every revert message says nothing was signed',
    /nothing was signed/i.test(locales[0].intentAI.presign.revert.insufficientBalance));

  console.log(JSON.stringify({ probe: 'phase84-simulation-gate', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
