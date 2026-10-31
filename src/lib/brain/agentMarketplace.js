/**
 * FBT INTENT OS — AI Agent Marketplace Engine
 * ---------------------------------------------------------------------------
 * Architecture for the decentralized FBT Agent Marketplace.
 *
 * Capabilities:
 *   - Native FBT Agents (Core 10) & External Third-Party Agents
 *   - Connectivity Protocols:
 *       • REST API
 *       • Model Context Protocol (MCP)
 *       • Agent-to-Agent (A2A) protocol
 *   - Developer Registration Portal (Manifest, capabilities, endpoints)
 *   - Pricing Models:
 *       • FREE
 *       • PAY_PER_USE (per task fee)
 *       • MONTHLY_SUBSCRIPTION
 *   - Rating, Verification & Reputation System
 *   - Execution Cost Calculator (Compute tokens + Gas + Platform fee)
 *   - Revenue Sharing Model (85% developer / 15% FBT protocol)
 *   - Security Sandbox & Permission Auditor (fail-closed verification)
 */

export const MARKETPLACE_SCHEMA = 'fbt.agent-marketplace.v1';

export const PRICING_MODELS = Object.freeze({
  FREE: { id: 'FREE', labelFa: 'رایگان', isPaid: false },
  PAY_PER_USE: { id: 'PAY_PER_USE', labelFa: 'پرداخت به‌ازای استفاده', isPaid: true },
  MONTHLY_SUBSCRIPTION: { id: 'MONTHLY_SUBSCRIPTION', labelFa: 'اشتراک ماهانه', isPaid: true }
});

export const PROTOCOL_SUPPORT = Object.freeze({
  REST_API: { id: 'REST_API', label: 'REST API' },
  MCP: { id: 'MCP', label: 'Model Context Protocol (MCP)' },
  A2A: { id: 'A2A', label: 'Agent-to-Agent (A2A)' }
});

export const VERIFICATION_TIERS = Object.freeze({
  OFFICIAL_NATIVE: { id: 'OFFICIAL_NATIVE', labelFa: 'تأییدشده رسمی FBT', trustScore: 98 },
  VERIFIED_DEVELOPER: { id: 'VERIFIED_DEVELOPER', labelFa: 'توسعه‌دهنده ممیزی‌شده', trustScore: 88 },
  COMMUNITY: { id: 'COMMUNITY', labelFa: 'جامعه کاربری (سندباکس)', trustScore: 65 }
});

/**
 * Built-in Agent Catalog (Internal + External Showcase)
 */
export const DEFAULT_MARKETPLACE_CATALOG = Object.freeze([
  {
    id: 'fbt-trading-agent',
    name: 'FBT Smart Trading Agent',
    nameFa: 'ایجنت معاملات هوشمند FBT',
    author: 'FBT Core Lab',
    type: 'NATIVE',
    category: 'TRADING',
    pricing: { model: 'FREE', feeUsd: 0 },
    verification: 'OFFICIAL_NATIVE',
    protocols: ['A2A', 'REST_API', 'MCP'],
    rating: 4.9,
    ratingCount: 1420,
    totalExecutions: 48200,
    descriptionFa: 'مسیریابی هوشمند در صرافی‌های غیرمتمرکز، کمترین اسلیپیج و حفاظت در برابر ساندویچ اتک MEV.',
    declaredTools: ['dex_quote', 'dex_swap', 'gas_estimate', 'mev_protect'],
    canExecute: true
  },
  {
    id: 'fbt-portfolio-manager',
    name: 'FBT Autonomous Portfolio Manager',
    nameFa: 'مدیر خودکار پرتفوی FBT',
    author: 'FBT Core Lab',
    type: 'NATIVE',
    category: 'PORTFOLIO',
    pricing: { model: 'FREE', feeUsd: 0 },
    verification: 'OFFICIAL_NATIVE',
    protocols: ['A2A', 'REST_API'],
    rating: 4.8,
    ratingCount: 980,
    totalExecutions: 31000,
    descriptionFa: 'مدیریت و متعادل‌سازی خودکار دارایی‌ها بر اساس اهداف مالی و محاسبات ماتریس همبستگی و VaR.',
    declaredTools: ['portfolio_scan', 'correlation_matrix', 'drift_detect', 'allocation_optimize'],
    canExecute: true
  },
  {
    id: 'fbt-smart-money-radar',
    name: 'Smart Money & Whale Flow Agent',
    nameFa: 'ایجنت رهگیری پول هوشمند و نهنگ‌ها',
    author: 'FBT Core Lab',
    type: 'NATIVE',
    category: 'INTELLIGENCE',
    pricing: { model: 'FREE', feeUsd: 0 },
    verification: 'OFFICIAL_NATIVE',
    protocols: ['A2A', 'REST_API'],
    rating: 4.9,
    ratingCount: 1850,
    totalExecutions: 52100,
    descriptionFa: 'رصد لحظه‌ای آدرس‌های سودده، انباشت نهنگ‌ها و تحلیل جریان نقدینگی ورودی و خروجی صرافی‌ها.',
    declaredTools: ['whale_flow_tracker', 'smart_wallet_indexer', 'accumulation_detector'],
    canExecute: false
  },
  {
    id: 'ext-quant-sentiment-pro',
    name: 'Quant Sentiment & Social Drift',
    nameFa: 'تحلیلگر تمایلات اجتماعی و احساسات کوانت',
    author: 'AlphaNode Labs (Community)',
    type: 'EXTERNAL',
    category: 'RESEARCH',
    pricing: { model: 'PAY_PER_USE', feeUsd: 0.05 },
    verification: 'VERIFIED_DEVELOPER',
    protocols: ['MCP', 'REST_API'],
    rating: 4.7,
    ratingCount: 310,
    totalExecutions: 8400,
    descriptionFa: 'واکاوی شبکه‌های اجتماعی، فاندینگ ریت، حجم بحث‌های پیرامون توکن‌ها و تمایلات بازار با پروتکل MCP.',
    declaredTools: ['sentiment_scan', 'social_drift_query'],
    canExecute: false
  },
  {
    id: 'ext-solana-sniper-protect',
    name: 'Solana Dex Sniper Shield',
    nameFa: 'سپر محافظتی سواپ سولانا و ری‌پول',
    author: 'SolGuard Security (External)',
    type: 'EXTERNAL',
    category: 'SECURITY',
    pricing: { model: 'MONTHLY_SUBSCRIPTION', feeUsd: 9.99 },
    verification: 'VERIFIED_DEVELOPER',
    protocols: ['A2A', 'REST_API'],
    rating: 4.6,
    ratingCount: 195,
    totalExecutions: 4200,
    descriptionFa: 'بررسی امنیتی استخرهای نقدینگی تازه متولد شده، درصد قفل نقدینگی و تشخیص کلاهبرداری راگ‌پول در سولانا.',
    declaredTools: ['token_profile_query', 'rug_check_scan'],
    canExecute: false
  }
]);

/**
 * AI Agent Marketplace Manager
 */
export class AgentMarketplaceManager {
  constructor(initialCatalog = DEFAULT_MARKETPLACE_CATALOG) {
    this.catalog = new Map();
    this.userSubscriptions = new Map(); // agentId -> { subscribedAt, expiresAt }
    this.registeredDevelopers = new Map();

    initialCatalog.forEach((agent) => {
      this.catalog.set(agent.id, { ...agent });
    });
  }

  listAgents({ category = null, type = null, maxPrice = null } = {}) {
    let list = Array.from(this.catalog.values());
    if (category) list = list.filter((a) => a.category === category);
    if (type) list = list.filter((a) => a.type === type);
    if (maxPrice !== null) list = list.filter((a) => (a.pricing?.feeUsd || 0) <= maxPrice);
    return list;
  }

  getAgent(agentId) {
    return this.catalog.get(agentId) || null;
  }

  /**
   * Developer Agent Registration
   */
  registerDeveloperAgent({
    id,
    name,
    nameFa,
    author,
    developerAddress,
    category = 'RESEARCH',
    descriptionFa,
    pricing = { model: 'FREE', feeUsd: 0 },
    protocols = ['REST_API', 'MCP'],
    endpointUrl,
    declaredTools = []
  } = {}) {
    if (!id || !name || !author) {
      return { ok: false, error: 'MISSING_REQUIRED_AGENT_MANIFEST_FIELDS' };
    }

    if (this.catalog.has(id)) {
      return { ok: false, error: `AGENT_ID_ALREADY_EXISTS: ${id}` };
    }

    // Security sanitization: external agents can NEVER declare raw private keys or custody
    const forbiddenTools = ['private_key_export', 'custodial_hold', 'raw_seed_access'];
    const hasForbidden = declaredTools.some((t) => forbiddenTools.includes(t));
    if (hasForbidden) {
      return { ok: false, error: 'SECURITY_VIOLATION: Forbidden custodial tools declared.' };
    }

    const newAgent = {
      id,
      name,
      nameFa: nameFa || name,
      author,
      developerAddress: developerAddress || '0x0000000000000000000000000000000000000000',
      type: 'EXTERNAL',
      category,
      pricing: {
        model: pricing.model || 'FREE',
        feeUsd: Number(pricing.feeUsd || 0)
      },
      verification: 'COMMUNITY',
      protocols: protocols || ['REST_API'],
      endpointUrl,
      declaredTools,
      rating: 5.0,
      ratingCount: 1,
      totalExecutions: 0,
      descriptionFa: descriptionFa || 'ایجنت توسعه‌دهنده متصل به FBT Intent OS.',
      canExecute: false, // External agents advise or vote, never hold custody
      registeredAt: Date.now()
    };

    this.catalog.set(id, newAgent);

    return {
      ok: true,
      agentId: id,
      agent: newAgent,
      status: 'REGISTERED_IN_SANDBOX'
    };
  }

  /**
   * Pre-execution Security & Permission Audit
   * Ensures permissions, identity, tools, and access levels are safe before invocation
   */
  auditAgentPreExecution(agentId, requestedTools = [], userPermissions = {}) {
    const agent = this.getAgent(agentId);
    if (!agent) {
      return { ok: false, verdict: 'REJECTED', reason: 'AGENT_NOT_FOUND' };
    }

    const declaredSet = new Set(agent.declaredTools || []);
    const unauthorizedTools = requestedTools.filter((t) => !declaredSet.has(t));
    if (unauthorizedTools.length > 0) {
      return {
        ok: false,
        verdict: 'BLOCKED',
        reason: `UNDECLARED_TOOLS_ATTEMPTED: ${unauthorizedTools.join(', ')}`
      };
    }

    // External agents cannot directly trigger mutating blockchain executions without user confirmation
    if (agent.type === 'EXTERNAL' && requestedTools.includes('dex_swap') && !userPermissions.explicitConsent) {
      return {
        ok: false,
        verdict: 'REQUIRE_CONSENT',
        reason: 'EXTERNAL_AGENT_CANNOT_EXECUTE_SWAP_WITHOUT_EXPLICIT_CONSENT'
      };
    }

    return {
      ok: true,
      verdict: 'APPROVED',
      trustScore: VERIFICATION_TIERS[agent.verification]?.trustScore || 60,
      sandboxActive: agent.type === 'EXTERNAL'
    };
  }

  /**
   * Execution Cost & Revenue Sharing Calculator
   * 85% to developer, 15% to FBT Protocol
   */
  calculateExecutionCost(agentId, computeUnits = 100) {
    const agent = this.getAgent(agentId);
    if (!agent) return { error: 'AGENT_NOT_FOUND' };

    const baseFeeUsd = agent.pricing?.feeUsd || 0;
    const computeCostUsd = Math.round((computeUnits * 0.0001) * 1000) / 1000;
    const totalCostUsd = Math.round((baseFeeUsd + computeCostUsd) * 1000) / 1000;

    const developerShareUsd = Math.round((baseFeeUsd * 0.85) * 1000) / 1000;
    const protocolFeeUsd = Math.round((baseFeeUsd * 0.15) * 1000) / 1000;

    return {
      agentId,
      pricingModel: agent.pricing?.model,
      totalCostUsd,
      baseFeeUsd,
      computeCostUsd,
      revenueSharing: {
        developerShareUsd,
        developerSharePct: 85,
        protocolFeeUsd,
        protocolFeePct: 15
      }
    };
  }

  /**
   * Record task execution & increment reputation
   */
  recordExecution(agentId, success = true) {
    const agent = this.getAgent(agentId);
    if (agent) {
      agent.totalExecutions = (agent.totalExecutions || 0) + 1;
    }
  }
}

export const agentMarketplace = new AgentMarketplaceManager();
