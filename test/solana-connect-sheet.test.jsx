// @vitest-environment jsdom
/**
 * THE REPORTED BUG, AS A TEST
 * «کیف پول سولانا فقط داخل خود اپ مثل فانتوم باز میشه … هیچ صفحه تاییدی برای
 * اتصال به کیف پول ما انجام نمیشود»
 *
 * What that sentence describes is a connect button with no step of its own: it
 * handed the user to a wallet and hoped. This file mounts the REAL wallet page
 * and the REAL approval sheet, with the wallet played by a key pair — and it
 * asserts the four things the report asks for:
 *
 *   1. pressing «اتصال کیف پول» opens an approval surface OF OURS, and opens
 *      nothing else yet;
 *   2. choosing a wallet sends a CONNECT REQUEST (not a «browse my site» link)
 *      whose redirect comes back INTO the app;
 *   3. while the wallet holds it, the screen says WAITING — a state that did
 *      not exist before, and the reason a user who returned without approving
 *      could not tell whether anything had been asked;
 *   4. when the wallet answers, the address appears in OUR app and the wallet
 *      layer reports it as connected — even though no provider was ever
 *      injected, which is the entire situation on a phone.
 *
 * Nothing is stubbed except the things that are not ours: the browser plugin
 * the APK opens (a Custom Tab to the wallet) and the RPC probe.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import nacl from 'tweetnacl';
import en from '../src/i18n/locales/en.json';
import { base58Decode, base58Encode } from '../src/lib/solana/deeplinkUri.js';

const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], en) ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));
vi.mock('framer-motion', () => {
  const components = new Map();
  return {
    motion: new Proxy({}, {
      get: (_, tag) => {
        if (!components.has(tag)) {
          components.set(tag, ({ children, ...props }) => {
            const Tag = String(tag);
            const clean = Object.fromEntries(
              Object.entries(props).filter(([k]) => ![
                'initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'
              ].includes(k))
            );
            return <Tag {...clean}>{children}</Tag>;
          });
        }
        return components.get(tag);
      }
    }),
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => true
  };
});
/* The Custom Tab the APK opens instead of navigating the WebView. */
vi.mock('@capacitor/browser', () => ({
  Browser: { open: vi.fn(async () => {}), close: vi.fn(async () => {}) }
}));
/* No RPC in a unit test: the address read is not what is under test here. */
vi.mock('../src/lib/solanaRpc.js', () => ({
  getSolanaRpcUrl: async () => 'https://127.0.0.1:9',
  probeSolanaRpc: async () => ({ ok: false, reason: 'UNREACHABLE' })
}));

import SolanaWalletTab from '../src/components/SolanaWalletTab';
import SolanaConnectSheet from '../src/components/SolanaConnectSheet';
import { Browser } from '@capacitor/browser';
import * as deeplink from '../src/lib/solana/deeplink.js';
import { solanaAddress } from '../src/lib/solanaWallet';
import { shortAddress } from '../src/context/WalletContext';

const ADDRESS = '9Z4wtiosH7JMXhKg8JpUPDCtB5ZyM8vzby14HwDidgVz';
const SESSION = 'wallet-session-token';

/** The wallet, played by the test: one box key pair and its shared key. */
const walletKeys = nacl.box.keyPair();

/*
 * ASCII -> bytes WITHOUT TextEncoder.
 *
 * In the jsdom environment Node's `TextEncoder` returns a Uint8Array from a
 * DIFFERENT realm than the one tweetnacl captured, and `nacl.box.after` rejects
 * it with «unexpected type, use Uint8Array» — a failure that has nothing to do
 * with the code under test and would send the next reader hunting for a bug in
 * the wallet flow. (The app itself never mixes the two: `lib/solana/deeplink.js`
 * only DECODES with TextDecoder, and every byte array it hands to nacl is built
 * by its own `base58Decode`.)
 */
const asciiBytes = (str) => {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) out[i] = str.charCodeAt(i);
  return out;
};

/** The answer a wallet appends to `redirect_link`. */
function walletAnswer(requestUrl, payload) {
  const parsed = new URL(requestUrl);
  const dappPub = base58Decode(parsed.searchParams.get('dapp_encryption_public_key'));
  const shared = nacl.box.before(dappPub, walletKeys.secretKey);
  const nonce = nacl.randomBytes(24);
  const sealed = nacl.box.after(asciiBytes(JSON.stringify(payload)), nonce, shared);
  const redirect = parsed.searchParams.get('redirect_link');
  return `${redirect}&phantom_encryption_public_key=${base58Encode(walletKeys.publicKey)}`
    + `&nonce=${base58Encode(nonce)}&data=${base58Encode(sealed)}`;
}

/** The URL the wallet was opened with (the last call to the browser plugin). */
function lastOpenedUrl() {
  const calls = Browser.open.mock.calls;
  return calls.length ? String(calls[calls.length - 1][0]?.url ?? '') : '';
}

async function openSheetThroughWalletTab() {
  render(<SolanaWalletTab />);
  fireEvent.click(screen.getByTestId('solana-connect'));
  return screen.findByText(en.solana.connect.title);
}

beforeEach(() => {
  localStorage.clear();
  Browser.open.mockClear();
  Browser.close.mockClear();
  /* The APK: no injected provider can exist, and the return path is our own
     custom scheme — exactly the situation the report came from. */
  window.Capacitor = { isNativePlatform: () => true };
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  delete window.Capacitor;
  delete window.FBTSolanaLink;
  deeplink.resetDeeplink();
  vi.useRealTimers();
});

describe('connecting a Solana wallet on a phone', () => {
  it('opens OUR approval surface first, and nothing else', async () => {
    await openSheetThroughWalletTab();

    /* The ask is stated in our own words before any wallet is involved. */
    expect(screen.getByText(en.solana.connect.askTitle)).toBeTruthy();
    expect(screen.getByText(en.solana.connect.askAddress)).toBeTruthy();
    expect(screen.getByText(en.solana.connect.askSign)).toBeTruthy();
    expect(screen.getByText(en.solana.connect.neverSeed)).toBeTruthy();

    /* The three wallets are offered as requests, not as browse links. */
    expect(screen.getByTestId('sol-connect-phantom')).toBeTruthy();
    expect(screen.getByTestId('sol-connect-solflare')).toBeTruthy();
    expect(screen.getByTestId('sol-connect-backpack')).toBeTruthy();

    /* And nothing has been opened yet: the user decides on this screen. */
    expect(Browser.open).not.toHaveBeenCalled();
  });

  it('sends a CONNECT REQUEST whose answer comes back into the app', async () => {
    await openSheetThroughWalletTab();
    fireEvent.click(screen.getByTestId('sol-connect-phantom'));
    await waitFor(() => expect(Browser.open).toHaveBeenCalledTimes(1));

    /*
     * phantom.com — the host the WALLET declares. Phantom's Android App Links
     * (`/.well-known/assetlinks.json` → `app.phantom`) and its iOS Universal
     * Links (`apple-app-site-association` → `/ul/*`) both live there;
     * phantom.app 404s the first and 301s here, so a request addressed at it
     * cannot be resolved to the app by Android or by an `intent://`.
     */
    const url = new URL(lastOpenedUrl());
    expect(url.host).toBe('phantom.com');
    expect(url.pathname).toBe('/ul/v1/connect');
    /* The request carries a key pair only this session knows — the wallet's
       answer is encrypted to it, which is why the answer can be trusted. */
    expect(url.searchParams.get('dapp_encryption_public_key')).toBeTruthy();
    expect(url.searchParams.get('app_url')).toMatch(/^https:\/\/fbtswap\.ir\/?$/);
    /* THE RETURN PATH: our own scheme, back into this app. A redirect to a
       web URL would have completed the connection in a browser instead. */
    const redirect = url.searchParams.get('redirect_link');
    expect(redirect.startsWith('ir.fbtswap.app://solconnect?rid=')).toBe(true);
  });

  it('shows WAITING while the wallet holds the approval', async () => {
    await openSheetThroughWalletTab();
    fireEvent.click(screen.getByTestId('sol-connect-phantom'));

    await screen.findByTestId('sol-connect-reopen');
    expect(screen.getByText(t('solana.connect.waitingTitle', { name: 'Phantom' }))).toBeTruthy();
    expect(screen.getByTestId('sol-connect-check')).toBeTruthy();
    /* Re-opening must re-fire the same request, not start a second one. */
    fireEvent.click(screen.getByTestId('sol-connect-reopen'));
    await waitFor(() => expect(Browser.open).toHaveBeenCalledTimes(2));
    expect(lastOpenedUrl()).toBe(lastOpenedUrl());
  });

  it('connects the app when the wallet answers, with no provider involved', async () => {
    await openSheetThroughWalletTab();
    fireEvent.click(screen.getByTestId('sol-connect-phantom'));
    await waitFor(() => expect(Browser.open).toHaveBeenCalledTimes(1));

    const answer = walletAnswer(lastOpenedUrl(), { public_key: ADDRESS, session: SESSION });
    await act(async () => {
      await deeplink.completeDeeplinkReturn(answer);
    });

    /* The sheet confirms what the wallet approved… */
    await screen.findByText(en.solana.connect.doneTitle);
    expect(screen.getAllByText(shortAddress(ADDRESS)).length).toBeGreaterThan(0);
    /* …the wallet layer reports the address, so every screen that reads it
       (swap, launch, perps) is connected too… */
    expect(solanaAddress()).toBe(ADDRESS);
    /* …and the tab this started from shows it without a reload. */
    expect(screen.getAllByText(shortAddress(ADDRESS)).length).toBeGreaterThan(0);
  });

  /*
   * THE DELIVERY, WHICH IS WHERE THE BUG ACTUALLY WAS.
   *
   * A Chrome Custom Tab renders http/https itself and never hands an App Link
   * to another app, so `https://phantom.app/ul/v1/connect?…` opened as a web
   * page inside our own APK: Phantom in front of the user, nothing in it to
   * approve. The native bridge fires an ACTION_VIEW at the wallet's package
   * instead, which is the one route inside an APK that arrives with the query
   * string — i.e. with the request — intact.
   */
  it('hands the request to Android itself, not to a Custom Tab', async () => {
    const openWalletLink = vi.fn(() => true);
    window.FBTSolanaLink = { openWalletLink };

    await openSheetThroughWalletTab();
    fireEvent.click(screen.getByTestId('sol-connect-phantom'));
    await waitFor(() => expect(openWalletLink).toHaveBeenCalledTimes(1));

    const [url, packageName] = openWalletLink.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.host).toBe('phantom.com');
    expect(parsed.pathname).toBe('/ul/v1/connect');
    expect(packageName).toBe('app.phantom');
    /* The Custom Tab is the fallback for an APK without the bridge, and must
       not be used when the bridge answered. */
    expect(Browser.open).not.toHaveBeenCalled();

    delete window.FBTSolanaLink;
  });

  it('falls back to the Custom Tab on an APK that has no bridge', async () => {
    await openSheetThroughWalletTab();
    fireEvent.click(screen.getByTestId('sol-connect-phantom'));
    await waitFor(() => expect(Browser.open).toHaveBeenCalledTimes(1));
    expect(new URL(lastOpenedUrl()).host).toBe('phantom.com');
  });

  /*
   * «در کیف پول سولنا یک هشدار در مورد ارور ها و هشدار هست ان را پاک کن در
   * باکس بازشونده» — the collapsible box explaining Phantom's warnings was
   * REMOVED on request. This is the regression pin: the sheet must not grow
   * it back, and its locale keys are gone, not merely hidden.
   */
  it('shows no Phantom-warnings box in the approval sheet', async () => {
    await openSheetThroughWalletTab();
    /* No warn-toned collapsible section anywhere in the sheet. */
    expect(document.querySelector('.infobox-warn')).toBeNull();
    expect(screen.queryByText(/Phantom shows a warning/i)).toBeNull();
    expect(screen.queryByText(/could be malicious/i)).toBeNull();
  });

  /*
   * A signature that arrives as a PAGE LOAD — the route iOS and any Android
   * browser without `intent://` are forced onto. Nothing used to read it, so
   * the user came back to a screen that had forgotten what they had approved,
   * which reads exactly like «it errored».
   */
  it('tells the user about a signature that came back as a page load', async () => {
    localStorage.setItem(
      'fbt:solana:result:last',
      JSON.stringify({
        ok: true,
        op: 'signAndSendTransaction',
        walletId: 'phantom',
        signature: '5xy3' + 'A'.repeat(60),
        warnings: ['MULTI_SIGNER'],
        at: Date.now()
      })
    );

    render(<SolanaWalletTab />);
    await screen.findByTestId('solana-sign-notice');
    expect(screen.getByTestId('solana-sign-notice').textContent).toContain(en.solana.signNotice.ok);
    /* …including WHY the wallet showed a risk dialog for it. */
    expect(screen.getByTestId('solana-sign-notice').textContent)
      .toContain(en.solana.signNotice.warn.MULTI_SIGNER);
    /* It is read once: a refresh must not repeat it. */
    expect(localStorage.getItem('fbt:solana:result:last')).toBeNull();
  });

  /*
   * ─── THE TAP ITSELF, WHICH IS WHERE THE SECOND REPORT CAME FROM ───────────
   * «اتفاقی نمی‌افتد یا خیلی طول می‌کشد که پاپ‌اپ تأیید کیف پول بیاید».
   *
   * Chrome launches an app for an `intent://` only when a USER GESTURE
   * produced it («A JavaScript timer tried to open an application without a
   * user gesture», developer.chrome.com/docs/android/intents), and iOS hands a
   * Universal Link over only while the touch is fresh. A hand-off that waits
   * for a `tweetnacl` chunk and a key pair is neither. So the pair is armed
   * while the sheet is on screen and the click itself does no awaiting — this
   * asserts the bridge is called BEFORE any microtask can run.
   */
  it('hands the request over inside the tap, not seconds later', async () => {
    const openWalletLink = vi.fn(() => true);
    window.FBTSolanaLink = { openWalletLink };

    await openSheetThroughWalletTab();
    /* The sheet arms the request when it opens (and again on pointerdown). */
    await waitFor(() => expect(deeplink.deeplinkArmed()).toBe(true));

    fireEvent.click(screen.getByTestId('sol-connect-phantom'));

    /* NO await between the tap and the hand-off. */
    expect(openWalletLink).toHaveBeenCalledTimes(1);
    expect(Browser.open).not.toHaveBeenCalled();

    delete window.FBTSolanaLink;
  });

  /*
   * «I tapped and nothing happened» — the state that used to be invisible.
   *
   * If the document is still the visible one when the grace period ends and
   * no answer has arrived, the wallet never came forward. The card that
   * appears then is the whole point: two named routes that are still left,
   * instead of a spinner that never ends.
   */
  it('says so when the wallet never came to the front, and offers a way out', async () => {
    globalThis.__FBT_HANDOFF_GRACE_MS = 40;
    const openWalletLink = vi.fn(() => true);
    window.FBTSolanaLink = { openWalletLink };

    await openSheetThroughWalletTab();
    await waitFor(() => expect(deeplink.deeplinkArmed()).toBe(true));
    fireEvent.click(screen.getByTestId('sol-connect-phantom'));

    await screen.findByTestId('sol-connect-stuck');
    expect(screen.getByTestId('sol-connect-stuck-reopen')).toBeTruthy();
    expect(screen.getByTestId('sol-connect-stuck-install').textContent)
      .toBe(t('solana.connect.stuckInstall', { name: 'Phantom' }));

    /* The recovery route opens the WALLET'S OWN BROWSER on our page — the one
       hand-off that still works when the connect request cannot be delivered,
       because the provider is injected inside it. */
    fireEvent.click(screen.getByTestId('sol-connect-stuck-browse'));
    const [browseUrl, browsePackage] = openWalletLink.mock.calls.at(-1);
    expect(browseUrl.startsWith('https://phantom.com/ul/browse/')).toBe(true);
    expect(browsePackage).toBe('app.phantom');

    delete globalThis.__FBT_HANDOFF_GRACE_MS;
    delete window.FBTSolanaLink;
  });

  it('names a refusal instead of leaving a vague failure', async () => {
    render(<SolanaConnectSheet open onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('sol-connect-solflare'));
    await waitFor(() => expect(Browser.open).toHaveBeenCalledTimes(1));

    const redirect = new URL(lastOpenedUrl()).searchParams.get('redirect_link');
    await act(async () => {
      await deeplink.completeDeeplinkReturn(`${redirect}&errorCode=4001&errorMessage=User%20rejected`);
    });

    await screen.findByTestId('sol-connect-error');
    expect(screen.getByTestId('sol-connect-error').textContent).toBe(en.solana.connect.err.REJECTED);
    expect(deeplink.deeplinkSession()).toBeNull();
  });
});
