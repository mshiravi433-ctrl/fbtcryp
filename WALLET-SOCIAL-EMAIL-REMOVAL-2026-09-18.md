# Email & Social Login Removed — fbtswap.ir (2026-09-18)

## The request (Persian, verbatim)

> «در صفحه اتصال والت ورود با سوشال را حذف کن هم داره به برنامه اسیب میزنه هم باگ
> زیاد داره هم داره به ورود با والت کانتکت هم اسیب میزنه بعد حذف بیار رو برنچ اصلی
> لایو بشه»

Scope confirmed with the owner before the cut: the **whole row** goes —
«ایمیل و ورود با سوشال», i.e. the Reown AppKit *embedded wallet* surface (email
OTP **and** the social providers), not only the Google/Apple/X buttons. What
remains on the connect sheet is WalletConnect, the injected wallets and the
in-app vault.

---

## 1. Why it was damaging WalletConnect, not just itself

This was not a pile of unrelated bugs. One structural decision produced all of
them: the email/social login could not live inside the WalletConnect modal, so
it got **its own `createAppKit()` instance** — and two AppKit instances on one
page share the controllers **singletons** (`OptionsController`,
`ConnectionController`, `ChainController`) and the one `<w3m-modal>` element.

Everything below is measured in the shipped SDK (`@reown/appkit@1.8.19`) and was
locked by probes that no longer need to exist:

| Report | Mechanism |
|---|---|
| «the WalletConnect wallet list opens and nothing connects» | `@walletconnect/ethereum-provider` boots AppKit with **zero adapters**, latching `ChainController.state.noAdapters = true` and `OptionsController.state.manualWCControl = true` — flags the SDK never releases. `ModalController.open({ view: 'Connect' })` reads them **before** the requested view, so an email tap after any WalletConnect use routed to `AllWallets`: a grid whose rows need a `wcUri` only a pairing creates, on a surface that pairs nothing. |
| «the email popup shows a dead wallet's address and balance» | `activeCaipAddress` in the shared `ChainController` survived a WalletConnect connect→disconnect cycle (only `listenAdapter`'s `adapter.on('disconnect')` clears it, and an adapter-less instance has no such listener), so `getIsConnectedState()` stayed true and the modal opened on the Account view. |
| «the email box is there but cannot be typed into» | `w3m-email-login-widget` renders `disabled` from `hasAnyConnection('AUTH')`; a torn-down attempt left an AUTH entry with **no accounts** in the shared map. |
| «approve or cancel, the signature page comes back forever» | four concurrent drivers (login probe + 3 retries, boot/foreground restore, the retry button, a 12-step background keeper) each fired a real `personal_sign`; `personal_sign` is on the frame's `NOT_SAFE` list, so every one of them re-opened `ApproveTransaction` and `rejectRpcRequests()` aborted the previous. |
| «Action not allowed» / «اجازهٔ تغییر شبکه نمیداد» | the frame serves a hard-coded list of 24 eip155 networks; **8 of this app's 16 chains** are not on it (Unichain, Monad, Sonic, Robinhood, Mantle, Linea, Berachain, Scroll), and `wallet_switchEthereumChain` is on neither of the frame's method lists. |

Each of those got a fix, then a fix for the fix (`assertEmailRouting`,
`assertEmailNetwork`, `clearPhantomAuthConnection`, `resetSharedConnectionState`,
the two-mode signing probe, the keeper, the fast-attach, the marker rollback…).
The removal deletes the **cause** instead: one instance, one modal, one owner of
the shared controllers.

---

## 2. What was removed

| Layer | Before | After |
|---|---|---|
| `src/lib/wc/embedded.js` | 2 010 lines: options, lazy instance, markers, restore, signing probe, keeper support, network switching | **deleted** |
| `src/lib/wc/appkit.js` | + the four email-only controller repairs | WalletConnect surface only (`applyWalletSurface`, `resetPairingState`, the connect patch, `readSharedConnectionFacts`) |
| `src/lib/wc/health.js` | 4 probes + the dashboard's email/social feature summary + the platform filter | 3 probes (project, allowed origins, relay) + hand-off channel + storage/in-memory facts |
| `src/lib/wc/config.js` | `SECURE_SITE_URL`, five `email*` bounds | gone |
| `WalletContext.jsx` | mode `'email'`, `connectEmailSocial`, `restoreEmailSocial`, `retryEmailAttach`, the background keeper, `emailModalActive`, `switchChainResult`, the email-first restore gate | three modes (`injected` / `wc` / `local`), one attach path, one restore |
| `WalletConnectSheet.jsx` | the «ایمیل و ورود با سوشال» row + two email error notices with retry buttons | WalletConnect → injected wallets → in-app vault |
| `WalletHealthPanel.jsx`, `Wallet.jsx`, `SecurityCenterCard.jsx`, `Swap.jsx` | email labels, the email chain-switch notice | gone |
| 12 locale files | 21 keys (`wallet.emailSocial…`, `wallet.healthSecureSite`, `toast.emailSwitch…`, `wallet.mode.email`, …) | removed; `wallet.healthHint` / `wallet.healthRelayFreeRoutes` re-worded to three hops |

Net: **−1 700 lines of source** and **−2 500 lines of test** that only existed to
keep the second instance from fighting the first.

---

## 3. Returning users: the keys are cleaned, the wallet is not reachable

An older build left the surface's keys in `localStorage`. One of them is read by
the SDK in a **constructor**: `W3mFrameProvider` sees
`@appkit-wallet/EMAIL_LOGIN_USED_KEY` and creates the
`secure.walletconnect.org` iframe whether this page has a surface for it or not.

So `storage.js` now names them (`listEmbeddedWalletKeys` /
`purgeEmbeddedWalletKeys`), `WalletContext` purges them **first thing on boot**
(before the orphan hygiene counts anything), and the health panel reports how
many a device still carried:

- `fbt_email_social_connected` (our old boot marker)
- `@appkit-wallet/*` (the frame session, incl. `EMAIL_LOGIN_USED_KEY`)
- `@appkit/social_provider`, `@appkit/connected_social`, `@appkit/recent_emails`

`isConnectionKey()` flipped for `@appkit-wallet/*`: it used to be protected
(purging it logged a real user out); with no surface left to log into, it is
debris, and the generic purge takes it too.

> ⚠️ **Honest consequence, flagged to the owner:** a wallet that was *created*
> behind an email/social login is a Reown secure embedded wallet. This build no
> longer offers a way to open it — no funds are touched by the removal (the key
> is non-custodial and never lived on our servers), but that user must reconnect
> with WalletConnect, an injected wallet, or a new in-app vault. If a migration
> path is wanted (export the key / a one-release "recover your email wallet"
> screen), it has to be built deliberately — say the word and it becomes its own
> task.

---

## 4. Tests

```
npm run test:wallet-connection      # stack probe (225 checks) + the panel in jsdom
npm test                            # the full suite, incl. mounting the real sheet
```

- `test/walletconnect-stack-probe.mjs` — §9 is new and locks **the removal
  itself**: the module is gone, nothing imports it, the public surface exports
  no embedded-wallet symbol, **no source file calls `createAppKit()`**, the
  WalletConnect surface still hard-disables auth wallets, no email row/mode/
  string survives in the sheet, the context, the wallet page or the locales, and
  the legacy purge removes exactly the four keys and nothing else. §15 re-locks
  the wiring (boot purge order, one restore path, one attach path).
- `test/wallet-health-panel.test.jsx` — rewritten: the three hops render with
  their measured numbers, and **not one sentence** about an email or social
  login survives.
- deleted: `test/email-routing-probe.mjs` (the wallet-grid hijack — no second
  instance left to hijack) and `test/inapp-wallet-email-session.test.jsx` (the
  cold-start restore of a session the app no longer restores).

---

## 5. Reown dashboard

For project `5997d5aee8bb42f43ddec4b1a5f94eb1`:

- **Email & Social** can be switched **OFF** — nothing in the app reads it any
  more (`features: { email: false, socials: false }` is asserted before every
  WalletConnect open, and it is now simply the truth).
- **Allowed Domains** (`https://fbtswap.ir`, `https://localhost`) and **App IDs**
  (`ir.fbtswap.app`) are unchanged and still required for WalletConnect.

---

## 6. History

The surface, and every round of fixes it needed, are documented in
`docs/EMAIL-SOCIAL-LOGIN-FA.md` (now archived), `docs/WALLET-AUDIT-ROOT-CAUSE-FA.md`,
`WALLETCONNECT_AUDIT_2026-09-17.md`, `WALLETCONNECT_EMAIL_ATTACH_FIX_2026-09-18.md`,
`WALLETCONNECT_EMAIL_ROUTING_FIX_2026-09-18.md` and
`WALLETCONNECT_SIGN_LOOP_FIX_2026-09-18.md`. They are kept as the record of why
the removal — not another patch — was the answer.
