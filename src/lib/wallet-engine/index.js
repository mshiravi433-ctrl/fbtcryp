/**
 * FBT WALLET ENGINE — PUBLIC SURFACE
 * ---------------------------------------------------------------------------
 * One import for the whole engine. The internal modules stay separately
 * importable (deep imports are fine), but this barrel is the supported entry:
 *
 *   import { createWalletOrchestrator } from '@/lib/wallet-engine';
 *
 * ─── ARCHITECTURE (mirrors the spec) ────────────────────────────────────────
 *   Wallet Core
 *       │
 *   Wallet Orchestrator  ← orchestrator.js
 *       │
 *   EVM · Solana · BTC adapters ← adapters.js
 *   Wallet Registry (multi-wallet) ← registry.js
 *   Capability Engine ← capabilities.js
 *   Wallet State Machine ← walletStateMachine.js
 *
 *   Engines on top of the core:
 *   Balance · Asset Resolver · Simulation · Gas · Approval · Security
 *   Cost Basis · Portfolio · Automation · Indexer · Tracker · Intelligence
 *   Address Book · Sessions · Recurring · Notifications
 */

/* Core */
export * from './capabilities.js';
export * from './walletStateMachine.js';
export * from './registry.js';
export * from './adapters.js';
export * from './orchestrator.js';

/* Engines */
export * from './balanceEngine.js';
export * from './catalog.js';
export * from './assetResolver.js';
export * from './simulationEngine.js';
export * from './gasManager.js';
export * from './approvalManager.js';
export * from './securityEngine.js';
export * from './costBasisEngine.js';
export * from './portfolioEngine.js';
export * from './automationEngine.js';
export * from './indexer.js';
export * from './tracker.js';
export * from './intelligence.js';
export * from './addressBook.js';
export * from './sessionManager.js';
export * from './recurring.js';
export * from './notifications.js';
