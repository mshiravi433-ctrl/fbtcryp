import { useEffect } from 'react';
import { getNotifySettings, registerPushAnywhere, showLocalNotification } from '../lib/notify';
import { processFarmRateAlerts } from '../lib/farmRateAlerts';

export function useFarmRateAlerts({ data, watchlist, alerts, t } = {}) {
  useEffect(() => {
    const hasEnabled = alerts && Object.values(alerts).some((a) => a?.enabled && a?.threshold != null);
    if (hasEnabled) {
      // Ensure push subscription exists so alerts arrive in background via FCM
      // Fire-and-forget, never blocks alert delivery
      try { registerPushAnywhere(); } catch { /* best effort */ }
    }
  }, [alerts]);

  useEffect(() => {
    if (!data || data.freshness === 'STALE') return;
    const pools = [...(data.pools ?? []), ...(data.venues ?? [])];
    const events = processFarmRateAlerts({
      pools,
      watchlist,
      alerts,
      freshness: data.freshness,
      notifyEnabled: Boolean(getNotifySettings()?.priceAlerts)
    });
    for (const event of events) {
      showLocalNotification(t('farm.alerts.titleForPool', { symbol: event.symbol }), {
        body: t('farm.alerts.body', {
          symbol: event.symbol,
          apy: event.apy.toFixed(2),
          direction: t(`farm.alerts.${event.direction}`),
          threshold: event.threshold
        }),
        tag: `fbt-farm-rate-${event.id}`,
        data: { url: `/farm?tab=watchlist&pool=${encodeURIComponent(event.id)}` }
      });
    }
  }, [data?.at, data?.freshness, watchlist, alerts, t]);
}
