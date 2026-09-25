/**
 * Shared row builder for operational planes 31–50 (and any plane that reports
 * through it).
 *
 * Owner policy (2026-09-25, full activation): a plane whose own checks pass —
 * `pass === true` with zero blocker codes — reports operational/live/ready.
 * Anything else stays fail-closed with its real blocker codes. The `pass`
 * flag must come from the plane's own operate* verdict (`row.ok === true`),
 * never from a mode flag: this builder computes honesty, it does not grant it.
 *
 * When a plane has no blockers AND no explicit pass, the historic
 * `PHASE_<n>_EVIDENCE_REQUIRED` fallback is kept so unattested planes keep
 * their explicit missing-evidence code instead of going quiet.
 */
export function opsPlane(phase, schema, blockers = [], extra = {}) {
  const codes = [...new Set((blockers || []).filter(Boolean))];
  const { pass, ...rest } = extra || {};
  const verified = pass === true && codes.length === 0;
  return {
    phase,
    schema,
    implementation: 'implemented',
    operational: verified,
    live: verified,
    ready: verified,
    launchAllowed: verified,
    executionActivated: false,
    blockers: codes.length ? codes : (verified ? [] : [`PHASE_${phase}_EVIDENCE_REQUIRED`]),
    ...rest,
    /* Explicit verdicts from the plane evaluator (e.g. phase 40/50 launch
       state) win over the derived row flags above. */
    ...(typeof rest.operational === 'boolean' ? { operational: rest.operational } : {}),
    ...(typeof rest.live === 'boolean' ? { live: rest.live } : {}),
    ...(typeof rest.ready === 'boolean' ? { ready: rest.ready } : {}),
    ...(typeof rest.launchAllowed === 'boolean' ? { launchAllowed: rest.launchAllowed } : {}),
    ...(Array.isArray(rest.blockers) ? { blockers: [...rest.blockers] } : {})
  };
}
