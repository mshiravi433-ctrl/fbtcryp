/**
 * Shared Express application.
 *
 * Used by BOTH the local dev server (server/index.js, which adds static file
 * serving and the Telegram bot) and the Vercel serverless function
 * (api/index.js). One app definition means the deployed API cannot drift from
 * the one you test locally.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { withCache, cacheStats, memoryStore } from './cache.js';
import { blobConfigured, blobSet, withPersistentCache } from './blobCache.js';
import {
  fetchChart,
  fetchCoinDetail,
  fetchCategory,
  fetchDexPools,
  fetchGlobal,
  fetchMarkets,
  fetchOhlc,
  fetchSearch,
  fetchSimplePrices,
  fetchTrending,
} from './providers.js';
import { telegramAuth } from './telegramAuth.js';
import { fetchAudio } from './audio.js';
import { calmResultIsUsable, fetchCalm } from './calm.js';
import { fetchThorPools, thorQuote, thorStatus } from './thorchain.js';
import { fetchNews } from './news.js';
import { cachedWhales } from './whales.js';
import { fetchYields } from './yields.js';
import { fetchSolanaAssets } from './solanaAssets.js';
import { fetchAvantisEquities } from './avantis.js';
import { getShopCatalogue, getShopProducts, shopCountries } from './shop.js';
import { fetchPerpMarkets } from './perp.js';
import { fetchDydxAccount, fetchDydxMarkets, fetchDydxOrderbook } from './dydx.js';
import { fetchOstiumPrices, fetchOstiumSubgraph } from './ostium.js';
import { resolveIds } from './coinIndex.js';
import { resolveVenue } from './coinVenue.js';
import { fiatOrder, fiatQuote, fiatRange, fiatStatus } from './fiat.js';
import { bridgeQuote, bridgeStatus } from './bridge.js';
import { dlnCreateTx, dlnQuote, dlnStatus } from './dln.js';
import { gaslessPrice, gaslessQuote, gaslessStatus, gaslessSubmit } from './gasless.js';
import { jupiterConfigured, referralAccount, solanaExecute, solanaOrder } from './solana.js';
import { oceanQuote, oceanStatus, oceanSwap } from './solanaOcean.js';
import { proxyKyberBuild, proxyKyberRoutes, proxyOoQuote, proxyOoSwap } from './swapProxy.js';
import { crossChainProbe, crossChainQuotes, crossChainStatus } from './xchain.js';
import { revenueReadiness } from './readiness.js';
import { timingSafeEqual } from 'node:crypto';
import { pushConfigured, sendDailyPromo } from './push.js';
import { fcmBroadcast, fcmConfigured, fcmDiagnose, fcmSelfTest } from './fcm.js';
/*
 * LEARNING CORE — loaded through one guarded dynamic import instead of four
 * static ones. The sabotage requirement is explicit: deleting
 * server/learning/*.js must NOT break the server or the verdict — the app
 * boots, every learning surface answers its honest "not configured" shape,
 * params stay hardcoded and the badge simply never appears. A static import
 * would turn that deletion into a crash at module load.
 *
 * The import is attempted once and memoized (null on failure), so the hot
 * path pays a resolved-promise await and nothing else.
 */
let learningModPromise = null;
function learningMod() {
  if (!learningModPromise) {
    learningModPromise = (async () => {
      try {
        const [store, schema, params, train, events, loader] = await Promise.all([
          import('./learning/store.js'),
          import('./learning/schema.js'),
          import('./learning/params.js'),
          import('./learning/train.js'),
          import('./learning/events.js'),
          import('./learning/loader.js')
        ]);
        return { ...store, ...schema, ...params, ...train, ...events, ...loader };
      } catch (e) {
        console.warn('[learning] module unavailable — running with hardcoded weights:', e?.message);
        return null;
      }
    })();
  }
  return learningModPromise;
}
/** Sync facade for the diagnostic block below (filled once the import lands). */
let learningSync = null;
learningMod().then((m) => { learningSync = m; }).catch(() => {});
const learningConfigured = () => Boolean(learningSync?.learningConfigured?.() ?? false);
const servingSnapshot = () => (learningSync?.servingSnapshot ? learningSync.servingSnapshot() : null);
import { activateListing, myListing, putListing, readBoard, removeListing, tierForAmount, txAlreadyUsed } from './board.js';
import { promotionTerms, verifyPromotionPayment } from './promote.js';
import { CHANNEL_IDS, fetchChannel } from './farcaster.js';
import { fetchNfts, nftChains, nftConfigured, nftDiagnose } from './nft.js';
import { clearWatches, putWatches, readWatches, runWatchCycle } from './watch.js';
import {
  addFcmToken,
  addSubscription,
  readFcmTokens,
  removeFcmToken,
  removeSubscription,
  storeDurable
} from './store.js';
import { aiConfigured, aiSelfTest, answerSupportQuestion, generateMarketBrief, generateOutlook, newsConfigured } from './ai.js';
import { fetchTokenRisk } from './tokenRisk.js';
import { INTENT_CAPABILITIES, validateIntentEnvelope } from './intents.js';
import { parseSolverRegistry, publicSolverRegistry } from './intentSignatures.js';
import {
  appendSignedCommitment,
  readIntentLog,
  readLogEntry,
  transparencyStatus
} from './intentTransparency.js';
import {
  auctionProtocolStatus,
  auctionSealStatus,
  authenticateAuctionClose,
  closeAuction,
  coordinatorConfig,
  publicCoordinator,
  readAuction,
  storeAuctionAnchor
} from './intentAuctions.js';
import {
  buildAnchorCalldata,
  parseAnchorNetworks,
  publicAnchorNetworks,
  verifyAnchorClaim
} from './intentAnchors.js';
import { withIntentLock } from './intentLocks.js';
import {
  admissionReceiptStatus,
  issueAdmissionReceipt,
  verifyAdmissionReceipt
} from './intentAdmissions.js';
import {
  completenessSummary,
  parseWatcherRegistry,
  publicWatcherReport,
  readWatcherReports,
  storeWatcherReport,
  verifyCompletenessReport,
  watcherProtocolStatus
} from './intentWatcher.js';
import {
  bondStatusFor,
  bondsProtocolStatus,
  parseBondRegistry,
  publicBondBoard
} from './intentBonds.js';
import {
  executionProtocolStatus,
  readExecutionClaim,
  storeExecutionClaim,
  verifyExecutionClaim
} from './intentExecution.js';
import {
  listDisputes,
  parseVerifierRegistry,
  publicDispute,
  storeDispute,
  verifyDispute
} from './intentDisputes.js';
import {
  buildAdjudication,
  executionGraceSeconds,
  readAdjudication,
  storeAdjudication,
  verifyAdjudication
} from './intentAdjudication.js';
import {
  publicSettlementReport,
  readSettlementReports,
  settlementProtocolStatus,
  settlementSummary,
  storeSettlementReport,
  verifySettlementReport
} from './intentSettlement.js';
import { workflowProtocolStatus } from './intentWorkflow.js';
import {
  createCrossChainState,
  crossChainProtocolStatus,
  readCrossChainState,
  storeCrossChainReceipt,
  storeCrossChainState
} from './intentCrossChain.js';
import {
  buildAccountBindingChallenge,
  crossChainVerificationStatus,
  parseCrossChainRpcNetworks,
  readAccountBindings,
  readCrossChainStateWithVerification,
  readTxVerificationReports,
  storeAccountBinding,
  storeTxVerificationReport,
  verdictForTransientCode
} from './intentCrossChainVerification.js';
import {
  independentVerificationStatus,
  parseOperatorAttestations,
  publicOperatorAttestations
} from './intentOperators.js';
import {
  buildMerkleRootAnchorCalldata,
  buildMerkleRootManifest,
  merkleRootAnchorStatus,
  parseMerkleAnchorNetworks,
  publicMerkleAnchorNetworks,
  readMerkleRootAnchor,
  storeMerkleRootAnchor,
  verifyMerkleRootAnchorClaim
} from './intentRootAnchors.js';
import {
  appendOutcomeBid,
  buildOutcomeCompletenessReport,
  closeOutcomeAuction,
  issueOutcomeAdmissionReceipt,
  outcomeCompletenessSummary,
  outcomeProtocolStatus,
  outcomePublicCompletenessReport,
  outcomeSealStatus,
  readOutcomeAuction,
  readOutcomeCompletenessReports,
  readOutcomeLog,
  readOutcomeLogEntry,
  storeOutcomeCompletenessReport,
  verifyOutcomeAdmissionReceipt,
  verifyOutcomeClose,
  verifyOutcomeCompletenessReport
} from './intentOutcome.js';
import { verifyOutcomeBid } from './outcomeBids.js';
import { intentCommitmentStatus } from './intentCommitment.js';
import {
  confidentialProtocolStatus,
  parseOperatorRegistry,
  publicOperatorRegistry
} from './intentConfidential.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

const app = express();
app.disable('x-powered-by');

/*
 * ─── CONFIDENTIAL INTENT WRITES: REJECT BEFORE BODY PARSING ───────────────
 * There is no authenticated, durable, close-bound confidential workflow yet.
 * Register these exact routes before express.json so even malformed, oversized
 * or attacker-controlled request bodies are never parsed as a fallback path.
 */
const rejectUnavailableConfidentialWrite = (_req, res) => res.status(503).json({
  error: 'CONFIDENTIAL_MODE_UNAVAILABLE',
  available: false,
  retryable: false,
  prerequisites: {
    frontendIntegrated: false,
    durablePrivateStorage: false,
    requesterAuthentication: false,
    earlyRevealProtection: false
  }
});
app.post('/api/intents/v1/confidential/commit', rejectUnavailableConfidentialWrite);
app.post('/api/intents/v1/confidential/reveal', rejectUnavailableConfidentialWrite);

/*
 * 256kb instead of the usual 64kb: the KyberSwap route/build proxy forwards a
 * routeSummary, which grows with the number of pools in the route and can
 * reach tens of kilobytes on multi-hop trades. Still far too small to be a
 * DoS vector.
 */
app.use(express.json({ limit: '256kb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(telegramAuth(BOT_TOKEN)); // optional — populates req.tgUser when present

/* ------------------------------ rate limiting ----------------------------- */

const hits = new Map();
const WINDOW_MS = 60000;
const MAX_PER_WINDOW = Number(process.env.RATE_LIMIT || 120);

app.use('/api', (req, res, next) => {
  const key = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now > rec.reset) {
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json({ error: 'RATE_LIMITED' });
  }
  return next();
});

// keep the rate-limit map from growing forever
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, WINDOW_MS).unref?.();

/* --------------------------- AI: a tighter budget ------------------------- */
/*
 * The limit above is sized for cached market data, where a request costs a
 * map lookup. The AI routes are a different economy: each one spends real
 * upstream quota that is shared by every user of the app, and the Developers
 * page publishes these paths openly.
 *
 * At 120/min a single script could exhaust the daily model quota in minutes
 * and take the feature down for everyone — not by attacking anything, just by
 * looping the documented example. Cheap-to-serve and expensive-to-serve
 * endpoints should not share a budget.
 *
 * 10/min per caller is far above what the UI generates (the client answers
 * common questions from its local FAQ and only escalates when unsure) and far
 * below what a loop costs.
 */
const aiHits = new Map();
const AI_MAX_PER_WINDOW = Number(process.env.AI_RATE_LIMIT || 10);

app.use('/api/ai', (req, res, next) => {
  // Reading status must never be throttled: the client polls it to decide
  // whether to show the feature at all, and a 429 there looks like an outage.
  if (req.method === 'GET') return next();

  const key = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const rec = aiHits.get(key);
  if (!rec || now > rec.reset) {
    aiHits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > AI_MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json({ error: 'AI_RATE_LIMITED' });
  }
  return next();
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of aiHits) if (now > v.reset) aiHits.delete(k);
}, WINDOW_MS).unref?.();

/* On-chain anchor verification spends uncached RPC quota. It is public because
   the event is self-authenticating, but it gets the same small per-caller
   budget as AI rather than the broad cached-data allowance. */
const anchorHits = new Map();
const ANCHOR_MAX_PER_WINDOW = Number(process.env.INTENT_ANCHOR_RATE_LIMIT || 10);
const limitAnchorVerification = (req, res, next) => {
  const key = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const rec = anchorHits.get(key);
  if (!rec || now > rec.reset) {
    anchorHits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > ANCHOR_MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json({ error: 'ANCHOR_RATE_LIMITED' });
  }
  return next();
};
app.use('/api/intents/v1/auctions', (req, res, next) => {
  if (req.method !== 'POST' || !req.path.endsWith('/anchor')) return next();
  return limitAnchorVerification(req, res, next);
});
app.use('/api/intents/v1/log', (req, res, next) => {
  if (req.method !== 'POST' || !req.path.endsWith('/root-anchor')) return next();
  return limitAnchorVerification(req, res, next);
});
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of anchorHits) if (now > v.reset) anchorHits.delete(k);
}, WINDOW_MS).unref?.();

/* Watcher report submissions perform signature verification and one immutable
   storage write each. Cheaper than anchor RPC checks but still budgeted, since
   a public endpoint that writes storage is a cost amplifier without a cap. */
const watcherHits = new Map();
const WATCHER_MAX_PER_WINDOW = Number(process.env.INTENT_WATCHER_RATE_LIMIT || 20);
app.use('/api/intents/v1/auctions', (req, res, next) => {
  if (req.method !== 'POST' || !req.path.endsWith('/watcher-reports')) return next();
  const key = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const rec = watcherHits.get(key);
  if (!rec || now > rec.reset) {
    watcherHits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > WATCHER_MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json({ error: 'WATCHER_RATE_LIMITED' });
  }
  return next();
});
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of watcherHits) if (now > v.reset) watcherHits.delete(k);
}, WINDOW_MS).unref?.();

/* Phase 3a execution claims, disputes and adjudications write one immutable
   storage object each, so the public endpoints get the same small budget as
   watcher reports rather than the broad cached-data allowance. */
const settlementHits = new Map();
const SETTLEMENT_MAX_PER_WINDOW = Number(process.env.INTENT_SETTLEMENT_RATE_LIMIT || 20);
app.use('/api/intents/v1/auctions', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const isSettlementPath = /\/execution-claims$|\/disputes$|\/adjudicate$|\/settlement-reports$/.test(req.path);
  if (!isSettlementPath) return next();
  const key = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const rec = settlementHits.get(key);
  if (!rec || now > rec.reset) {
    settlementHits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > SETTLEMENT_MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json({ error: 'SETTLEMENT_RATE_LIMITED' });
  }
  return next();
});
app.use('/api/intents/v1/cross-chain', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const key = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const rec = settlementHits.get(key);
  if (!rec || now > rec.reset) {
    settlementHits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > SETTLEMENT_MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json({ error: 'SETTLEMENT_RATE_LIMITED' });
  }
  return next();
});
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of settlementHits) if (now > v.reset) settlementHits.delete(k);
}, WINDOW_MS).unref?.();

/* Phase 4c verification reports are the expensive RPC economy: each
   submission triggers 3 RPC calls per configured provider, twice (verifier
   observation + server recompute), so they get a dedicated budget from
   INTENT_CROSS_CHAIN_VERIFICATION_RATE_LIMIT instead of the broad
   cached-data allowance. */
const verificationHits = new Map();
const VERIFICATION_MAX_PER_WINDOW = Number(process.env.INTENT_CROSS_CHAIN_VERIFICATION_RATE_LIMIT || 10);
app.use('/api/intents/v1/cross-chain', (req, res, next) => {
  if (req.method !== 'POST' || !req.path.endsWith('/verification-reports')) return next();
  const key = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const rec = verificationHits.get(key);
  if (!rec || now > rec.reset) {
    verificationHits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > VERIFICATION_MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json({ error: 'VERIFICATION_RATE_LIMITED' });
  }
  return next();
});
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of verificationHits) if (now > v.reset) verificationHits.delete(k);
}, WINDOW_MS).unref?.();

/* Outcome writes get the same small per-caller budget as watcher/settlement
   writes rather than the broad cached-data allowance. Confidential writes are
   rejected earlier, before body parsing, and never reach this middleware. */
const outcomeHits = new Map();
const OUTCOME_MAX_PER_WINDOW = Number(process.env.INTENT_OUTCOME_RATE_LIMIT || 20);
app.use('/api/intents/v1', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const isOutcomePath = /^\/outcome\/bids$|\/outcome\/auctions\/.+\/(close|execution-claims|disputes|adjudicate|settlement-reports|watcher-reports)$/.test(req.path);
  if (!isOutcomePath) return next();
  const key = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const rec = outcomeHits.get(key);
  if (!rec || now > rec.reset) {
    outcomeHits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > OUTCOME_MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json({ error: 'OUTCOME_RATE_LIMITED' });
  }
  return next();
});
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of outcomeHits) if (now > v.reset) outcomeHits.delete(k);
}, WINDOW_MS).unref?.();

/* -------------------------------- helpers -------------------------------- */

/**
 * ─── WHY `s-maxage` AND NOT JUST `max-age` ──────────────────────────────────
 * The site got slower and this was the cause.
 *
 * `max-age` is a BROWSER instruction. Vercel's CDN ignores it and treats the
 * response as private, so every request — from every user, on every page —
 * woke a serverless function. Measured on the live site: /api/health reported
 * `uptime: 33s` and then `38s` seconds later, i.e. the instance had just been
 * created, and `cache.entries: 2` on a server with dozens of cached endpoints.
 * The in-memory cache in cache.js was being thrown away constantly, so almost
 * every call was a cold start plus a full upstream fetch.
 *
 * `s-maxage` is the SHARED-cache instruction the CDN actually reads. With it,
 * the first user warms the edge and everyone after that is served from it
 * without the function running at all.
 *
 * `stale-while-revalidate` is the other half: past the TTL the edge serves the
 * slightly-stale copy IMMEDIATELY and refreshes in the background, so nobody
 * ever waits for a cold start. For prices that are already 30-300s old by
 * design, a few extra seconds is invisible; a 2-second stall is not.
 */
function serve(res, ttlMs) {
  return async (producer, key) => {
    try {
      const { value, cached, stale } = await withCache(key, ttlMs, producer);
      const secs = Math.floor(ttlMs / 1000);
      res.set(
        'cache-control',
        `public, max-age=${secs}, s-maxage=${secs}, stale-while-revalidate=${secs * 4}`
      );
      if (stale) res.set('x-data-stale', '1');
      if (cached) res.set('x-cache', 'HIT');
      return res.json(value);
    } catch (err) {
      return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
    }
  };
}

/* --------------------------------- routes -------------------------------- */

app.get('/api/health', (_req, res) => {
  /*
   * Learning metrics ride on the existing health endpoint rather than a new
   * admin page. Everything here is a synchronous in-memory read — the
   * snapshot the loader already holds — so health stays as cheap as before.
   */
  const snap = servingSnapshot();
  const m = snap?.manifest ?? null;
  res.json({
    ok: true,
    uptime: process.uptime(),
    cache: cacheStats(),
    bot: Boolean(BOT_TOKEN),
    learning: {
      enabled: learningConfigured() && process.env.LEARNING_ENABLED !== '0',
      version: m?.version ?? null,
      trainedAt: m?.trainedAt ?? null,
      recordCount: m?.recordCount ?? 0,
      auc: m?.calibrationAuc ?? null,
      optInCount: 0, // opt-in lives on-device by design; the server cannot count users
      fallback: Boolean(m?.fallbackHardcoded ?? true)
    }
  });
});

/*
 * INTENT NETWORK DISCOVERY + AUTHENTICATED COMMITMENTS.
 * Discovery and logs are public. Submission authenticates a bounded quote with
 * a registered Ed25519 key and stores evidence only—never executable calldata,
 * spending authority, a bond claim, or permission to settle user funds.
 */
app.get('/api/intents/v1/capabilities', (_req, res) => {
  const registry = parseSolverRegistry();
  const watcherRegistry = parseWatcherRegistry();
  const verifierRegistry = parseVerifierRegistry();
  const anchorNetworks = parseAnchorNetworks();
  const merkleAnchorNetworks = parseMerkleAnchorNetworks();
  const operatorAttestations = parseOperatorAttestations();
  const independentVerification = independentVerificationStatus({
    watcherRegistry,
    verifierRegistry,
    solverRegistry: registry,
    coordinator: publicCoordinator(),
    attestations: operatorAttestations
  });
  res.set('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=240');
  res.json({
    ...INTENT_CAPABILITIES,
    transparency: {
      ...transparencyStatus(registry),
      optionalExternalRootAnchors: true,
      externalRootAnchorConfigured: merkleAnchorNetworks.size > 0
    },
    auctions: auctionProtocolStatus(anchorNetworks.size, watcherRegistry.size),
    admissions: admissionReceiptStatus(),
    watchers: watcherProtocolStatus(watcherRegistry),
    bonds: bondsProtocolStatus({ solverRegistry: registry }),
    execution: executionProtocolStatus({
      registeredVerifiers: verifierRegistry.size,
      graceSeconds: executionGraceSeconds()
    }),
    settlement: settlementProtocolStatus({
      registeredVerifiers: verifierRegistry.size,
      graceSeconds: executionGraceSeconds()
    }),
    workflows: workflowProtocolStatus(),
    crossChain: {
      ...crossChainProtocolStatus(),
      txVerification: crossChainVerificationStatus(parseCrossChainRpcNetworks())
    },
    crossChainVerification: crossChainVerificationStatus(parseCrossChainRpcNetworks()),
    independentVerification,
    merkleRootAnchors: merkleRootAnchorStatus(merkleAnchorNetworks),
    outcome: outcomeProtocolStatus({
      solverRegistry: registry,
      bondRegistry: parseBondRegistry()
    }),
    confidential: confidentialProtocolStatus({ operatorRegistry: parseOperatorRegistry() }),
    commitReveal: intentCommitmentStatus({ operatorRegistrySize: parseOperatorRegistry().size })
  });
});

app.get('/api/intents/v1/solvers', (_req, res) => {
  const registry = parseSolverRegistry();
  res.set('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=240');
  res.json({ algorithm: 'Ed25519', solvers: publicSolverRegistry(registry) });
});

app.get('/api/intents/v1/operators', (_req, res) => {
  const watcherRegistry = parseWatcherRegistry();
  const verifierRegistry = parseVerifierRegistry();
  const attestations = parseOperatorAttestations();
  const status = independentVerificationStatus({
    watcherRegistry,
    verifierRegistry,
    solverRegistry: parseSolverRegistry(),
    coordinator: publicCoordinator(),
    attestations
  });
  res.set('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=240');
  return res.json({ ...status, attestations: publicOperatorAttestations(attestations) });
});

app.get('/api/intents/v1/merkle-anchor-networks', (_req, res) => {
  res.set('cache-control', 'public, max-age=60, s-maxage=60');
  return res.json({ networks: publicMerkleAnchorNetworks() });
});

app.post('/api/intents/v1/validate', (req, res) => {
  const result = validateIntentEnvelope(req.body);
  res.status(result.ok ? 200 : 400).json(result);
});

/* Phase 4b: immutable, non-atomic cross-chain plan + sequential party-signed
   transfer evidence. Creating a plan grants no authority. Every transition
   verifies against a party key pinned in fbt.cross-chain-state.v1. */
app.post('/api/intents/v1/cross-chain/states', async (req, res) => {
  const built = createCrossChainState(req.body);
  if (!built.ok) return res.status(400).json({ error: built.code });
  const stored = await withIntentLock(built.state.stateId, () => storeCrossChainState(built.state));
  if (!stored.ok) {
    const status = ['CROSS_CHAIN_STORE_UNAVAILABLE', 'CROSS_CHAIN_WRITE_FAILED'].includes(stored.code)
      ? 503 : stored.code === 'CROSS_CHAIN_STATE_CONFLICT' ? 409 : 400;
    return res.status(status).json({ error: stored.code });
  }
  const state = await readCrossChainState(built.state.stateId);
  if (state.error) return res.status(503).json({ error: state.error });
  return res.status(stored.alreadyStored ? 200 : 201).json(state);
});

app.get('/api/intents/v1/cross-chain/states/:stateId', async (req, res) => {
  /* Phase 4c: the public state carries a DERIVED verification block
     (bindings, reports, per-leg status). The stored fbt.cross-chain-state.v1
     plan and fbt.cross-chain-leg-receipt.v1 receipts are returned exactly as
     written — history is never rewritten, and receipts keep
     onChainVerified:false because they are party claims, not chain reads. */
  const state = await readCrossChainStateWithVerification(req.params.stateId);
  if (state.error) {
    const status = state.error === 'CROSS_CHAIN_STATE_NOT_FOUND' ? 404
      : state.error === 'BAD_CROSS_CHAIN_STATE_ID' ? 400 : 503;
    return res.status(status).json({ error: state.error, detail: state.detail });
  }
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json(state);
});

app.post('/api/intents/v1/cross-chain/states/:stateId/receipts', async (req, res) => {
  const stored = await withIntentLock(String(req.params.stateId), () =>
    storeCrossChainReceipt(req.params.stateId, req.body));
  if (!stored.ok) {
    const status = ['CROSS_CHAIN_STORE_UNAVAILABLE', 'CROSS_CHAIN_WRITE_FAILED'].includes(stored.code) ? 503
      : ['CROSS_CHAIN_TRANSITION_CONFLICT'].includes(stored.code) ? 409
        : stored.code === 'CROSS_CHAIN_STATE_NOT_FOUND' ? 404
          : ['CROSS_CHAIN_SIGNATURE_MISMATCH', 'BAD_CROSS_CHAIN_SIGNER'].includes(stored.code) ? 403 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyStored ? 200 : 201).json(stored.state);
});

/* Phase 4c: signed account bindings + independently recomputed multi-RPC
   verification reports. A binding must be signed by the exact party key the
   plan pins — placing an address in a request body proves nothing. A report
   is stored ONLY after the server re-reads the chain through its own
   configured endpoints and reproduces the exact signed verdict; a transient
   RPC outcome is stored only as an honest non-final snapshot and an outage
   stores nothing. */
app.post('/api/intents/v1/cross-chain/states/:stateId/account-binding-challenge', async (req, res) => {
  const current = await readCrossChainState(req.params.stateId);
  if (current.error) {
    const status = current.error === 'CROSS_CHAIN_STATE_NOT_FOUND' ? 404
      : current.error === 'BAD_CROSS_CHAIN_STATE_ID' ? 400 : 503;
    return res.status(status).json({ error: current.error });
  }
  const challenge = buildAccountBindingChallenge({
    state: current.state,
    partyId: req.body?.partyId,
    chainId: Number(req.body?.chainId),
    address: req.body?.address,
    issuedAt: Number(req.body?.issuedAt ?? Math.floor(Date.now() / 1000)),
    expiresAt: Number(req.body?.expiresAt),
    nonce: req.body?.nonce ?? ''
  });
  if (!challenge.ok) return res.status(400).json({ error: challenge.code });
  res.set('cache-control', 'no-store');
  /* The challenge is fully public: domain + message for the party to sign
     in their own wallet. No private key is ever requested or received. */
  return res.json({ ok: true, challenge: challenge.challenge });
});

app.post('/api/intents/v1/cross-chain/states/:stateId/account-bindings', async (req, res) => {
  const stored = await withIntentLock(String(req.params.stateId), () =>
    storeAccountBinding(req.params.stateId, req.body));
  if (!stored.ok) {
    const status = ['CROSS_CHAIN_STORE_UNAVAILABLE', 'CROSS_CHAIN_WRITE_FAILED'].includes(stored.code) ? 503
      : stored.code === 'ACCOUNT_BINDING_CONFLICT' ? 409
        : stored.code === 'CROSS_CHAIN_STATE_NOT_FOUND' ? 404
          : ['ACCOUNT_BINDING_SIGNATURE_MISMATCH', 'BINDING_KEY_MISMATCH', 'WALLET_PROOF_INVALID',
            'WALLET_PROOF_SCHEME_UNSUPPORTED'].includes(stored.code) ? 403 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyStored ? 200 : 201).json({
    ok: true,
    alreadyStored: stored.alreadyStored,
    binding: stored.binding
  });
});

app.get('/api/intents/v1/cross-chain/states/:stateId/account-bindings', async (req, res) => {
  const result = await readAccountBindings(req.params.stateId);
  if (result.error) {
    return res.status(result.error === 'BAD_CROSS_CHAIN_STATE_ID' ? 400 : 503).json({ error: result.error });
  }
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json({ schema: 'fbt.cross-chain-account-binding.v1', bindings: result.bindings });
});

const TRANSIENT_CODES_PUBLIC = ['RPC_QUORUM_UNAVAILABLE', 'RPC_DISAGREEMENT', 'REORG_DETECTED', 'TX_NOT_FOUND', 'INSUFFICIENT_CONFIRMATIONS'];

const verificationAttemptStatus = (code) => {
  if (verdictForTransientCode(code)) return verdictForTransientCode(code);
  if (code === 'WALLET_PROOF_REQUIRED') return 'wallet-proof-required';
  if (code === 'ACCOUNT_BINDING_NOT_FOUND') return 'binding-required';
  if (code === 'VERIFICATION_CHAIN_NOT_CONFIGURED') return 'verification-unavailable';
  return null;
};

async function submitVerificationReport(stateId, body) {
  return withIntentLock(String(stateId), () =>
    storeTxVerificationReport(stateId, body, {
      registry: parseVerifierRegistry(),
      networks: parseCrossChainRpcNetworks()
    }));
}

function answerVerificationReport(res, stored) {
  if (!stored.ok) {
    const status = ['CROSS_CHAIN_STORE_UNAVAILABLE', 'CROSS_CHAIN_WRITE_FAILED'].includes(stored.code) ? 503
      : TRANSIENT_CODES_PUBLIC.includes(stored.code) || stored.code === 'VERIFICATION_SUPERSEDED' ? 409
        : stored.code === 'VERIFICATION_REPORT_CONFLICT' || stored.code === 'VERIFICATION_REPORT_LIMIT' ? 409
          : ['CROSS_CHAIN_STATE_NOT_FOUND', 'VERIFICATION_RECEIPT_NOT_FOUND', 'ACCOUNT_BINDING_NOT_FOUND'].includes(stored.code) ? 404
            : ['VERIFICATION_SIGNATURE_MISMATCH', 'UNREGISTERED_VERIFIER'].includes(stored.code) ? 403
              : stored.code === 'VERIFICATION_CHAIN_NOT_CONFIGURED' ? 503 : 400;
    const legStatus = verificationAttemptStatus(stored.code);
    return res.status(status).json({
      error: stored.code,
      retryable: TRANSIENT_CODES_PUBLIC.includes(stored.code) || Boolean(stored.transient),
      ...(legStatus ? { legVerification: { status: legStatus } } : {})
    });
  }
  return res.status(stored.alreadyStored ? 200 : 201).json({
    ok: true,
    alreadyStored: stored.alreadyStored,
    report: stored.report,
    serverRecomputedBeforeStorage: true
  });
}

app.post('/api/intents/v1/cross-chain/states/:stateId/verification-reports', async (req, res) => {
  return answerVerificationReport(res, await submitVerificationReport(req.params.stateId, req.body));
});

/* Receipt-scoped report routes: the receipt in the path must match the
   receipt the signed report is attached to — roles are never taken from the
   request body. */
app.post('/api/intents/v1/cross-chain/states/:stateId/receipts/:receiptId/verification-reports', async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
    || !req.body.receiptId
    || String(req.body.receiptId).toLowerCase() !== String(req.params.receiptId).toLowerCase()) {
    return res.status(400).json({ error: 'VERIFICATION_RECEIPT_MISMATCH' });
  }
  return answerVerificationReport(res, await submitVerificationReport(req.params.stateId, req.body));
});

app.get('/api/intents/v1/cross-chain/states/:stateId/verification-reports', async (req, res) => {
  const result = await readTxVerificationReports(req.params.stateId);
  if (result.error) {
    return res.status(result.error === 'BAD_CROSS_CHAIN_STATE_ID' ? 400 : 503).json({ error: result.error });
  }
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json({
    schema: 'fbt.cross-chain-tx-verification.v1',
    recordSchema: 'fbt.cross-chain-tx-verification-record.v1',
    reports: result.records
  });
});

app.get('/api/intents/v1/cross-chain/states/:stateId/receipts/:receiptId/verification-reports', async (req, res) => {
  const result = await readTxVerificationReports(req.params.stateId);
  if (result.error) {
    return res.status(result.error === 'BAD_CROSS_CHAIN_STATE_ID' ? 400 : 503).json({ error: result.error });
  }
  const receiptId = String(req.params.receiptId).toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(receiptId)) return res.status(400).json({ error: 'BAD_CROSS_CHAIN_RECEIPT_ID' });
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json({
    schema: 'fbt.cross-chain-tx-verification.v1',
    recordSchema: 'fbt.cross-chain-tx-verification-record.v1',
    receiptId,
    reports: result.records.filter((row) =>
      String(row.report?.receiptId || '').toLowerCase() === receiptId)
  });
});

app.post('/api/intents/v1/commitments', async (req, res) => {
  const registry = parseSolverRegistry();
  if (!registry.size) return res.status(503).json({ error: 'NO_REGISTERED_SOLVERS' });
  const intentHash = String(req.body?.intentHash || '').toLowerCase();
  const result = await withIntentLock(intentHash, async () => {
    if (/^0x[a-f0-9]{64}$/.test(intentHash)) {
      const admission = await auctionSealStatus(intentHash);
      if (!admission.ok) return { ok: false, code: admission.code };
      if (admission.sealed) return { ok: false, code: 'AUCTION_CLOSED' };
    }
    const appended = await appendSignedCommitment(req.body, { registry });
    if (appended.ok && /^0x[a-f0-9]{64}$/.test(intentHash)) {
      const afterWrite = await auctionSealStatus(intentHash);
      if (!afterWrite.ok) return { ok: false, code: afterWrite.code };
      if (afterWrite.sealed) {
        return { ok: false, code: 'AUCTION_CLOSE_RACE', storedEntryHash: appended.entryHash };
      }
    }
    /* Phase 2c transactional admission: a quote that is answered 201 is now
       atomically bound to a coordinator-signed receipt minted from the stored
       row, inside the same admission lock and after the post-write seal
       re-check. The solver keeps this receipt; if the sealed close later
       omits the entry, the receipt is censorship evidence. */
    if (appended.ok) {
      const receipt = issueAdmissionReceipt({
        intentHash,
        entryHash: appended.entryHash,
        acceptedAt: appended.acceptedAt,
        solverId: appended.solverId
      });
      return {
        ...appended,
        admissionReceipt: receipt,
        admissionReceiptAvailable: Boolean(receipt)
      };
    }
    return appended;
  });
  if (result.ok) return res.status(201).json(result);
  const status = result.code === 'UNREGISTERED_SOLVER' || result.code === 'SIGNATURE_MISMATCH'
    ? 403
    : ['NONCE_REPLAY', 'AUCTION_CLOSED', 'AUCTION_CLOSE_RACE'].includes(result.code) ? 409
      : ['LOG_WRITE_FAILED', 'LOG_READ_FAILED', 'AUCTION_STORE_UNAVAILABLE', 'INVALID_STORED_SEAL'].includes(result.code) ? 503 : 400;
  return res.status(status).json({ error: result.code });
});

/*
 * Deterministic admission-receipt reclaim. The receipt is a pure function of
 * the immutable log row (intent · entry hash · admission time · solver) and
 * the coordinator key, with deterministic Ed25519 signatures — so a solver
 * that lost its 201 response can always re-derive the identical receipt, and
 * watchtowers can mint the receipts of every logged entry. Cacheable forever:
 * the bytes for a given (intentHash, entryHash) never change.
 */
app.get('/api/intents/v1/admissions/:intentHash/:entryHash', async (req, res) => {
  const found = await readLogEntry(req.params.intentHash, req.params.entryHash);
  if (found.error) {
    const status = found.error === 'LOG_READ_FAILED' ? 503
      : found.error === 'ADMISSION_NOT_FOUND' ? 404 : 400;
    return res.status(status).json({ error: found.error });
  }
  const receipt = issueAdmissionReceipt({
    intentHash: found.entry.commitment?.intentHash,
    entryHash: found.entry.entryHash,
    acceptedAt: found.entry.acceptedAt,
    solverId: found.entry.commitment?.solverId
  });
  if (!receipt) return res.status(503).json({ error: 'ADMISSION_RECEIPTS_NOT_CONFIGURED' });
  if (!verifyAdmissionReceipt(receipt)) {
    return res.status(500).json({ error: 'ADMISSION_RECEIPT_FAILED' });
  }
  res.set('cache-control', 'public, max-age=31536000, immutable');
  return res.json(receipt);
});

app.get('/api/intents/v1/log/:intentHash', async (req, res) => {
  const result = await readIntentLog(req.params.intentHash);
  if (result.error) return res.status(result.error === 'LOG_READ_FAILED' ? 503 : 400).json(result);
  /* Phase 6: an exact non-empty snapshot can be permissionlessly anchored.
     A newer quote changes the root and therefore correctly returns a different
     unanchored manifest; an old anchor is never stretched over a new set. */
  const built = buildMerkleRootManifest(result);
  if (built.ok) {
    result.rootManifest = built.manifest;
    const anchored = await readMerkleRootAnchor(built.manifest);
    if (anchored.error) {
      result.rootAnchor = null;
      result.rootAnchorStatus = 'store-unavailable';
    } else {
      result.rootAnchor = anchored.anchor;
      result.externallyAnchored = Boolean(anchored.anchor?.verified);
      result.rootAnchorStatus = result.externallyAnchored ? 'verified' : 'not-anchored';
    }
  } else {
    result.rootManifest = null;
    result.rootAnchor = null;
    result.externallyAnchored = false;
    result.rootAnchorStatus = result.size === 0 ? 'empty-log' : 'manifest-invalid';
  }
  /* A log can grow until the intent expires, so intermediary caches must
     revalidate rather than freezing an incomplete bid set. */
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json(result);
});

app.get('/api/intents/v1/log/:intentHash/root-anchor-calldata/:chainId', async (req, res) => {
  const log = await readIntentLog(req.params.intentHash);
  if (log.error) return res.status(log.error === 'LOG_READ_FAILED' ? 503 : 400).json(log);
  const built = buildMerkleRootManifest(log);
  if (!built.ok) return res.status(400).json({ error: built.code });
  const result = buildMerkleRootAnchorCalldata(built.manifest, Number(req.params.chainId));
  return res.status(result.ok ? 200 : 400).json(result.ok ? result : { error: result.code });
});

app.post('/api/intents/v1/log/:intentHash/root-anchor', async (req, res) => {
  const log = await readIntentLog(req.params.intentHash);
  if (log.error) return res.status(log.error === 'LOG_READ_FAILED' ? 503 : 400).json(log);
  const built = buildMerkleRootManifest(log);
  if (!built.ok) return res.status(400).json({ error: built.code });
  const verified = await verifyMerkleRootAnchorClaim(built.manifest, req.body);
  if (!verified.ok) {
    const status = verified.code === 'MERKLE_ANCHOR_RPC_UNAVAILABLE' ? 503
      : ['MERKLE_ANCHOR_NOT_MINED', 'MERKLE_ANCHOR_NOT_FINAL'].includes(verified.code) ? 409 : 400;
    return res.status(status).json({ error: verified.code, ...verified });
  }
  const stored = await storeMerkleRootAnchor(built.manifest, verified.anchor);
  if (!stored.ok) {
    const status = ['MERKLE_ANCHOR_STORE_UNAVAILABLE', 'MERKLE_ANCHOR_WRITE_FAILED', 'INVALID_STORED_MERKLE_ANCHOR']
      .includes(stored.code) ? 503 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyAnchored ? 200 : 201).json(stored);
});

app.get('/api/intents/v1/coordinator', (_req, res) => {
  const coordinator = publicCoordinator();
  res.set('cache-control', 'public, max-age=60, s-maxage=60');
  return res.status(coordinator ? 200 : 503).json(coordinator || { error: 'AUCTION_CLOSE_NOT_CONFIGURED' });
});

app.get('/api/intents/v1/anchor-networks', (_req, res) => {
  res.set('cache-control', 'public, max-age=60, s-maxage=60');
  return res.json({ networks: publicAnchorNetworks() });
});

app.get('/api/intents/v1/auctions/:intentHash', async (req, res) => {
  const result = await readAuction(req.params.intentHash);
  if (result.error) {
    const status = ['AUCTION_STORE_UNAVAILABLE', 'INVALID_STORED_SEAL', 'INVALID_STORED_CLOSE', 'INVALID_STORED_ANCHOR']
      .includes(result.error) ? 503 : 400;
    return res.status(status).json(result);
  }
  /* Phase 2c live evidence: once closed, compose the verified watcher
     reports into a per-auction completeness status. A watcher storage outage
     degrades only this block — the signed close stays readable and honest. */
  if (result.close) {
    const listed = await readWatcherReports(result.intentHash, result.close);
    if (listed.error) {
      result.completeness = { status: 'watcher-store-unavailable', watcherReports: null };
    } else {
      result.completeness = completenessSummary(listed.reports);
      result.watcherReports = listed.reports.map(publicWatcherReport);
    }
    /* Phase 3a live evidence: the stored execution claim, disputes and
       adjudication, each re-verified against the signed close on read. The
       claim is correlated with the selected commitment from the immutable
       log, so a stored claim by another solver can never pass as the
       winner's outcome. */
    try {
      const entry = await readLogEntry(result.intentHash, result.close.decision.selectedEntryHash);
      const commitment = entry.entry?.commitment || null;
      const claim = await readExecutionClaim(result.close.closeId);
      const claimVerified = claim ? verifyExecutionClaim(claim, { close: result.close, commitment }).ok : null;
      const disputes = await listDisputes(result.close.closeId);
      if (!disputes.ok) throw new Error(disputes.code);
      for (const record of disputes.records) {
        if (!verifyDispute(record.dispute, { close: result.close }).ok) throw new Error('INVALID_STORED_DISPUTE');
      }
      const adjudicationRecord = await readAdjudication(result.close.closeId);
      const adjudicationVerified = adjudicationRecord
        ? verifyAdjudication(adjudicationRecord.adjudication, { close: result.close }).ok
        : null;
      result.execution = { claim, claimVerified };
      result.disputes = disputes.records.map(publicDispute);
      result.adjudication = adjudicationRecord?.adjudication || null;
      result.adjudicationVerified = adjudicationVerified;
      /* Phase 3b live evidence: independent settlement reports re-grade the
         outcome (promised vs delivered, adjudication cross-check) and derive
         the per-auction settlement status. A settlement-store outage degrades
         only this block. */
      const settlementListed = await readSettlementReports(result.intentHash, result.close);
      if (settlementListed.error) {
        result.settlement = { status: 'settlement-store-unavailable' };
      } else {
        result.settlement = settlementSummary(settlementListed.reports);
        result.settlementReports = settlementListed.reports.map(publicSettlementReport);
      }
    } catch {
      result.execution = { storeUnavailable: true };
      result.disputes = null;
      result.adjudication = null;
      result.adjudicationVerified = null;
      result.settlement = { status: 'settlement-store-unavailable' };
    }
  }
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json(result);
});

/*
 * Watcher report submission (Phase 2c). The report must be signed by an
 * active registered watcher key — but a signature alone proves nothing:
 * before storing, the server RE-EVALUATES the embedded admission receipts
 * against the stored signed close with the same deterministic rules every
 * third party uses, so a report whose verdict or classifications do not
 * recompute is rejected even with a valid key. Storage is immutable; one
 * reportId can never be silently replaced.
 */
app.post('/api/intents/v1/auctions/:intentHash/watcher-reports', async (req, res) => {
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const registry = parseWatcherRegistry();
  const checked = verifyCompletenessReport(req.body, {
    registry,
    close: state.close,
    requireRegistered: true
  });
  if (!checked.ok) {
    const status = ['UNREGISTERED_WATCHER', 'WATCHER_SIGNATURE_MISMATCH'].includes(checked.code) ? 403 : 400;
    return res.status(status).json({ error: checked.code });
  }
  const stored = await storeWatcherReport(state.intentHash, checked.report);
  if (!stored.ok) {
    const status = ['WATCHER_STORE_UNAVAILABLE', 'WATCHER_WRITE_FAILED'].includes(stored.code) ? 503
      : stored.code === 'WATCHER_REPORTS_FULL' ? 409 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyReported ? 200 : 201).json({
    ok: true,
    alreadyReported: stored.alreadyReported,
    reportId: checked.report.reportId,
    verdict: checked.report.verdict,
    counts: checked.report.counts
  });
});

/* Full verified watcher reports for an auction, each re-verified against the
   stored signed close (including deterministic re-evaluation) on every read. */
app.get('/api/intents/v1/auctions/:intentHash/watcher-reports', async (req, res) => {
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const listed = await readWatcherReports(state.intentHash, state.close);
  if (listed.error) return res.status(503).json({ error: listed.error });
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json({
    intentHash: state.intentHash,
    closeId: state.close.closeId,
    completeness: completenessSummary(listed.reports),
    reports: listed.reports
  });
});

app.post('/api/intents/v1/auctions/:intentHash/close', async (req, res) => {
  const auth = authenticateAuctionClose(req.get('authorization'));
  if (!auth.ok) {
    return res.status(auth.code === 'AUCTION_CLOSE_NOT_CONFIGURED' ? 503 : 401).json({ error: auth.code });
  }
  if (String(req.body?.intentHash || '').toLowerCase() !== String(req.params.intentHash).toLowerCase()) {
    return res.status(400).json({ error: 'INTENT_HASH_MISMATCH' });
  }
  const result = await closeAuction(req.body);
  if (result.ok) return res.status(result.alreadyClosed ? 200 : 201).json(result);
  const status = [
    'AUCTION_STORE_UNAVAILABLE', 'AUCTION_WRITE_FAILED', 'LOG_READ_FAILED',
    'INVALID_STORED_SEAL', 'INVALID_STORED_CLOSE'
  ].includes(result.code) ? 503 : ['AUCTION_ALREADY_SEALED'].includes(result.code) ? 409 : 400;
  return res.status(status).json({ error: result.code });
});

app.get('/api/intents/v1/auctions/:intentHash/anchor-calldata/:chainId', async (req, res) => {
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const result = buildAnchorCalldata(state.close, Number(req.params.chainId));
  return res.status(result.ok ? 200 : 400).json(result.ok ? result : { error: result.code });
});

app.post('/api/intents/v1/auctions/:intentHash/anchor', async (req, res) => {
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const verified = await verifyAnchorClaim(state.close, req.body);
  if (!verified.ok) {
    const status = verified.code === 'ANCHOR_RPC_UNAVAILABLE' ? 503
      : ['ANCHOR_NOT_MINED', 'ANCHOR_NOT_FINAL'].includes(verified.code) ? 409 : 400;
    return res.status(status).json({ error: verified.code, ...verified });
  }
  const stored = await storeAuctionAnchor(state.close, verified.anchor);
  if (!stored.ok) {
    const status = ['AUCTION_STORE_UNAVAILABLE', 'AUCTION_WRITE_FAILED', 'INVALID_STORED_ANCHOR']
      .includes(stored.code) ? 503 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyAnchored ? 200 : 201).json(stored);
});

/*
 * ─── PHASE 3a: DECLARED SOLVER BONDS ──────────────────────────────────────
 * Public board over the INTENT_SOLVER_BONDS registry. Statements only: the
 * protocol never receives bond funds, and the board says so rather than
 * implying an escrow that does not exist.
 */
app.get('/api/intents/v1/bonds', (_req, res) => {
  const registry = parseSolverRegistry();
  const board = publicBondBoard(parseBondRegistry(), { solverRegistry: registry });
  res.set('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=240');
  res.json({
    ...bondsProtocolStatus({ solverRegistry: registry }),
    bonds: board
  });
});

/*
 * ─── PHASE 3a: EXECUTION CLAIMS ───────────────────────────────────────────
 * The winning solver signs what actually happened after the sealed close:
 * tx hash, received amount, fee, timing. The claim is stored as evidence —
 * it is never treated as machine-verified settlement and never moves funds.
 */
app.post('/api/intents/v1/auctions/:intentHash/execution-claims', async (req, res) => {
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const registry = parseSolverRegistry();
  if (!registry.size) return res.status(503).json({ error: 'NO_REGISTERED_SOLVERS' });
  const entry = await readLogEntry(state.intentHash, state.close.decision.selectedEntryHash);
  if (entry.error) return res.status(503).json({ error: entry.error });
  const checked = verifyExecutionClaim(req.body, {
    close: state.close,
    commitment: entry.entry.commitment,
    registry,
    requireRegistered: true
  });
  if (!checked.ok) {
    const status = ['UNREGISTERED_SOLVER', 'SIGNATURE_MISMATCH'].includes(checked.code) ? 403 : 400;
    return res.status(status).json({ error: checked.code });
  }
  const stored = await storeExecutionClaim(state.close.closeId, checked.claim);
  if (!stored.ok) {
    const status = ['EXECUTION_STORE_UNAVAILABLE', 'EXECUTION_WRITE_FAILED'].includes(stored.code) ? 503
      : stored.code === 'EXECUTION_CLAIM_CONFLICT' ? 409 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyStored ? 200 : 201).json({
    ok: true,
    alreadyStored: stored.alreadyStored,
    claimId: checked.claim.claimId,
    outcome: checked.claim.outcome,
    claims: checked.claim.claims
  });
});

app.get('/api/intents/v1/auctions/:intentHash/execution-claim', async (req, res) => {
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const claim = await readExecutionClaim(state.close.closeId);
  if (!claim) return res.status(404).json({ error: 'EXECUTION_CLAIM_NOT_FOUND' });
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json(claim);
});

/*
 * ─── PHASE 3a: VERIFIER DISPUTES ──────────────────────────────────────────
 * Registered verifiers sign bounded challenges over the selected outcome.
 * A dispute is an observation, never a verdict — the deterministic grading
 * engine and the coordinator's adjudication resolve what it means.
 */
app.post('/api/intents/v1/auctions/:intentHash/disputes', async (req, res) => {
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const registry = parseVerifierRegistry();
  if (!registry.size) return res.status(503).json({ error: 'NO_REGISTERED_VERIFIERS' });
  const checked = verifyDispute(req.body, { close: state.close, registry, requireRegistered: true });
  if (!checked.ok) {
    const status = ['UNREGISTERED_VERIFIER', 'SIGNATURE_MISMATCH'].includes(checked.code) ? 403 : 400;
    return res.status(status).json({ error: checked.code });
  }
  const stored = await storeDispute(state.close.closeId, checked.dispute);
  if (!stored.ok) {
    const status = ['DISPUTE_STORE_UNAVAILABLE', 'DISPUTE_WRITE_FAILED'].includes(stored.code) ? 503
      : stored.code === 'DISPUTE_CONFLICT' ? 409 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyStored ? 200 : 201).json({
    ok: true,
    alreadyStored: stored.alreadyStored,
    disputeId: checked.dispute.disputeId,
    kind: checked.dispute.kind
  });
});

app.get('/api/intents/v1/auctions/:intentHash/disputes', async (req, res) => {
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const listed = await listDisputes(state.close.closeId);
  if (!listed.ok) return res.status(503).json({ error: listed.code });
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json({ intentHash: state.intentHash, closeId: state.close.closeId, disputes: listed.records.map(publicDispute) });
});

/*
 * ─── PHASE 3a: OUTCOME ADJUDICATION ───────────────────────────────────────
 * Operator action guarded by the same bearer secret as auction close. The
 * coordinator re-reads the immutable evidence, grades it with the shared
 * deterministic rules and signs the resulting penalty instruction. The
 * record embeds every input, so anyone can recompute the grade. Refused
 * while the execution window is still open (verdict would be 'pending').
 */
app.post('/api/intents/v1/auctions/:intentHash/adjudicate', async (req, res) => {
  const auth = authenticateAuctionClose(req.get('authorization'));
  if (!auth.ok) {
    return res.status(auth.code === 'AUCTION_CLOSE_NOT_CONFIGURED' ? 503 : 401).json({ error: auth.code });
  }
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const config = coordinatorConfig();
  if (!config) return res.status(503).json({ error: 'AUCTION_CLOSE_NOT_CONFIGURED' });
  const entry = await readLogEntry(state.intentHash, state.close.decision.selectedEntryHash);
  if (entry.error) return res.status(503).json({ error: entry.error });
  const claim = await readExecutionClaim(state.close.closeId);
  const disputes = await listDisputes(state.close.closeId);
  if (!disputes.ok) return res.status(503).json({ error: disputes.code });

  const existing = await readAdjudication(state.close.closeId);
  if (existing) {
    const rechecked = verifyAdjudication(existing.adjudication, { close: state.close });
    return rechecked.ok
      ? res.status(200).json({ ok: true, alreadyAdjudicated: true, adjudication: existing.adjudication })
      : res.status(503).json({ error: 'INVALID_STORED_ADJUDICATION' });
  }

  const built = buildAdjudication({
    close: state.close,
    commitment: entry.entry.commitment,
    claim,
    disputes: disputes.records.map((record) => record.dispute),
    bond: parseBondRegistry().get(entry.entry.commitment.solverId) || null,
    coordinator: config,
    solverRegistry: parseSolverRegistry(),
    now: Date.now()
  });
  if (!built.ok) {
    const status = built.code === 'EXECUTION_WINDOW_OPEN' ? 409
      : ['BAD_EXECUTION_CLAIM', 'BAD_DISPUTE', 'BAD_COMMITMENT_BINDING'].includes(built.code) ? 503 : 400;
    return res.status(status).json({ error: built.code });
  }
  const stored = await storeAdjudication(state.close.closeId, built.adjudication);
  if (!stored.ok) {
    const status = ['ADJUDICATION_STORE_UNAVAILABLE', 'ADJUDICATION_WRITE_FAILED'].includes(stored.code) ? 503
      : stored.code === 'ADJUDICATION_CONFLICT' ? 409 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyStored ? 200 : 201).json({
    ok: true,
    alreadyStored: stored.alreadyStored,
    adjudicationId: built.adjudication.adjudicationId,
    verdict: built.adjudication.verdict,
    penaltyBps: built.adjudication.penaltyBps,
    penaltyUsd: built.adjudication.penaltyUsd,
    bond: built.adjudication.bond,
    claims: built.adjudication.claims
  });
});

app.get('/api/intents/v1/auctions/:intentHash/adjudication', async (req, res) => {
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const record = await readAdjudication(state.close.closeId);
  if (!record) return res.status(404).json({ error: 'ADJUDICATION_NOT_FOUND' });
  const rechecked = verifyAdjudication(record.adjudication, { close: state.close });
  if (!rechecked.ok) return res.status(503).json({ error: 'INVALID_STORED_ADJUDICATION' });
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json(record.adjudication);
});

/*
 * ─── PHASE 3b: OUTCOME SETTLEMENT REPORTS ─────────────────────────────────
 * Independent verifiers re-grade every execution outcome — promised vs
 * delivered output, shortfall, and whether the coordinator's stored
 * adjudication reproduces — and submit fbt.settlement-report.v1 verdicts.
 * Like watcher reports, the server RE-EVALUATES deterministically before
 * storing: a report whose verdict, shortfall or cross-check does not
 * recompute is rejected even with a valid verifier key. Storage is
 * immutable; one reportId can never be silently replaced.
 */
app.post('/api/intents/v1/auctions/:intentHash/settlement-reports', async (req, res) => {
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const registry = parseVerifierRegistry();
  if (!registry.size) return res.status(503).json({ error: 'NO_REGISTERED_VERIFIERS' });
  const checked = verifySettlementReport(req.body, {
    registry,
    close: state.close,
    requireRegistered: true
  });
  if (!checked.ok) {
    const status = ['UNREGISTERED_VERIFIER', 'VERIFIER_SIGNATURE_MISMATCH'].includes(checked.code) ? 403 : 400;
    return res.status(status).json({ error: checked.code });
  }
  const stored = await storeSettlementReport(state.intentHash, checked.report);
  if (!stored.ok) {
    const status = ['SETTLEMENT_STORE_UNAVAILABLE', 'SETTLEMENT_WRITE_FAILED'].includes(stored.code) ? 503
      : stored.code === 'SETTLEMENT_REPORTS_FULL' ? 409 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyReported ? 200 : 201).json({
    ok: true,
    alreadyReported: stored.alreadyReported,
    reportId: checked.report.reportId,
    verdict: checked.report.verdict,
    adjudicationConsistent: checked.report.adjudicationConsistent,
    promisedOut: checked.report.promisedOut,
    deliveredOut: checked.report.deliveredOut,
    shortfallBps: checked.report.shortfallBps
  });
});

/* Full verified settlement reports for an auction, each re-verified against
   the stored signed close (including deterministic re-evaluation) on read. */
app.get('/api/intents/v1/auctions/:intentHash/settlement-reports', async (req, res) => {
  const state = await readAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const listed = await readSettlementReports(state.intentHash, state.close);
  if (listed.error) return res.status(503).json({ error: listed.error });
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json({
    intentHash: state.intentHash,
    closeId: state.close.closeId,
    settlement: settlementSummary(listed.reports),
    reports: listed.reports
  });
});

/*
 * ─── PHASE 5: OUTCOME MARKETPLACE ───────────────────────────────────────────
 * Single-chain outcomes. Signed, bounded outcome bids enter an immutable log
 * ONLY from a registered + declared-BONDED solver, with a transactional
 * admission receipt and a replay-proof nonce. The public POST /bids path stays
 * closed. After a deterministic MAX_GUARANTEED_MINIMUM_V1 close, the winning
 * bid is re-graded with the SAME Phase 3 execution-claim / dispute /
 * adjudication / settlement-report machinery (schema-branched for outcome
 * bids); a failure penalty is DERIVED from the deterministic Phase 3 table.
 * FBT never settles automatically and never holds funds.
 */
function bondedSolverIds() {
  return new Set(
    publicBondBoard(parseBondRegistry(), { solverRegistry: parseSolverRegistry() })
      .filter((row) => row.bonded)
      .map((row) => row.solverId)
  );
}

app.get('/api/intents/v1/outcome/log/:intentHash', async (req, res) => {
  const result = await readOutcomeLog(req.params.intentHash);
  if (result.error) return res.status(result.error === 'LOG_READ_FAILED' ? 503 : 400).json(result);
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json(result);
});

/* The authenticated signed outcome-bid submission path. POST /bids stays
   closed; this is the only way a bid enters the outcome log. */
app.post('/api/intents/v1/outcome/bids', async (req, res) => {
  const registry = parseSolverRegistry();
  if (!registry.size) return res.status(503).json({ error: 'NO_REGISTERED_SOLVERS' });
  const intentHash = String(req.body?.intentHash || '').toLowerCase();
  const result = await withIntentLock(intentHash, async () => {
    if (/^0x[a-f0-9]{64}$/.test(intentHash)) {
      const admission = await outcomeSealStatus(intentHash);
      if (!admission.ok) return { ok: false, code: admission.code };
      if (admission.sealed) return { ok: false, code: 'AUCTION_CLOSED' };
    }
    const appended = await appendOutcomeBid(req.body, {
      registry,
      bondedSolvers: bondedSolverIds()
    });
    if (appended.ok && /^0x[a-f0-9]{64}$/.test(intentHash)) {
      const afterWrite = await outcomeSealStatus(intentHash);
      if (!afterWrite.ok) return { ok: false, code: afterWrite.code };
      if (afterWrite.sealed) {
        return { ok: false, code: 'AUCTION_CLOSE_RACE', storedEntryHash: appended.entryHash };
      }
    }
    if (appended.ok) {
      const receipt = issueOutcomeAdmissionReceipt({
        intentHash,
        entryHash: appended.entryHash,
        acceptedAt: appended.acceptedAt,
        solverId: appended.solverId
      });
      return { ...appended, admissionReceipt: receipt, admissionReceiptAvailable: Boolean(receipt) };
    }
    return appended;
  });
  if (result.ok) return res.status(201).json(result);
  const status = result.code === 'UNREGISTERED_SOLVER' || result.code === 'SOLVER_NOT_BONDED'
    || result.code === 'SIGNATURE_MISMATCH' ? 403
    : ['NONCE_REPLAY', 'AUCTION_CLOSED', 'AUCTION_CLOSE_RACE'].includes(result.code) ? 409
      : ['LOG_WRITE_FAILED', 'LOG_READ_FAILED', 'OUTCOME_STORE_UNAVAILABLE', 'INVALID_STORED_SEAL'].includes(result.code) ? 503 : 400;
  return res.status(status).json({ error: result.code });
});

app.get('/api/intents/v1/outcome/admissions/:intentHash/:entryHash', async (req, res) => {
  const found = await readOutcomeLogEntry(req.params.intentHash, req.params.entryHash);
  if (found.error) {
    const status = found.error === 'LOG_READ_FAILED' ? 503
      : found.error === 'OUTCOME_ADMISSION_NOT_FOUND' ? 404 : 400;
    return res.status(status).json({ error: found.error });
  }
  const receipt = issueOutcomeAdmissionReceipt({
    intentHash: found.entry.bid?.intentHash,
    entryHash: found.entry.entryHash,
    acceptedAt: found.entry.acceptedAt,
    solverId: found.entry.bid?.solverId
  });
  if (!receipt) return res.status(503).json({ error: 'ADMISSION_RECEIPTS_NOT_CONFIGURED' });
  if (!verifyOutcomeAdmissionReceipt(receipt)) return res.status(500).json({ error: 'ADMISSION_RECEIPT_FAILED' });
  res.set('cache-control', 'public, max-age=31536000, immutable');
  return res.json(receipt);
});

app.get('/api/intents/v1/outcome/auctions/:intentHash', async (req, res) => {
  const result = await readOutcomeAuction(req.params.intentHash);
  if (result.error) {
    const status = ['OUTCOME_STORE_UNAVAILABLE', 'INVALID_STORED_SEAL', 'INVALID_STORED_CLOSE'].includes(result.error) ? 503 : 400;
    return res.status(status).json(result);
  }
  if (result.close) {
    const listed = await readOutcomeCompletenessReports(result.intentHash, result.close);
    if (listed.error) {
      result.completeness = { status: 'watcher-store-unavailable', watcherReports: null };
    } else {
      result.completeness = outcomeCompletenessSummary(listed.reports);
      result.watcherReports = listed.reports.map(outcomePublicCompletenessReport);
    }
    try {
      const entry = await readOutcomeLogEntry(result.intentHash, result.close.decision.selectedEntryHash);
      const commitment = entry.entry?.bid || null;
      const claim = await readExecutionClaim(result.close.closeId);
      const claimVerified = claim ? verifyExecutionClaim(claim, { close: result.close, commitment }).ok : null;
      const disputes = await listDisputes(result.close.closeId);
      if (!disputes.ok) throw new Error(disputes.code);
      for (const record of disputes.records) {
        if (!verifyDispute(record.dispute, { close: result.close }).ok) throw new Error('INVALID_STORED_DISPUTE');
      }
      const adjudicationRecord = await readAdjudication(result.close.closeId);
      const adjudicationVerified = adjudicationRecord
        ? verifyAdjudication(adjudicationRecord.adjudication, { close: result.close }).ok : null;
      result.execution = { claim, claimVerified };
      result.disputes = disputes.records.map(publicDispute);
      result.adjudication = adjudicationRecord?.adjudication || null;
      result.adjudicationVerified = adjudicationVerified;
      const settlementListed = await readSettlementReports(result.intentHash, result.close);
      if (settlementListed.error) {
        result.settlement = { status: 'settlement-store-unavailable' };
      } else {
        result.settlement = settlementSummary(settlementListed.reports);
        result.settlementReports = settlementListed.reports.map(publicSettlementReport);
      }
    } catch {
      result.execution = { storeUnavailable: true };
      result.disputes = null;
      result.adjudication = null;
      result.adjudicationVerified = null;
      result.settlement = { status: 'settlement-store-unavailable' };
    }
  }
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json(result);
});

app.post('/api/intents/v1/outcome/auctions/:intentHash/close', async (req, res) => {
  const auth = authenticateAuctionClose(req.get('authorization'));
  if (!auth.ok) {
    return res.status(auth.code === 'AUCTION_CLOSE_NOT_CONFIGURED' ? 503 : 401).json({ error: auth.code });
  }
  if (String(req.body?.intentHash || '').toLowerCase() !== String(req.params.intentHash).toLowerCase()) {
    return res.status(400).json({ error: 'INTENT_HASH_MISMATCH' });
  }
  const result = await closeOutcomeAuction(req.body);
  if (result.ok) return res.status(result.alreadyClosed ? 200 : 201).json(result);
  const status = ['OUTCOME_STORE_UNAVAILABLE', 'OUTCOME_WRITE_FAILED', 'LOG_READ_FAILED',
    'INVALID_STORED_SEAL', 'INVALID_STORED_CLOSE'].includes(result.code) ? 503
    : result.code === 'AUCTION_ALREADY_SEALED' ? 409 : 400;
  return res.status(status).json({ error: result.code });
});

app.post('/api/intents/v1/outcome/auctions/:intentHash/watcher-reports', async (req, res) => {
  const state = await readOutcomeAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const registry = parseWatcherRegistry();
  const checked = verifyOutcomeCompletenessReport(req.body, {
    registry, close: state.close, requireRegistered: true
  });
  if (!checked.ok) {
    const status = ['UNREGISTERED_WATCHER', 'WATCHER_SIGNATURE_MISMATCH'].includes(checked.code) ? 403 : 400;
    return res.status(status).json({ error: checked.code });
  }
  const stored = await storeOutcomeCompletenessReport(state.intentHash, checked.report);
  if (!stored.ok) {
    const status = ['OUTCOME_STORE_UNAVAILABLE', 'OUTCOME_WRITE_FAILED'].includes(stored.code) ? 503
      : stored.code === 'OUTCOME_REPORTS_FULL' ? 409 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyReported ? 200 : 201).json({
    ok: true, alreadyReported: stored.alreadyReported,
    reportId: checked.report.reportId, verdict: checked.report.verdict, counts: checked.report.counts
  });
});

app.get('/api/intents/v1/outcome/auctions/:intentHash/watcher-reports', async (req, res) => {
  const state = await readOutcomeAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const listed = await readOutcomeCompletenessReports(state.intentHash, state.close);
  if (listed.error) return res.status(503).json({ error: listed.error });
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json({
    intentHash: state.intentHash,
    closeId: state.close.closeId,
    completeness: outcomeCompletenessSummary(listed.reports),
    reports: listed.reports
  });
});

/* Outcome execution-claim / dispute / adjudication / settlement-report routes
   reuse the Phase 3 modules (schema-branched for fbt.outcome-bid.v1). The
   winning bid is read from the OUTCOME log, not the swap log. */
app.post('/api/intents/v1/outcome/auctions/:intentHash/execution-claims', async (req, res) => {
  const state = await readOutcomeAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const registry = parseSolverRegistry();
  if (!registry.size) return res.status(503).json({ error: 'NO_REGISTERED_SOLVERS' });
  const entry = await readOutcomeLogEntry(state.intentHash, state.close.decision.selectedEntryHash);
  if (entry.error) return res.status(503).json({ error: entry.error });
  const checked = verifyExecutionClaim(req.body, {
    close: state.close, commitment: entry.entry.bid, registry, requireRegistered: true
  });
  if (!checked.ok) {
    const status = ['UNREGISTERED_SOLVER', 'SIGNATURE_MISMATCH'].includes(checked.code) ? 403 : 400;
    return res.status(status).json({ error: checked.code });
  }
  const stored = await storeExecutionClaim(state.close.closeId, checked.claim);
  if (!stored.ok) {
    const status = ['EXECUTION_STORE_UNAVAILABLE', 'EXECUTION_WRITE_FAILED'].includes(stored.code) ? 503
      : stored.code === 'EXECUTION_CLAIM_CONFLICT' ? 409 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyStored ? 200 : 201).json({
    ok: true, alreadyStored: stored.alreadyStored, claimId: checked.claim.claimId,
    outcome: checked.claim.outcome, claims: checked.claim.claims
  });
});

app.get('/api/intents/v1/outcome/auctions/:intentHash/execution-claim', async (req, res) => {
  const state = await readOutcomeAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const claim = await readExecutionClaim(state.close.closeId);
  if (!claim) return res.status(404).json({ error: 'EXECUTION_CLAIM_NOT_FOUND' });
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json(claim);
});

app.post('/api/intents/v1/outcome/auctions/:intentHash/disputes', async (req, res) => {
  const state = await readOutcomeAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const registry = parseVerifierRegistry();
  if (!registry.size) return res.status(503).json({ error: 'NO_REGISTERED_VERIFIERS' });
  const checked = verifyDispute(req.body, { close: state.close, registry, requireRegistered: true });
  if (!checked.ok) {
    const status = ['UNREGISTERED_VERIFIER', 'SIGNATURE_MISMATCH'].includes(checked.code) ? 403 : 400;
    return res.status(status).json({ error: checked.code });
  }
  const stored = await storeDispute(state.close.closeId, checked.dispute);
  if (!stored.ok) {
    const status = ['DISPUTE_STORE_UNAVAILABLE', 'DISPUTE_WRITE_FAILED'].includes(stored.code) ? 503
      : stored.code === 'DISPUTE_CONFLICT' ? 409 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyStored ? 200 : 201).json({
    ok: true, alreadyStored: stored.alreadyStored, disputeId: checked.dispute.disputeId, kind: checked.dispute.kind
  });
});

app.get('/api/intents/v1/outcome/auctions/:intentHash/disputes', async (req, res) => {
  const state = await readOutcomeAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const listed = await listDisputes(state.close.closeId);
  if (!listed.ok) return res.status(503).json({ error: listed.code });
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json({ intentHash: state.intentHash, closeId: state.close.closeId, disputes: listed.records.map(publicDispute) });
});

app.post('/api/intents/v1/outcome/auctions/:intentHash/adjudicate', async (req, res) => {
  const auth = authenticateAuctionClose(req.get('authorization'));
  if (!auth.ok) {
    return res.status(auth.code === 'AUCTION_CLOSE_NOT_CONFIGURED' ? 503 : 401).json({ error: auth.code });
  }
  const state = await readOutcomeAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const config = coordinatorConfig();
  if (!config) return res.status(503).json({ error: 'AUCTION_CLOSE_NOT_CONFIGURED' });
  const entry = await readOutcomeLogEntry(state.intentHash, state.close.decision.selectedEntryHash);
  if (entry.error) return res.status(503).json({ error: entry.error });
  const claim = await readExecutionClaim(state.close.closeId);
  const disputes = await listDisputes(state.close.closeId);
  if (!disputes.ok) return res.status(503).json({ error: disputes.code });
  const existing = await readAdjudication(state.close.closeId);
  if (existing) {
    const rechecked = verifyAdjudication(existing.adjudication, { close: state.close });
    return rechecked.ok
      ? res.status(200).json({ ok: true, alreadyAdjudicated: true, adjudication: existing.adjudication })
      : res.status(503).json({ error: 'INVALID_STORED_ADJUDICATION' });
  }
  const built = buildAdjudication({
    close: state.close,
    commitment: entry.entry.bid,
    claim,
    disputes: disputes.records.map((record) => record.dispute),
    bond: parseBondRegistry().get(entry.entry.bid.solverId) || null,
    coordinator: config,
    solverRegistry: parseSolverRegistry(),
    now: Date.now()
  });
  if (!built.ok) {
    const status = built.code === 'EXECUTION_WINDOW_OPEN' ? 409
      : ['BAD_EXECUTION_CLAIM', 'BAD_DISPUTE', 'BAD_COMMITMENT_BINDING'].includes(built.code) ? 503 : 400;
    return res.status(status).json({ error: built.code });
  }
  const stored = await storeAdjudication(state.close.closeId, built.adjudication);
  if (!stored.ok) {
    const status = ['ADJUDICATION_STORE_UNAVAILABLE', 'ADJUDICATION_WRITE_FAILED'].includes(stored.code) ? 503
      : stored.code === 'ADJUDICATION_CONFLICT' ? 409 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyStored ? 200 : 201).json({
    ok: true, alreadyStored: stored.alreadyStored, adjudicationId: built.adjudication.adjudicationId,
    verdict: built.adjudication.verdict, penaltyBps: built.adjudication.penaltyBps,
    penaltyUsd: built.adjudication.penaltyUsd, bond: built.adjudication.bond, claims: built.adjudication.claims
  });
});

app.post('/api/intents/v1/outcome/auctions/:intentHash/settlement-reports', async (req, res) => {
  const state = await readOutcomeAuction(req.params.intentHash);
  if (state.error) return res.status(state.error === 'BAD_INTENT_HASH' ? 400 : 503).json(state);
  if (!state.close) return res.status(409).json({ error: 'AUCTION_NOT_CLOSED' });
  const registry = parseVerifierRegistry();
  if (!registry.size) return res.status(503).json({ error: 'NO_REGISTERED_VERIFIERS' });
  const checked = verifySettlementReport(req.body, { registry, close: state.close, requireRegistered: true });
  if (!checked.ok) {
    const status = ['UNREGISTERED_VERIFIER', 'VERIFIER_SIGNATURE_MISMATCH'].includes(checked.code) ? 403 : 400;
    return res.status(status).json({ error: checked.code });
  }
  const stored = await storeSettlementReport(state.intentHash, checked.report);
  if (!stored.ok) {
    const status = ['SETTLEMENT_STORE_UNAVAILABLE', 'SETTLEMENT_WRITE_FAILED'].includes(stored.code) ? 503
      : stored.code === 'SETTLEMENT_REPORTS_FULL' ? 409 : 400;
    return res.status(status).json({ error: stored.code });
  }
  return res.status(stored.alreadyReported ? 200 : 201).json({
    ok: true, alreadyReported: stored.alreadyReported, reportId: checked.report.reportId,
    verdict: checked.report.verdict, adjudicationConsistent: checked.report.adjudicationConsistent,
    promisedOut: checked.report.promisedOut, deliveredOut: checked.report.deliveredOut,
    shortfallBps: checked.report.shortfallBps
  });
});

/*
 * ─── CONFIDENTIAL INTENT TRANSPORT: FAIL-CLOSED ──────────────────────────
 * No requester-authentication protocol, durable private preimage store, or
 * close-bound frontend orchestration is deployed. The read-only discovery
 * route reports those facts. POST routes reject before reading or validating
 * requester-controlled preimages, solver ids, or transaction material.
 */
app.get('/api/intents/v1/confidential/operators', (_req, res) => {
  res.set('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=240');
  return res.json({
    ...confidentialProtocolStatus({ operatorRegistry: parseOperatorRegistry() }),
    operators: publicOperatorRegistry(parseOperatorRegistry())
  });
});

/* Historical public commitment records are not served. Earlier versions used
   a public Blob writer for a combined commitment/preimage record, so even a
   hash-only response would keep an unsafe storage path alive. */
app.get('/api/intents/v1/confidential/commitments/:intentHash', (_req, res) =>
  res.status(503).json({ error: 'CONFIDENTIAL_MODE_UNAVAILABLE', available: false }));

/*
 * ─── INDEXNOW OWNERSHIP KEY, SERVED FROM THE API ────────────────────────────
 * IndexNow proves domain ownership by fetching a key file and checking it
 * contains the key. The obvious place is `public/<key>.txt` at the site root,
 * and that file exists — but Vercel's CDN was still returning 404 for it long
 * after the deploy that added it, while older static files served fine.
 *
 * Rather than guess at CDN propagation, this serves the same key from a route
 * that provably works: /api/* is a serverless function, not a cached static
 * asset, so it is live the moment the function deploys.
 *
 * That is explicitly allowed. From Bing's own documentation:
 *
 *   "Option 2: Host one to many UTF-8 encoded text key files in other
 *    locations within the same host ... you must specify the key file
 *    location as keyLocation URLs parameter value"
 *
 * So the submitter passes this URL as `keyLocation` and the static file
 * remains as a belt-and-braces second copy for whenever the CDN catches up.
 *
 * The key is NOT a secret — publishing it at a public URL IS the ownership
 * proof, which is why it is a literal here rather than an env var. Keeping it
 * in the repository means one grep finds every copy, and a mismatch between
 * them is the failure mode: the submission silently 403s forever.
 */
const INDEXNOW_KEY = 'b5187e6cbc36ff99eb5f2b97efcdfb6e';

app.get(`/api/indexnow-key/${INDEXNOW_KEY}.txt`, (_req, res) => {
  res.type('text/plain; charset=utf-8');
  /* A day: long enough to be cheap, short enough that rotating the key
     propagates without waiting on a CDN. */
  res.set('cache-control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=345600');
  res.send(INDEXNOW_KEY);
});

app.get('/api/me', (req, res) =>
  res.json({ authenticated: Boolean(req.tgUser), user: req.tgUser ?? null, startParam: req.tgStartParam ?? null })
);

app.get('/api/global', (_req, res) => serve(res, 45000)(fetchGlobal, 'global'));

app.get('/api/markets', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const perPage = Math.min(250, Math.max(1, Number(req.query.per_page) || 50));
  const vs = String(req.query.vs || 'usd').toLowerCase();
  return serve(res, 30000)(() => fetchMarkets({ page, perPage, vs }), `markets:${vs}:${page}:${perPage}`);
});

app.get('/api/trending', (_req, res) => serve(res, 120000)(fetchTrending, 'trending'));

app.get('/api/chart/:id', (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 1));
  const vs = String(req.query.vs || 'usd').toLowerCase();
  return serve(res, 60000)(() => fetchChart(req.params.id, days, vs), `chart:${req.params.id}:${days}:${vs}`);
});

/**
 * CANDLES for the coin page.
 *
 * Separate from /api/chart because the upstream is a different endpoint with
 * different data: /market_chart gives closes only, /ohlc gives the four
 * numbers a candle needs. The high and low are exactly what a line chart
 * cannot express, which is why this exists at all.
 *
 * Same 60s TTL as the line chart — they are read side by side and a shorter
 * TTL here would just double our upstream traffic for two views of one truth.
 */
app.get('/api/ohlc/:id', (req, res) => {
  const days = Number(req.query.days) || 30;
  const vs = String(req.query.vs || 'usd').slice(0, 8);
  return serve(res, 60000)(() => fetchOhlc(req.params.id, days, vs), `ohlc:${req.params.id}:${days}:${vs}`);
});

app.get('/api/coin/:id', (req, res) =>
  serve(res, 120000)(() => fetchCoinDetail(req.params.id), `coin:${req.params.id}`)
);

/*
 * COIN SEARCH.
 *
 * `fetchSearch` was imported at the top of this file and then never routed —
 * the same "imported but never mounted" failure that hit push, leaderboard and
 * the watch routes. `/api/search?q=btc` answered `{"error":"NOT_FOUND"}` on the
 * live site while the import sat there looking correct.
 *
 * The client (src/lib/api.js searchCoins) hides this: when the backend 404s it
 * silently falls through to the public CoinGecko endpoint, which is rate
 * limited per user IP. So search "worked" while quietly bypassing our cache
 * and burning the user's own quota.
 */
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 64);
  if (q.length < 2) return res.json([]);
  return serve(res, 120000)(() => fetchSearch(q), `search:${q.toLowerCase()}`);
});

/*
 * NEWS.
 *
 * Same story: `fetchNews` imported, no route. The client then fell back to
 * public RSS through a third-party JSON bridge from every device — which is
 * exactly what aggregating server-side was supposed to avoid (one upstream
 * request per day for everyone, instead of one per user per open).
 *
 * TTL is 30 minutes rather than the 24h the client caches for: the client
 * decides how long to keep it, the server only decides how often to refetch.
 */
app.get('/api/news', (_req, res) => serve(res, 1_800_000)(fetchNews, 'news'));

/*
 * WHALE TRACKING — recent large transfers across our supported chains.
 *
 * Real RPC/explorer data only. No fabricated events. The short TTL (60s)
 * keeps the feed fresh without hammering public RPCs; CDN caching via
 * s-maxage means most hits come from edge cache rather than origin.
 *
 * Query params:
 *   minUsd  — minimum fiat value (default 100000)
 *   chains  — comma-separated chain short codes (e.g. ETH,BSC,BASE)
 *   q       — token symbol/name substring filter
 *   since   — epoch ms, drop events older than this
 *   vs      — fiat currency code (default usd), must be one CoinGecko prices
 *   limit   — max events to return (default 40, cap 100)
 */
app.get('/api/news/whales', async (req, res) => {
  const minUsd = Math.max(1000, Math.min(100_000_000, Number(req.query.minUsd) || 100_000));
  const chains = String(req.query.chains || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const q = String(req.query.q || '').slice(0, 32);
  const since = Math.max(0, Number(req.query.since) || 0);
  const vs = String(req.query.vs || 'usd').slice(0, 8);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 40));
  try {
    const { value, cached, stale } = await cachedWhales({ minUsd, chains, tokenQuery: q, since, vs, limit });
    res.set('cache-control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=240');
    if (stale) res.set('x-data-stale', '1');
    if (cached) res.set('x-cache', 'HIT');
    return res.json(value);
  } catch (err) {
    return res.status(502).json({
      error: 'WHALES_UNAVAILABLE',
      schema: 'fbt.whales.v1',
      detail: String(err.message).slice(0, 160)
    });
  }
});

/*
 * CRYPTO RADIO — spoken news from real podcast feeds.
 *
 * Cached for 30 minutes, same as headlines and for the same reason: these
 * shows publish once a day at most, so re-fetching four RSS documents per
 * visitor would spend our request budget to learn nothing new.
 *
 * Audio and not video. See server/audio.js for the whole argument, but the
 * short version is that youtube.com does not resolve on most Iranian
 * networks, so an embedded live stream would render as a permanently grey box
 * for the primary audience. Podcast MP3s are ordinary HTTPS files from CDNs
 * that are reachable, need no SDK, and keep playing with the screen off.
 */
/*
 * ─── WHY THIS ONE IS PERSISTENTLY CACHED AND /api/news IS NOT ─────────────
 *   «در اخبار قسمت رادیو هم دیر میاد»
 *
 * The radio tab was slow, and the memory cache above is the reason it stayed
 * slow no matter how long the TTL was. On Vercel every cold start begins with
 * an EMPTY Map, so `serve()` re-fetched four RSS documents from four
 * different podcast hosts — and because `fetchAudio` waits for all four, the
 * response could not arrive until the SLOWEST of them did. Measured against
 * the timeout that used to apply, that was up to 12 seconds of staring at a
 * skeleton, on a feature whose content changes once a day.
 *
 * Blob storage survives cold starts, so the fetch happens roughly twice an
 * hour for the whole site instead of once per visitor who got unlucky. It
 * degrades to memory-only when the token is missing, which is exactly what
 * happens in local development — the feature still works, it is just as slow
 * as it used to be.
 */
app.get('/api/audio', async (_req, res) => {
  try {
    const { value, cached, tier } = await withPersistentCache(
      'audio',
      1_800_000,
      fetchAudio,
      memoryStore
    );
    res.set('cache-control', 'public, max-age=900, s-maxage=900, stale-while-revalidate=3600');
    if (cached) res.set('x-cache', tier.toUpperCase());
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/*
 * CALM MUSIC — the third news tab.
 *
 * Persistently cached like /api/audio and for a stronger reason: this endpoint
 * costs up to eleven upstream requests (three searches plus one metadata
 * lookup per item), and archive.org is a charity running on donated
 * bandwidth. Re-running that per visitor would be rude as well as slow.
 *
 * Six hours rather than thirty minutes. Podcast feeds publish daily; a
 * public-domain music catalogue from 2008 does not change at all, so there is
 * nothing to gain from asking more often.
 */
app.get('/api/calm', async (req, res) => {
  try {
    /*
     * ?force=1 — bypass the long-lived READ (not the write).
     *
     * Exists for one incident shape: an empty `{items: []}` generation was
     * cached for six hours and the tab went dark for everyone until expiry.
     * The refresh button and the Retry affordance pass it so "try again" can
     * actually reach the upstream instead of re-serving a poisoned cache.
     */
    const force = req.query.force === '1';

    /*
     * An EMPTY catalogue is never cached.
     *
     * `fetchCalm` degrades per-mood with allSettled, so a full archive.org
     * outage used to produce a VALID-looking `{ items: [], moodsOk: 0 }` —
     * which withPersistentCache then pinned to memory AND Blob for six
     * hours. The fix is upstream-shaped: throw here, before either cache
     * layer sees it, so the next request regenerates and the client receives
     * a real 502 it can show as an error with a Retry button, instead of an
     * honest-looking empty state that hides a failure.
     */
    const produce = async () => {
      const value = await fetchCalm();
      if (!calmResultIsUsable(value)) {
        throw new Error(`CALM_EMPTY: 0 tracks (moods ${value?.moodsOk ?? 0}/${value?.moodsTotal ?? '?'})`);
      }
      return value;
    };

    const TTL = 6 * 3600_000;
    const CACHE_HEADERS = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=14400';
    /* Write back BOTH tiers so the next reader gets the fix as well. The blob
       write is fire-and-forget, exactly as withPersistentCache does it: a
       cache write must never fail the request it caches. */
    const writeBack = (value) => {
      memoryStore?.set('calm', { value, expires: Date.now() + TTL, at: Date.now() });
      blobSet('calm', value, TTL).catch(() => {});
    };

    if (force) {
      const value = await produce();
      writeBack(value);
      res.set('cache-control', CACHE_HEADERS);
      res.set('x-cache', 'BYPASS');
      return res.json(value);
    }

    const { value, cached, tier } = await withPersistentCache(
      'calm',
      TTL,
      produce,
      memoryStore
    );

    /*
     * A POISONED legacy entry: the pre-fix code cached empty catalogues for
     * six hours (Blob survives deploys), which is what emptied the tab for
     * everyone. A cached-but-empty answer must be regenerated once on read,
     * not loyally re-served — deploys do not flush Blob, so this check is
     * the only thing that evicts it.
     */
    if (!calmResultIsUsable(value)) {
      const fresh = await produce();
      writeBack(fresh);
      res.set('cache-control', CACHE_HEADERS);
      res.set('x-cache', 'REGENERATED');
      return res.json(fresh);
    }

    res.set('cache-control', CACHE_HEADERS);
    if (cached) res.set('x-cache', tier.toUpperCase());
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'CALM_UNAVAILABLE', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/prices', (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (!ids.length) return res.json({});
  return serve(res, 20000)(() => fetchSimplePrices(ids), `prices:${ids.sort().join(',')}`);
});

/* ------------------------------- AI routes ------------------------------- */
/* Keys stay here. Responses cached hard so cost stays flat as users grow.    */

const AI_TTL = Number(process.env.AI_CACHE_TTL_MS || 6 * 3600_000); // 6h

app.get('/api/ai/status', (_req, res) =>
  res.json({ enabled: aiConfigured(), news: newsConfigured(), persistentCache: blobConfigured() })
);

/**
 * Live AI diagnosis: actually calls the provider and reports why it failed.
 *
 * Guarded by CRON_SECRET because it costs a real (tiny) amount per call and
 * because the response describes your configuration. Without the secret set,
 * it still runs but only reports which keys are PRESENT — never their values,
 * and never a live call. That keeps it useful on a fresh deploy without
 * turning it into a free inference endpoint for strangers.
 */
app.get('/api/ai/diagnose', async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  /*
   * Accept the secret as a query parameter as well as a header.
   *
   * The note below used to say `?Authorization: Bearer <CRON_SECRET>`, but a
   * leading `?` means a QUERY STRING while the code only ever read headers.
   * So the instruction was impossible to follow from a phone browser — the one
   * place this endpoint is actually opened — and the live test could never be
   * reached. Either the note or the code had to change; supporting `?key=` is
   * the one that helps, since typing a custom header on a phone is not
   * realistic.
   *
   * This is a diagnostic, not an authenticated action: it moves no money and
   * returns booleans, never key values. A secret in a URL can leak through
   * logs and referrers, so it stays acceptable ONLY because of that.
   */
  const provided =
    req.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.get('x-cron-secret') ||
    String(req.query.key || '') ||
    '';

  if (secret && provided !== secret) {
    return res.json({
      ok: aiConfigured(),
      /*
       * Report EVERY provider, not just two. Groq was omitted here, so a
       * working Groq setup showed `geminiKeyPresent:false,
       * openrouterKeyPresent:false` next to `enabled:true` — which reads as
       * "it works but nothing is configured" and sends you looking for a
       * problem that does not exist.
       */
      groqKeyPresent: Boolean(process.env.GROQ_API_KEY),
      geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
      openrouterKeyPresent: Boolean(process.env.OPENROUTER_API_KEY),
      enabled: aiConfigured(),
      note: 'Append ?key=<CRON_SECRET> to run a live provider test.'
    });
  }

  try {
    return res.json(await aiSelfTest());
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err.message).slice(0, 200) });
  }
});

app.post('/api/ai/outlook', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' });
  const { id, symbol, name, price, indicators, change24h, change7d, lang } = req.body ?? {};
  if (!id || !symbol) return res.status(400).json({ error: 'BAD_REQUEST' });

  // One entry per coin per language per day — a daily briefing doesn't need
  // regenerating for every user who opens the screen.
  const day = new Date().toISOString().slice(0, 10);
  const key = `ai:outlook:${id}:${lang || 'en'}:${day}`;

  try {
    const { value, cached, tier } = await withPersistentCache(
      key,
      AI_TTL,
      () => generateOutlook({ symbol, name, price, indicators, change24h, change7d, lang }),
      memoryStore
    );
    res.set('x-cache', cached ? `HIT:${tier}` : 'MISS');
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'AI_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.post('/api/ai/brief', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' });
  const { global: g, top, lang } = req.body ?? {};
  const day = new Date().toISOString().slice(0, 10);
  const hour = new Date().getUTCHours();
  // refresh the market brief every 6 hours
  const key = `ai:brief:${lang || 'en'}:${day}:${Math.floor(hour / 6)}`;

  try {
    const { value, cached, tier } = await withPersistentCache(
      key,
      AI_TTL,
      () => generateMarketBrief({ global: g, top, lang }),
      memoryStore
    );
    res.set('x-cache', cached ? `HIT:${tier}` : 'MISS');
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'AI_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/*
 * /api/ai/faq was removed with the Help chat box. Support questions are now
 * answered by a browsable FAQ built from src/lib/faqLocal.js — hand-written,
 * checked against what the code does, and impossible to hallucinate a fee or
 * a recovery path from. See the header of src/pages/Help.jsx.
 */

/**
 * SECTOR CATEGORY — gold, memecoins, RWA and friends.
 *
 * Proxied so the browser never talks to CoinGecko directly on this path and
 * so one server-side cache serves every user. The slug is allow-listed
 * against the client's own map rather than passed through: an open proxy to
 * an upstream API is a way to get our IP rate-limited by a stranger.
 */
app.get('/api/category/:slug', (req, res) => {
  const slug = String(req.params.slug || '').slice(0, 60);
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'BAD_CATEGORY' });
  const perPage = Math.min(100, Math.max(1, Number(req.query.per_page) || 50));
  const vs = /^[a-z]{2,5}$/.test(String(req.query.vs || '')) ? String(req.query.vs) : 'usd';
  return serve(res, 300_000)(
    () => fetchCategory(slug, { perPage, vs }),
    `cat:${slug}:${vs}:${perPage}`
  );
});

/* ------------------------------ cross-chain ------------------------------- */
/*
 * Bridging via LI.FI. Proxied so the API key never reaches the browser and so
 * the fee parameters cannot be supplied by a caller — see server/bridge.js for
 * why the allow-list is the security boundary rather than a preference.
 */

app.get('/api/bridge/status', async (_req, res) => {
  try {
    res.set('cache-control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=1200');
    return res.json(await bridgeStatus());
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/bridge/quote', async (req, res) => {
  try {
    const { ok, status, body } = await bridgeQuote(req.query);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/*
 * ─── THE SECOND BRIDGE, AT MORE THAN TWICE THE FEE ──────────────────────────
 * deBridge DLN pays us 70 bps where LI.FI pays 30, needs no key and no
 * account. It is NOT a replacement: DLN adds a FIXED protocol fee in the
 * origin chain's native coin, which is negligible on a large transfer and
 * ruinous on a small one. Both are quoted and the user picks — see
 * server/dln.js for the measured numbers behind that decision.
 *
 * Same security boundary as LI.FI: the affiliate parameters are set on the
 * server and are never accepted from the query string.
 */
app.get('/api/dln/status', (_req, res) => {
  res.set('cache-control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=1200');
  return res.json(dlnStatus());
});

app.get('/api/dln/quote', async (req, res) => {
  try {
    const { ok, status, body } = await dlnQuote(req.query);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/dln/tx', async (req, res) => {
  try {
    const { ok, status, body } = await dlnCreateTx(req.query);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/* -------------------------------- gasless --------------------------------- */
/*
 * Swaps for users with no native coin. See server/gasless.js — the short
 * version is that someone holding USDT and no BNB can currently do nothing at
 * all in this app, and that is the most common dead end in crypto.
 *
 * Proxied so the 0x key stays server-side and so the fee parameters cannot be
 * supplied by a caller.
 */

app.get('/api/gasless/status', (_req, res) => {
  res.set('cache-control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=1200');
  res.json(gaslessStatus());
});

app.get('/api/gasless/price', async (req, res) => {
  try {
    const { ok, status, body } = await gaslessPrice(req.query);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/gasless/quote', async (req, res) => {
  try {
    const { ok, status, body } = await gaslessQuote(req.query);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.post('/api/gasless/submit', async (req, res) => {
  try {
    const { ok, status, body } = await gaslessSubmit(req.body);
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/dex/:network', (req, res) =>
  serve(res, 60000)(() => fetchDexPools(req.params.network), `dex:${req.params.network}`)
);

/**
 * LIVE YIELDS — the Farm screen's data.
 *
 * ─── WHY THIS IS A SERVER ROUTE AND NOT A CLIENT FETCH ──────────────────────
 * The upstream (`yields.llama.fi/pools`) is free and keyless, which is the
 * only reason this feature is possible at all — but it returns EVERY pool
 * DefiLlama tracks, over 20,000 of them and several megabytes. Sending that to
 * a phone on an Iranian mobile connection to render eight rows would be
 * indefensible.
 *
 * Filtered here down to a few dozen rows. See server/yields.js for the safety
 * rules; the short version is that an unfiltered yield list sorted by APY is
 * a list sorted by scam.
 *
 * ─── ONE HOUR, NOT ONE MINUTE ───────────────────────────────────────────────
 * These are variable rates that move on the scale of days. A shorter TTL would
 * multiply our upstream traffic against a free service we depend on, for a
 * number that would look identical. Being a good citizen of a free API is also
 * how it stays free.
 */
app.get('/api/yields', (_req, res) => serve(res, 3_600_000)(fetchYields, 'yields'));

/**
 * LIVE DATA FOR THE CURATED SOLANA ASSETS — liquid staking + tokenized equities.
 *
 * The mint list is hard-coded (src/lib/solanaAssets.js) because searching for
 * these by name is actively dangerous: querying Jupiter for "AAPLx" returns
 * seven tokens, one real and six pump.fun clones carrying the same name, the
 * same symbol and in two cases the same scraped logo. This route fetches BY
 * MINT ADDRESS and re-checks the issuer authority on every refresh, so a stale
 * or mistyped address makes a row disappear rather than offering a stranger's
 * token under Apple's name.
 *
 * Five minutes rather than the hour used for /api/yields: these carry a live
 * PRICE, and a quote screen showing an hour-old equity price would be
 * misleading in a way an hour-old APY is not.
 */
app.get('/api/solana/assets', (_req, res) => serve(res, 300_000)(fetchSolanaAssets, 'solana-assets'));

/**
 * AVANTIS EQUITIES — the ticker list for the Stocks screen.
 *
 * Asked for: the stocks themselves on the stocks page, not just an advert.
 * See server/avantis.js for why the LIST comes from Avantis and not from UTEX
 * (UTEX geo-blocks our server outright, so there is no list to read) and why
 * both upstreams here are public and keyless.
 *
 * 60s rather than the 300s used for /api/solana/assets. These are live venue
 * prices during US market hours, and this list sits directly above a link that
 * sends the reader to go and trade on them.
 */
app.get('/api/avantis/equities', (_req, res) =>
  serve(res, 60_000)(fetchAvantisEquities, 'avantis-equities'));

/* -------------------------- dYdX public indexer --------------------------- */
/*
 * These are read-only same-origin proxies. The browser must not call the
 * public indexer directly: some deployments reject the request during CORS
 * preflight, and the dYdX client itself imports Node's proxy-agent package
 * when its full order module is loaded. Keep public market/account data on the
 * same origin and leave signing/order submission in the browser wallet path.
 */
app.get('/api/dydx/markets', (_req, res) =>
  serve(res, 30_000)(fetchDydxMarkets, 'dydx-markets')
);

app.get('/api/dydx/orderbook/:ticker', (req, res) => {
  const ticker = String(req.params.ticker || '').toUpperCase();
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(ticker)) {
    return res.status(400).json({ error: 'BAD_DYDX_TICKER' });
  }
  return serve(res, 5_000)(() => fetchDydxOrderbook(ticker), `dydx-orderbook:${ticker}`);
});

app.get('/api/dydx/account/:address/:number', async (req, res) => {
  try {
    const address = String(req.params.address || '').toLowerCase();
    const number = Number(req.params.number);
    const account = await fetchDydxAccount(address, number);
    /* Account data is public but belongs to one address; do not let a shared
       cache serve one trader's response to another request. */
    res.set('cache-control', 'no-store');
    return res.json(account);
  } catch (error) {
    const status = Number(error?.status) === 404 ? 404 : Number(error?.status) === 400 ? 400 : 502;
    return res.status(status).json({ error: error?.message || 'DYDX_UPSTREAM_FAILED' });
  }
});

/* -------------------------- Ostium public data --------------------------- */
/*
 * Ostium's prices and GraphQL subgraph are public. Proxying both fixed
 * upstreams removes the browser CORS failure without exposing a general URL
 * fetcher. The subgraph route is POST because it carries the query document
 * and, for positions, the public wallet address as variables.
 */
app.get('/api/ostium/prices', (_req, res) =>
  serve(res, 10_000)(fetchOstiumPrices, 'ostium-prices')
);

app.post('/api/ostium/subgraph', async (req, res) => {
  try {
    const data = await fetchOstiumSubgraph(req.body);
    res.set('cache-control', 'no-store');
    return res.json(data);
  } catch (error) {
    const status = Number(error?.status) === 400 ? 400 : 502;
    return res.status(status).json({ error: error?.message || 'OSTIUM_UPSTREAM_FAILED' });
  }
});

/* --------------------------------- shop ---------------------------------- */
/*
 * SPEND CRYPTO ON REAL THINGS — gift cards, top-ups, eSIMs, travel.
 *
 * See server/shop.js for the provider audit and for why we never touch the
 * buyer's money: Cryptorefills is the Merchant of Record, so this stays a
 * non-custodial app.
 *
 * These three routes hand-roll their caching instead of using `serve()`,
 * because `serve()` takes a single fixed cache key and every one of these is
 * keyed by user input — country, and brand family. One shared key would serve
 * the Turkish catalogue to a shopper in the UAE.
 */
const shopRoute = (res, work) =>
  work
    .then(({ value }) => {
      res.set('cache-control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=1200');
      res.json(value);
    })
    .catch((err) =>
      res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) })
    );

app.get('/api/shop/countries', (_req, res) => shopRoute(res, shopCountries()));

/*
 * The end user's IP and user-agent are forwarded to the provider on the two
 * catalogue calls — they require it, and it is why `req` is threaded through.
 */
app.get('/api/shop/catalogue', (req, res) =>
  shopRoute(res, getShopCatalogue(req.query.country, req)));

app.get('/api/shop/products', (req, res) =>
  shopRoute(res, getShopProducts({ country: req.query.country, family: req.query.family }, req)));

/**
 * PERPETUAL FUNDING RATES — the Perp screen's data.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The Perp screen showed a spot price and three links. The one number that
 * decides whether a leveraged position is expensive to HOLD — funding — was
 * described in prose and never shown, even though it differs by several
 * percent a year between venues for the identical trade.
 *
 * ─── FIVE MINUTES ───────────────────────────────────────────────────────────
 * Shorter than /api/yields (an hour) because funding moves intraday and can
 * flip sign within a session; longer than the market feed (30s) because it is
 * settled at most hourly, so a fresher figure would be the same figure at
 * twelve times the upstream cost against a free service.
 *
 * See server/perp.js for the rule that shapes the whole module: a venue whose
 * settlement interval we have not verified is DROPPED, because annualising a
 * rate without its interval produces a confident wrong number.
 */
app.get('/api/perp/markets', (_req, res) => serve(res, 300_000)(fetchPerpMarkets, 'perp-markets'));

/**
 * CONTRACT ADDRESS → COINGECKO ID, for the automatic-order screen.
 *
 * ─── WHY THIS ROUTE EXISTS ──────────────────────────────────────────────────
 * An automatic order needs a PRICE FEED, not just a token. The order screen
 * was therefore limited to the 36 hand-curated entries in `chains.js` that
 * carry a `coingeckoId`, while the swap screen already offers thousands.
 *
 * This resolves the id for any token the user picks. See server/coinIndex.js
 * for why the upstream (the whole CoinGecko coin list, ~20 MB) can never be
 * fetched by a phone, and why an unresolvable address returns null rather than
 * a guess — an order watching the wrong coin's price is worse than no order.
 *
 * Not wrapped in `serve()`: the response depends on the query, and that helper
 * caches per key. coinIndex.js does its own six-hour caching of the expensive
 * part, so each call here is a Map lookup.
 */
/**
 * TOKEN SECURITY — honeypot / tax / holders / liquidity.
 *
 * Proxied so the browser never talks to GoPlus (which tokens a user is about
 * to buy is a shopping list) and so one cache serves every viewer of the same
 * contract. Failures return { report: null } rather than 502: the swap screen
 * must still work when a scanner is down.
 */
app.get('/api/token-risk', async (req, res) => {
  try {
    const out = await fetchTokenRisk(req.query.chainId, req.query.address);
    if (out.error === 'UNSUPPORTED_CHAIN' || out.error === 'BAD_ADDRESS') {
      return res.status(400).json(out);
    }
    res.set('cache-control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=1200');
    return res.json(out.report != null || out.raw != null ? out : { report: null, error: out.error || 'UPSTREAM' });
  } catch (err) {
    return res.json({ report: null, error: 'UPSTREAM', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/coin-id/:chainId', async (req, res) => {
  try {
    const out = await resolveIds(req.params.chainId, req.query.addresses);
    if (out.error) return res.status(400).json(out);
    /* An id mapping is near-permanent; let the browser hold it for an hour. */
    res.set('cache-control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=14400');
    return res.json(out);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/*
 * GET /api/coin-venue/:id — "can we trade this coin, and where?"
 *
 * The coin page used to answer that from a 46-entry hand-written table and
 * told the user "no" for everything else, including Solana tokens our own
 * /solana screen trades happily. Reported as «بعضی از کویین ها مثل پنگوئن
 * میگه نمیشه سواپ کرد». See server/coinVenue.js.
 *
 * Not wrapped in `serve()` for the same reason as /api/coin-id: the response
 * depends on the path parameter, and that helper caches per fixed key.
 */
app.get('/api/coin-venue/:id', async (req, res) => {
  try {
    const out = await resolveVenue(req.params.id);
    if (out.error) return res.status(400).json(out);
    res.set('cache-control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=14400');
    return res.json(out);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/* ------------------------- THORChain native swaps ------------------------- */
/*
 * Real BTC for real ETH — no wrapping, no bridge holding the coins. Our EVM
 * aggregator cannot do this, so it adds a trade rather than re-routing one we
 * already earn on.
 *
 * The affiliate address is attached SERVER-SIDE and never read from the
 * query, same rule as the LI.FI bridge: a caller who could set it would point
 * our commission at their own wallet.
 */
app.get('/api/thor/status', (_req, res) => res.json(thorStatus()));

/*
 * Pools are cached for five minutes and NOT longer, deliberately. This is the
 * list the UI uses to decide which pairs to offer, and THORChain halts
 * individual chains regularly — BSC, Solana and Base were all halted while
 * this was written. A stale list means offering a pair that cannot trade,
 * which is the dead-button failure this project keeps removing.
 */
app.get('/api/thor/pools', (_req, res) =>
  serve(res, 300_000)(fetchThorPools, 'thor-pools'));

app.get('/api/thor/quote', async (req, res) => {
  try {
    const out = await thorQuote({
      from: req.query.from,
      to: req.query.to,
      amount: req.query.amount,
      destination: req.query.destination,
      streaming: req.query.streaming === '1'
    });
    if (out.error) return res.status(400).json(out);
    /* Never cached: the response carries an inbound address and an expiry,
       and their own warning says "Do not cache this response." */
    res.set('cache-control', 'no-store');
    return res.json(out);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/* ---------------------------- fiat buy & sell ----------------------------- */
/*
 * Money in, crypto out — and crypto out, money in. NOT crypto-to-crypto:
 * that is our own product and routing it to a partner would be handing over
 * a customer we already have. See server/fiat.js, where `assertFiatLeg`
 * makes a crypto-to-crypto pair impossible to request.
 */
app.get('/api/fiat/status', (_req, res) => res.json(fiatStatus()));

/*
 * Limits. Keyless upstream, so it answers even before ChangeNOW switch our
 * fiat access on — which is the point: a user who cannot yet buy still gets
 * to see the real minimum instead of an empty form.
 */
app.get('/api/fiat/range', async (req, res) => {
  try {
    const { ok, status, body } = await fiatRange(req.query);
    return res.status(ok ? 200 : status).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/fiat/quote', async (req, res) => {
  try {
    const { ok, status, body } = await fiatQuote(req.query);
    return res.status(ok ? 200 : status).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/*
 * The call that actually earns.
 *
 * Commission is attributed to completed TRANSACTIONS, not to quotes. Without
 * this route the integration could price a purchase and never make a cent —
 * the "wired to nothing" failure already shipped twice on this project.
 *
 * POST because it creates something upstream and must never be reachable by
 * following a link: a GET that provisions a payment session can be triggered
 * by a crawler, a prefetch, or an <img> tag on somebody else's page.
 */
app.post('/api/fiat/order', async (req, res) => {
  try {
    const { ok, status, body } = await fiatOrder(req.body ?? {});
    return res.status(ok ? 200 : status).json(body);
  } catch (err) {
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});


/* --------------------------------- Solana --------------------------------- */
/*
 * Jupiter proxy. The client cannot hold the API key — a VITE_ variable is
 * compiled into the browser bundle and the APK — so these two routes exist to
 * attach it server-side. See server/solana.js for why the parameter list is an
 * allow-list rather than a pass-through.
 *
 * Placed above the AI budget's siblings but under the same /api rate limit as
 * everything else; these calls are cheap for us (one upstream request) and the
 * expensive-endpoint budget is reserved for the model routes.
 */
app.get('/api/solana/status', (_req, res) =>
  res.json({
    configured: jupiterConfigured(),
    // The honest signal the UI needs: swaps work without this, but our fee is
    // silently zero, which looks identical to a working integration.
    feeReady: Boolean(referralAccount()),
    referralAccount: referralAccount() || null
  })
);

app.get('/api/solana/order', async (req, res) => {
  const r = await solanaOrder(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.post('/api/solana/execute', async (req, res) => {
  const r = await solanaExecute(req.body);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

/*
 * Solana via OpenOcean — the path that actually pays us.
 *
 * Jupiter above earns zero and cannot be fixed without on-chain account
 * creation we have no SOL for; see server/solanaOcean.js for the decoded
 * proof that this route splits a real 0.70% inside the swap transaction.
 *
 * `referrer` and `referrerFee` are attached server-side and are NOT in any
 * forwarded parameter list — from the browser they are unreachable, so nobody
 * can redirect our revenue or inflate the rate in our name.
 */
app.get('/api/solana/oo/status', (_req, res) => res.json(oceanStatus()));

app.get('/api/solana/oo/quote', async (req, res) => {
  const r = await oceanQuote(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/solana/oo/swap', async (req, res) => {
  const r = await oceanSwap(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

/*
 * EVM swap aggregator proxy — the same-origin fallback that keeps swaps
 * working for users whose network cannot reach the aggregator APIs directly
 * (geo-filtering, ISP blocks, national censorship — see server/swapProxy.js
 * and the file headers in lib/aggregator.js / lib/openocean.js).
 *
 * The client calls these only after its DIRECT call to the aggregator failed
 * at the network layer; the request is forwarded verbatim from here, so the
 * response is byte-for-byte what the direct call would have returned.
 */
app.get('/api/swap/kyber/routes', async (req, res) => {
  const r = await proxyKyberRoutes(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.post('/api/swap/kyber/build', async (req, res) => {
  const r = await proxyKyberBuild(req.body ?? {});
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/swap/oo/quote', async (req, res) => {
  const r = await proxyOoQuote(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/swap/oo/swap', async (req, res) => {
  const r = await proxyOoSwap(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

/*
 * Cross-chain swaps, and the only route in the app that reaches TRON.
 *
 * The fee fields are attached in server/crosschain.js and are absent from
 * anything a caller can set, for the same reason as every other fee path:
 * exposed, they would let a stranger redirect our revenue.
 *
 * /probe is read-only and exists because the 0x key lives in Vercel and
 * cannot be exercised from a laptop. It answers whether Tron genuinely works
 * on OUR key rather than whether the documentation says it should.
 */
/*
 * One place to see every revenue line and what each is waiting on.
 *
 * The owner works from a phone and cannot read the source, and has been told
 * "it is ready, just set the variable" for five separate features. That claim
 * was unverifiable until now, which is the same shape as the "wired to
 * nothing" bug this repo has shipped three times.
 *
 * Reports booleans only, never the configured values.
 */
app.get('/api/revenue/readiness', (_req, res) => res.json(revenueReadiness()));

app.get('/api/xchain/status', (_req, res) => res.json(crossChainStatus()));

app.get('/api/xchain/probe', async (_req, res) => {
  const r = await crossChainProbe();
  return res.status(r.status).json(r.body);
});

app.get('/api/xchain/quotes', async (req, res) => {
  const r = await crossChainQuotes(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

/* -------------------------------- support --------------------------------- */
/*
 * "Ask the AI" in Help.
 *
 * The client matches its local FAQ first and only calls this when the local
 * matcher is not confident, so the common questions never reach a model at
 * all — a hand-written answer about our own fee structure is strictly better
 * than a generated one, and free.
 *
 * `context` is the FAQ text the client already matched. The prompt in ai.js
 * forbids answering beyond it, which is what stops a model inventing a fee.
 */
app.post('/api/ai/ask', async (req, res) => {
  if (!aiConfigured()) return res.status(503).json({ error: 'AI_NOT_CONFIGURED' });

  const { question, context, lang } = req.body ?? {};
  if (typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'EMPTY_QUESTION' });
  }

  try {
    const out = await answerSupportQuestion({
      question,
      context: Array.isArray(context) ? context : [],
      lang: typeof lang === 'string' ? lang.slice(0, 5) : 'fa'
    });
    return res.json(out);
  } catch (err) {
    const msg = String(err.message || '');
    // 503 not 500: the feature is unavailable, not broken. The client shows
    // the local FAQ instead of an error.
    const status = msg.includes('NOT_CONFIGURED') ? 503 : 502;
    return res.status(status).json({ error: 'AI_FAILED', detail: msg.slice(0, 200) });
  }
});

/* ------------------------------ order watch -------------------------------- */
/*
 * Server-side price watching for limit orders, so an alert arrives with the
 * app closed.
 *
 * PRIVACY: the payload carries no wallet address and no amount — see
 * server/watch.js. A watch list is a behavioural profile, and the less of one
 * we hold the less there is to leak. The server needs neither field to decide
 * whether a price was hit.
 *
 * This can never execute a swap. There is no signer, allowance or router in
 * this path by design.
 */
app.post('/api/orders/watch', async (req, res) => {
  const { endpoint, items, lang } = req.body ?? {};
  try {
    const out = await putWatches(endpoint, items, lang);
    return res.json({ ok: true, ...out });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message).slice(0, 80) });
  }
});

app.post('/api/orders/unwatch', async (req, res) => {
  const { endpoint } = req.body ?? {};
  if (typeof endpoint !== 'string') return res.status(400).json({ error: 'BAD_ENDPOINT' });
  return res.json({ ok: true, ...(await clearWatches(endpoint)) });
});

/**
 * Deliver one order alert to the device it is addressed to, routing by that
 * device's push transport.
 *
 * ─── WHY THIS IS SHARED AND NOT INLINE ──────────────────────────────────────
 * The same callback is handed to runWatchCycle() from BOTH /api/cron/watch and
 * the daily cron. When it lived inline in /api/cron/watch, the daily cron ran
 * the watch cycle with NO callback at all — `send` was undefined, so every
 * triggered order hit `send(...)` → `TypeError: send is not a function` →
 * caught silently → `ok: false` → the alert was never pushed (and, because the
 * cooldown only starts on a successful send, it re-triggered forever without
 * ever delivering). The "app closed" order alert was therefore dead for every
 * user, on both web push and FCM.
 *
 * One helper used by both callers makes that class of drift impossible again:
 * if the routing logic is wrong it is wrong in one place, and a wiring check
 * asserts both callers pass it.
 *
 * Returns a boolean (true = delivered) so runWatchCycle only starts a cooldown
 * on a genuine send.
 */
async function sendWatchAlert(endpoint, lang, payload) {
  const { sendToEndpoint } = await import('./push.js');
  const { fcmSendToToken } = await import('./fcm.js');
  const { parseIdentity } = await import('./watch.js');

  /*
   * Route by transport. A packaged Android user has an fcm: identity and no
   * web-push endpoint at all, so sending everything through web push made
   * order alerts silently web-only.
   */
  const id = parseIdentity(endpoint);
  if (!id) return false;

  const message = {
    title: ORDER_ALERT[lang]?.title ?? ORDER_ALERT.en.title,
    body: (ORDER_ALERT[lang]?.body ?? ORDER_ALERT.en.body)
      .replace('{base}', payload.base)
      .replace('{quote}', payload.quote)
      .replace('{rate}', String(payload.rate)),
    url: '/#/orders',
    tag: `fbt-order-${payload.id}`
  };

  return id.kind === 'fcm' ? fcmSendToToken(id.value, message) : sendToEndpoint(id.value, message);
}

/** Run one watch cycle. Cron-driven, guarded by the same secret. */
app.get('/api/cron/watch', async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const out = await runWatchCycle(sendWatchAlert);
  return res.json(out);
});

/** How many watches are registered, for debugging a silent cron. */
app.get('/api/orders/watch/status', async (_req, res) => {
  const rows = await readWatches().catch(() => []);
  res.json({ watches: rows.length, cronSecretSet: Boolean(process.env.CRON_SECRET) });
});

/*
 * Alert copy lives here rather than in promos.js: this is transactional, not
 * promotional, and it must render in the OS shade without the app translating
 * it. Falls back to English for the nine partial locales rather than shipping
 * a machine translation of a message about someone's money.
 */
const ORDER_ALERT = {
  en: { title: 'Your order is ready', body: '1 {base} reached {rate} {quote}. Open the app to swap.' },
  fa: { title: 'سفارشت آماده است', body: '۱ {base} به {rate} {quote} رسید. برای سواپ اپ را باز کن.' },
  ar: { title: 'أمرك جاهز', body: '1 {base} وصل إلى {rate} {quote}. افتح التطبيق للتبادل.' }
};

/* --------------------------------- NFTs ----------------------------------- */
/*
 * Read-only viewer. Nothing here can move an asset — it is a GET against an
 * indexer, so the worst case is a stale or empty list.
 *
 * Cached for 5 minutes per address: NFT holdings change far less often than
 * prices, and an uncached endpoint would burn the free indexer quota every
 * time someone re-opened the tab.
 */
app.get('/api/nft/chains', (_req, res) =>
  res.json({ configured: nftConfigured(), chains: nftChains() })
);

/*
 * Why is the NFT key still rejected?
 *
 * `configured: true` above only proves the variable is SET, which is why
 * replacing the key and still seeing NFT_KEY_REJECTED gave no way forward.
 * This makes one real request to Alchemy and reports the status code plus a
 * 4+4 character fingerprint of the key — enough to tell whether a redeploy
 * actually picked up the new value, and never enough to use the key.
 */
app.get('/api/nft/diagnose', async (req, res) => {
  const chainId = Number(req.query.chainId) || 1;
  res.json(await nftDiagnose(chainId));
});

app.get('/api/nft/:chainId/:owner', (req, res) => {
  if (!nftConfigured()) return res.status(503).json({ error: 'NFT_NOT_CONFIGURED' });

  const { chainId, owner } = req.params;
  // Validate before it reaches the cache key, so a malformed address cannot
  // poison the cache with an error response.
  if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) {
    return res.status(400).json({ error: 'BAD_ADDRESS' });
  }
  if (!nftChains().includes(Number(chainId))) {
    return res.status(400).json({ error: 'CHAIN_NOT_SUPPORTED', chains: nftChains() });
  }

  /*
   * Not `serve()` here.
   *
   * serve() wraps every throw as {error:'UPSTREAM_FAILED', detail:<message>},
   * which is right for market data but wrong here: fetchNfts raises specific,
   * actionable codes (NFT_KEY_REJECTED, NFT_RATE_LIMITED) and serve() buried
   * them under a generic failure that rendered as "something went wrong".
   *
   * It also leaked the raw upstream message into `detail` — and for Alchemy
   * the API key sits in the URL path, so an error string could carry it to
   * the browser. Fixed codes only.
   */
  const key = `nft:${chainId}:${owner.toLowerCase()}`;
  return withCache(key, 300000, () => fetchNfts(chainId, owner))
    .then(({ value }) => {
      res.set('cache-control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=1200');
      res.json(value);
    })
    .catch((err) => {
      const code = String(err?.message || 'FAILED');
      const known = [
        'NFT_KEY_REJECTED',
        'NFT_RATE_LIMITED',
        'NFT_UPSTREAM_DOWN',
        'NFT_NOT_CONFIGURED',
        'CHAIN_NOT_SUPPORTED',
        'BAD_ADDRESS'
      ];
      res.status(502).json({ error: known.includes(code) ? code : 'FAILED' });
    });
});

/* ------------------------------ community --------------------------------- */
/*
 * A READ-ONLY window onto Farcaster.
 *
 * We do not host these posts, do not store them, and cannot moderate them —
 * which is the entire point. Hosting a social feed ourselves would put us over
 * the free storage tier at about fifty users AND make us the publisher of
 * whatever a stranger writes. See docs/SOCIAL-AND-P2P-REVIEW-FA.md.
 *
 * The channel is an ALLOW-LIST id, never a caller-supplied URL: accepting one
 * would turn this route into an open proxy for arbitrary Farcaster content.
 */
app.get('/api/community', async (req, res) => {
  const channel = String(req.query.channel || 'crypto');
  const limit = Number(req.query.limit) || 20;
  try {
    const rows = await fetchChannel(channel, limit);
    res.json({ rows, channel, channels: CHANNEL_IDS });
  } catch (e) {
    const msg = String(e.message);
    /*
     * A bad channel id is the caller's mistake; an unreachable hub is not.
     * Reporting both as 500 would make a typo look like an outage.
     */
    const code = msg === 'UNKNOWN_CHANNEL' ? 400 : 502;
    res.status(code).json({ error: msg.slice(0, 60), channels: CHANNEL_IDS });
  }
});

/* ------------------------------ P2P board --------------------------------- */
/*
 * A CLASSIFIEDS BOARD, AND NOTHING MORE.
 *
 * FinCEN's CVC guidance says a platform that only hosts bids and offers, where
 * "the parties themselves settle any matched transactions through an outside
 * venue", is NOT a money transmitter. Holding funds, arbitrating disputes or
 * taking a cut of the transfer would cross that line — a felony under 18 USC
 * 1960 when unlicensed, and $50k-$500k per state to do legally.
 *
 * So there is no trade endpoint, no balance, no escrow and no dispute route
 * here, and there must never be. We earn from PROMOTION and from the swap the
 * two parties make anyway, never from the money moving between them.
 */

/*
 * The public board carries PAID listings only. A caller's own row — which may
 * be an unpaid draft nobody else can see — is returned separately so the owner
 * can edit it without it looking as though it vanished.
 */
app.get('/api/board', async (req, res) => {
  try {
    const owner = String(req.query.owner ?? '').trim();
    const mine = /^0x[a-fA-F0-9]{40}$/.test(owner) ? await myListing(owner) : null;
    res.json({ rows: await readBoard(), mine, durable: storeDurable(), terms: promotionTerms() });
  } catch (e) {
    res.status(500).json({ error: 'READ_FAILED', detail: String(e.message).slice(0, 120) });
  }
});

app.post('/api/board', async (req, res) => {
  try {
    res.json({ ok: true, row: await putListing(req.body ?? {}) });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message).slice(0, 60) });
  }
});

app.post('/api/board/remove', async (req, res) => {
  const owner = String(req.body?.owner ?? '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) return res.status(400).json({ ok: false, error: 'BAD_OWNER' });
  try {
    return res.json({ ok: true, ...(await removeListing(owner)) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message).slice(0, 60) });
  }
});

/*
 * PUBLISH — verified on-chain before the listing becomes visible.
 *
 * The client sends a transaction hash. We do NOT trust it: server/promote.js
 * fetches the receipt from a public Base RPC and checks the transfer really
 * happened, to our address, for at least the cheapest tier, from this exact
 * wallet.
 *
 * THE TIER IS DERIVED FROM THE AMOUNT ACTUALLY RECEIVED, never from anything
 * the client claims. Otherwise a $1 payment could ask for 30 days and get it.
 *
 * The replay check is the easy one to forget. A valid hash stays valid
 * forever, so without it one payment could publish an advert every month, or
 * be passed to a friend. Each hash is recorded and can be spent once.
 */
app.post('/api/board/publish', async (req, res) => {
  const owner = String(req.body?.owner ?? '').trim();
  const txHash = String(req.body?.txHash ?? '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) return res.status(400).json({ ok: false, error: 'BAD_OWNER' });

  try {
    if (await txAlreadyUsed(txHash)) {
      return res.status(400).json({ ok: false, error: 'TX_ALREADY_USED' });
    }

    const check = await verifyPromotionPayment(txHash, owner);
    if (!check.ok) return res.status(400).json({ ok: false, error: check.reason });

    const tier = tierForAmount(check.amount);
    if (!tier) return res.status(400).json({ ok: false, error: 'UNDERPAID' });

    return res.json({ ok: true, paid: check.amount, ...(await activateListing(owner, txHash, tier.id)) });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message).slice(0, 60) });
  }
});

/* ----------------------------- points (was: leaderboard) ------------------ */
/*
 * ─── THE PUBLIC SCORE BOARD IS GONE, AND SO IS ITS ENDPOINT ─────────────────
 * The ranking screen was replaced by a private "your points" screen on the
 * owner's instruction: «تبدیلش کن به امتیاز تو و برترین ها نباشه [...] فقط
 * امتیاز همون فرد».
 *
 * GET and POST /api/leaderboard are REMOVED rather than left running with no
 * caller, for a reason that is worth stating: the POST accepted a display
 * name, a score and a referral count from any client and stored them in a
 * bucket that GET served to the whole world. That was a fair trade when the
 * point was a public ranking. With the ranking gone it is collection with no
 * purpose — and the new screen tells the user in three languages that their
 * score is not published anywhere. Leaving a live write endpoint behind would
 * make that sentence false, which is worse than the original design.
 *
 * Points now live only in the browser's own persisted store on the device that
 * earned them. Nothing is uploaded, so nothing can leak.
 *
 * The stored rows are deliberately NOT read or migrated anywhere: they are
 * self-reported numbers with display names attached, and the honest end for
 * them is to stop being served.
 */

/* -------------------------------- push ------------------------------------ */
/*
 * These routes were MISSING. `addSubscription`, `sendDailyPromo` and
 * pushConfigured were all imported at the top of this file but never mounted,
 * so the client's POST /api/push/subscribe always 404'd and no device was ever
 * registered. Notifications could not have worked no matter how the VAPID keys
 * were configured — which is exactly the reported symptom.
 */

/** Constant-time compare so the secret cannot be recovered by timing. */
function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const provided =
    req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.get('x-cron-secret') || '';
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Register a browser/PWA push subscription (VAPID). */
app.post('/api/push/subscribe', async (req, res) => {
  const { subscription, lang } = req.body ?? {};
  try {
    const out = await addSubscription(subscription, lang || 'fa');
    return res.json({ ok: true, ...out });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message).slice(0, 120) });
  }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body ?? {};
  if (!endpoint) return res.status(400).json({ ok: false, error: 'NO_ENDPOINT' });
  return res.json({ ok: true, ...(await removeSubscription(endpoint)) });
});

/*
 * Register a native Android (FCM) token.
 *
 * A Capacitor WebView has no Push API at all, so an APK user can never receive
 * VAPID web push. FCM is the only channel that reaches them.
 */
app.post('/api/push/fcm', async (req, res) => {
  const { token, lang } = req.body ?? {};
  try {
    const out = await addFcmToken(token, lang || 'fa');
    return res.json({ ok: true, ...out });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message).slice(0, 120) });
  }
});

/*
 * "Can the server actually push to me?"
 *
 * src/lib/notify.js has always called GET /api/push/status to decide between
 * 'server' and 'local' notification mode. The route did not exist, so the
 * fetch returned 404 → `data?.configured` was undefined → every WEB user was
 * pinned to 'local' (device-only) notifications, even with VAPID configured.
 * Native Android is unaffected because it short-circuits to 'server' earlier.
 *
 * This deliberately reports only booleans and counts, never key values.
 */
app.get('/api/push/status', async (_req, res) => {
  const webReady = pushConfigured();
  const fcmReady = fcmConfigured();
  res.json({
    /*
     * `configured` is what notify.js reads to choose 'server' over 'local'.
     *
     * It reports the WEB channel only, and deliberately so. This route is
     * reached from a browser or PWA, and a browser can only ever be delivered
     * to over VAPID — native Android never gets here, because pushMode()
     * short-circuits to 'server' before making this call. Reporting
     * `web || fcm` would tell a browser "the server can reach you" on the
     * strength of a channel that physically cannot, which is how the app ends
     * up promising notifications it will never deliver.
     */
    configured: webReady,
    web: webReady,
    fcm: fcmReady,
    subscribers: await readSubscriptionsSafe(),
    devices: await readFcmTokensSafe(),
    /*
     * Enough detail to fix a failed key rotation from a phone. `fcm: false`
     * alone has three possible causes with three different fixes; this names
     * which one. No secret is echoed — see fcmDiagnose().
     */
    fcmDetail: fcmDiagnose()
  });
});

/*
 * "Does push actually work?" — asked of Google, not of our own env vars.
 *
 * /api/push/status reports whether the credentials LOOK right. That passed
 * happily while the package rename left google-services.json pointing at the
 * old Firebase app id, which is exactly the kind of failure that shows up
 * weeks later as "alerts stopped arriving". This route performs a real
 * authenticated call against the real project and reports which stage failed.
 *
 * Nothing is delivered: it uses validate_only plus a token literal that can
 * never match a device.
 */
app.get('/api/push/selftest', async (_req, res) => {
  try {
    res.json(await fcmSelfTest());
  } catch (e) {
    res.status(500).json({ ok: false, stage: 'ERROR', detail: String(e.message).slice(0, 120) });
  }
});

app.post('/api/push/fcm/remove', async (req, res) => {
  const { token } = req.body ?? {};
  if (!token) return res.status(400).json({ ok: false, error: 'NO_TOKEN' });
  return res.json({ ok: true, ...(await removeFcmToken(token)) });
});

/**
 * Say exactly what is blocking a send.
 *
 * Push has many independent ways to be silently off — missing keys, zero
 * subscribers, no cron secret. Reporting which one it is turns a
 * half-hour of guessing into a glance. Never returns key VALUES.
 */
app.get('/api/cron/status', async (_req, res) => {
  const [subs, fcm] = await Promise.all([readSubscriptionsSafe(), readFcmTokensSafe()]);
  const webReady = pushConfigured();
  const fcmReady = fcmConfigured();
  res.json({
    web: {
      configured: webReady,
      subscribers: subs,
      missing: webReady ? [] : ['VITE_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].filter(
        (k) => !process.env[k] && !(k === 'VITE_VAPID_PUBLIC_KEY' && process.env.VAPID_PUBLIC_KEY)
      )
    },
    fcm: {
      configured: fcmReady,
      devices: fcm,
      missing: fcmReady ? [] : ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'].filter(
        (k) => !process.env[k]
      ),
      /*
       * "not configured, but nothing missing" was a dead end.
       *
       * fcmConfigured() needs all three vars AND the key to actually contain
       * a PEM header. So a set-but-malformed FIREBASE_PRIVATE_KEY produced
       * `configured:false` with `missing:[]` — the report said everything was
       * present and still refused to work, which is the least actionable
       * output this endpoint could give.
       *
       * The overwhelmingly likely cause is pasting `private_key_id` (a short
       * hex string that sits directly above the real key in the JSON) instead
       * of `private_key`. Say so, without ever echoing the value.
       */
      problem: (() => {
        if (fcmReady) return null;
        const raw = process.env.FIREBASE_PRIVATE_KEY || '';
        if (!raw) return null; // genuinely absent — `missing` already says so
        if (!raw.replace(/\\n/g, '\n').includes('BEGIN PRIVATE KEY')) {
          return `FIREBASE_PRIVATE_KEY is set (${raw.length} chars) but has no "-----BEGIN PRIVATE KEY-----" header. You have most likely pasted private_key_id instead of private_key — they sit next to each other in the service-account JSON. Paste the whole private_key value, keeping its \\n sequences exactly as they are.`;
        }
        return null;
      })()
    },
    cronSecretSet: Boolean(process.env.CRON_SECRET),
    durableStorage: storeDurable(),
    learning: {
      configured: learningConfigured(),
      snapshot: (() => {
        const s = servingSnapshot();
        if (!s?.manifest) return null;
        return {
          paramsKey: s.manifest.paramsKey,
          trainedAt: s.manifest.trainedAt,
          records: s.manifest.recordCount,
          auc: s.manifest.calibrationAuc,
          fallbackHardcoded: Boolean(s.manifest.fallbackHardcoded)
        };
      })()
    },
    canSend: (webReady && subs > 0) || (fcmReady && fcm > 0)
  });
});

async function readSubscriptionsSafe() {
  try {
    const { readSubscriptions } = await import('./store.js');
    return (await readSubscriptions()).length;
  } catch {
    return 0;
  }
}
async function readFcmTokensSafe() {
  try {
    return (await readFcmTokens()).length;
  } catch {
    return 0;
  }
}

/** Daily broadcast. Fans out to BOTH channels; each is independent. */
/*
 * WHY THE PRICE WATCH RUNS FROM HERE INSTEAD OF ITS OWN SCHEDULE.
 *
 * This used to be a second cron entry in vercel.json running every 15
 * minutes. That broke every deployment: Hobby allows at most 2 cron jobs and
 * only ONE INVOCATION PER DAY each, so 96/day is rejected. The project still
 * builds and then refuses to run, which is far more confusing than a build
 * error - the deploy list simply stops receiving new entries, which looks
 * exactly like a disconnected Git integration.
 *
 * So the watch cycle is folded into the daily job. Be honest about the cost:
 * a limit order is now checked ONCE A DAY, not every 15 minutes. That is a
 * real downgrade, and it is why orders.js must keep describing these as
 * alerts rather than fills. The alternative - a paid plan - is not worth
 * buying before the app has users.
 *
 * runWatchCycle sits in the same Promise.allSettled as the two sends: one
 * failing channel must not cancel the others.
 *
 * ─── THE `sendWatchAlert` ARGUMENT IS THE FIX, NOT A DETAIL ─────────────────
 * runWatchCycle() is a pure evaluator: it decides WHICH orders triggered and
 * then calls the injected `send` callback to actually deliver. This cron used
 * to call it with NO callback, so every trigger reached `send(...)` where
 * `send` was undefined, threw, was caught, and the alert was silently dropped
 * — while the in-app sound/vibration kept working, which is exactly why this
 * looked like "works open, never when closed". The callback routes to web push
 * (VAPID) or FCM by the device's identity. A wiring check asserts it stays
 * passed here so the fix cannot regress into a silent feature removal.
 */
app.get('/api/cron/daily', async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const [web, fcm, watch] = await Promise.allSettled([
    sendDailyPromo(),
    sendDailyFcm(),
    runWatchCycle(sendWatchAlert)
  ]);
  res.json({
    web: web.status === 'fulfilled' ? web.value : { error: String(web.reason).slice(0, 120) },
    fcm: fcm.status === 'fulfilled' ? fcm.value : { error: String(fcm.reason).slice(0, 120) },
    watch: watch.status === 'fulfilled' ? watch.value : { error: String(watch.reason).slice(0, 120) }
  });
});

/** The FCM half of the daily promo, reusing push.js's copy deck. */
async function sendDailyFcm() {
  if (!fcmConfigured()) return { sent: 0, skipped: 'NOT_CONFIGURED' };
  const { promoForToday } = await import('./push.js');
  const { PROMOS } = await import('./promos.js');
  const key = promoForToday();
  return fcmBroadcast(
    (lang) => {
      const [title, body] = PROMOS[key][lang] ?? PROMOS[key].en;
      return { title, body, url: '/' };
    },
    { tag: 'fbt-daily' }
  );
}

/* ------------------------------ learning core ----------------------------- */
/*
 * THE DAILY MACHINE-LEARNING LOOP — zero extra spend, fully dynamic.
 * See server/learning/* for the full design. Surfaces:
 *
 *   POST /api/telemetry/signal   — opt-in, anonymized signal record
 *   POST /api/telemetry/resolve  — opt-in, observed outcome on a later visit
 *   GET  /api/learning/params    — published params, served FROM MEMORY
 *                                  (<1 ms hot path; Blob at most once per
 *                                  cold start — never per request)
 *   GET  /api/cron/train         — the second Hobby cron slot, 03:17 UTC
 *
 * The telemetry endpoints are STRICTLY opt-in: the Settings flow mints a
 * device-local consent token (`ct1:` + 32 hex) when the user enables
 * "contributeTelemetry" and the client sends it with every submission. The
 * token is never persisted server-side; without it the endpoint answers 401.
 * Records carry no address, no key, no IP, no user identifier.
 */

/** Consent proof — the only thing that can be checked without storing users. */
function telemetryConsented(req, mod) {
  const token =
    req.get('x-telemetry-consent') ??
    (typeof req.body === 'object' && req.body ? req.body.consent : null) ??
    '';
  return typeof token === 'string' && Boolean(mod?.CONSENT_RE?.test(token));
}

app.post('/api/telemetry/signal', async (req, res) => {
  const mod = await learningMod();
  if (!mod) return res.status(503).json({ error: 'NOT_CONFIGURED' });
  if (!telemetryConsented(req, mod)) return res.status(401).json({ error: 'OPT_IN_REQUIRED' });
  const rec = mod.validateSignal(req.body);
  if (!rec) return res.status(400).json({ error: 'BAD_SIGNAL' });
  const out = await mod.appendBuckets([rec]);
  return res.status(202).json({ ok: true, stored: out.stored, batch: out.batch });
});

app.post('/api/telemetry/resolve', async (req, res) => {
  const mod = await learningMod();
  if (!mod) return res.status(503).json({ error: 'NOT_CONFIGURED' });
  if (!telemetryConsented(req, mod)) return res.status(401).json({ error: 'OPT_IN_REQUIRED' });
  const rec = mod.validateResolution(req.body);
  if (!rec) return res.status(400).json({ error: 'BAD_RESOLUTION' });
  const out = await mod.appendBuckets([rec]);
  return res.status(202).json({ ok: true, stored: out.stored, batch: out.batch });
});

/*
 * SECOND-GENERATION TELEMETRY — POST /api/learning/event.
 *
 * The client submits ONLY the prediction; the server enriches it with the
 * current price from its own in-memory market cache at ingest time and
 * registers two resolution callbacks (short → +24h, long → +7d) in the
 * learning/pending.json manifest. The daily cron sweeps due entries and
 * computes the bucketed forward return from CACHED prices — a cache miss
 * drops the sample rather than inventing one. Because the client can never
 * send a resolved return, poisoning the model with fake outcomes is
 * structurally impossible.
 *
 * Rate limit: 1 Hz per caller, same Map-based limiter pattern as every
 * other budgeted endpoint in this file.
 */
const learnEventHits = new Map();
const LEARN_EVENT_MAX_PER_WINDOW = Number(process.env.LEARNING_EVENT_RATE_LIMIT || 60); // 60/min = 1 Hz

app.post('/api/learning/event', async (req, res) => {
  const key = req.tgUser?.id ?? req.ip;
  const nowMs = Date.now();
  const rec = learnEventHits.get(key);
  if (!rec || nowMs > rec.reset) {
    learnEventHits.set(key, { count: 1, reset: nowMs + WINDOW_MS });
  } else {
    rec.count += 1;
    if (rec.count > LEARN_EVENT_MAX_PER_WINDOW) {
      res.set('retry-after', String(Math.ceil((rec.reset - nowMs) / 1000)));
      return res.status(429).json({ error: 'LEARNING_RATE_LIMITED' });
    }
  }

  const mod = await learningMod();
  if (!mod) return res.status(503).json({ error: 'NOT_CONFIGURED' });
  // Consent first: a payload from a client that never opted in is rejected
  // 401 regardless of whether Blob happens to be configured.
  if (!telemetryConsented(req, mod)) return res.status(401).json({ error: 'OPT_IN_REQUIRED' });
  if (!mod.learningConfigured()) {
    // Blob off → the whole learning feature is off; same shape as blobCache.
    return res.status(503).json({ error: 'NOT_CONFIGURED' });
  }
  const out = await mod.ingestEvent(req.body);
  if (!out.ok) {
    const status = out.error === 'BAD_EVENT' ? 400 : out.error === 'NOT_CONFIGURED' ? 503 : 202;
    // NO_PRICE / WRITE_FAILED are 202: the client did nothing wrong and must
    // not retry-loop; the sample is simply not taken.
    return res.status(status).json({ ok: false, error: out.error });
  }
  return res.status(202).json({ ok: true, queued: out.queued });
});

setInterval(() => {
  const nowMs = Date.now();
  for (const [k, v] of learnEventHits) if (nowMs > v.reset) learnEventHits.delete(k);
}, WINDOW_MS).unref?.();

app.get('/api/learning/params', async (_req, res) => {
  const mod = await learningMod();
  if (!mod || process.env.LEARNING_ENABLED === '0') {
    // Module deleted (sabotage fallback) or first-day kill switch: same
    // honest "no model" shape either way — the client badge stays hidden.
    res.setHeader('cache-control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    return res.json({ model: false, params: null, manifest: null });
  }
  /*
   * Served through the same in-memory single-flight cache as everything
   * else (params.js sits on cache.js's memoryStore): after the one cold
   * fetch this is a synchronous map read. s-maxage=3600 keeps the edge
   * copy for an hour — params change once per day, and the manifest date
   * inside the payload is what versions it for the client.
   */
  const snapshot = await mod.getServingParams();
  res.setHeader('cache-control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  return res.json(mod.servingResponse(snapshot));
});

app.get('/api/cron/train', async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const mod = await learningMod();
  if (!mod) return res.json({ skipped: 'NO_MODULE', fallbackHardcoded: true });
  // 1) sweep due resolution callbacks (server-side outcomes from cached
  //    prices), 2) train on the finalized window, 3) refresh the in-memory
  //    params so the instance that trained also serves the new vector.
  const sweep = await mod.sweepPending();
  const summary = await mod.runTraining();
  if (summary.ok) mod.warmParamsCache().catch(() => {});
  res.json({ ...summary, sweep });
});

/* ----------------------------- static frontend ---------------------------- */

const distDir = path.join(__dirname, '..', 'dist');

/*
 * ─── WHY THE CACHE LIFETIME DEPENDS ON THE FILENAME ─────────────────────────
 * This was a flat `maxAge: '1h'` for everything, and it was the main reason
 * the site felt slow on a second visit: a returning user re-downloaded the
 * entire ~770 KB first-paint payload — the entry bundle, React, framer-motion,
 * the stylesheet and the 109 KB Persian font — every hour, forever.
 *
 * Reported directly: «سرعت لود سایت خیلی کم شده و طول میکشه بیاد».
 *
 * The fix is not one number, because these files have genuinely different
 * lifetimes:
 *
 *   /assets/*  — Vite writes a CONTENT HASH into every filename
 *                (index-y4UH__tA.js). The URL changes whenever the bytes
 *                change, so a stale file can never be served: a new build
 *                produces new URLs and the old ones are never requested
 *                again. A year plus `immutable` is exactly correct here, and
 *                `immutable` additionally stops the browser sending a
 *                revalidation request at all.
 *
 *   /fonts/*   — not hashed, but replaced by editing index.html to point
 *                elsewhere rather than by swapping bytes under the same name.
 *
 *   index.html — MUST be revalidated every time. It is the one file naming
 *                the current hashed asset URLs, so caching it pins a
 *                returning visitor to the previous deploy's JavaScript. That
 *                is how somebody stays on an old build for hours after a fix
 *                ships, which is worse than a slow load. Handled by the SPA
 *                fallback below, and `index: false` here makes sure this
 *                middleware never serves it.
 *
 * Vercel serves /assets and /fonts from its edge using the headers in
 * vercel.json and never reaches this code. This matters for the APK, which
 * bundles the server, and for anyone self-hosting — the two paths must agree
 * or the app behaves differently depending on where it runs.
 */
app.use(
  express.static(distDir, {
    index: false,
    setHeaders(res, filePath) {
      if (/[\\/](assets|fonts)[\\/]/.test(filePath)) {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        return;
      }
      /*
       * Icons and the manifest are unhashed AND do get replaced in place when
       * the branding changes, so a year would strand a stale icon on a home
       * screen with no way to force a refresh. A week is effectively free on
       * repeat visits and still lets a fix propagate.
       */
      res.setHeader('cache-control', 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=2419200');
    }
  })
);

// SPA fallback. Written as bare middleware because Express 5's router no
// longer accepts a plain '*' path pattern.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'NOT_FOUND' });
  /*
   * Never cached, and this is the counterpart to the year-long asset cache
   * above rather than an inconsistency with it. index.html is the only file
   * that names the current hashed asset URLs; caching it would pin a
   * returning visitor to the previous deploy's JavaScript while the assets it
   * points at are cached for a year. The revalidation costs a few hundred
   * bytes and usually answers 304.
   */
  res.setHeader('cache-control', 'public, max-age=0, must-revalidate');
  return res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'NOT_BUILT', hint: 'run `npm run build` first' });
  });
});

export default app;
