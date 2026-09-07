/**
 * OPS HAND-OFF — the reported dead button, driven the way the user drove it.
 * ---------------------------------------------------------------------------
 * The original report was: «می‌زنم مرکز عملیات و گزینه باز کردن را می‌زنم کار
 * نمی‌کنه». Root cause: the human layer emitted `route:'/intent?tab=ops'`, the
 * chat navigated to it, and the page mounted at `/intent` NEVER READ
 * `location.search` — so the URL changed and nothing on screen did.
 *
 * No logic probe can catch that, because the logic was fine; the wiring was
 * missing. So this mounts the REAL IntentAIUnified inside the same provider
 * stack test/screens.jsx uses and asserts the ops panel actually opens.
 *
 * It mounts ONCE. Mounting this component repeatedly in one process exhausts
 * the heap (measured: 3 GB is not enough for four mounts), and the single
 * reported path is the one worth proving.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { TelegramProvider } from '../../src/context/TelegramContext.jsx';
import { WalletProvider } from '../../src/context/WalletContext.jsx';
import IntentAIUnified from '../../src/components/IntentAIUnified.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
          <MemoryRouter initialEntries={['/intent?tab=ops']}>
            <IntentAIUnified />
          </MemoryRouter>
        </WalletProvider>
      </TelegramProvider>
    );
  });
  /* The tab effect runs on mount and the panel fetches its own data; give the
     microtask queue and the stubbed fetches a chance to settle. */
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await sleep(20); });
  }

  check('the chat surface renders at /intent?tab=ops', (container.textContent || '').trim().length > 20);
  check('arriving at /intent?tab=ops opens the operations panel', !!q('.iaos-ops-panel'));
  check('the opened panel is the real overlay, not a stub', !!q('.iaos-panel-overlay[role="dialog"]'));
  check('it renders the live wiring strip', !!q('[data-testid="ops-status-strip"]'));
  check('the strip carries its state as data, not colour alone', !!q('[data-testid="ops-status-strip"] [data-ok]'));

  await act(async () => { root.unmount(); });
  return rows;
}
