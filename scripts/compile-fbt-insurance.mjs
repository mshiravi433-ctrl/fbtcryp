/**
 * Compiles contracts/FBTInsuranceRouter.sol -> src/lib/fbtInsuranceRouterArtifact.json
 * Run: node scripts/compile-fbt-insurance.mjs
 *
 * The contract is self-contained (no external imports) so the single-source
 * solc compile used across this repo works without a node_modules resolver.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const solc = require('solc');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const file = 'FBTInsuranceRouter.sol';
const source = fs.readFileSync(path.join(root, 'contracts', file), 'utf8');

const input = {
  language: 'Solidity',
  sources: { [file]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris', // BSC-safe: avoids PUSH0 from Shanghai
    viaIR: true, // resolves stack-too-deep in the many-arg purchase function
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } }
  }
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === 'error');
const warnings = (out.errors || []).filter((e) => e.severity === 'warning');
warnings.forEach((w) => console.log('⚠ ', w.formattedMessage.split('\n')[0]));
if (errors.length) {
  errors.forEach((e) => console.error(e.formattedMessage));
  process.exit(1);
}

const c = out.contracts[file].FBTInsuranceRouter;
const artifact = {
  contractName: 'FBTInsuranceRouter',
  abi: c.abi,
  bytecode: '0x' + c.evm.bytecode.object,
  deployedBytecode: '0x' + c.evm.deployedBytecode.object,
  compiler: solc.version(),
  evmVersion: 'paris',
  optimizer: { enabled: true, runs: 200 }
};
fs.writeFileSync(path.join(root, 'src/lib/fbtInsuranceRouterArtifact.json'), JSON.stringify(artifact, null, 2) + '\n');
console.log('✓ compiled FBTInsuranceRouter');
console.log('  bytecode:', (artifact.bytecode.length / 2 - 1), 'bytes (limit 24576)');
console.log('  functions:', artifact.abi.filter((x) => x.type === 'function').length);
