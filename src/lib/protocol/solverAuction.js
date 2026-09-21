/**
 * FBT INTENT PROTOCOL — SOLVER AUCTION & COMPETITION ENGINE
 * ---------------------------------------------------------------------------
 * Spec §9: Multi-solver competition, constraint enforcement, and configurable
 * policy-based evaluation (output, fee, gas, speed, reputation, risk).
 */

import { AUCTION_POLICIES } from './types.js';
import { assertConstraintsUnmodified } from './canonicalIntent.js';
import { computeQuoteHash } from './intentHashing.js';
import { createIntentError, PROTOCOL_ERROR_CODES } from './intentErrors.js';

export class SolverAuctionEngine {
  constructor({ solverRegistry, defaultPolicy = AUCTION_POLICIES.MAX_OUTPUT } = {}) {
    this.registry = solverRegistry;
    this.defaultPolicy = defaultPolicy;
  }

  /**
   * Conducts an auction for an intent across all capable solvers in registry.
   */
  async runAuction(intent, { solvers = null, policy = null, timeoutMs = 3000 } = {}) {
    const candidateSolvers = solvers || (this.registry ? await this.registry.findSolversForIntent(intent) : []);

    if (!candidateSolvers || candidateSolvers.length === 0) {
      throw createIntentError(PROTOCOL_ERROR_CODES.NO_ACTIVE_SOLVERS, {
        intentId: intent.intentId,
        technicalDetails: 'No active solvers registered for requested chain and assets'
      });
    }

    // Solicit quotes concurrently with timeout
    const quotePromises = candidateSolvers.map(async (solver) => {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('SOLVER_TIMEOUT')), timeoutMs)
        );
        const quotePromise = solver.quote(intent);
        const quote = await Promise.race([quotePromise, timeoutPromise]);
        return { ok: true, solver, quote };
      } catch (err) {
        return { ok: false, solverId: solver.solverId, error: err.message };
      }
    });

    const results = await Promise.all(quotePromises);
    const validQuotes = [];

    const now = Math.floor(Date.now() / 1000);

    for (const res of results) {
      if (!res.ok || !res.quote) continue;

      const q = res.quote;
      // Ensure quote binds to this exact intent
      if (q.intentId !== intent.intentId) continue;
      // Check quote expiration
      if (q.expiresAt && q.expiresAt <= now) continue;

      // Validate user constraints: cannot be modified or violated!
      try {
        assertConstraintsUnmodified(intent, q);
        // Ensure quote has commitment hash
        if (!q.commitment) {
          q.commitment = computeQuoteHash(q);
        }
        validQuotes.push(q);
      } catch {
        // Skip quotes that violate user constraints
        continue;
      }
    }

    if (validQuotes.length === 0) {
      throw createIntentError(PROTOCOL_ERROR_CODES.NO_VALID_QUOTES, {
        intentId: intent.intentId,
        technicalDetails: `Received 0 valid quotes satisfying user minimum out (${intent.minAmountOut})`
      });
    }

    const selectedPolicy = policy || intent.executionPreferences?.routingStrategy?.toUpperCase() || this.defaultPolicy;
    const scored = this.scoreQuotes(validQuotes, intent, selectedPolicy);

    return {
      intentId: intent.intentId,
      policy: selectedPolicy,
      quotesCount: validQuotes.length,
      allQuotes: scored,
      winningQuote: scored[0]
    };
  }

  /**
   * Scores and ranks valid quotes using explicit multi-dimensional criteria.
   */
  scoreQuotes(quotes, intent, policy = AUCTION_POLICIES.MAX_OUTPUT) {
    const scored = quotes.map((q) => {
      const amountOutBig = BigInt(q.amountOut);
      const feeBig = BigInt(q.fee || '0');
      const gasEstBig = BigInt(q.gasEstimate || '0');
      const rep = this.registry?.reputationScores?.get(q.solverId) || 90;

      // Net output after solver fee
      const netOutput = amountOutBig > feeBig ? amountOutBig - feeBig : 0n;

      let score = Number(netOutput);

      switch (policy) {
        case AUCTION_POLICIES.LOWEST_FEE:
          // Invert fee impact
          score = Number(netOutput) * 0.5 - Number(feeBig) * 1.5;
          break;

        case AUCTION_POLICIES.FASTEST_EXECUTION:
          // Favor shorter deadline / faster execution route
          const estSeconds = q.estimatedSeconds || 10;
          score = Number(netOutput) / (1 + estSeconds * 0.05);
          break;

        case AUCTION_POLICIES.REPUTATION_WEIGHTED:
          // Scale by reputation (0.5 to 1.5)
          score = Number(netOutput) * (0.5 + rep / 100);
          break;

        case AUCTION_POLICIES.MEV_PROTECTED:
          // Add bonus for private/MEV-shielded solver routes
          const mevBonus = q.mevShielded ? 1.05 : 1.0;
          score = Number(netOutput) * mevBonus;
          break;

        case AUCTION_POLICIES.MAX_OUTPUT:
        default:
          score = Number(netOutput);
          break;
      }

      return {
        ...q,
        score,
        solverReputation: rep
      };
    });

    // Rank descending by score
    return scored.sort((a, b) => b.score - a.score);
  }
}
