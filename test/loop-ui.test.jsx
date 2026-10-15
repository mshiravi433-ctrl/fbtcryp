// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CollateralLoopPanel, { pickDefaultPair } from '../src/components/CollateralLoopPanel.jsx';
import { createChain, USDC, USDT, WALLET, reserves, prices } from './loop-mock-chain.mjs';

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

afterEach(() => { cleanup(); try { localStorage.clear(); } catch { /* jsdom */ } });

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

  it('opens step execution for an allowlisted wallet but waits for a valid live plan', () => {
    renderPanel({
      account,
      dataStatus: 'live',
      isConnected: true,
      wallet,
      walletChainId: 42161,
      flags: { calculatorEnabled: true, executionEnabled: true, allowlist: [{ chainId: 42161, wallet }] }
    });
    expect(screen.getByTestId('loop-execution-gate').getAttribute('data-gate')).toBe('ready');
    expect(screen.queryByTestId('loop-execution-block-reason')).toBeNull();
    expect(screen.getByTestId('loop-execution-plan-blocked')).toBeTruthy();
    expect(screen.getByTestId('loop-execution-button').disabled).toBe(true);
  });

  it('keeps the kill switch: an explicitly disabled flag explains itself and blocks', () => {
    renderPanel({ wallet, isConnected: true, flags: { calculatorEnabled: true, executionEnabled: false, allowlist: [] } });
    expect(screen.getByTestId('loop-execution-gate').getAttribute('data-gate')).toBe('FLAG_DISABLED');
    expect(within(screen.getByTestId('loop-execution-block-reason')).getByText('loan.loop.execution.FLAG_DISABLED')).toBeTruthy();
  });

  it('offers to connect or switch network instead of a dead button', () => {
    let connects = 0;
    let switches = 0;
    renderPanel({ flags: { calculatorEnabled: true, executionEnabled: true, allowlist: [] }, onConnect: () => { connects += 1; } });
    fireEvent.click(screen.getByTestId('loop-connect'));
    expect(connects).toBe(1);
    cleanup();
    renderPanel({
      wallet, isConnected: true, walletChainId: 8453,
      flags: { calculatorEnabled: true, executionEnabled: true, allowlist: [] },
      onSwitchChain: () => { switches += 1; }
    });
    expect(screen.getByTestId('loop-execution-gate').getAttribute('data-gate')).toBe('WRONG_NETWORK');
    fireEvent.click(screen.getByTestId('loop-switch-network'));
    expect(switches).toBe(1);
  });

  it('lives in one collapsible box that keeps its content mounted while closed', () => {
    renderPanel();
    const box = screen.getByTestId('loan-collateral-loop');
    const toggle = screen.getByTestId('loop-box-toggle');
    expect(box.getAttribute('data-open')).toBe('false');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('loop-calculator')).toBeTruthy();
    fireEvent.click(toggle);
    expect(box.getAttribute('data-open')).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(box.getAttribute('data-open')).toBe('false');
  });

  it('runs a live USDC/USDT loop end to end: plan → prepare → sign each step → quote review → complete', async () => {
    const chain = createChain();
    const results = [];
    const market = {
      assets: [USDT, USDC],
      reserves,
      prices,
      positions: { [USDC.id]: { ok: true, walletWei: chain.state.wallet.USDC.toString(), suppliedWei: '0', debtWei: '0' } },
      userConfiguration: null,
      loading: false
    };
    renderPanel({
      account: chain.account(),
      dataStatus: 'live',
      isConnected: true,
      wallet: WALLET,
      walletChainId: 42161,
      market,
      loopDeps: chain.deps,
      explorerTxUrl: (hash) => `https://arbiscan.io/tx/${hash}`,
      onStepResult: (entry) => results.push(entry),
      flags: { calculatorEnabled: true, executionEnabled: true, allowlist: [] }
    });

    /* The default pair is the stable/stable loop. */
    expect(screen.getByTestId('loop-plan-collateral-USDC').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('loop-plan-borrow-USDT').getAttribute('aria-checked')).toBe('true');
    fireEvent.change(screen.getByTestId('loop-plan-amount'), { target: { value: '100' } });
    expect(screen.getByTestId('loop-live-plan').getAttribute('data-state')).toBe('ready');
    expect(screen.getAllByTestId(/^loop-plan-round-\d$/)).toHaveLength(2);
    expect(screen.getByTestId('loop-box-hf-chip')).toBeTruthy();

    const button = () => screen.getByTestId('loop-execution-button');
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    await waitFor(() => expect(button().getAttribute('data-action')).toBe('sign'));
    expect(chain.state.calls.some((c) => c.startsWith('tx:'))).toBe(false);

    for (let i = 0; i < 20; i += 1) {
      const action = button().getAttribute('data-action');
      if (action === 'open-positions') break;
      if (action === 'sign' || action === 'confirm-quote') {
        if (action === 'confirm-quote') expect(screen.getByTestId('loop-quote-review')).toBeTruthy();
        await act(async () => { fireEvent.click(button()); });
      }
      await waitFor(() => expect(['sign', 'confirm-quote', 'open-positions']).toContain(button().getAttribute('data-action')));
    }

    expect(screen.getByTestId('loop-complete')).toBeTruthy();
    expect(screen.getByTestId('loop-execution-gate').getAttribute('data-run')).toBe('completed');
    const steps = screen.getAllByTestId(/^loop-step-\d$/);
    expect(steps).toHaveLength(7);
    expect(steps.every((el) => el.getAttribute('data-state') === 'done')).toBe(true);
    expect(screen.getByTestId('loop-step-0-tx').getAttribute('href')).toMatch(/^https:\/\/arbiscan\.io\/tx\/0x/);
    expect(results.filter((r) => r.ok)).toHaveLength(7);
    expect(chain.account().healthFactor).toBeGreaterThanOrEqual(1.35 - 1e-6);

    /* The finished run keeps its plan on screen until «New loop». */
    expect(screen.getByTestId('loop-plan-locked').textContent).toBe('loan.loop.plan.lockedDone');
    expect(screen.getByTestId('loop-plan-amount').disabled).toBe(true);
    fireEvent.click(screen.getByTestId('loop-reset'));
    expect(screen.getByTestId('loop-execution-gate').getAttribute('data-run')).toBe('idle');
    expect(screen.queryByTestId('loop-plan-locked')).toBeNull();
    expect(screen.getByTestId('loop-plan-amount').value).toBe('');
    expect(screen.getByTestId('loop-plan-amount').disabled).toBe(false);
  });
});

describe('default loop pair', () => {
  const asset = (symbol, chain = 1) => ({ id: `${symbol.toLowerCase()}-${chain}`, symbol, address: `0x${'1'.repeat(40)}`, decimals: 6 });
  it('prefers a stable/stable pair', () => {
    const list = [asset('USDT'), asset('USDC'), asset('WBTC')];
    expect(pickDefaultPair(list, {})).toEqual({ collateralId: 'usdc-1', borrowId: 'usdt-1' });
  });
  it('falls back to a same-asset loop instead of borrowing a volatile asset', () => {
    const list = [asset('USDC', 8453), asset('cbBTC', 8453)];
    expect(pickDefaultPair(list, {})).toEqual({ collateralId: 'usdc-8453', borrowId: 'usdc-8453' });
  });
  it('honours reserve flags once they are read', () => {
    const list = [asset('USDT'), asset('USDC'), asset('DAI')];
    const reserves = {
      'usdc-1': { listed: true, ltvPct: 0, status: 'active', borrowingEnabled: true },
      'usdt-1': { listed: true, ltvPct: 75, status: 'active', borrowingEnabled: true },
      'dai-1': { listed: true, ltvPct: 75, status: 'active', borrowingEnabled: false }
    };
    expect(pickDefaultPair(list, reserves)).toEqual({ collateralId: 'usdt-1', borrowId: 'usdc-1' });
  });
});
