// @vitest-environment jsdom
/**
 * THE SOLANA TOKEN UNIVERSE AND THE MODERN TOKEN BOX.
 * ---------------------------------------------------------------------------
 *   «تعداد توکن ها کم است» and «باکس توکن بهتر که اسم توکن مشخص باشد …
 *   عرض و اندازه درست و ظاهر خیلی مدرن»
 *
 * Three claims are asserted, and each one is a different way this could have
 * gone wrong:
 *
 *   1. BREADTH — the screen offers a catalogue, and the catalogue survives a
 *      cold start (curated first, no network), a warm start (cache first, no
 *      network) and a refresh (merge, never replace).
 *   2. THE NAME IS SHOWN — on the BUTTON, not only in the picker. Solana
 *      tickers collide, so a bare ticker can render two different tokens as
 *      the same string; and a control that truncates the ticker to make room
 *      for the name has fixed the problem by removing the information.
 *   3. FAILURE COSTS BREADTH, NEVER CAPABILITY — a dead upstream leaves the
 *      curated list exactly as it was, and a pasted mint still works.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

const dict = { fa, en };
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: tFor('fa'), i18n: { language: 'fa', changeLanguage: () => {} } }) }));

import SolanaTokenChip from '../src/components/SolanaTokenChip.jsx';
import {
  loadSolanaUniverse, getSolanaUniverseSync, mergeSolanaUniverse, _resetSolanaUniverse
} from '../src/lib/solanaUniverse.js';

const CURATED = [
  { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', decimals: 9, decimalsVerified: true },
  { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', name: 'USD Coin', decimals: 6, decimalsVerified: true }
];

/* base58 excludes 0, O, I and l — so the fixture prefixes are chosen to pass
   the same pubkey shape check the real module enforces ('7' and 'K' are fine,
   '0' and 'i' are not). */
const fakeMint = (i) => `T${String(i).padStart(2, '7')}${'K'.repeat(40)}`;

/* Our endpoint answers in its own normalized shape (mint / verified /
   priceChange24h). One row below is deliberately in raw Jupiter shape. */
const upRow = (i) => ({
  mint: fakeMint(i),
  symbol: `TK${i}`,
  name: `Token ${i}`,
  icon: `https://img.example/${i}.png`,
  decimals: 6,
  verified: i % 2 === 0,
  usdPrice: 1 + i,
  liquidity: 5_000_000 - i * 1000,
  priceChange24h: i % 2 ? 3 : -2,
  volume24h: 100_000
});

let FETCHES = [];
let UNIVERSE_BODY = { rows: [] };

beforeEach(() => {
  _resetSolanaUniverse();
  FETCHES = [];
  UNIVERSE_BODY = { rows: [] };
  globalThis.fetch = vi.fn(async (url) => {
    FETCHES.push(String(url));
    if (String(url).includes('/solana/tokens')) {
      if (!UNIVERSE_BODY.rows.length) return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, json: async () => UNIVERSE_BODY };
    }
    return { ok: false, json: async () => ({}) };
  });
});

afterEach(() => cleanup());

describe('the solana token universe', () => {
  it('paints the curated list with no network at all', () => {
    /* The screen must be usable on the first frame, offline included. */
    const merged = mergeSolanaUniverse(CURATED, []);
    expect(merged.map((t) => t.symbol)).toEqual(['SOL', 'USDC']);
    expect(getSolanaUniverseSync()).toEqual([]);
  });

  it('merges the remote catalogue WITHOUT displacing a curated mint', async () => {
    /* Jupiter will happily list a row under a well-known mint with a hijacked
       ticker. The Stocks and gold screens hand off BY MINT, so a remote row
       must never become the identity of a curated asset. */
    UNIVERSE_BODY = { rows: [upRow(1), upRow(2), { ...upRow(3), mint: CURATED[0].mint, symbol: 'SOLSOLVED', name: 'SOLSOLVED' }] };
    const rows = await loadSolanaUniverse();
    expect(rows.map((r) => r.symbol)).toContain('SOLSOLVED');

    const merged = mergeSolanaUniverse(CURATED, rows);
    /* curated first, and the hijacked row for the same mint is dropped */
    expect(merged.map((t) => t.symbol)).toEqual(['SOL', 'USDC', 'TK1', 'TK2']);
    expect(merged.filter((t) => t.mint === CURATED[0].mint).length).toBe(1);
    expect(merged[0].name).toBe('Solana');
  });

  it('normalises a row and refuses one whose mint is not a pubkey', async () => {
    UNIVERSE_BODY = {
      rows: [
        { ...upRow(4), decimals: 9, verified: true, priceChange24h: 7 },
        { mint: 'not-a-mint', symbol: 'BAD', name: 'Bad' },
        { mint: fakeMint(99), name: 'No ticker' },
        { id: fakeMint(98), symbol: 'TJUP', name: 'Jupiter shape' }
      ]
    };
    const rows = await loadSolanaUniverse();
    const good = rows.find((r) => r.symbol === 'TK4');
    expect(good.decimals).toBe(9);
    expect(good.verified).toBe(true);
    expect(good.priceChange24h).toBe(7);
    /* a row with no shape is dropped, not rendered as a broken entry */
    expect(rows.some((r) => r.symbol === 'BAD')).toBe(false);
    expect(rows.some((r) => !r.symbol)).toBe(false);
    /* a shape change upstream costs rows, never the whole catalogue */
    expect(rows.find((r) => r.symbol === 'TJUP').mint).toBe(fakeMint(98));
  });

  it('serves the SECOND visit from cache with no request, and refreshes in the background', async () => {
    UNIVERSE_BODY = { rows: [upRow(1), upRow(2)] };
    const first = [];
    await loadSolanaUniverse((rows) => first.push(rows));
    expect(first.length).toBe(1);
    expect(FETCHES.length).toBe(1);
    expect(getSolanaUniverseSync().length).toBe(2);

    _resetSolanaUniverse(); /* clears memory but NOT the day's cache */
    const second = [];
    const rows = await loadSolanaUniverse((r) => second.push(r));
    /* painted from cache immediately, and a refresh still goes out */
    expect(second[0].length).toBe(2);
    expect(rows.length).toBe(2);
    expect(FETCHES.length).toBe(2);
  });

  it('loses BREADTH and nothing else when the upstream is down', async () => {
    UNIVERSE_BODY = { rows: [] }; /* → 502 */
    const seen = [];
    const rows = await loadSolanaUniverse((r) => seen.push(r));
    expect(rows).toEqual([]);
    expect(seen).toEqual([]);
    /* the curated list is still mergeable, and a pasted mint still works */
    expect(mergeSolanaUniverse(CURATED, rows).map((t) => t.symbol)).toEqual(['SOL', 'USDC']);
  });
});

describe('the solana token button', () => {
  it('shows the token NAME, not only a ticker', () => {
    render(
      <SolanaTokenChip
        token={{ ...CURATED[0], name: 'Wrapped SOL' }}
        onClick={() => {}}
        testId="chip"
      />
    );
    const chip = screen.getByTestId('chip');
    expect(chip.textContent).toContain('SOL');
    expect(chip.textContent).toContain('Wrapped SOL');
  });

  it('tells two same-ticker tokens apart, which a bare ticker cannot', () => {
    const a = render(<SolanaTokenChip token={{ mint: 'A', symbol: 'USDC', name: 'USD Coin' }} onClick={() => {}} testId="a" />);
    expect(screen.getByTestId('a').textContent).toContain('USD Coin');
    a.unmount();
    render(<SolanaTokenChip token={{ mint: 'B', symbol: 'USDC', name: 'USDC (wormhole)' }} onClick={() => {}} testId="b" />);
    expect(screen.getByTestId('b').textContent).toContain('wormhole');
  });

  it('labels the button for a token that has no name yet, and never renders empty', () => {
    render(<SolanaTokenChip token={{ mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', symbol: '' }} onClick={() => {}} testId="chip" />);
    const chip = screen.getByTestId('chip');
    expect(chip.textContent).toContain('7xKX');
    expect(chip.getAttribute('aria-label')).toBeTruthy();
  });

  it('keeps the trust mark visible after the picker closes', () => {
    render(
      <SolanaTokenChip
        token={{ ...CURATED[1], imported: true, verified: false }}
        onClick={() => {}}
        testId="chip"
      />
    );
    expect(screen.getByTestId('chip').textContent).toContain('!');
    const text = screen.getByTestId('chip').textContent;
    /* the mark is beside the ticker, so it is inside the control the user
       is looking at — not only in the list they came from */
    expect(text.indexOf('USDC')).toBeLessThan(text.indexOf('!'));
  });
});
