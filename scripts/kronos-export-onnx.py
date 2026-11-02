#!/usr/bin/env python3
"""
KRONOS → ONNX EXPORTER (browser target)
=======================================
Turns the official Kronos K-line foundation model weights into the four ONNX
graphs the on-device browser runtime executes:

  tokenizer-encode.onnx   OHLCV window  → 20 bipolar BSQ bits per bar
  tokenizer-decode.onnx   20 bits       → OHLCV bars (de-quantised)
  kronos-decode.onnx      tokens + time stamps → s1 logits + context, with KV cache
  kronos-s2head.onnx      context + sampled s1 → s2 logits

Why four graphs and not one
---------------------------
The reference predictor (forecast/kronos_model/kronos.py, `auto_regressive_inference`)
does exactly this: tokenise the window, then for every step call `decode_s1`
(transformer + s1 head) and `decode_s2` (dependency-aware cross attention + s2
head), then de-tokenise. Splitting it the same way keeps the browser loop a
*transcription* of the reference, not a re-interpretation.

Numeric contract (verified by `--self-check`)
---------------------------------------------
  * KV-cache decode == full-window recompute. The reference re-runs the whole
    window every step with RoPE positions restarted at 0. As long as
    window + horizon ≤ context (the browser caps both), no bar is ever evicted,
    so absolute-position KV caching is mathematically the same computation.
  * Rotary tables are passed in as tensors computed by the caller, which keeps
    the graphs free of Range/Cos/Sin/Einsum (better WebGPU op coverage) and lets
    the JS side own positions explicitly.
  * Masks are passed in too: causal for the tokenizer blocks, causal-over-new-
    tokens for the transformer step, none for the s2 head (its cross attention
    is non-causal in eval mode — reproduced faithfully).
  * The s2 head's query length is always 1 at position 0, where RoPE is the
    identity (cos=1, sin=0), so it needs no rotary maths at all.

Usage
-----
  # one-time, anywhere with Hugging Face access (CI does this):
  python3 scripts/kronos-export-onnx.py --out public/kronos-local

  # or, from weights already on disk:
  python3 scripts/kronos-export-onnx.py --weights-dir ./kronos-weights \
      --out public/kronos-local

`--weights-dir` expects the two Hub snapshot folders (model + tokenizer) laid
out as `<dir>/Kronos-mini/{config.json,model.safetensors}` and
`<dir>/Kronos-Tokenizer-2k/{config.json,model.safetensors}`. Without it the
script downloads those exact repos from the Hub. Either way it writes
`model-manifest.json` (sizes + SHA-256 of every file) next to the graphs; the
browser refuses to run anything that does not match it.

Requirements: torch (CPU is fine), safetensors, onnx. The vendored model code
in forecast/kronos_model is the single source of truth for the architecture.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import time
from typing import Optional

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
import torch.nn.functional as F  # noqa: E402

from forecast.kronos_model import Kronos, KronosTokenizer  # noqa: E402

MODEL_ID = "NeoQuasar/Kronos-mini"
TOKENIZER_ID = "NeoQuasar/Kronos-Tokenizer-2k"
SCHEMA = "fbt.kronos.browser.v1"
OPSET = 17
# The window the browser may use. The checkpoint supports 2048; a phone does
# not need to, and every bar costs quadratic attention in the prefill.
BROWSER_MAX_CONTEXT = 512


# ── weight loading ──────────────────────────────────────────────────────────

def load_weights(weights_dir: Optional[str]):
    """Return (model_cfg, tok_cfg, model_sd, tok_sd, provenance)."""
    from safetensors.torch import load_file

    if weights_dir:
        mdir = os.path.join(weights_dir, "Kronos-mini")
        tdir = os.path.join(weights_dir, "Kronos-Tokenizer-2k")
        if not (os.path.exists(os.path.join(mdir, "model.safetensors"))
                and os.path.exists(os.path.join(tdir, "model.safetensors"))):
            raise SystemExit(f"weights not found under {weights_dir}; expected "
                             "Kronos-mini/ and Kronos-Tokenizer-2k/")
        mcfg = json.load(open(os.path.join(mdir, "config.json")))
        tcfg = json.load(open(os.path.join(tdir, "config.json")))
        msd = load_file(os.path.join(mdir, "model.safetensors"))
        tsd = load_file(os.path.join(tdir, "model.safetensors"))
        provenance = {"source": "local", "path": os.path.abspath(weights_dir)}
    else:
        from huggingface_hub import hf_hub_download

        def snap(repo: str):
            cfg = json.load(open(hf_hub_download(repo, "config.json")))
            sd = load_file(hf_hub_download(repo, "model.safetensors"))
            return cfg, sd

        mcfg, msd = snap(MODEL_ID)
        tcfg, tsd = snap(TOKENIZER_ID)
        provenance = {"source": "huggingface", "model": MODEL_ID, "tokenizer": TOKENIZER_ID}
    return mcfg, tcfg, msd, tsd, provenance


def build(mcfg, tcfg, msd, tsd):
    model = Kronos(**mcfg)
    tok = KronosTokenizer(**tcfg)
    model.load_state_dict(msd, strict=True)
    tok.load_state_dict(tsd, strict=True)
    model.eval()
    tok.eval()
    return model, tok


# ── rotary helpers (shared by the wrappers; JS owns the tables) ─────────────

def rope_tables(positions: torch.Tensor, head_dim: int):
    inv_freq = 1.0 / (10000 ** (torch.arange(0, head_dim, 2).float() / head_dim))
    freqs = torch.einsum("i,j->ij", positions.float(), inv_freq)
    emb = torch.cat((freqs, freqs), dim=-1)
    return emb.cos(), emb.sin()


def _rotate_half(x):
    x1, x2 = x.chunk(2, dim=-1)
    return torch.cat((-x2, x1), dim=-1)


def _rope(t, cos, sin):
    return t * cos[None, None] + _rotate_half(t) * sin[None, None]


def _attend(q, k, v, mask):
    scale = 1.0 / math.sqrt(q.shape[-1])
    scores = torch.matmul(q, k.transpose(-1, -2)) * scale
    if mask is not None:
        scores = scores + mask
    return torch.matmul(torch.softmax(scores, dim=-1), v)


def _rms_norm(norm, x):
    """RMSNorm written with plain ops so the graph stays WebGPU-friendly."""
    var = (x * x).mean(dim=-1, keepdim=True)
    return x * torch.rsqrt(var + norm.eps) * norm.weight


def _attn_block(layer, x, cos, sin, mask):
    h = _rms_norm(layer.norm1, x)
    attn = layer.self_attn
    b, t, _ = h.shape
    q = attn.q_proj(h).view(b, t, attn.n_heads, attn.head_dim).transpose(1, 2)
    k = attn.k_proj(h).view(b, t, attn.n_heads, attn.head_dim).transpose(1, 2)
    v = attn.v_proj(h).view(b, t, attn.n_heads, attn.head_dim).transpose(1, 2)
    q, k = _rope(q, cos, sin), _rope(k, cos, sin)
    out = _attend(q, k, v, mask).transpose(1, 2).reshape(b, t, attn.d_model)
    x = x + attn.out_proj(out)
    h2 = _rms_norm(layer.norm2, x)
    return x + layer.ffn(h2)


# ── graphs ─────────────────────────────────────────────────────────────────

class TokEncode(nn.Module):
    """OHLCV window → the 20 bipolar bits the BSQ quantizer would produce."""

    def __init__(self, tk: KronosTokenizer):
        super().__init__()
        self.tk = tk

    def forward(self, ohlcv, cos, sin, mask):
        tk = self.tk
        z = tk.embed(ohlcv)
        for layer in tk.encoder:
            z = _attn_block(layer, z, cos, sin, mask)
        z = tk.quant_embed(z)
        # BSQuantizer: L2-normalise, then sign -> ±1 (strictly > 0 is +1).
        norm = torch.sqrt((z * z).sum(dim=-1, keepdim=True)) + 1e-12  # F.normalize eps
        z = z / norm
        return torch.where(z > 0, torch.ones_like(z), -torch.ones_like(z))


class TokDecode(nn.Module):
    """Bipolar bits → OHLCV (tokenizer.decode(half=True)).

    `decode` is causal (is_causal=True in eval), so the mask is causal too; the
    caller passes it, exactly like the reference build.
    """

    def __init__(self, tk: KronosTokenizer):
        super().__init__()
        self.tk = tk

    def forward(self, bits, cos, sin, mask):
        tk = self.tk
        z = tk.post_quant_embed(bits / math.sqrt(bits.shape[-1]))
        for layer in tk.decoder:
            z = _attn_block(layer, z, cos, sin, mask)
        return tk.head(z)


class KronosDecode(nn.Module):
    """Kronos.decode_s1 with an explicit KV cache."""

    def __init__(self, m: Kronos):
        super().__init__()
        self.m = m

    def forward(self, s1, s2, stamp, cos, sin, mask, *past):
        m = self.m
        n = m.n_layers
        past_k, past_v = list(past[:n]), list(past[n:])
        x = m.embedding([s1, s2]) + m.time_emb(stamp)
        present_k, present_v = [], []
        for i, layer in enumerate(m.transformer):
            h = _rms_norm(layer.norm1, x)
            attn = layer.self_attn
            b, t, _ = h.shape
            q = attn.q_proj(h).view(b, t, attn.n_heads, attn.head_dim).transpose(1, 2)
            k = attn.k_proj(h).view(b, t, attn.n_heads, attn.head_dim).transpose(1, 2)
            v = attn.v_proj(h).view(b, t, attn.n_heads, attn.head_dim).transpose(1, 2)
            q, k = _rope(q, cos, sin), _rope(k, cos, sin)
            k_full = torch.cat([past_k[i], k], dim=2)
            v_full = torch.cat([past_v[i], v], dim=2)
            out = _attend(q, k_full, v_full, mask).transpose(1, 2).reshape(b, t, attn.d_model)
            x = x + attn.out_proj(out)
            x = x + layer.ffn(_rms_norm(layer.norm2, x))
            present_k.append(k_full)
            present_v.append(v_full)
        x = _rms_norm(m.norm, x)
        return (m.head(x), x, *present_k, *present_v)


class S2Head(nn.Module):
    """DependencyAwareLayer + conditional s2 head for ONE sampled s1 token."""

    def __init__(self, m: Kronos):
        super().__init__()
        self.m = m

    def forward(self, context, s1_id):
        m = self.m
        sibling = m.embedding.emb_s1(s1_id)  # NOT sqrt(d)-scaled: matches decode_s2
        ca = m.dep_layer.cross_attn
        b, t, _ = sibling.shape
        _, kt, _ = context.shape
        q = ca.q_proj(sibling).view(b, t, ca.n_heads, ca.head_dim).transpose(1, 2)
        k = ca.k_proj(context).view(b, kt, ca.n_heads, ca.head_dim).transpose(1, 2)
        v = ca.v_proj(context).view(b, kt, ca.n_heads, ca.head_dim).transpose(1, 2)
        # Query length is 1 and its position is 0, where RoPE is the identity
        # (cos=1, sin=0); the reference broadcasts that same table over the keys.
        out = _attend(q, k, v, None).transpose(1, 2).reshape(b, t, ca.d_model)
        x2 = _rms_norm(m.dep_layer.norm, context + ca.out_proj(out))
        return m.head.cond_forward(x2)


# ── export ─────────────────────────────────────────────────────────────────

def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export_all(model: Kronos, tok: KronosTokenizer, out_dir: str, provenance: dict) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    n, heads, head_dim = model.n_layers, model.n_heads, model.d_model // model.n_heads
    tok_heads, tok_head_dim = tok.n_heads, tok.d_model // tok.n_heads
    t_probe = 64

    torch.manual_seed(0)
    ohlcv = torch.randn(1, t_probe, 6)
    s1 = torch.randint(0, 2 ** model.s1_bits, (1, t_probe), dtype=torch.int32)
    s2 = torch.randint(0, 2 ** model.s2_bits, (1, t_probe), dtype=torch.int32)
    stamp = torch.randint(0, 5, (1, t_probe, 5), dtype=torch.int32)
    bits = (torch.randint(0, 2, (1, t_probe, 20), dtype=torch.int32).float() * 2 - 1)
    mask = torch.where(torch.tril(torch.ones(t_probe, t_probe, dtype=torch.bool)), 0.0, -1e9)[None, None]
    cos_m, sin_m = rope_tables(torch.arange(t_probe), head_dim)
    cos_t, sin_t = rope_tables(torch.arange(t_probe), tok_head_dim)
    past_k = [torch.zeros(1, heads, 0, head_dim) for _ in range(n)]
    past_v = [torch.zeros(1, heads, 0, head_dim) for _ in range(n)]

    files = []

    def emit(name, module, args, input_names, output_names, dynamic):
        path = os.path.join(out_dir, name)
        torch.onnx.export(module, args, path, input_names=input_names, output_names=output_names,
                          dynamic_axes=dynamic, opset_version=OPSET, do_constant_folding=True)
        files.append({"name": name, "bytes": os.path.getsize(path), "sha256": _sha256(path)})
        print(f"  {name:24s} {os.path.getsize(path)/1e6:7.2f} MB")

    print(f"exporting to {out_dir}")
    emit("tokenizer-encode.onnx", TokEncode(tok).eval(), (ohlcv, cos_t, sin_t, mask),
         ["ohlcv", "cos", "sin", "mask"], ["bits"],
         {"ohlcv": {1: "t"}, "cos": {0: "t"}, "sin": {0: "t"}, "mask": {2: "t", 3: "t"}, "bits": {1: "t"}})

    emit("tokenizer-decode.onnx", TokDecode(tok).eval(), (bits, cos_t, sin_t, mask),
         ["bits", "cos", "sin", "mask"], ["ohlcv"],
         {"bits": {1: "t"}, "cos": {0: "t"}, "sin": {0: "t"}, "mask": {2: "t", 3: "t"}, "ohlcv": {1: "t"}})

    dec = KronosDecode(model).eval()
    past_names = [f"past_k_{i}" for i in range(n)] + [f"past_v_{i}" for i in range(n)]
    dec_out = (["s1_logits", "context"]
               + [f"present_k_{i}" for i in range(n)] + [f"present_v_{i}" for i in range(n)])
    dyn = {"s1": {1: "t"}, "s2": {1: "t"}, "stamp": {1: "t"}, "cos": {0: "t"}, "sin": {0: "t"},
           "mask": {2: "t", 3: "k"}, "s1_logits": {1: "t"}, "context": {1: "t"}}
    for i in range(n):
        dyn[f"past_k_{i}"] = {2: "past"}
        dyn[f"past_v_{i}"] = {2: "past"}
        dyn[f"present_k_{i}"] = {2: "k"}
        dyn[f"present_v_{i}"] = {2: "k"}
    emit("kronos-decode.onnx", dec, (s1, s2, stamp, cos_m, sin_m, mask, *past_k, *past_v),
         ["s1", "s2", "stamp", "cos", "sin", "mask", *past_names], dec_out, dyn)

    ctx_probe = torch.randn(1, t_probe, model.d_model)
    s1_one = torch.tensor([[7]], dtype=torch.int32)
    emit("kronos-s2head.onnx", S2Head(model).eval(), (ctx_probe, s1_one),
         ["context", "s1_id"], ["s2_logits"],
         {"context": {1: "t"}, "s2_logits": {1: "t"}})

    total = sum(f["bytes"] for f in files)
    manifest = {
        "schema": SCHEMA,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": {
            "id": MODEL_ID,
            "params": int(sum(p.numel() for p in model.state_dict().values())),
            "nLayers": n,
            "dModel": model.d_model,
            "nHeads": heads,
            "headDim": head_dim,
            "s1Bits": model.s1_bits,
            "s2Bits": model.s2_bits,
            "contextLimit": int(model_context(model)),
            "license": "MIT",
        },
        "tokenizer": {
            "id": TOKENIZER_ID,
            "params": int(sum(p.numel() for p in tok.state_dict().values())),
            "s1Bits": tok.s1_bits,
            "s2Bits": tok.s2_bits,
            "dModel": tok.d_model,
            "nHeads": tok_heads,
            "headDim": tok_head_dim,
            "encode": "tokenizer-encode.onnx",
            "decode": "tokenizer-decode.onnx",
        },
        "browserMaxContext": BROWSER_MAX_CONTEXT,
        "precision": "fp32",
        "opset": OPSET,
        "provenance": provenance,
        "files": files,
        "totalBytes": total,
    }
    with open(os.path.join(out_dir, "model-manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    print(f"  total {total/1e6:.2f} MB (fp32) → manifest written")
    return manifest


def model_context(model: Kronos) -> int:
    # The checkpoint's own context limit is 2048 for Kronos-mini; the browser
    # cap below is what actually binds. Kept explicit so the manifest is not a
    # place where a limit quietly changes.
    return 2048


# ── self-check: the graphs must reproduce the vendored reference ────────────

def self_check(model: Kronos, tok: KronosTokenizer, out_dir: str) -> dict:
    torch.set_grad_enabled(False)
    import numpy as np
    import onnxruntime as ort

    sess = {f: ort.InferenceSession(os.path.join(out_dir, f), providers=["CPUExecutionProvider"])
            for f in ("tokenizer-encode.onnx", "tokenizer-decode.onnx",
                      "kronos-decode.onnx", "kronos-s2head.onnx")}
    t = 48
    rng = np.random.default_rng(0)
    base = 60_000 + np.cumsum(rng.normal(0, 60, t))
    o = base + rng.normal(0, 20, t)
    c = base + rng.normal(0, 20, t)
    h = np.maximum(o, c) + np.abs(rng.normal(0, 30, t))
    l = np.minimum(o, c) - np.abs(rng.normal(0, 30, t))
    v = np.abs(rng.normal(500, 100, t))
    ohlcv = np.stack([o, h, l, c, v, v * base], -1).astype(np.float32)[None]
    x = ohlcv.copy()
    n = model.n_layers
    head_dim = model.d_model // model.n_heads

    def tables(length, dim, offset=0):
        pos = torch.arange(offset, offset + length)
        cos, sin = rope_tables(pos, dim)
        return cos.numpy(), sin.numpy()

    def cmask(length):
        return torch.where(torch.tril(torch.ones(length, length, dtype=torch.bool)), 0.0, -1e9).numpy()[None, None]

    # 1) tokenizer encode parity with the vendored encode()
    cos_t, sin_t = tables(t, tok.d_model // tok.n_heads)
    bits = sess["tokenizer-encode.onnx"].run(None, {"ohlcv": x, "cos": cos_t, "sin": sin_t, "mask": cmask(t)})[0]
    ref_s1, ref_s2 = tok.encode(torch.from_numpy(x), half=True)
    s = tok.s1_bits
    weights = 2 ** np.arange(s)
    got_s1 = ((bits[0, :, :s] > 0).astype(np.int64) * weights).sum(-1)
    got_s2 = ((bits[0, :, s:] > 0).astype(np.int64) * weights).sum(-1)
    enc_mismatch = int((got_s1 != ref_s1[0].numpy()).sum() + (got_s2 != ref_s2[0].numpy()).sum())

    # 2) tokenizer decode parity
    dec_bits = np.concatenate([
        ((ref_s1[0].numpy()[:, None] // weights) % 2) * 2 - 1,
        ((ref_s2[0].numpy()[:, None] // weights) % 2) * 2 - 1], -1).astype(np.float32)[None]
    got_ohlcv = sess["tokenizer-decode.onnx"].run(
        None, {"bits": dec_bits, "cos": cos_t, "sin": sin_t, "mask": cmask(t)})[0]
    ref_ohlcv = tok.decode((torch.from_numpy(ref_s1.numpy()), torch.from_numpy(ref_s2.numpy())), half=True).numpy()
    dec_diff = float(np.abs(got_ohlcv - ref_ohlcv).max())

    # 3) transformer: KV-cached run vs reference decode_s1 (full window)
    stamp = np.stack([np.arange(t) % 60, np.arange(t) % 24, np.arange(t) % 7,
                      (np.arange(t) % 28) + 1, (np.arange(t) % 12) + 1], -1).astype(np.int32)[None]
    cos_m, sin_m = tables(t, head_dim)
    feeds = {"s1": ref_s1.numpy().astype(np.int32), "s2": ref_s2.numpy().astype(np.int32),
             "stamp": stamp, "cos": cos_m, "sin": sin_m, "mask": cmask(t)}
    for i in range(n):
        feeds[f"past_k_{i}"] = np.zeros((1, model.n_heads, 0, head_dim), np.float32)
        feeds[f"past_v_{i}"] = np.zeros((1, model.n_heads, 0, head_dim), np.float32)
    outs = sess["kronos-decode.onnx"].run(None, feeds)
    logits, ctx = outs[0], outs[1]
    ref_logits, ref_ctx = model.decode_s1(torch.from_numpy(feeds["s1"]).long(),
                                          torch.from_numpy(feeds["s2"]).long(),
                                          torch.from_numpy(stamp).long())
    fwd_diff = float(np.abs(logits - ref_logits.numpy()).max())

    # 4) one incremental step, against a full T+1 recompute
    nk = [outs[2 + i] for i in range(n)]
    nv = [outs[2 + n + i] for i in range(n)]
    step_feeds = {"s1": np.array([[5]], np.int32), "s2": np.array([[3]], np.int32),
                  "stamp": stamp[:, :1], "cos": tables(1, head_dim, t)[0], "sin": tables(1, head_dim, t)[1],
                  "mask": np.zeros((1, 1, 1, t + 1), np.float32)}
    for i in range(n):
        step_feeds[f"past_k_{i}"] = nk[i]
        step_feeds[f"past_v_{i}"] = nv[i]
    step = sess["kronos-decode.onnx"].run(None, step_feeds)
    full_logits, _ = model.decode_s1(
        torch.cat([torch.from_numpy(feeds["s1"]).long(), torch.tensor([[5]])], 1),
        torch.cat([torch.from_numpy(feeds["s2"]).long(), torch.tensor([[3]])], 1),
        torch.cat([torch.from_numpy(stamp).long(), torch.from_numpy(stamp[:, :1]).long()], 1))
    step_diff = float(np.abs(step[0] - full_logits[:, -1:].numpy()).max())

    # 5) greedy s1 -> s2 head parity
    s1_sample = int(np.argmax(logits[0, -1]))
    s2 = sess["kronos-s2head.onnx"].run(None, {"context": ctx, "s1_id": np.array([[s1_sample]], np.int32)})[0]
    ref_s2_logits = model.decode_s2(ref_ctx, torch.tensor([[s1_sample]])).numpy()
    s2_diff = float(np.abs(s2 - ref_s2_logits).max())

    report = {
        "tokenizerEncodeMismatches": enc_mismatch,
        "tokenizerDecodeMaxAbsDiff": dec_diff,
        "transformerLogitsMaxAbsDiff": fwd_diff,
        "incrementalStepMaxAbsDiff": step_diff,
        "s2HeadMaxAbsDiff": s2_diff,
    }
    print(json.dumps(report, indent=2))
    ok = (enc_mismatch == 0 and dec_diff < 1e-3 and fwd_diff < 1e-3
          and step_diff < 1e-3 and s2_diff < 1e-3)
    if not ok:
        raise SystemExit("SELF-CHECK FAILED — graphs do not match the reference")
    print("self-check: PASS")
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=os.path.join(REPO, "public", "kronos-local"))
    ap.add_argument("--weights-dir", default=os.environ.get("KRONOS_WEIGHTS_DIR") or None)
    ap.add_argument("--skip-check", action="store_true")
    args = ap.parse_args()

    t0 = time.time()
    mcfg, tcfg, msd, tsd, provenance = load_weights(args.weights_dir)
    model, tok = build(mcfg, tcfg, msd, tsd)
    print(f"weights loaded in {time.time()-t0:.1f}s "
          f"({sum(p.numel() for p in model.state_dict().values())/1e6:.2f}M model params)")
    export_all(model, tok, args.out, provenance)
    if not args.skip_check:
        self_check(model, tok, args.out)
    print(f"done in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
