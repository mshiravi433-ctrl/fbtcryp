/**
 * FBT INTENT OS — Guardian Agent
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade — Multi-Agent Reasoning
 *
 * Security & Policy Enforcer:
 *   - Verifies all proposed actions against strict security invariants
 *   - Scans for prompt injection and secret exfiltration attempts
 *   - Enforces global hard caps (capital, leverage, slippage, fees)
 *   - Ensures no financial mutation executes without user approval
 *   - Emergency stop verification
 */

import { guardianReview, emergencyStopCheck, GUARDIAN_NON_DISABLEABLE } from '../../guardian.js';

export const GUARDIAN_AGENT_SCHEMA = 'fbt.guardian-agent.v1';

export function createGuardianAgent({ policy = null } = {}) {
  return {
    id: 'guardian-agent',
    schema: GUARDIAN_AGENT_SCHEMA,
    nonDisableable: GUARDIAN_NON_DISABLEABLE,

    async reviewAction({ action, customPolicy = null, context = {} } = {}) {
      const activePolicy = customPolicy || policy || {
        level: 2,
        maxCapitalUsd: 50000,
        maxTransactionUsd: 10000,
        maxLeverage: 10,
        maxSlippagePct: 2.0,
        maxFeeBps: 100
      };

      const result = guardianReview(action, activePolicy, context);
      return {
        ok: result.approved,
        approved: result.approved,
        reasons: result.reasons,
        warnings: result.warnings,
        level: result.level,
        isSensitive: result.isSensitive,
        timestamp: Date.now()
      };
    },

    async checkEmergencyStop(stopFlag = false) {
      return emergencyStopCheck(stopFlag);
    },

    async handleIntent(intent, context = {}) {
      if (intent.action) {
        const review = await this.reviewAction({ action: intent.action, context });
        return { ok: review.approved, guardian: review };
      }
      return { ok: true, guardian: { approved: true, reasons: [], warnings: [] } };
    }
  };
}

export const guardianAgent = createGuardianAgent();
