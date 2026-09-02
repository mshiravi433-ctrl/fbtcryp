/**
 * Execute REAL tools for a classified intent before any sentence is generated.
 * Priority: tool result → shared state → cache with freshness → explicit unavailable.
 */

import { getTool, resolveToolsForIntent } from './toolRegistry.js';
import { scanOpportunities } from './opportunityScanner.js';
import { getCentralWalletState, isWalletConnected } from './centralWalletState.js';

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
    const result = await tool.execute(input || {}, ctx);
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
    data.wallet = (await need('wallet.getBalances', { address: walletSnap?.address || walletSnap?.evmAddresses?.[0] })).result;
    data.portfolio = (await need('wallet.getPortfolio', {})).result
      || (await need('portfolio.analysis', { holdings: context.portfolio?.holdings, detailed: true })).result;
  }

  if (['YIELD_DISCOVERY', 'FARM', 'LEND', 'INVESTMENT_PLAN', 'STAKING'].includes(type)) {
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
    data.market = (await need('market.overview', {})).result;
    if (intent?.entities?.token) {
      data.token = (await need('market.tokenDetail', { symbol: intent.entities.token })).result;
    }
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
