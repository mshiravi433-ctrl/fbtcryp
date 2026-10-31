import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
// Local stroke icons keep this route dependency-free and inside the first-paint budget.
const makeIcon = (paths) => ({ size = 18, ...rest } = {}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {paths.map((d, i) => <path key={i} d={d} />)}
  </svg>
);
const Activity = makeIcon(['M22 12h-4l-3 9L9 3l-3 9H2']);
const AlertTriangle = makeIcon(['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z', 'M12 9v4', 'M12 17h.01']);
const ArrowLeft = makeIcon(['M19 12H5', 'm12 19-7-7 7-7']);
const BrainCircuit = makeIcon(['M12 5a3 3 0 0 0-3 3', 'M12 5a3 3 0 0 1 3 3', 'M9 8a3 3 0 0 0 0 6', 'M15 8a3 3 0 0 1 0 6', 'M9 14a3 3 0 0 0 3 3', 'M15 14a3 3 0 0 1-3 3', 'M12 17v4', 'M5 12H2', 'M22 12h-3']);
const CheckCircle2 = makeIcon(['M22 11.1V12a10 10 0 1 1-5.9-9.1', 'M22 4 12 14l-3-3']);
const ChevronDown = makeIcon(['m6 9 6 6 6-6']);
const Clock3 = makeIcon(['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M12 6v6l4 2']);
const Database = makeIcon(['M12 2c-4.4 0-8 1.3-8 3s3.6 3 8 3 8-1.3 8-3-3.6-3-8-3Z', 'M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3']);
const Gauge = makeIcon(['M12 14l4-4', 'M3.3 19a10 10 0 1 1 17.4 0']);
const Pause = makeIcon(['M6 4h4v16H6z', 'M14 4h4v16h-4z']);
const Play = makeIcon(['m5 3 14 9-14 9V3Z']);
const Plus = makeIcon(['M12 5v14', 'M5 12h14']);
const Radar = makeIcon(['M12 12 4.9 19.1', 'M12 2a10 10 0 1 0 10 10', 'M12 6a6 6 0 1 0 6 6', 'M12 10a2 2 0 1 0 2 2']);
const RefreshCw = makeIcon(['M3 12a9 9 0 0 1 15-6.7L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15 6.7L3 16', 'M3 21v-5h5']);
const ShieldCheck = makeIcon(['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', 'm9 12 2 2 4-4']);
const Square = makeIcon(['M3 3h18v18H3z']);
const X = makeIcon(['M18 6 6 18', 'M6 6l12 12']);
import { missionApi } from '../lib/missionControlClient';
import '../styles/mission-control.css';

const STATUS_FA = { Pending: 'در انتظار', Planning: 'برنامه‌ریزی', Running: 'در حال اجرا', 'Waiting Approval': 'منتظر تأیید', Completed: 'تکمیل‌شده', Failed: 'ناموفق', Paused: 'متوقف', Cancelled: 'لغوشده' };
const KINDS = [['smart_money_scan', 'اسمارت مانی / Smart Money'], ['market_analysis', 'تحلیل بازار / Market analysis'], ['research', 'پژوهش / Research'], ['daily_report', 'گزارش روزانه / Daily report'], ['trade_request', 'درخواست معامله (بدون امضا) / Trade intent']];
const fmtTime = (v) => v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const money = (v) => `$${Number(v || 0).toFixed(4)}`;
const tone = (s) => ({ Completed: 'good', Running: 'live', Failed: 'bad', 'Waiting Approval': 'warn', Paused: 'warn', Cancelled: 'muted' }[s] || 'muted');

export default function MissionControl() {
  const navigate = useNavigate(); const { i18n } = useTranslation();
  const fa = String(i18n.language || 'fa').startsWith('fa'); const tr = (a, b) => fa ? a : b;
  const [view, setView] = useState({ status: null, missions: [], opportunities: [], learning: null, events: [] });
  const [error, setError] = useState(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null); const [detail, setDetail] = useState(null); const [showForm, setShowForm] = useState(false);
  const [goal, setGoal] = useState(''); const [kind, setKind] = useState('smart_money_scan'); const [priority, setPriority] = useState(5);
  const [startAt, setStartAt] = useState(''); const [intervalMin, setIntervalMin] = useState(''); const [budget, setBudget] = useState('0.02');
  const refresh = useCallback(async (signal) => {
    try {
      const [status, list, opportunities, learning, events] = await Promise.all([missionApi.status(signal), missionApi.list(signal), missionApi.opportunities(signal), missionApi.learning(signal), missionApi.events(signal)]);
      setView({ status, missions: list.missions || [], opportunities: opportunities.opportunities || [], learning, events: events.events || [] }); setError(null);
    } catch (e) { if (e.message !== 'ABORTED') setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    let ctrl; let timer;
    const load = () => { ctrl?.abort(); ctrl = new AbortController(); refresh(ctrl.signal); };
    load();
    const tick = () => { if (document.visibilityState === 'visible') load(); timer = setTimeout(tick, 5000); };
    timer = setTimeout(tick, 5000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { ctrl?.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    const ctrl = new AbortController();
    missionApi.detail(selected, ctrl.signal).then(setDetail).catch((e) => { if (e.message !== 'ABORTED') setError(e.message); });
    return () => ctrl.abort();
  }, [selected, view.missions]);
  const active = view.missions.filter((m) => ['Pending', 'Planning', 'Running', 'Waiting Approval'].includes(m.status));
  const runningTasks = useMemo(() => (detail?.tasks || []).filter((t) => t.status === 'running'), [detail]);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = { goal, kind, priority: Number(priority), idempotencyKey: crypto.randomUUID(), input: { locale: i18n.language, optionalResearch: false }, permissions: { maxModelUsd: Number(budget) } };
      if (startAt) body.schedule = { startAt: new Date(startAt).getTime(), ...(intervalMin ? { intervalMs: Number(intervalMin) * 60000 } : {}) };
      const out = await missionApi.create(body); setShowForm(false); setGoal(''); setSelected(out.mission.id); await refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const command = async (m, action) => {
    setBusy(true); setError(null);
    try { await missionApi.command(m.id, action, m.version); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const emergency = async () => {
    if (!window.confirm(tr('توقف اضطراری همهٔ مأموریت‌ها؟', 'Emergency-stop all missions?'))) return;
    setBusy(true); try { await missionApi.emergency('dashboard-user-stop'); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const release = async () => { setBusy(true); try { await missionApi.release(); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const stopped = !!view.status?.globalStop;
  return (
    <div className="mc-page" dir={fa ? 'rtl' : 'ltr'}>
      <header className="mc-header">
        <button className="mc-icon" onClick={() => navigate('/intent')} aria-label={tr('بازگشت', 'Back')}><ArrowLeft size={19} /></button>
        <div><div className="mc-eyebrow">FBT · AUTONOMOUS INTELLIGENCE</div><h1>{tr('مرکز فرمان مأموریت‌ها', 'Mission Control')}</h1></div>
        <div className={`mc-brain ${stopped ? 'is-stopped' : ''}`}><BrainCircuit size={18} /><span>{stopped ? tr('توقف اضطراری', 'Emergency stop') : view.status?.worker?.running ? tr('مغز فعال', 'Brain online') : tr('کارگر متصل نیست', 'Worker offline')}</span></div>
      </header>
      <p className="mc-subtitle">{tr('مأموریت‌ها روی سرور ادامه پیدا می‌کنند؛ بستن این صفحه اجرای آن‌ها را متوقف نمی‌کند. تکمیل فقط با شواهد تأییدشده.', 'Missions continue on the server; closing this page does not stop them. Completion requires verified evidence.')}</p>
      {error && <div className="mc-alert" role="alert"><AlertTriangle size={17} /><span>{error}</span><button onClick={() => refresh()}>{tr('تلاش دوباره', 'Retry')}</button></div>}
      {stopped && <div className="mc-alert warn"><ShieldCheck size={17} /><span>{tr('سیاست سراسری اجرا را بسته است.', 'The global policy has closed execution.')}</span><button disabled={busy} onClick={release}>{tr('رفع توقف با تأیید', 'Release with confirmation')}</button></div>}
      <section className="mc-stats">
        <Stat icon={<Activity />} label={tr('مأموریت فعال', 'Active missions')} value={active.length} />
        <Stat icon={<Radar />} label={tr('فرصت مشاهده‌شده', 'Observed opportunities')} value={view.opportunities.length} />
        <Stat icon={<Gauge />} label={tr('هزینه مدل', 'Model spend')} value={money(view.status?.cost?.chargedUsd)} />
        <Stat icon={<ShieldCheck />} label={tr('وضعیت سیاست', 'Policy')} value={stopped ? 'STOP' : 'GUARDED'} />
      </section>
      <div className="mc-toolbar">
        <h2>{tr('مأموریت‌ها', 'Missions')}</h2>
        <button className="mc-btn ghost" onClick={() => refresh()}><RefreshCw size={15} />{tr('بروزرسانی', 'Refresh')}</button>
        <button className="mc-btn danger" disabled={busy || stopped} onClick={emergency}><Square size={14} />{tr('توقف اضطراری', 'Emergency stop')}</button>
        <button className="mc-btn primary" onClick={() => setShowForm((v) => !v)}><Plus size={16} />{tr('مأموریت جدید', 'New mission')}</button>
      </div>
      {showForm && <form className="mc-form" onSubmit={submit}>
        <label className="mc-wide">{tr('هدف مأموریت', 'Mission goal')}<textarea required minLength={5} maxLength={2000} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={tr('مثلاً: جریان نهنگ‌ها و حجم غیرعادی BTC را با شواهد بررسی کن', 'e.g. Investigate BTC whale flow and unusual volume with evidence')} /></label>
        <label>{tr('نوع', 'Kind')}<select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label>{tr('اولویت', 'Priority')}<input type="number" min="1" max="10" value={priority} onChange={(e) => setPriority(e.target.value)} /></label>
        <label>{tr('شروع (اختیاری)', 'Start (optional)')}<input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></label>
        <label>{tr('تکرار هر چند دقیقه', 'Repeat every minutes')}<input type="number" min="1" placeholder="—" value={intervalMin} onChange={(e) => setIntervalMin(e.target.value)} disabled={kind === 'trade_request'} /></label>
        <label>{tr('سقف هزینه مدل (USD)', 'Model budget (USD)')}<input type="number" min="0" max="10" step="0.005" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
        <div className="mc-form-actions"><button type="button" className="mc-btn ghost" onClick={() => setShowForm(false)}>{tr('انصراف', 'Cancel')}</button><button className="mc-btn primary" disabled={busy || stopped}>{busy ? tr('در حال ثبت…', 'Submitting…') : tr('ثبت و ارسال به کارگر', 'Submit to worker')}</button></div>
      </form>}
      {loading ? <div className="mc-empty">{tr('در حال خواندن وضعیت واقعی سرور…', 'Reading real server state…')}</div> : !view.missions.length ? <div className="mc-empty"><BrainCircuit size={30} /><b>{tr('هنوز مأموریتی ثبت نشده', 'No missions yet')}</b><span>{tr('دادهٔ نمونه نمایش داده نمی‌شود.', 'No sample data is shown.')}</span></div> : <div className="mc-grid">
        <section className="mc-list">{view.missions.map((m) => <article key={m.id} className={`mc-mission ${selected === m.id ? 'selected' : ''}`} onClick={() => setSelected(m.id)}>
          <div className="mc-row"><span className={`mc-chip ${tone(m.status)}`}>{fa ? STATUS_FA[m.status] || m.status : m.status}</span><span className="mc-time"><Clock3 size={12} />{fmtTime(m.created_at)}</span></div>
          <h3>{m.goal}</h3><div className="mc-meta"><span>{(m.plan || []).map((p) => p.id || p).join(' · ')}</span><span>v{m.version}</span></div>
          {m.error && <p className="mc-error">{m.error.code || 'ERROR'}</p>}
          <div className="mc-actions" onClick={(e) => e.stopPropagation()}>
            {['Pending', 'Planning', 'Running'].includes(m.status) && <button disabled={busy} onClick={() => command(m, 'pause')}><Pause size={14} />{tr('توقف', 'Pause')}</button>}
            {m.status === 'Paused' && <button disabled={busy || stopped} onClick={() => command(m, 'resume')}><Play size={14} />{tr('ادامه', 'Resume')}</button>}
            {!['Completed', 'Failed', 'Cancelled'].includes(m.status) && <button disabled={busy} className="danger" onClick={() => command(m, 'cancel')}><X size={14} />{tr('لغو', 'Cancel')}</button>}
            <button onClick={() => setSelected(m.id)}><ChevronDown size={14} />{tr('جزئیات', 'Details')}</button>
          </div>
        </article>)}</section>
        <section className="mc-detail">{detail ? <>
          <h2>{tr('جزئیات و شواهد', 'Details & evidence')}</h2><p className="mc-goal">{detail.mission.goal}</p>
          <div className="mc-section"><h3>{tr('عامل‌ها', 'Agents')}</h3>{detail.tasks.map((t) => <div className="mc-task" key={t.id}><span className={`mc-dot ${tone(t.status === 'completed' ? 'Completed' : t.status === 'failed' ? 'Failed' : t.status)}`} /><b>{t.agent_id}</b><span>{t.status}</span><small>{t.attempts}/{t.max_attempts}</small>{t.error && <em>{t.error.code}</em>}</div>)}</div>
          <div className="mc-section"><h3>{tr('شواهد مستقل', 'Independent evidence')} · {detail.evidence.length}</h3>{detail.evidence.map((e) => <details key={e.id} className="mc-evidence"><summary><Database size={14} /><span>{e.source}</span><span className={`mc-chip ${e.status === 'verified' ? 'good' : 'bad'}`}>{e.status}</span></summary><div><p>{tr('دریافت', 'Received')}: {fmtTime(e.received_at)} · {tr('مشاهده', 'Observed')}: {fmtTime(e.observed_at)}</p>{e.source_url && <a href={e.source_url} target="_blank" rel="noreferrer">{tr('منبع', 'Source')}</a>}<code>{e.raw_sha256}</code><pre>{JSON.stringify(e.verification, null, 2)}</pre></div></details>)}</div>
          {detail.mission.result && <details className="mc-section" open><summary><h3>{tr('نتیجه و تصمیم', 'Result & decision')}</h3></summary><pre>{JSON.stringify(detail.mission.result, null, 2)}</pre></details>}
          {detail.mission.error && <div className="mc-alert"><AlertTriangle size={16} /><pre>{JSON.stringify(detail.mission.error, null, 2)}</pre></div>}
        </> : <div className="mc-empty">{tr('یک مأموریت را انتخاب کنید', 'Select a mission')}</div>}</section>
      </div>}
      <section className="mc-section mc-opportunities"><h2><Radar size={18} />{tr('فرصت‌های مبتنی بر شواهد', 'Evidence-backed opportunities')}</h2>{!view.opportunities.length ? <p className="mc-muted">{tr('هنوز فرصتی از دادهٔ واقعی ثبت نشده است.', 'No real-data opportunity has been recorded yet.')}</p> : <div className="mc-opp-grid">{view.opportunities.map((o) => <article className="mc-opp" key={o.id}><div className="mc-row"><b>{o.instrument}</b><span className={`mc-chip ${(o.risk?.level || o.risk) === 'HIGH' ? 'bad' : 'warn'}`}>{o.risk?.level || o.risk || 'UNKNOWN'} RISK</span></div><div className="mc-score">{Math.round((o.score || 0) * 100)}<small>/100</small></div><p>{o.kind.replaceAll('_', ' ')}</p><div className="mc-meta"><span>{tr('اطمینان', 'confidence')} {Math.round((o.confidence || 0) * 100)}%</span><span>{o.evidenceIds?.length || 0} {tr('مدرک', 'receipts')}</span></div><div className="mc-signals">{(o.signals || []).map((s) => <span key={s}>{s}</span>)}</div><small>{fmtTime(o.discoveredAt)} · {tr('مشاهده است، نه دستور معامله', 'an observation, not an order')}</small></article>)}</div>}</section>
      <section className="mc-section"><h2><CheckCircle2 size={18} />{tr('یادگیری و رویدادها', 'Learning & events')}</h2><div className="mc-two"><div><h3>{tr('عملکرد عامل‌ها', 'Agent performance')}</h3>{!(view.learning?.metrics || []).length ? <p className="mc-muted">{tr('نمونهٔ ارزیابی‌شده‌ای وجود ندارد.', 'No evaluated samples yet.')}</p> : view.learning.metrics.map((m) => <div className="mc-task" key={m.agent_id}><b>{m.agent_id}</b><span>{m.samples} {tr('نمونه', 'samples')}</span><span>Brier {Number(m.brier).toFixed(3)}</span></div>)}</div><div><h3>{tr('رویدادهای اخیر', 'Recent events')}</h3>{view.events.slice(0, 8).map((e) => <div className="mc-event" key={e.seq}><code>{e.type}</code><small>{fmtTime(e.created_at)}</small></div>)}</div></div></section>
      <footer className="mc-footer"><ShieldCheck size={14} />{tr('هیچ کلید خصوصی در اختیار عامل‌ها نیست. تأیید مأموریت معامله، مجوز امضا ایجاد نمی‌کند.', 'Agents never receive private keys. Approving a trade mission does not grant signing authority.')}</footer>
    </div>
  );
}
function Stat({ icon, label, value }) { return <div className="mc-stat"><span className="mc-stat-icon">{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>; }
