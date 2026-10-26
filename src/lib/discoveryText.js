/**
 * DISCOVERY TEXT NORMALIZER
 * ---------------------------------------------------------------------------
 * One place for the two things that made search on this screen feel broken to
 * a Persian reader:
 *
 *  1. The same Persian word is written in several ways (Arabic ي/ك, ZWNJ,
 *     Persian digits, half-spaces). Comparing the raw strings finds nothing.
 *  2. The registry is in English, while the user types Persian — «وام روی
 *     آربیتروم» would never match `category: lending`.
 *
 * `latinizeDiscoveryQuery` maps the vocabulary a Persian user actually types
 * onto the English tokens the registry and the AI interpreter understand.
 * It is deliberately a vocabulary map, not a transliterator: brand names and
 * chain names are the only words that need it, and a fuzzy transliteration of
 * everything else produces far more false positives than a short, honest list.
 *
 * Pure functions, no React, no `import.meta.env` — so the search engine can be
 * tested in plain Node.
 */

/** Persian/Arabic phrase → the English token used by the registry + AI parser. */
/* Brand aliases come FIRST: «پنکیک سواپ» must become `pancakeswap`, not `dex`. */
const PHRASE_MAP = [
  // Brand names people write in Persian
  [/یونی\s*سواپ|یونیسواپ/g, 'uniswap'],
  [/پنکیک\s*سواپ|پنکیک/g, 'pancakeswap'],
  [/کرو\s*فایننس|کرو/g, 'curve'],
  [/بالانسر/g, 'balancer'],
  [/سوشی\s*سواپ|سوشی/g, 'sushiswap'],
  [/کایبر\s*سواپ|کیبر\s*سواپ/g, 'kyberswap'],
  [/آوه/g, 'aave'],
  [/کامپاند|کامپاوند/g, 'compound'],
  [/مورفو/g, 'morpho'],
  [/یرن|یرن\s*فایننس/g, 'yearn'],
  [/لیدو/g, 'lido'],
  [/پندل/g, 'pendle'],
  [/آپن\s*سی|اوپن\s*سی/g, 'opensea'],
  [/بلور/g, 'blur'],
  [/مجیک\s*ادن/g, 'magiceden'],
  [/متامسک/g, 'metamask'],
  [/دیفای\s*لاما|دیفای\s*لما/g, 'defillama'],
  [/کوین\s*گکو|کوین\s*جکو/g, 'coingecko'],
  [/دکس\s*اسکرینر/g, 'dexscreener'],
  [/گکو\s*ترمینال/g, 'geckoterminal'],
  [/چین\s*لینک/g, 'chainlink'],
  [/اتر\s*اسکن/g, 'etherscan'],
  [/بی\s*اس\s*سی\s*اسکن/g, 'bscscan'],
  [/آربی\s*اسکن/g, 'arbiscan'],
  // Networks
  [/آربیتروم|اربیتروم|آربیترام/g, 'arbitrum'],
  [/بایننس|بی\s*ان\s*بی|بیانس/g, 'bnb'],
  [/اتریوم|اتریا/g, 'ethereum'],
  [/پالیگان|پولیگان/g, 'polygon'],
  [/آپتیمیزم|اوپتیمیزم/g, 'optimism'],
  [/اولانچ|آوالانچ/g, 'avalanche'],
  [/سولانا/g, 'solana'],
  [/لاینا/g, 'linea'],
  [/سونیک/g, 'sonic'],
  [/شبکه\s*بیس|بیس/g, 'base'],
  // Categories
  [/وام\s*دهی|وام|قرض|استقراض|لندینگ/g, 'lending'],
  [/صرافی|سواپ|معامله|دکس/g, 'dex'],
  [/سود|درآمد|فارم|استیکینگ|استیک|بازده/g, 'yield'],
  [/پل|بریج|میان\s*زنجیره|چند\s*زنجیره/g, 'bridges'],
  [/تحلیل|آنالیز|داده|نمودار|کاوشگر|داشبورد/g, 'analytics'],
  [/دارایی\s*واقعی|توکن\s*شده/g, 'rwa'],
  [/ان\s*اف\s*تی|کلکسیونی/g, 'nft'],
  [/توسعه\s*دهنده|ابزار|اوراکل|زیرساخت/g, 'dev'],
  [/دیفای|امور\s*مالی\s*غیرمتمرکز/g, 'defi'],
  // Security / ranking intent
  [/امن|امنیت|حسابرسی|ممیزی|مطمئن/g, 'audit'],
  [/جدید|تازه|اخیر/g, 'new'],
  [/مقایسه/g, 'compare'],
  [/داغ|محبوب|پرطرفدار/g, 'trending'],
  [/بیشترین\s*سرمایه|بزرگترین/g, 'tvl'],
  [/حجم\s*معاملات|پرمعامله/g, 'volume'],
  // Latin tokens: word boundaries only, so `uniswap` never turns into `uni dex`.
  [/\bbnb\b|\bbinance\b/g, 'bnb'],
  [/\bswap\b|\bdex\b|\bamm\b/g, 'dex'],
  [/\blending\b|\bborrow\b|\blend\b|\bloan\b/g, 'lending'],
  [/\byield\b|\bfarm\b|\bvault\b|\bapy\b|\bstaking\b/g, 'yield'],
  [/\bbridge\b|\bbridges\b/g, 'bridges'],
  [/\banalytics\b|\bdata\b|\bchart\b|\bexplorer\b/g, 'analytics'],
  [/\brwa\b/g, 'rwa'],
  [/\bnft\b/g, 'nft'],
  [/\bdeveloper\b|\bdev\b|\boracle\b/g, 'dev'],
  [/\bdefi\b/g, 'defi'],
  [/\baudit\b|\bsecurity\b|\bsafe\b|\bverified\b/g, 'audit'],
  [/\bnew\b|\brecent\b|\bfresh\b|\bdiscovered\b/g, 'new'],
  [/\bcompare\b/g, 'compare'],
  [/\btrending\b|\bpopular\b|\bhot\b|\bbest\b/g, 'trending'],
  [/\btvl\b|\bliquidity\b|\bbiggest\b/g, 'tvl'],
  [/\bvolume\b|\bactive\b|\btrading\b/g, 'volume'],
];

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Map Persian intent words to English tokens, leaving everything else alone. */
export function latinizeDiscoveryQuery(raw) {
  let s = String(raw ?? '');
  // ZWNJ / tatweel / Arabic letter variants first, so «وامدهی» == «وام دهی».
  s = s.replace(/[\u200c\u200d\u0640]/g, '');
  s = s.replace(/[\u064b-\u065f\u0670]/g, '');
  s = s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه');
  s = s.replace(new RegExp(`[${PERSIAN_DIGITS}]`, 'g'), (d) => String(PERSIAN_DIGITS.indexOf(d)));
  s = s.replace(new RegExp(`[${ARABIC_DIGITS}]`, 'g'), (d) => String(ARABIC_DIGITS.indexOf(d)));
  s = s.toLowerCase();
  for (const [re, token] of PHRASE_MAP) s = s.replace(re, ` ${token} `);
  return s;
}

/**
 * Canonical form for both the query AND the haystack. Keeping one function on
 * both sides is what guarantees «یونیسواپ», «uniswap» and «UNISWAP» all meet.
 */
export function normalizeText(raw) {
  return latinizeDiscoveryQuery(raw)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens, ignoring one-character noise. */
export function queryTokens(raw) {
  return normalizeText(raw).split(' ').filter((w) => w.length > 1);
}

/** True when the URL / brand text should be forced LTR in an RTL layout. */
export function isLatinBrand(text) {
  return /^[\x20-\x7e]+$/.test(String(text ?? ''));
}
