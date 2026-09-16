# Wallet connection correction — 2026-09-16

## Confirmed code defects

- The relay diagnostic sent only `projectId`. Installed WalletConnect Core 2.25.0 signs a relay JWT and sends it as `auth`. A rejected projectId-only handshake is not evidence that the user's VPN filters WebSocket upgrades.
- Both interactive connection and session restoration returned early on that inconclusive diagnostic. Those gates are removed; the diagnostic still supplies relay ordering and an advisory UI warning.
- Email login called async `modal.open()` inside a synchronous try/catch. Rejected modal/UI loads could leave the connect promise pending.
- The email account callback could attach multiple times, while the modal-close callback resolved cancellation before an in-flight provider attachment completed.

## Changes

The diagnostic now uses an ephemeral, five-minute signed client JWT with the relay as audience. It creates no wallet session, stores no signing key, and does not return the JWT or authenticated URL in reports. Authentication preparation is bounded. HTTPS and WebSocket probes run concurrently, and socket handlers are cleaned up.

`emailConnection.js` owns the email modal lifecycle: open rejection/timeout, initial closed-state suppression, one attachment, close/account ordering, and subscription cleanup. Marker rollback remains in WalletContext. There is deliberately no short deadline on the user's OTP/OAuth interaction.

Persian, English and Arabic diagnostics no longer assert that browser error 1006 proves filtering or that an HTTPS response guarantees successful social authentication. Historical comments claiming those conclusions and obsolete early-return code were removed. No vault, private key, or stored user wallet data is migrated or deleted by this patch.

## Validation

- `npm run test:wallet-connection`: eight behavioral regressions and relay preflight checks.
- Existing email/social (49), wallet health (62), connect (77), wiring (18), chain (12), storage (7), timeout (26), URI hygiene (32), pairing surface (64), deep-link (37) and wallet catalog (37) checks passed. Run the exported probe suites in separate Node processes: the email suite installs jsdom globals that affect the health suite's bare-environment assertions.
- `NODE_OPTIONS=--max-old-space-size=3072 npx vite build`: passed. A build without the project's heap setting exhausted memory.
- The jsdom AppKit probe emits a Node UniversalProvider interop warning; passing its checks does not establish successful real-browser OAuth.
- Clean dependency installation on this Linux sandbox required `npm ci --ignore-scripts --force` because the existing lock contains a platform-incompatible fsevents entry. This patch does not change that unrelated lock issue.

## Deployment verification still required

This branch has not been deployed to fbtswap.ir. On the updated deployment, use the same Android browser/network from the report:

1. Run wallet health again; no diagnostic should claim that 1006 proves filtering.
2. Try WalletConnect even if the probe fails; inspect the SDK connection trace, not just HTTPS reachability.
3. Open email/social, cancel, reopen, then complete one login. Verify a single attached account and that the loading state ends.
4. Repeat after WalletConnect use and after reload/OAuth return to exercise AppKit's shared-controller and restore paths.

A real relay outage, origin rejection, network restriction, or remote authentication-service error may still prevent connection. These cannot be ruled out by unit tests or repaired merely by changing diagnostic wording.
