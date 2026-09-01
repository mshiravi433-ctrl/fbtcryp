/**
 * FBT INTENT OS — Execution-First System Prompt (v2.0) contract probe.
 * ---------------------------------------------------------------------------
 * Locks the governing spec into the runtime so it cannot be silently dropped:
 *
 *   1. the versioned, seven-stage execution chain,
 *   2. all 51 numbered rules survive as machine-readable invariants,
 *   3. the system prompt is state-aware and fail-closed (never invents a
 *      connection or balance, never instructs guaranteed profit),
 *   4. the backend exposes the contract over HTTP (§49: backend states,
 *      frontend renders) and the chat reply carries the contract version.
 */
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

import http from 'node:http';
import app from '../../server/app.js';
import {
  INTENT_OS_PROMPT_VERSION,
  INTENT_OS_CONTRACT,
  INTENT_OS_RULES,
  EXECUTION_CHAIN,
  ULTIMATE_CHAIN,
  RESPONSE_MODES,
  CAPABILITY_STATUSES,
  FORBIDDEN_PHRASES,
  buildSystemPrompt
} from '../../src/lib/intent-ai/os/systemPrompt.js';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  /* ---------- 1. version + chains ---------- */
  t('contract version is the execution-first v2.0', INTENT_OS_PROMPT_VERSION === 'fbt.intent-os.execution-first.v2.0');
  t('execution chain has the 7 required stages in order',
    JSON.stringify(EXECUTION_CHAIN) === JSON.stringify(['UNDERSTAND', 'INSPECT', 'PLAN', 'CONFIRM', 'EXECUTE', 'VERIFY', 'REPORT']));
  t('ultimate chain starts with USER and ends with REPORT_RESULT',
    ULTIMATE_CHAIN[0] === 'USER' && ULTIMATE_CHAIN[ULTIMATE_CHAIN.length - 1] === 'REPORT_RESULT');
  t('response modes are exactly ANSWER/ACTION/QUESTION/ERROR_AND_RECOVERY',
    JSON.stringify(RESPONSE_MODES) === JSON.stringify(['ANSWER', 'ACTION', 'QUESTION', 'ERROR_AND_RECOVERY']));
  t('capability statuses are AVAILABLE/DEGRADED/READ_ONLY/UNAVAILABLE',
    JSON.stringify(CAPABILITY_STATUSES) === JSON.stringify(['AVAILABLE', 'DEGRADED', 'READ_ONLY', 'UNAVAILABLE']));

  /* ---------- 2. all 51 rules survive ---------- */
  t('all 51 numbered rules are present', INTENT_OS_RULES.length === 51);
  t('rule ids are unique and cover 1..51',
    new Set(INTENT_OS_RULES.map((r) => r.id)).size === 51
    && INTENT_OS_RULES.every((r) => r.id >= 1 && r.id <= 51));
  t('the key absolutes exist as rules (no bypass, anti-hallucination, no guaranteed profit)',
    INTENT_OS_RULES.some((r) => r.key === 'never_bypass_security')
    && INTENT_OS_RULES.some((r) => r.key === 'anti_hallucination')
    && INTENT_OS_RULES.some((r) => r.key === 'no_guaranteed_profit')
    && INTENT_OS_RULES.some((r) => r.key === 'action_permission'));
  t('contract reports the correct rule count', INTENT_OS_CONTRACT.ruleCount === 51);

  /* ---------- 3. state-aware, fail-closed prompt ---------- */
  const fa = buildSystemPrompt({ locale: 'fa' });
  t('persian prompt carries the execution chain', EXECUTION_CHAIN.every((s) => fa.includes(s)));
  t('persian prompt forbids guaranteed profit and hallucination', fa.includes('سود تضمینی') && fa.includes('هرگز'));
  const en = buildSystemPrompt({ locale: 'en' });
  t('english prompt carries the chain and honesty absolutes',
    en.includes('FBT Intent OS') && en.includes('guaranteed') && en.includes('explicit user confirmation'));

  /* No state passed → must say "not inspected", and must NOT claim connected. */
  const uninspected = buildSystemPrompt({ locale: 'en' });
  t('without inspected state the prompt refuses to claim connected',
    /NOT inspected/.test(uninspected) && !/Wallet state: CONNECTED/.test(uninspected));

  /* Disconnected wallet → plain DISCONNECTED, no fake balance. */
  const off = buildSystemPrompt({ locale: 'en', state: { wallet: { connected: false } } });
  t('disconnected wallet is stated plainly (DISCONNECTED)',
    /DISCONNECTED/.test(off) && !/CONNECTED \(/.test(off));
  const offFa = buildSystemPrompt({ locale: 'fa', state: { wallet: { connected: false } } });
  t('disconnected wallet in persian says غیرمتصل and never متصل است',
    offFa.includes('غیرمتصل') && !offFa.includes('متصل است'));

  /* Connected wallet → report exactly what was inspected, nothing invented. */
  const on = buildSystemPrompt({
    locale: 'en',
    state: { wallet: { connected: true, address: '0xABCDEF', chain: 'Arbitrum' } }
  });
  t('connected wallet reports the inspected address and chain',
    on.includes('0xABCDEF') && on.includes('Arbitrum') && /Wallet state: CONNECTED/.test(on));

  /* The ban list itself is carried so callers can enforce it. */
  t('the banned canned-reply / profit phrases are enumerated',
    Array.isArray(FORBIDDEN_PHRASES) && FORBIDDEN_PHRASES.length >= 8
    && FORBIDDEN_PHRASES.includes('guaranteed return'));

  /* ---------- 4. backend contract over HTTP ---------- */
  const res = await fetch(`${base}/api/v1/ai/system-prompt`);
  const json = await res.json().catch(() => ({}));
  t('GET /api/v1/ai/system-prompt returns ok with the v2.0 contract',
    res.status === 200 && json.ok === true
    && json.version === INTENT_OS_PROMPT_VERSION
    && Array.isArray(json.executionChain)
    && json.executionChain.length === 7
    && json.rules?.length === 51
    && typeof json.systemPrompt === 'string'
    && typeof json.systemPromptEn === 'string');
  t('system-prompt endpoint exposes the rule absolutes',
    Array.isArray(json.rules) && json.rules.some((r) => r.key === 'never_bypass_security'));

  const chatRes = await fetch(`${base}/api/v1/ai/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fbt-device': 'fbtintentosprobe0001' },
    body: JSON.stringify({ message: 'سلام', locale: 'fa' })
  });
  const chatJson = await chatRes.json().catch(() => ({}));
  t('chat reply carries the governing contract version and chain',
    chatRes.status === 200
    && chatJson.reply?.contract?.version === INTENT_OS_PROMPT_VERSION
    && Array.isArray(chatJson.reply?.contract?.executionChain)
    && chatJson.reply.contract.executionChain.length === 7);
} catch (error) {
  t('probe completed without throwing', false);
  console.error(error);
} finally {
  server.close();
}

const failed = rows.filter((r) => !r[1]).length;
console.log(`▸ execution-first v2.0: ${rows.length - failed}/${rows.length} contract checks passed`);
if (failed > 0) process.exitCode = 1;

export default rows;
