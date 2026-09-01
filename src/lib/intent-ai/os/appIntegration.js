/**
 * FBT INTENT OS — App Integration
 * Wires OS into main App.jsx, provides current page awareness,
 * event bus, and proactive checks
 */

import { buildContext } from './contextEngine.js';
import { searchMemory } from './memoryEngine.js';
import { emitEvent, onEvent } from './eventBus.js';
import { createProactiveAgent } from './proactiveAgent.js';

let proactiveAgent = null;
let proactiveInterval = null;

export function initAppIntegration({ services = {}, wallet = null } = {}) {
  proactiveAgent = createProactiveAgent({ eventBus: { emit: emitEvent } });
  
  // Listen for portfolio updates to check proactive opportunities
  onEvent('portfolio.updated', async (event) => {
    try {
      const portfolio = event.payload?.portfolio || null;
      if (portfolio) {
        await proactiveAgent.checkOpportunities({ portfolio, goals: [], market: {} });
      }
    } catch {}
  });
  
  // Periodic proactive check (every 5 minutes)
  if (proactiveInterval) clearInterval(proactiveInterval);
  proactiveInterval = setInterval(async () => {
    try {
      if (wallet?.portfolio) {
        await proactiveAgent.checkOpportunities({ portfolio: wallet.portfolio, goals: [], market: {} });
      }
    } catch {}
  }, 5 * 60 * 1000);
  
  return {
    proactiveAgent,
    cleanup: () => {
      if (proactiveInterval) clearInterval(proactiveInterval);
    }
  };
}

export function getProactiveOpportunities() {
  return proactiveAgent?.getOpportunities?.() || [];
}

// Hook for React to use current page
export function useCurrentPageAwareness() {
  if (typeof window === 'undefined') return { currentPage: '/', currentTab: null };
  
  const hash = window.location.hash || '#/';
  const path = hash.replace('#', '').split('?')[0] || '/';
  
  return {
    currentPage: path,
    currentRoute: path,
    currentTab: null,
    timestamp: Date.now()
  };
}
