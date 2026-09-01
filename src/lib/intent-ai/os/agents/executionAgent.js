/**
 * FBT INTENT OS — Execution Agent + Verification Agent
 * Spec §32 + §33 Self-Healing
 */

export const EXEC_AGENT_SCHEMA = 'fbt.execution-agent.v1';
export const VERIFY_AGENT_SCHEMA = 'fbt.verification-agent.v1';

export function createExecutionAgent({ toolRegistry = null, actionBus = null, eventBus = null } = {}) {
  return {
    id: 'execution-agent',
    schema: EXEC_AGENT_SCHEMA,
    
    async execute({ toolId, input, context = {} } = {}) {
      try {
        if (actionBus?.dispatch) {
          return await actionBus.dispatch({ action: toolId, input, context });
        }
        if (toolRegistry?.getTool) {
          const tool = toolRegistry.getTool(toolId);
          if (!tool) return { ok: false, error: 'TOOL_NOT_FOUND', message: 'این قابلیت در حال حاضر در دسترس نیست.' };
          const result = await tool.execute(input, context);
          return { ok: result?.ok !== false, result };
        }
        return { ok: false, error: 'NO_EXECUTOR' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async executePlan({ actions = [], context = {} } = {}) {
      const results = [];
      for (const action of actions) {
        const res = await this.execute({ toolId: action.toolId || action.id, input: action.input || action, context });
        results.push({ action, result: res, ok: res.ok });
        
        if (!res.ok && action.requiresConfirmation) {
          // Stop on failure for financial actions
          break;
        }
      }
      return {
        ok: results.every(r => r.ok),
        results,
        successCount: results.filter(r => r.ok).length,
        total: results.length
      };
    }
  };
}

export function createVerificationAgent() {
  return {
    id: 'verification-agent',
    schema: VERIFY_AGENT_SCHEMA,
    
    async verify({ expected, actual, actionId = null } = {}) {
      // Spec §32: Compare Expected vs Actual
      const expAmount = Number(expected?.amount || expected?.amountUsd || 0);
      const actAmount = Number(actual?.amount || actual?.amountUsd || actual?.received || 0);
      
      let status = 'CONFIRMED';
      let diff = null;
      
      if (expAmount && actAmount) {
        diff = Math.abs(expAmount - actAmount) / expAmount;
        if (diff > 0.05) status = 'PARTIAL';
        if (diff > 0.2) status = 'MISMATCH';
      }
      
      if (actual?.status === 'FAILED' || actual?.ok === false) status = 'FAILED';
      if (actual?.status === 'CONFIRMED' || actual?.txHash || actual?.signature) status = 'CONFIRMED';
      
      return {
        ok: status === 'CONFIRMED',
        status,
        expected,
        actual,
        diff,
        actionId,
        verifiedAt: Date.now(),
        message: status === 'CONFIRMED' ? 'تأیید شد' : status === 'PARTIAL' ? 'تأیید جزئی' : 'عدم تطابق'
      };
    },
    
    async verifyTransaction({ txHash, chainId = null, expected = null } = {}) {
      // In real implementation, would check on-chain receipt
      return {
        ok: true,
        status: txHash ? 'CONFIRMED' : 'PENDING',
        txHash,
        chainId,
        expected,
        verifiedAt: Date.now()
      };
    }
  };
}

export function createSelfHealing({ executionAgent = null, toolRegistry = null } = {}) {
  return {
    async heal({ error, toolId, input, context, retries = 0 } = {}) {
      const maxRetries = 2;
      
      if (retries >= maxRetries) {
        return { ok: false, error: 'MAX_RETRIES', originalError: error };
      }
      
      // Diagnose
      const errStr = String(error?.message || error || '').toLowerCase();
      
      // Provider failed → try alternative
      if (errStr.includes('provider') || errStr.includes('quote') || errStr.includes('no route')) {
        if (toolRegistry?.getToolsByCapability) {
          const alternatives = toolRegistry.getToolsByCapability('quote').filter(t => t.id !== toolId);
          for (const alt of alternatives.slice(0, 2)) {
            try {
              const result = await executionAgent.execute({ toolId: alt.id, input, context });
              if (result.ok) return { ok: true, healed: true, alternative: alt.id, result };
            } catch {}
          }
        }
      }
      
      // Network → retry
      if (errStr.includes('network') || errStr.includes('timeout') || errStr.includes('unavailable')) {
        await new Promise(r => setTimeout(r, 1000 * (retries + 1)));
        try {
          const result = await executionAgent.execute({ toolId, input, context });
          if (result.ok) return { ok: true, healed: true, retried: true, result };
        } catch (e) {
          return this.heal({ error: e, toolId, input, context, retries: retries + 1 });
        }
      }
      
      return { ok: false, error: 'HEAL_FAILED', originalError: error };
    }
  };
}

export const executionAgent = createExecutionAgent();
export const verificationAgent = createVerificationAgent();
