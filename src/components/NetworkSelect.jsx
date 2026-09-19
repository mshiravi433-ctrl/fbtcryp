import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import AssetIcon from './AssetIcon';
import { EVM_CHAINS, EVM_CHAIN_ORDER } from '../lib/chains';
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
 *   • A popover list with the same logo at 26px, the full network name, the
 *     short tag as the secondary line, «شبکه فعلی» on the chain the wallet is
 *     actually on (which is NOT the same thing as the chain being viewed), a
 *     per-network figure when the caller has one, and a check on the current
 *     selection.
 *   • «همه شبکه‌ها» first and pinned, because that is the default view and the
 *     row the user comes back to.
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
  id,
  testId
}) {
  const autoId = useId();
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const triggerRef = useRef(null);
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

  /* Outside pointer and Escape. `pointerdown` (not click) so the popover is
     already gone before a tap on whatever is underneath is handled. */
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains?.(event.target)) close({ focus: false });
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

      {open ? (
        <div
          className="net-select__pop"
          role="presentation"
          /* The handler lives on the CONTAINER, not on the list: when a search
             box is present it is the input that holds focus, and a keydown on
             the input never reaches a listener bound to the list below it. */
          onKeyDown={onListKey}
        >
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
