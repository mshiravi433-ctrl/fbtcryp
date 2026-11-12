/**
 * SMART MONEY — THE DESK, MOUNTED
 * ---------------------------------------------------------------------------
 * `smart-money-redesign-probe.mjs` reads the source; this one mounts the page
 * and asks the DOM. The difference matters because a page can be source-perfect
 * and still be broken in the hand:
 *
 *   · a glyph map with a missing component renders an empty tab;
 *   · a metric tile whose value is `undefined` renders the string "undefined";
 *   · the window rail can look right and never refetch;
 *   · a tab can mount an empty fragment (the whole screen goes blank);
 *   · a `<st.icon />`-style member expression is legal JSX and illegal at
 *     runtime — this is the only place that would notice.
 *
 * The fixtures below are the REAL /api/v1/smart-money response shapes from
 * server/smartMoney/index.js, so the assertions are about the page reading a
 * payload it will actually receive.
 *
 * Run through test/run.mjs, or:
 *   npx vite build -c test/vite.smartmoney.mjs && node test/smart-money-desk-probe.mjs
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { setLanguage } from '../src/i18n/index.js';
import fa from '../src/i18n/locales/fa.json';
import SmartMoney from '../src/pages/SmartMoney.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── fixtures ──────────────────────────────────────────────────────────── */
const NOW = Date.now();

const overview = (win) => ({
  schema: 'fbt.smart-money-overview.v2',
  at: NOW,
  window: win,
  dataStatus: 'live',
  streamStatus: 'live',
  partial: false,
  coverage: {
    events: 412, inWindow: 96, labelledInWindow: 61, priced: 402,
    observedEvents: 412, observedSince: NOW - 20 * 3600_000,
    windowCoverage: 0.72, comparable: true, note: 'observed while the scanner was running'
  },
  metrics: {
    whaleActivity: { value: 96, changePct: 12.4 },
    accumulation: { valueUsd: 8_400_000, changePct: 31.2, events: 44 },
    distribution: { valueUsd: 3_100_000, changePct: -18.6, events: 17 },
    exchangeInflow: { usd: 5_000_000, text: '$5.0M' },
    exchangeOutflow: { usd: 8_000_000, text: '$8.0M' },
    netFlow: { usd: 3_000_000, text: '$3.0M' },
    flowStatus: 'live',
    flowEvents: 61
  },
  flows: {
    schema: 'fbt.smart-money-flows.v1',
    dataStatus: 'live',
    observedExchanges: ['Binance', 'OKX'],
    note: 'Exchange flow from labelled transfers only.',
    windows: {
      '24h': {
        events: 61, inflowUsd: 5_000_000, outflowUsd: 8_000_000, netUsd: 3_000_000,
        coverage: 0.72, dataStatus: 'live',
        byExchange: [
          { exchange: 'Binance', inflowUsd: 3_000_000, outflowUsd: 5_000_000, netUsd: 2_000_000 },
          { exchange: 'OKX', inflowUsd: 2_000_000, outflowUsd: 3_000_000, netUsd: 1_000_000 }
        ]
      },
      '7d': {
        events: 180, inflowUsd: 21_000_000, outflowUsd: 14_000_000, netUsd: -7_000_000,
        coverage: 0.9, dataStatus: 'live', byExchange: []
      },
      '30d': {
        events: 0, inflowUsd: 0, outflowUsd: 0, netUsd: 0,
        coverage: 0.4, dataStatus: 'live', byExchange: []
      }
    }
  },
  /*
   * 940 ADMITTED, 2 VOTING. That gap is the round-9 bug: the hero pod used to
   * print «940 واجد شرایط» beside «2 اجماع» with nothing to explain it. The pod
   * now prints the voting count and names the wider admission number under it.
   */
  verified: {
    dataStatus: 'live',
    indexedAt: NOW,
    coverage: { analyzedWallets: 1840, classifiedWallets: 940, swapsInWindow: 5210 },
    counts: { qualified: 2, voting: 2, admitted: 940, analysed: 1840, consensusActive: 2, consensusRows: 2 },
    consensus: [
      { symbol: 'LINK', chain: 1, token: '0x514910771af9ca656af840dff83e8264ecf986ca', confidence: 82, swaps: 64 },
      { symbol: 'ARB', chain: 42161, token: '0x912ce59144191c1204e64559fe8253a0e49e6548', confidence: 71, swaps: 41 }
    ]
  },
  tokenActivity: [
    {
      symbol: 'LINK', name: 'Chainlink', chainShort: 'ETH', chainId: 1,
      address: '0x514910771af9ca656af840dff83e8264ecf986ca',
      buy: 4_000_000, sell: 1_200_000, cexIn: 200_000, cexOut: 900_000,
      totalUsd: 6_300_000, netUsd: 3_500_000, events: 22, labelledEvents: 19,
      wallets: 31, accumulation: 78, distribution: 14, signal: 'ACCUMULATION'
    },
    {
      symbol: 'PEPE', name: 'Pepe', chainShort: 'ETH', chainId: 1,
      address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
      buy: 100_000, sell: 900_000, cexIn: 600_000, cexOut: 20_000,
      totalUsd: 1_620_000, netUsd: -1_480_000, events: 12, labelledEvents: 10,
      wallets: 14, accumulation: 12, distribution: 81, signal: 'DISTRIBUTION'
    }
  ],
  earlyTokens: {
    tokens: [{
      symbol: 'WIF2', name: 'dogwif2', chain: 'solana', dex: 'raydium',
      address: '8mBxExampleMint1111111111111111111111111111',
      ageHours: 7, liquidityUsd: 480_000, volumeH24: 1_900_000, fdvUsd: 3_400_000,
      risk: 'MEDIUM'
    }]
  },
  /*
   * THREE rows, deliberately, because the read and the grid used to disagree:
   *   · `0x9f2c` — 37 activity, OVER the server ceiling (25), so it is NOT
   *     verified-fresh and must not get a card;
   *   · `0x4a7e` — young, funded, movement seen an hour ago → must score and
   *     must read «early»;
   *   · `0xb31d` — young-looking on the wire but NO `firstSeen`, so the
   *     earlyness engine has no timing evidence and must refuse a score rather
   *     than invent one.
   */
  freshWallets: {
    wallets: [
      {
        short: '0x9f2c…41ab', address: '0x9f2c1a2b3c4d5e6f708192a3b4c5d6e7f80941ab',
        chainId: 8453, chainShort: 'BASE', chainColor: '#0052ff',
        capitalUsd: 1_240_000, receivedUsd: 1_200_000, txCount: 31, tokenTransfersCount: 6,
        firstSeen: Date.now() - 3 * 3600_000, interesting: true
      },
      {
        short: '0x4a7e…9c22', address: '0x4a7e55aa11bb22cc33dd44ee55ff66aa77bb9c22',
        chainId: 1, chainShort: 'ETH', chainColor: '#627eea',
        capitalUsd: 860_000, receivedUsd: 860_000, txCount: 4, tokenTransfersCount: 1,
        firstSeen: Date.now() - 1 * 3600_000, interesting: true
      },
      {
        short: '0xb31d…7f05', address: '0xb31d09ff88ee77dd66cc55bb44aa33ff22117f05',
        chainId: 1, chainShort: 'ETH', chainColor: '#627eea',
        capitalUsd: 410_000, receivedUsd: 380_000, txCount: 7, tokenTransfersCount: 2,
        firstSeen: null, interesting: false
      }
    ],
    note: 'Wallets first observed in the last 24 hours.'
  },
  liquidityEvents: {
    events: [{
      id: 'lp-1', symbols: 'ETH/USDC', chainShort: 'ETH', dex: 'uniswap',
      kind: 'LP_ADDED', liquidityUsd: 2_400_000, impact: 'LOW',
      explorerTx: 'https://etherscan.io/tx/0xabc'
    }]
  }
});

/*
 * The Solana whale feed, as the route answers it. Two readings are made from
 * this ONE payload on the whales tab: `readSolanaWhales` (where the SOL went)
 * and `readSolanaWallets` (which wallets moved it). The desk probe used to let
 * this route fall through to `{}`, which is why the two Solana surfaces could
 * mount with nothing to show and no assertion noticed.
 */
const solanaWhales = {
  available: true,
  floorSol: 500,
  solPrice: 150,
  vs: 'usd',
  updatedAt: '2026-11-12T10:00:00.000Z',
  coverage: {
    sources: ['rpc-block-sample'],
    sampleReused: true,
    sampleMs: 20 * 60_000,
    blocksPerRefresh: 1,
    lastSample: { slot: 321, at: '2026-11-12T10:00:00.000Z' }
  },
  transfers: [
    { id: 'a1', sol: 12_000, from: 'So1WhaleA11111111111111111111111111111111', to: 'Krak', toLabel: 'Kraken', at: Date.now() - 40_000, signature: 's1' },
    { id: 'a2', sol: 9_000, from: 'So1WhaleA11111111111111111111111111111111', to: 'Krak', toLabel: 'Kraken', at: Date.now() - 30_000, signature: 's2' },
    { id: 'b1', sol: 8_000, from: 'Bin', fromLabel: 'Binance', to: 'So1WhaleB22222222222222222222222222222222', at: Date.now() - 20_000, signature: 's3' }
  ]
};

const whales = {
  wallets: [
    {
      address: '0x9f2c1a2b3c4d5e6f708192a3b4c5d6e7f80941ab', short: '0x9f2c…41ab',
      chainId: 8453, chainShort: 'BASE', chainColor: '#0052ff',
      movedUsd: 12_400_000, netUsd: 9_100_000, lastAction: 'bought LINK on uniswap',
      riskBand: 'MEDIUM'
    },
    {
      address: '0x1111111111111111111111111111111111111111', short: '0x1111…1111',
      chainId: 1, chainShort: 'ETH', chainColor: '#627eea',
      movedUsd: 5_600_000, netUsd: -4_200_000, lastAction: 'sent to Binance',
      riskBand: 'HIGH'
    }
  ],
  note: 'Ranked by transferred value, not by verified profitability.'
};

const exchanges = {
  schema: 'fbt.smart-money-exchanges.v1',
  exchanges: ['Binance', 'OKX', 'Coinbase'],
  note: 'Exchange addresses come from a fixed, public registry.'
};

const intelligence = {
  schema: 'fbt.smart-money-intelligence.v1',
  dataStatus: 'live',
  indexedAt: NOW,
  coverage: { analyzedWallets: 1840, classifiedWallets: 940, swapsInWindow: 5210, observedSwaps: 400 },
  consensus: [],
  wallets: [],
  breadth: { accumulation: 12, distribution: 7, neutral: 24 },
  graph: { nodes: [], edges: [] }
};

/*
 * TWO VERIFIED WALLETS, deliberately different in EVIDENCE and not in outcome:
 *   · `0x1111…` scored 95 off FIVE closes in a single session — the lucky-but-
 *     thin row the board used to print first;
 *   · `0x2222…` scored 78 off FORTY closes over six months — the measured row.
 * If the board ever sorts on the raw score again, the thin wallet comes first
 * and the probe says so.
 */
const verifiedWallets = {
  dataStatus: 'observed',
  indexedAt: Date.now() - 120_000,
  leaderboardBasis: 'raw-verified-score; clients must re-rank by sample evidence before display',
  wallets: [
    {
      chain: 1, address: `0x${'1'.repeat(40)}`, label: 'thin-lucky', score: 95,
      coverage: 0.63, measuredCoverage: 0.7, closedTrades: 5, realizedUsd: 40_000, winRate: 80,
      qualified: true, updatedAt: Date.now() - 60_000,
      sample: { swaps: 10, closedTrades: 5, observedDays: 0.4, historyTruncated: false },
      factors: { profitability: 0.9, winRate: 0.8, earlyEntryAccuracy: null, exitTiming: null,
        consistency: 0.5, capitalEfficiency: 0.6, riskAdjustedPerformance: null }
    },
    {
      chain: 1, address: `0x${'2'.repeat(40)}`, label: 'deep-measured', score: 78,
      coverage: 1, measuredCoverage: 1, closedTrades: 40, realizedUsd: 900_000, winRate: 62,
      qualified: true, updatedAt: Date.now() - 60_000,
      sample: { swaps: 120, closedTrades: 40, observedDays: 180, historyTruncated: false },
      factors: { profitability: 0.7, winRate: 0.62, earlyEntryAccuracy: 0.5, exitTiming: 0.4,
        consistency: 0.8, capitalEfficiency: 0.75, riskAdjustedPerformance: 0.6 }
    }
  ],
  candidates: [{ chain: 1, address: `0x${'3'.repeat(40)}`, label: 'not-yet', score: 40,
    closedTrades: 2, winRate: 30, swaps: 3, status: 'INSUFFICIENT_EVIDENCE', qualified: false,
    sample: { swaps: 3, closedTrades: 2, observedDays: 0.5 } }],
  coverage: { analyzedWallets: 10, classifiedWallets: 2, observedSwaps: 130 }
};

const alerts = {
  alerts: [{
    id: 'a1', type: 'CONSENSUS_FORMED', at: NOW - 600_000,
    title: 'اجماع تأییدشده روی LINK',
    message: 'پنج کیف‌پول واجد شرایط در ۲۴ ساعت گذشته خرید کردند.',
    chain: 1, address: '0x514910771af9ca656af840dff83e8264ecf986ca', target: 'token'
  }]
};

const calls = [];
function json(body) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body, text: async () => '' });
}

function installFetch() {
  global.fetch = (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/overview?')) return json(overview(/window=([^&]+)/.exec(u)?.[1] || '24h'));
    if (u.includes('/solana/track/whales')) return json(solanaWhales);
    if (u.includes('/whales?')) return json(whales);
    if (u.includes('/flows')) return json(overview('24h').flows);
    if (u.includes('/liquidity')) return json(overview('24h').liquidityEvents);
    if (u.includes('/exchanges')) return json(exchanges);
    if (u.includes('/early-tokens')) return json(overview('24h').earlyTokens);
    if (u.includes('/fresh-wallets')) return json(overview('24h').freshWallets);
    if (u.includes('/intelligence')) return json(intelligence);
    if (u.includes('/wallets/verified')) return json(verifiedWallets);
    if (u.includes('/alerts')) return json(alerts);
    return json({});
  };
}

/* ── the run ───────────────────────────────────────────────────────────── */
export async function run(container) {
  const rows = [];
  const t = (name, cond, detail) => rows.push([name, !!cond, detail]);
  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); };

  await setLanguage('fa');
  localStorage.clear();
  /* an identity so the alerts tab asks the server (see pushIdentity) */
  localStorage.setItem('fbt-fcm-token', 'probe-token');
  calls.length = 0;
  installFetch();

  const App = () => (
    <MemoryRouter initialEntries={['/smart-money']}>
      <Routes>
        <Route path="/smart-money" element={<SmartMoney />} />
        <Route path="/smart-money/token/:chain/:address" element={<div>token page</div>} />
        <Route path="/smart-money/wallet/:chain/:address" element={<div>wallet page</div>} />
      </Routes>
    </MemoryRouter>
  );

  const root = createRoot(container);
  await act(async () => { root.render(<App />); });
  await act(async () => { await sleep(60); });

  const q = (sel) => container.querySelector(sel);
  /* A missing element is a failed assertion, never a thrown TypeError — the
     suite must report every check, not stop at the first missing node. */
  const click = async (el, wait = 50) => {
    if (!el) return false;
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(wait);
    });
    return true;
  };
  const qa = (sel) => [...container.querySelectorAll(sel)];
  const text = () => container.textContent || '';

  /* 1 · the hero is the new one, in Persian, and it is not a wall of text */
  t('the desk renders its hero', !!q('.smx-hero') && !!q('.smx-hero-title'));
  t('the hero title is the Persian page title',
    (q('.smx-hero-title')?.textContent || '').trim() === fa.sm.title,
    q('.smx-hero-title')?.textContent);
  t('the hero carries a live chip, the omnibox and three engine pods',
    !!q('.smx-live') && !!q('.smx-search input') && qa('.smx-pod').length === 3);
  t('the hero subtitle keeps its bold keywords (tagline HTML, not escaped)',
    qa('.smx-hero-sub b').length >= 3);

  /* 2 · the dock: seven glyph tabs, all reachable in one row */
  const dock = qa('.smx-dock-btn');
  t('the dock shows all seven tabs at once (no off-screen scrolling)',
    dock.length === 7 && q('.smx-dock')?.getAttribute('role') === 'tablist');
  t('every dock tab paints a glyph, not an emoji',
    dock.every((b) => !!b.querySelector('svg')) && !/\p{Extended_Pictographic}/u.test(text()));
  t('the tab labels are the translated Persian strings',
    ['overview', 'intelligence', 'whales', 'wallets', 'tokens', 'flows', 'alerts']
      .every((id, i) => (dock[i]?.textContent || '') === fa.sm.tabs[id]),
    'labels: ' + dock.map((b) => b.textContent).join(' | '));

  /* 3 · metric tiles */
  const metrics = qa('.smx-metric');
  t('three signal tiles render', metrics.length === 3);
  t('the whale-activity tile prints the count it was given',
    /96/.test(metrics[0]?.textContent || ''));
  t('accumulation and distribution print formatted money, not raw integers',
    /\$8\.4M|\$8,400,000/.test(metrics[1]?.textContent || '')
    && /\$3\.1M|\$3,100,000/.test(metrics[2]?.textContent || ''));
  t('a comparison arrow is rendered when changePct exists',
    qa('.smx-delta').length >= 2);
  t('no tile prints "undefined" or "NaN"', !/undefined|NaN/.test(text()));

  /* 4 · the window rail refetches, persists and mirrors the URL */
  const rail = q('[data-testid="sm-window-tabs"]');
  const railButtons = qa('[data-testid="sm-window-tabs"] [role="tab"]');
  t('the window rail is a tablist of three translated buttons',
    !!rail && railButtons.length === 3
    && ['24h', '7d', '30d'].every((w, i) => (railButtons[i]?.textContent || '') === fa.sm.windows[w]), 
    railButtons.map((b) => b.textContent).join(' | '));
  t('the current window is announced, not just coloured',
    railButtons[0]?.getAttribute('aria-selected') === 'true'
    && railButtons[1]?.getAttribute('aria-selected') === 'false');
  calls.length = 0;
  await click(railButtons[1], 40);
  t('choosing «۷ روز» asks the server for window=7d',
    calls.some((u) => u.includes('/overview?window=7d')));
  t('…and the new window is the selected tab',
    q('[data-testid="sm-window-7d"]')?.getAttribute('aria-selected') === 'true');
  t('…and the choice survives a reload (localStorage)',
    localStorage.getItem('fbt.sm.window.v1') === '7d');

  /* 5 · honest coverage */
  t('a partly-covered window says so with its real percentage',
    /72/.test(q('[data-testid="sm-window-coverage"]')?.textContent || ''));
  t('the observation basis is printed next to the numbers',
    !!q('[data-testid="sm-coverage"]'));

  /* 6 · the flow card */
  t('the flow card splits inflow/outflow into named numbers',
    qa('.smx-flow-nums > div').length === 2 && /\$\d/.test(text()));
  t('the split bar and its legend agree with those numbers',
    !!q('.smx-flowbar') && qa('.smx-flow-legend span').length === 2);

  /* 7 · token activity rows carry a signal pill, never a colour-only code */
  const rowsEls = qa('.smx-rows .smx-row');
  t('token activity renders rows', rowsEls.length >= 2);
  t('an accumulation row names the signal in Persian words',
    (rowsEls[0]?.textContent || '').includes(fa.sm.signal.ACCUMULATION),
    rowsEls[0]?.textContent);

  /* 8 · a tab switch actually changes the screen */
  const whalesTab = dock.find((b) => b.textContent === fa.sm.tabs.whales);
  t('the whales tab is reachable by its Persian name', await click(whalesTab, 70));
  t('the whales tab mounts its own card list',
    qa('.smx-whale').length === whales.wallets.length,
    'count: ' + qa('.smx-whale').length + ' / html: ' + (q('.smx-whale-grid') ? 'grid' : 'no grid'));
  t('all three risk bands are counted, including a band with no wallet',
    qa('.smx-chips .smx-risk').length === 3);
  t('a whale row prints the address, the chain and the band',
    /0x9f2c/.test(text()) && /BASE/.test(text()));

  /* 8b · the SOLANA half of the whale tab: where the SOL went, and WHO moved it.
     Both readings come from the one mocked payload above, which is the point —
     the tab must not fetch the chain twice to show two views of it. */
  t('the whales tab shows the Solana chain read',
    !!q('[data-testid="sm-solana-whales"]'));
  t('and the Solana WALLET list, from the same payload',
    !!q('[data-testid="sm-solana-wallets"]'));
  t('the wallet list ranks the wallets that moved, not the venues',
    qa('.smx-solwal-row').length === 2,
    'rows: ' + qa('.smx-solwal-row').length);
  t('a Solana wallet row prints its moved amount and its lean',
    /SOL/.test(q('[data-testid="sm-solana-wallets"]')?.textContent || '')
    && !!q('.smx-solwal-lean'));
  t('the sample is stated, so the rank reads as "in this window"',
    /321/.test(q('[data-testid="sm-solana-wallets"]')?.textContent || ''));
  const solCalls = calls.filter((u) => u.includes('/solana/track/whales'));
  t('the Solana feed is fetched ONCE for both readings',
    solCalls.length === 1, 'calls: ' + solCalls.length);
  t('a Solana wallet row opens that wallet, not the EVM page',
    !!q('.smx-solwal-hit'));

  /* 9 · the flows tab has its own rail, and it drives the same window */
  const flowsTab = dock.find((b) => b.textContent === fa.sm.tabs.flows);
  t('the flows tab is reachable by its Persian name', await click(flowsTab, 70));
  t('the flows tab mounts the exchange-flow card',
    !!q('.smx-flowtab') && !!q('[data-testid="sm-flows-window-tabs"]'));
  const flowsRail = qa('[data-testid="sm-flows-window-tabs"] [role="tab"]');
  await click(flowsRail[0], 60);
  t('the flows card shows per-exchange splits for a window that has them',
    qa('.smx-ex').length === 2, 'count: ' + qa('.smx-ex').length);
  calls.length = 0;
  await click(flowsRail[2], 60);
  t('the flows rail moves the page window too (one source of truth)',
    calls.some((u) => u.includes('/overview?window=30d')));

  /* 10 · an empty window prints «—», not a fabricated zero */
  t('a window with zero events prints an honest empty line, not a 0/0 bar',
    !!q('.smx-inline-empty'));

  /* 11 · alerts link to the thing they are about */
  const alertsTab = dock.find((b) => b.textContent === fa.sm.tabs.alerts);
  t('the alerts tab is reachable by its Persian name', await click(alertsTab, 70));
  const alertRow = q('.smx-alert');
  t('an alert renders with a glyph and a timestamp',
    !!alertRow && !!alertRow.querySelector('svg'));
  t('the alert is a live link, not a dead row (it has a route target)',
    alertRow?.disabled === false);
  t('the alert text is the server text, not a fabricated sentence',
    /LINK/.test(alertRow?.textContent || ''));

  /* 12 · intelligence mounts on the same desk */
  const intelTab = dock.find((b) => b.textContent === fa.sm.tabs.intelligence);
  t('the intelligence tab is reachable by its Persian name', await click(intelTab, 90));
  t('the verified-intelligence tab mounts its workspace',
    !!q('.smi-workspace') && !!q('.smi-hero'));
  t('its section heads carry glyph tiles', qa('.smi-head-ico').length >= 3);

  /* 13 · the fresh-wallet READ drives the grid (round 7)
     The whole point: `freshRead` used to be computed and then ignored, so the
     grid rendered rows the read had thrown out. These assertions fail loudly if
     that ever comes back. */
  const tokensTab2 = dock.find((b) => b.textContent === fa.sm.tabs.tokens);
  await click(tokensTab2, 90);
  const freshCards = [...qa('.smx-fresh')];
  t('the fresh grid renders the read\'s rows, not the raw payload',
    freshCards.length === 2, `cards=${freshCards.length} (expected 2 of 3: 37-activity row is over the ceiling)`);
  t('the over-ceiling wallet gets no card at all',
    !freshCards.some((c) => /9f2c/.test(c.textContent)));
  t('the verified-fresh count in the summary equals the number of cards',
    (q('[data-testid="sm-fresh-read"]')?.textContent || '').includes(String(freshCards.length)),
    q('[data-testid="sm-fresh-read"]')?.textContent || '(no summary)');
  t('the summary states how many are still EARLY',
    !!q('[data-testid="sm-fresh-early"]'));
  t('an early card prints a measured score, not the old "Smart" badge',
    freshCards.some((c) => /۹?\d+/.test(c.textContent) && !/Smart/.test(c.textContent)));
  t('a card with no timing evidence says «not measured» instead of scoring',
    (() => {
      const c = freshCards.find((x) => /b31d/.test(x.textContent));
      return !!c && new RegExp(fa.sm.earlyLabelUnmeasured).test(c.textContent);
    })(), freshCards.map((c) => c.textContent).join(' | '));

  /* 14 · the watchlist digest says something, and says «not read» honestly */
  const alertsTab2 = dock.find((b) => b.textContent === fa.sm.tabs.alerts);
  await click(alertsTab2, 90);
  t('with no tracked wallets the digest renders nothing (no empty chrome)',
    !q('[data-testid="sm-watch-digest"]'));
  act(() => {
    localStorage.setItem('fbt-smart-money-watch-v1', JSON.stringify([
      { id: '1:0xaaa', chain: 1, address: '0xaaa', label: 'eth-a', target: 'wallet', createdAt: Date.now() - 7200_000, baseline: null },
      { id: '1:0xbbb', chain: 1, address: '0xbbb', label: 'eth-b', target: 'wallet', createdAt: Date.now() - 3600_000, baseline: { at: Date.now() - 3600_000, portfolioUsd: 100_000 } }
    ]));
  });
  await click(dock.find((b) => b.textContent === fa.sm.tabs.overview), 40);
  await click(alertsTab2, 120);
  const digest = q('[data-testid="sm-watch-digest"]');
  t('tracked wallets surface as a digest on the alerts tab', !!digest);
  /* Built from the locale itself: a hand-copied Persian string with the wrong
     zero-width-joiner silently never matches, and a probe that can't fail on
     the thing it tests is worse than no probe. */
  t('the digest counts rows it has never read as «not read», never as «۰ تغییر»',
    (digest?.textContent || '').includes(fa.sm.watchDigestPending.replace('{{n}}', '2')),
    digest?.textContent);
  t('a row with no baseline is never reported as «unchanged»',
    !/بدون تغییر/.test(digest?.textContent || ''));
  t('the digest offers exactly one way to read them, capped, not eight fetches on mount',
    qa('[data-testid="sm-watch-digest"] .smx-chip--act').length === 1);

  /* 15 · the verified board weighs each score (round 8)
     The board that carries `SmartMoneyIntelligence` is the WALLETS tab, not the
     intelligence tab — the probe went to the wrong one first and reported
     «cards=0», which is exactly the sort of assertion that fails for the right
     reason and gets «fixed» for the wrong one. */
  const walletsTab = dock.find((b) => b.textContent === fa.sm.tabs.wallets);
  await click(walletsTab, 160);
  const cards = qa('.smi-wallet-card');
  t('the verified board renders the wallets the index actually holds',
    cards.length === 2, `cards=${cards.length}`);
  t('the board leads with MEASURED evidence, not with the highest raw score',
    /deep-measured/.test(cards[0]?.textContent || ''),
    cards.map((c) => (c.textContent || '').slice(0, 40)).join(' | '));
  const badges = qa('[data-testid="sm-evidence-badge"]');
  /* Asserted as a SET, not by index: the point is that both verdicts appear,
     and pinning them to positions would re-break the moment the sort changes —
     which is the very thing the assertion above is meant to protect. */
  t('every card states the strength of its own sample',
    badges.length === 2
    && badges.some((b) => new RegExp(fa.sm.engine.evidenceVerdict.thin).test(b.textContent))
    && badges.some((b) => new RegExp(fa.sm.engine.evidenceVerdict.strong).test(b.textContent)),
    badges.map((b) => b.textContent).join(' | '));
  t('the thin card prints its ADJUSTED score, with the raw one still visible',
    /(raw|خام)/.test(cards[1]?.textContent || '') || /(raw|خام)/.test(cards[0]?.textContent || ''),
    cards[1]?.textContent?.slice(0, 80));
  const boardLine = q('[data-testid="sm-evidence-board"]');
  t('the board states its mean evidence above the cards', !!boardLine);
  t('and how many of its wallets rest on an established sample',
    new RegExp(fa.sm.engine.evidenceEstablished.replace('{{n}}', '1').replace('{{total}}', '2')).test(boardLine?.textContent || ''),
    boardLine?.textContent);
  t('and that one of them is too thin to judge yet',
    new RegExp(fa.sm.engine.evidenceThin.replace('{{n}}', '1')).test(boardLine?.textContent || ''));
  const cands = qa('.smi-candidate-box');
  t('an unqualified wallet names its FIRST binding gate, not a generic status',
    cands.length === 1 && new RegExp(fa.sm.engine.gap.closes.replace('{{have}}', '2').replace('{{need}}', '5'))
      .test(cands[0].textContent || ''), cands[0]?.textContent);

  /* 16 · the two hero pods can no longer contradict each other (round 9) */
  const overviewTab = dock.find((b) => b.textContent === fa.sm.tabs.overview);
  await click(overviewTab, 120);
  const qPod = q('[data-testid="sm-pod-qualified"]');
  const cPod = q('[data-testid="sm-pod-consensus"]');
  t('the «qualified» pod counts the wallets whose evidence earns a VOTE',
    /۲|2/.test(qPod?.querySelector('b')?.textContent || ''), qPod?.textContent);
  t('and it says how many merely cleared admission, so the gap is explained',
    !!q('[data-testid="sm-pod-admitted"]'), qPod?.textContent);
  t('the consensus pod is consistent with that count, not contradicted by it',
    (cPod?.querySelector('b')?.textContent || '') === (qPod?.querySelector('b')?.textContent || ''),
    `${qPod?.querySelector('b')?.textContent} vs ${cPod?.querySelector('b')?.textContent}`);

  /* 17 · no runtime noise */
  const realErrors = errors.filter((e) => !/not wrapped in act|React Router Future Flag|ReactDOMTestUtils\.act/.test(e));
  t('no React error was logged during any of that',
    realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  await act(async () => { root.unmount(); });
  console.error = origError;
  return rows;
}

export default run;
