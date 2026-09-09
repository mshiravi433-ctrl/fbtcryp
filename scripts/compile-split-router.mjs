/**
 * Compiles contracts/FBTSplitRouter.sol -> src/lib/splitRouterArtifact.json
 * and contracts/rehearsal/SplitRouterMocks.sol ->
 * test/split-router/splitRouterMocksArtifact.json
 * Run: node scripts/compile-split-router.mjs
 *
 * The router artifact ships ABI + bytecode so the client seam
 * (src/lib/defi/splitRouter.js) and the panels can encode the exact on-chain
 * surface a wallet would sign. Bytecode presence does NOT mean deployed or
 * audited — the money path stays direct-deposit until an address is
 * configured AND an audit is on record (see docs/defi/SPLIT-ROUTER-FA.md).
 *
 * The mocks artifact exists only for the local-EVM rehearsal; it is never
 * imported by app code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const solc = require('solc');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function compileOne(sourcePath, contractName) {
  const source = fs.readFileSync(path.join(root, sourcePath), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { [path.basename(sourcePath)]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris', // widest deploy compatibility; avoids PUSH0
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.gasEstimates'] } }
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

  const file = out.contracts[path.basename(sourcePath)];
  if (!file || !file[contractName]) {
    console.error(`✗ ${contractName} not found in ${sourcePath}`);
    process.exit(1);
  }
  return file[contractName];
}

/* ── the production router ──────────────────────────────────────────────── */
const router = compileOne('contracts/FBTSplitRouter.sol', 'FBTSplitRouter');
const routerArtifact = {
  contractName: 'FBTSplitRouter',
  abi: router.abi,
  bytecode: '0x' + router.evm.bytecode.object,
  deployedBytecode: '0x' + router.evm.deployedBytecode.object,
  compiler: solc.version(),
  evmVersion: 'paris',
  optimizer: { enabled: true, runs: 200 },
  audited: false, // flipped by hand only after a real audit report exists
  notAuditedNotice: 'Fee-on-deposit router. Independent audit + strict fork rehearsal required before mainnet use.',
  /* Declared at deploy time, asserted by the constructor; recorded here so
   * the artifact and the deployment cannot silently disagree. */
  maxFeeBps: 100
};
const routerSize = routerArtifact.deployedBytecode.length / 2 - 1;
fs.writeFileSync(
  path.join(root, 'src/lib/splitRouterArtifact.json'),
  JSON.stringify(routerArtifact, null, 2) + '\n'
);
console.log('✓ compiled FBTSplitRouter');
console.log('  deployed bytecode:', routerSize, 'bytes (EIP-170 limit 24576)');
if (routerSize > 24576) {
  console.error('✗ contract exceeds EIP-170 size limit');
  process.exit(1);
}
console.log('  functions:', routerArtifact.abi.filter((x) => x.type === 'function').length);

/* ── the rehearsal mocks (test-only) ────────────────────────────────────── */
const mocks = compileOne('contracts/rehearsal/SplitRouterMocks.sol', 'MockERC20');
/* The mocks file holds five contracts; solc returns them all under the file
 * key, so re-read and emit every one of them for the rehearsal script. */
const mockInput = {
  language: 'Solidity',
  sources: { 'SplitRouterMocks.sol': { content: fs.readFileSync(path.join(root, 'contracts/rehearsal/SplitRouterMocks.sol'), 'utf8') } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
  }
};
const mockOut = JSON.parse(solc.compile(JSON.stringify(mockInput)));
const mockErrors = (mockOut.errors || []).filter((e) => e.severity === 'error');
if (mockErrors.length) {
  mockErrors.forEach((e) => console.error(e.formattedMessage));
  process.exit(1);
}
const mockContracts = {};
for (const [name, c] of Object.entries(mockOut.contracts['SplitRouterMocks.sol'])) {
  mockContracts[name] = { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
}
fs.writeFileSync(
  path.join(root, 'test/split-router/splitRouterMocksArtifact.json'),
  JSON.stringify({ contractName: 'SplitRouterMocks', compiler: solc.version(), contracts: mockContracts }, null, 2) + '\n'
);
console.log('✓ compiled SplitRouterMocks:', Object.keys(mockContracts).join(', '));
