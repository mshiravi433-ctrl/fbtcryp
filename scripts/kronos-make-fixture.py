#!/usr/bin/env python3
"""Generate the deterministic candle fixture + the REFERENCE forecast.

The reference is the unmodified vendored predictor (KronosPredictor.predict)
with top_k=1, which makes the sampler deterministic (a single surviving token),
so the browser engine can be compared bar-for-bar. Everything here is offline
and reproducible: no network, fixed seeds.
"""
import hashlib, json, os, sys
import numpy as np
import pandas as pd
import torch

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
from forecast.kronos_model import Kronos, KronosPredictor, KronosTokenizer  # noqa: E402
from safetensors.torch import load_file  # noqa: E402

W = os.environ.get("KRONOS_WEIGHTS_DIR", "/home/user/kronos-weights")
OUT = os.path.join(REPO, "test", "fixtures")
STEP_MS = 15 * 60 * 1000
START_MS = 1_700_000_000_000


def candles(n=220, seed=7, start=60_000.0):
    """15m GBM with a volatility cluster — plausible, not a market call."""
    rng = np.random.default_rng(seed)
    vol = 0.0009 * (1 + 0.5 * np.sin(np.arange(n) / 17))
    ret = rng.normal(0, 1, n) * vol
    close = start * np.exp(np.cumsum(ret))
    open_ = np.concatenate([[start], close[:-1]])
    span = np.abs(rng.normal(0, 1, n)) * vol * close * 2
    high = np.maximum(open_, close) + span
    low = np.minimum(open_, close) - span
    volume = np.abs(rng.normal(120, 40, n))
    out = []
    for i in range(n):
        out.append({"t": START_MS + i * STEP_MS,
                    "o": float(open_[i]), "h": float(high[i]),
                    "l": float(low[i]), "c": float(close[i]),
                    "v": float(volume[i])})
    return out


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = candles()
    horizon = 12
    x_ts = pd.Series(pd.to_datetime([r["t"] for r in rows], unit="ms"))
    last = rows[-1]["t"]
    y_ts = pd.Series(pd.to_datetime([last + STEP_MS * (i + 1) for i in range(horizon)], unit="ms"))

    mcfg = json.load(open(os.path.join(W, "Kronos-mini", "config.json")))
    tcfg = json.load(open(os.path.join(W, "Kronos-Tokenizer-2k", "config.json")))
    model = Kronos(**mcfg); tok = KronosTokenizer(**tcfg)
    model.load_state_dict(load_file(os.path.join(W, "Kronos-mini", "model.safetensors")), strict=True)
    tok.load_state_dict(load_file(os.path.join(W, "Kronos-Tokenizer-2k", "model.safetensors")), strict=True)
    model.eval(); tok.eval()

    predictor = KronosPredictor(model, tok, device="cpu", max_context=512, clip=5)
    df = pd.DataFrame({"open": [r["o"] for r in rows], "high": [r["h"] for r in rows],
                       "low": [r["l"] for r in rows], "close": [r["c"] for r in rows],
                       "volume": [r["v"] for r in rows]})
    with torch.no_grad():
        pred = predictor.predict(df, x_ts, y_ts, pred_len=horizon, T=1.0, top_k=1, top_p=1.0,
                                 sample_count=1, verbose=False)
    ref = [{"t": int(ts.value // 10**6), "o": float(r.open), "h": float(r.high),
            "l": float(r.low), "c": float(r.close), "v": float(r.volume)}
           for ts, r in pred.iterrows()]

    json.dump({"step": STEP_MS, "candles": rows}, open(os.path.join(OUT, "kronos-candles.json"), "w"))
    # Provenance is part of the artefact. Without it a later reader cannot tell
    # "the model changed" from "the fixture was regenerated on a different torch
    # build" — and those two mean opposite things for a failing test.
    provenance = {
        "generatedBy": "scripts/kronos-make-fixture.py",
        "model": "NeoQuasar/Kronos-mini",
        "tokenizer": "NeoQuasar/Kronos-Tokenizer-2k",
        "weightsSha256": {
            "Kronos-mini/model.safetensors": _sha256(os.path.join(W, "Kronos-mini", "model.safetensors")),
            "Kronos-Tokenizer-2k/model.safetensors": _sha256(os.path.join(W, "Kronos-Tokenizer-2k", "model.safetensors")),
        },
        "torch": torch.__version__,
        "numpy": np.__version__,
        "device": "cpu",
        "windowBars": len(rows),
        "sampler": "top_k=1 (single surviving token → deterministic)",
    }
    json.dump({"model": "NeoQuasar/Kronos-mini", "tokenizer": "NeoQuasar/Kronos-Tokenizer-2k",
               "horizon": horizon, "topK": 1, "temperature": 1.0, "topP": 1.0,
               "note": "KronosPredictor.predict(..., top_k=1) — deterministic sampler",
               "provenance": provenance,
               "candles": ref}, open(os.path.join(OUT, "kronos-reference.json"), "w"), indent=1)
    print("wrote fixture + reference:", len(rows), "candles →", horizon, "reference bars")
    print("reference closes:", [round(c["c"], 3) for c in ref[:5]], "…")


if __name__ == "__main__":
    main()
