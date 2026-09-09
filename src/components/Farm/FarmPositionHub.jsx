import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import AssetIcon from '../AssetIcon';
import AaveBaseUsdcPanel from './AaveBaseUsdcPanel';
import CompoundBaseUsdcPanel from './CompoundBaseUsdcPanel';
import AaveArbUsdcPanel from './AaveArbUsdcPanel';
import LidoPanel from './LidoPanel';
import MorphoBaseUsdcPanel from './MorphoBaseUsdcPanel';
import { isAaveBaseUsdcPool } from '../../lib/defi/aaveV3Base';
import { isCompoundBaseUsdcPool } from '../../lib/defi/compoundV3Base';
import { isAaveArbUsdcPool } from '../../lib/defi/aaveV3Arbitrum';
import { isLidoPool } from '../../lib/defi/lido';
import { isMorphoBlueBaseMarket } from '../../lib/defi/morphoBlueBase';
import {
  AAVE_BASE_SUPPLY_OPEN_TO_PUBLIC, AAVE_ARB_SUPPLY_OPEN_TO_PUBLIC,
  COMPOUND_BASE_SUPPLY_OPEN_TO_PUBLIC, MORPHO_BASE_SUPPLY_OPEN_TO_PUBLIC,
  LIDO_STAKE_OPEN_TO_PUBLIC
} from '../../lib/farmRolloutMode';

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
  }),
  morphoBase: Object.freeze({
    project: 'morpho-blue', chain: 'Base', symbol: 'USDC', exposure: 'single', ilRisk: false,
    // Off-chain data identifier only — never a transaction target. The adapter pins marketId.
    pool: '7d33d57d-36dc-414b-9538-22a223250468'
  })
});

/**
 * THE ONE TABLE OF "WHICH POOL CAN THIS APP ACTUALLY TRANSACT?".
 * ---------------------------------------------------------------------------
 * It used to exist in two places that could drift: the hub below rendered its
 * five panels from the descriptors above, while a pool card in Farm.jsx knew
 * nothing at all and offered six permanently-disabled buttons plus «اجرا
 * فقط‌خواندنی می‌ماند» for EVERY row — including the exact Aave/Compound/Morpho
 * /Lido rows these adapters already sign for. So the screen told the truth
 * about 4 000 pools and lied about the five we support.
 *
 * Now both surfaces read this list: the hub renders `Panel` with its own
 * descriptor, and `farmExecutionAdapterFor(pool)` answers for a live feed row.
 * A sixth adapter added here appears in both places at once.
 *
 * `matches` is the adapter's own strict matcher (project + chain + the single
 * leg it pins), never a looser local guess — Morpho in particular must match
 * the exact market id, because the panel transacts one pinned market.
 *
 * `openToPublic` is the BUILD's answer to "may any visitor use this adapter?"
 * (lib/features.js). A discovery surface may only advertise execution it can
 * actually offer: in a canary build the panel renders solely for the allowlisted
 * wallet, so the card must not promise execution to everyone else.
 */
export const FARM_EXECUTION_ADAPTERS = Object.freeze([
  Object.freeze({
    id: 'aave-base',
    openToPublic: AAVE_BASE_SUPPLY_OPEN_TO_PUBLIC,
    descriptor: SUPPORTED_FARM_POSITION_POOLS.aaveBase,
    matches: isAaveBaseUsdcPool,
    Panel: AaveBaseUsdcPanel
  }),
  Object.freeze({
    id: 'compound-base',
    openToPublic: COMPOUND_BASE_SUPPLY_OPEN_TO_PUBLIC,
    descriptor: SUPPORTED_FARM_POSITION_POOLS.compoundBase,
    matches: isCompoundBaseUsdcPool,
    Panel: CompoundBaseUsdcPanel
  }),
  Object.freeze({
    id: 'aave-arbitrum',
    openToPublic: AAVE_ARB_SUPPLY_OPEN_TO_PUBLIC,
    descriptor: SUPPORTED_FARM_POSITION_POOLS.aaveArbitrum,
    matches: isAaveArbUsdcPool,
    Panel: AaveArbUsdcPanel
  }),
  Object.freeze({
    id: 'lido',
    openToPublic: LIDO_STAKE_OPEN_TO_PUBLIC,
    descriptor: SUPPORTED_FARM_POSITION_POOLS.lido,
    matches: isLidoPool,
    Panel: LidoPanel
  }),
  Object.freeze({
    id: 'morpho-base',
    openToPublic: MORPHO_BASE_SUPPLY_OPEN_TO_PUBLIC,
    descriptor: SUPPORTED_FARM_POSITION_POOLS.morphoBase,
    matches: isMorphoBlueBaseMarket,
    Panel: MorphoBaseUsdcPanel
  })
]);

/**
 * The adapter that can transact this exact pool row, or null.
 *
 * Null is the honest answer for the overwhelming majority of rows, and the
 * caller must keep saying so (analysis + a link to the protocol site) rather
 * than dressing an unsupported pool up as executable.
 */
export function farmExecutionAdapterFor(pool) {
  if (!pool) return null;
  for (const adapter of FARM_EXECUTION_ADAPTERS) {
    try {
      if (adapter.matches(pool)) return adapter;
    } catch {
      // A matcher that throws on an odd feed row must not take the screen down.
    }
  }
  return null;
}

/* Title + icon per adapter row, so the hub reads like the rest of the Farm
   rather than a stack of protocol cards. */
const HUB_ROWS = {
  'aave-base': { titleKey: 'farm.aave.panelTitle', chain: '8453', symbol: 'USDC' },
  'compound-base': { titleKey: 'farm.compound.panelTitle', chain: '8453', symbol: 'USDC' },
  'aave-arbitrum': { titleKey: 'farm.aaveArb.panelTitle', chain: '42161', symbol: 'USDC' },
  lido: { titleKey: 'farm.lido.panelTitle', chain: '1', symbol: 'STETH' },
  'morpho-base': { titleKey: 'farm.morpho.panelTitle', chain: '8453', symbol: 'USDC' }
};

function HubRow({ id, descriptor, Panel }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const row = HUB_ROWS[id] ?? {};
  return (
    <section className="farm-hub-row" data-testid={`farm-hub-row-${id}`}>
      <button
        type="button"
        className="farm-hub-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="farm-hub-icon" aria-hidden="true">
          <AssetIcon chain={row.chain} symbol={row.symbol} size={32} />
        </span>
        <span className="farm-hub-title">{t(row.titleKey, { defaultValue: id })}</span>
        <span className="farm-pool-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      {/*
        The panel mounts ONLY when the row opens. Five always-mounted panels
        meant five sets of contract reads the moment the page rendered — and
        the «LIDO_NETWORK_UNREADABLE»-style errors that came with them.
        A collapsed row makes no network calls at all.
      */}
      {open && (
        <div className="farm-hub-body">
          <Panel pool={descriptor} />
        </div>
      )}
    </section>
  );
}

export default function FarmPositionHub() {
  return (
    <div className="stack farm-position-hub" data-testid="farm-position-hub">
      {FARM_EXECUTION_ADAPTERS.map(({ id, descriptor, Panel }) => (
        <HubRow key={id} id={id} descriptor={descriptor} Panel={Panel} />
      ))}
    </div>
  );
}
