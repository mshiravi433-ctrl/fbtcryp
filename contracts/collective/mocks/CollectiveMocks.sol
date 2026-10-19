// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICollectivePriceOracle, ICollectiveLiquidityOracle, IUniswapV2RouterLike} from "../interfaces/ICollective.sol";

/** Test-only, freely mintable six-decimal stable asset. */
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT", "mUSDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function burn(address from, uint256 amount) external { _burn(from, amount); }
}

/** Test-only fee-on-transfer asset used to verify exact-receipt accounting. */
contract MockFeeUSDT is ERC20 {
    address private constant FEE_SINK = address(0xdead);
    uint16 public constant FEE_BPS = 100;
    constructor() ERC20("Mock Fee USDT", "mfUSDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value >= 100) {
            uint256 fee = value * FEE_BPS / 10_000;
            super._update(from, to, value - fee);
            if (fee != 0) super._update(from, FEE_SINK, fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/**
 * Test-only ERC-4626 target that mints fewer shares than its quote. */
contract MockSlippage4626 is ERC4626 {
    uint16 public haircutBps;
    constructor(IERC20 asset_) ERC20("Haircut Strategy Share", "hSTRAT") ERC4626(asset_) {}
    function setHaircutBps(uint16 next) external { require(next <= 10_000, "BAD_HAIRCUT"); haircutBps = next; }
    function deposit(uint256 assets, address receiver) public override returns (uint256 shares) {
        require(assets <= maxDeposit(receiver), "MAX_DEPOSIT");
        shares = previewDeposit(assets) * (10_000 - haircutBps) / 10_000;
        _deposit(msg.sender, receiver, assets, shares);
    }
}

/**
 * A local ERC-4626 target. Yield/loss is simulated by minting/burning the
 * underlying inside the target, never by asserting a return in the vault.
 */
contract Mock4626Strategy is ERC4626 {
    constructor(IERC20 asset_) ERC20("Mock Strategy Share", "mSTRAT") ERC4626(asset_) {}

    function addYield(uint256 amount) external {
        MockUSDT(asset()).mint(address(this), amount);
    }

    function realizeLoss(uint256 amount) external {
        MockUSDT(asset()).burn(address(this), amount);
    }
}

contract MockCollectiveOracle is ICollectivePriceOracle {
    struct Price { uint256 value; uint64 updatedAt; }
    mapping(address => Price) private _prices;
    Price private _nativePrice;

    function setTokenPrice(address token, uint256 priceUsdE8) external {
        _prices[token] = Price(priceUsdE8, uint64(block.timestamp));
    }
    function setNativePrice(uint256 priceUsdE8) external {
        _nativePrice = Price(priceUsdE8, uint64(block.timestamp));
    }
    function setTokenPriceAt(address token, uint256 priceUsdE8, uint64 at) external {
        _prices[token] = Price(priceUsdE8, at);
    }
    function setNativePriceAt(uint256 priceUsdE8, uint64 at) external {
        _nativePrice = Price(priceUsdE8, at);
    }
    function tokenPriceUsdE8(address token) external view override returns (uint256, uint64) {
        Price memory p = _prices[token];
        return (p.value, p.updatedAt);
    }
    function nativePriceUsdE8() external view override returns (uint256, uint64) {
        return (_nativePrice.value, _nativePrice.updatedAt);
    }
}

contract MockCollectiveLiquidityOracle is ICollectiveLiquidityOracle {
    struct Liquidity { uint256 value; uint64 updatedAt; }
    mapping(bytes32 => Liquidity) private _liquidity;

    function setPairLiquidity(address router, address tokenA, address tokenB, uint256 amountUsdE8) external {
        _liquidity[_key(router, tokenA, tokenB)] = Liquidity(amountUsdE8, uint64(block.timestamp));
    }
    function setPairLiquidityAt(address router, address tokenA, address tokenB, uint256 amountUsdE8, uint64 at) external {
        _liquidity[_key(router, tokenA, tokenB)] = Liquidity(amountUsdE8, at);
    }
    function pairLiquidityUsdE8(address router, address tokenA, address tokenB)
        external view override returns (uint256, uint64)
    {
        Liquidity memory row = _liquidity[_key(router, tokenA, tokenB)];
        return (row.value, row.updatedAt);
    }
    function _key(address router, address a, address b) private pure returns (bytes32) {
        return keccak256(abi.encode(router, a < b ? a : b, a < b ? b : a));
    }
}

/** Simplified V2 test router used only to exercise the fixed swap interface. */
contract MockV2Router is IUniswapV2RouterLike {
    using SafeERC20 for IERC20;
    uint256 public rateE18 = 1e18;
    function setRate(uint256 next) external { rateE18 = next; }
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view override returns (uint256[] memory amounts) {
        require(path.length == 2, "BAD_PATH");
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn * rateE18 / 1e18;
    }
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external override returns (uint256[] memory amounts) {
        require(path.length == 2, "BAD_PATH");
        uint256 output = amountIn * rateE18 / 1e18;
        require(output >= amountOutMin, "MIN_OUT");
        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        MockUSDT(path[1]).mint(to, output);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = output;
    }
}
