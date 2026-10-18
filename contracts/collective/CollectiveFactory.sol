// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./StrategyVault.sol";
import "./RiskController.sol";
import "./EpochManager.sol";
import "./RewardAccounting.sol";
import "./WithdrawalQueue.sol";

contract CollectiveFactory {
    address public owner;
    address public defaultGuardian;
    address public defaultAIAgent;
    address public defaultKeeper;
    address public immutable usdtToken;

    struct VaultInfo {
        address vault;
        address asset;
        string vaultType;
        uint256 createdAt;
    }

    VaultInfo[] public allVaults;

    event VaultCreated(address indexed vault, address indexed asset, string vaultType);

    modifier onlyOwner() {
        require(msg.sender == owner, "Factory: not owner");
        _;
    }

    constructor(
        address _owner,
        address _guardian,
        address _aiAgent,
        address _keeper,
        address _usdt
    ) {
        owner = _owner;
        defaultGuardian = _guardian;
        defaultAIAgent = _aiAgent;
        defaultKeeper = _keeper;
        usdtToken = _usdt;
    }

    function createVault(
        string memory name,
        string memory symbol,
        address asset,
        string memory vaultType
    ) external onlyOwner returns (address) {
        RiskController rc = new RiskController(owner, defaultGuardian);
        EpochManager em = new EpochManager(owner, defaultKeeper);

        StrategyVault vault = new StrategyVault(
            name,
            symbol,
            asset,
            owner,
            defaultAIAgent,
            defaultKeeper,
            address(rc),
            address(em)
        );

        RewardAccounting ra = new RewardAccounting(address(vault), usdtToken);
        WithdrawalQueue wq = new WithdrawalQueue(address(vault), address(em));

        vault.setRewardAccounting(address(ra));
        vault.setWithdrawalQueue(address(wq));

        allVaults.push(VaultInfo({
            vault: address(vault),
            asset: asset,
            vaultType: vaultType,
            createdAt: block.timestamp
        }));

        emit VaultCreated(address(vault), asset, vaultType);
        return address(vault);
    }

    function getVaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
