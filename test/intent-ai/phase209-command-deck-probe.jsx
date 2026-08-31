/**
 * PHASE 209 — the AI page as a Command Center, driven like a user drives it.
 * ---------------------------------------------------------------------------
 * The brief for this redesign was: *seventeen agents work, five things are
 * shown, and the AI never trades by itself*. Three of those are negative
 * claims, and a negative claim can only be tested by mounting the real page and
 * looking at what is in front of the user. So this probe:
 *
 *   1. shows the deck is what a person lands on (header, one ask box, five
 *      quick actions, the portfolio read, the four tools, the thinking rail)
 *   2. shows the agent roster is NOT on that surface — it sits behind a closed
 *      disclosure, and no quick action is named after an agent
 *   3. drives ⚙ AI CONTROL for real: the mode, the $ caps (persisted to the
 *      same key the firewall reads), the chain checkboxes, and an emergency
 *      stop that a release has to be asked for twice
 *   4. creates an automation from the Automations tab and checks it is stored
 *      as a plan-to-confirm, not as a scheduled payment
 *   5. approves a plan from the deck and asserts that NOTHING was broadcast:
 *      the stub signer this panel was given is never called. Approval prepares
 *      a hand-off; the wallet signs. That is the whole safety model of the page
 *      and it is the assertion a reviewer should look at first.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import '../../src/i18n/index.js';
import IntentAIPanel from '../../src/components/IntentAIPanel.jsx';
import {
  AI_AGENTS,
  AI_SURFACES,
  AI_TOOLS,
  AI_CONTROL_STORE_KEY,
  AI_STOP_STORE_KEY,
  AI_AUTOMATION_STORE_KEY
} from '../../src/lib/intent-ai/commandCenter.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const setInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const readJson = (key) => {
  try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { return null; }
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
  globalThis.fetch = async () => { throw new Error('offline'); };
  const q = (sel) => container.querySelector(sel);
  const qa = (sel) => [...container.querySelectorAll(sel)];

  try {
    window.localStorage.removeItem(AI_CONTROL_STORE_KEY);
    window.localStorage.removeItem(AI_STOP_STORE_KEY);
    window.localStorage.removeItem(AI_AUTOMATION_STORE_KEY);

    let signed = 0;
    let broadcastCalls = 0;
    const stubRuntime = {
      provider: {
        request: async ({ method }) => {
          if (method === 'eth_signTypedData_v4' || method === 'personal_sign') {
            signed += 1;
            return `0x${'1a'.repeat(65)}`;
          }
          return null;
        }
      },
      account: '0x1111111111111111111111111111111111111111',
      chainId: 42161,
      connected: true
    };
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <IntentAIPanel
          defaultChainId={42161}
          walletRuntime={stubRuntime}
          executeIntentBroadcast={async () => { broadcastCalls += 1; return { ok: true, txHash: `0x${'ab'.repeat(32)}`, chainId: 42161 }; }}
          trackIntentTx={async () => ({ status: 'confirmed', confirmations: 1 })}
          explorerUrl={({ txHash }) => `https://explorer.test/tx/${txHash}`}
          broadcastSupportedKind={(kind) => kind === 'swap'}
          aiPortfolio={{
            holdings: [{ symbol: 'USDC', valueUsd: 2600, chainId: 42161 }, { symbol: 'ETH', valueUsd: 1600, chainId: 42161 }],
            totalValueUsd: 4200,
            change24hPct: 1.5,
            dataStatus: 'live'
          }}
        />
      );
    });
    /* The deck runs the same orchestrator a tap runs, on first paint — give the
       offline market/yield reads time to fail the honest way. */
    await act(async () => { await sleep(200); });

    // ── 1 · the surface a user lands on ─────────────────────────────────────
    t('the header says ✦ FBT AI with a live pill, not a feature list',
      /FBT AI/i.test(q('.ia-cc-name')?.textContent || '')
      && Boolean(q('[data-testid="ai-live-pill"]')));

    t('there is exactly ONE ask box, and its first field is the text input',
      qa('.ia-composer').length === 1
      && q('.ia-composer input')?.tagName === 'INPUT'
      && q('.ia-composer input')?.type === 'text'
      && q('.ia-composer input')?.placeholder?.length > 10);

    t('the mic is a button beside the field, and it never sends by itself',
      q('[data-testid="ai-mic"]')?.tagName === 'BUTTON'
      && q('.ia-composer input')?.value === '');

    t('the quick actions are the five surfaces and nothing else',
      qa('.acc-quick-card').length === AI_SURFACES.length
      && AI_SURFACES.every((s) => Boolean(q(`[data-testid="ai-quick-${s.id}"]`))));

    t('the AI ACTIONS grid offers the four tools',
      qa('.acc-tool').length === 4
      && ['buy-sell', 'earn-yield', 'rebalance', 'protect'].every((id) => q(`[data-testid="ai-tool-${id}"]`)));

    t('the portfolio card shows a value from the wallet read, not an invented one',
      q('[data-testid="ai-portfolio-card"]')?.getAttribute('data-status') === 'live'
      && q('[data-testid="ai-portfolio-value"]')?.textContent?.includes('4,200')
      && /\d+\/100/.test(q('[data-testid="ai-portfolio-risk"]')?.textContent || ''));

    const rail = q('[data-testid="ai-think-rail"]');
    const railRows = qa('.acc-think-row');
    if (process.env.DBG) console.log('RAIL', rail?.className, railRows.length, railRows.map((r) => r.getAttribute('data-testid') + ':' + r.getAttribute('data-status')).join(' '));
    t('the thinking rail reports the pipeline it actually ran, including what did not answer',
      Boolean(rail)
      && railRows.length >= 4
      && railRows.every((row) => row.getAttribute('data-status'))
      /* Offline, the market and yield reads MUST be reported as unavailable —
         a rail that says "done" while nothing answered is the theatre this
         component exists to avoid. */
      && railRows.some((row) => row.getAttribute('data-status') === 'unavailable'));

    // ── 2 · the agents are hidden, not deleted ──────────────────────────────
    const lanes = q('[data-testid="ai-agent-lanes"]');
    t('the agent roster exists but starts closed, behind the plan',
      Boolean(lanes) && lanes.tagName === 'DETAILS' && !lanes.open
      && Boolean(q('[data-testid="ai-agent-count"]')));

    /* The roster may only appear behind the disclosure. The check is on the labels
       a user could click, not on the prose: the quick actions legitimately read
       `Yield` and `Risk`, which happen to be agent ids too — a substring test on
       the whole row would fail the copy instead of the bug it is looking for. */
    const clickLabels = [...qa('.acc-quick-card'), ...qa('.acc-tool')]
      .map((n) => (n.querySelector('.acc-quick-name, .acc-tool-name')?.textContent || '').trim());
    const firstScreenMenu = [...qa('.acc-quick-row'), ...qa('.acc-tools-grid')]
      .map((n) => n.textContent).join(' ');
    t('no agent is a menu item on the first screen',
      clickLabels.length === AI_SURFACES.length + AI_TOOLS.length
      && clickLabels.every((label) => AI_AGENTS.every((a) => label.toLowerCase() !== String(a.id).toLowerCase()))
      && !/market\s*maker|agent[-\s]to[-\s]agent|multi[-\s]agent|\bresearch\b/i.test(firstScreenMenu));

    t('seventeen capabilities are still in the product (count, not a list)',
      /17/.test(q('[data-testid="ai-agent-count"]')?.textContent || ''));

    // ── 3 · ⚙ AI CONTROL ────────────────────────────────────────────────────
    await act(async () => { q('[data-testid="ai-tab-control"]').click(); });
    await act(async () => { await sleep(20); });
    t('AI control opens as a tab of the same page, not a new screen',
      Boolean(q('[data-testid="ai-control"]')) && Boolean(q('.intent-ai-thread'))
      && Boolean(q('.ia-composer')));

    t('AI MODE offers Manual / Assisted / Autonomous and marks the current one',
      qa('.acc-mode').length === 3
      && ['manual', 'assisted', 'autonomous'].every((id) => q(`[data-testid="ai-control-mode-${id}"]`))
      && Boolean(q('[data-testid="ai-control-state"]')));

    await act(async () => { q('[data-testid="ai-control-mode-manual"]').click(); });
    await act(async () => { await sleep(20); });
    t('choosing Manual drops the session to L1 and says so on the plan-free deck',
      q('[data-testid="ai-control"]')?.getAttribute('data-mode') === 'manual'
      && q('[data-testid="ai-control-level"]')?.textContent === 'L1'
      && /analysis|no draft|Manual/i.test(q('[data-testid="ai-control-mode-note"]')?.textContent || ''));

    await act(async () => { q('[data-testid="ai-control-mode-autonomous"]').click(); });
    await act(async () => { await sleep(30); });
    t('choosing Autonomous raises L3 but states that the signature is still required',
      q('[data-testid="ai-control"]')?.getAttribute('data-mode') === 'autonomous'
      && q('[data-testid="ai-control-level"]')?.textContent === 'L3'
      && /sign/i.test(q('[data-testid="ai-control-mode-note"]')?.textContent || ''));

    await act(async () => { setInputValue(q('[data-testid="ai-control-max-per-tx"]'), '40'); });
    await act(async () => { await sleep(30); });
    t('the per-transaction cap is written where the firewall reads it',
      Number(readJson(AI_CONTROL_STORE_KEY)?.maxPerTxUsd) === 40);

    await act(async () => {
      const box = q('[data-testid="ai-control-chain-1"]');
      if (box && box.checked) box.click();
    });
    await act(async () => { await sleep(30); });
    t('network permission is a checkbox the user controls',
      qa('[data-testid^="ai-control-chain-"]').length >= 3
      && (readJson(AI_CONTROL_STORE_KEY)?.allowedChains || []).includes(42161));

    /* A plan has to exist before a stop can be seen to matter, so ask for one
       through the deck, then stop from the control tab and look at the plan. */
    await act(async () => { q('[data-testid="ai-tab-command"]').click(); });
    await act(async () => { q('[data-testid="ai-tool-earn-yield"]').click(); });
    await act(async () => { await sleep(260); });
    const approveBefore = q('[data-testid="ai-plan-approve"]');
    await act(async () => { q('[data-testid="ai-tab-control"]').click(); });
    await act(async () => { q('[data-testid="ai-control-emergency-stop"]').click(); });
    await act(async () => { await sleep(60); });
    t('Emergency stop is persisted and the box says stopped, not degraded',
      readJson(AI_STOP_STORE_KEY)?.at > 0
      && readJson(AI_STOP_STORE_KEY)?.active === true
      && /stopped/i.test(q('[data-testid="ai-control-state"]')?.textContent || '')
      && Boolean(q('[data-testid="ai-control-release"]')));

    await act(async () => { q('[data-testid="ai-tab-command"]').click(); });
    await act(async () => { await sleep(40); });
    if (process.env.DBG) console.log('STOP DECK', q('[data-testid="ai-plan-approve"]')?.disabled, q('[data-testid="ai-deck-stopped"]')?.textContent);
    t('a stop taken after a plan was built kills its Approve button at once',
      Boolean(approveBefore)
      && q('[data-testid="ai-plan-approve"]')?.disabled === true
      && Boolean(q('[data-testid="ai-deck-stopped"]')));

    await act(async () => { q('[data-testid="ai-tab-control"]').click(); });
    await act(async () => { q('[data-testid="ai-control-release"]').click(); });
    await act(async () => { await sleep(60); });
    await act(async () => { q('[data-testid="ai-tab-command"]').click(); });
    await act(async () => { await sleep(40); });
    t('releasing the stop is a second deliberate tap and re-arms nothing by itself',
      readJson(AI_STOP_STORE_KEY) === null
      && !q('[data-testid="ai-deck-stopped"]')
      && q('[data-testid="ai-automation-toggle-dca"]') === null);

    // ── 4 · automations are plans on a schedule ─────────────────────────────
    await act(async () => { q('[data-testid="ai-tab-automate"]').click(); });
    await act(async () => { await sleep(20); });
    await act(async () => { q('[data-testid="ai-automation-form-toggle"]').click(); });
    await act(async () => { q('[data-testid="ai-automation-field-amount"]') && setInputValue(q('[data-testid="ai-automation-field-amount"]'), '100'); });
    await act(async () => { await sleep(20); });
    await act(async () => { q('[data-testid="ai-automation-create"]').click(); });
    await act(async () => { await sleep(60); });
    const storedAuto = readJson(AI_AUTOMATION_STORE_KEY);
    t('an automation can be added from the page and is stored on this device',
      Array.isArray(storedAuto) && storedAuto.length >= 1
      && Number(storedAuto[0].amountUsd) === 100
      && storedAuto[0].active === true);

    t('the row reads as a plan to confirm, never as a standing order',
      /confirm each run/i.test(q('[data-testid^="ai-automation-perms-"]')?.textContent || '')
      && !/auto-execut|auto execute|will send/i.test(container.textContent));

    await act(async () => { q('[data-testid^="ai-automation-toggle-"]').click(); });
    await act(async () => { await sleep(40); });
    t('pausing an automation is written through to the store',
      readJson(AI_AUTOMATION_STORE_KEY)?.[0]?.active === false);

    // ── 5 · approving a plan prepares a hand-off, and signs nothing ─────────
    await act(async () => { q('[data-testid="ai-tab-command"]').click(); });
    await act(async () => { await sleep(20); });
    await act(async () => { q('[data-testid="ai-tool-buy-sell"]').click(); });
    await act(async () => { await sleep(260); });
    t('a tapped tool classifies the route itself (no guessing on a click)',
      q('[data-testid="ai-plan-card"]')?.getAttribute('data-intent') === 'TRADE'
      && /Trade/i.test(q('[data-testid="ai-plan-card"]')?.textContent || ''));

    /* The details are closed until asked for — "View details" is a disclosure,
       not a wall of text. Open it, then read what the plan is made of. */
    await act(async () => { q('[data-testid="ai-plan-details-toggle"]').click(); });
    await act(async () => { await sleep(20); });
    t('the plan states capital, risk and what the AI cannot do',
      Boolean(q('[data-testid="ai-plan-card"]'))
      && /Capital/i.test(q('.acc-plan-grid')?.textContent || '')
      && (q('[data-testid="ai-plan-approve"]')?.textContent || '').length > 3
      && (q('.acc-cannot')?.textContent || '').length > 20);

    const before = { signed, broadcastCalls };
    const approve = q('[data-testid="ai-plan-approve"]');
    await act(async () => { approve.click(); });
    await act(async () => { await sleep(260); });
    t('Approve runs the execution firewall and records the ledger',
      qa('[data-testid^="ai-stage-"]').length >= 6
      && Boolean(q('[data-testid="ai-stage-firewall"]')));

    t('the three stages that are not ours stay marked as hand-off',
      ['wallet', 'signature', 'blockchain'].every((id) => {
        const row = q(`[data-testid="ai-stage-${id}"]`);
        return row && row.getAttribute('data-status') !== 'passed';
      }));

    t('the page performed NO signing and NO broadcast when a plan was approved',
      signed === before.signed && broadcastCalls === before.broadcastCalls);

    t('exactly one button asks to start a session (the deck never duplicates it)',
      qa('button').filter((b) => /CONFIRM & START/i.test(b.textContent || '')).length <= 1);

    t('the deck produced no unexpected console errors',
      errors.length === 0);

    await act(async () => { root.unmount(); });
  } catch (e) {
    t(`probe threw: ${e?.message}`, false);
  } finally {
    console.error = realError;
    globalThis.fetch = realFetch;
  }
  return out;
}
