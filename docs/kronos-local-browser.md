# Kronos, running on the reader's own device

**Status: implemented and verified against the reference model. One operational
step (publishing the ~33 MB of ONNX files on a static host) is still owner-side;
see [Publishing the model](#publishing-the-model).**

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
| Inference (220-bar window, 12 bars, 2-core sandbox CPU, WASM) | **321 ms wall**, 80 ms in the autoregressive loop |
| Numeric agreement with `KronosPredictor.predict` | worst relative deviation **2.6 × 10⁻⁷** |
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

Verified in this environment (no GPU, no browser, no Hugging Face access):

- `scripts/kronos-export-onnx.py` exports four graphs from the real weights and
  **self-checks every graph against the vendored reference code**:
  `tokenizerEncodeMismatches: 0`, `tokenizerDecodeMaxAbsDiff: 1.4e-6`,
  `transformerLogitsMaxAbsDiff: 4.8e-6`, `incrementalStepMaxAbsDiff: 2.9e-6`,
  `s2HeadMaxAbsDiff: 7.6e-6`.
- `test/kronos-local-model.test.mjs` loads those graphs into
  **`onnxruntime-web` — the same runtime and the same WASM engine the browser
  worker uses** — runs a full forecast through `src/lib/kronosLocal/infer.js`,
  and compares it bar-for-bar with `KronosPredictor.predict(..., top_k=1)`
  stored in `test/fixtures/kronos-reference.json`. Worst relative deviation
  2.6e-7, 321 ms.

**Not verified here:** a real browser tab, a real iPhone, a real Android phone.
This sandbox has no Chromium (binary downloads are blocked and there is no
package manager) and cannot push GitHub Actions workflow files (the app lacks
the `workflows` permission), so no browser automation could run. Do not read
this document as a claim that a phone was tested — it is the list of what to
check, and `scripts/check-kronos-model-host.mjs` plus a manual run on a real
device is how to close it.

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

The repository does **not** carry the weights (33 MB is build output, and
`public/kronos-local/` is gitignored). Choose a host and point the build at it:

```bash
# 1. produce the artifacts (needs Hugging Face access once)
python3 scripts/kronos-export-onnx.py --out public/kronos-local
#    or from weights already on disk:
#    KRONOS_WEIGHTS_DIR=./weights python3 scripts/kronos-export-onnx.py

# 2. prove the host can serve them (reachability + CORS + SHA-256 + sizes)
node scripts/check-kronos-model-host.mjs https://your-host.example/kronos/

# 3. tell the build where they live (empty = same origin, /kronos-local/)
VITE_KRONOS_MODEL_BASE_URL=https://your-host.example/kronos/
```

Hosting options, honestly compared:

| Host | Free tier | CORS | Verdict |
|---|---|---|---|
| Same origin (`public/kronos-local/` in the deploy) | included in the existing Vercel/static budget | n/a (same origin) | simplest; costs 33 MB of the deployment's static payload and its bandwidth |
| GitHub Release assets | free, 2 GB per file | must be verified (`check-kronos-model-host.mjs` does) | good if CORS is open; assets are immutable, which suits a versioned model |
| Cloudflare R2 / Backblaze B2 | free egress tiers exist but are **capped**; not unlimited | yes, configurable | best for traffic spikes; still a quota to watch |
| jsDelivr / unpkg (npm) | free, but requires publishing an npm package | yes | workable if the artifacts are published as a package |
| Hugging Face Hub (original safetensors) | free | yes | the *weights* live there, but they are not ONNX; the browser would have to convert, which it cannot |

Nothing here is "free and unlimited": 33 MB per new device, ×N devices, is real
egress. The download is opt-in per device precisely so that the bill (and the
user's data plan) is paid only by readers who ask for a forecast.

## 7. Tests

```bash
npm run test:forecast        # server contract + UI + python worker + local suite
npm run test:kronos-local    # local math/storage + the REAL model vs the reference
npm run test:pro-chart       # chart terminal, including the forecast card
node scripts/kronos-export-onnx.py --self-check   # graph vs reference, needs torch
```

- `test/kronos-local-math.test.mjs` — sampling (top-p/top-k semantics copied
  from the reference, including its shift), bit packing, normalisation, OHLC
  validation and repair, time-stamp conventions.
- `test/kronos-local-storage.test.mjs` — download progress, corrupt bytes,
  truncation, cancel, delete, manifest validation.
- `test/pro-chart-forecast.test.jsx` — every UI state, cancellation, coin/range
  changes, and the assertion that the server API is never called.
- `test/kronos-local-model.test.mjs` — the real model, skipped when the graphs
  are not on disk (they are not in git).

## 8. What the old server path is now

`forecast/worker.py`, `server/kronosForecast.js`, `POST /api/forecast` and the
two `KRONOS_*` variables are **unchanged and still supported** for anything that
wants a server-side projection. They are no longer a dependency of the chart
button, and the browser bundle contains no model URL and no token. Deleting them
later is a one-file change; keeping them costs nothing at runtime because the
chart never calls them.
