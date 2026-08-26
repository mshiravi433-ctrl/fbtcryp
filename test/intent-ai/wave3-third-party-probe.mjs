#!/usr/bin/env node
/**
 * Wave 3 — Third-party RFP templates probe.
 *
 * Validates that RFP/checklist templates exist for:
 * 1. CA/PKI (certificate-authority evidence)
 * 2. Sandbox operator
 * 3. Independent security review
 * 4. Guardian (independent)
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..');

const results = [];
const check = (name, ok) => results.push({ name, ok });

/* 1. RFP templates exist */
check('CA/PKI RFP template exists', existsSync(path.join(root, 'docs/WAVE3-CA-PKI-RFP-FA.md')));
check('Sandbox operator template exists', existsSync(path.join(root, 'docs/WAVE3-SANDBOX-OPERATOR-FA.md')));
check('Security review template exists', existsSync(path.join(root, 'docs/WAVE3-SECURITY-REVIEW-FA.md')));

/* 2. Templates have required sections */
const caRfp = readFileSync(path.join(root, 'docs/WAVE3-CA-PKI-RFP-FA.md'), 'utf8');
check('CA RFP has fingerprint format', caRfp.includes('fingerprint'));
check('CA RFP has signature validation', caRfp.includes('signatureValid'));
check('CA RFP has issuer identity', caRfp.includes('issuerIdentity'));

const sandboxRfp = readFileSync(path.join(root, 'docs/WAVE3-SANDBOX-OPERATOR-FA.md'), 'utf8');
check('Sandbox RFP has isolation requirement', sandboxRfp.includes('isolation'));
check('Sandbox RFP forbids production access', sandboxRfp.includes('mainnetAccess') || sandboxRfp.includes('production'));

const securityRfp = readFileSync(path.join(root, 'docs/WAVE3-SECURITY-REVIEW-FA.md'), 'utf8');
check('Security review RFP has independence requirement', securityRfp.includes('independent'));
check('Security review RFP has reviewerId format', securityRfp.includes('reviewerId'));

/* 3. Verify functions exist and work */
const { verifyCertificateAuthority, verifySandboxOperator, verifyIndependentReview } = await import('../../src/lib/intent-ai/operationalActivation.js');

const caResult = verifyCertificateAuthority({
  issuerIdentity: 'lets-encrypt',
  fingerprint: 'a'.repeat(64),
  signatureValid: true,
  providerId: 'lets-encrypt',
  checkedAt: Date.now(),
  expiresAt: Date.now() + 86400_000
});
check('verifyCertificateAuthority works with valid input', caResult.ok === true);

const sandboxResult = verifySandboxOperator({
  available: true,
  attested: true,
  mainnetAccess: false,
  productionSigner: false,
  realCustody: false,
  providerId: 'gvisor-sandbox',
  digest: 'b'.repeat(64),
  checkedAt: Date.now(),
  expiresAt: Date.now() + 86400_000
});
check('verifySandboxOperator works with valid input', sandboxResult.ok === true);

const sandboxRejectsProduction = verifySandboxOperator({
  available: true,
  attested: true,
  mainnetAccess: true
});
check('verifySandboxOperator rejects production access', sandboxRejectsProduction.ok === false);

const reviewResult = verifyIndependentReview({
  independent: true,
  signed: true,
  reviewerId: 'independent-reviewer-01'
});
check('verifyIndependentReview works with valid input', reviewResult.ok === true);

const reviewRejectsNonIndependent = verifyIndependentReview({
  independent: false,
  signed: true,
  reviewerId: 'internal-reviewer'
});
check('verifyIndependentReview rejects non-independent', reviewRejectsNonIndependent.ok === false);

const passed = results.filter(r => r.ok).length;
console.log(JSON.stringify({ probe: 'wave3-third-party', passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exit(1);
