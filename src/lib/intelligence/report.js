/**
 * FBT AI INTELLIGENCE — DAILY REPORT COMPOSER
 * ---------------------------------------------------------------------------
 * Builds the report that used to be a paragraph someone wrote by hand: market
 * state, movers, unusual volume, candidates, risks, and what to watch — every
 * line derived from the same payload the screen shows, stamped with its source
 * and the number of tokens it was computed on.
 *
 * The "watch" section is conditions, not predictions: "if the advance/decline
 * ratio falls back under 40%, today's label no longer describes the tape".
 * That is the only honest shape for a 24-hour outlook without a validated
 * forecasting model behind it.
 */
import { fmtMoney, fmtPct, fmtTimeAgo, t } from './copy.js';
import { marketNarrative, reasonText } from './narrative.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const line = (label, value) => (value == null || value === '' ? null : `${label}: ${value}`);

export function buildDailyReport({ pulse, scan, locale = 'fa', now = Date.now(), sourceLabel = 'CoinGecko / FBT API' } = {}) {
  const sections = [];
  const nav = marketNarrative(pulse, locale);

  /* 1 ─ Market */
  sections.push({
    id: 'market',
    title: t(locale, 'report.section.market'),
    lines: pulse && isNum(pulse.regime?.score)
      ? [...nav.lines]
      : [t(locale, 'page.insufficient')]
  });

  /* 2 ─ Movers */
  const movers = pulse?.movers;
  const moverLines = [];
  if (movers?.gainers?.length) {
    moverLines.push(`${t(locale, 'movers.gainers')}: ${movers.gainers.slice(0, 5).map((c) => `${c.symbol} ${fmtPct(c.change24h)}`).join(' · ')}`);
  }
  if (movers?.losers?.length) {
    moverLines.push(`${t(locale, 'movers.losers')}: ${movers.losers.slice(0, 5).map((c) => `${c.symbol} ${fmtPct(c.change24h)}`).join(' · ')}`);
  }
  sections.push({
    id: 'movers',
    title: t(locale, 'report.section.movers'),
    lines: moverLines.length ? moverLines : [t(locale, 'movers.empty')]
  });

  /* 3 ─ Volume */
  const surges = pulse?.volumeSurges?.rows ?? [];
  sections.push({
    id: 'volume',
    title: t(locale, 'report.section.volume'),
    lines: surges.length
      ? surges.slice(0, 5).map((s) => `${s.symbol} — ${t(locale, 'opp.reason.turnover-vs-median', { ratio: s.surgeRatio.toFixed(1) })}`)
      : [t(locale, 'movers.empty')]
  });

  /* 4 ─ Opportunities */
  const opps = scan?.opportunities ?? [];
  const oppLines = opps.slice(0, 5).map((o) => {
    const reasons = (o.reasons || []).map((r) => reasonText(locale, r)).join(' · ');
    return `${o.coin.symbol} — ${t(locale, `opp.kind.${o.kind}`)} (${t(locale, 'opp.confidence')} ${o.confidence}) · ${reasons}`;
  });
  sections.push({
    id: 'opportunities',
    title: t(locale, 'report.section.opportunities'),
    lines: oppLines.length ? oppLines : [t(locale, 'opp.empty')],
    footnote: t(locale, 'page.notAdvice')
  });

  /* 5 ─ Risks */
  const riskLines = [];
  const distribution = opps.filter((o) => o.kind === 'distribution');
  if (distribution.length) {
    riskLines.push(`${t(locale, 'opp.kind.distribution')}: ${distribution.slice(0, 4).map((o) => o.coin.symbol).join(' · ')}`);
  }
  if (isNum(pulse?.volatility?.medianSwingPct) && pulse.volatility.label !== 'low') {
    riskLines.push(`${t(locale, 'kpi.volatility')}: ${pulse.volatility.medianSwingPct.toFixed(2)}% (${t(locale, `vol.${pulse.volatility.label}`)})`);
  }
  if (pulse?.coveragePct != null && pulse.coveragePct < 80) {
    riskLines.push(t(locale, 'page.rowsCounted', { counted: pulse.breadth.counted, total: pulse.breadth.total }));
  }
  if (pulse?.unavailable?.length) {
    riskLines.push(`${t(locale, 'unavailable.title')}: ${pulse.unavailable.map((k) => t(locale, `unavailable.${k}`)).join('، ')}`);
  }
  sections.push({
    id: 'risks',
    title: t(locale, 'report.section.risks'),
    lines: riskLines.length ? riskLines : [t(locale, 'page.insufficient')]
  });

  /* 6 ─ Watch — conditions, not predictions. */
  const watch = [];
  if (isNum(pulse?.breadth?.advRatio)) {
    watch.push(`${t(locale, 'kpi.breadth')}: ${Math.round(pulse.breadth.advRatio * 100)}% — ${t(locale, 'market.why')} ${t(locale, `regime.${pulse.regime.label}`)}`);
  }
  if (isNum(pulse?.totals?.btcDominance)) {
    watch.push(`${t(locale, 'kpi.btcDominance')}: ${pulse.totals.btcDominance.toFixed(1)}%`);
  }
  if (isNum(pulse?.totals?.turnoverPct)) {
    watch.push(`${t(locale, 'kpi.turnover')}: ${pulse.totals.turnoverPct.toFixed(2)}%`);
  }
  sections.push({ id: 'watch', title: t(locale, 'report.section.watch'), lines: watch.length ? watch : [t(locale, 'page.insufficient')] });

  const sourceLine = t(locale, 'report.sourceLine', {
    source: sourceLabel,
    counted: pulse?.breadth?.counted ?? 0,
    total: pulse?.breadth?.total ?? 0,
    time: fmtTimeAgo(pulse?.updatedAt, locale)
  });

  const text = [
    `${t(locale, 'report.title')} — ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    sourceLine,
    '',
    ...sections.flatMap((s) => [`## ${s.title}`, ...s.lines.map((l) => `- ${l}`), ...(s.footnote ? [`(${s.footnote})`] : []), ''])
  ].join('\n');

  return {
    title: t(locale, 'report.title'),
    generatedAt: now,
    provenance: pulse?.provenance ?? 'unknown',
    sourceLine,
    sections,
    text,
    marketCapLine: line(t(locale, 'kpi.marketCap'), isNum(pulse?.totals?.mcap) ? fmtMoney(pulse.totals.mcap, locale) : null)
  };
}

export function reportFileName(now = Date.now()) {
  return `fbt-ai-report-${new Date(now).toISOString().slice(0, 10)}.txt`;
}
