/**
 * Shared deployment library for the FBT AI Collective (stable-yield lane).
 *
 * Every transaction is signed by the single wallet passed in as `signer`.
 * There is no relayer, paymaster or server-held key anywhere in this path:
 * the deploying wallet pays the gas for deployment, and later every user
 * deposit / claim / withdrawal request is signed by that user's own wallet.
 *
 * The library is deliberately split into two phases because the on-chain
 * RiskController enforces a timelock (>= 1 day) between queueing and executing
 * asset/protocol allowlists and strategy-kind activation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Contract, ContractFactory, getAddress } from 'ethers';

export const LOCAL_CHAIN_ID = 31337;
export const ROBINHOOD_CHAIN_ID = 4663;
export const RISK_KIND = { ALLOW_ASSET: 0, ALLOW_PROTOCOL: 1, ALLOW_ROUTER: 2, ALLOW_EXPENSE_RECIPIENT: 3, STABLE_YIELD: 0 };

/** Load the local-only solc artifacts produced by scripts/compile-collective.mjs. */
export function loadCollectiveArtifacts(root, artifactDir = path.join(root, 'test', '.out', 'collective')) {
  const read = (name) => {
    const file = path.join(artifactDir, `${name}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`Missing ${file}. Run: npm run compile:collective`);
    }
    const artifact = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { abi: artifact.abi, bytecode: artifact.bytecode, deployedBytecode: artifact.deployedBytecode, contractName: name };
  };
  const names = [
    'AccessController', 'EmergencyModule', 'DeclaredPriceOracle', 'DisabledLiquidityOracle',
    'RiskController', 'ExecutionRouter', 'StrategyVaultDeployer', 'CollectiveModulesDeployer',
    'CollectiveFactory', 'StrategyVault', 'StrategyAdapter', 'EpochManager', 'WithdrawalQueue',
    'NoYield4626Strategy', 'MockUSDT'
  ];
  return Object.fromEntries(names.map((name) => [name, read(name)]));
}

const lowercase = (value) => String(value ?? '').toLowerCase();

const asAddress = (value, label) => {
  try {
    return getAddress(String(value ?? '').trim());
  } catch {
    throw new Error(`${label} is not a valid EVM address`);
  }
};

export const DEFAULT_LIMITS = Object.freeze({
  maxTradeUsdE8: 50_000n * 100_000_000n, // $50,000 per investment
  maxTxCostUsdE8: 50n * 100_000_000n, // $50 gas-cost ceiling
  minLiquidityUsdE8: 1n * 100_000_000n, // $1 target-reported liquidity
  maxAllocationBps: 8_000,
  maxConcentrationBps: 8_000,
  maxSlippageBps: 50,
  reserveBps: 1_000,
  maxOracleAgeSeconds: 3_600,
  enabled: true
});

class TxRecorder {
  constructor(signer, onStep = () => {}) {
    this.signer = signer;
    this.onStep = onStep;
    this.transactions = [];
    this.totalGasUsed = 0n;
    this.totalGasCostWei = 0n;
  }

  async send(label, contract, method, args = []) {
    const tx = await contract[method](...args);
    const receipt = await tx.wait();
    if (!receipt || Number(receipt.status) !== 1) throw new Error(`${label} reverted`);
    const gasUsed = BigInt(receipt.gasUsed ?? 0);
    const price = BigInt(receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0);
    const row = {
      label,
      method,
      hash: receipt.hash ?? tx.hash,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: gasUsed.toString(),
      gasCostWei: (gasUsed * price).toString()
    };
    this.transactions.push(row);
    this.totalGasUsed += gasUsed;
    this.totalGasCostWei += gasUsed * price;
    this.onStep(row);
    return receipt;
  }

  async deploy(name, artifact, args = []) {
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, this.signer);
    const contract = await factory.deploy(...args);
    const tx = contract.deploymentTransaction();
    await contract.waitForDeployment();
    const receipt = await tx.wait();
    const gasUsed = BigInt(receipt.gasUsed ?? 0);
    const price = BigInt(receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0);
    const address = await contract.getAddress();
    const row = {
      label: `deploy ${name}`,
      method: 'deploy',
      address,
      hash: receipt.hash ?? tx.hash,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: gasUsed.toString(),
      gasCostWei: (gasUsed * price).toString()
    };
    this.transactions.push(row);
    this.totalGasUsed += gasUsed;
    this.totalGasCostWei += gasUsed * price;
    this.onStep(row);
    return contract;
  }
}

/**
 * Phase 1 — deploy every contract, bind roles, queue the timelocked allowlists
 * and the stable-yield activation. No policy is executable yet.
 *
 * `asset` is the accounting stablecoin. When `assetAddress` is omitted, a local
 * MockUSDT is deployed (only legal in the local rehearsal mode).
 */
export async function deployPhase({ signer, artifacts, assetAddress = null, targetAddress = null, governorAddress, guardianAddress, keeperAddress, policyDelay = 86_400, nativeUsdE8 = 300_000_000_000n, assetUsdE8 = 100_000_000n, allowMockAsset = false, allowSameGuardian = false, onStep = () => {} }) {
  const tx = new TxRecorder(signer, onStep);
  const deployerAddress = await signer.getAddress();
  const governor = asAddress(governorAddress ?? deployerAddress, 'governorAddress');
  if (governor !== deployerAddress) {
    // AccessController grants are governor-only, so phase 1 must be signed by
    // the governor. A multisig can take over later with the delayed
    // queueGovernorTransfer/acceptGovernorTransfer flow.
    throw new Error('The phase-1 signer must be the governor address');
  }
  let guardian = guardianAddress ? asAddress(guardianAddress, 'guardianAddress') : governor;
  if (guardian === governor && !allowSameGuardian) {
    // governor and guardian being the same key removes the separation between
    // policy control and emergency pause. A local rehearsal may opt in through
    // allowSameGuardian; a live deployment must pass COLLECTIVE_GUARDIAN_ADDRESS
    // (a separately controlled wallet) unless it sets the explicit override.
    throw new Error('Guardian must be a different address from the governor (set COLLECTIVE_GUARDIAN_ADDRESS)');
  }
  if (!(Number(policyDelay) >= 86_400 && Number(policyDelay) <= 30 * 86_400)) {
    throw new Error('policyDelay must be between 1 and 30 days');
  }

  let asset;
  if (assetAddress) {
    asset = new Contract(asAddress(assetAddress, 'assetAddress'), artifacts.MockUSDT.abi, signer);
  } else if (allowMockAsset) {
    asset = await tx.deploy('MockUSDT', artifacts.MockUSDT, []);
  } else {
    throw new Error('assetAddress is required: this tool never invents a token address');
  }
  const assetAddr = await asset.getAddress();
  if (assetAddress && signer.provider) {
    const code = await signer.provider.getCode(assetAddr);
    if (!code || code === '0x') throw new Error(`No ERC-20 bytecode at assetAddress ${assetAddr}`);
  }
  const decimals = Number(await asset.decimals());
  const symbol = String(await asset.symbol());
  if (!Number.isInteger(decimals) || decimals > 18) {
    throw new Error(`Accounting asset decimals ${decimals} exceed the factory limit`);
  }
  if (!symbol) throw new Error('Accounting asset has no readable symbol');

  let target;
  let targetKind = 'external';
  if (targetAddress) {
    const targetAddrInput = asAddress(targetAddress, 'targetAddress');
    target = new Contract(targetAddrInput, artifacts.NoYield4626Strategy.abi, signer);
    targetKind = 'external';
    // Preflight the immutable target before spending gas on the stack: it must
    // be a deployed ERC-4626 whose asset() is exactly the accounting asset.
    if (signer.provider) {
      const code = await signer.provider.getCode(targetAddrInput);
      if (!code || code === '0x') throw new Error(`No ERC-4626 bytecode at strategyTarget ${targetAddrInput}`);
    }
    let targetAsset;
    try {
      targetAsset = await target.asset();
    } catch {
      throw new Error(`strategyTarget ${targetAddrInput} does not implement ERC-4626 asset()`);
    }
    if (String(targetAsset).toLowerCase() !== assetAddr.toLowerCase()) {
      throw new Error(`strategyTarget asset ${targetAsset} does not match the accounting asset ${assetAddr}`);
    }
  } else {
    target = await tx.deploy('NoYield4626Strategy', artifacts.NoYield4626Strategy, [assetAddr]);
    targetKind = 'no-yield-idle';
  }
  const targetAddr = await target.getAddress();

  const access = await tx.deploy('AccessController', artifacts.AccessController, [governor, guardian]);
  const accessAddr = await access.getAddress();
  const emergency = await tx.deploy('EmergencyModule', artifacts.EmergencyModule, [accessAddr]);
  const emergencyAddr = await emergency.getAddress();
  const priceOracle = await tx.deploy('DeclaredPriceOracle', artifacts.DeclaredPriceOracle, [assetAddr, assetUsdE8, nativeUsdE8]);
  const priceAddr = await priceOracle.getAddress();
  const liquidityOracle = await tx.deploy('DisabledLiquidityOracle', artifacts.DisabledLiquidityOracle, []);
  const liquidityAddr = await liquidityOracle.getAddress();
  const risk = await tx.deploy('RiskController', artifacts.RiskController, [accessAddr, emergencyAddr, priceAddr, liquidityAddr, policyDelay]);
  const riskAddr = await risk.getAddress();
  const router = await tx.deploy('ExecutionRouter', artifacts.ExecutionRouter, [accessAddr, emergencyAddr, riskAddr]);
  const routerAddr = await router.getAddress();
  const vaultDeployer = await tx.deploy('StrategyVaultDeployer', artifacts.StrategyVaultDeployer, [accessAddr, emergencyAddr, riskAddr, routerAddr]);
  const vaultDeployerAddr = await vaultDeployer.getAddress();
  const modulesDeployer = await tx.deploy('CollectiveModulesDeployer', artifacts.CollectiveModulesDeployer, [accessAddr]);
  const modulesDeployerAddr = await modulesDeployer.getAddress();
  const factory = await tx.deploy('CollectiveFactory', artifacts.CollectiveFactory, [
    accessAddr, emergencyAddr, riskAddr, routerAddr, assetAddr, vaultDeployerAddr, modulesDeployerAddr
  ]);
  const factoryAddr = await factory.getAddress();
  const factoryBlock = tx.transactions[tx.transactions.length - 1].blockNumber;

  await tx.send('bind vault deployer to factory', vaultDeployer, 'setFactory', [factoryAddr]);
  await tx.send('bind modules deployer to factory', modulesDeployer, 'setFactory', [factoryAddr]);

  const FACTORY_ROLE = await access.FACTORY_ROLE();
  const ROUTER_ROLE = await access.EXECUTION_ROUTER_ROLE();
  const KEEPER_ROLE = await access.KEEPER_ROLE();
  await tx.send('grant FACTORY_ROLE', access, 'grantRole', [FACTORY_ROLE, factoryAddr]);
  await tx.send('grant EXECUTION_ROUTER_ROLE', access, 'grantRole', [ROUTER_ROLE, routerAddr]);
  if (keeperAddress) {
    await tx.send('grant KEEPER_ROLE', access, 'grantRole', [KEEPER_ROLE, asAddress(keeperAddress, 'keeperAddress')]);
  }

  await tx.send('queue accounting-asset allowlist', risk, 'queueAddressChange', [RISK_KIND.ALLOW_ASSET, assetAddr, true]);
  await tx.send('queue strategy-target allowlist', risk, 'queueAddressChange', [RISK_KIND.ALLOW_PROTOCOL, targetAddr, true]);
  await tx.send('queue stable-yield activation', risk, 'queueKindActivation', [RISK_KIND.STABLE_YIELD, true]);

  // Read the freshly deployed system back before writing any record: a record
  // that claims a configuration the chain does not have is worse than no record.
  if (lowercase(await factory.usdt()) !== lowercase(assetAddr)) throw new Error('factory.usdt() does not match the accounting asset');
  if (lowercase(await vaultDeployer.factory()) !== lowercase(factoryAddr)) throw new Error('vault deployer is not bound to the factory');
  if (lowercase(await modulesDeployer.factory()) !== lowercase(factoryAddr)) throw new Error('modules deployer is not bound to the factory');
  if (!(await access.hasRole(FACTORY_ROLE, factoryAddr))) throw new Error('factory role was not granted');
  if (!(await access.hasRole(ROUTER_ROLE, routerAddr))) throw new Error('execution-router role was not granted');
  if (keeperAddress && !(await access.hasRole(KEEPER_ROLE, asAddress(keeperAddress, 'keeperAddress')))) throw new Error('keeper role was not granted');

  const queueBlock = await signer.provider.getBlock('latest');

  return {
    schema: 'fbt.collective.deployment.v1',
    chainId: Number((await signer.provider.getNetwork()).chainId),
    deployer: deployerAddress,
    governor,
    guardian,
    keeper: keeperAddress ? asAddress(keeperAddress, 'keeperAddress') : null,
    policyDelay: Number(policyDelay),
    asset: { address: assetAddr, symbol, decimals },
    target: { address: targetAddr, kind: targetKind },
    contracts: {
      accessController: accessAddr,
      emergencyModule: emergencyAddr,
      priceOracle: priceAddr,
      liquidityOracle: liquidityAddr,
      riskController: riskAddr,
      executionRouter: routerAddr,
      vaultDeployer: vaultDeployerAddr,
      modulesDeployer: modulesDeployerAddr,
      factory: factoryAddr
    },
    oracle: {
      kind: 'declared-fixed',
      assetUsdE8: String(assetUsdE8),
      nativeUsdE8: String(nativeUsdE8),
      note: 'Declared prices, not a market feed. Staleness cannot be detected by design.'
    },
    factoryDeploymentBlock: factoryBlock,
    queuedAt: Number(queueBlock?.timestamp ?? 0),
    timelockReadyAt: Number(queueBlock?.timestamp ?? 0) + Number(policyDelay),
    gas: {
      payer: deployerAddress,
      policy: 'user-wallet-only',
      sponsored: false,
      totalGasUsed: tx.totalGasUsed.toString(),
      totalGasCostWei: tx.totalGasCostWei.toString()
    },
    transactions: tx.transactions,
    phase: 'queued'
  };
}

/** Phase 2 — execute the queued allowlists/activation and create the vault. */
export async function activatePhase({ signer, artifacts, deployment, limits = DEFAULT_LIMITS, vaultName, vaultSymbol, onStep = () => {} }) {
  const tx = new TxRecorder(signer, onStep);
  const access = new Contract(deployment.contracts.accessController, artifacts.AccessController.abi, signer);
  const risk = new Contract(deployment.contracts.riskController, artifacts.RiskController.abi, signer);
  const factory = new Contract(deployment.contracts.factory, artifacts.CollectiveFactory.abi, signer);
  const assetAddr = deployment.asset.address;
  const targetAddr = deployment.target.address;

  const governorRole = await access.GOVERNOR_ROLE();
  const signerAddress = await signer.getAddress();
  if (!(await access.hasRole(governorRole, signerAddress))) {
    throw new Error(`${signerAddress} does not hold GOVERNOR_ROLE on ${deployment.contracts.accessController}`);
  }

  await tx.send('execute accounting-asset allowlist', risk, 'executeAddressChange', [RISK_KIND.ALLOW_ASSET, assetAddr, true]);
  await tx.send('execute strategy-target allowlist', risk, 'executeAddressChange', [RISK_KIND.ALLOW_PROTOCOL, targetAddr, true]);
  await tx.send('execute stable-yield activation', risk, 'executeKindActivation', [RISK_KIND.STABLE_YIELD]);

  const asset = new Contract(assetAddr, artifacts.MockUSDT.abi, signer);
  const symbol = String(await asset.symbol());
  const name = vaultName || `FBT Collective ${symbol} Stable`;
  const shareSymbol = vaultSymbol || `c${symbol}`.slice(0, 11);

  const normalizedLimits = {
    maxTradeUsdE8: BigInt(limits.maxTradeUsdE8),
    maxTxCostUsdE8: BigInt(limits.maxTxCostUsdE8),
    minLiquidityUsdE8: BigInt(limits.minLiquidityUsdE8),
    maxAllocationBps: Number(limits.maxAllocationBps),
    maxConcentrationBps: Number(limits.maxConcentrationBps),
    maxSlippageBps: Number(limits.maxSlippageBps),
    reserveBps: Number(limits.reserveBps),
    maxOracleAgeSeconds: Number(limits.maxOracleAgeSeconds),
    enabled: Boolean(limits.enabled)
  };

  await tx.send('create stable-yield vault', factory, 'createStableYieldVault', [name, shareSymbol, targetAddr, normalizedLimits]);
  const vaultCount = Number(await factory.vaultCount());
  const vaultAddress = await factory.vaultAt(vaultCount - 1);
  const vault = new Contract(vaultAddress, artifacts.StrategyVault.abi, signer);
  const adapterAddress = await factory.vaultAdapter(vaultAddress);
  const epochManager = await vault.epochManager();
  const withdrawalQueue = await vault.withdrawalQueue();

  return {
    ...deployment,
    phase: 'active',
    vault: {
      address: getAddress(vaultAddress),
      name,
      symbol: shareSymbol,
      adapter: getAddress(adapterAddress),
      epochManager: getAddress(epochManager),
      withdrawalQueue: getAddress(withdrawalQueue),
      index: vaultCount - 1
    },
    shareDecimals: Number(await vault.decimals()),
    limits: Object.fromEntries(Object.entries(normalizedLimits).map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value])),
    activation: {
      activatedAt: Number((await signer.provider.getBlock('latest'))?.timestamp ?? 0),
      gasPayer: signerAddress,
      sponsored: false
    },
    gas: {
      payer: signerAddress,
      policy: 'user-wallet-only',
      sponsored: false,
      phase1GasUsed: deployment.gas?.totalGasUsed ?? '0',
      phase1GasCostWei: deployment.gas?.totalGasCostWei ?? '0',
      phase2GasUsed: tx.totalGasUsed.toString(),
      phase2GasCostWei: tx.totalGasCostWei.toString(),
      totalGasUsed: (BigInt(deployment.gas?.totalGasUsed ?? 0) + tx.totalGasUsed).toString(),
      totalGasCostWei: (BigInt(deployment.gas?.totalGasCostWei ?? 0) + tx.totalGasCostWei).toString()
    },
    transactions: [...(deployment.transactions ?? []), ...tx.transactions]
  };
}

/** The public, secret-free deployment record is safe to commit and to serve. */
export function publicDeploymentRecord(deployment) {
  const record = JSON.parse(JSON.stringify(deployment));
  delete record.deployerKey;
  return record;
}

export function deploymentEnv(deployment, { rpcUrl = '', maxEventSpan = 20_000 } = {}) {
  const lines = [
    '# Generated by scripts/collective-activate.mjs — contains no secrets.',
    'COLLECTIVE_READS_ENABLED=true',
    `COLLECTIVE_CHAIN_ID=${deployment.chainId}`,
    `COLLECTIVE_RPC_URL=${rpcUrl || 'https://<verified-read-only-rpc>'}`,
    `COLLECTIVE_FACTORY_ADDRESS=${deployment.contracts.factory}`,
    `COLLECTIVE_ASSET_ADDRESS=${deployment.asset.address}`,
    `COLLECTIVE_DEPLOYMENT_BLOCK=${deployment.factoryDeploymentBlock}`,
    `COLLECTIVE_EVENT_MAX_BLOCK_SPAN=${maxEventSpan}`,
    '# User transactions are signed by the user wallet and pay their own gas.',
    'COLLECTIVE_KEEPER_ENABLED=false'
  ];
  return `${lines.join('\n')}\n`;
}
