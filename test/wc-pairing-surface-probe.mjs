/**
 * THE PAIRING SURFACE PROBE — «invalid deep link» + «the QR does not work»
 * ---------------------------------------------------------------------------
 * The standing report, unchanged across two rounds of AppKit patching:
 * tapping a wallet opens it and the wallet answers **invalid deep link**, the
 * QR code does nothing either, and the only path that works is opening this
 * site inside the wallet's own browser (the injected provider — which needs no
 * relay and no deep link at all).
 *
 * Both halves of that report live in the LAST METRE: the bytes we hand the
 * phone. So this probe measures exactly those bytes, end to end:
 *
 *   1. QR ROUND-TRIP, NOT QR SHAPE. The sheet's encoder output is decoded
 *      again with jsQR (a different library) from the same module matrix. A
 *      subtly wrong encoder still draws a scannable square that decodes to
 *      something else — for a pairing URI that is a wallet saying "invalid"
 *      and never connecting. Only a decode proves the square says what we
 *      think it says.
 *   2. DEEP LINK ROUND-TRIP. Each promoted wallet's link is built from the
 *      same URI, and the `uri=` parameter is decoded back to that URI byte
 *      for byte — one encoding level, no `&amp;` damage, nothing dropped.
 *   3. WIRING. `showQrModal: false` (so no SDK modal competes), the
 *      `display_uri` listener installed BEFORE connect(), the URI cleared on
 *      every exit path, and a cancel that settles the attempt immediately.
 *
 * No network, no DOM: the encoder, the decoder and the link builder are the
 * real ones the app ships.
 */
import { readFileSync } from 'node:fs';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { MOBILE_WALLETS, repairPairingUri, walletDeepLinks } from '../src/lib/wcWallets.js';

/** A realistic v2 pairing URI, byte-shaped like the SDK's own output. */
const URI =
  'wc:7f6e4f2c1c9b4a4f9e2f1a0b3c4d5e6f9e2f1a0b3c4d5e6f9e2f1a0b3c4d5e6f@2'
  + '?relay-protocol=irn&symKey=9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0';

/**
 * Encode a string exactly the way WalletConnectSheet does, returning the
 * module matrix. `qrcode(0, 'M')` is auto-version with medium error
 * correction — a pairing URI is ~170 chars, so the version is chosen, not
 * guessed.
 */
function encode(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const count = q.getModuleCount();
  const dark = (r, c) => q.isDark(r, c);
  return { count, dark };
}

/**
 * Render the matrix into RGBA the way jsQR expects (1px per module).
 *
 * `quiet` pads the symbol with that many LIGHT modules on every side — the
 * margin ISO/IEC 18004 requires and the encoder does not emit (measured below:
 * 119 dark modules sit on the outer ring of a real v8 symbol). The sheet adds
 * it in the SVG viewBox, so the square a camera sees is the padded one.
 */
function toRgba({ count, dark }, quiet = 0) {
  const size = count + quiet * 2;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const inSymbol = r >= quiet && c >= quiet && r < quiet + count && c < quiet + count;
      const v = inSymbol && dark(r - quiet, c - quiet) ? 0 : 255;
      const i = (r * size + c) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

/** The SVG path the sheet draws — the same loop, verbatim. */
function svgPath({ count, dark }) {
  let d = '';
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (dark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return d;
}

export default function runWcPairingSurface() {
  const rows = [];
  const t = (label, ok) => rows.push([label, Boolean(ok)]);

  /* ---- 1. the QR says exactly the pairing URI ---------------------------- */
  {
    const matrix = encode(URI);
    t('the encoder produces a real matrix (version chosen, not guessed)',
      matrix.count >= 21 && matrix.count % 4 === 1);

    const img = toRgba(matrix);
    const decoded = jsQR(img.data, img.width, img.height);
    t('jsQR decodes the sheet\'s QR at all (the square is scannable)',
      Boolean(decoded?.data));
    t('…and it decodes to the pairing URI BYTE FOR BYTE',
      decoded?.data === URI);
    t('…so the topic, @2, relay-protocol and symKey all survive the round trip',
      decoded?.data?.startsWith('wc:7f6e4f2c') === true
      && /@2\?relay-protocol=irn&symKey=[0-9a-f]{64}$/.test(decoded?.data || ''));

    /*
     * THE QUIET ZONE — the reason a scannable square still failed to scan.
     *
     * ISO/IEC 18004 requires four LIGHT modules of margin around the symbol.
     * `qrcode-generator` emits none: count is the symbol alone, and its outer
     * ring is full of dark modules. The sheet therefore has to add the margin
     * itself, and it adds it in the SVG viewBox so it scales with the symbol
     * at any size instead of depending on a CSS padding value.
     */
    let outerDark = 0;
    for (let i = 0; i < matrix.count; i += 1) {
      if (matrix.dark(0, i)) outerDark += 1;
      if (matrix.dark(matrix.count - 1, i)) outerDark += 1;
      if (matrix.dark(i, 0)) outerDark += 1;
      if (matrix.dark(i, matrix.count - 1)) outerDark += 1;
    }
    t('the encoder emits NO quiet zone of its own (so the viewBox must add one)',
      outerDark > 0);
    t('the sheet adds the spec\'s 4-module margin in the viewBox, not in CSS',
      /QR_QUIET_MODULES = 4/.test(readFileSync('src/components/WalletConnectSheet.jsx', 'utf8'))
      && /viewBox=\{`\$\{-QR_QUIET_MODULES\} \$\{-QR_QUIET_MODULES\}/.test(
        readFileSync('src/components/WalletConnectSheet.jsx', 'utf8')
      ));
    const paddedImg = toRgba(matrix, 4);
    const padded = jsQR(paddedImg.data, paddedImg.width, paddedImg.height);
    t('…and the PADDED square — the one a camera actually sees — still decodes',
      padded?.data === URI);

    const d = svgPath(matrix);
    t('the SVG path covers every dark module (nothing is dropped in rendering)',
      d.split('h1v1h-1z').length - 1 === [...Array(matrix.count * matrix.count).keys()]
        .filter((i) => matrix.dark(Math.floor(i / matrix.count), i % matrix.count)).length);
  }

  /* ---- 2. an escaped URI is repaired BEFORE it is encoded --------------- */
  {
    const damaged = URI.replaceAll('&', '&amp;');
    const repaired = repairPairingUri(damaged);
    t('a `&amp;`-damaged URI is repaired before it can reach the QR',
      repaired === URI);
    const decoded = jsQR(...Object.values(toRgba(encode(repaired))).slice(0, 1),
      toRgba(encode(repaired)).width, toRgba(encode(repaired)).height);
    t('…and the repaired URI still decodes cleanly',
      decoded?.data === URI);
  }

  /* ---- 3. one deep link per promoted wallet, and each one round-trips --- */
  {
    /* The order is user-visible because the sheet maps this table directly. */
    t('the promoted table names all five wallets the sheet renders, in order',
      MOBILE_WALLETS.map((w) => w.key).join(',') === 'metamask,trust,uniswap,safepal,rainbow');
    t('…and every one of them can carry a brand logo (no grey glyphs)',
      MOBILE_WALLETS.every((w) => Boolean(w.imageId) && Boolean(w.homepage)));
    for (const w of MOBILE_WALLETS) {
      const links = walletDeepLinks(w.key, URI);
      const url = links?.universal || '';
      let host = '';
      try { host = new URL(url).host; } catch { host = ''; }
      t(`${w.name}: an https fallback exists on the wallet's official host`,
        url.startsWith('https://') && host === new URL(w.universal).host);
      const param = new URLSearchParams(url.slice(url.indexOf('?'))).get('uri');
      t(`${w.name}: the uri= parameter decodes back to the pairing URI exactly`,
        param === URI);
      t(`${w.name}: the URI is encoded exactly once (no double-encoding)`,
        !url.includes('%253A') && url.includes('uri=wc%3A'));
      t(`${w.name}: a native-scheme twin still exists for real browsers`,
        (links?.native || '').startsWith(`${w.native}wc?uri=`));
    }
    t('the links match the wallets\' own documented forms',
      walletDeepLinks('trust', URI).universal.startsWith('https://link.trustwallet.com/wc?uri=')
      && walletDeepLinks('metamask', URI).universal.startsWith('https://metamask.app.link/wc?uri='));
  }

  /* ---- 4. wiring: the SDK hands us the URI, and only the URI ------------ */
  {
    const src = readFileSync('src/context/WalletContext.jsx', 'utf8');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = strip(src);

    /*
     * THE MODAL IS BACK, AND THE FALLBACK IS DELIBERATE.
     *
     * An earlier round removed the SDK modal entirely and rendered this
     * sheet instead — the «deep-link error» survived it, because the modal
     * was never what was failing, and users lost the surface they knew. The
     * modal is the primary screen again; this sheet is what the user gets
     * when the AppKit chunk cannot be built (init is retried without it, and
     * only for a failure that names the modal — never for a relay error,
     * which retrying with a different surface would only hide).
     */
    t('the provider is built WITH the SDK modal (the surface users know)',
      /showQrModal: withModal/.test(code) && /buildWcInitConfig\(true\)/.test(code));
    t('…and is retried WITHOUT it only when the MODAL failed, not the connection',
      /buildWcInitConfig\(false\)/.test(code)
      && /if \(!isAppKitModalError\(modalErr\)\) throw modalErr/.test(code)
      && /function isAppKitModalError/.test(code));
    t('…a relay/project failure is rethrown, never disguised as a modal failure',
      code.indexOf('if (!isAppKitModalError(modalErr)) throw modalErr')
        < code.indexOf('buildWcInitConfig(false)'));
    t('a silent session restore does NOT build a modal it will never open',
      /initWcProvider\(EthereumProvider, buildWcInitConfig\(false\)\)/.test(code));
    t('the sheet is told which surface owns the pairing',
      /setWcModalActive\(Boolean\(wc\?\.modal\)\)/.test(code)
      && /finally \{[\s\S]{0,260}setWcModalActive\(false\)/.test(code));
    t('the pairing URI is taken from the SDK\'s own display_uri event',
      /wc\.on\('display_uri', onPairUri\)/.test(code));
    t('…installed BEFORE connect(), so the first (and only) URI is caught',
      code.indexOf("wc.on('display_uri', onPairUri)") < code.indexOf('wc.connect()'));
    t('…validated as a pairing URI and repaired before it is published to the sheet',
      /looksLikePairingUri\(raw\)/.test(code) && /setWcPairUri\(repairPairingUri\(raw\)|const uri = repairPairingUri\(raw\)/.test(code));
    t('the URI is cleared on EVERY exit path (no QR outliving its pairing)',
      /finally \{[\s\S]{0,200}setWcPairUri\(null\)/.test(code)
      && code.split('setWcPairUri(null)').length - 1 >= 2);
    t('the listener is removed when the attempt settles',
      /removeListener\('display_uri', onPairUri\)/.test(code));
    t('Cancel settles the connect promise immediately (the race switch)',
      /Promise\.race\(\[wc\.connect\(\), cancelled, bound\]\)/.test(code)
      && /wcCancelRef\.current = \(\) => cancelReject/.test(code));
    t('a slow approval gets the pairing TTL, not the 20s relay fuse',
      /armBound\(WC_PAIRING_TTL_MS, 'WC_PAIRING_EXPIRED'\)/.test(code)
      /* …re-armed from INSIDE the display_uri handler: the relay has just
         proven itself, so the remaining wait belongs to the human. */
      && code.indexOf('const onPairUri') < code.indexOf('armBound(WC_PAIRING_TTL_MS')
      && code.indexOf('armBound(WC_PAIRING_TTL_MS') < code.indexOf("wc.on('display_uri', onPairUri)"));
    t('…and is classified as a cancellation, not a connection failure',
      /msg === 'WC_USER_CANCELLED'[\s\S]{0,200}setError\('USER_REJECTED'\)/.test(code));
    t('the pairing surface and its cancel control are exposed to the sheet',
      /wcPairUri,/.test(code) && /cancelWcPairing,/.test(code));
    t('a late cancel cannot surface as an unhandled rejection',
      /cancelled\.catch\(\(\) => \{\}\)/.test(code));
    t('with no modal there is nothing to patch — and the trace says so',
      /if \(!wc\?\.modal\) \{[\s\S]{0,120}appkit_modal_absent/.test(code));
  }

  /* ---- 5. the sheet renders the pairing itself -------------------------- */
  {
    const sheet = readFileSync('src/components/WalletConnectSheet.jsx', 'utf8');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const code = strip(sheet);

    t('the sheet encodes the URI with the shipped QR library',
      /encode\(0, 'M'\)/.test(code) && /q\.addData\(pairUri\)/.test(code));
    t('…and imports the encoder lazily, so the first paint does not pay for it',
      /import\('qrcode-generator'\)/.test(code) && !/^import qrcode/m.test(sheet));
    t('…and the QR is derived from the context URI, not from a modal',
      /wallet\.wcPairUri/.test(code) && /repairPairingUri\(wallet\.wcPairUri\)/.test(code));
    t('one row per promoted wallet, driven by the tested link table',
      /MOBILE_WALLETS\.map\(/.test(code) && /walletDeepLinks\(key, pairUri\)/.test(code));
    /*
     * A WALLET HAND-OFF IS A REAL LINK, OPENED IN A NEW TAB.
     *
     * This is the assertion that the standing report was missing. The SDK's
     * own mobile hand-off is `window.open(url, '_self')`
     * (ConnectionControllerUtil.onConnectMobile, appkit-controllers@1.8.19),
     * and `_self` REPLACES this document — killing the WalletConnect client,
     * its relay socket and the pending connect() promise in the same instant
     * the wallet opens. The approval then lands on a relay nobody is
     * listening to. So: real anchors (a blocker cannot refuse them, and they
     * survive our JavaScript dying), `_blank` everywhere, and no `_self`
     * anywhere in the delivery path.
     */
    t('each wallet row is a real <a>, so no pop-up blocker can refuse it',
      /<motion\.a/.test(code) && /href=\{href \|\| undefined\}/.test(code));
    t('…targeting a NEW tab, never this one',
      /target="_blank"/.test(code) && /rel="noreferrer noopener"/.test(code)
      && !/'_self'/.test(code));
    t('the app\'s own opener receives native, universal, package and raw pairing forms',
      /walletHandOffChannel\(\)/.test(code)
      && /openWalletLink\(links\.native/.test(code)
      && /walletPackage: promoted\.androidPackage/.test(code)
      && /pairingUri: pairUri/.test(code)
      && /fallbackUrl: links\.universal/.test(code));
    t('…Telegram and the APK take over; the open web keeps the direct native anchor',
      /if \(channel === 'web-native'\) return/.test(code));
    t('the wallet rows are dead until a URI exists (no empty-payload opens)',
      /aria-disabled=\{!pairUri\}/.test(code) && /pointerEvents: 'none'/.test(code));
    t('each row carries the wallet\'s own brand logo over the generic glyph',
      /walletLogo\(w\.imageId, wallet\.wcProjectId\)/.test(code)
      && /onError=\{\(e\) => \{ e\.currentTarget\.style\.display = 'none'; \}\}/.test(code));
    t('the URI is also copyable — the path that works when every other fails',
      /writeText\(pairUri\)/.test(code));
    t('…and the deep-link-free alternative hands over THIS site\'s address',
      /writeText\(publicAppUrl\('\/'\)\)/.test(code));
    t('closing the sheet mid-pairing cancels the attempt',
      /view === 'pair' && wallet\.connecting/.test(code)
      && /wallet\.cancelWcPairing\?\.\\?\(\)/.test(code));
    t('the sheet withdraws while the SDK modal owns the screen (no stacked modals)',
      /<Sheet open=\{open && !wallet\.wcModalActive\}/.test(code));
  }

  /* ---- 6. every locale can name the pairing screen ---------------------- */
  {
    const langs = ['en', 'fa', 'ar', 'ur', 'tr', 'ru', 'zh', 'es', 'fr', 'pt', 'hi', 'id'];
    const keys = ['pairTitle', 'pairSubtitle', 'pairPreparing', 'pairOpenIn',
      'pairOpened', 'pairScanHint', 'pairCopyUri', 'pairStuck',
      'pairManualTitle', 'pairAltTitle', 'pairAltBrowserHint', 'pairAltBrowser'];
    let missing = [];
    for (const lang of langs) {
      const dict = JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, 'utf8'));
      for (const k of keys) {
        if (!dict?.wallet?.[k]) missing.push(`${lang}.${k}`);
      }
    }
    t(`all ${langs.length} locales name every part of the pairing screen (${missing.join(', ') || 'none missing'})`,
      missing.length === 0);
  }

  return rows;
}
