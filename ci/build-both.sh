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
# The values are NOT listed here any more: they live in ci/farm-rollout.env.sh,
# which this script sources and `npm run build:full` (the website build Vercel
# runs) sources too. Keeping one copy is the whole point — the previous copy
# lived in this file alone, so the APK builds were public-open while the
# website compiled every money-in flag to false and Farm stayed read-only for
# every visitor there. Two copies of a money-path configuration always drift.
#
# The fail-closed gate in scripts/farm-rollout-policy.mjs (re-asserted by
# vite.config.js at build time) still rejects any half-open combination with a
# red build, so a partial edit in the env file cannot ship a half-open Farm.
# `FARM_CAPITAL=off` closes it again without editing anything.
#
# Applied to BOTH stages below, exactly as a workflow env block would: the
# direct-download build (FBT-Swap-full.apk) and the store build
# (app-release.apk / .aab) are both public-open. To close the store build
# again, run its stage with FARM_CAPITAL=off instead.
# ---------------------------------------------------------------------------
# shellcheck source=./farm-rollout.env.sh
. "$HERE/farm-rollout.env.sh"


echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  1/2  FULL build — incl. speculation, for GitHub Releases      ║"
echo "╚════════════════════════════════════════════════════════════════╝"

# `env VAR=... bash …` scopes the flag to that one process (it used to be a
# subshell with `export`), so it cannot leak into the store build below. That leak
# would silently produce two identical full builds, one of them labelled as the
# store artifact — the worst possible outcome and an invisible one.
run_stage "full build" env VITE_ENABLE_SPECULATION=true bash "$HERE/build-apk.sh"

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
# published outputs are public-open; see the sourced farm-rollout.env.sh.
# The rollout env is already exported above, so it is inherited rather than
# re-listed; only speculation has to be pinned, and only for the full build.
run_stage "store build" bash "$HERE/build-apk.sh"

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
