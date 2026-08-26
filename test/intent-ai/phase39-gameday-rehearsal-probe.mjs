import { operateGameDay } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('not executed', operateGameDay({}).code === 'GAMEDAY_NOT_EXECUTED');
  check('tabletop insufficient', operateGameDay({ rehearsal: { executed: true, attested: true, tabletopOnly: true } }).code === 'TABLETOP_IS_NOT_REHEARSAL');
  check('no production signer', operateGameDay({ rehearsal: { executed: true, attested: true, usedProductionSigner: true } }).code === 'REHEARSAL_MUST_NOT_USE_PRODUCTION_SIGNER');
  console.log(JSON.stringify({ probe: 'phase39-gameday-rehearsal', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase39-gameday-rehearsal', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
