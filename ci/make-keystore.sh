#!/usr/bin/env bash
# =============================================================================
# FBT Swap — create an Android signing keystore, from a phone.
#
# Run this inside Termux. It creates the keystore, prints the four values you
# must paste into GitHub Secrets, and shows the SHA-1 you need for restricting
# the Gemini API key.
#
#   bash make-keystore.sh
#
# WHY THIS MATTERS
# The keystore is how Android knows an update really came from you. If you lose
# it, you can NEVER update the app again under the same package name — not with
# a new key, not by contacting Google. Every user has to uninstall and install a
# different app, and you lose all of them. Treat the file and its password the
# way you treat the seed phrase of a wallet.
# =============================================================================
set -euo pipefail

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; CYN=$'\033[36m'; BLD=$'\033[1m'; OFF=$'\033[0m'
say() { printf '%s\n' "$*"; }
hr()  { printf '%s\n' "────────────────────────────────────────────"; }

OUT_DIR="${HOME}/fbt-keystore"
KS_NAME="fbt-release.keystore"
KS_PATH="${OUT_DIR}/${KS_NAME}"
ALIAS="fbt"
VALID_DAYS=10950   # 30 years. Play requires a key valid past 2033; this clears it.

say ""
say "${BLD}${CYN}FBT Swap — Android keystore generator${OFF}"
hr

# --- preflight -----------------------------------------------------------
if ! command -v keytool >/dev/null 2>&1; then
  say "${RED}✗ keytool not found.${OFF}"
  say ""
  say "Install Java first, then run this again:"
  say "  ${BLD}pkg install openjdk-17${OFF}"
  exit 1
fi
say "${GRN}✓${OFF} keytool found"

if [ -f "$KS_PATH" ]; then
  say ""
  say "${YLW}⚠  A keystore already exists at:${OFF}"
  say "   $KS_PATH"
  say ""
  say "${RED}Do NOT overwrite it if you have already published an app signed"
  say "with it — you would lose the ability to update that app forever.${OFF}"
  say ""
  printf 'Type OVERWRITE to replace it, or press Enter to stop: '
  read -r confirm
  [ "$confirm" = "OVERWRITE" ] || { say "Stopped. Existing keystore untouched."; exit 0; }
  mv "$KS_PATH" "${KS_PATH}.backup-$(date +%s)"
  say "${GRN}✓${OFF} old keystore renamed to .backup-*"
fi

mkdir -p "$OUT_DIR"

# --- password ------------------------------------------------------------
say ""
say "${BLD}Step 1 — choose a password${OFF}"
say "At least 8 characters. Write it somewhere safe BEFORE you continue:"
say "losing it is the same as losing the keystore."
say ""

while :; do
  printf 'Password: '
  stty -echo 2>/dev/null || true
  read -r PASS
  stty echo 2>/dev/null || true
  say ""

  if [ "${#PASS}" -lt 8 ]; then
    say "${RED}Too short — at least 8 characters.${OFF}"
    continue
  fi

  printf 'Repeat it: '
  stty -echo 2>/dev/null || true
  read -r PASS2
  stty echo 2>/dev/null || true
  say ""

  if [ "$PASS" != "$PASS2" ]; then
    say "${RED}They don't match. Try again.${OFF}"
    continue
  fi
  break
done
say "${GRN}✓${OFF} password accepted"

# --- generate ------------------------------------------------------------
# One key, one alias, same password for store and key. Keeping them identical
# removes a whole class of "which password was that" mistakes, and offers no
# real security benefit here — anyone who has the store password has the file.
say ""
say "${BLD}Step 2 — generating the key${OFF} (this takes a few seconds)"

keytool -genkeypair \
  -v \
  -keystore "$KS_PATH" \
  -alias "$ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity "$VALID_DAYS" \
  -storetype PKCS12 \
  -storepass "$PASS" \
  -keypass "$PASS" \
  -dname "CN=FBT Swap, OU=FBT, O=Fanos Bazaar Pishgam, L=Isfahan, C=IR" \
  >/dev/null 2>&1

[ -f "$KS_PATH" ] || { say "${RED}✗ keystore was not created${OFF}"; exit 1; }
say "${GRN}✓${OFF} keystore created: $KS_PATH"

# --- base64 --------------------------------------------------------------
# GitHub Secrets hold text, not files, so the binary keystore is base64-encoded.
# -w0 keeps it on one line; BusyBox base64 doesn't know -w, hence the fallback.
B64_FILE="${OUT_DIR}/keystore-base64.txt"
if base64 -w0 "$KS_PATH" > "$B64_FILE" 2>/dev/null; then :; else
  base64 "$KS_PATH" | tr -d '\n' > "$B64_FILE"
fi
say "${GRN}✓${OFF} base64 written to: $B64_FILE"

# --- fingerprint ---------------------------------------------------------
SHA1=$(keytool -list -v -keystore "$KS_PATH" -storepass "$PASS" 2>/dev/null \
       | grep -i 'SHA1:' | head -1 | sed 's/.*SHA1: *//')

# --- report --------------------------------------------------------------
say ""
hr
say "${BLD}${GRN}Done. Now add these four GitHub Secrets.${OFF}"
hr
say ""
say "Go to: ${CYN}github.com/mshiravi433-ctrl/fbtcryp/settings/secrets/actions${OFF}"
say "Press ${BLD}New repository secret${OFF} four times:"
say ""
say "  1. Name: ${BLD}ANDROID_KEYSTORE_BASE64${OFF}"
say "     Value: the whole contents of"
say "            ${CYN}${B64_FILE}${OFF}"
say ""
say "  2. Name: ${BLD}ANDROID_KEYSTORE_PASSWORD${OFF}"
say "     Value: the password you just chose"
say ""
say "  3. Name: ${BLD}ANDROID_KEY_ALIAS${OFF}"
say "     Value: ${BLD}${ALIAS}${OFF}"
say ""
say "  4. Name: ${BLD}ANDROID_KEY_PASSWORD${OFF}"
say "     Value: the same password again"
say ""
hr
say "${BLD}Signing fingerprint (SHA-1)${OFF}"
say "  ${CYN}${SHA1}${OFF}"
say ""
say "You need this to restrict the Gemini API key in Google Cloud Console"
say "to your app only. Save it."
hr
say ""
say "${YLW}${BLD}BACK UP THE KEYSTORE NOW.${OFF}"
say "Copy ${BLD}${KS_NAME}${OFF} somewhere that survives losing this phone."
say "Lose it and you can never update the app again."
say ""
say "To copy it into your phone's Downloads folder:"
say "  ${BLD}termux-setup-storage${OFF}"
say "  ${BLD}cp ${KS_PATH} ~/storage/downloads/${OFF}"
say ""
say "${RED}Never put the keystore in the git repository.${OFF}"
say ".gitignore already blocks *.keystore and *.jks, but don't test it."
say ""
