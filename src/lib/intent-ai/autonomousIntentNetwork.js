/**
 * FBT INTENT AI — Phases 151–200: recovery and bounded autonomy.
 *
 * This module is deliberately a control plane, not a signer. It can preserve a
 * sanitized job, explain a failure, compare alternatives and prepare the next
 * proposal. It cannot hold a private key, rebroadcast a transaction, promise a
 * return, bypass KYC/sanctions, or move a performance fee without the user's
 * explicit wallet approval.
 */

import { EVIDENCE_KINDS } from './operationalActivation.js';

export const AUTONOMOUS_NETWORK_SCHEMA = 'fbt.autonomous-intent-network.v1';
export const RECOVERY_JOURNAL_SCHEMA = 'fbt.intent-recovery-journal.v1';
export const PORTFOLIO_GUARD_SCHEMA = 'fbt.portfolio-risk-guard.v1';
export const PERFORMANCE_FEE_BPS = 500; // 5% of realised, positive, net profit only.
export const MAX_RECOVERY_JOBS = 50;
export const MAX_JOB_EVENTS = 100;
export const RECOVERY_STORAGE_KEY = 'fbt.intent-recovery-journal.v1';

const FORBIDDEN_KEYS = /private|secret|seed|mnemonic|calldata|rawtransaction|signature|authorization|api.?key|password/i;
const TX_HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const safeText = (value, max = 160) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function sanitized(value, depth = 0) {
  if (depth > 6 || value == null) return value == null ? null : undefined;
  if (typeof value === 'string') return safeText(value, 500);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((row) => sanitized(row, depth + 1)).filter((row) => row !== undefined);
  if (typeof value !== 'object') return undefined;
  const out = {};
  for (const [key, row] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) continue;
    const next = sanitized(row, depth + 1);
    if (next !== undefined) out[safeText(key, 64)] = next;
  }
  return out;
}

/** A deterministic non-cryptographic corruption check; never an identity hash. */
function checksum(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createRecoveryJournal({ deviceId = 'local-device', now = Date.now() } = {}) {
  const body = {
    schema: RECOVERY_JOURNAL_SCHEMA,
    deviceId: safeText(deviceId, 64) || 'local-device',
    createdAt: now,
    updatedAt: now,
    jobs: []
  };
  return { ...body, checksum: checksum(body) };
}

function sealJournal(journal, now) {
  const body = { ...journal, updatedAt: now };
  delete body.checksum;
  return { ...body, checksum: checksum(body) };
}

/**
 * Saves only operational metadata. Sender, recipient, calldata, signatures and
 * credentials are stripped even when a caller accidentally supplies them.
 */
export function saveRecoveryJob(journal, job, { now = Date.now() } = {}) {
  const base = restoreRecoveryJournal(journal, { now });
  const id = safeText(job?.id, 96);
  if (!id) return { ok: false, code: 'JOB_ID_REQUIRED', journal: base };
  const previous = base.jobs.find((row) => row.id === id);
  const clean = sanitized(job) || {};
  const entry = {
    id,
    intentType: safeText(clean.intentType || previous?.intentType || 'unknown', 48),
    status: safeText(clean.status || previous?.status || 'queued', 32),
    termsFingerprint: safeText(clean.termsFingerprint || previous?.termsFingerprint || '', 96) || null,
    chainId: finite(clean.chainId ?? previous?.chainId),
    attempts: clamp(Math.round(finite(clean.attempts ?? previous?.attempts) || 0), 0, 99),
    nextAction: safeText(clean.nextAction || previous?.nextAction || 'REVIEW', 64),
    events: Array.isArray(clean.events) ? clean.events.slice(-MAX_JOB_EVENTS) : (previous?.events || []),
    createdAt: finite(previous?.createdAt ?? clean.createdAt) || now,
    updatedAt: now
  };
  const jobs = [entry, ...base.jobs.filter((row) => row.id !== id)].slice(0, MAX_RECOVERY_JOBS);
  return { ok: true, journal: sealJournal({ ...base, jobs }, now), job: entry };
}

export function appendRecoveryEvent(journal, jobId, event, { now = Date.now() } = {}) {
  const base = restoreRecoveryJournal(journal, { now });
  const previous = base.jobs.find((row) => row.id === jobId);
  if (!previous) return { ok: false, code: 'JOB_NOT_FOUND', journal: base };
  const clean = sanitized(event) || {};
  const events = [...previous.events, {
    at: now,
    stage: safeText(clean.stage || 'RECOVERY', 32),
    code: safeText(clean.code || 'OBSERVED', 64),
    detail: safeText(clean.detail || '', 200) || null,
    txHash: TX_HASH.test(clean.txHash || '') ? clean.txHash : null
  }].slice(-MAX_JOB_EVENTS);
  return saveRecoveryJob(base, { ...previous, events }, { now });
}

export function restoreRecoveryJournal(input, { now = Date.now() } = {}) {
  let parsed = input;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); } catch { parsed = null; }
  }
  if (!parsed || parsed.schema !== RECOVERY_JOURNAL_SCHEMA || !Array.isArray(parsed.jobs)) {
    return createRecoveryJournal({ now });
  }
  const supplied = parsed.checksum;
  const body = { ...parsed };
  delete body.checksum;
  if (supplied !== checksum(body)) return createRecoveryJournal({ deviceId: parsed.deviceId, now });
  return sealJournal({
    schema: RECOVERY_JOURNAL_SCHEMA,
    deviceId: safeText(parsed.deviceId, 64) || 'local-device',
    createdAt: finite(parsed.createdAt) || now,
    jobs: sanitized(parsed.jobs).slice(0, MAX_RECOVERY_JOBS)
  }, finite(parsed.updatedAt) || now);
}

export function exportRecoveryBundle(journal) {
  const restored = restoreRecoveryJournal(journal);
  return {
    schema: 'fbt.intent-recovery-portable.v1',
    privacy: 'sanitized-no-credentials',
    journal: restored,
    exportedAt: Date.now(),
    warning: 'Store this operational history privately. Wallet signing authority is never included.'
  };
}

export function importRecoveryBundle(bundle, options) {
  if (bundle?.schema !== 'fbt.intent-recovery-portable.v1') return { ok: false, code: 'BUNDLE_INVALID' };
  const journal = restoreRecoveryJournal(bundle.journal, options);
  return { ok: true, journal, importedJobs: journal.jobs.length };
}

/** Browser/Capacitor persistence seam; callers may inject any Storage-like API. */
export function persistRecoveryJournal(journal, { storage = null, key = RECOVERY_STORAGE_KEY } = {}) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target || typeof target.setItem !== 'function') return { ok: false, code: 'STORAGE_UNAVAILABLE' };
    const safeJournal = restoreRecoveryJournal(journal);
    target.setItem(key, JSON.stringify(safeJournal));
    return { ok: true, storedJobs: safeJournal.jobs.length };
  } catch {
    return { ok: false, code: 'STORAGE_WRITE_FAILED' };
  }
}

export function loadRecoveryJournal({ storage = null, key = RECOVERY_STORAGE_KEY, now = Date.now() } = {}) {
  try {
    const target = storage || globalThis.localStorage;
    if (!target || typeof target.getItem !== 'function') return { ok: false, code: 'STORAGE_UNAVAILABLE', journal: createRecoveryJournal({ now }) };
    const raw = target.getItem(key);
    return { ok: true, journal: raw ? restoreRecoveryJournal(raw, { now }) : createRecoveryJournal({ now }) };
  } catch {
    return { ok: false, code: 'STORAGE_READ_FAILED', journal: createRecoveryJournal({ now }) };
  }
}

const FAILURE_ALTERNATIVES = Object.freeze({
  QUOTE_EXPIRED: ['REFRESH_QUOTES', 'COMPARE_NEXT_HEALTHY_VENUE'],
  ROUTE_CHANGED: ['REFRESH_QUOTES', 'RECALCULATE_MIN_OUTPUT'],
  RPC_UNAVAILABLE: ['SWITCH_READ_RPC', 'RETRY_SIMULATION'],
  RPC_DISAGREEMENT: ['WAIT_FOR_QUORUM', 'SWITCH_READ_RPC'],
  SIMULATION_REVERTED: ['COMPARE_NEXT_HEALTHY_VENUE', 'REDUCE_AMOUNT'],
  INSUFFICIENT_BALANCE: ['REDUCE_AMOUNT', 'WAIT_FOR_FUNDS'],
  TRANSACTION_DROPPED: ['CHECK_NONCE_AND_REPLACEMENT', 'RETURN_TO_USER'],
  RECEIPT_FAILED: ['EXPLAIN_REVERT', 'REFRESH_QUOTES'],
  MIN_OUTPUT_AT_RISK: ['REFRESH_QUOTES', 'RECALCULATE_MIN_OUTPUT']
});

/** Why Failed → Find Alternative → Recalculate → Retry (preflight only). */
export function diagnoseRecovery({ failureCode, attempts = 0, termsChanged = false, transactionBroadcast = false } = {}) {
  const code = safeText(failureCode, 64).toUpperCase() || 'UNKNOWN_FAILURE';
  const alternatives = FAILURE_ALTERNATIVES[code] || ['RETURN_TO_USER'];
  const exhausted = attempts >= 3;
  const requiresConfirmation = termsChanged || transactionBroadcast || !['RPC_UNAVAILABLE', 'QUOTE_EXPIRED'].includes(code);
  return {
    schema: AUTONOMOUS_NETWORK_SCHEMA,
    whyFailed: code,
    alternatives,
    recalculate: alternatives.some((row) => /QUOTE|AMOUNT|OUTPUT|VENUE/.test(row)),
    retry: {
      allowed: !exhausted && code !== 'INSUFFICIENT_BALANCE',
      kind: requiresConfirmation ? 'PROPOSAL_ONLY' : 'PREFLIGHT_ONLY',
      automaticallyBroadcasts: false,
      requiresWalletConfirmation: requiresConfirmation
    },
    attempts,
    exhausted
  };
}

export const VENUE_CAPABILITIES = Object.freeze([
  { id: 'zero-x', kind: 'dex-aggregator', markets: ['spot'], evm: true, atomicSingleChain: true, requiresKyc: false, execution: 'external-api-and-wallet' },
  { id: 'kyberswap', kind: 'dex-aggregator', markets: ['spot'], evm: true, atomicSingleChain: true, requiresKyc: false, execution: 'external-api-and-wallet' },
  { id: 'jupiter', kind: 'dex-aggregator', markets: ['spot'], evm: false, atomicSingleChain: true, requiresKyc: false, execution: 'external-api-and-wallet' },
  { id: 'dydx', kind: 'decentralized-venue', markets: ['spot', 'perpetual'], evm: false, atomicSingleChain: false, requiresKyc: false, execution: 'external-venue' },
  { id: 'cex', kind: 'centralized-exchange', markets: ['spot', 'options', 'futures'], evm: false, atomicSingleChain: false, requiresKyc: true, execution: 'compliance-dependent' }
]);

export function venueOptions({ market = 'spot', evm = null, healthyVenueIds = [] } = {}) {
  const health = new Set(healthyVenueIds);
  return VENUE_CAPABILITIES.filter((row) => row.markets.includes(market) && (evm == null || row.evm === evm)).map((row) => ({
    ...row,
    health: health.size ? (health.has(row.id) ? 'observed-healthy' : 'unverified') : 'unknown',
    executable: row.id !== 'cex' && (!health.size || health.has(row.id)),
    requiresFreshQuote: true,
    requiresWalletConfirmation: true
  }));
}

/** Atomic means one chain + one transaction + revert-all, never “eventually”. */
export function compileAtomicIntent({ steps = [], chainId = null, adapter = null } = {}) {
  const rows = Array.isArray(steps) ? steps : [];
  const chains = new Set(rows.map((row) => finite(row.chainId ?? chainId)).filter((row) => row !== null));
  const blockers = [];
  if (!rows.length) blockers.push('STEPS_REQUIRED');
  if (chains.size !== 1) blockers.push('CROSS_CHAIN_NOT_ATOMIC');
  if (adapter?.atomicSingleChain !== true) blockers.push('ATOMIC_ADAPTER_REQUIRED');
  if (rows.some((row) => row.revertPolicy && row.revertPolicy !== 'abort-all')) blockers.push('ABORT_ALL_REQUIRED');
  return {
    schema: 'fbt.atomic-intent.v1',
    ok: blockers.length === 0,
    mode: blockers.length ? 'proposal' : 'single-chain-atomic',
    chainId: chains.size === 1 ? [...chains][0] : null,
    steps: rows.map((row, index) => ({ index, action: safeText(row.action, 32), targetRef: safeText(row.targetRef || row.target, 96), revertPolicy: 'abort-all' })),
    blockers,
    oneTransaction: blockers.length === 0,
    crossChainAtomicClaim: false,
    requiresSimulation: true,
    requiresWalletConfirmation: true
  };
}

export function createPortfolioGuard({ maxRiskPct = 20, driftPct = 5, allowedAssets = [], now = Date.now() } = {}) {
  const risk = finite(maxRiskPct);
  if (risk === null || risk <= 0 || risk > 100) return { ok: false, code: 'RISK_LIMIT_INVALID' };
  return {
    ok: true,
    policy: {
      schema: PORTFOLIO_GUARD_SCHEMA,
      maxRiskPct: risk,
      driftPct: clamp(finite(driftPct) ?? 5, 0.1, 50),
      allowedAssets: [...new Set(allowedAssets.map((row) => safeText(row, 24).toUpperCase()).filter(Boolean))],
      createdAt: now,
      promisesFixedProfit: false,
      monitorMayTrade: false
    }
  };
}

/** Returns a rebalance proposal; it never calls a venue or signer. */
export function evaluatePortfolioGuard({ policy, positions = [], now = Date.now() } = {}) {
  if (policy?.schema !== PORTFOLIO_GUARD_SCHEMA) return { ok: false, code: 'POLICY_REQUIRED' };
  const rows = positions.map((row) => ({
    asset: safeText(row.asset, 24).toUpperCase(),
    valueUsd: Math.max(0, finite(row.valueUsd) || 0),
    riskWeight: clamp(finite(row.riskWeight) ?? 1, 0, 1)
  }));
  const total = rows.reduce((sum, row) => sum + row.valueUsd, 0);
  if (total <= 0) return { ok: false, code: 'PORTFOLIO_VALUE_REQUIRED' };
  const weighted = rows.reduce((sum, row) => sum + row.valueUsd * row.riskWeight, 0);
  const riskPct = (weighted / total) * 100;
  const breach = riskPct > policy.maxRiskPct;
  const reductionUsd = breach ? Math.min(total, (weighted - (policy.maxRiskPct / 100) * total)) : 0;
  return {
    ok: true,
    schema: PORTFOLIO_GUARD_SCHEMA,
    observedAt: now,
    riskPct: Number(riskPct.toFixed(2)),
    limitPct: policy.maxRiskPct,
    breach,
    proposal: breach ? {
      action: 'REBALANCE_TO_LOWER_RISK',
      reduceRiskWeightedExposureUsd: Number(reductionUsd.toFixed(2)),
      requiresFreshQuotes: true,
      requiresWalletConfirmation: true,
      automaticallyExecutes: false
    } : null
  };
}

export function createWalletAgentProfile({ walletRef, riskLimitPct = 20, resilience = 'high', now = Date.now() } = {}) {
  const ref = safeText(walletRef, 96);
  if (!ref || /^0x[a-f0-9]{40}$/i.test(ref)) return { ok: false, code: 'PSEUDONYMOUS_WALLET_REF_REQUIRED' };
  return {
    ok: true,
    profile: {
      schema: 'fbt.wallet-agent-profile.v1', walletRef: ref,
      riskLimitPct: clamp(finite(riskLimitPct) ?? 20, 1, 100),
      resilience: ['standard', 'high', 'maximum'].includes(resilience) ? resilience : 'high',
      successCount: 0, failureCount: 0, recoveryCount: 0,
      signerAccess: false, rawCredentials: false, createdAt: now
    }
  };
}

export function rankAgents(agents = []) {
  return agents.map((row) => {
    const completed = Math.max(0, finite(row.completed) || 0);
    const failed = Math.max(0, finite(row.failed) || 0);
    const recovered = Math.max(0, finite(row.recovered) || 0);
    const sample = completed + failed;
    const reliability = sample ? completed / sample : 0;
    const score = Math.round((reliability * 70 + Math.min(recovered, 10) * 2 + Math.min(sample, 100) / 10) * 100) / 100;
    return { id: safeText(row.id, 64), score, reliability: Number(reliability.toFixed(4)), sample, signerAccess: false };
  }).sort((a, b) => b.score - a.score || b.sample - a.sample || a.id.localeCompare(b.id));
}

/** Fee is zero for losses/break-even and is based on realised net profit. */
export function calculatePerformanceFee({ proceedsUsd, costBasisUsd, networkFeesUsd = 0, feeBps = PERFORMANCE_FEE_BPS } = {}) {
  const proceeds = finite(proceedsUsd);
  const cost = finite(costBasisUsd);
  const costs = Math.max(0, finite(networkFeesUsd) || 0);
  if (proceeds === null || cost === null || proceeds < 0 || cost < 0) return { ok: false, code: 'REALISED_VALUES_REQUIRED' };
  if (feeBps !== PERFORMANCE_FEE_BPS) return { ok: false, code: 'PERFORMANCE_FEE_POLICY_FIXED_AT_5_PERCENT' };
  const netProfitUsd = Math.max(0, proceeds - cost - costs);
  const feeUsd = netProfitUsd * feeBps / 10_000;
  return {
    ok: true,
    schema: 'fbt.realised-profit-fee.v1',
    realised: true,
    netProfitUsd: Number(netProfitUsd.toFixed(8)),
    feeBps,
    feePct: 5,
    feeUsd: Number(feeUsd.toFixed(8)),
    userProfitAfterFeeUsd: Number((netProfitUsd - feeUsd).toFixed(8)),
    lossCharged: false,
    requiresExplicitConsent: true,
    requiresWalletConfirmation: feeUsd > 0,
    atomicCollectionAllowedOnlyWhenQuoted: true
  };
}

export function buildProfitSettlement({ fee, destination = 'same-wallet', externalAddressVerified = false, feeRecipientConfigured = false } = {}) {
  const blockers = [];
  if (!fee?.ok || fee.realised !== true) blockers.push('VERIFIED_REALIZED_PROFIT_REQUIRED');
  if (!['same-wallet', 'external-wallet'].includes(destination)) blockers.push('DESTINATION_REQUIRED');
  if (destination === 'external-wallet' && externalAddressVerified !== true) blockers.push('EXTERNAL_ADDRESS_VERIFICATION_REQUIRED');
  if (fee?.feeUsd > 0 && feeRecipientConfigured !== true) blockers.push('FEE_RECIPIENT_NOT_CONFIGURED');
  return {
    ok: blockers.length === 0,
    schema: 'fbt.profit-settlement-proposal.v1',
    destination,
    fee,
    blockers,
    automaticTransfer: false,
    requiresOneFinalWalletConfirmation: true,
    canBeAtomic: blockers.length === 0,
    note: 'The app prepares the settlement; the wallet remains the final authority.'
  };
}

export function cexEligibility({ entityCountry, customerCountry, kycAvailable = false, requestsKycBypass = false, venueLicensed = false } = {}) {
  const iranRelated = [entityCountry, customerCountry].some((row) => /^(IR|IRAN|ایران)$/i.test(safeText(row, 32)));
  const blockers = [];
  if (requestsKycBypass) blockers.push('KYC_BYPASS_PROHIBITED');
  if (!kycAvailable) blockers.push('KYC_PROGRAM_REQUIRED');
  if (!venueLicensed) blockers.push('LICENSE_OR_AUTHORISED_PARTNER_REQUIRED');
  if (iranRelated) blockers.push('IRAN_SANCTIONS_LEGAL_REVIEW_REQUIRED');
  return {
    ok: blockers.length === 0,
    decision: blockers.length ? 'DO_NOT_OPERATE_CEX' : 'LEGAL_REVIEW_PASSED_PRELIMINARILY',
    blockers,
    suggestsNoKycWorkaround: false,
    alternative: 'Keep the product non-custodial and integrate compliant external venues only after counsel approval.'
  };
}

const EVIDENCE_LESSONS = Object.freeze({
  'approved-durable-registry': 'ثبت پایدار و قابل بازیابی عامل‌ها را بررسی کنید.',
  'certificate-authority': 'صادرکننده، انقضا و ابطال گواهی را کنترل کنید.',
  'sandbox-operator': 'ایزوله بودن اجرای عامل را با آزمون واقعی بسنجید.',
  simulator: 'همان تراکنش نهایی را قبل از امضا شبیه‌سازی کنید.',
  monitor: 'تازگی مانیتور و زمان آخرین مشاهده را ببینید.',
  'scheduler-operator': 'مجوز و توقف‌پذیری زمان‌بند را کنترل کنید.',
  'smart-wallet': 'سقف اختیار کیف هوشمند را کم و قابل ابطال نگه دارید.',
  'independent-guardian': 'استقلال Guardian از signer را اثبات کنید.',
  'production-signer': 'Signer باید policy-bound باشد و کلید خام افشا نکند.',
  'wallet-provider': 'زنجیره، حساب و پاسخ RPC کیف پول را تطبیق دهید.',
  'broker-provider': 'مجوز، سلامت و محدودیت منطقه‌ای بروکر را کنترل کنید.',
  'bridge-provider': 'ریسک پل و غیراتمیک بودن بین‌زنجیره‌ای را بپذیرید.',
  'venue-health': 'سلامت، نقدینگی و عمر quote بازار را بررسی کنید.',
  rpc: 'چند RPC مستقل و اختلاف پاسخ‌ها را کنترل کنید.',
  'policy-contract': 'آدرس و code hash قرارداد policy را تطبیق دهید.',
  'durable-immutable-audit': 'زنجیره رویدادها باید tamper-evident باشد.',
  'backup-restore-drill': 'بازیابی را عملاً تمرین کنید؛ وجود backup کافی نیست.',
  'independent-security-review': 'ممیزی باید مستقل، دارای scope و قابل بررسی باشد.',
  'reproducible-deployment': 'build منتشرشده را از commit و lockfile بازتولید کنید.',
  'rollback-drill': 'بازگشت نسخه را با زمان و نتیجه واقعی تمرین کنید.',
  'slo-measurement': 'SLO را از داده زنده بسنجید، نه از ادعا.'
});

export function evidenceLearningChecklist({ completed = [] } = {}) {
  const done = new Set(completed);
  const lessons = EVIDENCE_KINDS.map((kind, index) => ({
    number: index + 1,
    kind,
    lessonFa: EVIDENCE_LESSONS[kind],
    completed: done.has(kind),
    operationalEvidence: false
  }));
  return {
    schema: 'fbt.personal-evidence-learning.v1',
    lessons,
    completed: lessons.filter((row) => row.completed).length,
    total: 21,
    warning: 'تکمیل آموزش شخصی، جایگزین شواهد عملیاتی معتبر و جاری نیست.'
  };
}

export function autonomousScenarios() {
  return [
    { id: 'rpc-failure', goal: 'سواپ اسپات', outcome: 'تعویض RPC و تکرار شبیه‌سازی؛ بدون ارسال دوباره تراکنش' },
    { id: 'route-change', goal: 'بهترین مسیر 0x', outcome: 'محاسبه quote جدید و درخواست تأیید دوباره به علت تغییر شروط' },
    { id: 'risk-20', goal: 'ریسک سبد زیر ۲۰٪', outcome: 'مانیتور و پیشنهاد rebalance؛ اجرا فقط با تأیید کیف پول' },
    { id: 'profit-loss', goal: 'تسویه سود', outcome: 'در زیان یا سر‌به‌سر، کارمزد عملکرد صفر' },
    { id: 'profit-positive', goal: 'تسویه سود محقق‌شده', outcome: 'نمایش ۵٪ کارمزد از سود خالص و مقصد؛ سپس یک تأیید نهایی' },
    { id: 'cross-chain', goal: 'workflow بین‌زنجیره‌ای', outcome: 'غیراتمیک اعلام می‌شود و هر مرحله جداگانه تأیید می‌خواهد' },
    { id: 'cex-iran', goal: 'CEX بدون KYC برای شرکت ایرانی', outcome: 'رد می‌شود؛ هیچ راه دور زدن KYC پیشنهاد نمی‌شود' }
  ];
}
