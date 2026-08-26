import { operateReleaseTrain } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('freeze', operateReleaseTrain({ freeze: true, change: { wouldDeploy: true } }).code === 'CHANGE_FREEZE_ACTIVE');
  check('unattested', operateReleaseTrain({ freeze: false }).code === 'RELEASE_TRAIN_UNATTESTED');
  check('not live', operateReleaseTrain({ freeze: false, train: { attested: true }, change: { reviewed: true, rollbackReady: true } }).live === false);
  console.log(JSON.stringify({ probe: 'phase41-release-train', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e); process.exitCode = 1;
}
export default results;
