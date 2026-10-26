/**
 * SPOT TRADE — static checks: the things a reviewer would otherwise have to
 * remember. Locale coverage, placeholder parity, forbidden wording, no
 * hard-coded user text in the spot components, design tokens only, and the
 * flag's default.
 * Run: node --test test/spot-trade-static.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const LOCALES = ['en', 'fa', 'ar', 'zh', 'hi', 'es', 'fr', 'ru', 'tr', 'ur', 'id', 'pt'];
const json = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`src/i18n/locales/${l}.json`))]));
const get = (obj, key) => key.split('.').reduce((o, k) => o?.[k], obj);

const SPOT_FILES = [
  'src/components/spot/SpotTrade.jsx',
  'src/components/spot/SpotMarketList.jsx',
  'src/components/spot/SpotSelect.jsx',
  'src/components/spot/SpotTokenRisk.jsx',
  'src/pages/SpotPage.jsx'
];

/* The spot tab's refusals, wherever they are raised: `code: 'X'` and
   `throw new Error('X')` in the flow modules, and the codes the screen pushes
   onto its own blocker list. */
const CODE_SOURCES = [
  'src/components/spot/SpotTrade.jsx',
  'src/lib/spot/spotFlow.js',
  'src/lib/spot/solanaSpot.js',
  'src/lib/spot/spotMath.js',
  'src/lib/solana.js'
];

/** Every `spot.*` key a source file asks for, literal or built from a known set. */
function keysUsed(text) {
  const keys = new Set();
  for (const m of text.matchAll(/['"`](spot\.[A-Za-z0-9_.]+)['"`]/g)) keys.add(m[1]);
  return keys;
}

/** Every leaf value under spot.* in one locale, flattened to dotted keys. */
function spotLeaves(locale) {
  const out = {};
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object') walk(v, p);
      else out[p] = v;
    }
  };
  walk(locale.spot ?? {}, 'spot');
  return out;
}

describe('locales: the spot tab exists in all twelve languages', () => {
  it('there are twelve locale files, and en/fa/ar are the hand-kept three', () => {
    assert.equal(LOCALES.length, 12);
    for (const l of LOCALES) assert.ok(json[l], `${l}.json loads`);
  });

  it('every spot key the screens use exists in en.json', () => {
    const used = new Set();
    for (const f of SPOT_FILES) for (const k of keysUsed(read(f))) used.add(k);
    // Keys built at runtime from a known set (see SpotTrade.jsx errorKey/STAGE_KEY/OUTCOME_VIEW).
    const ERR = [
      'WALLET_NOT_CONNECTED', 'WRONG_NETWORK', 'INSUFFICIENT_BALANCE', 'INSUFFICIENT_GAS', 'QUOTE_EXPIRED',
      'SLIPPAGE_EXCEEDED', 'SLIPPAGE_INVALID', 'RPC_ERROR', 'NO_ROUTE', 'NO_LIQUIDITY', 'QUOTE_FAILED',
      'QUOTE_NETWORK', 'AMOUNT_REQUIRED', 'INVALID_AMOUNT', 'AMOUNT_ZERO', 'TOO_MANY_DECIMALS', 'TX_FAILED',
      'TX_REVERTED', 'USER_REJECTED', 'PRICE_MOVED', 'ROUTE_CHANGED', 'CONFIRMATION_TIMEOUT', 'FEE_NOT_APPLIED',
      'FEE_RECIPIENT_MISMATCH',
      'NOT_CONFIRMED', 'QUOTE_MISSING', 'QUOTE_INVALID', 'INVALID_DECIMALS',
      'NO_TRANSACTION', 'ORDER_FAILED', 'SEND_FAILED', 'NO_TOKEN_ACCOUNT', 'BELOW_MINIMUM'
    ];
    for (const c of ERR) used.add(`spot.err.${c}`);
    for (const s of ['preparing', 'approving', 'approvalSent', 'quoting', 'signing', 'pending', 'confirmed', 'failed', 'cancelled', 'stale']) used.add(`spot.status.${s}`);
    for (const s of ['buy', 'sell']) used.add(`spot.side.${s}`);
    for (const s of ['real', 'paper']) used.add(`spot.mode.${s}`);
    assert.ok(used.size > 60, `the scan found the keys (${used.size})`);
    const missing = [...used].filter((k) => get(json.en, k) === undefined);
    assert.deepEqual(missing, [], `keys missing from en.json: ${missing.join(', ')}`);
  });

  it('every spot key has a non-empty string in each of the twelve locales', () => {
    const enKeys = Object.keys(spotLeaves(json.en));
    assert.ok(enKeys.length >= 80, `en has ${enKeys.length} spot leaves`);
    const gaps = [];
    for (const l of LOCALES) {
      const leaves = spotLeaves(json[l]);
      for (const k of enKeys) {
        if (typeof leaves[k] !== 'string' || leaves[k].trim() === '') gaps.push(`${l}:${k}`);
      }
    }
    assert.deepEqual(gaps, [], `missing translations: ${gaps.slice(0, 12).join(', ')}`);
  });

  it('placeholders survive in every language ({{wallet}}, {{pct}}, … match English)', () => {
    const ph = (s) => [...String(s).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join();
    const enLeaves = spotLeaves(json.en);
    const bad = [];
    for (const l of LOCALES) {
      const leaves = spotLeaves(json[l]);
      for (const [k, v] of Object.entries(enLeaves)) {
        if (ph(v) !== ph(leaves[k])) bad.push(`${l}:${k} want[${ph(v)}] got[${ph(leaves[k])}]`);
      }
    }
    assert.deepEqual(bad, []);
  });
});

describe('wording: no promises the platform cannot keep', () => {
  const FORBIDDEN_FA = ['تضمین', 'بدون ریسک', 'سود قطعی', 'قیمت قطعی', 'پرشدن تضمین'];
  const FORBIDDEN_EN = ['guarantee', 'risk-free', 'risk free', 'guaranteed profit', 'sure profit', 'no risk'];
  it('no spot string in any locale uses a forbidden phrase', () => {
    const hits = [];
    for (const l of LOCALES) {
      for (const [k, v] of Object.entries(spotLeaves(json[l]))) {
        const s = String(v).toLowerCase();
        for (const w of [...FORBIDDEN_FA, ...FORBIDDEN_EN]) if (s.includes(w.toLowerCase())) hits.push(`${l}:${k} «${w}»`);
      }
    }
    assert.deepEqual(hits, []);
  });
});

describe('no hard-coded user text in the spot components', () => {
  it('JSX text nodes are all translated', () => {
    const hits = [];
    for (const f of SPOT_FILES) {
      const lines = read(f).split('\n');
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        // Text between a tag's `>` and the next `<`, with no `{` expression in it.
        for (const m of line.matchAll(/>([^<>{}]+)</g)) {
          const text = m[1].trim();
          if (/[A-Za-z\u0600-\u06FF]{2,}/.test(text)) hits.push(`${f}:${i + 1} «${text}»`);
        }
      });
    }
    assert.deepEqual(hits, [], hits.join('\n'));
  });

  it('attribute strings that a reader sees are translated (aria-label, placeholder, title)', () => {
    const hits = [];
    for (const f of SPOT_FILES) {
      for (const m of read(f).matchAll(/(aria-label|placeholder|title|alt)="([^"{}]*)"/g)) {
        if (/[A-Za-z\u0600-\u06FF]{2,}/.test(m[2])) hits.push(`${f} ${m[1]}="${m[2]}"`);
      }
    }
    assert.deepEqual(hits, []);
  });
});

describe('design: tokens only, 44px targets, no blur, reduced motion honoured', () => {
  const css = read('src/styles/spot-trade.css');
  it('no literal colours (hex or rgb) — only the shared variables', () => {
    assert.equal((css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length, 0);
    assert.equal((css.match(/rgba?\(/g) ?? []).length, 0);
  });
  it('no backdrop filter of any kind', () => {
    // The rule is the FILTER (an expensive composited layer on a phone), not
    // the word: `.spot-sel-backdrop` is the dimmed layer's class name.
    assert.equal(/backdrop-filter/i.test(css), false);
  });
  it('interactive controls are at least 44px tall', () => {
    for (const sel of ['.spot-btn', '.spot-sel-trigger', '.spot-sel-opt', '.spot-side-btn', '.spot-cta', '.spot-chip', '.spot-mode-tab', '.spot-amount-row', '.spot-btn-link', '.spot-slip-input']) {
      // The selector may sit in a grouped rule (`.spot-a, .spot-b { … }`).
      const re = new RegExp(`${sel.replace('.', '\\.')}(?![\\w-])[^{}]*\\{[^}]*min-height:\\s*(44px|48px|52px|56px|var\\(--min-tap\\))`);
      assert.ok(re.test(css), `${sel} has a 44px minimum height`);
    }
  });
  it('figures use tabular numerals', () => {
    assert.ok(/font-variant-numeric:\s*tabular-nums/.test(css));
  });
  it('reduced motion turns transitions and animations off', () => {
    assert.ok(/prefers-reduced-motion:\s*reduce/.test(css));
  });
  it('the review confirm button is the only place the confirm style is applied', () => {
    const spotTrade = read('src/components/spot/SpotTrade.jsx');
    const confirmUses = spotTrade.match(/spot-btn-confirm/g) ?? [];
    assert.equal(confirmUses.length, 1);
  });
});

describe('errors: every refusal the spot tab can raise has a translated sentence', () => {
  /*
   * «ارورها درست همراه با زبان درست باشد» — the bug behind this test. `t()` on a
   * missing key returns the KEY, so any code without a locale entry reached the
   * user as «spot.err.QUOTE_MISSING». Nine codes had no entry at all
   * (QUOTE_MISSING, QUOTE_INVALID, NOT_CONFIRMED, INVALID_DECIMALS,
   * NO_TRANSACTION, ORDER_FAILED, SEND_FAILED, NO_TOKEN_ACCOUNT,
   * BELOW_MINIMUM); they are translated now, and this keeps them that way.
   */
  const NOT_SENTENCES = ['QUOTE_LOADING']; // the screen shows spot.quoteLoading for it

  function codesOf(text) {
    const out = new Set();
    for (const m of text.matchAll(/code:\s*'([A-Z_]{3,})'/g)) out.add(m[1]);
    for (const m of text.matchAll(/Error\('([A-Z_]{3,})'\)/g)) out.add(m[1]);
    for (const m of text.matchAll(/return '([A-Z_]{3,})'/g)) out.add(m[1]);
    // Deliberately NOT the `^SAME_TOKEN$`-style alternatives inside
    // solanaErrorCode: those are inputs it maps away (to NO_ROUTE), not codes
    // that can reach the screen.
    return out;
  }

  it('every code from the spot flow, the screen and the Solana order map is in en.json', () => {
    const codes = new Set();
    for (const f of ['src/components/spot/SpotTrade.jsx', 'src/lib/spot/spotFlow.js', 'src/lib/spot/solanaSpot.js', 'src/lib/spot/spotMath.js']) {
      for (const c of codesOf(read(f))) codes.add(c);
    }
    // orderErrorKey's answers reach the spot UI verbatim through solanaErrorCode.
    const solana = read('src/lib/solana.js');
    const at = solana.indexOf('export function orderErrorKey');
    assert.ok(at >= 0, 'orderErrorKey exists');
    for (const c of codesOf(solana.slice(at, solana.indexOf('\n}\n', at)))) codes.add(c);

    assert.ok(codes.size >= 25, `the scan found the codes (${codes.size})`);
    const missing = [...codes].filter((c) => !NOT_SENTENCES.includes(c) && typeof get(json.en, `spot.err.${c}`) !== 'string');
    assert.deepEqual(missing, [], `codes with no sentence in en.json: ${missing.join(', ')}`);
  });

  it('and in every one of the twelve locales', () => {
    const gaps = [];
    for (const [k, v] of Object.entries(spotLeaves(json.en))) {
      if (!k.startsWith('spot.err.')) continue;
      for (const l of LOCALES) {
        if (typeof spotLeaves(json[l])[k] !== 'string' || String(v).trim() === '') gaps.push(`${l}:${k}`);
      }
    }
    assert.deepEqual(gaps, [], `untranslated refusals: ${gaps.slice(0, 12).join(', ')}`);
  });

  it('every error the screen shows goes through the fallback, never a bare t(code)', () => {
    const src = read('src/components/spot/SpotTrade.jsx');
    // The only allowed shape is errorText(t, code[, values]); a bare
    // t(errorKey(...)) without a defaultValue is the bug that shipped.
    const bare = [...src.matchAll(/t\(errorKey\(([^)]*)\)\s*\)/g)];
    assert.deepEqual(bare.map((m) => m[0]), [], 'no t(errorKey(code)) without a defaultValue');
  });
});

describe('the pickers: popups, no search field, one box', () => {
  const select = read('src/components/spot/SpotSelect.jsx');
  const trade = read('src/components/spot/SpotTrade.jsx');

  it('there is no search field anywhere in the spot tab', () => {
    for (const f of SPOT_FILES) {
      const src = read(f);
      assert.equal(/type="search"/.test(src), false, `${f} has no search input`);
      assert.equal(/spot-search/.test(src), false, `${f} has no search field`);
    }
  });

  it('the choices open a portalled popup, not a native select', () => {
    assert.match(select, /createPortal\(/);
    assert.match(select, /role="dialog"/);
    assert.match(select, /role="listbox"/);
    assert.equal(/<select/.test(trade), false, 'the ticket has no native <select>');
    assert.equal(/<select/.test(select), false, 'the picker has no native <select>');
  });

  it('the market column is gone: one ticket, the market inside the picker', () => {
    assert.equal(/spot-market-col/.test(trade), false, 'no market column');
    assert.equal(/<SpotMarketList/.test(trade), false, 'the market list is not rendered as its own box');
    assert.match(trade, /className="spot-stack"/);
  });

  it('the three warnings live in one folding box, and the AI risk in its own', () => {
    assert.match(trade, /id="spot-notices"/);
    assert.match(trade, /spot\.notices\.title/);
    assert.match(trade, /<SpotTokenRisk/);
    assert.match(read('src/components/spot/SpotTokenRisk.jsx'), /CollapsibleCard/);
  });

  it('buy and sell never share a hue (the sell pill used to fade into the buy green)', () => {
    const buy = trade.match(/s === 'buy' \? '([^']+)'/)?.[1] ?? '';
    const sell = trade.match(/: '([^']*linear-gradient[^']*)'/)?.[1] ?? '';
    assert.match(buy, /var\(--up\)/);
    assert.match(sell, /var\(--down\)/);
    assert.equal(/var\(--rgb-4\)/.test(buy + sell), false, 'no mint green on the sell side');
  });

  it('the amount input draws no ring of its own — the row answers focus', () => {
    const css = read('src/styles/spot-trade.css');
    const block = css.match(/\.spot-root \.spot-amount-input:focus[\s\S]*?\}/)?.[0] ?? '';
    assert.match(block, /box-shadow:\s*none/);
    assert.match(block, /outline:\s*none/);
    assert.match(css, /\.spot-root \.spot-amount-row:focus-within/);
  });
});

describe('the feature flag: off by default, and no existing flag changed', () => {
  it('SPOT_TRADE_ENABLED is read from VITE_ENABLE_SPOT_TRADE and must be exactly "true"', () => {
    const src = read('src/lib/features.js');
    assert.match(src, /export const SPOT_TRADE_ENABLED = envFlag\('VITE_ENABLE_SPOT_TRADE'\) === 'true';/);
  });
  it('it is false in a plain node import (no build env)', async () => {
    const mod = await import('../src/lib/features.js');
    assert.equal(mod.SPOT_TRADE_ENABLED, false);
  });
  it('the website build (build:full, Vercel) enables it; android:sync does not', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.scripts['build:full'], /VITE_ENABLE_SPOT_TRADE=true/);
    assert.equal(/VITE_ENABLE_SPOT_TRADE/.test(pkg.scripts['android:sync']), false);
  });
  it('the Android sync script does not enable it', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(/VITE_ENABLE_SPOT_TRADE=true/.test(pkg.scripts['android:sync']), false);
  });
  it('the spot tab does not depend on the speculation flag', () => {
    const perp = read('src/pages/Perp.jsx');
    // The rail reads PERP_TABS; spot is added from its own flag only.
    assert.match(perp, /const PERP_TABS = \[\.\.\.\(SPOT_TRADE_ENABLED \? \['spot'\] : \[\]\), \.\.\.FUTURES_TABS\];/);
    assert.match(perp, /const FUTURES_TABS = SPECULATION_ENABLED\s*\?\s*\['overview', 'dydx', 'onchain', \.\.\.\(FUTURES_HISTORY_ENABLED \? \['history'\] : \[\]\)\]\s*:\s*\[\];/);
    assert.match(perp, /PERP_TABS\.length > 1 && \(/);
    assert.equal(/VISIBLE_TABS/.test(perp), false);
  });
});

describe('/trade stays reachable and redirects to the spot tab', () => {
  it('App keeps /trade, and it redirects with replace when the spot flag is on', () => {
    const app = read('src/App.jsx');
    assert.match(app, /<Route path="\/trade" element=\{SPOT_TRADE_ENABLED \? <Navigate to="\/perp\?tab=spot" replace \/> : <Trade \/>\} \/>/);
  });
});
