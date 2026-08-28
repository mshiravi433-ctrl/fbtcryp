/**
 * FBT INTENT AI — Stage 3 digest probe.
 *
 * Stage 3 kinds are attestations about *other parties*. This file never
 * self-issues them. What it does produce is a public digest of the current
 * facts so an operator can see, in one place, why each kind is still missing
 * and what would have to happen for it to become earnable.
 *
 *   independent-security-review  signed report from a non-internal reviewer
 *   production-signer            policy-bound KMS key (DEPLOYER_KMS_KEY_ID)
 *   smart-wallet                 Smart Account with an independent guardian
 *   independent-guardian         a guardian that is not the user
 *   broker-provider              a trade-only broker handle, no withdrawals
 *   bridge-provider              a real quote from a public bridge API
 *
 * One exception is measured, not attested: `bridge-provider` can be earned
 * here IF a public quote actually returns, because that is a fact this
 * process can check by contacting deBridge. The other five stay fail-closed.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dlnQuote } from './dln.js';
import { verifyProviderHealth } from '../src/lib/intent-ai/operationalActivation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const STAGE3_SCHEMA = 'fbt.stage3-digest.v1';
export const STAGE3_KINDS = Object.freeze([
  'independent-security-review',
  'production-signer',
  'smart-wallet',
  'independent-guardian',
  'broker-provider',
  'bridge-provider'
]);

const HOUR = 3600_000;

function sha256(...parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

function hashFiles(relPaths) {
  const parts = [];
  for (const rel of relPaths) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    parts.push(rel, fs.readFileSync(abs, 'utf8'));
  }
  return sha256(...parts);
}

function missing(kind, code, extra = {}) {
  return {
    ok: false,
    kind,
    code,
    evidence: undefined,
    ...extra
  };
}

function evidenceRecord({ kind, providerId, digest, now, ttlHours = 6 }) {
  return {
    kind,
    providerId,
    digest,
    checkedAt: now,
    expiresAt: now + ttlHours * HOUR,
    status: 'verified',
    health: 'healthy',
    attested: true
  };
}

/**
 * Digest of the files an independent auditor would actually review.
 * This is a package identity, not a signed review — so it never becomes
 * `independent-security-review` evidence.
 */
export function reviewPackageDigest() {
  return hashFiles([
    'contracts/FeeRouter.sol',
    'contracts/IntentWorkflowBatch.sol',
    'contracts/IntentMerkleRootAnchor.sol',
    'contracts/IntentAuctionAnchor.sol',
    'scripts/lib/kmsAdapter.mjs',
    'src/lib/intent-ai/operationalActivation.js',
    'src/lib/intent-ai/guardian.js',
    'src/lib/intent-ai/smartWalletPolicy.js',
    'src/lib/intent-ai/confirmationGate.js',
    'src/lib/intent-ai/riskEngine.js',
    'server/intentOperatorEvidence.js',
    'server/intentOperationalDrills.js'
  ]);
}

export function productionSignerStatus() {
  const kmsKeyId = String(process.env.DEPLOYER_KMS_KEY_ID || '').trim();
  const awsRegion = String(process.env.AWS_REGION || '').trim();
  const configured = Boolean(kmsKeyId && awsRegion);
  return {
    configured,
    policyBoundInterface: true,
    kmsBound: configured,
    exposesPrivateKey: false,
    adapterDigest: hashFiles(['scripts/lib/kmsAdapter.mjs', 'src/lib/intent-ai/phase25SignerGuardianOps.js'])
  };
}

export function smartWalletGuardianStatus() {
  return {
    walletAvailable: false,
    guardianIndependent: false,
    guardianApproved: false,
    reason: 'INDEPENDENT_GUARDIAN_REQUIRED',
    policyDigest: hashFiles([
      'src/lib/intent-ai/smartWalletPolicy.js',
      'src/lib/intent-ai/guardian.js',
      'src/lib/intent-ai/phase25SignerGuardianOps.js'
    ])
  };
}

export function brokerProviderStatus() {
  const handle = String(process.env.BROKER_HANDLE || process.env.CEX_TRADE_HANDLE || '').trim();
  return {
    configured: Boolean(handle),
    withdrawalsForbidden: true,
    adapterDigest: hashFiles(['src/lib/intent-ai/brokerAdapter.js'])
  };
}

/**
 * A real deBridge quote. USDC on Arbitrum → USDC on Ethereum, 1 USDC.
 * Keyless public API. Failure is the honest outcome when the network cannot
 * reach deBridge; success is the only path that issues bridge-provider
 * evidence.
 */
export async function probeBridgeProvider({ now = Date.now(), timeoutMs = 8_000 } = {}) {
  const started = Date.now();
  let quote;
  try {
    let timer = null;
    quote = await Promise.race([
      dlnQuote({
        srcChainId: 42161,
        dstChainId: 1,
        srcChainTokenIn: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        dstChainTokenOut: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        srcChainTokenInAmount: '1000000'
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('BRIDGE_QUOTE_TIMEOUT')), timeoutMs);
        if (timer.unref) timer.unref();
      })
    ]).finally(() => { if (timer) clearTimeout(timer); });
  } catch (e) {
    return missing('bridge-provider', 'BRIDGE_QUOTE_UNREACHABLE', {
      detail: { message: e.message, latencyMs: Date.now() - started }
    });
  }

  if (!quote?.ok || !quote.body?.toAmount) {
    return missing('bridge-provider', quote?.body?.error || 'BRIDGE_QUOTE_STALE', {
      detail: { httpStatus: quote?.status ?? 0, latencyMs: Date.now() - started }
    });
  }

  const digest = sha256(
    'bridge-provider',
    'debridge-dln',
    String(quote.body.toAmount),
    String(quote.body.fixFee ?? ''),
    String(now)
  );
  const record = evidenceRecord({
    kind: 'bridge-provider',
    providerId: 'debridge-dln',
    digest,
    now
  });
  const verdict = verifyProviderHealth({
    kind: 'bridge-provider',
    providerId: record.providerId,
    digest: record.digest,
    checkedAt: record.checkedAt,
    expiresAt: record.expiresAt,
    available: true,
    attested: true,
    health: 'healthy'
  }, { now });

  if (!verdict.ok) {
    return missing('bridge-provider', verdict.code || 'PROVIDER_HEALTH_FAILURE');
  }

  return {
    ok: true,
    kind: 'bridge-provider',
    detail: {
      toAmount: quote.body.toAmount,
      fixFee: quote.body.fixFee ?? null,
      latencyMs: Date.now() - started
    },
    evidence: record
  };
}

export async function runStage3Digest({ now = Date.now() } = {}) {
  const reviewDigest = reviewPackageDigest();
  const signer = productionSignerStatus();
  const wallet = smartWalletGuardianStatus();
  const broker = brokerProviderStatus();
  const bridge = await probeBridgeProvider({ now });

  const byKind = {
    'independent-security-review': missing('independent-security-review', 'SECURITY_REVIEW_NOT_INDEPENDENT', {
      detail: {
        reviewPackageDigest: reviewDigest,
        independent: false,
        signed: false,
        hint: 'An external auditor must sign a report whose digest covers this package.'
      }
    }),
    'production-signer': signer.configured
      ? missing('production-signer', 'SIGNER_WITHOUT_POLICY', {
          detail: { ...signer, hint: 'KMS is configured but no policy-bound signing attestation has been injected.' }
        })
      : missing('production-signer', 'SIGNER_WITHOUT_POLICY', {
          detail: { ...signer, hint: 'Set DEPLOYER_KMS_KEY_ID and AWS_REGION. Raw DEPLOYER_PRIVATE_KEY is testnet-only.' }
        }),
    'smart-wallet': missing('smart-wallet', 'SMART_WALLET_WITHOUT_GUARDIAN', {
      detail: { ...wallet, hint: 'A Smart Account plus an independent guardian service is required.' }
    }),
    'independent-guardian': missing('independent-guardian', 'SMART_WALLET_WITHOUT_GUARDIAN', {
      detail: { ...wallet, hint: 'Guardian identity must not equal the user. Inject via operator-evidence.' }
    }),
    'broker-provider': broker.configured
      ? missing('broker-provider', 'PROVIDER_HEALTH_FAILURE', {
          detail: { ...broker, hint: 'A handle is configured but health has not been attested.' }
        })
      : missing('broker-provider', 'PROVIDER_HEALTH_FAILURE', {
          detail: { ...broker, hint: 'Set a trade-only BROKER_HANDLE. Withdrawal permission is forbidden.' }
        }),
    'bridge-provider': bridge
  };

  const earned = Object.values(byKind).filter((r) => r.ok).map((r) => r.evidence);

  if (earned.length > 0) {
    try {
      const { autoStoreEvidence } = await import('./intentOperatorEvidence.js');
      for (const record of earned) autoStoreEvidence(record);
    } catch { /* store unavailable */ }
  }

  return {
    schema: STAGE3_SCHEMA,
    checkedAt: now,
    earnedCount: earned.length,
    totalKinds: STAGE3_KINDS.length,
    earned: earned.map((e) => ({ kind: e.kind, providerId: e.providerId, digest: e.digest, expiresAt: e.expiresAt })),
    missing: Object.entries(byKind)
      .filter(([, r]) => !r.ok)
      .map(([kind, r]) => ({
        kind,
        code: r.code,
        digest: r.detail?.reviewPackageDigest || r.detail?.adapterDigest || r.detail?.policyDigest || null,
        hint: r.detail?.hint || null
      })),
    digests: {
      reviewPackage: reviewDigest,
      productionSignerAdapter: signer.adapterDigest,
      smartWalletPolicy: wallet.policyDigest,
      brokerAdapter: broker.adapterDigest,
      bridge: bridge.ok ? bridge.evidence.digest : null
    },
    byKind
  };
}
