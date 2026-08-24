# FBT Swap (Fanous Bazaar Pishgam) — Master System Prompt & Technical Architecture

## 1. Project Overview & Identity

- **Name:** FBT Swap (فانوس بازار پیشگام / Fanous Bazaar Pishgam)
- **Domain:** `https://fbtswap.ir`
- **Telegram Bot Username:** `@fbtco_bot` (Bot ID: `7837421575`)
- **Product Type:** Non-custodial decentralized exchange (DEX), multi-chain crypto wallet interface, cross-chain bridge, P2P bitcoin gateway, and Web3 trading toolkit.
- **Philosophy:** Non-custodial by design. Private keys and recovery phrases never touch any server. All transactions require user signature on-device or via hardware/mobile wallet.

## 2. Technical Stack

- **Frontend:** React 18, Vite, Framer Motion, i18next (12 languages: Persian `fa`, English `en`, Arabic `ar`, Turkish `tr`, Russian `ru`, Chinese `zh`, Hindi `hi`, Urdu `ur`, Spanish `es`, French `fr`, Portuguese `pt`, Indonesian `id`).
- **Backend / API:** Node.js Express server (`server/app.js`), modular routes for market data, gasless quotes, AI market briefs, and bridge aggregations.
- **EVM Integration:** `ethers.js`, KyberSwap DEX Aggregator, 0x Gasless v2 API, Morpho Lending Vaults, deBridge DLN, LI.FI.
- **Solana Integration:** `@solana/web3.js`, Jupiter Aggregator API.
- **Wallet Connection:** Reown AppKit / WalletConnect v2 (`WC_PROJECT_ID = '8e36eccabebf5a4567f4e974fafd6b20'`), Injected Web3 Provider (MetaMask, Trust Wallet, Rabby, OKX, Phantom), Local Seed Wallet (`src/lib/localWallet.js`), Biometric WebAuthn App Lock.

## 3. Core Modules & Revenue Engines

1. **DEX Swap (EVM):**
   - Integrates KyberSwap aggregator for multi-hop on-chain routing.
   - Built-in 0.50% to 0.70% platform fee to `0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6`.

2. **Gasless Swap (0x Gasless):**
   - Allows users with 0 native coin (for example, 0 ETH, BNB, or POL) to swap ERC-20 tokens.
   - User signs an EIP-712 Permit2 message; the 0x relayer fronts network gas and deducts it from the sold token.
   - Platform fee (0.70%) is collected directly in the sold token.

3. **Cross-Chain Bridge:**
   - Multi-provider cross-chain routing via deBridge DLN and LI.FI.

4. **Solana DEX (Jupiter):**
   - High-speed Solana swap with automatic route optimization and referral fee integration.

5. **Morpho Lending Vault:**
   - Passive yield vault on Base (`VITE_FBT_VAULT_ADDRESS`) with curated yield markets.

6. **P2P Marketplace (Hodl Hodl):**
   - Non-custodial peer-to-peer fiat-to-Bitcoin offers (`HODLHODL_REF`).

7. **Shop / Crypto Refills:**
   - Gift cards, eSIM, mobile top-ups paid in stablecoins.

## 4. UI/UX Principles & Guidelines

- **RTL & Persian First:** Full native Persian support with clean typography, Persian numerals formatting (`toFa`), and mirror-aware layouts.
- **First-Launch / Welcome Flow:**
  - `Splash.jsx` → `Welcome.jsx` (Language picker & profile name) → `Onboarding.jsx` (Feature overview) → `Guide.jsx` (Safety and swap tutorial).
  - Clean animated starfield background (`GalaxyBackdrop.jsx`) without intrusive planet illustrations.
  - Linear, unobtrusive progress rail (`LaunchProgress.jsx`) with ARIA progressbar compliance.
- **Honest Feedback:** No deceptive latency or fake confirmations. When an API or relay is blocked, explain clearly and provide actionable fallbacks.

## 5. Development & Deployment Rules

1. **Git Workflow:**
   - Development happens on Arena feature branches (`arena/...`).
   - Production deployments trigger automatically upon merging pull requests into `main`.

2. **Key Separation & Security:**
   - Client-side identifiers (for example, `VITE_PUBLIC_URL`, `VITE_FEE_RECIPIENT`) must never contain secrets.
   - Server-side secrets (API keys, bot tokens, VAPID private keys) are kept in `.env` / Vercel Environment Variables.

3. **Network & Sanctions Resiliency:**
   - Iranian ISP and geo-filtering mitigations: fallback relay URLs, direct injected wallet browser support, WebSocket reconnects with timeout guards (`src/lib/wcTimeout.js`).
