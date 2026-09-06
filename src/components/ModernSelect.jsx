import { useEffect, useMemo, useState } from 'react';
import Sheet from './Sheet';
import CoinLogo from './CoinLogo';
import TokenIcon from '../lib/tokenIcon.jsx';
import AssetIcon from './AssetIcon';
import '../styles/modern-select.css';

/**
 * ─── HOW AN OPTION GETS ITS PICTURE ─────────────────────────────────────────
 * In priority order:
 *   iconNode          caller-rendered element
 *   coin              a market coin → CoinLogo (CoinGecko artwork, monogram fallback)
 *   base + quote      a market pair → AssetIcon pair (EUR/USD, XAU/USD, AAPL/USD)
 *   symbol [+ chain]  a curated token / currency → AssetIcon (offline SVG)
 *   chain             a network → AssetIcon network mark
 *   token             an address-keyed token → TokenIcon (TrustWallet, CDN),
 *                     with the offline artwork as the LAST resort, never first
 *   iconUrl           a plain URL
 *   otherwise         the deterministic monogram
 *
 * `symbol`/`chain`/`base` are the offline path. They render from vendored
 * SVG, so a picker looks the same on a phone that cannot reach any icon CDN —
 * which is where the «توکن عکس نداره» reports came from.
 */
function renderIcon(opt, px) {
  if (!opt) return <AssetIcon symbol="?" size={px} />;
  if (opt.iconNode) return opt.iconNode;
  if (opt.coin) return <CoinLogo coin={opt.coin} px={px} />;
  if (opt.base) return <AssetIcon base={opt.base} quote={opt.quote} size={px} />;
  if (opt.symbol) return <AssetIcon symbol={opt.symbol} chain={opt.chain} size={px} />;
  if (opt.chain != null) return <AssetIcon chain={opt.chain} size={px} />;
  if (opt.token) return <OfflineFirstToken token={opt.token} chainId={opt.chainId} px={px} />;
  if (opt.iconUrl) {
    return (
      <img
        src={opt.iconUrl}
        alt=""
        width={px}
        height={px}
        style={{ borderRadius: Math.round(px * 0.28), objectFit: 'cover' }}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(e) => { e.currentTarget.style.display = 'none'; }}
      />
    );
  }
  return <AssetIcon symbol={opt.label || '?'} size={px} />;
}

/*
 * A token option that carries an address. Curated bridge tokens (USDT, USDC)
 * have offline artwork; use it and skip the network entirely. Anything else
 * goes through the address-keyed resolver so a look-alike symbol can never
 * borrow the real token's face.
 */
function OfflineFirstToken({ token, chainId, px }) {
  const sym = String(token?.symbol || '').toUpperCase();
  const curated = ['USDT', 'USDC', 'DAI', 'WETH', 'WBTC', 'BTCB', 'WBNB'].includes(sym);
  if (curated) return <AssetIcon symbol={sym} chain={chainId} size={px} />;
  return <TokenIcon token={token} chainId={chainId} size={px} />;
}

/**
 * ModernSelect — a bottom-sheet token / chain / market picker.
 *
 * Props
 *  - value: currently selected value (matched against option.value)
 *  - onChange: (value, option) => void
 *  - options: Array<{ value, label, sublabel?, meta?, change?, coin?, token?, chainId?,
 *                     symbol?, chain?, base?, quote?, iconNode?, iconUrl? }>
 *  - title: sheet title
 *  - placeholder: text when nothing is selected
 *  - searchable: boolean (default true; the box appears from 6 options up)
 *  - compact: boolean — tighter trigger for the side-by-side bridge rows
 *  - disabled, testId
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
      const hay = `${o.label ?? ''} ${o.sublabel ?? ''} ${o.value ?? ''} ${o.meta ?? ''} ${o.symbol ?? ''} ${o.base ?? ''} ${o.quote ?? ''}`.toLowerCase();
      return hay.includes(s);
    });
  }, [options, q]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  const showSearch = searchable && options.length > 5;
  const triggerPx = compact ? 34 : 40;

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
          {renderIcon(selected, triggerPx)}
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
                    {renderIcon(opt, 42)}
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
