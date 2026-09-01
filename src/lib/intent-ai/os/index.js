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
 *
 * Goal: FBT Intent OS = AI Brain + Memory + Context + Tools + Agents + App Control + Wallet + Protocols + Execution + Verification
 */

// Core
export * from './appCapabilities.js';
export * from './toolRegistry.js';
export * from './intentUnderstanding.js';
export * from './contextEngine.js';
export * from './eventBus.js';
export * from './serviceAdapters.js';
export * from './appIntegration.js';
export * from './performance.js';
export * from './proactiveAgent.js';

// Memory
export * as memoryEngine from './memoryEngine.js';
export * as actionMemory from './actionMemory.js';
export * from './memoryEngine.js';
export * from './actionMemory.js';

// Agents
export * as navigationAgent from './agents/navigationAgent.js';
export * as mediaAgent from './agents/mediaAgent.js';
export * as walletAgent from './agents/walletAgent.js';
export * as portfolioAgent from './agents/portfolioAgent.js';
export * as marketAgent from './agents/marketAgent.js';
export * as tradingAgent from './agents/tradingAgent.js';
export * as yieldAgent from './agents/yieldAgent.js';
export * as researchAgent from './agents/researchAgent.js';
export * as riskAgent from './agents/riskAgent.js';
export * as executionAgent from './agents/executionAgent.js';
export * as intentAgent from './agents/intentAgent.js';

// Orchestration
export * from './agentLoop.js';
export * from './orchestrator.js';
export * from './suggestionEngine.js';
export * from './taskContinuity.js';
export * from './financialAgent.js';
export * from './humanResponse.js';
export * from './walletContext.js';
export * from './observability.js';
export * from './security.js';
export * from './debugDashboard.js';

import { understandIntent } from './intentUnderstanding.js';
import { buildContext, updateContext, getCurrentPageContext } from './contextEngine.js';
import { resolveToolsForIntent, getTool } from './toolRegistry.js';
import { searchMemory, getAllMemory, addWorkingMemory, addSessionMemory, addLongTermMemory, createMemory, extractPreferenceFromMessage } from './memoryEngine.js';
import { saveActionMemory, createActionMemory } from './actionMemory.js';
import { createNavigationAgent } from './agents/navigationAgent.js';
import { createMediaAgent } from './agents/mediaAgent.js';
import { createWalletAgent } from './agents/walletAgent.js';
import { createPortfolioAgent } from './agents/portfolioAgent.js';
import { createMarketAgent } from './agents/marketAgent.js';
import { createTradingAgent } from './agents/tradingAgent.js';
import { createYieldAgent } from './agents/yieldAgent.js';
import { createResearchAgent } from './agents/researchAgent.js';
import { createRiskAgent } from './agents/riskAgent.js';
import { createExecutionAgent, createVerificationAgent, createSelfHealing } from './agents/executionAgent.js';
import { createIntentAgent } from './agents/intentAgent.js';
import { createAgentLoop } from './agentLoop.js';
import { createOrchestrator } from './orchestrator.js';
import { getSuggestionsForIntent } from './suggestionEngine.js';
import { createTask, saveTask, updateTaskStatus, getLastActiveTask } from './taskContinuity.js';
import { createFinancialAgent } from './financialAgent.js';
import { formatResponse, stripInternalLeaks } from './humanResponse.js';
import { createProactiveAgent } from './proactiveAgent.js';
import { buildUniversalWalletContext } from './walletContext.js';
import { logTask } from './observability.js';
import { captureDebug } from './debugDashboard.js';
import { emitEvent, dispatchAction, actionBus } from './eventBus.js';
import { createRealServices } from './serviceAdapters.js';

/**
 * Create full Intent OS instance
 * Wired to real services, not mocks (per final instruction)
 */
export function createIntentOS({
  services = {},
  navigation = null,
  walletState = null,
  currentPage = '/',
  locale = 'fa',
  eventBus = null
} = {}) {
  // Use real services if not provided
  const realServices = Object.keys(services).length ? services : createRealServices({ wallet: walletState });

  // Agents with real services
  const navAgent = createNavigationAgent({ navigateFn: navigation?.navigate, eventBus: eventBus || { emit: emitEvent } });
  const medAgent = createMediaAgent({ audioService: realServices.audio || realServices.audioService, navigation, eventBus: eventBus || { emit: emitEvent } });
  const walAgent = createWalletAgent({ walletService: realServices.wallet || realServices.walletService, solanaService: realServices.solana, eventBus: eventBus || { emit: emitEvent } });
  const portAgent = createPortfolioAgent({ portfolioService: realServices.portfolio || realServices.portfolioService, riskService: realServices.risk, marketService: realServices.market || realServices.marketService, eventBus: eventBus || { emit: emitEvent } });
  const mktAgent = createMarketAgent({ marketService: realServices.market || realServices.marketService, signalsService: realServices.signals || realServices.signalsService, smartMoneyService: realServices.smartMoney || realServices.smartMoneyService, whaleService: realServices.whale || realServices.whaleService, eventBus: eventBus || { emit: emitEvent } });
  const tradeAgent = createTradingAgent({ swapService: realServices.swap || realServices.swapService, bridgeService: realServices.bridge || realServices.bridgeService, ordersService: realServices.orders || realServices.ordersService, eventBus: eventBus || { emit: emitEvent } });
  const yldAgent = createYieldAgent({ yieldService: realServices.yield || realServices.yieldService, farmService: realServices.farm || realServices.farmService, lendingService: realServices.lending || realServices.lendingService, eventBus: eventBus || { emit: emitEvent } });
  const resAgent = createResearchAgent({ newsService: realServices.news || realServices.newsService, marketService: realServices.market || realServices.marketService, eventBus: eventBus || { emit: emitEvent } });
  const rskAgent = createRiskAgent({ riskService: realServices.risk || realServices.riskService, eventBus: eventBus || { emit: emitEvent } });
  const intAgent = createIntentAgent();
  const execAgent = createExecutionAgent({ toolRegistry: { getTool, resolveToolsForIntent }, actionBus, eventBus: eventBus || { emit: emitEvent } });
  const verifyAgent = createVerificationAgent();
  const finAgent = createFinancialAgent({ portfolioAgent: portAgent, riskAgent: rskAgent, marketAgent: mktAgent, yieldAgent: yldAgent, tradingAgent: tradeAgent });
  const proactive = createProactiveAgent({ eventBus: eventBus || { emit: emitEvent } });
  
  const agents = {
    'intent-agent': intAgent,
    'navigation-agent': navAgent,
    'media-agent': medAgent,
    'wallet-agent': walAgent,
    'portfolio-agent': portAgent,
    'market-agent': mktAgent,
    'trading-agent': tradeAgent,
    'yield-agent': yldAgent,
    'research-agent': resAgent,
    'risk-agent': rskAgent,
    'execution-agent': execAgent,
    'verification-agent': verifyAgent,
    'financial-agent': finAgent
  };
  
  const orchestrator = createOrchestrator({ agents, toolRegistry: { resolveToolsForIntent, getTool }, eventBus: eventBus || { emit: emitEvent } });
  const loop = createAgentLoop({
    intentAgent: intAgent,
    contextEngine: { updateContext },
    orchestrator,
    executionAgent: execAgent,
    verificationAgent: verifyAgent,
    memoryEngine: { searchMemory, saveActionMemory },
    eventBus: eventBus || { emit: emitEvent }
  });
  
  return {
    // Core
    understandIntent,
    buildContext,
    resolveToolsForIntent,
    getTool,
    
    // Agents
    agents,
    orchestrator,
    loop,
    proactive,
    execAgent,
    verifyAgent,
    finAgent,
    
    // Services
    services: realServices,
    
    // Memory
    memory: {
      search: searchMemory,
      getAll: getAllMemory,
      addWorking: addWorkingMemory,
      addSession: addSessionMemory,
      addLongTerm: addLongTermMemory,
      create: createMemory,
      extractPreference: extractPreferenceFromMessage,
      saveAction: saveActionMemory,
      createAction: createActionMemory
    },
    
    // Tasks
    tasks: {
      create: createTask,
      save: saveTask,
      updateStatus: updateTaskStatus,
      getLastActive: getLastActiveTask
    },
    
    // Wallet
    buildWalletContext: buildUniversalWalletContext,
    
    // Response
    formatResponse,
    stripInternalLeaks,
    getSuggestions: getSuggestionsForIntent,
    
    // Observability
    logTask,
    captureDebug,
    
    // Event & Action Bus
    emitEvent,
    dispatchAction,
    actionBus,
    
    // Main entry: USER → INTENT AI → ... → HUMAN RESPONSE
    async process({ message, context = {}, services: svc = {} } = {}) {
      const start = Date.now();
      const mergedServices = { ...realServices, ...svc };
      
      // 1. Build context (Spec §6) — parallel, lazy, cached
      const fullContext = await buildContext({
        currentPage: context.currentPage || currentPage,
        currentRoute: context.currentRoute || currentPage,
        walletState: context.walletState || walletState,
        portfolioState: context.portfolioState || null,
        conversation: context.conversation || [],
        memory: context.memory || [],
        services: mergedServices,
        locale: context.locale || locale,
        userId: context.userId || null,
        sessionId: context.sessionId || null
      });
      
      // 2. Understand intent
      const intent = understandIntent(message, fullContext);
      
      // 3. Memory retrieval (topK 8)
      const memories = searchMemory({ query: `${intent.type} ${message}`, topK: 8 });
      fullContext.relevantMemories = memories;
      
      // 4. Check for preference learning
      const pref = extractPreferenceFromMessage(message);
      if (pref) {
        addLongTermMemory(pref);
      }
      
      // 5. Task continuity — check if this is "execute this" referring to current page
      const pageCtx = getCurrentPageContext(fullContext.currentPage);
      const lastTask = getLastActiveTask();
      if ((intent.type === 'EXECUTE_CURRENT' || intent.type === 'CONTINUE') && lastTask) {
        fullContext.lastTask = lastTask;
      }
      fullContext.currentPageMeta = pageCtx;
      
      // 6. Orchestrate
      const plan = await orchestrator.plan({ intent, context: fullContext });
      
      // 7. Execute via agent loop if needed
      let result = null;
      let loopResult = null;
      
      if (plan.actions.length > 0) {
        if (plan.requiresConfirmation) {
          result = {
            ok: true,
            status: 'NEEDS_CONFIRMATION',
            plan,
            intent,
            requiresConfirmation: true
          };
        } else {
          loopResult = await loop.run({ message, context: fullContext, services: mergedServices });
          result = loopResult.result || loopResult;
        }
      } else {
        const agentResults = {};
        for (const agentId of plan.agents) {
          const agent = agents[agentId];
          if (agent?.handleIntent) {
            try {
              const res = await agent.handleIntent(intent, fullContext);
              agentResults[agentId] = res;
            } catch (e) {
              agentResults[agentId] = { ok: false, error: e.message };
            }
          }
        }
        result = { ok: true, agentResults, intent, plan, analysis: true };
      }
      
      // 8. Verification if financial
      let verification = null;
      if (result?.txHash || result?.result?.txHash) {
        verification = await verifyAgent.verifyTransaction({
          txHash: result.txHash || result.result.txHash,
          expected: plan.expected
        });
      }
      
      // 9. Human response (no leaks)
      const human = formatResponse({ intent, context: fullContext, result: { ...result, ...result?.agentResults }, locale: fullContext.locale });
      
      // 10. Suggestions — contextual, not static
      const suggestions = getSuggestionsForIntent(intent.type, fullContext, intent.entities);
      
      // 11. Save to memory
      const actionMem = createActionMemory({
        intent: intent.type,
        tools: plan.tools?.map(t => t.id) || [],
        inputs: plan.actions?.[0]?.input || {},
        result,
        status: result?.ok ? 'completed' : 'failed',
        duration: Date.now() - start,
        route: fullContext.currentPage
      });
      saveActionMemory(actionMem);
      
      addWorkingMemory(createMemory({
        type: 'conversation',
        content: `${message} → ${intent.type}`,
        importance: 0.6,
        metadata: { intent: intent.type, resultOk: result?.ok }
      }));
      
      // 12. Observability
      const latency = Date.now() - start;
      logTask({
        taskId: plan.planId,
        intent,
        tools: plan.tools,
        latency,
        status: result?.ok ? 'COMPLETED' : 'FAILED',
        errors: result?.error ? [result.error] : [],
        result,
        context: fullContext
      });
      
      captureDebug({
        taskId: plan.planId,
        intent,
        context: fullContext,
        agents: plan.agents,
        tools: plan.tools,
        executionGraph: plan.actions,
        memoryUsed: memories,
        latency,
        errors: result?.error ? [result.error] : [],
        result
      });
      
      // 13. Proactive check
      const opps = proactive.checkForOpportunities({
        goals: fullContext.activeGoals || [],
        portfolio: fullContext.portfolio,
        market: fullContext.market,
        context: fullContext
      });
      
      return {
        ok: true,
        intent,
        plan,
        result,
        verification,
        response: human,
        suggestions,
        context: fullContext,
        memories,
        opportunities: opps,
        latency,
        taskId: plan.planId
      };
    }
  };
}

// Default singleton for easy import
export const intentOS = createIntentOS();

// Convenience: formatHumanResponse alias for compatibility
export { formatResponse as formatHumanResponse };
