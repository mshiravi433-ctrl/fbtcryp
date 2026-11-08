/**
 * AI INTELLIGENCE — TOKEN COMPARISON
 * ---------------------------------------------------------------------------
 * Two to four tokens side by side on the metrics the feed actually provides.
 * The winner is marked PER ROW and only for that row — there is deliberately no
 * "best token" callout, because the ranking flips with the metric and a single
 * badge would invent a conclusion the data does not support.
 *
 * The performance chart is the 7-day sparkline the market feed already ships
 * with each row, normalised to 100 at the start of the window.
 */
import { useMemo, useState } from 'react';
import { Change, Chip, MultiLine, SectionCard } from './ui.jsx';
import { fmtMoney, fmtNumber, fmtPrice, t } from '../../../lib/intelligence/copy.js';
import { rangePosition } from '../../../lib/intelligence/indicators.js';

const MAX = 4;

const METRICS = [
  {
    id: 'price',
    key: 'screener.col.price',
    value: (r) => r.price,
    format: (v) => fmtPrice(v),
    better: null
  },
  { id: 'change24h', key: 'cmp.change24h', value: (r) => r.change24h, better: 'high', change: true },
  { id: 'change7d', key: 'cmp.change7d', value: (r) => r.change7d, better: 'high', change: true },
  { id: 'volume', key: 'cmp.volume', value: (r) => r.volume, format: (v, l) => fmtMoney(v, l), better: 'high' },
  { id: 'mcap', key: 'cmp.mcap', value: (r) => r.mcap, format: (v, l) => fmtMoney(v, l), better: 'high' },
  { id: 'rank', key: 'cmp.rank', value: (r) => r.rank, format: (v) => `#${fmtNumber(v)}`, better: 'low' },
  { id: 'athChange', key: 'cmp.ath', value: (r) => r.athChange, better: 'high', change: true },
  {
    id: 'range',
    key: 'cmp.range',
    value: (r) => rangePosition(r.low24h, r.high24h, r.price),
    format: (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`),
    better: null
  }
];

function normalise(series) {
  const nums = (series || []).map(Number).filter(Number.isFinite);
  if (nums.length < 2 || !nums[0]) return [];
  const base = nums[0];
  return nums.map((v) => (v / base) * 100);
}

export default function CompareTab({ markets = [], locale, initial = [] }) {
  const pool = useMemo(
    () => [...markets].sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9)),
    [markets]
  );
  const [ids, setIds] = useState(() => {
    const preferred = initial.length ? initial : ['bitcoin', 'ethereum', 'solana'];
    const found = preferred.filter((id) => pool.some((r) => r.id === id));
    if (found.length >= 2) return found.slice(0, MAX);
    return pool.slice(0, 2).map((r) => r.id);
  });

  const selected = ids.map((id) => pool.find((r) => r.id === id)).filter(Boolean);

  const add = (id) => {
    if (!id || ids.includes(id) || ids.length >= MAX) return;
    setIds([...ids, id]);
  };
  const remove = (id) => setIds(ids.filter((x) => x !== id));

  const series = selected.map((r) => ({ symbol: r.symbol, values: normalise(r.sparkline) }));

  return (
    <div className="aix-tab-body">
      <SectionCard title={t(locale, 'tab.compare')} hint={t(locale, 'cmp.pick')}>
        <div className="aix-compare-add">
          <select
            value=""
            onChange={(e) => { add(e.target.value); e.target.value = ''; }}
            disabled={ids.length >= MAX}
            aria-label={t(locale, 'cmp.pick')}
          >
            <option value="">+ {t(locale, 'token.pick')}</option>
            {pool.slice(0, 300).map((r) => (
              <option key={r.id} value={r.id}>{r.symbol} — {r.name}</option>
            ))}
          </select>
          {selected.map((r) => (
            <Chip key={r.id} onClick={() => remove(r.id)} title={t(locale, 'page.close')}>
              {r.symbol} ✕
            </Chip>
          ))}
        </div>

        {selected.length >= 2 ? (
          <>
            <p className="aix-card-hint aix-swipe-hint">
              {String(locale || '').startsWith('fa') ? 'برای دیدن همه توکن‌ها، جدول را افقی ورق بزنید.' : 'Swipe the table horizontally to see every token.'}
            </p>
            <div className="aix-compare-table">
              <div className="aix-cmp-row aix-cmp-head">
                <span>{t(locale, 'cmp.metric')}</span>
                {selected.map((r) => <span key={r.id}>{r.symbol}</span>)}
              </div>
              {METRICS.map((m) => {
                const values = selected.map((r) => m.value(r));
                const finite = values.filter((v) => Number.isFinite(v));
                const best = m.better && finite.length > 1
                  ? (m.better === 'high' ? Math.max(...finite) : Math.min(...finite))
                  : null;
                return (
                  <div key={m.id} className="aix-cmp-row">
                    <span className="aix-cmp-label">{t(locale, m.key)}</span>
                    {selected.map((r, i) => {
                      const v = values[i];
                      const isBest = best != null && v === best;
                      return (
                        <span key={r.id} className={isBest ? 'is-best' : ''}>
                          {m.change
                            ? <Change value={v} />
                            : (m.format ? m.format(v, locale) : (Number.isFinite(v) ? fmtNumber(v, 2) : '—'))}
                          {isBest ? <i className="aix-best-dot" title={t(locale, 'cmp.best')} /> : null}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="aix-card-hint">{t(locale, 'cmp.pick')}</p>
        )}
      </SectionCard>

      {series.filter((s) => s.values.length > 1).length >= 2 ? (
        <SectionCard title={String(locale || '').startsWith('fa') ? 'عملکرد ۷ روز (نرمال‌شده به ۱۰۰)' : '7-day performance (normalised to 100)'}>
          <MultiLine series={series} />
        </SectionCard>
      ) : null}

      <p className="aix-foot-note">{t(locale, 'cmp.note')}</p>
    </div>
  );
}
