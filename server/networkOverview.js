/** Read-only, evidence-backed network overview. No durable observation store means empty, never invented zeros. */
export const NETWORK_OVERVIEW_SCHEMA = 'fbt.network-overview.v1';
const WINDOWS = new Set(['1h', '24h', '7d', '30d']);
export function validWindow(value) { return WINDOWS.has(String(value || '24h')) ? String(value || '24h') : null; }
const metric = (status = 'unavailable') => ({ value: null, sampleSize: 0, status });
export function emptyNetworkOverview(window = '24h', reason = 'No durable observed execution data is configured') {
  const generatedAt = new Date().toISOString();
  return { schema: NETWORK_OVERVIEW_SCHEMA, generatedAt, window, dataStatus: 'empty', source: 'none', metrics: {
    intents: metric('empty'), executions: metric('empty'), completedExecutions: metric('empty'), activeSolvers: metric('empty'),
    chains: [], averageSaving: null, successRate: null, volumeUsd: null
  }, limitations: [reason, 'Success rate, volume and savings require observed receipts with a defined sample and baseline.'] };
}
export function networkOverview({ window = '24h' } = {}) { return emptyNetworkOverview(window); }
export function networkError(code = 'NETWORK_DATA_UNAVAILABLE', message = 'Network metrics are not configured', retryable = true) { return { error: { code, message, retryable } }; }
export { WINDOWS };
