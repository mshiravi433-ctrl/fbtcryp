import { randomUUID } from 'node:crypto';
import { REGISTRY_LIMITATIONS, listRegistry } from './ecosystemRegistry.js';

/**
 * Phase 2 catalog boundary.
 *
 * This used to be a hard-coded empty stub. It now reads the authenticated
 * durable registry (server/ecosystemRegistry.js) and reports what it actually
 * found: `dataStatus: 'live'` when a durable registry answered — even with
 * zero rows — and `dataStatus: 'unavailable'` when none is configured, so an
 * empty list is never mistaken for "nobody has registered anything".
 *
 * Reads stay public and read-only. Writes live behind Telegram authentication
 * in server/app.js, and no listing here is ever presented as verified.
 */
export const CATALOG_SCHEMAS = Object.freeze({ agent: 'fbt.agent.v1', strategy: 'fbt.strategy.v1', liquidity: 'fbt.liquidity-provider.v1', certification: 'fbt.certification.v1', reputation: 'fbt.reputation-graph.v1', environment: 'fbt.environment.v1' });
const now = () => new Date().toISOString();
const UNAVAILABLE = Object.freeze(['No authenticated durable registry is configured.', 'No self-reported listing is treated as verified.']);

export async function catalogList(type, options = {}) {
  const result = await listRegistry(type, options);
  const live = result.ok && result.dataStatus === 'live';
  return {
    data: result.data,
    pagination: { cursor: result.cursor ?? null, hasMore: Boolean(result.hasMore) },
    meta: {
      schema: 'fbt.resource-list.v1',
      generatedAt: now(),
      dataStatus: live ? 'live' : 'unavailable',
      resourceSchema: CATALOG_SCHEMAS[type],
      limitations: live ? [...REGISTRY_LIMITATIONS] : [...UNAVAILABLE],
      ...(result.ok ? {} : { error: result.code })
    }
  };
}
export function catalogError(code, message, retryable = false, requestId = randomUUID()) { return { error: { code, message, retryable, requestId } }; }
