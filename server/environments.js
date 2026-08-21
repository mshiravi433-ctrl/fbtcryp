/** Environment discovery is configuration/health only; it never implies funded testnet or mainnet access. */
export const ENVIRONMENT_SCHEMA = 'fbt.environment.v1';
const configured = (name) => name === 'sandbox' || (name === 'testnet' && process.env.FBT_TESTNET_ENABLED === '1') || (name === 'mainnet' && process.env.FBT_MAINNET_ENABLED === '1');
export function environmentList() {
  const generatedAt = new Date().toISOString();
  const row = (name) => ({ schema: ENVIRONMENT_SCHEMA, name, status: configured(name) ? 'available' : 'not_configured', chains: [], capabilities: ['read_network', 'create_intent', 'request_quote', 'request_simulation'], restrictions: ['No server-side signing', 'User signature required', 'Withdraw funds unavailable'], requiresReview: name !== 'sandbox', generatedAt });
  return { data: ['sandbox', 'testnet', 'mainnet'].map(row), pagination: { cursor: null, hasMore: false }, meta: { schema: 'fbt.resource-list.v1', generatedAt, dataStatus: 'configured' } };
}
