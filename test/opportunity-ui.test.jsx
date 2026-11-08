// @vitest-environment jsdom
/**
 * OPPORTUNITY ENGINE — UI contract
 * The owner's card list, item by item, plus the two things that make a card
 * usable: a button that opens a real destination, and an honest headline when
 * there is no yield estimate to show.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import OpportunityCard from '../src/components/opportunity/OpportunityCard.jsx';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (k, d) => d?.defaultValue ?? k })
}));

const NOW = 1_760_000_000_000;

const poolRow = {
  opportunityId: 'opp_pool',
  category: 'LIQUIDITY_POOL',
  title: 'uniswap-v3 ETH-USDC — 22% APY',
  symbol: 'ETH-USDC',
  protocol: 'uniswap-v3',
  chain: 'Base',
  confidence: 0.72,
  score: 62.4,
  expiresAt: NOW + 6 * 3600_000,
  metrics: {
    grossApyPct: 22, capitalNeededUsd: 5000, feeUsd: 41, slippageUsd: 27.8, gasUsd: 0.1
  },
  economics: {
    capitalUsd: 5000, horizonDays: 30, netProfitUsd: 49.4, netApyPct: 12.02,
    fees: { totalUsd: 41, networkGasUsd: 0.1, slippageUsd: 27.8 }
  },
  risk: { score: 5.4, level: 'MEDIUM', components: {} },
  ref: { poolId: 'pool-uuid-1', tokenId: null, venue: null, externalUrl: null },
  evidence: [{ type: 'POOL', detail: 'APY 22% · TVL 9000000' }]
};

const tokenRow = {
  ...poolRow,
  opportunityId: 'opp_token',
  category: 'LENDING',
  symbol: 'USDC',
  protocol: 'aave-v3',
  chain: 'Base',
  ref: { poolId: 'pool-uuid-2', tokenId: 'usd-coin', venue: 'aave-base', externalUrl: null }
};

const whaleRow = {
  ...poolRow,
  opportunityId: 'opp_whale',
  chain: 'ethereum',
  category: 'WHALE_FLOW',
  symbol: 'BTC',
  protocol: null,
  title: 'Whale accumulation — BTC',
  economics: null,
  metrics: { netFlowUsd: 2_000_000, sampleSize: 4 },
  ref: { tokenId: null, poolId: null, externalUrl: null }
};

const renderCard = (row, props = {}) => {
  const onOpen = vi.fn();
  const onDetails = vi.fn();
  const onExternal = vi.fn();
  render(
    <OpportunityCard
      opportunity={row}
      locale="en"
      now={NOW}
      onOpen={onOpen}
      onDetails={onDetails}
      onExternal={onExternal}
      {...props}
    />
  );
  return { onOpen, onDetails, onExternal };
};

afterEach(cleanup);

describe('opportunity card', () => {
  it('shows identity, type, yield, capital, fees, gas, score, risk, confidence and validity', () => {
    renderCard(poolRow);
    expect(screen.getByText(/uniswap-v3/)).toBeTruthy();
    expect(screen.getByText('Base')).toBeTruthy();
    /* The strategy word the owner asked for, next to the network. */
    expect(screen.getByText(/Pool · Base/)).toBeTruthy();
    expect(screen.getByText('22.0%')).toBeTruthy();
    expect(screen.getByText('$5,000')).toBeTruthy();
    expect(screen.getByText('$41')).toBeTruthy();
    expect(screen.getByText('$0.10')).toBeTruthy();
    expect(screen.getByText('62 / 100')).toBeTruthy();
    expect(screen.getByText(/Risk/)).toBeTruthy();
    expect(screen.getByText('72%')).toBeTruthy();
    expect(screen.getByText('6h')).toBeTruthy();
  });

  it('opens the pool row for a pool opportunity', () => {
    const { onOpen } = renderCard(poolRow);
    const open = screen.getByRole('button', { name: /Open pool/i });
    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toBe('/farm?tab=pools&pool=pool-uuid-1');
  });

  it('opens the token page when a token id is known', () => {
    const { onOpen } = renderCard(tokenRow);
    fireEvent.click(screen.getByRole('button', { name: /Open token/i }));
    expect(onOpen.mock.calls[0][0]).toBe('/coin/usd-coin');
  });

  it('says it has no yield estimate instead of inventing one', () => {
    renderCard(whaleRow);
    expect(screen.getByText(/No yield estimate/i)).toBeTruthy();
    expect(screen.queryByText(/Estimated annual yield/i)).toBeNull();
  });

  it('renders the exclusion reason for an excluded row', () => {
    renderCard(
      { ...poolRow, exclusionReasons: [{ code: 'risk-above-tolerance', riskScore: 7.1, tolerance: 5.5 }] },
      { excluded: true }
    );
    expect(screen.getByText(/above your profile ceiling/i)).toBeTruthy();
  });

  it('falls back to the family screen for a row with no id at all', () => {
    const { onOpen } = renderCard({ ...whaleRow, ref: null });
    fireEvent.click(screen.getByRole('button', { name: /See whales/i }));
    expect(onOpen.mock.calls[0][0]).toBe('/smart-money?chain=ethereum');
  });

  it('disables the button only when even the family screen is unknown', () => {
    renderCard({ ...whaleRow, category: 'SOMETHING_NEW', ref: null });
    const button = screen.getByRole('button', { name: /No destination/i });
    expect(button.disabled).toBe(true);
  });

  it('opens the deep-analysis page from the secondary action', () => {
    const { onDetails } = renderCard(poolRow);
    fireEvent.click(screen.getByRole('button', { name: /Deep analysis/i }));
    expect(onDetails).toHaveBeenCalledWith('opp_pool');
  });
});
