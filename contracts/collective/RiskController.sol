// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    ICollectiveAccessController,
    IEmergencyModule,
    ICollectivePriceOracle,
    ICollectiveLiquidityOracle,
    IRiskController,
    IStrategyVault
} from "./interfaces/ICollective.sol";

interface ICollectiveVaultAdapterView {
    function strategyAdapter() external view returns (address);
}

interface ICollectiveStrategyValueView {
    function totalAssets() external view returns (uint256);
}

/**
 * On-chain policy gate. Governance changes to allowlists, vault limits, and
 * strategy-kind activation are queued and delayed. Guardian pause is immediate
 * through EmergencyModule. A missing/stale oracle, liquidity observation, or
 * unset limit reverts closed.
 *
 * The first adapter path is ERC-4626 and does not perform swaps. Swap policy is
 * implemented here for a later approved-token trading vault; that kind stays
 * disabled until its accounting adapter is separately reviewed and enabled.
 */
contract RiskController is IRiskController {
    uint256 public constant BPS = 10_000;
    uint256 public constant PRICE_SCALE = 1e8;
    uint256 public constant MAX_SWAP_GAS_UNITS = 800_000;
    uint32 public constant HARD_MAX_ORACLE_AGE = 1 days;
    uint16 public constant HARD_MAX_SLIPPAGE_BPS = 1_000;
    uint16 public constant HARD_MAX_RESERVE_BPS = 5_000;
    uint8 public constant KIND_STABLE_YIELD = 0;
    uint8 public constant KIND_FARMING_LP = 1;
    uint8 public constant KIND_APPROVED_TRADING = 2;

    uint8 private constant ALLOW_ASSET = 0;
    uint8 private constant ALLOW_PROTOCOL = 1;
    uint8 private constant ALLOW_ROUTER = 2;
    uint8 private constant ALLOW_EXPENSE_RECIPIENT = 3;

    ICollectiveAccessController public immutable accessController;
    IEmergencyModule public immutable emergencyModule;
    ICollectivePriceOracle public immutable priceOracle;
    ICollectiveLiquidityOracle public immutable liquidityOracle;
    uint48 public immutable policyDelay;

    mapping(address => bool) public override isAssetAllowed;
    mapping(address => bool) public override isProtocolAllowed;
    mapping(address => bool) public override isRouterAllowed;
    mapping(address => bool) public override isExpenseRecipient;
    mapping(uint8 => bool) public override isKindEnabled;
    mapping(address => Limits) private _vaultLimits;
    mapping(address => uint8) public vaultKind;
    mapping(address => address) public vaultAsset;
    mapping(address => address) public vaultProtocol;
    mapping(address => bool) public registeredVault;

    mapping(bytes32 => uint48) public pendingChangeAt;
    mapping(address => Limits) private _pendingLimits;
    mapping(address => bytes32) public pendingLimitsHash;
    mapping(address => uint48) public pendingLimitsAt;
    mapping(uint8 => uint48) public pendingKindAt;
    mapping(uint8 => bool) public pendingKindValue;

    event AddressChangeQueued(uint8 indexed kind, address indexed target, bool allowed, uint48 executeAfter);
    event AddressPolicyChanged(uint8 indexed kind, address indexed target, bool allowed);
    event VaultRegistered(address indexed vault, uint8 indexed kind, address indexed asset, address protocol);
    event VaultLimitsQueued(address indexed vault, bytes32 indexed policyHash, uint48 executeAfter);
    event VaultLimitsChanged(address indexed vault, bytes32 indexed policyHash);
    event KindActivationQueued(uint8 indexed kind, bool enabled, uint48 executeAfter);
    event KindActivationChanged(uint8 indexed kind, bool enabled);

    error NotGovernor();
    error NotFactory();
    error NotVault();
    error NotExecutionRouter();
    error EmergencyPaused();
    error PolicyNotReady(uint48 executeAfter);
    error NoPendingChange();
    error InvalidAddress();
    error InvalidKind();
    error AssetNotApproved();
    error ProtocolNotApproved();
    error RouterNotApproved();
    error KindDisabled();
    error InvalidLimits();
    error VaultDisabled();
    error TradeTooLarge();
    error AllocationCapExceeded();
    error ConcentrationCapExceeded();
    error SlippageTooHigh();
    error LiquidityTooLow();
    error OracleUnavailable(address token);
    error OracleStale(address token, uint64 updatedAt);
    error TransactionCostTooHigh();

    modifier onlyGovernor() {
        if (!accessController.hasRole(accessController.GOVERNOR_ROLE(), msg.sender)) revert NotGovernor();
        _;
    }

    modifier onlyFactory() {
        if (!accessController.hasRole(accessController.FACTORY_ROLE(), msg.sender)) revert NotFactory();
        _;
    }

    constructor(
        ICollectiveAccessController access_,
        IEmergencyModule emergency_,
        ICollectivePriceOracle prices_,
        ICollectiveLiquidityOracle liquidity_,
        uint48 policyDelay_
    ) {
        require(address(access_) != address(0) && address(emergency_) != address(0), "ZERO_CONTROL");
        require(address(prices_).code.length != 0 && address(liquidity_).code.length != 0, "ORACLE_NO_CODE");
        require(policyDelay_ >= 1 days && policyDelay_ <= 30 days, "BAD_DELAY");
        accessController = access_;
        emergencyModule = emergency_;
        priceOracle = prices_;
        liquidityOracle = liquidity_;
        policyDelay = policyDelay_;
        // No investment kind is live by default. A governor must queue and
        // execute activation after reviewing chain-specific addresses/evidence.
    }

    function limits(address vault) external view override returns (Limits memory) {
        return _vaultLimits[vault];
    }

    function reserveBps(address vault) external view override returns (uint16) {
        return _vaultLimits[vault].reserveBps;
    }

    function queueAddressChange(uint8 kind, address target, bool allowed) external onlyGovernor {
        if (kind > ALLOW_EXPENSE_RECIPIENT) revert InvalidKind();
        if (target == address(0)) revert InvalidAddress();
        bytes32 changeId = keccak256(abi.encode("ADDRESS", kind, target, allowed));
        uint48 eta = uint48(block.timestamp + policyDelay);
        pendingChangeAt[changeId] = eta;
        emit AddressChangeQueued(kind, target, allowed, eta);
    }

    function executeAddressChange(uint8 kind, address target, bool allowed) external {
        if (kind > ALLOW_EXPENSE_RECIPIENT) revert InvalidKind();
        if (target == address(0)) revert InvalidAddress();
        bytes32 changeId = keccak256(abi.encode("ADDRESS", kind, target, allowed));
        uint48 eta = pendingChangeAt[changeId];
        if (eta == 0) revert NoPendingChange();
        if (block.timestamp < eta) revert PolicyNotReady(eta);
        delete pendingChangeAt[changeId];
        // Expense recipients are payout destinations and may intentionally be EOAs;
        // assets, protocols, and routers must be deployed contracts.
        if (allowed && kind != ALLOW_EXPENSE_RECIPIENT && target.code.length == 0) revert InvalidAddress();
        if (kind == ALLOW_ASSET) isAssetAllowed[target] = allowed;
        else if (kind == ALLOW_PROTOCOL) isProtocolAllowed[target] = allowed;
        else if (kind == ALLOW_ROUTER) isRouterAllowed[target] = allowed;
        else isExpenseRecipient[target] = allowed;
        emit AddressPolicyChanged(kind, target, allowed);
    }

    function queueKindActivation(uint8 kind, bool enabled) external onlyGovernor {
        if (kind > KIND_APPROVED_TRADING) revert InvalidKind();
        uint48 eta = uint48(block.timestamp + policyDelay);
        pendingKindAt[kind] = eta;
        pendingKindValue[kind] = enabled;
        emit KindActivationQueued(kind, enabled, eta);
    }

    function executeKindActivation(uint8 kind) external {
        if (kind > KIND_APPROVED_TRADING) revert InvalidKind();
        uint48 eta = pendingKindAt[kind];
        if (eta == 0) revert NoPendingChange();
        if (block.timestamp < eta) revert PolicyNotReady(eta);
        delete pendingKindAt[kind];
        isKindEnabled[kind] = pendingKindValue[kind];
        delete pendingKindValue[kind];
        emit KindActivationChanged(kind, isKindEnabled[kind]);
    }

    function registerVault(
        address vault,
        uint8 kind,
        address asset,
        address protocol,
        Limits calldata limits_
    ) external override onlyFactory {
        if (vault == address(0) || vault.code.length == 0 || asset == address(0)) revert InvalidAddress();
        if (kind > KIND_APPROVED_TRADING) revert InvalidKind();
        // v1 ships only a single-asset ERC-4626 accounting adapter. LP and
        // trading vault registration stays blocked until separate, reviewed
        // accounting modules are introduced; merely enabling a kind is not
        // enough to bring an incomplete lane on-chain.
        if (kind != KIND_STABLE_YIELD) revert KindDisabled();
        if (!isKindEnabled[kind]) revert KindDisabled();
        if (!isAssetAllowed[asset]) revert AssetNotApproved();
        if (protocol != address(0) && !isProtocolAllowed[protocol]) revert ProtocolNotApproved();
        if (registeredVault[vault]) revert InvalidAddress();
        _validateLimits(limits_);
        registeredVault[vault] = true;
        vaultKind[vault] = kind;
        vaultAsset[vault] = asset;
        vaultProtocol[vault] = protocol;
        _vaultLimits[vault] = limits_;
        emit VaultRegistered(vault, kind, asset, protocol);
    }

    function queueVaultLimits(address vault, Limits calldata next) external onlyGovernor {
        if (!registeredVault[vault]) revert VaultDisabled();
        _validateLimits(next);
        bytes32 policyHash = keccak256(abi.encode(vault, next));
        _pendingLimits[vault] = next;
        pendingLimitsHash[vault] = policyHash;
        uint48 eta = uint48(block.timestamp + policyDelay);
        pendingLimitsAt[vault] = eta;
        emit VaultLimitsQueued(vault, policyHash, eta);
    }

    function executeVaultLimits(address vault) external {
        uint48 eta = pendingLimitsAt[vault];
        if (eta == 0 || pendingLimitsHash[vault] == bytes32(0)) revert NoPendingChange();
        if (block.timestamp < eta) revert PolicyNotReady(eta);
        Limits memory next = _pendingLimits[vault];
        bytes32 policyHash = pendingLimitsHash[vault];
        delete _pendingLimits[vault];
        delete pendingLimitsAt[vault];
        delete pendingLimitsHash[vault];
        _vaultLimits[vault] = next;
        emit VaultLimitsChanged(vault, policyHash);
    }

    function validateInvestment(
        address vault,
        address protocol,
        address asset,
        uint256 amount,
        uint256 nav
    ) external view override {
        if (msg.sender != vault || !accessController.hasRole(accessController.VAULT_ROLE(), msg.sender)) revert NotVault();
        _requireOperational(vault);
        if (asset != vaultAsset[vault] || !isAssetAllowed[asset]) revert AssetNotApproved();
        if (protocol != vaultProtocol[vault] || !isProtocolAllowed[protocol]) revert ProtocolNotApproved();
        Limits memory p = _vaultLimits[vault];
        if (!p.enabled) revert VaultDisabled();
        address adapter = ICollectiveVaultAdapterView(vault).strategyAdapter();
        if (adapter.code.length == 0) revert VaultDisabled();
        (uint256 assetPrice, uint8 assetDecimals) = _checkTradeValue(vault, adapter, asset, amount, nav, p);
        uint256 targetWithdrawable = IERC4626(protocol).maxWithdraw(adapter);
        uint256 prospectiveLiquidityUsd = Math.mulDiv(targetWithdrawable + amount, assetPrice, 10 ** assetDecimals);
        if (prospectiveLiquidityUsd < p.minLiquidityUsdE8) revert LiquidityTooLow();
    }

    function validateSwap(
        address vault,
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        uint256 quotedAmountOut
    ) external view override {
        if (!accessController.hasRole(accessController.EXECUTION_ROUTER_ROLE(), msg.sender)) revert NotExecutionRouter();
        _requireOperational(vault);
        if (!registeredVault[vault] || vaultKind[vault] != KIND_APPROVED_TRADING) revert VaultDisabled();
        if (!isRouterAllowed[router]) revert RouterNotApproved();
        if (!isAssetAllowed[tokenIn] || !isAssetAllowed[tokenOut] || tokenIn == tokenOut) revert AssetNotApproved();
        Limits memory p = _vaultLimits[vault];
        if (!p.enabled) revert VaultDisabled();
        if (amountIn == 0 || amountOutMin == 0 || quotedAmountOut < amountOutMin) revert SlippageTooHigh();

        (uint256 inPrice, uint8 inDecimals) = _freshPrice(tokenIn, p.maxOracleAgeSeconds);
        (uint256 outPrice, uint8 outDecimals) = _freshPrice(tokenOut, p.maxOracleAgeSeconds);
        uint256 inputUsd = Math.mulDiv(amountIn, inPrice, 10 ** inDecimals);
        uint256 minOutUsd = Math.mulDiv(amountOutMin, outPrice, 10 ** outDecimals);
        uint256 quoteOutUsd = Math.mulDiv(quotedAmountOut, outPrice, 10 ** outDecimals);
        uint256 minValueUsd = Math.mulDiv(inputUsd, BPS - p.maxSlippageBps, BPS);
        if (minOutUsd < minValueUsd || quoteOutUsd < minValueUsd) revert SlippageTooHigh();
        if (inputUsd > p.maxTradeUsdE8) revert TradeTooLarge();

        uint256 nav = IStrategyVault(vault).totalAssets();
        address accountingAsset = IStrategyVault(vault).asset();
        (uint256 navPrice, uint8 navDecimals) = _freshPrice(accountingAsset, p.maxOracleAgeSeconds);
        uint256 navUsd = Math.mulDiv(nav, navPrice, 10 ** navDecimals);
        if (inputUsd > Math.mulDiv(navUsd, p.maxAllocationBps, BPS)) revert AllocationCapExceeded();

        uint256 currentOut = IERC20(tokenOut).balanceOf(vault);
        uint256 postTradeOutUsd = Math.mulDiv(currentOut + amountOutMin, outPrice, 10 ** outDecimals);
        if (postTradeOutUsd > Math.mulDiv(navUsd, p.maxConcentrationBps, BPS)) revert ConcentrationCapExceeded();

        (uint256 liquidityUsd, uint64 liquidityAt) = liquidityOracle.pairLiquidityUsdE8(router, tokenIn, tokenOut);
        _requireFresh(router, liquidityAt, p.maxOracleAgeSeconds);
        if (liquidityUsd < p.minLiquidityUsdE8) revert LiquidityTooLow();
        _checkTransactionCost(p);
    }

    function _requireOperational(address vault) private view {
        if (emergencyModule.paused()) revert EmergencyPaused();
        if (!registeredVault[vault] || !isKindEnabled[vaultKind[vault]]) revert VaultDisabled();
    }

    function _checkTradeValue(
        address vault,
        address adapter,
        address token,
        uint256 amount,
        uint256 nav,
        Limits memory p
    ) private view returns (uint256 price, uint8 decimals_) {
        if (amount == 0) revert TradeTooLarge();
        (price, decimals_) = _freshPrice(token, p.maxOracleAgeSeconds);
        uint256 valueUsd = Math.mulDiv(amount, price, 10 ** decimals_);
        if (valueUsd > p.maxTradeUsdE8) revert TradeTooLarge();
        (uint256 navPrice, uint8 navDecimals) = _freshPrice(vaultAsset[vault], p.maxOracleAgeSeconds);
        uint256 navUsd = Math.mulDiv(nav, navPrice, 10 ** navDecimals);
        uint256 currentStrategyUsd = Math.mulDiv(
            ICollectiveStrategyValueView(adapter).totalAssets(), price, 10 ** decimals_
        );
        uint256 postInvestmentUsd = currentStrategyUsd + valueUsd;
        if (postInvestmentUsd > Math.mulDiv(navUsd, p.maxAllocationBps, BPS)) revert AllocationCapExceeded();
        if (postInvestmentUsd > Math.mulDiv(navUsd, p.maxConcentrationBps, BPS)) revert ConcentrationCapExceeded();
        _checkTransactionCost(p);
    }

    function _freshPrice(address token, uint32 maxAge) private view returns (uint256 price, uint8 decimals_) {
        if (token == address(0) || token.code.length == 0) revert OracleUnavailable(token);
        uint64 updatedAt;
        (price, updatedAt) = priceOracle.tokenPriceUsdE8(token);
        if (price == 0 || updatedAt == 0) revert OracleUnavailable(token);
        _requireFresh(token, updatedAt, maxAge);
        decimals_ = IERC20Metadata(token).decimals();
        if (decimals_ > 36) revert OracleUnavailable(token);
    }

    function _requireFresh(address token, uint64 updatedAt, uint32 maxAge) private view {
        if (updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > maxAge) {
            revert OracleStale(token, updatedAt);
        }
    }

    function _checkTransactionCost(Limits memory p) private view {
        (uint256 nativePrice, uint64 updatedAt) = priceOracle.nativePriceUsdE8();
        if (nativePrice == 0 || updatedAt == 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > p.maxOracleAgeSeconds) {
            revert OracleUnavailable(address(0));
        }
        uint256 gasCostUsdE8 = Math.mulDiv(tx.gasprice * MAX_SWAP_GAS_UNITS, nativePrice, 1e18);
        if (gasCostUsdE8 > p.maxTxCostUsdE8) revert TransactionCostTooHigh();
    }

    function _validateLimits(Limits calldata p) private pure {
        if (
            p.maxTradeUsdE8 == 0 || p.maxTxCostUsdE8 == 0 || p.minLiquidityUsdE8 == 0 ||
            p.maxAllocationBps == 0 || p.maxAllocationBps > BPS ||
            p.maxConcentrationBps == 0 || p.maxConcentrationBps > BPS ||
            p.maxSlippageBps > HARD_MAX_SLIPPAGE_BPS || p.reserveBps > HARD_MAX_RESERVE_BPS ||
            p.maxOracleAgeSeconds == 0 || p.maxOracleAgeSeconds > HARD_MAX_ORACLE_AGE
        ) revert InvalidLimits();
    }
}
