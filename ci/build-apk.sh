#!/usr/bin/env bash
# Full APK build. Lives here (not in the workflow) so that fixing or extending
# the build never requires editing a file under .github/workflows/ — that path
# is the one an agent token can't write and the one that keeps getting
# corrupted by mobile copy-paste.
set -euo pipefail

echo "▸ installing dependencies"
npm ci

echo "▸ building web bundle"
npm run build

echo "▸ syncing Capacitor"
npx cap sync android

echo "▸ building debug APK"
chmod +x android/gradlew
cd android
./gradlew assembleDebug --no-daemon --stacktrace
cd ..

APK="android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  echo "✗ expected APK at $APK but it is missing"
  exit 1
fi

echo "✓ APK built: $(du -h "$APK" | cut -f1)"
