import { useCallback, useEffect, useRef, useState } from 'react';
import { useTelegram } from '../context/TelegramContext';
import { useStill } from './AnimatedIcon';
import '../styles/collapsible-card.css';

/**
 * A FOLDING CARD — the pattern this app uses for "the rest of the screen".
 * ===========================================================================
 *
 * Requested (about the Solana order box on AUTO ORDERS): «سفارش سولانا را در
 * باکس بازشونده و پایین صفحه ببر با ظاهری مدرن‌تر.»
 *
 * ─── WHY A COMPONENT AND NOT A `<details>` ──────────────────────────────────
 * `<details>` is the obvious answer and it is the wrong one here, for two
 * reasons that both show up on a phone:
 *
 *   1. It cannot animate its own height. Chrome and Firefox will not
 *      interpolate `details[open]`, so the content either pops into place or
 *      has to be hacked with `content-visibility` tricks that differ per
 *      engine. A 300px pop on the last card of a page is exactly the "cheap"
 *      feel the request was complaining about.
 *   2. Its built-in toggle does not fire the app's haptics, does not respect
 *      the app's reduce-motion switch, and cannot report open state to the
 *      parent — which this screen needs, because the Solana list is populated
 *      lazily and the parent wants to re-read it when the fold opens.
 *
 * So this is a real button plus a measured height, driven by one
 * `max-height` transition. The measured `scrollHeight` is read from the
 * content node (not guessed from a fixed number), so a longer translation or
 * one extra saved row cannot clip the last line — the classic failure of every
 * hard-coded "max-height: 400px" accordion.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *   · It does not unmount its children when closed by default. `unmountOnClose`
 *     exists for callers that must free something (a lazily-imported SDK, a
 *     polling loop), and the Solana card passes it — but the default is to keep
 *     the DOM, because remounting a form on every open is how a half-typed
 *     amount disappears.
 *   · It is not controlled by default. `defaultOpen` sets the first state and
 *     the fold is then local, so the parent never has to hold a boolean it
 *     does not use.
 *   · It never traps focus or locks scroll: it is a section of a page, not a
 *     modal, and it says so to assistive tech with `aria-expanded` +
 *     `aria-controls` rather than `role="dialog"`.
 */
export default function CollapsibleCard({
  id,
  title,
  subtitle,
  icon = null,
  badge = null,
  hint = null,
  defaultOpen = false,
  unmountOnClose = false,
  className = '',
  headerClassName = '',
  onToggle,
  children
}) {
  const { haptic } = useTelegram();
  const still = useStill();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const bodyRef = useRef(null);
  /*
   * Height is measured, not assumed. `null` means "not measured yet", which
   * only ever happens on the first paint of an OPEN fold — the body is given
   * `height: auto` in that case so nothing is clipped while the ref attaches.
   */
  const [height, setHeight] = useState(null);

  const measure = useCallback(() => {
    const node = bodyRef.current;
    if (!node) return;
    setHeight(node.scrollHeight);
  }, []);

  useEffect(() => {
    if (!open) { setHeight(null); return undefined; }
    measure();
    /*
     * Re-measure when the content itself changes size. ResizeObserver is in
     * every browser this app targets (and jsdom, where the tests run the
     * component through a no-op shim if it is missing) — guarded rather than
     * assumed, because a missing global would throw during mount.
     */
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    if (bodyRef.current) ro.observe(bodyRef.current);
    return () => ro.disconnect();
  }, [open, measure]);

  const toggle = () => {
    haptic?.('light');
    setOpen((was) => {
      const next = !was;
      onToggle?.(next);
      return next;
    });
  };

  const bodyId = id ? `${id}-body` : undefined;

  return (
    <section
      className={`fold${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}
      data-testid={id}
      data-open={open ? 'true' : 'false'}
    >
      <button
        type="button"
        className={`fold-head${headerClassName ? ` ${headerClassName}` : ''}`}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        {icon && <span className="fold-ico" aria-hidden="true">{icon}</span>}
        <span className="fold-copy">
          <span className="fold-title">{title}</span>
          {subtitle && <span className="fold-sub">{subtitle}</span>}
        </span>
        {badge != null && badge !== '' && <span className="fold-badge">{badge}</span>}
        <span className="fold-chev" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {/* The hint stays OUTSIDE the fold: it is the one line that has to be
          readable without a tap, because it is the disclosure ("this saves a
          handoff; it does not place a price-watched order"). */}
      {hint && !open && <p className="fold-hint">{hint}</p>}

      <div
        className="fold-body"
        id={bodyId}
        ref={bodyRef}
        style={{
          /* `auto` while measuring, the measured px afterwards, 0 when shut.
             Reduced motion gets px straight away: a height transition is
             motion, and the switch exists to remove it. */
          maxHeight: still && open ? 'none' : open ? (height == null ? 'none' : `${height}px`) : '0px'
        }}
        aria-hidden={open ? undefined : 'true'}
        {...(open ? {} : { inert: '' })}
      >
        <div className="fold-inner">
          {(!unmountOnClose || open) ? children : null}
        </div>
      </div>
    </section>
  );
}
