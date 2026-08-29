/**
 * FBT INTENT AI — PHASES 121–130: INTENT OS OUTPUT LOCALIZATION
 * ---------------------------------------------------------------------------
 * The UI speaks twelve languages; until now the plans, progress reports and
 * safety warnings produced by Intent OS were assembled in whatever language
 * the module author happened to write. A profit plan that a user cannot read
 * is a decoration, not functionality.
 *
 * Rules (same honesty contract as parserLocales):
 *   · every template exists for the twelve UI locales OR the string falls
 *     back to English WITH a visible "(EN)" marker — never a silent
 *     half-translated sentence
 *   · numbers are formatted with locale digits where the locale uses them
 *     (fa, ar, hi), and with locale decimal separators elsewhere
 *   · translation NEVER adds a claim the plan does not contain — a missing
 *     number renders as "—", not as a guessed default
 */

import { PROFIT_PLAN_SCHEMA } from './multiVenuePlanner.js';

export const OUTPUT_LOCALE_SCHEMA = 'fbt.intent-output-locales.v1';

export const OUTPUT_LOCALES = Object.freeze([
  'en', 'fa', 'ar', 'tr', 'ru', 'zh', 'hi', 'ur', 'id', 'es', 'pt', 'fr'
]);

const DIGIT_SETS = Object.freeze([
  ['fa', '۰۱۲۳۴۵۶۷۸۹'],
  ['ar', '٠١٢٣٤٥٦٧٨٩'],
  ['hi', '०१२३४५६७८९']
]);

const DECIMAL_LOCALES = new Set(['tr', 'ru', 'zh', 'hi', 'ur', 'id', 'es', 'pt', 'fr']);

export function formatNumber(value, lang, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const base = lang && DECIMAL_LOCALES.has(lang) ? ',' : '.';
  let text = n.toFixed(digits).replace('.', base);
  const digit = DIGIT_SETS.find(([code]) => code === lang);
  if (digit) {
    text = text.split('').map((ch) => {
      const idx = '0123456789'.indexOf(ch);
      return idx >= 0 ? digit[1][idx] : ch;
    }).join('');
  }
  return text;
}

export function formatPct(value, lang) {
  const n = Number(value);
  return Number.isFinite(n) ? `${formatNumber(n, lang, 1)}%` : '—';
}

/* Compact templates per locale for the plan summary and the progress line.
   {{...}} slots are filled from the plan only. */
const TEMPLATES = Object.freeze({
  'plan.summary': {
    en: 'Plan for {{capital}} USDC over {{horizon}} days: {{yield}}% expected per year across {{venues}} venue classes. Target: {{target}}.',
    fa: 'برنامه برای {{capital}} USDC در {{horizon}} روز: بازده موردانتظار سالانه {{yield}}٪ در {{venues}} کلاس بازار. هدف: {{target}}.',
    ar: 'خطة لـ {{capital}} USDC على {{horizon}} يوم: عائد سنوي متوقع {{yield}}٪ عبر {{venues}} فئات أسواق. الهدف: {{target}}.',
    tr: '{{capital}} USDC için {{horizon}} günlük plan: {{venues}} pazar sınıfında yıllık {{yield}}% beklenen getiri. Hedef: {{target}}.',
    ru: 'План на {{capital}} USDC на {{horizon}} дней: {{yield}}% ожидаемой годовой доходности по {{venues}} классам рынков. Цель: {{target}}.',
    zh: '{{capital}} USDC、{{horizon}} 天计划：{{venues}} 类市场的预期年化 {{yield}}%。目标：{{target}}。',
    hi: '{{capital}} USDC का {{horizon}} दिनों का प्लान: {{venues}} बाज़ार श्रेणियों में अपेक्षित वार्षिक {{yield}}%। लक्ष्य: {{target}}।',
    ur: '{{capital}} USDC کا {{horizon}} دن کا منصوبہ: {{venues}} بازار کی اقسام میں متوقع سالانہ {{yield}}%۔ ہدف: {{target}}۔',
    id: 'Rencana {{capital}} USDC selama {{horizon}} hari: ekspektasi {{yield}}% per tahun di {{venues}} kelas pasar. Target: {{target}}.',
    es: 'Plan de {{capital}} USDC a {{horizon}} días: {{yield}}% anual esperado en {{venues}} clases de mercado. Objetivo: {{target}}.',
    pt: 'Plano de {{capital}} USDC por {{horizon}} dias: {{yield}}% ao ano esperado em {{venues}} classes de mercado. Meta: {{target}}.',
    fr: 'Plan de {{capital}} USDC sur {{horizon}} jours : {{yield}}% par an attendu sur {{venues}} classes de marché. Objectif : {{target}}.'
  },
  'plan.notGuaranteed': {
    en: 'These figures are estimates from live venue data, not promises — returns are not guaranteed.',
    fa: 'این ارقام برآوردِ دادهٔ زندهٔ بازارند، نه وعده — سود تضمین‌شده نیست.',
    ar: 'هذه أرقام تقديرية من بيانات السوق الحية وليست وعودًا — العوائد غير مضمونة.',
    tr: 'Bu rakamlar canlı veri tahminleridir, vaat değildir — getiri garanti edilmez.',
    ru: 'Это оценки на основе живых данных, а не обещания — доходность не гарантируется.',
    zh: '这些数字基于实时市场数据的估算，并非承诺——收益不保证。',
    hi: 'ये आंकड़े लाइव डेटा के अनुमान हैं, वादे नहीं — रिटर्न की गारंटी नहीं है।',
    ur: 'یہ اعداد زندہ ڈیٹا کے تخمینے ہیں، وعدے نہیں — منافع کی ضمانت نہیں۔',
    id: 'Angka ini perkiraan dari data pasar langsung, bukan janji — imbal hasil tidak dijamin.',
    es: 'Son estimaciones con datos en vivo, no promesas — la rentabilidad no está garantizada.',
    pt: 'São estimativas com dados ao vivo, não promessas — o retorno não é garantido.',
    fr: 'Ce sont des estimations sur données réelles, pas des promesses — le rendement n\u2019est pas garanti.'
  },
  'plan.targetUnreachable': {
    en: 'The target is not reachable from current live yields without stretching risk beyond the profile (≈{{years}} years at current rates). The plan shows the honest ceiling instead.',
    fa: 'هدف با بازده فعلیِ زنده و بدون عبور از ریسک پروفایل قابل دسترسی نیست (حدود {{years}} سال با نرخ فعلی). برنامه سقف صادقانه را نشان می‌دهد.',
    ar: 'الهدف غير قابل للتحقيق من العوائد الحالية دون تجاوز حدود المخاطر (نحو {{years}} سنة بالمعدلات الحالية). تعرض الخطة السقف الصادق.',
    tr: 'Hedef, mevcut canlı getirilerle risk profilini aşmadan ulaşılabilir değil (mevcut oranlarla ≈{{years}} yıl). Plan dürüst tavanı gösterir.',
    ru: 'Цель недостижима при текущих живых доходностях без превышения риск-профиля (≈{{years}} лет при текущих ставках). План показывает честный потолок.',
    zh: '在不超出风险档的前提下，当前实时收益率无法达成该目标（按当前利率约 {{years}} 年）。计划将展示真实的收益上限。',
    hi: 'जोखिम सीमा तोड़े बिना मौजूदा लाइव यील्ड से लक्ष्य अप्राप्य है (वर्तमान दरों पर ≈{{years}} वर्ष)। प्लान ईमानदार सीमा दिखाता है।',
    ur: 'خطر کی حد توڑے بغیر موجودہ لائیو ییلڈ سے ہدف ممکن نہیں (موجودہ شرحوں پر ≈{{years}} سال)۔ منصوبہ ایماندارانہ حد دکھاتا ہے۔',
    id: 'Target tidak tercapai dari imbal hasil langsung saat ini tanpa melampaui profil risiko (≈{{years}} tahun pada kurs saat ini). Rencana menampilkan batas jujur.',
    es: 'El objetivo no es alcanzable con los rendimientos actuales sin exceder el perfil de riesgo (≈{{years}} años a las tasas actuales). El plan muestra el techo honesto.',
    pt: 'A meta não é alcançável com os rendimentos atuais sem exceder o perfil de risco (≈{{years}} anos às taxas atuais). O plano mostra o teto honesto.',
    fr: 'L\u2019objectif est inatteignable avec les rendements actuels sans dépasser le profil de risque (≈{{years}} ans aux taux actuels). Le plan montre le plafond honnête.'
  },
  'progress.line': {
    en: 'Progress {{progress}}% of target · {{remaining}} USDC remaining · {{pace}}',
    fa: 'پیشرفت {{progress}}٪ از هدف · {{remaining}} USDC مانده · {{pace}}',
    ar: 'التقدم {{progress}}٪ من الهدف · المتبقي {{remaining}} USDC · {{pace}}',
    tr: 'İlerleme {{progress}}% · kalan {{remaining}} USDC · {{pace}}',
    ru: 'Прогресс {{progress}}% от цели · осталось {{remaining}} USDC · {{pace}}',
    zh: '进度 {{progress}}% · 剩余 {{remaining}} USDC · {{pace}}',
    hi: 'प्रगति {{progress}}% · शेष {{remaining}} USDC · {{pace}}',
    ur: 'پیش رفت {{progress}}% · باقی {{remaining}} USDC · {{pace}}',
    id: 'Kemajuan {{progress}}% · sisa {{remaining}} USDC · {{pace}}',
    es: 'Progreso {{progress}}% · quedan {{remaining}} USDC · {{pace}}',
    pt: 'Progresso {{progress}}% · restam {{remaining}} USDC · {{pace}}',
    fr: 'Progression {{progress}}% · reste {{remaining}} USDC · {{pace}}'
  },
  'pace.on': { en: 'on pace', fa: 'در مسیر', ar: 'على المسار', tr: 'yolunda', ru: 'по графику', zh: '按计划', hi: 'सही दिशा में', ur: 'صحیح راستے پر', id: 'sesuai jadwal', es: 'en ritmo', pt: 'no ritmo', fr: 'dans les temps' },
  'pace.behind': { en: 'behind pace', fa: 'عقب‌تر از مسیر', ar: 'متأخر عن المسار', tr: 'geride', ru: 'отстаёт', zh: '落后于计划', hi: 'पीछे', ur: 'پیچھے', id: 'tertinggal', es: 'retrasado', pt: 'atrasado', fr: 'en retard' }
});

/** Render one template in a locale. Missing locale → English + visible marker. */
export function renderTemplate(key, lang, params = {}) {
  const templates = TEMPLATES[key];
  if (!templates) return null;
  const code = OUTPUT_LOCALES.includes(lang) ? lang : 'en';
  const marked = OUTPUT_LOCALES.includes(lang);
  let text = templates[code] || templates.en;
  for (const [name, value] of Object.entries(params)) {
    text = text.split(`{{${name}}}`).join(String(value));
  }
  return marked ? text : `${text} (EN)`;
}

/** Localized one-line summary of a profit plan. */
export function localizePlan(plan, lang = 'en') {
  if (!plan || plan.schema !== PROFIT_PLAN_SCHEMA) return null;
  const pct = plan.projectedAnnualYieldPct;
  return renderTemplate('plan.summary', lang, {
    capital: formatNumber(plan.capitalUsd, lang, 0),
    horizon: formatNumber(plan.horizonDays, lang, 0),
    yield: formatNumber(pct, lang, 1),
    venues: formatNumber(plan.venuesSeen, lang, 0),
    target: plan.target?.mode === 'usd'
      ? formatNumber(plan.targetUsdAtHorizon, lang, 0) + ' USDC'
      : formatPct(plan.neededPct, lang)
  });
}

/** Localized one-line progress report. */
export function localizeProgress(progress, lang = 'en') {
  if (!progress || progress.schema !== 'fbt.target-progress.v1') return null;
  return renderTemplate('progress.line', lang, {
    progress: formatNumber(progress.progressPct, lang, 1),
    remaining: formatNumber(progress.remainingUsd, lang, 0),
    pace: renderTemplate(progress.onPace ? 'pace.on' : 'pace.behind', lang)
  });
}

/** The twelve locales the intent OS can now SPEAK (vs the three it parsed). */
export function outputLocaleSupport(lang) {
  return {
    schema: OUTPUT_LOCALE_SCHEMA,
    requested: String(lang || 'en'),
    supported: OUTPUT_LOCALES.includes(lang),
    fallback: OUTPUT_LOCALES.includes(lang) ? null : 'en',
    locales: [...OUTPUT_LOCALES]
  };
}
