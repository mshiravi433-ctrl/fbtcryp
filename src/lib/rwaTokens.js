/**
 * RWA TOKENS — Real-World Assets & Tokenized Securities Registry.
 * ---------------------------------------------------------------------------
 * Provides verified on-chain RWA tokens (Treasuries, Gold/Commodities,
 * Robinhood Stock Tokens, Institutional Credit) with non-custodial swap routes
 * and explicit platform fee (0.70%) disclosures.
 */

import { apiBase } from './apiBase.js';
import { tickerLogo } from './coinImage.js';
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
    address: '0x96F6eF951840721AdBF46Ac996b59E0235CB985C',
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
    address: '0x284358abc07F9359f19f4b5b4aC91901Be2597Ba',
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
    address: '0xb334C5cE741B80B5B671F47F5C269Cb193fe8E24',
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
    address: '0x98E75885157C80992A8D41b696D8c9C6Fb30A926',
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
    address: '0x808507121B80c02388fAd14726482e061B8da827',
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
  },
  {
    id: 'maple',
    symbol: 'MPL',
    name: 'Maple Finance',
    category: 'credit',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x33349B282065b0284d756F0577FB39c158F935e6',
    decimals: 18,
    coingeckoId: 'maple',
    backingFa: 'تسهیلات و اعتبارات شرکتی نهادی با مدیریت هوشمند ریسک',
    backingEn: 'Institutional Corporate Credit & Overcollateralized Loans',
    backingAr: 'تسهيلات ائتمانية للشركات المؤسسية مع إدارة المخاطر',
    backingType: 'protocol_token',
    issuer: 'Maple Finance',
    standard: 'ERC-20',
    swappable: true,
    descFa: 'پروتکل اعتبار و وام‌دهی غیرمتمرکز به شرکت‌های معتبر و صندوق‌های سرمایه‌گذاری',
    descEn: 'Institutional credit marketplace for transparent on-chain lending',
    descAr: 'بروتوكول ائتمان وإقراض لا مركزي للشركات وصناديق الاستثمار',
    defaultPrice: 18.5,
    feeBps: FEE_BPS
  },
  {
    id: 'clearpool',
    symbol: 'CPOOL',
    name: 'Clearpool',
    category: 'credit',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x66761Fa41377003622aEE3c7675Fc7b5c1C2FaC5',
    decimals: 18,
    coingeckoId: 'clearpool',
    backingFa: 'اعتبارات تک‌استخری بدون وثیقه با تضمین شفافیت آنچین',
    backingEn: 'Single-borrower Uncollateralized Institutional Credit',
    backingAr: 'ائتمان مؤسسي منوع وضمانات شفافة على البلوكتشين',
    backingType: 'protocol_token',
    issuer: 'Clearpool',
    standard: 'ERC-20',
    swappable: true,
    descFa: 'بازار وام‌دهی نهادی بدون وثیقه به بازارسازان و مؤسسات دیجیتال',
    descEn: 'Decentralized capital markets ecosystem for institutional borrowers',
    descAr: 'نظام بيئي لأسواق رأس المال اللامركزية للمقترضين من المؤسسات',
    defaultPrice: 0.16,
    feeBps: FEE_BPS
  }
];

const twLogo = (address) =>
  `https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/${address}/logo.png`;

/**
 * Issuer contracts, not lookalikes.
 *
 * Several pins in the first RWA pass were the wrong contract (bad checksum,
 * or a different token that only shared a symbol prefix). Copy, the risk
 * scan and the swap all key off this address, so a wrong one is not a
 * cosmetic bug. Known ids are corrected here even when a stale marketplace
 * payload still carries the old pin.
 */
const RWA_FACTS = {
  'ondo-us-dollar-yield': {
    address: '0x96F6eF951840721AdBF46Ac996b59E0235CB985C',
    issuer: 'Ondo Finance / Ankura Trust',
    standard: 'ERC-20',
    backingType: 'direct_custody',
    logoURI: twLogo('0x96F6eF951840721AdBF46Ac996b59E0235CB985C')
  },
  'global-dollar': {
    address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    issuer: 'Paxos Trust / Global Dollar Network',
    standard: 'ERC-20',
    backingType: 'direct_custody',
    /* Robinhood's copy of USDG has no TrustWallet directory yet. The Ethereum
       issuance is the same asset and is the logo wallets actually ship. */
    logoURI: twLogo('0xe343167631d89B6Ffc58B88d6b7fB0228795491D')
  },
  'pax-gold': {
    address: '0x45804880De22913dAFE09f4980848ECE6EcbAf78',
    issuer: 'Paxos Trust Company (NYDFS)',
    standard: 'ERC-20',
    backingType: 'physical_vault',
    logoURI: twLogo('0x45804880De22913dAFE09f4980848ECE6EcbAf78')
  },
  'tether-gold': {
    address: '0x68749665FF8D2d112Fa859AA293F07A622782F38',
    issuer: 'TG Commodities Limited',
    standard: 'ERC-20',
    backingType: 'physical_vault',
    logoURI: twLogo('0x68749665FF8D2d112Fa859AA293F07A622782F38')
  },
  'ondo-finance': {
    address: '0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3',
    issuer: 'Ondo Finance',
    standard: 'ERC-20',
    backingType: 'protocol_token',
    logoURI: twLogo('0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3')
  },
  'rigetti-computing': {
    address: '0x284358abc07F9359f19f4b5b4aC91901Be2597Ba',
    issuer: 'Robinhood Markets',
    standard: 'ERC-20',
    backingType: 'stock_token',
    referenceTicker: 'RGTI',
    logoURI: tickerLogo('RGTI')
  },
  'joby-aviation': {
    address: '0xb334C5cE741B80B5B671F47F5C269Cb193fe8E24',
    issuer: 'Robinhood Markets',
    standard: 'ERC-20',
    backingType: 'stock_token',
    referenceTicker: 'JOBY',
    logoURI: tickerLogo('JOBY')
  },
  'sofi-technologies': {
    address: '0x98E75885157C80992A8D41b696D8c9C6Fb30A926',
    issuer: 'Robinhood Markets',
    standard: 'ERC-20',
    backingType: 'stock_token',
    referenceTicker: 'SOFI',
    logoURI: tickerLogo('SOFI')
  },
  maker: {
    address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2',
    issuer: 'MakerDAO / Sky',
    standard: 'ERC-20',
    backingType: 'protocol_token',
    logoURI: twLogo('0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2')
  },
  centrifuge: {
    address: '0xcccCCCcCCC33D538DBC2EE4fEab0a7A1FF4e8A94',
    issuer: 'Centrifuge',
    standard: 'ERC-20',
    backingType: 'protocol_token',
    logoURI: twLogo('0xcccCCCcCCC33D538DBC2EE4fEab0a7A1FF4e8A94')
  },
  pendle: {
    address: '0x808507121B80c02388fAd14726482e061B8da827',
    issuer: 'Pendle Finance',
    standard: 'ERC-20',
    backingType: 'protocol_token',
    logoURI: twLogo('0x808507121B80c02388fAd14726482e061B8da827')
  },
  maple: {
    address: '0x33349B282065b0284d756F0577FB39c158F935e6',
    issuer: 'Maple Finance',
    standard: 'ERC-20',
    backingType: 'protocol_token',
    logoURI: twLogo('0x33349B282065b0284d756F0577FB39c158F935e6')
  },
  clearpool: {
    address: '0x66761Fa41377003622aEE3c7675Fc7b5c1C2FaC5',
    issuer: 'Clearpool',
    standard: 'ERC-20',
    backingType: 'protocol_token',
    logoURI: twLogo('0x66761Fa41377003622aEE3c7675Fc7b5c1C2FaC5')
  }
};

function httpsUrl(value) {
  const raw = String(value ?? '').trim();
  return raw.startsWith('https://') ? raw : null;
}

/**
 * One presentation record: corrected contract, issuer facts, and a logo that
 * belongs to THAT contract (or the underlying equity ticker), never a
 * symbol-keyed guess that a clone can borrow.
 */
export function canonicalizeRwa(token) {
  if (!token || typeof token !== 'object') return token;
  const facts = RWA_FACTS[token.id] || {};
  const referenceTicker = facts.referenceTicker || token.referenceTicker || null;
  const logoURI =
    httpsUrl(token.image) ||
    httpsUrl(token.logoURI) ||
    facts.logoURI ||
    (referenceTicker ? tickerLogo(referenceTicker) : null);
  return {
    ...token,
    address: facts.address || token.address,
    issuer: facts.issuer || token.issuer || null,
    standard: facts.standard || token.standard || 'ERC-20',
    backingType: facts.backingType || token.backingType || (
      token.category === 'robinhood' ? 'stock_token'
        : token.category === 'commodity' ? 'physical_vault'
          : token.category === 'treasury' ? 'direct_custody'
            : token.category === 'credit' ? 'protocol_token'
              : null
    ),
    referenceTicker,
    logoURI
  };
}

/** Counter-asset the swap opens on. Same rule as getRwaSwapUrl. */
export function rwaCounterSymbol(token) {
  if (!token) return 'USDT';
  if (token.chainId === 'solana') return 'USDC';
  if (Number(token.chainId) === 4663) return token.symbol === 'USDG' ? 'ETH' : 'USDG';
  return token.symbol === 'USDT' ? 'ETH' : 'USDT';
}

const RISK_RANK = { low: 1, caution: 2, medium: 3, high: 4, critical: 5 };

/**
 * Structural risk of an RWA — issuer, custody, freeze — not a price call and
 * not a fake honeypot score. Used when the on-chain scanner has no coverage
 * (Robinhood Chain) and shown beside a real scan when one exists, because a
 * clean ERC-20 report does not cancel a freeze authority.
 */
export function assessRwaRisk(token) {
  const item = canonicalizeRwa(token);
  if (!item) return null;
  const flags = [];
  const push = (id, severity) => flags.push({ id, severity, values: {} });
  const type = item.backingType;

  if (type === 'stock_token') {
    push('notAShare', 'high');
    push('issuerFreeze', 'high');
  } else if (type === 'physical_vault') {
    push('issuerFreeze', 'high');
    push('custodian', 'medium');
  } else if (type === 'direct_custody') {
    push('custodian', 'medium');
    push('issuerFreeze', 'medium');
  } else {
    push('governanceNotAsset', 'medium');
  }

  /* Scanner coverage is stated by the panel, not as a second copy of the
     same sentence. Permissionless transfer is a fact of the Ethereum pins. */
  if (Number(item.chainId) !== 4663) push('permissionless', 'low');

  const worst = flags.reduce((max, flag) => Math.max(max, RISK_RANK[flag.severity] || 1), 1);
  const level = worst >= 4 ? 'high' : worst >= 3 ? 'medium' : 'low';
  return { backingType: type, flags, level, structural: true };
}

/**
 * Build the exact swap URL for an RWA token with counter-token pre-filled.
 * Evaluates network context and ensures the 0.70% platform fee applies.
 *
 * @param {object} token
 * @param {number|string|null} amount
 * @returns {string}
 */
export function getRwaSwapUrl(token, amount = null) {
  const item = canonicalizeRwa(token);
  if (!item) return '/swap';

  const amtParam = amount && Number(amount) > 0 ? `&amount=${encodeURIComponent(amount)}` : '';
  const chainId = item.chainId || 1;
  const counter = rwaCounterSymbol(item);
  const addrParam = item.address ? `&toAddress=${encodeURIComponent(item.address)}` : '';
  const symbol = encodeURIComponent(item.symbol || '');

  if (chainId === 'solana') {
    return `/solana?to=${symbol}${amtParam}`;
  }

  return `/swap?chain=${chainId}&from=${counter}&to=${symbol}${addrParam}${amtParam}`;
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

  return curated.map((raw) => {
    const token = canonicalizeRwa(raw);
    const live = token.coingeckoId
      ? coinMap.get(String(token.coingeckoId).toLowerCase())
      : coinMap.get(String(token.symbol || '').toLowerCase());
    const price = live?.price ?? live?.current_price ?? token.defaultPrice ?? null;
    const change24h = live?.change24h ?? live?.price_change_percentage_24h ?? null;
    const sparkline = live?.sparkline ?? live?.sparkline_in_7d?.price ?? [];
    const mcap = live?.mcap ?? live?.market_cap ?? null;
    const liveLogo = httpsUrl(live?.image);

    const langCode = String(lang || 'fa').slice(0, 2);
    let backing = token.backingFa;
    let description = token.descFa;
    if (langCode === 'ar') {
      backing = token.backingAr || token.backingEn || token.backingFa;
      description = token.descAr || token.descEn || token.descFa;
    } else if (langCode !== 'fa') {
      /* English copy for every other locale. Falling through to Persian
         while the chrome is English was the mixed-language spec box. */
      backing = token.backingEn || token.backingFa;
      description = token.descEn || token.descFa;
    }

    return {
      ...token,
      /* A live CoinGecko image beats the static pin, but only when it is a
         real https URL. A missing feed must not wipe the contract logo. */
      logoURI: liveLogo || token.logoURI,
      image: liveLogo || token.image || null,
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
