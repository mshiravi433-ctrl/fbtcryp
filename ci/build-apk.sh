#!/usr/bin/env bash
# Full APK build. Lives here (not in the workflow) so that fixing or extending
# the build never requires editing a file under .github/workflows/ — that path
# can't be written by an agent token and keeps getting corrupted by mobile
# copy-paste.
set -euo pipefail

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

echo "✓ APK built: $(du -h "$SRC" | cut -f1) → out/$OUT"

# Copy the Play-ready bundle out too, when one was produced.
if [ -n "${BUNDLE:-}" ]; then
  BSRC="android/$BUNDLE"
  if [ -f "$BSRC" ]; then
    cp "$BSRC" out/app-release.aab
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
