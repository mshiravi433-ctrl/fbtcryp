#!/usr/bin/env node
/**
 * FEE ROUTER STATUS PROBE — is the FeeRouter connected for the AI, honestly?
 * ---------------------------------------------------------------------------
 * The AI surfaces (the in-app Intent AI tool `feeRouter.status` and the
 * fbt-mcp tool `fbt_get_fee_router_status`) both point at one server route:
 * GET /api/fees/router-status. This probe proves the connection end to end:
 *
 *   1. default report (no env): honest aggregator mode, the committed
 *      bytecode hash, the NOT-audited disclosure — nothing fabricated;
 *   2. configured report (child procs, import-time env): per-chain router
 *      map + a LIVE on-chain read against a stub RPC that speaks enough
 *      JSON-RPC (eth_getCode + the four getters), plus the NOT_DEPLOYED and
 *      UNREACHABLE honesty paths;
 *   3. the real HTTP route on server/app.js answers with the same shape,
 *      and the in-app AI tool registry lists the tool pointing at it;
 *   4. the MCP bridge advertises the tool, its name stays within the
 *      never-sign boundary, and its route is registered in server/app.js
 *      (the same dead-route discipline as test/mcp/mcp-probe.mjs).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

let failed = 0;
function report(section, rows) {
  console.log(`\n▸ ${section}`);
  for (const [label, ok] of rows) {
    if (ok) console.log(`  ✓ ${label}`);
    else {
      failed += 1;
      console.log(`  ✗ ${label}`);
    }
  }
}

const A1 = '0x1111111111111111111111111111111111111111';

/* ════════════════════════════════════════════════════════════════════════ */
/* 1. default report — nothing configured, nothing invented                */
/* ════════════════════════════════════════════════════════════════════════ */

function child(script, env) {
  return execFileSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { env: { ...process.env, ...env, FBT_ROOT: root }, encoding: 'utf8', timeout: 120_000 }
  );
}

const defaultOut = child(`
  import { pathToFileURL } from 'node:url';
  const m = await import(pathToFileURL(process.env.FBT_ROOT + '/server/feeRouterStatus.js'));
  const r = await m.feeRouterStatus({});
  console.log('JSON=' + JSON.stringify(r));
`, {});
const def = JSON.parse(defaultOut.split('JSON=')[1]);

const artifactRaw = JSON.parse(readFileSync(path.join(root, 'src', 'lib', 'feeRouterArtifact.json'), 'utf8'));
const expectedHash = createHash('sha256').update(artifactRaw.deployedBytecode).digest('hex');

report('default report (no env)', [
  ['schema + ok + at present', def.schema === 'fbt.fee-router-status.v1' && def.ok === true && Number.isFinite(def.at)],
  ['mode is aggregator when nothing is configured', def.mode === 'aggregator'],
  ['no routers, no live checks — and it says so', Object.keys(def.routers).length === 0 && Object.keys(def.live).length === 0 && typeof def.note === 'string' && def.note.length > 20],
  ['platform fee bps is the app fee, not a guess', Number.isInteger(def.platformFeeBps) && def.platformFeeBps > 0 && def.platformFeeBps <= 100],
  ['★ committed bytecode hash matches the artifact the ops-probe hashes', def.artifact?.ok === true && def.artifact.deployedBytecodeHash === expectedHash],
  ['audit disclosure stays honest (NOT audited)', def.audit?.audited === false && typeof def.audit?.note === 'string' && def.audit.note.length > 10]
]);

/* ════════════════════════════════════════════════════════════════════════ */
/* 2. configured report — import-time env + live on-chain reads            */
/* ════════════════════════════════════════════════════════════════════════ */

const stubbedLive = child(`
  import http from 'node:http';
  import { pathToFileURL } from 'node:url';
  const m = await import(pathToFileURL(process.env.FBT_ROOT + '/server/feeRouterStatus.js'));
  const chains = await import(pathToFileURL(process.env.FBT_ROOT + '/src/lib/chains.js'));

  const FAKE_CODE = '0x' + 'ab'.repeat(400);
  const word = (bytes) => '0x' + bytes;
  const words = {
    '0x0758d924': word('2222222222222222222222222222222222222222222222222222222222222222'), // dexRouter
    '0x46904840': word('3333333333333333333333333333333333333333333333333333333333333333'), // feeRecipient
    '0x24a9d853': word('0000000000000000000000000000000000000000000000000000000000000046'), // feeBps = 70
    '0x8da5cb5b': word('4444444444444444444444444444444444444444444444444444444444444444')  // owner
  };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const { method, params } = JSON.parse(body || '{}');
      let result = null;
      if (method === 'eth_getCode') result = FAKE_CODE;
      if (method === 'eth_call') result = words[String(params?.[0]?.data).slice(0, 10)] || '0x';
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  chains.EVM_CHAINS[56].rpc = ['http://127.0.0.1:' + port + '/stub'];

  const r = await m.feeRouterStatus({});
  console.log('JSON=' + JSON.stringify(r));
  server.close();
`, { VITE_FEE_ROUTERS: JSON.stringify({ 56: A1 }) });
const live = JSON.parse(stubbedLive.split('JSON=')[1]);

report('configured report + live on-chain read (stub RPC)', [
  ['mode flips to contract when a deployment is configured', live.mode === 'contract'],
  ['per-chain router entry with chain info + explorer link', live.routers?.['56']?.address === A1 && live.routers?.['56']?.chain?.short === 'BSC' && live.routers?.['56']?.explorer.includes(A1)],
  ['★ live check verified the code and parsed the getters', live.live?.['56']?.ok === true && live.live?.['56']?.codeBytes === 400 && live.deployedOn?.includes(56)],
  ['on-chain state decoded: feeBps 70, recipient, owner, dexRouter',
    live.live?.['56']?.state?.feeBps === 70
    && live.live?.['56']?.state?.feeRecipient === '0x3333333333333333333333333333333333333333'
    && live.live?.['56']?.state?.owner === '0x4444444444444444444444444444444444444444'
    && live.live?.['56']?.state?.dexRouter === '0x2222222222222222222222222222222222222222'],
  ['note reports the verified chain count', typeof live.note === 'string' && live.note.includes('1')]
]);

const notDeployedOut = child(`
  import http from 'node:http';
  import { pathToFileURL } from 'node:url';
  const m = await import(pathToFileURL(process.env.FBT_ROOT + '/server/feeRouterStatus.js'));
  const chains = await import(pathToFileURL(process.env.FBT_ROOT + '/src/lib/chains.js'));
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const { method } = JSON.parse(body || '{}');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: method === 'eth_getCode' ? '0x' : null }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  chains.EVM_CHAINS[56].rpc = ['http://127.0.0.1:' + server.address().port + '/stub'];
  const r = await m.feeRouterStatus({});
  console.log('JSON=' + JSON.stringify(r));
  server.close();
`, { VITE_FEE_ROUTERS: JSON.stringify({ 56: A1 }) });
const notDeployed = JSON.parse(notDeployedOut.split('JSON=')[1]);

report('honest NOT_DEPLOYED (address set, no code)', [
  ['live check reports NOT_DEPLOYED, not ok', notDeployed.live?.['56']?.ok === false && notDeployed.live?.['56']?.code === 'NOT_DEPLOYED'],
  ['nothing counts as deployed', Array.isArray(notDeployed.deployedOn) && notDeployed.deployedOn.length === 0],
  ['note keeps the aggregator path honest', typeof notDeployed.note === 'string' && notDeployed.note.includes('aggregator')]
]);

const unreachableOut = child(`
  import { pathToFileURL } from 'node:url';
  const m = await import(pathToFileURL(process.env.FBT_ROOT + '/server/feeRouterStatus.js'));
  const chains = await import(pathToFileURL(process.env.FBT_ROOT + '/src/lib/chains.js'));
  chains.EVM_CHAINS[56].rpc = ['http://127.0.0.1:1/dead'];
  const r = await m.feeRouterStatus({ perRpcTimeoutMs: 1500 });
  console.log('JSON=' + JSON.stringify(r));
`, { VITE_FEE_ROUTERS: JSON.stringify({ 56: A1 }) });
const unreachable = JSON.parse(unreachableOut.split('JSON=')[1]);

report('honest UNREACHABLE (RPCs do not answer)', [
  ['live check reports UNREACHABLE with the per-RPC error', unreachable.live?.['56']?.ok === false && unreachable.live?.['56']?.code === 'UNREACHABLE' && Array.isArray(unreachable.live?.['56']?.errors) && unreachable.live['56'].errors.length === 1],
  ['report still ok:true — an unreachable chain is a fact, not an endpoint failure', unreachable.ok === true]
]);

/* ════════════════════════════════════════════════════════════════════════ */
/* 3. the real HTTP route + the in-app AI tool registry                    */
/* ════════════════════════════════════════════════════════════════════════ */

const appMod = await import('../server/app.js');
const app = appMod.default;
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;

let httpOk = false;
let aiToolsOk = false;
let body = null;
try {
  const res = await fetch(base + '/api/fees/router-status');
  body = await res.json();
  httpOk = res.status === 200 && body?.ok === true && body?.schema === 'fbt.fee-router-status.v1';
  const aiRes = await fetch(base + '/api/v1/ai/tools');
  const ai = await aiRes.json();
  const tool = (ai?.tools || []).find((t) => t.id === 'feeRouter.status');
  aiToolsOk = Boolean(tool && tool.kind === 'read' && tool.live === true && tool.route === '/api/fees/router-status');
} catch (e) {
  console.log('  (route probe error: ' + e.message + ')');
} finally {
  server.close();
}

const appSrc = readFileSync(path.join(root, 'server', 'app.js'), 'utf8');
report('HTTP route + in-app AI wiring', [
  ['★ GET /api/fees/router-status answers on the real server', httpOk],
  ['no env in this process → the served report stays honest aggregator mode', body?.mode === 'aggregator' && Object.keys(body?.routers || {}).length === 0],
  ['served artifact hash matches the committed artifact', body?.artifact?.deployedBytecodeHash === expectedHash],
  ['the in-app AI tool registry lists feeRouter.status → the route', aiToolsOk],
  ['registry route is the literal registered in server/app.js (no dead route)', /app\.get\('\/api\/fees\/router-status'/.test(appSrc)]
]);

/* ════════════════════════════════════════════════════════════════════════ */
/* 4. fbt-mcp — the external AI bridge                                     */
/* ════════════════════════════════════════════════════════════════════════ */

const { TOOLS, FORBIDDEN_NAME_RE } = await import('../mcp/src/tools.mjs');
const mcpTool = TOOLS.find((t) => t.name === 'fbt_get_fee_router_status');
const mcpRouteMatch = mcpTool
  ? mcpTool.routes.every((route) => {
      const [method, p] = route.split(' ');
      const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`app\\.${method.toLowerCase()}\\('${escaped}'`).test(appSrc);
    })
  : false;

report('fbt-mcp (external AI agents)', [
  ['★ tool advertised to the bridge', Boolean(mcpTool)],
  ['public scope, no input — a status read is free of secrets', mcpTool?.scope === 'public' && Object.keys(mcpTool?.inputSchema?.properties || {}).length === 0],
  ['name stays inside the never-sign boundary', mcpTool ? !FORBIDDEN_NAME_RE.test(mcpTool.name) : false],
  ['advertised route is registered in server/app.js (no dead tool)', mcpRouteMatch]
]);

/* ── verdict ───────────────────────────────────────────────────────────── */
if (failed) {
  console.error(`\n${failed} FAILED\n`);
  process.exit(1);
}
console.log('\nAll FeeRouter-for-the-AI assertions passed.\n');
