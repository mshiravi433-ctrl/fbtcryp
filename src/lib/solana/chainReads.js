/**
 * SOLANA CHAIN READS — one honest implementation of «what does this wallet hold?»
 * ============================================================================
 *
 * THE REPORT (2026-09-23)
 * «اتصال به کیف پول درسته هم در اصلی هم سولانا، اما برای امضا و خرید با سولانا
 *   در بیشتر اوقات می‌زنه موجودی کیف پول کم یا RPC را چک کنید.»
 *
 * The connection really was fine — the diagnostics say so (MWA registered,
 * address present, every signing capability supported). What failed was the
 * PRE-FLIGHT: before the wallet is ever opened, the Solana swap screen reads
 * three things from a public RPC node and refuses to sign unless it can:
 *
 *     const balancesNow = await loadWalletBalances();
 *     if (!balancesNow) throw new Error('BALANCE_UNAVAILABLE');   ← «RPC را چک کنید»
 *     if (balancesNow.sourceRaw < rawAmount) throw new Error('INSUFFICIENT_BALANCE');
 *
 * Two different sentences, one broken read behind each of them.
 *
 * ─── WHY IT SAID «CHECK THE RPC» MOST OF THE TIME ───────────────────────────
 * The old reader was `new Connection(await solanaRpcUrl())` plus three web3.js
 * calls. That is the weakest possible shape for a phone in Iran inside a
 * Telegram WebView:
 *
 *   · ONE node. `solanaRpcUrl()` returns the winner of a health probe and that
 *     winner is remembered for five minutes. A node that answered `getHealth`
 *     at 09:31 and started answering 429 at 09:32 stayed the only node tried
 *     until 09:36 — every read in between failed, and the swap screen has no
 *     other source, so every tap in that window was «RPC را چک کنید».
 *   · NO TIMEOUT. `@solana/web3.js` fetches without a deadline. On a network
 *     that black-holes packets the call does not fail, it HANGS, and the
 *     button spun instead of answering.
 *   · FAILURES WERE UNNAMED AND FORGOTTEN. The thrown error was a transport
 *     string; the RPC layer's cooldown map (which exists precisely so the next
 *     read skips a host that just refused us) was never taught, because only
 *     `solanaRpcCall()` teaches it and web3.js does not go through it.
 *   · THREE HEAVY CALLS AT ONCE, every time — including one whose answer
 *     cannot change the verdict (see «the third read» below).
 *
 * ─── WHY IT SAID «BALANCE TOO LOW» WHEN THE WALLET WAS NOT EMPTY ────────────
 * Two independent ways, both fixed here:
 *
 *   1. TOKEN-2022. `getParsedTokenAccountsByOwner(owner, { mint })` returns
 *      only accounts under the token program the NODE resolves for that mint.
 *      A mint whose program is `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
 *      comes back as an empty list on nodes that do not resolve it, and an
 *      empty list read as «balance 0» is exactly «موجودی کافی نیست». So a zero
 *      answer is now VERIFIED against the mint account before it is believed,
 *      and re-asked with the token-2022 program filter when the mint says so.
 *   2. GUESSED DECIMALS. A pasted mint was stored with `decimals: 9`, and that
 *      guess is what converts the amount the user typed into base units — so
 *      for a 6-decimal token the screen asked Jupiter for 1000× the holding
 *      and compared 1000× the holding against the real balance. Both answers
 *      were «insufficient», and the balance line on screen showed a number
 *      1000× smaller than the truth. This reader now returns the decimals the
 *      CHAIN reports (`tokenAmount.decimals`, or the mint account), so the
 *      caller can tell a verified scale from a guess — see swapPreflight.js for
 *      what it does with that difference.
 *
 * ─── WHAT THIS MODULE IS ────────────────────────────────────────────────────
 * The read plan and its parsers, with the transport INJECTED as `call(url,
 * method, params)`. One implementation, three callers, no drift:
 *
 *   · the browser (lib/solanaWallet.js) — public candidates from lib/solanaRpc.js,
 *     then our own backend, which the quote already proves is reachable;
 *   · the server (server/solanaChainReads.js) — SOLANA_RPC_URL first, so a
 *     private node is used when one is configured;
 *   · the tests — a fake `call`, no network, no wallet.
 *
 * It imports nothing browser-only and nothing from the store, which is why the
 * server can import it too. Failures come back NAMED (RPC_BLOCKED,
 * RPC_RATE_LIMITED, RPC_TIMEOUT, RPC_ERROR, RPC_UNAVAILABLE) with the per-host
 * attempt list attached, because «retry later» and «these nodes refuse this
 * network path, put your own RPC in Settings» are different instructions and
 * the screen has a sentence for each.
 */

/** Wrapped SOL — the mint Jupiter uses for the native coin. */
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** The classic SPL Token program. */
export const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Token-2022 (token extensions). A mint under this program has token accounts
 * under it too, and a `{ mint }` filter does not always find them.
 */
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/** SOL's own scale. Immutable, so it is the one scale nobody has to read. */
export const SOL_DECIMALS = 9;

/** The base fee, in lamports. What a transaction costs before any priority fee. */
export const BASE_FEE_LAMPORTS = 20_000n;

/**
 * Rent for one token account, rounded up from the real 2,039,280 lamports.
 *
 * The swap needs this only when the OUTPUT token has no account yet: creating
 * it is part of the same transaction and it is paid in SOL. Rounding up is
 * deliberate — being 60k lamports optimistic is a failed transaction, being
 * pessimistic is a wallet prompt that then succeeds.
 */
export const ATA_RENT_LAMPORTS = 2_100_000n;

const shortHost = (url) => {
  try { return new URL(String(url)).hostname; } catch { return String(url || '?').slice(0, 40); }
};

/**
 * Sum the token accounts a `getParsedTokenAccountsByOwner` answer describes.
 *
 * @param {Array|null|undefined} value `result.value` from the node
 * @param {string|null} [mint] when the query was filtered by PROGRAM (not by
 *        mint) every row must be matched against the mint here, or a wallet
 *        holding three tokens reports the sum of all three as one balance.
 * @returns {{raw:bigint, decimals:number|null, accounts:number, exists:boolean, program:string|null}}
 */
export function parseTokenAccountRows(value, mint = null) {
  const rows = Array.isArray(value) ? value : [];
  let raw = 0n;
  let decimals = null;
  let accounts = 0;
  let program = null;
  for (const row of rows) {
    const info = row?.account?.data?.parsed?.info;
    if (!info) continue;
    if (mint && String(info.mint || '') !== String(mint)) continue;
    const amount = info?.tokenAmount?.amount;
    if (amount == null) continue;
    let add = 0n;
    try { add = BigInt(String(amount)); } catch { continue; }
    raw += add;
    accounts += 1;
    const d = Number(info?.tokenAmount?.decimals);
    if (decimals == null && Number.isInteger(d) && d >= 0 && d <= 18) decimals = d;
    if (!program) program = String(row?.account?.owner || '') || null;
  }
  return { raw, decimals, accounts, exists: accounts > 0, program };
}

/**
 * Read a MINT account (jsonParsed) — the authoritative scale of a token.
 *
 * @returns {{decimals:number|null, program:string|null, token2022:boolean, supply:string|null,
 *            mintAuthority:string|null, freezeAuthority:string|null}|null}
 */
export function parseMintAccount(value) {
  if (!value || typeof value !== 'object') return null;
  const info = value?.data?.parsed?.info;
  if (!info || typeof info !== 'object') return null;
  const d = Number(info.decimals);
  const program = String(value.owner || '') || null;
  return {
    decimals: Number.isInteger(d) && d >= 0 && d <= 18 ? d : null,
    program,
    token2022: program === TOKEN_2022_PROGRAM,
    supply: info.supply != null ? String(info.supply) : null,
    mintAuthority: info.mintAuthority ? String(info.mintAuthority) : null,
    freezeAuthority: info.freezeAuthority ? String(info.freezeAuthority) : null
  };
}

/**
 * Does this answer still need the third read?
 *
 * The output token's account is read for ONE reason: to know whether the swap
 * must also pay its creation rent. When the wallet's SOL already covers the
 * worst case (the input amount, if the input IS SOL, plus the rent), the
 * answer cannot change the verdict — so the call is not made. Two requests
 * instead of three on every wallet that is not running on empty, which on a
 * rate-limited public node is the difference between an answer and a 429.
 *
 * Exported because it is the whole reason the call count differs between the
 * two cases, and a test that cannot see the decision cannot pin it.
 *
 * @param {bigint} solLamports
 * @param {bigint|null} rawAmount the input amount in base units, when the input is SOL
 * @returns {boolean} true when the output account must be read
 */
export function outputAccountCheckNeeded(solLamports, rawAmount) {
  const sol = typeof solLamports === 'bigint' ? solLamports : 0n;
  const need = (typeof rawAmount === 'bigint' ? rawAmount : 0n) + ATA_RENT_LAMPORTS;
  return sol < need;
}

/**
 * Read everything the swap pre-flight needs, from ONE node.
 *
 * Never throws: a failure is `{ ok:false, reason, step }` so the walker above
 * can try the next node and the caller can name the outcome honestly.
 *
 * @param {string} url
 * @param {object} p
 * @param {(url:string, method:string, params:unknown[], opts?:object)=>Promise<{ok:boolean,reason?:string,detail?:string,result?:any}>} p.call
 * @param {string} p.owner
 * @param {string} p.inputMint
 * @param {string} p.outputMint
 * @param {bigint|null} [p.rawAmount] input amount in base units (SOL only, for the rent decision)
 * @param {number} [p.timeoutMs]
 */
export async function readSwapBalancesOn(url, { call, owner, inputMint, outputMint, rawAmount = null, timeoutMs, signal = null }) {
  /* `signal` lets the caller cancel a walk that has already been answered by
     another door (see lib/solana/balanceSource.js). It is forwarded to every
     call rather than checked between them, so a node that is mid-request is
     released instead of finishing for nobody. */
  const opts = { ...(timeoutMs ? { timeoutMs } : {}), ...(signal ? { signal } : {}) };
  /*
   * A transport that THROWS is treated exactly like one that reports a failure.
   *
   * `solanaRpcCall` never throws by contract — it answers `{ ok:false, reason }`
   * — but this reader is handed its transport from the outside (the browser,
   * the server, the tests), and a read that throws escapes as an unnamed
   * exception: the screen's `catch` would swallow it into the generic
   * «BALANCE_UNAVAILABLE» again, which is the bug this module exists to remove.
   * So the one property the caller relies on — a read returns an answer, never
   * an exception — is enforced here rather than assumed.
   */
  const safeCall = async (target, method, params, callOpts) => {
    try {
      const r = await call(target, method, params, callOpts);
      return r && typeof r === 'object' ? r : { ok: false, reason: 'BAD_RESPONSE' };
    } catch (err) {
      return { ok: false, reason: 'UNREACHABLE', detail: String(err?.message || err || '').slice(0, 160) };
    }
  };
  const fail = (r, step) => ({ ok: false, url, reason: r?.reason || 'RPC_UNAVAILABLE', detail: r?.detail || null, step });
  const isSolInput = inputMint === SOL_MINT;
  const isSolOutput = outputMint === SOL_MINT;
  const calls = [];
  const track = (p) => { calls.push(p); return p; };

  /* 1 — the native balance. Also the whole answer when the input IS SOL. */
  const bal = await track(safeCall(url, 'getBalance', [owner, { commitment: 'confirmed' }], opts));
  if (!bal?.ok) return fail(bal, 'getBalance');
  const solLamports = BigInt(Number(bal.result?.value ?? 0));

  /* 2 — the input token, unless the input is SOL itself. */
  let sourceRaw = solLamports;
  let sourceDecimals = SOL_DECIMALS;
  let sourceProgram = null;
  let sourceVerified = true;
  if (!isSolInput) {
    const rows = await track(safeCall(
      url,
      'getParsedTokenAccountsByOwner',
      [owner, { mint: inputMint }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
      opts
    ));
    if (!rows?.ok) return fail(rows, 'tokenAccounts:input');
    const parsed = parseTokenAccountRows(rows.result?.value, inputMint);
    sourceRaw = parsed.raw;
    sourceProgram = parsed.program;
    sourceDecimals = parsed.decimals;

    /*
     * A scale nobody reported, or an empty answer: ask the MINT.
     *
     * The mint account carries the real decimals and the program that owns the
     * token's accounts. When that program is token-2022 and the mint-filtered
     * query came back empty, the empty answer is the node's limitation, not
     * the wallet's balance — so it is re-asked with the program filter and
     * matched by mint here. Believing the first empty answer is what told a
     * funded wallet «موجودی کافی نیست».
     */
    if (sourceDecimals == null || parsed.accounts === 0) {
      const mintAcc = await track(safeCall(
        url,
        'getAccountInfo',
        [inputMint, { encoding: 'jsonParsed', commitment: 'confirmed' }],
        opts
      ));
      if (mintAcc?.ok) {
        const m = parseMintAccount(mintAcc.result?.value);
        if (m) {
          if (m.decimals != null) sourceDecimals = m.decimals;
          sourceProgram = sourceProgram || m.program;
          if (m.token2022 && parsed.accounts === 0) {
            const t22 = await track(safeCall(
              url,
              'getParsedTokenAccountsByOwner',
              [owner, { programId: TOKEN_2022_PROGRAM }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
              opts
            ));
            if (t22?.ok) {
              const p22 = parseTokenAccountRows(t22.result?.value, inputMint);
              if (p22.accounts > 0) {
                sourceRaw = p22.raw;
                if (p22.decimals != null) sourceDecimals = p22.decimals;
                sourceProgram = p22.program || TOKEN_2022_PROGRAM;
              }
            }
          }
        }
      }
    }
    /* Decimals nobody could report: the caller must NOT compare a guessed
       scale against a real balance, so the read says so. */
    sourceVerified = sourceDecimals != null;
    if (sourceDecimals == null) sourceDecimals = SOL_DECIMALS;
  }

  /* 3 — the output account, only when its existence can change the verdict. */
  let outputAccountExists = true;
  let outputAssumed = false;
  let outputDecimals = null;
  if (!isSolOutput) {
    const needed = outputAccountCheckNeeded(solLamports, isSolInput ? rawAmount : null);
    if (!needed) {
      outputAssumed = true;
    } else {
      const rows = await track(safeCall(
        url,
        'getParsedTokenAccountsByOwner',
        [owner, { mint: outputMint }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
        opts
      ));
      if (!rows?.ok) return fail(rows, 'tokenAccounts:output');
      const parsed = parseTokenAccountRows(rows.result?.value, outputMint);
      outputAccountExists = parsed.exists;
      outputDecimals = parsed.decimals;
      if (!parsed.exists) {
        /* Same rule as the input: an empty answer is verified against the mint
           before it is believed, because «no account» here means «this swap
           needs 0.0021 SOL of rent» — a verdict that must not come from a
           node that simply could not see a token-2022 account. */
        const mintAcc = await track(safeCall(
          url,
          'getAccountInfo',
          [outputMint, { encoding: 'jsonParsed', commitment: 'confirmed' }],
          opts
        ));
        if (mintAcc?.ok) {
          const m = parseMintAccount(mintAcc.result?.value);
          if (m) {
            if (m.decimals != null) outputDecimals = m.decimals;
            if (m.token2022) {
              const t22 = await track(safeCall(
                url,
                'getParsedTokenAccountsByOwner',
                [owner, { programId: TOKEN_2022_PROGRAM }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
                opts
              ));
              if (t22?.ok) {
                const p22 = parseTokenAccountRows(t22.result?.value, outputMint);
                if (p22.accounts > 0) outputAccountExists = true;
              }
            }
          }
        }
      }
    }
  }

  return {
    ok: true,
    url,
    solLamports,
    sourceRaw,
    /* The scale the CHAIN reported for the input token, or null when nothing
       reported one. `sourceDecimals` alone stays a number so existing callers
       keep working; `sourceDecimalsVerified` is the new, honest bit. */
    sourceDecimals,
    sourceDecimalsVerified: sourceVerified,
    sourceProgram,
    outputAccountExists,
    outputAssumed,
    outputDecimals,
    calls: calls.length
  };
}

/**
 * Walk the candidate nodes until one answers.
 *
 * A success stops the walk — including an EMPTY token list, which is a real
 * answer for a wallet that has never held the token. Only a failed CALL moves
 * to the next node, which is the same rule the lending reads follow.
 *
 * @returns {Promise<{ok:true, url:string, attempts:Array, ...}|{ok:false, code:string, attempts:Array, hosts:Array, detail:string}>}
 */
export async function readSwapBalancesAcross({ call, candidates = [], owner, inputMint, outputMint, rawAmount = null, timeoutMs, signal = null }) {
  const attempts = [];
  for (const url of candidates) {
    if (!url) continue;
    /* Another door answered while we were walking: stop asking nodes. */
    if (signal?.aborted) break;
    const r = await readSwapBalancesOn(url, { call, owner, inputMint, outputMint, rawAmount, timeoutMs, signal });
    if (r?.ok) return { ...r, attempts };
    attempts.push({ url, host: shortHost(url), reason: r?.reason || 'RPC_UNAVAILABLE', detail: r?.detail || null, step: r?.step || null });
  }
  return { ok: false, code: nameSolanaReadFailure(attempts), attempts, hosts: hostSummary(attempts), detail: detailOf(attempts), url: null };
}

/**
 * Name a total failure, in the order a user can act on it.
 *
 *   1. a node REFUSED us (401/403/451) → RPC_BLOCKED. Retrying the same way
 *      will not help; another network path or the user's own RPC will.
 *   2. otherwise a node throttled us (429) → RPC_RATE_LIMITED, which a retry
 *      genuinely fixes.
 *   3. every attempt timed out → RPC_TIMEOUT.
 *   4. every attempt was a transport failure → RPC_ERROR (the network path).
 *   5. anything else → RPC_UNAVAILABLE. Never guessed into a cause.
 */
export function nameSolanaReadFailure(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  if (!list.length) return 'RPC_UNAVAILABLE';
  if (list.some((a) => a.reason === 'BLOCKED')) return 'RPC_BLOCKED';
  if (list.some((a) => a.reason === 'RATE_LIMITED')) return 'RPC_RATE_LIMITED';
  if (list.every((a) => a.reason === 'TIMEOUT')) return 'RPC_TIMEOUT';
  if (list.every((a) => a.reason === 'UNREACHABLE')) return 'RPC_ERROR';
  return 'RPC_UNAVAILABLE';
}

/** `host:REASON | host:REASON` — the line support reads instead of a guess. */
export function hostSummary(attempts) {
  return (Array.isArray(attempts) ? attempts : [])
    .map((a) => ({ host: a.host || shortHost(a.url), reason: a.reason || 'RPC_UNAVAILABLE' }));
}

/** The same information as one short string, for a thrown Error's `detail`. */
export function detailOf(attempts) {
  return hostSummary(attempts).map((h) => `${h.host}:${h.reason}`).join(' | ').slice(0, 200);
}

/* ── MINT INFO ──────────────────────────────────────────────────────────────
   The scale of a token, read once and remembered. Decimals are immutable for
   the life of a mint, so a session cache is not a staleness risk — it is the
   reason a screen that quotes five times makes one call. */

const mintCache = new Map();

/** Forget the cache (a network switch, or a test). */
export function clearMintInfoCache() { mintCache.clear(); }

/** Read one mint account from one node. Never throws. */
export async function readMintInfoOn(url, { call, mint, timeoutMs, signal = null }) {
  let r;
  try {
    r = await call(
      url,
      'getAccountInfo',
      [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }],
      { ...(timeoutMs ? { timeoutMs } : {}), ...(signal ? { signal } : {}) }
    );
  } catch (err) {
    /* Same rule as the balance read: a transport that throws is a failed
       attempt, not an exception the caller has to catch. */
    return { ok: false, url, reason: 'UNREACHABLE', detail: String(err?.message || err || '').slice(0, 160) };
  }
  if (!r?.ok) return { ok: false, url, reason: r?.reason || 'RPC_UNAVAILABLE', detail: r?.detail || null };
  const parsed = parseMintAccount(r.result?.value);
  if (!parsed) return { ok: false, url, reason: 'NOT_A_MINT', detail: null };
  return { ok: true, url, mint, ...parsed };
}

/**
 * The scale of a mint, walking the candidates.
 *
 * @returns {Promise<{ok:true, decimals:number|null, program:string|null, token2022:boolean, via:string, cached:boolean}|{ok:false, code:string, hosts:Array, detail:string}>}
 */
export async function readMintInfoAcross({ call, candidates = [], mint, timeoutMs, useCache = true, signal = null }) {
  const key = String(mint || '');
  if (useCache && mintCache.has(key)) return { ...mintCache.get(key), cached: true };
  const attempts = [];
  for (const url of candidates) {
    if (!url) continue;
    if (signal?.aborted) break;
    const r = await readMintInfoOn(url, { call, mint: key, timeoutMs, signal });
    if (r?.ok) {
      const value = { ok: true, mint: key, decimals: r.decimals, program: r.program, token2022: r.token2022, supply: r.supply, mintAuthority: r.mintAuthority, freezeAuthority: r.freezeAuthority, via: url, cached: false };
      if (useCache && r.decimals != null) mintCache.set(key, value);
      return value;
    }
    attempts.push({ url, host: shortHost(url), reason: r?.reason || 'RPC_UNAVAILABLE', detail: r?.detail || null });
  }
  return { ok: false, code: nameSolanaReadFailure(attempts), attempts, hosts: hostSummary(attempts), detail: detailOf(attempts) };
}
