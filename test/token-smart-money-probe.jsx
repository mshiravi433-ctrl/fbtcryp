/**
 * TOKEN SMART MONEY CARD — one window, one request, honest numbers.
 * ---------------------------------------------------------------------------
 * Reported, in order:
 *
 *   · «شلوعی سرور و cpu … فقط دادهٔ ۲۴ ساعته، بدون لیست کیف‌پول‌ها» — the card is
 *     no longer a four-tab view. It asks for `window=24h` once, only when it is
 *     actually open, and renders no wallet directory (consensus, receipts, top
 *     buyers/sellers are gone with the server reads that produced them).
 *   · «ارتباط هوشمند مانی را با هر توکن بررسی کن ببین درسته» — the card still
 *     ties every number to the exact contract the server read back.
 *   · «داده‌ها صفرند» — an unmeasured flow renders «—», never «$0», and the
 *     measurement behind the numbers is printed on the card.
 *
 * These are layout/wiring facts, which a source grep cannot prove — so the card
 * is mounted here against a stubbed intel route and the DOM is asked.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import '../src/i18n/index.js';
import TokenSmartMoney from '../src/components/TokenSmartMoney.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A REAL /api/v1/smart-money/token/:chain/:address body (schema
   fbt.smart-money-token.v1 + fbt.smart-money-tokensignals.v3). No `verified`
   block: the route no longer computes one. */
const FLOW = {
  schema: 'fbt.smart-money-tokensignals.v3',
  window: '24h',
  windowMs: 86_400_000,
  singleWindow: true,
  dataStatus: 'live',
  basis: 'trades',
  estimated: false,
  buyUsd: 640_000,
  sellUsd: 410_000,
  netUsd: 230_000,
  volumeUsd: 2_300_000,
  trades: 1_204,
  wallets: 381,
  accumulation: { confidence: 68 },
  distribution: { confidence: 27 },
  sampled: { trades: 1_204, wallets: 381, coveredPct: 100, complete: true },
  coverage: { tradeSource: 'geckoterminal', poolSource: 'geckoterminal', source: 'geckoterminal' }
};

const INTEL = {
  schema: 'fbt.smart-money-token.v1',
  dataStatus: 'live',
  chainId: 56,
  address: '0x55d398326f99059ff775485246999027b3197955',
  symbol: 'USDT',
  name: 'Tether USD',
  priceUsd: 1.0,
  liquidityUsd: 4_120_000,
  volume: { h1: 90_000, h24: 2_300_000 },
  txns: { buys24: 812, sells24: 744 },
  netFlowUsd: 140_000,
  markets: 9,
  dexes: ['pancakeswap'],
  /* the route trims the holder rows: aggregates only */
  holders: { dataStatus: 'live', total: 1_204_880, top10Share: 21.4, whaleConcentration: 'LOW', exchangeSupplyPct: 8.2 },
  accumulation: { confidence: 62 },
  distribution: { confidence: 31 },
  risk: 'LOW',
  window: '24h',
  at: Date.now(),
  smartMoneyFlow: FLOW
};

export async function run(container) {
  const rows = [];
  const check = (name, ok, detail) => {
    rows.push([name, !!ok]);
    console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` — ${String(detail ?? '')}`}`);
  };
  const q = (sel) => container.querySelector(sel);
  const all = (sel) => Array.from(container.querySelectorAll(sel));
  const text = () => (container.textContent || '').replace(/\s+/g, ' ');

  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    const s = String(a[0] ?? '');
    if (s.includes('useLayoutEffect') || s.includes('act(') || s.includes('not wrapped')) return;
    if (s.includes('Not implemented')) return;
    if (s.includes('React Router Future Flag')) return;
    if (s.includes('ReactDOMTestUtils.act') || s.includes('is deprecated')) return;
    errors.push(s);
  };

  const requested = [];
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    requested.push(String(url));
    return { ok: true, status: 200, json: async () => INTEL, text: async () => JSON.stringify(INTEL) };
  };

  /* ── 1. embedded in the token page: collapsed, identity visible ───────── */
  let root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <TokenSmartMoney chainId={56} address={INTEL.address} embedded />
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(40); });

  const toggle = q('[data-testid="sm-token-toggle"]');
  check('the card header is a real disclosure button', Boolean(toggle) && toggle.tagName === 'BUTTON');
  check('embedded in the token page it starts COLLAPSED (the clutter complaint)',
    toggle?.getAttribute('aria-expanded') === 'false', toggle?.getAttribute('aria-expanded'));
  check('collapsed, the metric tiles are not rendered',
    all('.sm-metric').length === 0, `${all('.sm-metric').length} tiles`);
  check('a collapsed card makes NO network request (the server-load fix)',
    requested.length === 0, requested.join(' | '));

  /* the connection: the exact contract is printed even before the read */
  const identity = q('[data-testid="sm-token-identity"]');
  check('even collapsed, the card prints the exact contract it was asked about',
    Boolean(identity) && /0x55d398326f99059ff775485246999027b3197955/i.test(identity.textContent || ''),
    identity?.textContent);
  check('...and which network, by name not chain id',
    /BNB/.test(identity?.textContent || ''), identity?.textContent);
  check('the card says up front that it covers 24 hours only',
    /(۲۴ ساعت|24 hours)/.test(q('[data-testid="sm-token-window-badge"]')?.textContent || ''),
    q('[data-testid="sm-token-window-badge"]')?.textContent);

  /* ── 2. no window rail at all ─────────────────────────────────────────── */
  check('there is no 1h/4h/7d window rail any more (24h is the only window)',
    !q('[data-testid="sm-token-window-tabs"]') && !/data-testid="sm-token-window-(1h|4h|7d)"/.test(container.innerHTML || ''));

  /* ── 3. expand → exactly ONE request, for 24h ─────────────────────────── */
  requested.length = 0;
  await act(async () => { toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await sleep(50); });
  check('the toggle expands the card in place', q('[data-testid="sm-token-toggle"]')?.getAttribute('aria-expanded') === 'true');
  check('expanding makes exactly one request, pinned to window=24h',
    requested.length === 1 && /window=24h/.test(requested[0]), requested.join(' | '));
  check('expanded, the buying/selling/net tiles render the 24h flow',
    all('.sm-metric').length >= 3 && /\$230/.test(text()) && /\$640/.test(text()), text().slice(0, 200));
  check('the window the numbers describe is printed, not assumed',
    /(۲۴ ساعت|24 hours)/.test(q('[data-testid="sm-token-window-note"]')?.textContent || ''),
    q('[data-testid="sm-token-window-note"]')?.textContent);

  /* once the response lands, the identity names the token the SERVER read */
  const expandedIdentity = q('[data-testid="sm-token-identity"]');
  check('the card states which token the numbers belong to (symbol read back from the contract)',
    /USDT/.test(expandedIdentity?.textContent || ''), expandedIdentity?.textContent);
  const pairChip = all('.sm-token-chip.ghost')[1];
  check('...with the DEX pair count that produced them',
    Boolean(pairChip) && pairChip.textContent.trim().startsWith('9'), pairChip?.textContent);

  const evidence = q('[data-testid="sm-token-evidence"]');
  check('the flow block names the measurement (exact individual trades), not a bare number',
    Boolean(evidence) && /(Individual trades|معاملات واقعی)/.test(evidence.textContent || ''), evidence?.textContent);
  check('...with the real sample size (trades and distinct wallets)',
    /1,204/.test(evidence?.textContent || '') && /381/.test(evidence?.textContent || ''), evidence?.textContent);
  check('...and the upstream that answered', /GeckoTerminal/.test(evidence?.textContent || ''), evidence?.textContent);
  check('the wallet row is a COUNT, not a list',
    /381/.test(q('[data-testid="sm-token-wallets"]')?.textContent || '')
    && all('.sm-row .mono').length === 0,
    `${q('[data-testid="sm-token-wallets"]')?.textContent} / ${all('.sm-row .mono').length} mono rows`);
  check('no receipts / consensus block is rendered (the wallet list is gone)',
    !q('[data-testid="sm-token-receipts"]') && !q('[data-testid="sm-verified-token"]'));
  await act(async () => { root.unmount(); });

  /* ── 4. the standalone route starts open ──────────────────────────────── */
  container.innerHTML = '';
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <TokenSmartMoney chainId="solana" address="So11111111111111111111111111111111111111112" embedded={false} />
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(40); });
  check('on its own route the card starts OPEN (the user navigated there to read it)',
    q('[data-testid="sm-token-toggle"]')?.getAttribute('aria-expanded') === 'true');
  check('a Solana mint is sent to the intel route as `solana`, not coerced to chain 1',
    requested.some((u) => /\/token\/solana\//.test(u)), requested.slice(-2).join(' | '));
  await act(async () => { root.unmount(); });

  /* ── 5. no pair found: the card must not pretend ──────────────────────── */
  global.fetch = async (url) => {
    requested.push(String(url));
    const body = { ...INTEL, dataStatus: 'no-pairs', symbol: null, name: null, markets: 0, holders: { dataStatus: 'unavailable' } };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  container.innerHTML = '';
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <TokenSmartMoney chainId={1} address="0x1111111111111111111111111111111111111111" embedded={false} />
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(40); });
  check('with no DEX pair the card says so instead of showing zeros as findings',
    /جفت|pair/i.test(text()), text().slice(0, 200));
  check('...and the identity line falls back to the short address, never a fake symbol',
    /0x1111/i.test(q('[data-testid="sm-token-identity"]')?.textContent || ''));
  await act(async () => { root.unmount(); });

  /* ── 6. token-detail subtab: open and deliberately not a disclosure ───── */
  container.innerHTML = '';
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <TokenSmartMoney
          chainId={1}
          address="0x1111111111111111111111111111111111111111"
          embedded
          collapsible={false}
        />
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(40); });
  const staticHead = q('.sm-token-head');
  check('token-detail smart money has a static header, not a disclosure button',
    staticHead?.tagName === 'DIV' && !q('[data-testid="sm-token-toggle"]'));
  check('token-detail smart-money content is open immediately', Boolean(q('#sm-token-card-body')));
  await act(async () => { root.unmount(); });

  /* ═══════════════════════════════════════════════════════════════════════
   * 7–10. the flow block's honesty states
   * ═══════════════════════════════════════════════════════════════════════ */
  const flowBody = (flowOver = {}, intelOver = {}) => ({
    ...INTEL,
    ...intelOver,
    smartMoneyFlow: { ...FLOW, ...flowOver }
  });
  const mountCard = async (body) => {
    global.fetch = async () => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    container.innerHTML = '';
    root = createRoot(container);
    await act(async () => {
      root.render(<MemoryRouter><TokenSmartMoney chainId={56} address={INTEL.address} embedded={false} /></MemoryRouter>);
    });
    await act(async () => { await sleep(40); });
  };

  await mountCard(flowBody());
  check('an exact trade flow prints no «estimated» chip',
    !/(estimated|تخمینی)/.test(q('[data-testid="sm-token-basis"]')?.textContent || ''),
    q('[data-testid="sm-token-basis"]')?.textContent);
  await act(async () => { root.unmount(); });

  /* estimated split (24h pool counts) */
  await mountCard(flowBody({
    basis: 'counts', estimated: true, trades: 6_900, wallets: null, sampled: null,
    coverage: { tradeSource: null, poolSource: 'geckoterminal', source: 'geckoterminal' }
  }));
  check('an estimated split is flagged on screen, never presented as exact',
    /(estimated|تخمینی)/.test(q('[data-testid="sm-token-evidence"]')?.textContent || '')
    && /(Pool trade counts|تعداد معاملات استخر)/.test(q('[data-testid="sm-token-basis"]')?.textContent || ''),
    q('[data-testid="sm-token-evidence"]')?.textContent);
  check('...and the wallet count shows «—» rather than a sample masquerading as 24h',
    (q('[data-testid="sm-token-wallets"]')?.textContent || '').trim() === '—',
    q('[data-testid="sm-token-wallets"]')?.textContent);
  await act(async () => { root.unmount(); });

  /* nothing measured → «—», never $0 */
  await mountCard(flowBody({
    dataStatus: 'unavailable', basis: 'none', estimated: false,
    buyUsd: null, sellUsd: null, netUsd: null, volumeUsd: null, trades: null, wallets: null,
    accumulation: null, distribution: null, sampled: null,
    coverage: { tradeSource: null, poolSource: null, source: 'none' }
  }));
  const tileValues = all('.sm-metric .val').slice(0, 3).map((el) => (el.textContent || '').trim());
  check('nothing measured → the three flow tiles read «—», never «$0»',
    tileValues.length === 3 && tileValues.every((v) => v === '—'), tileValues.join(' | '));
  check('...the reason is printed instead of a silent zero',
    Boolean(q('[data-testid="sm-token-no-flow-data"]')), text().slice(0, 160));
  check('...and the meters show no fabricated percentage',
    /—/.test(all('.sm-up, .sm-down').map((el) => el.textContent).join(' ')));
  await act(async () => { root.unmount(); });

  /* an older server response without smartMoneyFlow: no fallback to the
     token's fixed 24h pair statistics under a different window */
  await mountCard({ ...INTEL, smartMoneyFlow: null });
  const legacyTiles = all('.sm-metric .val').slice(0, 3).map((el) => (el.textContent || '').trim());
  check('no flow in the response → the tiles still read «—» (no pair-stat fallback)',
    legacyTiles.length === 3 && legacyTiles.every((v) => v === '—'), legacyTiles.join(' | '));
  await act(async () => { root.unmount(); });

  check('no React error was logged', errors.length === 0, errors.slice(0, 2).join(' | '));

  global.fetch = realFetch;
  console.error = realError;
  return rows;
}

export default run;
