/**
 * FBT-MCP TOOL CATALOGUE — what an external AI agent can and cannot do.
 * ---------------------------------------------------------------------------
 * HARD BOUNDARY, enforced by construction rather than by policy text:
 *
 *   · No tool in this file signs, broadcasts, settles, cancels or withdraws.
 *     The server behind these routes cannot do those things either (see
 *     `x-fbt-boundary` in server/openapi.js); the user's wallet is the only
 *     signer in the system. Quote and simulation tools return ADVISORY data
 *     whose next step is always "present it to the user, who may sign".
 *   · Every tool is a thin wrapper over a route that already exists and is
 *     already used by the web app. `routes` lists the exact registered
 *     literals and test/mcp/mcp-probe.mjs asserts each one against
 *     server/app.js — the same "no advertised endpoint may 404" discipline the
 *     Developers page uses.
 *   · Scope gates (`public` / `read_network` / `request_quote` /
 *     `request_simulation` / `manage_listings`) mirror the scopes a developer
 *     key can hold (server/developerKeys.js). There is deliberately no
 *     `sign`, `execute`, `withdraw` or `settle` scope to grant, so there is
 *     nothing here that could grow into one.
 *
 * Tool-surface design follows the same "tenant-scoped wrapper over the human
 * API" pattern as QuantDinger Community's `quantdinger-mcp` server (Apache
 * 2.0); the code here is original and this repository's own license governs.
 */

export const BOUNDARY = Object.freeze({
  canSign: false,
  canExecute: false,
  canSettle: false,
  canWithdraw: false,
  custody: false,
  userSignatureRequired: true,
  note: 'Every quote or plan is advisory. Signing and broadcast happen only in the user\'s own wallet; this server never receives a key, seed or signature.'
});

/** Names an agent might try if it believes this is an execution API. Refused
 *  with the same fixed text regardless of arguments — no probing surface.
 *  Segment-anchored (`sign_swap`, `execute`, `swap-now`) because `_` is a word
 *  character: plain `\b(sign|execute)\b` silently matches neither `sign_swap`
 *  nor `execute_tx` — the exact names a confused model would invent. */
export const FORBIDDEN_NAME_RE = /(?:^|[_.\-\s])(sign|broadcast|submit_?tx|execute|withdraw|settle|transfer|swap_?now|cancel|drain|sweep)(?:$|[_.\-\s])/i;

export const POLICY_REFUSAL = Object.freeze({
  error: 'POLICY_REFUSAL',
  detail: 'fbt-mcp is a read/quote/simulate bridge. No tool in it signs, broadcasts, settles or withdraws — the user\'s wallet is the only signer in the system. Present findings to the user instead; any execution is theirs to approve and sign in FBT Swap.',
  boundary: BOUNDARY
});

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });

/** Standard note appended to anything advisory. */
const ADVISORY = ' Advisory only: the user\'s wallet signs; nothing here executes.';

/* -------------------------------------------------------------------------- */
/* identity & operations (public)                                              */
/* -------------------------------------------------------------------------- */

const healthTool = {
  name: 'fbt_check_health',
  title: 'FBT API health',
  description: 'Liveness of the FBT Swap API. Start here to confirm which deployment you are talking to.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/health'],
  inputSchema: obj({}),
  run: (client) => client.get('/api/health')
};

const environmentsTool = {
  name: 'fbt_get_environments',
  title: 'FBT environments',
  description: 'What THIS deployment is currently configured to do (durable store, providers, certification). Never implies funded or mainnet capability.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/environments'],
  inputSchema: obj({}),
  run: (client) => client.get('/api/environments')
};

const whoamiTool = {
  name: 'fbt_whoami',
  title: 'Who am I',
  description: 'Resolves the configured developer API key (FBT_API_KEY) to its identity and scopes, and repeats the hard never-sign boundary. Requires a key; the secret is never echoed.',
  scope: 'scoped',
  routes: ['GET /api/developer/whoami'],
  inputSchema: obj({}),
  run: async (client) => {
    const who = await client.identity({ force: true });
    return who.ok
      ? { ok: true, baseUrl: client.baseUrl, keyPrefix: client.keyPrefix, identity: who.identity, boundary: BOUNDARY }
      : { ok: false, error: who.code, detail: 'No valid developer key. Mint one with POST /api/developer/projects/{id}/keys from the app\'s Developers page and set FBT_API_KEY.', boundary: BOUNDARY };
  }
};

/* -------------------------------------------------------------------------- */
/* market intelligence (public — the same cached reads the web app serves)     */
/* -------------------------------------------------------------------------- */

const marketsTool = {
  name: 'fbt_get_markets',
  title: 'Market list',
  description: 'Paged market snapshot (price, 24h/7d change, volume, market cap) from the same cached providers the FBT app uses. Numbers come from upstream market data; nothing is computed or guessed.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/markets'],
  inputSchema: obj({
    page: int('Page number, default 1', { minimum: 1 }),
    perPage: int('Rows per page, default 50, max 250', { minimum: 1, maximum: 250 }),
    vs: str('Quote currency, default "usd"')
  }),
  run: (client, args) => client.get('/api/markets', {
    query: { page: args.page, per_page: args.perPage, vs: args.vs }
  })
};

const pricesTool = {
  name: 'fbt_get_prices',
  title: 'Simple prices',
  description: 'Current USD prices for a comma-list of coin ids (e.g. bitcoin,ethereum), max 50. Empty object means unknown ids — never a zero price.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/prices'],
  inputSchema: obj({
    ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50, description: 'CoinGecko-style coin ids, e.g. ["bitcoin","ethereum"]' }
  }),
  run: (client, args) => client.get('/api/prices', { query: { ids: (args.ids || []).join(',') } })
};

const coinTool = {
  name: 'fbt_get_coin',
  title: 'Coin detail',
  description: 'Full detail for one coin id (market data, description, links) as served to the coin page.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/coin/:id'],
  inputSchema: obj({ id: str('Coin id, e.g. "bitcoin"') }, ['id']),
  run: (client, args) => client.get(`/api/coin/${encodeURIComponent(String(args.id).slice(0, 64))}`)
};

const searchTool = {
  name: 'fbt_search_coins',
  title: 'Search coins',
  description: 'Search coins by name or symbol (server-cached, min 2 characters).' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/search'],
  inputSchema: obj({ q: str('Search text, 2–64 characters') }, ['q']),
  run: (client, args) => client.get('/api/search', { query: { q: String(args.q).slice(0, 64) } })
};

const trendingTool = {
  name: 'fbt_get_trending',
  title: 'Trending coins',
  description: 'Currently trending coins from the cached market provider.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/trending'],
  inputSchema: obj({}),
  run: (client) => client.get('/api/trending')
};

const newsTool = {
  name: 'fbt_get_news',
  title: 'Crypto news',
  description: 'Aggregated crypto news headlines as served to the app\'s news screen (server-cached).' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/news'],
  inputSchema: obj({}),
  run: (client) => client.get('/api/news')
};

const pulseTool = {
  name: 'fbt_get_signals_pulse',
  title: 'Market pulse signals',
  description: 'The deterministic market-pulse signal bundle: measured evidence, classification, agreement and data quality. AI narrates this data elsewhere but is never the source of these numbers.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/signals/pulse'],
  inputSchema: obj({}),
  run: (client) => client.get('/api/signals/pulse')
};

const explainTool = {
  name: 'fbt_explain_signal',
  title: 'Explain a signal',
  description: 'AI (or deterministic offline fallback) explanation of one asset\'s signal from measured evidence. Evidence in, narrative out — the model invents no numbers. Not investment advice.' + ADVISORY,
  scope: 'public',
  routes: ['POST /api/signals/why'],
  inputSchema: obj({
    symbol: str('Ticker symbol, e.g. "BTC"', { maxLength: 20 }),
    name: str('Display name, defaults to symbol', { maxLength: 60 }),
    lang: str('Output language: en | fa | ar (default en)', { enum: ['en', 'fa', 'ar'] }),
    classification: str('Signal classification, e.g. WATCH', { maxLength: 24 }),
    confidence: num('Measured confidence 0–100, or omit'),
    riskLabel: str('Risk label, max 12 chars', { maxLength: 12 }),
    timeframe: num('Horizon in days, default 7'),
    evidence: { type: 'object', description: 'Optional measured evidence bundle (from fbt_get_signals_pulse). Only provided fields are used.' }
  }, ['symbol']),
  run: (client, args) => client.post('/api/signals/why', {
    symbol: args.symbol,
    name: args.name,
    lang: args.lang,
    classification: args.classification,
    confidence: args.confidence,
    riskLabel: args.riskLabel,
    timeframe: args.timeframe,
    evidence: args.evidence
  })
};

const networkOverviewTool = {
  name: 'fbt_get_network_overview',
  title: 'Network overview',
  description: 'Cross-chain network overview (fees, congestion window) as served to the app.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/network/overview'],
  inputSchema: obj({ window: str('Window, e.g. "24h"', { maxLength: 8 }) }),
  run: (client, args) => client.get('/api/network/overview', { query: { window: args.window } })
};

const smartMoneyOverviewTool = {
  name: 'fbt_get_smart_money_overview',
  title: 'Smart-money overview',
  description: 'Aggregate smart-money flow overview (tracked wallets, net flows) from the on-chain intelligence engine.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/v1/smart-money/overview'],
  inputSchema: obj({}),
  run: (client) => client.get('/api/v1/smart-money/overview')
};

const smartMoneyFlowsTool = {
  name: 'fbt_get_smart_money_flows',
  title: 'Smart-money flows',
  description: 'Recent smart-money flows from the on-chain intelligence engine.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/v1/smart-money/flows'],
  inputSchema: obj({}),
  run: (client) => client.get('/api/v1/smart-money/flows')
};

/* -------------------------------------------------------------------------- */
/* Intent OS surface (public status reads)                                     */
/* -------------------------------------------------------------------------- */

const intentCapabilitiesTool = {
  name: 'fbt_get_intent_capabilities',
  title: 'Intent OS capabilities',
  description: 'What the FBT Intent OS execution layer can currently do (solvers, venues, limits). Discoverable contract at GET /api/intents/v1/capabilities — read-only.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/intents/v1/capabilities'],
  inputSchema: obj({}),
  run: (client) => client.get('/api/intents/v1/capabilities')
};

const intentStatusTool = {
  name: 'fbt_get_intent_status',
  title: 'Intent OS public status',
  description: 'Public operational status of the Intent OS (activation, venue health, freeze state). Read-only.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/intents/v1/public-status', 'GET /api/intents/v1/venue-health'],
  inputSchema: obj({ detail: { type: 'boolean', description: 'Also include live venue-health detail (default false)' } }),
  run: async (client, args) => {
    const status = await client.get('/api/intents/v1/public-status');
    if (!args.detail || !status.ok) return status;
    const venues = await client.get('/api/intents/v1/venue-health');
    return { ok: venues.ok, status, venues };
  }
};

/* -------------------------------------------------------------------------- */
/* ecosystem registry (public browse + manage_listings writes)                 */
/* -------------------------------------------------------------------------- */

const LISTING_TYPES = ['agents', 'strategies', 'liquidity'];

const listingsBrowseTool = {
  name: 'fbt_browse_listings',
  title: 'Browse ecosystem listings',
  description: 'Public catalog of self-reported agent/strategy/liquidity listings. A listing is an advertisement until an allowlisted reviewer certifies it; published ≠ verified.' + ADVISORY,
  scope: 'public',
  routes: ['GET /api/ecosystem/agents', 'GET /api/ecosystem/strategies', 'GET /api/ecosystem/liquidity'],
  inputSchema: obj({
    type: str('Listing type', { enum: LISTING_TYPES }),
    cursor: str('Pagination cursor from a previous page', { maxLength: 128 }),
    limit: int('Page size', { minimum: 1, maximum: 100 })
  }, ['type']),
  run: (client, args) => client.get(`/api/ecosystem/${args.type}`, { query: { cursor: args.cursor, limit: args.limit } })
};

const listingsMineTool = {
  name: 'fbt_list_my_listings',
  title: 'My listings',
  description: 'Your own agent/strategy listings (any state except deleted). Owner-scoped by the key identity — there is no parameter that widens it. Requires the manage_listings scope.' + ADVISORY,
  scope: 'manage_listings',
  routes: ['GET /api/ecosystem/mine/agents', 'GET /api/ecosystem/mine/strategies'],
  inputSchema: obj({ type: str('Listing type', { enum: ['agents', 'strategies'] }) }, ['type']),
  run: async (client, args) => {
    const gate = await client.ensureScope('manage_listings');
    if (!gate.ok) return gate;
    return client.get(`/api/ecosystem/mine/${args.type}`);
  }
};

const listingWriteTool = {
  name: 'fbt_save_listing',
  title: 'Create or update a listing',
  description: 'Create (omit id) or update (pass id) one of YOUR ecosystem listings. Self-reported draft state only: publishing to the public catalog additionally requires an allowlisted reviewer\'s certification, which owners cannot issue to themselves. Requires the manage_listings scope and an idempotency key.' + ADVISORY,
  scope: 'manage_listings',
  routes: ['POST /api/ecosystem/agents', 'POST /api/ecosystem/agents/:id', 'POST /api/ecosystem/strategies', 'POST /api/ecosystem/strategies/:id'],
  inputSchema: obj({
    type: str('Listing type', { enum: ['agents', 'strategies'] }),
    id: str('Listing id — omit to create, pass to update', { maxLength: 64 }),
    listing: { type: 'object', description: 'The listing body (name, description, metadata). Screened server-side; unsafe input is refused.' },
    idempotencyKey: str('Unique key (8–128 chars) so a retry replays instead of duplicating', { minLength: 8, maxLength: 128 })
  }, ['type', 'listing', 'idempotencyKey']),
  run: async (client, args) => {
    const gate = await client.ensureScope('manage_listings');
    if (!gate.ok) return gate;
    const path = args.id
      ? `/api/ecosystem/${args.type}/${encodeURIComponent(String(args.id).slice(0, 64))}`
      : `/api/ecosystem/${args.type}`;
    return client.post(path, args.listing, { idempotencyKey: args.idempotencyKey });
  }
};

const listingActionTool = {
  name: 'fbt_listing_action',
  title: 'Listing lifecycle action',
  description: 'submit / publish / revoke / delete / draft one of YOUR listings. publish succeeds only while an allowlisted reviewer\'s certification is active and not older than the listing content — owners move listings, they cannot bless them. Requires the manage_listings scope and an idempotency key.' + ADVISORY,
  scope: 'manage_listings',
  routes: [
    'POST /api/ecosystem/agents/:id/submit', 'POST /api/ecosystem/agents/:id/publish', 'POST /api/ecosystem/agents/:id/revoke', 'POST /api/ecosystem/agents/:id/delete', 'POST /api/ecosystem/agents/:id/draft',
    'POST /api/ecosystem/strategies/:id/submit', 'POST /api/ecosystem/strategies/:id/publish', 'POST /api/ecosystem/strategies/:id/revoke', 'POST /api/ecosystem/strategies/:id/delete', 'POST /api/ecosystem/strategies/:id/draft'
  ],
  inputSchema: obj({
    type: str('Listing type', { enum: ['agents', 'strategies'] }),
    id: str('Listing id', { maxLength: 64 }),
    action: str('Lifecycle action', { enum: ['submit', 'publish', 'revoke', 'delete', 'draft'] }),
    idempotencyKey: str('Unique key (8–128 chars) so a retry replays instead of duplicating', { minLength: 8, maxLength: 128 })
  }, ['type', 'id', 'action', 'idempotencyKey']),
  run: async (client, args) => {
    const gate = await client.ensureScope('manage_listings');
    if (!gate.ok) return gate;
    return client.post(
      `/api/ecosystem/${args.type}/${encodeURIComponent(String(args.id).slice(0, 64))}/${args.action}`,
      undefined,
      { idempotencyKey: args.idempotencyKey }
    );
  }
};

/* -------------------------------------------------------------------------- */
/* quotes (request_quote) — advisory prices, never orders                      */
/* -------------------------------------------------------------------------- */

const crossChainQuoteTool = {
  name: 'fbt_get_cross_chain_quote',
  title: 'Cross-chain quote',
  description: 'Unified cross-chain transfer quote (LI.FI/deBridge-class providers, ranked). A quote is a price with a ~60-second life. Returns a quote and possibly a transactionRequest — the USER\'s wallet signs that request; this bridge will not. Requires the request_quote scope.' + ADVISORY,
  scope: 'request_quote',
  routes: ['GET /api/cross-chain/quote'],
  inputSchema: obj({
    fromChain: str('Source chain id as used by the app, e.g. "1" or "solana"', { maxLength: 24 }),
    toChain: str('Destination chain id', { maxLength: 24 }),
    fromToken: str('Source token address ("native" where supported)', { maxLength: 64 }),
    toToken: str('Destination token address', { maxLength: 64 }),
    fromAmount: str('Amount in smallest units of the source token (integer string)', { maxLength: 78 }),
    fromAddress: str('Source wallet address (affects routes/fees)', { maxLength: 128 }),
    toAddress: str('Destination wallet address', { maxLength: 128 }),
    slippage: num('Slippage tolerance, e.g. 0.005'),
    preferTool: str('Preferred provider tool, if any', { maxLength: 32 }),
    order: str('Ranking order for multi-route answers', { maxLength: 16 })
  }, ['fromChain', 'toChain', 'fromToken', 'toToken', 'fromAmount']),
  run: async (client, args) => {
    const gate = await client.ensureScope('request_quote');
    if (!gate.ok) return gate;
    return client.get('/api/cross-chain/quote', { query: args });
  }
};

const bridgeQuoteTool = {
  name: 'fbt_get_bridge_quote',
  title: 'LI.FI bridge quote',
  description: 'Direct LI.FI bridge quote pass-through (raw provider shape). Quote only — no transaction is created, signed or sent. Requires the request_quote scope.' + ADVISORY,
  scope: 'request_quote',
  routes: ['GET /api/bridge/quote'],
  inputSchema: obj({
    fromChain: str('Source chain id (numeric as string)', { maxLength: 24 }),
    toChain: str('Destination chain id', { maxLength: 24 }),
    fromToken: str('Source token address', { maxLength: 64 }),
    toToken: str('Destination token address', { maxLength: 64 }),
    fromAmount: str('Amount in smallest units (integer string)', { maxLength: 78 }),
    fromAddress: str('Source wallet address', { maxLength: 128 }),
    toAddress: str('Destination wallet address', { maxLength: 128 }),
    slippage: num('Slippage tolerance, e.g. 0.005')
  }, ['fromChain', 'toChain', 'fromToken', 'toToken', 'fromAmount']),
  run: async (client, args) => {
    const gate = await client.ensureScope('request_quote');
    if (!gate.ok) return gate;
    return client.get('/api/bridge/quote', { query: args });
  }
};

const dlnQuoteTool = {
  name: 'fbt_get_dln_quote',
  title: 'deBridge DLN quote',
  description: 'deBridge DLN cross-chain quote, including the fixed origin-chain fee in smallest units. Quote only — DLN order creation and signing happen in the user\'s wallet flow, not here. Requires the request_quote scope.' + ADVISORY,
  scope: 'request_quote',
  routes: ['GET /api/dln/quote'],
  inputSchema: obj({
    srcChainId: int('Source deBridge chain id (Solana accepted as source)'),
    dstChainId: int('Destination deBridge chain id (EVM only)'),
    srcChainTokenIn: str('Source token address', { maxLength: 64 }),
    srcChainTokenInAmount: str('Amount in smallest units (integer string)', { maxLength: 78 }),
    dstChainTokenOut: str('Destination token address (EVM)', { maxLength: 64 }),
    dstAddress: str('Destination receiver address', { maxLength: 128 })
  }, ['srcChainId', 'dstChainId', 'srcChainTokenIn', 'srcChainTokenInAmount', 'dstChainTokenOut']),
  run: async (client, args) => {
    const gate = await client.ensureScope('request_quote');
    if (!gate.ok) return gate;
    return client.get('/api/dln/quote', { query: args });
  }
};

/* -------------------------------------------------------------------------- */
/* simulation & planning (request_simulation) — dry runs, nothing broadcast    */
/* -------------------------------------------------------------------------- */

const SNAPSHOT_SCHEMA = {
  type: 'object',
  properties: {
    venueId: str('Venue identifier, 1–48 chars', { maxLength: 48 }),
    reserveA: str('Reserve A as a decimal string in smallest units', { maxLength: 78 }),
    reserveB: str('Reserve B as a decimal string in smallest units', { maxLength: 78 }),
    feeBps: int('Venue fee in basis points', { minimum: 0, maximum: 999 }),
    observedAtMs: num('Observation timestamp, epoch milliseconds')
  },
  required: ['venueId', 'reserveA', 'reserveB', 'feeBps', 'observedAtMs'],
  additionalProperties: false
};

const MARKET_SCHEMA = {
  type: 'object',
  properties: {
    chainId: int('One of the chains listed by fbt_get_environments / flash-liquidity capabilities'),
    asset: str('Asset symbol, max 16 chars', { maxLength: 16 }),
    assetPriceUsd: num('Asset price in USD (needed for costed plans)'),
    assetDecimals: int('Token decimals 0–18 (needed for costed plans)'),
    nativePriceUsd: num('Native gas coin price in USD (needed for costed plans)'),
    snapshots: { type: 'array', minItems: 2, maxItems: 24, items: SNAPSHOT_SCHEMA, description: '2–24 reserve snapshots for the SAME pair across venues' }
  },
  required: ['chainId', 'snapshots'],
  additionalProperties: false
};

const defiScanTool = {
  name: 'fbt_scan_defi_opportunities',
  title: 'Flash-liquidity opportunity scan',
  description: 'Deterministic reserve-math scan for cross-venue flash-arbitrage opportunities (dry-run, no keys, no funds, no broadcast). Input is REAL venue reserve snapshots — pass measured data, never imagined reserves.' + ADVISORY,
  scope: 'request_simulation',
  routes: ['POST /api/flash-liquidity/v1/scan'],
  inputSchema: obj({
    market: MARKET_SCHEMA,
    loanPremiumBps: int('Optional loan premium in basis points (0–500)', { minimum: 0, maximum: 500 })
  }, ['market']),
  run: async (client, args) => {
    const gate = await client.ensureScope('request_simulation');
    if (!gate.ok) return gate;
    return client.post('/api/flash-liquidity/v1/scan', args);
  }
};

const defiPlanTool = {
  name: 'fbt_build_defi_plan',
  title: 'Flash-liquidity plan',
  description: 'Costed flash-arbitrage PLAN (dry-run planner, never broadcast). Needs full USD economics on the market plus intent {kind:"flash-arbitrage", minNetProfitBps}. Execution stays behind an audited wallet-gated router — this tool cannot enable it.' + ADVISORY,
  scope: 'request_simulation',
  routes: ['POST /api/flash-liquidity/v1/plan'],
  inputSchema: obj({
    market: MARKET_SCHEMA,
    intent: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['flash-arbitrage'] },
        minNetProfitBps: int('Minimum acceptable net profit in basis points (1–5000)', { minimum: 1, maximum: 5000 })
      },
      required: ['kind', 'minNetProfitBps'],
      additionalProperties: false
    },
    config: {
      type: 'object',
      properties: {
        gasUnits: int('Gas units cap', { minimum: 1, maximum: 5000000 }),
        gasPriceGwei: num('Gas price in gwei', { minimum: 0 }),
        platformFeeBps: int('Platform fee in bps', { minimum: 0, maximum: 1000 }),
        mevBufferBps: int('MEV buffer in bps', { minimum: 0, maximum: 500 }),
        slippageBps: int('Slippage in bps', { minimum: 1, maximum: 1000 }),
        deadlineSeconds: int('Order deadline in seconds', { minimum: 10, maximum: 600 })
      },
      additionalProperties: false
    },
    policy: { type: 'object', description: 'Optional risk-policy overrides accepted by createFlashPolicy' },
    context: {
      type: 'object',
      properties: { attemptsToday: int('Attempts already made today (0–10000)') },
      additionalProperties: false
    }
  }, ['market', 'intent']),
  run: async (client, args) => {
    const gate = await client.ensureScope('request_simulation');
    if (!gate.ok) return gate;
    return client.post('/api/flash-liquidity/v1/plan', args);
  }
};

const profitPlanTool = {
  name: 'fbt_build_profit_plan',
  title: 'Profit-target plan (read-only proposal)',
  description: 'Turns a capital + target + horizon + risk profile into a measured allocation PROPOSAL (Phases 106–108). Read-only: it schedules nothing, signs nothing and holds nothing. Any execution is a separate, user-approved Intent OS hand-off.' + ADVISORY,
  scope: 'request_simulation',
  routes: ['POST /api/intents/v1/profit-plan'],
  inputSchema: obj({
    capitalUsd: num('Capital in USD', { minimum: 0 }),
    horizonDays: int('Horizon in days (1–3650)', { minimum: 1, maximum: 3650 }),
    riskProfile: str('Risk profile', { enum: ['conservative', 'balanced', 'aggressive'] }),
    target: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['usd', 'pct'] },
        value: num('Target amount (USD) or percentage', { minimum: 0 })
      },
      required: ['mode', 'value'],
      additionalProperties: false
    },
    lang: str('Output language: en | fa | ar', { enum: ['en', 'fa', 'ar'] })
  }, ['capitalUsd']),
  run: async (client, args) => {
    const gate = await client.ensureScope('request_simulation');
    if (!gate.ok) return gate;
    return client.post('/api/intents/v1/profit-plan', args);
  }
};

/* -------------------------------------------------------------------------- */

export const TOOLS = Object.freeze([
  /* identity & operations */
  whoamiTool,
  healthTool,
  environmentsTool,
  /* market intelligence */
  marketsTool,
  pricesTool,
  coinTool,
  searchTool,
  trendingTool,
  newsTool,
  pulseTool,
  explainTool,
  networkOverviewTool,
  smartMoneyOverviewTool,
  smartMoneyFlowsTool,
  /* Intent OS */
  intentCapabilitiesTool,
  intentStatusTool,
  /* ecosystem registry */
  listingsBrowseTool,
  listingsMineTool,
  listingWriteTool,
  listingActionTool,
  /* quotes (request_quote) */
  crossChainQuoteTool,
  bridgeQuoteTool,
  dlnQuoteTool,
  /* simulation (request_simulation) */
  defiScanTool,
  defiPlanTool,
  profitPlanTool
]);

/** The MCP `tools/list` projection. */
export function listToolDescriptors() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      readOnlyHint: t.scope !== 'manage_listings',
      destructiveHint: false,
      idempotentHint: t.scope !== 'manage_listings',
      openWorldHint: t.scope === 'public' || t.scope === 'request_quote'
    },
    /* FBT extension: which OAuth-like developer-key scope the tool needs, so a
       client can grey out tools its key cannot call before trying. */
    'x-fbt-scope': t.scope === 'scoped' ? 'any' : t.scope
  }));
}

export function getTool(name) {
  return TOOLS.find((t) => t.name === name) || null;
}

/** Validate arguments against the "required array + basic types" subset the
 *  catalogue actually uses. Deep JSON-Schema validation is deliberately not
 *  half-implemented — the API re-validates everything anyway (fail closed). */
export function validateArgs(tool, args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  for (const key of tool.inputSchema.required || []) {
    if (a[key] === undefined || a[key] === null || a[key] === '') {
      return { ok: false, error: 'INVALID_ARGUMENTS', detail: `missing required argument '${key}'` };
    }
  }
  return { ok: true, args: a };
}
