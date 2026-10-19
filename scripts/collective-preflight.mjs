#!/usr/bin/env node
// Read-only: never imports a wallet or consumes a private key.
import { Contract, JsonRpcProvider, formatEther, isAddress } from 'ethers';
import { networkByName } from './lib/collectiveDeployment.mjs';
const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
let provider;
try {
  const chain = networkByName(value('--network', 'robinhood-testnet'));
  const asset = value('--asset', process.env.COLLECTIVE_ASSET_ADDRESS);
  const deployer = value('--deployer', process.env.COLLECTIVE_DEPLOYER_ADDRESS);
  if (!isAddress(asset)) throw new Error('asset_address required: select a token from discovery; no address is guessed');
  if (!isAddress(deployer)) throw new Error('valid public deployer_address required');
  const rpc = process.env.COLLECTIVE_RPC_URL || chain.rpcUrl;
  const url = new URL(rpc);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('credential-free HTTPS RPC required');
  provider = new JsonRpcProvider(rpc, chain.id);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== chain.id) throw new Error('RPC chain mismatch');
  console.log(`chainId=${chain.id} testnet=${chain.testnet}`);
  const balance = await provider.getBalance(deployer);
  console.log(`public deployer ETH=${formatEther(balance)}`);
  if (balance === 0n) throw new Error('no gas balance');
  if (await provider.getCode(asset) === '0x') throw new Error('asset has no bytecode on selected chain');
  const token = new Contract(asset, ['function symbol() view returns(string)', 'function decimals() view returns(uint8)'], provider);
  const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
  if (!symbol || Number(decimals) > 18) throw new Error('unsupported asset metadata');
  console.log(`asset=${asset} symbol=${JSON.stringify(symbol)} decimals=${decimals}`);
  const fee = await provider.getFeeData();
  const estimate = 23660000n * (fee.maxFeePerGas ?? fee.gasPrice ?? 0n);
  console.log(`Phase-1 indicative gas budget=${formatEther(estimate)} ETH (not a guarantee)`);
  if (!estimate || balance < estimate) throw new Error('insufficient balance for indicative phase-1 gas budget');
  console.log('Preflight passed. On-chain transactions still cost gas.');
} catch {
  console.error('Preflight FAILED: asset_address/public deployer required; verify RPC availability, chain, token code/metadata and gas balance. No transaction sent; RPC errors suppressed.');
  process.exitCode = 1;
} finally { provider?.destroy(); }
