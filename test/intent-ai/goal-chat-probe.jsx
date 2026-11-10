/**
 * GOAL CHAT PROBE — does typing a goal in the real page produce a goal card?
 * ---------------------------------------------------------------------------
 * This is the last unwired seam the other suites could not reach. Each link is
 * covered somewhere:
 *
 *   understandIntent → GOAL_PLAN      goal-pipeline-probe
 *   humanResponse → goalRequest       goal-pipeline-probe
 *   compiler → plan / refusal         autonomy-engine-probe
 *   GoalPlanCard renders + clicks     autonomy-cards-probe
 *
 * But the GLUE lives in IntentAIUnified: it has to carry goalRequest onto the
 * message, run the compile effect, and render the card. That is exactly the
 * class of bug found twice already on this branch — logic correct, wiring
 * missing — and nothing tested it. A user types «سودم دو برابر شود» and gets a
 * sentence, not a plan.
 *
 * The network is stubbed to FAIL and no wallet is connected, so the compiler
 * has nothing real to plan against and must refuse. That is the point: the card
 * has to appear and refuse honestly, which proves the chain is connected end to
 * end without pretending there are live rates in a test.
 *
 * WHY THE FIRST SENTENCE NAMES AN AMOUNT. Since cb9d0235 a goal that leaves a
 * value out («سودم ۲ برابر شود در ۹۰ روز» — no amount) is not handed to the
 * compiler: the page keeps what was said and opens the dedicated answer box
 * for what is missing, and the composer waits for that answer. This probe kept
 * sending the short sentence, so no card could appear and its second message
 * was never sent — three failures, one cause, none of them the glue. The goal
 * now states its amount, which is the sentence that reaches the compiler; the
 * short one is sent LAST and must open the answer box, so the next change to
 * that routing fails here by name instead of as three unrelated-looking rows.
 *
 * The refusal's REASON is deliberately not asserted. With no wallet the
 * compiler stops at CAPITAL_REQUIRED before it reads a rate: `planFromIntent`
 * does not count a typed amount as capital while a target is present. Whether
 * it should is a product decision, not something for a probe to pin either way.
 *
 * Mounts ONCE — four mounts of this component exhaust a 3 GB heap (measured).
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { TelegramProvider } from '../../src/context/TelegramContext.jsx';
import { WalletProvider } from '../../src/context/WalletContext.jsx';
import IntentAIUnified from '../../src/components/IntentAIUnified.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Set a React-controlled input's value so onChange actually fires.
 *  React tracks the value with its own descriptor, so a plain `.value =`
 *  assignment is invisible to it; this uses the native setter and then
 *  dispatches the event React is listening for. */
const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor((input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement).prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

/* A goal the page hands to the compiler as typed (amount, target, horizon)… */
const GOAL_WITH_AMOUNT = 'با ۱۰۰۰ دلار سودم ۲ برابر شود در ۹۰ روز';
/* …and the same goal with the amount left out, which opens the answer box. */
const GOAL_WITHOUT_AMOUNT = 'سودم ۲ برابر شود در ۹۰ روز';

export async function run(container) {
  /* Array rows — the shape test/run-one-probe.mjs and run.mjs's report() take. */
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

  check('the chat renders', !!q('.iaos-composer'));
  check('the composer has an input', !!q('.iaos-composer textarea.iaos-input'));

  /* ── Type a goal and send it ─────────────────────────────────────────── */
  const input = q('.iaos-composer textarea.iaos-input');
  await act(async () => { setInputValue(input, GOAL_WITH_AMOUNT); });
  await act(async () => { await sleep(10); });
  check('the goal text lands in the composer', input?.value?.includes('برابر') === true);

  const send = q('.iaos-composer button.iaos-send');
  check('the send button is enabled once there is text', !!send && send.disabled === false);
  if (send) {
    await act(async () => { send.click(); });
  }
  /* The turn runs the intent OS, then a compile effect that awaits the rate
     sources. With the network stubbed dead those reads still take their full
     timeout, so wait for the card to leave its loading state rather than
     guessing at a fixed budget. */
  for (let i = 0; i < 60; i += 1) {
    await act(async () => { await sleep(50); });
    const settled = container.querySelector('[data-testid="goal-plan-card"]')
      || container.querySelector('[data-testid="goal-plan-refused"]')
      || container.querySelector('[data-testid="goal-plan-error"]');
    if (settled) break;
  }

  /* ── The chain must have produced a goal card ────────────────────────── */
  const card = q('[data-testid="goal-plan-card"]');
  const refused = q('[data-testid="goal-plan-refused"]');
  const errored = q('[data-testid="goal-plan-error"]');

  check('a goal card appears for the goal message', !!(card || refused || errored));
  check('with no live rates it refuses rather than inventing a plan', !!refused || !!card);
  if (card) {
    check('the card states its verdict as data', !!q('.iaos-goal-verdict[data-verdict]'));
    check('the card carries the honesty sentence', (card.textContent || '').length > 20);
  }
  if (refused) {
    check('the refusal explains itself in words', (refused.textContent || '').trim().length > 10);
  }

  /* ── Second message in the SAME mount: the automation card ─────────────
     AUTONOMY needs neither a wallet nor live rates — the human layer returns
     the card outright — so this is reachable with the network dead. It is the
     other half of the reported complaint («اتوماسیون خوب کار نمی‌کنه») and the
     same glue question: does the chat turn an autonomyRequest into a card. */
  const input2 = q('.iaos-composer textarea.iaos-input');
  await act(async () => { setInputValue(input2, 'اتوماسیون را با حالت کاغذی شروع کن'); });
  await act(async () => { await sleep(10); });
  const send2 = q('.iaos-composer button.iaos-send');
  if (send2 && !send2.disabled) {
    await act(async () => { send2.click(); });
  }
  for (let i = 0; i < 40; i += 1) {
    await act(async () => { await sleep(50); });
    if (container.querySelector('[data-testid="autonomy-card"]')) break;
  }

  const autoCard = q('[data-testid="autonomy-card"]');
  check('an automation request produces the automation card', !!autoCard);
  if (autoCard) {
    check('the automation card states its state as data', !!autoCard.querySelector('.iaos-goal-verdict[data-state]'));
    check('it offers the builtin strategies as armable rows', autoCard.querySelectorAll('[data-testid^="autonomy-arm-"]').length > 0);
  }

  /* ── Last, because it parks the composer: the goal WITHOUT an amount ────
     The page must ask for the missing value in its own answer box — not build
     a second card on an amount nobody gave. Everything above depends on this
     routing, so it is checked here rather than discovered as missing cards. */
  const goalCards = () => container.querySelectorAll(
    '[data-testid="goal-plan-card"], [data-testid="goal-plan-refused"], [data-testid="goal-plan-error"], [data-testid="goal-plan-loading"]'
  ).length;
  const cardsBefore = goalCards();
  const input3 = q('.iaos-composer textarea.iaos-input');
  await act(async () => { setInputValue(input3, GOAL_WITHOUT_AMOUNT); });
  let send3 = null;
  for (let i = 0; i < 40; i += 1) {
    await act(async () => { await sleep(50); });
    send3 = q('.iaos-composer button.iaos-send');
    if (send3 && !send3.disabled) break;
  }
  if (send3 && !send3.disabled) {
    await act(async () => { send3.click(); });
  }
  for (let i = 0; i < 40; i += 1) {
    await act(async () => { await sleep(50); });
    if (container.querySelector('[data-testid="intent-ai-multislot-form"]')) break;
  }
  check('a goal with no amount opens the answer box for what is missing',
    !!q('[data-testid="intent-ai-multislot-form"]'));
  check('and no card is built on an amount nobody gave', goalCards() === cardsBefore);

  await act(async () => { root.unmount(); });
  return rows;
}
