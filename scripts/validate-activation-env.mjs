#!/usr/bin/env node
/**
 * Wave 0 — Activation environment validation.
 *
 * Validates that the two operator-configured env variables are present:
 *   BLOB_READ_WRITE_TOKEN  (Vercel → Storage → Blob)
 *   ECOSYSTEM_CERTIFIERS   (telegramUserId:Label format)
 *
 * Prints a JSON report. Exit code 0 = all configured; 1 = blockers remain.
 * NEVER prints actual env values — only configured/not-configured status.
 */

const report = {
  schema: 'fbt.activation-env-validation.v1',
  generatedAt: new Date().toISOString(),
  variables: {},
  blockers: [],
  allConfigured: false
};

/* ── BLOB_READ_WRITE_TOKEN ─────────────────────────────────────────────── */
const blobToken = process.env.BLOB_READ_WRITE_TOKEN || '';
const blobConfigured = /^vercel_blob_rw_/.test(blobToken.trim()) && blobToken.length > 20;
report.variables.BLOB_READ_WRITE_TOKEN = {
  configured: blobConfigured,
  formatValid: blobToken.trim() !== '' && /^vercel_blob_rw_/.test(blobToken.trim()),
  source: 'Vercel → Storage → Blob → Create',
  requiredFor: ['approved-durable-registry', 'durable-immutable-audit']
};
if (!blobConfigured) {
  report.blockers.push({
    code: 'BLOB_READ_WRITE_TOKEN_NOT_CONFIGURED',
    wave: 0,
    resolution: 'Vercel Dashboard → Storage → Blob → Create Token. Set as BLOB_READ_WRITE_TOKEN in Vercel env.'
  });
}

/* ── ECOSYSTEM_CERTIFIERS ──────────────────────────────────────────────── */
const certRaw = process.env.ECOSYSTEM_CERTIFIERS || '';
const certEntries = certRaw.split(',').map(s => s.trim()).filter(Boolean);
const CERT_ENTRY_RE = /^(\d{3,20}):([A-Za-z][A-Za-z0-9 ._-]{0,63})$/;
const validEntries = certEntries.filter(e => CERT_ENTRY_RE.test(e));
const certifiersConfigured = validEntries.length > 0;
report.variables.ECOSYSTEM_CERTIFIERS = {
  configured: certifiersConfigured,
  entryCount: certEntries.length,
  validEntryCount: validEntries.length,
  format: 'telegramUserId:Label (e.g. 123456789:FBT Review Team)',
  source: '@userinfobot on Telegram for userId',
  requiredFor: ['certificate-authority', 'approved-durable-registry']
};
if (certEntries.length > 0 && validEntries.length !== certEntries.length) {
  const invalid = certEntries.filter(e => !CERT_ENTRY_RE.test(e));
  report.blockers.push({
    code: 'ECOSYSTEM_CERTIFIERS_FORMAT_INVALID',
    wave: 0,
    resolution: `Invalid entries: ${invalid.join(', ')}. Expected format: telegramUserId:Label`,
    severity: 'warning'
  });
}
if (!certifiersConfigured) {
  report.blockers.push({
    code: 'ECOSYSTEM_CERTIFIERS_NOT_CONFIGURED',
    wave: 0,
    resolution: 'Set ECOSYSTEM_CERTIFIERS=telegramUserId:Label (from @userinfobot)'
  });
}

/* ── Intentionally NOT validated (set by later waves/operator) ────────── */
report.variables.INTENT_SECRET_MANAGER_PROVIDER = {
  configured: Boolean((process.env.INTENT_SECRET_MANAGER_PROVIDER || '').trim()),
  note: 'Do NOT set this — requires attested provider (Wave 3)'
};
report.variables.INTENT_SECRET_MANAGER_KEY_REF = {
  configured: Boolean((process.env.INTENT_SECRET_MANAGER_KEY_REF || '').trim()),
  note: 'Do NOT set this — requires KMS key (Wave 3)'
};
report.variables.INTENT_WORKFLOW_BATCH_ADDRESS = {
  configured: Boolean((process.env.INTENT_WORKFLOW_BATCH_ADDRESS || '').trim()),
  note: 'Set by deploy-all.mjs (Wave 1)'
};
report.variables.INTENT_MERKLE_ANCHOR_NETWORKS = {
  configured: Boolean((process.env.INTENT_MERKLE_ANCHOR_NETWORKS || '').trim()),
  note: 'Set by deploy-all.mjs (Wave 1)'
};
report.variables.INTENT_ANCHOR_NETWORKS = {
  configured: Boolean((process.env.INTENT_ANCHOR_NETWORKS || '').trim()),
  note: 'Set by deploy-all.mjs (Wave 1)'
};

/* ── Summary ──────────────────────────────────────────────────────────── */
report.allConfigured = blobConfigured && certifiersConfigured;

console.log(JSON.stringify(report, null, 2));

if (!report.allConfigured) {
  console.error('\n✗ Wave 0 blockers:');
  for (const b of report.blockers) {
    if (b.severity !== 'warning') console.error(`  OPERATOR_REQUIRED: ${b.code}`);
    console.error(`    → ${b.resolution}`);
  }
  process.exit(1);
}

console.log('\n✓ Wave 0 complete — BLOB_READ_WRITE_TOKEN and ECOSYSTEM_CERTIFIERS are configured.');
