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
 *   embedded.js  email & social (the secure embedded wallet)
 *   health.js    the diagnostic report
 */

export {
  PAIRING_TTL_MS,
  RELAY_URLS,
  SECURE_SITE_URL,
  TIMEOUT,
  WC_PROJECT_ID,
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
  rememberTappedWallet,
  walletByKey,
  walletForObject,
  walletForUrl,
  walletLink,
  walletLinks,
  walletLogo
} from './wallets.js';

export {
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
  openWalletLinkSync
} from './handoff.js';

export {
  APPKIT_CONNECTION_KEYS,
  DEEPLINK_CHOICE_KEY,
  WC_PREFIX,
  hasStoredSession,
  isConnectionKey,
  listConnectionKeys,
  purgeConnectionKeys
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
  assertEmailNetwork,
  assertEmailRouting,
  clearPhantomAuthConnection,
  readSharedConnectionFacts,
  resetPairingState,
  resetSharedConnectionState,
  setLivePairingUri
} from './appkit.js';

export { createWcSession } from './session.js';

export {
  EMAIL_FRAME_CHAIN_IDS,
  EMAIL_MARKER_KEY,
  EMAIL_RESTORE_WINDOW_MS,
  SIGN_PROBE_MESSAGE,
  SOCIAL_PROVIDERS,
  authConnectorProvider,
  awaitAccount,
  buildNetworks,
  classifyEmailMarker,
  clearFrameChainResidue,
  clearStaleEmailState,
  emailOptions,
  embeddedAccountSnapshot,
  forget as forgetEmbeddedWallet,
  getAppKit,
  hasMarker as hasEmailMarker,
  isEmailFrameChain,
  lastProviderProbeError,
  open as openEmbeddedWallet,
  openSurfaceDetail,
  probeSigning,
  rearmSdkLoginMarker,
  resetSigningState,
  restore as restoreEmbeddedWallet,
  rollback as rollbackEmailMarker,
  sdkLoginMarkerPresent,
  sdkSessionFacts,
  setMarker as setEmailMarker,
  signingDeniedByUser,
  switchEmbeddedNetwork
} from './embedded.js';

export {
  collectWalletHealth,
  configProbeUrl,
  filterSocialsByPlatform,
  isOriginAllowed,
  originsProbeUrl,
  platformFlags,
  storageFacts,
  summarizeProjectConfig,
  usageProbeUrl
} from './health.js';
