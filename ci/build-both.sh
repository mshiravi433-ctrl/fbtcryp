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

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  1/2  FULL build — incl. speculation, for GitHub Releases      ║"
echo "╚════════════════════════════════════════════════════════════════╝"

# Subshell, so these exports cannot leak into the store build below. That leak
# would silently produce two identical full builds, one of them labelled as
# the store artifact — the worst possible outcome and an invisible one.
(
  export VITE_ENABLE_SPECULATION=true
  bash "$HERE/build-apk.sh"
)

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

# No flags: both default to off, which is what makes the store build safe.
bash "$HERE/build-apk.sh"

echo
echo "──────────────────────────────────────────────────────────────────"
ls -lh out/ 2>/dev/null | tail -n +2 || true
echo "──────────────────────────────────────────────────────────────────"
echo "  app-release.apk / .aab  → app stores (no speculation screens)"
echo "  FBT-Swap-full*.apk      → GitHub Releases / direct download only"
echo "──────────────────────────────────────────────────────────────────"
