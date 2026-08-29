/**
 * PHASES 141–150 — RAIL LAYOUT CONTRACT
 * The horizontal rail's layout descriptor is the single source of truth the
 * screen renders; this probe asserts the contract so the UI cannot drift:
 * L1–L3 icons, expandable pause/emergency actions, the human-agent button,
 * the collapse toggle, spacing and the safety invariants.
 */
import {
  RAIL_LAYOUT_SCHEMA, AUTONOMY_ICONS, RAIL_ACTIONS, RAIL_SPACING,
  railLayoutDescriptor
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

try {
  const layout = railLayoutDescriptor();
  check('the descriptor carries its schema', layout.schema === RAIL_LAYOUT_SCHEMA);
  check('the rail is horizontal and compact', layout.horizontal === true && layout.compact === true);

  /* ---------- L1 → L3 icons ---------- */
  check('exactly three autonomy icons', AUTONOMY_ICONS.length === 3);
  check('the icons are L1, L2, L3 in order', AUTONOMY_ICONS.map((i) => i.level).join(',') === '1,2,3');
  check('every icon has a label key and an icon key', AUTONOMY_ICONS.every((i) => /^l[123]-/.test(i.key) && typeof i.labelKey === 'string'));

  /* ---------- actions ---------- */
  check('the rail has exactly four actions', RAIL_ACTIONS.length === 4);
  const pause = RAIL_ACTIONS.find((a) => a.id === 'pause');
  const stop = RAIL_ACTIONS.find((a) => a.id === 'emergency-stop');
  const human = RAIL_ACTIONS.find((a) => a.id === 'human-agent');
  const collapse = RAIL_ACTIONS.find((a) => a.id === 'rail-collapse');
  check('pause exists and is expandable', pause?.expandable === true && pause.kind === 'toggle');
  check('emergency stop exists and is expandable', stop?.expandable === true && stop.kind === 'fail-closed');
  check('human agent exists on the rail', human?.kind === 'escalate');
  check('rail collapse exists as a layout action', collapse?.kind === 'layout');
  check('rail order puts autonomy first and collapse last', layout.order.join(',') === 'autonomy,pause,emergency-stop,human-agent,rail-collapse');

  /* ---------- spacing ---------- */
  check('touch targets are at least 44px', RAIL_SPACING.touchTargetPx >= 44);
  check('the rail has a gap, padding and a drawer cap', RAIL_SPACING.gapPx > 0 && RAIL_SPACING.railPaddingPx > 0 && RAIL_SPACING.drawerMaxHeightPx > 0);
  check('contrast floor is WCAG AA', RAIL_SPACING.minContrastRatio >= 4.5);

  /* ---------- safety invariants ---------- */
  const inv = layout.safetyInvariants;
  check('emergency stop stays one tap away even collapsed', inv.emergencyAlwaysReachable === true);
  check('collapsing never hides the safety state', inv.collapseNeverHidesSafetyState === true);
  check('pause must show its resume time', inv.pauseShowsResumeTime === true);
  check('stop requires confirmation to release', inv.stopRequiresConfirmationToRelease === true);
  check('touch targets stay thumb-friendly', inv.touchTargetsAtLeast44px === true);
} catch (e) {
  check(`unexpected error: ${e.message}`, false);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error(`FAILED: ${failed.map((r) => r.name).join(' | ')}`);
  process.exitCode = 1;
}
export default results;
