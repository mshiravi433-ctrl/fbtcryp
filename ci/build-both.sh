#!/usr/bin/env bash
# =============================================================================
# BUILD BOTH VARIANTS IN ONE CI RUN
#
# ─── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
# The full-feature build existed (ci/build-full.sh) but NOTHING RAN IT. CI only
# ever executed ci/build-apk.sh, so the only APK ever published to GitHub
# Releases was the store build — the one with prediction, perpetuals and
# invest stripped out.
#
# Which means the owner's report was still true after the "fix": every APK you
# could actually download had fewer features than before. A build variant that
# is never built is a deletion with extra steps.
#
# ─── WHAT THIS PRODUCES ──────────────────────────────────────────────────────
#   out/app-release.apk       store build — no speculation screens
#   out/app-release.aab       same, for Google Play
#   out/FBT-Swap-full.apk     everything included
#
# ─── WHY THE STORE BUILD RUNS SECOND ─────────────────────────────────────────
# Both builds write to android/app/build/outputs and to out/. Running the full
# build FIRST and the store build second means the stable filenames
# (app-release.apk / app-release.aab) are left holding the store artifact —
# which is the one that must never be confused for the other. If the order were
# reversed, an automated upload grabbing "app-release.apk" would send the full
# build to a store and earn a second rejection.
#
# The full build is renamed immediately so it cannot be picked up by a
# wildcard that expects the store name.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# ---------------------------------------------------------------------------
# RUN THE BUILD, AND MAKE SURE A FAILURE IS READABLE.
#
# `bash ci/build-both.sh` is one opaque step to GitHub: if a command inside it
# dies, the run shows "Process completed with exit code 1" and nothing else,
# which is precisely why a dependency-install failure here stayed undiagnosed for
# weeks — the log had the answer forty lines down, and the log is unreadable from
# a phone. So both builds are tee'd to a file, and any non-zero exit re-emits the
# tail of it as an ANNOTATION, which is the thing the run's summary page shows.
#
# Same principle this script already applies to `VITE_API_BASE`: the one line that
# says what to fix has to be somewhere a person will actually look.
# ---------------------------------------------------------------------------
CI_LOG="${CI_LOG:-/tmp/build-both.log}"
: > "$CI_LOG"

say() { printf '::notice title=CI environment::%s\n' "$1"; }

run_stage() {
  local label="$1"; shift
  local rc=0
  { echo; echo "── $label ──"; } >> "$CI_LOG"
  ( "$@" ) 2>&1 | tee -a "$CI_LOG" || rc=${PIPESTATUS[0]}
  if [ "$rc" -ne 0 ]; then
    {
      echo
      echo "✗ $label failed (exit $rc). Last lines:"
      tail -n 30 "$CI_LOG"
    } >&2
    printf '::error title=%s failed (exit %s)::%s\n' "$label" "$rc" "$(tail -n 12 "$CI_LOG" | tr '\n' ' ' | tr -s ' ')"
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      { echo "### ✗ $label failed (exit $rc)"; echo '```'; tail -n 30 "$CI_LOG"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
    fi
    exit "$rc"
  fi
}

{
  echo "toolchain: java=$( { command -v java >/dev/null 2>&1 && java -version 2>&1 | head -1 | tr -d '\r'; } || echo 'not on PATH' ) node=$(node -v) npm=$(npm -v)"
  echo "sdk: ANDROID_HOME=${ANDROID_HOME:-unset} ANDROID_SDK_ROOT=${ANDROID_SDK_ROOT:-unset}"
  for d in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/android-sdk"; do
    [ -n "$d" ] && [ -d "$d" ] && { echo "  platforms in $d: $(ls "$d/platforms" 2>/dev/null | tr '\n' ' ')"; echo "  build-tools: $(ls "$d/build-tools" 2>/dev/null | tr '\n' ' ')"; break; }
  done
  echo "repo: HEAD=$(git rev-parse --short HEAD 2>/dev/null) branch=${GITHUB_REF_NAME:-?}"
} > /tmp/env-summary.txt 2>&1 || true
say "$(tr '\n' ' ' < /tmp/env-summary.txt)"

# ---------------------------------------------------------------------------
# FARM ROLLOUT — public-open, all five protocols (canary-confirmed).
#
# These are the same literals the "Build APK" workflow carries in its env:
# block. They live here rather than in .github/workflows/build-apk.yml
# because that path cannot be written from a coding-agent session (agent
# tokens are blocked from workflow files, and mobile copy-paste has corrupted
# it before — see the ci/build-apk.sh header). The effect is identical: the
# values reach `npm run build`, where Vite inlines them, and the fail-closed
# gate in scripts/farm-rollout-policy.mjs (re-asserted by vite.config.js at
# build time) rejects any half-open combination with a red build instead of
# shipping a half-open Farm.
#
# Deliberately applied to BOTH stages: a workflow env block applies to the
# whole run, so both the direct-download build (FBT-Swap-full.apk) and the
# store build (app-release.apk / .aab) are public-open. To close the store
# build again, drop "${FARM_ROLLOUT_ENV[@]}" from the second run_stage line
# only — the gate keeps every partial combination from shipping.
# ---------------------------------------------------------------------------
FARM_ROLLOUT_ENV=(
  FARM_ROLLOUT_PROTOCOLS=aave-base,aave-arbitrum,compound-base,lido,morpho-base
  FARM_STRICT_FORK_EVIDENCE=true
  FARM_CANARY_CONFIRMED=true
  VITE_ENABLE_AAVE_BASE_SUPPLY=true
  VITE_AAVE_BASE_SUPPLY_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
  VITE_AAVE_BASE_SUPPLY_PUBLIC=true
  VITE_AAVE_BASE_SUPPLY_MAX_USDC_PER_TX=1000
  VITE_AAVE_BASE_SUPPLY_MAX_USDC_TOTAL=10000
  VITE_ENABLE_AAVE_ARBITRUM_SUPPLY=true
  VITE_AAVE_ARB_SUPPLY_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
  VITE_AAVE_ARB_SUPPLY_PUBLIC=true
  VITE_AAVE_ARB_SUPPLY_MAX_USDC_PER_TX=1000
  VITE_AAVE_ARB_SUPPLY_MAX_USDC_TOTAL=10000
  VITE_ENABLE_COMPOUND_BASE_SUPPLY=true
  VITE_COMPOUND_BASE_SUPPLY_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
  VITE_COMPOUND_BASE_SUPPLY_PUBLIC=true
  VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX=1000
  VITE_COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL=10000
  VITE_ENABLE_LIDO_STAKE=true
  VITE_LIDO_STAKE_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
  VITE_LIDO_STAKE_PUBLIC=true
  VITE_LIDO_STAKE_MAX_ETH_PER_TX=1
  VITE_LIDO_STAKE_MAX_ETH_TOTAL=10
  VITE_ENABLE_MORPHO_BASE_SUPPLY=true
  VITE_MORPHO_BASE_SUPPLY_ALLOWLIST=0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6
  VITE_MORPHO_BASE_SUPPLY_PUBLIC=true
  VITE_MORPHO_BASE_SUPPLY_MAX_USDC_PER_TX=1000
  VITE_MORPHO_BASE_SUPPLY_MAX_USDC_TOTAL=10000
)

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  1/2  FULL build — incl. speculation, for GitHub Releases      ║"
echo "╚════════════════════════════════════════════════════════════════╝"

# `env VAR=... bash …` scopes the flag to that one process (it used to be a
# subshell with `export`), so it cannot leak into the store build below. That leak
# would silently produce two identical full builds, one of them labelled as the
# store artifact — the worst possible outcome and an invisible one.
run_stage "full build" env VITE_ENABLE_SPECULATION=true "${FARM_ROLLOUT_ENV[@]}" bash "$HERE/build-apk.sh"

mkdir -p out
if [ -f out/app-release.apk ]; then
  mv out/app-release.apk out/FBT-Swap-full.apk
  echo "✓ full build → out/FBT-Swap-full.apk"
elif [ -f out/app-debug.apk ]; then
  # Unsigned run (no keystore secrets). Still worth publishing under a name
  # that says what it is.
  mv out/app-debug.apk out/FBT-Swap-full-unsigned.apk
  echo "✓ full build (unsigned) → out/FBT-Swap-full-unsigned.apk"
fi
# The AAB is only ever for Play, and Play gets the store build, so a full-build
# bundle would only be a file someone could upload by mistake.
rm -f out/app-release.aab

echo
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  2/2  STORE build — the one to submit to app stores            ║"
echo "╚════════════════════════════════════════════════════════════════╝"

# Speculation stays off (the flag that keeps the banned screens out of the
# store build). The Farm rollout env deliberately applies here too — both
# published outputs are public-open; see the FARM_ROLLOUT_ENV block above.
run_stage "store build" env "${FARM_ROLLOUT_ENV[@]}" bash "$HERE/build-apk.sh"

echo
echo "──────────────────────────────────────────────────────────────────"
ls -lh out/ 2>/dev/null | tail -n +2 || true
echo "──────────────────────────────────────────────────────────────────"
echo "  app-release.apk / .aab  → app stores (no speculation screens)"
echo "  FBT-Swap-full*.apk      → GitHub Releases / direct download only"
echo "──────────────────────────────────────────────────────────────────"

# ---------------------------------------------------------------------------
# Keep the download page honest.
#
# The `latest` release is where the APK is actually fetched from, and its notes
# are only rewritten when a version tag is cut — so the assets had been moving for
# weeks while the page still described an older build. This stamps the real
# version, sizes and SHA-256 digests into a machine-owned block, leaving any
# hand-written notes below it alone.
#
# Non-fatal on purpose: a signed, uploaded artifact must never fail to publish
# because a cosmetic PATCH to a description hit a rate limit.
# ---------------------------------------------------------------------------
FBT_NOTES_DRY=${FBT_NOTES_DRY:-0} node "$HERE/release-notes.mjs" || echo "  (release notes skipped)"

echo "──────────────────────────────────────────────────────────────────"
