/* The synchronous ABI coder, proved against ethers.
 *
 * `src/lib/defi/abiLite.js` encodes and decodes the split router's ABI
 * without loading `ethers`, because the plan builder and the receipt
 * parser are synchronous and `Interface` is lazy (it returns a PROMISE).
 *
 * A hand-written coder is exactly the kind of thing that must be PROVED
 * rather than trusted, so this file compares it against `ethers` on every
 * function and every event it handles. If the selectors drift, the chain
 * receives the wrong call — and the test fails.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Interface } from 'ethers';
import { buildCoder, canonicalSignature, functionSelector, eventTopic } from '../../src/lib/defi/abiLite.js';
import { keccak256Hex } from '../../server/keccak.js';

const ROUTER_ABI = [
  'function feeBps() view returns (uint256)',
  'function quoteFee(uint256 amountIn) view returns (uint256 fee, uint256 amountAfterFee)',
  'function supplyAave(uint256 amount)',
  'function supplyCompound(uint256 amount)',
  'function supplyMorpho(uint256 amount)',
  'function stakeLido() payable',
  'function approve(address spender, uint256 amount)'
];

const EVENT_SIG = 'event Routed(address indexed target, address indexed user, address indexed asset, uint256 amountIn, uint256 feeTaken, uint256 netAmount)';

const sigOf = (sig) => {
  const name = sig.slice('function '.length).split('(')[0];
  const args = sig.slice(sig.indexOf('(') + 1, sig.indexOf(')'));
  const outs = [];
  const m = sig.match(/returns\s*\(([^)]*)\)/);
  if (m) for (const part of m[1].split(',')) outs.push(part.trim().split(/\s+/)[0]);
  return { name, signature: `${name}(${args})`, outputs: outs };
};

const coder = buildCoder({
  functions: ROUTER_ABI.map(sigOf),
  events: [{
    signature: EVENT_SIG,
    inputs: [
      { name: 'target', type: 'address', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'asset', type: 'address', indexed: true },
      { name: 'amountIn', type: 'uint256', indexed: false },
      { name: 'feeTaken', type: 'uint256', indexed: false },
      { name: 'netAmount', type: 'uint256', indexed: false }
    ]
  }]
});

test('the selectors are byte-identical to ethers', () => {
  const iface = new Interface(ROUTER_ABI);
  for (const sig of ROUTER_ABI) {
    const { name, signature } = sigOf(sig);
    const expected = iface.getFunction(name).selector;
    assert.equal(functionSelector(signature), expected, `selector for ${name}`);
  }
});

test('the event topic is byte-identical to ethers', () => {
  const iface = new Interface([EVENT_SIG]);
  assert.equal(eventTopic(EVENT_SIG), iface.getEvent('Routed').topicHash);
});

test('the selector does not depend on parameter NAMES', () => {
  assert.equal(
    functionSelector('supplyAave(uint256 amount)'),
    functionSelector('supplyAave(uint256)')
  );
  assert.equal(
    eventTopic('Routed(address indexed target, address indexed user, address indexed asset, uint256 amountIn, uint256 feeTaken, uint256 netAmount)'),
    eventTopic('Routed(address,address,address,uint256,uint256,uint256)')
  );
});

test('the selector is the keccak of the canonical signature', () => {
  assert.equal(functionSelector('supplyAave(uint256)'), keccak256Hex('supplyAave(uint256)').slice(0, 10));
});

test('every encoded call matches ethers byte for byte', () => {
  const iface = new Interface(ROUTER_ABI);
  const cases = [
    ['feeBps', [], 'feeBps()'],
    ['stakeLido', [], 'stakeLido()'],
    ['quoteFee', [1234n], 'quoteFee(uint256)'],
    ['supplyAave', [1_000_000n], 'supplyAave(uint256)'],
    ['supplyCompound', [0n], 'supplyCompound(uint256)'],
    ['supplyMorpho', [999_999_999_999n], 'supplyMorpho(uint256)'],
    ['approve', ['0x1234567890123456789012345678901234567890', 500n], 'approve(address,uint256)']
  ];
  for (const [name, args, signature] of cases) {
    assert.equal(
      coder.encodeFunctionData(signature, args),
      iface.encodeFunctionData(name, args),
      `call data for ${name}`
    );
  }
});

test('a bare function name resolves to the one entry that carries it', () => {
  const iface = new Interface(ROUTER_ABI);
  assert.equal(
    coder.encodeFunctionData('approve', ['0x1234567890123456789012345678901234567890', 7n]),
    iface.encodeFunctionData('approve', ['0x1234567890123456789012345678901234567890', 7n])
  );
});

test('the decoded results match ethers', () => {
  const iface = new Interface(ROUTER_ABI);
  const encoded = iface.encodeFunctionResult('quoteFee', [30n, 970n]);
  assert.deepEqual(
    coder.decodeFunctionResult('quoteFee(uint256)', encoded).map(String),
    iface.decodeFunctionResult('quoteFee', encoded).map(String)
  );
});

test('the decoded call arguments match ethers', () => {
  const iface = new Interface(ROUTER_ABI);
  const args = ['0x1234567890123456789012345678901234567890', 500n];
  const encoded = iface.encodeFunctionData('approve', args);
  assert.deepEqual(
    coder.decodeFunctionData('approve', encoded).map(String),
    iface.decodeFunctionData('approve', encoded).map(String)
  );
});

test('the parsed event matches ethers, field for field', () => {
  const iface = new Interface([EVENT_SIG]);
  const args = [
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333',
    1000n, 30n, 970n
  ];
  const log = iface.encodeEventLog(iface.getEvent('Routed'), args);
  const mine = coder.parseLog({ topics: log.topics, data: log.data });
  const theirs = iface.parseLog({ topics: log.topics, data: log.data });
  assert.equal(mine.name, 'Routed');
  assert.equal(mine.args.target, theirs.args[0]);
  assert.equal(mine.args.user, theirs.args[1]);
  assert.equal(mine.args.asset, theirs.args[2]);
  assert.equal(mine.args.amountIn, theirs.args[3]);
  assert.equal(mine.args.feeTaken, theirs.args[4]);
  assert.equal(mine.args.netAmount, theirs.args[5]);
});

test('the coder refuses what it cannot encode correctly', () => {
  assert.throws(() => coder.encodeFunctionData('transfer(address,uint256)', ['0x1', 1n]), /ABI_UNKNOWN_FUNCTION/);
  assert.throws(() => coder.encodeFunctionData('approve(address,uint256)', ['not-an-address', 1n]), /ABI_ADDRESS_INVALID/);
  assert.throws(() => coder.encodeFunctionData('supplyAave(uint256)', [-1n]), /ABI_UINT256_NEGATIVE/);
  assert.throws(() => coder.encodeFunctionData('supplyAave(uint256)', [1n << 256n]), /ABI_UINT256_OVERFLOW/);
  assert.throws(() => coder.parseLog({ topics: ['0xdeadbeef'], data: '0x' }), /ABI_UNKNOWN_EVENT_TOPIC/);
});

test('the canonical signature drops names, indexed and the keyword', () => {
  assert.equal(canonicalSignature('function feeBps() view returns (uint256)'), 'feeBps()');
  assert.equal(canonicalSignature('feeBps'), 'feeBps()');
  assert.equal(
    canonicalSignature('event Routed(address indexed target, uint256 amountIn)'),
    'Routed(address,uint256)'
  );
});
