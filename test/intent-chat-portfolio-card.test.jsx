// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';
import { PortfolioChatCard } from '../src/components/IntentChatCards.jsx';

const testI18n = i18next.createInstance();

beforeAll(async () => {
  await testI18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      fa: { translation: fa }
    },
    interpolation: { escapeValue: false }
  });
});

beforeEach(async () => {
  await testI18n.changeLanguage('en');
});
afterEach(() => cleanup());

const sampleCard = {
  kind: 'PORTFOLIO',
  title: 'Portfolio intelligence',
  status: 'partial',
  displayedValueKind: 'priced-subtotal',
  totalValueUsd: 120,
  stablecoinValueUsd: 120,
  stablecoinPct: 100,
  concentrationSymbol: 'USDC',
  concentrationPct: 100,
  pnlUsd: null,
  overallRiskScore: null,
  unpricedCount: 2,
  failedNetworks: 1,
  staleNetworks: 1,
  rows: [
    { key: '1:usdc:0', symbol: 'USDC', amount: 100, valueUsd: 100, chainId: 1, allocationPct: 83.33, networkStatus: 'live' },
    { key: '56:usdc:1', symbol: 'USDC', amount: 20, valueUsd: 20, chainId: 56, allocationPct: 16.67, networkStatus: 'live' },
    { key: '501:sol:2', symbol: 'SOL', amount: 0.1, valueUsd: null, chainId: 501, allocationPct: null, networkStatus: 'live' },
    { key: '137:unknown:3', symbol: 'UNKNOWN', amount: 3, valueUsd: null, chainId: 137, allocationPct: null, networkStatus: 'failed' }
  ],
  networks: [
    { chainId: 1, valueUsd: 100, allocationPct: 83.33, holdingCount: 1, unpricedCount: 0, status: 'live' },
    { chainId: 56, valueUsd: 20, allocationPct: 16.67, holdingCount: 1, unpricedCount: 0, status: 'live' },
    { chainId: 501, valueUsd: null, allocationPct: null, holdingCount: 1, unpricedCount: 1, status: 'live' },
    { chainId: 137, valueUsd: null, allocationPct: null, holdingCount: 1, unpricedCount: 1, status: 'failed' },
    { chainId: 8453, valueUsd: null, allocationPct: null, holdingCount: 0, unpricedCount: 0, status: 'stale' }
  ]
};

function renderCard(props = {}) {
  return render(
    <I18nextProvider i18n={testI18n}>
      <PortfolioChatCard card={sampleCard} locale="en" {...props} />
    </I18nextProvider>
  );
}

describe('Intent AI portfolio chat card', () => {
  it('shows priced value, stablecoin exposure, concentration, and explicit unavailable metrics', () => {
    renderCard();
    expect(screen.getByTestId('intent-ai-portfolio-card')).toBeTruthy();
    expect(screen.getByText('Priced holdings subtotal')).toBeTruthy();
    expect(screen.getByText('Recognized USD stablecoins')).toBeTruthy();
    expect(screen.getByText('USDC · 100%')).toBeTruthy();
    expect(screen.getByText('Unrealized P&L')).toBeTruthy();
    expect(screen.getByText('Wallet-mix heuristic score')).toBeTruthy();
    expect(screen.getByText('Cost basis and purchase history are not connected.')).toBeTruthy();
    expect(screen.getByText(/This wallet-mix score is a heuristic, not a comprehensive risk score/)).toBeTruthy();
    expect(screen.getAllByText('Price unavailable').length).toBeGreaterThan(0);
    expect(screen.getByTestId('intent-ai-portfolio-mix-score').textContent).toBe('Not available');
  });

  it('shows the wallet-mix heuristic only for a verified live snapshot', () => {
    const freshCard = {
      ...sampleCard,
      status: 'live',
      displayedValueKind: 'total',
      portfolioMixScore: 37,
      portfolioMixBand: 'medium'
    };
    renderCard({ card: freshCard });
    expect(screen.getByTestId('intent-ai-portfolio-mix-score').textContent).toBe('37/100 · Moderate exposure');
    expect(screen.getByText(/This wallet-mix score is a heuristic/)).toBeTruthy();
  });

  it('switches from token-by-network balances to per-network values and status', () => {
    renderCard();
    fireEvent.click(screen.getByRole('tab', { name: /Networks/ }));
    expect(screen.getByTestId('intent-ai-portfolio-networks')).toBeTruthy();
    expect(screen.getByText('Ethereum')).toBeTruthy();
    expect(screen.getByText('BNB Smart Chain')).toBeTruthy();
    expect(screen.getByText('Read failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all 5' }));
    expect(screen.getByText('Stale snapshot')).toBeTruthy();
  });

  it('labels a verified empty read separately from a priced subtotal', () => {
    const emptyCard = {
      kind: 'PORTFOLIO',
      status: 'empty',
      displayedValueKind: 'total',
      totalValueUsd: 0,
      stablecoinValueUsd: 0,
      stablecoinPct: 0,
      concentrationSymbol: null,
      concentrationPct: null,
      portfolioMixScore: null,
      unpricedCount: 0,
      failedNetworks: 0,
      staleNetworks: 0,
      rows: [],
      networks: []
    };
    renderCard({ card: emptyCard });
    expect(screen.getByText('Empty (verified)')).toBeTruthy();
    expect(screen.getByText('$0.00')).toBeTruthy();
    expect(screen.getByText('No non-zero balances are available in this snapshot.')).toBeTruthy();
    expect(screen.queryByText('Only holdings with a valid price are included in this value.')).toBeNull();
  });

  it('does not label partially read token or network rows as live', () => {
    const partialCard = {
      ...sampleCard,
      rows: [{ key: '501:sol', symbol: 'SOL', amount: 1, valueUsd: 120, chainId: 501, allocationPct: 100, networkStatus: 'partial' }],
      networks: [{ chainId: 501, valueUsd: 120, allocationPct: 100, holdingCount: 1, unpricedCount: 0, status: 'partial' }]
    };
    renderCard({ card: partialCard });
    expect(screen.getAllByText('Partial read').length).toBeGreaterThan(0);
    expect(screen.queryByText('Balance read current')).toBeNull();
  });

  it('sends follow-up questions into the conversation without navigating', () => {
    const onQuickPrompt = vi.fn();
    const onOpenRoute = vi.fn();
    renderCard({ onQuickPrompt, onOpenRoute });
    fireEvent.click(screen.getByRole('button', { name: 'Ask about risk' }));
    expect(onQuickPrompt).toHaveBeenCalledWith(expect.objectContaining({
      id: 'portfolio-risk',
      prompt: expect.stringContaining('do not present concentration')
    }));
    expect(onOpenRoute).not.toHaveBeenCalled();
  });

  /* ── the review block absorbed the grey "not considered" panel ──────────
     «در زیر هر درخواست بررسی پرتفوی طوسی است که یعنی در نظر نگرفته»
     The card must lead with what WAS measured and keep P&L as its own,
     last, self-explaining line. */
  it('leads with the measured mix return instead of a grey not-available panel', () => {
    const measured = {
      ...sampleCard,
      performance24h: 0.9,
      performance7d: -2.4,
      movedUsd24h: 412.5,
      performanceStatus: 'complete',
      performanceCoveragePct: 100,
      movers: [{ symbol: 'SOL', change: 6 }, { symbol: 'ETH', change: -3 }],
      pnlStatus: 'unknown',
      unrealisedPnl: null
    };
    const { container } = renderCard({ card: measured });
    const block = screen.getByTestId('intent-ai-portfolio-review');
    expect(block).toBeTruthy();

    /* The measured numbers are present... */
    expect(container.textContent).toContain('+0.9%');
    expect(container.textContent).toContain('-2.4%');
    expect(container.textContent).toContain('+$412.5');

    /* ...and they are toned by sign, with missing data never coloured green. */
    expect(block.querySelector('.is-up')).toBeTruthy();
    expect(block.querySelector('.is-down')).toBeTruthy();

    /* P&L is still unknown, still separated, and it is the LAST line. */
    const pnlLine = block.querySelector('.icc-portfolio-pnl-line');
    expect(pnlLine).toBeTruthy();
    expect(pnlLine.textContent).toContain('Not available');
    expect(block.lastElementChild.className).toContain('icc-portfolio-pnl-line');
  });

  it('prints em dashes — never zeros — when no quote reached the card', () => {
    const cold = {
      ...sampleCard,
      performance24h: null,
      performance7d: null,
      movedUsd24h: null,
      performanceStatus: 'unavailable',
      movers: [],
      pnlStatus: 'unknown'
    };
    const { container } = renderCard({ card: cold });
    const block = screen.getByTestId('intent-ai-portfolio-review');
    const strongs = [...block.querySelectorAll('.icc-portfolio-review-cell strong')];
    /* The mix-score cell legitimately reads "Not available"; the three
       measured cells must be em dashes and never "+0%". */
    expect(strongs.filter((el) => el.textContent.trim() === '—').length).toBe(3);
    expect(container.textContent).not.toContain('+0%');
  });

  it('renders a genuine measured zero as $0 rather than a dash', () => {
    const flat = {
      ...sampleCard,
      performance24h: 0,
      performance7d: 0,
      movedUsd24h: 0,
      performanceStatus: 'complete',
      pnlStatus: 'unknown'
    };
    const { container } = renderCard({ card: flat });
    expect(container.textContent).toContain('$0');
    expect(container.textContent).toContain('+0%');
  });

  it('renders a localized RTL surface when Persian is selected', async () => {
    await testI18n.changeLanguage('fa');
    const { container } = render(
      <I18nextProvider i18n={testI18n}>
        <PortfolioChatCard card={sampleCard} locale="fa-IR" />
      </I18nextProvider>
    );
    const card = screen.getByTestId('intent-ai-portfolio-card');
    expect(card.getAttribute('dir')).toBe('rtl');
    expect(container.textContent).toContain('هوش پرتفوی');
    expect(container.textContent).toContain('سود/زیان تحقق‌نیافته');
  });
});
