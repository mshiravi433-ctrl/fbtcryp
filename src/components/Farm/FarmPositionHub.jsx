import AaveBaseUsdcPanel from './AaveBaseUsdcPanel';
import CompoundBaseUsdcPanel from './CompoundBaseUsdcPanel';
import AaveArbUsdcPanel from './AaveArbUsdcPanel';
import LidoPanel from './LidoPanel';

/**
 * Feed-independent descriptors for the adapters that already have an exit UI.
 *
 * These are matcher inputs only; they contain no APY, TVL, reward or position
 * value. Each panel reads its pinned contracts directly. Keeping this hub away
 * from DefiLlama means a feed outage/filter can hide discovery data but can
 * never hide a supported withdrawal, claim or revoke path.
 */
export const SUPPORTED_FARM_POSITION_POOLS = Object.freeze({
  aaveBase: Object.freeze({
    project: 'aave-v3', chain: 'Base', symbol: 'USDC', exposure: 'single', ilRisk: false
  }),
  compoundBase: Object.freeze({
    project: 'compound-v3', chain: 'Base', symbol: 'USDC', exposure: 'single', ilRisk: false
  }),
  aaveArbitrum: Object.freeze({
    project: 'aave-v3', chain: 'Arbitrum', symbol: 'USDC', exposure: 'single', ilRisk: false
  }),
  lido: Object.freeze({
    project: 'lido', chain: 'Ethereum', symbol: 'STETH', exposure: 'single', ilRisk: false
  })
});

export default function FarmPositionHub() {
  return (
    <div className="stack farm-position-hub" data-testid="farm-position-hub">
      <AaveBaseUsdcPanel pool={SUPPORTED_FARM_POSITION_POOLS.aaveBase} />
      <CompoundBaseUsdcPanel pool={SUPPORTED_FARM_POSITION_POOLS.compoundBase} />
      <AaveArbUsdcPanel pool={SUPPORTED_FARM_POSITION_POOLS.aaveArbitrum} />
      <LidoPanel pool={SUPPORTED_FARM_POSITION_POOLS.lido} />
    </div>
  );
}
