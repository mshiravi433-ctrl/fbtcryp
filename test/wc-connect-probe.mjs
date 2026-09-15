/**
 * WALLETCONNECT BEHAVIOR PROBE
 * ---------------------------------------------------------------------------
 * Tests the connect/disconnect logic in WalletContext.jsx without requiring a
 * live WalletConnect relay. Covers the double-tap guard (wcInitingRef), the
 * disconnect cleanup, and the project-id fallback shape.
 *
 * The full connect flow is not exercised here — it requires EthereumProvider
 * from @walletconnect/ethereum-provider — but the guards that prevent
 * duplicate sessions and ensure clean disconnects are structural.
 */
import { readFileSync } from 'node:fs';

const walletSrc = readFileSync('src/context/WalletContext.jsx', 'utf8');

/* Strip comments BEFORE searching: WalletContext.jsx documents the very bugs
   these checks guard against, and a check that matches its own prose is no
   check at all (this suite has tripped on that repeatedly). */
const code = walletSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

export default function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---- 1. double-tap guard ---- */
  // The wcInitingRef guard prevents EthereumProvider.init() from running
  // twice when the user taps Connect rapidly.
  t('wcInitingRef guards against double init',
    /if \(wcInitingRef\.current\) return false;/.test(walletSrc));
  /* init() now lives inside initWcProvider (the relay-failover helper); the
     guard must still be set before the flow reaches any init attempt. */
  t('wcInitingRef is set BEFORE the init() call',
    code.indexOf('wcInitingRef.current = true') < code.indexOf('await initWcProvider('));
  t('wcInitingRef is reset in the finally block',
    /finally\s*\{[\s\S]{0,100}wcInitingRef\.current = false/.test(code));

  /* ---- 2. stale session cleanup before init ---- */
  // If there's already a connected WalletConnect instance, it must be
  // disconnected first to avoid two sessions fighting for the same state.
  t('a stale WC session is disconnected before re-init',
    /if \(wcRef\.current\) \{[\s\S]{0,200}wcRef\.current\.disconnect\(\)/.test(code));

  /* ---- 3. disconnect() cleans up both listeners and refs ---- */
  // The disconnect function must null all refs and clear all state.
  const disconnectBlock = code.slice(
    code.indexOf('const disconnect ='),
    code.indexOf('};\n', code.indexOf('const disconnect ='))
  );
  t('disconnect clears wcListenersRef', /wcListenersRef\.current\s*=\s*null/.test(disconnectBlock));
  t('disconnect clears wcRef', /wcRef\.current\s*=\s*null/.test(disconnectBlock));
  t('disconnect clears eip1193Ref', /eip1193Ref\.current\s*=\s*null/.test(disconnectBlock));
  t('disconnect clears signerRef', /signerRef\.current\s*=\s*null/.test(disconnectBlock));
  t('disconnect resets mode to null', /setMode\(null\)/.test(disconnectBlock));
  t('disconnect resets address to null', /setAddress\(null\)/.test(disconnectBlock));
  t('disconnect resets chainId to null', /setChainId\(null\)/.test(disconnectBlock));
  t('disconnect resets nativeBalance to null', /setNativeBalance\(null\)/.test(disconnectBlock));
  t('disconnect resets locked to false', /setLocked\(false\)/.test(disconnectBlock));
  t('disconnect resets error to null', /setError\(null\)/.test(disconnectBlock));

  /* ---- 4. disconnectRef forwarding ensures listener callbacks stay current ---- */
  t('disconnectRef is kept in sync with the latest disconnect implementation',
    /disconnectRef\.current = disconnect;/.test(code));

  /* ---- 5. WC listeners are attached AFTER connect, exactly once, and are
     scoped to THEIR provider instance ----
     The old wiring attached four handlers inline; the new one centralises in
     attachWcListeners() and — the part that stops "Trust disconnects itself
     later" — every handler ignores events from a stale provider instance. */
  t('attachWcListeners exists as the single registration point',
    /const attachWcListeners = useCallback/.test(code));
  t('listeners are attached only after connect() succeeds',
    code.indexOf('attachWcListeners(wc)') > code.indexOf('await wc.connect()'));
  t('every WC handler is instance-scoped (stale providers cannot wipe state)',
    (code.match(/wcRef\.current !== wc/g) || []).length >= 5);
  t('session_expire is listened to (a real expiry, not a guessed one)',
    /'session_expire', onSessionExpire/.test(code));
  t('relay drop/reconnect are traced, never treated as teardown',
    /'relayer_disconnect', onRelayDisconnect/.test(code) && /'relayer_connect', onRelayConnect/.test(code));

  /* ---- 5b. the empty accountsChanged policy ----
     For WalletConnect an empty accountsChanged is a SPURIOUS event some
     wallets (Trust) emit mid-chain-switch; it used to call disconnect() and
     is exactly the "disconnects by itself minutes later" report. Only the
     injected transport keeps the EIP-1193 semantics ([] = revoked). */
  const attachBlock = code.slice(
    code.indexOf('const attachWcListeners'),
    code.indexOf('return () => {', code.indexOf('const attachWcListeners'))
  );
  t('WC accountsChanged no longer tears the session down on a transient empty array',
    !attachBlock.includes(': disconnectRef.current()')
      && !/accs\?\.\[0\] \? setAddress\(accs\[0\]\) : disconnectRef/.test(attachBlock));
  t('WC accountsChanged still updates the address when one arrives',
    attachBlock.includes('setAddress(accs[0])'));
  const injectedAttach = code.slice(
    code.indexOf('const attachInjectedListeners'),
    code.indexOf('};', code.indexOf('const attachInjectedListeners'))
  );
  t('injected accountsChanged keeps real EIP-1193 semantics ([] = revoked)',
    /accs\?\.length \? setAddress\(accs\[0\]\) : disconnectRef\.current\(\)/.test(injectedAttach));

  /* ---- 6. the projectId is the source constant, never an env override ---- */
  t('the WC_PROJECT_ID constant is set to the official project ID',
    code.includes("const WC_PROJECT_ID = '8e36eccabebf5a4567f4e974fafd6b20'"));
  t('no env var can override the project ID (stale Vercel/CI copies shipped retired projects)',
    !/VITE_WALLETCONNECT_PROJECT_ID/.test(code));

  /* ---- 7. mobile deep links are wallet-agnostic (no MetaMask hardcode) ---- */
  // Historical bug: on iOS a display_uri handler hard-navigated the page to
  // metamask.app.link, which forced every iOS user into MetaMask (Trust and
  // Rainbow could never be chosen) and navigated the page away mid-pairing.
  // The modal (showQrModal: true) must own deep links for every wallet.
  t('no display_uri handler navigates the page to MetaMask',
    !/window\.location\.href\s*=/.test(code));
  /*
   * `wc.connect()` is wrapped in a bounded timeout (withTimeout) so an
   * unreachable relay cannot spin forever — see WC_CONNECT_TIMEOUT_MS. The
   * invariant that matters is unchanged: exactly one call, no iOS-only
   * MetaMask branch.
   */
  t('connect() runs exactly once (no iOS-only MetaMask branch)',
    (code.match(/wc\.connect\(\)/g) || []).length === 1);
  /* The bound is now TWO-PHASE and raced with the user's cancel switch: a
     relay that never issues a URI fails in WC_CONNECT_TIMEOUT_MS, while a
     human holding a phone gets the pairing's own lifetime. A flat 20s over
     the whole connect used to abort healthy pairings and report them as an
     unreachable relay. */
  t('the connect call is bounded by a timeout (no infinite spin on a blocked relay)',
    /armBound\(WC_CONNECT_TIMEOUT_MS, 'WC_CONNECT_TIMEOUT'\)/.test(code)
      && /await Promise\.race\(\[wc\.connect\(\), cancelled, bound\]\)/.test(code));
  t('…and once a pairing URI exists the wait belongs to the user, not to the 20s fuse',
    /armBound\(WC_PAIRING_TTL_MS, 'WC_PAIRING_EXPIRED'\)/.test(code)
      && code.indexOf("armBound(WC_PAIRING_TTL_MS") < code.indexOf('wc.connect()'));
  /*
   * The promoted wallet table now lives in src/lib/wcWallets.js — one source
   * for both the legacy modal shape and the AppKit shape — so the checks
   * below read it there instead of trusting an inlined copy.
   */
  const walletTable = readFileSync('src/lib/wcWallets.js', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  t('the promoted wallet list includes Trust, MetaMask and Uniswap',
    /name: 'Trust Wallet'/.test(walletTable)
      && /name: 'MetaMask'/.test(walletTable)
      && /name: 'Uniswap Wallet'/.test(walletTable));
  t('the promoted wallet list supplies Trust Wallet\'s documented universal host',
    /universal: 'https:\/\/link\.trustwallet\.com\/'/.test(walletTable));
  /*
   * THE "INVALID URL" FIX. AppKit reads `mobile_link` / `link_mode` — the
   * explorer field names — and never `links: { native, universal }`. An entry
   * with only `links` has no deep link at all, and the link it did build was
   * the `trust://` custom scheme, which a WebView (the APK, Telegram, Trust's
   * own browser) cannot navigate to and answers with "Invalid URL".
   */
  t('the links handed to AppKit carry mobile_link (the field it reads)',
    /mobile_link:/.test(walletTable));
  t('the links handed to AppKit carry link_mode (without it there is no https link)',
    /link_mode:/.test(walletTable));
  t('every promoted wallet ships an https universal link, not only a custom scheme',
    (walletTable.match(/universal: 'https:\/\//g) || []).length >= 3);
  t('WalletContext consumes the shared wallet table instead of inlining links',
    /mobileWallets: legacyModalWallets\(\)/.test(code)
      /* …with the project id, which is what buys each customWallet its brand
         logo (`image_url`); without it AppKit draws a generic grey glyph for
         every promoted wallet — half of why the list read as broken. */
      && /customWallets: appKitCustomWallets\(WC_PROJECT_ID\)/.test(code));
  t('the modal prefers native links so the pairing payload bypasses HTTPS redirectors',
    /experimental_preferUniversalLinks: false/.test(code));

  /* ---- 8. the modal never depends on the explorer API for deep links ---- */
  t('the modal disables the explorer wallet list', /explorerExcludedWalletIds: 'ALL'/.test(code));
  /*
   * Previously iOS-only. Android was left depending on api.web3modal.org to
   * resolve wallet deep links at pairing time — a third-party network call
   * that Iranian networks filtering WalletConnect infrastructure can also
   * block, producing "the wallet list shows but tapping does nothing".
   * Supplying the links ourselves on EVERY platform removes that dependency.
   */
  t('mobile wallet deep links are supplied unconditionally (not gated behind an iOS check)',
    /mobileWallets: legacyModalWallets\(\)/.test(code) && !/\.\.\.\(ios\s*\?/.test(code));
  /*
   * The promoted list must not come from the explorer API either: with
   * `explorerRecommendedWalletIds` left set, the same wallets were rendered
   * from the API response where reachable and dropped where it is filtered.
   */
  t('the promoted list does not depend on the explorer API response',
    /explorerRecommendedWalletIds: 'NONE'/.test(code));
  /*
   * And the links must be applied to the modal instance BEFORE connect()
   * opens it — the first tap inside it has to find a real deep link.
   */
  t('the deep links are applied to the modal before connect() runs',
    code.indexOf('await applyAppKitWalletLinks(wc)') > code.indexOf('wc = await initWcProvider(')
      && code.indexOf('await applyAppKitWalletLinks(wc)') < code.indexOf('wc.connect()'));

  /* ---- 9. session restore: the "Trust disconnected me" fix ----
     A persisted WC session used to be picked up only from the Connect
     button. Anything that restarted the WebView — refresh, Android resuming
     a killed process, returning from the wallet's approval screen — left a
     LIVE session on disk and a UI showing "not connected", which users read
     as the wallet dropping them. The restore must be localStorage-probed
     (no relay socket for users who never connected), single-flighted with
     the SAME ref as connect (never two SignClients), and must never open
     the QR modal by itself. */
  /* NB: restored from the UNSTRIPPED source — the line-comment stripper above
     would otherwise eat '//session' inside the storage-key string literal. */
  const restoreBlock = walletSrc.slice(
    walletSrc.indexOf('const restoreWcSession'),
    walletSrc.indexOf('const attachLocal', walletSrc.indexOf('const restoreWcSession'))
  );
  t('restoreWcSession exists', restoreBlock.length > 200);
  t('restore probes the persisted session keys BEFORE paying for init()',
    restoreBlock.includes('wc@2:client:') && restoreBlock.includes('//session')
      && restoreBlock.indexOf('localStorage') < restoreBlock.indexOf('await initWcProvider('));
  t('the probe tracks the storage-prefix, not a hardcoded store schema version',
    restoreBlock.includes("key.startsWith('wc@2:client:')"));
  t('restore bails out when no session is on disk', /!hasStoredSession\) return false/.test(restoreBlock));
  t('restore is single-flighted through the same guard as connect()',
    restoreBlock.includes('wcInitingRef.current = true') && restoreBlock.includes('wcInitingRef.current = false'));
  t('restore NEVER initiates a pairing (no connect() call inside it)',
    !/wc\.connect\(/.test(restoreBlock));
  t('restore re-attaches through the identical init config as connect (no identity drift)',
    /* Same builder, same metadata/chains/relay — only the MODAL differs: a
       silent restore never opens a pairing screen, so it must not pay for
       `createAppKit()` on first paint. */
    restoreBlock.includes('buildWcInitConfig(false)'));
  t('restore registers the same exactly-once instance-scoped listeners',
    restoreBlock.includes('attachWcListeners(wc)'));
  t('restore runs on mount and on foreground return', /visibilitychange/.test(code)
    && /restoreWcSession/.test(code));

  /* ---- 10. the modal-cancel is NOT an error ---- */
  t('closing the AppKit modal is a cancellation (USER_REJECTED), not a scary CONNECT_FAILED',
    /\/connection request reset\/i\.test\(msg\)[\s\S]{0,200}?setError\('USER_REJECTED'\)/.test(code));

  /* ---- 11. refresh guards around pairing ---- */
  t('the pairing attempt holds the refresh guard for its whole life',
    code.indexOf("holdRefreshGuard('wc-connect')") < code.indexOf('wc.connect()')
      && /connectGuard\.release\(\)/.test(code));

  /* ---- 12. the trace carries no secrets ---- */
  const trace = readFileSync('src/lib/wcTrace.js', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  t('the WC trace never stores URIs, topics, accounts or keys',
    !/symKey|pairingTopic|\buri\b|accounts|address/.test(trace));
  const wcCalls = code.match(/wcEvent\(['"][a-z_]+['"][^;]*\)/g) || [];
  t('every traced event is a name (plus a number/boolean fact), nothing sensitive',
    wcCalls.length >= 5 && wcCalls.every((c) =>
      /^wcEvent\(['"][a-z_]+['"](, (\d+|true|false|Number\([a-z]+\)))?\)$/.test(c)));

  /* ---- 13. TWO pairing surfaces, never on screen at once ----
     The SDK modal is the primary surface again; this sheet is what the user
     gets when that modal cannot be built. While the modal owns the screen the
     sheet withdraws — two stacked modals means two blurred backdrops and two
     scroll locks, which on the Android WebView composited into the reported
     "grey box flickering like a fluorescent tube". */
  const sheet = readFileSync('src/components/WalletConnectSheet.jsx', 'utf8');
  t('the sheet yields to the SDK modal while it owns the pairing',
    /<Sheet open=\{open && !wallet\.wcModalActive\}/.test(sheet));
  t('…and is still the surface when there is no modal to yield to',
    /wallet\.wcPairUri/.test(sheet) && /view === 'pair'/.test(sheet));
  t('the sheet returns to the chooser with the named error when pairing fails',
    /startWalletConnect[\s\S]{0,700}\.then\(\(ok\) =>[\s\S]{0,200}setView\('choose'\)/.test(sheet));
  t('the pairing URI is read from the wallet context, not from a modal',
    /wallet\.wcPairUri/.test(sheet));

  /* ---- 14. the metadata repair targets the REAL metadata object ----
     THE FAKE "SECURITY RISK" MESSAGE. `populateAppMetadata()` (verified in the
     installed @walletconnect/utils@2.23.10) OVERWRITES `metadata.url` with
     window.location.origin whenever the hosts differ — so inside the APK the
     dapp introduces itself to every wallet as `https://localhost`, which is
     exactly what Trust Wallet's security scanner flags and MetaMask answers
     with "Invalid URL".

     WHERE THAT METADATA LIVES (verified in the installed packages, and against
     the belief this file used to encode): UniversalProvider.createClient()
     does `this.client = SignClient.init(...)`, and the SignClient constructor
     does `this.metadata = populateAppMetadata(...)`. The engine serialises the
     proposal from `this.client.metadata`. So `wc.signer.client` IS the sign
     client — it is NOT the Core, and it does have `metadata`. The repair must
     therefore write `wc.signer.client.metadata` FIRST; the UniversalProvider
     branch is the defensive one, and the reported result must come from the
     object the engine actually reads (an earlier revision reported failure
     from a reference that never existed, so the trace cried wolf on every
     connect). */
  const repairStart = walletSrc.indexOf('const repairSignClientMetadata');
  const repairBlock = walletSrc.slice(
    repairStart,
    walletSrc.indexOf('}, [', repairStart)
  );
  t('the metadata repair targets the SignClient (wc.signer.client), which the engine reads',
    /wc\?\.signer\?\.client \?\? wc\?\.signer/.test(repairBlock));
  t('the repair also rewrites the provider\'s own copy of the metadata',
    /wc\?\.rpc\?\.metadata/.test(repairBlock));
  t('the UniversalProvider branch survives as a defensive fallback for a future SDK shape',
    /wc\?\.signer\?\.metadata/.test(repairBlock));
  t('the repair writes the public url, never the WebView origin',
    /wcPublicMetadata\(\)/.test(repairBlock) && !/window\.location\.origin/.test(repairBlock));
  t('the repair verifies its own result against the object it just wrote',
    /return Boolean\(targets\.length\) && signClient\?\.metadata\?\.url === url/.test(repairBlock)
      && /metadata_repaired/.test(walletSrc) && /metadata_repair_failed/.test(walletSrc));

  /* ---- 15. disconnect / forget leave a CLEAN SLATE ----
     The next Connect must behave like the very first one: no stale session,
     no stored mobile deep-link choice, no recent-wallet residue. */
  t('disconnect purges the SDK/AppKit storage artifacts', /purgeWcStorage\(\)/.test(disconnectBlock));
  t('the WC disconnect during teardown is bounded (a dead relay cannot stall the UI)',
    /WC_TEARDOWN_TIMEOUT/.test(disconnectBlock));
  const forgetBlock = code.slice(
    code.indexOf('const forgetLocalWallet'),
    code.indexOf('};', code.indexOf('const forgetLocalWallet'))
  );
  t('forgetLocalWallet delegates to the same full disconnect teardown',
    forgetBlock.includes('clearVault()') && forgetBlock.includes('disconnectRef.current()'));
  t('an explicit Connect purges storage BEFORE init (never resurrects a stale session)',
    code.indexOf('purgeWcStorage()') < code.indexOf('await initWcProvider(')
      && code.indexOf('purgeWcStorage()') > code.indexOf('const connectWalletConnect'));
  t('an explicit Connect drops a session resurrected by init() (fresh pairing, modal can open)',
    /if \(wc\.session\) \{[\s\S]{0,400}wc\.disconnect\(\)/.test(code));
  t('entering local mode releases a live WalletConnect session (no dual-connection state leak)',
    /void releaseWc\(\);/.test(code) && /const releaseWc = useCallback/.test(code));

  /* ---- 16. the connected chain comes from the SESSION, not the SDK's lie ---- */
  t('connect() resolves the honest chain from the approved session',
    /chainFromWcSession\(wc\)/.test(code)
      && code.indexOf('chainFromWcSession(wc)') < code.indexOf('setChainId(cid)'));
  t('the SDK internal chainId is aligned with the real chain (request namespace matches the session)',
    /wc\.chainId = cid/.test(code));
  t('restore() resolves the chain the same way (no drift between the two paths)',
    restoreBlock.includes('chainFromWcSession(wc)') && restoreBlock.includes('setChainId(cid)'));
  t('chainChanged events are parsed defensively (hex, CAIP-2 and numeric spellings)',
    /parseChainId\(cid\)/.test(code));

  /* ---- 17. restore never hijacks a wallet that attached while it was in flight ---- */
  t('restore re-checks for an attached wallet before committing state',
    /if \(addressRef\.current\) \{[\s\S]{0,300}restore_skipped_local/.test(walletSrc));
  t('a local vault on disk wins the cold start (no restore overwrite of the in-app wallet)',
    /if \(!loadVault\(\)\) \{\s*\/\*[\s\S]{0,400}void restoreWcSession\(\{ announce: false \}\);/.test(walletSrc));

  return rows;
}