/**
 * FBT STRATEGY BRAIN — DISPLAY LOCALIZATION (layer 4 of 4).
 * ---------------------------------------------------------------------------
 * The engine (strategyEngine.js) is locale-free on purpose: probes, the
 * runtime and the store all read the same English-canonical object. This
 * module is the ONLY place that turns it into display strings for another
 * language — `localizeStrategyPlan(plan, locale)` returns a display copy and
 * never mutates the plan the runtime acts on.
 *
 * Why a display copy and not engine-side generation? Every dynamic sentence
 * the engine builds (honesty, stage objectives, monitor conditions, ranking
 * reasons) embeds the numbers it decided on. Rebuilding those sentences here
 * from the plan's own numeric fields keeps the words and the numbers in the
 * same object — the card cannot show a Persian sentence next to an English
 * number that disagrees with it.
 *
 * Numbers stay Latin digits with tabular figures (see intent-ai-os.css):
 * finance users read `12.5%` faster than `۱۲/۵٪`, and mixed digits inside one
 * row are exactly the unreadable jumble this file removes.
 */

export const STRATEGY_LOCALE_SCHEMA = 'fbt.strategy-locales.v1';

export const BLUEPRINT_FA = Object.freeze({
  stable_carry: {
    title: 'حمل استیبل',
    idea: 'سرمایه در دارایی‌های دلاری با بهترین نرخ واقعی وام‌دهی می‌ماند. کمترین نوسان، کمترین سقف.'
  },
  yield_core: {
    title: 'هسته بازده دیفای',
    idea: 'وام‌دهی به‌علاوه فارم و استخر — همان ونیوهای بازده خود اپ، متنوع در چند پروتکل.'
  },
  balanced_growth: {
    title: 'رشد متعادل',
    idea: 'پایه بازده به‌علاوه آستین بازار (کریپتو / RWA / سهام) برای بخشی از هدف که بازده پوشش نمی‌دهد.'
  },
  hedged_growth: {
    title: 'رشد پوشش‌دار',
    idea: 'آستین رشد با پوشش فاندینگ، تا بخشی از افت با دفتر پرپ جبران شود.'
  },
  funding_carry: {
    title: 'حمل فاندینگ',
    idea: 'جمع‌کردن فاندینگ پرپ به‌جای شرط روی جهت — فقط جایی که نرخ فاندینگ زنده هست.'
  },
  momentum: {
    title: 'مومنتوم جهت‌دار',
    idea: 'تمرکز روی قوی‌ترین بازارهای زنده، با مشتقات فقط برای باند تهاجمی.'
  }
});

export const RISK_PROFILE_FA = Object.freeze({
  conservative: 'محافظه‌کار',
  balanced: 'متعادل',
  aggressive: 'تهاجمی'
});

export const CAPITAL_SOURCE_FA = Object.freeze({
  user: 'گفته شما',
  wallet: 'کیف پول',
  portfolio: 'پرتفوی',
  holdings: 'دارایی‌ها',
  balances: 'موجودی',
  parser: 'متن پیام'
});

export const REGIME_FA = Object.freeze({
  risk_on: 'ریسک‌پذیر',
  risk_off: 'ریسک‌گریز',
  neutral: 'خنثی'
});

export const ECOSYSTEM_DOMAIN_FA = Object.freeze({
  wallet: 'کیف پول',
  portfolio: 'پرتفوی',
  crypto: 'کریپتو',
  rwa: 'RWA',
  stocks: 'سهام',
  forex: 'فارکس',
  commodities: 'کالا',
  lending: 'وام‌دهی',
  farming: 'فارم',
  liquidity: 'نقدینگی',
  futures: 'فیوچرز',
  dydx: 'dYdX',
  bridge: 'بریج',
  smartMoney: 'پول هوشمند',
  whales: 'نهنگ‌ها',
  news: 'اخبار',
  macro: 'ماکرو',
  risk: 'ریسک',
  fees: 'کارمزد',
  gas: 'گس',
  correlation: 'همبستگی'
});

export const MODULE_FA = Object.freeze({
  wallet: 'کیف پول',
  risk: 'ریسک',
  bridge: 'بریج',
  swap: 'سواپ',
  lending: 'وام‌دهی',
  farm: 'فارم',
  liquidity: 'نقدینگی',
  markets: 'بازارها',
  futures: 'فیوچرز',
  monitoring: 'پایش'
});

export const OPERATION_FA = Object.freeze({
  READ_BALANCES: 'خواندن موجودی',
  CHECK_LIMITS: 'بررسی سقف‌ها',
  BRIDGE: 'بریج',
  BUY: 'خرید',
  BUY_EQUITY: 'خرید سهام',
  BUY_FX: 'خرید فارکس',
  BUY_COMMODITY: 'خرید کالا',
  SUPPLY: 'سپرده‌گذاری',
  SUPPLY_STABLE: 'سپرده استیبل',
  STAKE: 'استیک',
  DEPOSIT: 'واریز',
  ADD_LIQUIDITY: 'افزودن نقدینگی',
  OPEN_POSITION: 'بازکردن پوزیشن',
  CREATE_MONITOR: 'ساخت پایش'
});

const BREACH_FA = Object.freeze({
  DRAWDOWN_ABOVE_BUDGET: 'افت بالاتر از بودجه',
  RISK_BAND_BREACH: 'خروج از باند ریسک',
  COST_INCOMPLETE: 'هزینه ناقص'
});

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** First decimal-looking number inside an engine sentence. */
function firstNumber(text) {
  const m = String(text || '').match(/-?\d[\d,]*\.?\d*/);
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** All decimal-looking numbers inside an engine sentence, in order. */
function allNumbers(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/-?\d[\d,]*\.?\d*/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

const faPct = (v, d = 2) => (num(v) == null ? '—' : `${Number(v).toFixed(d)}٪`);
const faUsd = (v) => (num(v) == null ? '—' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);

function localizeStage(stage = {}) {
  const id = String(stage.id || '');
  const actions = Array.isArray(stage.actions) ? stage.actions : [];
  const fa = (v, d = 2) => faPct(v, d);
  switch (id) {
    case 'preflight':
      return {
        title: 'پیش‌پرواز',
        objective: 'پیش از هر جابه‌جایی، سرمایه، مجوزها، گس و سقف ریسک تأیید می‌شود.',
        rollback: 'چیزی برای بازگشت نیست — هنوز پولی جابه‌جا نشده.'
      };
    case 'consolidate': {
      const amount = firstNumber(stage.objective);
      const hasBridge = actions.some((a) => String(a?.module || '').toLowerCase() === 'bridge');
      return {
        title: 'یکپارچه‌سازی دارایی پایه',
        objective: hasBridge
          ? `انتقال ${faUsd(amount)} به زنجیره‌ای که آستین‌ها آنجا هستند، و سپس به دارایی ورودی.`
          : `انتقال ${faUsd(amount)} به دارایی ورودی آستین‌های بازار.`,
        rollback: 'سواپ/بریج معکوس به دارایی پایه.'
      };
    }
    case 'deploy-yield': {
      const share = firstNumber(stage.objective);
      return {
        title: 'استقرار هسته بازده',
        objective: `استقرار ${fa(share, 1)} سرمایه در بازده واقعی — بخشی از هدف که به قیمت وابسته نیست.`,
        rollback: 'برداشت / آن‌استیک به دارایی پایه.'
      };
    }
    case 'deploy-market': {
      const share = firstNumber(stage.objective);
      return {
        title: 'استقرار آستین بازار',
        objective: `افزودن ${fa(share, 1)} با ریسک قیمتی، به‌اندازه‌ای که بودجه افت سرمایه حفظ شود.`,
        rollback: 'بستن / فروش به دارایی پایه.'
      };
    }
    case 'monitor':
      return {
        title: 'پایش و بازبینی',
        objective: 'رهگیری بازده محقق‌شده در برابر منحنی برنامه و بودجه افت؛ بازبرنامه‌ریزی وقتی یکی بشکند.',
        rollback: 'فقط پایش — چیزی برای بازگشت نیست.'
      };
    default:
      return { title: stage.title || '', objective: stage.objective || '', rollback: stage.rollback || '' };
  }
}

function localizeMonitorCopy(mon = {}) {
  const id = String(mon.id || '');
  switch (id) {
    case 'drawdown-budget': {
      const [n] = allNumbers(mon.condition);
      return {
        condition: `افت پرتفوی از شروع برنامه بیشتر از ${faPct(n, 0)}`,
        action: 'پیشنهاد کم‌ریسک‌کردن: کوچک‌کردن آستین بازار و انتقال به هسته بازده'
      };
    }
    case 'target-pace': {
      const [days] = allNumbers(mon.condition);
      return {
        condition: `بازده محقق‌شده کمتر از ۵۰٪ منحنی برنامه در نیمه افق (${days ?? '—'} روز)`,
        action: 'بازبرنامه‌ریزی با نرخ‌های زنده تازه؛ گفتن صریح شکاف به‌جای صبرکردن'
      };
    }
    case 'floor-breach': {
      const [floor] = allNumbers(mon.condition);
      return {
        condition: floor != null
          ? `پیش‌بینی بازده نهایی کمتر از ${faPct(floor)} (کمینه اعلام‌شده شما)`
          : 'پیش‌بینی بازده کمتر از هدف برنامه',
        action: 'بازبرنامه‌ریزی و گفتن صریح اینکه کمینه روی مسیر نیست'
      };
    }
    case 'rate-decay':
      return {
        condition: 'نرخ زنده یک آستین بیش از ۳۰٪ زیر نرخی که برنامه با آن ساخته شد',
        action: 'پیشنهاد انتقال آن آستین به بهترین نرخ زنده داخل همان باند'
      };
    case 'regime-flip':
      return {
        condition: 'چرخش رژیم بازار بین ریسک‌پذیر و ریسک‌گریز در دو خوانش پشت سر هم',
        action: 'وزن‌دهی دوباره آستین بازار و امتیازدهی دوباره طرح‌ها'
      };
    default:
      return { condition: mon.condition || '', action: mon.action || '' };
  }
}

function localizeLimitation(line, plan) {
  const s = String(line || '');
  if (s.startsWith('Expected returns come from live APYs')) {
    return 'بازده موردانتظار از APYهای زنده و تاریخچه اندازه‌گیری‌شده همین لحظه می‌آید، نه از پیش‌بینی.';
  }
  if (s.startsWith('Nothing here signs or broadcasts')) {
    return 'هیچ‌چیز اینجا امضا یا ارسال نمی‌کند — هر مرحله به ونیویی واگذار می‌شود که صاحب امضاست.';
  }
  if (s.startsWith('Planned on the capital you stated')) {
    return 'برنامه روی سرمایه‌ای که خودت گفتی ساخته شد: کیف پولی خوانده نشد، پس دارایی‌های فعلی و تمرکزشان در این برنامه نیست.';
  }
  if (s.startsWith('Not read this turn:')) {
    const rest = s.slice('Not read this turn:'.length).trim().replace(/\.$/, '');
    const names = rest.split(',').map((d) => ECOSYSTEM_DOMAIN_FA[d.trim()] || d.trim()).filter(Boolean);
    return `این لحظه خوانده نشد: ${names.join('، ')}.`;
  }
  if (s.startsWith('Gas was unread')) {
    return 'گس خوانده نشد، پس رقم هزینه یک کف است.';
  }
  return line;
}

/**
 * Ranking reasons rebuilt from the comparison rows themselves — the words
 * always match the numbers on the same card because they are computed from
 * the same fields.
 */
function localizeRanking(pool = []) {
  if (!pool.length) return [];
  const [winner, ...rest] = pool;
  const fmtConf = (r) => `${Math.round((num(r?.confidence) || 0) * 100)}٪`;
  const out = [{
    id: winner.id,
    verdict: 'CHOSEN',
    reason: `بالاترین امتیاز: بازده موردانتظار ${faPct(winner.expectedReturnPct)} در افق، اتکای داده ${fmtConf(winner)}، ریسک ${faPct(winner.riskPct)}.`
  }];
  for (const row of rest) {
    const reasons = [];
    if (num(row.expectedReturnPct) != null && num(winner.expectedReturnPct) != null && row.expectedReturnPct < winner.expectedReturnPct) {
      reasons.push('بازده موردانتظار کمتر');
    }
    if (num(row.riskPct) != null && num(winner.riskPct) != null && row.riskPct > winner.riskPct) {
      reasons.push('افت برآوردی بیشتر');
    }
    if (num(row.confidence) != null && num(winner.confidence) != null && row.confidence < winner.confidence) {
      reasons.push('پشتوانه کمتر از خوانش زنده');
    }
    if (row.riskBandBreach) reasons.push('خارج از باند ریسک شما');
    if (num(row.correlationPenalty) != null && num(winner.correlationPenalty) != null && row.correlationPenalty > winner.correlationPenalty) {
      reasons.push('آستین‌های هم‌بسته‌تر');
    }
    out.push({
      id: row.id,
      verdict: 'REJECTED',
      reason: reasons.length ? reasons.join('، ') : 'امتیاز ترکیبی کمتر'
    });
  }
  return out;
}

function localizeHonesty(plan) {
  const verdict = plan?.verdict || {};
  const goal = plan?.goal || {};
  const days = goal.horizonDays;
  const conf = Math.round((num(plan?.confidence) || 0) * 100);
  if (verdict.reachable) {
    return `این یک برنامه است، نه وعده. ${faPct(verdict.expectedReturnPct)} در ${days ?? '—'} روز همان چیزی است که نرخ‌های زنده همین لحظه پشتیبانی می‌کنند — ${conf}٪ از تصمیم بر خوانشی واقعی تکیه دارد. بازار می‌تواند خلاف آن حرکت کند.`;
  }
  const daysNeeded = num(verdict.daysToTargetAtPlanRate) != null && num(verdict.daysToTargetAtPlanRate) > 0
    ? ` و به ${Math.round(verdict.daysToTargetAtPlanRate)} روز زمان نیاز دارد`
    : '';
  const range = verdict.rangePct != null ? `±${faPct(verdict.rangePct, 1)}` : '—';
  const stretch = plan?.alternatives?.stretch && (plan?.comparison || []).find((c) => c.id === plan.alternatives.stretch);
  const stretchBit = stretch
    ? ` — همان چیزی که گزینه «${BLUEPRINT_FA[stretch.id]?.title || stretch.title}» رویش شرط می‌بندد`
    : '';
  return `هدفت به ${faPct(verdict.requiredApyPct)} سود سالانه نیاز دارد. همه نرخ‌هایی که اکوسیستم همین حالا می‌تواند جور کند روی هم ${faPct(verdict.sourcedReturnPct)} در ${days ?? '—'} روز می‌شود${daysNeeded}. ${faPct(verdict.priceGapPct)} واحد باقی‌مانده فقط از قیمت می‌آید — جایی که پیش‌بینی ندارم، فقط دامنه اندازه‌گیری‌شده ${range} (۱σ) در افق${stretchBit}. این را به اسم هدفت جا نمی‌زنم.`;
}

function localizeStretchNote(plan) {
  const stretchId = plan?.alternatives?.stretch;
  if (!stretchId) return null;
  const stretch = (plan?.comparison || []).find((c) => c.id === stretchId);
  if (!stretch) return plan?.alternatives?.stretchNote || null;
  const target = plan?.goal?.targetPct;
  const title = BLUEPRINT_FA[stretch.id]?.title || stretch.title;
  return `${title} تنها شکلی است که می‌تواند به ${faPct(target, 1)} برسد — و فقط از مسیر قیمت، که پیش‌بینی نمی‌شود: ${faPct(stretch.priceExposurePct, 0)} سرمایه در معرض قیمت، دامنه اندازه‌گیری‌شده ۱σ برابر ${stretch.rangePct != null ? `±${faPct(stretch.rangePct)}` : '—'}.`;
}

/**
 * Display-localize a built strategy plan. The input plan is never mutated;
 * the runtime keeps working on the canonical object while the card renders
 * the copy this returns. Unknown/future engine strings pass through in
 * English rather than being dropped — a gap the card can show beats a blank.
 *
 * @param {object} plan built by buildPortfolioStrategy
 * @param {string} locale BCP-47 tag
 * @returns {object} display copy (same shape, localized strings)
 */
export function localizeStrategyPlan(plan, locale = 'fa') {
  if (!plan || typeof plan !== 'object') return plan;
  const lang = String(locale || 'fa').toLowerCase();
  if (!lang.startsWith('fa') && !lang.startsWith('ar')) return plan;
  const fa = lang.startsWith('fa');

  const comparison = (plan.comparison || []).map((c) => {
    const t = BLUEPRINT_FA[c.id];
    return { ...c, title: fa ? (t?.title || c.title) : c.title, idea: fa ? (t?.idea || c.idea) : c.idea };
  });
  const ranked = [...comparison].sort((a, b) => {
    if (a.id === plan.chosen) return -1;
    if (b.id === plan.chosen) return 1;
    return (num(b.score) || 0) - (num(a.score) || 0);
  });

  const stages = (plan.stages || []).map((st) => {
    if (!fa) return st;
    const copy = localizeStage(st);
    return {
      ...st,
      title: copy.title,
      objective: copy.objective,
      rollback: copy.rollback,
      actions: (st.actions || []).map((a) => ({
        ...a,
        moduleFa: MODULE_FA[String(a?.module || '').toLowerCase()] || null,
        operationFa: OPERATION_FA[String(a?.operation || '').toUpperCase()] || null
      }))
    };
  });

  const monitors = (plan.monitors || []).map((m) => {
    if (!fa) return m;
    const copy = localizeMonitorCopy(m);
    return { ...m, condition: copy.condition, action: copy.action };
  });

  const goal = plan.goal ? {
    ...plan.goal,
    riskProfileFa: RISK_PROFILE_FA[String(plan.goal.riskProfile || '').toLowerCase()] || plan.goal.riskProfile,
    capitalSourceFa: CAPITAL_SOURCE_FA[String(plan.goal.capitalSource || '').toLowerCase()] || plan.goal.capitalSource
  } : plan.goal;

  const marketView = plan.marketView ? {
    ...plan.marketView,
    regimeFa: REGIME_FA[String(plan.marketView.regime || '').toLowerCase()] || plan.marketView.regime
  } : plan.marketView;

  const risk = plan.risk ? {
    ...plan.risk,
    breaches: (plan.risk.breaches || []).map((b) => {
      if (!fa) return b;
      const code = BREACH_FA[b.code] || b.code;
      let detail = String(b.detail || '');
      detail = detail.replace(/estimated\s+([\d.]+)%\s+vs\s+budget\s+([\d.]+)%/i, 'برآورد $1٪ در برابر بودجه $2٪');
      detail = detail.replace(/weighted risk rank\s+([\d.]+)\s*>\s*([\d.]+)/i, 'رتبه ریسک وزنی $1 بیشتر از $2');
      detail = detail.replace(/gas unread\s*[—-]\s*the cost below excludes it/i, 'گس خوانده نشد — رقم هزینه آن را ندارد');
      return { ...b, codeFa: code, detailFa: detail };
    })
  } : plan.risk;

  return {
    ...plan,
    comparison,
    ranking: fa ? localizeRanking(ranked.length ? ranked : comparison) : plan.ranking,
    stages,
    monitors,
    goal,
    marketView,
    risk,
    honesty: fa ? localizeHonesty({ ...plan, comparison }) : plan.honesty,
    limitations: fa ? (plan.limitations || []).map((l) => localizeLimitation(l, plan)) : plan.limitations,
    alternatives: plan.alternatives ? {
      ...plan.alternatives,
      stretchNote: fa ? localizeStretchNote({ ...plan, comparison }) : plan.alternatives.stretchNote
    } : plan.alternatives
  };
}

/** Persian display name for an ecosystem domain id (coverage chips). */
export function domainDisplayName(domainId, locale = 'fa') {
  const lang = String(locale || 'fa').toLowerCase();
  if (!lang.startsWith('fa')) return String(domainId || '');
  return ECOSYSTEM_DOMAIN_FA[String(domainId || '')] || String(domainId || '');
}
