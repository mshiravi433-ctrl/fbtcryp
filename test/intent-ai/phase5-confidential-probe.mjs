export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const conf = await import('../../src/lib/intent-ai/confidentialCollab.js');

  // A secret in content is blocked unless explicitly pre-redacted.
  const leak = conf.buildConfidentialEnvelope({ from: 'a', to: 'b', topic: 't', content: { privateKey: '0xabc' } });
  t('secret leak is blocked', leak.ok === false);

  // Redacted content is allowed and the secret is stripped.
  const safe = conf.buildConfidentialEnvelope({ from: 'a', to: 'b', topic: 't', content: { privateKey: '0xabc' }, redacted: true });
  t('redacted envelope is allowed', safe.ok === true);
  t('secret is redacted, not carried', safe.envelope.content.privateKey === '[REDACTED]');

  // Envelope is never a command / executable.
  t('envelope is non-executable', safe.envelope.isCommand === false && safe.envelope.isExecutable === false);

  // carriesSecret detects secret-shaped keys.
  t('carriesSecret detects keys', conf.carriesSecret({ mnemonic: 'x' }) === true);
  t('carriesSecret ignores safe payload', conf.carriesSecret({ total: 10 }) === false);

  // redactForCollab strips addresses too (PII-ish).
  const redacted = conf.redactForCollab({ to: '0x1234567890abcdef1234567890abcdef12345678', value: 5 });
  t('addresses are redacted', redacted.to === '[REDACTED]');

  // TEE / commit-reveal honesty — unavailable unless prerequisites really exist.
  t('without TEE, commit-reveal is unavailable', conf.confidentialCapabilities({}).commitReveal === 'unavailable');
  t('without TEE, TEE is unavailable', conf.confidentialCapabilities({}).tee === 'unavailable');
  t('without secret manager, it is unavailable', conf.confidentialCapabilities({}).secretManager === 'unavailable');
  t('without at-rest encryption, hide-from-FBT is unavailable', conf.confidentialCapabilities({}).hideFromFbt === 'unavailable');

  // If prerequisites ARE present, they are honestly advertised.
  const ready = conf.confidentialCapabilities({ tee: true, secretManager: true, atRestEncryption: true });
  t('with prerequisites, capabilities are available', ready.tee === 'available' && ready.commitReveal === 'available');

  // Missing from/to fails closed.
  t('missing from/to fails closed', conf.buildConfidentialEnvelope({ to: 'b', content: {} }).ok === false);

  return rows;
}
