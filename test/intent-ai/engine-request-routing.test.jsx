// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { isOpportunityEngineRequest, isPortfolioRiskEngineRequest } from '../../src/lib/intent-ai/os/engineRequestRouting.js';

vi.mock('../../src/hooks/useRiskEngine.js', () => ({
  useRiskEngine: () => ({
    loading: false,
    connected: true,
    evidence: { contractsScanned: 2 },
    report: {
      totalUsd: 1250,
      score: { value: 42, band: { en: 'Watch', fa: 'در حال پایش' }, coverage: 0.8, measured: 8 },
      families: [
        { id: 'volatility', labelEn: 'Volatility', labelFa: 'نوسان', score: 55 },
        { id: 'liquidity', labelEn: 'Liquidity', labelFa: 'نقدشوندگی', score: 25 }
      ],
      unavailable: ['provider-status']
    }
  })
}));

import RiskEngineChatCard from '../../src/components/ai/RiskEngineChatCard.jsx';

describe('Intent AI engine request routing', () => {
  it('recognises Persian and English opportunity requests without requiring a goal keyword', () => {
    expect(isOpportunityEngineRequest('بهترین فرصت‌های بازار الان چیست؟')).toBe(true);
    expect(isOpportunityEngineRequest('Find current yield opportunities')).toBe(true);
    expect(isOpportunityEngineRequest('سلام، حالت چطوره؟')).toBe(false);
  });

  it('routes portfolio risk assessment asks but leaves risk-reducing actions to the action pipeline', () => {
    expect(isPortfolioRiskEngineRequest('ریسک پرتفوی من چقدر است؟')).toBe(true);
    expect(isPortfolioRiskEngineRequest('Assess the risk of my portfolio')).toBe(true);
    expect(isPortfolioRiskEngineRequest('Reduce risk in my portfolio by selling ETH')).toBe(false);
    expect(isPortfolioRiskEngineRequest('What is the risk of this specific token?')).toBe(false);
  });

  it('renders a measured read-only risk result inside the AI conversation', () => {
    render(<RiskEngineChatCard locale="en" />);
    expect(screen.getByTestId('intent-risk-answer')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('Volatility')).toBeTruthy();
    expect(screen.getByText(/Explainable analytical model/)).toBeTruthy();
  });
});
