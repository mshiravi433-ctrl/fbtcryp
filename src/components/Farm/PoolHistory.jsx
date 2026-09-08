import { useEffect, useMemo, useState } from 'react';
import { getYieldHistory } from '../../lib/yields';
import { fmtCompact } from '../../lib/format';
import TrendChart from '../TrendChart';

export default function PoolHistory({ poolId, t }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState('apy');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setData(null);
    setError(false);
    setLoading(true);
    getYieldHistory(poolId, { signal: ctrl.signal }).then((result) => {
      if (!ctrl.signal.aborted) setData(result);
    }).catch(() => {
      if (!ctrl.signal.aborted) setError(true);
    }).finally(() => {
      if (!ctrl.signal.aborted) setLoading(false);
    });
    return () => ctrl.abort();
  }, [poolId, retry]);

  const points = useMemo(() => {
    const cutoff = Date.now() - days * 86_400_000;
    return (data?.pool === poolId ? data.points : [])
      .filter((row) => row.timestamp >= cutoff && Number.isFinite(row[metric]))
      .map((row) => ({ x: row.timestamp, y: row[metric] }));
  }, [data, poolId, days, metric]);
  const format = (n) => metric === 'apy' ? `${n.toFixed(2)}%` : `$${fmtCompact(n)}`;

  return (
    <section className="card card-soft" aria-label={t('farm.historyTitle')} style={{ marginTop: 12 }}>
      <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <h3 className="section-label">{t('farm.historyTitle')}</h3>
        <div className="row" role="group" aria-label={t('farm.historyMetric')}>
          {['apy', 'tvlUsd'].map((key) => <button type="button" key={key} className={`tag ${metric === key ? 'active' : ''}`} aria-pressed={metric === key} onClick={() => setMetric(key)}>{key === 'apy' ? 'APY' : 'TVL'}</button>)}
        </div>
        <div className="row" role="group" aria-label={t('farm.historyRange')}>
          {[30, 90, 365].map((n) => <button type="button" key={n} className={`tag ${days === n ? 'active' : ''}`} aria-pressed={days === n} onClick={() => setDays(n)}>{t('farm.historyDays', { count: n })}</button>)}
        </div>
      </div>
      {error ? <div role="alert"><p className="faint">{t('farm.historyUnavailable')}</p><button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetry((n) => n + 1)}>{t('farm.retry')}</button></div> : <>
        <TrendChart timeScale points={points} height={120} loading={loading} up={points.length > 1 && points.at(-1).y >= points[0].y} formatValue={format} emptyLabel={t('farm.historyEmpty')} testId="farm-pool-history" />
        {!loading && points.length > 0 && <div className="row-between faint" dir="ltr"><span>{new Date(points[0].x).toLocaleDateString()} · {format(points[0].y)}</span><span>{new Date(points.at(-1).x).toLocaleDateString()} · {format(points.at(-1).y)}</span></div>}
      </>}
      {data?.freshness === 'STALE' && <p className="notice" role="status">{t('farm.staleNotice')}</p>}
      <p className="faint">{t('farm.historyNote')}</p>
    </section>
  );
}
