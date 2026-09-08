/**
 * FBT FINANCIAL INTELLIGENCE OS — Autonomous Policy Engine (§22, batch 5).
 * ---------------------------------------------------------------------------
 * A policy is a SCOPE OF STANDING AUTHORITY that the user wrote, with numbers:
 *
 *   maxPerExecutionUsd   the most ONE execution may cost (notional)
 *   maxDailyUsd          the most this policy may spend in a UTC day
 *   maxCumulativeUsd     the most this policy may EVER spend
 *   slippageLimitPct     no execution with a worse modelled slippage
 *   gasLimitUsd          no execution whose modelled gas exceeds this
 *   riskLimit            the worst risk band this policy may run under
 *   trigger              WHAT it may do: kinds, assets, chains — an explicit
 *                        scope; anything outside it is not "close enough"
 *   expiration           a policy that lives forever is a bug, not a feature
 *   emergencyStop        the user (or the guardian) can freeze it at any time
 *
 * THE RULES THIS FILE ENFORCES
 *  1. Every field is REQUIRED. A policy without a number is a promise without
 *     a limit, and it is refused at creation (`LIMIT_REQUIRED`), not at the
 *     moment it would have spent money.
 *  2. Every check is FAIL-CLOSED. An unread slippage, an unread gas figure or
 *     an unassessed risk level is a STOP with a name — never a pass by
 *     default. (`SLIPPAGE_UNREAD`, `GAS_UNREAD`, `RISK_UNREAD`.)
 *  3. Limits are HELD, not hoped for. An in-flight execution reserves its
 *     amount against every ledger; only a VERIFIED execution is committed, and
 *     a failed or abandoned execution releases the reservation. Two
 *     concurrent runs therefore cannot both sail under the same daily limit.
 *  4. CRITICAL risk is a hard stop for every policy, whatever its
 *     `riskLimit` says. No user limit outranks a security condition.
 *  5. `emergencyStop` freezes the policy (or ALL of the owner's policies)
 *     until the owner resumes it explicitly. The loop, the API and the
 *     guardian all read the same flag, so the stop cannot be raced around.
 *  6. This file never executes anything. It can only say yes or no, with the
 *     exact reason, for a request that someone else will carry out.
 *
 * Persistence: the `policies` collection (key namespace, see collections.js).
 * One row per policy, id = the policy id; the spend ledger lives inside the
 * row, capped, with running day/total counters so the limit checks are reads.
 */
import { randomUUID } from 'node:crypto';
import { requireFlag } from './flags.js';

export const POLICY_ENGINE_SCHEMA = 'fbt.fi.policy-engine.v1';

/** The risk bands a `riskLimit` may name, worst-last. CRITICAL is never a
 *  legal limit — a policy cannot pre-authorise a security condition. */
export const RISK_LIMITS = Object.freeze(['LOW', 'MODERATE', 'ELEVATED', 'HIGH']);
const RISK_ORDER = Object.freeze({ LOW: 1, MODERATE: 2, ELEVATED: 3, HIGH: 4, CRITICAL: 5 });

/** What a policy may cover. Anything the strategy engine can produce that the
 *  user would plausibly delegate; the list is closed so a typo cannot open a
 *  scope (`trigger.kinds: ["everything"]` is refused, not granted). */
export const POLICY_KINDS = Object.freeze([
  'DCA_IN', 'HOLD', 'YIELD_ON_IDLE', 'REBALANCE', 'RISK_REDUCTION',
  'DELEVERAGE', 'CROSS_CHAIN_CONSOLIDATE', 'SWAP'
]);

export const POLICY_STATUSES = Object.freeze(['ACTIVE', 'SUSPENDED', 'REVOKED']);

const MAX_LEDGER_ROWS = 200;
const MAX_POLICIES_PER_OWNER = 12;
const DAY_MS = 24 * 3600 * 1000;
const MAX_POLICY_LIFETIME_MS = 90 * DAY_MS;

/* null is ABSENCE here, not zero: Number(null) is 0 and a "confirmed amount
   of 0" would silently settle the wrong number. */
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const idFor = (prefix) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

const dayKey = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);

/**
 * Validate a policy definition. Every limit is mandatory and the limits must
 * nest: one execution ≤ a day ≤ the whole life of the policy. Returns the
 * normalised definition or `{ ok:false, code, field }`.
 */
export function validatePolicy(input = {}) {
  const out = { ok: true, code: null, field: null, policy: null, errors: [] };
  const err = (code, field, detail) => { out.ok = false; out.errors.push({ code, field, detail }); if (!out.code) { out.code = code; out.field = field; } };

  if (!input || typeof input !== 'object') return { ...out, code: out.code || 'POLICY_REQUIRED', field: 'policy' };

  const name = String(input.name || '').trim().slice(0, 60);
  if (!name) err('NAME_REQUIRED', 'name');

  const maxPerExecutionUsd = num(input.maxPerExecutionUsd);
  if (maxPerExecutionUsd === null || maxPerExecutionUsd <= 0) err('LIMIT_REQUIRED', 'maxPerExecutionUsd', 'a per-execution ceiling is required, any positive number');
  const maxDailyUsd = num(input.maxDailyUsd);
  if (maxDailyUsd === null || maxDailyUsd <= 0) err('LIMIT_REQUIRED', 'maxDailyUsd', 'a daily ceiling is required');
  const maxCumulativeUsd = num(input.maxCumulativeUsd);
  if (maxCumulativeUsd === null || maxCumulativeUsd <= 0) err('LIMIT_REQUIRED', 'maxCumulativeUsd', 'a lifetime ceiling is required');

  const slippageLimitPct = num(input.slippageLimitPct);
  if (slippageLimitPct === null || slippageLimitPct <= 0) err('LIMIT_REQUIRED', 'slippageLimitPct');
  else if (slippageLimitPct > 5) err('SLIPPAGE_LIMIT_TOO_LOOSE', 'slippageLimitPct', 'more than 5% slippage is not a policy, it is a surrender');

  const gasLimitUsd = num(input.gasLimitUsd);
  if (gasLimitUsd === null || gasLimitUsd <= 0) err('LIMIT_REQUIRED', 'gasLimitUsd');

  const riskLimit = String(input.riskLimit || '').toUpperCase();
  if (!RISK_LIMITS.includes(riskLimit)) err('BAD_RISK_LIMIT', 'riskLimit', `must be one of ${RISK_LIMITS.join(', ')} — CRITICAL can never be pre-authorised`);

  const trigger = input.trigger && typeof input.trigger === 'object' ? input.trigger : null;
  if (!trigger) err('TRIGGER_REQUIRED', 'trigger', 'a policy must name what it may do (kinds, and optionally assets/chains)');
  const kinds = Array.isArray(trigger?.kinds) ? trigger.kinds.map((k) => String(k).toUpperCase()).filter((k) => POLICY_KINDS.includes(k)) : [];
  if (!kinds.length) err('TRIGGER_REQUIRED', 'trigger.kinds', `at least one of: ${POLICY_KINDS.join(', ')}`);
  const assets = Array.isArray(trigger?.assets) ? trigger.assets.map((a) => String(a).toUpperCase()).slice(0, 24) : [];
  const chains = Array.isArray(trigger?.chains) ? trigger.chains.map((c) => String(c).slice(0, 24)).slice(0, 24) : [];

  const expiration = num(input.expiration);
  const now = num(input.now) ?? Date.now();
  if (expiration === null) err('EXPIRATION_REQUIRED', 'expiration', 'a policy without an end date is not granted');
  if (expiration !== null && expiration <= now) err('EXPIRATION_IN_PAST', 'expiration');
  if (expiration !== null && expiration > now + MAX_POLICY_LIFETIME_MS) err('EXPIRATION_TOO_FAR', 'expiration', `a policy lives at most ${MAX_POLICY_LIFETIME_MS / DAY_MS} days; renew it deliberately`);

  if (maxPerExecutionUsd !== null && maxDailyUsd !== null && maxPerExecutionUsd > maxDailyUsd) {
    err('LIMITS_DO_NOT_NEST', 'maxPerExecutionUsd', 'one execution cannot exceed the whole day');
  }
  if (maxDailyUsd !== null && maxCumulativeUsd !== null && maxDailyUsd > maxCumulativeUsd) {
    err('LIMITS_DO_NOT_NEST', 'maxDailyUsd', 'a day cannot exceed the lifetime total');
  }

  if (!out.ok) return { ...out, policy: null };
  out.policy = {
    name,
    maxPerExecutionUsd,
    maxDailyUsd,
    maxCumulativeUsd,
    slippageLimitPct,
    gasLimitUsd,
    riskLimit,
    trigger: { kinds, assets, chains },
    expiration
  };
  return out;
}

export function createPolicyEngine({ collections, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  const emptySpend = () => ({ dayKey: dayKey(now()), dayUsd: 0, dayCount: 0, totalUsd: 0, totalCount: 0, pendingUsd: 0 });

  async function load(owner) {
    const { ok, rows, code } = await collections.read('policies', owner);
    if (!ok) return { ok: false, code, rows: [] };
    return { ok: true, rows };
  }

  async function save(owner, policy) {
    const res = await collections.put('policies', owner, policy, { idKey: 'id' });
    return { ok: res.ok, durable: res.durable ?? collections.durable(), code: res.code || null };
  }

  /* Roll the daily counter forward when the UTC day turns. The lifetime
     counter is never rolled. Pure: it RETURNS the spend to use, so a caller
     cannot forget the roll by holding a stale reference. */
  const rollDay = (spend, at) => {
    const key = dayKey(at);
    if (!spend?.dayKey || spend.dayKey === key) return { ...emptySpend(), ...(spend || {}) };
    return { ...emptySpend(), dayKey: key, totalUsd: spend.totalUsd || 0, totalCount: spend.totalCount || 0 };
  };

  /** Create a policy. Refuses when the autonomy flag is off, when the owner
   *  has too many, or when any limit is missing. */
  async function create(owner, input = {}) {
    const gate = requireFlag('AUTONOMOUS_POLICY_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const at = now();
    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code };
    if (loaded.rows.length >= MAX_POLICIES_PER_OWNER) {
      return { ok: false, code: 'TOO_MANY_POLICIES', max: MAX_POLICIES_PER_OWNER, detail: 'delete what you no longer use; a shelf of unlimited policies is no scope at all' };
    }
    const valid = validatePolicy({ ...input, now: at });
    if (!valid.ok) return { ok: false, code: valid.code, field: valid.field, errors: valid.errors };
    const policy = {
      schema: POLICY_ENGINE_SCHEMA,
      id: idFor('pol'),
      owner: null,
      status: 'ACTIVE',
      createdBy: String(owner).slice(0, 80),
      createdAt: at,
      updatedAt: at,
      version: 1,
      emergency: null,
      ledger: [],
      spend: emptySpend(),
      ...valid.policy
    };
    const res = await save(owner, policy);
    if (!res.ok) return { ok: false, code: res.code };
    if (observability) observability.emit({ type: 'policy.passed', owner, payload: { policyId: policy.id, action: 'created', maxPerExecutionUsd: policy.maxPerExecutionUsd, maxDailyUsd: policy.maxDailyUsd, maxCumulativeUsd: policy.maxCumulativeUsd } });
    return { ok: true, policy, durable: res.durable };
  }

  async function get(owner, id) {
    const { ok, code } = await load(owner);
    if (!ok) return { ok: false, code, policy: null };
    const row = (await load(owner)).rows.find((p) => p?.id === String(id));
    if (!row) return { ok: false, code: 'POLICY_NOT_FOUND', id: String(id), policy: null };
    return { ok: true, policy: row, durable: collections.durable() };
  }

  async function list(owner) {
    const { ok, code, rows } = await load(owner);
    if (!ok) return { ok: false, code, policies: [] };
    return { ok: true, policies: rows, durable: collections.durable() };
  }

  /** Evaluate ONE execution request against ONE policy. Pure with respect to
   *  storage: it reads the policy, it does not spend. Every failure names the
   *  gate that fired. Order matters and is the documented order. */
  async function evaluate({ owner, policyId, request = {} }) {
    const at = now();
    const found = await get(owner, policyId);
    if (!found.ok) return { ok: false, code: found.code, policyId: String(policyId), request };

    const policy = found.policy;
    const checks = [];
    const stop = (code, detail, extra = {}) => {
      checks.push({ gate: code, ok: false, detail });
      return { ok: false, code, policyId: policy.id, status: policy.status, checks, request, policy: policyView(policy), detail, ...extra };
    };
    const pass = (gate, detail) => { checks.push({ gate, ok: true, detail }); };

    if (policy.status === 'REVOKED') return stop('POLICY_REVOKED', 'this policy was revoked by its owner');
    if (policy.emergency) return stop('EMERGENCY_STOP', `stopped at ${new Date(policy.emergency.at).toISOString()} by ${policy.emergency.by || 'unknown'}: ${policy.emergency.reason || 'no reason recorded'}`);
    if (policy.status === 'SUSPENDED') return stop('POLICY_SUSPENDED', 'the owner suspended this policy; resume it to run it');
    if (policy.expiration <= at) return stop('POLICY_EXPIRED', `expired ${new Date(policy.expiration).toISOString()}`, { expiredAt: policy.expiration });

    /* ── scope: does this action even belong to what the policy allows? ── */
    const kind = String(request.kind || '').toUpperCase();
    if (!kind) return stop('TRIGGER_NOT_MATCHED', 'the request names no strategy kind, so it cannot be matched to a scope');
    if (!policy.trigger.kinds.includes(kind)) return stop('TRIGGER_NOT_MATCHED', `kind ${kind} is outside this policy's scope (${policy.trigger.kinds.join(', ')})`);
    const asset = String(request.asset || '').toUpperCase();
    if (asset && policy.trigger.assets.length && !policy.trigger.assets.includes(asset)) {
      return stop('TRIGGER_NOT_MATCHED', `asset ${asset} is outside this policy's scope (${policy.trigger.assets.join(', ')})`);
    }
    const chain = String(request.chain || '').slice(0, 24);
    if (chain && policy.trigger.chains.length && !policy.trigger.chains.includes(chain)) {
      return stop('TRIGGER_NOT_MATCHED', `chain ${chain} is outside this policy's scope (${policy.trigger.chains.join(', ')})`);
    }
    pass('SCOPE', `${kind}${asset ? ` on ${asset}` : ''} is inside the policy's trigger scope`);

    /* ── the amount ───────────────────────────────────────────────────── */
    const amountUsd = num(request.amountUsd);
    if (amountUsd === null || amountUsd <= 0) return stop('AMOUNT_INVALID', 'the request carries no positive amount; the loop will not guess one');
    if (amountUsd > policy.maxPerExecutionUsd) {
      return stop('PER_EXECUTION_LIMIT', `$${amountUsd} exceeds maxPerExecutionUsd $${policy.maxPerExecutionUsd}`, { amountUsd, limit: policy.maxPerExecutionUsd });
    }
    pass('PER_EXECUTION', `$${amountUsd} ≤ $${policy.maxPerExecutionUsd}`);

    const spend = rollDay({ ...emptySpend(), ...(policy.spend || {}) }, at);

    const committedDaily = spend.dayUsd + spend.pendingUsd;
    if (committedDaily + amountUsd > policy.maxDailyUsd) {
      return stop('DAILY_LIMIT', `$${amountUsd} would bring the day to $${Math.round((committedDaily + amountUsd) * 100) / 100} against a $${policy.maxDailyUsd} daily ceiling`, { committedDaily, limit: policy.maxDailyUsd });
    }
    pass('DAILY', `day at $${Math.round(committedDaily * 100) / 100} of $${policy.maxDailyUsd}`);

    const committedTotal = spend.totalUsd + spend.pendingUsd;
    if (committedTotal + amountUsd > policy.maxCumulativeUsd) {
      return stop('CUMULATIVE_LIMIT', `$${amountUsd} would exceed the lifetime ceiling of $${policy.maxCumulativeUsd}`, { committedTotal, limit: policy.maxCumulativeUsd });
    }
    pass('CUMULATIVE', `lifetime at $${Math.round(committedTotal * 100) / 100} of $${policy.maxCumulativeUsd}`);

    /* ── execution-quality gates: fail-closed on unread input ─────────── */
    const slippagePct = num(request.slippagePct);
    if (slippagePct === null) return stop('SLIPPAGE_UNREAD', 'no slippage figure was supplied; without one the cost of this execution is unknown', { failClosed: true });
    if (slippagePct > policy.slippageLimitPct) {
      return stop('SLIPPAGE_LIMIT', `slippage ${slippagePct}% exceeds the policy's ${policy.slippageLimitPct}%`, { slippagePct, limit: policy.slippageLimitPct });
    }
    pass('SLIPPAGE', `${slippagePct}% ≤ ${policy.slippageLimitPct}%`);

    const gasUsd = num(request.gasUsd);
    if (gasUsd === null) return stop('GAS_UNREAD', 'no gas figure was supplied; an execution with unknown gas cost cannot be bounded', { failClosed: true });
    if (gasUsd > policy.gasLimitUsd) {
      return stop('GAS_LIMIT', `gas $${gasUsd} exceeds the policy's $${policy.gasLimitUsd}`, { gasUsd, limit: policy.gasLimitUsd });
    }
    pass('GAS', `$${gasUsd} ≤ $${policy.gasLimitUsd}`);

    const riskLevel = String(request.riskLevel || '').toUpperCase();
    if (!RISK_ORDER[riskLevel]) return stop('RISK_UNREAD', 'no risk level was supplied; an unassessed execution is a guess', { failClosed: true });
    if (riskLevel === 'CRITICAL') return stop('RISK_LIMIT', 'CRITICAL risk is a hard stop for every policy, whatever its limit says', { riskLevel: 'CRITICAL' });
    if (RISK_ORDER[riskLevel] > RISK_ORDER[policy.riskLimit]) {
      return stop('RISK_LIMIT', `risk ${riskLevel} exceeds this policy's ${policy.riskLimit} limit`, { riskLevel, limit: policy.riskLimit });
    }
    pass('RISK', `${riskLevel} ≤ ${policy.riskLimit}`);

    return {
      ok: true,
      code: 'POLICY_CLEARED',
      policyId: policy.id,
      checks,
      request,
      policy: policyView(policy),
      projected: {
        dayUsd: Math.round((committedDaily + amountUsd) * 100) / 100,
        totalUsd: Math.round((committedTotal + amountUsd) * 100) / 100
      }
    };
  }

  /** Hold the amount while an execution is in flight. The check runs first;
   *  a failed check reserves nothing. The reservation is what makes two
   *  concurrent runs unable to overshoot the same limit. */
  async function reserve(owner, policyId, request = {}) {
    const at = now();
    const verdict = await evaluate({ owner, policyId, request });
    if (!verdict.ok) return { ok: false, code: verdict.code, checks: verdict.checks };
    const found = await get(owner, policyId);
    if (!found.ok) return { ok: false, code: found.code };
    const policy = found.policy;
    const spend = rollDay({ ...emptySpend(), ...(policy.spend || {}) }, at);
    const amountUsd = num(request.amountUsd);
    const executionId = String(request.executionId || request.requestId || idFor('run')).slice(0, 64);
    policy.spend = { ...spend, pendingUsd: Math.round((spend.pendingUsd + amountUsd) * 100) / 100 };
    policy.ledger = [{
      executionId,
      status: 'PENDING',
      kind: String(request.kind || '').toUpperCase(),
      asset: String(request.asset || '').toUpperCase() || null,
      chain: String(request.chain || '').slice(0, 24) || null,
      amountUsd,
      gasUsd: num(request.gasUsd),
      slippagePct: num(request.slippagePct),
      riskLevel: String(request.riskLevel || '').toUpperCase() || null,
      at
    }, ...(policy.ledger || [])].slice(0, MAX_LEDGER_ROWS);
    policy.updatedAt = at;
    const res = await save(owner, policy);
    if (!res.ok) return { ok: false, code: res.code };
    return { ok: true, executionId, policyId: policy.id, reservedUsd: amountUsd, durable: res.durable };
  }

  /** Commit a reserved execution — only with a verification id. An
   *  unverified "success" is not spend money was spent, it is a hope, and
   *  the ledger will not record hopes. */
  async function confirm(owner, policyId, executionId, { verificationId = null, actualAmountUsd = null } = {}) {
    if (!verificationId) return { ok: false, code: 'VERIFICATION_REQUIRED', detail: 'confirm requires the verification id from the receipt path' };
    const found = await get(owner, policyId);
    if (!found.ok) return { ok: false, code: found.code };
    const policy = found.policy;
    const entry = (policy.ledger || []).find((l) => l.executionId === String(executionId));
    if (!entry) return { ok: false, code: 'NO_PENDING_EXECUTION', executionId: String(executionId), detail: 'reserve() before confirm(); there is nothing in flight under that id' };
    if (entry.status !== 'PENDING') return { ok: false, code: 'ALREADY_SETTLED', status: entry.status };

    const at = now();
    const amount = num(actualAmountUsd) ?? entry.amountUsd;
    const spend = rollDay({ ...emptySpend(), ...(policy.spend || {}) }, at);
    policy.spend = {
      ...spend,
      pendingUsd: Math.max(0, Math.round((spend.pendingUsd - entry.amountUsd) * 100) / 100),
      dayUsd: Math.round((spend.dayUsd + amount) * 100) / 100,
      dayCount: spend.dayCount + 1,
      totalUsd: Math.round((spend.totalUsd + amount) * 100) / 100,
      totalCount: spend.totalCount + 1
    };
    entry.status = 'CONFIRMED';
    entry.verificationId = String(verificationId).slice(0, 64);
    entry.settledAt = at;
    if (num(actualAmountUsd) !== null) entry.actualAmountUsd = amount;
    policy.updatedAt = at;
    const res = await save(owner, policy);
    if (!res.ok) return { ok: false, code: res.code };
    if (observability) observability.emit({ type: 'execution.confirmed', owner, payload: { policyId: policy.id, executionId: String(executionId), verificationId: String(verificationId).slice(0, 24), amountUsd: amount } });
    return { ok: true, executionId: String(executionId), settledUsd: amount, spend: spendView(policy.spend) };
  }

  /** Release a reservation the execution will never settle. Failed at the
   *  venue, cancelled by the user, or dead without a receipt: the limit comes
   *  back, the attempt stays in the ledger as FAILED so the history is whole. */
  async function release(owner, policyId, executionId, { reason = null } = {}) {
    const found = await get(owner, policyId);
    if (!found.ok) return { ok: false, code: found.code };
    const policy = found.policy;
    const entry = (policy.ledger || []).find((l) => l.executionId === String(executionId));
    if (!entry) return { ok: false, code: 'NO_PENDING_EXECUTION', executionId: String(executionId) };
    if (entry.status !== 'PENDING') return { ok: false, code: 'ALREADY_SETTLED', status: entry.status };
    const at = now();
    const spend = rollDay({ ...emptySpend(), ...(policy.spend || {}) }, at);
    policy.spend = { ...spend, pendingUsd: Math.max(0, Math.round((spend.pendingUsd - entry.amountUsd) * 100) / 100) };
    entry.status = 'FAILED';
    entry.failureReason = String(reason || 'execution did not complete').slice(0, 160);
    entry.settledAt = at;
    policy.updatedAt = at;
    const res = await save(owner, policy);
    if (!res.ok) return { ok: false, code: res.code };
    return { ok: true, executionId: String(executionId), releasedUsd: entry.amountUsd, spend: spendView(policy.spend) };
  }

  /** Freeze one policy, or — with no id — every active policy of the owner.
   *  The guardian and the API route both funnel through here, so there is
   *  exactly one way to stop the machine and exactly one flag that stops it. */
  async function emergencyStop(owner, { policyId = null, reason = 'no reason given', by = 'user' } = {}) {
    const at = now();
    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code, stopped: [] };
    const rows = policyId
      ? loaded.rows.filter((p) => p.id === String(policyId))
      : loaded.rows;
    const stopped = [];
    for (const policy of rows) {
      if (policy.status === 'REVOKED') continue;
      policy.emergency = { at, reason: String(reason).slice(0, 200), by: String(by).slice(0, 40) };
      if (policyId === null) policy.status = 'SUSPENDED';
      policy.updatedAt = at;
      const res = await save(owner, policy);
      stopped.push({ policyId: policy.id, name: policy.name, status: policy.status, durable: res.durable ?? collections.durable() });
      if (observability) observability.emit({ type: 'policy.failed', owner, severity: 'critical', payload: { policyId: policy.id, action: 'emergency_stop', reason: String(reason).slice(0, 120), by: String(by).slice(0, 40) } });
    }
    if (!stopped.length) return { ok: false, code: policyId ? 'POLICY_NOT_FOUND' : 'NO_POLICIES', stopped };
    return { ok: true, stopped, scope: policyId ? 'one' : 'all' };
  }

  /** Only the owner (by: 'user') can unfreeze. A guardian stop stays stopped
   *  until the human says otherwise — the machine cannot release its own
   *  safety stop. */
  async function resume(owner, policyId, { by = 'user', reason = null } = {}) {
    const found = await get(owner, policyId);
    if (!found.ok) return { ok: false, code: found.code };
    const policy = found.policy;
    if (String(by) !== 'user') return { ok: false, code: 'ONLY_THE_OWNER_CAN_RESUME', detail: 'an automatic actor may stop the machine; only the human may start it again' };
    if (!policy.emergency) return { ok: false, code: 'NOT_STOPPED', policyId: policy.id };
    const at = now();
    policy.emergency = null;
    policy.status = 'ACTIVE';
    policy.updatedAt = at;
    policy.resumeHistory = [{ at, reason: String(reason || 'resumed by the owner').slice(0, 200) }, ...(policy.resumeHistory || [])].slice(0, 10);
    const res = await save(owner, policy);
    if (!res.ok) return { ok: false, code: res.code };
    return { ok: true, policy: policyView(policy), durable: res.durable };
  }

  async function revoke(owner, policyId, { reason = null } = {}) {
    const found = await get(owner, policyId);
    if (!found.ok) return { ok: false, code: found.code };
    const policy = found.policy;
    const at = now();
    policy.status = 'REVOKED';
    policy.revokeReason = String(reason || 'revoked by the owner').slice(0, 200);
    policy.updatedAt = at;
    const res = await save(owner, policy);
    if (!res.ok) return { ok: false, code: res.code };
    return { ok: true, policy: policyView(policy), durable: res.durable };
  }

  /** The operator view: every policy with its spend, its stop state and how
   *  long until it expires. This is what /api/ai/policies answers with. */
  async function status(owner) {
    const { ok, code, rows } = await load(owner);
    if (!ok) return { ok: false, code, policies: [] };
    const at = now();
    return {
      ok: true,
      flag: requireFlag('AUTONOMOUS_POLICY_ENABLED'),
      count: rows.length,
      anyEmergency: rows.some((p) => p.emergency),
      policies: rows.map(policyView),
      asOf: at,
      durable: collections.durable()
    };
  }

  return {
    schema: POLICY_ENGINE_SCHEMA,
    RISK_LIMITS,
    POLICY_KINDS,
    validate: validatePolicy,
    create, get, list, evaluate, reserve, confirm, release,
    emergencyStop, resume, revoke, status
  };
}

/** The read view: the limits, the scope, the spend, the stop state — and
 *  nothing that a client should not see. */
function policyView(policy) {
  return {
    id: policy.id,
    name: policy.name,
    status: policy.status,
    emergency: policy.emergency || null,
    maxPerExecutionUsd: policy.maxPerExecutionUsd,
    maxDailyUsd: policy.maxDailyUsd,
    maxCumulativeUsd: policy.maxCumulativeUsd,
    slippageLimitPct: policy.slippageLimitPct,
    gasLimitUsd: policy.gasLimitUsd,
    riskLimit: policy.riskLimit,
    trigger: policy.trigger,
    expiration: policy.expiration,
    expiresInMs: Math.max(0, policy.expiration - Date.now()),
    spend: spendView(policy.spend),
    ledger: (policy.ledger || []).slice(0, 20).map(({ status, executionId, kind, asset, amountUsd, gasUsd, at, verificationId, failureReason }) => ({ status, executionId, kind, asset, amountUsd, gasUsd, at, verificationId, failureReason: failureReason || null })),
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt
  };
}

function spendView(spend = {}) {
  const s = { ...emptySpendFrom(spend) };
  return {
    dayKey: s.dayKey,
    dayUsd: Math.round((s.dayUsd || 0) * 100) / 100,
    dayCount: s.dayCount || 0,
    totalUsd: Math.round((s.totalUsd || 0) * 100) / 100,
    totalCount: s.totalCount || 0,
    pendingUsd: Math.round((s.pendingUsd || 0) * 100) / 100
  };
}

function emptySpendFrom(spend = {}) {
  return { dayKey: spend?.dayKey || dayKey(), dayUsd: spend?.dayUsd || 0, dayCount: spend?.dayCount || 0, totalUsd: spend?.totalUsd || 0, totalCount: spend?.totalCount || 0, pendingUsd: spend?.pendingUsd || 0 };
}
