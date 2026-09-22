/**
 * MCP BRIDGE PROBE — does fbt-mcp connect to things that actually exist?
 *
 * Motivated by the same three failure classes as test/wiring.mjs, pointed at
 * the agent surface:
 *
 *   1. A tool advertised to a model whose route 404s wastes an agent call and
 *      sends its operator to file a bug against us. Every `routes:` literal in
 *      mcp/src/tools.mjs is matched against a real app.get/app.post here.
 *   2. A "read-only bridge" that quietly grew a signing tool is exactly how
 *      non-custodial becomes a marketing word. Asserted by NAME and by the
 *      absence of sign/execute/withdraw verbs in the catalogue.
 *   3. A credential that flows into a model transcript is a leak with an
 *      audience. Redaction and header discipline are asserted with a stub
 *      upstream that deliberately echoes secrets back.
 *
 * Run: node test/mcp/mcp-probe.mjs   (npm run test:mcp)
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const results = [];
const check = (name, ok) => { results.push({ name, ok: Boolean(ok) }); console.log(`${ok ? '✓' : '✗'} ${name}`); };

const { createClient, renderResult, redactSecrets } = await import('../../mcp/src/client.mjs');
const toolsMod = await import('../../mcp/src/tools.mjs');
const { createSession, parseMessage, SUPPORTED_PROTOCOL_VERSIONS } = await import('../../mcp/src/protocol.mjs');
const { resolveHttpGuard } = await import('../../mcp/src/cli.mjs');

const serverSrc = readFileSync(new URL('../../server/app.js', import.meta.url), 'utf8');
const tools = toolsMod.TOOLS;

/* -------------------------------------------------------------------------- */
/* 1. wiring — every advertised route exists on the server                     */
/* -------------------------------------------------------------------------- */
try {
  const toMatcher = (method, routePath) => {
    const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    /* The method is baked into the matcher, not checked after the fact: a path
       registered with BOTH app.get and app.post would otherwise match the
       first registration and fail the wrong half. Params become wildcards with
       the closing quote kept, so `/x/:id` never matches `/x/:id/submit`. */
    return new RegExp(`app\\.${method.toLowerCase()}\\('${escaped.replace(/:[A-Za-z_]+/g, '[^/]+')}'`);
  };
  const missing = [];
  for (const tool of tools) {
    for (const route of tool.routes) {
      const [method, path] = route.split(' ');
      if (!toMatcher(method, path).test(serverSrc)) {
        missing.push(`${tool.name} → ${route}`);
      }
    }
  }
  check(`every tool route is registered in server/app.js${missing.length ? ` — dead: ${missing.join(', ')}` : ''}`, missing.length === 0);
  check('the whoami identity route is registered', /app\.get\('\/api\/developer\/whoami'/.test(serverSrc));
  check('every tool declares at least one route', tools.every((t) => Array.isArray(t.routes) && t.routes.length > 0));
} catch (error) {
  check(`wiring check crashed: ${error.message}`, false);
}

/* -------------------------------------------------------------------------- */
/* 2. catalogue sanity — a surface a model can trust                            */
/* -------------------------------------------------------------------------- */
try {
  check('the catalogue has a useful size (≥ 20 tools)', tools.length >= 20);
  check('every tool has name, description, inputSchema and run', tools.every((t) =>
    typeof t.name === 'string' && t.name.startsWith('fbt_')
    && typeof t.description === 'string' && t.description.length > 40
    && t.inputSchema?.type === 'object'
    && typeof t.run === 'function'));
  const forbidden = tools.filter((t) => toolsMod.FORBIDDEN_NAME_RE.test(t.name));
  check(`no tool name contains sign/execute/withdraw/settle verbs${forbidden.length ? ` — ${forbidden.map((t) => t.name).join(', ')}` : ''}`, forbidden.length === 0);
  /* A description that PROMISES execution is the failure ("this tool signs the
     transaction"). Boundary prose ("the user's wallet signs; this bridge will
     not") must NOT trip it — so the check is subject-anchored rather than
     verb-scanning. */
  const claimsExecution = tools.filter((t) =>
    /\b(this tool|this bridge|this server|this process|fbt-mcp)\b[^.!?]*\b(can|will)\s+(sign|execute|broadcast|withdraw|settle)\b/i.test(t.description));
  check('no tool description claims it can execute', claimsExecution.length === 0);
  check('every tool description carries the advisory note or the key requirement', tools.every((t) =>
    t.description.includes('Advisory only') || t.description.includes('Requires a key') || t.description.includes('Requires the ')));
  const scoped = tools.filter((t) => t.scope !== 'public' && t.scope !== 'scoped');
  check('scoped tools use only real developer-key scopes', scoped.every((t) =>
    ['read_network', 'request_quote', 'request_simulation', 'manage_listings'].includes(t.scope)));
  check('the boundary says userSignatureRequired', toolsMod.BOUNDARY.userSignatureRequired === true && toolsMod.BOUNDARY.canSign === false);
} catch (error) {
  check(`catalogue check crashed: ${error.message}`, false);
}

/* -------------------------------------------------------------------------- */
/* 3. protocol — handshake, listing, refusal, arg validation                    */
/* -------------------------------------------------------------------------- */
try {
  const stubFetch = async () => { throw new Error('network must not be touched'); };
  const client = createClient({ baseUrl: 'http://stub.invalid', apiKey: '', fetchImpl: stubFetch });
  const session = createSession({ client });

  const init = await session.handleMessage({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '0' } }
  });
  check('initialize negotiates the protocol version', init.result.protocolVersion === '2025-06-18' && SUPPORTED_PROTOCOL_VERSIONS.includes(init.result.protocolVersion));
  check('initialize advertises tools capability only', init.result.capabilities.tools && !init.result.capabilities.resources && !init.result.capabilities.sampling);
  check('initialize instructions state the never-sign boundary', /never receives a key|only signer/i.test(init.result.instructions));

  const unknown = await session.handleMessage({ jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} });
  check('unknown methods fail with -32601', unknown.error?.code === -32601);

  const notified = await session.handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' });
  check('notifications get no response', notified === null);

  const list = await session.handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
  check('tools/list returns the full catalogue', list.result.tools.length === tools.length);
  check('tools/list exposes the fbt scope hint', list.result.tools.every((t) => typeof t['x-fbt-scope'] === 'string'));
  check('tools/list marks tools non-destructive', list.result.tools.every((t) => t.annotations.destructiveHint === false));

  const refused = await session.handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'sign_swap', arguments: {} } });
  check('a forbidden tool NAME gets the policy refusal, not unknown-tool', refused.result.isError === true && refused.result.content[0].text.includes('POLICY_REFUSAL'));
  const parsed = parseMessage('not json');
  check('parse errors are JSON-RPC -32700', parsed.errorResponse.error.code === -32700);
} catch (error) {
  check(`protocol check crashed: ${error.message}`, false);
}

/* -------------------------------------------------------------------------- */
/* 4. scope gates + header discipline + redaction (stub upstream)               */
/* -------------------------------------------------------------------------- */
try {
  const calls = [];
  let whoamiScopes = [];
  const jsonRes = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const stubFetch = async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, headers: options.headers || {}, body: options.body });
    if (u.endsWith('/api/developer/whoami')) {
      return jsonRes(200, { data: { owner: '1', projectId: 'p', keyId: 'k', environment: 'sandbox', scopes: whoamiScopes, keyScopes: [] }, meta: { schema: 'fbt.developer-whoami.v1', dataStatus: 'live' } });
    }
    if (u.includes('/api/markets')) return jsonRes(200, [{ id: 'bitcoin', symbol: 'btc' }]);
    if (u.includes('/api/cross-chain/quote')) {
      /* Deliberately hostile upstream: echoes credential-shaped junk back. */
      return jsonRes(200, { schema: 'fbt.cross-chain-quote.v1', quote: { toAmount: '1' }, note: 'leaky fbt_sandbox_LEAKEDSECRET12345678 field', secret: 'fbt_sandbox_ALSOLEAKED12345678' });
    }
    return jsonRes(404, { error: 'NOT_FOUND' });
  };

  const anon = createClient({ baseUrl: 'http://stub.invalid', apiKey: '', fetchImpl: stubFetch });
  const anonSession = createSession({ client: anon });

  /* public tool: no key configured, works, and sends NO authorization header */
  const markets = await anonSession.callTool('fbt_get_markets', { perPage: 5 });
  check('public tools work without a key', !markets.isError && markets.content[0].text.includes('bitcoin'));
  check('public tools send no Authorization header', calls.every((c) => !c.headers.authorization));

  /* quote tool without a key: refused with instructions, zero network */
  const before = calls.length;
  const gate1 = await anonSession.callTool('fbt_get_cross_chain_quote', { fromChain: '1', toChain: '56', fromToken: 'native', toToken: 'native', fromAmount: '1000' });
  check('quote tools refuse without a key (NEEDS_API_KEY)', gate1.isError === true && gate1.content[0].text.includes('NEEDS_API_KEY'));
  check('the refusal makes no upstream call', calls.length === before);

  /* quote tool with a key whose server-identity lacks the scope */
  whoamiScopes = [];
  const keyed = createClient({ baseUrl: 'http://stub.invalid', apiKey: 'fbt_sandbox_probe_key_abcdefgh123456', fetchImpl: stubFetch });
  const keyedSession = createSession({ client: keyed });
  const gate2 = await keyedSession.callTool('fbt_get_cross_chain_quote', { fromChain: '1', toChain: '56', fromToken: 'native', toToken: 'native', fromAmount: '1000' });
  check('scopes come from server whoami, not client opinion (SCOPE_NOT_ALLOWED)', gate2.isError === true && gate2.content[0].text.includes('SCOPE_NOT_ALLOWED'));

  /* quote tool with the scope: goes through, Authorization attached, secrets redacted.
     A FRESH client because identity() caches server truth per session on
     purpose (whoami is a network call, and a key's scopes are immutable after
     creation — revocation only ever removes them). The gate2 client is
     legitimately stuck at its cached empty scope. */
  whoamiScopes = ['request_quote'];
  const scoped = createClient({ baseUrl: 'http://stub.invalid', apiKey: 'fbt_sandbox_probe_key_abcdefgh123456', fetchImpl: stubFetch });
  const scopedSession = createSession({ client: scoped });
  const gate3 = await scopedSession.callTool('fbt_get_cross_chain_quote', { fromChain: '1', toChain: '56', fromToken: 'native', toToken: 'native', fromAmount: '1000' });
  const quoteCall = calls.find((c) => c.url.includes('/api/cross-chain/quote'));
  check('a scoped quote call reaches the right route with the key', !gate3.isError && Boolean(quoteCall));
  if (quoteCall) {
    check('the scoped call carries the Bearer key and query params', /^Bearer fbt_sandbox_/.test(quoteCall.headers.authorization || '') && quoteCall.url.includes('fromAmount=1000'));
    const leaked = gate3.content[0].text.includes('LEAKEDSECRET') || gate3.content[0].text.includes('ALSOLEAKED');
    check('credential-shaped junk echoed by upstream is redacted from the model', !leaked);
  } else {
    check('the scoped call carries the Bearer key and query params', false);
    check('credential-shaped junk echoed by upstream is redacted from the model', false);
  }

  /* unit: renderResult redaction */
  const rendered = renderResult({ secret: 'fbt_sandbox_UNITTESTSECRET123456', ok: true });
  check('renderResult scrubs secret fields', !rendered.includes('UNITTESTSECRET') && rendered.includes('[REDACTED]'));
  check('redactSecrets keeps non-secret content intact', redactSecrets('price 123').includes('123'));
} catch (error) {
  check(`scope/redaction check crashed: ${error.message}`, false);
}

/* -------------------------------------------------------------------------- */
/* 5. http transport guard — no public bind without a token                    */
/* -------------------------------------------------------------------------- */
try {
  check('loopback without token is allowed', resolveHttpGuard({ host: '127.0.0.1', authToken: '' }).ok === true);
  check('non-loopback without token is refused', resolveHttpGuard({ host: '0.0.0.0', authToken: '' }).ok === false);
  check('non-loopback with token is allowed', resolveHttpGuard({ host: '0.0.0.0', authToken: 'x'.repeat(40) }).ok === true);
} catch (error) {
  check(`http guard check crashed: ${error.message}`, false);
}

/* -------------------------------------------------------------------------- */
/* 6. live transport smoke — stdio framing and http auth, real child process    */
/* -------------------------------------------------------------------------- */
const CLI = new URL('../../mcp/src/cli.mjs', import.meta.url).pathname;

function spawnCli(env) {
  return spawn(process.execPath, [CLI], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
}

async function stdioSmoke() {
  const child = spawnCli({ FBT_MCP_TRANSPORT: 'stdio', FBT_BASE_URL: 'http://127.0.0.1:1', FBT_API_KEY: '' });
  const rl = createInterface({ input: child.stdout });
  const lines = [];
  rl.on('line', (l) => lines.push(l));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  const deadline = Date.now() + 8000;
  while ((lines.length < 2 || !lines[1]?.includes('"tools"')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  const first = lines[0] ? JSON.parse(lines[0]) : null;
  const second = lines[1] ? JSON.parse(lines[1]) : null;
  check('stdio transport answers initialize as framed JSON-RPC', first?.result?.protocolVersion === '2025-03-26');
  check('stdio transport answers tools/list as framed JSON-RPC', second?.result?.tools?.length === tools.length);
  check('stdio stdout carries only JSON-RPC frames', lines.every((l) => l.trim().startsWith('{')));
}

async function httpSmoke() {
  const token = 'p'.repeat(48);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawnCli({
    FBT_MCP_TRANSPORT: 'http', FBT_MCP_HOST: '127.0.0.1', FBT_MCP_PORT: String(port),
    FBT_MCP_AUTH_TOKEN: token, FBT_BASE_URL: 'http://127.0.0.1:1', FBT_API_KEY: ''
  });
  const deadline = Date.now() + 8000;
  let up = false;
  while (!up && Date.now() < deadline) {
    try {
      const probe = await fetch(`http://127.0.0.1:${port}/healthz`);
      up = probe.ok;
    } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  check('http transport serves /healthz on loopback', up);

  const unauth = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } })
  });
  check('http transport rejects callers without the bearer token', unauth.status === 401);

  const auth = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } })
  });
  const payload = await auth.json();
  check('http transport answers an authenticated initialize', auth.status === 200 && payload.result?.serverInfo?.name === 'fbt-mcp');
  child.kill();
}

async function tokenReuseSmoke() {
  const child = spawnCli({
    FBT_MCP_TRANSPORT: 'http', FBT_MCP_HOST: '127.0.0.1', FBT_MCP_PORT: '0',
    FBT_MCP_AUTH_TOKEN: 'same-value-for-both-legs-should-not-start',
    FBT_API_KEY: 'same-value-for-both-legs-should-not-start'
  });
  const [code] = await once(child, 'exit');
  check('reusing the API key as the inbound MCP token refuses to start', code === 2);
}

try {
  await stdioSmoke();
  await httpSmoke();
  await tokenReuseSmoke();
} catch (error) {
  check(`transport smoke crashed: ${error.message}`, false);
}

const failed = results.filter((row) => !row.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
export default results;
