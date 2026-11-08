import { useEffect, useMemo, useState } from "react";
import { getScenarioDailyCloses } from "../../../lib/api";
import { validateScenarioFactors } from "../../../lib/intelligence/scenarioFactors";
import { apiBase } from "../../../lib/apiBase";
import ScenarioEvidence from "./ScenarioEvidence";
import {
  applyJournalCalibration,
  readScenarioJournal,
  writeScenarioJournal,
  updateScenarioJournal,
  scenarioJournalScore,
} from "../../../lib/intelligence/scenarioJournal";
import {
  buildScenarioIntelligence,
  portfolioScenarioBars,
  scenarioCorrelations,
  reverseStress,
  stressScenario,
} from "../../../lib/intelligence/scenario2";
import "../../../styles/scenario-intelligence.css";
import { pollWhileVisible } from '../../../lib/visibilityPoll';

const copy = {
  fa: {
    title: "آزمایشگاه سناریو ۲٫۰",
    sub: "شبیه‌سازی با قیمت‌های پایانی روزانهٔ واقعی؛ بدون ارسال داده کیف پول به مدل",
    token: "توکن",
    portfolio: "پرتفوی",
    hypothetical: "مبنای فرضی توکن؛ نه موجودی کیف پول",
    connect: "برای شبیه‌سازی پرتفوی، کیف پول را متصل کنید.",
    loading: "در حال دریافت تاریخچه قیمت…",
    insufficient:
      "تاریخچه کافی و منظم برای ارزیابی این افق وجود ندارد. احتمال ساختگی نمایش داده نمی‌شود.",
    missing: "داده بازار در دسترس نیست. بعداً دوباره امتحان کنید.",
    horizon: "افق (روز)",
    bars: "روز کامل",
    origin: "آخرین روز کامل",
    coverage: "پوشش ارزش قیمت‌گذاری‌شده",
    model: "عملکرد مدل در آزمون پیش‌رونده",
    samples: "نمونه حل‌شده",
    score: "امتیاز مدل",
    brier: "خطای بریر (کمتر بهتر)",
    accuracy: "دقت طبقه‌بندی",
    calibration: "کالیبراسیون",
    calibrated: "بر اساس نتایج مشابه گذشته",
    pending: "نمونه مشابه کافی نیست؛ احتمال خام",
    bull: "صعودی",
    bear: "نزولی",
    base: "خنثی",
    uncertain: "بازه تغییر ارزش شبیه‌سازی‌شده (دلار)",
    pctLoss: "سهم مسیرهای زیان‌ده در بازپخش",
    conditional: "آزمون چه‌اگر / فشار (بدون احتمال)",
    shock: "شوک هم‌زمان قیمت (%)",
    haircut: "هزینه خروج / لغزش (%)",
    before: "سرمایه مبنا",
    after: "ارزش پس از شوک",
    loss: "تغییر",
    reverse:
      "کمترین شوک قیمتِ آزمایش‌شده برای عبور از آستانه زیان، با حداکثر ۱۰٪ لغزش",
    tolerance: "آستانه زیان قابل‌تحمل (%)",
    actionHigh:
      "این شوک از آستانه شما عبور می‌کند؛ پیش از هر تصمیم، اندازه موقعیت و امکان خروج را بازبینی کنید.",
    actionLow:
      "در این فرض از آستانه عبور نمی‌شود؛ تغییر شرایط و ریسک خارج از مدل را پایش کنید.",
    disclaimer:
      "این اعداد برآورد تجربی‌اند، نه احتمال معتبر بازار یا توصیه خرید/فروش. خوانش زندهٔ اخبار، بازده اوراق و جریان نهنگ‌ها بدون تاریخچهٔ معتبر به احتمال‌ها تزریق نمی‌شود. سود/زیان سناریویی، سود/زیان واقعی کیف پول نیست.",
    replay: "بازپخش تاریخی",
    trend: "روند",
    regime: "رژیم",
    volatile: "پرنوسان",
    range: "خنثی",
    trendRegime: "رونددار",
    refresh: "به‌روزرسانی",
    excluded: "دارایی‌های بدون تاریخچه کافی در شبیه‌سازی لحاظ نشده‌اند.",
    noPortfolio: "برای این پرتفوی دارایی دارای قیمت و تاریخچه کافی یافت نشد.",
    limited: "نتایج فقط برای بخش پوشش‌داده‌شده هستند، نه کل کیف پول.",
    classification: "مرز طبقه‌بندی حرکت",
    modelNote:
      "مدل‌ها تنها با پیش‌بینی‌هایی سنجیده شده‌اند که نتیجه‌شان تا آخرین روز کامل معلوم شده است.",
    interval: "فاصله تقریبی روزها",
    correlations: "همبستگی بازده دارایی‌ها (روزهای هم‌زمان)",
    journal: "ارزیابی پیش‌بینی‌های واقعاً ثبت‌شده روی این دستگاه",
    journalNote:
      "فقط شناسه توکن، افق و احتمال‌ها در مرورگر شما ذخیره می‌شوند؛ نه آدرس کیف پول. نتیجه پس از رسیدن روز آینده ثبت می‌شود.",
    journalCalibrated:
      "احتمال‌های بالا با نتایج ثبت‌شدهٔ همین دستگاه تنظیم شده‌اند.",
    journalPending:
      "برای تنظیم با نتایج واقعی دستگاه، دست‌کم ۲۰ پیش‌بینی حل‌شده لازم است.",
    issued: "ثبت‌شده",
    resolved: "حل‌شده",
    waiting: "در انتظار",
    noStorage: "حافظه محلی در دسترس نیست؛ ثبت انجام نمی‌شود.",
    factors: "اعتبارسنجی چندعاملی بدون نگاه به آینده",
    factorMissing:
      "آرشیو نقطه‌ای هنوز آماده نیست؛ احتمال مدل قیمت‌محور بدون تغییر می‌ماند.",
    factorStorage:
      "برای گردآوری آرشیو مشترک، Upstash Redis در سرور باید پیکربندی شود.",
    factorNoGain:
      "این مدل چندعاملی در دادهٔ خارج از نمونه بهتر از مبنای قیمت‌محور نبود؛ اعمال نشد.",
    factorValidated:
      "رابطهٔ تاریخی خارج از نمونه تأیید شد؛ احتمال شرطیِ جداگانه (نه رابطهٔ علّی)",
    factorSamples: "روزهای ثبت‌شده / نمونه‌های هم‌تراز / آزمون آینده‌نگر",
  },
  en: {
    title: "Scenario Lab 2.0",
    sub: "Historical daily-close simulation; wallet data stays on this device",
    token: "Token",
    portfolio: "Portfolio",
    hypothetical: "Hypothetical token amount, not wallet holdings",
    connect: "Connect a wallet to simulate your portfolio.",
    loading: "Loading price history…",
    insufficient:
      "Not enough regular history to evaluate this horizon. No made-up probabilities are shown.",
    missing: "Market data unavailable. Please try again later.",
    horizon: "Horizon (days)",
    bars: "complete days",
    origin: "Last complete day",
    coverage: "Priced value covered",
    model: "Walk-forward model performance",
    samples: "Resolved samples",
    score: "Model score",
    brier: "Brier error (lower is better)",
    accuracy: "Classification accuracy",
    calibration: "Calibration",
    calibrated: "Adjusted from similar past outcomes",
    pending: "Not enough similar outcomes; raw probabilities",
    bull: "Bull",
    bear: "Bear",
    base: "Neutral",
    uncertain: "Simulated value-change band (USD)",
    pctLoss: "Loss paths in replay",
    conditional: "What-if / stress test (no likelihood)",
    shock: "Uniform price shock (%)",
    haircut: "Exit cost / slippage (%)",
    before: "Starting value",
    after: "Post-shock value",
    loss: "Change",
    reverse:
      "Smallest tested price shock that breaches your loss threshold, allowing up to 10% slippage",
    tolerance: "Personal loss threshold (%)",
    actionHigh:
      "This shock exceeds your threshold. Review position size and exit liquidity before deciding.",
    actionLow:
      "This assumption stays under your threshold. Monitor changing conditions and unmodelled risks.",
    disclaimer:
      "Empirical model estimates, not reliable market odds or investment advice. Live rates, news and whale flows are context only, not trained probability inputs. Scenario P&L is not actual wallet P&L.",
    replay: "Historical replay",
    trend: "Trend",
    regime: "Regime",
    volatile: "Volatile",
    range: "Range",
    trendRegime: "Trending",
    refresh: "Refresh",
    excluded:
      "Assets without sufficient price history are excluded from simulation.",
    noPortfolio: "No priced holding with adequate history was found.",
    limited: "Results cover only the included portion, not the whole wallet.",
    classification: "Move-classification threshold",
    modelNote:
      "Models are scored only against forecasts whose outcomes were known by the latest completed day.",
    interval: "Approximate daily spacing",
    correlations: "Cross-asset return correlation (matched days)",
    journal: "Forecasts actually issued on this device",
    journalNote:
      "Only token id, horizon and probabilities are saved in your browser; never wallet addresses. Outcomes are scored when future completed days arrive.",
    journalCalibrated:
      "Displayed probabilities are adjusted using resolved forecasts on this device.",
    journalPending:
      "At least 20 resolved device forecasts are required for live recalibration.",
    issued: "Issued",
    resolved: "Resolved",
    waiting: "Pending",
    noStorage: "Local storage unavailable; forecasts cannot be recorded.",
    factors: "Leakage-safe multi-factor validation",
    factorMissing:
      "The point-in-time archive is not ready; price-only probabilities remain unchanged.",
    factorStorage:
      "Configure Upstash Redis on the server to collect a shared archive.",
    factorNoGain:
      "The factor model did not beat the price-only baseline out of sample, so it was not applied.",
    factorValidated:
      "Held-out association validated; separate conditional odds (not causation)",
    factorSamples: "Archived days / aligned samples / forward-held-out",
  },
};
const money = (v, locale) =>
  new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(v);
const num = (v, locale) =>
  new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", {
    maximumFractionDigits: 1,
  }).format(v);
const date = (v, locale) =>
  new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", {
    dateStyle: "medium",
  }).format(v);

export default function ScenarioTab({
  locale = "en",
  markets = [],
  tokenId = "bitcoin",
  updatedAt = null,
  connected = false,
  holdings = [],
}) {
  const L = copy[locale === "fa" ? "fa" : "en"];
  const [mode, setMode] = useState("token");
  const [selected, setSelected] = useState(tokenId);
  const [horizon, setHorizon] = useState(3);
  const [shock, setShock] = useState(-25);
  const [haircut, setHaircut] = useState(2);
  const [lossTarget, setLossTarget] = useState(30);
  const [epoch, setEpoch] = useState(0);
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [history, setHistory] = useState({ status: "UNAVAILABLE", rows: [] });
  const [journalEntries, setJournalEntries] = useState([]);
  const [journalAvailable, setJournalAvailable] = useState(true);
  const [data, setData] = useState({
    loading: true,
    assets: {},
    tokenBars: [],
    error: false,
  });
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    setContextLoading(true);
    fetch(`${apiBase()}/scenario/context`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then((r) => {
        if (!r.ok) throw new Error("CONTEXT_UNAVAILABLE");
        return r.json();
      })
      .then((body) => {
        if (!controller.signal.aborted) setContext(body);
      })
      .catch(() => {
        if (!controller.signal.aborted) setContext(null);
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!controller.signal.aborted) setContextLoading(false);
      });
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [epoch]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase()}/scenario/history`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then((r) => {
        if (!r.ok) throw new Error("ARCHIVE_UNAVAILABLE");
        return r.json();
      })
      .then((body) => {
        if (!controller.signal.aborted)
          setHistory(
            body?.schema === "fbt.scenario-evidence.v1"
              ? body
              : { status: "UNAVAILABLE", rows: [] },
          );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setHistory({ status: "UNAVAILABLE", rows: [] });
      });
    return () => controller.abort();
  }, [epoch]);
  const candidates = useMemo(() => {
    // Only priced rows; same-symbol holdings across chains are combined. Four
    // largest quotes bound the number of daily-close calls. Coverage remains visible.
    const byId = new Map();
    for (const row of holdings) {
      const id =
        row.coingeckoId ||
        markets.find(
          (m) =>
            String(m.symbol).toLowerCase() === String(row.symbol).toLowerCase(),
        )?.id;
      const value = Number(row.value);
      if (!id || !Number.isFinite(value) || value <= 0) continue;
      byId.set(id, (byId.get(id) || 0) + value);
    }
    return [...byId]
      .map(([id, valueUsd]) => ({ id, valueUsd }))
      .sort((a, b) => b.valueUsd - a.valueUsd);
  }, [holdings, markets]);
  const selectedHoldings = candidates.slice(0, 4);
  const assetKey = selectedHoldings.map((x) => x.id).join("|");
  useEffect(() => {
    /* Forces a re-price every two minutes. On a hidden tab that is pure CPU
       with no reader: the returning tick recomputes immediately anyway. */
    return pollWhileVisible(() => setEpoch((x) => x + 1), 120000);
  }, []);
  useEffect(() => {
    if (mode === "portfolio" && !connected) {
      setData({ loading: false, assets: {}, tokenBars: [], error: false });
      return;
    }
    let cancelled = false;
    setData((prev) => ({ ...prev, loading: true, error: false }));
    const ids =
      mode === "token" ? [selected] : selectedHoldings.map((h) => h.id);
    Promise.allSettled(ids.map((id) => getScenarioDailyCloses(id))).then(
      (results) => {
        if (cancelled) return;
        const assets = Object.fromEntries(
          results.map((r, i) => [
            ids[i],
            r.status === "fulfilled" ? r.value : [],
          ]),
        );
        setData({
          loading: false,
          assets,
          tokenBars: assets[selected] || [],
          error: results.some((r) => r.status === "rejected"),
        });
      },
    );
    return () => {
      cancelled = true;
    };
    // assetKey captures the actual set of fetched symbols, not every price tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selected, connected, assetKey, epoch]);
  const portfolio = useMemo(
    () => portfolioScenarioBars(data.assets, candidates),
    [data.assets, candidates],
  );
  const correlations = useMemo(
    () => scenarioCorrelations(data.assets, portfolio.included),
    [data.assets, portfolio.included],
  );
  const coveredValue = selectedHoldings
    .filter((h) => portfolio.included.includes(h.id))
    .reduce((s, h) => s + h.valueUsd, 0);
  const value = mode === "token" ? 1000 : coveredValue;
  const result = useMemo(
    () =>
      buildScenarioIntelligence({
        bars: mode === "token" ? data.tokenBars : portfolio.bars,
        horizon,
        notionalUsd: value,
      }),
    [mode, data.tokenBars, portfolio.bars, horizon, value],
  );
  useEffect(() => {
    if (mode !== "token" || data.loading || !result.ok) return;
    try {
      const storage = window.localStorage;
      const { entries } = updateScenarioJournal(readScenarioJournal(storage), {
        asset: selected,
        bars: data.tokenBars,
        result,
      });
      setJournalEntries(entries);
      setJournalAvailable(writeScenarioJournal(storage, entries));
    } catch {
      setJournalAvailable(false);
    }
  }, [mode, selected, data.loading, data.tokenBars, result]);
  const displayResult =
    mode === "token" && journalAvailable
      ? applyJournalCalibration(result, journalEntries, selected)
      : result;
  const journalScore =
    mode === "token"
      ? scenarioJournalScore(journalEntries, selected, horizon)
      : null;
  const factorRead = useMemo(
    () =>
      validateScenarioFactors({
        bars: mode === "token" ? data.tokenBars : portfolio.bars,
        horizon,
        history: history.status === "OK" ? history.rows : [],
      }),
    [mode, data.tokenBars, portfolio.bars, horizon, history],
  );
  const whatIf = stressScenario({
    valueUsd: value,
    shockPct: shock,
    exitHaircutPct: haircut,
  });
  const reverse = reverseStress(value, lossTarget);
  return (
    <div className="sci" data-testid="scenario-lab">
      <div className="sci-hero">
        <div>
          <span className="sci-kicker">FBT / SCENARIO INTELLIGENCE</span>
          <h2>{L.title}</h2>
          <p>{L.sub}</p>
        </div>
        <button
          type="button"
          className="sci-refresh"
          onClick={() => setEpoch((x) => x + 1)}
        >
          {L.refresh} ↻
        </button>
      </div>
      <div className="sci-controls">
        <div className="sci-toggle" role="group" aria-label={L.title}>
          <button
            type="button"
            className={mode === "token" ? "active" : ""}
            onClick={() => setMode("token")}
          >
            {L.token}
          </button>
          <button
            type="button"
            className={mode === "portfolio" ? "active" : ""}
            onClick={() => setMode("portfolio")}
          >
            {L.portfolio}
          </button>
        </div>
        {mode === "token" && (
          <label>
            {L.token}
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              {!markets.some((m) => m.id === selected) && (
                <option value={selected}>{selected}</option>
              )}
              {markets
                .filter((m) => m.id)
                .slice(0, 100)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.symbol}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label>
          {L.horizon}
          <select
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
          >
            {[1, 3, 7, 14].map((h) => (
              <option key={h} value={h}>
                {h} {L.bars}
              </option>
            ))}
          </select>
        </label>
      </div>
      {mode === "portfolio" && !connected ? (
        <div className="sci-empty">{L.connect}</div>
      ) : (
        <>
          {mode === "token" && (
            <p className="sci-muted">
              {L.hypothetical}: {money(1000, locale)}
            </p>
          )}
          {mode === "portfolio" && (
            <div className="sci-coverage">
              {L.coverage}: <b>{num(portfolio.coveragePct, locale)}%</b> ·{" "}
              {portfolio.included.join(", ") || L.noPortfolio}
              {portfolio.coveragePct < 100 && (
                <p>
                  {L.limited} {L.excluded}
                </p>
              )}
            </div>
          )}
          {data.loading ? (
            <div className="sci-empty" role="status">
              {L.loading}
            </div>
          ) : !result.ok ? (
            <div className="sci-empty" role="status">
              {data.error ? L.missing : L.insufficient}
            </div>
          ) : (
            <>
              <div className="sci-meta">
                <span>
                  {L.origin}: <b>{date(result.asOf, locale)}</b>
                </span>
                <span>
                  {L.interval}:{" "}
                  <b>{num(result.intervalMs / 3600000, locale)}h</b>
                </span>
                <span>
                  {L.regime}:{" "}
                  <b>
                    {
                      L[
                        result.regime === "trend"
                          ? "trendRegime"
                          : result.regime
                      ]
                    }
                  </b>
                </span>
                <span>
                  {L.classification}:{" "}
                  <b>±{num(result.thresholdPct, locale)}%</b>
                </span>
              </div>
              <div className="sci-cases">
                {["bull", "base", "bear"].map((k) => (
                  <article key={k} className={`sci-case sci-${k}`}>
                    <div>
                      <span>{L[k]}</span>
                      <strong>
                        {num(displayResult.probabilities[k], locale)}%
                      </strong>
                    </div>
                    <div className="sci-meter">
                      <i
                        style={{ width: `${displayResult.probabilities[k]}%` }}
                      />
                    </div>
                  </article>
                ))}
              </div>
              {mode === "token" && displayResult.liveCalibration?.applied && (
                <p className="sci-muted">
                  {L.journalCalibrated} (n=
                  {displayResult.liveCalibration.samples})
                </p>
              )}
              <div className="sci-grid">
                <section className="sci-card">
                  <h3>{L.uncertain}</h3>
                  <p className="sci-muted">
                    {L.before}: {money(value, locale)} · {L.pctLoss}:{" "}
                    {num(result.probabilityOfLossPct, locale)}%
                  </p>
                  <div className="sci-band">
                    <span>
                      {" "}
                      P5 <b>{money(result.uncertaintyUsd.p5, locale)}</b>
                    </span>
                    <span>
                      P50 <b>{money(result.uncertaintyUsd.p50, locale)}</b>
                    </span>
                    <span>
                      P95 <b>{money(result.uncertaintyUsd.p95, locale)}</b>
                    </span>
                  </div>
                  <div className="sci-band-line">
                    <i />
                  </div>
                </section>
                <section className="sci-card">
                  <h3>{L.model}</h3>
                  <p className="sci-muted">{L.modelNote}</p>
                  {["trend", "replay"].map((k) => (
                    <div key={k} className="sci-model">
                      <b>{L[k]}</b>
                      <span>
                        {L.score}: {num(result.performance[k].score, locale)}
                        /100
                      </span>
                      <span>
                        {L.brier}: {num(result.performance[k].brier, locale)}
                      </span>
                      <span>
                        {L.samples}:{" "}
                        {num(result.performance[k].samples, locale)}
                      </span>
                      <span>
                        {L.accuracy}:{" "}
                        {num(result.performance[k].accuracyPct, locale)}%
                      </span>
                      <small>
                        {L.calibration}:{" "}
                        {result.calibration[k].calibrated
                          ? L.calibrated
                          : L.pending}{" "}
                        ({result.calibration[k].samples})
                      </small>
                    </div>
                  ))}
                </section>
              </div>
            </>
          )}
          {mode === "token" && result.ok && (
            <section className="sci-card sci-journal">
              <h3>{L.journal}</h3>
              <p className="sci-muted">{L.journalNote}</p>
              {journalAvailable ? (
                <>
                  <div className="sci-model">
                    <span>
                      {L.issued}: {journalScore.issued}
                    </span>
                    <span>
                      {L.resolved}: {journalScore.resolved}
                    </span>
                    <span>
                      {L.waiting}: {journalScore.pending}
                    </span>
                    <span>
                      {L.brier}: {journalScore.brier ?? "—"}
                    </span>
                    <span>
                      {L.accuracy}:{" "}
                      {journalScore.accuracyPct == null
                        ? "—"
                        : `${journalScore.accuracyPct}%`}
                    </span>
                  </div>
                  <p className="sci-muted">
                    {!displayResult.liveCalibration?.applied &&
                      L.journalPending}
                  </p>
                </>
              ) : (
                <p className="sci-muted">{L.noStorage}</p>
              )}
            </section>
          )}
          {mode === "portfolio" && correlations.length > 0 && (
            <section className="sci-card sci-stress">
              <h3>{L.correlations}</h3>
              {correlations.map((r) => (
                <div className="sci-model" key={`${r.a}:${r.b}`}>
                  {r.a} / {r.b}: <b>{num(r.correlation, locale)}</b> · n=
                  {r.samples}
                </div>
              ))}
            </section>
          )}
          {value > 0 && (
            <section className="sci-card sci-stress">
              <h3>{L.conditional}</h3>
              <div className="sci-stress-controls">
                <label>
                  {L.shock}
                  <input
                    type="number"
                    min="-95"
                    max="300"
                    value={shock}
                    onChange={(e) => setShock(Number(e.target.value))}
                  />
                </label>
                <label>
                  {L.haircut}
                  <input
                    type="number"
                    min="0"
                    max="50"
                    value={haircut}
                    onChange={(e) => setHaircut(Number(e.target.value))}
                  />
                </label>
                <label>
                  {L.tolerance}
                  <input
                    type="number"
                    min="1"
                    max="99"
                    value={lossTarget}
                    onChange={(e) => setLossTarget(Number(e.target.value))}
                  />
                </label>
              </div>
              {whatIf && (
                <div className="sci-impact">
                  <span>
                    {L.before} <b>{money(whatIf.beforeUsd, locale)}</b>
                  </span>
                  <span>
                    {L.after} <b>{money(whatIf.afterUsd, locale)}</b>
                  </span>
                  <span>
                    {L.loss} <b>{money(whatIf.deltaUsd, locale)}</b>
                  </span>
                </div>
              )}
              {whatIf && lossTarget > 0 && lossTarget < 100 && (
                <p className="sci-muted" role="status">
                  {(-whatIf.deltaUsd / value) * 100 >= lossTarget
                    ? L.actionHigh
                    : L.actionLow}
                </p>
              )}
              {reverse && (
                <p className="sci-muted">
                  {L.reverse}: {reverse.shockPct}% + {reverse.exitHaircutPct}%
                </p>
              )}
            </section>
          )}
        </>
      )}
      <section className="sci-card sci-factors" aria-label={L.factors}>
        <h3>{L.factors}</h3>
        <p className="sci-muted">
          {history.status === "NOT_CONFIGURED"
            ? L.factorStorage
            : factorRead.status === "NOT_VALIDATED"
              ? L.factorNoGain
              : factorRead.validated
                ? L.factorValidated
                : L.factorMissing}
        </p>
        <p className="sci-muted">
          {L.factorSamples}: {history.availableDays ?? 0} /{" "}
          {factorRead.aligned ?? 0} / {factorRead.heldOut ?? 0}
        </p>
        {factorRead.validated && (
          <div className="sci-cases">
            {["bull", "base", "bear"].map((k) => (
              <article className={`sci-case sci-${k}`} key={k}>
                <div>
                  <span>{L[k]}</span>
                  <strong>{num(factorRead.probabilities[k], locale)}%</strong>
                </div>
                <div className="sci-meter">
                  <i style={{ width: `${factorRead.probabilities[k]}%` }} />
                </div>
              </article>
            ))}
          </div>
        )}
        {factorRead.heldOut > 0 && factorRead.baselineBrier != null && (
          <p className="sci-muted">
            Brier: {factorRead.baselineBrier} → {factorRead.conditionalBrier} ·
            Δ {factorRead.improvement} · lower bound {factorRead.lowerBound}
          </p>
        )}
      </section>
      <ScenarioEvidence
        context={context}
        markets={markets}
        updatedAt={updatedAt}
        locale={locale}
        loading={contextLoading}
        onUseBtcShock={setShock}
      />
      <p className="sci-disclaimer">{L.disclaimer}</p>
    </div>
  );
}
