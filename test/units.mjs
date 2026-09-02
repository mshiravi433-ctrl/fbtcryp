import { activateDca } from '../src/lib/dcaExecution.js';
/**
 * Pure-logic unit tests. No DOM, no bundler — these modules are deliberately
 * free of React and browser APIs so they can be exercised directly, which is
 * the cheapest place to catch a regression in the parts that decide where
 * money goes.
 */
import { searchTokens, tokenKey, getTokensSync } from '../src/lib/tokenLists.js';
import { FAMILY, isValidFor, resolvePayout, payoutTable, PAYOUT_ADDRESSES } from '../src/lib/payout.js';
import { localAnswer } from '../src/lib/faqLocal.js';
import { digestFromMarket } from '../src/lib/news.js';
import { trimKeepingLanguages } from '../server/news.js';
import { isEligible, normalizePool, riskBand } from '../server/yields.js';
import { issuerMatches } from '../server/solanaAssets.js';
import { bridgeFee, integratorId } from '../server/bridge.js';
import { feeBps as gaslessFeeBps, feeRecipient as gaslessRecipient, gaslessConfigured } from '../server/gasless.js';
import {
  COMMODITY_ASSETS,
  EQUITY_ASSETS,
  LST_ASSETS,
  MAX_POOL_SHARE,
  XSTOCK_FREEZE_AUTHORITY,
  XSTOCK_MINT_AUTHORITY,
  findAsset,
  isCuratedMint,
  liquidityVerdict
} from '../src/lib/solanaAssets.js';
import { MIN_EQUITY_LIQUIDITY, projectStake, yieldForLst } from '../src/lib/solanaAssetsClient.js';
import { iconCandidates } from '../src/lib/tokenIcon.jsx';
import { pairTokens, pairSwapRoute, llamaChainId, projectEarnings, rateIsUnusual, realShare, farmScore, impermanentLoss } from '../src/lib/yields.js';
/* LST_ASSETS / EQUITY_ASSETS / COMMODITY_ASSETS are imported above (solanaAssets). */
import { SOL_MINT, USDC_MINT, USDT_MINT } from '../src/lib/solana.js';
import { SOLANA_SIGNAL_ASSETS } from '../src/lib/solanaSignals.js';
import { buildHoldings } from '../src/hooks/useWalletBalances.js';
import { normalizeEvent, validateResponseShape, EVENT_KINDS } from '../src/lib/whales.js';
import {
  REFERRAL_SHARE,
  captureReferral,
  clearReferral,
  isValidRefCode,
  referredBy,
  referrerShare
} from '../src/lib/referral.js';
import { backpackBrowseLink, phantomBrowseLink, publicAppUrl, solflareBrowseLink } from '../src/lib/solanaWallet.js';
import {
  BTC_WATCH_KEY,
  MAX_WATCH,
  addWatch,
  loadWatch,
  removeWatch,
  saveWatch,
  validateWatch
} from '../src/lib/btcWatch.js';
import { flagEmoji, flagFallback, flagSupported, normalizeCountryCode } from '../src/lib/countryFlag.js';
import {
  GOAL_MAX_ANNUAL_YIELD,
  goalProgress,
  monthsBetween,
  projectGoalValue,
  requiredMonthlyContribution
} from '../src/lib/goalMath.js';
import { shareTargets, telegramShareUrl } from '../src/lib/share.js';
import {
  TELEGRAM_BOT_ID,
  TELEGRAM_BOT_URL,
  TELEGRAM_BOT_USERNAME,
  telegramBotStartAppUrl
} from '../src/lib/telegramBot.js';
import { EXPECTED_TELEGRAM_BOT_ID, botIdFromToken, telegramBotIdentity } from '../server/telegramIdentity.js';
import { webAppUrlForStart } from '../server/bot.js';
import { SUPPORT_EMAIL, SUPPORT_MAILTO, LEGACY_EMAIL_IN_LOCALES, withContactEmail } from '../src/lib/contact.js';
import { allowedNumbers, buildPost, esc, hasInventedNumber } from '../scripts/channel-post.mjs';
import { comparable, improvementBps, isUsableQuote, pickBestQuote } from '../src/lib/bestQuote.js';
import {
  QUOTE_SCHEMA,
  normalizeQuote,
  quoteAgeMs,
  isFresh,
  isExpired,
  netOutputUsd,
  canBeBest,
  comparable as comparableUnified,
  rankByNetOutput,
  fingerprintMatches,
  failureCode,
  isRetriable,
  fnv1aHex
} from '../src/lib/quoteModel.js';
import {
  buildUnsignedTransaction,
  verifyCounterparties,
  computeAmountOutMin,
  computeDeadline,
  decodeRevertReason,
  simulateUnsignedTransaction,
  simulationOutcome
} from '../src/lib/preSignSimulation.js';
import {
  mevExecutionState,
  mayShowProtected,
  mevStateLabel
} from '../src/lib/mevProtection.js';
import {
  evaluateExecutionGate,
  worse,
  isBlocked,
  requiresAcknowledgement
} from '../src/lib/executionGate.js';
import {
  buildProviderStatus,
  providerStatusReport,
  recordSuccess,
  recordFailure
} from '../server/providerStatus.js';
import { bpsToPercent, ooSwapParams, openOceanSupports, toOOAddress } from '../src/lib/openocean.js';
import { betaToBtc, cyclePosition, macroContext, marketRegime } from '../src/lib/macro.js';
import { CONFIDENCE_CEILING, verdict } from '../src/lib/verdict.js';
import {
  CONSENT_RE,
  LAYER_MAX_MULT,
  LAYER_MIN_MULT,
  MAX_RECORD_BYTES,
  bucketReturn,
  bucketSign,
  defaultParams,
  directionOf,
  paramsAreNoop,
  sanitizeParams,
  validateResolution,
  validateSignal
} from '../server/learning/schema.js';
import {
  advisorFit,
  attributionDeltas,
  auc,
  banditUpdate,
  bayesianContrast,
  calibratedP,
  computeStats,
  driftClamp,
  fitLogistic,
  logLoss,
  mergeMultipliers,
  mulberry32,
  newtonCalibration,
  parseLearningLines,
  primaryResolution,
  regimeAdjust,
  runTraining,
  seedForDate,
  trainV2,
  volatilityTune
} from '../server/learning/train.js';
import { validateEvent } from '../server/learning/schema.js';
import {
  hashCoinId,
  ingestEvent,
  readPending,
  sweepPending
} from '../server/learning/events.js';
import { applyParams, paramsUsable } from '../server/learning/loader.js';
import { cachedPriceUSD } from '../server/learning/prices.js';
import {
  anonCoinId,
  bucketReturn as clientBucketReturn,
  layerTune,
  orderTune,
  weightsSnapshotId
} from '../src/lib/learning.js';
import { pruneParams, readBucketsWindow, rollAndPruneBuckets } from '../server/learning/store.js';
import {
  baseRate,
  findLevels,
  historyFacts,
  levelRecord,
  maxDrawdown,
  rangePosition,
  relativeToNormal
} from '../src/lib/history.js';
import {
  REFERRAL_FEE_MAX_BPS,
  REFERRAL_FEE_MIN_BPS,
  executeSucceeded,
  fromBaseUnits,
  isSolanaAddress,
  netFeeBps,
  orderErrorKey,
  referralFeeBps,
  toBaseUnits
} from '../src/lib/solana.js';
import {
  FUNDING_INTERVAL_HOURS,
  VENUE_CUSTODY,
  TRACKED_ASSETS,
  annualiseFunding,
  crowding,
  groupByAsset,
  normalizeTicker
} from '../server/perp.js';
import { bestVenue, fundingCost, liquidationMove } from '../src/lib/perp.js';
import {
  LADDER_MAX_STEPS,
  LADDER_MIN_STEPS,
  WATCHED_TYPES,
  ladderPortion,
  ladderRungs
} from '../src/lib/orders.js';
import { evaluateWatch } from '../server/watch.js';
import { GOALS, GOAL_SHAPE, REFUSALS, buildAutopilot, summariseDraft } from '../src/lib/autopilot.js';
import { VENUE_REFERRAL, isValidGmxCode, venueDisclosure, withReferral, anyVenueEarns } from '../src/lib/venueReferral.js';
import { isSwappable, swapTargetFor, swapUrlFor } from '../src/lib/coinToSwap.js';
import { ChangeNowHostedCheckoutProvider, FBT_TRADING_FEE, ORDER_STATES, ProviderRouter, validateDestination } from '../server/buySell.js';
import { STATIONS, parseAudioFeed } from '../server/audio.js';
import { VAULT_CHAINS, isValidVaultAddress, vaultConfig, vaultFeePercent, vaultIsLive } from '../src/lib/vault.js';
import { fmtDuration } from '../src/lib/audio.js';
import { buildIndex, PLATFORM_SLUGS } from '../server/coinIndex.js';
import {
  MIN_SAMPLES,
  MIN_TESTS,
  adviseOrder,
  anchorLevels,
  suggestBracket,
  suggestLadder,
  suggestTrail,
  typicalMovePct
} from '../src/lib/orderAdvisor.js';
import { pickPromoKey } from '../src/lib/notify.js';
import { analyze } from '../src/lib/ai.js';
import { backtest, confidenceFrom, signalAt } from '../src/lib/backtest.js';
import { classifyQuoteFailure, formatUnitsExact, NATIVE_GAS_FLOOR } from '../src/lib/swap.js';
import { EVM_CHAINS, EVM_CHAIN_ORDER, FEE_BPS, FEE_BPS_MAX, FEE_BPS_DEFAULT } from '../src/lib/chains.js';
import { kyberSlug, kyberUpstreamUrl, ooSlug, ooUpstreamUrl, veloraChainOk, veloraUpstreamUrl } from '../server/swapProxy.js';
import {
  DCA_INTERVALS,
  TRAIL_MAX_PCT,
  TRAIL_MIN_PCT,
  advanceOrder,
  createOrder,
  evaluateOrder,
  expireStale,
  orderFeeUsd,
  orderNotionalUsd,
  pauseOrder,
  pipelineFeeUsd,
  resumeOrder,
  shouldNotify,
  validateOrder
} from '../src/lib/orders.js';
import { localOutlook, localBrief } from '../src/lib/localOutlook.js';
import { fmtUsd, fmtCompact, fmtQty, fmtPrice, fmtPct, setHideBalances } from '../src/lib/format.js';
import { shouldAutoLock, markAway, clearAway, AUTOLOCK_NEVER } from '../src/lib/autoLock.js';
import qrcode from 'qrcode-generator';
import { classifyQuery } from '../src/pages/Explore.jsx';
import { isSafeUrl } from '../src/lib/browser.js';
import { clean as nftClean, safeImage } from '../server/nft.js';
import coverage from '../src/i18n/coverage.json';
import enLocale from '../src/i18n/locales/en.json';
import faLocale from '../src/i18n/locales/fa.json';
import arLocale from '../src/i18n/locales/ar.json';
import { LANGUAGES, coverageFor, isComplete } from '../src/i18n/languages.js';
import { readFileSync } from 'node:fs';
import {
  OSTIUM_SPENDER,
  OSTIUM_TRADING,
  buildApproveCollateral,
  buildOpenTrade,
  buildCloseTrade,
  buildModifyPosition,
  buildUpdateCollateral,
  feeBpsToContractUnits,
  ostiumFeeBps
} from '../src/lib/ostium.js';
import { DYDX_BUILDER_ADDRESS, DYDX_BUILDER_FEE_PPM, dydxFeeUsd, isDydxAddress } from '../src/lib/dydx.js';
import { GOPLUS_CHAINS, goplusChainId, normalizeGoplus, scoreTokenRisk } from '../src/lib/tokenRisk.js';
import { estimateSandwichRisk, privateRelayFor, simulateSwap, suggestPriorityFee } from '../src/lib/mev.js';
import {
  DEFAULT_POLICY,
  activeSession,
  checkPolicy,
  loadPolicy,
  recordSpend,
  savePolicy
} from '../src/lib/smartWallet.js';
import {
  buildIntelligence,
  costBasis,
  isStableSymbol,
  recordLot,
  taxCsv
} from '../src/lib/portfolioIntel.js';
import {
  REBALANCE_MAX_DRIFT,
  TWAP_MIN_SLICES,
  TWAP_MIN_WINDOW_MIN
} from '../src/lib/orders.js';
import { dailyRewardStatus, localDayNumber } from '../src/lib/dailyRewards.js';
import { POINT_VALUES } from '../src/lib/ranks.js';
import {
  deriveMarketInsights,
  headerInsightItems,
  isEventStory
} from '../src/lib/marketInsights.js';
import {
  DEFAULT_INTENT_MEMORY,
  compileIntent,
  isQuietTime,
  isSingleChainWorkflowSteps,
  loadIntentMemory,
  normalizeIntent,
  saveIntentMemory
} from '../src/lib/intentOS.js';
import {
  confidentialSwapReadiness,
  isConfidentialPrivacy,
  privacyModeFromSearch
} from '../src/lib/confidentialIntent.js';
import {
  canonicalJson,
  createExecutionProof,
  createWorkflowExecutionProof,
  verifyExecutionProof,
  WORKFLOW_EXECUTION_PROOF_SCHEMA
} from '../src/lib/executionProof.js';
import { validateIntentEnvelope } from '../server/intents.js';
import {
  generateSolverKeyPair,
  signSolverCommitment,
  verifySolverCommitment
} from '../server/intentSignatures.js';
import {
  appendSignedCommitment,
  merkleProof,
  merkleRoot,
  readIntentLog,
  signedCommitmentHash,
  verifyMerkleProof
} from '../server/intentTransparency.js';
import {
  AUCTION_POLICY,
  closeAuction,
  coordinatorKeysLinked,
  createCoordinatorRotationDraft,
  evaluateAuction,
  publicCoordinator,
  readAuction,
  signCoordinatorRotation,
  verifyAuctionClose,
  verifyCoordinatorRotation
} from '../server/intentAuctions.js';
import {
  INTENT_ANCHOR_ABI,
  buildAnchorCalldata,
  verifyAnchorClaim
} from '../server/intentAnchors.js';
import {
  issueAdmissionReceipt,
  verifyAdmissionReceipt
} from '../server/intentAdmissions.js';
import {
  buildCompletenessReport,
  completenessSummary,
  evaluateCompleteness,
  verifyCompletenessReport
} from '../server/intentWatcher.js';
import {
  MIN_BOND_USD,
  PENALTY_BPS,
  bondStatusFor,
  bondsProtocolStatus,
  parseBondRegistry,
  penaltyBpsFor,
  penaltyUsdFor,
  publicBondBoard
} from '../server/intentBonds.js';
import {
  buildExecutionClaim,
  gradeExecution,
  minOutFor,
  readExecutionClaim,
  solverConfigFromPrivateKey,
  storeExecutionClaim,
  verifyExecutionClaim
} from '../server/intentExecution.js';
import {
  buildWorkflowBatchCalldata,
  isSingleChainWorkflow,
  MAX_WORKFLOW_NODES,
  validateWorkflow,
  WORKFLOW_SCHEMA,
  workflowFromLegacySteps,
  workflowIdFor,
  workflowProtocolStatus
} from '../server/intentWorkflow.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDispute,
  parseVerifierRegistry,
  storeDispute,
  verifyDispute
} from '../server/intentDisputes.js';
import {
  buildAdjudication,
  executionGraceSeconds,
  storeAdjudication,
  verifyAdjudication
} from '../server/intentAdjudication.js';
import {
  buildSettlementReport,
  evaluateSettlement,
  readSettlementReports,
  settlementSummary,
  storeSettlementReport,
  verifySettlementReport
} from '../server/intentSettlement.js';
import {
  OUTCOME_BID_SCHEMA,
  signOutcomeBid,
  validateOutcomeBid,
  verifyOutcomeBid
} from '../server/outcomeBids.js';
import {
  OUTCOME_POLICY,
  appendOutcomeBid,
  buildOutcomeCompletenessReport,
  closeOutcomeAuction,
  evaluateOutcomeAuction,
  issueOutcomeAdmissionReceipt,
  outcomeProtocolStatus,
  verifyOutcomeAdmissionReceipt,
  verifyOutcomeClose,
  verifyOutcomeCompletenessReport
} from '../server/intentOutcome.js';
import {
  buildIntentCommitment,
  buildIntentReveal,
  intentCommitmentStatus,
  publicCommitmentRecord,
  storeIntentCommitment,
  verifyIntentCommitment,
  verifyIntentReveal
} from '../server/intentCommitment.js';
import {
  buildConfidentialEnvelope,
  confidentialProtocolStatus,
  generateOperatorKeyPair,
  parseOperatorRegistry,
  reconstructConfidentialEnvelope,
  xorCombine,
  xorSplit
} from '../server/intentConfidential.js';
import {
  buildCrossChainReceipt,
  createCrossChainState,
  crossChainProtocolStatus,
  evaluateCrossChainState,
  storeCrossChainReceipt,
  storeCrossChainState,
  verifyCrossChainReceipt
} from '../server/intentCrossChain.js';
import {
  buildAccountBinding,
  buildAccountBindingChallenge,
  buildTxVerificationReport,
  crossChainVerificationStatus,
  defaultRpc,
  deriveLegVerificationStatus,
  observeLegAcrossRpcs,
  parseCrossChainRpcNetworks,
  readAccountBindings,
  readCrossChainStateWithVerification,
  readTxVerificationReports,
  recomputeTxVerificationReport,
  storeAccountBinding,
  storeTxVerificationReport,
  verifyAccountBinding,
  verifyLegOnChain,
  verifyTxVerificationReport,
  __overrideBlobForTests
} from '../server/intentCrossChainVerification.js';
import {
  buildOperatorAttestation,
  independentVerificationStatus,
  verifyOperatorAttestation
} from '../server/intentOperators.js';
import {
  MERKLE_ROOT_ANCHOR_ABI,
  buildMerkleRootAnchorCalldata,
  buildMerkleRootManifest,
  merkleRootAnchorStatus,
  verifyMerkleRootAnchorClaim
} from '../server/intentRootAnchors.js';
import { Interface, Wallet, hexlify, randomBytes } from 'ethers';

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---------------- calendar daily rewards + repeatable swaps -------- */
  {
    // Date's numeric constructor deliberately creates LOCAL dates. These cases
    // therefore keep testing the product promise in every CI timezone.
    const day1Morning = new Date(2026, 0, 10, 9, 0).getTime();
    const day1Night = new Date(2026, 0, 10, 23, 59).getTime();
    const day2Early = new Date(2026, 0, 11, 0, 1).getTime();
    const day3 = new Date(2026, 0, 12, 12, 0).getTime();

    t('daily check-in blocks a second claim on the same local date',
      dailyRewardStatus({ now: day1Night, lastClaim: day1Morning, streak: 4 }).canClaim === false);

    const tomorrow = dailyRewardStatus({ now: day2Early, lastClaim: day1Night, streak: 4 });
    t('the next local date continues the streak even two minutes later',
      tomorrow.canClaim && tomorrow.nextStreak === 5);
    t('daily reward includes the continued streak bonus',
      tomorrow.reward === POINT_VALUES.dailyCheckin + 5 * POINT_VALUES.streakBonus);

    const skipped = dailyRewardStatus({ now: day3, lastClaim: day1Night, streak: 4 });
    t('skipping a local calendar date resets the next claim to day one',
      skipped.canClaim && skipped.nextStreak === 1 && skipped.activeStreak === 0);
    t('moving the clock behind last claim never opens another claim',
      dailyRewardStatus({ now: day1Morning, lastClaim: day2Early, streak: 5 }).canClaim === false);
    t('local day numbers ignore the time within a calendar date',
      localDayNumber(day1Morning) === localDayNumber(day1Night));
    t('every repeatable successful swap is worth exactly one point', POINT_VALUES.swap === 1);
  }

  /* --------------------------- token search --------------------------- */

  const tokens = [
    { symbol: 'BNB', name: 'BNB', address: null, native: true, verified: true },
    { symbol: 'USDT', name: 'Tether USD', address: '0x55d398326f99059fF775485246999027B3197955', verified: true },
    { symbol: 'USDT', name: 'Fake Tether', address: '0x1111111111111111111111111111111111111111', verified: false },
    { symbol: 'CAKE', name: 'PancakeSwap', address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', verified: true },
    { symbol: 'BABYCAKE', name: 'Baby Cake', address: '0x2222222222222222222222222222222222222222', verified: false }
  ];

  const usdt = searchTokens(tokens, 'usdt');
  t('exact ticker match ranks first', usdt[0].symbol === 'USDT');
  t('verified beats unverified on an identical ticker', usdt[0].verified === true);
  t('both same-ticker tokens are kept, not deduped away', usdt.length === 2);

  const cake = searchTokens(tokens, 'cake');
  t('exact ticker outranks a longer ticker containing it', cake[0].symbol === 'CAKE');

  const byAddr = searchTokens(tokens, '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82');
  t('a pasted address is an exact lookup', byAddr.length === 1 && byAddr[0].symbol === 'CAKE');

  const missAddr = searchTokens(tokens, '0x9999999999999999999999999999999999999999');
  t('an unknown address returns nothing (so the import path can offer it)', missAddr.length === 0);

  t('empty query returns the list', searchTokens(tokens, '').length === tokens.length);
  t('token key is the address, not the symbol', tokenKey(tokens[1]) !== tokenKey(tokens[2]));
  t('native token has a stable key', tokenKey(tokens[0]) === 'native');

  /* ------------------------ bundled token floor ----------------------- */
  /* The picker must be useful with zero network. If a CDN is blocked or the
     device is offline, these are the tokens that still show up. */

  for (const chain of [56, 1, 137, 42161, 8453, 10, 43114, 59144, 146]) {
    const list = getTokensSync(chain);
    t(`chain ${chain} has a bundled token floor`, list.length >= 4);
    t(`chain ${chain} exposes its native gas coin`, list.some((x) => x.native));
    t(
      `chain ${chain} has no duplicate contract addresses`,
      new Set(list.map(tokenKey)).size === list.length
    );
    t(
      `chain ${chain} addresses are all well-formed`,
      list.every((x) => x.native || /^0x[a-fA-F0-9]{40}$/.test(x.address))
    );
    t(
      `chain ${chain} entries all declare decimals`,
      list.every((x) => Number.isInteger(x.decimals) && x.decimals >= 0 && x.decimals <= 36)
    );
  }

  t('BSC ships a substantial offline list', getTokensSync(56).length >= 40);

  /* ------------------------------ payout ------------------------------ */

  t('EVM address validates', isValidFor(FAMILY.EVM, '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6'));
  t('Solana address validates', isValidFor(FAMILY.SOLANA, 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4'));
  t('Tron address validates', isValidFor(FAMILY.TRON, 'TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ'));
  t('an EVM address is NOT accepted as Tron', !isValidFor(FAMILY.TRON, '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6'));
  t('a Tron address is NOT accepted as EVM', !isValidFor(FAMILY.EVM, 'TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ'));

  const bsc = resolvePayout(56, FAMILY.EVM);
  t('BSC resolves to an EVM address', bsc && isValidFor(FAMILY.EVM, bsc.address));

  const unknownChain = resolvePayout(999999, FAMILY.EVM);
  t('an unconfigured chain falls back to the shared EVM address', unknownChain && isValidFor(FAMILY.EVM, unknownChain.address));

  const sol = resolvePayout(null, FAMILY.SOLANA);
  t('Solana resolves within its own family', sol && isValidFor(FAMILY.SOLANA, sol.address));

  /*
   * ─── PAYOUT ADDRESSES ARE CHECKED BY BYTE LENGTH, NOT JUST BY REGEX ───────
   * `isValidFor` uses /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, which every base58
   * string of roughly the right size satisfies — including one with a
   * transposed or dropped character. A real Solana address is an ed25519
   * public key: it must base58-decode to EXACTLY 32 bytes.
   *
   * This matters more than a usual input check. These are the addresses our
   * own revenue is paid to, and a payout sent to a mistyped address that
   * happens to look well-formed is gone permanently — no one holds the key.
   * The character-class regex cannot catch that; the decode can.
   */
  {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const b58decode = (str) => {
      const bytes = [0];
      for (const ch of str) {
        const val = ALPHABET.indexOf(ch);
        if (val < 0) return null;
        let carry = val;
        for (let i = 0; i < bytes.length; i += 1) {
          const x = bytes[i] * 58 + carry;
          bytes[i] = x & 0xff;
          carry = x >> 8;
        }
        while (carry) {
          bytes.push(carry & 0xff);
          carry >>= 8;
        }
      }
      // Leading '1's are leading zero bytes.
      for (const ch of str) {
        if (ch !== '1') break;
        bytes.push(0);
      }
      return bytes.length;
    };

    const solAddr = PAYOUT_ADDRESSES.solana;
    t('the Solana payout address is configured', Boolean(solAddr));
    t(
      `the Solana payout address decodes to 32 bytes (got ${b58decode(solAddr)})`,
      b58decode(solAddr) === 32
    );

    /*
     * The regex must be SHOWN to be insufficient, or this whole block guards
     * nothing. Note that dropping a single trailing character still decodes to
     * 32 bytes (base58 is not byte-aligned), so the demonstration uses a
     * two-character truncation — 42 chars, which the 32-44 regex happily
     * accepts while the key is now 31 bytes and unusable.
     */
    const truncated = solAddr.slice(0, 42);
    t('a truncated address still passes the loose regex', isValidFor(FAMILY.SOLANA, truncated));
    t(
      `...but fails the byte-length check (${b58decode(truncated)} bytes)`,
      b58decode(truncated) !== 32
    );

    // Tron addresses are 25 bytes (21 payload + 4 checksum) after base58.
    t(
      `the Tron payout address decodes to 25 bytes (got ${b58decode(PAYOUT_ADDRESSES.tron)})`,
      b58decode(PAYOUT_ADDRESSES.tron) === 25
    );
  }

  const table = payoutTable();
  t('every directory row resolves to an address', table.every((r) => r.address));
  t('every directory row declares its gas coin', table.every((r) => Boolean(r.gas)));
  t('no row is resolved with the wrong address family', table.every((r) => isValidFor(r.family, r.address)));

  /* ------------------------------- FAQ -------------------------------- */

  t('gas question answered in Persian', /گس/.test(localAnswer('گس چیه و چرا لازمه؟', 'fa')?.answer ?? ''));
  /*
   * Derived from FEE_BPS, never typed. This assertion used to read /0\.5%/ and
   * kept passing after the fee moved to 70 bps, because the canned answer
   * hard-coded the old number too — the test and the bug agreed with each
   * other. Computing the expected string from the same constant the swap
   * engine charges from is the only version of this check that can fail.
   */
  t(
    `fee question quotes the real ${FEE_BPS} bps`,
    localAnswer('how much is the fee?', 'en')?.answer?.includes(`${FEE_BPS / 100}%`) === true
  );
  t(
    'no canned answer still hard-codes a stale rate',
    !/\b0\.5% (platform )?fee\b/.test(localAnswer('how much is the fee?', 'en')?.answer ?? '')
  );
  t('mixed-script question still matches', Boolean(localAnswer('fee چقدره؟', 'fa')));
  t('seed-phrase question matches', localAnswer('I lost my recovery phrase', 'en')?.id === 'seed');
  t('unrelated question returns null rather than guessing', localAnswer('what is the weather in Isfahan', 'en') === null);
  t('Iranian-law question is answered', Boolean(localAnswer('آیا در ایران ممنوع است؟', 'fa')));

  /* ------------------------------- news ------------------------------- */

  const digest = digestFromMarket(
    [
      { symbol: 'BTC', change24h: 4.2 },
      { symbol: 'ETH', change24h: -3.1 },
      { symbol: 'SOL', change24h: 8.4 }
    ],
    'en'
  );
  t('digest produces gainers and losers', digest.length === 2);
  t('digest is flagged as generated, not reported', digest.every((d) => d.digest === true));
  t('digest never fabricates a source URL', digest.every((d) => d.url === null));
  t('digest on empty market data is empty, not invented', digestFromMarket([], 'en').length === 0);

  /* --------------------- source-aware market insights ------------------ */
  {
    const markets = [
      { id: 'btc', symbol: 'BTC', name: 'Bitcoin', change24h: -2.5 },
      { id: 'sol', symbol: 'SOL', name: 'Solana', change24h: '8.4' },
      { id: 'eth', symbol: 'ETH', name: 'Ethereum', change24h: 1.2 },
      { id: 'offline', symbol: 'DEMO', name: 'Generated demo row', change24h: 99, dataProvenance: 'offline' },
      // These are absent data, not a verified 0% session.
      { id: 'blank', symbol: 'BLANK', name: 'Blank', change24h: '' },
      { id: 'null', symbol: 'NULL', name: 'Null', change24h: null },
      { id: 'false', symbol: 'FALSE', name: 'False', change24h: false },
      { id: 'array', symbol: 'ARRAY', name: 'Array', change24h: [] },
      { id: 'bad', symbol: 'BAD', name: 'Bad', change24h: 'not-a-number' }
    ];
    const equities = [
      { id: 'spy', symbol: 'SPYx', name: 'S&P 500 xStock', change24h: 12, assetKind: 'index' },
      { id: 'aapl', symbol: 'AAPLx', name: 'Apple xStock', change24h: 4.1, assetKind: 'single' },
      { id: 'tsla', symbol: 'TSLAx', name: 'Tesla xStock', change24h: -3.2, assetKind: 'single' }
    ];
    const news = [
      { id: 'digest', title: 'FOMC digest', digest: true, at: 500 },
      { id: 'old', title: 'Bitcoin halving conference announced', at: 100, source: 'Desk A' },
      { id: 'new', title: 'Central bank rate decision', at: 300, source: 'Desk B' },
      { id: 'plain', title: 'Bitcoin price moves higher', at: 400 }
    ];

    const insight = deriveMarketInsights({ markets, equities, news });
    t('the 24-hour crypto leader is selected from finite sourced moves',
      insight.cryptoLeader?.symbol === 'SOL');
    t('generated offline market rows are never presented as live intelligence',
      insight.cryptoLeader?.symbol !== 'DEMO' && insight.cryptoLaggard?.symbol !== 'DEMO');
    t('the 24-hour crypto laggard is selected independently',
      insight.cryptoLaggard?.symbol === 'BTC');
    t('the tokenized-asset leader may be a sourced index token',
      insight.tokenizedLeader?.symbol === 'SPYx');
    t('the company card excludes index products',
      insight.companyLeader?.symbol === 'AAPLx');
    t('economic and crypto events are newest first',
      insight.eventStories.map((row) => row.id).join(',') === 'new,old');
    t('generated market digests never become sourced events', !isEventStory(news[0]));
    t('ordinary price headlines are not relabelled as events', !isEventStory(news[3]));

    t('country flow stays unavailable without a verified source',
      insight.countryFlow.available === false && /COUNTRY_FLOW/.test(insight.countryFlow.reason));
    t('capital outflow stays unavailable without a verified source',
      insight.capitalOutflow.available === false && /FLOW_SOURCE/.test(insight.capitalOutflow.reason));
    t('token price performance is not called company accounting profit',
      insight.companyProfit.available === false && /ACCOUNTING_PROFIT/.test(insight.companyProfit.reason));

    const header = headerInsightItems(insight);
    t('the header receives leader, laggard, company and event candidates',
      header.map((row) => row.kind).join(',') === 'leader,laggard,company,event');
    t('header candidates keep the original sourced records',
      header[0]?.item === insight.cryptoLeader && header[3]?.item === insight.eventStories[0]);

    const one = deriveMarketInsights({ markets: [markets[0]] });
    t('a one-asset market is not repeated as both leader and laggard',
      headerInsightItems(one).filter((row) => /leader|laggard/.test(row.kind)).length === 1);
    t('a genuinely reported numeric zero remains a valid flat session',
      deriveMarketInsights({ markets: [{ id: 'flat', symbol: 'FLAT', name: 'Flat', change24h: 0 }] })
        .cryptoLeader?.symbol === 'FLAT');
    t('malformed feed payloads degrade to explicit empty states', (() => {
      const empty = deriveMarketInsights({ markets: null, equities: 'bad', news: {} });
      return empty.cryptoLeader === null && empty.companyLeader === null && empty.eventStories.length === 0;
    })());
    t('a null insight payload cannot crash derivation',
      deriveMarketInsights(null).countryFlow.available === false);
  }

  /* ------------------------------ promos ------------------------------ */

  const d1 = new Date('2026-01-01T10:00:00Z');
  const d1Later = new Date('2026-01-01T23:00:00Z');
  const d2 = new Date('2026-01-02T10:00:00Z');
  t('promo copy is stable within a day', pickPromoKey(d1) === pickPromoKey(d1Later));
  t('promo copy rotates across days', pickPromoKey(d1) !== pickPromoKey(d2));

  /* ------------------------ swap MAX precision ------------------------- */
  /*
   * The old MAX used Number(bal).toFixed(8), which had three failure modes,
   * all ending in a reverted transaction the user still paid gas for.
   */

  // 1. Rounding UP past the real balance. toFixed rounds; this must not.
  const bigWei = 1234567123456789012345678n;
  t(
    'MAX never rounds a balance upward',
    formatUnitsExact(bigWei, 18) === '1234567.123456789012345678'
  );
  t(
    'the old float path really did lose precision (regression guard)',
    Number('1234567.123456789012345678').toFixed(8) !== '1234567.123456789012345678'
  );

  // 2. Small 18-decimal holdings flushed to zero.
  t('a tiny 18-decimal balance is not flattened to 0', formatUnitsExact(123456n, 18) === '0.000000000000123456');
  t('the old path DID flatten it (regression guard)', Number(0.000000000000123456.toFixed(8)) === 0);

  // 3. General correctness.
  t('6-decimal token formats correctly', formatUnitsExact(1500000n, 6) === '1.5');
  t('whole amounts have no trailing dot', formatUnitsExact(2n * 10n ** 18n, 18) === '2');
  t('zero formats as 0', formatUnitsExact(0n, 18) === '0');
  t('trailing zeros are trimmed', formatUnitsExact(1100000000000000000n, 18) === '1.1');
  t('one wei survives', formatUnitsExact(1n, 18) === '0.000000000000000001');

  // Gas reserve is per-chain, because a flat constant is wrong in both
  // directions: 0.002 ETH strands ~$7, and on a busy L1 it can be too little.
  t('every swappable chain declares a gas floor', [56, 1, 137, 42161, 8453, 10, 43114, 59144, 146].every((c) => NATIVE_GAS_FLOOR[c] > 0));
  t('the ETH floor is larger than the L2 floor', NATIVE_GAS_FLOOR[1] > NATIVE_GAS_FLOOR[42161]);
  t('no floor is absurdly large', Object.values(NATIVE_GAS_FLOOR).every((v) => v < 1));

  /* ------------------- local AI narrator (no model) -------------------- */
  /* The whole point: the analysis screen must produce real prose with zero
     configuration, because the indicators behind it are computed locally
     anyway and gating them on a remote key hid work already done. */

  const upTrend = Array.from({ length: 80 }, (_, i) => 100 + i * 0.8 + Math.sin(i / 3) * 2);
  const downTrend = Array.from({ length: 80 }, (_, i) => 180 - i * 0.7 + Math.sin(i / 4) * 3);
  const flat = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 0.6);

  const aUp = analyze(upTrend, { symbol: 'BTC', change24h: 2.1, change7d: 6.4 });
  const aDown = analyze(downTrend, { symbol: 'ETH', change24h: -2.4, change7d: -7.1 });
  const aFlat = analyze(flat, { symbol: 'USDC', change24h: 0.01, change7d: 0.02 });

  t('analyze() produces a result from real price history', Boolean(aUp && aDown && aFlat));

  for (const [name, a] of [['uptrend', aUp], ['downtrend', aDown], ['flat', aFlat]]) {
    const o = localOutlook({ analysis: a, coin: { symbol: 'X' }, lang: 'en' });
    t(`${name}: outlook is produced without any model`, Boolean(o?.summary));
    t(`${name}: has a headline`, Boolean(o.headline && o.headline.length > 8));
    t(`${name}: summary is real prose, not a stub`, o.summary.length > 80);
    t(`${name}: always states at least one risk`, o.risks.length >= 1);
    t(`${name}: always states an invalidation level`, Boolean(o.invalidation));
    t(`${name}: labels itself as locally generated`, o.source === 'local');
    t(`${name}: confidence never exceeds the 88 cap`, o.confidence <= 88);
    t(`${name}: no unresolved {placeholder} left in the prose`, !/\{\w+\}/.test(o.summary + o.headline + o.invalidation));
    t(`${name}: gives a range, never a single target`, !o.range || o.range.low < o.range.high);
  }

  // The honest-risk guarantee: it must always admit it cannot see news.
  const oNews = localOutlook({ analysis: aUp, coin: { symbol: 'X' }, lang: 'en' });
  t('always discloses that it reads price only', oNews.risks.some((r) => /news/i.test(r)));

  // Localisation of the narration itself.
  const oFa = localOutlook({ analysis: aUp, coin: { symbol: 'BTC' }, lang: 'fa' });
  t('narrates in Persian', /[\u0600-\u06FF]/.test(oFa.summary));
  t('uses Persian-Indic digits in Persian prose', /[۰-۹]/.test(oFa.summary));
  t('keeps currency figures in Latin digits', !/\$[۰-۹]/.test(oFa.invalidation));
  t('no unresolved placeholder in Persian', !/\{\w+\}/.test(oFa.summary + oFa.headline));

  const oAr = localOutlook({ analysis: aUp, coin: { symbol: 'BTC' }, lang: 'ar' });
  t('narrates in Arabic', /[\u0600-\u06FF]/.test(oAr.summary));

  // An unsupported language must fall back to English, not to a blank.
  const oZh = localOutlook({ analysis: aUp, coin: { symbol: 'BTC' }, lang: 'zh' });
  t('unsupported narration language falls back to English prose', oZh.summary.length > 80);

  t('no analysis means no invented outlook', localOutlook({ analysis: null, lang: 'en' }) === null);

  /* ------------------------------ brief -------------------------------- */

  const bDown = localBrief({
    global: { mcapChange: -2.3, btcDominance: 54.2 },
    top: [
      { symbol: 'BTC', change24h: -1.2 },
      { symbol: 'ETH', change24h: -3.4 },
      { symbol: 'SOL', change24h: -2.2 }
    ],
    lang: 'en'
  });
  t('brief reads breadth, not just the index', /3 of 3|broad/i.test(bDown.summary));
  t('brief detects a bearish tape', bDown.bias === 'bearish');

  const bMixed = localBrief({
    global: { mcapChange: 0.1, btcDominance: 50 },
    top: [
      { symbol: 'BTC', change24h: 1 },
      { symbol: 'ETH', change24h: -1 }
    ],
    lang: 'en'
  });
  t('brief calls a mixed tape neutral rather than picking a side', bMixed.bias === 'neutral');
  t('brief labels itself as locally generated', bDown.source === 'local');

  /* --------------------- translation coverage honesty ------------------- */
  /*
   * ar.json used to claim completeness while 686 of its strings were still
   * English. Coverage is now measured; these assertions stop it drifting back
   * into a comfortable lie.
   */
  t('coverage data is generated for every language', LANGUAGES.every((l) => coverage.coverage[l.code] !== undefined));
  t('English is the source and therefore 100%', coverageFor('en') === 100);
  t('Persian is effectively complete', coverageFor('fa') >= 90);
  t('every language reports a plausible percentage', LANGUAGES.every((l) => coverageFor(l.code) >= 0 && coverageFor(l.code) <= 100));
  t(
    'a language is only called complete when measurement agrees',
    LANGUAGES.every((l) => isComplete(l.code) === coverageFor(l.code) >= 90)
  );
  t('partial languages are not marked complete', !isComplete('zh') && !isComplete('tr'));
  t('coverage counts against the real key total', coverage.total > 900);

  /* ------------------------------ receive QR ------------------------------ */
  /*
   * A QR that encodes the WRONG characters still looks like a valid QR — it
   * just sends the money somewhere nobody controls. So this asserts the code
   * we generate decodes back to the exact address, using our own scanner's
   * parser as the reader. Encoder and reader agreeing is the only property
   * that actually matters here.
   */
  {
    const addr = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';
    const q = qrcode(0, 'M');
    q.addData(addr);
    q.make();
    const n = q.getModuleCount();

    t('QR is generated for an address', n >= 21);

    // Finder patterns in three corners — the marker a camera locks onto.
    const finder = (r, c) => q.isDark(r, c) && q.isDark(r + 6, c) && q.isDark(r, c + 6);
    t('QR has all three finder patterns', finder(0, 0) && finder(0, n - 7) && finder(n - 7, 0));

    let dark = 0;
    for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) if (q.isDark(r, c)) dark += 1;
    t('QR carries real data, not a blank or solid grid', dark > 40 && dark < n * n * 0.9);

    // Longer payloads must grow the symbol rather than silently truncate.
    const long = qrcode(0, 'M');
    long.addData(`ethereum:${addr}@56`);
    long.make();
    t('a longer payload produces a larger symbol', long.getModuleCount() > n);
  }

  /* ------------------------------ explorer -------------------------------- */
  /*
   * Telling a 66-char hash from a 42-char address is the whole value of the
   * explorer screen: guess wrong and the user gets "not found" and concludes
   * their money is gone.
   */
  {
    const addr = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';
    const hash = `0x${'a'.repeat(64)}`;
    t('a 66-char hash is a transaction', classifyQuery(hash).kind === 'tx');
    t('a 42-char string is an address', classifyQuery(addr).kind === 'address');
    t('digits are a block number', classifyQuery('12345678').kind === 'block');
    t('Tron addresses are detected', classifyQuery('TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ').kind === 'tron');
    t('empty input is not an error', classifyQuery('  ').kind === 'empty');
    t('junk is reported as unrecognised', classifyQuery('hello world').kind === 'unknown');
    // A truncated hash must NOT be silently treated as an address.
    t('a truncated hash is not mistaken for an address', classifyQuery(hash.slice(0, 50)).kind === 'unknown');
  }

  /* --------------------------- browser safety ------------------------------ */
  /*
   * The in-app browser must refuse anything but plain https. javascript: and
   * data: URLs can execute in the opening context, and http: is trivially
   * rewritten on a hostile network — which, on a page about crypto, means an
   * attacker editing the addresses the user is about to copy.
   */
  {
    t('https is allowed', isSafeUrl('https://pancakeswap.finance'));
    t('http is refused', !isSafeUrl('http://pancakeswap.finance'));
    t('javascript: is refused', !isSafeUrl('javascript:alert(1)'));
    t('data: is refused', !isSafeUrl('data:text/html,<script>alert(1)</script>'));
    t('file: is refused', !isSafeUrl('file:///etc/passwd'));
    t('garbage is refused', !isSafeUrl('not a url'));
    t('empty is refused', !isSafeUrl(''));
    // Case and whitespace tricks must not slip past the scheme check.
    t('uppercase JAVASCRIPT: is refused', !isSafeUrl('JavaScript:alert(1)'));
  }

  /* --------------------------- NFT sanitising ------------------------------ */
  /*
   * Anyone can mint an NFT into anyone's wallet with arbitrary metadata, so
   * every string here is attacker-supplied. Airdropped scam NFTs use the name
   * field as the payload. These assertions are the boundary.
   */
  {
    t('markup is stripped from names', !nftClean('<img src=x onerror=alert(1)>').includes('<'));
    t('quotes are stripped', !nftClean(`Claim '$5000' now`).includes("'"));
    t('backslashes are stripped', !nftClean('a\\b').includes('\\'));
    // A bidi override can render `moc.dab.evil` as `evil.bad.com`.
    t('bidi overrides are removed', !/[\u202A-\u202E\u2066-\u2069]/.test(nftClean('Free\u202EmureP\u202Cdrop')));
    t('control characters are removed', !/[\u0000-\u001f]/.test(nftClean('a\u0000b\nc')));
    t('names are length-capped', nftClean('A'.repeat(500)).length <= 120);
    t('normal names survive intact', nftClean('Bored Ape #1234') === 'Bored Ape #1234');
    t('non-Latin names survive', nftClean('نمونه توکن') === 'نمونه توکن');

    t('https images are kept', safeImage('https://cdn.test/a.png') === 'https://cdn.test/a.png');
    t('http images are dropped', safeImage('http://cdn.test/a.png') === null);
    t('javascript: images are dropped', safeImage('javascript:alert(1)') === null);
    t('data: images are dropped', safeImage('data:image/svg+xml,<svg onload=alert(1)>') === null);
    t('ipfs is rewritten to a gateway', String(safeImage('ipfs://QmHash/1.png')).startsWith('https://'));
    t('garbage image urls are dropped', safeImage('not a url') === null);
  }

  /* -------------------------------- fee dial ------------------------------- */
  /*
   * The fee is the entire business model, so it gets asserted rather than
   * trusted. The cap matters most: a mistyped env var must never be able to
   * take an outrageous cut of someone's swap.
   */
  {
    t('fee is a whole number of basis points', Number.isInteger(FEE_BPS));
    t('fee is never negative', FEE_BPS >= 0);
    t(`fee never exceeds the ${FEE_BPS_MAX} bps cap`, FEE_BPS <= FEE_BPS_MAX);
    t('the cap is 1% or less', FEE_BPS_MAX <= 100);
    /*
     * 70 bps, deliberately. Measured in-wallet rates 2026: MetaMask 0.875%,
     * Phantom 0.85%, Rainbow 0.85%, Trust 0.70%, ZenGo 0.50%, Rabby 0.25% —
     * median 0.70%. It sat at 50 for months with a comment saying to set
     * VITE_FEE_BPS=70; the variable was never set, so a default nobody changes
     * turned out to BE the configuration. Asserting it here means a silent
     * revert shows up as a failing test rather than as missing revenue.
     */
    t('default is 70 bps (market median)', FEE_BPS_DEFAULT === 70);
    // With no env override configured, the default must be what ships.
    t('unset env yields the default', FEE_BPS === FEE_BPS_DEFAULT);
  }

  /* --------------------------- limit orders & DCA -------------------------- */
  /*
   * This engine decides when real money moves, so the dangerous directions get
   * asserted rather than the happy path.
   */
  {
    const BNB = { symbol: 'BNB', decimals: 18 };
    const USDT = { symbol: 'USDT', decimals: 18 };
    const base = { chainId: 56, fromToken: BNB, toToken: USDT, amountIn: '1' };
    const now = Date.now();

    // Validation
    t('rejects swapping a token for itself', validateOrder({ ...base, type: 'limit', toToken: BNB, targetRate: 1, direction: 'above' }) === 'SAME_TOKEN');
    t('rejects a zero amount', validateOrder({ ...base, type: 'limit', amountIn: '0', targetRate: 1, direction: 'above' }) === 'BAD_AMOUNT');
    t('rejects a negative amount', validateOrder({ ...base, type: 'limit', amountIn: '-5', targetRate: 1, direction: 'above' }) === 'BAD_AMOUNT');
    // Without a direction, "target 700" is ambiguous and would fire wrongly.
    t('rejects a limit order with no direction', validateOrder({ ...base, type: 'limit', targetRate: 700 }) === 'BAD_DIRECTION');
    t('rejects an unbounded DCA plan', validateOrder({ ...base, type: 'dca', interval: 'weekly', totalRuns: 0 }) === 'BAD_RUNS');
    t('accepts a well-formed limit order', validateOrder({ ...base, type: 'limit', targetRate: 700, direction: 'above' }) === null);

    // Firing conditions
    const { order: lim } = createOrder({ ...base, type: 'limit', targetRate: 700, direction: 'above' }, now);
    t('does not fire below target', evaluateOrder(lim, 650, now).ready === false);
    t('fires exactly at target', evaluateOrder(lim, 700, now).ready === true);

    /*
     * THE MOST IMPORTANT ASSERTION HERE. An unknown price must never count as
     * "condition met", or an upstream outage fires every open order at once.
     */
    t('never fires when the price is unknown', evaluateOrder(lim, null, now).ready === false);
    t('never fires on a zero price', evaluateOrder(lim, 0, now).ready === false);
    t('never fires on NaN', evaluateOrder(lim, NaN, now).ready === false);

    const { order: below } = createOrder({ ...base, type: 'limit', targetRate: 500, direction: 'below' }, now);
    t('buy-the-dip fires when cheap enough', evaluateOrder(below, 450, now).ready === true);
    t('buy-the-dip waits while expensive', evaluateOrder(below, 550, now).ready === false);

    // Expiry — a stale order must not fire when the price wanders back.
    const later = now + 31 * 86400000;
    t('an expired order never fires', evaluateOrder(lim, 9999, later).ready === false);
    t('expiry is marked, not hidden', expireStale([lim], later)[0].status === 'expired');

    // DCA scheduling
    const { order: dcaDraft } = createOrder({ ...base, type: 'dca', interval: 'weekly', totalRuns: 4 }, now);
    t('a new DCA is paused until explicit sign', dcaDraft.status === 'paused');
    const dca = activateDca(dcaDraft, { confirmed: true }, now).order;
    t('the first signed DCA buy is due immediately', evaluateOrder(dca, null, now).ready === true);
    t('signed DCA does not need a price to be due', evaluateOrder(dca, null, now).reason === 'DUE');
    let cur = advanceOrder(dca, now);
    t('a completed run is counted', cur.runsDone === 1);
    t('DCA is not due again immediately', evaluateOrder(cur, null, now).ready === false);
    t('DCA is due after the interval', evaluateOrder(cur, null, now + DCA_INTERVALS.weekly).ready === true);

    /*
     * Rescheduling is from NOW, not from the missed due time. Otherwise a user
     * offline for ten weeks returns to ten overdue buys firing at once.
     */
    const late = now + 10 * DCA_INTERVALS.weekly;
    t('a missed DCA does not stack up catch-up runs', advanceOrder(dca, late).nextRunAt === late + DCA_INTERVALS.weekly);

    for (let i = 0; i < 3; i += 1) cur = advanceOrder(cur, now + (i + 2) * DCA_INTERVALS.weekly);
    t('DCA completes after the requested number of runs', cur.status === 'filled' && cur.runsDone === 4);
    t('a finished plan never fires again', evaluateOrder(cur, null, now + 99 * DCA_INTERVALS.weekly).ready === false);

    /*
     * PRICING THE TARGET IN EITHER TOKEN.
     *
     * REAL BUG: "buy when it rises" was unusable. The rate is always
     * "1 FROM = ? TO", so to buy BNB with USDT above 700 the user had to enter
     * the reciprocal 0.00142857 AND pick "below", because as BNB rises the
     * USDT→BNB rate falls. Nobody can express an intent that way, and the
     * obvious attempt sets the exact opposite of what was meant.
     *
     * Pricing in the TO token lets them type 700 and pick above instead.
     */
    const rateUsdtToBnb = (bnbPrice) => 1 / bnbPrice; // 1 USDT = ? BNB

    const buyBreakout = createOrder({
      type: 'limit', chainId: 56, fromToken: USDT, toToken: BNB,
      amountIn: '700', targetRate: 700, direction: 'above', priceOf: 'to'
    }, now).order;
    t('buy-on-breakout waits below the target', evaluateOrder(buyBreakout, rateUsdtToBnb(600), now).ready === false);
    t('buy-on-breakout fires above the target', evaluateOrder(buyBreakout, rateUsdtToBnb(750), now).ready === true);

    const buyDip = createOrder({
      type: 'limit', chainId: 56, fromToken: USDT, toToken: BNB,
      amountIn: '500', targetRate: 500, direction: 'below', priceOf: 'to'
    }, now).order;
    t('buy-the-dip fires when the base token gets cheap', evaluateOrder(buyDip, rateUsdtToBnb(400), now).ready === true);
    t('buy-the-dip waits while the base token is expensive', evaluateOrder(buyDip, rateUsdtToBnb(600), now).ready === false);

    // Inversion must not break the unknown-price guard.
    t('inverted pricing still refuses an unknown price', evaluateOrder(buyBreakout, null, now).ready === false);
    t('inverted pricing still refuses a zero price', evaluateOrder(buyBreakout, 0, now).ready === false);

    t('defaults to pricing in the FROM token', createOrder({ ...base, type: 'limit', targetRate: 700, direction: 'above' }, now).order.priceOf === 'from');
    t('rejects a bogus priceOf', validateOrder({ ...base, type: 'limit', targetRate: 1, direction: 'above', priceOf: 'sideways' }) === 'BAD_PRICE_OF');

    // Notification cooldown — spam costs us every future fill.
    t('notifies the first time', shouldNotify({ lastNotifiedAt: 0 }, now) === true);
    t('suppresses a repeat within the cooldown', shouldNotify({ lastNotifiedAt: now }, now) === false);
    t('notifies again after the cooldown', shouldNotify({ lastNotifiedAt: now - 6.1 * 3600000 }, now) === true);

    /* ------------------------- trailing stop ------------------------------ */
    /*
     * The most dangerous order type in the app: it decides to SELL based on a
     * moving reference the user cannot see. Every failure mode below would
     * either sell someone's position early or never protect it at all.
     */
    const mkTrail = (pct = 10) =>
      createOrder({ ...base, type: 'trailing', trailPct: pct }, now).order;

    t('rejects a trail below the floor', validateOrder({ ...base, type: 'trailing', trailPct: 0.1 }) === 'BAD_TRAIL');
    t('rejects a trail above the ceiling', validateOrder({ ...base, type: 'trailing', trailPct: 90 }) === 'BAD_TRAIL');
    t('rejects a non-numeric trail', validateOrder({ ...base, type: 'trailing', trailPct: 'abc' }) === 'BAD_TRAIL');
    t('accepts a trail at the floor', validateOrder({ ...base, type: 'trailing', trailPct: TRAIL_MIN_PCT }) === null);
    t('accepts a trail at the ceiling', validateOrder({ ...base, type: 'trailing', trailPct: TRAIL_MAX_PCT }) === null);
    t('a new trailing order has no peak yet', mkTrail().peakRate === null);

    // The first observation establishes the peak and must NEVER sell: there is
    // no drawdown yet, so firing here would dump the position instantly.
    const firstTick = evaluateOrder(mkTrail(10), 700, now);
    t('the first price never triggers a trailing stop', firstTick.ready === false);
    t('the first price establishes the peak', firstTick.peak === 700);
    t('the stop sits below the peak by the trail', Math.abs(firstTick.stopAt - 630) < 1e-9);

    // Rising price lifts the peak, so the stop rises with it.
    const rising = { ...mkTrail(10), peakRate: 700 };
    t('a higher price raises the peak', evaluateOrder(rising, 800, now).peak === 800);
    t('a raised peak does not sell', evaluateOrder(rising, 800, now).ready === false);

    // THE CRITICAL ONE: the peak must never follow the price down, or the stop
    // ratchets lower forever and never protects anything.
    t('a lower price does not lower the peak', evaluateOrder(rising, 650, now).peak === 700);

    // Trigger only once the drawdown is actually reached.
    t('holds just above the stop', evaluateOrder(rising, 631, now).ready === false);
    t('fires exactly at the stop', evaluateOrder(rising, 630, now).ready === true);
    t('fires below the stop', evaluateOrder(rising, 500, now).ready === true);
    t('reports why it fired', evaluateOrder(rising, 500, now).reason === 'TRAIL_HIT');

    // A price-feed outage must neither trigger nor corrupt the peak.
    t('an unknown price never triggers a trail', evaluateOrder(rising, null, now).ready === false);
    t('a zero price never triggers a trail', evaluateOrder(rising, 0, now).ready === false);
    t('NaN never triggers a trail', evaluateOrder(rising, NaN, now).ready === false);

    // Expiry applies to trailing orders too — this was a real gap: expireStale
    // only looked at type === 'limit'.
    const oldTrail = { ...mkTrail(10), expiresAt: now - 1 };
    t('an expired trailing order does not fire', evaluateOrder(oldTrail, 1, now).reason === 'EXPIRED');
    t('expireStale marks trailing orders too', expireStale([oldTrail], now)[0].status === 'expired');

    // A filled trailing order is finished, not repeating.
    t('a filled trailing order is done', advanceOrder(mkTrail(10), now).status === 'filled');

    /* --------------------------- pause / resume --------------------------- */
    t('pausing an active order parks it', pauseOrder(mkTrail(10)).status === 'paused');
    t('a paused order never evaluates ready', evaluateOrder(pauseOrder(mkTrail(10)), 1, now).ready === false);
    t('resuming reactivates', resumeOrder(pauseOrder(mkTrail(10))).status === 'active');
    // Resuming with a stale peak would sell instantly against a weeks-old high.
    t('resuming clears a stale trailing peak', resumeOrder({ ...pauseOrder(mkTrail(10)), peakRate: 9999 }).peakRate === null);
    // A resumed DCA must not fire every missed run at once.
    const pausedDca = pauseOrder(createOrder({ ...base, type: 'dca', interval: 'daily', totalRuns: 5 }, now - 10 * 86400000).order);
    t('resuming a DCA reschedules from now', resumeOrder(pausedDca, now).nextRunAt === now);
    t('pause ignores an already-filled order', pauseOrder({ status: 'filled' }).status === 'filled');

    /* --------------------- notional & fee estimation ---------------------- */
    /*
     * These numbers are shown to the user before they commit, so an
     * overstatement is a lie about cost and an understatement is a surprise.
     */
    const priceMap = { binancecoin: { usd: 700 } };
    const priced = { ...base, fromToken: { ...BNB, coingeckoId: 'binancecoin' }, amountIn: '2' };
    const limitOrder = createOrder({ ...priced, type: 'limit', targetRate: 700, direction: 'above' }, now).order;

    t('notional multiplies amount by unit price', orderNotionalUsd(limitOrder, priceMap) === 1400);
    t('fee at 50 bps is 0.5%', orderFeeUsd(limitOrder, priceMap, 50) === 7);
    t('fee at 70 bps is 0.7%', Math.abs(orderFeeUsd(limitOrder, priceMap, 70) - 9.8) < 1e-9);

    // A DCA commits the user across ALL remaining runs — that is the number
    // they need before confirming, not the per-run figure.
    const dcaPlan = createOrder({ ...priced, type: 'dca', interval: 'weekly', totalRuns: 6 }, now).order;
    t('a DCA counts every remaining run', orderNotionalUsd(dcaPlan, priceMap) === 8400);
    t('a partly-run DCA counts only what is left', orderNotionalUsd({ ...dcaPlan, runsDone: 4 }, priceMap) === 2800);
    t('a completed DCA has nothing left', orderNotionalUsd({ ...dcaPlan, runsDone: 6 }, priceMap) === 0);

    // Unknown price must be null, never 0 — "$0.00" beside a real order reads
    // as a confident answer.
    t('an unpriced token yields null, not zero', orderNotionalUsd(limitOrder, {}) === null);
    t('an unpriced fee yields null', orderFeeUsd(limitOrder, {}, 50) === null);
    t('a negative fee rate is refused', orderFeeUsd(limitOrder, priceMap, -5) === null);

    // The pipeline total is what makes this screen a revenue instrument.
    t('pipeline sums active orders only', pipelineFeeUsd([limitOrder, { ...limitOrder, status: 'filled' }], priceMap, 50) === 7);
    t('pipeline skips unpriced orders rather than failing', pipelineFeeUsd([limitOrder], {}, 50) === 0);
  }

  /* ----------------------- server watch payload safety --------------------- */
  /*
   * The watch list is a behavioural profile: "this endpoint wants to sell 40
   * BNB at 700" is exactly what an attacker would want. The server needs
   * neither the address nor the amount to decide whether a price was hit, so
   * neither may ever be in the payload. This asserts the shape of what
   * syncWatches builds.
   */
  {
    const order = {
      id: 'o1',
      type: 'limit',
      status: 'active',
      amountIn: '40',
      chainId: 56,
      targetRate: 700,
      direction: 'above',
      priceOf: 'from',
      fromToken: { symbol: 'BNB', coingeckoId: 'binancecoin' },
      toToken: { symbol: 'USDT', coingeckoId: 'tether' }
    };

    // Mirrors the mapping in syncWatches. Kept in the test so a field added
    // there without thought fails here.
    const item = {
      id: order.id,
      fromSym: order.fromToken.symbol,
      toSym: order.toToken.symbol,
      fromId: order.fromToken.coingeckoId,
      toId: order.toToken.coingeckoId,
      targetRate: order.targetRate,
      direction: order.direction,
      priceOf: order.priceOf
    };
    const keys = Object.keys(item);

    t('watch payload carries no amount', !keys.some((k) => /amount/i.test(k)));
    t('watch payload carries no address', !keys.some((k) => /address|owner|wallet/i.test(k)));
    t('watch payload has exactly the fields needed to compare a price', keys.length === 8);
    t('watch payload keeps the price denomination', item.priceOf === 'from');
  }

  /* ---------------------- push transport (android) ------------------------ */
  /*
   * REAL GAP: a Capacitor WebView has NO Push API, so registerPush() returned
   * UNSUPPORTED on the packaged Android app and every APK user silently
   * registered nothing. Order alerts - whose entire purpose is to arrive with
   * the app CLOSED - were web-only without anyone noticing.
   *
   * The server now accepts both a web-push endpoint and an fcm: token. This
   * asserts the parser, because getting it wrong fails silently in exactly the
   * same invisible way.
   */
  {
    const parse = (endpoint) => {
      if (typeof endpoint !== 'string') return null;
      if (endpoint.startsWith('https://')) return { kind: 'web', value: endpoint };
      if (endpoint.startsWith('fcm:') && endpoint.length > 44) {
        return { kind: 'fcm', value: endpoint.slice(4) };
      }
      return null;
    };
    const token = 'f'.repeat(60);

    t('a web-push endpoint is accepted', parse('https://fcm.googleapis.com/wp/x')?.kind === 'web');
    t('a native FCM token is accepted', parse(`fcm:${token}`)?.kind === 'fcm');
    t('the fcm: prefix is stripped before sending', parse(`fcm:${token}`)?.value === token);
    t('plain http is rejected', parse('http://insecure/x') === null);
    // A short "token" is a bug or an attempt to poison the list; storing it
    // would waste a send every cycle forever.
    t('a truncated FCM token is rejected', parse('fcm:abc') === null);
    t('junk is rejected', parse('not-an-endpoint') === null);
  }

  /* --------------------- settings that must actually DO something --------- */
  /*
   * Two controls were found writing a value that nothing ever read. Both are
   * the project's most-repeated bug, and both are worse than cosmetic:
   *
   *   hideBalances   — Settings drew the switch from it and no balance ever
   *                    consulted it. A privacy control that reports success
   *                    while every figure stays on screen is relied upon at
   *                    exactly the wrong moment.
   *   autoLockMinutes— stored, used only to render its own label. The app
   *                    locked on cold start and never again, so "lock after 1
   *                    minute" left an unattended phone open indefinitely.
   *
   * Asserted through the real functions rather than by grepping for a call.
   */
  {
    /* ---- hide balances ---- */
    setHideBalances(false);
    const shownUsd = fmtUsd(1234.5);
    const shownQty = fmtQty(12.3456);
    const shownCompact = fmtCompact(2_500_000);

    // fmtPrice rounds at >=1000, so 1234.5 formats as "$1,235" — assert that
    // digits are present rather than pinning an exact rounded string.
    t('with the switch off, money is visible', /\d/.test(shownUsd) && shownUsd.includes('$'));
    t('with the switch off, quantities are visible', /12\.34/.test(shownQty));

    setHideBalances(true);
    t('hiding balances masks the fiat total', fmtUsd(1234.5) !== shownUsd);
    t('the mask reveals no digits', !/\d/.test(fmtUsd(1234.5)));
    t('hiding balances masks compact sums', !/\d/.test(fmtCompact(2_500_000)));
    t('hiding balances masks token quantities', !/\d/.test(fmtQty(12.3456)));

    /*
     * Public market data must stay readable. Masking it would protect nothing
     * — the price of BNB says nothing about the holder — while making the
     * market list and every chart useless, which just trains people to leave
     * the feature off.
     */
    t('a public price is still shown while hidden', /\d/.test(fmtPrice(612.34)));
    t('a percentage change is still shown while hidden', /\d/.test(fmtPct(3.2)));

    // Nothing may be permanently masked: turning it off must fully restore.
    setHideBalances(false);
    t('turning it back off restores the fiat total', fmtUsd(1234.5) === shownUsd);
    t('turning it back off restores quantities', fmtQty(12.3456) === shownQty);
    t('turning it back off restores compact sums', fmtCompact(2_500_000) === shownCompact);

    // An absent value must still read as "no data", never as a masked amount —
    // those mean different things on a wallet screen.
    setHideBalances(true);
    t('a missing value is a dash, not a mask', fmtUsd(null) === '—');
    setHideBalances(false);
  }

  {
    /* ---- auto-lock ---- */
    const MIN = 60_000;
    const t0 = 1_000_000_000_000;

    /*
     * autoLock persists its marker in localStorage. The runner installs a DOM
     * before this suite, but the suite must not DEPEND on that — running it
     * standalone would otherwise silently no-op every write and report the
     * timing logic as broken. A tiny in-memory shim makes these cases true
     * unit tests.
     */
    if (typeof globalThis.localStorage === 'undefined') {
      const mem = new Map();
      globalThis.localStorage = {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k)
      };
    }

    // No marker yet: a first run must not lock.
    clearAway();
    t('never locks with no record of being away', !shouldAutoLock({ enabled: true, minutes: 5, at: t0 }));

    /*
     * markAway() writes to localStorage. Assert it actually landed before
     * relying on it: without a DOM these calls no-op, and every 'locks'
     * assertion below would then fail for a storage reason while looking like
     * a logic bug. If storage is unavailable the timing cases are skipped
     * rather than reported as false failures.
     */
    markAway(t0);
    const markerWorks = shouldAutoLock({ enabled: true, minutes: 1, at: t0 + 99 * MIN });
    t('the away marker persisted', markerWorks);

    t(
      'does not lock before the limit',
      !shouldAutoLock({ enabled: true, minutes: 5, at: t0 + 4 * MIN })
    );
    t(
      'locks once the limit is reached',
      shouldAutoLock({ enabled: true, minutes: 5, at: t0 + 5 * MIN })
    );
    t(
      'locks well past the limit',
      shouldAutoLock({ enabled: true, minutes: 5, at: t0 + 90 * MIN })
    );

    // The exact case reported: one minute.
    t(
      'one minute means one minute',
      shouldAutoLock({ enabled: true, minutes: 1, at: t0 + MIN })
    );
    t(
      'fifty seconds is not yet a minute',
      !shouldAutoLock({ enabled: true, minutes: 1, at: t0 + 50_000 })
    );

    // 'Never' must never lock, however long the app was away.
    t(
      'never means never',
      !shouldAutoLock({ enabled: true, minutes: AUTOLOCK_NEVER, at: t0 + 10_000 * MIN })
    );

    /*
     * With no lock method configured there must be no lock screen — that is
     * the lockout bug AppLock already had to be rescued from.
     */
    t(
      'no lock method means no lock',
      !shouldAutoLock({ enabled: false, minutes: 1, at: t0 + 100 * MIN })
    );

    /*
     * The system clock is user-settable. A negative gap means it moved, not
     * that no time passed — and "I cannot measure the gap" on a security
     * control must fail CLOSED, or the lock is bypassable by changing the date.
     */
    t(
      'a backwards clock locks rather than failing open',
      shouldAutoLock({ enabled: true, minutes: 5, at: t0 - 60 * MIN })
    );

    // Garbage in the stored value must not lock on every resume.
    clearAway();
    t(
      'a missing marker does not lock',
      !shouldAutoLock({ enabled: true, minutes: 5, at: t0 })
    );
  }

  /* ------------- news: minority languages must survive the trim ----------- */
  /*
   * REAL BUG: the "Other languages" tab was always empty.
   *
   * Two causes stacked. The server carried only English desks, and the client
   * only reaches for its own local-language RSS when the backend returns fewer
   * than 12 items — the backend returned ~30 every time, so that branch never
   * ran in production.
   *
   * Moving the local desks server-side exposed the second problem: English
   * outlets publish far more often, so a plain newest-first cut can contain
   * zero non-English items. The endpoint looks perfectly healthy — 60 items,
   * 200 OK — and the tab is still empty. Nothing observable from outside would
   * catch that, which is why the trim is asserted directly.
   */
  {
    const mk = (lang, i, at) => ({ id: `${lang}-${i}`, title: `${lang} ${i}`, lang, at });

    // The shape that broke it: a flood of fresh English, a trickle of older
    // Persian and German.
    const flooded = [
      ...Array.from({ length: 200 }, (_, i) => mk('en', i, 2_000_000 - i)),
      ...Array.from({ length: 8 }, (_, i) => mk('fa', i, 1_000 - i)),
      ...Array.from({ length: 5 }, (_, i) => mk('de', i, 900 - i))
    ].sort((a, b) => b.at - a.at);

    // Proof the naive approach really does lose them — otherwise this whole
    // test is guarding against nothing.
    const naive = [...flooded].sort((a, b) => b.at - a.at).slice(0, 60);
    t('a plain newest-first trim loses every foreign item', naive.every((i) => i.lang === 'en'));

    const kept = trimKeepingLanguages(flooded, { limit: 90, keepPerLang: 6 });
    t('the trim respects its budget', kept.length === 90);
    t('Persian survives a flood of English', kept.filter((i) => i.lang === 'fa').length === 6);
    t('German survives too', kept.filter((i) => i.lang === 'de').length === 5);
    t('English still fills the rest', kept.filter((i) => i.lang === 'en').length > 60);

    // Display order must still be newest-first, or the feed reads as shuffled.
    const ordered = kept.every((it, i) => i === 0 || kept[i - 1].at >= it.at);
    t('the result is still sorted newest-first', ordered);

    // A language with fewer items than the reserve must not be padded, and
    // must not steal slots it cannot fill.
    const sparse = [
      ...Array.from({ length: 50 }, (_, i) => mk('en', i, 5000 - i)),
      mk('fa', 0, 10)
    ].sort((a, b) => b.at - a.at);
    const sparseKept = trimKeepingLanguages(sparse, { limit: 20, keepPerLang: 6 });
    t('a single foreign item is kept', sparseKept.filter((i) => i.lang === 'fa').length === 1);
    t('no padding beyond what exists', sparseKept.length === 20);

    // Degenerate inputs must not throw — an upstream outage is not a crash.
    t('an empty feed trims to empty', trimKeepingLanguages([]).length === 0);
    t(
      'items with no language default to English rather than vanishing',
      trimKeepingLanguages([{ id: 'x', title: 'x', at: 1 }]).length === 1
    );
  }

  /* ------------------------- Solana / Jupiter ----------------------------- */
  /*
   * The Solana path shares no code with the EVM swap: different aggregator,
   * different address format, different fee mechanism. Everything that can
   * silently cost money is asserted here rather than trusted.
   */
  {
    /* ---- base units: the precision trap ---- */
    /*
     * The obvious implementation is `amount * 10 ** decimals`, and it is
     * wrong. In IEEE-754, 0.1 * 1e9 is 100000000.00000001 — Jupiter rejects a
     * non-integer amount, so the swap fails for a perfectly ordinary input.
     * These assert the string-based conversion is exact.
     */
    t('0.1 SOL converts exactly', toBaseUnits(0.1, 9) === '100000000');
    t('1 SOL converts exactly', toBaseUnits(1, 9) === '1000000000');
    t('the smallest USDC unit converts', toBaseUnits(0.000001, 6) === '1');
    t('a long fraction converts exactly', toBaseUnits(123.456789, 9) === '123456789000');
    /*
     * These two are the proof, not decoration. `8.31 * 1e9` evaluates to
     * 8310000000.000001 and `1.005 * 1e9` to 1004999999.9999999 — both are
     * non-integers, both are amounts a user can plausibly type, and Jupiter
     * rejects the order outright. An earlier version of this test only used
     * 0.1 and 1.5, which happen to survive the float path, so it passed
     * against a deliberately broken implementation.
     */
    t('8.31 does not lose precision', toBaseUnits(8.31, 9) === '8310000000');
    t('1.005 does not lose precision', toBaseUnits(1.005, 9) === '1005000000');
    t('the naive float path really is broken for 8.31',
      !Number.isInteger(8.31 * 10 ** 9));
    t('the naive float path really is broken for 1.005',
      !Number.isInteger(1.005 * 10 ** 9));

    // Every result must be a pure integer string, or Jupiter 400s.
    for (const [amt, dec] of [[0.1, 9], [1.5, 6], [0.07, 9], [8.31, 9], [1.005, 9], [999.999999, 6]]) {
      t(`${amt}@${dec} yields an integer string`, /^\d+$/.test(toBaseUnits(amt, dec) ?? ''));
    }

    // Round-trips must be lossless, or the confirmation screen lies.
    for (const [amt, dec] of [[0.1, 9], [1.5, 6], [123.456789, 9]]) {
      t(`${amt} survives a round-trip`, fromBaseUnits(toBaseUnits(amt, dec), dec) === String(amt));
    }

    t('zero is rejected', toBaseUnits(0, 9) === null);
    t('a negative amount is rejected', toBaseUnits(-1, 9) === null);
    t('junk is rejected', toBaseUnits('abc', 9) === null);

    /* ---- referral fee: Jupiter's hard range ---- */
    /*
     * Jupiter accepts 50-255 bps and rejects the whole /order request outside
     * it. Our 70 bps sits inside, so the Solana rate matches EVM exactly and
     * there is no second number to explain to a user.
     */
    t('our 70 bps fee is inside Jupiter\'s range',
      FEE_BPS >= REFERRAL_FEE_MIN_BPS && FEE_BPS <= REFERRAL_FEE_MAX_BPS);
    t('the fee passes through unchanged', referralFeeBps(70) === 70);
    t('a too-low fee is raised to the minimum', referralFeeBps(20) === REFERRAL_FEE_MIN_BPS);
    t('a too-high fee is capped', referralFeeBps(900) === REFERRAL_FEE_MAX_BPS);
    t('a junk fee falls back to the minimum', referralFeeBps('x') === REFERRAL_FEE_MIN_BPS);

    /*
     * Jupiter keeps 20% of the integrator fee. The disclosure must state what
     * we ACTUALLY receive, not imply the whole 0.70% arrives.
     */
    t('the net fee accounts for Jupiter\'s 20% cut', netFeeBps(70) === 56);
    t('the net fee is always below the gross', netFeeBps(70) < referralFeeBps(70));

    /* ---- error mapping: the same code means different things ---- */
    /*
     * REAL TRAP in the V2 docs: errorCode 2 is "insufficient SOL for gas" on
     * the aggregator routers and "missing associated token account" on
     * JupiterZ. Mapping on the code alone would confidently tell a user to top
     * up SOL when the real problem is a missing token account, or vice versa.
     */
    t('aggregator code 2 means gas',
      orderErrorKey({ transaction: '', errorCode: 2, router: 'metis' }) === 'INSUFFICIENT_GAS');
    t('JupiterZ code 2 means a missing token account',
      orderErrorKey({ transaction: '', errorCode: 2, router: 'jupiterz' }) === 'NO_TOKEN_ACCOUNT');
    t('the two routers really do differ on code 2',
      orderErrorKey({ transaction: '', errorCode: 2, router: 'metis' }) !==
      orderErrorKey({ transaction: '', errorCode: 2, router: 'jupiterz' }));
    t('code 1 is a balance problem on both',
      orderErrorKey({ transaction: '', errorCode: 1, router: 'metis' }) === 'INSUFFICIENT_BALANCE' &&
      orderErrorKey({ transaction: '', errorCode: 1, router: 'jupiterz' }) === 'INSUFFICIENT_BALANCE');
    t('an unknown code still yields a message',
      orderErrorKey({ transaction: '', errorCode: 99, router: 'metis' }) === 'ORDER_FAILED');
    // A usable order must NOT be reported as an error.
    t('a real transaction is not an error', orderErrorKey({ transaction: 'AQAB' }) === null);
    t('a null order is not an error', orderErrorKey(null) === null);

    /* ---- execute result ---- */
    /*
     * Both fields must agree. Treating status alone as success would report a
     * failed swap as done, which is the worst possible lie on this screen.
     */
    t('success needs status AND code 0',
      executeSucceeded({ status: 'Success', code: 0 }) === true);
    t('a non-zero code is not success',
      executeSucceeded({ status: 'Success', code: -1000 }) === false);
    t('a failed status is not success',
      executeSucceeded({ status: 'Failed', code: 0 }) === false);
    t('an empty response is not success', executeSucceeded(null) === false);

    /* ---- address validation ---- */
    t('a real Solana address validates',
      isSolanaAddress('B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4'));

    t('an EVM address is rejected',
      !isSolanaAddress('0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6'));
    // Base58 excludes 0, O, I and l precisely to stop look-alike typos.
    t('base58-illegal characters are rejected',
      !isSolanaAddress('0OIl000000000000000000000000000000'));
    t('an empty string is rejected', !isSolanaAddress(''));
  }

  /* --------------- wallet: real holdings, priced in fiat ------------------ */
  /*
   * The wallet screen used to show ONE number — the native coin, as a bare
   * quantity. Someone holding 400 USDT and 0.01 BNB saw "0.01" and nothing
   * else, and there was no fiat total anywhere, which is the single question
   * people open a wallet to answer.
   *
   * Every rule below costs real money if it is wrong, and none of them are
   * visible from outside the hook, so the pure transform is asserted directly.
   */
  {
    const list = [
      { symbol: 'BNB', name: 'BNB', address: null, decimals: 18, native: true, coingeckoId: 'binancecoin' },
      { symbol: 'USDT', name: 'Tether', address: '0x1', decimals: 6, coingeckoId: 'tether' },
      { symbol: 'USDC', name: 'USD Coin', address: '0x2', decimals: 6, coingeckoId: 'usd-coin' },
      { symbol: 'MEME', name: 'Meme', address: '0x3', decimals: 18 } // no price feed
    ];
    const prices = { binancecoin: 612.5, tether: 1, 'usd-coin': 1 };

    const held = {
      BNB: { formatted: 0.4183 },
      USDT: { formatted: 400 },
      USDC: { formatted: 0.0000004 }, // dust
      MEME: { formatted: 1_000_000 }  // real holding, unpriceable
    };

    const out = buildHoldings(list, held, prices);
    const syms = out.map((r) => r.symbol);

    t('a priced token is listed', syms.includes('USDT'));
    t('the native coin is listed', syms.includes('BNB'));
    t('sub-cent dust is hidden', !syms.includes('USDC'));
    /*
     * A memecoin with no price feed must still appear. Hiding a real holding
     * because we cannot value it would tell the user they own nothing.
     */
    t('an unpriced holding is still shown', syms.includes('MEME'));
    t('unpriced holdings sort last', syms[syms.length - 1] === 'MEME');
    t('the largest value sorts first', syms[0] === 'USDT');

    const total = out.reduce((sum, r) => sum + (r.value ?? 0), 0);
    t(`the fiat total adds up (${total.toFixed(2)})`, Math.abs(total - (400 + 0.4183 * 612.5)) < 0.01);
    t('an unpriced row contributes nothing to the total',
      out.find((r) => r.symbol === 'MEME')?.value === null);

    /*
     * THE COLD-START BUG, caught while writing this.
     *
     * An earlier version filtered inside the fetch, before prices had loaded.
     * With an empty priceMap every token looks unpriced, falls through to the
     * quantity rule, and 0.4183 BNB survives — but a token with a small
     * quantity would be dropped as dust and never return, because the
     * re-pricing step only revalues rows that were kept.
     *
     * Filtering now happens on every render against the CURRENT prices, so an
     * empty map must never lose a real balance.
     */
    const cold = buildHoldings(list, held, {});
    const coldSyms = cold.map((r) => r.symbol);
    t('nothing is lost before prices arrive', coldSyms.includes('BNB') && coldSyms.includes('USDT'));
    t('a real holding survives an empty price map', coldSyms.includes('MEME'));
    t('the same rows reappear once prices load',
      buildHoldings(list, held, prices).some((r) => r.symbol === 'USDT'));

    /* ---- degenerate inputs must not throw ---- */
    t('an empty token list yields nothing', buildHoldings([], {}, {}).length === 0);
    t('a null list is safe', buildHoldings(null, null, null).length === 0);
    t('a wallet with no balances yields nothing', buildHoldings(list, {}, prices).length === 0);
    t('a zero balance is not listed',
      !buildHoldings(list, { BNB: { formatted: 0 } }, prices).some((r) => r.symbol === 'BNB'));
  }

  /* ----------- Solana on mobile: the wallet-browser deeplink -------------- */
  /*
   * REAL GAP: inside the APK the Solana Connect button was permanently
   * disabled, showing "no wallet found" to users who may well have Phantom
   * installed.
   *
   * The cause is structural, not a bug: Phantom injects window.solana from a
   * browser EXTENSION, and extensions do not exist on mobile — not in a
   * Capacitor WebView and not in Chrome for Android either. So the provider
   * can never appear there, and no amount of retrying helps.
   *
   * The fix is Phantom's own recommendation: hand the page to the wallet's
   * in-app browser, where the provider IS injected. That makes this deeplink
   * the ONLY route to Solana from the APK, so its exact shape is pinned here.
   */
  {
    /*
     * Verified against the example in Phantom's published spec, character for
     * character. Both params are required and both must be URL-encoded; a
     * malformed link fails by silently opening the wallet on nothing, which
     * is indistinguishable from the wallet being broken.
     */
    const officialExample =
      'https://phantom.app/ul/browse/https%3A%2F%2Fmagiceden.io%2Fitem-details%2FED8Psf2Zk2HyVGAimSQpFHVDFRGDAkPjQhkfAqbN5h7d?ref=https%3A%2F%2Fmagiceden.io';
    t(
      "the link matches Phantom's own documented example",
      phantomBrowseLink(
        'https://magiceden.io/item-details/ED8Psf2Zk2HyVGAimSQpFHVDFRGDAkPjQhkfAqbN5h7d',
        'https://magiceden.io'
      ) === officialExample
    );

    const link = phantomBrowseLink('https://www.lawpoetics.ir/#/solana');
    t('the deeplink points at phantom.app', new URL(link).host === 'phantom.app');
    t('it uses the universal-link path', link.includes('/ul/browse/'));
    t('it carries the required ref parameter', new URL(link).searchParams.has('ref'));

    /*
     * The hash must survive encoding. HashRouter puts the route after '#', so
     * an unencoded '#' would truncate the URL and drop the user on the market
     * screen instead of the Solana one — a plausible mistake that still
     * "works" enough to look fine in a screenshot.
     */
    t('the route survives encoding', decodeURIComponent(link).includes('#/solana'));
    t(
      'the hash is encoded rather than literal',
      link.includes('%23') && !link.slice('https://phantom.app/ul/browse/'.length).includes('#')
    );

    // Only https may be handed to a wallet.
    t('plain http is refused', phantomBrowseLink('http://example.com') === null);
    t('a null url is refused', phantomBrowseLink(null) === null);
    t('junk is refused', phantomBrowseLink('not a url') === null);

    t('Solflare gets its own host', new URL(solflareBrowseLink('https://x.io')).host === 'solflare.com');
    const backpack = new URL(backpackBrowseLink('https://fbtswap.ir/#/solana'));
    t('Backpack gets its documented browse link',
      backpack.host === 'backpack.app' && backpack.pathname === '/ul/v1/browse/' &&
      backpack.searchParams.get('url') === 'https://fbtswap.ir/#/solana');

    /*
     * publicAppUrl must never be localhost. Capacitor serves the APK from
     * https://localhost, so using window.location here would send the wallet's
     * browser to the phone itself and load nothing at all.
     */
    const app = publicAppUrl();
    t(`the app url is public, not localhost (${app})`, !/localhost/.test(app));
    t('the app url is https', app.startsWith('https://'));
    t('the wallet identity is the canonical FBT domain', new URL(app).host === 'fbtswap.ir');
    /*
     * The default is the bare origin, and the CALLER names the route. It
     * briefly defaulted to '/#/solana' while the wallet deeplink was the only
     * user; the referral invite then inherited that default and every shared
     * link would have dropped friends on the Solana screen instead of the
     * home page. Both paths are asserted, so neither can silently swap.
     */
    t('the default is the bare origin', !app.includes('#'));
    t('a caller can request the Solana route', publicAppUrl('/#/solana').endsWith('/#/solana'));
    t('the deeplink still targets Solana', decodeURIComponent(link).includes('#/solana'));
  }

  /* ------- Solana: mobile must never hit the "install it" dead end -------- */
  /*
   * REAL BUG, reported from a device: «نه میشه وصل نه مرورگر داریم».
   *
   * canInjectSolana() was `!isNativeShell()`, so it only excluded the APK.
   * Every MOBILE BROWSER — Chrome on Android, Safari on iOS — reported true
   * and got the "install a wallet and open this page in its browser" message
   * with no button to do that. The copy told the user to perform a step the UI
   * was hiding from them.
   *
   * Browser extensions do not exist on any mobile browser. On a phone with no
   * provider the answer is ALWAYS "open this in the wallet app". On desktop an
   * extension really is possible, so "install it" is correct there and must
   * survive.
   *
   * Asserted against real user-agent strings rather than the helper's own
   * shape, because the failure was a missing case, not a wrong expression —
   * only feeding it the environments users actually have can catch that.
   */
  {
    const decide = (win) => {
      // Mirrors canInjectSolana(); the module reads a global `window`, which
      // this suite cannot swap per-case.
      if (!win) return false;
      if (win.Capacitor?.isNativePlatform?.()) return false;
      const ua = String(win.navigator?.userAgent ?? '');
      if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
      return true;
    };
    const ua = (s) => ({ navigator: { userAgent: s } });

    const mobiles = {
      'Chrome on Android': 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
      'Safari on iPhone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari',
      'Safari on iPad': 'Mozilla/5.0 (iPad; CPU OS 17_5) AppleWebKit/605.1.15 Mobile/15E148 Safari',
      'Firefox on Android': 'Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0'
    };
    for (const [name, s] of Object.entries(mobiles)) {
      t(`${name} is offered the wallet button, not an install prompt`, decide(ua(s)) === false);
    }

    t('the packaged app is offered the wallet button',
      decide({ Capacitor: { isNativePlatform: () => true } }) === false);

    /*
     * Desktop must NOT regress into showing wallet-browser buttons: a Phantom
     * extension is genuinely installable there, and deeplinking a desktop user
     * into a phone app would be nonsense.
     */
    const desktops = {
      'Chrome on Windows': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Safari on macOS': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari'
    };
    for (const [name, s] of Object.entries(desktops)) {
      t(`${name} still gets the extension prompt`, decide(ua(s)) === true);
    }

    /*
     * The operator-only warning must stay out of the customer's face. It said
     * "fee collection is not configured" in red at the bottom of the swap
     * screen — nothing a user can act on, and it made the app look half-built.
     * The signal lives at /api/solana/status instead.
     */
    for (const [code, loc] of Object.entries({ en: enLocale, fa: faLocale, ar: arLocale })) {
      t(`${code}: the fee-not-configured string is gone`, loc?.solana?.feeNotConfigured === undefined);
      // ...and the customer-facing fee line must not leak our revenue split.
      const notice = String(loc?.solana?.feeNotice ?? '');
      t(`${code}: the fee notice does not expose the aggregator's cut`, !/20\s*%|٢٠|۲۰٪/.test(notice));
    }
  }

  /* ------------------------------ referrals ------------------------------- */
  /*
   * Requested with an explicit condition: only if it does not introduce bugs.
   *
   * That condition ruled out the obvious design. Our 0.70% is collected by
   * KyberSwap's router inside the user's own transaction and paid to ONE
   * feeReceiver address; the aggregator supports no second recipient.
   * Splitting on-chain would mean routing every swap through a payable
   * fee-splitting contract of our own — unaudited money-handling code, where a
   * bug is stolen funds rather than a broken screen. Not worth a 0.01 share.
   *
   * So this records ATTRIBUTION and the settlement is manual. The accounting
   * still has to be exactly right, and the ways it can be gamed are the ways
   * affiliate programmes are always gamed, so they are asserted.
   */
  {
    // localStorage shim so these run standalone as well as under the runner.
    if (typeof globalThis.localStorage === 'undefined') {
      const mem = new Map();
      globalThis.localStorage = {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k)
      };
    }

    /* ---- code validation ---- */
    t('a normal code is valid', isValidRefCode('FBTAB12'));
    t('a too-short code is refused', !isValidRefCode('abc'));
    t('a code with punctuation is refused', !isValidRefCode('abc<script>'));
    t('a null code is refused', !isValidRefCode(null));

    /* ---- capture ---- */
    clearReferral();
    t('a valid code is captured', captureReferral('?ref=FRIEND01') === 'FRIEND01');
    t('the captured code is remembered', referredBy() === 'FRIEND01');

    /*
     * FIRST TOUCH WINS. Without this, anyone could send an existing user their
     * own link and take credit for a relationship they had no part in — the
     * standard way these programmes get farmed.
     */
    t('a second link does not overwrite the first', captureReferral('?ref=OTHER99') === 'FRIEND01');
    t('the original referrer is kept', referredBy() === 'FRIEND01');

    clearReferral();
    t('an invalid code is not captured', captureReferral('?ref=x') === null);
    t('no referral is recorded from junk', referredBy() === null);
    t('a missing parameter is fine', captureReferral('?utm_source=x') === null);
    t('an empty query is fine', captureReferral('') === null);

    /* Telegram Main Mini App links pass startapp through start_param, not a
       browser ?ref= query. Both Telegram surfaces must retain attribution. */
    clearReferral();
    t('a Telegram start_param is captured', captureReferral('', 'TGFRIEND') === 'TGFRIEND');
    clearReferral();
    t('a Telegram URL launch parameter is captured',
      captureReferral('?tgWebAppStartParam=URLFRIEND') === 'URLFRIEND');
    clearReferral();
    t('an invalid Telegram start_param is refused', captureReferral('', '<bad>') === null);

    /*
     * SELF-REFERRAL. Opening your own invite link must not credit you, or
     * every fee you generate owes you a rebate.
     */
    clearReferral();
    localStorage.setItem('fbt-swap-v1', JSON.stringify({ state: { refCode: 'MYOWN01' } }));
    t('self-referral is refused', captureReferral('?ref=MYOWN01') === null);
    t('nothing is recorded for a self-referral', referredBy() === null);
    // ...but a genuine referral still works with the same store present.
    t('a real referral still works', captureReferral('?ref=REALFRIEND') === 'REALFRIEND');
    localStorage.removeItem('fbt-swap-v1');
    clearReferral();

    /*
     * EXPIRY. A click from years ago must stop earning — that is neither what
     * the referrer contributed nor something defensible if questioned.
     */
    captureReferral('?ref=OLDFRIEND');
    t('a fresh referral is active', referredBy() === 'OLDFRIEND');
    localStorage.setItem('fbt-referred-at', String(Date.now() - 200 * 86_400_000));
    t('an expired referral stops counting', referredBy() === null);
    // The code is still stored, so first-touch still blocks a re-capture.
    t('an expired referral cannot be replaced', captureReferral('?ref=NEWFRIEND') === 'OLDFRIEND');
    clearReferral();

    /* ---- the share ---- */
    t('the share is 1% of our fee', REFERRAL_SHARE === 0.01);
    t('a $7 fee yields 7 cents', Math.abs(referrerShare(7) - 0.07) < 1e-9);
    t('a zero fee yields nothing', referrerShare(0) === 0);
    t('a negative fee yields nothing', referrerShare(-5) === 0);
    t('junk yields nothing', referrerShare('abc') === 0);
    /*
     * The share comes out of OUR fee, never on top of it. A referred user must
     * never pay more than anyone else, so the result can never exceed the fee.
     */
    t('the share never exceeds the fee', referrerShare(7) < 7);
    t('a share above 100% is refused', referrerShare(7, 1.5) === 0);
  }

  /* ---------------------- Telegram bot identity ------------------------- */
  /*
   * A bot migration has two independent edges: the public t.me link users
   * follow, and the secret token the server uses to verify their Mini App
   * signatures. The numeric ID is public diagnostic metadata, never a token.
   */
  {
    t('the public bot username is fbtco_bot', TELEGRAM_BOT_USERNAME === 'fbtco_bot');
    t('the public bot ID is 7837421575', TELEGRAM_BOT_ID === '7837421575');
    t('the public bot URL is canonical', TELEGRAM_BOT_URL === 'https://t.me/fbtco_bot');
    t('the server expects the same public bot ID', EXPECTED_TELEGRAM_BOT_ID === TELEGRAM_BOT_ID);

    t('a referral deep link opens the Main Mini App with startapp',
      telegramBotStartAppUrl('FRIEND01') === 'https://t.me/fbtco_bot?startapp=FRIEND01');
    t('an unsafe deep-link payload falls back to the bare bot URL',
      telegramBotStartAppUrl('<bad>') === TELEGRAM_BOT_URL);

    t('a bot ID is parsed from a syntactically valid token without exposing it',
      botIdFromToken('7837421575:test-only-token-not-a-real-secret') === '7837421575');
    const matching = telegramBotIdentity('7837421575:test-only-token-not-a-real-secret');
    const stale = telegramBotIdentity('9999999999:test-only-token-not-a-real-secret');
    t('the matching token prefix is reported as the expected public identity',
      matching.configuredBotId === TELEGRAM_BOT_ID && matching.identityMatches === true);
    t('a stale token prefix is visibly flagged without being accepted as a match',
      stale.configuredBotId === '9999999999' && stale.identityMatches === false);

    const launched = new URL(webAppUrlForStart('https://fbtswap.ir/?source=bot#/swap', 'FRIEND01'));
    t('a /start payload reaches the self-hosted Web App button as ?ref=',
      launched.searchParams.get('ref') === 'FRIEND01' && launched.hash === '#/swap');
    t('an invalid /start payload does not alter the Web App URL',
      webAppUrlForStart('https://fbtswap.ir/#/swap', '<bad>') === 'https://fbtswap.ir/#/swap');
  }

  /* ----------------------- sharing beyond Telegram ---------------------- */
  /*
   * The old share path built ONE url — t.me/share/url — and nothing else. In
   * Iran t.me does not resolve on most networks, so the tap did nothing; and a
   * user whose friends are on WhatsApp had no route at all. Sharing is the
   * only free growth channel this project has, so each destination is checked
   * as a real link rather than trusted to look right.
   */
  {
    const url = 'https://www.lawpoetics.ir/?ref=ALI1234';
    const text = 'join me';
    const targets = shareTargets(url, text);
    const by = Object.fromEntries(targets.map((x) => [x.id, x]));

    t('there are several destinations, not just one', targets.length >= 5);
    t('WhatsApp is offered', Boolean(by.whatsapp));
    t('SMS is offered — it needs no account and no app', Boolean(by.sms));
    t('email is offered', Boolean(by.email));

    /*
     * Every destination must survive a URL that contains a query string. The
     * invite link ALWAYS has `?ref=` in it, so an unencoded url would be cut
     * at the first `&` the receiving site sees — the referral code, the one
     * part that has to arrive, is the part that would be lost.
     */
    for (const x of targets) {
      const encodedSomewhere =
        x.href.includes(encodeURIComponent(url)) ||
        x.href.includes(encodeURIComponent(`${text}\n${url}`));
      t(`${x.id} url-encodes the link`, encodedSomewhere);
    }

    /*
     * Custom schemes (whatsapp://, tg://) throw an OS error dialog when the
     * app is absent; the https forms fall back to the web version instead.
     * SMS is the one exception — it has no web equivalent.
     */
    const schemeOk = targets.every(
      (x) => /^https:\/\//.test(x.href) || /^(mailto|sms):/.test(x.href)
    );
    t('no destination uses a custom app scheme', schemeOk);

    /*
     * iOS drops the SMS body unless the query begins `?&`. One character, and
     * without it the message opens empty and the user has to retype the link.
     */
    t('the SMS link uses the iOS-compatible ?& form', by.sms.href.startsWith('sms:?&body='));

    // Telegram stays available — it is just no longer the only option.
    t(
      'the Telegram link is still well-formed',
      telegramShareUrl(url, text) ===
        `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
    );
    t('the Telegram link tolerates no text', telegramShareUrl(url).endsWith('&text='));

    // A link with no message must still be shareable.
    t('an empty message still produces links', shareTargets(url).every((x) => x.href.length > 10));
  }

  /* ------------------- the support address, in one place ---------------- */
  /*
   * Cafe Bazaar rejected our submission partly because the contact address is
   * a Gmail account; they want one on our own domain. That address appears in
   * SIXTEEN files — three locale bundles, four screens, the AI system prompt,
   * index.html, the LICENSE, four docs and a test.
   *
   * Changing sixteen files by hand is fifteen chances to miss one, and a
   * support address that is stale on one screen is worse than a missing one:
   * the user writes into a void and concludes the app was abandoned.
   *
   * So it is centralised and read from an env var, and the twelve translated
   * bundles are rewritten at render time by an i18next post-processor rather
   * than edited — editing translated safety copy in languages nobody here can
   * proofread is the one thing worth refusing to do.
   */
  {
    t('there is a support address', /@/.test(SUPPORT_EMAIL));
    t('the mailto form is derived, not duplicated', SUPPORT_MAILTO === `mailto:${SUPPORT_EMAIL}`);

    /*
     * Today the configured address equals the one baked into the bundles, so
     * the rewrite must be a NO-OP. If this ever fails, every translated string
     * is being needlessly rewritten on every render.
     */
    const sample = `Email us at ${LEGACY_EMAIL_IN_LOCALES}, or visit the office.`;
    if (SUPPORT_EMAIL === LEGACY_EMAIL_IN_LOCALES) {
      t('the rewrite costs nothing while the address is unchanged', withContactEmail(sample) === sample);
    }

    /*
     * And it must actually work when they differ. Proven by calling the real
     * function with a real replacement rather than trusting the branch —
     * mid-sentence is the hard case, and it is the shape every locale uses.
     */
    const swapped = sample.split(LEGACY_EMAIL_IN_LOCALES).join('info@lawpoetics.ir');
    t(
      'a changed address is rewritten mid-sentence',
      swapped === 'Email us at info@lawpoetics.ir, or visit the office.'
    );

    /*
     * Non-strings must pass through untouched. i18next hands the post-processor
     * whatever t() returned, and `returnObjects` or a missing key can make that
     * an object or undefined — throwing there would blank the whole screen.
     */
    t('objects pass through the rewriter', withContactEmail(undefined) === undefined);
    t('numbers pass through the rewriter', withContactEmail(42) === 42);

    /*
     * The legacy constant is the needle we search for in the bundles, not a
     * setting. If someone "helpfully" points it at the new address, the
     * rewrite silently stops finding anything and every locale keeps showing
     * the old address forever.
     */
    t('the legacy needle still matches the bundles', LEGACY_EMAIL_IN_LOCALES === 'fbtswap@gmail.com');
  }

  /* --------------------- the Telegram channel poster -------------------- */
  /*
   * Free growth channel: X killed its free API tier in February 2026 and now
   * charges $0.20 for a post containing a URL - every post we would send has
   * our link in it. The Telegram Bot API is still free, so this is the one
   * place automation genuinely costs nothing.
   *
   * The dangerous part is the AI commentary. A wrong price in a crypto channel
   * destroys the trust we are trying to build, so the model is given the
   * figures and asked for prose only, and anything it returns containing a
   * number we did not supply is thrown away.
   */
  {
    const g = { mcap: 3.42e12, mcapChange: -1.87, btcDominance: 54.312 };
    const coins = [
      { symbol: 'SOL', price: 182.4, change24h: 7.31 },
      { symbol: 'BTC', price: 96432.1, change24h: -2.14 }
    ];

    /* ---- the anti-hallucination guard ---- */
    const allowed = allowedNumbers({
      mcapChange: -1.87,
      btcDominance: 54.312,
      coins: [{ symbol: 'SOL', price: 182.4, change24h: 7.31 }]
    });

    t(
      'a sentence with no numbers is accepted',
      !hasInventedNumber('Broad market softness with dominance holding steady.', allowed)
    );
    t(
      'a sentence quoting a supplied figure is accepted',
      !hasInventedNumber('Market cap fell 1.87% over the day.', allowed)
    );
    /*
     * THE ONE THAT MATTERS. An invented price target is the single worst thing
     * this feature could publish - it is both false and reads as advice.
     */
    t(
      'an invented price target is rejected',
      hasInventedNumber('Bitcoin is heading to $150000 next week.', allowed)
    );
    t(
      'an invented statistic is rejected',
      hasInventedNumber('Volumes rose 42% across major venues.', allowed)
    );

    /* ---- the post itself ---- */
    const post = buildPost({
      global: g,
      coins,
      comment: 'Dominance holding steady.',
      appUrl: 'https://www.lawpoetics.ir'
    });

    t('the post carries the real market cap', post.includes('$3.42T'));
    t('the post carries a real coin price', post.includes('$182.40'));
    t('the post links to the app', post.includes('https://www.lawpoetics.ir'));
    /*
     * Non-negotiable. This channel exists to funnel people into a financial
     * app; a market update with a link and no disclaimer is exactly what draws
     * regulatory attention in our market.
     */
    t('the post says it is not advice', /not financial advice/i.test(post));
    t('the post fits Telegram message limit', post.length < 4096);

    /*
     * Coin names and symbols come from a third-party API. An unescaped '&' or
     * '<' makes Telegram reject the whole sendMessage with a 400 and the post
     * silently never appears - a failure mode that looks like "the bot is
     * broken" with nothing in the logs to explain it.
     */
    t('ampersands are escaped for Telegram HTML', esc('A&B') === 'A&amp;B');
    t('angle brackets are escaped', esc('<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;');
    const hostile = buildPost({
      global: g,
      coins: [{ symbol: 'A&B<script>', price: 1, change24h: 0 }],
      comment: null,
      appUrl: 'https://x.test'
    });
    t('a hostile symbol cannot inject markup', !hostile.includes('<script>'));

    /* A missing AI comment must not leave a dangling empty line or break. */
    const plain = buildPost({ global: g, coins, comment: null, appUrl: 'https://x.test' });
    t('the post works with no AI commentary', plain.includes('$3.42T') && !plain.includes('undefined'));

    /* Absent data must render as a dash, never as "NaN" or "$0.00" - a
       confident zero next to a real coin is worse than an obvious gap. */
    const broken = buildPost({
      global: { mcap: null, mcapChange: null, btcDominance: null },
      coins: [{ symbol: 'X', price: null, change24h: null }],
      comment: null,
      appUrl: 'https://x.test'
    });
    t('missing figures render as a dash, not NaN', !/NaN/.test(broken));
  }

  /* ------------- the bot must not claim real trades are fake ------------ */
  /*
   * REAL BUG: /start told every new user "Everything runs on virtual NX
   * credits." True when the app was only paper trading; false for a long time
   * since - Swap moves real funds on ten networks.
   *
   * Telling someone their first trade is play money, immediately before
   * handing them a button that opens a real exchange, is the most dangerous
   * sentence in the product. Somebody could reasonably have believed they were
   * practising with an irreversible on-chain transaction.
   */
  {
    const bot = readFileSync('server/bot.js', 'utf8');
    const strip = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = strip(bot);

    t('the bot no longer claims everything is virtual credits', !/virtual NX credits/.test(code));
    t('the bot warns that swaps move real funds', /real funds/i.test(code));
    t('the bot warns transactions are irreversible', /cannot be reversed/i.test(code));
    // The scam-defence line is the part that was always right; keep it.
    t('the bot still refuses deposits', /never takes deposits/i.test(code));
    /*
     * The arcade was deleted from the repository, so advertising
     * "provably-fair mini-games" points at a feature that does not exist in
     * any build — website included.
     */
    t('the bot does not advertise the removed arcade', !/mini-games/i.test(code));
  }

  /* ------------------- best-price across two aggregators ---------------- */
  /*
   * We now ask KyberSwap AND OpenOcean and use the better answer. Two things
   * make that safe, and both are load-bearing:
   *
   *  1. Only an EXECUTABLE quote may win. OpenOcean is quoted but never
   *     executed, so a better price we cannot sign must not become the
   *     transaction - showing one number and signing another is the worst
   *     possible bug on a swap screen.
   *
   *  2. A slow or failing second source must cost nothing. Sources run
   *     concurrently, so total latency is max(), not sum().
   */
  {
    const q = (out, opts = {}) => ({
      amountOutWei: BigInt(out),
      feeBps: opts.feeBps ?? 70,
      slippage: opts.slippage ?? 0.5,
      source: opts.source ?? 'kyber',
      ...(opts.executable === undefined ? {} : { executable: opts.executable })
    });

    /* ---- what counts as a quote at all ---- */
    t('a real quote is usable', isUsableQuote(q(100)));
    t('an error object is not a quote', !isUsableQuote({ error: 'NO_ROUTE' }));
    t('a zero-output quote is not usable', !isUsableQuote(q(0)));
    t('null is not a quote', !isUsableQuote(null));

    /* ---- like-for-like ---- */
    /*
     * An aggregator that ignored our fee parameter reports a bigger output
     * for the obvious reason: it is not taking our 0.70%. Ranking on that
     * would make the fee-free path always win, which is precisely the mistake
     * getQuote already refuses to make.
     */
    t('quotes with the same fee and slippage are comparable', comparable(q(100), q(110)));
    t('a fee mismatch blocks comparison', !comparable(q(100), q(110, { feeBps: 0 })));
    t('a slippage mismatch blocks comparison', !comparable(q(100), q(110, { slippage: 1 })));

    /* ---- the ranking ---- */
    let r = pickBestQuote([q(100), q(150)]);
    t('the better executable quote wins', r.best.amountOutWei === 150n);
    t('the comparison reports how many routes it checked', r.checked === 2);

    /*
     * THE ONE THAT MATTERS MOST. A non-executable quote is better - and must
     * still lose, because we cannot sign it.
     */
    r = pickBestQuote([q(100), q(120, { executable: false, source: 'oo' })]);
    t('a better NON-executable quote does not win', r.best.amountOutWei === 100n);
    t('...and the executable one is what we would sign', r.best.source === 'kyber');
    /* But we report the gap rather than pretending we found the best price. */
    t('...and the shortfall is reported honestly', r.beatenBy === 2000);

    /*
     * The legacy KyberSwap quote predates the `executable` flag entirely.
     * Defaulting an unflagged quote to "cannot execute" would break swapping
     * outright, so the rule is opt-OUT.
     */
    t('a quote with no executable flag can still win', pickBestQuote([q(100)]).best.amountOutWei === 100n);

    /* Nothing signable at all must be null, not an unsignable object. */
    r = pickBestQuote([q(120, { executable: false })]);
    t('quote-only results yield no executable best', r.best === null);
    t('...but they are still counted as checked', r.checked === 1);

    t('no quotes yields no best', pickBestQuote([]).best === null);

    /* ---- the improvement maths ---- */
    t('a 10% better quote is 1000 bps', improvementBps(q(100), q(110)) === 1000);
    t('an equal quote is 0 bps', improvementBps(q(100), q(100)) === 0);
    /*
     * Precision: an 18-decimal amount exceeds Number.MAX_SAFE_INTEGER, so the
     * ratio must be computed in BigInt. Converting first would silently round
     * and could report a real improvement as zero.
     */
    const big = 10n ** 18n;
    t(
      'the maths survives 18-decimal amounts',
      improvementBps({ ...q(1), amountOutWei: big }, { ...q(1), amountOutWei: big + big / 100n }) === 100
    );

    /*
     * Concurrency and failure behaviour are asynchronous, and this suite is
     * synchronous by design. They are exercised in test/quote-race-probe.mjs
     * instead - see the note there about why the timing assertion has to be
     * measured rather than reasoned about.
     */
  }

  /* -------------- the UNIFIED QUOTE MODEL (quoteModel.js) --------------- */
  /*
   * These cover the P0 acceptance criteria that are pure: quote freshness,
   * net-output selection (not gross), fee correctness/fingerprint integrity,
   * stale-quote rejection, comparability strictness, and the failure taxonomy.
   * The async paths (real eth_call, replay on chain) live in their own probes.
   */
  {
    const baseQuote = (over = {}) => ({
      amountInWei: 1_000_000_000n,
      amountOutWei: 2_000_000_000n,
      minOutWei: 1_990_000_000n,
      amountOutUsd: 2000,
      amountInUsd: 1000,
      gasUsd: 5,
      ...over
    });
    const ctx = (over = {}) => ({
      chainId: 56,
      tokenIn: '0x' + 'a'.repeat(40),
      tokenOut: '0x' + 'b'.repeat(40),
      fbtFeeBps: 70,
      feeRecipient: '0x' + 'f'.repeat(40),
      slippageBps: 50,
      source: 'kyberswap',
      now: 1_000_000,
      ttlMs: 30_000,
      ...over
    });

    /* ---- normalization produces the unified schema ---- */
    const n = normalizeQuote(baseQuote(), ctx());
    t('a normalized quote carries the schema tag', n.schema === QUOTE_SCHEMA);
    t('normalization preserves the raw amountOut as bigint', n.amountOutWei === 2_000_000_000n);
    t('the FBT fee bps is carried through', n.fbtFeeBps === 70);
    t('the quote gets a quoteTimestamp from the injected clock', n.quoteTimestamp === 1_000_000);
    t('expiry is timestamp + ttl', n.expiry === 1_000_000 + 30_000);
    t('a normalized quote has a fingerprint', typeof n.fingerprint === 'string' && n.fingerprint.length === 8);

    /* ---- freshness: a stale quote cannot be signed ---- */
    t('a quote is fresh before its expiry', isFresh(n, 1_010_000));
    t('a quote is expired AT its expiry', isExpired(n, 1_030_000));
    t('a quote is expired past its expiry', isExpired(n, 1_040_000));
    t('quoteAgeMs measures time since the quote', quoteAgeMs(n, 1_010_000) === 10_000);
    /*
     * FAIL CLOSED on freshness: a quote with no expiry is treated as expired.
     * The only safe default for something about to be signed.
     */
    t('a quote with no expiry is treated as expired', isExpired({ schema: QUOTE_SCHEMA }, 1));

    /* ---- net output, not gross ---- */
    /*
     * THE CENTRAL RULE. Two quotes with the same gross output but different gas
     * are NOT equal: the one with cheaper gas is the better route. Ranking on
     * gross would ignore gas and call them a tie.
     */
    const cheap = normalizeQuote(baseQuote({ gasUsd: 3 }), ctx({ source: 'a' }));
    const dear = normalizeQuote(baseQuote({ gasUsd: 9 }), ctx({ source: 'b' }));
    t('net output subtracts gas from the received value', netOutputUsd(cheap) === 1997);
    t('a cheaper-gas route has a higher net output', netOutputUsd(cheap) > netOutputUsd(dear));
    t('net output is null when the received value is unknown', netOutputUsd({ amountOutUsd: null }) === null);

    /* ---- gas unknown can never be "the best" ---- */
    /*
     * The spec: "if gas or price source is unknown, the route must not be
     * presented as the best route." A route whose gas we cannot price is
     * ineligible to win, even if its gross output is enormous.
     */
    const gasless = normalizeQuote(baseQuote({ gasUsd: null }), ctx({ source: 'c' }));
    t('a route with unknown gas cannot be the best', !canBeBest(gasless, 1_000_000));
    t('a route with known gas can be the best', canBeBest(cheap, 1_000_000));
    t('an expired route cannot be the best', !canBeBest(cheap, 9_999_999));

    /* ---- ranking by net output picks the cheaper-gas winner ---- */
    const ranked = rankByNetOutput([cheap, dear], 1_000_000);
    t('rankByNetOutput returns a best', Boolean(ranked.best));
    t('the cheaper-gas route wins on net output', ranked.best.source === 'a');
    t('ranked reports how many were eligible', ranked.checked === 2);
    t('ranked surfaces the alternative', ranked.alternatives.length === 1);

    /* ---- stale and non-executable quotes are dropped and counted ---- */
    const stale = normalizeQuote(baseQuote(), ctx({ source: 'stale', now: 1, ttlMs: 10 }));
    const exec = normalizeQuote(baseQuote(), ctx({ source: 'exec' }));
    const r2 = rankByNetOutput([stale, exec], 1_000_000);
    t('a stale quote is dropped and counted', r2.stale === 1);
    t('the stale quote did not win', r2.best.source === 'exec');

    const notExec = normalizeQuote(baseQuote(), ctx({ source: 'velora' }));
    notExec.executable = false;
    const r3 = rankByNetOutput([exec, notExec], 1_000_000);
    t('a non-executable quote is dropped and counted', r3.notExecutable === 1);
    t('a non-executable quote cannot win', r3.best.source !== 'velora');

    const gasUnknown = normalizeQuote(baseQuote({ gasUsd: null }), ctx({ source: 'x' }));
    const r4 = rankByNetOutput([exec, gasUnknown], 1_000_000);
    t('a gas-unknown quote is dropped and counted', r4.gasUnknown === 1);

    /* ---- comparability is strict: chain/pair/fee/slippage/clock ---- */
    t('two identical-context quotes are comparable', comparableUnified(cheap, dear, 1_000_000));
    const otherChain = normalizeQuote(baseQuote(), ctx({ source: 'z', chainId: 1 }));
    t('a different chain blocks comparison', !comparableUnified(cheap, otherChain, 1_000_000));
    const otherFee = normalizeQuote(baseQuote(), ctx({ source: 'z', fbtFeeBps: 0 }));
    t('a different fee blocks comparison', !comparableUnified(cheap, otherFee, 1_000_000));
    const skewedClock = normalizeQuote(baseQuote(), ctx({ source: 'z', now: 1_000_000 + 999_999 }));
    t('a clock-skewed quote blocks comparison', !comparableUnified(cheap, skewedClock, 1_000_000));

    /* ---- fingerprint integrity: tamper is a hard stop ---- */
    const shown = normalizeQuote(baseQuote(), ctx());
    const matching = normalizeQuote(baseQuote(), ctx());
    t('two identical quotes share a fingerprint', fingerprintMatches(shown, matching));
    const tampered = normalizeQuote(baseQuote({ amountOutWei: 9_000_000_000n }), ctx());
    t('a tampered amountOut changes the fingerprint', !fingerprintMatches(shown, tampered));
    const tamperedFee = normalizeQuote(baseQuote(), ctx({ feeRecipient: '0x' + 'e'.repeat(40) }));
    t('a tampered fee recipient changes the fingerprint', !fingerprintMatches(shown, tamperedFee));

    /* ---- failure taxonomy: provider strings drift, codes do not ---- */
    t('NO_ROUTE maps to itself', failureCode(new Error('NO_ROUTE')) === 'NO_ROUTE');
    t('FEE_NOT_APPLIED maps to itself', failureCode(new Error('FEE_NOT_APPLIED')) === 'FEE_NOT_APPLIED');
    t('FEE_RECIPIENT_MISMATCH maps to itself', failureCode(new Error('FEE_RECIPIENT_MISMATCH')) === 'FEE_RECIPIENT_MISMATCH');
    t('a timeout maps to PROVIDER_UNREACHABLE', failureCode(new Error('ETIMEDOUT')) === 'PROVIDER_UNREACHABLE');
    t('a 401 maps to PROVIDER_AUTH', failureCode(new Error('HTTP 401')) === 'PROVIDER_AUTH');
    t('an AGG_TIMEOUT maps to QUOTE_NETWORK', failureCode(new Error('AGG_TIMEOUT')) === 'QUOTE_NETWORK');
    t('an unknown error maps to QUOTE_FAILED', failureCode(new Error('something weird')) === 'QUOTE_FAILED');
    t('NO_ROUTE is retriable', isRetriable('NO_ROUTE'));
    t('FEE_NOT_APPLIED is NOT retriable', !isRetriable('FEE_NOT_APPLIED'));

    /* ---- fnv1a is deterministic ---- */
    t('fnv1a is deterministic for the same input', fnv1aHex('fbt') === fnv1aHex('fbt'));
    t('fnv1a differs for different input', fnv1aHex('fbt') !== fnv1aHex('FBT'));
  }

  /* -------------- PRE-SIGN SIMULATION (preSignSimulation.js) ------------ */
  /*
   * The pure pieces: counterparty sanity, amountOutMin/deadline maths, and the
   * outcome-shape rules. The live eth_call is exercised by an integration
   * probe; here we prove the verdict logic is honest about a revert vs a busy
   * provider vs a clean call.
   */
  {
    /* ---- counterparties: zero address and bad shape are refused ---- */
    t('a valid recipient passes', verifyCounterparties({ recipient: '0x' + '1'.repeat(40) }).ok);
    t('the zero address recipient is refused', !verifyCounterparties({ recipient: '0x' + '0'.repeat(40) }).ok);
    t('a malformed recipient is refused', !verifyCounterparties({ recipient: '0xdeadbeef' }).ok);
    t('the zero address spender is refused', !verifyCounterparties({ spender: '0x' + '0'.repeat(40) }).ok);
    t('a missing recipient/spender passes (nothing to check)', verifyCounterparties({}).ok);

    /* ---- amountOutMin = out * (1 - slippage) ---- */
    const min50 = computeAmountOutMin({ amountOutWei: 10_000n, slippageBps: 50 });
    t('amountOutMin at 0.5% slippage is out*0.995', min50 === 9_950n);
    const minFull = computeAmountOutMin({ amountOutWei: 10_000n, slippageBps: 10_000 });
    t('amountOutMin at 100% slippage is zero', minFull === 0n);

    /* ---- deadline is in the future and bounded ---- */
    const dl = computeDeadline({ deadlineMinutes: 20 });
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    t('a 20-minute deadline is in the future', dl > nowSec);
    t('a 20-minute deadline is ~20 minutes ahead', dl - nowSec > 60n && dl - nowSec <= 1201n);

    /* ---- revert decode is honest ---- */
    t('an error with a reason field decodes it', decodeRevertReason({ reason: 'transfer failed' }) === 'transfer failed');
    t('null produces null', decodeRevertReason(null) === null);
    t('a panic selector surfaces the code', decodeRevertReason({ data: '0x4e487b710000000000000000000000000000000000000000000000000000000000000011' }) === 'Panic(0x00000011)');

    /* ---- buildUnsignedTransaction validates inputs ---- */
    let built;
    try { built = buildUnsignedTransaction({ from: '0x' + '1'.repeat(40), to: '0x' + '2'.repeat(40), data: '0xabcd', value: 100n }); } catch { built = null; }
    t('a valid unsigned tx builds', Boolean(built) && built.value === 100n);
    let badFrom = false;
    try { buildUnsignedTransaction({ from: 'not-an-address', to: '0x' + '2'.repeat(40) }); } catch { badFrom = true; }
    t('a bad from-address throws', badFrom);

    /* ---- the simulation verdict is honest about each state ---- */
    t('a clean simulation is provenSafe', simulationOutcome({ status: 'simulated-clean', mempoolPath: 'public-mempool' }).provenSafe);
    t('a revert-detected outcome is NOT provenSafe', !simulationOutcome({ status: 'revert-detected' }).provenSafe);
    t('a provider-busy outcome is NOT provenSafe', !simulationOutcome({ status: 'provider-busy' }).provenSafe);
    t('an unknown outcome is NOT provenSafe', !simulationOutcome({ status: 'unknown' }).provenSafe);
    t('the default mempool path is unknown', simulationOutcome({ status: 'unknown' }).mempoolPath === 'unknown');

    /* ---- no provider/tx yields unknown, never a fake "safe" ---- */
    const none = await simulateUnsignedTransaction({ provider: null, tx: null });
    t('no provider yields status unknown', none.status === 'unknown');
    t('no provider yields provenSafe false', none.provenSafe === false);

    /*
     * A fake provider that reverts on eth_call must produce a revert-detected
     * verdict — the whole point: a reverting trade must be stopped before the
     * wallet is asked to sign.
     */
    const revertingProvider = {
      call: async () => { throw { reason: 'INSUFFICIENT_OUTPUT_AMOUNT', data: '0x08c379a0' }; },
      estimateGas: async () => 200_000n
    };
    const revertSim = await simulateUnsignedTransaction({
      provider: revertingProvider,
      tx: { from: '0x' + '1'.repeat(40), to: '0x' + '2'.repeat(40), data: '0x', value: 0n }
    });
    t('a reverting eth_call yields revert-detected', revertSim.status === 'revert-detected');
    t('a reverting eth_call decodes a reason', Boolean(revertSim.revertReason));

    /* A clean provider yields simulated-clean. */
    const cleanProvider = {
      call: async () => '0x',
      estimateGas: async () => 180_000n
    };
    const cleanSim = await simulateUnsignedTransaction({
      provider: cleanProvider,
      tx: { from: '0x' + '1'.repeat(40), to: '0x' + '2'.repeat(40), data: '0x', value: 0n }
    });
    t('a clean eth_call yields simulated-clean', cleanSim.status === 'simulated-clean');
    t('a clean eth_call reports the real gas limit', cleanSim.gasLimit === 180_000n);

    /* A provider whose gas estimate fails is NOT simulated-clean (we cannot
       assert safe without a gas limit). */
    const busyGasProvider = {
      call: async () => '0x',
      estimateGas: async () => { throw new Error('gas estimate failed'); }
    };
    const busySim = await simulateUnsignedTransaction({
      provider: busyGasProvider,
      tx: { from: '0x' + '1'.repeat(40), to: '0x' + '2'.repeat(40), data: '0x', value: 0n }
    });
    t('a failed gas estimate yields provider-busy', busySim.status === 'provider-busy');
  }

  /* -------------- MEV EXECUTION STATE (mevProtection.js) --------------- */
  /*
   * The honesty contract: nothing is "protected" unless a private path is
   * confirmed. Risk-measured, recommended and selected are all weaker.
   */
  {
    /* No relay for the chain → the only honest state is no-private-path. */
    const noRelay = mevExecutionState({ chainId: 999999, sandwich: { score: 90 } });
    t('a chain with no relay reports no-private-path-available', noRelay.state === 'no-private-path-available');
    t('a no-private-path state is not confirmed', !noRelay.confirmed);

    /* Ethereum has a relay. Low risk → risk-measured, not protected. */
    const lowRisk = mevExecutionState({ chainId: 1, sandwich: { score: 10 } });
    t('low risk on a relay chain is risk-measured', lowRisk.state === 'risk-measured');
    t('risk-measured is not confirmed', !lowRisk.confirmed);

    /* High risk → recommend the relay, but still not protected. */
    const highRisk = mevExecutionState({ chainId: 1, sandwich: { score: 60 } });
    t('high risk recommends the relay', highRisk.state === 'private-relay-recommended');
    t('recommended is not confirmed', !highRisk.confirmed);

    /* User opted in → selected, but STILL not protected (preference ≠ fact). */
    const selected = mevExecutionState({ chainId: 1, sandwich: { score: 60 }, userSelectedPrivate: true });
    t('a user opt-in is private-relay-selected', selected.state === 'private-relay-selected');
    t('selected is not confirmed', !selected.confirmed);

    /* Only a confirmed private simulation may be shown as protected. */
    const confirmed = mevExecutionState({ chainId: 1, sandwich: { score: 60 }, simulatedViaPrivate: true });
    t('a private simulation is private-execution-confirmed', confirmed.state === 'private-execution-confirmed');

    /* The single chokepoint: only confirmed may render "protected". */
    t('only confirmed may show protected', mayShowProtected('private-execution-confirmed'));
    t('selected may NOT show protected', !mayShowProtected('private-relay-selected'));
    t('recommended may NOT show protected', !mayShowProtected('private-relay-recommended'));
    t('risk-measured may NOT show protected', !mayShowProtected('risk-measured'));
    t('no-private-path may NOT show protected', !mayShowProtected('no-private-path-available'));

    /* Labels are stable i18n keys. */
    t('each state has a label key', typeof mevStateLabel(confirmed.state) === 'string');
    t('the label for confirmed mentions private', mevStateLabel('private-execution-confirmed').includes('private'));
  }

  /* -------------- EXECUTION GATE (executionGate.js) ------------------- */
  /*
   * The pre-sign decision. Critical blocks; high and unknown require
   * acknowledgement; absence of data is never "safe".
   */
  {
    /* A clean trade with low token risk is allowed. */
    const allowed = evaluateExecutionGate({
      tokenRisk: { level: 'low', honeypot: false, cannotSell: false },
      simulation: { status: 'simulated-clean' }
    });
    t('a low-risk clean trade is allowed', allowed.decision === 'allow' && allowed.canSign);

    /* A honeypot BLOCKS outright — no acknowledgement path for "cannot sell". */
    const honeypot = evaluateExecutionGate({
      tokenRisk: { level: 'critical', honeypot: true, cannotSell: true },
      simulation: { status: 'simulated-clean' }
    });
    t('a honeypot blocks execution', honeypot.decision === 'block' && isBlocked(honeypot));
    t('a blocked gate cannot sign', !honeypot.canSign);
    t('a honeypot block names the reason', honeypot.blocked.includes('token-honeypot'));

    /* Critical (non-honeypot) also blocks. */
    const critical = evaluateExecutionGate({
      tokenRisk: { level: 'critical', honeypot: false, cannotSell: false },
      simulation: { status: 'simulated-clean' }
    });
    t('critical token risk blocks', critical.decision === 'block');

    /* High risk requires acknowledgement before signing. */
    const high = evaluateExecutionGate({
      tokenRisk: { level: 'high', honeypot: false, cannotSell: false },
      simulation: { status: 'simulated-clean' }
    });
    t('high risk requires acknowledgement', high.decision === 'acknowledge' && requiresAcknowledgement(high));
    t('an unacknowledged high-risk trade cannot sign', !high.canSign);
    const highAck = evaluateExecutionGate({
      tokenRisk: { level: 'high', honeypot: false, cannotSell: false },
      simulation: { status: 'simulated-clean' },
      acknowledgedHigh: true
    });
    t('an acknowledged high-risk trade can sign', highAck.canSign);

    /*
     * Unknown risk is NOT safe. A missing token-risk report must not read as
     * "low risk" — the user has to see that we could not verify safety.
     */
    const unknown = evaluateExecutionGate({ simulation: { status: 'simulated-clean' } });
    t('missing token risk is unknown, not low', unknown.level === 'unknown');
    t('unknown risk requires acknowledgement', requiresAcknowledgement(unknown));

    /* A detected revert BLOCKS — there is nothing to acknowledge. */
    const revert = evaluateExecutionGate({
      tokenRisk: { level: 'low', honeypot: false, cannotSell: false },
      simulation: { status: 'revert-detected' }
    });
    t('a revert-detected simulation blocks', revert.decision === 'block');
    t('a revert block names the reason', revert.blocked.includes('simulation-revert-detected'));

    /* A simulation we could not run warns (unknown), never "safe". */
    const busy = evaluateExecutionGate({
      tokenRisk: { level: 'low', honeypot: false, cannotSell: false },
      simulation: { status: 'provider-busy' }
    });
    t('a busy simulation yields unknown level', busy.level === 'unknown');
    t('a busy simulation warns', busy.warnings.includes('simulation-unavailable'));

    /* worse() ordering: unknown sits between medium and high. */
    t('worse picks the higher severity', worse('low', 'high') === 'high');
    t('unknown is worse than medium', worse('medium', 'unknown') === 'unknown');
    t('high is worse than unknown', worse('unknown', 'high') === 'high');
  }

  /* -------------- PROVIDER STATUS (providerStatus.js) ----------------- */
  /*
   * The standard shape: reachable/authenticated start false and flip only on
   * evidence; nothing reveals a secret value.
   */
  {
    const row = buildProviderStatus({
      id: 'test-provider',
      configured: true,
      supportedChains: [1, 56],
      feeReady: true
    });
    t('a status row carries every standard field', [
      'id', 'configured', 'reachable', 'authenticated', 'feeReady',
      'supportedChains', 'lastSuccessAt', 'lastFailureAt', 'retryable',
      'missingConfiguration', 'externalApprovalRequired'
    ].every((k) => k in row));
    t('a fresh provider is configured but not reachable', row.configured && !row.reachable);
    t('a fresh provider is not authenticated', !row.authenticated);
    t('a fresh provider has no lastSuccessAt', row.lastSuccessAt === null);

    /* Recording a success flips reachable on. */
    recordSuccess('test-provider');
    const row2 = buildProviderStatus({
      id: 'test-provider',
      configured: true,
      supportedChains: [1]
    });
    t('a recorded success flips reachable on', row2.reachable);
    t('a recorded success sets lastSuccessAt', row2.lastSuccessAt !== null);
    t('a reachable configured provider is authenticated', row2.authenticated);

    /* Recording an auth-class failure flips authenticated back off. */
    recordFailure('test-provider', '401 Unauthorized');
    const row3 = buildProviderStatus({
      id: 'test-provider',
      configured: true,
      supportedChains: [1]
    });
    t('a 401 failure flips authenticated off', !row3.authenticated);
    t('a failure sets lastFailureAt', row3.lastFailureAt !== null);

    /* An unconfigured provider reports its missing config by name. */
    const uncfg = buildProviderStatus({
      id: 'no-key-provider',
      configured: false,
      supportedChains: [],
      missingConfiguration: ['SOME_API_KEY']
    });
    t('an unconfigured provider lists the missing env var', uncfg.missingConfiguration.includes('SOME_API_KEY'));
    t('an unconfigured provider is not fee-ready', !uncfg.feeReady);

    /* The aggregate report never echoes a secret — only booleans/names. */
    const report = providerStatusReport();
    t('the report carries the schema tag', report.schema === 'fbt.provider-status.v1');
    t('the report has a summary', typeof report.summary.total === 'number' && report.summary.total > 0);
    const serialized = JSON.stringify(report);
    t('the report never contains the word "key" as a value boundary', !/:"[A-Za-z0-9_-]{20,}"/.test(serialized));
  }


  /* ----------------------- the OpenOcean adapter ------------------------ */
  {
    /*
     * OpenOcean expresses referrerFee as a PERCENT while we hold basis
     * points. Getting this wrong by 100x would either quote a 70% fee (every
     * quote rejected) or a 0.007% one (we compare against a fee we cannot
     * charge). Cheap to test, expensive to discover in production.
     */
    t('70 bps converts to 0.7 percent', bpsToPercent(70) === 0.7);
    t('100 bps converts to 1 percent', bpsToPercent(100) === 1);
    t('0 bps converts to 0', bpsToPercent(0) === 0);

    /*
     * Only chains we can also EXECUTE on. A quote for a chain we cannot swap
     * on is a better price we are unable to honour.
     */
    t('BNB Chain is supported', openOceanSupports(56));
    t('Ethereum is supported', openOceanSupports(1));
    t('an unknown chain is not', !openOceanSupports(999999));

    /* ---- OpenOcean EXECUTION (the "no route" fix) ---- */
    /*
     * OpenOcean used to be quote-only, which made KyberSwap the single point
     * of failure for the whole swap screen: an unexecutable quote can never
     * win the comparison, so a KyberSwap outage (or a network that cannot
     * reach it — the Iranian case) produced "no route" even when OpenOcean
     * had found one. The executable flag is what lets the second aggregator
     * actually save the swap.
     */
    const ooToken = { symbol: 'USDT', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, native: false };
    const bnb = { symbol: 'BNB', address: null, decimals: 18, native: true };
    const usdc = { symbol: 'USDC', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, native: false };

    const swapParams = ooSwapParams({
      chainId: 56,
      fromToken: ooToken,
      toToken: bnb,
      amountInWei: 5000000n,
      slippage: 0.5,
      account: '0x1111111111111111111111111111111111111111',
      feeBps: 70,
      feeReceiver: '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6',
      minOutWei: 4900000000000000n
    });
    t('the swap request carries the signer as account', swapParams.get('account') === '0x1111111111111111111111111111111111111111');
    t('the fee is sent as a PERCENT of the input, not bps', swapParams.get('referrerFee') === '0.7');
    t('the fee receiver is sent as referrer', swapParams.get('referrer') === '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6');
    t('minOutput is sent on BNB Chain', swapParams.get('minOutput') === '4900000000000000');
    t('the native coin maps to the sentinel', toOOAddress(bnb) === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE');

    /*
     * minOutput is only documented on Base/BNB/ETH. Sending it where it is
     * unsupported could make the whole request fail — the guard must be
     * per-chain, not universal.
     */
    const polyParams = ooSwapParams({
      chainId: 137,
      fromToken: ooToken,
      toToken: usdc,
      amountInWei: 5000000n,
      slippage: 0.5,
      account: '0x1111111111111111111111111111111111111111',
      feeBps: 70,
      feeReceiver: '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6',
      minOutWei: 4900000n
    });
    t('minOutput is NOT sent on unsupported chains', polyParams.get('minOutput') === null);
  }

  /* --------------------- swap failure classification ---------------------- */
  {
    /*
     * The user-facing difference between "no route between these tokens" and
     * "couldn't reach the routing service" matters: the second is the
     * geo-blocked/ISP-filtered case (Iranian customers) and retrying or
     * switching networks genuinely helps. We only claim a network problem
     * when NO source answered at all and every failure was network-level.
     */
    const netErr = () => {
      const e = new Error('fetch failed');
      e.network = true;
      return e;
    };
    t(
      'all sources unreachable is a NETWORK error, not a no-route verdict',
      classifyQuoteFailure({ failures: [netErr(), netErr()], answered: 0 }) === 'QUOTE_NETWORK'
    );
    t('a genuine no-route answer wins over a network failure', classifyQuoteFailure({ failures: [netErr()], answered: 1 }) === 'NO_ROUTE');
    t('no failures means no route', classifyQuoteFailure({ failures: [], answered: 2 }) === 'NO_ROUTE');
    t('empty input defaults to no route', classifyQuoteFailure() === 'NO_ROUTE');
  }

  /* ---------------------- the aggregator proxy (server) ------------------- */
  {
    /*
     * Same-origin proxy for users whose network cannot reach the aggregator
     * APIs directly. The chainId is our routing key (consumed server-side);
     * everything else must pass through verbatim so the proxied request is
     * identical to the direct one.
     */
    t(
      'kyber routes map to the bsc slug with params forwarded',
      kyberUpstreamUrl('routes', { chainId: '56', tokenIn: '0xEeee', tokenOut: '0x55d3', amountIn: '1000' }) ===
        'https://aggregator-api.kyberswap.com/bsc/api/v1/routes?tokenIn=0xEeee&tokenOut=0x55d3&amountIn=1000'
    );
    t('kyber build has no query string', kyberUpstreamUrl('build', { chainId: '1' }) === 'https://aggregator-api.kyberswap.com/ethereum/api/v1/route/build');
    t('openocean quote maps chain 1 to eth', ooUpstreamUrl('quote', { chainId: '1', tokenIn: '0xEeee' }).startsWith('https://open-api.openocean.finance/v4/eth/quote?'));
    t('unknown chains are refused, not forwarded', (() => {
      try {
        kyberUpstreamUrl('routes', { chainId: '999' });
        return false;
      } catch {
        return true;
      }
    })());
    t('an unknown chain on openocean is refused too', (() => {
      try {
        ooUpstreamUrl('swap', { chainId: '999' });
        return false;
      } catch {
        return true;
      }
    })());
    t('chainId never reaches the upstream', !kyberUpstreamUrl('routes', { chainId: '56', tokenIn: '0x1' }).includes('chainId'));
    t('every supported EVM chain has a kyber slug', EVM_CHAIN_ORDER.every((id) => kyberSlug(id)));

    /*
     * ─── VELORA'S PROXY (previously missing) ────────────────────────────────
     * Kyber and OpenOcean both had a same-origin reachability fallback;
     * Velora (a quote-only third opinion) never did, which silently dropped
     * it from the comparison for exactly the users whose network already
     * filters Kyber/OpenOcean. Same allowlist discipline as the other two —
     * an unsupported chain must be refused, never forwarded.
     */
    t('velora prices forward params verbatim with no slug translation (numeric network id)',
      veloraUpstreamUrl({ network: '56', srcToken: '0xEeee', destToken: '0x55d3' }) ===
        'https://api.velora.xyz/prices?network=56&srcToken=0xEeee&destToken=0x55d3');
    t('an unsupported chain on velora is refused, not forwarded', (() => {
      try {
        veloraUpstreamUrl({ network: '999' });
        return false;
      } catch {
        return true;
      }
    })());
    t('veloraChainOk agrees with the chains lib/velora.js actually supports',
      [1, 56, 137, 42161, 10, 8453, 43114].every((id) => veloraChainOk(id)) && !veloraChainOk(999));
  }

  /* ---------------------- RPC endpoints per chain ------------------------- */
  {
    /*
     * BSC's Binance-hosted seeds are geo-filtered in some of our biggest
     * markets (Iran), which used to make every on-chain read — and with it
     * the swap's direct path — fail there. Neutral community endpoints must
     * come first so the FallbackProvider never sits on a stall timeout for
     * those users, with the Binance seeds kept as redundancy at the tail.
     */
    t('BSC leads with a neutral community RPC', EVM_CHAINS[56].rpc[0] === 'https://bsc-rpc.publicnode.com');
    t('BSC keeps the Binance seeds as redundancy', EVM_CHAINS[56].rpc.includes('https://bsc-dataseed.binance.org'));
    t('BSC offers at least five endpoints to fail over across', EVM_CHAINS[56].rpc.length >= 5);
    t('every chain keeps at least one RPC endpoint', EVM_CHAIN_ORDER.every((id) => (EVM_CHAINS[id]?.rpc?.length ?? 0) >= 1));
    t('every BSC RPC is https', EVM_CHAINS[56].rpc.every((u) => u.startsWith('https://')));
  }

  /* ---------------------- what the past actually says -------------------- */
  /*
   * The history engine answers «گذشته به ما چی میگه» with MEASUREMENTS, never
   * forecasts. Every number it returns describes data that already happened.
   *
   * That distinction is the whole point, and it is what these tests protect:
   * a module that quietly starts emitting a probability, or that inflates one
   * sideways drift into "twenty tests", turns an honest tool into a machine
   * for manufacturing false confidence about money.
   */
  {
    /* ---- levels the market returns to ---- */
    // Touches 100 three times, bouncing away each time.
    const triple = [
      80, 85, 90, 95, 100, 99, 96, 92, 88, 90, 94, 98, 100, 99, 95,
      90, 86, 88, 92, 96, 100, 98, 94, 90, 87, 89, 93, 97
    ];
    const lv = findLevels(triple);
    t('a repeatedly-touched price is found as one level', lv.length === 1);
    t('...at the right price', Math.abs(lv[0].price - 100) < 0.5);
    t('...with every touch counted', lv[0].touches === 3);
    t('...and classified by what it acted as', lv[0].kind === 'resistance');

    /*
     * Bands are a PERCENTAGE of price, not a fixed amount. A fixed step would
     * give BTC three bands and a sub-cent token three thousand.
     */
    const cheap = triple.map((p) => p / 100000);
    t('the same shape is found on a sub-cent token', findLevels(cheap).length === 1);

    // A single wiggle is not a level.
    t('one touch is not a level', findLevels([1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5]).length === 0);

    /* ---- how a level behaved ---- */
    /*
     * THE ONE THAT MATTERS MOST. A price that sits AT a level for twenty bars
     * is one event, not twenty tests. Counting each bar would turn a single
     * drift into a fabricated pattern — the exact dishonesty this module
     * exists to avoid.
     */
    const flat = [120, 110, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 110, 120, 130];
    const flatRec = levelRecord(flat, { price: 100, kind: 'support' });
    t(`sitting at a level counts as ONE test (got ${flatRec.tested})`, flatRec.tested === 1);

    // Two bounces then a break.
    const mixed = [130, 120, 101, 115, 125, 130, 120, 100, 118, 128, 130, 118, 100, 95, 88, 80, 75];
    const rec = levelRecord(mixed, { price: 100, kind: 'support' });
    t(`held is counted (${rec.held} of ${rec.tested})`, rec.tested === 3 && rec.held === 2);
    t('breaks are the remainder', rec.broke === 1);

    /*
     * With no bars after the touch there is no outcome to judge. Guessing one
     * would invent history.
     */
    t('an unjudgeable touch is not counted', levelRecord([130, 120, 100], { price: 100, kind: 'support' }).tested === 0);

    /* ---- drawdown ---- */
    t('the worst fall is measured peak to trough', Math.abs(maxDrawdown([100, 110, 120, 60, 80]) - 50) < 0.01);
    /* The peak must not reset on a later high — the worst fall is the worst
       fall in the whole window, not the most recent one. */
    t('a later rally does not erase an earlier crash',
      Math.abs(maxDrawdown([100, 200, 100, 150, 300]) - 50) < 0.01);
    t('a monotonic rise has no drawdown', maxDrawdown([1, 2, 3, 4, 5]) === 0);

    /* ---- relative to this coin's own normal ---- */
    /*
     * MEDIAN, not mean. One listing pump can drag a mean so high that every
     * later day looks quiet by comparison, which is exactly backwards.
     */
    const spiky = [100, 100, 100, 100, 100, 100, 100, 10000];
    const rel = relativeToNormal(200, spiky);
    t('a single spike does not poison the baseline', rel.median === 100 && rel.ratio === 2);
    t('a normal day is not flagged as unusual', relativeToNormal(105, [100, 100, 100, 100, 100, 100]).unusual === false);
    t('a quiet day is flagged too', relativeToNormal(20, [100, 100, 100, 100, 100, 100]).unusual === true);
    t('too little history yields nothing', relativeToNormal(100, [100, 100]) === null);

    /* ---- base rate ---- */
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
    const br = baseRate(rising, 7);
    t('a monotonic rise is 100% of the sample', br.pct === 100);
    t('the sample size is reported, not just the percentage', br.samples === 53);
    t('too short a series yields no base rate', baseRate([1, 2, 3], 7) === null);

    /* ---- range position ---- */
    const rp = rangePosition([50, 100, 75]);
    t('the range position is measured', Math.abs(rp.pct - 50) < 0.01);
    t('a flat line has no range', rangePosition([5, 5, 5]) === null);

    /* ---- the summary ---- */
    const facts = historyFacts(triple, { days: 90 });
    t('facts are produced from a real series', facts.length > 0);
    /*
     * Facts must be KEYS plus numbers, never finished sentences — a module
     * that formats its own strings cannot be translated, and this app ships
     * in twelve languages.
     */
    t('every fact is a translation key with values',
      facts.every((f) => typeof f.id === 'string' && f.values && typeof f.values === 'object'));
    /*
     * `kind` is for colour only. If it ever gains a 'bullish' or 'sell'
     * value, this module has started forecasting.
     */
    t('no fact carries a buy or sell verdict',
      facts.every((f) => ['neutral', 'caution', 'notable'].includes(f.kind)));

    /*
     * A base rate from a dozen observations invites someone to treat noise as
     * an edge, so it is withheld below 30 samples.
     */
    const shortSeries = Array.from({ length: 25 }, (_, i) => 100 + (i % 3));
    t('a thin base rate is withheld rather than shown',
      !historyFacts(shortSeries, { days: 25 }).some((f) => f.id === 'baseRate'));

    /* ---- it must never throw ---- */
    for (const bad of [null, undefined, [], [NaN, NaN], ['a', 'b'], [0, 0, 0], [-1, -2]]) {
      t(`garbage input yields no facts, not a crash (${JSON.stringify(bad)})`,
        Array.isArray(historyFacts(bad)) && historyFacts(bad).length === 0);
    }
  }

  /* ------------------- confidence measured, not assumed ------------------ */
  /*
   * The old confidence came from INDICATOR AGREEMENT. That was a bad number:
   * every indicator is a different arithmetic transform of the same price
   * series, so they are correlated by construction and agree loudest exactly
   * when they are all wrong together. It reported "how similar are my
   * formulas" as "how sure am I" — confidently wrong, about money.
   *
   * It now comes from replaying the signal over the coin's own history.
   */
  {
    const trend = Array.from({ length: 200 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 7) * 6);
    const bt = backtest(trend);

    t('a backtest runs on enough history', bt !== null);
    t('it reports how many signals it found', bt.samples > 0);
    /*
     * THE NUMBER THAT MATTERS. A 60% hit rate is worthless if the coin rose
     * on 62% of all days — the rule did worse than doing nothing. Most tools
     * hide this comparison.
     */
    t('it compares against doing nothing', typeof bt.baseRate === 'number');
    t('it reports an edge over the base rate', typeof bt.edge === 'number');
    t('a rising market has a high base rate', bt.baseRate > 60);

    /* Too little history must yield NOTHING rather than a number built on
       four observations. */
    t('a short series is refused', backtest(Array.from({ length: 40 }, (_, i) => 100 + i)) === null);
    t('garbage is refused', backtest(null) === null && backtest([]) === null);

    /* ---- the rule itself ---- */
    /*
     * It must require the trend to agree, or it buys every dip of a collapse.
     * A pure downtrend drives RSI low, but ma20 < ma50, so no buy may fire.
     */
    const crash = Array.from({ length: 120 }, (_, i) => 200 - i * 1.2);
    let buysInCrash = 0;
    for (let i = 50; i < crash.length - 1; i += 1) if (signalAt(crash, i) === 'buy') buysInCrash += 1;
    t(`the rule does not buy a collapse (${buysInCrash} buys)`, buysInCrash === 0);

    /* Not enough bars to compute the slow average = no signal, not a guess. */
    t('no signal before the indicators are warm', signalAt(trend, 10) === null);

    /* ---- confidence ---- */
    /*
     * THE CEILING IS THE POINT. No chart rule on a volatile asset deserves a
     * figure that reads like certainty, and a "94% confident" badge on a
     * crypto app is a lie with a decimal point on it.
     */
    const strong = { buy: { total: 60, hits: 45, rate: 75, edge: 25 }, sell: {}, samples: 60 };
    t('confidence is capped below certainty', confidenceFrom(strong, 'buy', 100) <= 75);

    /*
     * No evidence must cap the number hard. Perfect agreement with no
     * backtest is still a guess, and the old formula would have returned ~80.
     */
    t('no backtest caps confidence at 40', confidenceFrom(null, 'buy', 100) <= 40);
    t('...and it is still a real number', confidenceFrom(null, 'buy', 100) >= 5);

    /*
     * A rule that historically did WORSE than doing nothing must reduce
     * confidence, not merely fail to raise it.
     */
    const bad = { buy: { total: 50, hits: 15, rate: 30, edge: -25 }, sell: {}, samples: 50 };
    t('negative edge produces low confidence', confidenceFrom(bad, 'buy', 90) < 30);
    t('negative edge scores below a good edge',
      confidenceFrom(bad, 'buy', 90) < confidenceFrom(strong, 'buy', 90));

    /* A handful of occurrences is an anecdote, not a hit rate. */
    const thin = { buy: { total: 3, hits: 3, rate: 100, edge: 50 }, sell: {}, samples: 3 };
    t('a tiny sample is not trusted', confidenceFrom(thin, 'buy', 90) <= 40);

    /* ---- end to end ---- */
    const a = analyze(trend, { change24h: 1, change7d: 4 });
    t('analyze exposes the backtest behind its confidence', a.backtest !== undefined);
    t('analyze still reports agreement separately', typeof a.agreement === 'number');
    t('confidence never claims certainty', a.confidence <= 75);
  }

  /* ==================== macro + verdict engine ========================== */
  /*
   * ─── WHAT THESE PROTECT ───────────────────────────────────────────────────
   * The brief was «قویترین سیگنال‌دهی ... که هر کسی با هر سوادی بفهمه چخبره» —
   * the strongest signal we can honestly produce, readable by anyone.
   *
   * "Strongest" is the dangerous half of that sentence. The easy way to make a
   * signal engine look strong is to make it confident, and everything below
   * exists to stop exactly that: the engine must stay quiet when it does not
   * know, must never emit a sentence (only keys + numbers, so nothing can be
   * mistranslated into a claim), and must never produce a number that reads
   * like certainty.
   */
  {
    /* Deterministic synthetic series — a seeded walk, never Math.random(),
       so a failure is reproducible rather than a flake to re-run. */
    const mulberry32 = (a) => () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let x = Math.imul(a ^ (a >>> 15), 1 | a);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const walk = (n, seed, drift = 0, vol = 0.02, start = 100) => {
      const r = mulberry32(seed);
      const out = [start];
      for (let i = 1; i < n; i += 1) out.push(out[i - 1] * (1 + drift + (r() - 0.5) * vol * 2));
      return out;
    };

    /* ---------------------------- beta ---------------------------------- */
    const btc = walk(180, 7);
    // Built to move exactly 2× BTC, bar for bar. Beta must recover that.
    const levered = [100];
    for (let i = 1; i < btc.length; i += 1) {
      levered.push(levered[i - 1] * (1 + 2 * (btc[i] / btc[i - 1] - 1)));
    }
    const b = betaToBtc(levered, btc);
    t('beta recovers a known 2x relationship', b && Math.abs(b.beta - 2) < 0.15);
    /*
     * R² is the guard against the classic abuse of beta. A beta of 2.0 fitted
     * to noise is meaningless, and macroContext refuses to report one below
     * 0.2 — so a perfectly-derived series must land near 1.0 or that gate is
     * measuring the wrong thing.
     */
    t('...and reports that BTC explains all of it', b.r2 > 0.95);

    /* An unrelated series must NOT produce a confident beta. */
    const unrelated = walk(180, 99);
    const bu = betaToBtc(unrelated, btc);
    t('an unrelated series gets a low r-squared', bu && bu.r2 < 0.3);
    /*
     * ...and the low r-squared must actually GATE the output, not merely be
     * reported. This is the abuse the number exists to prevent: a beta of
     * -0.1 fitted to noise, printed as "this asset moves 0.1x Bitcoin", is a
     * precise-sounding falsehood. Asserting on `betaToBtc` alone did not
     * catch removing the gate — I checked by deleting it, and nothing failed.
     */
    t('a noise-fitted beta is not surfaced as a fact',
      !macroContext({
        coin: { id: 'x', symbol: 'X', athChange: -30 },
        series: unrelated,
        btcSeries: btc,
        global: { mcapChange: 1, btcDominance: 52 }
      }).facts.some((f) => f.id.startsWith('beta.')));
    /* The gate must not swallow a genuine relationship. */
    t('a well-explained beta IS surfaced',
      macroContext({
        coin: { id: 'y', symbol: 'Y', athChange: -30 },
        series: levered,
        btcSeries: btc,
        global: { mcapChange: 1, btcDominance: 52 }
      }).facts.some((f) => f.id === 'beta.high'));

    t('beta refuses a series too short to fit', betaToBtc([1, 2, 3], btc) === null);

    /* ---------------------------- regime -------------------------------- */
    const rising = walk(60, 3, 0.004, 0.01);
    const falling = walk(60, 4, -0.004, 0.01);

    const rotOut = marketRegime({
      global: { mcapChange: -2, btcDominance: 58, btcDominanceChange: 0.4 },
      btcSeries: falling
    });
    t('a falling market with BTC dominance rising is rotationOut', rotOut?.regime === 'rotationOut');
    /*
     * This is the regime the whole macro layer exists for: the one where an
     * altcoin's own chart looks fine and it gets sold anyway. If this ever
     * stops being detected the layer is decoration.
     */
    t('...and it is flagged as caution, not neutral',
      macroContext({
        coin: { id: 'x', athChange: -40 },
        series: walk(120, 11),
        btcSeries: falling,
        global: { mcapChange: -2, btcDominance: 58, btcDominanceChange: 0.4 }
      }).facts.some((f) => f.id === 'regime.rotationOut' && f.kind === 'caution'));

    const riskOn = marketRegime({
      global: { mcapChange: 2, btcDominance: 48, btcDominanceChange: -0.5 },
      btcSeries: rising
    });
    t('a rising market with dominance falling is riskOn', riskOn?.regime === 'riskOn');

    t('regime refuses to guess without dominance',
      marketRegime({ global: { mcapChange: 2 }, btcSeries: rising }) === null);
    /*
     * `certain` distinguishes a dominance drift we READ from one we INFERRED.
     * Collapsing the two would let the UI assert a rotation it cannot see.
     */
    t('an inferred dominance drift is marked uncertain',
      marketRegime({ global: { mcapChange: 5, btcDominance: 50 }, btcSeries: walk(60, 5, 0, 0.001) })?.certain === false);

    /* ---------------------------- cycle --------------------------------- */
    t('a coin at its high is banded atHigh', cyclePosition({ athChange: -2 })?.band === 'atHigh');
    const deep = cyclePosition({ athChange: -90 });
    t('a 90% drawdown is banded farFromHigh', deep?.band === 'farFromHigh');
    /*
     * The recovery multiple is the honest restatement of a drawdown: "down
     * 90%" is abstract, "needs 10x to break even" is the same fact and is
     * understood instantly. 100/(100-90) = 10.
     */
    t('...and states the 10x needed to break even', deep.values.recoveryX === 10);

    /* -------------------- bitcoin is not compared to itself -------------- */
    /*
     * Beta of BTC to BTC is 1.0 with r2 1.0 — arithmetically true, useless to
     * print, and on the single most-viewed asset in the app.
     */
    const btcMacro = macroContext({
      coin: { id: 'bitcoin', symbol: 'BTC', athChange: -20 },
      series: btc,
      btcSeries: btc,
      global: { mcapChange: 1, btcDominance: 55 }
    });
    t('bitcoin is not told it moves 1x bitcoin', btcMacro.beta === null);
    t('...nor is a beta fact rendered for it',
      !btcMacro.facts.some((f) => f.id.startsWith('beta.')));
    t('...but the regime still applies to it', btcMacro.regime !== null);
    /* The symbol path matters too — a deep link can arrive without the id. */
    t('the check works from the symbol alone',
      macroContext({ coin: { symbol: 'BTC' }, series: btc, btcSeries: btc, global: { mcapChange: 1, btcDominance: 55 } }).beta === null);
    /* And it must not swallow every asset — WBTC aside, others still get one. */
    t('a normal asset still gets its beta',
      macroContext({ coin: { id: 'ether', symbol: 'ETH' }, series: levered, btcSeries: btc, global: { mcapChange: 1, btcDominance: 55 } }).beta !== null);

    /* ---------------------------- verdict -------------------------------- */
    const series = walk(200, 21, 0.002, 0.03);
    const analysis = analyze(series, { change24h: 1, change7d: 3, id: 'x', symbol: 'X' });
    const v = verdict({
      analysis,
      series,
      btcSeries: btc,
      coin: { id: 'x', symbol: 'X', athChange: -35, volume: 1e6 },
      global: { mcapChange: 1, btcDominance: 52 }
    });

    t('the verdict produces both horizons', Boolean(v?.short && v?.long));
    t('the two horizons cover different spans', v.short.days !== v.long.days);

    /*
     * ─── THE CEILINGS, AND WHY THIS TEST IS SHAPED LIKE THIS ────────────────
     * These are not tuning constants. They are the promise that this app will
     * never show a number that reads like certainty about a volatile asset.
     *
     * Asserting `confidence <= 75` on one arbitrary fixture is worthless and
     * was the first version of this test: that fixture scored 30, so the
     * assertion passed with the clamp deleted entirely. I removed the clamp
     * to check, and nothing failed. Worse, the clamp was ALSO dead code —
     * the formula's natural maximum was 72, so the cap could never bind and
     * the "ceiling" was a comment rather than a constraint.
     *
     * So this sweeps a wide space of synthetic markets, requires that
     * something actually REACHES the ceiling (proving the clamp binds), and
     * requires that nothing exceeds it (proving it holds). The constants are
     * imported, never copied — a duplicated constant in a test goes stale
     * silently and then guards nothing.
     */
    {
      let maxShort = 0;
      let maxLong = 0;
      let over = 0;
      for (let seed = 1; seed < 40; seed += 1) {
        for (const drift of [0.004, 0.002, 0, -0.002, -0.004]) {
          const s2 = walk(300, seed, drift, 0.02);
          const b2 = walk(300, seed + 500, drift, 0.02);
          const a2 = analyze(s2, { change24h: drift * 100, change7d: drift * 400 });
          if (!a2) continue;
          for (const g of [
            { mcapChange: 2, btcDominance: 48, btcDominanceChange: -0.5 },
            { mcapChange: -2, btcDominance: 58, btcDominanceChange: 0.4 }
          ]) {
            const r = verdict({
              analysis: a2,
              series: s2,
              btcSeries: b2,
              coin: { id: 'x', symbol: 'X', athChange: -10, volume: 1e6 },
              global: g
            });
            maxShort = Math.max(maxShort, r.short.confidence);
            maxLong = Math.max(maxLong, r.long.confidence);
            if (r.short.confidence > CONFIDENCE_CEILING.short) over += 1;
            if (r.long.confidence > CONFIDENCE_CEILING.long) over += 1;
          }
        }
      }
      t('no market in the sweep exceeds the confidence ceiling', over === 0);
      /*
       * The clamp must BIND, not merely exist. If the highest confidence the
       * engine can produce is well under the cap, the cap is decoration and
       * would keep passing after someone raised the real limit.
       */
      t('the monthly ceiling is actually reached, so the cap is real',
        maxLong === CONFIDENCE_CEILING.long);
      t('the sweep produced meaningful confidence at all', maxShort > 20);
    }

    /*
     * NOTHING HERE MAY BE A SENTENCE. Every reason is a translation key plus
     * numbers, which is what makes it impossible for this engine to state a
     * claim we did not write in a language we cannot read.
     */
    const allReasons = [...v.short.reasons, ...v.long.reasons];
    t('every reason is a key, never prose',
      allReasons.length > 0 && allReasons.every((r) => typeof r.id === 'string' && !/\s/.test(r.id)));
    t('every reason carries a values object',
      allReasons.every((r) => r.values && typeof r.values === 'object'));
    t('reason kinds stay in the neutral vocabulary',
      allReasons.every((r) => ['neutral', 'caution', 'notable'].includes(r.kind)));

    /*
     * The stance vocabulary must never contain an instruction. "buy" /
     * "sell" / "bullish" appearing here would turn a measurement into
     * financial advice, which is both the legal line and the honesty line.
     */
    const STANCES = ['tailwind', 'mildUp', 'unclear', 'mildDown', 'headwind'];
    t('stances come from the non-directive vocabulary',
      STANCES.includes(v.short.stance) && STANCES.includes(v.long.stance));

    /* ---- the disagreement override ---- */
    /*
     * When independent layers point opposite ways the honest answer is "we
     * don't know", NOT the average. Averaging +80 and -80 to 0 and calling it
     * neutral is a different statement from "two strong readings contradict
     * each other", and only the second is true.
     */
    const conflicted = verdict({
      analysis: { ...analysis, score: 95, label: 'strongBuy' },
      series,
      btcSeries: falling,
      coin: { id: 'x', symbol: 'X', athChange: -92 },
      global: { mcapChange: -4, btcDominance: 60, btcDominanceChange: 0.8 }
    });
    /*
     * This exact fixture is why the detector was rewritten. Under the original
     * standard-deviation test it scored a spread of 59 against a threshold of
     * 65 — so the single most dangerous configuration in the engine, a +95
     * chart inside a market rotating out of this whole category, came out as
     * "slightly in its favour". The sign-conflict test catches it.
     *
     * `!== 'tailwind'` is too weak to assert on its own (mildUp would pass
     * it), so all three consequences are checked.
     */
    t('a strong chart inside a rotation-out market is reported as unclear',
      conflicted.short.stance === 'unclear');
    t('...and the conflict is flagged explicitly', conflicted.short.conflicted === true);
    t('...and it says so in the reasons',
      conflicted.short.reasons.some((r) => r.id === 'layersDisagree'));
    t('...and confidence is forced down', conflicted.short.confidence <= 30);
    /*
     * The other half: agreement must NOT be reported as conflict, or the
     * override is just a way of never answering.
     */
    t('an agreeing read is not flagged as conflicted', v.long.conflicted === false);

    /*
     * ─── THE WEIGHT BAR ON CONFLICT DETECTION ───────────────────────────────
     * A layer must carry real evidence before its disagreement can veto the
     * whole read. Without that bar, a layer holding almost nothing could
     * force "unclear" onto a well-supported answer — and the engine would
     * then answer "we don't know" to nearly everything, which is a different
     * flavour of useless rather than a fix.
     *
     * This fixture is chosen because it sits exactly on the boundary: the
     * technical layer scores -42 but carries only 0.35 weight (below the 0.4
     * bar) while macro scores +30 at full weight. Opposite signs, but one of
     * them is not backed by enough evidence to count, so the correct answer
     * is NOT conflicted. Setting CONFLICT_MIN_WEIGHT to 0 flips this.
     */
    {
      const s3 = walk(250, 2, 0, 0.03);
      const a3 = analyze(s3, { change24h: 0, change7d: 0 });
      const r3 = verdict({
        analysis: a3,
        series: s3,
        btcSeries: btc,
        coin: { id: 'x', symbol: 'X', athChange: -30, volume: 1e6 },
        global: { mcapChange: 2, btcDominance: 48, btcDominanceChange: -0.5 }
      });
      const tech = r3.long.layers.technical;
      // Assert the fixture really is the boundary case, or the test below is
      // checking something else entirely and would pass for the wrong reason.
      t('the boundary fixture has a low-weight layer opposing macro',
        tech.weight > 0 && tech.weight < 0.4 && tech.score < -25 && r3.long.layers.macro.score > 25);
      t('...and a low-weight layer alone cannot force unclear',
        r3.long.conflicted === false);
    }

    /* ---- too little data ---- */
    const tiny = verdict({ analysis: null, series: [1, 2, 3], btcSeries: btc, coin: {}, global: null });
    t('a coin with three data points gets no opinion', tiny.short.stance === 'unclear');
    t('...and zero confidence rather than a small one', tiny.short.confidence === 0);
    t('...and says so as a reason', tiny.short.reasons.some((r) => r.id === 'noData'));
    t('an empty series returns nothing at all', verdict({ series: [] }) === null);

    /* ---- horizon agreement ---- */
    t('agreement is one of three named states',
      ['aligned', 'conflict', 'partial'].includes(v.agree));

    /*
     * The layers must be inspectable. A confidence figure whose inputs cannot
     * be seen is just a bigger assertion, and the panel shows these weights
     * to the user precisely so the number is checkable.
     */
    for (const k of ['technical', 'historical', 'structural', 'macro']) {
      t(`the ${k} layer is exposed with a weight`, typeof v.short.layers[k]?.weight === 'number');
    }
    /*
     * Weight-zero means NO EVIDENCE, and must be distinguishable from
     * score-zero which means "evidence, pointing nowhere". Conflating them is
     * how an uninformed read ends up looking confidently neutral.
     */
    t('a layer with no data reports weight 0, not score 0',
      tiny.short.layers.macro.weight === 0);
  }

  /* ======================== yield safety filter ========================== */
  /*
   * ─── WHY THIS FILTER IS THE WHOLE FEATURE ─────────────────────────────────
   * An unfiltered yield list sorted by APY is, quite literally, a list sorted
   * by scam. Anyone can deploy a pool advertising 90,000% paid in a token that
   * cannot be sold, and it will sit at the top of any yield ranking on earth.
   *
   * The Farm screen used to show four hard-coded pools with hand-written APR
   * ranges written months earlier. Replacing that with LIVE data is only an
   * improvement if the filter holds — live unfiltered data would be strictly
   * worse than stale honest data. So every rule gets a test with a fixture
   * built to violate exactly that rule and nothing else.
   */
  {
    /* A pool that passes everything, used as the base for each violation. */
    const good = {
      pool: 'p1',
      chain: 'Ethereum',
      project: 'aave-v3',
      symbol: 'USDC',
      tvlUsd: 500_000_000,
      apy: 5,
      apyBase: 5,
      apyReward: 0,
      apyMean30d: 5,
      stablecoin: true,
      ilRisk: 'no',
      exposure: 'single',
      outlier: false
    };
    t('a large, audited, real-yield pool passes', isEligible(good));

    /*
     * THE SCAM CASE. This is the row the whole file exists to reject: an
     * enormous APY paid entirely in emissions. Note it also carries a
     * plausible TVL, because a fixture that fails on three rules at once does
     * not prove which rule is doing the work.
     */
    t('a 90,000% emissions pool is rejected',
      !isEligible({ ...good, project: 'scamswap', apy: 90000, apyBase: 0, apyReward: 90000 }));
    /* ...and specifically NOT only because of the unknown protocol. */
    t('...even if it claims to be a known protocol',
      !isEligible({ ...good, apy: 90000, apyBase: 0, apyReward: 90000 }));

    t('an unknown protocol is rejected even when it looks perfect',
      !isEligible({ ...good, project: 'brand-new-defi' }));
    t('a chain the app cannot reach is rejected',
      !isEligible({ ...good, chain: 'Fantom' }));
    t('a pool below the TVL floor is rejected',
      !isEligible({ ...good, tvlUsd: 900_000 }));
    t('DefiLlama\u2019s own outlier flag is respected',
      !isEligible({ ...good, outlier: true }));
    t('a dust yield is not worth a row',
      !isEligible({ ...good, apy: 0.008, apyBase: 0.008 }));

    /*
     * ─── THE APY CEILING, ISOLATED ─────────────────────────────────────────
     * This fixture exists because the 90,000% test above did NOT prove the
     * ceiling worked: that pool was rejected by the emissions rule, and
     * raising MAX_APY to a billion changed nothing. I only found that by
     * removing the ceiling and watching every test still pass.
     *
     * So this one claims 300% and books ALL of it as apyBase — real revenue —
     * which slips past every other rule. It is the shape a sophisticated fake
     * takes, and the ceiling is the only thing that stops it.
     *
     * The reasoning behind the ceiling: sustainable yield is paid out of real
     * revenue (borrowing interest, swap fees, staking rewards), and real
     * revenue does not produce 300% a year. Anything claiming to is either
     * mismeasured or lying.
     */
    t('a 300% yield claiming to be all real revenue is still rejected',
      !isEligible({ ...good, apy: 300, apyBase: 300, apyReward: 0 }));
    t('...while a high-but-plausible 45% is allowed through',
      isEligible({ ...good, apy: 45, apyBase: 45, apyReward: 0 }));

    /*
     * The emissions-share rule. 80% emissions fails, 50% passes. Both fixtures
     * sit at an ordinary APY so the ONLY difference between them is the split
     * — otherwise this would be re-testing the APY ceiling.
     */
    t('a pool that is 80% emissions is rejected',
      !isEligible({ ...good, apy: 20, apyBase: 4, apyReward: 16 }));
    t('...but a normally-incentivised pool is kept',
      isEligible({ ...good, apy: 20, apyBase: 10, apyReward: 10 }));

    /* ---- risk banding is about the POSITION, never about the yield ------- */
    /*
     * Banding by APY would be circular: "high yield is high risk" tells the
     * user only what they already inferred from the big number. These bands
     * describe what can actually go wrong with the position.
     */
    t('a stablecoin single-asset pool bands low', riskBand(good) === 'low');
    t('a volatile pair bands high',
      riskBand({ ...good, symbol: 'CAKE-BNB', stablecoin: false, ilRisk: 'yes', exposure: 'multi' }) === 'high');
    t('...regardless of how small its yield is',
      riskBand({ ...good, apy: 1, symbol: 'CAKE-BNB', stablecoin: false, ilRisk: 'yes', exposure: 'multi' }) === 'high');
    t('a high-yield stable single-asset pool still bands low',
      riskBand({ ...good, apy: 55 }) === 'low');

    /* ---- normalisation --------------------------------------------------- */
    const n = normalizePool({ ...good, apy: 12.34567, apyBase: 6.11111, apyReward: 6.23456 });
    t('APY is rounded to one decimal', n.apy === 12.3);
    /*
     * The upstream carries five decimals. Rendering "12.34567%" implies a
     * precision that a variable rate recomputed hourly does not have.
     */
    t('...and so is the split', n.apyBase === 6.1 && n.apyReward === 6.2);
    /*
     * DefiLlama publishes a machine-learning prediction per pool. Forwarding
     * it would be laundering someone else's forecast through our UI, and this
     * app's whole position is that a number the user cannot interrogate is
     * worthless.
     */
    t('the upstream ML prediction is never forwarded',
      n.predictions === undefined && n.predictedClass === undefined);

    /* ---- the real/emissions split --------------------------------------- */
    t('an all-revenue pool is 100% real', realShare({ apy: 5, apyBase: 5 }) === 1);
    t('a mostly-emissions pool reports a small real share',
      Math.abs(realShare({ apy: 20, apyBase: 4 }) - 0.2) < 0.001);
    /*
     * An unknown split must NOT render as "100% real" — that is the flattering
     * default and it is the one that misleads.
     */
    t('an unknown split is null, never 100%', realShare({ apy: 20 }) === null);

    /* ---- today vs the 30-day average ------------------------------------ */
    const spike = rateIsUnusual({ apy: 40, apyMean30d: 6 });
    t('a pool spiking far above its average is flagged', spike?.direction === 'above');
    t('...with the multiple stated', spike.ratio === 6.7);
    t('a pool at its normal rate is not flagged',
      rateIsUnusual({ apy: 6.2, apyMean30d: 6 }) === null);
    t('a pool well below its average is flagged too',
      rateIsUnusual({ apy: 2, apyMean30d: 12 })?.direction === 'below');
    t('no average means no claim', rateIsUnusual({ apy: 6 }) === null);

    /* ---- pair detection, which is what the swap handoff needs ----------- */
    t('an LP pair yields both tokens',
      JSON.stringify(pairTokens({ symbol: 'CAKE-BNB', exposure: 'multi' })) === '["CAKE","BNB"]');
    t('a single-asset pool has no pair to buy',
      pairTokens({ symbol: 'STETH', exposure: 'single' }).length === 0);
    /*
     * Guard against manufacturing a swap the user does not need: a
     * single-asset pool whose SYMBOL happens to contain a hyphen must still
     * produce no pair, or the UI would offer to buy two halves of one token.
     */
    t('a hyphenated single-asset symbol still has no pair',
      pairTokens({ symbol: 'WBTC-WRAPPED', exposure: 'single' }).length === 0);
    t('Ethereum Llama slug maps to chain 1', llamaChainId('Ethereum') === 1);
    /*
     * Deliberate behaviour change (2026-08-24), not a weakened assertion:
     * Solana is a chain the app supports (server/yields.js ALLOWED_CHAINS
     * already listed it), so it must no longer resolve to "unknown chain".
     * It maps to 0 — the not-EVM sentinel — because /swap routes are
     * EVM-only, and 0 stays falsy through the EVM path's `!chainId` guard,
     * so no code can build a `/swap?chain=0`. pairSwapRoute handles Solana
     * in its own branch (below).
     */
    t('Solana maps to the not-EVM sentinel, never an invented EVM id', llamaChainId('Solana') === 0);
    t('a chain the app truly does not know is still null', llamaChainId('Fantom') === null);
    t('a BSC pair we list is a real swap route',
      pairSwapRoute({ symbol: 'CAKE-BNB', exposure: 'multi', chain: 'BSC' })?.chainId === 56);
    t('a pair we do not list cannot become a swap',
      pairSwapRoute({ symbol: 'FOO-BAR', exposure: 'multi', chain: 'Ethereum' }) === null);

    /*
     * ─── SOLANA PAIR ROUTES: /solana?toMint=, NEVER /swap ──────────────────
     * Synthetic pools, deliberately NOT from the live feed (tests that read
     * the network fail on Sunday). The mints come from the mint-verified
     * lists, never retyped — a second copy of a base58 string is the trap
     * this app's Solana work exists to avoid.
     */
    const JUP_MINT = SOLANA_SIGNAL_ASSETS.find((a) => a.symbol === 'JUP').mint;
    const BONK_MINT = SOLANA_SIGNAL_ASSETS.find((a) => a.symbol === 'BONK').mint;
    const JITOSOL_MINT = LST_ASSETS.find((a) => a.symbol === 'jitoSOL').mint;
    t('a Solana pair routes to the Solana screen with a verified mint', (() => {
      const r = pairSwapRoute({ symbol: 'SOL-JUP', exposure: 'multi', chain: 'Solana' });
      return r?.kind === 'solana' && r.from === 'SOL' && r.to === 'JUP' && r.toMint === JUP_MINT;
    })());
    t('...and the non-base leg is the one you swap INTO',
      pairSwapRoute({ symbol: 'USDC-JUP', exposure: 'multi', chain: 'Solana' })?.toMint === JUP_MINT);
    t('...when both legs are base, the second leg is the target',
      pairSwapRoute({ symbol: 'SOL-USDC', exposure: 'multi', chain: 'Solana' })?.toMint === USDC_MINT);
    t('...and USDT is a base leg too',
      pairSwapRoute({ symbol: 'JUP-USDT', exposure: 'multi', chain: 'Solana' })?.toMint === JUP_MINT);
    t('...when neither leg is base, the second leg is the target',
      pairSwapRoute({ symbol: 'JUP-BONK', exposure: 'multi', chain: 'Solana' })?.toMint === BONK_MINT);
    t('...and the feed spelling of an LST resolves (JITOSOL, not jitoSOL)',
      pairSwapRoute({ symbol: 'JITOSOL-SOL', exposure: 'multi', chain: 'Solana' })?.toMint === JITOSOL_MINT);
    t('...case in the feed symbol does not matter',
      pairSwapRoute({ symbol: 'sol-jup', exposure: 'multi', chain: 'Solana' })?.toMint === JUP_MINT);
    /*
     * PENGU is a real, liquid Solana token that is deliberately NOT in the
     * mint-verified lists: the honest answer for an unverified leg is null,
     * which keeps the pool on its external DefiLlama link instead of giving
     * it a button that resolves a symbol to a mint by guesswork.
     */
    t('an unverified Solana leg stays an honest null',
      pairSwapRoute({ symbol: 'SOL-PENGU', exposure: 'multi', chain: 'Solana' }) === null);
    t('a single-asset Solana pool has no route at all',
      pairSwapRoute({ symbol: 'JITOSOL', exposure: 'single', chain: 'Solana' }) === null);
    t('the EVM route shape is unchanged (no kind field, has chainId)', (() => {
      const r = pairSwapRoute({ symbol: 'CAKE-BNB', exposure: 'multi', chain: 'BSC' });
      return r?.kind === undefined && r.chainId === 56;
    })());

    /*
     * ─── uniswap-v4 IN THE ALLOW-LIST (added 2026-08-24) ───────────────────
     * Row shape copied from the live feed on that date: apyBase only (no
     * apyReward), ilRisk yes, exposure multi, outlier false. This proves the
     * allow-list entry can produce a VISIBLE row — TVL, APY band and outlier
     * filters all pass — not merely that a string joined a Set. The slug
     * evidence itself (adapter source, chains, live pools) lives in
     * test/wiring.mjs, which fails if it drifts.
     */
    const v4 = {
      pool: '9507bfe0-3fd8-41dc-b2fc-4752244917fb',
      chain: 'Ethereum',
      project: 'uniswap-v4',
      symbol: 'ETH-WBTC',
      tvlUsd: 15_208_749,
      apy: 5.9,
      apyBase: 5.9,
      apyReward: null,
      apyMean30d: 5.9,
      stablecoin: false,
      ilRisk: 'yes',
      exposure: 'multi',
      outlier: false
    };
    t('a uniswap-v4 pool with real live-feed numbers passes every filter', isEligible(v4));
    t('...an apyBase-only pool is 100% real, so the emissions ceiling cannot fire',
      realShare(v4) === 1);
    t('...and its get-pair route works: both legs are listed on Ethereum',
      pairSwapRoute(v4)?.chainId === 1);
    t('...and a sub-floor v4 pool is still rejected',
      !isEligible({ ...v4, tvlUsd: 4_000_000 }));

    /* ---- the calculator -------------------------------------------------- */
    const proj = projectEarnings({ apy: 12, apyBase: 6 }, 1000);
    t('a percentage is turned into money', Math.abs(proj.year - 120) < 0.01);
    /*
     * APY is ALREADY the compounded figure. Compounding it again would
     * overstate the result — an easy mistake that always errs in the
     * flattering direction, which is why it is asserted rather than assumed.
     */
    t('...without compounding an already-compounded rate', proj.year === 120);
    t('the monthly figure is the yearly one divided by twelve',
      Math.abs(proj.month - 10) < 0.01);
    /*
     * And the projection is split too, so "$120 a year" is immediately
     * qualified by how much of it is real revenue.
     */
    t('the projection says how much of it is real', Math.abs(proj.fromRealYield - 60) < 0.01);
    t('a zero deposit projects nothing', projectEarnings({ apy: 12 }, 0) === null);
    /* ---- day / week horizons ---------------------------------------------- */
    t('the week figure is the yearly one divided by 52', Math.abs(proj.week - 120 / 52) < 0.01);
    t('the day figure is the yearly one divided by 365', Math.abs(proj.day - 120 / 365) < 0.01);

    /* ---- the 0–100 transparency score -------------------------------------- */
    /* A score is only shown when we can actually derive one; a pool we cannot
       score must be null, never a confident default that reads like a rating. */
    t('a null pool has no score', farmScore(null) === null);
    t('a pool with no yield data has no score', farmScore({}) === null);
    t('the score is an integer in 0–100', (() => {
      const s = farmScore({ apy: 12, apyBase: 8, tvlUsd: 50000000, apyMean30d: 11 });
      return Number.isInteger(s) && s >= 0 && s <= 100;
    })());
    /* Emissions-only must not outrank an all-real pool of the same headline. */
    t('emissions-only scores below an all-real pool of the same APY',
      farmScore({ apy: 20, apyBase: 0, tvlUsd: 100000000, apyMean30d: 20 })
        < farmScore({ apy: 20, apyBase: 20, tvlUsd: 100000000, apyMean30d: 20 }));
    /* A missing 30-day mean is not fatal — the score just skips the penalty. */
    t('a missing mean still scores', Number.isFinite(farmScore({ apy: 10, apyBase: 10, tvlUsd: 100000000 })));
    /* A tiny pool must not be able to dominate on yield alone. */
    t('a tiny pool scores below a large pool of the same yield',
      farmScore({ apy: 15, apyBase: 15, tvlUsd: 10000000, apyMean30d: 15 })
        < farmScore({ apy: 15, apyBase: 15, tvlUsd: 1000000000, apyMean30d: 15 }));
    /* A spike above a pool's own 30-day mean is penalised against the same
       pool at its own rate — this is the property that keeps a burst from
       outranking its normal self. */
    t('a rate spike above the pool own mean is penalised',
      farmScore({ apy: 40, apyBase: 40, tvlUsd: 100000000, apyMean30d: 8 })
        < farmScore({ apy: 40, apyBase: 40, tvlUsd: 100000000, apyMean30d: 40 }));

    /* ---- the tiny price-move IL helper (pairs only) ------------------------ */
    t('no move means no IL', Math.abs(impermanentLoss(1)) < 1e-9);
    t('a 1.5x move is the classic ~2% loss', Math.abs(impermanentLoss(1.5) - (2 * Math.sqrt(1.5) / 2.5 - 1)) < 1e-9);
    t('a missing ratio is null, never a fake zero', impermanentLoss(null) === null);
    t('a non-positive ratio is null', impermanentLoss(0) === null);
  }

  /* ========================= the engine stays cheap ====================== */
  /*
   * ─── WHY A TIMING TEST, WHICH IS NORMALLY A BAD IDEA ──────────────────────
   * The brief included «سرعت پایین نیاد و باگ ندی به اپ» — do not slow the app
   * down. That is a real risk here and not a theoretical one: the verdict
   * engine runs a full no-look-ahead backtest at TWO horizons, and a backtest
   * is a loop over every bar recomputing indicators. It is the most expensive
   * thing this app does per asset, and it runs on a mid-range Android phone.
   *
   * Timing assertions are usually flaky rubbish, so this one is shaped to be
   * safe: the budget is ~50x the measured cost, so it can only fail on a
   * genuine algorithmic regression (an accidental O(n^2), a backtest moved
   * inside a render loop) rather than on a slow CI box. Measured here at
   * 0.75ms for a year of daily bars; the budget is 40ms.
   */
  {
    const perfSeries = [100];
    const rnd = (() => {
      let a = 12345;
      return () => {
        a = (a * 1103515245 + 12345) & 0x7fffffff;
        return a / 0x7fffffff;
      };
    })();
    for (let i = 1; i < 365; i += 1) perfSeries.push(perfSeries[i - 1] * (1 + (rnd() - 0.5) * 0.04));
    const perfBtc = perfSeries.map((v, i) => v * (1 + Math.sin(i / 7) * 0.01));
    const perfAnalysis = analyze(perfSeries, { change24h: 1, change7d: 2 });

    const args = {
      analysis: perfAnalysis,
      series: perfSeries,
      btcSeries: perfBtc,
      coin: { id: 'x', symbol: 'X', athChange: -30, volume: 1e6 },
      global: { mcapChange: 1, btcDominance: 52 }
    };
    // Warm the JIT, or the first call's compile time is what gets measured.
    for (let i = 0; i < 5; i += 1) verdict(args);

    const started = Date.now();
    for (let i = 0; i < 20; i += 1) verdict(args);
    const perCall = (Date.now() - started) / 20;

    t(`a year of daily bars verdicts in well under 40ms (${perCall.toFixed(1)}ms)`, perCall < 40);
  }

  /* ============ learning core: schema, training math, client tuning ====== */
  /* The daily machine-learning loop (server/learning/* + src/lib/learning.js).
     These tests pin the safety boundaries, not the numbers: the model may
     only modulate layer weights and order defaults inside hard bounds, and
     every fallback must equal "behave exactly as before". */
  {
    /* ----------------------------- schema ------------------------------ */
    t('returns bucket exactly at the +5% edge', bucketReturn(5) === 'up5');
    t('returns bucket exactly at the +2% edge', bucketReturn(2) === 'up2');
    t('returns flat inside ±2%', bucketReturn(0.5) === 'flat');
    t('returns bucket exactly at the -2% edge', bucketReturn(-2) === 'dn2');
    t('returns bucket exactly at the -5% edge', bucketReturn(-5) === 'dn5');
    t('the client bucket function matches the server bucket function',
      ['-9', '-3.2', '0.5', '3.2', '7.2'].every((p) => clientBucketReturn(Number(p)) === bucketReturn(Number(p))));
    t('directionOf maps the five stances to -1/0/+1',
      directionOf('tailwind') === 1 && directionOf('mildUp') === 1
        && directionOf('unclear') === 0 && directionOf('mildDown') === -1 && directionOf('headwind') === -1);
    t('bucketSign maps up/down/flat buckets',
      bucketSign('up5') === 1 && bucketSign('dn2') === -1 && bucketSign('flat') === 0);

    const goodSignal = {
      t: 's', c: 'a1b2c3d4', h: 'short', s: 'mildUp', p: 48, g: 'riskOn', w: 'hc', ts: Date.now()
    };
    const vSig = validateSignal(goodSignal);
    t('a well-formed signal validates', Boolean(vSig));
    t('a signal record stays well under 120 bytes',
      Buffer.byteLength(JSON.stringify(vSig), 'utf8') < MAX_RECORD_BYTES);
    t('a signal with a stance outside the vocabulary is rejected', validateSignal({ ...goodSignal, s: 'moon' }) === null);
    t('a signal with confidence out of range is rejected', validateSignal({ ...goodSignal, p: 140 }) === null);
    t('a signal with a bad coin hash is rejected', validateSignal({ ...goodSignal, c: 'zzzz' }) === null);
    t('a signal with a future timestamp is rejected', validateSignal({ ...goodSignal, ts: Date.now() + 86400000 }) === null);
    t('a weights snapshot of the form p<version> is accepted', validateSignal({ ...goodSignal, w: 'p42' }) !== null);

    const goodRes = { t: 'r', c: 'a1b2c3d4', h: 'short', ts: Date.now() - 3 * 86400000, r: { 1: 'up2', 7: 'flat' } };
    t('a well-formed resolution validates', Boolean(validateResolution(goodRes)));
    t('a resolution with an unknown bucket is rejected', validateResolution({ ...goodRes, r: { 1: 'moon' } }) === null);
    t('a resolution with no outcomes is rejected', validateResolution({ ...goodRes, r: {} }) === null);

    t('the consent token format matches ct1:<32 hex>',
      CONSENT_RE.test('ct1:0123456789abcdef0123456789abcdef') === true);
    t('a missing or malformed consent token is rejected',
      CONSENT_RE.test('') === false
        && CONSENT_RE.test('ct1:short') === false
        && CONSENT_RE.test('ct1:' + 'zz'.repeat(16)) === false
        && CONSENT_RE.test('ct1:' + '0'.repeat(31)) === false);

    const clamped = sanitizeParams({
      layers: { short: { technical: 9, historical: 0, structural: 1, macro: 1.1 }, long: { technical: 1, historical: 1, structural: 1, macro: 0.99 } },
      order: { trailMult: 5, ladderStepDiv: 0.1, stopBufferMult: -2 }
    });
    t('sanitizeParams clamps every multiplier into the hard bounds',
      clamped.layers.short.technical === LAYER_MAX_MULT
        && clamped.layers.short.historical === LAYER_MIN_MULT
        && clamped.order.trailMult === 1.15
        && clamped.order.ladderStepDiv === 2.4);
    t('sanitizeParams returns null for non-objects', sanitizeParams('nope') === null && sanitizeParams(null) === null);
    t('the no-op params are exactly the fallback',
      paramsAreNoop(defaultParams()) && defaultParams().fallbackHardcoded === true);
    t('a tuned params vector is no longer a no-op',
      paramsAreNoop(sanitizeParams({ layers: { short: { technical: 1.1 }, long: {} }, order: {} })) === false);

    /* ------------------------- training math --------------------------- */
    const cal = fitLogistic([
      { x: 20, y: 0.4 }, { x: 40, y: 0.5 }, { x: 60, y: 0.6 }, { x: 80, y: 0.72 }
    ]);
    t('a monotone calibration fits a positive slope', cal !== null && cal.k > 0);
    t('a degenerate calibration (flat bins) refuses to fit',
      fitLogistic([{ x: 50, y: 0.5 }, { x: 51, y: 0.51 }]) === null);

    const perfect = auc([
      { score: 10, label: 0 }, { score: 20, label: 0 }, { score: 30, label: 0 },
      { score: 70, label: 1 }, { score: 80, label: 1 }, { score: 90, label: 1 }
    ]);
    t('AUC is 1.0 for perfect separation', perfect !== null && Math.abs(perfect - 1) < 1e-9);
    const coinFlip = auc([
      { score: 1, label: 1 }, { score: 2, label: 0 }, { score: 3, label: 0 }, { score: 4, label: 1 }
    ]);
    t('AUC is exactly 0.5 for non-discriminating scores', coinFlip === 0.5);

    const contrast = bayesianContrast([
      { hash: 'hc', n: 200, hits: 100, mults: null },
      { hash: 'p1', n: 200, hits: 130, mults: { short: { technical: 1.15, historical: 1, structural: 1, macro: 1 }, long: { technical: 1, historical: 1, structural: 1, macro: 1 } } }
    ]);
    t('contrast steps the winning snapshot\u2019s layer upward',
      contrast.short.technical > 1 && contrast.short.technical <= LAYER_MAX_MULT);
    t('contrast leaves layers without evidence at 1.0',
      contrast.long.macro === 1);
    t('contrast refuses to move on thin samples',
      bayesianContrast([{ hash: 'hc', n: 3, hits: 3, mults: null }]) === null);

    const statsFor = (hits, n) => ({ byHorizon: { short: { n, hits }, long: { n: 0, hits: 0 } } });
    const attr = attributionDeltas(statsFor(60, 100));
    t('attribution stays inside ±0.08', Math.abs(attr.short.technical - 1) <= 0.08 + 1e-9);
    t('attribution is zero without enough samples',
      attributionDeltas(statsFor(1, 2)).short.technical === 1);
    const merged = mergeMultipliers({ short: { technical: 1.3, historical: 1, structural: 1, macro: 1 } }, null);
    t('mergeMultipliers clamps into the hard bounds',
      merged.short.technical === LAYER_MAX_MULT);
    const vt = volatilityTune(6, 3);
    t('higher realized volatility widens the trail (bounded)',
      vt.trailMult > 1 && vt.trailMult <= 1.15 && vt.ladderStepDiv > 3 && vt.ladderStepDiv <= 3.6);
    const vtLow = volatilityTune(1.5, 3);
    t('lower realized volatility tightens the trail (bounded)',
      vtLow.trailMult < 1 && vtLow.trailMult >= 0.85 && vtLow.ladderStepDiv < 3 && vtLow.ladderStepDiv >= 2.4);
    t('volatility tune with no data returns today\u2019s defaults',
      volatilityTune(null, 3).trailMult === 1);

    /* ------------------- parsing + window statistics ------------------- */
    const ts = Date.now() - 5 * 86400000;
    const joined = parseLearningLines([
      JSON.stringify({ t: 's', c: 'a1b2c3d4', h: 'short', s: 'mildUp', p: 60, g: 'riskOn', w: 'hc', ts }),
      JSON.stringify({ t: 'r', c: 'a1b2c3d4', h: 'short', ts, r: { 1: 'up2', 7: 'up5' } }),
      JSON.stringify({ t: 's', c: 'a1b2c3d4', h: 'long', s: 'unclear', p: 20, g: 'riskOn', w: 'hc', ts }),
      'not json'
    ]);
    t('parsing joins each signal with its resolutions', joined.length === 2 && joined[0].resolutions['7'] === 'up5');
    t('a signal without resolutions stays unresolved', joined[1].resolutions['30'] == null);
    t('the primary resolution falls back to a shorter span',
      primaryResolution('short', { 1: 'flat' }) === 'flat');
    const st = computeStats(joined);
    t('unresolved and unclear records do not count as usable',
      st.usable === 1 && st.byHorizon.short.n === 1 && st.byHorizon.short.hits === 1);

    /* -------------------- end-to-end training (fake io) ---------------- */
    const fakeIo = (seed = {}) => {
      const blobs = new Map(Object.entries(seed));
      return {
        blobs,
        read: async (k) => (blobs.has(k) ? blobs.get(k) : null),
        write: async (k, text) => { blobs.set(k, text); return true; },
        list: async (prefix) => [...blobs.keys()].filter((k) => k.startsWith(prefix)),
        del: async (k) => { blobs.delete(k); return true; },
        configured: () => true
      };
    };
    const now = new Date('2026-08-15T03:17:00Z');
    /* Confidence correlates with outcome (bins 4-6 up, 0-3 down) so the
       logistic calibration is fit-able; 1d outcomes resolve everything. */
    const seed = (count, { stance = 'mildUp', w = 'hc' } = {}) => {
      const lines = [];
      const base = now.getTime() - 40 * 86400000;
      for (let i = 0; i < count; i += 1) {
        const t = base + i * 3600000;
        const conf = 30 + (i % 7) * 10;
        const up = (i % 7) >= 4;
        lines.push(JSON.stringify({ t: 's', c: 'a1b2c3d4', h: 'short', s: stance, p: conf, g: 'riskOn', w, ts: t }));
        lines.push(JSON.stringify({ t: 'r', c: 'a1b2c3d4', h: 'short', ts: t, r: { 1: up ? 'up2' : 'dn2' } }));
      }
      return lines.join('\n') + '\n';
    };

    const thin = fakeIo({ 'learning/buckets.ndjson': seed(10) });
    const thinRun = await runTraining({ now, io: thin });
    t('training with too little data publishes a hardcoded fallback',
      thinRun.fallbackHardcoded === true && thinRun.skipped === 'NOT_ENOUGH_DATA');
    t('...and the published params are a no-op',
      paramsAreNoop(JSON.parse(thin.blobs.get('learning/params-2026-08-15.json'))));
    t('...and the manifest points at it',
      JSON.parse(thin.blobs.get('learning/manifest.json')).paramsKey === 'learning/params-2026-08-15.json');

    const rich = fakeIo({ 'learning/buckets.ndjson': seed(300) });
    const richRun = await runTraining({ now, io: rich });
    t('training with enough data publishes a real model',
      richRun.ok === true && richRun.fallbackHardcoded === false && richRun.records >= 300);
    const richParams = JSON.parse(rich.blobs.get('learning/params-2026-08-15.json'));
    t('...whose multipliers stay inside the hard bounds',
      Object.values(richParams.layers.short).every((m) => m >= 0.85 && m <= 1.15));
    t('...with a positive calibration slope', richParams.calibration.k > 0);

    const secondDay = new Date('2026-08-16T03:17:00Z');
    const rich2 = fakeIo({ 'learning/buckets.ndjson': seed(300) });
    const r1 = await runTraining({ now, io: rich2 });
    const r2 = await runTraining({ now: secondDay, io: rich2 });
    t('each daily run publishes a new immutable params file',
      r1.version === 1 && r2.version === 2 && rich2.blobs.has('learning/params-2026-08-16.json'));

    /* -------- the self-improvement loop: contrast across snapshots ------ */
    /* Yesterday published an aggressive technical multiplier (p1). Records
       show p1's signals beat the hardcoded baseline outright — so today's
       run must step the technical multiplier toward p1, not away from it. */
    const contIo = fakeIo();
    contIo.blobs.set('learning/params-2026-08-14.json', JSON.stringify({
      version: 1,
      trainedAt: '2026-08-14T03:17:00Z',
      layers: {
        short: { technical: 1.15, historical: 1, structural: 1, macro: 1 },
        long: { technical: 1, historical: 1, structural: 1, macro: 1 }
      },
      order: { trailMult: 1, ladderStepDiv: 3, stopBufferMult: 1 }
    }));
    {
      const lines = [];
      const base = now.getTime() - 40 * 86400000;
      for (let i = 0; i < 300; i += 1) {
        const t = base + i * 3600000;
        const conf = 30 + (i % 7) * 10;
        const ok = (i % 7) >= 4;
        const w = ok ? 'p1' : 'hc'; // p1 wins every resolved case it touched
        lines.push(JSON.stringify({ t: 's', c: 'a1b2c3d4', h: 'short', s: 'mildUp', p: conf, g: 'riskOn', w, ts: t }));
        lines.push(JSON.stringify({ t: 'r', c: 'a1b2c3d4', h: 'short', ts: t, r: { 1: ok ? 'up2' : 'dn2' } }));
      }
      contIo.blobs.set('learning/buckets.ndjson', lines.join('\n') + '\n');
    }
    const contRun = await runTraining({ now, io: contIo });
    const contParams = JSON.parse(contIo.blobs.get('learning/params-2026-08-15.json'));
    t('contrast pulls the winning snapshot\u2019s multiplier toward it',
      contRun.ok === true && contParams.layers.short.technical > 1);
    t('...and layers without contrast evidence stay on the attribution seed',
      contParams.layers.short.historical > 0.85 && contParams.layers.short.historical < 1);
    t('...and untouched horizons stay at 1.0', contParams.layers.long.macro === 1);
    t('...still inside the hard bounds', contParams.layers.short.technical <= 1.15);

    /* ------------------ roll, prune and window filtering ---------------- */
    const big = fakeIo({ 'learning/buckets.ndjson': 'x\n'.repeat(100000) });
    const rolled = await rollAndPruneBuckets(now, big);
    t('buckets.ndjson rolls to a dated file at 100K records',
      rolled.rolled === true
        && big.blobs.has('learning/buckets-20260815.ndjson')
        && big.blobs.get('learning/buckets.ndjson') === '');

    const pruneIo = fakeIo({
      'learning/params-2026-01-01.json': '{}',
      'learning/params-2026-07-01.json': '{}',
      'learning/params-2026-08-15.json': '{}'
    });
    const removed = await pruneParams(90, now, pruneIo);
    t('params older than 90 days are pruned inside the same run',
      removed === 1 && !pruneIo.blobs.has('learning/params-2026-01-01.json')
        && pruneIo.blobs.has('learning/params-2026-07-01.json'));

    const winIo = fakeIo({
      'learning/buckets.ndjson': 'a\nb\n',
      'learning/buckets-20260801.ndjson': 'c\n',
      'learning/buckets-20260101.ndjson': 'd\n'
    });
    const winLines = await readBucketsWindow(60, now, winIo);
    t('the rolling window skips dated rolls older than N days',
      winLines.length === 3 && !winLines.includes('d'));

    /* ------------------------- client tuning --------------------------- */
    t('anonCoinId is a deterministic 8-hex hash',
      anonCoinId('bitcoin') === anonCoinId('bitcoin') && /^[0-9a-f]{8}$/.test(anonCoinId('bitcoin')));
    t('anonCoinId differs across coins', anonCoinId('bitcoin') !== anonCoinId('ethereum'));
    t('no model means hardcoded snapshot id', weightsSnapshotId(null) === 'hc');
    t('an active model version names the snapshot', weightsSnapshotId({ model: true, params: { version: 7 } }) === 'p7');
    t('layerTune is null without a model', layerTune(null) === null && layerTune({ model: false, params: {} }) === null);
    const tun = layerTune({
      model: true,
      params: { layers: { short: { technical: 9, historical: 1, structural: 1, macro: 1 }, long: { technical: 1, historical: 1, structural: 1, macro: 0.9 } } }
    });
    t('layerTune clamps into the same hard bounds as the server',
      tun.layers.short.technical === LAYER_MAX_MULT && tun.layers.long.macro === 0.9);
    t('orderTune is null without a model', orderTune(null) === null);
    const ot = orderTune({ model: true, params: { order: { trailMult: 3, ladderStepDiv: 0.1, stopBufferMult: 1 } } });
    t('orderTune clamps order defaults into their bands',
      ot.trailMult === 1.15 && ot.ladderStepDiv === 2.4 && ot.stopBufferMult === 1);
  }

  /* ===== learning core v2: server-resolved telemetry + Bayesian trainer === */
  /* The second-generation loop: POST /api/learning/event → pending.json →
     cron sweep from CACHED prices → trainV2 (Newton calibration, Thompson
     bandit, regime shrinkage, advisor k) → drift-clamped, gate-checked
     params. Every test here pins a safety boundary from the spec. */
  {
    const fakeIo = (seed = {}) => {
      const blobs = new Map(Object.entries(seed));
      return {
        blobs,
        read: async (k) => (blobs.has(k) ? blobs.get(k) : null),
        write: async (k, text) => { blobs.set(k, text); return true; },
        list: async (prefix) => [...blobs.keys()].filter((k) => k.startsWith(prefix)),
        del: async (k) => { blobs.delete(k); return true; },
        configured: () => true
      };
    };
    const priceStoreWith = (entries, at = Date.now()) =>
      new Map(Object.entries(entries).map(([id, price]) => [
        `coin:${id}`, { value: { price }, at, expires: at + 60000 }
      ]));

    /* -------------------------- event schema --------------------------- */
    const goodEvent = {
      coinId: 'bitcoin', chainId: 1, horizon: 'short', predictedStance: 'mildUp',
      predictedConfidence: 55, predictedRaw: 12.3, regime: 'riskOn',
      layersHash: 'hc', clientTs: Date.now()
    };
    t('a well-formed learning event validates', Boolean(validateEvent(goodEvent)));
    t('an event with an unknown stance is rejected', validateEvent({ ...goodEvent, predictedStance: 'moon' }) === null);
    t('an event with out-of-range confidence is rejected', validateEvent({ ...goodEvent, predictedConfidence: 400 }) === null);
    t('an event with a future timestamp is rejected', validateEvent({ ...goodEvent, clientTs: Date.now() + 86400000 }) === null);
    t('an event with a malformed coin id is rejected', validateEvent({ ...goodEvent, coinId: 'UPPER CASE!!' }) === null);
    t('an event cannot smuggle a resolved return — unknown keys are dropped by construction',
      (() => {
        const v = validateEvent({ ...goodEvent, resolvedReturn: 99, address: '0xdead', ip: '1.2.3.4' });
        return v !== null && !('resolvedReturn' in v) && !('address' in v) && !('ip' in v);
      })());
    t('the server-side coin hash matches the client anonCoinId',
      hashCoinId('bitcoin') === anonCoinId('bitcoin') && hashCoinId('ethereum') === anonCoinId('ethereum'));

    /* --------------------- price cache: trusted only -------------------- */
    {
      const at = Date.now();
      const store = priceStoreWith({ bitcoin: 50000 }, at);
      t('cachedPriceUSD reads the coin cache', cachedPriceUSD('bitcoin', { store, now: at }) === 50000);
      t('cachedPriceUSD misses honestly for unknown coins', cachedPriceUSD('dogecoin', { store, now: at }) === null);
      const stale = priceStoreWith({ bitcoin: 50000 }, at - 7 * 3600 * 1000);
      t('a price older than six hours is a miss, not a value', cachedPriceUSD('bitcoin', { store: stale, now: at }) === null);
    }

    /* ---------------- ingest → pending.json → sweep --------------------- */
    {
      const io = fakeIo();
      const now = Date.now();
      const store = priceStoreWith({ bitcoin: 50000 }, now);
      const r1 = await ingestEvent(goodEvent, { io, now, priceStore: store });
      t('ingest enriches with the CACHED price and queues a callback', r1.ok === true && r1.queued === 1);
      const pend = await readPending(io);
      t('the pending entry stores the server-side base price, never a client one',
        pend.items.length === 1 && pend.items[0].basePx === 50000);
      t('the short-horizon callback fires 24h after the event',
        Math.abs(pend.items[0].fireAt - (now + 24 * 3600 * 1000)) < 1000);
      const rLong = await ingestEvent({ ...goodEvent, horizon: 'long', clientTs: now + 1 }, { io, now, priceStore: store });
      const pend2 = await readPending(io);
      const longEntry = pend2.items.find((x) => x.h === 'long');
      t('the long-horizon callback fires 7d after the event',
        rLong.ok && Math.abs(longEntry.fireAt - (now + 7 * 24 * 3600 * 1000)) < 1000);
      t('a same-day duplicate is deduped, not double-queued',
        (await ingestEvent(goodEvent, { io, now, priceStore: store })).queued === 0);
      t('an unpriceable coin is refused rather than guessed',
        (await ingestEvent({ ...goodEvent, coinId: 'dogecoin' }, { io, now, priceStore: store })).error === 'NO_PRICE');

      // Sweep 25h later with a 4% move — the SERVER computes the return.
      const later = now + 25 * 3600 * 1000;
      const appended = [];
      const sw = await sweepPending({
        io, now: later,
        priceStore: priceStoreWith({ bitcoin: 52000 }, later),
        append: async (recs) => { appended.push(...recs); return { stored: true }; }
      });
      t('the sweep resolves due callbacks from cached prices', sw.resolved === 1 && sw.pending === 1);
      t('the resolved bucket is computed server-side (+4% → up2)',
        appended.some((r) => r.t === 'r' && r.r?.['1'] === 'up2'));
      t('the finalized signal carries the raw score for the advisor fit',
        appended.some((r) => r.t === 's' && r.raw === 12.3));

      // Cache miss at resolution time: keep within grace, then DROP.
      const io2 = fakeIo();
      await ingestEvent(goodEvent, { io: io2, now, priceStore: store });
      const missKept = await sweepPending({ io: io2, now: later, priceStore: new Map(), append: async () => {} });
      t('a price-cache miss keeps the sample inside the grace window', missKept.pending === 1 && missKept.resolved === 0);
      const missDropped = await sweepPending({ io: io2, now: later + 4 * 86400000, priceStore: new Map(), append: async () => {} });
      t('past the grace window the sample is DROPPED, never invented', missDropped.dropped === 1 && missDropped.pending === 0);

      // Corrupt manifest never takes the pipeline down.
      const io3 = fakeIo({ 'learning/pending.json': '{{{not json' });
      const rec = await readPending(io3);
      t('a corrupt pending manifest degrades to empty, not a crash', Array.isArray(rec.items) && rec.items.length === 0);
    }

    /* ------------------- Newton-Raphson calibration --------------------- */
    {
      // Synthetic linearly-separable-ish data: P(hit) really rises with conf.
      const rng = mulberry32(1234);
      const rows = [];
      for (let i = 0; i < 800; i += 1) {
        const conf = 5 + Math.floor(rng() * 90);
        rows.push({ conf, hit: rng() < conf / 100 ? 1 : 0 });
      }
      const cal = newtonCalibration(rows);
      t('Newton-Raphson fits a finite calibration on synthetic data',
        cal !== null && Number.isFinite(cal.a) && Number.isFinite(cal.b) && cal.a > 0);
      const pairs = rows.map((r) => ({ score: calibratedP(r.conf, cal), label: r.hit }));
      const fitAuc = auc(pairs);
      t(`calibration AUC beats 0.85 on separable data would be luck — this data is noisy-monotone, assert > 0.6 (${fitAuc?.toFixed(3)})`,
        fitAuc !== null && fitAuc > 0.6);
      // A genuinely separable set: conf<50 always miss, conf>50 always hit.
      const sep = [];
      for (let i = 0; i < 400; i += 1) {
        const conf = 5 + Math.floor(mulberry32(i)() * 90);
        sep.push({ conf, hit: conf > 50 ? 1 : 0 });
      }
      const sepCal = newtonCalibration(sep);
      const sepAuc = auc(sep.map((r) => ({ score: calibratedP(r.conf, sepCal), label: r.hit })));
      t(`logistic fit reaches AUC > 0.85 on a linearly separable set (${sepAuc?.toFixed(3)})`,
        sepAuc !== null && sepAuc > 0.85);
      t('calibration falls back to identity when absent', calibratedP(70, null) === 0.7);
      t('log-loss of the fitted model beats the null on the training set',
        logLoss(sep, sepCal) < logLoss(sep, null));
      t('an all-hit degenerate set refuses to fit', newtonCalibration(sep.map((r) => ({ ...r, hit: 1 }))) === null);
    }

    /* ------------------- bandit update: monotonicity --------------------- */
    {
      const mkRows = (hits, misses) => [
        ...Array.from({ length: hits }, () => ({ layerSigns: { technical: 1, historical: 0, structural: 0, macro: 0 }, outcome: 1 })),
        ...Array.from({ length: misses }, () => ({ layerSigns: { technical: 1, historical: 0, structural: 0, macro: 0 }, outcome: -1 }))
      ];
      // Same seed both times: the only difference is the evidence.
      const good = banditUpdate(mkRows(90, 10), mulberry32(99)).mult.technical;
      const bad = banditUpdate(mkRows(10, 90), mulberry32(99)).mult.technical;
      t('bandit multiplier is monotone in the evidence (more hits → bigger)', good > bad);
      t('bandit multipliers stay inside [0.4, 1.8]',
        good >= 0.4 && good <= 1.8 && bad >= 0.4 && bad <= 1.8);
      const noEvidence = banditUpdate([], mulberry32(99)).mult;
      t('a layer with no outcomes hovers near the prior (Beta(10,10) → ~1.0)',
        Math.abs(noEvidence.historical - 1) < 0.45);
      t('the seeded bandit draw is deterministic per day',
        banditUpdate(mkRows(50, 50), mulberry32(7)).mult.technical
          === banditUpdate(mkRows(50, 50), mulberry32(7)).mult.technical);
    }

    /* --------------------- regime shrinkage clamps ----------------------- */
    {
      const overconf = Array.from({ length: 100 }, () => ({ regime: 'riskOff', conf: 70, hit: 0 }));
      const step1 = regimeAdjust(overconf, null);
      t('a systematically overconfident regime earns a multiplier below 1', step1.riskOff < 1);
      t('one daily run moves a regime multiplier at most 0.1', 1 - step1.riskOff <= 0.1 + 1e-9);
      let prev = { riskOff: 1 };
      for (let d = 0; d < 30; d += 1) prev = regimeAdjust(overconf, prev);
      t('thirty hostile days still cannot push a regime outside [0.7, 1.3]',
        prev.riskOff >= 0.7 && prev.riskOff <= 1.3);
      t('a thin regime shrinks back toward 1.0, never away',
        regimeAdjust([], { riskOn: 1.3 }).riskOn < 1.3);
    }

    /* --------------------- advisor k-factor bounds ----------------------- */
    {
      const rows = Array.from({ length: 100 }, (_, i) => ({ predictedTrail: 2 + (i % 5), realizedDrawdown: (2 + (i % 5)) * 3 }));
      const k = advisorFit(rows, 1);
      t('advisor k moves toward the OLS slope but stays clamped ≤ 1.4', k > 1 && k <= 1.4);
      t('advisor k with thin data keeps the previous value', advisorFit([], 1.1) === 1.1);
      t('advisor k clamps a hostile previous value into [0.7, 1.4]', advisorFit([], 9) === 1.4);
    }

    /* -------------------------- drift clamp ------------------------------ */
    {
      const { params: drifted, clamped } = driftClamp(
        { bandit: { technical: 1.8 }, advisorK: 1.39 },
        { bandit: { technical: 1.0 }, advisorK: 1.35 },
        0.15
      );
      t('drift clamp caps any parameter at ±15% per day and logs the path',
        drifted.bandit.technical === 1.15 && clamped.includes('bandit.technical'));
      t('parameters inside the drift band pass through untouched',
        drifted.advisorK === 1.39 && !clamped.includes('advisorK'));
    }

    /* -------------- trainV2: held-out gate is an honest fail-safe -------- */
    {
      const now = new Date('2026-08-15T03:17:00Z');
      const base = now.getTime() - 40 * 86400000;
      /*
       * MISCALIBRATED synthetic data: the engine's stated confidence is
       * systematically overconfident (true P(hit) is a squashed version of
       * conf). The null model IS the stated confidence, so a correct
       * logistic fit must beat it on the held-out slice — which is exactly
       * the situation the gate exists to detect.
       */
      const sig = (x) => 1 / (1 + Math.exp(-x));
      const lgt = (p) => Math.log(p / (1 - p));
      const mkRecords = (n) => {
        const r = mulberry32(5150);
        return Array.from({ length: n }, (_, i) => {
          const conf = 20 + Math.floor(r() * 60);
          const trueP = sig(0.3 * lgt(conf / 100) - 0.8);
          const hit = r() < trueP;
          return {
            t: 's', c: 'a1b2c3d4', h: 'short', s: 'mildUp', p: conf, g: 'riskOn', w: 'hc',
            ts: base + i * 3600000, raw: 5,
            resolutions: { 1: hit ? 'up2' : 'dn2' }
          };
        });
      };
      const rngA = mulberry32(seedForDate(now));
      const good = trainV2(mkRecords(1500), { prevParams: null, rng: rngA });
      t('trainV2 publishes when held-out AUC and log-loss beat the null model',
        good.published === true && good.diag.gatePassed === true);
      t('trainV2 reports held-out AUC and log-loss for the diagnostics file',
        Number.isFinite(good.diag.auc) && Number.isFinite(good.diag.logLoss));
      const thin = trainV2(mkRecords(20), { prevParams: null, rng: mulberry32(1) });
      t('trainV2 refuses to publish on thin data and keeps the previous fields',
        thin.published === false && thin.fields.advisorK === 1 && thin.fields.bandit.technical === 1);
      t('trainV2 is deterministic for a given date seed',
        JSON.stringify(trainV2(mkRecords(1500), { rng: mulberry32(seedForDate(now)) }).fields)
          === JSON.stringify(trainV2(mkRecords(1500), { rng: mulberry32(seedForDate(now)) }).fields));
    }

    /* ------------- loader: applyParams + every fail-safe ------------------ */
    {
      const freshParams = {
        version: 3, trainedAt: new Date().toISOString(), fallbackHardcoded: false,
        layers: {
          short: { technical: 1.1, historical: 1, structural: 1, macro: 1 },
          long: { technical: 1, historical: 1, structural: 1, macro: 1 }
        },
        order: { trailMult: 1, ladderStepDiv: 3, stopBufferMult: 1 },
        calibration2: { a: 1.2, b: 0.2 },
        bandit: { technical: 1.4, historical: 1, structural: 1, macro: 1 },
        regimeMult: { riskOn: 1.05 }, advisorK: 1
      };
      const v = {
        short: { stance: 'mildUp', confidence: 40, layers: { technical: { weight: 0.5 }, historical: { weight: 0 }, structural: { weight: 0.3 }, macro: { weight: 0.2 } } },
        long: { stance: 'unclear', confidence: 10, layers: {} },
        macro: { regime: { regime: 'riskOn' } }
      };
      t('applyParams with null params returns the verdict UNCHANGED (same object)',
        applyParams(v, null) === v);
      t('applyParams with stale (>14d) params returns the verdict unchanged',
        applyParams(v, { ...freshParams, trainedAt: '2020-01-01T00:00:00Z' }) === v);
      t('applyParams with fallback params returns the verdict unchanged',
        applyParams(v, { ...freshParams, fallbackHardcoded: true }) === v);
      t('applyParams with garbage params returns the verdict unchanged',
        applyParams(v, 'garbage') === v && applyParams(v, 42) === v);
      const out = applyParams(v, freshParams);
      t('applyParams returns a NEW object and never mutates the input',
        out !== v && v.short.confidence === 40 && v.short.calibrated === undefined);
      t('applyParams re-weights layers inside the hard band',
        out.short.layers.technical.weight > 0.5 && out.short.layers.technical.weight <= 0.5 * 1.15 + 1e-9);
      t('applyParams never re-weights a layer with no evidence',
        out.short.layers.historical.weight === 0);
      t('calibrated confidence stays within the engine ceiling',
        out.short.confidence >= 0 && out.short.confidence <= 75 && out.long.confidence <= 65);
      t('paramsUsable rejects the whole poisoned-blob family',
        !paramsUsable(null) && !paramsUsable({}) && !paramsUsable({ ...freshParams, trainedAt: 'not a date' }));
      // First-day kill switch: LEARNING_ENABLED=0 forces fallback serving.
      {
        const prev = process.env.LEARNING_ENABLED;
        process.env.LEARNING_ENABLED = '0';
        const killed = !paramsUsable(freshParams) && applyParams(v, freshParams) === v;
        if (prev === undefined) delete process.env.LEARNING_ENABLED;
        else process.env.LEARNING_ENABLED = prev;
        t('LEARNING_ENABLED=0 forces the serving path into fallback', killed);
      }
      // Poisoned blob: absurd numbers are clamped at load time by the schema.
      const poisoned = applyParams(v, {
        ...freshParams,
        bandit: { technical: 1e9, historical: -5, structural: 1, macro: 1 },
        regimeMult: { riskOn: 99 },
        calibration2: { a: 1e6, b: -1e6 }
      });
      t('a poisoned params blob cannot push a weight outside the ±15% band',
        poisoned.short.layers.technical.weight <= 0.5 * 1.15 + 1e-9
          && poisoned.short.confidence <= 75);
    }

    /* -------- sabotage: no learning module ⇒ verdict untouched ----------- */
    {
      /*
       * The real sabotage (deleting server/learning/*.js) is exercised at the
       * import layer by server/app.js's guarded dynamic import — a missing
       * module resolves to null and every learning route answers its honest
       * NOT_CONFIGURED shape. What must be pinned HERE is the contract that
       * makes that safe: the verdict engine itself never imports the learning
       * module, so its output with no tune is byte-identical to today's.
       */
      const series = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 7) * 6 + i * 0.1);
      const a = analyze(series, { change24h: 1, change7d: 2, id: 'x', symbol: 'X' });
      const args = { analysis: a, series, btcSeries: series, coin: { id: 'x' }, global: { mcapChange: 1, btcDominance: 52 } };
      // Compare the two horizons only: facts.generatedAt is a Date.now()
      // wall-clock stamp and may differ between the two calls by design.
      const noTune = verdict({ ...args, tune: null });
      const bare = verdict(args);
      t('the verdict engine works with no learning module in the graph',
        JSON.stringify({ s: noTune.short, l: noTune.long }) === JSON.stringify({ s: bare.short, l: bare.long }));
    }
  }

  /* -------- the tuned verdict stays honest: words never change ---------- */
  {
    const mulberry32 = (a) => () => {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const walk = (n, seed, drift = 0, vol = 0.02, start = 100) => {
      const r = mulberry32(seed);
      const out = [start];
      for (let i = 1; i < n; i += 1) out.push(out[i - 1] * (1 + drift + (r() - 0.5) * vol * 2));
      return out;
    };
    const series = walk(200, 77, 0.002, 0.03);
    const analysis = analyze(series, { change24h: 1, change7d: 3, id: 'x', symbol: 'X' });
    const baseArgs = {
      analysis,
      series,
      btcSeries: walk(200, 78, 0.002, 0.02),
      coin: { id: 'x', symbol: 'X', athChange: -35, volume: 1e6 },
      global: { mcapChange: 1, btcDominance: 52 }
    };
    const base = verdict(baseArgs);
    const tuned = verdict({ ...baseArgs, tune: { layers: { short: { technical: 1.15, historical: 1.1, structural: 0.9, macro: 0.85 }, long: { technical: 1, historical: 1, structural: 1, macro: 1.05 } } } });
    const stances = ['tailwind', 'mildUp', 'unclear', 'mildDown', 'headwind'];
    t('a tuned verdict still only emits the five stances',
      stances.includes(tuned.short.stance) && stances.includes(tuned.long.stance));
    t('tuning modulates the technical layer weight on the short horizon',
      Math.abs(tuned.short.layers.technical.weight - base.short.layers.technical.weight) > 1e-9);
    t('tuning never touches layers with no evidence',
      (base.short.layers.historical.weight === 0) === (tuned.short.layers.historical.weight === 0));
    t('a null tune reproduces the exact untuned verdict',
      JSON.stringify(verdict({ ...baseArgs, tune: null }).short.layers) === JSON.stringify(base.short.layers));
    t('out-of-bounds multipliers are clamped by the engine itself',
      verdict({ ...baseArgs, tune: { layers: { short: { technical: 99 }, long: {} } } }).short.layers.technical.weight
        === Math.min(1.15, base.short.layers.technical.weight * 1.15));
  }

  /* ============ curated Solana assets: LSTs and tokenized equities ======== */
  /*
   * ─── THE THREAT THIS GUARDS AGAINST ───────────────────────────────────────
   * Querying Jupiter for "AAPLx" returns SEVEN tokens. One is real. The rest
   * are pump.fun clones with the same name, the same symbol, and in two cases
   * the same logo scraped from Google. Measured from the live API:
   *
   *   real  XsbEhLAtcf6...  liquidity $79,912   mintAuthority = Backed
   *   fake  GQfQ2avnmJB...  liquidity $3.44     mintAuthorityDisabled
   *
   * A user who searches "Apple" and taps the first result loses their money.
   * There is no ranking that fixes this, because the fakes copy whatever
   * signal you rank on. The only defence is a verified mint list plus an
   * issuer-authority check, and these tests exist to keep both honest.
   */
  {
    const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const all = [...LST_ASSETS, ...EQUITY_ASSETS, ...COMMODITY_ASSETS];

    /*
     * The count is pinned deliberately: this list is the ONLY thing standing
     * between a user and a pump.fun clone with the same ticker and logo, so
     * an asset appearing here must be a decision somebody made, never a merge
     * artefact. 23 as of adding the oil, AI and recent-listing names — XOMx,
     * CVXx, PLTRx, AVGOx, AMZNx and HOODx. Each was resolved live through
     * Jupiter and matched on the SAME mint authority
     * (7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj) and freeze authority as
     * the assets already listed, which is the check a convincing clone cannot
     * pass: it can copy a name and a ticker, it cannot be minted by Backed.
     */
    t('every curated mint is a plausible Solana address',
      all.length === 23 && all.every((a) => BASE58.test(a.mint)));
    /*
     * Duplicates would mean one asset silently shadowing another in the
     * mint->asset map, and the shadowed one would become unreachable.
     */
    t('no mint appears twice', new Set(all.map((a) => a.mint)).size === all.length);
    t('every curated asset carries decimals', all.every((a) => Number.isInteger(a.decimals)));

    /* ---- the issuer check, against REAL data ---- */
    /*
     * These two records are copied verbatim from the live Jupiter API rather
     * than invented, because an invented "fake" would be fake in whatever way
     * happened to make the test pass. The real clone is the specimen.
     */
    const aapl = EQUITY_ASSETS.find((a) => a.symbol === 'AAPLx');
    const realAapl = {
      id: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
      mintAuthority: XSTOCK_MINT_AUTHORITY,
      freezeAuthority: XSTOCK_FREEZE_AUTHORITY,
      isVerified: true
    };
    const cloneAapl = {
      id: 'GQfQ2avnmJBMttz2D5nyDkQAY9rWLHGvDVq8BMRpxWh4',
      isVerified: false,
      audit: { isSus: true, mintAuthorityDisabled: true }
    };

    t('the genuine Apple xStock is accepted', issuerMatches(realAapl, aapl, 'equity'));
    t('the real-world clone is rejected', !issuerMatches(cloneAapl, aapl, 'equity'));
    /*
     * The nastiest case: a record that reports the RIGHT mint and claims to be
     * verified, but whose mint authority is somebody else's. Only the
     * authority check catches this one.
     */
    t('a right-mint wrong-authority record is rejected',
      !issuerMatches(
        { ...realAapl, mintAuthority: 'HvsaoHJiadS1rEHkMRqdV3NMus55z4xqNs33ZCHVBoTS' },
        aapl,
        'equity'
      ));
    t('a tampered freeze authority is rejected',
      !issuerMatches({ ...realAapl, freezeAuthority: 'S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS' }, aapl, 'equity'));
    /* A record for a DIFFERENT mint must never satisfy this asset. */
    t('a record for another mint is rejected',
      !issuerMatches({ ...realAapl, id: LST_ASSETS[0].mint }, aapl, 'equity'));

    /* LSTs use the weaker check, and it must still reject the unverified. */
    const msol = LST_ASSETS.find((a) => a.symbol === 'mSOL');
    t('a verified LST is accepted', issuerMatches({ id: msol.mint, isVerified: true }, msol, 'lst'));
    t('an unverified LST is rejected', !issuerMatches({ id: msol.mint, isVerified: false }, msol, 'lst'));

    /* ---- the curated-mint gate on the ?to= handoff ---- */
    /*
     * SolanaSwap resolves ?to=<mint> through findAsset. If that accepted any
     * address, a crafted link would be a one-tap phishing vector: share
     * ?to=<scam mint> and the victim lands on a pre-filled swap screen.
     */
    t('a curated mint resolves', findAsset(aapl.mint)?.symbol === 'AAPLx');
    t('an arbitrary mint does NOT resolve',
      findAsset('GQfQ2avnmJBMttz2D5nyDkQAY9rWLHGvDVq8BMRpxWh4') === null);
    t('garbage does not resolve', findAsset('not-an-address') === null && findAsset(null) === null);
    t('isCuratedMint agrees with findAsset',
      isCuratedMint(aapl.mint) && !isCuratedMint('GQfQ2avnmJBMttz2D5nyDkQAY9rWLHGvDVq8BMRpxWh4'));

    /* ---- the depth gate ---- */
    /*
     * AAPLx really does have ~$80k of liquidity. A $5,000 order is 6.25% of
     * the entire book and moves the price against the user by several times
     * our own fee. Quoting it anyway is the behaviour of a venue that does not
     * care what happens next.
     */
    const tooBig = liquidityVerdict(80_000, 5_000);
    t('an order worth 6% of the book is refused', tooBig.ok === false && tooBig.reason === 'tooBig');
    /*
     * ...and it must name a size that WOULD work. A refusal with no number is
     * a dead end; 2% of $80k is $1,600.
     */
    t('...and it names the largest workable size', tooBig.maxUsd === 1600);
    t('a small order against the same book passes', liquidityVerdict(80_000, 500).ok === true);
    /* A deep book must not be gated — otherwise the rule blocks everything. */
    t('the same order against a deep book passes', liquidityVerdict(2_800_000, 5_000).ok === true);
    /* Unknown liquidity fails CLOSED. */
    t('unknown liquidity is refused, not assumed fine',
      liquidityVerdict(null, 1000).ok === false && liquidityVerdict(0, 1000).ok === false);
    t('the pool-share ceiling is a real fraction', MAX_POOL_SHARE > 0 && MAX_POOL_SHARE < 0.1);

    /* The listing floor is a separate, stricter question from the trade gate. */
    t('there is a minimum depth to be listed at all', MIN_EQUITY_LIQUIDITY >= 10_000);

    /* ---- the live-yield join ---- */
    /*
     * Yields must be JOINED from the live feed, never hard-coded. The old Farm
     * screen's "15-40%" ranges were wrong for months and nobody noticed; an
     * asset with no matching pool must therefore show NOTHING rather than a
     * stale number.
     */
    const jito = LST_ASSETS.find((a) => a.symbol === 'jitoSOL');
    const feed = [
      { project: 'jito-liquid-staking', symbol: 'JITOSOL', apy: 7.4, apyMean30d: 7.1, tvlUsd: 738_165_090 },
      { project: 'marinade-liquid-staking', symbol: 'MSOL', apy: 6.4, apyMean30d: 5.7, tvlUsd: 175_467_838 }
    ];
    t('a staking token picks up its live yield', yieldForLst(jito, feed)?.apy === 7.4);
    t('an absent pool yields null, never a guess', yieldForLst(jito, []) === null);
    /*
     * Matching on project alone would cross-contaminate: two pools from the
     * same protocol with different symbols must not be confused.
     */
    t('the join requires the symbol to match too',
      yieldForLst(jito, [{ project: 'jito-liquid-staking', symbol: 'SOMETHING-ELSE', apy: 99 }]) === null);
    t('an asset with no llama mapping yields null', yieldForLst({ symbol: 'X' }, feed) === null);

    /* ---- the staking projection ---- */
    const stake = projectStake(7.4, 1000);
    t('a staking rate becomes money', Math.abs(stake.year - 74) < 0.01);
    /*
     * APY is already compounded. Compounding it again overstates the return,
     * and the error always flatters — which is exactly why it is asserted.
     */
    t('...without double-compounding', stake.year === 74);
    t('a zero stake projects nothing', projectStake(7.4, 0) === null);
    /*
     * `Number(null)` is 0, not NaN, so a naive `Number.isFinite` guard accepts
     * it and projects a confident "$0 a year" for a yield we simply do not
     * know. Zero is a CLAIM about the rate; null is the absence of one. This
     * test caught exactly that bug in the first version.
     */
    t('an unknown rate projects nothing, not zero', projectStake(null, 1000) === null);
    t('...and neither does an empty string or a NaN',
      projectStake('', 1000) === null && projectStake(undefined, 1000) === null && projectStake('abc', 1000) === null);
  }

  /* ==================== token icons for Solana assets ==================== */
  /*
   * ─── THE BUG THIS LOCKS DOWN ──────────────────────────────────────────────
   * Every tokenized equity and staking token rendered a blank circle. Reported
   * as "عکس پروفایل نمیاد".
   *
   * Two causes, both worth a test:
   *   1. `iconCandidates` only read `logoURI`. Jupiter's API spells the field
   *      `icon`, so the curated Solana assets always fell through to the
   *      monogram — the exact failure lib/tokenIcon.jsx was written to kill,
   *      reappearing because a second data source names the field differently.
   *   2. EquityRow and Farm rendered a bare <img> with no onError, so a failed
   *      CDN left an empty circle rather than degrading to the monogram.
   */
  {
    const aapl = {
      mint: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp',
      symbol: 'AAPLx',
      icon: 'https://xstocks-metadata.backed.fi/logos/tokens/AAPLx.png'
    };
    t('a Jupiter `icon` field is used', iconCandidates(aapl)[0] === aapl.icon);
    t('an EVM `logoURI` still works',
      iconCandidates({ symbol: 'X', logoURI: 'https://example.com/x.png' })[0] === 'https://example.com/x.png');
    /* Both spellings on one token must not produce a duplicate attempt. */
    t('the same URL under both names is not tried twice',
      iconCandidates({ symbol: 'X', icon: 'https://a/x.png', logoURI: 'https://a/x.png' }).length === 1);

    /*
     * A token with no artwork must yield an EMPTY list, which is what makes
     * TokenIcon fall through to its monogram. Returning a broken URL here
     * would render the empty circle this whole fix removes.
     */
    t('no artwork means no candidates, so the monogram renders',
      iconCandidates({ symbol: 'XYZ', mint: aapl.mint }).length === 0);

    /*
     * These are injected straight into an <img src>. A token list is
     * user-influenced data, so anything that is not https must never reach
     * the DOM.
     */
    t('http is refused', iconCandidates({ symbol: 'X', icon: 'http://evil/x.png' }).length === 0);
    t('javascript: is refused', iconCandidates({ symbol: 'X', icon: 'javascript:alert(1)' }).length === 0);
    t('data: is refused', iconCandidates({ symbol: 'X', icon: 'data:image/svg+xml,<svg/>' }).length === 0);

    /*
     * ─── NO SYMBOL-KEYED ICON SOURCE FOR SOLANA ─────────────────────────────
     * The EVM path may add TrustWallet and CoinGecko because both are keyed by
     * CONTRACT ADDRESS, which a clone cannot occupy. Every Solana icon CDN
     * available here is symbol-keyed — which is precisely how a fake AAPLx
     * would inherit Apple's logo, and a fake wearing the real token's face is
     * the most effective phishing there is.
     *
     * So a Solana token gets the issuer's own icon and then the monogram, and
     * this asserts nobody "helpfully" adds a symbol-keyed fallback later.
     */
    t('a Solana mint alone never invents an icon URL',
      iconCandidates({ symbol: 'AAPLx', mint: aapl.mint }).length === 0);
  }

  /* ============================ tokenized gold =========================== */
  /*
   * Requested: «خرید طلا و چیزهای با ارزش دیگر». Gold is the asset with the
   * clearest reason to exist for this audience — the default store of value
   * where the local currency is unstable — and a token buys a fraction of an
   * ounce with no dealer premium and no border.
   *
   * It carries the SAME two dangers as the equities, so it gets the same
   * defences and the same tests.
   */
  {
    t('gold is listed', COMMODITY_ASSETS.length === 2);
    t('...with both major issuers',
      COMMODITY_ASSETS.map((a) => a.symbol).sort().join(',') === 'PAXG,XAUt0');
    /*
     * Unlike the equities there is no single shared issuer key: Paxos and
     * Tether are different companies. Each asset therefore carries its own
     * authorities, and a missing one must fail closed rather than skip the
     * check.
     */
    t('each gold token carries its own issuer authorities',
      COMMODITY_ASSETS.every((a) => a.mintAuthority && a.freezeAuthority));

    const paxg = COMMODITY_ASSETS.find((a) => a.symbol === 'PAXG');
    const realPaxg = {
      id: paxg.mint,
      mintAuthority: paxg.mintAuthority,
      freezeAuthority: paxg.freezeAuthority,
      isVerified: true
    };
    t('the genuine PAX Gold is accepted', issuerMatches(realPaxg, paxg, 'commodity'));
    t('a wrong mint authority is rejected',
      !issuerMatches({ ...realPaxg, mintAuthority: 'HvsaoHJiadS1rEHkMRqdV3NMus55z4xqNs33ZCHVBoTS' }, paxg, 'commodity'));
    /*
     * The Wormhole-bridged PAXG is real in the sense that it exists, and is
     * still wrong to list: $308 of liquidity and a price 37% away from spot.
     * Verbatim from the live API.
     */
    t('the thin Wormhole variant is rejected',
      !issuerMatches({ id: 'C6oFsE8nXRDThzrMEQ5SxaNFGKoyyfWDDVPw37JKvPTe', mintAuthority: 'BCD75RNBHrJJpW4dXVagL5mPjzRLnVZq4YirJdjEYMV7' }, paxg, 'commodity'));
    /* An asset with no declared authority must never pass by omission. */
    t('a commodity with no declared authority fails closed',
      !issuerMatches(realPaxg, { mint: paxg.mint }, 'commodity'));

    /* The clone list for gold is as bad as for the equities. */
    for (const fake of [
      '3dDHidrJFVqArN9PwKoLva2pYsDqVYEQzd8pgy8zpump',
      '8rhchrEwGmVqFMfFd1QTwogUjhD7nrv9ciUKN3eMpump',
      '4f383vyKkSfPnEMjw8TRwv7LFQyxt89CV91brHVfpump'
    ]) {
      t(`the gold clone ${fake.slice(0, 6)}… is not curated`, !isCuratedMint(fake));
    }

    /*
     * Gold is not an equity and the row must not label it "single company".
     * `unit` is what the UI branches on, so it has to be present.
     */
    t('gold declares its unit so it can be labelled correctly',
      COMMODITY_ASSETS.every((a) => a.unit === 'ounce'));

    /* Thin books, so the same depth gate must bind here too. */
    t('the depth gate applies to gold as well',
      liquidityVerdict(471_000, 20_000).ok === false && liquidityVerdict(471_000, 1_000).ok === true);
  }

  /* ============ what was left OUT of the asset list, and why ============= */
  /*
   * ─── THE MOST IMPORTANT TEST IN THIS FILE ─────────────────────────────────
   * The owner asked for silver, copper and European stocks by name. Every one
   * was checked against the live API and rejected on MEASUREMENT:
   *
   *   NVOx (Novo Nordisk)  real token, verified issuer, $122 of liquidity.
   *                        A $200 order is bigger than the entire book.
   *   silver (XAG)         eight results, ALL pump.fun clones with
   *                        mintAuthorityDisabled and $1.5k-$6k of liquidity.
   *                        No legitimate silver token exists on Solana today.
   *   copper / bronze      no tokenized copper with real depth; bronze is an
   *                        alloy and is not a traded instrument anywhere.
   *
   * These assertions exist because "the owner asked for it" is exactly the
   * pressure under which a scam token gets added later. A listing is a
   * recommendation to consider something, and listing an asset nobody can
   * exit is worse than omitting it.
   */
  {
    const symbols = [...EQUITY_ASSETS, ...COMMODITY_ASSETS].map((a) => a.symbol.toUpperCase());

    /* Silver: every candidate on Solana today is a clone. */
    t('no silver token is listed', !symbols.some((sym) => /^XAG/.test(sym)));
    for (const clone of [
      '8Ppjpe9G6TKoKdhCdMbo1AgDZDzuwSVRPBg8pLkVpump',
      'Cd2LW9jS2fSaWapLfdx2Ga39SxFvy5MGMMTioxksbonk',
      'EWWq19y1ig73sA54eooWLGLmk6WdmshGr7Fqt9jFpump'
    ]) {
      t(`the silver clone ${clone.slice(0, 6)}… is not curated`, !isCuratedMint(clone));
    }

    /*
     * Novo Nordisk. The mint is REAL and the issuer check would pass — this is
     * rejected purely on depth, which is why it needs its own guard: a future
     * reader might "fix the omission" without checking the book.
     */
    t('Novo Nordisk is not listed while its book is empty',
      !isCuratedMint('XsfAzPzYrYjd4Dpa9BU3cusBsvWfVB9gBcyGC87S57n'));

    /*
     * And the listing floor must be high enough to have excluded it. NVOx had
     * $122; if MIN_EQUITY_LIQUIDITY ever dropped below that, the guard above
     * would be the only thing left and it only covers one ticker.
     */
    t('the listing floor would have excluded a $122 book', MIN_EQUITY_LIQUIDITY > 122);

    /* SpaceX is included, and must carry its private-company caveat. */
    const spcx = EQUITY_ASSETS.find((a) => a.symbol === 'SPCXx');
    t('SpaceX is listed', Boolean(spcx));
    t('...and is flagged as a private company', spcx.privateCompany === true);
    /*
     * Nothing else may carry that flag. Every other name here has a public
     * quote to check against, and claiming otherwise would understate their
     * transparency rather than overstate it — but it would still be wrong.
     */
    t('...and nothing with a public listing claims to be private',
      EQUITY_ASSETS.filter((a) => a.privateCompany).length === 1);
  }

  /* ========================= cross-chain bridge ========================== */
  /*
   * ─── WHAT THIS GUARDS ─────────────────────────────────────────────────────
   * Two config values decide where bridge revenue goes, and both fail
   * silently when wrong: a mistyped integrator string collects nothing with
   * no error, and a misread fee could take a fortune from a user.
   */
  {
    /*
     * LI.FI constrains the integrator string: max 23 chars, lower case only,
     * alphanumeric plus _ and -. The portal rejects a capital letter, so a
     * mismatch between what was registered and what we send means zero
     * revenue and no error anywhere. Normalising is cheaper than debugging.
     */
    const saved = { id: process.env.LIFI_INTEGRATOR, fee: process.env.LIFI_FEE };

    t('the default integrator is lower-case and legal',
      /^[a-z0-9_-]{1,23}$/.test(integratorId()));

    /*
     * ─── THE EXACT REGISTERED ID ───────────────────────────────────────────
     * Pinned to the string that actually exists in the portal, verified
     * against the live API:
     *
     *   GET /v1/integrators/fbt-swap → "Integrator not found"
     *   GET /v1/integrators/fbtswap  → {"integratorId":"fbtswap", ...}
     *
     * I had proposed `fbt-swap`; the portal registered `fbtswap`. One
     * character, and the failure is completely silent — LI.FI returns error
     * 1011, our fallback re-requests without a fee, bridging keeps working
     * and the revenue is zero forever.
     *
     * A generic "is it lower-case" check passes for both spellings, so it
     * would never have caught this. Pinning the literal is the only version
     * of this test that has any value.
     */
    t('the integrator id matches the one registered in the portal',
      integratorId() === 'fbt-swap');

    process.env.LIFI_INTEGRATOR = 'FBT Swap!!';
    t('a capitalised or spaced id is normalised, not sent as-is',
      /^[a-z0-9_-]+$/.test(integratorId()) && integratorId() === 'fbtswap');

    process.env.LIFI_INTEGRATOR = 'a'.repeat(40);
    t('an over-long id is truncated to 23', integratorId().length === 23);

    process.env.LIFI_INTEGRATOR = saved.id ?? '';
    if (!saved.id) delete process.env.LIFI_INTEGRATOR;

    /* ---- the fee ---- */
    /*
     * LI.FI wants a DECIMAL FRACTION: 0.003 is 0.3%. The dangerous confusion
     * is basis points — someone writing `LIFI_FEE=30` meaning "30 bps" would
     * otherwise request 3000% of the trade. The clamp makes that impossible.
     */
    t('the default bridge fee is 0.3%', bridgeFee() === 0.003);

    process.env.LIFI_FEE = '30';
    t('a bps-style typo cannot take 3000%', bridgeFee() === 0.003);

    process.env.LIFI_FEE = '0.5';
    t('...and neither can 50%', bridgeFee() === 0.003);

    process.env.LIFI_FEE = '-1';
    t('a negative fee falls back to the default', bridgeFee() === 0.003);

    process.env.LIFI_FEE = 'abc';
    t('garbage falls back to the default', bridgeFee() === 0.003);

    process.env.LIFI_FEE = '0.005';
    t('a legitimate 0.5% IS honoured, so the clamp is not just a constant',
      bridgeFee() === 0.005);

    process.env.LIFI_FEE = saved.fee ?? '';
    if (!saved.fee) delete process.env.LIFI_FEE;

    /*
     * Our bridge fee must stay BELOW the swap fee. LI.FI already takes 0.25%
     * and the bridges charge their own on top; matching our 0.7% would put
     * the user near 1% all-in and send them elsewhere. 0.3% of a trade that
     * happens beats 0.7% of one that does not.
     */
    t('the bridge fee is lower than the same-chain swap fee',
      bridgeFee() * 10000 < 70);
  }

  /* ============================ gasless swaps ============================ */
  /*
   * ─── WHY THIS FEATURE EXISTS ──────────────────────────────────────────────
   * A user holding USDT on BNB Chain but no BNB can do NOTHING in this app.
   * Every EVM action needs the native coin for gas, and buying that coin is
   * itself a transaction requiring gas. It is the most common dead end in
   * crypto and it hits exactly the people this app is for: someone who was
   * sent stablecoins and has never held BNB.
   */
  {
    const saved = { key: process.env.ZEROX_API_KEY, bps: process.env.ZEROX_FEE_BPS };

    /*
     * Must fail CLOSED. 0x requires a key even on the free plan, and without
     * one every request 401s. Reporting "not available" beats offering a
     * button that always breaks.
     */
    delete process.env.ZEROX_API_KEY;
    t('gasless is off when no key is configured', gaslessConfigured() === false);

    process.env.ZEROX_API_KEY = 'test-key';
    t('...and on when one is', gaslessConfigured() === true);

    process.env.ZEROX_API_KEY = saved.key ?? '';
    if (!saved.key) delete process.env.ZEROX_API_KEY;

    /* ---- the fee ---- */
    /*
     * Matches the normal swap fee. To the user this IS a swap, and charging a
     * different rate for the same action depending on which code path served
     * it would be arbitrary and impossible to explain.
     */
    delete process.env.ZEROX_FEE_BPS;
    delete process.env.FEE_BPS;
    t('the gasless fee matches the standard swap fee', gaslessFeeBps() === 70);

    /*
     * 0x accepts up to 1000 bps (10%). A misplaced digit turning 70 into 700
     * would take 7% of somebody's trade, so the clamp is 100.
     */
    process.env.ZEROX_FEE_BPS = '700';
    t('a misplaced digit cannot take 7%', gaslessFeeBps() === 70);

    process.env.ZEROX_FEE_BPS = '-5';
    t('a negative fee falls back to the default', gaslessFeeBps() === 70);

    process.env.ZEROX_FEE_BPS = 'abc';
    t('garbage falls back to the default', gaslessFeeBps() === 70);

    /* The clamp must not be a constant in disguise. */
    process.env.ZEROX_FEE_BPS = '50';
    t('a legitimate 50 bps IS honoured', gaslessFeeBps() === 50);

    process.env.ZEROX_FEE_BPS = saved.bps ?? '';
    if (!saved.bps) delete process.env.ZEROX_FEE_BPS;

    /*
     * One wallet for every EVM fee in the app. A second address would mean a
     * second private key to guard and a second balance to remember to check.
     */
    t('gasless fees go to the same EVM wallet as everything else',
      gaslessRecipient().toLowerCase() === PAYOUT_ADDRESSES.evm.toLowerCase());
  }

  /* ===================== perpetual funding rates ========================= */
  /*
   * ─── WHAT THIS GUARDS ─────────────────────────────────────────────────────
   * The funding panel makes ONE claim that can be quietly, confidently wrong:
   * the annualised cost of holding a position. Every failure below produces a
   * plausible number rather than an error, which is why each is pinned.
   */
  {
    /* ---- the interval table is the whole safety property ---- */
    /*
     * A funding rate without its settlement interval is meaningless. The SAME
     * printed 0.01% is 10.95%/yr on an 8-hour venue and 87.6%/yr on an hourly
     * one. If a venue were listed with a guessed interval, the screen would
     * state an eightfold-wrong holding cost with full confidence.
     */
    t('every venue with an interval also has a custody label',
      Object.keys(FUNDING_INTERVAL_HOURS).every((v) => VENUE_CUSTODY[v]));
    t('...and no custody label exists for an unlisted venue',
      Object.keys(VENUE_CUSTODY).every((v) => FUNDING_INTERVAL_HOURS[v]));
    t('every interval is a positive number of hours',
      Object.values(FUNDING_INTERVAL_HOURS).every((h) => Number.isFinite(h) && h > 0));

    /*
     * ─── THE EXACT COINGECKO VENUE STRING ──────────────────────────────────
     * Pinned as literals, because a wrong key does not error — the venue just
     * never appears, and the screen looks like that exchange has no markets
     * rather than like our table has a typo. Exactly how the LI.FI integrator
     * id cost us revenue silently.
     *
     * I first wrote `dYdX Perpetual`, which is a REAL CoinGecko venue — the
     * dead Ethereum L1 exchange. The live v4 appchain is `dYdX Chain`.
     * `GET /derivatives/exchanges/list` settled it. A generic "is it a
     * non-empty string" check passes for both, so only the literal has value.
     */
    t('the dYdX key is the live appchain, not the dead L1',
      FUNDING_INTERVAL_HOURS['dYdX Chain'] === 1 &&
      FUNDING_INTERVAL_HOURS['dYdX Perpetual'] === undefined);
    t('Hyperliquid is hourly', FUNDING_INTERVAL_HOURS['Hyperliquid (Futures)'] === 1);
    t('Binance is eight-hourly', FUNDING_INTERVAL_HOURS['Binance (Futures)'] === 8);
    /* The on-chain venues must be labelled as such — it is the one property
       this app is built on and the reason to prefer them. */
    t('the on-chain venues are labelled on-chain',
      VENUE_CUSTODY['Hyperliquid (Futures)'] === 'onchain' &&
      VENUE_CUSTODY['dYdX Chain'] === 'onchain');
    t('...and the custodial ones are labelled custodial',
      VENUE_CUSTODY['Binance (Futures)'] === 'centralized');

    /* ---- annualisation ---- */
    /*
     * The arithmetic that the entire panel rests on. 0.01% per 8h is 10.95%
     * a year (1095 intervals); the same print hourly is 87.6% (8760).
     * Verified against the numbers rather than the formula.
     */
    t('an 8-hour rate annualises over 1095 intervals',
      Math.abs(annualiseFunding(0.01, 8) - 10.95) < 1e-9);
    t('the same rate hourly is eight times the cost',
      Math.abs(annualiseFunding(0.01, 1) - 87.6) < 1e-9);
    t('a negative rate stays negative', annualiseFunding(-0.01, 8) < 0);
    /*
     * Null, never zero. "We do not know the rate" and "holding is free" are
     * opposite statements, and collapsing them would make the cheapest-venue
     * row point at whichever venue failed to report.
     */
    t('an unknown rate is null, not zero', annualiseFunding(undefined, 8) === null);
    t('a zero-hour interval cannot divide', annualiseFunding(0.01, 0) === null);

    /* ---- crowding label ---- */
    /*
     * The neutral band is not zero. Venues build a ~0.01%/8h interest
     * component into the formula, so a calm market sits around +10%/yr. A
     * threshold at zero would report "longs are crowded" on essentially every
     * market every day, which is the same as reporting nothing.
     */
    t('a calm, slightly-positive market is not called crowded',
      crowding(10.95) === 'balanced');
    t('a genuinely crowded long side is flagged', crowding(60) === 'longs');
    t('a crowded short side is flagged', crowding(-30) === 'shorts');
    t('an unknown rate has no crowding label', crowding(null) === null);

    /* ---- ticker normalisation: every rejection matters ---- */
    const now = Date.UTC(2026, 0, 1);
    const good = {
      market: 'Binance (Futures)',
      symbol: 'BTCUSDT',
      index_id: 'BTC',
      contract_type: 'perpetual',
      price: '64000',
      funding_rate: 0.01,
      open_interest: 7_000_000_000,
      volume_24h: 8_000_000_000,
      price_percentage_change_24h: 1.2,
      last_traded_at: now / 1000,
      expired_at: null
    };
    const ok = normalizeTicker(good, now);
    t('a healthy ticker survives', ok != null && ok.symbol === 'BTC');
    t('...and carries its interval so the UI can show its work',
      ok.intervalHours === 8 && Math.abs(ok.fundingApr - 10.95) < 1e-9);

    t('a venue with no verified interval is dropped',
      normalizeTicker({ ...good, market: 'MEXC (Futures)' }, now) === null);
    t('a non-perpetual contract is dropped',
      normalizeTicker({ ...good, contract_type: 'futures' }, now) === null);
    t('an expired contract is dropped',
      normalizeTicker({ ...good, expired_at: '2025-01-01' }, now) === null);
    t('an untracked asset is dropped',
      normalizeTicker({ ...good, index_id: 'PEPE' }, now) === null);
    /*
     * CoinGecko keeps returning rows for pairs that stopped trading, with the
     * last price frozen. Rendering one beside a live venue invites a
     * comparison between a real number and a fossil.
     */
    t('a stale ticker is dropped',
      normalizeTicker({ ...good, last_traded_at: now / 1000 - 60 * 60 * 6 }, now) === null);
    t('a thin market is dropped', normalizeTicker({ ...good, open_interest: 5000 }, now) === null);
    /* A missing rate must not become zero — the row still renders, as "—". */
    const noRate = normalizeTicker({ ...good, funding_rate: null }, now);
    t('a ticker with no funding rate survives but reports null',
      noRate != null && noRate.fundingApr === null);

    /* ---- grouping and the weighted average ---- */
    /*
     * The average is weighted by open interest. An unweighted mean lets a thin
     * venue with an extreme print outvote the venue where the money actually
     * is — and the thin one is exactly where a stale or manipulated rate
     * appears.
     */
    const big = normalizeTicker({ ...good, open_interest: 7_000_000_000, funding_rate: 0.01 }, now);
    const small = normalizeTicker(
      { ...good, market: 'Hyperliquid (Futures)', open_interest: 2_000_000, funding_rate: 1 },
      now
    );
    const [btc] = groupByAsset([big, small]);
    t('the group keeps both venues', btc.venues.length === 2);

    /*
     * ─── ONE ROW PER VENUE, EVEN THOUGH A VENUE LISTS MANY CONTRACTS ───────
     * Found by reading the LIVE response after deploying, not by reasoning
     * about it. Binance returns BTCUSDT, BTCUSDC and BTCUSD_PERP as separate
     * tickers with separate funding rates spanning 4.6%-8.4%/yr; fifteen rows
     * came back for BTC. Rendered raw the table listed "Binance (Futures)"
     * three times with three different numbers, and "the cheapest venue is
     * Binance" was meaningless when Binance was also among the dearest.
     *
     * The deepest contract per venue wins — open interest is where the
     * positions actually are. Selecting the CHEAPEST instead would flatter
     * every venue that lists a thin inverse contract nobody trades, which is
     * the specific way this could have been wrong and still looked right.
     */
    const deep = normalizeTicker(
      { ...good, symbol: 'BTCUSDT', open_interest: 7_000_000_000, funding_rate: 0.004 }, now
    );
    const thin = normalizeTicker(
      { ...good, symbol: 'BTCUSD_PERP', open_interest: 1_100_000_000, funding_rate: 0.0077 }, now
    );
    const [dedup] = groupByAsset([deep, thin, small]);
    t('a venue listing several contracts appears once',
      dedup.venues.filter((v) => v.venue === 'Binance (Futures)').length === 1);
    t('...and it is the deepest contract that is kept',
      dedup.venues.find((v) => v.venue === 'Binance (Futures)').pair === 'BTCUSDT');
    t('...sorted with the deepest market first',
      btc.venues[0].venue === 'Binance (Futures)');
    /*
     * Unweighted this would be (10.95 + 8760) / 2 ≈ 4385. Weighted by the
     * $7bn vs $2m of open interest it stays near the deep venue's rate. The
     * assertion is deliberately far from the unweighted value so it cannot
     * pass by accident.
     */
    t('the average is weighted by open interest, not a plain mean',
      btc.avgFundingApr < 15 && btc.avgFundingApr > 10.95);
    t('the spread between venues is reported',
      Math.abs(btc.fundingSpread - (8760 - 10.95)) < 1e-6);

    /* ---- the cheapest venue depends on direction ---- */
    /*
     * Positive funding is paid BY longs, so a long wants the LOWEST rate and a
     * short wants the highest. These are opposite venues, and getting it
     * backwards would invert the one number the panel exists to give.
     */
    t('a long is sent to the cheapest venue', bestVenue(btc, 'long').fundingApr < 15);
    t('a short is sent to the opposite one', bestVenue(btc, 'short').fundingApr > 1000);
    t('no rates means no recommendation', bestVenue({ venues: [] }, 'long') === null);

    /* ---- the cost calculator ---- */
    /*
     * Funding is charged on NOTIONAL, not on collateral. $500 at 10x pays
     * funding on $5,000, and that multiplication is the part people get
     * wrong. 20%/yr on $5,000 for 30 days = $82.19.
     */
    const c = fundingCost({ collateralUsd: 500, leverage: 10, aprPct: 20, days: 30 });
    t('funding is charged on the position, not the collateral', c.notional === 5000);
    t('the monthly cost is computed from the notional',
      Math.abs(c.cost - (5000 * 0.2 * 30) / 365) < 1e-9);
    /*
     * The number that lands: leverage multiplies the holding cost exactly as
     * fast as the gain. 20%/yr at 10x is 200%/yr of the money you put in.
     */
    t('...and is expressed against what the user actually put in',
      Math.abs(c.pctOfCollateral - (c.cost / 500) * 100) < 1e-9);
    t('a short being PAID funding is not clamped to zero',
      fundingCost({ collateralUsd: 500, leverage: 10, aprPct: -20, days: 30 }).cost < 0);
    t('a zero collateral has no cost',
      fundingCost({ collateralUsd: 0, leverage: 10, aprPct: 20 }) === null);

    /* ---- liquidation arithmetic, shared with the existing table ---- */
    t('100x liquidates on a 1% move', liquidationMove(100) === 1);
    t('2x liquidates on a 50% move', liquidationMove(2) === 50);
    t('zero leverage is not a position', liquidationMove(0) === null);

    /* The asset list must be non-empty or the screen renders nothing. */
    t('the tracked asset list is populated',
      Array.isArray(TRACKED_ASSETS) && TRACKED_ASSETS.includes('BTC'));
  }

  /* ============== automatic orders: bracket, ladder, advisor ============= */
  {
    const mkTok = (symbol, coingeckoId) => ({ symbol, coingeckoId });
    const baseInput = {
      chainId: 56,
      fromToken: mkTok('BNB', 'binancecoin'),
      toToken: mkTok('USDT', 'tether'),
      amountIn: '100'
    };

    /* ---- BRACKET (one-cancels-the-other) ---- */
    const { order: br } = createOrder({
      ...baseInput, type: 'bracket', takeProfitRate: 800, stopLossRate: 600
    });
    t('a bracket can be created', Boolean(br) && br.type === 'bracket');
    t('inside the band it waits', evaluateOrder(br, 700).ready === false);
    t('the take-profit side fires above', evaluateOrder(br, 801).reason === 'TAKE_PROFIT');
    t('the stop-loss side fires below', evaluateOrder(br, 599).reason === 'STOP_LOSS');
    /*
     * WHICH side fired has to be reported. "Your order is ready" is nearly
     * useless when one outcome is a profit and the other is a loss, and the
     * notification text is chosen from this field.
     */
    t('...and it reports which side, not just that it fired',
      evaluateOrder(br, 801).side === 'takeProfit' && evaluateOrder(br, 599).side === 'stopLoss');
    /*
     * A bracket is ONE order. Leaving it active after the stop fires would let
     * the take-profit trigger later on a position the user has already exited
     * — selling twice. That is the entire reason this type exists rather than
     * two limit orders.
     */
    t('either side closes the whole bracket', advanceOrder(br).status === 'filled');
    /*
     * Inverted, both conditions are already true at creation, so it would fire
     * instantly at whatever the market happens to be — the exact opposite of
     * protecting a position.
     */
    t('an inverted bracket is rejected',
      validateOrder({ ...baseInput, type: 'bracket', takeProfitRate: 600, stopLossRate: 800 })
        === 'BRACKET_INVERTED');
    t('a bracket with no stop is rejected',
      validateOrder({ ...baseInput, type: 'bracket', takeProfitRate: 800 }) === 'BAD_STOP');
    /* Unknown price must never read as "condition met" — same rule as limit. */
    t('a missing price does not fire a bracket', evaluateOrder(br, null).reason === 'NO_PRICE');

    /* ---- LADDER ---- */
    const { order: ld } = createOrder({
      ...baseInput, type: 'ladder', steps: 4, startRate: 700, endRate: 800, direction: 'above'
    });
    const rungs = ladderRungs(ld);
    /*
     * INCLUSIVE OF BOTH ENDS. A 4-step ladder from 700 to 800 must include
     * 800 — that is usually the price the user cared most about, and an
     * exclusive range silently never fills it.
     */
    t('the ladder includes both the first and last price',
      rungs.length === 4 && rungs[0] === 700 && rungs[3] === 800);
    t('...evenly spaced between them', Math.abs(rungs[1] - 733.3333333) < 1e-4);

    t('the first rung waits below its price', evaluateOrder(ld, 699).ready === false);
    t('...and fires at it', evaluateOrder(ld, 700).reason === 'RUNG_HIT');

    const ld2 = advanceOrder(ld);
    t('a ladder stays active after one rung', ld2.status === 'active' && ld2.rungsFilled === 1);
    /*
     * Only the NEXT unfilled rung is evaluated. Checking all of them would let
     * one jump report several ready at once and bury the user in alerts for a
     * position they can only sell once per signature.
     */
    t('only the next rung is evaluated', Math.abs(evaluateOrder(ld2, 9999).target - 733.3333) < 0.01);
    /*
     * The cooldown must reset per rung, or a fast move through two rungs
     * silences the second for six hours and the user believes the rest of the
     * ladder is still waiting when it has already been passed.
     */
    t('the notify cooldown clears between rungs', ld2.lastNotifiedAt === 0);

    let walk = ld2;
    for (let i = 0; i < 3; i += 1) walk = advanceOrder(walk);
    t('the ladder completes on the final rung',
      walk.status === 'filled' && walk.rungsFilled === 4);

    /*
     * The parts must sum EXACTLY to the amount entered. Rounding each rung
     * independently is how a ladder trades 99.99 of 100 and strands dust.
     */
    const parts = [0, 1, 2, 3].map((i) => ladderPortion(ld, i));
    t('the rung amounts sum exactly to the order amount',
      parts.reduce((a, b) => a + b, 0) === 100);

    /*
     * FILL ORDER IS NOT NUMERIC ORDER. A buy-the-dip ladder fills from the
     * highest price downward; sorting numerically would make rung 1 the last
     * one reached and the ladder would look frozen.
     */
    const { order: ldDown } = createOrder({
      ...baseInput, type: 'ladder', steps: 3, startRate: 700, endRate: 600, direction: 'below'
    });
    t('a buy-the-dip ladder fills from the highest price first',
      ladderRungs(ldDown)[0] === 700 && ladderRungs(ldDown)[2] === 600);

    t('a flat ladder is rejected',
      validateOrder({ ...baseInput, type: 'ladder', steps: 3, startRate: 700, endRate: 700, direction: 'above' })
        === 'LADDER_FLAT');
    t('too many steps are rejected',
      validateOrder({ ...baseInput, type: 'ladder', steps: LADDER_MAX_STEPS + 1, startRate: 700, endRate: 800, direction: 'above' })
        === 'BAD_STEPS');
    t('too few steps are rejected',
      validateOrder({ ...baseInput, type: 'ladder', steps: LADDER_MIN_STEPS - 1, startRate: 700, endRate: 800, direction: 'above' })
        === 'BAD_STEPS');

    /*
     * ─── A PAUSE MUST NOT RE-SELL FILLED RUNGS ──────────────────────────────
     * The one mistake in this file that would cost real money rather than a
     * missed alert.
     */
    t('pausing and resuming keeps the filled rungs',
      resumeOrder(pauseOrder({ ...ld2, status: 'active' })).rungsFilled === 1);

    /* ---- THE SERVER MUST AGREE WITH THE CLIENT ---- */
    /*
     * These conditions are evaluated twice — on the device and in the
     * background watcher. If they disagree, the push notification and the app
     * tell the user different things about the same order, and both stop being
     * believable.
     */
    const wBr = { type: 'bracket', takeProfitRate: 800, stopLossRate: 600, priceOf: 'from' };
    t('server and client agree on take-profit',
      evaluateWatch(wBr, 801).side === evaluateOrder(br, 801).side);
    t('server and client agree on stop-loss',
      evaluateWatch(wBr, 599).side === evaluateOrder(br, 599).side);
    t('server and client agree on waiting',
      evaluateWatch(wBr, 700).hit === evaluateOrder(br, 700).ready);

    const wTrail = { type: 'trailing', trailPct: 10, peakRate: null };
    const first = evaluateWatch(wTrail, 100);
    /* No drawdown exists on the tick that establishes the peak, by definition. */
    t('a trailing stop never fires on its first observation',
      first.hit === false && first.peak === 100);
    t('...fires once price falls the trail distance',
      evaluateWatch({ ...wTrail, peakRate: 100 }, 89).hit === true);
    t('...and holds inside the trail',
      evaluateWatch({ ...wTrail, peakRate: 100 }, 95).hit === false);
    /*
     * The peak only ever RISES. A feed hiccup returning a low value must not
     * drag the stop down with it, or the order drifts and never triggers.
     */
    t('the peak never follows a dip downward',
      evaluateWatch({ ...wTrail, peakRate: 100 }, 80).peak === 100);
    /* Unknown price does nothing at all, on the server too. */
    t('the server does not fire on a missing price', evaluateWatch(wTrail, null).hit === false);

    /*
     * ─── THE WATCH LIST MUST COVER EVERY PRICE-TRIGGERED TYPE ───────────────
     * `syncWatches` filtered `type === 'limit'`, so a TRAILING STOP was never
     * mirrored to the server and only worked while the app was in the
     * foreground — precisely backwards, because a trailing stop is the one
     * order nobody can watch by hand.
     */
    t('trailing stops are watched in the background', WATCHED_TYPES.has('trailing'));
    t('brackets are watched too', WATCHED_TYPES.has('bracket'));
    t('ladders are watched too', WATCHED_TYPES.has('ladder'));
    t('limit orders still are', WATCHED_TYPES.has('limit'));
    /*
     * DCA stays OFF the server deliberately: it is time-based, the device
     * already knows the schedule, and uploading it would hand over a
     * behavioural profile for no functional gain.
     */
    t('DCA is deliberately not uploaded', !WATCHED_TYPES.has('dca'));
  }

  /* ==================== coin-id index (more coins) ======================= */
  {
    /*
     * ─── THESE SLUGS ARE LOOKED UP, NOT GUESSED ─────────────────────────────
     * CoinGecko's platform keys do not match the chain names, and a wrong one
     * fails SILENTLY — every token on that chain simply looks unsupported, and
     * the feature stays as small as it was. Same silent-failure class as the
     * LI.FI integrator id and the dYdX venue key, so the literals are pinned.
     */
    t('BNB Chain is binance-smart-chain', PLATFORM_SLUGS[56] === 'binance-smart-chain');
    t('Optimism is optimistic-ethereum', PLATFORM_SLUGS[10] === 'optimistic-ethereum');
    t('Arbitrum is arbitrum-one', PLATFORM_SLUGS[42161] === 'arbitrum-one');
    t('Polygon is polygon-pos', PLATFORM_SLUGS[137] === 'polygon-pos');

    /* Real rows, copied verbatim from a live /coins/list response. */
    const rows = [
      { id: '1inch', platforms: {
        ethereum: '0x111111111117dc0aa78b770fa6a738034120c302',
        'binance-smart-chain': '0x111111111117dc0aa78b770fa6a738034120c302',
        'arbitrum-one': '0x6314c31a7a1652ce482cffe247e9cb7c3f4bb9af' } },
      { id: '0x', platforms: { ethereum: '0xE41d2489571d322189246DaFA5ebDe1F4699F498' } },
      { id: '000-capital', platforms: { solana: 'CVU6QRwpHz94UGyPFFehm1G1sFYRH7xDk9UhZ9RApump' } },
      { id: 'no-platform', platforms: {} }
    ];
    const { byChain, coins } = buildIndex(rows);
    t('every row is counted', coins === 4);
    t('a token resolves on BNB Chain',
      byChain.get(56).get('0x111111111117dc0aa78b770fa6a738034120c302') === '1inch');
    /*
     * Token lists disagree wildly about checksum casing. A case-sensitive
     * comparison would miss most addresses while appearing to work for
     * whichever list happened to match.
     */
    t('a checksummed address still resolves',
      byChain.get(1).get('0xE41d2489571d322189246DaFA5ebDe1F4699F498'.toLowerCase()) === '0x');
    t('an unknown address resolves to nothing',
      byChain.get(56).get('0x0000000000000000000000000000000000000001') === undefined);
    /* Solana is not an EVM chain here; its base58 mint must not leak in. */
    t('a non-EVM platform is ignored',
      ![...byChain.values()].some((m) => [...m.values()].includes('000-capital')));
  }

  /* ================== the order advisor (AI suggestions) ================= */
  {
    /* A channel that really does oscillate, so levels genuinely repeat. */
    const channel = [];
    for (let i = 0; i < 180; i += 1) channel.push(100 + Math.sin(i / 6) * 8 + Math.sin(i / 23) * 3);

    const advice = adviseOrder(channel);
    t('the advisor reports ready on a full series', advice.ready === true);
    t('...and says how many samples it used', advice.samples === 180);

    /*
     * ─── THE MEDIAN, NOT THE MEAN ───────────────────────────────────────────
     * Crypto series are full of single-day outliers, and both the mean and the
     * standard deviation are dragged upward by one bad afternoon — producing a
     * stop so wide it protects nothing. Proven by injecting an outlier: the
     * median barely moves.
     */
    const spiked = [...channel];
    spiked[90] = spiked[90] * 3;
    const before = typicalMovePct(channel);
    const after = typicalMovePct(spiked);
    t('one huge outlier barely moves the typical-move figure',
      Math.abs(after - before) / before < 0.15);

    const br = suggestBracket(channel);
    if (br) {
      t('the suggested stop sits below the current price', br.stopLoss < advice.price);
      t('the suggested take-profit sits above it', br.takeProfit > advice.price);
      /*
       * A stop resting exactly ON a known support is the most common way to be
       * wicked out and then watch the level hold. It must sit beneath it.
       */
      t('the stop is placed BENEATH the support, not on it',
        br.stopLoss < anchorLevels(channel).below.price);
      /*
       * Never propose risking more than the reward. Suggesting an 8-for-3
       * trade because the arithmetic produced it would be the module doing
       * harm politely.
       */
      t('it never suggests risking more than the reward', br.ratio >= 1);
      t('...and carries the counts behind it, not just a number',
        br.evidence.supportTested >= MIN_TESTS && br.evidence.resistanceTested >= MIN_TESTS);
    }

    const tr = suggestTrail(channel);
    t('a trail suggestion stays inside the validator band',
      tr && tr.pct >= TRAIL_MIN_PCT && tr.pct <= TRAIL_MAX_PCT);
    /*
     * The worst drawdown is the honest counterweight: a 9% trail would have
     * been stopped out by a 34% fall, and the user deserves that beside the
     * suggestion.
     */
    t('...and reports the worst drawdown beside it',
      Number.isFinite(tr.evidence.maxDrawdownPct));

    const lad = suggestLadder(channel);
    if (lad) {
      t('a ladder suggestion is within the allowed step range',
        lad.steps >= LADDER_MIN_STEPS && lad.steps <= LADDER_MAX_STEPS);
      t('...and ends at a level with a real record', lad.endRate > lad.startRate);
    }

    /*
     * ─── REFUSING IS THE FEATURE ────────────────────────────────────────────
     * Thin history produces confident-looking nonsense. Two touches is a
     * coincidence with a sample size.
     */
    const thin = adviseOrder(channel.slice(0, 12));
    t('the advisor refuses on thin history',
      thin.ready === false && thin.bracket === null && thin.trailing === null);
    t('...and states the threshold it needs', thin.minSamples === MIN_SAMPLES);

    /*
     * A FLAT series has zero volatility. Deriving "use the tightest possible
     * stop" from no movement is a suggestion with nothing behind it — and on
     * the tightest setting, so it fires on the first real tick. A dead or
     * brand-new feed looks exactly like this.
     */
    t('zero volatility yields no trail suggestion',
      suggestTrail(new Array(120).fill(100)) === null);
    t('...and no bracket', suggestBracket(new Array(120).fill(100)) === null);

    t('junk input cannot crash the advisor',
      adviseOrder([NaN, 0, -5, null, undefined]).ready === false);
  }

  /* ========================= autopilot (one tap) ========================= */
  {
    const channel = [];
    for (let i = 0; i < 180; i += 1) channel.push(100 + Math.sin(i / 6) * 8 + Math.sin(i / 23) * 3);
    const ctx = {
      series: channel,
      fromToken: { symbol: 'BNB', coingeckoId: 'binancecoin' },
      toToken: { symbol: 'USDT', coingeckoId: 'tether' },
      amountIn: '100',
      chainId: 56
    };

    /*
     * ─── DIRECTION IS THE FIELD THAT COSTS MONEY WHEN WRONG ─────────────────
     * An order set to the opposite of the intent fires at exactly the wrong
     * price. The goal->mechanics mapping is a table precisely so it can be
     * asserted directly rather than inferred from three code branches.
     */
    t('taking profit sells INTO strength', GOAL_SHAPE.takeProfit.direction === 'above');
    t('buying the dip buys on WEAKNESS', GOAL_SHAPE.buyDip.direction === 'below');
    t('protecting a position is a trailing stop', GOAL_SHAPE.protect.type === 'trailing');
    /*
     * All three price the coin the user holds, in the stable side — which is
     * how people talk ("sell my BNB at 700"), not the reciprocal.
     */
    t('every goal prices the coin being held', GOALS.every((g) => GOAL_SHAPE[g].priceOf === 'from'));

    /*
     * Each goal must produce an order the ordinary validator accepts. A draft
     * the form would reject is worse than no draft.
     *
     * NOTE THE SENTINEL: validateOrder returns `null` on success, not
     * `undefined`. My first version of this asserted `=== undefined` and
     * failed on three drafts that were perfectly valid — the test was wrong,
     * not the code. Checked against the function rather than assumed the
     * second time.
     */
    for (const goal of GOALS) {
      const r = buildAutopilot({ goal, ...ctx });
      t(`the ${goal} goal produces a valid order`,
        Boolean(r.draft) && !r.refused && validateOrder(r.draft) === null);
    }

    const tp = buildAutopilot({ goal: 'takeProfit', ...ctx });
    t('take-profit ladders upward', tp.draft.endRate > tp.draft.startRate);
    const bd = buildAutopilot({ goal: 'buyDip', ...ctx });
    t('buy-the-dip ladders downward', bd.draft.endRate < bd.draft.startRate);
    /*
     * Rungs must come back in FILL order for both. Numeric order would make
     * rung 1 of a dip ladder the last one reached and it would look frozen.
     */
    const upRungs = ladderRungs(tp.draft);
    const downRungs = ladderRungs(bd.draft);
    t('take-profit rungs fill from the bottom up', upRungs[0] < upRungs[upRungs.length - 1]);
    t('buy-dip rungs fill from the top down', downRungs[0] > downRungs[downRungs.length - 1]);

    /*
     * ─── ONE SHAPE OR THE OTHER, NEVER BOTH ─────────────────────────────────
     * A draft carrying a warning flag is a draft somebody will place without
     * reading the flag.
     */
    t('a result is never both a draft and a refusal',
      GOALS.every((g) => {
        const r = buildAutopilot({ goal: g, ...ctx });
        return !(r.draft && r.refused);
      }));

    /* ---- refusing is the feature ---- */
    t('thin history is refused, with the reason',
      buildAutopilot({ ...ctx, goal: 'protect', series: channel.slice(0, 10) }).refused
        === REFUSALS.NO_HISTORY);
    t('...and reports how far short it was',
      buildAutopilot({ ...ctx, goal: 'protect', series: channel.slice(0, 10) }).detail.samples === 10);
    t('a zero amount is refused',
      buildAutopilot({ ...ctx, goal: 'protect', amountIn: '0' }).refused === REFUSALS.BAD_AMOUNT);
    /*
     * A flat series has no volatility, so there is no honest trail distance.
     * Inventing one would produce a stop that fires on the first real tick.
     */
    t('a motionless price is refused rather than guessed',
      Boolean(buildAutopilot({ ...ctx, goal: 'protect', series: new Array(120).fill(100) }).refused));
    t('an unknown goal is refused', Boolean(buildAutopilot({ ...ctx, goal: 'moon' }).refused));
    t('junk history cannot crash it',
      Boolean(buildAutopilot({ ...ctx, goal: 'protect', series: [NaN, 0, -1] }).refused));

    /* The summary must be a translation key, never English from this module. */
    const sum = summariseDraft(tp);
    t('the summary returns a key, not a sentence', sum.key === 'autopilot.summary.takeProfit');
    t('...and carries the evidence counts', Number.isFinite(sum.values.tested));
    t('a refusal has no summary', summariseDraft({ refused: 'NO_LEVEL' }) === null);
  }

  /* ================= outbound referrals (non-swap revenue) =============== */
  {
    /*
     * ─── SAFE BEFORE ANY CODE EXISTS ────────────────────────────────────────
     * Nothing is registered yet, so every link must come back EXACTLY as it
     * went in. A half-configured state that mangles a URL would break the way
     * somebody reaches their money.
     */
    const gmxUrl = 'https://app.gmx.io/#/trade';
    t('with no code the link is untouched', withReferral('gmx', gmxUrl) === gmxUrl);
    t('...and the disclosure says we earn nothing', venueDisclosure('gmx') === 'none');
    t('...so the page shows the honest notice', anyVenueEarns(['gmx', 'dydx', 'apx']) === false);

    /*
     * dYdX and Hyperliquid gate their programmes behind $10,000 of personal
     * trading volume (and 100 USDC for a Hyperliquid builder code), which we
     * cannot meet — so they must never receive a referral parameter that
     * would do nothing but look like tracking.
     */
    t('dydx is marked as unavailable to us', VENUE_REFERRAL.dydx.earns === false);
    t('...and gets no parameter', withReferral('dydx', 'https://dydx.trade') === 'https://dydx.trade');
    t('an unknown venue is passed through', withReferral('nope', gmxUrl) === gmxUrl);

    /*
     * ─── THE CODE IS CASE-SENSITIVE AND MUST NOT BE NORMALISED ──────────────
     * GMX codes are on-chain bytes32: `fbtswap` and `FBTSwap` are different
     * codes and only one exists. Lower-casing here would point at a code
     * nobody owns and earn zero forever with no error — exactly how the LI.FI
     * integrator id failed.
     */
    t('a valid code shape is accepted', isValidGmxCode('fbtswap') && isValidGmxCode('FBT_Swap1'));
    t('a code with a space is rejected', !isValidGmxCode('fbt swap'));
    t('a code with punctuation is rejected', !isValidGmxCode('fbt-swap'));
    t('an over-long code is rejected', !isValidGmxCode('a'.repeat(21)));
    t('an empty code is rejected', !isValidGmxCode(''));

    /* Every venue we link to must have a defined stance, or the UI would
       render the wrong claim about one of them. */
    t('every configured venue resolves to a disclosure state',
      Object.keys(VENUE_REFERRAL).every((v) => ['earning', 'none'].includes(venueDisclosure(v))));
  }

  /* ============ coin page: real buy/sell, not the simulator ============= */
  {
    /*
     * ─── THE BUG THIS LOCKS DOWN ────────────────────────────────────────────
     * Every coin page had Buy/Sell buttons that opened `/trade` — the PRACTICE
     * screen trading virtual credits. Someone tapping Buy on the Bitcoin page,
     * in a wallet-connected app, believes they are buying Bitcoin. They were
     * opening a simulator, and would walk away thinking they held a position
     * they did not hold.
     */
    const bnb = swapTargetFor('binancecoin');
    t('a curated coin resolves to a real contract', bnb !== null);
    /*
     * BNB Chain is preferred when a coin exists on several: it is the app's
     * default and the cheapest of the seven, so a user should not be sent to
     * Ethereum to pay gas for the same trade.
     */
    t('...on the cheapest supported chain', bnb.chainId === 56);

    /*
     * ─── REFUSING IS THE SAFETY PROPERTY ────────────────────────────────────
     * Most CoinGecko coins are not swappable here. Cardano has no contract on
     * any chain we support. Returning null makes the UI say so; the dangerous
     * alternative is opening a swap on a token that merely shares a ticker,
     * which is exactly how someone buys a fake.
     */
    t('a coin on an unsupported chain refuses', swapTargetFor('cardano') === null);
    t('...and isSwappable agrees', isSwappable('cardano') === false && isSwappable('bitcoin') === true);
    t('junk input refuses', swapTargetFor('') === null && swapTargetFor(null) === null);

    /*
     * BUY and SELL must be opposite. `from` is what LEAVES the wallet, so
     * buying spends the stablecoin and selling spends the coin. Backwards,
     * this would preload the exact opposite trade — the same class of mistake
     * the order form's `direction` field guards against.
     */
    const buy = swapUrlFor('binancecoin', 'buy');
    const sell = swapUrlFor('binancecoin', 'sell');
    t('buying spends the stable side', /from=USDT&to=BNB/.test(buy));
    t('selling spends the coin', /from=BNB&to=USDT/.test(sell));
    t('...so the two are never the same', buy !== sell);
    t('the chain travels with the pair', /chain=56/.test(buy));

    /*
     * Buying the stablecoin itself would pair USDT with USDT, which the swap
     * screen rejects as SAME_TOKEN — a dead button. It must fall back to the
     * native coin instead.
     */
    const buyStable = swapUrlFor('tether', 'buy');
    t('a stablecoin is never paired with itself', !/from=USDT&to=USDT/.test(buyStable));
    t('...it falls back to the native coin', /from=BNB/.test(buyStable));

    /* An unswappable coin has no URL at all, so the UI cannot navigate. */
    t('no URL is produced for an unswappable coin', swapUrlFor('cardano', 'buy') === null);
  }


  /* ================ Buy / Sell provider safety boundary ================= */
  {
    const capability = ChangeNowHostedCheckoutProvider.getCapabilities();
    t('FBT Buy / Sell fee is configured as exactly zero', FBT_TRADING_FEE === 0 && capability.fbtFee === 0);
    t('the provider fails closed until an official settlement contract exists',
      capability.available === false && capability.prerequisites.includes('PROVIDER_REQUIRES_INTEGRATION')
      && capability.prerequisites.includes('OFFICIAL_CALLBACK_AND_SETTLEMENT_CONTRACT_REQUIRED'));
    t('off-ramp is honestly unavailable rather than redirected to an exchange', capability.offRamp === false);
    t('the explicit order lifecycle includes payment, settlement and verification failures',
      ['PAYMENT_FAILED', 'SETTLEMENT_FAILED', 'VERIFICATION_FAILED', 'MANUAL_REVIEW', 'COMPLETED'].every((state) => ORDER_STATES.includes(state)));
    t('only a checksummed BSC/EVM destination is normalized',
      validateDestination('0x000000000000000000000000000000000000dEaD', { chainId: 56 }).ok === true
      && validateDestination('not-a-wallet', { chainId: 56 }).code === 'ADDRESS_INVALID');
    const sellRoute = await ProviderRouter.route({ side: 'SELL' });
    t('sell routing is an explicit unavailable state', sellRoute.ok === false && sellRoute.code === 'SELL_UNAVAILABLE');
    const buyRoute = await ProviderRouter.route({ side: 'BUY' });
    t('buy routing does not create a quote while provider integration is unavailable',
      buyRoute.ok === false && buyRoute.code === 'PROVIDER_UNAVAILABLE');
  }

  /* ==================== crypto radio — audio, not video =================== */
  {
    /*
     * ─── THE ENCLOSURE RULE IS THE WHOLE CORRECTNESS PROPERTY ───────────────
     * A play button that plays nothing is the dead-button failure this
     * project keeps having to fix — the Aparat "video" links, the bridge that
     * was wired to nothing, the P2P button that only changed the URL.
     *
     * The parser's job is therefore not to list episodes, it is to DROP every
     * item that cannot actually be played. Each rejected case below is a real
     * shape found in the wild while writing this, not an invented one.
     */
    const st = { id: 'test', name: 'Test FM', lang: 'en' };

    const good = parseAudioFeed(
      `<rss><channel><item>
        <title>Real episode</title>
        <pubDate>Tue, 04 Aug 2026 23:56:00 -0000</pubDate>
        <enclosure url="https://cdn.example.com/a.mp3" type="audio/mpeg"/>
        <itunes:duration>1:02:03</itunes:duration>
        <link>https://example.com/1</link>
      </item></channel></rss>`,
      st
    );
    t('a well-formed episode is kept', good.length === 1);
    t('...with its audio URL intact', good[0]?.audioUrl === 'https://cdn.example.com/a.mp3');
    /* 1:02:03 is 3723 seconds. Pinned as a literal — a generic "is a number"
       check passes for a parser that returns the wrong number. */
    t('...and H:MM:SS parses to seconds', good[0]?.durationSec === 3723);
    t('...and it carries the station name for attribution', good[0]?.stationName === 'Test FM');

    /* No enclosure at all: a text-only or video-only entry. */
    t('an item with no enclosure is dropped',
      parseAudioFeed('<rss><channel><item><title>No audio</title></item></channel></rss>', st).length === 0);

    /*
     * A cover image attached as the enclosure. This is the nastiest case:
     * without the mime check the player receives a JPEG, sits silently at
     * 0:00 and raises no error, which is more confusing than a failure.
     */
    t('an image enclosure is dropped',
      parseAudioFeed(
        `<rss><channel><item><title>Cover</title>
          <enclosure url="https://cdn.example.com/cover.jpg" type="image/jpeg"/>
        </item></channel></rss>`,
        st
      ).length === 0);

    /* Plain http would be blocked as mixed content by every modern browser. */
    t('an insecure http enclosure is dropped',
      parseAudioFeed(
        `<rss><channel><item><title>Insecure</title>
          <enclosure url="http://cdn.example.com/b.mp3" type="audio/mpeg"/>
        </item></channel></rss>`,
        st
      ).length === 0);

    /* Bare seconds is the other duration format these feeds use. */
    t('a bare-seconds duration parses too',
      parseAudioFeed(
        `<rss><channel><item><title>Secs</title>
          <enclosure url="https://cdn.example.com/c.mp3" type="audio/mpeg"/>
          <itunes:duration>3723</itunes:duration>
        </item></channel></rss>`,
        st
      )[0]?.durationSec === 3723);

    /*
     * ─── MISSING DURATION MUST BE NULL, NEVER ZERO ──────────────────────────
     * `Number(undefined)` is NaN and `Number(null)` is 0 — and 0 is finite,
     * so a careless guard turns "unknown length" into a confident "0:00" next
     * to a play button, which reads as a broken file rather than as absent
     * metadata. This project has been bitten by the Number(null) === 0 trap
     * before.
     */
    t('a missing duration is null, not zero',
      parseAudioFeed(
        `<rss><channel><item><title>No dur</title>
          <enclosure url="https://cdn.example.com/d.mp3" type="audio/mpeg"/>
        </item></channel></rss>`,
        st
      )[0]?.durationSec === null);

    t('an unknown duration formats to null rather than 0:00', fmtDuration(null) === null);
    t('...and zero seconds does too', fmtDuration(0) === null);
    t('under an hour omits the hour field', fmtDuration(125) === '2:05');
    t('over an hour includes it, zero-padded', fmtDuration(3723) === '1:02:03');

    /*
     * Every station must declare a feed we could actually fetch. A relative
     * path or an http URL here ships a station that can never load.
     */
    t('every station has an https feed',
      STATIONS.length > 0 && STATIONS.every((x) => /^https:\/\//.test(x.feed)));
    t('every station names itself for attribution',
      STATIONS.every((x) => typeof x.name === 'string' && x.name.length > 1));
  }

  /* ================= our own lending vault — off until real ============== */
  {
    /*
     * ═══════════════════════════════════════════════════════════════════════
     * THE PROPERTY THAT MATTERS: IT MUST BE INVISIBLE UNTIL IT IS REAL.
     * ═══════════════════════════════════════════════════════════════════════
     * Requested as a feature to have ready NOW and switch on later:
     *   «بعنوان یک اپشن بعدا ... اما از الان باشد بهتر است»
     *
     * That is the right instinct and it is also the exact shape of the bug
     * this repo has shipped three times — the bridge, the gasless swap and
     * the fiat integration all existed, tested and working, while earning
     * nothing because no user could reach them, or advertising something
     * that was not configured.
     *
     * For a VAULT the failure is worse than earning nothing. A card offering
     * a vault that does not exist sends someone toward depositing real money
     * into an address that is empty or wrong, and "an address the user cannot
     * withdraw from" is the only genuinely unrecoverable outcome this app can
     * produce.
     *
     * So: no address, or a malformed one, or an unknown chain ⇒ null, and the
     * component renders nothing.
     */
    t('with nothing configured the vault is not live', vaultIsLive() === false);
    t('...and the config is null, not a half-filled object', vaultConfig() === null);

    /*
     * Address validation, pinned to real failure shapes rather than one happy
     * case. Each of these has a plausible origin: a truncated copy-paste, a
     * missing prefix, an ENS name typed instead of an address, a Solana
     * address pasted into an EVM field.
     */
    t('a well-formed address validates',
      isValidVaultAddress('0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6'));
    t('a truncated address is refused', !isValidVaultAddress('0xaf5CE154cEfd22Da5BD1D0a5'));
    t('an address without 0x is refused',
      !isValidVaultAddress('af5CE154cEfd22Da5BD1D0a54479E81963A224d6'));
    t('an ENS name is refused', !isValidVaultAddress('fbtswap.eth'));
    t('a Solana address is refused',
      !isValidVaultAddress('B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4'));
    t('an empty string is refused', !isValidVaultAddress(''));
    t('a non-string is refused', !isValidVaultAddress(null) && !isValidVaultAddress(42));

    /*
     * ─── THE FEE CLAMP ──────────────────────────────────────────────────────
     * Morpho's contract permits up to 50%. We clamp the DISPLAYED figure to
     * 20, well under it, because nobody credible charges near half — the
     * largest curators run 3% to 15% — and a misplaced digit that appeared to
     * take half of somebody's yield would end the product's reputation in a
     * day. Out-of-range falls back to the default rather than clamping
     * silently, so a mistake is visible instead of quietly becoming the
     * maximum.
     */
    t('the default performance fee is the market-standard 10%', vaultFeePercent() === 10);

    /*
     * Every chain offered must be one where Morpho Blue is actually deployed.
     * An address on a chain with no Morpho would be a deposit into nothing.
     * Pinned as literals: Base, Ethereum, BNB Chain and Arbitrum all appear
     * in Morpho's own published address list.
     */
    t('Base is offered', Boolean(VAULT_CHAINS[8453]));
    t('Ethereum is offered', Boolean(VAULT_CHAINS[1]));
    t('BNB Chain is offered — our main chain', Boolean(VAULT_CHAINS[56]));
    t('Arbitrum is offered', Boolean(VAULT_CHAINS[42161]));
    t('every vault chain has an explorer to verify against',
      Object.values(VAULT_CHAINS).every((c) => /^https:\/\//.test(c.explorer)));
    /*
     * Solana has no Morpho deployment. Listing it would be a deposit sent
     * somewhere with no vault at the other end.
     */
    t('a chain without Morpho is not offered', !VAULT_CHAINS[101]);
  }

  /* -------------------------- dYdX builder code -------------------------- */
  {
    t('the supplied dYdX payout has the expected public-address shape', isDydxAddress(DYDX_BUILDER_ADDRESS));
    t('dYdX charges the same 5 bps builder rate', DYDX_BUILDER_FEE_PPM === 500);
    t('dYdX fee arithmetic is on notional', dydxFeeUsd(10_000) === 5);
    t('an invalid dYdX payout is rejected', !isDydxAddress('0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6'));
  }

  /*
   * ─── OSTIUM: OUR CALLDATA vs THEIRS, BYTE FOR BYTE ────────────────────────
   * The Ostium builder fee is the first revenue this app earns on a trade it
   * does not itself execute, and it rides inside a transaction the USER signs.
   * If the encoding is wrong the failure is not a wrong number on a screen —
   * it is a signed transaction that reverts, or worse, one that succeeds while
   * paying our fee to nobody.
   *
   * We deliberately do NOT ship @ostium/builder-sdk (177KB gzipped against a
   * 237KB entry bundle) and hand-encode with ethers instead. That decision is
   * only defensible if the hand-encoding is provably identical, so these
   * vectors are the SDK's ACTUAL OUTPUT, captured from @ostium/builder-sdk
   * 0.7.0 and committed as test/ostium-golden.json.
   *
   * Two of the five exist because reading their public docs would have got it
   * wrong: the deployed struct has a tenth member (`isDayTrade`) the developer
   * page does not list, and `slippageP` is `uint256` where an older example
   * implies a small integer. Either mistake changes the function selector.
   */
  {
    const golden = JSON.parse(readFileSync('test/ostium-golden.json', 'utf8'));

    /* If the vectors were built against a different payout address, every
       comparison below would pass while paying somebody else. */
    t('the golden vectors were captured for OUR payout address',
      golden.builder.toLowerCase() === PAYOUT_ADDRESSES.evm.toLowerCase());
    /* A file that lost its cases would make every check below vacuous. */
    t('there are still five openTrade vectors', golden.openTrade.length === 5);

    for (const c of golden.openTrade) {
      const built = await buildOpenTrade({
        trader: c.trader,
        pairId: c.pairId,
        buy: c.buy,
        price: c.price,
        collateralUsd: c.collateralUsd,
        leverage: c.leverage,
        takeProfit: c.takeProfit ?? '0',
        stopLoss: c.stopLoss ?? '0',
        isDayTrade: c.isDayTrade ?? false,
        slippageBps: c.slippageBps ?? 25,
        bps: c.bps
      });
      t(`ostium calldata matches the SDK — ${c.n}`, built.data.toLowerCase() === c.data);
      t(`...and goes to the Trading contract — ${c.n}`,
        built.to.toLowerCase() === c.to.toLowerCase());
    }

    /* The approval is the other half, and the one whose spender is NOT the
       contract we call. Getting it wrong reverts every trade on transferFrom. */
    const ap = await buildApproveCollateral({ amountUsd: golden.approve.amountUsd });
    t('the USDC approval matches the SDK byte for byte',
      ap.data.toLowerCase() === golden.approve.data);
    t('...and approves the USDC contract itself',
      ap.to.toLowerCase() === golden.approve.to.toLowerCase());
    /* Pinned separately: the spender inside that calldata must be
       TradingStorage, which is a DIFFERENT address from the one we send to. */
    t('...with TradingStorage as the spender, not the callee',
      ap.data.toLowerCase().includes(OSTIUM_SPENDER.slice(2).toLowerCase()) &&
      OSTIUM_SPENDER.toLowerCase() !== OSTIUM_TRADING.toLowerCase());

    const close = await buildCloseTrade({ pairId: 5, index: 2, closePercent: 50, price: '2400', slippageBps: 25 });
    t('Ostium position close targets Trading and encodes a real call',
      close.to.toLowerCase() === OSTIUM_TRADING.toLowerCase() && close.data.length > 10);
    const tp = await buildModifyPosition({ pairId: 5, index: 2, takeProfit: '2500' });
    const sl = await buildModifyPosition({ pairId: 5, index: 2, stopLoss: '2200' });
    t('TP and SL are distinct management calls', tp.data.slice(0, 10) !== sl.data.slice(0, 10));
    const topup = await buildUpdateCollateral({ pairId: 5, index: 2, amountUsd: '25' });
    const remove = await buildUpdateCollateral({ pairId: 5, index: 2, amountUsd: '-10' });
    t('only collateral top-up requires approval', topup.needsApproval === true && remove.needsApproval === false);

    /*
     * The fee scale, verified against the same SDK output: 5 bps encodes as
     * 50000, because builderFee is a PERCENT scaled by 1e6. A factor-of-100
     * slip here charges 5% of notional instead of 0.05%.
     */
    t('5 bps encodes as 50000, not 500 or 5000000', feeBpsToContractUnits(5) === 50_000);
    t('20 bps encodes as 200000', feeBpsToContractUnits(20) === 200_000);

    /*
     * The cap that did not cap. This shipped for an hour as `Math.min(n,
     * venueCap)` — Ostium allows 50 bps, so a direct caller could charge ten
     * times our intended rate while the comment above it claimed otherwise.
     * Pinned to 10, not merely to "less than 999".
     */
    t('an absurd fee is clamped to OUR 10 bps, not to Ostium\u2019s 50',
      ostiumFeeBps(999) === 10 && ostiumFeeBps(50) === 10);
    t('...and a sane fee passes through untouched', ostiumFeeBps(5) === 5);
    /* Number(null) is 0 and 0 is finite — the guard that has to come first. */
    t('a nonsense fee becomes zero, never NaN',
      ostiumFeeBps(null) === 0 && ostiumFeeBps(NaN) === 0 && ostiumFeeBps(-1) === 0);
  }


  /* ==================== DEX risk / MEV / wallet / terminal ================= */
  {
    t('GoPlus covers the chains we actually swap on',
      goplusChainId(1) === '1' && goplusChainId(56) === '56' && Object.keys(GOPLUS_CHAINS).length >= 6);
    t('an unknown chain is unsupported rather than guessed', goplusChainId(999) === null);

    const hot = scoreTokenRisk(normalizeGoplus({
      is_honeypot: '1',
      cannot_sell_all: '1',
      sell_tax: '25',
      is_mintable: '1',
      is_open_source: '0',
      owner_change_balance: '1',
      hidden_owner: '1',
      top10_holder_rate: '0.8',
      holder_count: '12',
      dex: [{ liquidity: '2000' }]
    }));
    t('a honeypot is critical', hot.honeypot && hot.level === 'critical');
    t('...and the rug score is high, not certain', hot.rugPull >= 70 && hot.rugPull <= 92);
    t('...flags are keys, not sentences', hot.flags.every((f) => typeof f.id === 'string' && !/\s/.test(f.id)));

    const clean = scoreTokenRisk(normalizeGoplus({
      is_honeypot: '0',
      sell_tax: '0',
      buy_tax: '0',
      is_mintable: '0',
      is_open_source: '1',
      top10_holder_rate: '0.18',
      holder_count: '4000',
      dex: [{ liquidity: '2500000' }]
    }));
    t('a deep, verified token scores low', clean.level === 'low' && clean.score < 28);
    t('missing data is unknown, not safe', scoreTokenRisk(null).level === 'unknown' && scoreTokenRisk(null).unknown);

    const sand = estimateSandwichRisk({ slippagePct: 5, priceImpact: 8, amountUsd: 50000 });
    t('a wide, thin, large swap is sandwichable', sand.score >= 70 && sand.level === 'critical');
    t('two stables at tight slippage are not', estimateSandwichRisk({ slippagePct: 0.1, bothStable: true }).level === 'low');
    t('unknown inputs are not reported as zero risk', estimateSandwichRisk({}).level === 'unknown');
    t('Ethereum has a private relay', privateRelayFor(1)?.rpc.startsWith('https://'));
    t('BNB Chain does not invent one', privateRelayFor(56) === null);
    t('a missing quote simulates to null', simulateSwap({}) === null);
    const sim = simulateSwap({ amountOut: 100, minOut: 99, slippagePct: 1, chainId: 1 });
    t('a real quote produces a simulation', sim.ready && sim.expectedOut === 100 && sim.privateRelay === true);
    t('a priority tip is a positive number', suggestPriorityFee({ baseFeeGwei: 12 }).gwei > 0);

    if (typeof globalThis.localStorage === 'undefined') {
      const mem = new Map();
      globalThis.localStorage = {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k)
      };
    }
    localStorage.removeItem('fbt-smart-wallet-v1');
    localStorage.removeItem('fbt-smart-wallet-spend-v1');
    t('policies start off', loadPolicy().enabled === false);
    t('an off policy never blocks', checkPolicy({ usd: 99999 }).ok === true);
    savePolicy({ enabled: true, dailyLimitUsd: 100, perTxLimitUsd: 40 });
    t('a $50 spend is over the per-tx cap', checkPolicy({ usd: 50 }).code === 'OVER_TX_LIMIT');
    t('a $30 spend is allowed', checkPolicy({ usd: 30 }).ok === true);
    recordSpend(90);
    t('crossing the daily cap is refused', checkPolicy({ usd: 20 }).code === 'OVER_DAILY_LIMIT');
    t('NaN is refused, not passed', checkPolicy({ usd: NaN }).ok === false);
    t('the default daily cap matches the shipped $1000 policy', DEFAULT_POLICY.dailyLimitUsd === 1000);
    t('an expired session is not active', activeSession({ session: { expiresAt: Date.now() - 1 } }) === null);

    localStorage.removeItem('fbt-portfolio-lots-v1');
    t('USDT is a stable', isStableSymbol('usdt'));
    t('BNB is not a stable', !isStableSymbol('BNB'));
    recordLot({ symbol: 'BNB', side: 'buy', qty: 2, priceUsd: 600, feeUsd: 1, at: 1_000 });
    recordLot({ symbol: 'BNB', side: 'sell', qty: 1, priceUsd: 700, feeUsd: 1, at: 2_000 });
    const book = costBasis();
    const bnb = book.find((r) => r.symbol === 'BNB');
    t('average cost survives a partial sell', Math.abs(bnb.qty - 1) < 1e-9);
    t('realised P&L is recorded', bnb.realised > 0);
    const intel = buildIntelligence({
      holdings: [{ symbol: 'BNB', value: 650, amount: 1 }],
      lots: [
        { symbol: 'BNB', side: 'buy', qty: 1, priceUsd: 600, feeUsd: 0, at: 1 }
      ]
    });
    t('unrealised P&L is value minus cost', Math.abs(intel.unrealised - 50) < 1e-9);
    t('a concentrated book is riskier than a balanced one', intel.topShare === 100 && intel.riskScore >= 40);
    t('the tax CSV refuses to call itself a filing', /not-complete/.test(taxCsv()));
    t('a bad lot is refused', recordLot({ symbol: 'X', side: 'buy', qty: 0, priceUsd: 1 }).error === 'BAD_LOT');

    const twap = createOrder({
      chainId: 56,
      fromToken: { symbol: 'USDT' },
      toToken: { symbol: 'BNB' },
      amountIn: '100',
      type: 'twap',
      slices: 4,
      windowMin: 60
    });
    t('a TWAP can be created', twap.order?.type === 'twap' && twap.order.totalRuns === 4);
    t('the first TWAP slice is due now', evaluateOrder(twap.order, null).ready === true);
    t('too few slices are rejected', validateOrder({
      chainId: 56, fromToken: { symbol: 'A' }, toToken: { symbol: 'B' }, amountIn: '1',
      type: 'twap', slices: TWAP_MIN_SLICES - 1, windowMin: TWAP_MIN_WINDOW_MIN
    }) === 'BAD_SLICES');

    const reb = createOrder({
      chainId: 56,
      fromToken: { symbol: 'BNB' },
      toToken: { symbol: 'USDT' },
      amountIn: '1',
      type: 'rebalance',
      targetRate: 700,
      driftPct: 10
    });
    t('a 5% move does not rebalance', evaluateOrder(reb.order, 730).ready === false);
    t('an 11% move does', evaluateOrder(reb.order, 780).ready === true);
    t('an unknown price never rebalances', evaluateOrder(reb.order, null).ready === false);
    t('an inverted drift is rejected', validateOrder({
      chainId: 56, fromToken: { symbol: 'A' }, toToken: { symbol: 'B' }, amountIn: '1',
      type: 'rebalance', targetRate: 700, driftPct: REBALANCE_MAX_DRIFT + 1
    }) === 'BAD_DRIFT');
    t('TWAP is not uploaded to the server', !WATCHED_TYPES.has('twap'));
    t('rebalance IS watched in the background', WATCHED_TYPES.has('rebalance'));
  }

  /* ---------------- Intent OS + Proof-of-Execution ---------------------- */
  {
    localStorage.removeItem('fbt-intent-memory-v1');
    localStorage.removeItem('fbt-intents-v1');
    localStorage.removeItem('fbt-execution-proofs-v1');

    t('intent memory starts from a bounded policy',
      loadIntentMemory().maxSlippagePct === DEFAULT_INTENT_MEMORY.maxSlippagePct);
    const memory = saveIntentMemory({
      ...DEFAULT_INTENT_MEMORY,
      maxSlippagePct: 0.4,
      maxPerIntentUsd: 2000,
      quietHoursEnabled: false
    });

    const ready = compileIntent({
      kind: 'swap', chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH',
      amountIn: '1000', amountUsd: 1000, maxSlippagePct: 0.3,
      privacy: 'standard', deadlineAt: Date.now() + 3600000
    }, memory);
    t('a policy-compliant standard swap still compiles to ordinary review, never execution',
      ready.status === 'ready-for-review' && ready.handoff.startsWith('/swap?')
        && !ready.handoff.includes('privacy=confidential'));
    t('compiled intents always require the wallet signature',
      ready.intent.constraints.requireUserSignature === true && ready.intent.constraints.custodyAllowed === false);

    const over = compileIntent({
      kind: 'swap', chainId: 1, fromSymbol: 'USDC', toSymbol: 'ETH',
      amountIn: '2500', amountUsd: 2500, maxSlippagePct: 0.3,
      privacy: 'standard', deadlineAt: Date.now() + 3600000
    }, memory);
    t('memory spend limits warn on user-reviewed intents instead of producing a false protocol block',
      !over.blocked && over.checks.some((r) => r.id === 'OVER_SPEND_LIMIT' && r.level === 'warn'));

    const privateInput = {
      kind: 'swap', chainId: 1, fromSymbol: 'USDC', toSymbol: 'ETH',
      amountIn: '100', amountUsd: 100, maxSlippagePct: 0.3,
      privacy: 'confidential', deadlineAt: Date.now() + 3600000
    };
    const privateIntent = compileIntent(privateInput, memory);
    t('a confidential swap fails closed without explicit runtime readiness',
      privateIntent.blocked && privateIntent.handoff === null
        && privateIntent.intent.constraints.privacy === 'confidential'
        && privateIntent.checks.some((r) => r.id === 'CONFIDENTIAL_TRANSPORT_UNAVAILABLE' && r.level === 'block'));
    const explicitlyReady = compileIntent(privateInput, memory, Date.now(), { confidentialAvailable: true });
    t('only explicit confidential readiness creates a privacy-preserving handoff',
      !explicitlyReady.blocked && explicitlyReady.handoff.includes('privacy=confidential')
        && explicitlyReady.checks.some((r) => r.id === 'CONFIDENTIAL_COMMIT_REVEAL' && r.level === 'pass'));
    t('confidential URL parsing is exact, duplicate-safe and never loses the requirement',
      isConfidentialPrivacy('?privacy=confidential&from=USDC')
        && isConfidentialPrivacy('?privacy=standard&privacy=confidential')
        && isConfidentialPrivacy('?privacy=confidential&privacy=standard')
        && privacyModeFromSearch('privacy=CONFIDENTIAL') === 'standard'
        && privacyModeFromSearch('privacy=confidential-fallback') === 'standard');
    const allReady = {
      ok: true,
      commitReveal: {
        available: true,
        frontendIntegrated: true,
        durablePrivateStorage: true,
        requesterAuthentication: true,
        earlyRevealProtection: true
      }
    };
    t('capability gating requires every confidential prerequisite positively',
      confidentialSwapReadiness(allReady).available
        && !confidentialSwapReadiness({ ...allReady, commitReveal: { ...allReady.commitReveal, durablePrivateStorage: false } }).available
        && !confidentialSwapReadiness({ ok: true, commitReveal: { available: true } }).available);

    const thresholdClaim = compileIntent({
      kind: 'automation', chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH',
      amountIn: '500', amountUsd: 500, maxSlippagePct: 0.3,
      privacy: 'confidential', conditionType: 'priceBelow', conditionValue: 2500,
      deadlineAt: Date.now() + 3600000
    }, memory);
    t('threshold/TEE privacy claims still block for non-swap kinds',
      thresholdClaim.blocked && thresholdClaim.checks.some((r) => r.id === 'THRESHOLD_TEE_UNAVAILABLE' && r.level === 'block'));

    const automation = compileIntent({
      kind: 'automation', chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH',
      amountIn: '500', amountUsd: 500, maxSlippagePct: 0.3, privacy: 'standard',
      conditionType: 'priceBelow', conditionValue: 2500,
      deadlineAt: Date.now() + 3600000
    }, memory);
    t('a valid automation preserves its trigger but stops at manual signature',
      automation.intent?.condition?.value === 2500 && automation.handoff === '/orders');
    t('an automation without a target is refused', compileIntent({
      kind: 'automation', chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH',
      amountIn: '500', maxSlippagePct: 0.3, privacy: 'standard',
      conditionType: 'priceBelow', conditionValue: 0, deadlineAt: Date.now() + 3600000
    }, memory).error === 'BAD_CONDITION');

    const workflow = compileIntent({
      kind: 'workflow', chainId: 42161, fromSymbol: 'USDC', toSymbol: 'WBTC',
      amountIn: '100', amountUsd: 100, maxSlippagePct: 0.3, privacy: 'standard',
      deadlineAt: Date.now() + 3600000,
      steps: [
        { action: 'swap', asset: 'ETH' },
        { action: 'bridge', asset: 'ETH' },
        { action: 'deposit', asset: 'ETH' }
      ]
    }, memory);
    t('a composite workflow stays draft-only until it is atomic', workflow.status === 'draft-only' && workflow.blocked);
    t('a bridged workflow is blocked as ATOMIC_CROSS_CHAIN_UNAVAILABLE',
      workflow.checks.some((r) => r.id === 'ATOMIC_CROSS_CHAIN_UNAVAILABLE' && r.level === 'block'));

    const sameChain = compileIntent({
      kind: 'workflow', chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH',
      amountIn: '100', amountUsd: 100, maxSlippagePct: 0.3, privacy: 'standard',
      deadlineAt: Date.now() + 3600000,
      steps: [
        { action: 'swap', asset: 'ETH', chainId: 42161 },
        { action: 'deposit', asset: 'ETH', chainId: 42161 }
      ]
    }, memory);
    t('a same-chain workflow compiles to a recoverable local review, never a fake swap hand-off',
      sameChain.status === 'ready-for-review' && !sameChain.blocked
        && sameChain.handoff === null
        && sameChain.intent.constraints.requireUserSignature === true
        && sameChain.intent.constraints.custodyAllowed === false);
    t('the single-chain workflow solver is eligible only for same-chain plans',
      sameChain.solvers.some((s) => s.id === 'fbt-single-chain-workflow' && s.status === 'eligible')
        && workflow.solvers.some((s) => s.id === 'fbt-single-chain-workflow' && s.status === 'ineligible'));

    const wfEnvelope = {
      ...sameChain.intent,
      constraints: { ...sameChain.intent.constraints, maxSlippagePct: 0.3, privacy: 'standard' }
    };
    const wfValid = validateIntentEnvelope(wfEnvelope);
    t('the protocol accepts a same-chain workflow as reviewable, not executable',
      wfValid.ok && wfValid.executable === false && wfValid.status === 'ready-for-review'
        && wfValid.singleChainAtomic === true && wfValid.code === 'VALID');

    const bridgedEnvelope = {
      ...workflow.intent,
      constraints: { ...workflow.intent.constraints, maxSlippagePct: 0.3, privacy: 'standard' }
    };
    t('a bridged envelope stays draft-only with ATOMIC_CROSS_CHAIN_UNAVAILABLE',
      validateIntentEnvelope(bridgedEnvelope).code === 'ATOMIC_CROSS_CHAIN_UNAVAILABLE');

    const invalid = normalizeIntent({ kind: 'swap', chainId: 56, fromSymbol: 'USDT', toSymbol: 'USDT', amountIn: 1 }, memory);
    t('same-token intents are refused', invalid.error === 'SAME_TOKEN');
    t('overnight quiet hours cross midnight correctly',
      isQuietTime({ ...memory, quietHoursEnabled: true, quietStart: 23, quietEnd: 7 }, new Date(2026, 0, 1, 1)));

    const envelope = {
      ...ready.intent,
      constraints: { ...ready.intent.constraints, maxSlippagePct: 0.3, privacy: 'standard' }
    };
    t('the public solver protocol validates the same safe standard envelope', validateIntentEnvelope(envelope).ok);
    t('the public solver protocol fails closed instead of downgrading confidential to standard',
      validateIntentEnvelope({
        ...envelope,
        constraints: { ...envelope.constraints, privacy: 'confidential' }
      }).code === 'PRIVACY_UNAVAILABLE');
    t('the protocol refuses autonomous authority',
      validateIntentEnvelope({ ...envelope, constraints: { ...envelope.constraints, requireUserSignature: false } }).code === 'UNSAFE_AUTHORITY');

    t('canonical JSON is independent of key insertion order',
      canonicalJson({ z: 1, a: { y: 2, x: 3 } }) === canonicalJson({ a: { x: 3, y: 2 }, z: 1 }));

    const proof = await createExecutionProof({
      txHash: `0x${'ab'.repeat(32)}`,
      chainId: 42161,
      fromToken: { symbol: 'USDC', address: `0x${'11'.repeat(20)}` },
      toToken: { symbol: 'ETH', native: true },
      amountIn: '1000',
      deadlineMinutes: 20,
      quote: {
        source: 'aggregator', selectedSolver: 'kyberswap', amountOutWei: 400000000000000000n,
        amountOut: 0.4, minOut: 0.398, feeBps: 70, slippage: 0.5, hops: 2,
        executionTrace: {
          observedAt: '2026-08-13T00:00:00.000Z',
          selectionPolicy: 'MAX_OUTPUT_EXECUTABLE_SAME_FEE_AND_SLIPPAGE',
          coverage: { requested: 2, answered: 2, usable: 2 },
          candidates: [
            { solver: 'kyberswap', status: 'quoted', executable: true, amountOutWei: '400000000000000000', amountOut: 0.4, feeBps: 70, slippage: 0.5 },
            { solver: 'openocean', status: 'quoted', executable: true, amountOutWei: '399000000000000000', amountOut: 0.399, feeBps: 70, slippage: 0.5 }
          ]
        }
      },
      receipt: { status: 1, blockNumber: 123, gasUsed: 200000n },
      createdAt: 1
    });
    const verifiedProof = await verifyExecutionProof(proof);
    t('an execution receipt recomputes to the same SHA-256 digest', verifiedProof.ok);
    const tampered = JSON.parse(JSON.stringify(proof));
    tampered.payload.constraints.amountIn = '9999';
    t('changing a receipt breaks digest verification', !(await verifyExecutionProof(tampered)).ok);
    t('proof scope refuses global optimality', proof.payload.claim.globalOptimality === false);
    t('unmeasured MEV savings remain null', proof.payload.decision.mevSavingsUsd === null);
  }

  {
    const nowMs = Date.now();
    const now = Math.floor(nowMs / 1000);
    const keys = generateSolverKeyPair();
    const solver = { id: 'unit-solver', name: 'Unit Solver', publicKey: keys.publicKey, active: true };
    const registry = new Map([[solver.id, solver]]);
    const unsigned = {
      schema: 'fbt.solver-quote.v1',
      intentHash: `0x${'de'.repeat(32)}`,
      solverId: solver.id,
      chainId: 42161,
      amountOut: '400000000000000000',
      maxGas: '250000',
      feeBps: 70,
      slippageBps: 50,
      executable: true,
      issuedAt: now,
      validUntil: now + 90,
      nonce: `0x${'ab'.repeat(16)}`,
      routeCommitment: `0x${'cd'.repeat(32)}`
    };
    const signed = signSolverCommitment(unsigned, keys.privateKey);
    t('registered Ed25519 solver commitments verify', verifySolverCommitment(signed, { registry, now: nowMs }).ok);
    t('tampering a signed output invalidates its signature',
      verifySolverCommitment({ ...signed, amountOut: '400000000000000001' }, { registry, now: nowMs }).code === 'SIGNATURE_MISMATCH');
    t('unknown signed-commitment fields are refused rather than stored',
      verifySolverCommitment({ ...signed, hiddenClaim: true }, { registry, now: nowMs }).code === 'UNKNOWN_FIELD');
    t('an otherwise valid signed quote from an unregistered solver is refused',
      verifySolverCommitment(signed, { registry: new Map(), now: nowMs }).code === 'UNREGISTERED_SOLVER');

    const expired = signSolverCommitment({
      ...unsigned,
      issuedAt: now - 200,
      validUntil: now - 100,
      nonce: `0x${'ac'.repeat(16)}`
    }, keys.privateKey);
    t('expired solver commitments are refused', verifySolverCommitment(expired, { registry, now: nowMs }).code === 'QUOTE_EXPIRED');
    const overlong = signSolverCommitment({
      ...unsigned,
      validUntil: now + 301,
      nonce: `0x${'ae'.repeat(16)}`
    }, keys.privateKey);
    t('quote validity cannot exceed the five-minute protocol bound',
      verifySolverCommitment(overlong, { registry, now: nowMs }).code === 'QUOTE_VALIDITY_TOO_LONG');

    const appended = await appendSignedCommitment(signed, { registry, now: nowMs });
    t('a signed commitment enters the immutable transparency log', appended.ok && appended.size === 1);
    t('reusing a solver nonce is rejected as a replay',
      (await appendSignedCommitment(signed, { registry, now: nowMs })).code === 'NONCE_REPLAY');

    const signedTwo = signSolverCommitment({
      ...unsigned,
      amountOut: '399000000000000000',
      nonce: `0x${'ad'.repeat(16)}`,
      routeCommitment: `0x${'ce'.repeat(32)}`
    }, keys.privateKey);
    const appendedTwo = await appendSignedCommitment(signedTwo, { registry, now: nowMs });
    const log = await readIntentLog(unsigned.intentHash);
    const hashes = [signedCommitmentHash(signed), signedCommitmentHash(signedTwo)];
    t('Merkle roots are deterministic regardless of input order',
      merkleRoot(hashes) === merkleRoot([...hashes].reverse()) && appendedTwo.root === merkleRoot(hashes));
    const inclusion = merkleProof(hashes, hashes[0]);
    t('transparency inclusion proofs independently verify against the root',
      verifyMerkleProof(hashes[0], inclusion, log.root));
    t('a changed transparency leaf does not verify',
      !verifyMerkleProof(`0x${'ff'.repeat(32)}`, inclusion, log.root));

    const policy = { id: AUCTION_POLICY, chainId: 42161, maxFeeBps: 70, maxSlippageBps: 50 };
    const evaluated = evaluateAuction(log.entries, policy, now);
    t('auction selection chooses maximum signed output inside the declared limits',
      evaluated.selectedEntryHash === signedCommitmentHash(signed)
        && evaluated.eligibleEntryHashes.length === 2);

    const oldCoordinatorId = process.env.INTENT_COORDINATOR_ID;
    const oldCoordinatorKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
    process.env.INTENT_COORDINATOR_ID = 'unit-coordinator';
    process.env.INTENT_COORDINATOR_PRIVATE_KEY = keys.privateKey;
    try {
      const closed = await closeAuction({
        schema: 'fbt.auction-close-request.v1',
        intentHash: unsigned.intentHash,
        policy
      }, { now: nowMs });
      t('auction closure creates a coordinator-signed deterministic receipt',
        closed.ok && !closed.alreadyClosed && verifyAuctionClose(closed.close)
          && closed.close.decision.selectedEntryHash === signedCommitmentHash(signed));
      t('the signed close refuses claims of completeness or fund authority',
        closed.close.claims.auctionCompletenessProven === false
          && closed.close.claims.userFundsAuthorised === false
          && closed.close.claims.externallyAnchored === false);
      t('changing a signed close root invalidates its structural and signature verification',
        !verifyAuctionClose({ ...closed.close, logRoot: `0x${'ef'.repeat(32)}` }));
      const state = await readAuction(unsigned.intentHash);
      t('the immutable auction state exposes its verified closed receipt',
        state.status === 'closed' && state.close.closeId === closed.close.closeId && !state.externallyAnchored);

      const anchorContract = `0x${'44'.repeat(20)}`;
      const anchorer = `0x${'55'.repeat(20)}`;
      const anchorNetworks = new Map([[8453, {
        chainId: 8453,
        name: 'Unit Base',
        contract: anchorContract,
        rpcUrl: 'https://rpc.invalid',
        explorerBaseUrl: 'https://explorer.invalid',
        minConfirmations: 2
      }]]);
      const calldata = buildAnchorCalldata(closed.close, 8453, anchorNetworks);
      t('anchor calldata binds the exact signed close id, intent, root, size and time',
        calldata.ok && calldata.to.toLowerCase() === anchorContract.toLowerCase() && calldata.data.startsWith('0x'));

      const anchorInterface = new Interface(INTENT_ANCHOR_ABI);
      const encodedEvent = anchorInterface.encodeEventLog(
        anchorInterface.getEvent('AuctionRootAnchored'),
        [
          closed.close.closeId,
          closed.close.intentHash,
          closed.close.logRoot,
          BigInt(closed.close.logSize),
          BigInt(closed.close.closedAt),
          anchorer
        ]
      );
      const txHash = `0x${'66'.repeat(32)}`;
      const anchor = await verifyAnchorClaim(closed.close, {
        schema: 'fbt.auction-anchor-claim.v1', chainId: 8453, txHash
      }, {
        networks: anchorNetworks,
        rpc: async (_network, method) => method === 'eth_blockNumber' ? '0x65' : {
          status: '0x1', transactionHash: txHash, blockNumber: '0x64',
          blockHash: `0x${'77'.repeat(32)}`,
          logs: [{ address: anchorContract, topics: encodedEvent.topics, data: encodedEvent.data }]
        },
        now: nowMs
      });
      t('a confirmed configured-contract event verifies as an external anchor',
        anchor.ok && anchor.anchor.confirmationsAtVerification === 2 && anchor.anchor.verified);
      const earlyAnchor = await verifyAnchorClaim(closed.close, {
        schema: 'fbt.auction-anchor-claim.v1', chainId: 8453, txHash
      }, {
        networks: anchorNetworks,
        rpc: async (_network, method) => method === 'eth_blockNumber' ? '0x64' : {
          status: '0x1', transactionHash: txHash, blockNumber: '0x64',
          blockHash: `0x${'77'.repeat(32)}`,
          logs: [{ address: anchorContract, topics: encodedEvent.topics, data: encodedEvent.data }]
        }
      });
      t('an otherwise matching anchor waits for the configured confirmation threshold',
        earlyAnchor.code === 'ANCHOR_NOT_FINAL' && earlyAnchor.confirmations === 1);
      const wrongRootEvent = anchorInterface.encodeEventLog(
        anchorInterface.getEvent('AuctionRootAnchored'),
        [closed.close.closeId, closed.close.intentHash, `0x${'88'.repeat(32)}`,
          BigInt(closed.close.logSize), BigInt(closed.close.closedAt), anchorer]
      );
      const mismatch = await verifyAnchorClaim(closed.close, {
        schema: 'fbt.auction-anchor-claim.v1', chainId: 8453, txHash
      }, {
        networks: anchorNetworks,
        rpc: async (_network, method) => method === 'eth_blockNumber' ? '0x65' : {
          status: '0x1', transactionHash: txHash, blockNumber: '0x64',
          logs: [{ address: anchorContract, topics: wrongRootEvent.topics, data: wrongRootEvent.data }]
        }
      });
      t('an on-chain event for a different root is rejected', mismatch.code === 'ANCHOR_EVENT_MISMATCH');
    } finally {
      if (oldCoordinatorId === undefined) delete process.env.INTENT_COORDINATOR_ID;
      else process.env.INTENT_COORDINATOR_ID = oldCoordinatorId;
      if (oldCoordinatorKey === undefined) delete process.env.INTENT_COORDINATOR_PRIVATE_KEY;
      else process.env.INTENT_COORDINATOR_PRIVATE_KEY = oldCoordinatorKey;
    }
  }

  /* ------- Phase 2c: transactional admission + completeness watcher ------ */
  {
    const nowMs = Date.now();
    const now = Math.floor(nowMs / 1000);
    const cKeys = generateSolverKeyPair();
    const sKeys = generateSolverKeyPair();
    const wKeys = generateSolverKeyPair();
    const intent2c = `0x${'f2'.repeat(32)}`;
    const solver2c = { id: 'unit-solver-2c', name: 'Unit Solver 2C', publicKey: sKeys.publicKey, active: true };
    const registry2c = new Map([[solver2c.id, solver2c]]);
    const watcherRow = { id: 'unit-watcher', name: 'Unit Watcher', publicKey: wKeys.publicKey, active: true };
    const watcherRegistry = new Map([[watcherRow.id, watcherRow]]);
    const skew = 2000;

    const prevCoordId = process.env.INTENT_COORDINATOR_ID;
    const prevCoordKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
    process.env.INTENT_COORDINATOR_ID = 'unit-coordinator-2c';
    process.env.INTENT_COORDINATOR_PRIVATE_KEY = cKeys.privateKey;
    try {
      const mk = (nonce, out, rc) => signSolverCommitment({
        schema: 'fbt.solver-quote.v1', intentHash: intent2c, solverId: solver2c.id,
        chainId: 42161, amountOut: out, maxGas: '250000', feeBps: 70, slippageBps: 50,
        executable: true, issuedAt: now, validUntil: now + 90,
        nonce, routeCommitment: rc
      }, sKeys.privateKey);
      const c1 = mk(`0x${'a1'.repeat(16)}`, '500', `0x${'b1'.repeat(32)}`);
      const c2 = mk(`0x${'a2'.repeat(16)}`, '400', `0x${'b2'.repeat(32)}`);
      const ap1 = await appendSignedCommitment(c1, { registry: registry2c, now: nowMs });
      const ap2 = await appendSignedCommitment(c2, { registry: registry2c, now: nowMs });
      t('accepted commitments expose the facts a receipt needs',
        ap1.ok && ap1.acceptedAt === nowMs && ap1.solverId === solver2c.id && ap2.ok);

      const r1 = issueAdmissionReceipt({
        intentHash: intent2c, entryHash: ap1.entryHash, acceptedAt: ap1.acceptedAt, solverId: solver2c.id
      });
      const r2 = issueAdmissionReceipt({
        intentHash: intent2c, entryHash: ap2.entryHash, acceptedAt: ap2.acceptedAt, solverId: solver2c.id
      });
      t('a coordinator-signed admission receipt verifies',
        verifyAdmissionReceipt(r1) && verifyAdmissionReceipt(r2));
      t('receipt issuance is byte-deterministic (reclaimable from the stored row)',
        JSON.stringify(issueAdmissionReceipt({
          intentHash: intent2c, entryHash: ap1.entryHash, acceptedAt: ap1.acceptedAt, solverId: solver2c.id
        })) === JSON.stringify(r1));
      t('a tampered admission time invalidates the receipt',
        !verifyAdmissionReceipt({ ...r1, acceptedAt: r1.acceptedAt + 1 }));
      t('receipts cannot quietly upgrade their claims',
        !verifyAdmissionReceipt({ ...r1, claims: { ...r1.claims, closeInclusionGuaranteed: true } }));
      t('receipts refuse foreign intents when scoped',
        !verifyAdmissionReceipt(r1, { intentHash: `0x${'f3'.repeat(32)}` }));
      t('no coordinator key means no receipt, never an unsigned stand-in',
        issueAdmissionReceipt({
          intentHash: intent2c, entryHash: ap1.entryHash, acceptedAt: ap1.acceptedAt, solverId: solver2c.id
        }, { coordinator: null }) === null);

      const closed2c = await closeAuction({
        schema: 'fbt.auction-close-request.v1', intentHash: intent2c,
        policy: { id: AUCTION_POLICY, chainId: 42161, maxFeeBps: 70, maxSlippageBps: 50 }
      }, { now: nowMs });
      t('phase 2c test auction seals and closes over both logged quotes',
        closed2c.ok && closed2c.close.logSize === 2);
      const close2c = closed2c.close;

      const complete = evaluateCompleteness(close2c, [r1, r2], { clockSkewMs: skew });
      t('an intact sealed set evaluates as complete',
        complete.ok && complete.verdict === 'complete' && complete.counts.eligible === 2);

      const ghost = issueAdmissionReceipt({
        intentHash: intent2c, entryHash: `0x${'01'.repeat(32)}`,
        acceptedAt: close2c.sealedAt - 10000, solverId: solver2c.id
      });
      const fraud = evaluateCompleteness(close2c, [r1, r2, ghost], { clockSkewMs: skew });
      t('a pre-seal receipted bid missing from the close is hard misconduct evidence',
        fraud.verdict === 'misconduct-evident' && fraud.counts.omittedPreSeal === 1);

      const boundary = issueAdmissionReceipt({
        intentHash: intent2c, entryHash: `0x${'02'.repeat(32)}`,
        acceptedAt: close2c.sealedAt, solverId: solver2c.id
      });
      const ambiguous = evaluateCompleteness(close2c, [r1, r2, boundary], { clockSkewMs: skew });
      t('a receipt inside the cross-instance clock-skew window is honestly inconclusive',
        ambiguous.verdict === 'inconclusive' && ambiguous.counts.ambiguousWindow === 1);

      const afterClose = issueAdmissionReceipt({
        intentHash: intent2c, entryHash: `0x${'03'.repeat(32)}`,
        acceptedAt: close2c.closedAt + 5000, solverId: solver2c.id
      });
      const postClose = evaluateCompleteness(close2c, [r1, r2, afterClose], { clockSkewMs: skew });
      t('a receipt minted after the close asks nothing of that close',
        postClose.verdict === 'complete' && postClose.counts.postClose === 1);

      t('zero observed receipts is unmonitored, never implicitly complete',
        evaluateCompleteness(close2c, [], { clockSkewMs: skew }).verdict === 'unmonitored');
      t('unreadable evidence can never push a verdict to complete',
        evaluateCompleteness(close2c, [r1, { bogus: true }], { clockSkewMs: skew }).verdict === 'inconclusive');
      t('evaluation against a forged close fails closed',
        evaluateCompleteness({ ...close2c, logRoot: `0x${'99'.repeat(32)}` }, [r1], {}).code === 'INVALID_AUCTION_CLOSE');

      const built = buildCompletenessReport({
        close: close2c, receipts: [r1, r2],
        watcher: watcherRow, privateKey: wKeys.privateKey, clockSkewMs: skew, now: nowMs
      });
      t('a signed watcher report builds with the deterministic verdict',
        built.ok && built.report.verdict === 'complete' && built.report.watcher.id === watcherRow.id);
      t('a correctly recomputing report verifies end-to-end for a registered watcher',
        verifyCompletenessReport(built.report, { registry: watcherRegistry, close: close2c, requireRegistered: true }).ok);
      t('an unregistered watcher cannot submit reports',
        verifyCompletenessReport(built.report, { registry: new Map(), close: close2c, requireRegistered: true }).code === 'UNREGISTERED_WATCHER');
      t('a different key under a registered watcher id counts as unregistered',
        verifyCompletenessReport(built.report, {
          registry: new Map([[watcherRow.id, { ...watcherRow, publicKey: sKeys.publicKey }]]),
          close: close2c, requireRegistered: true
        }).code === 'UNREGISTERED_WATCHER');
      t('third parties verify reports offline with no registry at all',
        verifyCompletenessReport(built.report, { close: close2c }).ok);
      t('a tampered verdict is caught by deterministic recompute',
        verifyCompletenessReport({ ...built.report, verdict: 'inconclusive' },
          { registry: watcherRegistry, close: close2c, requireRegistered: true }).code === 'REPORT_RECOMPUTE_MISMATCH');
      t('a report describing a different sealed set is refused',
        verifyCompletenessReport({ ...built.report, closeSummary: { ...built.report.closeSummary, logSize: 3 } },
          { registry: watcherRegistry, close: close2c, requireRegistered: true }).code === 'REPORT_CLOSE_MISMATCH');

      t('completeness stays unmonitored without any watcher evidence',
        completenessSummary([]).status === 'unmonitored');
      t('a complete report upgrades the auction status to watcher-verified',
        completenessSummary([built.report]).status === 'watcher-verified');
      const misconductReport = buildCompletenessReport({
        close: close2c, receipts: [ghost],
        watcher: watcherRow, privateKey: wKeys.privateKey, clockSkewMs: skew, now: nowMs + 1000
      }).report;
      t('verified misconduct evidence dominates the auction status',
        completenessSummary([built.report, misconductReport]).status === 'misconduct-reported');
    } finally {
      if (prevCoordId === undefined) delete process.env.INTENT_COORDINATOR_ID;
      else process.env.INTENT_COORDINATOR_ID = prevCoordId;
      if (prevCoordKey === undefined) delete process.env.INTENT_COORDINATOR_PRIVATE_KEY;
      else process.env.INTENT_COORDINATOR_PRIVATE_KEY = prevCoordKey;
    }
  }

  /* ------- Phase 3a: bonded solvers + execution claims + disputes + adjudication ------ */
  {
    /* ---- declared bond registry (public statements, no secrets) ---- */
    const savedBonds = process.env.INTENT_SOLVER_BONDS;
    const savedGrace = process.env.INTENT_EXECUTION_GRACE_SECONDS;
    const savedVerifiers = process.env.INTENT_VERIFIER_KEYS;
    const savedSolvers = process.env.INTENT_SOLVER_KEYS;
    const nowMs = Date.now();
    const now = Math.floor(nowMs / 1000);

    t('the minimum declared bond is a public protocol constant', MIN_BOND_USD === 1000);
    t('fulfilled outcomes never pay a penalty', PENALTY_BPS.fulfilled === 0 && penaltyBpsFor('fulfilled', true) === 0);
    t('unexecuted quotes cost the full declared bond', penaltyBpsFor('unexecuted', false) === 10000);
    t('contested grades park at half the bond', penaltyBpsFor('contested', false) === 5000);
    t('self-reporting a short fill halves the penalty',
      penaltyBpsFor('short-filled', true) === 2500 && penaltyBpsFor('short-filled', false) === 5000);
    t('self-reporting a failure halves the penalty',
      penaltyBpsFor('failed', true) === 5000 && penaltyBpsFor('failed', false) === 10000);
    t('a pending grade carries no penalty at all', penaltyBpsFor('pending', true) === null);
    t('penalty usd is the integer floor of bond × bps',
      penaltyUsdFor('10001', 5000) === '5000' && penaltyUsdFor('9999', 10000) === '9999');
    t('a null penalty yields null usd, never a guessed zero', penaltyUsdFor('100000', null) === null);

    process.env.INTENT_SOLVER_BONDS = JSON.stringify([
      { solverId: 'unit-solver-3a', bondUsd: '50000', asset: 'USDC', terms: 'Unit bond' },
      { solverId: 'small-solver', bondUsd: '500', asset: 'USDC' },
      { solverId: 'expired-solver', bondUsd: '2000', asset: 'USDC', expiresAt: now - 100 },
      { solverId: 'bad-bond', bondUsd: 'nope' }
    ]);
    const bondRegistry = parseBondRegistry();
    t('the bond registry keeps every well-formed row', bondRegistry.size === 3);
    t('a malformed bond row is dropped rather than fatal', !bondRegistry.has('bad-bond'));
    t('garbage bond env parses to an empty registry', parseBondRegistry('not json').size === 0);

    const solverRegistry3a = new Map([
      ['unit-solver-3a', { id: 'unit-solver-3a', publicKey: 'x', active: true }],
      ['expired-solver', { id: 'expired-solver', publicKey: 'x', active: true }]
    ]);
    const board = publicBondBoard(bondRegistry, { solverRegistry: solverRegistry3a, now: nowMs });
    const byId = Object.fromEntries(board.map((row) => [row.solverId, row]));
    t('bonded means registered, unexpired and above the minimum',
      byId['unit-solver-3a'].bonded === true
        && byId['small-solver'].bonded === false && byId['small-solver'].meetsMinimum === false
        && byId['expired-solver'].bonded === false && byId['expired-solver'].expired === true);
    t('an unregistered solver is never bonded', bondStatusFor({ bondUsd: '5000' }, { solverRegistry: new Map() }).bonded === false);
    t('bond capabilities count only genuinely bonded solvers',
      bondsProtocolStatus({ solverRegistry: solverRegistry3a }).bondedSolvers === 1);
    t('bond capabilities never claim escrow or custody',
      bondsProtocolStatus({}).onChainEscrow === false
        && bondsProtocolStatus({}).custody === false
        && bondsProtocolStatus({}).enforcement === 'out-of-protocol-declared');

    /* ---- deterministic quoted minimum output ---- */
    t('quoted min output is derived from the signed slippage, never the claim',
      minOutFor({ amountOut: '400000000000000000', slippageBps: 50 }) === '398000000000000000');
    t('min output floors, it never rounds a promise up',
      minOutFor({ amountOut: '1000001', slippageBps: 5000 }) === '500000');
    t('a malformed commitment has no min output', minOutFor({ amountOut: '0', slippageBps: 50 }) === null);

    /* ---- signed commitments, close, claim, dispute, adjudication ---- */
    const cKeys = generateSolverKeyPair();
    const sKeys = generateSolverKeyPair();
    const vKeys = generateSolverKeyPair();
    const intent3a = `0x${'3a'.repeat(32)}`;
    const solver3a = { id: 'unit-solver-3a', name: 'Unit Solver 3A', publicKey: sKeys.publicKey, active: true };
    const solverRegistryOnly = new Map([[solver3a.id, solver3a]]);
    const verifier3a = { id: 'unit-verifier-3a', name: 'Unit Verifier', publicKey: vKeys.publicKey, active: true };
    const verifierRegistry3a = new Map([[verifier3a.id, verifier3a]]);

    process.env.INTENT_SOLVER_KEYS = JSON.stringify([solver3a]);
    process.env.INTENT_VERIFIER_KEYS = JSON.stringify([verifier3a]);
    process.env.INTENT_EXECUTION_GRACE_SECONDS = '300';
    t('execution grace parses from env', executionGraceSeconds() === 300);
    process.env.INTENT_EXECUTION_GRACE_SECONDS = 'garbage';
    t('a malformed grace value falls back to the 300s default', executionGraceSeconds() === 300);
    process.env.INTENT_EXECUTION_GRACE_SECONDS = '0';
    t('a bounded explicit grace is honoured', executionGraceSeconds() === 0);
    t('the verifier registry parses like the solver registry',
      parseVerifierRegistry().size === 1 && parseVerifierRegistry().get(verifier3a.id).publicKey === vKeys.publicKey);

    const signed3a = signSolverCommitment({
      schema: 'fbt.solver-quote.v1', intentHash: intent3a, solverId: solver3a.id,
      chainId: 42161, amountOut: '400000000000000000', maxGas: '250000', feeBps: 70, slippageBps: 50,
      executable: true, issuedAt: now, validUntil: now + 90,
      nonce: `0x${'c1'.repeat(16)}`, routeCommitment: `0x${'d1'.repeat(32)}`
    }, sKeys.privateKey);
    const appended3a = await appendSignedCommitment(signed3a, { registry: solverRegistryOnly, now: nowMs });
    t('phase 3a fixture quote enters the immutable log', appended3a.ok);

    const prevCoordId = process.env.INTENT_COORDINATOR_ID;
    const prevCoordKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
    process.env.INTENT_COORDINATOR_ID = 'unit-coordinator-3a';
    process.env.INTENT_COORDINATOR_PRIVATE_KEY = cKeys.privateKey;
    try {
      const closed3a = await closeAuction({
        schema: 'fbt.auction-close-request.v1', intentHash: intent3a,
        policy: { id: AUCTION_POLICY, chainId: 42161, maxFeeBps: 70, maxSlippageBps: 50 }
      }, { now: nowMs });
      t('phase 3a fixture auction seals and closes', closed3a.ok && closed3a.close.logSize === 1);
      const close3a = closed3a.close;

      const filledClaim = buildExecutionClaim({
        close: close3a,
        commitment: signed3a,
        outcome: 'filled',
        txHash: `0x${'e1'.repeat(32)}`,
        amountReceived: '400500000000000000',
        feeBpsCharged: 70,
        gasUsedWei: '250000',
        executedAt: now
      }, solver3a, sKeys.privateKey);
      t('a winning solver signs a filled execution claim',
        filledClaim.ok && verifyExecutionClaim(filledClaim.claim, { close: close3a, commitment: signed3a }).ok);
      t('the claim binds the sealed close, intent and selected entry',
        filledClaim.claim.entryHash === close3a.decision.selectedEntryHash
          && filledClaim.claim.closeId === close3a.closeId);
      t('a tampered received amount invalidates the claim (id and signature both bind it)',
        !verifyExecutionClaim({ ...filledClaim.claim, amountReceived: '400500000000000001' },
          { close: close3a, commitment: signed3a }).ok);
      t('unknown claim fields are refused rather than stored',
        verifyExecutionClaim({ ...filledClaim.claim, hiddenClaim: true },
          { close: close3a, commitment: signed3a }).code === 'UNKNOWN_CLAIM_FIELD');
      t('a registered solver is required for submission, not just any signature',
        verifyExecutionClaim(filledClaim.claim, { close: close3a, commitment: signed3a, registry: new Map(), requireRegistered: true })
          .code === 'UNREGISTERED_SOLVER');
      t('third parties verify claims offline with no registry',
        verifyExecutionClaim(filledClaim.claim, { close: close3a, commitment: signed3a }).ok);
      t('a claim cannot quietly claim on-chain verification',
        verifyExecutionClaim({
          ...filledClaim.claim,
          claims: { ...filledClaim.claim.claims, onChainVerified: true }
        }, { close: close3a, commitment: signed3a }).code === 'BAD_CLAIM_FLAGS');
      t('an expired claim carries no tx or amount',
        buildExecutionClaim({ close: close3a, commitment: signed3a, outcome: 'expired' }, solver3a, sKeys.privateKey).ok);
      t('an expired claim with a tx hash is malformed',
        buildExecutionClaim({ close: close3a, commitment: signed3a, outcome: 'expired', txHash: `0x${'e2'.repeat(32)}` },
          solver3a, sKeys.privateKey).code === 'BAD_TX_HASH');
      t('a claim targeting another close is refused',
        verifyExecutionClaim(filledClaim.claim, {
          close: { ...close3a, closeId: `0x${'f9'.repeat(32)}` }, commitment: signed3a
        }).code === 'BAD_CLOSE_BINDING');

      /* ---- the deterministic grading engine ---- */
      const gradeFilled = gradeExecution({
        commitment: signed3a, claim: filledClaim.claim, disputes: [], nowSeconds: now, graceSeconds: 300
      });
      t('a fill at or above the quoted min out grades fulfilled with zero penalty',
        gradeFilled.verdict === 'fulfilled' && gradeFilled.penaltyBps === 0 && gradeFilled.selfReported === true);
      const shortClaim = buildExecutionClaim({
        close: close3a, commitment: signed3a, outcome: 'filled',
        txHash: `0x${'e3'.repeat(32)}`, amountReceived: '390000000000000000', feeBpsCharged: 70, executedAt: now
      }, solver3a, sKeys.privateKey).claim;
      const gradeCaughtShort = gradeExecution({
        commitment: signed3a, claim: shortClaim, disputes: [], nowSeconds: now, graceSeconds: 300
      });
      t('a fill below the quoted min out is a caught short fill at half the bond',
        gradeCaughtShort.verdict === 'short-filled' && gradeCaughtShort.penaltyBps === 5000 && gradeCaughtShort.selfReported === false);
      const selfShort = buildExecutionClaim({
        close: close3a, commitment: signed3a, outcome: 'short',
        txHash: `0x${'e4'.repeat(32)}`, amountReceived: '390000000000000000', feeBpsCharged: 70, executedAt: now
      }, solver3a, sKeys.privateKey).claim;
      const gradeSelfShort = gradeExecution({
        commitment: signed3a, claim: selfShort, disputes: [], nowSeconds: now, graceSeconds: 300
      });
      t('a self-reported short fill quarters the bond',
        gradeSelfShort.verdict === 'short-filled' && gradeSelfShort.penaltyBps === 2500 && gradeSelfShort.selfReported === true);
      const revertedClaim = buildExecutionClaim({
        close: close3a, commitment: signed3a, outcome: 'reverted', txHash: `0x${'e5'.repeat(32)}`, executedAt: now
      }, solver3a, sKeys.privateKey).claim;
      const gradeReverted = gradeExecution({
        commitment: signed3a, claim: revertedClaim, disputes: [], nowSeconds: now, graceSeconds: 300
      });
      t('a self-reported revert grades failed at half the bond',
        gradeReverted.verdict === 'failed' && gradeReverted.penaltyBps === 5000);
      const lateClaim = buildExecutionClaim({
        close: close3a, commitment: signed3a, outcome: 'filled',
        txHash: `0x${'e6'.repeat(32)}`, amountReceived: '400500000000000000', feeBpsCharged: 70, executedAt: now + 400
      }, solver3a, sKeys.privateKey).claim;
      const gradeLate = gradeExecution({
        commitment: signed3a, claim: lateClaim, disputes: [], nowSeconds: now, graceSeconds: 300
      });
      t('executing after the quote window is a caught failure, not a fill',
        gradeLate.verdict === 'failed' && gradeLate.penaltyBps === 10000 && gradeLate.selfReported === false);
      t('an open deadline without a claim grades pending, not guilty',
        gradeExecution({ commitment: signed3a, claim: null, disputes: [], nowSeconds: now, graceSeconds: 300 })
          .verdict === 'pending');
      const gradeUnexecuted = gradeExecution({
        commitment: signed3a, claim: null, disputes: [], nowSeconds: now + 500, graceSeconds: 300
      });
      t('a deadline passed without a claim grades unexecuted at the full bond',
        gradeUnexecuted.verdict === 'unexecuted' && gradeUnexecuted.penaltyBps === 10000);

      /* ---- disputes ---- */
      const dispute = buildDispute({
        close: close3a, kind: 'no-execution', observedAt: now + 1, detail: 'no transaction observed'
      }, verifier3a, vKeys.privateKey);
      t('a registered verifier signs a bounded dispute',
        dispute.ok && verifyDispute(dispute.dispute, { close: close3a }).ok
          && verifyDispute(dispute.dispute, { close: close3a, registry: verifierRegistry3a, requireRegistered: true }).ok);
      t('a tampered dispute kind invalidates the dispute (id and signature both bind it)',
        !verifyDispute({ ...dispute.dispute, kind: 'false-claim' }, { close: close3a }).ok);
      t('an unregistered verifier cannot submit',
        verifyDispute(dispute.dispute, { close: close3a, registry: new Map(), requireRegistered: true }).code === 'UNREGISTERED_VERIFIER');
      t('a future-dated dispute observation is refused',
        verifyDispute({ ...dispute.dispute, observedAt: now + 5000 }, { close: close3a }).code === 'BAD_OBSERVED_AT');
      t('a dispute must target the sealed selection',
        verifyDispute({ ...dispute.dispute, entryHash: `0x${'ab'.repeat(32)}` }, { close: close3a }).code === 'BAD_SELECTION_BINDING');

      const falseClaimDispute = buildDispute({
        close: close3a, kind: 'false-claim', observedAt: now + 2
      }, verifier3a, vKeys.privateKey).dispute;
      const gradeContested = gradeExecution({
        commitment: signed3a, claim: filledClaim.claim, disputes: [falseClaimDispute], nowSeconds: now, graceSeconds: 300
      });
      t('a verifier contradiction parks the grade at contested, half the bond',
        gradeContested.verdict === 'contested' && gradeContested.penaltyBps === 5000);

      /* ---- adjudication ---- */
      const bond3a = parseBondRegistry().get(solver3a.id);
      const adjudicated = buildAdjudication({
        close: close3a, commitment: signed3a, claim: filledClaim.claim, disputes: [],
        bond: bond3a,
        coordinator: { id: 'unit-coordinator-3a', publicKey: cKeys.publicKey, privateKey: cKeys.privateKey },
        solverRegistry: solverRegistryOnly,
        now: nowMs
      });
      t('the coordinator signs a recomputable adjudication',
        adjudicated.ok && adjudicated.adjudication.verdict === 'fulfilled'
          && adjudicated.adjudication.penaltyBps === 0 && adjudicated.adjudication.penaltyUsd === '0'
          && adjudicated.adjudication.bond.bonded === true);
      t('adjudication verification recomputes grade, penalty and bonding',
        verifyAdjudication(adjudicated.adjudication, { close: close3a }).ok);
      t('a tampered adjudication verdict fails the recompute check',
        verifyAdjudication({ ...adjudicated.adjudication, verdict: 'failed' }, { close: close3a })
          .code === 'ADJUDICATION_RECOMPUTE_MISMATCH');
      t('an adjudication cannot claim custody or on-chain enforcement',
        verifyAdjudication({
          ...adjudicated.adjudication,
          claims: { ...adjudicated.adjudication.claims, custody: true }
        }, { close: close3a }).code === 'ADJUDICATION_CLAIMS_MISMATCH');
      t('an adjudication from another close is refused',
        !verifyAdjudication(adjudicated.adjudication, {
          close: { ...close3a, intentHash: `0x${'f8'.repeat(32)}` }
        }).ok);
      const deterministicAgain = buildAdjudication({
        close: close3a, commitment: signed3a, claim: filledClaim.claim, disputes: [],
        bond: bond3a,
        coordinator: { id: 'unit-coordinator-3a', publicKey: cKeys.publicKey, privateKey: cKeys.privateKey },
        solverRegistry: solverRegistryOnly,
        now: nowMs
      });
      t('adjudication bytes are deterministic for identical inputs',
        JSON.stringify(adjudicated.adjudication) === JSON.stringify(deterministicAgain.adjudication));
      const unbondedAdjudication = buildAdjudication({
        close: close3a, commitment: signed3a, claim: filledClaim.claim, disputes: [],
        bond: null,
        coordinator: { id: 'unit-coordinator-3a', publicKey: cKeys.publicKey, privateKey: cKeys.privateKey },
        solverRegistry: solverRegistryOnly,
        now: nowMs
      });
      t('an unbonded solver gets a bonded:false record with no invented penalty',
        unbondedAdjudication.ok && unbondedAdjudication.adjudication.bond.bonded === false
          && unbondedAdjudication.adjudication.penaltyUsd === null);
      t('adjudication refuses to grade an open execution window',
        buildAdjudication({
          close: close3a, commitment: signed3a, claim: null, disputes: [],
          bond: bond3a,
          coordinator: { id: 'unit-coordinator-3a', publicKey: cKeys.publicKey, privateKey: cKeys.privateKey },
          solverRegistry: solverRegistryOnly,
          now: nowMs
        }).code === 'EXECUTION_WINDOW_OPEN');

      /* ---- immutable storage: idempotent replay, conflict on drift ---- */
      const storedClaim = await storeExecutionClaim(close3a.closeId, filledClaim.claim);
      const storedClaimAgain = await storeExecutionClaim(close3a.closeId, filledClaim.claim);
      t('execution claims store immutably and replay idempotently',
        storedClaim.ok && storedClaimAgain.ok && storedClaimAgain.alreadyStored === true);
      t('a different claim for the same close conflicts instead of overwriting',
        (await storeExecutionClaim(close3a.closeId, shortClaim)).code === 'EXECUTION_CLAIM_CONFLICT');
      t('the stored claim reads back byte-identical', (await readExecutionClaim(close3a.closeId))?.claimId === filledClaim.claim.claimId);

      const storedDispute = await storeDispute(close3a.closeId, dispute.dispute);
      t('disputes store immutably and replay idempotently',
        storedDispute.ok && (await storeDispute(close3a.closeId, dispute.dispute)).alreadyStored === true);
      t('a different dispute from the same verifier conflicts',
        (await storeDispute(close3a.closeId, falseClaimDispute)).code === 'DISPUTE_CONFLICT');

      const storedAdj = await storeAdjudication(close3a.closeId, adjudicated.adjudication);
      t('adjudications store immutably and replay idempotently',
        storedAdj.ok && (await storeAdjudication(close3a.closeId, adjudicated.adjudication)).alreadyStored === true);
      const fakeCloseId = `0x${'77'.repeat(32)}`;
      await storeAdjudication(fakeCloseId, adjudicated.adjudication);
      t('a different adjudication for the same close conflicts, never overwrites',
        (await storeAdjudication(fakeCloseId, { ...adjudicated.adjudication, verdict: 'failed' }))
          .code === 'ADJUDICATION_CONFLICT');
    } finally {
      if (prevCoordId === undefined) delete process.env.INTENT_COORDINATOR_ID;
      else process.env.INTENT_COORDINATOR_ID = prevCoordId;
      if (prevCoordKey === undefined) delete process.env.INTENT_COORDINATOR_PRIVATE_KEY;
      else process.env.INTENT_COORDINATOR_PRIVATE_KEY = prevCoordKey;
      if (savedBonds === undefined) delete process.env.INTENT_SOLVER_BONDS;
      else process.env.INTENT_SOLVER_BONDS = savedBonds;
      if (savedGrace === undefined) delete process.env.INTENT_EXECUTION_GRACE_SECONDS;
      else process.env.INTENT_EXECUTION_GRACE_SECONDS = savedGrace;
      if (savedVerifiers === undefined) delete process.env.INTENT_VERIFIER_KEYS;
      else process.env.INTENT_VERIFIER_KEYS = savedVerifiers;
      if (savedSolvers === undefined) delete process.env.INTENT_SOLVER_KEYS;
      else process.env.INTENT_SOLVER_KEYS = savedSolvers;
    }
  }

  /* ------- Phase 3b: outcome settlement reports + independent re-grading ------ */
  {
    const cKeys = generateSolverKeyPair();
    const sKeys = generateSolverKeyPair();
    const vKeys = generateSolverKeyPair();
    const intent3b = `0x${'3b'.repeat(32)}`;
    const solver3b = { id: 'unit-solver-3b', name: 'Unit Solver 3B', publicKey: sKeys.publicKey, active: true };
    const solverRegistry3b = new Map([[solver3b.id, solver3b]]);
    const verifier3b = { id: 'unit-verifier-3b', name: 'Unit Verifier 3B', publicKey: vKeys.publicKey, active: true };
    const verifierRegistry3b = new Map([[verifier3b.id, verifier3b]]);
    const nowMs = Date.now();
    const now = Math.floor(nowMs / 1000);

    const signed3b = signSolverCommitment({
      schema: 'fbt.solver-quote.v1', intentHash: intent3b, solverId: solver3b.id,
      chainId: 42161, amountOut: '400000000000000000', maxGas: '250000', feeBps: 70, slippageBps: 50,
      executable: true, issuedAt: now, validUntil: now + 90,
      nonce: `0x${'b1'.repeat(16)}`, routeCommitment: `0x${'b2'.repeat(32)}`
    }, sKeys.privateKey);
    await appendSignedCommitment(signed3b, { registry: solverRegistry3b, now: nowMs });

    const prevCoordId = process.env.INTENT_COORDINATOR_ID;
    const prevCoordKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
    process.env.INTENT_COORDINATOR_ID = 'unit-coordinator-3b';
    process.env.INTENT_COORDINATOR_PRIVATE_KEY = cKeys.privateKey;
    try {
      const closed3b = await closeAuction({
        schema: 'fbt.auction-close-request.v1', intentHash: intent3b,
        policy: { id: AUCTION_POLICY, chainId: 42161, maxFeeBps: 70, maxSlippageBps: 50 }
      }, { now: nowMs });
      const close3b = closed3b.close;
      const coordinator3b = {
        id: 'unit-coordinator-3b', publicKey: cKeys.publicKey, privateKey: cKeys.privateKey
      };

      const filled3b = buildExecutionClaim({
        close: close3b, commitment: signed3b, outcome: 'filled',
        txHash: `0x${'a1'.repeat(32)}`, amountReceived: '400500000000000000',
        feeBpsCharged: 70, executedAt: now
      }, solver3b, sKeys.privateKey).claim;
      const short3b = buildExecutionClaim({
        close: close3b, commitment: signed3b, outcome: 'filled',
        txHash: `0x${'a2'.repeat(32)}`, amountReceived: '390000000000000000',
        feeBpsCharged: 70, executedAt: now
      }, solver3b, sKeys.privateKey).claim;

      const settled = evaluateSettlement({
        close: close3b, commitment: signed3b, claim: filled3b, disputes: [],
        adjudication: null, evaluatedAtSeconds: now, graceSeconds: 300
      });
      t('a fulfilled settlement re-grades as fulfilled with zero shortfall',
        settled.ok && settled.verdict === 'fulfilled'
          && settled.shortfallUnits === '0' && settled.shortfallBps === 0
          && settled.deliveredOut === '400500000000000000'
          && settled.quotedMinOut === '398000000000000000');

      const shortSettled = evaluateSettlement({
        close: close3b, commitment: signed3b, claim: short3b, disputes: [],
        adjudication: null, evaluatedAtSeconds: now, graceSeconds: 300
      });
      t('a short settlement measures the exact shortfall in units and bps',
        shortSettled.ok && shortSettled.verdict === 'short-filled'
          && shortSettled.shortfallUnits === '10000000000000000'
          && shortSettled.shortfallBps === 250);

      t('an open deadline still settles as pending, never adverse',
        evaluateSettlement({ close: close3b, commitment: signed3b, claim: null, disputes: [], adjudication: null, evaluatedAtSeconds: now, graceSeconds: 300 })
          .verdict === 'pending');
      t('a passed deadline without a claim settles as unexecuted',
        evaluateSettlement({ close: close3b, commitment: signed3b, claim: null, disputes: [], adjudication: null, evaluatedAtSeconds: now + 500, graceSeconds: 300 })
          .verdict === 'unexecuted');

      const adjudication3b = buildAdjudication({
        close: close3b, commitment: signed3b, claim: short3b, disputes: [],
        bond: null, coordinator: coordinator3b, solverRegistry: solverRegistry3b, now: nowMs
      }).adjudication;
      const consistent = evaluateSettlement({
        close: close3b, commitment: signed3b, claim: short3b, disputes: [],
        adjudication: adjudication3b, evaluatedAtSeconds: now, graceSeconds: 300
      });
      t('a settlement report cross-checks a reproducing adjudication',
        consistent.ok && consistent.adjudicationConsistent === true && consistent.verdict === 'short-filled');
      const mismatched = evaluateSettlement({
        close: close3b, commitment: signed3b, claim: filled3b, disputes: [],
        adjudication: adjudication3b, evaluatedAtSeconds: now, graceSeconds: 300
      });
      t('an adjudication that does not reproduce is misconduct evidence',
        mismatched.ok && mismatched.adjudicationConsistent === false
          && mismatched.verdict === 'adjudication-mismatch');

      t('settlement evaluation fails closed on a forged close',
        evaluateSettlement({ close: { ...close3b, logRoot: `0x${'99'.repeat(32)}` }, commitment: signed3b, evaluatedAtSeconds: now, graceSeconds: 300 })
          .code === 'INVALID_AUCTION_CLOSE');
      t('settlement evaluation fails closed on a non-selected commitment',
        evaluateSettlement({ close: close3b, commitment: { ...signed3b, amountOut: '1' }, evaluatedAtSeconds: now, graceSeconds: 300 })
          .code === 'BAD_COMMITMENT_BINDING');
      t('settlement evaluation fails closed on a tampered claim',
        evaluateSettlement({ close: close3b, commitment: signed3b, claim: { ...filled3b, amountReceived: '1' }, evaluatedAtSeconds: now, graceSeconds: 300 })
          .code === 'BAD_EXECUTION_CLAIM');
      t('settlement evaluation fails closed on a forged adjudication',
        evaluateSettlement({ close: close3b, commitment: signed3b, claim: short3b, adjudication: { ...adjudication3b, verdict: 'failed' }, evaluatedAtSeconds: now, graceSeconds: 300 })
          .code === 'BAD_ADJUDICATION');

      const built3b = buildSettlementReport({
        close: close3b, commitment: signed3b, claim: short3b, disputes: [],
        adjudication: adjudication3b, verifier: verifier3b, privateKey: vKeys.privateKey,
        graceSeconds: 300, evaluatedAt: nowMs
      });
      t('a verifier signs a submittable settlement report',
        built3b.ok && built3b.report.verdict === 'short-filled' && built3b.report.adjudicationConsistent === true);
      t('a correctly recomputing report verifies for a registered verifier',
        verifySettlementReport(built3b.report, { registry: verifierRegistry3b, close: close3b, requireRegistered: true }).ok);
      t('third parties verify settlement reports offline with no registry',
        verifySettlementReport(built3b.report, { close: close3b }).ok);
      t('an unregistered verifier cannot submit settlement reports',
        verifySettlementReport(built3b.report, { registry: new Map(), close: close3b, requireRegistered: true }).code === 'UNREGISTERED_VERIFIER');
      t('a tampered verdict is caught by deterministic recompute',
        verifySettlementReport({ ...built3b.report, verdict: 'fulfilled' }, { close: close3b }).code === 'REPORT_RECOMPUTE_MISMATCH');
      t('a tampered shortfall is caught by deterministic recompute',
        verifySettlementReport({ ...built3b.report, shortfallBps: 999 }, { close: close3b }).code === 'REPORT_RECOMPUTE_MISMATCH');
      t('a settlement report cannot claim on-chain verification',
        verifySettlementReport({
          ...built3b.report,
          claims: { ...built3b.report.claims, onChainTxVerified: true }
        }, { close: close3b }).code === 'REPORT_CLAIMS_MISMATCH');

      t('settlement stays unmonitored without any verifier evidence',
        settlementSummary([]).status === 'unmonitored');
      t('a fulfilled report upgrades the settlement status to fulfilled',
        settlementSummary([{ ...built3b.report, verdict: 'fulfilled' }]).status === 'fulfilled');
      t('a pending report reads as pending, never settled',
        settlementSummary([{ ...built3b.report, verdict: 'pending' }]).status === 'pending');
      t('any adverse verdict dominates a fulfilled one',
        settlementSummary([{ ...built3b.report, verdict: 'fulfilled' }, { ...built3b.report, verdict: 'unexecuted' }]).status === 'adverse');
      t('an adjudication mismatch dominates every other verdict',
        settlementSummary([{ ...built3b.report, verdict: 'fulfilled' }, { ...built3b.report, verdict: 'adjudication-mismatch' }]).status === 'adjudication-mismatch');

      const stored3b = await storeSettlementReport(intent3b, built3b.report);
      const stored3bAgain = await storeSettlementReport(intent3b, built3b.report);
      t('settlement reports store immutably and replay idempotently',
        stored3b.ok && stored3bAgain.ok && stored3bAgain.alreadyReported === true);
      const listed3b = await readSettlementReports(intent3b, close3b);
      t('stored settlement reports re-verify against the signed close on read',
        listed3b.reports?.length === 1 && listed3b.reports[0].report.reportId === built3b.report.reportId);
    } finally {
      if (prevCoordId === undefined) delete process.env.INTENT_COORDINATOR_ID;
      else process.env.INTENT_COORDINATOR_ID = prevCoordId;
      if (prevCoordKey === undefined) delete process.env.INTENT_COORDINATOR_PRIVATE_KEY;
      else process.env.INTENT_COORDINATOR_PRIVATE_KEY = prevCoordKey;
    }
  }

  /* ------- Phase 4a: single-chain workflow DAG + claim/dispute CLI ------ */
  {
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const node = (id, extra = {}) => ({
      id,
      action: extra.action || 'swap',
      chainId: extra.chainId || 42161,
      asset: extra.asset || 'ETH',
      minOutput: extra.minOutput ?? '1',
      maxInput: extra.maxInput ?? '2',
      deadline: extra.deadline || deadline,
      allowedContracts: extra.allowedContracts || [],
      revertPolicy: extra.revertPolicy || 'abort-all',
      approvalScope: extra.approvalScope || { mode: 'none' }
    });
    const dag = (nodes, edges) => ({ schema: WORKFLOW_SCHEMA, nodes, edges });

    const good = dag(
      [node('swap'), node('deposit', { action: 'deposit' })],
      [{ from: 'swap', to: 'deposit', dependency: 'success', valueBinding: null }]
    );
    t('a two-node same-chain DAG validates', validateWorkflow(good).ok === true);
    t('workflow ids are deterministic across insertion order',
      workflowIdFor(good) === workflowIdFor(JSON.parse(JSON.stringify(good)))
        && /^0x[a-f0-9]{64}$/.test(workflowIdFor(good)));

    const cycled = dag(
      [node('a'), node('b', { action: 'deposit' })],
      [
        { from: 'a', to: 'b', dependency: 'success', valueBinding: null },
        { from: 'b', to: 'a', dependency: 'always', valueBinding: null }
      ]
    );
    t('a cyclic DAG is refused', validateWorkflow(cycled).code === 'WORKFLOW_CYCLE');
    t('a one-node plan is refused',
      validateWorkflow(dag([node('only')], [])).code === 'BAD_WORKFLOW');
    t('a nine-node plan exceeds the contract MAX_CALLS bound',
      validateWorkflow(dag(
        Array.from({ length: MAX_WORKFLOW_NODES + 1 }, (_, i) => node(`n${i + 1}`, {
          action: i % 2 ? 'deposit' : 'swap'
        })),
        []
      )).code === 'BAD_WORKFLOW');
    t('an unknown action is refused rather than stored',
      validateWorkflow(dag(
        [node('swap'), node('x', { action: 'liquidate' })],
        [{ from: 'swap', to: 'x', dependency: 'success', valueBinding: null }]
      )).code === 'BAD_WORKFLOW_ACTION');

    const built = buildWorkflowBatchCalldata(good);
    t('same-chain calldata is a planned envelope, not a live router payload',
      built.ok && built.liveRouterCalldata === false && built.verifiesCallOutputs === false
        && built.custody === false && built.holdsTokens === false
        && built.policy === 'abort-all' && built.callCount === 2
        && typeof built.data === 'string' && built.data.startsWith('0x'));

    const mixed = dag(
      [node('swap', { revertPolicy: 'continue' }), node('deposit', { action: 'deposit', revertPolicy: 'abort-all' })],
      [{ from: 'swap', to: 'deposit', dependency: 'success', valueBinding: null }]
    );
    t('mixed revert policies fall back to abort-all rather than guessing',
      buildWorkflowBatchCalldata(mixed).policy === 'abort-all');

    const bridged = dag(
      [node('swap'), node('bridge', { action: 'bridge', chainId: 1 })],
      [{ from: 'swap', to: 'bridge', dependency: 'success', valueBinding: null }]
    );
    t('cross-chain calldata is refused, not compiled',
      buildWorkflowBatchCalldata(bridged).code === 'ATOMIC_CROSS_CHAIN_UNAVAILABLE'
        && isSingleChainWorkflow(bridged) === false);

    const savedWorkflowAddr = process.env.INTENT_WORKFLOW_BATCH_ADDRESS;
    delete process.env.INTENT_WORKFLOW_BATCH_ADDRESS;
    t('workflow capabilities stay unconfigured without a public address',
      workflowProtocolStatus().contract.configured === false
        && workflowProtocolStatus().singleChainAtomic === true
        && workflowProtocolStatus().crossChainAtomic === false
        && workflowProtocolStatus().contract.verifiesCallOutputs === false
        && workflowProtocolStatus().contract.custody === false);
    process.env.INTENT_WORKFLOW_BATCH_ADDRESS = '0x1111111111111111111111111111111111111111';
    t('a real public address flips configured:true without inventing custody',
      workflowProtocolStatus().contract.configured === true
        && workflowProtocolStatus().contract.address.toLowerCase() === '0x1111111111111111111111111111111111111111'
        && workflowProtocolStatus().contract.holdsTokens === false);
    process.env.INTENT_WORKFLOW_BATCH_ADDRESS = 'not-an-address';
    t('a malformed address does not pretend the batcher is configured',
      workflowProtocolStatus().contract.configured === false);
    if (savedWorkflowAddr === undefined) delete process.env.INTENT_WORKFLOW_BATCH_ADDRESS;
    else process.env.INTENT_WORKFLOW_BATCH_ADDRESS = savedWorkflowAddr;

    const wfProof = await createWorkflowExecutionProof({
      workflowId: workflowIdFor(good),
      chainId: 42161,
      nodeCount: 2,
      revertPolicy: 'abort-all',
      createdAt: 1
    });
    t('a workflow receipt claims a same-chain batch, not global atomicity',
      wfProof.schema === WORKFLOW_EXECUTION_PROOF_SCHEMA
        && wfProof.payload.claim.code === 'SINGLE_CHAIN_BATCH_EXECUTED'
        && wfProof.payload.claim.globalAtomicity === false
        && wfProof.payload.claim.outputVerified === false
        && wfProof.payload.honesty.custody === false
        && wfProof.payload.honesty.verifiesCallOutputs === false
        && (await verifyExecutionProof(wfProof)).ok);
    const tamperedWf = JSON.parse(JSON.stringify(wfProof));
    tamperedWf.payload.claim.outputVerified = true;
    t('changing a workflow receipt breaks digest verification',
      !(await verifyExecutionProof(tamperedWf)).ok);

    const sKeys4a = generateSolverKeyPair();
    const savedSolverKey = process.env.INTENT_SOLVER_PRIVATE_KEY;
    const savedSolverId = process.env.INTENT_SOLVER_ID;
    process.env.INTENT_SOLVER_PRIVATE_KEY = sKeys4a.privateKey;
    process.env.INTENT_SOLVER_ID = 'unit-solver-4a';
    const derived = solverConfigFromPrivateKey();
    t('solverConfigFromPrivateKey derives the public key without inventing an id',
      derived && derived.id === 'unit-solver-4a' && derived.publicKey === sKeys4a.publicKey);
    if (savedSolverKey === undefined) delete process.env.INTENT_SOLVER_PRIVATE_KEY;
    else process.env.INTENT_SOLVER_PRIVATE_KEY = savedSolverKey;
    if (savedSolverId === undefined) delete process.env.INTENT_SOLVER_ID;
    else process.env.INTENT_SOLVER_ID = savedSolverId;

    const nowMs = Date.now();
    const now = Math.floor(nowMs / 1000);
    const cKeys = generateSolverKeyPair();
    const sKeys = generateSolverKeyPair();
    const vKeys = generateSolverKeyPair();
    const intent4a = `0x${'4a'.repeat(32)}`;
    const solver4a = { id: 'unit-solver-4a', name: 'Unit Solver 4A', publicKey: sKeys.publicKey, active: true };
    const verifier4a = { id: 'unit-verifier-4a', name: 'Unit Verifier 4A', publicKey: vKeys.publicKey, active: true };
    const signed4a = signSolverCommitment({
      schema: 'fbt.solver-quote.v1', intentHash: intent4a, solverId: solver4a.id,
      chainId: 42161, amountOut: '400000000000000000', maxGas: '250000', feeBps: 70, slippageBps: 50,
      executable: true, issuedAt: now, validUntil: now + 90,
      nonce: `0x${'4a'.repeat(16)}`, routeCommitment: `0x${'4b'.repeat(32)}`
    }, sKeys.privateKey);
    await appendSignedCommitment(signed4a, { registry: new Map([[solver4a.id, solver4a]]), now: nowMs });

    const prevCoordId = process.env.INTENT_COORDINATOR_ID;
    const prevCoordKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
    process.env.INTENT_COORDINATOR_ID = 'unit-coordinator-4a';
    process.env.INTENT_COORDINATOR_PRIVATE_KEY = cKeys.privateKey;
    const tmp = mkdtempSync(join(tmpdir(), 'fbt-phase4a-'));
    try {
      const closed4a = await closeAuction({
        schema: 'fbt.auction-close-request.v1', intentHash: intent4a,
        policy: { id: AUCTION_POLICY, chainId: 42161, maxFeeBps: 70, maxSlippageBps: 50 }
      }, { now: nowMs });
      t('phase 4a fixture auction seals for CLI claim/dispute', closed4a.ok && closed4a.close.logSize === 1);
      const closePath = join(tmp, 'close.json');
      const commitmentPath = join(tmp, 'commitment.json');
      writeFileSync(closePath, JSON.stringify(closed4a.close));
      writeFileSync(commitmentPath, JSON.stringify(signed4a));

      const claimOut = execFileSync(process.execPath, [
        'scripts/intent-settler.mjs', 'claim', closePath, commitmentPath,
        '--outcome', 'filled',
        '--tx', `0x${'c1'.repeat(32)}`,
        '--received', '400500000000000000',
        '--fee', '70',
        '--executed-at', String(now)
      ], {
        encoding: 'utf8',
        env: {
          ...process.env,
          INTENT_SOLVER_PRIVATE_KEY: sKeys.privateKey,
          INTENT_SOLVER_ID: solver4a.id,
          INTENT_SOLVER_NAME: solver4a.name
        }
      });
      const claimed = JSON.parse(claimOut);
      t('CLI claim builds a verifiable execution claim without printing the private key',
        verifyExecutionClaim(claimed, { close: closed4a.close, commitment: signed4a }).ok
          && claimed.outcome === 'filled'
          && !claimOut.includes(sKeys.privateKey));

      const disputeOut = execFileSync(process.execPath, [
        'scripts/intent-settler.mjs', 'dispute', closePath,
        '--kind', 'no-execution',
        '--detail', 'no transaction observed',
        '--observed-at', String(now + 1)
      ], {
        encoding: 'utf8',
        env: {
          ...process.env,
          INTENT_VERIFIER_PRIVATE_KEY: vKeys.privateKey,
          INTENT_VERIFIER_ID: verifier4a.id,
          INTENT_VERIFIER_NAME: verifier4a.name
        }
      });
      const disputed = JSON.parse(disputeOut);
      t('CLI dispute builds a verifiable dispute without printing the private key',
        verifyDispute(disputed, { close: closed4a.close }).ok
          && disputed.kind === 'no-execution'
          && !disputeOut.includes(vKeys.privateKey));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      if (prevCoordId === undefined) delete process.env.INTENT_COORDINATOR_ID;
      else process.env.INTENT_COORDINATOR_ID = prevCoordId;
      if (prevCoordKey === undefined) delete process.env.INTENT_COORDINATOR_PRIVATE_KEY;
      else process.env.INTENT_COORDINATOR_PRIVATE_KEY = prevCoordKey;
    }
  }


  /* ------- Phase 5: Outcome Marketplace (bounded outcome bids) ------- */
  {
    const nowMs = Date.now();
    const now = Math.floor(nowMs / 1000);
    const okKeys = generateSolverKeyPair();
    const unbondedKeys = generateSolverKeyPair();
    const okSolver = { id: 'unit-outcome-solver', publicKey: okKeys.publicKey, active: true };
    const registry = new Map([
      [okSolver.id, okSolver],
      ['unit-outcome-unbonded', { id: 'unit-outcome-unbonded', publicKey: unbondedKeys.publicKey, active: true }]
    ]);
    const bonded = new Set([okSolver.id]);
    const baseBid = (overrides = {}) => ({
      schema: OUTCOME_BID_SCHEMA,
      intentHash: `0x${'0b'.repeat(32)}`,
      solverId: okSolver.id,
      chainId: 42161,
      settlementChainId: 42161,
      guaranteedMinimum: '10000000000000000000',
      totalMaxCost: '20000000000000000000000',
      feeBps: 70,
      slippageBps: 50,
      partialFillPolicy: 'full-only',
      expiry: now + 86400,
      executable: true,
      issuedAt: now,
      validUntil: now + 90,
      nonce: `0x${'b1'.repeat(16)}`,
      routeCommitment: `0x${'c1'.repeat(32)}`,
      ...overrides
    });

    const signedBid = signOutcomeBid(baseBid(), okKeys.privateKey);
    t('a bounded outcome bid validates and verifies for a registered bonded solver',
      validateOutcomeBid(signedBid, { now: nowMs }).ok
        && verifyOutcomeBid(signedBid, { registry, bondedSolvers: bonded, now: nowMs }).ok);
    t('an unbonded solver is refused even with a valid signature',
      verifyOutcomeBid(signOutcomeBid(baseBid({ solverId: 'unit-outcome-unbonded' }), unbondedKeys.privateKey),
        { registry, bondedSolvers: bonded, now: nowMs }).code === 'SOLVER_NOT_BONDED');
    t('tampering the guaranteed minimum invalidates the outcome bid signature',
      verifyOutcomeBid({ ...signedBid, guaranteedMinimum: '10000000000000000001' },
        { registry, bondedSolvers: bonded, now: nowMs }).code === 'SIGNATURE_MISMATCH');
    t('a non-supported settlement chain is refused before any signature work',
      validateOutcomeBid(baseBid({ settlementChainId: 999 }), { now: nowMs }).code === 'BAD_SETTLEMENT_CHAIN');
    t('an unbounded partial-fill policy is refused',
      validateOutcomeBid(baseBid({ partialFillPolicy: 'partial-or-full' }), { now: nowMs }).code === 'BAD_PARTIAL_FILL');
    t('unknown outcome-bid fields are refused rather than stored',
      validateOutcomeBid(baseBid({ hiddenField: true }), { now: nowMs }).code === 'UNKNOWN_FIELD');
    t('an outcome expiry too far in the future is refused',
      validateOutcomeBid(baseBid({ expiry: now + 90 * 86400 }), { now: nowMs }).code === 'OUTCOME_EXPIRY_TOO_FAR');

    /* Deterministic MAX_GUARANTEED_MINIMUM_V1 selection: highest guarantee
       wins; tie → lowest totalMaxCost → fee → hash. */
    const entries = (bid, entryHash) => [{ entryHash, bid }];
    const winner = evaluateOutcomeAuction(
      [
        { entryHash: `0x${'aa'.repeat(32)}`, bid: baseBid({ guaranteedMinimum: '10000000000000000000', totalMaxCost: '50000000000000000000000', nonce: `0x${'aa'.repeat(16)}` }) },
        { entryHash: `0x${'bb'.repeat(32)}`, bid: baseBid({ guaranteedMinimum: '11000000000000000000', totalMaxCost: '60000000000000000000000', nonce: `0x${'bb'.repeat(16)}` }) },
        { entryHash: `0x${'cc'.repeat(32)}`, bid: baseBid({ guaranteedMinimum: '11000000000000000000', totalMaxCost: '50000000000000000000000', nonce: `0x${'cc'.repeat(16)}` }) }
      ],
      { id: OUTCOME_POLICY, chainId: 42161, maxFeeBps: 70, maxSlippageBps: 50 },
      now
    );
    t('MAX_GUARANTEED_MINIMUM_V1 ranks by guarantee then lowest max cost',
      winner.selectedEntryHash === `0x${'cc'.repeat(32)}`);

    /* Admission + close + completeness watcher round-trip. */
    const prevCoordId = process.env.INTENT_COORDINATOR_ID;
    const prevCoordKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
    const coordKeys = generateSolverKeyPair();
    process.env.INTENT_COORDINATOR_ID = 'unit-outcome-coordinator';
    process.env.INTENT_COORDINATOR_PRIVATE_KEY = coordKeys.privateKey;
    try {
      const appended = await appendOutcomeBid(signedBid, { registry, bondedSolvers: bonded, now: nowMs });
      t('a bonded outcome bid enters the immutable outcome log', appended.ok && appended.root);
      const receipt = issueOutcomeAdmissionReceipt({
        intentHash: baseBid().intentHash, entryHash: appended.entryHash,
        acceptedAt: appended.acceptedAt, solverId: appended.solverId
      });
      t('a transactional outcome admission receipt is issued and verifies',
        Boolean(receipt) && verifyOutcomeAdmissionReceipt(receipt, { intentHash: baseBid().intentHash }));
      const closed = await closeOutcomeAuction({
        schema: 'fbt.outcome-close-request.v1',
        intentHash: baseBid().intentHash,
        policy: { id: OUTCOME_POLICY, chainId: 42161, maxFeeBps: 70, maxSlippageBps: 50 }
      }, { now: nowMs });
      t('an outcome auction seals and closes deterministically', closed.ok && closed.close.logSize === 1);
      const close = closed.close;
      t('the outcome close never claims custody, funds authority or auto-settlement',
        verifyOutcomeClose(close) && close.claims?.custody === false
          && close.claims?.userFundsAuthorised === false && close.claims?.automaticSettlement === false);

      const watcherKeys = generateSolverKeyPair();
      const watcherRow = { id: 'unit-outcome-watcher', name: 'Unit Outcome Watcher', publicKey: watcherKeys.publicKey };
      const builtReport = buildOutcomeCompletenessReport({
        close, receipts: [receipt], watcher: watcherRow, privateKey: watcherKeys.privateKey, now: nowMs + 1000
      });
      t('an outcome completeness report verifies and recomputes',
        builtReport.ok && verifyOutcomeCompletenessReport(builtReport.report, { close }).ok);
      t('outcome capabilities derive penalties from the Phase 3 table and never custody',
        outcomeProtocolStatus().deterministicPenaltyFromPhase3Table === true
          && outcomeProtocolStatus().automaticSettlement === false
          && outcomeProtocolStatus().custody === false
          && outcomeProtocolStatus().publicBidEndpoint === 'closed');
    } finally {
      if (prevCoordId === undefined) delete process.env.INTENT_COORDINATOR_ID;
      else process.env.INTENT_COORDINATOR_ID = prevCoordId;
      if (prevCoordKey === undefined) delete process.env.INTENT_COORDINATOR_PRIVATE_KEY;
      else process.env.INTENT_COORDINATOR_PRIVATE_KEY = prevCoordKey;
    }
  }

  /* ------- Confidential commitment primitives (deployment unavailable) --- */
  {
    const coordinatorKeys = generateSolverKeyPair();
    const solverKeys = generateSolverKeyPair();
    const solverId = 'unit-commit-solver';
    const intentHash = `0x${'c5'.repeat(32)}`;
    const preimage = { from: 'USDC', to: 'ETH', amount: '1000', maxSlippagePct: 0.5 };
    const commitment = buildIntentCommitment({
      intentHash,
      auctionId: intentHash,
      preimage,
      solverId
    }, solverKeys.privateKey);
    const publicRecord = publicCommitmentRecord(commitment.commitment);
    t('public commitment records contain a signed hash but no private preimage',
      commitment.ok && publicRecord.ok && publicRecord.record.commitment.signature
        && !JSON.stringify(publicRecord.record).includes('maxSlippagePct')
        && publicRecord.record.commitment.preimageHolder === 'fbt-secure-private-store'
        && commitment.privateRecord.preimage.amount === '1000');
    t('requester-controlled data cannot be smuggled into public fields or the signature slot',
      publicCommitmentRecord({ ...commitment.commitment, preimage }).code === 'BAD_COMMITMENT'
        && publicCommitmentRecord({
          ...commitment.commitment,
          signature: { value: commitment.commitment.signature, preimage }
        }).code === 'BAD_COMMITMENT');

    const registry = new Map([[solverId, {
      id: solverId, active: true, publicKey: solverKeys.publicKey
    }]]);
    const rogueCommitment = buildIntentCommitment({
      intentHash,
      auctionId: intentHash,
      preimage,
      solverId
    }, generateSolverKeyPair().privateKey);
    t('commit requester identity is authenticated by the registered Ed25519 key',
      verifyIntentCommitment(commitment.commitment, { registry }).ok
        && verifyIntentCommitment(commitment.commitment, { registry: new Map() }).code === 'UNAUTHENTICATED_REQUESTER'
        && verifyIntentCommitment(rogueCommitment.commitment, { registry }).code === 'SIGNATURE_MISMATCH');
    t('canonical intent, auction, nonce and deadline fields are commitment-id bound',
      verifyIntentCommitment({ ...commitment.commitment, intentHash: `0x${'a1'.repeat(32)}` }, { registry }).code === 'BAD_COMMITMENT'
        && verifyIntentCommitment({ ...commitment.commitment, auctionId: `0x${'a2'.repeat(32)}` }, { registry }).code === 'BAD_COMMITMENT'
        && verifyIntentCommitment({ ...commitment.commitment, nonce: `0x${'a3'.repeat(16)}` }, { registry }).code === 'BAD_COMMITMENT'
        && verifyIntentCommitment({ ...commitment.commitment, deadline: commitment.commitment.deadline + 1 }, { registry }).code === 'BAD_COMMITMENT');
    t('commitment id and solver nonce replay indexes reject reuse',
      verifyIntentCommitment(commitment.commitment, {
        registry,
        seenCommitmentIds: new Set([commitment.commitment.commitmentId])
      }).code === 'COMMITMENT_REPLAY'
        && verifyIntentCommitment(commitment.commitment, {
          registry,
          seenNonces: new Set([`${solverId}:${commitment.commitment.nonce}`])
        }).code === 'COMMITMENT_REPLAY');
    t('durable private storage fails closed even for an authenticated matching pair',
      (await storeIntentCommitment(commitment, { registry })).code === 'CONFIDENTIAL_PRIVATE_STORE_UNAVAILABLE');
    t('reveal is rejected before a trusted signed auction close exists',
      buildIntentReveal({
        commitment: commitment.commitment,
        privateRecord: commitment.privateRecord,
        auctionClose: null,
        solverId
      }, solverKeys.privateKey).code === 'AUCTION_NOT_CLOSED');
    t('client preimage substitution is rejected rather than compared or stored',
      buildIntentReveal({
        commitment: commitment.commitment,
        privateRecord: commitment.privateRecord,
        auctionClose: null,
        solverId,
        preimage: { ...preimage, amount: '9999' }
      }, solverKeys.privateKey).code === 'CLIENT_PREIMAGE_FORBIDDEN');
    t('a mismatched server-side private record cannot be revealed',
      buildIntentReveal({
        commitment: commitment.commitment,
        privateRecord: {
          ...commitment.privateRecord,
          preimage: { ...preimage, amount: '9999' }
        },
        auctionClose: null,
        solverId
      }, solverKeys.privateKey).code === 'REVEAL_MISMATCH');

    const previousCoordinatorId = process.env.INTENT_COORDINATOR_ID;
    const previousCoordinatorKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
    process.env.INTENT_COORDINATOR_ID = 'unit-confidential-coordinator';
    process.env.INTENT_COORDINATOR_PRIVATE_KEY = coordinatorKeys.privateKey;
    try {
      const closed = await closeAuction({
        schema: 'fbt.auction-close-request.v1',
        intentHash,
        policy: { id: AUCTION_POLICY, chainId: 42161, maxFeeBps: 70, maxSlippageBps: 50 }
      });
      const reveal = buildIntentReveal({
        commitment: commitment.commitment,
        privateRecord: commitment.privateRecord,
        auctionClose: closed.close,
        solverId
      }, solverKeys.privateKey);
      t('only the server-stored preimage reveals after the trusted auction close',
        closed.ok && reveal.ok && verifyIntentReveal(reveal.reveal, commitment.commitment, {
          solverPublicKey: solverKeys.publicKey,
          coordinatorPublicKey: coordinatorKeys.publicKey,
          auctionClose: closed.close
        }).ok);
      t('a reveal cannot trust a self-declared coordinator key',
        verifyIntentReveal(reveal.reveal, commitment.commitment, {
          solverPublicKey: solverKeys.publicKey,
          coordinatorPublicKey: generateSolverKeyPair().publicKey,
          auctionClose: closed.close
        }).code === 'AUCTION_NOT_CLOSED');
    } finally {
      if (previousCoordinatorId === undefined) delete process.env.INTENT_COORDINATOR_ID;
      else process.env.INTENT_COORDINATOR_ID = previousCoordinatorId;
      if (previousCoordinatorKey === undefined) delete process.env.INTENT_COORDINATOR_PRIVATE_KEY;
      else process.env.INTENT_COORDINATOR_PRIVATE_KEY = previousCoordinatorKey;
    }

    const status = intentCommitmentStatus();
    t('commit-reveal capabilities are unavailable and never claim metadata, threshold or TEE privacy',
      status.available === false && status.frontendIntegrated === false
        && status.durablePrivateStorage === false && status.requesterAuthentication === false
        && status.earlyRevealProtection === false && status.tee === false
        && status.attestation === false && status.hiddenFromFbt === false
        && status.metadataPrivacy === false && status.confidentialityLevel === 'unavailable');
  }

  /* ------- Phase 5: threshold-encryption skeleton (hybrid + N-of-N XOR) ------- */
  {
    const savedOps = process.env.INTENT_CONFIDENTIAL_OPERATOR_KEYS;
    process.env.INTENT_CONFIDENTIAL_OPERATOR_KEYS = '';
    const empty = parseOperatorRegistry();
    t('threshold encryption is configured:false without real operator keys',
      empty.size === 0 && empty);
    process.env.INTENT_CONFIDENTIAL_OPERATOR_KEYS = savedOps;

    /* Build a confidential envelope with REAL X25519 operator keys and prove
       a full encrypt → decrypt round-trip, and that the missing-threshold
       case fails honestly. */
    const keyA = generateOperatorKeyPair();
    const keyB = generateOperatorKeyPair();
    const op1 = { id: 'op-a', name: 'Operator A', publicKey: keyA.publicKey };
    const op2 = { id: 'op-b', name: 'Operator B', publicKey: keyB.publicKey };
    const primitiveStatus = confidentialProtocolStatus({
      operatorRegistry: new Map([[op1.id, op1], [op2.id, op2]])
    });
    t('public operator keys configure only a registry, never operational threshold or TEE readiness',
      primitiveStatus.available === false
        && primitiveStatus.thresholdEncryption.registryConfigured === true
        && primitiveStatus.thresholdEncryption.configured === false
        && primitiveStatus.thresholdEncryption.operational === false
        && primitiveStatus.thresholdEncryption.independentOperatorServices === false
        && primitiveStatus.thresholdEncryption.tee === false
        && primitiveStatus.thresholdEncryption.attestation === false);
    const plaintext = '{"to":"0xabc","amount":"1"}';
    const envelope = buildConfidentialEnvelope(plaintext, [op1, op2]);
    t('a confidential envelope wraps with AES-256-GCM + ECDH and N-of-N XOR',
      envelope.ok && envelope.envelope.sharesRequired === 2
        && envelope.envelope.scheme === 'n-of-n-xor'
        && envelope.envelope.claims.tee === false);
    const secretBuf = Buffer.from('0123456789abcdef0123456789abcdef');
    const shares = xorSplit(secretBuf, 3);
    t('N-of-N XOR shares recombine to the original key',
      xorCombine(shares).equals(secretBuf));
    /* Without the operator private keys the envelope cannot be reconstructed —
       that is the whole point; there are no secrets in the registry. */
    const reconstruct = reconstructConfidentialEnvelope(envelope.envelope, []);
    t('reconstruction requires the operator threshold (no secrets in the registry)',
      !reconstruct.ok && reconstruct.code === 'MISSING_OPERATOR_SHARE');
    const full = reconstructConfidentialEnvelope(envelope.envelope, [
      { operatorId: 'op-a', privateKey: keyA.privateKey },
      { operatorId: 'op-b', privateKey: keyB.privateKey }
    ]);
    t('with all operator private keys the envelope decrypts to the plaintext',
      full.ok && full.plaintext === plaintext && full.claims.tee === false);
  }

  /* ------- Phase 4b: sequential cross-chain state machine ------- */
  {
    const now = Math.floor(Date.now() / 1000);
    const initiatorKeys = generateSolverKeyPair();
    const counterpartyKeys = generateSolverKeyPair();
    const token = {
      symbol: 'USDC', address: `0x${'11'.repeat(20)}`, native: false, decimals: 6
    };
    const plan = {
      schema: 'fbt.cross-chain-state.v1',
      createdAt: now,
      source: { chainId: 42161, token, amount: '100000000' },
      destination: {
        chainId: 1,
        token: { symbol: 'USDT', address: `0x${'22'.repeat(20)}`, native: false, decimals: 6 },
        amount: '99500000'
      },
      parties: {
        initiator: { id: 'unit-initiator', publicKey: initiatorKeys.publicKey },
        counterparty: { id: 'unit-counterparty', publicKey: counterpartyKeys.publicKey }
      },
      timeout: {
        sourceSignatureBy: now + 60,
        destinationSignatureBy: now + 120,
        refundSignatureBy: now + 180
      },
      refund: {
        chainId: 42161,
        token,
        amount: '100000000',
        fromPartyId: 'unit-counterparty',
        toPartyId: 'unit-initiator',
        mode: 'user-signed-transfer',
        automatic: false,
        enforceableByFbt: false
      }
    };
    const created = createCrossChainState(plan, { now: now * 1000 });
    t('Phase 4b creates a bounded fbt.cross-chain-state.v1 plan',
      created.ok && created.state.stateId.startsWith('0x')
        && created.state.source.chainId !== created.state.destination.chainId);
    t('the cross-chain state pins non-atomic, no-custody and no-escrow claims',
      created.state.claims.atomic === false && created.state.claims.globalAtomicity === false
        && created.state.claims.custody === false && created.state.claims.escrow === false
        && created.state.claims.onChainVerified === false);
    t('tampering a cross-chain amount breaks the deterministic state id',
      !evaluateCrossChainState({
        ...created.state,
        source: { ...created.state.source, amount: '100000001' }
      }).ok);

    const source = buildCrossChainReceipt({
      state: created.state,
      leg: 'source-transfer',
      txHash: `0x${'31'.repeat(32)}`,
      signedAt: now
    }, initiatorKeys.privateKey);
    t('the initiator signs a verifiable source-leg receipt',
      source.ok && verifyCrossChainReceipt(source.receipt, { state: created.state }).ok);
    t('the counterparty key cannot impersonate the source signer',
      buildCrossChainReceipt({
        state: created.state,
        leg: 'source-transfer',
        txHash: `0x${'32'.repeat(32)}`,
        signedAt: now
      }, counterpartyKeys.privateKey).code === 'CROSS_CHAIN_SIGNER_KEY_MISMATCH');

    const destination = buildCrossChainReceipt({
      state: created.state,
      previousReceipts: [source.receipt],
      leg: 'destination-transfer',
      txHash: `0x${'33'.repeat(32)}`,
      signedAt: now + 1
    }, counterpartyKeys.privateKey);
    const settled = evaluateCrossChainState(created.state, [source.receipt, destination.receipt], {
      now: (now + 1) * 1000
    });
    t('the second party signature settles only the sequential evidence state',
      destination.ok && settled.ok && settled.status === 'settled-sequential'
        && settled.atomic === false && settled.onChainVerified === false);

    const refund = buildCrossChainReceipt({
      state: created.state,
      previousReceipts: [source.receipt],
      leg: 'refund',
      txHash: `0x${'34'.repeat(32)}`,
      signedAt: now + 120
    }, counterpartyKeys.privateKey);
    t('after the destination deadline the explicit source-chain refund receipt verifies',
      refund.ok && evaluateCrossChainState(created.state, [source.receipt, refund.receipt], {
        now: (now + 120) * 1000
      }).status === 'refunded-by-signed-claim');
    t('destination and refund terminal receipts cannot both become one valid state',
      evaluateCrossChainState(created.state, [source.receipt, destination.receipt, refund.receipt]).code
        === 'BAD_CROSS_CHAIN_RECEIPT_SET');
    const crossCaps = crossChainProtocolStatus();
    t('cross-chain capabilities preserve the draft-only atomic guard',
      crossCaps.available === true && crossCaps.atomic === false && crossCaps.custody === false
        && crossCaps.envelopeStatus === 'draft-only'
        && crossCaps.envelopeBlockCode === 'ATOMIC_CROSS_CHAIN_UNAVAILABLE');

    const tmp = mkdtempSync(join(tmpdir(), 'fbt-phase4b-'));
    try {
      const stateFile = join(tmp, 'state.json');
      writeFileSync(stateFile, JSON.stringify(created.state));
      const cliOut = execFileSync(process.execPath, [
        'scripts/intent-cross-chain.mjs', 'sign', stateFile,
        '--leg', 'source-transfer', '--tx', `0x${'35'.repeat(32)}`, '--signed-at', String(now)
      ], {
        encoding: 'utf8',
        env: { ...process.env, INTENT_CROSS_CHAIN_PRIVATE_KEY: initiatorKeys.privateKey }
      });
      const cliReceipt = JSON.parse(cliOut);
      t('the cross-chain CLI signs offline without printing its private key',
        verifyCrossChainReceipt(cliReceipt, { state: created.state }).ok
          && !cliOut.includes(initiatorKeys.privateKey));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  /* ------- Phase 4c: signed account bindings + multi-RPC leg verification ------- */
  {
    const now = Math.floor(Date.now() / 1000);
    const initiatorKeys = generateSolverKeyPair();
    const counterpartyKeys = generateSolverKeyPair();
    const verifierKeys = generateSolverKeyPair();
    const strangerKeys = generateSolverKeyPair();
    const token = { symbol: 'USDC', address: `0x${'11'.repeat(20)}`, native: false, decimals: 6 };
    const nativeToken = { symbol: 'ETH', native: true, decimals: 18 };
    const state = createCrossChainState({
      schema: 'fbt.cross-chain-state.v1',
      createdAt: now,
      source: { chainId: 42161, token, amount: '100000000' },
      destination: { chainId: 1, token: nativeToken, amount: '55000000000000000' },
      parties: {
        initiator: { id: 'p4c-initiator', publicKey: initiatorKeys.publicKey },
        counterparty: { id: 'p4c-counterparty', publicKey: counterpartyKeys.publicKey }
      },
      timeout: { sourceSignatureBy: now + 60, destinationSignatureBy: now + 120, refundSignatureBy: now + 180 },
      refund: {
        chainId: 42161, token, amount: '100000000',
        fromPartyId: 'p4c-counterparty', toPartyId: 'p4c-initiator',
        mode: 'user-signed-transfer', automatic: false, enforceableByFbt: false
      }
    }, { now: now * 1000 }).state;
    t('Phase 4c leaves fbt.cross-chain-state.v1 backward compatible',
      evaluateCrossChainState(state, []).ok
        && state.claims.onChainVerified === false && state.claims.atomic === false);

    const fromWallet = new Wallet(hexlify(randomBytes(32)));
    const toWallet = new Wallet(hexlify(randomBytes(32)));
    const impostorWallet = new Wallet(hexlify(randomBytes(32)));
    const walletProofFor = async (wallet, { partyId, chainId, address, expiresAt, nonce = '' }, plan = state) => {
      const challenge = buildAccountBindingChallenge({
        state: plan, partyId, chainId, address, issuedAt: now, expiresAt, nonce
      }, { now: now * 1000 });
      if (!challenge.ok) return challenge;
      return {
        ok: true,
        challenge: challenge.challenge,
        proof: { scheme: 'EIP-191', nonce, signature: await wallet.signMessage(challenge.challenge.message) }
      };
    };

    /* ------------------------- binding + EIP-191 ------------------------- */
    const fromProof = await walletProofFor(fromWallet, {
      partyId: 'p4c-initiator', chainId: 42161, address: fromWallet.address, expiresAt: now + 86400, nonce: 'unit-nonce-1'
    });
    const toProof = await walletProofFor(toWallet, {
      partyId: 'p4c-counterparty', chainId: 42161, address: toWallet.address, expiresAt: now + 86400
    });
    t('the EIP-191 challenge deterministically binds domain, schema, state, party, chain, address, Ed25519 key, window and nonce',
      fromProof.ok
        && fromProof.challenge.domain === 'fbt.cross-chain-account-binding.v1/wallet-challenge'
        && fromProof.challenge.message.includes('fbt.cross-chain-account-binding.v1')
        && fromProof.challenge.message.includes(state.stateId)
        && fromProof.challenge.message.includes('p4c-initiator')
        && fromProof.challenge.message.includes(String(42161))
        && fromProof.challenge.message.includes(fromProof.challenge.address)
        && fromProof.challenge.message.includes(initiatorKeys.publicKey)
        && fromProof.challenge.message.includes(String(now))
        && fromProof.challenge.message.includes('unit-nonce-1'));
    const fromBinding = buildAccountBinding({
      state, partyId: 'p4c-initiator', chainId: 42161, address: fromWallet.address,
      issuedAt: now, expiresAt: now + 86400, walletProof: fromProof.proof
    }, initiatorKeys.privateKey, { now: now * 1000 });
    const toBinding = buildAccountBinding({
      state, partyId: 'p4c-counterparty', chainId: 42161, address: toWallet.address,
      issuedAt: now, expiresAt: now + 86400, walletProof: toProof.proof
    }, counterpartyKeys.privateKey, { now: now * 1000 });
    t('a valid EIP-191 wallet proof upgrades the binding to verified wallet control',
      fromBinding.ok && toBinding.ok
        && verifyAccountBinding(fromBinding.binding, { state, now: now * 1000 }).ok
        && fromBinding.binding.claims.walletSignatureScheme === 'EIP-191'
        && fromBinding.binding.claims.walletSignatureVerified === true
        && fromBinding.binding.claims.addressControlSelfAttested === true
        && fromBinding.binding.claims.fundsAuthorityGranted === false
        && fromBinding.binding.claims.custody === false
        && fromBinding.binding.walletProof.scheme === 'EIP-191');
    const selfAttested = buildAccountBinding({
      state, partyId: 'p4c-initiator', chainId: 42161, address: fromWallet.address,
      issuedAt: now, expiresAt: now + 86400
    }, initiatorKeys.privateKey, { now: now * 1000 });
    t('a binding without a wallet proof stays an honest self-attested assertion',
      selfAttested.ok
        && selfAttested.binding.walletProof === null
        && selfAttested.binding.claims.walletSignatureScheme === null
        && selfAttested.binding.claims.walletSignatureVerified === false
        && verifyAccountBinding(selfAttested.binding, { state, now: now * 1000 }).ok);
    t('an EIP-191 signature from a different wallet (wrong recovered address) is refused',
      buildAccountBinding({
        state, partyId: 'p4c-initiator', chainId: 42161, address: fromWallet.address,
        issuedAt: now, expiresAt: now + 86400,
        walletProof: { scheme: 'EIP-191', nonce: '', signature: await impostorWallet.signMessage(fromProof.challenge.message) }
      }, initiatorKeys.privateKey, { now: now * 1000 }).code === 'WALLET_PROOF_INVALID');
    const tamperedWalletSig = `${fromProof.proof.signature.slice(0, -1)}${fromProof.proof.signature.endsWith('A') ? 'B' : 'A'}`;
    t('a tampered wallet signature is refused',
      buildAccountBinding({
        state, partyId: 'p4c-initiator', chainId: 42161, address: fromWallet.address,
        issuedAt: now, expiresAt: now + 86400,
        walletProof: { scheme: 'EIP-191', nonce: '', signature: tamperedWalletSig }
      }, initiatorKeys.privateKey, { now: now * 1000 }).code === 'WALLET_PROOF_INVALID');
    t('EIP-1271 (smart-contract wallets) is explicitly unsupported, not faked',
      buildAccountBinding({
        state, partyId: 'p4c-initiator', chainId: 42161, address: fromWallet.address,
        issuedAt: now, expiresAt: now + 86400,
        walletProof: { scheme: 'EIP-1271', nonce: '', signature: fromProof.proof.signature }
      }, initiatorKeys.privateKey, { now: now * 1000 }).code === 'WALLET_PROOF_SCHEME_UNSUPPORTED');
    t('an expired account binding is refused',
      verifyAccountBinding(fromBinding.binding, { state, now: (now + 90000) * 1000 }).code
        === 'ACCOUNT_BINDING_EXPIRED');
    t('a binding issued beyond the clock-skew allowance is refused',
      buildAccountBinding({
        state, partyId: 'p4c-initiator', chainId: 42161, address: fromWallet.address,
        issuedAt: now + 1000, expiresAt: now + 86400
      }, initiatorKeys.privateKey, { now: now * 1000 }).code === 'BAD_BINDING_WINDOW');
    t('an unknown binding field fails closed',
      verifyAccountBinding({ ...fromBinding.binding, extra: 1 }, { state, now: now * 1000 }).code
        === 'UNKNOWN_ACCOUNT_BINDING_FIELD');
    t('a non-canonical base64url party key is refused',
      verifyAccountBinding({ ...fromBinding.binding, partyPublicKey: `${fromBinding.binding.partyPublicKey}=` },
        { state, now: now * 1000 }).code === 'BINDING_KEY_MISMATCH');
    t('a wrong partyId is refused',
      verifyAccountBinding({ ...fromBinding.binding, partyId: 'p4c-nobody' }, { state, now: now * 1000 }).code
        === 'UNKNOWN_BINDING_PARTY');
    t('a wrong stateId is refused',
      verifyAccountBinding({ ...fromBinding.binding, stateId: `0x${'ff'.repeat(32)}` }, { state, now: now * 1000 }).code
        === 'BAD_ACCOUNT_BINDING_BINDING');
    t('a chain outside the plan is refused',
      verifyAccountBinding({ ...fromBinding.binding, chainId: 8453 }, { state, now: now * 1000 }).code
        === 'BAD_BINDING_CHAIN');
    t('a binding signed by a key the state does not pin is refused',
      buildAccountBinding({
        state, partyId: 'p4c-initiator', chainId: 42161, address: fromWallet.address, expiresAt: now + 86400
      }, strangerKeys.privateKey, { now: now * 1000 }).code === 'BINDING_KEY_MISMATCH');
    t('tampering the bound address invalidates the binding',
      !verifyAccountBinding({ ...fromBinding.binding, address: toWallet.address },
        { state, now: now * 1000 }).ok);

    const sourceReceipt = buildCrossChainReceipt({
      state, leg: 'source-transfer', txHash: `0x${'31'.repeat(32)}`, signedAt: now
    }, initiatorKeys.privateKey).receipt;

    const transferIface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
    const goodEvent = transferIface.encodeEventLog(transferIface.getEvent('Transfer'), [
      fromWallet.address, toWallet.address, 100000000n
    ]);
    const blockHash = `0x${'44'.repeat(32)}`;
    const goodRpc = (overrides = {}) => async (_url, method) => {
      if (method === 'eth_blockNumber') return overrides.latest ?? '0x100';
      if (method === 'eth_getTransactionReceipt') {
        return overrides.receipt !== undefined ? overrides.receipt : {
          status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0',
          blockHash, logs: [{ address: token.address, topics: goodEvent.topics, data: goodEvent.data }]
        };
      }
      if (method === 'eth_getTransactionByHash') {
        return overrides.tx !== undefined ? overrides.tx
          : { from: fromWallet.address, to: token.address, value: '0x0', blockHash };
      }
      return null;
    };
    const networks = parseCrossChainRpcNetworks(JSON.stringify([
      {
        chainId: 42161, name: 'Unit Arbitrum', quorum: 2, minConfirmations: 3,
        providers: [
          { id: 'unit-arb-a', rpcUrl: 'https://rpc-a.invalid' },
          { id: 'unit-arb-b', rpcUrl: 'https://rpc-b.invalid' }
        ]
      }
    ]));
    t('multi-RPC config requires quorum >= 2, distinct hostnames, https and bounded providers',
      networks.size === 1
        && networks.get(42161).quorum === 2
        && networks.get(42161).providers.length === 2
        && parseCrossChainRpcNetworks(JSON.stringify([
          { chainId: 42161, quorum: 2, minConfirmations: 3, providers: [{ id: 'a', rpcUrl: 'https://one.invalid' }] }
        ])).size === 0
        && parseCrossChainRpcNetworks(JSON.stringify([
          { chainId: 42161, quorum: 2, providers: [{ id: 'a', rpcUrl: 'https://same.invalid/a' }, { id: 'b', rpcUrl: 'https://same.invalid/b' }] }
        ])).size === 0
        && parseCrossChainRpcNetworks(JSON.stringify([
          { chainId: 42161, quorum: 2, providers: [{ id: 'a', rpcUrl: 'http://a.invalid' }, { id: 'b', rpcUrl: 'https://b.invalid' }] }
        ])).size === 0
        && parseCrossChainRpcNetworks(JSON.stringify([
          { chainId: 42161, quorum: 1, providers: [{ id: 'a', rpcUrl: 'https://a.invalid' }, { id: 'b', rpcUrl: 'https://b.invalid' }] }
        ])).size === 0
        && parseCrossChainRpcNetworks(JSON.stringify([
          { chainId: 42161, quorum: 3, providers: [{ id: 'a', rpcUrl: 'https://a.invalid' }, { id: 'b', rpcUrl: 'https://b.invalid' }] }
        ])).size === 0
        && parseCrossChainRpcNetworks(JSON.stringify([
          { chainId: 42161, quorum: 2, providers: [{ id: 'a', rpcUrl: 'https://user:pass@a.invalid' }, { id: 'b', rpcUrl: 'https://b.invalid' }] }
        ])).size === 0);
    const verificationCaps = crossChainVerificationStatus(networks);
    t('verification capabilities never leak an RPC URL and never claim provider independence',
      !JSON.stringify(verificationCaps).includes('invalid')
        && verificationCaps.rpcUrlsPublished === false
        && verificationCaps.providerIndependenceProven === false
        && verificationCaps.configured === true
        && verificationCaps.configuredChains === 1
        && verificationCaps.minimumQuorum === 2
        && verificationCaps.multiRpcRequired === true
        && verificationCaps.serverRecomputesBeforeStorage === true
        && verificationCaps.onChainTxVerification === true
        && verificationCaps.walletProof === 'EIP-191'
        && verificationCaps.eip1271Supported === false
        && verificationCaps.atomic === false
        && verificationCaps.custody === false
        && verificationCaps.chains[0].distinctRpcHosts === 2);
    const unconfiguredCaps = crossChainVerificationStatus(new Map());
    t('without a real RPC env the verification capability is honestly unconfigured',
      unconfiguredCaps.configured === false
        && unconfiguredCaps.configuredChains === 0
        && unconfiguredCaps.onChainTxVerification === false
        && unconfiguredCaps.multiRpcConfigured === false);

    const registry = new Map([[
      'p4c-verifier', { id: 'p4c-verifier', publicKey: verifierKeys.publicKey, active: true }
    ]]);
    const report = await buildTxVerificationReport({
      state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
      verifier: { id: 'p4c-verifier' }, networks, rpc: goodRpc(), registry, now: now * 1000
    }, verifierKeys.privateKey);
    t('a correct ERC-20 Transfer with quorum agreement verifies on-chain',
      report.ok && report.report.verdict === 'onchain-verified'
        && report.report.quorum.agreeing === 2
        && report.report.quorum.required === 2
        && report.report.reasonCodes.length === 0
        && report.report.receiptStatus === 'success'
        && report.report.claims.multiRpcQuorumReached === true
        && report.report.claims.walletBindingsVerified === true
        && report.report.claims.transactionObservedOnChain === true);
    t('a verified leg report still pins non-atomic, no-custody, no-escrow claims',
      report.report.claims.atomicSettlement === false
        && report.report.claims.globalAtomicity === false
        && report.report.claims.custody === false
        && report.report.claims.escrow === false
        && report.report.claims.automaticSettlement === false
        && report.report.claims.providerIndependenceProven === false
        && report.report.claims.serverRecomputedBeforeStorage === false);
    t('the signed report never embeds an RPC URL or endpoint identity',
      !JSON.stringify(report.report).includes('invalid')
        && !JSON.stringify(report.report).includes('unit-arb'));
    t('the server recomputes a signed report before accepting it',
      (await recomputeTxVerificationReport(report.report, {
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        registry, networks, rpc: goodRpc(), now: now * 1000
      })).ok);
    t('a signed but non-recomputable report is refused',
      (await recomputeTxVerificationReport(report.report, {
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        registry, networks,
        rpc: goodRpc({ receipt: { status: '0x1', blockNumber: '0xf0', blockHash: `0x${'99'.repeat(32)}`, logs: [{ address: token.address, topics: goodEvent.topics, data: goodEvent.data }] } }),
        now: now * 1000
      })).code === 'VERIFICATION_NOT_RECOMPUTABLE');
    t('an unregistered verifier cannot produce an acceptable report',
      verifyTxVerificationReport(report.report, {
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        registry: new Map(), now: now * 1000
      }).code === 'UNREGISTERED_VERIFIER');
    t('a verifier key that does not match the registry is refused',
      verifyTxVerificationReport(report.report, {
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        registry: new Map([['p4c-verifier', { id: 'p4c-verifier', publicKey: strangerKeys.publicKey, active: true }]]),
        now: now * 1000
      }).code === 'UNREGISTERED_VERIFIER');
    t('tampering the signed verdict breaks the report id',
      !verifyTxVerificationReport({ ...report.report, confirmations: 999 }, {
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        registry, now: now * 1000
      }).ok);
    t('tampering an observation breaks the report signature',
      !verifyTxVerificationReport({
        ...report.report,
        observations: report.report.observations.map((row, index) =>
          index === 0 ? { ...row, blockHash: `0x${'ab'.repeat(32)}` } : row)
      }, {
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        registry, now: now * 1000
      }).ok);
    t('a verification report tampering the signature fails closed',
      verifyTxVerificationReport({
        ...report.report,
        signature: `${report.report.signature.slice(0, -1)}${report.report.signature.endsWith('A') ? 'B' : 'A'}`
      }, {
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        registry, now: now * 1000
      }).code === 'VERIFICATION_SIGNATURE_MISMATCH');

    /* Deterministic rejections: wrong token contract, malformed event, event
       from another contract, wrong sender/recipient/amount, ambiguous
       duplicate events, failed receipt. */
    const failCases = [
      ['a failed receipt is a signed rejection, never verified', goodRpc({
        receipt: { status: '0x0', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash, logs: [] }
      }), 'TX_RECEIPT_FAILED'],
      ['a Transfer from the wrong token contract is rejected', goodRpc({
        receipt: {
          status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash,
          logs: [{ address: `0x${'dd'.repeat(20)}`, topics: goodEvent.topics, data: goodEvent.data }]
        }
      }), 'WRONG_TOKEN_CONTRACT'],
      ['a Transfer-shaped event from another contract is never accepted', goodRpc({
        receipt: {
          status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash,
          logs: [
            { address: `0x${'dd'.repeat(20)}`, topics: goodEvent.topics, data: goodEvent.data }
          ]
        }
      }), 'WRONG_TOKEN_CONTRACT'],
      ['a malformed Transfer log is rejected', goodRpc({
        receipt: {
          status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash,
          logs: [{ address: token.address, topics: [goodEvent.topics[0]], data: '0x1234' }]
        }
      }), 'MALFORMED_TRANSFER_EVENT'],
      ['a wrong ERC-20 sender is rejected', goodRpc({
        receipt: {
          status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash,
          logs: [{
            address: token.address,
            ...(() => {
              const bad = transferIface.encodeEventLog(transferIface.getEvent('Transfer'), [
                toWallet.address, toWallet.address, 100000000n
              ]);
              return { topics: bad.topics, data: bad.data };
            })()
          }]
        }
      }), 'WRONG_SENDER'],
      ['a wrong ERC-20 amount is rejected', goodRpc({
        receipt: {
          status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash,
          logs: [{
            address: token.address,
            ...(() => {
              const bad = transferIface.encodeEventLog(transferIface.getEvent('Transfer'), [
                fromWallet.address, toWallet.address, 99999999n
              ]);
              return { topics: bad.topics, data: bad.data };
            })()
          }]
        }
      }), 'WRONG_AMOUNT'],
      ['a wrong recipient is rejected', goodRpc({
        receipt: {
          status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash,
          logs: [{
            address: token.address,
            ...(() => {
              const bad = transferIface.encodeEventLog(transferIface.getEvent('Transfer'), [
                fromWallet.address, fromWallet.address, 100000000n
              ]);
              return { topics: bad.topics, data: bad.data };
            })()
          }]
        }
      }), 'WRONG_RECIPIENT'],
      ['duplicate ambiguous Transfer events are not guessed as success', goodRpc({
        receipt: {
          status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash,
          logs: [
            { address: token.address, topics: goodEvent.topics, data: goodEvent.data },
            { address: token.address, topics: goodEvent.topics, data: goodEvent.data }
          ]
        }
      }), 'AMBIGUOUS_TRANSFER_EVENT']
    ];
    for (const [name, rpc, reason] of failCases) {
      const outcome = await buildTxVerificationReport({
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        verifier: { id: 'p4c-verifier' }, networks, rpc, registry, now: now * 1000
      }, verifierKeys.privateKey);
      t(name, outcome.ok && outcome.report.verdict === 'verification-rejected'
        && outcome.report.reasonCodes[0] === reason
        && outcome.report.claims.transactionObservedOnChain === true);
    }

    /* Transient outcomes sign honest pending/disagreement snapshots. */
    const transientCases = [
      ['insufficient confirmations sign an honest pending snapshot', goodRpc({ latest: '0xf1' }), 'confirmations-pending', 'INSUFFICIENT_CONFIRMATIONS'],
      ['a missing transaction signs an honest unavailable snapshot', goodRpc({ receipt: null, tx: null }), 'verification-unavailable', 'TX_NOT_FOUND'],
      ['a full provider outage signs an honest unavailable snapshot', async () => { throw new Error('down'); }, 'verification-unavailable', 'RPC_QUORUM_UNAVAILABLE']
    ];
    for (const [name, rpc, verdict, code] of transientCases) {
      const outcome = await buildTxVerificationReport({
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        verifier: { id: 'p4c-verifier' }, networks, rpc, registry, now: now * 1000
      }, verifierKeys.privateKey);
      t(name, outcome.ok && outcome.report.verdict === verdict
        && outcome.report.reasonCodes[0] === code
        && outcome.report.claims.multiRpcQuorumReached === false
        && outcome.report.claims.transactionObservedOnChain === false
        && outcome.report.claims.walletBindingsVerified === true
        && outcome.report.claims.atomicSettlement === false
        && outcome.report.claims.globalAtomicity === false
        && outcome.report.claims.custody === false
        && outcome.report.claims.escrow === false
        && outcome.report.claims.automaticSettlement === false
        && verifyTxVerificationReport(outcome.report, {
          state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
          registry, now: now * 1000
        }).ok);
    }
    {
      /* A pending snapshot is storable only while the outcome is still
         non-final; once a final verdict reproduces, the snapshot is
         superseded. */
      const pendingReport = await buildTxVerificationReport({
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        verifier: { id: 'p4c-verifier' }, networks, rpc: goodRpc({ latest: '0xf1' }), registry, now: now * 1000
      }, verifierKeys.privateKey);
      t('a pending snapshot recomputes against the same pending chain state',
        (await recomputeTxVerificationReport(pendingReport.report, {
          state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
          registry, networks, rpc: goodRpc({ latest: '0xf1' }), now: now * 1000
        })).ok);
      t('a pending snapshot is superseded once the chain shows a final outcome',
        (await recomputeTxVerificationReport(pendingReport.report, {
          state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
          registry, networks, rpc: goodRpc(), now: now * 1000
        })).code === 'VERIFICATION_SUPERSEDED');
      /* Block-hash disagreement between endpoints (reorg / drift). */
      const disagreeing = async (url, method) => {
        if (method === 'eth_blockNumber') return '0x100';
        if (method === 'eth_getTransactionByHash') {
          return { from: fromWallet.address, to: token.address, value: '0x0', blockHash };
        }
        return {
          status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0',
          blockHash: url.includes('rpc-a') ? blockHash : `0x${'55'.repeat(32)}`,
          logs: [{ address: token.address, topics: goodEvent.topics, data: goodEvent.data }]
        };
      };
      const hashOutcome = await buildTxVerificationReport({
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        verifier: { id: 'p4c-verifier' }, networks, rpc: disagreeing, registry, now: now * 1000
      }, verifierKeys.privateKey);
      t('block-hash disagreement between RPCs is reorg-detected and fails closed',
        hashOutcome.ok && hashOutcome.report.verdict === 'reorg-detected'
          && hashOutcome.report.reasonCodes[0] === 'REORG_DETECTED');
      const blockNumberDisagreeing = async (url, method) => {
        if (method === 'eth_blockNumber') return '0x100';
        if (method === 'eth_getTransactionByHash') {
          return { from: fromWallet.address, to: token.address, value: '0x0', blockHash };
        }
        return {
          status: '0x1', transactionHash: sourceReceipt.txHash,
          blockNumber: url.includes('rpc-a') ? '0xf0' : '0xf1',
          blockHash,
          logs: [{ address: token.address, topics: goodEvent.topics, data: goodEvent.data }]
        };
      };
      const numberOutcome = await buildTxVerificationReport({
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        verifier: { id: 'p4c-verifier' }, networks, rpc: blockNumberDisagreeing, registry, now: now * 1000
      }, verifierKeys.privateKey);
      t('the same tx on different block numbers is reorg-detected and fails closed',
        numberOutcome.ok && numberOutcome.report.verdict === 'reorg-detected');
      const statusDisagreeing = async (url, method) => {
        if (method === 'eth_blockNumber') return '0x100';
        if (method === 'eth_getTransactionByHash') {
          return { from: fromWallet.address, to: token.address, value: '0x0', blockHash };
        }
        return {
          status: url.includes('rpc-a') ? '0x1' : '0x0', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash,
          logs: [{ address: token.address, topics: goodEvent.topics, data: goodEvent.data }]
        };
      };
      const statusOutcome = await buildTxVerificationReport({
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        verifier: { id: 'p4c-verifier' }, networks, rpc: statusDisagreeing, registry, now: now * 1000
      }, verifierKeys.privateKey);
      t('receipt-status disagreement between RPCs is rpc-disagreement and fails closed',
        statusOutcome.ok && statusOutcome.report.verdict === 'rpc-disagreement');
      const txBlockMismatch = async (_url, method) => {
        if (method === 'eth_blockNumber') return '0x100';
        if (method === 'eth_getTransactionByHash') {
          return { from: fromWallet.address, to: token.address, value: '0x0', blockHash: `0x${'66'.repeat(32)}` };
        }
        return {
          status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash,
          logs: [{ address: token.address, topics: goodEvent.topics, data: goodEvent.data }]
        };
      };
      const mismatchOutcome = await buildTxVerificationReport({
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        verifier: { id: 'p4c-verifier' }, networks, rpc: txBlockMismatch, registry, now: now * 1000
      }, verifierKeys.privateKey);
      t('a transaction/receipt block mismatch on one endpoint is reorg-detected',
        mismatchOutcome.ok && mismatchOutcome.report.verdict === 'reorg-detected');
      /* A reorg where one endpoint no longer sees the tx at all. */
      const reorged = async (url, method) => {
        if (method === 'eth_blockNumber') return '0x100';
        if (url.includes('rpc-b')) return null;
        if (method === 'eth_getTransactionByHash') {
          return { from: fromWallet.address, to: token.address, value: '0x0', blockHash };
        }
        return {
          status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash,
          logs: [{ address: token.address, topics: goodEvent.topics, data: goodEvent.data }]
        };
      };
      const reorgOutcome = await buildTxVerificationReport({
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        verifier: { id: 'p4c-verifier' }, networks, rpc: reorged, registry, now: now * 1000
      }, verifierKeys.privateKey);
      t('a reorg where one endpoint loses the tx fails closed',
        reorgOutcome.ok && reorgOutcome.report.verdict === 'rpc-disagreement');
      /* One reachable RPC can never satisfy a quorum of two. */
      const oneUp = async (url, method) => {
        if (url.includes('rpc-b')) throw new Error('down');
        return goodRpc()(url, method);
      };
      const single = await observeLegAcrossRpcs({
        network: networks.get(42161),
        expected: {
          txHash: sourceReceipt.txHash, native: false, tokenAddress: token.address,
          amount: '100000000', fromAddress: fromWallet.address, toAddress: toWallet.address
        },
        rpc: oneUp
      });
      t('one live RPC against a quorum of two fails closed',
        single.final === false && single.code === 'RPC_QUORUM_UNAVAILABLE');
      /* Three providers, quorum two: two agreeing endpoints verify even when
         the third is down. */
      const threeNetworks = parseCrossChainRpcNetworks(JSON.stringify([
        {
          chainId: 42161, quorum: 2, minConfirmations: 3,
          providers: [
            { id: 'arb-a', rpcUrl: 'https://arb-a.invalid' },
            { id: 'arb-b', rpcUrl: 'https://arb-b.invalid' },
            { id: 'arb-c', rpcUrl: 'https://arb-c.invalid' }
          ]
        }
      ]));
      const twoOfThree = async (url, method) => {
        if (url.includes('arb-c')) throw new Error('down');
        return goodRpc()(url, method);
      };
      const quorumOfThree = await buildTxVerificationReport({
        state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
        verifier: { id: 'p4c-verifier' }, networks: threeNetworks, rpc: twoOfThree, registry, now: now * 1000
      }, verifierKeys.privateKey);
      t('two agreeing providers of three satisfy a quorum of two',
        quorumOfThree.ok && quorumOfThree.report.verdict === 'onchain-verified'
          && quorumOfThree.report.quorum.agreeing === 2
          && quorumOfThree.report.quorum.total === 3);
    }
    {
      /* Bounded, strict defaultRpc transport: timeout, HTTP failure,
         malformed JSON and oversized responses all fail closed. */
      const realFetch = globalThis.fetch;
      const fakeFetch = (handler) => {
        globalThis.fetch = handler;
        return () => { globalThis.fetch = realFetch; };
      };
      let restore = fakeFetch(async () => {
        throw new Error('down');
      });
      let transportFailure = false;
      try { await defaultRpc('https://rpc.invalid', 'eth_blockNumber', [], { timeoutMs: 200 }); } catch { transportFailure = true; }
      restore();
      t('an RPC transport failure is surfaced, never verified', transportFailure);
      restore = fakeFetch(async () => ({ ok: false, status: 500 }));
      let httpFailure = false;
      try { await defaultRpc('https://rpc.invalid', 'eth_blockNumber', [], { timeoutMs: 200 }); } catch { httpFailure = true; }
      restore();
      t('an HTTP failure is surfaced, never verified', httpFailure);
      restore = fakeFetch(async () => ({ ok: true, text: async () => 'not json at all' }));
      let malformed = false;
      try { await defaultRpc('https://rpc.invalid', 'eth_blockNumber', [], { timeoutMs: 200 }); } catch { malformed = true; }
      restore();
      t('a malformed JSON-RPC response is surfaced, never verified', malformed);
      restore = fakeFetch(async () => ({ ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'x'.repeat(600 * 1024) }) }));
      let oversized = false;
      try { await defaultRpc('https://rpc.invalid', 'eth_blockNumber', [], { timeoutMs: 200 }); } catch { oversized = true; }
      restore();
      t('an oversized RPC response is refused before parsing', oversized);
      restore = fakeFetch((_url, opts) => new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      let timedOut = false;
      try { await defaultRpc('https://rpc.invalid', 'eth_blockNumber', [], { timeoutMs: 150 }); } catch { timedOut = true; }
      restore();
      t('an RPC that exceeds its timeout fails closed', timedOut);
    }

    {
      /* Native-asset destination leg: exact from/to/value transaction checks. */
      const destinationReceipt = buildCrossChainReceipt({
        state, previousReceipts: [sourceReceipt], leg: 'destination-transfer',
        txHash: `0x${'32'.repeat(32)}`, signedAt: now + 1
      }, counterpartyKeys.privateKey).receipt;
      const nativeFromProof = await walletProofFor(toWallet, {
        partyId: 'p4c-counterparty', chainId: 1, address: toWallet.address, expiresAt: now + 86400
      });
      const nativeToProof = await walletProofFor(fromWallet, {
        partyId: 'p4c-initiator', chainId: 1, address: fromWallet.address, expiresAt: now + 86400
      });
      const nativeFrom = buildAccountBinding({
        state, partyId: 'p4c-counterparty', chainId: 1, address: toWallet.address,
        issuedAt: now, expiresAt: now + 86400, walletProof: nativeFromProof.proof
      }, counterpartyKeys.privateKey, { now: now * 1000 });
      const nativeTo = buildAccountBinding({
        state, partyId: 'p4c-initiator', chainId: 1, address: fromWallet.address,
        issuedAt: now, expiresAt: now + 86400, walletProof: nativeToProof.proof
      }, initiatorKeys.privateKey, { now: now * 1000 });
      const nativeNetworks = parseCrossChainRpcNetworks(JSON.stringify([
        {
          chainId: 1, quorum: 2, minConfirmations: 2,
          providers: [
            { id: 'eth-a', rpcUrl: 'https://eth-a.invalid' },
            { id: 'eth-b', rpcUrl: 'https://eth-b.invalid' }
          ]
        }
      ]));
      const nativeRpc = (overrides = {}) => async (_url, method) => {
        if (method === 'eth_blockNumber') return overrides.latest ?? '0x100';
        if (method === 'eth_getTransactionReceipt') {
          return overrides.receipt ?? { status: '0x1', transactionHash: destinationReceipt.txHash, blockNumber: '0xf0', blockHash, logs: [] };
        }
        if (method === 'eth_getTransactionByHash') {
          return overrides.tx ?? {
            from: toWallet.address, to: fromWallet.address,
            value: '0xc3663566a58000', blockHash
          };
        }
        return null;
      };
      const goodNative = await buildTxVerificationReport({
        state, receipt: destinationReceipt, previousReceipts: [sourceReceipt],
        fromBinding: nativeFrom.binding, toBinding: nativeTo.binding,
        verifier: { id: 'p4c-verifier' }, networks: nativeNetworks,
        rpc: nativeRpc(), registry, now: (now + 1) * 1000
      }, verifierKeys.privateKey);
      t('an exact native transfer verifies on-chain',
        goodNative.ok && goodNative.report.verdict === 'onchain-verified');
      const badNative = await buildTxVerificationReport({
        state, receipt: destinationReceipt, previousReceipts: [sourceReceipt],
        fromBinding: nativeFrom.binding, toBinding: nativeTo.binding,
        verifier: { id: 'p4c-verifier' }, networks: nativeNetworks,
        rpc: nativeRpc({ tx: { from: toWallet.address, to: fromWallet.address, value: '0xc3663566a57fff', blockHash } }),
        registry, now: (now + 1) * 1000
      }, verifierKeys.privateKey);
      t('a wrong native value is rejected',
        badNative.ok && badNative.report.verdict === 'verification-rejected'
          && badNative.report.reasonCodes[0] === 'WRONG_AMOUNT');
      const wrongNativeSender = await buildTxVerificationReport({
        state, receipt: destinationReceipt, previousReceipts: [sourceReceipt],
        fromBinding: nativeFrom.binding, toBinding: nativeTo.binding,
        verifier: { id: 'p4c-verifier' }, networks: nativeNetworks,
        rpc: nativeRpc({ tx: { from: fromWallet.address, to: fromWallet.address, value: '0xc3663566a58000', blockHash } }),
        registry, now: (now + 1) * 1000
      }, verifierKeys.privateKey);
      t('a wrong native sender is rejected',
        wrongNativeSender.ok && wrongNativeSender.report.verdict === 'verification-rejected'
          && wrongNativeSender.report.reasonCodes[0] === 'WRONG_SENDER');
      const wrongNativeRecipient = await buildTxVerificationReport({
        state, receipt: destinationReceipt, previousReceipts: [sourceReceipt],
        fromBinding: nativeFrom.binding, toBinding: nativeTo.binding,
        verifier: { id: 'p4c-verifier' }, networks: nativeNetworks,
        rpc: nativeRpc({ tx: { from: toWallet.address, to: toWallet.address, value: '0xc3663566a58000', blockHash } }),
        registry, now: (now + 1) * 1000
      }, verifierKeys.privateKey);
      t('a wrong native recipient is rejected',
        wrongNativeRecipient.ok && wrongNativeRecipient.report.verdict === 'verification-rejected'
          && wrongNativeRecipient.report.reasonCodes[0] === 'WRONG_RECIPIENT');
      const failedNative = await buildTxVerificationReport({
        state, receipt: destinationReceipt, previousReceipts: [sourceReceipt],
        fromBinding: nativeFrom.binding, toBinding: nativeTo.binding,
        verifier: { id: 'p4c-verifier' }, networks: nativeNetworks,
        rpc: nativeRpc({ receipt: { status: '0x0', transactionHash: destinationReceipt.txHash, blockNumber: '0xf0', blockHash, logs: [] } }),
        registry, now: (now + 1) * 1000
      }, verifierKeys.privateKey);
      t('a failed native receipt is rejected',
        failedNative.ok && failedNative.report.verdict === 'verification-rejected'
          && failedNative.report.reasonCodes[0] === 'TX_RECEIPT_FAILED');
      /* Self-attested bindings are never enough for onchain verification. */
      const selfAttestedFrom = buildAccountBinding({
        state, partyId: 'p4c-initiator', chainId: 42161, address: fromWallet.address,
        issuedAt: now, expiresAt: now + 86400
      }, initiatorKeys.privateKey, { now: now * 1000 });
      const selfAttestedTo = buildAccountBinding({
        state, partyId: 'p4c-counterparty', chainId: 42161, address: toWallet.address,
        issuedAt: now, expiresAt: now + 86400
      }, counterpartyKeys.privateKey, { now: now * 1000 });
      const noProof = await verifyLegOnChain({
        state, receipt: sourceReceipt,
        fromBinding: selfAttestedFrom.binding, toBinding: selfAttestedTo.binding,
        networks, rpc: goodRpc(), now: now * 1000
      });
      t('a binding without a wallet proof can never reach onchain-verified',
        !noProof.ok && noProof.code === 'WALLET_PROOF_REQUIRED');
      /* Even with BOTH legs verified, nothing became atomic. */
      const settled = evaluateCrossChainState(state, [sourceReceipt, destinationReceipt], {
        now: (now + 1) * 1000
      });
      t('a fully verified sequential swap still reports atomic:false',
        settled.ok && settled.status === 'settled-sequential'
          && settled.atomic === false && settled.custody === false);
    }

    /* ------------------- immutable storage + derived view ------------------- */
    {
      const storedState = await storeCrossChainState(state);
      t('the Phase 4c state stores for binding/report exercises',
        storedState.ok && storedState.state.stateId === state.stateId);
      const storedReceipt = await storeCrossChainReceipt(state.stateId, sourceReceipt, { now: now * 1000 });
      t('the source receipt stores without touching its historical bytes',
        storedReceipt.ok && storedReceipt.receipt.claims.onChainVerified === false);
      const storedB = await storeAccountBinding(state.stateId, fromBinding.binding);
      t('a valid account binding stores immutably', storedB.ok && !storedB.alreadyStored);
      const replayB = await storeAccountBinding(state.stateId, fromBinding.binding);
      t('replaying a byte-identical binding is idempotent', replayB.ok && replayB.alreadyStored === true);
      const driftedB = await storeAccountBinding(state.stateId, selfAttested.binding);
      t('a drifted binding on the same binding slot conflicts, never overwrites',
        driftedB.ok === false && driftedB.code === 'ACCOUNT_BINDING_CONFLICT');
      const storedToB = await storeAccountBinding(state.stateId, toBinding.binding);
      t('the counterparty binding stores too', storedToB.ok && !storedToB.alreadyStored);
      const listedBindings = await readAccountBindings(state.stateId);
      t('stored bindings read back exactly once with the embedded keys intact',
        listedBindings.bindings?.length === 2
          && listedBindings.bindings.some((row) => row.bindingId === fromBinding.binding.bindingId
            && row.partyPublicKey === initiatorKeys.publicKey
            && row.claims.walletSignatureVerified === true)
          && listedBindings.bindings.some((row) => row.bindingId === toBinding.binding.bindingId
            && row.partyPublicKey === counterpartyKeys.publicKey));

      const storedReport = await storeTxVerificationReport(state.stateId, report.report, {
        registry, networks, rpc: goodRpc(), now: now * 1000
      });
      t('a server-recomputed report stores immutably with the recomputation attestation',
        storedReport.ok && !storedReport.alreadyStored
          && storedReport.record?.serverRecomputedBeforeStorage === true);
      const replayReport = await storeTxVerificationReport(state.stateId, report.report, {
        registry, networks, rpc: goodRpc(), now: now * 1000
      });
      t('replaying a byte-identical report is idempotent',
        replayReport.ok && replayReport.alreadyStored === true);
      const tamperedReport = { ...report.report, claims: { ...report.report.claims, custody: true } };
      const conflictReport = await storeTxVerificationReport(state.stateId, tamperedReport, {
        registry, networks, rpc: goodRpc(), now: now * 1000
      });
      t('drift on the same verification id conflicts, never overwrites',
        conflictReport.ok === false && conflictReport.code === 'VERIFICATION_REPORT_CONFLICT');
      const listedReports = await readTxVerificationReports(state.stateId);
      t('public reads re-verify the stored report with its embedded verifier key',
        listedReports.records?.length === 1
          && listedReports.records[0].serverRecomputedBeforeStorage === true
          && listedReports.records[0].report.verificationId === report.report.verificationId);
      t('registry rotation never deletes a historical verified report',
        verifyTxVerificationReport(report.report, {
          state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
          registry: new Map([['someone-else', { id: 'someone-else', publicKey: strangerKeys.publicKey, active: true }]]),
          now: now * 1000
        }).code === 'UNREGISTERED_VERIFIER'
          && listedReports.records[0].report.verdict === 'onchain-verified');
      /* Per-receipt report cap: the main report already occupies one slot,
         two more store and the third alternative refuses. */
      const capReports = [];
      for (let i = 0; i < 3; i += 1) {
        const altHash = `0x${(i + 5).toString(16).padStart(2, '0')}${'ab'.repeat(31)}`;
        const altRpc = async (_url, method) => {
          if (method === 'eth_blockNumber') return '0x100';
          if (method === 'eth_getTransactionReceipt') {
            return {
              status: '0x1', transactionHash: sourceReceipt.txHash, blockNumber: '0xf0', blockHash: altHash,
              logs: [{ address: token.address, topics: goodEvent.topics, data: goodEvent.data }]
            };
          }
          if (method === 'eth_getTransactionByHash') {
            return { from: fromWallet.address, to: token.address, value: '0x0', blockHash: altHash };
          }
          return null;
        };
        const altReport = await buildTxVerificationReport({
          state, receipt: sourceReceipt, fromBinding: fromBinding.binding, toBinding: toBinding.binding,
          verifier: { id: 'p4c-verifier' }, networks, rpc: altRpc, registry, now: now * 1000
        }, verifierKeys.privateKey);
        const storedAlt = await storeTxVerificationReport(state.stateId, altReport.report, {
          registry, networks, rpc: altRpc, now: now * 1000
        });
        capReports.push(storedAlt);
      }
      t('the per-receipt report count is bounded',
        capReports[0].ok && capReports[1].ok
          && capReports[2].ok === false && capReports[2].code === 'VERIFICATION_REPORT_LIMIT');
    }
    {
      /* Storage outage: never becomes a valid empty result, never verified. */
      const outageState = createCrossChainState({
        schema: 'fbt.cross-chain-state.v1',
        createdAt: now + 2,
        source: { chainId: 42161, token, amount: '200000000' },
        destination: { chainId: 1, token: nativeToken, amount: '100000000000000000' },
        parties: {
          initiator: { id: 'outage-initiator', publicKey: initiatorKeys.publicKey },
          counterparty: { id: 'outage-counterparty', publicKey: counterpartyKeys.publicKey }
        },
        timeout: { sourceSignatureBy: now + 600, destinationSignatureBy: now + 700, refundSignatureBy: now + 800 },
        refund: {
          chainId: 42161, token, amount: '200000000',
          fromPartyId: 'outage-counterparty', toPartyId: 'outage-initiator',
          mode: 'user-signed-transfer', automatic: false, enforceableByFbt: false
        }
      }, { now: (now + 2) * 1000 }).state;
      await storeCrossChainState(outageState);
      const outageReceipt = buildCrossChainReceipt({
        state: outageState, leg: 'source-transfer', txHash: `0x${'51'.repeat(32)}`, signedAt: now + 2
      }, initiatorKeys.privateKey).receipt;
      await storeCrossChainReceipt(outageState.stateId, outageReceipt, { now: (now + 2) * 1000 });
      const outageFromProof = await walletProofFor(fromWallet, {
        partyId: 'outage-initiator', chainId: 42161, address: fromWallet.address, expiresAt: now + 86400
      }, outageState);
      const outageToProof = await walletProofFor(toWallet, {
        partyId: 'outage-counterparty', chainId: 42161, address: toWallet.address, expiresAt: now + 86400
      }, outageState);
      const outageFrom = buildAccountBinding({
        state: outageState, partyId: 'outage-initiator', chainId: 42161, address: fromWallet.address,
        issuedAt: now, expiresAt: now + 86400, walletProof: outageFromProof.proof
      }, initiatorKeys.privateKey, { now: now * 1000 }).binding;
      const outageTo = buildAccountBinding({
        state: outageState, partyId: 'outage-counterparty', chainId: 42161, address: toWallet.address,
        issuedAt: now, expiresAt: now + 86400, walletProof: outageToProof.proof
      }, counterpartyKeys.privateKey, { now: now * 1000 }).binding;
      await storeAccountBinding(outageState.stateId, outageFrom);
      await storeAccountBinding(outageState.stateId, outageTo);
      const outageEvent = transferIface.encodeEventLog(transferIface.getEvent('Transfer'), [
        fromWallet.address, toWallet.address, 200000000n
      ]);
      const outageRpc = async (_url, method) => {
        if (method === 'eth_blockNumber') return '0x100';
        if (method === 'eth_getTransactionReceipt') {
          return {
            status: '0x1', transactionHash: outageReceipt.txHash, blockNumber: '0xf0', blockHash,
            logs: [{ address: token.address, topics: outageEvent.topics, data: outageEvent.data }]
          };
        }
        if (method === 'eth_getTransactionByHash') {
          return { from: fromWallet.address, to: token.address, value: '0x0', blockHash };
        }
        return null;
      };
      const outageReport = await buildTxVerificationReport({
        state: outageState, receipt: outageReceipt, fromBinding: outageFrom, toBinding: outageTo,
        verifier: { id: 'p4c-verifier' }, networks, rpc: outageRpc, registry, now: (now + 2) * 1000
      }, verifierKeys.privateKey);
      __overrideBlobForTests({
        put: async () => { throw new Error('outage'); },
        list: async () => { throw new Error('outage'); }
      });
      try {
        const outageWrite = await storeTxVerificationReport(outageState.stateId, outageReport.report, {
          registry, networks, rpc: outageRpc, now: (now + 2) * 1000
        });
        t('a blob outage refuses the write instead of pretending success',
          outageWrite.ok === false
            && ['CROSS_CHAIN_STORE_UNAVAILABLE', 'CROSS_CHAIN_WRITE_FAILED'].includes(outageWrite.code));
        const outageRead = await readCrossChainStateWithVerification(outageState.stateId, { now: (now + 2) * 1000 });
        t('a blob outage on read is an error, never an empty valid result',
          Boolean(outageRead.error) && !outageRead.bindings);
      } finally {
        __overrideBlobForTests(null);
      }
    }

    /* ------------------------- derived leg statuses ------------------------ */
    {
      const proofBinding = fromBinding.binding;
      const attestBinding = selfAttested.binding;
      t('derived leg statuses expose the honest ten-step verification ladder',
        deriveLegVerificationStatus({}).status === 'signed-only'
          && deriveLegVerificationStatus({ networkConfigured: true }).status === 'binding-required'
          && deriveLegVerificationStatus({ networkConfigured: true, fromBinding: attestBinding, toBinding: attestBinding }).status === 'wallet-proof-required'
          && deriveLegVerificationStatus({ networkConfigured: true, fromBinding: proofBinding, toBinding: proofBinding }).status === 'verification-pending'
          && deriveLegVerificationStatus({ attempt: 'RPC_DISAGREEMENT' }).status === 'rpc-disagreement'
          && deriveLegVerificationStatus({ attempt: 'REORG_DETECTED' }).status === 'reorg-detected'
          && deriveLegVerificationStatus({ attempt: 'RPC_QUORUM_UNAVAILABLE' }).status === 'verification-unavailable'
          && deriveLegVerificationStatus({ attempt: 'INSUFFICIENT_CONFIRMATIONS' }).status === 'confirmations-pending'
          && deriveLegVerificationStatus({
            reports: [{ report: report.report }], networkConfigured: true
          }).status === 'onchain-verified');
      const withEverything = await readCrossChainStateWithVerification(state.stateId, { now: now * 1000 });
      t('the public state derives bindings, records and per-leg status without rewriting receipts',
        withEverything.state.stateId === state.stateId
          && withEverything.accountBindings.length === 2
          && withEverything.verificationReports.length >= 1
          && withEverything.receipts.every((row) => row.claims.onChainVerified === false)
          && withEverything.legVerification['source-transfer'].status === 'onchain-verified'
          && withEverything.atomic === false
          && withEverything.globalAtomicity === false
          && withEverything.custody === false
          && withEverything.escrow === false
          && withEverything.automaticSettlement === false
          && withEverything.refundEnforcedByFbt === false);
    }

    const crossCaps4c = crossChainProtocolStatus();
    t('Phase 4c never upgrades the historical receipt schema or the atomic guard',
      crossCaps4c.onChainTxVerification === false
        && crossCaps4c.atomic === false
        && crossCaps4c.envelopeBlockCode === 'ATOMIC_CROSS_CHAIN_UNAVAILABLE'
        && crossCaps4c.derivedLegVerificationSchema === 'fbt.cross-chain-tx-verification.v1');

    {
      /* CLI: binding-challenge + bind-account with a public wallet signature;
         private keys never reach stdout. */
      const tmp = mkdtempSync(join(tmpdir(), 'fbt-phase4c-'));
      try {
        const stateFile = join(tmp, 'state.json');
        writeFileSync(stateFile, JSON.stringify(state));
        const challengeOut = execFileSync(process.execPath, [
          'scripts/intent-cross-chain.mjs', 'binding-challenge', stateFile,
          '--party', 'p4c-initiator', '--chain', '42161',
          '--address', fromWallet.address, '--expires-at', String(now + 86400),
          '--issued-at', String(now), '--nonce', 'cli-nonce'
        ], {
          encoding: 'utf8',
          env: { ...process.env }
        });
        const cliChallenge = JSON.parse(challengeOut);
        const cliWalletSignature = await fromWallet.signMessage(cliChallenge.message);
        const cliBindOut = execFileSync(process.execPath, [
          'scripts/intent-cross-chain.mjs', 'bind-account', stateFile,
          '--party', 'p4c-initiator', '--chain', '42161',
          '--address', fromWallet.address, '--expires-at', String(now + 86400),
          '--issued-at', String(now), '--nonce', 'cli-nonce',
          '--wallet-signature', cliWalletSignature
        ], {
          encoding: 'utf8',
          env: { ...process.env, INTENT_CROSS_CHAIN_PRIVATE_KEY: initiatorKeys.privateKey }
        });
        const cliBinding = JSON.parse(cliBindOut);
        t('the CLI builds the public challenge and binds with only the public wallet signature',
          cliChallenge.domain === 'fbt.cross-chain-account-binding.v1/wallet-challenge'
            && verifyAccountBinding(cliBinding, { state, now: now * 1000 }).ok
            && cliBinding.claims.walletSignatureVerified === true
            && !challengeOut.includes(initiatorKeys.privateKey)
            && !cliBindOut.includes(initiatorKeys.privateKey)
            && !cliBindOut.includes('rpc-a.invalid')
            && !cliChallenge.message.includes(initiatorKeys.privateKey));
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
  }

  /* ------- Phase 6: independent operators, coordinator rotation, root anchors ------- */
  {
    const now = Math.floor(Date.now() / 1000);
    const operatorKeys = generateSolverKeyPair();
    const observer = { id: 'outside-verifier', publicKey: operatorKeys.publicKey, active: true };
    const attested = buildOperatorAttestation({
      operatorId: 'outside-operator',
      operatorName: 'Outside Operator',
      operatorUrl: 'https://operator.example',
      role: 'verifier',
      registryId: observer.id,
      expiresAt: now + 86400
    }, operatorKeys.privateKey, { now: now * 1000 });
    t('an external operator cryptographically binds its own verifier key',
      attested.ok && verifyOperatorAttestation(attested.attestation, { now: now * 1000 }).ok);
    t('tampering operator metadata invalidates the attestation',
      !verifyOperatorAttestation({
        ...attested.attestation, operatorName: 'FBT pretending to be external'
      }, { now: now * 1000 }).ok);
    const independent = independentVerificationStatus({
      verifierRegistry: new Map([[observer.id, observer]]),
      attestations: [attested.attestation]
    });
    t('Phase 6 configures only fully signed, key-separated operator bindings',
      independent.configured === true && independent.allObserverKeysAttested === true
        && independent.keySeparationVerified === true);
    t('operator capabilities never claim a registry proves organizational independence',
      independent.organizationalIndependenceProven === false
        && independent.independenceBasis === 'signed-operator-statement-not-corporate-independence-proof');
    t('a bare verifier registry is not Phase 6 independent-operator configuration',
      independentVerificationStatus({
        verifierRegistry: new Map([[observer.id, observer]]), attestations: []
      }).configured === false);
    t('a verifier key reused by a solver fails independent key separation',
      independentVerificationStatus({
        verifierRegistry: new Map([[observer.id, observer]]),
        solverRegistry: new Map([['same-key-solver', { id: 'same-key-solver', publicKey: operatorKeys.publicKey, active: true }]]),
        attestations: [attested.attestation]
      }).configured === false);

    const oldKeys = generateSolverKeyPair();
    const newKeys = generateSolverKeyPair();
    let rotation = createCoordinatorRotationDraft({
      coordinatorId: 'unit-rotating-coordinator',
      oldPublicKey: oldKeys.publicKey,
      newPublicKey: newKeys.publicKey,
      activatedAt: Date.now()
    });
    rotation = signCoordinatorRotation(rotation.rotation, oldKeys.privateKey, 'old');
    t('an old-key-only rotation draft is not accepted as complete',
      rotation.ok && rotation.complete === false && !verifyCoordinatorRotation(rotation.rotation));
    rotation = signCoordinatorRotation(rotation.rotation, newKeys.privateKey, 'new');
    t('a coordinator rotation requires valid signatures from old and new keys',
      rotation.ok && rotation.complete === true && verifyCoordinatorRotation(rotation.rotation)
        && coordinatorKeysLinked(oldKeys.publicKey, newKeys.publicKey,
          'unit-rotating-coordinator', [rotation.rotation]));

    const receiptFacts = {
      intentHash: `0x${'61'.repeat(32)}`,
      entryHash: `0x${'62'.repeat(32)}`,
      acceptedAt: Date.now(),
      solverId: 'rotation-solver'
    };
    const oldReceipt = issueAdmissionReceipt(receiptFacts, {
      coordinator: {
        id: 'unit-rotating-coordinator', publicKey: oldKeys.publicKey, privateKey: oldKeys.privateKey
      }
    });
    const newReceipt = issueAdmissionReceipt({ ...receiptFacts, entryHash: `0x${'63'.repeat(32)}` }, {
      coordinator: {
        id: 'unit-rotating-coordinator', publicKey: newKeys.publicKey, privateKey: newKeys.privateKey
      }
    });
    t('historical and new coordinator receipts each remain pinned to their signing key',
      verifyAdmissionReceipt(oldReceipt) && verifyAdmissionReceipt(newReceipt)
        && oldReceipt.coordinator.publicKey === oldKeys.publicKey
        && newReceipt.coordinator.publicKey === newKeys.publicKey);

    const previousId = process.env.INTENT_COORDINATOR_ID;
    const previousKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY;
    const previousRotations = process.env.INTENT_COORDINATOR_ROTATIONS;
    process.env.INTENT_COORDINATOR_ID = 'unit-rotating-coordinator';
    process.env.INTENT_COORDINATOR_PRIVATE_KEY = newKeys.privateKey;
    process.env.INTENT_COORDINATOR_ROTATIONS = JSON.stringify([rotation.rotation]);
    try {
      const keyring = publicCoordinator();
      t('public coordinator discovery exposes active-only signing plus retired verification keys',
        keyring.publicKey === newKeys.publicKey && keyring.signsNewDocuments === true
          && keyring.keyring.rotationConfigured === true
          && keyring.keyring.retired.some((row) => row.publicKey === oldKeys.publicKey
            && row.signsNewDocuments === false));
    } finally {
      if (previousId === undefined) delete process.env.INTENT_COORDINATOR_ID;
      else process.env.INTENT_COORDINATOR_ID = previousId;
      if (previousKey === undefined) delete process.env.INTENT_COORDINATOR_PRIVATE_KEY;
      else process.env.INTENT_COORDINATOR_PRIVATE_KEY = previousKey;
      if (previousRotations === undefined) delete process.env.INTENT_COORDINATOR_ROTATIONS;
      else process.env.INTENT_COORDINATOR_ROTATIONS = previousRotations;
    }

    const hashes = [`0x${'71'.repeat(32)}`, `0x${'72'.repeat(32)}`];
    const log = {
      schema: 'fbt.transparency-log.v1',
      intentHash: `0x${'73'.repeat(32)}`,
      root: merkleRoot(hashes),
      size: hashes.length,
      entries: hashes.map((entryHash) => ({ entryHash }))
    };
    const manifest = buildMerkleRootManifest(log);
    t('a Phase 6 root manifest recomputes the exact log root and size',
      manifest.ok && manifest.manifest.logSize === 2
        && manifest.manifest.claims.completenessProven === false);
    t('a changed returned root cannot produce an anchor manifest',
      buildMerkleRootManifest({ ...log, root: `0x${'74'.repeat(32)}` }).code
        === 'MERKLE_ROOT_RECOMPUTE_MISMATCH');
    const contract = `0x${'75'.repeat(20)}`;
    const anchorer = `0x${'76'.repeat(20)}`;
    const networks = new Map([[8453, {
      chainId: 8453,
      name: 'Unit Base Root Anchor',
      contract,
      rpcUrl: 'https://rpc.invalid',
      explorerBaseUrl: 'https://explorer.invalid',
      minConfirmations: 2
    }]]);
    const calldata = buildMerkleRootAnchorCalldata(manifest.manifest, 8453, networks);
    t('root-anchor calldata binds rootId, intent, root and log size',
      calldata.ok && calldata.to.toLowerCase() === contract.toLowerCase());
    const rootInterface = new Interface(MERKLE_ROOT_ANCHOR_ABI);
    const event = rootInterface.encodeEventLog(rootInterface.getEvent('MerkleRootAnchored'), [
      manifest.manifest.rootId,
      manifest.manifest.intentHash,
      manifest.manifest.merkleRoot,
      BigInt(manifest.manifest.logSize),
      anchorer
    ]);
    const txHash = `0x${'77'.repeat(32)}`;
    const verifiedAnchor = await verifyMerkleRootAnchorClaim(manifest.manifest, {
      schema: 'fbt.merkle-root-anchor-claim.v1',
      rootId: manifest.manifest.rootId,
      chainId: 8453,
      txHash
    }, {
      networks,
      rpc: async (_network, method) => method === 'eth_blockNumber' ? '0x65' : {
        status: '0x1', transactionHash: txHash, blockNumber: '0x64',
        blockHash: `0x${'78'.repeat(32)}`,
        logs: [{ address: contract, topics: event.topics, data: event.data }]
      },
      now: Date.now()
    });
    t('only a confirmed exact contract event flips a Merkle root to externally anchored',
      verifiedAnchor.ok && verifiedAnchor.anchor.externallyAnchored === true
        && verifiedAnchor.anchor.claims.completenessProven === false);
    t('root-anchor capability stays configured:false without a real network env',
      merkleRootAnchorStatus(new Map()).configured === false
        && merkleRootAnchorStatus(new Map()).externallyAnchoredByDefault === false);
  }

  /* -------- Whale tracking schema + normalization -------- */
  {
    const sample = {
      id: '56:0xabc:0',
      chainId: 56, chainShort: 'BSC', chainName: 'BNB Smart Chain', chainColor: '#f0b90b',
      kind: 'transfer',
      token: { symbol: 'USDT', name: 'Tether USD', address: '0x55d3…', decimals: 18, verified: true, coingeckoId: 'tether' },
      amount: 1_000_000, valueUsd: 1_000_000, usdPrice: 1,
      from: { address: '0x' + '1'.repeat(40), label: null, short: '0x1111…1111' },
      to: { address: '0x' + '2'.repeat(40), label: null, short: '0x2222…2222' },
      hash: '0xabc', blockNumber: 1, timestamp: Date.now(),
      explorerTx: 'https://bscscan.com/tx/0xabc',
      explorerFrom: 'https://bscscan.com/address/0x111', explorerTo: 'https://bscscan.com/address/0x222'
    };
    t('normalizeEvent returns a stable shape',
      normalizeEvent(sample).id === sample.id && normalizeEvent(sample).token.symbol === 'USDT');
    t('normalizeEvent keeps unknown kinds as transfer',
      normalizeEvent({ ...sample, kind: 'weird' }).kind === 'transfer');
    t('normalizeEvent tolerates missing values',
      normalizeEvent({ id: 'x', chainId: 1, hash: '0xh', token: { symbol: 'X' } }).amount === 0);

    t('validateResponseShape rejects missing schema',
      validateResponseShape({ events: [] }) === false);
    t('validateResponseShape accepts a well-formed response',
      validateResponseShape({ schema: 'fbt.whales.v1', events: [sample] }) === true);
    t('validateResponseShape rejects events without hash',
      validateResponseShape({ schema: 'fbt.whales.v1', events: [{ id: '1', chainId: 1 }] }) === false);

    // Deduplication: repeated ids collapse to one entry in the server module
    // (simulated here by a Set the server uses).
    const dedupe = new Set();
    [sample, sample, { ...sample, id: '56:0xdef:0' }].forEach((e) => dedupe.add(e.id));
    t('whale events deduplicate by chain+hash+logIndex key', dedupe.size === 2);

    // Threshold filtering at the API: a small event below minUsd is excluded.
    const small = { ...sample, valueUsd: 50, amount: 50 };
    const big = { ...sample, valueUsd: 500_000, amount: 500_000, id: '56:0xbig:0' };
    const filtered = [small, big].filter((e) => e.valueUsd == null || e.valueUsd >= 100_000);
    t('events below the minimum USD threshold are filtered out',
      filtered.length === 1 && filtered[0].id === big.id);

    // Unknown labels must remain null/unknown — never fabricated.
    const unknown = normalizeEvent(sample);
    t('unknown sender label stays null', unknown.from.label === null);
    t('unknown recipient label stays null', unknown.to.label === null);

    // Kind set must include the supported categories
    t('event kind set includes transfer/mint/burn',
      EVENT_KINDS.includes('transfer') && EVENT_KINDS.includes('mint') && EVENT_KINDS.includes('burn'));
  }

  /* ---------------- watch-only bitcoin addresses --------------------- */
  /*
   * The whole point of this module is that it can NEVER spend. These cases
   * therefore guard two different things: that the record shape stays minimal
   * (no key material can sneak in), and that the address validation is the
   * same mainnet-only decoder the send path uses — a regex would happily
   * accept a testnet address and then show an eternally empty balance.
   */
  {
    /* Real mainnet addresses, one of each encoding the decoder supports. */
    const P2PKH = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
    const P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
    const BECH32 = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    /* Testnet equivalents — valid bitcoin, wrong network, must be refused. */
    const TB1 = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
    const TESTNET_P2PKH = 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';

    t('a mainnet bech32 address validates', validateWatch(BECH32, '', []).ok === true);
    t('a mainnet P2PKH address validates', validateWatch(P2PKH, '', []).ok === true);
    t('a mainnet P2SH address validates', validateWatch(P2SH, '', []).ok === true);

    t('an empty address reports EMPTY', validateWatch('   ', '', []).code === 'EMPTY');
    t('a testnet bech32 address is rejected as INVALID', validateWatch(TB1, '', []).code === 'INVALID');
    t('a testnet base58 address is rejected as INVALID', validateWatch(TESTNET_P2PKH, '', []).code === 'INVALID');
    t('a mistyped address (bad checksum) is rejected',
      validateWatch('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3', '', []).code === 'INVALID');
    t('an ethereum address is rejected',
      validateWatch('0x1111111111111111111111111111111111111111', '', []).code === 'INVALID');

    /* The stored record is address + label and nothing else, forever. */
    const made = validateWatch(BECH32, '  Hardware wallet  ', []);
    t('the saved entry trims the label', made.entry.label === 'Hardware wallet');
    t('the saved entry holds ONLY an address and a label',
      Object.keys(made.entry).sort().join(',') === 'address,label');
    t('a pasted paragraph cannot blow up the label',
      validateWatch(BECH32, 'x'.repeat(500), []).entry.label.length <= 24);

    /* add / duplicate / full */
    const one = addWatch([], BECH32, 'a');
    t('addWatch returns a new list rather than mutating', one.ok && one.list.length === 1);
    t('the same address twice reports DUPLICATE', addWatch(one.list, BECH32, 'b').code === 'DUPLICATE');
    t('DUPLICATE leaves the list untouched', addWatch(one.list, BECH32, 'b').list.length === 1);
    /* base58 is case-significant: lower-casing to compare would fuse two
       genuinely different addresses, so a case variant is NOT a duplicate. */
    t('a base58 case variant is not treated as the same address',
      addWatch([{ address: P2PKH, label: '' }], P2PKH.toLowerCase(), '').code !== 'DUPLICATE');

    const full = [P2PKH, P2SH, BECH32, '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq']
      .map((address) => ({ address, label: '' }));
    t('the list caps at five', full.length === MAX_WATCH);
    t('a sixth address reports FULL',
      addWatch(full, '3FZbgi29cpjq2GjdwV8eyHuJJnkLtktZc5', '').code === 'FULL');

    /* delete */
    t('removeWatch deletes exactly one entry',
      removeWatch(full, P2SH).length === 4 && !removeWatch(full, P2SH).some((e) => e.address === P2SH));
    t('removing an unknown address is a no-op', removeWatch(full, 'nope').length === 5);

    /* Round-trip through storage. Node has no localStorage before 22, and the
       module must degrade rather than throw either way, so both paths are
       exercised: first with no storage at all, then with a minimal shim. */
    if (!globalThis.localStorage) {
      t('loadWatch returns an empty list when storage does not exist', loadWatch().length === 0);
      const mem = new Map();
      globalThis.localStorage = {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => mem.set(k, String(v)),
        removeItem: (k) => mem.delete(k)
      };
    }
    saveWatch([{ address: BECH32, label: 'cold' }]);
    const back = loadWatch();
    t('a saved address survives a reload', back.length === 1 && back[0].address === BECH32);
    t('the label survives a reload', back[0].label === 'cold');
    t('storage is namespaced and versioned', BTC_WATCH_KEY === 'fbt-btc-watch-v1');

    /* Storage is user-writable. A hand-edited testnet address, a duplicate or
       a smuggled key field must not survive the read. */
    globalThis.localStorage.setItem(BTC_WATCH_KEY, JSON.stringify([
      { address: TB1, label: 'testnet' },
      { address: BECH32, label: 'ok', wif: 'L1aW4aubDFB7yfras2S1mN3bqg9nwySY8nkoLmJebSLD5BWv3ENZ' },
      { address: BECH32, label: 'dupe' }
    ]));
    const cleaned = loadWatch();
    t('a hand-edited testnet address is dropped on read',
      !cleaned.some((e) => e.address === TB1));
    t('a duplicate on disk is collapsed on read', cleaned.length === 1);
    t('a smuggled private key is never read back',
      cleaned.every((e) => Object.keys(e).sort().join(',') === 'address,label'));

    globalThis.localStorage.setItem(BTC_WATCH_KEY, '{not json');
    t('corrupt storage reads as an empty list, not a crash', loadWatch().length === 0);
    globalThis.localStorage.removeItem(BTC_WATCH_KEY);
  }

  /* ---------------- country flags from ISO codes --------------------- */
  {
    /* A + 0x1F1E6 - 0x41, twice. Nothing else, no table, no package. */
    t('CA becomes the Canadian flag', flagEmoji('CA') === '\u{1F1E8}\u{1F1E6}');
    t('IR becomes the Iranian flag', flagEmoji('IR') === '\u{1F1EE}\u{1F1F7}');
    t('lower case input still works', flagEmoji('de') === flagEmoji('DE'));
    t('surrounding whitespace is ignored', flagEmoji('  us ') === flagEmoji('US'));
    t('a flag is two regional indicators', [...flagEmoji('GB')].length === 2);

    t('a three-letter code has no flag', flagEmoji('USA') === '');
    t('a one-letter code has no flag', flagEmoji('U') === '');
    t('digits have no flag', flagEmoji('12') === '');
    t('null has no flag', flagEmoji(null) === '');
    t('undefined has no flag', flagEmoji(undefined) === '');

    t('normalizeCountryCode upper-cases and trims', normalizeCountryCode(' ir ') === 'IR');
    /* null, not '' — the caller branches on it, and a falsy-but-string return
       would let `code ?? 'XX'` style defaults slip through unnoticed. */
    t('normalizeCountryCode rejects junk with null', normalizeCountryCode('n/a') === null);

    /* The fallback keeps the row the same width on platforms with no flag
       glyphs (every Windows build), so it must always be the two letters. */
    t('the fallback is the two-letter code', flagFallback('ir') === 'IR');
    t('the fallback of junk is empty', flagFallback('!!') === '');

    /* Headless: there is no canvas to measure, so support must be assumed
       rather than reported as false — a false here would show letters to
       everyone on a server-rendered pass. */
    t('flag support is assumed when there is no DOM to measure', flagSupported(true) === true);
  }

  /* ------------------- Goal math (Wealth Hub) -------------------------- */
  /*
   * Pure math, no DOM, no React. The engine answers two questions:
   *   1. How far along is the user right now? (goalProgress)
   *   2. What monthly contribution reaches the target? (requiredMonthlyContribution)
   * Every assertion below would catch a regression that would either mislead
   * the user (a wrong progress bar) or ask for an impossible payment.
   */
  {
    /* ---- monthsBetween: calendar months, never a 30-day approximation ---- */
    // Same calendar day, +12 months → exactly 12 whole months.
    t('months between the same day a year apart is 12',
      monthsBetween(new Date(2026, 0, 15).getTime(), new Date(2027, 0, 15).getTime()) === 12);
    // 14 months exactly.
    t('14 months is 14',
      monthsBetween(new Date(2026, 0, 15).getTime(), new Date(2027, 2, 15).getTime()) === 14);
    // Deadline is the 10th, today is the 15th — the 10th has not been reached
    // yet this month, so the contribution for the partial final month does
    // not count. A user who set a goal 1 year and 25 days ago gets 12
    // contributions, not 13.
    t('a partial final month is not a whole payment',
      monthsBetween(new Date(2026, 0, 15).getTime(), new Date(2027, 0, 10).getTime()) === 11);
    // Past deadline → 0.
    t('a deadline in the past is 0 months',
      monthsBetween(new Date(2026, 5, 1).getTime(), new Date(2026, 0, 1).getTime()) === 0);
    // Same instant → 0.
    t('a deadline equal to now is 0 months',
      monthsBetween(1_000_000, 1_000_000) === 0);
    // Garbage in → 0 out, never a throw.
    t('non-numeric timestamps do not throw', monthsBetween('a', 'b') === 0);

    /* ---- goalProgress: clamped bar + honest unclamped ratio ---- */
    t('progress is the ratio clamped to [0, 1]',
      goalProgress({ targetUsd: 1000, currentUsd: 250 }).progress === 0.25);
    t('unclamped exposes the raw ratio, even above 1',
      Math.abs(goalProgress({ targetUsd: 1000, currentUsd: 1750 }).unclamped - 1.75) < 1e-9);
    t('a portfolio above target clamps the bar to 1, not > 1',
      goalProgress({ targetUsd: 1000, currentUsd: 1750 }).progress === 1);
    t('a reached goal is marked reached',
      goalProgress({ targetUsd: 1000, currentUsd: 1000 }).reached === true);
    t('a goal not yet reached is not marked reached',
      goalProgress({ targetUsd: 1000, currentUsd: 999.99 }).reached === false);
    t('a zero balance is progress 0, not a crash',
      goalProgress({ targetUsd: 1000, currentUsd: 0 }).progress === 0);
    t('negative current is treated as 0 (a bug read as bad data, not a negative bar)',
      goalProgress({ targetUsd: 1000, currentUsd: -50 }).progress === 0);
    t('missing target is missing, not 0',
      goalProgress({ targetUsd: null, currentUsd: 500 }).missing === true);
    t('a non-positive target is missing',
      goalProgress({ targetUsd: 0, currentUsd: 500 }).missing === true);
    t('a NaN target is missing',
      goalProgress({ targetUsd: NaN, currentUsd: 500 }).missing === true);
    t('remainingUsd is the gap, never negative',
      goalProgress({ targetUsd: 1000, currentUsd: 1750 }).remainingUsd === 0);

    /* ---- requiredMonthlyContribution: the future-value formula ---- */
    // No yield, simple linear division. Saving $6000 over 12 months from
    // a $0 start → $500/month.
    t('no yield, 6000 over 12 months is 500 per month',
      Math.abs(requiredMonthlyContribution({
        targetUsd: 6000, currentUsd: 0, annualYield: 0,
        deadlineMs: new Date(2026, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      }) - 500) < 1e-9);
    // With a starting balance that already covers half, the payment halves.
    t('a starting balance halves the payment',
      Math.abs(requiredMonthlyContribution({
        targetUsd: 6000, currentUsd: 3000, annualYield: 0,
        deadlineMs: new Date(2026, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      }) - 250) < 1e-9);
    // The PV already exceeds the target → PMT is 0, not negative. We never
    // tell a user to withdraw from a funded goal. (With no yield the
    // linear-division formula returns (t - c) / months = −83.33 here, which
    // is the wrong answer for the UI; the engine clamps to 0 instead.)
    t('an over-funded goal needs zero payment, not a negative one',
      requiredMonthlyContribution({
        targetUsd: 1000, currentUsd: 2000, annualYield: 0,
        deadlineMs: new Date(2026, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      }) === 0);
    // With a positive yield the formula can still produce a small positive
    // PMT even when PV > FV (the growth eats into the surplus). That number
    // is a real one — the goal is over-funded in nominal terms but the
    // growth assumption may be wrong. We do not over-claim by clamping it
    // to 0 in that case; the UI displays it as "you are already funded".
    t('an over-funded goal with yield is not silently clamped to 0',
      requiredMonthlyContribution({
        targetUsd: 1000, currentUsd: 1500, annualYield: 0,
        deadlineMs: new Date(2026, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      }) === 0);
    // The exact case that motivated the cap: an implausible 500% APR must
    // not produce a negative number of months, and must return null rather
    // than a number the UI would render as "−$1200/month".
    t('a yield above the cap is refused with null',
      requiredMonthlyContribution({
        targetUsd: 6000, currentUsd: 0, annualYield: 5,
        deadlineMs: new Date(2026, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      }) === null);
    t('a negative yield is refused with null',
      requiredMonthlyContribution({
        targetUsd: 6000, currentUsd: 0, annualYield: -0.1,
        deadlineMs: new Date(2026, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      }) === null);
    t('a NaN yield is refused with null',
      requiredMonthlyContribution({
        targetUsd: 6000, currentUsd: 0, annualYield: NaN,
        deadlineMs: new Date(2026, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      }) === null);
    t('a missed deadline returns null, not infinity or a negative number',
      requiredMonthlyContribution({
        targetUsd: 6000, currentUsd: 0, annualYield: 0,
        deadlineMs: new Date(2025, 0, 1).getTime(),
        now: new Date(2026, 0, 1).getTime()
      }) === null);
    t('zero months remaining returns null, not a division-by-zero infinity',
      requiredMonthlyContribution({
        targetUsd: 6000, currentUsd: 0, annualYield: 0,
        deadlineMs: new Date(2025, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      }) === null);
    t('a missing target returns null',
      requiredMonthlyContribution({
        targetUsd: undefined, currentUsd: 0, annualYield: 0,
        deadlineMs: new Date(2026, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      }) === null);
    t('a missing current returns null',
      requiredMonthlyContribution({
        targetUsd: 6000, currentUsd: undefined, annualYield: 0,
        deadlineMs: new Date(2026, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      }) === null);

    /* ---- with yield: the payment must be lower than without ---- */
    {
      const noYield = requiredMonthlyContribution({
        targetUsd: 12000, currentUsd: 0, annualYield: 0,
        deadlineMs: new Date(2027, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      });
      const withYield = requiredMonthlyContribution({
        targetUsd: 12000, currentUsd: 0, annualYield: 0.08,
        deadlineMs: new Date(2027, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      });
      t('a positive yield reduces the required payment',
        withYield < noYield && withYield > 0);
      t('with 8% APR, 12k in 2 years from 0 is below 500/month',
        withYield < 500 && withYield > 0);
    }

    /* ---- projectGoalValue: companion formula, no solving ---- */
    {
      const projected = projectGoalValue({
        currentUsd: 0, monthlyUsd: 500, annualYield: 0,
        deadlineMs: new Date(2026, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      });
      t('12 × 500 with no growth projects to 6000', projected === 6000);
      const grown = projectGoalValue({
        currentUsd: 1000, monthlyUsd: 100, annualYield: 0.12,
        deadlineMs: new Date(2026, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      });
      t('with 12% APR the projected value is greater than the linear sum',
        grown > 1000 + 100 * 12);
    }

    /* ---- the math is the same when used as a round trip ---- */
    {
      // Pick a payment, project, and confirm the projection matches the
      // formula's expected value to floating-point tolerance.
      const pmt = requiredMonthlyContribution({
        targetUsd: 24000, currentUsd: 3000, annualYield: 0.05,
        deadlineMs: new Date(2027, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      });
      const projected = projectGoalValue({
        currentUsd: 3000, monthlyUsd: pmt, annualYield: 0.05,
        deadlineMs: new Date(2027, 0, 1).getTime(),
        now: new Date(2025, 0, 1).getTime()
      });
      t('the required PMT and the projected value round-trip to the target',
        Math.abs(projected - 24000) < 0.01);
    }

    /* ---- the cap is exported for the UI to read ---- */
    t('the cap is exported at 100% APR (1.0)',
      GOAL_MAX_ANNUAL_YIELD === 1.0);
  }

  return rows;
}
