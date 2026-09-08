/**
 * FBT FINANCIAL INTELLIGENCE OS — Intent OS panel (batch 7).
 * ---------------------------------------------------------------------------
 * The four controls the audit requires, each one wired to a real server
 * answer — nothing on this card is decoration:
 *
 *   WHY?            the decision's own reason[] plus its six confidence
 *                   dimensions (intent/data/research/strategy/risk/execution)
 *                   — the same numbers the server scored, not a summary of
 *                   a summary.
 *   SHOW EVIDENCE   the decision's linked evidence bundle: the rows, their
 *                   confidence, their freshness, and the stale/untrusted
 *                   counts that keep "evidence" from becoming a word.
 *   ALTERNATIVES    the ranked candidates that lost, with their scores —
 *                   including the ones the risk veto removed, and why.
 *   STOP            the policy-level emergency stop, with a confirmation
 *                   step, aimed at the policy that authorised the run.
 *
 * Honest by construction: an unread financial state renders as a gap
 * (UNAVAILABLE + its reason), a failed call renders its code, and the card
 * never shows a number it did not receive.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import fi from '../lib/financialIntelligence.js';

const VERDICT_COLOR = {
  APPROVE: '#34d399',
  REVISE: '#fbbf24',
  REJECT: '#f87171',
  ABSTAIN: '#a1a1aa'
};

const pct = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${Math.round(Number(v) * 100)}%`);
const usd = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

function Pill({ value, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px', borderRadius: 999,
      fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.02em',
      color: '#0a0a0f', background: color || '#a1a1aa'
    }}>
      {value}
    </span>
  );
}

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 }}>
      <button
        data-testid={`fi-toggle-${title.toLowerCase().replace(/\s+/g, '-')}`}
        onClick={() => setOpen((o) => !o)}
        style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.04em', background: 'transparent', border: 'none', color: '#93c5fd', cursor: 'pointer', padding: 0, textTransform: 'uppercase' }}
      >
        {open ? '▾ ' : '▸ '}{title}
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

export default function FinancialIntelligencePanel({ refreshMs = 30000 }) {
  const [health, setHealth] = useState(null);
  const [financial, setFinancial] = useState(null);
  const [policies, setPolicies] = useState([]);
  const [goal, setGoal] = useState('');
  const [decision, setDecision] = useState(null);
  const [deciding, setDeciding] = useState(false);
  const [decideError, setDecideError] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [altsOpen, setAltsOpen] = useState(false);
  const [stopTarget, setStopTarget] = useState(null);
  const [stopBusy, setStopBusy] = useState(false);
  const [stopResult, setStopResult] = useState(null);

  const loadBaseline = useCallback(async () => {
    try {
      const [h, fs, pol] = await Promise.all([fi.health(), fi.financialState(), fi.policies()]);
      if (h?.ok) setHealth(h);
      if (fs?.ok && fs.financial) setFinancial(fs.financial);
      if (pol?.ok && Array.isArray(pol.policies)) setPolicies(pol.policies);
    } catch {
      /* a baseline gap is a gap, not a crash */
    }
  }, []);

  useEffect(() => {
    loadBaseline();
    const t = setInterval(loadBaseline, refreshMs);
    return () => clearInterval(t);
  }, [loadBaseline, refreshMs]);

  const decide = useCallback(async () => {
    if (!goal.trim()) return;
    setDeciding(true);
    setDecideError(null);
    setDecision(null);
    setEvidence(null);
    setWhyOpen(false);
    setAltsOpen(false);
    const out = await fi.decide({ message: goal, goal: { name: goal } });
    setDeciding(false);
    if (!out?.ok) {
      setDecideError(out?.code || 'DECISION_FAILED');
      return;
    }
    setDecision(out);
  }, [goal]);

  const showEvidence = useCallback(async () => {
    const id = decision?.decision?.id;
    if (!id) return;
    setEvidenceLoading(true);
    const out = await fi.evidence(id);
    setEvidenceLoading(false);
    if (out?.ok) setEvidence(out);
    else setEvidence({ ok: false, code: out?.code || 'EVIDENCE_FAILED' });
  }, [decision]);

  const stop = useCallback(async (policyId, reason) => {
    setStopBusy(true);
    setStopResult(null);
    const out = policyId
      ? await fi.stopPolicy(policyId, reason)
      : await fi.stopAll(reason);
    setStopBusy(false);
    if (out?.ok) {
      setStopResult({ ok: true, stopped: (out.stopped || []).map((s) => s.name || s.policyId) });
      loadBaseline();
    } else {
      setStopResult({ ok: false, code: out?.code || 'STOP_FAILED' });
    }
    setStopTarget(null);
  }, [loadBaseline]);

  const d = decision?.decision || null;
  const council = decision?.council || null;
  const conf = d?.confidence || null;
  const financialMissing = !financial || financial.status === 'UNAVAILABLE';

  const confidenceRows = useMemo(() => {
    if (!conf?.dimensions) return [];
    return Object.entries(conf.dimensions).map(([k, v]) => ({ k, v }));
  }, [conf]);

  return (
    <div data-testid="financial-intelligence-panel" style={{ padding: '14px', fontFamily: 'monospace', fontSize: '0.78rem', background: '#0a0a0f', color: '#e0e0e0', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', marginTop: 12 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <strong style={{ fontSize: '0.9rem' }}>FBT Financial Intelligence</strong>
          <span style={{ opacity: 0.55, marginLeft: 8 }}>reads the brain's state · never signs</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {health && (
            <span style={{ opacity: 0.6, fontSize: '0.68rem' }}>
              migrations {health.migrations?.applied}/{health.migrations?.current} · durable: {health.durable ? 'yes' : 'no'}
            </span>
          )}
          <Pill value={financialMissing ? 'STATE UNREAD' : 'STATE LIVE'} color={financialMissing ? '#f87171' : '#34d399'} />
        </div>
      </div>

      {financialMissing && (
        <div style={{ color: '#fbbf24', marginBottom: 10, padding: '6px 8px', background: 'rgba(251,191,36,0.08)', borderRadius: 6 }}>
          the financial state is unread ({financial?.reason || 'no wallet sections yet'}) — decisions need readable capital, so they will refuse until the wallet is connected through the brain.
        </div>
      )}

      {/* the ask */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          data-testid="fi-goal-input"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && decide()}
          placeholder="what should your money do? (e.g. reach $40k over 18 months)"
          style={{ flex: 1, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e0e0e0', padding: '6px 10px', fontFamily: 'inherit', fontSize: '0.78rem' }}
        />
        <button
          data-testid="fi-decide"
          onClick={decide}
          disabled={deciding || !goal.trim() || financialMissing}
          style={{ fontSize: '0.72rem', fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: '1px solid #93c5fd', background: deciding ? 'rgba(147,197,253,0.15)' : '#93c5fd', color: '#0a0a0f', cursor: deciding || !goal.trim() ? 'default' : 'pointer' }}
        >
          {deciding ? '…' : 'decide'}
        </button>
      </div>

      {decideError && (
        <div style={{ color: '#f87171', marginBottom: 10 }} data-testid="fi-decide-error">
          {decideError}
        </div>
      )}

      {/* the decision card */}
      {d && (
        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <strong style={{ fontSize: '0.85rem' }}>{d.decision?.name || d.status}</strong>
            <Pill value={d.status} color={d.status === 'RECOMMENDED' ? '#34d399' : '#fbbf24'} />
            {d.decision?.riskLevel && <Pill value={`risk ${d.decision.riskLevel}`} color={d.decision.riskLevel === 'LOW' ? '#34d399' : d.decision.riskLevel === 'MODERATE' ? '#fbbf24' : '#f87171'} />}
            {conf && <Pill value={`confidence ${pct(conf.overall)}`} color="#93c5fd" />}
            {council && <Pill value={`council ${council.verdict}`} color={VERDICT_COLOR[council.verdict]} />}
          </div>

          {d.decision && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', opacity: 0.85, marginBottom: 6 }}>
              <span>expected {d.decision.expectedReturnPct === null ? '—' : `${d.decision.expectedReturnPct}%`}</span>
              <span>capital {usd(d.decision.amountUsd)}</span>
              <span>horizon {d.decision.horizonMonths ?? '—'} mo</span>
            </div>
          )}

          {/* the four controls */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }} data-testid="fi-controls">
            <button data-testid="fi-why" onClick={() => setWhyOpen((v) => !v)} style={{ fontSize: '0.7rem', fontWeight: 700, padding: '4px 12px', borderRadius: 8, border: '1px solid #93c5fd', background: 'transparent', color: '#93c5fd', cursor: 'pointer' }}>
              WHY?
            </button>
            <button data-testid="fi-show-evidence" onClick={showEvidence} disabled={evidenceLoading} style={{ fontSize: '0.7rem', fontWeight: 700, padding: '4px 12px', borderRadius: 8, border: '1px solid #34d399', background: 'transparent', color: '#34d399', cursor: 'pointer' }}>
              {evidenceLoading ? '…' : 'SHOW EVIDENCE'}
            </button>
            <button data-testid="fi-alternatives" onClick={() => setAltsOpen((v) => !v)} style={{ fontSize: '0.7rem', fontWeight: 700, padding: '4px 12px', borderRadius: 8, border: '1px solid #fbbf24', background: 'transparent', color: '#fbbf24', cursor: 'pointer' }}>
              ALTERNATIVES
            </button>
            {d.policyId && (
              <button
                data-testid="fi-stop"
                onClick={() => setStopTarget({ id: d.policyId, reason: 'stopped after reviewing the decision' })}
                disabled={stopBusy}
                style={{ fontSize: '0.7rem', fontWeight: 700, padding: '4px 12px', borderRadius: 8, border: '1px solid #f87171', background: stopBusy ? 'rgba(248,113,113,0.15)' : 'transparent', color: '#f87171', cursor: stopBusy ? 'default' : 'pointer' }}
              >
                STOP
              </button>
            )}
          </div>

          {/* WHY? */}
          {whyOpen && (
            <div style={{ marginTop: 10, borderTop: '1px dashed rgba(255,255,255,0.12)', paddingTop: 8 }} data-testid="fi-why-body">
              <div style={{ opacity: 0.7, marginBottom: 6 }}>reason</div>
              {(d.reason || []).map((r, i) => (
                <div key={i} style={{ marginBottom: 4, opacity: 0.9 }}>· {r}</div>
              ))}
              {conf && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ opacity: 0.7, marginBottom: 6 }}>confidence — input quality, not a profit probability{conf.cappedBy ? ` (capped by ${conf.cappedBy})` : ''}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 4 }}>
                    {confidenceRows.map(({ k, v }) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 6px', background: 'rgba(255,255,255,0.04)', borderRadius: 4 }}>
                        <span style={{ opacity: 0.75 }}>{k}</span>
                        <span style={{ color: v === 0 ? '#f87171' : v < 0.5 ? '#fbbf24' : '#34d399' }}>{pct(v)}</span>
                      </div>
                    ))}
                  </div>
                  {conf.blockers?.length > 0 && (
                    <div style={{ color: '#f87171', marginTop: 6 }}>execution blockers: {conf.blockers.join(', ')}</div>
                  )}
                </div>
              )}
              {(d.conditions || []).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ opacity: 0.7, marginBottom: 6 }}>conditions that must still hold</div>
                  {d.conditions.map((c, i) => (
                    <div key={i} style={{ opacity: 0.85 }}>· {c}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SHOW EVIDENCE */}
          {evidence && (
            <div style={{ marginTop: 10, borderTop: '1px dashed rgba(255,255,255,0.12)', paddingTop: 8 }} data-testid="fi-evidence-body">
              {!evidence.ok ? (
                <div style={{ color: '#f87171' }}>evidence: {evidence.code}</div>
              ) : (
                <>
                  <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    {evidence.quality?.count ?? 0} linked rows · mean confidence {pct(evidence.quality?.meanConfidence)} · stale {evidence.quality?.stale ?? 0} · untrusted {evidence.quality?.untrusted ?? 0}
                  </div>
                  {evidence.evidence?.map((e) => (
                    <div key={e.id} style={{ display: 'flex', gap: 8, padding: '3px 0', borderBottom: '1px dashed rgba(255,255,255,0.06)' }}>
                      <Pill value={e.type} color="#93c5fd" />
                      <span style={{ opacity: 0.7, minWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.source}</span>
                      <span style={{ opacity: 0.55 }}>{typeof e.value === 'object' ? JSON.stringify(e.value).slice(0, 40) : String(e.value ?? '—')}</span>
                      <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{pct(e.confidence)} · {e.freshness}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ALTERNATIVES */}
          {altsOpen && (
            <div style={{ marginTop: 10, borderTop: '1px dashed rgba(255,255,255,0.12)', paddingTop: 8 }} data-testid="fi-alts-body">
              {(d.alternatives || []).length === 0 && <div style={{ opacity: 0.6 }}>no other candidate survived — the record says so rather than inventing one.</div>}
              {(d.alternatives || []).map((a) => (
                <div key={a.strategyId} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                  <span style={{ minWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name || a.strategyId}</span>
                  <Pill value={a.type} color="#a1a1aa" />
                  <span style={{ opacity: 0.6 }}>score {a.score ?? '—'}</span>
                  <span style={{ opacity: 0.5, marginLeft: 'auto' }}>{a.expectedReturnPct === null ? 'return not modelled' : `modelled ${a.expectedReturnPct}%`}</span>
                </div>
              ))}
              {decision?.competition?.rejected?.length > 0 && (
                <div style={{ marginTop: 8, opacity: 0.75 }}>
                  <div style={{ opacity: 0.7, marginBottom: 4 }}>removed before ranking — with the reason</div>
                  {decision.competition.rejected.map((r) => (
                    <div key={r.strategyId} style={{ opacity: 0.8 }}>· {r.strategyId}{r.rejectionReasons?.length ? ` — ${r.rejectionReasons.join('; ')}` : ''}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* the council's persisted disagreement */}
          {council && (
            <div style={{ marginTop: 10, borderTop: '1px dashed rgba(255,255,255,0.12)', paddingTop: 8 }} data-testid="fi-council-body">
              <div style={{ opacity: 0.7, marginBottom: 6 }}>
                council: {council.unanimous ? 'unanimous' : council.disagreement ? 'in disagreement (persisted)' : 'no objection'}{council.abstained?.length ? ` · abstained: ${council.abstained.join(', ')}` : ''}
              </div>
              {(council.disagreements || []).map((x) => (
                <div key={x.role} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                  <Pill value={x.verdict} color={VERDICT_COLOR[x.verdict]} />
                  <span style={{ opacity: 0.8 }}>{x.role}: {x.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* standing policies + STOP */}
      <Section title={`standing policies (${policies.length})`}>
        {policies.length === 0 && (
          <div style={{ opacity: 0.55, fontSize: '0.72rem' }}>
            no standing policy. without one, nothing executes autonomously — a run is a run under a named scope with named limits.
          </div>
        )}
        {policies.map((p) => (
          <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 6, marginBottom: 5, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>{p.name}</span>
            <Pill value={p.emergency ? 'STOPPED' : p.status} color={p.emergency ? '#f87171' : p.status === 'ACTIVE' ? '#34d399' : '#a1a1aa'} />
            <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>
              ≤{usd(p.maxPerExecutionUsd)}/run · ≤{usd(p.maxDailyUsd)}/day · ≤{usd(p.maxCumulativeUsd)} lifetime
            </span>
            {p.spend && <span style={{ opacity: 0.5, fontSize: '0.7rem' }}>spent today {usd(p.spend.dayUsd)} · total {usd(p.spend.totalUsd)}</span>}
            <button
              data-testid="fi-policy-stop"
              onClick={() => setStopTarget({ id: p.id, reason: 'stopped by the user' })}
              disabled={stopBusy || p.emergency || p.status === 'REVOKED'}
              style={{ marginLeft: 'auto', fontSize: '0.68rem', fontWeight: 700, padding: '2px 10px', borderRadius: 6, border: '1px solid #f87171', background: 'transparent', color: '#f87171', cursor: 'pointer' }}
            >
              STOP
            </button>
          </div>
        ))}
        {policies.length > 0 && (
          <button
            data-testid="fi-stop-all"
            onClick={() => setStopTarget({ id: null, reason: 'stopped everything by the user' })}
            disabled={stopBusy}
            style={{ fontSize: '0.7rem', fontWeight: 700, padding: '4px 12px', borderRadius: 8, border: '1px solid #f87171', background: 'transparent', color: '#f87171', cursor: 'pointer' }}
          >
            STOP EVERYTHING
          </button>
        )}
      </Section>

      {stopResult && (
        <div data-testid="fi-stop-result" style={{ marginTop: 10, padding: '6px 10px', borderRadius: 6, background: stopResult.ok ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', color: stopResult.ok ? '#34d399' : '#f87171', fontSize: '0.74rem' }}>
          {stopResult.ok
            ? `stopped: ${stopResult.stopped.join(', ') || 'all active policies'}`
            : `stop failed: ${stopResult.code}`}
        </div>
      )}

      {/* the confirmation step — STOP is deliberate */}
      {stopTarget && (
        <div data-testid="fi-stop-confirm" role="dialog" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#111118', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 12, padding: 18, maxWidth: 380, fontFamily: 'monospace', fontSize: '0.8rem', color: '#e0e0e0' }}>
            <strong style={{ color: '#f87171' }}>Stop {stopTarget.id ? 'this policy' : 'ALL policies'}?</strong>
            <p style={{ opacity: 0.8, margin: '10px 0' }}>
              The policy freezes immediately: no further run is admitted until you explicitly resume it. This stops the machine, not the wallet — signed transactions in flight are the wallet's.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => stop(stopTarget.id, stopTarget.reason)}
                disabled={stopBusy}
                style={{ fontSize: '0.74rem', fontWeight: 700, padding: '6px 16px', borderRadius: 8, border: '1px solid #f87171', background: stopBusy ? 'rgba(248,113,113,0.2)' : '#f87171', color: '#0a0a0f', cursor: 'pointer' }}
              >
                {stopBusy ? '…' : 'yes, stop'}
              </button>
              <button
                onClick={() => setStopTarget(null)}
                disabled={stopBusy}
                style={{ fontSize: '0.74rem', fontWeight: 700, padding: '6px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: '#e0e0e0', cursor: 'pointer' }}
              >
                keep running
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
