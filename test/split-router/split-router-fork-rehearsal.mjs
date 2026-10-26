#!/usr/bin/env node
/**
 * FBT SPLIT ROUTER — MAINNET FORK REHEARSAL (anvil, all 3 target chains).
 * ---------------------------------------------------------------------------
 *   node test/split-router/split-router-fork-rehearsal.mjs            (skips cleanly with no anvil)
 *   BASE_RPC_URL=… ARBITRUM_RPC_URL=… ETH_RPC_URL=… \
 *     node test/split-router/split-router-fork-rehearsal.mjs --strict (fails closed instead of skipping)
 *
 * The local-EVM rehearsal (split-router-evm-rehearsal.mjs) proves the router's
 * BEHAVIOUR against mock counterparties across all three per-chain deploy
 * shapes. This probe is the mainnet-integration half right before external
 * audit: the SAME compiled artifact (src/lib/splitRouterArtifact.json),
 * deployed to local Anvil forks of ALL THREE target mainnet chains:
 *
 *   1. Base (8453)         — REAL Aave v3 Pool + REAL Compound III Comet + REAL Morpho Blue cbBTC/USDC
 *   2. Arbitrum One (42161)— REAL Aave v3 Pool (native USDC / USDCn reserve)
 *   3. Ethereum (1)        — REAL Lido stETH staking contract
 *
 * What must hold on every forked chain and protocol:
 *   · on-chain address-provider / reserve pins match the app adapters before deploy
 *   · the deposit lands ON THE DEPOSITOR (aTokens / Comet base / Morpho
 *     shares / stETH belong to the user, never to the router)
 *   · the fee lands on the payout wallet, exactly feeBps of the input
 *   · the router's own balances are ZERO after every call (asset, Comet base,
 *     stETH, ETH) — the on-chain custody-free invariant
 *   · absent-on-chain protocol entry points revert with ZERO_TARGET, and zero
 *     amounts revert with ZERO_AMOUNT
 *
 * REQUIREMENTS: `anvil` on PATH (Arbitrum Nitro fork requires a Foundry build
 * containing PR #16514, e.g. foundry-toolchain nightly; override via
 * ANVIL_ARB_BIN if separate from ANVIL_BIN) and explicit BASE_RPC_URL,
 * ARBITRUM_RPC_URL, and ETH_RPC_URL in --strict mode.
 */
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { Wallet, JsonRpcProvider, Contract, ContractFactory, Interface, formatEther, formatUnits } from 'ethers';

const ARTIFACT = JSON.parse(readFileSync(new URL('../../src/lib/splitRouterArtifact.json', import.meta.url), 'utf8'));
const STRICT = process.argv.includes('--strict');
const EXPLICIT_BASE_RPC = String(process.env.BASE_RPC_URL ?? '').trim();
const EXPLICIT_ARB_RPC = String(process.env.ARBITRUM_RPC_URL ?? '').trim();
const EXPLICIT_ETH_RPC = String(process.env.ETH_RPC_URL ?? '').trim();

const BASE_RPC = EXPLICIT_BASE_RPC || 'https://mainnet.base.org';
const ARB_RPC = EXPLICIT_ARB_RPC || 'https://arb1.arbitrum.io/rpc';
const ETH_RPC = EXPLICIT_ETH_RPC || 'https://ethereum-rpc.publicnode.com';

const ANVIL_BIN = String(process.env.ANVIL_BIN ?? '').trim() || 'anvil';
const ANVIL_ARB_BIN = String(process.env.ANVIL_ARB_BIN ?? '').trim() || ANVIL_BIN;

/* Pinned per-chain configuration — mirrors src/lib/defi/{aaveV3Base,
 * aaveV3Arbitrum, compoundV3Base, morphoBlueBase, lido}.js and
 * docs/defi/SPLIT-ROUTER-FA.md one-for-one. */
const BASE = {
  chainId: 8453,
  usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  aaveAddressesProvider: '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D',
  aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  aUsdc: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB',
  comet: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
  morpho: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
  marketId: '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836',
  morphoCollateralToken: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', // cbBTC
  morphoOracle: '0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9',
  morphoIrm: '0x46415998764C29aB2a25CbeA6254146D50D22687',
  morphoLltv: 860000000000000000n
};

const ARBITRUM = {
  chainId: 42161,
  usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Circle-native USDC (USDCn), NOT bridged USDC.e
  aaveAddressesProvider: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
  aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  aUsdc: '0x724dc807b04555b71ed48a6896b6F41593b8C637'
};

const ETHEREUM = {
  chainId: 1,
  lido: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
};

const FEE_BPS = 30n;
const AMOUNT = 5_000_000n; // 5 USDC, the reviewed canary denomination
const ZERO = '0x0000000000000000000000000000000000000000';
const ZERO_B32 = '0x' + '00'.repeat(32);
const DEPOSITOR_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const PAYOUT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)'];
const AAVE_PROVIDER_ABI = ['function getPool() view returns (address)'];
const AUSDC_ABI = ['function balanceOf(address) view returns (uint256)', 'function UNDERLYING_ASSET_ADDRESS() view returns (address)'];
const COMET_ABI = ['function balanceOf(address) view returns (uint256)'];
const MORPHO_ABI = [
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function supply((address loanToken,address collateralToken,address oracle,address irm,uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256 assetsSupplied, uint256 sharesSupplied)'
];

const rows = [];
let exitCode = 0;
const t = (name, ok, detail = '') => {
  rows.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) exitCode = 1;
};
const rule = (title) => console.log(`\n${'─'.repeat(78)}\n${title}\n${'─'.repeat(78)}`);

function haveAnvil(bin = ANVIL_BIN) {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

async function startAnvil(rpcUrl, port, chainId, bin = ANVIL_BIN) {
  const proc = spawn(
    bin,
    ['--fork-url', rpcUrl, '--chain-id', String(chainId), '--port', String(port), '--silent'],
    { stdio: 'ignore' }
  );
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 90; i += 1) {
    try {
      await rpc(url, 'eth_blockNumber', []);
      return { proc, url };
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  proc.kill('SIGTERM');
  throw new Error(`${bin} did not come up on ${url} (chainId=${chainId})`);
}

/** Move `amount` of `token` from `whale` to `to` on the fork. */
async function forkTransfer(url, whale, token, to, amount) {
  const erc20 = new Interface(ERC20_ABI);
  const data = erc20.encodeFunctionData('transfer', [to, amount]);
  await rpc(url, 'anvil_impersonateAccount', [whale]);
  await rpc(url, 'eth_sendTransaction', [{ from: whale, to: token, data, gas: '0x30d40' }]);
  await rpc(url, 'anvil_stopImpersonatingAccount', [whale]);
}

const expectRevert = async (label, regex, run) => {
  let reason = null;
  try { await run(); } catch (e) { reason = String(e?.info?.error?.message ?? e?.shortMessage ?? e?.message ?? e); }
  t(label, reason != null && regex.test(reason), reason ?? 'did not revert');
};

async function runBase() {
  rule('FBT SplitRouter · Base (8453) · Aave v3 + Compound III + Morpho Blue');
  const { proc, url } = await startAnvil(BASE_RPC, 8551, BASE.chainId, ANVIL_BIN);
  try {
    const provider = new JsonRpcProvider(url);
    const depositor = new Wallet(DEPOSITOR_KEY, provider);

    const addrProvider = new Contract(BASE.aaveAddressesProvider, AAVE_PROVIDER_ABI, provider);
    t('base pin: PoolAddressesProvider.getPool() matches pinned Aave Pool',
      (await addrProvider.getPool()).toLowerCase() === BASE.aavePool.toLowerCase());

    /* fund the depositor with real USDC from the aUSDC contract — it holds
     * the whole reserve, and on a fork moving forked balances is free. */
    await forkTransfer(url, BASE.aUsdc, BASE.usdc, depositor.address, AMOUNT * 4n);

    const factory = new ContractFactory(ARTIFACT.abi, ARTIFACT.bytecode, depositor);
    const router = await factory.deploy([[
      BASE.usdc, BASE.aavePool, BASE.comet, BASE.morpho,
      BASE.usdc, BASE.morphoCollateralToken, BASE.morphoOracle, BASE.morphoIrm, BASE.morphoLltv,
      BASE.marketId, ZERO, PAYOUT, FEE_BPS
    ]]);
    await router.deploymentTransaction().wait();
    t('base: deploys on fork with pinned config',
      (await router.feeBps()) === FEE_BPS && (await router.asset()) === BASE.usdc);
    t('base: morphoMarketId matches adapter pin', (await router.morphoMarketId()) === BASE.marketId);

    const [fee, net] = await router.quoteFee(AMOUNT);
    t('base: quoteFee(5 USDC) at 30 bps', fee === (AMOUNT * FEE_BPS) / 10_000n, `${formatUnits(fee, 6)} / ${formatUnits(net, 6)} USDC`);

    const usdc = new Contract(BASE.usdc, ERC20_ABI, depositor);
    const aUsdc = new Contract(BASE.aUsdc, AUSDC_ABI, provider);
    const comet = new Contract(BASE.comet, COMET_ABI, provider);
    const morpho = new Contract(BASE.morpho, MORPHO_ABI, provider);

    /* ── Aave ────────────────────────────────────────────────────────────── */
    const aBefore = await aUsdc.balanceOf(depositor.address);
    const payBefore = await usdc.balanceOf(PAYOUT);
    await (await usdc.approve(router.target, AMOUNT)).wait();
    await (await router.supplyAave(AMOUNT)).wait();
    const aDelta = (await aUsdc.balanceOf(depositor.address)) - aBefore;
    t('base aave: depositor aUSDC increased by net amount',
      aDelta >= (net * 999n) / 1000n && aDelta <= (net * 1001n) / 1000n, `Δ=${formatUnits(aDelta, 6)} aUSDC`);
    t('base aave: payout received exact fee', (await usdc.balanceOf(PAYOUT)) - payBefore === fee);
    t('base aave: router holds zero USDC', (await usdc.balanceOf(router.target)) === 0n);
    const routed = await router.queryFilter(router.filters.Routed(), 0);
    t('base aave: Routed event recorded',
      routed.length === 1 && routed[0].args.user === depositor.address && routed[0].args.feeTaken === fee);

    /* ── Compound ────────────────────────────────────────────────────────── */
    const cBefore = await comet.balanceOf(depositor.address);
    await (await usdc.approve(router.target, AMOUNT)).wait();
    await (await router.supplyCompound(AMOUNT)).wait();
    const cDelta = (await comet.balanceOf(depositor.address)) - cBefore;
    t('base compound: depositor Comet base increased by net amount',
      cDelta >= (net * 999n) / 1000n && cDelta <= (net * 1001n) / 1000n, `Δ=${formatUnits(cDelta, 6)}`);
    t('base compound: router holds zero Comet base', (await comet.balanceOf(router.target)) === 0n);
    t('base compound: router holds zero USDC', (await usdc.balanceOf(router.target)) === 0n);

    /* ── Morpho ──────────────────────────────────────────────────────────── */
    const posBefore = (await morpho.position(BASE.marketId, depositor.address)).supplyShares;
    await (await usdc.approve(router.target, AMOUNT)).wait();
    await (await router.supplyMorpho(AMOUNT)).wait();
    const posAfter = (await morpho.position(BASE.marketId, depositor.address)).supplyShares;
    t('base morpho: depositor supply shares increased on pinned market', posAfter > posBefore,
      `shares ${posBefore} → ${posAfter}`);
    t('base morpho: router holds zero USDC', (await usdc.balanceOf(router.target)) === 0n);

    /* ── Base guards ─────────────────────────────────────────────────────── */
    await expectRevert('base guard: zero amount reverts (real pool)', /ZERO_AMOUNT/,
      () => router.supplyAave.staticCall(0n));
    await expectRevert('base guard: stakeLido reverts with ZERO_TARGET', /ZERO_TARGET/,
      () => router.stakeLido.staticCall({ value: 1n }));

    await provider.destroy();
  } finally {
    proc.kill('SIGTERM');
  }
}

async function runArbitrum() {
  rule('FBT SplitRouter · Arbitrum One (42161) · Aave v3 (native USDC)');
  const { proc, url } = await startAnvil(ARB_RPC, 8552, ARBITRUM.chainId, ANVIL_ARB_BIN);
  try {
    const provider = new JsonRpcProvider(url);
    const depositor = new Wallet(DEPOSITOR_KEY, provider);

    const addrProvider = new Contract(ARBITRUM.aaveAddressesProvider, AAVE_PROVIDER_ABI, provider);
    const aUsdc = new Contract(ARBITRUM.aUsdc, AUSDC_ABI, provider);
    t('arbitrum pin: PoolAddressesProvider.getPool() matches pinned Aave Pool',
      (await addrProvider.getPool()).toLowerCase() === ARBITRUM.aavePool.toLowerCase());
    t('arbitrum pin: aArbUSDCn underlying matches native USDC (not USDC.e)',
      (await aUsdc.UNDERLYING_ASSET_ADDRESS()).toLowerCase() === ARBITRUM.usdc.toLowerCase());

    await forkTransfer(url, ARBITRUM.aUsdc, ARBITRUM.usdc, depositor.address, AMOUNT * 2n);

    const factory = new ContractFactory(ARTIFACT.abi, ARTIFACT.bytecode, depositor);
    const router = await factory.deploy([[
      ARBITRUM.usdc, ARBITRUM.aavePool, ZERO, ZERO,
      ZERO, ZERO, ZERO, ZERO, 0n, ZERO_B32,
      ZERO, PAYOUT, FEE_BPS
    ]]);
    await router.deploymentTransaction().wait();
    t('arbitrum: deploys on fork (Aave-only, Comet/Morpho/Lido zero)',
      (await router.feeBps()) === FEE_BPS
      && (await router.asset()) === ARBITRUM.usdc
      && (await router.aavePool()) === ARBITRUM.aavePool
      && (await router.comet()) === ZERO
      && (await router.morpho()) === ZERO
      && (await router.lido()) === ZERO);

    const [fee, net] = await router.quoteFee(AMOUNT);
    const usdc = new Contract(ARBITRUM.usdc, ERC20_ABI, depositor);
    const aBefore = await aUsdc.balanceOf(depositor.address);
    const payBefore = await usdc.balanceOf(PAYOUT);

    await (await usdc.approve(router.target, AMOUNT)).wait();
    await (await router.supplyAave(AMOUNT)).wait();

    const aDelta = (await aUsdc.balanceOf(depositor.address)) - aBefore;
    t('arbitrum aave: depositor aArbUSDCn increased by net amount',
      aDelta >= (net * 999n) / 1000n && aDelta <= (net * 1001n) / 1000n,
      `Δ=${formatUnits(aDelta, 6)} aArbUSDCn`);
    t('arbitrum aave: payout received exact fee', (await usdc.balanceOf(PAYOUT)) - payBefore === fee);
    t('arbitrum aave: router holds zero USDC', (await usdc.balanceOf(router.target)) === 0n);
    const routed = await router.queryFilter(router.filters.Routed(), 0);
    t('arbitrum aave: Routed event recorded',
      routed.length === 1 && routed[0].args.user === depositor.address && routed[0].args.feeTaken === fee);

    await expectRevert('arbitrum guard: zero amount reverts', /ZERO_AMOUNT/,
      () => router.supplyAave.staticCall(0n));
    await expectRevert('arbitrum guard: supplyCompound reverts with ZERO_TARGET', /ZERO_TARGET/,
      () => router.supplyCompound.staticCall(AMOUNT));
    await expectRevert('arbitrum guard: supplyMorpho reverts with ZERO_TARGET', /ZERO_TARGET/,
      () => router.supplyMorpho.staticCall(AMOUNT));
    await expectRevert('arbitrum guard: stakeLido reverts with ZERO_TARGET', /ZERO_TARGET/,
      () => router.stakeLido.staticCall({ value: 1n }));

    await provider.destroy();
  } finally {
    proc.kill('SIGTERM');
  }
}

async function runEthereum() {
  rule('FBT SplitRouter · Ethereum (1) · Lido');
  const { proc, url } = await startAnvil(ETH_RPC, 8553, ETHEREUM.chainId, ANVIL_BIN);
  try {
    const provider = new JsonRpcProvider(url);
    const depositor = new Wallet(DEPOSITOR_KEY, provider);

    const factory = new ContractFactory(ARTIFACT.abi, ARTIFACT.bytecode, depositor);
    const router = await factory.deploy([[
      ZERO, ZERO, ZERO, ZERO, // no token path on this deployment
      ZERO, ZERO, ZERO, ZERO, 0n, ZERO_B32,
      ETHEREUM.lido, PAYOUT, FEE_BPS
    ]]);
    await router.deploymentTransaction().wait();
    t('ethereum: deploys on fork (Lido-only, no token pinned)',
      (await router.lido()) === ETHEREUM.lido && (await router.feeBps()) === FEE_BPS);

    const lido = new Contract(ETHEREUM.lido, ['function balanceOf(address) view returns (uint256)'], provider);
    const [fee, net] = await router.quoteFee(10n ** 18n);
    const stBefore = await lido.balanceOf(depositor.address);
    const payBefore = await provider.getBalance(PAYOUT);
    await (await router.stakeLido({ value: 10n ** 18n })).wait();
    const stDelta = (await lido.balanceOf(depositor.address)) - stBefore;
    t('ethereum lido: depositor stETH increased by net amount',
      stDelta >= (net * 999n) / 1000n && stDelta <= (net * 1001n) / 1000n,
      `Δ=${formatEther(stDelta)} stETH`);
    t('ethereum lido: payout received exact ETH fee', (await provider.getBalance(PAYOUT)) - payBefore === fee,
      `${formatEther(fee)} ETH`);
    t('ethereum lido: router ends with zero ETH', (await provider.getBalance(router.target)) === 0n);
    t('ethereum lido: router holds zero stETH', (await lido.balanceOf(router.target)) === 0n);

    await expectRevert('ethereum guard: zero-value stake reverts (real Lido)', /ZERO_AMOUNT/,
      () => router.stakeLido.staticCall({ value: 0n }));
    await expectRevert('ethereum guard: supplyAave reverts with ZERO_TARGET', /ZERO_TARGET/,
      () => router.supplyAave.staticCall(AMOUNT));
    await expectRevert('ethereum guard: supplyCompound reverts with ZERO_TARGET', /ZERO_TARGET/,
      () => router.supplyCompound.staticCall(AMOUNT));
    await expectRevert('ethereum guard: supplyMorpho reverts with ZERO_TARGET', /ZERO_TARGET/,
      () => router.supplyMorpho.staticCall(AMOUNT));

    await provider.destroy();
  } finally {
    proc.kill('SIGTERM');
  }
}

/* ── entry ───────────────────────────────────────────────────────────────── */
if (STRICT) {
  const missing = [];
  if (!EXPLICIT_BASE_RPC) missing.push('BASE_RPC_URL');
  if (!EXPLICIT_ARB_RPC) missing.push('ARBITRUM_RPC_URL');
  if (!EXPLICIT_ETH_RPC) missing.push('ETH_RPC_URL');
  if (missing.length > 0) {
    t('explicit RPC URLs provided (--strict)', false, `missing ${missing.join(', ')}`);
    console.error(`\n❌ --strict requires explicit BASE_RPC_URL, ARBITRUM_RPC_URL, and ETH_RPC_URL.`);
    process.exit(1);
  }
}

if (!haveAnvil(ANVIL_BIN) || !haveAnvil(ANVIL_ARB_BIN)) {
  console.log(`\n⏭  SKIPPED — 'anvil' is not on PATH.

    This rehearsal is the 3-chain mainnet-state half of the SplitRouter evidence
    (behaviour half: split-router-evm-rehearsal.mjs, which runs everywhere).
    Exact commands:

      curl -L https://foundry.paradigm.xyz | bash && foundryup --install nightly
      BASE_RPC_URL=${BASE_RPC} ARBITRUM_RPC_URL=${ARB_RPC} ETH_RPC_URL=${ETH_RPC} \\
        node test/split-router/split-router-fork-rehearsal.mjs --strict
`);
  if (STRICT) {
    t('anvil available (--strict)', false, 'not found on PATH');
    process.exit(1);
  }
  process.exit(0);
}

try {
  await runBase();
  await runArbitrum();
  await runEthereum();
} catch (err) {
  t('fork rehearsal completed', false, String(err?.message ?? err));
}

const passed = rows.filter((r) => r.ok).length;
writeFileSync(
  new URL('./split-router-fork-rehearsal-report.json', import.meta.url),
  JSON.stringify({
    schema: 'fbt.split-router.fork-rehearsal.v1',
    when: new Date().toISOString(),
    chains: { base: BASE_RPC, arbitrum: ARB_RPC, ethereum: ETH_RPC },
    contractUnderTest: 'src/lib/splitRouterArtifact.json (production bytecode, REAL Aave/Comet/Morpho/Lido on Base + Arbitrum + Ethereum forks)',
    passed,
    total: rows.length,
    rows
  }, null, 2) + '\n'
);
console.log(`\n${passed === rows.length ? 'PASS' : 'FAIL'} ${passed}/${rows.length} split-router fork rehearsal assertions`);
console.log('report: test/split-router/split-router-fork-rehearsal-report.json');
process.exit(exitCode);
