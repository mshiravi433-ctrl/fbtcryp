/**
 * TOKEN SMART MONEY CARD — rendered, and connected to the token it claims.
 * ---------------------------------------------------------------------------
 * Reported, in order:
 *
 *   · «تبش خیلی دراز شده و از باکس زده بیرون» — the ۱ ساعت / ۴ ساعت / ۲۴ ساعت /
 *     هفته rail lived INSIDE the card's <h3>, sharing one flex line with the
 *     title. Four localised labels plus a title do not fit a phone-width row,
 *     so the rail overflowed the card padding and the last tab was clipped.
 *   · «ارتباط هوشمند مانی را با هر توکن بررسی کن ببین درسته» — the card showed
 *     eleven metrics with nothing on screen tying them to a token. A
 *     wrong-chain contract address is invisible in that layout: the meters
 *     still draw, they just describe another asset.
 *   · «بزار داخل باکس بازشونده تا صفحه شلوغیش کم بشه» — the card is now a
 *     disclosure: collapsed when embedded in the token page, open on its own
 *     route.
 *
 * All three are layout/wiring facts, which is exactly what a source grep cannot
 * prove — so the card is mounted here against a stubbed intel route and the
 * DOM is asked.
 */
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { MemoryRouter } from 'react-router-dom';
import '../src/i18n/index.js';
import TokenSmartMoney from '../src/components/TokenSmartMoney.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A REAL /api/v1/smart-money/token/:chain/:address body (schema
   fbt.smart-money-token.v1) — the symbol/name are what the server resolved
   FROM THE CONTRACT, which is the whole point of the identity line. */
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
  holders: { dataStatus: 'live', total: 1_204_880, top10Share: 21.4, whaleConcentration: 'LOW', exchangeSupplyPct: 8.2, top: [] },
  accumulation: { confidence: 62 },
  distribution: { confidence: 31 },
  risk: 'LOW',
  at: Date.now(),
  smartMoneyFlow: {
    schema: 'fbt.smart-money-tokensignals.v1',
    window: '24h',
    dataStatus: 'live',
    buyUsd: 640_000,
    sellUsd: 410_000,
    netUsd: 230_000,
    smartWallets: 14,
    accumulation: { confidence: 68 },
    distribution: { confidence: 27 },
    topBuyers: [{ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', usd: 90_000 }],
    topSellers: [{ address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', usd: 40_000 }]
  }
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

  /* the connection: what the SERVER read back for this contract */
  const identity = q('[data-testid="sm-token-identity"]');
  check('the card states which token the numbers belong to (symbol read back from the contract)',
    Boolean(identity) && /USDT/.test(identity.textContent || ''), identity?.textContent);
  check('...on which network, by name not chain id',
    /BNB/.test(identity?.textContent || ''), identity?.textContent);
  check('...and prints the exact contract it was asked about',
    /0x55d398326f99059ff775485246999027b3197955/i.test(identity?.textContent || ''), identity?.textContent);
  /* the chip is its own element — asserting on the joined textContent would
     match a digit inside the address and prove nothing. */
  const pairChip = all('.sm-token-chip.ghost')[0];
  check('...with the DEX pair count that produced them',
    Boolean(pairChip) && pairChip.textContent.trim().startsWith('9'), pairChip?.textContent);

  /* the rail: its own row, never inside the heading */
  const rail = q('[data-testid="sm-token-window-tabs"]');
  check('the window rail exists and is a tablist',
    Boolean(rail) && rail.getAttribute('role') === 'tablist');
  check('the window rail is NOT inside the <h3> any more (the overflow bug)',
    Boolean(rail) && !rail.closest('h3'), rail?.parentElement?.tagName);
  check('all four windows render with localised labels',
    all('[data-testid="sm-token-window-tabs"] button').length === 4
    && !/\b(1h|4h|24h|7d)\b/.test(rail?.textContent || ''), rail?.textContent);
  check('the rail is visible while collapsed, so a window can still be chosen',
    Boolean(rail));

  /* ── 2. expand, and the measured numbers appear ───────────────────────── */
  await act(async () => { toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await sleep(30); });
  check('the toggle expands the card in place', q('[data-testid="sm-token-toggle"]')?.getAttribute('aria-expanded') === 'true');
  check('expanded, the buying/selling/net tiles render the window-scoped flow',
    all('.sm-metric').length >= 3 && /\$230/.test(text()) && /\$640/.test(text()), text().slice(0, 200));
  check('the window the numbers describe is printed, not assumed',
    /24/.test(q('[data-testid="sm-token-window-note"]')?.textContent || ''), q('[data-testid="sm-token-window-note"]')?.textContent);

  /* ── 3. choosing a window really refetches ────────────────────────────── */
  requested.length = 0;
  const fourH = q('[data-testid="sm-token-window-4h"]');
  await act(async () => { fourH?.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await sleep(40); });
  check('choosing ۴ ساعت refetches the token intel for that window',
    requested.some((u) => /window=4h/.test(u)), requested.join(' | '));

  /* ── 4. the standalone route starts open ──────────────────────────────── */
  await act(async () => { root.unmount(); });
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
    requested.some((u) => /\/token\/solana\//.test(u)) || /\/token\/solana\//.test(requested.join(' | ')),
    requested.join(' | '));
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

  check('no React error was logged', errors.length === 0, errors.slice(0, 2).join(' | '));

  global.fetch = realFetch;
  console.error = realError;
  return rows;
}

export default run;
