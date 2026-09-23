import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import TokenIcon from '../lib/tokenIcon';
import { isSolanaAddress } from '../lib/solana';
import {
  searchSolanaTokenMeta,
  fetchSolanaTokenSentiment,
  fetchSolanaTokensMeta
} from '../lib/solanaTokenMeta';
import { useSettingsStore } from '../store/useSettingsStore';
import '../styles/solana-token-picker.css';

/**
 * SOLANA TOKEN PICKER — the modern front door of the swap screen.
 * ===========================================================================
 *
 * WHAT REPLACED WHAT
 * The Solana tab picked tokens from two bare `<select>` elements — a list of
 * truncated symbols with no logos, no context and no search, on the screen
 * whose whole point is memecoins. The EVM tab has had a sheet picker with
 * icons, verified badges and search since it was built; this is that, built
 * for Solana's reality:
 *
 *   · PASTE-A-MINT IS A FIRST-CLASS CITIZEN. A query that is shaped like a
 *     base58 pubkey skips "search" entirely and resolves as an import — the
 *     Jupiter index names it and gives it a logo when it is indexed, and an
 *     honest «unknown token» row with a gradient monogram when it is not.
 *     Either way it is swappable the moment it is picked.
 *   · EVERY ROW CARRIES THE FACTS: real logo (or a deterministic gradient
 *     monogram — never an empty circle), verified badge, price, 24h move,
 *     liquidity, and the AI sentiment dot scored server-side from published
 *     data (never invented, `unknown` when unread — see server/solanaTokenMeta.js).
 *   · THE CURATED LIST GETS REAL ARTWORK TOO. The curated assets shipped with
 *     no `icon` field because a mint account cannot carry one; one batch
 *     metadata request fills them in from the same index.
 *
 * TRUST IS SHOWN, NOT ASSUMED: an unverified token is labelled unverified in
 * the list AND carries a small badge next to its symbol after selection, so
 * the status never disappears once the picker closes. A name can be spoofed;
 * a badge beside it cannot be un-seen.
 */

const SEARCH_DEBOUNCE_MS = 350;

/** Compact USD — $1.2M, $45K, $0.0{3}36. Null-safe: renders «—» when unknown. */
function compactUsd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  if (n === 0) return '$0';
  if (n >= 1) return `$${n.toFixed(2)}`;
  /* Sub-dollar: trim to three significant decimals without exponent notation. */
  return `$${n.toFixed(Math.min(8, Math.max(4, 2 - Math.floor(Math.log10(n)) + 3)))}`;
}

function SentimentChip({ sentiment }) {
  const { t } = useTranslation();
  if (!sentiment?.data) return null;
  const label = String(sentiment.label || 'unknown');
  return (
    <span className={`stp-sent stp-sent-${label}`} title={t(`solana.sentiment.${label}`)}>
      <span className="stp-sent-dot" aria-hidden="true" />
      {t(`solana.sentiment.${label}`)}
    </span>
  );
}

function TokenRow({ token, onPick, selected = false, testid }) {
  const { t } = useTranslation();
  const symbol = token.symbol || token.mint?.slice(0, 4) + '…' + token.mint?.slice(-4);
  const ch = token.priceChange24h;
  return (
    <button
      type="button"
      className="coin-row stp-row"
      style={{ width: '100%', textAlign: 'start' }}
      onClick={onPick}
      data-testid={testid}
    >
      <TokenIcon token={token} size={36} />
      <span className="coin-meta" style={{ minWidth: 0 }}>
        <span className="coin-sym stp-sym">{symbol}</span>
        <span className="stp-badges">
          {token.verified ? (
            <span className="stp-badge stp-badge-verified">✓ {t('solana.picker.verified')}</span>
          ) : token.imported || token.known === false ? (
            <span className="stp-badge stp-badge-unverified">{t('solana.picker.unverified')}</span>
          ) : null}
          {selected ? <span className="stp-badge stp-badge-current">{t('solana.picker.selected')}</span> : null}
        </span>
        <span className="stp-sub" style={{ display: 'block' }}>
          {token.name || (token.imported ? t('solana.importedToken') : '\u00A0')}
        </span>
      </span>
      <span className="stp-right">
        <span className="stp-price-row">
          <span className="mono stp-price">{token.usdPrice != null ? compactUsd(token.usdPrice) : '—'}</span>
          {ch != null ? (
            <span className={`mono stp-chg ${ch >= 0 ? 'stp-up' : 'stp-down'}`}>
              {ch >= 0 ? '+' : ''}{ch.toFixed(ch >= 100 ? 0 : 1)}%
            </span>
          ) : (
            <span className="mono stp-chg stp-flat">24h —</span>
          )}
        </span>
        <SentimentChip sentiment={token.sentiment} />
      </span>
    </button>
  );
}

/** The AI strip under a single resolved mint: the deterministic score, its
    drivers, and — when the backend has a key — one labelled generated line. */
function SentimentStrip({ mint }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(null);

  useEffect(() => {
    if (!mint) return undefined;
    let alive = true;
    setValue(null);
    fetchSolanaTokenSentiment(mint).then((v) => {
      if (alive) setValue(v);
    });
    return () => { alive = false; };
  }, [mint]);

  const s = value;
  if (!s) return null;
  const pct = Number.isFinite(s.score) ? Math.max(0, Math.min(100, s.score)) : null;
  const drivers = (s.drivers || []).slice(0, 3);

  return (
    <div className="stp-ai" data-testid="stp-ai-strip">
      <div className="row-between" style={{ gap: 8 }}>
        <span className="stp-ai-title"><span className="stp-ai-spark" aria-hidden="true">✦</span> {t('solana.sentiment.aiTitle')}</span>
        {s.hasData && pct != null ? (
          <span className={`mono stp-ai-score stp-ai-${s.label}`}>{pct}/100 · {t(`solana.sentiment.${s.label}`)}</span>
        ) : (
          <span className="mono stp-ai-score">{t('solana.sentiment.unknown')}</span>
        )}
      </div>
      {s.hasData && pct != null && (
        <div className="stp-ai-bar" aria-hidden="true">
          <span className={`stp-ai-fill stp-ai-${s.label}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {drivers.length > 0 && (
        <div className="stp-ai-drivers">
          {drivers.map((d, i) => (
            <span key={`${d.key}-${i}`} className="stp-ai-driver">{t(`solana.sentiment.drivers.${d.key}`, d.key)}</span>
          ))}
        </div>
      )}
      {s.aiText ? (
        <p className="stp-ai-line" style={{ margin: 0 }}>
          <span className="stp-ai-tag">{t('solana.sentiment.aiTag')}</span> {s.aiText}
        </p>
      ) : null}
    </div>
  );
}

/**
 * @param {boolean}  props.open
 * @param {Function} props.onClose
 * @param {Array}    props.tokens        the current full list (curated + imported)
 * @param {Function} props.onPick        (token) → select an existing entry
 * @param {Function} props.onImport      (token) → import a new mint (parent owns the list)
 * @param {string}   props.side          'from' | 'to' — which box opened us
 * @param {Array}    [props.selectedMints] mints already selected in the swap, shown as «در حال استفاده»
 */
export default function SolanaTokenPicker({ open, onClose, tokens, onPick, onImport, side = 'to', selectedMints = [] }) {
  const { t } = useTranslation();
  const cluster = useSettingsStore((s) => s.solanaCluster);
  const devnet = cluster === 'devnet';
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [query, setQuery] = useState('');
  const [deferred, setDeferred] = useState('');
  const [remoteRows, setRemoteRows] = useState([]);
  const [searching, setSearching] = useState(false);
  /* Enrichment: mint → { icon, usdPrice, ... } for the curated rows. */
  const [metaMap, setMetaMap] = useState(new Map());
  const reqSeq = useRef(0);

  /* Debounce the query into `deferred`. */
  useEffect(() => {
    const id = setTimeout(() => setDeferred(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  /* One batch request gives the curated list its real logos and prices. */
  useEffect(() => {
    if (!open || metaMap.size) return;
    let alive = true;
    fetchSolanaTokensMeta(tokens.map((tk) => tk.mint)).then((map) => {
      if (alive && map.size) setMetaMap(map);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* Remote search — a word, or a pasted mint; the endpoint treats both.
     The seq guard keeps a slow stale answer from overwriting a newer one. */
  useEffect(() => {
    const seq = reqSeq.current + 1;
    reqSeq.current = seq;
    if (!open || !deferred) {
      setRemoteRows([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    searchSolanaTokenMeta(deferred).then((rows) => {
      if (reqSeq.current === seq) {
        setRemoteRows(rows);
        setSearching(false);
      }
    });
    return undefined;
  }, [deferred, open]);

  const q = deferred.toLowerCase();
  const selectedSet = useMemo(() => new Set(selectedMints), [selectedMints]);

  const localMatches = useMemo(() => {
    if (!q) return [];
    return tokens.filter((tk) =>
      String(tk.symbol || '').toLowerCase().includes(q)
      || String(tk.name || '').toLowerCase().includes(q)
      || tk.mint.toLowerCase() === q
    );
  }, [tokens, q]);

  const remoteMatches = useMemo(() => {
    if (!q) return [];
    const localMints = new Set(tokens.map((tk) => tk.mint));
    let out = remoteRows.filter((r) => !localMints.has(r.mint));
    if (onlyVerified) out = out.filter((r) => r.verified === true);
    return out;
  }, [remoteRows, tokens, q, onlyVerified]);

  const curatedIdle = useMemo(() => {
    if (q) return [];
    /* The curated, non-imported entries, curated order preserved. */
    return tokens.filter((tk) => !tk.imported);
  }, [tokens, q]);

  const importedIdle = useMemo(() => {
    if (q) return [];
    return tokens.filter((tk) => tk.imported);
  }, [tokens, q]);

  /* The single-mint case: exactly what the import flow wants. */
  const mintQuery = useMemo(() => (deferred && isSolanaAddress(deferred) ? deferred : null), [deferred]);
  const mintLocal = useMemo(() => (mintQuery ? tokens.find((tk) => tk.mint === mintQuery) : null), [tokens, mintQuery]);
  const mintRemote = useMemo(() => (mintQuery ? remoteRows.find((r) => r.mint === mintQuery) : null), [remoteRows, mintQuery]);

  const enrich = useCallback((tk) => {
    const meta = metaMap.get(tk.mint);
    if (!meta) return tk;
    return {
      ...tk,
      icon: tk.icon || meta.icon || null,
      usdPrice: tk.usdPrice ?? meta.usdPrice ?? null,
      priceChange24h: tk.priceChange24h ?? meta.priceChange24h ?? null,
      sentiment: tk.sentiment || meta.sentiment || null,
      verified: tk.verified ?? meta.verified ?? false
    };
  }, [metaMap]);

  const pick = (tk) => {
    onPick?.(tk);
    setQuery('');
    setDeferred('');
  };

  const importMint = (meta = null) => {
    if (!mintQuery) return;
    onImport?.({
      mint: mintQuery,
      /* Jupiter's symbol/name when the index knows this mint, the honest
         truncated address when it does not. Either way `imported` keeps the
         token visibly distinct from curated ones everywhere it renders. */
      symbol: meta?.symbol || `${mintQuery.slice(0, 4)}…${mintQuery.slice(-4)}`,
      name: meta?.name || '',
      icon: meta?.icon || null,
      decimals: Number.isInteger(meta?.decimals) ? meta.decimals : 9,
      decimalsVerified: false,
      verified: meta?.verified === true,
      imported: true,
      usdPrice: meta?.usdPrice ?? null
    });
    setQuery('');
    setDeferred('');
  };

  const showSkeletons = searching && !localMatches.length && !remoteMatches.length;

  return (
    <Sheet
      open={open}
      onClose={() => {
        setQuery('');
        setDeferred('');
        onClose?.();
      }}
      title={side === 'from' ? t('solana.picker.titleFrom') : t('solana.picker.titleTo')}
      anchor="bottom"
      size="lg"
      className="stp-sheet"
    >
      <div className="stp-search">
        <span className="stp-search-icon" aria-hidden="true">⌕</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('solana.picker.searchPlaceholder')}
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          dir="ltr"
          style={{ textAlign: 'start' }}
          data-testid="stp-search-input"
        />
        {query ? (
          <button type="button" className="stp-clear" onClick={() => setQuery('')} aria-label={t('common.clear')}>×</button>
        ) : null}
      </div>

      <div className="stp-meta-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <span className={`sol-net-chip${devnet ? ' is-devnet' : ''}`} style={{ fontSize: 10 }}>
          <span className="sol-net-dot" aria-hidden="true" />
          {devnet ? 'Devnet' : 'Mainnet'}
        </span>
        <span className="faint" style={{ fontSize: 11 }}>{t('solana.picker.tokenOnlyNote', { defaultValue: 'فقط توکن — مین‌نت' })}</span>
        <button
          type="button"
          className={`btn btn-ghost btn-sm ${onlyVerified ? 'is-verified-on' : ''}`}
          style={{ marginInlineStart: 'auto', minHeight: 32, paddingInline: 10, fontSize: 11, borderColor: onlyVerified ? 'rgba(0,230,158,0.45)' : undefined, background: onlyVerified ? 'rgba(0,230,158,0.12)' : undefined }}
          onClick={() => setOnlyVerified((v) => !v)}
          aria-pressed={onlyVerified}
        >
          {onlyVerified ? `✓ ${t('solana.picker.verified')}` : t('solana.picker.verified')}
        </button>
      </div>

      {!deferred && curatedIdle.length > 0 && (
        <>
          <div className="stp-section">
            <span className="stp-section-title">{t('solana.picker.verifiedSection')}</span>
            <span className="stp-section-count mono">{curatedIdle.length}</span>
          </div>
          <div className="stp-list">
            {curatedIdle.map((tk) => {
              const e = enrich(tk);
              /* Curated entries are the app's own list: verified by definition. */
              return (
                <TokenRow
                  key={tk.mint}
                  token={{ ...e, verified: e.verified !== false }}
                  onPick={() => pick(tk)}
                  selected={selectedSet.has(tk.mint)}
                />
              );
            })}
          </div>
        </>
      )}

      {!deferred && importedIdle.length > 0 && (
        <>
          <div className="stp-section">
            <span className="stp-section-title">{t('solana.picker.importedSection')}</span>
            <span className="stp-section-count mono">{importedIdle.length}</span>
          </div>
          <div className="stp-list">
            {importedIdle.map((tk) => (
              <TokenRow key={tk.mint} token={enrich(tk)} onPick={() => pick(tk)} selected={selectedSet.has(tk.mint)} />
            ))}
          </div>
        </>
      )}

      {mintQuery && (
        <div className="stp-list" style={{ marginTop: 10 }}>
          {mintLocal ? (
            <TokenRow token={mintLocal} onPick={() => pick(mintLocal)} selected={selectedSet.has(mintQuery)} />
          ) : mintRemote ? (
            <TokenRow
              token={mintRemote}
              testid="stp-import-row"
              onPick={() => importMint(mintRemote)}
            />
          ) : searching ? (
            <div className="stp-row-loading">{t('common.loading')}</div>
          ) : (
            /* Not in any index: still importable — the chain read (decimals,
               balance) continues in the background exactly as before. */
            <TokenRow
              token={{ mint: mintQuery, symbol: null, name: t('solana.picker.unknownToken'), known: false }}
              testid="stp-import-row"
              onPick={() => importMint(null)}
            />
          )}
          {mintQuery && !mintLocal && (
            <p className="stp-import-note">{t('solana.picker.importNote')}</p>
          )}
          {(mintRemote || mintLocal) && <SentimentStrip mint={mintQuery} />}
        </div>
      )}

      {!mintQuery && localMatches.length > 0 && (
        <>
          <div className="stp-section"><span className="stp-section-title">{t('solana.picker.yourList')}</span></div>
          <div className="stp-list">
            {localMatches.map((tk) => (
              <TokenRow key={tk.mint} token={enrich(tk)} onPick={() => pick(tk)} selected={selectedSet.has(tk.mint)} />
            ))}
          </div>
        </>
      )}

      {!mintQuery && remoteMatches.length > 0 && (
        <>
          <div className="stp-section">
            <span className="stp-section-title">{t('solana.picker.results')}</span>
            <span className="stp-section-count mono">{remoteMatches.length}</span>
          </div>
          <div className="stp-list">
            {remoteMatches.slice(0, 24).map((r) => (
              <TokenRow key={r.mint} token={r} testid={`stp-row-${r.mint.slice(0, 6)}`} onPick={() => importMint(r)} />
            ))}
          </div>
        </>
      )}

      {showSkeletons && (
        <div className="stp-list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="coin-row stp-row stp-skeleton">
              <span className="stp-sk-circle" />
              <span className="stp-sk-lines">
                <span className="stp-sk-line" style={{ width: '42%' }} />
                <span className="stp-sk-line" style={{ width: '64%' }} />
              </span>
            </div>
          ))}
        </div>
      )}

      {!mintQuery && deferred && !searching && !localMatches.length && !remoteMatches.length && (
        <p className="stp-empty">{t('solana.picker.noResults')}</p>
      )}
    </Sheet>
  );
}
