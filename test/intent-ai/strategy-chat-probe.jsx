/**
 * STRATEGY CHAT PROBE — does typing an objective in the real page produce a
 * Portfolio Strategy card?
 * ---------------------------------------------------------------------------
 * Every link of the strategy brain is covered by strategy-brain-probe.mjs:
 *
 *   sentence → goal spec                strategy-brain-probe  (A)
 *   21-domain read under budget         strategy-brain-probe  (B)
 *   decision / comparison / stages      strategy-brain-probe  (C)
 *   staged execution + revision         strategy-brain-probe  (D)
 *   classify → STRATEGY_PLAN, card req  strategy-brain-probe  (E)
 *
 * What none of those can see is the GLUE in IntentAIUnified: carrying
 * `strategyRequest` onto the message, running the compile effect, and
 * rendering StrategyPlanCard. That is precisely the failure this repo has hit
 * twice already — logic correct, wiring missing — and the goal card that spun
 * on «در حال خواندن نرخ‌های زنده…» forever was exactly this seam, green in
 * every unit probe while broken in the page.
 *
 * The network is stubbed to FAIL, so no market/yield/derivative domain can
 * answer. That is the point: the brain must still be REACHED and must refuse
 * with a reason (NO_OPPORTUNITIES) rather than invent a plan. A card that
 * appears and refuses honestly proves the chain is connected end to end
 * without pretending there is live data in a test.
 *
 * Mounts ONCE — repeated mounts of this component exhaust the heap.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { TelegramProvider } from '../../src/context/TelegramContext.jsx';
import { WalletProvider } from '../../src/context/WalletContext.jsx';
import IntentAIUnified from '../../src/components/IntentAIUnified.jsx';
import { DECISION_LABELS } from '../../src/components/StrategyPlanCard.jsx';
import { STRATEGY_DECISIONS } from '../../src/lib/strategyBrain/strategyRuntime.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Set a React-controlled input's value so onChange actually fires. */
const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const OBJECTIVE = 'من ۱۰ هزار دلار دارم، در ۴ ماه حداقل ۱۵٪ سود می‌خواهم و ریسک متوسط قبول دارم';

export async function run(container) {
  const rows = [];
  const check = (name, ok) => rows.push([name, !!ok]);
  const q = (sel) => container.querySelector(sel);

  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TelegramProvider>
        <WalletProvider>
          <MemoryRouter initialEntries={['/intent']}>
            <IntentAIUnified />
          </MemoryRouter>
        </WalletProvider>
      </TelegramProvider>
    );
  });
  for (let i = 0; i < 4; i += 1) await act(async () => { await sleep(20); });

  /* The runtime's verdicts are labelled by a lookup table in the card. A
     decision the table does not know renders as a raw code like "CONTINUE"
     in the middle of a Persian sentence, so the two lists are held against
     each other here rather than left to drift. */
  check('every runtime verdict has a Persian and an English label',
    STRATEGY_DECISIONS.every((d) => DECISION_LABELS[d]?.fa && DECISION_LABELS[d]?.en),
    STRATEGY_DECISIONS.filter((d) => !DECISION_LABELS[d]?.fa || !DECISION_LABELS[d]?.en).join(','));
  check('the label table carries no verdict the runtime cannot return',
    Object.keys(DECISION_LABELS).every((d) => STRATEGY_DECISIONS.includes(d)));

  check('the chat renders', !!q('.iaos-composer'));

  /* ── Type the whole-ecosystem objective and send it ─────────────────── */
  const input = q('.iaos-composer input.iaos-input');
  await act(async () => { setInputValue(input, OBJECTIVE); });
  await act(async () => { await sleep(10); });
  check('the objective lands in the composer', input?.value?.includes('۱۵٪') === true);

  const send = q('.iaos-composer button.iaos-send');
  check('the send button is enabled once there is text', !!send && send.disabled === false);
  if (send) await act(async () => { send.click(); });

  /*
   * The turn runs the intent OS, then the strategy effect awaits the
   * ecosystem fan-out. With the network dead every domain still burns its own
   * timeout under the concurrency cap, so wait for the card to settle rather
   * than guessing at a fixed budget.
   */
  let settled = null;
  for (let i = 0; i < 80; i += 1) {
    await act(async () => { await sleep(50); });
    settled = container.querySelector('[data-testid="strategy-plan-card"]')
      || container.querySelector('[data-testid="strategy-plan-refused"]')
      || container.querySelector('[data-testid="strategy-plan-error"]');
    if (settled) break;
  }

  check('a strategy card appears for the objective (the wiring is connected)', !!settled);
  check('it never stays stuck on "reading the ecosystem"', !q('[data-testid="strategy-plan-loading"]'));

  const card = q('[data-testid="strategy-plan-card"]');
  const refused = q('[data-testid="strategy-plan-refused"]');

  if (card) {
    /* Live enough to build: then the card must show its whole structure. */
    check('the verdict is carried as data, not only as colour', !!q('.isp-verdict[data-verdict]'));
    check('the coverage row reports what actually answered', !!q('[data-testid="strategy-coverage"]'));
    check('the options are compared in a table', !!q('[data-testid="strategy-comparison"]'));
    check('the allocation lists its sleeves', !!q('[data-testid="strategy-sleeves"]'));
    check('the plan is staged', !!q('[data-testid="strategy-stages"]'));
    check('monitors are listed', !!q('[data-testid="strategy-monitors"]'));
    check('the plan states it moves nothing without a signature',
      (card.textContent || '').includes('امضا') || (card.textContent || '').includes('signature'));
  }
  if (refused) {
    check('with no live data it refuses instead of inventing a plan', !!refused.dataset.code);
    check('the refusal explains itself in words', (refused.textContent || '').trim().length > 10);
    check('the refusal names a reason code', Boolean(refused.dataset.code));
  }

  /* ── Persistence: a plan built for a months-long horizon must survive the
        tab closing, otherwise the stage progress that staged execution and
        revision both act on is gone. This is the check that fails if the
        store is written but never CALLED from the component. ──────────── */
  const STORE_KEY = 'fbt.strategy-brain.plans.v1';
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch { stored = null; }
  check('the built plan is written to the strategy store', Boolean(stored),
    stored ? '' : 'nothing under ' + STORE_KEY);
  check('the store holds a resumable strategy',
    Array.isArray(stored?.plans) && stored.plans.length > 0 && stored.plans[0].strategy?.ok === true);
  const storedPlan = stored?.plans?.[0];
  check('the stored plan carries the goal it was built from',
    Number(storedPlan?.goal?.capitalUsd) === 10000 && Number(storedPlan?.goal?.targetPct) === 15,
    JSON.stringify({ capital: storedPlan?.goal?.capitalUsd, target: storedPlan?.goal?.targetPct }));
  check('the stored plan keeps its stage list',
    (storedPlan?.strategy?.stages || []).length > 0,
    `${(storedPlan?.strategy?.stages || []).length} stages`);
  check('no signature payload reached storage',
    !/privatekey|mnemonic|seedphrase/i.test(localStorage.getItem(STORE_KEY) || ''));

  /* ── Running a stage must move the plan's state, and write it back. A
        hand-off that records nothing leaves a returning user at stage one
        forever — and a hand-off that records CONFIRMED would be a lie,
        because the signature happens on the venue page, not here. ─────── */
  const runBtn = q('[data-testid="strategy-execute-stage"]');
  check('the card offers to run the next stage', !!runBtn && runBtn.disabled === false);
  if (runBtn) {
    const before = (JSON.parse(localStorage.getItem(STORE_KEY) || '{}').plans || [])[0];
    await act(async () => { runBtn.click(); });
    for (let i = 0; i < 20; i += 1) { await act(async () => { await sleep(50); }); }
    const after = (JSON.parse(localStorage.getItem(STORE_KEY) || '{}').plans || [])[0];
    const states = Object.values(after?.runtime?.stageProgress || {});
    check('running a stage records stage progress in the store',
      states.length > 0, `${states.length} stage rows`);
    check('the handed-off stage is marked RUNNING, never CONFIRMED',
      states.some((s) => s.state === 'RUNNING') && !states.some((s) => s.state === 'CONFIRMED'),
      JSON.stringify(states.map((s) => s.state)));
    check('the stored plan is still the same strategy after the run',
      after?.strategyId === before?.strategyId && Boolean(after?.strategyId),
      `${before?.strategyId} -> ${after?.strategyId}`);
    check('the chat says the signature happens on the venue page, not in chat',
      (container.textContent || '').includes('امضا') || (container.textContent || '').includes('signature'));
  }

  /* ── Monitoring: the plan must be measurable against reality, and must
        refuse rather than guess when there is no portfolio to measure. In
        this environment no wallet is connected, so the honest outcome is a
        named refusal — a verdict invented from nothing would be a lie in
        the one place the whole feature exists to avoid. ───────────────── */
  const monitorBtn = q('[data-testid="strategy-monitor"]');
  check('the card offers to check the plan against reality', !!monitorBtn && monitorBtn.disabled === false);
  if (monitorBtn) {
    await act(async () => { monitorBtn.click(); });
    for (let i = 0; i < 20; i += 1) { await act(async () => { await sleep(50); }); }
    const bodyText = container.textContent || '';
    check('monitoring without a portfolio refuses instead of guessing',
      bodyText.includes('کیف پول') || bodyText.includes('wallet'),
      bodyText.slice(-260));
    check('it does not invent a verdict without data',
      !q('[data-testid="strategy-live"]'));
    check('it does not offer to rebuild on data it never saw',
      !q('[data-testid="strategy-revise"]'));
  }

  /* ── The plain portfolio question must NOT be swallowed by the objective
        path: «من … دارم» is in both sentences, and the holdings heuristic used
        to answer the objective as "do you hold USD?". ─────────────────── */
  const input2 = q('.iaos-composer input.iaos-input');
  await act(async () => { setInputValue(input2, 'پرتفوی من را تحلیل کن'); });
  await act(async () => { await sleep(10); });
  const send2 = q('.iaos-composer button.iaos-send');
  if (send2 && !send2.disabled) await act(async () => { send2.click(); });
  for (let i = 0; i < 20; i += 1) {
    await act(async () => { await sleep(50); });
    if (container.querySelectorAll('.iaos-msg.iaos-ai').length >= 2) break;
  }
  const bubbles = container.querySelectorAll('.iaos-msg.iaos-ai');
  check('the follow-up question gets its own answer', bubbles.length >= 2);
  const lastText = bubbles[bubbles.length - 1]?.textContent || '';
  check('a portfolio question is not answered as a strategy request',
    !lastText.includes('استراتژی پرتفوی') && lastText.length > 5);

  await act(async () => { root.unmount(); });
  return rows;
}
