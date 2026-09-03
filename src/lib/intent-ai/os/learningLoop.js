/**
 * FBT INTENT OS — Learning Loop (Client-side)
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade — Learning Loop
 */

import { recordOutcome, fetchLearningStats } from '../../aiGatewayClient.js';

export const LEARNING_LOOP_SCHEMA = 'fbt.learning-loop.v1';

export function createLearningLoop() {
  const localBuffer = [];

  return {
    schema: LEARNING_LOOP_SCHEMA,

    async record(outcomeData = {}) {
      localBuffer.unshift({ ...outcomeData, timestamp: Date.now() });
      if (localBuffer.length > 50) localBuffer.length = 50;

      try {
        await recordOutcome(outcomeData);
      } catch {
        // Non-blocking
      }
    },

    async getStats() {
      try {
        const res = await fetchLearningStats();
        if (res.ok) return res;
      } catch {
        // Fallback
      }

      return {
        totalIntents: localBuffer.length,
        successRate: 1.0,
        providerPerformance: {},
        commonErrors: [],
        averageLatencyMs: 250
      };
    }
  };
}

export const learningLoop = createLearningLoop();
