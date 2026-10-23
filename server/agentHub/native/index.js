/**
 * FBT NATIVE AGENTS — the source of providers that needs no provider.
 * ---------------------------------------------------------------------------
 * The reviewed registry is intentionally empty until an operator writes a
 * decision record, and OAuth can only be configured for a provider that exists.
 * That gate is correct and it used to leave the Agents page with nothing that
 * could actually run.
 *
 * Native agents close that gap without weakening it: they are FBT's OWN agents,
 * executed by this server against public data the app already serves. There is
 * nothing to review because there is no third party, nothing to authorize
 * because there is no external account, and nothing to bill because there is no
 * price. The label in the UI is `FBT native` and it can never be confused with a
 * reviewed third-party listing or with an agent the user added.
 *
 * The shape is deliberately identical to a provider + adapter pair so the task
 * broker, consent composer, idempotency, kill switches, history and rendering
 * are the SAME code paths. This file adds a source of agents, not a second
 * runtime.
 */

import { normalizeResult } from '../protocol.js';
import { createDataAccess } from './data.js';
import { NATIVE_AGENTS, getNativeAgent, nativeAgentCatalog, runNativeAgent } from './agents.js';

export const NATIVE_PROVIDER_ID = 'fbt-native';
export const NATIVE_AGENT_PREFIX = `${NATIVE_PROVIDER_ID}:`;
export const NATIVE_RUNTIME_SCHEMA = 'fbt.agent-hub.native-runtime.v1';
export const NATIVE_FIRST_PARTY_SINCE = '2026-10-22';

const truthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());

/** `AGENT_HUB_NATIVE_AGENTS=false` removes the first-party agents as well. */
export function nativeEnabled(env = process.env) {
  const raw = env?.AGENT_HUB_NATIVE_AGENTS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  return truthy(raw);
}

/**
 * The app is a HashRouter. `/help` and `/legal/terms` are ROUTES INSIDE the
 * single page, not files on the server, so linking to `https://fbtswap.ir/help`
 * opened a 404 — the reported bug. A hash URL is the real address of the page
 * (`/#/help`), works from a fresh tab, and works when the link is pasted into a
 * chat. `websiteUrl` keeps the bare origin because that one genuinely exists.
 */
export function hashUrl(origin, path) {
  const base = String(origin || '').replace(/\/+$/, '');
  const route = `/${String(path || '/').replace(/^\/+/, '')}`;
  return `${base}/#${route === '/' ? '/' : route}`;
}

export function createNativeProvider({ env = process.env } = {}) {
  const origin = String(env.PUBLIC_APP_ORIGIN || 'https://fbtswap.ir').replace(/\/+$/, '');
  return {
    id: NATIVE_PROVIDER_ID,
    name: 'FBT Native',
    websiteUrl: `${origin}/`,
    documentationUrl: hashUrl(origin, '/help'),
    termsUrl: hashUrl(origin, '/legal/terms'),
    privacyUrl: hashUrl(origin, '/legal/privacy'),
    supportUrl: hashUrl(origin, '/help'),
    integrationType: 'NATIVE',
    accessModel: 'FREE_PUBLIC',
    approvalStatus: 'FBT_FIRST_PARTY',
    category: 'crypto',
    costSummary: 'Free — runs inside FBT, no account and no payment',
    native: true,
    enabled: nativeEnabled(env),
    allowedHosts: [],
    cardUrl: null,
    rpcUrl: null,
    authorization: null,
    webhook: null,
    lastVerifiedAt: null,
    approvalEvidence: {
      reviewedAt: NATIVE_FIRST_PARTY_SINCE,
      reviewedBy: 'FBT first party (code review + tests)',
      documentUrl: hashUrl(origin, '/legal/disclaimer'),
      jurisdiction: { operatorJurisdiction: null, targetRegions: [], providerRestrictions: [], accountEligibility: null },
      promptTraining: 'no — no third party receives the prompt',
      dataRetention: 'stored only in this owner’s FBT task history',
      notes: 'Runs in-process against public market data; no execution authority.'
    }
  };
}

export function nativePublicView(provider, { now = () => Date.now() } = {}) {
  return {
    id: provider.id,
    name: provider.name,
    websiteUrl: provider.websiteUrl,
    documentationUrl: provider.documentationUrl,
    termsUrl: provider.termsUrl,
    privacyUrl: provider.privacyUrl,
    supportUrl: provider.supportUrl,
    integrationType: 'NATIVE',
    accessModel: 'FREE_PUBLIC',
    approvalStatus: 'FBT_FIRST_PARTY',
    category: 'crypto',
    costSummary: provider.costSummary,
    requiresAccount: false,
    requiresPayment: false,
    source: 'native',
    jurisdiction: { targetRegions: [], providerRestrictions: [], accountEligibility: null },
    dataPolicy: {
      promptTraining: 'no — nothing is sent to a third party',
      dataRetention: 'this owner’s FBT task history only'
    },
    reviewedAt: NATIVE_FIRST_PARTY_SINCE,
    lastVerifiedAt: null,
    at: now()
  };
}

/**
 * The adapter contract, implemented in-process.
 *
 * `createTask` is synchronous arithmetic; `getTask` and `cancelTask` are absent
 * on purpose, so the broker reports the task as completed immediately and the
 * UI never offers a "cancel" for work that takes under a second.
 */
export function createNativeAdapter({ env = process.env, now = () => Date.now(), data = createDataAccess() } = {}) {
  return {
    schema: 'fbt.agent-hub.adapter.native.v1',
    providerId: NATIVE_PROVIDER_ID,

    async discoverAgents() {
      const agents = nativeAgentCatalog().map((a) => ({
        remoteAgentId: `${NATIVE_AGENT_PREFIX}${a.slug}`,
        remoteSkillId: null,
        name: a.name,
        nameFa: a.nameFa,
        summary: a.summary,
        summaryFa: a.summaryFa,
        category: a.category,
        capabilities: a.capabilities,
        examples: a.examples,
        examplesFa: a.examplesFa,
        inputHint: a.inputHint,
        inputHintFa: a.inputHintFa,
        dataSources: a.dataSources,
        inputModes: ['text/plain'],
        outputModes: ['text/plain', 'text/markdown']
      }));
      return {
        ok: true,
        card: { name: 'FBT Native Agents', version: '1.0.0', protocolVersion: 'native' },
        agents,
        cached: false,
        checkedAt: now()
      };
    },

    async getAgent(remoteAgentId) {
      const discovered = await this.discoverAgents();
      const agent = discovered.agents.find((a) => a.remoteAgentId === String(remoteAgentId));
      return agent ? { ok: true, agent, card: discovered.card } : { ok: false, code: 'AGENT_NOT_FOUND' };
    },

    /** A local health check that does not touch the network: the module is here. */
    async healthCheck() {
      const started = now();
      if (!nativeEnabled(env)) return { ok: false, status: 'DISABLED', latencyMs: 0, code: 'NATIVE_AGENTS_DISABLED', checkedAt: now() };
      return { ok: true, status: 'LIVE', latencyMs: now() - started, cardVersion: '1.0.0', checkedAt: now() };
    },

    async createTask(taskInput = {}) {
      const remoteAgentId = String(taskInput.remoteAgentId || '');
      const slug = remoteAgentId.startsWith(NATIVE_AGENT_PREFIX) ? remoteAgentId.slice(NATIVE_AGENT_PREFIX.length) : remoteAgentId;
      const agent = getNativeAgent(slug);
      if (!agent) return { ok: false, code: 'AGENT_NOT_FOUND' };
      const out = await runNativeAgent(slug, { text: taskInput.text || '' }, data, { now });
      if (!out.ok) {
        return { ok: false, code: out.code || 'NATIVE_AGENT_FAILED', retryable: false, diagnostic: { code: out.code, message: out.detail } };
      }
      return {
        ok: true,
        remoteTaskId: null,
        state: 'completed',
        providerStatus: 'completed',
        result: normalizeResult({
          text: out.text,
          data: { ...out.data, title: out.title, citations: out.citations },
          providerRef: null
        })
      };
    }
  };
}

export function createNativeRuntime({ env = process.env, now = () => Date.now(), data = createDataAccess() } = {}) {
  const provider = createNativeProvider({ env });
  const adapter = createNativeAdapter({ env, now, data });
  return {
    schema: NATIVE_RUNTIME_SCHEMA,
    provider,
    adapter,
    enabled: () => nativeEnabled(env) && provider.enabled,
    agents: () => (nativeEnabled(env) ? NATIVE_AGENTS : []),
    publicView: () => nativePublicView(provider, { now }),
    agentIdFor: (slug) => `${NATIVE_AGENT_PREFIX}${slug}`,
    run: (slug, input) => runNativeAgent(slug, input, data, { now })
  };
}

export default createNativeRuntime;
