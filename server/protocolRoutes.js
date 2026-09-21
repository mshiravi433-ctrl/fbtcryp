/**
 * FBT INTENT PROTOCOL — UNIFIED PROTOCOL API ROUTES
 * ---------------------------------------------------------------------------
 * Spec §27: Canonical protocol API endpoints
 *
 *   POST /api/intents
 *   GET  /api/intents/:id
 *   POST /api/intents/:id/cancel
 *   GET  /api/intents/:id/quotes
 *   GET  /api/intents/:id/execution
 *   GET  /api/intents/:id/proof
 *   GET  /api/solvers
 *   GET  /api/solvers/:id
 *   POST /api/solvers/register
 *   POST /api/quotes
 *   POST /api/quotes/:id/commit
 *   GET  /api/protocol/health
 *   GET  /api/protocol/version
 */

import { Router } from 'express';
import {
  createCanonicalIntent,
  validateCanonicalIntent,
  verifyIntentSignature,
  globalNonceManager,
  IntentLifecycleRecord,
  globalSolverRegistry,
  SolverAuctionEngine,
  createExecutionReceipt,
  verifyExecutionReceipt,
  ProtocolMerkleTree,
  buildQuoteCommitment,
  verifyQuoteCommitment,
  DexAggregatorSolver,
  CrossChainSolver,
  RfqSolver,
  PROTOCOL_VERSION,
  INTENT_SCHEMA_VERSION,
  SOLVER_SCHEMA_VERSION,
  QUOTE_SCHEMA_VERSION,
  RECEIPT_SCHEMA_VERSION,
  EVIDENCE_TIERS,
  createIntentError,
  PROTOCOL_ERROR_CODES
} from '../src/lib/protocol/index.js';

// In-memory protocol state (persisted across requests)
const intentStore = new Map(); // intentId -> { intent, lifecycle, quotes, winningQuote, execution, receipt }
const quoteStore = new Map(); // quoteId -> quote
const executionLog = []; // all receipts for Merkle tree

// Initialize default reference solvers in registry
function seedReferenceSolvers() {
  if (globalSolverRegistry.list().length === 0) {
    globalSolverRegistry.register(new DexAggregatorSolver());
    globalSolverRegistry.register(new CrossChainSolver());
    globalSolverRegistry.register(new RfqSolver());
  }
}
seedReferenceSolvers();

const auctionEngine = new SolverAuctionEngine({ solverRegistry: globalSolverRegistry });

export function createProtocolRouter() {
  const router = Router();

  /**
   * GET /api/protocol/version
   */
  router.get('/protocol/version', (_req, res) => {
    res.json({
      protocol: 'FBT Intent Protocol',
      version: PROTOCOL_VERSION,
      schemas: {
        intent: INTENT_SCHEMA_VERSION,
        solver: SOLVER_SCHEMA_VERSION,
        quote: QUOTE_SCHEMA_VERSION,
        receipt: RECEIPT_SCHEMA_VERSION
      },
      chains: [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144, 501],
      settlementType: 'NON_CUSTODIAL_VERIFIED'
    });
  });

  /**
   * GET /api/protocol/health
   */
  router.get('/protocol/health', (_req, res) => {
    const solvers = globalSolverRegistry.list({ status: 'active' });
    res.json({
      status: 'HEALTHY',
      version: PROTOCOL_VERSION,
      timestamp: Math.floor(Date.now() / 1000),
      activeSolversCount: solvers.length,
      intentsIndexed: intentStore.size,
      executionReceiptsCount: executionLog.length,
      auctionPolicy: 'MULTI_CRITERIA_CONSTRAINT_BOUNDED'
    });
  });

  /**
   * GET /api/solvers
   */
  router.get('/solvers', (req, res) => {
    const list = globalSolverRegistry.list(req.query);
    res.json({ solvers: list, count: list.length });
  });

  /**
   * GET /api/solvers/:id
   */
  router.get('/solvers/:id', (req, res) => {
    const solver = globalSolverRegistry.get(req.params.id);
    if (!solver) {
      return res.status(404).json({ error: 'Solver not found', solverId: req.params.id });
    }
    const meta = typeof solver.getMetadata === 'function' ? solver.getMetadata() : solver;
    res.json(meta);
  });

  /**
   * POST /api/solvers/register
   */
  router.post('/solvers/register', (req, res) => {
    try {
      const result = globalSolverRegistry.register(req.body);
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  /**
   * POST /api/intents
   * Submit new intent -> Validates -> Checks Nonce -> Runs Auction -> Commits
   */
  router.post('/intents', async (req, res) => {
    try {
      // 1. Create canonical intent
      const intent = createCanonicalIntent(req.body);

      // 2. Validate invariants
      const val = validateCanonicalIntent(intent);
      if (!val.valid) {
        return res.status(400).json({
          error: 'VALIDATION_FAILED',
          details: val.errors
        });
      }

      // 3. Verify signature if supplied
      if (intent.signature) {
        const sigCheck = verifyIntentSignature(intent);
        if (!sigCheck.valid) {
          return res.status(401).json({
            error: 'INVALID_SIGNATURE',
            reason: sigCheck.reason
          });
        }
      }

      // 4. Nonce replay protection check
      const nonceCheck = globalNonceManager.isNonceValid(intent.sourceChain, intent.user, intent.nonce);
      if (!nonceCheck.valid) {
        return res.status(409).json({
          error: nonceCheck.reason,
          message: 'Nonce has already been used or cancelled'
        });
      }

      // 5. Initialize lifecycle
      const lifecycle = new IntentLifecycleRecord(intent);
      if (intent.signature) {
        lifecycle.transition('SIGNED', { reason: 'USER_AUTHORIZED', actor: 'USER' });
      }
      lifecycle.transition('VALIDATED', { reason: 'CONSTRAINTS_CHECKED', actor: 'ENGINE' });
      lifecycle.transition('OPEN', { reason: 'ENTERED_INTENT_POOL', actor: 'COORDINATOR' });
      lifecycle.transition('QUOTING', { reason: 'AUCTION_STARTED', actor: 'AUCTION_ENGINE' });

      // 6. Solicit competitive quotes from solvers
      let auctionResult;
      try {
        auctionResult = await auctionEngine.runAuction(intent);
      } catch (err) {
        lifecycle.transition('FAILED', { reason: err.message, actor: 'AUCTION_ENGINE' });
        return res.status(422).json({
          error: err.code || 'AUCTION_FAILED',
          message: err.userAction || err.message,
          technicalDetails: err.technicalDetails
        });
      }

      lifecycle.transition('COMMITTED', {
        reason: 'WINNING_QUOTE_LOCKED',
        actor: 'AUCTION_ENGINE',
        metadata: { winningSolver: auctionResult.winningQuote.solverId }
      });

      // Index in store
      intentStore.set(intent.intentId, {
        intent,
        lifecycle,
        quotes: auctionResult.allQuotes,
        winningQuote: auctionResult.winningQuote,
        execution: null,
        receipt: null
      });

      // Save quotes for query
      for (const q of auctionResult.allQuotes) {
        quoteStore.set(q.quoteId, q);
      }

      res.status(201).json({
        intentId: intent.intentId,
        status: lifecycle.status,
        traceId: intent.traceId,
        winningQuote: auctionResult.winningQuote,
        quotesCount: auctionResult.quotesCount,
        allQuotes: auctionResult.allQuotes,
        lifecycle: lifecycle.toJSON()
      });
    } catch (err) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
    }
  });

  /**
   * GET /api/intents/:id
   */
  router.get('/intents/:id', (req, res) => {
    const record = intentStore.get(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Intent not found', intentId: req.params.id });
    }

    res.json({
      intentId: record.intent.intentId,
      intent: record.intent,
      status: record.lifecycle.status,
      lifecycle: record.lifecycle.toJSON(),
      winningQuote: record.winningQuote,
      execution: record.execution,
      receipt: record.receipt
    });
  });

  /**
   * POST /api/intents/:id/cancel
   */
  router.post('/intents/:id/cancel', (req, res) => {
    const record = intentStore.get(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Intent not found', intentId: req.params.id });
    }

    if (record.lifecycle.isTerminal()) {
      return res.status(400).json({
        error: 'CANNOT_CANCEL',
        message: `Intent is already in terminal status ${record.lifecycle.status}`
      });
    }

    try {
      // Invalidate nonce
      globalNonceManager.cancelNonce(
        record.intent.sourceChain,
        record.intent.user,
        record.intent.nonce,
        req.body?.reason || 'USER_CANCELLED'
      );

      record.lifecycle.transition('CANCELLED', {
        reason: req.body?.reason || 'USER_REQUESTED_CANCELLATION',
        actor: 'USER'
      });

      res.json({
        intentId: record.intent.intentId,
        status: record.lifecycle.status,
        message: 'Intent successfully cancelled and nonce invalidated'
      });
    } catch (err) {
      res.status(400).json({ error: 'CANCELLATION_FAILED', message: err.message });
    }
  });

  /**
   * GET /api/intents/:id/quotes
   */
  router.get('/intents/:id/quotes', (req, res) => {
    const record = intentStore.get(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Intent not found', intentId: req.params.id });
    }

    res.json({
      intentId: record.intent.intentId,
      quotesCount: record.quotes?.length || 0,
      quotes: record.quotes || [],
      winningQuote: record.winningQuote
    });
  });

  /**
   * GET /api/intents/:id/execution
   */
  router.get('/intents/:id/execution', (req, res) => {
    const record = intentStore.get(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Intent not found', intentId: req.params.id });
    }

    res.json({
      intentId: record.intent.intentId,
      status: record.lifecycle.status,
      execution: record.execution,
      winningQuote: record.winningQuote
    });
  });

  /**
   * GET /api/intents/:id/proof
   */
  router.get('/intents/:id/proof', (req, res) => {
    const record = intentStore.get(req.params.id);
    if (!record) {
      return res.status(404).json({ error: 'Intent not found', intentId: req.params.id });
    }

    if (!record.receipt) {
      return res.status(404).json({
        error: 'PROOF_NOT_YET_AVAILABLE',
        status: record.lifecycle.status,
        message: 'Execution receipt and Merkle proof are generated after execution settlement'
      });
    }

    // Build Merkle proof
    const tree = new ProtocolMerkleTree(executionLog);
    const receiptIndex = executionLog.findIndex((r) => r.receiptId === record.receipt.receiptId);
    const merkleProof = receiptIndex >= 0 ? tree.getProof(receiptIndex) : null;

    res.json({
      receiptId: record.receipt.receiptId,
      intentId: record.intent.intentId,
      receipt: record.receipt,
      merkleProof,
      merkleRoot: tree.getRoot(),
      evidenceTier: record.receipt.evidenceTier,
      verified: true
    });
  });

  /**
   * POST /api/quotes
   */
  router.post('/quotes', (req, res) => {
    const quote = req.body;
    if (!quote || !quote.quoteId || !quote.intentId) {
      return res.status(400).json({ error: 'INVALID_QUOTE_PAYLOAD' });
    }
    quoteStore.set(quote.quoteId, quote);
    res.status(201).json({ ok: true, quoteId: quote.quoteId });
  });

  /**
   * POST /api/quotes/:id/commit
   */
  router.post('/quotes/:id/commit', (req, res) => {
    const quote = quoteStore.get(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found', quoteId: req.params.id });
    }

    const commitment = buildQuoteCommitment(quote);
    res.json({ ok: true, commitment });
  });

  return router;
}

export const protocolRouter = createProtocolRouter();
