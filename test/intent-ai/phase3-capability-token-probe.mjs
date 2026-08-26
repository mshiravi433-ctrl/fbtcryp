export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const ct = await import('../../src/lib/intent-ai/capabilityToken.js');

  // Issue a bounded token. Forbidden capabilities are stripped.
  const tok = ct.issueCapabilityToken({
    policyId: 'pol-1', agentId: 'ext-1',
    capabilities: ['quote', 'research', 'withdrawFunds', 'executeWithoutUser'],
    allowedChains: [42161], allowedProtocols: ['swap'], maxAmountUsd: 100,
    now: 1000
  });
  t('token is issued', tok.ok);
  t('forbidden capabilities are rejected at issue', tok.forbidden.includes('withdrawFunds') && tok.forbidden.includes('executeWithoutUser'));
  t('granted set excludes forbidden', !tok.token.capabilities.includes('withdrawFunds') && !tok.token.capabilities.includes('executeWithoutUser'));
  t('granted set keeps allowed caps', tok.token.capabilities.includes('quote') && tok.token.capabilities.includes('research'));
  t('token is scoped to policy+agent', tok.token.policyId === 'pol-1' && tok.token.agentId === 'ext-1');
  t('token carries handle, never raw secret', !!tok.token.handle && !('secret' in tok.token) && !('privateKey' in tok.token));

  // In-scope action passes.
  const ok = ct.scopeCapabilityToken(tok.token, { chainId: 42161, protocol: 'swap', amountUsd: 50 }, { now: 2000 });
  t('in-scope token scopes', ok.ok && ok.scopedHandle === tok.token.handle);

  // Out of scope chain / protocol / amount fail closed.
  t('chain out of token scope blocks', !ct.scopeCapabilityToken(tok.token, { chainId: 56, protocol: 'swap', amountUsd: 50 }, { now: 2000 }).ok);
  t('protocol out of token scope blocks', !ct.scopeCapabilityToken(tok.token, { chainId: 42161, protocol: 'bridge', amountUsd: 50 }, { now: 2000 }).ok);
  t('amount over cap blocks', !ct.scopeCapabilityToken(tok.token, { chainId: 42161, protocol: 'swap', amountUsd: 500 }, { now: 2000 }).ok);

  // Forbidden capability smuggled in the action is refused.
  t('smuggled forbidden capability refused', !ct.scopeCapabilityToken(tok.token, { chainId: 42161, protocol: 'swap', amountUsd: 50, capabilities: ['bypassGuardian'] }, { now: 2000 }).ok);

  // Expired token fails closed.
  t('expired token blocks', !ct.scopeCapabilityToken(tok.token, { chainId: 42161, protocol: 'swap', amountUsd: 50 }, { now: 999999999 }).ok);

  // Revoke is immediate.
  const rev = ct.revokeCapabilityToken(tok.token);
  t('revoke immediate', rev.ok && rev.token.revoked);
  t('revoked token cannot scope', !ct.scopeCapabilityToken(tok.token, { chainId: 42161, protocol: 'swap', amountUsd: 50 }, { now: 3000 }).ok);

  // Token never grants forbidden capabilities on the token view.
  t('token view has no forbidden capability', ct.FORBIDDEN_CAPABILITY_TOKENS.every((f) => !tok.token.capabilities.includes(f)));

  // Missing input fails closed.
  t('no policy id fails closed', !ct.issueCapabilityToken({ agentId: 'a', capabilities: ['quote'] }).ok);
  t('no agent id fails closed', !ct.issueCapabilityToken({ policyId: 'p', capabilities: ['quote'] }).ok);
  t('no capabilities fails closed', !ct.issueCapabilityToken({ policyId: 'p', agentId: 'a' }).ok);

  // Helpers.
  t('FORBIDDEN list exported', ct.FORBIDDEN_CAPABILITY_TOKENS.includes('holdRawCredential') && ct.FORBIDDEN_CAPABILITY_TOKENS.includes('fabricateReceipt') && ct.FORBIDDEN_CAPABILITY_TOKENS.includes('bypassGuardian'));
  t('secret key detection', ct.tokenHasForbiddenKey({ privateKey: 'x' }) === true && ct.tokenHasForbiddenKey({ safe: 1 }) === false);

  return rows;
}
