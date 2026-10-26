# Web3 Discovery Center — Implementation Report

**Project:** fbtswap.ir — Explore > Discover tab upgrade  
**Branch:** `arena/eccbfaac-fbtcryp` → `main`  
**Date:** 2026-10-26

---

## 1. Inspection Summary (pre-edit)

### Existing Explore section
- **`src/pages/ExploreHub.jsx`** — `TabbedPage` shell hosting two lazy tabs:
  - `explorer` → `src/pages/Explore.jsx` (blockchain intelligence: address/tx/contract/token/protocol explorer, `exploreApi` via `server/explorerData.js` + `chainIntel.js`)
  - `discover` → `src/pages/Discover.jsx` (curated list of 22 external sites grouped by `dex|data|explorer|wallet|nft|learn`)
- **Routing:** `src/App.jsx` lazy-loads `Explore` and `Discover` separately; `ExploreHub` is the tabbed entry (`/explore`), `?tab=` persisted in URL.
- **Design system:** dark navy/black with neon `cyan/violet/magenta/mint/amber` tokens (`--rgb-1..5`), `docs-modern.css` + `intel.css` cards, `framer-motion` page transitions, `PageTransition`/`Sheet`/`InfoBox` primitives.
- **Data sources:** `exploreApi` (`/api/v1/explore/*`) → DefiLlama for protocols/TVL, RPC + explorer APIs for chain data. `getTrending` for coin trending strip.
- **Browser integration:** `src/lib/browser.js` → `openUrl()` uses `@capacitor/browser` Custom Tabs (in APK), Telegram `openLink`, fallback `window.open`. `isSafeUrl` enforces HTTPS; `openUrl` preserves system TLS/Safe Browsing UI. `Sheet` preview already showed domain before navigation.

### Reused infrastructure (not replaced)
- `openUrl` / `isSafeUrl` (browser.js), `exploreApi` (intelApi.js), `EVM_CHAINS` (chains.js), `WalletContext` (wallet/network), `TelegramContext` (haptics), `usePoll`/`getTrending`, `PageTransition`/`Sheet`/`InfoBox`, `fmtCompact/fmtUsd/timeAgo`, `CoinLogo`

---

## 2. Files Changed

| File | Action | Purpose |
|------|--------|---------|
| `src/pages/Discover.jsx` | **rewritten** | Premium discovery surface — hero, smart search, AI panel, category/network filters, featured/trending, protocol cards, favorites/recents/recommended, detail sheet with secure-browser warnings |
| `src/lib/discoveryRegistry.js` | **new** | Maintainable protocol registry: 50 entries, fields `name/domain/url/category/chains/chainIds/hue/description/docs/audits/verified/featured/dataSource/slug`. Categories cover DeFi/DEX/Lending/Yield/Bridges/Analytics/RWA/NFT/DevTools; network filters map to `EVM_CHAINS` |
| `src/lib/discoveryAi.js` | **new** | On-device NL parser (chain/category/sort/security/compare detection), `filterByAiQuery`, `AI_EXAMPLES` from spec §5, `callDiscoveryAi` stub for backend AI gateway |
| `src/lib/discoverySecurity.js` | **new** | URL validation, anti-phishing (punycode/lookalike/suspicious-TLD/Cyrillic), unsupported-chain warnings, audit notice, registry allowlist check |
| `src/styles/discovery-center.css` | **new** | Glassmorphism hero, search, chips, cards, skeletons, responsive grid — navy/black + neon purple/blue, GPU-accelerated, reduced-motion safe |
| `package-lock.json` | updated | `npm install` lock sync (no new dependencies) |

**Preserved untouched:** `src/pages/Explore.jsx`, `src/pages/ExploreHub.jsx`, `src/App.jsx`, `src/lib/browser.js`, all other pages/tabs/wallet/swap APIs.

---

## 3. Features Implemented

### UI/UX (§2)
- **Hero:** Explore Web3 glass card with kicker, gradient title, subtext, live stats (protocol count, networks, DefiLlama freshness) and smart search.
- **Smart search:** live filtering over registry (name/domain/category/chains), debounced, clear button, meta pills (count, wallet network, updated-ago).
- **Categories:** 10 horizontally scrollable chips (All + DeFi/DEX/Lending/Yield/Bridges/Analytics/RWA/NFT/Developer Tools) — spec-required set.
- **Network filters:** All Networks + BSC/ETH/Arbitrum/Base/Polygon/Optimism/Avalanche/Sonic/Linea/Solana (maps via `CHAIN_ALIASES`).
- **Featured:** carousel of `featured:true` protocols; **Trending dApps** strip from `exploreApi.trending()` (fallback to featured when offline).
- **Protocol cards:** compact, 3-column responsive grid; logo (favicon with hue fallback), verified badge, domain mono, category pill, chain dots, TVL/Volume/Audits stats (N/A when unavailable), favorite toggle, Open in FBT Browser.
- **AI Discovery panel:** input + example chips (spec examples), rule-based interpretation badges, results grid, on-device badge, graceful null handling.
- **Personalized recommendations:** prioritizes wallet `chainId` + favorite/recent categories; shown when wallet/favorites/recents exist.
- **Favorites/recents:** localStorage (`fbt.discovery.favs.v1` / `fbt.discovery.recent.v2` + legacy migration), star toggle, horizontal strips.
- **Sorting:** Trending (momentum score), TVL, Volume, Name A-Z, Favorites first, Newest.
- **Loading/empty/error/mobile:** skeletons while `trending` loads, empty state with clear-filters CTA, `trendingErr` pill, `motion.stagger` entrance, mobile breakpoints (44px min-tap, single-column grid).

### Protocol Information (§3)
- Live TVL/Volume/7d Change from DefiLlama (`exploreApi.trending` + `protocolDetail` on sheet open); **N/A** when null, never zero/fabricated.
- Chains, official domain (LTR mono), docs link, audit count/links, security warning (“Audited ≠ safe”), data source badge (DefiLlama vs curated registry) + `updatedAt` via `timeAgo`.

### Secure Internal Browser (§4)
- Every dApp opens via `openUrl` (Custom Tabs = FBT Browser) — no `window.location` hijack, no embedded WebView.
- Pre-navigation: `validateDiscoveryUrl` checks HTTPS, punycode, suspicious TLD, lookalike substrings, Cyrillic; warns, never blocks except non-HTTPS; domain shown in `dc-domain-row` mono LTR.
- Chain warnings via `chainSupportWarnings`; audit notice; generic “Browser ≠ safe” disclaimer always visible; wallet connect/sign requires explicit approval (existing WalletConnect/local flows unchanged); seed phrase never exposed.

### AI Discovery (§5)
- Parses: “Find lending on Arbitrum”, “Discover yield on BNB Smart Chain”, “Compare DEX…”, “Show newly discovered … with security…”.
- Maps to `{category, chain, sort, wantsSecurity, wantsCompare, wantsNew}` → `filterByAiQuery` + live `exploreApi.protocols` augmentation (best-effort).
- Uses existing AI infra when available (`callDiscoveryAi` → `/api/v1/ai/discovery`); falls back to on-device matcher with badge.
- Never executes transactions/approvals.

### Data & Performance (§6)
- Maintainable registry with all required fields, `faviconFor`/`hostOf` helpers, `CATEGORY_MAP`.
- Reuses existing APIs; no client-side API keys; URL sanitized via `URL` parsing + HTTPS guard; input sanitized (lowercase match, no innerHTML).
- Caching: `exploreApi.trending` (120s s-maxage), `protocolDetail` on demand; pagination via `limit:80` + client filter; lazy loading via `loading=lazy` favicons, `framer-motion` staggered mount, no heavy animations.

---

## 4. Tests Performed

- **Build:** `vite build --mode development` with 4 GB heap — Discover chunk 53 KB gz 14 KB, no errors.
- **`test/run.mjs`:** all suites PASS (including `screens` implicit via run.mjs).
- **Manual checks (code review):**
  - Category chips filter correctly; network filters + text search intersect; sorting respects live map + fallback.
  - Favorites toggle persists, recents migrate from legacy key, detail sheet loads `protocolDetail` and merges.
  - `validateDiscoveryUrl` rejects http/javascript, flags phishing patterns, punycode, etc.
  - Empty search → “Nothing here matches…” + clear button; trending fail → pill + registry fallback; `N/A` not `0`.
  - Mobile: hero stacks, grid collapses to 1 col <560 px, chips scroll, tap targets ≥36 px.

---

## 5. Remaining Limitations / Follow-ups

- Live TVL for non-DefiLlama entries (NFT marketplaces, dev tools like Alchemy, Bridges without TVL) remains N/A — intentional, per “never fabricate”.
- AI backend (`/api/v1/ai/discovery`) not yet deployed; on-device matcher covers spec examples but not free-form reasoning. Plugging `aiGateway` requires a prompt that cites registry allowlist + DefiLlama context (server follow-up).
- Pagination is client-side (≤50 items); server pagination (`offset/limit`) available but not wired to infinite scroll — add when registry exceeds ~100.
- No per-protocol APY/liquidity sparkline — DefiLlama protocol endpoint returns TVL history; can be graphed in detail sheet next iteration.
- Locale strings for new UI are fallback-English; `fa.json`/`en.json` `discover.*` keys should be extended for full i18n coverage.
- E2E with real wallet approval flow not run in sandbox — verified code path only (Custom Tabs opener + `rememberRecent` + chain warnings).

---

**Ready for review → merge to `main` and deploy.**
