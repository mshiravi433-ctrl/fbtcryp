#!/usr/bin/env node
/**
 * FBT-MCP CLI — transports for the MCP session core.
 * ---------------------------------------------------------------------------
 *   stdio (default)  · newline-delimited JSON-RPC on stdin/stdout. This is how
 *                      Cursor, Claude Code, Claude Desktop and Codex launch
 *                      local MCP servers. NOTHING but JSON-RPC ever touches
 *                      stdout; all logging goes to stderr, or a client that
 *                      parses frames would choke on a status line.
 *   http             · stateless streamable-HTTP subset: POST /mcp with one
 *                      JSON-RPC message in, one out; GET /healthz for probes.
 *                      For remote agents behind a TLS reverse proxy.
 *
 * SAFETY RULES THAT PREVENT STARTUP IN AN UNSAFE STATE (fail closed, loudly):
 *   · A non-loopback HTTP listener REQUIRES FBT_MCP_AUTH_TOKEN. A network
 *     bridge without an inbound credential would hand market tools to the
 *     internet and, worse, launder scope-gated calls through our one API key.
 *   · The inbound MCP token and the FBT_API_KEY are different credentials and
 *     must never be the same string (the MCP token authenticates callers; the
 *     API key authenticates us to FBT). Equal values are refused at startup.
 *   · The API key is never printed — not in errors, not in logs, not in
 *     /healthz. Startup logs show a 16-char prefix at most.
 *
 * Environment:
 *   FBT_BASE_URL            FBT API root (default https://fbtswap.ir)
 *   FBT_API_KEY             optional fbt_sandbox_… developer key
 *   FBT_TIMEOUT_MS          upstream timeout, default 20000
 *   FBT_MCP_TRANSPORT       stdio | http            (default stdio)
 *   FBT_MCP_HOST            http bind host          (default 127.0.0.1)
 *   FBT_MCP_PORT            http bind port          (default 7801)
 *   FBT_MCP_AUTH_TOKEN      bearer required from http callers
 *
 * TLS for a non-loopback listener is terminated by YOUR reverse proxy; this
 * process speaks plain HTTP on the private side of it, like every other
 * service in the stack. Bind loopback and tunnel (ssh -L) for remote agents
 * when no proxy is available.
 */

import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { timingSafeEqual, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from './client.mjs';
import { createSession, parseMessage, SERVER_INFO } from './protocol.mjs';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** Startup gate for the http transport. Fail closed: no token, no public bind. */
export function resolveHttpGuard({ host, authToken }) {
  const isLoopback = LOOPBACK.has(String(host || ''));
  if (!isLoopback && !authToken) {
    return { ok: false, reason: 'REFUSE_NON_LOOPBACK_WITHOUT_TOKEN: set FBT_MCP_AUTH_TOKEN (32+ random chars) before binding beyond 127.0.0.1' };
  }
  return { ok: true, reason: isLoopback ? 'LOOPBACK' : 'NON_LOOPBACK_WITH_TOKEN' };
}

const safeEqual = (a, b) => {
  const left = createHash('sha256').update(String(a)).digest();
  const right = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(left, right);
};

function log(...parts) {
  // stderr ONLY — stdout is the JSON-RPC channel in stdio mode.
  console.error('[fbt-mcp]', ...parts);
}

function startStdio(client) {
  const session = createSession({ client });
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const { message, errorResponse } = parseMessage(trimmed);
    const response = errorResponse || (await session.handleMessage(message));
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
  rl.on('close', () => process.exit(0));
  log(`stdio transport ready · base=${client.baseUrl} · key=${client.keyConfigured ? client.keyPrefix : 'none (public tools only)'}`);
}

function startHttp(client, { host, port, authToken }) {
  const session = createSession({ client });
  const server = createServer((req, res) => {
    const send = (status, payload, extraHeaders = {}) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...extraHeaders });
      res.end(body);
    };

    if (req.method === 'GET' && req.url === '/healthz') {
      /* Liveness only. Carries no configuration truth beyond the name — a
         public probe must not describe our key situation. */
      return send(200, { ok: true, server: SERVER_INFO.name, version: SERVER_INFO.version });
    }

    if (req.method !== 'POST' || !(req.url === '/mcp' || req.url === '/')) {
      return send(404, { error: 'NOT_FOUND', detail: 'POST /mcp (JSON-RPC) or GET /healthz' });
    }

    if (authToken) {
      const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!bearer || !safeEqual(bearer, authToken)) return send(401, { error: 'UNAUTHORIZED' });
    }

    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) { req.destroy(); }
    });
    req.on('end', async () => {
      const { message, errorResponse } = parseMessage(raw);
      const response = errorResponse || (await session.handleMessage(message));
      /* Stateless: a notification gets 202 with no body, a call gets its JSON. */
      if (!response) return send(202, {});
      return send(200, response);
    });
  });
  server.listen(port, host, () => {
    log(`http transport listening on ${host}:${port} (POST /mcp, GET /healthz) · base=${client.baseUrl} · inbound auth=${authToken ? 'bearer required' : 'loopback only'}`);
  });
}

function main() {
  const client = createClient();
  const transport = String(process.env.FBT_MCP_TRANSPORT || 'stdio').toLowerCase();

  if (transport === 'stdio') {
    startStdio(client);
    return;
  }

  if (transport === 'http') {
    const host = process.env.FBT_MCP_HOST || '127.0.0.1';
    const port = Number(process.env.FBT_MCP_PORT || 7801);
    const authToken = process.env.FBT_MCP_AUTH_TOKEN || '';
    const guard = resolveHttpGuard({ host, authToken });
    if (!guard.ok) {
      log(guard.reason);
      process.exit(2);
    }
    if (authToken && client.keyConfigured && safeEqual(authToken, process.env.FBT_API_KEY)) {
      log('REFUSE_TOKEN_REUSE: FBT_MCP_AUTH_TOKEN must not be the FBT_API_KEY — they authenticate different legs and must rotate independently.');
      process.exit(2);
    }
    startHttp(client, { host, port, authToken });
    return;
  }

  log(`unknown FBT_MCP_TRANSPORT '${transport}' — use stdio or http`);
  process.exit(2);
}

/* Only auto-start when executed directly (the probe imports the modules). */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
