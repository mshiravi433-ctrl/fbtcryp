/* FBT external-agent boundary: discovery metadata is not authority. */
export const FORBIDDEN_AGENT_KEYS = Object.freeze([
  'privateKey', 'seedPhrase', 'mnemonic', 'masterPassword', 'walletSecret', 'signer', 'unrestrictedSigner'
]);

const hasForbiddenKey = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, child]) => FORBIDDEN_AGENT_KEYS.includes(key) || hasForbiddenKey(child, seen));
};

export function verifyExternalAgent(agent, requested = {}) {
  const failures = [];
  if (!agent?.id) failures.push('MISSING_AGENT_ID');
  if (!Array.isArray(agent?.capabilities) || !agent.capabilities.length) failures.push('NO_CAPABILITIES');
  if (agent?.securityStatus !== 'verified') failures.push('AGENT_NOT_VERIFIED');
  if (requested.chainId && !agent.supportedChains?.includes(requested.chainId)) failures.push('CHAIN_NOT_SUPPORTED');
  if (requested.protocol && !agent.supportedProtocols?.includes(requested.protocol)) failures.push('PROTOCOL_NOT_SUPPORTED');
  if (requested.leverage && Number(requested.leverage) > Number(agent.maxLeverage || 1)) failures.push('LEVERAGE_LIMIT');
  return { ok: failures.length === 0, failures, specialistOnly: true, guardianRequired: true };
}

export function createExternalAgentAdapter(agent, { guardian, audit = () => {} } = {}) {
  if (!verifyExternalAgent(agent).ok) throw new Error('EXTERNAL_AGENT_NOT_AUTHORIZED');
  return Object.freeze({
    async request(input) {
      if (hasForbiddenKey(input)) throw new Error('FORBIDDEN_CREDENTIAL');
      const review = verifyExternalAgent(agent, input);
      audit({ agentId: agent.id, type: 'external-agent-request', allowed: review.ok });
      if (!review.ok) throw new Error(`EXTERNAL_AGENT_POLICY:${review.failures.join(',')}`);
      if (typeof guardian !== 'function' || !(await guardian(input))) throw new Error('GUARDIAN_REJECTED');
      return { status: 'advice-only', agentId: agent.id, result: null };
    }
  });
}

export const SOCIAL_EVENTS = Object.freeze(['greeting', 'acknowledge', 'politely-disagree', 'request-evidence', 'apologize', 'approve', 'reject', 'goodbye']);
export const STICKERS = Object.freeze(['hello', 'thinking', 'research', 'analysis', 'verification', 'warning', 'approved', 'rejected', 'goodbye']);
export const isSafeSticker = (value) => STICKERS.includes(value) && !String(value).includes('execute');
