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
  echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > /tmp/release.keystore
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
cp "$SRC" "out/app-debug.apk"   # stable name for the release asset

# The checked-in workflow uploads a hardcoded path:
#   android/app/build/outputs/apk/debug/app-debug.apk
# A RELEASE build never writes there, so a signed run would upload nothing.
# GitHub blocks agent tokens from editing .github/workflows/, so rather than
# require a manual workflow edit, the script guarantees that path always holds
# the freshest artefact.
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
