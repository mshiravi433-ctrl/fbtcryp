/**
 * FBT EXTERNAL AGENT HUB — adapter contract and factory (§10B).
 * ---------------------------------------------------------------------------
 * Every provider is reached through this interface, and only through it:
 *
 *   discoverAgents()                    → { ok, agents[], card, cached, checkedAt }
 *   getAgent(remoteAgentId)             → { ok, agent, card }
 *   healthCheck()                       → { ok, status, latencyMs, code? }
 *   createTask(input, credential)       → { ok, remoteTaskId, state, result? }
 *   getTask(remoteTaskId)               → { ok, state, result? }
 *   cancelTask(remoteTaskId)            → { ok, canceled, state }
 *
 * Capabilities are explicit, never assumed: `capabilities(adapter)` reports what
 * the protocol actually implements, and the UI shows only what is declared.
 * A provider that cannot do something is not forced into a shape it does not
 * have — the broker checks the capability before it offers the action.
 *
 * Optional connection methods (`startAuthorization` / `completeAuthorization`)
 * live in `connections.js`, not here: OAuth is the user's relationship with the
 * provider, and this file must not be able to mint one.
 */

import { createA2AAdapter, A2A_SCHEMA } from './a2a.js';

export const ADAPTER_SCHEMA = 'fbt.agent-hub.adapters.v1';

export const ADAPTER_METHODS = Object.freeze([
  'discoverAgents', 'getAgent', 'healthCheck', 'createTask', 'getTask'
]);

/** What an adapter instance actually implements, for the capability report. */
export function capabilities(adapter) {
  return {
    discoverAgents: typeof adapter?.discoverAgents === 'function',
    getAgent: typeof adapter?.getAgent === 'function',
    healthCheck: typeof adapter?.healthCheck === 'function',
    createTask: typeof adapter?.createTask === 'function',
    getTask: typeof adapter?.getTask === 'function',
    cancelTask: typeof adapter?.cancelTask === 'function',
    streaming: false,
    pushNotifications: false,
    inputRequiredContinuation: false
  };
}

/**
 * One adapter per provider, memoised for the process.
 *
 * Memoising is what makes the card cache work (one discovery per provider per
 * five minutes instead of one per page view) and is why a provider's kill
 * switch must be checked by the broker on every request, not by the adapter.
 */
export function createAdapterFactory({ env = process.env, now = () => Date.now(), request } = {}) {
  const cache = new Map();

  return {
    schema: ADAPTER_SCHEMA,
    for(provider) {
      if (!provider) return null;
      const key = provider.id;
      const hit = cache.get(key);
      if (hit) return hit;
      let adapter = null;
      if (provider.integrationType === 'A2A') {
        adapter = createA2AAdapter({ provider, env, now, ...(request ? { request } : {}) });
      }
      /* PROVIDER_TASK_API is a declared integration type that this build does
         not implement. Returning null (rather than a half-adapter) is how the
         registry refuses to publish it: the catalog marks the provider
         `UNCONFIGURED` instead of offering a button that cannot work. */
      if (adapter) cache.set(key, adapter);
      return adapter;
    },
    /** Test hook: forget cached cards/adapters. */
    _reset: () => cache.clear(),
    schemaOf: (adapter) => adapter?.schema || null,
    A2A_SCHEMA
  };
}
