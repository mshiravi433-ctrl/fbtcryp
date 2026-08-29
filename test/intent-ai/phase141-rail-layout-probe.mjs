/**
 * PHASES 141–150 — RAIL LAYOUT CONTRACT
 * The horizontal rail's layout descriptor is the single source of truth the
 * screen renders; this probe asserts the contract so the UI cannot drift:
 * L1–L3 icons, the conditional release action, the collapse toggle, spacing
 * and the safety invariants.
 *
 * ─── WHY THERE ARE ONLY TWO ACTIONS LEFT ───────────────────────────────────
 * PAUSE, EMERGENCY STOP and HUMAN AGENT were removed from the /#/intent rail
 * («توقف، توقف اضطرار و درخواست در صفحه intent os باید پاک شود») — they are a
 * cramped second copy of controls that already live on the Intent AI surface.
 * Removing them without a way back would turn a pause into a lock, so the
 * contract now asserts the thing that actually keeps the rail safe: a blocked
 * rail MUST expose a release action, and releasing a stop still needs a second
 * confirming tap.
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
  check('the rail has exactly two actions', RAIL_ACTIONS.length === 2);
  const release = RAIL_ACTIONS.find((a) => a.id === 'release');
  const collapse = RAIL_ACTIONS.find((a) => a.id === 'rail-collapse');
  /* The pause/stop/agent buttons are gone from this screen; their absence is
     only acceptable because the release path survives. */
  check('no pause action remains on the rail', !RAIL_ACTIONS.some((a) => a.id === 'pause'));
  check('no emergency-stop action remains on the rail', !RAIL_ACTIONS.some((a) => a.id === 'emergency-stop'));
  check('no human-agent action remains on the rail', !RAIL_ACTIONS.some((a) => a.id === 'human-agent'));
  check('release exists and is fail-closed', release?.kind === 'fail-closed');
  check('release is conditional (renders only when blocked)', release?.conditional === true);
  check('rail collapse exists as a layout action', collapse?.kind === 'layout' && collapse?.conditional === false);
  check('rail order puts autonomy first and collapse last', layout.order.join(',') === 'autonomy,release,rail-collapse');

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
  check('a paused or stopped rail always exposes release', inv.releaseAlwaysReachableWhenBlocked === true);
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
