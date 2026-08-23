/** Shared first-run progress. Stage itself is never animated. */
export default function LaunchProgress({ step, total }) {
  const pct = Math.max(4, Math.min(100, (step / total) * 100));
  /*
   * No visible "step N of M" label. It rendered with a broken size on real
   * phones and was pure noise — the bar itself already says how far along
   * the first-run flow is. Screen readers still get the numbers via the
   * progressbar ARIA attributes below.
   */
  return (
    <div className="launch-progress">
      <div className="launch-progress-track" role="progressbar" aria-valuenow={step} aria-valuemin={1} aria-valuemax={total}>
        <div className="launch-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
