// @vitest-environment jsdom
/**
 * OPPORTUNITY ROOM — page smoke test
 * The page is one component with a lot of conditional rooms; a runtime slip in
 * any of them (an icon that does not exist, a field read off a null scan) would
 * only show up when a user taps the tab. This renders the real page against a
 * stubbed engine and walks every room.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const engine = vi.hoisted(() => ({ value: {} }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' }, t: (k, d) => d?.defaultValue ?? k })
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(''), vi.fn()]
}));

vi.mock('../src/components/PageTransition.jsx', () => ({
  default: ({ children }) => <div>{children}</div>
}));

vi.mock('../src/hooks/useOpportunityEngine.js', () => ({
  useOpportunityEngine: () => engine.value,
  readStoredOpportunity: () => null
}));

import Opportunities from '../src/pages/Opportunities.jsx';

const NOW = 1_760_000_000_000;

const row = {
  opportunityId: 'opp_1',
  category: 'LENDING',
  title: 'aave-v3 USDC supply — 7.4% APY',
  symbol: 'USDC',
  protocol: 'aave-v3',
  chain: 'Base',
  confidence: 0.66,
  score: 53.3,
  expiresAt: NOW + 3 * 3600_000,
  discoveredAt: NOW - 60_000,
  eligible: true,
  metrics: { grossApyPct: 7.4, capitalNeededUsd: 2500, feeUsd: 12, gasUsd: 0.05 },
  economics: { capitalUsd: 2500, horizonDays: 30, netProfitUsd: 14.1, netApyPct: 6.9, fees: { totalUsd: 12, networkGasUsd: 0.05 } },
  risk: { score: 2.9, level: 'LOW', components: {} },
  ref: { poolId: 'pool-1', tokenId: 'usd-coin', venue: 'aave-base', externalUrl: null },
  evidence: [{ type: 'LENDING_MARKET', detail: 'supply APY 7.4%' }]
};

const scan = {
  dataStatus: 'live',
  scannedAt: NOW,
  profile: { riskProfile: 'MODERATE', riskTolerance: 5.5, horizonDays: 30 },
  opportunities: [row],
  rejected: [{ ...row, opportunityId: 'opp_2', title: 'lido STETH', exclusionReasons: [{ code: 'net-profit-not-positive-after-fees' }] }],
  scanner: [{ opportunityId: 'opp_1', category: 'LENDING', title: row.title, chain: 'Base', discoveredAt: NOW - 60_000, confidence: 0.66, score: 53.3, eligible: true, reasons: [{ type: 'LENDING_MARKET', detail: 'supply APY 7.4%' }], caveats: [], exclusionCodes: [] }],
  coverage: [
    { id: 'LENDING', source: 'yield-feed', rows: 2, status: 'live', label: {} },
    { id: 'ARBITRAGE', source: 'quotes', rows: 0, status: 'empty', label: {} }
  ],
  feeds: { yields: { status: 'live', rows: 4 }, whales: { status: 'observed', rows: 0 } },
  personalisation: { capitalUsd: 2500, capitalStatus: 'live', activeChains: ['base'], riskProfile: 'MODERATE', riskTolerance: 5.5, candidates: 6 },
  byCategory: { LENDING: 1 },
  cortex: { connected: true }
};

engine.value = {
  scan,
  capital: {
    connected: true, capitalStatus: 'live', totalValue: 9000, investableUsd: 2500, stableInvestableUsd: 1800,
    activeChains: ['base'], chainCount: 1, unpricedRows: 0
  },
  riskProfile: 'MODERATE',
  setRiskProfile: vi.fn(),
  loading: false,
  error: null,
  lastRunAt: NOW,
  stale: false,
  refresh: vi.fn(),
  setManualCapital: vi.fn()
};

afterEach(cleanup);

describe('opportunity room', () => {
  it('renders the hero with the four personalisation inputs', () => {
    render(<Opportunities />);
    expect(screen.getByText('The')).toBeTruthy();
    expect(screen.getByText('opportunity engine')).toBeTruthy();
    expect(screen.getByText('$9,000')).toBeTruthy();          // wallet
    /* Spendable capital appears twice on purpose: the hero input and the
       card that asks for exactly that much. */
    expect(screen.getAllByText('$2,500').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1); // active networks
    expect(screen.getByText(/risk ceiling 5.5 \/ 10/)).toBeTruthy();
  });

  it('renders a card per opportunity and opens every room', () => {
    render(<Opportunities />);
    expect(screen.getAllByTestId('opportunity-card').length).toBe(1);

    fireEvent.click(screen.getByRole('tab', { name: /AI scanner/i }));
    expect(screen.getByText(/supply APY 7.4%/)).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Coverage/i }));
    expect(screen.getByText('yields')).toBeTruthy();
    expect(screen.getAllByText('no rows').length).toBeGreaterThanOrEqual(1);
  });

  it('changes the risk appetite and rescans with it', () => {
    render(<Opportunities />);
    fireEvent.click(screen.getByRole('button', { name: 'Conservative' }));
    expect(engine.value.setRiskProfile).toHaveBeenCalledWith('CONSERVATIVE');
    expect(engine.value.refresh).toHaveBeenCalledWith({ riskProfile: 'CONSERVATIVE' });
  });

  it('shows the exclusion reasons when the excluded filter is on', () => {
    render(<Opportunities />);
    fireEvent.click(screen.getByRole('button', { name: /Excluded/i }));
    expect(screen.getByText(/Net profit after fees and slippage is not positive/)).toBeTruthy();
  });

  it('renders an honest empty state when nothing matched', () => {
    const before = engine.value;
    engine.value = { ...before, scan: { ...scan, opportunities: [], rejected: [] } };
    render(<Opportunities />);
    expect(screen.getByText(/No opportunity matched your capital/)).toBeTruthy();
    engine.value = before;
  });
});
