/**
 * Intent OS → real FBT pages.
 * Chat never reimplements Swap / Farm / Lending / Bridge. It classifies,
 * then opens the live module with query params the page already honours.
 */

export const MODULE_ROUTER_SCHEMA = 'fbt.module-router.v1';

export const TOKEN_ALIASES = Object.freeze({
  tether: 'USDT',
  تتر: 'USDT',
  'تتر usdt': 'USDT',
  ethereum: 'ETH',
  اتریوم: 'ETH',
  اتر: 'ETH',
  bitcoin: 'BTC',
  بیتکوین: 'BTC',
  'بیت کوین': 'BTC',
  'بیت‌کوین': 'BTC',
  'بیت کویین': 'BTC',
  بیتکویین: 'BTC',
  solana: 'SOL',
  سولانا: 'SOL',
  binance: 'BNB',
  بایننس: 'BNB',
  'بایننس کوین': 'BNB'
});

export const CHAIN_ALIASES = Object.freeze({
  ethereum: 1,
  eth: 1,
  اتریوم: 1,
  optimism: 10,
  آپتیمیزم: 10,
  اپتیمیزم: 10,
  bsc: 56,
  bnb: 56,
  binance: 56,
  بایننس: 56,
  polygon: 137,
  matic: 137,
  پالیگان: 137,
  sonic: 146,
  base: 8453,
  بیس: 8453,
  arbitrum: 42161,
  آربیتروم: 42161,
  اربیتروم: 42161,
  avalanche: 43114,
  اولانچ: 43114,
  آوالانچ: 43114,
  linea: 59144,
  solana: 501,
  سولانا: 501
});

export const PAGE_CATALOG = Object.freeze([
  { route: '/market', names: { fa: 'بازار', en: 'Market' }, keywords: ['بازار', 'market'] },
  { route: '/swap', names: { fa: 'سواپ', en: 'Swap' }, keywords: ['سواپ', 'swap', 'تبدیل'] },
  { route: '/solana', names: { fa: 'سواپ سولانا', en: 'Solana Swap' }, keywords: ['سواپ سولانا', 'solana swap'] },
  { route: '/bridge', names: { fa: 'بریج', en: 'Bridge' }, keywords: ['بریج', 'پل', 'bridge'] },
  { route: '/farm', names: { fa: 'فارم', en: 'Farm' }, keywords: ['فارم', 'farm', 'استخر'] },
  { route: '/loan', names: { fa: 'وام', en: 'Lending' }, keywords: ['وام', 'لندینگ', 'lending', 'borrow'] },
  { route: '/earn', names: { fa: 'سود', en: 'Earn' }, keywords: ['سود', 'earn', 'yield'] },
  { route: '/wallet', names: { fa: 'کیف پول', en: 'Wallet' }, keywords: ['کیف پول', 'والت', 'wallet'] },
  { route: '/portfolio', names: { fa: 'پرتفوی', en: 'Portfolio' }, keywords: ['پرتفوی', 'سبد', 'portfolio'] },
  { route: '/signals', names: { fa: 'سیگنال', en: 'Signals' }, keywords: ['سیگنال', 'signals'] },
  { route: '/smart-money', names: { fa: 'اسمارت مانی', en: 'Smart Money' }, keywords: ['smart money', 'اسمارت', 'نهنگ', 'کیف پول بزرگ'] },
  { route: '/stocks', names: { fa: 'سهام', en: 'Stocks' }, keywords: ['سهام', 'stocks', 'شرکتی', 'افق جهانی', 'فارکس', 'forex', 'جفت ارز', 'طلا', 'نفت', 'کالا', 'فلزات', 'gold', 'metals', 'commodities'] },
  { route: '/invest', names: { fa: 'سرمایه‌گذاری', en: 'Invest' }, keywords: ['سرمایه‌گذاری مجازی', 'پول مجازی', 'virtual invest', 'nx invest'] },
  { route: '/perp', names: { fa: 'فیوچرز', en: 'Perpetuals' }, keywords: ['فیوچرز', 'پرپچوال', 'perp', 'futures'] },
  { route: '/dydx', names: { fa: 'dYdX', en: 'dYdX' }, keywords: ['dydx', 'دی وای دی ایکس'] },
  { route: '/ostium', names: { fa: 'Ostium', en: 'Ostium' }, keywords: ['ostium', 'اوسشیوم'] },
  { route: '/p2p', names: { fa: 'P2P', en: 'P2P' }, keywords: ['p2p', 'پی تو پی', 'همتا'] },
  { route: '/orders', names: { fa: 'سفارش خودکار', en: 'Orders' }, keywords: ['سفارش', 'سفارش خودکار', 'orders', 'dca'] },
  { route: '/buy', names: { fa: 'خرید و فروش', en: 'Buy / Sell' }, keywords: ['خرید با کارت', 'فیات', 'onramp'] },
  { route: '/settings', names: { fa: 'تنظیمات', en: 'Settings' }, keywords: ['تنظیمات', 'settings', 'نوتیفیکیشن', 'اعلان'] },
  { route: '/rewards', names: { fa: 'امتیازها', en: 'Rewards' }, keywords: ['امتیاز', 'rewards', 'پاداش'] },
  { route: '/intent', names: { fa: 'Intent OS', en: 'Intent OS' }, keywords: ['اینتنت', 'intent os', 'تب'] },
  { route: '/news', names: { fa: 'اخبار', en: 'News' }, keywords: ['اخبار', 'news'] },
  { route: '/nft', names: { fa: 'NFT', en: 'NFT' }, keywords: ['nft', 'ان اف تی'] },
  { route: '/shop', names: { fa: 'فروشگاه', en: 'Shop' }, keywords: ['فروشگاه', 'shop'] },
  { route: '/explore', names: { fa: 'کاوش', en: 'Explore' }, keywords: ['کاوش', 'explore'] }
]);

export function aliasToken(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (TOKEN_ALIASES[s]) return TOKEN_ALIASES[s];
  const compact = s.replace(/[\s‌]+/g, '');
  if (TOKEN_ALIASES[compact]) return TOKEN_ALIASES[compact];
  const up = String(raw).toUpperCase();
  if (/^[A-Z0-9]{2,10}$/.test(up)) return up;
  return null;
}

export function aliasChainId(raw) {
  if (raw == null || raw === '') return null;
  if (Number.isFinite(Number(raw)) && CHAIN_ALIASES[String(raw)] == null) {
    const n = Number(raw);
    if (n > 0) return n;
  }
  const s = String(raw).trim().toLowerCase();
  return CHAIN_ALIASES[s] ?? CHAIN_ALIASES[s.replace(/[\s‌]+/g, '')] ?? null;
}

export function pageName(route, locale = 'fa') {
  const row = PAGE_CATALOG.find((p) => p.route === String(route || '').split('?')[0]);
  if (!row) return route;
  return locale.startsWith('en') ? row.names.en : row.names.fa;
}

function q(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export function isSolanaIntent(intent = {}) {
  const e = intent.entities || {};
  const chains = e.chains || [];
  const ids = e.chainIds || [];
  if (ids.includes(501) || chains.some((c) => String(c).toLowerCase().includes('sol'))) return true;
  if (e.network === 'solana' || e.toNetwork === 'solana') return true;
  const raw = String(intent.raw || '');
  return /solana|سولانا/i.test(raw);
}

export function routeForIntent(intent = {}, { openPage = false } = {}) {
  const type = String(intent.type || '').toUpperCase();
  const e = intent.entities || {};
  const nav = intent.navigation?.route;
  if (openPage && nav) return nav;

  const from = e.fromToken || (type === 'SELL' ? e.token : null) || (type === 'SWAP' ? e.token : null);
  const to = e.toToken || (type === 'BUY' ? e.token : null);
  const amount = e.amount || e.amountUsd || null;
  const token = e.token || from || to;
  const fromChain = aliasChainId(e.fromChain || e.network || e.chains?.[0]);
  const toChain = aliasChainId(e.toChain || e.destinationNetwork || e.chains?.[1]);

  switch (type) {
    case 'NAVIGATION':
      // A bare “open it” is not news. Only land on /news when the user named it.
      return nav || null;
    case 'NEWS_SEARCH':
      return nav || '/news';
    case 'SWAP':
    case 'BUY':
    case 'SELL':
      if (isSolanaIntent(intent)) return `/solana${q({ to: to || token, amount })}`;
      return `/swap${q({ from: from || 'USDT', to: to || 'ETH', amount, chain: fromChain })}`;
    case 'BRIDGE':
      return `/bridge${q({ token: token || 'USDT', amount, fromChain, toChain, toAddress: e.toAddress })}`;
    case 'SEND':
      return `/swap${q({ from: token || from || 'USDT', amount, toAddress: e.toAddress, chain: fromChain })}`;
    case 'FARM':
      return '/farm';
    case 'LEND':
    case 'STAKING':
      return `/loan${q({ tab: 'supply', asset: token, amount, chain: fromChain })}`;
    case 'BORROW':
      return `/loan${q({ tab: 'borrow', asset: token, amount, chain: fromChain })}`;
    case 'YIELD_DISCOVERY':
    case 'INVESTMENT_PLAN':
    case 'GOAL':
    case 'GOAL_PLANNING':
    case 'PROFIT_PLAN': {
      // Real products only: /stocks (افق جهانی / forex / gold / metals), /perp.
      // /invest is simulated NX — never the default for افق جهانی.
      const raw = String(intent.raw || intent.message || '').toLowerCase();
      const e = intent.entities || {};
      const risk = String(e.riskPreference || e.riskTolerance || '').toLowerCase();
      const tokens = (e.tokens || []).map((t) => String(t).toLowerCase());
      const hasVirtual = /پول مجازی|سرمایه‌گذاری مجازی|virtual (money|invest)|nx invest/i.test(raw);
      const hasStocks = tokens.some((t) => ['stock', 'stocks', 'xstock', 'rwa'].includes(t))
        || /سهام|بورس|xstock|stocks|equities|tokenized|rwa|دارایی واقعی|توکن شده|افق جهانی|فارکس|forex|طلا|نفت|کالا|فلزات|gold|metals/i.test(raw);
      const hasHighRisk = risk === 'high' || risk === 'aggressive'
        || /اهرم|لوریج|leverage|فیوچرز|پرپچوال|perp|futures|زلا|سود میبره|سود می‌بره/i.test(raw)
        || /high.*risk|پرریسک|ریسک.*زیاد|تهاجمی/i.test(raw);
      if (hasVirtual) return '/invest';
      if (hasStocks) return '/stocks';
      if (hasHighRisk) return '/perp';
      return '/stocks';
    }
    case 'SIGNALS':
    case 'ANALYZE_TOKEN':
      return e.token ? `/signals` : '/signals';
    case 'STOCKS':
    case 'RWA':
      return '/stocks';
    case 'HORIZON':
    case 'FOREX':
      return '/stocks';
    case 'FUTURES':
      return '/perp';
    case 'DYDX':
      return '/dydx';
    case 'P2P':
      return '/p2p';
    case 'ORDERS':
    case 'DCA':
      return '/orders';
    case 'SMART_MONEY':
    case 'WHALE':
      return '/smart-money';
    case 'BTC_WALLET':
      return '/wallet?tab=real';
    case 'ADD_TOKEN':
      return isSolanaIntent(intent) ? '/solana' : '/swap';
    case 'NOTIFICATIONS':
    case 'SETTINGS':
      return '/settings';
    case 'REWARDS':
      return '/rewards';
    case 'WALLET_CONNECT':
    case 'WALLET_DISCONNECT':
    case 'WALLET_BALANCE':
    case 'SWITCH_NETWORK':
      return '/wallet';
    case 'PORTFOLIO_ANALYSIS':
      return openPage ? '/portfolio' : null;
    case 'MARKET_ANALYSIS':
      return openPage ? '/market' : null;
    case 'INTENT_OS':
      return e.tab ? `/intent?tab=${encodeURIComponent(e.tab)}` : '/intent';
    /*
     * The Operations Center, the agent registry and the strategy registry all
     * live inside the Intent surface as tabs. They are reachable by name now
     * ("مرکز عملیات", "ایجنت‌ها", "استراتژی") instead of falling through to a
     * null route and a "couldn't map that" reply.
     */
    case 'OPS_CENTER':
      return '/intent?tab=ops';
    case 'AGENTS':
      return '/intent?tab=agents';
    case 'STRATEGY':
      return '/intent?tab=strategies';
    case 'SYSTEM_STATUS':
      return '/intent?tab=status';
    case 'SECURITY':
      return '/security';
    case 'NFT':
      return '/nft';
    case 'SHOP':
      return '/shop';
    case 'EXPLORE':
      return '/explore';
    case 'LEARN':
      return '/learn';
    case 'DOCS':
      return '/docs';
    case 'LEADERBOARD':
      return '/leaderboard';
    case 'VAULT':
      return '/vault';
    /* "what can you do" is answered in the chat, never by opening a page. */
    case 'CAPABILITIES':
      return null;
    default:
      return nav || null;
  }
}

export function wantsPageOpen(text) {
  return /(باز کن|بازکن|ببر به|من را ببر|مرا ببر|صفحه|برو به|open|go to|navigate|take me)/i.test(String(text || ''));
}
