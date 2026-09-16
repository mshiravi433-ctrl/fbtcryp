/**
 * EMAIL & SOCIAL LOGIN PROBE
 * ---------------------------------------------------------------------------
 * The feature and its isolation contract live in src/lib/emailSocialWallet.js
 * (the header explains why a second AppKit instance is safe only under
 * feature re-assertion). This probe measures that contract on the real
 * @reown packages — including creating the actual instance inside jsdom
 * against the live @reown/appkit@1.8.19 singletons — plus the wiring rules
 * in WalletContext / WalletConnectSheet that keep it from colliding with
 * the WalletConnect surface:
 *
 *   1. Pure options: email+socials on, every competing surface off,
 *      manualWCControl absent, networks built from OUR chain registry.
 *   2. The shared-singleton truce, for real: flatten the features the way
 *      the WalletConnect surface does, reassert, and read the restored
 *      state out of OptionsController.
 *   3. Boot marker round-trip on a fake Storage (providers never touch it),
 *      plus the claim/rollback half of the redirect fix: a cancel or a failed
 *      attach hands the marker back, a session AppKit still holds does not.
 *   4. Wiring: WalletConnect surface flattens features before its opens,
 *      connect/disconnect/restore call the right functions, the marker is
 *      claimed BEFORE the modal opens (so a returning redirect page restores),
 *      every self-clearing boundary still exists to undo a claim that led
 *      nowhere, the sheet withdraws under both modal flags, locale keys exist
 *      in all three languages, and the package pins that keep ONE copy of
 *      @reown/*.
 */
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { EVM_CHAINS, DEFAULT_CHAIN } from '../src/lib/chains.js';
import {
  EMAIL_RESTORE_WINDOW_MS,
  EMAIL_SOCIAL_FLAG_KEY,
  SDK_LOGIN_USED_KEY,
  SDK_LOGIN_USED_VALUE,
  SOCIAL_PROVIDERS,
  buildEmailNetworks,
  clearEmailSocialSession,
  emailSocialOptions,
  getEmailSocialAppKit,
  hasEmailSocialMarker,
  readSdkLoginMarker,
  rearmSdkLoginMarker,
  reassertEmailFeatures,
  rollbackEmailSocialMarker,
  setEmailSocialMarker
} from '../src/lib/emailSocialWallet.js';

const PROJECT_ID = '8e36eccabebf5a4567f4e974fafd6b20';
const APPKIT_SOCIAL_UNION = ['google', 'github', 'apple', 'facebook', 'x', 'discord', 'farcaster'];

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Minimal DOM for the real createAppKit(): jsdom globals, no WebSocket, so
    the adapter's universal-provider init fails fast into its internal catch
    instead of dialling the real relay from a test process.

    THE GLOBALS ARE DELIBERATELY NEVER RESTORED. createAppKit's initialize()
    continues asynchronously after it returns (project-config fetch, auth
    frame creation, timers) and touches document/window long after — tearing
    the globals down crashes the process from a microtask nobody awaited
    (measured: W3mFrame's `document.createElement('iframe')` fired after
    restore and killed the probe). Keeping the environment for the rest of
    the process is why run.mjs registers this probe LAST: nothing after it
    can be surprised by a window that suddenly exists. The project-config
    fetch to api.web3modal.org may also be unreachable from a CI sandbox —
    AppKit degrades that path internally (features/remoteFeatures stay
    local), so an ECONNRESET in the noise below is not a failure. */
let domInstalled = false;
function installDom() {
  if (domInstalled) return;
  domInstalled = true;
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://fbtswap.ir/',
    pretendToBeVisual: true
  });
  const w = dom.window;
  globalThis.window = w;
  globalThis.document = w.document;
  for (const key of Object.getOwnPropertyNames(w)) {
    if (!(key in globalThis)) {
      try { globalThis[key] = w[key]; } catch { /* read-only globals stay */ }
    }
  }
  Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: w.localStorage, configurable: true });
  delete globalThis.WebSocket;
}

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---- 1. pure option & network builders -------------------------------- */
  const options = emailSocialOptions(PROJECT_ID, { name: 'FBT Swap' });
  t('the options offer email + every social AppKit knows, and nothing else',
    options.features.email === true
      && options.features.emailShowWallets === false
      && Array.isArray(options.features.socials)
      && options.features.socials.length === SOCIAL_PROVIDERS.length
      && SOCIAL_PROVIDERS.every((p) => APPKIT_SOCIAL_UNION.includes(p)));
  t('every surface the app already owns is off in the email instance',
    options.enableInjected === false
      && options.enableCoinbase === false
      && options.enableEIP6963 === false
      && options.enableWalletConnect === false);
  t('manualWCControl is never set — connections here belong to AppKit',
    !('manualWCControl' in options));
  t('the default network leads and the project id + metadata pass through',
    options.defaultNetwork === options.networks[0]
      && options.projectId === PROJECT_ID
      && options.metadata?.name === 'FBT Swap'
      && options.themeMode === 'dark');

  const nets = buildEmailNetworks();
  t('every chain the app supports is a network, DEFAULT_CHAIN first',
    nets.length === Object.keys(EVM_CHAINS).length
      && nets[0].id === DEFAULT_CHAIN
      && nets.every((n) => n.caipNetworkId === `eip155:${n.id}` && n.chainNamespace === 'eip155'));
  t('each network inherits the chain registry RPC order and explorer',
    nets.every((n) => {
      const cfg = EVM_CHAINS[n.id];
      return n.rpcUrls.default.http[0] === cfg.rpc[0]
        && n.nativeCurrency.symbol === cfg.native.symbol
        && n.nativeCurrency.decimals === cfg.native.decimals
        && (!cfg.explorer || n.blockExplorers.default.url === cfg.explorer);
    }));

  /* ---- 2. boot marker on a fake Storage --------------------------------- */
  {
    const map = new Map();
    const fakeStorage = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k)
    };
    t('the marker round-trips through set → has → clear',
      hasEmailSocialMarker(fakeStorage) === false
        && setEmailSocialMarker(true, fakeStorage) === true
        && hasEmailSocialMarker(fakeStorage) === true
        && setEmailSocialMarker(false, fakeStorage) === true
        && hasEmailSocialMarker(fakeStorage) === false
        && map.get(EMAIL_SOCIAL_FLAG_KEY) === undefined);
    setEmailSocialMarker(true, fakeStorage);
    await clearEmailSocialSession({ storage: fakeStorage });
    t('clearEmailSocialSession forgets the marker even with no live instance',
      hasEmailSocialMarker(fakeStorage) === false);

    /* THE CLAIM/ROLLBACK HALF OF THE REDIRECT FIX: connectEmailSocial() now
       writes the marker before the modal opens, so an attempt that ends with
       nothing to restore has to hand it back — and rollbackEmailSocialMarker
       is honest about what "nothing" means: an instance still holding a
       session keeps the claim (that is precisely the case the redirect bug
       produced), while a definitively disconnected one clears it. */
    const connected = {
      getIsConnectedState: () => true,
      getAddress: () => '0x1111111111111111111111111111111111111111'
    };
    const disconnected = { getIsConnectedState: () => false, getAddress: () => '' };
    const answering = (m) => {
      setEmailSocialMarker(true, fakeStorage);
      const cleared = rollbackEmailSocialMarker(m, fakeStorage);
      return cleared === !hasEmailSocialMarker(fakeStorage);
    };
    t('rollback keeps a claim AppKit can still honour, and forgets one it cannot',
      answering(connected) && answering(disconnected));
    t('a modal that throws while being asked counts as disconnected (never trust a lie)',
      answering({
        getIsConnectedState: () => { throw new Error('frame gone'); },
        getAddress: () => '0x1'
      }));
    t('no instance at all still clears the claim (a marker nobody can restore is a loop)',
      answering(null));

    /*
     * THE SDK'S OWN LOGIN MARKER, MEASURED — AND WHY WE RE-ARM IT.
     * `W3mFrameProvider`'s CONSTRUCTOR only creates the secure-site iframe
     * `if (getLoginEmailUsed())`, and `deleteAuthLoginCache()` — reached from
     * `isConnected()`'s not-connected branch AND from its catch — removes that
     * key. A blocked/slow wallet frame therefore deletes the dApp's own record
     * of the login, and every later boot short-circuits to "not connected"
     * without asking anybody: the wallet is unreachable even though the
     * session inside the frame is intact. Our marker is the durable copy, so
     * it hands the key back before the instance is built.
     */
    {
      const store = new Map();
      const storage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
      };
      t('nothing is written when our own marker is absent',
        rearmSdkLoginMarker(storage) === 'not_marked'
          && readSdkLoginMarker(storage) === '');
      setEmailSocialMarker(true, storage);
      t('the SDK key is handed back with the SDK’s own value once an attempt is marked',
        rearmSdkLoginMarker(storage) === 'rearmed'
          && readSdkLoginMarker(storage) === SDK_LOGIN_USED_VALUE
          && SDK_LOGIN_USED_KEY === '@appkit-wallet/EMAIL_LOGIN_USED_KEY');
      t('an SDK marker that is already there is never rewritten',
        rearmSdkLoginMarker(storage) === 'present');
      /* The measured sequence that produced the report: a blocked frame wipes
         the SDK key while our marker survives. */
      storage.removeItem(SDK_LOGIN_USED_KEY);
      t('a wiped SDK marker is re-armed from our surviving claim',
        readSdkLoginMarker(storage) === ''
          && rearmSdkLoginMarker(storage) === 'rearmed'
          && readSdkLoginMarker(storage) === SDK_LOGIN_USED_VALUE);
    }
  }

  /* ---- 3. real createAppKit + the shared-singleton truce ---------------- */
  installDom();
  {
    const modal = await getEmailSocialAppKit(PROJECT_ID, {
      name: 'FBT Swap',
      description: 'Non-custodial decentralized exchange',
      url: 'https://fbtswap.ir',
      icons: []
    });
    t('the real createAppKit instance exposes the exact API the context consumes',
      Boolean(modal)
        && ['open', 'close', 'subscribeAccount', 'subscribeState', 'getWalletProvider', 'getAddress', 'getIsConnectedState', 'disconnect', 'updateOptions']
          .every((k) => typeof modal[k] === 'function'));
    t('the lazy getter never builds a second instance',
      (await getEmailSocialAppKit('other-id', { name: 'ignored' })) === modal);

    const { OptionsController } = await import('@reown/appkit-controllers');
    t('creation wrote the email feature set into the shared OptionsController',
      OptionsController.state.features?.email === true
        && OptionsController.state.features?.emailShowWallets === false
        && (OptionsController.state.features?.socials || []).join(',') === SOCIAL_PROVIDERS.join(','));

    /* THE TRUCE, MEASURED: the WalletConnect surface flattens the features
       before its own open (WalletContext applyAppKitWalletLinks — wiring is
       asserted below). Re-asserting must restore this surface byte for byte. */
    OptionsController.setFeatures({ email: false, socials: false });
    t('re-asserting restores the email features after a WalletConnect flattening',
      reassertEmailFeatures(modal) === true
        && OptionsController.state.features?.email === true
        && OptionsController.state.features?.emailShowWallets === false
        && (OptionsController.state.features?.socials || []).length === SOCIAL_PROVIDERS.length);
    t('re-asserting is honest about a missing instance',
      reassertEmailFeatures(null) === false);
    /* Leave no feature residue for probes that run afterwards in-process. */
    OptionsController.setFeatures({ email: false, socials: false });
  }

  /* ---- 4. WalletContext + sheet wiring (source contract) ---------------- */
  {
    const ctx = strip(readFileSync('src/context/WalletContext.jsx', 'utf8'));
    /* The module + the installed SDK's own frame provider, so the window
       assertion above can compare OUR bound with the SDK's measured one
       instead of trusting a number we wrote down. */
    const emailSrc = strip(readFileSync('src/lib/emailSocialWallet.js', 'utf8'));
    const sdkProviderSrc = readFileSync(
      'node_modules/@reown/appkit-wallet/dist/esm/src/W3mFrameProvider.js',
      'utf8'
    );
    t('the WalletConnect surface flattens email/social before every pairing open',
      /features:\s*\{\s*email:\s*false,\s*socials:\s*false\s*\}/.test(ctx));
    t('the controllers fallback path applies the same flattening',
      /C\?\.setFeatures\?\.\(options\.features\)/.test(ctx));
    t('connectEmailSocial holds the refresh guard and builds the lazy instance with our id',
      /holdRefreshGuard\('email-connect'\)/.test(ctx)
        && /getEmailSocialAppKit\(WC_PROJECT_ID, wcPublicMetadata\(\)\)/.test(ctx));
    t('the SDK login marker is handed back BEFORE createAppKit builds the frame',
      /rearmSdkLoginMarker\(\);\s*if \(!emailAppKit\) \{/.test(emailSrc)
        && emailSrc.indexOf('rearmSdkLoginMarker();') < emailSrc.indexOf('createAppKit({'));
    /* A returning page is not always a fresh document: the APK WebView never
       reloads, and iOS/Chrome restore a frozen page (pageshow + persisted)
       with no mount at all. Both paths must re-run the SAME recovery for both
       wallet modes — the email marker included, which the old handler
       deliberately skipped («cold-start only»). */
    t('a returning page (foreground OR bfcache) re-runs BOTH restores',
      /window\.addEventListener\('pageshow', onPageShow\)/.test(ctx)
        && /if \(event\?\.persisted\) onReturn\(false\)/.test(ctx)
        && /const onReturn = \(announce\) => \{[\s\S]{0,120}if \(hasEmailSocialMarker\(\)\) \{[\s\S]{0,60}resumeEmailThenWc\(announce\);/.test(ctx));
    t('a WalletConnect instance that exists WITHOUT an account is released and re-probed',
      /const resumeWc = \(announce\) => \{[\s\S]{0,160}if \(wcRef\.current && !wcInitingRef\.current\) \{[\s\S]{0,80}releaseWc\(false\)\.then\(\(\) => restoreWcSession\(\{ announce \}\)\)/.test(ctx));
    /* The marker decides the ORDER, never the OUTCOME: a claim AppKit has
       already answered «no» for is dead, and the `wc@2:` session on disk may
       well be the user's real wallet — so that pass probes it. A marker still
       standing means the frame could not answer, and then nothing may preempt
       the session inside it. */
    t('a dead email claim hands the return to the stored WalletConnect session',
      /const resumeEmailThenWc = \(announce\) => \{[\s\S]{0,240}if \(ok \|\| addressRef\.current \|\| hasEmailSocialMarker\(\)\) return;[\s\S]{0,60}resumeWc\(announce\);/.test(ctx));

    /* THE REDIRECT FIX, AS A SOURCE CONTRACT. Emails and OAuth logins leave
       the site and come back as a new document; only the boot marker crosses
       that boundary, so the claim has to happen before the flow can be
       interrupted — and every self-clearing boundary must stay to undo a
       claim that led nowhere. Both halves are order-sensitive, so they are
       measured by position, not by counting calls. */
    const claimStart = ctx.indexOf('const connectEmailSocial = useCallback');
    const connectBlock = ctx.slice(claimStart, ctx.indexOf('const restoreEmailSocial = useCallback'));
    const attachBlock = ctx.slice(
      ctx.indexOf('const attachEmailProvider = useCallback'),
      claimStart
    );
    const restoreBlock = ctx.slice(
      ctx.indexOf('const restoreEmailSocial = useCallback'),
      ctx.indexOf('const buildWcInitConfig')
    );
    const claim = connectBlock.indexOf('setEmailSocialMarker(true)');
    t('the marker is claimed inside connectEmailSocial, before the flow can be cut off',
      claim > -1
        && claim < connectBlock.indexOf('getEmailSocialAppKit(')
        && claim < connectBlock.indexOf('modal.open()')
        && claim < connectBlock.indexOf('setEmailModalActive(true)'));
    t('the claim comes AFTER the one-wallet teardown (which clears the marker synchronously)',
      connectBlock.indexOf('disconnectRef.current?.()') < claim);
    t('a proven account still re-writes the marker, so a retried tap self-heals',
      /setEmailSocialMarker\(true\)/.test(attachBlock));
    /* Three dead ends, three rollbacks — and the outer catch is only one of
       them, so a count here would pass with the wrong one missing. Each call
       is pinned by what it is attached to. */
    t('a warm session that refuses to attach hands the claim back',
      /if \(!attached\) rollbackEmailSocialMarker\(modal\);[\s\S]{0,40}return attached;/.test(connectBlock));
    t('a cancel settles through the same rollback (settle owns it, both attach outcomes)',
      /const settle = \(ok\) => \{[\s\S]{0,120}if \(!ok\) rollbackEmailSocialMarker\(modal\);/.test(connectBlock)
        && /\.then\(settle, \(\) => \{[\s\S]{0,80}settle\(false\);/.test(connectBlock));
    t('a flow that never even reached an instance rolls back in its catch',
      /catch\s*\{\s*rollbackEmailSocialMarker\(modal\);/.test(connectBlock));
    t('the rollback goes through the honest helper, never a blind clear',
      !/setEmailSocialMarker\(false\)/.test(connectBlock)
        && (connectBlock.match(/rollbackEmailSocialMarker\(modal\)/g) || []).length === 3);
    /*
     * THE OLD CONTRACT HERE WAS WRONG, AND IT WAS THE BUG.
     * It pinned an 8-second window and a blind `clearEmailSocialSession()` on
     * expiry. Measured against the installed SDK: `appEvent()` waits on the
     * secure-site iframe and gives IT 20_000 ms before declaring failure — so
     * an 8s bound lost a race the SDK had not even finished running, and the
     * losing branch then DELETED the only durable record of the login. One
     * slow boot became a permanent one, which is why the shipped workaround
     * was «یک بار دیگر بزن». The window must outlive the SDK's own bound and
     * a timeout must go through the honest rollback — never a blind clear.
     */
    t('a restore with no account waits LONGER than the SDK gives its own iframe',
      /EMAIL_RESTORE_WINDOW_MS/.test(restoreBlock)
        && /EMAIL_RESTORE_WINDOW_MS\s*=\s*30_000/.test(emailSrc)
        && /20_000/.test(sdkProviderSrc));
    t('a restore with no account hands the claim back HONESTLY, never blindly',
      /if \(!acct\) \{[\s\S]{0,600}rollbackEmailSocialMarker\(modal\)/.test(restoreBlock)
        && !/clearEmailSocialSession\(\{ disconnect: false \}\)/.test(restoreBlock));
    t('the restore is single-flighted (cold start + pageshow + foreground can race)',
      /if \(emailRestoreRef\.current\) return false;/.test(restoreBlock)
        && /finally\s*\{\s*emailRestoreRef\.current = false;/.test(restoreBlock));
    t('a restore that THREW keeps the marker, so the next cold start retries',
      /catch\s*\{[\s\S]{0,140}return false;/.test(restoreBlock)
        && !/clearEmailSocialSession|setEmailSocialMarker\(false\)|rollbackEmailSocialMarker/.test(
          restoreBlock.slice(restoreBlock.lastIndexOf('} catch'))
        ));
    t('an explicit disconnect still washes the early claim (no logout resurrection)',
      /try \{ void clearEmailSocialSession\(\); \} catch/.test(ctx));
    t('explicit disconnect also logs the email session out',
      /clearEmailSocialSession\(\)/.test(ctx));
    t('cold start prefers the email restore over the WalletConnect restore when marked',
      /if \(hasEmailSocialMarker\(\)\) resumeEmailThenWc\(false\);\s*else resumeWc\(false\);/.test(ctx.replace(/\n\s*/g, ' ')));
    t('another wallet mode attaching retires the email boot marker',
      /mode && mode !== 'email'\) void clearEmailSocialSession\(\)/.test(ctx.replace(/\n\s*/g, ' ')));
    t('both modal flags are exposed so the sheet can withdraw under a modal',
      /emailModalActive,/.test(ctx) && /connectEmailSocial,/.test(ctx));

    const sheetOrig = readFileSync('src/components/WalletConnectSheet.jsx', 'utf8');
    const sheet = strip(sheetOrig);
    t('the sheet offers Email & Social as a connect path through the context',
      /startEmailSocial/.test(sheet)
        && sheetOrig.includes("t('wallet.emailSocial')")
        && sheetOrig.includes("t('wallet.emailSocialDesc')"));
    t('the sheet withdraws under EITHER AppKit modal',
      /open=\{open && !wallet\.wcModalActive && !wallet\.emailModalActive\}/.test(sheet));

    for (const locale of ['fa', 'en', 'ar']) {
      const json = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      t(`wallet.emailSocial/emailSocialDesc/mode.email exist in ${locale}`,
        Boolean(json.wallet?.emailSocial)
          && Boolean(json.wallet?.emailSocialDesc)
          && Boolean(json.wallet?.mode?.email));
    }
  }

  /* ---- 5. the single-copy contract -------------------------------------- */
  {
    const pkg = readFileSync('package.json', 'utf8');
    t('@reown/appkit and the ethers adapter are pinned to the provider’s own 1.8.19',
      /"@reown\/appkit": "1\.8\.19"/.test(pkg)
        && /"@reown\/appkit-adapter-ethers": "1\.8\.19"/.test(pkg));
  }

  return rows;
}
