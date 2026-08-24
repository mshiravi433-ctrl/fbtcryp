/**
 * Environment discovery is configuration/health only; it never implies funded
 * testnet or mainnet access. The UI uses this endpoint to describe which
 * lifecycle surfaces are enabled, not to promise that a wallet has funds.
 */
export const ENVIRONMENT_SCHEMA = 'fbt.environment.v1';

/*
 * Discovery is available by default. A deployment can deliberately hide an
 * environment with the corresponding `*_ENABLED=0` switch, but an omitted
 * variable must not make a perfectly usable environment look unavailable.
 * Trim the value because env stores commonly leave a trailing newline.
 */
const enabled = (name) => String(process.env[name] ?? '').trim() !== '0';
const configured = (name) =>
  name === 'sandbox'
    ? true
    : enabled(name === 'testnet' ? 'FBT_TESTNET_ENABLED' : 'FBT_MAINNET_ENABLED');

export function environmentList() {
  const generatedAt = new Date().toISOString();
  const row = (name) => ({
    schema: ENVIRONMENT_SCHEMA,
    name,
    status: configured(name) ? 'available' : 'not_configured',
    chains: [],
    capabilities: ['read_network', 'create_intent', 'request_quote', 'request_simulation'],
    restrictions: ['No server-side signing', 'User signature required', 'Withdraw funds unavailable'],
    requiresReview: name !== 'sandbox',
    generatedAt
  });
  return {
    data: ['sandbox', 'testnet', 'mainnet'].map(row),
    pagination: { cursor: null, hasMore: false },
    meta: { schema: 'fbt.resource-list.v1', generatedAt, dataStatus: 'configured' }
  };
}
