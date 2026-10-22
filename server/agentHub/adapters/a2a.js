/**
 * FBT EXTERNAL AGENT HUB — A2A provider adapter (§5, §10B).
 * ---------------------------------------------------------------------------
 * THIS ADAPTER RUNS NO AGENT. It speaks to one that the provider hosts.
 *
 * A2A is the preferred integration form because it is a protocol, not a
 * partnership: the provider publishes an Agent Card and executes the task on
 * their own infrastructure. FBT discovers skills → listings, sends a message,
 * and reads back a task with a state, artifacts and citations. Every byte of
 * intelligence comes from the provider; this file is a translator.
 *
 * WHAT IS ASSERTED HERE
 *   · The card is fetched from the reviewed provider host, over HTTPS, through
 *     the allowlisted `jsonRequest` — a card URL is never taken from a request.
 *   · A listing is a SKILL the card actually declares. A provider with no
 *     skills is listed once under its own name, because that is what the card
 *     says its agent does — not because FBT invented a capability.
 *   · Idempotency travels as the A2A `messageId`: a retry of the same logical
 *     send is the same message to a conformant provider, and the broker still
 *     refuses to re-create a task whose outcome is unknown.
 *   · Task states are normalized by `protocol.js`; an unknown state becomes
 *     `reconciling`, never `completed`.
 *
 * NOT IMPLEMENTED, ON PURPOSE: streaming (`message/stream`), push
 * notifications and multi-turn `input-required` continuation. They are declared
 * unsupported in `capabilities` so the UI cannot promise them.
 */

import { normalizeA2AResult, normalizeProviderError, providerDiagnostic, sanitizeProviderText, stateFromA2A } from '../protocol.js';
import { jsonRequest } from '../httpSafe.js';

export const A2A_SCHEMA = 'fbt.agent-hub.adapter.a2a.v1';
const CARD_TTL_MS = 5 * 60_000;
const CARD_MAX_BYTES = 512_000;
const RESULT_MAX_BYTES = 1_000_000;

const rpcId = () => `fbt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function textOfParts(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map((p) => (p?.kind === 'text' ? sanitizeProviderText(p.text, 6000) : ''))
    .filter(Boolean)
    .join('\n');
}

function validateCard(card) {
  if (!card || typeof card !== 'object') return { ok: false, code: 'AGENT_CARD_INVALID' };
  const name = sanitizeProviderText(card.name, 120).trim();
  if (!name) return { ok: false, code: 'AGENT_CARD_NAME_REQUIRED' };
  const skills = Array.isArray(card.skills) ? card.skills : [];
  const seen = new Set();
  const normalizedSkills = [];
  for (const skill of skills.slice(0, 40)) {
    const id = sanitizeProviderText(skill?.id, 60).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalizedSkills.push({
      id,
      name: sanitizeProviderText(skill?.name, 120).trim() || id,
      description: sanitizeProviderText(skill?.description, 800).trim(),
      tags: Array.isArray(skill?.tags) ? skill.tags.map((t) => sanitizeProviderText(t, 32)).filter(Boolean).slice(0, 10) : [],
      examples: Array.isArray(skill?.examples) ? skill.examples.map((e) => sanitizeProviderText(e, 200)).filter(Boolean).slice(0, 4) : [],
      inputModes: Array.isArray(skill?.inputModes) ? skill.inputModes.map((m) => sanitizeProviderText(m, 40)).filter(Boolean).slice(0, 6) : null,
      outputModes: Array.isArray(skill?.outputModes) ? skill.outputModes.map((m) => sanitizeProviderText(m, 40)).filter(Boolean).slice(0, 6) : null
    });
  }
  return {
    ok: true,
    card: {
      name,
      description: sanitizeProviderText(card.description, 1200).trim(),
      version: sanitizeProviderText(card.version, 40) || null,
      protocolVersion: sanitizeProviderText(card.protocolVersion, 20) || null,
      documentationUrl: sanitizeProviderText(card.documentationUrl, 300) || null,
      capabilities: {
        streaming: card?.capabilities?.streaming === true,
        pushNotifications: card?.capabilities?.pushNotifications === true
      },
      defaultInputModes: Array.isArray(card.defaultInputModes) ? card.defaultInputModes.map((m) => sanitizeProviderText(m, 40)).slice(0, 6) : ['text/plain'],
      defaultOutputModes: Array.isArray(card.defaultOutputModes) ? card.defaultOutputModes.map((m) => sanitizeProviderText(m, 40)).slice(0, 6) : ['text/plain'],
      skills: normalizedSkills
    }
  };
}

export function createA2AAdapter({ provider, env = process.env, now = () => Date.now(), request = jsonRequest } = {}) {
  let cardCache = null; // { card, at }

  async function fetchCard({ force = false, timeoutMs = 8_000 } = {}) {
    if (!force && cardCache && now() - cardCache.at < CARD_TTL_MS) {
      return { ok: true, card: cardCache.card, cached: true, at: cardCache.at };
    }
    const response = await request({
      url: provider.cardUrl,
      allowedHosts: provider.allowedHosts,
      method: 'GET',
      timeoutMs,
      maxBytes: CARD_MAX_BYTES,
      env
    });
    if (!response.ok) {
      return { ok: false, code: response.code, httpStatus: response.httpStatus || null };
    }
    const validated = validateCard(response.json);
    if (!validated.ok) return validated;
    cardCache = { card: validated.card, at: now() };
    return { ok: true, card: validated.card, cached: false, at: cardCache.at };
  }

  function endpoint() {
    return provider.rpcUrl || null;
  }

  function agentsFromCard(card) {
    const remoteBase = provider.rpcUrl || provider.cardUrl;
    if (!card.skills.length) {
      return [{
        remoteAgentId: `${provider.id}:default`,
        remoteSkillId: null,
        name: card.name,
        summary: card.description || `Agent hosted by ${provider.name}`,
        category: provider.category,
        capabilities: [],
        inputModes: card.defaultInputModes,
        outputModes: card.defaultOutputModes,
        examples: []
      }];
    }
    return card.skills.map((skill) => ({
      remoteAgentId: `${provider.id}:${skill.id}`,
      remoteSkillId: skill.id,
      name: skill.name,
      summary: skill.description || card.description || `Skill of ${card.name}`,
      category: provider.category,
      capabilities: skill.tags,
      inputModes: skill.inputModes || card.defaultInputModes,
      outputModes: skill.outputModes || card.defaultOutputModes,
      examples: skill.examples
    })).map((agent) => ({ ...agent, remoteBase }));
  }

  async function rpc(method, params, { credential = null, timeoutMs = 20_000, maxBytes = RESULT_MAX_BYTES } = {}) {
    const url = endpoint();
    if (!url) return { ok: false, code: 'PROVIDER_RPC_URL_UNCONFIGURED' };
    const headers = { 'content-type': 'application/json' };
    if (credential?.accessToken) headers.authorization = `${credential.tokenType || 'Bearer'} ${credential.accessToken}`;
    const response = await request({
      url,
      allowedHosts: provider.allowedHosts,
      method: 'POST',
      headers,
      body: { jsonrpc: '2.0', id: rpcId(), method, params },
      timeoutMs,
      maxBytes,
      env
    });
    if (!response.ok) return { ok: false, ...response, normalized: normalizeProviderError(response, { stage: method }) };
    const json = response.json || {};
    if (json.result === undefined) {
      return {
        ok: false,
        code: 'PROVIDER_EMPTY_RESULT',
        normalized: { ok: false, code: 'PROVIDER_EMPTY_RESULT', retryable: false, providerStatus: response.status, stage: method }
      };
    }
    return { ok: true, result: json.result };
  }

  return {
    schema: A2A_SCHEMA,
    providerId: provider.id,

    /** §10B discoverAgents() — listings come from the card, nothing else. */
    async discoverAgents() {
      const fetched = await fetchCard();
      if (!fetched.ok) return { ok: false, code: fetched.code };
      return {
        ok: true,
        card: fetched.card,
        agents: agentsFromCard(fetched.card),
        cached: fetched.cached,
        checkedAt: fetched.at
      };
    },

    async getAgent(remoteAgentId) {
      const discovered = await this.discoverAgents();
      if (!discovered.ok) return discovered;
      const agent = discovered.agents.find((a) => a.remoteAgentId === String(remoteAgentId));
      return agent ? { ok: true, agent, card: discovered.card } : { ok: false, code: 'AGENT_NOT_FOUND' };
    },

    /** §10B healthCheck() — one real card fetch. Never a documentation link. */
    async healthCheck() {
      const startedAt = now();
      const fetched = await fetchCard({ force: true, timeoutMs: 6_000 });
      const latencyMs = now() - startedAt;
      if (!fetched.ok) {
        return { ok: false, status: 'UNAVAILABLE', latencyMs, code: fetched.code, httpStatus: fetched.httpStatus || null, checkedAt: now() };
      }
      return { ok: true, status: 'LIVE', latencyMs, cardVersion: fetched.card.version, checkedAt: fetched.at };
    },

    /** §10B createTask() — exactly one remote task per call. */
    async createTask(taskInput, connection = null) {
      const params = {
        message: {
          role: 'user',
          messageId: taskInput.messageId,
          parts: [{ kind: 'text', text: taskInput.text }],
          ...(taskInput.contextId ? { contextId: taskInput.contextId } : {})
        },
        configuration: { acceptedOutputModes: ['text/plain', 'application/json'] },
        metadata: {
          client: 'fbtswap-agent-hub',
          agentId: taskInput.remoteAgentId,
          skillId: taskInput.remoteSkillId || null
        }
      };
      const response = await rpc('message/send', params, { credential: connection });
      if (!response.ok) {
        return {
          ok: false,
          code: response.normalized?.code || response.code,
          retryable: response.normalized?.retryable === true,
          diagnostic: providerDiagnostic(response)
        };
      }
      const normalized = normalizeA2AResult(response.result);
      return { ok: true, ...normalized };
    },

    /** §10B getTask() — a read; retrying it is always safe. */
    async getTask(remoteTaskId, credential = null) {
      const response = await rpc('tasks/get', { id: String(remoteTaskId) }, { credential, timeoutMs: 12_000 });
      if (!response.ok) {
        return {
          ok: false,
          code: response.normalized?.code || response.code,
          retryable: response.normalized?.retryable === true,
          diagnostic: providerDiagnostic(response)
        };
      }
      return { ok: true, ...normalizeA2AResult(response.result) };
    },

    /** §10B cancelTask() — best effort, and the provider's answer is the truth. */
    async cancelTask(remoteTaskId, credential = null) {
      const response = await rpc('tasks/cancel', { id: String(remoteTaskId) }, { credential, timeoutMs: 10_000 });
      if (!response.ok) {
        return {
          ok: false,
          code: response.normalized?.code || response.code,
          retryable: response.normalized?.retryable === true,
          diagnostic: providerDiagnostic(response)
        };
      }
      const normalized = normalizeA2AResult(response.result);
      return { ok: true, ...normalized, canceled: normalized.state === 'canceled' };
    },

    /** Exposed for the catalog: the state without another round trip. */
    stateOf: (value) => stateFromA2A(value),
    textOfParts
  };
}
