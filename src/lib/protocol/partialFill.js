/**
 * FBT INTENT PROTOCOL — PARTIAL FILL ENGINE
 * ---------------------------------------------------------------------------
 * Spec §19: Partial fill tracking with proportional output guarantees and
 * per-fill cryptographic receipts.
 */

import { createIntentError, PROTOCOL_ERROR_CODES } from './intentErrors.js';

export class PartialFillTracker {
  constructor(intent) {
    this.intentId = intent.intentId;
    this.totalAmount = BigInt(intent.amount);
    this.minTotalOutput = BigInt(intent.minAmountOut);
    this.filledAmount = BigInt(intent.partialFill?.filledAmount || '0');
    this.remainingAmount = BigInt(intent.partialFill?.remainingAmount || intent.amount);
    this.accumulatedOutput = BigInt(intent.partialFill?.accumulatedOutput || '0');
    this.fills = [];
  }

  /**
   * Applies a partial execution fill.
   */
  applyFill({ fillAmount, outputAmount, solverId, txHash, receiptId }) {
    const fillBig = BigInt(fillAmount);
    const outBig = BigInt(outputAmount);

    if (fillBig <= 0n) {
      throw createIntentError(PROTOCOL_ERROR_CODES.INVALID_AMOUNT, {
        intentId: this.intentId,
        technicalDetails: `Fill amount must be positive, got ${fillAmount}`
      });
    }

    if (fillBig > this.remainingAmount) {
      throw createIntentError(PROTOCOL_ERROR_CODES.INVALID_AMOUNT, {
        intentId: this.intentId,
        technicalDetails: `Fill amount ${fillAmount} exceeds remaining ${this.remainingAmount.toString()}`
      });
    }

    // Rate protection: check proportional minimum output
    // requiredMinOut = (fillAmount * minTotalOutput) / totalAmount
    const requiredMinOut = (fillBig * this.minTotalOutput) / this.totalAmount;
    if (outBig < requiredMinOut) {
      throw createIntentError(PROTOCOL_ERROR_CODES.MIN_AMOUNT_OUT_BREACH, {
        intentId: this.intentId,
        solverId,
        technicalDetails: `Fill output ${outputAmount} is below proportional minimum ${requiredMinOut.toString()}`
      });
    }

    this.filledAmount += fillBig;
    this.remainingAmount -= fillBig;
    this.accumulatedOutput += outBig;

    const fillRecord = {
      fillIndex: this.fills.length,
      fillAmount: fillBig.toString(),
      outputAmount: outBig.toString(),
      solverId,
      txHash,
      receiptId,
      timestamp: Math.floor(Date.now() / 1000),
      remainingAmount: this.remainingAmount.toString()
    };

    this.fills.push(fillRecord);

    const isFullyFilled = this.remainingAmount === 0n;

    return {
      intentId: this.intentId,
      fillRecord,
      filledAmount: this.filledAmount.toString(),
      remainingAmount: this.remainingAmount.toString(),
      accumulatedOutput: this.accumulatedOutput.toString(),
      isFullyFilled,
      status: isFullyFilled ? 'COMPLETED' : 'PARTIALLY_FILLED'
    };
  }

  getProgress() {
    return {
      intentId: this.intentId,
      totalAmount: this.totalAmount.toString(),
      filledAmount: this.filledAmount.toString(),
      remainingAmount: this.remainingAmount.toString(),
      accumulatedOutput: this.accumulatedOutput.toString(),
      fillsCount: this.fills.length,
      percentComplete: Number((this.filledAmount * 100n) / this.totalAmount),
      fills: this.fills
    };
  }
}
