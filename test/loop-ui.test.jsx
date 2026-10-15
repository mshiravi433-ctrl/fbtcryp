// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import CollateralLoopPanel from '../src/components/CollateralLoopPanel.jsx';

const translate = (key) => key;
const wallet = '0x00000000000000000000000000000000000000aa';
const account = {
  ok: true,
  totalCollateralUsd: 1500,
  totalDebtUsd: 500,
  healthFactor: 2.4,
  availableBorrowsUsd: 400,
  liquidationThresholdPct: 80,
  ltvPct: 70
};

afterEach(() => cleanup());

function renderPanel(overrides = {}) {
  return render(<CollateralLoopPanel
    t={translate}
    lang="fa"
    dir="rtl"
    account={null}
    dataStatus="unavailable"
    chainId={42161}
    wallet={null}
    isConnected={false}
    supportedChain
    flags={{ calculatorEnabled: true, executionEnabled: false, allowlist: [] }}
    {...overrides}
  />);
}

describe('collateral-loop page panel', () => {
  it('renders a local calculator with a round table and no automatic execution', () => {
    renderPanel();
    expect(screen.getByTestId('loop-calculator')).toBeTruthy();
    expect(screen.getAllByTestId(/loop-round-\d/)).toHaveLength(3);
    expect(screen.getByTestId('loop-no-automation')).toBeTruthy();
    expect(screen.getByTestId('loop-execution-button').disabled).toBe(true);
    expect(screen.getByTestId('loan-collateral-loop').getAttribute('dir')).toBe('rtl');
  });

  it('shows validation errors when the amount is malformed', () => {
    renderPanel();
    fireEvent.change(screen.getByTestId('loop-input-collateralUsd'), { target: { value: '-2' } });
    expect(screen.getByTestId('loop-validation-errors')).toBeTruthy();
    expect(screen.getByTestId('loop-validation-errors').textContent).toContain('INVALID_POSITIVE_NUMBER');
  });

  it('labels a stale cached account and keeps its timestamp', () => {
    const now = Date.now();
    renderPanel({
      account,
      dataStatus: 'cached',
      readAt: now - 180_000,
      ageMs: 180_000,
      staleAfterMs: 90_000,
      isConnected: true
    });
    expect(screen.getByTestId('loop-position-status').getAttribute('data-status')).toBe('stale');
    expect(screen.getByTestId('loop-position-stale-note')).toBeTruthy();
    expect(screen.getByTestId('loop-position-healthFactor').textContent).toContain('2.40');
    expect(screen.getByTestId('loop-position-read-at').textContent).toContain('180s');
  });

  it('never shows old numbers when the account read is unavailable', () => {
    renderPanel({ account, dataStatus: 'unavailable', readAt: Date.now() - 1000, isConnected: true });
    expect(screen.getByTestId('loop-position-status').getAttribute('data-status')).toBe('unavailable');
    expect(screen.getByTestId('loop-position-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('loop-position-collateral')).toBeNull();
  });

  it('can copy readable on-chain collateral and debt into the editable calculator', () => {
    renderPanel({ account, dataStatus: 'live', readAt: Date.now(), isConnected: true });
    fireEvent.click(screen.getByTestId('loop-use-live-position'));
    expect(screen.getByTestId('loop-input-startingCollateralUsd').value).toBe('1500');
    expect(screen.getByTestId('loop-input-startingDebtUsd').value).toBe('500');
  });

  it('shows the fail-closed stateful-simulation reason even with an enabled allowlist', () => {
    renderPanel({
      account,
      dataStatus: 'live',
      isConnected: true,
      wallet,
      flags: { calculatorEnabled: true, executionEnabled: true, allowlist: [{ chainId: 42161, wallet }] }
    });
    expect(screen.getByTestId('loop-execution-gate').getAttribute('data-gate')).toBe('STATEFUL_SIMULATION_UNVERIFIED');
    expect(within(screen.getByTestId('loop-execution-block-reason')).getByText('loan.loop.execution.STATEFUL_SIMULATION_UNVERIFIED')).toBeTruthy();
    expect(screen.getByTestId('loop-execution-button').disabled).toBe(true);
  });
});
