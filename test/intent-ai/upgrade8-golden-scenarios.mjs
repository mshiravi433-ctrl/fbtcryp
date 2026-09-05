#!/usr/bin/env node
/**
 * FBT Intent OS Upgrade 8 — golden scenarios
 *
 * At least 100 scenarios, focused on the root failures Upgrade 8 addresses:
 * - durable intent/task state instead of fragmented chat-only memory
 * - short-answer slot binding ("ریسک متوسط")
 * - ordinal/reference resolution ("همون گزینه دوم")
 * - safe execution preparation and monitoring handoff
 * - resume across route changes
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

const starterMessages = [
  'می‌خواهم پرتفوی فعلی‌ام را برای 4 ماه آینده بررسی کنم',
  'پرتفوی من را برای ۴ ماه آینده تحلیل کن',
  'portfolio analysis for 4 months',
  'برای 4 ماه آینده سبد من را بررسی کن',
  'می‌خوام برای چهار ماه آینده پرتفوی‌ام را ببینم',
  'analyze my current portfolio for the next 4 months',
  'پرتفوی من در 4 ماه آینده چطور می‌شود؟',
  'می‌خواهم برای 4 ماه آینده روی سبد فعلی‌ام برنامه داشته باشم',
  'review my portfolio over a 4 month horizon',
  'تحلیل پرتفوی ۴ ماهه می‌خوام'
];

const riskAnswers = [
  { text: 'ریسک متوسط', expected: 'medium' },
  { text: 'medium risk', expected: 'medium' },
  { text: 'متعادل', expected: 'medium' }
];

const referenceAnswers = [
  { text: 'همون گزینه دوم', expectedIndex: 1 },
  { text: 'گزینه دوم', expectedIndex: 1 },
  { text: 'second option', expectedIndex: 1 },
  { text: '2', expectedIndex: 1 }
];

const rows = [];
const t = (name, ok, detail = '') => rows.push([`${name}${ok || !detail ? '' : ` — ${detail}`}`, Boolean(ok)]);

for (const start of starterMessages) {
  for (const risk of riskAnswers) {
    for (const ref of referenceAnswers) {
      const label = `${start} | ${risk.text} | ${ref.text}`;
      let state = createIntentOSState();

      const first = ingestUserTurn({ state, text: start, currentRoute: '/intent' });
      state = first.state;
      t(`[golden] intent classified as portfolio analysis :: ${label}`,
        state.intents.find((item) => item.intentId === state.activeIntent)?.type === 'PORTFOLIO_ANALYSIS');
      t(`[golden] timeframe extracted as 4 months :: ${label}`,
        Number(state.collectedSlots?.timeframe) === 4 || Number(state.intents.find((item) => item.intentId === state.activeIntent)?.filledSlots?.timeframe) === 4,
        JSON.stringify(state.collectedSlots));
      t(`[golden] risk follow-up is created :: ${label}`,
        state.pendingQuestion != null && state.questions.some((item) => item.questionId === state.pendingQuestion && item.slot === 'riskProfile'));

      const second = ingestUserTurn({ state, text: risk.text, currentRoute: '/intent' });
      state = second.state;
      t(`[golden] risk answer binds to medium :: ${label}`,
        second.binding?.slot === 'riskProfile' && second.binding?.value === risk.expected,
        JSON.stringify(second.binding));

      const orchestrated = await orchestrateIntent({
        state,
        message: risk.text,
        walletContext: { connected: true, address: '0xabc', chainId: 42161 },
        portfolioContext: {
          totalValue: 10000,
          concentrationPct: 52,
          positions: [
            { symbol: 'ETH', valueUsd: 5200, weightPct: 52 },
            { symbol: 'BTC', valueUsd: 2500, weightPct: 25 },
            { symbol: 'SOL', valueUsd: 1300, weightPct: 13 },
            { symbol: 'USDC', valueUsd: 1000, weightPct: 10 }
          ]
        }
      });
      state = orchestrated.state;
      t(`[golden] at least three plan options are produced :: ${label}`,
        Array.isArray(orchestrated.orchestration?.consensus?.options) && orchestrated.orchestration.consensus.options.length >= 3);
      t(`[golden] balanced rotation is preferred for medium risk :: ${label}`,
        orchestrated.orchestration?.consensus?.preferredOption?.id === 'balanced-rotation',
        orchestrated.orchestration?.consensus?.preferredOption?.id || 'none');

      const selected = parseAnswerValue({
        text: ref.text,
        question: { expectedType: 'selection', options: [] },
        state
      });
      t(`[golden] ordinal reference resolves to option 2 :: ${label}`,
        selected?.optionIndex === ref.expectedIndex,
        JSON.stringify(selected));

      state = {
        ...state,
        agentState: {
          ...(state.agentState || {}),
          lastPresentedOptions: (state.agentState?.lastPresentedOptions || []).map((item, index) => ({
            ...item,
            selected: index === ref.expectedIndex
          }))
        }
      };

      const prepared = prepareExecution({
        state,
        action: {
          type: 'REBALANCE',
          asset: 'PORTFOLIO',
          strategyId: 'balanced-rotation',
          impactSummary: 'Rotate concentration into diversified core assets.',
          estimatedGasUsd: 5,
          parameters: {
            targetAllocation: [
              { symbol: 'ETH', fromPct: 52, toPct: 35 },
              { symbol: 'BTC', fromPct: 25, toPct: 30 },
              { symbol: 'ETH', fromPct: 13, toPct: 20 },
              { symbol: 'STABLES', fromPct: 10, toPct: 15 }
            ]
          }
        },
        walletContext: { connected: true, address: '0xabc', chainId: 42161, lastUpdated: Date.now() }
      });
      state = prepared.state;
      t(`[golden] safe execution reaches confirming state :: ${label}`,
        prepared.execution?.status === 'confirming', prepared.execution?.status || 'none');
      t(`[golden] simulation passes without blockers :: ${label}`,
        prepared.simulation?.safeToProceed === true, JSON.stringify(prepared.simulation));

      const monitored = activateMonitoring({
        state,
        execution: { ...prepared.execution, txHash: '0xhash', status: 'confirmed' },
        recommendations: ['balanced-rotation']
      });
      t(`[golden] monitoring becomes active after execution :: ${label}`,
        monitored.monitoringState?.status === 'active');

      const resumed = resumeConversationState(monitored, '/portfolio');
      t(`[golden] resume preserves route context :: ${label}`,
        resumed.currentRoute === '/portfolio' && resumed.tasks.find((task) => task.taskId === resumed.activeTask)?.resumeToken,
        resumed.currentRoute || 'none');
    }
  }
}

const failed = rows.filter(([, ok]) => !ok);
for (const [name, ok] of rows) console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
console.log(`\nUpgrade 8 golden scenarios: ${rows.length - failed.length}/${rows.length} passed across ${starterMessages.length * riskAnswers.length * referenceAnswers.length} scenarios.`);
if (starterMessages.length * riskAnswers.length * referenceAnswers.length < 100) {
  console.error('Expected at least 100 scenarios.');
  process.exit(1);
}
if (failed.length) process.exit(1);
