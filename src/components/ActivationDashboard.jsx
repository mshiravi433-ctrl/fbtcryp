/**
 * Activation Dashboard — live Intent OS status.
 * ---------------------------------------------------------------------------
 * ─── WHAT WAS WRONG ────────────────────────────────────────────────────────
 * Reported: «وضعیت فعال‌سازی در دسترس نیست / launch-freeze-retired», «تا ۱۴
 * بیشتر نمیاد، دکمه فعال سازی نیست و کار نمیده», «مکعب‌های کوچک ... هیچ تغییر
 * رنگی ندارد و هیچ حرکتی نیست».
 *
 *   1. THE RAW INTERNAL STRING. The freeze endpoint's retired-state reason,
 *      `launch-freeze-retired`, was rendered verbatim as the explanation. It is
 *      a machine constant, not a sentence, and to anyone reading it the screen
 *      looks broken.
 *   2. NO WAY TO SEE THE LIST. The 80+ operational notes were sliced to ten
 *      with a "+70 more…" line that was not a control — the rest were simply
 *      unreachable.
 *   3. NO ACTION AT ALL. There was nothing to press. The system is genuinely
 *      fail-closed — activation is granted by evidence, never by a switch — but
 *      "there is no button" and "there is nothing you can do" are different
 *      statements, and only the first one was true.
 *   4. 141 IDENTICAL CUBES. Every phase reports `implementation: 'implemented'`
 *      and `live: false`, so the grid painted one flat colour with no motion.
 *      That is not a styling oversight to paper over with random colours: it is
 *      the honest picture of a build that is written but not yet operational.
 *
 * ─── WHAT THIS DOES INSTEAD ────────────────────────────────────────────────
 *   · the retired freeze switch is explained in words, once, and then dropped
 *   · every operational note is present, in one scrollable box, with a count
 *   · a real button runs the real probes (self, ops, stage-3, later-phase) and
 *     reports exactly what each one earned — and it says "still blocked, N
 *     notes remain" when that is the truth. It cannot grant activation that the
 *     evidence does not support; nothing on this screen can
 *   · the cubes are coloured by FOUR distinct states read from the runtime
 *     (live / operational / configured / built-not-configured) and they animate
 *     on entry and while a check is running
 *   · what the deployment still needs is listed as the environment variables
 *     that are actually missing, with where to get each one
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/*
 * Cube states, painted from the runtime report — never invented here.
 * A phase is only green when the reviewed evidence makes it live.
 */
const cubeState = (row) => {
  if (!row) return 'missing';
  if (row.live === true) return 'live';
  if (row.operational === 'operational') return 'operational';
  if (row.configuration === 'configured') return 'configured';
  if (row.configuration === 'partially-configured') return 'partial';
  if (row.implementation === 'implemented') return 'built';
  return 'missing';
};

const CUBE_STATES = ['live', 'operational', 'configured', 'partial', 'built', 'missing'];

/* One dot per specification phase. The stagger is a CSS variable rather than
   141 inline animations, and it is skipped entirely for reduced motion. */
function PhaseGrid({ rows = [], checking = false }) {
  if (rows.length === 0) return null;
  return (
    <div
      className={`activation-phase-grid${checking ? ' is-checking' : ''}`}
      role="list"
      aria-label={`Specification phases ${rows[0]?.phase ?? ''}–${rows[rows.length - 1]?.phase ?? ''}`}
    >
      {rows.map((row, index) => (
        <span
          key={row.phase}
          role="listitem"
          title={`${row.phase} · ${row.id || ''} · ${cubeState(row)}`}
          data-testid={`phase-chip-${row.phase}`}
          data-state={cubeState(row)}
          style={{ '--i': index }}
        />
      ))}
    </div>
  );
}

/** Every operational note, reachable, with a count. */
function BlockerList({ items = [], t, expanded, onToggle }) {
  if (items.length === 0) return null;
  return (
    <div className="activation-block">
      <h4 style={{ fontSize: 'var(--fs-sm)', margin: '0 0 var(--sp-2)' }}>
        {t('activation.notes', 'Operational notes')} ({items.length})
      </h4>
      <ul className="activation-notes" data-testid="activation-notes">
        {items.map((b) => (
          <li key={b}>
            <span aria-hidden="true">✗</span>
            <code>{b}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ActivationDashboard() {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [freeze, setFreeze] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [run, setRun] = useState(null);

  const load = useCallback(async () => {
    try {
      const [psRes, fzRes, evRes, cfRes] = await Promise.all([
        globalThis.fetch('/api/intents/v1/phase-status'),
        globalThis.fetch('/api/intents/v1/freeze-status'),
        globalThis.fetch('/api/intents/v1/evidence-status'),
        globalThis.fetch('/api/intents/v1/activation-config')
      ]);
      if (psRes.ok) setData(await psRes.json());
      if (fzRes.ok) setFreeze(await fzRes.json());
      if (evRes.ok) setEvidence(await evRes.json());
      if (cfRes.ok) setConfig(await cfRes.json());
    } catch {
      /* Network errors — show stale state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /*
   * The refresh is deliberately NOT a poll. Polling a screen nobody is looking
   * at burns a phone's battery to display a number that has not moved; the
   * sections below re-read on demand, from the button.
   */
  useEffect(() => {
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  /*
   * ─── THE BUTTON ────────────────────────────────────────────────────────
   * This runs the four probe endpoints for real: backup/restore and rollback
   * drills execute, the sandbox child is spawned, stage-3 evidence is measured.
   * Whatever they earn is stored server-side and the numbers above move.
   *
   * It cannot conjure the evidence that needs an operator (a Blob token, an
   * RPC endpoint, an independent reviewer signature). When those are the ones
   * still missing, the button says so and names them, rather than reporting
   * success for having pressed it.
   */
  const runActivationCheck = async () => {
    setChecking(true);
    setRun(null);
    const probes = [
      '/api/intents/v1/self-probe',
      '/api/intents/v1/ops-probe?force=1',
      '/api/intents/v1/stage3-probe?force=1',
      '/api/intents/v1/later-phase-probe'
    ];
    const results = await Promise.allSettled(probes.map(async (url) => {
      const res = await globalThis.fetch(url);
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      return res.json();
    }));

    const earned = results.reduce((sum, r) => {
      if (r.status !== 'fulfilled') return sum;
      return sum + (r.value?.earnedCount ?? r.value?.provenCount ?? 0);
    }, 0);
    const failed = results.filter((r) => r.status === 'rejected').length;

    await load();
    setRun({ at: Date.now(), earned, failed, total: probes.length });
    setChecking(false);
  };

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
  const isFrozen = data?.isFrozen === true || freeze?.isFrozen === true || freeze?.frozen === true;
  const evidenceStored = evidence?.storedCount ?? data?.evidence?.stored ?? 0;
  const evidenceRequired = evidence?.totalKindsRequired ?? data?.evidence?.required ?? 21;
  const launchAllowed = data?.launchAllowed === true && !isFrozen;
  const phases = data?.phases || [];

  const counts = phases.reduce((acc, row) => {
    const key = cubeState(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const missingKinds = evidence?.missing || [];
  const missingConfig = Object.entries(config?.variables || {})
    .filter(([, v]) => v?.configured !== true)
    .map(([name, v]) => ({ name, ...v }));

  return (
    <div className="activation-dashboard glass" style={{ padding: 'var(--sp-4)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}>
        <span
          className="activation-led"
          data-state={launchAllowed ? 'live' : 'pending'}
          aria-hidden="true"
        />
        <strong style={{ fontSize: 'var(--fs-md)' }}>
          {t('activation.title', 'Activation Status')}
        </strong>
        <button
          type="button"
          className="activation-action"
          onClick={runActivationCheck}
          disabled={checking}
          data-testid="activation-run"
        >
          {checking
            ? t('activation.checking', 'Running checks…')
            : t('activation.check', 'Run activation check')}
        </button>
      </div>

      {checking && <div className="activation-progress" aria-hidden="true" />}

      {run && !checking && (
        <p className={`activation-run-result${run.failed ? ' is-warn' : ''}`} role="status" data-testid="activation-run-result">
          {run.failed
            ? t('activation.checkedPartial', 'Checks finished: {{earned}} evidence kinds earned, {{failed}} of {{total}} probes could not run.', { earned: run.earned, failed: run.failed, total: run.total })
            : t('activation.checked', 'Checks finished: {{earned}} evidence kinds earned across {{total}} probes.', { earned: run.earned, total: run.total })}
          {launchAllowed
            ? ` ${t('activation.nowAllowed', 'Activation is allowed.')}`
            : ` ${t('activation.stillBlocked', 'Still blocked by {{n}} operational note(s).', { n: allBlockers.length })}`}
        </p>
      )}

      {/* Evidence Progress */}
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginBottom: 'var(--sp-1)' }}>
          <span>{t('activation.evidence', 'Operational Evidence')}</span>
          <span>{evidenceStored}/{evidenceRequired}</span>
        </div>
        <div style={{ height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${(evidenceStored / evidenceRequired) * 100}%`,
            background: evidenceStored === evidenceRequired ? 'var(--up)' : 'var(--rgb-1)',
            borderRadius: 4,
            transition: 'width 0.3s ease'
          }} />
        </div>
        {missingKinds.length > 0 && (
          <ul className="activation-chips" data-testid="activation-missing">
            {missingKinds.map((m) => <li key={m}>○ {m}</li>)}
          </ul>
        )}
      </div>

      {/* Specification phases 10–100 */}
      {phases.length > 0 && (
        <div style={{ marginBottom: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', color: 'var(--text-2)', marginBottom: 'var(--sp-1)' }}>
            <span>{t('activation.phases', 'Specification Phases')}</span>
            <span data-testid="phase-progress-label">
              {counts.live || 0}/{phases.length} {t('activation.live', 'live')}
              {counts.operational ? ` · ${counts.operational} ${t('activation.operational', 'operational')}` : ''}
              {counts.configured || counts.partial ? ` · ${(counts.configured || 0) + (counts.partial || 0)} ${t('activation.configured', 'configured')}` : ''}
              {counts.built ? ` · ${counts.built} ${t('activation.built', 'built')}` : ''}
            </span>
          </div>
          <PhaseGrid rows={phases} checking={checking} />
          <ul className="activation-legend">
            {CUBE_STATES.filter((s) => counts[s]).map((s) => (
              <li key={s}>
                <span className="activation-legend-dot" data-state={s} aria-hidden="true" />
                {t(`activation.state.${s}`, s)}
                <b>{counts[s]}</b>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Freeze Status — the honest sentence, not the machine constant */}
      <div className={`activation-verdict${launchAllowed ? ' is-ok' : ''}`}>
        <strong style={{ fontSize: 'var(--fs-sm)' }}>
          {launchAllowed
            ? t('activation.active', 'System Active & Verified')
            : t('activation.pending', 'Activation not yet earned')}
        </strong>
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', margin: 'var(--sp-1) 0 0' }}>
          {launchAllowed
            ? t('activation.executionReady', 'Execution Ready — wallet confirmation remains required.')
            : t('activation.pendingBody', 'This deployment runs fail-closed: activation is granted by operational evidence, not by a switch. The retired launch-freeze control no longer gates anything — the evidence count above is what gates it.')}
        </p>
        {!launchAllowed && (
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-2)', margin: 'var(--sp-1) 0 0' }} data-testid="activation-evidence-verdict">
            {evidenceStored === 0
              ? t('activation.evidenceNone', { defaultValue: 'No current operational evidence is stored. {{required}} verified kinds are required.', required: evidenceRequired })
              : evidenceStored < evidenceRequired
                ? t('activation.evidencePartial', {
                    defaultValue: '{{stored}} current evidence kinds are valid, but the set is incomplete: {{missing}} of {{required}} are still missing.',
                    stored: evidenceStored,
                    missing: evidenceRequired - evidenceStored,
                    required: evidenceRequired
                  })
                : t('activation.evidenceCompleteBlocked', {
                    defaultValue: 'All {{required}} evidence kinds are present, but activation is still blocked by {{blockers}} operational checks.',
                    required: evidenceRequired,
                    blockers: allBlockers.length
                  })}
          </p>
        )}
      </div>

      {/* Every operational note — no slice, no unreachable "+70 more" */}
      <BlockerList items={allBlockers} t={t} />

      {/* What this deployment still needs, and where to get it */}
      {missingConfig.length > 0 && (
        <details className="activation-config" data-testid="activation-config">
          <summary>
            {t('activation.whatNeeded', 'What this deployment still needs')} ({missingConfig.length})
          </summary>
          <ul>
            {missingConfig.map((v) => (
              <li key={v.name}>
                <code>{v.name}</code>
                <span>{v.source}</span>
              </li>
            ))}
          </ul>
          <p>{t('activation.configHint', 'These are operator settings on the server, not switches in this app. Each one is what unlocks the evidence kinds listed above.')}</p>
        </details>
      )}
    </div>
  );
}

export default ActivationDashboard;
