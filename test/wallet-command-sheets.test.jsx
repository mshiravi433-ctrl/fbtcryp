// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import en from '../src/i18n/locales/en.json';

const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], en) ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }) }));
vi.mock('framer-motion', () => {
  const components = new Map();
  return {
    motion: new Proxy({}, {
      get: (_, tag) => {
        if (!components.has(tag)) {
          components.set(tag, ({ children, ...props }) => {
            const Tag = String(tag);
            const clean = Object.fromEntries(Object.entries(props).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'variants'].includes(k)));
            return <Tag {...clean}>{children}</Tag>;
          });
        }
        return components.get(tag);
      }
    }),
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => true
  };
});
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, useLocation: () => ({ pathname: '/wallet' }) }));
vi.mock('../src/hooks/useOpportunityEngine', () => ({
  useOpportunityEngine: () => ({ scan: null, loading: false, error: null, capital: {}, scanNow: () => {} })
}));
vi.mock('../src/hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({ loading: false, report: { score: { value: 62, coverage: 0.8, measured: 6, band: { en: 'moderate' } }, families: [] }, evidence: { contractsScanned: 2 } })
}));
vi.mock('../src/pages/Portfolio', () => ({ default: () => <div data-testid="embedded-portfolio" /> }));
vi.mock('../src/components/SecurityCenterCard', () => ({ default: () => <div data-testid="security-card" /> }));
vi.mock('../src/components/ai/OpportunityDashboard', () => ({ default: () => <div data-testid="opportunity-dashboard" /> }));

import WalletCommandSheet from '../src/components/wallet/WalletCommandSheet.jsx';
import WalletOptimizeSheet from '../src/components/wallet/WalletOptimizeSheet.jsx';

describe('wallet command surfaces', () => {
  it('opens only the overview panel and the Smart Wallet door', () => {
    render(<WalletCommandSheet open onClose={() => {}} portfolio={{ rows: [], chains: [], totalValue: 0 }} intel={null} />);
    const root = document.body;
    expect(root.querySelector('[data-testid="wallet-command-sheet"]')).toBeTruthy();
    expect(root.querySelector('[data-testid="wallet-command-smart"]')).toBeTruthy();
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(root.textContent).toContain(en.wnew.netWorth);
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(0);
    for (const marker of ['opportunityTitle', 'opt', 'pnlByAsset', 'securityDeep', 'defiTitle', 'nftTitle', 'alertsTitle']) {
      const value = marker === 'opt' ? en.wnew.opt.findings : en.wnew[marker];
      expect(root.textContent).not.toContain(value);
    }
    cleanup();
  });

  it('opens only the P&L panel when the P&L tile is tapped', () => {
    render(<WalletCommandSheet open initialTab="pnl" onClose={() => {}} portfolio={{ rows: [], chains: [], totalValue: 0 }} intel={null} />);
    expect(document.body.querySelector('[role="tablist"]')).toBeNull();
    expect(document.body.textContent).toContain(en.wnew.pnlByAsset);
    expect(document.body.textContent).not.toContain(en.wnew.netWorth);
    cleanup();
  });

  it('turns real holdings into findings without signing anything', () => {
    const portfolio = {
      rows: [
        { symbol: 'BTC', value: 8000, chainId: 'btc' },
        { symbol: 'USDC', value: 2000, chainId: 56 }
      ],
      chains: [{ chainId: 'btc', chainShort: 'BTC', totalValue: 8000 }],
      totalValue: 10000
    };
    render(<WalletOptimizeSheet open onClose={() => {}} portfolio={portfolio} wallet={{ chainId: 56 }} />);
    expect(document.body.querySelector('[data-testid="wallet-opt-concentration"]')).toBeTruthy();
    expect(document.body.textContent).toContain(en.wnew.opt.title);
    cleanup();
  });
});
