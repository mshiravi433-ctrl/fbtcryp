#!/usr/bin/env python3
"""
KRONOS FORECAST WORKER — HTTP front-end for the Kronos K-line foundation model.
=============================================================================

What this is
------------
A small, dependency-light HTTP service that turns a window of real candles
(OHLCV) into a projection of the NEXT candles using
[shiyu-coder/Kronos](https://github.com/shiyu-coder/Kronos) — the open-source
foundation model for financial candlesticks (AAAI 2026, MIT). The Node API
(server/kronosForecast.js) calls this worker; the browser never talks to it
directly and the model never runs inside a serverless function.

Why a separate process
----------------------
Vercel functions are ephemeral and CPU-thin: a 25M-parameter autoregressive
transformer that takes seconds per forecast (and a ~100MB weight download on
first boot) belongs in a durable container — the same shape as the mission
worker (host/docker-compose.yml). This worker:

  * loads the model ONCE in the background at boot (warm-up thread),
  * serialises inference behind a lock (one forecast at a time, no OOM),
  * answers /healthz honestly: which backend, is the model loaded, what failed,
  * NEVER invents a number: if the model cannot run, it answers 503 and the
    Node layer falls back to its clearly-labelled statistical baseline.

Backends
--------
  KRONOS_BACKEND=kronos  (default) real model via Hugging Face weights.
  KRONOS_BACKEND=mock    deterministic continuation used by tests/CI only.
                         NEVER the default; the response says provider=mock.

Contract (POST /forecast)
-------------------------
  { "candles": [{"t": ms, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}],
    "predLen": 24, "T": 1.0, "topP": 0.9, "samples": 1 }
  → 200 { "ok": true, "provider": "kronos", "model": "NeoQuasar/Kronos-small",
          "generatedAt": ms, "candles": [{"t","o","h","l","c","v"}, ...] }
  → 400 { "ok": false, "error": "..." }     validation
  → 503 { "ok": false, "error": "MODEL_UNAVAILABLE" | "BUSY" }
  → 401 when KRONOS_WORKER_TOKEN is set and the caller did not present it.

Run
---
  pip install -r forecast/requirements.txt
  python3 forecast/worker.py            # kronos backend, port 8765
  KRONOS_BACKEND=mock python3 forecast/worker.py   # contract tests, no torch
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

# ── configuration (env, all optional) ────────────────────────────────────────

PORT = int(os.environ.get("KRONOS_WORKER_PORT", "8765"))
BACKEND = os.environ.get("KRONOS_BACKEND", "kronos").strip().lower()
MODEL_ID = os.environ.get("KRONOS_MODEL", "NeoQuasar/Kronos-small").strip()
TOKENIZER_ID = os.environ.get("KRONOS_TOKENIZER", "NeoQuasar/Kronos-Tokenizer-base").strip()
MAX_CONTEXT = max(64, min(2048, int(os.environ.get("KRONOS_MAX_CONTEXT", "512"))))
DEVICE = os.environ.get("KRONOS_DEVICE", "").strip() or None  # empty → auto
AUTH_TOKEN = os.environ.get("KRONOS_WORKER_TOKEN", "").strip()

MIN_CANDLES = 40          # below this the projection would be noise, not signal
MAX_CANDLES = 2048        # accepted payload ceiling; trimmed to MAX_CONTEXT
PRED_LEN_MAX = 120
SAMPLES_MAX = 8
WARMUP = BACKEND == "kronos"

# ── state ────────────────────────────────────────────────────────────────────

_state: dict[str, Any] = {
    "backend": BACKEND,
    "loaded": False,
    "loading": WARMUP,
    "error": None if WARMUP else "BACKEND_DISABLED",
    "model": MODEL_ID if BACKEND == "kronos" else "mock-continuation",
    "startedAt": time.time(),
    "forecasts": 0,
}
_load_lock = threading.Lock()       # one loader
_infer_lock = threading.Lock()      # one inference (CPU budget is one core)
_predictor: Any = None


# ── validation (importable without torch — this is what the tests pin) ──────

class BadRequest(ValueError):
    """Payload rejected; carries the machine-readable error code."""


def _num(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BadRequest(f"{field}_NOT_A_NUMBER")
    out = float(value)
    if not (out == out) or out in (float("inf"), float("-inf")):
        raise BadRequest(f"{field}_NOT_FINITE")
    return out


def validate_payload(body: Any) -> tuple[list[dict], int, dict]:
    """Validate one /forecast request → (candles, predLen, options).

    Trims to the LAST MAX_CONTEXT candles (the model's window), enforces
    strictly increasing timestamps and sane OHLC, and clamps the sampling
    options. Every rejection is a BadRequest with a stable code so the Node
    layer can log it without parsing prose.
    """
    if not isinstance(body, dict):
        raise BadRequest("BODY_NOT_AN_OBJECT")
    raw = body.get("candles")
    if not isinstance(raw, list):
        raise BadRequest("CANDLES_NOT_A_LIST")
    if len(raw) < MIN_CANDLES:
        raise BadRequest(f"CANDLES_TOO_FEW:{len(raw)}<{MIN_CANDLES}")
    if len(raw) > MAX_CANDLES:
        raw = raw[-MAX_CANDLES:]
    # The model only ever sees the last MAX_CONTEXT bars — trim first so a
    # 2000-bar payload costs one window of validation, not two thousand.
    raw = raw[-MAX_CONTEXT:]

    candles: list[dict] = []
    last_t: Optional[int] = None
    for i, row in enumerate(raw):
        if not isinstance(row, dict):
            raise BadRequest(f"CANDLE_{i}_NOT_AN_OBJECT")
        t = row.get("t")
        if isinstance(t, bool) or not isinstance(t, (int, float)) or int(t) != t:
            raise BadRequest(f"CANDLE_{i}_BAD_TIME")
        t = int(t)
        if last_t is not None and t <= last_t:
            raise BadRequest(f"CANDLE_{i}_TIME_NOT_INCREASING")
        o = _num(row.get("o"), f"CANDLE_{i}_O")
        h = _num(row.get("h"), f"CANDLE_{i}_H")
        l = _num(row.get("l"), f"CANDLE_{i}_L")
        c = _num(row.get("c"), f"CANDLE_{i}_C")
        if min(o, h, l, c) <= 0:
            raise BadRequest(f"CANDLE_{i}_NON_POSITIVE")
        if h < l:
            raise BadRequest(f"CANDLE_{i}_HIGH_BELOW_LOW")
        v = row.get("v", 0)
        v = 0.0 if v is None else _num(v, f"CANDLE_{i}_V")
        if v < 0:
            raise BadRequest(f"CANDLE_{i}_NEGATIVE_VOLUME")
        candles.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": v})
        last_t = t

    if len(candles) < MIN_CANDLES:
        raise BadRequest(f"CANDLES_TOO_FEW_AFTER_TRIM:{len(candles)}")

    def clamp_int(value: Any, default: int, lo: int, hi: int, name: str) -> int:
        if value is None:
            return default
        if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
            raise BadRequest(f"{name}_NOT_AN_INTEGER")
        return max(lo, min(hi, int(value)))

    pred_len = clamp_int(body.get("predLen"), 24, 1, PRED_LEN_MAX, "PREDLEN")

    t_raw = body.get("T", 1.0)
    if t_raw is None:
        t_raw = 1.0
    # Soft knobs are CLAMPED, not rejected: a client sending T=99 wants a
    # forecast, and2.0 is the hottest useful temperature anyway. Structural
    # problems in the candles are the only 400s that matter.
    temperature = max(0.05, min(2.0, _num(t_raw, "T")))

    p_raw = body.get("topP", 0.9)
    if p_raw is None:
        p_raw = 0.9
    top_p = max(0.05, min(1.0, _num(p_raw, "TOPP")))

    samples = clamp_int(body.get("samples"), 1, 1, SAMPLES_MAX, "SAMPLES")

    # Model window: keep the most recent bars, never more than the context.
    if len(candles) > MAX_CONTEXT:
        candles = candles[-MAX_CONTEXT:]

    opts = {"T": temperature, "topP": top_p, "samples": samples}
    return candles, pred_len, opts


def future_times(candles: list[dict], pred_len: int) -> list[int]:
    """Future timestamps at the MEDIAN spacing of the input — the same bars
    the chart would print next. Median, not mean: one gapped bar (weekend,
    halted market) must not stretch the whole projection."""
    times = [c["t"] for c in candles]
    deltas = sorted(b - a for a, b in zip(times, times[1:]) if b > a)
    if not deltas:
        raise BadRequest("CANDLES_NO_SPACING")
    step = deltas[len(deltas) // 2]
    last = times[-1]
    return [last + step * (i + 1) for i in range(pred_len)]


# ── backends ─────────────────────────────────────────────────────────────────

def _ensure_model() -> Any:
    """Load tokenizer+model exactly once, on the first caller's thread."""
    global _predictor, _load_lock
    if _predictor is not None:
        return _predictor
    with _load_lock:
        if _predictor is not None:
            return _predictor
        if _state["error"] and not _state["loading"]:
            raise RuntimeError(str(_state["error"]))
        try:
            import torch  # noqa: PLC0415 — heavy, load only when the backend is real
            try:
                from .kronos_model import Kronos, KronosPredictor, KronosTokenizer  # noqa: PLC0415
            except ImportError:  # script mode: python3 forecast/worker.py
                from kronos_model import Kronos, KronosPredictor, KronosTokenizer  # noqa: PLC0415

            device = DEVICE
            if device is None:
                device = "cuda:0" if torch.cuda.is_available() else "cpu"
            tokenizer = KronosTokenizer.from_pretrained(TOKENIZER_ID)
            model = Kronos.from_pretrained(MODEL_ID)
            tokenizer.eval()
            model.eval()
            predictor = KronosPredictor(model, tokenizer, device=device, max_context=MAX_CONTEXT)
            _predictor = predictor
            _state["loaded"] = True
            _state["loading"] = False
            _state["error"] = None
            _state["model"] = MODEL_ID
            return predictor
        except Exception as exc:  # noqa: BLE001 — any load failure is the same answer
            _state["loading"] = False
            _state["loaded"] = False
            _state["error"] = f"MODEL_LOAD_FAILED:{type(exc).__name__}:{str(exc)[:180]}"
            raise RuntimeError(_state["error"]) from exc


def run_kronos(candles: list[dict], pred_len: int, opts: dict) -> list[dict]:
    """Real forecast through the vendored Kronos model (lazy torch import)."""
    import pandas as pd  # noqa: PLC0415

    predictor = _ensure_model()
    y_times = future_times(candles, pred_len)
    df = pd.DataFrame(
        {
            "open": [c["o"] for c in candles],
            "high": [c["h"] for c in candles],
            "low": [c["l"] for c in candles],
            "close": [c["c"] for c in candles],
            "volume": [c["v"] for c in candles],
        }
    )
    x_ts = pd.Series(pd.to_datetime([c["t"] for c in candles], unit="ms"))
    y_ts = pd.Series(pd.to_datetime(y_times, unit="ms"))
    pred = predictor.predict(
        df=df,
        x_timestamp=x_ts,
        y_timestamp=y_ts,
        pred_len=pred_len,
        T=opts["T"],
        top_k=0,
        top_p=opts["topP"],
        sample_count=opts["samples"],
        verbose=False,
    )
    out = []
    for i, t in enumerate(y_times):
        row = pred.iloc[i]
        o, h, l, c = (float(row[k]) for k in ("open", "high", "low", "close"))
        # The model decodes in normalised space; a pathological sample must not
        # draw an inverted bar. Clamp into a valid candle, keep the numbers.
        lo, hi = min(o, c), max(o, c)
        h = max(h, hi)
        l = min(l, lo)
        import math  # noqa: PLC0415
        if not all(math.isfinite(v) for v in (o, h, l, c)) or min(o, h, l, c) <= 0:
            o = h = l = c = candles[-1]["c"]
        out.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": max(0.0, float(row.get("volume", 0) or 0))})
    return out


def run_mock(candles: list[dict], pred_len: int, opts: dict) -> list[dict]:
    """Deterministic continuation for tests/CI — NO torch, NO network.

    Seeded by the series itself, so the same window always produces the same
    projection (assertable), while the path still walks with the window's own
    volatility instead of drawing a straight line. provider=mock in the
    response; this is never the production default.
    """
    seed = hashlib.sha256("".join(f"{c['t']}:{c['c']:.10g}" for c in candles).encode()).hexdigest()
    rng = int(seed[:12], 16)
    closes = [c["c"] for c in candles]
    rets = [b / a - 1 for a, b in zip(closes, closes[1:]) if a > 0]
    window = rets[-min(120, len(rets)):] or [0.0]
    mean = sum(window) / len(window)
    var = sum((r - mean) ** 2 for r in window) / max(1, len(window) - 1)
    sigma = max(1e-6, var ** 0.5)
    drift = mean * 0.5  # shrink: the past mean is a weak prior, not a promise
    step = future_times(candles, pred_len)
    price = closes[-1]
    vol = sum(c["v"] for c in candles[-20:]) / min(20, len(candles))
    out = []
    for t in step:
        rng = (1103515245 * rng + 12345) % (2**31)
        z = (rng / (2**31)) - 0.5
        nxt = price * (1.0 + drift + sigma * z * 2.0)
        o = price
        c = max(1e-12, nxt)
        spread = abs(c - o) + price * sigma * 0.7
        h = max(o, c) + spread * 0.5
        l = max(1e-12, min(o, c) - spread * 0.5)
        out.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": vol})
        price = c
    return out


def run_forecast(candles: list[dict], pred_len: int, opts: dict) -> tuple[list[dict], str, str]:
    """Dispatch to the configured backend under the single-flight lock."""
    if not _infer_lock.acquire(timeout=120):
        raise TimeoutError("BUSY")
    try:
        if BACKEND == "mock":
            return run_mock(candles, pred_len, opts), "mock", "mock-continuation"
        out = run_kronos(candles, pred_len, opts)
        return out, "kronos", MODEL_ID
    finally:
        _infer_lock.release()


# ── HTTP ─────────────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    server_version = "KronosForecast/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # quiet by default
        if os.environ.get("KRONOS_WORKER_VERBOSE"):
            super().log_message(fmt, *args)

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if not AUTH_TOKEN:
            return True
        got = self.headers.get("X-Kronos-Token", "")
        if not got:
            auth = self.headers.get("Authorization", "")
            got = auth[7:] if auth.startswith("Bearer ") else ""
        return got == AUTH_TOKEN

    def do_GET(self) -> None:  # noqa: N802 — http.server naming
        path = self.path.split("?", 1)[0]
        if path in ("/healthz", "/forecast/healthz"):
            self._send(
                200,
                {
                    "ok": True,
                    "backend": BACKEND,
                    "loaded": bool(_state["loaded"]),
                    "loading": bool(_state["loading"]),
                    "model": _state["model"],
                    "maxContext": MAX_CONTEXT,
                    "forecasts": int(_state["forecasts"]),
                    "error": _state["error"],
                    "uptimeS": round(time.time() - _state["startedAt"], 1),
                },
            )
            return
        self._send(404, {"ok": False, "error": "NOT_FOUND"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path != "/forecast":
            self._send(404, {"ok": False, "error": "NOT_FOUND"})
            return
        if not self._authorized():
            self._send(401, {"ok": False, "error": "UNAUTHORIZED"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length <= 0 or length > 2_000_000:
            self._send(400, {"ok": False, "error": "BAD_BODY_SIZE"})
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self._send(400, {"ok": False, "error": "BODY_NOT_JSON"})
            return

        try:
            candles, pred_len, opts = validate_payload(body)
        except BadRequest as exc:
            self._send(400, {"ok": False, "error": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001 — never let a handler 500 bare
            self._send(400, {"ok": False, "error": f"VALIDATION_FAILED:{type(exc).__name__}"})
            return

        if BACKEND == "kronos" and not _state["loaded"]:
            # First boot: warm-up may still be running — give it a bounded wait.
            deadline = time.time() + (90 if _state["loading"] else 0)
            while not _state["loaded"] and _state["loading"] and time.time() < deadline:
                time.sleep(0.5)
            if not _state["loaded"]:
                self._send(503, {"ok": False, "error": _state["error"] or "MODEL_UNAVAILABLE"})
                return

        try:
            out, provider, model = run_forecast(candles, pred_len, opts)
        except TimeoutError:
            self._send(503, {"ok": False, "error": "BUSY"})
            return
        except RuntimeError as exc:
            self._send(503, {"ok": False, "error": str(exc)[:240]})
            return
        except BadRequest as exc:
            self._send(400, {"ok": False, "error": str(exc)})
            return
        except Exception as exc:  # noqa: BLE001 — a model blow-up is a 503, not a crash
            self._send(503, {"ok": False, "error": f"FORECAST_FAILED:{type(exc).__name__}:{str(exc)[:160]}"})
            return

        _state["forecasts"] = int(_state["forecasts"]) + 1
        self._send(
            200,
            {
                "ok": True,
                "provider": provider,
                "model": model,
                "generatedAt": int(time.time() * 1000),
                "predLen": pred_len,
                "options": opts,
                "candles": out,
            },
        )


def main() -> None:
    if WARMUP:
        def _warm() -> None:
            try:
                _ensure_model()
            except Exception:  # noqa: BLE001 — healthz reports it; boot must not die
                pass

        threading.Thread(target=_warm, name="kronos-warmup", daemon=True).start()

    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(
        f"[kronos-worker] backend={BACKEND} port={PORT} model={MODEL_ID} "
        f"maxContext={MAX_CONTEXT} auth={'on' if AUTH_TOKEN else 'off'}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
