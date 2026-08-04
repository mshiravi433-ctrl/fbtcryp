#!/usr/bin/env bash
# =============================================================================
# THE FULL-FEATURE BUILD
#
# Produces an APK with the speculation screens included: prediction,
# perpetuals and invest, on top of everything in the normal build.
#
# The arcade is NOT here and cannot be: those games were deleted from the
# repository, not flagged off. See src/lib/features.js.
#
# ─── WHY THERE ARE TWO BUILDS AT ALL ─────────────────────────────────────────
# APKPure rejected ir.fbt.swap with "Not involve illegal sensitive words." The
# app shipped a screen titled "Price prediction" whose subtitle was "Call the
# next candle - up or down" (that is a binary option), a "Perpetuals" screen
# offering 100x leverage, and an "Invest" screen selling "fixed-term yield
# plans". All simulated, all carrying honest risk notices - and none of that
# helps, because a content filter reads the words on the screen.
#
# So the DEFAULT build leaves them out and is the one to send to app stores.
# This script produces the other variant for distribution channels that do not
# apply that filter: GitHub Releases, a direct download from the site, or a
# store that has already accepted the app.
#
# ─── THE RULE ────────────────────────────────────────────────────────────────
# Never upload the output of this script to APKPure, Uptodown, Google Play,
# Myket or Cafe Bazaar. It will be rejected, and a second rejection from the
# same reviewer is harder to appeal than the first.
#
# The default `ci/build-apk.sh` is the store build. This one is not.
# =============================================================================
set -euo pipefail

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  FULL BUILD - includes prediction, perps and invest            ║"
echo "║  DO NOT upload this to an app store. It will be rejected.      ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo

# This variable is the entire difference between the builds. It is read by
# vite.config.js, which compiles it to a literal so Rollup can either keep or
# drop the routes AND their locale copy.
export VITE_ENABLE_SPECULATION=true

# A distinct versionName so a support request can be traced to the right
# artifact. Someone reporting "the prediction screen crashed" against a store
# build would otherwise be describing a screen that build does not contain.
if [ -n "${APP_VERSION_NAME:-}" ]; then
  export APP_VERSION_NAME="${APP_VERSION_NAME}-full"
fi

# Everything else - signing, stamping, the web build - is identical, so it is
# delegated rather than duplicated. A copied build script drifts.
exec bash "$(dirname "$0")/build-apk.sh"
