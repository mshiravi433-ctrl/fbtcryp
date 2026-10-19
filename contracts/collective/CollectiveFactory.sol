// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {AccessController} from "./AccessController.sol";
import {IEmergencyModule, IRiskController, ICollectiveAccessController, IEpochManager, IStrategyAdapter, IWithdrawalQueue} from "./interfaces/ICollective.sol";
import {StrategyVault} from "./StrategyVault.sol";

interface IStrategyVaultDeployer {
    function factory() external view returns (address);
    function deploy(IERC20 asset, string calldata name, string calldata symbol) external returns (StrategyVault vault);
}

interface ICollectiveModulesDeployer {
    function factory() external view returns (address);
    function deploy(address vault, IERC20 asset, IERC4626 target)
        external returns (IEpochManager epoch, IStrategyAdapter adapter, IWithdrawalQueue queue);
}

/**
 * Creates isolated vault deployments. v1 intentionally creates only the
 * stable-yield kind and requires one deployment-configured USDT accounting
 * token plus one allowlisted ERC-4626 target. Farming/LP and trading kinds are
 * rejected until their distinct valuation/accounting adapters pass review.
 */
contract CollectiveFactory {
    uint8 public constant KIND_STABLE_YIELD = 0;
    uint8 public constant KIND_FARMING_LP = 1;
    uint8 public constant KIND_APPROVED_TRADING = 2;
    uint256 public constant MAX_VAULTS = 32;

    AccessController public immutable accessController;
    IEmergencyModule public immutable emergencyModule;
    IRiskController public immutable riskController;
    address public immutable executionRouter;
    IERC20 public immutable usdt;
    IStrategyVaultDeployer public immutable vaultDeployer;
    ICollectiveModulesDeployer public immutable modulesDeployer;

    address[] private _vaults;
    mapping(address => uint8) public vaultKind;
    mapping(address => address) public vaultAdapter;

    event CollectiveVaultCreated(
        address indexed vault,
        address indexed adapter,
        address indexed target,
        address asset,
        uint8 kind,
        uint256 index
    );

    error NotGovernor();
    error InvalidAddress();
    error UnsupportedAccountingAsset();
    error UnsupportedStrategyKind();
    error StrategyNotApproved();
    error VaultLimitReached();
    error KindDisabled();
    error InvalidTokenDecimals();
    error DeployersNotBound();

    modifier onlyGovernor() {
        if (!accessController.hasRole(accessController.GOVERNOR_ROLE(), msg.sender)) revert NotGovernor();
        _;
    }

    constructor(
        AccessController access_,
        IEmergencyModule emergency_,
        IRiskController risk_,
        address executionRouter_,
        IERC20 usdt_,
        IStrategyVaultDeployer vaultDeployer_,
        ICollectiveModulesDeployer modulesDeployer_
    ) {
        if (
            address(access_).code.length == 0 || address(emergency_).code.length == 0 ||
            address(risk_).code.length == 0 || executionRouter_.code.length == 0 ||
            address(usdt_).code.length == 0 || address(vaultDeployer_).code.length == 0 ||
            address(modulesDeployer_).code.length == 0
        ) revert InvalidAddress();
        uint8 decimals_ = IERC20Metadata(address(usdt_)).decimals();
        if (decimals_ > 18) revert InvalidTokenDecimals();
        accessController = access_;
        emergencyModule = emergency_;
        riskController = risk_;
        executionRouter = executionRouter_;
        usdt = usdt_;
        vaultDeployer = vaultDeployer_;
        modulesDeployer = modulesDeployer_;
    }

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    function vaultAt(uint256 index) external view returns (address) {
        return _vaults[index];
    }

    function allVaults() external view returns (address[] memory) {
        return _vaults;
    }

    function createStableYieldVault(
        string calldata name,
        string calldata symbol,
        IERC4626 target,
        IRiskController.Limits calldata limits_
    ) external onlyGovernor returns (address vaultAddress) {
        if (_vaults.length >= MAX_VAULTS) revert VaultLimitReached();
        if (!riskController.isKindEnabled(KIND_STABLE_YIELD)) revert KindDisabled();
        if (!riskController.isAssetAllowed(address(usdt))) revert UnsupportedAccountingAsset();
        if (address(target).code.length == 0 || target.asset() != address(usdt)) revert StrategyNotApproved();
        if (!riskController.isProtocolAllowed(address(target))) revert StrategyNotApproved();
        if (!limits_.enabled) revert KindDisabled();
        if (vaultDeployer.factory() != address(this) || modulesDeployer.factory() != address(this)) revert DeployersNotBound();

        StrategyVault vault = vaultDeployer.deploy(usdt, name, symbol);
        (IEpochManager epoch, IStrategyAdapter adapter, IWithdrawalQueue queue) =
            modulesDeployer.deploy(address(vault), usdt, target);
        vault.bindModules(epoch, adapter, queue);

        accessController.registerVault(address(vault));
        riskController.registerVault(address(vault), KIND_STABLE_YIELD, address(usdt), address(target), limits_);

        vaultAddress = address(vault);
        vaultKind[vaultAddress] = KIND_STABLE_YIELD;
        vaultAdapter[vaultAddress] = address(adapter);
        _vaults.push(vaultAddress);
        emit CollectiveVaultCreated(
            vaultAddress,
            address(adapter),
            address(target),
            address(usdt),
            KIND_STABLE_YIELD,
            _vaults.length - 1
        );
    }

    /** Explicitly records later strategy lanes as not enabled in v1. */
    function createDeferredVault(uint8 kind) external pure returns (address) {
        if (kind != KIND_FARMING_LP && kind != KIND_APPROVED_TRADING) revert UnsupportedStrategyKind();
        revert UnsupportedStrategyKind();
    }
}
