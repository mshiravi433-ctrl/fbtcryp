# =============================================================================
# FARM ROLLOUT ENVIRONMENT — ONE FILE, EVERY BUILD
#
# ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
# The public-open rollout used to be a literal array inside ci/build-both.sh,
# so it reached the APK builds and nothing else. The website is built by
# `npm run build:full` (vercel.json → buildCommand), which never saw those
# values, so every `VITE_ENABLE_*` define compiled to `false` there: all five
# adapters returned null and Farm stayed read-only for every visitor. The
# rollout was "open" on one artifact out of two — «در فارم هنوز نمیاد برای
# همه».
#
# So the values live here, sourced by BOTH entry points:
#
#   · ci/build-both.sh   → the APK / AAB builds
#   · npm run build:full → the website (Vercel)
#
# One file, because two copies of a money-path configuration drift, and the
# drift is invisible until someone compares an APK with the site.
#
# ─── WHAT EACH VALUE DOES ────────────────────────────────────────────────────
# FARM_ROLLOUT_PROTOCOLS   operator declaration; must match the enabled flags
#                          EXACTLY or the gate rejects the build.
# FARM_STRICT_FORK_EVIDENCE / FARM_CANARY_CONFIRMED
#                          the two markers scripts/farm-rollout-policy.mjs
#                          requires before any public capital may open.
# VITE_ENABLE_*            the money path itself, compiled into the bundle.
# VITE_*_PUBLIC=true       any connected wallet, not just the canary list.
# VITE_*_ALLOWLIST         the canary wallet(s); still required by the gate
#                          even in a public build, and still the recovery list.
# VITE_*_MAX_*             (REMOVED) amount caps were taken out after the
#                          fork evidence passed; the only ceilings left are
#                          the protocols' own on-chain limits and balances.
#
# The fail-closed gate (scripts/farm-rollout-policy.mjs, re-asserted by
# vite.config.js on every Vite entry point) rejects any half-open combination
# with a red build, so a partial edit here cannot ship a half-open Farm.
#
# ─── KILL SWITCH ─────────────────────────────────────────────────────────────
#   FARM_CAPITAL=off npm run build:full
# exports nothing, so the build is capital-off again without editing this file.
# Withdrawals are unaffected either way: the exit path is gated only by
# "is there something to withdraw" (see src/lib/features.js).
# =============================================================================

if [ "${FARM_CAPITAL:-on}" = "off" ]; then
  return 0 2>/dev/null || exit 0
fi

export FARM_ROLLOUT_PROTOCOLS="${FARM_ROLLOUT_PROTOCOLS:-aave-base,aave-arbitrum,compound-base,lido,morpho-base}"
export FARM_STRICT_FORK_EVIDENCE="${FARM_STRICT_FORK_EVIDENCE:-true}"
export FARM_CANARY_CONFIRMED="${FARM_CANARY_CONFIRMED:-true}"

# Canary wallet. Also the recovery list: a public build still records it, so
# turning `VITE_*_PUBLIC` off returns the build to exactly this wallet.
export VITE_ENABLE_AAVE_BASE_SUPPLY="${VITE_ENABLE_AAVE_BASE_SUPPLY:-true}"
export VITE_AAVE_BASE_SUPPLY_ALLOWLIST="${VITE_AAVE_BASE_SUPPLY_ALLOWLIST:-0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6}"
export VITE_AAVE_BASE_SUPPLY_PUBLIC="${VITE_AAVE_BASE_SUPPLY_PUBLIC:-true}"

export VITE_ENABLE_AAVE_ARBITRUM_SUPPLY="${VITE_ENABLE_AAVE_ARBITRUM_SUPPLY:-true}"
export VITE_AAVE_ARB_SUPPLY_ALLOWLIST="${VITE_AAVE_ARB_SUPPLY_ALLOWLIST:-0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6}"
export VITE_AAVE_ARB_SUPPLY_PUBLIC="${VITE_AAVE_ARB_SUPPLY_PUBLIC:-true}"

export VITE_ENABLE_COMPOUND_BASE_SUPPLY="${VITE_ENABLE_COMPOUND_BASE_SUPPLY:-true}"
export VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST="${VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST:-0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6}"
export VITE_COMPOUND_BASE_SUPPLY_PUBLIC="${VITE_COMPOUND_BASE_SUPPLY_PUBLIC:-true}"

export VITE_ENABLE_LIDO_STAKE="${VITE_ENABLE_LIDO_STAKE:-true}"
export VITE_LIDO_STAKE_ALLOWLIST="${VITE_LIDO_STAKE_ALLOWLIST:-0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6}"
export VITE_LIDO_STAKE_PUBLIC="${VITE_LIDO_STAKE_PUBLIC:-true}"

export VITE_ENABLE_MORPHO_BASE_SUPPLY="${VITE_ENABLE_MORPHO_BASE_SUPPLY:-true}"
export VITE_MORPHO_BASE_SUPPLY_ALLOWLIST="${VITE_MORPHO_BASE_SUPPLY_ALLOWLIST:-0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6}"
export VITE_MORPHO_BASE_SUPPLY_PUBLIC="${VITE_MORPHO_BASE_SUPPLY_PUBLIC:-true}"
