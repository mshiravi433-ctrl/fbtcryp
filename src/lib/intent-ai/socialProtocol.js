/**
 * FBT INTENT AI — AGENT SOCIAL PROTOCOL
 * ---------------------------------------------------------------------------
 * Allowed social message types between agents. A social message is NEVER a
 * command. It can express politeness, disagreement, requests for evidence,
 * or handshakes; execution only ever happens through the orchestrator's
 * guardian-gated transaction plan.
 */

export const SOCIAL_TYPES = Object.freeze([
  'greeting',
  'acknowledge',
  'thank',
  'politely-disagree',
  'request-evidence',
  'apologize',
  'recalculate',
  'approve',
  'reject',
  'goodbye'
]);

export function isSocialType(t) {
  return SOCIAL_TYPES.includes(t);
}

/**
 * Build a social message from one agent to another.
 * @param {string} from  sender agent id
 * @param {string} to    recipient agent id (or '*' for broadcast)
 * @param {string} type  one of SOCIAL_TYPES
 * @param {object} [detail] optional payload (must be json-safe, no commands)
 */
export function socialMessage(from, to, type, detail = {}) {
  if (!from || !to) throw new Error('SOCIAL_FROM_TO_REQUIRED');
  if (!isSocialType(type)) throw new Error(`SOCIAL_TYPE_UNKNOWN:${type}`);
  if (detail && typeof detail === 'object') {
    // hard-guard: strip any key that could smuggle a command
    for (const k of Object.keys(detail)) {
      if (/command|execute|sign|secret|privatekey|mnemonic|bypass/i.test(k)) {
        throw new Error(`SOCIAL_FORBIDDEN_KEY:${k}`);
      }
    }
  }
  return Object.freeze({
    kind: 'social',
    from: String(from).slice(0, 48),
    to: String(to).slice(0, 48),
    type,
    detail: detail && typeof detail === 'object' ? { ...detail } : { message: String(detail || '') },
    ts: Date.now(),
    isSocial: true,
    isCommand: false,
    isExecutable: false
  });
}

/**
 * The Internal Agent Handshake sequence. Called after the user confirms
 * an L3 session. Both agents declare identity, role and limits; neither
 * trusts the other's self-description — Guardian enforces policy.
 *
 * @returns {Array<socialMessage>} ordered handshake
 */
export function agentHandshake(strategyIdentity, execIdentity) {
  return [
    socialMessage(strategyIdentity.id, execIdentity.id, 'greeting', {
      role: strategyIdentity.role,
      authority: strategyIdentity.authority,
      note: 'strategy-agent-online'
    }),
    socialMessage(execIdentity.id, strategyIdentity.id, 'greeting', {
      role: execIdentity.role,
      authority: execIdentity.authority,
      note: 'execution-orchestrator-online-policy-bound'
    }),
    socialMessage(strategyIdentity.id, execIdentity.id, 'acknowledge', {
      readyToPresentEvidence: true
    }),
    socialMessage(execIdentity.id, strategyIdentity.id, 'request-evidence', {
      request: 'please-present-candidate-strategies-with-evidence'
    })
  ];
}
