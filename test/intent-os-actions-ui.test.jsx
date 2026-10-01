// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OsEventCard } from '../src/components/chat/IntentOsSurface.jsx';
import { ConversationRow } from '../src/components/IntentAIUnified.jsx';
import { OperationsPanel, HistoryPanel } from '../src/components/IntentOpsPanels.jsx';
import { StrategyPlanCard } from '../src/components/StrategyPlanCard.jsx';
import { runChatNegotiation, negotiationToChatMessage } from '../src/lib/intent-ai/chat/negotiationChat.js';
import { buildNegotiationContext } from '../src/lib/intent-ai/chat/surfaceCommands.js';
import { STRATEGY_STORE_KEY } from '../src/lib/strategyBrain/strategyStore.js';

const offer = () => negotiationToChatMessage(runChatNegotiation({ mode: 'human-agent', locale: 'fa',
  context: buildNegotiationContext({ text: '۱۰۰۰ دلار، ۲۰٪ سود در ۲۰ روز، ریسک متعادل' }) }), { locale: 'fa' });
afterEach(() => { cleanup(); localStorage.removeItem(STRATEGY_STORE_KEY); });

describe('real Intent OS option clicks', () => {
  it('renders each risk explanation once and forwards the complete chip and source event', () => {
    const message = offer(); const onChip = vi.fn();
    render(<OsEventCard event={message.osEvent} locale="fa-IR" onChip={onChip} />);
    const balanced = screen.getByRole('button', { name: /متعادل — رشد/ });
    expect(balanced.textContent).toContain('بودجه افت برآوردی 18');
    expect(screen.getAllByText(/بودجه افت برآوردی 18/)).toHaveLength(1);
    fireEvent.click(balanced);
    expect(onChip).toHaveBeenCalledExactlyOnceWith(message.osEvent.chips[1], message.osEvent);
  });
  it('the conversation does not repeat the card transcript in an outside chat paragraph', () => {
    const message = offer();
    const { container } = render(<ConversationRow m={message} locale="fa" t={(s) => s} onOsChip={vi.fn()} />);
    expect(container.querySelector('.iaos-msg-text')).toBeNull();
    expect(container.querySelectorAll('[data-testid="intent-os-card"]')).toHaveLength(1);
    expect(container.textContent.split('سه گزینه روی میز است').length - 1).toBe(1);
  });
  it('busy/resolved cards cannot submit twice and retain the selected option', () => {
    const message = offer(); const onChip = vi.fn();
    const ui = render(<OsEventCard event={message.osEvent} busy onChip={onChip} />);
    for (const button of screen.getAllByRole('button')) expect(button.disabled).toBe(true);
    const event = { ...message.osEvent, payload: { ...message.osEvent.payload, resolved: true, selectedChipId: 'pick_balanced' } };
    ui.rerender(<OsEventCard event={event} onChip={onChip} />);
    const selected = screen.getByRole('button', { name: /متعادل — رشد/ });
    expect(selected.dataset.selected).toBe('true');
    fireEvent.click(selected);
    expect(onChip).not.toHaveBeenCalled();
  });
  it('route buttons use the in-page route resolver rather than becoming chat prompts', () => {
    const onChip = vi.fn(); const onOpenRoute = vi.fn();
    render(<OsEventCard event={{ kind: 'NOTICE', chips: [{ id: 'ops', label: 'مرکز عملیات', route: '/intent?tab=ops' }] }} onChip={onChip} onOpenRoute={onOpenRoute} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpenRoute).toHaveBeenCalledExactlyOnceWith('/intent?tab=ops');
    expect(onChip).not.toHaveBeenCalled();
  });
});

describe('operations have an action separate from an optional page', () => {
  it('primary analysis dispatches the original operation while the secondary opens its page', () => {
    const onAction = vi.fn(); const onOpenRoute = vi.fn();
    render(<OperationsPanel open locale="fa-IR" availability={() => ({ available: true })} onAction={onAction} onOpenRoute={onOpenRoute} />);
    const analysis = screen.getByTestId('ops-card-portfolio_analysis');
    expect(analysis.textContent).toContain('انجام در چت');
    fireEvent.click(analysis);
    expect(onAction.mock.lastCall[0].id).toBe('portfolio_analysis');
    expect(onOpenRoute).not.toHaveBeenCalled();
    fireEvent.click(within(analysis.parentElement).getByRole('button', { name: /صفحهٔ مرتبط/ }));
    expect(onOpenRoute).toHaveBeenCalledExactlyOnceWith('/portfolio');
  });
  it('wallet-required actions are clickable to open the connection flow, not dead disabled options', () => {
    const onAction = vi.fn();
    render(<OperationsPanel open locale="en-US" availability={(card) => card.requiresWallet ? { available: false, reason: 'WALLET_REQUIRED' } : { available: true }} onAction={onAction} />);
    const rebalance = screen.getByTestId('ops-card-portfolio_rebalance');
    expect(rebalance.disabled).toBe(false);
    fireEvent.click(rebalance);
    expect(onAction.mock.lastCall[0].id).toBe('portfolio_rebalance');
  });
  it('monitor list opens the real monitoring tab with its pause/resume/evaluate controls', () => {
    render(<HistoryPanel open initialTab="monitoring" locale="fa" history={{}} monitors={[{ id: 'm1', status: 'ACTIVE', label: 'BTC ≥ 100000' }]} onMonitorAction={vi.fn()} />);
    const tab = screen.getByRole('tab', { name: /پایش/ });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('BTC ≥ 100000')).toBeTruthy();
    expect(screen.getByRole('button', { name: /توقف/ })).toBeTruthy();
  });
});

describe('strategy output is localized at render; execution stays canonical', () => {
  const plan = {
    ok: true, strategyId: 'ui-localization', chosen: 'yield_core',
    goal: { capitalUsd: 1000, targetPct: 20, horizonDays: 20, riskProfile: 'balanced' },
    comparison: [{ id: 'yield_core', title: 'Yield core', role: 'default', expectedReturnPct: 0.1, riskPct: 2, confidence: 0.5 },
      { id: 'balanced_growth', title: 'Balanced growth', role: 'alternative', expectedReturnPct: 0.2, riskPct: 5, confidence: 0.5 }],
    verdict: { reachable: false, sourcedReturnPct: 0.1, requiredApyPct: 2000, priceGapPct: 19.94 }, risk: {}, sleeves: [],
    stages: [{ id: 'preflight', order: 0, title: 'Pre-flight', actions: [], movesFunds: false }],
    limitations: ['Expected returns use current variable APYs, not promised future rates; a daily move is only a stress proxy, not a statistical forecast.',
      'Nothing here signs or broadcasts — every stage hands off to the venue that owns the signature.',
      'Not read this turn: bridge, gas.', 'Gas was unread, so the cost figure is a floor.'],
    coverage: { live: 3, requested: 5 }, cost: { complete: false, gasPct: null, source: { gas: 'UNREAD' } }, monitors: []
  };
  it('translates the reported English leaks and follows locale changes without altering the plan', () => {
    const original = JSON.stringify(plan);
    const ui = render(<StrategyPlanCard plan={plan} locale="fa-IR" />);
    let card = screen.getByTestId('strategy-plan-card');
    expect(card.textContent).not.toMatch(/Expected returns|Nothing here|Not read this turn|Gas was unread|Highest score/);
    expect(card.textContent).toContain('گس');
    expect(card.textContent).toContain('19.94');
    expect(card.textContent).toContain('حرکت');
    ui.rerender(<StrategyPlanCard plan={plan} locale="en-US" />);
    card = screen.getByTestId('strategy-plan-card');
    expect(card.textContent).toContain('Expected returns use current variable APYs');
    expect(JSON.stringify(plan)).toBe(original);
  });
  it('previewing an alternative is separate from rebuilding; callbacks receive the raw plan', () => {
    const onAdopt = vi.fn(); const onExecuteStage = vi.fn();
    render(<StrategyPlanCard plan={plan} locale="fa" onSwitchPlan={onAdopt} onExecuteStage={onExecuteStage} />);
    fireEvent.click(screen.getByTestId('strategy-option-balanced_growth'));
    expect(onAdopt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('strategy-adopt-option'));
    expect(onAdopt).toHaveBeenCalledExactlyOnceWith('balanced_growth');
    fireEvent.click(screen.getByTestId('strategy-option-yield_core'));
    fireEvent.click(screen.getByTestId('strategy-execute-stage'));
    expect(onExecuteStage).toHaveBeenCalledExactlyOnceWith(plan);
  });
});
