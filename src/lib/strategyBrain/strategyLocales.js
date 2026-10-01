/** Presentation only. Canonical plans stay in the engine/store language so a
 * saved plan follows the language picker on render, without changing amounts,
 * risk bands, routes, capability ids or signing/receipt contracts. */
import { num, r2 } from './numeric.js';

const BLUEPRINT_FA = Object.freeze({
  stable_carry: { title: 'سود استیبل', idea: 'دارایی‌های دلاری و نرخ‌های واقعی وام‌دهی؛ با ریسک پروتکل و تغییر نرخ، نه سود تضمینی.' },
  yield_core: { title: 'هسته سود دیفای', idea: 'وام‌دهی و استیکینگ در مسیرهای تأییدشدهٔ داخل اپ، با تنوع بین مسیرهای در دسترس.' },
  balanced_growth: { title: 'رشد متعادل', idea: 'پایهٔ بازدهی به‌علاوه بخشی از بازار کریپتو، دارایی واقعی یا سهام؛ رشد قیمت پیش‌بینی نمی‌شود.' },
  hedged_growth: { title: 'رشد با پوشش اختیاری', idea: 'بخش رشد با ابزار مشتقهٔ اختیاری؛ بدون نرخ زنده و مشخص بودن پوزیشن، سود فاندینگ یا اثر پوشش ریسک فرض نمی‌شود.' },
  funding_carry: { title: 'ابزار مشتقه — بدون فرض سود فاندینگ', idea: 'گزینهٔ جهت‌دار با ریسک بالا؛ فاندینگ فقط بعد از تعیین جهت، نرخ و وجه تضمین می‌تواند هزینه یا درآمد باشد.' },
  momentum: { title: 'مومنتوم جهت‌دار', idea: 'تمرکز روی بازارهای دارای دادهٔ زنده؛ ابزار مشتقه فقط در سطح ریسک تهاجمی و در سقف سیاست مجاز است.' }
});
const RISK_PROFILE_FA = { conservative: 'محافظه‌کار', balanced: 'متعادل', aggressive: 'تهاجمی' };
const REGIME_FA = { risk_on: 'ریسک‌پذیر', risk_off: 'احتیاطی', neutral: 'خنثی' };
const DOMAIN_FA = Object.freeze({
  wallet: 'کیف پول', portfolio: 'پرتفوی', crypto: 'بازار کریپتو', markets: 'بازارها',
  rwa: 'دارایی واقعی', stocks: 'سهام', forex: 'فارکس', commodities: 'کالاها',
  lending: 'وام‌دهی', farming: 'فارم', farm: 'فارم', liquidity: 'نقدینگی', staking: 'استیکینگ',
  futures: 'فیوچرز', dydx: 'dYdX', derivatives: 'ابزار مشتقه', bridge: 'بریج', swap: 'سواپ',
  smartMoney: 'اسمارت‌مانی', whales: 'نهنگ‌ها', news: 'اخبار', macro: 'اقتصاد کلان',
  risk: 'ریسک', fees: 'کارمزد', gas: 'گس شبکه', correlation: 'هم‌بستگی', monitoring: 'پایش',
  cash: 'نقد / استیبل', equity: 'سهام', commodity: 'کالا', fx: 'فارکس'
});
const OPERATION_FA = {
  BUY: 'خرید', SELL: 'فروش', SUPPLY: 'سپرده‌گذاری', DEPOSIT: 'سپرده‌گذاری',
  BORROW: 'وام گرفتن', REPAY: 'بازپرداخت', WITHDRAW: 'برداشت', STAKE: 'استیک کردن',
  SWAP: 'سواپ', BRIDGE: 'بریج', OPEN: 'باز کردن پوزیشن', HOLD: 'نگه داشتن',
  VERIFY: 'بررسی', CHECK: 'بررسی', CHECK_BALANCE: 'بررسی موجودی', CHECK_GAS: 'بررسی گس',
  CREATE_MONITOR: 'ایجاد پایش', READ_BALANCES: 'خواندن موجودی', CHECK_PERMISSIONS: 'بررسی مجوزها',
  VERIFY_CAPITAL: 'بررسی سرمایه', VERIFY_POLICY: 'بررسی سیاست'
};
const SOURCE_FA = { user: 'گفتهٔ شما', stated: 'گفتهٔ شما', portfolio: 'خوانش پرتفوی', wallet: 'خوانش کیف پول', balances: 'خوانش موجودی', parser: 'متن درخواست' };
const BREACH_FA = { DRAWDOWN_ABOVE_BUDGET: 'افت بیش از بودجه', RISK_BAND_BREACH: 'خروج از سطح ریسک', COST_INCOMPLETE: 'هزینهٔ ناقص' };
const GAP_REASON_FA = { timeout: 'مهلت خوانش تمام شد', error: 'خطای خوانش', empty: 'داده‌ای برنگشت', skipped: 'خوانده نشد', unavailable: 'در دسترس نیست', NO_READER: 'منبع خوانش در دسترس نیست' };
const isFa = (locale) => String(locale || 'fa').toLowerCase().startsWith('fa');

export const strategyDomainLabel = (id, locale = 'fa') => isFa(locale) ? (DOMAIN_FA[id] || id) : id;
export const strategyOperationLabel = (id, locale = 'fa') => isFa(locale) ? (OPERATION_FA[id] || 'بررسی اقدام') : id;
export const strategySourceLabel = (id, locale = 'fa') => isFa(locale) ? (SOURCE_FA[id] || 'اطلاعات ثبت‌شده') : id;
export const strategyBreachLabel = (id, locale = 'fa') => isFa(locale) ? (BREACH_FA[id] || 'محدودیت ریسک') : id;
export const strategyGapReason = (id, locale = 'fa') => isFa(locale) ? (GAP_REASON_FA[id] || 'خوانش معتبر در دسترس نیست') : id;

const STAGE_FA = {
  preflight: { title: 'پیش‌پرواز', objective: 'بررسی سرمایه، مجوزها، گس و سقف ریسک پیش از هر اقدامی.', rollback: 'پولی جابه‌جا نشده و اقدامی برای برگرداندن وجود ندارد.' },
  consolidate: { title: 'بریج دارایی پایه', rollback: 'مسیر برگشت به نرخ و تأیید جداگانه نیاز دارد؛ بازیابی خودکار نیست.' },
  'deploy-yield': { title: 'استقرار هسته سود', rollback: 'برداشت یا خروج از استیکینگ به دارایی پایه؛ با هزینه و تأیید جداگانه.' },
  'deploy-market': { title: 'استقرار بخش بازار', rollback: 'بستن پوزیشن یا فروش به دارایی پایه؛ با نرخ و تأیید جداگانه.' },
  monitor: { title: 'پایش و بازبینی', objective: 'پایش بازده واقعی، منحنی برنامه و بودجه افت؛ پیشنهاد بازسازی در صورت انحراف.', rollback: 'فقط پایش؛ پولی جابه‌جا نشده است.' }
};
const ENTER_FA = {
  'user approves': 'پس از تأیید شما', 'pre-flight passed': 'پس از گذر از پیش‌پرواز',
  'base asset in place': 'پس از آماده شدن دارایی پایه',
  'all preceding stages confirmed': 'پس از تأیید همهٔ مراحل قبلی',
  'all deployment stages confirmed': 'پس از تأیید مراحل استقرار'
};
const MONITOR_FA = {
  'drawdown-budget': { action: 'پیشنهاد کم‌ریسک کردن: کوچک کردن بخش بازار و انتقال به هسته بازدهی' },
  'target-pace': { action: 'بازسازی با نرخ‌های تازه و گزارش صریح فاصله از هدف' },
  'floor-breach': { action: 'بازسازی و اعلام صریح اینکه حداقل هدف در مسیر نیست' },
  'rate-decay': { condition: 'افت نرخ سالانهٔ زندهٔ یک بخش بیش از ۳۰٪ نسبت به زمان ساخت برنامه', action: 'پیشنهاد انتقال آن بخش به بهترین نرخ زنده در همان سطح ریسک' },
  'regime-flip': { condition: 'چرخش وضعیت بازار بین ریسک‌پذیر و احتیاطی در دو خوانش پیاپی', action: 'بازبینی وزن بخش بازار و امتیازدهی دوبارهٔ گزینه‌ها' }
};
const fmt = (value) => num(value) == null ? '—' : r2(value);

function honestyFa(strategy) {
  const v = strategy.verdict || {};
  const goal = strategy.goal || {};
  const horizon = goal.horizonDays ?? '—';
  if (v.reachable) {
    return `این یک برنامه است نه یک قول. با ثابت ماندن نرخ‌های متغیر امروز، بازده برآوردی ${fmt(v.expectedReturnPct)}٪ در ${horizon} روز است. نرخ‌ها، هزینه‌ها و قیمت می‌توانند تغییر کنند؛ این عدد تضمین سود نیست.`;
  }
  const stretch = (strategy.comparison || []).find((c) => c.id === strategy.alternatives?.stretch);
  const range = v.rangePct ?? stretch?.rangePct;
  return `هدفت به ${fmt(v.requiredApyPct)}٪ بازده سالانه نیاز دارد. نرخ‌های متغیرِ خوانده‌شدهٔ امروز، پیش از هزینهٔ ورود، حدود ${fmt(v.sourcedReturnPct)}٪ در ${horizon} روز را پشتیبانی می‌کنند`
    + (v.daysToTargetAtPlanRate != null ? `؛ با همین نرخ خالص حدود ${Math.round(v.daysToTargetAtPlanRate)} روز برای هدف لازم است` : '')
    + `. فاصلهٔ ${fmt(v.priceGapPct)} واحد درصدی با سودِ منبع‌دار پوشش داده نشده و فقط رشد قیمت می‌تواند آن را جبران کند؛ برای قیمت پیش‌بینی ندارم. `
    + (range != null ? `دامنهٔ تنشِ تقریبی ±${fmt(range)}٪ فقط از حرکت ۲۴ ساعت اخیر مشتق شده، نه از پیش‌بینی آماری.` : 'دادهٔ کافی برای دامنهٔ تنش هم ندارم.')
    + ' هدف شما را به وعدهٔ سود تبدیل نمی‌کنم.';
}

function stretchNoteFa(strategy) {
  const id = strategy.alternatives?.stretch;
  if (!id) return null;
  const row = (strategy.comparison || []).find((c) => c.id === id) || {};
  return `گزینهٔ «${BLUEPRINT_FA[id]?.title || row.title || 'جایگزین'}» ${fmt(row.priceExposurePct)}٪ سرمایه را در معرض قیمت می‌گذارد. رسیدن به هدف ${fmt(strategy.goal?.targetPct)}٪ در این مسیر به رشد قیمت وابسته است و پشتیبانیِ پیش‌بینی‌شده ندارد. دامنهٔ تنش تقریبی ${row.rangePct != null ? `±${fmt(row.rangePct)}٪` : 'خوانده نشده است'}؛ این دامنه احتمال موفقیت یا حد ضرر نیست.`;
}

function rankingFa(strategy) {
  const rows = strategy.comparison || [];
  const winner = rows.find((r) => r.id === strategy.chosen) || rows[0] || {};
  return rows.map((row) => {
    const chosen = row.id === winner.id;
    const reasons = [];
    if ((row.expectedReturnPct ?? -999) < (winner.expectedReturnPct ?? -999)) reasons.push('بازده موردانتظار کمتر');
    if ((row.riskPct ?? 0) > (winner.riskPct ?? 0)) reasons.push('افت برآوردی بیشتر');
    if ((row.confidence || 0) < (winner.confidence || 0)) reasons.push('پشتوانهٔ خوانش زنده کمتر');
    if (row.riskBandBreach) reasons.push('خارج از سطح ریسک شما');
    return {
      ...(strategy.ranking || []).find((r) => r.id === row.id),
      id: row.id, verdict: chosen ? 'CHOSEN' : 'REJECTED',
      reason: chosen
        ? `${strategy.selection?.source === 'user' ? 'انتخاب صریح شما' : 'بالاترین امتیاز'}: بازده برآوردی ${fmt(row.expectedReturnPct)}٪ در بازه، اتکای داده ${Math.round((row.confidence || 0) * 100)}٪ و افت برآوردی ${fmt(row.riskPct)}٪.`
        : reasons.join('، ') || 'این گزینه انتخاب نشده است'
    };
  });
}

function stageObjectiveFa(stage, strategy) {
  const amount = (stage.actions || []).reduce((sum, a) => sum + (num(a.params?.amountUsd) || 0), 0);
  const capital = num(strategy.goal?.capitalUsd);
  // Fall back to the engine's literal only for legacy plans with no action amounts.
  const literal = String(stage.objective || '').match(/([\d.]+)\s*(?:%|٪|USD|دلار)/i)?.[1];
  const share = capital > 0 && amount > 0 ? fmt(amount / capital * 100) : (literal || '—');
  if (stage.id === 'consolidate') return `انتقال حدود ${amount > 0 ? fmt(amount) : literal || '—'} دلار از دارایی پایه به شبکه‌های لازم؛ در این مرحله خرید دارایی انجام نمی‌شود.`;
  if (stage.id === 'deploy-yield') return `استقرار ${share}٪ سرمایه در مسیرهای دارای نرخ منبع‌دار؛ نرخ، هزینه و ریسک پروتکل پیش از امضا دوباره بررسی می‌شود.`;
  if (stage.id === 'deploy-market') return `افزودن ${share}٪ سرمایه با ریسک قیمت در سطح ریسک انتخاب‌شده؛ رشد قیمت فرض نمی‌شود.`;
  return STAGE_FA[stage.id]?.objective || stage.objective;
}

function monitorConditionFa(m, strategy) {
  const goal = strategy.goal || {};
  if (m.id === 'drawdown-budget') return `افت پرتفوی از شروع برنامه بیش از ${fmt(strategy.risk?.drawdownBudgetPct)}٪`;
  if (m.id === 'target-pace') return `بازده واقعی کمتر از ۵۰٪ منحنی برنامه در نیمهٔ بازه (${Math.round((goal.horizonDays || 0) / 2)} روز)`;
  if (m.id === 'floor-breach') return `بازده نهایی برآوردی کمتر از ${fmt(goal.floorPct ?? goal.targetPct)}٪، هدف اعلامی شما`;
  return MONITOR_FA[m.id]?.condition || m.condition;
}

function limitationFa(text) {
  const s = String(text || '');
  if (/Expected returns (?:come from live APYs|use current variable APYs)/i.test(s)) return 'بازده‌ها بر اساس نرخ‌های سالانهٔ متغیر امروز هستند، نه نرخ تضمین‌شدهٔ آینده؛ حرکت روزانه فقط مبنای سناریوی تنش است، نه پیش‌بینی آماری.';
  if (/Nothing here signs or broadcasts/i.test(s)) return 'این کارت هیچ تراکنشی را امضا یا ارسال نمی‌کند؛ هر مرحله به مسیر واقعیِ اجرا تحویل داده می‌شود و امضا با کیف پول شماست.';
  if (/Planned on the capital you stated/i.test(s)) return 'برنامه بر اساس سرمایهٔ اعلامی شما ساخته شده؛ کیف پول خوانده نشده و دارایی‌های فعلی و تمرکز آن‌ها در این برنامه لحاظ نشده‌اند.';
  if (/Not read this turn/i.test(s)) {
    const domains = s.match(/Not read this turn:\s*(.+?)\.?$/i)?.[1]?.replace(/\.$/, '').split(/,\s*/) || [];
    return `در این نوبت خوانده نشد: ${domains.map((id) => strategyDomainLabel(id, 'fa')).join('، ') || 'برخی منابع'}.`;
  }
  if (/Gas was unread/i.test(s)) return 'گس شبکه خوانده نشده؛ رقم هزینه حداقلِ هزینهٔ شناخته‌شده است و هزینهٔ نهایی نیست.';
  if (/split.*transaction/i.test(s)) return 'اقدام‌های بزرگ برای رعایت سقف هر تراکنش تقسیم شده‌اند؛ هر بخش به بررسی، تأیید و امضای جداگانه نیاز دارد و گسِ اضافی باید دوباره خوانده شود.';
  return s;
}

/** Immutable and idempotent. Refusal copies live in StrategyPlanCard. */
export function localizeStrategy(strategy, locale = 'fa') {
  if (!strategy || typeof strategy !== 'object' || !isFa(locale) || strategy.ok === false) return strategy;
  const out = typeof structuredClone === 'function' ? structuredClone(strategy) : JSON.parse(JSON.stringify(strategy));
  out.locale = 'fa';
  if (Array.isArray(out.comparison)) out.comparison = out.comparison.map((c) => ({ ...c,
    title: BLUEPRINT_FA[c.id]?.title || c.title, idea: BLUEPRINT_FA[c.id]?.idea || c.idea }));
  if (out.comparison?.length) out.ranking = rankingFa(out);
  out.honesty = honestyFa(out);
  if (out.alternatives) out.alternatives = { ...out.alternatives, stretchNote: stretchNoteFa(out) };
  if (out.goal) out.goal.riskProfileFa = RISK_PROFILE_FA[out.goal.riskProfile] || out.goal.riskProfile;
  if (out.marketView) out.marketView.regimeFa = REGIME_FA[out.marketView.regime] || out.marketView.regime;
  if (Array.isArray(out.stages)) out.stages = out.stages.map((stage) => ({ ...stage,
    title: STAGE_FA[stage.id]?.title || stage.title,
    objective: stageObjectiveFa(stage, out),
    rollback: STAGE_FA[stage.id]?.rollback || stage.rollback,
    enterWhen: ENTER_FA[stage.enterWhen] || stage.enterWhen
  }));
  if (Array.isArray(out.monitors)) out.monitors = out.monitors.map((m) => ({ ...m,
    condition: monitorConditionFa(m, out), action: MONITOR_FA[m.id]?.action || m.action }));
  if (Array.isArray(out.limitations)) out.limitations = out.limitations.map(limitationFa);
  if (Array.isArray(out.risk?.breaches)) out.risk.breaches = out.risk.breaches.map((b) => ({ ...b,
    detail: String(b.detail || '')
      .replace(/estimated\s+([\d.]+)%\s+vs\s+budget\s+([\d.]+)%/i, 'برآورد $1٪ در برابر بودجه $2٪')
      .replace(/weighted risk rank\s+([\d.]+)\s*>\s*([\d.]+)/i, 'رتبهٔ ریسک وزنی $1 بیشتر از $2')
      .replace(/gas unread — the cost below excludes it/i, 'گس خوانده نشده و رقم هزینه آن را شامل نمی‌شود')
  }));
  return out;
}

export const STRATEGY_LOCALE_TEST_IDS = Object.freeze({ blueprintCount: Object.keys(BLUEPRINT_FA).length });
