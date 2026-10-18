/**
 * Test Suite for FBT AI Collective
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import aiService from '../server/collective/aiStrategyService.js';
import keeper from '../server/collective/collectiveKeeper.js';

describe('FBT AI Collective - Zero-Cost Test Suite', () => {
  it('Scans active opportunities on Robinhood Chain', async () => {
    const opps = await aiService.scanOpportunities();
    assert.ok(opps.length >= 3, 'Should have at least 3 opportunities');
    assert.equal(opps[0].vaultType, 'stable');
  });

  it('Enforces automated Stop-Loss when price drops > 4%', () => {
    const position = {
      symbol: 'NVDA',
      entryPrice: 100,
      currentPrice: 95, // 5% loss
      amount: 10
    };
    const decision = aiService.evaluateStopLoss(position);
    assert.equal(decision.action, 'ROTATE_TO_SAFETY');
    assert.ok(decision.reason.includes('exceeded limit'));
  });

  it('Holds position when drawdown is safe (<4%)', () => {
    const position = {
      symbol: 'NVDA',
      entryPrice: 100,
      currentPrice: 98, // 2% loss
      amount: 10
    };
    const decision = aiService.evaluateStopLoss(position);
    assert.equal(decision.action, 'HOLD');
  });

  it('Generates compliant trade proposals with max slippage constraints', () => {
    const proposal = aiService.generateTradeProposal({
      vault: '0x123',
      tokenIn: '0xabc',
      tokenOut: '0xdef',
      amountIn: 1000,
      expectedPrice: 1.0
    });
    assert.ok(proposal.proposalId.startsWith('prop_'));
    assert.ok(parseFloat(proposal.minAmountOut) < 1000, 'Must apply slippage buffer');
  });

  it('Verifies Keeper epoch duration and status reporting', () => {
    const status = keeper.getKeeperStatus();
    assert.equal(status.activeEpoch, 2);
    assert.ok(status.daysRemainingInEpoch > 0);
  });
});
