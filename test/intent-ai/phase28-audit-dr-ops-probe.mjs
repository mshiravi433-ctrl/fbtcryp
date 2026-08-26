import { operateImmutableAudit, operateBackupRestore } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const digest = 'a'.repeat(64);
try {
  check('tamper', operateImmutableAudit({ tamper: { rewrite: true } }).code === 'AUDIT_TAMPER');
  check('restore fail', operateBackupRestore({ restored: true, hashBefore: digest, hashAfter: 'b'.repeat(64) }).code === 'BACKUP_RESTORE_FAILURE');
  check('restore ok not operational', operateBackupRestore({ restored: true, hashBefore: digest, hashAfter: digest, rpoMs: 60, rtoMs: 300 }).operational === false);
  check('assumed backup is not verified', operateBackupRestore({ assumed: true, restored: true, hashBefore: digest, hashAfter: digest }).code === 'BACKUP_ASSUMED_NOT_VERIFIED');
  console.log(JSON.stringify({ probe: 'phase28-audit-dr-ops', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase28-audit-dr-ops', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
