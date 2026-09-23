# Solana swap: the balance read behind "check your RPC" now walks every node, and our own backend is the last door

**Date:** 2026-09-23 · **Scope:** `src/lib/solana/chainReads.js` (new), `src/lib/solana/balanceSource.js` (new),
`src/lib/solana/swapPreflight.js` (new), `server/solanaChainReads.js` (new), `server/app.js`,
`src/lib/solanaWallet.js`, `src/pages/SolanaSwap.jsx`, `src/lib/solana/health.js`,
`src/components/WalletHealthPanel.jsx`, locales, `test/solana-swap-chain-reads.test.js` (new)

## The report this fixes

> «اتصال به کیف پول درست است … اما برای امضا و خرید با سولانا در بیشتر اوقات خطای
> "موجودی کیف پول کم یا RPC را چک کنید" نمایش داده می‌شود.»

The device's own diagnostic agreed with the first half and contradicted the second:

```
Solana: transport=standard   MWA: PASS  registered
address: AMU6pRs8Hs9FEcA2hgcvrWeVprqvMPSJoQzEkB3kqFoR
capabilities: connect, signTransaction, signAndSendTransaction, signMessage, publicKey
channel: telegram/android/webview     injected phantom/solflare/backpack: none detected
verify.walletconnect.org: NO_JWT_WITHIN_BUDGET (filtered on this network)
/.well-known/assetlinks.json: NOT_DEPLOYED (404)
```

**The wallet connection was never broken.** What was broken is the read that *gates* signing:
one balance lookup, made straight from the device to one public Solana node, and the swap
button's verdict was derived from its answer.

## Why it failed — five independent faults, all on the read path

| # | Fault | Consequence |
|---|-------|-------------|
| 1 | **The scale of a user-imported token was guessed.** `SolanaSwap.jsx` used `decimals ?? 9` and `SolanaLend.jsx` used `decimals ?? 9` / `?? 6` — and only ever asked `spl-token`. | A 6-decimal token read as 9: the user's balance looked **1000× smaller** → "insufficient balance" while holding plenty. |
| 2 | **Token-2022 mints were read with the classic SPL filter.** `getTokenAccountsByOwner(owner, {mint})` against `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` returns **zero rows** for a mint owned by `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`. | A real balance read as **exactly 0** → an honest-looking "you have none". |
| 3 | **The balance read bypassed the hardened RPC layer.** `getSolanaSwapBalances` used `web3.Connection` on the *first* cluster URL only — no timeout, no failover, no named error, and it ignored `SOLANA_RPC_URL`. The same file also read SOL through `getBalance` (a JSON **number**) instead of `tokenAmount`-style exact strings. | One slow or blocked node = no balances at all. A cached URL that started returning 429 was **never abandoned**. |
| 4 | **An unreadable balance was reported as a broken wallet.** `loadWalletBalances` threw `BALANCE_UNAVAILABLE` and disabled the button, so a network hiccup read as "your wallet/RPC is wrong". | The user cannot swap even when the wallet and the chain are fine. |
| 5 | **The gas check ignored a missing output account.** Creating a token account costs **2,100,000 lamports rent**, but the rule was `sol < amount + baseFee(20,000)`. | A swap that needs a new ATA was judged affordable, then failed at broadcast — and `signAndSendSolana`'s regex mapped many broadcast failures onto `INSUFFICIENT_BALANCE`, so the message blamed the balance again. |

Public mainnet nodes rate-limit per IP (≈40 req/10 s per endpoint, 100 per 10 s overall) and are
documented as unsuitable for production traffic. From a filtered mobile network the same endpoints
are frequently unreachable outright. A single-shot client read is therefore expected to fail
*often*, not occasionally.

## What changed

### 1. `src/lib/solana/chainReads.js` — pure read layer (no transport policy, no globals)

```js
readSwapBalancesOn(url, {owner, inputMint, outputMint, timeoutMs, signal, call})
readSwapBalancesAcross(urls, …)   // → {ok, balances, reason, hosts:[{host,reason}], url}
readMintInfoOn/Across(…)          // → {mint, decimals, supply, verified}
mintCache / clearMintInfoCache    // exact decimals, TTL'd, never cached while unverified
```

- Transport is **injected** (`call(url, method, params, opts)`), so every branch is testable
  without a cluster — and a throwing transport becomes `{ok:false, reason:'UNREACHABLE'}`, never an
  escaped exception.
- **The SOL balance is read as an SPL token account** (`getAccountInfo` on the native-mint ATA) so
  the amount arrives as an exact string; it falls back to `getBalance` (which `jsonParsed` encodes as
  a string) — lamports are kept as `BigInt` end to end, because `Number(lamports)` silently loses
  precision above 2^53.
- **Token-2022**: the spl-token read and the token-2022 read are issued together, and the one that
  returns an account wins. A zero is only believed after `readMintInfoAcross` confirms the mint
  exists and its supply is zero (`verified`). An unverifiable zero stays `unverified` — the page
  must not judge the wallet on it.
- `nameSolanaReadFailure` ranks the per-host outcomes into one honest code:
  `BLOCKED > RATE_LIMITED > TIMEOUT > ERROR > UNAVAILABLE`, with `hostSummary`/`detailOf` listing
  *which* node said *what*.
- **Cooperative cancellation**: every read accepts a `signal` and the multi-node walk breaks the
  moment another door has answered, so a lost race does not keep hammering nodes.

### 2. `server/solanaChainReads.js` + two routes — our backend is the last door

```
GET /api/solana/balances?owner=&inputMint=&outputMint=   → fbt.solana-balances.v1   (no-store)
GET /api/solana/token-info?mint=                         → fbt.solana-token-info.v1 (cached 1 d)
```

- Uses the **server's** `SOLANA_RPC_URL` when set, otherwise the same mainnet candidate list, and
  walks it with the identical code — the server has a different IP and no mobile-webview limits.
- 400 `BAD_OWNER|BAD_MINT` for anything that is not base58; 502 carries the *named* reason plus the
  per-host table, so a failure is still evidence rather than an excuse.
- Lamports and token amounts leave the server as **strings** (the schema says so); in-flight
  identical reads are deduped for 1.5 s; every positive read is cached (balances 4 s, token info 1 h)
  and every failure is cached only briefly.

### 3. `src/lib/solana/balanceSource.js` — two doors, first honest answer wins

`readSolanaSwapBalances` / `readSolanaTokenInfo` / `readSolanaNativeLamports`:

- Door A: the device, through `solanaRpcCall` (timeout, URL failover, named errors).
- Door B: `FBT_API`/`apiBase`, opened ~1.2 s after A so a merely-slow node still wins the race.
- `firstOk([direct, server], cancel)` — **the loser's request is aborted** (no wasted quota, no
  leaked socket), and a total failure resets the remembered RPC winner so the next attempt starts
  from a different node.
- The result always reports `via` (`'rpc' | 'server'`), `serverTried`, `serverCode`, `serverStatus`
  and `hosts` — and **throws nothing**: `ok:false` plus a `code` is the contract.

### 4. `src/lib/solana/swapPreflight.js` — the gate can only speak when it has read the chain

`solanaSwapPreflight({balances, balanceCode, rawAmount, amountScaleVerified, isSolInput})`:

- `balances === null` (nothing readable) → `ok:true` **plus a notice**: the user is told which door
  failed, and the wallet's own simulation becomes the authority. No more dead button.
- The amount comparison runs **only when `amountScaleVerified`** — a guessed scale can never decide
  that someone is short. SOL is verified by definition (9 decimals, protocol constant).
- Gas: `base fee 20,000 lamports`, **+2,100,000 lamports when the output token account does not
  exist yet**, plus the input amount when the user is paying in SOL. `need`/`have`/`shortfall` are
  returned as `BigInt` lamports so the UI can state the exact shortfall.

### 5. `src/pages/SolanaSwap.jsx` — scale is *resolved*, never guessed

- `BASE_TOKENS` rows carry `decimalsVerified`; a pasted/imported mint starts `decimalsVerified:false`
  and is resolved by `resolveTokenScale(mint)` (backend token-info → chain mint info → Jupiter list).
  Until it resolves, the amount gate stays silent and the row is labelled as unverified.
- `loadWalletBalances` records `balanceCode` / `balanceHosts` / `preflightNotice` instead of throwing;
  `swap()` runs the preflight, shows the notice, and only blocks on a **verified** shortfall.
- An unchanged read is skipped: re-reading the same `(address, mint pair)` within its freshness window
  is not a new fact.

### 6. Diagnostics you can read on the device

`measureSolanaChainRead(address)` in `src/lib/solana/health.js` performs one real SOL read, times it,
and reports **which door answered**:

```jsonc
chainRead: { ok:true,  via:'server', host:'fbtswap.ir', ms:412, calls:3, solLamports:'…', sol:'0.42' }
chainRead: { ok:false, code:'BLOCKED', hosts:[{host:'…',reason:'BLOCKED'}], serverTried:true, serverCode:'RPC_ERROR' }
```

It is included in `collectSolanaHealth` (`includeChainRead`, default `true`, skipped without an
address, and it never throws) and rendered by `WalletHealthPanel.jsx` as a **Chain read** row above
the signing row: on success `via · host · ms · calls · SOL`, on failure the code, whether our backend
was tried and its status, and the per-host reasons.

## Verify it yourself

```bash
npm run test:solana-swap                    # 36 checks: read layer, preflight, both doors, cancellation
node test/wallet-diagnostics-probe.mjs      # 154 checks (health report incl. the chain-read row)
npx vitest run test/wallet-health-panel.test.jsx test/solana-connect-sheet.test.jsx
node server/index.js                        # then:
curl -s 'http://127.0.0.1:8791/api/solana/token-info?mint=zz'
#   {"ok":false,"code":"BAD_MINT"}                                                     HTTP 400
curl -s 'http://127.0.0.1:8791/api/solana/balances?owner=AMU6…&inputMint=So111…&outputMint=EPjF…'
#   sandbox (no egress): {"ok":false,"code":"RPC_ERROR",
#     "detail":"solana-rpc.publicnode.com:UNREACHABLE | solana.drpc.org:UNREACHABLE | …",
#     "hosts":[{"host":"…","reason":"UNREACHABLE"}, …]}                                HTTP 502
```

(Captured before the merge with `main`; the walked list is now `main`'s seven public hosts — plus
`SOLANA_RPC_URL` first when it is set — and each of them is reported by name in the same shape.)

On the device: **Wallet health → Chain read**. `via: rpc` means your network reached a node directly;
`via: server` means the backend answered for you; a failure row names every node that refused.

### Audit deltas (same machine, same flags, after merging `origin/main` = `f63e2dc`)

| | `origin/main` | this branch |
|---|---|---|
| `test/wiring.mjs` assertions | 2699 | **2709** (+11 for this fix, −1 replaced) |
| wiring failures | 14 | **14** — the *identical* names, all pre-existing |
| first-paint bundle (`vite build`) | 1559 KB | **1580 KB** (+21 KB) |
| `vite build` | ✓ 40.9 s | ✓ 39.2 s |
| Solana/loan/panel suites | — | **221/221** over 11 files |

The bundle ratchet (`< 1360 KB`) already fails on `main` — pre-existing drift, **not** introduced
here; this feature's own cost is the +21 KB of read layer, preflight and locale strings. The 14
unrelated failures (`intentOS.proof.hide`, unrouted `brain/financial/*` and `v1/ai/os`, WC metadata,
`lending.js` aToken addresses, built-in `logoURI`, `loan.fbtFeeNone` 0.70% copy, About light theme,
SegIndicator id, environments route) are listed by the audit and left untouched on purpose.

### How this sits next to the read-only RPC relay that landed the same day

`main` gained `POST /api/solana/rpc` (`server/solanaRpcRelay.js`) — a generic, allowlisted,
**read-only** relay that speaks plain JSON-RPC so `new Connection(relayUrl)` works, used by the loan
tab's Kamino reads. Same diagnosis ("a 403 is a decision about the CALLER's IP, and the one origin a
browser demonstrably reaches is our own"), different shape, and the two compose:

- **All three methods this read layer puts on the wire** — `getAccountInfo`, `getBalance`,
  `getParsedTokenAccountsByOwner` — are in the relay's allowlist (the last one through its
  `RELAY_METHOD_ALIASES`), so nothing here can be stranded by it.
- Door A inherits `main`'s improved candidate list (7 public hosts), its per-host cooldowns, the new
  `UNUSABLE` class and the persisted "publics are blocked" hint — `solanaRpcCall` is unchanged in
  signature, so this branch needed no adaptation.
- The swap read still goes to the **purpose-built** endpoints rather than the generic relay, because
  for a phone on a throttled path one request that returns the whole verified read (`fbt.solana-balances.v1`,
  exact-string lamports, mint-verified zeros, server-side cache) beats three relayed hops — and the
  two doors cancel each other, so the losing path costs nothing.
- Both are read-only by construction: neither broadcasts, and `getSolanaRpcUrl()` (the endpoint a
  signature is sent to) never returns a relay URL — §30 holds on both paths.

### The service worker shell

Every client-side change in this repo is worthless to an installed PWA until the shell cache name
moves, so `public/sw.js` goes **`fbt-shell-v24` → `fbt-shell-v25`** with a `v24 -> v25:` paragraph
naming the four client-side fixes above. Without it, a device that already opened the app keeps
running the old bytes and the report reads as "the fix did not go live".

## Deploy notes

- The two routes ship in the same server as the frontend; a **backend that predates them** is handled
  (404/JSON-mismatch → the client keeps the direct answer or reports `SERVER_UNAVAILABLE`), so
  ordering is safe — but the fallback only exists once the backend is deployed.
- `SOLANA_RPC_URL` (already in `.env.example`) is now also the read endpoint's node. A keyless
  default works; a private node makes the fallback door materially more reliable.
- No secret, key or fingerprint is invented anywhere in this change.

## What this deliberately did **not** change

- **`signAndSendSolana`'s error regex** still over-maps some broadcast failures onto
  `INSUFFICIENT_BALANCE`. Fault #5's *cause* (missing ATA rent) is now checked up front, but the
  mapping itself deserves its own patch with broadcast-level evidence.
- **`/.well-known/assetlinks.json` is still absent** — that is why Phantom shows "identity could not
  be verified" in Android WebView. `scripts/assetlinks.mjs` refuses to fabricate a fingerprint:
  it needs the **release keystore** SHA-256 (`--keystore=… | --fingerprint=…`), which only the
  signing owner has. Run it, deploy the file, and the row turns green.
