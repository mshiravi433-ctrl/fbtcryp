/**
 * FBT INTENT AI — GUIDED FLOW · PRODUCT LIMITS · INTERACTIVE CONFIRMATION
 * ---------------------------------------------------------------------------
 * Locks in the new product behaviour:
 *
 *   · hard user-facing limits: 10M total input, 400k per transaction, 500%
 *     goal, 30-day goals — enforced by the parser, the guided flow and the
 *     policy caps, always with a FRIENDLY warning (never a silent clamp)
 *   · the step-by-step guided chat flow (task → amount → confirm → goal →
 *     duration → assets → network → tool permissions) incl. Persian answers
 *   · multi-agent routing made visible: two agents analyse, the best route
 *     is announced, and a chat "yes" runs the REAL executeConfirmed path
 *   · multi-step plans continue step by step, each with its own fresh
 *     authorization screen
 *   · the UI wiring: interactive confirmation screen, countdown component,
 *     examples accordion, external-agent info modal, dvh chat layout
 */

import { readFileSync } from 'node:fs';

function mockLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null
  };
}

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);
  mockLocalStorage();

  const limits = await import('../../src/lib/intent-ai/intentLimits.js');
  const parser = await import('../../src/lib/intent-ai/intentParser.js');
  const human = await import('../../src/lib/intent-ai/humanAi.js');
  const flow = await import('../../src/lib/intent-ai/guidedFlow.js');
  const perm = await import('../../src/lib/intent-ai/permissions.js');

  /* ====================== 1. PRODUCT LIMITS ====================== */

  t('INTENT_LIMITS: 10M total / 400k per tx / 500% goal / 30 days',
    limits.INTENT_LIMITS.maxTotalInputUsd === 10_000_000
    && limits.INTENT_LIMITS.maxPerTransactionUsd === 400_000
    && limits.INTENT_LIMITS.maxGoalPct === 500
    && limits.INTENT_LIMITS.maxGoalDurationDays === 30
    && limits.MAX_GOAL_DURATION_HRS === 720);

  t('compliant intent produces no violations',
    limits.checkIntentLimits({ kind: 'swap', amount: 1000, amountUnit: 'USDC' }).length === 0);

  t('total input over 10M is flagged',
    limits.checkIntentLimits({ kind: 'goal', amount: 11_000_000, amountUnit: 'USDT' })
      .some((v) => v.code === 'TOTAL_INPUT_OVER_LIMIT'));

  t('per-transaction over 400k is flagged for transaction kinds',
    limits.checkIntentLimits({ kind: 'swap', amount: 450_000, amountUnit: 'USDC' })
      .some((v) => v.code === 'PER_TX_OVER_LIMIT'));

  t('goal over 500% is flagged',
    limits.checkIntentLimits({ kind: 'goal', amount: 100, amountUnit: 'USDT', goalPct: 600 })
      .some((v) => v.code === 'GOAL_PCT_OVER_LIMIT'));

  t('goal duration over 30 days is flagged',
    limits.checkIntentLimits({ kind: 'goal', amount: 100, amountUnit: 'USDT', durationHrs: 800 })
      .some((v) => v.code === 'GOAL_DURATION_OVER_LIMIT'));

  t('policy caps mirror the product limits',
    perm.DEFAULT_POLICY_CAPS.maxCapitalUsd === 10_000_000
    && perm.DEFAULT_POLICY_CAPS.maxTransactionUsd === 400_000);

  /* ====================== 2. PARSER LIMIT SURFACES ====================== */

  const overAmount = parser.parseUserIntent('swap 11000000 USDC to ETH on Arbitrum');
  t('parser attaches limit violations to over-limit input',
    overAmount.limitViolations?.some((v) => v.code === 'TOTAL_INPUT_OVER_LIMIT'));

  const overGoal = parser.parseUserIntent('goal 600% profit on 100 USDT in 60 days');
  t('parser flags over-limit goal and duration',
    overGoal.limitViolations?.some((v) => v.code === 'GOAL_PCT_OVER_LIMIT')
    && overGoal.limitViolations?.some((v) => v.code === 'GOAL_DURATION_OVER_LIMIT'));

  const okParse = parser.parseUserIntent('swap 1000 USDC to ETH on Arbitrum');
  t('compliant parse carries no violations', (okParse.limitViolations || []).length === 0);

  t('Persian dollar amounts parse ("2000 دلار")',
    parser.parseUserIntent('می‌خواهم 2000 دلار وارد کنم').intent.amountUsd === 2000);

  /* ====================== 3. FRIENDLY WARNING IN CHAT ====================== */

  const l1 = human.startSession({ mode: 'human-ai', level: 1, defaultChainId: 42161 });
  t('session opens with the AI greeting and task question',
    l1.messages.at(-1).type === 'conversation'
    && l1.messages.at(-1).payload.flowStart === true
    && l1.messages.at(-1).payload.asksTask === true);

  const overTurn = human.chatTurn(l1, 'swap 900000 USDC to ETH on Arbitrum');
  t('over-limit chat input gets a friendly limits-warning reply',
    overTurn.reply.type === 'limits-warning'
    && overTurn.reply.payload.friendly === true
    && Array.isArray(overTurn.reply.payload.violations)
    && overTurn.reply.payload.violations.length > 0);

  t('over-limit turn creates no drafts and no execution permission',
    overTurn.session.drafts.length === 0
    && overTurn.reply.payload.financialExecutionAuthorized === false);

  /* ====================== 4. STEP-BY-STEP GUIDED FLOW ====================== */

  t('detectYesNo understands fa/en/ar yes and no',
    flow.detectYesNo('بله') === true && flow.detectYesNo('yes') === true
    && flow.detectYesNo('نعم') === true && flow.detectYesNo('نه') === false
    && flow.detectYesNo('no') === false && flow.detectYesNo('لا') === false
    && flow.detectYesNo('BTC on Arbitrum') === null);

  t('duration answers parse in fa/en (روز / ساعت / days)',
    flow.parseDurationAnswer('30 روز') === 720
    && flow.parseDurationAnswer('4 ساعت') === 4
    && flow.parseDurationAnswer('45 دقیقه') === 0.75
    && flow.parseDurationAnswer('30 days') === 720
    && flow.parseDurationAnswer('7') === 168);

  t('amount answers parse ($, دلار, k, هزار)',
    flow.parseAmountAnswer('$2,000') === 2000
    && flow.parseAmountAnswer('2000 دلار') === 2000
    && flow.parseAmountAnswer('2k') === 2000
    && flow.parseAmountAnswer('2 هزار') === 2000);

  // Full guided conversation on an L1 session (analysis-only, nothing executes).
  let s = human.startSession({ mode: 'human-ai', level: 1, defaultChainId: 42161 });
  let r = human.chatTurn(s, 'می‌خواهم 2000 دلار وارد کنم');
  t('guided flow starts with the task question when the action is unclear',
    r.reply.type === 'clarifications-needed' && r.reply.payload.flow?.step === 'TASK');

  const answers = ['هدف', '50', 'بله', '30 روز', 'بله', 'USDT', 'ETH', 'آربیتروم'];
  const expectedSteps = ['GOAL', 'CONFIRM_GOAL', 'DURATION', 'CONFIRM_DURATION', 'FROM', 'TO', 'NETWORK', 'TOOLS'];
  for (let i = 0; i < answers.length; i++) {
    r = human.chatTurn(r.session, answers[i]);
    t(`guided flow step after "${answers[i]}" is ${expectedSteps[i]}`,
      r.session.flow?.step === expectedSteps[i]);
  }
  r = human.chatTurn(r.session, 'فقط swap و bridge');
  t('tool permission answer completes the flow into the auditable pipeline',
    r.session.flow?.active === false
    && r.reply.type === 'analysis'
    && r.reply.payload.intent?.kind === 'goal'
    && r.reply.payload.intent?.goalPct === 50
    && r.reply.payload.intent?.durationHrs === 720);

  t('timed goal sets a live countdown deadline (~30 days)',
    r.session.goalDeadline != null
    && Math.abs(r.session.goalDeadline - (Date.now() + 720 * 3_600_000)) < 60_000
    && r.session.goalMeta?.pct === 50);

  // Over-limit answer inside the flow keeps the flow and warns friendly.
  let s2 = human.startSession({ mode: 'human-ai', level: 1, defaultChainId: 42161 });
  let r2 = human.chatTurn(s2, 'swap USDC to ETH on Arbitrum');
  r2 = human.chatTurn(r2.session, '450000');
  t('over-limit amount ANSWER warns without advancing the flow',
    r2.reply.type === 'limits-warning'
    && r2.reply.payload.violations?.some((v) => v.code === 'PER_TX_OVER_LIMIT')
    && r2.session.flow?.step === 'AMOUNT');
  r2 = human.chatTurn(r2.session, '100');
  t('a compliant retry continues the flow (amount confirmation)',
    r2.session.flow?.step === 'CONFIRM_AMOUNT');

  // Jump-ahead: a complete request bypasses remaining questions.
  let s3 = human.startSession({ mode: 'human-ai', level: 2, defaultChainId: 42161 });
  let r3 = human.chatTurn(s3, 'swap USDC to ETH on Arbitrum');
  r3 = human.chatTurn(r3.session, 'swap 100 USDC to ETH on Arbitrum');
  t('a complete request jumps ahead of the flow to the pipeline',
    r3.reply.type === 'prepared-draft' && r3.session.flow?.step === 'EXECUTION_CONFIRMATION');

  /* ====================== 5. MULTI-AGENT ROUTING + CHAT EXECUTION ====================== */

  const l3policy = {
    maxCapitalUsd: 5000, maxTransactionUsd: 1000, maxLossUsd: 500,
    allowedChains: [42161], allowedProtocols: ['swap'],
    allowedAssets: ['USDC', 'ETH', 'USDT'], durationMs: 3_600_000
  };
  let s4 = human.startSession({ mode: 'human-ai', level: 3, defaultChainId: 42161, policyInput: l3policy });
  s4 = human.confirmSessionPolicy(s4).session;
  let r4 = human.chatTurn(s4, 'swap 100 USDC to ETH on Arbitrum');
  t('L3 preparation announces the two-agent analysis before the result',
    r4.session.messages.some((m) => m.type === 'agents-analyzing'
      && m.payload.agents?.length === 2
      && m.payload.executable === false)
    && r4.reply.type === 'ready-for-confirmation');
  t('the announced best route names the analysed action and pair',
    r4.reply.payload.bestRoute?.action === 'swap'
    && r4.reply.payload.bestRoute?.from === 'USDC'
    && r4.reply.payload.bestRoute?.to === 'ETH');

  r4 = human.chatTurn(r4.session, 'بله، تأیید می‌کنم');
  t('chat "yes" executes through the REAL Confirmation Gate path',
    r4.ok === true
    && r4.reply.type === 'status'
    && r4.receipt?.fabricated === false
    && r4.session.authorization?.executionAuthorized === true);

  let s5 = human.startSession({ mode: 'human-ai', level: 3, defaultChainId: 42161, policyInput: l3policy });
  s5 = human.confirmSessionPolicy(s5).session;
  let r5 = human.chatTurn(s5, 'swap 100 USDC to ETH on Arbitrum');
  r5 = human.chatTurn(r5.session, 'نه');
  t('chat "no" declines without executing anything',
    r5.reply.type === 'execution-declined'
    && r5.session.flow?.active === false
    && r5.session.authorization?.executionAuthorized !== true);

  /* ====================== 6. MULTI-STEP PLANS ====================== */

  let s6 = human.startSession({ mode: 'human-ai', level: 3, defaultChainId: 42161, policyInput: l3policy });
  s6 = human.confirmSessionPolicy(s6).session;
  let r6 = human.chatTurn(s6, 'swap 100 USDC to ETH on Arbitrum');
  // Simulate a second plan step (e.g. a follow-up bridge) as its own draft.
  const firstId = r6.session.drafts[0].id;
  const second = { ...r6.session.drafts[0], id: 'order_probe_second_step' };
  s6 = {
    ...r6.session,
    drafts: [...r6.session.drafts, second],
    flow: { ...r6.session.flow, draftIds: [firstId, second.id] }
  };
  const exec1 = human.executeConfirmed(s6, { action: 'CONFIRM' });
  t('after step 1 the next step is announced with its OWN authorization screen',
    exec1.session.messages.at(-1).type === 'next-step-ready'
    && exec1.session.messages.at(-1).payload.authorizationScreen?.required === true
    && exec1.session.messages.at(-1).payload.termsHash
    && exec1.session.flow?.step === 'EXECUTION_CONFIRMATION'
    && exec1.session.flow?.nextIndex === 1);
  const exec2 = human.chatTurn(exec1.session, 'بله');
  t('a second chat "yes" runs the next step and completes the flow',
    exec2.ok === true && exec2.session.flow?.active === false);

  /* ====================== 7. UI WIRING (source-level) ====================== */

  const panel = readFileSync('src/components/IntentAIPanel.jsx', 'utf8');
  const css = readFileSync('src/styles/intent-os.css', 'utf8');
  const html = readFileSync('index.html', 'utf8');
  const countdown = readFileSync('src/components/GoalCountdown.jsx', 'utf8');
  const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  const fa = JSON.parse(readFileSync('src/i18n/locales/fa.json', 'utf8'));
  const ar = JSON.parse(readFileSync('src/i18n/locales/ar.json', 'utf8'));

  t('CONFIRM/REJECT/CANCEL/REAUTHORIZE are wired to executeConfirmed',
    panel.includes('executeConfirmed(')
    && ['CONFIRM', 'REJECT', 'CANCEL', 'REAUTHORIZE'].every((a) => panel.includes(`'${a}'`))
    && /handleGateAction\('CONFIRM'\)|handleGateAction\(action\)/.test(panel));

  t('REAUTHORIZE re-opens the gate instead of dead-ending',
    panel.includes('function reopenGate') && panel.includes("action === 'REAUTHORIZE'"));

  t('the interactive confirmation screen edits amount/duration/goal with limit hints',
    panel.includes('interactive-confirmation-screen')
    && panel.includes('updateScreen(\'amountUsd\'')
    && panel.includes('updateScreen(\'durationHrs\'')
    && panel.includes('updateScreen(\'goalPct\'')
    && panel.includes('intentAI.limits.hintAmount')
    && panel.includes('intentAI.limits.hintPerTx')
    && panel.includes('intentAI.limits.hintDuration')
    && panel.includes('intentAI.limits.hintGoal'));

  t('tool permissions are checkboxes the user sets before final confirm',
    panel.includes('type="checkbox"')
    && panel.includes('toggleScreenTool')
    && panel.includes('intentAI.confirm.toolsTitle')
    && panel.includes('intentAI.confirm.final'));

  t('chat layout uses dvh with a scrolling thread and a sticky composer',
    panel.includes('ia-chat')
    && css.includes('100dvh')
    && css.includes('.ia-panel.ia-chat .ia-composer')
    && css.includes('position: sticky')
    && css.includes('font-size: 16px'));

  t('viewport resizes with the mobile keyboard (interactive-widget)',
    /interactive-widget=resizes-content/.test(html));

  t('the panel renders the live goal countdown',
    panel.includes('<GoalCountdown')
    && panel.includes('session.goalDeadline')
    && countdown.includes('setInterval')
    && countdown.includes('data-testid="goal-countdown"'));

  t('the examples accordion covers swap/bridge/send/goal/analyze',
    panel.includes('ia-examples')
    && ['swap', 'bridge', 'send', 'goal', 'analyze']
      .every((g) => panel.includes(`intentAI.examples.${g}`) || panel.includes(`'${g}'`)));

  t('the external-agent info button opens an explanatory modal',
    panel.includes('setShowExtInfo(true)')
    && panel.includes('ia-modal')
    && panel.includes('intentAI.externalInfo.securityTitle')
    && panel.includes('intentAI.readiness.secretManagerStandIn'));

  t('the "Capabilities & readiness" and "Runtime capability discovery" blocks are gone',
    !panel.includes('intentAI.capabilities.title')
    && !panel.includes('intentAI.readiness.title')
    && !panel.includes('intentAI.readiness.venueConfigured')
    && !panel.includes('intentAI.readiness.phase8Status'));

  t('flow/limits/countdown copy is translated in en, fa and ar',
    ['flow.questions.confirmAmount', 'limits.TOTAL_INPUT_OVER_LIMIT', 'agents.analyzing',
      'confirm.final', 'countdown.title', 'examples.title', 'externalInfo.title']
      .every((key) => {
        const get = (obj) => `intentAI.${key}`.split('.').reduce((cur, p) => (cur ? cur[p] : undefined), obj);
        const vals = [get(en), get(fa), get(ar)];
        return vals.every((v) => typeof v === 'string' && v.length > 0);
      }));

  return rows;
}
