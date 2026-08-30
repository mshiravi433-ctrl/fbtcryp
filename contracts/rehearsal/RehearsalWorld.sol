// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * FBT Flash Liquidity — REHEARSAL WORLD (local EVM only, never mainnet)
 *
 * Minimal external world for the Level-2 fork-style rehearsal on a local EVM
 * (sandbox has no chain egress for a real mainnet fork):
 *
 *   - MockERC20: standard token (6 or 18 decimals) with a rehearsal-only mint.
 *   - FlashVaultHarness: replicates Balancer V2 Vault flash-loan SEMANTICS —
 *     transfer out, single callback, then require every token back (else the
 *     whole transaction reverts). Fee-free by default like Balancer, with an
 *     optional premium to exercise feeAmounts handling.
 *   - MiniPair: constant-product pair whose price math is byte-identical to
 *     the planner's `constantProductOut` (0.30% fee), with an approve-based
 *     `swap*To*` entry that fits the router's Hop model (approve → call).
 *
 * The FBT stack under test (router, planner, simulation gate, signing flow)
 * is the REAL production code — only the counterparties are harnesses, and
 * every report produced from this file must say so.
 */

interface IERC20R {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "ALLOWANCE");
            allowance[from][msg.sender] = allowed - amount;
        }
        return _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "BALANCE");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

interface IFlashLoanCallback {
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external;
}

/// @dev Balancer V2 Vault flash-loan semantics: optimistic transfer, one
///      callback, then every token must be back (+ fee) or the WHOLE
///      transaction reverts. This enforcement is the property under test.
contract FlashVaultHarness {
    address public owner;
    uint256 public premiumBps; // 0 like Balancer today

    error BALANCE_NOT_REPAID();
    error NOT_OWNER();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NOT_OWNER();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setPremiumBps(uint256 bps) external onlyOwner {
        premiumBps = bps;
    }

    function flashLoan(
        address recipient,
        address[] calldata tokens,
        uint256[] calldata amounts,
        bytes calldata userData
    ) external {
        uint256[] memory feeAmounts = new uint256[](tokens.length);
        uint256[] memory before = new uint256[](tokens.length);
        for (uint256 i; i < tokens.length; ++i) {
            before[i] = IERC20R(tokens[i]).balanceOf(address(this));
            feeAmounts[i] = (amounts[i] * premiumBps) / 10000;
            require(IERC20R(tokens[i]).transfer(recipient, amounts[i]), "LEND_FAILED");
        }
        IFlashLoanCallback(recipient).receiveFlashLoan(tokens, amounts, feeAmounts, userData);
        for (uint256 i; i < tokens.length; ++i) {
            if (IERC20R(tokens[i]).balanceOf(address(this)) < before[i] + feeAmounts[i]) {
                revert BALANCE_NOT_REPAID();
            }
        }
    }
}

/// @dev Constant-product pair, prices read from token balances (V2-style
///      implicit sync), 0.30% fee — the exact formula the off-chain planner
///      uses, so predicted outputs are deterministic to the wei.
contract MiniPair {
    uint256 public constant BPS = 10_000;
    uint256 public constant FEE_BPS = 30;

    IERC20R public immutable tokenA; // settlement side in the reports
    IERC20R public immutable tokenB;

    constructor(address _tokenA, address _tokenB) {
        tokenA = IERC20R(_tokenA);
        tokenB = IERC20R(_tokenB);
    }

    function reserves() external view returns (uint256 ra, uint256 rb) {
        ra = tokenA.balanceOf(address(this));
        rb = tokenB.balanceOf(address(this));
    }

    /// Pull `amountIn` of A from the caller (router pre-approves this pair),
    /// pay B out to `to`. Matches Hop { tokenIn: A, outToken: B }.
    function swapAtoB(uint256 amountIn, uint256 amountOutMin, address to, bytes calldata) external returns (uint256) {
        return _swap(tokenA, tokenB, amountIn, amountOutMin, to);
    }

    /// Pull `amountIn` of B from the caller, pay A out to `to`.
    function swapBtoA(uint256 amountIn, uint256 amountOutMin, address to, bytes calldata) external returns (uint256) {
        return _swap(tokenB, tokenA, amountIn, amountOutMin, to);
    }

    function _swap(
        IERC20R inToken,
        IERC20R outToken,
        uint256 amountIn,
        uint256 amountOutMin,
        address to
    ) internal returns (uint256 amountOut) {
        require(amountIn > 0, "ZERO_IN");
        uint256 rIn = inToken.balanceOf(address(this));
        uint256 rOut = outToken.balanceOf(address(this));
        uint256 inWithFee = amountIn * (BPS - FEE_BPS);
        amountOut = (inWithFee * rOut) / (rIn * BPS + inWithFee);
        require(amountOut >= amountOutMin, "MIN_OUT");
        require(inToken.transferFrom(msg.sender, address(this), amountIn), "PULL_FAILED");
        require(outToken.transfer(to, amountOut), "PAY_FAILED");
    }
}
