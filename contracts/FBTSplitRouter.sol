// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * FBT Swap — SplitRouter · کارمزدِ واریز، بدون نگهداری پول
 * ---------------------------------------------------------------------------
 *
 *   «میخواهیم کارمزد بگیریم اما پول دست ما نباشد»
 *
 * The five Farm execution adapters (Aave Base / Aave Arbitrum / Compound III
 * Base / Morpho Blue Base / Lido) deposit the user's money DIRECTLY into the
 * protocol from the user's own wallet — which is exactly why they earn the
 * platform nothing. This contract adds that revenue without taking custody:
 *
 *   user's USDC/ETH ──┬── fee (feeBps, ≤ 1%) ──→ feeRecipient   (payout wallet)
 *                     └── net amount ──────────→ the protocol, credited to the
 *                                             USER'S address, in the SAME
 *                                             transaction the user signed.
 *
 * ─── WHY THIS IS NOT CUSTODY ────────────────────────────────────────────────
 * The contract holds nothing between transactions. It cannot move a position:
 * aTokens land on the depositor (`onBehalfOf` is FORCED to msg.sender), the
 * Compound base balance is handed over inside the same call, stETH is
 * transferred to the depositor immediately, and every path ends with an
 * on-chain assertion that the router's own balance is ZERO. A withdraw never
 * touches this contract — exits stay exactly as they are today, direct from
 * protocol to wallet. If this contract disappeared tomorrow, every position
 * would still be withdrawable by its owner.
 *
 * ─── THE TRUST DESIGN: NOTHING CAN CHANGE AFTER DEPLOY ─────────────────────
 * Unlike FeeRouter (the swap-side sibling, which keeps an owner for fee
 * tuning), this contract has NO OWNER, NO admin functions, NO upgrade, NO
 * rescue:
 *
 *   · feeBps and feeRecipient are IMMUTABLE — set once at deploy, never
 *     mutable on-chain. Changing the fee means deploying a new contract and
 *     users explicitly approving that new address.
 *   · Every protocol destination (Aave Pool, Comet, Morpho, Lido) is an
 *     IMMUTABLE pinned address — there is no allowlist an admin key could
 *     repoint, and no generic `forward()` a caller could aim anywhere.
 *   · The Morpho market is pinned twice: by its five immutable parameters AND
 *     by a keccak check in the constructor that they hash to the declared
 *     market id. The router can only ever supply the one market the app
 *     adapter pins.
 *   · The fee is hard-capped at 1.00% (MAX_FEE_BPS = 100), the same ceiling
 *     the app enforces client-side in src/lib/feeBps.js. A fat-fingered
 *     constructor value cannot ship a 10% cut.
 *   · No `receive()` — plain ETH transfers bounce; the only payable entry is
 *     stakeLido(), which forwards everything within one transaction.
 *
 * The deliberate cost: tokens sent here by mistake are stuck forever. That is
 * the correct trade for a savings path — an admin key that can move value out
 * of a money path is a honeypot, and "owner can rescue" is how a router stops
 * being trustless. FeeRouter (swap path) made the opposite call; this is the
 * stricter one, on purpose.
 *
 * ─── DEPLOY SHAPE ───────────────────────────────────────────────────────────
 * One deployment PER CHAIN, targets pinned to that chain's addresses (the same
 * ones the app adapters pin — see src/lib/defi/*). Protocols absent on a chain
 * are passed as address(0) and their functions revert with ZERO_TARGET. The
 * asset is a single pinned token (native USDC everywhere except Lido, which
 * stakes native ETH). A second asset means a second deployment — smaller
 * surface than a multi-asset router.
 *
 * ─── INTERFACES MATCH THE REAL PROTOCOLS ────────────────────────────────────
 * The four protocol calls use the exact signatures the app adapters already
 * encode (verified by the selector cross-check in
 * test/split-router/split-router-contract-probe.mjs, and behaviourally by
 * test/split-router/split-router-evm-rehearsal.mjs on a local EVM plus
 * split-router-fork-rehearsal.mjs against forked mainnet state).
 *
 * NOT AUDITED. Production-shaped, deliberately minimal — but before any real
 * deposit is routed through it, get an independent professional audit and run
 * the strict fork rehearsal. A bug here takes a cut of other people's savings,
 * which is precisely the trust this contract exists to protect.
 */

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev Aave v3 Pool — the same surface src/lib/defi/aaveV3Base.js pins.
interface IAaveV3Pool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
}

/// @dev Compound III (Comet). supply() credits msg.sender with base tokens;
///      Comet itself is the base ERC20, so the balance (position, tracking and
///      rewards included — transfer() settles all of it) is handed to the user.
interface IComet {
    function supply(address asset, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @dev Morpho Blue. supply() takes MarketParams; the market id is
///      keccak256(abi.encode(marketParams)) — IdLib.id().
interface IMorphoBlue {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }
    function supply(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes calldata data
    ) external returns (uint256 assetsSupplied, uint256 sharesSupplied);
}

/// @dev Lido — the stETH token contract is also the staking entry. submit()
///      mints stETH to msg.sender, so the router forwards it immediately.
interface ILido {
    function submit(address _referral) external payable;
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract FBTSplitRouter {
    /* ----------------------------- constants ----------------------------- */

    uint256 public constant BPS_DENOMINATOR = 10_000;
    /// Hard ceiling. Not even the deploy transaction can exceed this.
    uint256 public constant MAX_FEE_BPS = 100; // 1.00%

    /**
     * The whole deployment in one value. A struct rather than a 13-argument
     * constructor: flatter on the stack, and a deployment is reviewed as ONE
     * object — every field is listed in docs/defi/SPLIT-ROUTER-FA.md with the
     * pinned value it must carry on each chain.
     */
    struct Config {
        address asset; // the one asset this router splits (native USDC)
        address aavePool; // Aave v3 Pool on this chain, or address(0)
        address comet; // Compound III Comet on this chain, or address(0)
        address morpho; // Morpho Blue on this chain, or address(0)
        address morphoLoanToken; // the pinned market's loan token
        address morphoCollateralToken; // the pinned market's collateral
        address morphoOracle; // the pinned market's oracle
        address morphoIrm; // the pinned market's IRM
        uint256 morphoLltv; // the pinned market's LLTV
        bytes32 morphoMarketId; // keccak256(abi.encode(marketParams)) — the pin
        address lido; // Lido (Ethereum only), or address(0)
        address feeRecipient; // the platform payout address
        uint256 feeBps; // ≤ MAX_FEE_BPS, immutable after deploy
    }

    /* ------------------------------ storage ------------------------------ */
    /*
     * Everything below is immutable: the contract has no way to change any of
     * it after deployment. This block IS the audit surface.
     */

    address public immutable feeRecipient;
    uint256 public immutable feeBps;
    IERC20 public immutable asset;

    IAaveV3Pool public immutable aavePool; // address(0) on chains without Aave
    IComet public immutable comet; // address(0) on chains without Compound III
    IMorphoBlue public immutable morpho; // address(0) on chains without Morpho
    ILido public immutable lido; // address(0) everywhere except Ethereum

    /*
     * Morpho Blue pins the ONE market the app adapter pins. Structs cannot be
     * immutable, so the five MarketParams fields are stored separately and
     * rebuilt at call time; the constructor proves they hash to the declared
     * market id, so `supplyMorpho` can only ever hit that exact market.
     */
    address public immutable morphoLoanToken;
    address public immutable morphoCollateralToken;
    address public immutable morphoOracle;
    address public immutable morphoIrm;
    uint256 public immutable morphoLltv;
    bytes32 public immutable morphoMarketId;

    /// Total fee collected, for dashboards. Same accounting FeeRouter keeps.
    uint256 public totalFeesCollected;

    uint256 private _locked = 1;

    /* ------------------------------- events ------------------------------ */

    /**
     * One event per routed deposit. `asset` is address(0) for the native-coin
     * path (stakeLido). `netAmount` is what reached the protocol — for
     * Compound it is the base balance actually handed to the user, for Lido
     * the stETH actually minted, both of which can marginally exceed `net`
     * due to the protocols' own accounting.
     */
    event Routed(
        address indexed target,
        address indexed user,
        address indexed asset,
        uint256 amountIn,
        uint256 feeTaken,
        uint256 netAmount
    );

    /* ------------------------------ modifiers ---------------------------- */

    modifier nonReentrant() {
        require(_locked == 1, "REENTRANT");
        _locked = 2;
        _;
        _locked = 1;
    }

    /* ---------------------------- construction --------------------------- */

    constructor(Config memory config) {
        /* The asset is required only when a token path exists. A Lido-only
         * deployment (Ethereum) stakes native ETH and pins no token, so
         * forcing an asset there would mean typing in a dummy value — and a
         * dummy in a money-path config is exactly what this constructor
         * exists to refuse. */
        if (config.aavePool != address(0) || config.comet != address(0) || config.morpho != address(0)) {
            require(config.asset != address(0), "ZERO_ASSET");
        }
        require(config.feeRecipient != address(0), "ZERO_FEE_RECIPIENT");
        require(config.feeBps <= MAX_FEE_BPS, "FEE_TOO_HIGH");
        require(
            config.aavePool != address(0) || config.comet != address(0) || config.morpho != address(0)
                || config.lido != address(0),
            "NO_TARGET"
        );

        if (config.morpho != address(0)) {
            // The market this router supplies must be exactly the one the app
            // adapter pins: same loan token as the pinned asset, all five
            // parameters present, and the keccak of those parameters must
            // equal the declared market id.
            require(config.morphoLoanToken == config.asset, "MORPHO_LOAN_TOKEN_MISMATCH");
            require(
                config.morphoCollateralToken != address(0) && config.morphoOracle != address(0)
                    && config.morphoIrm != address(0) && config.morphoLltv != 0,
                "MORPHO_MARKET_INCOMPLETE"
            );
            IMorphoBlue.MarketParams memory mp = _marketParamsOf(config);
            require(keccak256(abi.encode(mp)) == config.morphoMarketId, "MORPHO_MARKET_ID_MISMATCH");
        }

        asset = IERC20(config.asset);
        aavePool = IAaveV3Pool(config.aavePool);
        comet = IComet(config.comet);
        morpho = IMorphoBlue(config.morpho);
        lido = ILido(config.lido);
        morphoLoanToken = config.morphoLoanToken;
        morphoCollateralToken = config.morphoCollateralToken;
        morphoOracle = config.morphoOracle;
        morphoIrm = config.morphoIrm;
        morphoLltv = config.morphoLltv;
        morphoMarketId = config.morphoMarketId;
        feeRecipient = config.feeRecipient;
        feeBps = config.feeBps;
    }

    /* ------------------------------- views ------------------------------- */

    /// Preview the split for a given input amount.
    function quoteFee(uint256 amountIn) public view returns (uint256 fee, uint256 amountAfterFee) {
        fee = (amountIn * feeBps) / BPS_DENOMINATOR;
        amountAfterFee = amountIn - fee;
    }

    function _morphoMarket() private view returns (IMorphoBlue.MarketParams memory) {
        return IMorphoBlue.MarketParams({
            loanToken: morphoLoanToken,
            collateralToken: morphoCollateralToken,
            oracle: morphoOracle,
            irm: morphoIrm,
            lltv: morphoLltv
        });
    }

    function _marketParamsOf(Config memory config)
        private
        pure
        returns (IMorphoBlue.MarketParams memory)
    {
        return IMorphoBlue.MarketParams({
            loanToken: config.morphoLoanToken,
            collateralToken: config.morphoCollateralToken,
            oracle: config.morphoOracle,
            irm: config.morphoIrm,
            lltv: config.morphoLltv
        });
    }

    /* ------------------------------- entry -------------------------------- */

    /**
     * Aave v3 supply. The caller must have approved THIS contract for `amount`
     * of the pinned asset. aTokens are minted to the depositor — `onBehalfOf`
     * is forced to msg.sender, so the router can never hold a supply receipt.
     * referralCode is 0 (Aave's referral program is inactive).
     */
    function supplyAave(uint256 amount) external nonReentrant {
        require(amount > 0, "ZERO_AMOUNT");
        require(address(aavePool) != address(0), "ZERO_TARGET");

        uint256 received = _pullAsset(amount);
        (uint256 fee, uint256 net) = quoteFee(received);
        _takeFee(fee);

        _safeApprove(address(asset), address(aavePool), net);
        aavePool.supply(address(asset), net, msg.sender, 0);
        _assertNoAssetLeft();

        emit Routed(address(aavePool), msg.sender, address(asset), amount, fee, net);
    }

    /**
     * Compound III supply. Comet credits the supply to msg.sender (this
     * router); the base ERC20 balance — position, interest tracking and
     * rewards settled by transfer() — is handed to the depositor in the same
     * transaction, and the router asserts it kept none.
     */
    function supplyCompound(uint256 amount) external nonReentrant {
        require(amount > 0, "ZERO_AMOUNT");
        require(address(comet) != address(0), "ZERO_TARGET");

        uint256 received = _pullAsset(amount);
        (uint256 fee, uint256 net) = quoteFee(received);
        _takeFee(fee);

        _safeApprove(address(asset), address(comet), net);
        comet.supply(address(asset), net);

        uint256 minted = comet.balanceOf(address(this));
        require(minted >= net, "COMET_UNDERCREDIT");
        require(comet.transfer(msg.sender, minted), "COMET_TRANSFER_FAILED");
        _assertNoAssetLeft();

        emit Routed(address(comet), msg.sender, address(asset), amount, fee, minted);
    }

    /**
     * Morpho Blue supply, into the ONE market pinned at construction. The
     * position (supply shares) is credited to the depositor; no hooks.
     */
    function supplyMorpho(uint256 amount) external nonReentrant {
        require(amount > 0, "ZERO_AMOUNT");
        require(address(morpho) != address(0), "ZERO_TARGET");

        uint256 received = _pullAsset(amount);
        (uint256 fee, uint256 net) = quoteFee(received);
        _takeFee(fee);

        _safeApprove(address(asset), address(morpho), net);
        // shares = 0 → supply denominated in assets.
        morpho.supply(_morphoMarket(), net, 0, msg.sender, "");
        _assertNoAssetLeft();

        emit Routed(address(morpho), msg.sender, address(asset), amount, fee, net);
    }

    /**
     * Lido stake with native ETH. The fee is taken in ETH, the rest is
     * submitted, and every stETH share minted to this contract is transferred
     * to the depositor before the transaction can end.
     */
    function stakeLido() external payable nonReentrant {
        require(msg.value > 0, "ZERO_AMOUNT");
        require(address(lido) != address(0), "ZERO_TARGET");

        (uint256 fee, uint256 net) = quoteFee(msg.value);
        if (fee > 0) {
            (bool sent, ) = payable(feeRecipient).call{value: fee}("");
            require(sent, "FEE_TRANSFER_FAILED");
            totalFeesCollected += fee;
        }

        lido.submit{value: net}(address(0));

        uint256 minted = lido.balanceOf(address(this));
        require(minted > 0, "LIDO_UNDERMINT");
        require(lido.transfer(msg.sender, minted), "LIDO_TRANSFER_FAILED");
        require(address(this).balance == 0, "ETH_STUCK");

        emit Routed(address(lido), msg.sender, address(0), msg.value, fee, minted);
    }

    /* ------------------------------ internals ---------------------------- */

    /**
     * Pull `amount` of the pinned asset from the caller and measure what
     * actually arrived — fee-on-transfer tolerance, same rule FeeRouter
     * follows. The fee is taken on the RECEIVED amount, never on a number the
     * contract merely hoped for.
     */
    function _pullAsset(uint256 amount) private returns (uint256 received) {
        uint256 before = asset.balanceOf(address(this));
        _safeTransferFrom(address(asset), msg.sender, address(this), amount);
        received = asset.balanceOf(address(this)) - before;
        require(received > 0, "NOTHING_RECEIVED");
    }

    function _takeFee(uint256 fee) private {
        if (fee > 0) {
            _safeTransfer(address(asset), feeRecipient, fee);
            totalFeesCollected += fee;
        }
    }

    /// The invariant that makes this custody-free, asserted on every path.
    function _assertNoAssetLeft() private view {
        require(asset.balanceOf(address(this)) == 0, "ASSET_STUCK");
    }

    /* --------------------------- safe ERC20 utils ------------------------- */
    // Same low-level pattern as FeeRouter: non-standard tokens (USDT-style
    // missing return values) must not brick the router, and approvals are
    // reset before being set.

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    }

    function _safeApprove(address token, address spender, uint256 value) private {
        (bool ok0, bytes memory d0) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, 0));
        require(ok0 && (d0.length == 0 || abi.decode(d0, (bool))), "APPROVE_RESET_FAILED");
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, value));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "APPROVE_FAILED");
    }
}
