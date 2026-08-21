import { randomUUID } from 'node:crypto';

/** Phase 2 catalog boundary: read-only until an authenticated durable registry exists. */
export const CATALOG_SCHEMAS = Object.freeze({ agent: 'fbt.agent.v1', strategy: 'fbt.strategy.v1', liquidity: 'fbt.liquidity-provider.v1', certification: 'fbt.certification.v1', reputation: 'fbt.reputation-graph.v1', environment: 'fbt.environment.v1' });
const now = () => new Date().toISOString();
export function catalogList(type) {
  return { data: [], pagination: { cursor: null, hasMore: false }, meta: { schema: 'fbt.resource-list.v1', generatedAt: now(), dataStatus: 'unavailable', resourceSchema: CATALOG_SCHEMAS[type], limitations: ['No authenticated durable registry is configured.', 'No self-reported listing is treated as verified.'] } };
}
export function catalogError(code, message, retryable = false, requestId = randomUUID()) { return { error: { code, message, retryable, requestId } }; }
