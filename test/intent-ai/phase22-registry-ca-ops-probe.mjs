import { operateDurableRegistry, operateCertificateAuthority, handshakeWithCertificate, revokeCertificate } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
const digest = 'a'.repeat(64);
try {
  check('registry unavailable', operateDurableRegistry({}).code === 'REGISTRY_UNAVAILABLE');
  const mem = new Map();
  const store = { durable: true, restartRecoverable: true, health: () => true, write: (row) => mem.set(row.id, row), read: (id) => mem.get(id) };
  check('read-after-write', operateDurableRegistry({ store, action: 'write', record: { id: 'agent-22' }, now }).persisted === true);
  check('expired CA', operateCertificateAuthority({ certificate: { issuer: 'fbt-ca', fingerprint: digest, signatureValid: true, expiresAt: now - 1 }, now }).code === 'CA_EXPIRED');
  check('uncertified not executable', operateCertificateAuthority({ certificate: { issuer: 'fbt-ca', fingerprint: digest, signatureValid: true, expiresAt: now + 1e6, listingCertified: false }, now }).listingExecutable === false);
  check('handshake never live', handshakeWithCertificate({ certificate: { issuer: 'fbt-ca', fingerprint: digest, signatureValid: true, expiresAt: now + 1e6, listingCertified: true }, peer: { peerId: 'peer-22', attested: true }, now }).live === false);
  check('revoke stays non-executable', revokeCertificate({ certificate: { fingerprint: digest } }).listingExecutable === false);
  console.log(JSON.stringify({ probe: 'phase22-registry-ca-ops', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(JSON.stringify({ probe: 'phase22-registry-ca-ops', failed: true, error: e.message, results }, null, 2));
  process.exitCode = 1;
}
export default results;
