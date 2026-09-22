/**
 * FBT-MCP PROTOCOL — a minimal, honest Model Context Protocol server core.
 * ---------------------------------------------------------------------------
 * Implements exactly the subset of MCP this bridge needs and nothing more:
 *
 *   initialize · notifications/initialized · ping · tools/list · tools/call
 *
 * Messages are newline-delimited JSON-RPC 2.0 (the stdio transport) or single
 * JSON-RPC objects over stateless streamable-HTTP POST. No sampling, no
 * resources, no prompts, no roots — advertising capabilities we do not
 * implement would make a client probe them and fail.
 *
 * The zero-dependency choice is deliberate (same reasoning as the internal AI
 * engine fallback): an agent bridge that handles developer credentials should
 * have as small a supply chain as possible. `@modelcontextprotocol/sdk` is a
 * fine library; it is simply more surface than five methods need.
 *
 * Tool errors come back as `isError: true` RESULTS (per the MCP spec — a tool
 * that ran and failed is not a protocol error). Protocol misuse (-326xx) is
 * reserved for malformed JSON-RPC itself.
 */

import { listToolDescriptors, getTool, validateArgs, POLICY_REFUSAL, FORBIDDEN_NAME_RE } from './tools.mjs';
import { renderResult, withDefaultScope } from './client.mjs';

export const SERVER_INFO = Object.freeze({ name: 'fbt-mcp', title: 'FBT Swap MCP', version: '0.1.0' });

/** Newest first. We echo the client's requested version when we support it. */
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const toolContent = (text, isError = false) => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
  /* Structured output alongside the text so well-behaved clients can skip
     JSON parsing; `isError` payloads still carry their shape here. */
  ...(isError ? {} : {})
});

/**
 * Create a session handler bound to one FBT client.
 * `handleMessage` returns a response object, or null for notifications.
 */
export function createSession({ client, serverInfo = SERVER_INFO } = {}) {
  let initialized = false;

  async function callTool(name, args) {
    /* The refusal is by NAME before lookup: a model improvising `sign_swap`
       gets the boundary explanation, not "unknown tool" — teaching the
       boundary is the point. */
    if (FORBIDDEN_NAME_RE.test(String(name))) {
      return toolContent(renderResult(POLICY_REFUSAL), true);
    }
    const tool = getTool(name);
    if (!tool) {
      return toolContent(renderResult({ error: 'UNKNOWN_TOOL', detail: `No tool named '${String(name).slice(0, 64)}'. See tools/list.` }), true);
    }
    const valid = validateArgs(tool, args);
    if (!valid.ok) {
      return toolContent(renderResult(valid), true);
    }
    try {
      /* The tool's scope rides every request it makes — see withDefaultScope. */
      const value = await tool.run(withDefaultScope(client, tool.scope), valid.args);
      const failed = value && typeof value === 'object' && (value.ok === false || value.error);
      return toolContent(renderResult(value), Boolean(failed));
    } catch (err) {
      return toolContent(renderResult({ error: 'TOOL_ERROR', detail: String(err?.message || 'TOOL_ERROR').slice(0, 200) }), true);
    }
  }

  async function handleMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return rpcError(null, ERR_INVALID_REQUEST, 'expected a single JSON-RPC 2.0 object');
    }
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;

    /* Notifications need no response. Cancelled work is not aborted mid-flight
       (requests are short and bounded); acknowledging is enough. */
    if (isNotification) {
      if (method === 'notifications/initialized') { initialized = true; return null; }
      if (method === 'notifications/cancelled') return null;
      return null;
    }

    if (method === 'initialize') {
      const requested = String(params?.protocolVersion || LATEST_PROTOCOL_VERSION);
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
      initialized = true;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo,
        instructions: [
          'fbt-mcp exposes FBT Swap market intelligence, quotes and dry-run simulations to agents.',
          'HARD BOUNDARY: nothing here signs, broadcasts, settles or withdraws. The user\'s wallet is the only signer.',
          'Quote tools need the request_quote scope on FBT_API_KEY; simulations need request_simulation; listing writes need manage_listings.',
          'Numbers come from real providers and are never invented; when a source is down the answer says so instead of guessing.',
          'This is not investment advice.'
        ].join('\n')
      });
    }

    if (method === 'ping') return rpcResult(id, {});

    if (method === 'tools/list') return rpcResult(id, { tools: listToolDescriptors() });

    if (method === 'tools/call') {
      const name = params?.name;
      if (typeof name !== 'string' || !name) return rpcError(id, ERR_INVALID_PARAMS, 'params.name is required');
      const result = await callTool(name, params?.arguments || {});
      return rpcResult(id, result);
    }

    return rpcError(id, ERR_METHOD_NOT_FOUND, `method not found: ${String(method).slice(0, 64)}`);
  }

  return {
    handleMessage,
    callTool,
    get initialized() { return initialized; }
  };
}

/** Parse one transport frame. Returns { message } or { errorResponse }. */
export function parseMessage(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return { errorResponse: rpcError(null, ERR_PARSE, 'parse error') };
  }
  return { message };
}

export { rpcError, rpcResult, ERR_PARSE, ERR_INVALID_REQUEST, ERR_METHOD_NOT_FOUND, ERR_INVALID_PARAMS, ERR_INTERNAL };
