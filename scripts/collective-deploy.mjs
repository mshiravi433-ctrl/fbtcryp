#!/usr/bin/env node
/**
 * FBT AI Collective — activation tool.
 *
 *   npm run compile:collective          # build local-only solc artifacts
 *   node scripts/collective-deploy.mjs --local --rehearse
 *       Full local rehearsal on an in-process Ganache chain: deploy, wait the
 *       real 1-day policy timelock, activate, create the vault, deposit and
 *       invest with a user wallet, then verify through the same reader the
 *       production API uses. No real funds, no network.
 *
 *   node scripts/collective-deploy.mjs --network robinhood --phase deploy --execute
 *   node scripts/collective-deploy.mjs --network robinhood --phase activate --execute
 *       Live activation on Robinhood Chain (4663). Every transaction is signed
 *       by COLLECTIVE_DEPLOYER_PRIVATE_KEY, i.e. the operator's own wallet pays
 *       the gas. There is no relayer, paymaster or sponsored path.
 *
 * Safety properties:
 *   - `--execute` is required for any live transaction. Without it the script
 *     only prints the plan.
 *   - No token, oracle or strategy address is invented. The accounting asset
 *     must be supplied and its on-chain symbol/decimals are read back.
 *   - The RiskController timelock (>= 1 day) is respected; phase 2 refuses to
 *     run early and tells you the exact timestamp.
 *   - The private key is read from the environment and never written to disk,
 *     logged, or included in the deployment record.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, formatEther } from 'ethers';
import {
  DEFAULT_LIMITS,
  NETWORKS,
  ROBINHOOD_CHAIN_ID,
  loadCollectiveArtifacts,
  networkByName,
  deployPhase,
  activatePhase,
  publicDeploymentRecord
} from './lib/collectiveDeployment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const LOCAL = has('--local');
const networkName = valueOf('--network', 'robinhood');
const network = networkByName(networkName);
if (!LOCAL && !network) {
  console.error(`✗ unsupported --network ${networkName}; supported networks: ${Object.keys(NETWORKS).join(', ')}`);
  process.exit(1);
}
const LIVE_NETWORK = network ?? NETWORKS.robinhood;
const EXECUTE = has('--execute');
const REHEARSE = has('--rehearse') || LOCAL;
const PHASE = valueOf('--phase', LOCAL ? 'all' : 'deploy');
const OUT = valueOf('--out', LOCAL
  ? path.join(root, 'test', '.out', 'collective-deployment.local.json')
  : path.join(root, 'deployments', `collective-${LIVE_NETWORK.chainId}.json`));
const STATE = valueOf('--state', OUT);

const log = (line = '') => console.log(line);
const ok = (line) => console.log(`  ✓ ${line}`);
const warn = (line) => console.log(`  ! ${line}`);

function readLimitsFromEnv() {
  const env = process.env;
  const number = (name, fallback) => (env[name] == null || env[name] === '' ? fallback : Number(env[name]));
  const big = (name, fallback) => (env[name] == null || env[name] === '' ? fallback : BigInt(env[name]));
  return {
    maxTradeUsdE8: big('COLLECTIVE_MAX_TRADE_USD_E8', DEFAULT_LIMITS.maxTradeUsdE8),
    maxTxCostUsdE8: big('COLLECTIVE_MAX_TX_COST_USD_E8', DEFAULT_LIMITS.maxTxCostUsdE8),
    minLiquidityUsdE8: big('COLLECTIVE_MIN_LIQUIDITY_USD_E8', DEFAULT_LIMITS.minLiquidityUsdE8),
    maxAllocationBps: number('COLLECTIVE_MAX_ALLOCATION_BPS', DEFAULT_LIMITS.maxAllocationBps),
    maxConcentrationBps: number('COLLECTIVE_MAX_CONCENTRATION_BPS', DEFAULT_LIMITS.maxConcentrationBps),
    maxSlippageBps: number('COLLECTIVE_MAX_SLIPPAGE_BPS', DEFAULT_LIMITS.maxSlippageBps),
    reserveBps: number('COLLECTIVE_RESERVE_BPS', DEFAULT_LIMITS.reserveBps),
    maxOracleAgeSeconds: number('COLLECTIVE_MAX_ORACLE_AGE_SECONDS', DEFAULT_LIMITS.maxOracleAgeSeconds),
    enabled: true
  };
}

function writeRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const publicRecord = publicDeploymentRecord({ ...record, verified: false, verifiedAt: null });
  fs.writeFileSync(file, `${JSON.stringify(publicRecord, null, 2)}\n`);
  ok(`deployment record → ${path.relative(root, file)}`);
}

function printPlan() {
  log(`FBT AI Collective — ${LIVE_NETWORK.displayName} activation plan (no transaction was sent)`);
  log(`  chainId=${LIVE_NETWORK.chainId} · testnet=${LIVE_NETWORK.testnet}`);
  if (LIVE_NETWORK.testnet) log('  TESTNET: tokens have no real-world value; transactions still spend testnet ETH gas.');
  log('');
  log('  Phase 1  deploy AccessController, EmergencyModule, oracles, RiskController,');
  log('           ExecutionRouter, both deployers and the factory; bind roles; queue');
  log('           asset/protocol allowlists and stable-yield activation (1-day timelock).');
  log('  Phase 2  after the timelock: execute the queued policy and create the vault.');
  log('');
  log('  Required environment:');
  log('    COLLECTIVE_DEPLOYER_PRIVATE_KEY   your wallet key (pays all gas; never stored)');
  log('    COLLECTIVE_RPC_URL                verified Robinhood Chain RPC');
  log('    COLLECTIVE_ASSET_ADDRESS          accounting stablecoin (no default, never invented)');
  log('  Optional:');
  log('    COLLECTIVE_STRATEGY_TARGET        audited ERC-4626 target; omitted ⇒ no-yield idle target');
  log('    COLLECTIVE_GOVERNOR_ADDRESS, COLLECTIVE_GUARDIAN_ADDRESS, COLLECTIVE_KEEPER_ADDRESS');
  log('    COLLECTIVE_VAULT_NAME, COLLECTIVE_VAULT_SYMBOL, COLLECTIVE_GAS_TOKEN_USD_E8');
  log('');
  log('  Re-run with --execute to send transactions.');
}

async function runLocal() {
  const { default: ganache } = await import('ganache');
  const artifacts = loadCollectiveArtifacts(root);
  log('FBT AI Collective — local activation rehearsal (Ganache, no real funds)');
  const rpc = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: ROBINHOOD_CHAIN_ID },
    wallet: { totalAccounts: 8, defaultBalance: 10_000 },
    miner: { blockGasLimit: 30_000_000 }
  });
  const { BrowserProvider } = await import('ethers');
  const provider = new BrowserProvider(rpc);
  const signers = await Promise.all(Array.from({ length: 4 }, (_, index) => provider.getSigner(index)));
  const [deployer, keeper, user] = signers;

  const policyDelay = 86_400;
  log(`  deployer ${await deployer.getAddress()} · policy timelock ${policyDelay}s`);
  const phase1 = await deployPhase({
    signer: deployer,
    artifacts,
    allowMockAsset: true,
    allowSameGuardian: true,
    governorAddress: await deployer.getAddress(),
    guardianAddress: await deployer.getAddress(),
    keeperAddress: await keeper.getAddress(),
    policyDelay,
    onStep: (row) => ok(`${row.label}${row.address ? ` → ${row.address}` : ''}`)
  });
  writeRecord(OUT, phase1);

  log('  advancing the chain past the real policy timelock…');
  await provider.send('evm_increaseTime', [policyDelay + 1]);
  await provider.send('evm_mine', []);

  const phase2 = await activatePhase({
    signer: deployer,
    artifacts,
    deployment: phase1,
    onStep: (row) => ok(`${row.label}${row.address ? ` → ${row.address}` : ''}`)
  });
  writeRecord(OUT, phase2);
  ok(`vault ${phase2.vault.address} (${phase2.vault.symbol}) on target ${phase2.target.address} [${phase2.target.kind}]`);

  if (REHEARSE) {
    const asset = new Contract(phase2.asset.address, artifacts.MockUSDT.abi, deployer);
    const vault = new Contract(phase2.vault.address, artifacts.StrategyVault.abi, deployer);
    const userSigner = user;
    const userAddress = await userSigner.getAddress();
    const userAsset = asset.connect(userSigner);
    const userVault = vault.connect(userSigner);

    // The user mints test tokens locally only; the deposit transaction itself
    // is signed and paid for by the user's own wallet.
    await (await asset.mint(userAddress, 1_000_000_000n)).wait();
    const before = await provider.getBalance(userAddress);
    await (await userAsset.approve(phase2.vault.address, 100_000_000n)).wait();
    await (await userVault.deposit(100_000_000n, userAddress)).wait();
    const after = await provider.getBalance(userAddress);
    const userGasWei = before - after;
    if (userGasWei <= 0n) throw new Error('rehearsal expected the user wallet to pay gas');
    ok(`user deposit signed by ${userAddress}; user paid ${formatEther(userGasWei)} gas`);

    await provider.send('evm_increaseTime', [7 * 86_400 + 1]);
    await provider.send('evm_mine', []);
    await (await vault.startFirstEpoch()).wait();
    const vaultKeeper = vault.connect(keeper);
    await (await vaultKeeper.invest(50_000_000n)).wait();
    ok('first epoch started and keeper invested 50 units into the fixed target');

    const { createCollectiveReader } = await import('../server/collective/reader.js');
    const { readCollectiveConfig, publicCollectiveConfig } = await import('../server/collective/config.js');
    const config = readCollectiveConfig({
      COLLECTIVE_READS_ENABLED: 'true',
      COLLECTIVE_CHAIN_ID: String(ROBINHOOD_CHAIN_ID),
      COLLECTIVE_RPC_URL: 'http://127.0.0.1:8545',
      COLLECTIVE_FACTORY_ADDRESS: phase2.contracts.factory,
      COLLECTIVE_ASSET_ADDRESS: phase2.asset.address,
      COLLECTIVE_DEPLOYMENT_BLOCK: String(phase2.factoryDeploymentBlock),
      COLLECTIVE_ALLOW_LOCAL_RPC: 'true',
      NODE_ENV: 'test'
    });
    const reader = createCollectiveReader({ config, provider });
    const [status, vaults, position] = await Promise.all([
      reader.status(),
      reader.listVaults(),
      reader.getPosition(phase2.vault.address, userAddress)
    ]);
    if (!status.ready) throw new Error(`reader not ready: ${status.reason}`);
    if (vaults.length !== 1) throw new Error(`expected exactly one vault, got ${vaults.length}`);
    if (BigInt(position.shareBalanceRaw) !== 100_000_000n) throw new Error('unexpected rehearsal share balance');
    ok('API reader verified the deployment, listed the vault and read the user position');
    ok(`gas policy=${publicCollectiveConfig(config).operations.gasPayer}, sponsored=${publicCollectiveConfig(config).operations.gasSponsorshipEnabled}`);
    log('');
    log(`  total rehearsal gas: ${phase2.gas.totalGasUsed} units (${formatEther(phase2.gas.totalGasCostWei)} ETH-equivalent)`);
  }

  log('');
  log('Local rehearsal passed. Nothing was deployed to a public network.');
  return phase2;
}

async function connectLive(selectedNetwork) {
  const rpcUrl = String(process.env.COLLECTIVE_RPC_URL ?? '').trim() || selectedNetwork.rpcUrl;
  const key = String(process.env.COLLECTIVE_DEPLOYER_PRIVATE_KEY ?? '').trim();
  if (!/^https:\/\//.test(rpcUrl) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(rpcUrl)) {
    throw new Error('COLLECTIVE_RPC_URL must use HTTPS (loopback http is allowed for a local node)');
  }
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('COLLECTIVE_RPC_URL must not embed credentials or query tokens; use a credential-free provider endpoint');
    }
  } catch (cause) {
    if (String(cause?.message || '').includes('credentials')) throw cause;
    throw new Error('COLLECTIVE_RPC_URL is not a valid URL');
  }
  if (!key) throw new Error('COLLECTIVE_DEPLOYER_PRIVATE_KEY is required to sign with your own wallet');
  const provider = new JsonRpcProvider(rpcUrl, selectedNetwork.chainId);
  const connectedNetwork = await provider.getNetwork();
  if (Number(connectedNetwork.chainId) !== selectedNetwork.chainId) {
    throw new Error(`RPC chain id ${connectedNetwork.chainId} does not match ${selectedNetwork.displayName} (${selectedNetwork.chainId}); refusing to send transactions`);
  }
  const signer = new Wallet(key, provider);
  const balance = await provider.getBalance(signer.address);
  log(`  signer ${signer.address} · balance ${formatEther(balance)} native gas units`);
  if (balance === 0n) throw new Error('The signing wallet has no gas balance. Fund your own wallet; this tool never sponsors gas.');
  return { provider, signer };
}

async function runLive() {
  const artifacts = loadCollectiveArtifacts(root);
  if (!EXECUTE) return printPlan();
  const { signer } = await connectLive(LIVE_NETWORK);
  const address = await signer.getAddress();
  const assetAddress = String(process.env.COLLECTIVE_ASSET_ADDRESS ?? '').trim();
  const targetAddress = String(process.env.COLLECTIVE_STRATEGY_TARGET ?? '').trim() || null;
  const governorAddress = process.env.COLLECTIVE_GOVERNOR_ADDRESS || address;
  const guardianAddress = process.env.COLLECTIVE_GUARDIAN_ADDRESS || '';
  const keeperAddress = process.env.COLLECTIVE_KEEPER_ADDRESS || '';
  const limits = readLimitsFromEnv();

  log(`FBT AI Collective — ${LIVE_NETWORK.displayName} activation`);
  log(`  chainId: ${LIVE_NETWORK.chainId} · testnet=${LIVE_NETWORK.testnet}`);
  if (LIVE_NETWORK.testnet) log('  TESTNET — assets have no real-world value; the wallet still pays testnet ETH gas.');
  log(`  gas payer: ${address} (your wallet); sponsored=false`);
  log(`  accounting asset: ${assetAddress || '<missing>'} · target: ${targetAddress || 'no-yield idle (deployed now)'}`);

  if (PHASE === 'deploy') {
    if (fs.existsSync(OUT)) {
      throw new Error(`Refusing to overwrite existing network-specific deployment record ${path.relative(root, OUT)}; review it and use a fresh, explicitly reviewed path before deploying again`);
    }
    if (!assetAddress) throw new Error('COLLECTIVE_ASSET_ADDRESS is required — the tool never invents a token address');
    log('');
    const record = await deployPhase({
      signer,
      artifacts,
      assetAddress,
      targetAddress,
      governorAddress,
      guardianAddress: guardianAddress || undefined,
      keeperAddress: keeperAddress || undefined,
      policyDelay: Number(process.env.COLLECTIVE_POLICY_DELAY_SECONDS || 86_400),
      nativeUsdE8: BigInt(process.env.COLLECTIVE_GAS_TOKEN_USD_E8 || 300_000_000_000n),
      assetUsdE8: BigInt(process.env.COLLECTIVE_ASSET_USD_E8 || 100_000_000n),
      allowMockAsset: false,
      allowSameGuardian: String(process.env.COLLECTIVE_ALLOW_SAME_GUARDIAN ?? '').toLowerCase() === 'true',
      onStep: (row) => ok(`${row.label}${row.address ? ` → ${row.address}` : ''} (${row.hash?.slice(0, 12)}…)`)
    });
    writeRecord(OUT, record);
    log('');
    log(`  Phase 1 queued. The RiskController timelock unlocks at ${new Date(record.timelockReadyAt * 1000).toISOString()}.`);
    log('  Run phase 2 after that time with:');
    log(`    node scripts/collective-deploy.mjs --network ${LIVE_NETWORK.name} --phase activate --execute`);
    return record;
  }

  if (PHASE === 'activate' || PHASE === 'all') {
    if (!fs.existsSync(STATE)) throw new Error(`No phase-1 record at ${STATE}. Run --phase deploy first.`);
    const deployment = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (Number(deployment.chainId) !== LIVE_NETWORK.chainId || Boolean(deployment.testnet) !== LIVE_NETWORK.testnet) {
      throw new Error(`Deployment record chainId/testnet does not match ${LIVE_NETWORK.displayName} (${LIVE_NETWORK.chainId}); refusing to activate it`);
    }
    const now = Number((await signer.provider.getBlock('latest'))?.timestamp ?? 0);
    if (now < deployment.timelockReadyAt) {
      throw new Error(`Policy timelock is not ready: ${new Date(deployment.timelockReadyAt * 1000).toISOString()} (now ${new Date(now * 1000).toISOString()})`);
    }
    const record = await activatePhase({
      signer,
      artifacts,
      deployment,
      limits,
      vaultName: process.env.COLLECTIVE_VAULT_NAME || undefined,
      vaultSymbol: process.env.COLLECTIVE_VAULT_SYMBOL || undefined,
      onStep: (row) => ok(`${row.label}${row.address ? ` → ${row.address}` : ''} (${row.hash?.slice(0, 12)}…)`)
    });
    writeRecord(OUT, record);
    log('');
    log('  Public reads can now be enabled with:');
    log(`    node scripts/collective-activate.mjs --deployment ${path.relative(root, OUT)} --env`);
    return record;
  }

  throw new Error(`Unknown --phase ${PHASE}`);
}

try {
  const result = LOCAL ? await runLocal() : await runLive();
  if (!LOCAL && result) {
    log('');
    log(`  gas used by the deploying wallet: ${result.gas?.totalGasUsed ?? '0'} units`);
  }
  process.exit(0);
} catch (cause) {
  console.error(`✗ ${cause?.shortMessage || cause?.message || cause}`);
  process.exit(1);
}
