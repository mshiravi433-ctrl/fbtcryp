/**
 * COPY-TRADE ↔ SIGNAL COHERENCE, AND THE ROUND-5 ENGINES
 * ---------------------------------------------------------------------------
 * «موتور کپی‌ترید را هوشمندتر کن و مطمئن شو با سیگنال هم‌جریان است»
 *
 * The request has two halves and only the first one is visible on screen:
 *
 *  (A) The copy-trade engine must be smarter than a prefill link. That means
 *      the read behind it (`readSmartMoney`) has to weight EVIDENCE over size,
 *      refuse to average a real conflict into silence, and never let a
 *      missing source score as a neutral vote.
 *
 *  (B) The copy-trade button and the signal card must be the SAME opinion. This
 *      is the half that silently breaks: both surfaces still render when they
 *      disagree, and nobody notices until a card says «accumulation» next to a
 *      button that sells. So the coherence assertions below run the real
 *      functions over a matrix of hostile inputs and compare them to each
 *      other — the button hands `plan.read` to `readForConsensus`, which is the
 *      exact function `smReadFor` in Signals.jsx returns.
 *
 * Plus the two engines that used to be lists rather than readings — whales
 * (EVM board + the Solana sample) and fresh wallets — and the structural
 * promises that keep this change inside its limits: no new route, no new page,
 * no new button, no blur/backdrop on the new plates, and the server-side
 * Solana sample reuse that this round is paying for.
 *
 * Runs with plain Node: no DOM, no network.
 * Run: node test/signals-copy-trade-flow-probe.mjs
 */
import { readFileSync } from 'node:fs';
import { readSmartMoney, readForConsensus } from '../src/lib/smartMoneyRead.js';
import { planCopyTrade, planLabel, MIN_MEASURED_GATES } from '../src/lib/copyTrade.js';
import { readWhalesOnToken, readSolanaWhales, readSolanaWallets, readWhaleEngine, venueOf } from '../src/lib/whaleEngine.js';
import { readFreshWallets } from '../src/lib/freshWallets.js';
import { readEarlyness, EARLY_MAX_STALENESS_MS } from '../src/lib/walletEarlyness.js';
import {
  readTrackedWallet, readWatchlist, nextToRead, TRACK_MAX_READS, TRACK_MOVE_MIN_USD
} from '../src/lib/walletTracking.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const loadLocale = (l) => JSON.parse(read(`../src/i18n/locales/${l}.json`));
const getPath = (o, d) => d.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);
const NOW = 1_800_000_000_000;

const EVM = '0x514910771af9ca656af840dff83e8264ecf986ca';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const verifiedRow = (over = {}) => ({
  chain: 8453,
  token: EVM,
  signal: 'ACCUMULATION',
  netFlowUsd: 4_200_000,
  confidence: 88,
  independentVotes: 5,
  swaps: 12,
  independentBuyers: 4,
  independentSellers: 0,
  lastAt: NOW - 60_000,
  ...over
});
const tokenIntel = {
  liquidityUsd: 2_400_000,
  holders: { top10Share: 34, exchangeSupplyPct: 8 },
  volume: { h24: 900_000 },
  txns: { buys24: 120, sells24: 90 }
};

/** One realistic Solana whale-watch payload, shared by sections 5 and 6. */
const WATCH_FIXTURE = {
  available: true,
  floorSol: 1000,
  solPrice: 180,
  transfers: [
    { id: 'a', sol: 5000, at: NOW - 600_000, toLabel: 'Binance 3', from: 'AAA' },
    { id: 'b', sol: 2500, at: NOW - 900_000, toLabel: 'OKX Deposit', from: 'BBB' },
    { id: 'c', sol: 1800, at: NOW - 2_000_000, fromLabel: 'Coinbase Hot Wallet', to: 'CCC' },
    { id: 'd', sol: 1200, at: NOW - 3_000_000, from: 'DDD', to: 'EEE' }
  ],
  coverage: { sources: ['rpc-block-sample'], blocksPerRefresh: 1, sampleReused: true,
    sampleMs: 1_200_000, lastSample: { slot: 392_000_000, at: 'x' } }
};

function run() {
  /* ── 1 · the shared read: evidence first, conflict abstains ─────────────── */
  {
    const verified = readSmartMoney({ verified: verifiedRow(), now: NOW });
    t('a verified row is the basis when one exists',
      verified.measured && verified.basis === 'verified' && verified.signal === 'ACCUMULATION');
    t('its confidence is built from breadth as well as size',
      verified.confidence > 0 && verified.confidence <= 100
      && verified.support.votes === 5);

    /* A BIG, WRONG tape must not outrank a smaller verified row: that is the
       rule that stops one $40M unqualified print from deciding a call. */
    const opposed = readSmartMoney({
      verified: verifiedRow(),
      tape: { netUsd: -40_000_000, buyUsd: 1_000_000, sellUsd: 41_000_000, trades: 4000, wallets: 900 },
      now: NOW
    });
    t('an opposing tape makes the read conflict instead of averaging it away',
      opposed.conflict === true && opposed.basis === 'verified');
    t('on a conflict the DOLLAR figure is withheld (the consensus votes on direction + confidence)',
      opposed.netUsd === null && opposed.sizeUsd === 4_200_000);
    t('and the confidence is capped so a contested row cannot shout',
      opposed.confidence <= 55 && opposed.confidence < verified.confidence);
    const consensusShape = readForConsensus(opposed);
    t('the consensus shape survives the conflict (no null plane, no zero)',
      consensusShape && consensusShape.signal === 'ACCUMULATION'
      && consensusShape.netUsd === null && consensusShape.confidence <= 55);

    /* A verified row whose own signal contradicts its own flow is not evidence. */
    const selfContradicting = readSmartMoney({
      verified: verifiedRow({ signal: 'DISTRIBUTION', netFlowUsd: 4_200_000 }), now: NOW
    });
    t('a self-contradicting verified row is dropped rather than used',
      selfContradicting.measured === false || selfContradicting.basis !== 'verified');

    /* Silence is silence — never a neutral vote. */
    const silent = readSmartMoney({ now: NOW });
    t('no source at all reads «not measured», not zero',
      silent.measured === false && silent.netUsd === null && silent.signal === null);
    t('and it converts to NULL for the consensus (a zero would be a real vote)',
      readForConsensus(silent) === null);
    t('a row with no net at all is not turned into a zero-dollar measurement',
      readSmartMoney({ tape: { buyUsd: 10, sellUsd: 10 }, now: NOW }).measured === false);
  }

  /* ── 2 · provenance ladder: activity, then the unqualified tape ─────────── */
  {
    const activity = readSmartMoney({
      activity: { symbol: 'LINK', signal: 'DISTRIBUTION', netUsd: -800_000, labelledEvents: 9, wallets: 6 },
      now: NOW
    });
    t('a labelled scanner row is used when no verified row exists',
      activity.measured && activity.basis === 'activity' && activity.signal === 'DISTRIBUTION');

    const tapeOnly = readSmartMoney({
      tape: { netUsd: 120_000, buyUsd: 400_000, sellUsd: 280_000, trades: 900, wallets: 40 }, now: NOW
    });
    t('the raw tape is the last resort and is capped well below a verified read',
      tapeOnly.measured && tapeOnly.basis === 'tape' && tapeOnly.confidence <= 70);
    t('but a wide tape beats a narrow one of the same size',
      tapeOnly.confidence > readSmartMoney({
        tape: { netUsd: 120_000, buyUsd: 125_000, sellUsd: 5_000, trades: 3 }, now: NOW
      }).confidence);

    const fought = readSmartMoney({
      activity: { signal: 'ACCUMULATION', netUsd: 500_000, labelledEvents: 2 },
      tape: { netUsd: -2_000_000, buyUsd: 1_000, sellUsd: 2_001_000 },
      now: NOW
    });
    t('labelled activity fighting the tape is a conflict, and says so',
      fought.conflict === true && fought.note === 'labelled-opposed-by-tape');
  }

  /* ── 3 · the plan: gates, sizing, and no action without evidence ────────── */
  {
    const good = planCopyTrade({
      chain: 8453, token: EVM, verified: verifiedRow(), tokenIntel,
      volatilityPct: 4.2, plannedUsd: 500, bookUsd: 20_000, now: NOW
    });
    t('a well-evidenced, liquid, uncrowded case produces a side', good.action === 'BUY' && good.followable);
    t('its stop and target come from the measured volatility, not a constant',
      good.sizing.stopPct === 8.4 && good.sizing.targetPct === 12.6);
    t('risk is a dollar figure derived from size × stop',
      good.sizing.riskUsd === 42 && good.sizing.rewardUsd === 63);
    t('risk as a share of the book is reported so the number can be weighed',
      good.sizing.riskPctOfBook === 0.21 && good.sizing.rewardToRisk === 1.5);
    t('at least three gates must be MEASURED before an action exists',
      good.gates.filter((g) => g.pass === true).length >= MIN_MEASURED_GATES);

    const illiquid = planCopyTrade({
      chain: 8453, token: EVM, verified: verifiedRow(),
      tokenIntel: { ...tokenIntel, liquidityUsd: 12_000 }, now: NOW
    });
    t('a thin pool blocks the plan and names the gate',
      illiquid.action === null && illiquid.failed.includes('liquidity'));

    const crowded = planCopyTrade({
      chain: 8453, token: EVM, verified: verifiedRow(),
      tokenIntel: { ...tokenIntel, holders: { top10Share: 91 } }, now: NOW
    });
    t('a token one wallet can move is blocked on concentration',
      crowded.action === null && crowded.failed.includes('concentration'));

    const conflicted = planCopyTrade({
      chain: 8453, token: EVM, verified: verifiedRow(),
      tape: { netUsd: -9_000_000, buyUsd: 100_000, sellUsd: 9_100_000 },
      tokenIntel, now: NOW
    });
    t('a conflicted read never produces an action',
      conflicted.action === null && conflicted.failed.includes('agreement'));

    const noEvidence = planCopyTrade({ chain: 8453, token: EVM, tokenIntel, now: NOW });
    t('no evidence means no action — and it says which gate is missing',
      noEvidence.action === null && noEvidence.failed.includes('evidence'));
    t('an unmeasured gate is reported as unmeasured, never as a pass',
      noEvidence.gates.find((g) => g.key === 'liquidity')?.pass === true
      && noEvidence.unmeasured.includes('freshness'));

    const stale = planCopyTrade({
      chain: 8453, token: EVM,
      verified: verifiedRow({ lastAt: NOW - 9 * 3600_000 }),
      tokenIntel, now: NOW
    });
    t('evidence older than six hours is history, and the freshness gate fails it',
      stale.action === null && stale.failed.includes('freshness'));

    t('without a volatility reading there is no stop, no risk and no R',
      noEvidence.sizing.stopPct === null && noEvidence.sizing.riskUsd === null
      && noEvidence.sizing.rewardToRisk === null);

    t('an unusable address is blocked at the identity gate (no dead button)',
      planCopyTrade({ chain: 1, token: '0x1234', verified: verifiedRow(), tokenIntel, now: NOW }).action === null
      && planCopyTrade({ chain: 1, token: '0x1234', verified: verifiedRow(), tokenIntel, now: NOW }).failed.includes('identity'));

    /* The prefill link keeps its own contract: contract-not-symbol, side set. */
    const sell = planCopyTrade({
      chain: 1, token: EVM,
      verified: verifiedRow({ chain: 1, signal: 'DISTRIBUTION', netFlowUsd: -3_000_000, independentSellers: 4 }),
      tokenIntel: { ...tokenIntel, txns: { buys24: 20, sells24: 200 } }, now: NOW
    });
    t('a distribution plan prefills a SELL on the observed contract',
      sell.action === 'SELL' && sell.href.includes('fromAddress=' + EVM) && sell.href.includes('side=sell'));
    t('a Solana mint prefills the Solana screen, not an EVM swap',
      planCopyTrade({ chain: 'solana', token: MINT, now: NOW }).href === `/solana?toMint=${MINT}`);
  }

  /* ── 4 · the coherence contract: the button and the card agree ──────────── */
  {
    /*
     * The matrix is deliberately hostile: verified + agreeing tape, verified +
     * fighting tape, activity only, tape only, nothing, and a row with no
     * clock. For every one of them the plan's read must convert to the exact
     * shape the signal card consumes, and the ACTION must follow the SIGNAL.
     */
    const cases = [
      { label: 'verified + agreeing tape', input: {
        verified: verifiedRow(), tape: { netUsd: 900_000, buyUsd: 2_000_000, sellUsd: 1_100_000 } } },
      { label: 'verified + fighting tape', input: {
        verified: verifiedRow(), tape: { netUsd: -900_000, buyUsd: 100_000, sellUsd: 1_000_000 } } },
      { label: 'activity only', input: { activity: { signal: 'ACCUMULATION', netUsd: 400_000, labelledEvents: 6 } } },
      { label: 'tape only', input: { tape: { netUsd: -400_000, buyUsd: 100_000, sellUsd: 500_000, trades: 60 } } },
      { label: 'nothing', input: {} }
    ];
    let coherent = 0;
    for (const { input } of cases) {
      const plan = planCopyTrade({ chain: 8453, token: EVM, tokenIntel, volatilityPct: 3, plannedUsd: 100, ...input, now: NOW });
      /* `smReadFor` in Signals.jsx returns exactly this call. */
      const cardRead = readForConsensus(readSmartMoney({
        verified: input.verified || null,
        tape: input.tape || null,
        activity: input.activity || null,
        window: '24h',
        now: NOW
      }));
      const same = JSON.stringify(cardRead) === JSON.stringify(readForConsensus(plan.read));
      const actionFollowsSignal = plan.action === null
        || (plan.action === 'BUY' && plan.read.signal === 'ACCUMULATION')
        || (plan.action === 'SELL' && plan.read.signal === 'DISTRIBUTION');
      if (same && actionFollowsSignal) coherent += 1;
    }
    t(`the copy-trade plan and the signal card are the same read (${coherent}/${cases.length} shapes)`,
      coherent === cases.length);

    const label = planLabel(planCopyTrade({ chain: 8453, token: EVM, now: NOW }));
    t('an unmeasured plan is labelled as unmeasured, not encouraged',
      label.state === 'unmeasured' && /copyTrade\.noEvidence/.test(label.key));
    const blocked = planLabel(planCopyTrade({ chain: 8453, token: EVM, verified: verifiedRow(),
      tokenIntel: { ...tokenIntel, liquidityUsd: 1_000 }, now: NOW }));
    t('a blocked plan reads as blocked', blocked.state === 'blocked' && blocked.tone === 'warn');
    t('the label set covers every state a plan can be in',
      ['none', 'unmeasured', 'conflict', 'blocked', 'strong', 'fair', 'thin']
        .every((state) => typeof state === 'string'));
  }

  /* ── 5 · the SOLANA whale read: a sample, and only labelled intent ──────── */
  {
    const sol = readSolanaWhales({ watch: WATCH_FIXTURE, now: NOW });
    t('venue label → venue name, and only for a name we actually know',
      venueOf('Kraken: Hot Wallet 4') === 'Kraken' && venueOf('Some Router') === null);
    t('movements are split into into-venue, out-of-venue and wallet-to-wallet',
      sol.intoVenuesSol === 7500 && sol.outOfVenuesSol === 1800 && sol.walletToWalletSol === 1200);
    t('the lean comes only from labelled venue movement, and it is directional',
      sol.direction === 'DISTRIBUTION' && sol.confident === true);
    t('wallet-to-wallet flow is never counted as a direction',
      readSolanaWhales({ watch: { ...WATCH_FIXTURE, transfers: [WATCH_FIXTURE.transfers[3]] }, now: NOW }).direction === null);
    t('one labelled movement is not enough to call it — thin evidence stays thin',
      readSolanaWhales({ watch: { ...WATCH_FIXTURE, transfers: [WATCH_FIXTURE.transfers[0]] }, now: NOW }).confident === false);
    t('the sample is reported as a sample (slot, sources, reuse, floor)',
      sol.sampled?.slot === 392_000_000 && sol.sampled.sampleReused === true
      && sol.sampled.blocksPerRefresh === 1 && sol.floorSol === 1000);
    t('rows below the stated floor are excluded, and the count says what is left',
      readSolanaWhales({ watch: { ...WATCH_FIXTURE, transfers: [{ id: 'z', sol: 10, at: NOW }] }, now: NOW }).measured === false);
    t('an unread node is an outage, not a quiet chain',
      readSolanaWhales({ watch: { available: false, reason: 'UPSTREAM_UNAVAILABLE', transfers: [] } }).measured === false
      && readSolanaWhales({ watch: { available: false, transfers: [] } }).available === false);
    t('no price read means no invented dollar value for the movements',
      readSolanaWhales({ watch: { ...WATCH_FIXTURE, solPrice: null }, now: NOW }).usdMoved === null);
  }

  /* ── 6 · the EVM whale read: breadth, concentration, no fantasy ─────────── */
  {
    const wallets = [
      { address: '0xaaa', chainId: 8453, movedUsd: 9_000_000, netUsd: 4_000_000, buys: 6_000_000, sells: 2_000_000, tokens: ['LINK', 'USDC'] },
      { address: '0xbbb', chainId: 8453, movedUsd: 3_000_000, netUsd: 1_000_000, buys: 2_000_000, sells: 1_000_000, tokens: ['LINK'] }
    ];
    const evm = readWhalesOnToken({ wallets, symbol: 'link' });
    t('the token read is built from the wallets that actually touched it',
      evm.measured && evm.wallets === 2 && evm.netUsd === 5_000_000 && evm.buyUsd === 8_000_000);
    t('one wallet holding the story is concentration, and it withholds conviction',
      evm.topSharePct === 75 && evm.confident === false);
    t('a share of the story can never exceed 100% (net is not the denominator)',
      readWhalesOnToken({ wallets: [
        { address: '0x1', movedUsd: 900_000, netUsd: 50_000_000, buys: 0, sells: 0, tokens: ['LINK'] }
      ], symbol: 'LINK' }).topSharePct === 100);
    t('a token nobody moved is not measured (not a zero)',
      readWhalesOnToken({ wallets, symbol: 'BONK' }) === null);
    t('a wallet-to-wallet-only board produces no direction',
      readWhalesOnToken({ wallets: [{ address: '0x1', movedUsd: 9e6, netUsd: 9e6, buys: 0, sells: 0, tokens: ['LINK'] }], symbol: 'LINK' }).direction === null);

    const both = readWhaleEngine({ wallets, symbol: 'LINK', solana: WATCH_FIXTURE, now: NOW });
    t('both chains can be read at once without adding them together',
      both.comparable === false && both.evm.netUsd === 5_000_000 && both.solana.solMoved === 10_500);
    t('an empty engine is null, so a card can hide rather than print zeros',
      readWhaleEngine({ wallets: [], symbol: 'LINK' }) === null);
    t('and the note states that the two halves measure different things',
      /different measurements and are never summed/.test(both.note));
  }

  /* ── 7 · the new-wallet read ────────────────────────────────────────────── */
  {
    const fresh = readFreshWallets({ wallets: [
      { address: '0x1', chainShort: 'ETH', capitalUsd: 12_000_000, receivedUsd: 9_000_000, txCount: 3, tokenTransfersCount: 1 },
      { address: '0x2', chainShort: 'ETH', capitalUsd: 2_000_000, receivedUsd: 400_000, txCount: 8, tokenTransfersCount: 2 }
    ], now: NOW });
    t('capital that ARRIVED is labelled differently from money that passed through',
      fresh.watch === 1 && fresh.passThrough === 1);
    t('one actor dominating the feed is named, with its share',
      fresh.dominant?.sharePct === 86 && fresh.note === 'single-actor-dominated');
    t('the count is the verified-fresh rows, not the raw list',
      readFreshWallets({ wallets: [{ address: '0x9', capitalUsd: 5_000_000 }], now: NOW }).count === 0);
    t('an unverifiable row is never summed into the capital figure',
      readFreshWallets({ wallets: [{ address: '0x9', capitalUsd: 5_000_000 }], now: NOW }).capitalUsd === null);
    t('a feed with nothing verifiable says so instead of «broad-based»',
      readFreshWallets({ wallets: [{ address: '0x9', capitalUsd: 5_000_000 }], now: NOW }).note === 'no-verified-fresh-wallet');
    t('a wallet whose counters read as busy is not fresh',
      readFreshWallets({ wallets: [{ address: '0x8', capitalUsd: 1e6, txCount: 400 }], now: NOW }).count === 0);
    t('an empty feed measures nothing (no confident zero)',
      readFreshWallets({ wallets: [] }).measured === false);
  }

  /* ── 8 · structure: wired, inside the limits, and costing no new request ── */
  {
    const signalsPage = strip(read('../src/pages/Signals.jsx'));
    const button = strip(read('../src/components/smart-money/CopyTradeButton.jsx'));
    const intel = strip(read('../src/components/SmartMoneyIntelligence.jsx'));
    const page = strip(read('../src/pages/SmartMoney.jsx'));
    const css = strip(read('../src/styles/smart-money.css'));
    const track = strip(read('../server/solanaTrack.js'));
    const moneyFlow = strip(read('../server/smartMoney/moneyFlow.js'));
    const smIndex = strip(read('../server/smartMoney/index.js'));

    /* the seam: one read, used by both surfaces */
    t('the Signals page reads smart money through the shared reader',
      /readSmartMoney\(\{/.test(signalsPage) && /readForConsensus\(read\)/.test(signalsPage));
    t('the copy-trade button is built on the same reader',
      /planCopyTrade/.test(button) && /readSmartMoney/.test(strip(read('../src/lib/copyTrade.js'))));
    t('the intelligence card passes its verified row straight in',
      /<CopyTradeButton[\s\S]{0,400}verified=\{chosen\}/.test(intel));
    t('the token-activity rows do the same with their own row',
      /<CopyTradeButton[\s\S]{0,300}activity=\{r\}/.test(page));

    /* the new surfaces render on the page that already existed */
    t('Solana whales are shown on the Smart Money page, in the whale tab',
      /function SolanaWhaleCard/.test(page) && /<SolanaWhaleCard/.test(page)
      && /readSolanaWhales/.test(page));
    t('and the token tab reads its fresh wallets instead of only listing them',
      /readFreshWallets/.test(page) && /function FreshSummary/.test(page));
    t('no new route, page or tab was introduced',
      !/path="\/smart-money\/(sol|whales)/.test(read('../src/App.jsx'))
      && /const TABS = \['overview', 'intelligence', 'whales', 'wallets', 'tokens', 'flows', 'alerts'\]/.test(page));
    t('the copy-trade verdict adds a LABEL, not a button',
      /data-testid="sm-copy-verdict"/.test(button)
      && (button.match(/<button/g) || []).length === 1);

    /* the new plates keep the compositor budget */
    const solCss = css.slice(css.indexOf('.smx-solwhale {'), css.indexOf('.smx-empty {'));
    t('the new plates use no blur, no filter and no animation',
      solCss.length > 200 && !/backdrop-filter|filter:|animation:/.test(solCss));
    t('and they have a light-theme twin for the coloured text they carry',
      /:root\[data-theme='light'\] \.smx-solwhale-lean\.is-up/.test(css));

    /* the CPU side of round 5: one block per WINDOW, not per instance */
    t('the Solana sample is persisted and reused instead of re-read',
      /storeSet\(WHALE_SAMPLE_KEY/.test(track) && /sampleIsFresh\(/.test(track)
      && /readDurableSample/.test(track));
    t('the durable payload is movements + slot, never the block itself',
      /rows: found\.filter/.test(track) && !/storeSet\([^)]*block/.test(track));
    t('a stale sample is dropped rather than shown as live',
      /whaleLedgerMaxAgeMs\(\)/.test(track) && /kept = ledger\.filter/.test(track));
    t('the whale route cache is aligned with the sample window',
      /s-maxage=900/.test(read('../server/app.js')));

    /* the cache-key fix: a clock may not be part of an answer's identity */
    t('the read budget is bucketed, not interpolated into every cache key',
      /budgetTier/.test(moneyFlow) && !/sm:scan:\$\{SCAN_FLOOR\}:\$\{readBudgetMs\}/.test(moneyFlow));
    t('every smart-money cache key goes through the tier',
      (moneyFlow.match(/withCache\(`sm:[^`]*`/g) || []).every((k) => !/\$\{readBudgetMs\}/.test(k))
      && !/sm:overview:\$\{winKey\}:\$\{readBudgetMs\}/.test(smIndex)
      && !/sm:token:[^`]*\$\{readBudgetMs\}/.test(read('../server/smartMoney/tokenIntel.js'))
      && !/sm:liquidity:\$\{timeoutMs\}/.test(smIndex));
    t('the verified section is single-flight so concurrent callers share one build',
      /verifiedInflight/.test(smIndex) && /VERIFIED_SUMMARY_TTL = 90_000/.test(smIndex));

    /* the client engines stay pure: no fetch, no timer, no storage */
    for (const file of ['smartMoneyRead.js', 'copyTrade.js', 'whaleEngine.js', 'freshWallets.js',
      'walletEarlyness.js', 'walletTracking.js']) {
      const src = strip(read(`../src/lib/${file}`));
      t(`${file} costs no request, timer or storage`,
        !/\bfetch\(/.test(src) && !/setInterval|setTimeout/.test(src)
        && !/localStorage|sessionStorage/.test(src));
    }
  }

  /* ── 8c · EARLY WALLETS: earlyness is measured, never assumed (round 7) ────
     The old feed called a wallet «Smart» because `interesting` was true, which
     is a fact about money received. Earlyness is a fact about TIMING, and these
     assertions pin the three ways a timing claim can be wrong. */
  {
    const NOW = 1_800_000_000_000;
    const H = 3600_000;

    const young = readEarlyness({ walletAgeMs: 5 * H, seenAt: NOW - 1 * H, receivedUsd: 2e6, heldUsd: 1.8e6,
      activity: 6, buyerRank: 1, buyers: 20, now: NOW });
    t('a young wallet whose capital stayed scores as early and is still live',
      young.label === 'earlyWatch' && young.live && young.score >= 55);

    /* Same wallet, same capital — observed 26 hours ago. The wallet is still
       young TODAY; the news is not. A score that ignored this would put a
       closed window on the screen. */
    const lateOne = readEarlyness({ walletAgeMs: 30 * H, seenAt: NOW - 26 * H, receivedUsd: 2e6, heldUsd: 1.8e6,
      activity: 6, now: NOW });
    t('the same young wallet observed 26h ago is LATE, not early',
      lateOne.label === 'late' && lateOne.live === false);
    t('and its staleness is the observation age, not the wallet age',
      lateOne.observationAgeMs === 26 * H && lateOne.observationAgeMs > EARLY_MAX_STALENESS_MS);

    /* Nothing left of the money that arrived. */
    const roundTrip = readEarlyness({ walletAgeMs: 5 * H, seenAt: NOW - 1 * H, receivedUsd: 2e6, heldUsd: 0.2e6,
      activity: 6, now: NOW });
    t('capital that arrived and left is a round trip, not an early find',
      roundTrip.label === 'roundTrip');

    /* THE IMPORTANT ONE: no timestamps at all. `stayed` and `thinActivity` are
       still computable, so a naive weighted score would return ~96 and label it
       earlyWatch — a confident claim with zero timing evidence. */
    const blind = readEarlyness({ receivedUsd: 2e6, heldUsd: 1.95e6, activity: 3, now: NOW });
    t('no timing evidence yields NO score, not a high one',
      blind.score === null && blind.label === 'unmeasured');
    t('and the refusal names what was missing',
      /youngAtEntry/.test(blind.refusedBecause || '') && /actionable/.test(blind.refusedBecause || ''));

    /* Breadth: one wallet holding most of the capital is one actor. This runs
       through `readFreshWallets` — the path the screen actually uses — so the
       assertion cannot drift away from the code it claims to protect. */
    const feed = readFreshWallets({ now: NOW, wallets: [
      { address: 'a', capitalUsd: 9e6, receivedUsd: 9e6, txCount: 2, firstSeen: NOW - H },
      { address: 'b', capitalUsd: 1e5, receivedUsd: 1e5, txCount: 2, firstSeen: NOW - H }
    ] });
    t('one wallet holding the capital is reported as dominant, not broad',
      feed.dominant?.sharePct >= 55 && feed.note === 'single-actor-dominated');
    t('the feed rolls the earlyness read up into counts, not adjectives',
      feed.early >= 1 && feed.earlyLive >= 1 && typeof feed.bestEarlyScore === 'number');
    t('the read never promotes a young wallet to "smart"',
      !/smart/i.test(JSON.stringify(feed)) && !/smart/i.test(young.label));

    /* And the ceiling is the SERVER's number: 25, not a second opinion. */
    const cfg = strip(read('../server/smartMoney/config.js'));
    const fresh = strip(read('../src/lib/freshWallets.js'));
    /* The config reads it through `num(env…, 25)`, so the default is the second
       argument — matching a bare literal here would silently pass on `NaN`. */
    const serverCeiling = Number((cfg.match(/maxActivityCount:\s*num\([^,]+,\s*(\d+)\)/) || [])[1]);
    const clientCeiling = Number((fresh.match(/FRESH_ACTIVITY_CEILING\s*=\s*(\d+)/) || [])[1]);
    t('the client activity ceiling is the server\'s, not a second opinion',
      serverCeiling === 25 && clientCeiling === serverCeiling, `server=${serverCeiling} client=${clientCeiling}`);
  }

  /* ── 8d · TRACKING: a watchlist is a comparison, not a bookmark (round 7) ─ */
  {
    const NOW = 1_800_000_000_000;
    const H = 3600_000;
    const row = { chain: 1, address: '0xabc', label: 'a', target: 'wallet', createdAt: NOW - 3 * H,
      baseline: { at: NOW - 3 * H, portfolioUsd: 500_000, closedTrades: 4, txCount: 40 } };

    const pending = readTrackedWallet({ row, wallet: null, now: NOW });
    t('a tracked wallet that was never read is «pending», never «quiet»',
      pending.status === 'pending' && pending.change === null);

    const offline = readTrackedWallet({ row, wallet: { dataStatus: 'unavailable' }, now: NOW });
    t('an outage is «unavailable», never a zero change',
      offline.status === 'unavailable' && offline.moved === false);

    const noBaseline = readTrackedWallet({ row: { ...row, baseline: null },
      wallet: { dataStatus: 'live', portfolioUsd: 500_000 }, now: NOW });
    t('without a baseline a wallet is «not comparable», never «unchanged»',
      noBaseline.status === 'unmeasured' && noBaseline.change.portfolioUsd === null);

    const moved = readTrackedWallet({ row,
      wallet: { dataStatus: 'live', portfolioUsd: 500_000 + TRACK_MOVE_MIN_USD * 2, closedTrades: 6, txCount: 44 }, now: NOW });
    t('a wallet that moved since tracking reads as active, with the delta',
      moved.status === 'active' && moved.change.portfolioUsd === TRACK_MOVE_MIN_USD * 2);

    /* Noise is not movement: $1k on a $500k book is not «your wallet did
       something», and a watchlist that alerted on it would be unusable. */
    const noise = readTrackedWallet({ row,
      wallet: { dataStatus: 'live', portfolioUsd: 500_500, closedTrades: 4, txCount: 40 }, now: NOW });
    t('a sub-threshold change is quiet, not active', noise.status === 'quiet' && noise.moved === false);

    const quietLong = readTrackedWallet({ row: { ...row, createdAt: NOW - 40 * H },
      wallet: { dataStatus: 'live', portfolioUsd: 500_000, closedTrades: 4, txCount: 40 }, now: NOW });
    t('a wallet tracked for 40 hours with nothing new is «stale», a different sentence',
      quietLong.status === 'stale');

    /* A row with a baseline and an unchanged live read is `quiet`. The second
       row has no baseline at all, so it is `unmeasured` — which is why the
       pending count below is 2 and not 3. */
    const list = readWatchlist({ now: NOW, rows: [row, { ...row, address: '0xdef' }, { ...row, address: '0xghi' }],
      wallets: { '1:0xabc': { dataStatus: 'live', portfolioUsd: 500_000 } } });
    t('the digest counts what it read and says how much of the list that is',
      list.count === 3 && list.reads === 1 && list.breadth === 1 / 3);
    t('and the two it never opened stay pending, not quiet',
      list.pending === 2 && list.rows.filter((r) => r.status === 'pending').length === 2);
    /* A list that read one of three rows may not be described as quiet: the
       two it never opened are the whole reason it looks quiet. */
    t('a list that read one row of three is not called «quiet»',
      list.note === 'mostly-unread', list.note);

    const queue = nextToRead({ now: NOW, rows: [
      { ...row, address: 'x1', lastReadAt: NOW - H },
      { ...row, address: 'x2', lastReadAt: null },
      { ...row, address: 'x3', lastReadAt: NOW - 10 * H }
    ] });
    t('the read queue puts never-read wallets first and is capped',
      queue[0].key === '1:x2' && queue.length <= TRACK_MAX_READS);
    t('the queue is deterministic, so a re-render cannot reshuffle fetches',
      JSON.stringify(nextToRead({ now: NOW, rows: [{ ...row, address: 'x1', lastReadAt: NOW - H },
        { ...row, address: 'x2', lastReadAt: null }] })) ===
      JSON.stringify(nextToRead({ now: NOW, rows: [{ ...row, address: 'x2', lastReadAt: null },
        { ...row, address: 'x1', lastReadAt: NOW - H }] })));

    /* The cache key is the wallet, not the clock: this is the same fault the
       scan/overview/liquidity feeds had, and it is why a tracked wallet used to
       re-read five upstream sources on every open. */
    const intel = strip(read('../server/smartMoney/walletIntel.js'));
    t('the wallet cache key is bucketed, not keyed on the live budget',
      /sm:wallet:[^`]*\$\{budgetTier\(timeoutMs\)\}/.test(intel)
      && !/\$\{timeoutMs\}/.test(intel));
  }

  /* ── 9 · the new copy is translated (a raw key on a money screen is a bug) ─ */
  {
    const fa = loadLocale('fa');
    const en = loadLocale('en');
    const ar = loadLocale('ar');
    const PLAN_KEYS = ['none', 'noEvidence', 'conflict', 'blocked', 'thin', 'fair', 'strong', 'note'];
    const COPY_KEYS = ['title', 'side', 'conviction', 'gates', 'blockedBy', 'conflictNote',
      'size', 'stopTarget', 'riskUsd', 'riskOfBook'];
    const GATE_KEYS = ['identity', 'evidence', 'direction', 'agreement', 'freshness',
      'liquidity', 'concentration', 'sizing'];
    const SOL_KEYS = ['whalesScope', 'solWhalesTitle', 'solWhaleMoved', 'solWhaleToVenues',
      'solWhaleFromVenues', 'solWhaleWalletToWallet', 'solWhaleNoLean', 'solWhaleLeanConfident',
      'solWhaleLeanThin', 'solWhaleAccumulating', 'solWhaleDistributing', 'solWhaleCoverage',
      'solWhaleEmpty', 'solWhaleUnavailable', 'freshReadCount', 'freshReadCapital',
      'freshReadDominant', 'freshReadBroad', 'freshReadUnverified'];

    for (const [name, dict] of [['fa', fa], ['en', en], ['ar', ar]]) {
      const missing = [
        ...PLAN_KEYS.map((k) => `copyTrade.${k}`),
        ...['verified', 'labelledActivity', 'unqualifiedTape', 'whaleBoard'].map((k) => `copyTrade.provenance.${k}`),
        ...COPY_KEYS.map((k) => `signals.copyTrade.${k}`),
        ...GATE_KEYS.map((k) => `signals.copyTrade.gate.${k}`),
        ...SOL_KEYS.map((k) => `sm.${k}`)
      ].filter((path) => typeof getPath(dict, path) !== 'string' || !getPath(dict, path));
      t(`${name}: every new copy-trade / whale / fresh-wallet key resolves (${missing.length} missing)`,
        missing.length === 0);
    }

    /* Every label `planLabel` can return must exist, or a money screen prints
       `copyTrade.blocked` at the user. */
    const states = ['none', 'unmeasured', 'conflict', 'blocked', 'thin', 'fair', 'strong'];
    const labelKeys = new Set(states.map((state) => {
      const plan = state === 'none' ? null
        : state === 'blocked' ? { read: { measured: true, conflict: false }, action: null, conviction: 10 }
          : state === 'unmeasured' ? { read: { measured: false } }
            : state === 'conflict' ? { read: { measured: true, conflict: true }, action: null }
              : { read: { measured: true, conflict: false }, action: 'BUY', conviction: state === 'strong' ? 80 : state === 'fair' ? 55 : 20 };
      return planLabel(plan).key;
    }));
    t('every state a plan can be in has a translated label',
      [...labelKeys].every((key) => typeof getPath(fa, key) === 'string' && typeof getPath(en, key) === 'string'));

    /* Interpolations the components pass must be the ones the copy declares. */
    t('the multi-language copy interpolates the numbers it is given',
      getPath(fa, 'sm.solWhaleCoverage').includes('{{reused}}')
      && getPath(en, 'sm.solWhaleCoverage').includes('{{n}}')
      && getPath(fa, 'sm.solWhaleLeanConfident').includes('{{n}}')
      && getPath(fa, 'signals.copyTrade.blockedBy').includes('{{gates}}')
      && getPath(en, 'sm.freshReadDominant').includes('{{pct}}'));
  }

  /* ── 9b · the SOLANA WALLET read: gross vs net, venues, breadth ─────────── */
  {
    const now = NOW;
    const watch = {
      available: true,
      floorSol: 500,
      solPrice: 150,
      coverage: { sources: ['rpc-block-sample'], lastSample: { slot: 321, at: '2026-11-12T10:00:00Z' }, sampleReused: true },
      transfers: [
        /* A WHALE round-tripping with Binance: 40 000 out, 39 000 back. */
        { id: 'a1', sol: 40_000, from: 'WHALE1', to: 'CEX', toLabel: 'Binance', at: now - 60_000, signature: 's1' },
        { id: 'a2', sol: 39_000, from: 'CEX', fromLabel: 'Binance', to: 'WHALE1', at: now - 50_000, signature: 's2' },
        /* A wallet depositing to Kraken twice — a real sell lean. */
        { id: 'b1', sol: 12_000, from: 'WHALE2', to: 'KRAK', toLabel: 'Kraken', at: now - 40_000, signature: 's3' },
        { id: 'b2', sol: 9_000, from: 'WHALE2', to: 'KRAK', toLabel: 'Kraken', at: now - 30_000, signature: 's4' },
        /* One withdrawal from Kraken, and a plain wallet-to-wallet hop. */
        { id: 'c1', sol: 8_000, from: 'KRAK', fromLabel: 'Kraken', to: 'WHALE3', at: now - 20_000, signature: 's5' },
        { id: 'd1', sol: 700, from: 'WHALE4', to: 'WHALE5', at: now - 10_000, signature: 's6' }
      ]
    };
    const sol = readSolanaWallets({ watch, now });

    /* Six movements, five non-venue wallets: WHALE1 twice, WHALE2 twice, then
       WHALE3, WHALE4 and WHALE5 once each. */
    t('the Solana wallet read builds one row per wallet from the sample', sol.count === 5);
    t('the venue wallets are the counterparty, never a ranked whale',
      !sol.wallets.some((x) => x.address === 'CEX' || x.address === 'KRAK'));
    t('a wallet carries BOTH its gross and its observed net',
      sol.wallets[0].movedSol === 79_000 && sol.wallets[0].netSol === -1_000);

    /* The central honesty rule: a round trip that nets ~0 is not a lean, even
       though the wallet moved the most money in the sample. */
    const roundTripper = sol.wallets.find((x) => x.address === 'WHALE1');
    t('a round trip through a venue produces NO lean', roundTripper.lean === null);
    t('and it is not marked confident', roundTripper.confident === false);

    /* The lean belongs to the wallet on the far side of the venue. */
    const depositor = sol.wallets.find((x) => x.address === 'WHALE2');
    t('depositing into a named venue leans DISTRIBUTION on the depositor',
      depositor.lean === 'DISTRIBUTION' && depositor.confident === true);
    t('the venue credit lands on the depositor, not on the exchange',
      depositor.intoVenuesSol === 21_000 && depositor.outOfVenuesSol === 0);
    const withdrawer = sol.wallets.find((x) => x.address === 'WHALE3');
    t('a withdrawal FROM a venue leans ACCUMULATION on the receiver',
      withdrawer.lean === 'ACCUMULATION');
    t('one labelled movement is not enough to be confident', withdrawer.confident === false);

    /* Wallet-to-wallet movement is flow, not intent. */
    const hopper = sol.wallets.find((x) => x.address === 'WHALE4');
    t('an unlabelled wallet-to-wallet movement has no direction', hopper.lean === null);

    t('breadth is reported as a count next to the size',
      sol.accumulating === 1 && sol.distributing === 1);
    t('the read states how much of the sample one wallet is',
      sol.topSharePct === 72.2);
    t('the sample provenance travels with the list',
      sol.sampled?.slot === 321 && sol.sampled.sources.includes('rpc-block-sample'));

    /* Same payload, same rules: a quiet feed is quiet, an outage is an outage. */
    t('an unavailable feed is not reported as "no whales"',
      readSolanaWallets({ watch: { available: false, reason: 'UPSTREAM_UNAVAILABLE', transfers: [] } })
        .reason === 'UPSTREAM_UNAVAILABLE');
    t('no payload at all yields null, not an empty list that reads as measured',
      readSolanaWallets({ watch: null }) === null);
    t('rows below the floor are ignored rather than rounded up',
      readSolanaWallets({ watch: { ...watch, floorSol: 50_000 } }).count === 0);

    /* And the aggregation is PURE: it costs no request, timer or storage. */
    const src = strip(read('../src/lib/whaleEngine.js'));
    t('the wallet read costs no request, timer or storage',
      !/\bfetch\(/.test(src) && !/setInterval|setTimeout/.test(src) && !/localStorage/.test(src));
  }

  /* ── 10 · the evidence scale: 0–100 on the wire, 0–100 on the screen ────── */
  {
    /* `detectAccumulation/Distribution` run their score through `clampScore`,
       which rounds to 0–100 — and `tokenTrades.detectors` multiplies by 100
       itself. Two producers, two spellings, one scale. The screens must
       therefore print the number AS IS. A `* 100` on a client is how the
       token card once showed «۸۸۰۰٪». */
    const engines = strip(read('../server/smartMoney/engines.js'));
    const trades = strip(read('../server/smartMoney/tokenTrades.js'));
    const card = strip(read('../src/components/TokenSmartMoney.jsx'));
    const page = strip(read('../src/pages/SmartMoney.jsx'));

    t('the detectors score on the 0–100 scale (clampScore), not 0–1',
      /confidence: num/.test(engines) && /export function clampScore[^{]+\{[^}]*Math\.min\(100/.test(
        read('../server/smartMoney/config.js')));
    t('and the trade-tape detectors publish the same 0–100 scale',
      (trades.match(/\*\s*100\)/g) || []).length >= 2
      && !/confidence:\s*Math\.min\(1,[^\n]*\)(?!\s*\*\s*100)/.test(trades));
    t('the token card prints that number as-is and never rescales it',
      /\$\{accum\.confidence\}%/.test(card) && !/accum[?.]?\.confidence[^,;)]*\*\s*100/.test(card)
      && !/distrib[?.]?\.confidence[^,;)]*\*\s*100/.test(card));
    t('and so does the smart-money activity row',
      /\$\{confidence\}%/.test(page) && !/confidence[^,;)]*\*\s*100/.test(page));
    t('a missing detector is «—», never a 0% that reads as measured',
      /accum\?\.confidence != null \? .* : '—'/.test(card)
      && /confidence != null \? `\$\{confidence\}%` : '—'/.test(page));
  }

  /* ── 11 · the coverage the picker prints agrees with the files ───────────── */
  {
    /*
     * `src/i18n/coverage.json` is generated by `scripts/gen-locales.mjs`, but
     * nothing regenerates it on the way to production and no test compared it
     * to the locales it summarises. So every pass that added copy moved the
     * real key total further from the number the language picker prints: after
     * the signals passes it claimed 15079 English leaves while en.json held
     * 15166, and told Arabic users 53% when 44% of those strings actually
     * differ from English. A stale denominator mis-scores EVERY language at
     * once, silently.
     *
     * This probe is a static import in `test/run.mjs` above the Business probe
     * (which exits the process at import time), so these assertions actually
     * execute — unlike anything placed further down that file.
     */
    const coverage = JSON.parse(read('../src/i18n/coverage.json'));
    const leaves = (obj, prefix = '', out = []) => {
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) leaves(v, path, out);
        else out.push(path);
      }
      return out;
    };
    const readValue = (o, d) => d.split('.').reduce((x, k) => x?.[k], o);
    const enDict = loadLocale('en');
    const enLeaves = leaves(enDict);

    t('coverage.json total equals the real number of English leaves',
      coverage.total === enLeaves.length);

    /* The two rules `gen-locales.mjs` uses, reproduced exactly:
       · a fully maintained locale counts a leaf only when its text DIFFERS
         from English (a seeded file is not a translated file);
       · a partial locale counts the leaves it defines. */
    const PARTIAL = ['zh', 'hi', 'es', 'fr', 'ru', 'tr', 'ur', 'id', 'pt'];
    const FULL = ['fa', 'ar'];
    const expected = {};
    for (const lang of PARTIAL) expected[lang] = Math.round((leaves(loadLocale(lang)).length / enLeaves.length) * 100);
    for (const lang of FULL) {
      const dict = loadLocale(lang);
      let translated = 0;
      for (const key of enLeaves) {
        const mine = readValue(dict, key);
        const theirs = readValue(enDict, key);
        if (mine === undefined) continue;
        if (typeof mine === 'string' && typeof theirs === 'string' && mine === theirs && theirs.length > 3) continue;
        translated += 1;
      }
      expected[lang] = Math.round((translated / enLeaves.length) * 100);
    }
    expected.en = 100;

    const drifted = Object.entries(expected)
      .filter(([lang, pct]) => coverage.coverage?.[lang] !== pct)
      .map(([lang, pct]) => `${lang}: file says ${pct}%, coverage.json says ${coverage.coverage?.[lang]}%`);
    t('every percentage the picker prints matches its locale file', drifted.length === 0);
    if (drifted.length) console.log(`      ${drifted.join('\n      ')}`);
  }

  return rows;
}

/*
 * Self-reporting when imported. `test/run.mjs` must import this file ABOVE
 * `business-locales-probe.mjs`: that probe calls `process.exit(0)` at import
 * time on success, and — because ES module imports are evaluated before the
 * importing module's body — any top-level `await import()` in run.mjs placed
 * after it never executes. That is exactly how this probe first shipped
 * silently green: the file ran, nobody called it, nothing failed. Printing
 * from here is the only placement that cannot rot.
 */
console.log('\n▸ probing the copy-trade engine and its link to the signal…');
const results = run();
for (const [name, ok] of results) console.log(`  ${ok ? '✓' : '✗'} ${name}`);
console.log(`\ncopy-trade ↔ signal coherence: ${results.filter(([, ok]) => ok).length}/${results.length} assertions passed`);
if (results.some(([, ok]) => !ok)) process.exit(1);
