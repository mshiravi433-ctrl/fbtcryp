# Email/Social Attach Fix — fbtswap.ir (2026-09-18, report #2)

## Bug Reported (Persian)

> «اتصال والت کانتکت هنوز در سایت درست نشده … با روش سریع در گوگل تیک سبز
> می‌آید، دوباره صفحه‌ای که می‌گوید کیف پول را وصل کنید [می‌آید].»
>
> «ورود ایمیل انجام شد، اما کیف پول در این صفحه آماده نشد. یک بار دیگر تلاش
> کنید یا برنامه را ببندید و باز کنید؛ اتصال شما از دست نرفته است.»

The device report (`WalletHealthPanel`) that came with it:

| fact | value |
|---|---|
| storage | `sdkLoginMarker:true` · `ourMarker:true` · `connectionStatus:'connected'` · `storedConnectors:['AUTH']` · `wcSessionKeys:0` |
| shared | `isConnected:true` · `connectorId:'AUTH'` · `authEntries:1` · **`authAccounts:2`** · `view:'Connect'` · `noAdapters:false` |
| relay | OPEN (785 ms) — nothing about the relay is broken |
| trace | `email_sign_probe_failed {m:'NO_ACCOUNTS'}` ×N, each burst ended by `email_attach_failed_pending` |

So: the login DID complete, the SDK's storage DOES hold a session, the app's own
shared map carries **two accounts** — and every attach still died on
`NO_ACCOUNTS`.

## Root Cause

`probeSigning()` (`src/lib/wc/embedded.js`) asks the provider
`eth_accounts`, and treats a **non-array or empty** answer as a verdict:
`NO_ACCOUNTS`, no signing attempt, attach refused.

The secure frame answers exactly that — an **empty array** — while its session
is being rehydrated for the chain the dapp asks about. `eth_accounts` is a
lookup in the frame's per-chain account map (the frame's own constant lists it
as a SAFE method), and an empty map is a *valid answer for a session that
exists*, not an error. The one question that matters — «can this provider sign
for the address the login produced?» — was never asked.

Three app-side consequences made it a dead end for the user:

1. The retry loop in `connectEmailSocial` re-probed the same lagging state
   three times (800/1200/1600 ms) and landed on `EMAIL_PROVIDER_PENDING`.
2. `attachExternal`'s email fallback signer could never run — it is reached
   only after the probe passes.
3. The pending notice's ONLY exit was «تلاش دوباره» → `connectEmailSocial()`,
   i.e. the whole connect flow again: the modal re-opened on a session that
   was already connected, which is the «باز هم صفحهٔ وصل کردن کیف پول» half of
   the report.

## Fix

### 1. `probeSigning` — ask the real question when the account list is empty

When `eth_accounts` answers empty **and** the caller knows the address the
login produced, the probe now performs one `personal_sign` of the fixed probe
message for that address (the frame's actual signing path — `personal_sign` is
on its NOT_SAFE list precisely because it reaches the key) and **verifies the
signature**: `ethers.verifyMessage` must recover exactly that address.

| provider answers | probe verdict |
|---|---|
| `eth_accounts` non-empty + a 130-hex signature | `{ ok:true }` (unchanged) |
| empty `eth_accounts`, signs for the login address | `{ ok:true, via:'personal_sign' }` |
| empty `eth_accounts`, signature belongs to another key | `SIGNER_MISMATCH` |
| empty `eth_accounts`, nothing signable | `NO_ACCOUNTS` (unchanged diagnosis) |
| empty `eth_accounts`, frame refuses («Action not allowed») | the frame's own message |
| a throwing `eth_accounts` | unchanged (the refusal is the answer) |

Ethers is loaded lazily and failure-tolerantly: if the signature cannot be
verified, the probe returns **not ready** — an empty account list can never
become a false «connected».

### 2. `embeddedAccountSnapshot()` — the account the app already has

A new read-only reader (exported from the stack surface) that returns
`{ address, provider, source }` in one tick, from the instance, the AUTH
connector, `ChainController.state.activeCaipAddress`, or the AUTH record's own
accounts — **never opening a modal**. It is what makes an attach-only retry
possible.

### 3. `retryEmailAttach()` — «تلاش دوباره» retries the ATTACH, not the login

The pending notice's button now calls this: snapshot → `probeSigning` →
`attachExternal` with `mode:'email'`. No modal, no second login, no new claim.
When it is still too early it hands over to the keeper instead of leaving the
user at a dead end.

### 4. The attach keeper — the retry continues by itself

`startEmailAttachKeeper(address)` keeps trying the same attach in the
background: 12 attempts on a bounded backoff (1.2 s → 12 s, ≈60 s total),
reading the truth fresh each time. The moment the frame can sign, the wallet is
attached, the error is cleared, the marker is kept, and the user is told
(`walletSessionRestored`). Traced as `email_keeper_attached` /
`email_keeper_probe_failed` / `email_keeper_exhausted`.

It is single-flight and stops on every exit that ends the claim: a new
`connectEmailSocial`, an explicit `disconnect`, a mode switch away from
`email`, and unmount. It is started wherever a pending verdict is reached
(`connectEmailSocial`, `restoreEmailSocial`, `retryEmailAttach`).

### 5. «اتصال با ایمیل» attaches before it asks

`connectEmailSocial` now tries the attach FIRST when the storage already
describes a session (`hasEmailMarker() || sdkSessionFacts().anyEvidence`) and
the snapshot carries an address — a 6s-bounded probe, then `attachExternal`.
Only when that fails does the modal open. So the «green tick, then connect
your wallet again» sequence cannot happen for a session the app is owed: the
tap attaches it instead of asking for a login that already happened. A genuine
fresh login still goes to the modal exactly as before (traced as
`email_fast_attach` when the short-circuit wins).

### 6. UI

`WalletConnectSheet` shows one extra honest line under the pending notice
(`wallet.emailProviderPendingHint` — new key in all 12 locales) and the retry
button calls `wallet.retryEmailAttach` (falling back to `connectEmailSocial`
only if an old provider lacks it).

## What is NOT touched

- The WalletConnect path, the relay, the QR, the dashboard project config.
- `isProviderUsable()`'s meaning («the provider answers without a refusal») —
  unchanged, so every existing wait/probe call site behaves as before.
- No storage policy changed: the marker is still claimed/released by the same
  `classifyEmailMarker` rules; the keeper only attaches a session the app is
  already owed.

## Verification

```
node test/walletconnect-stack-probe.mjs   # 353/353
npx vitest run test/wallet-health-panel.test.jsx   # 4/4
node test/email-routing-probe.mjs         # 17/17
node test/about-locales-probe.mjs         # PASSED (12 locales)
npm run build                             # clean
```

New checks in the stack probe (real ethers signatures, real recovery):

- an empty `eth_accounts` answer from a provider that SIGNS for the login
  address is signing-ready (`via:'personal_sign'`);
- a valid signature that belongs to ANOTHER key is refused
  (`SIGNER_MISMATCH`);
- an empty account list with nothing signable keeps the `NO_ACCOUNTS`
  diagnosis;
- the direct sign never runs without a claimed address;
- a frame that refuses the direct sign keeps its own message;
- the snapshot reads instance → shared CAIP → AUTH record, and reports
  nothing (instead of guessing) when there is no witness;
- wiring guards: the pending notice retries the attach, the context runs a
  bounded keeper, every pending path starts it, every claim-ending exit stops
  it, the fast retry performs no modal/login, and an owed session is attached
  before the login modal is opened.

## Manual check (Android / Telegram WebView)

- [ ] Email/Google login → green tick → wallet attaches (no pending page).
- [ ] If the frame is slow: the pending page appears **once**, the wallet
      attaches by itself within ~a minute, the header updates.
- [ ] «تلاش دوباره» never opens the wallet-connection modal again.
- [ ] Disconnecting during a pending state stops the keeper (no surprise
      re-attach).
