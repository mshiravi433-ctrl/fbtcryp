/**
 * APP ↔ SITE PARITY PROBE
 * ---------------------------------------------------------------------------
 * Reported: «۴ تا شبکه‌ای که مشکل داشت … در سایت درست شده ولی در اپ هنوز همون
 * ارور قبلی که جفت ارز نمیشه … میزنه. در اپ درستش کن».
 *
 * The website and the packaged Android app are the SAME bundle built by two
 * different pipelines. That is exactly how a fix can land on one and not the
 * other, and this probe pins the three mechanisms that made it happen:
 *
 *   1. THE API ORIGIN. `lib/apiBase.js` exists because a relative `/api` inside
 *      the WebView resolves against https://localhost — the phone's own asset
 *      server. Twenty-eight modules still open-coded
 *      `import.meta.env?.VITE_API_BASE || '/api'`, so on the website they were
 *      correct and in the APK every one of them 404d.
 *   2. THE FEE WALLET. The LI.FI fee recipient is attached SERVER-side from
 *      `LIFI_SWAP_FEE_RECIPIENT`, while the client verified it against
 *      `VITE_FEE_RECIPIENT` — a variable only the APK build sets. When the two
 *      pipelines named different wallets, EVERY LI.FI quote was rejected with
 *      FEE_RECIPIENT_MISMATCH. LI.FI is the primary router on Mantle, Scroll and
 *      zkSync Era, so those were the networks that died — in the app only.
 *   3. THE ERROR MESSAGE. A fee-gate rejection is a statement about our
 *      configuration, but it was reported as «مسیری بین این دو توکن وجود ندارد»
 *      — a claim about the pair, which sends the user to the wrong fix.
 *
 * Plus the two UI regressions reported in the same message: the wallet network
 * picker showing six of sixteen chains, and the futures page's tab rail.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const read = (p) => readFileSync(p, 'utf8');

/**
 * Source with comments removed.
 *
 * Every source-level assertion below has to look at EXECUTABLE code. The
 * modules this probe guards carry long comments quoting the exact expression
 * they replaced — `import.meta.env?.VITE_API_BASE || '/api'`,
 * `EVM_CHAIN_ORDER.slice(0, 6)` — so a naive grep "finds" the bug in the very
 * comment that documents fixing it. Verified: with comments stripped, the only
 * file in src/ that mentions VITE_API_BASE at all is apiBase.js itself.
 */
const code = (p) => {
  let s = read(p);
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');          /* block comments */
  s = s.replace(/(?<![:'"])\/\/[^\n]*/g, '');       /* line comments, not `https://` */
  return s;
};

/* ── 1. apiBase(): the one place that answers "where is the API?" ───────── */
const { reachableFromNativeShell, apiBase } = await import('../src/lib/apiBase.js');

check('apiBase: a relative base is unreachable from the packaged app',
  reachableFromNativeShell('/api') === false);
check('apiBase: a bare "api" is unreachable too',
  reachableFromNativeShell('api') === false);
check('apiBase: http://localhost points at the phone itself',
  reachableFromNativeShell('http://localhost:8787/api') === false);
check('apiBase: https://localhost is still the phone',
  reachableFromNativeShell('https://localhost/api') === false);
check('apiBase: plain http is blocked by the https WebView scheme',
  reachableFromNativeShell('http://api.fbtswap.ir/api') === false);
check('apiBase: an absolute https origin IS reachable',
  reachableFromNativeShell('https://staging.example.com/api') === true);
check('apiBase: the canonical origin is reachable',
  reachableFromNativeShell('https://fbtswap.ir/api') === true);

/* Inside the shell with no usable override, the canonical origin must win —
   never '/api'. This is the single line that decides whether the APK can talk
   to the backend at all. */
const realWindow = globalThis.window;
try {
  globalThis.window = {
    Capacitor: { isNativePlatform: () => true },
    location: { hostname: 'localhost' }
  };
  const inApp = apiBase();
  check(`apiBase: inside the app it resolves to an absolute origin (${inApp})`,
    /^https:\/\/[^/]+\/api$/.test(inApp));
  check('apiBase: inside the app it is never the relative /api', inApp !== '/api');
} finally {
  if (realWindow === undefined) delete globalThis.window;
  else globalThis.window = realWindow;
}
check('apiBase: in a plain browser it stays same-origin',
  apiBase() === '/api' || /^https:\/\//.test(apiBase()));

/* ── 2. No module may re-invent the API base ────────────────────────────── */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(entry)) out.push(p);
  }
  return out;
}
const SRC = walk('src');
const openCoded = SRC.filter((f) => {
  if (f.endsWith('src/lib/apiBase.js')) return false;
  return /import\.meta\.env\?\.VITE_API_BASE/.test(code(f));
});
check(`no module open-codes VITE_API_BASE (found ${openCoded.length}${openCoded.length ? ': ' + openCoded.join(', ') : ''})`,
  openCoded.length === 0);

/* A literal '/api/…' used as a REQUEST url — either passed straight to a
   transport, or parked in a URL-named constant that a transport then reads.
   In the browser that is a same-origin call and looks fine; inside the APK it
   resolves against https://localhost and 404s.

   Deliberately narrower than "any /api/ string": two modules legitimately
   carry such literals as DATA — the developer docs endpoint table (rendered,
   with the origin prefixed on copy) and the AI tool registry's `route`
   descriptor field. Neither is fetched. */
const relativeApiFetch = SRC.filter((f) => {
  if (f.endsWith('src/lib/apiBase.js')) return false;
  const src = code(f);
  const passedToTransport =
    /(?:fetch|axios\.(?:get|post|put|delete|request))\s*\(\s*(?:[`'"]\/api\/|`\$\{[^}]*\}\/api\/)/.test(src);
  const urlNamedConstant =
    /(?:const|let|var)\s+[A-Za-z0-9_]*(?:URL|BASE|ENDPOINT|PATH)[A-Za-z0-9_]*\s*=\s*[`'"]\/api\//.test(src);
  return passedToTransport || urlNamedConstant;
});
check(`no module hardcodes a '/api/…' request URL (found ${relativeApiFetch.length}${relativeApiFetch.length ? ': ' + relativeApiFetch.join(', ') : ''})`,
  relativeApiFetch.length === 0);

/* ── 3. The LI.FI fee gate must not depend on which pipeline built us ───── */
const { verifyLifiFee, LIFI_INTEGRATOR } = await import('../src/lib/lifi.js');
const { PAYOUT_ADDRESSES, knownPayoutAddresses, isKnownPayoutAddress } = await import('../src/lib/payout.js');

const OURS = PAYOUT_ADDRESSES.evm;
const OTHER = '0x1111111111111111111111111111111111111111'; /* a valid address we do not own */
const FROM_WEI = 1_000_000_000_000_000_000n; /* 1.0 */
const FEE_BPS = 70;
const SHARE = (FROM_WEI * BigInt(FEE_BPS)) / 10000n;

/** A LI.FI quote body whose signed fee wallet is `wallet`. */
const lifiBody = (wallet, shareWei = SHARE) => ({
  integrator: LIFI_INTEGRATOR,
  fee: FEE_BPS / 10000,
  action: { fromAmount: String(FROM_WEI) },
  estimate: {
    feeCosts: [{
      feeSplit: {
        lifiFee: '2500000000000000',
        recipients: [{ name: LIFI_INTEGRATOR, fee: String(shareWei) }]
      }
    }]
  },
  includedSteps: [{
    action: {
      integratorFees: {
        recipients: [{ name: LIFI_INTEGRATOR, config: { defaultWallet: wallet } }]
      }
    }
  }]
});

check('payout: our own receiving address is recognised', isKnownPayoutAddress(OURS));
check('payout: a stranger\'s address is not', isKnownPayoutAddress(OTHER) === false);
check('payout: the known set is lower-cased and non-empty',
  knownPayoutAddresses().length > 0 && knownPayoutAddresses().every((a) => a === a.toLowerCase()));

/* THE REGRESSION. The build named one wallet (`feeReceiver`), the server
   attached another one of ours. Before the fix this was
   FEE_RECIPIENT_MISMATCH on every LI.FI quote — i.e. no swap on Mantle,
   Scroll or zkSync Era inside the app. */
const drifted = verifyLifiFee({
  body: lifiBody(OURS),
  feeBps: FEE_BPS,
  feeReceiver: '0x2222222222222222222222222222222222222222'
});
check(`lifi: a fee wallet that is OURS passes even when the build named a different one (${drifted.code ?? 'ok'})`,
  drifted.ok === true);

const exact = verifyLifiFee({ body: lifiBody(OURS), feeBps: FEE_BPS, feeReceiver: OURS });
check('lifi: the exact configured recipient still passes', exact.ok === true);

const stranger = verifyLifiFee({ body: lifiBody(OTHER), feeBps: FEE_BPS, feeReceiver: OURS });
check(`lifi: a fee wallet that is NOT ours is still refused (${stranger.code})`,
  stranger.ok === false && stranger.code === 'FEE_RECIPIENT_MISMATCH');

const shortShare = verifyLifiFee({
  body: lifiBody(OURS, SHARE / 2n),
  feeBps: FEE_BPS,
  feeReceiver: OURS
});
check(`lifi: a short fee share is still refused (${shortShare.code})`,
  shortShare.ok === false && shortShare.code === 'FEE_NOT_APPLIED');

const wrongIntegrator = verifyLifiFee({
  body: { ...lifiBody(OURS), integrator: 'someone-else' },
  feeBps: FEE_BPS,
  feeReceiver: OURS
});
check('lifi: a quote signed for another integrator is refused', wrongIntegrator.ok === false);

/* ── 4. A fee-gate failure must not be reported as "no pair" ────────────── */
const { classifyQuoteFailure } = await import('../src/lib/swap.js');
const err = (m, extra = {}) => Object.assign(new Error(m), extra);

check('classify: every source unreachable → QUOTE_NETWORK',
  classifyQuoteFailure({ failures: [err('AGG_TIMEOUT', { network: true })], answered: 0 }) === 'QUOTE_NETWORK');
check('classify: every source rejected by our own fee gate → QUOTE_FAILED, not NO_ROUTE',
  classifyQuoteFailure({
    failures: [err('FEE_RECIPIENT_MISMATCH'), err('FEE_NOT_APPLIED')],
    answered: 2
  }) === 'QUOTE_FAILED');
check('classify: a genuine no-route answer is still NO_ROUTE',
  classifyQuoteFailure({ failures: [err('NO_ROUTE')], answered: 2 }) === 'NO_ROUTE');
/* ── 2026-09-15, corrected ordering ──────────────────────────────────────────
 * A fee-gate rejection DOMINATES the verdict, it is not just one vote among
 * equals: FEE_RECIPIENT_MISMATCH on one source can only have happened because
 * that source produced a priced route which OUR gate then threw away — the
 * pair routed, full stop. Reporting NO_ROUTE tells the user the pair is
 * unroutable and sends them hunting token pairs, when nothing about the pair
 * is wrong. The pinned `.every` behaviour below did exactly that whenever a
 * fee rejection raced a concurrent dead-OpenOcean failure — the permanent
 * condition on the LI.FI-primary chains (zkSync/Scroll/Mantle) whose only other
 * source is OpenOcean. Now the honest answer is QUOTE_FAILED (retryable), and
 * «مسیری بین این دو توکن وجود ندارد» is reserved for the case where every
 * source that spoke genuinely could not route the pair. */
check('classify: a fee-gate rejection dominates a mixed failure set',
  classifyQuoteFailure({
    failures: [err('FEE_RECIPIENT_MISMATCH'), err('NO_ROUTE')],
    answered: 2
  }) === 'QUOTE_FAILED');
check('classify: a server-side fee rejection (HTTP 502 + code) is not misread as a network outage',
  classifyQuoteFailure({
    failures: [err('FEE_NOT_APPLIED', { network: true })],
    answered: 0
  }) === 'QUOTE_FAILED');

/* The five networks the report named must all still be LI.FI-routable. */
const { lifiSupports } = await import('../src/lib/lifi.js');
const REPORTED = [
  [143, 'Monad (MON)'],
  [324, 'zkSync Era (ZK)'],
  [534352, 'Scroll (SCR)'],
  [5000, 'Mantle (MNT)'],
  [4663, 'Robinhood Chain (HOOD)']
];
for (const [id, name] of REPORTED) {
  check(`routing: ${name} has a LI.FI quote path`, lifiSupports(id) === true);
}
const serverLifi = code('server/lifi.js');
for (const [id, name] of REPORTED) {
  check(`routing: the server proxy allowlists ${name} (${id})`,
    new RegExp(`SWAP_CHAIN_IDS = new Set\\(\\[[^\\]]*\\b${id}\\b`).test(serverLifi));
}

/* ── 5. The wallet network picker shows every network ───────────────────── */
const walletSrc = code('src/pages/Wallet.jsx');
check('wallet: the network picker no longer slices the registry to six',
  !/EVM_CHAIN_ORDER\.slice\(0,\s*6\)/.test(walletSrc));
// The portfolio hook resolves the full registry; the wallet paints its
// resulting rows. Looking for EVM_CHAIN_ORDER.map *inside Wallet.jsx* misses
// this legitimate split and fails even when every network is represented.
const portfolioSrc = code('src/hooks/useMultiChainPortfolio.js');
check('wallet: the network picker maps the whole registry',
  /portfolio\.chains/.test(walletSrc) && /chains\.map\(/.test(walletSrc)
  && /EVM_CHAIN_ORDER\.map\(/.test(portfolioSrc));
const { EVM_CHAIN_ORDER, EVM_CHAINS } = await import('../src/lib/chains.js');
check(`wallet: the registry holds ${EVM_CHAIN_ORDER.length} chains, all resolvable`,
  EVM_CHAIN_ORDER.length >= 16 && EVM_CHAIN_ORDER.every((id) => EVM_CHAINS[id]?.short));
for (const [id, name] of REPORTED) {
  check(`wallet: ${name} is in the picker's registry`, EVM_CHAIN_ORDER.includes(id));
}

/* ── 6. The futures page's tab rail and virtual-credit doorway ──────────── */
const perpSrc = code('src/pages/Perp.jsx');
const perpCss = code('src/styles/perp-modern.css');
check('perp: the rail renders an icon per venue', /TAB_ICON\s*=\s*\{[^}]*IconTrend[^}]*\}/.test(perpSrc));
check('perp: every tab in the rail has an icon',
  ['overview', 'dydx', 'onchain'].every((k) => new RegExp(`${k}:\\s*Icon`).test(perpSrc)));
check('perp: the rail is not the unstyled shared segmented control',
  !/className="segmented"/.test(perpSrc) && /className="perp-rail"/.test(perpSrc));
check('perp: the rail has a real tap height', /\.perp-rail-tab\s*\{[^}]*min-height:\s*4[4-9]px/.test(perpCss));
check('perp: the rail is styled outside the overview-only wrapper',
  /\.perp-rail\s*\{/.test(perpCss) && !/\.perp-modern \.perp-rail\s*\{/.test(perpCss));
check('perp: the virtual-credit doorway carries an icon', /perp-cta-ico/.test(perpSrc) && /\.perp-cta-ico\s*\{/.test(perpCss));
const perpCtaMinHeight = perpCss.match(/\.perp-cta\s*\{[^}]*min-height:\s*(\d+)px/);
check('perp: the virtual-credit doorway has a real minimum height',
  Number(perpCtaMinHeight?.[1]) >= 70);

export default results;

export function summary() {
  return {
    label: 'app ↔ site parity (api base · LI.FI fee · error taxonomy · networks)',
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
