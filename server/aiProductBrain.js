/**
 * PRODUCT BRAIN — what FBT is, what every page does, what the assistant may say
 * about it, and where it must stop.
 * ---------------------------------------------------------------------------
 * «دربارهٔ FBT هر چیزی پرسید جواب بده؛ همهٔ صفحه‌ها» is a knowledge problem and
 * an honesty problem at the same time. A model that knows the product badly
 * invents a founder's name, a fee, or a page that does not exist — and every
 * one of those is worse than «این را نمی‌دانم».
 *
 * So the brain is built from the repository, not from memory:
 *
 *   · PAGES      — parsed from the app's own route table (`src/App.jsx`), so
 *                  the catalog cannot drift from what ships; each route gets a
 *                  purpose line, and routes that are feature-gated are marked.
 *   · FACTS      — the verified knowledge center (kb.*), the real platform fee
 *                  and its cap, the policy caps, and the execution authority
 *                  (which is `false`, always).
 *   · CAPABILITIES — the assistant's own layers, one honest line each.
 *   · CREATORS   — checked against verified knowledge. If the answer is not
 *                  there, the brain SAYS it is not there and points at the
 *                  contact page. It never composes a team.
 *
 * `answerProduct` then answers a product question deterministically (no model
 * call), `renderProductBrief` hands the verified facts to the specialists as
 * the source of truth, and `checkProductAnswer` catches the four ways a draft
 * goes beyond them: an invented creator, an invented fee, a page that does not
 * exist, and a claim that contradicts custody.
 */

import { readFileSync } from 'node:fs';
import { FBT_KNOWLEDGE } from '../src/lib/intent-ai/os/knowledgeCenter.js';
import { FEE_BPS, FEE_BPS_MAX, feePercentString, toEasternDigits } from '../src/lib/feeBps.js';

/* The fee is never typed twice: the brain quotes the same constant the engine
   charges, in either numeral system. */
const feeFa = (bps = FEE_BPS) => toEasternDigits(feePercentString(bps)).replace('.', '٫');
const feeEn = (bps = FEE_BPS) => `${feePercentString(bps)}%`;
const bpsFa = toEasternDigits(String(FEE_BPS));

export const PRODUCT_BRAIN_SCHEMA = 'fbt.ai-product-brain.v1';
export const PRODUCT_BRAIN_VERSION = '1.0.0';

/* ── page catalog ─────────────────────────────────────────────────────────── */

/*
 * Purpose lines are curated for the pages a user actually asks about; the rest
 * fall back to a neutral, honest label. A route that ships without a line here
 * is still listed — the catalog is derived from the router, never hand-copied.
 */
const PAGE_PURPOSE = {
  Market: { fa: 'فهرست بازار: قیمت و تغییر دارایی‌ها', en: 'market list: prices and changes' },
  CoinDetail: { fa: 'صفحهٔ یک دارایی: نمودار، آمار و خرید/فروش', en: 'one asset: chart, stats, buy/sell' },
  Compare: { fa: 'مقایسهٔ چند دارایی کنار هم', en: 'compare assets side by side' },
  Swap: { fa: 'سواپ توکن با مسیردهی و کارمزد شفاف', en: 'token swap with routing and a visible fee' },
  Trade: { fa: 'صفحهٔ معاملهٔ اسپات', en: 'spot trading' },
  SpotPage: { fa: 'اسپات ساده وقتی معاملات مشتقه خاموش است', en: 'simple spot when derivatives are off' },
  Bridge: { fa: 'بریج بین شبکه‌ها', en: 'cross-chain bridge' },
  Invest: { fa: 'سرمایه‌گذاری/شرط‌بندی قیمتی (در صورت فعال بودن)', en: 'investment/prediction (when enabled)' },
  Predict: { fa: 'بازار پیش‌بینی (در صورت فعال بودن)', en: 'prediction market (when enabled)' },
  Earn: { fa: 'کسب سود و استیکینگ', en: 'yield and staking' },
  Farm: { fa: 'فارم و استخرهای نقدینگی', en: 'farming and liquidity pools' },
  Vault: { fa: 'خزانه/گاوصندوق دارایی‌ها', en: 'asset vault' },
  Wallet: { fa: 'کیف پول غیرامانی: موجودی، دریافت و ارسال', en: 'non-custodial wallet: balances, receive, send' },
  Portfolio: { fa: 'سبد شما: ارزش، تخصیص و سود/ضرر', en: 'your portfolio: value, allocation, P&L' },
  Signals: { fa: 'سیگنال‌های تحلیلی (تحلیل، نه تضمین سود)', en: 'analytical signals (analysis, not a profit promise)' },
  SmartMoney: { fa: 'اسمارت مانی: پول هوشمند و کیف‌های فعال', en: 'smart money: tracked wallets and flows' },
  SmartMoneyWallet: { fa: 'جزئیات یک کیف پول اسمارت مانی', en: 'one smart-money wallet in detail' },
  SmartMoneyToken: { fa: 'تحلیل اسمارت مانی یک توکن', en: 'smart-money view of one token' },
  SmartWallet: { fa: 'کیف پول هوشمند با سیاست‌های امنیتی', en: 'smart wallet with security policy' },
  Stocks: { fa: 'سهام توکن‌شده', en: 'tokenized stocks' },
  Nft: { fa: 'بازار NFT', en: 'NFT market' },
  Earn2: { fa: 'کسب سود', en: 'earn' },
  Loan: { fa: 'وام و وثیقه', en: 'loans and collateral' },
  Orders: { fa: 'سفارش‌های باز و تاریخچهٔ سفارش', en: 'open orders and order history' },
  OrderHistory: { fa: 'تاریخچهٔ سفارش‌ها', en: 'order history' },
  P: { fa: 'مسیر کوتاه پروفایل', en: 'short profile path' },
  Settings: { fa: 'تنظیمات حساب و شبکه', en: 'account and network settings' },
  Security: { fa: 'امنیت: نشست‌ها، تأییدها و قفل‌ها', en: 'security: sessions, approvals, locks' },
  Rewards: { fa: 'جوایز و پاداش‌ها', en: 'rewards' },
  Social: { fa: 'لایهٔ اجتماعی', en: 'social layer' },
  Community: { fa: 'انجمن کاربران', en: 'community' },
  Leaderboard: { fa: 'جدول رتبه‌بندی', en: 'leaderboard' },
  News: { fa: 'اخبار بازار', en: 'market news' },
  Discover: { fa: 'کشف دارایی‌ها و فرصت‌ها', en: 'discover assets and opportunities' },
  Explore: { fa: 'کاوش در اکوسیستم', en: 'explore the ecosystem' },
  ExploreHub: { fa: 'هاب کاوش', en: 'explore hub' },
  Opportunities: { fa: 'فرصت‌های سرمایه‌گذاری', en: 'investment opportunities' },
  OpportunityDetail: { fa: 'جزئیات یک فرصت', en: 'one opportunity in detail' },
  Ecosystem: { fa: 'اکوسیستم و دایرکتوری پروژه‌ها', en: 'ecosystem and project directory' },
  Business: { fa: 'راهکارهای سازمانی', en: 'business solutions' },
  Developers: { fa: 'مستندات توسعه‌دهندگان و API', en: 'developer docs and API' },
  Docs: { fa: 'مستندات محصول', en: 'product docs' },
  Help: { fa: 'راهنما و پرسش‌های متداول', en: 'help and FAQ' },
  Learn: { fa: 'آموزش', en: 'learn' },
  About: { fa: 'دربارهٔ FBT', en: 'about FBT' },
  Contact: { fa: 'راه‌های تماس رسمی', en: 'official contact channels' },
  Legal: { fa: 'اسناد حقوقی (قوانین، حریم خصوصی)', en: 'legal documents (terms, privacy)' },
  Security2: { fa: 'امنیت', en: 'security' },
  Shop: { fa: 'فروشگاه', en: 'shop' },
  Launch: { fa: 'لانچ‌پد', en: 'launchpad' },
  Lab: { fa: 'آزمایشگاه', en: 'lab' },
  LabChartGuide: { fa: 'راهنمای نمودار', en: 'chart guide' },
  InsuranceShell: { fa: 'بیمهٔ دارایی', en: 'asset insurance' },
  InsuranceMarketplace: { fa: 'بازار بیمه', en: 'insurance marketplace' },
  InsuranceQuote: { fa: 'استعلام بیمه', en: 'insurance quote' },
  InsuranceCoverage: { fa: 'پوشش‌های بیمه', en: 'insurance coverage' },
  InsuranceCoverageDetail: { fa: 'جزئیات پوشش', en: 'coverage detail' },
  InsuranceClaims: { fa: 'ادعاهای بیمه', en: 'insurance claims' },
  InsuranceProviders: { fa: 'ارائه‌دهندگان بیمه', en: 'insurance providers' },
  InsuranceDashboard: { fa: 'داشبورد بیمه', en: 'insurance dashboard' },
  InsuranceRisk: { fa: 'ریسک بیمه', en: 'insurance risk' },
  InsuranceSettings: { fa: 'تنظیمات بیمه', en: 'insurance settings' },
  AiAnalysis: { fa: 'تحلیل هوش مصنوعی', en: 'AI analysis' },
  AiRiskEngine: { fa: 'موتور ریسک هوش مصنوعی', en: 'AI risk engine' },
  AiControlCenter: { fa: 'مرکز کنترل هوش مصنوعی', en: 'AI control center' },
  IntentAIUnified: { fa: 'چت Intent AI', en: 'Intent AI chat' },
  Perp: { fa: 'معاملات مشتقه (در صورت فعال بودن)', en: 'perpetual futures (when enabled)' },
  PerpTerminal: { fa: 'ترمینال مشتقه', en: 'perp terminal' },
  DerivativesDashboard: { fa: 'داشبورد مشتقه', en: 'derivatives dashboard' },
  Dydx: { fa: 'بازار dYdX', en: 'dYdX market' },
  Ostium: { fa: 'بازار Ostium', en: 'Ostium market' },
  FlashLiquidity: { fa: 'نقدینگی فلش', en: 'flash liquidity' },
  GlobalWorld: { fa: 'نمای جهانی بازار', en: 'global market view' },
  Buy: { fa: 'خرید', en: 'buy' },
  PayLanding: { fa: 'صفحهٔ پرداخت', en: 'payment landing' },
  SolanaSwap: { fa: 'سواپ سولانا', en: 'Solana swap' },
  AparatVideos: { fa: 'ویدیوهای آموزشی', en: 'video tutorials' },
  Navigate: { fa: 'ناوبری همهٔ بخش‌ها', en: 'navigate all sections' },
  Collective: { fa: 'لایهٔ جمعی', en: 'collective layer' },
  Docs2: { fa: 'مستندات', en: 'docs' }
};

/* Used when `src/App.jsx` cannot be read (a bundled runtime, a test harness
   without the file): the main entry points, so the answer degrades instead of
   disappearing. */
const FALLBACK_ROUTES = [
  { path: '/', page: 'Market' }, { path: '/swap', page: 'Swap' }, { path: '/bridge', page: 'Bridge' },
  { path: '/wallet', page: 'Wallet' }, { path: '/portfolio', page: 'Portfolio' },
  { path: '/signals', page: 'Signals' }, { path: '/smart-money', page: 'SmartMoney' },
  { path: '/stocks', page: 'Stocks' }, { path: '/earn', page: 'Earn' },
  { path: '/perp', page: 'Perp' }, { path: '/about', page: 'About' }, { path: '/contact', page: 'Contact' }
];

let CACHE = null;

/** Every route the app actually ships, with a purpose line. */
export function pageCatalog({ fresh = false } = {}) {
  if (CACHE && !fresh) return CACHE;
  let routes = [];
  try {
    const raw = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    /* Comments in the router quote routes too (the hash-routing note does), and
       a catalog that counts a comment is a catalog that lies by one. */
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const re = /<Route\s+path="([^"]+)"\s+element=\{([^}]*)\}/g;
    let match;
    while ((match = re.exec(source))) {
      const [, path, rawElement] = match;
      const page = (rawElement.match(/<([A-Z][A-Za-z0-9]*)/) || [])[1];
      if (!path || !page) continue;
      /* A route wrapped in a feature flag is still real; it is just gated. */
      const before = source.slice(Math.max(0, match.index - 120), match.index);
      const gate = (before.match(/\{([A-Z][A-Z0-9_]+)\s*&&\s*$/) || [])[1] || null;
      routes.push({ path, page, gated: Boolean(gate), gate });
    }
  } catch {
    routes = FALLBACK_ROUTES.map((r) => ({ ...r, gated: false, gate: null }));
  }
  if (!routes.length) routes = FALLBACK_ROUTES.map((r) => ({ ...r, gated: false, gate: null }));

  /* One entry per path. A path can appear twice on purpose — `/perp` is the
     perp terminal when speculation is on and a spot page when it is off — so
     the alternates are kept as a note rather than becoming two "pages". */
  const byPath = new Map();
  for (const route of routes) {
    const existing = byPath.get(route.path);
    if (!existing) {
      byPath.set(route.path, { ...route, alternates: [] });
      continue;
    }
    existing.alternates.push(route.page);
    if (!existing.gated && route.gated) existing.gate = existing.gate || route.gate;
  }

  CACHE = [...byPath.values()].map((r) => {
    const purpose = PAGE_PURPOSE[r.page] || null;
    return {
      ...r,
      purposeFa: purpose ? purpose.fa : `صفحهٔ ${r.page} (توضیح رسمی ثبت نشده)`,
      purposeEn: purpose ? purpose.en : `${r.page} page (no official description on file)`,
      described: Boolean(purpose)
    };
  });
  return CACHE;
}

function routeBySegment(segment) {
  const s = `/` + String(segment || '').replace(/^\/+/, '').split('/')[0].toLowerCase();
  return pageCatalog().find((r) => r.path.toLowerCase() === s) || null;
}

/* ── facts the brain is allowed to state ──────────────────────────────────── */

export const PRODUCT_FACTS = Object.freeze([
  {
    id: 'fee',
    status: 'verified',
    source: 'src/lib/feeBps.js',
    fa: `کارمزد پلتفرم ${feeFa()}٪ (${bpsFa} بیسیس‌پوینت) هر سواپ است و سقف سختش ${feeFa(FEE_BPS_MAX)}٪ است؛ مقدار خارج از بازه به پیش‌فرض برمی‌گردد.`,
    en: `The platform fee is ${feeEn()} (${FEE_BPS} bps) per swap, hard-capped at ${feeEn(FEE_BPS_MAX)}; out-of-range values fall back to the default.`
  },
  {
    id: 'authority',
    status: 'verified',
    source: 'server/aiCollaboration.js',
    fa: 'هوش مصنوعی FBT اختیار اجرا ندارد: canExecute / canSign / canMoveFunds همیشه false است و هیچ تراکنشی بدون امضای کیف پول شما اجرا نمی‌شود.',
    en: 'The FBT assistant has no execution authority: canExecute / canSign / canMoveFunds are always false, and nothing runs without your wallet signature.'
  },
  {
    id: 'caps',
    status: 'verified',
    source: 'server/aiStrategyFrame.js',
    fa: 'سقف‌های سیاست: اهرم حداکثر ۵×، اسلیپیج حداکثر ۳٪، و هر تراکنش حداکثر ۴۰۰٬۰۰۰ دلار.',
    en: 'Policy caps: leverage at most 5×, slippage at most 3%, and at most $400,000 per transaction.'
  },
  {
    id: 'custody',
    status: 'verified',
    source: 'src/lib/intent-ai/os/knowledgeCenter.js#kb.wallet.custody',
    fa: 'کیف پول غیرامانی است: کلید خصوصی و عبارت بازیابی فقط روی دستگاه شما می‌مانند و هیچ سروری آن‌ها را نمی‌بیند.',
    en: 'Custody is non-custodial: the private key and recovery phrase stay on your device and no server sees them.'
  },
  {
    id: 'never-asks',
    status: 'verified',
    source: 'src/lib/intent-ai/os/knowledgeCenter.js#kb.wallet.never-asks',
    fa: 'FBT و پشتیبانی FBT هرگز عبارت بازیابی، کلید خصوصی، رمز کیف پول یا کد دو مرحله‌ای نمی‌پرسند؛ هر کسی این‌ها را خواست — حتی با نام FBT — کلاهبردار است.',
    en: 'FBT and its support never ask for your recovery phrase, private key, wallet password or 2FA codes; anyone who does — even claiming to be FBT — is a scammer.'
  },
  {
    id: 'no-advice',
    status: 'verified',
    source: 'src/lib/intent-ai/os/knowledgeCenter.js#kb.trading.no-advice',
    fa: 'FBT سیگنال و تحلیل می‌دهد، ولی توصیهٔ مالی شخصی نمی‌دهد و سود تضمین نمی‌کند؛ تصمیم نهایی و مسئولیتش با کاربر است.',
    en: 'FBT provides signals and analysis, not personal financial advice, and never guarantees profit; the decision and its consequences are the user’s.'
  }
]);

/** The assistant's own layers, one honest line each. */
export const PRODUCT_CAPABILITIES = Object.freeze([
  { id: 'modes', fa: 'سه حالت هوش: swift / balanced / max؛ حالت «باهوش‌ترین» عمیق‌ترین تحلیل و بیشترین راستی‌آزمایی را می‌دهد.', en: 'Three intelligence modes — swift / balanced / max; max gives the deepest analysis and verification.' },
  { id: 'multi-model', fa: 'در حالت باهوش‌ترین، چند مدل مستقل تحلیل می‌کنند، ادعاها راستی‌آزمایی و تناقض‌ها افشا می‌شود.', en: 'In max, several independent models analyse, claims are verified and contradictions are disclosed.' },
  { id: 'research', fa: 'دستور کار پژوهشی: چیزی که یک نوبت نتوانست ثابت کند، در نوبت بعد به‌عنوان پرسش باز دنبال می‌شود.', en: 'A research agenda: what one turn could not establish is carried forward as an open question.' },
  { id: 'market-frame', fa: 'چارچوب بازار: پهنای بازار، پراکندگی، رژیم و افقِ واقعی داده محاسبه می‌شود و اندیکاتورِ بدون سری زمانی رد می‌شود.', en: 'A market frame: breadth, dispersion, regime and the honest horizon are computed, and indicators without a price series are refused.' },
  { id: 'strategy', fa: 'چارچوب استراتژی: برنامه فقط روی سرمایهٔ واقعی، کارمزد واقعی و سقف‌های سیاست بسته می‌شود، با چک‌لیست کامل‌بودن.', en: 'A strategy frame: the plan stands only on real capital, the real fee and policy caps, with a completeness rubric.' },
  { id: 'decision', fa: 'دروازهٔ تصمیم: سطح شاهد سنجیده می‌شود و پاسخ برهنه از تصمیم‌های پرریسک خودداری می‌کند.', en: 'A decision gate: the evidence level is measured and a bare answer refuses high-stakes calls.' },
  { id: 'emotion', fa: 'خوانش احساس و موقعیت: سوگ، شرم، خشم، امید، و سود/ضرر سبد کاربر، لحن و توصیه‌ها را تعیین می‌کند.', en: 'Emotion and situation reads: grief, shame, anger, hope, and the portfolio’s gain or loss shape tone and advice.' },
  { id: 'discourse', fa: 'آینهٔ گفتمان: با لحن کاربر (مهربان، دستوری، شوخ، عصبانی) هم‌سو می‌شود، تا همان خط و بدون توهین.', en: 'A discourse mirror: it matches the user’s register — warm, commanding, playful, angry — up to that line and never with slurs.' },
  { id: 'approval', fa: 'هر اقدام مالی از دروازهٔ تأیید شما رد می‌شود و یک گارد FOMO هم جلوی تصمیم‌های هیجانی را می‌گیرد.', en: 'Every financial action passes your approval gate, and an FOMO guard stands against impulsive decisions.' }
]);

/* ── detection ────────────────────────────────────────────────────────────── */

const PRODUCT_WORDS = [
  'fbt', 'اف بی تی', 'این برنامه', 'این اپ', 'این پلتفرم', 'این سایت', 'این سایت', 'سایت شما',
  'برنامه شما', 'اپلیکیشن شما', 'پلتفرم شما', 'این محصول'
];

const INTENTS = [
  {
    id: 'creators',
    re: /سازنده|سازندگان|بنیان\s*گذار|بنیانگذار|موسس|مؤسس|چه کسی (?:ساخته|درست کرده)|تیم شما|تیم fbt|who (?:built|made|founded)|founder|team/i
  },
  {
    id: 'page',
    /* Any path-shaped token counts: an unknown one must reach the catalog and
       be answered as absent — not fall through to some other intent. */
    re: /این صفحه|این بخش|صفحهٔ\s*\/|(?:^|[\s(«"'])\/[a-z][a-z0-9-]{1,24}(?![\w])/i
  },
  {
    id: 'pages',
    re: /چه صفحه|کدام صفحه|لیست صفحه|همهٔ صفحه|همه صفحه|صفحه\s*های|بخش\s*های|چه بخش|all pages|which pages|site ?map|sitemap/i
  },
  {
    id: 'fees',
    re: /کارمزد|کمیسیون|هزینه(?:ٔ|ی)?\s*(?:سواپ|معامله|پلتفرم)|fee|commission/i
  },
  {
    id: 'security',
    re: /امنیت|امن است|امنه|کلید(?:ها)?|عبارت بازیابی|سرقت|هک|security|safe|seed phrase|private key/i
  },
  {
    id: 'capabilities',
    re: /چه کار(?:ی|ها)|چه قابلیت|قابلیت\s*ها|امکانات|چه چیزهایی|می\s*تونی چیکار|چه کاری می\s*کنی|capabilit|what can you do|features/i
  },
  {
    id: 'identity',
    re: /fbt چ(?:یست|یه)|اف بی تی چ(?:یست|یه)|what is fbt|دربارهٔ fbt|درباره fbt|about fbt/i
  }
];

function hasProductWord(text) {
  return PRODUCT_WORDS.some((w) => new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'iu').test(text));
}

/** Is this a question about FBT itself (not about the market)? */
export function detectProductQuestion(message = '') {
  const text = String(message || '').trim();
  if (!text) return false;
  const product = hasProductWord(text);
  if (product) return true;
  const intent = INTENTS.find((i) => i.re.test(text))?.id || null;
  if (intent === 'page' || intent === 'pages') return true;
  /* «چه کارهایی می‌تونی بکنی؟» is about this assistant, so it is about FBT —
     but only in the second person. «چه کار کنم؟» is a market question. */
  const secondPerson = /می\s*[‌]?تونی|می\s*[‌]?کنی|می\s*[‌]?شه\s*برام|you\s+(?:do|help)|your\s+(?:app|ai|assistant)/iu.test(text);
  return intent === 'capabilities' && secondPerson;
}

export function detectProductIntent(message = '') {
  const text = String(message || '');
  for (const intent of INTENTS) if (intent.re.test(text)) return intent.id;
  return 'identity';
}

/* ── answering ────────────────────────────────────────────────────────────── */

/**
 * Answer a product question deterministically.
 *
 * `confidence` is the honest one: 'verified' when everything asked is in the
 * brain, 'partial' when some of it is, and 'absent' when it is a real question
 * (creators, a specific policy) that the verified knowledge does not cover —
 * in which case the answer says so and points at the official channels.
 */
export function answerProduct({ message = '', locale = 'fa', limit = 6 } = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const intent = detectProductIntent(message);
  const text = String(message || '');
  const pages = pageCatalog();

  const facts = [];
  const pushFact = (id) => {
    const fact = PRODUCT_FACTS.find((f) => f.id === id);
    if (fact && !facts.some((f) => f.id === id)) facts.push(fact);
  };

  let knowledge = [];
  let matchedPages = [];
  let answer = '';
  let confidence = 'partial';
  const gaps = [];

  if (intent === 'pages') {
    matchedPages = pages;
    answer = fa
      ? `FBT ${pages.length} مسیر دارد. مهم‌ترین‌ها: ${pages.slice(0, 12).map((p) => `${p.path} (${p.purposeFa})`).join('، ')}.`
      : `FBT ships ${pages.length} routes. The main ones: ${pages.slice(0, 12).map((p) => `${p.path} (${p.purposeEn})`).join(', ')}.`;
    confidence = 'verified';
  } else if (intent === 'page') {
    const segments = [...text.matchAll(/(?<![\w])\/([a-z][a-z0-9-]*)/gi)].map((m) => m[1]);
    const named = segments.map(routeBySegment).filter(Boolean);
    const byPurpose = pages.filter((p) => p.described && p.purposeFa && text.includes(p.purposeFa.split(' ')[0]));
    matchedPages = named.length ? named : byPurpose.slice(0, 3);
    if (matchedPages.length) {
      answer = matchedPages.map((p) => `${p.path}: ${fa ? p.purposeFa : p.purposeEn}${p.gated ? (fa ? ` (وابسته به فعال‌سازی ${p.gate})` : ` (behind ${p.gate})`) : ''}`).join(' | ');
      confidence = 'verified';
    } else {
      answer = fa
        ? 'آن مسیر را در فهرست مسیرهای برنامه پیدا نکردم. مسیرها از خودِ جدول مسیرهای اپ خوانده می‌شوند و چیزی از خودم اضافه نمی‌کنم.'
        : 'I could not find that route in the app’s route table. The catalog is read from the router itself; I will not invent one.';
      confidence = 'absent';
      gaps.push('page');
    }
  } else if (intent === 'fees') {
    pushFact('fee');
    answer = fa
      ? `کارمزد پلتفرم ${feeFa()}٪ (${bpsFa} bps) هر سواپ است با سقف سخت ${feeFa(FEE_BPS_MAX)}٪. کارمزد شبکه (گس) جدا و به شبکهٔ مقصد بستگی دارد.`
      : `The platform fee is ${feeEn()} (${FEE_BPS} bps) per swap, hard-capped at ${feeEn(FEE_BPS_MAX)}. Network gas is separate and depends on the chain.`;
    confidence = 'verified';
  } else if (intent === 'security') {
    pushFact('custody');
    pushFact('never-asks');
    pushFact('authority');
    answer = fa
      ? 'کیف پول غیرامانی است: کلید و عبارت بازیابی فقط روی دستگاه شما می‌ماند. FBT هیچ‌وقت عبارت بازیابی/کلید خصوصی/رمز/کد دو مرحله‌ای نمی‌پرسد و هیچ تراکنشی بدون امضای شما اجرا نمی‌شود.'
      : 'Custody is non-custodial: the key and recovery phrase stay on your device. FBT never asks for the phrase, private key, password or 2FA code, and nothing runs without your signature.';
    confidence = 'verified';
  } else if (intent === 'capabilities') {
    answer = fa
      ? `قابلیت‌های امروز: ${PRODUCT_CAPABILITIES.slice(0, 6).map((c) => c.fa).join(' ')}`
      : `What ships today: ${PRODUCT_CAPABILITIES.slice(0, 6).map((c) => c.en).join(' ')}`;
    confidence = 'verified';
  } else if (intent === 'creators') {
    /* No verified statement about individuals exists in the repository. Saying
       so is the answer; composing a team is the failure this module prevents. */
    confidence = 'absent';
    gaps.push('creators');
    answer = fa
      ? 'نام سازندگان یا اعضای تیم در دانش تأییدشدهٔ محصول ثبت نشده است و من نام از خودم نمی‌سازم. چیزی که تأیید شده: FBT غیرامانی است، کلیدها روی دستگاه شما می‌مانند و هرکس عبارت بازیابی بخواهد کلاهبردار است. برای اطلاعات رسمی، صفحهٔ /contact (و /about) مرجع است.'
      : 'No verified statement about the founders or team exists in the product knowledge, and I will not compose one. What is verified: FBT is non-custodial, keys stay on your device, and anyone asking for a recovery phrase is a scammer. /contact (and /about) are the official references.';
  } else {
    pushFact('custody');
    pushFact('authority');
    const overview = FBT_KNOWLEDGE.find((k) => k.id === 'kb.product.overview');
    knowledge = overview ? [overview] : [];
    answer = fa
      ? `${overview ? overview.bodyFa + ' ' : ''}مسیرهای اصلی: /swap، /wallet، /portfolio، /signals، و خود فهرست بازار در /. کارمزد ${feeFa()}٪، و هیچ اقدامی بدون امضای شما اجرا نمی‌شود.`
      : `${overview ? overview.bodyEn + ' ' : ''}Main routes: /swap, /wallet, /portfolio, /signals, and the market list at /. The fee is ${feeEn()}, and nothing runs without your signature.`;
    confidence = 'verified';
  }

  return {
    schema: PRODUCT_BRAIN_SCHEMA,
    version: PRODUCT_BRAIN_VERSION,
    intent,
    confidence,
    answer,
    facts: facts.map((f) => ({ id: f.id, status: f.status, source: f.source, text: fa ? f.fa : f.en })),
    pages: matchedPages.slice(0, limit).map((p) => ({ path: p.path, page: p.page, gated: p.gated, text: fa ? p.purposeFa : p.purposeEn })),
    knowledge: knowledge.map((k) => ({ id: k.id, status: k.status, title: fa ? k.titleFa : k.titleEn })),
    sources: [
      ...facts.map((f) => f.source),
      ...knowledge.map((k) => k.id),
      ...(matchedPages.length ? ['src/App.jsx'] : [])
    ],
    gaps,
    pageCount: pages.length
  };
}

/* ── rendering ────────────────────────────────────────────────────────────── */

/** The verified product brain, as the source of truth for this turn. */
export function renderProductBrief(product) {
  if (!product || product.schema !== PRODUCT_BRAIN_SCHEMA) return '';
  const lines = ['VERIFIED PRODUCT KNOWLEDGE (source of truth about FBT; do not add to it):'];
  if (product.answer) lines.push(`- ${product.answer}`);
  for (const fact of product.facts) lines.push(`- [${fact.id}] ${fact.text}`);
  if (product.pages.length) {
    lines.push(`- pages that exist: ${product.pages.map((p) => `${p.path} — ${p.text}${p.gated ? ' (feature-gated)' : ''}`).join('; ')}`);
  }
  if (product.gaps.includes('creators')) {
    lines.push('- the founders/team are NOT in the verified knowledge. Say exactly that and point at /contact. Do not name anyone, do not invent a company history, do not guess roles.');
  }
  if (product.gaps.includes('page')) {
    lines.push('- that route does not exist in the app. Say it is not a page of FBT; do not invent what it does.');
  }
  lines.push('- anything about FBT that is not in this block: say it is not in the verified product knowledge and point at the official channel. Never fill the gap with a confident guess.');
  return lines.join('\n');
}

/* ── compliance ───────────────────────────────────────────────────────────── */

/* Persian digits and the Persian decimal separator defeat every ASCII
   pattern — the same trap that made INVENTED_PNL unreachable in review #3.
   Normalise once, then match. */
const FA_DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };
function normalizeNumbers(text) {
  return String(text || '')
    .replace(/[۰-۹]/g, (d) => FA_DIGITS[d])
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٫،]/g, '.');
}

const FEE_CLAIM_RE = /(\d+(?:[.,]\d+)?)\s*(?:درصد|٪|%)\s*(?:کارمزد|کمیسیون|fee)|(?:کارمزد|کمیسون|کمیسیون)[^0-9]{0,12}(\d+(?:[.,]\d+)?)\s*(?:درصد|٪|%)*/iu;
/* ZWNJ is not whitespace — «بنیان‌گذار» must match, so joiners are optional. */
const CREATOR_CLAIM_RE = /(?:بنیان[\s‌]*گذار|موسس|مؤسس|سازنده[\s‌]*های?|سازندگان|تیم)[\s‌]*(?:آن|این|fbt|اف[\s‌]*بی[\s‌]*تی)?[\s‌]*(?:آقای|خانم|مهندس|دکتر|جناب)?[\s‌]+([\p{L}][\p{L}\s‌]{2,})/iu;
const FOUNDED_RE = /(?:(?:تاسیس|تأسیس|راه[\s‌]*اندازی|founded)[\s\S]{0,16}?(?:19|20)\d{2})|(?:(?:19|20)\d{2}[\s\S]{0,12}?(?:تاسیس|تأسیس|راه[\s‌]*اندازی|founded))/iu;
const CUSTODY_VIOLATION_RE = /(?:کلید(?:ها)?|عبارت بازیابی)[\s\S]{0,20}?(?:به|برای)[\s‌]*(?:ما|پشتیبانی|تیم)[\s\S]{0,12}?(?:بفرست|بده|ارسال|بفرستید)/iu;
/* Only a company/office formation claim, not the ordinary «ما در بازار…». */
const ABOUT_US_RE = /(?:شرکت|دفتر|تیم)[\s‌]*ما[\s\S]{0,14}?(?:در|واقع\s*در)[\s‌]+[\p{L}]{3,}/iu;

/**
 * Did the answer stay inside the verified product knowledge?
 *
 * Four narrow checks. A general market answer is never affected, because this
 * only runs on turns that asked about FBT itself.
 */
export function checkProductAnswer({ product = null, answer = '' } = {}) {
  const raw = String(answer || '');
  const text = normalizeNumbers(raw);
  const textNoJoiners = normalizeNumbers(raw).replace(/‌/g, ' ');
  const issues = [];
  if (!product || product.schema !== PRODUCT_BRAIN_SCHEMA || !text.trim()) {
    return { schema: PRODUCT_BRAIN_SCHEMA, applicable: false, issues, compliant: true };
  }

  /* 1. Naming a creator the knowledge does not contain.
   *
   * The honest answer — «نام سازندگان در دانش تأییدشده ثبت نشده» — contains
   * the same nouns as a confident fabrication, so the check is per sentence
   * and skips any sentence that disclaims: the phrase «سازندگان … نیست» must
   * never be punished, or the reviewer would push the model toward inventing. */
  if (product.gaps.includes('creators')) {
    const DISCLAIMER_RE = /نیست|نیستند|ثبت\s*نشده|در\s*دسترس\s*نیست|نمی\s*[‌]?سازم|نام\s*نمی|معلوم\s*نیست|در\s*دانش|تأیید\s*نشده|not\s+(?:in|recorded|known)|unknown|no\s+verified|do\s+not\s+have/i;
    const sentences = textNoJoiners.split(/[.!?؟\n]+/).filter(Boolean);
    const claiming = sentences.filter((sentence) => !DISCLAIMER_RE.test(sentence) && (CREATOR_CLAIM_RE.test(sentence) || FOUNDED_RE.test(sentence) || ABOUT_US_RE.test(sentence)));
    if (claiming.length) {
      issues.push({
        id: 'UNVERIFIED_CREATOR_CLAIM',
        severity: 'HIGH',
        detail: 'the answer names a founder/team, a founding year or a company location, and none of that is in the verified knowledge. Say it is not recorded and point at /contact.'
      });
    }
  }

  /* 2. A fee number that is not the platform fee. */
  const feeMatch = FEE_CLAIM_RE.exec(text);
  if (feeMatch) {
    const value = Number(String(feeMatch[1] || feeMatch[2]).replace(',', '.'));
    const known = [0.7, 1, 70];
    if (!known.some((k) => Math.abs(k - value) < 1e-9)) {
      issues.push({
        id: 'INVENTED_FEE',
        severity: 'HIGH',
        detail: `the answer states a ${value}% platform fee. The verified fee is 0.70% (70 bps), hard-capped at 1%.`
      });
    }
  }

  /* 3. A route that does not exist in the router. */
  const paths = [...text.matchAll(/(?<![\w.])\/([a-z][a-z0-9-]{1,24})(?![\w])/g)].map((m) => `/${m[1]}`);
  const unknownPaths = [...new Set(paths)].filter((p) => !routeBySegment(p));
  if (unknownPaths.length) {
    issues.push({
      id: 'UNSUPPORTED_PAGE',
      severity: 'MEDIUM',
      detail: `the answer cites ${unknownPaths.join(', ')} which is not a route in the app. Only cite pages that exist.`
    });
  }

  /* 4. Anything that contradicts custody. */
  if (CUSTODY_VIOLATION_RE.test(text)) {
    issues.push({
      id: 'CONTRADICTS_CUSTODY',
      severity: 'HIGH',
      detail: 'the answer asks the user to send a key or recovery phrase. FBT never asks for those; this is exactly what a scammer does.'
    });
  }

  return {
    schema: PRODUCT_BRAIN_SCHEMA,
    applicable: true,
    intent: product.intent,
    confidence: product.confidence,
    issues,
    compliant: issues.length === 0
  };
}

/** The reviewer's MUST-FIX block ('' when the draft stays inside the facts). */
export function renderProductDeficit(check) {
  if (!check || check.compliant !== false || !check.issues?.length) return '';
  return `PRODUCT KNOWLEDGE VIOLATIONS (the answer goes beyond what FBT can state; fix each one):\n${check.issues
    .map((i) => `- [${i.id}] ${i.detail}`)
    .join('\n')}`;
}

export default answerProduct;
