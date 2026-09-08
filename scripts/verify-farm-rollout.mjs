#!/usr/bin/env node
/**
 * CLI wrapper for the Farm rollout policy.
 *
 * The same assertion is imported by vite.config.js, so invoking `vite build`
 * directly cannot bypass this command. This wrapper remains useful in CI for a
 * clear, early summary before bundling starts.
 */
import { assertFarmRollout, formatFarmRollout } from './farm-rollout-policy.mjs';

try {
  const result = assertFarmRollout(process.env);
  console.log(formatFarmRollout(result));
  if (result.mode === 'limited-canary') {
    console.log('Strict-fork evidence is operator-attested; this is not public capital enablement.');
  }
} catch (error) {
  console.error(error?.message ?? String(error));
  process.exit(1);
}
