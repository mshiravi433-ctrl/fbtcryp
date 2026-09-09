// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * FBT SplitRouter — REHEARSAL WORLD (local EVM only, never mainnet)
 * ---------------------------------------------------------------------------
 * Minimal counterparties for test/split-router/split-router-evm-rehearsal.mjs
 * (ganache, in-process). The sandbox has no chain egress for a real fork —
 * same constraint that produced RehearsalWorld.sol for the flash router.
 *
 * Every mock mirrors the EXACT external surface FBTSplitRouter calls:
 *
 *   · MockAavePool.supply(address,uint256,address,uint16)
 *   · MockComet.supply(address,uint256) + ERC20 transfer/balanceOf
 *   · MockMorpho.supply(MarketParams,uint256,uint256,address,bytes)
 *   · MockLido.submit(address) payable + stETH-style transfer/balanceOf
 *
 * …so the SAME production artifact that ships to mainnet is what the rehearsal
 * deploys and exercises. The contract under test is the REAL compiled
 * FBTSplitRouter — only the counterparties are harnesses, and any report
 * produced from this file must say so. Mainnet-state validation lives in
 * split-router-fork-rehearsal.mjs (anvil, real protocols).
 */

interface IERC20M {
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

    /// Rehearsal-only faucet. The production router never calls this.
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MOCK_ERC20_INSUFFICIENT");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "MOCK_ERC20_ALLOWANCE");
        require(balanceOf[from] >= amount, "MOCK_ERC20_INSUFFICIENT");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// Aave v3 Pool semantics: pull the asset from msg.sender, credit "aTokens"
/// to onBehalfOf, record the call for assertions.
contract MockAavePool {
    mapping(address => uint256) public aTokenBalanceOf;
    address public lastAsset;
    uint256 public lastAmount;
    address public lastOnBehalfOf;
    uint16 public lastReferralCode;
    bool public strictReferralZero;

    constructor(bool _strictReferralZero) {
        strictReferralZero = _strictReferralZero;
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external {
        if (strictReferralZero) require(referralCode == 0, "MOCK_AAVE_REFERRAL_MUST_BE_ZERO");
        IERC20M(asset).transferFrom(msg.sender, address(this), amount);
        aTokenBalanceOf[onBehalfOf] += amount;
        lastAsset = asset;
        lastAmount = amount;
        lastOnBehalfOf = onBehalfOf;
        lastReferralCode = referralCode;
    }
}

/// Compound III Comet semantics: supply() credits the base ERC20 balance to
/// msg.sender (the router), who must hand it over. transfer() moves position
/// and tracking together — exactly what the real Comet ERC20 does.
contract MockComet {
    mapping(address => uint256) public balanceOf;
    address public lastAsset;
    uint256 public lastAmount;
    address public lastSupplier;

    function supply(address asset, uint256 amount) external {
        IERC20M(asset).transferFrom(msg.sender, address(this), amount);
        balanceOf[msg.sender] += amount;
        lastAsset = asset;
        lastAmount = amount;
        lastSupplier = msg.sender;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MOCK_COMET_INSUFFICIENT");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// Morpho Blue semantics: the market id is keccak256(abi.encode(marketParams));
/// supply() pulls from msg.sender and credits shares to onBehalf.
contract MockMorpho {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    mapping(address => uint256) public supplyAssetsOf;
    MarketParams public lastMarketParams;
    address public lastOnBehalf;
    bytes public lastData;

    function idOf(MarketParams calldata marketParams) external pure returns (bytes32) {
        return keccak256(abi.encode(marketParams));
    }

    function supply(
        MarketParams calldata marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes calldata data
    ) external returns (uint256 assetsSupplied, uint256 sharesSupplied) {
        require(assets > 0 || shares > 0, "MOCK_MORPHO_ZERO");
        IERC20M(marketParams.loanToken).transferFrom(msg.sender, address(this), assets);
        supplyAssetsOf[onBehalf] += assets;
        lastMarketParams = marketParams;
        lastOnBehalf = onBehalf;
        lastData = data;
        return (assets, assets);
    }
}

/// Lido semantics: submit() mints 1:1 stETH to msg.sender (the router), who
/// must transfer it on; a fee-on-top path exists to prove the router never
/// keeps a balance.
contract MockLido {
    mapping(address => uint256) public balanceOf;
    address public lastReferral;
    uint256 public totalSubmitted;

    function submit(address _referral) external payable {
        require(msg.value > 0, "MOCK_LIDO_ZERO");
        balanceOf[msg.sender] += msg.value;
        totalSubmitted += msg.value;
        lastReferral = _referral;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "MOCK_LIDO_INSUFFICIENT");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
