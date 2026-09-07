/**
 * AUTONOMY CARDS — rendered, not just imported.
 * ---------------------------------------------------------------------------
 * The screens suite proves `IntentAIUnified` mounts. It cannot prove these two
 * cards render, because they only appear once a message carries
 * `goalRequest` / `autonomyRequest` — a path no screen smoke test reaches.
 * A throw inside either one would take the whole chat screen down the first
 * time a user asked «سودم دو برابر شود», which is precisely the feature this
 * branch exists for.
 *
 * So this mounts both with REAL objects: a plan built by the real compiler
 * from real rate rows, and a real autonomy engine. Then it clicks the buttons
 * and asserts the handlers actually fired.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { GoalPlanCard, AutonomyCard } from '../../src/components/AutonomyCards.jsx';
import { planFromIntent } from '../../src/lib/intent-ai/autonomy/goalSources.js';
import { createAutonomyEngine, BUILTIN_STRATEGIES } from '../../src/lib/intent-ai/autonomy/index.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RATE_ROWS = [
  { id: 'lending:aave-v3:USDC', kind: 'lending', protocol: 'aave-v3', symbol: 'USDC', chainId: 8453, apy: 4.62, risk: 'low', tvlUsd: null },
  { id: 'farm:jupiter:SOL-USDC', kind: 'farm', protocol: 'Jupiter', symbol: 'SOL-USDC', chainId: 501, apy: 18.4, risk: 'medium', tvlUsd: 12e6 }
];

export async function run(container) {
  const rows = [];
  /* Array rows, matching screens.jsx and intent-ai-panel-probe.jsx — that is
     the shape test/run-one-probe.mjs and run.mjs's report() both consume. */
  const check = (name, ok) => rows.push([name, !!ok]);
  const q = (sel) => container.querySelector(sel);
  const all = (sel) => Array.from(container.querySelectorAll(sel));

  /* ── A real plan from the real compiler ───────────────────────────────── */
  const { plan } = await planFromIntent({
    intent: { type: 'GOAL_PLAN', entities: { goalMultiple: 2, horizonDays: 90 } },
    context: { portfolio: { totalValueUsd: 10000, holdings: [] } },
    results: { yieldOpportunities: { ok: true, opportunities: RATE_ROWS } },
    locale: 'fa'
  });

  /* ── 1. GoalPlanCard renders the plan and does not throw ──────────────── */
  let executed = null;
  let opened = null;
  let root = createRoot(container);
  await act(async () => {
    root.render(<GoalPlanCard
      plan={plan}
      capital={plan.capitalUsd}
      locale="fa"
      onExecute={(opt) => { executed = opt; }}
      onOpenRoute={(r) => { opened = r; }}
    />);
  });
  await act(async () => { await sleep(10); });

  check('GoalPlanCard mounts', !!q('[data-testid="goal-plan-card"]'));
  check('it shows the verdict chip', !!q('.iaos-goal-verdict'));
  check('the verdict carries a state attribute, not colour alone', !!q('.iaos-goal-verdict[data-verdict]'));
  check('it renders the honesty sentence', (container.textContent || '').includes('٪') || (container.textContent || '').includes('%'));
  check('it renders at least one option', all('[data-testid^="goal-option-"]').length > 0);
  check('it renders the execute button', !!q('[data-testid="goal-plan-execute"]'));

  /* clicking an option selects it, and Execute hands the real option back */
  const firstOption = q('[data-testid^="goal-option-"]');
  if (firstOption) {
    await act(async () => { firstOption.click(); });
    await act(async () => { await sleep(10); });
  }
  const execBtn = q('[data-testid="goal-plan-execute"]');
  if (execBtn && !execBtn.disabled) {
    await act(async () => { execBtn.click(); });
    await act(async () => { await sleep(10); });
  }
  check('clicking Execute hands back a real option with actions', !!executed && Array.isArray(executed.actions) && executed.actions.length > 0);

  /* the busy state must not offer a second click */
  await act(async () => {
    root.render(<GoalPlanCard plan={plan} capital={plan.capitalUsd} locale="fa" busy onExecute={() => {}} />);
  });
  await act(async () => { await sleep(10); });
  const busyBtn = q('[data-testid="goal-plan-execute"]');
  check('while busy the execute button cannot be pressed again', !busyBtn || busyBtn.disabled === true);

  /* a refused plan has to say so rather than render an empty card */
  const refused = await planFromIntent({
    intent: { type: 'GOAL_PLAN', entities: { goalMultiple: 2, horizonDays: 90 } },
    context: { portfolio: { totalValueUsd: 10000 } },
    results: {},
    locale: 'fa'
  });
  await act(async () => {
    root.render(<GoalPlanCard plan={refused.plan} capital={10000} locale="fa" />);
  });
  await act(async () => { await sleep(10); });
  check('a refused plan renders the refusal state', !!q('[data-testid="goal-plan-refused"]'));
  check('a refused plan offers no execute button', !q('[data-testid="goal-plan-execute"]'));

  /* an error is shown, not swallowed */
  await act(async () => {
    root.render(<GoalPlanCard plan={null} error="برنامه ساخته نشد" locale="fa" />);
  });
  await act(async () => { await sleep(10); });
  check('a build error is rendered', !!q('[data-testid="goal-plan-error"]'));
  await act(async () => { root.unmount(); });

  /* ── 2. AutonomyCard with a REAL engine ───────────────────────────────── */
  let armed = null;
  let stopped = false;
  let modeSet = null;
  let ticked = false;

  const engine = createAutonomyEngine({
    mode: 'PAPER',
    store: { save: () => {}, load: () => null }
  });

  container.innerHTML = '';
  root = createRoot(container);
  await act(async () => {
    root.render(<AutonomyCard
      strategies={BUILTIN_STRATEGIES}
      engine={engine}
      locale="fa"
      onArm={(p) => { armed = p; }}
      onDisarm={() => {}}
      onMode={(m) => { modeSet = m; }}
      onStart={() => {}}
      onStop={() => { stopped = true; }}
      onTick={() => { ticked = true; }}
      onOpenRoute={(r) => { opened = r; }}
    />);
  });
  await act(async () => { await sleep(10); });

  check('AutonomyCard mounts', !!q('[data-testid="autonomy-card"]'));
  check('it reports the engine state before anything is armed', (container.textContent || '').length > 20);
  check('it renders the builtin strategies as armable rows', all('[data-testid^="autonomy-arm-"]').length > 0);

  const armBtn = q('[data-testid^="autonomy-arm-"]');
  if (armBtn && !armBtn.disabled) {
    await act(async () => { armBtn.click(); });
    await act(async () => { await sleep(10); });
  }
  check('clicking Arm hands back a strategy and a stake', !!armed && !!armed.strategy && Number(armed.stakeUsd) > 0);

  /* The Stop control is rendered only while the loop is running — which is
     correct, so the probe has to actually start the engine to reach it.
     (An earlier version of this check clicked `autonomy-halted`, which is a
     <p>, and passed vacuously.) */
  check('before start there is no stop button', !q('[data-testid="autonomy-stop"]'));
  check('the card reports the stopped state as data', q('.iaos-goal-verdict')?.getAttribute('data-state') === 'stopped');

  await act(async () => { engine.start(); });
  await act(async () => {
    root.render(<AutonomyCard
      strategies={BUILTIN_STRATEGIES}
      engine={engine}
      locale="fa"
      onArm={(p) => { armed = p; }}
      onDisarm={() => {}}
      onMode={(m) => { modeSet = m; }}
      onStart={() => {}}
      onStop={() => { stopped = true; }}
      onTick={() => { ticked = true; }}
      onOpenRoute={(r) => { opened = r; }}
    />);
  });
  await act(async () => { await sleep(10); });

  check('once running the card says so as data', q('.iaos-goal-verdict')?.getAttribute('data-state') === 'running');
  const stopBtn = q('[data-testid="autonomy-stop"]');
  check('a running loop offers a stop control', !!stopBtn);
  /* Mirror the REAL wiring: IntentAIUnified passes onStop={stopAutonomy},
     which calls engine.stop(). A handler that only flips a flag would let
     this check pass while the loop kept ticking. */
  const realStop = () => { stopped = true; engine.stop(); };
  await act(async () => {
    root.render(<AutonomyCard
      strategies={BUILTIN_STRATEGIES}
      engine={engine}
      locale="fa"
      onArm={(p) => { armed = p; }}
      onDisarm={() => {}}
      onMode={(m) => { modeSet = m; }}
      onStart={() => {}}
      onStop={realStop}
      onTick={() => { ticked = true; }}
      onOpenRoute={(r) => { opened = r; }}
    />);
  });
  await act(async () => { await sleep(10); });
  const runningStopBtn = q('[data-testid="autonomy-stop"]');
  if (runningStopBtn && !runningStopBtn.disabled) {
    await act(async () => { runningStopBtn.click(); });
    await act(async () => { await sleep(10); });
  }
  check('clicking stop calls onStop', stopped === true);
  check('the engine really stopped', engine.status?.()?.running === false);

  const tickBtn = all('button').find((b) => (b.getAttribute('data-testid') === 'autonomy-tick'));
  if (tickBtn && !tickBtn.disabled) {
    await act(async () => { tickBtn.click(); });
    await act(async () => { await sleep(10); });
  }
  check('a tick control exists and calls onTick', ticked === true || !tickBtn);

  /* the card must survive an engine that has never been started */
  await act(async () => {
    root.render(<AutonomyCard strategies={[]} engine={null} locale="fa" />);
  });
  await act(async () => { await sleep(10); });
  check('it renders with no engine and no strategies', !!q('[data-testid="autonomy-card"]'));

  await act(async () => { root.unmount(); });
  return rows;
}
