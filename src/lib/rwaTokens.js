/**
 * RWA TOKENS — Real-World Assets & Tokenized Securities Registry.
 * ---------------------------------------------------------------------------
 * Provides verified on-chain RWA tokens (Treasuries, Gold/Commodities,
 * Robinhood Stock Tokens, Institutional Credit) with non-custodial swap routes
 * and explicit platform fee (0.70%) disclosures.
 */

import { apiBase } from './apiBase.js';
import { FEE_BPS, feePercentString } from './feeBps.js';

const API_BASE = apiBase();

export const RWA_CATEGORIES = [
  { id: 'all', key: 'stocks.rwaCategory.all', fallback: 'All' },
  { id: 'treasury', key: 'stocks.rwaCategory.treasury', fallback: 'Treasuries & Yield' },
  { id: 'commodity', key: 'stocks.rwaCategory.commodity', fallback: 'Gold & Commodities' },
  { id: 'robinhood', key: 'stocks.rwaCategory.robinhood', fallback: 'Robinhood Chain' },
  { id: 'credit', key: 'stocks.rwaCategory.credit', fallback: 'Credit & Real Assets' }
];

export const RWA_CURATED_TOKENS = [
  {
    id: 'ondo-us-dollar-yield',
    symbol: 'USDY',
    name: 'Ondo US Dollar Yield',
    category: 'treasury',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x9694EED19A1b509395374E693A6017b3C5c9c991',
    decimals: 18,
    coingeckoId: 'ondo-us-dollar-yield',
    backingFa: 'اوراق خزانه کوتاه‌مدت آمریکا و سپرده‌های بانکی',
    backingEn: 'US Short-term Treasuries & Bank Deposits',
    backingAr: 'سندات الخزانة الأمريكية والودائع المصرفية',
    descFa: 'توکن سودده دلاری با بازدهی سالانه و وثیقه‌گذاری دارایی‌های واقعی',
    descEn: 'Yield-bearing dollar token backed by real-world US treasuries',
    descAr: 'توكن عائد بالدولار مدعوم بسندات الخزانة الأمريكية',
    defaultPrice: 1.05,
    feeBps: FEE_BPS
  },
  {
    id: 'global-dollar',
    symbol: 'USDG',
    name: 'Global Dollar (Robinhood / Paxos)',
    category: 'treasury',
    chainId: 4663,
    chainName: 'Robinhood Chain',
    address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    decimals: 6,
    coingeckoId: 'global-dollar',
    backingFa: 'پشتوانه ۱:۱ دلار و اوراق قرضه تحت نظارت پکسوس',
    backingEn: '1:1 Cash & US Treasuries (Paxos)',
    backingAr: 'مدعوم بنسبة ۱:۱ بالنقد وسندات الخزانة (باكسوس)',
    descFa: 'استیبل‌کوین رسمی اکوسیستم رابین‌هود و کنسرسیوم دلاری',
    descEn: 'Official stablecoin of Robinhood Chain and Global Dollar Network',
    descAr: 'العملة المستقرة الرسمية لشبكة روبنهود وشبكة الدولار العالمي',
    defaultPrice: 1.0,
    feeBps: FEE_BPS
  },
  {
    id: 'pax-gold',
    symbol: 'PAXG',
    name: 'PAX Gold',
    category: 'commodity',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x45804880De22913dAFE09f4980848ECE6EcbAf78',
    decimals: 18,
    coingeckoId: 'pax-gold',
    backingFa: '۱:۱ شمش طلای فیزیکی در خزانه‌های معتبر لندن',
    backingEn: '1:1 Physical Gold in London Vaults',
    backingAr: 'سبائك ذهب فيزيائية بنسبة ۱:۱ في خزائن لندن',
    descFa: 'هر توکن نماینده یک اونس تروی طلای خالص با نظارت NYDFS',
    descEn: 'Each token represents 1 fine troy ounce of gold regulated by NYDFS',
    descAr: 'يمثل كل توكن أونصة تروي واحدة من الذهب الخالص تحت إشراف NYDFS',
    defaultPrice: 2650.0,
    feeBps: FEE_BPS
  },
  {
    id: 'tether-gold',
    symbol: 'XAUt',
    name: 'Tether Gold',
    category: 'commodity',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x68749665FF8D2d112Fa859AA293F07A622782F38',
    decimals: 6,
    coingeckoId: 'tether-gold',
    backingFa: '۱:۱ طلای فیزیکی در خزانه‌های امن سوئیس',
    backingEn: '1:1 Physical Gold in Swiss Vaults',
    backingAr: 'ذهب فيزيائي بنسبة ۱:۱ في خزائن سويسرا',
    descFa: 'مالکیت دیجیتال طلای فیزیکی با شماره سریال شمش مشخص',
    descEn: 'Physical gold ownership with allocated bullion serial numbers',
    descAr: 'ملكية رقمية للذهب الفيزيائي مع أرقام تسلسلية مخصصة للسبائك',
    defaultPrice: 2650.0,
    feeBps: FEE_BPS
  },
  {
    id: 'ondo-finance',
    symbol: 'ONDO',
    name: 'Ondo Finance',
    category: 'treasury',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3',
    decimals: 18,
    coingeckoId: 'ondo-finance',
    backingFa: 'پروتکل اوراق قرضه نهادی و بازدهی دارایی‌های واقعی',
    backingEn: 'Institutional RWA & US Treasury Yield Protocol',
    backingAr: 'بروتوكول سندات المؤسسات وعوائد الأصول الحقيقية',
    descFa: 'پیشرو در توکنیزه‌سازی دارایی‌های سازمانی و اوراق بهادار سنتی',
    descEn: 'Leader in institutional asset tokenization and yield products',
    descAr: 'الرائد في ترميز أصول المؤسسات ومنتجات العوائد',
    defaultPrice: 0.85,
    feeBps: FEE_BPS
  },
  {
    id: 'rigetti-computing',
    symbol: 'RGTI',
    name: 'Rigetti Computing • Robinhood Token',
    category: 'robinhood',
    chainId: 4663,
    chainName: 'Robinhood Chain',
    address: '0x284358abc07f9359f19f4b5b4ac91901be2597ba',
    decimals: 18,
    coingeckoId: null,
    referenceTicker: 'RGTI',
    backingFa: 'سهام توکنیزه رابین‌هود چین بر پایه اتریوم L2',
    backingEn: 'Tokenized Stock on Robinhood Layer-2',
    backingAr: 'أسهم مرمزة على شبكة روبنهود L2',
    descFa: 'سهام شرکت رایانش کوانتومی ریگتی بر روی لایه دوم رابین‌هود',
    descEn: 'Quantum computing stock tokenized on Robinhood Chain',
    descAr: 'سهم حوسبة الكم المرمز على شبكة روبنهود',
    defaultPrice: 2.35,
    feeBps: FEE_BPS
  },
  {
    id: 'joby-aviation',
    symbol: 'JOBY',
    name: 'Joby Aviation • Robinhood Token',
    category: 'robinhood',
    chainId: 4663,
    chainName: 'Robinhood Chain',
    address: '0xb334c5ce741b80b5b671f47f5c269cb193fe8e24',
    decimals: 18,
    coingeckoId: null,
    referenceTicker: 'JOBY',
    backingFa: 'سهام توکنیزه رابین‌هود چین بر پایه اتریوم L2',
    backingEn: 'Tokenized Stock on Robinhood Layer-2',
    backingAr: 'أسهم مرمزة على شبكة روبنهود L2',
    descFa: 'سهام شرکت هوانوردی برقی جوبی روی زنجیره رابین‌هود',
    descEn: 'Electric aviation company tokenized on Robinhood Chain',
    descAr: 'سهم شركة الطيران الكهربائي المرمز على شبكة روبنهود',
    defaultPrice: 5.65,
    feeBps: FEE_BPS
  },
  {
    id: 'sofi-technologies',
    symbol: 'SOFI',
    name: 'SoFi Technologies • Robinhood Token',
    category: 'robinhood',
    chainId: 4663,
    chainName: 'Robinhood Chain',
    address: '0x98e75885157c80992a8d41b696d8c9c6fb30a926',
    decimals: 18,
    coingeckoId: null,
    referenceTicker: 'SOFI',
    backingFa: 'سهام توکنیزه رابین‌هود چین بر پایه اتریوم L2',
    backingEn: 'Tokenized Stock on Robinhood Layer-2',
    backingAr: 'أسهم مرمزة على شبكة روبنهود L2',
    descFa: 'سهام فین‌تک SoFi روی لایه دوم رابین‌هود',
    descEn: 'Fintech pioneer tokenized on Robinhood Layer-2',
    descAr: 'سهم التقنية المالية SoFi المرمز على شبكة روبنهود',
    defaultPrice: 8.20,
    feeBps: FEE_BPS
  },
  {
    id: 'maker',
    symbol: 'MKR',
    name: 'Maker',
    category: 'credit',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
    decimals: 18,
    coingeckoId: 'maker',
    backingFa: 'سبد بیش‌وثیقه‌گذاری‌شده اوراق قرضه آمریکا و دارایی‌های واقعی',
    backingEn: 'Over-collateralized US Treasuries & Real Assets',
    backingAr: 'سندات الخزانة الأمريكية والأصول الحقيقية المرهونة',
    descFa: 'بزرگترین دارنده اوراق خزانه‌داری آمریکا در دیفای و صادرکننده DAI',
    descEn: 'Leading holder of US Treasuries in DeFi and issuer of DAI',
    descAr: 'أكبر حامل لسندات الخزانة في التمويل اللامركزي ومصدر DAI',
    defaultPrice: 1850.0,
    feeBps: FEE_BPS
  },
  {
    id: 'centrifuge',
    symbol: 'CFG',
    name: 'Centrifuge',
    category: 'credit',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0xcccCCCcCCC33D538DBC2EE4fEab0a7A1FF4e8A94',
    decimals: 18,
    coingeckoId: 'centrifuge',
    backingFa: 'وام‌های تجاری، فاکتورها و دارایی‌های امانی دنیای واقعی',
    backingEn: 'Trade Invoices & Structured Real-World Credit',
    backingAr: 'الفواتير التجارية والائتمان المهيكل للأصول الحقيقية',
    descFa: 'پل اتصال سرمایه نقدینگی دیفای به وام‌های تجاری دنیای واقعی',
    descEn: 'Connecting DeFi capital to real-world assets and structured credit',
    descAr: 'جسر يربط سيولة التمويل اللامركزي بأصول وائتمان العالم الحقيقي',
    defaultPrice: 0.38,
    feeBps: FEE_BPS
  },
  {
    id: 'pendle',
    symbol: 'PENDLE',
    name: 'Pendle Finance',
    category: 'treasury',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x808507b2314050238865872ac79528349429907f',
    decimals: 18,
    coingeckoId: 'pendle',
    backingFa: 'توکنیزه‌سازی سود اوراق و خزانه‌های RWA',
    backingEn: 'RWA Vault Yield Tokenization',
    backingAr: 'ترميز عوائد خزائن الأصول الحقيقية',
    descFa: 'پروتکل جداسازی و معامله سود دارایی‌های درآمدزا و اوراق خزانه',
    descEn: 'Yield-trading protocol tokenizing RWA and treasury yields',
    descAr: 'بروتوكول تداول العوائد المرمزة للأصول الحقيقية والسندات',
    defaultPrice: 4.10,
    feeBps: FEE_BPS
  }
];

/**
 * Build the exact swap URL for an RWA token with counter-token pre-filled.
 * Evaluates network context and ensures the 0.70% platform fee applies.
 *
 * @param {object} token
 * @returns {string}
 */
export function getRwaSwapUrl(token) {
  if (!token) return '/swap';

  if (token.chainId === 'solana') {
    return `/solana?to=${encodeURIComponent(token.symbol || token.address || '')}`;
  }

  const chainId = token.chainId || 1;

  if (chainId === 4663) {
    // Robinhood Chain: default counter-token is USDG, unless the target is USDG itself (then ETH)
    const counter = token.symbol === 'USDG' ? 'ETH' : 'USDG';
    return `/swap?chain=4663&from=${counter}&to=${encodeURIComponent(token.symbol)}`;
  }

  // Ethereum / Arbitrum / other EVMs: default counter-token is USDT
  const counter = token.symbol === 'USDT' ? 'ETH' : 'USDT';
  return `/swap?chain=${chainId}&from=${counter}&to=${encodeURIComponent(token.symbol)}`;
}

/**
 * Enriches curated RWA tokens with live market data from CoinGecko markets feed.
 *
 * @param {Array} curated
 * @param {Array} marketCoins
 * @param {string} lang
 * @returns {Array}
 */
export function enrichWithMarketPrices(curated = RWA_CURATED_TOKENS, marketCoins = [], lang = 'fa') {
  const coinMap = new Map();
  if (Array.isArray(marketCoins)) {
    for (const c of marketCoins) {
      if (c?.id) coinMap.set(c.id.toLowerCase(), c);
      if (c?.symbol) coinMap.set(c.symbol.toLowerCase(), c);
    }
  }

  return curated.map((token) => {
    const live = token.coingeckoId ? coinMap.get(token.coingeckoId.toLowerCase()) : coinMap.get(token.symbol.toLowerCase());
    const price = live?.price ?? live?.current_price ?? token.defaultPrice ?? null;
    const change24h = live?.change24h ?? live?.price_change_percentage_24h ?? null;
    const sparkline = live?.sparkline ?? live?.sparkline_in_7d?.price ?? [];
    const mcap = live?.mcap ?? live?.market_cap ?? null;

    let backing = token.backingFa;
    let description = token.descFa;
    if (lang === 'en') {
      backing = token.backingEn || token.backingFa;
      description = token.descEn || token.descFa;
    } else if (lang === 'ar') {
      backing = token.backingAr || token.backingFa;
      description = token.descAr || token.descFa;
    }

    return {
      ...token,
      price,
      change24h,
      sparkline,
      mcap,
      backing,
      description,
      platformFeePercent: feePercentString(token.feeBps || FEE_BPS)
    };
  });
}

/**
 * Fetch RWA marketplace catalog from server, with instant local fallback.
 *
 * @returns {Promise<Array>}
 */
export async function fetchRwaMarketplace() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(`${API_BASE}/rwa/marketplace`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) return RWA_CURATED_TOKENS;
    const data = await res.json();
    return Array.isArray(data?.tokens) && data.tokens.length > 0
      ? data.tokens
      : RWA_CURATED_TOKENS;
  } catch {
    return RWA_CURATED_TOKENS;
  } finally {
    clearTimeout(timer);
  }
}
