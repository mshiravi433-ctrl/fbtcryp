import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSearch, IconX } from '../Icons.jsx';
import CoinLogo from '../CoinLogo.jsx';
import { contractQuery, mergeSearchResults } from '../../lib/marketSearch.js';
import { marketPrice } from '../../lib/marketPresentation.js';

/**
 * The market's single search surface: name, ticker, contract address, or an
 * executable natural-language request. Results are a proper combobox/listbox
 * with arrow-key navigation; there are no duplicate filter buttons here.
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
      <div className={`mx-search${open ? ' is-open' : ''}`}>
        <IconSearch className="mx-search-icon" width={18} height={18} aria-hidden="true" />
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
