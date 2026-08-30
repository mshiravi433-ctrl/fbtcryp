/**
 * Compiles contracts/FlashLiquidityRouter.sol -> src/lib/flashLiquidityRouterArtifact.json
 * Run: node scripts/compile-flash-liquidity.mjs
 *
 * The artifact ships ABI + bytecode for the Intent OS "Flash Liquidity" panel
 * so the browser can show the exact on-chain surface a wallet would sign.
 * Bytecode presence does NOT mean deployed or audited — the planner keeps
 * execution gated until an address is configured and an audit is on record.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const solc = require('solc');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const source = fs.readFileSync(path.join(root, 'contracts/FlashLiquidityRouter.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'FlashLiquidityRouter.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris', // BSC-safe: avoids PUSH0 from Shanghai
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

const c = out.contracts['FlashLiquidityRouter.sol'].FlashLiquidityRouter;
const artifact = {
  contractName: 'FlashLiquidityRouter',
  abi: c.abi,
  bytecode: '0x' + c.evm.bytecode.object,
  deployedBytecode: '0x' + c.evm.deployedBytecode.object,
  compiler: solc.version(),
  evmVersion: 'paris',
  optimizer: { enabled: true, runs: 200 },
  audited: false, // flipped by hand only after a real audit report exists
  notAuditedNotice: 'Reference executor. Independent audit required before mainnet use.'
};

const size = artifact.deployedBytecode.length / 2 - 1;
fs.writeFileSync(path.join(root, 'src/lib/flashLiquidityRouterArtifact.json'), JSON.stringify(artifact, null, 2) + '\n');
console.log('✓ compiled FlashLiquidityRouter');
console.log('  deployed bytecode:', size, 'bytes (EIP-170 limit 24576)');
if (size > 24576) {
  console.error('✗ contract exceeds EIP-170 size limit');
  process.exit(1);
}
console.log('  functions:', artifact.abi.filter((x) => x.type === 'function').length);
