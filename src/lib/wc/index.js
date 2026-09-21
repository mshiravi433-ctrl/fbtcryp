/**
 * WALLETCONNECT — public surface
 * ---------------------------------------------------------------------------
 * One directory owns the whole flow. The React layer (WalletContext) and the UI
 * (WalletConnectSheet) import from here, and from nowhere else, so the shape of
 * this module is the shape of the contract.
 *
 *   config.js    identity, hosts, bounds
 *   trace.js     a bounded, secret-free event ring
 *   timing.js    every bound, plus the failure classifier
 *   uri.js       pairing-URI detection, repair and encoding
 *   chain.js     honest chain-id resolution
 *   wallets.js   the promoted-wallet registry and its links
 *   handoff.js   the last metre: channel-aware delivery
 *   storage.js   what connection state is, and how it is purged
 *   relay.js     measuring the relay before promising a pairing
 *   appkit.js    the shared AppKit singleton surface
 *   session.js   the WalletConnect v2 lifecycle
 *   lease.js     «this device has a wallet until <time>» — what a refresh reads
 *   signing.js   the signing boundary: preflight, bound, honest classification
 *   health.js    the diagnostic report
 *   diagnostics.js  the one verdict: eight named causes, one of them OK
 *
 * `embedded.js` — the email/social "embedded wallet" — is gone: that surface
 * was retired on 2026-09-18 because it needed a SECOND AppKit instance sharing
 * the controllers (and the one `<w3m-modal>`) with WalletConnect, which is how
 * an email tap came to open the wallet grid and how a WalletConnect cycle left
 * the shared state describing a dead wallet. storage.js keeps the purge of the
 * keys it left behind.
 */

export {
  PAIRING_TTL_MS,
  RELAY_URLS,
  TIMEOUT,
  WC_ALLOWED_ORIGINS,
  WC_ANDROID_APP_ID,
  WC_PROJECT_ID,
  walletIdentityFacts,
  walletIdentityUrl,
  wcMetadata
} from './config.js';

export {
  TRACE_STORAGE_KEY,
  reviveEntry,
  wcEvent,
  wcEventDetail,
  wcTraceHydrate,
  wcTracePersist,
  wcTraceReset,
  wcTraceSnapshot
} from './trace.js';

export {
  cancelSwitch,
  classifyConnectError,
  isModalError,
  isRelayError,
  pauseBound,
  sleep,
  withTimeout
} from './timing.js';

export {
  carriesPairingUri,
  decodePairingPayload,
  isPairingUri,
  looksLikePairingUri,
  pairingUriFromLink,
  repairPairingInLink,
  repairPairingUri,
  uriRoundTrips
} from './uri.js';

export { chainFromSession, parseChainId } from './chain.js';

export {
  MOBILE_WALLETS,
  androidIntentLink,
  appKitCustomWallets,
  forgetTappedWallet,
  lastTappedWallet,
  linkBase,
  rememberedMobileWallet,
  rememberTappedWallet,
  walletByKey,
  walletForObject,
  walletForUrl,
  walletLink,
  walletLinks,
  walletLogo
} from './wallets.js';

export {
  bringWalletToFront,
  closeHandoffTabs,
  decideWalletOpen,
  handOffChannel,
  handoffFacts,
  installWalletOpenBridge,
  isAndroidView,
  isIntentCapableBrowser,
  isIOSView,
  isWebViewEmbed,
  onWalletHandoff,
  openWalletHandoff,
  openWalletLink,
  openWalletLinkSync,
  walletForegroundLinks
} from './handoff.js';

export {
  APPKIT_CONNECTION_KEYS,
  DEEPLINK_CHOICE_KEY,
  EMBEDDED_WALLET_PREFIX,
  LEGACY_EMBEDDED_MARKER_KEY,
  WC_PREFIX,
  hasStoredSession,
  isConnectionKey,
  listConnectionKeys,
  listEmbeddedWalletKeys,
  purgeConnectionKeys,
  purgeEmbeddedWalletKeys
} from './storage.js';

export {
  clearRelayCache,
  isRelayBlocked,
  measureRelay,
  probeReachable,
  probeRelay,
  relayVerdict
} from './relay.js';

export {
  applyWalletSurface,
  readSharedConnectionFacts,
  resetPairingState,
  setLivePairingUri
} from './appkit.js';

export { createWcSession } from './session.js';

export {
  WALLET_LEASE_DEFAULT_MINUTES,
  WALLET_LEASE_KEY,
  WALLET_LEASE_MODES,
  WALLET_RESTORE_BACKOFF,
  WALLET_SESSION_CHOICES,
  clearWalletLease,
  isLeaseAddress,
  readWalletLease,
  walletLeaseMinutes,
  walletLeaseRemainingMinutes,
  walletRestoreDelay,
  walletRestorePlan,
  writeWalletLease
} from './lease.js';

export {
  collectWalletHealth,
  configProbeUrl,
  isOriginAllowed,
  originsProbeUrl,
  storageFacts
} from './health.js';

export {
  WC_FLOW_STATES,
  WC_FLOW_TERMINAL,
  WC_FLOW_TRANSITIONS,
  wcFlowState,
  wcFlowTransitionAllowed
} from './flowState.js';

export {
  WC_DIAGNOSIS,
  WC_DIAGNOSIS_OWNER,
  WC_DIAGNOSIS_SENTENCE,
  classifyWalletConnectDiagnosis,
  collectWalletConnectDiagnosis,
  diagnosisLines,
  diagnosisStatuses,
  sdkConfigFacts
} from './diagnostics.js';

export {
  VERIFY_ATTESTATION_TIMEOUT_MS,
  VERIFY_SERVER,
  VERIFY_SERVER_V3,
  attestationUrl,
  decodeAttestation,
  predictVerifyVerdict,
  probeVerifyAttestation,
  probeVerifyReachability,
  randomAttestationId,
  reownDashboardUrl,
  warmVerifyEnclave
} from './verify.js';

export {
  SIGN_ERRORS,
  SIGN_METHODS,
  classifySignError,
  guardEip1193,
  isSigningMethod,
  preflightSignRequest,
  sessionCoverage
} from './signing.js';
