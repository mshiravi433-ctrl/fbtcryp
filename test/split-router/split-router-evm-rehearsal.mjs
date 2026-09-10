#!/usr/bin/env node
/**
 * FBT SPLIT ROUTER — Level-2 EVM rehearsal (local ganache, mock counterparties).
 * ---------------------------------------------------------------------------
 * Run: node test/split-router/split-router-evm-rehearsal.mjs
 *      (or npm run test:split-router, which compiles first)
 *
 * Deploys the REAL compiled FBTSplitRouter artifact — the same bytecode a
 * mainnet deploy would carry — against the mock world from
 * contracts/rehearsal/SplitRouterMocks.sol, on an in-process ganache chain.
 * The counterparties are harnesses (the sandbox has no chain egress for a
 * real fork, the same constraint that produced RehearsalWorld.sol); the
 * contract under test is production bytecode.
 *
 * What has to hold for this rehearsal to PASS — every one is an assertion:
 *
 *   · the fee split is exact: 30 bps on 1000 USDC → 0.30 to payout, 997.00
 *     to the protocol, credited to the DEPOSITOR, never to the router
 *   · the router ends every path with a zero balance (asset, comet, stETH,
 *     ETH) — the on-chain custody-free invariant
 *   · Aave receives onBehalfOf = the depositor and referralCode = 0
 *   · Compound's base balance lands on the depositor, not the router
 *   · Morpho is supplied the exact pinned market (params + keccak id)
 *   · Lido stETH is forwarded whole, and the ETH fee reaches the payout
 *   · the guards fire: fee above 1% cannot deploy, a wrong Morpho market id
 *     cannot deploy, zero amounts and missing approvals revert
 *
 * Mainnet-state proof (real Aave/Comet/Morpho/Lido, forked chain) lives in
 * split-router-fork-rehearsal.mjs — this file is the behaviour half, that one
 * is the integration half.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ganache from 'ganache';
import { Contract, ContractFactory, JsonRpcProvider, NonceManager, Wallet } from 'ethers';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ARTIFACT = JSON.parse(readFileSync(new URL('../../src/lib/splitRouterArtifact.json', import.meta.url), 'utf8'));
const MOCKS = JSON.parse(readFileSync(new URL('./splitRouterMocksArtifact.json', import.meta.url), 'utf8'));

if (!existsSync(new URL('./splitRouterMocksArtifact.json', import.meta.url))) {
  console.error('Run `node scripts/compile-split-router.mjs` first.');
  process.exit(1);
}

const rows = [];
const t = (name, ok, detail = '') => {
  rows.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
};

const FEE_BPS = 30n; // 0.30%
const BPS = 10_000n;
const ONE_M = 10n ** 6n; // USDC has 6 decimals
const AMOUNT = 1000n * ONE_M; // 1000 USDC
const FEE = (AMOUNT * FEE_BPS) / BPS; // 0.30 USDC = 300_000
const NET = AMOUNT - FEE; // 999.70 USDC

const server = ganache.server({
  logging: { quiet: true },
  /* Fixed local-only test keys (the canonical anvil #0/#1/#2). Explicit
   * accounts rather than provider signers, so the rehearsal is deterministic
   * and needs nothing from the ganache defaults. */
  accounts: [
    { secretKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', balance: '0x56BC75E2D63100000' },
    { secretKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', balance: '0x56BC75E2D63100000' },
    { secretKey: '0x8deee911d25d72d8ff0f79713f6a02c7559eab5c7f3b8691cfb4fe5e5631897d', balance: '0x56BC75E2D63100000' },
    /* the guard section's own signer: its deployments are EXPECTED to fail, and
     * a failed transaction leaves a NonceManager's counter out of sync with the
     * chain (the next send then hangs). A plain wallet with its own account
     * keeps the failures quarantined from the money-path flow. */
    { secretKey: '0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e4c581228d4b2c00ce3', balance: '0x56BC75E2D63100000' }
  ]
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;
const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`);
/* NonceManager on both acting wallets: ethers' default nonce fetch races
 * ganache's instant mining on back-to-back transactions, and a stale nonce
 * kills the run for a reason that has nothing to do with the contract. */
const [deployer, user, payout] = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x8deee911d25d72d8ff0f79713f6a02c7559eab5c7f3b8691cfb4fe5e5631897d'
].map((key) => new NonceManager(new Wallet(key, provider)));
/* NonceManager hides `.address` (undefined) — the raw wallets answer it. */
/* NonceManager like the others (a plain wallet's stale nonce prediction makes
 * back-to-back deploys collide). Its expected-to-FAIL deploys run LAST, after
 * which nothing is sent, so the failed-tx nonce stall cannot bite anyone. */
const guardWallet = new NonceManager(
  new Wallet('0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e4c581228d4b2c00ce3', provider)
);
const ADDR = {
  get deployer() { return '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; },
  get user() { return '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; },
  get payout() { return '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'; }
};

const deploy = async (artifactName, signer, args = []) => {
  const art = artifactName === 'FBTSplitRouter' ? ARTIFACT : MOCKS.contracts[artifactName];
  const factory = new ContractFactory(art.abi, art.bytecode, signer);
  const c = await factory.deploy(...args);
  /* wait for the mine: sequential deploys on one account otherwise race the
   * nonce manager and ganache rejects the next raw tx. */
  await c.deploymentTransaction().wait();
  return c;
};

/* ── the world ────────────────────────────────────────────────────────────── */
const usdc = await deploy('MockERC20', deployer, ['USD Coin', 'USDC', 6]);
const aave = await deploy('MockAavePool', deployer, [true]);
const comet = await deploy('MockComet', deployer);
const morpho = await deploy('MockMorpho', deployer);
const lido = await deploy('MockLido', deployer);

const marketParams = {
  loanToken: usdc.target,
  collateralToken: '0x0000000000000000000000000000000000000003',
  oracle: '0x0000000000000000000000000000000000000001',
  irm: '0x0000000000000000000000000000000000000002',
  lltv: 860000000000000000n
};
const marketId = await morpho.idOf(marketParams);

const router = await deploy('FBTSplitRouter', deployer, [[
  usdc.target, // asset
  aave.target, // aavePool
  comet.target, // comet
  morpho.target, // morpho
  marketParams.loanToken,
  marketParams.collateralToken,
  marketParams.oracle,
  marketParams.irm,
  marketParams.lltv,
  marketId, // the pin
  lido.target, // lido
  ADDR.payout, // feeRecipient
  FEE_BPS // feeBps
]]);


const usdcUser = usdc.connect(user);
const routerUser = router.connect(user);
await usdc.mint(ADDR.user, AMOUNT * 4n);

/* ── 0. deployment sanity ─────────────────────────────────────────────────── */
t('deploys with the pinned config', router.target != null && (await router.feeBps()) === FEE_BPS);
t('fee cap is compiled in: MAX_FEE_BPS = 100', (await router.MAX_FEE_BPS()) === 100n);
{
  const [qFee, qNet] = await router.quoteFee(AMOUNT);
  t('quoteFee(1000 USDC) = 0.30 / 999.70', qFee === FEE && qNet === NET, `${qFee} / ${qNet}`);
}

/* ── 1. Aave ──────────────────────────────────────────────────────────────── */
await usdcUser.approve(router.target, AMOUNT);
await routerUser.supplyAave(AMOUNT);
t('aave: depositor credited the net amount', (await aave.aTokenBalanceOf(ADDR.user)) === NET);
t('aave: payout received the fee', (await usdc.balanceOf(ADDR.payout)) === FEE);
t('aave: router holds zero USDC', (await usdc.balanceOf(router.target)) === 0n);
t('aave: onBehalfOf forced to depositor, referral 0',
  (await aave.lastOnBehalfOf()) === ADDR.user && (await aave.lastReferralCode()) === 0n);
const routed = await router.queryFilter(router.filters.Routed(), 0);
t('aave: Routed event carries the full money story',
  routed.length === 1
  && routed[0].args.target === aave.target && routed[0].args.user === ADDR.user
  && routed[0].args.amountIn === AMOUNT && routed[0].args.feeTaken === FEE && routed[0].args.netAmount === NET);

/* ── 2. Compound ──────────────────────────────────────────────────────────── */
await usdcUser.approve(router.target, AMOUNT);
await routerUser.supplyCompound(AMOUNT);
t('compound: base balance landed on the depositor', (await comet.balanceOf(ADDR.user)) === NET);
t('compound: router holds zero comet balance', (await comet.balanceOf(router.target)) === 0n);
t('compound: router holds zero USDC', (await usdc.balanceOf(router.target)) === 0n);
t('compound: fees accumulate for dashboards', (await router.totalFeesCollected()) === FEE * 2n);

/* ── 3. Morpho ────────────────────────────────────────────────────────────── */
await usdcUser.approve(router.target, AMOUNT);
await routerUser.supplyMorpho(AMOUNT);
t('morpho: position credited to the depositor', (await morpho.supplyAssetsOf(ADDR.user)) === NET);
{
  const mp = await morpho.lastMarketParams();
  t('morpho: supplied the exact pinned market',
    mp.loanToken === marketParams.loanToken && mp.collateralToken === marketParams.collateralToken
    && mp.oracle === marketParams.oracle && mp.irm === marketParams.irm && mp.lltv === marketParams.lltv);
  t('morpho: onBehalf is the depositor, no hooks', (await morpho.lastOnBehalf()) === ADDR.user && (await morpho.lastData()) === '0x');
}
t('morpho: router holds zero USDC', (await usdc.balanceOf(router.target)) === 0n);

/* ── 4. Lido (native ETH) ─────────────────────────────────────────────────── */
const payoutEthBefore = await provider.getBalance(ADDR.payout);
const stEthBefore = await lido.balanceOf(ADDR.user);
await routerUser.stakeLido({ value: 10n ** 18n });
const ethFee = (10n ** 18n * FEE_BPS) / BPS;
const ethNet = 10n ** 18n - ethFee;
t('lido: stETH minted to the depositor, minus the fee',
  (await lido.balanceOf(ADDR.user)) - stEthBefore === ethNet);
t('lido: ETH fee reached the payout address',
  (await provider.getBalance(ADDR.payout)) - payoutEthBefore === ethFee);
t('lido: router ends with zero ETH', (await provider.getBalance(router.target)) === 0n);
t('lido: router holds zero stETH', (await lido.balanceOf(router.target)) === 0n);

/* ── 5. the guards — via eth_call semantics, so the REASON is the assertion ──
 * A mined failed transaction proves nothing about WHY it failed; staticCall /
 * provider.call surface the revert string itself, so each guard asserts the
 * exact require() that fired. */
const expectRevert = async (label, regex, run) => {
  let reason = null;
  try {
    await run();
  } catch (e) {
    /* ganache buries the require() string in info.error.data.reason while
     * ethers surfaces a generic "missing revert data" — dig for the real one. */
    reason = String(
      e?.info?.error?.data?.reason
        ?? e?.info?.error?.message
        ?? e?.shortMessage
        ?? e?.message
        ?? e
    );
  }
  t(label, reason != null && regex.test(reason), reason ?? 'did not revert');
};

const routerFactory = new ContractFactory(ARTIFACT.abi, ARTIFACT.bytecode, guardWallet);
const BASE_CFG = [
  usdc.target, aave.target, comet.target, morpho.target,
  marketParams.loanToken, marketParams.collateralToken, marketParams.oracle, marketParams.irm, marketParams.lltv,
  marketId, lido.target, ADDR.payout, FEE_BPS
];
const cfgWith = (index, value) => BASE_CFG.map((v, i) => (i === index ? value : v));

/* Valid deployments FIRST (deterministic nonces), the expected-to-fail
 * deployments LAST: a reverted deploy leaves ganache's nonce accounting in
 * one of two states depending on where it failed, so nothing that matters
 * may follow a failing deploy from the same wallet. */
{
  /* the boundary itself is allowed: exactly 100 bps (1.00%) deploys, so the
   * ceiling is the cap and not one notch below it */
  const capped = await deploy('FBTSplitRouter', guardWallet, [cfgWith(12, 100n)]);
  t('guard: exactly 100 bps (the cap) deploys', (await capped.feeBps()) === 100n);
}
{
  /* a router deployed WITHOUT lido must refuse the Lido path */
  const noLido = await deploy('FBTSplitRouter', guardWallet, [cfgWith(10, '0x0000000000000000000000000000000000000000')]);
  if (process.env.SPLIT_ROUTER_DEBUG) {
    console.log('    [debug] main router:', router.target, '| lido():', await router.lido());
    console.log('    [debug] MockLido  :', lido.target);
    console.log('    [debug] noLido    :', noLido.target, '| lido():', await noLido.lido());
  }
  await expectRevert('guard: a chain without that protocol reverts with ZERO_TARGET', /ZERO_TARGET/, async () => {
    await noLido.connect(user).stakeLido.staticCall({ value: 1n });
  });
}
await expectRevert('guard: zero amount reverts', /ZERO_AMOUNT/, async () => {
  await routerUser.supplyAave.staticCall(0n);
});
await expectRevert('guard: missing approval reverts (pull-only, exact amount)', /TRANSFER_FROM_FAILED|MOCK_ERC20_ALLOWANCE/, async () => {
  /* the exact approvals above were each fully consumed by their supply */
  await routerUser.supplyAave.staticCall(AMOUNT);
});
await expectRevert('guard: a token path without an asset cannot deploy', /ZERO_ASSET/, async () => {
  await routerFactory.deploy(cfgWith(0, '0x0000000000000000000000000000000000000000'));
});
await expectRevert('guard: fee above 1% cannot deploy', /FEE_TOO_HIGH/, async () => {
  await routerFactory.deploy(cfgWith(12, 101n));
});
await expectRevert('guard: a wrong Morpho market id cannot deploy', /MORPHO_MARKET_ID_MISMATCH/, async () => {
  await routerFactory.deploy(cfgWith(9, '0x' + 'ab'.repeat(32)));
});
{
  /* plain ETH transfers must bounce: no receive() exists (eth_call of a bare
   * transfer to the router executes its fallback absence and reverts) */
  let bounced = false;
  try { await provider.call({ to: router.target, from: ADDR.user, value: 1n }); } catch { bounced = true; }
  t('guard: plain ETH transfers bounce (no receive)', bounced);
}

/* ── report ───────────────────────────────────────────────────────────────── */
const passed = rows.filter((r) => r.ok).length;
const report = {
  schema: 'fbt.split-router.rehearsal.v1',
  when: new Date().toISOString(),
  chain: 'local ganache (in-process EVM)',
  counterparties: 'mocks from contracts/rehearsal/SplitRouterMocks.sol — NOT the real protocols',
  contractUnderTest: 'the REAL compiled artifact src/lib/splitRouterArtifact.json (production bytecode)',
  feeBps: Number(FEE_BPS),
  passed,
  total: rows.length,
  rows
};
writeFileSync(new URL('./split-router-rehearsal-report.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`\n${passed === rows.length ? 'PASS' : 'FAIL'} ${passed}/${rows.length} split-router EVM rehearsal assertions`);
console.log('report: test/split-router/split-router-rehearsal-report.json');

/* ganache's NodeJS HTTP fallback does not always settle close()/destroy();
 * exit explicitly so the pass/fail code is what CI sees, not Node's
 * unfinished-top-level-await 13. */
server.close(() => {});
process.exit(rows.every((r) => r.ok) ? 0 : 1);
