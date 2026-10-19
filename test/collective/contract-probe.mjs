#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ganache from 'ganache';
import { BrowserProvider, Contract, ContractFactory, Interface, id, keccak256, toUtf8Bytes } from 'ethers';
import { createCollectiveReader } from '../../server/collective/reader.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'test/.out/collective');
const artifact = (name) => JSON.parse(fs.readFileSync(path.join(OUT, `${name}.json`), 'utf8'));
const BPS = 10_000n;
const USDT = (x) => BigInt(x) * 1_000_000n;
let pass = 0;
const ok = (label) => { pass += 1; console.log(`  ✓ ${label}`); };

const rpc = ganache.provider({
  logging: { quiet: true },
  chain: { chainId: 4663, allowUnlimitedContractSize: false },
  wallet: { totalAccounts: 10, defaultBalance: 10_000 },
  miner: { blockGasLimit: 30_000_000 }
});
const provider = new BrowserProvider(rpc);
const signers = await Promise.all(Array.from({ length: 8 }, (_, i) => provider.getSigner(i)));
const [governor, keeper, userA, userB, userC, userD, expenseRecipient, guardian] = signers;
const addr = async (signer) => signer.getAddress();

async function deploy(name, args = [], signer = governor) {
  const a = artifact(name);
  const factory = new ContractFactory(a.abi, a.bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}
async function mineAfter(seconds) {
  await provider.send('evm_increaseTime', [seconds]);
  await provider.send('evm_mine', []);
}
async function expectRevert(run, pattern = undefined) {
  let thrown;
  try {
    const result = await run();
    // Ganache's unlocked-account eth_sendTransaction path can return a receipt
    // for a reverted transaction instead of rejecting during gas estimation.
    // Await mined receipts too, so a status-zero transaction cannot look like
    // a successful negative test.
    if (result && typeof result.wait === 'function') await result.wait();
  } catch (error) { thrown = error; }
  assert.ok(thrown, 'expected transaction/read to revert');
  if (pattern) assert.match(String(thrown.shortMessage || thrown.message), pattern);
  return thrown;
}

async function setup({ reserveBps = 1_000, maxOracleAge = 3_600, expense = false, minLiquidityUsdE8 = 1_000_000n, maxAllocationBps = Number(BPS), maxConcentrationBps = Number(BPS), assetArtifact = 'MockUSDT', targetArtifact = 'Mock4626Strategy' } = {}) {
  const token = await deploy(assetArtifact);
  const target = await deploy(targetArtifact, [await token.getAddress()]);
  const access = await deploy('AccessController', [await addr(governor), await addr(guardian)]);
  const emergency = await deploy('EmergencyModule', [await access.getAddress()]);
  const priceOracle = await deploy('MockCollectiveOracle');
  const liquidityOracle = await deploy('MockCollectiveLiquidityOracle');
  const risk = await deploy('RiskController', [
    await access.getAddress(), await emergency.getAddress(),
    await priceOracle.getAddress(), await liquidityOracle.getAddress(), 86_400
  ]);
  const router = await deploy('ExecutionRouter', [await access.getAddress(), await emergency.getAddress(), await risk.getAddress()]);
  const vaultDeployer = await deploy('StrategyVaultDeployer', [
    await access.getAddress(), await emergency.getAddress(), await risk.getAddress(), await router.getAddress()
  ]);
  const modulesDeployer = await deploy('CollectiveModulesDeployer', [await access.getAddress()]);
  const factory = await deploy('CollectiveFactory', [
    await access.getAddress(), await emergency.getAddress(), await risk.getAddress(),
    await router.getAddress(), await token.getAddress(), await vaultDeployer.getAddress(), await modulesDeployer.getAddress()
  ]);

  await (await vaultDeployer.setFactory(await factory.getAddress())).wait();
  await (await modulesDeployer.setFactory(await factory.getAddress())).wait();
  await (await access.grantRole(await access.FACTORY_ROLE(), await factory.getAddress())).wait();
  await (await access.grantRole(await access.KEEPER_ROLE(), await addr(keeper))).wait();
  await (await access.grantRole(await access.EXECUTION_ROUTER_ROLE(), await router.getAddress())).wait();

  await (await risk.queueAddressChange(0, await token.getAddress(), true)).wait();
  await (await risk.queueAddressChange(1, await target.getAddress(), true)).wait();
  await (await risk.queueKindActivation(0, true)).wait();
  if (expense) {
    await (await risk.queueAddressChange(3, await addr(expenseRecipient), true)).wait();
    await (await risk.queueAddressChange(3, await addr(userC), true)).wait();
  }
  await mineAfter(86_401);
  await (await risk.executeAddressChange(0, await token.getAddress(), true)).wait();
  await (await risk.executeAddressChange(1, await target.getAddress(), true)).wait();
  await (await risk.executeKindActivation(0)).wait();
  if (expense) {
    await (await risk.executeAddressChange(3, await addr(expenseRecipient), true)).wait();
    await (await risk.executeAddressChange(3, await addr(userC), true)).wait();
  }
  await (await priceOracle.setTokenPrice(await token.getAddress(), 100_000_000)).wait();
  await (await priceOracle.setNativePrice(300_000_000_000)).wait(); // $3,000.00, 1e8

  const limits = {
    maxTradeUsdE8: 10_000_000_000_000n,
    maxTxCostUsdE8: 10_000_000_000n,
    minLiquidityUsdE8: BigInt(minLiquidityUsdE8),
    maxAllocationBps: Number(maxAllocationBps),
    maxConcentrationBps: Number(maxConcentrationBps),
    maxSlippageBps: 100,
    reserveBps,
    maxOracleAgeSeconds: maxOracleAge,
    enabled: true
  };
  await (await factory.createStableYieldVault('Collective Stable', 'cUSDT', await target.getAddress(), limits)).wait();
  const vaultAddress = await factory.vaultAt(0);
  const vault = new Contract(vaultAddress, artifact('StrategyVault').abi, governor);
  const adapterAddress = await factory.vaultAdapter(vaultAddress);
  const adapter = new Contract(adapterAddress, artifact('StrategyAdapter').abi, governor);
  const epochAddress = await vault.epochManager();
  const epoch = new Contract(epochAddress, artifact('EpochManager').abi, governor);
  const queueAddress = await vault.withdrawalQueue();
  const queue = new Contract(queueAddress, artifact('WithdrawalQueue').abi, governor);
  return { token, target, access, emergency, priceOracle, liquidityOracle, risk, router, vaultDeployer, modulesDeployer, factory, vault, adapter, epoch, queue, limits };
}

async function testReaderIntegration() {
  const s = await setup({ reserveBps: 0 });
  const config = {
    schema: 'fbt.collective.v1', chainId: 4663, chainName: 'Robinhood Chain',
    explorer: 'https://robinhoodchain.blockscout.com', enabled: true, configured: true,
    status: 'configured', issues: [], rpcUrl: 'http://local-only',
    factoryAddress: await s.factory.getAddress(), assetAddress: await s.token.getAddress(),
    deploymentBlock: 0, maxEventSpan: 20_000, keeperEnabled: false, keeperKeyConfigured: false
  };
  const who = await addr(userA);
  await (await s.token.mint(who, USDT(10))).wait();
  await (await s.token.connect(userA).approve(await s.vault.getAddress(), USDT(10))).wait();
  await (await s.vault.connect(userA).deposit(USDT(10), who)).wait();
  await mineAfter(7 * 86_400 + 1);
  await (await s.vault.startFirstEpoch()).wait();
  await (await s.priceOracle.setTokenPrice(await s.token.getAddress(), 100_000_000)).wait();
  await (await s.priceOracle.setNativePrice(300_000_000_000)).wait();
  await (await s.vault.connect(keeper).invest(USDT(5))).wait();

  const reader = createCollectiveReader({ config, provider });
  const [snapshot, status] = await Promise.all([
    reader.getVault(await s.vault.getAddress()), reader.status()
  ]);
  assert.equal(status.ready, true);
  assert.equal(status.deployment.verifiedOnChain, true);
  assert.equal(snapshot.asset.symbol, 'mUSDT');
  assert.equal(snapshot.strategy.target.toLowerCase(), (await s.target.getAddress()).toLowerCase());
  assert.equal(snapshot.strategy.maxWithdrawRaw, USDT(5).toString());
  assert.equal(snapshot.strategy.positionSharesRaw, (await s.target.balanceOf(await s.adapter.getAddress())).toString());
  assert.equal(snapshot.accounting.queuedPayoutAvailableRaw, USDT(5).toString());
  ok('read API verifies the local factory and reads vault policy, live target-reported liquidity and queue state');
}

async function testSurface() {
  for (const name of ['StrategyVault', 'CollectiveFactory', 'StrategyVaultDeployer', 'CollectiveModulesDeployer', 'RiskController', 'ExecutionRouter', 'StrategyAdapter', 'WithdrawalQueue']) {
    const size = artifact(name).deployedBytecode.length / 2 - 1;
    assert.ok(size <= 24_576, `${name} exceeds EIP-170: ${size}`);
  }
  const forbidden = new Set(['call', 'forward', 'execute', 'rescue', 'sweep', 'setAdapter', 'setTarget', 'setProtocol']);
  for (const name of ['StrategyVault', 'ExecutionRouter', 'StrategyAdapter']) {
    const names = artifact(name).abi.filter((entry) => entry.type === 'function').map((entry) => entry.name);
    for (const bad of forbidden) assert.ok(!names.includes(bad), `${name} unexpectedly exposes ${bad}`);
  }
  assert.ok(artifact('StrategyVault').abi.some((entry) => entry.type === 'function' && entry.name === 'requestWithdrawal'));
  assert.ok(artifact('StrategyVault').abi.some((entry) => entry.type === 'function' && entry.name === 'claimIncome'));
  ok('compiled deployable bytecode fits EIP-170; vault/router expose no generic call, rescue, or arbitrary target surface');
}

async function testAccessControl() {
  const access = await deploy('AccessController', [await addr(governor), await addr(guardian)]);
  const governorAddress = await addr(governor);
  const guardianAddress = await addr(guardian);
  const keeperAddress = await addr(keeper);
  const governorRole = await access.GOVERNOR_ROLE();
  const guardianRole = await access.GUARDIAN_ROLE();
  const keeperRole = await access.KEEPER_ROLE();
  const defaultAdminRole = await access.DEFAULT_ADMIN_ROLE();
  const accessAddress = await access.getAddress();
  await expectRevert(() => access.revokeRole(governorRole, governorAddress));
  await expectRevert(() => access.revokeRole(guardianRole, guardianAddress));
  await expectRevert(() => access.connect(keeper).revokeRole(keeperRole, keeperAddress));
  await expectRevert(() => access.revokeRole(defaultAdminRole, accessAddress));
  await (await access.grantRole(keeperRole, keeperAddress)).wait();
  await (await access.revokeRole(keeperRole, keeperAddress)).wait();
  assert.equal(await access.hasRole(keeperRole, keeperAddress), false);
  await (await access.setGuardian(await addr(userD))).wait();
  assert.equal(await access.guardian(), await addr(userD));
  assert.equal(await access.hasRole(guardianRole, await addr(userD)), true);
  ok('role grants/revocations are governor-only; default-admin, governor, and guardian roles cannot be generically revoked');
}

async function testInitialEnrollmentDoesNotExpire() {
  const s = await setup({ reserveBps: 0 });
  const { token, vault, epoch } = s;
  const who = await addr(userA);
  await mineAfter(10 * 86_400); // past the original seven-day launch deadline
  assert.ok(await vault.maxDeposit(who) > 0n, 'first-cohort deposits remain open until epoch one actually starts');
  assert.equal(await epoch.withdrawalWindowOpen(), false, 'principal exits do not precede the first income snapshot');
  await (await token.mint(who, USDT(1))).wait();
  await (await token.connect(userA).approve(await vault.getAddress(), USDT(1))).wait();
  await (await vault.connect(userA).deposit(USDT(1), who)).wait();
  await expectRevert(() => vault.connect(userA).requestWithdrawal(1));
  await (await vault.startFirstEpoch()).wait();
  assert.equal(await epoch.started(), true);
  assert.equal(await vault.maxDeposit(who), 0n);
  ok('initial subscriptions cannot be stranded by an expired deployment-time timer; exits still wait for the first snapshot');
}

async function testMonthlyAccountingAndQueue() {
  const s = await setup({ reserveBps: 1_000, expense: true });
  const { token, target, vault, adapter, epoch, queue, risk } = s;
  const user = await addr(userA);
  const second = await addr(userB);
  const keeperAddress = await addr(keeper);
  const amount = USDT(100);

  await (await token.mint(user, amount)).wait();
  await (await token.connect(userA).approve(await vault.getAddress(), amount)).wait();
  await (await vault.connect(userA).deposit(amount, user)).wait();
  assert.equal(await vault.balanceOf(user), amount);
  assert.equal(await vault.totalAssets(), amount);
  await expectRevert(() => vault.connect(userA).withdraw(1, user, user));
  await expectRevert(() => vault.connect(userA).redeem(1, user, user));
  ok('ERC-4626 deposits mint at the pre-deposit net NAV; synchronous exits are disabled');

  // First epoch starts only after enrollment closes and after all share changes
  // have been captured in a previous block.
  await mineAfter(7 * 86_400 + 1);
  await expectRevert(() => vault.connect(userA).deposit(1, user));
  await (await vault.startFirstEpoch()).wait();
  await (await s.priceOracle.setTokenPrice(await token.getAddress(), 100_000_000)).wait();
  await (await s.priceOracle.setNativePrice(300_000_000_000)).wait();
  await (await vault.connect(keeper).invest(amount)).wait();
  assert.equal(await token.allowance(await vault.getAddress(), await adapter.getAddress()), 0n);
  assert.equal(await token.allowance(await adapter.getAddress(), await target.getAddress()), 0n);
  await expectRevert(() => vault.connect(userC).withdrawFromStrategy(USDT(1)));

  await (await target.addYield(USDT(20))).wait();
  // OZ ERC-4626 virtual-share math conservatively rounds one micro-unit down.
  assert.equal(await vault.totalAssets(), USDT(120) - 1n);
  assert.equal(await vault.realizedIncomeAccrued(), 0n, 'unrealized appreciation must not be distributable');
  await (await token.mint(second, USDT(10))).wait();
  await (await token.connect(userB).approve(await vault.getAddress(), USDT(10))).wait();
  await expectRevert(() => vault.connect(userB).deposit(USDT(10), second));
  ok('mid-epoch deposits are closed and unrealized appreciation remains NAV, not income');

  await mineAfter(30 * 86_400 + 1);
  assert.equal(await epoch.withdrawalWindowOpen(), true, 'principal requests open once the 30-day period has elapsed');
  await expectRevert(() => vault.settleEpoch());
  await (await vault.connect(userC).liquidateStrategy()).wait(); // permissionless after the period ends
  assert.equal(await vault.riskReserve(), USDT(2) - 1n);
  assert.equal(await vault.realizedIncomeAccrued(), USDT(18));
  assert.equal(await vault.totalAssets(), USDT(100));
  const recipientAddress = await addr(expenseRecipient);
  const preSettlementExpense = USDT(1);
  const recipientBeforeExpense = await token.balanceOf(recipientAddress);
  await (await vault.accrueExpense(recipientAddress, preSettlementExpense)).wait();
  assert.equal(await vault.realizedIncomeAccrued(), USDT(17), 'approved costs reduce unallocated realized income before it is distributable');
  assert.equal(await vault.accruedExpenses(), preSettlementExpense);
  assert.equal(await vault.totalAssets(), USDT(100), 'moving income into the expense liability does not double-count the cost');
  await (await vault.payAccruedExpense(recipientAddress, preSettlementExpense)).wait();
  assert.equal((await token.balanceOf(recipientAddress)) - recipientBeforeExpense, preSettlementExpense);
  assert.equal(await vault.totalAssets(), USDT(100), 'payment settles the accrued liability without a second NAV reduction');
  await (await vault.settleEpoch()).wait();
  const distribution = await vault.incomeDistribution(1);
  assert.equal(distribution.eligibleShares, amount);
  assert.equal(distribution.amountAllocated, USDT(17));
  assert.equal(await vault.incomeLiability(), USDT(17));
  assert.equal(await vault.totalAssets(), USDT(100));
  ok('monthly settlement distributes realized net income after loss recovery, reserve, and accrued expenses');

  // An expense accrued after the income snapshot lowers shareholder NAV once;
  // paying it later must not lower NAV a second time.
  const expense = USDT(1); // 1% of current NAV, the hard-coded per-epoch cap
  const otherApprovedRecipient = await addr(userC);
  await (await vault.accrueExpense(recipientAddress, expense)).wait();
  assert.equal(await vault.totalAssets(), USDT(99));
  assert.equal(await vault.accruedExpensesByRecipient(recipientAddress), expense);
  await expectRevert(() => vault.payAccruedExpense(otherApprovedRecipient, expense));
  await (await vault.payAccruedExpense(recipientAddress, expense)).wait();
  assert.equal(await vault.accruedExpensesByRecipient(recipientAddress), 0n);
  assert.equal(await vault.totalAssets(), USDT(99));
  const unapprovedRecipient = await addr(userD);
  await expectRevert(() => vault.accrueExpense(unapprovedRecipient, 1));
  ok('approved expenses accrue as liabilities, are capped at 1% per epoch, and settle without double-counting');

  // An eligible holder can claim income even after the share snapshot; claims
  // are independent of the principal redemption queue.
  const balanceBeforeClaim = await token.balanceOf(user);
  await (await vault.connect(userA).claimIncome(12)).wait();
  assert.equal((await token.balanceOf(user)) - balanceBeforeClaim, USDT(17));
  assert.equal(await vault.incomeLiability(), 0n);

  await (await vault.connect(userA).requestWithdrawal(USDT(25))).wait();
  const firstRequest = await queue.request(1);
  assert.equal(firstRequest.owner, user);
  assert.equal(firstRequest.remainingAssets, USDT(24) + 750_000n);
  assert.equal(await vault.withdrawalLiability(), USDT(24) + 750_000n);
  await (await vault.connect(userA).processWithdrawals(10)).wait();
  assert.equal(await vault.withdrawalLiability(), 0n);
  assert.equal((await token.balanceOf(user)) - balanceBeforeClaim, USDT(41) + 750_000n);
  assert.equal(await vault.totalAssets(), USDT(74) + 250_000n); // 75 shares at $0.99 less the $1 disclosed expense
  ok('withdrawal requests burn shares into a separate FIFO liability; principal payouts do not spend income claims');

  // New shares are subscribed only after the previous income snapshot has
  // closed, so they cannot claim last month’s income.
  await (await vault.connect(userB).deposit(USDT(10), second)).wait();
  assert.equal(await vault.getPastBalance(second, distribution.snapshotBlock), 0n);
  const beforeSecondClaim = await token.balanceOf(second);
  await (await vault.connect(userB).claimIncome(1)).wait();
  assert.equal(await token.balanceOf(second), beforeSecondClaim);
  await mineAfter(7 * 86_400 + 1);
  await (await vault.startFirstEpoch()).wait();
  assert.equal(await vault.getPastTotalSupply(await epoch.currentSnapshotBlock()), await vault.totalSupply());
  ok('subscription shares do not share prior profit and enter income eligibility only at the next epoch snapshot');

  // Send all shareholder principal to the strategy. A FIFO request then waits
  // until partial liquidity arrives; it is paid in chunks with no skipped head.
  const investable = await vault.availablePrincipalIdle();
  await (await s.priceOracle.setTokenPrice(await token.getAddress(), 100_000_000)).wait();
  await (await s.priceOracle.setNativePrice(300_000_000_000)).wait();
  await (await vault.connect(keeper).invest(investable)).wait();
  assert.equal(await vault.availablePrincipalIdle(), 0n);
  await mineAfter(30 * 86_400 + 1);
  assert.equal(await epoch.withdrawalWindowOpen(), true, 'withdrawal requests can queue while a matured period waits for strategy exit');
  await (await vault.connect(userA).requestWithdrawal(USDT(30))).wait();
  const requestId = await queue.head();
  const pendingBefore = (await queue.request(requestId)).remainingAssets;
  await expectRevert(() => vault.settleEpoch());
  await (await vault.processWithdrawals(10)).wait();
  assert.equal((await queue.request(requestId)).remainingAssets, pendingBefore);

  await (await vault.connect(keeper).withdrawFromStrategy(USDT(10))).wait();
  await (await vault.processWithdrawals(10)).wait();
  const partial = (await queue.request(requestId)).remainingAssets;
  assert.ok(partial < pendingBefore && partial > 0n);
  assert.equal(await queue.head(), requestId, 'head stays in place until completely funded');

  await (await vault.liquidateStrategy()).wait();
  await (await vault.processWithdrawals(10)).wait();
  assert.equal((await queue.request(requestId)).remainingAssets, 0n);
  assert.equal(await vault.withdrawalLiability(), 0n);
  assert.equal(await queue.head(), requestId + 1n);
  await (await vault.settleEpoch()).wait();
  ok('insufficient-liquidity redemptions remain FIFO and settlement waits for the full strategy exit');

  // Emergency pause blocks deposits and new strategy investment, but funded
  // claims/withdrawal queue processing remain available.
  const incident = id('COLLECTIVE_TEST_INCIDENT');
  await (await s.emergency.connect(guardian).pause(incident, keccak256(toUtf8Bytes('test evidence')))).wait();
  await expectRevert(() => vault.connect(userB).deposit(1, second));
  await expectRevert(() => vault.connect(keeper).invest(1));
  await (await s.emergency.connect(governor).resolveIncident(1, keccak256(toUtf8Bytes('resolved')))).wait();
  await (await s.emergency.connect(governor).resume(1)).wait();
  await (await s.emergency.connect(guardian).pause(incident, keccak256(toUtf8Bytes('second incident')))).wait();
  await expectRevert(() => s.emergency.connect(governor).resolveIncident(1, keccak256(toUtf8Bytes('stale resolution'))));
  await expectRevert(() => s.emergency.connect(governor).resume(1));
  assert.equal(await s.emergency.paused(), true, 'an older resolved incident cannot unpause a newer incident');
  await (await s.emergency.connect(governor).resolveIncident(2, keccak256(toUtf8Bytes('second incident resolved')))).wait();
  await (await s.emergency.connect(governor).resume(2)).wait();
  ok('guardian pause stops deposits/investments; only governor can resolve and resume the current incident');
}

async function testDustCarryAndHistoricalClaims() {
  const s = await setup({ reserveBps: 0, minLiquidityUsdE8: 1n });
  const { token, target, vault, adapter, epoch } = s;
  const holders = [userA, userB, userC];
  for (const signer of holders) {
    const who = await addr(signer);
    await (await token.mint(who, 1n)).wait();
    await (await token.connect(signer).approve(await vault.getAddress(), 1n)).wait();
    await (await vault.connect(signer).deposit(1n, who)).wait();
  }
  await mineAfter(7 * 86_400 + 1);
  await (await vault.startFirstEpoch()).wait();
  await (await s.priceOracle.setTokenPrice(await token.getAddress(), 100_000_000)).wait();
  await (await s.priceOracle.setNativePrice(300_000_000_000)).wait();
  await (await vault.connect(keeper).invest(3n)).wait();
  // ERC-4626 virtual assets make part of very small apparent yield
  // unredeemable; six units create four units of realized, claimable income.
  await (await target.addYield(6n)).wait();
  await mineAfter(30 * 86_400 + 1);
  await (await vault.connect(keeper).liquidateStrategy()).wait();
  await (await vault.settleEpoch()).wait();
  assert.equal((await vault.incomeDistribution(1)).amountAllocated, 4n);
  assert.equal(await vault.realizedIncomeAccrued(), 0n);
  assert.equal(await vault.incomeLiability(), 4n);
  ok('per-share rounding reserves the full realized-income pool rather than recycling user-level fractional entitlements');

  await mineAfter(7 * 86_400 + 1);
  await (await vault.startFirstEpoch()).wait();
  await (await s.priceOracle.setTokenPrice(await token.getAddress(), 100_000_000)).wait();
  await (await s.priceOracle.setNativePrice(300_000_000_000)).wait();
  await (await vault.connect(keeper).invest(3n)).wait();
  await (await target.addYield(4n)).wait();
  await mineAfter(30 * 86_400 + 1);
  await (await vault.connect(keeper).liquidateStrategy()).wait();
  await (await vault.settleEpoch()).wait();
  assert.equal((await vault.incomeDistribution(2)).amountAllocated, 2n);
  assert.equal(await vault.incomeLiability(), 6n);

  for (const signer of holders) {
    const who = await addr(signer);
    const before = await token.balanceOf(who);
    await (await vault.connect(signer).claimIncome(2)).wait();
    assert.equal((await token.balanceOf(who)) - before, 1n);
    assert.equal(await vault.nextIncomeEpoch(who), 3n);
  }
  assert.equal(await vault.incomeLiability(), 3n); // retained per-user fractions remain fully backed
  assert.equal(await vault.fractionalIncomeRemainder(await addr(userA)) > 0n, true);
  ok('per-user fractional entitlements accumulate across epochs without exceeding the fully reserved income liability');
}

async function testUnsupportedFeeTransferAsset() {
  const s = await setup({ reserveBps: 0, assetArtifact: 'MockFeeUSDT' });
  const who = await addr(userA);
  const amount = USDT(10);
  await (await s.token.mint(who, amount)).wait();
  await (await s.token.connect(userA).approve(await s.vault.getAddress(), amount)).wait();
  const before = await s.token.balanceOf(who);
  await expectRevert(() => s.vault.connect(userA).deposit(amount, who));
  assert.equal(await s.token.balanceOf(who), before, 'rejected fee-on-transfer deposit rolls back atomically');
  assert.equal(await s.token.balanceOf(await s.vault.getAddress()), 0n);
  assert.equal(await s.vault.totalSupply(), 0n);
  ok('fee-on-transfer accounting assets are rejected instead of over-minting vault shares');
}

async function testStrategySlippageBound() {
  const s = await setup({ reserveBps: 0, targetArtifact: 'MockSlippage4626' });
  const who = await addr(userA);
  const amount = USDT(100);
  await (await s.token.mint(who, amount)).wait();
  await (await s.token.connect(userA).approve(await s.vault.getAddress(), amount)).wait();
  await (await s.vault.connect(userA).deposit(amount, who)).wait();
  await mineAfter(7 * 86_400 + 1);
  await (await s.vault.startFirstEpoch()).wait();
  await (await s.priceOracle.setTokenPrice(await s.token.getAddress(), 100_000_000)).wait();
  await (await s.priceOracle.setNativePrice(300_000_000_000)).wait();
  await (await s.target.setHaircutBps(200)).wait();
  await expectRevert(() => s.vault.connect(keeper).invest(amount));
  assert.equal(await s.target.balanceOf(await s.adapter.getAddress()), 0n);
  assert.equal(await s.vault.availablePrincipalIdle(), amount);
  assert.equal(await s.token.balanceOf(await s.adapter.getAddress()), 0n, 'rejected execution returns adapter input atomically');
  ok('fixed ERC-4626 investments enforce the configured share-slippage bound and revert atomically');
}

async function testInvestmentLiquidityFloor() {
  const s = await setup({ reserveBps: 0, minLiquidityUsdE8: 101n * 100_000_000n });
  const who = await addr(userA);
  const amount = USDT(100);
  await (await s.token.mint(who, amount)).wait();
  await (await s.token.connect(userA).approve(await s.vault.getAddress(), amount)).wait();
  await (await s.vault.connect(userA).deposit(amount, who)).wait();
  await mineAfter(7 * 86_400 + 1);
  await (await s.vault.startFirstEpoch()).wait();
  await (await s.priceOracle.setTokenPrice(await s.token.getAddress(), 100_000_000)).wait();
  await (await s.priceOracle.setNativePrice(300_000_000_000)).wait();
  const data = s.risk.interface.encodeFunctionData('validateInvestment', [
    await s.vault.getAddress(), await s.adapter.protocol(), await s.token.getAddress(), amount, await s.vault.totalAssets()
  ]);
  await expectRevert(() => provider.call({ to: s.risk.target, from: s.vault.target, data }));
  ok('investment stops when target-reported redeemable liquidity plus the proposed amount is below policy minimum');
}

async function testCumulativeAllocationCap() {
  const s = await setup({ reserveBps: 0, minLiquidityUsdE8: 1n, maxAllocationBps: 2_500, maxConcentrationBps: 10_000 });
  const who = await addr(userA);
  const amount = USDT(100);
  await (await s.token.mint(who, amount)).wait();
  await (await s.token.connect(userA).approve(await s.vault.getAddress(), amount)).wait();
  await (await s.vault.connect(userA).deposit(amount, who)).wait();
  await mineAfter(7 * 86_400 + 1);
  await (await s.vault.startFirstEpoch()).wait();
  await (await s.priceOracle.setTokenPrice(await s.token.getAddress(), 100_000_000)).wait();
  await (await s.priceOracle.setNativePrice(300_000_000_000)).wait();
  await (await s.vault.connect(keeper).invest(USDT(25))).wait();
  await expectRevert(() => s.vault.connect(keeper).invest(USDT(1)));
  assert.ok(await s.vault.availablePrincipalIdle() > 0n, 'rejected follow-on investment leaves idle principal in the vault');
  ok('allocation/concentration caps apply to the cumulative strategy position, not just each keeper call');
}

async function testOracleFailClosed() {
  const s = await setup({ reserveBps: 0, maxOracleAge: 60 });
  const { token, vault, priceOracle } = s;
  const who = await addr(userA);
  await (await token.mint(who, USDT(5))).wait();
  await (await token.connect(userA).approve(await vault.getAddress(), USDT(5))).wait();
  await (await vault.connect(userA).deposit(USDT(5), who)).wait();
  await mineAfter(7 * 86_400 + 1);
  await (await vault.startFirstEpoch()).wait();
  await mineAfter(61);
  const riskInterface = new Interface(artifact('RiskController').abi);
  const riskData = riskInterface.encodeFunctionData('validateInvestment', [await vault.getAddress(), await s.adapter.protocol(), await token.getAddress(), USDT(1), await vault.totalAssets()]);
  const simulateRiskCheck = () => provider.call({ to: s.risk.target, from: vault.target, data: riskData });
  await expectRevert(simulateRiskCheck);
  await (await priceOracle.setTokenPrice(await token.getAddress(), 100_000_000)).wait();
  await (await priceOracle.setNativePrice(300_000_000_000)).wait();
  await simulateRiskCheck();
  await (await vault.connect(keeper).invest(USDT(1))).wait();
  ok('a stale/missing price observation blocks investment; a fresh observation restores the permitted path');
}

await testSurface();
await testReaderIntegration();
await testAccessControl();
await testInitialEnrollmentDoesNotExpire();
await testMonthlyAccountingAndQueue();
await testDustCarryAndHistoricalClaims();
await testUnsupportedFeeTransferAsset();
await testStrategySlippageBound();
await testInvestmentLiquidityFloor();
await testCumulativeAllocationCap();
await testOracleFailClosed();
console.log(`\nPASS ${pass} Collective EVM assertions (local Ganache only; no public network or real assets)`);
await rpc.disconnect();
