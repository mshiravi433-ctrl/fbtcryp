/**
 * FBT AI / Intent OS — UPGRADE 6
 * Main barrel export for all Upgrade 6 modules
 */

export * from './conversationState.js';
export * from './navigationManager.js';
export * from './slotFillingEngine.js';
export * from './referenceResolver.js';
export * from './sharedContext.js';
export * from './orchestratorV2.js';
export * from './walletContextManager.js';
export * from './toolCapabilityChecker.js';
export * from './intentLifecycle.js';
export * from './stateMachine.js';
export * from './observability.js';
export * from './chatScrollManager.js';
export * from './eventBusV2.js';
export * from './memoryV2.js';

// Convenience initializer for Upgrade 6
import { loadConversationState, saveConversationState } from './conversationState.js';
import { getNavigationManager } from './navigationManager.js';
import { getIntentLifecycleManager } from './intentLifecycle.js';
import { getWalletContextManager } from './walletContextManager.js';
import { getObservabilityV2, getQualityMetrics } from './observability.js';
import { getChatScrollManager } from './chatScrollManager.js';
import { getSlotFillingEngine } from './slotFillingEngine.js';
import { getReferenceResolver, getContextualResolver } from './referenceResolver.js';
import { getToolChecker } from './toolCapabilityChecker.js';
import { busV6 } from './eventBusV2.js';

export function initUpgrade6({ sessionId = null, currentRoute = '/intent' } = {}) {
  const conversationState = loadConversationState();
  const navigationManager = getNavigationManager();
  const intentLifecycle = getIntentLifecycleManager();
  const walletManager = getWalletContextManager();
  const observability = getObservabilityV2();
  const qualityMetrics = getQualityMetrics();
  const scrollManager = getChatScrollManager();
  const slotEngine = getSlotFillingEngine();
  const refResolver = getReferenceResolver();
  const ctxResolver = getContextualResolver();
  const toolChecker = getToolChecker();

  // Ensure wallet is global
  walletManager.ensureGlobal();

  return {
    conversationState,
    navigationManager,
    intentLifecycle,
    walletManager,
    observability,
    qualityMetrics,
    scrollManager,
    slotEngine,
    refResolver,
    ctxResolver,
    toolChecker,
    bus: busV6,
    saveState: saveConversationState
  };
}

export function resetUpgrade6() {
  try {
    const { clearConversationState } = require('./conversationState.js');
    clearConversationState();
  } catch {}
  try {
    const { resetNavigationManager } = require('./navigationManager.js');
    resetNavigationManager();
  } catch {}
  try {
    const { resetIntentLifecycleManager } = require('./intentLifecycle.js');
    resetIntentLifecycleManager();
  } catch {}
  try {
    const { resetWalletContextManager } = require('./walletContextManager.js');
    resetWalletContextManager();
  } catch {}
  try {
    const { resetChatScrollManager } = require('./chatScrollManager.js');
    resetChatScrollManager();
  } catch {}
}
