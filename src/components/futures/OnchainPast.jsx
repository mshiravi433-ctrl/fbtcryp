import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import HistoryPanel from '../HistoryPanel';
import { getFuturesCandles } from '../../lib/futuresClient';
import { normaliseCandles } from '../../lib/futures/dydxTokenBrain';

/* A daily history from the selected venue and market, never a spot proxy.
   Exclude today's unfinished candle and refuse stale or failed reads. */
export default function OnchainPast({ provider, market }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ loading: true, bars: [] });
  useEffect(() => {
    let alive = true;
    setState({ loading: true, bars: [] });
    getFuturesCandles({ provider, market, resolution: '1D', limit: 90 }).then((r) => {
      if (!alive) return;
      const today = Math.floor(Date.now() / 86400000) * 86400000;
      const bars = r.ok && r.data?.live !== false && !r.data?.stale
        ? normaliseCandles(r.data?.candles).filter((b) => b.t < today) : [];
      // Do not treat duplicated, gappy or old bars as a continuous daily history.
      const continuous = bars.length >= 10 && bars.at(-1).t >= today - 2 * 86400000 && bars.every((b, i) => !i || b.t - bars[i - 1].t === 86400000);
      setState({ loading: false, bars: continuous ? bars : [] });
    }).catch(() => { if (alive) setState({ loading: false, bars: [] }); });
    return () => { alive = false; };
  }, [provider, market]);
  if (state.loading) return <p className="oc-panel-note">{t('common.loading')}</p>;
  if (state.bars.length < 10) return <p className="notice">{t('futures.onchain.pastUnavailable')}</p>;
  return <div data-testid="onchain-past"><p className="oc-panel-note">{t('futures.onchain.pastNote', { count: state.bars.length })}</p><HistoryPanel series={state.bars.map((b) => b.c)} days={state.bars.length} collapsible={false} emptyMessage={t('futures.onchain.pastUnavailable')} /></div>;
}
