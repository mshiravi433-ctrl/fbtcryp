/**
 * Deployment-time configuration for the Flash Liquidity router contract.
 *
 * Nothing here enables execution by itself: the planner keeps
 * `executionEnabled` false until BOTH the address is configured AND
 * FLASH_LIQUIDITY_ROUTER_AUDITED=true is set by an operator who can point to
 * a real audit report. Fail-closed by design.
 */

function parseAddressMap(raw) {
  if (!raw || typeof raw !== 'string') return {};
  const map = {};
  for (const part of raw.split(',')) {
    const [chainId, address] = part.split(':').map((s) => s && s.trim());
    if (!chainId || !address) continue;
    if (!/^\d+$/.test(chainId)) continue;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) continue;
    map[Number(chainId)] = address;
  }
  return map;
}

export function flashLiquidityRouterConfigured(env = process.env) {
  const addresses = parseAddressMap(env.FLASH_LIQUIDITY_ROUTER_ADDRESSES);
  const auditedRaw = String(env.FLASH_LIQUIDITY_ROUTER_AUDITED || '').toLowerCase();
  const audited = auditedRaw === 'true' || auditedRaw === '1';
  return {
    configured: Object.keys(addresses).length > 0,
    audited,
    addresses,
    envKeys: {
      addresses: 'FLASH_LIQUIDITY_ROUTER_ADDRESSES',
      audited: 'FLASH_LIQUIDITY_ROUTER_AUDITED'
    },
    note: audited
      ? 'Audit flag is set — keep the audit report linked in the deployment records.'
      : 'Reference executor is NOT audited. Set FLASH_LIQUIDITY_ROUTER_AUDITED only after an independent audit exists.'
  };
}
