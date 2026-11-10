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
# memory (Hugging Face Spaces, GitHub Actions, your laptop) and push it, or
# pick a host whose builder is large enough.
#
#   docker build -t fbt-swap .
#   docker run --rm -p 8787:8787 --env-file .env fbt-swap
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

# The build reads no secrets (VITE_* values are public by definition) but it
# does fetch vendored bundles and the Kronos model, so give it network.
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=3072
RUN npm run build

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

# Never run as root; the image holds the app's environment at runtime.
RUN chown -R node:node /app
USER node

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
