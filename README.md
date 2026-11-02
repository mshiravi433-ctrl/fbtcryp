# Kronos model files — static host for the on-device forecast

This branch holds **no application code**. It is a static file host for the
~33 MB of ONNX weights that `fbtswap.ir` downloads **only** when a reader presses
«پیش‌بینی AI» on the token chart. The model then runs inside that reader's own
browser (WebGPU, or WASM as the fallback). Nothing about the candles leaves the
device.

Served by GitHub Pages at:

```
https://mshiravi433-ctrl.github.io/fbtcryp/
```

which is the value of `VITE_KRONOS_MODEL_BASE_URL` on the Vercel production build.

## What is here

| File | Bytes | SHA-256 |
|---|---:|---|
| `tokenizer-encode.onnx` | 7,944,623 | `d175079e19671d07c523ce026a77396bb1b1564c3b7e66061d0458f2132e0fd4` |
| `tokenizer-decode.onnx` | 7,943,763 | `be60b11f8464736b4185bff8bd0675ba4f0257b6b8cc84b2c39b37b65b793154` |
| `kronos-decode.onnx` | 14,375,406 | `6117bc816c037fb9fce253b946d4cad5e5291b7fc6de1931ae372b71df934c7c` |
| `kronos-s2head.onnx` | 3,159,850 | `da26b3d51a6b931ae0093a1aa9fd012cad5f970eac30ab61e96c000670ddd803` |
| `model-manifest.json` | 1,387 | — |

Total: **33,423,642 bytes** (33.42 MB), fp32, ONNX opset 17.

`model-manifest.json` is the authority: the browser reads it first, then refuses
to run anything whose size or SHA-256 disagrees with it. Do not edit the shapes,
sizes or digests in it by hand.

## Where the bytes come from

Produced by `scripts/kronos-export-onnx.py` in the application repository
(`main` branch) from the official MIT-licensed checkpoints:

- **Model:** [`NeoQuasar/Kronos-mini`](https://huggingface.co/NeoQuasar/Kronos-mini) — 4,108,192 params
- **Tokenizer:** [`NeoQuasar/Kronos-Tokenizer-2k`](https://huggingface.co/NeoQuasar/Kronos-Tokenizer-2k) — 3,958,259 params
- **Upstream project:** [shiyu-coder/Kronos](https://github.com/shiyu-coder/Kronos)

The exporter runs a numeric self-check against the unmodified reference
implementation (`KronosPredictor`) before writing the manifest; the graphs match
it to within 1e-5 absolute. The browser engine that executes them was then
compared bar-for-bar against the same reference over a 220-candle window and a
12-bar horizon: **1.54e-07** worst relative deviation.

## License

The Kronos model and tokenizer are **MIT** licensed. All credit to the Kronos
authors (Shiyu et al.) and to NeoQuasar for publishing the weights. The ONNX
graphs in this branch are a format conversion of those weights, not a new model,
and carry the same MIT terms. See `LICENSE`.

## Why a separate branch

33 MB must not enter the application's history — every clone of `main` would pay
for it, and the app does not bundle it. This orphan branch has no parent commit
and is not built by Vercel (`main` is the only deployed branch).
