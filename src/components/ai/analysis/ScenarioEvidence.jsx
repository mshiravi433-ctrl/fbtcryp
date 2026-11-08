import { useMemo } from "react";
import { SCENARIO_CONTEXT_SCHEMA } from "../../../lib/intelligence/scenarioContext.js";

const labels = {
  fa: {
    title: "خوانش زندهٔ محرک‌ها",
    note: "این داده‌های نقطه‌ای برای بررسی فرض‌ها هستند؛ بدون تاریخچهٔ هم‌زمان و اعتبارسنجی، احتمال‌های مدل را تغییر نمی‌دهند.",
    unknown: "منبع معتبر/تازه در دسترس نیست",
    btc: "حرکت ۲۴ساعته بیت‌کوین",
    use: "آزمایش شوک برابر با حرکت BTC",
    yield: "بازده اوراق ۱۰ساله آمریکا",
    effr: "نرخ مؤثر وجوه فدرال (نه نرخ هدف)",
    dollar: "شاخص دلار",
    stable: "تغییر عرضه استیبل‌کوین‌ها در ۲۴ ساعت",
    whale: "خالص واریز به آدرس‌های برچسب‌دار صرافی",
    news: "تیترهای تازه (بدون تحلیل احساسات)",
    caution:
      "افزایش هم‌زمان فشار در داده‌های خوانده‌شده؛ آستانه زیان و نقدشوندگی را بازبینی کنید.",
    coverage: "پوشش پنجره",
    sources: "منبع",
    missingPolicy:
      "نرخ سیاستی، عمق دفتر سفارش و تاریخچهٔ تراز شدهٔ خبر/نهنگ برای این مدل متصل نیستند.",
  },
  en: {
    title: "Live driver readings",
    note: "Point-in-time evidence to test assumptions; without aligned history and validation it does not change model probabilities.",
    unknown: "No fresh, verified source",
    btc: "Bitcoin 24h move",
    use: "Test a shock equal to BTC move",
    yield: "US 10-year Treasury yield",
    effr: "Effective Fed funds rate (not the target range)",
    dollar: "Dollar index",
    stable: "24h stablecoin supply change",
    whale: "Net deposits to labelled exchange wallets",
    news: "Recent headlines (no sentiment inference)",
    caution:
      "Multiple observed risk pressures coincide. Review your loss threshold and exit liquidity.",
    coverage: "Window coverage",
    sources: "Source",
    missingPolicy:
      "Policy rate, order-book depth and aligned historical news/whale series are not connected to this model.",
  },
};
const signed = (value, locale, suffix = "") =>
  `${value > 0 ? "+" : ""}${new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
const formatUsd = (n, locale) =>
  new Intl.NumberFormat(locale === "fa" ? "fa-IR" : "en-US", {
    notation: "compact",
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 1,
  }).format(n);
function EvidenceRow({ label, value, source, at, locale, children, detail }) {
  return (
    <div className="sci-evidence-row">
      <span>{label}</span>
      <div>
        {value == null ? (
          <em>{labels[locale].unknown}</em>
        ) : (
          <>
            <strong>{value}</strong>
            {detail && <small>{detail}</small>}
            <small>
              {source || "—"}
              {at
                ? ` · ${new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(at)}`
                : ""}
            </small>
            {children}
          </>
        )}
      </div>
    </div>
  );
}
export default function ScenarioEvidence({
  context,
  markets = [],
  updatedAt,
  locale = "en",
  loading = false,
  onUseBtcShock,
}) {
  const L = labels[locale === "fa" ? "fa" : "en"];
  const btc = useMemo(() => markets.find((m) => m.id === "bitcoin"), [markets]);
  const btcFresh =
    Number.isFinite(btc?.change24h) &&
    btc?.dataProvenance === "live" &&
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt >= 0 &&
    Date.now() - updatedAt < 180_000;
  const valid = context?.schema === SCENARIO_CONTEXT_SCHEMA;
  const q = valid ? context.quotes || {} : {};
  const stable =
    valid && context.stablecoin?.status === "OK" ? context.stablecoin : null;
  const exchange =
    valid && context.exchange?.status === "OK" ? context.exchange : null;
  const news =
    valid && context.headlines?.status === "OK" ? context.headlines.items : [];
  const pressure = [
    btcFresh && btc.change24h <= -3,
    stable && stable.net24hUsd < 0,
    exchange && exchange.netToExchangeUsd > 0,
  ].filter(Boolean).length;
  return (
    <section className="sci-card sci-evidence" aria-label={L.title}>
      <h3>
        {L.title}
        {loading && (
          <span className="sci-loading-dot" aria-label="loading">
            {" "}
            ···
          </span>
        )}
      </h3>
      <p className="sci-muted">{L.note}</p>
      <div className="sci-evidence-grid">
        <EvidenceRow
          label={L.btc}
          value={btcFresh ? signed(btc.change24h, locale, "%") : null}
          source={btc?.marketProvider || "FBT market API"}
          at={btcFresh ? updatedAt : null}
          locale={locale}
        >
          <button
            type="button"
            className="sci-evidence-action"
            onClick={() =>
              onUseBtcShock?.(
                Math.max(-95, Math.min(300, Number(btc.change24h))),
              )
            }
          >
            {L.use}
          </button>
        </EvidenceRow>
        <EvidenceRow
          label={L.effr}
          value={q.EFFR?.status === "OK" ? signed(q.EFFR.value, locale, "%") : null}
          source={q.EFFR?.source}
          at={q.EFFR?.at}
          locale={locale}
        />
        <EvidenceRow
          label={L.yield}
          value={
            q.US10Y?.status === "OK" ? signed(q.US10Y.value, locale, "%") : null
          }
          source={q.US10Y?.source}
          at={q.US10Y?.at}
          locale={locale}
        />
        <EvidenceRow
          label={L.dollar}
          value={q.DXY?.status === "OK" ? signed(q.DXY.value, locale) : null}
          source={q.DXY?.source}
          at={q.DXY?.at}
          locale={locale}
        />
        <EvidenceRow
          label={L.stable}
          value={stable ? formatUsd(stable.net24hUsd, locale) : null}
          source={stable?.source}
          at={stable?.at}
          locale={locale}
        />
        <EvidenceRow
          label={L.whale}
          value={exchange ? formatUsd(exchange.netToExchangeUsd, locale) : null}
          source={exchange?.source}
          at={exchange?.at}
          detail={
            exchange
              ? `${L.coverage}: ${signed(exchange.coverage * 100, locale, "%")} · ${exchange.events}`
              : null
          }
          locale={locale}
        />
      </div>
      {pressure >= 2 && (
        <p className="sci-evidence-caution" role="status">
          {L.caution}
        </p>
      )}
      <h4>{L.news}</h4>
      {news.length ? (
        <ul className="sci-headlines">
          {news.map((item, i) => (
            <li key={`${item.at}-${i}`}>
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title}
                </a>
              ) : (
                item.title
              )}
              <small>{item.source}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sci-muted">{L.unknown}</p>
      )}
      <p className="sci-muted">{L.missingPolicy}</p>
    </section>
  );
}
