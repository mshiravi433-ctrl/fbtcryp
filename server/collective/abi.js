// ABI slices for public reads, bounded keeper calls, and the dashboard's
// user-authorized ERC-20/ERC-4626 transactions. No generic-call surface.
export const FACTORY_ABI = [
  'function allVaults() view returns (address[])',
  'function vaultCount() view returns (uint256)',
  'function vaultAt(uint256) view returns (address)',
  'function usdt() view returns (address)',
  'function riskController() view returns (address)',
  'function emergencyModule() view returns (address)',
  'event CollectiveVaultCreated(address indexed vault,address indexed adapter,address indexed target,address asset,uint8 kind,uint256 index)'
];

export const VAULT_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function asset() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function grossAssets() view returns (uint256)',
  'function liabilities() view returns (uint256)',
  'function incomeLiability() view returns (uint256)',
  'function withdrawalLiability() view returns (uint256)',
  'function riskReserve() view returns (uint256)',
  'function realizedIncomeAccrued() view returns (uint256)',
  'function accruedExpenses() view returns (uint256)',
  'function realizedLossCarry() view returns (uint256)',
  'function lastSettledEpoch() view returns (uint64)',
  'function availablePrincipalIdle() view returns (uint256)',
  'function queuedPayoutAvailable() view returns (uint256)',
  'function epochManager() view returns (address)',
  'function strategyAdapter() view returns (address)',
  'function withdrawalQueue() view returns (address)',
  'function riskController() view returns (address)',
  'function emergencyModule() view returns (address)',
  'function accessController() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function previewRedeem(uint256) view returns (uint256)',
  'function previewWithdraw(uint256) view returns (uint256)',
  'function maxDeposit(address) view returns (uint256)',
  'function maxRedeem(address) view returns (uint256)',
  'function incomeDistribution(uint64) view returns (tuple(uint48 snapshotBlock,uint256 eligibleShares,uint256 amountAllocated,uint256 incomePerShare))',
  'function nextIncomeEpoch(address) view returns (uint64)',
  'function fractionalIncomeRemainder(address) view returns (uint256)',
  'function deposit(uint256,address) returns (uint256)',
  'function requestWithdrawal(uint256) returns (uint256)',
  'function claimIncome(uint8) returns (uint256)',
  'function processWithdrawals(uint256) returns (uint256,uint256)',
  'function startFirstEpoch()',
  'function invest(uint256) returns (uint256)',
  'function withdrawFromStrategy(uint256) returns (uint256)',
  'function liquidateStrategy() returns (uint256)',
  'function settleEpoch() returns (uint64,uint256)',
  'event EpochIncomeAllocated(uint64 indexed epoch,uint48 snapshotBlock,uint256 eligibleShares,uint256 amount,uint256 perShare)',
  'event IncomeClaimed(address indexed account,uint256 amount,uint64 nextEpoch,uint256 fractionalRemainder)',
  'event WithdrawalRequested(uint256 indexed id,address indexed account,uint256 shares,uint256 assets)',
  'event StrategyInvested(uint256 assets,uint256 shares)',
  'event StrategyDivested(uint256 requestedAssets,uint256 receivedAssets,int256 realizedPnl)',
  'event StrategyLiquidated(uint256 receivedAssets,int256 realizedPnl)',
  'event RealizedPnlRecorded(int256 realizedPnl,uint256 incomeAccrued,uint256 reserve,uint256 lossCarry)',
  'event ExpenseAccrued(address indexed recipient,uint64 indexed epoch,uint256 amount,uint256 totalAccrued)',
  'event ExpensePaid(address indexed recipient,uint256 amount,uint256 totalAccrued)'
];

export const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)'
];

export const EPOCH_ABI = [
  'function currentEpoch() view returns (uint64)',
  'function currentEpochStart() view returns (uint64)',
  'function currentEpochEnd() view returns (uint64)',
  'function currentSnapshotBlock() view returns (uint48)',
  'function subscriptionDeadline() view returns (uint64)',
  'function started() view returns (bool)',
  'function depositsOpen() view returns (bool)',
  'function withdrawalWindowOpen() view returns (bool)'
];

export const STRATEGY_TARGET_ABI = [
  'function maxWithdraw(address owner) view returns (uint256)'
];

export const ADAPTER_ABI = [
  'function asset() view returns (address)',
  'function protocol() view returns (address)',
  'function principalBasis() view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function positionShares() view returns (uint256)',
  'function target() view returns (address)'
];

export const QUEUE_ABI = [
  'function head() view returns (uint256)',
  'function nextId() view returns (uint256)',
  'function request(uint256) view returns (address owner,uint256 shares,uint256 remainingAssets,uint64 requestedAt)',
  'event WithdrawalQueued(uint256 indexed id,address indexed owner,uint256 shares,uint256 assets)',
  'event WithdrawalPaid(uint256 indexed id,address indexed owner,uint256 assetsPaid,uint256 remainingAssets)'
];

export const RISK_ABI = [
  'function accessController() view returns (address)',
  'function emergencyModule() view returns (address)',
  'function priceOracle() view returns (address)',
  'function limits(address) view returns (tuple(uint128 maxTradeUsdE8,uint128 maxTxCostUsdE8,uint128 minLiquidityUsdE8,uint16 maxAllocationBps,uint16 maxConcentrationBps,uint16 maxSlippageBps,uint16 reserveBps,uint32 maxOracleAgeSeconds,bool enabled))',
  'function reserveBps(address) view returns (uint16)',
  'function isKindEnabled(uint8) view returns (bool)',
  'function isAssetAllowed(address) view returns (bool)',
  'function isProtocolAllowed(address) view returns (bool)',
  'function registeredVault(address) view returns (bool)',
  'function vaultKind(address) view returns (uint8)',
  'function vaultAsset(address) view returns (address)',
  'function vaultProtocol(address) view returns (address)'
];

export const ORACLE_ABI = [
  'function tokenPriceUsdE8(address) view returns (uint256 priceUsdE8,uint64 updatedAt)',
  'function nativePriceUsdE8() view returns (uint256 priceUsdE8,uint64 updatedAt)'
];

export const EMERGENCY_ABI = [
  'function paused() view returns (bool)',
  'function incidentNumber() view returns (uint64)'
];

export const ACCESS_ABI = [
  'function KEEPER_ROLE() view returns (bytes32)',
  'function hasRole(bytes32,address) view returns (bool)'
];

export const FACTORY_EVENT_ABI = FACTORY_ABI;
export const VAULT_EVENT_ABI = VAULT_ABI;
export const QUEUE_EVENT_ABI = QUEUE_ABI;
