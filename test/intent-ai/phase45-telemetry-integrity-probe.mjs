import { operateTelemetryIntegrity } from '../../src/lib/intent-ai/index.js';
const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
try {
  check('stream', operateTelemetryIntegrity({}).code === 'TELEMETRY_STREAM_UNATTESTED');
  check('opt-in', operateTelemetryIntegrity({ stream: { attested: true } }).code === 'TELEMETRY_OPT_IN_REQUIRED');
  check('no client outcomes', operateTelemetryIntegrity({ stream: { attested: true, acceptsClientResolvedOutcomes: true }, consent: { optIn: true } }).code === 'CLIENT_OUTCOMES_CANNOT_TRAIN');
  console.log(JSON.stringify({ probe: 'phase45-telemetry-integrity', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e); process.exitCode = 1;
}
export default results;
