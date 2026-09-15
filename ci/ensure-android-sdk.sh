#!/usr/bin/env bash
# =============================================================================
# ENSURE AN ANDROID SDK EXISTS — WITHOUT DEPENDING ON android-actions/setup-android
#
# ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────
# Every recent "Build APK" run died in the SAME place, and it was not our code:
#
#     X Run android-actions/setup-android@v3
#     - Run bash ci/build-both.sh        (skipped)
#     - Run actions/upload-artifact@v4   (skipped)
#
# The job failed at step 5 of 8, so npm, Vite, Capacitor and Gradle never even
# started. No APK was produced, and the GitHub release kept serving the old
# binary — which is why a source fix (the Trust Wallet deep link) could look
# "not applied" on the phone: the phone never received a build containing it.
#
# That third-party action breaks for reasons that have nothing to do with this
# repository — it re-downloads the SDK command-line tools from
# dl.google.com on every run and hard-fails when Google rotates the archive
# name, and it also fails with EACCES when the runner image changes where the
# SDK lives. A build pipeline must not be one upstream URL rotation away from
# shipping nothing.
#
# ─── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────
# GitHub's ubuntu-latest image ALREADY SHIPS a full Android SDK (it is what the
# action mostly just re-points at). So:
#
#   1. Look for a usable SDK in ANDROID_HOME / ANDROID_SDK_ROOT and in the
#      well-known image locations.
#   2. If one is found, export ANDROID_HOME/ANDROID_SDK_ROOT and put its
#      tool directories on PATH. Nothing is downloaded — the fast, offline path.
#   3. Only if NOTHING is found, download the command-line tools ourselves,
#      trying several known archive revisions AND the plain `latest` name, so a
#      single rotated filename cannot take the build down again.
#
# Exporting happens through $GITHUB_ENV / $GITHUB_PATH when running in Actions
# so later steps inherit it, and through plain `export` otherwise, so the same
# script works when a human runs it locally.
#
# This script is idempotent and safe to run twice.
# =============================================================================
set -euo pipefail

log() { printf '  %s\n' "$*"; }

# A directory only counts as an SDK if it can actually DO something: either it
# has sdkmanager (so missing packages can be installed) or it already has the
# platforms + build-tools Gradle needs. "The directory exists" is not enough —
# that is how a build gets to Gradle and dies there with a cryptic message.
usable_sdk() {
  local d="$1"
  [ -n "$d" ] && [ -d "$d" ] || return 1
  [ -x "$d/cmdline-tools/latest/bin/sdkmanager" ] && return 0
  [ -x "$d/tools/bin/sdkmanager" ] && return 0
  local t
  for t in "$d"/cmdline-tools/*/bin/sdkmanager; do
    [ -x "$t" ] && return 0
  done
  [ -d "$d/platforms" ] && [ -n "$(ls -A "$d/platforms" 2>/dev/null)" ] && return 0
  return 1
}

SDK_ROOT=""
for cand in \
  "${ANDROID_HOME:-}" \
  "${ANDROID_SDK_ROOT:-}" \
  "/usr/local/lib/android/sdk" \
  "/opt/android-sdk-linux" \
  "/opt/android-sdk" \
  "$HOME/android-sdk" \
  "$HOME/Android/Sdk" \
  "$HOME/Library/Android/sdk"
do
  if usable_sdk "$cand"; then SDK_ROOT="$cand"; break; fi
done

if [ -n "$SDK_ROOT" ]; then
  log "✓ using preinstalled Android SDK at $SDK_ROOT"
else
  # ---------------------------------------------------------------------------
  # Nothing usable on the machine — fetch the command-line tools.
  #
  # Several candidate names are tried on purpose. Google publishes versioned
  # archives (commandlinetools-linux-<rev>_latest.zip) and retires old ones; a
  # single hardcoded revision is exactly the failure mode being fixed here, so
  # the newest known revisions are tried first and older, long-lived ones act as
  # the floor. The first one that downloads wins.
  # ---------------------------------------------------------------------------
  SDK_ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/android-sdk}}"
  log "no Android SDK found — installing command-line tools into $SDK_ROOT"
  mkdir -p "$SDK_ROOT/cmdline-tools"

  case "$(uname -s)" in
    Darwin) OS_TAG="mac" ;;
    *)      OS_TAG="linux" ;;
  esac

  TMP_ZIP="$(mktemp -d)/cmdline-tools.zip"
  GOT=""
  for rev in 13114758 12700392 11479570 11076708 10406996 9477386; do
    url="https://dl.google.com/android/repository/commandlinetools-${OS_TAG}-${rev}_latest.zip"
    log "▸ trying $url"
    if curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 20 -o "$TMP_ZIP" "$url"; then
      GOT="$url"; break
    fi
  done

  if [ -z "$GOT" ]; then
    echo "✗ could not download the Android command-line tools from dl.google.com." >&2
    printf '::error title=Android SDK unavailable::Could not download Android command-line tools from dl.google.com (all known archive revisions returned an error). The runner has no preinstalled SDK either.\n'
    exit 1
  fi

  rm -rf "$SDK_ROOT/cmdline-tools/latest" "$SDK_ROOT/cmdline-tools/cmdline-tools"
  unzip -q "$TMP_ZIP" -d "$SDK_ROOT/cmdline-tools"
  # The archive unpacks as `cmdline-tools/`; sdkmanager REQUIRES the directory
  # to be named after its channel (`latest`) or it refuses to run with
  # "Could not determine SDK root".
  mv "$SDK_ROOT/cmdline-tools/cmdline-tools" "$SDK_ROOT/cmdline-tools/latest"
  log "✓ installed command-line tools from $GOT"
fi

# Resolve the newest sdkmanager available under this root.
SDKMANAGER=""
for c in "$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" "$SDK_ROOT"/cmdline-tools/*/bin/sdkmanager "$SDK_ROOT/tools/bin/sdkmanager"; do
  [ -x "$c" ] && { SDKMANAGER="$c"; break; }
done

export ANDROID_HOME="$SDK_ROOT"
export ANDROID_SDK_ROOT="$SDK_ROOT"
PATH="$SDK_ROOT/platform-tools:$PATH"
[ -n "$SDKMANAGER" ] && PATH="$(dirname "$SDKMANAGER"):$PATH"
export PATH

# Hand the same values to every LATER step of the job (a child process cannot
# mutate its parent's environment; $GITHUB_ENV/$GITHUB_PATH is how Actions does it).
if [ -n "${GITHUB_ENV:-}" ]; then
  { echo "ANDROID_HOME=$SDK_ROOT"; echo "ANDROID_SDK_ROOT=$SDK_ROOT"; } >> "$GITHUB_ENV"
fi
if [ -n "${GITHUB_PATH:-}" ]; then
  [ -n "$SDKMANAGER" ] && dirname "$SDKMANAGER" >> "$GITHUB_PATH"
  echo "$SDK_ROOT/platform-tools" >> "$GITHUB_PATH"
fi

# Licences must be accepted or sdkmanager installs nothing and Gradle fails
# later with "You have not accepted the license agreements". `|| true`: on an
# image where they are already accepted this can exit non-zero harmlessly.
if [ -n "$SDKMANAGER" ]; then
  yes 2>/dev/null | "$SDKMANAGER" --sdk_root="$SDK_ROOT" --licenses >/dev/null 2>&1 || true
  log "✓ sdkmanager: $SDKMANAGER"
else
  log "⚠ no sdkmanager under $SDK_ROOT (relying on preinstalled platforms)"
fi

log "ANDROID_HOME=$SDK_ROOT"
log "platforms: $(ls "$SDK_ROOT/platforms" 2>/dev/null | tr '\n' ' ' || echo none)"
log "build-tools: $(ls "$SDK_ROOT/build-tools" 2>/dev/null | tr '\n' ' ' || echo none)"

if [ -n "${GITHUB_ACTIONS:-}" ]; then
  printf '::notice title=Android SDK::%s (sdkmanager: %s)\n' "$SDK_ROOT" "${SDKMANAGER:-none}"
fi
