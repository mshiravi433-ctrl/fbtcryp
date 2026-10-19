// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * Shared monthly-income math. The vault retains unallocatable global dust in
 * its realized-income carry and retains each claimant's fractional remainder
 * between claims; no contract admin can sweep either amount.
 */
library RewardAccounting {
    uint256 internal constant PRECISION = 1e27;

    struct Distribution {
        uint48 snapshotBlock;
        uint256 eligibleShares;
        uint256 amountAllocated;
        uint256 incomePerShare;
    }

    /**
     * Floors per-share precision, but commits the full pool as income liability.
     * User-level fractional remainders can crystallize in later epochs; recycling
     * this per-share rounding dust would count the same income twice. If the
     * per-share value is zero, leave the pool with the caller to accumulate.
     */
    function allocate(uint256 amount, uint256 eligibleShares)
        internal pure returns (uint256 incomePerShare, uint256 committed)
    {
        if (amount == 0 || eligibleShares == 0) return (0, 0);
        incomePerShare = Math.mulDiv(amount, PRECISION, eligibleShares);
        if (incomePerShare == 0) return (0, 0);
        committed = amount;
    }

    /** Apply historical eligible shares and prior fractional dust. */
    function claimAmount(uint256 eligibleShares, uint256 incomePerShare, uint256 priorRemainder)
        internal pure returns (uint256 wholeUnits, uint256 nextRemainder)
    {
        if (eligibleShares == 0 || incomePerShare == 0) return (0, priorRemainder);
        wholeUnits = Math.mulDiv(eligibleShares, incomePerShare, PRECISION);
        uint256 fraction = mulmod(eligibleShares, incomePerShare, PRECISION) + priorRemainder;
        wholeUnits += fraction / PRECISION;
        nextRemainder = fraction % PRECISION;
    }
}
