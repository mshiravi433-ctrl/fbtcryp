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

  /* ── 7. receipts the server already sent finally render ───────────────── */
  const receipt = (over) => ({
    chain: 56, wallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', token: INTEL.address,
    symbol: 'USDT', side: 'BUY', valueUsd: 12_000, amount: 12_000, executionPriceUsd: 1,
    hash: `0x${'a'.repeat(64)}`, at: Date.now() - 5 * 60_000, qualified: true,
    realizedRoiPct: null, ...over
  });
  global.fetch = async () => {
    const body = {
      ...INTEL,
      verified: {
        dataStatus: 'observed', indexedAt: Date.now(), consensus: null,
        coverage: { analyzedWallets: 40, observedSwaps: 137 },
        observed: { chain: 56, token: INTEL.address, swaps: 2, wallets: 2, netFlowUsd: 4_000 },
        receipts: [
          receipt({}),
          receipt({ side: 'SELL', valueUsd: 8_000, wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', hash: `0x${'b'.repeat(64)}`, qualified: false }),
          /* a receipt for ANOTHER contract must never paint on this card */
          receipt({ token: '0x9999999999999999999999999999999999999999', hash: `0x${'c'.repeat(64)}` })
        ]
      }
    };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  container.innerHTML = '';
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <TokenSmartMoney chainId={56} address={INTEL.address} embedded={false} />
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(40); });
  const receiptBlock = q('[data-testid="sm-token-receipts"]');
  const receiptRows = all('[data-testid="sm-token-receipt"]');
  check('the paired-swap receipts in the response render on the card',
    Boolean(receiptBlock) && receiptRows.length === 2, `${receiptRows.length} rows`);
  /* Wording asserts are bilingual (fa|en) like §5's — the probe must say the
     same thing whichever language i18n resolves in the harness. */
  check('...with direction and USD amount per receipt (the foreign one dropped)',
    /\$12K/.test(receiptBlock?.textContent || '') && /\$8K/.test(receiptBlock?.textContent || '')
    && /(BUY|خرید)/.test(receiptRows[0]?.textContent || '') && /(SELL|فروش)/.test(receiptRows[1]?.textContent || ''),
    receiptBlock?.textContent);
  check('...each with a verifiable explorer proof and the wallet that swapped',
    all('[data-testid="sm-token-receipts"] .smi-proof').length === 2
    && /0xaaaa/i.test(receiptBlock?.textContent || ''), receiptBlock?.textContent);
  check('...still honestly labelled not-consensus while no verified row backs them',
    /(not consensus|نه اجماع)/.test(receiptBlock?.textContent || ''), receiptBlock?.textContent);
  await act(async () => { root.unmount(); });

  /* ── 8. no receipts sent: no block, and the plain insufficient stays ───── */
  global.fetch = async () => {
    const body = { ...INTEL, verified: { dataStatus: 'observed', indexedAt: Date.now(), consensus: null, observed: null, receipts: [] } };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  container.innerHTML = '';
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <TokenSmartMoney chainId={56} address={INTEL.address} embedded={false} />
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(40); });
  check('an empty receipts array renders no receipts block (nothing invented)',
    !q('[data-testid="sm-token-receipts"]'));
  check('a covered chain with a thin sample still gets the plain insufficient wording',
    /(No qualified wallet consensus|اجماع واجد شرایط ثبت نشده)/.test(q('[data-testid="sm-verified-token"]')?.textContent || ''),
    q('[data-testid="sm-verified-token"]')?.textContent);
  await act(async () => { root.unmount(); });

  /* ── 9. not-covered chain: its own sentence, never «insufficient» ──────── */
  global.fetch = async () => {
    const body = { ...INTEL, smartMoneyFlow: null, verified: { dataStatus: 'not-covered', consensus: null } };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
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
  const notCovered = q('[data-testid="sm-token-not-covered"]');
  check('a chain without verified coverage says exactly that',
    Boolean(notCovered) && /(has no verified coverage|پوشش تأییدشده ندارد)/.test(notCovered.textContent || '')
    && /Solana/.test(notCovered.textContent || ''), notCovered?.textContent);
  check('...and never borrows the generic insufficient wording',
    !/(No qualified wallet consensus|اجماع واجد شرایط ثبت نشده)/.test(q('[data-testid="sm-verified-token"]')?.textContent || ''));
  check('...including in the collapsed head summary',
    ['No verified coverage', 'بدون پوشش تأییدشده'].includes((q('.sm-token-head-summary')?.textContent || '').trim()),
    q('.sm-token-head-summary')?.textContent);
  check('...with no receipts block on an uncovered chain',
    !q('[data-testid="sm-token-receipts"]'));
  await act(async () => { root.unmount(); });

  /* ── 10. covered chain, failed verified read: «unread» ≠ «insufficient» ── */
  global.fetch = async () => {
    const body = { ...INTEL, verified: { dataStatus: 'unavailable', consensus: null } };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  container.innerHTML = '';
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <TokenSmartMoney chainId={56} address={INTEL.address} embedded={false} />
      </MemoryRouter>
    );
  });
  await act(async () => { await sleep(40); });
  const unavailable = q('[data-testid="sm-token-verified-unavailable"]');
  check('a failed verified read is reported as unread, in its own words',
    Boolean(unavailable) && /(could not be read this time|در این خواندن در دسترس نبود)/.test(unavailable.textContent || ''),
    unavailable?.textContent);
  check('...separately from the insufficient-evidence wording',
    !/(No qualified wallet consensus|اجماع واجد شرایط ثبت نشده)/.test(q('[data-testid="sm-verified-token"]')?.textContent || ''));
  await act(async () => { root.unmount(); });

  /* ═══════════════════════════════════════════════════════════════════════
   * 11–14. «داده‌ها صفرند و با تغییر زمان هم داده‌ای نشان نمی‌دهد»
   *
   * The flow block now carries the MEASUREMENT, not just numbers: which
   * source answered, how many real trades and wallets the sample holds, and
   * whether the split is exact or estimated. And when nothing was measured,
   * the tiles must show «—», never «$0».
   * ═══════════════════════════════════════════════════════════════════════ */
  const flowBody = (flowOver = {}, intelOver = {}) => ({
    ...INTEL,
    ...intelOver,
    verified: { dataStatus: 'observed', indexedAt: Date.now(), consensus: null, observed: null, receipts: [] },
    smartMoneyFlow: {
      schema: 'fbt.smart-money-tokensignals.v2',
      window: '24h',
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
      coverage: { tradeSource: 'geckoterminal', poolSource: 'geckoterminal', source: 'geckoterminal' },
      topBuyers: [{ address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', short: '0xaaaa…aaaa', usd: 90_000 }],
      topSellers: [{ address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', short: '0xbbbb…bbbb', usd: 40_000 }],
      ...flowOver
    }
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
  const evidence = q('[data-testid="sm-token-evidence"]');
  check('the flow block names the measurement (exact individual trades), not a bare number',
    Boolean(evidence) && /(Individual trades|معاملات واقعی)/.test(evidence.textContent || ''), evidence?.textContent);
  check('...with the real sample size (trades and distinct wallets)',
    /1,204/.test(evidence?.textContent || '') && /381/.test(evidence?.textContent || ''), evidence?.textContent);
  check('...and the upstream that answered', /GeckoTerminal/.test(evidence?.textContent || ''), evidence?.textContent);
  check('the wallet row counts wallets that actually traded this contract',
    /(Wallets trading|کیف‌پول)/.test(text()) && /381/.test(q('[data-testid="sm-token-wallets"]')?.textContent || ''),
    q('[data-testid="sm-token-wallets"]')?.textContent);
  check('top buyers and sellers are real wallets from the tape',
    all('.sm-row .mono').length >= 2 && /0xaaaa…aaaa/.test(text()) && /0xbbbb…bbbb/.test(text()));
  await act(async () => { root.unmount(); });

  /* estimated split (pool counts) */
  await mountCard(flowBody({
    basis: 'counts', estimated: true, trades: 6_900, wallets: null, sampled: null,
    coverage: { tradeSource: null, poolSource: 'geckoterminal', source: 'geckoterminal' }
  }));
  check('an estimated split is flagged on screen, never presented as exact',
    /(estimated|تخمینی)/.test(q('[data-testid="sm-token-evidence"]')?.textContent || '')
    && /(Pool trade counts|تعداد معاملات استخر)/.test(q('[data-testid="sm-token-basis"]')?.textContent || ''),
    q('[data-testid="sm-token-evidence"]')?.textContent);
  await act(async () => { root.unmount(); });

  /* nothing measured → «—», never $0 */
  await mountCard(flowBody({
    dataStatus: 'unavailable', basis: 'none', estimated: false,
    buyUsd: null, sellUsd: null, netUsd: null, volumeUsd: null, trades: null, wallets: null,
    accumulation: null, distribution: null, sampled: null, topBuyers: [], topSellers: [],
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

  /* the window actually changes what is drawn */
  const byWindow = (win) => flowBody(win === '1h'
    ? { window: '1h', buyUsd: 120_000, sellUsd: 65_000, netUsd: 55_000, trades: 210, wallets: 74 }
    : {});
  global.fetch = async (url) => {
    const win = /window=1h/.test(String(url)) ? '1h' : '24h';
    const body = byWindow(win);
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  container.innerHTML = '';
  root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter><TokenSmartMoney chainId={56} address={INTEL.address} embedded={false} /></MemoryRouter>);
  });
  await act(async () => { await sleep(40); });
  const beforeSwitch = text();
  await act(async () => {
    q('[data-testid="sm-token-window-1h"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => { await sleep(60); });
  const afterSwitch = text();
  check('switching ۲۴ ساعت → ۱ ساعت changes the drawn flow (the frozen-window complaint)',
    /\$230/.test(beforeSwitch) && /\$55/.test(afterSwitch) && beforeSwitch !== afterSwitch,
    `${beforeSwitch.match(/\$\d+/g)?.slice(0, 4)} → ${afterSwitch.match(/\$\d+/g)?.slice(0, 4)}`);
  check('...and the sample line follows the window',
    /210/.test(afterSwitch) && /74/.test(afterSwitch), afterSwitch.slice(0, 200));
  await act(async () => { root.unmount(); });

  check('no React error was logged', errors.length === 0, errors.slice(0, 2).join(' | '));

  global.fetch = realFetch;
  console.error = realError;
  return rows;
}

export default run;
