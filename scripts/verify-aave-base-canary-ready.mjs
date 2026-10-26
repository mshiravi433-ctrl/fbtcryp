#!/usr/bin/env node
/**
 * Aave v3 Base (8453) — Zero-Cost Pre-Canary Readiness Verifier
 * ---------------------------------------------------------------------------
 * Verifies everything required BEFORE the owner authorizes and signs a live
 * Aave Base canary from their own wallet UI:
 *
 *   1. Secret hygiene guard: fails closed immediately if PRIVATE_KEY,
 *      MNEMONIC, SEED_PHRASE, or any 64-hex private-key-shaped value is
 *      present in environment variables.
 *   2. Default build posture: confirms an unconfigured env evaluates to
 *      `capital-off` (`enabledIds: []`).
 *   3. Single-source pin integrity: extracts Aave v3 Base addresses from
 *      `src/lib/defi/aaveV3Base.js` and `src/lib/chains.js` and verifies valid
 *      EIP-55 / 20-byte addresses + referralCode === 0 + SplitRouter OFF by
 *      default.
 *   4. Fork evidence anchor: checks `farm-fork-evidence/aave-base.json` is
 *      present, `PASS`, `assertionsPassed === totalAssertions`, with a valid
 *      sha256 digest.
 *   5. Stage-1 `limited-canary` rollout gate rehearsal: verifies
 *      `evaluateFarmRollout` accepts the Aave-Base-only canary profile and
 *      rejects accidental `*_PUBLIC=true` without `FARM_CANARY_CONFIRMED=true`.
 *   6. Optional `--rpc` read-only check (`BASE_RPC_URL` + `CANARY_WALLET`):
 *      queries Base mainnet via read-only `eth_call`s (PoolAddressesProvider,
 *      aBasUSDC underlying, reserve active/unpaused/unfrozen, wallet ETH gas &
 *      USDC balance) — zero transactions, zero signing, zero spend.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, formatEther, formatUnits, getAddress, isAddress } from 'ethers';
import { inspectFarmRollout, formatFarmRollout } from './farm-rollout-policy.mjs';

const ROOT = new URL('..', import.meta.url);
const readText = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const SECRET_ENV_NAMES = [
  'PRIVATE_KEY',
  'DEPLOYER_PRIVATE_KEY',
  'CANARY_PRIVATE_KEY',
  'WALLET_PRIVATE_KEY',
  'MNEMONIC',
  'SEED_PHRASE'
];
const HEX_PRIVKEY_RE = /^(?:0x)?[0-9a-fA-F]{64}$/;
const PLACEHOLDER_WALLET = '0x1111111111111111111111111111111111111111';
const MIN_GAS_WEI = 500_000_000_000_000n; // 0.0005 ETH on Base
const RECOMMENDED_USDC_UNITS = 5_000_000n; // 5 USDC (6 decimals)

export function runStaticCanaryPreflight(env = process.env) {
  const checks = [];
  const record = (name, ok, detail = '') => {
    checks.push({ name, ok: Boolean(ok), detail });
  };

  // 1. Secret hygiene guard — never allow private keys or mnemonics anywhere near canary config
  const leakedNames = SECRET_ENV_NAMES.filter((k) => String(env[k] ?? '').trim() !== '');
  const privKeyShapedVars = Object.entries(env)
    .filter(([k, v]) => /^(VITE_|FARM_|CANARY_)/.test(k) && HEX_PRIVKEY_RE.test(String(v ?? '').trim()))
    .map(([k]) => k);
  record(
    'secret hygiene: zero private keys / mnemonics in environment',
    leakedNames.length === 0 && privKeyShapedVars.length === 0,
    leakedNames.length || privKeyShapedVars.length
      ? `FORBIDDEN vars detected: ${[...leakedNames, ...privKeyShapedVars].join(', ')}`
      : 'clean'
  );

  // 2. Default repository build remains capital-off
  const defaultEval = inspectFarmRollout({});
  record(
    'default build posture is capital-off',
    defaultEval.ok && defaultEval.mode === 'capital-off' && defaultEval.enabled.length === 0,
    `mode=${defaultEval.mode}`
  );

  // 3. Single-source contract pins in src/lib/defi/aaveV3Base.js + src/lib/chains.js
  const adapterSrc = readText('src/lib/defi/aaveV3Base.js');
  const chainsSrc = readText('src/lib/chains.js');
  const poolMatch = adapterSrc.match(/pool:\s*'(0x[0-9a-fA-F]{40})'/);
  const providerMatch = adapterSrc.match(/addressesProvider:\s*'(0x[0-9a-fA-F]{40})'/);
  const aUsdcMatch = adapterSrc.match(/aUsdc:\s*'(0x[0-9a-fA-F]{40})'/);
  const referralZero = /referralCode:\s*0\b/.test(adapterSrc);
  const baseBlockMatch = chainsSrc.match(/8453:\s*\[([\s\S]*?)\n\s*\]/);
  const baseUsdcMatch = baseBlockMatch?.[1]?.match(/symbol:\s*'USDC'[\s\S]*?address:\s*'(0x[0-9a-fA-F]{40})'/);

  const pins = {
    chainId: 8453,
    pool: poolMatch?.[1] ?? null,
    addressesProvider: providerMatch?.[1] ?? null,
    aUsdc: aUsdcMatch?.[1] ?? null,
    usdc: baseUsdcMatch?.[1] ?? null
  };
  const pinsValid = Boolean(
    pins.pool && isAddress(pins.pool) && getAddress(pins.pool) === pins.pool
    && pins.addressesProvider && isAddress(pins.addressesProvider) && getAddress(pins.addressesProvider) === pins.addressesProvider
    && pins.aUsdc && isAddress(pins.aUsdc) && getAddress(pins.aUsdc) === pins.aUsdc
    && pins.usdc && isAddress(pins.usdc) && getAddress(pins.usdc) === pins.usdc
    && referralZero
  );
  record(
    'Aave v3 Base single-source EIP-55 pins verified',
    pinsValid,
    `pool=${pins.pool}, aBasUSDC=${pins.aUsdc}, usdc=${pins.usdc}`
  );

  // 4. SplitRouter stays dormant during Stage-1 Aave Base canary unless explicitly audited
  const splitRouterBase = String(env.VITE_FBT_SPLIT_ROUTER_BASE ?? '').trim();
  const artifact = JSON.parse(readText('src/lib/splitRouterArtifact.json'));
  record(
    'SplitRouter Base env stays OFF while audited === false',
    artifact.audited === true || splitRouterBase === '',
    splitRouterBase ? `VITE_FBT_SPLIT_ROUTER_BASE=${splitRouterBase} while audited=${artifact.audited}` : 'direct 0%-fee deposit path'
  );

  // 5. Fork evidence anchor check
  const evidence = JSON.parse(readText('farm-fork-evidence/aave-base.json'));
  const evidenceOk = (
    evidence.protocol === 'aave-base'
    && evidence.result === 'PASS'
    && Number.isInteger(evidence.assertionsPassed)
    && evidence.assertionsPassed > 0
    && evidence.assertionsPassed === evidence.totalAssertions
    && evidence.fingerprint?.algo === 'sha256'
    && /^[0-9a-f]{64}$/.test(String(evidence.fingerprint?.digest ?? ''))
  );
  record(
    'farm-fork-evidence/aave-base.json PASS anchor intact',
    evidenceOk,
    `${evidence.assertionsPassed}/${evidence.totalAssertions} sha256=${String(evidence.fingerprint?.digest ?? '').slice(0, 12)}…`
  );

  // 6. Stage-1 limited-canary gate rehearsal
  const rawWallet = String(env.CANARY_WALLET ?? env.VITE_AAVE_BASE_SUPPLY_ALLOWLIST ?? '').trim();
  const hasRealCanaryWallet = Boolean(
    rawWallet
    && rawWallet !== '0xREPLACE_WITH_OWNER_PUBLIC_CANARY_WALLET'
    && isAddress(rawWallet)
  );
  const walletForGate = hasRealCanaryWallet ? rawWallet : PLACEHOLDER_WALLET;

  const canaryEnv = {
    FARM_ROLLOUT_PROTOCOLS: 'aave-base',
    FARM_STRICT_FORK_EVIDENCE: 'true',
    FARM_CANARY_CONFIRMED: 'false',
    VITE_ENABLE_AAVE_BASE_SUPPLY: 'true',
    VITE_AAVE_BASE_SUPPLY_ALLOWLIST: walletForGate,
    VITE_AAVE_BASE_SUPPLY_PUBLIC: 'false',
    VITE_ENABLE_COMPOUND_BASE_SUPPLY: 'false',
    VITE_ENABLE_AAVE_ARBITRUM_SUPPLY: 'false',
    VITE_ENABLE_LIDO_STAKE: 'false',
    VITE_ENABLE_MORPHO_BASE_SUPPLY: 'false'
  };
  const canaryEval = inspectFarmRollout(canaryEnv);
  const gateOk = (
    canaryEval.ok
    && canaryEval.mode === 'limited-canary'
    && canaryEval.enabled.length === 1
    && canaryEval.enabled[0] === 'aave-base'
    && canaryEval.public.length === 0
    && canaryEval.protocols['aave-base']?.perTxCap === undefined
    && canaryEval.protocols['aave-base']?.totalCap === undefined
  );
  record(
    'Stage-1 Aave-Base-only limited-canary gate simulation',
    gateOk,
    gateOk ? formatFarmRollout(canaryEval) : canaryEval.errors.join('; ')
  );

  const accidentalPublicEval = inspectFarmRollout({
    ...canaryEnv,
    VITE_AAVE_BASE_SUPPLY_PUBLIC: 'true'
  });
  record(
    'fail-closed guard blocks *_PUBLIC=true before FARM_CANARY_CONFIRMED',
    accidentalPublicEval.ok === false,
    accidentalPublicEval.errors[0] ?? 'unexpectedly passed'
  );

  return {
    ok: checks.every((c) => c.ok),
    hasRealCanaryWallet,
    canaryWallet: hasRealCanaryWallet ? getAddress(rawWallet) : null,
    pins,
    checks
  };
}

async function runReadOnlyRpcChecks(rpcUrl, pins, canaryWallet) {
  const checks = [];
  const record = (name, ok, detail = '') => {
    checks.push({ name, ok: Boolean(ok), detail });
  };
  const provider = new JsonRpcProvider(rpcUrl, 8453, { staticNetwork: true });
  try {
    const net = await provider.getNetwork();
    record('Base RPC chainId === 8453', Number(net.chainId) === 8453, `chainId=${net.chainId}`);

    const addrProvider = new Contract(
      pins.addressesProvider,
      ['function getPool() view returns (address)'],
      provider
    );
    const livePool = await addrProvider.getPool();
    record(
      'on-chain PoolAddressesProvider.getPool() matches pin',
      livePool.toLowerCase() === pins.pool.toLowerCase(),
      livePool
    );

    const aToken = new Contract(
      pins.aUsdc,
      ['function UNDERLYING_ASSET_ADDRESS() view returns (address)', 'function POOL() view returns (address)'],
      provider
    );
    const [underlying, aTokenPool] = await Promise.all([
      aToken.UNDERLYING_ASSET_ADDRESS(),
      aToken.POOL()
    ]);
    record(
      'on-chain aBasUSDC underlying + pool match pins',
      underlying.toLowerCase() === pins.usdc.toLowerCase() && aTokenPool.toLowerCase() === pins.pool.toLowerCase(),
      `underlying=${underlying}`
    );

    const pool = new Contract(
      pins.pool,
      ['function getConfiguration(address asset) view returns (uint256)'],
      provider
    );
    const bitmap = BigInt(await pool.getConfiguration(pins.usdc));
    const isActive = ((bitmap >> 56n) & 1n) === 1n;
    const isFrozen = ((bitmap >> 57n) & 1n) === 1n;
    const isPaused = ((bitmap >> 60n) & 1n) === 1n;
    record(
      'on-chain Aave Base USDC reserve is active, unfrozen, unpaused',
      isActive && !isFrozen && !isPaused,
      `active=${isActive}, frozen=${isFrozen}, paused=${isPaused}`
    );

    if (canaryWallet) {
      const usdc = new Contract(
        pins.usdc,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      );
      const [ethBal, usdcBal] = await Promise.all([
        provider.getBalance(canaryWallet),
        usdc.balanceOf(canaryWallet)
      ]);
      record(
        'canary wallet has >= 0.0005 ETH gas on Base',
        ethBal >= MIN_GAS_WEI,
        `${formatEther(ethBal)} ETH`
      );
      record(
        'canary wallet has >= 5 USDC recommended canary balance on Base',
        usdcBal >= RECOMMENDED_USDC_UNITS,
        `${formatUnits(usdcBal, 6)} USDC`
      );
    }
  } finally {
    provider.destroy();
  }
  return checks;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const wantRpc = process.argv.includes('--rpc');
  const res = runStaticCanaryPreflight(process.env);
  for (const c of res.checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  }

  let rpcOk = true;
  if (wantRpc) {
    const rpcUrl = String(process.env.BASE_RPC_URL ?? '').trim();
    if (!rpcUrl) {
      console.error('✗ --rpc requires explicit BASE_RPC_URL');
      process.exit(1);
    }
    try {
      const rpcChecks = await runReadOnlyRpcChecks(rpcUrl, res.pins, res.canaryWallet);
      for (const c of rpcChecks) {
        console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
        if (!c.ok) rpcOk = false;
      }
    } catch (err) {
      console.error(`✗ read-only Base RPC check failed — ${err?.shortMessage ?? err?.message ?? err}`);
      rpcOk = false;
    }
  }

  if (!res.ok || !rpcOk) {
    process.exit(1);
  }

  console.log('\n────────────────────────────────────────────────────────────────────────');
  if (res.hasRealCanaryWallet) {
    console.log(`AAVE BASE CANARY PREFLIGHT: READY (wallet=${res.canaryWallet})`);
    console.log('Remaining step: explicit owner permission to build & sign 5 USDC supply + full withdraw in wallet UI.');
  } else {
    console.log('AAVE BASE CANARY PREFLIGHT: CODE & CONFIG READY');
    console.log('Remaining items (ONLY): 1) Owner permission  2) CANARY_WALLET (0x… public address)');
  }
  console.log('Live status right now: capital-off (zero mainnet transactions sent).');
  console.log('────────────────────────────────────────────────────────────────────────');
}
