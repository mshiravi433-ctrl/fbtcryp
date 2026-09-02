/**
 * INTENT OS WIRING — the Loan hand-off, the compile gate and every tab.
 * ---------------------------------------------------------------------------
 * Reported (fa): «وقتی از صفحه وام میایی و میخایی کامپیل کنی میزنه طرح اجرای
 * کامپایل‌شده — توکن ورودی و خروجی باید متفاوت باشند» and «خیلی تب هاش درست
 * نیست، سیم کشی درستی ندارد».
 *
 * So this mounts the REAL /intent page inside the REAL router shape
 * (RouteBoundary keyed by pathname, exactly like AnimatedRoutes) and drives:
 *
 *   1. the Loan supply hand-off  (?hint=loan-supply)  → compile
 *   2. the Loan borrow hand-off  (?hint=loan-borrow)  → compile
 *   3. the wallet Optimize prefill (?from=&to=&chain=) → compile → the review
 *      gate → the swap screen
 *   4. every tab button — each must actually switch the visible surface
 *   5. URL-driven tab changes (the AI panel's #/intent?tab=… chips) — the tab
 *      must follow the URL even when the page does not remount
 *   6. the agents/strategies catalog tabs with a dead network — honest error
 *      state with a working Retry, never a crash
 *   7. the AI chat's draft hand-off button — it exists, and it routes the
 *      prepared draft to the right screen (swap pair / bridge / compose)
 *   8. the REAL Loan page (asset → amount → confirm sheet) driving the
 *      hand-off end to end
 *
 * The network is stubbed to FAIL on purpose, exactly like the panel probe: the
 * page must be fully usable with the server unreachable.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import IntentOS from '../src/pages/IntentOS.jsx';
import Loan from '../src/pages/Loan.jsx';
import IntentAIRoute, { draftHandoffRoute } from '../src/components/IntentAIRoute.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Drive a React-controlled input so onChange actually fires. */
const setInputValue = (input, value) => {
  const proto = input instanceof window.HTMLTextAreaElement
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

/** A click that behaves like a real user tap. */
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

/**
 * Follow a plain hash anchor the way a browser would. jsdom does not navigate
 * on <a href="#…"> clicks, so the chip's real-world effect — a hashchange the
 * router reacts to — is reproduced exactly.
 */
const followAnchor = (a) => {
  const href = a.getAttribute('href') || '';
  const hash = href.startsWith('#') ? href : `#${href}`;
  window.location.hash = hash;
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
};

/**
 * The same shape AnimatedRoutes uses: RouteBoundary keyed by PATHNAME only, so
 * a query-string change does NOT remount the page — exactly the condition the
 * AI panel's `#/intent?tab=…` anchors create when one Intent tab is open.
 */
function AppRoutes() {
  const location = useLocation();
  return (
    <Routes location={location} key={location.pathname}>
      <Route path="/intent" element={<IntentOS />} />
      <Route path="/loan" element={<Loan />} />
      <Route path="/intent-ai" element={<IntentAIRoute />} />
      <Route path="/swap" element={<div data-testid="swap-page-stub" />} />
      <Route path="*" element={<div data-testid="elsewhere" />} />
    </Routes>
  );
}

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
  // Dead network on purpose.
  globalThis.fetch = async () => { throw new Error('offline'); };

  const q = (sel) => container.querySelector(sel);
  const qa = (sel) => [...container.querySelectorAll(sel)];

  /** Which tab button is active right now. */
  const activeTab = () => q('.ios-tabs button.active')?.textContent?.trim();

  try {
    let root = null;
    const mountAt = async (hash) => {
      window.location.hash = hash;
      if (root) { await act(async () => { root.unmount(); }); }
      root = createRoot(container);
      await act(async () => {
        root.render(
          <HashRouter>
            <TelegramProvider>
              <WalletProvider>
                <AppRoutes />
              </WalletProvider>
            </TelegramProvider>
          </HashRouter>
        );
      });
      await act(async () => { await sleep(40); });
    };

    const compile = async () => {
      const btn = qa('button').find((b) => b.className.includes('ios-compile'));
      await act(async () => { click(btn); });
      await act(async () => { await sleep(20); });
    };

    /* ═══════════ 1. LOAN SUPPLY HAND-OFF → COMPILE ═══════════ */
    await mountAt('#/intent?tab=compose&hint=loan-supply&chain=42161&from=USDT&amount=1000');

    t('supply hand-off banner renders', !!q('[data-testid="loan-handoff"]'));
    t('supply draft is a workflow with steps', qa('.ios-workflow-step').length >= 2);
    t('supply draft amount carried over',
      q('[data-testid="loan-handoff"]')?.textContent?.includes('1000'));

    await compile();
    const supplyErr = q('.ios-result .notice-danger');
    t('supply compile does NOT fail with SAME_TOKEN',
      !(supplyErr && /different/i.test(supplyErr.textContent || '')));
    t('supply compile produces a plan (no error at all)', !supplyErr);
    if (supplyErr) console.log('   ↳ compile error was:', supplyErr.textContent.trim().slice(0, 120));
    t('supply compile passes the single-chain atomic check',
      qa('.ios-check').some((c) => c.className.includes('ios-pass') && /workflow/i.test(c.textContent)));

    /* ═══════════ 2. LOAN BORROW HAND-OFF → COMPILE ═══════════ */
    await mountAt('#/intent?tab=compose&hint=loan-borrow&chain=42161&from=USDT&amount=100&collateral=150');
    t('borrow hand-off banner renders', !!q('[data-testid="loan-handoff"]'));
    t('borrow draft is a workflow with deposit+borrow steps', qa('.ios-workflow-step').length >= 2);

    await compile();
    const borrowErr = q('.ios-result .notice-danger');
    t('borrow compile does NOT fail with SAME_TOKEN',
      !(borrowErr && /different/i.test(borrowErr.textContent || '')));
    t('borrow compile produces a plan (no error at all)', !borrowErr);
    if (borrowErr) console.log('   ↳ compile error was:', borrowErr.textContent.trim().slice(0, 120));

    /* ═══════════ 3. WALLET OPTIMIZE PREFILL → COMPILE → HAND-OFF ═══════════ */
    await mountAt('#/intent?from=ETH&to=USDT&chain=42161');
    t('plain prefill keeps a swap draft (no loan banner)', !q('[data-testid="loan-handoff"]'));
    await compile();
    const prefillErr = q('.ios-result .notice-danger');
    t('plain prefill compiles cleanly', !prefillErr);
    const handoffBtn = qa('button').find((b) => /user-signed review/i.test(b.textContent || ''));
    t('compiled swap offers the review hand-off', !!handoffBtn);
    if (handoffBtn) {
      await act(async () => { click(handoffBtn); });
      await act(async () => { await sleep(30); });
      t('the review action goes directly to the swap review without a redundant gate',
        !q('[role="dialog"]') && window.location.hash.startsWith('#/swap') && /from=ETH/.test(window.location.hash) && /to=USDT/.test(window.location.hash));
    }

    /* ═══════════ 4. EVERY TAB BUTTON ACTUALLY SWITCHES ═══════════ */
    await mountAt('#/intent');
    const tabNames = qa('.ios-tabs button').map((b) => b.textContent.trim());
    /*
     * Nine tabs. It used to be ten: the «Memory Wallet» tab was deleted, not
     * renamed — its two switches set limits the Smart Wallet policy owns
     * (one of them, quiet hours, nothing ever read), and the rules now live in
     * one place. This assertion is the guard that the tab stays gone.
     */
    t('all nine tabs are rendered', tabNames.length === 9);
    t('the memory tab is gone for good', !/memory/i.test(tabNames.join(' ')));
    t('no tab advertises the deleted memory surface', !q('.ios-memory-hero'));

    for (const btn of qa('.ios-tabs button')) {
      const name = btn.textContent.trim();
      await act(async () => { click(btn); });
      await act(async () => { await sleep(10); });
      t(`tab “${name}” becomes active`, activeTab() === name);
    }
    // After cycling we are on the last tab (brain); hop back to network
    // (index 7 — TABS order is fixed) and assert its protocol sections render.
    await act(async () => { click(qa('.ios-tabs button')[7]); });
    await act(async () => { await sleep(20); });
    t('network tab renders its protocol sections', qa('.ios-auction-status').length >= 3);
    // Each tab's real surface is present (not a blank panel). TABS order ==
    // button order in the tab bar.
    const contentMarkers = [
      ['compose', '.ios-template-grid'],
      ['plan', '.pp-card, .ios-content section'],
      ['crosschain', '.icc-desk, .ios-content section'],
      ['proofs', '.ios-proof-intro'],
      ['history', '[data-testid="intent-tx-history"]'],
      ['agents', '.ios-network-hero'],
      ['strategies', '.ios-network-hero'],
      ['network', '.ios-auction-status'],
      ['brain', '[data-testid="central-brain-panel"]']
    ];
    const tabButtons = qa('.ios-tabs button');
    for (let i = 0; i < contentMarkers.length; i += 1) {
      const [name, marker] = contentMarkers[i];
      await act(async () => { click(tabButtons[i]); });
      await act(async () => { await sleep(20); });
      const found = q(marker);
      t(`tab “${name}” renders its real surface (${marker})`, Boolean(found));
    }

    /* ═══════════ 4b. THE TWO COLLAPSIBLE BOXES ═══════════ */
    /*
     * Reported (fa): «برنامه سودِ صرافی‌ها یک خط ساده‌ست» and the same about
     * «پروتکل‌های تسویه پیشرفته». Both are real panels, so the fix is a box
     * that looks like one — and this is the test that they are still the same
     * live components inside it, not a decorative shell.
     */
    await act(async () => {
      window.location.hash = '#/intent?tab=plan';
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    });
    await act(async () => { await sleep(30); });
    const venueBox = q('[data-testid="venue-plan-box"]');
    t('the venue plan is a disclosure card, not a bare line',
      !!venueBox && venueBox.tagName === 'DETAILS' && /fbt-disclosure/.test(venueBox.className));
    t('the venue box explains what is inside before it is opened',
      /read-only|never executes/i.test(venueBox.querySelector('.fbt-disclosure-sub')?.textContent || ''));
    t('the venue box starts closed', Boolean(venueBox) && venueBox.open === false);
    if (venueBox) {
      await act(async () => { click(venueBox.querySelector('summary')); });
      await act(async () => { await sleep(20); });
      t('opening the venue box reveals the live venue planner',
        venueBox.open === true && !!q('[data-testid="intent-os-planner"]'));
      t('the venue planner is the same wired form (build button present)',
        !!q('[data-testid="profit-plan-build"]'));
    }

    await act(async () => {
      window.location.hash = '#/intent?tab=crosschain';
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    });
    await act(async () => { await sleep(40); });
    const advBox = q('[data-testid="cross-chain-advanced"]');
    t('advanced settlement is a collapsible box on the cross-chain desk',
      !!advBox && advBox.tagName === 'DETAILS' && /fbt-disclosure/.test(advBox.className));
    t('the closed box already states how many settlement modes are ready',
      /\d of 2 modes ready/.test(advBox?.querySelector('.fbt-disclosure-badge')?.textContent || ''));
    if (advBox) {
      await act(async () => { click(advBox.querySelector('summary')); });
      await act(async () => { await sleep(20); });
      const fields = advBox.querySelectorAll('select, input').length;
      t('opening it exposes the working sequential planner (six controls)',
        advBox.open === true && fields >= 6);
      t('the box carries a real availability chip, not a promise',
        /sequential settlement|htlc/i.test(advBox.textContent || ''));
    }

    /* ═══════════ 5. URL-DRIVEN TAB CHANGES WITHOUT REMOUNT ═══════════ */
    /*
     * The AI panel's stage chips are plain anchors (#/intent?tab=…). If the
     * user is ALREADY on /intent (another tab), clicking one changes only the
     * query — pathname stays /intent, so the page does not remount. The tab
     * must still follow the URL, or the chip "does nothing".
     */
    await mountAt('#/intent');
    await act(async () => { click(qa('.ios-tabs button').find((b) => b.textContent.trim() === 'proofs' || /proof/i.test(b.textContent))); });
    await act(async () => { await sleep(10); });
    t('tab button click is reflected in the URL', window.location.hash.includes('tab=proofs'));

    // Simulate the anchor: same pathname, different query.
    await act(async () => {
      window.location.hash = '#/intent?tab=strategies';
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    });
    await act(async () => { await sleep(30); });
    t('URL change to ?tab=strategies switches the visible tab',
      q('.ios-content')?.textContent && /strateg/i.test(q('.ios-content h2')?.textContent || '') || /strateg/i.test(q('.ios-content')?.textContent || ''));

    await act(async () => {
      window.location.hash = '#/intent?tab=agents';
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    });
    await act(async () => { await sleep(30); });
    const agentsContent = q('.ios-content')?.textContent || '';
    t('URL change to ?tab=agents switches the visible tab', /agent/i.test(agentsContent) && !/strateg/i.test(q('.ios-content h2')?.textContent || ''));

    /* ═══════════ 6. CATALOG TABS WITH A DEAD NETWORK ═══════════ */
    await act(async () => {
      window.location.hash = '#/intent?tab=agents';
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    });
    await act(async () => { await sleep(120); });
    const agentsTab = q('.ios-content');
    if (!/retry|error|unavailable|loading/i.test(agentsTab?.textContent || '')) {
      console.log('   ↳ agents tab content:', (agentsTab?.textContent || '').slice(0, 300));
    }
    t('agents tab shows the honest error state (not a crash)',
      !!agentsTab && /unreachable|try again|could not be loaded|unavailable|loading/i.test(agentsTab.textContent || ''));
    const retryBtn = qa('button').find((b) => /try again/i.test(b.textContent || ''));
    t('agents tab offers a Retry button', !!retryBtn);
    if (retryBtn) {
      await act(async () => { click(retryBtn); });
      await act(async () => { await sleep(120); });
      t('Retry re-issues the catalog request without crashing', !!q('.ios-content'));
    }

    /* ═══════════ 7. THE COMPILED WORKFLOW HAND-OFF IS NOT A DEAD END ═══════════ */
    await mountAt('#/intent?tab=compose&hint=loan-supply&chain=42161&from=USDT&amount=1000');
    await compile();
    const result = q('.ios-result');
    t('loan workflow compile result renders', !!result);
    const status = qa('.ios-result .ios-status').map((s) => s.textContent.trim()).join(' ');
    t('loan workflow gets an explicit status line', status.length > 0);
    console.log('   ↳ status:', status, '| checks:', qa('.ios-check').length);
    t('the compiled plan spells out its steps for review', qa('[data-testid="compiled-steps"] .ios-result-step').length >= 2);
    const strayHandoff = qa('button').filter((b) => /user-signed review/i.test(b.textContent || ''));
    if (strayHandoff.length) console.log('   ↳ stray hand-off buttons:', strayHandoff.map((b) => b.textContent.trim()));
    t('a same-token lending workflow never offers the /swap review hand-off',
      strayHandoff.length === 0);

    /* ═══════════ 7b. THE COMPILED WORKFLOW STEP ACTIONS ARE NOT DEAD ═══════════ */
    /* Reported (fa): «دکمهٔ مجوز یا سپرده و بقیهٔ دکمهها کار نمیده». The step
       buttons used to navigate back to /intent?tab=compose — the page that was
       already open, with query params nothing consumes — so the pathname never
       changed and every button looked dead. Each action must now land on the
       screen where that step really runs, carrying the intent id. */

    await mountAt('#/intent?tab=compose&hint=loan-supply&chain=42161&from=USDT&amount=1000');
    await compile();
    const approveBtn = q('[data-testid="workflow-step-action-approve"]');
    t('the approve step renders its own action button', !!approveBtn);
    if (approveBtn) {
      await act(async () => { click(approveBtn); });
      await act(async () => { await sleep(40); });
      t('approve hands off to the loan supply tab (a real screen change)',
        window.location.hash.startsWith('#/loan')
        && /tab=supply/.test(window.location.hash)
        && /intent=/.test(window.location.hash));
    }

    await mountAt('#/intent?tab=compose&hint=loan-supply&chain=42161&from=USDT&amount=1000');
    await compile();
    const depositBtn = q('[data-testid="workflow-step-action-deposit"]');
    t('the deposit step renders its own action button', !!depositBtn);
    if (depositBtn) {
      await act(async () => { click(depositBtn); });
      await act(async () => { await sleep(40); });
      t('deposit hands off to the loan supply tab', window.location.hash.startsWith('#/loan') && /tab=supply/.test(window.location.hash));
    }

    await mountAt('#/intent?tab=compose&hint=loan-borrow&chain=42161&from=USDT&amount=100&collateral=150');
    await compile();
    const borrowBtn = q('[data-testid="workflow-step-action-borrow"]');
    t('the borrow step renders its own action button', !!borrowBtn);
    if (borrowBtn) {
      await act(async () => { click(borrowBtn); });
      await act(async () => { await sleep(40); });
      t('borrow hands off to the loan borrow tab', window.location.hash.startsWith('#/loan') && /tab=borrow/.test(window.location.hash));
    }

    /* The default same-chain workflow template: swap → deposit. The swap step
       must land on /swap with the REAL pair, not loop back to compose. */
    await mountAt('#/intent?tab=compose');
    const workflowTemplate = q('[data-testid="intent-template-workflow"]');
    t('the workflow template selector renders', !!workflowTemplate);
    if (workflowTemplate) {
      await act(async () => { click(workflowTemplate); });
      await act(async () => { await sleep(30); });
      await compile();
      const swapBtn = q('[data-testid="workflow-step-action-swap"]');
      t('the workflow swap step renders its own action button', !!swapBtn);
      if (swapBtn) {
        await act(async () => { click(swapBtn); });
        await act(async () => { await sleep(40); });
        t('the workflow swap step lands on /swap with the draft pair',
          window.location.hash.startsWith('#/swap')
          && /from=USDC/.test(window.location.hash) && /to=ETH/.test(window.location.hash));
      }
    }

    /* The Loan page must honour the hand-off's ?tab= deep link. */
    await mountAt('#/loan?tab=borrow');
    t('the loan page opens its borrow tab from ?tab=borrow',
      q('[data-testid="loan-tab-borrow"]')?.getAttribute('data-active') === 'true');
    await mountAt('#/loan');
    t('the loan page defaults to supply without a tab param',
      q('[data-testid="loan-tab-supply"]')?.getAttribute('data-active') === 'true');

    /* ═══════════ 8. AI CHAT DRAFT → REAL SCREEN (the dead hand-off button) ═══════════ */
    await mountAt('#/intent-ai');
    const composer = q('.ia-composer input');
    t('the AI panel mounts at /intent-ai', !!composer);
    await act(async () => { await sleep(150); });
    /* Level 3 unlocks financial execution; the panel probe proved L3 works. */
    const l3chip = q('[data-testid="intent-ai-level-3"]');
    await act(async () => { if (l3chip) click(l3chip); });
    await act(async () => { await sleep(30); });
    const confirmPolicy = qa('button').find((b) => /CONFIRM & START/i.test(b.textContent || ''));
    await act(async () => { if (confirmPolicy) click(confirmPolicy); });
    await act(async () => { await sleep(30); });
    await act(async () => { setInputValue(composer, 'swap 100 USDC to ETH on Arbitrum'); });
    await act(async () => { click(q('.ia-composer .ia-send')); });
    await act(async () => { await sleep(80); });
    const handOffBtn = qa('button').find((b) => /open in swap screen/i.test(b.textContent || ''));
    if (!handOffBtn) console.log('   ↳ chat tail:', (q('.intent-ai-thread')?.textContent || '').slice(-300));
    t('a prepared plan offers the hand-off button (was never rendered before the wiring fix)', !!handOffBtn);
    if (handOffBtn) {
      await act(async () => { click(handOffBtn); });
      await act(async () => { await sleep(40); });
      t('the hand-off lands on the swap screen with the draft pair',
        window.location.hash.startsWith('#/swap')
        && /from=USDC/.test(window.location.hash) && /to=ETH/.test(window.location.hash));
    }

    /* ═══════════ 8b. /intent FOLLOWS A QUERY-ONLY TAB CHANGE (the Telegram report) ═══════════ */
    /*
     * The AI panel's pipeline stage chips (intent · verification · cross-chain)
     * were removed on the owner's request — everything they pointed at is one
     * sentence in the composer, and the rail pushed the conversation below the
     * fold. The bug they once exposed must still never come back: /intent is
     * already mounted, only the ?tab= query changes, and the page used to
     * ignore it completely. That is now driven straight through the hash,
     * which is what EVERY caller does — a shared link, chat navigation, the
     * browser back button — rather than through one particular row of chips.
     */
    await mountAt('#/intent-ai');
    t('the AI panel no longer renders the pipeline stage rail',
      qa('a.ia-stage-chip').length === 0 && !q('.ia-stage-row'));
    t('the AI panel no longer renders the quick-action chip row',
      qa('.ia-quick-chip').length === 0 && !q('.ia-quick-row'));

    /*
     * What replaced them must actually work: the section links are the row the
     * owner kept, so one of them is followed here the way a browser would.
     */
    const loanLink = qa('a.ia-section-chip').find((a) => (a.getAttribute('href') || '') === '#/loan');
    t('the AI panel still links out to the real product screens', !!loanLink);
    if (loanLink) {
      await act(async () => { followAnchor(loanLink); });
      await act(async () => { await sleep(60); });
      t('following a section link leaves the panel for that screen',
        window.location.hash.startsWith('#/loan'));
    }

    const activeTabLabel = () => (q('.ios-tabs button.active')?.textContent || '').trim();
    await mountAt('#/intent?tab=proofs');
    const proofsLabel = activeTabLabel();
    t('/intent opens on the tab named in the query',
      window.location.hash.includes('tab=proofs')
      && q('.ios-content') !== null
      && proofsLabel.length > 0
      && q('.ios-tabs button.active')?.getAttribute('aria-selected') === 'true');

    /* Query-only change on the ALREADY-MOUNTED page — the reported failure. */
    await act(async () => {
      window.location.hash = '#/intent?tab=crosschain';
      window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    });
    await act(async () => { await sleep(120); });
    t('a query-only change switches the already-open /intent tab',
      window.location.hash.includes('tab=crosschain')
      && q('.ios-content') !== null
      && activeTabLabel() !== proofsLabel);

    /* Pure routing rules for the draft hand-off. */
    t('draftHandoffRoute: swap draft → /swap pair', (() => {
      const r = draftHandoffRoute({ drafts: [{ order: { kind: 'swap', chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH', amountIn: 100 } }] });
      return typeof r === 'string' && r.startsWith('/swap?') && r.includes('from=USDC') && r.includes('to=ETH');
    })());
    t('draftHandoffRoute: same-token draft never goes to /swap', (() => {
      const r = draftHandoffRoute({ drafts: [{ order: { kind: 'swap', chainId: 42161, fromSymbol: 'USDT', toSymbol: 'USDT', amountIn: 100 } }] });
      return r === null || !r.startsWith('/swap');
    })());
    t('draftHandoffRoute: bridge draft keeps both chains from the plan', (() => {
      const r = draftHandoffRoute({
        plan: { steps: [{ action: 'bridge', fromChain: 1, toChain: 42161 }] },
        drafts: [{ order: { kind: 'bridge', chainId: 1, fromSymbol: 'USDT', amountIn: 50 } }]
      });
      return typeof r === 'string' && r.startsWith('/bridge?') && r.includes('fromChain=1') && r.includes('toChain=42161');
    })());

    /* ═══════════ 9. THE LOAN PAGE IS THE VENUE, NOT A DETOUR ═══════════ */
    /*
     * This used to assert the opposite: pick an asset, type an amount, confirm
     * — and land on /intent holding a draft. The owner's report was that the
     * deposit never happened, and it was right: Intent OS executes nothing, so
     * a supply that ended there ended nowhere.
     *
     * The loan screen now runs supply / borrow / repay / withdraw itself, and
     * the full signed path (approve → supply → receipt) is driven with a stub
     * wallet in test/loan-execution-probe.jsx. What belongs HERE is the part
     * this suite owns: the hand-off arrives prefilled, and the screen never
     * bounces the user back to Intent OS.
     */
    await mountAt('#/loan?tab=supply&asset=USDT&amount=250&chain=42161&intent=abc&step=step-2');
    await act(async () => { await sleep(120); });
    t('the Loan page renders its tabs', qa('button').filter((b) => /supply|deposit|lend/i.test(b.textContent || '')).length > 0);
    t('a workflow hand-off lands on the supply tab',
      q('[data-testid="loan-tab-supply"]')?.getAttribute('data-active') === 'true');
    const prefilled = q('input[type="number"]');
    t('the hand-off arrives prefilled — the amount is already in the field',
      !!prefilled && prefilled.value === '250');

    /* No wallet is connected in this suite, so the only honest primary action
       is the connect gate — never a navigation that pretends to deposit. */
    const gate = q('[data-testid="loan-connect"]');
    t('with no wallet the loan action is a connect gate', !!gate);
    await act(async () => { click(gate); });
    await act(async () => { await sleep(80); });
    t('pressing it stays on the loan screen (no Intent OS hand-off)',
      window.location.hash.startsWith('#/loan'));
    t('the loan screen offers no link back into Intent OS',
      qa('a').every((a) => !/#\/intent/.test(a.getAttribute('href') || '')));

    /* ═══════════ 10. A WORKFLOW REMEMBERS WHERE YOU LEFT IT ═══════════ */
    /*
     * Reported (fa): a step hands off to its venue, and when you come back and
     * press «ادامه/بازیابی» nothing records that the step is finished. The
     * progress panel is the answer, and its rules are honest ones: opening a
     * step is observed, finishing it is self-reported and undoable.
     */
    window.localStorage.removeItem('fbt.intent-os.workflow-progress.v1');
    await mountAt('#/intent?tab=compose&hint=loan-supply&chain=42161&from=USDT&amount=1000');
    await compile();
    t('the compiled workflow renders a progress panel', !!q('[data-testid="workflow-progress"]'));
    t('every step starts as not-started',
      qa('[data-testid^="workflow-progress-step-"]').length >= 2
      && qa('[data-testid^="workflow-progress-step-"]').every((el) => el.getAttribute('data-status') === 'pending'));

    const openDeposit = q('[data-testid="workflow-step-action-deposit"]');
    await act(async () => { click(openDeposit); });
    await act(async () => { await sleep(60); });
    t('opening a step still lands on its real venue', window.location.hash.startsWith('#/loan'));
    t('the deposit hand-off carries the amount, not just the tab',
      /amount=1000/.test(window.location.hash) && /asset=USDT/.test(window.location.hash));

    /* Back on Intent OS, the saved intent is restored — the step that was
       opened is recorded as finished and the rest are listed. */
    await mountAt('#/intent?tab=compose');
    const restoreBtn = qa('.ios-saved button').find((b) => !/×/.test(b.textContent || ''));
    t('the saved intent offers a restore/continue control', !!restoreBtn);
    if (restoreBtn) {
      await act(async () => { click(restoreBtn); });
      await act(async () => { await sleep(120); });
      t('restoring shows the workflow you came back to', !!q('[data-testid="restored-workflow"]'));
      t('restoring records the step you had opened as finished',
        q('[data-testid="workflow-progress-step-deposit"]')?.getAttribute('data-status') === 'done');
      t('it says so out loud instead of silently ticking a box',
        !!q('[data-testid="workflow-progress-confirmed"]'));
      t('the steps you never opened are still waiting',
        qa('[data-testid^="workflow-progress-step-"]').some((el) => el.getAttribute('data-status') !== 'done'));
      t('the count reflects what is done', /1/.test(q('[data-testid="workflow-progress-count"]')?.textContent || ''));

      const undo = q('[data-testid="workflow-progress-undo-deposit"]');
      t('a self-reported completion can be undone', !!undo);
      if (undo) {
        await act(async () => { click(undo); });
        await act(async () => { await sleep(60); });
        t('undo puts the step back',
          q('[data-testid="workflow-progress-step-deposit"]')?.getAttribute('data-status') !== 'done');
      }
    }

    /* ═══════════ 11. THE REMOVED CONTROL RAIL ═══════════ */
    await mountAt('#/intent?tab=compose');
    t('the L1/L2/L3 control rail is gone from Intent OS',
      !q('.intent-rail') && !q('[data-testid="intent-rail"]'));
    t('nothing blocks composing behind a rail state nobody can release',
      !q('.ios-rail-blocked'));

    if (root) await act(async () => { root.unmount(); });
  } catch (e) {
    out.push([`probe crashed: ${String(e?.message || e).slice(0, 200)}`, false]);
    console.error('CRASH', e);
  } finally {
    console.error = realError;
    globalThis.fetch = realFetch;
  }

  for (const e of errors.slice(0, 8)) out.push([`(detail) ${String(e).slice(0, 160)}`, false]);
  return out;
}
