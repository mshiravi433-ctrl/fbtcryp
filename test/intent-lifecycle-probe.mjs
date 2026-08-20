/**
 * INTENT LIFECYCLE PROBE
 * ---------------------------------------------------------------------------
 * The state machine is the thing that stands between "the user approved this"
 * and "the wallet signed that". These cases lock the properties that make the
 * difference impossible to lose:
 *
 *   · every declared transition is legal and every undeclared one is refused
 *   · a repeat of the current status is idempotent and does not bump sequence
 *   · sequence is monotonic
 *   · terminal states have no exit — FAILED/CANCELLED can never reach COMPLETED
 *   · a passed deadline expires the record and blocks execution
 *   · a pre-lifecycle intent migrates to a safe, non-executable status
 *   · a route/amount/chain/recipient/slippage change de-authorises the review
 *   · no signer, provider, calldata or address is ever persisted
 */

function mockLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null
  };
}

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  mockLocalStorage();
  const lc = await import('../src/lib/intentLifecycle.js');

  /* ---------------------------- 1. shape ---------------------------------- */
  t('schema is fbt.intent-lifecycle.v1', lc.INTENT_LIFECYCLE_SCHEMA === 'fbt.intent-lifecycle.v1');
  t('all 15 statuses are declared', lc.LIFECYCLE_STATUSES.length === 15);
  for (const status of [
    'CREATED', 'VALIDATING', 'VALIDATED', 'QUOTING', 'OPTIMIZING', 'SIMULATING',
    'AWAITING_APPROVAL', 'AWAITING_SIGNATURE', 'SUBMITTED', 'CONFIRMING',
    'COMPLETED', 'RECOVERABLE', 'FAILED', 'EXPIRED', 'CANCELLED'
  ]) {
    t(`status ${status} exists`, lc.LIFECYCLE_STATUSES.includes(status));
  }
  t('the transition table covers every status',
    lc.LIFECYCLE_STATUSES.every((s) => Array.isArray(lc.LIFECYCLE_TRANSITIONS[s])));
  t('every declared successor is itself a known status',
    lc.LIFECYCLE_STATUSES.every((s) =>
      lc.LIFECYCLE_TRANSITIONS[s].every((to) => lc.LIFECYCLE_STATUSES.includes(to))));

  /* --------------------- 2. the whole happy path -------------------------- */
  const now = 1_780_000_000_000;
  let record = lc.createLifecycle({ intentId: 'in_test_1', deadlineAt: now + 3_600_000, now });
  t('a new lifecycle starts at CREATED', record.status === 'CREATED');
  t('a new lifecycle has one event at sequence 0', record.events.length === 1 && record.sequence === 0);
  t('the first event carries schema/intentId/policyVersion',
    record.events[0].schema === lc.INTENT_LIFECYCLE_SCHEMA
    && record.events[0].intentId === 'in_test_1'
    && record.events[0].policyVersion === lc.LIFECYCLE_POLICY_VERSION);

  const happyPath = [
    'VALIDATING', 'VALIDATED', 'QUOTING', 'OPTIMIZING', 'SIMULATING',
    'AWAITING_SIGNATURE', 'SUBMITTED', 'CONFIRMING', 'COMPLETED'
  ];
  let step = 0;
  let monotonic = true;
  let previousSequence = record.sequence;
  for (const status of happyPath) {
    step += 1;
    const moved = lc.transition(record, status, { reasonCode: 'PROBE', now: now + step * 1000 });
    if (!moved.ok) { t(`transition to ${status} is legal`, false); break; }
    if (moved.record.sequence !== previousSequence + 1) monotonic = false;
    previousSequence = moved.record.sequence;
    record = moved.record;
  }
  t('the full happy path is legal end to end', record.status === 'COMPLETED');
  t('sequence increments by exactly one per transition', monotonic);
  t('every event has from/to/timestamp/reasonCode',
    record.events.every((e) => 'from' in e && e.to && e.timestamp && e.reasonCode));

  /* -------------------------- 3. fail closed ------------------------------ */
  const badFromCompleted = lc.transition(record, 'QUOTING', { now });
  t('COMPLETED is terminal', !badFromCompleted.ok && badFromCompleted.code === 'TERMINAL_STATE');

  let failed = lc.createLifecycle({ intentId: 'in_fail', now });
  failed = lc.transition(failed, 'VALIDATING', { now }).record;
  failed = lc.transition(failed, 'FAILED', { reasonCode: 'RECEIPT_FAILED', now }).record;
  const failedToCompleted = lc.transition(failed, 'COMPLETED', { now });
  t('FAILED can never become COMPLETED', !failedToCompleted.ok);
  t('FAILED declares no successors', lc.LIFECYCLE_TRANSITIONS.FAILED.length === 0);

  let cancelled = lc.createLifecycle({ intentId: 'in_cancel', now });
  cancelled = lc.transition(cancelled, 'CANCELLED', { now }).record;
  t('CANCELLED can never become COMPLETED', !lc.transition(cancelled, 'COMPLETED', { now }).ok);

  const jump = lc.transition(lc.createLifecycle({ intentId: 'in_jump', now }), 'SUBMITTED', { now });
  t('CREATED → SUBMITTED is refused', !jump.ok && jump.code === 'INVALID_TRANSITION');
  t('an unknown status is refused',
    lc.transition(lc.createLifecycle({ intentId: 'in_x', now }), 'TELEPORTED', { now }).code === 'UNKNOWN_STATUS');

  /* -------------------------- 4. idempotency ------------------------------ */
  let idem = lc.createLifecycle({ intentId: 'in_idem', now });
  idem = lc.transition(idem, 'VALIDATING', { now }).record;
  const repeat = lc.transition(idem, 'VALIDATING', { now: now + 5 });
  t('repeating the current status is idempotent', repeat.ok && repeat.idempotent === true);
  t('an idempotent transition does not bump the sequence', repeat.record.sequence === idem.sequence);
  t('an idempotent transition adds no event', repeat.record.events.length === idem.events.length);

  /* ---------------------------- 5. expiry --------------------------------- */
  let expiring = lc.createLifecycle({ intentId: 'in_exp', deadlineAt: now + 1000, now });
  expiring = lc.transition(expiring, 'VALIDATING', { now }).record;
  expiring = lc.transition(expiring, 'VALIDATED', { now }).record;
  const late = lc.transition(expiring, 'QUOTING', { now: now + 5000 });
  t('a transition after the deadline is refused', !late.ok && late.code === 'DEADLINE_PASSED');
  t('a past-deadline record is moved to EXPIRED', late.record.status === 'EXPIRED');
  t('EXPIRED is terminal', lc.isTerminalStatus('EXPIRED') && lc.LIFECYCLE_TRANSITIONS.EXPIRED.length === 0);
  t('expireIfDue expires a due record',
    lc.expireIfDue(expiring, now + 5000).status === 'EXPIRED');
  t('expireIfDue leaves a live record alone',
    lc.expireIfDue(expiring, now + 100).status === 'VALIDATED');

  /* ---------------- 6. review binding and reauthorisation ----------------- */
  const terms = {
    chainId: 42161,
    amountIn: '100',
    fromSymbol: 'USDC',
    toSymbol: 'ETH',
    recipientRef: 'self',
    slippagePct: 0.5,
    minOut: '900000000000000',
    routeFingerprint: 'aaaa1111'
  };
  let signing = lc.createLifecycle({ intentId: 'in_sign', deadlineAt: now + 600_000, now });
  for (const status of ['VALIDATING', 'VALIDATED', 'QUOTING', 'OPTIMIZING', 'SIMULATING', 'AWAITING_SIGNATURE']) {
    signing = lc.transition(signing, status, { now }).record;
  }
  signing = lc.recordReview(signing, terms, { now });
  t('a reviewed record may request a signature', lc.canRequestSignature(signing, terms, { now }).ok);
  t('the raw terms are NOT stored, only a fingerprint',
    typeof signing.approvedTermsHash === 'string'
    && signing.approvedTermsHash.length === 16
    && !JSON.stringify(signing).includes('USDC'));

  for (const [field, value] of [
    ['routeFingerprint', 'bbbb2222'],
    ['amountIn', '101'],
    ['chainId', 8453],
    ['recipientRef', 'other'],
    ['slippagePct', 1.5],
    ['minOut', '1']
  ]) {
    const changedTerms = { ...terms, [field]: value };
    const gate = lc.canRequestSignature(signing, changedTerms, { now });
    t(`a changed ${field} blocks signing`, !gate.ok && gate.code === 'TERMS_CHANGED');
    t(`a changed ${field} is reported by reviewDelta`, lc.reviewDelta(signing, changedTerms).required === true);
    t(`diffTerms names the changed field ${field}`, lc.diffTerms(terms, changedTerms).includes(field));
  }

  const reauth = lc.applyMaterialChange(signing, ['routeFingerprint'], { now: now + 10 });
  t('a material change pushes the record back to OPTIMIZING', reauth.record.status === 'OPTIMIZING');
  t('a material change clears the approval', reauth.record.approvedTermsHash === null);
  t('a material change marks reauthorisation required', reauth.record.reauthorisationRequired === true);
  t('a de-authorised record cannot request a signature',
    !lc.canRequestSignature(reauth.record, terms, { now: now + 10 }).ok);

  const unreviewed = lc.transition(
    lc.transition(lc.transition(lc.transition(lc.transition(lc.transition(
      lc.createLifecycle({ intentId: 'in_unrev', now }), 'VALIDATING', { now }).record,
    'VALIDATED', { now }).record, 'QUOTING', { now }).record,
    'OPTIMIZING', { now }).record, 'SIMULATING', { now }).record,
    'AWAITING_SIGNATURE', { now }).record;
  t('an unreviewed record cannot request a signature',
    lc.canRequestSignature(unreviewed, terms, { now }).code === 'NOT_REVIEWED');

  const expiredSigning = lc.recordReview(
    { ...signing, deadlineAt: now - 1 }, terms, { now }
  );
  t('an expired record cannot request a signature',
    lc.canRequestSignature(expiredSigning, terms, { now }).code === 'EXPIRED');

  /* ------------------- 7. nothing sensitive is persisted ------------------ */
  const dirty = {
    ...signing,
    signer: { sendTransaction() {} },
    provider: {},
    calldata: '0x' + 'ab'.repeat(200),
    address: '0x1111111111111111111111111111111111111111',
    secret: 'ct1:deadbeef'
  };
  const cleaned = lc.sanitizeLifecycle(dirty);
  t('sanitize drops signer', cleaned.signer === undefined);
  t('sanitize drops provider', cleaned.provider === undefined);
  t('sanitize drops calldata', cleaned.calldata === undefined);
  t('sanitize drops address', cleaned.address === undefined);
  t('sanitize drops secrets', cleaned.secret === undefined);
  t('a sanitized record passes the cleanliness audit', lc.lifecycleIsClean(cleaned));
  t('a record carrying an address fails the cleanliness audit',
    lc.lifecycleIsClean({ ...cleaned, extra: '0x1111111111111111111111111111111111111111' }) === false);

  const saved = lc.saveLifecycle(dirty);
  const reloaded = lc.getLifecycle('in_sign');
  t('a persisted record round-trips', reloaded?.intentId === 'in_sign' && saved.status === reloaded.status);
  const rawJson = globalThis.localStorage.getItem('fbt-intent-lifecycle-v1');
  t('local storage contains no signer/provider/calldata/address',
    !/signer|provider|calldata|0x1111111111111111111111111111111111111111/.test(rawJson));

  /* ------------------------ 8. bounded event history ---------------------- */
  let churn = lc.createLifecycle({ intentId: 'in_churn', now });
  churn = lc.transition(churn, 'VALIDATING', { now }).record;
  churn = lc.transition(churn, 'VALIDATED', { now }).record;
  for (let i = 0; i < 60; i += 1) {
    churn = lc.transition(churn, i % 2 === 0 ? 'QUOTING' : 'OPTIMIZING', { now: now + i }).record;
  }
  t('event history stays bounded', churn.events.length <= lc.MAX_LIFECYCLE_EVENTS);
  t('the origin event is kept when history is trimmed', churn.events[0].reasonCode === 'INTENT_CREATED');
  t('sequence keeps growing past the history cap', churn.sequence > lc.MAX_LIFECYCLE_EVENTS);

  /* ---------------------------- 9. migration ------------------------------ */
  const legacy = {
    intent: {
      schema: 'fbt.intent.v1',
      id: 'in_legacy_1',
      kind: 'swap',
      createdAt: now - 100_000,
      deadlineAt: now + 100_000,
      chainId: 42161,
      fromSymbol: 'USDC',
      toSymbol: 'ETH',
      amountIn: '100'
    },
    status: 'ready-for-review',
    savedAt: now - 100_000
  };
  const migrated = lc.migrateLegacyIntent(legacy, { now });
  t('a legacy intent migrates', migrated?.schema === lc.INTENT_LIFECYCLE_SCHEMA);
  t('a legacy intent never migrates into a signable state', migrated.status === 'VALIDATED');
  t('a migrated record is not pre-approved', migrated.approvedTermsHash === null);
  t('a migrated record cannot request a signature', !lc.canRequestSignature(migrated, terms, { now }).ok);
  const expiredLegacy = lc.migrateLegacyIntent(
    { ...legacy, intent: { ...legacy.intent, deadlineAt: now - 10 } }, { now }
  );
  t('an expired legacy intent migrates straight to EXPIRED', expiredLegacy.status === 'EXPIRED');
  t('a non-intent row does not migrate', lc.migrateLegacyIntent({ nope: true }) === null);
  t('ensureLifecycle creates one when nothing exists',
    lc.ensureLifecycle({ intentId: 'in_fresh', now }).status === 'CREATED');

  /* ---------------------------- 10. timeline ------------------------------ */
  const timeline = lc.lifecycleTimeline(record);
  t('the timeline marks reached states', timeline.find((r) => r.status === 'SUBMITTED')?.reached === true);
  t('the timeline marks the current state', timeline.find((r) => r.current)?.status === 'COMPLETED');

  return rows;
}
