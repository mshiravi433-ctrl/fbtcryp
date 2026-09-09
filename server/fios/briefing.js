/**
 * FBT FINANCIAL INTELLIGENCE OS — Proactive AI Briefing (Phase 211).
 * ---------------------------------------------------------------------------
 * Phase 210's chain answers when the user asks. The briefing is the OTHER
 * half of proactive AI: what the OS believes the owner needs to know BEFORE
 * they ask, assembled from what was actually read this pass —
 *
 *   the owner's money     financial state (drawdown, concentration, pnl)
 *   the guardian          warnings, emergencies, stop-gates that already fired
 *   the goals             progress vs target date
 *   the world's money     global intelligence: smart money, whales, macro,
 *                         news, on-chain, stocks/forex/commodities/RWA
 *   the cross-asset view  regime, co-movement, divergences
 *   the learning loop     calibration — is the machine's aim any good?
 *
 * Every item is { id, kind, priority, title, detail, evidence, action, source,
 * at, confidence } and every item cites the domain it came from. An input that
 * was not supplied produces NO item — a briefing without the portfolio is
 * honest about it (a `missing` list), it never writes "portfolio is fine".
 *
 * PRIORITIES
 *   critical — money is at risk right now (guardian emergency, liquidation)
 *   high     — material change the owner should see today
 *   normal   — the day's real signals
 *   info     — context (regime, calibration, coverage)
 *
 * The briefing is a RECOMMENDATION to read, nothing more: it holds no
 * execution permission, and its `action` fields are navigation hints
 * («open /portfolio»), never transactions (§50).
 */
import { randomUUID } from 'node:crypto';
import { round } from '../../src/lib/central/schema.js';
import { crossAssetDigest } from './crossAsset.js';

export const BRIEFING_SCHEMA = 'fbt.fi.briefing.v1';

/** How long a briefing stays fresh before the next request rebuilds it. */
export const BRIEFING_TTL_MS = 5 * 60_000;
const MAX_ITEMS = 24;

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const unwrap = (node) => (node && typeof node === 'object' && node.schema === 'fbt.fi.provenance.v1' && 'value' in node ? node.value : node);

let seq = 0;
const itemId = (kind) => `br_${String(Date.now().toString(36))}${(seq += 1).toString(36)}_${kind}`;

/* ── Persian rendering ────────────────────────────────────────────────────
 * Every briefing item carries `titleFa`/`detailFa` next to its canonical
 * English `title`/`detail`, and the panel shows the Persian pair when the UI
 * language is Persian. Numbers are shared — only the sentence is translated.
 * Dynamic upstream reasons (guardian codes, raw headlines) keep their
 * original language inside the Persian sentence rather than being dropped. */
const FA_FLOW = Object.freeze({
  dex_buy: 'خرید در صرافی غیرمتمرکز', dex_sell: 'فروش در صرافی غیرمتمرکز',
  cex_in: 'ورود به صرافی متمرکز', cex_out: 'خروج از صرافی متمرکز',
  transfer: 'انتقال', mint: 'ضرب', burn: 'سوزاندن',
  accumulation: 'انباشت', distribution: 'توزیع', flow: 'جریان'
});
const faFlow = (f) => FA_FLOW[String(f || '').toLowerCase()] || String(f || 'انتقال');
const FA_MACRO_TOPIC = Object.freeze({
  FED: 'فدرال‌رزرو', RATES: 'نرخ بهره', INFLATION: 'تورم', GROWTH: 'رشد اقتصادی',
  ECB: 'بانک مرکزی اروپا', GEOPOLITICS: 'ژئوپلیتیک', CRYPTO_POLICY: 'قانون‌گذاری رمزارز',
  POLITICS: 'سیاست', CURRENCIES: 'ارز و سیاست پولی'
});
const faTopic = (t) => FA_MACRO_TOPIC[String(t || '').toUpperCase()] || String(t || '');
const FA_REGIME = Object.freeze({
  RISK_ON: 'ریسک‌پذیر', RISK_ON_LEANING: 'متمایل به ریسک‌پذیری', MIXED: 'ترکیبی',
  RISK_OFF_LEANING: 'متمایل به احتیاط', RISK_OFF: 'ریسک‌گریز'
});
const FA_OUTLOOK = Object.freeze({
  GROWTH_WATCH: 'چشم‌انداز رشد', RECESSION_WATCH: 'هشدار رکود',
  MIXED_SIGNALS: 'سیگنال‌های مختلط', UNAVAILABLE: 'دادهٔ کافی نیست'
});
const faOutlook = (l) => FA_OUTLOOK[String(l || '').toUpperCase()] || 'ترکیبی';
const faRegime = (r) => FA_REGIME[String(r || '').toUpperCase()] || 'ترکیبی';
const FA_CLASS = Object.freeze({
  crypto: 'رمزارز', stocks: 'سهام', forex: 'فارکس', commodities: 'کالاها', rwa: 'دارایی واقعی'
});
const faClass = (c) => FA_CLASS[String(c || '').toLowerCase()] || String(c || '');

/**
 * Build the briefing items from real inputs. Pure — the engine wraps it with
 * persistence + freshness. Every input is optional; a missing input yields no
 * item for its section and a `missing[]` entry instead.
 */
export function buildBriefingItems({
  financial = null, world = null, globalIntel = null, crossAsset = null,
  guardian = null, learning = null, preferences = null, now = Date.now()
} = {}) {
  const items = [];
  const missing = [];
  const push = (item) => items.push({ confidence: 0.6, ...item });

  /* ── guardian first: an emergency outranks everything ─────────────────── */
  if (guardian && typeof guardian === 'object') {
    const emergencies = guardian.policies?.emergencies || [];
    for (const e of emergencies.slice(0, 3)) {
      push({
        id: itemId('guardian'), kind: 'guardian', priority: 'critical',
        title: 'A policy is in emergency stop',
        titleFa: 'یک سیاست در توقف اضطراری است',
        detail: String(e.reason || 'the guardian stopped a policy').slice(0, 200),
        detailFa: e.reason ? `نگهبان یک سیاست را متوقف کرد — ${String(e.reason).slice(0, 160)}` : 'نگهبان یک سیاست را متوقف کرد',
        evidence: [{ source: 'guardian:policies', at: num(e.at) || now }],
        action: { type: 'navigate', to: '/intent' },
        source: 'guardian', at: num(e.at) || now, confidence: 0.95
      });
    }
    const alerts = Array.isArray(guardian.recentAlerts) ? guardian.recentAlerts : [];
    for (const a of alerts.slice(0, 3)) {
      const alertTitle = String(a.title || a.code || 'guardian alert').slice(0, 120);
      const alertDetail = String(a.detail || a.reason || '').slice(0, 200) || null;
      push({
        id: itemId('guardian'), kind: 'guardian', priority: a.severity === 'HIGH' ? 'high' : 'normal',
        title: alertTitle,
        titleFa: `هشدار نگهبان: ${alertTitle}`,
        detail: alertDetail,
        detailFa: alertDetail,
        evidence: [{ source: 'guardian:alerts', at: num(a.at) || now }],
        action: { type: 'navigate', to: '/portfolio' },
        source: 'guardian', at: num(a.at) || now, confidence: 0.8
      });
    }
  } else {
    missing.push('guardian');
  }

  /* ── the owner's money ────────────────────────────────────────────────── */
  if (financial && financial.status !== 'UNAVAILABLE') {
    const perf = financial.performance || {};
    const drawdown = num(perf.drawdownPct);
    if (drawdown !== null && drawdown <= -15) {
      push({
        id: itemId('portfolio'), kind: 'portfolio', priority: 'high',
        title: `Portfolio is ${Math.abs(drawdown).toFixed(1)}% below its peak`,
        titleFa: `پرتفوی ${Math.abs(drawdown).toFixed(1)}٪ پایین‌تر از سقف خود است`,
        detail: 'drawdown measured from the portfolio engine\'s peak value — the guardian baseline carries the same number',
        detailFa: 'افت از سقف ارزش پرتفوی اندازه‌گیری شده — مبنای نگهبان هم همین عدد را دارد',
        evidence: [{ source: 'financial-state:performance', at: financial.at }],
        action: { type: 'navigate', to: '/portfolio' },
        source: 'financial-state', at: financial.at, confidence: 0.9
      });
    }
    const risk = financial.risk || {};
    const concentration = unwrap(risk.concentration);
    const topShare = num(concentration?.topPositionPct ?? concentration?.topPct);
    if (topShare !== null && topShare >= 50) {
      push({
        id: itemId('portfolio'), kind: 'portfolio', priority: 'high',
        title: `Single-position concentration is ${topShare.toFixed(0)}%`,
        titleFa: `تمرکز تک‌پوزیشن ${topShare.toFixed(0)}٪ است`,
        detail: 'one position dominates the portfolio; a single-asset shock moves the whole book',
        detailFa: 'یک پوزیشن بر پرتفوی غالب است؛ شوک به یک دارایی کل پرتفوی را تکان می‌دهد',
        evidence: [{ source: 'financial-state:risk', at: financial.at }],
        action: { type: 'navigate', to: '/portfolio' },
        source: 'financial-state', at: financial.at, confidence: 0.85
      });
    }
    const liq = unwrap(risk.liquidation);
    if (liq && (liq.level === 'HIGH' || liq.riskLevel === 'HIGH')) {
      push({
        id: itemId('risk'), kind: 'risk', priority: 'critical',
        title: 'Liquidation risk is HIGH',
        titleFa: 'ریسک لیکویید شدن بالاست',
        detail: String(liq.reason || 'borrowing positions are close to their liquidation threshold').slice(0, 200),
        detailFa: liq.reason ? `پوزیشن‌های وام نزدیک آستانه لیکویید شدن‌اند — ${String(liq.reason).slice(0, 160)}` : 'پوزیشن‌های وام نزدیک آستانه لیکویید شدن‌اند',
        evidence: [{ source: 'financial-state:risk', at: financial.at }],
        action: { type: 'navigate', to: '/loan' },
        source: 'financial-state', at: financial.at, confidence: 0.9
      });
    }
  } else {
    missing.push('financial');
  }

  /* ── goals ────────────────────────────────────────────────────────────── */
  const goalsRows = Array.isArray(world?.domains?.goals?.rows?.value) ? world.domains.goals.rows.value : [];
  const goalProgress = unwrap(world?.domains?.goals?.progress);
  if (Array.isArray(goalProgress?.goals) && goalProgress.goals.length) {
    const behind = goalProgress.goals.filter((g) => g.onTrack === false);
    for (const g of behind.slice(0, 2)) {
      push({
        id: itemId('goal'), kind: 'goal', priority: 'high',
        title: `Goal «${String(g.name || g.id).slice(0, 60)}» is behind plan`,
        titleFa: `هدف «${String(g.name || g.id).slice(0, 60)}» از برنامه عقب است`,
        detail: g.needPerMonthUsd != null ? `needs about $${Math.round(g.needPerMonthUsd)}/month to reach the target date` : 'progress is under the pace the target date needs',
        detailFa: g.needPerMonthUsd != null ? `برای رسیدن به تاریخ هدف حدود ماهانه $${Math.round(g.needPerMonthUsd)} لازم است` : 'پیشرفت از سرعت لازم برای تاریخ هدف کمتر است',
        evidence: [{ source: 'goal-engine', at: num(goalProgress.at) || now }],
        action: { type: 'navigate', to: '/intent' },
        source: 'goal-engine', at: now, confidence: 0.75
      });
    }
  } else if (!goalsRows.length) {
    missing.push('goals');
  }

  /* ── global intelligence ──────────────────────────────────────────────── */
  const domains = globalIntel?.domains || null;
  if (domains) {
    const sm = domains.smart_money?.status === 'OK' ? domains.smart_money.data : null;
    if (sm) {
      const net = num(sm.accumulationUsd) !== null && num(sm.distributionUsd) !== null
        ? num(sm.accumulationUsd) - num(sm.distributionUsd)
        : null;
      if (net !== null && Math.abs(net) >= 1_000_000) {
        const accumulating = net > 0;
        push({
          id: itemId('smart_money'), kind: 'smart_money', priority: 'normal',
          title: accumulating ? 'Smart money is accumulating' : 'Smart money is distributing',
          titleFa: accumulating ? 'پول هوشمند در حال انباشت است' : 'پول هوشمند در حال توزیع است',
          detail: `labelled flow over the last ${sm.window || '24h'}: $${Math.abs(Math.round(net / 1000))}k ${accumulating ? 'net accumulation' : 'net distribution'} (whale activity ${num(sm.whaleActivity?.count) ?? '—'} events)`,
          detailFa: `جریان برچسب‌خورده در ${sm.window || '24h'} گذشته: $${Math.abs(Math.round(net / 1000))} هزار ${accumulating ? 'انباشت خالص' : 'توزیع خالص'} (فعالیت نهنگ‌ها: ${num(sm.whaleActivity?.count) ?? '—'} رویداد)`,
          evidence: [{ source: 'smartMoney:overview', at: domains.smart_money.at }],
          action: { type: 'navigate', to: '/smart-money' },
          source: 'smartMoney:overview', at: domains.smart_money.at,
          confidence: accumulating ? 0.65 : 0.65, untrusted: false
        });
      }
      const topToken = Array.isArray(sm.topTokens) ? sm.topTokens[0] : null;
      if (topToken) {
        push({
          id: itemId('smart_money'), kind: 'smart_money', priority: 'info',
          title: `Strongest labelled flow: ${topToken.symbol}`,
          titleFa: `قوی‌ترین جریان برچسب‌خورده: ${topToken.symbol}`,
          detail: `${topToken.flow || 'flow'} ${topToken.valueUsd != null ? `$${Math.round(topToken.valueUsd / 1000)}k` : ''} on ${topToken.chain || 'chain'}`,
          detailFa: `${faFlow(topToken.flow)} ${topToken.valueUsd != null ? `$${Math.round(topToken.valueUsd / 1000)} هزار` : ''} در ${topToken.chain || 'زنجیره'}`.trim(),
          evidence: [{ source: 'smartMoney:overview', at: domains.smart_money.at }],
          action: { type: 'navigate', to: '/smart-money' },
          source: 'smartMoney:overview', at: domains.smart_money.at, confidence: 0.55
        });
      }
    }

    const wh = domains.whales?.status === 'OK' ? domains.whales.data : null;
    if (wh) {
      const biggest = (wh.events || []).slice().sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0))[0];
      if (biggest && num(biggest.valueUsd) >= 500_000) {
        push({
          id: itemId('whale'), kind: 'whale', priority: 'normal',
          title: `Whale move: $${Math.round(biggest.valueUsd / 1000)}k ${biggest.symbol}`,
          titleFa: `حرکت نهنگ: $${Math.round(biggest.valueUsd / 1000)} هزار ${biggest.symbol}`,
          detail: `${biggest.flow || 'transfer'} on ${biggest.chain || 'chain'}${wh.count > 1 ? ` — ${wh.count} large transfers observed this window` : ''}`,
          detailFa: `${faFlow(biggest.flow)} در ${biggest.chain || 'زنجیره'}${wh.count > 1 ? ` — ${wh.count} انتقال بزرگ در این بازه دیده شد` : ''}`,
          evidence: [{ source: 'whales:scanner', at: domains.whales.at }],
          action: { type: 'navigate', to: '/smart-money' },
          source: 'whales:scanner', at: domains.whales.at, confidence: 0.7
        });
      }
    }

    const macro = domains.macro?.status === 'OK' ? domains.macro.data : null;
    if (macro) {
      const topTopic = Object.entries(macro.byTopic || {}).sort((a, b) => b[1] - a[1])[0];
      if (topTopic) {
        push({
          id: itemId('macro'), kind: 'macro', priority: 'normal',
          title: `Macro attention: ${topTopic[0]} (${topTopic[1]} headlines)`,
          titleFa: `توجه کلان: ${faTopic(topTopic[0])} (${topTopic[1]} خبر)`,
          detail: `most-mentioned macro topic in the last 48h of real headlines (politics included); items are classified, not generated`,
          detailFa: 'پراشاره‌ترین موضوع کلان در ۴۸ ساعت گذشته از خبرهای واقعی (سیاست هم در آن حساب می‌شود)؛ موارد دسته‌بندی شده‌اند، تولید نشده‌اند',
          evidence: (macro.items || []).slice(0, 3).map((m) => ({ source: `macro:${m.topic}`, at: m.at, url: m.url })),
          action: { type: 'navigate', to: '/news' },
          source: 'macro:classifier', at: domains.macro.at, confidence: 0.55, untrusted: true
        });
      }
      /* Phase 211.1 — the REAL macro quotes (dollar, gold, crude, rates,
         curve): the numbers side of the macro domain. Present only when a
         source actually returned them. */
      if (Array.isArray(macro.quotes) && macro.quotes.length) {
        const fmtQuote = (q) => `${q.symbol} ${q.change1dPct != null ? `${q.change1dPct > 0 ? '+' : ''}${q.change1dPct}% 1d` : '—'}${q.change7dPct != null ? ` · ${q.change7dPct > 0 ? '+' : ''}${q.change7dPct}% 7d` : ''}`;
        const shown = macro.quotes.slice(0, 4).map(fmtQuote).join(' · ');
        const curve = macro.curve && macro.curve.spreadPct != null
          ? (macro.curve.spreadPct < 0 ? ` · 2s10s INVERTED ${macro.curve.spreadPct}pp` : ` · 2s10s ${macro.curve.spreadPct}pp`)
          : '';
        push({
          id: itemId('macro'), kind: 'macro', priority: macro.curve?.spreadPct < 0 ? 'high' : 'info',
          title: `Macro indicators: ${macro.quotes[0].symbol} ${macro.quotes[0].change1dPct != null ? `${macro.quotes[0].change1dPct > 0 ? '+' : ''}${macro.quotes[0].change1dPct}%` : ''} 1d`,
          titleFa: `نشانگرهای کلان: ${macro.quotes[0].symbol} ${macro.quotes[0].change1dPct != null ? `${macro.quotes[0].change1dPct > 0 ? '+' : ''}${macro.quotes[0].change1dPct}٪` : ''} ۲۴س`,
          detail: `real quotes, not headlines: ${shown}${curve} (read-only)`,
          detailFa: `ارقام واقعی، نه خبر: ${shown}${curve} (فقط‌خواندنی)`,
          evidence: macro.quotes.slice(0, 3).map((q) => ({ source: q.source || 'macroData', at: domains.macro.at })),
          action: { type: 'navigate', to: '/ai-global' },
          source: domains.macro.source || 'macro:classifier', at: domains.macro.at, confidence: 0.6, untrusted: true
        });
      }
    }

    const news = domains.news?.status === 'OK' ? domains.news.data : null;
    if (news && Array.isArray(news.items) && news.items.length) {
      push({
        id: itemId('news'), kind: 'news', priority: 'info',
        title: `${news.items.length} fresh headlines`,
        titleFa: `${news.items.length} خبر تازه`,
        detail: String(news.items[0]?.title || '').slice(0, 160),
        detailFa: String(news.items[0]?.title || '').slice(0, 160),
        evidence: [{ source: 'news-engine', at: domains.news.at, url: news.items[0]?.url }],
        action: { type: 'navigate', to: '/news' },
        source: 'news-engine', at: domains.news.at, confidence: 0.6, untrusted: true
      });
    }

    const onchain = domains.onchain?.status === 'OK' ? domains.onchain.data : null;
    if (onchain && num(onchain.downSources) > 0) {
      push({
        id: itemId('onchain'), kind: 'onchain', priority: 'normal',
        title: `${onchain.downSources} on-chain source${onchain.downSources === 1 ? '' : 's'} down`,
        titleFa: `${onchain.downSources} منبع روی‌زنجیره قطع است`,
        detail: 'chain-intel health ledger reports consecutive failures — on-chain reads may be degraded',
        detailFa: 'دفتر سلامت چین‌اینتل خرابی‌های پیاپی گزارش می‌کند — خوانش‌های روی‌زنجیره ممکن است ناقص باشند',
        evidence: [{ source: 'chainIntel', at: domains.onchain.at }],
        action: { type: 'navigate', to: '/security' },
        source: 'chainIntel', at: domains.onchain.at, confidence: 0.85
      });
    }

    for (const cls of ['stocks', 'forex', 'commodities', 'rwa']) {
      const d = domains[cls];
      if (d?.status === 'OK' && Array.isArray(d.data?.instruments) && d.data.instruments.length) {
        const mover = d.data.instruments
          .map((i) => ({ symbol: i.symbol, changePct: num(i.change24hPct) }))
          .filter((i) => i.changePct !== null)
          .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))[0];
        if (mover) {
          const clsEn = cls === 'stocks' ? 'Equities' : cls === 'forex' ? 'FX' : cls === 'commodities' ? 'Commodities' : 'RWA';
          const clsFa = cls === 'stocks' ? 'سهام' : cls === 'forex' ? 'فارکس' : cls === 'commodities' ? 'کالاها' : 'دارایی واقعی';
          push({
            id: itemId(cls), kind: cls, priority: 'info',
            title: `${clsEn}: ${mover.symbol} ${mover.changePct > 0 ? '+' : ''}${mover.changePct.toFixed(1)}%`,
            titleFa: `${clsFa}: ${mover.symbol} ${mover.changePct > 0 ? '+' : ''}${mover.changePct.toFixed(1)}٪`,
            detail: `biggest 24h mover among ${d.data.instruments.length} ${d.data.venue || ''} instruments (read-only synthetic exposure; the app cannot buy these for you)`,
            detailFa: `بزرگ‌ترین حرکت ۲۴ ساعته بین ${d.data.instruments.length} ابزار ${d.data.venue || ''} (مواجهه مصنوعی فقط‌خواندنی؛ برنامه نمی‌تواند این‌ها را برای شما بخرد)`,
            evidence: [{ source: d.source, at: d.at }],
            action: { type: 'navigate', to: cls === 'stocks' ? '/stocks' : '/ostium' },
            source: d.source, at: d.at, confidence: 0.6
          });
        }
      }
    }
  } else {
    missing.push('global_intelligence');
  }

  /* ── cross-asset + the economic outlook (Phase 211.1) ─────────────────── */
  const digest = crossAsset ? crossAssetDigest(crossAsset) : null;
  if (digest?.available) {
    const outlook = digest.outlook || null;
    const outlookLabel = outlook && outlook.label && outlook.label !== 'UNAVAILABLE' ? outlook.label : null;
    const priority = (digest.regime === 'RISK_OFF' || digest.regime === 'RISK_OFF_LEANING' || outlookLabel === 'RECESSION_WATCH') ? 'high' : 'info';
    push({
      id: itemId('cross_asset'), kind: 'cross_asset', priority,
      title: `Cross-asset regime: ${String(digest.regime || 'MIXED').replace(/_/g, ' ').toLowerCase()}${outlookLabel ? ` · outlook: ${outlookLabel.replace(/_/g, ' ').toLowerCase()}` : ''}`,
      titleFa: `رژیم کراس‌است: ${faRegime(digest.regime)}${outlookLabel ? ` · چشم‌انداز: ${faOutlook(outlookLabel)}` : ''}`,
      detail: `${digest.observedClasses.join(', ')} observed${digest.divergences.length ? `; divergence: ${digest.divergences[0]}` : `; co-movement ${(digest.coMovement * 100).toFixed(0)}%`}${outlookLabel ? `; outlook score ${outlook.score > 0 ? '+' : ''}${outlook.score}${(outlook.signals || []).length ? ` (${outlook.signals[0]})` : ''}` : ''}`,
      detailFa: `${digest.observedClasses.map(faClass).join('، ')} مشاهده شد${digest.divergences.length ? `؛ واگرایی: ${String(digest.divergences[0]).replace(/_/g, ' ')}` : `؛ هم‌حرکتی ${(digest.coMovement * 100).toFixed(0)}٪`}${outlookLabel ? `؛ امتیاز چشم‌انداز ${outlook.score > 0 ? '+' : ''}${outlook.score}${(outlook.signals || []).length ? ` (${outlook.signals[0]})` : ''}` : ''}`,
      evidence: [{ source: 'cross-asset-engine', at: crossAsset.at }],
      action: { type: 'navigate', to: '/ai-global' },
      source: 'cross-asset-engine', at: crossAsset.at, confidence: 0.7, untrusted: outlookLabel !== null
    });
  } else if (crossAsset) {
    missing.push('cross_asset');
  } else {
    missing.push('cross_asset');
  }

  /* ── learning ─────────────────────────────────────────────────────────── */
  if (learning && typeof learning === 'object' && learning.samples > 0) {
    push({
      id: itemId('learning'), kind: 'learning', priority: 'info',
      title: `Learning calibration: ${(learning.directionHitRate ?? 0) * 100 > 0 ? `${Math.round((learning.directionHitRate || 0) * 100)}% direction hit rate` : 'no scored predictions yet'}`,
      titleFa: `کالیبراسیون یادگیری: ${(learning.directionHitRate ?? 0) * 100 > 0 ? `نرخ اصابت جهت ${Math.round((learning.directionHitRate || 0) * 100)}٪` : 'هنوز پیش‌بینی امتیازداده‌شده‌ای نیست'}`,
      detail: `${learning.samples} verified outcome${learning.samples === 1 ? '' : 's'} recorded; the number is the machine's, not a promise`,
      detailFa: `${learning.samples} نتیجه تأییدشده ثبت شد؛ این عدد مال ماشین است، نه یک وعده`,
      evidence: [{ source: 'learning:calibration', at: now }],
      action: { type: 'navigate', to: '/ai-control' },
      source: 'learning:calibration', at: now, confidence: 0.8
    });
  } else {
    missing.push('learning');
  }

  /* Sort by priority, cap the list, done. */
  const order = { critical: 0, high: 1, normal: 2, info: 3 };
  return { items: items.sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9)).slice(0, MAX_ITEMS), missing: [...new Set(missing)] };
}

/**
 * @param {object} p
 * @param {object} p.collections   FI persistence (briefings rows)
 * @param {object} [p.observability]
 */
export function createBriefingEngine({ collections = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  const cache = new Map(); // owner → { briefing, at }

  /**
   * The briefing for one owner. Inputs are assembled by the caller (the
   * composition root) so every engine stays replaceable; this engine owns
   * freshness, persistence and the honest `missing` list.
   */
  async function briefingFor(owner, inputs = {}, { refresh = false } = {}) {
    const at = now();
    const hit = cache.get(owner);
    if (!refresh && hit && at - hit.at < BRIEFING_TTL_MS) {
      return { ...hit.briefing, cached: true };
    }
    const built = buildBriefingItems({ ...inputs, now: at });
    const briefing = {
      schema: BRIEFING_SCHEMA,
      owner,
      id: `bf_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
      at,
      status: built.items.length ? 'OK' : 'UNAVAILABLE',
      items: built.items,
      counts: {
        critical: built.items.filter((i) => i.priority === 'critical').length,
        high: built.items.filter((i) => i.priority === 'high').length,
        normal: built.items.filter((i) => i.priority === 'normal').length,
        info: built.items.filter((i) => i.priority === 'info').length
      },
      missing: built.missing,
      proactive: true,
      executionAuthorized: false,
      note: 'a briefing is a recommendation to READ — no item carries execution permission (§50)',
      durable: collections ? collections.durable() : null
    };
    cache.set(owner, { briefing, at });
    if (collections) {
      try {
        /* 'latest' is replaced, the history row is appended by id — additive
           rows only, capped by the collection's cap. The pinned id goes AFTER
           the spread so the briefing's own id cannot clobber the lookup key. */
        await collections.put('briefings', owner, { ...briefing, id: 'latest', briefingId: briefing.id }, { idKey: 'id' });
        await collections.put('briefings', owner, { ...briefing, id: briefing.id, latest: false }, { idKey: 'id' });
      } catch (err) {
        log(`briefing:persist-failed:${String(err?.message || err).slice(0, 100)}`);
      }
    }
    if (observability) observability.emit({ type: 'briefing.built', owner, payload: { id: briefing.id, items: briefing.items.length, critical: briefing.counts.critical } });
    log(`briefing:${owner}: ${briefing.items.length} items (${briefing.counts.critical} critical)`);
    return briefing;
  }

  /** The last persisted briefing — what a cold process shows immediately. */
  async function lastBriefing(owner) {
    if (!collections) return null;
    try {
      const out = await collections.get('briefings', owner, 'latest');
      return out.ok ? out.row : null;
    } catch { return null; }
  }

  /** Bounded history for the panel's «previous briefings» list. */
  async function history(owner, { limit = 10 } = {}) {
    if (!collections) return { ok: true, briefings: [], durable: false };
    const out = await collections.read('briefings', owner).catch(() => ({ ok: false, rows: [] }));
    const rows = (out.ok ? out.rows : []).filter((r) => r?.id && r.id !== 'latest');
    return {
      ok: true,
      briefings: rows.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, Math.min(30, Math.max(1, Number(limit) || 10))),
      durable: collections.durable()
    };
  }

  return { briefingFor, lastBriefing, history, buildBriefingItems };
}

export default createBriefingEngine;
