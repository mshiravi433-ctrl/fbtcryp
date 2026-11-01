/**
 * SOLANA TRACKING — one wallet, its transactions, and the whales around it.
 * ==========================================================================
 *
 * ─── WHAT THIS IS FOR ────────────────────────────────────────────────────────
 *   «در کیف پول هوشمند ردیابی sol کیف پول و تراکنش و نهنگ های سولانا را اضافه کن»
 *
 * The Smart Wallet screen sets ceilings and guardians for what the app is
 * allowed to sign. It could not answer the question that makes those numbers
 * mean anything: WHAT IS ON THIS WALLET, WHAT DID IT JUST DO, AND WHO IS
 * MOVING AROUND IT. This module is the read side of that question, for Solana.
 *
 * Three reads, three honest sources:
 *
 *   1. THE WALLET — `getBalance`, `getTokenAccountsByOwner` (both token
 *      programs) and a live SOL price. Real lamports from a real node; the
 *      dollar figure is the same price feed every other screen uses.
 *   2. ITS TRANSACTIONS — `getSignaturesForAddress`, which is the node's own
 *      answer to "what did this address sign": signature, slot, block time,
 *      whether it failed, and its memo. Nothing is inferred, and a signature
 *      with no block time is printed without one rather than stamped "now".
 *   3. THE WHALES — large native-SOL movements, read two ways and merged:
 *        · Solscan's indexed transfer feed, when the operator has a key
 *          (server/solanaIntel.js already owns that secret and its credits);
 *        · a KEYLESS sample of one recent block per refresh, from which the
 *          native-SOL deltas between `preBalances` and `postBalances` give the
 *          movements directly. No key, no indexer, no vendor: the chain itself.
 *
 * ─── WHY THE WHALE FEED SAMPLES A BLOCK AT ALL ───────────────────────────────
 * There is no keyless RPC method that answers "recent large transfers". A node
 * serves history PER ADDRESS (`getSignaturesForAddress`) and per mint
 * (`getTokenLargestAccounts`), neither of which is a market-wide feed, and it
 * does not even report amounts for the signatures it lists — that needs a
 * second call per transaction, which for a market-wide feed is a thousand calls
 * a minute.
 *
 * A block, on the other hand, already contains every balance before and after
 * every transaction in it. One `getBlock` therefore yields every native-SOL
 * movement in ~400ms of chain time, for one request. Mainnet produces a slot
 * every 400ms, so one block per refresh is a SAMPLE, not a census — and this
 * module says so out loud (`coverage.blocksSampled`, `coverage.slot`), because
 * a whale feed that implies it saw everything is a feed someone will trade on.
 *
 * The sample accumulates: each refresh folds its findings into a rolling
 * in-memory ledger (40 movements, newest first), so five minutes of refreshes
 * read as a list rather than as one block's worth of luck. A failed refresh
 * leaves the ledger as it was; it never replaces real movements with an empty
 * list, and it never invents a movement to fill the gap.
 *
 * ─── WHY `getBlock` IS NOT IN THE PUBLIC RELAY ───────────────────────────────
 * server/solanaRpcRelay.js forwards an allowlist for the BROWSER, and a block
 * is megabytes: an open door to `getBlock` is a way to spend this deployment's
 * bandwidth and a public node's patience from a web page. So the read here uses
 * the relay's own upstream list (same hosts, same refusal memory is not shared)
 * from the SERVER, on a five-minute cache, once per refresh, with a byte cap.
 * The public allowlist is unchanged.
 *
 * ─── NOTHING HERE IS FABRICATED ──────────────────────────────────────────────
 * A missing field is `null` and the client hides it. An address this app cannot
 * label is printed as an address — there is no guessbook of "Binance wallet"
 * here, exactly as in server/whales.js. A wallet with zero SOL is 0 (that is a
 * real measurement); a wallet the node would not answer is `available:false`
 * with a reason, which is a different statement and reads differently on
 * screen.
 */

import { withCache } from './cache.js';
import { fetchSimplePrices } from './providers.js';
import { relaySolanaRpc, relayUpstreams, redactUpstream } from './solanaRpcRelay.js';
import { fetchSolanaWhales, solscanConfigured } from './solanaIntel.js';

export const SOLANA_TRACK_SCHEMA = 'fbt.solana-track.v1';
export const SOLANA_WHALE_SCHEMA = 'fbt.solana-whale-watch.v1';

/** The SPL token program, and its 2022 replacement: a wallet can hold both. */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
/** Wrapped SOL — the mint whose ledger entries ARE native SOL movements. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

const LAMPORTS_PER_SOL = 1e9;
const WALLET_TTL_MS = 60_000;
const WHALE_TTL_MS = 300_000;

/** Every tunable is read at CALL time, so a test (or an operator) can turn it. */
const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** A movement below this many SOL is not a whale, whatever else it is. */
export const whaleFloorSol = () => num('SOLANA_WHALE_SOL_FLOOR', 1_000);
/** How many sampled movements the rolling ledger keeps. */
const ledgerSize = () => num('SOLANA_WHALE_LEDGER_SIZE', 40);
/** Block sampling is on unless it is explicitly switched off. */
export const blockScanEnabled = () =>
  String(process.env.SOLANA_WHALE_BLOCK_SCAN ?? 'true').toLowerCase() !== 'false';
/** Per-upstream ceiling for the (large) block read. */
const blockTimeoutMs = () => num('SOLANA_TRACK_BLOCK_TIMEOUT_MS', 14_000);
/** Refuse to hold a block bigger than this in memory. */
const blockMaxBytes = () => num('SOLANA_TRACK_BLOCK_MAX_BYTES', 24_000_000);
/** How far back from the head to sample: a slot that is certainly rooted. */
const blockSampleLag = () => num('SOLANA_WHALE_SLOT_LAG', 64);

/* A base-58 public key: 32–44 characters, no 0, O, I or l. The same shape the
   rest of the server uses (server/solanaChainReads.js `isSolanaPubkey`). */
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSolanaAddress(value) {
  return PUBKEY_RE.test(String(value || '').trim());
}

export const shortAddress = (value, head = 4, tail = 4) => {
  const s = String(value || '');
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
};

/** A typed failure, so the route can answer 400 vs 502 without string-matching. */
function trackError(code, detail) {
  const err = new Error(detail || code);
  err.code = code;
  return err;
}

/** Test seam: the block read's fetch, replaceable without touching the network. */
let fetchImpl = (url, opts) => globalThis.fetch(url, opts);
export function __setSolanaTrackFetchForTests(fn) {
  fetchImpl = fn || ((url, opts) => globalThis.fetch(url, opts));
}
/** Test seam: empty the rolling ledger. */
export function __resetWhaleLedger() {
  ledger.length = 0;
  lastSample = null;
}

/* ────────────────────────────────────────────────────────────────────────────
   RPC — through the relay for allowlisted reads, direct for the block.
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * One allowlisted read, with the relay's own multi-upstream failover.
 *
 * The relay is used from the server rather than reimplemented here because it
 * already carries what a Solana read needs on a public node: nine upstreams in
 * a measured order, per-host AND per-method refusal memory (a node that answers
 * `getBalance` and refuses `getTokenAccountsByOwner` is remembered as refusing
 * THAT METHOD, not skipped entirely), and a shared short cache that collapses
 * N users into one call.
 */
/**
 * The relay meters a budget PER CALLER (`ip`), and every server-side read that
 * passes none shares one bucket named "unknown" — so ten wallets tracked at
 * once would spend one wallet's allowance and the eleventh would be refused by
 * our own door. Each tracked address therefore gets its own key: the budget
 * still protects the upstreams, and one reader cannot starve another.
 */
async function rpc(method, params, budgetKey = 'server:solana-track') {
  const out = await relaySolanaRpc({ body: { jsonrpc: '2.0', id: 1, method, params }, ip: budgetKey });
  const body = out?.body;
  if (out?.status !== 200 || !body || body.error) {
    throw trackError('RPC_UNAVAILABLE', `${method}: ${body?.error?.message || `relay ${out?.status}`}`);
  }
  return body.result;
}

/**
 * The one read the public relay does not forward: a whole block.
 *
 * Walks the same upstream list the relay uses, in the same order, and stops at
 * the first node that answers with a body under the byte cap. A node that
 * refuses (403/429) is skipped, not reported: the caller only needs one block,
 * and which node served it is not part of the answer.
 */
async function readBlock(slot) {
  const upstreams = relayUpstreams('mainnet-beta');
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getBlock',
    params: [
      slot,
      {
        encoding: 'json',
        transactionDetails: 'full',
        rewards: false,
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      }
    ]
  };
  let lastError = null;
  for (const url of upstreams) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), blockTimeoutMs());
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        lastError = `${redactUpstream(url)} → HTTP ${res.status}`;
        continue;
      }
      const text = await res.text();
      if (text.length > blockMaxBytes()) {
        lastError = `${redactUpstream(url)} → ${text.length} bytes over the ${blockMaxBytes()} cap`;
        continue;
      }
      const json = JSON.parse(text);
      if (json?.error) {
        lastError = `${redactUpstream(url)} → ${json.error.message || json.error.code}`;
        continue;
      }
      return { block: json.result, upstream: redactUpstream(url) };
    } catch (err) {
      lastError = `${redactUpstream(url)} → ${err?.message || err}`;
    } finally {
      clearTimeout(timer);
    }
  }
  throw trackError('BLOCK_UNAVAILABLE', lastError || 'no upstream served getBlock');
}

/* ────────────────────────────────────────────────────────────────────────────
   1 + 2 · THE WALLET AND ITS TRANSACTIONS
   ──────────────────────────────────────────────────────────────────────────── */

const num2 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One parsed token account → the shape the client prints. */
function tokenAccountRow(account) {
  const info = account?.account?.data?.parsed?.info;
  if (!info) return null;
  const amount = num2(info.tokenAmount?.uiAmount);
  if (amount === null || amount <= 0) return null;
  return {
    mint: info.mint ? String(info.mint) : null,
    amount,
    decimals: num2(info.tokenAmount?.decimals),
    uiAmountString: info.tokenAmount?.uiAmountString ? String(info.tokenAmount.uiAmountString) : null
  };
}

/**
 * GET /api/solana/track/wallet?address=…
 *
 * Everything the node knows about one address, plus the price of SOL, plus the
 * arithmetic that turns those two into a portfolio value. Each read is
 * independent: a node that answers `getBalance` and refuses the token programs
 * still produces a wallet with a real SOL balance and `tokens: null` — which
 * the screen prints as "unread", never as "no tokens". Those are different
 * claims and only one of them is true.
 */
export async function trackSolanaWallet(addressRaw, { vs = 'usd' } = {}) {
  const address = String(addressRaw || '').trim();
  if (!isSolanaAddress(address)) throw trackError('BAD_ADDRESS', 'not a base-58 Solana public key');
  const vsCode = /^[a-z]{3}$/i.test(String(vs || '')) ? String(vs).toLowerCase() : 'usd';

  const key = `solana-track:wallet:${address}:${vsCode}`;
  const { value } = await withCache(key, WALLET_TTL_MS, async () => {
    const [balanceRes, tokensRes, tokens2022Res, sigsRes, priceRes] = await Promise.allSettled([
      rpc('getBalance', [address], `track:${address}`),
      rpc('getTokenAccountsByOwner', [address, { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed' }], `track:${address}`),
      rpc('getTokenAccountsByOwner', [address, { programId: TOKEN_2022_PROGRAM }, { encoding: 'jsonParsed' }], `track:${address}`),
      rpc('getSignaturesForAddress', [address, { limit: 25 }], `track:${address}`),
      fetchSimplePrices(['solana'], vsCode).catch(() => null)
    ]);

    if (balanceRes.status === 'rejected' && tokensRes.status === 'rejected' && sigsRes.status === 'rejected') {
      /* Nothing answered. That is an outage, not an empty wallet: an empty
         wallet is a real measurement and must never look like a dead node. */
      throw trackError('RPC_UNAVAILABLE', String(balanceRes.reason?.detail || balanceRes.reason?.message || 'solana rpc did not answer'));
    }

    const lamports = balanceRes.status === 'fulfilled' ? num2(balanceRes.value?.value ?? balanceRes.value) : null;
    const sol = lamports === null ? null : lamports / LAMPORTS_PER_SOL;

    const priceEntry = priceRes.status === 'fulfilled' ? priceRes.value?.solana ?? null : null;
    const price = num2(priceEntry?.[vsCode]);
    const change24h = num2(priceEntry?.[`${vsCode}_24h_change`]);

    /* Both token programs, folded into one list. A wallet that holds a
       Token-2022 asset and nothing else is not a wallet with no tokens. */
    const tokenRows = [tokensRes, tokens2022Res]
      .flatMap((res) => (res.status === 'fulfilled' ? (res.value?.value || []) : []))
      .map(tokenAccountRow)
      .filter(Boolean);
    const tokensRead = tokensRes.status === 'fulfilled' || tokens2022Res.status === 'fulfilled';
    tokenRows.sort((a, b) => b.amount - a.amount);

    const signatures = sigsRes.status === 'fulfilled' && Array.isArray(sigsRes.value) ? sigsRes.value : null;
    const now = Date.now();
    const dayAgo = now - 86_400_000;
    const transactions = (signatures || []).map((s) => {
      const at = num2(s.blockTime);
      return {
        signature: String(s.signature || ''),
        slot: num2(s.slot),
        at: at === null ? null : at * 1000,
        /* `err` is null on success and an object on failure — the node's own
           verdict. Anything else would be a guess about a real transaction. */
        failed: s.err ? true : false,
        memo: s.memo ? String(s.memo) : null
      };
    });

    const timed = transactions.filter((tx) => tx.at !== null);
    const last24h = timed.filter((tx) => tx.at >= dayAgo);

    return {
      schema: SOLANA_TRACK_SCHEMA,
      available: true,
      address,
      vs: vsCode,
      updatedAt: new Date().toISOString(),
      native: {
        symbol: 'SOL',
        lamports,
        balance: sol,
        price,
        priceChange24hPct: change24h,
        value: sol !== null && price !== null ? sol * price : null,
        currency: vsCode.toUpperCase()
      },
      tokens: tokensRead ? tokenRows.slice(0, 25) : null,
      tokenCount: tokensRead ? tokenRows.length : null,
      transactions: transactions.length ? transactions : null,
      activity: {
        /* The 24h figures come from the SAME 25 signatures the list shows, and
           say so: a node gives no total count for an address, so a number
           labelled "transactions today" over a 25-row window would be a lie.
           The window is printed beside it. */
        windowSize: transactions.length,
        last24h: last24h.length,
        failed24h: last24h.filter((tx) => tx.failed).length,
        failedInWindow: transactions.filter((tx) => tx.failed).length,
        lastAt: timed.length ? Math.max(...timed.map((tx) => tx.at)) : null
      },
      partial: {
        balance: balanceRes.status !== 'fulfilled',
        tokens: !tokensRead,
        transactions: signatures === null
      }
    };
  });

  return value;
}

/* ────────────────────────────────────────────────────────────────────────────
   3 · THE WHALES
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The rolling ledger.
 *
 * One block is ~400ms of mainnet, so a single sample would read as a coin flip:
 * sometimes three whales, sometimes none. Findings accumulate here across
 * refreshes (deduplicated by signature, capped, newest first) and a failed
 * refresh leaves it untouched — the feed ages rather than emptying, and
 * `coverage` always says how much chain it actually saw.
 */
const ledger = [];
let lastSample = null;

/**
 * Native-SOL movements inside one block.
 *
 * For every transaction the node gives `preBalances` and `postBalances` aligned
 * with the transaction's account keys, so an account's delta IS what it sent or
 * received — no instruction parsing, no program decoding, nothing inferred. A
 * movement is reported when one account drops by at least the floor and another
 * rises by at least the floor; the pair is matched largest-to-largest, which is
 * the honest reading of a block (a transaction that pays three recipients is
 * reported as three movements, each with its own amount).
 */
export function whaleMovementsFromBlock(block, { floorSol = whaleFloorSol(), slot = null } = {}) {
  const floor = Math.max(1, floorSol) * LAMPORTS_PER_SOL;
  const txs = Array.isArray(block?.transactions) ? block.transactions : [];
  const blockTime = num2(block?.blockTime);
  const out = [];

  for (const tx of txs) {
    const meta = tx?.meta;
    if (!meta || meta.err) continue; /* a failed transaction moved nothing */
    const pre = Array.isArray(meta.preBalances) ? meta.preBalances : null;
    const post = Array.isArray(meta.postBalances) ? meta.postBalances : null;
    if (!pre || !post || pre.length !== post.length) continue;

    const keys = Array.isArray(tx?.transaction?.message?.accountKeys) ? tx.transaction.message.accountKeys : [];
    if (!keys.length) continue;

    const senders = [];
    const receivers = [];
    for (let i = 0; i < pre.length; i += 1) {
      const delta = num2(post[i]) === null || num2(pre[i]) === null ? null : Number(post[i]) - Number(pre[i]);
      if (delta === null) continue;
      const key = typeof keys[i] === 'string' ? keys[i] : keys[i]?.pubkey;
      if (!key) continue;
      if (delta <= -floor) senders.push({ address: key, lamports: -delta });
      else if (delta >= floor) receivers.push({ address: key, lamports: delta });
    }
    if (!senders.length || !receivers.length) continue;

    senders.sort((a, b) => b.lamports - a.lamports);
    receivers.sort((a, b) => b.lamports - a.lamports);
    const signature = String(tx?.transaction?.signatures?.[0] || '');
    /* Pair them in size order: the biggest out with the biggest in. Where the
       counts differ, the extra side is reported against the largest counterparty
       rather than dropped — the movement happened, and hiding it because the
       split is uneven would understate the flow. */
    const pairs = Math.max(senders.length, receivers.length);
    for (let i = 0; i < pairs; i += 1) {
      const from = senders[Math.min(i, senders.length - 1)];
      const to = receivers[Math.min(i, receivers.length - 1)];
      const lamports = Math.min(from.lamports, to.lamports);
      if (lamports < floor) continue;
      if (from.address === to.address) continue;
      out.push({
        id: `${signature}:${from.address}:${to.address}`,
        signature: signature || null,
        slot: num2(tx?.slot) ?? slot,
        at: blockTime === null ? null : blockTime * 1000,
        from: from.address,
        to: to.address,
        lamports,
        sol: lamports / LAMPORTS_PER_SOL,
        asset: 'SOL',
        source: 'rpc-block-sample'
      });
    }
  }
  return out;
}

function foldIntoLedger(rows) {
  for (const row of rows) {
    const at = ledger.findIndex((x) => x.id === row.id);
    if (at === -1) ledger.push(row);
    else ledger[at] = row;
  }
  ledger.sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || b.lamports - a.lamports);
  if (ledger.length > ledgerSize()) ledger.length = ledgerSize();
}

/** Solscan's indexed transfers, reshaped into the same vocabulary. */
function fromSolscan(payload) {
  const rows = Array.isArray(payload?.transfers) ? payload.transfers : [];
  return rows.map((r) => ({
    id: `solscan:${r.id}`,
    signature: r.signature || null,
    slot: null,
    at: num2(r.time),
    from: r.fromAddress || null,
    to: r.toAddress || null,
    fromLabel: r.fromLabel || null,
    toLabel: r.toLabel || null,
    lamports: null,
    sol: num2(r.amount),
    asset: r.symbol || null,
    mint: r.mint || null,
    source: 'solscan'
  }));
}

/**
 * GET /api/solana/track/whales
 *
 * One payload, both sources, and an explicit statement of what was seen:
 * `coverage` carries the sampled slot, how many blocks that is (one per
 * refresh), the floor a movement had to clear, and which sources answered.
 * A feed with no key and no reachable node answers `available:false` and an
 * empty list — never a list of plausible-looking numbers.
 */
export async function solanaWhaleWatch({ vs = 'usd' } = {}) {
  const { value } = await withCache(`solana-track:whales:${whaleFloorSol()}`, WHALE_TTL_MS, async () => {
    const sources = [];
    const errors = [];
    let sampled = null;

    /* Solscan first: it is indexed, it carries labels, and it covers token
       movements the block sample cannot see. When the key is absent the
       keyless sample below is the whole feed. */
    if (solscanConfigured()) {
      try {
        const payload = await fetchSolanaWhales();
        const rows = fromSolscan(payload);
        if (rows.length) {
          foldIntoLedger(rows);
          sources.push('solscan');
        }
      } catch (err) {
        errors.push({ source: 'solscan', detail: String(err?.message || err).slice(0, 160) });
      }
    }

    if (blockScanEnabled()) {
      try {
        const head = await rpc('getSlot', []);
        const slot = Math.max(0, Number(head) - blockSampleLag());
        const { block, upstream } = await readBlock(slot);
        const rows = whaleMovementsFromBlock(block, { slot });
        foldIntoLedger(rows);
        sampled = {
          slot,
          head: Number(head),
          transactions: Array.isArray(block?.transactions) ? block.transactions.length : null,
          found: rows.length,
          upstream,
          at: new Date().toISOString()
        };
        lastSample = sampled;
        sources.push('rpc-block-sample');
      } catch (err) {
        errors.push({ source: 'rpc-block-sample', detail: String(err?.detail || err?.message || err).slice(0, 160) });
      }
    }

    /* SOL's price, so a movement can be read in the reader's own currency and
       not only as a count of coins. A failed price read leaves `price` null and
       the value column out — it never defaults the movement to zero dollars. */
    const vsCode = /^[a-z]{3}$/i.test(String(vs || '')) ? String(vs).toLowerCase() : 'usd';
    let price = null;
    try {
      const prices = await fetchSimplePrices(['solana'], vsCode);
      price = num2(prices?.solana?.[vsCode]);
    } catch {
      price = null;
    }

    const transfers = ledger.map((row) => ({
      ...row,
      value: row.sol !== null && price !== null ? row.sol * price : null
    }));

    const available = transfers.length > 0;
    return {
      schema: SOLANA_WHALE_SCHEMA,
      available,
      vs: vsCode,
      solPrice: price,
      updatedAt: new Date().toISOString(),
      floorSol: whaleFloorSol(),
      transfers,
      coverage: {
        /* ONE block per refresh, and the ledger says how far back it reaches.
           This is the sentence that keeps a sample from reading as a census. */
        blocksPerRefresh: blockScanEnabled() ? 1 : 0,
        lastSample: sampled || lastSample,
        ledgerSize: transfers.length,
        oldestAt: transfers.length ? Math.min(...transfers.map((t) => t.at ?? Infinity)) : null,
        newestAt: transfers.length ? Math.max(...transfers.map((t) => t.at ?? 0)) : null,
        sources,
        solscanConfigured: solscanConfigured(),
        blockScanEnabled: blockScanEnabled(),
        errors
      },
      /* An unavailable feed still reports WHY, so the screen can say "no key
         and no node answered" instead of "no whales". */
      reason: available ? null : (errors.length ? 'UPSTREAM_UNAVAILABLE' : 'NO_MOVEMENTS_IN_SAMPLE')
    };
  });

  return value;
}
