#!/usr/bin/env node
/**
 * SMART MONEY PODS + RECEIPT LEDGER — 2026-11-01
 * ---------------------------------------------------------------------------
 * The owner reported two things that both *render* while being wrong, which is
 * exactly why they need a probe and not a screenshot:
 *
 *   1. «کیف‌پول واجد شرایط» and «اجماع گروه‌های مستقل» in the first box of the
 *      Smart Money hero were always zero, and the same qualified count was zero
 *      on the «هوش تأییدشده» tab as well.
 *   2. «آخرین رسیدهای معاملهٔ تأییدشده» — every receipt was a ragged two- or
 *      three-line block with big gaps between them.
 *
 * Neither is a styling opinion, so each gets an assertion:
 *
 *   · the overview NEVER prints a verified number it did not read — an
 *     unreadable engine says `available: false`, and the pods render «—»;
 *   · the verified read gets its own floor budget, is told to use its own
 *     clock (a stale `now` silently drops freshly written profiles), and has a
 *     last-good fallback instead of blanking to zeros;
 *   · the receipt row is a four-track grid that cannot wrap, with the three
 *     secondary controls grouped into one cell.
 *
 * Runs with plain Node: no DOM, no network.
 * Run: node test/smart-money-pods-probe.mjs
 */
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

let failures = 0;
const fail = (m) => { failures += 1; console.error(`✗ ${m}`); };
const ok = (m) => console.log(`✓ ${m}`);
const t = (name, cond) => (cond ? ok(name) : fail(name));

const server = strip(read('../server/smartMoney/index.js'));
const page = strip(read('../src/pages/SmartMoney.jsx'));
const intel = strip(read('../src/components/SmartMoneyIntelligence.jsx'));
const intelCss = strip(read('../src/styles/smart-money-intelligence.css'));
const fa = JSON.parse(read('../src/i18n/locales/fa.json'));
const en = JSON.parse(read('../src/i18n/locales/en.json'));

/* ── 1 · the overview tells the truth about the verified engine ──────────── */
t('the verified section is its own function, not a 3-second share of the stream budget',
  /export async function verifiedSection\(/.test(server)
  && /verifiedSection\(winKey, readBudgetMs\)/.test(server)
  && !/Math\.min\(3_000, readBudgetMs\)/.test(server));

t('the verified read is no longer handed the overview\'s older clock',
  /getVerifiedIntelligence\(\{ window: winKey, includePrices: false, refresh: 'background' \}\)/.test(server)
  && !/getVerifiedIntelligence\(\{ window: winKey, now,/.test(server));

t('it gets its own floor budget and a last-good fallback instead of blanking to zero',
  /Math\.max\(5_000, Math\.min\(6_000, Number\(budgetMs\) \|\| 5_000\)\)/.test(server)
  && /VERIFIED_SUMMARY_STALE_OK/.test(server)
  && /available: false/.test(server));

t('the payload separates "not read" from "measured zero"',
  /available: verified\.available !== false/.test(server)
  && /counts: verified\.counts/.test(server)
  && /qualified: v\?\.coverage\?\.classifiedWallets \?\? null/.test(server)
  && /consensusActive: consensus\.filter\(\(r\) => r\.confidence != null\)\.length/.test(server));

/* ── 2 · the pods render that distinction ───────────────────────────────── */
t('the pods read the server counts, not a number the client invented',
  /const qualifiedWallets = verified\?\.counts\?\.qualified/.test(page)
  && /const consensusActive = verified\?\.counts\?\.consensusActive/.test(page));

t('an unread engine renders «—», never a zero',
  /const verifiedRead = Boolean\(verified\)/.test(page)
  && /verified\.dataStatus !== 'unavailable'/.test(page)
  && /verifiedRead \? \(qualifiedWallets \?\? '—'\) : '—'/.test(page)
  && /verifiedRead \? consensusActive : '—'/.test(page));

t('both hero pods are addressable by test id', 
  /data-testid="sm-pod-qualified"/.test(page) && /data-testid="sm-pod-consensus"/.test(page));

t('the explanation strings exist in both languages',
  typeof fa.sm.pods?.reading === 'string' && typeof fa.sm.pods?.stale === 'string'
  && typeof en.sm.pods?.reading === 'string' && typeof en.sm.pods?.stale === 'string');

/* ── 3 · the verified tab keeps its own honest dashes ───────────────────── */
t('the verified tab prints «—» rather than a fabricated count when the payload is missing',
  /\{data\?\.coverage\?\.classifiedWallets \?\? '—'\}/.test(intel));

/* ── 4 · the receipt ledger is one line per receipt ─────────────────────── */
/* The LAST `.smi-feed-row { … }` block is the one that wins the cascade: the
   ledger was rewritten at the end of the sheet, so an earlier match would
   assert against the old wrapping-flex rule it replaced. Sliced from the last
   opening brace to the next line that closes a rule at column 0. */
const feedFrom = intelCss.lastIndexOf('\n.smi-feed-row {');
const feedRow = feedFrom < 0 ? '' : intelCss.slice(feedFrom, intelCss.indexOf('\n}', feedFrom) + 2);

t('a receipt row is a grid, not a wrapping flex',
  /display: grid/.test(feedRow) && /grid-template-columns: auto 26px minmax\(0, 1fr\) auto/.test(feedRow)
  && /flex-wrap: nowrap/.test(feedRow) && !/flex-wrap: wrap/.test(feedRow));

t('the three secondary controls share ONE cell, so they cannot each claim a line',
  /<div className="smi-feed-actions">/.test(intel) && /\.smi-feed-actions \{/.test(intelCss));

t('the row has a fixed rhythm and no injected row gap',
  /min-height: 50px/.test(feedRow) && /row-gap: 0/.test(feedRow) && /column-gap: 8px/.test(feedRow));

t('the amount sits beside the symbol and the ROI pill sits in the meta line',
  /<span className="smi-feed-title">[\s\S]{0,220}fmtUsd\(r\.valueUsd\)/.test(intel)
  && /<span className="smi-feed-meta">/.test(intel));

t('only the wallet tag steps out on a narrow phone — nothing else hides',
  /@media \(max-width: 700px\) \{[\s\S]{0,120}\.smi-feed-row \.smi-feed-wallet \{ display: none; \}/.test(intelCss)
  && !/\.smi-feed-row \.sm-copy \{ display: none/.test(intelCss));

t('figures stay tabular so a polling refresh cannot jitter the column',
  /font-variant-numeric: tabular-nums/.test(feedRow));

if (failures) {
  console.error(`\nSmart Money pods probe: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nSmart Money pods probe: all checks passed');
