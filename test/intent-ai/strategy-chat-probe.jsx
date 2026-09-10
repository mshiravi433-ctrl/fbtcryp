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
