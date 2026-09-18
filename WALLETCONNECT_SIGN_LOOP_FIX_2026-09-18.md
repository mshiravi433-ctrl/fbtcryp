# Email/Social Sign-Loop Fix — fbtswap.ir (2026-09-18, report #3)

## Bug Reported (Persian)

> «وقتی وصل میشی یک صفحه میاره approve transaction. فرقی نمیکند اپرو را بزنی یا
> کنسل را، باز دوباره میاره؛ کلاً نمیره مرحله بعد.»
>
> FBT Swap requests a signature

With the device report (`fbtswap-login-probe`):

| fact | value |
|---|---|
| login | DONE — `sdkLoginMarker:true`, `connectionStatus:'connected'`, `authAccounts:2`, `activeCaipNetworkId:'eip155:56'` |
| trace | `email_sign_probe_failed {m:'NO_ACCOUNTS'}` and `email_keeper_probe_failed` alternating between `{m:'NO_ACCOUNTS'}`, `{m:'User rejected'}` and `{m:'Request was aborted'}` — for four straight minutes |
| pattern | `email_session_restored` re-firing every few seconds, `email_retry_attach {addr:true, prov:true}` mid-stream |

The user is being asked to sign, over and over, no matter what they press, and
the flow never advances.

## Root Cause (verified in @reown/appkit@1.8.19 source)

The frame's provider opens the modal for every signing request:

- `W3mFrameRpcConstants.NOT_SAFE_RPC_METHODS` contains `personal_sign`;
- `appkit-base-client.handleUnsafeRPCRequest()` → **`this.open({ view: 'ApproveTransaction' })`**
  — the literal «approve transaction» page the user describes;
- when the modal closes, `PublicStateController.subscribeOpen(isOpen => { if
  (!isOpen && this.isTransactionStackEmpty()) this.authProvider?.rejectRpcRequests(); })`
  — **every pending RPC is aborted** («Request was aborted»);
- a method on NEITHER list (`eth_requestAccounts`!) triggers the
  not-allowed path: modal open + error toast + `rejectRpcRequests()`.

Against that contract, `probeSigning()` fired a REAL `personal_sign` (the
2026-09-18 «empty eth_accounts» fallback) from **four concurrent drivers**:

1. `connectEmailSocial`'s post-login probe + 3 attach retries,
2. `restoreEmailSocial` on every boot/foreground/visibility event,
3. `retryEmailAttach` (the retry button),
4. `startEmailAttachKeeper` — 12 attempts on a 1.2s→12s backoff.

Each new request reopened the ApproveTransaction page and aborted the previous
one (the paired `Request was aborted` entries at identical timestamps). So:

- **Cancel** → `User rejected` → the driver schedules the next attempt → page
  again.
- **Approve** → the signature raced `rejectRpcRequests()` and the recovery
  check; an unverifiable/aborted approve landed as `NO_ACCOUNTS` → the driver
  scheduled the next attempt → page again.

An endless dialog the app's own retry loops were generating — the SDK was only
obeying the requests it was sent.

## Fix

### 1. The probe is two-mode; background drivers NEVER sign
`src/lib/wc/embedded.js` — `probeSigning(provider, address, { interactive })`:

| mode | used by | behaviour |
|---|---|---|
| non-interactive (**default**) | keeper, restore, attach retries, fast attach | `eth_accounts` only (SAFE list — silent, allowed). Grant carrying the expected address → `{ok:true, via:'accounts'}`. Empty answer → `{ok:false, error:'NOT_READY'}` — a state, never a dialog. |
| `interactive:true` | the fresh-login gate, the retry button — **user gestures only** | grant first; then ONE bounded `personal_sign`, verified. |

### 2. A rejection is TERMINATE
`USER_REJECTED` sets a module-wide denial (`signingDeniedByUser()`):
- the keeper stands down (`email_keeper_stood_down`);
- boot/foreground restores stand down silently;
- the connect flow's retries stop and the flow ends in `EMAIL_SIGNING_DENIED`
  (new calm notice in `WalletConnectSheet`, translated in all 12 locales);
- only a real tap (`force: true` on the retry button — or a new login, which
  calls `resetSigningState()`) may ask again.

### 3. Single-flight
Concurrent probes on one provider share one execution (`inflightProbe`), so
two drivers can no longer abort each other's request.

### 4. An approve always lands
- A well-formed, user-approved signature whose signer ethers cannot name
  attaches on two witnesses — the frame's grant AND the user-approved
  signature — as `via:'signature_unverified'` (this was the `NO_ACCOUNTS`
  that swallowed approvals).
- A signature that recovers to the session's OTHER recorded account
  (`authAccounts: 2` — a stale account next to the current login) is adopted
  as `via:'signature_resynced'` when the SDK's own session record names it
  too. A signature from a key NO record names is still `SIGNER_MISMATCH`.

### 5. Consent resets where consent lives
`resetSigningState()` on `disconnect()` and on a fresh login (`open()` fresh
path + the connect flow's post-login gate). `forget()` clears it too.

## What is NOT touched
- The WalletConnect (QR/deep-link) path, the relay, the pairing, the
  email/social login itself, storage policy, the marker classification.
- `isProviderUsable()` semantics; the phantom-connected guard (the gate is
  still the frame's own grant — stored state can never fake it).

## Verification

```
node test/walletconnect-stack-probe.mjs   # 364/364 (incl. the new sign-loop suite)
node test/email-routing-probe.mjs         # 17/17
node test/about-locales-probe.mjs         # PASSED (12 locales)
connect-sheet mount probe                 # 8/8
npx vitest run test/wallet-health-panel.test.jsx   # 4/4
npm run build                             # clean
```

New locked behaviours (real ethers signatures, real recovery, no crypto mocks):

- the background probe never requests a signature (asserted on the request
  log, not the result);
- empty accounts → `NOT_READY`, still no signature request — even interactive;
- one interactive probe = exactly one `personal_sign`, verified against the
  recovered signer;
- a user rejection → `denied:true`, remembered module-wide, automatic probes
  short-circuit without touching the frame, `force` asks again, an approval
  clears the denial;
- approved-but-unverifiable → attaches (`signature_unverified`);
- a second recorded account's signature → `signature_resynced` with the
  address; an unknown key → `SIGNER_MISMATCH`;
- concurrent probes are single-flighted (one `eth_accounts` for two callers);
- wiring guards: exactly two `interactive: true` call sites (fresh-login gate
  + retry button, the latter `force: true`), denial stand-downs present,
  resets wired to disconnect/fresh-login, the sheet's denial branch, and the
  locale keys in all 12 files.

## Manual check (Android / Telegram WebView)

- [ ] Email/Google login → at most ONE «FBT Swap requests a signature» page.
- [ ] Approve → the wallet attaches and the app advances (balance, header).
- [ ] Cancel → a calm notice («امضا رد شد…»), NO further dialogs, ever.
- [ ] «تلاش دوباره» on the denial notice asks once, on that tap only.
- [ ] A session whose frame is slow: the pending notice appears once, the
      background keeper attaches SILENTLY when the frame grants the account.
