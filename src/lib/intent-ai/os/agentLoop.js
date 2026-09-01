/**
 * FBT INTENT OS — Agent Loop
 * ---------------------------------------------------------------------------
 * Spec §14: PERCEIVE → UNDERSTAND → PLAN → ACT → OBSERVE → VERIFY → CONTINUE → COMPLETE
 * Real agent, not just text response
 */

export const LOOP_SCHEMA = 'fbt.agent-loop.v1';

export const LOOP_STATES = Object.freeze([
  'PERCEIVE',
  'UNDERSTAND',
  'PLAN',
  'ACT',
  'OBSERVE',
  'VERIFY',
  'CONTINUE',
  'COMPLETE',
  'FAILED'
]);

export function createAgentLoop({
  intentAgent = null,
  contextEngine = null,
  orchestrator = null,
  executionAgent = null,
  verificationAgent = null,
  memoryEngine = null,
  eventBus = null,
  maxIterations = 10
} = {}) {
  return {
    schema: LOOP_SCHEMA,
    
    async run({ message, context = {}, services = {} } = {}) {
      const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const start = Date.now();
      const trace = [];
      
      const emit = (state, data = {}) => {
        const entry = { state, at: Date.now(), elapsed: Date.now() - start, ...data };
        trace.push(entry);
        if (eventBus?.emit) eventBus.emit('task.state', { taskId, ...entry }, 'agent-loop');
      };
      
      let currentContext = context;
      let intent = null;
      let plan = null;
      let result = null;
      let iteration = 0;
      
      try {
        // PERCEIVE
        emit('PERCEIVE', { message });
        const perception = intentAgent?.perceive
          ? await intentAgent.perceive({ message, context: currentContext })
          : { message, context: currentContext };
        
        // UNDERSTAND
        emit('UNDERSTAND');
        intent = intentAgent?.understand
          ? await intentAgent.understand({ message, context: currentContext })
          : { type: 'GENERAL', message };
        
        // Memory retrieval (Spec §30)
        let memories = [];
        if (memoryEngine?.searchMemory) {
          memories = memoryEngine.searchMemory({ query: intent.type + ' ' + message, topK: 8 });
          currentContext = { ...currentContext, relevantMemories: memories };
        }
        
        // PLAN
        emit('PLAN', { intentType: intent.type });
        if (orchestrator?.plan) {
          plan = await orchestrator.plan({ intent, context: currentContext, perception });
        } else {
          // Fallback plan
          const routing = intentAgent?.route ? await intentAgent.route(intent) : { agents: [] };
          plan = { intent, routing, actions: [], requiresConfirmation: intent.requiresWallet };
        }
        
        // If needs wallet and no wallet, stop and ask
        if (plan.requiresWallet && !currentContext.wallet?.connected) {
          emit('COMPLETE', { reason: 'NEEDS_WALLET' });
          return {
            ok: true,
            taskId,
            intent,
            plan,
            status: 'NEEDS_WALLET',
            context: currentContext,
            trace,
            duration: Date.now() - start
          };
        }
        
        // ACT loop
        while (iteration < maxIterations) {
          iteration += 1;
          emit('ACT', { iteration, actionCount: plan.actions?.length || 0 });
          
          if (!plan.actions?.length) {
            // No executable actions, just analysis
            result = { ok: true, analysis: true, intent, plan };
            break;
          }
          
          // Execute via execution agent
          if (executionAgent?.executePlan) {
            result = await executionAgent.executePlan({ actions: plan.actions, context: currentContext });
          } else if (executionAgent?.execute && plan.actions[0]) {
            const a = plan.actions[0];
            result = await executionAgent.execute({ toolId: a.toolId || a.id, input: a.input || a, context: currentContext });
          }
          
          // OBSERVE
          emit('OBSERVE', { resultOk: result?.ok });
          if (contextEngine?.updateContext) {
            currentContext = await contextEngine.updateContext(currentContext, result);
          }
          
          // VERIFY
          emit('VERIFY');
          let verification = null;
          if (verificationAgent?.verify && result) {
            verification = await verificationAgent.verify({
              expected: plan.expected || plan.actions?.[0],
              actual: result,
              actionId: taskId
            });
          }
          
          // CONTINUE or COMPLETE?
          if (verification?.ok || result?.ok) {
            // Check if task is complete
            const isComplete = orchestrator?.isComplete
              ? await orchestrator.isComplete({ intent, plan, result, context: currentContext })
              : true;
            
            if (isComplete) {
              emit('COMPLETE', { verification });
              break;
            } else {
              emit('CONTINUE', { reason: 'MORE_STEPS' });
              // Re-plan for next iteration
              if (orchestrator?.replan) {
                plan = await orchestrator.replan({ intent, context: currentContext, previousResult: result });
              }
            }
          } else {
            // Try self-healing
            emit('CONTINUE', { reason: 'HEALING' });
            if (orchestrator?.heal) {
              const healed = await orchestrator.heal({ error: result?.error, plan, context: currentContext });
              if (healed?.ok) {
                plan = healed.plan || plan;
                continue;
              }
            }
            emit('FAILED', { error: result?.error || verification?.status });
            break;
          }
        }
        
        // Save to action memory
        if (memoryEngine?.saveActionMemory) {
          memoryEngine.saveActionMemory({
            intent: intent.type,
            tools: plan.actions?.map(a => a.toolId || a.id) || [],
            inputs: plan.actions?.[0]?.input || {},
            result,
            status: result?.ok ? 'completed' : 'failed',
            duration: Date.now() - start
          });
        }
        
        return {
          ok: result?.ok !== false,
          taskId,
          intent,
          plan,
          result,
          context: currentContext,
          trace,
          duration: Date.now() - start,
          status: result?.ok ? 'COMPLETED' : 'FAILED'
        };
        
      } catch (err) {
        emit('FAILED', { error: err.message });
        return {
          ok: false,
          taskId,
          intent,
          plan,
          error: err.message,
          trace,
          duration: Date.now() - start,
          status: 'FAILED'
        };
      }
    }
  };
}
