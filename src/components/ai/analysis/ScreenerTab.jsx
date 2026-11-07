/**
 * AI INTELLIGENCE — TOKEN SCREENER
 * ---------------------------------------------------------------------------
 * The whole feed, not five coins. Search, six filters and column sorting over
 * the rows the market API actually returned (up to 250), with the honest
 * coverage line underneath.
 *
 * Sorting is stable and null-last: a token with no 7d number sinks to the
 * bottom of a 7d sort instead of being treated as 0% and ranking mid-pack.
 */
import { useMemo, useState } from 'react';
import { Change, Chip, ProvenanceDot, SectionCard, Spark } from './ui.jsx';
import { fmtMoney, fmtNumber, fmtTimeAgo, t } from '../../../lib/intelligence/copy.js';
import { rangePosition } from '../../../lib/intelligence/indicators.js';
import { bucketOf } from '../../../lib/intelligence/portfolioAnalysis.js';
import { IconSearch } from '../../Icons';

const FILTERS = [
  { id: 'all', key: 'screener.filter.all' },
  { id: 'gainers', key: 'screener.filter.gainers' },
  { id: 'losers', key: 'screener.filter.losers' },
  { id: 'volume', key: 'screener.filter.volume' },
  { id: 'nearHigh', key: 'screener.filter.nearHigh' },
  { id: 'deepAth', key: 'screener.filter.deepAth' },
  { id: 'stable', key: 'screener.filter.stable' }
];

const COLUMNS = [
  { id: 'change24h', key: 'screener.col.ch24h' },
  { id: 'change7d', key: 'screener.col.ch7d' },
  { id: 'volume', key: 'screener.col.volume' },
  { id: 'mcap', key: 'screener.col.mcap' },
  { id: 'athChange', key: 'screener.col.ath' }
];

function toggleTurnover(row) {
  const vol = Number(row?.volume);
  const mcap = Number(row?.mcap);
  return Number.isFinite(vol) && Number.isFinite(mcap) && mcap > 0 ? (vol / mcap) * 100 : null;
}

function sortValue(row, key) {
  if (key === 'volume') return Number(row.volume) || null;
  if (key === 'mcap') return Number(row.mcap) || null;
  if (key === 'athChange') return Number.isFinite(row.athChange) ? row.athChange : null;
  const v = row[key];
  return Number.isFinite(v) ? v : null;
}

export default function ScreenerTab({ markets, locale, onOpenToken, updatedAt, provenance }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ key: 'mcap', dir: 'desc' });
  const [limit, setLimit] = useState(60);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = (markets || []).filter((r) => {
      if (!q) return true;
      return String(r.symbol || '').toLowerCase().includes(q) || String(r.name || '').toLowerCase().includes(q);
    });

    if (filter === 'gainers') list = list.filter((r) => Number.isFinite(r.change24h) && r.change24h > 0);
    if (filter === 'losers') list = list.filter((r) => Number.isFinite(r.change24h) && r.change24h < 0);
    if (filter === 'volume') list = list.filter((r) => (toggleTurnover(r) ?? 0) >= 5);
    if (filter === 'nearHigh') list = list.filter((r) => (rangePosition(r.low24h, r.high24h, r.price) ?? 0) >= 0.95);
    if (filter === 'deepAth') list = list.filter((r) => Number.isFinite(r.athChange) && r.athChange <= -70);
    if (filter === 'stable') list = list.filter((r) => bucketOf(r.symbol) === 'stable');

    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // nulls always last
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [markets, query, filter, sort]);

  const visible = rows.slice(0, limit);

  const onSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
  };

  return (
    <div className="aix-tab-body">
      <SectionCard
        title={t(locale, 'tab.screener')}
        hint={t(locale, 'screener.showing', { shown: visible.length, scanned: rows.length })}
        actions={(
          <>
            <ProvenanceDot provenance={provenance} label={fmtTimeAgo(updatedAt, locale)} />
          </>
        )}
      >
        <div className="aix-screener-controls">
          <div className="aix-search-wrap">
            <IconSearch width={18} height={18} aria-hidden="true" />
            <input
              className="aix-search"
              type="search"
              value={query}
              placeholder={t(locale, 'screener.search')}
              onChange={(e) => { setQuery(e.target.value); setLimit(60); }}
              aria-label={t(locale, 'screener.search')}
            />
          </div>

          <div className="aix-control-group">
            <span className="aix-control-label">{locale === 'fa' ? 'فیلتر بازار' : 'Market filter'}</span>
            <div className="aix-chips">
              {FILTERS.map((f) => (
                <Chip key={f.id} active={filter === f.id} onClick={() => { setFilter(f.id); setLimit(60); }}>
                  {t(locale, f.key)}
                </Chip>
              ))}
            </div>
          </div>

          <div className="aix-control-group aix-sort-group">
            <span className="aix-control-label">{locale === 'fa' ? 'مرتب‌سازی بر اساس' : 'Sort by'}</span>
            <div className="aix-sortrow">
              {COLUMNS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`aix-sort${sort.key === c.id ? ' is-active' : ''}`}
                  onClick={() => onSort(c.id)}
                  aria-pressed={sort.key === c.id}
                >
                  {t(locale, c.key)}
                  {sort.key === c.id ? <span aria-hidden="true">{sort.dir === 'desc' ? ' ↓' : ' ↑'}</span> : null}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="aix-table-shell">
          <div className="aix-table" role="table" aria-label={t(locale, 'tab.screener')}>
          <div className="aix-thead" role="row">
            <span role="columnheader">{t(locale, 'screener.col.token')}</span>
            <span role="columnheader" className="aix-col-price">{t(locale, 'screener.col.price')}</span>
            <span role="columnheader" className="aix-col-h1">{t(locale, 'screener.col.ch1h')}</span>
            <span role="columnheader">{t(locale, 'screener.col.ch24h')}</span>
            <span role="columnheader" className="aix-col-d7">{t(locale, 'screener.col.ch7d')}</span>
            <span role="columnheader" className="aix-col-vol">{t(locale, 'screener.col.volume')}</span>
            <span role="columnheader" className="aix-col-ath">{t(locale, 'screener.col.ath')}</span>
            <span role="columnheader" aria-hidden="true" />
          </div>

          {visible.map((row) => (
            <div key={row.id} className="aix-trow" role="row">
              <button
                type="button"
                className="aix-token-cell"
                onClick={() => onOpenToken?.(row.id)}
                title={t(locale, 'screener.analyze')}
              >
                <span className="aix-token-avatar" aria-hidden="true">{String(row.symbol || '?').slice(0, 1)}</span>
                <span className="aix-token-copy">
                  <span className="aix-token-sym">{row.symbol}</span>
                  <span className="aix-token-name">{row.name}</span>
                </span>
              </button>
              <span className="aix-col-price aix-mono">
                {row.price >= 1 ? `$${row.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : `$${Number(row.price).toPrecision(3)}`}
              </span>
              <span className="aix-col-h1"><Change value={row.change1h} /></span>
              <span><Change value={row.change24h} /></span>
              <span className="aix-col-d7"><Change value={row.change7d} /></span>
              <span className="aix-col-vol aix-mono">{fmtMoney(row.volume, locale)}</span>
              <span className="aix-col-ath"><Change value={row.athChange} /></span>
              <span className="aix-col-spark"><Spark values={row.sparkline} up={(row.change24h ?? 0) >= 0} width={54} height={20} /></span>
            </div>
          ))}

            {!visible.length ? <p className="aix-card-hint aix-pad">{t(locale, 'screener.empty')}</p> : null}
          </div>
        </div>

        {rows.length > visible.length ? (
          <button type="button" className="aix-more" onClick={() => setLimit((v) => v + 80)}>
            {locale === 'fa' ? `نمایش ${Math.min(80, rows.length - visible.length)} ردیف بیشتر` : `Show ${Math.min(80, rows.length - visible.length)} more`}
          </button>
        ) : null}

        <p className="aix-card-hint aix-pad">
          {t(locale, 'page.rowsCounted', {
            counted: (markets || []).filter((r) => Number.isFinite(r.change24h)).length,
            total: (markets || []).length
          })}
          {rows.length ? ` · ${fmtNumber(rows.length)} ${locale === 'fa' ? 'در فیلتر' : 'matched'}` : ''}
        </p>
      </SectionCard>
    </div>
  );
}
