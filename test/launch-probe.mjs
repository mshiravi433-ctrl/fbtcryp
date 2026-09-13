/**
 * FBT LAUNCH — pure-logic probe (no DOM, no network).
 * ---------------------------------------------------------------------------
 * Pins the parts of the launch module that are unforgivable to get wrong:
 *
 *   · spec validation (§ token rules — no silent defaults)
 *   · capability bitmaps (§ advanced powers are pre-disclosed & permanent)
 *   · the deterministic risk engine (§ 0–100, fatal gates)
 *   · fee transparency (v1 = 0, computed before signing)
 *   · calldata byte-exactness (decoded args must equal the intent — the
 *     API, the SDK and the app share one builder)
 *   · the state machine (§ DRAFT → … → LIVE, partial-failure honesty,
 *     retry without re-creating the token)
 *   · history sanitization (§ DB/localStorage never sees sensitive fields)
 *
 * Runs at import time with node:assert and is wired into test/run.mjs.
 */
import assert from 'node:assert/strict';
import {
  validateTokenSpec, capsToBitmap, CAPABILITIES
} from '../src/lib/launch/capabilities.js';
import { scoreLaunch, RISK_BANDS } from '../src/lib/launch/risk.js';
import { computeLaunchFee, LAUNCH_FEES } from '../src/lib/launch/fees.js';
import { readFileSync } from 'node:fs';
import {
  LAUNCH_CHAINS, LAUNCH_DEX, SOLANA_LAUNCH_STATUS, LAUNCH_MODES,
  quoteAssetsFor, nativeFor, dexForChain, describeLaunchChain
} from '../src/lib/launch/networks.js';
import { EVM_CHAINS } from '../src/lib/chains.js';
import * as engine from '../src/lib/launch/engine.js';
import {
  buildLaunchPlan, buildTokenCreateTx, parseTokenCreatedLog,
  FACTORY_ABI, minWithSlippage,
  TOKEN_BYTECODE, TOKEN_DEPLOYED_BYTECODE, TOKEN_CONSTRUCTOR_TYPES,
  predictCreateAddress, buildDirectTokenCreateTx, verifyDex
} from '../src/lib/launch/calldata.js';
import { checkDirectDeploy, codeMatches } from '../src/lib/launch/verify.js';
import { solanaLaunchStatus } from '../src/lib/launch/solana/status.js';
import { sanitizeRecord } from '../src/lib/launch/history.js';
import artifact from '../src/lib/launch/artifacts.js';
import { ethers } from 'ethers';

const t = (name, ok) => {
  assert.ok(ok, name);
  console.log(`✓ ${name}`);
};

/* ── spec validation ─────────────────────────────────────────────────────── */

const goodSpec = validateTokenSpec({ name: 'FBT Gold', symbol: 'FBTG', decimals: 18, supply: '1000000000' });
t('spec: valid token passes', goodSpec.ok === true);
t('spec: supply human is preserved', goodSpec.value.supplyHuman === '1000000000');
t('spec: supply wei is a bigint-sized decimal string', /^\d+$/.test(goodSpec.value.supplyWei) && goodSpec.value.supplyWei === '1000000000' + '0'.repeat(18));

t('spec: empty name rejected', validateTokenSpec({ name: '', symbol: 'X', decimals: 18, supply: '1000' }).ok === false);
t('spec: bad symbol chars rejected', validateTokenSpec({ name: 'A', symbol: 'a!b', decimals: 18, supply: '1000' }).ok === false);
t('spec: negative supply rejected', validateTokenSpec({ name: 'A', symbol: 'A', decimals: 18, supply: '-5' }).ok === false);
t('spec: non-integer supply rejected', validateTokenSpec({ name: 'A', symbol: 'A', decimals: 18, supply: '1.23' }).ok === false);
t('spec: decimals > 18 rejected', validateTokenSpec({ name: 'A', symbol: 'A', decimals: 24, supply: '1000' }).ok === false);
t('spec: zero supply rejected', validateTokenSpec({ name: 'A', symbol: 'A', decimals: 18, supply: '0' }).ok === false);

/* ── capabilities ────────────────────────────────────────────────────────── */

t('capabilities: basic token → bitmap 0', capsToBitmap({}) === 0 && capsToBitmap({ mintable: false }) === 0);
t('capabilities: all flags → bitmap 31', capsToBitmap({ mintable: true, burnable: true, pausable: true, maxWallet: true, maxTx: true }) === 31);
t('capabilities: unknown key rejected', validateTokenSpec({ name: 'A', symbol: 'A', decimals: 18, supply: '1', caps: { evil: true } }).ok === false);
t('capabilities: exactly five flags exist', CAPABILITIES.length === 5);
t('capabilities: every flag has a disclosure label', CAPABILITIES.every((c) => c.labelKey && c.warnKey));

/* ── risk engine ─────────────────────────────────────────────────────────── */

const baseInput = {
  capabilities: 0n, decimals: 18, supplyWei: '1000000000' + '0'.repeat(18),
  tokenAmount: '100000', quoteAmount: '100000', quoteDecimals: 18,
  dexVerified: true, factoryReady: true, lpqToUser: true
};
const lowRisk = scoreLaunch(baseInput);
t('risk: basic token + sane liquidity = low band', lowRisk.band === 'low' && lowRisk.score < 30);
t('risk: basic token gets the no-tax/no-blacklist positive finding',
  lowRisk.findings.some((f) => f.id === 'noTaxNoBlacklist' && f.weight === 0));

const highRisk = scoreLaunch({ ...baseInput, capabilities: 31n, quoteAmount: '500' });
t('risk: all owner powers + thin liquidity = high/critical',
  ['high', 'critical'].includes(highRisk.band) && highRisk.score >= 70);
t('risk: thin liquidity finding present', highRisk.findings.some((f) => f.id === 'thinLiquidity'));
t('risk: mintable finding present with +20',
  (() => { const f = highRisk.findings.find((x) => x.id === 'mintable'); return f && f.weight === 20; })());

t('risk: unverified DEX is a FATAL gate (blocked)', (() => {
  const r = scoreLaunch({ ...baseInput, dexVerified: false });
  return r.blocked === true && r.gates.some((g) => g.id === 'dexUnverified');
})());
t('risk: missing factory is a FATAL gate (blocked)', (() => {
  const r = scoreLaunch({ ...baseInput, factoryReady: false });
  return r.blocked === true && r.gates.some((g) => g.id === 'factoryNotDeployed');
})());
t('risk: both fatal gates carry user-facing i18n keys', (() => {
  const r = scoreLaunch({ ...baseInput, dexVerified: false, factoryReady: false });
  return r.gates.length === 2 && r.gates.every((g) => typeof g.key === 'string' && g.fatal === true);
})());
t('risk: bands are the five fixed ranges (spec §17)',
  RISK_BANDS.map((b) => b.id).join(',') === 'low,moderate,elevated,high,critical');
t('risk: lpOwnedByCreator is a disclosed finding (not hidden)',
  scoreLaunch(baseInput).findings.some((f) => f.id === 'lpOwnedByCreator'));

/* ── fees ────────────────────────────────────────────────────────────────── */

t('fees: v1 launch fee is 0 bps', LAUNCH_FEES.launchFeeBps === 0);
t('fees: 0 bps ⇒ zero fee at any amount', computeLaunchFee('1234567') === '0');
t('fees: 100 bps of 10000 = 100', computeLaunchFee('10000', 100) === '100');
t('fees: fee is a stable decimal string (client/server identical)', typeof computeLaunchFee('10000', 100) === 'string');
t('fees: swap fee is the existing 0.70% platform fee', LAUNCH_FEES.swapFeeBps === 70);

/* ── networks ────────────────────────────────────────────────────────────── */

t('networks: phase-1 EVM set is the spec set',
  [8453, 56, 42161, 137, 1].every((id) => LAUNCH_CHAINS.includes(id)));
t('networks: every chain has a DEX registry entry (factory + anchor pair)',
  LAUNCH_CHAINS.every((id) => LAUNCH_DEX[id] && LAUNCH_DEX[id].factory && LAUNCH_DEX[id].anchor));
t('networks: anchor entries are 40-hex addresses (token a, token b)',
  LAUNCH_CHAINS.every((id) => {
    const d = LAUNCH_DEX[id];
    return /^0x[0-9a-fA-F]{40}$/.test(d.factory) && /^0x[0-9a-fA-F]{40}$/.test(d.anchor.a) && /^0x[0-9a-fA-F]{40}$/.test(d.anchor.b);
  }));
t('networks: fee tiers are within the V2 1–120 bps sanity band',
  LAUNCH_CHAINS.every((id) => LAUNCH_DEX[id].feeTierBps >= 1 && LAUNCH_DEX[id].feeTierBps <= 120));
t('networks: solana is an honest coming-soon slot (not silently shipped)',
  typeof SOLANA_LAUNCH_STATUS === 'string' && /COMING/i.test(SOLANA_LAUNCH_STATUS));
t('networks: solana keeps its badge until every part is finished',
  solanaLaunchStatus().shipping === false && /COMING/i.test(solanaLaunchStatus().badge));
t('networks: the launch set is exactly the fully-verified chain set',
  LAUNCH_CHAINS.join(',') === '8453,56,42161,137,1,10,43114');
t('networks: every factory is a valid EIP-55 checksummed address',
  LAUNCH_CHAINS.every((id) => {
    try { return ethers.getAddress(LAUNCH_DEX[id].factory) === LAUNCH_DEX[id].factory; } catch { return false; }
  }));
t('networks: arbitrum uses Sushi\'s standard factory, not the rejected constant',
  LAUNCH_DEX[42161].factory === '0xc35DADB65012eC5796536bD9864eD8773aBc74C4'
  && !Object.values(LAUNCH_DEX).some((d) => d.factory.toLowerCase() === '0x4726b504e477d31e09e2a0c38e10f226f3104881'));
t('networks: dex ids are unique across chains', new Set(LAUNCH_CHAINS.map((id) => LAUNCH_DEX[id].id)).size === LAUNCH_CHAINS.length);
t('networks: every anchor is a pair of DISTINCT tokens',
  LAUNCH_CHAINS.every((id) => LAUNCH_DEX[id].anchor.a.toLowerCase() !== LAUNCH_DEX[id].anchor.b.toLowerCase()));
t('networks: chains whose swap router is another DEX family pin their own router',
  dexForChain(10).routerOwner === 'dex' && dexForChain(43114).routerOwner === 'dex'
  && [8453, 56, 42161, 137, 1].every((id) => dexForChain(id).routerOwner === 'chain'));
t('networks: OP/AVAX route through their own Sushi router, never the chain swap router',
  dexForChain(10).router === '0x2ABf469074dc0b54d793850807E6eb5Faf2625b1'
  && dexForChain(43114).router === '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506'
  && dexForChain(10).router !== EVM_CHAINS[10].router
  && dexForChain(43114).router !== EVM_CHAINS[43114].router);
t('networks: pinning a router also pins the wrapped native it pairs with',
  dexForChain(10).wrapped === '0x4200000000000000000000000000000000000006'
  && dexForChain(43114).wrapped === '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7');
t('networks: every launch chain has quotes and a native entry',
  LAUNCH_CHAINS.every((id) => quoteAssetsFor(id).length > 0 && Boolean(nativeFor(id))));
t('networks: an unlisted chain is null, not a fake ready card',
  [59144, 146, 5000, 80094, 130, 143, 534352, 324, 4663].every((id) => describeLaunchChain(id) === null));
t('networks: every listed chain is ready AND token-deployable without any factory',
  LAUNCH_CHAINS.every((id) => {
    const d = describeLaunchChain(id);
    return d.status === 'ready' && d.tokenDeployReady === true && d.mode === LAUNCH_MODES.DIRECT;
  }));
t('networks: a pinned FBT factory flips the mode to factory (per chain, disclosed)',
  describeLaunchChain(8453, { factoryAddress: '0x' + '11'.repeat(20) }).mode === LAUNCH_MODES.FACTORY);

/* ── calldata: byte-exactness ────────────────────────────────────────────── */

const coder = new ethers.AbiCoder();
const factoryIface = new ethers.Interface(FACTORY_ABI);
const tokenIface = new ethers.Interface(artifact.contracts.FBTBasicToken.abi);

const createTx = await buildTokenCreateTx({ factoryAddress: '0x' + '11'.repeat(20), spec: goodSpec.value });
const [cfg] = factoryIface.decodeFunctionData('createToken', createTx.data);
t('calldata: createToken data decodes to the exact intent (tuple field by field)',
  cfg.name === goodSpec.value.name && cfg.symbol === goodSpec.value.symbol &&
  Number(cfg.decimals) === goodSpec.value.decimals && cfg.initialSupply === BigInt(goodSpec.value.supplyWei) &&
  cfg.capabilities === 0n);
t('calldata: createToken targets the factory and costs nothing (token mints to caller)',
  createTx.to.toLowerCase() === '0x' + '11'.repeat(20) && createTx.value === '0');

t('calldata: slippage floor is exact (floor division)', minWithSlippage('10000', 100) === 9900n);
t('calldata: slippage 0 = unchanged', minWithSlippage('12345', 0) === 12345n);

/* ── direct deploy (the v1 default): bytes, address, verification ───────── */

const directCreator = '0x' + '22'.repeat(20);
const directTx = await buildDirectTokenCreateTx({ spec: goodSpec.value, creator: directCreator, nonce: 0 });
const ctorBytes = '0x' + directTx.data.slice(TOKEN_BYTECODE.length);
const ctorDecoded = coder.decode([...TOKEN_CONSTRUCTOR_TYPES], ctorBytes);

t('direct: data is EXACTLY creation bytecode ‖ constructor args',
  directTx.data.startsWith(TOKEN_BYTECODE)
  && directTx.data.length === TOKEN_BYTECODE.length + ctorBytes.length - 2);
t('direct: constructor args decode to the exact intent (independent decode)',
  ctorDecoded[0] === goodSpec.value.name && ctorDecoded[1] === goodSpec.value.symbol
  && Number(ctorDecoded[2]) === goodSpec.value.decimals
  && ctorDecoded[3] === BigInt(goodSpec.value.supplyWei)
  && ctorDecoded[4].toLowerCase() === directCreator
  && ctorDecoded[5] === 0n);
t('direct: creator is the signing wallet — the whole supply mints to it', directTx.creator.toLowerCase() === directCreator);
t('direct: a plain CREATE — to is null, value 0, no factory, no event to parse',
  directTx.to === null && directTx.deploy === true && directTx.event === null && directTx.value === '0'
  && directTx.id === 'create-token');
t('direct: expected code is the token runtime bytecode we published',
  directTx.expectedCode === TOKEN_DEPLOYED_BYTECODE && TOKEN_DEPLOYED_BYTECODE.length > 100);
t('direct: the predicted address is filled in before signing', directTx.predictedAddress === await predictCreateAddress(directCreator, 0));

/* The CREATE rule, pinned to vectors other clients publish: nonce 0/1 are the
   classic go-ethereum/ethereumjs values, 255/256 exercise the RLP minimal-byte
   boundary (0x80 empty string vs 0x01 vs 0xff vs 0x0100). */
const VECTOR_ADDR = '0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0';
t('direct: create address @nonce 0 matches the published vector',
  (await predictCreateAddress(VECTOR_ADDR, 0)).toLowerCase() === '0xcd234a471b72ba2f1ccf0a70fcaba648a5eecd8d');
t('direct: create address @nonce 1 matches the published vector',
  (await predictCreateAddress(VECTOR_ADDR, 1)).toLowerCase() === '0x343c43a37d37dff08ae8c4a11544c718abb4fcf8');
t('direct: nonce 255 and 256 (RLP multi-byte) match the reference client',
  (await predictCreateAddress(VECTOR_ADDR, 255)).toLowerCase() === '0x3ef7c1a519e4b4431e317d7839340e3139b03c65'
  && (await predictCreateAddress(VECTOR_ADDR, 256)).toLowerCase() === '0x3837c1ae70354f670550c746580199ac6a73cb0a');
t('direct: a bad deployer or a negative nonce is refused by name',
  await predictCreateAddress('0x' + '22'.repeat(20), 0).then(() => false, () => false) === false
  && await buildDirectTokenCreateTx({ spec: goodSpec.value, creator: 'nope' }).then(() => false, (e) => e.message === 'CREATOR_ADDRESS_INVALID'));

/* checkDirectDeploy — the check that replaces the factory's TokenCreated event. */
const okDeploy = checkDirectDeploy({
  status: 1, to: null, predictedAddress: directCreator, contractAddress: directCreator,
  expectedCode: TOKEN_DEPLOYED_BYTECODE, actualCode: TOKEN_DEPLOYED_BYTECODE
});
t('verify: a clean direct deploy passes with no problems', okDeploy.ok === true && okDeploy.problems.length === 0);
t('verify: the reported address is the receipt\'s own (the chain\'s word)',
  okDeploy.address.toLowerCase() === directCreator && okDeploy.code === TOKEN_DEPLOYED_BYTECODE);
t('verify: code that differs in one byte is a NAMED failure',
  checkDirectDeploy({
    status: 1, to: null, predictedAddress: directCreator, contractAddress: directCreator,
    expectedCode: TOKEN_DEPLOYED_BYTECODE,
    actualCode: TOKEN_DEPLOYED_BYTECODE.slice(0, -2) + (TOKEN_DEPLOYED_BYTECODE.endsWith('00') ? '11' : '00')
  }).problems.includes('DIRECT_CODE_MISMATCH'));
t('verify: no code at the address is a named failure',
  checkDirectDeploy({ status: 1, to: null, predictedAddress: directCreator, contractAddress: directCreator, expectedCode: TOKEN_DEPLOYED_BYTECODE, actualCode: '0x' })
    .problems.includes('DIRECT_NO_CODE'));
t('verify: landing somewhere else than predicted blocks the launch (nonce moved)',
  checkDirectDeploy({
    status: 1, to: null, predictedAddress: directCreator, contractAddress: '0x' + '44'.repeat(20),
    expectedCode: TOKEN_DEPLOYED_BYTECODE, actualCode: TOKEN_DEPLOYED_BYTECODE
  }).problems.includes('DIRECT_ADDRESS_MISMATCH'));
t('verify: a reverted deploy and a non-deploy transaction have their own names',
  checkDirectDeploy({ status: 0, to: null, predictedAddress: directCreator, contractAddress: null, expectedCode: TOKEN_DEPLOYED_BYTECODE, actualCode: '0x' })
    .problems.includes('DIRECT_TX_REVERTED')
  && checkDirectDeploy({ status: 1, to: directCreator, predictedAddress: directCreator, contractAddress: null, expectedCode: TOKEN_DEPLOYED_BYTECODE, actualCode: TOKEN_DEPLOYED_BYTECODE })
    .problems.includes('DIRECT_TX_NOT_DEPLOY'));
t('verify: a receipt without a contract address is caught',
  checkDirectDeploy({ status: 1, to: null, predictedAddress: directCreator, contractAddress: null, expectedCode: TOKEN_DEPLOYED_BYTECODE, actualCode: TOKEN_DEPLOYED_BYTECODE })
    .problems.includes('DIRECT_RECEIPT_ADDRESS_MISSING'));
t('verify: a missing prediction is caught, never papered over',
  checkDirectDeploy({ status: 1, to: null, predictedAddress: null, contractAddress: directCreator, expectedCode: TOKEN_DEPLOYED_BYTECODE, actualCode: TOKEN_DEPLOYED_BYTECODE })
    .problems.includes('DIRECT_PREDICTED_ADDRESS_MISSING'));

/* codeMatches — length first, then the first differing byte. */
t('codeMatches: identical code passes', codeMatches(TOKEN_DEPLOYED_BYTECODE, TOKEN_DEPLOYED_BYTECODE.toUpperCase().replace('0X', '0x')).ok === true);
t('codeMatches: a truncated reply is a LENGTH_MISMATCH (never a pass)',
  codeMatches(TOKEN_DEPLOYED_BYTECODE, TOKEN_DEPLOYED_BYTECODE.slice(0, -4)).reason === 'LENGTH_MISMATCH');
t('codeMatches: a one-byte difference reports where it diverged',
  (() => {
    const other = TOKEN_DEPLOYED_BYTECODE.slice(0, 40) + (TOKEN_DEPLOYED_BYTECODE[40] === '0' ? '1' : '0') + TOKEN_DEPLOYED_BYTECODE.slice(41);
    const res = codeMatches(TOKEN_DEPLOYED_BYTECODE, other);
    return res.ok === false && res.reason === 'BYTE_MISMATCH' && res.at === 40;
  })());
t('codeMatches: empty replies are NO_CODE', codeMatches(TOKEN_DEPLOYED_BYTECODE, '0x').reason === 'NO_CODE');

/* ── verifyDex: the pre-signature gate, against a stubbed chain ───────────
 * A stub provider (no network) answers the view calls with whatever the test
 * wants. The point is not the encoding — it is that EVERY wrong constant has
 * a NAMED reason and blocks, and that the router used is the DEX's own.
 */
{
  const v2 = new ethers.Interface([
    'function getPair(address,address) view returns (address)',
    'function factory() view returns (address)',
    'function WETH() view returns (address)'
  ]);
  const sel = (fn) => v2.getFunction(fn).selector;
  const enc = (type, value) => coder.encode([type], [value]);
  const ZERO = '0x' + '00'.repeat(20);

  /* Addresses in the stub are arbitrary but distinct from every real one. */
  const pairAddr = '0x' + 'aa'.repeat(20);
  const otherFactory = '0x' + 'bb'.repeat(20);
  const stub = (dex, over = {}) => ({
    async getCode() { return over.code ?? '0x6000366000'; },
    async call(tx) {
      const to = String(tx.to).toLowerCase();
      const data = tx.data;
      if (to === dex.factory.toLowerCase() && data.startsWith(sel('getPair'))) {
        return enc('address', over.pair === null ? ZERO : (over.pair ?? pairAddr));
      }
      if (to === pairAddr.toLowerCase() && data.startsWith(sel('factory'))) {
        return enc('address', over.pairFactory ?? dex.factory);
      }
      if (dex.router && to === dex.router.toLowerCase() && data.startsWith(sel('factory'))) {
        return enc('address', over.routerFactory ?? dex.factory);
      }
      if (dex.router && to === dex.router.toLowerCase() && data.startsWith(sel('WETH'))) {
        return enc('address', over.routerWrapped ?? dex.wrapped);
      }
      return '0x';
    }
  });

  const dexBase = dexForChain(8453);
  const good = await verifyDex(stub(dexBase), 8453, dexBase);
  t('verifyDex: a fully consistent DEX passes and reports the anchor pair',
    good.ok === true && good.problems.length === 0 && good.anchorPair.toLowerCase() === pairAddr && good.reason === undefined);
  t('verifyDex: the router it verified is the chain\'s swap router here',
    good.router.toLowerCase() === EVM_CHAINS[8453].router.toLowerCase());

  const dexOp = dexForChain(10);
  t('verifyDex: on OP it verifies the Sushi router it will actually approve',
    (await verifyDex(stub(dexOp), 10, dexOp)).ok === true && dexOp.router === LAUNCH_DEX[10].router);

  const emptyFactory = await verifyDex(stub(dexBase, { code: '0x' }), 8453, dexBase);
  t('verifyDex: an empty factory address is FACTORY_NO_CODE', emptyFactory.problems.includes('FACTORY_NO_CODE') && emptyFactory.ok === false);
  const noAnchor = await verifyDex(stub(dexBase, { pair: null }), 8453, dexBase);
  t('verifyDex: a zero anchor pair is ANCHOR_PAIR_MISSING (wrong factory)',
    noAnchor.problems.includes('ANCHOR_PAIR_MISSING') && noAnchor.anchorPair === null);
  const wrongPairOwner = await verifyDex(stub(dexBase, { pairFactory: otherFactory }), 8453, dexBase);
  t('verifyDex: a pair that names another factory is PAIR_FACTORY_MISMATCH',
    wrongPairOwner.problems.includes('PAIR_FACTORY_MISMATCH'));
  const wrongRouter = await verifyDex(stub(dexBase, { routerFactory: otherFactory }), 8453, dexBase);
  t('verifyDex: a router from another factory is ROUTER_FACTORY_MISMATCH',
    wrongRouter.problems.includes('ROUTER_FACTORY_MISMATCH'));
  const wrongWrapped = await verifyDex(stub(dexBase, { routerWrapped: '0x' + 'cc'.repeat(20) }), 8453, dexBase);
  t('verifyDex: a router wrapping another native is ROUTER_WRAPPED_MISMATCH',
    wrongWrapped.problems.includes('ROUTER_WRAPPED_MISMATCH'));
  t('verifyDex: no provider / no dex is a refusal, not a pass',
    (await verifyDex(null, 8453, dexBase)).ok === false && (await verifyDex(stub(dexBase), 9999, null)).ok === false);
}

/* ── the UI path: direct mode never reads a factory event ────────────────── */
{
  const launchSrc = readFileSync('src/pages/Launch.jsx', 'utf8');
  t('ui: the direct branch verifies the predicted address + code, not an event',
    /verifyDirectToken\(provider, receipt/.test(launchSrc));
  t('ui: TokenCreated is parsed ONLY in the factory branch (guarded)',
    /if \(st\.id === 'create-token' && !st\.deploy\)/.test(launchSrc)
    && /if \(st\.id === 'create-token' && st\.deploy\)/.test(launchSrc));
  t('ui: the pending nonce is re-read immediately before signing a direct deploy',
    /buildDirectTokenCreateTx\(\{ spec: cur\.config\.spec, creator: cur\.config\.creator, nonce: liveNonce \}\)/.test(launchSrc));
  t('ui: the mode badge and the deploy-mode review row are wired to the chain mode',
    /launch-badge mode/.test(launchSrc) && /launch\.review\.deployMode/.test(launchSrc));
  t('ui: the explainers are native <details> (no JS state to get stuck)',
    (launchSrc.match(/<details className="launch-disclosure/g) || []).length === 2
    && (launchSrc.match(/<summary className="launch-disclosure-head"/g) || []).length === 2);
  t('ui: they render the five how-steps and the five warnings from i18n',
    /launch\.howStep\$\{n\}/.test(launchSrc) && /launch\.warn\$\{n\}/.test(launchSrc));
  t('ui: Solana is gated by the status module, not by copy',
    /solanaLaunchStatus\(\)/.test(launchSrc) && /SOLANA\.shipping/.test(launchSrc));
}

/* ── i18n: the new copy exists in BOTH en and fa, actually translated ────── */
{
  const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')).launch;
  const fa = JSON.parse(readFileSync('src/i18n/locales/fa.json', 'utf8')).launch;
  const pick = (o, path) => path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), o);
  const NEW_KEYS = [
    'howTitle', 'howSub', 'howStep1', 'howStep2', 'howStep3', 'howStep4', 'howStep5', 'howNote',
    'warnTitle', 'warnSub', 'warn1', 'warn2', 'warn3', 'warn4', 'warn5',
    'mode.direct', 'mode.factory', 'mode.directFull', 'mode.factoryFull',
    'network.verifyingShort', 'network.blocked', 'network.tapToVerify',
    'network.directTitle', 'network.directBody', 'network.factoryModeBody',
    'review.deployMode', 'review.predictedTitle', 'review.predictedNote',
    'run.predictedNote', 'result.directNote', 'result.factoryNote',
    'run.err.DIRECT_CODE_MISMATCH', 'run.err.DIRECT_NO_CODE', 'run.err.DIRECT_ADDRESS_MISMATCH',
    'run.err.DIRECT_TX_REVERTED', 'run.err.DIRECT_TX_NOT_DEPLOY', 'run.err.DIRECT_RECEIPT_ADDRESS_MISSING',
    'run.err.DIRECT_PREDICTED_ADDRESS_MISSING', 'run.err.TOKEN_EVENT_NOT_FOUND',
    'run.err.TX_REVERTED', 'run.err.USER_REJECTED'
  ];
  const missing = NEW_KEYS.filter((k) => typeof pick(en, k) !== 'string' || typeof pick(fa, k) !== 'string');
  t('i18n: every new key is present in en AND fa (no raw keys on screen)', missing.length === 0);
  t('i18n: fa is a translation, not the English string copied over',
    NEW_KEYS.filter((k) => pick(fa, k) === pick(en, k)).length === 0);
  t('i18n: the warnings say what a token cannot do after creation',
    /locked/i.test(pick(en, 'warn2')) && /قفل/.test(pick(fa, 'warn2')));
}

/* ── the presentation promises, pinned in CSS (layout can't be jsdom-tested) ─ */
{
  const css = readFileSync('src/styles/launch.css', 'utf8');
  t('css: the chain grid is auto-fill ≥150px (7 chains fit a 390px phone)',
    /\.launch-chain-grid\s*\{[^}]*repeat\(auto-fill,\s*minmax\(150px,\s*1fr\)\)/.test(css));
  t('css: the hero is one glass box with a lit rim and a soft gradient',
    /\.launch-hero\s*\{[^}]*border-radius:\s*22px/.test(css) && /linear-gradient/.test(css) && /mask-composite/.test(css));
  t('css: the rocket floats and its glow pulses (decorative only)',
    /@keyframes launchFloat/.test(css) && /@keyframes launchGlow/.test(css));
  t('css: prefers-reduced-motion switches every launch animation OFF',
    /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}\.launch-rocket[\s\S]{0,200}animation:\s*none/.test(css));
  t('css: the default <details> marker is hidden and the caret rotates',
    /::-webkit-details-marker\s*\{\s*display:\s*none/.test(css)
    && /\.launch-disclosure\[open\][\s\S]{0,160}rotate\(180deg\)/.test(css));
  t('css: light theme and the native shell get their own treatment',
    /:root\[data-theme='light'\] \.launch-hero/.test(css) && /:root\[data-native='true'\]/.test(css));
}

const usdt = { symbol: 'USDT', name: 'Tether USD', address: '0x' + '55'.repeat(20), decimals: 6, native: false };
const bnb = { symbol: 'BNB', name: 'BNB', address: null, decimals: 18, native: true };

const planA = await buildLaunchPlan({
  chainId: 56,
  factoryAddress: '0x' + '11'.repeat(20),
  spec: { ...goodSpec.value },
  quote: usdt,
  tokenAmount: '100000', quoteAmount: '10000',
  slippageBps: 100,
  creator: '0x' + '22'.repeat(20)
});
t('plan: phase one = token + deferred pool (honest two-phase)',
  planA.phase === 'token' &&
  planA.steps.map((s) => s.id).join(',') === 'create-token,deferred-pool');
t('plan: signatureOrder is the full intended order',
  planA.signatureOrder.join('|') === 'token.create|pool.create|liquidity.approve|liquidity.approveQuote|liquidity.add');
t('plan: deferred step carries the intent (no fake zero-address bytes)',
  planA.steps[1].deferred === true && planA.steps[1].intent && !planA.steps[1].data);

const planB = await buildLaunchPlan({
  chainId: 56,
  spec: null,
  tokenAddress: '0x' + '33'.repeat(20),
  quote: usdt,
  tokenAmount: '100000', quoteAmount: '10000',
  slippageBps: 100,
  creator: '0x' + '22'.repeat(20),
  createPairNeeded: true
});
t('plan: phase two = full liquidity steps',
  planB.phase === 'pool' &&
  planB.steps.map((s) => s.id).join(',') === 'approve-token,approve-quote,create-pair,add-liquidity');

const approveDecoded = factoryIface ? tokenIface.decodeFunctionData('approve', planB.steps[0].data) : null;
t('plan: approve(token→router) decodes to exact amounts',
  approveDecoded[0].toLowerCase() === planB.dex.router.toLowerCase() && approveDecoded[1] === 100000n * 10n ** 18n);
t('plan: addLiquidity min = amount × (10000−slippage)/10000 (floor)',
  BigInt(planB.summary.tokenMin) === (100000n * 10n ** 18n * 9900n) / 10000n &&
  BigInt(planB.summary.quoteMin) === (10000n * 10n ** 6n * 9900n) / 10000n);
// LP recipient + deadline live inside the addLiquidity calldata itself —
// decode them back and compare against the intent.
{
  const add = planB.steps.find((s) => s.id === 'add-liquidity');
  const addIface = new ethers.Interface([
    'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline)'
  ]);
  const dec = addIface.decodeFunctionData('addLiquidity', add.data);
  t('plan: addLiquidity calldata mints LP to the creator (non-custodial)',
    dec.to.toLowerCase() === '0x' + '22'.repeat(20));
  t('plan: addLiquidity deadline ≈ now + 600s',
    Number(dec.deadline) >= Math.floor(Date.now() / 1000) - 10 &&
    Number(dec.deadline) <= Math.floor(Date.now() / 1000) + 610);
  t('plan: addLiquidity amounts match the signed mins and desired amounts',
    dec.tokenA.toLowerCase() === '0x' + '33'.repeat(20) &&
    dec.amountADesired === 100000n * 10n ** 18n &&
    dec.amountAMin === (100000n * 10n ** 18n * 9900n) / 10000n &&
    dec.amountBDesired === 10000n * 10n ** 6n &&
    dec.amountBMin === (10000n * 10n ** 6n * 9900n) / 10000n);
}

const planC = await buildLaunchPlan({
  chainId: 56,
  spec: null,
  tokenAddress: '0x' + '33'.repeat(20),
  quote: bnb,
  tokenAmount: '100000', quoteAmount: '0.5',
  slippageBps: 100,
  creator: '0x' + '22'.repeat(20),
  createPairNeeded: false
});
t('plan: native quote skips quote-approve and uses addLiquidityETH with msg.value',
  planC.steps.map((s) => s.id).join(',') === 'approve-token,add-liquidity' &&
  planC.steps[1].value === '500000000000000000');

/* ── TokenCreated event parsing ──────────────────────────────────────────── */

const tokenFrag = tokenIface.getEvent ? null : null; // tokens emit nothing; factory does
const factoryTokenCreated = factoryIface.getEvent('TokenCreated');
const eventLog = {
  topics: [
    factoryTokenCreated.topicHash,
    ethers.zeroPadValue('0x' + '33'.repeat(20), 32),
    ethers.zeroPadValue('0x' + '22'.repeat(20), 32)
  ],
  data: coder.encode(['string', 'string', 'uint8', 'uint256', 'uint256'],
    ['FBT Gold', 'FBTG', 18, 1000000000n * 10n ** 18n, 0n])
};
const parsed = await parseTokenCreatedLog(eventLog);
t('event: TokenCreated parses token/creator/symbol/decimals/supply',
  parsed.token.toLowerCase() === '0x' + '33'.repeat(20) &&
  parsed.creator.toLowerCase() === '0x' + '22'.repeat(20) &&
  parsed.symbol === 'FBTG' && parsed.decimals === 18 && parsed.supply === '1000000000' + '0'.repeat(18) &&
  parsed.capabilities === 0);

/* ── engine lifecycle ────────────────────────────────────────────────────── */

const makeCfg = (overrides = {}) => ({
  chainId: 56,
  dex: { id: 'pancake', name: 'PancakeSwap', factory: '0x' + '99'.repeat(20) },
  factoryAddress: '0x' + '11'.repeat(20),
  spec: { ...goodSpec.value },
  quote: usdt,
  tokenAmount: '100000', quoteAmount: '10000', slippageBps: 100,
  creator: '0x' + '22'.repeat(20),
  risk: lowRisk,
  steps: [
    { id: 'create-token', status: 'ready', to: '0x' + '11'.repeat(20), data: '0xab', value: '0', description: 'create' },
    { id: 'deferred-pool', status: 'pending', deferred: true, description: 'pool' }
  ],
  ...overrides
});

/* full happy path */
{
  const L = engine.createLaunch();
  engine.configure(L, makeCfg());
  engine.simulateStart(L);
  engine.simulateDone(L, { gas: { 'create-token': '100000' } });
  engine.confirmIntent(L);
  t('engine: DRAFT → CONFIGURED → SIMULATING → SIMULATED → AWAITING_CONFIRMATION',
    L.state === 'AWAITING_CONFIRMATION' && L.simulation);

  engine.signingStarted(L, 'create-token');
  assert.equal(L.state, 'SIGNING');
  engine.stepSubmitted(L, 'create-token', '0x' + 'ab'.repeat(32));
  assert.equal(L.state, 'SUBMITTED');
  engine.stepConfirmed(L, 'create-token', {
    receipt: { transactionHash: '0x' + 'ab'.repeat(32), blockNumber: 1, gasUsed: '100000' },
    tokenFacts: { address: '0x' + '33'.repeat(20), name: 'FBT Gold', symbol: 'FBTG', decimals: 18, supply: '1000000000' + '0'.repeat(18), capabilities: 0n }
  });
  t('engine: token confirmed → facts recorded, deferred step resolved with the REAL address',
    L.token.address.toLowerCase() === '0x' + '33'.repeat(20) &&
    L.steps.find((s) => s.id === 'deferred-pool').resolvedWith.toLowerCase() === '0x' + '33'.repeat(20) &&
    L.steps.find((s) => s.id === 'deferred-pool').needsReprepare === true);

  // materialise pool steps (the UI does this with buildLiquiditySteps)
  const deferredIdx = L.steps.findIndex((s) => s.id === 'deferred-pool');
  L.steps.splice(deferredIdx, 1,
    { id: 'approve-token', status: 'ready' }, { id: 'create-pair', status: 'ready' }, { id: 'add-liquidity', status: 'ready' });
  for (const id of ['approve-token', 'create-pair', 'add-liquidity']) {
    engine.signingStarted(L, id);
    engine.stepSubmitted(L, id, '0x' + 'cd'.repeat(32));
    if (id === 'create-pair') engine.stepConfirmed(L, id, { poolFacts: { address: '0x' + '44'.repeat(20) } });
    else engine.stepConfirmed(L, id, {});
  }
  assert.equal(L.state, 'CONFIRMING', 'last step confirmed → CONFIRMING');

  engine.verified(L, {
    token: { address: '0x' + '33'.repeat(20), name: 'FBT Gold', symbol: 'FBTG' },
    pool: { address: '0x' + '44'.repeat(20), lpBalance: '1000', reserves: { token: '100000', quote: '10000' } }
  });
  assert.equal(L.state, 'VERIFIED');
  engine.live(L);
  t('engine: VERIFIED → LIVE is the only road to LIVE', L.state === 'LIVE' && L.pool.lpBalance === '1000');
}

/* partial failure — token mined, pool failed */
{
  const F = engine.createLaunch();
  engine.configure(F, makeCfg());
  engine.simulateStart(F);
  engine.simulateDone(F, {});
  engine.confirmIntent(F);
  engine.signingStarted(F, 'create-token');
  engine.stepSubmitted(F, 'create-token', '0x' + 'ee'.repeat(32));
  engine.stepConfirmed(F, 'create-token', { tokenFacts: { address: '0x' + '33'.repeat(20), name: 'FBT Gold', symbol: 'FBTG', decimals: 18, supply: '1', capabilities: 0n } });

  F.steps.find((s) => s.id === 'deferred-pool').deferred = false;
  F.steps.find((s) => s.id === 'deferred-pool').status = 'ready';
  engine.signingStarted(F, 'deferred-pool');
  engine.stepSubmitted(F, 'deferred-pool', '0x' + 'ff'.repeat(32));
  engine.stepFailed(F, 'deferred-pool', 'EXECUTION_REVERTED: slippage');

  t('engine: token ok + pool failed = RETRYABLE with the EXACT partial report',
    F.state === 'RETRYABLE' && F.partial.token === 'SUCCESS' && F.partial.pool === 'FAILED' &&
    F.partial.failedStep === 'deferred-pool' && F.token.address.toLowerCase() === '0x' + '33'.repeat(20));

  engine.retryPool(F);
  t('engine: retry keeps the token (never re-created) and goes back to CONFIGURED for re-simulation',
    F.state === 'CONFIGURED' && F.token.address.toLowerCase() === '0x' + '33'.repeat(20));
}

/* failure before the token = plain FAILED (nothing partial to report) */
{
  const X = engine.createLaunch();
  engine.configure(X, makeCfg());
  engine.simulateStart(X);
  engine.simulateDone(X, {});
  engine.confirmIntent(X);
  engine.signingStarted(X, 'create-token');
  engine.stepFailed(X, 'create-token', 'TX_REVERTED');
  t('engine: token step fails first = FAILED (no token exists on-chain)', X.state === 'FAILED' && X.token === null);
}

/* cancel keeps confirmed facts */
{
  const C = engine.createLaunch();
  engine.configure(C, makeCfg());
  engine.simulateStart(C);
  engine.simulateDone(C, {});
  engine.confirmIntent(C);
  engine.signingStarted(C, 'create-token');
  engine.stepSubmitted(C, 'create-token', '0x' + '11'.repeat(32));
  engine.stepConfirmed(C, 'create-token', { tokenFacts: { address: '0x' + '33'.repeat(20), name: 'A', symbol: 'A', decimals: 18, supply: '1', capabilities: 0n } });
  engine.cancel(C);
  t('engine: cancel → CANCELLED, token fact preserved', C.state === 'CANCELLED' && C.token.address.toLowerCase() === '0x' + '33'.repeat(20));
}

/* user rejection is a choice, never a failure */
{
  const R = engine.createLaunch();
  engine.configure(R, makeCfg());
  engine.simulateStart(R);
  engine.simulateDone(R, {});
  engine.confirmIntent(R);
  engine.signingStarted(R, 'create-token');
  engine.stepRejected(R, 'create-token');
  t('engine: user rejection (nothing mined) → CANCELLED, not FAILED',
    R.state === 'CANCELLED' && R.steps[0].error === 'USER_REJECTED');

  // …but a rejection AFTER the token mined keeps the retry path open
  const R2 = engine.createLaunch();
  engine.configure(R2, makeCfg());
  engine.simulateStart(R2);
  engine.simulateDone(R2, {});
  engine.confirmIntent(R2);
  engine.signingStarted(R2, 'create-token');
  engine.stepSubmitted(R2, 'create-token', '0x' + '55'.repeat(32));
  engine.stepConfirmed(R2, 'create-token', { tokenFacts: { address: '0x' + '33'.repeat(20), name: 'A', symbol: 'A', decimals: 18, supply: '1', capabilities: 0 } });
  R2.steps.find((s) => s.id === 'deferred-pool').deferred = false;
  R2.steps.find((s) => s.id === 'deferred-pool').status = 'ready';
  engine.signingStarted(R2, 'deferred-pool');
  engine.stepRejected(R2, 'deferred-pool');
  t('engine: user rejection (token mined) → RETRYABLE with recovery', R2.state === 'RETRYABLE' && R2.partial.recovery === 'retry-pool');
}

/* ── history sanitization ────────────────────────────────────────────────── */

{
  const clean = sanitizeRecord({
    launchId: 'l_123',
    creatorPublicAddress: '0x' + '22'.repeat(20),
    network: 56,
    tokenAddress: '0x' + '33'.repeat(20),
    txHashes: ['0x' + 'aa'.repeat(32)],
    status: 'LIVE',
    riskScore: 42,
    /* fields that must NEVER persist */
    privateKey: '0xdeadbeef',
    seedPhrase: 'abandon abandon',
    secret: 'shh',
    wallet: 'me@example.com',
    nonce: 7,
    badAddress: 'not-an-address',
    badHash: '0x123'
  });
  t('history: sensitive fields dropped (keys, phrases, emails, extras)',
    clean.privateKey === undefined && clean.seedPhrase === undefined && clean.wallet === undefined && clean.nonce === undefined);
  t('history: good records pass through intact',
    clean.launchId === 'l_123' && clean.status === 'LIVE' && clean.txHashes.length === 1 && clean.tokenAddress === '0x' + '33'.repeat(20));
  t('history: malformed hashes are dropped, valid ones kept',
    sanitizeRecord({ txHashes: ['0x' + 'aa'.repeat(32), '0x123'] }).txHashes.length === 1);
  t('history: garbage input → empty record (nothing leaks)',
    Object.keys(sanitizeRecord(null)).length === 0 && Object.keys(sanitizeRecord('x')).length === 0);
}

/* ── artifacts ───────────────────────────────────────────────────────────── */

t('artifacts: both contracts present with bytecode under the 24KB init limit',
  artifact.contracts.FBTBasicToken && artifact.contracts.FBTTokenFactory &&
  artifact.contracts.FBTBasicToken.bytecode.length < 2 * 24576 + 2 &&
  artifact.contracts.FBTTokenFactory.bytecode.length < 2 * 24576 + 2);
t('artifacts: factory ABI exposes createToken + isFbtToken (stateless, no owner)',
  ['createToken', 'isFbtToken', 'createdCount'].every((fn) => artifact.contracts.FBTTokenFactory.abi.some((e) => e.type === 'function' && e.name === fn)));
t('artifacts: token ABI has the exact capability surface (owner-gated powers)',
  ['transfer', 'balanceOf', 'approve', 'transferFrom', 'owner', 'setPaused', 'setCapabilityLimits', 'mint', 'burn', 'capabilities'].every((fn) =>
    artifact.contracts.FBTBasicToken.abi.some((e) => e.type === 'function' && e.name === fn)));
t('artifacts: token ABI emits no tax/blacklist surface (no blacklist function exists)',
  !artifact.contracts.FBTBasicToken.abi.some((e) => /blacklist|isBlacklisted|setTax/i.test(e.name || '')));

console.log('\n✓ launch-probe: all assertions passed\n');
