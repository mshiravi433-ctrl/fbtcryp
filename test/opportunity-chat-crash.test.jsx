// @vitest-environment jsdom
/**
 * «فرصت‌های سود» must render its result INSIDE the AI chat.
 *
 * Regression: ConversationRow referenced openBubbleRoute, which belongs to
 * IntentAIUnified, not to the row. A successful scan therefore crashed at
 * `onOpenRoom={openBubbleRoute}` with ReferenceError, and RouteBoundary replaced
 * the entire chat. The standalone /opportunities tests could not catch this.
 *
 * The integration test sends the «فرصت‌های سود» chip's actual prompt through
 * the shared send path, opens the full engine, then returns to the persisted answer.
 * Feeds are deterministic fixtures; no wallet, external API or transaction is used.
 */
import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import { scanOpportunities } from '../src/lib/brain/opportunityEngine.js';
import { CHIPS } from '../src/lib/intent-ai/os/suggestionEngine.js';

vi.mock('../src/lib/webEntry.js', async (importOriginal) => ({
  ...(await importOriginal()),
  seoEntryHandoff: false
}));
vi.mock('../src/lib/wc/verify.js', () => ({
  measureVerifyEnclave: () => {}, warmVerifyEnclave: () => {}
}));

const json = (value) => ({
  ok: true, status: 200, headers: { get: () => null },
  json: async () => value, text: async () => JSON.stringify(value)
});

// These are test inputs, not market observations or advertised live rates.
const feedRows = [{
  id: 'test-usdc-market', project: 'aave-v3', symbol: 'USDC',
  chain: 'base', apy: 7.4, tvlUsd: 10_000_000
}];
const scan = scanOpportunities({
  now: 1_794_160_000_000, userCapitalUsd: 0,
  lendingMarkets: [{ id: 'test-usdc-market', project: 'aave-v3', asset: 'USDC', supplyApy: 7.4, tvlUsd: 10_000_000 }]
});
const answer = {
  id: 'opportunity-answer', role: 'ai', kind: 'opportunity',
  content: 'Available sources scanned; estimates are not guaranteed.',
  ui: { type: 'OPPORTUNITY_CARD' }, opportunityScan: scan
};

const { ConversationRow } = await import('../src/components/IntentAIUnified.jsx');
const rowProps = {
  m: answer, t: (key) => key, locale: 'en', isLatest: true,
  onConnectWallet: () => {}, onChoose: () => {}, onMonitorAction: () => {},
  onMonitorOpportunity: () => {}, onFeedback: () => {},
  onGoalExecute: () => {}, onStrategyExecute: () => {}, onStrategyMonitor: () => {},
  onStrategyRevise: () => {}, autonomyEngine: null, autonomyStrategies: [],
  onAutonomyArm: () => {}, onAutonomyDisarm: () => {}, onAutonomyMode: () => {},
  onAutonomyStart: () => {}, onAutonomyStop: () => {}, onAutonomyTick: () => {}
};

describe('the opportunity answer owns no parent navigation closure', () => {
  it('renders a scan without reading a variable outside ConversationRow', () => {
    const view = renderRow({ ...rowProps, onOpenRoute: vi.fn() });
    expect(view.getByTestId('opportunity-dashboard')).toBeTruthy();
    expect(view.getAllByRole('button', { name: 'Full engine ↗' }).length).toBeGreaterThan(0);
    view.unmount();
  });

  it('uses the parent route callback for both engine links, and forwards a rescan', async () => {
    const onOpenRoute = vi.fn();
    const onRescanOpportunity = vi.fn().mockResolvedValue(undefined);
    const view = renderRow({ ...rowProps, onOpenRoute, onRescanOpportunity });
    const links = view.getAllByRole('button', { name: 'Full engine ↗' });
    for (const link of links) fireEvent.click(link);
    expect(onOpenRoute).toHaveBeenCalledTimes(links.length);
    expect(onOpenRoute).toHaveBeenCalledWith('/opportunities');

    fireEvent.change(view.getByLabelText('Investable capital ($)'), { target: { value: '1000' } });
    fireEvent.change(view.getByLabelText('Horizon (days)'), { target: { value: '60' } });
    fireEvent.click(view.getByRole('button', { name: /Rescan/ }));
    await waitFor(() => expect(onRescanOpportunity).toHaveBeenCalledWith({
      capitalUsd: 1000, riskProfile: 'MODERATE', horizonDays: 60
    }));
    view.unmount();
  });
});

function renderRow(props) {
  return render(React.createElement(ConversationRow, props));
}

// Keep one real App mount: this chat has a large module graph and repeated
// mounts waste test memory.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(async () => {
  const { default: i18n } = await import('../src/i18n/index.js');
  await i18n.changeLanguage('fa');
  const { useSettingsStore } = await import('../src/store/useSettingsStore.js');
  useSettingsStore.setState({
    onboarded: true, guideReadAt: Date.now(), biometricEnabled: false,
    twoFactorEnabled: false, language: 'fa'
  });
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  HTMLElement.prototype.scrollIntoView = () => {};
  globalThis.fetch = vi.fn(async (url) => {
    const href = String(url);
    const at = Date.now();
    if (href.includes('/yields')) return json({ at, pools: feedRows, venues: [] });
    if (href.includes('/early-tokens')) return json({ at, dataStatus: 'live', tokens: [] });
    if (href.includes('/markets') || href.includes('/category/')) return json([]);
    if (href.includes('/automations') || href.includes('/monitors') || href.includes('/orders')) return json([]);
    return json({ ok: true, dataStatus: 'unavailable', consensus: [], indexedAt: at });
  });
});

it('Yield request → full engine → restored chat never reaches RouteBoundary', async () => {
  window.location.hash = '#/';
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const App = (await import('../src/App.jsx')).default;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const renderErrors = [];
  const originalError = console.error;
  console.error = (...args) => {
    const message = args.map((value) => String(value?.stack || value)).join(' ');
    if (/ReferenceError|The above error occurred|not valid as a React child/.test(message)) renderErrors.push(message);
  };
  const noCrash = () => {
    expect(document.body.textContent).not.toMatch(/این صفحه به مشکل خورد|خطای غیرمنتظره|This screen ran into a problem/);
    expect(renderErrors).toEqual([]);
  };
  try {
    await act(async () => { root.render(React.createElement(App)); });
    // App deliberately sends a cold start to Market. Navigate after that boot
    // decision, just like tapping AI in the real app.
    await act(async () => { window.location.hash = '#/intent'; });
    await waitFor(() => expect(document.querySelector('.iaos-composer textarea')).toBeTruthy(), { timeout: 60_000 });

    const chip = CHIPS.yield_discover.fa;
    expect(chip.label).toBe('فرصت‌های سود');
    const input = document.querySelector('.iaos-composer textarea');
    fireEvent.change(input, { target: { value: chip.prompt } });
    await act(async () => { fireEvent.click(document.querySelector('.iaos-composer .iaos-send')); });
    await waitFor(() => expect(document.querySelector('[data-testid="opportunity-dashboard"]')).toBeTruthy(), { timeout: 60_000 });
    noCrash();
    const dashboard = document.querySelector('[data-testid="opportunity-dashboard"]');
    expect(dashboard.querySelectorAll('.opd-card').length).toBeGreaterThan(0);

    await act(async () => { fireEvent.click(within(dashboard).getByRole('button', { name: 'موتور کامل ↗' })); });
    await waitFor(() => expect(document.querySelector('[data-testid="opportunities-page"]')).toBeTruthy(), { timeout: 30_000 });
    expect(window.location.hash).toBe('#/opportunities');
    noCrash();

    await act(async () => { window.location.hash = '#/intent'; });
    await waitFor(() => expect(document.querySelector('[data-testid="opportunity-dashboard"]')).toBeTruthy(), { timeout: 30_000 });
    noCrash();
  } finally {
    console.error = originalError;
    await act(async () => { root.unmount(); });
    host.remove();
  }
}, 180_000);
