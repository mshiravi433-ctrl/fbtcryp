/**
 * FBT INTENT OS — Universal AI Operating Agent — Main Index
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

// Core
export * from './appCapabilities.js';
export * from './toolRegistry.js';
export * from './intentUnderstanding.js';
export * from './intentUnderstandingEngine.js';
export * from './intentSession.js';
export * from './contextEngine.js';
export * from './memoryEngine.js';
export * from './actionMemory.js';
export * from './eventBus.js';
export * from './agentLoop.js';
export * from './orchestrator.js';
export * from './suggestionEngine.js';
export * from './taskContinuity.js';
export * from './financialAgent.js';
export * from './observability.js';
export * from './humanResponse.js';
export * from './security.js';
export * from './performance.js';
export * from './debugDashboard.js';
export * from './centralWalletState.js';
export * from './sharedState.js';
export * from './tokenResolver.js';
export * from './opportunityScanner.js';
export * from './toolExecutor.js';
export * from './moduleRouter.js';

// Agents
export * from './agents/intentAgent.js';
export * from './agents/navigationAgent.js';
export * from './agents/mediaAgent.js';
export * from './agents/walletAgent.js';
export * from './agents/portfolioAgent.js';
export * from './agents/marketAgent.js';
export * from './agents/tradingAgent.js';
export * from './agents/yieldAgent.js';
export * from './agents/researchAgent.js';
export * from './agents/riskAgent.js';
export * from './agents/strategyAgent.js';
export * from './agents/guardianAgent.js';
export * from './agents/executionAgent.js';

// Upgrade 7 — predictive intelligence, autonomous planning, deep understanding.
// Exported under a namespace so no existing top-level name can be shadowed.
export * as upgrade7 from './upgrade7/index.js';

// Multi-AI Phase 3 Extensions
export * from './aiGateway.js';
export * from './consensusEngine.js';
export * from './confidenceEngine.js';
export * from './learningLoop.js';

// Unified OS Class
import { buildContext, updateContext, getCurrentPageContext } from './contextEngine.js';
import { understandIntent, extractNavigationIntent, runAcceptanceTests } from './intentUnderstanding.js';
import { wantsPageOpen } from './moduleRouter.js';
import { resolveIntent } from './routeAdapter.js';
import { resolveToolsForIntent, getRelevantToolsForMessage, validateToolInput, getTool } from './toolRegistry.js';
import { createIntentAgent } from './agents/intentAgent.js';
import { createNavigationAgent } from './agents/navigationAgent.js';
import { createMediaAgent } from './agents/mediaAgent.js';
import { createWalletAgent } from './agents/walletAgent.js';
import { createPortfolioAgent } from './agents/portfolioAgent.js';
import { createMarketAgent } from './agents/marketAgent.js';
import { createTradingAgent } from './agents/tradingAgent.js';
import { createYieldAgent } from './agents/yieldAgent.js';
import { createResearchAgent } from './agents/researchAgent.js';
import { createRiskAgent } from './agents/riskAgent.js';
import { createStrategyAgent } from './agents/strategyAgent.js';
import { createGuardianAgent } from './agents/guardianAgent.js';
import { createExecutionAgent, createVerificationAgent, createSelfHealing } from './agents/executionAgent.js';
import { createFinancialAgent } from './financialAgent.js';
import { createConsensusEngine } from './consensusEngine.js';
import { createConfidenceEngine } from './confidenceEngine.js';
import { getSessionOperationalSlots, updateIntentSession } from './intentSession.js';
import { createLearningLoop } from './learningLoop.js';
import { createOrchestrator } from './orchestrator.js';
import { createAgentLoop } from './agentLoop.js';
import { buildHumanResponse, stripInternalLeaks } from './humanResponse.js';
import { getSuggestionsForIntent, getSuggestionsForMessage } from './suggestionEngine.js';
import { createTask, saveTask, getActiveTasks, getLastActiveTask, getLastTask, resumeTask, updateTaskStatus } from './taskContinuity.js';
import { resolveFollowUp, PAGE_OPEN_INTENTS, INTENT_DEFAULT_ROUTE } from './upgrade6/followUpResolver.js';
import { searchMemory, addWorkingMemory, addSessionMemory, addLongTermMemory, createMemory, extractPreferenceFromMessage } from './memoryEngine.js';
import { createActionMemory, saveActionMemory } from './actionMemory.js';
import { logTask } from './observability.js';
import { logDebug, createDebugTrace } from './debugDashboard.js';
import { emitEvent, onEvent, dispatchAction, registerActionHandler } from './eventBus.js';
import { sanitizeForAI, assertNoSecrets } from './security.js';
import { executeIntentTools, flattenAgentResults } from './toolExecutor.js';
import { getCentralWalletState, mergeWalletSnapshots, setCentralWalletState } from './centralWalletState.js';
import { rememberOperationalSlots, getOperationalSlots, patchSharedState } from './sharedState.js';
import { clearContextCache } from './contextEngine.js';
/*
 * UPGRADE 7 — the intelligence layer rides on top of this pipeline and never
 * inside it. `enrich()` is total (it returns `{ ok:false }` instead of
 * throwing) and purely additive: it reads the turn that already happened and
 * returns a block we attach to the response. Deleting this import would restore
 * pre-Upgrade-7 behaviour exactly.
 */
import { enrich as enrichUpgrade7 } from './upgrade7/index.js';

export const INTENT_OS_SCHEMA = 'fbt.intent-os.v3';
export const INTENT_OS_VERSION = '3.0.0';

function mergeServices(base, extra) {
  const next = { ...(base || {}) };
  if (extra && typeof extra === 'object' && Object.keys(extra).length) Object.assign(next, extra);
  return next;
}

export function createIntentOS({
  services = {},
  navigation = null,
  audioService = null,
  walletService = null,
  eventBus = null,
  /**
   * The radio store (store/useRadioStore) actions, handed in by the host
   * surface. Background audio has exactly one owner — RadioDock's <audio>,
   * mounted above the router — and the media agent must drive THAT rather
   * than create a second element. Null in Node tests, where the agent
   * correctly reports a track as "queued" instead of "playing".
   */
  radio = null,
  locale = 'fa'
} = {}) {
  let liveServices = { ...(services || {}) };
  let liveNavigation = navigation;
  // Create agents with dependencies
  const intentAgent = createIntentAgent();
  const navAgent = createNavigationAgent({ navigateFn: navigation?.navigate, eventBus: { emit: emitEvent } });
  // audioService falls back to the one in the service bundle so a host that
  // only passes `services` still gets a working media agent.
  const mediaAgent = createMediaAgent({
    audioService: audioService || services.audioService || null,
    navigation,
    radio,
    eventBus: { emit: emitEvent }
  });
  const walletAgent = createWalletAgent({ walletService, eventBus: { emit: emitEvent } });
  const portfolioAgent = createPortfolioAgent({ portfolioService: services.portfolioService, riskService: services.riskService });
  const marketAgent = createMarketAgent({ marketService: services.marketService, signalsService: services.signalsService, smartMoneyService: services.smartMoneyService, whaleService: services.whaleService });
  const tradingAgent = createTradingAgent({ swapService: services.swapService, bridgeService: services.bridgeService });
  const yieldAgent = createYieldAgent({ yieldService: services.yieldService, farmService: services.farmService, lendingService: services.lendingService });
  const researchAgent = createResearchAgent({ newsService: services.newsService, marketService: services.marketService });
  const riskAgent = createRiskAgent({ riskService: services.riskService });
  const strategyAgent = createStrategyAgent({ strategyService: services.strategyService });
  const guardianAgent = createGuardianAgent({ policy: services.policy });
  const executionAgent = createExecutionAgent({ toolRegistry: { getTool }, actionBus: { dispatch: dispatchAction } });
  const verificationAgent = createVerificationAgent();
  const selfHealing = createSelfHealing({ executionAgent, toolRegistry: { getToolsByCapability: () => [] } });
  const financialAgent = createFinancialAgent({ portfolioAgent, riskAgent, marketAgent, yieldAgent, tradingAgent });
  
  const consensusEngine = createConsensusEngine();
  const confidenceEngine = createConfidenceEngine();
  const learningLoop = createLearningLoop();

  const agents = {
    'intent-agent': intentAgent,
    'navigation-agent': navAgent,
    'media-agent': mediaAgent,
    'wallet-agent': walletAgent,
    'portfolio-agent': portfolioAgent,
    'market-agent': marketAgent,
    'trading-agent': tradingAgent,
    'yield-agent': yieldAgent,
    'research-agent': researchAgent,
    'risk-agent': riskAgent,
    'strategy-agent': strategyAgent,
    'guardian-agent': guardianAgent,
    'execution-agent': executionAgent,
    'verification-agent': verificationAgent,
    'financial-agent': financialAgent
  };
  
  const orchestrator = createOrchestrator({ agents, toolRegistry: { resolveToolsForIntent, getTool }, eventBus: { emit: emitEvent } });
  const agentLoop = createAgentLoop({ intentAgent, contextEngine: { updateContext }, orchestrator, executionAgent, verificationAgent, memoryEngine: { searchMemory, saveActionMemory }, eventBus: { emit: emitEvent } });
  
  return {
    version: INTENT_OS_VERSION,
    schema: INTENT_OS_SCHEMA,
    agents,
    orchestrator,
    agentLoop,
    consensusEngine,
    confidenceEngine,
    learningLoop,
    setServices(next) { liveServices = mergeServices(liveServices, next); return liveServices; },
    setNavigation(next) { liveNavigation = next || liveNavigation; return liveNavigation; },
    getServices() { return liveServices; },
    
    // Main entry: User Intent → Understand → Context → Plan → Execute → Verify → Memory → Response
    async process({ message, conversationId = null, sessionId = null, currentPage = '/', selectedAsset = null, selectedNetwork = null, activeTab = null, walletState = null, portfolioState = null, conversation = [], pendingOffer = null, locale: loc = locale, services: svc } = {}) {
      const start = Date.now();
      const currentLocale = loc || locale;
      const mergedServices = mergeServices(liveServices, svc);
      const convId = conversationId || sessionId || 'default';
      
      try {
        assertNoSecrets({ message }, 'user-message');

        const liveWallet = mergeWalletSnapshots(walletState, getCentralWalletState());
        if (walletState && (walletState.address || walletState.connected || walletState.isConnected)) {
          try { setCentralWalletState(liveWallet, { emit: false }); } catch { /* keep going */ }
        }

        const sessionSlots = getSessionOperationalSlots(convId);
        const operationalSlots = { ...sessionSlots, ...getOperationalSlots() };
        
        // 1. PERCEIVE + UNDERSTAND
        const intent = understandIntent(message, {
          currentPage,
          selectedAsset,
          selectedNetwork,
          activeTab,
          wallet: liveWallet,
          operational: operationalSlots,
          conversation,
          sessionId: convId
        });

        updateIntentSession(convId, {
          currentIntent: intent.primaryIntent || intent.type,
          entities: intent.entities,
          missingFields: intent.missingInformation,
          assumptions: intent.assumptions,
          confidence: intent.confidence,
          isCorrection: intent.isCorrection
        });
        
        // 2. CONTEXT ENGINE — parallel reads
        const context = await buildContext({
          currentPage,
          currentRoute: currentPage,
          selectedAsset,
          selectedNetwork,
          activeTab,
          conversationId: convId,
          sessionId: convId,
          walletState: liveWallet,
          portfolioState,
          conversation,
          memory: searchMemory({ query: message, topK: 8 }),
          services: mergedServices,
          locale: currentLocale
        });
        context.services = mergedServices;
        context.lastMessage = message;
        
        // 3. Memory preference extraction
        const pref = extractPreferenceFromMessage(message);
        if (pref) addLongTermMemory(pref);
        
        // 4. PLAN via orchestrator
        const plan = await orchestrator.plan({ intent, context });
        
        // 5. EXECUTE if read-only, page handoff, or navigation/media
        let executionResult = null;
        let verification = null;
        /*
         * ─── WHO ANSWERS: the chat, or a page? ────────────────────────────
         * A question deserves an ANSWER, not a redirect. The old list held 12
         * types, so asking «تحلیل» or «اخبار» or «سیگنال» — a question — threw
         * the user onto another screen mid-sentence and answered nothing.
         *
         * The rule now: anything the assistant can READ and summarise is
         * answered here. Only an intent that needs a form the chat does not
         * have (an amount field, a slippage control, a signature) hands off,
         * and even then only because the page is where the action completes.
         *
         * `wantsPageOpen` still wins for every type — «بازش کن» is an explicit
         * instruction and always beats this default.
         */
        const ANSWER_IN_CHAT = [
          // analysis and reads — the assistant has the data
          'PORTFOLIO_ANALYSIS', 'WALLET_BALANCE', 'YIELD_DISCOVERY', 'INVESTMENT_PLAN',
          'RISK_ANALYSIS', 'MARKET_ANALYSIS', 'MARKET_CONTEXT', 'ANALYZE_TOKEN', 'SIGNALS',
          'NEWS_SEARCH', 'SMART_MONEY', 'WHALE', 'FARM', 'LEND', 'ORDERS', 'STOCKS',
          // conversation control
          'CONTINUE', 'DETAILS', 'CANCEL', 'GENERAL', 'EXECUTE_CURRENT', 'REBALANCE', 'GOAL',
          // "what can you do" is a chat answer by definition
          'CAPABILITIES',
          // the ops surfaces answer with their own live panels
          'OPS_CENTER', 'AGENTS', 'STRATEGY', 'SYSTEM_STATUS'
        ];
        let workingIntent = intent;
        const stayInChat = ANSWER_IN_CHAT.includes(workingIntent.type);
        let openPage = wantsPageOpen(workingIntent.raw) || !stayInChat;

        /*
         * CONTINUE / «اره» / «بله تایید شد» must resume the last offer
         * (open Horizon, open market, open the best farm) instead of asking
         * “confirm?” forever and leaving a PENDING HORIZON task.
         */
        if (workingIntent.type === 'CONTINUE' || workingIntent.type === 'EXECUTE_CURRENT') {
          const lastTask = getLastActiveTask() || getLastTask();
          const follow = resolveFollowUp(message, {
            pendingOffer,
            lastIntentType: operationalSlots.intent || operationalSlots.operation || lastTask?.intent,
            operational: operationalSlots,
            lastTask,
            lastAiContent: Array.isArray(conversation)
              ? [...conversation].reverse().find((m) => m?.role === 'ai' || m?.role === 'assistant')?.content
              : null
          });
          if (follow.handled && follow.action === 'resume' && follow.route) {
            openPage = true;
            workingIntent = {
              ...workingIntent,
              type: follow.intentType && follow.intentType !== 'CONTINUE' ? follow.intentType : (lastTask?.intent || workingIntent.type),
              primaryIntent: follow.intentType && follow.intentType !== 'CONTINUE' ? follow.intentType : (lastTask?.intent || workingIntent.primaryIntent),
              navigation: { ...(workingIntent.navigation || {}), route: follow.route },
              entities: { ...(workingIntent.entities || {}), selection: follow.selection || workingIntent.entities?.selection }
            };
          } else if (follow.handled && follow.action === 'cancel') {
            if (lastTask?.id) updateTaskStatus(lastTask.id, 'COMPLETED');
            executionResult = { ok: true, cancelled: true };
          } else if (lastTask?.intent && PAGE_OPEN_INTENTS.includes(lastTask.intent)) {
            const resumeRoute = INTENT_DEFAULT_ROUTE[lastTask.intent] || lastTask.intentDetail?.navigation?.route;
            if (resumeRoute) {
              openPage = true;
              workingIntent = {
                ...workingIntent,
                type: lastTask.intent,
                primaryIntent: lastTask.intent,
                navigation: { ...(workingIntent.navigation || {}), route: resumeRoute }
              };
            }
          }
        }

        // SSOT-first routing, with an adapter for follow-up slots, SEND→wallet,
        // speculation gating and entity-driven swap/bridge fallback.
        const routing = resolveIntent(workingIntent, message, { openPage, slots: getOperationalSlots() });
        const handoffRoute = routing.route;
        const forceOpen = routing.openPage === true;

        if (executionResult?.cancelled) {
          // already handled
        } else if (routing.unavailable) {
          // The module exists in the spec but not in this build — say so,
          // never navigate to a dead URL.
          executionResult = { ok: true, unavailable: routing.unavailable };
        } else if (workingIntent.type === 'OPEN_CALM' || workingIntent.type === 'PLAY_MUSIC') {
          executionResult = await mediaAgent.handleIntent(workingIntent, { locale: currentLocale });
        } else if (handoffRoute && (openPage || forceOpen || workingIntent.type === 'NAVIGATION' || workingIntent.type === 'NEWS_SEARCH')) {
          if (liveNavigation?.navigate) {
            await liveNavigation.navigate({ route: handoffRoute });
          } else {
            await navAgent.handleIntent({ ...workingIntent, navigation: { route: handoffRoute } }, context);
          }
          executionResult = { ok: true, route: handoffRoute, handoff: true };
        } else if (plan.readOnly || workingIntent.readOnly || workingIntent.type === 'NAVIGATION' || workingIntent.type === 'NEWS_SEARCH') {
          if (workingIntent.type === 'NAVIGATION' || workingIntent.type === 'NEWS_SEARCH') {
            executionResult = await navAgent.handleIntent(workingIntent, context);
            if (executionResult.ok && executionResult.route && liveNavigation?.navigate) {
              await liveNavigation.navigate({ route: executionResult.route });
            }
          } else {
            const toolRun = await executeIntentTools({ intent: workingIntent, context, services: mergedServices });
            const agentResults = {};
            for (const agentId of plan.agents) {
              const agent = agents[agentId];
              if (agent?.handleIntent) {
                try {
                  const res = await agent.handleIntent(workingIntent, { ...context, services: mergedServices });
                  agentResults[agentId] = res;
                } catch { /* one agent failing must not blank the whole turn */ }
              }
            }
            const flat = flattenAgentResults(agentResults);
            executionResult = {
              ok: true,
              ...flat,
              agentResults,
              analysis: (flat.analysis && typeof flat.analysis === 'object') ? flat.analysis : (toolRun.data.portfolio || context.portfolio),
              portfolio: flat.portfolio || toolRun.data.portfolio || context.portfolio,
              balances: flat.balances || toolRun.data.wallet,
              yieldOpportunities: toolRun.data.yieldOpportunities || flat.yieldOpportunities,
              opportunities: toolRun.data.opportunities || flat.yieldOpportunities?.opportunities,
              market: flat.market || toolRun.data.market,
              smartMoney: flat.smartMoney || toolRun.data.smartMoney,
              whale: flat.whale || toolRun.data.whale,
              toolsUsed: toolRun.toolsUsed,
              dataStatus: toolRun.data.yieldOpportunities?.dataStatus || context.portfolio?.dataStatus
            };
          }
        } else {
          // Financial — plan ready, needs confirmation
          executionResult = { ok: true, planReady: true, requiresConfirmation: true };
        }
        
        // 6. VERIFY if execution happened
        if (executionResult?.ok && !executionResult.planReady) {
          verification = await verificationAgent.verify({
            expected: plan.expected,
            actual: executionResult,
            actionId: plan.planId
          });
        }
        
        // 7. HUMAN RESPONSE
        try {
          const ent = workingIntent.entities || {};
          const op = routing.operation || workingIntent.type;
          rememberOperationalSlots({
            asset: ent.token
              || (['SELL', 'SEND'].includes(op) ? ent.fromToken : ent.toToken)
              || ent.fromToken
              || ent.toToken,
            operation: op,
            amount: ent.amount || ent.amountUsd,
            fromToken: ent.fromToken,
            toToken: ent.toToken,
            intent: op
          });
          if (executionResult?.portfolio) patchSharedState('portfolio', executionResult.portfolio, { source: 'intent-os' });
        } catch { /* memory is best-effort */ }

        const human = buildHumanResponse({
          intent: workingIntent,
          context,
          results: executionResult || {},
          plan,
          locale: currentLocale
        });
        
        // 8. SUGGESTIONS — dynamic contextual
        const suggestions = getSuggestionsForIntent(workingIntent.type, { ...context, lastIntentType: workingIntent.type }, workingIntent.entities);
        
        // 9. TASK CONTINUITY — a finished read/navigation is COMPLETED, not
        // an “unfinished HORIZON” nag the next time the chat remounts.
        const finished = Boolean(
          executionResult?.ok
          && !executionResult.planReady
          && !executionResult.requiresConfirmation
          && (executionResult.route || workingIntent.readOnly || PAGE_OPEN_INTENTS.includes(workingIntent.type) || workingIntent.type === 'CONTINUE' || workingIntent.type === 'CANCEL' || executionResult.cancelled)
        );
        const task = createTask({
          intent: workingIntent,
          plan,
          context,
          status: executionResult?.cancelled ? 'COMPLETED' : (finished ? 'COMPLETED' : (executionResult?.planReady ? 'PENDING' : (executionResult?.ok ? 'COMPLETED' : 'FAILED')))
        });
        saveTask(task);
        const prevPending = getActiveTasks().filter((t) => t.id !== task.id && PAGE_OPEN_INTENTS.includes(t.intent));
        for (const t of prevPending) updateTaskStatus(t.id, 'COMPLETED');
        
        // 10. OBSERVABILITY
        const latency = Date.now() - start;
        logTask({
          taskId: task.id,
          intent,
          tools: plan.tools?.map(t => t.id) || [],
          latency,
          status: executionResult?.ok ? (executionResult.planReady ? 'AWAITING_CONFIRMATION' : 'COMPLETED') : 'FAILED',
          errors: executionResult?.ok ? [] : [executionResult?.error || 'FAILED'],
          provider: plan.tools?.[0]?.id || null,
          result: executionResult,
          context
        });
        
        // 11. DEBUG TRACE
        const debugTrace = createDebugTrace({
          intent,
          context,
          agents: plan.agents,
          tools: plan.tools,
          plan,
          execution: { result: executionResult },
          memory: context.memory,
          latency,
          errors: executionResult?.ok ? [] : [executionResult?.error]
        });
        logDebug(debugTrace);
        
        // 12. ACTION MEMORY
        const actionMem = createActionMemory({
          intent: workingIntent.type,
          tools: plan.tools?.map(t => t.id) || [],
          inputs: plan.actions?.[0]?.input || {},
          result: executionResult,
          status: executionResult?.ok ? (executionResult.planReady ? 'awaiting_confirmation' : 'completed') : 'failed',
          duration: latency,
          route: currentPage
        });
        saveActionMemory(actionMem);
        
        // 13. WORKING MEMORY
        addWorkingMemory(createMemory({
          type: 'conversation',
          content: `${message} → ${routing.operation || workingIntent.type}`,
          importance: 0.6,
          metadata: { intent: workingIntent.type, route: currentPage }
        }));

        // 14. CONFIDENCE & LEARNING
        const confidence = confidenceEngine.evaluate({
          intent,
          context,
          toolsUsed: executionResult?.toolsUsed || [],
          dataStatus: executionResult?.dataStatus || context.portfolio?.dataStatus || 'live'
        });

        learningLoop.record({
          intentType: workingIntent.type,
          providerUsed: 'intent-os-v3',
          confidenceScore: confidence.confidenceScore,
          executionSuccess: executionResult?.ok !== false,
          durationMs: latency,
          locale: currentLocale
        }).catch(() => {});

        /*
         * 15. UPGRADE 7 — deep intent, plan/graph, cross-check, freshness,
         * predictions. Purely additive: every existing key below is untouched,
         * and a throw here is swallowed by `enrich` itself, so the turn is
         * never lost to the intelligence layer.
         */
        let upgrade7 = null;
        try {
          upgrade7 = enrichUpgrade7({
            message,
            baseIntent: workingIntent,
            context,
            execution: executionResult,
            conversationId: convId,
            conversation,
            wallet: liveWallet,
            portfolio: executionResult?.portfolio || portfolioState || context.portfolio,
            market: executionResult?.market || context.market,
            smartMoney: executionResult?.smartMoney,
            agentResults: executionResult?.agentResults,
            baseConfidence: confidence,
            // Phase 2 (freshness): hand the intelligence layer the observation
            // time + provenance of each live read. Anything without a stamp
            // reads as missing, never as fresh — see B-4 in the phase prompt.
            dataSnapshots: {
              price: executionResult?.market ? { fetchedAt: executionResult.market.fetchedAt, source: executionResult.market.source } : null,
              balance: executionResult?.balances ? { fetchedAt: executionResult.balances.fetchedAt, source: executionResult.balances.source || 'rpc' } : null,
              portfolio: context.portfolio ? { fetchedAt: context.portfolio.fetchedAt, source: context.portfolio.source || 'portfolio' } : null
            },
            locale: currentLocale
          });
        } catch { /* the intelligence layer is never load-bearing */ }

        return {
          ok: true,
          intent: workingIntent,
          context,
          plan,
          execution: executionResult,
          verification,
          human,
          suggestions,
          task,
          debug: debugTrace,
          latency,
          confidence,
          multiAi: {
            /*
             * Kept in step with server/aiGateway.js — Grok, OpenAI and
             * Perplexity are no longer registered providers, so they must not
             * be advertised to the user as part of the fleet.
             */
            activeProviders: ['openrouter', 'groq', 'gemini', 'anthropic', 'deepseek', 'mistral', 'workersai', 'aimlapi', 'internal'],
            confidenceScore: confidence.confidenceScore,
            riskScore: confidence.riskScore,
            dataFreshness: confidence.dataFreshness
          },
          upgrade7,
          message: stripInternalLeaks(human.message),
          ui: human.ui,
          card: human.card,
          requiresConfirmation: human.requiresConfirmation || plan.requiresConfirmation,
          navigated: human.navigated || executionResult?.route || null
        };
        
      } catch (err) {
        const latency = Date.now() - start;
        logTask({
          taskId: `err_${Date.now()}`,
          intent: { type: 'ERROR' },
          latency,
          status: 'FAILED',
          errors: [err.message],
          context: { currentPage }
        });
        
        return {
          ok: false,
          error: err.message,
          latency,
          message: locale.startsWith('fa') || /[آ-ی]/.test(message)
            ? 'متأسفانه مشکلی پیش آمد. لطفاً دوباره تلاش کنید.'
            : 'Something went wrong. Please try again.',
          ui: { type: 'TEXT' }
        };
      }
    },
    
    // Acceptance tests
    runAcceptanceTests,
    
    // Utilities
    getTool,
    resolveToolsForIntent,
    getRelevantToolsForMessage,
    validateToolInput,
    searchMemory,
    getActiveTasks,
    getLastActiveTask,
    getLastTask,
    resumeTask,
    emitEvent,
    onEvent,
    stripInternalLeaks
  };
}

// Singleton for app-wide use
let singleton = null;

export function getIntentOS(opts = {}) {
  if (opts.forceNew) {
    singleton = createIntentOS(opts);
    return singleton;
  }
  if (singleton) {
    if (opts.services) singleton.setServices(opts.services);
    if (opts.navigation) singleton.setNavigation(opts.navigation);
    return singleton;
  }
  singleton = createIntentOS(opts);
  return singleton;
}

export function resetIntentOS() {
  singleton = null;
  try { clearContextCache(); } catch { /* ignore */ }
}
