/**
 * Activation Dashboard — public blocker display.
 *
 * Shows live blockers from /api/intents/v1/phase-status.
 * Never shows fake green. Never bypasses freeze.
 * Banner is removed ONLY when launchAllowed is true and freeze is false.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function ActivationDashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [freeze, setFreeze] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      try {
        const [psRes, fzRes, evRes] = await Promise.all([
          globalThis.fetch('/api/intents/v1/phase-status'),
          globalThis.fetch('/api/intents/v1/freeze-status'),
          globalThis.fetch('/api/intents/v1/evidence-status')
        ]);
        if (psRes.ok) setData(await psRes.json());
        if (fzRes.ok) setFreeze(await fzRes.json());
        if (evRes.ok) setEvidence(await evRes.json());
      } catch {
        /* Network errors — show stale state */
      } finally {
        setLoading(false);
      }
    }
    fetch();
    const interval = setInterval(fetch, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="activation-dashboard glass" style={{ padding: 'var(--sp-4)' }}>
        <div style={{ color: 'var(--text-2)', fontSize: 'var(--fs-sm)' }}>
          {t('activation.loading', 'Loading activation status...')}
        </div>
      </div>
    );
  }

  const allBlockers = data?.criticalBlockers || [];
  const isFrozen = freeze?.frozen !== false;
  const evidenceStored = evidence?.storedCount || 0;
  const evidenceRequired = evidence?.totalKindsRequired || 21;
  const launchAllowed = freeze?.launchAllowed === true && !isFrozen;

  return (
    <div className="activation-dashboard glass" style={{ padding: 'var(--sp-4)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}>
        <span style={{
          width: 12, height: 12, borderRadius: '50%',
          background: launchAllowed ? 'var(--up)' : 'var(--down)',
          display: 'inline-block'
        }} />
        <strong style={{ fontSize: 'var(--fs-md)' }}>
          {t('activation.title', 'Activation Status')}
        </strong>
      </div>

      {/* Evidence Progress */}
      <div style={{ marginBottom: 'var(--sp-4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginBottom: 'var(--sp-1)' }}>
          <span>{t('activation.evidence', 'Operational Evidence')}</span>
          <span>{evidenceStored}/{evidenceRequired}</span>
        </div>
        <div style={{
          height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden'
        }}>
          <div style={{
            height: '100%',
            width: `${(evidenceStored / evidenceRequired) * 100}%`,
            background: evidenceStored === evidenceRequired ? 'var(--up)' : 'var(--rgb-1)',
            borderRadius: 4,
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>

      {/* Freeze Status */}
      <div style={{
        padding: 'var(--sp-3)', background: isFrozen ? 'rgba(255, 59, 107, 0.1)' : 'rgba(0, 255, 157, 0.1)',
        borderRadius: 'var(--radius-sm)', marginBottom: 'var(--sp-4)',
        border: `1px solid ${isFrozen ? 'rgba(255, 59, 107, 0.2)' : 'rgba(0, 255, 157, 0.2)'}`
      }}>
        <strong style={{ fontSize: 'var(--fs-sm)', color: isFrozen ? 'var(--down)' : 'var(--up)' }}>
          {isFrozen
            ? t('activation.frozen', '⏸ System Frozen')
            : t('activation.unfrozen', '▶ System Active')}
        </strong>
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', margin: 'var(--sp-1) 0 0' }}>
          {freeze?.reason || 'Default frozen state'}
        </p>
      </div>

      {/* Blockers */}
      {allBlockers.length > 0 && (
        <div>
          <h4 style={{ fontSize: 'var(--fs-sm)', margin: '0 0 var(--sp-2)' }}>
            {t('activation.blockers', 'Critical Blockers')} ({allBlockers.length})
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {allBlockers.slice(0, 10).map((b) => (
              <li key={b} style={{
                fontSize: 'var(--fs-xs)', color: 'var(--text-2)',
                padding: 'var(--sp-1) 0', borderBottom: '1px solid var(--line)',
                fontFamily: 'var(--font-mono)'
              }}>
                ✗ {b}
              </li>
            ))}
            {allBlockers.length > 10 && (
              <li style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-3)', padding: 'var(--sp-1) 0' }}>
                +{allBlockers.length - 10} more...
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Missing evidence */}
      {evidence?.missing?.length > 0 && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <h4 style={{ fontSize: 'var(--fs-sm)', margin: '0 0 var(--sp-2)' }}>
            {t('activation.missing', 'Missing Evidence')} ({evidence.missing.length})
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {evidence.missing.map((m) => (
              <li key={m} style={{
                fontSize: 'var(--fs-xs)', color: 'var(--text-3)',
                padding: '2px 0', fontFamily: 'var(--font-mono)'
              }}>
                ○ {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Launch banner — only removed when truly ready */}
      {!launchAllowed && (
        <div style={{
          marginTop: 'var(--sp-4)', padding: 'var(--sp-3)',
          background: 'rgba(255, 179, 0, 0.1)', borderRadius: 'var(--radius-sm)',
          border: '1px solid rgba(255, 179, 0, 0.2)'
        }}>
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--rgb-5)', margin: 0 }}>
            {t('activation.banner.launch', 'Launch blocked.')}<br />
            {t('activation.banner.operational', 'Operational activation unavailable.')}<br />
            {t('activation.banner.execution', 'No financial execution is authorized.')}<br />
            {t('activation.banner.agent', 'No External Agent live execution is claimed.')}
          </p>
        </div>
      )}
    </div>
  );
}

export default ActivationDashboard;
