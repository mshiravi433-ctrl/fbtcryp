# «This dApp could be malicious» — root causes, what was fixed, and the appeal path

Reported: signing an EVM or Solana transaction in Trust Wallet / Phantom shows the
wallet's scam warning — «this dApp appears to be a scam», exit or continue anyway.

Persian playbook with the ready-to-send emails: **[docs/WALLET-SCAM-WARNING-FA.md](docs/WALLET-SCAM-WARNING-FA.md)**

---

## Three different warnings, one sentence

| Layer | Who produces it | Our code can fix it? |
|---|---|---|
| **Domain reputation / blocklists** — Blowfish (Phantom, Backpack, Solflare, Trust's scanner), Blockaid (Trust, MetaMask, Coinbase), `phantom/blocklist`, `MetaMask/eth-phishing-detect`, ScamSniffer, ChainPatrol, Google Safe Browsing | Wallet vendors and their security partners | ❌ Only the list's maintainers can remove a listing — §4 |
| **WalletConnect Verify (dApp identity)** | WalletConnect/Reown registry + the origin that opened the socket | ✅ **Yes — a real bug of ours, fixed in §1** |
| **Request shape** (sign-then-broadcast by the dApp) | The same security engines, keying off behaviour | ✅ Mostly — §2 |

## Live evidence (checked today, from the public sources themselves)

| Source | Size checked | `fbtswap.ir` |
|---|---|---|
| `phantom/blocklist` → `blocklist.yaml` | 2,319 entries | ✅ not listed |
| `phantom/blocklist` → `fuzzylist.yaml` | empty | ✅ no risk |
| `MetaMask/eth-phishing-detect` → `src/config.json` | 2.8 MB | ✅ not listed |
| ScamSniffer → `blacklist/domains.json` | 9 MB | ✅ not listed |

So a blocklist entry does **not** explain the warning. What does:

1. **Domain mismatch (Verify = INVALID)** — a real bug of ours. `wcMetadata()`
   always declared `https://fbtswap.ir`, even on preview/sandbox hosts where the
   page was actually served from somewhere else. `Verify.register()` attests
   `window.location.origin`, and the SDK then derives
   `validation = attestedOrigin === new URL(metadata.url).origin ? 'VALID' : 'INVALID'`.
   INVALID is exactly what wallets render as a phishing/mismatch screen.
2. **Blowfish domain reputation** (Phantom mobile, Backpack, Solflare, Trust's
   built-in scanner). Not a public list; a brand-new domain is *unverified* until
   the maintainers review it.
3. **Blockaid** (Trust Wallet, MetaMask, Coinbase) — domain and transaction
   scanning, with a public appeal portal.

## What changed in this branch

1. **`src/lib/wc/config.js` — `walletIdentityUrl()`.** A real public https page
   now declares **its own origin** (production declares `https://fbtswap.ir`,
   a preview declares the preview). Only where a wallet could not act on the
   page — the packaged app's `https://localhost`, a dev server, an `http://`
   page — does the canonical public origin get declared. `wcMetadata(view)` and
   the new `walletIdentityFacts(view)` take the window as an argument so the
   decision is testable without a browser.
2. **`src/lib/launch/solana/signing.js` — `signSendConfirm()`.** The wallet now
   broadcasts whenever it can (`provider.signAndSendTransaction`, or MWA's
   `solana:signAndSendTransaction`); signing-only plus our own broadcast is the
   documented fallback for a wallet that refuses a partially signed create leg.
   Sign-then-broadcast-by-the-dApp is the pattern the security engines treat as
   drainer behaviour, and their own published advice for this warning is to let
   the wallet send. User rejections are never retried through a second prompt.
3. **`src/lib/wc/health.js` + `WalletHealthPanel`.** The support report now
   carries an `identity` row: what the wallet will be told vs. what the page
   actually is.
4. **`scripts/walletconnect-domain-verify.mjs`** writes/checks the Reown
   ownership file at `public/.well-known/walletconnect.txt` (currently absent —
   which is why every wallet shows this dApp as UNVERIFIED).
5. **`scripts/wallet-reputation-check.mjs`** checks the domain against the
   public feeds, plus the two URLs a wallet itself fetches (prompt icon, Verify
   file). Unreachable feeds report UNKNOWN, never a pass.
6. **`test/walletconnect-stack-probe.mjs`** — 16 new checks (325 total).

## The four things that must happen outside this repository

**Live status:** merged to `main` as `da44ace` (PR #364) · Vercel Production
deployment successful for that ref · the APK workflow rebuilt the app ·
`https://fbtswap.ir/.well-known/walletconnect.txt` is still a 404, so every
wallet currently sees this domain as UNVERIFIED.

1. **Deploy this branch**, then confirm on a phone: WalletConnect sheet →
   «Connection health check» → the identity row shows the same origin twice.
2. **Register and verify the domain in Reown** — <https://dashboard.reown.com> →
   project → Domains: `https://fbtswap.ir`, `https://www.fbtswap.ir`,
   `https://localhost` (the APK WebView origin). Verify by file
   (`node scripts/walletconnect-domain-verify.mjs --code=…`) or a DNS TXT record.
   This is what turns Trust Wallet's "Unverified" into a verified domain.
3. **Blowfish / Phantom** — email `review@blowfish.xyz` **and**
   `review@phantom.com`, plus a discussion at
   <https://github.com/orgs/phantom/discussions> and optionally a
   `whitelist.yaml` PR at <https://github.com/phantom/blocklist>. A vouch from a
   known Solana developer on X to `@blowfishxyz` is their published fast path.
4. **Blockaid** — <https://report.blockaid.io/> ("Developer" to verify the
   project, "Mistake" to appeal a false positive) and
   <https://blockaid-false-positive-portal.metamask.io/report>.

Supporting evidence that materially speeds all of it up: DappRadar and BNB Chain
DappBay listings, a Trust Wallet listing, and a public security/transparency page
that names what the app does and does not sign (`docs/SEO-VISIBILITY-FA.md` has
the submission steps).

## What not to do

Never tell users to dismiss the warning — it destroys trust and reads as a scam
pattern to reviewers. Never declare a different domain than the page's own
origin. Never request `eth_sign`, seed phrases, unlimited approvals, or
delegation authority; and keep any "connect your wallet for points" copy free of
money language. Do not change the domain while an appeal is open.
