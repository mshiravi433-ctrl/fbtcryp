import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { GlyphCaretDown } from './MarketGlyphs.jsx';

/**
 * Compact overview controls.
 *
 * The cards on this route are paint-contained by market-perf.css. An inline
 * popover would therefore be clipped by its own card. Portalling to body keeps
 * the menu visible without removing that scroll-budget containment.
 *
 * This is a non-modal popover: the page is not scroll-locked, outside pointer
 * and focus leave dismiss it, Escape returns focus to the trigger. Select menus
 * use menuitemradio + arrow/Home/End navigation. Filter panels keep normal Tab
 * order and never focus their search input, so opening filters does not raise
 * the phone keyboard by itself.
 */
export function MarketPopover({
  label,
  value,
  icon,
  badge,
  active = false,
  testId,
  kind = 'dialog',
  children
}) {
  const { t } = useTranslation();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const panelId = `mx-control-${id}`;
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const focusedRef = useRef(false);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setPosition(null);
    focusedRef.current = false;
    if (restoreFocus) triggerRef.current?.focus?.({ preventScroll: true });
  }, []);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const height = panel.offsetHeight;
    const margin = 12;
    const rtl = getComputedStyle(trigger).direction === 'rtl';
    const preferredLeft = rtl ? rect.left : rect.right - width;
    const left = Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin));
    const below = rect.bottom + 8;
    const above = rect.top - height - 8;
    const top = below + height <= window.innerHeight - margin
      ? below
      : above >= margin
        ? above
        : Math.max(margin, window.innerHeight - height - margin);
    setPosition({ left, top, width, maxHeight: Math.max(120, window.innerHeight - margin * 2) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    reposition();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reposition);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [open, reposition]);

  // The panel is visibility:hidden until its first measured position lands.
  // Focus only after that paint, otherwise the browser refuses the focus and
  // Arrow/End/Enter keep operating the trigger instead of the menu.
  useEffect(() => {
    if (!open || !position || focusedRef.current) return;
    const panel = panelRef.current;
    const first = kind === 'menu'
      ? panel?.querySelector('[role="menuitemradio"][aria-checked="true"]:not(:disabled)')
        || panel?.querySelector('[role="menuitemradio"]:not(:disabled)')
      : panel?.querySelector('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
    if (first) {
      first.focus({ preventScroll: true });
      focusedRef.current = true;
    }
  }, [open, position, kind]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      close(false);
    };
    const keydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    const focusOutside = (event) => {
      if (!triggerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) {
        close(false);
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusOutside);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusOutside);
    };
  }, [open, close]);

  const panel = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={panelRef}
      id={panelId}
      className={`mx-control-panel mx-control-panel--${kind}`}
      role={kind === 'menu' ? 'menu' : 'dialog'}
      aria-label={label}
      dir={triggerRef.current ? getComputedStyle(triggerRef.current).direction : undefined}
      style={{
        left: position?.left ?? 12,
        top: position?.top ?? 12,
        width: position?.width ?? Math.min(320, window.innerWidth - 24),
        maxHeight: position?.maxHeight ?? 'calc(100vh - 24px)',
        visibility: position ? 'visible' : 'hidden'
      }}
      onKeyDown={(event) => {
        if (kind !== 'menu') return;
        const items = [...event.currentTarget.querySelectorAll('[role="menuitemradio"]:not(:disabled)')];
        if (!items.length) return;
        const index = items.indexOf(document.activeElement);
        let next = null;
        if (event.key === 'ArrowDown') next = (index + 1) % items.length;
        else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        if (next != null) {
          event.preventDefault();
          items[next]?.focus();
        }
      }}
    >
      <div className="mx-control-panel-head">
        <strong>{label}</strong>
        <button type="button" className="mx-control-close" onClick={() => close()} aria-label={t('marketPhase2.controlsClose')}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {typeof children === 'function' ? children({ close }) : children}
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`mx-control-trigger${active ? ' is-active' : ''}`}
        aria-label={value ? `${label}: ${value}` : label}
        aria-haspopup={kind}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-testid={testId}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon && <span className="mx-control-icon" aria-hidden="true">{icon}</span>}
        <span className="mx-control-value">{value || label}</span>
        {badge != null && <span className="mx-control-badge" dir="ltr">{badge}</span>}
        <GlyphCaretDown className={`mx-control-caret${open ? ' is-open' : ''}`} width="13" height="13" />
      </button>
      {panel}
    </>
  );
}

export function MarketSelect({ label, value, options, onChange, icon, testId }) {
  const selected = options.find((option) => String(option.value) === String(value));
  return (
    <MarketPopover
      label={label}
      value={selected?.shortLabel || selected?.label}
      icon={icon}
      testId={testId}
      kind="menu"
      active={Boolean(selected && selected.value !== options[0]?.value)}
    >
      {({ close }) => (
        <div className="mx-control-options">
          {options.map((option) => {
            const checked = String(option.value) === String(value);
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                disabled={option.disabled}
                className={`mx-control-option${checked ? ' is-selected' : ''}`}
                data-value={option.value}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
              >
                {option.icon && <span className="mx-control-option-icon" aria-hidden="true">{option.icon}</span>}
                <span className="mx-control-option-copy">
                  <span>{option.label}</span>
                  {option.note && <small>{option.note}</small>}
                </span>
                <span className="mx-control-check" aria-hidden="true">
                  {checked && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="m3.5 8.2 3 3L12.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </MarketPopover>
  );
}

export function GlyphClock() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.8V8l2.2 1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function GlyphFilters() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 11.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6" cy="4.5" r="1.7" fill="var(--mx-control-bg, #101a2b)" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10" cy="11.5" r="1.7" fill="var(--mx-control-bg, #101a2b)" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
