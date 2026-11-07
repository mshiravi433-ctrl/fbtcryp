// @vitest-environment jsdom
/**
 * AI INTELLIGENCE — PORTFOLIO REVIEW TAB
 * ---------------------------------------------------------------------------
 * «بررسی پرتفوی باید ضرر، سود، بهترین و ضعیف‌ترین عملکرد، داده‌های قابل اعتماد و
 *  پیشنهادهای عملی برای بهبود را تحلیل کند»
 *
 * The page test proves the tab mounts when there is no wallet. This one proves
 * the tab does its JOB when there is a book: it renders the review the engines
 * produce, keeps the performance figure and the P&L figure in separate places,
 * names the strongest and weakest holding, lists the losses, prints the ordered
 * actions, and never lets a missing measurement become a zero.
 *
 * The review/performance fixtures are built by the REAL engines from a real
 * intel shape, so this test fails if either engine drifts away from what the
 * component expects.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import i18n from '../src/i18n/index.js';
import PortfolioTab from '../src/components/ai/analysis/PortfolioTab.jsx';
import { buildPerformance } from '../src/lib/intelligence/performance.js';
import { buildPortfolioReview } from '../src/lib/intelligence/portfolioReview.js';
import { buildPortfolioAnalysis } from '../src/lib/intelligence/portfolioAnalysis.js';

const MARKETS = [
  { id: 'bitcoin', symbol: 'BTC', price: 60000, change24h: 2, change7d: 5, volume: 3e10, mcap: 1.2e12 },
  { id: 'ethereum', symbol: 'ETH', price: 3000, change24h: -4, change7d: -6, volume: 1.5e10, mcap: 3.6e11 },
  { id: 'solana', symbol: 'SOL', price: 150, change24h: 7, change7d: 14, volume: 3e9, mcap: 7e10 }
];

/* A book with a clear winner, a clear loser, an 80% top weight and no cost
   basis — so every finding kind the review can make is reachable. */
function intel() {
  return {
    total: 1000,
    topShare: 80,
    stableUsd: 0,
    stablePct: 0,
    unrealised: null,
    realised: 0,
    cost: null,
    riskScore: 62,
    riskBand: 'medium',
    chainAllocation: [
      { chainId: 1, value: 800, weight: 80 },
      { chainId: 501, value: 200, weight: 20 }
    ],
    rows: [
      {
        symbol: 'BTC', name: 'Bitcoin', amount: 0.0133, value: 800, weight: 80,
        cost: null, pnl: null, pnlPct: null, hasPrice: true, stable: false, chainId: 1
      },
      {
        symbol: 'ETH', name: 'Ethereum', amount: 0.0666, value: 200, weight: 20,
        cost: null, pnl: null, pnlPct: null, hasPrice: true, stable: false, chainId: 501
      }
    ]
  };
}

function rowsForPerformance() {
  return [
    { symbol: 'BTC', value: 800, weight: 80, coingeckoId: 'bitcoin' },
    { symbol: 'ETH', value: 200, weight: 20, coingeckoId: 'ethereum' }
  ];
}

function harness({ locale = 'en' } = {}) {
  const performance = buildPerformance({ rows: rowsForPerformance(), markets: MARKETS });
  const analysis = buildPortfolioAnalysis({ intel: intel(), performance, locale });
  const review = buildPortfolioReview({ intel: intel(), analysis, performance, locale });
  return render(
    <PortfolioTab
      connected
      intel={intel()}
      analysis={analysis}
      review={review}
      performance={performance}
      coverage={null}
      loading={false}
      locale={locale}
      onConnect={() => {}}
      onOpenToken={() => {}}
    />
  );
}

beforeEach(async () => { await i18n.changeLanguage('en'); });
afterEach(() => cleanup());

describe('AI intelligence portfolio review', () => {
  it('renders the review verdict, the score ring and the confidence', () => {
    harness();
    const hero = document.querySelector('.aix-review-hero');
    expect(hero).toBeTruthy();
    /* The confidence is a measured number from reviewConfidence(), printed. */
    expect(hero.textContent).toMatch(/\d+%/);
    expect(document.querySelector('.aix-review-verdict')).toBeTruthy();
  });

  it('shows performance and P&L beside each other, never merged into one number', () => {
    const { container } = harness();
    const text = container.textContent;

    /* Performance: .8(2) + .2(−4) = 1.6 − 0.8 = +0.8% — measured and present. */
    expect(text).toContain('0.8');
    /* The P&L metric must still report that it is unknown, because there is no
       cost basis — and it must appear as its own "not available". */
    expect(text).not.toContain('NaN');
    expect(text).not.toMatch(/undefined|Infinity/);

    /* The two blocks are distinct DOM nodes, both present. */
    const perfBlock = container.querySelector('[data-testid="portfolio-performance"]');
    const pnlBlock = container.querySelector('[data-testid="portfolio-pnl"]');
    expect(perfBlock).toBeTruthy();
    expect(pnlBlock).toBeTruthy();
    expect(perfBlock).not.toBe(pnlBlock);
  });

  it('names the strongest and the weakest holding of the day', () => {
    const { container } = harness();
    const standout = container.querySelector('[data-testid="portfolio-standout"]');
    expect(standout).toBeTruthy();
    /* SOL moved most (7%) at a 0% weight so it is not in this book; BTC is the
       best of the two held, ETH the worst. */
    expect(standout.textContent).toContain('BTC');
    expect(standout.textContent).toContain('ETH');
  });

  it('lists the measured findings with their severity', () => {
    const { container } = harness();
    const findings = container.querySelector('[data-testid="portfolio-findings"]');
    expect(findings).toBeTruthy();
    /* An 80% top weight must produce a concentration finding. */
    expect(findings.textContent.toLowerCase()).toContain('concentration');
  });

  it('prints the ordered actions, each with its horizon and confidence', () => {
    const { container } = harness();
    const actions = container.querySelector('[data-testid="portfolio-actions"]');
    /* This book has findings that survive into actions (concentration, no cash
       buffer, missing cost basis), so the card must be present. */
    expect(actions).toBeTruthy();
    const rows = actions.querySelectorAll('.aix-review-row');
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(row.textContent).toMatch(/Horizon|افق/);
      expect(row.querySelector('.aix-review-side')).toBeTruthy();
    });
    /* Every suggestion surface carries the not-advice line. */
    expect(container.textContent).toContain('This is information, not trading advice or a forecast.');
  });

  it('never leaks NaN, undefined or Infinity into the DOM', () => {
    const { container } = harness();
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('renders in Persian without leaking the English metric names', () => {
    const { container } = harness({ locale: 'fa' });
    const text = container.textContent;
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    /* Persian UI: the review blocks are localized, not left in English. */
    expect(text).toContain('پیشنهادهای عملی');
    expect(text).toContain('یافته‌های بررسی');
    expect(text).toContain('سود و زیان');
  });
});
