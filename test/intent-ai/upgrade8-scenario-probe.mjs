#!/usr/bin/env node
/**
 * FBT Intent OS Upgrade 8 — acceptance scenario probe
 */

import {
  createIntentOSState,
  ingestUserTurn,
  orchestrateIntent,
  prepareExecution,
  activateMonitoring,
  resumeConversationState,
  parseAnswerValue
} from '../../src/lib/intent-ai/os/upgrade8/index.js';

const rows = [];
const t = (name, ok, detail = '') => rows.push([`${name}${ok || !detail ? '' : ` — ${detail}`}`, Boolean(ok)]);

let state = createIntentOSState();

const start = ingestUserTurn({
  state,
  text: 'می‌خواهم پرتفوی فعلی‌ام را برای 4 ماه آینده بررسی کنم',
  currentRoute: '/intent'
});
state = start.state;
const activeIntent = state.intents.find((item) => item.intentId === state.activeIntent);
t('scenario: portfolio request becomes an active intent', activeIntent?.type === 'PORTFOLIO_ANALYSIS');
t('scenario: timeframe 4 months is captured immediately', Number(state.collectedSlots?.timeframe) === 4);
t('scenario: only the missing risk question remains', state.missingSlots.length === 1 && state.missingSlots[0] === 'riskProfile', JSON.stringify(state.missingSlots));

const answer = ingestUserTurn({ state, text: 'ریسک متوسط', currentRoute: '/intent' });
state = answer.state;
t('scenario: medium risk short-answer binds correctly', answer.binding?.slot === 'riskProfile' && answer.binding?.value === 'medium', JSON.stringify(answer.binding));
t('scenario: no missing slots remain after the answer', (state.missingSlots || []).length === 0);

const orchestrated = await orchestrateIntent({
  state,
  message: 'ریسک متوسط',
  walletContext: { connected: true, address: '0xabc', chainId: 42161 },
  portfolioContext: {
    totalValue: 15000,
    concentrationPct: 48,
    positions: [
      { symbol: 'ETH', valueUsd: 7200, weightPct: 48 },
      { symbol: 'BTC', valueUsd: 3750, weightPct: 25 },
      { symbol: 'SOL', valueUsd: 1800, weightPct: 12 },
      { symbol: 'USDC', valueUsd: 2250, weightPct: 15 }
    ]
  }
});
state = orchestrated.state;
t('scenario: planner produces a preferred option', orchestrated.orchestration?.consensus?.preferredOption?.id === 'balanced-rotation');
t('scenario: three candidate options are retained for reference resolution', (state.agentState?.lastPresentedOptions || []).length >= 3);

const ref = parseAnswerValue({ text: 'همون گزینه دوم', question: { expectedType: 'selection', options: [] }, state });
t('scenario: "همون گزینه دوم" resolves to option index 1', ref?.optionIndex === 1, JSON.stringify(ref));
state = {
  ...state,
  agentState: {
    ...(state.agentState || {}),
    lastPresentedOptions: (state.agentState?.lastPresentedOptions || []).map((item, index) => ({
      ...item,
      selected: index === 1
    }))
  }
};

const prepared = prepareExecution({
  state,
  action: {
    type: 'REBALANCE',
    asset: 'PORTFOLIO',
    strategyId: state.agentState.lastPresentedOptions[1]?.id,
    impactSummary: 'Rotate part of concentrated positions into diversified core exposures.',
    parameters: { targetAllocation: [{ symbol: 'ETH', fromPct: 48, toPct: 35 }] },
    estimatedGasUsd: 5
  },
  walletContext: { connected: true, address: '0xabc', chainId: 42161, lastUpdated: Date.now() }
});
state = prepared.state;
t('scenario: safe execution requires confirmation, not blind execution', prepared.execution?.status === 'confirming');
t('scenario: simulation is stored before execution', prepared.state.executionState?.lastSimulation?.safeToProceed === true);

const resumed = resumeConversationState(state, '/portfolio');
t('scenario: navigation away preserves active intent and task', resumed.activeIntent === state.activeIntent && resumed.activeTask === state.activeTask);
t('scenario: returning later is resumable, not a reset', resumed.conversation?.status === 'RESUMABLE' || resumed.conversation?.status === 'WAITING', resumed.conversation?.status || 'none');

const monitored = activateMonitoring({
  state: resumed,
  execution: { ...prepared.execution, txHash: '0xfeed', status: 'confirmed' },
  recommendations: ['balanced-rotation']
});
t('scenario: verification transitions to monitoring', monitored.monitoringState?.status === 'active');
t('scenario: monitoring records at least one event', (monitored.monitoringState?.events || []).length >= 1);

const failed = rows.filter(([, ok]) => !ok);
for (const [name, ok] of rows) console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
console.log(`\nUpgrade 8 scenario probe: ${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) process.exit(1);
