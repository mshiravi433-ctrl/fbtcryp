/**
 * «در کیف پول داخلی مطمئن شو ارسال و دریافت توکن کار میده»
 * «مطمئن شو کیف پول داخلی و خارجی همه‌چیز کامله و درست کار میده»
 *
 * THE IN-APP WALLET'S MONEY PATH, ON A REAL CHAIN.
 * ---------------------------------------------------------------------------
 * Every assertion here runs against an in-process ganache EVM chain — the same
 * harness `test/split-router/split-router-evm-rehearsal.mjs` uses — with the
 * REAL code the app ships:
 *
 *   · lib/localWallet.js  — PBKDF2-SHA256 + AES-GCM vault, HD derivation
 *   · lib/swap.js         — sendToken() / getTokenBalance(), the exact pair the
 *                           Send sheet and the balance row call
 *   · the compiled MockERC20 from contracts/rehearsal/SplitRouterMocks.sol,
 *     deployed for real, with the same transfer() semantics as any ERC-20
 *
 * Nothing is stubbed on the money path: no fake signer, no fake transfer. A
 * regression in any of those three files fails here with a number, not with a
 * snapshot.
 *
 * What has to hold:
 *   1. creating a vault encrypts the phrase — the plaintext is never in storage
 *   2. a wrong password is refused AND leaves the vault intact
 *   3. the unlocked signer is the vault's own address on the chosen chain
 *   4. a native send arrives exactly (wei for wei), gas excluded
 *   5. an ERC-20 send arrives exactly, at the TOKEN's decimals (USDT is 6)
 *   6. getTokenBalance reads back what the chain holds — the "Balance" line
 *   7. an invalid recipient is refused BEFORE anything is signed
 *   8. insufficient funds is an error, never a silent success
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ganache from 'ganache';
import { Contract, ContractFactory, JsonRpcProvider, Wallet, parseUnits } from 'ethers';

/*
 * lib/localWallet.js persists through localStorage. Node has none, so the
 * harness supplies a real Map-backed one — the module's own try/catch around
 * every call is what a private-mode browser gets, and silently exercising that
 * path instead of the storage path would test nothing.
 */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => store.set(String(k), String(v)),
  removeItem: (k) => store.delete(String(k)),
  clear: () => store.clear()
};

const {
  createVault, unlockVault, generateMnemonic, revealMnemonic, loadVault, hasVault
} = await import('../src/lib/localWallet.js');
const { sendToken, getTokenBalance } = await import('../src/lib/swap.js');
const { ERC20_ABI } = await import('../src/lib/chains.js');
const MOCKS = (await import('./split-router/splitRouterMocksArtifact.json', { with: { type: 'json' } })).default;

/*
 * Ganache 7.9.2 cannot parse EIP-1559 (type-2) raw transactions — its
 * TransactionPool throws "Cannot read properties of null (reading 'length')".
 * ethers v6 builds type-2 whenever the provider reports a priority fee, so
 * this provider answers with legacy pricing only and every signed transaction
 * is type-0. The code under test is untouched; this is the chain, not the app.
 */
class LegacyProvider extends JsonRpcProvider {
  constructor(url) {
    /*
     * `cacheTimeout: -1` turns off ethers' 10-second read cache. Every balance
     * assertion below is a before/after delta, and a cached `getBalance` would
     * happily answer both sides of it with the same stale number — the test
     * would pass on a send that moved nothing.
     */
    super(url, undefined, { cacheTimeout: -1 });
  }

  async getFeeData() {
    const { FeeData } = await import('ethers');
    return new FeeData(BigInt(await this.send('eth_gasPrice', [])), null, null);
  }
}

const FUNDER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const PASSWORD = 'correct-horse-battery';
const RECIPIENT = '0x3333333333333333333333333333333333333333';
const CHAIN_ID = 8453; // Base — the chain the app's own USDC panels pin

let server;
let provider;
let funder;
let usdt; // a real deployed ERC-20, 6 decimals
let vaultAddress;

beforeAll(async () => {
  server = ganache.server({
    logging: { quiet: true },
    chain: { chainId: CHAIN_ID },
    wallet: { accounts: [{ secretKey: FUNDER_KEY, balance: '0x56BC75E2D631000000' }] }
  });
  await new Promise((resolve) => server.listen(0, resolve));
  provider = new LegacyProvider(`http://127.0.0.1:${server.address().port}`);
  funder = new Wallet(FUNDER_KEY, provider);

  const mock = MOCKS.contracts.MockERC20;
  const factory = new ContractFactory(mock.abi, mock.bytecode, funder);
  usdt = await factory.deploy('Tether USD', 'USDT', 6);
  await usdt.waitForDeployment();
}, 120_000);

afterAll(async () => {
  /*
   * ethers keeps a polling timer and live sockets on this provider, and
   * ganache's server.close() waits for them to drain — long enough to blow
   * vitest's default 10 s hook budget on a cold box (observed: the whole file
   * reported as failed with every test inside it green). Drop our side of the
   * connection first, then close with a hard ceiling so a stuck close can
   * never hold the run hostage; the process exits either way.
   */
  try { provider?.destroy?.(); } catch { /* already gone */ }
  if (server) {
    await Promise.race([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000))
    ]);
  }
}, 60_000);

/* The token object exactly as lib/chains.js describes a curated ERC-20. */
const usdtToken = () => ({
  symbol: 'USDT',
  name: 'Tether USD',
  address: usdt.target,
  decimals: 6,
  coingeckoId: 'tether'
});
const nativeToken = { symbol: 'ETH', decimals: 18, native: true };

describe('the in-app wallet: vault, unlock and backup', () => {
  it('creates an encrypted vault and never stores the phrase in the clear', async () => {
    const phrase = await generateMnemonic();
    expect(phrase.split(/\s+/)).toHaveLength(12);

    vaultAddress = await createVault(phrase, PASSWORD);
    expect(vaultAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(hasVault()).toBe(true);

    const blob = loadVault();
    const serialised = JSON.stringify(blob);
    // The backup phrase is the whole wallet. It must exist only encrypted.
    expect(serialised).not.toContain(phrase);
    expect(serialised).not.toContain(phrase.split(' ')[0]);
    expect(blob.kdf).toBe('PBKDF2');
    expect(blob.iterations).toBeGreaterThan(100_000);
    expect(blob.address).toBe(vaultAddress);

    // …and it is still recoverable with the password, which is the promise the
    // backup screen makes.
    expect(await revealMnemonic(PASSWORD)).toBe(phrase);
    await expect(revealMnemonic('wrong-password')).rejects.toThrow('BAD_PASSWORD');
  }, 120_000);

  it('refuses a wrong password and leaves the vault untouched', async () => {
    const before = JSON.stringify(loadVault());
    await expect(unlockVault('not-the-password', provider)).rejects.toThrow('BAD_PASSWORD');
    expect(JSON.stringify(loadVault())).toBe(before);
    expect(hasVault()).toBe(true);
  }, 120_000);

  it('unlocks to a live signer that IS the vault address, on the chosen chain', async () => {
    const signer = await unlockVault(PASSWORD, provider);
    expect(signer.address).toBe(vaultAddress);
    expect(signer.provider).toBe(provider);
    expect(Number((await signer.provider.getNetwork()).chainId)).toBe(CHAIN_ID);
  }, 120_000);
});

describe('the in-app wallet: sending', () => {
  it('sends the native coin, and it arrives exactly', async () => {
    // Fund the vault the way a user would (a transfer in from elsewhere).
    const fund = await funder.sendTransaction({ to: vaultAddress, value: parseUnits('1', 18) });
    await fund.wait();

    const signer = await unlockVault(PASSWORD, provider);
    const before = await provider.getBalance(RECIPIENT);

    const sent = await sendToken({ signer, token: nativeToken, to: RECIPIENT, amount: '0.25' });
    expect(sent.hash).toMatch(/^0x[0-9a-f]{64}$/);
    const receipt = await sent.wait();
    expect(receipt.status).toBe(1);

    // Wei for wei: 0.25 ETH and nothing else, gas paid by the sender.
    expect((await provider.getBalance(RECIPIENT)) - before).toBe(parseUnits('0.25', 18));
  }, 180_000);

  it('sends an ERC-20 at the token’s own decimals, and it arrives exactly', async () => {
    // Mint the vault a balance, as a real USDT holder would have.
    const mint = await usdt.connect(funder).mint(vaultAddress, parseUnits('500', 6));
    await mint.wait();

    const signer = await unlockVault(PASSWORD, provider);
    const before = await usdt.balanceOf(RECIPIENT);

    // 12.34 USDT — six decimals. Sending this as 18 would move a million times
    // too much, which is the classic decimals bug this asserts against.
    const sent = await sendToken({ signer, token: usdtToken(), to: RECIPIENT, amount: '12.34' });
    const receipt = await sent.wait();
    expect(receipt.status).toBe(1);

    expect((await usdt.balanceOf(RECIPIENT)) - before).toBe(parseUnits('12.34', 6));
  }, 180_000);

  it('reads the balance back the way the Send sheet displays it', async () => {
    // getTokenBalance is what the sheet's "Balance / MAX" line renders, so the
    // number a user plans a send against is the number the chain holds.
    const bal = await getTokenBalance(provider, usdtToken(), RECIPIENT);
    expect(bal.raw).toBe(parseUnits('12.34', 6));
    const native = await getTokenBalance(provider, nativeToken, RECIPIENT);
    expect(native.raw).toBe(parseUnits('0.25', 18));
  }, 120_000);

  it('refuses an invalid recipient before anything is signed', async () => {
    const signer = await unlockVault(PASSWORD, provider);
    const before = await provider.getBalance(RECIPIENT);
    await expect(sendToken({ signer, token: nativeToken, to: '0xnope', amount: '0.01' }))
      .rejects.toThrow('INVALID_ADDRESS');
    expect(await provider.getBalance(RECIPIENT)).toBe(before);
  }, 120_000);

  it('reports insufficient funds as an error, never as a success', async () => {
    const signer = await unlockVault(PASSWORD, provider);
    // The vault holds 500 USDT; asking for more must fail loudly.
    await expect(sendToken({ signer, token: usdtToken(), to: RECIPIENT, amount: '100000' }))
      .rejects.toThrow();
    expect(await usdt.balanceOf(RECIPIENT)).toBe(parseUnits('12.34', 6));
  }, 120_000);
});

describe('the external-wallet path uses the same send code', () => {
  it('a plain EOA signer (MetaMask / Trust / WalletConnect shape) sends through sendToken', async () => {
    /*
     * An external wallet differs from the in-app one only in WHO signs: the
     * transaction this app builds is identical. Asserting it here is what makes
     * «کیف پول داخلی و خارجی … درست کار میده» one claim instead of two code
     * paths that can drift — sendToken() has no branch on wallet kind.
     */
    const external = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', provider);
    /* Gas first: an ERC-20 transfer is still paid for in the chain's own coin,
       and an external wallet that holds only the token cannot send it. */
    const gasFund = await funder.sendTransaction({ to: external.address, value: parseUnits('0.5', 18) });
    await gasFund.wait();
    const mint = await usdt.connect(funder).mint(external.address, parseUnits('7', 6));
    await mint.wait();

    const before = await usdt.balanceOf(RECIPIENT);
    const sent = await sendToken({ signer: external, token: usdtToken(), to: RECIPIENT, amount: '2.5' });
    expect((await sent.wait()).status).toBe(1);
    expect((await usdt.balanceOf(RECIPIENT)) - before).toBe(parseUnits('2.5', 6));

    // …and the same signer can move the native coin.
    const nativeBefore = await provider.getBalance(RECIPIENT);
    const nativeSent = await sendToken({ signer: external, token: nativeToken, to: RECIPIENT, amount: '0.1' });
    await nativeSent.wait();
    expect((await provider.getBalance(RECIPIENT)) - nativeBefore).toBe(parseUnits('0.1', 18));
  }, 180_000);

  it('the app’s own ERC-20 ABI reads a real token correctly', async () => {
    /*
     * sendToken() builds its calldata from ERC20_ABI in lib/chains.js. If that
     * ABI ever drifts from what a deployed token implements, EVERY token send
     * breaks at once and the wallet screen shows "failed" for a transfer that
     * was correctly built — so the app's ABI is pointed at a real contract here.
     */
    const token = new Contract(usdt.target, ERC20_ABI, provider);
    expect(Number(await token.decimals())).toBe(6);
    expect((await token.balanceOf(RECIPIENT)) > 0n).toBe(true);
    expect(await token.symbol()).toBe('USDT');
  }, 120_000);
});
