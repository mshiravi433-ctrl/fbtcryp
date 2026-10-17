// @vitest-environment jsdom
/**
 * The Rewards hub must mount in both tabs, in BOTH languages we ship first,
 * and must never print a raw `rewards.v2.*` key. The points/wheel rules are
 * covered in rewards-v2.test.jsx; this file is about the rendered surface.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../src/lib/rewards/rewardsReporter', () => ({
  reportActivity: vi.fn(),
  setMissionBonusHandler: vi.fn()
}));

vi.mock('../src/lib/rewards/rewardsApi', () => ({
  rewardsSummary: vi.fn(async () => ({
    ok: true,
    data: { points: 1200, referrals: { total: 2 }, code: 'FBTABC123' }
  })),
  bindRewardCode: vi.fn(async () => ({ ok: true, data: null })),
  reportRewardEvents: vi.fn(async () => ({ ok: true, data: { results: [] } }))
}));

import i18n, { setLanguage } from '../src/i18n/index.js';
import Rewards from '../src/pages/Rewards.jsx';
import { resetHub } from '../src/lib/rewards/wheel';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

beforeEach(async () => {
  localStorage.clear();
  resetHub();
  await setLanguage('en');
});

afterEach(cleanup);

const renderAt = (url) => render(
  <MemoryRouter initialEntries={[url]}>
    <Rewards />
  </MemoryRouter>
);

describe('Rewards hub surface', () => {
  it('renders the Rewards tab with the wheel, badges and the permanent loyalty promise', async () => {
    const { container } = renderAt('/rewards?tab=rewards');
    await waitFor(() => expect(screen.getAllByText('Fortune wheel').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Animal badges').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Airdrop entries').length).toBeGreaterThan(0);
    expect(container.textContent).toMatch(/loyalty balance/i);
    expect(container.textContent).toMatch(/not a coin/i);
    expect(container.textContent).not.toMatch(/rewards\.v2\./);
    /* every surface is actually on the page, not just in the source */
    expect(container.querySelectorAll('.rwd-wheel-disc path').length).toBeGreaterThanOrEqual(8);
    expect(container.querySelectorAll('.rwd-nft').length).toBe(6);
    expect(container.querySelectorAll('.rwd-quicknav-chip').length).toBe(9);
    expect(container.querySelectorAll('.rwd-ach').length).toBe(7);
    expect(container.textContent).not.toMatch(/undefined|NaN/);
    expect([...container.querySelectorAll('[style]')].every((node) => !String(node.getAttribute('style')).includes('NaN'))).toBe(true);
  });

  it('switches to the Earn tab and keeps every product inside the app', async () => {
    const { container } = renderAt('/rewards');
    await waitFor(() => expect(screen.getByText('Put your assets to work')).toBeTruthy());
    expect(screen.getByRole('tab', { name: /Rewards/i })).toBeTruthy();
    expect(container.querySelectorAll('a[href^="http"]').length).toBe(0);
  });

  it('renders the Persian copy without a raw key', async () => {
    await setLanguage('fa');
    const { container } = renderAt('/rewards?tab=rewards');
    await waitFor(() => expect(screen.getAllByText('گردونهٔ شانس').length).toBeGreaterThan(0));
    expect(container.textContent).toMatch(/موجودی وفاداری/);
    expect(container.textContent).not.toMatch(/rewards\.v2\./);
    await setLanguage('en');
  });
});
