/**
 * FBT INTENT OS — Client AI Gateway Bridge
 * ---------------------------------------------------------------------------
 * Spec Phase 3: Multi-AI Intelligence Upgrade
 */

import { fetchAiProviders, executeAiGatewayChat, runAiConsensus } from '../../aiGatewayClient.js';

export const AI_GATEWAY_SCHEMA = 'fbt.ai-gateway.v3';

export function createClientAiGateway() {
  let cachedProviders = [];
  let lastFetched = 0;

  return {
    schema: AI_GATEWAY_SCHEMA,

    async getProviders(force = false) {
      if (!force && cachedProviders.length && Date.now() - lastFetched < 60000) {
        return cachedProviders;
      }
      try {
        const res = await fetchAiProviders();
        if (res.ok && Array.isArray(res.providers)) {
          cachedProviders = res.providers;
          lastFetched = Date.now();
          return cachedProviders;
        }
      } catch {
        // Return fallback
      }
      return [
        { id: 'internal', name: 'Internal Reasoning Engine', configured: true }
      ];
    },

    async chat(params = {}) {
      return executeAiGatewayChat(params);
    },

    async runConsensus(params = {}) {
      return runAiConsensus(params);
    }
  };
}

export const clientAiGateway = createClientAiGateway();
