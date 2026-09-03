/**
 * FBT REWARDS API PROBE — the HTTP surface under /api/v1/rewards.
 * ---------------------------------------------------------------------------
 * Boots the real router (real server/store.js KV — in-memory, no blob) on an
 * ephemeral port and exercises the contract the dashboard depends on:
 *
 *   · GET /summary aggregates the dashboard in one call
 *   · POST /events credits once and replays as duplicates
 *   · unknown actions and missing device scope are refused with codes
 *   · /level, /missions, /referral, /eligibility answer the documented shape
 *   · /claim/prepare is honestly NOT_LAUNCHED until a distributor is set
 *
 * No external network: swap events here carry no txHash, which the engine
 * accepts under its lenient tier (documented in config.js) — the strict
 * on-chain path is exercised by the engine probe with an injected verifier.
 */
import express from 'express';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { rewardsRouter } = await import('../server/rewards/index.js');

const app = express();
app.use(express.json());
app.use('/api/v1/rewards', rewardsRouter());

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}/api/v1/rewards`;
const DEVICE = 'probe-device-abcdef1234567890';

async function call(path, { method = 'GET', body = null, device = DEVICE } = {}) {
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(device ? { 'x-fbt-device': device } : {}),
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (err) {
    return { status: 0, body: null, error: err.message };
  }
  let payload = null;
  try { payload = await response.json(); } catch { /* no body */ }
  return { status: response.status, body: payload };
}

try {
  /* empty summary */
  const s0 = await call('/summary');
  t('GET /summary answers with a zeroed ledger', s0.status === 200
    && s0.body?.ok === true
    && s0.body.data.points === 0
    && s0.body.data.level?.current?.id === 'bronze'
    && s0.body.data.claim?.status === 'NOT_LAUNCHED'
    && s0.body.data.fbt?.market === 'not_launched'
    && Array.isArray(s0.body.data.missions?.today)
    && Array.isArray(s0.body.meta?.limitations));

  /* missing scope refused */
  const noScope = await call('/summary', { device: null });
  t('missing device scope is refused with a code', noScope.status === 400 && noScope.body?.error === 'DEVICE_SCOPE_REQUIRED');

  /* ingest one real swap (lenient tier — no txHash in this probe) */
  const ev1 = { id: 'http-swap-1', action: 'swap', at: Date.now() };
  const e1 = await call('/events', { method: 'POST', body: { events: [ev1] } });
  t('POST /events credits a swap and reports the new total', e1.status === 200
    && e1.body.data.results[0]?.credited === true
    && e1.body.data.points === 11);

  /* same event again → duplicate, total unchanged */
  const e2 = await call('/events', { method: 'POST', body: { events: [ev1] } });
  t('POST /events replays as a duplicate without double reward', e2.status === 200
    && e2.body.data.results[0]?.duplicate === true
    && e2.body.data.points === 11);

  /* summary reflects it */
  const s1 = await call('/summary');
  t('GET /summary reflects the credited swap + mission', s1.body.data.points === 11
    && s1.body.data.missions.today.find((m) => m.id === 'swap1')?.done === true
    && s1.body.data.history.length >= 1);

  /* level endpoint */
  const lvl = await call('/level');
  t('GET /level returns points + level shape', lvl.body.data.points === 11 && lvl.body.data.current?.id === 'bronze' && lvl.body.data.next?.id === 'silver');

  /* missions endpoint */
  const mis = await call('/missions');
  t('GET /missions returns today + milestones + achievements', mis.body.data.today.length > 0 && Array.isArray(mis.body.data.milestones) && Array.isArray(mis.body.data.achievements));

  /* referral */
  const ref = await call('/referral');
  t('GET /referral reports an unbound code state', ref.body.data.code === null && ref.body.data.bound === false && ref.body.data.total === 0);

  const bindNoSig = await call('/referral/bind', { method: 'POST', body: { code: 'HTTP9X', wallet: '0x1111111111111111111111111111111111111111' } });
  t('POST /referral/bind without a signature is refused', bindNoSig.status === 400 && bindNoSig.body?.error === 'SIGNATURE_REQUIRED');

  /* unknown action */
  const bad = await call('/events', { method: 'POST', body: { events: [{ id: 'x-1', action: 'teleport' }] } });
  t('POST /events refuses an unknown action', bad.status === 200 && bad.body.data.results[0]?.code === 'UNKNOWN_ACTION');

  /* eligibility + claim honesty */
  const elig = await call('/eligibility');
  t('GET /eligibility reports NOT_LAUNCHED while no distributor exists', elig.body.data.claim?.status === 'NOT_LAUNCHED' && elig.body.data.claim?.eligible === false);

  const prep = await call('/claim/prepare', { method: 'POST', body: { wallet: '0x1111111111111111111111111111111111111111' } });
  t('POST /claim/prepare is honestly NOT_LAUNCHED', prep.status === 409 && prep.body?.error === 'FBT_TOKEN_NOT_LAUNCHED');

  /* second account is isolated */
  const other = await call('/summary', { device: 'another-device-zzzz999999999999' });
  t('accounts are isolated from each other', other.body.data.points === 0);
} finally {
  server.close();
}

const invokedDirectly = Boolean(process.argv?.[1] && process.argv[1].endsWith('rewards-api-probe.mjs'));
if (invokedDirectly) {
  const fails = rows.filter(([, ok]) => !ok);
  for (const [name, ok] of rows) console.log(`  ${ok ? '\u2713' : '\u2717'} ${name}`);
  console.log(`\npassed ${rows.length - fails.length}/${rows.length}`);
  process.exitCode = fails.length ? 1 : 0;
}

export default rows;
