/**
 * ACTIVITY TAB WITH REAL ORDERS — MOUNTED REGRESSION
 * ---------------------------------------------------------------------------
 * What the owner reported, in their words:
 *
 *   «در صفحه fbt هوش مصنوعی، تب فعالیت‌ها وقتی می‌زنی می‌گه به مشکل برخورد و
 *    کار نمی‌ده.»
 *
 * ─── WHAT WAS ACTUALLY WRONG ────────────────────────────────────────────────
 * A stored order keeps the WHOLE token object: `createOrder` in
 * src/lib/orders.js copies `input.fromToken` / `input.toToken`, and every other
 * screen reads `o.fromToken.symbol` (see src/components/ActiveOrdersCard.jsx).
 * The activity feed rendered `{o.fromToken || '—'}` — the object itself — and
 * React refuses an object as a child:
 *
 *   "Objects are not valid as a React child (found: object with keys
 *    {symbol, name, address, decimals, chainId, coingeckoId})"
 *
 * That throw happened during render, so it escaped to the route boundary and
 * replaced the page with «این صفحه به مشکل خورد» — the crash card, not a
 * notice inside the tab. It reproduced for everyone who had ever created an
 * order, because that is the only way an order enters this store.
 *
 * ─── WHY THIS PROBE SHAPES THE STORE THE WAY IT DOES ────────────────────────
 * The earlier probes seeded string tokens ("USDT"/"BTC") — a shape the app
 * never writes — and therefore passed while production failed. This one seeds
 * the REAL shape, exactly as `createOrder({type:'dca', …})` persists it:
 * both tokens as full objects. A second, legacy row keeps plain strings, so
 * the fix is pinned in both directions: the object must read as a symbol and
 * a string must keep working.
 *
 * The network boundary is dead on purpose: the activity feed is local data,
 * and a tab that needed the network to survive a crash would be a different
 * bug. Mounts ONCE — repeated mounts of this component exhaust the heap.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import { TelegramProvider } from '../../src/context/TelegramContext.jsx';
import { WalletProvider } from '../../src/context/WalletContext.jsx';
import IntentAIUnified from '../../src/components/IntentAIUnified.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Shaped exactly like the token rows `src/pages/Orders.jsx` hydrates from the
   chain lists before handing them to `createOrder`. */
const TOKEN_USDT = { symbol: 'USDT', name: 'Tether', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, chainId: 56, coingeckoId: 'tether' };
const TOKEN_BTC = { symbol: 'BTC', name: 'Bitcoin', address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18, chainId: 56, coingeckoId: 'bitcoin' };

/* The object shape the app writes today (the one that used to crash). */
const OBJECT_ORDER = {
  id: 'o_probe_object_tokens',
  type: 'dca',
  chainId: 56,
  fromToken: TOKEN_USDT,
  toToken: TOKEN_BTC,
  amountIn: '50',
  createdAt: Date.now() - 86400000,
  status: 'active',
  runsDone: 3,
  lastNotifiedAt: 0,
  interval: 'daily',
  totalRuns: 10,
  nextRunAt: Date.now() + 3600000
};

/* A legacy/hand-written row that carries only the tickers. */
const LEGACY_ORDER = {
  id: 'o_probe_legacy_tokens',
  type: 'limit',
  chainId: 56,
  fromToken: 'USDT',
  toToken: 'ETH',
  amountIn: '10',
  createdAt: Date.now() - 3600000,
  status: 'paused',
  runsDone: 0,
  lastNotifiedAt: 0,
  targetRate: 5000,
  direction: 'below'
};

class Catch extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return <div id="probe-caught">{String(this.state.error?.message || this.state.error)}</div>;
    return this.props.children;
  }
}

export async function run(container) {
  const rows = [];
  const check = (name, ok) => rows.push([name, Boolean(ok)]);
  const q = (sel) => container.querySelector(sel);

  localStorage.clear();
  localStorage.setItem('fbt-orders-v1', JSON.stringify([OBJECT_ORDER, LEGACY_ORDER]));
  localStorage.setItem('fbt.intent-os.history.v1', JSON.stringify({
    schema: 'fbt.intent-os-history.v2',
    conversations: [],
    operations: [{ id: 'op1', kind: 'MONITOR_CREATE', status: 'ACTIVE', title: 'مانیتور طلا', at: Date.now() }],
    seasons: [{ seasonId: 's1', title: 'طلا بخرم؟', lastAt: Date.now(), messageCount: 4, lastMessage: 'طلا بهتره' }]
  }));

  const errors = [];
  const onError = (event) => errors.push(String(event?.message || event));
  window.addEventListener('error', onError);

  /* The activity feed is local; nothing here may depend on a live network. */
  const rejectingFetch = () => Promise.reject(new Error('probe: network is dead on purpose'));
  globalThis.fetch = window.fetch = rejectingFetch;

  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <Catch>
          <TelegramProvider>
            <WalletProvider>
              <MemoryRouter initialEntries={['/intent']}>
                <IntentAIUnified />
              </MemoryRouter>
            </WalletProvider>
          </TelegramProvider>
        </Catch>
      );
    });
    for (let i = 0; i < 5; i += 1) await act(async () => { await sleep(25); });

    const tabs = Array.from(container.querySelectorAll('.tag-tab'));
    check('the assistant tab bar mounts with an activity tab', tabs.length >= 3);
    await act(async () => { tabs[2]?.click(); });
    for (let i = 0; i < 5; i += 1) await act(async () => { await sleep(25); });

    const view = q('[data-testid="tag-view-activity"]');
    check('clicking the activity tab renders the feed instead of the crash card', Boolean(view) && !q('#probe-caught'));
    const text = view ? view.textContent || '' : '';
    check('an order stored with token OBJECTS reads as its symbols (USDT → BTC)',
      text.includes('USDT → BTC') && !text.includes('[object Object]'));
    check('a legacy order stored with plain ticker strings keeps working (USDT → ETH)',
      text.includes('USDT → ETH'));
    check('the season and operation rows still render', /طلا بخرم/.test(text) && /مانیتور طلا/.test(text));
    check('no render error escaped to window', errors.length === 0);
  } finally {
    window.removeEventListener('error', onError);
    await act(async () => { root.unmount(); });
  }
  return rows;
}
