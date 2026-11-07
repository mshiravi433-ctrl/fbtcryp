/**
 * FBT NEUROMORPHIC 2050 — EMBEDDED CHAT ROOM STRIP
 * ===========================================================================
 * Feeds the live candles or market pulse ALREADY fetched by `ChatMarketRoom` /
 * `ChatTokenRoom` into the user's on-device WebGPU/CPU Neuromorphic Cortex —
 * zero extra HTTP market requests — and renders a live 2050 synaptic strip.
 */

import { memo, useEffect, useRef } from 'react';
import { useNeuromorphicCortex } from '../../lib/neuromorphic/useNeuromorphicCortex.js';
import './neuromorphic-cortex.css';

const REGIME_SHORT = Object.freeze({
  trendUp: { fa: 'روند صعودی', en: 'Trend Up' },
  trendDown: { fa: 'روند نزولی', en: 'Trend Down' },
  meanRevert: { fa: 'تعادل / نوسانی', en: 'Mean Revert' },
  shock: { fa: 'شوک نوسان', en: 'Shock' }
});

const NeuromorphicRoomStrip = memo(function NeuromorphicRoomStrip({
  candles = null,
  markets = null,
  pulse = null,
  symbol = null,
  locale = 'fa'
}) {
  const isFa = !String(locale || 'fa').toLowerCase().startsWith('en');
  const nm = useNeuromorphicCortex({ autoSync: false });
  const lastFeedSig = useRef('');

  useEffect(() => {
    if (nm.paused) return;
    if (Array.isArray(candles) && candles.length >= 3) {
      const last = candles[candles.length - 1];
      const sig = `c:${symbol || ''}:${candles.length}:${last?.close ?? last?.c ?? ''}`;
      if (sig !== lastFeedSig.current) {
        lastFeedSig.current = sig;
        void nm.tickWithCandles(candles, { symbol });
      }
    } else if ((Array.isArray(markets) && markets.length >= 3) || pulse?.breadth?.counted >= 3) {
      const sig = `m:${markets?.length || 0}:${pulse?.breadth?.counted || 0}:${pulse?.breadth?.advancers || 0}`;
      if (sig !== lastFeedSig.current) {
        lastFeedSig.current = sig;
        void nm.tickWithMarketPulse({ markets: markets || [], pulse });
      }
    }
  }, [candles, markets, pulse, symbol, nm.paused, nm.tickWithCandles, nm.tickWithMarketPulse]);

  const r = nm.readout;
  if (!r) return null;

  const reg = isFa
    ? REGIME_SHORT[r.dominantRegime]?.fa || r.dominantRegime
    : REGIME_SHORT[r.dominantRegime]?.en || r.dominantRegime;

  const backendTag = nm.backend === 'webgpu' ? 'WebGPU' : 'CPU';
  const gen = nm.globalGeneration ?? nm.localGeneration ?? 0;
  const driveStr = `${r.directionalDrive >= 0 ? '+' : ''}${r.directionalDrive.toFixed(2)}`;

  return (
    <div className="nmc-strip" data-testid="neuromorphic-room-strip" dir={isFa ? 'rtl' : 'ltr'}>
      <div className="nmc-strip-metrics">
        <span className="nmc-strip-kv">
          ⚡ <strong>{isFa ? 'کورتکس ۲۰۵۰ دستگاه شما' : 'On-Device Cortex 2050'}</strong>
          <small>({backendTag} · Gen #{gen})</small>
        </span>
        <span className="nmc-strip-kv">
          {isFa ? 'رژیم مایع:' : 'Regime:'} <b>{reg}</b>
        </span>
        <span className="nmc-strip-kv">
          {isFa ? 'کشش سیناپسی:' : 'Drive:'} <b>{driveStr}</b>
        </span>
        <span className="nmc-strip-kv">
          {isFa ? 'شلیک:' : 'Spikes:'} <b>{r.spikes.firingRateHz} Hz</b>
        </span>
        <span className="nmc-strip-kv">
          {isFa ? 'نورون:' : 'Neurons:'} <b>{r.topology.reservoirNeurons}</b>
        </span>
      </div>
      <small>{r.latencyMs} ms</small>
    </div>
  );
});

export default NeuromorphicRoomStrip;
