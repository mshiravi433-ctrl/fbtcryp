/**
 * FBT INTENT PROTOCOL — PERMISSIONLESS SOLVER REGISTRY
 * ---------------------------------------------------------------------------
 * Spec §8: Versioned Solver Registry supporting registration, capabilities,
 * reputation, staking/bonding, and dynamic discovery.
 */

import { SOLVER_SCHEMA_VERSION } from './types.js';
import { createIntentError, PROTOCOL_ERROR_CODES } from './intentErrors.js';

export class ProtocolSolverRegistry {
  constructor() {
    this.solvers = new Map(); // solverId -> FBTSolver instance or metadata
    this.reputationScores = new Map(); // solverId -> number (0-100)
    this.bonds = new Map(); // solverId -> BigInt (in micro-units)
    this.penalties = new Map(); // solverId -> Array<{ timestamp, penalty, reason }>
    this.version = SOLVER_SCHEMA_VERSION;
  }

  /**
   * Registers a solver instance or metadata into the registry.
   */
  register(solver) {
    if (!solver || !solver.solverId) {
      throw createIntentError(PROTOCOL_ERROR_CODES.INVALID_SCHEMA, {
        technicalDetails: 'Solver must have a valid solverId'
      });
    }

    const metadata = typeof solver.getMetadata === 'function' ? solver.getMetadata() : solver;

    this.solvers.set(solver.solverId, solver);
    this.reputationScores.set(solver.solverId, metadata.reputation || 90);
    this.bonds.set(solver.solverId, BigInt(metadata.stake || '10000000000'));

    return {
      ok: true,
      solverId: solver.solverId,
      status: metadata.status || 'active',
      registeredAt: Math.floor(Date.now() / 1000)
    };
  }

  /**
   * Updates an existing solver's metadata.
   */
  update(solverId, updates) {
    const existing = this.solvers.get(solverId);
    if (!existing) {
      throw createIntentError(PROTOCOL_ERROR_CODES.SOLVER_NOT_REGISTERED, {
        solverId,
        technicalDetails: `Solver ${solverId} is not in registry`
      });
    }

    if (typeof existing.getMetadata === 'function') {
      Object.assign(existing, updates);
    } else {
      this.solvers.set(solverId, { ...existing, ...updates });
    }

    return { ok: true, solverId };
  }

  /**
   * Suspends a solver due to poor performance, downtime, or dispute.
   */
  suspend(solverId, reason = 'POLICY_VIOLATION') {
    const solver = this.solvers.get(solverId);
    if (!solver) return false;

    if (typeof solver.getMetadata === 'function') {
      solver.status = 'suspended';
    } else {
      solver.status = 'suspended';
    }

    return { ok: true, solverId, status: 'suspended', reason };
  }

  /**
   * Reactivates a suspended solver.
   */
  reactivate(solverId) {
    const solver = this.solvers.get(solverId);
    if (!solver) return false;
    solver.status = 'active';
    return { ok: true, solverId, status: 'active' };
  }

  /**
   * Deregisters a solver.
   */
  remove(solverId) {
    this.solvers.delete(solverId);
    this.reputationScores.delete(solverId);
    this.bonds.delete(solverId);
    return true;
  }

  get(solverId) {
    return this.solvers.get(solverId) || null;
  }

  list(filter = {}) {
    const results = [];
    for (const [id, s] of this.solvers.entries()) {
      const meta = typeof s.getMetadata === 'function' ? s.getMetadata() : s;
      const rep = this.reputationScores.get(id) || 0;
      const bond = (this.bonds.get(id) || 0n).toString();

      if (filter.status && meta.status !== filter.status) continue;
      if (filter.chain && !meta.chains?.some((c) => String(c) === String(filter.chain))) continue;
      if (filter.capability && !meta.capabilities?.includes(filter.capability)) continue;

      results.push({
        ...meta,
        reputation: rep,
        stake: bond
      });
    }
    return results;
  }

  /**
   * Finds all active solvers capable of handling the intent.
   */
  async findSolversForIntent(intent) {
    const matched = [];
    for (const [id, s] of this.solvers.entries()) {
      const meta = typeof s.getMetadata === 'function' ? s.getMetadata() : s;
      if (meta.status !== 'active') continue;

      // Check user solverPolicy
      if (intent.solverPolicy) {
        if (intent.solverPolicy.allowedSolvers?.length > 0 && !intent.solverPolicy.allowedSolvers.includes(id)) {
          continue;
        }
        if (intent.solverPolicy.disallowedSolvers?.includes(id)) {
          continue;
        }
        if (intent.solverPolicy.minReputationScore && (this.reputationScores.get(id) || 0) < intent.solverPolicy.minReputationScore) {
          continue;
        }
      }

      if (typeof s.validateIntent === 'function') {
        const val = await s.validateIntent(intent);
        if (val.ok) matched.push(s);
      } else {
        // Fallback to metadata chain matching
        const chainMatch = meta.chains?.some((c) => String(c) === String(intent.sourceChain));
        if (chainMatch) matched.push(s);
      }
    }
    return matched;
  }

  /**
   * Adjusts a solver's reputation based on execution accuracy and speed.
   */
  adjustReputation(solverId, delta) {
    const current = this.reputationScores.get(solverId) || 90;
    const updated = Math.min(100, Math.max(0, current + delta));
    this.reputationScores.set(solverId, updated);

    const solver = this.solvers.get(solverId);
    if (solver) {
      if (typeof solver === 'object') solver.reputation = updated;
    }

    return updated;
  }

  /**
   * Slashes a solver's bond upon proven deficit or breach.
   */
  slashBond(solverId, penaltyAmountMicroUsd, reason) {
    const bond = this.bonds.get(solverId) || 0n;
    const penalty = BigInt(penaltyAmountMicroUsd);
    const slashed = penalty > bond ? bond : penalty;
    const remaining = bond - slashed;
    this.bonds.set(solverId, remaining);

    const log = this.penalties.get(solverId) || [];
    log.push({
      timestamp: Math.floor(Date.now() / 1000),
      slashed: slashed.toString(),
      remaining: remaining.toString(),
      reason
    });
    this.penalties.set(solverId, log);

    // If bond drops below threshold, suspend solver
    if (remaining < 1000000n) {
      this.suspend(solverId, 'BOND_DEPLETED');
    }

    return {
      solverId,
      slashed: slashed.toString(),
      remainingBond: remaining.toString(),
      reason
    };
  }
}

export const globalSolverRegistry = new ProtocolSolverRegistry();
