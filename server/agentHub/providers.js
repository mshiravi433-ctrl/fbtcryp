/**
 * FBT EXTERNAL AGENT HUB — reviewed provider registry (§7, §10A, §11).
 * ---------------------------------------------------------------------------
 * THERE IS NO BUILT-IN PROVIDER IN THIS FILE, AND THAT IS THE POINT.
 *
 * The Hub can only ever list a provider that (a) a human reviewed and approved
 * in a written decision record, and (b) an operator then configured on the
 * server. Adding a listing requires an entry here — server-side, reviewed with
 * the deployment — not a pull request that hard-codes a marketing claim and not
 * a client request that names a URL.
 *
 * The operator supplies entries through `AGENT_HUB_PROVIDERS_JSON` (an array of
 * the records below). Every entry is validated against the review requirements
 * before it can become visible; an entry that fails validation is not silently
 * dropped — it is reported in `/provider-health` with its refusal code, because
 * a provider the operator believes is live but is not is worse than one that was
 * never added.
 *
 * WHAT AN ENTRY MUST PROVE
 *   identity      name, website, documentation, terms, privacy, support contact
 *   review        approvalStatus ∈ APPROVED_*, reviewedAt, reviewedBy, and a
 *                 decision-record URL that a third party can read
 *   jurisdiction  operator jurisdiction + target regions + the provider's own
 *                 restrictions/eligibility rules. Approval of a
 *                 jurisdiction-sensitive provider without this is refused —
 *                 nationality alone is never treated as residence.
 *   technical     A2A integration with a published Agent Card, an RPC endpoint
 *                 on an allowlisted host, and an explicit access model
 *   economics     no FBT prepayment/master account; free, user-account or
 *                 provider-native direct payment only
 *
 * Unsupported commercial models (FBT_PREPAID, FBT_MASTER_ACCOUNT,
 * FBT_RESELLS_SUBSCRIPTION, FBT_CUSTODIAL_PAYMENT, FBT_AUTO_RENEWING_CRYPTO)
 * are refused by name — a provider that only works that way is deferred, not
 * bent into this project.
 */

export const REGISTRY_SCHEMA = 'fbt.agent-hub.registry.v1';

/** The access models this project supports (§6). */
export const ACCESS_MODELS = Object.freeze([
  'FREE_PUBLIC', 'FREE_ACCOUNT', 'EXTERNAL_SUBSCRIPTION', 'DIRECT_CRYPTO_PAYMENT', 'PROVIDER_SPONSORED'
]);

/** Refused by name (§6) so a config cannot smuggle one in. */
export const UNSUPPORTED_ACCESS_MODELS = Object.freeze([
  'FBT_PREPAID', 'FBT_MASTER_ACCOUNT', 'FBT_RESELLS_SUBSCRIPTION', 'FBT_CUSTODIAL_PAYMENT', 'FBT_AUTO_RENEWING_CRYPTO'
]);

export const APPROVAL_STATUSES = Object.freeze([
  'APPROVED_FREE', 'APPROVED_ACCOUNT_REQUIRED', 'APPROVED_DIRECT_PAID',
  'TECHNICAL_ONLY', 'BLOCKED_COMMERCIAL', 'BLOCKED_JURISDICTION', 'BLOCKED_SECURITY',
  'UNVERIFIED'
]);

/** Only these may be publicly visible. */
export const PUBLIC_APPROVALS = Object.freeze([
  'APPROVED_FREE', 'APPROVED_ACCOUNT_REQUIRED', 'APPROVED_DIRECT_PAID'
]);

export const INTEGRATION_TYPES = Object.freeze(['A2A', 'PROVIDER_TASK_API']);

const ID_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const HTTPS_RE = /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isHttps = (v) => typeof v === 'string' && HTTPS_RE.test(v) && !/^https:\/\/[^/]*@/.test(v);
/** The single loopback exception: a test server, never production (§19). */
const loopbackOk = (v, env) => String(env?.AGENT_HUB_ALLOW_LOOPBACK || '') === '1'
  && String(env?.NODE_ENV || '') !== 'production'
  && typeof v === 'string'
  && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(v)
  && !/^http:\/\/[^/]*@/.test(v);
const isProviderUrl = (v, env) => isHttps(v) || loopbackOk(v, env);
const hostOf = (v) => { try { return new URL(v).hostname.toLowerCase(); } catch { return ''; } };

/**
 * Validate one operator-supplied provider record.
 * Returns `{ ok:true, provider }` or `{ ok:false, code, field }` — never a
 * partially-trusted record.
 */
export function validateProviderRecord(input = {}, { env = process.env } = {}) {
  const id = str(input.id, 40);
  if (!ID_RE.test(id)) return { ok: false, code: 'PROVIDER_ID_INVALID', field: 'id' };

  const name = str(input.name, 80);
  if (name.length < 2) return { ok: false, code: 'PROVIDER_NAME_REQUIRED', field: 'name' };

  for (const field of ['websiteUrl', 'documentationUrl', 'termsUrl', 'privacyUrl']) {
    if (!isHttps(input[field])) return { ok: false, code: `PROVIDER_${field.toUpperCase()}_REQUIRED`, field };
  }

  const integrationType = str(input.integrationType, 32).toUpperCase();
  if (!INTEGRATION_TYPES.includes(integrationType)) {
    return { ok: false, code: 'PROVIDER_INTEGRATION_UNSUPPORTED', field: 'integrationType' };
  }

  const accessModel = str(input.accessModel, 40).toUpperCase();
  if (UNSUPPORTED_ACCESS_MODELS.includes(accessModel)) {
    return { ok: false, code: 'PROVIDER_ACCESS_MODEL_UNSUPPORTED', field: 'accessModel', detail: `${accessModel} is not a model this project implements` };
  }
  if (!ACCESS_MODELS.includes(accessModel)) {
    return { ok: false, code: 'PROVIDER_ACCESS_MODEL_UNKNOWN', field: 'accessModel' };
  }

  const approvalStatus = str(input.approvalStatus, 40).toUpperCase();
  if (!APPROVAL_STATUSES.includes(approvalStatus)) {
    return { ok: false, code: 'PROVIDER_APPROVAL_STATUS_INVALID', field: 'approvalStatus' };
  }
  if (!PUBLIC_APPROVALS.includes(approvalStatus)) {
    return { ok: false, code: 'PROVIDER_NOT_APPROVED', field: 'approvalStatus', detail: `${approvalStatus} may not be published` };
  }

  const evidence = input.approvalEvidence || {};
  const reviewedAt = str(evidence.reviewedAt, 10);
  if (!ISO_DATE_RE.test(reviewedAt)) return { ok: false, code: 'PROVIDER_REVIEW_DATE_REQUIRED', field: 'approvalEvidence.reviewedAt' };
  if (!str(evidence.reviewedBy, 80)) return { ok: false, code: 'PROVIDER_REVIEWER_REQUIRED', field: 'approvalEvidence.reviewedBy' };
  if (!isHttps(evidence.documentUrl)) return { ok: false, code: 'PROVIDER_DECISION_RECORD_REQUIRED', field: 'approvalEvidence.documentUrl' };

  /* Jurisdiction is a hard gate, not a note (§7). An approval that cannot name
     the operator jurisdiction and the target regions is not an approval. */
  const jurisdiction = evidence.jurisdiction || {};
  const operatorJurisdiction = str(jurisdiction.operatorJurisdiction, 40);
  const targetRegions = Array.isArray(jurisdiction.targetRegions) ? jurisdiction.targetRegions.map((r) => str(r, 40)).filter(Boolean) : [];
  if (!operatorJurisdiction) return { ok: false, code: 'PROVIDER_JURISDICTION_UNRESOLVED', field: 'approvalEvidence.jurisdiction.operatorJurisdiction' };
  if (!targetRegions.length) return { ok: false, code: 'PROVIDER_JURISDICTION_UNRESOLVED', field: 'approvalEvidence.jurisdiction.targetRegions' };

  const allowedHosts = Array.isArray(input.allowedHosts)
    ? input.allowedHosts.map((h) => str(h, 120).toLowerCase()).filter(Boolean).slice(0, 8)
    : [];
  if (!allowedHosts.length) return { ok: false, code: 'PROVIDER_ALLOWED_HOSTS_REQUIRED', field: 'allowedHosts' };

  const cardUrl = str(input.cardUrl, 400);
  if (!cardUrl) return { ok: false, code: 'PROVIDER_CARD_URL_REQUIRED', field: 'cardUrl' };
  if (!isProviderUrl(cardUrl, env)) return { ok: false, code: 'PROVIDER_CARD_URL_INVALID', field: 'cardUrl' };
  const cardHost = hostOf(cardUrl);
  if (!allowedHosts.some((h) => cardHost === h || cardHost.endsWith(`.${h}`))) {
    return { ok: false, code: 'PROVIDER_CARD_HOST_NOT_ALLOWLISTED', field: 'cardUrl' };
  }

  const rpcUrl = str(input.rpcUrl, 400) || null;
  if (rpcUrl) {
    if (!isProviderUrl(rpcUrl, env)) return { ok: false, code: 'PROVIDER_RPC_URL_INVALID', field: 'rpcUrl' };
    const rpcHost = hostOf(rpcUrl);
    if (!allowedHosts.some((h) => rpcHost === h || rpcHost.endsWith(`.${h}`))) {
      return { ok: false, code: 'PROVIDER_RPC_HOST_NOT_ALLOWLISTED', field: 'rpcUrl' };
    }
  }

  /* OAuth, when a provider supports it, must be a complete, per-user flow. */
  const auth = input.authorization || null;
  let authorization = null;
  if (auth) {
    if (auth.type !== 'OAUTH2') return { ok: false, code: 'PROVIDER_AUTHORIZATION_UNSUPPORTED', field: 'authorization.type' };
    if (!isProviderUrl(auth.authorizeUrl, env) || !isProviderUrl(auth.tokenUrl, env)) {
      return { ok: false, code: 'PROVIDER_AUTHORIZATION_URL_INVALID', field: 'authorization' };
    }
    const scopes = Array.isArray(auth.scopes) ? auth.scopes.map((s) => str(s, 60)).filter(Boolean).slice(0, 12) : [];
    if (!scopes.length) return { ok: false, code: 'PROVIDER_AUTHORIZATION_SCOPES_REQUIRED', field: 'authorization.scopes' };
    authorization = { type: 'OAUTH2', authorizeUrl: auth.authorizeUrl, tokenUrl: auth.tokenUrl, scopes, clientIdEnv: str(auth.clientIdEnv, 60) || null, clientSecretEnv: str(auth.clientSecretEnv, 60) || null };
  }

  const webhook = input.webhook || null;
  let webhookConfig = null;
  if (webhook) {
    const secretEnv = str(webhook.secretEnv, 60);
    if (!secretEnv) return { ok: false, code: 'PROVIDER_WEBHOOK_SECRET_ENV_REQUIRED', field: 'webhook.secretEnv' };
    webhookConfig = { secretEnv, signatureHeader: str(webhook.signatureHeader, 60) || 'x-fbt-signature', timestampHeader: str(webhook.timestampHeader, 60) || 'x-fbt-timestamp' };
  }

  const provider = {
    id,
    name,
    websiteUrl: input.websiteUrl,
    documentationUrl: input.documentationUrl,
    termsUrl: input.termsUrl,
    privacyUrl: input.privacyUrl,
    supportUrl: isHttps(input.supportUrl) ? input.supportUrl : null,
    integrationType,
    accessModel,
    approvalStatus,
    approvalEvidence: {
      reviewedAt,
      reviewedBy: str(evidence.reviewedBy, 80),
      documentUrl: evidence.documentUrl,
      jurisdiction: {
        operatorJurisdiction,
        targetRegions,
        providerRestrictions: Array.isArray(jurisdiction.providerRestrictions) ? jurisdiction.providerRestrictions.map((r) => str(r, 120)).filter(Boolean).slice(0, 12) : [],
        accountEligibility: str(jurisdiction.accountEligibility, 240) || null
      },
      promptTraining: str(evidence.promptTraining, 40) || 'unknown',
      dataRetention: str(evidence.dataRetention, 120) || 'unknown',
      notes: str(evidence.notes, 300) || null
    },
    allowedHosts,
    cardUrl,
    rpcUrl,
    authorization,
    webhook: webhookConfig,
    category: str(input.category, 32) || 'research',
    costSummary: str(input.costSummary, 160) || (accessModel === 'FREE_PUBLIC' ? 'Free (provider limits apply)' : ''),
    /** An operator switch on top of the review: approved ≠ enabled. */
    enabled: input.enabled !== false,
    lastVerifiedAt: null
  };
  return { ok: true, provider };
}

/** Parse the operator's JSON config. Never throws on bad operator input. */
export function loadProviderConfig(env = process.env) {
  const raw = String(env.AGENT_HUB_PROVIDERS_JSON || '').trim();
  if (!raw) return { providers: [], errors: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { providers: [], errors: [{ code: 'PROVIDER_CONFIG_NOT_JSON' }] };
  }
  if (!Array.isArray(parsed)) return { providers: [], errors: [{ code: 'PROVIDER_CONFIG_NOT_ARRAY' }] };

  const providers = [];
  const errors = [];
  const seen = new Set();
  for (const record of parsed.slice(0, 24)) {
    const checked = validateProviderRecord(record, { env });
    if (!checked.ok) {
      errors.push({ id: str(record?.id, 40) || '(missing id)', ...checked });
      continue;
    }
    if (seen.has(checked.provider.id)) {
      errors.push({ id: checked.provider.id, code: 'PROVIDER_ID_DUPLICATE' });
      continue;
    }
    seen.add(checked.provider.id);
    providers.push(checked.provider);
  }
  return { providers, errors };
}

/** The narrow-by-env switch: an operator can hide a configured provider without deleting it. */
function enabledByEnv(provider, env) {
  const list = String(env.AGENT_HUB_PROVIDERS || '').trim();
  if (!list) return true;
  return list.split(',').map((s) => s.trim()).filter(Boolean).includes(provider.id);
}

/**
 * The registry the rest of the Hub reads.
 *
 * `list()` returns only providers that passed review, are enabled and are not
 * hidden by env — in that order. `all()` is for `/provider-health`, which an
 * operator uses precisely to see what is NOT live and why.
 */
export function createRegistry({ env = process.env, now = () => Date.now() } = {}) {
  const loaded = loadProviderConfig(env);
  const providers = loaded.providers.map((p) => ({ ...p, enabled: p.enabled && enabledByEnv(p, env) }));

  const byId = new Map(providers.map((p) => [p.id, p]));

  return {
    schema: REGISTRY_SCHEMA,
    errors: loaded.errors,
    list: () => providers.filter((p) => p.enabled).map((p) => ({ ...p })),
    all: () => providers.map((p) => ({ ...p })),
    get: (id) => {
      const provider = byId.get(String(id));
      return provider && provider.enabled ? { ...provider } : null;
    },
    has: (id) => Boolean(byId.get(String(id))?.enabled),
    /** The browser never receives hosts, env names or review notes it cannot use. */
    publicView(provider) {
      return {
        id: provider.id,
        name: provider.name,
        websiteUrl: provider.websiteUrl,
        documentationUrl: provider.documentationUrl,
        termsUrl: provider.termsUrl,
        privacyUrl: provider.privacyUrl,
        supportUrl: provider.supportUrl,
        integrationType: provider.integrationType,
        accessModel: provider.accessModel,
        approvalStatus: provider.approvalStatus,
        category: provider.category,
        costSummary: provider.costSummary,
        requiresAccount: provider.accessModel === 'FREE_ACCOUNT' || provider.accessModel === 'EXTERNAL_SUBSCRIPTION',
        requiresPayment: provider.accessModel === 'DIRECT_CRYPTO_PAYMENT',
        jurisdiction: {
          targetRegions: provider.approvalEvidence.jurisdiction.targetRegions,
          providerRestrictions: provider.approvalEvidence.jurisdiction.providerRestrictions,
          accountEligibility: provider.approvalEvidence.jurisdiction.accountEligibility
        },
        dataPolicy: {
          promptTraining: provider.approvalEvidence.promptTraining,
          dataRetention: provider.approvalEvidence.dataRetention
        },
        reviewedAt: provider.approvalEvidence.reviewedAt,
        lastVerifiedAt: provider.lastVerifiedAt,
        at: now()
      };
    }
  };
}
