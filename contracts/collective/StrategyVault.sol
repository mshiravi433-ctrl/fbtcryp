// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {
    ICollectiveAccessController,
    IEmergencyModule,
    IRiskController,
    IEpochManager,
    IStrategyAdapter,
    IWithdrawalQueue,
    IStrategyVault
} from "./interfaces/ICollective.sol";
import {RewardAccounting} from "./RewardAccounting.sol";

/**
 * Isolated, single-accounting-asset Collective vault.
 *
 * ERC-4626 deposits/mints use the pre-deposit net NAV. Instant withdraw/redeem
 * is deliberately disabled: users submit a monthly-window request, their
 * shares are burned and a fixed-amount liability enters the FIFO queue. The
 * queue can pay only from idle principal after all income/reserve obligations.
 *
 * The configured ERC-4626 adapter is immutable after factory binding. Net NAV
 * excludes realized-but-unallocated income, claimable income, queued principal,
 * disclosed expenses and retained risk reserve. Unrealized appreciation can
 * therefore raise share NAV, but never enters the income-claim path.
 */
contract StrategyVault is ERC4626, ReentrancyGuard, IStrategyVault {
    using SafeERC20 for IERC20;
    using Checkpoints for Checkpoints.Trace208;

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_EXPENSE_BPS_PER_EPOCH = 100;
    uint256 public constant MAX_CLAIM_EPOCHS = 12;
    address public constant EXECUTION_OUTPUT_RECIPIENT = address(0); // documents no router custody

    ICollectiveAccessController public immutable accessController;
    IEmergencyModule public immutable emergencyModule;
    IRiskController public immutable riskController;
    address public immutable factory;
    address public immutable executionRouter;

    IEpochManager public epochManager;
    IStrategyAdapter public strategyAdapter;
    IWithdrawalQueue public withdrawalQueue;

    uint256 public realizedIncomeAccrued;
    uint256 public incomeLiability;
    uint256 public withdrawalLiability;
    uint256 public riskReserve;
    uint256 public accruedExpenses;
    mapping(address => uint256) public accruedExpensesByRecipient;
    uint256 public realizedLossCarry;
    uint64 public lastSettledEpoch;
    uint48 public lastShareChangeBlock;

    mapping(uint64 => RewardAccounting.Distribution) private _incomeDistributions;
    mapping(address => uint64) public nextIncomeEpoch;
    mapping(address => uint256) public fractionalIncomeRemainder;
    mapping(uint64 => uint256) public expensesRecordedInEpoch;

    mapping(address => Checkpoints.Trace208) private _shareCheckpoints;
    Checkpoints.Trace208 private _supplyCheckpoints;

    event ModulesBound(address indexed epochManager, address indexed strategyAdapter, address indexed withdrawalQueue);
    event StrategyInvested(uint256 assets, uint256 shares);
    event StrategyDivested(uint256 requestedAssets, uint256 receivedAssets, int256 realizedPnl);
    event StrategyLiquidated(uint256 receivedAssets, int256 realizedPnl);
    event RealizedPnlRecorded(int256 realizedPnl, uint256 incomeAccrued, uint256 reserve, uint256 lossCarry);
    event EpochIncomeAllocated(uint64 indexed epoch, uint48 snapshotBlock, uint256 eligibleShares, uint256 amount, uint256 perShare);
    event IncomeClaimed(address indexed account, uint256 amount, uint64 nextEpoch, uint256 fractionalRemainder);
    event WithdrawalRequested(uint256 indexed id, address indexed account, uint256 shares, uint256 assets);
    event ExpenseAccrued(address indexed recipient, uint64 indexed epoch, uint256 amount, uint256 totalAccrued);
    event ExpensePaid(address indexed recipient, uint256 amount, uint256 totalAccrued);

    error NotGovernor();
    error NotKeeper();
    error OnlyFactory();
    error OnlyQueue();
    error OnlyExecutionRouter();
    error ModulesAlreadyBound();
    error InvalidModules();
    error EmergencyPaused();
    error DepositsClosed();
    error WithdrawalWindowClosed();
    error UseWithdrawalQueue();
    error InvalidShares();
    error StrategyNotConfigured();
    error StrategyNotLiquidated();
    error InsufficientLiquidPrincipal();
    error InvalidPnl();
    error NoClaimableEpoch();
    error InvalidClaimBatch();
    error ExpenseRecipientNotApproved();
    error ExpenseCapExceeded();
    error UnsupportedAssetTransfer();
    error ExpenseNotAccrued();
    error SnapshotNotPast();
    error CheckpointValueTooLarge();

    modifier onlyGovernor() {
        if (!accessController.hasRole(accessController.GOVERNOR_ROLE(), msg.sender)) revert NotGovernor();
        _;
    }

    modifier onlyKeeper() {
        if (!accessController.hasRole(accessController.KEEPER_ROLE(), msg.sender)) revert NotKeeper();
        _;
    }

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    modifier whenNotPaused() {
        if (emergencyModule.paused()) revert EmergencyPaused();
        _;
    }

    modifier onlyQueue() {
        if (msg.sender != address(withdrawalQueue)) revert OnlyQueue();
        _;
    }

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        ICollectiveAccessController access_,
        IEmergencyModule emergency_,
        IRiskController risk_,
        address factory_,
        address executionRouter_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        require(
            address(asset_) != address(0) && address(access_) != address(0) &&
            address(emergency_) != address(0) && address(risk_) != address(0) &&
            factory_ != address(0) && executionRouter_ != address(0),
            "ZERO_DEPENDENCY"
        );
        accessController = access_;
        emergencyModule = emergency_;
        riskController = risk_;
        factory = factory_;
        executionRouter = executionRouter_;
    }

    /** One-time wiring only; the factory cannot replace a strategy after launch. */
    function bindModules(IEpochManager epoch_, IStrategyAdapter adapter_, IWithdrawalQueue queue_)
        external onlyFactory
    {
        if (address(epochManager) != address(0) || address(withdrawalQueue) != address(0)) revert ModulesAlreadyBound();
        if (address(epoch_).code.length == 0 || address(queue_).code.length == 0) revert InvalidModules();
        if (epoch_.vault() != address(this) || queue_.vault() != address(this)) revert InvalidModules();
        if (address(adapter_) != address(0)) {
            if (address(adapter_).code.length == 0 || adapter_.vault() != address(this) || adapter_.asset() != asset()) {
                revert InvalidModules();
            }
        }
        epochManager = epoch_;
        strategyAdapter = adapter_;
        withdrawalQueue = queue_;
        emit ModulesBound(address(epoch_), address(adapter_), address(queue_));
    }

    /**
     * ERC-4626 totalAssets is the shareholder NAV (not gross token holdings).
     * Income/withdrawal/expense/reserve obligations are excluded before
     * convertToShares() or convertToAssets() can touch them.
     */
    function totalAssets() public view override(ERC4626, IStrategyVault) returns (uint256) {
        uint256 gross = grossAssets();
        uint256 obligations = incomeLiability + realizedIncomeAccrued + withdrawalLiability + accruedExpenses + riskReserve;
        return gross > obligations ? gross - obligations : 0;
    }

    function asset() public view override(ERC4626, IStrategyVault) returns (address) {
        return ERC4626.asset();
    }

    function nav() external view returns (uint256) {
        return totalAssets();
    }

    function grossAssets() public view returns (uint256) {
        uint256 gross = IERC20(asset()).balanceOf(address(this));
        if (address(strategyAdapter) != address(0)) gross += strategyAdapter.totalAssets();
        return gross;
    }

    function liabilities() external view returns (uint256) {
        return incomeLiability + realizedIncomeAccrued + withdrawalLiability + accruedExpenses + riskReserve;
    }

    function availablePrincipalIdle() public view returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 reserved = incomeLiability + realizedIncomeAccrued + withdrawalLiability + accruedExpenses + riskReserve;
        return idle > reserved ? idle - reserved : 0;
    }

    function maxDeposit(address) public view override returns (uint256) {
        if (emergencyModule.paused() || address(epochManager) == address(0)) return 0;
        return epochManager.depositsOpen() ? type(uint256).max : 0;
    }

    function maxMint(address) public view override returns (uint256) {
        if (emergencyModule.paused() || address(epochManager) == address(0)) return 0;
        return epochManager.depositsOpen() ? type(uint256).max : 0;
    }

    function deposit(uint256 assets_, address receiver)
        public override nonReentrant whenNotPaused returns (uint256 shares)
    {
        if (address(epochManager) == address(0) || !epochManager.depositsOpen()) revert DepositsClosed();
        uint256 balanceBefore = IERC20(asset()).balanceOf(address(this));
        shares = super.deposit(assets_, receiver);
        uint256 balanceAfter = IERC20(asset()).balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != assets_) revert UnsupportedAssetTransfer();
    }

    function mint(uint256 shares, address receiver)
        public override nonReentrant whenNotPaused returns (uint256 assets_)
    {
        if (address(epochManager) == address(0) || !epochManager.depositsOpen()) revert DepositsClosed();
        uint256 balanceBefore = IERC20(asset()).balanceOf(address(this));
        assets_ = super.mint(shares, receiver);
        uint256 balanceAfter = IERC20(asset()).balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != assets_) revert UnsupportedAssetTransfer();
    }

    /** Instant ERC-4626 redemptions are intentionally unavailable. */
    function withdraw(uint256, address, address) public pure override returns (uint256) {
        revert UseWithdrawalQueue();
    }

    function redeem(uint256, address, address) public pure override returns (uint256) {
        revert UseWithdrawalQueue();
    }

    function maxWithdraw(address) public pure override returns (uint256) {
        return 0;
    }

    function maxRedeem(address) public pure override returns (uint256) {
        return 0;
    }

    /** Starts the first epoch after the public seven-day cohort enrollment. */
    function startFirstEpoch() external {
        if (address(epochManager) == address(0)) revert InvalidModules();
        if (
            totalSupply() == 0 || block.number == 0 || block.number <= lastShareChangeBlock ||
            getPastTotalSupply(uint48(block.number - 1)) == 0
        ) revert InvalidShares();
        epochManager.startFirstEpoch();
    }

    /** Keeper-only deploy: only the fixed adapter target can receive principal. */
    function invest(uint256 amount) external onlyKeeper nonReentrant whenNotPaused returns (uint256 strategyShares) {
        if (address(strategyAdapter) == address(0)) revert StrategyNotConfigured();
        if (!epochManager.started() || block.timestamp >= epochManager.currentEpochEnd()) revert DepositsClosed();
        if (amount == 0 || amount > availablePrincipalIdle()) revert InsufficientLiquidPrincipal();
        riskController.validateInvestment(
            address(this), strategyAdapter.protocol(), asset(), amount, totalAssets()
        );
        IERC20(asset()).forceApprove(address(strategyAdapter), amount);
        strategyShares = strategyAdapter.deposit(amount);
        IERC20(asset()).forceApprove(address(strategyAdapter), 0);
        emit StrategyInvested(amount, strategyShares);
    }

    /**
     * A keeper can raise liquidity at any time. During an emergency, while
     * redemptions are queued, or after an epoch ends, any account may trigger a constrained withdrawal;
     * the adapter can only send the accounting asset back to this vault.
     */
    function withdrawFromStrategy(uint256 amount)
        external nonReentrant returns (uint256 assetsReceived)
    {
        if (address(strategyAdapter) == address(0)) revert StrategyNotConfigured();
        if (!accessController.hasRole(accessController.KEEPER_ROLE(), msg.sender) && !_exitIsPermissionless()) {
            revert NotKeeper();
        }
        (int256 pnl, uint256 received) = strategyAdapter.withdraw(amount);
        _recordRealizedPnl(pnl);
        assetsReceived = received;
        emit StrategyDivested(amount, received, pnl);
    }

    function liquidateStrategy() external nonReentrant returns (uint256 assetsReceived) {
        if (address(strategyAdapter) == address(0)) revert StrategyNotConfigured();
        if (!accessController.hasRole(accessController.KEEPER_ROLE(), msg.sender) && !_exitIsPermissionless()) {
            revert NotKeeper();
        }
        (int256 pnl, uint256 received) = strategyAdapter.liquidate();
        _recordRealizedPnl(pnl);
        assetsReceived = received;
        emit StrategyLiquidated(received, pnl);
    }

    function _exitIsPermissionless() private view returns (bool) {
        if (emergencyModule.paused() || withdrawalLiability != 0) return true;
        return address(epochManager) != address(0) && epochManager.started() &&
            block.timestamp >= epochManager.currentEpochEnd();
    }

    function _recordRealizedPnl(int256 pnl) internal {
        if (pnl > 0) {
            uint256 gain = uint256(pnl);
            uint256 lossRecovery = gain < realizedLossCarry ? gain : realizedLossCarry;
            realizedLossCarry -= lossRecovery;
            gain -= lossRecovery;
            uint16 reserveBps_ = riskController.reserveBps(address(this));
            uint256 reserve = Math.mulDiv(gain, reserveBps_, BPS);
            riskReserve += reserve;
            realizedIncomeAccrued += gain - reserve;
        } else if (pnl < 0) {
            if (pnl == type(int256).min) revert InvalidPnl();
            uint256 loss = uint256(-pnl);
            uint256 fromIncome = loss < realizedIncomeAccrued ? loss : realizedIncomeAccrued;
            realizedIncomeAccrued -= fromIncome;
            loss -= fromIncome;
            uint256 fromReserve = loss < riskReserve ? loss : riskReserve;
            riskReserve -= fromReserve;
            loss -= fromReserve;
            realizedLossCarry += loss;
        }
        emit RealizedPnlRecorded(pnl, realizedIncomeAccrued, riskReserve, realizedLossCarry);
    }

    /** Finalizes the previous period and creates an income snapshot for it. */
    function settleEpoch() external nonReentrant returns (uint64 epoch, uint256 allocated) {
        if (address(epochManager) == address(0)) revert InvalidModules();
        // Close the period only after every strategy share has been exited, so
        // late realized P&L cannot leak into a new subscriber cohort.
        if (address(strategyAdapter) != address(0) && strategyAdapter.positionShares() != 0) {
            revert StrategyNotLiquidated();
        }
        uint48 snapshotBlock;
        (epoch, snapshotBlock) = epochManager.settleEpoch();
        uint256 eligible = getPastTotalSupply(snapshotBlock);
        (uint256 perShare, uint256 committed) = RewardAccounting.allocate(realizedIncomeAccrued, eligible);
        allocated = committed;
        if (committed != 0) {
            realizedIncomeAccrued -= committed;
            incomeLiability += committed;
        }
        _incomeDistributions[epoch] = RewardAccounting.Distribution({
            snapshotBlock: snapshotBlock,
            eligibleShares: eligible,
            amountAllocated: committed,
            incomePerShare: perShare
        });
        lastSettledEpoch = epoch;
        emit EpochIncomeAllocated(epoch, snapshotBlock, eligible, committed, perShare);
    }

    function incomeDistribution(uint64 epoch)
        external view returns (RewardAccounting.Distribution memory)
    {
        return _incomeDistributions[epoch];
    }

    /**
     * Claim a bounded number of settled monthly allocations. Shares are read
     * from the historical snapshot, not current balance. Fractional token-unit
     * remainders stay attached to the claimant for later claims.
     */
    function claimIncome(uint8 maxEpochs) external nonReentrant returns (uint256 paid) {
        if (maxEpochs == 0 || maxEpochs > MAX_CLAIM_EPOCHS) revert InvalidClaimBatch();
        uint64 cursor = nextIncomeEpoch[msg.sender];
        if (cursor == 0) cursor = 1;
        uint64 end = lastSettledEpoch;
        if (cursor > end) revert NoClaimableEpoch();

        uint256 remainder = fractionalIncomeRemainder[msg.sender];
        uint8 processed;
        while (cursor <= end && processed < maxEpochs) {
            RewardAccounting.Distribution storage dist = _incomeDistributions[cursor];
            uint256 eligibleBalance = dist.incomePerShare == 0
                ? 0
                : getPastBalance(msg.sender, dist.snapshotBlock);
            (uint256 due, uint256 nextRemainder) = RewardAccounting.claimAmount(
                eligibleBalance, dist.incomePerShare, remainder
            );
            remainder = nextRemainder;
            paid += due;
            cursor += 1;
            processed += 1;
        }
        nextIncomeEpoch[msg.sender] = cursor;
        fractionalIncomeRemainder[msg.sender] = remainder;
        if (paid > incomeLiability) revert InvalidPnl();
        if (paid != 0) {
            incomeLiability -= paid;
            IERC20 stableAsset = IERC20(asset());
            uint256 balanceBefore = stableAsset.balanceOf(msg.sender);
            stableAsset.safeTransfer(msg.sender, paid);
            uint256 balanceAfter = stableAsset.balanceOf(msg.sender);
            if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != paid) revert UnsupportedAssetTransfer();
        }
        emit IncomeClaimed(msg.sender, paid, cursor, remainder);
    }

    /** Principal is burned at request time and becomes a fixed FIFO liability. */
    function requestWithdrawal(uint256 shares) external nonReentrant returns (uint256 id) {
        if (address(epochManager) == address(0) || !epochManager.withdrawalWindowOpen()) revert WithdrawalWindowClosed();
        if (shares == 0 || shares > balanceOf(msg.sender)) revert InvalidShares();
        uint256 amount = previewRedeem(shares);
        if (amount == 0) revert InvalidShares();
        _burn(msg.sender, shares);
        withdrawalLiability += amount;
        id = withdrawalQueue.enqueue(msg.sender, shares, amount);
        emit WithdrawalRequested(id, msg.sender, shares, amount);
    }

    /** Anyone can progress the queue; its FIFO and cash/liability checks are on-chain. */
    function processWithdrawals(uint256 maxItems)
        external nonReentrant returns (uint256 assetsPaid, uint256 itemsProcessed)
    {
        if (address(withdrawalQueue) == address(0)) revert InvalidModules();
        return withdrawalQueue.process(maxItems);
    }

    function queuedPayoutAvailable() external view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 reserved = incomeLiability + realizedIncomeAccrued + accruedExpenses + riskReserve;
        return idle > reserved ? idle - reserved : 0;
    }

    function payoutQueuedClaim(address receiver, uint256 amount) external override onlyQueue {
        if (receiver == address(0) || amount == 0 || amount > withdrawalLiability) revert InvalidShares();
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 reserved = incomeLiability + realizedIncomeAccrued + accruedExpenses + riskReserve;
        if (idle <= reserved || amount > idle - reserved) revert InsufficientLiquidPrincipal();
        withdrawalLiability -= amount;
        IERC20 stableAsset = IERC20(asset());
        uint256 balanceBefore = stableAsset.balanceOf(receiver);
        stableAsset.safeTransfer(receiver, amount);
        uint256 balanceAfter = stableAsset.balanceOf(receiver);
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) revert UnsupportedAssetTransfer();
    }

    /** Approved costs consume unallocated realized income before shareholder NAV. */
    function accrueExpense(address recipient, uint256 amount) external onlyGovernor {
        if (!riskController.isExpenseRecipient(recipient)) revert ExpenseRecipientNotApproved();
        if (amount == 0) revert ExpenseNotAccrued();
        uint64 epoch = address(epochManager) != address(0) && epochManager.started() ? epochManager.currentEpoch() : 0;
        uint256 cap = Math.mulDiv(totalAssets(), MAX_EXPENSE_BPS_PER_EPOCH, BPS);
        if (expensesRecordedInEpoch[epoch] + amount > cap) revert ExpenseCapExceeded();
        expensesRecordedInEpoch[epoch] += amount;
        uint256 coveredByPendingIncome = amount < realizedIncomeAccrued ? amount : realizedIncomeAccrued;
        realizedIncomeAccrued -= coveredByPendingIncome;
        accruedExpenses += amount;
        accruedExpensesByRecipient[recipient] += amount;
        emit ExpenseAccrued(recipient, epoch, amount, accruedExpenses);
    }

    function payAccruedExpense(address recipient, uint256 amount) external onlyGovernor nonReentrant {
        if (!riskController.isExpenseRecipient(recipient)) revert ExpenseRecipientNotApproved();
        if (amount == 0 || amount > accruedExpensesByRecipient[recipient] || amount > accruedExpenses) revert ExpenseNotAccrued();
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 reserved = incomeLiability + realizedIncomeAccrued + withdrawalLiability + riskReserve;
        if (idle <= reserved || amount > idle - reserved) revert InsufficientLiquidPrincipal();
        accruedExpenses -= amount;
        accruedExpensesByRecipient[recipient] -= amount;
        IERC20 stableAsset = IERC20(asset());
        uint256 balanceBefore = stableAsset.balanceOf(recipient);
        stableAsset.safeTransfer(recipient, amount);
        uint256 balanceAfter = stableAsset.balanceOf(recipient);
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) revert UnsupportedAssetTransfer();
        emit ExpensePaid(recipient, amount, accruedExpenses);
    }

    /** Called only by the fixed ExecutionRouter; it cannot pick a recipient. */
    function moveTradeInput(address token, uint256 amount) external override whenNotPaused {
        if (msg.sender != executionRouter) revert OnlyExecutionRouter();
        if (token != asset() || amount == 0 || amount > availablePrincipalIdle()) revert InsufficientLiquidPrincipal();
        IERC20(token).safeTransfer(executionRouter, amount);
    }

    function getPastBalance(address account, uint48 snapshotBlock) public view returns (uint256) {
        if (snapshotBlock >= block.number) revert SnapshotNotPast();
        return _shareCheckpoints[account].upperLookup(snapshotBlock);
    }

    function getPastTotalSupply(uint48 snapshotBlock) public view returns (uint256) {
        if (snapshotBlock >= block.number) revert SnapshotNotPast();
        return _supplyCheckpoints.upperLookup(snapshotBlock);
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 0;
    }

    function _update(address from, address to, uint256 value) internal override(ERC20) {
        if (block.number > type(uint48).max) revert CheckpointValueTooLarge();
        super._update(from, to, value);
        uint48 key = uint48(block.number);
        lastShareChangeBlock = key;
        uint256 supply = totalSupply();
        if (supply > type(uint208).max) revert CheckpointValueTooLarge();
        _supplyCheckpoints.push(key, uint208(supply));
        if (from != address(0)) {
            uint256 fromBalance = balanceOf(from);
            if (fromBalance > type(uint208).max) revert CheckpointValueTooLarge();
            _shareCheckpoints[from].push(key, uint208(fromBalance));
        }
        if (to != address(0) && to != from) {
            uint256 toBalance = balanceOf(to);
            if (toBalance > type(uint208).max) revert CheckpointValueTooLarge();
            _shareCheckpoints[to].push(key, uint208(toBalance));
        }
    }
}
