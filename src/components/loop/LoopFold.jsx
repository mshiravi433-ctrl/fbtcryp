import React, { useId, useState } from 'react';

/**
 * Expandable section used inside the collateral-loop box.
 *
 * The body animates with the grid-rows technique (0fr ↔ 1fr), so nothing is
 * measured and late-arriving content (live rates, a step list growing) never
 * gets clipped. A closed body stays MOUNTED — inputs keep their values and the
 * tests can still reach them — but it is `inert` and aria-hidden, so neither
 * the keyboard nor a screen reader lands inside something invisible.
 */
export default function LoopFold({
  testId,
  title,
  subtitle = null,
  index = null,
  badge = null,
  icon = null,
  tone = '',
  defaultOpen = false,
  open: controlledOpen,
  onToggle,
  className = '',
  children
}) {
  const autoId = useId();
  const [innerOpen, setInnerOpen] = useState(Boolean(defaultOpen));
  const open = controlledOpen ?? innerOpen;
  const bodyId = `${testId || 'loop-fold'}-${autoId.replace(/:/g, '')}-body`;

  const toggle = () => {
    const next = !open;
    if (controlledOpen == null) setInnerOpen(next);
    onToggle?.(next);
  };

  return (
    <section
      className={`loop-fold${open ? ' is-open' : ''}${tone ? ` is-${tone}` : ''}${className ? ` ${className}` : ''}`}
      data-testid={testId}
      data-open={open ? 'true' : 'false'}
    >
      <button
        type="button"
        className="loop-fold-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        data-testid={testId ? `${testId}-toggle` : undefined}
      >
        {index != null && <span className="loop-fold-index" aria-hidden="true">{index}</span>}
        {icon && <span className="loop-fold-icon" aria-hidden="true">{icon}</span>}
        <span className="loop-fold-copy">
          <span className="loop-fold-title">{title}</span>
          {subtitle && <span className="loop-fold-sub">{subtitle}</span>}
        </span>
        {badge}
        <span className="loop-fold-chev" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      <div
        className="loop-fold-body"
        id={bodyId}
        aria-hidden={open ? undefined : 'true'}
        {...(open ? {} : { inert: '' })}
      >
        <div className="loop-fold-inner">
          <div className="loop-fold-content">{children}</div>
        </div>
      </div>
    </section>
  );
}
