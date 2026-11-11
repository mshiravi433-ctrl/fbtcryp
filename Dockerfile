# ============================================================================
# FBT SWAP — full app image (frontend + API in one process).
#
# WHY THIS EXISTS (2026-11-10)
# ----------------------------------------------------------------------------
# The Vercel Hobby team was soft-blocked for `fluidCpuDuration` and stays
# paused until the rolling 30-day window drops below the 4-hour allowance (or
# until support lifts it). A pause cannot be fixed with a commit: the build
# that would carry the fix is itself paused.
#
# So the site needs a place it can run that is (a) free and (b) does not meter
# CPU time. A container is exactly that: one always-on Node process serving
# `dist/` and the same `server/app.js` the serverless function uses, billed by
# the host's wall clock rather than by our CPU seconds. `server/index.js`
# already serves the built frontend and binds 0.0.0.0, so nothing here is a
# forked implementation — it is the same code, on a different meter.
#
# BUILD NEEDS ~4 GB RAM: `npm run build` runs vite with `--max-old-space-size`
# and the prebuild vendor scripts (velocity, kamino, kronos model). Free tiers
# with a 512 MB builder will OOM in stage 1; build the image anywhere with
# memory (GitHub Actions, Hugging Face Spaces, your laptop) and push it, or
# pick a host whose builder is large enough.
#
#   docker build -t fbt-swap .
#   docker run --rm -p 8787:8787 --env-file .env fbt-swap
#
# ─── THE IMAGE MUST MATCH PRODUCTION, OR IT IS A DIFFERENT PRODUCT ──────────
# Vite inlines `VITE_*` at BUILD time. A mirror image built without them would
# look right and behave wrong: no WalletConnect, no web-push, no fee display,
# the Farm adapters returning null. Section «build-time public configuration»
# below is what closes that gap — and it sources the SAME two env files
# `npm run build:full` sources on Vercel, so the two artifacts cannot drift.
# ============================================================================

# ───────────────────────────── stage 1: build ──────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Toolchain the vendor scripts may want (canvas/sharp-free by design, but the
# lockfile guard below flips one macOS-only optional dependency).
COPY package.json package-lock.json ./
# `--force` because the lockfile pins macOS-only fsevents as required, which
# makes a Linux `npm ci` die with EBADPLATFORM (same reason Dockerfile.
# mission-worker uses it). Dev dependencies are needed: vite is one.
RUN npm ci --force --no-audit --no-fund

COPY . .

# ─── build-time public configuration (VITE_*) ───────────────────────────────
# ONE optional file, not twenty `--build-arg`s: the CI workflow writes
# `build.env` from the repository variable `VITE_ENV_FILE` (Settings →
# Secrets and variables → Actions → Variables), and this step makes it the
# file Vite reads on `vite build` (mode=production reads `.env.production`).
#
# Absent file is NOT an error — a build without configuration still produces a
# working site (the API is same-origin here, so `VITE_API_BASE` is not needed
# at all); it only loses the wallet/push/fee integrations. So it warns loudly
# instead of failing, and it prints the key NAMES (never values) so the Actions
# log is proof of what was compiled in.
RUN set -e; \
    if [ -f build.env ]; then \
      mv build.env .env.production; \
      echo "[build] build.env → .env.production ($(grep -c '^[[:space:]]*VITE_' .env.production || true) VITE_ key(s)):"; \
      { grep '^[[:space:]]*VITE_' .env.production || true; } | cut -d= -f1 | sort | sed 's/^[[:space:]]*/  · /'; \
    else \
      echo "[build] no build.env — compiling with defaults."; \
      echo "[build]   the site will serve, but WalletConnect / web-push / fee display degrade."; \
      echo "[build]   set the repo variable VITE_ENV_FILE to fix it (see ci/docker-image.yml)."; \
    fi

# ─── parity with the production web build ───────────────────────────────────
# `npm run build:full` (vercel.json) sources ci/farm-rollout.env.sh and
# ci/web-season.env.sh before vite runs, and passes two flags inline. An image
# that skipped that step would ship a Farm that is read-only for everyone and
# a bundle whose VITE_ENABLE_* defines are all false — the exact class of bug
# documented at the top of farm-rollout.env.sh. So the same files are sourced
# here, from the same commit.
#
#   VERCEL_ENV=production   web-season.env.sh enables the reviewed futures
#                           history surface only for the production web build.
#                           This image IS the production web bundle (that is
#                           the point of a mirror); build with
#                           `--build-arg VERCEL_ENV=preview` to fail closed.
#   FARM_CAPITAL=off        the documented kill switch: the Farm builds
#                           capital-off without editing any file.
ARG VERCEL_ENV=production
ARG FARM_CAPITAL=on
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=3072 \
    VERCEL_ENV=${VERCEL_ENV} \
    FARM_CAPITAL=${FARM_CAPITAL}

# The build reads no secrets (VITE_* values are public by definition) but it
# does fetch vendored bundles and the Kronos model, so give it network.
RUN set -e; \
    set -a; . ./ci/farm-rollout.env.sh; . ./ci/web-season.env.sh; set +a; \
    echo "[build] VERCEL_ENV=${VERCEL_ENV} FARM_CAPITAL=${FARM_CAPITAL} FARM_ROLLOUT_PROTOCOLS=${FARM_ROLLOUT_PROTOCOLS:-unset}"; \
    VITE_ENABLE_SPECULATION=true VITE_ENABLE_SPOT_TRADE=true npm run build

# ─────────────────────────── stage 2: runtime ─────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --force --no-audit --no-fund \
 && npm cache clean --force

# `server/` imports a handful of shared modules from `src/lib` (market sectors,
# notification design) — the API cannot boot without them. `src/` is source,
# not the built bundle, and is required at runtime.
COPY server ./server
COPY src ./src
COPY api ./api
COPY scripts ./scripts
COPY --from=build /app/dist ./dist

# Mission Control's default store path is `<cwd>/data/mission-control/…`
# (server/missionControl/index.js). Create it owned by the runtime user so the
# first boot does not depend on mkdir permissions, and so a host with a mounted
# disk can override it with MISSION_CONTROL_DB=/data/missions.db.
RUN mkdir -p /app/data \
 && chown -R node:node /app

# Never run as root; the image holds the app's environment at runtime.
USER node

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
