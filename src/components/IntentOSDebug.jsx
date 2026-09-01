/**
 * FBT INTENT OS — AI Dashboard Internal (Debug View)
 * Spec §35: For Developer/Admin only, not shown to user
 */

import { useEffect, useState } from 'react';
import { getDebugHistory } from '../lib/intent-ai/os/debugDashboard.js';
import { getLogs, getStats } from '../lib/intent-ai/os/observability.js';
import { getAllMemory } from '../lib/intent-ai/os/memoryEngine.js';
import { getActionMemories } from '../lib/intent-ai/os/actionMemory.js';
import { getEventHistory } from '../lib/intent-ai/os/eventBus.js';
import { runAcceptanceTests } from '../lib/intent-ai/os/intentUnderstanding.js';

export default function IntentOSDebug() {
  const [debug, setDebug] = useState([]);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [memory, setMemory] = useState(null);
  const [actions, setActions] = useState([]);
  const [events, setEvents] = useState([]);
  const [tests, setTests] = useState([]);

  useEffect(() => {
    setDebug(getDebugHistory({ limit: 10 }));
    setLogs(getLogs({ limit: 20 }));
    setStats(getStats());
    try { setMemory(getAllMemory()); } catch {}
    try { setActions(getActionMemories({ limit: 10 })); } catch {}
    try { setEvents(getEventHistory({ limit: 20 })); } catch {}
    try { setTests(runAcceptanceTests()); } catch {}
  }, []);

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', fontSize: '0.8rem', background: '#0a0a0f', color: '#e0e0e0', minHeight: '100vh' }}>
      <h1 style={{ fontSize: '1.2rem', marginBottom: '16px' }}>Intent OS — Debug Dashboard (Internal)</h1>
      
      <section style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
        <h2>Acceptance Tests (Spec §40)</h2>
        <div>Pass: {tests.filter(t => t.pass).length} / {tests.length}</div>
        {tests.map((t, i) => (
          <div key={i} style={{ color: t.pass ? '#4ade80' : '#f87171', marginTop: '4px' }}>
            {t.pass ? '✓' : '✗'} {t.input} → {t.got} (expected {t.expected}) {t.confidence}
          </div>
        ))}
      </section>

      <section style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
        <h2>Observability Stats (Spec §34)</h2>
        <pre>{JSON.stringify(stats, null, 2)}</pre>
      </section>

      <section style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
        <h2>Last Debug Entries (Spec §35)</h2>
        {debug.map((d, i) => (
          <div key={i} style={{ marginBottom: '12px', padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '4px' }}>
            <div><strong>Intent:</strong> {d.intent?.type} (conf: {d.intent?.confidence})</div>
            <div><strong>Agents:</strong> {d.selectedAgents?.join(', ')}</div>
            <div><strong>Tools:</strong> {d.selectedTools?.join(', ')}</div>
            <div><strong>Latency:</strong> {d.latency}ms</div>
            <div><strong>Context:</strong> Page {d.context?.currentPage}, Wallet {d.context?.hasWallet ? 'yes' : 'no'}</div>
            <div><strong>Memory Used:</strong> {d.memoryUsed?.length || 0}</div>
          </div>
        ))}
      </section>

      <section style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
        <h2>Action Memory (Spec §13)</h2>
        {actions.map((a, i) => (
          <div key={i} style={{ marginBottom: '8px' }}>
            {a.timestamp} — {a.intent} — {a.status} — {a.tools?.join(', ')} — {a.route}
          </div>
        ))}
      </section>

      <section style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
        <h2>Event Bus History (Spec §21)</h2>
        {events.map((e, i) => (
          <div key={i} style={{ marginBottom: '4px' }}>
            {e.timestamp} — {e.type} — {e.source}
          </div>
        ))}
      </section>

      <section style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
        <h2>Memory (Spec §10-§12)</h2>
        <div>Working: {memory?.working?.length || 0}</div>
        <div>Session: {memory?.session?.length || 0}</div>
        <div>Long-term: {memory?.longTerm?.length || 0}</div>
        <div>Actions: {memory?.actions?.length || 0}</div>
        <pre style={{ maxHeight: '200px', overflow: 'auto' }}>{JSON.stringify(memory?.longTerm?.slice(0, 3), null, 2)}</pre>
      </section>

      <section style={{ marginBottom: '20px', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
        <h2>Task Logs (Spec §34)</h2>
        {logs.map((l, i) => (
          <div key={i} style={{ marginBottom: '4px' }}>
            {l.taskId} — {l.intent} — {l.status} — {l.latency}ms — {l.tools?.join(', ')}
          </div>
        ))}
      </section>
    </div>
  );
}
