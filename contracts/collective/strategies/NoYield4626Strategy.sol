// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title NoYield4626Strategy
 * @notice The smallest possible ERC-4626 target: it holds the accounting asset
 *         and issues 1:1 shares. It has no strategy, no investment, no admin
 *         function, no fee, no oracle and no external call, so it cannot earn a
 *         return and cannot lose principal except through the asset itself.
 *
 * It exists so a Collective vault can be launched publicly before an audited
 * yield-bearing ERC-4626 target has been selected. A vault's target is
 * immutable; moving to real yield requires a separately reviewed vault created
 * with that target. The dashboard must disclose that this target earns nothing.
 */
contract NoYield4626Strategy is ERC4626 {
    constructor(IERC20 asset_) ERC20("FBT Idle Strategy Share", "fbtIDLE") ERC4626(asset_) {}
}
