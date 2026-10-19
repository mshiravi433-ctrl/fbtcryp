#!/usr/bin/env node
/**
 * Read-only, keyless preflight for a specific Robinhood Chain network.
 *
 * Checks the selected RPC chain id, a public deployer address's ETH balance,
 * and deployed ERC-20 code + symbol/decimals for an explicitly supplied asset.
 * This script never reads a private key and never sends a transaction.
 *
 * Example:
 *   COLLECTIVE_RPC_URL=https://rpc.testnet.chain.robinhood.com \
 *   COLLECTIVE_DEPLOYER_ADDRESS=0x... COLLECTIVE_ASSET_ADDRESS=0x... \
 *   node scripts/collective-preflight.mjs --network robinhood-testnet --phase testnet-deploy
 */
import { Contract, JsonRpcProvider, formatEther, formatUnits, getAddress, isAddress } from 'ethers';
import { ERC20_ABI } from '../server/collective/abi.js';
import { NETWORKS, networkByChainId, networkByName } from './lib/collectiveDeployment.mjs';
import {
  COLLECTIVE_PREFLIGHT_GAS_HEADROOM_BPS,
  collectivePreflightGas,
  collectivePreflightGasBudget
} from './lib/collectivePreflight.mjs';

const args = process.argv.slice(2);
const valueOf = (flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

function selectedNetwork() {
  const name = valueOf('--network');
  const chainArg = valueOf('--chain');
  if (name && chainArg) throw new Error('pass only one of --network or --chain');
  const network = name
    ? networkByName(name)
    : chainArg
      ? networkByChainId(Number(chainArg))
      : networkByName('robinhood');
  if (!network) throw new Error(`UNSUPPORTED_CHAIN: use one of ${Object.values(NETWORKS).map((row) => `${row.name} (${row.chainId})`).join(', ')}`);
  return network;
}

function safeRpcUrl(value, network) {
  const raw = String(value || network.rpcUrl).trim();
  let url;
  try { url = new URL(raw); } catch { throw new Error('COLLECTIVE_RPC_URL is not a valid URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('COLLECTIVE_RPC_URL must be a credential-free HTTPS endpoint (no user-info, query string or fragment)');
  }
  return url.toString();
}

function normalizedAddress(value, label) {
  const input = String(value ?? '').trim();
  if (!isAddress(input)) throw new Error(`${label} is required and must be a valid public EVM address`);
  return getAddress(input);
}

async function main() {
  let network;
  try {
    network = selectedNetwork();
  } catch (cause) {
    throw cause;
  }
  const phase = valueOf('--phase', process.env.COLLECTIVE_PHASE || 'preflight');
  const gasEstimate = collectivePreflightGas(phase);
  const assetAddress = normalizedAddress(valueOf('--asset', process.env.COLLECTIVE_ASSET_ADDRESS), 'COLLECTIVE_ASSET_ADDRESS');
  const deployerAddress = normalizedAddress(valueOf('--deployer', process.env.COLLECTIVE_DEPLOYER_ADDRESS), 'COLLECTIVE_DEPLOYER_ADDRESS');
  const rpcUrl = safeRpcUrl(process.env.COLLECTIVE_RPC_URL, network);
  const provider = new JsonRpcProvider(rpcUrl, network.chainId);

  console.log(`FBT Collective read-only preflight · ${network.displayName} · chainId ${network.chainId} · testnet=${network.testnet} · phase=${phase}`);
  if (network.testnet) console.log('TESTNET: test assets have no real-world value. This preflight sends no transaction.');

  let connected;
  try {
    connected = await provider.getNetwork();
  } catch {
    throw new Error(`RPC_UNAVAILABLE: the ${network.displayName} RPC did not respond; no network or address was guessed`);
  }
  if (Number(connected.chainId) !== network.chainId) {
    throw new Error(`UNSUPPORTED_CHAIN: RPC returned ${connected.chainId}; expected ${network.chainId}. No token or balance checks were run.`);
  }
  console.log(`  ✓ RPC chain id · ${connected.chainId}`);

  let balance;
  try { balance = await provider.getBalance(deployerAddress); }
  catch { throw new Error('RPC_UNAVAILABLE: could not read the public deployer ETH balance'); }
  const balanceText = formatEther(balance);
  const balanceOk = balance > 0n;
  console.log(`  ${balanceOk ? '✓' : '✗'} public deployer balance · ${deployerAddress} · ${balanceText} ETH`);
  if (!balanceOk) throw new Error('DEPLOYER_BALANCE_ZERO: the public deployer address has no ETH on the selected chain');

  let code;
  try { code = await provider.getCode(assetAddress); }
  catch { throw new Error('RPC_UNAVAILABLE: could not read asset contract code'); }
  if (!code || code === '0x' || code === '0x0') {
    console.log(`  ✗ asset contract bytecode · ${assetAddress} · no code`);
    throw new Error('ASSET_HAS_NO_CODE: the supplied address is not a deployed contract on the selected chain');
  }
  console.log(`  ✓ asset contract bytecode · ${assetAddress}`);

  let symbol;
  let decimals;
  try {
    const asset = new Contract(assetAddress, ERC20_ABI, provider);
    [symbol, decimals] = await Promise.all([asset.symbol(), asset.decimals()]);
    symbol = String(symbol).trim();
    decimals = Number(decimals);
  } catch {
    throw new Error('ASSET_METADATA_UNREADABLE: the supplied contract does not return ERC-20 symbol() and decimals()');
  }
  if (!symbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('ASSET_METADATA_INVALID: symbol must be non-empty and decimals must be an integer from 0 through 18');
  }
  console.log(`  ✓ asset metadata · ${symbol} · ${decimals} decimals · ${assetAddress}`);

  if (gasEstimate.gasUnits > 0n) {
    let feeData;
    try { feeData = await provider.getFeeData(); }
    catch { throw new Error('RPC_UNAVAILABLE: could not read current network gas-fee data'); }
    const feePerGas = feeData?.maxFeePerGas != null && feeData.maxFeePerGas > 0n
      ? feeData.maxFeePerGas
      : feeData?.gasPrice;
    if (feePerGas == null || feePerGas <= 0n) {
      throw new Error('GAS_FEE_UNAVAILABLE: the RPC did not report a positive gas price; no zero-gas assumption was made');
    }
    const budget = collectivePreflightGasBudget(phase, feePerGas);
    const availableText = formatEther(balance);
    const estimatedText = formatEther(budget.estimatedCostWei);
    const requiredText = formatEther(budget.requiredBalanceWei);
    console.log(`  ✓ fee cap · ${formatUnits(feePerGas, 9)} gwei`);
    console.log(`  estimated ${budget.operation} gas · ${budget.gasUnits} units · ${estimatedText} ETH`);
    console.log(`  required with ${Number(COLLECTIVE_PREFLIGHT_GAS_HEADROOM_BPS - 10_000) / 100}% headroom · ${requiredText} ETH · available ${availableText} ETH`);
    if (balance < budget.requiredBalanceWei) {
      throw new Error(`DEPLOYER_BALANCE_BELOW_ESTIMATED_GAS: ${availableText} ETH available, ${requiredText} ETH required for the ${budget.operation} reference budget at the current fee cap`);
    }
  } else {
    console.log('  ✓ no transaction gas budget requested for this read-only check');
  }

  console.log('✓ all read-only preflight checks passed. No transaction was sent and no key was used.');
}

try {
  await main();
} catch (cause) {
  const message = String(cause?.message || cause || 'PREFLIGHT_FAILED');
  console.error(`✗ ${message}`);
  process.exitCode = 1;
}
