// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrategyPlanCard } from '../src/components/StrategyPlanCard.jsx';
import { STRATEGY_STORE_KEY, saveStrategyPlan } from '../src/lib/strategyBrain/strategyStore.js';

const actions = [0, 1].map((i) => ({
  module: 'lending', operation: 'SUPPLY', requiresSignature: true,
  capabilityId: 'lending.supply',
  route: `/loan?tab=supply&chain=8453&asset=USDC&amount=${250 + i}`,
  params: { venue: 'aave-base', asset: 'USDC', chainId: 8453, amountUsd: 250 + i }
}));
const plan = {
  ok: true, strategyId: 'strat_ui_pending_stage', chosen: 'balanced',
  goal: { capitalUsd: 1000, targetPct: 30, horizonDays: 30, riskProfile: 'balanced' },
  stages: [{ id: 'deploy-yield', order: 1, title: 'Yield core', objective: 'Two separately signed deposits',
    movesFunds: true, actions }],
  sleeves: [], comparison: [], monitors: [], verdict: { reachable: false },
  honesty: 'No guaranteed profit', risk: {}
};
const draw = (onOpenRoute) => <StrategyPlanCard plan={plan} locale="en" onOpenRoute={onOpenRoute} />;
afterEach(() => { cleanup(); localStorage.removeItem(STRATEGY_STORE_KEY); });

describe('strategy plan card execution handoff', () => {
  it('opens a preview before the stage starts, then binds the second leg to the running strategy', () => {
    const onOpenRoute = vi.fn();
    const ui = render(draw(onOpenRoute));
    const buttons = () => within(screen.getByTestId('strategy-stage-deploy-yield')).getAllByRole('button');
    fireEvent.click(buttons()[1]);
    expect(onOpenRoute).toHaveBeenLastCalledWith(actions[1].route);
    saveStrategyPlan({ strategy: plan, runtime: {
      stageProgress: { 'deploy-yield': { state: 'RUNNING', startedAt: Date.now() } }
    }, store: localStorage });
    ui.rerender(draw(onOpenRoute));
    fireEvent.click(buttons()[1]);
    expect(onOpenRoute).toHaveBeenLastCalledWith(expect.stringContaining('actionIndex=1'));
    expect(onOpenRoute.mock.lastCall[0]).toContain('strategyId=strat_ui_pending_stage');
    expect(onOpenRoute.mock.lastCall[0]).toContain('stageId=deploy-yield');
    expect(onOpenRoute.mock.lastCall[0]).toContain('amount=251');

    saveStrategyPlan({ strategy: plan, runtime: {
      stageProgress: { 'deploy-yield': { state: 'CONFIRMED' } }
    }, store: localStorage });
    ui.rerender(draw(onOpenRoute));
    fireEvent.click(buttons()[1]);
    expect(onOpenRoute).toHaveBeenLastCalledWith(actions[1].route);
  });
});
