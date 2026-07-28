import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { loadTokens, resolveCustomToken, searchTokens } from '../lib/tokenLists';
import { IconCheck, IconShield, IconX } from './Icons';

/**
 * Searchable token picker over the full multi-thousand list.
 *
 * Three behaviours worth knowing about:
 *
 * 1. The search input is debounced by 180 ms. Filtering ~10k tokens on every
 *    keystroke is visibly janky on a budget Android phone, which is what most
 *    of our users have.
 *
 * 2. Results are windowed — we render 60 rows and grow as you scroll. React
 *    reconciling thousands of DOM nodes freezes the sheet for seconds.
 *
 * 3. Pasting a contract address that no list contains queries the chain
 *    directly. Tokens launched today have the most volume and appear in no
 *    published list yet; refusing to trade them means refusing the fee.
 */

const PAGE = 60;

function TokenRow({ token, selected, disabled, onPick }) {
  const { t } = useTranslation();
  const [imgOk, setImgOk] = useState(true);

  return (
    <button
      className="tk-row"
      data-selected={selected ? 'true' : 'false'}
      disabled={disabled}
      onClick={() => onPick(token)}
    >
      <span className="tk-logo">
        {token.logoURI && imgOk ? (
          <img src={token.logoURI} alt="" loading="lazy" onError={() => setImgOk(false)} />
        ) : (
          <span className="tk-logo-text">{token.symbol.slice(0, 3).toUpperCase()}</span>
        )}
      </span>

      <span className="tk-meta">
        <span className="tk-sym">
          {token.symbol}
          {token.verified && (
            <span className="tk-badge" title={t('swap.verifiedHint')}>
              <IconShield width={10} height={10} />
            </span>
          )}
        </span>
        <span className="tk-name">{token.name}</span>
      </span>

      <span className="tk-right">
        {selected && <IconCheck width={16} height={16} />}
        {token.symbolCollision && !token.verified && (
          <span className="tk-warn" title={t('swap.collisionHint')}>!</span>
        )}
      </span>
    </button>
  );
}

export default function TokenPicker({
  open,
  onClose,
  chainId,
  selectedSymbol,
  excludeAddress,
  getProvider,
  onSelect
}) {
  const { t } = useTranslation();

  const [all, setAll] = useState([]);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState('');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [custom, setCustom] = useState(null);
  const [customErr, setCustomErr] = useState(null);
  const [resolving, setResolving] = useState(false);

  const inputRef = useRef(null);
  const listRef = useRef(null);

  /* ----------------------------- load the list ---------------------------- */

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    loadTokens(chainId)
      .then((res) => {
        if (!alive) return;
        setAll(res.tokens);
        setDegraded(res.degraded);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, chainId]);

  // Reset per-open state. Without this, reopening the sheet shows the previous
  // search and scroll position, which reads as a bug.
  useEffect(() => {
    if (!open) return;
    setRaw('');
    setQuery('');
    setShown(PAGE);
    setCustom(null);
    setCustomErr(null);
  }, [open]);

  /* ------------------------------- debounce ------------------------------- */

  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(raw);
      setShown(PAGE);
      listRef.current?.scrollTo?.({ top: 0 });
    }, 180);
    return () => clearTimeout(id);
  }, [raw]);

  /* -------------------------------- results ------------------------------- */

  const results = useMemo(() => {
    const list = searchTokens(all, query, 400);
    if (!excludeAddress) return list;
    // You can't swap a token for itself; showing it invites a dead end.
    return list.filter((tk) => (tk.address ?? '').toLowerCase() !== excludeAddress.toLowerCase());
  }, [all, query, excludeAddress]);

  const visible = results.slice(0, shown);

  /* --------------------------- custom address ----------------------------- */

  const looksLikeAddress = /^0x[a-fA-F0-9]{40}$/.test(query.trim());
  const noResults = !loading && results.length === 0;

  useEffect(() => {
    setCustom(null);
    setCustomErr(null);
    if (!looksLikeAddress || !noResults || !getProvider) return;

    let alive = true;
    setResolving(true);
    (async () => {
      try {
        const provider = await getProvider(chainId);
        const tk = await resolveCustomToken(provider, query.trim());
        if (alive) setCustom(tk);
      } catch (err) {
        if (alive) setCustomErr(err.message === 'NOT_ERC20' ? 'notErc20' : 'lookupFailed');
      } finally {
        if (alive) setResolving(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [looksLikeAddress, noResults, query, chainId, getProvider]);

  /* -------------------------------- scroll -------------------------------- */

  const onScroll = useCallback(
    (e) => {
      const el = e.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320) {
        setShown((n) => (n >= results.length ? n : n + PAGE));
      }
    },
    [results.length]
  );

  const pick = (tk) => {
    onSelect(tk);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('swap.selectToken')}>
      {/* ------------------------------ search ------------------------------ */}
      <div className="tk-search">
        <input
          ref={inputRef}
          className="tk-input"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={t('swap.searchPlaceholder')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="search"
        />
        {raw && (
          <button className="tk-clear" onClick={() => setRaw('')} aria-label={t('common.close')}>
            <IconX width={14} height={14} />
          </button>
        )}
      </div>

      <div className="tk-count">
        {loading
          ? t('swap.loadingTokens')
          : t('swap.tokenCount', { shown: results.length, total: all.length })}
      </div>

      {degraded && <p className="notice" style={{ marginTop: 8 }}>{t('swap.listDegraded')}</p>}

      {/* ------------------------------- list ------------------------------- */}
      <div className="tk-list" ref={listRef} onScroll={onScroll}>
        {loading && (
          <div style={{ display: 'grid', placeItems: 'center', padding: 28 }}>
            <div className="spinner" />
          </div>
        )}

        {visible.map((tk) => (
          <TokenRow
            key={tk.address ?? tk.symbol}
            token={tk}
            selected={tk.symbol === selectedSymbol}
            onPick={pick}
          />
        ))}

        {/* A token no published list knows about — read straight off-chain. */}
        {resolving && (
          <div className="tk-hint">
            <div className="spinner" style={{ width: 16, height: 16 }} />
            <span>{t('swap.lookingUp')}</span>
          </div>
        )}

        {custom && (
          <>
            <div className="tk-divider">{t('swap.foundOnChain')}</div>
            <TokenRow token={custom} selected={false} onPick={pick} />
            <p className="notice notice-danger" style={{ margin: '10px 0 0' }}>
              {t('swap.customWarning')}
            </p>
          </>
        )}

        {customErr && <p className="notice notice-danger">{t(`swap.${customErr}`)}</p>}

        {noResults && !looksLikeAddress && !loading && (
          <div className="tk-hint" style={{ flexDirection: 'column', gap: 6, padding: '26px 12px' }}>
            <span>{t('swap.noResults')}</span>
            <span className="faint" style={{ textAlign: 'center' }}>{t('swap.pasteAddressHint')}</span>
          </div>
        )}

        {!loading && shown < results.length && (
          <motion.button
            className="btn btn-ghost btn-sm"
            style={{ width: '100%', marginTop: 8 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShown((n) => n + PAGE * 3)}
          >
            {t('swap.loadMore')}
          </motion.button>
        )}
      </div>
    </Sheet>
  );
}
