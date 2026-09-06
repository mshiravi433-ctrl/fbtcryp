/**
 * Execute REAL tools for a classified intent before any sentence is generated.
 * Priority: tool result → shared state → cache with freshness → explicit unavailable.
 *
 * ─── EVERY TOOL IS BOUNDED, INDEPENDENT READS RUN IN PARALLEL ───────────────
 * The turn used to await tools one-by-one with no ceiling of its own: a slow
 * market fetch delayed the wallet answer that never needed it, and one hung
 * upstream stalled the whole conversation. Each call now races a per-tool
 * deadline (the tool loses, the turn continues), and reads that do not depend
 * on each other fire together.
 */

import { getTool, resolveToolsForIntent } from './toolRegistry.js';
import { scanOpportunities } from './opportunityScanner.js';
import { getCentralWalletState, isWalletConnected } from './centralWalletState.js';

const TOOL_TIMEOUT_MS = Number(globalThis.__FBT_TOOL_TIMEOUT_MS || 8000);

function withTimeout(promise, ms = TOOL_TIMEOUT_MS, label = 'tool') {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, dataStatus: 'unavailable', reason: `${label.toUpperCase()}_TIMEOUT`, timeoutMs: ms }), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

export function flattenAgentResults(agentResults = {}) {
  const out = {};
  if (!agentResults || typeof agentResults !== 'object') return out;
  for (const value of Object.values(agentResults)) {
    if (!value || typeof value !== 'object') continue;
    Object.assign(out, value);
  }
  return out;
}

async function callTool(id, input, ctx) {
  const tool = getTool(id);
  const started = Date.now();
  if (!tool || typeof tool.execute !== 'function') {
    return { id, ok: false, reason: 'TOOL_NOT_FOUND', latencyMs: 0 };
  }
  try {
    const result = await withTimeout(Promise.resolve(tool.execute(input || {}, ctx)), TOOL_TIMEOUT_MS, id);
    return {
      id,
      ok: result?.ok !== false,
      result,
      latencyMs: Date.now() - started,
      dataStatus: result?.dataStatus || (result?.ok === false ? 'unavailable' : 'live')
    };
  } catch (err) {
    return { id, ok: false, reason: String(err?.message || err).slice(0, 160), latencyMs: Date.now() - started };
  }
}

export async function executeIntentTools({ intent, context = {}, services = {} } = {}) {
  const type = String(intent?.type || 'GENERAL').toUpperCase();
  const ctx = { ...context, ...services, services, wallet: context.wallet, portfolio: context.portfolio };
  const toolsUsed = [];
  const data = {};
  const walletSnap = context.wallet || getCentralWalletState();
  const connected = isWalletConnected(walletSnap) || Boolean(walletSnap?.connected || walletSnap?.address);

  const need = (id, input = {}) => callTool(id, input, ctx).then((row) => {
    toolsUsed.push(row);
    return row;
  });

  if (['PORTFOLIO_ANALYSIS', 'WALLET_BALANCE', 'RISK_ANALYSIS', 'REBALANCE'].includes(type)) {
    /* Balance read, portfolio summary and local analysis are independent —
       they used to run one-after-another, tripling the wait for no reason. */
    const [walletRow, portfolioRow, analysisRow] = await Promise.all([
      need('wallet.getBalances', { address: walletSnap?.address || walletSnap?.evmAddresses?.[0] }),
      need('wallet.getPortfolio', {}),
      context.portfolio?.holdings?.length
        ? need('portfolio.analysis', { holdings: context.portfolio.holdings, detailed: true })
        : Promise.resolve(null)
    ]);
    data.wallet = walletRow.result;
    data.portfolio = portfolioRow.result || analysisRow?.result;
  }

  /*
   * GOAL_PLAN needs the same scan. The goal compiler builds its verdict from
   * the rates it can actually read (`results.yieldOpportunities`), and its
   * honesty rule is to REFUSE rather than guess: with no scan it can only
   * answer `NO_LIVE_RATES`. So a goal request that skipped this branch
   * produced a card that always said "I could not read any live rate" — even
   * on a network where the rates were right there.
   */
  if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'INVESTMENT_PLAN', 'STAKING', 'GOAL_PLAN'].includes(type)) {
    const scan = await scanOpportunities({
      services,
      portfolio: context.portfolio,
      riskTolerance: intent?.entities?.riskTolerance || 'medium',
      asset: intent?.entities?.token || intent?.entities?.amountSymbol || null
    });
    toolsUsed.push({
      id: 'opportunity.scan',
      ok: scan.ok,
      result: scan,
      dataStatus: scan.dataStatus,
      latencyMs: scan.latencyMs
    });
    data.yieldOpportunities = scan;
    data.opportunities = scan.opportunities;
  }

  if (['MARKET_ANALYSIS', 'MARKET_CONTEXT', 'ANALYZE_TOKEN'].includes(type)) {
    /* Overview and the per-token read answer different questions and share
       no state — running them together keeps a token ask off the overview's
       critical path. */
    const jobs = [need('market.overview', {})];
    if (intent?.entities?.token) jobs.push(need('market.tokenDetail', { symbol: intent.entities.token }));
    const [overviewRow, tokenRow] = await Promise.all(jobs);
    data.market = overviewRow.result;
    if (tokenRow) data.token = tokenRow.result;
  }

  if (['SMART_MONEY'].includes(type)) {
    data.smartMoney = (await need('market.smartMoney', {})).result;
  }
  if (['WHALE'].includes(type)) {
    data.whale = (await need('whale.track', { token: intent?.entities?.token })).result;
  }
  if (['NEWS_SEARCH'].includes(type)) {
    data.news = (await need('news.search', { query: intent?.entities?.token || '' })).result;
  }
  if (['SWAP', 'BUY', 'SELL'].includes(type)) {
    const from = intent?.entities?.fromToken || (type === 'SELL' ? intent?.entities?.token : 'USDC');
    const to = intent?.entities?.toToken || (type === 'BUY' ? intent?.entities?.token : 'ETH');
    const amount = intent?.entities?.amount || intent?.entities?.amountUsd;
    if (from && to && amount) {
      data.quote = (await need('swap.quote', {
        fromSymbol: from,
        toSymbol: to,
        amount,
        chainId: walletSnap?.chainId || context.wallet?.chains?.[0]
      })).result;
    }
  }

  if (!toolsUsed.length) {
    const planned = resolveToolsForIntent(type, context).filter((t) => t.readOnly).slice(0, 3);
    for (const tool of planned) {
      toolsUsed.push(await callTool(tool.id, {}, ctx));
    }
  }

  return {
    toolsUsed,
    data,
    connected,
    status: toolsUsed.some((t) => t.ok) ? 'SUCCESS' : (toolsUsed.length ? 'DEGRADED' : 'NO_TOOLS')
  };
}
