/**
 * Import this module FIRST in any probe that proves fail-closed boot
 * ("no operator evidence ⇒ no launch"). The built-in sandbox operator
 * (server/intentSandboxEvidence.js) self-attests the 21 evidence kinds in
 * dev/preview, which would defeat exactly the property those probes measure.
 *
 * ESM evaluates imports in declaration order, so placing this import before
 * `import app from '../../server/app.js'` guarantees the flag is set before
 * `seedSandboxEvidence()` runs at server/app.js module load — the same
 * guarantee test/run.mjs pins for the whole harness run.
 */
process.env.INTENT_AI_SANDBOX_EVIDENCE = '0';
