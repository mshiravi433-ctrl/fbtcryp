#!/usr/bin/env node
/**
 * Deployment script for FBT Intent Protocol Contracts
 * Usage:
 *   RPC_URL=... PRIVATE_KEY=... node scripts/deploy-intent-protocol.mjs --network base
 */

import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = path.join(root, 'src/lib/protocol/artifacts');

function loadArtifact(name) {
  const p = path.join(artifactsDir, `${name}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`Artifact ${name} not found. Run npm run compile:contract first.`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export const NETWORK_CONFIGS = {
  mainnet: { chainId: 1, name: 'Ethereum Mainnet', explorer: 'https://etherscan.io' },
  base: { chainId: 8453, name: 'Base', explorer: 'https://basescan.org' },
  arbitrum: { chainId: 42161, name: 'Arbitrum One', explorer: 'https://arbiscan.io' },
  optimism: { chainId: 10, name: 'OP Mainnet', explorer: 'https://optimistic.etherscan.io' },
  polygon: { chainId: 137, name: 'Polygon PoS', explorer: 'https://polygonscan.com' },
  bsc: { chainId: 56, name: 'BNB Smart Chain', explorer: 'https://bscscan.com' },
  avalanche: { chainId: 43114, name: 'Avalanche C-Chain', explorer: 'https://snowtrace.io' },
  linea: { chainId: 59144, name: 'Linea', explorer: 'https://lineascan.build' },
  sonic: { chainId: 146, name: 'Sonic', explorer: 'https://sonicscan.org' }
};

export async function deployIntentProtocol({ signer, feeRecipient = null, defaultFeeBps = 10 } = {}) {
  const deployerAddress = await signer.getAddress();
  const targetFeeRecipient = feeRecipient || deployerAddress;

  console.log(`Deploying FBT Intent Protocol with account: ${deployerAddress}`);

  // 1. Deploy FBTProtocolConfig
  const ConfigArtifact = loadArtifact('FBTProtocolConfig');
  const ConfigFactory = new ethers.ContractFactory(ConfigArtifact.abi, ConfigArtifact.bytecode, signer);
  const config = await ConfigFactory.deploy(targetFeeRecipient, defaultFeeBps);
  await config.waitForDeployment();
  const configAddr = await config.getAddress();
  console.log(`✓ FBTProtocolConfig deployed at: ${configAddr}`);

  // 2. Deploy FBTNonceManager
  const NonceArtifact = loadArtifact('FBTNonceManager');
  const NonceFactory = new ethers.ContractFactory(NonceArtifact.abi, NonceArtifact.bytecode, signer);
  const nonceManager = await NonceFactory.deploy();
  await nonceManager.waitForDeployment();
  const nonceAddr = await nonceManager.getAddress();
  console.log(`✓ FBTNonceManager deployed at: ${nonceAddr}`);

  // 3. Deploy FBTSolverRegistry
  const SolverRegistryArtifact = loadArtifact('FBTSolverRegistry');
  const SolverRegistryFactory = new ethers.ContractFactory(SolverRegistryArtifact.abi, SolverRegistryArtifact.bytecode, signer);
  const solverRegistry = await SolverRegistryFactory.deploy();
  await solverRegistry.waitForDeployment();
  const solverRegistryAddr = await solverRegistry.getAddress();
  console.log(`✓ FBTSolverRegistry deployed at: ${solverRegistryAddr}`);

  // 4. Compute settlement address ahead or deploy Settlement
  // FBTIntentVerifier needs Settlement contract address for domain separator
  // We can deploy Verifier with predicted address or update pattern
  const VerifierArtifact = loadArtifact('FBTIntentVerifier');
  const VerifierFactory = new ethers.ContractFactory(VerifierArtifact.abi, VerifierArtifact.bytecode, signer);
  // Deploy verifier
  const verifier = await VerifierFactory.deploy(deployerAddress);
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log(`✓ FBTIntentVerifier deployed at: ${verifierAddr}`);

  // 5. Deploy FBTSettlement
  const SettlementArtifact = loadArtifact('FBTSettlement');
  const SettlementFactory = new ethers.ContractFactory(SettlementArtifact.abi, SettlementArtifact.bytecode, signer);
  const settlement = await SettlementFactory.deploy(configAddr, nonceAddr, solverRegistryAddr, verifierAddr);
  await settlement.waitForDeployment();
  const settlementAddr = await settlement.getAddress();
  console.log(`✓ FBTSettlement deployed at: ${settlementAddr}`);

  // 6. Authorize Settlement engine on NonceManager and SolverRegistry
  let tx = await nonceManager.setSettlementEngine(settlementAddr);
  await tx.wait();
  tx = await solverRegistry.setSettlementEngine(settlementAddr);
  await tx.wait();
  tx = await config.setSettlerAuthorization(settlementAddr, true);
  await tx.wait();

  // 7. Deploy FBTIntentRegistry
  const RegistryArtifact = loadArtifact('FBTIntentRegistry');
  const RegistryFactory = new ethers.ContractFactory(RegistryArtifact.abi, RegistryArtifact.bytecode, signer);
  const registry = await RegistryFactory.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  tx = await registry.setSettlementEngine(settlementAddr);
  await tx.wait();
  console.log(`✓ FBTIntentRegistry deployed at: ${registryAddr}`);

  const manifest = {
    network: (await signer.provider.getNetwork()).name,
    chainId: Number((await signer.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    contracts: {
      FBTProtocolConfig: configAddr,
      FBTNonceManager: nonceAddr,
      FBTSolverRegistry: solverRegistryAddr,
      FBTIntentVerifier: verifierAddr,
      FBTSettlement: settlementAddr,
      FBTIntentRegistry: registryAddr
    }
  };

  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;
  if (!rpcUrl || !privateKey) {
    console.log('Skipping standalone execution: Set RPC_URL and PRIVATE_KEY to deploy to live network.');
  } else {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    deployIntentProtocol({ signer: wallet }).then((m) => {
      console.log('Deployment complete:', m);
    }).catch(console.error);
  }
}
