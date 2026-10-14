import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockBodyScroll } from '../../lib/scrollLock';

/**
 * SPOT SELECT — the popup picker the spot tab's three choices share
 * ---------------------------------------------------------------------------
 * The spot tab used to mix two control languages on one card: the browser's own
 * select element for the network, a second one for the pay-with token, and a
 * hand-rolled list (with its own search field, its own grey well and its own
 * row metrics) for the asset. The result was the complaint behind this file:
 * «باکس شبکه انتخابی باید مدرن باشد و به صورت پاپ اپ بدون فیلد جستجو بازشود …
 * توکن پرداختی هم باکس پاپ اپ باشد … هیچ کدام باکس‌ها فیلد جستجو نداشته باشد».
 *
 * WHAT IT IS
 *   • ONE trigger per choice — the selected item's real artwork, its title, its
 *     secondary line, and the figure that belongs to it (price for a token,
 *     short tag for a network). No grey well behind it: the trigger sits on the
 *     ticket itself with a hairline, which is what «بدون پس‌زمینه» asked for.
 *   • Tapping it opens a POPUP: a dimmed backdrop and a card that rises from
 *     the bottom on a phone and centres on a wide screen — the same behaviour
 *     as components/NetworkSelect.jsx, which is the picker the rest of the app
 *     already reads as "modern".
 *   • NO SEARCH FIELD, anywhere. The token lists here are the curated set for
 *     one network (three to ten rows). A search box on a nine-row list only
 *     raises the phone keyboard over the rows the user came to tap.
 *
 * WHY A PORTAL
 *   The spot ticket lives inside PageTransition, which animates `transform`.
 *   A transformed ancestor becomes the containing block for `position: fixed`,
 *   so an inline dropdown positions itself against a moving box and gets
 *   clipped by the card's overflow. Portalling to `document.body` puts the
 *   popup outside every transformed and clipping ancestor. (Identical
 *   reasoning in components/Sheet.jsx and components/NetworkSelect.jsx.)
 *
 * BEHAVIOUR THAT IS NOT OPTIONAL
 *   • keyboard: ↑/↓ move, Home/End jump, Enter/Space choose, Escape closes and
 *     returns focus to the trigger.
 *   • a tap on the backdrop or Escape closes WITHOUT selecting.
 *   • the highlighted row is announced through `aria-activedescendant`, so the
 *     highlight a sighted user sees is the one a screen reader speaks.
 */
export default function SpotSelect({
  id,
  label,
  popupTitle,
  value,
  items,
  onPick,
  closeLabel,
  variant = 'default', // 'default' | 'compact'
  testId
}) {
  const autoId = useId();
  const baseId = id || `spotsel-${autoId}`;
  const listId = `${baseId}-list`;
  const optionId = (index) => `${baseId}-opt-${index}`;

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  /* The popup is portalled, so it is NOT inside rootRef — without its own ref
     a pointerdown inside the list would read as "outside" and dismiss the
     popup before the tap that was meant to choose ever landed. */
  const popRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  const list = useMemo(() => (Array.isArray(items) ? items : []), [items]);
  const selected = useMemo(
    () => list.find((it) => String(it.value) === String(value)) ?? null,
    [list, value]
  );

  const close = useCallback(({ focus = true } = {}) => {
    setOpen(false);
    if (focus) {
      try {
        triggerRef.current?.focus?.();
      } catch {
        /* the trigger is gone — nothing to return focus to */
      }
    }
  }, []);

  const pick = useCallback(
    (item) => {
      if (!item) return;
      onPick?.(item);
      close();
    },
    [onPick, close]
  );

  /* The page behind a modal must not scroll under it; lockBodyScroll is
     reference-counted, so two overlapping modals cannot leave the page
     permanently unscrollable. */
  useEffect(() => (open ? lockBodyScroll() : undefined), [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (rootRef.current?.contains?.(target)) return;
      if (popRef.current?.contains?.(target)) return;
      close({ focus: false });
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);

  /* Keep the highlighted row inside the scroll viewport. */
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector?.(`[data-index="${cursor}"]`);
    try {
      node?.scrollIntoView?.({ block: 'nearest' });
    } catch {
      /* jsdom and old engines do not implement it */
    }
  }, [cursor, open]);

  const openAt = (index) => {
    setCursor(Math.min(Math.max(0, index), Math.max(0, list.length - 1)));
    setOpen(true);
  };

  const onTriggerKey = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const index = list.findIndex((it) => String(it.value) === String(selected?.value));
      openAt(index >= 0 ? index : 0);
    }
  };

  const onListKey = (event) => {
    if (!list.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (c + 1) % list.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (c - 1 + list.length) % list.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setCursor(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setCursor(list.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(list[cursor]);
    } else if (event.key === 'Tab') {
      close({ focus: false });
    }
  };

  /* Focus the list on open so ↑/↓ answer on the very first keypress — a
     listbox that has to be clicked first is why custom pickers feel broken. */
  const focusList = useCallback((node) => {
    listRef.current = node;
    if (!node) return;
    try {
      node.focus({ preventScroll: true });
    } catch {
      /* noop */
    }
  }, []);

  return (
    <div
      className={`spot-sel${open ? ' is-open' : ''}${variant === 'compact' ? ' is-compact' : ''}`}
      ref={rootRef}
      data-testid={testId}
    >
      {label ? <span className="spot-label" id={`${baseId}-label`}>{label}</span> : null}
      <button
        type="button"
        id={baseId}
        ref={triggerRef}
        className="spot-sel-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={label ? `${baseId}-label ${baseId}` : undefined}
        data-testid={testId ? `${testId}-trigger` : undefined}
        onClick={() => (open ? close() : openAt(Math.max(0, list.findIndex((it) => String(it.value) === String(selected?.value)))))}
        onKeyDown={onTriggerKey}
      >
        {selected?.icon ? <span className="spot-sel-ico" aria-hidden="true">{selected.icon}</span> : null}
        <span className="spot-sel-text">
          <span className="spot-sel-title">{selected?.title ?? ''}</span>
          {selected?.sub ? <span className="spot-sel-sub">{selected.sub}</span> : null}
        </span>
        {selected?.spark ? <span className="spot-sel-spark" aria-hidden="true">{selected.spark}</span> : null}
        {selected?.num ? <span className="spot-sel-num mono" dir="ltr">{selected.num}</span> : null}
        <Caret open={open} />
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
          <>
            <div
              className="spot-sel-backdrop"
              role="presentation"
              onPointerDown={(event) => {
                event.preventDefault();
                close({ focus: false });
              }}
            />
            <div className="spot-sel-layer" role="presentation">
              <div
                className="spot-sel-pop"
                ref={popRef}
                role="dialog"
                aria-modal="true"
                aria-label={popupTitle || label}
                data-testid={testId ? `${testId}-popup` : undefined}
              >
                <div className="spot-sel-head">
                  <span className="spot-sel-grabber" aria-hidden="true" />
                  <span className="spot-sel-head-title">{popupTitle || label}</span>
                  <button
                    type="button"
                    className="spot-sel-x"
                    onClick={() => close()}
                    aria-label={closeLabel || popupTitle}
                  >
                    <XMark />
                  </button>
                </div>

                <ul
                  className="spot-sel-list"
                  role="listbox"
                  id={listId}
                  tabIndex={-1}
                  aria-label={popupTitle || label}
                  aria-activedescendant={list.length ? optionId(cursor) : undefined}
                  ref={focusList}
                  onKeyDown={onListKey}
                  data-testid={testId ? `${testId}-list` : undefined}
                >
                  {list.map((item, index) => {
                    const isSelected = String(item.value) === String(selected?.value);
                    return (
                      <li
                        key={String(item.value)}
                        id={optionId(index)}
                        role="option"
                        aria-selected={isSelected ? 'true' : 'false'}
                        data-index={index}
                        data-value={String(item.value)}
                        className={[
                          'spot-sel-opt',
                          isSelected ? 'is-active' : '',
                          index === cursor ? 'is-cursor' : ''
                        ].filter(Boolean).join(' ')}
                        onPointerEnter={() => setCursor(index)}
                        onClick={() => pick(item)}
                      >
                        {item.icon ? <span className="spot-sel-ico" aria-hidden="true">{item.icon}</span> : null}
                        <span className="spot-sel-text">
                          <span className="spot-sel-title">{item.title}</span>
                          {item.sub ? <span className="spot-sel-sub">{item.sub}</span> : null}
                        </span>
                        {item.spark ? <span className="spot-sel-spark" aria-hidden="true">{item.spark}</span> : null}
                        <span className="spot-sel-num">
                          {item.num ? <span className="mono" dir="ltr">{item.num}</span> : null}
                          {item.change}
                          {item.meta ? <span className="spot-sel-meta">{item.meta}</span> : null}
                        </span>
                        <span className="spot-sel-check" aria-hidden="true">
                          {isSelected ? <CheckMark /> : null}
                        </span>
                      </li>
                    );
                  })}
                  {list.length === 0 ? (
                    <li className="spot-sel-empty" role="presentation">{popupTitle}</li>
                  ) : null}
                </ul>
              </div>
            </div>
          </>,
          document.body
        )
        : null}
    </div>
  );
}

function Caret({ open }) {
  return (
    <svg
      className={`spot-sel-chev${open ? ' is-open' : ''}`}
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function XMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6L6 18" /><path d="M6 6l12 12" />
    </svg>
  );
}
