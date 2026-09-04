/**
 * FBT AI / Intent OS — UPGRADE 6
 * Tool Capability Check + Fallback Agent + Error Recovery + Retry Intelligence
 * Spec §17, §18, §30, §31
 */

import { getTool, listTools } from '../toolRegistry.js';

export const ERROR_TYPES = Object.freeze({
  TRANSIENT: 'TRANSIENT',
  INVALID_REQUEST: 'INVALID_REQUEST',
  PERMISSION: 'PERMISSION',
  WALLET: 'WALLET',
  TOOL_UNAVAILABLE: 'TOOL_UNAVAILABLE',
  RISK_VIOLATION: 'RISK_VIOLATION',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  BALANCE_CHANGED: 'BALANCE_CHANGED'
});

export function classifyError(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  if (/network|timeout|temporarily|econn|etimedout|unavailable|rate limit|429|503|502/.test(msg)) return ERROR_TYPES.TRANSIENT;
  if (/invalid|bad request|400|422|missing field|unsupported/.test(msg)) return ERROR_TYPES.INVALID_REQUEST;
  if (/permission|unauthorized|forbidden|401|403|not allowed/.test(msg)) return ERROR_TYPES.PERMISSION;
  if (/wallet|sign|rejected|user denied|locked|no signer/.test(msg)) return ERROR_TYPES.WALLET;
  if (/tool.*not.*found|no.*service|unavailable/.test(msg)) return ERROR_TYPES.TOOL_UNAVAILABLE;
  if (/risk|violation|exposure|limit exceeded/.test(msg)) return ERROR_TYPES.RISK_VIOLATION;
  if (/quote.*expired|price.*changed|slippage/.test(msg)) return ERROR_TYPES.QUOTE_EXPIRED;
  if (/balance.*changed|insufficient|balance.*low/.test(msg)) return ERROR_TYPES.BALANCE_CHANGED;
  return ERROR_TYPES.TRANSIENT;
}

/**
 * Tool Capability Checker — Spec §18
 */
export class ToolCapabilityChecker {
  constructor({ toolRegistry = null, healthChecker = null } = {}) {
    this.toolRegistry = toolRegistry;
    this.healthChecker = healthChecker;
    this.healthCache = new Map();
  }

  /**
   * Full check before execution
   * Does tool exist? Is healthy? Allowed? Supports chain? Asset? User request?
   */
  check({ toolId, chainId = null, asset = null, userRequest = null, context = {} } = {}) {
    const steps = [];

    // 1. Does tool exist?
    const tool = getTool(toolId) || this.toolRegistry?.getTool?.(toolId);
    if (!tool) {
      steps.push({ check: 'EXISTS', ok: false, reason: 'TOOL_NOT_FOUND' });
      return { ok: false, reason: 'TOOL_NOT_FOUND', steps, toolId };
    }
    steps.push({ check: 'EXISTS', ok: true, tool: tool.id });

    // 2. Is tool healthy?
    const health = this.getHealth(toolId);
    if (health && health.status === 'UNAVAILABLE') {
      steps.push({ check: 'HEALTHY', ok: false, reason: 'TOOL_UNHEALTHY', health });
      return { ok: false, reason: 'TOOL_UNHEALTHY', steps, tool, fallback: this.findFallback(tool) };
    }
    steps.push({ check: 'HEALTHY', ok: true });

    // 3. Is tool allowed? (requiresWallet, permissions)
    if (tool.requiresWallet && !context.wallet?.connected && !context.hasWallet) {
      steps.push({ check: 'ALLOWED', ok: false, reason: 'WALLET_REQUIRED' });
      return { ok: false, reason: 'WALLET_REQUIRED', steps, tool };
    }
    steps.push({ check: 'ALLOWED', ok: true });

    // 4. Does it support current chain?
    if (chainId && tool.supportedChains && tool.supportedChains.length) {
      const supported = tool.supportedChains.includes(Number(chainId));
      if (!supported) {
        steps.push({ check: 'CHAIN_SUPPORT', ok: false, reason: 'CHAIN_NOT_SUPPORTED', chainId, supportedChains: tool.supportedChains });
        return { ok: false, reason: 'CHAIN_NOT_SUPPORTED', steps, tool, fallback: this.findFallback(tool, { chainId }) };
      }
    }
    steps.push({ check: 'CHAIN_SUPPORT', ok: true, chainId });

    // 5. Does it support asset?
    if (asset && tool.supportedAssets && tool.supportedAssets.length) {
      const supported = tool.supportedAssets.includes(String(asset).toUpperCase());
      if (!supported) {
        steps.push({ check: 'ASSET_SUPPORT', ok: false, reason: 'ASSET_NOT_SUPPORTED', asset });
        return { ok: false, reason: 'ASSET_NOT_SUPPORTED', steps, tool };
      }
    }
    steps.push({ check: 'ASSET_SUPPORT', ok: true, asset });

    // 6. Does it support user request? (basic)
    if (userRequest && tool.capabilities) {
      // Simple heuristic — if request contains keywords not in capabilities, still allow
      steps.push({ check: 'REQUEST_SUPPORT', ok: true });
    } else {
      steps.push({ check: 'REQUEST_SUPPORT', ok: true });
    }

    return { ok: true, tool, steps };
  }

  getHealth(toolId) {
    return this.healthCache.get(toolId) || { status: 'UNKNOWN' };
  }

  setHealth(toolId, health) {
    this.healthCache.set(toolId, { ...health, at: Date.now() });
  }

  findFallback(failedTool, { chainId = null } = {}) {
    const all = listTools();
    const sameCategory = all.filter((t) => t.category === failedTool.category && t.id !== failedTool.id);
    if (chainId) {
      const chainSupported = sameCategory.filter((t) => !t.supportedChains || t.supportedChains.includes(Number(chainId)));
      if (chainSupported.length) return chainSupported[0];
    }
    return sameCategory[0] || null;
  }

  /**
   * Retry Intelligence — Spec §31
   * Transient → Retry
   * Invalid → Fix request
   * Permission → Ask user
   * Wallet → Reconnect / refresh
   * Tool unavailable → Fallback
   * Risk violation → Stop + explain
   */
  getRetryStrategy(error, { attempt = 0, maxAttempts = 3 } = {}) {
    const type = classifyError(error);
    const base = { errorType: type, attempt, maxAttempts };

    switch (type) {
      case ERROR_TYPES.TRANSIENT:
        return {
          ...base,
          action: attempt < maxAttempts ? 'RETRY' : 'FAIL',
          delayMs: Math.min(1000 * Math.pow(2, attempt), 8000),
          message: attempt < maxAttempts ? 'Retrying...' : 'Failed after retries',
          recoverable: attempt < maxAttempts
        };
      case ERROR_TYPES.INVALID_REQUEST:
        return { ...base, action: 'FIX_REQUEST', recoverable: false, message: 'Fixing request...' };
      case ERROR_TYPES.PERMISSION:
        return { ...base, action: 'ASK_USER', recoverable: true, message: 'Permission needed' };
      case ERROR_TYPES.WALLET:
        return { ...base, action: 'RECONNECT_WALLET', recoverable: true, message: 'Reconnecting wallet...' };
      case ERROR_TYPES.TOOL_UNAVAILABLE:
        return { ...base, action: 'FALLBACK', recoverable: true, message: 'Trying fallback...' };
      case ERROR_TYPES.RISK_VIOLATION:
        return { ...base, action: 'STOP', recoverable: false, message: 'Risk violation — stopping' };
      case ERROR_TYPES.QUOTE_EXPIRED:
        return { ...base, action: 'REFRESH_QUOTE', recoverable: true, delayMs: 500, message: 'Refreshing quote...' };
      case ERROR_TYPES.BALANCE_CHANGED:
        return { ...base, action: 'REFRESH_BALANCE', recoverable: true, delayMs: 500, message: 'Refreshing balances...' };
      default:
        return { ...base, action: attempt < 2 ? 'RETRY' : 'FAIL', recoverable: attempt < 2 };
    }
  }

  /**
   * Error Recovery — Spec §30
   * Smart recovery messages
   */
  getRecoveryMessage(error, { toolId = null, fallback = null } = {}) {
    const type = classifyError(error);
    switch (type) {
      case ERROR_TYPES.TRANSIENT:
        return `${toolId || 'Service'} temporarily unavailable. Retrying...`;
      case ERROR_TYPES.TOOL_UNAVAILABLE:
        return `${toolId || 'Market'} Agent unavailable. Trying secondary data source...`;
      case ERROR_TYPES.QUOTE_EXPIRED:
        return 'Quote expired. Refreshing quote...';
      case ERROR_TYPES.BALANCE_CHANGED:
        return 'Wallet state changed. Refreshing balances...';
      case ERROR_TYPES.WALLET:
        return 'Wallet connection issue. Please reconnect.';
      case ERROR_TYPES.RISK_VIOLATION:
        return 'Operation blocked by risk check. Please review risk parameters.';
      default:
        if (fallback) return `Primary failed, trying fallback: ${fallback.id}`;
        return `Error: ${error?.message || 'Unknown error'}. Attempting recovery...`;
    }
  }
}

// Singleton
let instance = null;
export function getToolChecker() {
  if (!instance) instance = new ToolCapabilityChecker();
  return instance;
}
