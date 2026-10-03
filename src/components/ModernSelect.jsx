import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import CoinLogo from './CoinLogo';
import TokenIcon from '../lib/tokenIcon.jsx';
import AssetIcon from './AssetIcon';
import '../styles/modern-select.css';

/*
 * ─── THE SEARCH BOX NO LONGER OPENS THE KEYBOARD BY ITSELF ──────────────────
 *
 * Reported, on the bridge and on five other screens:
 *
 *   «باکس‌های پاپ‌اپ برای انتخاب توکن و شبکه نوار جستجو را محو کن چون هر بار
 *    میزنه خودکار صفحه کلید هم باز می‌شود»
 *
 * The old sheet rendered an `<input autoFocus>` whenever a list had more than
 * five rows. On a phone that is not a convenience, it is an ambush: tapping
 * «شبکه» to see the sixteen networks threw the on-screen keyboard over half
 * the list — the rows the user came for — and the sheet had to be scrolled in
 * a viewport that had just lost a third of its height. In the APK it is worse,
 * because the keyboard resizes the WebView and the sheet animates again.
 *
 * So the field is GONE from the default view, not merely unfocused:
 *
 *   • `searchable` now defaults to FALSE. A list of five or fifty tokens opens
 *     as a plain list of rows with their artwork — nothing to type, nothing to
 *     focus, no keyboard.
 *   • A caller that really needs search passes `searchable`, which renders a
 *     small «جستجو» button in a toolbar above the list. The field appears only
 *     after that button is tapped, and that tap is an explicit request for a
 *     keyboard — the one case where focusing is correct.
 *   • The count of matches sits beside it, so the toolbar answers "how many"
 *     without a keystroke.
 *
 * The labels are translated now too. The old ones were hardcoded Persian
 * («جستجو…», «چیزی پیدا نشد»), which is the other half of the same report:
 * «حتی با وجود زبان انگلیسی همیشه زبان فارسی کلمه جستجو را نشان می‌دهد» — an
 * English user was shown a Persian placeholder because the string was a
 * literal in this file rather than a key.
 */

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
 *  - searchable: boolean (default FALSE — see the note above; when true, a
 *    «جستجو» button reveals the field on demand, and the keyboard only opens
 *    because the user asked for it)
 *  - compact: boolean — tighter trigger for the side-by-side bridge rows
 *  - disabled, testId
 */
export default function ModernSelect({
  value,
  onChange,
  options = [],
  title,
  placeholder,
  searchable = false,
  compact = false,
  disabled = false,
  testId,
  triggerSublabel,
  /*
   * HOW MANY ROWS TO PUT IN THE DOM.
   *
   * The Auto Orders picker offers the whole swap token universe — up to 4,000
   * tokens a chain. Filtering 4,000 strings is nothing; mounting 4,000 buttons
   * is a stall on a cheap phone, and the search would be unusably slow exactly
   * where it is needed most. The filter still runs over EVERY option (so a
   * match is never missed); only the rendering is bounded, and the list says
   * how many of how many it is showing.
   */
  maxRender = 300,
  /* The trigger's accessible name. Every caller so far sits under a visible
     field label («ارز دریافت», «شبکه»); a control embedded inside another box —
     the fiat currency inside the amount field — has nothing to read out, so it
     names itself. */
  ariaLabel,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  /* The search field is a user action, never a side effect of opening a list. */
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);

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
    if (!open) {
      setQ('');
      setSearchOpen(false);
    }
  }, [open]);

  /*
   * Search is offered from FOUR options up — the old threshold was six, and a
   * list of five unlabelled network rows is exactly where a filter starts
   * paying for itself. It still costs nothing to open the sheet: the button is
   * inert until it is tapped, and the list renders unfiltered until then.
   */
  const canSearch = searchable && options.length > 3;
  const triggerPx = compact ? 34 : 40;
  const searchLabel = t('common.search', { defaultValue: 'Search' });
  const noResults = t('common.noResults', { defaultValue: 'No results' });

  return (
    <div className={`modern-select ${compact ? 'modern-select--compact' : ''}`} data-testid={testId}>
      <button
        type="button"
        className="modern-select-trigger"
        aria-label={ariaLabel}
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
        {canSearch && (
          <div className="modern-select-tools">
            <button
              type="button"
              className={`modern-select-search-toggle${searchOpen ? ' is-on' : ''}`}
              aria-expanded={searchOpen}
              aria-controls="modern-select-search-field"
              data-testid={testId ? `${testId}-search-toggle` : undefined}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
              <span>{searchLabel}</span>
            </button>
            <span className="modern-select-count mono" aria-live="polite">
              {filtered.length}
            </span>
          </div>
        )}

        {canSearch && searchOpen && (
          <div className="modern-select-search" id="modern-select-search-field">
            <span className="modern-select-search-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
            </span>
            <input
              /*
               * `autoFocus` HERE IS DELIBERATE, and it is the only place in this
               * file that may focus anything: this element exists because the
               * user tapped «جستجو» two lines above. The keyboard that appears
               * was asked for — which is the difference between a shortcut and
               * the ambush described at the top of the file.
               */
              ref={searchRef}
              autoFocus
              type="search"
              inputMode="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchLabel}
              aria-label={searchLabel}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              dir="auto"
            />
            {q ? (
              <button
                type="button"
                className="modern-select-search-clear"
                onClick={() => { setQ(''); searchRef.current?.focus(); }}
                aria-label={t('common.clear')}
              >
                ×
              </button>
            ) : null}
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
              <span>{noResults}</span>
            </div>
          ) : (
            <>
            {filtered.slice(0, maxRender).map((opt) => {
              const isSel = String(opt.value) === String(value);
              /*
               * A ROW CAN BE OFFERED AND STILL BE UNPICKABLE.
               *
               * The Auto Orders screen lists every token the swap screen trades
               * and marks the ones with no price feed: hiding them would leave
               * the user searching for a token that is right there on the swap
               * screen, with nothing to explain why it is missing here. So the
               * row stays, dimmed, with its reason in the sublabel, and does
               * not close the sheet or change the selection. `aria-disabled`
               * plus an inert click is the whole contract; nothing about the
               * option list changes for callers that never set it.
               */
              const isOff = opt.disabled === true;
              return (
                <button
                  key={String(opt.value)}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  aria-disabled={isOff || undefined}
                  disabled={isOff}
                  title={isOff ? String(opt.disabledReason ?? '') || undefined : undefined}
                  className={`modern-select-option ${isSel ? 'is-selected' : ''}${isOff ? ' is-disabled' : ''}`}
                  onClick={() => {
                    if (isOff) return;
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
            })}
            {filtered.length > maxRender && (
              <p className="modern-select-more">
                {t('common.showing', {
                  shown: Math.min(maxRender, filtered.length),
                  total: filtered.length,
                  defaultValue: 'Showing {{shown}} of {{total}}'
                })}
              </p>
            )}
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}
