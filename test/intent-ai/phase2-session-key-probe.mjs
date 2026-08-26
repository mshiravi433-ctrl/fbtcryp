export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const sk = await import('../../src/lib/intent-ai/sessionKeys.js');
  sk._resetSessionKeyStore();

  const issued = sk.issueSessionKey({
    policyId: 'pol_test',
    allowedChains: [42161],
    allowedProtocols: ['swap'],
    maxAmountUsd: 200,
    ttlMs: 60_000
  });
  t('issue session key', issued.ok && issued.sessionKey.handle);
  t('no raw secrets on key', sk.assertNoSecrets(issued.sessionKey));

  const okScope = sk.scopeFor(issued.sessionKey, { chainId: 42161, protocol: 'swap', amountUsd: 50 });
  t('in-scope draft allowed', okScope.ok);

  const over = sk.scopeFor(issued.sessionKey, { chainId: 42161, protocol: 'swap', amountUsd: 500 });
  t('over-amount rejected', !over.ok);

  const chain = sk.scopeFor(issued.sessionKey, { chainId: 1, protocol: 'swap', amountUsd: 10 });
  t('wrong chain rejected', !chain.ok);

  sk.revokeSessionKey(issued.sessionKey.id);
  const rev = sk.scopeFor(issued.sessionKey, { chainId: 42161, protocol: 'swap', amountUsd: 10 });
  t('revoked key cannot sign', !rev.ok && rev.error.code === 'SESSION_KEY_REVOKED');

  const noPol = sk.issueSessionKey({});
  t('missing policyId fail-closed', !noPol.ok);
  return rows;
}
