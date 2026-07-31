#!/usr/bin/env bash
# Full APK build. Lives here (not in the workflow) so that fixing or extending
# the build never requires editing a file under .github/workflows/ — that path
# can't be written by an agent token and keeps getting corrupted by mobile
# copy-paste.
set -euo pipefail

# ---------------------------------------------------------------------------
# fail <<'MSG'
#
# Print a failure so it is visible WITHOUT opening the log.
#
# `::error::` is a GitHub Actions workflow command: the runner turns it into an
# annotation, which appears in a red box at the top of the run's summary page
# and in the checks API. The build log is buried three clicks deep and, on a
# phone, is close to unreadable — so the one line that says what to fix has to
# be somewhere else. The same text is also appended to the job summary.
#
# Annotations must be single-line (\n is not rendered), so the message is
# collapsed for the annotation and printed in full to stdout.
# ---------------------------------------------------------------------------
fail() {
  local msg; msg="$(cat)"
  printf '%s\n' "$msg"
  printf '::error title=Build failed::%s\n' "$(printf '%s' "$msg" | tr '\n' ' ' | tr -s ' ')"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    { echo "### ✗ Build failed"; echo '```'; printf '%s\n' "$msg"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 1
}

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

# ---------------------------------------------------------------------------
# PROVE THE API BASE IS COMPILED IN — do not take the env var's word for it.
#
# Vite inlines import.meta.env at BUILD time. If VITE_API_BASE is unset, or is
# set on the wrong scope, the bundle silently keeps the '/api' default. Inside
# the APK that resolves against https://localhost, so every backend call fails
# and the app looks broken while CI stays green and the release page shows a
# perfectly normal signed artifact.
#
# The existing check only printed a warning, which is invisible in a 200-line
# log on a phone. For a SIGNED build - the kind that goes to Play - a missing
# API base is not a warning, it is a defect that costs a full release cycle to
# discover. So: grep the built bundle for the actual origin.
#
# Only enforced when signing. An unsigned local/debug build against a relative
# '/api' is legitimate: it runs on the dev server on the same origin.
# ---------------------------------------------------------------------------
if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ]; then
  if [ -z "${VITE_API_BASE:-}" ]; then
    fail <<MSG
VITE_API_BASE is not set, and this is a SIGNED (release) build.

The APK serves its pages from https://localhost, so the compiled-in default
'/api' points at the phone itself. Every market, push and order request would
fail on a device while working perfectly in a browser - and you would not find
out until after the Play upload.

Fix: add a repository VARIABLE (not a secret) at
  Settings > Secrets and variables > Actions > Variables
  Name:  VITE_API_BASE
  Value: https://www.lawpoetics.ir/api
then re-run this workflow.
MSG
  fi

  # The origin must really be in the output, not merely in the environment.
  API_ORIGIN="$(printf '%s' "$VITE_API_BASE" | sed -E 's#^(https?://[^/]+).*#\1#')"
  if ! grep -rqF "$API_ORIGIN" dist/assets/ 2>/dev/null; then
    fail <<MSG
VITE_API_BASE is set to "$VITE_API_BASE" but "$API_ORIGIN" does not appear
anywhere in dist/assets/ after the build.

That means the value did not reach Vite. The usual cause is defining it as a
repository SECRET instead of a VARIABLE - the workflow reads \${{ vars.* }},
so a secret of the same name is silently ignored and the bundle keeps '/api'.

Move it to Settings > Secrets and variables > Actions > Variables.
MSG
  fi
  echo "  ✓ verified $API_ORIGIN is compiled into the bundle"
fi

# Play rejects any upload whose versionCode is not higher than the last one.
# Driving it from the environment means a new version can be released by
# setting a repository variable, with no workflow edit and no code change.
#
# ---------------------------------------------------------------------------
# ...but the override must never go BACKWARDS.
#
# This stamp is unconditional: whatever APP_VERSION_CODE says wins, even if it
# is lower than the number committed in build.gradle. That is a trap, because
# the repository variable is set once and then forgotten, while build.gradle
# gets bumped in the release commit. Months later the variable still says 4,
# every release commit bumps the file to 5, 6, 7 — and every single build
# silently ships as 4 again.
#
# The failure surfaces at the worst possible moment: after a full build, after
# the upload, as a Play Console rejection ("version code 4 has already been
# used"), with a green CI run insisting everything was fine. The APK on the
# releases page is also indistinguishable by eye from the correct one.
#
# So: the variable may raise the version, never lower it.
# ---------------------------------------------------------------------------
GRADLE_CODE="$(sed -nE 's/.*versionCode ([0-9]+).*/\1/p' android/app/build.gradle | head -1)"
GRADLE_NAME="$(sed -nE 's/.*versionName "([^"]*)".*/\1/p' android/app/build.gradle | head -1)"
echo "▸ build.gradle declares versionCode=${GRADLE_CODE} versionName=${GRADLE_NAME}"

# This is NOT hypothetical. The variable was found set to 1 while build.gradle
# said 5, which means every CI build ever produced here was stamped
# versionCode 1 — including the ones prepared for a Play upload.
#
# Rather than fail the build (which blocks releasing from a phone, where
# changing a repo variable is awkward), take the HIGHER of the two. That can
# never downgrade, never blocks, and still lets the variable raise a version
# without a code change. The stale value is reported loudly instead.
STAMP_CODE="${GRADLE_CODE:-1}"
STAMP_NAME="${GRADLE_NAME:-1.0}"
VERSION_WARNING=""

if [ -n "${APP_VERSION_CODE:-}" ]; then
  if [ "${APP_VERSION_CODE}" -lt "${GRADLE_CODE:-0}" ]; then
    VERSION_WARNING="APP_VERSION_CODE variable is ${APP_VERSION_CODE} but build.gradle says ${GRADLE_CODE}; using ${GRADLE_CODE}. Update or delete the variable at Settings > Secrets and variables > Actions > Variables."
    echo "  ⚠  ${VERSION_WARNING}"
    printf '::warning title=Stale APP_VERSION_CODE::%s\n' "$VERSION_WARNING"
  else
    STAMP_CODE="${APP_VERSION_CODE}"
    STAMP_NAME="${APP_VERSION_NAME:-${GRADLE_NAME:-1.0}}"
  fi
else
  echo "  (no APP_VERSION_CODE variable set — using the committed values, which is fine)"
fi

echo "▸ stamping versionCode=${STAMP_CODE} versionName=${STAMP_NAME}"
sed -i.bak -E "s/versionCode [0-9]+/versionCode ${STAMP_CODE}/" android/app/build.gradle
sed -i.bak -E "s/versionName \"[^\"]*\"/versionName \"${STAMP_NAME}\"/" android/app/build.gradle
rm -f android/app/build.gradle.bak
grep -nE "versionCode|versionName" android/app/build.gradle

# Whatever path we took, report what the build will ACTUALLY carry. This is
# the number Play compares against, so it belongs in the log unconditionally
# rather than only when an override happened to be set.
EFFECTIVE_CODE="$(sed -nE 's/.*versionCode ([0-9]+).*/\1/p' android/app/build.gradle | head -1)"
EFFECTIVE_NAME="$(sed -nE 's/.*versionName "([^"]*)".*/\1/p' android/app/build.gradle | head -1)"
echo "▸ building versionCode=${EFFECTIVE_CODE} versionName=${EFFECTIVE_NAME}"

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
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | tr -d '[:space:]' | base64 -d > /tmp/release.keystore 2>/tmp/b64err.txt || fail <<MSG
ANDROID_KEYSTORE_BASE64 is not valid base64. ($(cat /tmp/b64err.txt))
Fix: in Termux run
    base64 -w 0 ~/fbt-keystore/fbt-release.keystore
and paste the ENTIRE one-line output as the secret value.
MSG

  KS_BYTES=$(wc -c < /tmp/release.keystore)
  echo "  decoded ${KS_BYTES} bytes"

  # -------------------------------------------------------------------------
  # EXACT TRUNCATION CHECK.
  #
  # A size floor is not enough: a partial copy that still lands above the floor
  # decodes "successfully" and then dies inside keytool as java.io.EOFException,
  # which names nothing.
  #
  # A PKCS12 keystore is DER, so it begins with a SEQUENCE tag (0x30) followed
  # by a long-form length. For these files that is 0x82, meaning "the next two
  # bytes are the content length". So the complete file must be exactly
  # 4 + that length bytes. Comparing the declared length against the real size
  # detects a truncated paste precisely, and can say how much is missing.
  # -------------------------------------------------------------------------
  DECLARED=$(od -An -tu1 -N4 /tmp/release.keystore | awk '{ if ($1==48 && $2==130) print 4 + $3*256 + $4; else print 0 }')
  if [ "${DECLARED:-0}" -gt 0 ] && [ "$KS_BYTES" -ne "$DECLARED" ]; then
    if [ "$KS_BYTES" -lt "$DECLARED" ]; then
      fail <<MSG
ANDROID_KEYSTORE_BASE64 is INCOMPLETE.
The keystore says it should be ${DECLARED} bytes but only ${KS_BYTES} arrived
- $((DECLARED - KS_BYTES)) bytes are missing, so the copy was cut short.
This is the most common phone mistake: the base64 string is ~3000
characters and the browser or clipboard silently kept only part of it.
Fix: in Termux run
    base64 -w 0 ~/fbt-keystore/fbt-release.keystore > ~/ks.txt
    termux-setup-storage && cp ~/ks.txt ~/storage/downloads/
then open ks.txt from Downloads with a text editor, Select All, Copy,
and paste that as the ANDROID_KEYSTORE_BASE64 secret value.
MSG
    else
      fail <<MSG
ANDROID_KEYSTORE_BASE64 has ${KS_BYTES} bytes but the keystore declares
${DECLARED}. Extra data came along with the copy - most likely another
line, or text from the terminal prompt. Re-copy ONLY the base64 string.
MSG
    fi
  fi

  if [ "$KS_BYTES" -lt 1000 ]; then
    fail <<MSG
The decoded keystore is only ${KS_BYTES} bytes - far too small.
A real keystore is about 2-3 KB, so the secret was truncated by a
partial copy. Re-copy the FULL base64 string into
ANDROID_KEYSTORE_BASE64.
MSG
  fi

  # These two are checked explicitly rather than with `${VAR:?}` so the message
  # is an annotation the user can read from the summary page, not a bash
  # one-liner buried in the log.
  [ -n "${ANDROID_KEY_ALIAS:-}" ] || fail <<MSG
The ANDROID_KEY_ALIAS secret is not set. Add it at
Settings > Secrets and variables > Actions > Secrets.
Its value should be: fbt
MSG
  [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ] || fail <<MSG
The ANDROID_KEYSTORE_PASSWORD secret is not set. Add it at
Settings > Secrets and variables > Actions > Secrets.
Its value is the password you typed when you ran mk.sh.
MSG

  # Prove the password and the alias are right, with keytool, before Gradle
  # gets a chance to fail obscurely.
  if ! keytool -list -keystore /tmp/release.keystore \
        -storepass "$ANDROID_KEYSTORE_PASSWORD" > /tmp/kslist.txt 2>&1; then
    if grep -qi 'tampered\|password was incorrect\|wrong password' /tmp/kslist.txt; then
      fail <<MSG
ANDROID_KEYSTORE_PASSWORD is wrong.
This is the password you typed when you ran mk.sh - not your GitHub
password and not your Google password. keytool said:
$(head -3 /tmp/kslist.txt)
MSG
    else
      if grep -qi 'EOFException' /tmp/kslist.txt; then
        fail <<MSG
The keystore is truncated - it ended before keytool expected
(java.io.EOFException). ${KS_BYTES} bytes were decoded, which is not a
complete file. The base64 secret was only partly copied.
Fix: in Termux run
    base64 -w 0 ~/fbt-keystore/fbt-release.keystore > ~/ks.txt
    termux-setup-storage && cp ~/ks.txt ~/storage/downloads/
then open ks.txt from Downloads, Select All, Copy, and paste the whole
thing as ANDROID_KEYSTORE_BASE64.
MSG
      fi
      fail <<MSG
The secret decoded (${KS_BYTES} bytes) but the result is not a readable
keystore. Re-run mk.sh and re-copy both the base64 and the password.
keytool said: $(head -3 /tmp/kslist.txt)
MSG
    fi
  fi

  if ! grep -qi "^${ANDROID_KEY_ALIAS}," /tmp/kslist.txt; then
    fail <<MSG
Alias '${ANDROID_KEY_ALIAS}' is not in this keystore.
It actually contains: $(grep -iE '^[a-z0-9_.-]+,' /tmp/kslist.txt | cut -d, -f1 | tr '\n' ' ')
Fix: set the ANDROID_KEY_ALIAS secret to that name (mk.sh uses 'fbt').
MSG
  fi

  echo "  ✓ keystore opens, alias '${ANDROID_KEY_ALIAS}' present"
  export ANDROID_KEYSTORE_PATH=/tmp/release.keystore

  echo "▸ building SIGNED release APK"
  ./gradlew assembleRelease --no-daemon --stacktrace || fail <<MSG
Gradle failed while building the signed release APK.
The keystore itself was already verified as valid, so this is a build
error rather than a signing/secret problem. Open the run log and look
for the first line starting with "* What went wrong:".
MSG
  BUILT="app/build/outputs/apk/release/app-release.apk"
  OUT="app-release.apk"

  # Google Play does not accept APKs for new apps — it requires an Android App
  # Bundle. The APK above is still built because it is what you sideload for
  # testing and what Iranian stores (Bazaar, Myket) accept, so we produce both
  # from the same signed configuration rather than making you choose.
  echo "▸ building SIGNED release AAB (this is what Google Play needs)"
  ./gradlew bundleRelease --no-daemon --stacktrace || fail <<MSG
Gradle failed while building the signed AAB, even though the release
APK built successfully. Open the run log and look for the first line
starting with "* What went wrong:".
MSG
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

# ---------------------------------------------------------------------------
# Success summary, written to the run's summary page.
#
# Same reasoning as `fail`: the one thing that must be checked before uploading
# to Play is whether the artifact is SIGNED or a debug build, and that should
# not require scrolling a log on a phone.
# ---------------------------------------------------------------------------
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ]; then
      echo "### ✓ SIGNED release build"
      echo ""
      echo "| file | size | use |"
      echo "|---|---|---|"
      [ -f out/app-release.aab ] && echo "| \`app-release.aab\` | $(du -h out/app-release.aab | cut -f1) | **upload this to Google Play** |"
      [ -f out/app-release.apk ] && echo "| \`app-release.apk\` | $(du -h out/app-release.apk | cut -f1) | sideload / Bazaar / Myket |"
      echo ""
      # Report the version actually compiled in, not the override variable —
      # they differ whenever the variable is unset, and the whole point of
      # this line is to be trustworthy before a Play upload.
      echo "versionCode: \`${EFFECTIVE_CODE:-?}\` · versionName: \`${EFFECTIVE_NAME:-?}\` — Play rejects a re-upload with the same code."
      [ -n "${VERSION_WARNING:-}" ] && { echo ""; echo "> ⚠ ${VERSION_WARNING}"; }
    else
      echo "### ⚠ DEBUG build (not publishable)"
      echo ""
      echo "No keystore was supplied, so this is debug-signed. It installs for"
      echo "testing but Google Play will reject it."
      echo ""
      echo "Set the four \`ANDROID_*\` secrets and run the workflow again."
    fi
    echo ""
    echo "Download: [Releases → latest](https://github.com/mshiravi433-ctrl/fbtcryp/releases/tag/latest)"
  } >> "$GITHUB_STEP_SUMMARY"
fi
