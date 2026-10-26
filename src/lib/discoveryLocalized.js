/**
 * PERSIAN COPY FOR THE DISCOVERY REGISTRY
 * ---------------------------------------------------------------------------
 * The registry (discoveryRegistry.js) is deliberately language-neutral: brand
 * names, official domains, chain ids and English descriptions are facts about
 * the dApp, not UI copy. Translation lives here so adding a protocol never
 * means editing a 17,000-line locale file, and so a translated description can
 * never drift from the URL it describes.
 *
 * `aliases` are the spellings a Persian user actually types. They are search
 * input only — nothing here is rendered as a name.
 */
import { normalizeText } from './discoveryText.js';

export const PROTOCOL_FA = {
  // DEX
  uniswap: { desc: 'بزرگ‌ترین صرافی غیرمتمرکز اتریوم و لایه‌های دوم آن برای سواپ توکن.', aliases: ['یونیسواپ', 'یونی سواپ'] },
  pancakeswap: { desc: 'صرافی اصلی BNB Chain برای سواپ، استخر نقدینگی و فارم.', aliases: ['پنکیک سواپ', 'پنکیک'] },
  curve: { desc: 'سواپ استیبل‌کوین و دارایی‌های هم‌ارزش با کمترین لغزش قیمت.', aliases: ['کرو', 'کرو فایننس'] },
  balancer: { desc: 'نقدینگی قابل برنامه‌ریزی؛ استخرهای سفارشی و پرتفوی وزنی.', aliases: ['بالانسر'] },
  sushiswap: { desc: 'صرافی غیرمتمرکز چندزنجیره‌ای با سواپ بین‌شبکه‌ای.', aliases: ['سوشی', 'سوشی سواپ'] },
  aerodrome: { desc: 'مرکز اصلی نقدینگی روی Base با مدل ve(3,3).', aliases: ['آئرودروم', 'ایرودروم'] },
  kyberswap: { desc: 'تجمیع‌کنندهٔ چندزنجیره‌ای که بهترین نرخ را بین صرافی‌ها پیدا می‌کند.', aliases: ['کیبرسواپ', 'کایبر سواپ'] },
  oneinch: { desc: 'مسیریاب سواپ میان صدها منبع نقدینگی مختلف.', aliases: ['وان اینچ', '۱ اینچ'] },
  // Lending
  aave: { desc: 'پروتکل پیشرو وام‌دهی؛ سپرده‌گذاری، وام‌گیری و کسب سود.', aliases: ['آوه'] },
  compound: { desc: 'بازارهای پول الگوریتمی با نرخ وام و سپردهٔ پویا.', aliases: ['کامپاند', 'کامپاوند'] },
  morpho: { desc: 'وام‌دهی بدون مجوز با خزانه‌های منتخب و بازارهای جداگانه.', aliases: ['مورفو'] },
  spark: { desc: 'وام‌دهی هم‌سو با اکوسیستم MakerDAO؛ پس‌انداز DAI و وام‌گیری.', aliases: ['اسپارک'] },
  venus: { desc: 'وام‌دهی و استیبل‌کوین مصنوعی روی BNB Chain.', aliases: ['ونوس'] },
  kamino: { desc: 'خزانه‌های خودکار و وام‌دهی یکپارچه روی سولانا.', aliases: ['کامینو'] },
  // Yield
  yearn: { desc: 'تجمیع‌کنندهٔ سود؛ خزانه‌های خودکار با سود مرکب در دیفای.', aliases: ['یرن', 'یرن فایننس'] },
  beefy: { desc: 'بهینه‌ساز سود چندزنجیره‌ای با خزانه‌های ترکیب‌شونده.', aliases: ['بیفی'] },
  pendle: { desc: 'معاملهٔ سود آینده؛ توکنیزه کردن و خرید و فروش بازده.', aliases: ['پندل'] },
  lido: { desc: 'استیکینگ نقدشونده؛ استیک ETH و حفظ نقدینگی با stETH.', aliases: ['لیدو'] },
  convex: { desc: 'پاداش تقویت‌شده برای تأمین‌کنندگان نقدینگی Curve.', aliases: ['کانوکس'] },
  jito: { desc: 'استیکینگ نقدشونده و توزیع پاداش MEV روی سولانا.', aliases: ['جیتو'] },
  // Bridges
  stargate: { desc: 'انتقال نقدینگی میان زنجیره‌ها؛ پل دارایی بین شبکه‌ها.', aliases: ['استارگیت'] },
  across: { desc: 'پل سریع و کم‌کارمزد بین زنجیره‌ها با اوراکل UMA.', aliases: ['اکراس'] },
  wormhole: { desc: 'پروتکل هم‌کنش‌پذیری؛ پیام‌رسانی و پل انتقال توکن.', aliases: ['ورم هول'] },
  synapse: { desc: 'پل و سواپ بین شبکه‌ها برای جابه‌جایی دارایی.', aliases: ['سیناپس'] },
  hop: { desc: 'پل میان رولاپ‌ها؛ انتقال سریع به لایه‌های دوم.', aliases: ['هاپ'] },
  layerzero: { desc: 'هم‌کنش‌پذیری میان زنجیره‌ها؛ پیام‌رسانی برای اپ‌های چندزنجیره‌ای.', aliases: ['لیر زیرو'] },
  // Analytics
  defillama: { desc: 'آمار TVL، درآمد و پل‌های دیفای؛ دادهٔ آزاد و شفاف.', aliases: ['دیفای لاما'] },
  dune: { desc: 'داشبورد و کوئری سفارشی روی داده‌های رمزگشایی‌شدهٔ بلاک‌چین.', aliases: ['دیون'] },
  nansen: { desc: 'برچسب‌گذاری کیف پول‌ها و ردیابی جریان پول هوشمند.', aliases: ['نانسن'] },
  dexscreener: { desc: 'نمودار زنده و ردیاب قیمت جفت‌های معاملاتی صرافی‌های غیرمتمرکز.', aliases: ['دکس اسکرینر'] },
  coingecko: { desc: 'مرجع قیمت، ارزش بازار و حجم معاملات هزاران توکن.', aliases: ['کوین گکو'] },
  arkham: { desc: 'تحلیل روی‌زنجیره؛ ردیابی کیف پول‌های مرتبط با نهادها.', aliases: ['آرکهام'] },
  geckoterminal: { desc: 'نمودار لحظه‌ای استخرهای دیفای از خانوادهٔ CoinGecko.', aliases: ['گکو ترمینال'] },
  // RWA
  ondo: { desc: 'اوراق خزانهٔ آمریکا و دارایی‌های واقعی توکن‌شدهٔ سازمانی.', aliases: ['اندو'] },
  centrifuge: { desc: 'تأمین مالی دارایی‌های دنیای واقعی روی زنجیره.', aliases: ['سنتریفیوژ'] },
  maple: { desc: 'استخرهای وام سازمانی با وثیقهٔ دارایی‌های واقعی.', aliases: ['مِیپل'] },
  goldfinch: { desc: 'اعتبار غیرمتمرکز برای تأمین مالی کسب‌وکارهای دنیای واقعی.', aliases: ['گلدفینچ'] },
  backed: { desc: 'سهام و صندوق‌های ETF توکن‌شده با پشتوانهٔ یک‌به‌یک.', aliases: ['بکد'] },
  // NFT
  opensea: { desc: 'بزرگ‌ترین بازار NFT روی شبکه‌های متعدد.', aliases: ['اپن سی', 'اوپن سی'] },
  blur: { desc: 'بازار حرفه‌ای NFT با تمرکز بر سرعت و ابزار معامله‌گران.', aliases: ['بلور'] },
  magiceden: { desc: 'بازار NFT چندزنجیره‌ای؛ پیشرو روی سولانا و بیت‌کوین.', aliases: ['مجیک ادن'] },
  tensor: { desc: 'پلتفرم معاملهٔ حرفه‌ای NFT روی سولانا؛ تجمیع‌کنندهٔ سریع.', aliases: ['تنسور'] },
  element: { desc: 'بازار NFT چندزنجیره‌ای با پشتیبانی از شبکه‌های EVM.', aliases: ['المنت'] },
  looksrare: { desc: 'بازار NFT مبتنی بر جامعه با پاداش برای معامله‌گران.', aliases: ['لوکس ریر'] },
  // Dev tools
  etherscan: { desc: 'کاوشگر بلاک اتریوم؛ بررسی قراردادها، آدرس‌ها و تراکنش‌ها.', aliases: ['اتر اسکن'] },
  bscscan: { desc: 'کاوشگر BNB Chain؛ بررسی آدرس‌ها، تراکنش‌ها و توکن‌ها.', aliases: ['بی‌اس‌سی اسکن', 'بیاسسی اسکن'] },
  arbiscan: { desc: 'کاوشگر رسمی Arbitrum از خانوادهٔ Etherscan.', aliases: ['آربی اسکن'] },
  alchemy: { desc: 'پلتفرم توسعهٔ وب۳؛ نود، API و ابزارهای برنامه‌نویسی.', aliases: ['آلکمی'] },
  chainlink: { desc: 'شبکهٔ اوراکل غیرمتمرکز؛ خوراک قیمت و اتوماسیون میان‌زنجیره‌ای.', aliases: ['چین لینک'] },
  thegraph: { desc: 'پروتکل ایندکس‌گذاری دادهٔ بلاک‌چین برای برنامه‌های وب۳.', aliases: ['د گراف'] },
  tenderly: { desc: 'پایش، اشکال‌زدایی و شبیه‌سازی تراکنش‌های قرارداد هوشمند.', aliases: ['تندرلی'] },
  thirdweb: { desc: 'ابزار کامل توسعهٔ وب۳؛ SDK، قراردادهای آماده و داشبورد.', aliases: ['ثرد وب'] },
  l2beat: { desc: 'تحلیل ریسک و سرمایهٔ قفل‌شدهٔ لایه‌های دوم؛ دادهٔ شفاف.', aliases: ['ال تو بیت'] },
};

/** Chain names as a Persian reader writes them. */
export const CHAIN_FA = {
  Ethereum: 'اتریوم',
  Arbitrum: 'آربیتروم',
  'Arbitrum One': 'آربیتروم',
  Base: 'بیس',
  Polygon: 'پالیگان',
  Optimism: 'آپتیمیزم',
  'BNB Smart Chain': 'بایننس اسمارت چین',
  BSC: 'بایننس اسمارت چین',
  Avalanche: 'آوالانچ',
  Sonic: 'سونیک',
  Linea: 'لینیا',
  Solana: 'سولانا',
  Fantom: 'فانتوم',
};

export function descriptionFor(protocol, lang) {
  if (!protocol) return '';
  const fa = PROTOCOL_FA[protocol.id];
  return lang === 'fa' && fa?.desc ? fa.desc : (protocol.description || '');
}

export function chainLabel(name, lang) {
  return lang === 'fa' ? (CHAIN_FA[name] || name) : name;
}

/** Search-only spellings; never rendered. */
export function aliasesFor(protocol, lang) {
  if (lang !== 'fa') return [];
  return PROTOCOL_FA[protocol?.id]?.aliases || [];
}

/** Pre-built, normalized haystack for a protocol in the active language. */
export function protocolHaystack(protocol, lang, categoryLabels = {}) {
  const parts = [
    protocol.name, protocol.domain, protocol.url, protocol.slug, protocol.id,
    protocol.category, categoryLabels[protocol.category] || '',
    descriptionFor(protocol, 'en'), descriptionFor(protocol, 'fa'),
    ...(protocol.chains || []),
    ...(protocol.chains || []).map((c) => CHAIN_FA[c] || ''),
    ...(protocol.chainIds || []).map(String),
    ...aliasesFor(protocol, 'fa'),
  ];
  return normalizeText(parts.filter(Boolean).join(' '));
}
