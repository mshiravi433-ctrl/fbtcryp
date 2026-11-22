/**
 * FBT AGENT HUB — BYO-KEY BRIDGES for third-party providers.
 * ---------------------------------------------------------------------------
 * A directory card that only opens the vendor's website is not an agent, it is
 * a bookmark. This file is the other half: for the providers whose public API
 * genuinely accepts a key a user can paste, it declares — in ONE place, on the
 * server — how that key is used.
 *
 * Every field here is a CONSTANT. Nothing in this table is ever taken from a
 * request body:
 *
 *   baseUrl   the only host a pasted key can ever be sent to (no SSRF)
 *   auth      the header (or query parameter) the vendor documents
 *   probe     the cheapest authenticated read that proves the key is valid
 *   chat      the completion endpoint, for providers that can answer questions
 *   models    how to read the vendor's own model list, so we never rely on a
 *             pin that goes stale (see the WORKERSAI_MODEL shadowing incident)
 *
 * `domainUse` is not marketing copy: it is the sentence the UI shows to explain
 * what OUR assistant will do with the key. All of it is crypto / DeFi / trading:
 * the bridge answers through a system prompt fixed on the server, so a connected
 * seat is a domain analyst, not a general chatbot bolted onto a trading app.
 */

/** Providers whose HTTP shape is the OpenAI chat-completions contract. */
const OPENAI_LIKE = Object.freeze({
  probe: '/models',
  chat: '/chat/completions',
  modelsFrom: (json) => (Array.isArray(json?.data) ? json.data.map((m) => String(m?.id || '')).filter(Boolean) : []),
  answerFrom: (json) => String(json?.choices?.[0]?.message?.content || '').trim()
});

const BRIDGES = [
  {
    id: 'openai',
    name: 'OpenAI',
    vendor: 'OpenAI',
    kind: 'ai',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    auth: { header: 'authorization', scheme: 'bearer' },
    modelPreference: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'],
    defaultModel: 'gpt-4o-mini',
    siteUrl: 'https://openai.com',
    docsUrl: 'https://platform.openai.com/docs',
    keyUrl: 'https://platform.openai.com/api-keys',
    domainUse: {
      fa: 'پرسش‌های تحلیلی بازار، ریسک پورتفوی و مقایسهٔ سناریوها را با زمینهٔ دادهٔ FBT از این مدل می‌پرسیم.',
      en: 'Market-structure questions, portfolio risk and scenario comparisons are asked of this model with FBT context.'
    }
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    vendor: 'Anthropic',
    kind: 'ai',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    auth: { header: 'x-api-key', scheme: 'raw', extraHeaders: { 'anthropic-version': '2023-06-01' } },
    modelPreference: ['claude-3-5-haiku', 'claude-3-5-sonnet', 'claude-3-haiku'],
    defaultModel: 'claude-3-5-haiku-latest',
    siteUrl: 'https://www.anthropic.com',
    docsUrl: 'https://docs.anthropic.com',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    domainUse: {
      fa: 'برای بازخوانی دقیق قراردادها، ریسک پوزیشن و توضیح استراتژی روی دادهٔ بازار استفاده می‌شود.',
      en: 'Used to reason over contracts, position risk and strategy explanations on market data.'
    }
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    vendor: 'Google',
    kind: 'ai',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    auth: { query: 'key' },
    modelPreference: ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    defaultModel: 'gemini-2.0-flash',
    siteUrl: 'https://ai.google.dev',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    domainUse: {
      fa: 'خواندن سریع دادهٔ آن‌چین و پاسخ به پرسش‌های کوتاه معاملاتی با سهمیهٔ رایگان گوگل.',
      en: 'Fast on-chain reads and short trading questions on Google’s free tier.'
    }
  },
  {
    id: 'kilo',
    name: 'Kilo AI Gateway',
    vendor: 'Kilo',
    kind: 'ai',
    protocol: 'openai',
    baseUrl: 'https://ai-gateway.kilo.ai/api/v1',
    auth: { header: 'authorization', scheme: 'bearer' },
    modelPreference: ['kilo-auto/efficient', 'kilo-auto/frontier', 'deepseek-v4.1-flash', 'glm-5.3-flash', 'kilo-auto/free'],
    defaultModel: 'kilo-auto/efficient',
    siteUrl: 'https://kilo.ai',
    docsUrl: 'https://kilo.ai/docs/gateway/quickstart',
    keyUrl: 'https://app.kilo.ai',
    domainUse: {
      fa: 'درگاه یکپارچهٔ ۵۰۰+ مدل بدون کارمزد اضافه (Zero-Markup) برای استدلال عمیق، ارکستریشن چندمدلی و تحلیل ریسک و بازار.',
      en: 'Zero-markup universal gateway across 500+ models for deep reasoning, multi-model orchestration, and market/risk analysis.'
    }
  },
  {
    id: 'groq',
    name: 'Groq',
    vendor: 'Groq',
    kind: 'ai',
    protocol: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    auth: { header: 'authorization', scheme: 'bearer' },
    modelPreference: ['llama-3.3-70b', 'llama-3.1-8b', 'qwen'],
    defaultModel: 'llama-3.3-70b-versatile',
    siteUrl: 'https://groq.com',
    docsUrl: 'https://console.groq.com/docs',
    keyUrl: 'https://console.groq.com/keys',
    domainUse: {
      fa: 'پاسخ‌های پرسرعت برای پرسش‌های لحظه‌ای بازار؛ مناسب کوئری‌های تکراری و ارزان.',
      en: 'Low-latency answers for live market questions; good for cheap repeated queries.'
    }
  },
  {
    id: 'mistral',
    name: 'Mistral',
    vendor: 'Mistral AI',
    kind: 'ai',
    protocol: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    auth: { header: 'authorization', scheme: 'bearer' },
    modelPreference: ['mistral-small', 'mistral-large', 'open-mistral'],
    defaultModel: 'mistral-small-latest',
    siteUrl: 'https://mistral.ai',
    docsUrl: 'https://docs.mistral.ai',
    keyUrl: 'https://console.mistral.ai/api-keys',
    domainUse: {
      fa: 'خلاصه‌سازی گزارش‌های بازار و استخراج عدد از متن‌های مالی اروپایی.',
      en: 'Summarising market reports and extracting figures from financial text.'
    }
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    vendor: 'DeepSeek',
    kind: 'ai',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    auth: { header: 'authorization', scheme: 'bearer' },
    modelPreference: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    siteUrl: 'https://www.deepseek.com',
    docsUrl: 'https://api-docs.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    domainUse: {
      fa: 'استدلال گام‌به‌گام روی سناریوهای بازار و ریاضیات پورتفوی با هزینهٔ پایین.',
      en: 'Step-by-step reasoning over market scenarios and portfolio maths at low cost.'
    }
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    vendor: 'OpenRouter',
    kind: 'ai',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: { header: 'authorization', scheme: 'bearer' },
    modelPreference: [':free', 'gpt-4o-mini', 'llama-3.3-70b'],
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    siteUrl: 'https://openrouter.ai',
    docsUrl: 'https://openrouter.ai/docs',
    keyUrl: 'https://openrouter.ai/keys',
    domainUse: {
      fa: 'یک صندلی اضافی برای مدل‌های متن‌باز؛ با مدل‌های :free هزینه‌ای روی کلید شما نمی‌نشیند.',
      en: 'An extra seat for open models; with :free models nothing is billed to your key.'
    }
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    vendor: 'xAI',
    kind: 'ai',
    protocol: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    auth: { header: 'authorization', scheme: 'bearer' },
    modelPreference: ['grok-2', 'grok-beta'],
    defaultModel: 'grok-2-latest',
    siteUrl: 'https://x.ai',
    docsUrl: 'https://docs.x.ai',
    keyUrl: 'https://console.x.ai',
    domainUse: {
      fa: 'خواندن سریع اخبار و احساسات بازار برای پرسش‌های کوتاه‌مدت.',
      en: 'Fast news and sentiment reads for short-horizon market questions.'
    }
  },

  /* ── data bridges ────────────────────────────────────────────────────────
     Domain vendors whose key our own server already knows how to use. A data
     bridge has no chat endpoint: the connection is proven by one authenticated
     read, and the value it returns is shown to the user as the proof. */
  {
    id: 'coingecko',
    name: 'CoinGecko',
    vendor: 'CoinGecko',
    kind: 'data',
    variants: [
      { baseUrl: 'https://pro-api.coingecko.com/api/v3', auth: { header: 'x-cg-pro-api-key', scheme: 'raw' } },
      { baseUrl: 'https://api.coingecko.com/api/v3', auth: { header: 'x-cg-demo-api-key', scheme: 'raw' } }
    ],
    baseUrl: 'https://pro-api.coingecko.com/api/v3',
    auth: { header: 'x-cg-pro-api-key', scheme: 'raw' },
    probePath: '/ping',
    check: (json) => (String(json?.gecko_says || '').length > 0 ? { ok: true } : { ok: false, detail: 'unexpected /ping payload' }),
    proofLabel: { fa: 'پاسخ زندهٔ CoinGecko', en: 'Live CoinGecko reply' },
    siteUrl: 'https://www.coingecko.com',
    docsUrl: 'https://docs.coingecko.com',
    keyUrl: 'https://www.coingecko.com/en/developers/dashboard',
    domainUse: {
      fa: 'قیمت و عمق بازار همان جفت‌ارزهایی که در FBT می‌بینید، از کلید خودتان و با سهمیهٔ خودتان خوانده می‌شود.',
      en: 'Prices and market depth for the pairs on FBT are read on your key and your quota.'
    }
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    vendor: 'Cerebras',
    kind: 'ai',
    protocol: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    auth: { header: 'authorization', scheme: 'bearer' },
    modelPreference: ['llama-3.3-70b', 'llama3.1-8b', 'qwen'],
    defaultModel: 'llama-3.3-70b',
    siteUrl: 'https://cerebras.ai',
    docsUrl: 'https://inference-docs.cerebras.ai',
    keyUrl: 'https://cloud.cerebras.ai',
    domainUse: {
      fa: 'سهمیهٔ رایگان روزانهٔ بالا برای پرسش‌های تکراری بازار؛ ارزان‌ترین راه برای پرسیدن مداوم از یک مدل بزرگ.',
      en: 'A large free daily allowance for repeated market questions; the cheapest way to keep asking a big model.'
    }
  },
  {
    id: 'together',
    name: 'Together AI',
    vendor: 'Together AI',
    kind: 'ai',
    protocol: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    auth: { header: 'authorization', scheme: 'bearer' },
    modelPreference: ['Llama-3.3-70B', 'Qwen', 'Mixtral'],
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    siteUrl: 'https://www.together.ai',
    docsUrl: 'https://docs.together.ai',
    keyUrl: 'https://api.together.ai/settings/api-keys',
    domainUse: {
      fa: 'مدل‌های متن‌باز برای تحلیل ساختار بازار؛ اگر از قبل اعتبار دارید، بدون هزینهٔ اضافه استفاده می‌شود.',
      en: 'Open models for market-structure analysis; uses credit you already hold.'
    }
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    vendor: 'Fireworks AI',
    kind: 'ai',
    protocol: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    auth: { header: 'authorization', scheme: 'bearer' },
    modelPreference: ['llama-v3p3-70b', 'qwen', 'deepseek'],
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    siteUrl: 'https://fireworks.ai',
    docsUrl: 'https://docs.fireworks.ai',
    keyUrl: 'https://fireworks.ai/account/api-keys',
    domainUse: {
      fa: 'استنتاج سریع مدل‌های متن‌باز برای پرسش‌های زندهٔ بازار.',
      en: 'Fast open-model inference for live market questions.'
    }
  },
  {
    id: 'sambanova',
    name: 'SambaNova',
    vendor: 'SambaNova',
    kind: 'ai',
    protocol: 'openai',
    baseUrl: 'https://api.sambanova.ai/v1',
    auth: { header: 'authorization', scheme: 'bearer' },
    modelPreference: ['DeepSeek', 'Llama-3.3', 'Meta-Llama-3.1'],
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
    siteUrl: 'https://sambanova.ai',
    docsUrl: 'https://docs.sambanova.ai',
    keyUrl: 'https://cloud.sambanova.ai/apis',
    domainUse: {
      fa: 'پاسخ سریع برای پرسش‌های تحلیلی؛ مناسب زمانی که سهمیهٔ صندلی‌های دیگر تمام شده.',
      en: 'Fast analytical answers; useful when the other seats are out of quota.'
    }
  },
  {
    id: 'etherscan',
    name: 'Etherscan',
    vendor: 'Etherscan',
    kind: 'data',
    baseUrl: 'https://api.etherscan.io/v2',
    auth: { query: 'apikey' },
    probePath: '/api?chainid=1&module=stats&action=ethsupply',
    check: (json) =>
      json?.status === '1' && String(json?.result || '').length > 0
        ? { ok: true }
        : { ok: false, detail: String(json?.result || json?.message || 'invalid api key') },
    proofLabel: { fa: 'عرضهٔ زندهٔ ETH از Etherscan', en: 'Live ETH supply from Etherscan' },
    siteUrl: 'https://etherscan.io',
    docsUrl: 'https://docs.etherscan.io',
    keyUrl: 'https://etherscan.io/myapikey',
    domainUse: {
      fa: 'خواندن تراکنش‌ها، موجودی و رویدادهای قرارداد روی زنجیره با کلید خودتان، برای همان تحلیل‌هایی که FBT انجام می‌دهد.',
      en: 'Transaction, balance and contract-event reads on your key, for the on-chain analysis FBT already does.'
    }
  },

  /* ── domain bridges: swap, routing and on-chain reads ──────────────────────
     Same rule as everywhere else in this file: these are constants. The key is
     proven with one cheap read the vendor documents, and the probe runs with the
     method the vendor uses (JSON-RPC is a POST). */
  {
    id: '1inch',
    name: '1inch',
    vendor: '1inch Network',
    kind: 'data',
    baseUrl: 'https://api.1inch.dev',
    auth: { header: 'authorization', scheme: 'bearer' },
    probePath: '/gas-price/v1.4/1',
    check: (json) => (json && (json.result || json.gasPrice || json.instant) ? { ok: true } : { ok: false, detail: 'unexpected gas-price payload' }),
    proofLabel: { fa: 'گس زندهٔ 1inch روی زنجیرهٔ ۱', en: 'Live 1inch gas on chain 1' },
    siteUrl: 'https://1inch.io',
    docsUrl: 'https://portal.1inch.dev/documentation',
    keyUrl: 'https://portal.1inch.dev/dashboard',
    domainUse: {
      fa: 'مسیریابی و قیمت سواپ با کلید خودتان؛ همان مسیرهایی که FBT برای ساخت تراکنش استفاده می‌کند، ولی با سهمیه و حساب خودتان.',
      en: 'Swap routing and pricing on your own key — the same routes FBT builds transactions from, on your account and quota.'
    }
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    vendor: 'Jupiter',
    kind: 'data',
    baseUrl: 'https://api.jup.ag',
    auth: { header: 'x-api-key', scheme: 'raw' },
    probePath: '/price/v3?ids=So11111111111111111111111111111111111111112',
    check: (json) => (json && typeof json === 'object' && Object.keys(json).length > 0 ? { ok: true } : { ok: false, detail: 'no price returned' }),
    proofLabel: { fa: 'قیمت زندهٔ SOL از Jupiter', en: 'Live SOL price from Jupiter' },
    siteUrl: 'https://jup.ag',
    docsUrl: 'https://dev.jup.ag/docs',
    keyUrl: 'https://station.jup.ag/portal',
    domainUse: {
      fa: 'قیمت و مسیر سواپ روی سولانا با کلید پورتال خودتان، برای همان تحلیل‌های کیف‌پول سولانا در FBT.',
      en: 'Solana prices and swap routes on your portal key, for the Solana wallet analysis FBT already does.'
    }
  },
  {
    id: 'alchemy',
    name: 'Alchemy',
    vendor: 'Alchemy',
    kind: 'data',
    baseUrl: 'https://eth-mainnet.g.alchemy.com',
    auth: { path: true },
    probe: {
      method: 'POST',
      path: '/v2/{key}',
      body: { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
      contentType: 'application/json'
    },
    check: (json) => (typeof json?.result === 'string' ? { ok: true } : { ok: false, detail: String(json?.error?.message || 'no block number') }),
    proofLabel: { fa: 'شمارهٔ زندهٔ بلاک اتریوم', en: 'Live Ethereum block number' },
    siteUrl: 'https://www.alchemy.com',
    docsUrl: 'https://docs.alchemy.com',
    keyUrl: 'https://dashboard.alchemy.com',
    domainUse: {
      fa: 'خواندن موجودی، تراکنش و لاگ قرارداد روی EVM با کلید خودتان؛ بدون سهمیهٔ مشترک.',
      en: 'Balance, transaction and contract-log reads on EVM with your own key, off the shared quota.'
    }
  },
  {
    id: 'helius',
    name: 'Helius',
    vendor: 'Helius',
    kind: 'data',
    baseUrl: 'https://mainnet.helius-rpc.com',
    auth: { query: 'api-key' },
    probe: {
      method: 'POST',
      path: '/',
      body: { jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] },
      contentType: 'application/json'
    },
    check: (json) => (typeof json?.result === 'number' ? { ok: true } : { ok: false, detail: String(json?.error?.message || 'no slot returned') }),
    proofLabel: { fa: 'اسلات زندهٔ سولانا', en: 'Live Solana slot' },
    siteUrl: 'https://www.helius.dev',
    docsUrl: 'https://docs.helius.dev',
    keyUrl: 'https://dashboard.helius.dev/api-keys',
    domainUse: {
      fa: 'خواندن حساب‌ها، دارایی‌های توکن و تراکنش‌های سولانا با کلید خودتان.',
      en: 'Solana account, token-holdings and transaction reads on your own key.'
    }
  },
  {
    id: 'birdeye',
    name: 'Birdeye',
    vendor: 'Birdeye',
    kind: 'data',
    baseUrl: 'https://public-api.birdeye.so',
    auth: { header: 'x-api-key', scheme: 'raw', extraHeaders: { 'x-chain': 'solana' } },
    probePath: '/defi/price?address=So11111111111111111111111111111111111111112',
    check: (json) => (json?.success === true || json?.data?.value ? { ok: true } : { ok: false, detail: String(json?.message || 'no price returned') }),
    proofLabel: { fa: 'قیمت زندهٔ SOL از Birdeye', en: 'Live SOL price from Birdeye' },
    siteUrl: 'https://birdeye.so',
    docsUrl: 'https://docs.birdeye.so',
    keyUrl: 'https://bds.birdeye.so',
    domainUse: {
      fa: 'قیمت و نقدینگی توکن‌های سولانا با کلید خودتان، برای پایش جفت‌های تازه.',
      en: 'Solana token prices and liquidity on your own key, for watching new pairs.'
    }
  },
  {
    id: 'moralis',
    name: 'Moralis',
    vendor: 'Moralis',
    kind: 'data',
    baseUrl: 'https://deep-index.moralis.io/api/v2.2',
    auth: { header: 'x-api-key', scheme: 'raw' },
    probePath: '/web3/version',
    check: (json) => (json && typeof json === 'object' && Object.keys(json).length > 0 ? { ok: true } : { ok: false, detail: 'empty version payload' }),
    proofLabel: { fa: 'نسخهٔ زندهٔ API', en: 'Live API version' },
    siteUrl: 'https://moralis.io',
    docsUrl: 'https://docs.moralis.io',
    keyUrl: 'https://admin.moralis.io/web3apis',
    domainUse: {
      fa: 'پرتفوی چندزنجیره‌ای، تاریخچهٔ تراکنش و موجودی توکن با کلید خودتان.',
      en: 'Multi-chain portfolio, transaction history and token balances on your own key.'
    }
  },
];

/* Category, mark and pricing page for the directory card. Kept in one table so
   a card cannot exist without the fields the UI needs to render it honestly. */
const DIRECTORY_META = {
  openai: { category: 'ai', mark: 'AI', pricingUrl: 'https://openai.com/api/pricing/' },
  anthropic: { category: 'ai', mark: 'A', pricingUrl: 'https://www.anthropic.com/pricing' },
  gemini: { category: 'ai', mark: 'G', pricingUrl: 'https://ai.google.dev/pricing' },
  groq: { category: 'ai', mark: 'GQ', pricingUrl: 'https://groq.com/pricing' },
  mistral: { category: 'ai', mark: 'M', pricingUrl: 'https://mistral.ai/pricing' },
  deepseek: { category: 'ai', mark: 'DS', pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing' },
  openrouter: { category: 'ai', mark: 'OR', pricingUrl: 'https://openrouter.ai/models' },
  xai: { category: 'ai', mark: 'X', pricingUrl: 'https://docs.x.ai/docs/models' },
  cerebras: { category: 'ai', mark: 'CB', pricingUrl: 'https://www.cerebras.ai/pricing' },
  together: { category: 'ai', mark: 'T', pricingUrl: 'https://www.together.ai/pricing' },
  fireworks: { category: 'ai', mark: 'FW', pricingUrl: 'https://fireworks.ai/pricing' },
  sambanova: { category: 'ai', mark: 'SN', pricingUrl: 'https://cloud.sambanova.ai/pricing' },
  coingecko: { category: 'data', mark: 'CG', pricingUrl: 'https://www.coingecko.com/en/api/pricing' },
  etherscan: { category: 'onchain', mark: 'ES', pricingUrl: 'https://etherscan.io/apis' },
  alchemy: { category: 'onchain', mark: 'AL', pricingUrl: 'https://www.alchemy.com/pricing' },
  helius: { category: 'onchain', mark: 'HL', pricingUrl: 'https://www.helius.dev/pricing' },
  moralis: { category: 'onchain', mark: 'MO', pricingUrl: 'https://moralis.io/pricing' },
  birdeye: { category: 'data', mark: 'BE', pricingUrl: 'https://docs.birdeye.so' },
  '1inch': { category: 'swap', mark: '1IN', pricingUrl: 'https://business.1inch.dev' },
  jupiter: { category: 'swap', mark: 'JUP', pricingUrl: 'https://station.jup.ag/portal' }
};

for (const bridge of BRIDGES) {
  Object.assign(bridge, DIRECTORY_META[bridge.id] || { category: bridge.kind === 'data' ? 'data' : 'ai', mark: '◎' });
  Object.freeze(bridge);
}

/** Category labels for the directory chips (order is the render order). */
export const BRIDGE_CATEGORIES = Object.freeze([
  { id: 'all', fa: 'همه', en: 'All' },
  { id: 'ai', fa: 'صندلی هوش مصنوعی', en: 'AI seats' },
  { id: 'data', fa: 'قیمت و دادهٔ بازار', en: 'Market data' },
  { id: 'onchain', fa: 'آنچین و قرارداد', en: 'On-chain' },
  { id: 'swap', fa: 'سواپ و مسیریابی', en: 'Swap & routing' }
]);

const BY_ID = new Map(BRIDGES.map((b) => [b.id, b]));

/** Public, secret-free description of one bridge. */
export function publicBridge(bridge) {
  if (!bridge) return null;
  return {
    id: bridge.id,
    name: bridge.name,
    vendor: bridge.vendor,
    kind: bridge.kind || 'ai',
    category: bridge.category || 'ai',
    mark: bridge.mark || '◎',
    pricingUrl: bridge.pricingUrl || null,
    protocol: bridge.protocol || null,
    proofLabel: bridge.proofLabel || null,
    siteUrl: bridge.siteUrl,
    docsUrl: bridge.docsUrl,
    keyUrl: bridge.keyUrl,
    defaultModel: bridge.defaultModel,
    domainUse: bridge.domainUse,
    authLabel: (() => {
      const auths = Array.isArray(bridge.variants) && bridge.variants.length
        ? bridge.variants.map((v) => v.auth || {})
        : [bridge.auth || {}];
      if (auths.some((a) => a.path)) return '/{key} در آدرس';
      if (auths.some((a) => a.query)) return `?${auths.find((a) => a.query).query}=…`;
      const headers = [...new Set(auths.map((a) => String(a.header || 'authorization')))];
      return `${headers.join(' / ')}: …`;
    })(),
    requiresModel: (bridge.kind || 'ai') === 'ai'
  };
}

export function bridgeById(id) {
  return BY_ID.get(String(id || '').trim().toLowerCase()) || null;
}

export function listBridges() {
  return BRIDGES.map(publicBridge);
}

/** Protocol adapter for one bridge: read the model list, send one question. */
export function protocolFor(bridge) {
  if (bridge.protocol === 'anthropic') {
    return {
      probePath: '/models?limit=1',
      modelsFrom: (json) => (Array.isArray(json?.data) ? json.data.map((m) => String(m?.id || '')).filter(Boolean) : []),
      request: ({ model, system, user, maxTokens }) => ({
        path: '/messages',
        body: {
          model,
          max_tokens: maxTokens,
          temperature: 0.2,
          system,
          messages: [{ role: 'user', content: user }]
        }
      }),
      answerFrom: (json) =>
        (Array.isArray(json?.content) ? json.content.map((part) => String(part?.text || '')).join('') : '').trim()
    };
  }
  if (bridge.protocol === 'gemini') {
    return {
      probePath: '/models?pageSize=200',
      modelsFrom: (json) =>
        (Array.isArray(json?.models) ? json.models.map((m) => String(m?.name || '').replace(/^models\//, '')) : []).filter(Boolean),
      request: ({ model, system, user, maxTokens }) => ({
        path: `/models/${encodeURIComponent(model)}:generateContent`,
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens }
        }
      }),
      answerFrom: (json) =>
        (Array.isArray(json?.candidates?.[0]?.content?.parts)
          ? json.candidates[0].content.parts.map((p) => String(p?.text || '')).join('')
          : ''
        ).trim()
    };
  }
  return {
    probePath: OPENAI_LIKE.probe,
    modelsFrom: OPENAI_LIKE.modelsFrom,
    request: ({ model, system, user, maxTokens }) => ({
      path: OPENAI_LIKE.chat,
      body: {
        model,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }
    }),
    answerFrom: OPENAI_LIKE.answerFrom
  };
}

/**
 * Pick a model from the vendor's OWN list. Preference order first, then the
 * table default, then the first id the vendor reported. Never invents an id.
 */
export function pickModel(bridge, ids = []) {
  const list = ids.filter(Boolean);
  for (const needle of bridge.modelPreference || []) {
    const hit = list.find((id) => id.toLowerCase().includes(needle.toLowerCase()));
    if (hit) return hit;
  }
  if (bridge.defaultModel && list.includes(bridge.defaultModel)) return bridge.defaultModel;
  return bridge.defaultModel || list[0] || null;
}

/** The raw table, for tests that assert every row is https and self-describing. */
export const BRIDGES_INTERNAL_FOR_TESTS = Object.freeze(BRIDGES);

export const KEY_BRIDGE_IDS = Object.freeze(BRIDGES.map((b) => b.id));

export default { listBridges, bridgeById, protocolFor, pickModel, publicBridge, KEY_BRIDGE_IDS };
