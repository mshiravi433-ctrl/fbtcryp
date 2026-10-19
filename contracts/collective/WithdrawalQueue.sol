// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IWithdrawalQueue, IStrategyVault} from "./interfaces/ICollective.sol";

/**
 * FIFO principal-redemption queue. Requests lock their share value at request
 * time; shares are burned by StrategyVault and the amount becomes an explicit
 * liability. Payments are permissionlessly processed in FIFO order, partially
 * when only partial cash is available. A blocked head request intentionally
 * blocks later requests; this is simple, public, and deterministic.
 */
contract WithdrawalQueue is IWithdrawalQueue {
    uint256 public constant MAX_PROCESS_ITEMS = 20;

    struct RequestData {
        address owner;
        uint256 shares;
        uint256 remainingAssets;
        uint64 requestedAt;
    }

    address public immutable vault;
    uint256 public override head = 1;
    uint256 public override nextId = 1;
    mapping(uint256 => RequestData) private _requests;

    event WithdrawalQueued(uint256 indexed id, address indexed owner, uint256 shares, uint256 assets);
    event WithdrawalPaid(uint256 indexed id, address indexed owner, uint256 assetsPaid, uint256 remainingAssets);

    error OnlyVault();
    error InvalidRequest();
    error InvalidBatchSize();

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor(address vault_) {
        require(vault_ != address(0), "ZERO_VAULT");
        vault = vault_;
    }

    function request(uint256 id)
        external view override returns (address owner, uint256 shares, uint256 remainingAssets, uint64 requestedAt)
    {
        RequestData storage item = _requests[id];
        return (item.owner, item.shares, item.remainingAssets, item.requestedAt);
    }

    function enqueue(address owner, uint256 shares, uint256 assets)
        external override onlyVault returns (uint256 id)
    {
        if (owner == address(0) || shares == 0 || assets == 0) revert InvalidRequest();
        id = nextId++;
        _requests[id] = RequestData({owner: owner, shares: shares, remainingAssets: assets, requestedAt: uint64(block.timestamp)});
        emit WithdrawalQueued(id, owner, shares, assets);
    }

    function process(uint256 maxItems)
        external override onlyVault returns (uint256 assetsPaid, uint256 itemsProcessed)
    {
        if (maxItems == 0 || maxItems > MAX_PROCESS_ITEMS) revert InvalidBatchSize();
        IStrategyVault vaultContract = IStrategyVault(vault);

        while (head < nextId && itemsProcessed < maxItems) {
            RequestData storage item = _requests[head];
            if (item.remainingAssets == 0) {
                head += 1;
                itemsProcessed += 1;
                continue;
            }
            uint256 available = vaultContract.queuedPayoutAvailable();
            if (available == 0) break;
            uint256 payment = available < item.remainingAssets ? available : item.remainingAssets;
            address recipient = item.owner;
            vaultContract.payoutQueuedClaim(recipient, payment);
            item.remainingAssets -= payment;
            assetsPaid += payment;
            emit WithdrawalPaid(head, recipient, payment, item.remainingAssets);
            if (item.remainingAssets == 0) {
                head += 1;
                itemsProcessed += 1;
            } else {
                // Preserve FIFO: a partially filled head must be funded before
                // later requests are touched.
                break;
            }
        }
    }
}
