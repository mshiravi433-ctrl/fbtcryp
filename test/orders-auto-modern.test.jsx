// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
 * AUTO ORDERS — the modernised surface.
 *
 * The three things this file pins are the three things that were wrong:
 *
 *   1. Only the wallet's chain could be used and only its handful of curated
 *      tokens. Now every supported network is offered and the token list is the
 *      swap screen's universe — with the price feed resolved BY ADDRESS.
 *   2. A token with no feed looked like any other token until Create silently
 *      failed. It is now marked in the list, stated under the pickers, and
 *      Create is disabled before anything is typed.
 *   3. Opening a picker must not open the keyboard (the reported Android bug).
 *
 * NOTE ON QUERIES. The order form contains native `<select>` elements, and
 * jsdom loads no stylesheet — so their `<option>` children count as VISIBLE and
 * an unscoped `findAllByRole('option')` resolves immediately, before the picker
 * has painted. Every assertion below therefore waits for the picker's own rows
 * (`.modern-select-option`) and scopes to them.
 */

const GOOD = '0x1111111111111111111111111111111111111111';
const NOFEED = '0x2222222222222222222222222222222222222222';

const UNIVERSE = [
  { symbol: 'BNB', name: 'BNB', native: true, decimals: 18, coingeckoId: 'binancecoin' },
  { symbol: 'USDT', name: 'Tether', address: '0x5555555555555555555555555555555555555555', decimals: 18, coingeckoId: 'tether' },
  { symbol: 'ZZZ', name: 'Zeta Zed', address: GOOD, decimals: 18 },
  { symbol: 'ZZZ', name: 'Zeta Zed (clone)', address: NOFEED, decimals: 18, duplicateSymbol: true }
];

const resolved = vi.hoisted(() => ({ id: 'zeta-zed' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts && opts.n != null ? `${key}:${opts.n}` : key)
  })
}));
/*
 * ONE component type per tag, cached. `motion.div` must be the SAME type on
 * every render — returning a fresh function each time makes React treat the
 * subtree as a new component and remount it, which is a property of the mock
 * (and of the app's real re-render cadence) rather than of framer-motion.
 */
vi.mock('framer-motion', () => {
  const FRAMER_ONLY = new Set([
    'whileTap', 'whileHover', 'whileInView', 'variants', 'initial', 'animate', 'exit',
    'transition', 'layout', 'layoutId', 'drag', 'dragConstraints', 'onAnimationComplete'
  ]);
  const cache = new Map();
  const motion = new Proxy({}, {
    get: (_target, tag) => {
      if (!cache.has(tag)) {
        cache.set(tag, ({ children, ...props }) => {
          const dom = {};
          for (const [k, v] of Object.entries(props)) if (!FRAMER_ONLY.has(k)) dom[k] = v;
          return React.createElement(tag, dom, children);
        });
      }
      return cache.get(tag);
    }
  });
  return { motion, AnimatePresence: ({ children }) => <>{children}</>, useReducedMotion: () => true };
});
vi.mock('../src/store/useSettingsStore', () => ({
  useSettingsStore: Object.assign((fn) => fn({ reduceMotion: true, defaultSlippage: 0.5 }), {
    getState: () => ({ reduceMotion: true })
  })
}));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => ({ isConnected: true, address: '0xabc', chainId: 56 })
}));
vi.mock('../src/store/useAppStore', () => ({
  useAppStore: Object.assign((fn) => fn({ notify: () => {} }), { getState: () => ({ notify: () => {} }) })
}));
vi.mock('../src/hooks/useHideBalances', () => ({ useHideBalances: () => {} }));
vi.mock('../src/hooks/useMarket', () => ({ usePriceMap: () => ({ map: {} }), useChart: () => ({ data: [] }) }));
vi.mock('../src/lib/stagePush', () => ({ dispatchStageAlert: async () => {} }));
vi.mock('../src/lib/learning', () => ({ loadLearningParams: async () => null, orderTune: () => null }));
vi.mock('../src/lib/dcaExecution', () => ({
  activateDca: () => ({}),
  confirmDcaCancel: () => ({}),
  createDcaRevision: () => ({ order: null }),
  dcaDisplayStatus: (o) => o.status,
  loadDcaReceipts: () => [],
  requestDcaCancel: () => ({})
}));
vi.mock('../src/lib/goalStore', () => ({ loadGoal: () => null }));
vi.mock('../src/components/HistoryPanel', () => ({ default: () => null }));
vi.mock('../src/components/AutopilotPanel', () => ({ default: () => null }));
vi.mock('../src/components/AutopilotGuideSheet', () => ({ default: () => null }));
vi.mock('../src/components/SolanaTokenPicker', () => ({ default: () => null }));
vi.mock('../src/lib/solanaUniverse', async (original) => ({
  ...(await original()),
  loadSolanaUniverse: async () => [],
  getSolanaUniverseSync: () => []
}));
vi.mock('../src/components/AssetIcon', () => ({
  default: ({ chain }) => <i data-chain={String(chain)} />
}));

/* The universe is injected rather than fetched, so the picker can be asserted
   on rows the curated list does not contain. */
vi.mock('../src/lib/tokenLists', () => ({
  getTokensSync: () => UNIVERSE,
  loadTokens: async () => UNIVERSE,
  searchTokens: (list) => list,
  tokenKey: (t) => (t?.native ? 'native' : String(t?.address || '').toLowerCase()),
  findToken: (list, key) =>
    (list || []).find((t) => (t?.native ? 'native' : String(t?.address || '').toLowerCase()) === key)
}));

/* Only the ADDRESS-keyed lookup is stubbed: by symbol it would be wrong, and
   the whole point is that a feed is resolved for a contract or not at all. */
vi.mock('../src/lib/coinId', async (original) => ({
  ...(await original()),
  resolveCoinIds: async (_chainId, tokens) =>
    new Map(
      (tokens || [])
        .filter((t) => String(t.address || '').toLowerCase() === GOOD)
        .map(() => [GOOD, resolved.id])
    )
}));

const Orders = (await import('../src/pages/Orders')).default;

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/orders']}>
      <Orders />
    </MemoryRouter>
  );

const openLimitSheet = async () => {
  mount();
  fireEvent.click(screen.getByText('orders.newLimit'));
  await screen.findByTestId('ord-chain-select');
};

/** Opens a ModernSelect and returns its rows once they exist. */
const openPicker = async (testId) => {
  const field = screen.getByTestId(testId);
  fireEvent.click(within(field).getByRole('button'));
  await waitFor(() => {
    expect(document.querySelectorAll('.modern-select-option').length).toBeGreaterThan(1);
  });
  return [...document.querySelectorAll('.modern-select-option')];
};

describe('auto orders — networks, tokens and price feeds', () => {
  it('offers every routable network, each with its own icon and token count', async () => {
    await openLimitSheet();
    const options = await openPicker('ord-chain-select');

    expect(options.length).toBeGreaterThanOrEqual(16);
    /* every row carries a mark drawn from the chain id */
    expect(options[0].querySelector('i[data-chain]')).toBeTruthy();
    const text = options.map((o) => o.textContent).join(' ');
    expect(text).toContain('BNB Smart Chain');
    expect(text).toContain('Arbitrum');
    /* and each row says how many tokens it offers, from the shared cache */
    expect(text).toContain('orders.networkCount');
  });

  it('resolves a price feed for a token the curated list never had', async () => {
    await openLimitSheet();
    const options = await openPicker('ord-from-select');

    const zzz = options.find((o) => o.textContent.startsWith('ZZZ'));
    fireEvent.click(zzz);

    await waitFor(() => {
      expect(screen.getByText('orders.pxOk')).toBeTruthy();
    });
    expect(screen.getByTestId('ord-from-select').textContent).toContain('ZZZ');
  });

  it('marks a token with no feed, explains it, and refuses to create', async () => {
    await openLimitSheet();
    const options = await openPicker('ord-from-select');

    /* both tickers are offered — hiding one would leave the user hunting for a
       token that is right there on the swap screen — and the pair is named by
       contract, so the clone is distinguishable */
    const clones = options.filter((o) => o.textContent.startsWith('ZZZ'));
    expect(clones).toHaveLength(2);
    fireEvent.click(clones[1]);

    /* the lookup answers "no feed", so the form says so and refuses */
    await waitFor(() => {
      expect(screen.getByText('orders.typeUnorderable')).toBeTruthy();
    });
    expect(screen.getByText('orders.create').closest('button').disabled).toBe(true);

    /*
     * And the answer STICKS to the row: reopening the list shows the one with
     * no feed marked off, so the next person does not have to pick it to find
     * out. Unknown tokens are not marked — the list never claims to know more
     * than it has been told.
     */
    const again = await openPicker('ord-from-select');
    const after = again.filter((o) => o.textContent.startsWith('ZZZ'));
    expect(after[1].getAttribute('aria-disabled')).toBe('true');
    expect(after[0].getAttribute('aria-disabled')).toBeNull();
  });

  it('never focuses a field when a picker opens', async () => {
    await openLimitSheet();
    await openPicker('ord-to-select');
    expect(document.activeElement?.tagName).not.toBe('INPUT');
  });

  it('shows the network on every saved order row', async () => {
    localStorage.setItem(
      'fbt-orders-v1',
      JSON.stringify([
        {
          id: 'o1',
          type: 'limit',
          chainId: 42161,
          fromToken: { symbol: 'ARB', coingeckoId: 'arbitrum' },
          toToken: { symbol: 'USDT', coingeckoId: 'tether' },
          amountIn: '10',
          targetRate: 2,
          direction: 'above',
          priceOf: 'from',
          status: 'active',
          createdAt: Date.now(),
          lastNotifiedAt: 0
        }
      ])
    );
    mount();
    await waitFor(() => {
      expect(document.querySelector('.ord-row')).toBeTruthy();
    });
    const row = document.querySelector('.ord-row');
    /* the row names its network (the chain's short tag) and draws its mark */
    expect(row.textContent).toContain('ARB');
    expect(row.querySelector('i[data-chain="42161"]')).toBeTruthy();
  });

  it('keeps the Solana handoff on its own network, next to the EVM cards', async () => {
    mount();
    const card = await screen.findByTestId('ord-sol-card');
    expect(card.textContent).toContain('orders.solana.title');
    /* it says what it is before it is used: a saved handoff, not a fill */
    expect(card.textContent).toContain('orders.solana.evmHint');
    expect(within(card).getByText('orders.solana.create')).toBeTruthy();
  });

  it('edits a DCA plan in real fields, including a picked network', async () => {
    localStorage.setItem(
      'fbt-orders-v1',
      JSON.stringify([
        {
          id: 'dca1',
          type: 'dca',
          chainId: 56,
          fromToken: { symbol: 'USDT', coingeckoId: 'tether' },
          toToken: { symbol: 'BNB', coingeckoId: 'binancecoin' },
          amountIn: '25',
          interval: 'weekly',
          totalRuns: 8,
          runsDone: 0,
          status: 'active',
          createdAt: Date.now(),
          lastNotifiedAt: 0
        }
      ])
    );
    mount();
    const row = await waitFor(() => {
      const el = document.querySelector('.ord-row');
      if (!el) throw new Error('row not rendered');
      return el;
    });

    /*
     * The old flow was four `window.prompt` dialogs. The spy answers `null`
     * rather than throwing: a throw inside a React event handler would abort
     * the update and the test would be measuring its own mock.
     */
    const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => null);
    fireEvent.click(within(row).getByRole('button', { name: 'orders.edit' }));
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();

    /* the panel offers the same fields the creation form does */
    const sheet = document.querySelector('.ord-edit');
    expect(sheet).toBeTruthy();
    expect(within(sheet).getByText('orders.editAmountPrompt')).toBeTruthy();

    /* and its network picker works — the row is not allowed to eat its state */
    const chain = screen.getByTestId('ord-edit-chain-select');
    fireEvent.click(within(chain).getByRole('button'));
    await waitFor(() => {
      expect(document.querySelectorAll('.modern-select-option').length).toBeGreaterThanOrEqual(16);
    });
    const arbitrum = [...document.querySelectorAll('.modern-select-option')]
      .find((o) => o.textContent.includes('Arbitrum'));
    fireEvent.click(arbitrum);
    await waitFor(() => {
      expect(screen.getByTestId('ord-edit-chain-select').textContent).toContain('Arbitrum');
    });
  });
});
