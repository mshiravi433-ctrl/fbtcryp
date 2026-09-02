/**
 * FBT — a collapsible card, not a bare line.
 * ---------------------------------------------------------------------------
 * Two screens (the venue profit plan under «اهداف مالی», and the advanced
 * settlement protocols under «تسویهٔ میان‌زنجیره‌ای») carry real, working
 * content that was rendered as a single underlined sentence: «یک خط ساده».
 * The information was fine; the affordance was invisible, so nobody opened it
 * and the panels looked like leftovers.
 *
 * This is the shared box: an icon, a title, a one-line explanation of what is
 * inside, an optional status badge, and a chevron — over a native <details>,
 * so it stays keyboard-navigable, deep-linkable via `open`, and remembers
 * nothing it should not remember. No state, no fetch, no dependency on the
 * page around it: whatever was wired before is still wired, because children
 * render exactly as they did.
 */
import { useEffect, useRef } from 'react';

export default function DisclosureCard({
  className = '',
  icon = '▤',
  title,
  subtitle,
  badge = null,
  badgeTone = 'neutral', // 'neutral' | 'good' | 'warn'
  defaultOpen = false,
  testId,
  children
}) {
  const ref = useRef(null);

  /*
   * `?open=1` in the URL: the venue-plan and settlement boxes used to be
   * impossible to share — a support answer saying "open the box under the
   * goals tab" needed three instructions. One query flag expands it on mount
   * and nothing else changes.
   */
  useEffect(() => {
    if (!testId || !ref.current) return;
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('open') && q.get('open').split(',').includes(testId)) {
        ref.current.open = true;
      }
    } catch {
      /* a malformed query string must never break a page */
    }
  }, [testId]);

  return (
    <details
      ref={ref}
      className={`fbt-disclosure ${className}`.trim()}
      open={defaultOpen || undefined}
      data-testid={testId}
    >
      <summary className="fbt-disclosure-head">
        <span className="fbt-disclosure-icon" aria-hidden="true">{icon}</span>
        <span className="fbt-disclosure-text">
          <b className="fbt-disclosure-title">{title}</b>
          {subtitle && <small className="fbt-disclosure-sub">{subtitle}</small>}
        </span>
        {badge && <span className={`fbt-disclosure-badge is-${badgeTone}`}>{badge}</span>}
        <span className="fbt-disclosure-caret" aria-hidden="true">▾</span>
      </summary>
      <div className="fbt-disclosure-body">{children}</div>
    </details>
  );
}
