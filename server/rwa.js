import express from 'express';

const RWA_TOKENS = [
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
    backingType: 'direct_custody',
    issuer: 'Ondo Finance / Ankura Trust',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
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
    backingType: 'direct_custody',
    issuer: 'Paxos Trust / Global Dollar Network',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
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
    backingType: 'physical_vault',
    issuer: 'Paxos Trust Company (NYDFS)',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
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
    backingType: 'physical_vault',
    issuer: 'TG Commodities Limited',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
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
    backingType: 'protocol_token',
    issuer: 'Ondo Finance',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
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
    backingType: 'stock_token',
    issuer: 'Robinhood Markets',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
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
    backingType: 'stock_token',
    issuer: 'Robinhood Markets',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
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
    backingType: 'stock_token',
    issuer: 'Robinhood Markets',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
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
    backingType: 'protocol_token',
    issuer: 'MakerDAO / Sky',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
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
    backingFa: 'وام‌های تجاری، مطالبات و دارایی‌های امانی دنیای واقعی',
    backingEn: 'Trade Invoices & Structured Real-World Credit',
    backingType: 'protocol_token',
    issuer: 'Centrifuge',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
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
    backingType: 'protocol_token',
    issuer: 'Pendle Finance',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
  },
  {
    id: 'maple',
    symbol: 'MPL',
    name: 'Maple Finance',
    category: 'credit',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x333420442673A51c8809ca3443e0618ff7eD4d24',
    decimals: 18,
    coingeckoId: 'maple',
    backingFa: 'تسهیلات و اعتبارات شرکتی نهادی با مدیریت هوشمند ریسک',
    backingEn: 'Institutional Corporate Credit & Overcollateralized Loans',
    backingType: 'protocol_token',
    issuer: 'Maple Finance',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
  },
  {
    id: 'clearpool',
    symbol: 'CPOOL',
    name: 'Clearpool',
    category: 'credit',
    chainId: 1,
    chainName: 'Ethereum',
    address: '0x66761fa41377005662a03370c73b01a0e9657036',
    decimals: 18,
    coingeckoId: 'clearpool',
    backingFa: 'اعتبارات تک‌استخری بدون وثیقه با تضمین شفافیت آنچین',
    backingEn: 'Single-borrower Uncollateralized Institutional Credit',
    backingType: 'protocol_token',
    issuer: 'Clearpool',
    standard: 'ERC-20',
    swappable: true,
    feeBps: 70
  }
];

export function rwaRouter() {
  const router = express.Router();

  router.get('/marketplace', (req, res) => {
    res.json({
      ok: true,
      status: 'AVAILABLE',
      policy: 'NON_CUSTODIAL',
      platformFeeBps: 70,
      platformFeePercent: '0.7',
      totalTokens: RWA_TOKENS.length,
      categories: ['treasury', 'commodity', 'robinhood', 'credit'],
      tokens: RWA_TOKENS
    });
  });

  router.get('/tokens', (req, res) => {
    const { category } = req.query;
    const filtered = category && category !== 'all'
      ? RWA_TOKENS.filter((t) => t.category === category)
      : RWA_TOKENS;
    res.json({
      ok: true,
      count: filtered.length,
      platformFeeBps: 70,
      tokens: filtered
    });
  });

  router.get('/standards', (req, res) => {
    res.json({
      ok: true,
      standards: [
        { code: 'ERC-20', name: 'Standard Fungible Token', use: 'PAXG, XAUt, ONDO, Robinhood Stock Tokens' },
        { code: 'ERC-4626', name: 'Tokenized Vault Standard', use: 'Yield-bearing Treasury Vaults (USDY, sDAI)' },
        { code: 'ERC-3643', name: 'T-REX Permissioned Identity Token', use: 'Regulated Institutional Securities' }
      ],
      oracleProtection: {
        staleCheckTimeoutHours: 3,
        status: 'ENFORCED',
        description: 'OracleLib heartbeat staleness check ensures fair pricing and liquidation bounds.'
      }
    });
  });

  router.post('/tokenize', (req, res) => {
    res.json({
      ok: true,
      status: 'INFO_ONLY',
      architecture: 'NON_CUSTODIAL_FACTORY',
      message: 'FBT Swap deploys basic permissionless tokens via FBTTokenFactory.sol. Regulated RWA tokenization requires legal SPV structures and licensed custodian wrappers.',
      referenceGuide: 'https://github.com/Quillhash/Real-World-Assets-RWA'
    });
  });

  return router;
}
