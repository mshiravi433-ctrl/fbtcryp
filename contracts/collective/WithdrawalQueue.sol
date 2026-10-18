// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ICollectiveInterfaces.sol";

contract WithdrawalQueue is IWithdrawalQueue {
    struct WithdrawalRequest {
        address user;
        uint256 shares;
        uint256 epochRequested;
        bool processed;
        bool cancelled;
    }

    address public immutable vault;
    IEpochManager public immutable epochManager;

    WithdrawalRequest[] public requests;
    uint256 public nextProcessIndex;
    mapping(address => uint256) public userPendingShares;

    event WithdrawalRequested(uint256 indexed requestId, address indexed user, uint256 shares, uint256 epoch);
    event WithdrawalCancelled(uint256 indexed requestId, address indexed user, uint256 shares);
    event WithdrawalProcessed(uint256 indexed requestId, address indexed user, uint256 shares);

    modifier onlyVault() {
        require(msg.sender == vault, "Only vault allowed");
        _;
    }

    constructor(address _vault, address _epochManager) {
        vault = _vault;
        epochManager = IEpochManager(_epochManager);
    }

    function getUserPendingShares(address user) external view override returns (uint256) {
        return userPendingShares[user];
    }

    function totalRequests() external view returns (uint256) {
        return requests.length;
    }

    function requestWithdrawal(address user, uint256 shares) external override onlyVault returns (uint256) {
        require(shares > 0, "Zero shares");
        require(epochManager.isWithdrawalWindowOpen(), "Withdrawal window is closed");

        uint256 currentEp = epochManager.currentEpoch();
        uint256 reqId = requests.length;

        requests.push(WithdrawalRequest({
            user: user,
            shares: shares,
            epochRequested: currentEp,
            processed: false,
            cancelled: false
        }));

        userPendingShares[user] += shares;
        emit WithdrawalRequested(reqId, user, shares, currentEp);
        return reqId;
    }

    function cancelWithdrawal(uint256 requestId) external override onlyVault {
        require(requestId < requests.length, "Invalid request ID");
        WithdrawalRequest storage req = requests[requestId];
        require(!req.processed, "Already processed");
        require(!req.cancelled, "Already cancelled");

        req.cancelled = true;
        if (userPendingShares[req.user] >= req.shares) {
            userPendingShares[req.user] -= req.shares;
        } else {
            userPendingShares[req.user] = 0;
        }

        emit WithdrawalCancelled(requestId, req.user, req.shares);
    }

    function processQueue(uint256 maxCount) external override onlyVault returns (uint256 processedCount) {
        uint256 currentEp = epochManager.currentEpoch();
        uint256 count = 0;

        while (nextProcessIndex < requests.length && count < maxCount) {
            WithdrawalRequest storage req = requests[nextProcessIndex];
            // Process requests from prior epochs or currently ready
            if (!req.processed && !req.cancelled && req.epochRequested < currentEp) {
                req.processed = true;
                if (userPendingShares[req.user] >= req.shares) {
                    userPendingShares[req.user] -= req.shares;
                }
                emit WithdrawalProcessed(nextProcessIndex, req.user, req.shares);
                count++;
            }
            nextProcessIndex++;
        }
        return count;
    }
}
