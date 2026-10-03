/**
 * NETWORK CAPABILITY PARITY PROBE
 * ---------------------------------------------------------------------------
 * Reported: «شبکه‌های S / MINT / BREA / UNI / Mon / Scr / Zk / Rabinhood — مانند
 * دیگر شبکه‌ها تحلیل هوش مصنوعی توکن، رله خصوصی و ریسک mev و محافظت، سواپ بدون
 * گس — اینها را ندارد و مربوط به شبکه‌های دیگر هست؛ برای این شبکه‌ها هم بیاور».
 *
 * Eight networks (Sonic 146 · Mantle 5000 · Berachain 80094 · Unichain 130 ·
 * Monad 143 · Scroll 534352 · zkSync Era 324 · Robinhood Chain 4663) were in
 * the swap registry but outside three capability maps that predate them. This
 * probe pins all three, on every chain in the registry, so the next network
 * added cannot silently arrive without them.
 *
 * ─── WHY IT READS SOURCE FOR THE SERVER SIDE ────────────────────────────────
 * The two GoPlus allowlists and the 0x `SUPPORTED` set are private constants
 * inside modules that also open sockets and read env. Importing them would
 * tie a static assertion to runtime configuration; reading them out of the
 * source — with comments stripped, exactly as app-network-parity-probe does —
 * asserts what the deployed code will actually accept.
 */
import { readFileSync } from 'node:fs';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

/**
 * Source with comments removed.
 *
 * These files quote the very expressions they replaced — `new Set(['1', '56',
 * …])`, «dRPC MEV-Protected» — inside comments, so a naive grep "finds" the
 * old value in the text that documents replacing it.
 */
const code = (p) => {
  let s = readFileSync(p, 'utf8');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');        /* block comments */
  s = s.replace(/(?<![:'"])\/\/[^\n]*/g, '');    /* line comments, not https:// */
  return s;
};

/** Pull the array literal out of `const NAME = new Set([ … ])`. */
function setFromSource(src, name) {
  const re = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\);`);
  const m = src.match(re);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/** The eight networks the report named, by the short label the UI shows. */
const REPORTED = [
  [146, 'Sonic (S)'],
  [5000, 'Mantle (MNT)'],
  [80094, 'Berachain (BERA)'],
  [130, 'Unichain (UNI)'],
  [143, 'Monad (MON)'],
  [534352, 'Scroll (SCR)'],
  [324, 'zkSync Era (ZK)'],
  [4663, 'Robinhood Chain (HOOD)']
];
const REPORTED_IDS = REPORTED.map(([id]) => id);

/* ─────────────────────────────────────────────────────────────────────────── */
/* 1. AI TOKEN ANALYSIS — GoPlus, client and both server allowlists            */
/* ─────────────────────────────────────────────────────────────────────────── */

const { goplusChainId } = await import('../src/lib/tokenRisk.js');

const serverTokenRisk = setFromSource(code('server/tokenRisk.js'), 'ALLOWED');
const securityIntel = setFromSource(code('server/securityIntel.js'), 'GOPLUS_CHAINS');

check('goplus: server/tokenRisk.js ALLOWED is readable', Array.isArray(serverTokenRisk));
check('goplus: server/securityIntel.js GOPLUS_CHAINS is readable', Array.isArray(securityIntel));

const { EVM_CHAIN_ORDER, EVM_CHAINS } = await import('../src/lib/chains.js');

/*
 * The whole registry, not just the eight: a chain that is swappable but not
 * scannable is a chain where the user swaps blind, and that gap re-opens the
 * moment anyone adds a network without touching tokenRisk.js.
 */
for (const id of EVM_CHAIN_ORDER) {
  const label = EVM_CHAINS[id]?.name || String(id);
  check(`goplus: ${label} is scannable by the client`, goplusChainId(id) !== null);
  check(`goplus: ${label} is allowed by server/tokenRisk.js`, (serverTokenRisk || []).includes(String(id)));
  check(`goplus: ${label} is allowed by server/securityIntel.js`, (securityIntel || []).includes(String(id)));
}

for (const [id, name] of REPORTED) {
  check(`goplus: ${name} — one source of truth across all three maps`,
    goplusChainId(id) === String(id)
    && (serverTokenRisk || []).includes(String(id))
    && (securityIntel || []).includes(String(id)));
}

/* The provider report must not understate what the scanner can do. */
const providerSrc = code('server/providerStatus.js');
const goplusRow = providerSrc.match(/id: 'goplus-token-risk',[\s\S]*?supportedChains: \[([^\]]*)\]/);
const goplusChains = (goplusRow?.[1] || '').split(',').map((x) => Number(x.trim())).filter(Number.isInteger);
check(`goplus: the provider report lists every registry chain (${goplusChains.length})`,
  EVM_CHAIN_ORDER.every((id) => goplusChains.includes(id)));

/* ─────────────────────────────────────────────────────────────────────────── */
/* 2. GASLESS SWAP — the client gate and the server gate must be the same set  */
/* ─────────────────────────────────────────────────────────────────────────── */

const { GASLESS_CHAINS, gaslessSupports, gaslessExclusionReason } = await import('../src/lib/gasless.js');
const serverGasless = (setFromSource(code('server/gasless.js'), 'SUPPORTED') || []).map(Number);

/*
 * THE BUG THIS PINS. server/gasless.js had been widened to Mantle / Monad /
 * Robinhood / Scroll / zkSync Era while src/lib/gasless.js still held the
 * original seven. The server was willing; the client never rendered the
 * toggle; the user on those eight networks saw no gasless option at all.
 */
check(`gasless: the client set is readable (${[...GASLESS_CHAINS].length} chains)`, GASLESS_CHAINS.size > 0);
check(`gasless: the server set is readable (${serverGasless.length} chains)`, serverGasless.length > 0);

const clientOnly = [...GASLESS_CHAINS].filter((id) => !serverGasless.includes(id));
const serverOnly = serverGasless.filter((id) => !GASLESS_CHAINS.has(id));
check(`gasless: no chain the client offers that the server rejects (${clientOnly.join(', ') || 'none'})`,
  clientOnly.length === 0);
check(`gasless: no chain the server accepts that the client never offers (${serverOnly.join(', ') || 'none'})`,
  serverOnly.length === 0);

/* The seven of the eight that 0x actually lists with a Gasless ✅. */
const ZEROX_GASLESS = [146, 5000, 80094, 130, 143, 534352, 4663];
for (const id of ZEROX_GASLESS) {
  const label = EVM_CHAINS[id]?.short || String(id);
  check(`gasless: ${label} is offered by the client`, gaslessSupports(id) === true);
  check(`gasless: ${label} is accepted by the server`, serverGasless.includes(id));
}

/*
 * Two deliberate exclusions, each with a reason the UI can print. Listing a
 * chain here buys a toggle whose every request answers UNSUPPORTED_CHAIN —
 * the exact failure getGaslessStatus() exists to prevent.
 */
check('gasless: zkSync Era is excluded (0x lists no zkSync row at all)',
  gaslessSupports(324) === false && !serverGasless.includes(324));
check('gasless: Linea is excluded (0x routes Linea swaps, not gasless ones)',
  gaslessSupports(59144) === false && !serverGasless.includes(59144));
check('gasless: both exclusions carry a printable reason',
  gaslessExclusionReason(324) === 'noZeroXChain' && gaslessExclusionReason(59144) === 'noZeroXGasless');
check('gasless: no supported chain is also listed as excluded',
  [...GASLESS_CHAINS].every((id) => gaslessExclusionReason(id) === null));

/* The sentences the swap screen prints for those exclusions must exist. */
const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const fa = JSON.parse(readFileSync('src/i18n/locales/fa.json', 'utf8'));
for (const lang of [['en', en], ['fa', fa]]) {
  const [code_, dict] = lang;
  for (const key of ['noZeroXChain', 'noZeroXGasless']) {
    check(`gasless: swap.gaslessChainOff.${key} exists in ${code_}`,
      typeof dict?.swap?.gaslessChainOff?.[key] === 'string' && dict.swap.gaslessChainOff[key].includes('{{coin}}'));
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* 3. PRIVATE RELAY + MEV RISK + PROTECTION                                    */
/* ─────────────────────────────────────────────────────────────────────────── */

const mev = await import('../src/lib/mev.js');
const { privateRelayFor, mevChainModel, chainAdjustedRisk, estimateSandwichRisk, MEV_CHAIN_MODEL } = mev;

/* Every swappable chain is modelled — an unmodelled chain cannot print a
   truthful sentence about its own mempool. */
for (const id of EVM_CHAIN_ORDER) {
  const label = EVM_CHAINS[id]?.short || String(id);
  check(`mev: ${label} has a mempool model`, Boolean(mevChainModel(id)));
}

const MODELLED = EVM_CHAIN_ORDER.filter((id) => MEV_CHAIN_MODEL[id]);
check(`mev: every registry chain is modelled (${MODELLED.length}/${EVM_CHAIN_ORDER.length})`,
  MODELLED.length === EVM_CHAIN_ORDER.length);

/*
 * Chains whose only transaction entry point is the sequencer (or a TEE
 * builder): submitting to the chain's own RPC is the private path, so the
 * card must offer one and must NOT describe it as a third-party relay.
 */
const SEQUENCER_OR_ENCRYPTED = [5000, 534352, 324, 4663, 130];
for (const id of SEQUENCER_OR_ENCRYPTED) {
  const relay = privateRelayFor(id);
  const label = EVM_CHAINS[id]?.short || String(id);
  check(`mev: ${label} offers a private submission path`, Boolean(relay));
  check(`mev: ${label} labels that path honestly (kind=${relay?.kind})`,
    relay?.kind === 'sequencer' || relay?.kind === 'encrypted');
  check(`mev: ${label}'s own mempool model agrees with its relay kind`,
    ['private', 'encrypted'].includes(mevChainModel(id)?.mempool));
}

/* Unichain is the one chain with a genuinely encrypted mempool + TEE builder. */
check('mev: Unichain is modelled as an encrypted mempool',
  mevChainModel(130)?.mempool === 'encrypted' && privateRelayFor(130)?.kind === 'encrypted');

/*
 * ─── THE THREE L1s WITH A PUBLIC MEMPOOL AND NO VERIFIED RELAY ─────────────
 * dRPC's own documentation lists MEV protection as a premium add-on on exactly
 * five chains (Ethereum · Base · BNB Smart Chain · Arbitrum · Solana). Sonic,
 * Berachain and Monad are not among them, so the honest answer is "no relay" —
 * and the old rows claimed otherwise.
 */
const DENIED = [146, 80094, 143];
for (const id of DENIED) {
  const label = EVM_CHAINS[id]?.short || String(id);
  check(`mev: ${label} does not claim a relay we cannot verify`, privateRelayFor(id) === null);
  check(`mev: ${label} is modelled as a public mempool`, mevChainModel(id)?.mempool === 'public');
}

/* No invented host: robinhood-rpc.publicnode.com never existed. */
const mevSrc = code('src/lib/mev.js');
check('mev: no relay row points at a publicnode host for Robinhood Chain',
  !/robinhood-rpc\.publicnode\.com/.test(mevSrc));
check('mev: Robinhood Chain routes through the chain\'s own sequencer RPC',
  privateRelayFor(4663)?.rpc === 'https://rpc.mainnet.chain.robinhood.com');

/*
 * An operator who buys a private endpoint must be able to plug it in without
 * a code change — otherwise "no verified relay" becomes a permanent no.
 */
check('mev: relayOverride only accepts an https endpoint',
  !/(?:^|[^:])http:\/\//.test(mevSrc.match(/function relayOverride[\s\S]*?\n}/)?.[0] || ''));
check('mev: relayOverride reads VITE_MEV_RELAY_<chainId>',
  /VITE_MEV_RELAY_\$\{/.test(mevSrc));

/* The risk discount is applied per chain, and never silently. */
const risky = estimateSandwichRisk({ slippagePct: 3, priceImpact: 3, amountUsd: 20000 });
const onScroll = chainAdjustedRisk(534352, risky);
const onEthereum = chainAdjustedRisk(1, risky);
check(`mev: the same trade scores lower on Scroll than on Ethereum (${onScroll.score} < ${onEthereum.score})`,
  onScroll.score < onEthereum.score);
check('mev: the adjusted score remembers the raw number', onScroll.rawScore === risky.score);
check('mev: a public-mempool chain is not discounted',
  chainAdjustedRisk(1, risky).adjusted === undefined);
check('mev: the discount never invents safety — level follows the adjusted score',
  onScroll.level === (onScroll.score >= 70 ? 'critical' : onScroll.score >= 45 ? 'high' : onScroll.score >= 22 ? 'medium' : 'low'));

/* The sentences the card prints must exist in both shipped-whole languages. */
for (const [code_, dict] of [['en', en], ['fa', fa]]) {
  for (const key of ['public', 'private', 'encrypted']) {
    check(`mev: mev.model.${key} exists in ${code_}`, typeof dict?.mev?.model?.[key] === 'string');
  }
  for (const key of ['privateSubSequencer', 'privateSubEncrypted', 'noRelayUnknownChain', 'scoreAdjusted']) {
    check(`mev: mev.${key} exists in ${code_}`, typeof dict?.mev?.[key] === 'string');
  }
}

/* MevGuard must read the model, not hard-code one sentence for every chain. */
const guardSrc = code('src/components/MevGuard.jsx');
check('mev: MevGuard prints the chain\'s mempool model', /mev\.model\.\$\{/.test(guardSrc));
check('mev: MevGuard varies the relay sentence by kind', /relay\.kind === 'sequencer'/.test(guardSrc));
check('mev: MevGuard applies the chain-adjusted score', /chainAdjustedRisk\(/.test(guardSrc));

/* ─────────────────────────────────────────────────────────────────────────── */
/* 4. The report's own eight, end to end                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

for (const [id, name] of REPORTED) {
  const scanned = goplusChainId(id) !== null;
  const modelled = Boolean(mevChainModel(id));
  const gaslessOrExplained = gaslessSupports(id) || Boolean(gaslessExclusionReason(id));
  check(`report: ${name} — AI scan ${scanned ? 'on' : 'OFF'} · MEV model ${modelled ? 'on' : 'OFF'} · gasless ${gaslessSupports(id) ? 'on' : 'explained'}`,
    scanned && modelled && gaslessOrExplained);
}

check(`report: all ${REPORTED_IDS.length} named networks are in the swap registry`,
  REPORTED_IDS.every((id) => EVM_CHAIN_ORDER.includes(id)));

export default results;

export function summary() {
  return {
    label: 'network capability parity (AI token scan · private relay & MEV · gasless)',
    passed: results.filter((r) => r.ok).length,
    total: results.length,
    failures: results.filter((r) => !r.ok).map((r) => r.name)
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = summary();
  console.log(`${r.passed}/${r.total} checks passed`);
  for (const f of r.failures) console.log('  ✗', f);
  process.exit(r.failures.length ? 1 : 0);
}
