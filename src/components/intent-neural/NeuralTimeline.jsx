/**
 * NEURAL INTENT TIMELINE — the execution journey of one Intent, rendered only
 * from facts the parent actually observed.
 * ---------------------------------------------------------------------------
 * The nine canonical stages (received → context → orchestration → analysis →
 * simulation → approval → execution → verification → terminal) are mapped from
 * the live workflow state. A stage renders ONLY when it exists in this turn:
 * a pure Q&A answer never shows simulation/approval/execution, and nothing is
 * ever drawn "completed" unless the underlying state really completed.
 *
 * Timestamps are stamped locally the moment a stage is OBSERVED in a new
 * status — a real UI observation, never a backfilled fiction. Evidence lines
 * come from the parent and render inside expandable <details>.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';

const STAGE_COPY = Object.freeze({
  received: { fa: 'اینتنت دریافت شد', en: 'Intent received' },
  context: { fa: 'جمع‌آوری زمینه و داده', en: 'Context & data collection' },
  orchestration: { fa: 'هماهنگی ایجنت‌ها', en: 'Agent orchestration' },
  analysis: { fa: 'تحلیل و برنامه‌ریزی', en: 'Analysis & planning' },
  simulation: { fa: 'شبیه‌سازی و اعتبارسنجی ریسک', en: 'Simulation & risk validation' },
  approval: { fa: 'در انتظار تأیید شما', en: 'Waiting for your approval' },
  execution: { fa: 'اجرا', en: 'Execution' },
  verification: { fa: 'راستی‌آزمایی نتیجه', en: 'Result verification' },
  terminal: { fa: 'تکمیل شد', en: 'Completed' }
});

function stepStatus(activitySteps, ids) {
  const list = Array.isArray(activitySteps) ? activitySteps : [];
  const hits = list.filter((s) => ids.includes(s?.id));
  if (!hits.length) return null;
  if (hits.some((s) => s.status === 'active' || s.status === 'running')) return 'active';
  if (hits.every((s) => s.status === 'completed' || s.status === 'done')) return 'done';
  if (hits.some((s) => s.status === 'completed' || s.status === 'done')) return 'active';
  if (hits.some((s) => s.status === 'error' || s.status === 'failed')) return 'error';
  return 'pending';
}

function buildStages(facts) {
  if (!facts || facts.hasUserTurn !== true) return [];
  const steps = facts.activitySteps || [];
  const ctx = stepStatus(steps, ['wallet', 'market']);
  const orch = stepStatus(steps, ['agents']);
  const analysis = stepStatus(steps, ['analyze', 'response', 'understand']);
  const stages = [{ id: 'received', status: 'done' }];
  if (ctx) stages.push({ id: 'context', status: ctx });
  if (orch) stages.push({ id: 'orchestration', status: orch });
  if (analysis) stages.push({ id: 'analysis', status: analysis });
  if (facts.hasSimulation) {
    stages.push({
      id: 'simulation',
      status: facts.simulationStatus === 'failed' ? 'error' : facts.simulationStatus === 'passed' ? 'done' : 'active'
    });
  }
  if (facts.approval && facts.approval !== 'none') {
    stages.push({
      id: 'approval',
      status: facts.approval === 'waiting' ? 'active' : facts.approval === 'rejected' ? 'error' : 'done'
    });
  }
  if (facts.execution && facts.execution !== 'none') {
    stages.push({
      id: 'execution',
      status: facts.execution === 'running' ? 'active' : facts.execution === 'failed' ? 'error' : 'done'
    });
  }
  if (facts.verification && facts.verification !== 'none') {
    stages.push({
      id: 'verification',
      status: facts.verification === 'pending' ? 'active' : facts.verification === 'failed' ? 'error' : 'done'
    });
  }
  if (facts.terminal) {
    stages.push({ id: 'terminal', status: facts.terminal.status === 'failed' ? 'error' : 'done', label: facts.terminal.label });
  }
  return stages;
}

/**
 * facts: {
 *   hasUserTurn, activitySteps, hasSimulation, simulationStatus,
 *   approval: 'none'|'waiting'|'confirmed'|'rejected',
 *   execution: 'none'|'running'|'done'|'failed',
 *   verification: 'none'|'pending'|'verified'|'failed',
 *   terminal: null | { status: 'completed'|'failed', label },
 *   evidence: { [stageId]: string[] },
 *   error: string|null
 * }
 */
const NeuralTimeline = memo(function NeuralTimeline({ locale = 'fa', facts = null }) {
  const fa = String(locale || 'fa').startsWith('fa');
  const stages = useMemo(() => buildStages(facts), [
    facts?.hasUserTurn,
    facts?.activitySteps,
    facts?.hasSimulation,
    facts?.simulationStatus,
    facts?.approval,
    facts?.execution,
    facts?.verification,
    facts?.terminal,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    facts?.error
  ]);
  const sig = stages.map((s) => `${s.id}:${s.status}`).join('|');
  const [stamps, setStamps] = useState({});
  const seenRef = useRef('');

  // Stamp the observed time of each status transition (real, local, honest).
  useEffect(() => {
    if (!sig || seenRef.current === sig) return;
    seenRef.current = sig;
    const now = Date.now();
    setStamps((prev) => {
      const next = { ...prev };
      for (const key of sig.split('|')) {
        if (key && !next[key]) next[key] = now;
      }
      return next;
    });
  }, [sig]);

  if (!stages.length) return null;

  const fmtTime = (ts) => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString(fa ? 'fa-IR' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch { return ''; }
  };

  const evidence = facts?.evidence || {};
  const activeIdx = stages.findIndex((s) => s.status === 'active');

  return (
    <ol className="fbt-timeline" data-testid="neural-intent-timeline" aria-label={fa ? 'مسیر اجرای اینتنت' : 'Intent execution timeline'}>
      {stages.map((s, i) => {
        const copy = STAGE_COPY[s.id];
        const lines = Array.isArray(evidence[s.id]) ? evidence[s.id] : [];
        const ts = stamps[`${s.id}:${s.status}`];
        return (
          <li
            key={s.id}
            className="fbt-timeline-step"
            data-status={s.status}
            data-active={i === activeIdx ? 'true' : 'false'}
          >
            <span className="fbt-timeline-rail" aria-hidden="true">
              <span className="fbt-timeline-dot" />
            </span>
            <div className="fbt-timeline-body">
              <div className="fbt-timeline-head">
                <span className="fbt-timeline-label">
                  {s.id === 'terminal' && s.label ? s.label : (fa ? copy.fa : copy.en)}
                </span>
                {ts ? <time className="fbt-timeline-time">{fmtTime(ts)}</time> : null}
              </div>
              {s.status === 'active' ? <span className="fbt-timeline-bar" aria-hidden="true"><i /></span> : null}
              {lines.length ? (
                <details className="fbt-timeline-evidence">
                  <summary>{fa ? 'شواهد' : 'Evidence'} · {lines.length}</summary>
                  <ul>
                    {lines.slice(0, 6).map((line, k) => <li key={k}>{line}</li>)}
                  </ul>
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
      {facts?.error ? (
        <li className="fbt-timeline-step" data-status="error">
          <span className="fbt-timeline-rail" aria-hidden="true"><span className="fbt-timeline-dot" /></span>
          <div className="fbt-timeline-body">
            <div className="fbt-timeline-head">
              <span className="fbt-timeline-label">{facts.error}</span>
            </div>
          </div>
        </li>
      ) : null}
    </ol>
  );
});

export default NeuralTimeline;
