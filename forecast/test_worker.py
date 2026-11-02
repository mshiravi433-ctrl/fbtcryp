#!/usr/bin/env python3
"""Contract tests for the Kronos forecast worker.

No torch, no network, no model weights: the mock backend plus the HTTP layer
are what can be pinned everywhere (CI, sandboxes without Hugging Face access).
The real `kronos` backend is exercised by its own warm-up in production —
anything that fails there surfaces through /healthz as `loaded: false` and an
`error` string, which these tests also pin the shape of.

Run:  python3 -m unittest forecast.test_worker -v
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "forecast"))

from worker import (  # noqa: E402 — path setup above is deliberate
    BadRequest,
    future_times,
    run_mock,
    validate_payload,
)


def make_candles(n: int = 120, start: int = 1_700_000_000_000, step: int = 60_000):
    """A plausible walk: strictly increasing, always-valid OHLC."""
    out = []
    price = 100.0
    for i in range(n):
        o = price
        c = price * (1.0 + ((i * 37) % 11 - 5) / 500.0)
        h = max(o, c) * 1.004
        l = min(o, c) * 0.996
        out.append({"t": start + i * step, "o": o, "h": h, "l": l, "c": c, "v": 10.0 + i % 7})
        price = c
    return out


class ValidateTests(unittest.TestCase):
    def test_accepts_and_clamps_predlen(self):
        candles, pred_len, opts = validate_payload({"candles": make_candles(400), "predLen": 5000})
        self.assertEqual(pred_len, 120)  # clamped to PRED_LEN_MAX
        self.assertEqual(len(candles), 400)
        self.assertEqual(opts["samples"], 1)

    def test_trims_to_model_context(self):
        candles, _, _ = validate_payload({"candles": make_candles(900)})
        self.assertEqual(len(candles), 512)  # MAX_CONTEXT default
        self.assertEqual(candles[-1]["t"], make_candles(900)[-1]["t"])

    def test_rejects_too_few(self):
        with self.assertRaises(BadRequest) as ctx:
            validate_payload({"candles": make_candles(10)})
        self.assertIn("CANDLES_TOO_FEW", str(ctx.exception))

    def test_rejects_non_increasing_time(self):
        rows = make_candles(60)
        rows[30]["t"] = rows[29]["t"]
        with self.assertRaises(BadRequest) as ctx:
            validate_payload({"candles": rows})
        self.assertIn("TIME_NOT_INCREASING", str(ctx.exception))

    def test_rejects_inverted_bar(self):
        rows = make_candles(60)
        rows[10]["h"] = rows[10]["l"] - 1
        with self.assertRaises(BadRequest) as ctx:
            validate_payload({"candles": rows})
        self.assertIn("INCONSISTENT_OHLC", str(ctx.exception))

    def test_rejects_non_positive_price(self):
        rows = make_candles(60)
        rows[5]["c"] = 0
        with self.assertRaises(BadRequest) as ctx:
            validate_payload({"candles": rows})
        self.assertIn("NON_POSITIVE", str(ctx.exception))

    def test_rejects_bad_predlen_type(self):
        with self.assertRaises(BadRequest) as ctx:
            validate_payload({"candles": make_candles(60), "predLen": "24"})
        self.assertIn("PREDLEN", str(ctx.exception))

    def test_rejects_non_list_body(self):
        with self.assertRaises(BadRequest):
            validate_payload([1, 2, 3])
        with self.assertRaises(BadRequest):
            validate_payload({"candles": "nope"})

    def test_clamps_sampling_options(self):
        _, _, opts = validate_payload({"candles": make_candles(60), "T": 99, "topP": 0.001, "samples": 99})
        self.assertLessEqual(opts["T"], 2.0)
        self.assertGreaterEqual(opts["topP"], 0.05)
        self.assertEqual(opts["samples"], 8)
        _, _, opts = validate_payload({"candles": make_candles(60), "T": -1})
        self.assertGreaterEqual(opts["T"], 0.05)


class FutureTimesTests(unittest.TestCase):
    def test_median_spacing_skips_one_gap(self):
        rows = make_candles(60, step=60_000)
        rows[-1]["t"] = rows[-2]["t"] + 10 * 60_000  # one gapped bar
        times = future_times(rows, 5)
        deltas = [b - a for a, b in zip(times, times[1:])]
        self.assertTrue(all(d == 60_000 for d in deltas))
        self.assertEqual(times[0] - rows[-1]["t"], 60_000)

    def test_rejects_zero_spacing(self):
        with self.assertRaises(BadRequest):
            future_times([{"t": 1}, {"t": 1}], 3)


class MockBackendTests(unittest.TestCase):
    def test_deterministic_and_well_formed(self):
        rows = make_candles(200)
        a = run_mock(rows, 24, {"T": 1.0, "topP": 0.9, "samples": 1})
        b = run_mock(rows, 24, {"T": 1.0, "topP": 0.9, "samples": 1})
        self.assertEqual(a, b)  # same window → same projection, always
        self.assertEqual(len(a), 24)
        times = [c["t"] for c in a]
        self.assertEqual(times, sorted(times))
        self.assertGreater(times[0], rows[-1]["t"])
        for c in a:
            self.assertGreater(c["c"], 0)
            self.assertGreaterEqual(c["h"], max(c["o"], c["c"]) - 1e-9)
            self.assertLessEqual(c["l"], min(c["o"], c["c"]) + 1e-9)

    def test_different_windows_differ(self):
        a = run_mock(make_candles(200), 12, {"T": 1.0, "topP": 0.9, "samples": 1})
        b = run_mock(make_candles(200, start=1_800_000_000_000), 12, {"T": 1.0, "topP": 0.9, "samples": 1})
        self.assertNotEqual(a, b)


class HttpContractTests(unittest.TestCase):
    """Boot the real worker process (mock backend) and speak HTTP to it."""

    @classmethod
    def setUpClass(cls):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            cls.port = s.getsockname()[1]
        env = {
            **os.environ,
            "KRONOS_BACKEND": "mock",
            "KRONOS_WORKER_PORT": str(cls.port),
            "KRONOS_WORKER_TOKEN": "unit-test-token",
        }
        cls.proc = subprocess.Popen(
            [sys.executable, str(REPO / "forecast" / "worker.py")],
            env=env,
            cwd=str(REPO),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        cls.base = f"http://127.0.0.1:{cls.port}"
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(cls.base + "/healthz", timeout=1) as r:
                    if r.status == 200:
                        break
            except Exception:  # noqa: BLE001 — boot race
                time.sleep(0.2)
        else:
            out = cls.proc.stdout.read() if cls.proc.stdout else b""
            raise RuntimeError(f"worker did not boot: {out[:500]!r}")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.proc.kill()

    def _post(self, path, payload, token="unit-test-token", timeout=20):
        req = urllib.request.Request(
            self.base + path,
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", **({"X-Kronos-Token": token} if token else {})},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_healthz_reports_backend(self):
        with urllib.request.urlopen(self.base + "/healthz", timeout=5) as r:
            data = json.loads(r.read())
        self.assertTrue(data["ok"])
        self.assertEqual(data["backend"], "mock")
        self.assertIn("loaded", data)

    def test_forecast_roundtrip(self):
        status, data = self._post("/forecast", {"candles": make_candles(120), "predLen": 18})
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])
        self.assertEqual(data["provider"], "mock")
        self.assertEqual(len(data["candles"]), 18)
        self.assertEqual(data["predLen"], 18)
        self.assertGreater(data["candles"][0]["t"], 0)
        self.assertIn("generatedAt", data)

    def test_requires_token(self):
        status, data = self._post("/forecast", {"candles": make_candles(120)}, token="")
        self.assertEqual(status, 401)
        self.assertEqual(data["error"], "UNAUTHORIZED")

    def test_validation_is_400_not_500(self):
        status, data = self._post("/forecast", {"candles": make_candles(5)})
        self.assertEqual(status, 400)
        self.assertIn("CANDLES_TOO_FEW", data["error"])

    def test_real_backend_health_is_503_until_loaded(self):
        # Start a second worker with the REAL backend selected but no torch in
        # the test environment. Its socket may be open; health must still be 503.
        env = dict(os.environ, KRONOS_BACKEND="kronos", KRONOS_WORKER_PORT="0")
        # Port 0 is not useful over HTTP; use a free port chosen by the OS.
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        env["KRONOS_WORKER_PORT"] = str(port)
        proc = subprocess.Popen([sys.executable, str(REPO / "forecast" / "worker.py")],
                                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.time() + 5
            while time.time() < deadline:
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1) as r:
                        self.assertEqual(r.status, 200)
                    break
                except urllib.error.HTTPError as exc:
                    self.assertEqual(exc.code, 503)
                    data = json.loads(exc.read())
                    self.assertFalse(data["ok"])
                    self.assertFalse(data["loaded"])
                    return
                except OSError:
                    time.sleep(0.05)
            self.fail("real worker did not start")
        finally:
            proc.terminate()
            proc.wait(timeout=5)

    def test_transient_model_load_failure_can_heal(self):
        import worker
        old = (worker.BACKEND, worker._predictor, dict(worker._state))
        calls = []
        try:
            worker.BACKEND = "kronos"
            worker._predictor = None
            worker._state.update(loaded=False, loading=False, error=None, nextRetryAt=0.0)
            def flaky():
                calls.append(1)
                if len(calls) == 1:
                    raise OSError("temporary download failure")
                return object()
            with self.assertRaisesRegex(RuntimeError, "MODEL_LOAD_FAILED"):
                worker._ensure_model(loader=flaky)
            self.assertFalse(worker._state["loaded"])
            self.assertGreater(worker._state["nextRetryAt"], 0)
            worker._state["nextRetryAt"] = 0.0
            self.assertIsNotNone(worker._ensure_model(loader=flaky))
            self.assertTrue(worker._state["loaded"])
            self.assertEqual(len(calls), 2)
        finally:
            worker.BACKEND, worker._predictor, state = old
            worker._state.clear()
            worker._state.update(state)

    def test_unknown_path_404(self):
        status, data = self._post("/nope", {})
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
