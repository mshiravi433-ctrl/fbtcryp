// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/ICollectiveInterfaces.sol";

contract StrategyVault is IERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals = 18;

    address public immutable asset;
    address public owner;
    address public aiAgent;
    address public keeper;

    IRiskController public riskController;
    IEpochManager public epochManager;
    IRewardAccounting public rewardAccounting;
    IWithdrawalQueue public withdrawalQueue;

    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    bool public paused;
    uint256 public constant INITIAL_SHARE_PRICE = 1e18; // 1:1 initial

    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event AIAgentUpdated(address indexed newAgent);
    event KeeperUpdated(address indexed newKeeper);
    event StrategyExecuted(address indexed targetRouter, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event EmergencyPaused(bool isPaused);

    modifier onlyOwner() {
        require(msg.sender == owner, "Vault: not owner");
        _;
    }

    modifier onlyAIAgent() {
        require(msg.sender == aiAgent, "Vault: not AI agent");
        _;
    }

    modifier onlyKeeperOrOwner() {
        require(msg.sender == keeper || msg.sender == owner, "Vault: not authorized");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Vault: paused");
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        address _asset,
        address _owner,
        address _aiAgent,
        address _keeper,
        address _riskController,
        address _epochManager
    ) {
        require(_asset != address(0), "Zero asset");
        name = _name;
        symbol = _symbol;
        asset = _asset;
        owner = _owner;
        aiAgent = _aiAgent;
        keeper = _keeper;
        riskController = IRiskController(_riskController);
        epochManager = IEpochManager(_epochManager);
    }

    function setRewardAccounting(address _rewardAccounting) external onlyOwner {
        rewardAccounting = IRewardAccounting(_rewardAccounting);
    }

    function setWithdrawalQueue(address _withdrawalQueue) external onlyOwner {
        withdrawalQueue = IWithdrawalQueue(_withdrawalQueue);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit EmergencyPaused(_paused);
    }

    function totalAssets() public view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply;
        uint256 total = totalAssets();
        if (supply == 0 || total == 0) {
            return assets;
        }
        return (assets * supply) / total;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply;
        if (supply == 0) return shares;
        return (shares * totalAssets()) / supply;
    }

    function deposit(uint256 assets, address receiver) external whenNotPaused returns (uint256 shares) {
        require(assets > 0, "Zero assets");
        shares = convertToShares(assets);
        require(shares > 0, "Zero shares minted");

        require(IERC20(asset).transferFrom(msg.sender, address(this), assets), "Transfer failed");

        totalSupply += shares;
        balanceOf[receiver] += shares;

        if (address(rewardAccounting) != address(0)) {
            rewardAccounting.onShareBalanceChange(receiver);
        }

        emit Transfer(address(0), receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
        return shares;
    }

    function requestWithdrawal(uint256 shares) external whenNotPaused returns (uint256) {
        require(balanceOf[msg.sender] >= shares, "Insufficient balance");
        require(address(withdrawalQueue) != address(0), "Queue not set");
        return withdrawalQueue.requestWithdrawal(msg.sender, shares);
    }

    function claimRealizedProfit() external returns (uint256) {
        require(address(rewardAccounting) != address(0), "No reward module");
        return rewardAccounting.claimReward(msg.sender);
    }

    function executeAIProposal(
        address targetRouter,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata callData
    ) external onlyAIAgent whenNotPaused returns (uint256 amountOut) {
        require(riskController.validateTrade(tokenIn, tokenOut, amountIn, minAmountOut, targetRouter), "Trade rejected by RiskController");

        uint256 balanceBefore = IERC20(tokenOut).balanceOf(address(this));
        IERC20(tokenIn).approve(targetRouter, amountIn);

        (bool success, ) = targetRouter.call(callData);
        require(success, "Router call execution failed");

        uint256 balanceAfter = IERC20(tokenOut).balanceOf(address(this));
        require(balanceAfter >= balanceBefore + minAmountOut, "Slippage exceeded");
        amountOut = balanceAfter - balanceBefore;

        emit StrategyExecuted(targetRouter, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ERC-20 implementation
    function transfer(address recipient, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Balance low");
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        if (address(rewardAccounting) != address(0)) {
            rewardAccounting.onShareBalanceChange(msg.sender);
            rewardAccounting.onShareBalanceChange(recipient);
        }
        emit Transfer(msg.sender, recipient, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external override returns (bool) {
        require(balanceOf[sender] >= amount, "Balance low");
        require(allowance[sender][msg.sender] >= amount, "Allowance exceeded");
        allowance[sender][msg.sender] -= amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        if (address(rewardAccounting) != address(0)) {
            rewardAccounting.onShareBalanceChange(sender);
            rewardAccounting.onShareBalanceChange(recipient);
        }
        emit Transfer(sender, recipient, amount);
        return true;
    }
}
