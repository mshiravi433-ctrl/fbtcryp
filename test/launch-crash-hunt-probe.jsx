/**
 * FBT LAUNCH — THE PAGE, MOUNTED AND LOOKED AT.
 * ---------------------------------------------------------------------------
 * Reported: «صفحه لانچ میگه با مشکل برخورد و نمیاره» — tapping Launch landed on
 * the route crash card ("این صفحه به مشکل خورد") instead of the launchpad.
 *
 * ─── WHY NO SUITE CAUGHT IT ─────────────────────────────────────────────────
 * `test/launch-probe.mjs` locks the launch MODULE (spec validation, capability
 * bitmaps, the risk engine, calldata bytes, the state machine) and it passed
 * the whole time — every one of those files was fine. `test/launch-solana-probe.mjs`
 * does the same for the Solana workstream. Neither of them RENDERS the page,
 * and the page is where the defect was: `Launch.jsx` read a `useState` binding
 * from a dependency array declared ~400 lines BEFORE the state itself, so the
 * component threw `ReferenceError: Cannot access 'balanceInfo' before
 * initialization` on EVERY render and never painted a single pixel.
 *
 * Pure logic probes cannot see that, and `test/screens.jsx` — the suite whose
 * whole job is "mount every routed screen, a broken lazy route fails silently
 * at build time and loudly in the user's hands" — did not list `/launch`.
 *
 * ─── WHAT THIS PROBE DOES ───────────────────────────────────────────────────
 *   · mounts the REAL page under the REAL providers (Telegram, Wallet,
 *     HashRouter) and inside `RouteBoundary`, exactly like App.jsx does;
 *   · in StrictMode, because that is how the app mounts it;
 *   · with `fetch` stubbed at the boundary, so a dead or MALFORMED
 *     `/api/launch/config` is a shape to survive rather than a hang;
 *   · asserts the wizard actually PAINTED — hero, five stepper tabs, the chain
 *     grid, the network step — and that the crash card is absent.
 *
 * The page is offline-first by design (lib/launch/api): when the config
 * endpoint is unreachable it falls back to the built-in chain registry. A
 * registry that arrives in the wrong SHAPE has to degrade the same way — it
 * used to be spread straight into state and take the page down with it.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { HashRouter, Route, Routes } from 'react-router-dom';
import i18n, { setLanguage } from '../src/i18n/index.js';
import { TelegramProvider } from '../src/context/TelegramContext.jsx';
import { WalletProvider } from '../src/context/WalletContext.jsx';
import Launch from '../src/pages/Launch.jsx';
import RouteBoundary from '../src/components/RouteBoundary.jsx';
import { clearApiCache } from '../src/lib/api.js';
import { LAUNCH_CHAINS } from '../src/lib/launch/networks.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function Wrap({ children }) {
  return (
    <StrictMode>
      <TelegramProvider>
        <WalletProvider>
          <HashRouter>{children}</HashRouter>
        </WalletProvider>
      </TelegramProvider>
    </StrictMode>
  );
}

const res = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
});

function stubFetch(fix = {}) {
  return async (url, opts = {}) => {
    const u = String(url);
    const method = String(opts?.method || 'GET').toUpperCase();
    if (u.includes('/launch/config')) {
      if (fix.config === 'THROW') throw new Error('network down');
      return res('config' in fix ? fix.config : { networks: [] });
    }
    if (u.includes('/launch/prepare')) return res(fix.prepare ?? { ok: false, code: 'PROBE' });
    if (u.includes('/launch/verify')) return res(fix.verify ?? { ok: false, code: 'PROBE' });
    if (u.includes('/launch/record')) return res(fix.record ?? { ok: false, code: 'NO_STORE' });
    if (u.includes('/launch/records')) return res(fix.records ?? { ok: true, records: [] });
    if (method === 'POST') return res({ ok: true });
    return res({});
  };
}

/** Mount the route exactly the way App.jsx does, and look at what came out. */
async function mountCase(container, fix = {}) {
  globalThis.fetch = stubFetch(fix);
  clearApiCache();
  try { window.localStorage.clear(); window.sessionStorage.clear(); } catch { /* ignore */ }

  const errors = [];
  const realError = console.error;
  const realWarn = console.warn;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (/useLayoutEffect|act\(|not wrapped|Not implemented|ReactDOMTestUtils|is deprecated|Future Flag/.test(s)) return;
    errors.push(s);
  };
  console.warn = () => {};

  let reloads = 0;
  let caught = null;
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <Wrap>
          <RouteBoundary t={(k) => i18n.t(k)} reload={() => { reloads += 1; }}>
            <Routes><Route path="*" element={<Launch />} /></Routes>
          </RouteBoundary>
        </Wrap>
      );
      await sleep(150);
    });
  } catch (e) {
    caught = String(e?.message || e);
  }
  console.error = realError;
  console.warn = realWarn;

  const text = container.textContent || '';
  const q = (sel) => container.querySelector(sel);
  const view = {
    caught,
    errors,
    reloads,
    /* The route boundary's crash card is the exact screen that was reported. */
    crashCard: text.includes(String(i18n.t('crash.title'))),
    hero: Boolean(q('.launch-hero')),
    title: q('.launch-title-text h1')?.textContent || '',
    steps: container.querySelectorAll('.launch-stepper [role="tab"]').length,
    sectionTitle: q('.launch-section .launch-h2')?.textContent || '',
    chainRows: container.querySelectorAll('.launch-chain-grid > *').length,
    crashText: text.slice(0, 200)
  };
  await act(async () => root.unmount());
  return view;
}

export async function run(container) {
  const out = [];
  const t = (name, ok) => { out.push([name, Boolean(ok)]); if (!ok) console.log('  [launch-page][fail]', name); };
  const ok = (v) => !v.caught && v.errors.length === 0 && v.reloads === 0 && !v.crashCard;

  await setLanguage('fa');
  await sleep(60);

  /* ---------------- 1 · the page paints at all ------------------------- */
  const healthy = await mountCase(container, {});
  t('the launchpad mounts without throwing', ok(healthy));
  t('...and does NOT land on the crash card', !healthy.crashCard);
  t('the hero is there', healthy.hero && healthy.title.trim().length > 0);
  t('the wizard shows its five ordered steps', healthy.steps === 5);
  t('the network step is the first thing on screen', healthy.sectionTitle.trim().length > 0);
  /*
   * One tile per EVM launch chain PLUS the Solana slot — the grid is never
   * empty, and a fallback to the local registry really does put the chains
   * back on screen instead of leaving a blank step behind.
   */
  t('every launch chain is offered, not an empty grid', healthy.chainRows === LAUNCH_CHAINS.length + 1);
  if (!ok(healthy)) console.log('   [healthy]', JSON.stringify({ caught: healthy.caught, errors: healthy.errors.slice(0, 2), card: healthy.crashCard, text: healthy.crashText }));

  /* ------- 2 · the config endpoint is down, hostile, or malformed ------ */
  /*
   * The registry from `/api/launch/config` REPLACES the built-in defaults, and
   * the page reads rows unguarded while rendering. So every shape that is not
   * the descriptor list has to be refused and the local registry kept — a
   * gateway error page that still parses as JSON is the realistic one.
   */
  /*
   * The third column is how many chain tiles the step must show afterwards:
   * everything unusable falls back to the LOCAL registry (7 EVM chains + the
   * Solana slot); a payload with a genuinely usable row in it is honoured,
   * junk and all (1 chain + the Solana slot).
   */
  const shapes = [
    ['the API refuses the connection', { config: 'THROW' }, LAUNCH_CHAINS.length + 1],
    ['the API returns an HTML error page', { config: '<!doctype html><h1>502 Bad Gateway</h1>' }, LAUNCH_CHAINS.length + 1],
    ['the API answers with a bare string', { config: 'gateway timeout' }, LAUNCH_CHAINS.length + 1],
    ['the API answers with a bare number', { config: 42 }, LAUNCH_CHAINS.length + 1],
    ['networks is not an array', { config: { networks: 'maintenance' } }, LAUNCH_CHAINS.length + 1],
    ['networks is null', { config: { networks: null } }, LAUNCH_CHAINS.length + 1],
    ['networks holds primitives', { config: { networks: [1, 'x', null, true] } }, LAUNCH_CHAINS.length + 1],
    ['rows are objects with no chainId', { config: { networks: [{ name: 'X' }, {}] } }, LAUNCH_CHAINS.length + 1],
    ['rows describe a chain with no DEX', { config: { networks: [{ chainId: 1, name: 'Ethereum' }] } }, LAUNCH_CHAINS.length + 1],
    ['a real row is mixed in with junk', { config: { networks: [null, { chainId: 8453, name: 'Base', dex: { id: 'uniswap-v2', name: 'Uniswap V2' } }] } }, 2]
  ];
  for (const [name, fix, gridSize] of shapes) {
    const v = await mountCase(container, fix);
    t(`survives it — ${name}`, ok(v));
    /* A refused payload must still leave a usable page behind. */
    t(`...and still renders the wizard — ${name}`, v.hero && v.steps === 5 && v.chainRows === gridSize);
    if (!ok(v) || !v.hero || v.chainRows !== gridSize) console.log('   [shape]', name, JSON.stringify({ caught: v.caught, errors: v.errors.slice(0, 2), rows: v.chainRows, text: v.crashText }));
  }

  return out;
}
