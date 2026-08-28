/**
 * Re-export of the probe library that now lives in server/evidenceProbes.js.
 *
 * The probes moved into server/ because the deployment itself runs them: an
 * operator without a workstation cannot execute a CLI, so the same code has to
 * be reachable from the serverless function. Keeping this path alive means the
 * CLI, the docs and any existing automation keep working unchanged.
 */
export * from '../../server/evidenceProbes.js';
