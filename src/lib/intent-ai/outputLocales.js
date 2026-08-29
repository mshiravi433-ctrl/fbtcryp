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
import { PERPS_LABELS } from './speculativeLexicon.js';

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
  'pace.behind': { en: 'behind pace', fa: 'عقب‌تر از مسیر', ar: 'متأخر عن المسار', tr: 'geride', ru: 'отстаёт', zh: '落后于计划', hi: 'पीछे', ur: 'پیچھے', id: 'tertinggal', es: 'retrasado', pt: 'atrasado', fr: 'en retard' },

  /* ── INTENT PLANNER (intentPlanner.js) ───────────────────────────────────
   * The planner answers a customer who did not have the details. Its whole
   * value is that a human can read the proposal and argue with it, so the
   * proposal has to arrive in their language — an assumption list in English
   * to a Persian-speaking customer is an assumption nobody checked.
   *
   * Twelve locales for every key, matching the contract at the top of this
   * file. Nothing here falls back silently.
   */
  'intentPlan.head.preserve': {
    en: 'Keeping the capital intact comes first, so most of it stops moving.',
    fa: 'اولویت حفظ سرمایه است، برای همین بیشتر آن دیگر جابه‌جا نمی‌شود.',
    ar: 'الحفاظ على رأس المال أولًا، لذا يتوقف معظمه عن الحركة.',
    tr: 'Önce sermayeyi korumak: büyük kısmı artık hareket etmiyor.',
    ru: 'Сначала сохранность капитала, поэтому большая его часть перестаёт двигаться.',
    zh: '先保住本金，因此大部分资金不再波动。',
    hi: 'पहले पूँजी बचानी है, इसलिए उसका बड़ा हिस्सा अब हिलता नहीं।',
    ur: 'پہلے سرمایہ محفوظ رکھنا ہے، اس لیے اس کا بڑا حصہ اب حرکت نہیں کرتا۔',
    id: 'Menjaga modal utuh lebih dulu, jadi sebagian besarnya berhenti bergerak.',
    es: 'Primero está conservar el capital, así que la mayor parte deja de moverse.',
    pt: 'Preservar o capital vem primeiro, então a maior parte deixa de se mover.',
    fr: 'Préserver le capital d\u2019abord : la plus grande partie ne bouge plus.'
  },
  'intentPlan.head.income': {
    en: 'Built for a yield stream rather than price movement.',
    fa: 'برای جریان درآمد ساخته شده، نه نوسان قیمت.',
    ar: 'مصمم لتدفق عائد لا لتقلبات الأسعار.',
    tr: 'Fiyat hareketi için değil, gelir akışı için kuruldu.',
    ru: 'Построен под поток дохода, а не под движение цены.',
    zh: '为收益流而非价格波动而设计。',
    hi: 'कीमत की चाल के लिए नहीं, आय-धारा के लिए बनाया गया।',
    ur: 'قیمت کی چال کے لیے نہیں، آمدنی کے بہاؤ کے لیے بنایا گیا۔',
    id: 'Dirancang untuk aliran imbal hasil, bukan pergerakan harga.',
    es: 'Pensado para un flujo de rendimiento, no para el movimiento del precio.',
    pt: 'Feito para um fluxo de rendimento, não para o movimento do preço.',
    fr: 'Conçu pour un flux de rendement, pas pour le mouvement du prix.'
  },
  'intentPlan.head.growth': {
    en: 'Weighted toward the deepest markets, with the speculative part deliberately capped.',
    fa: 'بیشتر در عمیق‌ترین بازارها، و بخش پرمخاطره عمداً محدود شده است.',
    ar: 'الوزن الأكبر للأسواق الأعمق، والجزء المضاربي محدود عمدًا.',
    tr: 'Ağırlık en derin piyasalarda; spekülatif kısım bilinçli olarak sınırlı.',
    ru: 'Вес смещён к самым ликвидным рынкам, спекулятивная часть сознательно ограничена.',
    zh: '权重偏向最深的市场，投机部分刻意受限。',
    hi: 'वज़न सबसे गहरे बाज़ारों में, और सट्टा हिस्सा जान-बूझकर सीमित।',
    ur: 'وزن سب سے گہرے بازاروں میں، اور قیاس آرائی کا حصہ جان بوجھ کر محدود۔',
    id: 'Bobot diarahkan ke pasar terdalam, bagian spekulatif sengaja dibatasi.',
    es: 'Ponderado hacia los mercados más profundos, con la parte especulativa limitada a propósito.',
    pt: 'Ponderado para os mercados mais profundos, com a parte especulativa limitada de propósito.',
    fr: 'Pondéré vers les marchés les plus profonds, la partie spéculative étant volontairement plafonnée.'
  },
  'intentPlan.head.speculate': {
    en: 'This is an aggressive plan and the worst case is a real loss.',
    fa: 'این یک برنامه تهاجمی است و بدترین حالت آن زیان واقعی است.',
    ar: 'هذه خطة هجومية وأسوأ حالاتها خسارة حقيقية.',
    tr: 'Bu agresif bir plan; en kötü senaryo gerçek bir kayıptır.',
    ru: 'Это агрессивный план, и худший сценарий — реальный убыток.',
    zh: '这是一个激进的计划，最坏情况是真实亏损。',
    hi: 'यह आक्रामक प्लान है और सबसे बुरी स्थिति में असली नुकसान है।',
    ur: 'یہ جارحانہ منصوبہ ہے اور بدترین صورت میں حقیقی نقصان ہے۔',
    id: 'Ini rencana agresif dan skenario terburuknya adalah kerugian nyata.',
    es: 'Es un plan agresivo y el peor caso es una pérdida real.',
    pt: 'É um plano agressivo e o pior caso é uma perda real.',
    fr: 'C\u2019est un plan agressif et le pire cas est une perte réelle.'
  },
  'intentPlan.head.default': {
    en: 'A default allocation.',
    fa: 'یک تخصیص پیش‌فرض.',
    ar: 'توزيع افتراضي.',
    tr: 'Varsayılan bir dağılım.',
    ru: 'Распределение по умолчанию.',
    zh: '默认配置。',
    hi: 'डिफ़ॉल्ट आवंटन।',
    ur: 'طے شدہ تقسیم۔',
    id: 'Alokasi bawaan.',
    es: 'Una asignación predeterminada.',
    pt: 'Uma alocação padrão.',
    fr: 'Une allocation par défaut.'
  },
  'intentPlan.summary': {
    en: '{{head}} Split: {{split}} — about {{capital}} in total, worst case roughly -{{drawdown}}%.',
    fa: '{{head}} تقسیم: {{split}} — در مجموع حدود {{capital}}، بدترین حالت تقریباً ‎-{{drawdown}}٪.',
    ar: '{{head}} التوزيع: {{split}} — الإجمالي نحو {{capital}}، وأسوأ حالة نحو -{{drawdown}}٪.',
    tr: '{{head}} Dağılım: {{split}} — toplam yaklaşık {{capital}}, en kötü durum yaklaşık -{{drawdown}}%.',
    ru: '{{head}} Распределение: {{split}} — всего около {{capital}}, худший случай примерно -{{drawdown}}%.',
    zh: '{{head}} 分配：{{split}} —— 合计约 {{capital}}，最坏情况约 -{{drawdown}}%。',
    hi: '{{head}} बँटवारा: {{split}} — कुल लगभग {{capital}}, सबसे बुरी स्थिति लगभग -{{drawdown}}%.',
    ur: '{{head}} تقسیم: {{split}} — کل تقریباً {{capital}}، بدترین صورت تقریباً -{{drawdown}}%۔',
    id: '{{head}} Pembagian: {{split}} — total sekitar {{capital}}, skenario terburuk sekitar -{{drawdown}}%.',
    es: '{{head}} Reparto: {{split}} — unos {{capital}} en total, peor caso aproximadamente -{{drawdown}}%.',
    pt: '{{head}} Divisão: {{split}} — cerca de {{capital}} no total, pior caso cerca de -{{drawdown}}%.',
    fr: '{{head}} Répartition : {{split}} — environ {{capital}} au total, pire cas environ -{{drawdown}}%.'
  },
  'intentPlan.feasibility.plausible': {
    en: 'Within the range passive strategies have historically produced. Not a guarantee.',
    fa: 'در بازه‌ای است که راهبردهای غیرفعال به‌طور تاریخی ساخته‌اند. تضمین نیست.',
    ar: 'ضمن النطاق الذي حققته الاستراتيجيات السلبية تاريخيًا. ليس ضمانًا.',
    tr: 'Pasif stratejilerin tarihsel olarak ürettiği aralıkta. Garanti değildir.',
    ru: 'В диапазоне, который пассивные стратегии давали исторически. Не гарантия.',
    zh: '处于被动策略历史上产生过的区间内。并非保证。',
    hi: 'उस दायरे में जो निष्क्रिय रणनीतियों ने ऐतिहासिक रूप से दिया है। गारंटी नहीं।',
    ur: 'اس دائرے میں جو غیر فعال حکمتِ عملیوں نے تاریخی طور پر دیا۔ ضمانت نہیں۔',
    id: 'Dalam rentang yang pernah dihasilkan strategi pasif. Bukan jaminan.',
    es: 'Dentro del rango que las estrategias pasivas han producido históricamente. No es una garantía.',
    pt: 'Dentro da faixa que estratégias passivas produziram historicamente. Não é garantia.',
    fr: 'Dans la fourchette que les stratégies passives ont historiquement produite. Pas une garantie.'
  },
  'intentPlan.feasibility.stretch': {
    en: 'Needs real market movement in your favour, or a riskier allocation than this one. Expect drawdowns on the way.',
    fa: 'به حرکت واقعی بازار به نفع شما یا تخصیص پرمخاطره‌تری نیاز دارد. در مسیر، افت سرمایه را انتظار داشته باشید.',
    ar: 'يحتاج حركة سوق حقيقية لصالحك أو توزيعًا أعلى مخاطرة. توقع تراجعات في الطريق.',
    tr: 'Lehinize gerçek bir piyasa hareketi ya da daha riskli bir dağılım gerekir. Yol boyunca düşüşler bekleyin.',
    ru: 'Нужно реальное движение рынка в вашу пользу или более рискованное распределение. Ожидайте просадок.',
    zh: '需要市场真实地向有利方向移动，或采用风险更高的配置。途中会有回撤。',
    hi: 'बाज़ार का आपके पक्ष में असली चलन चाहिए, या इससे अधिक जोखिम वाला आवंटन। रास्ते में गिरावट आ सकती है।',
    ur: 'مارکیٹ کی آپ کے حق میں اصل حرکت یا اس سے زیادہ پرخطر تقسیم درکار ہے۔ راستے میں کمی متوقع ہے۔',
    id: 'Butuh pergerakan pasar nyata yang menguntungkan, atau alokasi yang lebih berisiko. Siap-siap drawdown.',
    es: 'Requiere movimiento real del mercado a tu favor, o una asignación más arriesgada. Espera caídas por el camino.',
    pt: 'Exige movimento real do mercado a seu favor, ou uma alocação mais arriscada. Espere quedas no caminho.',
    fr: 'Nécessite un vrai mouvement du marché en votre faveur, ou une allocation plus risquée. Attendez-vous à des baisses.'
  },
  'intentPlan.feasibility.unlikely': {
    en: 'Achievable in this market and not plannable. Treat the target as a wish, not a projection.',
    fa: 'در این بازار شدنی است ولی قابل برنامه‌ریزی نیست. هدف را آرزو بدانید، نه پیش‌بینی.',
    ar: 'قابل للتحقق في هذا السوق لكنه غير قابل للتخطيط. اعتبر الهدف أمنية لا توقعًا.',
    tr: 'Bu piyasada gerçekleşebilir ama planlanamaz. Hedefi bir dilek sayın, bir öngörü değil.',
    ru: 'Достижимо на этом рынке, но не планируется. Считайте цель желанием, а не прогнозом.',
    zh: '在这个市场里可能发生，但无法计划。把目标当愿望，而不是预测。',
    hi: 'इस बाज़ार में हो सकता है पर योजना नहीं बन सकती। लक्ष्य को इच्छा मानें, अनुमान नहीं।',
    ur: 'اس مارکیٹ میں ممکن ہے مگر منصوبہ نہیں بن سکتا۔ ہدف کو خواہش سمجھیں، تخمینہ نہیں۔',
    id: 'Mungkin terjadi di pasar ini tapi tidak bisa direncanakan. Anggap target sebagai harapan, bukan proyeksi.',
    es: 'Alcanzable en este mercado y no planificable. Trátalo como un deseo, no una proyección.',
    pt: 'Alcançável neste mercado e não planeável. Trate a meta como um desejo, não uma projeção.',
    fr: 'Réalisable sur ce marché et non planifiable. Considérez l\u2019objectif comme un souhait, pas une projection.'
  },
  'intentPlan.feasibility.implausible': {
    en: 'No strategy available here targets this. The honest answer is that it is a bet, not a plan.',
    fa: 'هیچ راهبرد موجودی اینجا این را هدف نمی‌گیرد. پاسخ صادقانه این است که این شرط‌بندی است، نه برنامه.',
    ar: 'لا استراتيجية متاحة هنا تستهدف هذا. الإجابة الصادقة أنه رهان لا خطة.',
    tr: 'Burada hiçbir strateji bunu hedeflemiyor. Dürüst cevap: bu bir plan değil, bir bahistir.',
    ru: 'Ни одна доступная здесь стратегия на это не нацелена. Честный ответ: это ставка, а не план.',
    zh: '这里没有策略以此为目标。诚实的答案是：这是赌博，不是计划。',
    hi: 'यहाँ कोई रणनीति इसे लक्ष्य नहीं बनाती। ईमानदार जवाब: यह दाँव है, प्लान नहीं।',
    ur: 'یہاں کوئی حکمتِ عملی اسے ہدف نہیں بناتی۔ دیانت دارانہ جواب: یہ شرط ہے، منصوبہ نہیں۔',
    id: 'Tidak ada strategi di sini yang menargetkan ini. Jawaban jujurnya: ini taruhan, bukan rencana.',
    es: 'Ninguna estrategia disponible apunta a esto. La respuesta honesta: es una apuesta, no un plan.',
    pt: 'Nenhuma estratégia disponível visa isto. A resposta honesta: é uma aposta, não um plano.',
    fr: 'Aucune stratégie disponible ne vise cela. La réponse honnête : c\u2019est un pari, pas un plan.'
  },
  'intentPlan.assume.defaultAmount': {
    en: 'No amount was given, so the plan is written for {{capital}}. The percentages hold at any size.',
    fa: 'مبلغی گفته نشد، پس برنامه برای {{capital}} نوشته شده. درصدها در هر اندازه‌ای برقرارند.',
    ar: 'لم يُذكر مبلغ، لذا كُتبت الخطة لـ {{capital}}. النسب صالحة عند أي حجم.',
    tr: 'Tutar belirtilmedi, plan {{capital}} için yazıldı. Yüzdeler her boyutta geçerli.',
    ru: 'Сумма не указана, план составлен на {{capital}}. Проценты верны при любом размере.',
    zh: '未给出金额，方案按 {{capital}} 编写。百分比在任何规模下都适用。',
    hi: 'राशि नहीं दी गई, इसलिए प्लान {{capital}} के लिए लिखा गया। प्रतिशत किसी भी आकार पर लागू हैं।',
    ur: 'رقم نہیں بتائی گئی، اس لیے منصوبہ {{capital}} کے لیے لکھا گیا۔ فیصد ہر حجم پر لاگو ہیں۔',
    id: 'Jumlah tidak disebut, jadi rencana ditulis untuk {{capital}}. Persentasenya berlaku di ukuran apa pun.',
    es: 'No se indicó importe, así que el plan se escribió para {{capital}}. Los porcentajes valen a cualquier tamaño.',
    pt: 'Nenhum valor foi dado, então o plano foi escrito para {{capital}}. As percentagens valem em qualquer tamanho.',
    fr: 'Aucun montant indiqué, le plan est écrit pour {{capital}}. Les pourcentages valent à toute taille.'
  },
  'intentPlan.assume.share': {
    en: 'Amount read as {{pct}}% of your portfolio (≈ {{capital}}).',
    fa: 'مبلغ به‌عنوان {{pct}}٪ از دارایی شما خوانده شد (≈ {{capital}}).',
    ar: 'قُرئ المبلغ كنسبة {{pct}}٪ من محفظتك (≈ {{capital}}).',
    tr: 'Tutar, portföyünüzün {{pct}}%si olarak okundu (≈ {{capital}}).',
    ru: 'Сумма прочитана как {{pct}}% вашего портфеля (≈ {{capital}}).',
    zh: '金额按你组合的 {{pct}}% 理解（约 {{capital}}）。',
    hi: 'राशि आपके पोर्टफ़ोलियो का {{pct}}% मानी गई (≈ {{capital}})।',
    ur: 'رقم آپ کے پورٹ فولیو کا {{pct}}% سمجھی گئی (≈ {{capital}})۔',
    id: 'Jumlah dibaca sebagai {{pct}}% portofolio Anda (≈ {{capital}}).',
    es: 'Importe leído como {{pct}}% de tu cartera (≈ {{capital}}).',
    pt: 'Valor lido como {{pct}}% da sua carteira (≈ {{capital}}).',
    fr: 'Montant lu comme {{pct}}% de votre portefeuille (≈ {{capital}}).'
  },
  'intentPlan.assume.fuzzy': {
    en: '"{{word}}" sized as {{pct}}% of your portfolio (≈ {{capital}}). Change it before confirming.',
    fa: '«{{word}}» به‌عنوان {{pct}}٪ از دارایی شما اندازه‌گذاری شد (≈ {{capital}}). پیش از تأیید تغییرش دهید.',
    ar: '"{{word}}" حُدد كنسبة {{pct}}٪ من محفظتك (≈ {{capital}}). غيّره قبل التأكيد.',
    tr: '"{{word}}" portföyünüzün {{pct}}%si olarak boyutlandı (≈ {{capital}}). Onaylamadan değiştirin.',
    ru: '«{{word}}» принято как {{pct}}% вашего портфеля (≈ {{capital}}). Измените до подтверждения.',
    zh: '“{{word}}”按组合的 {{pct}}% 计（约 {{capital}}）。确认前请修改。',
    hi: '"{{word}}" को पोर्टफ़ोलियो का {{pct}}% माना गया (≈ {{capital}})। पुष्टि से पहले बदलें।',
    ur: '"{{word}}" کو پورٹ فولیو کا {{pct}}% مانا گیا (≈ {{capital}})۔ تصدیق سے پہلے بدلیں۔',
    id: '"{{word}}" dihitung {{pct}}% portofolio Anda (≈ {{capital}}). Ubah sebelum konfirmasi.',
    es: '"{{word}}" dimensionado como {{pct}}% de tu cartera (≈ {{capital}}). Cámbialo antes de confirmar.',
    pt: '"{{word}}" dimensionado como {{pct}}% da sua carteira (≈ {{capital}}). Altere antes de confirmar.',
    fr: '« {{word}} » dimensionné à {{pct}}% de votre portefeuille (≈ {{capital}}). Modifiez-le avant de confirmer.'
  },
  'intentPlan.assume.horizon': {
    en: 'No time horizon given; the plan assumes {{days}} days.',
    fa: 'بازهٔ زمانی گفته نشد؛ برنامه {{days}} روز فرض شده است.',
    ar: 'لم تُذكر مدة؛ تفترض الخطة {{days}} يومًا.',
    tr: 'Vade belirtilmedi; plan {{days}} gün varsayıyor.',
    ru: 'Горизонт не указан; план предполагает {{days}} дней.',
    zh: '未给出时间范围；方案假设为 {{days}} 天。',
    hi: 'समय-सीमा नहीं दी गई; प्लान {{days}} दिन मानता है।',
    ur: 'مدت نہیں بتائی گئی؛ منصوبہ {{days}} دن فرض کرتا ہے۔',
    id: 'Horizon waktu tidak disebut; rencana mengasumsikan {{days}} hari.',
    es: 'Sin horizonte temporal; el plan asume {{days}} días.',
    pt: 'Sem horizonte temporal; o plano assume {{days}} dias.',
    fr: 'Aucun horizon indiqué ; le plan suppose {{days}} jours.'
  },
  'intentPlan.assume.network': {
    en: 'No network was chosen; the confirmation screen will ask before anything is signed.',
    fa: 'شبکه‌ای انتخاب نشد؛ پیش از هر امضا، صفحهٔ تأیید می‌پرسد.',
    ar: 'لم تُختر شبكة؛ ستسألك شاشة التأكيد قبل أي توقيع.',
    tr: 'Ağ seçilmedi; onay ekranı imzadan önce soracak.',
    ru: 'Сеть не выбрана; экран подтверждения спросит до любой подписи.',
    zh: '未选择网络；签名前确认页会询问。',
    hi: 'नेटवर्क चुना नहीं गया; हस्ताक्षर से पहले पुष्टि स्क्रीन पूछेगी।',
    ur: 'نیٹ ورک منتخب نہیں کیا گیا؛ دستخط سے پہلے تصدیقی اسکرین پوچھے گی۔',
    id: 'Jaringan belum dipilih; layar konfirmasi akan bertanya sebelum penandatanganan.',
    es: 'No se eligió red; la pantalla de confirmación preguntará antes de firmar.',
    pt: 'Nenhuma rede escolhida; o ecrã de confirmação perguntará antes de assinar.',
    fr: 'Aucun réseau choisi ; l\u2019écran de confirmation demandera avant toute signature.'
  },
  'intentPlan.assume.singleAsset': {
    en: 'You named {{symbol}}, so the plan is a single position rather than an allocation.',
    fa: 'شما {{symbol}} را نام بردید، پس برنامه یک موقعیت واحد است نه تخصیص.',
    ar: 'ذكرت {{symbol}}، لذا الخطة مركز واحد لا توزيع.',
    tr: '{{symbol}} belirttiniz, bu yüzden plan bir dağılım değil tek bir pozisyon.',
    ru: 'Вы назвали {{symbol}}, поэтому план — одна позиция, а не распределение.',
    zh: '你指定了 {{symbol}}，因此方案是单一持仓而非配置。',
    hi: 'आपने {{symbol}} बताया, इसलिए प्लान आवंटन नहीं, एक ही पोज़िशन है।',
    ur: 'آپ نے {{symbol}} بتایا، اس لیے منصوبہ تقسیم نہیں، ایک ہی پوزیشن ہے۔',
    id: 'Anda menyebut {{symbol}}, jadi rencananya satu posisi, bukan alokasi.',
    es: 'Mencionaste {{symbol}}, así que el plan es una sola posición, no una asignación.',
    pt: 'Indicou {{symbol}}, logo o plano é uma única posição, não uma alocação.',
    fr: 'Vous avez nommé {{symbol}}, le plan est donc une position unique et non une allocation.'
  },
  'intentPlan.assume.cadence': {
    en: 'Cadence read from your message: {{cadence}}. Each buy is a separate signature.',
    fa: 'تناوب از پیام شما خوانده شد: {{cadence}}. هر خرید یک امضای جداگانه است.',
    ar: 'قُرئت الدورية من رسالتك: {{cadence}}. كل شراء توقيع منفصل.',
    tr: 'Periyot mesajınızdan okundu: {{cadence}}. Her alım ayrı bir imzadır.',
    ru: 'Периодичность прочитана из сообщения: {{cadence}}. Каждая покупка — отдельная подпись.',
    zh: '从你的消息读出频率：{{cadence}}。每次买入都是一次单独签名。',
    hi: 'आपके संदेश से आवृत्ति पढ़ी गई: {{cadence}}। हर खरीद अलग हस्ताक्षर है।',
    ur: 'آپ کے پیغام سے تعدد پڑھا گیا: {{cadence}}۔ ہر خریداری الگ دستخط ہے۔',
    id: 'Keteraturan dibaca dari pesan Anda: {{cadence}}. Setiap pembelian tanda tangan terpisah.',
    es: 'Cadencia leída de tu mensaje: {{cadence}}. Cada compra es una firma aparte.',
    pt: 'Cadência lida da sua mensagem: {{cadence}}. Cada compra é uma assinatura separada.',
    fr: 'Cadence lue dans votre message : {{cadence}}. Chaque achat est une signature distincte.'
  },
  'intentPlan.assume.noObjective': {
    en: 'No objective was stated, so the plan assumes growth.',
    fa: 'هدفی گفته نشد، پس برنامه رشد فرض شده است.',
    ar: 'لم يُذكر هدف، لذا تفترض الخطة النمو.',
    tr: 'Hedef belirtilmedi, plan büyüme varsayıyor.',
    ru: 'Цель не указана, план предполагает рост.',
    zh: '未说明目标，方案默认按增长处理。',
    hi: 'लक्ष्य नहीं बताया गया, इसलिए प्लान वृद्धि मानता है।',
    ur: 'ہدف نہیں بتایا گیا، اس لیے منصوبہ ترقی فرض کرتا ہے۔',
    id: 'Tujuan tidak disebut, jadi rencana mengasumsikan pertumbuhan.',
    es: 'No se indicó objetivo, así que el plan asume crecimiento.',
    pt: 'Nenhum objetivo indicado, o plano assume crescimento.',
    fr: 'Aucun objectif indiqué, le plan suppose la croissance.'
  },
  'intentPlan.assume.riskMoved': {
    en: 'Risk stance "{{risk}}" moved {{pct}}% of the plan into lower-risk legs.',
    fa: 'رویکرد ریسک «{{risk}}» {{pct}}٪ از برنامه را به بخش‌های کم‌ریسک‌تر منتقل کرد.',
    ar: 'موقف المخاطرة "{{risk}}" نقل {{pct}}٪ من الخطة إلى شرائح أقل مخاطرة.',
    tr: '"{{risk}}" risk tutumu planın {{pct}}%sini daha düşük riskli bacaklara taşıdı.',
    ru: 'Отношение к риску «{{risk}}» перенесло {{pct}}% плана в менее рискованные части.',
    zh: '风险立场“{{risk}}”将方案的 {{pct}}% 移入低风险部分。',
    hi: 'जोखिम-रुख "{{risk}}" ने प्लान का {{pct}}% कम-जोखिम हिस्सों में移 दिया।',
    ur: 'خطرات کا انداز "{{risk}}" نے منصوبے کا {{pct}}% کم خطر حصوں میں منتقل کیا۔',
    id: 'Sikap risiko "{{risk}}" memindahkan {{pct}}% rencana ke bagian berisiko lebih rendah.',
    es: 'La postura de riesgo "{{risk}}" movió {{pct}}% del plan a tramos de menor riesgo.',
    pt: 'A postura de risco "{{risk}}" moveu {{pct}}% do plano para partes de menor risco.',
    fr: 'La posture de risque « {{risk}} » a déplacé {{pct}}% du plan vers des segments moins risqués.'
  },
  'intentPlan.assume.legUnavailable': {
    en: '{{leg}} is not available in this build, so it was left out.',
    fa: '{{leg}} در این نسخه موجود نیست، پس کنار گذاشته شد.',
    ar: '{{leg}} غير متاح في هذا الإصدار، لذا استُبعد.',
    tr: '{{leg}} bu sürümde yok, bu yüzden çıkarıldı.',
    ru: '{{leg}} недоступно в этой сборке, поэтому исключено.',
    zh: '此版本不提供{{leg}}，因此已剔除。',
    hi: '{{leg}} इस बिल्ड में नहीं है, इसलिए हटा दिया गया।',
    ur: '{{leg}} اس بلڈ میں دستیاب نہیں، اس لیے نکال دیا گیا۔',
    id: '{{leg}} tidak tersedia di build ini, jadi dikeluarkan.',
    es: '{{leg}} no está disponible en esta versión, así que se omitió.',
    pt: '{{leg}} não está disponível nesta compilação, por isso foi omitido.',
    fr: '{{leg}} n\u2019est pas disponible dans cette version, il a donc été écarté.'
  },
  'intentPlan.assume.legDisabled': {
    en: '{{leg}} is turned off for you.',
    fa: '{{leg}} برای شما غیرفعال است.',
    ar: '{{leg}} معطّل لديك.',
    tr: '{{leg}} sizin için kapalı.',
    ru: '{{leg}} отключено для вас.',
    zh: '{{leg}}对你已关闭。',
    hi: '{{leg}} आपके लिए बंद है।',
    ur: '{{leg}} آپ کے لیے بند ہے۔',
    id: '{{leg}} dimatikan untuk Anda.',
    es: '{{leg}} está desactivado para ti.',
    pt: '{{leg}} está desativado para si.',
    fr: '{{leg}} est désactivé pour vous.'
  },
  'intentPlan.assume.lossCap': {
    en: 'You capped acceptable loss at {{cap}}; this plan\'s worst case is {{worst}}. Reduce the riskier legs or the size.',
    fa: 'سقف زیان مجاز را {{cap}} تعیین کردید؛ بدترین حالت این برنامه {{worst}} است. بخش‌های پرمخاطره یا مبلغ را کم کنید.',
    ar: 'حددت أقصى خسارة مقبولة عند {{cap}}؛ أسوأ حالة لهذه الخطة {{worst}}. قلل الشرائح الأكثر مخاطرة أو الحجم.',
    tr: 'Kabul edilebilir kaybı {{cap}} ile sınırladınız; bu planın en kötü durumu {{worst}}. Riskli bacakları veya tutarı azaltın.',
    ru: 'Вы ограничили допустимый убыток суммой {{cap}}; худший случай плана — {{worst}}. Уменьшите рискованные части или размер.',
    zh: '你把可接受亏损上限设为 {{cap}}；本方案最坏情况为 {{worst}}。请降低风险部分或规模。',
    hi: 'आपने स्वीकार्य हानि {{cap}} तक सीमित की; इस प्लान की सबसे बुरी स्थिति {{worst}} है। जोखिम वाले हिस्से या राशि घटाएँ।',
    ur: 'آپ نے قابلِ قبول نقصان {{cap}} تک محدود کیا؛ اس منصوبے کی بدترین صورت {{worst}} ہے۔ پرخطر حصے یا رقم کم کریں۔',
    id: 'Anda membatasi kerugian pada {{cap}}; skenario terburuk rencana ini {{worst}}. Kurangi bagian berisiko atau jumlahnya.',
    es: 'Limitaste la pérdida aceptable a {{cap}}; el peor caso de este plan es {{worst}}. Reduce los tramos más arriesgados o el importe.',
    pt: 'Limitou a perda aceitável a {{cap}}; o pior caso deste plano é {{worst}}. Reduza as partes mais arriscadas ou o montante.',
    fr: 'Vous avez plafonné la perte acceptable à {{cap}} ; le pire cas de ce plan est {{worst}}. Réduisez les segments risqués ou le montant.'
  },
  'intentPlan.risk.note': {
    en: 'A single bad market can hit every leg at once. This figure assumes it does.',
    fa: 'یک بازار بد می‌تواند هم‌زمان به همهٔ بخش‌ها بزند. این عدد همان را فرض می‌کند.',
    ar: 'سوق سيئة واحدة قد تضرب كل الشرائح معًا. هذا الرقم يفترض ذلك.',
    tr: 'Tek bir kötü piyasa tüm bacakları aynı anda vurabilir. Bu rakam bunu varsayar.',
    ru: 'Одно плохое движение рынка может ударить по всем частям сразу. Эта цифра именно это и предполагает.',
    zh: '一次糟糕的行情可能同时冲击所有部分。该数字正是这样假设的。',
    hi: 'एक ही खराब बाज़ार सभी हिस्सों को एक साथ मार सकता है। यह आँकड़ा यही मानता है।',
    ur: 'ایک ہی خراب مارکیٹ تمام حصوں کو بیک وقت مار سکتی ہے۔ یہ عدد یہی فرض کرتا ہے۔',
    id: 'Satu pasar buruk bisa memukul semua bagian sekaligus. Angka ini mengasumsikannya.',
    es: 'Un mal mercado puede golpear todos los tramos a la vez. Esta cifra lo asume.',
    pt: 'Um mau mercado pode atingir todas as partes de uma vez. Este valor assume isso.',
    fr: 'Un seul mauvais marché peut toucher tous les segments à la fois. Ce chiffre le suppose.'
  },
  'intentPlan.cap.stable-hold': { en: 'Hold in stablecoins', fa: 'نگهداری در استیبل‌کوین', ar: 'الاحتفاظ بعملات مستقرة', tr: 'Stabil coin tut', ru: 'Держать в стейблкоинах', zh: '持有稳定币', hi: 'स्टेबलकॉइन में रखें', ur: 'اسٹیبل کوائن میں رکھیں', id: 'Simpan dalam stablecoin', es: 'Mantener en stablecoins', pt: 'Manter em stablecoins', fr: 'Conserver en stablecoins' },
  'intentPlan.cap.core-spot': { en: 'Spot in BTC/ETH', fa: 'اسپات در BTC/ETH', ar: 'فوري في BTC/ETH', tr: 'BTC/ETH spot', ru: 'Спот BTC/ETH', zh: 'BTC/ETH 现货', hi: 'BTC/ETH स्पॉट', ur: 'BTC/ETH اسپاٹ', id: 'Spot BTC/ETH', es: 'Spot en BTC/ETH', pt: 'Spot em BTC/ETH', fr: 'Spot BTC/ETH' },
  'intentPlan.cap.satellite-spot': { en: 'Spot in higher-beta assets', fa: 'اسپات در دارایی‌های پرنوسان‌تر', ar: 'فوري في أصول أعلى تقلبًا', tr: 'Daha oynak varlıklarda spot', ru: 'Спот в более волатильных активах', zh: '高波动资产现货', hi: 'उच्च-बीटा संपत्तियों में स्पॉट', ur: 'زیادہ اتار چڑھاؤ والی اثاثوں میں اسپاٹ', id: 'Spot pada aset beta tinggi', es: 'Spot en activos de mayor beta', pt: 'Spot em ativos de maior beta', fr: 'Spot sur actifs à bêta élevé' },
  'intentPlan.cap.staking': { en: 'Staking / liquid staking', fa: 'استیکینگ / استیکینگ نقدشونده', ar: 'التخزين / التخزين السائل', tr: 'Staking / likit staking', ru: 'Стейкинг / ликвидный стейкинг', zh: '质押 / 流动性质押', hi: 'स्टेकिंग / लिक्विड स्टेकिंग', ur: 'اسٹیکنگ / لیکویڈ اسٹیکنگ', id: 'Staking / staking likuid', es: 'Staking / staking líquido', pt: 'Staking / staking líquido', fr: 'Staking / staking liquide' },
  'intentPlan.cap.lending': { en: 'Lending stablecoins', fa: 'وام‌دهی استیبل‌کوین', ar: 'إقراض العملات المستقرة', tr: 'Stabil coin borç verme', ru: 'Кредитование стейблкоинами', zh: '出借稳定币', hi: 'स्टेबलकॉइन उधार देना', ur: 'اسٹیبل کوائن قرض دینا', id: 'Meminjamkan stablecoin', es: 'Prestar stablecoins', pt: 'Emprestar stablecoins', fr: 'Prêter des stablecoins' },
  'intentPlan.cap.lp': { en: 'Provide liquidity', fa: 'تأمین نقدینگی', ar: 'توفير السيولة', tr: 'Likidite sağla', ru: 'Предоставление ликвидности', zh: '提供流动性', hi: 'तरलता प्रदान करें', ur: 'لیکویڈیٹی فراہم کریں', id: 'Sediakan likuiditas', es: 'Aportar liquidez', pt: 'Fornecer liquidez', fr: 'Fournir de la liquidité' },
  'intentPlan.cap.dca': { en: 'Recurring buy (DCA)', fa: 'خرید دوره‌ای (DCA)', ar: 'شراء دوري (DCA)', tr: 'Periyodik alım (DCA)', ru: 'Регулярная покупка (DCA)', zh: '定投（DCA）', hi: 'आवर्ती खरीद (DCA)', ur: 'بار بار خرید (DCA)', id: 'Pembelian berkala (DCA)', es: 'Compra recurrente (DCA)', pt: 'Compra recorrente (DCA)', fr: 'Achat récurrent (DCA)' },
  /*
   * Supplied by the build-gated module: the Persian label contains the word
   * that got this app rejected by a store content filter, and this file ships
   * in every build. In a store build PERPS_LABELS is empty, renderTemplate
   * returns null, and the planner prints the capability id instead — which is
   * correct, because that build has no such capability to name.
   */
  'intentPlan.cap.perps': PERPS_LABELS,
  'intentPlan.cap.outcome': { en: 'Outcome market position', fa: 'موقعیت در بازار پیامد', ar: 'مركز في سوق النتائج', tr: 'Sonuç piyasası pozisyonu', ru: 'Позиция на рынке исходов', zh: '结果市场持仓', hi: 'आउटकम मार्केट पोज़िशन', ur: 'آؤٹکم مارکیٹ پوزیشن', id: 'Posisi pasar hasil', es: 'Posición en mercado de resultados', pt: 'Posição em mercado de resultados', fr: 'Position sur marché de résultats' }
});

/** Render one template in a locale. Missing locale → English + visible marker. */
export function renderTemplate(key, lang, params = {}) {
  const templates = TEMPLATES[key];
  if (!templates) return null;
  const code = OUTPUT_LOCALES.includes(lang) ? lang : 'en';
  const marked = OUTPUT_LOCALES.includes(lang);
  /*
   * An empty table is not an error: it is what the build-gated speculative
   * module becomes in a store build. Return null and let the caller fall back
   * to something honest, rather than rendering "undefined".
   */
  let text = templates[code] || templates.en;
  if (typeof text !== 'string') return null;
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

/**
 * Localize an intent-planner proposal in place.
 *
 * Returns a NEW object with `summary`, `assumptions`, `legLabels`, the risk
 * note and the feasibility note rendered in `lang`. The numbers and the
 * percentages are never altered — a translation that changed a figure would be
 * the one kind of translation that could cost someone money.
 *
 * The planner itself stays language-neutral: it produces facts, and this
 * renders them. That keeps a single source of truth for the numbers and puts
 * the twelve-locale burden in the module that already carries it.
 */
export function localizeIntentPlan(plan, lang = 'en') {
  if (!plan || plan.schema !== 'fbt.intent-planner.v1') return plan;
  const code = OUTPUT_LOCALES.includes(lang) ? lang : 'en';

  const capLabel = (id) => renderTemplate(`intentPlan.cap.${id}`, code) || id;

  const head = renderTemplate(`intentPlan.head.${plan.objective}`, code)
    || renderTemplate('intentPlan.head.default', code);
  const split = (plan.legs || [])
    .slice()
    .sort((a, b) => b.amountPct - a.amountPct)
    .map((l) => `${formatNumber(l.amountPct, code, 0)}% ${capLabel(l.capability).toLowerCase()}`)
    .join(' · ');

  const headKey = `intentPlan.head.${plan.objective}`;
  const summary = renderTemplate('intentPlan.summary', code, {
    head,
    split,
    capital: `${formatNumber(plan.capitalUsd, code, 0)} USD`,
    drawdown: formatNumber(plan.risk?.maxDrawdownPct, code, 1)
  });

  return {
    ...plan,
    locale: code,
    summary: summary ?? plan.summary,
    headRendered: TEMPLATES[headKey] ? head : null,
    risk: plan.risk
      ? { ...plan.risk, note: renderTemplate('intentPlan.risk.note', code) ?? plan.risk.note }
      : plan.risk,
    feasibilityNote: plan.feasibility
      ? (renderTemplate(`intentPlan.feasibility.${plan.feasibility}`, code) ?? plan.feasibilityNote)
      : plan.feasibilityNote,
    legLabels: Object.fromEntries((plan.legs || []).map((l) => [l.capability, capLabel(l.capability)]))
  };
}

/**
 * The planner's assumption strings, localized.
 *
 * Kept apart from localizeIntentPlan because the assumptions are produced with
 * their parameters scattered through the planner; this renders the known ones
 * from structured records and passes anything unrecognised through untouched
 * rather than guessing at a translation.
 */
export function localizeAssumption(record, lang = 'en') {
  const code = OUTPUT_LOCALES.includes(lang) ? lang : 'en';
  const key = `intentPlan.assume.${record.kind}`;
  if (!TEMPLATES[key]) return record.text ?? null;
  const params = { ...(record.params || {}) };
  if (params.pct != null) params.pct = formatNumber(params.pct, code, 0);
  if (params.capital != null) params.capital = `${formatNumber(params.capital, code, 0)} USD`;
  if (params.cap != null) params.cap = `${formatNumber(params.cap, code, 0)} USD`;
  if (params.worst != null) params.worst = `${formatNumber(params.worst, code, 0)} USD`;
  if (params.days != null) params.days = formatNumber(params.days, code, 0);
  if (params.leg != null) params.leg = renderTemplate(`intentPlan.cap.${params.leg}`, code) || params.leg;
  return renderTemplate(key, code, params);
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
