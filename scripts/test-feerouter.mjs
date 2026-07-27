/**
 * Deploy FeeRouter into a real EVM (ethereumjs) with a mock ERC20 + mock DEX,
 * then verify the 0.5% fee actually lands in the recipient's wallet.
 *
 * Requires dev-only deps that aren't part of the app bundle:
 *   npm i -D solc@0.8.26 @ethereumjs/vm@8.1.1
 *
 * Then: npm run test:feerouter
 */
let VM;
try {
  ({ VM } = await import('@ethereumjs/vm'));
} catch {
  console.error('\nMissing dev dependencies. Install them with:\n  npm i -D solc@0.8.26 @ethereumjs/vm@8.1.1\n');
  process.exit(1);
}
import { Common, Hardfork, Chain } from '@ethereumjs/common';
import { LegacyTransaction } from '@ethereumjs/tx';
import { Address, hexToBytes, bytesToHex, privateToAddress, Account } from '@ethereumjs/util';
import * as ethers from 'ethers';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const solc = require('solc');
const artifact = require('../src/lib/feeRouterArtifact.json');

const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Paris });
const vm = await VM.create({ common });

const pk = hexToBytes('0x' + '11'.repeat(32));
const owner = new Address(privateToAddress(pk));
const feeWallet = new Address(hexToBytes('0x' + 'fe'.repeat(20)));
const user = owner;

await vm.stateManager.putAccount(owner, new Account(0n, ethers.parseEther('1000')));

async function send(to, data, value = 0n) {
  const a = await vm.stateManager.getAccount(owner);
  const tx = LegacyTransaction.fromTxData(
    { to, data: hexToBytes(data), value, gasLimit: 8_000_000n, gasPrice: 10n, nonce: a.nonce },
    { common }
  ).sign(pk);
  const r = await vm.runTx({ tx, skipBalance: false });
  if (r.execResult.exceptionError) throw new Error(r.execResult.exceptionError.error + ' ' + bytesToHex(r.execResult.returnValue).slice(0,200));
  return r;
}

// ---- compile helper contracts (mock ERC20 + mock DEX) ----
const helpers = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract MockERC20 {
  string public name="Mock"; string public symbol="MCK"; uint8 public decimals=18;
  uint256 public totalSupply;
  mapping(address=>uint256) public balanceOf;
  mapping(address=>mapping(address=>uint256)) public allowance;
  constructor(uint256 s){ totalSupply=s; balanceOf[msg.sender]=s; }
  function transfer(address t,uint256 a) external returns(bool){ balanceOf[msg.sender]-=a; balanceOf[t]+=a; return true; }
  function approve(address s,uint256 a) external returns(bool){ allowance[msg.sender][s]=a; return true; }
  function transferFrom(address f,address t,uint256 a) external returns(bool){
    require(allowance[f][msg.sender]>=a,"ALLOW"); allowance[f][msg.sender]-=a;
    balanceOf[f]-=a; balanceOf[t]+=a; return true; }
  function mint(address t,uint256 a) external { balanceOf[t]+=a; totalSupply+=a; }
}
interface IERC20x { function transfer(address,uint256) external returns(bool);
  function transferFrom(address,address,uint256) external returns(bool);
  function balanceOf(address) external view returns(uint256); }
contract MockDex {
  address public tokenOut;
  function setTokenOut(address t) external { tokenOut=t; }
  function WETH() external view returns(address){ return address(this); }
  function swapExactTokensForTokensSupportingFeeOnTransferTokens(
    uint256 amountIn,uint256,address[] calldata path,address to,uint256) external {
    IERC20x(path[0]).transferFrom(msg.sender,address(this),amountIn);
    IERC20x(tokenOut).transfer(to, amountIn*2);  // 1:2 rate
  }
  function swapExactETHForTokensSupportingFeeOnTransferTokens(
    uint256,address[] calldata,address to,uint256) external payable {
    IERC20x(tokenOut).transfer(to, msg.value*2);
  }
  function swapExactTokensForETHSupportingFeeOnTransferTokens(
    uint256 amountIn,uint256,address[] calldata path,address to,uint256) external {
    IERC20x(path[0]).transferFrom(msg.sender,address(this),amountIn);
    (bool ok,)=payable(to).call{value:amountIn/2}(""); require(ok,"ETH");
  }
  receive() external payable {}
}`;
const hout = JSON.parse(solc.compile(JSON.stringify({
  language:'Solidity', sources:{'h.sol':{content:helpers}},
  settings:{optimizer:{enabled:true,runs:200}, evmVersion:'paris',
    outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
const herr=(hout.errors||[]).filter(e=>e.severity==='error');
if(herr.length){ console.error(herr.map(e=>e.formattedMessage).join('\n')); process.exit(1); }
const MockERC20 = hout.contracts['h.sol'].MockERC20;
const MockDex   = hout.contracts['h.sol'].MockDex;

async function deploy(bytecode, abi, args=[]) {
  const iface = new ethers.Interface(abi);
  const enc = args.length ? iface.encodeDeploy(args).slice(2) : '';
  const r = await send(null, '0x'+bytecode+enc);
  return { addr: r.createdAddress, iface };
}

console.log('=== deploying ===');
const tokenIn  = await deploy(MockERC20.evm.bytecode.object, MockERC20.abi, [ethers.parseEther('1000000')]);
const tokenOut = await deploy(MockERC20.evm.bytecode.object, MockERC20.abi, [ethers.parseEther('1000000')]);
const dex      = await deploy(MockDex.evm.bytecode.object, MockDex.abi, []);
const fr       = await deploy(artifact.bytecode.slice(2), artifact.abi,
                   [dex.addr.toString(), feeWallet.toString(), 50]); // 50 bps = 0.5%
console.log('FeeRouter at', fr.addr.toString());

// fund the mock dex with output tokens + ETH so it can pay out
await send(tokenOut.addr, tokenOut.iface.encodeFunctionData('mint',[dex.addr.toString(), ethers.parseEther('500000')]));
await send(dex.addr, dex.iface.encodeFunctionData('setTokenOut',[tokenOut.addr.toString()]));
const dexAcc = await vm.stateManager.getAccount(dex.addr);
dexAcc.balance = ethers.parseEther('100');
await vm.stateManager.putAccount(dex.addr, dexAcc);

const call = async (addr, iface, fn, args) => {
  const r = await vm.evm.runCall({ to: addr, caller: owner, origin: owner,
    data: hexToBytes(iface.encodeFunctionData(fn,args)), gasLimit: 5_000_000n });
  return iface.decodeFunctionResult(fn, bytesToHex(r.execResult.returnValue));
};
const balOf = async (tok, who) => (await call(tok.addr, tok.iface, 'balanceOf', [who]))[0];

console.log('\n=== config sanity ===');
console.log('feeBps      :', (await call(fr.addr, fr.iface,'feeBps',[]))[0].toString(), '(expect 50 = 0.5%)');
console.log('MAX_FEE_BPS :', (await call(fr.addr, fr.iface,'MAX_FEE_BPS',[]))[0].toString(), '(expect 100 = 1% ceiling)');
console.log('recipient   :', (await call(fr.addr, fr.iface,'feeRecipient',[]))[0].toLowerCase()===feeWallet.toString().toLowerCase());
const [qf,qa] = await call(fr.addr, fr.iface,'quoteFee',[ethers.parseEther('1000')]);
console.log('quoteFee(1000) -> fee', ethers.formatEther(qf), '| swap', ethers.formatEther(qa));

console.log('\n=== TEST 1: token -> token ===');
const AMT = ethers.parseEther('1000');
await send(tokenIn.addr, tokenIn.iface.encodeFunctionData('approve',[fr.addr.toString(), AMT]));
const feeBefore = await balOf(tokenIn, feeWallet.toString());
const userOutBefore = await balOf(tokenOut, user.toString());
await send(fr.addr, fr.iface.encodeFunctionData('swapExactTokensForTokens',
  [AMT, 0n, [tokenIn.addr.toString(), tokenOut.addr.toString()], user.toString(), 9999999999n]));
const feeAfter = await balOf(tokenIn, feeWallet.toString());
const userOutAfter = await balOf(tokenOut, user.toString());
const collected = feeAfter - feeBefore;
console.log('fee wallet received :', ethers.formatEther(collected), '(expect exactly 5.0 = 0.5% of 1000)');
console.log('EXACT 0.5%          :', collected === ethers.parseEther('5'));
console.log('user got out        :', ethers.formatEther(userOutAfter-userOutBefore), '(expect 1990 = 995*2)');
console.log('router left empty   :', (await balOf(tokenIn, fr.addr.toString()))===0n);

console.log('\n=== TEST 2: native BNB -> token ===');
const ethFeeBefore = (await vm.stateManager.getAccount(feeWallet))?.balance ?? 0n;
await send(fr.addr, fr.iface.encodeFunctionData('swapExactETHForTokens',
  [0n, [dex.addr.toString(), tokenOut.addr.toString()], user.toString(), 9999999999n]), ethers.parseEther('10'));
const ethFeeAfter = (await vm.stateManager.getAccount(feeWallet)).balance;
const ethFee = ethFeeAfter - ethFeeBefore;
console.log('fee wallet received :', ethers.formatEther(ethFee), 'BNB (expect exactly 0.05 = 0.5% of 10)');
console.log('EXACT 0.5%          :', ethFee === ethers.parseEther('0.05'));

console.log('\n=== TEST 3: token -> native ===');
const feeB3 = await balOf(tokenIn, feeWallet.toString());
await send(tokenIn.addr, tokenIn.iface.encodeFunctionData('approve',[fr.addr.toString(), ethers.parseEther('200')]));
await send(fr.addr, fr.iface.encodeFunctionData('swapExactTokensForETH',
  [ethers.parseEther('200'), 0n, [tokenIn.addr.toString(), dex.addr.toString()], user.toString(), 9999999999n]));
const fee3 = (await balOf(tokenIn, feeWallet.toString())) - feeB3;
console.log('fee wallet received :', ethers.formatEther(fee3), '(expect exactly 1.0 = 0.5% of 200)');
console.log('EXACT 0.5%          :', fee3 === ethers.parseEther('1'));

console.log('\n=== TEST 4: security guards ===');
// fee cap
try { await send(fr.addr, fr.iface.encodeFunctionData('setFeeBps',[500n])); console.log('✗ BUG: 5% fee accepted'); }
catch { console.log('fee >1% rejected      : ✓ (owner cannot rug traders)'); }
await send(fr.addr, fr.iface.encodeFunctionData('setFeeBps',[100n]));
console.log('fee =1% accepted      : ✓ (at the cap)');
await send(fr.addr, fr.iface.encodeFunctionData('setFeeBps',[50n]));
// non-owner cannot change recipient
const attackerPk = hexToBytes('0x'+'22'.repeat(32));
const attacker = new Address(privateToAddress(attackerPk));
await vm.stateManager.putAccount(attacker, new Account(0n, ethers.parseEther('10')));
const atk = LegacyTransaction.fromTxData({ to: fr.addr,
  data: hexToBytes(fr.iface.encodeFunctionData('setFeeRecipient',[attacker.toString()])),
  gasLimit: 200000n, gasPrice: 10n, nonce: 0n }, { common }).sign(attackerPk);
const ar = await vm.runTx({ tx: atk, skipBalance: false });
console.log('non-owner blocked     :', Boolean(ar.execResult.exceptionError), '✓');
// zero address
try { await send(fr.addr, fr.iface.encodeFunctionData('setFeeRecipient',['0x'+'00'.repeat(20)])); console.log('✗ BUG: zero recipient'); }
catch { console.log('zero recipient blocked: ✓'); }
console.log('totalFees tracked     :', ethers.formatEther((await call(fr.addr,fr.iface,'totalFeesCollected',[tokenIn.addr.toString()]))[0]));
