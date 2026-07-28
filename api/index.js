/**
 * Vercel serverless entrypoint.
 *
 * Wraps the same Express app used for local development, so there is exactly
 * one implementation of the API rather than a copy that drifts. Vercel routes
 * every /api/* request here via the rewrite in vercel.json.
 *
 * The AI keys (OPENROUTER_API_KEY, JINA_API_KEY) are read from Vercel's
 * environment at runtime — they are never bundled into the client.
 */
import app from '../server/app.js';

export default app;
