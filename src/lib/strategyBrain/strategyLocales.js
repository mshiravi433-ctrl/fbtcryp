/**
 * FBT STRATEGY BRAIN — LOCALES (layer 3.5: presentation, not math).
 * ---------------------------------------------------------------------------
 * The engine (`strategyEngine.js`) thinks in English: blueprint titles, the
 * honesty sentence, stage objectives, monitor conditions and ranking reasons
 * are all built there as English strings. Probes pin that output, so the
 * engine stays untouched.
 *
 * This module is the PRESENTATION half: `localizeStrategy(strategy, locale)`
 * returns a clone with every user-facing string translated. The chat calls it
 * right after `buildPortfolioStrategy` (see chatBridge.js), so a Persian user
 * never sees "Stable carry" or "I am not going to dress that up as your
 * target" — while numbers, ids, routes and handoffs pass through byte-identical.
 *
 * Numbers stay Latin digits: Persian text + Latin tabular numerals is what the
 * rest of the app does, and it keeps rates aligned in narrow boxes.
 */

const BLUEPRINT_FA = Object.freeze({
  stable_carry: { title: 'سود استیبل', idea: 'سرمایه در دارایی‌های دلاری می‌ماند و بهترین نرخ واقعی وام‌دهی را می‌گیرد. کمترین نوسان، کمترین سقف.' },
  yield_core: { title: 'هسته سود دیفای', idea: 'وام‌دهی به‌علاوه فارم و استخر — همان ونیوهای سود خود اپ، متنوع بین پروتکل‌ها.' },
  balanced_growth: { title: 'رشد متعادل', idea: 'پایه سود به‌علاوه یک بخش بازار (کریپتو / RWA / سهام) برای بخشی از هدف که سود به‌تنهایی نمی‌رساند.' },
  hedged_growth: { title: 'رشد پوشش‌دار', idea: 'بخش رشد با پوشش از محل فاندینگ، تا افت تا حدی از دفتر پرپ جبران شود.' },
  funding_carry: { title: 'کری فاندینگ', idea: 'گرفتن فاندینگ پرپ به‌جای شرط روی جهت — فقط جایی که نرخ فاندینگ زنده وجود دارد.' },
  momentum: { title: 'مومنتوم جهت‌دار', idea: 'تمرکز روی قوی‌ترین بازارهای زنده، با ابزار مشتقه فقط برای بازه تهاجمی.' }
});

const RISK_PROFILE_FA = Object.freeze({
  conservative: 'محافظه‌کار',
  balanced: 'متعادل',
  aggressive: 'تهاجمی'
});

const REGIME_FA = Object.freeze({
  risk_on: 'ریسک‌پذیر',
  risk_off: 'احتیاطی',
  neutral: 'خنثی'
});

const STAGE_FA = Object.freeze({
  preflight: { title: 'پیش‌پرواز', objective: 'تأیید سرمایه، مجوزها، گس و سقف ریسک قبل از هر حرکتی.', rollback: 'چیزی برای برگرداندن نیست — پولی جابه‌جا نشده.' },
  consolidate: { title: 'تجمیع دارایی پایه', objective: null, rollback: 'سواپ/بریج معکوس به دارایی پایه.' },
  'deploy-yield': { title: 'استقرار هسته سود', objective: null, rollback: 'برداشت / آن‌استیک به دارایی پایه.' },
  'deploy-market': { title: 'استقرار بخش بازار', objective: null, rollback: 'بستن / فروش به دارایی پایه.' },
  monitor: { title: 'پایش و بازبینی', objective: 'دنبال کردن بازده واقعی در برابر منحنی برنامه و بودجه افت؛ بازبرنامه‌ریزی وقتی یکی بشکند.', rollback: 'فقط پایش — چیزی برای برگرداندن نیست.' }
});

const MONITOR_FA = Object.freeze({
  'drawdown-budget': { condition: null, action: 'پیشنهاد کم‌ریسک کردن: کوچک کردن بخش بازار، انتقال به هسته سود' },
  'target-pace': { condition: null, action: 'بازبرنامه‌ریزی با نرخ‌های زنده تازه؛ گزارش شکاف به‌جای انتظار' },
  'floor-breach': { condition: null, action: 'بازبرنامه‌ریزی و گفتن صریح اینکه کف در مسیر نیست' },
  'rate-decay': { condition: 'افت APY زنده یک بخش بیش از ۳۰٪ نسبت به زمان ساخت برنامه', action: 'پیشنهاد انتقال آن بخش به بهترین نرخ زنده در همان بازه' },
  'regime-flip': { condition: 'چرخش رژیم بازار بین ریسک‌پذیر ↔ احتیاطی در دو خوانش پیاپی', action: 'وزن‌دهی دوباره بخش بازار و امتیازدهی مجدد طرح‌ها' }
});

const r2 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : v);

function honestyFa(strategy) {
  const v = strategy?.verdict || {};
  const goal = strategy?.goal || {};
  const horizon = goal.horizonDays ?? strategy?.horizonDays ?? '';
  const conf = strategy?.confidence != null ? Math.round(strategy.confidence * 100) : null;
  if (v.reachable) {
    return `این یک برنامه است نه یک قول. ${r2(v.expectedReturnPct)}٪ در ${horizon} روز، چیزی است که نرخ‌های زنده همین لحظه پشتیبانی می‌کنند`
      + (conf != null ? ` — ${conf}٪ تصمیم بر خوانش واقعی استوار است` : '')
      + '. بازار می‌تواند خلافش حرکت کند.';
  }
  const need = v.requiredApyPct != null ? `${r2(v.requiredApyPct)}٪ سود سالانه` : '—';
  const sourced = v.sourcedReturnPct != null ? `${r2(v.sourcedReturnPct)}٪` : '—';
  const daysBit = v.daysToTargetAtPlanRate != null ? ` و ${Math.round(v.daysToTargetAtPlanRate)} روز طول می‌کشد` : '';
  const gap = v.priceGapPct != null ? `${r2(v.priceGapPct)} واحد` : 'باقی';
  const range = v.rangePct != null ? `±${r2(v.rangePct)}٪` : '—';
  const stretchTitle = strategy?.alternatives?.stretch
    ? (BLUEPRINT_FA[strategy.alternatives.stretch]?.title || strategy.alternatives.stretch)
    : null;
  return `هدفت به ${need} نیاز دارد. همه نرخ‌هایی که اکوسیستم الان دارد روی هم ${sourced} در ${horizon} روز می‌شود${daysBit}. `
    + `${gap} باقی‌مانده فقط از قیمت می‌آید — جایی که پیش‌بینی ندارم، فقط یک دامنه اندازه‌گیری‌شده ${range} (۱σ) در بازه`
    + (stretchTitle ? `، و همان چیزی است که گزینه «${stretchTitle}» رویش شرط می‌بندد` : '')
    + '. این را به‌جای هدفت جا نمی‌زنم.';
}

function stretchNoteFa(strategy) {
  const alt = strategy?.alternatives || {};
  if (!alt.stretch) return null;
  const goal = strategy?.goal || {};
  const row = (strategy?.comparison || []).find((c) => c.id === alt.stretch) || {};
  const title = BLUEPRINT_FA[alt.stretch]?.title || row.title || alt.stretch;
  return `${title} تنها شکلی است که می‌تواند به ${goal.targetPct}٪ برسد — و فقط از مسیر قیمت، که پیش‌بینی نمی‌شود: `
    + `${r2(row.priceExposurePct)}٪ سرمایه در معرض قیمت، دامنه اندازه‌گیری‌شده ۱σ برابر ±${row.rangePct ?? '—'}٪.`;
}

function rankingFa(ranked = []) {
  return ranked.map((row, index) => {
    if (index === 0) {
      return {
        id: row.id,
        verdict: 'CHOSEN',
        reason: `بالاترین امتیاز: بازده موردانتظار ${row.expectedReturnPct ?? '—'}٪ در بازه با اطمینان داده ${Math.round((row.confidence || 0) * 100)}٪ و ریسک ${row.riskPct ?? '—'}٪.`
      };
    }
    const winner = ranked[0] || {};
    const reasons = [];
    if ((row.expectedReturnPct ?? -999) < (winner.expectedReturnPct ?? -999)) reasons.push('بازده موردانتظار کمتر');
    if ((row.riskPct ?? 0) > (winner.riskPct ?? 0)) reasons.push('افت برآوردی بیشتر');
    if ((row.confidence || 0) < (winner.confidence || 0)) reasons.push('پشتوانه خوانش زنده کمتر');
    if (row.riskBandBreach) reasons.push('خارج از بازه ریسک شما');
    if ((row.correlationPenalty || 0) > (winner.correlationPenalty || 0)) reasons.push('بخش‌های هم‌بسته بیشتر');
    return { id: row.id, verdict: 'REJECTED', reason: reasons.length ? reasons.join('، ') : 'امتیاز ترکیبی کمتر' };
  });
}

function stageObjectiveFa(stage, pctOfCapital) {
  if (stage.id === 'consolidate') {
    return stage.objective && /chain/i.test(stage.objective)
      ? `انتقال ${pctOfCapital} دلار روی زنجیره‌های موردنیاز بخش‌ها، بعد ورود به دارایی ورودی.`
      : `انتقال ${pctOfCapital} دلار به دارایی ورودی بخش‌های بازار.`;
  }
  if (stage.id === 'deploy-yield') {
    return `استقرار ${pctOfCapital}٪ سرمایه در سودِ منبع‌دار — بخشی از هدف که به قیمت وابسته نیست.`;
  }
  if (stage.id === 'deploy-market') {
    return `افزودن ${pctOfCapital}٪ با ریسک قیمت، با اندازه‌ای که بودجه افت همچنان پابرجا بماند.`;
  }
  return STAGE_FA[stage.id]?.objective || stage.objective;
}

function monitorConditionFa(m, strategy) {
  const profile = strategy?.risk?.band;
  const budget = strategy?.risk?.drawdownBudgetPct;
  const goal = strategy?.goal || {};
  const horizon = goal.horizonDays || 0;
  if (m.id === 'drawdown-budget') return `افت پرتفوی از شروع برنامه بیش از ${budget ?? '—'}٪`;
  if (m.id === 'target-pace') return `بازده واقعی کمتر از ۵۰٪ منحنی برنامه در نیمه بازه (${Math.round(horizon / 2)} روز)`;
  if (m.id === 'floor-breach') {
    const floor = goal.floorPct ?? goal.targetPct;
    return floor != null ? `بازده نهایی پیش‌بینی‌شده کمتر از ${floor}٪ (کف اعلامی شما)` : 'افت بازده پیش‌بینی‌شده زیر هدف برنامه';
  }
  return MONITOR_FA[m.id]?.condition || m.condition;
}

function limitationFa(text) {
  const s = String(text || '');
  if (/Expected returns come from live APYs/i.test(s)) return 'بازده‌های موردانتظار از APYهای زنده و تاریخچه اندازه‌گیری‌شده همین لحظه می‌آید، نه از پیش‌بینی.';
  if (/Nothing here signs or broadcasts/i.test(s)) return 'هیچ‌چیز اینجا امضا یا ارسال نمی‌شود — هر مرحله به ونیویی که امضا را دارد تحویل داده می‌شود.';
  if (/Planned on the capital you stated/i.test(s)) return 'برنامه روی سرمایه‌ای که خودت گفتی ساخته شد: کیف پولی خوانده نشد، پس دارایی‌های فعلی و تمرکزشان در این برنامه نیست.';
  if (/Not read this turn/i.test(s)) {
    const m = s.match(/Not read this turn:\s*(.+)\./i);
    return m ? `این لحظه خوانده نشد: ${m[1]}.` : 'برخی دامنه‌ها این لحظه خوانده نشدند.';
  }
  if (/Gas was unread/i.test(s)) return 'گس خوانده نشد، پس رقم هزینه یک کف است.';
  return s;
}

function clone(value) {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch { /* fall through */ }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Localize a built strategy for display. The input is never mutated.
 * Unknown locale (or 'en') returns the strategy untouched.
 */
export function localizeStrategy(strategy, locale = 'fa') {
  const lang = String(locale || 'fa').toLowerCase().startsWith('fa') ? 'fa' : 'en';
  if (!strategy || typeof strategy !== 'object' || lang !== 'fa') return strategy;
  if (strategy.ok === false) return strategy; // refusals already have fa copies in the card
  const out = clone(strategy);

  out.locale = 'fa';

  if (Array.isArray(out.comparison)) {
    out.comparison = out.comparison.map((c) => ({
      ...c,
      title: BLUEPRINT_FA[c.id]?.title || c.title,
      idea: BLUEPRINT_FA[c.id]?.idea || c.idea
    }));
  }
  if (Array.isArray(out.comparison) && out.comparison.length) {
    out.ranking = rankingFa(out.comparison);
  } else if (Array.isArray(out.ranking)) {
    out.ranking = out.ranking.map((r) => ({ ...r, reason: r.verdict === 'CHOSEN' ? 'انتخاب شد' : r.reason }));
  }

  out.honesty = honestyFa(out);
  if (out.alternatives) {
    out.alternatives = { ...out.alternatives, stretchNote: stretchNoteFa(out) };
  }

  if (out.goal) {
    out.goal = {
      ...out.goal,
      riskProfileFa: RISK_PROFILE_FA[String(out.goal.riskProfile || '').toLowerCase()] || out.goal.riskProfile
    };
  }
  if (out.marketView) {
    out.marketView = {
      ...out.marketView,
      regimeFa: REGIME_FA[String(out.marketView.regime || '').toLowerCase()] || out.marketView.regime
    };
  }

  if (Array.isArray(out.stages)) {
    out.stages = out.stages.map((st) => {
      const fa = STAGE_FA[st.id] || {};
      // Recompute the capital share from the objective's own numbers when present.
      const pctMatch = String(st.objective || '').match(/([\d.]+)\s*(%|USD)/);
      const pct = pctMatch ? pctMatch[1] : '';
      return {
        ...st,
        title: fa.title || st.title,
        objective: stageObjectiveFa(st, pct),
        rollback: fa.rollback || st.rollback
      };
    });
  }
  if (Array.isArray(out.monitors)) {
    out.monitors = out.monitors.map((m) => ({
      ...m,
      condition: monitorConditionFa(m, out),
      action: MONITOR_FA[m.id]?.action || m.action
    }));
  }
  if (Array.isArray(out.limitations)) {
    out.limitations = out.limitations.map(limitationFa);
  }
  if (Array.isArray(out.risk?.breaches)) {
    out.risk = {
      ...out.risk,
      breaches: out.risk.breaches.map((b) => ({
        ...b,
        detail: String(b.detail || '')
          .replace(/estimated\s+([\d.]+)%\s+vs\s+budget\s+([\d.]+)%/i, 'برآورد $1٪ در برابر بودجه $2٪')
          .replace(/weighted risk rank\s+([\d.]+)\s*>\s*([\d.]+)/i, 'رتبه ریسک وزنی $1 بیشتر از $2')
          .replace(/gas unread — the cost below excludes it/i, 'گس خوانده نشد — رقم هزینه آن را ندارد')
      }))
    };
  }
  return out;
}

export const STRATEGY_LOCALE_TEST_IDS = Object.freeze({
  blueprintCount: Object.keys(BLUEPRINT_FA).length
});
