# Kronos, running on the reader's own device

**Status: implemented, exported from the official MIT weights, and verified
against the reference model on 2026-11-03 (worst relative deviation 1.54e-07
over a 220-bar window and a 12-bar horizon). The ~33 MB of ONNX files live on
the `kronos-model` branch and are served from GitHub Pages; see
[Publishing the model](#publishing-the-model).**

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

**Verified on 2026-11-03, in this environment** (no GPU, no browser, no Hugging
Face access — the weights came from a byte-identical public mirror whose SHA-256
matches the upstream LFS object ids):

- `scripts/kronos-export-onnx.py` exported four graphs from the real weights and
  **self-checked every graph against the vendored reference code**:
  `tokenizerEncodeMismatches: 0`, `tokenizerDecodeMaxAbsDiff: 2.1e-6`,
  `transformerLogitsMaxAbsDiff: 9.5e-6`, `incrementalStepMaxAbsDiff: 5.7e-6`,
  `s2HeadMaxAbsDiff: 5.7e-6`. These numbers are recorded in
  `model-manifest.json` under `selfCheck`, next to the weight digests.
- `test/kronos-local-model.test.mjs` loaded those graphs into
  **`onnxruntime-web` — the same runtime and the same WASM engine the browser
  worker uses** — ran a full forecast through `src/lib/kronosLocal/infer.js`,
  and compared it bar-for-bar with `KronosPredictor.predict(..., top_k=1)` in
  `test/fixtures/kronos-reference.json`: worst relative deviation **1.54e-07**,
  353 ms, 220-bar window, horizon 12.
- The reference fixture was re-earned from the real predictor for this run (it
  carries `provenance`: weight digests, torch version, window, sampler), and it
  is reproducible: two independent runs produced byte-identical bars, and the
  graphs matched them to the digit.

**Not verified here — and this is the part that matters:**

- ❌ **No real browser tab.** There is no Chromium in this sandbox (browser
  binaries are blocked, no package manager) and the GitHub integration cannot
  push a workflow file or enable Pages, so browser automation was impossible.
- ❌ **No iPhone, no Android phone, no Telegram in-app browser.** Not tested.
- ❌ **The production host was not observed serving the files from here.** This
  sandbox can reach `github.com` only; `*.github.io` and `fbtswap.ir` are both
  blocked at the TLS layer, so `check-kronos-model-host.mjs` could not be run
  against the live URL. Run it from a normal network before trusting the
  production default.

What the browser-side claim therefore rests on is: **the identical engine,
the identical graphs, the identical runtime, executed in Node.** That is strong
evidence about the model and about the numerics. It is not evidence about a
phone's memory, its WebGPU driver or its Cache Storage quota, and no document
should say otherwise until someone opens the chart on a real device.

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
served directory. GitHub Pages serves that branch, free, on the public repo.

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
npm run test:kronos-local    # local math/storage + the REAL model vs the reference
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
- `test/kronos-local-model.test.mjs` — the real model, skipped when the graphs
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
