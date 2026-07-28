#!/usr/bin/env bash
# Full APK build. Lives here (not in the workflow) so that fixing or extending
# the build never requires editing a file under .github/workflows/ — that path
# can't be written by an agent token and keeps getting corrupted by mobile
# copy-paste.
set -euo pipefail

# ---------------------------------------------------------------------------
# Toolchain preflight.
#
# AGP 8.7 requires JDK 17 or newer and Gradle 8.9+. The checked-in workflow
# pins JDK 17, which is correct for Capacitor 6 — but a build that fails
# thirty lines into Gradle with a cryptic class-version error costs far more
# time than a clear message here does.
# ---------------------------------------------------------------------------
if command -v java >/dev/null 2>&1; then
  JAVA_MAJOR="$(java -version 2>&1 | head -1 | sed -E 's/.*"([0-9]+).*/\1/')"
  echo "▸ java ${JAVA_MAJOR}"
  if [ "${JAVA_MAJOR:-0}" -lt 17 ]; then
    echo "✗ AGP 8.7 needs JDK 17+. Found ${JAVA_MAJOR}."
    echo "  Set java-version: 17 in the setup-java step of your workflow."
    exit 1
  fi
else
  echo "✗ No JDK found. Add actions/setup-java (temurin, 17) to the workflow."
  exit 1
fi

echo "▸ installing dependencies"
npm ci

echo "▸ building web bundle"
if [ -z "${VITE_API_BASE:-}" ]; then
  echo "  ⚠  VITE_API_BASE is not set."
  echo "     The packaged app serves pages from https://localhost, so a relative"
  echo "     '/api' path resolves to nothing and the AI features will be dead."
  echo "     Set it as a repository variable to your deployed origin, e.g."
  echo "     https://your-app.vercel.app/api"
else
  echo "  API base: $VITE_API_BASE"
fi
npm run build

# Play rejects any upload whose versionCode is not higher than the last one.
# Driving it from the environment means a new version can be released by
# setting a repository variable, with no workflow edit and no code change.
if [ -n "${APP_VERSION_CODE:-}" ]; then
  echo "▸ stamping versionCode=$APP_VERSION_CODE versionName=${APP_VERSION_NAME:-1.0}"
  sed -i.bak -E "s/versionCode [0-9]+/versionCode ${APP_VERSION_CODE}/" android/app/build.gradle
  sed -i.bak -E "s/versionName \"[^\"]*\"/versionName \"${APP_VERSION_NAME:-1.0}\"/" android/app/build.gradle
  rm -f android/app/build.gradle.bak
  grep -nE "versionCode|versionName" android/app/build.gradle
fi

echo "▸ syncing Capacitor"
npx cap sync android

chmod +x android/gradlew
cd android

# Signed release build when a keystore is supplied, debug otherwise.
# A release APK must be signed or Android refuses to install it, and Play
# requires a key you control (never a generated throwaway).
if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ]; then
  echo "▸ decoding keystore"

  # -------------------------------------------------------------------------
  # VALIDATE THE KEYSTORE BEFORE HANDING IT TO GRADLE.
  #
  # This used to be a bare `base64 -d` straight into Gradle. Every way of
  # getting this wrong — and on a phone there are several — surfaced 200 lines
  # later as a Gradle stack trace that names none of them:
  #
  #   • the base64 got line-wrapped by the terminal or the paste
  #   • a stray space / CR (\r) came along from a mobile clipboard
  #   • the password is wrong
  #   • the alias is not the one inside the keystore
  #
  # Each has a completely different fix, so guessing is expensive. We check
  # each one here and say which it is.
  # -------------------------------------------------------------------------

  # Strip whitespace, newlines and CRs. A correct value has none of these, and
  # every one of them is a paste artefact rather than something the user meant.
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | tr -d '[:space:]' | base64 -d > /tmp/release.keystore 2>/tmp/b64err.txt || {
    echo ""
    echo "✗ ANDROID_KEYSTORE_BASE64 is not valid base64."
    echo "  $(cat /tmp/b64err.txt)"
    echo ""
    echo "  Regenerate it on ONE line and re-paste the secret:"
    echo "    base64 -w 0 ~/fbt-keystore/fbt-release.keystore"
    echo "  Make sure you copied the whole string with no characters missing."
    exit 1
  }

  KS_BYTES=$(wc -c < /tmp/release.keystore)
  echo "  decoded ${KS_BYTES} bytes"
  if [ "$KS_BYTES" -lt 1000 ]; then
    echo ""
    echo "✗ The decoded keystore is only ${KS_BYTES} bytes — far too small."
    echo "  A real keystore is roughly 2-3 KB. The secret was truncated,"
    echo "  most likely by a partial copy. Re-copy the FULL base64 string."
    exit 1
  fi

  : "${ANDROID_KEY_ALIAS:?ANDROID_KEY_ALIAS secret is not set (it should be: fbt)}"
  : "${ANDROID_KEYSTORE_PASSWORD:?ANDROID_KEYSTORE_PASSWORD secret is not set}"

  # Prove the password and the alias are right, with keytool, before Gradle
  # gets a chance to fail obscurely.
  if ! keytool -list -keystore /tmp/release.keystore \
        -storepass "$ANDROID_KEYSTORE_PASSWORD" > /tmp/kslist.txt 2>&1; then
    echo ""
    echo "✗ Could not open the keystore. keytool said:"
    sed 's/^/    /' /tmp/kslist.txt | head -5
    echo ""
    if grep -qi 'tampered\|password was incorrect\|wrong password' /tmp/kslist.txt; then
      echo "  → ANDROID_KEYSTORE_PASSWORD is wrong. This is the password you"
      echo "    typed when you ran mk.sh, not your GitHub or Google password."
    else
      echo "  → The file decoded but is not a readable keystore. Re-run mk.sh"
      echo "    and re-copy both the base64 and the password."
    fi
    exit 1
  fi

  if ! grep -qi "^${ANDROID_KEY_ALIAS}," /tmp/kslist.txt; then
    echo ""
    echo "✗ Alias '${ANDROID_KEY_ALIAS}' is not in this keystore."
    echo "  It actually contains:"
    grep -iE '^[a-z0-9_.-]+,' /tmp/kslist.txt | sed 's/^/    /'
    echo ""
    echo "  → Set ANDROID_KEY_ALIAS to the name shown above (mk.sh uses 'fbt')."
    exit 1
  fi

  echo "  ✓ keystore opens, alias '${ANDROID_KEY_ALIAS}' present"
  export ANDROID_KEYSTORE_PATH=/tmp/release.keystore

  echo "▸ building SIGNED release APK"
  ./gradlew assembleRelease --no-daemon --stacktrace
  BUILT="app/build/outputs/apk/release/app-release.apk"
  OUT="app-release.apk"

  # Google Play does not accept APKs for new apps — it requires an Android App
  # Bundle. The APK above is still built because it is what you sideload for
  # testing and what Iranian stores (Bazaar, Myket) accept, so we produce both
  # from the same signed configuration rather than making you choose.
  echo "▸ building SIGNED release AAB (this is what Google Play needs)"
  ./gradlew bundleRelease --no-daemon --stacktrace
  BUNDLE="app/build/outputs/bundle/release/app-release.aab"
else
  echo "▸ no keystore supplied — building debug APK"
  echo "  (debug builds install fine for testing but cannot go on Google Play)"
  ./gradlew assembleDebug --no-daemon --stacktrace
  BUILT="app/build/outputs/apk/debug/app-debug.apk"
  OUT="app-debug.apk"
fi

cd ..
SRC="android/$BUILT"
if [ ! -f "$SRC" ]; then
  echo "✗ expected APK at $SRC but it is missing"
  exit 1
fi

# Always publish under a stable path so the workflow doesn't need to know
# which variant ran.
mkdir -p out
cp "$SRC" "out/$OUT"

# NOTE: a SIGNED build is deliberately NOT copied to "out/app-debug.apk".
# It used to be, as a "stable name", which meant a correctly signed release
# appeared on the releases page labelled debug — so you could not tell by
# looking whether signing had actually worked, which is the one thing you need
# to know before uploading to Play. The name now always reflects the variant:
# app-release.apk when signed, app-debug.apk when not.

# Compatibility shim for the OLD workflow, which uploads a hardcoded path:
#   android/app/build/outputs/apk/debug/app-debug.apk
# A RELEASE build never writes there, so under the old workflow a signed run
# would upload nothing at all. Keeping this copy means an un-updated workflow
# still publishes something rather than failing silently.
#
# Once ci/WORKFLOW-FIXED.yml is in place this shim is redundant, because that
# workflow collects out/*.apk and out/*.aab directly.
STABLE_DIR="android/app/build/outputs/apk/debug"
mkdir -p "$STABLE_DIR"
if [ "$SRC" != "$STABLE_DIR/app-debug.apk" ]; then
  cp "$SRC" "$STABLE_DIR/app-debug.apk"
fi

echo "✓ APK built: $(du -h "$SRC" | cut -f1) → out/$OUT"

# Copy the Play-ready bundle out too, when one was produced.
if [ -n "${BUNDLE:-}" ]; then
  BSRC="android/$BUNDLE"
  if [ -f "$BSRC" ]; then
    cp "$BSRC" out/app-release.aab
    # Also drop it beside the APK the workflow already collects, so the Play
    # bundle is attached to the release without touching the workflow file.
    cp "$BSRC" "$STABLE_DIR/app-release.aab"
    echo "✓ AAB built: $(du -h "$BSRC" | cut -f1) → out/app-release.aab"
    echo "  ↳ upload THIS file to Google Play Console, not the .apk"
  else
    echo "✗ expected AAB at $BSRC but it is missing"
    exit 1
  fi
fi

# Report what signed it, so a mis-signed build is obvious in the log.
if command -v keytool >/dev/null 2>&1 && [ -n "${ANDROID_KEYSTORE_BASE64:-}" ]; then
  echo "▸ signature:"
  keytool -printcert -jarfile "$SRC" 2>/dev/null | head -6 || true
fi
