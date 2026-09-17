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

export { wcEvent, wcTraceReset, wcTraceSnapshot } from './trace.js';

export {
  cancelSwitch,
  classifyConnectError,
  isModalError,
  isRelayError,
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
  installWalletOpenBridge,
  isAndroidView,
  openWalletLink
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

export { applyWalletSurface, resetPairingState, setLivePairingUri } from './appkit.js';

export { createWcSession } from './session.js';

export {
  EMAIL_MARKER_KEY,
  EMAIL_RESTORE_WINDOW_MS,
  SOCIAL_PROVIDERS,
  awaitAccount,
  buildNetworks,
  emailOptions,
  forget as forgetEmbeddedWallet,
  getAppKit,
  hasMarker as hasEmailMarker,
  open as openEmbeddedWallet,
  rearmSdkLoginMarker,
  restore as restoreEmbeddedWallet,
  rollback as rollbackEmailMarker,
  setMarker as setEmailMarker
} from './embedded.js';

export {
  collectWalletHealth,
  configProbeUrl,
  filterSocialsByPlatform,
  isOriginAllowed,
  originsProbeUrl,
  platformFlags,
  storageFacts,
  summarizeProjectConfig
} from './health.js';
