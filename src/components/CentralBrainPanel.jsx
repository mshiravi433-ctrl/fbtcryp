/**
 * FBT CENTRAL INTELLIGENCE OS — Brain Status Panel.
 * ---------------------------------------------------------------------------
 * A live window into the central brain: capability map (§8), module coverage
 * (§10), event stream (§15) and the unified state heartbeat (§4). Read-only
 * by design — this surface observes the brain, it does not drive it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  centralCapabilities,
  centralEvents,
  centralHealth,
  centralMemory
} from '../lib/centralClient.js';

const STATUS_COLOR = {
  AVAILABLE: '#34d399',
  DEGRADED: '#fbbf24',
  READ_ONLY: '#93c5fd',
  UNAVAILABLE: '#f87171'
};

function Pill({ status }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 999,
      fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.02em',
      color: '#0a0a0f', background: STATUS_COLOR[status] || '#a1a1aa'
    }}>
      {status}
    </span>
  );
}

export default function CentralBrainPanel({ refreshMs = 15000 }) {
  const [health, setHealth] = useState(null);
  const [caps, setCaps] = useState({});
  const [events, setEvents] = useState([]);
  const [memory, setMemory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, c, e, mem] = await Promise.all([
        centralHealth(),
        centralCapabilities(),
        centralEvents({ limit: 12 }),
        centralMemory()
      ]);
      if (h?.ok) setHealth(h);
      if (c?.ok && c.capabilities) setCaps(c.capabilities);
      if (e?.ok && Array.isArray(e.events)) setEvents(e.events);
      if (mem?.ok && mem.memory) setMemory(mem.memory);
      if (!h?.ok && !c?.ok) setError(h?.error || c?.error || 'CENTRAL_UNAVAILABLE');
    } catch (err) {
      setError(String(err?.message || err || 'CENTRAL_UNAVAILABLE'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);

  const counts = useMemo(() => {
    const acc = { AVAILABLE: 0, DEGRADED: 0, READ_ONLY: 0, UNAVAILABLE: 0 };
    for (const v of Object.values(caps)) acc[v?.status] = (acc[v?.status] || 0) + 1;
    return acc;
  }, [caps]);

  const modules = useMemo(() => Object.entries(caps).sort((a, b) => a[0].localeCompare(b[0])), [caps]);

  return (
    <div data-testid="central-brain-panel" style={{ padding: '14px', fontFamily: 'monospace', fontSize: '0.78rem', background: '#0a0a0f', color: '#e0e0e0', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div>
          <strong style={{ fontSize: '0.9rem' }}>FBT Central Intelligence OS</strong>
          {health?.version && <span style={{ opacity: 0.55, marginLeft: 8 }}>{health.version}</span>}
        </div>
        <button onClick={load} disabled={loading} style={{ fontSize: '0.7rem', padding: '3px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#e0e0e0', cursor: 'pointer' }}>
          {loading ? '…' : 'refresh'}
        </button>
      </div>

      {error && (
        <div style={{ color: '#f87171', marginBottom: 10 }}>central brain unavailable: {error}</div>
      )}

      {/* capability summary */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.entries(counts).filter(([, n]) => n > 0).map(([status, n]) => (
          <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Pill status={status} /> <span style={{ opacity: 0.8 }}>{n}</span>
          </span>
        ))}
        {health?.moduleCoverage && (
          <span style={{ opacity: 0.6, marginLeft: 'auto' }}>
            modules {health.moduleCoverage.registered}/{health.moduleCoverage.required}
          </span>
        )}
      </div>

      {/* module grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6, marginBottom: 14 }}>
        {modules.map(([id, v]) => (
          <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '5px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 6 }} title={v?.reason || ''}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{id}</span>
            <Pill status={v?.status} />
          </div>
        ))}
      </div>

      {/* memory / last intent */}
      {memory && (
        <div style={{ marginBottom: 14, padding: '8px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
          <div style={{ opacity: 0.7, marginBottom: 4 }}>conversation memory</div>
          <div>lastIntent: {memory.lastIntent?.type || '—'}{memory.lastEntities?.asset ? ` · asset ${memory.lastEntities.asset}` : ''}</div>
          <div>lastAction: {memory.lastAction?.module ? `${memory.lastAction.module}` : '—'}</div>
          <div>pendingConfirmation: {memory.pendingConfirmation ? 'yes' : 'no'}</div>
        </div>
      )}

      {/* event stream */}
      <div>
        <div style={{ opacity: 0.7, marginBottom: 6 }}>recent events</div>
        {events.length === 0 && <div style={{ opacity: 0.5 }}>no events yet</div>}
        {events.map((e) => (
          <div key={e.eventId} style={{ display: 'flex', gap: 8, padding: '2px 0', borderBottom: '1px dashed rgba(255,255,255,0.06)' }}>
            <span style={{ opacity: 0.45, minWidth: 70 }}>{new Date(e.at).toLocaleTimeString()}</span>
            <span style={{ color: '#93c5fd' }}>{e.type}</span>
            <span style={{ opacity: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.source}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
