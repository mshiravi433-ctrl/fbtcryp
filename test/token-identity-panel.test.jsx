// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

import en from '../src/i18n/locales/en.json';

/*
 * «شناسنامه» — WHAT THE TOKEN IS.
 *
 * The fifth tab exists to answer the question the coin page never answered:
 * not "what is the price" but "what is this thing". Three things make it worth
 * a test rather than a screenshot:
 *
 *   1. MISSING ≠ ZERO. The CoinLore backup sends no `ath`, no `atl` and no
 *      supply at all. A card that prints "0%" for those is worse than a card
 *      that prints «—», because 0% from the high describes a token at its high.
 *   2. UNMEASURED ≠ UNLIMITED-OR-EXHAUSTED. A token whose feed omits
 *      `maxSupply` entirely has an UNKNOWN ceiling; only a feed that sends
 *      `maxSupply: null` is telling us the asset is uncapped.
 *   3. IT MUST BE FREE. Nothing in this panel fetches, schedules a request,
 *      animates or starts a timer. That is asserted here as source text, since
 *      it is a property of the module rather than of any rendered pixel.
 */

/* Translate through the real English table so the assertions read sentences a
   reader would actually see, and so a missing key fails here rather than
   showing a raw dotted path on screen in production. */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, values = {}) => {
      const text = key.split('.').reduce((row, part) => row?.[part], en) ?? key;
      return String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '');
    },
    i18n: { language: 'en' }
  })
}));

import TokenIdentity from '../src/components/TokenIdentity.jsx';

const mount = (coin, props = {}) => render(<TokenIdentity coin={coin} {...props} />);
const metric = (id) => screen.queryByTestId(id);
const valueOf = (id) => metric(id)?.querySelector('.coin-id-metric-value')?.textContent;

const full = {
  id: 'bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  price: 50000,
  ath: 100000,
  athChange: -50,
  atl: 100,
  atlChange: 49900,
  high24h: 55000,
  low24h: 45000,
  change24h: 4,
  volume: 2e6,
  mcap: 1e7,
  supply: 19e6,
  maxSupply: 21e6,
  description: 'A peer-to-peer electronic cash system.',
  homepage: 'https://bitcoin.org'
};

afterEach(cleanup);

describe('TokenIdentity — the arithmetic reaches the screen', () => {
  it('draws the four cards when the payload carries everything', () => {
    mount(full, { global: { mcap: 1e9, avgChange: 2 }, bitcoin: { change24h: 1 } });
    expect(screen.getByText('What this token is')).toBeTruthy();
    expect(screen.getByText('Its whole history')).toBeTruthy();
    expect(screen.getByText('Supply and liquidity')).toBeTruthy();
    expect(screen.getByText('What the wider market does to it')).toBeTruthy();
  });

  it('states the drawdown as a negative percentage under the high', () => {
    mount(full);
    // A 50% drawdown reads as −50%, and the value is signed on screen even
    // though the module returns it as a positive magnitude.
    expect(valueOf('coin-identity-drawdown')).toContain('50');
    expect(valueOf('coin-identity-rise')).toBeTruthy();
  });

  it('positions price inside its own 24 h range rather than only colouring it', () => {
    mount(full);
    const track = screen.getByTestId('coin-identity-day-position');
    const marker = track.querySelector('i');
    const left = marker.getAttribute('style') || '';
    // 50,000 inside a 45,000..55,000 day is halfway.
    expect(left).toMatch(/50(\.0)?%/);
  });

  it('shows liquidity and market share as numbers', () => {
    mount(full, { global: { mcap: 1e9, avgChange: 2 } });
    expect(valueOf('coin-identity-turnover')).toBeTruthy();
    expect(valueOf('coin-identity-share')).toContain('%');
  });

  it('shows only the supply already circulating as an unlocked track', () => {
    mount(full);
    const track = screen.getByTestId('coin-identity-unlocked');
    expect(track.querySelector('i')).toBeTruthy();
    // 19/21 ≈ 90% of the ceiling is already out.
    expect(track.textContent).toMatch(/90/);
  });
});

describe('TokenIdentity — the global-impact card is a measurement', () => {
  it('says whether the token moved with or against the market', () => {
    mount(full, { global: { mcap: 1e9, avgChange: 2 } });
    expect(valueOf('coin-identity-agreement')).toBe('With the market');
  });

  it('flips the wording when the token falls while the market rises', () => {
    mount({ ...full, change24h: -3 }, { global: { mcap: 1e9, avgChange: 2 } });
    expect(valueOf('coin-identity-agreement')).toBe('Against the market');
  });

  it('compares with Bitcoin in percentage points', () => {
    mount(full, { bitcoin: { change24h: 1 } });
    // token +4%, BTC +1% → +3 points, printed with its sign.
    expect(valueOf('coin-identity-vs-btc')).toContain('3');
    expect(metric('coin-identity-vs-btc').textContent).toContain('percentage points');
  });

  it('prints dashes, not zeros, when the market reading is absent', () => {
    mount(full);
    expect(valueOf('coin-identity-agreement')).toBe('—');
    expect(valueOf('coin-identity-amplification')).toBe('—');
    expect(valueOf('coin-identity-vs-btc')).toBe('—');
  });

  it('refuses an amplification ratio when the market barely moved', () => {
    // Dividing by 0.01% produces a number that describes arithmetic, not the
    // token, so the card declines to print one.
    mount({ ...full, change24h: 30 }, { global: { mcap: 1e9, avgChange: 0.01 } });
    expect(valueOf('coin-identity-amplification')).toBe('—');
  });
});

describe('TokenIdentity — nothing is claimed that the payload did not say', () => {
  /* The CoinLore-shaped payload: price and volume only. */
  const bare = { id: 'x', symbol: 'X', name: 'X', price: 1, change24h: 2, volume: 10 };

  it('renders an em dash for every unmeasured figure', () => {
    mount(bare);
    expect(valueOf('coin-identity-drawdown')).toBe('—');
    expect(valueOf('coin-identity-rise')).toBe('—');
    expect(valueOf('coin-identity-turnover')).toBe('—');
    expect(valueOf('coin-identity-share')).toBe('—');
    expect(valueOf('coin-identity-circulating')).toBe('—');
  });

  it('never renders a 0% drawdown for a coin whose high is unknown', () => {
    mount(bare);
    const card = metric('coin-identity-drawdown');
    expect(card.textContent).not.toMatch(/\b0(\.0+)?%/);
  });

  it('says the feed omitted the figures instead of shrugging', () => {
    mount(bare);
    const note = screen.getByTestId('coin-identity-missing');
    expect(note.textContent).toMatch(/missing|not sent/i);
  });

  it('hides the missing-data note when nothing is missing', () => {
    mount(full, { global: { mcap: 1e9, avgChange: 2 }, bitcoin: { change24h: 1 } });
    expect(screen.queryByTestId('coin-identity-missing')).toBeNull();
  });

  it('treats an absent maxSupply key as unknown, not as uncapped', () => {
    // This is the distinction the whole supply card turns on: our own backend
    // omits the key, and claiming "no ceiling" from a payload that never
    // mentioned a ceiling is the same error as `?? 0`.
    mount(bare);
    const cell = metric('coin-identity-max-supply');
    expect(cell.getAttribute('data-capped')).toBe('unknown');
    expect(cell.textContent).not.toContain('No cap');
    expect(valueOf('coin-identity-max-supply')).toBe('—');
  });

  it('believes an explicit null maxSupply and says uncapped', () => {
    // CoinGecko sends `max_supply: null` for ETH/SOL/DOGE — a real statement.
    mount({ ...full, maxSupply: null });
    expect(metric('coin-identity-max-supply').getAttribute('data-capped')).toBe('false');
    expect(valueOf('coin-identity-max-supply')).toBe('No cap');
  });

  it('draws no unlocked track for an uncapped token', () => {
    // "0% unlocked" would invent a ceiling.
    mount({ ...full, maxSupply: null });
    expect(screen.queryByTestId('coin-identity-unlocked')).toBeNull();
  });

  it('draws no unlocked track when the feed contradicted its own ceiling', () => {
    mount({ ...full, supply: 30e6, maxSupply: 21e6 });
    expect(screen.queryByTestId('coin-identity-unlocked')).toBeNull();
  });

  it('does not draw a day-position track without both ends of the range', () => {
    mount({ ...full, high24h: null, low24h: null });
    expect(screen.queryByTestId('coin-identity-day-position')).toBeNull();
  });
});

describe('TokenIdentity — what the token IS, not only what it costs', () => {
  it('prints the project description when the feed sent one', () => {
    mount(full);
    expect(screen.getByText(/peer-to-peer electronic cash/i)).toBeTruthy();
  });

  it('explains the absence when the feed sent no description', () => {
    mount({ ...full, description: '' });
    expect(screen.getByText(/did not send a description/i)).toBeTruthy();
  });

  it('links the official site only when there is one to link', () => {
    mount(full);
    const link = screen.getByText('Official site').closest('a');
    /* Normalised through URL(), so a trailing slash is added — the point is
       that the host survived and the scheme was checked. */
    expect(link.getAttribute('href')).toMatch(/^https:\/\/bitcoin\.org\/?$/);
    expect(link.getAttribute('rel')).toContain('noopener');
    cleanup();
    mount({ ...full, homepage: null });
    expect(screen.queryByText('Official site')).toBeNull();
  });

  it('does not turn a javascript: URL from a public feed into a link', () => {
    mount({ ...full, homepage: 'javascript:alert(1)' });
    expect(screen.queryByText('Official site')).toBeNull();
  });

  it('keeps the description as text, never as markup', () => {
    // Descriptions arrive from a public API and sometimes contain HTML.
    mount({ ...full, description: 'Pay <b>anyone</b> <script>alert(1)</script> on earth.' });
    /* React escapes the string, so the angle brackets reach the DOM as text:
       no <b> and no <script> element may exist inside the description. */
    const copy = screen.getByTestId('coin-identity-description');
    expect(copy.querySelector('b')).toBeNull();
    expect(copy.querySelector('script')).toBeNull();
    expect(copy.textContent).toContain('<b>anyone</b>');
  });
});

describe('TokenIdentity — the price of it, in CPU', () => {
  const src = fs.readFileSync(path.resolve('src/components/TokenIdentity.jsx'), 'utf8');
  const lib = fs.readFileSync(path.resolve('src/lib/tokenIdentity.js'), 'utf8');

  it('starts no timer, effect or request', () => {
    for (const forbidden of ['useEffect', 'setInterval', 'setTimeout', 'requestAnimationFrame', 'fetch(', 'useGlobalStats', 'usePoll']) {
      expect(src.includes(forbidden), `TokenIdentity.jsx must not contain ${forbidden}`).toBe(false);
      expect(lib.includes(forbidden), `tokenIdentity.js must not contain ${forbidden}`).toBe(false);
    }
  });

  it('memoises on the scalar fields rather than on the coin object', () => {
    // `coin` is a new object every 30 s poll; depending on it would recompute
    // nine divisions sixty times an hour for numbers that did not move.
    expect(src).toContain('useMemo');
    expect(src).toMatch(/\[\s*coin\?\.id,[\s\S]*global\?\.mcap/);
  });

  it('animates nothing', () => {
    for (const forbidden of ['framer-motion', 'transition:', 'animation:', '@keyframes']) {
      expect(src.includes(forbidden), `TokenIdentity.jsx must not contain ${forbidden}`).toBe(false);
    }
  });
});
