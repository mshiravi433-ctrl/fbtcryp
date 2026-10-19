#!/usr/bin/env node
/** Compile the isolated FBT AI Collective contracts without producing tracked artifacts. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const solc = require('solc');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'contracts', 'collective');
const outputRoot = path.join(root, 'test', '.out', 'collective');
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(target) : (entry.name.endsWith('.sol') ? [target] : []);
});
const files = walk(sourceRoot).sort();
const sources = Object.fromEntries(files.map((file) => [
  path.relative(root, file).split(path.sep).join('/'),
  { content: fs.readFileSync(file, 'utf8') }
]));

function findImports(importPath) {
  const resolved = importPath.startsWith('@openzeppelin/contracts/')
    ? path.join(root, 'node_modules', importPath)
    : path.join(root, importPath);
  try {
    return { contents: fs.readFileSync(resolved, 'utf8') };
  } catch (error) {
    return { error: `Unable to resolve ${importPath}: ${error.message}` };
  }
}

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: 'paris',
    outputSelection: {
      '*': {
        '*': [
          'abi',
          'evm.bytecode.object',
          'evm.deployedBytecode.object',
          'evm.gasEstimates',
          'storageLayout'
        ]
      }
    }
  }
};

console.log(`Compiling ${files.length} Collective Solidity files with ${solc.version()}…`);
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (output.errors || []).filter((item) => item.severity === 'error');
const warnings = (output.errors || []).filter((item) => item.severity === 'warning');
for (const warning of warnings) console.warn('⚠', warning.formattedMessage.trim());
if (errors.length) {
  for (const error of errors) console.error(error.formattedMessage);
  process.exit(1);
}

fs.mkdirSync(outputRoot, { recursive: true });
const summaries = [];
for (const [sourceName, contracts] of Object.entries(output.contracts || {})) {
  if (!sourceName.startsWith('contracts/collective/')) continue;
  for (const [contractName, compiled] of Object.entries(contracts)) {
    if (!compiled.evm.bytecode.object) continue;
    const artifact = {
      contractName,
      sourceName,
      abi: compiled.abi,
      bytecode: `0x${compiled.evm.bytecode.object}`,
      deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
      compiler: solc.version(),
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: 'paris'
    };
    fs.writeFileSync(path.join(outputRoot, `${contractName}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
    const deployedBytes = compiled.evm.deployedBytecode.object.length / 2;
    summaries.push(`${contractName}: ${deployedBytes} deployed bytes`);
    if (deployedBytes > 24_576) {
      console.error(`✗ ${contractName} exceeds EIP-170 (${deployedBytes} bytes)`);
      process.exitCode = 1;
    }
  }
}
if (process.exitCode) process.exit(process.exitCode);
console.log(summaries.map((line) => `  ✓ ${line}`).join('\n'));
console.log(`Artifacts are local-only: ${path.relative(root, outputRoot)}`);
