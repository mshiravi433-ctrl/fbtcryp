#!/usr/bin/env bash
# ============================================================================
# START THE PREVIEW SERVER WITH ZERO COMMANDS
# ----------------------------------------------------------------------------
# `postCreateCommand` installs dependencies (npm ci --force, ~1 min, once).
# This script is `postStartCommand`: every time the Codespace starts, the dev
# server is already running by the time the editor window is usable, so the
# owner never has to type anything. That is the whole point — every extra step
# is a place this preview has already been lost once.
#
# It is deliberately not `npm run dev` inline as postStartCommand: that would
# occupy the attach terminal forever and hide the log. Instead it detaches and
# writes to /tmp/fbt-dev.log, which is also the first place to look if the
# preview tab is blank.
# ============================================================================
set -uo pipefail

# postStartCommand runs with the workspace folder as cwd; be explicit anyway so
# the script also works if someone runs it by hand from .devcontainer/.
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")" || exit 0

# A restart of the container leaves no process behind, but a manual
# "Restart Codespace" can fire this twice. Two concurrent vite servers fight
# over 5173 and the second dies with EADDRINUSE — visible as a dead preview.
if pgrep -f "concurrently .*vite" >/dev/null 2>&1; then
  echo "[preview] dev server already running"
  exit 0
fi

if [ ! -d node_modules ]; then
  echo "[preview] node_modules missing — installing first (this is postCreate's"
  echo "[preview] job; if you see this, the install failed or was cancelled)."
  npm ci --force --no-audit --no-fund || {
    echo "[preview] npm ci failed — see the log above. The preview will not start."
    exit 0
  }
fi

echo "[preview] starting vite (app :5173) + api (:8787) → /tmp/fbt-dev.log"
nohup npm run dev > /tmp/fbt-dev.log 2>&1 &

# Wait briefly for the port so the Codespaces port forward exists before the
# editor finishes attaching (onAutoForward: openPreview opens it automatically).
for _ in $(seq 1 40); do
  if curl -sf -m 2 -o /dev/null http://127.0.0.1:5173/; then
    echo "[preview] ready → open the 5173 port (it opens by itself in the editor)"
    exit 0
  fi
  sleep 1
done

echo "[preview] not up after 40s — last lines of /tmp/fbt-dev.log:"
tail -20 /tmp/fbt-dev.log 2>/dev/null || true
