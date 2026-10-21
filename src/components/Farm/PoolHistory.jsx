import { useEffect, useMemo, useState } from 'react';
import { getYieldHistory } from '../../lib/yields';
import { fmtCompact } from '../../lib/format';
import TrendChart from '../TrendChart';

const HISTORY_RANGES = Object.freeze([
  { id: '7d', days: 7 },
  { id: '30d', days: 30 },
  { id: '90d', days: 90 }
]);

export default function PoolHistory({ poolId, available = true, t }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('30d');
  const [metric, setMetric] = useState('apy');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setData(null);
    setError(!available);
    setLoading(available);
    if (!available) return () => ctrl.abort();

    getYieldHistory(poolId, { signal: ctrl.signal, range }).then((result) => {
      if (!ctrl.signal.aborted) setData(result);
    }).catch(() => {
      if (!ctrl.signal.aborted) setError(true);
    }).finally(() => {
      if (!ctrl.signal.aborted) setLoading(false);
    });
    return () => ctrl.abort();
  }, [poolId, range, retry, available]);

  const selectedRange = HISTORY_RANGES.find((item) => item.id === range) ?? HISTORY_RANGES[1];
  const points = useMemo(() => {
    const cutoff = Date.now() - selectedRange.days * 86_400_000;
    return (data?.pool === poolId ? data.points : [])
      .filter((row) => row.timestamp >= cutoff && Number.isFinite(row[metric]))
      .map((row) => ({ x: row.timestamp, y: row[metric] }));
  }, [data, poolId, metric, selectedRange.days]);
  const format = (value) => metric === 'apy' ? `${value.toFixed(2)}%` : `$${fmtCompact(value)}`;
  const summary = useMemo(() => {
    if (!points.length) return null;
    const values = points.map((point) => point.y);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      average: values.reduce((sum, value) => sum + value, 0) / values.length
    };
  }, [points]);

  return (
    <section className="card card-soft farm-history" aria-label={t('farm.historyTitle')} data-testid="farm-pool-history">
      <div className="farm-history-head">
        <h3 className="section-label">{t('farm.historyTitle')}</h3>
        <div className="farm-history-controls">
          <div className="farm-history-pills" role="group" aria-label={t('farm.historyMetric')}>
            {['apy', 'tvlUsd'].map((key) => (
              <button
                type="button"
                key={key}
                className={`farm-tab-pill-button${metric === key ? ' active' : ''}`}
                aria-pressed={metric === key}
                onClick={() => setMetric(key)}
              >
                {key === 'apy' ? 'APY' : 'TVL'}
              </button>
            ))}
          </div>
          <div className="farm-history-pills" role="group" aria-label={t('farm.historyRange')}>
            {HISTORY_RANGES.map(({ id }) => (
              <button
                type="button"
                key={id}
                className={`farm-tab-pill-button${range === id ? ' active' : ''}`}
                aria-pressed={range === id}
                onClick={() => setRange(id)}
              >
                {t(`farm.historyRanges.${id}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!available ? (
        <p className="faint" role="status">{t('farm.historyUnavailable')}</p>
      ) : error ? (
        <div className="farm-history-error">
          <p className="faint" role="alert">{t('farm.historyUnavailable')}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetry((value) => value + 1)}>{t('farm.retry')}</button>
        </div>
      ) : loading ? (
        <div className="farm-history-skeleton" role="status" aria-label={t('farm.historyLoading')}>
          <span />
          <span />
          <span />
        </div>
      ) : (
        <>
          <TrendChart
            timeScale
            points={points}
            height={120}
            loading={false}
            up={points.length > 1 && points.at(-1).y >= points[0].y}
            formatValue={format}
            emptyLabel={t('farm.historyEmpty')}
            testId="farm-pool-history-chart"
          />
          {summary && (
            <div className="farm-history-summary" aria-label={t('farm.historySummary')}>
              <div><span>{t('farm.historyMin')}</span><strong className="mono" dir="ltr">{format(summary.min)}</strong></div>
              <div><span>{t('farm.historyMax')}</span><strong className="mono" dir="ltr">{format(summary.max)}</strong></div>
              <div><span>{t('farm.historyAverage')}</span><strong className="mono" dir="ltr">{format(summary.average)}</strong></div>
            </div>
          )}
          {points.length > 0 && (
            <div className="farm-history-endpoints faint" dir="ltr">
              <span>{new Date(points[0].x).toLocaleDateString()} · {format(points[0].y)}</span>
              <span>{new Date(points.at(-1).x).toLocaleDateString()} · {format(points.at(-1).y)}</span>
            </div>
          )}
        </>
      )}
      {data?.freshness === 'STALE' && <p className="notice" role="status">{t('farm.staleNotice')}</p>}
      <p className="faint farm-history-note">{t('farm.historyNote')}</p>
    </section>
  );
}
