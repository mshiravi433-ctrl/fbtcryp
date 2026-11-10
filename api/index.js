/**
 * Vercel serverless entrypoint.
 *
 * Wraps the same Express app used for local development, so there is exactly
 * one implementation of the API rather than a copy that drifts. Vercel routes
 * every /api/* request here via the rewrite in vercel.json.
 *
 * The AI keys (OPENROUTER_API_KEY, JINA_API_KEY) are read from Vercel's
 * environment at runtime — they are never bundled into the client.
 *
 * ─── THE FIRST TWO IMPORTS ARE ORDERED, NOT ALPHABETICAL ────────────────────
 * `server/coldStart.js` takes the CPU baseline before any other module is
 * evaluated, and `markColdStart()` turns the delta into the one number a
 * free-tier operator actually needs: what a fresh instance costs before it
 * serves a single request. See server/cpuMeter.js. Do not reorder these.
 */
import '../server/coldStart.js';
import { markColdStart } from '../server/cpuMeter.js';
import '../server/intentSandboxOps.js';
import app from '../server/app.js';

/* Module evaluation is finished; everything after this is per-request. */
markColdStart();

export default app;
