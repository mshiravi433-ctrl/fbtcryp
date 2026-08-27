/**
 * INTENT AI PANEL — mounted and driven like a user drives it.
 * ---------------------------------------------------------------------------
 * The logic probes cover the parser, the flow engine and executeConfirmed.
 * None of them can catch the wiring bug this suite exists for: an onClick
 * that references a prop nobody passes, a state flag that is never set, a
 * button rendered with a handler that does nothing — the exact class of
 * "the confirm button does not work" report.
 *
 * So this mounts the REAL panel and drives it through the keyboard:
 *
 *   · the session greeting + task chips render on open
 *   · a vague request starts the guided flow and a quick-reply chip answers it
 *   · an over-limit amount typed into the interactive confirmation screen
 *     shows the friendly warning and disables the final confirm
 *   · the final confirm executes through the REAL executeConfirmed path and
 *     renders the honest receipt (plus the two-agent analysis bubble)
 *   · a timed goal renders the live countdown
 *   · the examples accordion fills the composer; the info button opens the
 *     external-agent modal
 *
 * The network is stubbed to FAIL on purpose: the panel must be fully usable
 * with discovery unavailable (the honest empty states).
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import '../src/i18n/index.js';
import IntentAIPanel from '../src/components/IntentAIPanel.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Set a React-controlled input's value so onChange actually fires.
 *  React tracks the last value it knows on the node itself; a raw
 *  `.value =` assignment updates that tracker, so the subsequent input
 *  event looks like "no change" and onChange never runs. Going through
 *  the prototype setter leaves the tracker stale, which is exactly what
 *  a real keystroke does. */
const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

export async function run(container) {
  const out = [];
  const t = (name, ok) => { out.push([name, Boolean(ok)]); console.log((ok ? '✓ ' : '✗ ') + name); };
  const errors = [];

  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped')) return;
    if (s.includes('Not implemented')) return;
    if (s.includes('ReactDOMTestUtils.act') || s.includes('is deprecated')) return;
    if (s.includes('React Router Future Flag')) return;
    errors.push(s);
  };

  const realFetch = globalThis.fetch;
  // Dead network on purpose: discovery must degrade honestly, never crash.
  globalThis.fetch = async () => { throw new Error('offline'); };

  const q = (sel) => container.querySelector(sel);
  const qa = (sel) => [...container.querySelectorAll(sel)];

  try {
    let root = null;
    const mount = async () => {
      root = createRoot(container);
      await act(async () => {
        root.render(<IntentAIPanel defaultChainId={42161} />);
      });
      await act(async () => { await sleep(30); });
    };

    /* ---------------- 1. first paint ---------------- */
    await mount();
    t('the panel renders with the AI greeting asking what to do',
      !!q('.ia-panel.ia-chat') && qa('.intent-ai-thread > div').length >= 1);

    t('the examples accordion is present with clickable examples',
      !!q('.ia-examples summary') && qa('.ia-example-chip').length >= 10);

    t('the external-agent info button is present',
      !!q('[data-testid="external-agent-info-button"]'));

    t('the old "Capabilities & readiness" / "Runtime capability discovery" blocks are gone',
      !qa('details').some((d) => /Capabilities & readiness|Runtime capability discovery/i.test(d.textContent)));

    /* ---------------- 2. info modal ---------------- */
    await act(async () => { q('[data-testid="external-agent-info-button"]').click(); });
    await act(async () => { await sleep(10); });
    const modal = q('[data-testid="external-agent-info-modal"]');
    t('the info button opens the external-agent explanation modal',
      !!modal && /External Agent mode/i.test(modal.textContent || '')
      && /Security boundaries/i.test(modal.textContent || ''));
    const closeBtn = modal && [...modal.querySelectorAll('button')].find((b) => b.className.includes('ia-modal-close'));
    await act(async () => { closeBtn?.click(); });
    await act(async () => { await sleep(10); });
    t('closing the modal removes it', !q('[data-testid="external-agent-info-modal"]'));

    /* ---------------- 3. examples fill the composer ---------------- */
    const composerInput = q('.ia-composer input');
    await act(async () => { qa('.ia-example-chip')[0].click(); });
    t('tapping an example fills the composer (user can adapt before sending)',
      composerInput && /swap/i.test(composerInput.value));

    /* ---------------- 4. guided flow via quick replies ---------------- */
    await act(async () => { setInputValue(composerInput, 'hello'); });
    await act(async () => { q('.ia-composer .ia-send').click(); });
    await act(async () => { await sleep(10); });
    t('a vague request opens the guided flow task question with chips',
      !!q('[data-testid="flow-question-task"]') && qa('[data-testid="flow-question-task"] .ia-chip').length >= 4);

    const goalChip = qa('[data-testid="flow-question-task"] .ia-chip')
      .find((b) => /goal/i.test(b.textContent || ''));
    await act(async () => { goalChip?.click(); });
    await act(async () => { await sleep(10); });
    t('answering the task chip advances the flow to the amount question',
      !!q('[data-testid="flow-question-amount"]'));

    /* ---------------- 5. L3: interactive confirmation + real execution ---------------- */
    // Switch to L3, confirm the default policy, then request a swap.
    const l3chip = qa('.chip').find((b) => /^L3/.test((b.textContent || '').trim()));
    await act(async () => { l3chip?.click(); });
    await act(async () => { await sleep(20); });
    const confirmPolicy = qa('button').find((b) => /CONFIRM & START/i.test(b.textContent || ''));
    await act(async () => { confirmPolicy?.click(); });
    await act(async () => { await sleep(20); });

    await act(async () => { setInputValue(composerInput, 'swap 100 USDC to ETH on Arbitrum'); });
    await act(async () => { q('.ia-composer .ia-send').click(); });
    await act(async () => { await sleep(30); });

    t('a prepared plan shows the two-agent analysis bubble in chat',
      !!q('[data-testid="agents-analyzing"]'));

    const screen = q('[data-testid="interactive-confirmation-screen"]');
    t('the interactive confirmation screen opens automatically',
      !!screen && !!q('[data-testid="final-confirm-button"]'));

    t('the screen offers editable amount/duration/goal with max-limit hints',
      !!screen && qa('input[type="number"]').length >= 2
      && /maximum allowed total/i.test(screen.textContent || '')
      && /maximum per transaction/i.test(screen.textContent || ''));

    t('the screen has tool permission checkboxes (swap/bridge/dca)',
      !!screen && qa('input[type="checkbox"]').length >= 3
      && /allowed to use/i.test(screen.textContent || ''));

    // Over-limit edit → friendly warning + disabled final confirm.
    const amountInput = screen && [...screen.querySelectorAll('input[type="number"]')][0];
    await act(async () => { setInputValue(amountInput, '6000'); });
    await act(async () => { await sleep(10); });
    t('an over-limit edit shows the friendly limit warning and blocks confirm',
      /above the per-transaction ceiling/i.test(screen?.textContent || '')
      && q('[data-testid="final-confirm-button"]').disabled === true);

    /*
     * Phase 56 — the reported bug, driven through the keyboard: $500 clears
     * every product ceiling but breaks the ACTIVE L3 session policy ($200 per
     * transaction). The screen must say so under the fields and lock the
     * final confirm; it must NOT wait and answer "no live venue" afterwards.
     */
    t('the screen shows the ACTIVE session policy ceiling next to the product one',
      !!q('[data-testid="session-policy-per-tx"]')
      && /session policy/i.test(q('[data-testid="session-policy-per-tx"]').textContent || ''));

    await act(async () => { setInputValue(amountInput, '500'); });
    await act(async () => { await sleep(10); });
    t('a $500 edit is named as a session-policy breach, not as an unavailable venue',
      !!q('[data-testid="session-policy-violation"]')
      && /session policy limit of \$200/i.test(q('[data-testid="session-policy-violation"]').textContent || '')
      && !/no live venue/i.test(q('[data-testid="session-policy-violation"]').textContent || ''));
    t('the session-policy breach locks the final confirm',
      q('[data-testid="final-confirm-button"]').disabled === true);

    // Back within limits → confirm executes for real.
    await act(async () => { setInputValue(amountInput, '100'); });
    await act(async () => { await sleep(10); });
    t('a compliant edit re-enables the final confirm',
      q('[data-testid="final-confirm-button"]').disabled === false);

    await act(async () => { q('[data-testid="final-confirm-button"]').click(); });
    await act(async () => { await sleep(40); });
    t('final confirm executes through executeConfirmed and shows the honest receipt',
      /Submitted — awaiting confirmation|Receipt/i.test(container.textContent || ''));
    t('the session-policy warning is gone once the value is back inside the policy',
      !q('[data-testid="session-policy-violation"]'));

    // REAUTHORIZE re-opens the gate (the previously dead button).
    const reauthBtn = qa('button').find((b) => /^REAUTHORIZE$/i.test((b.textContent || '').trim()));
    await act(async () => { reauthBtn?.click(); });
    await act(async () => { await sleep(20); });
    t('REAUTHORIZE re-opens the confirmation screen instead of dead-ending',
      !!q('[data-testid="interactive-confirmation-screen"]')
      && /reauthorization required/i.test(container.textContent || ''));

    /* ---------------- 6. timed goal → countdown ---------------- */
    await act(async () => { setInputValue(composerInput, 'goal 20% profit on 100 USDC to ETH on Arbitrum in 720 hours'); });
    await act(async () => { q('.ia-composer .ia-send').click(); });
    await act(async () => { await sleep(40); });
    t('a timed goal renders the live countdown component',
      !!q('[data-testid="goal-countdown"]')
      && /Goal countdown/i.test(q('[data-testid="goal-countdown"]').textContent || ''));

    t('the panel produced no unexpected console errors', errors.length === 0);

    await act(async () => { root.unmount(); });
  } finally {
    console.error = realError;
    globalThis.fetch = realFetch;
    container.innerHTML = '';
  }

  return out;
}
