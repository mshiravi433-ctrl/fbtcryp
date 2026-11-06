/**
 * FBT AI — MULTI-MODEL INTELLIGENCE · BENCHMARK & PROVIDER LAB
 * ---------------------------------------------------------------------------
 * The dashboard the operator asked for, with one non-negotiable rule:
 *
 *   NOTHING ON THIS SCREEN IS DERIVED FROM A SAVED SETTING.
 *
 *   · Connected  = this server saw a successful call from that provider.
 *                  A present API key reports as «کلید دارد · متصل نیست».
 *   · Model ID   = the model id that actually answered.
 *   · Latency    = the last real success, or the average of the measured calls.
 *   · Tokens     = provider-reported usage; 0 means "not reported", not free.
 *   · Error rate = real outcomes in the gateway's rolling window.
 *   · Failover   = circuit state + the reason it is parked.
 *   · Health check = the timestamp of the last success/failure, not "now".
 *
 * Skipped tests are shown as skipped. A 401 from an invalid-key probe is shown
 * as PASS for the CLIENT (it classified the error) and never as connected.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchIntelligenceStatus,
  runBenchmark,
  runProviderLab
} from '../../lib/aiBenchmarkClient.js';

const fmtTime = (value, locale) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(5, 16).replace('T', ' ');
  }
};

const fmtNum = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
};

const pct = (v) => (v == null ? '—' : `${Math.round(Number(v) * 100)}%`);

function scoreTone(score) {
  if (score == null) return 'none';
  if (score >= 75) return 'good';
  if (score >= 60) return 'ok';
  if (score >= 40) return 'warn';
  return 'bad';
}

const STATUS_TONE = { PASS: 'good', FAIL: 'bad', SKIPPED: 'none', INCONCLUSIVE: 'warn' };

export default function AiBenchmarkPanel({ locale = 'fa' }) {
  const isEn = String(locale || '').startsWith('en');
  const intl = isEn ? 'en-US' : 'fa-IR';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState(null);
  const [lab, setLab] = useState(null);
  const [labBusy, setLabBusy] = useState(false);
  const [labError, setLabError] = useState(null);
  const [run, setRun] = useState(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState(null);
  const [mode, setMode] = useState('single');
  const [selected, setSelected] = useState([]);

  const load = useCallback(async () => {
    setLoading((prev) => (data ? prev : true));
    const res = await fetchIntelligenceStatus();
    if (res.ok) {
      setData(res);
      setReadError(null);
      if (res.lab) setLab((prev) => prev || res.lab);
    } else {
      setReadError(res.error || 'READ_FAILED');
    }
    setLoading(false);
    // `data` is intentionally not a dependency: this is a mount/refresh read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void load(); }, [load]);

  const providers = useMemo(() => (Array.isArray(data?.providers) ? data.providers : []), [data]);
  const connected = providers.filter((p) => p.connected);
  const configured = providers.filter((p) => p.configured && p.id !== 'internal');
  const suite = data?.suite || null;
  const lastRun = run || data?.benchmark?.lastRun || null;

  /* Default the per-model selection to the first two connected providers: the
     public HTTP cap is two, and a silent truncation would look like a bug. */
  useEffect(() => {
    if (selected.length || !configured.length) return;
    setSelected(configured.slice(0, 2).map((p) => p.id));
  }, [configured, selected.length]);

  const toggleProvider = (id) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const doLab = async () => {
    setLabBusy(true);
    setLabError(null);
    const res = await runProviderLab();
    if (res.ok && res.report) {
      setLab(res.report);
      void load();
    } else {
      setLabError(res.error || 'LAB_FAILED');
    }
    setLabBusy(false);
  };

  const doRun = async () => {
    setRunBusy(true);
    setRunError(null);
    const res = await runBenchmark({
      mode,
      smoke: true,
      providers: mode === 'single' ? selected : [],
      concurrency: 2
    });
    if (res.ok && res.run) {
      setRun(res.run);
      void load();
    } else {
      setRunError(res.error === 'NO_CONFIGURED_PROVIDER'
        ? (isEn ? 'No provider is configured, so there is nothing to compare.' : 'هیچ ارائه‌دهنده‌ای پیکربندی نشده، بنابراین مقایسه‌ای وجود ندارد.')
        : (res.error || 'RUN_FAILED'));
    }
    setRunBusy(false);
  };

  const leaderboard = lastRun?.aggregate?.leaderboard || lastRun?.leaderboard || [];
  const summary = lastRun?.summary || lastRun?.aggregate?.overall || null;

  return (
    <div className="iab" dir={isEn ? 'ltr' : 'rtl'} data-testid="ai-benchmark-panel">
      {/* ── head ─────────────────────────────────────────────────────────── */}
      <div className="iab-head">
        <div>
          <h3>{isEn ? 'Multi-Model Intelligence' : 'هوش چندمدلی — بنچمارک و آزمایشگاه'}</h3>
          <p>
            {isEn
              ? 'Real calls, real model ids, real latency. Connected means a provider answered — not that a key exists.'
              : 'تماس واقعی، شناسهٔ مدل واقعی، تأخیر واقعی. «متصل» یعنی ارائه‌دهنده پاسخ داده — نه اینکه کلید ذخیره شده است.'}
          </p>
        </div>
        <button type="button" className="iaos-btn" onClick={() => void load()} disabled={loading} data-testid="iab-refresh">
          {loading ? (isEn ? 'Reading…' : 'در حال خواندن…') : (isEn ? 'Refresh' : 'به‌روزرسانی')}
        </button>
      </div>

      {readError ? (
        <p className="iab-note iab-note-warn" data-testid="iab-read-error">
          {isEn
            ? `The intelligence read failed (${readError}). No number below is from this attempt; nothing is being invented to fill the gap.`
            : `خواندن وضعیت هوش مصنوعی ناموفق بود (${readError}). هیچ عددی در این صفحه از این تلاش نیست و چیزی برای پر کردن جای خالی ساخته نمی‌شود.`}
        </p>
      ) : null}

      {/* ── counters ─────────────────────────────────────────────────────── */}
      <div className="iab-counters">
        <div className="iab-counter">
          <strong>{suite ? suite.size : '—'}</strong>
          <span>{isEn ? 'questions in the suite' : 'سؤال در مجموعهٔ آزمون'}</span>
        </div>
        <div className="iab-counter">
          <strong>{connected.length}/{configured.length || 0}</strong>
          <span>{isEn ? 'providers answered' : 'ارائه‌دهندهٔ پاسخ‌داده'}</span>
        </div>
        <div className="iab-counter">
          <strong>{lab ? `${lab.summary?.passed ?? 0}/${lab.summary?.executed ?? 0}` : '—'}</strong>
          <span>{isEn ? 'lab tests passed / executed' : 'تست آزمایشگاه قبول / اجراشده'}</span>
        </div>
        <div className="iab-counter">
          <strong className={`iab-score iab-${scoreTone(summary?.avgScore)}`}>{summary?.avgScore ?? '—'}</strong>
          <span>{isEn ? 'last run average score' : 'میانگین امتیاز آخرین اجرا'}</span>
        </div>
      </div>

      {suite ? (
        <p className="iab-note">
          {isEn
            ? `${suite.size} questions · ${suite.categories.length} chapters · ${suite.flags.needsLiveData} need live data · ${suite.flags.execution} ask for an action · ${suite.flags.multiModel} test multiple models.`
            : `${suite.size} سؤال · ${suite.categories.length} فصل · ${suite.flags.needsLiveData} نیازمند دادهٔ زنده · ${suite.flags.execution} درخواست اقدام · ${suite.flags.multiModel} آزمون چندمدلی.`}
        </p>
      ) : null}

      {/* ── provider telemetry ───────────────────────────────────────────── */}
      <section className="iab-section">
        <h4>{isEn ? 'Provider health — from real traffic' : 'سلامت ارائه‌دهنده‌ها — از ترافیک واقعی'}</h4>
        <div className="iab-table-wrap">
          <table className="iab-table">
            <thead>
              <tr>
                <th>{isEn ? 'Provider' : 'ارائه‌دهنده'}</th>
                <th>{isEn ? 'State' : 'وضعیت'}</th>
                <th>Model ID</th>
                <th>{isEn ? 'Latency' : 'تأخیر'}</th>
                <th>{isEn ? 'Tokens in/out' : 'توکن ورودی/خروجی'}</th>
                <th>{isEn ? 'Error rate' : 'نرخ خطا'}</th>
                <th>{isEn ? 'Failover' : 'جایگزینی'}</th>
                <th>{isEn ? 'Last health check' : 'آخرین بررسی'}</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} data-testid={`iab-provider-${p.id}`} data-connected={p.connected ? 'true' : 'false'}>
                  <td>
                    <strong>{p.name}</strong>
                    <small dir="ltr">{p.id}</small>
                  </td>
                  <td>
                    {p.connected ? (
                      <span className="iab-pill iab-good">{isEn ? 'Connected' : 'متصل'}</span>
                    ) : (
                      <span className={`iab-pill ${p.configured ? 'iab-warn' : 'iab-none'}`}>
                        {p.configured
                          ? (isEn ? 'Key present · not proven' : 'کلید دارد · متصل نیست')
                          : (isEn ? 'Disconnected' : 'قطع')}
                      </span>
                    )}
                    {p.verdict && String(p.verdict).startsWith('ERROR:') ? (
                      <small className="iab-reason">{String(p.verdict).slice(6)}</small>
                    ) : null}
                  </td>
                  <td dir="ltr"><code>{p.modelId || '—'}</code></td>
                  <td>{p.responseLatencyMs != null ? `${fmtNum(p.responseLatencyMs)}ms` : '—'}</td>
                  <td dir="ltr">{`${fmtNum(p.tokensIn)} / ${fmtNum(p.tokensOut)}`}</td>
                  <td>{p.errorRate != null ? pct(p.errorRate) : '—'}</td>
                  <td>
                    {p.failover?.circuitOpen
                      ? <span className="iab-pill iab-bad">{isEn ? 'Parked' : 'کنارگذاشته'}</span>
                      : <span className="iab-pill iab-good">{isEn ? 'Ready' : 'آماده'}</span>}
                    {p.failover?.circuitOpen && p.failover?.reason ? <small className="iab-reason">{p.failover.reason}</small> : null}
                  </td>
                  <td>{fmtTime(p.lastHealthCheck, intl)}</td>
                </tr>
              ))}
              {!providers.length && !loading ? (
                <tr>
                  <td colSpan={8} className="iab-empty">
                    {isEn ? 'No provider row arrived. Nothing is being assumed.' : 'هیچ ردیفی نرسید؛ هیچ فرضی هم ساخته نمی‌شود.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── actions ──────────────────────────────────────────────────────── */}
      <section className="iab-section">
        <h4>{isEn ? 'Run the tests' : 'اجرای آزمون‌ها'}</h4>
        <div className="iab-actions">
          <button type="button" className="iaos-btn" onClick={() => void doLab()} disabled={labBusy} data-testid="iab-run-lab">
            {labBusy
              ? (isEn ? 'Calling every provider…' : 'در حال تماس با همهٔ ارائه‌دهنده‌ها…')
              : (isEn ? 'Run the 15 connectivity tests' : 'اجرای ۱۵ تست اتصال')}
          </button>

          <select value={mode} onChange={(e) => setMode(e.target.value)} className="iab-select" aria-label="mode" data-testid="iab-mode">
            <option value="single">{isEn ? 'Single AI' : 'تک‌مدلی'}</option>
            <option value="multi">{isEn ? 'Multi AI' : 'چندمدلی'}</option>
            <option value="collective">{isEn ? 'Collective intelligence' : 'هوش جمعی'}</option>
          </select>

          <button type="button" className="iaos-btn" onClick={() => void doRun()} disabled={runBusy || (mode === 'single' && !selected.length)} data-testid="iab-run-benchmark">
            {runBusy
              ? (isEn ? 'Running 10 questions…' : 'در حال اجرای ۱۰ سؤال…')
              : (isEn ? 'Run a 10-question smoke benchmark' : 'اجرای آزمون سریع ۱۰ سؤالی')}
          </button>
        </div>

        {mode === 'single' ? (
          <div className="iab-chips">
            <span className="iab-chips-label">{isEn ? 'Compare up to 2 providers:' : 'مقایسهٔ حداکثر ۲ ارائه‌دهنده:'}</span>
            {configured.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`iab-chip${selected.includes(p.id) ? ' is-on' : ''}`}
                onClick={() => toggleProvider(p.id)}
                data-testid={`iab-select-${p.id}`}
              >
                {p.name}
              </button>
            ))}
            {!configured.length ? <span className="iab-note">{isEn ? 'No key is configured.' : 'هیچ کلیدی پیکربندی نشده است.'}</span> : null}
          </div>
        ) : null}

        {runError ? <p className="iab-note iab-note-warn" data-testid="iab-run-error">{runError}</p> : null}
        {labError ? <p className="iab-note iab-note-warn" data-testid="iab-lab-error">{labError}</p> : null}
        <p className="iab-note">
          {isEn
            ? 'The HTTP run is capped at 10 questions / 2 providers so one tap cannot spend a fortune. The full 100-question comparison runs from the CLI (scripts/ai-benchmark.mjs).'
            : 'اجرای HTTP حداکثر ۱۰ سؤال و ۲ ارائه‌دهنده است تا یک کلیک هزینهٔ سنگین نسازد. مقایسهٔ کامل ۱۰۰ سؤالی با CLI اجرا می‌شود (scripts/ai-benchmark.mjs).'}
        </p>
      </section>

      {/* ── lab results ──────────────────────────────────────────────────── */}
      {lab?.tests?.length ? (
        <section className="iab-section">
          <h4>
            {isEn ? 'Connectivity & resilience' : 'اتصال و مقاومت'}
            <small>
              {lab.summary
                ? ` · ${lab.summary.passed} ${isEn ? 'passed' : 'قبول'} · ${lab.summary.failed} ${isEn ? 'failed' : 'رد'} · ${lab.summary.skipped} ${isEn ? 'skipped' : 'ردشده'}`
                : ''}
            </small>
          </h4>
          <div className="iab-lab">
            {lab.tests.map((t) => (
              <div key={t.id} className="iab-lab-row" data-testid={`iab-lab-${t.id}`} data-status={t.status}>
                <span className={`iab-pill iab-${STATUS_TONE[t.status] || 'none'}`}>{t.status}</span>
                <strong>{isEn ? t.en : t.fa}</strong>
                <small>{t.method}</small>
                <span dir="ltr" className="iab-lab-evidence">
                  {t.status === 'SKIPPED'
                    ? `${t.reasonCode || ''}${t.detail ? ` — ${t.detail}` : ''}`
                    : t.status === 'PASS'
                      ? [t.model, t.servedBy, t.latencyMs != null ? `${t.latencyMs}ms` : null, t.classification?.kind].filter(Boolean).join(' · ')
                      : `${t.reasonCode || ''}${t.error ? ` — ${t.error}` : ''}`}
                </span>
              </div>
            ))}
          </div>
          {lab.summary ? (
            <p className="iab-note">
              {isEn
                ? `Connected by LIVE evidence this run: ${lab.summary.connectedProviders?.length ? lab.summary.connectedProviders.map((p) => `${p.provider}/${p.model || '?'}`).join(', ') : 'none'}.`
                : `متصل با شاهد زندهٔ همین اجرا: ${lab.summary.connectedProviders?.length ? lab.summary.connectedProviders.map((p) => `${p.provider}/${p.model || '?'}`).join(', ') : 'هیچ‌کدام'}.`}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ── benchmark results ────────────────────────────────────────────── */}
      {lastRun ? (
        <section className="iab-section">
          <h4>{isEn ? 'Last benchmark' : 'آخرین بنچمارک'}<small>{` · ${lastRun.mode || ''} · ${fmtTime(lastRun.startedAt, intl)}`}</small></h4>
          <div className="iab-table-wrap">
            <table className="iab-table">
              <thead>
                <tr>
                  <th>{isEn ? 'Model provider' : 'ارائه‌دهنده'}</th>
                  <th>{isEn ? 'Avg score' : 'میانگین امتیاز'}</th>
                  <th>{isEn ? 'Pass rate' : 'نرخ قبولی'}</th>
                  <th>{isEn ? 'Questions' : 'سؤال'}</th>
                  <th>{isEn ? 'Est. cost' : 'هزینهٔ تخمینی'}</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((r) => (
                  <tr key={r.provider} data-testid={`iab-score-${r.provider}`}>
                    <td dir="ltr">{r.provider}</td>
                    <td><span className={`iab-score iab-${scoreTone(r.avgScore)}`}>{r.avgScore}</span></td>
                    <td>{pct(r.passRate)}</td>
                    <td>{r.questions}</td>
                    <td dir="ltr">{r.costEstimateUsd ? `~$${r.costEstimateUsd}` : '—'}</td>
                  </tr>
                ))}
                {!leaderboard.length ? (
                  <tr><td colSpan={5} className="iab-empty">{isEn ? 'The stored run has no per-provider row.' : 'اجرای ذخیره‌شده ردیف ارائه‌دهنده ندارد.'}</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {summary ? (
            <p className="iab-note">
              {isEn
                ? `${summary.passed}/${summary.questions} passed · ${summary.errors} errored · ${fmtNum(summary.totalTokens)} tokens · average ${summary.avgScore}/100.`
                : `${summary.passed}/${summary.questions} قبول · ${summary.errors} خطا · ${fmtNum(summary.totalTokens)} توکن · میانگین ${summary.avgScore}/۱۰۰.`}
            </p>
          ) : null}
          <p className="iab-note iab-note-dim">
            {isEn
              ? 'Score = deterministic rubric (grounding 30 · quality 25 · honesty 20 · safety 15 · attribution 10). A proxy, not ground truth. USD is an estimate table, not a bill.'
              : 'امتیاز = روبریک قطعی (شاهد ۳۰ · کیفیت ۲۵ · صداقت ۲۰ · امنیت ۱۵ · انتساب ۱۰). یک معیار تقریبی است، نه حقیقت مطلق. دلار از جدول تخمین است، نه صورت‌حساب.'}
          </p>
        </section>
      ) : (
        <p className="iab-note" data-testid="iab-no-run">
          {isEn
            ? 'No benchmark has been stored yet. Run the smoke test above or the full suite from the CLI.'
            : 'هنوز بنچمارکی ذخیره نشده است. آزمون سریع بالا یا مجموعهٔ کامل را با CLI اجرا کنید.'}
        </p>
      )}
    </div>
  );
}
