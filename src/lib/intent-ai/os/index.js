/**
 * FBT INTENT OS — Universal AI Operating Agent
 * ---------------------------------------------------------------------------
 * Spec §38 Final Universal Architecture
 * 
 *                     USER
 *                       │
 *                       ▼
 *                 INTENT AI
 *                       │
 *               ┌───────┴───────┐
 *               ▼               ▼
 *         CONTEXT ENGINE    MEMORY ENGINE
 *               │               │
 *               └───────┬───────┘
 *                       ▼
 *                ORCHESTRATOR
 *                       │
 *         ┌─────────────┼─────────────┐
 *         ▼             ▼             ▼
 *       AGENTS         TOOLS       NAVIGATION
 *         │             │             │
 *         └─────────────┼─────────────┘
 *                       ▼
 *                   ACTION BUS
 *                       │
 *           ┌───────────┼────────────┐
 *           ▼           ▼            ▼
 *        WALLET      FINANCE       APP
 *           │           │            │
 *           ▼           ▼            ▼
 *      BLOCKCHAIN     PROTOCOLS    PAGES
 *           │           │            │
 *           └───────────┼────────────┘
 *                       ▼
 *                   VERIFIER
 *                       │
 *                       ▼
 *                     MEMORY
 *                       │
 *                       ▼
 *                HUMAN RESPONSE
 */

export { APP_CAPABILITIES, getCapability, getCapabilitiesByRoute, getCapabilitiesByCategory, CAPABILITY_HIERARCHY } from './appCapabilities.js';

export {
  listTools,
  getTool,
  getToolsByCategory,
  getToolsByCapability,
  resolveToolsForIntent,
  getRelevantToolsForMessage,
  validateToolInput,
  INTENT_TO_CATEGORIES
} from './toolRegistry.js';

export {
  understandIntent,
  extractNavigationIntent,
  INTENT_TYPES,
  ACCEPTANCE_TESTS,
  runAcceptanceTests
} from './intentUnderstanding.js';

export {
  buildContext,
  updateContext,
  getCurrentPageContext,
  isFollowUpToCurrentPage,
  clearContextCache
} from './contextEngine.js';

export {
  createMemory,
  getWorkingMemory,
  addWorkingMemory,
  getSessionMemory,
  addSessionMemory,
  getLongTermMemory,
  addLongTermMemory,
  searchMemory,
  extractPreferenceFromMessage,
  learnFromInteraction,
  getAllMemory,
  MEMORY_TYPES
} from './memoryEngine.js';

export {
  createActionMemory,
  saveActionMemory,
  getActionMemories,
  getLastActionForIntent
} from './actionMemory.js';

export {
  emitEvent,
  onEvent,
  offEvent,
  getEventHistory,
  EVENTS,
  dispatchAction,
  registerActionHandler,
  actionBus,
  setupGlobalBus
} from './eventBus.js';

export { createAgentLoop, LOOP_STATES } from './agentLoop.js';
export { createOrchestrator } from './orchestrator.js';
export { getSuggestionsForIntent, getSuggestionsForMessage } from './suggestionEngine.js';
export { createTask, saveTask, getTask, getActiveTasks, getLastActiveTask, updateTaskStatus, resumeTask } from './taskContinuity.js';
export { createFinancialAgent } from './financialAgent.js';
export { logTask, getLogs, getStats } from './observability.js';
export { formatHumanResponse, stripInternalLeaks } from './humanResponse.js';
export { buildUniversalWalletContext } from './walletContext.js';
export { sanitizeForAI, assertNoSecrets, getSafeWalletContext } from './security.js';
export { parallelFetch, buildLazyContext, getRequiredContextKeys } from './performance.js';
export { logDebugEntry, getDebugHistory, createDebugView } from './debugDashboard.js';
export { createProactiveAgent } from './proactiveAgent.js';
export { initAppIntegration, getProactiveOpportunities } from './appIntegration.js';

// Agents
export { createIntentAgent } from './agents/intentAgent.js';
export { createPortfolioAgent } from './agents/portfolioAgent.js';
export { createMarketAgent } from './agents/marketAgent.js';
export { createTradingAgent } from './agents/tradingAgent.js';
export { createWalletAgent } from './agents/walletAgent.js';
export { createYieldAgent } from './agents/yieldAgent.js';
export { createResearchAgent } from './agents/researchAgent.js';
export { createNavigationAgent } from './agents/navigationAgent.js';
export { createMediaAgent } from './agents/mediaAgent.js';
export { createRiskAgent } from './agents/riskAgent.js';
export { createExecutionAgent, createVerificationAgent, createSelfHealing } from './agents/executionAgent.js';

// Main Intent OS class
import { understandIntent as parseIntent } from './intentUnderstanding.js';
import { buildContext, getCurrentPageContext } from './contextEngine.js';
import { searchMemory, addWorkingMemory, createMemory, extractPreferenceFromMessage, addLongTermMemory } from './memoryEngine.js';
import { resolveToolsForIntent } from './toolRegistry.js';
import { createOrchestrator as makeOrchestrator } from './orchestrator.js';
import { createAgentLoop as makeAgentLoop } from './agentLoop.js';
import { createIntentAgent } from './agents/intentAgent.js';
import { createPortfolioAgent } from './agents/portfolioAgent.js';
import { createMarketAgent } from './agents/marketAgent.js';
import { createTradingAgent } from './agents/tradingAgent.js';
import { createWalletAgent } from './agents/walletAgent.js';
import { createYieldAgent } from './agents/yieldAgent.js';
import { createResearchAgent } from './agents/researchAgent.js';
import { createNavigationAgent } from './agents/navigationAgent.js';
import { createMediaAgent } from './agents/mediaAgent.js';
import { createRiskAgent } from './agents/riskAgent.js';
import { createExecutionAgent, createVerificationAgent, createSelfHealing } from './agents/executionAgent.js';
import { createFinancialAgent } from './financialAgent.js';
import { formatHumanResponse } from './humanResponse.js';
import { getSuggestionsForIntent } from './suggestionEngine.js';
import { logTask } from './observability.js';
import { createTask, saveTask, updateTaskStatus } from './taskContinuity.js';
import { logDebugEntry, createDebugView } from './debugDashboard.js';
import { saveActionMemory, createActionMemory } from './actionMemory.js';

export function createIntentOS({ services = {}, navigation = null, eventBus = null, locale = 'fa' } = {}) {
  // Create agents with services
  const agents = {
    'intent-agent': createIntentAgent(),
    'portfolio-agent': createPortfolioAgent({
      portfolioService: services.portfolioService,
      riskService: services.riskService,
      marketService: services.marketService
    }),
    'market-agent': createMarketAgent({
      marketService: services.marketService,
      signalsService: services.signalsService,
      smartMoneyService: services.smartMoneyService,
      whaleService: services.whaleService
    }),
    'trading-agent': createTradingAgent({
      swapService: services.swapService,
      bridgeService: services.bridgeService,
      ordersService: services.ordersService
    }),
    'wallet-agent': createWalletAgent({
      walletService: services.walletService,
      solanaService: services.solanaService
    }),
    'yield-agent': createYieldAgent({
      yieldService: services.yieldService,
      farmService: services.farmService,
      lendingService: services.lendingService
    }),
    'research-agent': createResearchAgent({
      newsService: services.newsService,
      marketService: services.marketService
    }),
    'navigation-agent': createNavigationAgent({
      navigateFn: navigation?.navigate || null,
      eventBus
    }),
    'media-agent': createMediaAgent({
      audioService: services.audioService,
      navigation,
      eventBus
    }),
    'risk-agent': createRiskAgent({
      riskService: services.riskService
    }),
    'execution-agent': createExecutionAgent({
      toolRegistry: { getTool: (id) => null, getToolsByCapability: () => [] },
      actionBus: eventBus
    }),
    'verification-agent': createVerificationAgent()
  };
  
  const financialAgent = createFinancialAgent({
    portfolioAgent: agents['portfolio-agent'],
    riskAgent: agents['risk-agent'],
    marketAgent: agents['market-agent'],
    yieldAgent: agents['yield-agent'],
    tradingAgent: agents['trading-agent']
  });
  
  agents['financial-agent'] = financialAgent;
  
  const orchestrator = makeOrchestrator({
    agents,
    toolRegistry: { resolveToolsForIntent },
    eventBus
  });
  
  const selfHealing = createSelfHealing({
    executionAgent: agents['execution-agent'],
    toolRegistry: { getToolsByCapability: () => [] }
  });
  
  const agentLoop = makeAgentLoop({
    intentAgent: agents['intent-agent'],
    orchestrator,
    executionAgent: agents['execution-agent'],
    verificationAgent: agents['verification-agent'],
    memoryEngine: {
      searchMemory,
      saveActionMemory: (m) => saveActionMemory(createActionMemory(m))
    },
    eventBus,
    contextEngine: { updateContext: async (ctx, res) => ({ ...ctx, lastResult: res }) }
  });
  
  return {
    agents,
    orchestrator,
    agentLoop,
    financialAgent,
    
    /**
     * Main entry: User Intent → Understand → Retrieve Context → Select Tools → Plan → Execute → Observe → Continue → Complete
     * Spec §5
     */
    async process({ message, context = {}, currentPage = '/', conversation = [] } = {}) {
      const start = Date.now();
      const task = createTask({ intent: message, plan: null, context: { currentPage } });
      saveTask(task);
      
      try {
        // 1. Build context (Spec §6 + §7 current page awareness)
        const pageCtx = getCurrentPageContext(currentPage);
        const fullContext = await buildContext({
          userId: context.userId || 'anon',
          sessionId: context.sessionId || null,
          currentPage,
          currentRoute: currentPage,
          currentTab: pageCtx.tab,
          walletState: context.wallet || context.walletState || null,
          portfolioState: context.portfolio || null,
          conversation,
          memory: searchMemory({ query: message, topK: 8 }),
          services,
          locale
        });
        
        // 2. Understand intent
        const intent = parseIntent(message, fullContext);
        
        // 3. Check for preference learning
        const pref = extractPreferenceFromMessage(message);
        if (pref) addLongTermMemory(pref);
        
        // 4. Add to working memory
        addWorkingMemory(createMemory({
          type: 'conversation',
          content: message,
          importance: 0.6,
          metadata: { intentType: intent.type, page: currentPage }
        }));
        
        // 5. Resolve tools (hierarchical)
        const tools = resolveToolsForIntent(intent.type, fullContext);
        
        // 6. Route to agents
        const routing = await orchestrator.routeToAgents(intent, fullContext);
        
        // 7. Build plan
        const plan = await orchestrator.plan({ intent, context: fullContext });
        
        // 8. If read-only or navigation, execute directly (no confirmation)
        let result = null;
        let status = 'COMPLETED';
        
        if (intent.type === 'NAVIGATION' || intent.navigation) {
          const navAgent = agents['navigation-agent'];
          result = await navAgent.handleIntent(intent, fullContext);
          status = result.ok ? 'COMPLETED' : 'FAILED';
        } else if (intent.type === 'OPEN_CALM' || intent.type === 'PLAY_MUSIC') {
          const mediaAgent = agents['media-agent'];
          result = await mediaAgent.handleIntent(intent, { ...fullContext, locale });
          // Also navigate
          await agents['navigation-agent'].navigate({ route: '/explore' });
          status = result.ok ? 'COMPLETED' : 'FAILED';
        } else if (plan.readOnly || plan.actions.length === 0) {
          // Analysis tasks — gather from agents
          const agentResults = {};
          
          for (const agentId of routing.agents) {
            const agent = agents[agentId];
            if (agent?.handleIntent) {
              try {
                const r = await agent.handleIntent(intent, fullContext);
                agentResults[agentId] = r;
              } catch (e) {
                agentResults[agentId] = { ok: false, error: e.message };
              }
            }
          }
          
          // Financial agent for investment plans
          if (intent.type === 'INVESTMENT_PLAN' || intent.type === 'GOAL') {
            try {
              const fin = await financialAgent.handleIntent(intent, fullContext);
              agentResults['financial-agent'] = fin;
            } catch {}
          }
          
          result = agentResults;
        } else {
          // Financial — needs confirmation, return plan for UI to confirm
          status = 'NEEDS_CONFIRMATION';
          result = { plan, requiresConfirmation: true };
        }
        
        // 9. Human response (Spec §25)
        const humanMessage = formatHumanResponse({
          intent,
          result: result['portfolio-agent'] || result['financial-agent'] || result || plan,
          context: fullContext,
          locale
        });
        
        // 10. Dynamic suggestions (Spec §17)
        const suggestions = getSuggestionsForIntent(intent.type, { ...fullContext, currentPage }, intent.entities || {});
        
        // 11. Observability (Spec §34)
        const latency = Date.now() - start;
        logTask({
          taskId: task.id,
          intent,
          tools: tools.map(t => t.id),
          latency,
          status,
          errors: [],
          retries: 0,
          provider: null,
          result,
          context: fullContext
        });
        
        // 12. Debug view (Spec §35)
        const debugView = createDebugView({
          intent,
          context: fullContext,
          selectedAgents: routing.agents,
          selectedTools: tools,
          executionGraph: plan,
          memoryUsed: fullContext.memory || [],
          apiCalls: [],
          latency,
          errors: [],
          finalResult: result
        });
        logDebugEntry(debugView);
        
        // 13. Update task
        updateTaskStatus(task.id, status, { result, intent });
        
        // 14. Save action memory
        saveActionMemory(createActionMemory({
          intent,
          tools: tools.map(t => t.id),
          inputs: intent.entities || {},
          result,
          status,
          duration: latency,
          route: currentPage
        }));
        
        return {
          ok: true,
          taskId: task.id,
          intent,
          context: fullContext,
          plan,
          result,
          message: humanMessage,
          suggestions,
          requiresConfirmation: status === 'NEEDS_CONFIRMATION',
          readOnly: plan.readOnly,
          status,
          latency,
          debug: debugView
        };
        
      } catch (err) {
        const latency = Date.now() - start;
        logTask({
          taskId: task.id,
          intent: message,
          tools: [],
          latency,
          status: 'FAILED',
          errors: [err.message],
          retries: 0,
          result: null,
          context: { currentPage }
        });
        
        updateTaskStatus(task.id, 'FAILED', { error: err.message });
        
        return {
          ok: false,
          taskId: task.id,
          error: err.message,
          message: locale.startsWith('fa') ? 'خطایی رخ داد. لطفاً دوباره تلاش کنید.' : 'An error occurred. Please try again.',
          status: 'FAILED',
          latency
        };
      }
    },
    
    // For confirmation flow (Spec §26)
    async confirmAndExecute({ taskId, plan, context = {} } = {}) {
      const start = Date.now();
      
      try {
        // Execute plan
        const executionAgent = agents['execution-agent'];
        const verificationAgent = agents['verification-agent'];
        
        let result = null;
        if (executionAgent.executePlan) {
          result = await executionAgent.executePlan({ actions: plan.actions, context });
        }
        
        // Verify (Spec §32)
        let verification = null;
        if (verificationAgent.verify && result) {
          verification = await verificationAgent.verify({
            expected: plan.expected,
            actual: result,
            actionId: taskId
          });
        }
        
        // Only say success after verification
        const ok = verification ? verification.ok : result?.ok;
        
        const latency = Date.now() - start;
        logTask({
          taskId,
          intent: plan.intent,
          tools: plan.actions?.map(a => a.toolId) || [],
          latency,
          status: ok ? 'CONFIRMED' : 'FAILED',
          errors: [],
          retries: 0,
          result,
          context
        });
        
        updateTaskStatus(taskId, ok ? 'COMPLETED' : 'FAILED', { result, verification });
        
        saveActionMemory(createActionMemory({
          intent: plan.intent,
          tools: plan.actions?.map(a => a.toolId) || [],
          inputs: plan.actions?.[0]?.input || {},
          result,
          status: ok ? 'completed' : 'failed',
          duration: latency
        }));
        
        return {
          ok,
          taskId,
          result,
          verification,
          status: verification?.status || (ok ? 'CONFIRMED' : 'FAILED'),
          message: ok
            ? (context.locale?.startsWith('fa') ? 'با موفقیت انجام شد.' : 'Successfully completed.')
            : (context.locale?.startsWith('fa') ? 'انجام نشد.' : 'Failed to complete.')
        };
        
      } catch (err) {
        return {
          ok: false,
          taskId,
          error: err.message,
          status: 'FAILED'
        };
      }
    }
  };
}

export const intentOS = createIntentOS();
