// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ICollectiveInterfaces.sol";

contract RiskController is IRiskController {
    address public owner;
    address public guardian;

    uint256 public override maxSlippageBps = 100; // 1.00% max slippage
    uint256 public override maxConcentrationBps = 3000; // 30% max per single position
    uint256 public maxTradeSizeUsd = 50000 * 1e18; // Max 50k USD per automated trade

    mapping(address => bool) public override isApprovedRouter;
    mapping(address => bool) public override isApprovedToken;
    mapping(address => bool) public override isApprovedProtocol;

    event RouterApprovalUpdated(address indexed router, bool approved);
    event TokenApprovalUpdated(address indexed token, bool approved);
    event ProtocolApprovalUpdated(address indexed protocol, bool approved);
    event RiskParamsUpdated(uint256 slippageBps, uint256 concentrationBps, uint256 tradeSize);

    modifier onlyOwner() {
        require(msg.sender == owner, "RiskController: caller is not owner");
        _;
    }

    modifier onlyGuardianOrOwner() {
        require(msg.sender == owner || msg.sender == guardian, "RiskController: unauthorized");
        _;
    }

    constructor(address _owner, address _guardian) {
        require(_owner != address(0), "Invalid owner");
        owner = _owner;
        guardian = _guardian;
    }

    function setApprovedRouter(address router, bool approved) external onlyOwner {
        isApprovedRouter[router] = approved;
        emit RouterApprovalUpdated(router, approved);
    }

    function setApprovedToken(address token, bool approved) external onlyOwner {
        isApprovedToken[token] = approved;
        emit TokenApprovalUpdated(token, approved);
    }

    function setApprovedProtocol(address protocol, bool approved) external onlyOwner {
        isApprovedProtocol[protocol] = approved;
        emit ProtocolApprovalUpdated(protocol, approved);
    }

    function setRiskParameters(
        uint256 _maxSlippageBps,
        uint256 _maxConcentrationBps,
        uint256 _maxTradeSizeUsd
    ) external onlyOwner {
        require(_maxSlippageBps <= 500, "Slippage too high"); // Max 5% hard guard
        require(_maxConcentrationBps <= 5000, "Concentration too high"); // Max 50%
        maxSlippageBps = _maxSlippageBps;
        maxConcentrationBps = _maxConcentrationBps;
        maxTradeSizeUsd = _maxTradeSizeUsd;
        emit RiskParamsUpdated(_maxSlippageBps, _maxConcentrationBps, _maxTradeSizeUsd);
    }

    function validateTrade(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address targetRouter
    ) external view override returns (bool) {
        if (!isApprovedRouter[targetRouter]) return false;
        if (!isApprovedToken[tokenIn]) return false;
        if (!isApprovedToken[tokenOut]) return false;
        if (amountIn == 0 || minAmountOut == 0) return false;
        return true;
    }
}
