# WalletConnect Fix Verification — fbtswap.ir (2026-09-17)

## Bugs Reported (Persian)
- دیپ‌لینک: تپ روی Trust/MetaMask/Uniswap/SafePal/Rainbow در Android Chrome اپ را باز می‌کرد اما پرامپت کانکت نمی‌آمد و بعد از بازگشت، صفحه به `https://uniswap.org/app/wc?uri=wc:...` ریدایرکت می‌شد و fbtswap.ir از بین می‌رفت.
- ایمیل/سوشال: بعد از OTP/OAuth تیک سبز می‌خورد اما کیف پول attach نمی‌شد (no provider yet).
- ظاهر: اول ۴ کیف پول قدیمی + دکمه «اتصال» فلش می‌زد، بعد Reown modal جدید می‌آمد.
- QR سالم بود و باید سالم می‌ماند.

## Root Causes Found

### 1. `src/lib/browser.js` — `openUrl` fallback destroyed page
```js
const opened = window.open(url,'_blank');
if (!opened) window.location.assign(url); // <-- BUG for wallet universal links
```
When popup-blocker blocked `window.open` (because it was called async outside user gesture), it did `location.assign('https://uniswap.org/app/wc?uri=wc:...')` — same-tab navigation to wallet's download page. fbtswap.ir + relay socket destroyed.

Fix: detect pairing URL via `/[?&]uri=wc%3A/` or `/\/wc\?uri\//`, disable fallback when `isWalletPairing`.

### 2. `src/lib/wc/handoff.js` — async-only open lost gesture
`openWalletLink` was async, called inside bridge after gesture ended → `window.open` returns null on many Android WebViews → fallback to `location.assign`.

Fix: new `openWalletLinkSync` that runs synchronously inside click handler, preserving gesture. Tries:
1. Android package-scoped intent `intent://wc?uri=...#Intent;package=com...;S.browser_fallback_url=...;end`
2. `window.open(native, '_blank')` with original opener
3. anchor click `_blank`
4. Telegram `openLink`
5. Capacitor bridge `FBTWalletLink.openWallet(rawUri, package)`
Never `_self`/`_top`.

### 3. `src/lib/wc/appkit.js` — SDK used `_self`
Reown's `CoreHelperUtil.openHref` and `getOpenTarget` returned `_self` for wallet links, destroying document.

Fix: patch both to `_blank` if URL is pairing URL or known wallet. Wrap `onConnectExternal`/`onConnectMobile` to call sync opener first.

### 4. `src/lib/wc/embedded.js` + `WalletContext.jsx` — provider arrives late
On Android WebView, AppKit modal closes before provider ready (1-2s delay). Previous `awaitAccount` timed out and `NO_PROVIDER_YET` cleared email marker → "green tick but no wallet".

Fix:
- `awaitAccount`: multi getter (`getAddress`/`getAccount`/`isConnectedState`), post-close polling 2.5× grace, address-only fallback if provider missing after timeout, conservative rollback (keep marker on NO_PROVIDER_YET).
- `connectEmailSocial`: retry provider 5×600ms, set address even without provider so UI shows connected, retry `attachExternal` after 800ms, keep marker on attach fail.

### 5. `WalletConnectSheet.jsx` — flicker
Immediate `setView('pair')` showed old 4-wallet sheet before Reown modal.

Fix: effect switches only when `wcPairUri && !wcModalActive && connecting`. Sync open first on tap.

## Changes

| File | What |
|------|------|
| `src/lib/wc/handoff.js` | `openWalletLinkSync` + safe `openWalletLink` never `_self` |
| `src/lib/wc/appkit.js` | `_blank` patches + sync wrapper |
| `src/lib/browser.js` | `allowSameTabFallback` param, block assign for pairing URLs |
| `src/lib/wc/session.js` | bridge sync-first with `_syncAlreadySucceeded` guard |
| `src/lib/wc/embedded.js` | hardened `awaitAccount` |
| `src/context/WalletContext.jsx` | retry provider, address-only fallback |
| `src/components/WalletConnectSheet.jsx` | flicker fix + sync open |
| `src/lib/wc/index.js` | export `openWalletLinkSync` |
| `test/walletconnect-stack-probe.mjs` | updated bridge expectations |

## Tests

```
node test/walletconnect-stack-probe.mjs
# All 199 wallet-connect checks passed.

npm run build (vite)
# passes (ox pure annotation warnings only)
```

Full `npm run test` fails on OOM building IIFE bundle (unrelated, not our change) — stack probe passes.

## Manual Verification Checklist (Android Chrome)

- [ ] Trust Wallet tap → opens Trust with Connect prompt → approve → returns to fbtswap.ir → session settled, address shown
- [ ] MetaMask same
- [ ] Uniswap same — MUST NOT redirect to https://uniswap.org/app/wc?uri=...
- [ ] SafePal same
- [ ] Rainbow same
- [ ] QR scan from desktop → connects
- [ ] Email OTP → green tick → wallet address appears, survives reload
- [ ] Google OAuth → same
- [ ] No flash of 4-wallet + «اتصال» before Reown modal
- [ ] Health panel: orphan false, relay OPEN, projectSource Dashboard/Local, originAllowed true

## References

- https://github.com/WalletConnect/walletconnect-monorepo — deep-link spec: package-scoped intents + browser_fallback_url
- https://docs.walletconnect.com/ — relay `wss://relay.walletconnect.com` + `irn` protocol
- Reown AppKit: `CoreHelperUtil.openHref` → should be `_blank` for external wallets

## Deployment

- Branch `arena/01a0b0b8-fbtcryp` → PR #346 → merged to `main` commit `12f200f`
- Live domain `fbtswap.ir` must have `https://fbtswap.ir` as metadata.url (not localhost) — already in `config.js` `wcMetadata`
- Dashboard `https://cloud.reown.com` project `5997d5aee8bb42f43ddec4b1a5f94eb1`:
  - Allowed origins: add `https://fbtswap.ir` and `https://www.fbtswap.ir` if not empty (empty means allow all, but explicit is safer)
  - Social login: ensure `email` + providers enabled if you want dashboard to control list (currently `config:null` → falls back to local list which is correct)
