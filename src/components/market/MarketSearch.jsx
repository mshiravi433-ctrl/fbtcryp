import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSearch, IconSparkle, IconX } from '../Icons.jsx';
import CoinLogo from '../CoinLogo.jsx';
import { contractQuery, mergeSearchResults } from '../../lib/marketSearch.js';
import { marketPrice } from '../../lib/marketPresentation.js';

/**
 * The market's single search surface: name, ticker, contract address, or an
 * executable natural-language request. Results are a proper combobox/listbox
 * with arrow-key navigation; there are no duplicate filter buttons here.
 *
 * ─── WHERE IT SITS, AND HOW IT LIGHTS UP ──────────────────────────────────
 * «زیر همه ارزها باید فیلد جستجو بیاد بالای فیلتر ها با ماچین نئونی»
 *
 * The field moved from the top of the page into the list card, between the
 * «همه ارزها» head and the filter chips: a search that filters the list reads
 * better attached to the list than floating above three unrelated boxes.
 *
 * The neon is a gradient hairline (`border-box` over `padding-box`) that is dim
 * at rest and lights on focus, plus ONE 0.9s sweep of the same gradient when
 * the field takes focus. Both are compositor-only, both stop for
 * reduced-motion/native/lite, and neither loops — a permanently pulsing input
 * is the "چشمک زدن" this screen was explicitly asked to drop.
 *
 * `data-typed` exists so CSS can hide the «هوشمند» capability chip the moment
 * there is text to read, without the chip ever competing with the clear button.
 */
export default function MarketSearch({
  query,
  onQueryChange,
  onApplyIntent,
  onNavigate,
  universe = [],
  remoteHits = [],
  searching = false,
  searchError = null,
  smartIntent = null,
  vs = 'usd'
}) {
  const { t } = useTranslation();
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(null);
  const trimmed = query.trim();
  const isContract = Boolean(contractQuery(trimmed));
  const results = useMemo(
    () => (smartIntent ? [] : mergeSearchResults(universe, remoteHits, trimmed)),
    [universe, remoteHits, trimmed, smartIntent]
  );
  const showPopup = open && trimmed.length >= 2 && !smartIntent;
  const popupId = `${baseId}-popup`;
  const optionId = (index) => `${baseId}-option-${index}`;

  useEffect(() => setActive(null), [trimmed]);
  useEffect(() => {
    if (active == null || !listRef.current) return;
    const option = listRef.current.querySelector(`#${optionId(active)}`);
    option?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (coin) => {
    if (!coin?.id) return;
    setOpen(false);
    setActive(null);
    onNavigate?.(`/coin/${coin.id}`);
  };

  const submit = () => {
    if (active != null && results[active]) {
      choose(results[active]);
      return;
    }
    if (!isContract && onApplyIntent?.(query)) {
      setOpen(false);
      document.getElementById('market-list-title')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      return;
    }
    if (results.length) choose(results[0]);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!results.length) return;
      event.preventDefault();
      setOpen(true);
      setActive((current) => {
        const base = current == null ? (event.key === 'ArrowDown' ? -1 : 0) : current;
        const next = base + (event.key === 'ArrowDown' ? 1 : -1);
        return (next + results.length) % results.length;
      });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(null);
    }
  };

  return (
    <div className="mx-search-wrap" ref={wrapRef}>
      <div className={`mx-search${open ? ' is-open' : ''}`} data-typed={query ? 'true' : undefined}>
        <span className="mx-search-glow" aria-hidden="true" />
        <span className="mx-search-tile" aria-hidden="true">
          <IconSearch className="mx-search-icon" width={16} height={16} aria-hidden="true" />
        </span>
        <input
          ref={inputRef}
          id="market-coin-search"
          className="mx-search-input"
          type="search"
          role="combobox"
          aria-expanded={showPopup}
          aria-controls={showPopup ? popupId : undefined}
          aria-activedescendant={showPopup && active != null ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-label={t('market.searchAria')}
          value={query}
          onChange={(event) => { onQueryChange(event.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t('marketIntel.searchPlaceholder')}
          autoComplete="off"
          enterKeyHint="search"
          spellCheck="false"
        />
        {query && (
          <button
            type="button"
            className="mx-search-clear"
            aria-label={t('market.clearSearch')}
            onClick={() => { onQueryChange(''); setActive(null); inputRef.current?.focus(); }}
          >
            <IconX width={14} height={14} aria-hidden="true" />
          </button>
        )}
        {!query && (
          <span className="mx-search-ai" title={t('market.aiHint')}>
            <IconSparkle width={11} height={11} aria-hidden="true" />
            {t('marketIntel.aiChip')}
          </span>
        )}
      </div>

      {showPopup && (
        <div className="mx-search-popup" id={popupId}>
          {searching && !results.length && (
            <div className="mx-search-state" role="status">{t('market.searching')}</div>
          )}
          {!searching && !results.length && (
            <div className="mx-search-state" role="status">
              {searchError ? t('marketIntel.searchUnavailable') : t('market.noResults')}
            </div>
          )}
          {results.length > 0 && (
            <div className="mx-search-results" role="listbox" ref={listRef} aria-label={t('marketIntel.searchResults')}>
              {results.map((coin, index) => (
                <div
                  key={coin.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={active === index}
                  className="mx-search-option"
                  data-active={active === index ? 'true' : undefined}
                  onPointerEnter={() => setActive(index)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(coin)}
                >
                  <CoinLogo coin={coin} px={30} />
                  <span className="mx-search-option-id">
                    <b>{coin.symbol}</b>
                    <small>{coin.name}</small>
                  </span>
                  <span className="mx-search-option-price mono">
                    {marketPrice(coin.price, vs)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {isContract && (
            <div className="mx-search-contract-note">{t('marketIntel.contractExact')}</div>
          )}
        </div>
      )}
    </div>
  );
}
