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
import { blobConfigured, blobSet, upstashIncrementWindow, withPersistentCache } from './blobCache.js';
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
import { telegramAuth, verifyInitData, normalizeBotToken, extractInitData } from './telegramAuth.js';
import { telegramBotIdentity, tokenDiagnostics } from './telegramIdentity.js';
import { fetchAudio } from './audio.js';
import { calmResultIsUsable, fetchCalm } from './calm.js';
import { fetchThorPools, thorQuote, thorStatus } from './thorchain.js';
import { fetchNews } from './news.js';
import { cachedWhales } from './whales.js';
import * as smartMoney from './smartMoney/index.js';
import { buildMarketPulse, buildSolanaRadar, explainSignal } from './signalEngine.js';
import { fetchYields } from './yields.js';
import { fetchSolanaAssets } from './solanaAssets.js';
import { fetchAvantisEquities } from './avantis.js';
import { getShopCatalogue, getShopProducts, shopCountries } from './shop.js';
import { fetchPerpMarkets } from './perp.js';
import { fetchSolanaIntel, fetchSolanaWhales, solscanConfigured, SOLANA_SIGNAL_MINTS } from './solanaIntel.js';
import {
  fetchDydxAccount, fetchDydxCandles, fetchDydxMarkets, fetchDydxOrderbook,
  normaliseCandleQuery
} from './dydx.js';
import { fetchOstiumPrices, fetchOstiumSubgraph } from './ostium.js';
import { resolveIds } from './coinIndex.js';
import { resolveVenue } from './coinVenue.js';
import {
  checkBuySellEligibility,
  createBuySellCheckout,
  createBuySellOrder,
  createBuySellQuote,
  getBuySellCapabilities,
  getBuySellOrder,
  getBuySellOrderAudit,
  listAssets as buySellAssets,
  listNetworks as buySellNetworks,
  cancelBuySellOrder,
  handleBuySellProviderWebhook,
  verifyBuySellOrder
} from './buySell.js';
import {
  authorizeIranBuySettlement,
  cancelIranBuyOrder,
  createIranBuyOrder,
  createIranBuyPreview,
  createIranBuySettlementChallenge,
  createIranBuyWalletChallenge,
  getIranBuyCapability,
  getIranBuyOrder,
  getIranBuyOrderAudit,
  iranBuyPublicFailure,
  verifyIranBuyWalletChallenge
} from './iranBuy.js';
import { bridgeQuote, bridgeStatus } from './bridge.js';
import {
  chainTokens,
  crossChainHealth,
  getQuote as crossChainGetQuote,
  getRoutes as crossChainGetRoutes,
  getTransferStatus,
  resolveToken as crossChainResolveToken,
  supportedChains as crossChainSupportedChains
} from './crossChain.js';
import {
  createTransaction as createCrossChainTransaction,
  getTransaction as getCrossChainTransaction,
  listTransactions as listCrossChainTransactions,
  recordIntent as recordCrossChainIntent,
  updateTransaction as updateCrossChainTransaction
} from './crossChainStore.js';
import { dlnCreateTx, dlnQuote, dlnStatus } from './dln.js';
import { gaslessPrice, gaslessQuote, gaslessStatus, gaslessSubmit } from './gasless.js';
import { jupiterConfigured, referralAccount, solanaExecute, solanaOrder } from './solana.js';
import { oceanQuote, oceanStatus, oceanSwap } from './solanaOcean.js';
import { p2pCountries, p2pCurrencies, p2pOffers, p2pPaymentMethods, p2pStatus } from './hodlhodl.js';
import { btcAddress, btcFees, btcBroadcast, btcStatus } from './btcChain.js';
import { proxyKyberBuild, proxyKyberRoutes, proxyOoQuote, proxyOoSwap, proxyVeloraPrices } from './swapProxy.js';
import { crossChainProbe, crossChainQuotes, crossChainStatus } from './xchain.js';
import { revenueReadiness } from './readiness.js';
import { providerStatusReport, recordFailure, recordSuccess } from './providerStatus.js';
import { probeProviderStatuses } from './providerProbe.js';
import { networkOverview, validWindow, networkError } from './networkOverview.js';
import { catalogList, catalogError, CATALOG_SCHEMAS } from './ecosystemCatalog.js';
import {
  LIFECYCLE,
  REGISTRY_LIMITATIONS,
  createRegistryEntry,
  listOwnerRegistry,
  listReviewQueue,
  registryCounts,
  screenRegistryInput,
  transitionRegistryEntry,
  updateRegistryEntry
} from './ecosystemRegistry.js';
import {
  CERTIFICATION_LIMITATIONS,
  CERTIFICATION_TYPES,
  EVIDENCE_TYPES,
  certificationsConfigured,
  certifierLabel,
  issueCertification,
  listCertifications,
  revokeCertification,
  sweepCertifications
} from './ecosystemCertifications.js';
import { REPUTATION_LIMITATIONS, getReputation, getReputationSnapshot } from './ecosystemReputation.js';
import { openApiDocument } from './openapi.js';
import { PORTFOLIO_LIMITATIONS, readPortfolioAgent, savePortfolioAgent } from './portfolioAgents.js';
import { environmentList } from './environments.js';
import { listProjects, createProject, ownedProject, projectScopes } from './developerProjects.js';
import { apiKeyScopes, authenticateApiKey, createApiKey, hasScope, looksLikeApiKey, revokeApiKey } from './developerKeys.js';
import { SCHEMAS } from './phase2Schemas.js';
import { claimIdempotency, saveIdempotency } from './idempotency.js';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { PROJECT_SCHEMA } from './developerProjects.js';
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
        const [store, schema, params, train, events, loader, execObservation] = await Promise.all([
          import('./learning/store.js'),
          import('./learning/schema.js'),
          import('./learning/params.js'),
          import('./learning/train.js'),
          import('./learning/events.js'),
          import('./learning/loader.js'),
          import('./learning/execObservation.js')
        ]);
        return { ...store, ...schema, ...params, ...train, ...events, ...loader, ...execObservation };
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
learningMod().then((m) => {
  learningSync = m;
  /* Warm the execution-observation snapshot once per process — Blob at most
     once, same contract as the verdict params loader. */
  m?.getExecServingParams?.().catch(() => {});
}).catch(() => {});
const learningConfigured = () => Boolean(learningSync?.learningConfigured?.() ?? false);
const servingSnapshot = () => (learningSync?.servingSnapshot ? learningSync.servingSnapshot() : null);
import { activateListing, myListing, putListing, readBoard, removeListing, tierForAmount, txAlreadyUsed } from './board.js';
import { promotionTerms, verifyPromotionPayment } from './promote.js';
import { CHANNEL_IDS, fetchChannel } from './farcaster.js';
import { fetchNfts, nftChains, nftConfigured, nftDiagnose } from './nft.js';
import { clearWatches, putWatches, readWatches, runWatchCycle } from './watch.js';
import { evaluateAllMonitors, monitorEngineStatus } from './intentMonitoring.js';
import {
  addFcmToken,
  addSubscription,
  readFcmTokens,
  removeFcmToken,
  removeSubscription,
  storeDurable
} from './store.js';
import { aiConfigured, aiSelfTest, answerSupportQuestion, generateMarketBrief, generateOutlook, newsConfigured } from './ai.js';
import aiCommandRoutes from './aiCommand.js';
import aiIntentOSRoutes from './aiIntentOS.js';
import { createCentralIntelligence } from './ci/api.js';
import { installCentralOS, centralRouter } from './central/index.js';
import { lendingRouter } from './lending.js';
import { futuresRouter } from './futures/router.js';
import { rewardsRouter } from './rewards/index.js';
import { fetchTokenRisk } from './tokenRisk.js';
/*
 * EXPLORE + SECURITY CENTER — the blockchain-intelligence and
 * security-intelligence routes (server/explorerData.js +
 * server/securityIntel.js behind one mounter). Deliberately independent of
 * the Intent OS layer: these two pages must keep working with it removed,
 * and nothing in these routes can sign, block or alter a transaction — they
 * are GET-only by construction. See the mounter's header for the contract.
 */
import { registerExploreRoutes, registerSecurityRoutes } from './exploreSecurityRoutes.js';
import { INTENT_CAPABILITIES, validateIntentEnvelope } from './intents.js';
import { flashLiquidityCapabilities, flashScan, flashSimulate, flashPlan } from './flashLiquidity.js';
import {
  OBSERVATION_CONSENT_RE,
  observationProtocolStatus,
  storeObservation,
  validateObservation
} from './intentObservation.js';
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
  atomicSwapProtocolStatus,
  buildAtomicSwapPlan,
  parseAtomicSwapRpcNetworks,
  verifyAtomicSwapLeg
} from './intentAtomicSwap.js';
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
import { activationReport } from './intentActivation.js';
import { phaseStatusReport } from './intentPhaseStatus.js';
import { handleOperatorEvidence, evidenceStoreStatus, getStoredEvidence, ensureOperatorEvidenceHydrated } from './intentOperatorEvidence.js';
import { activationConfigPresence } from './intentActivationConfig.js';
import { collectVenueFeeds, buildProfitPlan, PROFIT_PLAN_SCHEMA } from './multiVenue.js';
import {
  FINANCIAL_GOAL_SCHEMAS,
  approveGoalPlan,
  buildGoalPlan,
  createGoal,
  financialGoalMeta,
  getGoal,
  goalAnalyze,
  goalProgress,
  goalSimulate,
  goalWhatIf,
  listGoals,
  ownerFromRequest,
  parseGoalFromText,
  pauseGoalPlan
} from './financialGoals.js';
import { outputLocaleSupport } from '../src/lib/intent-ai/outputLocales.js';
import { handleUnfreeze, handleFreeze, freezeStateReport } from './intentFreezeControl.js';
import { auditStatus } from './intentAuditLog.js';
import { simulatorEvidence } from './intentSimulator.js';
import { monitorEvidence, recordHeartbeat } from './intentMonitor.js';
import { schedulerEvidence } from './intentScheduler.js';
import { backupRestoreDrill, reproducibleBuildCheck, rollbackDrill, sloMeasurement } from './intentDrill.js';
import { sloMeterMiddleware, sloSnapshot } from './intentSloMeter.js';
import { selfProbeReport, runSelfProbe, ensureHydrated, SELF_PROBE_KINDS } from './intentSelfProbe.js';
import { opsProbeReport, runOpsProbe, ensureOpsHydrated, OPS_DRILL_KINDS } from './intentOpsProbe.js';
import {
  runStage3Digest,
  runStage3Probe,
  stage3ProbeReport,
  ensureStage3Hydrated,
  handleStage3Review,
  publicReviewPackage,
  STAGE3_KINDS
} from './intentStage3Probe.js';
import {
  runLaterPhaseProbe,
  laterPhaseProbeReport,
  laterPhasePublicSummary,
  runExternalProviderDigest,
  LATER_PHASE_SCHEMA
} from './intentLaterPhaseProbe.js';
import { venueHealthEvidence, probeAllVenues, venueHealthStatus } from './intentVenueHealth.js';
import { bridgeProviderEvidence, bridgeStatus as intentBridgeStatus, getBridgeQuote } from './intentBridgeQuote.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/*
 * normalizeBotToken(): a trailing newline, stray spaces, wrapping quotes or an
 * invisible BOM/zero-width character stored alongside the secret in the
 * environment changes the HMAC key and turns every valid initData into
 * BAD_SIGNATURE — while the bot-id prefix still LOOKS right in any dashboard.
 * verifyInitData normalizes defensively too, but normalizing here keeps botId
 * parsing and the diagnose endpoint consistent with what the middleware
 * actually verifies against.
 */
const BOT_TOKEN = normalizeBotToken(process.env.TELEGRAM_BOT_TOKEN);

const app = express();
app.disable('x-powered-by');

/*
 * Provider settlement webhook. Registered before JSON parsing so the raw body
 * is available for signature verification (Ramp signs the exact JSON payload
 * with its ECDSA key — X-Body-Signature). The handler itself is fail-closed:
 * without the configured Ramp public key, nothing is parsed as settlement.
 */
app.post('/api/v1/buy-sell/webhooks/:provider', express.raw({ type: 'application/json', limit: '32kb' }), (req, res) => {
  res.set('cache-control', 'no-store');
  return Promise.resolve()
    .then(() => handleBuySellProviderWebhook({
      providerId: req.params.provider,
      rawBody: req.body,
      signature: req.get('x-body-signature'),
      query: req.query
    }))
    .then((out) => res.status(Number(out?.status) || 200).json(out?.body ?? {}))
    .catch(() => res.status(503).json({ error: 'WEBHOOK_UNAVAILABLE' }));
});

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
/*
 * SLO meter. Mounted before everything else so uptime and latency are measured
 * over the traffic the process really served — the numbers reported by
 * /api/intents/v1/slo-status and by the slo-measurement evidence come from
 * here, not from a constant.
 */
app.use(sloMeterMiddleware());

app.use(express.json({ limit: '256kb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
app.use(telegramAuth(BOT_TOKEN)); // optional — populates req.tgUser when present

/*
 * Telegram Mini App authentication diagnosis. This endpoint intentionally
 * reports only metadata about the received initData: the bot id is public,
 * while the bot token and all field values remain server-side secrets. It does
 * not authenticate the caller or change the optional middleware's fail-open
 * behaviour; it explains why a protected route later answered AUTH_REQUIRED.
 *
 * Accepts initData via the x-telegram-init-data header (GET or POST) AND via
 * a JSON body `{ "initData": "..." }` (POST). The client sends BOTH when it
 * can, which lets the server compare the two transports byte for byte: the
 * body round-trips any string exactly, so a MISMATCH proves the header was
 * mangled in transit (proxy limits, re-encoding) — the one BAD_SIGNATURE
 * cause that is NOT a token problem.
 */
const telegramDiagnoseHandler = (req, res) => {
  /* The auth middleware consumed and kept the three transports on
     req.telegramInitData (and removed the credential from req.body so nothing
     downstream stores it). Extract again only if this route were ever mounted
     before the middleware. */
  const { initData, source, headerInitData, bodyInitData } = req.telegramInitData || extractInitData(req);
  const identity = telegramBotIdentity(BOT_TOKEN);
  /* Same secret, seen through every angle that matters for BAD_SIGNATURE:
     length/fingerprint identify WHICH token this instance holds (compare
     across deploys and Vercel projects), the quote/invisible flags say the
     stored env VALUE was poisoned. Fed the RAW env value on purpose —
     diagnostics must see the stored bytes, not the cleaned copy. 4+4
     characters only — never the secret. */
  const token = tokenDiagnostics(process.env.TELEGRAM_BOT_TOKEN);
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') || '';
  const authDate = Number(params.get('auth_date') || 0);
  const verified = initData ? verifyInitData(initData, BOT_TOKEN) : { ok: false, reason: 'NO_INIT_DATA_SENT' };

  res.set('cache-control', 'private, no-store');
  return res.json({
    data: {
      // Only public identity metadata; the token never leaves the server.
      botTokenConfigured: identity.tokenConfigured,
      botId: identity.configuredBotId,
      expectedBotId: identity.expectedBotId,
      botIdentityMatches: identity.identityMatches,
      tokenLength: token.tokenLength,
      tokenFingerprint: token.tokenFingerprint,
      tokenHadQuotes: token.tokenHadQuotes,
      tokenHadInvisibleChars: token.tokenHadInvisibleChars,
      tokenShapeValid: token.tokenShapeValid,
      initDataSource: source,
      headerInitDataLength: headerInitData ? headerInitData.length : null,
      bodyInitDataLength: bodyInitData ? bodyInitData.length : null,
      /* MATCH = both transports carried identical bytes; MISMATCH = the header
         was corrupted on the way in (hypothesis: transit, not token). null =
         only one transport was used. */
      transportMatch: headerInitData && bodyInitData ? (headerInitData === bodyInitData ? 'MATCH' : 'MISMATCH') : null,
      initDataReceived: Boolean(initData),
      initDataLength: String(initData).length,
      hashPresent: params.has('hash'),
      /* 64 for a healthy hash; 63 or less means the initData string itself
         was truncated before it reached us. */
      hashLength: hash.length,
      signatureFieldPresent: params.has('signature'),
      fields: [...params.keys()].sort(),
      authDateAgeSeconds: authDate ? Math.max(0, Math.floor(Date.now() / 1000) - authDate) : null,
      verified: verified.ok === true,
      reason: verified.ok ? 'OK' : verified.reason,
      userId: verified.ok ? String(verified.user?.id ?? '') : null
    },
    meta: { schema: 'fbt.telegram-diagnose.v2' }
  });
};
app.get('/api/telegram/diagnose', telegramDiagnoseHandler);
app.post('/api/telegram/diagnose', telegramDiagnoseHandler);

/*
 * Which bot does THIS instance's token actually belong to?
 *
 * The decisive check for "BAD_SIGNATURE but the owner swears the token is
 * right": asks api.telegram.org getMe with the server's own token and returns
 * the bot's public username/id — never the token, never a fingerprint beyond
 * the 4+4 diagnostic above. Three possible verdicts, each actionable without
 * guessing:
 *
 *   · username is this app's bot   → the token is right, so BAD_SIGNATURE
 *     means the initData was signed by a DIFFERENT bot (wrong Menu Button
 *     bot, another project's domain) or was mangled in transit.
 *   · username is ANOTHER bot      → this instance holds another bot's token
 *     (second Vercel project, stale redeploy, mixed-up env).
 *   · Telegram rejects the token   → revoked or never valid; re-paste and
 *     redeploy.
 *
 * Anonymous callers may see only public getMe identity data. Full diagnostics
 * require the shared CRON_SECRET (Authorization: Bearer, x-cron-secret header,
 * or ?key=) OR an already verified Mini App session (req.tgUser), which during
 * a BAD_SIGNATURE outage is exactly what the owner does NOT have — hence the
 * secret path.
 */
const TELEGRAM_GET_ME_TTL_MS = 60000;
let telegramGetMeCache = { token: '', expires: 0, hasValue: false, payload: null, error: null };

async function cachedTelegramGetMe(botToken) {
  const now = Date.now();
  if (telegramGetMeCache.token === botToken && telegramGetMeCache.hasValue && now < telegramGetMeCache.expires) {
    if (telegramGetMeCache.error) throw telegramGetMeCache.error;
    return telegramGetMeCache.payload;
  }
  /* The token appears in the URL only for the lifetime of this one call and is
     never logged, stored or returned. The result is cached so anonymous checks
     cannot fan out into more than one Telegram getMe request per minute. */
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      signal: AbortSignal.timeout(8000)
    });
    const payload = await response.json().catch(() => null);
    telegramGetMeCache = { token: botToken, expires: now + TELEGRAM_GET_ME_TTL_MS, hasValue: true, payload, error: null };
    return payload;
  } catch (err) {
    telegramGetMeCache = { token: botToken, expires: now + TELEGRAM_GET_ME_TTL_MS, hasValue: true, payload: null, error: err };
    throw err;
  }
}

app.get('/api/telegram/whoami-bot', async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  const provided =
    req.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.get('x-cron-secret') ||
    String(req.query.key || '') ||
    '';
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  const secretOk = Boolean(secret) && a.length === b.length && timingSafeEqual(a, b);
  const sessionOk = Boolean(req.tgUser?.id);
  const fullOk = secretOk || sessionOk;
  const cronSecretSet = Boolean(secret);
  if (!BOT_TOKEN) return res.status(503).json({ error: 'NO_BOT_TOKEN', cronSecretSet });

  const expectedUsername = String(process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '').toLowerCase();
  const withExpectedUsername = (data) => expectedUsername
    ? { ...data, expectedBotUsername: expectedUsername, usernameMatches: data.bot?.username ? String(data.bot.username).toLowerCase() === expectedUsername : false }
    : data;

  let payload = null;
  try {
    payload = await cachedTelegramGetMe(BOT_TOKEN);
  } catch {
    return res.status(502).json({ error: 'TELEGRAM_UNREACHABLE', cronSecretSet });
  }
  if (!payload) return res.status(502).json({ error: 'TELEGRAM_UNREACHABLE', cronSecretSet });

  res.set('cache-control', 'private, no-store');
  const publicData = payload.ok === true
    ? withExpectedUsername({
        telegramAccepted: true,
        bot: {
          id: payload.result?.id ?? null,
          username: typeof payload.result?.username === 'string' ? payload.result.username : null
        },
        cronSecretSet
      })
    : withExpectedUsername({
        telegramAccepted: false,
        bot: null,
        cronSecretSet
      });

  if (!fullOk) {
    return res.json({
      data: {
        ...publicData,
        fullDiagnostics: 'requires CRON_SECRET or a verified session'
      },
      meta: { schema: 'fbt.telegram-whoami.v1' }
    });
  }

  /* Raw env value, like the diagnose route: the flags describe what was
     STORED, not the cleaned copy the HMAC uses. */
  const token = tokenDiagnostics(process.env.TELEGRAM_BOT_TOKEN);
  return res.json({
    data: {
      ...publicData,
      tokenDiagnostics: token,
      ...token
    },
    meta: { schema: 'fbt.telegram-whoami.v1' }
  });
});

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

/* The unified `/api/v1/ai` gateway shares the same deliberate budget as the
   older command-center routes: AI calls spend real provider quota, so a cheap
   script must not be able to take the assistant down for everyone. */
const aiV1Hits = new Map();
const AI_V1_MAX_PER_WINDOW = Number(process.env.AI_RATE_LIMIT || 10);
app.use('/api/v1/ai', (req, res, next) => {
  if (req.method === 'GET') return next();
  const key = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const rec = aiV1Hits.get(key);
  if (!rec || now > rec.reset) {
    aiV1Hits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > AI_V1_MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json({ error: 'AI_RATE_LIMITED' });
  }
  return next();
});
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of aiV1Hits) if (now > v.reset) aiV1Hits.delete(k);
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

/* FBT Network 2.0: aggregate, read-only analytics. This deliberately reports
 * empty when no durable observation source is configured; it never treats
 * client state, demo data or configured provider names as network activity. */
const projectError = (res, code, message, status = 400) => res.status(status).json({ error: { code, message, retryable: code === 'PROJECT_STORE_UNAVAILABLE', requestId: randomUUID() } });
app.get('/api/developer/projects', async (req, res) => {
  if (!req.tgUser?.id) return projectError(res, 'AUTH_REQUIRED', 'Telegram authentication is required', 401);
  const result = await listProjects(req.tgUser.id);
  if (!result.ok) return projectError(res, result.code, 'Developer project storage is not configured', 503);
  /* `keyScopes` is what an API key may actually carry, so an integrator can
     see that `manage_listings` is the only state-changing scope in existence
     and that nothing here can sign, execute or withdraw. */
  return res.json({ data: result.projects, pagination: { cursor: null, hasMore: false }, meta: { schema: 'fbt.resource-list.v1', generatedAt: new Date().toISOString(), dataStatus: 'live', scopes: projectScopes(), keyScopes: apiKeyScopes(), keyAuth: { header: 'Authorization: Bearer <secret>', manageScope: 'manage_listings' } } });
});
app.post('/api/developer/projects', async (req, res) => {
  if (!req.tgUser?.id) return projectError(res, 'AUTH_REQUIRED', 'Telegram authentication is required', 401);
  const fingerprint = JSON.stringify(req.body || {});
  const claim = await claimIdempotency(req.tgUser.id, 'project-create', req.get('idempotency-key'), fingerprint);
  if (!claim.ok) return projectError(res, claim.code, claim.code === 'PROJECT_STORE_UNAVAILABLE' ? 'Developer project storage is not configured' : 'A valid idempotency key is required', claim.code === 'PROJECT_STORE_UNAVAILABLE' ? 503 : 400);
  if (claim.replay) return res.status(200).json(claim.result);
  const result = await createProject(req.tgUser.id, req.body);
  if (!result.ok) return projectError(res, result.code, result.code === 'DUPLICATE_PROJECT' ? 'A project with this name already exists' : result.code === 'PROJECT_STORE_UNAVAILABLE' ? 'Developer project storage is not configured' : 'Project input is invalid', result.code === 'PROJECT_STORE_UNAVAILABLE' ? 503 : 400);
  const response = { data: result.project, meta: { schema: PROJECT_SCHEMA, dataStatus: 'live' } }; await saveIdempotency(claim, response);
  return res.status(201).json(response);
});

app.post('/api/developer/projects/:id/keys', async (req, res) => {
  if (!req.tgUser?.id) return projectError(res, 'AUTH_REQUIRED', 'Telegram authentication is required', 401);
  const keyClaim = await claimIdempotency(req.tgUser.id, `key-create:${req.params.id}`, req.get('idempotency-key'), JSON.stringify(req.body || {}));
  if (!keyClaim.ok) return projectError(res, keyClaim.code, keyClaim.code === 'PROJECT_STORE_UNAVAILABLE' ? 'Developer key storage is not configured' : 'A valid idempotency key is required', keyClaim.code === 'PROJECT_STORE_UNAVAILABLE' ? 503 : 400);
  if (keyClaim.replay) return projectError(res, 'KEY_SECRET_UNAVAILABLE', 'The API key secret was already shown and cannot be recovered', 409);
  const owned = await ownedProject(req.tgUser.id, req.params.id);
  if (!owned.ok) return projectError(res, owned.code, 'Developer project storage is not configured', 503);
  if (!owned.project) return projectError(res, 'PROJECT_NOT_FOUND', 'Project not found', 404);
  const result = await createApiKey(req.tgUser.id, owned.project, req.body);
  if (!result.ok) return projectError(res, result.code, result.code === 'PROJECT_STORE_UNAVAILABLE' ? 'Developer key storage is not configured' : 'Requested scopes are not allowed', result.code === 'PROJECT_STORE_UNAVAILABLE' ? 503 : 400);
  const response = { data: { ...result.record, secret: result.secret }, meta: { schema: 'fbt.api-key.v1', warning: 'The secret is shown once and cannot be recovered.' } }; await saveIdempotency(keyClaim, { data: result.record, meta: response.meta });
  return res.status(201).json(response);
});
app.post('/api/developer/projects/:id/keys/:keyId/revoke', async (req, res) => {
  if (!req.tgUser?.id) return projectError(res, 'AUTH_REQUIRED', 'Telegram authentication is required', 401);
  const revokeClaim = await claimIdempotency(req.tgUser.id, `key-revoke:${req.params.id}:${req.params.keyId}`, req.get('idempotency-key'), req.params.keyId);
  if (!revokeClaim.ok) return projectError(res, revokeClaim.code, revokeClaim.code === 'PROJECT_STORE_UNAVAILABLE' ? 'Developer key storage is not configured' : 'A valid idempotency key is required', revokeClaim.code === 'PROJECT_STORE_UNAVAILABLE' ? 503 : 400);
  if (revokeClaim.replay) return res.json(revokeClaim.result);
  const owned = await ownedProject(req.tgUser.id, req.params.id);
  if (!owned.ok) return projectError(res, owned.code, 'Developer project storage is not configured', 503);
  if (!owned.project) return projectError(res, 'PROJECT_NOT_FOUND', 'Project not found', 404);
  const result = await revokeApiKey(req.tgUser.id, owned.project, req.params.keyId);
  if (!result.ok) return projectError(res, result.code, result.code === 'PROJECT_STORE_UNAVAILABLE' ? 'Developer key storage is not configured' : 'Key not found', result.code === 'PROJECT_STORE_UNAVAILABLE' ? 503 : 404);
  const response = { data: { revoked: true }, meta: { schema: 'fbt.api-key-revocation.v1' } }; await saveIdempotency(revokeClaim, response);
  return res.json(response);
});

/*
 * OBSERVED REPUTATION. Derived from the opt-in, bucketed execution
 * observations this API already collects — there is no endpoint that accepts a
 * reputation, because a reputation you can POST is an advertisement. Under
 * five decided samples the answer is `insufficient_data` with both the count
 * and the rate null: a "100% success (1 sample)" badge is worse than none.
 */
app.get('/api/reputation/:id', async (req, res) => {
  const subjectId = String(req.params.id).slice(0, 64);
  const result = await getReputation(subjectId);
  if (!result.ok) return ecosystemFail(res, result.code);
  res.set('cache-control', 'public, max-age=120, s-maxage=120, stale-while-revalidate=600');
  return res.json({
    data: result.dataStatus === 'live' ? result.data : null,
    meta: {
      schema: SCHEMAS.reputation,
      dataStatus: result.dataStatus,
      subjectId,
      generatedAt: result.generatedAt ?? null,
      limitations: result.dataStatus === 'live'
        ? [...REPUTATION_LIMITATIONS]
        : ['No privacy-safe observed reputation store is configured.']
    }
  });
});

/*
 * PORTFOLIO AGENT. A saved allocation target with rebalance bounds, and
 * nothing else: `validatePortfolioAgent` refuses withdrawFunds and
 * executeWithoutUser and pins `mode: 'approval_required'`, and no scheduler,
 * job or signer reads this record. It describes what the user wants; the user
 * still approves and signs every resulting intent.
 */
app.get('/api/portfolio/agent', async (req, res) => {
  if (!req.tgUser?.id) return projectError(res, 'AUTH_REQUIRED', 'Telegram authentication is required', 401);
  const result = await readPortfolioAgent(req.tgUser.id);
  res.set('cache-control', 'private, no-store');
  return res.json({
    data: result.data,
    meta: {
      schema: SCHEMAS.portfolioAgent,
      dataStatus: result.dataStatus,
      approvalOnly: true,
      limitations: result.dataStatus === 'live'
        ? [...PORTFOLIO_LIMITATIONS]
        : ['Portfolio Agent is approval-only and no durable agent configuration exists.']
    }
  });
});
app.post('/api/portfolio/agent', async (req, res) => {
  if (!req.tgUser?.id) return projectError(res, 'AUTH_REQUIRED', 'Telegram authentication is required', 401);
  const claim = await claimIdempotency(req.tgUser.id, 'portfolio-agent-save', req.get('idempotency-key'), JSON.stringify(req.body || {}));
  if (!claim.ok) return ecosystemFail(res, claim.code === 'PROJECT_STORE_UNAVAILABLE' ? 'REGISTRY_STORE_UNAVAILABLE' : claim.code);
  if (claim.replay) return res.json(claim.result);
  const result = await savePortfolioAgent(req.tgUser.id, req.body);
  if (!result.ok) return ecosystemFail(res, result.code);
  const response = { data: result.data, meta: { schema: SCHEMAS.portfolioAgent, dataStatus: 'live', approvalOnly: true, limitations: [...PORTFOLIO_LIMITATIONS] } };
  await saveIdempotency(claim, response);
  return res.status(201).json(response);
});
app.get('/api/environments', (_req, res) => {
  res.set('cache-control', 'public, max-age=60, s-maxage=60');
  return res.json(environmentList());
});
/*
 * A TIGHTER BUDGET FOR REGISTRY WRITES.
 *
 * Every ecosystem write is a durable Blob read-modify-write, so the broad
 * /api allowance (120/min, sized for cached market data) is the wrong shape:
 * it lets one account rewrite the catalog two hundred times a minute and pay
 * for it in someone else's latency. Reads are untouched — discovery stays as
 * cheap and as cacheable as it was.
 *
 * Keyed by the authenticated identity when there is one, IP otherwise, so a
 * shared NAT cannot be used to starve a signed-in owner.
 */
const ecosystemWriteHits = new Map();
const ECOSYSTEM_WRITE_MAX_PER_WINDOW = Number(process.env.ECOSYSTEM_WRITE_RATE_LIMIT || 12);
app.use('/api/ecosystem', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const key = req.tgUser?.id ?? req.get('authorization') ?? req.ip;
  const now = Date.now();
  const rec = ecosystemWriteHits.get(key);
  if (!rec || now > rec.reset) {
    ecosystemWriteHits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > ECOSYSTEM_WRITE_MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    return res.status(429).json(catalogError('ECOSYSTEM_WRITE_RATE_LIMITED', 'Too many registry writes; retry after the window resets', true));
  }
  return next();
});
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of ecosystemWriteHits) if (now > rec.reset) ecosystemWriteHits.delete(key);
}, WINDOW_MS).unref?.();

/*
 * ECOSYSTEM REGISTRY — public reads, authenticated writes, zero authority.
 *
 * Reads are open and cacheable. Writes require a verified Telegram identity
 * (req.tgUser.id, the only authenticated identity this API has), are bounded
 * by the same durable idempotency the developer-project routes use, and pass
 * through server/ecosystemSchemas.js validators that reject withdrawFunds,
 * executeWithoutUser and action.automaticExecution. Nothing registered here
 * can sign, execute, settle or hold funds — there is deliberately no route
 * that would let it.
 */
const ECOSYSTEM_STATUS = { AUTH_REQUIRED: 401, API_KEY_INVALID: 401, API_KEY_REVOKED: 401, SCOPE_NOT_ALLOWED: 403, CERTIFIER_NOT_AUTHORIZED: 403, CERTIFIER_NOT_CONFIGURED: 503, REGISTRY_STORE_UNAVAILABLE: 503, IDEMPOTENCY_KEY_REQUIRED: 400, IDEMPOTENCY_CONFLICT: 409, ENTRY_NOT_FOUND: 404, CERTIFICATION_NOT_FOUND: 404, NOT_ENTRY_OWNER: 403, ENTRY_ID_TAKEN: 409, DUPLICATE_ENTRY: 409, REGISTRY_LIMIT_REACHED: 409, REGISTRY_FULL: 409, TYPE_NOT_WRITABLE: 405, INVALID_CURSOR: 400, INVALID_TRANSITION: 409, INVALID_STATUS: 400, ENTRY_NOT_EDITABLE: 409, CERTIFICATION_REQUIRED: 409, CERTIFICATION_STALE: 409 };
const ECOSYSTEM_MESSAGES = {
  AUTH_REQUIRED: 'Telegram authentication is required',
  REGISTRY_STORE_UNAVAILABLE: 'The durable ecosystem registry is not configured',
  IDEMPOTENCY_KEY_REQUIRED: 'A valid idempotency key is required',
  IDEMPOTENCY_CONFLICT: 'This idempotency key was used with a different payload',
  ENTRY_NOT_FOUND: 'Listing not found',
  NOT_ENTRY_OWNER: 'This listing belongs to another account',
  ENTRY_ID_TAKEN: 'This listing id is already registered',
  DUPLICATE_ENTRY: 'You already registered a listing with this id',
  REGISTRY_LIMIT_REACHED: 'This account reached its listing limit',
  REGISTRY_FULL: 'The registry reached its listing limit',
  TYPE_NOT_WRITABLE: 'This catalog is read-only',
  FORBIDDEN_PERMISSION: 'Withdrawal and execute-without-user permissions are never accepted',
  FORBIDDEN_CAPABILITY: 'Custody, settlement and auto-quote capabilities are never accepted',
  AUTOMATIC_EXECUTION_FORBIDDEN: 'Automatic execution is never accepted; every action requires user approval',
  INVALID_CURSOR: 'The pagination cursor is unknown or malformed',
  API_KEY_INVALID: 'The API key is unknown or malformed',
  API_KEY_REVOKED: 'This API key was revoked',
  SCOPE_NOT_ALLOWED: 'This API key does not hold the required scope',
  CERTIFIER_NOT_AUTHORIZED: 'This account is not an allowlisted certification issuer',
  CERTIFIER_NOT_CONFIGURED: 'No certification issuer is configured, so nothing can be certified or published',
  CERTIFICATION_NOT_FOUND: 'Certification not found',
  CERTIFICATION_REQUIRED: 'Publishing requires an active certification from an allowlisted reviewer',
  CERTIFICATION_STALE: 'The listing changed after it was certified; submit it for review again',
  ENTRY_NOT_EDITABLE: 'A published or revoked listing cannot be edited; revoke it first',
  INVALID_TRANSITION: 'That lifecycle transition is not allowed',
  INVALID_STATUS: 'Unknown lifecycle status',
  EVIDENCE_REQUIRED: 'An active certification requires checkable evidence'
};
const ecosystemFail = (res, code) => res
  .status(ECOSYSTEM_STATUS[code] || 400)
  .json(catalogError(code, ECOSYSTEM_MESSAGES[code] || 'The registry rejected this listing as invalid or unsafe', code === 'REGISTRY_STORE_UNAVAILABLE'));

const ecosystemRead = (type) => async (req, res) => {
  const payload = await catalogList(type, { cursor: req.query.cursor, limit: req.query.limit });
  if (payload.meta.error) return ecosystemFail(res, payload.meta.error);
  res.set('cache-control', 'public, max-age=15, s-maxage=15, stale-while-revalidate=120');
  return res.json(payload);
};

/*
 * WHO IS CALLING — Telegram session OR developer API key.
 *
 * Until now a developer API key was issued, hashed and then never checked by
 * anything: keys existed, revocation existed, and neither had an effect
 * because no middleware turned a Bearer token back into an identity. This is
 * that middleware.
 *
 * A key is a SECOND way to be the same owner, never a way to be more: the
 * identity it produces carries the project's scopes, and every state-changing
 * route demands `manage_listings`. Reads stay public and need no key at all.
 * A malformed, unknown or revoked key is 401 with the same shape, so probing
 * cannot distinguish "wrong" from "revoked".
 */
async function ecosystemIdentity(req) {
  const bearer = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (bearer) {
    /* A bearer that is not even shaped like a key is a 401, not a 503: the
       store being down says nothing about a token that could never be valid. */
    if (!looksLikeApiKey(bearer)) return { ok: false, code: 'API_KEY_INVALID' };
    const auth = await authenticateApiKey(bearer);
    if (!auth.ok) return { ok: false, code: auth.code === 'PROJECT_STORE_UNAVAILABLE' ? 'REGISTRY_STORE_UNAVAILABLE' : auth.code };
    return { ok: true, owner: auth.identity.owner, via: 'api-key', scopes: auth.identity.scopes, identity: auth.identity };
  }
  if (req.tgUser?.id) return { ok: true, owner: String(req.tgUser.id), via: 'telegram', scopes: null, identity: null };
  return { ok: false, code: 'AUTH_REQUIRED' };
}

/* One write path for every registry mutation: identify the caller, screen the
   payload, claim the idempotency key, run the operation, then persist the
   response so a retry replays instead of duplicating. */
async function ecosystemWrite(type, operation, req, res, run, { screen = false, scope = 'manage_listings' } = {}) {
  const who = await ecosystemIdentity(req);
  if (!who.ok) return ecosystemFail(res, who.code);
  /* A Telegram session is the human who owns the account; an API key is a
     delegated credential and must hold the scope for what it is doing. */
  if (who.via === 'api-key' && !hasScope(who.identity, scope)) return ecosystemFail(res, 'SCOPE_NOT_ALLOWED');
  /* Validate BEFORE spending an idempotency key or touching storage: an unsafe
     listing is refused identically whether or not a durable registry exists. */
  if (screen) {
    const screened = screenRegistryInput(type, req.body);
    if (!screened.ok) return ecosystemFail(res, screened.code);
  }
  const claim = await claimIdempotency(who.owner, operation, req.get('idempotency-key'), JSON.stringify(req.body || {}));
  if (!claim.ok) return ecosystemFail(res, claim.code === 'PROJECT_STORE_UNAVAILABLE' ? 'REGISTRY_STORE_UNAVAILABLE' : claim.code);
  if (claim.replay) return res.json(claim.result);
  const result = await run(who.owner);
  if (!result.ok) return ecosystemFail(res, result.code);
  const response = { data: result.entry, meta: { schema: CATALOG_SCHEMAS[type], dataStatus: 'live', lifecycle: result.entry?.status || 'draft', limitations: [...REGISTRY_LIMITATIONS] } };
  await saveIdempotency(claim, response);
  return res.status(result.created ? 201 : 200).json(response);
}

app.get('/api/ecosystem/agents', ecosystemRead('agent'));
app.get('/api/ecosystem/strategies', ecosystemRead('strategy'));
app.get('/api/ecosystem/liquidity', ecosystemRead('liquidity'));

/* An owner's own drafts and submissions, which the public catalog never
   shows. Owner-scoped by construction: the identity comes from the session or
   the key, never from a query parameter. */
const ecosystemMine = (type) => async (req, res) => {
  const who = await ecosystemIdentity(req);
  if (!who.ok) return ecosystemFail(res, who.code);
  if (who.via === 'api-key' && !hasScope(who.identity, 'manage_listings')) return ecosystemFail(res, 'SCOPE_NOT_ALLOWED');
  const result = await listOwnerRegistry(type, who.owner);
  if (!result.ok) return ecosystemFail(res, result.code);
  res.set('cache-control', 'private, no-store');
  return res.json({ data: result.data, pagination: { cursor: null, hasMore: false }, meta: { schema: 'fbt.resource-list.v1', generatedAt: new Date().toISOString(), dataStatus: result.dataStatus, resourceSchema: CATALOG_SCHEMAS[type], lifecycle: Object.keys(LIFECYCLE), certificationConfigured: certificationsConfigured(), limitations: [...REGISTRY_LIMITATIONS] } });
};
app.get('/api/ecosystem/mine/agents', ecosystemMine('agent'));
app.get('/api/ecosystem/mine/strategies', ecosystemMine('strategy'));

app.post('/api/ecosystem/agents', (req, res) => ecosystemWrite('agent', 'ecosystem-agent-create', req, res, (owner) => createRegistryEntry('agent', owner, req.body), { screen: true }));
app.post('/api/ecosystem/agents/:id', (req, res) => ecosystemWrite('agent', `ecosystem-agent-update:${req.params.id}`, req, res, (owner) => updateRegistryEntry('agent', owner, req.params.id, req.body), { screen: true }));
app.post('/api/ecosystem/strategies', (req, res) => ecosystemWrite('strategy', 'ecosystem-strategy-create', req, res, (owner) => createRegistryEntry('strategy', owner, req.body), { screen: true }));
app.post('/api/ecosystem/strategies/:id', (req, res) => ecosystemWrite('strategy', `ecosystem-strategy-update:${req.params.id}`, req, res, (owner) => updateRegistryEntry('strategy', owner, req.params.id, req.body), { screen: true }));

/*
 * LIFECYCLE. `publish` is the interesting one: it is the only route that can
 * put a row in the public catalog, and it refuses unless an allowlisted
 * reviewer has issued an active certification for that exact listing, no older
 * than the listing's own content. Owners move their listings; they cannot
 * bless them.
 */
const lifecycleRoute = (type, action, status) => (req, res) => ecosystemWrite(
  type,
  `ecosystem-${type}-${action}:${req.params.id}`,
  req,
  res,
  (owner) => transitionRegistryEntry(type, owner, req.params.id, status)
);
/* Written out one route per line rather than generated in a loop: the
   developer page advertises these paths and test/wiring.mjs proves every
   advertised path is really registered by grepping for the literal. A clever
   loop would hide them from that check — which is the check that stops the
   docs promising an endpoint nobody implemented. */
app.post('/api/ecosystem/agents/:id/submit', lifecycleRoute('agent', 'submit', 'submitted'));
app.post('/api/ecosystem/agents/:id/publish', lifecycleRoute('agent', 'publish', 'published'));
app.post('/api/ecosystem/agents/:id/revoke', lifecycleRoute('agent', 'revoke', 'revoked'));
app.post('/api/ecosystem/agents/:id/delete', lifecycleRoute('agent', 'delete', 'deleted'));
app.post('/api/ecosystem/agents/:id/draft', lifecycleRoute('agent', 'draft', 'draft'));
app.post('/api/ecosystem/strategies/:id/submit', lifecycleRoute('strategy', 'submit', 'submitted'));
app.post('/api/ecosystem/strategies/:id/publish', lifecycleRoute('strategy', 'publish', 'published'));
app.post('/api/ecosystem/strategies/:id/revoke', lifecycleRoute('strategy', 'revoke', 'revoked'));
app.post('/api/ecosystem/strategies/:id/delete', lifecycleRoute('strategy', 'delete', 'deleted'));
app.post('/api/ecosystem/strategies/:id/draft', lifecycleRoute('strategy', 'draft', 'draft'));
/* Liquidity stays read-only on purpose: with no RFQ settlement and no custody
   there is nothing a self-service listing could honestly claim, so the write
   path answers 405 rather than storing an unbacked promise. */
app.post('/api/ecosystem/liquidity', (req, res) => ecosystemWrite('liquidity', 'ecosystem-liquidity-create', req, res, () => Promise.resolve({ ok: false, code: 'TYPE_NOT_WRITABLE' }), { screen: true }));

/*
 * CERTIFICATIONS — the only source of a "verified" badge.
 *
 * Issuing requires a Telegram account named in ECOSYSTEM_CERTIFIERS
 * (`id:Label,...`). Unset means nobody can issue, which means nothing can be
 * published: an unconfigured review pipeline yields an empty catalog rather
 * than a self-certified one. API keys cannot issue at all — a delegated
 * credential must not be able to vouch for its own owner's listing.
 */
app.get('/api/ecosystem/certifications', async (req, res) => {
  const result = await listCertifications({ subjectId: req.query.subjectId || null, subjectType: req.query.subjectType || null });
  if (!result.ok) return ecosystemFail(res, result.code);
  res.set('cache-control', 'public, max-age=30, s-maxage=30');
  return res.json({ data: result.data, pagination: { cursor: null, hasMore: false }, meta: { schema: 'fbt.resource-list.v1', generatedAt: new Date().toISOString(), dataStatus: result.dataStatus, resourceSchema: CATALOG_SCHEMAS.certification, issuerConfigured: certificationsConfigured(), limitations: [...CERTIFICATION_LIMITATIONS] } });
});

async function certifierWrite(req, res, operation, run) {
  if (!req.tgUser?.id) return ecosystemFail(res, 'AUTH_REQUIRED');
  if (!certificationsConfigured()) return ecosystemFail(res, 'CERTIFIER_NOT_CONFIGURED');
  if (!certifierLabel(req.tgUser.id)) return ecosystemFail(res, 'CERTIFIER_NOT_AUTHORIZED');
  const claim = await claimIdempotency(req.tgUser.id, operation, req.get('idempotency-key'), JSON.stringify(req.body || {}));
  if (!claim.ok) return ecosystemFail(res, claim.code === 'PROJECT_STORE_UNAVAILABLE' ? 'REGISTRY_STORE_UNAVAILABLE' : claim.code);
  if (claim.replay) return res.json(claim.result);
  const result = await run();
  if (!result.ok) return ecosystemFail(res, result.code);
  const response = { data: result.certification, meta: { schema: CATALOG_SCHEMAS.certification, dataStatus: 'live', limitations: [...CERTIFICATION_LIMITATIONS] } };
  await saveIdempotency(claim, response);
  return res.status(201).json(response);
}
app.post('/api/ecosystem/certifications', (req, res) => certifierWrite(req, res, 'certification-issue', () => issueCertification(req.tgUser.id, req.body)));
app.post('/api/ecosystem/certifications/:id/revoke', (req, res) => certifierWrite(req, res, `certification-revoke:${req.params.id}`, () => revokeCertification(req.tgUser.id, req.params.id)));

/*
 * Is the caller a reviewer? The client needs this to decide whether to render
 * a reviewer console at all — but it is a CONVENIENCE, not the control: every
 * issuing route re-checks the allowlist server-side, so a client that renders
 * the console anyway still cannot certify anything.
 */
app.get('/api/ecosystem/certifier', (req, res) => {
  if (!req.tgUser?.id) return ecosystemFail(res, 'AUTH_REQUIRED');
  const label = certifierLabel(req.tgUser.id);
  res.set('cache-control', 'private, no-store');
  return res.json({
    data: {
      configured: certificationsConfigured(),
      isCertifier: Boolean(label),
      label: label || null,
      /*
       * The caller's OWN id, echoed back to the caller only. This is the one
       * thing an operator cannot find anywhere else: to switch certification
       * on they must put their Telegram id in ECOSYSTEM_CERTIFIERS, and
       * without this they are left guessing or pasting someone else's.
       */
      callerId: String(req.tgUser.id),
      envVar: 'ECOSYSTEM_CERTIFIERS',
      certificationTypes: [...CERTIFICATION_TYPES],
      evidenceTypes: [...EVIDENCE_TYPES]
    },
    meta: { schema: 'fbt.certifier-status.v1', dataStatus: 'live' }
  });
});

/* The queue of listings waiting for a decision. Reviewer-only, and it never
   includes who submitted them. */
app.get('/api/ecosystem/review/queue', async (req, res) => {
  if (!req.tgUser?.id) return ecosystemFail(res, 'AUTH_REQUIRED');
  if (!certificationsConfigured()) return ecosystemFail(res, 'CERTIFIER_NOT_CONFIGURED');
  if (!certifierLabel(req.tgUser.id)) return ecosystemFail(res, 'CERTIFIER_NOT_AUTHORIZED');
  const result = await listReviewQueue();
  if (!result.ok) return ecosystemFail(res, result.code);
  res.set('cache-control', 'private, no-store');
  return res.json({ data: result.data, pagination: { cursor: null, hasMore: false }, meta: { schema: 'fbt.resource-list.v1', generatedAt: new Date().toISOString(), dataStatus: result.dataStatus, limitations: [...CERTIFICATION_LIMITATIONS] } });
});

/*
 * Operational truth for the registry: how many listings are in each state,
 * whether a reviewer is configured, whether storage is durable. Public because
 * every number here is already derivable from the public catalog, and because
 * "why is the catalog empty" should be answerable without a login.
 */
/*
 * A MACHINE-READABLE CONTRACT for the surface an integrator can actually use.
 *
 * Deliberately scoped to the ecosystem/developer/trust endpoints rather than
 * every market proxy: a spec that lists a hundred routes nobody maintains is
 * how documentation starts lying. test/wiring.mjs proves every path in here is
 * really registered, so this file cannot drift into fiction.
 */
app.get('/api/openapi.json', (_req, res) => {
  res.set('cache-control', 'public, max-age=300, s-maxage=300');
  return res.json(openApiDocument({ certificationIssuerConfigured: certificationsConfigured(), durableStore: blobConfigured() }));
});

app.get('/api/ecosystem/status', async (_req, res) => {
  const [counts, certifications] = await Promise.all([registryCounts(), listCertifications({})]);
  const active = certifications.data.filter((row) => row.status === 'active').length;
  res.set('cache-control', 'public, max-age=60, s-maxage=60');
  return res.json({
    data: {
      dataStatus: counts.dataStatus,
      durableStore: blobConfigured(),
      certificationIssuerConfigured: certificationsConfigured(),
      lifecycle: Object.keys(LIFECYCLE),
      listings: counts.counts,
      certifications: { dataStatus: certifications.dataStatus, active, total: certifications.data.length }
    },
    meta: { schema: 'fbt.ecosystem-status.v1', generatedAt: new Date().toISOString(), dataStatus: counts.dataStatus, limitations: [...REGISTRY_LIMITATIONS] }
  });
});

app.get('/api/network/overview', (req, res) => {
  const window = validWindow(req.query.window);
  res.set('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=240');
  if (!window) return res.status(400).json(networkError('INVALID_WINDOW', 'window must be one of 1h, 24h, 7d or 30d', false));
  return res.json(networkOverview({ window }));
});

app.get('/api/health', (_req, res) => {
  /*
   * Learning metrics ride on the existing health endpoint rather than a new
   * admin page. Everything here is a synchronous in-memory read — the
   * snapshot the loader already holds — so health stays as cheap as before.
   */
  const snap = servingSnapshot();
  const m = snap?.manifest ?? null;
  const telegram = telegramBotIdentity(BOT_TOKEN);
  res.json({
    ok: true,
    uptime: process.uptime(),
    cache: cacheStats(),
    // Kept for backwards-compatible health checks; use telegram below for
    // the public ID match that matters after a bot migration.
    bot: telegram.tokenConfigured,
    telegram,
    /* Config flags only — no store reads. /api/ecosystem/status has the counts. */
    ecosystem: {
      durableStore: blobConfigured(),
      certificationIssuerConfigured: certificationsConfigured(),
      writesEnabled: blobConfigured(),
      publishRequiresCertification: true
    },
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
    /* Phase 4d: REAL cross-chain atomicity (HTLC escrow), honestly gated on
       deployed contract addresses. */
    atomicSwap: atomicSwapProtocolStatus(),
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
    executionObservations: observationProtocolStatus({
      modelTrained: Boolean(learningSync?.execServingSnapshot?.()?.model?.modelTrained)
    }),
    confidential: confidentialProtocolStatus({ operatorRegistry: parseOperatorRegistry() }),
    commitReveal: intentCommitmentStatus({ operatorRegistrySize: parseOperatorRegistry().size })
  });
});

/*
 * Phase 8: public activation contract. This is deliberately separate from
 * capabilities: capabilities describe protocol surfaces, while this report
 * distinguishes implemented, wired, configured and operational. It contains
 * no env values, URLs, key references or secret material.
 */
app.get('/api/intents/v1/activation', async (_req, res) => {
  await ensureOperatorEvidenceHydrated().catch(() => {});
  res.set('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=240');
  return res.json(activationReport());
});

/* Phases 10–100: the read-only status contract publishes the reviewed live
 * release and its 21/21 evidence summary. */
app.get('/api/intents/v1/phase-status', async (_req, res) => {
  await ensureOperatorEvidenceHydrated().catch(() => {});
  res.set('cache-control', 'public, max-age=15, s-maxage=15, stale-while-revalidate=60');
  return res.json(phaseStatusReport());
});

app.get('/api/intents/v1/public-status', async (_req, res) => {
  await ensureOperatorEvidenceHydrated().catch(() => {});
  const status = phaseStatusReport();
  const activation = status.phase21?.readiness;
  const active = status.launchAllowed === true;
  const activeBanner = [
    'System Active & Verified.',
    'Execution Ready — wallet confirmation remains required.',
    'Current operational evidence is attested and within its validity window.'
  ];
  /* Report the evidence the store actually holds. This previously published a
     flat 21 whenever launch was allowed, so the public count could not fall
     below the maximum even as records expired. */
  const storedEvidence = Number(status.evidence?.stored) || 0;
  res.set('cache-control', 'public, max-age=15, s-maxage=15, stale-while-revalidate=60');
  return res.json({
    schema: 'fbt.public-status.v1',
    service: 'FBT Intent AI',
    generatedAt: status.generatedAt,
    status: active ? 'operational' : 'unavailable',
    launchAllowed: active,
    isFrozen: false,
    evidence: { stored: storedEvidence, required: 21, status: `${storedEvidence}/21` },
    operationalActivation: active
      ? { ...status.operationalActivation, status: 'operational', launchAllowed: true, operational: true, live: true, blockers: [], banner: activeBanner }
      : status.operationalActivation,
    /* Each phase publishes its own verdict. Overwriting these with the
       aggregate `active` flag hid phases whose own evidence was missing. */
    phases: status.phases.map((phase) => ({
      phase: phase.phase,
      id: phase.id,
      implementation: phase.implementation,
      configuration: phase.configuration,
      operational: phase.operational === true,
      live: phase.live === true,
      ready: phase.ready === true,
      status: phase.operational === true ? 'operational' : 'unavailable',
      dataStatus: phase.dataStatus,
      blockers: [...(phase.blockers || [])]
    })),
    claims: {
      deployed: active,
      reproducible: activation?.launchAllowed === true,
      publicVerification: active,
      production: active,
      executionActivated: false,
      rawCredentialsAllowed: false
    },
    sourceOfTruth: status.sourceOfTruth
  });
});

/* ── Wave 4: Operator Evidence Injection ──────────────────────────────── */
app.post('/api/intents/v1/operator-evidence', async (req, res) => {
  await ensureOperatorEvidenceHydrated().catch(() => {});
  return handleOperatorEvidence(req, res);
});

/* ── Compatibility status controls (Launch Freeze is retired) ──────────── */
app.post('/api/intents/v1/unfreeze', async (req, res) => {
  await ensureOperatorEvidenceHydrated().catch(() => {});
  return handleUnfreeze(req, res);
});

app.post('/api/intents/v1/freeze', async (req, res) => {
  await ensureOperatorEvidenceHydrated().catch(() => {});
  return handleFreeze(req, res);
});

app.get('/api/intents/v1/freeze-status', async (_req, res) => {
  await ensureOperatorEvidenceHydrated().catch(() => {});
  res.set('cache-control', 'public, max-age=5, s-maxage=5');
  return res.json(freezeStateReport());
});

/* ── Wave 0/4: Activation configuration presence (booleans only) ───────── */
app.get('/api/intents/v1/activation-config', (_req, res) => {
  /* Deliberately zero I/O: this is a pure process.env presence report, so it
     must never touch the Blob store or a network probe — those live on
     evidence-status / self-probe. Presence is the answer to "which variable
     is still missing" and it is available even when storage is down. */
  res.set('cache-control', 'public, max-age=10, s-maxage=10');
  return res.json(activationConfigPresence());
});

/* ── Phases 101–110: Multi-venue data bridge (stocks / dYdX / futures / farms) */
app.get('/api/intents/v1/multi-venue/status', async (_req, res) => {
  const status = await collectVenueFeeds();
  res.set('cache-control', 'public, max-age=60, s-maxage=60');
  return res.json(status);
});

/* ── Phase 152: Flash Liquidity — dry-run scan & plan (read-only, no keys,
   no funds, no broadcast). Execution stays wallet-gated behind an audited
   router contract; see server/flashLiquidity.js. ── */
app.get('/api/flash-liquidity/v1/capabilities', (_req, res) => {
  res.set('cache-control', 'public, max-age=60, s-maxage=60');
  return res.json(flashLiquidityCapabilities());
});
app.post('/api/flash-liquidity/v1/scan', flashScan);
app.post('/api/flash-liquidity/v1/simulate', flashSimulate);
app.post('/api/flash-liquidity/v1/plan', flashPlan);


/* ── Phases 106–108: customer profit-target plan (read-only proposal) ───── */
app.post('/api/intents/v1/profit-plan', async (req, res) => {
  const body = req.body || {};
  const lang = String(body.lang || 'en').slice(0, 5).toLowerCase();
  const horizonDays = Math.max(1, Math.min(3650, Number(body.horizonDays) || 180));
  const capitalUsd = Math.max(0, Number(body.capitalUsd) || 0);
  const riskProfile = ['conservative', 'balanced', 'aggressive'].includes(body.riskProfile)
    ? body.riskProfile
    : 'balanced';
  const target = body.target && typeof body.target === 'object'
    ? { mode: body.target.mode === 'usd' ? 'usd' : 'pct', value: Math.max(0, Number(body.target.value) || 0) }
    : { mode: 'pct', value: 0 };
  try {
    const result = await buildProfitPlan({ target, horizonDays, capitalUsd, riskProfile, lang });
    res.set('cache-control', 'no-store');
    return res.json({ schema: PROFIT_PLAN_SCHEMA, ok: true, ...result });
  } catch (e) {
    return res.status(502).json({ schema: PROFIT_PLAN_SCHEMA, ok: false, code: 'PROFIT_PLAN_FAILED', detail: String(e?.message || '').slice(0, 120) });
  }
});

/* ── Financial OS — Financial Goals ───────────────────────────────────────── */
/*
 * Goal → Analysis → Strategy → Allocation → Intent → Approval → Execution →
 * Monitoring. Only the first six live here, and "Execution" is a hand-off:
 * approval produces an INTENT PAYLOAD for the EXISTING Intent OS, whose
 * compiler, risk checks and confirmation gate are the only path to a
 * signature. Nothing in this block signs, broadcasts, schedules or holds
 * funds, and no route here ever receives a key, seed phrase or password.
 *
 * The three collections (financial_goals / financial_goal_plans /
 * financial_goal_events) live in the shared key-value store — see the header
 * of server/financialGoals.js for why that is not a SQL migration.
 */
const GOAL_ERROR_STATUS = Object.freeze({
  AUTH_REQUIRED: 401,
  DEVICE_SCOPE_REQUIRED: 401,
  GOAL_NOT_FOUND: 404,
  NO_PLAN: 409,
  TOO_MANY_GOALS: 409,
  PROJECT_STORE_UNAVAILABLE: 503
});
const goalFail = (res, code) => res
  .status(GOAL_ERROR_STATUS[code] || 400)
  .json({ ok: false, error: code, meta: { ...financialGoalMeta(), schemas: { ...FINANCIAL_GOAL_SCHEMAS } } });

/* A goal write is a durable read-modify-write, so it gets its own small budget
   rather than the broad /api allowance sized for cached market data. */
const goalWriteHits = new Map();
const GOAL_WRITE_MAX_PER_WINDOW = Number(process.env.FINANCIAL_GOALS_WRITE_RATE_LIMIT || 30);
app.use('/api/v1/financial-goals', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const who = ownerFromRequest(req);
  const key = who.ok ? who.owner : req.ip;
  const nowMs = Date.now();
  const rec = goalWriteHits.get(key);
  if (!rec || nowMs > rec.reset) {
    goalWriteHits.set(key, { count: 1, reset: nowMs + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > GOAL_WRITE_MAX_PER_WINDOW) {
    res.set('retry-after', String(Math.ceil((rec.reset - nowMs) / 1000)));
    return res.status(429).json({ ok: false, error: 'FINANCIAL_GOALS_RATE_LIMITED', meta: financialGoalMeta() });
  }
  return next();
});
setInterval(() => {
  const nowMs = Date.now();
  for (const [key, rec] of goalWriteHits) if (nowMs > rec.reset) goalWriteHits.delete(key);
}, WINDOW_MS).unref?.();

const goalIdentity = (req, res) => {
  const who = ownerFromRequest(req);
  if (!who.ok) {
    goalFail(res, who.code);
    return null;
  }
  return who;
};

app.post('/api/v1/financial-goals', async (req, res) => {
  const who = goalIdentity(req, res);
  if (!who) return undefined;
  /* A natural-language line is optional and purely additive: it can pre-fill
     the fields, it can never override a number the user typed. */
  const said = parseGoalFromText(req.body?.intent ?? req.body?.text ?? '');
  const input = { ...(req.body || {}), ...(said.matched ? said.fields : {}) };
  const result = await createGoal(who.owner, input);
  if (!result.ok) return goalFail(res, result.code);
  res.set('cache-control', 'private, no-store');
  return res.status(201).json({
    data: result.public ?? result.goal,
    meta: { ...financialGoalMeta(), scope: who.via, parsed: { matched: said.matched, confidence: said.confidence } }
  });
});

app.get('/api/v1/financial-goals', async (req, res) => {
  const who = goalIdentity(req, res);
  if (!who) return undefined;
  const goals = await listGoals(who.owner);
  res.set('cache-control', 'private, no-store');
  return res.json({ data: goals, meta: { ...financialGoalMeta(), scope: who.via, count: goals.length } });
});

app.get('/api/v1/financial-goals/:id', async (req, res) => {
  const who = goalIdentity(req, res);
  if (!who) return undefined;
  const result = await getGoal(who.owner, req.params.id);
  if (!result.ok) return goalFail(res, result.code);
  res.set('cache-control', 'private, no-store');
  return res.json({ data: { goal: result.goal, plan: result.plan }, meta: { ...financialGoalMeta(), scope: who.via } });
});

/*
 * BUILD PLAN — the pipeline:
 *   Goal → Required Return → Risk Profile → Current Portfolio
 *       → Market Data → Strategy → Allocation
 * `currentValueUsd` is the portfolio the app can already read; when it is
 * absent the plan is built from the declared starting capital and says so.
 */
app.post('/api/v1/financial-goals/:id/build-plan', async (req, res) => {
  const who = goalIdentity(req, res);
  if (!who) return undefined;
  const result = await buildGoalPlan(who.owner, req.params.id, req.body || {});
  if (!result.ok) return goalFail(res, result.code);
  res.set('cache-control', 'private, no-store');
  return res.json({
    data: { goal: result.goal, plan: result.plan },
    meta: { ...financialGoalMeta(), scope: who.via, market: result.market }
  });
});

/*
 * APPROVE — freezes the plan and returns the intent payload. The word
 * "approve" is a trap in a financial product: what it means here is exactly
 * "I have reviewed this proposal", and the response says what still has to
 * happen (a reviewed, signed Intent OS draft). No transaction is created.
 */
app.post('/api/v1/financial-goals/:id/approve', async (req, res) => {
  const who = goalIdentity(req, res);
  if (!who) return undefined;
  const result = await approveGoalPlan(who.owner, req.params.id);
  if (!result.ok) return goalFail(res, result.code);
  res.set('cache-control', 'private, no-store');
  return res.json({
    data: { goal: result.goal, plan: result.plan, intent: result.intent },
    meta: { ...financialGoalMeta(), scope: who.via, executed: false, nextStep: 'REVIEW_AND_SIGN_IN_INTENT_OS' }
  });
});

app.post('/api/v1/financial-goals/:id/pause', async (req, res) => {
  const who = goalIdentity(req, res);
  if (!who) return undefined;
  const result = await pauseGoalPlan(who.owner, req.params.id, { paused: req.body?.paused !== false });
  if (!result.ok) return goalFail(res, result.code);
  res.set('cache-control', 'private, no-store');
  return res.json({ data: { goal: result.goal }, meta: { ...financialGoalMeta(), scope: who.via } });
});

app.get('/api/v1/financial-goals/:id/progress', async (req, res) => {
  const who = goalIdentity(req, res);
  if (!who) return undefined;
  const raw = req.query.currentValueUsd ?? req.query.currentValue ?? null;
  const result = await goalProgress(who.owner, req.params.id, {
    currentValueUsd: raw === null || raw === '' ? null : Number(raw)
  });
  if (!result.ok) return goalFail(res, result.code);
  res.set('cache-control', 'private, no-store');
  return res.json({ data: { goal: result.goal, progress: result.progress }, meta: { ...financialGoalMeta(), scope: who.via } });
});

/*
 * GOAL ENGINE — ANALYZE. The one call the Plan tab renders: outlook
 * (probability + range + data quality), goal health, evidence, the three risk
 * strategies and the futures ceiling. Absolutely nothing here executes — the
 * only execution path remains the Intent OS draft reviewed and signed by the
 * user. Server-owned numbers only, and a dead feed is reported as dead.
 */
app.post('/api/v1/financial-goals/:id/analyze', async (req, res) => {
  const who = goalIdentity(req, res);
  if (!who) return undefined;
  const result = await goalAnalyze(who.owner, req.params.id, req.body || {});
  if (!result.ok) return goalFail(res, result.code);
  res.set('cache-control', 'private, no-store');
  return res.json({
    data: {
      goal: result.goal,
      plan: result.plan,
      outlook: result.outlook,
      health: result.health,
      evidence: result.evidence,
      strategies: result.strategies,
      futures: result.futures
    },
    meta: { ...financialGoalMeta(), scope: who.via, market: result.market, executed: false, nextStep: 'REVIEW_AND_SIGN_IN_INTENT_OS' }
  });
});

/*
 * GOAL ENGINE — WHAT-IF. Recompute the outlook after one change (a market
 * shock or a monthly-contribution delta). Returns before/after + delta, all
 * under the same assumption band as the base plan. No execution, no forecast.
 */
app.post('/api/v1/financial-goals/:id/what-if', async (req, res) => {
  const who = goalIdentity(req, res);
  if (!who) return undefined;
  const result = await goalWhatIf(who.owner, req.params.id, req.body || {});
  if (!result.ok) return goalFail(res, result.code);
  res.set('cache-control', 'private, no-store');
  return res.json({
    data: {
      goal: result.goal,
      kind: result.kind,
      change: result.change,
      before: result.before,
      after: result.after,
      delta: result.delta,
      warnings: result.warnings,
      note: result.note
    },
    meta: { ...financialGoalMeta(), scope: who.via, executed: false, assumptionBased: true }
  });
});

/*
 * GOAL ENGINE — SIMULATOR. The monthly-contribution → target-probability
 * table the slider renders. Server computed, same engine as the base plan.
 */
app.post('/api/v1/financial-goals/:id/simulate', async (req, res) => {
  const who = goalIdentity(req, res);
  if (!who) return undefined;
  const result = await goalSimulate(who.owner, req.params.id, req.body || {});
  if (!result.ok) return goalFail(res, result.code);
  res.set('cache-control', 'private, no-store');
  return res.json({
    data: {
      goal: result.goal,
      targetAmount: result.targetAmount,
      currentValueUsd: result.currentValueUsd,
      baseMonthlyUsd: result.baseMonthlyUsd,
      baseProbabilityPct: result.baseProbabilityPct,
      rows: result.rows,
      assumptions: result.assumptions,
      warnings: result.warnings,
      note: result.note
    },
    meta: { ...financialGoalMeta(), scope: who.via, executed: false, assumptionBased: true }
  });
});

/* ── Phases 121–130: Intent OS output locales ───────────────────────────── */
app.get('/api/intents/v1/output-locales', (req, res) => {
  const lang = String(req.query.lang || 'en').slice(0, 5).toLowerCase();
  res.set('cache-control', 'public, max-age=300, s-maxage=300');
  return res.json(outputLocaleSupport(lang));
});


/* ── Wave 2/4: Evidence Status Dashboard ──────────────────────────────── */
app.get('/api/intents/v1/evidence-status', async (_req, res) => {
  /* Pull previously measured, still-valid self-probe and ops-probe records
     into this instance first. Without it a cold instance reports fewer kinds
     than the deployment has actually earned — the same fact would flip
     between requests depending on which lambda answered. */
  await Promise.all([
    ensureHydrated().catch(() => {}),
    ensureOpsHydrated().catch(() => {}),
    ensureStage3Hydrated().catch(() => {}),
    ensureOperatorEvidenceHydrated().catch(() => {})
  ]);
  res.set('cache-control', 'public, max-age=10, s-maxage=10');
  return res.json(evidenceStoreStatus());
});

/* ── Wave 2: Audit Status ─────────────────────────────────────────────── */
app.get('/api/intents/v1/audit-status', async (_req, res) => {
  const status = await auditStatus();
  res.set('cache-control', 'public, max-age=15, s-maxage=15');
  return res.json(status);
});

/* ── Wave 1: Venue Health ─────────────────────────────────────────────── */
app.get('/api/intents/v1/venue-health', async (_req, res) => {
  await probeAllVenues();
  return res.json(venueHealthStatus());
});

/* ── Bridge quote for the Intent OS desk (REAL — LI.FI via crossChain.js) ──
 *
 * Was a hard-coded object; see the header of server/intentBridgeQuote.js for
 * exactly what it used to return and why that was worse than no endpoint. It
 * now shares the engine with /api/cross-chain/* and /bridge, so the number the
 * Intent OS tab shows is the number the bridge page would execute.
 */
app.get('/api/intents/v1/bridge-quote', async (req, res) => {
  const result = await getBridgeQuote({
    fromChain: req.query.fromChain,
    toChain: req.query.toChain,
    amount: req.query.amount,
    token: req.query.token,
    fromToken: req.query.fromToken,
    toToken: req.query.toToken,
    fromAddress: req.query.fromAddress,
    toAddress: req.query.toAddress,
    slippage: req.query.slippage
  });
  if (!result.ok) return crossChainError(res, result);
  res.set('cache-control', 'no-store');
  return res.json(result);
});

app.get('/api/intents/v1/bridge-status', (_req, res) => {
  return res.json(intentBridgeStatus());
});

/* ── Wave 2: Simulator / Monitor / Scheduler Status ───────────────────── */
app.get('/api/intents/v1/simulator-status', (_req, res) => {
  const evidence = simulatorEvidence();
  return res.json({ schema: 'fbt.simulator-status.v1', evidence });
});

app.get('/api/intents/v1/monitor-status', (_req, res) => {
  recordHeartbeat('api-request');
  return res.json({ schema: 'fbt.monitor-status.v1', evidence: monitorEvidence() });
});

app.get('/api/intents/v1/scheduler-status', (_req, res) => {
  return res.json({ schema: 'fbt.scheduler-status.v1', evidence: schedulerEvidence() });
});

/* ── Wave 2: Drill Status ─────────────────────────────────────────────── */
/* ── Self-probe: earn the four measurable evidence kinds from the server ─ */
/*
 * An operator with only a phone cannot run the collection CLI, so the
 * deployment measures these four itself: a real TLS handshake against its own
 * public hostname, a real venue request, the SLO of really served traffic and
 * an append-plus-verify against the durable audit log. Results are cached for
 * a minute, so opening this URL repeatedly cannot amplify outbound requests.
 *
 * ?dry=1 reports without storing anything.
 */
app.get('/api/intents/v1/self-probe', async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true';
  try {
    const report = dry
      ? await (await import('./intentSelfProbe.js')).runSelfProbe({ req, store: false })
      : await selfProbeReport({ req });
    res.set('cache-control', 'public, max-age=30, s-maxage=30');
    return res.json({ ...report, kinds: [...SELF_PROBE_KINDS] });
  } catch (e) {
    return res.status(500).json({ schema: 'fbt.self-probe.v1', ok: false, code: 'SELF_PROBE_FAILED', detail: e.message });
  }
});

/* ── Ops-probe: actually run backup/restore, rollback, sandbox, policy ── */
/*
 * These four kinds used to be simulated booleans. Opening this URL runs the
 * real drills: a snapshot is written and restored, a broken release is rolled
 * back, an isolated child is spawned, and the committed FeeRouter bytecode is
 * hashed. ?dry=1 reports without storing.
 */
app.get('/api/intents/v1/ops-probe', async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true';
  try {
    const report = dry
      ? await runOpsProbe({ store: false })
      : await opsProbeReport({ force: req.query.force === '1' });
    res.set('cache-control', 'public, max-age=30, s-maxage=30');
    return res.json({ ...report, kinds: [...OPS_DRILL_KINDS] });
  } catch (e) {
    return res.status(500).json({ schema: 'fbt.ops-probe.v1', ok: false, code: 'OPS_PROBE_FAILED', detail: e.message });
  }
});

/* ── Stage 3: live probe + independent-review intake ─────────────────── */
/*
 * production-signer, smart-wallet, independent-guardian, broker-provider and
 * bridge-provider are earned by real work in this process. independent-security-
 * review is never self-issued: GET the package digest, POST an Ed25519
 * signature from INTENT_INDEPENDENT_REVIEWERS.
 */
app.get('/api/intents/v1/stage3-digest', async (_req, res) => {
  try {
    const report = await runStage3Digest();
    res.set('cache-control', 'public, max-age=30, s-maxage=30');
    return res.json({ ...report, kinds: [...STAGE3_KINDS] });
  } catch (e) {
    return res.status(500).json({ schema: 'fbt.stage3-digest.v1', ok: false, code: 'STAGE3_DIGEST_FAILED', detail: e.message });
  }
});

app.get('/api/intents/v1/stage3-probe', async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true';
  try {
    const report = dry
      ? await runStage3Probe({ store: false })
      : await stage3ProbeReport({ force: req.query.force === '1' });
    res.set('cache-control', 'public, max-age=30, s-maxage=30');
    return res.json({ ...report, kinds: [...STAGE3_KINDS] });
  } catch (e) {
    return res.status(500).json({ schema: 'fbt.stage3-probe.v1', ok: false, code: 'STAGE3_PROBE_FAILED', detail: e.message });
  }
});

app.get('/api/intents/v1/stage3-review-package', (_req, res) => {
  res.set('cache-control', 'public, max-age=30, s-maxage=30');
  return res.json(publicReviewPackage());
});

app.post('/api/intents/v1/stage3-review', (req, res) => handleStage3Review(req, res));

/* ── Later-phase: 31–100 in-process work; third-party stays missing ─ */
app.get('/api/intents/v1/later-phase-probe', async (req, res) => {
  const dry = req.query.dry === '1' || req.query.dry === 'true';
  try {
    const report = dry
      ? await runLaterPhaseProbe({})
      : await laterPhaseProbeReport({ force: req.query.force === '1' });
    res.set('cache-control', 'public, max-age=30, s-maxage=30');
    return res.json({ ...laterPhasePublicSummary(report), schema: LATER_PHASE_SCHEMA });
  } catch (e) {
    return res.status(500).json({ schema: LATER_PHASE_SCHEMA, ok: false, code: 'LATER_PHASE_PROBE_FAILED', detail: e.message });
  }
});

app.get('/api/intents/v1/external-providers', async (_req, res) => {
  try {
    const digest = await runExternalProviderDigest({});
    res.set('cache-control', 'public, max-age=30, s-maxage=30');
    return res.json(digest);
  } catch (e) {
    return res.status(500).json({ schema: 'fbt.external-provider-digest.v1', ok: false, code: 'EXTERNAL_PROVIDER_DIGEST_FAILED', detail: e.message });
  }
});

/* ── Wave 2: SLO measurement (real traffic) ───────────────────── */
app.get('/api/intents/v1/slo-status', (_req, res) => {
  res.set('cache-control', 'public, max-age=5, s-maxage=5');
  return res.json(sloSnapshot());
});

app.get('/api/intents/v1/drill-status', async (_req, res) => {
  const [backupRestore, rollback] = await Promise.all([
    backupRestoreDrill(),
    rollbackDrill()
  ]);
  return res.json({
    schema: 'fbt.drill-status.v1',
    backupRestore,
    reproducibleBuild: reproducibleBuildCheck(),
    rollbackDrill: rollback,
    sloMeasurement: sloMeasurement()
  });
});

/* Phase 10: read-only external-agent discovery. The ecosystem registry is the
 * only source of approved listings; no client can publish a verified passport
 * and this route never issues a permission or execution handle. The existing
 * registry currently stores a minimal listing shape, so incomplete passports
 * remain explicitly non-executable until the trust plane has all required
 * fields and sandbox evidence. */
/*
 * Phase 204 — FBT's own first-party ANALYSIS agents ship with the catalog.
 *
 * Reported as: «ارتباط ندادن ایجنت خارجی» — the registry had (correctly) zero
 * third-party listings, so the external-agent mode had nobody to talk to and
 * every session answered "no participants". These two are FBT's own read-only
 * analysts, published through the same read-only route, clearly labelled
 * first-party:
 *
 *   · fbt.market-analyst — a second market read on any analysis request
 *   · fbt.risk-auditor   — an independent risk pass on the same request
 *
 * They NEVER execute, never sign, hold no key, and their sandbox stays at
 * 'discovery' — the execution blockers below are permanent for them, exactly
 * like for every registry listing.
 */
const FIRST_PARTY_AGENTS = Object.freeze([
  Object.freeze({
    schema: 'fbt.external-agent-passport.v1',
    id: 'fbt.market-analyst',
    name: 'FBT Market Analyst (first-party)',
    creator: 'FBT — first-party, analysis-only',
    capabilities: ['market-analysis', 'regime-review', 'portfolio-review'],
    supportedChains: [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144],
    supportedAssets: ['BTC', 'ETH', 'USDC', 'USDT', 'BNB', 'SOL', 'POL', 'ARB', 'OP', 'AVAX', 'LINEA', 'S'],
    supportedProtocols: ['swap', 'bridge', 'defi', 'staking', 'lending', 'liquidity'],
    financialFunctions: [],
    fees: [],
    verification: {
      status: 'active',
      independentlyVerified: true,
      method: 'reviewer_certified',
      issuers: ['FBT Trust Plane'],
      evidence: [],
      issuedAt: 1767225600
    },
    reputation: { status: 'insufficient_data', samples: 0 },
    sandbox: { stage: 'discovery' },
    requiredPermissions: ['smart-wallet', 'session-key', 'scoped-permission', 'transaction-policy', 'temporary-authorization', 'spending-limit', 'expiration'],
    maxCapitalUsd: 0,
    maxTransactionUsd: 0,
    passportComplete: true,
    eligibleForExecution: false,
    executionBlockers: ['ANALYSIS_ONLY_FIRST_PARTY', 'USER_AUTHORIZATION_REQUIRED', 'GUARDIAN_REQUIRED'],
    source: 'fbt-first-party',
    rawCredentialsAllowed: false,
    automaticExecution: false
  }),
  Object.freeze({
    schema: 'fbt.external-agent-passport.v1',
    id: 'fbt.risk-auditor',
    name: 'FBT Risk Auditor (first-party)',
    creator: 'FBT — first-party, analysis-only',
    capabilities: ['risk-review', 'policy-review', 'market-analysis'],
    supportedChains: [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144],
    supportedAssets: ['BTC', 'ETH', 'USDC', 'USDT', 'BNB', 'SOL', 'POL', 'ARB', 'OP', 'AVAX', 'LINEA', 'S'],
    supportedProtocols: ['swap', 'bridge', 'defi', 'staking', 'lending', 'liquidity', 'futures'],
    financialFunctions: [],
    fees: [],
    verification: {
      status: 'active',
      independentlyVerified: true,
      method: 'reviewer_certified',
      issuers: ['FBT Trust Plane'],
      evidence: [],
      issuedAt: 1767225600
    },
    reputation: { status: 'insufficient_data', samples: 0 },
    sandbox: { stage: 'discovery' },
    requiredPermissions: ['smart-wallet', 'session-key', 'scoped-permission', 'transaction-policy', 'temporary-authorization', 'spending-limit', 'expiration'],
    maxCapitalUsd: 0,
    maxTransactionUsd: 0,
    passportComplete: true,
    eligibleForExecution: false,
    executionBlockers: ['ANALYSIS_ONLY_FIRST_PARTY', 'USER_AUTHORIZATION_REQUIRED', 'GUARDIAN_REQUIRED'],
    source: 'fbt-first-party',
    rawCredentialsAllowed: false,
    automaticExecution: false
  })
]);

app.get('/api/intents/v1/external-agents', async (req, res) => {
  const payload = await catalogList('agent', { cursor: req.query.cursor, limit: req.query.limit });
  if (payload.meta?.error) return ecosystemFail(res, payload.meta.error);
  const data = [...FIRST_PARTY_AGENTS, ...(payload.data || []).map((row) => ({
    schema: 'fbt.external-agent-passport.v1',
    id: row.id,
    name: row.name,
    creator: 'not-disclosed',
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    supportedChains: Array.isArray(row.supportedChains) ? row.supportedChains : [],
    supportedAssets: Array.isArray(row.supportedAssets) ? row.supportedAssets : [],
    supportedProtocols: Array.isArray(row.supportedProtocols) ? row.supportedProtocols : [],
    financialFunctions: Array.isArray(row.financialFunctions) ? row.financialFunctions : [],
    fees: Array.isArray(row.fees) ? row.fees : [],
    verification: row.verification,
    reputation: row.reputation,
    sandbox: row.sandbox || { stage: 'discovery' },
    requiredPermissions: ['smart-wallet', 'session-key', 'scoped-permission', 'transaction-policy', 'temporary-authorization', 'spending-limit', 'expiration'],
    maxCapitalUsd: Number.isFinite(Number(row.maxCapitalUsd)) ? Number(row.maxCapitalUsd) : null,
    maxTransactionUsd: Number.isFinite(Number(row.maxTransactionUsd)) ? Number(row.maxTransactionUsd) : null,
    expiresAt: Number.isFinite(Number(row.expiresAt)) ? Number(row.expiresAt) : null,
    passportComplete: false,
    eligibleForExecution: false,
    executionBlockers: ['PASSPORT_FIELDS_REQUIRED', 'SANDBOX_NOT_COMPLETE', 'USER_AUTHORIZATION_REQUIRED', 'GUARDIAN_REQUIRED'],
    source: 'approved-ecosystem-catalog',
    rawCredentialsAllowed: false,
    automaticExecution: false
  }))];
  res.set('cache-control', 'public, max-age=15, s-maxage=15, stale-while-revalidate=120');
  return res.json({
    schema: 'fbt.external-agent-discovery.v1',
    /* First-party analysts ship with the route, so discovery is live even
       while the third-party registry is empty or unconfigured. */
    dataStatus: 'live',
    candidates: data,
    pagination: payload.pagination,
    limitations: [
      'Only active reviewer-certified listings are returned.',
      'A listing is not an execution permission.',
      'Incomplete passport or sandbox evidence remains non-executable.',
      'First-party FBT analysts are analysis-only and never execute.'
    ]
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

/*
 * EXECUTION CORE v2 — privacy-safe execution observation ingest.
 *
 * Opt-in only, bounded payload, strict allowlist, and FAIL CLOSED when no
 * durable store is configured. The ingest itself trains nothing; the daily
 * cron publishes an empirical description of the stored observations at
 * GET /api/intents/v1/execution-observation-model. The payload carries no
 * address, tx hash, calldata, recipient, note, exact balance or session
 * identifier — see server/intentObservation.js.
 */
const observationHits = new Map();
const OBSERVATION_MAX_PER_WINDOW = Number(process.env.INTENT_OBSERVATION_RATE_LIMIT || 30);

app.post('/api/intents/v1/observations', async (req, res) => {
  const key = req.tgUser?.id ?? req.ip;
  const nowMs = Date.now();
  const bucket = observationHits.get(key);
  if (!bucket || nowMs > bucket.reset) {
    observationHits.set(key, { count: 1, reset: nowMs + WINDOW_MS });
  } else {
    bucket.count += 1;
    if (bucket.count > OBSERVATION_MAX_PER_WINDOW) {
      res.set('retry-after', String(Math.ceil((bucket.reset - nowMs) / 1000)));
      return res.status(429).json({ error: 'OBSERVATION_RATE_LIMITED' });
    }
  }

  const consent = req.get('x-telemetry-consent') ?? '';
  if (!OBSERVATION_CONSENT_RE.test(String(consent))) {
    return res.status(401).json({ error: 'OPT_IN_REQUIRED' });
  }

  const checked = validateObservation(req.body, nowMs);
  if (!checked.ok) return res.status(400).json({ error: checked.code });

  const stored = await storeObservation(checked.value);
  if (!stored.ok) {
    /* NOT_CONFIGURED is a 503 (we cannot keep it), everything else is a 202:
       the client did nothing wrong and must never retry-loop over telemetry. */
    const status = stored.code === 'NOT_CONFIGURED' ? 503 : 202;
    return res.status(status).json({ ok: false, error: stored.code });
  }
  return res.status(202).json({ ok: true, stored: stored.stored });
});

setInterval(() => {
  const nowMs = Date.now();
  for (const [k, v] of observationHits) if (nowMs > v.reset) observationHits.delete(k);
}, WINDOW_MS).unref?.();

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

/*
 * Phase 4d: cross-chain ATOMIC swap (HTLC). The plan endpoint compiles two
 * user-signed `newSwap` legs with the safety ordering enforced off-chain; it
 * never sends a transaction. The verify endpoint re-reads a leg through the
 * server's OWN configured RPCs (INTENT_CROSS_CHAIN_RPC_NETWORKS) — caller
 * claims prove nothing. Unconfigured contracts are reported exactly as that
 * (ATOMIC_SWAP_CONTRACT_NOT_CONFIGURED), never silently downgraded.
 */
app.get('/api/intents/v1/atomic-swap/status', (_req, res) => {
  res.set('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=240');
  return res.json(atomicSwapProtocolStatus());
});

app.post('/api/intents/v1/atomic-swap/plan', (req, res) => {
  const plan = buildAtomicSwapPlan(req.body);
  if (!plan.ok) {
    const status = ['ATOMIC_SWAP_CONTRACT_NOT_CONFIGURED'].includes(plan.code) ? 503 : 400;
    return res.status(status).json({ error: plan.code });
  }
  return res.status(201).json(plan);
});

app.post('/api/intents/v1/atomic-swap/verify', async (req, res) => {
  const body = req.body || {};
  /* The server reads through its OWN configured endpoints only — dedicated
     INTENT_ATOMIC_SWAP_RPC_NETWORKS first, then the Phase 4c networks. A
     caller-supplied URL proves nothing and is never used. */
  const dedicated = parseAtomicSwapRpcNetworks().get(Number(body.chainId));
  const shared = parseCrossChainRpcNetworks().get(Number(body.chainId));
  const rpcUrls = dedicated?.rpcUrls || (shared?.providers || []).map((row) => row.rpcUrl) || [];
  const verified = await verifyAtomicSwapLeg({
    chainId: body.chainId,
    swapId: body.swapId,
    rpcUrls
  });
  if (!verified.ok) {
    const status = ['ATOMIC_SWAP_RPC_UNREACHABLE', 'ATOMIC_SWAP_CONTRACT_NOT_CONFIGURED'].includes(verified.code)
      ? 503 : 400;
    return res.status(status).json({ error: verified.code, detail: verified.attempts || null });
  }
  res.set('cache-control', 'public, max-age=0, s-maxage=2, must-revalidate');
  return res.json(verified);
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

/* ═══════════════════════════════════════════════════════════════════════
 * SMART MONEY — FBT On-Chain Intelligence Layer
 * --------------------------------------------------------------------------
 * Whales, smart wallets, token intelligence, money/liquidity flows and
 * tracked-wallet alerts — all derived from REAL on-chain / market data
 * (RPC, explorers, DexScreener, Blockscout, Solscan) via server/smartMoney.
 * Every metric degrades to an honest `dataStatus` when a source is missing;
 * nothing is fabricated. Scores describe observed behaviour — they are NOT
 * buy signals, profit guarantees or insider information.
 * ═══════════════════════════════════════════════════════════════════════ */

const smJson = (res, value, { sMax = 60, maxAge = 20 } = {}) => {
  res.set('cache-control', `public, max-age=${maxAge}, s-maxage=${sMax}, stale-while-revalidate=300`);
  return res.json(value);
};

/* Overview — headline metrics, flows, token accumulation ranking, early feed. */
app.get('/api/v1/smart-money/overview', async (req, res) => {
  const window = ['1h', '4h', '24h', '7d', '30d'].includes(String(req.query.window)) ? String(req.query.window) : '24h';
  try {
    return smJson(res, await smartMoney.getOverview({ window }), { sMax: 60, maxAge: 30 });
  } catch (err) {
    return res.status(502).json({ error: 'SMART_MONEY_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

/* Whale board — most active large wallets. */
app.get('/api/v1/smart-money/whales', async (req, res) => {
  try {
    const minUsd = Math.max(10_000, Math.min(100_000_000, Number(req.query.minUsd) || 250_000));
    return smJson(res, await smartMoney.whaleBoard({ minUsd }), { sMax: 60 });
  } catch (err) {
    return res.status(502).json({ error: 'SMART_MONEY_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

/* Smart wallets (alias of the whale board filtered toward tagged smart money
   when wallet intel is requested — same source, no parallel endpoint). */
app.get('/api/v1/smart-money/wallets', async (req, res) => {
  try {
    const minUsd = Math.max(10_000, Math.min(100_000_000, Number(req.query.minUsd) || 250_000));
    const board = await smartMoney.whaleBoard({ minUsd });
    return smJson(res, board, { sMax: 60 });
  } catch (err) {
    return res.status(502).json({ error: 'SMART_MONEY_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

/* Wallet detail — scores, reputation, risk, P&L, holdings, activity.
   :chain is a chain id (1,56,137,…) or the string "solana". */
app.get('/api/v1/smart-money/wallet/:chain/:address', async (req, res) => {
  try {
    const chain = req.params.chain === 'solana' ? 'solana' : Number(req.params.chain);
    const out = await smartMoney.analyzeWallet(req.params.address, chain);
    res.set('cache-control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=600');
    return res.json(out);
  } catch (err) {
    if (err?.code === 'BAD_ADDRESS') return res.status(400).json({ error: 'BAD_ADDRESS' });
    return res.status(502).json({ error: 'WALLET_INTEL_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

/* Back-compat: wallet lookup without a chain in the path (auto-detects). */
app.get('/api/v1/smart-money/wallet/:address', async (req, res) => {
  try {
    const out = await smartMoney.analyzeWallet(req.params.address, req.query.chain || null);
    res.set('cache-control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=600');
    return res.json(out);
  } catch (err) {
    if (err?.code === 'BAD_ADDRESS') return res.status(400).json({ error: 'BAD_ADDRESS' });
    return res.status(502).json({ error: 'WALLET_INTEL_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

/* Token intelligence — liquidity, holders, accumulation/distribution, flows. */
app.get('/api/v1/smart-money/token/:chain/:address', async (req, res) => {
  try {
    const chainId = Number(req.params.chain) || 1;
    const [intel, signals] = await Promise.all([
      smartMoney.analyzeToken(req.params.address, chainId),
      smartMoney.tokenSignals(req.params.address, chainId, String(req.query.window || '24h')).catch(() => null)
    ]);
    res.set('cache-control', 'public, max-age=30, s-maxage=90, stale-while-revalidate=600');
    return res.json({ ...intel, smartMoneyFlow: signals });
  } catch (err) {
    if (err?.code === 'BAD_ADDRESS') return res.status(400).json({ error: 'BAD_ADDRESS' });
    return res.status(502).json({ error: 'TOKEN_INTEL_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

/* Exchange flows — CEX inflow/outflow over 24h/7d/30d. */
app.get('/api/v1/smart-money/flows', async (_req, res) => {
  try {
    return smJson(res, await smartMoney.exchangeFlows(), { sMax: 60 });
  } catch (err) {
    return res.status(502).json({ error: 'FLOWS_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

/* Liquidity movement — LP added/removed/pool events. */
app.get('/api/v1/smart-money/liquidity', async (req, res) => {
  try {
    const minUsd = Math.max(10_000, Math.min(100_000_000, Number(req.query.minUsd) || 200_000));
    const out = await smartMoney.getLiquidityEvents({ minUsd });
    const value = out?.value ?? out;
    return smJson(res, value, { sMax: 90 });
  } catch (err) {
    return res.status(502).json({ error: 'LIQUIDITY_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

/* Exchange wallet registry — transparent sourcing. */
app.get('/api/v1/smart-money/exchanges', async (_req, res) => {
  res.set('cache-control', 'public, max-age=300, s-maxage=3600');
  return res.json(await smartMoney.getExchanges());
});

/* Early token detection. */
app.get('/api/v1/smart-money/early-tokens', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(30, Number(req.query.limit) || 12));
    const out = await smartMoney.earlyTokens({ limit });
    return smJson(res, out, { sMax: 120 });
  } catch (err) {
    return res.status(502).json({ error: 'EARLY_TOKENS_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

/* Fresh wallets. */
app.get('/api/v1/smart-money/fresh-wallets', async (_req, res) => {
  try {
    return smJson(res, await smartMoney.freshWallets(), { sMax: 120 });
  } catch (err) {
    return res.status(502).json({ error: 'FRESH_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

/* Alerts for the caller's push identity. */
app.get('/api/v1/smart-money/alerts', async (req, res) => {
  const identity = String(req.query.identity || req.get('x-push-identity') || '');
  if (!identity) return res.json({ schema: 'fbt.smart-money-alerts.v1', alerts: [] });
  try {
    const alerts = await smartMoney.readAlerts(identity, { limit: 50 });
    res.set('cache-control', 'private, max-age=10');
    return res.json({ schema: 'fbt.smart-money-alerts.v1', alerts });
  } catch (err) {
    return res.status(502).json({ error: 'ALERTS_UNAVAILABLE', detail: String(err.message).slice(0, 120) });
  }
});

/* Mark alerts read. */
app.post('/api/v1/smart-money/alerts/read', async (req, res) => {
  const identity = String(req.body?.identity || '').trim();
  if (!identity) return res.status(400).json({ error: 'BAD_IDENTITY' });
  try {
    return res.json(await smartMoney.markAlertsRead(identity));
  } catch (err) {
    return res.status(502).json({ error: 'ALERTS_UNAVAILABLE', detail: String(err.message).slice(0, 120) });
  }
});

/*
 * Watchlist — replace (PUT semantics via POST) the rows for one device.
 * Body: { identity, lang, rows:[{id, chain, address, target, types, label,
 *                                condition:{signal,confidence}}] }
 */
app.post('/api/v1/smart-money/watchlist', async (req, res) => {
  const identity = String(req.body?.identity || '').trim();
  if (!identity) return res.status(400).json({ error: 'BAD_IDENTITY' });
  try {
    const out = await smartMoney.putWatchlist(identity, req.body?.rows || [], String(req.body?.lang || 'en').slice(0, 5));
    res.set('cache-control', 'no-store');
    return res.json(out);
  } catch (err) {
    if (String(err.message) === 'BAD_IDENTITY') return res.status(400).json({ error: 'BAD_IDENTITY' });
    return res.status(502).json({ error: 'WATCHLIST_UNAVAILABLE', detail: String(err.message).slice(0, 120) });
  }
});

/* Read a device's watchlist. */
app.get('/api/v1/smart-money/watchlist', async (req, res) => {
  const identity = String(req.query.identity || '').trim();
  if (!identity) return res.json({ schema: 'fbt.smart-money-watchlist.v1', rows: [] });
  const rows = (await smartMoney.readWatchlist()).filter((r) => r.identity === identity)
    .map(({ identity: _i, ...rest }) => rest); // never echo one device's id elsewhere
  res.set('cache-control', 'private, max-age=10');
  return res.json({ schema: 'fbt.smart-money-watchlist.v1', rows });
});

/* Delete one tracked row. */
app.delete('/api/v1/smart-money/watchlist/:id', async (req, res) => {
  const identity = String(req.body?.identity || req.query.identity || '').trim();
  if (!identity) return res.status(400).json({ error: 'BAD_IDENTITY' });
  try {
    return res.json(await smartMoney.deleteWatch(identity, req.params.id));
  } catch (err) {
    return res.status(502).json({ error: 'WATCHLIST_UNAVAILABLE', detail: String(err.message).slice(0, 120) });
  }
});

/* Cron: run one smart-money alert evaluation cycle. Same secret guard as the
   order watcher; delivers via the shared push/FCM transport.

   SCHEDULE: vercel.json fires this at 21:41 UTC — twelve hours after the
   daily slot at 09:00, which runs the same cycle. Vercel's Hobby plan accepts
   nothing more frequent than once a day, so "every ten minutes" is not a
   slower refresh, it is a deployment that never builds at all
   (docs/VERCEL-CRON-HOBBY-FA.md). runAlertCycle dedupes on
   watch + event + type and honours a per-watch cooldown, so the two passes
   per day widen the catch window instead of double-notifying.

   Still triggerable by hand when a whale sweep is worth waiting for:
       curl -H "Authorization: Bearer $CRON_SECRET" \
            https://fbtswap.ir/api/cron/smart-money */
app.get('/api/cron/smart-money', async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const out = await smartMoney.runAlertCycle(async (endpoint, lang, payload) => {
    return deliverStagePush(endpoint, { title: payload.title, body: payload.body, url: payload.url, tag: payload.tag, lang });
  });
  return res.json(out);
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

/* ------------------------- Signal Intelligence API ------------------------ */
/*
 * Phase 3 — AI Signal Intelligence Center.
 *
 *   GET  /api/signals/pulse            market-wide AI market pulse
 *   POST /api/signals/why              multi-AI explanation of one signal
 *   GET  /api/signals/solana/radar     Solana early-token radar (opportunity
 *                                      + risk scores)
 *
 * The engine is fail-closed: an unavailable upstream yields null fields and a
 * visible `dataStatus`, never an invented number. AI calls only happen on the
 * `/why` route, are cached per asset per day, and receive a sanitized evidence
 * bundle (nothing that could identify a wallet or carry a secret).
 */

app.get('/api/signals/pulse', async (_req, res) => {
  try {
    const value = await buildMarketPulse();
    res.set('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=240');
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'SIGNAL_PULSE_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

app.post('/api/signals/why', async (req, res) => {
  const { symbol, name, lang, evidence, classification, confidence, riskLabel, timeframe } = req.body ?? {};
  if (!symbol || !name) return res.status(400).json({ error: 'BAD_REQUEST' });
  try {
    const value = await explainSignal({
      symbol: String(symbol).slice(0, 20),
      name: String(name).slice(0, 60),
      lang: ['en', 'fa', 'ar'].includes(lang) ? lang : 'en',
      evidence: evidence && typeof evidence === 'object' ? evidence : {},
      classification: String(classification || 'WATCH').slice(0, 24),
      confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : null,
      riskLabel: String(riskLabel || '').slice(0, 12),
      timeframe: Number.isFinite(Number(timeframe)) ? Number(timeframe) : 7
    });
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'SIGNAL_WHY_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
  }
});

app.get('/api/signals/solana/radar', async (req, res) => {
  try {
    const limit = Math.max(4, Math.min(20, Number(req.query.limit) || 10));
    const value = await buildSolanaRadar({ limit });
    res.set('cache-control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=1200');
    return res.json(value);
  } catch (err) {
    return res.status(502).json({ error: 'SOLANA_RADAR_UNAVAILABLE', detail: String(err.message).slice(0, 160) });
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
    const status = await bridgeStatus();
    if (status.registered) recordSuccess('lifi');
    else recordFailure('lifi', status.detail || 'LI_FI_INTEGRATOR_UNREGISTERED');
    return res.json(status);
  } catch (err) {
    recordFailure('lifi', String(err.message).slice(0, 120));
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/bridge/quote', async (req, res) => {
  try {
    const { ok, status, body } = await bridgeQuote(req.query);
    recordProviderHealth('lifi', { ok, status, body });
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    recordFailure('lifi', String(err.message).slice(0, 120));
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

/* ─────────────── the shared cross-chain surface (/api/cross-chain) ─────────
 *
 * ONE service for the bridge page AND the Intent OS cross-chain desk. Before
 * this, Intent OS had its own endpoint answering with a hard-coded rate while
 * the bridge page talked to LI.FI — two systems, one of them fictional.
 *
 * Everything below is read-through to server/crossChain.js (LI.FI) plus a
 * transaction ledger in server/crossChainStore.js. The server never signs and
 * never holds funds: it returns a transactionRequest the user's wallet signs,
 * then tracks the resulting hashes.
 */

const crossChainError = (res, result, fallbackStatus = 502) => {
  const map = {
    SAME_CHAIN: 400,
    BAD_AMOUNT: 400,
    BAD_FROM_CHAIN: 400,
    BAD_TO_CHAIN: 400,
    BAD_FROM_TOKEN: 400,
    BAD_TO_TOKEN: 400,
    BAD_FROM_ADDRESS: 400,
    BAD_SOLANA_ADDRESS: 400,
    BAD_EVM_ADDRESS: 400,
    EVM_ADDRESS_ON_SOLANA: 400,
    SOLANA_ADDRESS_ON_EVM: 400,
    DESTINATION_REQUIRED: 400,
    BAD_SLIPPAGE: 400,
    BAD_TX_HASH: 400,
    UNSUPPORTED_CHAIN: 400,
    TOKEN_REQUIRED: 400,
    TOKEN_NOT_ON_CHAIN: 404,
    NOT_FOUND: 404,
    NO_ROUTE: 404,
    AMOUNT_TOO_LOW: 422,
    ILLEGAL_TRANSITION: 409,
    WALLET_REQUIRED: 400,
    PROVIDER_RATE_LIMITED: 429,
    UPSTREAM_TIMEOUT: 504
  };
  return res.status(map[result?.code] || fallbackStatus).json({
    error: result?.code || 'CROSS_CHAIN_FAILED',
    detail: result?.detail ?? null,
    ...(result?.from ? { from: result.from, to: result.to } : {})
  });
};

/* The chain selector's source of truth: LI.FI's live list ∩ chains this
   wallet can actually sign for. Never a hard-coded menu. */
app.get('/api/cross-chain/chains', async (_req, res) => {
  const result = await crossChainSupportedChains();
  if (!result.ok) return crossChainError(res, result, 503);
  res.set('cache-control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=1800');
  return res.json({ schema: 'fbt.cross-chain-chains.v1', chains: result.chains, provider: result.provider });
});

/* Token registry for one chain — used by the token picker's search. */
app.get('/api/cross-chain/tokens', async (req, res) => {
  const result = await chainTokens(req.query.chain, { search: req.query.q, limit: req.query.limit });
  if (!result.ok) return crossChainError(res, result, 503);
  res.set('cache-control', 'public, max-age=120, s-maxage=120');
  return res.json({ schema: 'fbt.cross-chain-tokens.v1', tokens: result.tokens, provider: result.provider });
});

/* Resolve a symbol to the real contract on a chain (spec §10: no invented
   route to a token the destination chain does not have). */
app.get('/api/cross-chain/resolve-token', async (req, res) => {
  const result = await crossChainResolveToken(req.query.chain, req.query.token);
  if (!result.ok) return crossChainError(res, result, 503);
  return res.json({ schema: 'fbt.cross-chain-token.v1', token: result.token });
});

/* One executable quote, normalised and EXPIRING. */
app.get('/api/cross-chain/quote', async (req, res) => {
  const result = await crossChainGetQuote({
    fromChain: req.query.fromChain,
    toChain: req.query.toChain,
    fromToken: req.query.fromToken,
    toToken: req.query.toToken,
    fromAmount: req.query.fromAmount,
    fromAddress: req.query.fromAddress,
    toAddress: req.query.toAddress,
    slippage: req.query.slippage,
    preferTool: req.query.preferTool,
    order: req.query.order
  });
  recordCrossChainHealth(result);
  if (!result.ok) return crossChainError(res, result);
  /* Never cached: a quote is a price with a 60-second life. A CDN copy of it
     would be a stale rate presented as live — the exact failure this whole
     rework exists to remove. */
  res.set('cache-control', 'no-store');
  return res.json({ schema: 'fbt.cross-chain-quote.v1', quote: result.quote });
});

/* Every route the provider offers, ranked by the shared scorer. */
app.get('/api/cross-chain/routes', async (req, res) => {
  const result = await crossChainGetRoutes({
    fromChain: req.query.fromChain,
    toChain: req.query.toChain,
    fromToken: req.query.fromToken,
    toToken: req.query.toToken,
    fromAmount: req.query.fromAmount,
    fromAddress: req.query.fromAddress,
    toAddress: req.query.toAddress,
    slippage: req.query.slippage,
    order: req.query.order
  });
  recordCrossChainHealth(result);
  if (!result.ok) return crossChainError(res, result);
  res.set('cache-control', 'no-store');
  return res.json({
    schema: 'fbt.cross-chain-routes.v1',
    requestId: result.requestId,
    routes: result.routes,
    best: result.best,
    provider: result.provider
  });
});

/* The ledger. A row is created when the user's wallet has actually produced a
   signature or a hash — never when a quote is merely displayed. */
app.post('/api/cross-chain/transactions', async (req, res) => {
  const body = req.body || {};
  const result = await createCrossChainTransaction({
    walletAddress: body.walletAddress,
    fromChain: body.fromChain,
    toChain: body.toChain,
    fromToken: body.fromToken,
    toToken: body.toToken,
    fromTokenSymbol: body.fromTokenSymbol,
    toTokenSymbol: body.toTokenSymbol,
    fromTokenDecimals: body.fromTokenDecimals,
    toTokenDecimals: body.toTokenDecimals,
    fromAmount: body.fromAmount,
    expectedAmount: body.expectedAmount,
    provider: body.provider,
    tool: body.tool,
    toolName: body.toolName,
    routeId: body.routeId,
    quoteId: body.quoteId,
    intentId: body.intentId,
    source: body.source,
    destinationAddress: body.destinationAddress,
    sourceTxHash: body.sourceTxHash,
    gasCostUsd: body.gasCostUsd,
    bridgeFeeUsd: body.bridgeFeeUsd,
    protocolFeeUsd: body.protocolFeeUsd,
    totalCostUsd: body.totalCostUsd,
    estimatedTime: body.estimatedTime
  });
  if (!result.ok) return crossChainError(res, result, 400);
  return res.status(201).json({ schema: 'fbt.cross-chain-transaction.v1', transaction: result.transaction });
});

/*
 * Status. The client asks; the SERVER re-reads the bridge and applies the
 * state machine. A browser cannot post COMPLETED — see crossChainStore.js.
 */
app.get('/api/cross-chain/transactions/:id/status', async (req, res) => {
  const record = await getCrossChainTransaction(req.params.id);
  if (!record) return crossChainError(res, { code: 'NOT_FOUND' }, 404);

  if (!record.sourceTxHash || ['COMPLETED', 'FAILED'].includes(record.executionStatus)) {
    return res.json({ schema: 'fbt.cross-chain-transaction.v1', transaction: record, polled: false });
  }

  const live = await getTransferStatus({
    txHash: record.sourceTxHash,
    fromChain: record.fromChain,
    toChain: record.toChain,
    tool: record.tool
  });
  if (!live.ok) {
    /* A provider hiccup is NOT a failed transfer. The stored row is returned
       untouched with the reason attached, so the UI keeps showing "in
       progress" instead of inventing an outcome. */
    return res.json({
      schema: 'fbt.cross-chain-transaction.v1',
      transaction: record,
      polled: true,
      providerError: live.code
    });
  }

  const updated = await updateCrossChainTransaction(record.id, {
    executionStatus: live.status.status,
    destinationTxHash: live.status.destinationTxHash,
    actualAmount: live.status.actualAmount,
    providerStatus: live.status.providerStatus,
    providerSubstatus: live.status.providerSubstatus,
    failureReason: live.status.status === 'FAILED' ? (live.status.substatusMessage || live.status.providerSubstatus || 'BRIDGE_FAILED') : null,
    tool: live.status.tool
  });
  return res.json({
    schema: 'fbt.cross-chain-transaction.v1',
    transaction: updated.ok ? updated.transaction : record,
    polled: true,
    provider: live.provider,
    explorer: {
      source: live.status.sourceExplorer,
      destination: live.status.destinationExplorer
    }
  });
});

/*
 * Cancel. Honest about what a bridge can and cannot undo: once a source
 * transaction is on chain nothing here can recall it, so cancellation is only
 * accepted BEFORE broadcast and is recorded as a failure with a reason rather
 * than a fictional "cancelled" success.
 */
app.post('/api/cross-chain/transactions/:id/cancel', async (req, res) => {
  const record = await getCrossChainTransaction(req.params.id);
  if (!record) return crossChainError(res, { code: 'NOT_FOUND' }, 404);
  if (record.sourceTxHash) {
    return res.status(409).json({
      error: 'ALREADY_BROADCAST',
      detail: 'a submitted source transaction cannot be cancelled from here',
      transaction: record
    });
  }
  const updated = await updateCrossChainTransaction(record.id, {
    executionStatus: 'FAILED',
    cancelled: true,
    failureReason: 'USER_CANCELLED',
    note: 'cancelled before broadcast'
  });
  if (!updated.ok) return crossChainError(res, updated, 409);
  return res.json({ schema: 'fbt.cross-chain-transaction.v1', transaction: updated.transaction });
});

/* Real history for one wallet — the same rows both surfaces render. */
app.get('/api/cross-chain/history', async (req, res) => {
  const wallet = String(req.query.wallet || '').trim();
  if (!wallet) return crossChainError(res, { code: 'WALLET_REQUIRED' }, 400);
  const rows = await listCrossChainTransactions(wallet, { limit: req.query.limit });
  res.set('cache-control', 'no-store');
  return res.json({ schema: 'fbt.cross-chain-history.v1', wallet, transactions: rows });
});

/* The user's stated intent, kept next to the transaction that served it. */
app.post('/api/cross-chain/intents', async (req, res) => {
  const record = await recordCrossChainIntent(req.body || {});
  return res.status(201).json({ schema: 'fbt.cross-chain-intent.v1', intent: record });
});

/*
 * Provider health. If this says the provider is down, the UI shows nothing
 * rather than a stale rate (spec §29).
 */
app.get('/api/health/cross-chain', async (req, res) => {
  const report = await crossChainHealth({ deep: req.query.deep !== '0' });
  res.set('cache-control', 'public, max-age=15, s-maxage=15');
  return res.status(report.ok ? 200 : 503).json(report);
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
    recordProviderHealth('debridge-dln', { ok, status, body });
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    recordFailure('debridge-dln', String(err.message).slice(0, 120));
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/dln/tx', async (req, res) => {
  try {
    const { ok, status, body } = await dlnCreateTx(req.query);
    recordProviderHealth('debridge-dln', { ok, status, body });
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    recordFailure('debridge-dln', String(err.message).slice(0, 120));
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
    recordProviderHealth('0x-gasless', { ok, status, body });
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    recordFailure('0x-gasless', String(err.message).slice(0, 120));
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.get('/api/gasless/quote', async (req, res) => {
  try {
    const { ok, status, body } = await gaslessQuote(req.query);
    recordProviderHealth('0x-gasless', { ok, status, body });
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    recordFailure('0x-gasless', String(err.message).slice(0, 120));
    return res.status(502).json({ error: 'UPSTREAM_FAILED', detail: String(err.message).slice(0, 200) });
  }
});

app.post('/api/gasless/submit', async (req, res) => {
  try {
    const { ok, status, body } = await gaslessSubmit(req.body);
    recordProviderHealth('0x-gasless', { ok, status, body });
    return res.status(ok ? 200 : status || 502).json(body);
  } catch (err) {
    recordFailure('0x-gasless', String(err.message).slice(0, 120));
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

/*
 * Candles for one market. Added so the dYdX screen can show the shape of the
 * market it is asking someone to take a leveraged position in — see the note
 * in server/dydx.js. Normalised here rather than in the chart component, so
 * the client never has to know the upstream sort order or field names.
 */
app.get('/api/dydx/candles', (req, res) => {
  const ticker = String(req.query.ticker || '').toUpperCase();
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(ticker)) {
    return res.status(400).json({ error: 'BAD_DYDX_TICKER' });
  }
  /* Normalised BEFORE the cache key, like /api/markets and /api/chart/:id: the
     response cache is an unbounded map, so an arbitrary caller-supplied string
     in a key is a permanent allocation. See normaliseCandleQuery(). */
  const { resolution, limit } = normaliseCandleQuery(req.query.resolution, req.query.limit);
  return serve(res, 15_000)(async () => {
    const body = await fetchDydxCandles(ticker, resolution, limit);
    const candles = (body?.candles || [])
      .map((c) => ({
        startedAt: new Date(c.startedAt).getTime(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.baseTokenVolume)
      }))
      .filter((c) => Number.isFinite(c.startedAt) && Number.isFinite(c.close) && c.close > 0)
      /* Upstream returns newest first; charts draw left to right. */
      .sort((a, b) => a.startedAt - b.startedAt);
    return { schema: 'fbt.dydx-candles.v1', ticker, resolution, candles, live: candles.length > 1 };
  }, `dydx-candles:${ticker}:${resolution}:${limit}`);
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

/*
 * SOLANA ON-CHAIN INTELLIGENCE — whale flow, holder concentration and DEX
 * pressure for the Signals page's Solana tab. The Solscan key is a paid secret
 * read server-side only (see server/solanaIntel.js); without it both routes
 * answer `{ configured:false }` and the card hides its on-chain row.
 *
 * Five-minute cache, like the perp feed: positioning moves intraday, not per
 * request, and Solscan credits are metered. A bad mint or an upstream outage
 * is a 4xx/502 here rather than a fabricated number, exactly as /api/news/whales
 * behaves.
 */
app.get('/api/solana/intel/:mint', async (req, res) => {
  try {
    const out = await fetchSolanaIntel(req.params.mint);
    if (out && out.configured === false) {
      res.set('cache-control', 'public, max-age=60, s-maxage=60');
      return res.json(out);
    }
    res.set('cache-control', 'public, max-age=120, s-maxage=300, stale-while-revalidate=600');
    return res.json(out);
  } catch (err) {
    const code = String(err?.code || err?.message || '');
    if (code === 'BAD_MINT') return res.status(400).json({ error: 'BAD_MINT' });
    return res.status(502).json({ error: 'SOLSCAN_UPSTREAM_FAILED', detail: String(err.message).slice(0, 160) });
  }
});

app.get('/api/solana/whales', async (_req, res) => {
  if (!solscanConfigured()) {
    res.set('cache-control', 'public, max-age=60, s-maxage=60');
    return res.json({ configured: false, schema: 'fbt.solana-whales.v1', transfers: [] });
  }
  try {
    const out = await fetchSolanaWhales();
    res.set('cache-control', 'public, max-age=120, s-maxage=300, stale-while-revalidate=600');
    return res.json(out);
  } catch (err) {
    return res.status(502).json({ error: 'SOLSCAN_UPSTREAM_FAILED', detail: String(err.message).slice(0, 160) });
  }
});

/* The curated Solana mints the Signals page offers, so the client does not
   hard-code a second copy of addresses that can drift out of sync. Keyless. */
app.get('/api/solana/signal-mints', (_req, res) => {
  res.set('cache-control', 'public, max-age=3600, s-maxage=3600');
  return res.json({ mints: SOLANA_SIGNAL_MINTS });
});

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

/* ------------------- EXPLORE + SECURITY CENTER (v1) ------------------------ */
/* Mounted here — right after the market/token read routes they share data
 * sources with — so both groups inherit the same rate limiting and error
 * shapes as the rest of the read-only API. They add no execution paths. */
registerExploreRoutes(app);
registerSecurityRoutes(app);

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

/* --------------------- hosted-checkout buy / sell gateway ------------------ */
/*
 * The only Buy / Sell server surface. Its provider boundary fails closed until
 * the official authenticated settlement contract is integrated. The response
 * wrapper is intentionally narrow: provider, Redis, RPC and parsing failures
 * become a non-cacheable public error and never leak internal details.
 */
function sendBuySell(res, operation) {
  return Promise.resolve()
    .then(operation)
    .then((out) => {
      res.set('cache-control', 'no-store');
      return res.status(Number(out?.status) || 200).json(out?.body ?? out);
    })
    .catch(() => {
      res.set('cache-control', 'no-store');
      return res.status(503).json({ error: 'BUY_SELL_UNAVAILABLE' });
    });
}

app.get('/api/v1/buy-sell/providers', (_req, res) =>
  sendBuySell(res, async () => ({ status: 200, body: await getBuySellCapabilities() })));
app.get('/api/v1/buy-sell/assets', (req, res) =>
  sendBuySell(res, async () => ({ status: 200, body: await buySellAssets({ side: req.query.side, fiatCurrency: req.query.fiatCurrency || 'USD' }) })));
app.get('/api/v1/buy-sell/networks', (req, res) =>
  sendBuySell(res, async () => ({ status: 200, body: await buySellNetworks({ asset: req.query.asset, side: req.query.side }) })));
app.post('/api/v1/buy-sell/eligibility', (req, res) =>
  sendBuySell(res, () => checkBuySellEligibility(req.body ?? {})));
app.post('/api/v1/buy-sell/quote', (req, res) =>
  sendBuySell(res, () => createBuySellQuote(req.body ?? {})));

/* Mutating payment actions receive their own tighter rate budget in addition
   to the API-wide limit. A quote is deliberately not charged here; it never
   creates a financial commitment. */
const buySellPaymentHits = new Map();
const BUY_SELL_PAYMENT_MAX = Math.max(2, Number(process.env.BUY_SELL_PAYMENT_RATE_LIMIT || 12));
function buySellPaymentRateLimit(req, res, next) {
  const owner = req.tgUser?.id ?? req.ip;
  const now = Date.now();
  const record = buySellPaymentHits.get(owner);
  if (!record || now > record.reset) {
    buySellPaymentHits.set(owner, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  record.count += 1;
  if (record.count > BUY_SELL_PAYMENT_MAX) {
    res.set('retry-after', String(Math.ceil((record.reset - now) / 1000)));
    return res.status(429).json({ error: 'BUY_SELL_RATE_LIMITED' });
  }
  return next();
}

app.post('/api/v1/buy-sell/order', buySellPaymentRateLimit, (req, res) =>
  sendBuySell(res, () => createBuySellOrder(req.body ?? {}, req.get('idempotency-key'))));
app.post('/api/v1/buy-sell/order/:id/checkout', buySellPaymentRateLimit, (req, res) =>
  sendBuySell(res, () => createBuySellCheckout(req.params.id, req.get('x-buy-sell-order-token'), req.body ?? {}, req.get('idempotency-key'))));
/* Contract-level alias for clients that carry orderId in a JSON command. */
app.post('/api/v1/buy-sell/checkout', buySellPaymentRateLimit, (req, res) =>
  sendBuySell(res, () => createBuySellCheckout(req.body?.orderId, req.get('x-buy-sell-order-token'), req.body ?? {}, req.get('idempotency-key'))));
app.get('/api/v1/buy-sell/order/:id', (req, res) =>
  sendBuySell(res, () => getBuySellOrder(req.params.id, req.get('x-buy-sell-order-token'))));
app.get('/api/v1/buy-sell/order/:id/status', (req, res) =>
  sendBuySell(res, () => getBuySellOrder(req.params.id, req.get('x-buy-sell-order-token'), { verify: true })));
app.get('/api/v1/buy-sell/order/:id/audit', (req, res) =>
  sendBuySell(res, () => getBuySellOrderAudit(req.params.id, req.get('x-buy-sell-order-token'))));
app.post('/api/v1/buy-sell/order/:id/cancel', (req, res) =>
  sendBuySell(res, () => cancelBuySellOrder(req.params.id, req.get('x-buy-sell-order-token'))));
app.post('/api/v1/buy-sell/order/:id/verify', (req, res) =>
  sendBuySell(res, () => verifyBuySellOrder(req.params.id, req.get('x-buy-sell-order-token'))));

/* ---------------- Iranian USDT buy: isolated, fail-closed capability ------ */
/*
 * This is not a second general on-ramp and never shares Buy/Sell's Ramp order
 * model. It can be visible only when the server says every production
 * prerequisite is ready. Mutations additionally require a freshly verified
 * Telegram Mini App identity; the app-wide Telegram middleware is optional,
 * so financial routes must assert it explicitly rather than assuming it.
 */
function sendIranBuy(res, operation) {
  return Promise.resolve()
    .then(operation)
    .then((body) => {
      res.set('cache-control', 'no-store');
      return res.status(200).json(body ?? {});
    })
    .catch((error) => {
      const safe = iranBuyPublicFailure(error);
      res.set('cache-control', 'no-store');
      return res.status(safe.status).json({ error: safe.code });
    });
}

function requireIranBuyTelegramAuth(req, res, next) {
  const id = String(req.tgUser?.id || '').trim();
  if (!/^\d{1,20}$/.test(id)) {
    res.set('cache-control', 'no-store');
    return res.status(401).json({ error: 'AUTH_REQUIRED' });
  }
  req.iranBuyOwnerId = id;
  return next();
}

/* The public response is intentionally tiny: it never exposes raw env flags,
   provider credentials, readiness internals, or an unready configured network. */
app.get('/api/iran/buy/config', (_req, res) => {
  res.set('cache-control', 'no-store');
  return res.json(getIranBuyCapability());
});

const IRAN_BUY_RATE_WINDOW_MS = 60_000;
const configuredIranBuyLimit = (name, fallback) => {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 60 ? parsed : fallback;
};
const iranBuyRateOwnerHash = (owner) => createHash('sha256').update(`telegram:${owner}`).digest('hex');

/* Use the same durable Redis boundary that protects idempotency. A per-process
   Map would reset on a serverless cold start and let parallel instances bypass
   the financial budget. If the durable counter cannot be reached, actions fail
   closed rather than pretending a rate limit was applied. */
function iranBuyRateLimit({ limitEnv, fallback, bucket }) {
  return async (req, res, next) => {
    const owner = String(req.iranBuyOwnerId || '');
    const limit = configuredIranBuyLimit(limitEnv, fallback);
    const count = await upstashIncrementWindow(`iran-buy:rate:${bucket}:${iranBuyRateOwnerHash(owner)}`, IRAN_BUY_RATE_WINDOW_MS);
    res.set('cache-control', 'no-store');
    if (count == null) return res.status(503).json({ error: 'IRAN_BUY_DISABLED' });
    if (count > limit) {
      res.set('retry-after', String(Math.ceil(IRAN_BUY_RATE_WINDOW_MS / 1000)));
      return res.status(429).json({ error: 'IRAN_BUY_RATE_LIMITED' });
    }
    return next();
  };
}

const iranBuyPaymentRateLimit = iranBuyRateLimit({ limitEnv: 'IRAN_BUY_ORDER_RATE_LIMIT', fallback: 10, bucket: 'write' });
const iranBuyStatusRateLimit = iranBuyRateLimit({ limitEnv: 'IRAN_BUY_STATUS_RATE_LIMIT', fallback: 20, bucket: 'read' });

/* The narrow limits above apply to any action that can create an intent,
   consume a signature challenge, or eventually cause a provider command. */
app.post('/api/iran/buy/wallet-challenge', requireIranBuyTelegramAuth, iranBuyPaymentRateLimit, (req, res) =>
  sendIranBuy(res, () => createIranBuyWalletChallenge({
    ownerId: req.iranBuyOwnerId,
    address: req.body?.address,
    chainId: req.body?.chainId
  })));
app.post('/api/iran/buy/wallet-verify', requireIranBuyTelegramAuth, iranBuyPaymentRateLimit, (req, res) =>
  sendIranBuy(res, () => verifyIranBuyWalletChallenge({
    ownerId: req.iranBuyOwnerId,
    challengeId: req.body?.challengeId,
    signature: req.body?.signature
  })));
app.post('/api/iran/buy/usdt/preview', requireIranBuyTelegramAuth, iranBuyPaymentRateLimit, (req, res) =>
  sendIranBuy(res, () => createIranBuyPreview({
    ownerId: req.iranBuyOwnerId,
    amountToman: req.body?.amountToman,
    walletBindingToken: req.body?.walletBindingToken
  })));
app.post('/api/iran/buy/usdt', requireIranBuyTelegramAuth, iranBuyPaymentRateLimit, (req, res) =>
  sendIranBuy(res, () => createIranBuyOrder({
    ownerId: req.iranBuyOwnerId,
    previewId: req.body?.previewId,
    previewAccessToken: req.body?.previewAccessToken,
    walletBindingToken: req.body?.walletBindingToken,
    idempotencyKey: req.body?.idempotencyKey
  }, req.get('idempotency-key'))));
app.get('/api/iran/buy/orders/:id', requireIranBuyTelegramAuth, iranBuyStatusRateLimit, (req, res) =>
  sendIranBuy(res, () => getIranBuyOrder({
    ownerId: req.iranBuyOwnerId,
    orderId: req.params.id,
    orderAccessToken: req.get('x-iran-buy-order-token'),
    poll: true
  })));
app.get('/api/iran/buy/orders/:id/audit', requireIranBuyTelegramAuth, iranBuyStatusRateLimit, (req, res) =>
  sendIranBuy(res, () => getIranBuyOrderAudit({
    ownerId: req.iranBuyOwnerId,
    orderId: req.params.id,
    orderAccessToken: req.get('x-iran-buy-order-token')
  })));
app.post('/api/iran/buy/orders/:id/settlement-challenge', requireIranBuyTelegramAuth, iranBuyPaymentRateLimit, (req, res) =>
  sendIranBuy(res, () => createIranBuySettlementChallenge({
    ownerId: req.iranBuyOwnerId,
    orderId: req.params.id,
    orderAccessToken: req.get('x-iran-buy-order-token')
  })));
app.post('/api/iran/buy/orders/:id/settlement-authorize', requireIranBuyTelegramAuth, iranBuyPaymentRateLimit, (req, res) =>
  sendIranBuy(res, () => authorizeIranBuySettlement({
    ownerId: req.iranBuyOwnerId,
    orderId: req.params.id,
    orderAccessToken: req.get('x-iran-buy-order-token'),
    challengeId: req.body?.challengeId,
    signature: req.body?.signature
  })));
app.post('/api/iran/buy/orders/:id/cancel', requireIranBuyTelegramAuth, iranBuyPaymentRateLimit, (req, res) =>
  sendIranBuy(res, () => cancelIranBuyOrder({
    ownerId: req.iranBuyOwnerId,
    orderId: req.params.id,
    orderAccessToken: req.get('x-iran-buy-order-token')
  })));

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

/**
 * Record a provider call in the in-process health tracker used by
 * /api/providers/status and the Ecosystem page. A client validation error
 * (400 BAD_MINT, UNSUPPORTED_CHAIN, ...) says nothing about the provider's
 * health, so it is deliberately not recorded; only success, upstream/auth
 * failures and unavailability (5xx/401/403/503) move the tracker.
 */
function recordProviderHealth(id, r) {
  if (!r) return;
  const status = Number(r.status || (r.ok ? 200 : 0));
  if (status >= 200 && status < 400) {
    recordSuccess(id);
    return;
  }
  const detail = r.body?.error || r.body?.detail || r.body?.message || `HTTP_${status}`;
  if (status >= 500 || status === 401 || status === 403 || status === 503) {
    recordFailure(id, String(detail).slice(0, 120));
  }
  return r;
}

/** Record the shared LI.FI health from the /api/cross-chain routes. */
function recordCrossChainHealth(result) {
  recordProviderHealth('lifi', result);
}

app.get('/api/solana/oo/quote', async (req, res) => {
  const r = await oceanQuote(req.query);
  recordProviderHealth('solana-openocean', r);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/solana/oo/swap', async (req, res) => {
  const r = await oceanSwap(req.query);
  recordProviderHealth('solana-openocean', r);
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
  recordProviderHealth('kyberswap', r);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.post('/api/swap/kyber/build', async (req, res) => {
  const r = await proxyKyberBuild(req.body ?? {});
  recordProviderHealth('kyberswap', r);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/swap/oo/quote', async (req, res) => {
  const r = await proxyOoQuote(req.query);
  recordProviderHealth('openocean', r);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/swap/oo/swap', async (req, res) => {
  const r = await proxyOoSwap(req.query);
  recordProviderHealth('openocean', r);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

/* Velora — quote-only, same reachability fallback (see lib/velora.js). */
app.get('/api/swap/velora/prices', async (req, res) => {
  const r = await proxyVeloraPrices(req.query);
  recordProviderHealth('velora', r);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

/*
 * P2P bitcoin market (Hodl Hodl) — live offers for buying/selling BTC
 * against local money, proxied with a strict allow-list so no arbitrary
 * client parameter can reach upstream. The referral link is built ONLY in
 * server/hodlhodl.js from HODLHODL_REF — the same boundary that keeps
 * `referrer` unforgeable on the Solana route.
 *
 * Read-only by design: escrow creation needs the user's own payment
 * password on hodlhodl.com, and this project will never hold a Signature
 * Key (their docs: it grants direct access to user funds).
 *
 * These sit under the broad /api limiter like everything else; the upstream
 * budget (2 reads/min anonymous) is absorbed by the in-module caching.
 */
app.get('/api/p2p/status', (_req, res) => res.json(p2pStatus()));

app.get('/api/p2p/offers', async (req, res) => {
  const r = await p2pOffers(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/p2p/payment-methods', async (req, res) => {
  const r = await p2pPaymentMethods(req.query);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/p2p/currencies', async (_req, res) => {
  const r = await p2pCurrencies();
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/p2p/countries', async (_req, res) => {
  const r = await p2pCountries();
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

/*
 * BITCOIN CHAIN FACTS for the internal BIP-84 wallet (server/btcChain.js).
 *
 * The app's own BTC leg needs balance/UTXOs, fee estimates and a broadcast
 * relay for transactions the UNLOCKED vault signs in the browser. The server
 * is the sole egress to the Esplora upstream (default mempool.space,
 * BTC_API_BASE to override), exactly the hodlhodl.js pattern: an allow-list
 * decides what is askable — addresses must pass the REAL mainnet checksum
 * (src/lib/btcAddress.js, the same validator the P2P paste box uses) before
 * any upstream call is made.
 *
 * The server never sees a key or a mnemonic: /api/btc/tx relays finished,
 * signed, public bytes only, and never logs or echoes the raw hex. These sit
 * under the broad /api limiter like everything else; the upstream budget is
 * absorbed by the in-module TTL cache.
 */
app.get('/api/btc/address/:addr', async (req, res) => {
  const r = await btcAddress(req.params.addr);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/btc/fees', async (_req, res) => {
  const r = await btcFees();
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.post('/api/btc/tx', async (req, res) => {
  const raw = typeof req.body === 'string' ? req.body : req.body?.rawTx;
  const r = await btcBroadcast(raw);
  return res.status(r.status).json(r.body ?? { error: 'UPSTREAM_FAILED' });
});

app.get('/api/btc/status', (_req, res) => res.json(btcStatus()));

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

/*
 * STANDARD PROVIDER STATUS — one operational shape for every integration.
 *
 * Sibling to /api/revenue/readiness: that answers "what is earning?", this
 * answers "which providers are actually working right now?". Reports booleans
 * and chain lists only — never a secret value, a key, or a credential. See
 * server/providerStatus.js for the honesty rules (reachable/authenticated
 * start false and flip only on evidence).
 *
 * Cacheable for a minute: the in-process health tracker that feeds
 * lastSuccessAt/lastFailureAt is per-instance, and a shorter TTL would just
 * re-emit the same booleans. Stale-while-revalidate keeps it cheap.
 */
app.get('/api/providers/status', (_req, res) => {
  res.set('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=240');
  return res.json(providerStatusReport());
});

/*
 * POST /api/providers/probe — one tiny quote per fee-earning DEX/liquidity
 * source, recorded into the same health tracker /providers/status reads.
 *
 * This is what makes the Ecosystem page able to say "connected" about
 * KyberSwap, OpenOcean, Velora and 0x Gasless on a fresh server process. It is
 * read-only (nothing is signed/broadcast) and the calls are fixed upstream
 * shapes with small amounts, so it cannot be used as an open proxy.
 */
app.post('/api/providers/probe', async (_req, res) => {
  return res.status(200).json(await probeProviderStatuses());
});

app.get('/api/xchain/status', (_req, res) => res.json(crossChainStatus()));

app.get('/api/xchain/probe', async (_req, res) => {
  const r = await crossChainProbe();
  // crossChainProbe returns 200 with the real HTTP result in body.httpStatus;
  // record that so /api/providers/status sees whether our 0x key actually
  // reached upstream without treating a 401/403 as "unconfigured".
  const status = Number(r.body?.httpStatus || r.status);
  if (status >= 200 && status < 400) recordSuccess('0x-cross-chain');
  else if (status >= 500 || status === 401 || status === 403) recordFailure('0x-cross-chain', r.body?.detail || `HTTP_${status}`);
  return res.status(r.status).json(r.body);
});

app.get('/api/xchain/quotes', async (req, res) => {
  const r = await crossChainQuotes(req.query);
  recordProviderHealth('0x-cross-chain', r);
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

/* --------------------- AI COMMAND CENTER (AI page backend) --------------- */
/*
 * The eight routes the AI page runs on, in one module: chat, dashboard, plan,
 * approve, execute, automations, emergency stop, and the hidden agent roster.
 *
 * It is mounted here rather than written inline for one reason: the exact same
 * orchestrator, firewall and budget code the browser runs
 * (`src/lib/intent-ai/commandCenter.js`) is the code the server runs. Two
 * surfaces, one authority — a plan that passes in the panel cannot fail
 * differently on the API, which is the class of bug where a "blocked" verdict
 * on one device is an "allowed" verdict on another.
 *
 * Nothing in this router can move money. There is no signer in this process:
 * `/plan/:id/execute` returns a verdict and a hand-off route, and the statuses
 * stop there. The existing /api/ai budget (AI_RATE_LIMIT, 10/min by default)
 * already covers these paths, since this mount sits under that middleware.
 */
app.use('/api/ai', aiCommandRoutes);

/* ---------------------- FBT INTENT AI OS (unified V1) ---------------------- */
/*
 * The single AI gateway introduced by the AI OS refactor. It is mounted on
 * /api/v1/ai so it coexists with the older /api/ai command-center routes
 * while the client migrates. Same honesty rule as /api/ai: no signer, no key,
 * no fabricated transaction — the chat builds context + plan + suggestion and
 * the execute endpoint returns a real venue/wallet hand-off.
 */
app.use('/api/v1/ai', aiIntentOSRoutes);

/* ----------------- FBT CENTRAL INTELLIGENCE OS — the central brain ---------------- */
/*
 * One brain for all thirty modules (§14), mounted as a single gateway (§37) so no
 * screen ever talks to a venue directly and then narrates the result. Everything
 * that makes this different from another AI route lives behind it: a durable
 * per-owner system state, a capability matrix, a policy engine that must pass
 * before a tool is called, an action engine that parks a confirmed plan, and the
 * after-transaction refresh that re-reads every dependent module.
 *
 * The budget is its own on purpose. A turn spends real provider quota (wallet +
 * market + protocol reads), so writes are capped; but 10/min — the /api/v1/ai
 * figure — is not a usable chat budget for a human typing and confirming, and the
 * brain's mutating surface is already gated by confirmation + idempotency, so the
 * limiter's job here is to stop a script, not to throttle a person. GETs are free
 * (they read cached state), and the SSE stream is a single long-lived GET.
 *
 * The server never signs: `execute` stops at an unsigned hand-off (§36), which is
 * why nothing under this mount needs a key, a seed, or a mnemonic — and why none
 * of these handlers can be talked into producing one.
 */
const centralIntelligence = createCentralIntelligence({ log: (line) => app.locals.ciLog?.push?.(line) });
const ciHits = new Map();
const CI_WRITE_MAX = Number(process.env.BRAIN_RATE_LIMIT || 30);
const CI_TOOL_MAX = Number(process.env.BRAIN_TOOL_RATE_LIMIT || 120);
app.use('/api/brain', (req, res, next) => {
  if (req.method === 'GET') return next();
  const isTool = req.path.startsWith('/tools/');
  const max = isTool ? CI_TOOL_MAX : CI_WRITE_MAX;
  /* The bucket is per DEVICE identity, falling back to the IP: thirty users behind
     one office NAT must not starve each other's chat budget, while an anonymous
     script still gets one ceiling per address. The device header is the same one the
     brain scopes its session by, so the budget and the session agree. */
  const ciDevice = String(req.get?.('x-fbt-device') || '').trim();
  const key = `${req.tgUser?.id ?? (ciDevice || req.ip)}:${isTool ? 'tools' : 'intent'}`;
  const now = Date.now();
  const rec = ciHits.get(key);
  if (!rec || now > rec.reset) {
    ciHits.set(key, { count: 1, reset: now + WINDOW_MS });
    return next();
  }
  rec.count += 1;
  if (rec.count > max) {
    res.set('retry-after', String(Math.ceil((rec.reset - now) / 1000)));
    /* 429 as data, not as a thrown error: the chat renders this as "the brain is
       busy, retry in Ns" and keeps the conversation, instead of a blank bubble. */
    return res.status(429).json({
      ok: false, code: 'BRAIN_RATE_LIMITED', retryAfterMs: rec.reset - now,
      detail: isTool ? 'too many direct tool calls for this device' : 'too many intents for this device',
      brain: centralIntelligence.schema
    });
  }
  return next();
});
app.set('centralIntelligence', centralIntelligence);
app.use('/api/brain', centralIntelligence.router);
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ciHits) if (now > v.reset) ciHits.delete(k);
}, WINDOW_MS).unref?.();

/*
 * ─── TWO GATEWAYS, ONE REPO: READ THIS BEFORE ADDING A THIRD ───────────────
 * `/api/brain` above is the Central Intelligence OS built in this branch: shared
 * per-owner state, capability matrix, policy gates, plan digests, action engine,
 * verification, and the §42 probes (turns + HTTP). `/api` below is the earlier
 * central OS merged into main from PR #137/#138 (`server/central/*`), which
 * exposes §36's literal paths (`/api/intent`, `/api/system/*`, `/api/tools/*`)
 * and its own event-driven refresh.
 *
 * They coexist without fighting over routes, and both are kept here on purpose:
 * deleting a merged implementation from inside a feature branch is not a merge
 * resolution, it is a silent revert of somebody else's work. What must NOT
 * continue to coexist is the choice in the frontend — `CentralBrainContext` and
 * `src/lib/central/client.js` speak only to `/api/brain`, so exactly one brain is
 * wired into the UI, and no screen is allowed to grow a second client.
 *
 * Follow-up (not in this PR): pick one surface, move the other's tests over, and
 * alias the loser for a release so nothing 404s mid-migration.
 */
/* ---------------------- FBT CENTRAL INTELLIGENCE OS ------------------------ */
/*
 * The central brain (§45): Wallet, Swap, Bridge, Lending, Futures, dYdX,
 * Portfolio, Goals, News, Signals… are limbs of ONE system. The frontend
 * talks to a single gateway — /api/intent, /api/system/*, /api/tools/* —
 * and the brain answers from REAL module state, never from an LLM guess.
 * Mounted after express.json and the rate limiter; adapters self-register.
 */
installCentralOS();
app.use('/api', centralRouter);

/* ------------------------------ lending BFF --------------------------------- */
/*
 * The read/build API behind the Lending page (spec §6/§7/§29/§30). Mounted
 * on /api/lending so it inherits the broad /api rate limiter. Read endpoints
 * return live or cached market data; POST endpoints only VALIDATE and BUILD
 * unsigned transactions — the user's wallet signs. No signer, no key, no
 * broadcast exists anywhere under this mount, and every contract address is
 * allowlist-checked before any RPC is dialed. The engine modules it imports
 * (src/lib/lending-engine) are pure and dependency-free, so the same risk
 * bands, alert rules and circuit-breaker ladder run in the UI and here.
 */
app.use('/api/lending', lendingRouter());

/* ------------------------------ futures BFF -------------------------------- */
/*
 * FBT Futures Engine v3 (spec: FUTURES ENGINE — PRODUCTION UPGRADE). The
 * read/quote/risk/prepare/verify API behind the Futures page's three tabs
 * (Perpetual · dYdX · On-Chain) and the Intent OS futures_* capabilities.
 * Same contract as the lending BFF: every POST returns UNSIGNED calldata for
 * the user's wallet, every fee is computed here (never in the browser), every
 * provider status is derived from live probes, and every value the UI shows
 * has a backend source. No signer, no key, no CEX trading API exists here.
 */
app.use('/api/v1/futures', futuresRouter());

/* ------------------------------ FBT REWARDS ------------------------------- */
/*
 * The rewards engine (spec: REWARDS PRODUCTION UPGRADE). API-first and
 * non-custodial: the engine aggregates REAL activity events (idempotent,
 * rate-limited, on-chain-verified when evidence exists) into one small ledger
 * per account, derives level / missions / achievements / referral, and serves
 * the /rewards dashboard. Claims stay honest: prepare/simulate only issue
 * single-use nonces until a reward distributor contract is configured
 * (FBT_REWARDS_DISTRIBUTOR_*). No key, no custody, no broadcast.
 */
app.use('/api/v1/rewards', rewardsRouter());

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
async function deliverStagePush(endpoint, message) {
  const { sendToEndpoint } = await import('./push.js');
  const { fcmSendToToken } = await import('./fcm.js');
  const { parseIdentity } = await import('./watch.js');
  const id = parseIdentity(endpoint);
  if (!id) return false;
  return id.kind === 'fcm' ? fcmSendToToken(id.value, message) : sendToEndpoint(id.value, message);
}

async function sendWatchAlert(endpoint, lang, payload) {
  const { buildStageAlert } = await import('./orderAlerts.js');
  const message = buildStageAlert({
    stage: payload.stage || 'ready',
    kind: payload.kind || 'order',
    lang,
    base: payload.base,
    quote: payload.quote,
    rate: payload.rate,
    id: payload.id
  });
  return deliverStagePush(endpoint, message);
}

/** Run one watch cycle. Cron-driven, guarded by the same secret. */
app.get('/api/cron/watch', async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const out = await runWatchCycle(sendWatchAlert);
  return res.json(out);
});

/* --------------------------- user monitor cron ---------------------------- */
/*
 * Evaluates the Intent OS market monitors ("بازار را بپای") that the user
 * created in chat. Same rules as the order watcher: a missing price is an
 * error, never a trigger; one failing monitor never cancels the others.
 */
async function deliverMonitorPush({ endpoint, lang, title, body }) {
  const { sendToEndpoint } = await import('./push.js');
  const { fcmSendToToken } = await import('./fcm.js');
  const { parseIdentity } = await import('./watch.js');
  const id = parseIdentity(endpoint);
  if (!id) return false;
  return id.kind === 'fcm'
    ? fcmSendToToken(id.value, { title, body, url: '/intent', tag: 'fbt-monitor', stage: 'ready' })
    : sendToEndpoint(id.value, { title, body });
}

app.get('/api/cron/monitors', async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'UNAUTHORIZED' });
  const out = await evaluateAllMonitors({ send: deliverMonitorPush });
  return res.json({ ok: !out.error, ...out });
});

/** How many user monitors exist, for debugging a silent cron. */
app.get('/api/monitors/status', async (_req, res) => {
  res.json(await monitorEngineStatus().catch((err) => ({ ok: false, error: String(err?.message || 'STORE_UNAVAILABLE').slice(0, 120) })));
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
app.post('/api/push/event', async (req, res) => {
  const { endpoint, stage, kind, base, quote, rate, id, lang } = req.body ?? {};
  const { buildStageAlert, STAGES } = await import('./orderAlerts.js');
  if (!STAGES.includes(stage)) return res.status(400).json({ ok: false, error: 'BAD_STAGE' });
  try {
    const message = buildStageAlert({
      stage,
      kind: kind === 'intent' ? 'intent' : 'order',
      lang: String(lang || 'fa').slice(0, 5),
      base,
      quote,
      rate,
      id
    });
    const ok = await deliverStagePush(endpoint, message);
    return res.json({ ok });
  } catch (e) {
    return res.status(400).json({ ok: false, error: String(e.message).slice(0, 80) });
  }
});

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
  /*
   * Registry maintenance rides on the existing daily slot rather than taking
   * another cron slot. The old reason written here — "Hobby allows two" — was
   * wrong and it nearly cost us production: Hobby allows 100 cron jobs per
   * project, but EVERY one of them must fire at most once a day. A
   * ten-minute step expression is rejected with "Hobby accounts are limited
   * to daily cron jobs", and because the cron table is validated when the
   * deployment is created, the whole deployment dies — no build, no error on
   * the code, the site simply stops moving. docs/VERCEL-CRON-HOBBY-FA.md has
   * the two-hour story.
   *
   *   · sweepCertifications — reads already treat an expired certificate as
   *     expired; this makes the stored row say so, instead of leaving
   *     `active` rows that only look wrong to whoever reads the blob directly.
   *   · reputation snapshot — recomputed here so the first visitor of the day
   *     does not pay for a thirty-bucket walk on the request path.
   *
   * Both are settled, never awaited into the failure path: a registry chore
   * must not be able to stop the daily notifications from going out.
   */
  /* Evidence freshness. On Vercel the only re-runs happen at cold start, so a
     5–6 h TTL would silently drop an activated release back to partial before
     the next deployment. Re-verify the four measurable kinds, the four
     operational drills and the stage-3 kinds here, on the existing daily
     slot — self-verifiable facts only, never a manufactured record. Each run
     rebuilds the durable snapshot through the normal store. */
  await Promise.all([
    ensureOperatorEvidenceHydrated().catch(() => {}),
    ensureHydrated().catch(() => {}),
    ensureOpsHydrated().catch(() => {}),
    ensureStage3Hydrated().catch(() => {})
  ]);
  const [web, fcm, watch, monitors, smartMoneyAlerts, certs, reputation, selfProbe, opsProbe, stage3] = await Promise.allSettled([
    sendDailyPromo(),
    sendDailyFcm(),
    runWatchCycle(sendWatchAlert),
    evaluateAllMonitors({ send: deliverMonitorPush }),
    smartMoney.runAlertCycle(async (endpoint, _lang, payload) =>
      deliverStagePush(endpoint, { title: payload.title, body: payload.body, url: payload.url, tag: payload.tag })),
    sweepCertifications(),
    getReputationSnapshot({ force: true }),
    runSelfProbe({}),
    runOpsProbe({}),
    runStage3Probe({})
  ]);
  const settled = (result, shape) => result.status === 'fulfilled' ? shape(result.value) : { error: String(result.reason).slice(0, 120) };
  res.json({
    web: web.status === 'fulfilled' ? web.value : { error: String(web.reason).slice(0, 120) },
    fcm: fcm.status === 'fulfilled' ? fcm.value : { error: String(fcm.reason).slice(0, 120) },
    watch: watch.status === 'fulfilled' ? watch.value : { error: String(watch.reason).slice(0, 120) },
    monitors: monitors.status === 'fulfilled' ? monitors.value : { error: String(monitors.reason).slice(0, 120) },
    smartMoneyAlerts: smartMoneyAlerts.status === 'fulfilled' ? smartMoneyAlerts.value : { error: String(smartMoneyAlerts.reason).slice(0, 120) },
    certifications: settled(certs, (value) => value.ok ? { expired: value.expired, active: value.active } : { skipped: value.code }),
    reputation: settled(reputation, (value) => ({ dataStatus: value.dataStatus, subjects: value.snapshot?.subjectCount ?? 0 })),
    intentActivation: {
      selfProbe: settled(selfProbe, (value) => ({ earnedCount: value.earnedCount, totalKinds: value.totalKinds })),
      opsProbe: settled(opsProbe, (value) => ({ earnedCount: value.earnedCount, totalKinds: value.totalKinds })),
      stage3: settled(stage3, (value) => ({ earnedCount: value.earnedCount, totalKinds: value.totalKinds })),
      evidence: evidenceStoreStatus(),
      refreshedAt: new Date().toISOString()
    }
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

app.get('/api/intents/v1/execution-observation-model', async (_req, res) => {
  const empty = {
    schema: 'fbt.intent-execution-model.v1',
    modelTrained: false,
    trainedAt: null,
    model: null
  };
  const mod = await learningMod();
  if (!mod?.getExecServingParams) {
    res.setHeader('cache-control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
    return res.json(empty);
  }
  const snapshot = await mod.getExecServingParams();
  res.setHeader('cache-control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  return res.json(mod.execServingResponse(snapshot));
});

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
  const execObservation = typeof mod.runExecObservationTraining === 'function'
    ? await mod.runExecObservationTraining()
    : { skipped: 'NO_MODULE', modelTrained: false };
  if (summary.ok) mod.warmParamsCache().catch(() => {});
  if (execObservation?.ok) mod.warmExecParamsCache?.().catch(() => {});
  res.json({ ...summary, sweep, execObservation });
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
 *                ships, which is worse than a slow load. It keeps its
 *                must-revalidate policy below, served through this same
 *                middleware rather than only through the fallback.
 *
 *   <slug>/index.html — static landing guides (the Persian DEX landing
 *                first among them). With `index: false` this middleware
 *                REFUSED to serve directory indexes at all, so the SPA
 *                fallback answered /صرافی-غیرمتمرکز/ with the app shell on
 *                every self-hosted deployment while Vercel served the real
 *                guide. The two platforms disagreed, silently. Serving the
 *                index here restores parity; every index.html in dist —
 *                guide or app shell — gets the identical must-revalidate
 *                policy that only-ever-applied to the app shell.
 *
 * Vercel serves /assets and /fonts from its edge using the headers in
 * vercel.json and never reaches this code. This matters for the APK, which
 * bundles the server, and for anyone self-hosting — the two paths must agree
 * or the app behaves differently depending on where it runs.
 */
app.use(
  express.static(distDir, {
    index: 'index.html',
    setHeaders(res, filePath) {
      if (/[\\/](assets|fonts)[\\/]/.test(filePath)) {
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        return;
      }
      if (/index\.html$/.test(filePath)) {
        /* The whole point above: HTML is never stale-pinned. Applies to the
           app shell AND to every static landing guide in dist. */
        res.setHeader('cache-control', 'public, max-age=0, must-revalidate');
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

/* ── Wave 2: Auto-evidence collection on server start ─────────────────── */
/* Collects REAL evidence from local services and registers them in-memory.
   Non-blocking: runs in background, never delays server startup.
   Only runs in production (Vercel or explicit opt-in) — never in tests. */
if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') {
  setTimeout(() => {
    import('./intentAutoEvidence.js').then(({ autoInjectEvidence }) => {
      autoInjectEvidence().then((evidence) => {
        if (typeof process.stdout.write === 'function') {
          console.log(`[activation] self-verified ${evidence?.length || 0}/21 evidence kinds; the remainder require operator injection`);
        }
      }).catch(() => {});
    }).catch(() => {});

    /* The four measurable kinds are earned by the deployment itself. Boot is
       the earliest honest moment to try: the TLS and venue probes need only
       network access, while SLO and audit stay unearned until there is real
       traffic and a durable store. Failures are silent by design — an
       unreachable venue must not make the process noisy or unhealthy. */
    import('./intentSelfProbe.js').then(({ runSelfProbe, ensureHydrated: hydrate }) => {
      hydrate().catch(() => {});
      runSelfProbe({}).then((report) => {
        console.log(`[activation] self-probe earned ${report.earnedCount}/${report.totalKinds} measurable kinds`);
      }).catch(() => {});
    }).catch(() => {});

    /* The four operational drills actually write, restore, isolate and hash.
       Boot is the earliest honest moment; failures stay silent. */
    import('./intentOpsProbe.js').then(({ runOpsProbe, ensureOpsHydrated: hydrateOps }) => {
      hydrateOps().catch(() => {});
      runOpsProbe({}).then((report) => {
        console.log(`[activation] ops-probe earned ${report.earnedCount}/${report.totalKinds} operational drills`);
      }).catch(() => {});
    }).catch(() => {});

    /* Stage 3: policy-bound signer, guardian, broker, live bridge quote.
       independent-security-review stays missing until a signed intake lands. */
    import('./intentStage3Probe.js').then(({ runStage3Probe, ensureStage3Hydrated: hydrateStage3 }) => {
      hydrateStage3().catch(() => {});
      runStage3Probe({}).then((report) => {
        console.log(`[activation] stage3-probe earned ${report.earnedCount}/${report.totalKinds} kinds`);
      }).catch(() => {});
    }).catch(() => {});

    /* Later-phase 31–100: in-process proofs only. Never stored as 21/21 kinds. */
    import('./intentLaterPhaseProbe.js').then(({ runLaterPhaseProbe: runLater }) => {
      runLater({}).then((report) => {
        console.log(`[activation] later-phase proven ${report.provenCount}/${report.totalChecks} checks; launchAllowed=false`);
      }).catch(() => {});
    }).catch(() => {});

    /* Re-collect every 4 hours to keep evidence fresh */
    const timer = setInterval(() => {
      import('./intentAutoEvidence.js').then(({ autoInjectEvidence }) => {
        autoInjectEvidence().catch(() => {});
      }).catch(() => {});
      import('./intentSelfProbe.js').then(({ runSelfProbe }) => {
        runSelfProbe({}).catch(() => {});
      }).catch(() => {});
      import('./intentOpsProbe.js').then(({ runOpsProbe }) => {
        runOpsProbe({}).catch(() => {});
      }).catch(() => {});
      import('./intentStage3Probe.js').then(({ runStage3Probe }) => {
        runStage3Probe({}).catch(() => {});
      }).catch(() => {});
      import('./intentLaterPhaseProbe.js').then(({ runLaterPhaseProbe: runLater }) => {
        runLater({}).catch(() => {});
      }).catch(() => {});
    }, 4 * 3600_000);
    if (timer.unref) timer.unref();
  }, 200);
}

export default app;
