# Kronos candle forecast — operation and deployment

The token chart's **AI forecast** button is available inline and in the full-screen
terminal. It posts the visible OHLC window to `POST /api/forecast`, draws future
candles in violet on a separate series, and labels the provider. It never presents
the statistical fallback or a test double as Kronos.

## Runtime contract

- Minimum history: **40** candles; maximum context: **512**.
- Horizon: automatic (12–48) or 12 / 24 / 48; API ceiling 120.
- Browser timeout: 35s. Node worker timeout: 25s by default.
- Schema: `fbt.forecast.v2`. Future timestamps must continue the input interval.
- `provider: "kronos"` means the real worker answered and its projection passed
  validation. `provider: "baseline"` means a labelled drift/volatility estimate.
- `GET /api/forecast/status` reports configuration and whether this server instance
  has verified a successful Kronos call. It does not expose the worker URL/token.
- POST requests are rate-limited per Telegram user/IP (`FORECAST_RATE_LIMIT`, default
  20 per general rate-limit window). GET status is not rate-limited.

## Bring up the real model

The model cannot run inside the Vercel function. Run the durable worker on a host
with Docker, at least 2 GB RAM (4 GB recommended), and outbound access to Hugging
Face. The default model is `NeoQuasar/Kronos-small` with
`NeoQuasar/Kronos-Tokenizer-base`.

```bash
cd host
# Set KRONOS_WORKER_TOKEN to a long random value in the host environment/.env.
docker compose up -d --build kronos-worker caddy
docker compose logs -f kronos-worker
```

`host/Caddyfile` is a template: replace `ai.yourdomain.com` and the admin email
with your real domain before starting Caddy. The worker is exposed only through
Caddy at `/kronos/*`; the shared token is checked by the worker. Health is 503 until
the real weights are loaded, then 200. A failed cold start is retried after 60s.
Weights persist in the `kronos-cache` volume.

On Vercel set:

```text
KRONOS_WORKER_URL=https://YOUR_REAL_DOMAIN/kronos
KRONOS_WORKER_TOKEN=THE_SAME_LONG_RANDOM_VALUE
```

Redeploy the app. Verify:

```bash
curl https://YOUR_REAL_DOMAIN/kronos/healthz
curl https://fbtswap.ir/api/forecast/status
curl 'https://fbtswap.ir/api/forecast/bitcoin?days=7&predLen=12'
```

The last response must say `provider: "kronos"` and `worker.ok: true`. If it says
`baseline`, the button is operational but the real model is not connected; inspect
`worker.code`, worker logs, DNS/TLS, token equality and Hugging Face access. Do not
set `KRONOS_BACKEND=mock` in production. Mock is for contract tests only and Node
rejects it as a model answer.

## Local checks

```bash
npm run test:forecast
npm run test:pro-chart
npm run build
```

For a local end-to-end HTTP check without weights, run `KRONOS_BACKEND=mock python3
forecast/worker.py` and the Node server. This verifies transport/UI only, not model
quality. Real-model verification requires the `kronos` backend and loaded weights.
