/**
 * PHASE 71 — REAL AGENT SANDBOX
 * A promise is not a sandbox. Agents run behind a capability token, every call
 * is checked before it happens, and the first escape ends the run, is reported
 * and cuts the agent off.
 */
import { readFileSync } from 'node:fs';
import {
  mintCapabilityToken, checkCall, runInSandbox, applyAutoCut, assertContained,
  SANDBOX_SCHEMA, CAPABILITIES, FORBIDDEN_CAPABILITIES, TOKEN_TTL_MS, MAX_CALLS
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const mint = (over = {}) => mintCapabilityToken({
  agentId: 'agent-1', capabilities: ['read:market', 'compute', 'net:fetch'],
  allowedHosts: ['api.example.com'], now: NOW, ...over
});

try {
  /* ---------- tokens are narrow ---------- */
  const minted = mint();
  check('a narrow token is minted', minted.ok === true && minted.token.schema === SANDBOX_SCHEMA);
  check('the token expires', minted.token.expiresAt === NOW + TOKEN_TTL_MS);
  check('the token is frozen', Object.isFrozen(minted.token));
  check('the token has a call budget', minted.token.maxCalls <= MAX_CALLS);
  check('a token NEVER authorizes execution', minted.token.executionAuthorized === false);
  check('a signing capability is refused at mint time', mint({ capabilities: ['sign'] }).ok === false);
  check('a submit capability is refused', mint({ capabilities: ['submit'] }).ok === false);
  check('a wildcard capability is refused', mint({ capabilities: ['*'] }).ok === false);
  check('every forbidden capability is refused',
    FORBIDDEN_CAPABILITIES.every((c) => mint({ capabilities: [c] }).ok === false));
  check('an invented capability is refused', mint({ capabilities: ['read:everything'] }).ok === false);
  check('an empty token is refused', mint({ capabilities: [] }).ok === false);
  check('a token with no agent is refused', mint({ agentId: null }).ok === false);
  check('the refusal is a translatable key', mint({ capabilities: ['sign'] }).i18nKey === 'intentAI.sandbox.capabilityRefused');
  check('the granted capabilities are all known', minted.token.capabilities.every((c) => CAPABILITIES.includes(c)));

  /* ---------- calls are checked before they happen ---------- */
  check('a granted capability is allowed', checkCall(minted.token, { capability: 'compute', now: NOW }).allowed === true);
  check('an ungranted capability is an escape attempt',
    checkCall(minted.token, { capability: 'propose:intent', now: NOW }).escape === true);
  check('a forbidden capability is an escape attempt',
    checkCall(minted.token, { capability: 'sign', now: NOW }).escape === true);
  check('an allowed host is allowed', checkCall(minted.token, { capability: 'net:fetch', host: 'api.example.com', now: NOW }).allowed === true);
  check('a foreign host is an escape', checkCall(minted.token, { capability: 'net:fetch', host: 'evil.example.net', now: NOW }).escape === true);
  check('a fetch with no host is an escape', checkCall(minted.token, { capability: 'net:fetch', now: NOW }).escape === true);
  check('an expired token allows nothing', checkCall(minted.token, { capability: 'compute', now: NOW + TOKEN_TTL_MS + 1 }).allowed === false);
  check('the expiry is not called an escape', checkCall(minted.token, { capability: 'compute', now: NOW + TOKEN_TTL_MS + 1 }).escape === false);
  check('a hand-made token allows nothing', checkCall({ capabilities: ['sign'] }, { capability: 'sign', now: NOW }).allowed === false);
  check('an allowed call still authorizes no execution', checkCall(minted.token, { capability: 'compute', now: NOW }).executionAuthorized === false);

  /* ---------- a clean run ---------- */
  const clean = await runInSandbox({
    token: minted.token,
    agent: async () => ({ proposal: { kind: 'swap', amount: 10 } }),
    calls: [{ capability: 'read:market' }, { capability: 'compute' }, { capability: 'net:fetch', host: 'api.example.com' }],
    now: NOW
  });
  check('a compliant agent runs', clean.ok === true && clean.escaped === false);
  check('the run is traced call by call', clean.trace.length === 3 && clean.trace.every((t) => t.allowed === true));
  check('the output comes back', clean.output.proposal.kind === 'swap');
  check('a clean run is never cut', clean.cut === false);
  check('even a clean run authorizes nothing', clean.executionAuthorized === false);
  check('a clean run still needs the confirmation gate', clean.requiresConfirmationGate === true);
  check('the completion is a translatable key', clean.i18nKey === 'intentAI.sandbox.completed');
  check('the clean run is contained', assertContained(clean).contained === true);

  /* ---------- escapes ---------- */
  const escaped = await runInSandbox({
    token: minted.token,
    agent: async () => ({ ok: true }),
    calls: [{ capability: 'read:market' }, { capability: 'sign' }, { capability: 'compute' }],
    now: NOW
  });
  check('an escape attempt ends the run', escaped.ok === false && escaped.escaped === true);
  check('the agent is cut automatically', escaped.cut === true);
  check('the remaining calls never run', escaped.attemptedRemaining === 1 && escaped.trace.length === 2);
  check('the escape is reported as an incident', escaped.incident.reportable === true && escaped.incident.action === 'AGENT_CUT');
  check('the incident names the agent and the reason', escaped.incident.agentId === 'agent-1' && escaped.incident.reason === 'FORBIDDEN_CAPABILITY');
  check('the incident is frozen', Object.isFrozen(escaped.incident));
  check('the escape is a translatable key', escaped.i18nKey === 'intentAI.sandbox.escape');
  const hostEscape = await runInSandbox({ token: minted.token, calls: [{ capability: 'net:fetch', host: 'evil.example.net' }], now: NOW });
  check('reaching a foreign host is an escape', hostEscape.escaped === true && hostEscape.cut === true);
  const budget = await runInSandbox({ token: minted.token, calls: Array.from({ length: MAX_CALLS + 1 }, () => ({ capability: 'compute' })), now: NOW });
  check('blowing the call budget is an escape', budget.escaped === true && budget.reason === 'CALL_BUDGET_EXCEEDED');
  const claimsAuthority = await runInSandbox({
    token: minted.token, agent: async () => ({ executionAuthorized: true }), calls: [{ capability: 'compute' }], now: NOW
  });
  check('an agent returning executionAuthorized is treated as an escape', claimsAuthority.escaped === true);
  check('the authority claim is cut and reported', claimsAuthority.cut === true && claimsAuthority.incident.reason === 'AGENT_CLAIMED_AUTHORITY');
  check('the run never passes the claim through', claimsAuthority.executionAuthorized === false);
  const threw = await runInSandbox({ token: minted.token, agent: async () => { throw new Error('boom'); }, calls: [{ capability: 'compute' }], now: NOW });
  check('an agent that throws does not crash us', threw.ok === false && threw.reason === 'AGENT_THREW');
  const slow = await runInSandbox({
    token: minted.token, agent: () => new Promise((r) => { setTimeout(() => r({ late: true }), 500); }),
    calls: [{ capability: 'compute' }], maxRuntimeMs: 20, now: NOW
  });
  check('an agent that hangs is cut on the deadline', slow.reason === 'AGENT_TIMEOUT' && slow.cut === true);
  check('running without a token does nothing', (await runInSandbox({ calls: [{ capability: 'compute' }], now: NOW })).ok === false);

  /* ---------- auto-cut persists ---------- */
  const cut = applyAutoCut({ agentId: 'agent-1', incidents: [escaped.incident, claimsAuthority.incident], now: NOW });
  check('an agent with incidents is suspended', cut.suspended === true && cut.incidentCount === 2);
  check('reinstating needs a human', cut.reinstateRequiresHuman === true);
  check('the reasons are kept', cut.reasons.includes('FORBIDDEN_CAPABILITY'));
  check('the suspension is a translatable notice', cut.i18nKey === 'intentAI.sandbox.suspended');
  check('a clean agent is not suspended', applyAutoCut({ agentId: 'agent-2', incidents: [escaped.incident], now: NOW }).suspended === false);

  /* ---------- the containment guard ---------- */
  check('the guard catches a run claiming authority',
    assertContained({ ...clean, executionAuthorized: true }).reasons.includes('RUN_CLAIMS_AUTHORITY'));
  check('the guard catches an escape that was not cut',
    assertContained({ ...escaped, cut: false }).reasons.includes('ESCAPE_WITHOUT_CUT'));
  check('the guard catches an unreported escape',
    assertContained({ ...escaped, incident: null }).reasons.includes('ESCAPE_NOT_REPORTED'));
  check('the guard catches a denied call that did not cut',
    assertContained({ ...escaped, escaped: false, cut: false, incident: null }).reasons.includes('DENIED_CALL_WITHOUT_CUT'));
  check('the guard rejects a non-run', assertContained({ trace: [] }).ok === false);
  check('a real escape run is still reported as contained-and-cut', assertContained(escaped).ok === true);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the sandbox copy is translated in en, fa and ar',
    locales.every((loc) => ['completed', 'denied', 'escape', 'failed', 'capabilityRefused', 'suspended']
      .every((k) => typeof loc?.intentAI?.sandbox?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase71-agent-sandbox', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
