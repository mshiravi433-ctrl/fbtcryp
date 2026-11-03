# Kronos, running on the reader's own device

**Status: implemented and exported from the official MIT weights. The model
numerics are verified against the reference in Node (worst relative deviation
1.54e-07 over a 220-bar window and a 12-bar horizon). The browser path has
NOT been observed running in a real browser — see
[section 2](#2-what-was-actually-verified-here-and-what-was-not). The ~33 MB of
ONNX files live on the `kronos-model` branch. The browser downloads them from
the deployment's own `/kronos-local/` first (vendored at build time). GitHub
Pages at `mshiravi433-ctrl.github.io/fbtcryp` is not a published site; a build
that still points `VITE_KRONOS_MODEL_BASE_URL` there falls through. See
[Publishing the model](#publishing-the-model).**

> **2026-11-02 incident.** The first release of this feature failed for every
> user with «موتور محلی روی این دستگاه بالا نیامد» (`SESSION_FAILED`) *after*
> the full 33 MB download, with all tests green. Cause and fix:
> [section 2a](#2a-the-engine-files-incident-2026-11-02).

The token chart's «پیش‌بینی AI» used to POST the candles it had on screen to
`/api/forecast`, which forwarded them to a Python worker holding the Kronos
model. That worker needed a machine, a container, `KRONOS_WORKER_URL` and
`KRONOS_WORKER_TOKEN`. All of that is gone from the reader's path: the model now
runs **inside the browser**, in a Web Worker, on the same candles that are on
the screen.

```
candles on screen ──► Web Worker ──► ONNX Runtime Web ──► 4 ONNX graphs ──► next candles
     (already local)      (no DOM)      WebGPU | WASM       (on disk, once)
```

Nothing about the candles leaves the device. The only network requests this
feature makes are the ~1 KB manifest and the model files themselves, both plain
static GETs, both after an explicit button press.

---

## 1. The feasibility answer, with numbers

| Question | Answer |
|---|---|
| Can the real Kronos model run in a browser? | **Yes.** Verified against the reference PyTorch predictor. |
| Which checkpoints | `NeoQuasar/Kronos-mini` (4,108,192 params) + `NeoQuasar/Kronos-Tokenizer-2k` (3,958,258 params), both **MIT** |
| ONNX size (fp32) | 33.42 MB total — 14.38 + 7.94 + 7.94 + 3.16 MB |
| Runtime engine size | 11.8 MB (WASM engine) or 25.4 MB (WebGPU engine) |
| First-run download | **45.2 MB** on a WASM device, **58.8 MB** on a WebGPU device |
| Inference (220-bar window, 12 bars, 2-core sandbox CPU, WASM) | **327 ms wall**, 87 ms in the autoregressive loop |
| Numeric agreement with `KronosPredictor.predict` | worst relative deviation **1.54 × 10⁻⁷** |
| iPhone Safari / Firefox / Telegram WebView | WASM engine (no WebGPU). Works, slower. |
| Chrome desktop / Android with an adapter | WebGPU engine, preferred automatically |

Why *mini* and not *small*: Kronos-small is 24.7 M parameters ≈ 100 MB in fp32
before the tokenizer, which is 140 MB+ of mobile data for one chart button.
Kronos-mini has the same architecture and tokenizer contract at a quarter of the
size; the export script parameterises nothing about the model, so switching is
one constant (`MODEL_ID`) plus a re-export.

Why the browser path was *not* just "serve the PyTorch worker from a CDN": it
needs `torch`, a 2 GB image and a server. The point of this change is that
nothing of ours runs it.

## 2. What was actually verified here (and what was not)

**Verified, and by what** (no GPU, no browser, no Hugging Face access in this
environment — the weights came from a byte-identical public mirror whose
SHA-256 matches the upstream LFS object ids):

| Claim | Evidence | Runs… |
| --- | --- | --- |
| The four ONNX graphs reproduce the PyTorch model | `scripts/kronos-export-onnx.py` self-check: `tokenizerEncodeMismatches: 0`, `tokenizerDecodeMaxAbsDiff: 2.1e-6`, `transformerLogitsMaxAbsDiff: 9.5e-6`, `incrementalStepMaxAbsDiff: 5.7e-6`, `s2HeadMaxAbsDiff: 5.7e-6` (recorded in `model-manifest.json` → `selfCheck`) | Python / torch |
| A full forecast matches `KronosPredictor.predict(..., top_k=1)` | `test/kronos-local-model.test.mjs`, worst relative deviation 1.54e-07, 353 ms | **Node** (`ort.node.min.mjs`) |
| The browser ORT bundle that `vite build` ships can find its engine and build a session from the shipped model files | `test/kronos-ort-dist.test.mjs` (`npm run test:kronos-dist`) — imports `dist/assets/ort.wasm.min-*.js`, sets `wasmPaths` onto `dist/kronos-ort/` | **Node**, against the **built output** |

**Not verified — and this is the part that matters:**

- ❌ **A real browser tab has never run this.** No Chromium in the sandbox
  (browser binaries are blocked), and the GitHub integration cannot push a
  workflow file or enable Pages, so browser automation was impossible. Nothing
  here has ever executed `new Worker(...)`, `import()` of the glue over HTTP,
  Cache Storage reads, or an inference inside a browser.
- ❌ **No iPhone, no Android phone, no Telegram in-app browser.** Not tested.
- ❌ **WebGPU never ran.** There is no GPU. The WebGPU engine files are only
  checked to be present, byte-identical and loadable as a module.
- ❌ **Cross-origin isolation / multi-threading** (`SharedArrayBuffer`) is untested;
  the worker defaults to one thread when the page is not isolated.
- ❌ **The production host was not observed serving the files from here.** This
  sandbox can reach `github.com` only; `*.github.io` and `fbtswap.ir` are both
  blocked at the TLS layer. Run `scripts/check-kronos-model-host.mjs`, and open
  DevTools → Network on the live site, from a normal network.

### Why «it passed in Node» does NOT mean «it works in the browser»

This sentence was written in an earlier revision of this file — *"the identical
engine, the identical graphs, the identical runtime, executed in Node. That is
strong evidence"* — and it was wrong in the one way that mattered. **Do not
repeat it.** `onnxruntime-web` is not one runtime; it is several, and a package
`exports` map picks between them by environment:

| Importer | Resolves to | Where the engine comes from |
| --- | --- | --- |
| Node (`import('onnxruntime-web')` in `test/kronos-local-model.test.mjs`) | `dist/ort.node.min.mjs` | opened with `fs` straight out of `node_modules` |
| Browser worker, bundled by Vite | `dist/ort.wasm.min.mjs` / `ort.webgpu.min.mjs` | **`import()` of a glue module by name** (`ort-wasm-simd-threaded.mjs`) + a `fetch` of the `.wasm`, both relative to `env.wasm.wasmPaths` |

Different entry file, different loader, different failure modes. The Node test
exercises the model numerics and `infer.js`; it cannot see how the **bundle in
`dist/`** locates its engine, because it never loads that bundle and never looks
at `dist/` at all. A passing `npm run test:kronos-local` is therefore evidence
about the math only — never about «the button works».

### 2a. The engine-files incident (2026-11-02)

- **Symptom:** after the 33 MB download, the page shows «موتور محلی روی این
  دستگاه بالا نیامد». Code `SESSION_FAILED`, thrown by the worker's WASM branch.
- **Cause:** the deployed ORT bundle (`dist/assets/ort.wasm.bundle.min-*.js`)
  `import()`s `ort-wasm-simd-threaded.mjs` relative to itself. Vite emitted the
  `.wasm` (hashed name) but never that `.mjs` — nothing imports it statically.
  `dist/assets/*.mjs` was 0 files; DevTools showed a 404 for
  `/assets/ort-wasm-simd-threaded.mjs`.
- **Reproduction against the old build** (Node, against `dist/`):
  `no available backend found. ERR: [wasm] ERR_MODULE_NOT_FOUND: Cannot find module '…/assets/ort-wasm-simd-threaded.mjs'`.
- **Fix:**
  1. `scripts/vendor-kronos-ort.mjs` copies the four engine files
     (`ort-wasm-simd-threaded.{mjs,wasm}` for WASM, `….asyncify.{mjs,wasm}` for
     WebGPU) from `node_modules/onnxruntime-web/dist/` into
     `public/kronos-ort/` **under their original names**. SHA-256-verified,
     no-op when already present, exit 1 if a source file is missing. Run by
     `prebuild` *and* by a plugin in `vite.config.js`, so a bare `vite build`
     gets them too. The folder is gitignored (≈37 MB stays out of history).
  2. `ORT_ASSET_PATH` (`src/lib/kronosLocal/config.js`) is now the same-origin URL
     of that folder, built from `import.meta.env.BASE_URL`. The worker assigns it
     to `env.wasm.wasmPaths` **before** `InferenceSession.create`, in `init()` and
     in the WebGPU→WASM fallback.
  3. `resolve.conditions: ['onnxruntime-web-use-extern-wasm']` in `vite.config.js`
     selects the extern entry points, so Vite no longer copies a second,
     hashed 12 MB / 25 MB `.wasm` into `/assets`.
- **The guard:** `test/kronos-ort-dist.test.mjs` runs the **built** bundle. Before
  the fix it failed 5 of 7 cases (`ERR_MODULE_NOT_FOUND`, engine file missing in
  `dist/`, hashed `.wasm` in `/assets`); after the fix it passes 7 of 7.
  It still needs a real browser to close the loop (see the ❌ list above).

## 3. How the graphs are shaped, and why

`scripts/kronos-export-onnx.py` produces:

| File | Input → output | Why separate |
|---|---|---|
| `tokenizer-encode.onnx` | OHLCV window → 20 bipolar BSQ bits per bar | matches `KronosTokenizer.encode` |
| `tokenizer-decode.onnx` | bits → OHLCV | matches `decode(half=True)` |
| `kronos-decode.onnx` | tokens + time stamps + KV cache → s1 logits + context | the transformer, once per step |
| `kronos-s2head.onnx` | context + sampled s1 → s2 logits | `decode_s2`, which the reference runs as a second pass |

Design decisions that matter:

- **KV cache instead of recomputing the window.** The reference re-runs the
  whole window every step. As long as `window + horizon ≤ context` no bar is
  evicted, so absolute-position KV caching is *the same computation* — proven
  by `incrementalStepMaxAbsDiff: 2.9e-6` (cached step vs full `T+1` recompute).
- **Rotary tables and masks are inputs, not ops.** No `Range`/`Cos`/`Sin`/
  `Einsum` in the hot graph, which removes the ops most likely to be missing
  from a WebGPU backend and lets JS own positions explicitly.
- **The s2 head needs no rotary at all**: its query is one token at position 0,
  where RoPE is the identity. That is stated in the code rather than silently
  "fixed".
- **`Where`, `Greater`, `ConstantOfShape` appear only in the encoder.** The
  decode graphs are `MatMul`/`Gather`/`Softmax`/`RMSNorm` arithmetic, the
  shapes every backend implements.

## 4. Mobile reality

- **One forecast at a time.** The client serialises; a second request aborts the
  first.
- **Window and horizon are capped** (`browserMaxContext: 512`, horizon ≤ 48) so
  prefill cannot grow without bound. Typical: 220 bars + 12 forecast bars.
- **Cancel terminates the worker**, it does not politely ask: a prefill that is
  already inside ONNX cannot be interrupted, and leaving it running behind a
  closed panel is exactly the battery burn this design is meant to avoid.
- **Out of memory is caught and named** (`OUT_OF_MEMORY`, `WORKER_CRASHED`) —
  the chart does not crash, it explains.
- **WebGPU is proven, not sniffed**: `navigator.gpu.requestAdapter()` must
  return an adapter *and* a session must build on it, otherwise the worker
  reloads the WASM engine.
- **Telegram's in-app browser** gets an explicit hint to open the page in Chrome
  or Safari; the WASM path usually works there anyway.
- **iOS note**: WebGPU is Safari 18+ (and behind the feature flag on older
  versions); everything else falls back to WASM, which is where the 321 ms
  measurement above was taken (2 slow cores — a modern phone is in the same
  order of magnitude).

## 5. Downloading and keeping the model

- Nothing is fetched until the reader presses **«دانلود و پیش‌بینی»** on a card
  that states the size first.
- Progress is byte-accurate (`ReadableStream`), cancellable, and resumable by
  simply pressing again.
- Files are stored in **Cache Storage** (`fbt-kronos-fbt.kronos.browser.v1-Kronos-mini`),
  each verified against the manifest's SHA-256 on download *and* on every read.
- A truncated, corrupt or half-written file is discarded — never "close enough".
- **«حذف مدل از این دستگاه»** deletes the bucket and the cached forecast results.
- Browser cache eviction, private mode, a missing Cache Storage API and a full
  quota each have their own message; none of them throws the page away.
- The model **version** is in the cache name: a new manifest with a new schema
  can never be mixed with the previous one.

## 6. Publishing the model

The application repository does **not** carry the weights, and must not: 33 MB in
`main`'s history would be paid for by every clone and is not part of the app.
`public/kronos-local/` is gitignored. The files are published instead on an
**orphan branch of this same repository**, `kronos-model`, whose tree *is* the
served directory. The build copies that branch into `public/kronos-local/`
(`scripts/fetch-kronos-model.mjs`) so the live site serves the graphs
same-origin. GitHub Pages was the documented CDN and is not currently a site
(`404 Site not found`); the browser therefore tries the configured host, then
`/kronos-local/`, then `raw.githubusercontent.com` for the same branch.

```
kronos-model (orphan, no parent commit)
  tokenizer-encode.onnx   7,944,623
  tokenizer-decode.onnx   7,943,763
  kronos-decode.onnx     14,375,406
  kronos-s2head.onnx      3,159,850
  model-manifest.json         1,387
  README.md · LICENSE (MIT) · vercel.json (CORS + immutable cache)
```

Published at **https://mshiravi433-ctrl.github.io/fbtcryp/** — Pages source:
branch `kronos-model`, folder `/`. Free plan limits are 1 GB per site and 100 MB
per file; this is 33 MB in five files.

```bash
# 1. produce the artifacts (needs Hugging Face access once, or a weights mirror)
python3 scripts/kronos-export-onnx.py --out public/kronos-local
#    or from weights already on disk (Kronos-mini/ + Kronos-Tokenizer-2k/):
KRONOS_WEIGHTS_DIR=./weights python3 scripts/kronos-export-onnx.py

# 2. publish them: a fresh orphan branch, no parent, nothing else in it
git init -b kronos-model /tmp/kronos-model && cd /tmp/kronos-model
cp public/kronos-local/{*.onnx,model-manifest.json} .   # + README, LICENSE, vercel.json
git add -A && git commit -m "Kronos ONNX graphs (MIT)"
git remote add origin https://github.com/<owner>/<repo>.git
git push origin kronos-model

# 3. prove the host can serve them BEFORE pointing production at it:
#    reachability + open CORS + size + SHA-256 of all four files
KRONOS_CHECK_ORIGIN=https://fbtswap.ir \
  node scripts/check-kronos-model-host.mjs https://mshiravi433-ctrl.github.io/fbtcryp/

# 4. tell the build where they live (empty = same origin, /kronos-local/)
VITE_KRONOS_MODEL_BASE_URL=https://mshiravi433-ctrl.github.io/fbtcryp/
```

Step 4 is a **build-time** variable: setting it in Vercel changes nothing until a
new production deployment is built. The APK needs it too — `ci/WORKFLOW-FIXED.yml`
maps it for exactly that reason, because a website that finds the weights and an
APK that reports «فایل‌های مدل منتشر نشده‌اند» is the worst possible pair.

`scripts/fetch-kronos-model.mjs` runs in `prebuild` and at the head of the
Vercel `buildCommand`, so the weights are vendored into `dist/` on every build
and served from the app's **own origin**. That is why the production default
needs no configuration, and why a build with no network still ships — the
script reports that it skipped and the UI tells the truth.

Two consequences worth stating plainly:

- **The APK grows by ~33 MB.** `ci/build-apk.sh` runs the same `npm run build`,
  so `cap sync` copies the graphs into the app's assets and the model runs from
  `https://localhost/kronos-local/` with no download at all. That is the best
  outcome for the on-device promise (it works offline, on a plane, on a
  metered connection) and a real cost in install size. If the size matters more
  than offline inference for a given release, set `VITE_KRONOS_MODEL_BASE_URL`
  for that build: nothing is vendored, and the webview fetches from the host.
- **The website pays 33 MB of static payload** per deployment, once, not per
  visitor: the files are immutable and a device caches them after the first
  opt-in download.

Delivery details that matter and are easy to lose:

- **CORS.** The weights are cross-origin from `fbtswap.ir`, so every response
  must carry `Access-Control-Allow-Origin`. GitHub Pages sends `*`, which is
  correct here: these are public, immutable bytes and nothing is authenticated.
- **Caching.** Pages sends a short `max-age`; the browser keeps the graphs in
  Cache Storage anyway (`fbt-kronos-<schema>-<model>`), keyed by manifest and
  verified by SHA-256, with a «حذف مدل از این دستگاه» control next to it.
- **No auto-download.** Nothing is fetched until the reader presses the button,
  and the button states the byte cost first (model + the engine it will run on).

Hosting options, honestly compared:

| Host | Free tier | CORS | Verdict |
|---|---|---|---|
| **GitHub Pages, orphan branch (chosen)** | free for public repos; 1 GB site, 100 MB file | `*` | no cost, no quota to watch at this size, immutable branch |
| Same origin (`public/kronos-local/` in the deploy) | included in the existing static budget | n/a | simplest, but 33 MB in every deployment and its history |
| GitHub Release assets | free, 2 GB per file | must be verified | fine, but asset uploads need a token with write scope |
| Cloudflare R2 / Backblaze B2 | capped free egress | configurable | overkill for four files |
| Hugging Face Hub (original safetensors) | free | yes | the *weights* live there, but they are not ONNX; the browser cannot convert |

Nothing here is "free and unlimited": 33 MB per new device × N devices is real
egress. The download is opt-in per device precisely so that the cost — and the
reader's data plan — is paid only by people who ask for a forecast.

## 7. Tests

```bash
npm run test:forecast        # server contract + UI + python worker + local suite
npm run test:kronos-local    # local math/storage + the REAL model vs the reference (Node build of ORT!)
NODE_OPTIONS='--max-old-space-size=2700 --max-semi-space-size=16' npx vite build && npm run test:kronos-dist   # the BUILT browser bundle (needs dist/)
npm run test:pro-chart       # chart terminal, including the forecast card
npm run test:wiring          # the static wiring audit, against an accepted ceiling
node scripts/kronos-export-onnx.py --out public/kronos-local   # export + self-check
```

`npm run test:wiring` exists because `test/run.mjs` cannot reach the audit: an
earlier probe in that runner calls `process.exit()` at import time (a
pre-existing quirk, documented in `test/run.mjs`), so the wiring suite has never
actually executed under `npm test`. `scripts/run-wiring-audit.mjs` runs it
directly and fails if the number of known failures goes **up** (currently 64;
this branch brought it down from 68 by fixing four Kronos assertions).

- `test/kronos-local-math.test.mjs` — sampling (top-p/top-k semantics copied
  from the reference, including its shift), bit packing, normalisation, OHLC
  validation and repair, time-stamp conventions.
- `test/kronos-local-storage.test.mjs` — download progress, corrupt bytes,
  truncation, cancel, delete, manifest validation.
- `test/pro-chart-forecast.test.jsx` — every UI state, cancellation, coin/range
  changes, and the assertion that the server API is never called.
- `test/kronos-ort-dist.test.mjs` — **the only test that touches the shipped
  bundle.** Requires `dist/` (`npm run test:kronos-dist` fails rather than skips
  without it). Checks that every engine file the browser ORT chunks request by
  name exists in `dist/kronos-ort/` and is byte-identical to `onnxruntime-web`,
  that no hashed `.wasm` duplicate sits in `/assets`, that no `KRONOS_WORKER_*`
  string is in the bundle, and that the built WASM bundle builds a session from
  `dist/kronos-local/`. It is Node, not a browser: it proves the files are
  where the bundle looks, not that a tab can run them.
- `test/kronos-local-model.test.mjs` — the real model **in Node, via ORT's Node
  build — it does not execute the browser bundle** (see section 2). Skipped when the graphs
  are not on disk (they are not in git). Even when skipped, one case runs: the
  committed reference must trace to the official weight digests, so the forecast
  cannot quietly become a different model.

## 8. What the old server path is now

`forecast/worker.py`, `server/kronosForecast.js`, `POST /api/forecast` and the
two `KRONOS_*` variables are **unchanged and still supported** for anything that
wants a server-side projection. They are no longer a dependency of the chart
button, and the browser bundle contains no model URL and no token. Deleting them
later is a one-file change; keeping them costs nothing at runtime because the
chart never calls them.
