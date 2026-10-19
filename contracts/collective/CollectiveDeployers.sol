// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {AccessController} from "./AccessController.sol";
import {ICollectiveAccessController, IEmergencyModule, IRiskController, IEpochManager, IStrategyAdapter, IWithdrawalQueue} from "./interfaces/ICollective.sol";
import {StrategyVault} from "./StrategyVault.sol";
import {EpochManager} from "./EpochManager.sol";
import {StrategyAdapter} from "./StrategyAdapter.sol";
import {WithdrawalQueue} from "./WithdrawalQueue.sol";

/**
 * Deployment helpers keep CollectiveFactory under EIP-170. Each helper is
 * permissionlessly deployable but becomes usable only after the multisig binds
 * the one authorized CollectiveFactory address.
 */
contract StrategyVaultDeployer {
    AccessController public immutable accessController;
    IEmergencyModule public immutable emergencyModule;
    IRiskController public immutable riskController;
    address public immutable executionRouter;
    address public factory;

    error NotGovernor();
    error NotFactory();
    error FactoryAlreadySet();
    error InvalidFactory();

    constructor(
        AccessController access_,
        IEmergencyModule emergency_,
        IRiskController risk_,
        address executionRouter_
    ) {
        require(address(access_).code.length != 0 && address(emergency_).code.length != 0 && address(risk_).code.length != 0, "ZERO_CONTROL");
        require(executionRouter_.code.length != 0, "ROUTER_NO_CODE");
        accessController = access_;
        emergencyModule = emergency_;
        riskController = risk_;
        executionRouter = executionRouter_;
    }

    function setFactory(address factory_) external {
        if (!accessController.hasRole(accessController.GOVERNOR_ROLE(), msg.sender)) revert NotGovernor();
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_.code.length == 0) revert InvalidFactory();
        factory = factory_;
    }

    function deploy(IERC20 asset_, string calldata name_, string calldata symbol_)
        external returns (StrategyVault vault)
    {
        if (msg.sender != factory || factory == address(0)) revert NotFactory();
        vault = new StrategyVault(
            asset_, name_, symbol_,
            ICollectiveAccessController(address(accessController)),
            emergencyModule,
            riskController,
            factory,
            executionRouter
        );
    }
}

contract CollectiveModulesDeployer {
    ICollectiveAccessController public immutable accessController;
    address public factory;

    error NotGovernor();
    error NotFactory();
    error FactoryAlreadySet();
    error InvalidFactory();

    constructor(ICollectiveAccessController access_) {
        require(address(access_).code.length != 0, "ZERO_ACCESS");
        accessController = access_;
    }

    function setFactory(address factory_) external {
        if (!accessController.hasRole(accessController.GOVERNOR_ROLE(), msg.sender)) revert NotGovernor();
        if (factory != address(0)) revert FactoryAlreadySet();
        if (factory_.code.length == 0) revert InvalidFactory();
        factory = factory_;
    }

    function deploy(address vault, IERC20 asset_, IERC4626 target_)
        external returns (IEpochManager epoch, IStrategyAdapter adapter, IWithdrawalQueue queue)
    {
        if (msg.sender != factory || factory == address(0)) revert NotFactory();
        epoch = IEpochManager(address(new EpochManager(vault)));
        adapter = IStrategyAdapter(address(new StrategyAdapter(vault, asset_, target_)));
        queue = IWithdrawalQueue(address(new WithdrawalQueue(vault)));
    }
}
