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
      await act(async () => { await sleep(20); });
      const gate = q('[role="dialog"]');
      t('the review gate opens with the pair summary', !!gate && /ETH/.test(gate.textContent || '') && /USDT/.test(gate.textContent || ''));
      const goBtn = gate && [...gate.querySelectorAll('button')].find((b) => /wallet/i.test(b.textContent || ''));
      await act(async () => { if (goBtn) click(goBtn); });
      await act(async () => { await sleep(30); });
      t('confirming the gate navigates to the swap screen with the pair',
        window.location.hash.startsWith('#/swap') && /from=ETH/.test(window.location.hash) && /to=USDT/.test(window.location.hash));
    }

    /* ═══════════ 4. EVERY TAB BUTTON ACTUALLY SWITCHES ═══════════ */
    await mountAt('#/intent');
    const tabNames = qa('.ios-tabs button').map((b) => b.textContent.trim());
    t('all nine tabs are rendered', tabNames.length === 9);

    for (const btn of qa('.ios-tabs button')) {
      const name = btn.textContent.trim();
      await act(async () => { click(btn); });
      await act(async () => { await sleep(10); });
      t(`tab “${name}” becomes active`, activeTab() === name);
    }
    // After cycling we should be on the last tab (network) with real content.
    t('network tab renders its protocol sections', qa('.ios-auction-status').length >= 3);
    // Each tab's real surface is present (not a blank panel). TABS order ==
    // button order in the tab bar.
    const contentMarkers = [
      ['compose', '.ios-template-grid'],
      ['plan', '.pp-card, .ios-content section'],
      ['crosschain', '.icc-desk, .ios-content section'],
      ['memory', '.ios-memory-hero'],
      ['proofs', '.ios-proof-intro'],
      ['history', '[data-testid="intent-tx-history"]'],
      ['agents', '.ios-network-hero'],
      ['strategies', '.ios-network-hero'],
      ['network', '.ios-auction-status']
    ];
    const tabButtons = qa('.ios-tabs button');
    for (let i = 0; i < contentMarkers.length; i += 1) {
      const [name, marker] = contentMarkers[i];
      await act(async () => { click(tabButtons[i]); });
      await act(async () => { await sleep(20); });
      const found = q(marker);
      t(`tab “${name}” renders its real surface (${marker})`, Boolean(found));
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

    /* ═══════════ 8b. AI PANEL STAGE CHIPS → INTENT TABS (the Telegram report) ═══════════ */
    /*
     * The panel's pipeline chips are plain anchors to #/intent?tab=…. From
     * /intent-ai they mount the page fresh; the previously broken case was the
     * one a Telegram user hits — following one chip, coming back, following
     * another: /intent is already mounted, only the query changes, and the tab
     * used to ignore it completely.
     */
    await mountAt('#/intent-ai');
    const chip = qa('a.ia-stage-chip').find((a) => /intent\?tab=/.test(a.getAttribute('href') || ''));
    t('the AI panel exposes stage chips into Intent OS tabs', !!chip);
    if (chip) {
      await act(async () => { followAnchor(chip); });
      await act(async () => { await sleep(40); });
      const chipTab = (chip.getAttribute('href').match(/tab=([a-z]+)/) || [])[1];
      t('following a stage chip opens /intent on that tab', window.location.hash.includes(`tab=${chipTab}`));
      /* Back to the panel, follow a DIFFERENT chip — the query-only change. */
      await act(async () => { window.location.hash = '#/intent-ai'; window.dispatchEvent(new window.HashChangeEvent('hashchange')); });
      await act(async () => { await sleep(120); });
      const other = qa('a.ia-stage-chip').find((a) => {
        const m = (a.getAttribute('href') || '').match(/tab=([a-z]+)/);
        return m && m[1] !== chipTab;
      });
      if (other) {
        await act(async () => { followAnchor(other); });
        await act(async () => { await sleep(40); });
        const otherTab = (other.getAttribute('href').match(/tab=([a-z]+)/) || [])[1];
        t('following a second chip switches the already-open /intent tab',
          window.location.hash.includes(`tab=${otherTab}`) && q('.ios-content') !== null);
      } else {
        t('a second chip with a different tab exists to follow', false);
      }
    }

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

    /* ═══════════ 9. THE REAL LOAN PAGE DRIVES THE HAND-OFF ═══════════ */
    /*
     * Not a synthetic URL: pick an asset, type an amount, confirm the sheet —
     * exactly the path a user takes — and expect to land on /intent with a
     * compilable lending draft.
     */
    await mountAt('#/loan');
    t('the Loan page renders its tabs', qa('button').filter((b) => /supply|deposit|lend/i.test(b.textContent || '')).length > 0);
    const assetCard = qa('button').find((b) => /USDT/i.test(b.textContent || ''));
    await act(async () => { click(assetCard); });
    await act(async () => { await sleep(30); });
    const amountField = qa('input[type="number"]').find((i) => i.offsetParent !== null || true);
    await act(async () => { setInputValue(amountField, '250'); });
    const supplyBtn = qa('button').find((b) => (b.className || '').includes('btn-primary') && /supply|deposit/i.test(b.textContent || ''));
    await act(async () => { click(supplyBtn); });
    await act(async () => { await sleep(30); });
    const confirmBtn = qa('button').filter((b) => (b.className || '').includes('btn-primary')).pop();
    await act(async () => { click(confirmBtn); });
    await act(async () => { await sleep(60); });
    t('confirming supply navigates to Intent OS with the hand-off params',
      window.location.hash.startsWith('#/intent') && /hint=loan-supply/.test(window.location.hash) && /amount=250/.test(window.location.hash));
    t('the compose tab opens with the loan banner', !!q('[data-testid="loan-handoff"]'));
    await compile();
    const loanErr = q('.ios-result .notice-danger');
    t('compiling the real loan hand-off produces a plan, not SAME_TOKEN', !loanErr);

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
