#!/usr/bin/env node
/**
 * Compiles FBT Intent Protocol smart contracts and emits artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const solc = require('solc');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractsDir = path.join(root, 'contracts');
const artifactsDir = path.join(root, 'src/lib/protocol/artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

const contractFiles = [
  'IFBTSettlement.sol',
  'FBTProtocolConfig.sol',
  'FBTNonceManager.sol',
  'FBTSolverRegistry.sol',
  'FBTIntentVerifier.sol',
  'FBTSettlement.sol',
  'FBTIntentRegistry.sol'
];

const sources = {};
for (const f of contractFiles) {
  const p = path.join(contractsDir, f);
  sources[f] = { content: fs.readFileSync(p, 'utf8') };
}

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.gasEstimates']
      }
    }
  }
};

console.log('Compiling FBT Intent Protocol contracts with solc', solc.version(), '...');
const output = JSON.parse(solc.compile(JSON.stringify(input)));

const errors = (output.errors || []).filter((e) => e.severity === 'error');
const warnings = (output.errors || []).filter((e) => e.severity === 'warning');

warnings.forEach((w) => console.log('⚠', w.formattedMessage.split('\n')[0]));
if (errors.length > 0) {
  errors.forEach((e) => console.error(e.formattedMessage));
  process.exit(1);
}

for (const [sourceName, contracts] of Object.entries(output.contracts)) {
  for (const [contractName, data] of Object.entries(contracts)) {
    const artifact = {
      contractName,
      sourceName,
      abi: data.abi,
      bytecode: `0x${data.evm.bytecode.object}`,
      deployedBytecode: `0x${data.evm.deployedBytecode.object}`,
      compiler: solc.version(),
      evmVersion: 'paris'
    };

    const dest = path.join(artifactsDir, `${contractName}.json`);
    fs.writeFileSync(dest, JSON.stringify(artifact, null, 2));
    console.log(`✓ ${contractName} -> ${dest} (${data.abi.length} ABI items)`);
  }
}

console.log('Successfully compiled all FBT Intent Protocol contracts!');
