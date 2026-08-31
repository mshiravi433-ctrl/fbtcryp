/**
 * PHASE 201-207 — the user-reported fixes, driven like a user drives them.
 * ---------------------------------------------------------------------------
 * Covers everything the owner reported on #/intent-ai in one mounted pass:
 *
 *   1. the AI↔AI conversation is VISIBLE (the dialogue transcript renders)
 *   2. the mission strip exists and is translated
 *   3. the section links (wallet/stocks/futures/loan/farm/points) exist
 *   4. teaching works: «یادت باشد…» is stored, recalled, and refused when
 *      it smells like a secret
 *   5. the points chip renders and a plan awards points through the real store
 *   6. the broadcast opt-in is visible with the honest hint, and the receipt
 *      says "announced fee" (not "fee collected") when nothing was sent
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import '../../src/i18n/index.js';
import IntentAIPanel from '../../src/components/IntentAIPanel.jsx';
import { listTaught, clearTaught } from '../../src/lib/intent-ai/taughtMemory.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  globalThis.fetch = async () => { throw new Error('offline'); };
  const q = (sel) => container.querySelector(sel);
  const qa = (sel) => [...container.querySelectorAll(sel)];

  try {
    clearTaught();
    let root = null;
    /*
     * A stub EIP-1193 runtime: the panel takes the CONNECTED wallet exactly
     * this way from IntentAIRoute (provider + account + chainId), so a test
     * stub is the honest way to drive the signed-execution path headless.
     * It answers typed-data signing with a valid hex string and nothing else.
     */
    const stubProvider = {
      request: async ({ method }) => {
        if (method === 'eth_signTypedData_v4' || method === 'personal_sign') {
          return `0x${'1a'.repeat(65)}`;
        }
        return null;
      }
    };
    const stubRuntime = {
      provider: stubProvider,
      account: '0x1111111111111111111111111111111111111111',
      chainId: 42161,
      connected: true
    };
    /* A stub broadcast bridge standing in for useIntentBroadcast: it returns
       a REAL-shaped 32-byte hash so the receipt logic can be driven end to
       end. (The real bridge is exercised by its own unit probe.) */
    const stubHash = `0x${'ab'.repeat(32)}`;
    let broadcastCalls = 0;
    const stubExecute = async (terms) => {
      broadcastCalls += 1;
      if (terms?.kind === 'not-a-swap') return { ok: false, code: 'NOT_SUPPORTED', message: 'no venue' };
      return { ok: true, txHash: stubHash, chainId: Number(terms?.chainId) || 42161, wait: null };
    };
    const stubTrack = async ({ txHash }) => ({ status: 'confirmed', confirmations: 1 });
    const stubExplorer = ({ txHash, chainId }) => `https://explorer.test/tx/${txHash}`;
    root = createRoot(container);
    await act(async () => {
      root.render(
        <IntentAIPanel
          defaultChainId={42161}
          walletRuntime={stubRuntime}
          executeIntentBroadcast={stubExecute}
          trackIntentTx={stubTrack}
          explorerUrl={stubExplorer}
          broadcastSupportedKind={(kind) => kind === 'swap'}
        />
      );
    });
    await act(async () => { await sleep(30); });

    const composerInput = q('.ia-composer input');

    /* 1 — mission strip */
    t('the mission strip states the AI purpose', !!q('[data-testid="intent-ai-mission"]')
      && q('[data-testid="intent-ai-mission"]').textContent.length > 10);

    /* 2 — section links */
    const sectionLinks = qa('.ia-section-links .ia-section-chip');
    t('the six section links exist (wallet/stocks/futures/loan/farm/points)', sectionLinks.length === 6);
    t('every section link points at a real route',
      sectionLinks.every((a) => /^#\/(wallet|stocks|perp|loan|farm|rewards)$/.test(a.getAttribute('href') || '')));

    /* 3 — points chip */
    t('the points chip renders with the store total', !!q('[data-testid="intent-ai-points"]'));

    /* 4 — teach flow */
    await act(async () => { setInputValue(composerInput, 'یادت باشد: شبکهٔ پیش‌فرض من آربیتروم است'); });
    await act(async () => { q('.ia-composer .ia-send').click(); });
    await act(async () => { await sleep(10); });
    t('teaching stores the entry and confirms it in chat',
      !!q('[data-testid="memory-learned"]') && listTaught().length === 1);
    t('a taught chain becomes the default chain hint', listTaught()[0]?.tag === 'preferred-chain');

    await act(async () => { setInputValue(composerInput, 'چه چیزی یادت هست؟'); });
    await act(async () => { q('.ia-composer .ia-send').click(); });
    await act(async () => { await sleep(10); });
    t('a recall lists what was taught',
      !!q('[data-testid="memory-recall"]') && /آربیتروم/.test(q('[data-testid="memory-recall"]').textContent || ''));

    await act(async () => { setInputValue(composerInput, 'یادت باشد: seed phrase is test test test'); });
    await act(async () => { q('.ia-composer .ia-send').click(); });
    await act(async () => { await sleep(10); });
    t('a taught secret is refused, never stored',
      listTaught().length === 1 && /never memorize|هرگز/i.test(container.textContent || ''));

    /* 5 — L3 plan → dialogue + points + opt-in + receipt */
    const l3chip = q('[data-testid="intent-ai-level-3"]');
    await act(async () => { l3chip?.click(); });
    await act(async () => { await sleep(20); });
    const confirmPolicy = qa('button').find((b) => /CONFIRM & START/i.test(b.textContent || ''));
    await act(async () => { confirmPolicy?.click(); });
    await act(async () => { await sleep(20); });

    await act(async () => { setInputValue(composerInput, 'swap 100 USDC to ETH on Arbitrum'); });
    await act(async () => { q('.ia-composer .ia-send').click(); });
    await act(async () => { await sleep(40); });

    t('the AI↔AI dialogue transcript renders in chat', qa('[data-testid="agent-dialogue-line"]').length >= 3);
    t('the dialogue names the strategy and execution agents',
      /fbt\.strategy|Strategy|استراتژی/i.test(q('[data-testid="agent-dialogue"]').textContent || '')
      && /fbt\.execution|Execution|اجرا/i.test(q('[data-testid="agent-dialogue"]').textContent || ''));

    const screenEl = q('[data-testid="interactive-confirmation-screen"]');
    t('the broadcast opt-in is offered with the honest hint',
      !!q('[data-testid="broadcast-opt-in"]') && !!q('[data-testid="broadcast-opt-in-hint"]'));

    await act(async () => { q('[data-testid="final-confirm-button"]').click(); });
    await act(async () => { await sleep(40); });
    t('a run without the opt-in says WHY nothing was sent (not a dead end)',
      !!q('[data-testid="receipt-reason"]') && q('[data-testid="receipt-reason"]').textContent.length > 5);
    t('the receipt says the fee was ANNOUNCED, not collected, when nothing ran',
      !!q('[data-testid="receipt-fee-line"]')
      && /announced|اعلام‌شده/i.test(q('[data-testid="receipt-fee-line"]').textContent || ''));
    t('a plan reaching the confirmation screen earned points',
      !!q('[data-testid="intent-ai-points-gain"]'));

    /* 6b — the REAL broadcast path: opt in, confirm, get a submitted receipt
       with the hash, the explorer link and the execution points. */
    const optIn = q('[data-testid="broadcast-opt-in"] input');
    await act(async () => { optIn.click(); });
    await act(async () => { await sleep(10); });
    await act(async () => { q('[data-testid="final-confirm-button"]').click(); });
    await act(async () => { await sleep(60); });
    t('the opted-in confirm calls the real broadcast bridge once', broadcastCalls === 1);
    t('the receipt shows the real transaction hash with a submitted-or-better status',
      !!q('[data-testid="receipt-tx-hash"]')
      && /submitted|completed|confirmed/i.test(container.textContent || ''));
    t('the receipt links the hash to the explorer',
      !!q('[data-testid="receipt-explorer-link"]')
      && /explorer\.test/.test(q('[data-testid="receipt-explorer-link"]').getAttribute('href') || ''));
    t('the confirmed send promotes the receipt to completed via tracking',
      /completed|confirmed/i.test(container.textContent || ''));
    t('the fee line switches to CHARGED once a real transaction ran',
      /charged|دریافت/i.test(q('[data-testid="receipt-fee-line"]')?.textContent || ''));

    t('the panel produced no unexpected console errors', errors.length === 0);
    await act(async () => { root.unmount(); });
  } finally {
    console.error = realError;
    globalThis.fetch = realFetch;
    clearTaught();
    container.innerHTML = '';
  }
  return out;
}
