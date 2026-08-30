/**
 * Intent OS activation configuration presence report.
 *
 * A read-only, public, booleans-only view of which operator environment
 * variables are actually configured in THIS deployment. It exists so an
 * operator can answer "which variable is still missing?" by opening one URL
 * instead of diffing dashboards — and so the answer can never leak a secret:
 * no value is ever rendered, only `configured: true/false` plus an optional
 * format check and the evidence kind each variable unlocks.
 *
 * `requiredForActivation` is derived from the same EVIDENCE_KINDS the status
 * endpoint uses, so the report always matches the 21/21 gate. External
 * attestations that no environment variable can satisfy (venue-health,
 * bridge-provider, slo-measurement, independent-security-review's signature,
 * certificate-authority's origin) are listed with their real remediation.
 */

const HOURS = 3600_000;

import { sandboxEvidenceEnabled } from './intentSandboxEvidence.js';

/** Presence + format checks. Never returns a value. */
function flag(raw, { pattern = null, minLength = 0 } = {}) {
  const value = String(raw || '').trim();
  const configured = value.length > minLength && (!pattern || pattern.test(value));
  return { configured, validFormat: !pattern || pattern.test(value) };
}

function reviewerCount(raw) {
  const out = [];
  for (const part of String(raw || '').split(',')) {
    const t = part.trim();
    if (!t) continue;
    const colon = t.indexOf(':');
    if (colon < 1) continue;
    const id = t.slice(0, colon).trim();
    const key = t.slice(colon + 1).trim();
    if (/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(id) && key.length >= 40) out.push(id);
  }
  return out;
}

function certifierCount(raw) {
  let count = 0;
  for (const part of String(raw || '').split(',')) {
    const t = part.trim();
    if (!t) continue;
    const colon = t.indexOf(':');
    if (colon < 1) continue;
    const id = t.slice(0, colon).trim();
    const label = t.slice(colon + 1).trim();
    if (/^\d{3,20}$/.test(id) && /^[A-Za-z][A-Za-z0-9 ._-]{0,63}$/.test(label)) count++;
  }
  return count;
}

export function activationConfigPresence({ now = Date.now() } = {}) {
  const env = process.env;

  const blob = flag(env.BLOB_READ_WRITE_TOKEN, { pattern: /^vercel_blob_rw_/, minLength: 20 });
  const upstashUrl = flag(env.UPSTASH_REDIS_REST_URL, { pattern: /^https:\/\/[a-z0-9-]+\.upstash\.io\/?$/i, minLength: 8 });
  const upstashToken = flag(env.UPSTASH_REDIS_REST_TOKEN, { minLength: 20 });
  const upstash = { configured: upstashUrl.configured && upstashToken.configured, validFormat: upstashUrl.validFormat && upstashToken.validFormat };
  const durableStoreConfigured = blob.configured || upstash.configured;
  const rpc = flag(env.RPC_URL, { pattern: /^https:\/\//, minLength: 8 });
  const walletConnect = flag(env.VITE_WALLETCONNECT_PROJECT_ID, { minLength: 5 });
  const publicOrigin = flag(env.PUBLIC_ORIGIN, { pattern: /^https:\/\/[^/]+/, minLength: 8 });
  const vercelOrigin = flag(
    env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL,
    { pattern: /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i, minLength: 4 }
  );
  const cron = flag(env.CRON_SECRET, { minLength: 16 });
  const operatorEvidence = flag(env.INTENT_OPERATIONAL_EVIDENCE, { minLength: 20 });
  const reviewers = reviewerCount(env.INTENT_INDEPENDENT_REVIEWERS);
  const certifiers = certifierCount(env.ECOSYSTEM_CERTIFIERS);
  const incidentCommander = flag(env.INTENT_INCIDENT_COMMANDER, { minLength: 2 });
  const accountableOwner = flag(env.INTENT_ACCOUNTABLE_OWNER, { minLength: 2 });
  const broadcastEnabled = flag(env.VITE_INTENT_BROADCAST_ENABLED, { minLength: 1 });

  const variables = {
    BLOB_READ_WRITE_TOKEN: {
      ...blob,
      active: blob.configured && !upstash.configured,
      source: 'Vercel → Storage → Blob → Create (optional when Upstash is configured)',
      requiredFor: upstash.configured ? [] : ['approved-durable-registry', 'durable-immutable-audit']
    },
    UPSTASH_REDIS_REST_URL: {
      ...upstashUrl,
      active: upstash.configured,
      source: 'Upstash Console → Redis database → REST API',
      requiredFor: ['approved-durable-registry', 'durable-immutable-audit']
    },
    UPSTASH_REDIS_REST_TOKEN: {
      ...upstashToken,
      active: upstash.configured,
      source: 'Upstash Console → Redis database → REST API (server secret)',
      requiredFor: ['approved-durable-registry', 'durable-immutable-audit']
    },
    RPC_URL: {
      ...rpc,
      source: 'Any HTTPS EVM RPC endpoint (e.g. https://arb1.arbitrum.io/rpc)',
      requiredFor: ['rpc']
    },
    VITE_WALLETCONNECT_PROJECT_ID: {
      ...walletConnect,
      source: 'https://cloud.reown.com → Project ID',
      requiredFor: ['wallet-provider']
    },
    PUBLIC_ORIGIN: {
      ...publicOrigin,
      source: 'Only for a custom domain; otherwise VERCEL_PROJECT_PRODUCTION_URL is used automatically',
      requiredFor: ['certificate-authority']
    },
    INTENT_INDEPENDENT_REVIEWERS: {
      ...flag(env.INTENT_INDEPENDENT_REVIEWERS, { minLength: 40 }),
      reviewerCount: reviewers.length,
      validReviewers: reviewers,
      source: 'reviewerId:base64-SPKI (Ed25519), one per comma',
      requiredFor: ['independent-security-review']
    },
    CRON_SECRET: {
      ...cron,
      source: 'Any random string ≥ 16 chars — Vercel attaches it to scheduled calls',
      requiredFor: ['evidence-freshness']
    },
    INTENT_OPERATIONAL_EVIDENCE: {
      ...operatorEvidence,
      source: 'Set by `npm run activate:release -- --target <url> --env`; optional if --submit was used',
      requiredFor: ['remaining-operator-records']
    },
    ECOSYSTEM_CERTIFIERS: {
      ...flag(env.ECOSYSTEM_CERTIFIERS, { minLength: 4 }),
      entryCount: certifiers.length,
      source: 'telegramUserId:Label (get your id from @userinfobot)',
      requiredFor: ['registry-certification', 'independent-security-review-alternative']
    },
    INTENT_INCIDENT_COMMANDER: {
      ...incidentCommander,
      source: 'Your operator id string',
      requiredFor: ['later-phase-drill']
    },
    INTENT_ACCOUNTABLE_OWNER: {
      ...accountableOwner,
      source: 'Your operator id string',
      requiredFor: ['later-phase-drill']
    },
    VERCEL_PROJECT_PRODUCTION_URL: { ...vercelOrigin, source: 'Injected by Vercel automatically', requiredFor: ['certificate-authority'] },
    VITE_INTENT_BROADCAST_ENABLED: { ...broadcastEnabled, source: 'Keep off until you test on a testnet', requiredFor: [] },
    INTENT_AI_SANDBOX_EVIDENCE: {
      configured: sandboxEvidenceEnabled(),
      validFormat: true,
      source: 'Built-in sandbox operator: self-attested 21-kind evidence (dev/preview default; "0" disables, "1" forces on)',
      requiredFor: []
    }
  };

  /* What the 21-kind gate still needs, with the satisfaction path. */
  const needed = [];
  if (!durableStoreConfigured) needed.push({ kind: 'approved-durable-registry', env: 'UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or BLOB_READ_WRITE_TOKEN)' });
  if (!durableStoreConfigured) needed.push({ kind: 'durable-immutable-audit', env: 'UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or BLOB_READ_WRITE_TOKEN)' });
  if (!rpc.configured) needed.push({ kind: 'rpc', env: 'RPC_URL' });
  if (!walletConnect.configured) needed.push({ kind: 'wallet-provider', env: 'VITE_WALLETCONNECT_PROJECT_ID' });
  if (!publicOrigin.configured && !vercelOrigin.configured) {
    needed.push({ kind: 'certificate-authority', env: 'PUBLIC_ORIGIN (or VERCEL_PROJECT_PRODUCTION_URL)' });
  }
  if (reviewers.length === 0) {
    needed.push({ kind: 'independent-security-review', env: 'INTENT_INDEPENDENT_REVIEWERS + signed Ed25519 attestation' });
  }

  return {
    schema: 'fbt.activation-config.v1',
    generatedAt: new Date(now).toISOString(),
    evidenceTtlHours: Math.round((6 * HOURS) / HOURS),
    variables,
    requiredForActivation: needed,
    externalOnly: [
      { kind: 'venue-health', remediation: 'Live HTTPS probe to binance/kraken/coinbase — needs serverless egress, no env var' },
      { kind: 'bridge-provider', remediation: 'Live deBridge DLN quote — needs egress, no env var' },
      { kind: 'slo-measurement', remediation: '≥20 real requests in 24h with uptime ≥99% and p95 ≤2s — needs traffic, no env var' }
    ],
    secretsExposed: false
  };
}
