import { useEffect, useMemo, useState } from 'react';
import Sheet from './Sheet';
import CoinLogo from './CoinLogo';
import TokenIcon from '../lib/tokenIcon.jsx';
import '../styles/modern-select.css';

function hueFor(symbol) {
  const s = String(symbol ?? '?');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function FallbackIcon({ symbol, size = 42 }) {
  const hue = hueFor(symbol);
  return (
    <span
      className={size <= 36 ? 'modern-select-fallback' : 'modern-select-fallback'}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(140deg, hsl(${hue} 70% 46%), hsl(${(hue + 42) % 360} 68% 36%))`,
        borderRadius: size <= 36 ? 10 : 12,
        fontSize: size <= 36 ? 10 : 11,
      }}
      aria-hidden="true"
    >
      {String(symbol || '?').slice(0, 3).toUpperCase()}
    </span>
  );
}

function OptFallback({ symbol }) {
  const hue = hueFor(symbol);
  return (
    <span
      className="modern-select-opt-fallback"
      style={{
        background: `linear-gradient(140deg, hsl(${hue} 70% 46%), hsl(${(hue + 42) % 360} 68% 36%))`,
      }}
      aria-hidden="true"
    >
      {String(symbol || '?').slice(0, 3).toUpperCase()}
    </span>
  );
}

function renderTriggerIcon(opt, compact) {
  if (!opt) return <FallbackIcon symbol="?" size={compact ? 36 : 42} />;
  if (opt.iconNode) return opt.iconNode;
  if (opt.coin) {
    return <CoinLogo coin={opt.coin} px={compact ? 36 : 42} />;
  }
  if (opt.token) {
    return <TokenIcon token={opt.token} chainId={opt.chainId} size={compact ? 36 : 42} />;
  }
  if (opt.iconUrl) {
    return (
      <img
        src={opt.iconUrl}
        alt=""
        width={compact ? 36 : 42}
        height={compact ? 36 : 42}
        style={{ borderRadius: compact ? 10 : 12, objectFit: 'cover' }}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  return <FallbackIcon symbol={opt.label || opt.symbol || '?'} size={compact ? 36 : 42} />;
}

function renderOptIcon(opt) {
  if (opt.iconNode) return opt.iconNode;
  if (opt.coin) return <CoinLogo coin={opt.coin} px={44} />;
  if (opt.token) return <TokenIcon token={opt.token} chainId={opt.chainId} size={44} />;
  if (opt.iconUrl) {
    return (
      <img
        src={opt.iconUrl}
        alt=""
        width={44}
        height={44}
        style={{ borderRadius: 12, objectFit: 'cover' }}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  return <OptFallback symbol={opt.label || opt.symbol || '?'} />;
}

/**
 * ModernSelect — a bottom-sheet token / chain / market picker.
 *
 * Props
 *  - value: currently selected value (matched against option.value)
 *  - onChange: (value) => void
 *  - options: Array<{ value, label, sublabel?, meta?, coin?, token?, chainId?, iconNode?, iconUrl? }>
 *  - title: sheet title (shown at top)
 *  - placeholder: text when nothing selected
 *  - searchable: boolean (default true, auto-hides when options < 6)
 *  - compact: boolean — tighter trigger for side-by-side bridge rows
 *  - disabled: boolean
 *  - testId: string for e2e
 */
export default function ModernSelect({
  value,
  onChange,
  options = [],
  title,
  placeholder = 'انتخاب کن',
  searchable = true,
  compact = false,
  disabled = false,
  testId,
  triggerSublabel,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const selected = useMemo(
    () => options.find((o) => String(o.value) === String(value)) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return options;
    return options.filter((o) => {
      const hay = `${o.label ?? ''} ${o.sublabel ?? ''} ${o.value ?? ''} ${o.meta ?? ''}`.toLowerCase();
      return hay.includes(s);
    });
  }, [options, q]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const showSearch = searchable && options.length > 5;

  return (
    <div className={`modern-select ${compact ? 'modern-select--compact' : ''}`} data-testid={testId}>
      <button
        type="button"
        className="modern-select-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
      >
        <span className="modern-select-icon" aria-hidden="true">
          {selected ? renderTriggerIcon(selected, compact) : <FallbackIcon symbol="?" size={compact ? 36 : 42} />}
        </span>

        <span className="modern-select-text">
          <span className="modern-select-label">
            {selected ? (selected.label ?? placeholder) : placeholder}
          </span>
          {(selected?.sublabel || triggerSublabel) && (
            <span className="modern-select-sublabel">
              {selected?.sublabel ?? triggerSublabel ?? ''}
            </span>
          )}
        </span>

        <span className="modern-select-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={title || placeholder} size="md" anchor="bottom">
        {showSearch && (
          <div className="modern-select-search">
            <span className="modern-select-search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
            </span>
            <input
              autoFocus
              type="text"
              inputMode="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="جستجو…"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
            />
          </div>
        )}

        <div className="modern-select-list" role="listbox" aria-label={title || placeholder}>
          {filtered.length === 0 ? (
            <div className="modern-select-empty">
              <span className="modern-select-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.2-3.2" />
                  <path d="M8 11h6" />
                </svg>
              </span>
              <span>چیزی پیدا نشد</span>
            </div>
          ) : (
            filtered.map((opt) => {
              const isSel = String(opt.value) === String(value);
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  className={`modern-select-option ${isSel ? 'is-selected' : ''}`}
                  onClick={() => {
                    onChange?.(opt.value, opt);
                    setOpen(false);
                  }}
                >
                  <span className="modern-select-opt-icon" aria-hidden="true">
                    {renderOptIcon(opt)}
                  </span>

                  <span className="modern-select-opt-text">
                    <span className="modern-select-opt-label">{opt.label}</span>
                    {opt.sublabel && <span className="modern-select-opt-sublabel">{opt.sublabel}</span>}
                  </span>

                  {opt.meta != null && String(opt.meta).trim() !== '' && (
                    <span className="modern-select-opt-meta">
                      {typeof opt.meta === 'string' && (opt.meta.includes('$') || opt.meta.match(/^-?\d/)) ? (
                        <span className="modern-select-opt-price">{opt.meta}</span>
                      ) : (
                        <span className="modern-select-meta">{opt.meta}</span>
                      )}
                      {opt.change != null && (
                        <span className={`modern-select-opt-change ${Number(opt.change) >= 0 ? 'up' : 'down'}`}>
                          {Number(opt.change) >= 0 ? '+' : ''}{Number(opt.change).toFixed(2)}%
                        </span>
                      )}
                    </span>
                  )}

                  <span className="modern-select-opt-check" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 13 4 4L19 7" />
                    </svg>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </Sheet>
    </div>
  );
}
