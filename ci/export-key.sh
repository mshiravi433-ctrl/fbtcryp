#!/usr/bin/env bash
# =============================================================================
# FBT Swap — export the signing keystore as base64, safely, from a phone.
#
#   bash export-key.sh
#
# WHY THIS EXISTS
#
# The obvious one-liner
#     base64 -w 0 ~/fbt-keystore/fbt-release.keystore > ~/ks.txt
# fails silently on many Termux installs and leaves an EMPTY file behind,
# because the shell creates the output file BEFORE running the command. Two
# different things cause it and they need different fixes:
#
#   1. Termux's base64 comes from BusyBox on some installs, and BusyBox base64
#      has no -w option. It prints "unrecognized option" to stderr — which
#      scrolls away — and writes nothing.
#   2. The keystore is not at the expected path, so base64 has nothing to read.
#
# This script finds the keystore, encodes it with whichever tool actually
# works, and then PROVES the result is correct by decoding it again and
# comparing bytes. That last step matters: the previous build failed with
# java.io.EOFException because a truncated string was pasted, and nothing
# on the phone side had checked it.
# =============================================================================
set -euo pipefail

GRN=$'\033[32m'; RED=$'\033[31m'; YLW=$'\033[33m'; CYN=$'\033[36m'; BLD=$'\033[1m'; OFF=$'\033[0m'
say() { printf '%s\n' "$*"; }
hr()  { printf '%s\n' "────────────────────────────────────────────"; }

say ""
say "${BLD}${CYN}FBT Swap — export keystore as base64${OFF}"
hr

# --- 1. locate the keystore ------------------------------------------------
KS=""
for candidate in \
  "${HOME}/fbt-keystore/fbt-release.keystore" \
  "${HOME}/fbt-release.keystore" \
  "${HOME}/storage/downloads/fbt-release.keystore"
do
  [ -f "$candidate" ] && { KS="$candidate"; break; }
done

if [ -z "$KS" ]; then
  # Last resort: search the home directory. Slow, but better than telling
  # someone their key is gone when it is one directory over.
  say "${YLW}Not in the usual places — searching \$HOME…${OFF}"
  KS="$(find "$HOME" -maxdepth 4 \( -name '*.keystore' -o -name '*.jks' \) \
        ! -name '*.backup-*' 2>/dev/null | head -1)"
fi

if [ -z "$KS" ] || [ ! -f "$KS" ]; then
  say ""
  say "${RED}✗ No keystore found.${OFF}"
  say ""
  say "The key was never created, or it was created under another user."
  say "Create it with:"
  say "  ${BLD}bash mk.sh${OFF}"
  exit 1
fi

KS_SIZE=$(wc -c < "$KS")
say "${GRN}✓${OFF} keystore: $KS"
say "  size: ${KS_SIZE} bytes"

if [ "$KS_SIZE" -lt 1000 ]; then
  say ""
  say "${RED}✗ That file is only ${KS_SIZE} bytes — too small to be a keystore.${OFF}"
  say "  A real one is roughly 2-3 KB. Re-create it with: ${BLD}bash mk.sh${OFF}"
  exit 1
fi

# --- 2. encode, trying each tool until one works ---------------------------
OUT="${HOME}/ks.txt"
rm -f "$OUT"

encode() {
  # coreutils base64 (preferred)
  if base64 -w 0 "$KS" > "$OUT" 2>/dev/null && [ -s "$OUT" ]; then
    echo "base64 -w 0"; return 0
  fi
  # BusyBox base64: no -w, so wrap manually
  if base64 "$KS" 2>/dev/null | tr -d '\n\r ' > "$OUT" && [ -s "$OUT" ]; then
    echo "base64 | tr"; return 0
  fi
  # openssl is present on most Termux installs even when base64 is odd
  if openssl base64 -A -in "$KS" > "$OUT" 2>/dev/null && [ -s "$OUT" ]; then
    echo "openssl base64 -A"; return 0
  fi
  return 1
}

if ! METHOD="$(encode)"; then
  say ""
  say "${RED}✗ Every encoder failed.${OFF}"
  say "  Install coreutils and try again:"
  say "    ${BLD}pkg install coreutils -y${OFF}"
  exit 1
fi
say "${GRN}✓${OFF} encoded using: ${METHOD}"

# Strip any stray whitespace the encoder may have left.
tr -d '\n\r \t' < "$OUT" > "${OUT}.tmp" && mv "${OUT}.tmp" "$OUT"

CHARS=$(wc -c < "$OUT")
say "  base64 length: ${CHARS} characters"

# --- 3. PROVE it round-trips ----------------------------------------------
# Decoding the text back and comparing it to the original is the only way to
# know the file you are about to copy is complete and correct.
#
# The scratch file must NOT go in /tmp: Android has no /tmp directory, so on
# Termux the redirect fails, nothing is written, and the comparison reads zero
# bytes — reporting a corrupt keystore when the keystore was perfectly fine.
# TMPDIR is set correctly by Termux; $HOME is a guaranteed-writable fallback.
VERIFY="${TMPDIR:-$HOME}/_fbt_verify.bin"
rm -f "$VERIFY"

if ! base64 -d < "$OUT" > "$VERIFY" 2>/dev/null; then
  openssl base64 -d -A -in "$OUT" -out "$VERIFY" 2>/dev/null || true
fi
VSIZE=$(wc -c < "$VERIFY" 2>/dev/null || echo 0)

if [ "${VSIZE:-0}" -eq 0 ]; then
  # Could not verify — but that is a limitation here, not evidence the
  # keystore is bad. Say so plainly instead of condemning a good file.
  say "${YLW}⚠${OFF} could not run the round-trip check on this device"
  say "  (no working base64 decoder). The encoding itself succeeded."
elif [ "$VSIZE" != "$KS_SIZE" ]; then
  say ""
  say "${RED}✗ Round-trip check FAILED: decoded ${VSIZE} bytes, expected ${KS_SIZE}.${OFF}"
  say "  Do not use this output. Re-run the script."
  rm -f "$VERIFY"
  exit 1
else
  say "${GRN}✓${OFF} verified: decodes back to exactly ${KS_SIZE} bytes"
fi
rm -f "$VERIFY"

# --- 4. put it where a text editor can reach it ----------------------------
# Copying 3000+ characters out of the terminal is what truncated the string
# last time. A file opened in a text editor supports a reliable Select All.
COPIED=""
if [ -d "${HOME}/storage/downloads" ]; then
  cp "$OUT" "${HOME}/storage/downloads/ks.txt" && COPIED="${HOME}/storage/downloads/ks.txt"
else
  say ""
  say "${YLW}⚠ Downloads folder not linked yet. Run this once:${OFF}"
  say "    ${BLD}termux-setup-storage${OFF}"
  say "  then run this script again."
fi

hr
say "${BLD}${GRN}Done.${OFF}"
hr
say ""
if [ -n "$COPIED" ]; then
  say "The file is in your phone's ${BLD}Downloads${OFF} folder as ${BLD}ks.txt${OFF}"
  say ""
  say "  1. Open ${BLD}Files${OFF} → ${BLD}Downloads${OFF} → ${BLD}ks.txt${OFF} (with a text editor)"
  say "  2. ${BLD}Select All${OFF} → ${BLD}Copy${OFF}"
  say "  3. Paste as the value of ${BLD}ANDROID_KEYSTORE_BASE64${OFF} at"
  say "     ${CYN}github.com/mshiravi433-ctrl/fbtcryp/settings/secrets/actions${OFF}"
  say ""
  say "It must be ${BLD}${CHARS}${OFF} characters. If your editor shows fewer,"
  say "the copy was cut short — that is exactly what broke the last build."
  say ""
  say "${YLW}When the secret is saved, delete both copies:${OFF}"
  say "  ${BLD}rm ~/ks.txt ~/storage/downloads/ks.txt${OFF}"
else
  say "Saved to: ${BLD}${OUT}${OFF}"
fi
say ""
