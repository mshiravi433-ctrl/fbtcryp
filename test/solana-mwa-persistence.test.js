// @vitest-environment jsdom
/**
 * THE SOLANA CONNECTION MUST OUTLIVE THE DOCUMENT.
 * ---------------------------------------------------------------------------
 *   «قبلا درست بود ولی الان درست نیست … اتصال ولت روی همین دستگاه نیره»
 *
 * On Android Chrome there is no injected provider: the only path is Mobile
 * Wallet Adapter, and MWA keeps its grant in a PERSISTENT authorization cache.
 * The grant survives a refresh. Our record of it did not.
 *
 * `mwaAddress` is a module variable, so a reload wiped it — and `solanaAddress()`
 * read only that variable, falling through to null. The wallet was still
 * authorized, the app said «وصل نیست», and the user's only way forward was a
 * connect flow Phantom refused to open because the domain could not be
 * verified. So one lost variable produced three different symptoms.
 *
 * The fix asks the WALLET, which is the thing that actually remembers.
 *
 * Every test loads its own copy of the module (`?fresh=N`) because that IS the
 * scenario: a module variable survives within a document and dies across one.
 * Sharing the module would let one test's `mwaAddress` answer another's
 * question, and a revocation test would pass for the wrong reason.
 */
import { describe, expect, it, vi } from 'vitest';

/* A global, not a module binding: `vi.mock` is hoisted above module-level
   `let`, and a factory closing over one captures its FIRST value. */
globalThis.__mwaWallets = { get: () => [] };
vi.mock('@wallet-standard/app', () => ({ getWallets: () => globalThis.__mwaWallets }));
vi.mock('@solana-mobile/wallet-standard-mobile', () => ({
  registerMwa: () => {},
  createDefaultAuthorizationCache: () => ({}),
  createDefaultChainSelector: () => ({}),
  createDefaultWalletNotFoundHandler: () => ({})
}));

const ADDRESS = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const IDENTITY = 'https://fbtswap.ir';

/**
 * A brand-new document: new module, new variables, same wallet app.
 *
 * `vi.resetModules()` is what makes this real — it empties the module registry
 * so the next import re-evaluates the file, which is precisely what a browser
 * does on a reload. (A template-literal import does NOT work here: Vite cannot
 * statically analyse it.)
 */
async function newDocument() {
  vi.resetModules();
  return import('../src/lib/solanaWallet.js');
}

/** Android Chrome: no injected provider, MWA is the only path. */
function androidChrome() {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
    configurable: true
  });
  delete window.phantom;
  delete window.solflare;
  delete window.backpack;
  delete window.solana;
  globalThis.__mwaWallets = { get: () => [] };
}

/** A wallet MWA presents: authorized, and it says so in `accounts`. */
function authorizedWallet(address = ADDRESS) {
  const account = { address, publicKey: { toString: () => address }, chains: ['solana:mainnet'] };
  return {
    name: 'Mobile Wallet Adapter',
    version: '1.0',
    icon: 'data:image/svg+xml;base64,',
    features: {
      'standard:connect': { connect: vi.fn(async () => ({ accounts: [account] })) },
      'standard:disconnect': { disconnect: vi.fn(async () => ({})) }
    },
    accounts: [account]
  };
}

describe('an MWA connection survives a refresh', () => {
  it('is still connected in a NEW document, without connecting again', async () => {
    androidChrome();
    const wallet = authorizedWallet();
    globalThis.__mwaWallets = { get: () => [wallet] };

    /* First document: the user connects, and it works. */
    const first = await newDocument();
    expect(await first.registerMobileWalletAdapter(IDENTITY)).toBe(true);
    expect(await first.connectSolana()).toBe(ADDRESS);

    /* The refresh. New document, new module variables, same wallet app. */
    const second = await newDocument();
    expect(second.solanaAddress()).toBeNull(); /* the old answer is genuinely gone */

    const restored = await second.restoreSolanaConnection(IDENTITY);
    expect(restored).toBe(ADDRESS);
    expect(second.solanaAddress()).toBe(ADDRESS);
    /* the full account object too, so signing can proceed without reconnecting */
    expect(second.mwaAccountInfo()?.address).toBe(ADDRESS);
    /* and no second connection was requested of the wallet */
    expect(wallet.features['standard:connect'].connect).toHaveBeenCalledTimes(1);
  });

  it('asks the WALLET, not its own memory', async () => {
    androidChrome();
    globalThis.__mwaWallets = { get: () => [authorizedWallet()] };
    const m = await newDocument();
    await m.registerMobileWalletAdapter(IDENTITY);
    expect(m.mwaWalletAccountAddress()).toBe(ADDRESS);
  });

  it('believes a REVOCATION in the wallet over our own memory', async () => {
    androidChrome();
    const wallet = authorizedWallet();
    globalThis.__mwaWallets = { get: () => [wallet] };
    const m = await newDocument();
    await m.registerMobileWalletAdapter(IDENTITY);
    await m.connectSolana();
    expect(m.solanaAddress()).toBe(ADDRESS);

    /* The user removes our access inside the wallet app. Our module variable
       still holds the address, and if that wins, the app shows a connected
       wallet the user just disconnected — and offers it as a send target. */
    wallet.accounts = [];
    expect(m.solanaAddress()).toBeNull();
    expect(m.mwaAccountInfo()).toBeNull();
  });

  it('a DISCONNECT really disconnects, in this document and the next', async () => {
    androidChrome();
    const wallet = authorizedWallet();
    globalThis.__mwaWallets = { get: () => [wallet] };
    const m = await newDocument();
    await m.registerMobileWalletAdapter(IDENTITY);
    await m.connectSolana();

    await m.disconnectSolana();
    wallet.accounts = [];
    expect(m.solanaAddress()).toBeNull();

    /* and a fresh document agrees — it asks the wallet, finds nothing */
    const after = await newDocument();
    expect(await after.restoreSolanaConnection(IDENTITY)).toBeNull();
  });

  it('reports nothing when the wallet has authorized nothing', async () => {
    androidChrome();
    globalThis.__mwaWallets = {
      get: () => [{ name: 'Mobile Wallet Adapter', features: { 'standard:connect': {} } }]
    };
    const m = await newDocument();
    await m.registerMobileWalletAdapter(IDENTITY);
    expect(m.mwaWalletAccountAddress()).toBeNull();
    expect(m.solanaAddress()).toBeNull();
  });
});

describe('an injected wallet still wins', () => {
  it('prefers the provider over the MWA record', async () => {
    androidChrome();
    globalThis.__mwaWallets = {
      get: () => [authorizedWallet('MWAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')]
    };
    const m = await newDocument();
    await m.registerMobileWalletAdapter(IDENTITY);
    const injected = 'Phantom2222222222222222222222222222222222222222';
    window.phantom = { solana: { isPhantom: true, publicKey: { toString: () => injected } } };
    expect(m.solanaAddress()).toBe(injected);
  });
});
