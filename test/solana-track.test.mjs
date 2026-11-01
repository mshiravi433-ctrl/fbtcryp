/**
 * SOLANA TRACKING — the server half, pinned offline.
 * ===========================================================================
 *   «در کیف پول هوشمند ردیابی sol کیف پول و تراکنش و نهنگ های سولانا را اضافه کن»
 *
 * What this file proves, in the order a reader would care:
 *
 *   1 · `whaleMovementsFromBlock` reads a REAL block shape (pre/post balances +
 *       account keys) and reports only movements at or above the floor, newest
 *       and largest first. It never counts the transaction fee as a transfer,
 *       never reports a failed transaction, never reports an address moving to
 *       itself, and reports BOTH sides of an uneven split instead of dropping
 *       the smaller one.
 *   2 · The floor and the block scan are env-tunable, and the tunables are read
 *       per call (an operator can lower the floor without a redeploy).
 *   3 · `solanaWhaleWatch` degrades HONESTLY: when no upstream answers, the
 *       payload still carries its schema, its floor, its coverage block and a
 *       `reason` — never an empty list that reads as «no whales moved».
 *   4 · Both routes are registered in server/app.js with the status codes and
 *       cache headers this feature promised: 400 for an address that is not an
 *       address, 502 for a node that did not answer, and no-store on neither.
 *   5 · The panel's CSS keeps the compositor budget (one looping animation, the
 *       refresh spinner, and no `backdrop-filter`), and the panel itself does
 *       not statically import the signing stack.
 *   6 · en and fa carry the same `smart.sol` key set.
 *
 * Everything here runs with no network. The one call that would reach an
 * upstream (`solanaWhaleWatch`) is asserted by SHAPE, not by which branch it
 * took, so the test is right whether the sandbox is offline or not.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SOLANA_TRACK_SCHEMA,
  SOLANA_WHALE_SCHEMA,
  WSOL_MINT,
  __resetWhaleLedger,
  __setSolanaTrackFetchForTests,
  blockScanEnabled,
  isSolanaAddress,
  shortAddress,
  solanaWhaleWatch,
  whaleFloorSol,
  whaleMovementsFromBlock
} from '../server/solanaTrack.js';

const LAMPORTS = 1_000_000_000;
const FEE = 5_000; /* a real priority-fee-sized number, in lamports */

const WHALE_A = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const WHALE_B = 'DYfRFzXcMN7oXH6V1VKbFGwLfCp6P2eG8XKkczGR8yVd';
const WHALE_C = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
const SMALL = 'HN7cABqLq46Es1jh92dQQisAi5YqXt1yMzL8kLm9V1aB';

/** One transaction in `getBlock`'s own `encoding: 'json'` shape. */
function tx({ signature, slot, keys, pre, post, err = null, blockTime = 1_761_900_000 }) {
  return {
    slot,
    blockTime,
    meta: { err, preBalances: pre, postBalances: post, fee: FEE },
    transaction: { signatures: [signature], message: { accountKeys: keys } }
  };
}

function block(transactions, blockTime = 1_761_900_000) {
  return { blockTime, blockHeight: 290_000_000, parentSlot: 300_000_000, transactions };
}

test('the module exports the shapes its routes promise', () => {
  assert.equal(SOLANA_TRACK_SCHEMA, 'fbt.solana-track.v1');
  assert.equal(SOLANA_WHALE_SCHEMA, 'fbt.solana-whale-watch.v1');
  /* Wrapped SOL's mint, the one address this feature hard-codes on purpose:
     it is the chain's own constant, not a token choice. */
  assert.equal(WSOL_MINT, 'So11111111111111111111111111111111111111112');
});

test('isSolanaAddress accepts base-58 public keys and refuses everything else', () => {
  assert.equal(isSolanaAddress(WHALE_A), true);
  assert.equal(isSolanaAddress('  ' + WHALE_B + '  '), true, 'surrounding space is trimmed, not rejected');
  assert.equal(isSolanaAddress('0x742d35Cc6634C0532925a3b844Bc454e4438f44e'), false, 'an EVM address is not a Solana address');
  assert.equal(isSolanaAddress('OOOlll0III'), false, '0, O, I and l are not base-58');
  assert.equal(isSolanaAddress(''), false);
  assert.equal(isSolanaAddress(null), false);
  assert.equal(isSolanaAddress(undefined), false);
  assert.equal(isSolanaAddress('abc'), false, 'too short');
  assert.equal(shortAddress(WHALE_A), '9WzD…AWWM');
  assert.equal(shortAddress('short'), 'short', 'a short string is returned whole, not mangled');
});

test('the floor and the block scan are env-tunable, per call', () => {
  const floor = whaleFloorSol();
  assert.ok(floor >= 1, 'a floor below 1 SOL would turn the feed into a firehose');
  assert.equal(typeof blockScanEnabled(), 'boolean');

  process.env.SOLANA_WHALE_SOL_FLOOR = '2500';
  assert.equal(whaleFloorSol(), 2500, 'an operator can move the floor without a redeploy');
  process.env.SOLANA_WHALE_BLOCK_SCAN = 'false';
  assert.equal(blockScanEnabled(), false, 'the keyless block sample can be switched off entirely');
  delete process.env.SOLANA_WHALE_SOL_FLOOR;
  delete process.env.SOLANA_WHALE_BLOCK_SCAN;
  assert.equal(whaleFloorSol(), floor);
  assert.equal(blockScanEnabled(), true);
});

test('whaleMovementsFromBlock: one clean 4,000 SOL move, fee excluded', () => {
  const rows = whaleMovementsFromBlock(block([
    tx({
      signature: 'sig4000',
      slot: 300_000_001,
      keys: [WHALE_A, WHALE_B],
      /* A pays the fee AND the transfer; B receives exactly 4,000 SOL. */
      pre: [4_000 * LAMPORTS + LAMPORTS, 0],
      post: [LAMPORTS - FEE, 4_000 * LAMPORTS]
    })
  ]), { floorSol: 1000, slot: 300_000_001 });

  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.from, WHALE_A);
  assert.equal(row.to, WHALE_B);
  /* THE FEE IS NOT A TRANSFER. A lost 4,000 SOL + 5,000 lamports and B gained
     4,000 SOL; the movement reported is the smaller of the two, which is the
     one that actually changed hands. */
  assert.equal(row.lamports, 4_000 * LAMPORTS);
  assert.equal(row.sol, 4000);
  assert.equal(row.asset, 'SOL');
  assert.equal(row.source, 'rpc-block-sample');
  assert.equal(row.signature, 'sig4000');
  assert.equal(row.slot, 300_000_001);
  assert.equal(row.at, 1_761_900_000_000, 'blockTime is seconds upstream and milliseconds here');
  assert.equal(row.id, `sig4000:${WHALE_A}:${WHALE_B}`, 'a stable id is what de-duplicates the ledger');
});

test('whaleMovementsFromBlock: below the floor, failed, and self-moves are not movements', () => {
  const rows = whaleMovementsFromBlock(block([
    /* 12 SOL — real, but not a whale. */
    tx({
      signature: 'sigSmall', slot: 300_000_002, keys: [SMALL, WHALE_C],
      pre: [13 * LAMPORTS, 0], post: [LAMPORTS - FEE, 12 * LAMPORTS]
    }),
    /* 9,000 SOL that never landed: a failed transaction moved nothing. */
    tx({
      signature: 'sigFailed', slot: 300_000_003, keys: [WHALE_A, WHALE_B],
      pre: [9_000 * LAMPORTS, 0], post: [9_000 * LAMPORTS, 0],
      err: { InstructionError: [0, { Custom: 1 }] }
    }),
    /* An address paying itself (a wrap, a self-transfer, an ATA rent sweep). */
    tx({
      signature: 'sigSelf', slot: 300_000_004, keys: [WHALE_C, WHALE_C],
      pre: [2_000 * LAMPORTS, 2_000 * LAMPORTS], post: [0, 4_000 * LAMPORTS]
    }),
    /* No balances at all — a transaction this node did not fully report. */
    tx({ signature: 'sigThin', slot: 300_000_005, keys: [WHALE_A], pre: null, post: null })
  ]), { floorSol: 1000, slot: 300_000_005 });

  assert.deepEqual(rows, [], 'none of those four is a large movement between two different wallets');
});

test('whaleMovementsFromBlock: an uneven split reports BOTH sides', () => {
  const rows = whaleMovementsFromBlock(block([
    tx({
      signature: 'sigSplit', slot: 300_000_006,
      keys: [WHALE_A, WHALE_B, WHALE_C],
      pre: [3_000 * LAMPORTS + LAMPORTS, 0, 0],
      post: [LAMPORTS - FEE, 1_800 * LAMPORTS, 1_200 * LAMPORTS]
    })
  ]), { floorSol: 1000, slot: 300_000_006 });

  /* One sender, two receivers. Dropping the smaller half would understate the
     flow — a reader watching for distribution would see 1,800 SOL vanish into
     one wallet instead of 3,000 into two. */
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.sol), [1800, 1200], 'largest pair first');
  assert.deepEqual(rows.map((r) => r.to), [WHALE_B, WHALE_C]);
  assert.ok(rows.every((r) => r.from === WHALE_A));
});

test('whaleMovementsFromBlock: a malformed block is an empty list, never a throw', () => {
  assert.deepEqual(whaleMovementsFromBlock(null, { floorSol: 1000 }), []);
  assert.deepEqual(whaleMovementsFromBlock({}, { floorSol: 1000 }), []);
  assert.deepEqual(whaleMovementsFromBlock({ transactions: 'nope' }, { floorSol: 1000 }), []);
  assert.deepEqual(whaleMovementsFromBlock({ transactions: [{ meta: {} }] }, { floorSol: 1000 }), []);
});

test('solanaWhaleWatch keeps its shape and its honesty when nothing answers', async () => {
  __resetWhaleLedger();
  /* A floor nobody else uses, so this call cannot be served from the previous
     test's cache entry (the cache key carries the floor). */
  process.env.SOLANA_WHALE_SOL_FLOOR = '1234';
  /* A block reader that answers with nothing — the sandbox has no route to a
     Solana node, and the test must not depend on whether it does. */
  __setSolanaTrackFetchForTests(async () => ({ ok: false, status: 503, text: async () => '' }));

  const out = await solanaWhaleWatch({ vs: 'usd' });
  __setSolanaTrackFetchForTests(null);
  delete process.env.SOLANA_WHALE_SOL_FLOOR;

  assert.equal(out.schema, SOLANA_WHALE_SCHEMA);
  assert.equal(out.floorSol, 1234, 'the floor that was in force is the floor reported');
  assert.equal(out.vs, 'usd');
  assert.ok(Array.isArray(out.transfers));
  assert.ok(out.coverage && typeof out.coverage === 'object');
  assert.ok(Array.isArray(out.coverage.sources));
  assert.equal(typeof out.coverage.blocksPerRefresh, 'number');
  assert.equal(typeof out.coverage.solscanConfigured, 'boolean');
  /* `available:false` MUST carry a reason: that is the difference between
     «nothing large moved in the blocks we read» and «we could not read». */
  if (out.available === false) {
    assert.ok(['UPSTREAM_UNAVAILABLE', 'NO_MOVEMENTS_IN_SAMPLE'].includes(out.reason), out.reason);
  } else {
    assert.equal(out.reason, null);
    assert.ok(out.transfers.length > 0);
  }
  /* Whatever came back, it respects the floor and the sort order. */
  for (const row of out.transfers) assert.ok(row.sol >= 1234, `${row.sol} is under the stated floor`);
  const sols = out.transfers.map((r) => r.sol);
  assert.deepEqual(sols, [...sols].sort((a, b) => b - a), 'newest-largest first');
  /* A value column exists only when a price was actually read. */
  for (const row of out.transfers) {
    if (out.solPrice === null) assert.equal(row.value, null, 'no price read ⇒ no invented dollar figure');
  }
});

test('server/app.js registers both tracking routes with honest failure codes', () => {
  const app = readFileSync(new URL('../server/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes("from './solanaTrack.js'"), 'the module is imported by the server');
  assert.ok(app.includes("app.get('/api/solana/track/wallet'"), 'GET /api/solana/track/wallet');
  assert.ok(app.includes("app.get('/api/solana/track/whales'"), 'GET /api/solana/track/whales');

  const walletRoute = app.slice(app.indexOf("app.get('/api/solana/track/wallet'"));
  const walletBody = walletRoute.slice(0, walletRoute.indexOf('\n});'));
  assert.ok(walletBody.includes('isSolanaAddress(address)'), 'the address is validated, not forwarded');
  assert.ok(walletBody.includes("status(400)"), 'a bad address is a 400, never a 502');
  assert.ok(walletBody.includes("BAD_ADDRESS"));
  assert.ok(walletBody.includes('no-store'), 'a refusal must not be cached');
  assert.ok(walletBody.includes('stale-while-revalidate'), 'a good read may be served stale while it refreshes');
  assert.ok(walletBody.includes("status(502)"));

  const whaleRoute = app.slice(app.indexOf("app.get('/api/solana/track/whales'"));
  const whaleBody = whaleRoute.slice(0, whaleRoute.indexOf('\n});'));
  assert.ok(whaleBody.includes('solanaWhaleWatch({ vs })'));
  assert.ok(whaleBody.includes('max-age=120'), 'the whale feed is cached far longer than a wallet');

  /* getBlock stays OUT of the public relay allowlist: it answers in megabytes,
     and a public endpoint that forwards it is an abuse vector. */
  const relay = readFileSync(new URL('../server/solanaRpcRelay.js', import.meta.url), 'utf8');
  assert.ok(!/'getBlock'/.test(relay), 'getBlock must never be relayed from a browser');
});

test('the panel reads only, and pays the compositor nothing extra', () => {
  const panel = readFileSync(new URL('../src/components/smart-wallet/SolTrackPanel.jsx', import.meta.url), 'utf8');
  /* The signing stack must not be in this chunk: a read-only surface that ships
     an adapter is a surface that could sign. */
  assert.ok(!/^import .*lib\/solanaWallet/m.test(panel), 'no STATIC import of the Solana adapter');
  assert.ok(panel.includes("import('../../lib/solanaWallet')"), 'the adapter is asked for lazily, on a tap');
  assert.ok(panel.includes('data-testid="sol-track"'));
  assert.ok(panel.includes('smart.sol.readonlyNote'), 'the read-only promise is written on the panel');
  assert.ok(panel.includes('document.visibilityState'), 'polling pauses in a hidden tab');
  assert.ok(!/setInterval\([^)]*\b(1|2|3|5)000\b/.test(panel), 'no sub-minute polling under a cached endpoint');

  const css = readFileSync(new URL('../src/styles/sol-track.css', import.meta.url), 'utf8');
  assert.ok(!/backdrop-filter:\s*blur/.test(css), 'no blur: the card is already an opaque plate');
  const loops = css.match(/animation:[^;]*infinite/g) || [];
  assert.equal(loops.length, 1, 'one looping animation — the refresh spinner while a read is in flight');
  assert.ok(css.includes('@keyframes sol-track-spin'));
  assert.ok(/transform:\s*rotate/.test(css), 'and it animates transform, not a layout property');
  assert.ok(css.includes('prefers-reduced-motion'), 'it parks for reduced motion');
  assert.ok(css.includes("data-native='true'") && css.includes("data-lite='true'"), 'it parks in the packaged shell and on a lite profile');
});

test('the tracking lib never prints a fake zero', () => {
  const lib = readFileSync(new URL('../src/lib/solTrack.js', import.meta.url), 'utf8');
  assert.ok(lib.includes('apiBase()'), 'the API origin is resolved through the shared helper (native shell safe)');
  assert.ok(/code: body\?\.error/.test(lib), 'the server error code survives into the UI');
  assert.ok(lib.includes('if (value?.ok) cache.set'), 'a failed read is not cached as if it were an answer');
  assert.ok(lib.includes('localStorage'), 'the watched address is remembered');
  assert.ok(!/secretKey|signTransaction|signAllTransactions/.test(lib), 'a tracking lib holds no signing vocabulary');
});

test('en and fa carry the same smart.sol key set', () => {
  const load = (loc) => JSON.parse(readFileSync(new URL(`../src/i18n/locales/${loc}.json`, import.meta.url), 'utf8'));
  const en = load('en');
  const fa = load('fa');
  const flat = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
    (v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
  const enKeys = flat(en.smart.sol).sort();
  const faKeys = flat(fa.smart.sol).sort();
  assert.deepEqual(enKeys, faKeys, 'the two complete locales must agree key for key');
  for (const key of ['title', 'tabWallet', 'tabTx', 'tabWhales', 'tokensUnread', 'txWindow', 'whaleCoverage', 'whaleFloor', 'readonlyNote', 'notConnected', 'ago.seconds']) {
    assert.ok(enKeys.includes(key), `missing smart.sol.${key}`);
  }
  /* Every key the panel asks for must exist, or the reader sees the key itself. */
  const panel = readFileSync(new URL('../src/components/smart-wallet/SolTrackPanel.jsx', import.meta.url), 'utf8');
  const used = new Set([...panel.matchAll(/t\('(smart\.sol\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1].replace('smart.sol.', '')));
  const missing = [...used].filter((k) => !enKeys.includes(k));
  assert.deepEqual(missing, [], 'the panel asks for keys that do not exist');
  /* The relative-time strings are built dynamically — `smart.sol.ago.${unit}` —
     so they never appear as literals. Every unit `agoLabel()` can return must
     therefore have a key in BOTH locales, or a stale timestamp prints as the
     key itself on a wallet screen. */
  assert.ok(/t\(`smart\.sol\.ago\.\$\{[a-zA-Z]+\.unit\}`/.test(panel), 'the panel renders relative time through the ago.* keys');
  for (const unit of ['seconds', 'minutes', 'hours', 'days']) {
    assert.ok(enKeys.includes(`ago.${unit}`), `missing smart.sol.ago.${unit}`);
    assert.ok(en.smart.sol.ago[unit].includes('{{n}}'), `smart.sol.ago.${unit} must interpolate the count`);
    assert.ok(fa.smart.sol.ago[unit].includes('{{n}}'), `fa smart.sol.ago.${unit} must interpolate the count`);
  }
});

test('SmartWallet renders the panel between the session card and the guardians', () => {
  const page = readFileSync(new URL('../src/pages/SmartWallet.jsx', import.meta.url), 'utf8');
  assert.ok(page.includes("import SolTrackPanel from '../components/smart-wallet/SolTrackPanel'"));
  /* The display currency is resolved the way every other screen resolves it,
     not hard-coded to `$` (the app is USD-only by owner decision, but a
     hard-coded symbol is how that decision outlives its own reversal). */
  assert.ok(page.includes('<SolTrackPanel vs={vsOf(displayCurrency.code)} currencySymbol={displayCurrency.symbol} />'));
  assert.ok(page.includes("import { currencyOf, vsOf } from '../lib/currency'"));
  assert.ok(page.includes('currencyOf(useSettingsStore((state) => state.currency))'));
  const at = page.indexOf('<SolTrackPanel');
  assert.ok(at > page.indexOf('SESSION CARD'), 'after the session card — limits first, then what they protect');
  assert.ok(at < page.indexOf('GUARDIANS'), 'before the guardians');
});
