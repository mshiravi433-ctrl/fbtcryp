/**
 * FBT EXTERNAL AGENT HUB — composition root (§10).
 * ---------------------------------------------------------------------------
 * Five layers, built once per process, wired in one direction:
 *
 *   registry   reviewed provider + agent definitions (server config)
 *     ↓
 *   adapters   protocol translation (A2A); no agent logic lives here
 *     ↓
 *   store      task / event / connection / usage rows
 *     ↓
 *   connections  per-user provider authorization (sealed credentials)
 *     ↓
 *   broker     consent, eligibility, idempotency, single remote call, sync
 *     ↓
 *   router     the HTTP surface, mounted at /api/ai/agent-hub
 *
 * `app.js` builds this lazily (see `lazyMount('agent-hub', …)`), so the module
 * costs nothing on a cold start that never touches the Hub, exactly like the
 * financial-intelligence and central-os mounts.
 */
import { createRegistry } from './providers.js';
import { createAdapterFactory } from './adapters/index.js';
import { createHubStore } from './store.js';
import { createConnectionManager } from './connections.js';
import { createTaskBroker } from './tasks.js';
import { createAgentHubRouter } from './router.js';

export const AGENT_HUB_VERSION = '1.0.0';

export function createAgentHub({ ownerFor, env = process.env, log = () => {}, now = () => Date.now() } = {}) {
  const store = createHubStore({ now, log });
  const registry = createRegistry({ env, now });
  const adapters = createAdapterFactory({ env, now });
  const connections = createConnectionManager({ store, registry, env, now, log });
  const broker = createTaskBroker({ registry, adapters, store, connections, env, now, log });
  const hub = { version: AGENT_HUB_VERSION, store, registry, adapters, connections, broker };
  hub.router = createAgentHubRouter({ hub, ownerFor, env, log });
  return hub;
}

export default createAgentHub;
