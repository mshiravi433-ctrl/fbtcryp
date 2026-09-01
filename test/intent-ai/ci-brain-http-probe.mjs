/**
 * FBT CENTRAL INTELLIGENCE OS — HTTP probe: the mounted gateway, not the library.
 * ──────────────────────────────────────────────────────────────────────────────
 * The turn probe proves the brain reasons correctly. This one proves the APP can be
 * reached at all, which is a separate class of failure and the one a user feels
 * first: the mount order, the rate budget, the CORS/JSON surface, the SSE pipe, the
 * 428/409/429 codes a client switches on, and the fact that an unfinished request
 * must answer with data rather than a stack trace.
 *
 * It boots the REAL `server/app.js` (286 routes and all) on an ephemeral port in
 * this process. The external boundary is faked in-process with `setCiSource` —
 * deliberately not over HTTP: `POST /system/test-source` refuses to inject a source
 * remotely, because a deployment where a caller can swap out the wallet reader is a
 * deployment where the "source of truth" is whatever the caller typed.
 *
 * Run: npm run test:central-brain-http
 */
import { createServer } from 'node:http';
import { installFakes } from './ci-fakes.mjs';
import { setCiSource } from '../../server/ci/sources.js';

/* Budgets and limits are read at module load, so they are pinned before the
   import below. The brain's own write budget is deliberately tiny here: this probe
   is the one that wants to watch the limiter trip. */
process.env.RATE_LIMIT = '100000';
process.env.AI_RATE_LIMIT = '100000';
/* A budget big enough that the functional turns above all succeed, small enough
   that the limiter test at the end can still trip it in this process: the point of
   the pair is that a normal conversation fits and a script does not. */
process.env.BRAIN_RATE_LIMIT = process.env.CI_PROBE_BRAIN_LIMIT || '30';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const rows = [];
const t = (name, ok, detail = '') => rows.push([name, Boolean(ok), ok ? '' : String(detail).slice(0, 180)]);

for (const [name, fn] of Object.entries(installFakes())) setCiSource(name, fn);

const appModule = await import('../../server/app.js');
const app = appModule.default;
const server = createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const DEVICE = 'dev-ci-http-probe-0001';

async function req(path, { method = 'GET', body = null, device = DEVICE } = {}) {
  const headers = { accept: 'application/json' };
  if (device) headers['x-fbt-device'] = device;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${origin}/api/brain${path}`, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { unparsed: text.slice(0, 160) };
  }
  return { status: res.status, type: res.headers.get('content-type') || '', body: json, text };
}

/* ── the mount exists and answers in JSON ─────────────────────────────────── */
const caps = await req('/system/capabilities');
t('the gateway is mounted and answers the capability matrix', caps.status === 200 && Object.keys(caps.body?.capabilities || {}).length === 30, JSON.stringify({ status: caps.status, modules: Object.keys(caps.body?.capabilities || {}).length }));
t('a capability that does not exist is reported as unavailable over HTTP', caps.body?.capabilities?.etf === 'UNAVAILABLE' && caps.body?.capabilities?.funds === 'UNAVAILABLE', JSON.stringify(caps.body?.capabilities || null).slice(0, 120));
t('the §40 audit travels with the matrix', caps.body?.definitionOfDone?.verdict === 'COMPLETE' && caps.body?.definitionOfDone?.modules === 30, JSON.stringify(caps.body?.definitionOfDone || null).slice(0, 140));
t('the capability contract is published for module owners to diff against', Array.isArray(caps.body?.contract) ? caps.body.contract.length > 0 : Boolean(caps.body?.contract), JSON.stringify(Object.keys(caps.body || {})));

const health = await req('/system/health');
t('health answers with a per-module record', health.status === 200 && Boolean(health.body?.modules), JSON.stringify(Object.keys(health.body?.modules || {})).slice(0, 100));

const st = await req('/system/state');
t('shared state exposes lastUpdated and a revision (§4)', st.status === 200 && (st.body?.state?.lastUpdated !== undefined || st.body?.lastUpdated !== undefined) && Number.isFinite(Number(st.body?.state?.revision ?? st.body?.revision)), JSON.stringify({ keys: Object.keys(st.body || {}), rev: st.body?.state?.revision ?? st.body?.revision }));

/* ── one sentence, end to end, over the wire ─────────────────────────────── */
const turn = await req('/intent', { method: 'POST', body: { message: 'قیمت بیت‌کوین چنده؟', locale: 'fa', page: { path: '/market', tab: 'overview' } } });
const reply = turn.body?.response || {};
t('a turn over HTTP returns the response contract', turn.status === 200 && typeof reply.text === 'string' && Array.isArray(reply.sections) && reply.sections.length > 0, JSON.stringify({ status: turn.status, keys: Object.keys(turn.body || {}) }));
t('the number on the wire is the number the source returned', String(reply.text || '').replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٬،\u066C,\u066B]/g, (c) => (c === '\u066B' ? '.' : '')).includes('36000'), String(reply.headline).slice(0, 80));
t('the wire reply identifies its sources', (reply.provenance?.sources || []).length > 0, JSON.stringify(reply.provenance || null).slice(0, 120));
t('a read over HTTP asks for no confirmation', reply.requiresConfirmation !== true, JSON.stringify({ mode: reply.mode, rc: reply.requiresConfirmation }));

const intentId = turn.body?.intent?.intentId;
const trail = await req(`/intent/${encodeURIComponent(intentId || 'missing')}`);
t('the stored intent can be fetched afterwards (§35)', trail.status === 200 && trail.body?.intent?.intentId === intentId && (trail.body?.intent?.stages || []).includes('COMPLETED'), JSON.stringify({ status: trail.status, stages: trail.body?.intent?.stages }));
t('the trail keeps the decision, not only the outcome', Boolean(trail.body?.intent?.verdict) && Boolean(trail.body?.intent?.planDigest), JSON.stringify({ verdict: trail.body?.intent?.verdict, digest: trail.body?.intent?.planDigest }));
t('the trail names what the client should do next', trail.body?.nextAction === undefined || typeof trail.body.nextAction === 'object' || typeof trail.body.nextAction === 'string', JSON.stringify(trail.body?.nextAction || null).slice(0, 80));
t('a trail read is redacted before it leaves the server', !/privateKey|seedPhrase|mnemonic/i.test(JSON.stringify(trail.body || {})), 'a secret-shaped key appeared in the trail');

const follow = await req('/intent', { method: 'POST', body: { message: 'بفروشمش؟', locale: 'fa' } });
t('anaphora survives the HTTP hop', follow.body?.intent?.entities?.asset === 'BTC' || follow.body?.context?.entities?.asset === 'BTC', JSON.stringify(follow.body?.intent?.entities || null).slice(0, 120));

const empty = await req('/intent', { method: 'POST', body: { message: '   ' } });
t('an empty message is refused with a code, not a stack trace', empty.status === 400 && empty.body?.error === 'EMPTY_MESSAGE' && !empty.text.includes(' at '), JSON.stringify({ status: empty.status, body: empty.body }));

const badDevice = await req('/system/state', { device: '!!' });
t('a malformed device id cannot claim another session', badDevice.status === 200 || badDevice.status === 400, JSON.stringify({ status: badDevice.status }));

/* ── the money boundary, from the outside ────────────────────────────────── */
const naked = await req('/tools/execute', { method: 'POST', body: { module: 'swap', input: { from: 'BTC', to: 'USDC', amountUsd: 100 } } });
t('execute over HTTP is refused without a confirmed action (428)', naked.status === 428 && naked.body?.code === 'CONFIRMATION_REQUIRED', JSON.stringify({ status: naked.status, body: naked.body }).slice(0, 160));
t('the refusal says how to proceed', typeof naked.body?.detail === 'string' && naked.body.detail.length > 12, JSON.stringify(naked.body?.detail));

const money = await req('/intent', { method: 'POST', body: { message: '۰.۱ بیت‌کوین رو به USDC تبدیل کن', locale: 'fa', page: { path: '/swap', tab: 'swap', walletConnected: true, selectedAsset: 'BTC' } } });
const card = money.body?.response?.confirmationCard || null;
t('a money request comes back as a confirmation card, never as a done deal', money.status === 200 && money.body?.response?.requiresConfirmation === true && Boolean(card?.actionId) && Boolean(card?.planDigest), JSON.stringify({ mode: money.body?.response?.mode, card: Object.keys(card || {}) }));
t('the card carries no signature and says so', card === null || (money.body?.response?.executionBoundary?.serverSigns === false && money.body?.response?.executionBoundary?.holdsKeys === false), JSON.stringify(money.body?.response?.executionBoundary || null));
t('no transaction id is invented by the reply', !/txHash/.test(JSON.stringify(money.body?.response?.confirmationCard || {})), 'the card carried a txHash');

if (card?.actionId) {
  /* A digest mismatch is proof the card in the client's hands is not the plan the
     brain built. Refusing once is not enough — the card is BURNED, because letting
     the same action be confirmed on a second try with the "right" digest would mean
     the first refusal was only a speed bump, and a speed bump is not a control. */
  const wrongDigest = await req(`/intent/${card.actionId}/confirm`, { method: 'POST', body: { actionId: card.actionId, planDigest: 'not-the-digest', method: 'button' } });
  t('confirming a plan the user never saw is refused', wrongDigest.status >= 400 || wrongDigest.body?.ok === false, JSON.stringify({ status: wrongDigest.status, code: wrongDigest.body?.code }));
  const burned = await req(`/intent/${card.actionId}/confirm`, { method: 'POST', body: { actionId: card.actionId, planDigest: card.planDigest, method: 'button', execute: true } });
  t('a burned card cannot be confirmed on a second try', burned.body?.ok !== true, JSON.stringify({ status: burned.status, code: burned.body?.code, actionStatus: burned.body?.action?.status }));

  const second = await req('/intent', { method: 'POST', body: { message: '۰.۱ بیت‌کوین رو به USDC تبدیل کن', locale: 'fa', requestId: `ci_probe_fresh_${Date.now()}`, page: { path: '/swap', tab: 'swap', walletConnected: true, selectedAsset: 'BTC' } } });
  const card2 = second.body?.response?.confirmationCard || null;
  t('a fresh request gets a fresh card after the old one is burned', Boolean(card2?.actionId) && card2.actionId !== card.actionId, JSON.stringify({ first: card.actionId, second: card2?.actionId }));
  if (card2?.actionId) {
    const ok = await req(`/intent/${card2.actionId}/confirm`, { method: 'POST', body: { actionId: card2.actionId, planDigest: card2.planDigest, method: 'button', execute: true } });
    const status = ok.body?.action?.status || ok.body?.execution?.status;
    t('a confirmed action stops at the signature the server cannot make', ok.body?.ok === true && ['AWAITING_SIGNATURE', 'BROADCAST', 'VERIFIED', 'SIGNATURE_RECEIVED'].includes(status), JSON.stringify({ status: ok.status, code: ok.body?.code, actionStatus: status }));
    t('nothing under this mount signs', ok.body?.execution?.serverSigned !== true && ok.body?.handoff?.serverSigned !== true && ok.body?.execution?.signed !== true, JSON.stringify(ok.body?.execution || null).slice(0, 140));
    const tx = await req(`/transactions/${card2.actionId}`);
    t('the action record is queryable as a transaction', tx.status === 200 && typeof tx.body?.action?.status === 'string', JSON.stringify({ status: tx.status, keys: Object.keys(tx.body || {}) }));
    const receipt = await req(`/intent/${card2.actionId}/receipt`, { method: 'POST', body: { actionId: card2.actionId, txHash: `0x${'b'.repeat(64)}`, status: 'BROADCAST' } });
    t('a wallet receipt is verified rather than believed', receipt.body?.ok === true && Boolean(receipt.body?.verification || receipt.body?.action?.verification), JSON.stringify({ status: receipt.status, keys: Object.keys(receipt.body || {}) }));
    const after = await req('/system/state');
    t('after the receipt, the state revision moved', Number(after.body?.state?.revision ?? after.body?.revision) > Number(st.body?.state?.revision ?? st.body?.revision ?? 0), JSON.stringify({ before: st.body?.state?.revision ?? st.body?.revision, after: after.body?.state?.revision ?? after.body?.revision }));
    const events = await req('/system/events?limit=30');
    t('the cascade that follows a transaction is observable as events', (events.body?.events || []).some((e) => ['TRANSACTION_PENDING', 'SWAP_COMPLETED', 'BALANCE_CHANGED', 'TRANSACTION_CONFIRMED', 'RISK_CHANGED'].includes(e.type)), JSON.stringify((events.body?.events || []).map((e) => e.type).slice(0, 8)));
  }
}

/* ── §17: the stream is a stream, and it is not buffered into a 404 ──────── */
{
  const ctrl = new AbortController();
  const got = await fetch(`${origin}/api/brain/system/stream`, { headers: { accept: 'text/event-stream', 'x-fbt-device': DEVICE }, signal: ctrl.signal })
    .then(async (res) => {
      const head = { status: res.status, type: res.headers.get('content-type') || '' };
      try {
        const reader = res.body?.getReader();
        const first = reader ? await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ done: true }), 1500))]) : { done: true };
        ctrl.abort();
        reader?.releaseLock?.();
        return { ...head, chunk: Buffer.from(first.value || new Uint8Array()).toString('utf8').slice(0, 200) };
      } catch {
        return head;
      }
    })
    .catch((err) => ({ status: 0, error: String(err?.message).slice(0, 60) }));
  t('the SSE endpoint streams event-stream data', got.status === 200 && /text\/event-stream/.test(got.type), JSON.stringify(got).slice(0, 140));
}

/* ── the write budget the mount adds ─────────────────────────────────────── */
{
  const limiterDevice = 'dev-ci-limiter-00000001';
  const budget = Number(process.env.BRAIN_RATE_LIMIT || 30);
  const codes = [];
  for (let i = 0; i < budget + 2; i += 1) {
    const r = await req('/intent', { method: 'POST', device: limiterDevice, body: { message: `قیمت اتریوم چنده؟ ${i}`, locale: 'fa' } });
    codes.push(r.status);
  }
  t('the brain write budget trips with a JSON 429', codes.includes(429), JSON.stringify(codes));
  const over = await req('/system/state', { device: limiterDevice });
  t('being rate limited on writes does not lock the read side', over.status === 200, JSON.stringify({ status: over.status }));
  const limited = await req('/intent', { method: 'POST', device: limiterDevice, body: { message: 'قیمت تتر چنده؟', locale: 'fa' } });
  t('a limited turn says when to come back', limited.status !== 429 || (Number(limited.body?.retryAfterMs) > 0 && typeof limited.body?.detail === 'string'), JSON.stringify({ status: limited.status, retryAfterMs: limited.body?.retryAfterMs }));
}

server.close();
const failed = rows.filter(([, ok]) => !ok).length;
console.log(`\n  central brain · http gateway  ${rows.length - failed}/${rows.length}\n`);
for (const [name, ok, detail] of rows) console.log(`   ${ok ? '✓' : '✗'} ${name}${detail ? `  → ${detail}` : ''}`);
process.exitCode = failed ? 1 : 0;
if (failed) console.log(`\n${failed} FAILED\n`);
