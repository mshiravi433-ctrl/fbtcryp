/**
 * THE OTHER HALF OF THE RETURN LOOP: a plain venue trip (token→token, Solana).
 * ---------------------------------------------------------------------------
 * The strategy-return probe covers the plan stage: the chat reconciles the
 * chain and settles it. But the user's report was wider than plans:
 *
 *   «سواپ رو زدم و برگشتم، برگشتی! خروجی چی شد؟ می‌پرسه» — after a swap that
 *   really went through, the chat still asked, because a plain trip to /swap or
 *   /solana has no plan to reconcile against and the old code had nothing else
 *   to read.
 *
 * Now the venue's own device ledger is read: the swap screens confirm every
 * signed swap into swapHistory (EVM and Solana), and `venueSwapReceipt` decides
 * whether this trip already has an outcome. This probe mounts the REAL page
 * with the device in each state and checks the one thing the user asked for —
 * that the question is gone when the venue answered, and that it is still there
 * when it did not.
 *
 * The asymmetry is deliberate and is checked in both directions: failing to ask
 * when the outcome is unknown is worse than asking twice, so every state that
 * is not a confirmed local swap must fall back to the question.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { TelegramProvider } from '../../src/context/TelegramContext.jsx';
import { WalletProvider } from '../../src/context/WalletContext.jsx';
import IntentAIUnified from '../../src/components/IntentAIUnified.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HANDOFF_KEY = 'fbt.ai.os.pending-handoff';
const SWAP_KEY = 'fbt-swap-history-v1';
const QUESTION = /برگشتی|خروجی چی شد|how did it go/i;
const RECORDED = /نتیجه را از تو نمی‌پرسم|I am not asking you for the outcome/;

export async function run(container) {
  const rows = [];
  const check = (name, ok) => { rows.push([name, !!ok]); console.log((ok ? '✓ ' : '✗ ') + name); };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/markets?')) return json([
      { id: 'ethereum', symbol: 'ETH', price: 3000, change24h: -2.5, mcap: 1e9, volume: 1e6 },
      { id: 'solana', symbol: 'SOL', price: 150, change24h: 1.2, mcap: 6e10, volume: 2e9 }
    ]);
    if (u.includes('/category/')) return json([]);
    if (u.includes('/api/')) return json([]);
    throw new Error('test: domain deliberately unavailable');
  };

  const mount = async () => {
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
    for (let i = 0; i < 30; i += 1) await act(async () => { await sleep(40); });
    return root;
  };
  const unmount = async (root) => { await act(async () => { root.unmount(); }); };
  const handoffOnDevice = () => { try { return JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null'); } catch { return null; } };
  const seed = ({ route, kind = 'route', rows: ledger }) => {
    /* A fresh device per scenario: one returning user, one trip. */
    localStorage.clear();
    /* No seasonId: the hand-off belongs to the season that issued it, and a
       seeded device has none — a stale id would make the return turn wait for
       a season that will never come back, which is its own (correct) silence. */
    localStorage.setItem(HANDOFF_KEY, JSON.stringify({ route, label: route.split('?')[0] === '/solana' ? 'سولانا' : 'سواپ', kind, at: Date.now() - 60_000 }));
    if (ledger) localStorage.setItem(SWAP_KEY, JSON.stringify(ledger));
  };

  const SOL_ROUTE = '/solana?to=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const EVM_ROUTE = '/swap?from=USDC&to=PEPE&chain=8453';

  /* ── 1. Solana trip, the swap screen recorded a confirmed swap ─────────── */
  seed({
    route: SOL_ROUTE,
    rows: [{
      id: 's_sol', network: 'solana', chainId: null, chainName: 'Solana',
      from: '1.5', fromSymbol: 'SOL', to: '220', toSymbol: 'USDC',
      status: 'confirmed', txHash: '5'.repeat(64), at: Date.now() - 30_000
    }]
  });
  let root = await mount();
  let text = container.textContent || '';
  check('the chat renders for a returning user', !!container.querySelector('.iaos-composer'));
  check('a Solana swap the venue recorded is NOT asked about again', !QUESTION.test(text));
  check('the return turn says the venue already recorded it', RECORDED.test(text));
  check('the recorded swap is named by what moved (SOL → USDC)', /SOL\s*→\s*USDC/.test(text));
  check('the hand-off is cleared, so the next visit cannot ask either', handoffOnDevice() === null);
  await unmount(root);

  /* ── 2. Same trip, the swap is still in the wallet prompt (pending) ────── */
  seed({
    route: SOL_ROUTE,
    rows: [{
      id: 's_pending', network: 'solana', chainId: null, chainName: 'Solana',
      from: '1.5', fromSymbol: 'SOL', to: '220', toSymbol: 'USDC',
      status: 'pending', txHash: null, at: Date.now() - 30_000
    }]
  });
  root = await mount();
  text = container.textContent || '';
  check('a swap that never confirmed still gets the honest question', QUESTION.test(text));
  check('nothing claims a pending swap went through', !RECORDED.test(text));
  await unmount(root);

  /* ── 3. token→token swap on the EVM screen ────────────────────────────── */
  seed({
    route: EVM_ROUTE,
    rows: [{
      id: 's_evm', network: 'evm', chainId: 8453, chainName: 'Base',
      from: '100', fromSymbol: 'USDC', to: '500000', toSymbol: 'PEPE',
      status: 'confirmed', txHash: `0x${'ab'.repeat(32)}`, at: Date.now() - 30_000
    }]
  });
  root = await mount();
  text = container.textContent || '';
  check('a confirmed token→token swap is not asked about again', !QUESTION.test(text) && RECORDED.test(text));
  await unmount(root);

  /* ── 4. A trip to a venue with no ledger keeps the question ───────────── */
  seed({ route: '/bridge?fromChain=1&toChain=8453' });
  root = await mount();
  text = container.textContent || '';
  check('a venue with no device ledger keeps the outcome question', QUESTION.test(text));
  await unmount(root);

  globalThis.fetch = realFetch;
  return rows;
}
