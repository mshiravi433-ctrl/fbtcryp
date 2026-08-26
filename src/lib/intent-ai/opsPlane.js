/** Shared fail-closed row for operational planes 31–40. */
export function opsPlane(phase, schema, blockers = [], extra = {}) {
  const codes = [...new Set((blockers || []).filter(Boolean))];
  return {
    phase,
    schema,
    implementation: 'implemented',
    operational: false,
    live: false,
    ready: false,
    launchAllowed: false,
    executionActivated: false,
    blockers: codes.length ? codes : [`PHASE_${phase}_EVIDENCE_REQUIRED`],
    ...extra
  };
}
