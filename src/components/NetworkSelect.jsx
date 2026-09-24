import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AssetIcon from './AssetIcon';
import { EVM_CHAINS, EVM_CHAIN_ORDER } from '../lib/chains';
import { lockBodyScroll } from '../lib/scrollLock';
import '../styles/network-select.css';

/**
 * NETWORK SELECT — the wallet page's network picker
 * ---------------------------------------------------------------------------
 * The hero used to render sixteen chips in a wrapping flex row: every network
 * the app supports, as a 30px pill with a 7px coloured dot and a three-letter
 * abbreviation. It was honest and it was unreadable — on a phone it wrapped to
 * four or five ragged lines, half the names were abbreviations nobody outside
 * the team knows (SCR, HOOD, LINEA), and picking one meant hunting for it in a
 * block of near-identical grey pills. «شبکه را داخل باکس بازشونده مدرن بزار با
 * لوگو مدرن هر شبکه» is the request this answers.
 *
 * WHAT IT IS NOW
 *   • ONE trigger, the size of a control rather than a chip: the selected
 *     network's real logo, its full name, and a chevron. One line of the hero,
 *     whatever the network count grows to.
 *   • Tapping it opens a POPUP («باید به صورت پاپ اپ شود وقتی روش میزنی»), not
 *     an inline popover: a dimmed backdrop, a card of its own that rises from
 *     the bottom on a phone and centres itself on a wide screen, and the whole
 *     network list inside it — the same logo at 26px, the full network name,
 *     the short tag as the secondary line, «شبکه فعلی» on the chain the wallet
 *     is actually on (which is NOT the same thing as the chain being viewed),
 *     a per-network figure when the caller has one, and a check on the current
 *     selection.
 *   • «همه شبکه‌ها» first and pinned, because that is the default view and the
 *     row the user comes back to.
 *
 * WHY THE POPUP IS PORTALLED TO `document.body`
 *   The wallet hero is a `position: relative; overflow: hidden` card inside a
 *   `PageTransition` that animates `transform`. Both facts are fatal to an
 *   inline dropdown: the first clips it the moment it grows past the card, and
 *   the second makes the animating ancestor the containing block for any
 *   `position: fixed` child, so an anchor-relative popover is positioned
 *   against a moving box. This is the same bug class that made the swap
 *   settings popup render below the fold (see components/Sheet.jsx). Rendering
 *   the popup through a portal puts it outside every transformed and clipping
 *   ancestor: `fixed` means fixed, and the list can be as tall as it needs.
 *
 * THE ICONS ARE OFFLINE
 *   `AssetIcon chain={id}` renders the vendored SVG in src/lib/assetIconData.js
 *   — no CDN, no network, no broken image on a phone that cannot reach one.
 *   Three marks (Scroll, zkSync Era, Robinhood Chain) were added there so all
 *   sixteen networks have a face; a monogram is the fallback for a chain the
 *   registry grows into before its artwork is drawn.
 *
 * BEHAVIOUR THAT IS NOT OPTIONAL
 *   • keyboard: ↑/↓ move, Home/End jump, Enter/Space choose, Escape closes and
 *     returns focus to the trigger. A picker that only answers a mouse is not a
 *     control, it is a decoration.
 *   • Escape and an outside pointer both close WITHOUT selecting — never the
 *     network you happened to be hovering.
 *   • the popover is a real listbox: `aria-activedescendant` tracks the
 *     highlighted row, so the highlight is announced, not just drawn.
 */
export default function NetworkSelect({
  value,
  onChange,
  activeChainId = null,
  /* Optional per-chain meta: { [chainId]: { amount?, assets? } }. Rendered on
     the right of a row; a chain with no entry simply shows nothing there. */
  chainMeta = null,
  /* Optional: the total for «همه شبکه‌ها», in the same slot. */
  allMeta = null,
  disabled = false,
  label,
  allLabel,
  assetsLabel,
  activeLabel,
  searchLabel = '',
  /* Label for the popup's close button. Falls back to a plain word when the
     caller has nothing, because an icon-only control with no name is invisible
     to a screen reader. */
  closeLabel = 'Close',
  id,
  testId
}) {
  const autoId = useId();
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const triggerRef = useRef(null);
  /* The popup lives in a portal, so it is NOT inside `rootRef` — without its
     own ref, a pointerdown on the list would count as "outside" and close the
     popup before the click that was meant to choose a network ever landed. */
  const popRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const baseId = id || `netsel-${autoId}`;
  const listId = `${baseId}-list`;
  const optionId = (index) => `${baseId}-opt-${index}`;

  const options = useMemo(() => {
    const all = [{ value: 'all', kind: 'all' }];
    for (const cid of EVM_CHAIN_ORDER) {
      const cfg = EVM_CHAINS[cid];
      if (!cfg) continue;
      all.push({
        value: cid,
        kind: 'chain',
        chainId: cid,
        name: cfg.name,
        short: cfg.short,
        color: cfg.color,
        native: cfg.native?.symbol ?? ''
      });
    }
    return all;
  }, []);

  const selected = useMemo(
    () => options.find((o) => String(o.value) === String(value)) ?? options[0],
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      if (o.kind === 'all') return (allLabel || '').toLowerCase().includes(q);
      return `${o.name} ${o.short} ${o.chainId} ${o.native}`.toLowerCase().includes(q);
    });
  }, [options, query, allLabel]);

  /* The cursor is an index into the FILTERED list, and it is clamped rather
     than reset: typing a query and pressing Enter must not jump to the top and
     select «همه شبکه‌ها» by accident. */
  useEffect(() => {
    setCursor((c) => Math.min(Math.max(0, c), Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const close = useCallback(({ focus = true } = {}) => {
    setOpen(false);
    setQuery('');
    if (focus) {
      try {
        triggerRef.current?.focus?.();
      } catch { /* the trigger is gone — nothing to return focus to */ }
    }
  }, []);

  const pick = useCallback(
    (option) => {
      if (!option) return;
      onChange?.(option.value === 'all' ? 'all' : Number(option.value), option);
      close();
    },
    [onChange, close]
  );

  /* The page behind a modal must not scroll under it: on Android a swipe that
     starts on the backdrop used to drag the wallet page instead, which reads
     as the popup being stuck to a moving background. `lockBodyScroll` is
     reference-counted (see lib/scrollLock), so two overlapping modals cannot
     leave the page permanently unscrollable. */
  useEffect(() => {
    if (!open) return undefined;
    return lockBodyScroll();
  }, [open]);

  /* Outside pointer and Escape. `pointerdown` (not click) so the popup is
     already gone before a tap on whatever is underneath is handled.

     The check covers the trigger AND the portalled popup: the popup is a child
     of `document.body`, not of `rootRef`, so `rootRef.contains()` alone would
     treat every tap inside the list as a tap outside it. */
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
    } catch { /* jsdom and old browsers do not implement it */ }
  }, [cursor, open]);

  const onTriggerKey = (event) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const index = Math.max(0, filtered.findIndex((o) => o.value === selected?.value));
      setCursor(index >= 0 ? index : 0);
      setOpen(true);
    }
  };

  const onListKey = (event) => {
    if (!filtered.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (c + 1) % filtered.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (c - 1 + filtered.length) % filtered.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setCursor(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setCursor(filtered.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(filtered[cursor]);
    } else if (event.key === 'Tab') {
      close({ focus: false });
    }
  };

  const selectedIndex = filtered.findIndex((o) => String(o.value) === String(selected?.value));

  return (
    <div
      className={`net-select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''}`}
      ref={rootRef}
      data-testid={testId}
    >
      {label ? (
        <span className="net-select__label" id={`${baseId}-label`}>
          {label}
        </span>
      ) : null}

      <button
        type="button"
        ref={triggerRef}
        className="net-select__trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? listId : undefined}
        aria-labelledby={label ? `${baseId}-label` : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKey}
      >
        <span className="net-select__mark" aria-hidden="true">
          {selected?.kind === 'all'
            ? <GlobeMark />
            : <AssetIcon chain={selected?.chainId} size={24} radius={8} />}
        </span>
        <span className="net-select__text">
          <span className="net-select__title">
            {selected?.kind === 'all' ? (allLabel || 'All networks') : selected?.name}
          </span>
          <span className="net-select__sub">
            {selected?.kind === 'all'
              ? (allMeta || assetsLabel || '')
              : `${selected?.short ?? ''}${selected?.native ? ` · ${selected.native}` : ''}`}
          </span>
        </span>
        <Chevron open={open} />
      </button>

      {open && typeof document !== 'undefined' ? createPortal(
        <>
          {/* A tap on the dimmed area is a dismiss, never a selection: the
              network under the finger at that moment is an accident of where
              the list happened to be scrolled to. */}
          <div
            className="net-select__backdrop"
            role="presentation"
            data-testid={testId ? `${testId}-backdrop` : undefined}
            onPointerDown={(event) => {
              event.preventDefault();
              close({ focus: false });
            }}
          />
          <div className="net-select__layer" role="presentation">
            <div
              className="net-select__pop"
              ref={popRef}
              role="dialog"
              aria-modal="true"
              aria-label={label || allLabel || 'networks'}
              data-testid={testId ? `${testId}-popup` : undefined}
              /* The handler lives on the CONTAINER, not on the list: when a
                 search box is present it is the input that holds focus, and a
                 keydown on the input never reaches a listener bound to the
                 list below it. */
              onKeyDown={onListKey}
            >
              <div className="net-select__head">
                <span className="net-select__grabber" aria-hidden="true" />
                <span className="net-select__head-title">
                  {label || allLabel || 'Networks'}
                </span>
                <button
                  type="button"
                  className="net-select__x"
                  onClick={() => close()}
                  aria-label={closeLabel}
                >
                  <XMark />
                </button>
              </div>

              {searchLabel ? (
                <div className="net-select__search">
                  <SearchMark />
                  <input
                    type="text"
                    value={query}
                    placeholder={searchLabel}
                    aria-label={searchLabel}
                    /* The combobox pattern: the input owns the expanded state, the
                       list it controls and the highlighted row, so a screen reader
                       announces the highlight instead of the sighted user's cursor. */
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={filtered.length ? optionId(cursor) : undefined}
                    /* Focus on open, so ↑/↓ work on the very first keypress — a
                       listbox that has to be clicked before it answers the
                       keyboard is why custom pickers feel broken. */
                    autoFocus
                    onChange={(event) => setQuery(event.target.value)}
                    /* Enter is NOT handled here: it bubbles to the container
                       handler above, and handling it twice is how one keypress
                       used to select two networks. */
                    autoComplete="off"
                    spellCheck="false"
                  />
                </div>
              ) : null}

              <ul
                className="net-select__list"
                role="listbox"
                id={listId}
                tabIndex={-1}
                aria-label={label || allLabel || 'networks'}
                /* Without a search box there is nothing else that can hold focus,
                   so the list itself takes it — ↑/↓ answer immediately. */
                ref={(node) => {
                  listRef.current = node;
                  if (node && !searchLabel) {
                    try { node.focus({ preventScroll: true }); } catch { /* noop */ }
                  }
                }}
              >
                {filtered.map((option, index) => {
                  const isSelected = String(option.value) === String(selected?.value);
                  const isActive = option.kind === 'chain' && Number(activeChainId) === Number(option.chainId);
                  const meta = option.kind === 'all' ? allMeta : chainMeta?.[option.chainId];
                  const assets = option.kind === 'all' ? null : chainMeta?.[option.chainId]?.assets;
                  return (
                    <li
                      key={String(option.value)}
                      id={optionId(index)}
                      role="option"
                      aria-selected={isSelected ? 'true' : 'false'}
                      data-index={index}
                      data-value={String(option.value)}
                      className={[
                        'net-select__opt',
                        isSelected ? 'is-selected' : '',
                        index === cursor ? 'is-cursor' : ''
                      ].filter(Boolean).join(' ')}
                      style={option.kind === 'chain' ? { '--net-color': option.color } : undefined}
                      onPointerEnter={() => setCursor(index)}
                      onClick={() => pick(option)}
                    >
                      <span className="net-select__opt-mark" aria-hidden="true">
                        {option.kind === 'all'
                          ? <GlobeMark />
                          : <AssetIcon chain={option.chainId} size={26} radius={9} />}
                      </span>
                      <span className="net-select__opt-text">
                        <span className="net-select__opt-title">
                          {option.kind === 'all' ? (allLabel || 'All networks') : option.name}
                          {isActive && activeLabel ? (
                            <span className="net-select__badge">{activeLabel}</span>
                          ) : null}
                        </span>
                        <span className="net-select__opt-sub">
                          {option.kind === 'all'
                            ? (assetsLabel || '')
                            : [option.short, assets != null && assetsLabel ? `${assets} ${assetsLabel}` : '']
                              .filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="net-select__opt-meta">
                        {meta?.amount ? <span className="mono">{meta.amount}</span> : null}
                      </span>
                      <span className="net-select__check" aria-hidden="true">
                        {isSelected ? <CheckMark /> : null}
                      </span>
                    </li>
                  );
                })}
                {filtered.length === 0 ? (
                  <li className="net-select__empty" role="presentation">{allLabel || '—'}</li>
                ) : null}
              </ul>
            </div>
          </div>
        </>,
        document.body
      ) : null}
    </div>
  );
}

function Chevron({ open }) {
  return (
    <svg
      className={`net-select__chev ${open ? 'is-open' : ''}`}
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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

function GlobeMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
    </svg>
  );
}

function SearchMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" />
    </svg>
  );
}
