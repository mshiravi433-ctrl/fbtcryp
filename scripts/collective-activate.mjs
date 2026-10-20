#!/usr/bin/env node
/**
 * Turn on (or verify) the public, read-only FBT AI Collective dashboard for an
 * already deployed factory.
 *
 *   node scripts/collective-activate.mjs --deployment deployments/collective-4663.json --env
 *   node scripts/collective-activate.mjs --deployment <file> --env --write .env.collective.local
 *   node scripts/collective-activate.mjs --deployment <file> --check
 *
 * `--check` performs the same deployment verification the public API performs
 * before serving a single byte of chain data:
 *   chain id · contract bytecode · factory accounting asset · vault registry
 *   risk allowlists and kind activation · emergency pause · target/asset match
 *
 * Exit code is non-zero if any check fails. The script never needs, prints or
 * stores a private key: reads use only the configured HTTPS RPC.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider } from 'ethers';
import {
  FACTORY_ABI, VAULT_ABI, RISK_ABI, EMERGENCY_ABI, ORACLE_ABI, ADAPTER_ABI, ERC20_ABI, EPOCH_ABI, ACCESS_ABI
} from '../server/collective/abi.js';
import { NETWORKS, networkByChainId, networkByName, publicDeploymentRecord, deploymentEnv } from './lib/collectiveDeployment.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const chainArg = valueOf('--chain', null);
const requestedNetwork = chainArg == null
  ? null
  : networkByName(chainArg) ?? (Number.isSafeInteger(Number(chainArg)) ? networkByChainId(Number(chainArg)) : null);
if (chainArg != null && !requestedNetwork) {
  console.error(`✗ unsupported --chain ${chainArg}; supported chain IDs: ${Object.values(NETWORKS).map((row) => row.chainId).join(', ')}`);
  process.exit(1);
}
const defaultNetwork = requestedNetwork ?? networkByName('robinhood');
const file = path.resolve(root, valueOf('--deployment', path.join('deployments', `collective-${defaultNetwork.chainId}.json`)));
if (!fs.existsSync(file)) {
  console.error(`✗ deployment record not found: ${path.relative(root, file)}`);
  console.error(`  Deploy first: node scripts/collective-deploy.mjs --network ${defaultNetwork.name} --phase deploy --execute`);
  process.exit(1);
}
const deployment = JSON.parse(fs.readFileSync(file, 'utf8'));
const recordNetwork = networkByChainId(deployment.chainId);
if (!recordNetwork) {
  console.error(`✗ unsupported deployment record chainId ${deployment.chainId}; refusing to read or update it`);
  process.exit(1);
}
if (requestedNetwork && requestedNetwork.chainId !== recordNetwork.chainId) {
  console.error(`✗ --chain ${requestedNetwork.chainId} does not match deployment record chainId ${deployment.chainId}; refusing cross-network reads`);
  process.exit(1);
}
if ((recordNetwork.testnet && deployment.testnet !== true) ||
    (deployment.testnet != null && Boolean(deployment.testnet) !== recordNetwork.testnet)) {
  console.error('✗ deployment record testnet flag conflicts with its chainId; refusing cross-network reads');
  process.exit(1);
}
const selectedNetwork = recordNetwork;
const rpcUrl = String(process.env.COLLECTIVE_RPC_URL ?? '').trim() || selectedNetwork.rpcUrl;
const maxSpan = String(process.env.COLLECTIVE_EVENT_MAX_BLOCK_SPAN ?? '20000').trim();
try {
  const parsed = new URL(rpcUrl);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid');
} catch {
  console.error('✗ COLLECTIVE_RPC_URL must be a credential-free HTTPS read endpoint with no query token or fragment.');
  process.exit(1);
}
if (has('--write-verified') && !has('--check')) {
  console.error('✗ --write-verified is only allowed together with --check');
  process.exit(1);
}

if (has('--env') || has('--write')) {
  const block = deploymentEnv(deployment, { rpcUrl, maxEventSpan: maxSpan });
  const writeTo = valueOf('--write', null);
  if (writeTo) {
    const target = path.resolve(root, writeTo);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, block);
    console.log(`✓ wrote ${path.relative(root, target)} (gitignored if it ends with .local)`);
    console.log('  Restart the API process to load the new environment.');
  } else {
    console.log(block.trimEnd());
  }
  if (!has('--check')) process.exit(0);
}

if (!has('--check') && !has('--env') && !has('--write')) {
  console.log('Nothing to do. Use --env to print the read configuration or --check to verify the deployment.');
  process.exit(0);
}

const checks = [];
const record = (name, pass, detail = '') => {
  checks.push({ name, pass, detail });
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  const provider = new JsonRpcProvider(rpcUrl, selectedNetwork.chainId);
  const network = await provider.getNetwork();
  record(`RPC chain id is ${selectedNetwork.displayName} (${selectedNetwork.chainId})`, Number(network.chainId) === selectedNetwork.chainId, String(network.chainId));
  if (Number(network.chainId) !== selectedNetwork.chainId) throw new Error('chain id mismatch; refusing cross-network verification');
  if (selectedNetwork.testnet) console.log('  TESTNET — test assets have no real-world value; no mainnet record is read or changed.');

  const { contracts, asset: assetRecord, target, vault: vaultRecord } = deployment;
  if (!vaultRecord?.address) {
    record('deployment record contains a vault', false, 'phase 2 has not run yet');
    throw new Error('deployment is not active');
  }

  const codeTargets = [
    ['factory', contracts.factory],
    ['asset', assetRecord.address],
    ['vault', vaultRecord.address],
    ['strategy target', target.address],
    ['adapter', vaultRecord.adapter],
    ['epoch manager', vaultRecord.epochManager],
    ['withdrawal queue', vaultRecord.withdrawalQueue],
    ['risk controller', contracts.riskController],
    ['access controller', contracts.accessController],
    ['emergency module', contracts.emergencyModule],
    ['price oracle', contracts.priceOracle]
  ];
  const codes = await Promise.all(codeTargets.map(([, address]) => provider.getCode(address)));
  codeTargets.forEach(([name, address], index) => record(`${name} has bytecode`, codes[index] !== '0x', address));

  const factory = new Contract(contracts.factory, FACTORY_ABI, provider);
  const risk = new Contract(contracts.riskController, RISK_ABI, provider);
  const vault = new Contract(vaultRecord.address, VAULT_ABI, provider);
  const adapter = new Contract(vaultRecord.adapter, ADAPTER_ABI, provider);
  const asset = new Contract(assetRecord.address, ERC20_ABI, provider);
  const emergency = new Contract(contracts.emergencyModule, EMERGENCY_ABI, provider);
  const oracle = new Contract(contracts.priceOracle, ORACLE_ABI, provider);
  const epoch = new Contract(vaultRecord.epochManager, EPOCH_ABI, provider);
  const access = new Contract(contracts.accessController, ACCESS_ABI, provider);

  const lower = (value) => String(value).toLowerCase();
  const factoryAsset = await factory.usdt();
  record('factory accounting asset matches the record', lower(factoryAsset) === lower(assetRecord.address), factoryAsset);
  const allVaults = await factory.allVaults();
  record('factory lists the vault', allVaults.some((row) => lower(row) === lower(vaultRecord.address)), `${allVaults.length} vault(s)`);
  record('vault asset matches the accounting asset', lower(await vault.asset()) === lower(assetRecord.address), await vault.asset());

  record('risk controller registered the vault', await risk.registeredVault(vaultRecord.address));
  record('vault kind is stable-yield (0)', Number(await risk.vaultKind(vaultRecord.address)) === 0);
  record('vault accounting asset allowlisted', lower(await risk.vaultAsset(vaultRecord.address)) === lower(assetRecord.address));
  record('strategy target allowlisted for this vault', lower(await risk.vaultProtocol(vaultRecord.address)) === lower(target.address));
  record('stable-yield kind activated', await risk.isKindEnabled(0));
  record('accounting asset allowlisted globally', await risk.isAssetAllowed(assetRecord.address));
  record('strategy target allowlisted globally', await risk.isProtocolAllowed(target.address));
  // ethers v6 reserves Contract.target for the contract's own address, so the
  // ABI target() view has to be reached explicitly via getFunction.
  const adapterTarget = await adapter.getFunction('target')();
  record('adapter target matches the record', lower(adapterTarget) === lower(target.address), adapterTarget);
  record('adapter asset matches the accounting asset', lower(await adapter.asset()) === lower(assetRecord.address));
  record('on-chain emergency pause is off', !(await emergency.paused()));

  const limits = await risk.limits(vaultRecord.address);
  record('on-chain vault limits enabled', Boolean(limits.enabled ?? limits[8]));
  record('vault share decimals readable', Number(await vault.decimals()) <= 18, String(await vault.decimals()));
  record('epoch manager current epoch readable', Number(await epoch.currentEpoch()) >= 1, String(await epoch.currentEpoch()));
  const keeperRole = await access.KEEPER_ROLE();
  record('keeper role is held by at least the recorded keeper', deployment.keeper ? await access.hasRole(keeperRole, deployment.keeper) : true, deployment.keeper || 'no keeper recorded');

  const [assetPrice, assetUpdatedAt] = await oracle.tokenPriceUsdE8(assetRecord.address);
  const [nativePrice, nativeUpdatedAt] = await oracle.nativePriceUsdE8();
  record('declared asset price is non-zero', BigInt(assetPrice) > 0n, String(assetPrice));
  record('declared native price is non-zero', BigInt(nativePrice) > 0n, String(nativePrice));
  const latest = await provider.getBlock('latest');
  record('asset price observation is fresh', Number(latest.timestamp) - Number(assetUpdatedAt) <= 3600);
  record('native price observation is fresh', Number(latest.timestamp) - Number(nativeUpdatedAt) <= 3600);
  const assetSymbol = await asset.symbol();
  record('asset metadata readable', true, `${assetSymbol} / ${await asset.decimals()} decimals`);

  const failed = checks.filter((row) => !row.pass);
  console.log('');
  if (failed.length) {
    console.error(`✗ ${failed.length} check(s) failed. Keep public reads disabled and investigate.`);
    process.exit(1);
  }
  console.log(`✓ all ${checks.length} checks passed on ${selectedNetwork.displayName} (${selectedNetwork.chainId}).`);
  console.log('  gas: every user action is signed by the user wallet; sponsored=false, serverSigning=false');
  if (has('--write-verified')) {
    const verifiedRecord = publicDeploymentRecord({
      ...deployment,
      chainId: selectedNetwork.chainId,
      network: selectedNetwork.name,
      testnet: selectedNetwork.testnet,
      verified: true,
      verifiedAt: new Date().toISOString()
    });
    fs.writeFileSync(file, `${JSON.stringify(verifiedRecord, null, 2)}\n`);
    console.log(`✓ marked ${path.relative(root, file)} verified=true testnet=${selectedNetwork.testnet}`);
  }
  if (has('--json')) console.log(JSON.stringify({ ok: true, checks, file: path.relative(root, file), chainId: selectedNetwork.chainId, testnet: selectedNetwork.testnet }, null, 2));
} catch (cause) {
  console.error(`✗ verification aborted: ${cause?.shortMessage || cause?.message || cause}`);
  process.exit(1);
}
