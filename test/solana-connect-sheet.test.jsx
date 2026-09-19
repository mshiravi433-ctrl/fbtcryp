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

    const url = new URL(lastOpenedUrl());
    expect(url.host).toBe('phantom.app');
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
