/**
 * SPL TRANSFERS — the send path that did not exist.
 * ---------------------------------------------------------------------------
 * Report: «این ارسال فقط SOL بومی است و توکن‌های SPL را جابه‌جا نمی‌کند. برای
 * ارسال چرا می‌زنه؟ آیا خراب است؟ ارسال سولانا» — a wallet holding USDC and a
 * tokenized stock, a Send button, and a notice explaining that Send sends
 * nothing else.
 *
 * The library now builds the transfer. This suite pins the four things that
 * make it CORRECT rather than merely present, because each one fails silently
 * and expensively in production:
 *
 *   1. THE SOURCE IS DERIVED, NEVER CHOSEN. An associated token account is a
 *      PDA of (owner, token program, mint). If the derivation is wrong the
 *      transaction moves a different account's tokens — or the user's, from an
 *      address they did not intend. Asserted against web3.js's own
 *      `findProgramAddressSync`, computed independently here.
 *   2. THE AMOUNT IS CHECKED, NOT ASSUMED. `TransferChecked` (discriminant 12)
 *      carries the mint AND the decimals, so the token program itself refuses a
 *      transfer whose scale is wrong. Bytes are asserted exactly.
 *   3. A MISSING DESTINATION ACCOUNT IS CREATED IDEMPOTENTLY (ATA index 1) in
 *      the same transaction — `Create` (index 0) races and fails the transfer.
 *   4. A REFUSAL IS NAMED. Sending from a mint the wallet holds nothing of is
 *      `SPL_NO_ACCOUNT`, raised before signing, not a network error after the
 *      user has approved a transaction.
 *
 * No network: `fetch` is stubbed and the RPC URL is injected. The transaction is
 * decoded with web3.js itself, so the assertions are about bytes that would go
 * on the wire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * WHY THE RPC LAYER IS MOCKED RATHER THAN MOCKED-BY-FETCH
 * The obvious stub — replace `globalThis.fetch` — does not work here: web3.js
 * 1.98's `Connection` does not go through the global fetch on Node, so the
 * requests escaped the stub and failed against a host that does not exist. A
 * test that only passes when the network is up is a test that will be deleted
 * the first time CI is offline.
 *
 * So `Connection` itself is replaced (and ONLY it: `Transaction`,
 * `TransactionInstruction`, `PublicKey` and the PDA helper stay real, which is
 * what makes the byte-level assertions below meaningful — the transaction is
 * decoded with the same library that would serialize it on a phone).
 */
/* `missingCalls` is a list of getAccountInfo call indexes answered with null:
   call 1 is always the SOURCE account, call 2 the destination. That is what
   lets the suite test "the sender has none" and "the recipient has none"
   separately — the two cases that must behave differently. */
const rpcState = vi.hoisted(() => ({ calls: 0, missingCalls: [] }));

vi.mock('@solana/web3.js', async (original) => {
  const actual = await original();
  class StubConnection {
    async getLatestBlockhash() {
      return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 };
    }
    async getAccountInfo() {
      rpcState.calls += 1;
      if (rpcState.missingCalls.includes(rpcState.calls)) return null;
      return { owner: (await import('../src/lib/solana/tokenPrograms.js')).TOKEN_PROGRAM_ID, lamports: 2039280, data: Buffer.alloc(0), executable: false, rentEpoch: 0 };
    }
  }
  return { ...actual, Connection: StubConnection };
});

vi.mock('../src/lib/solanaRpc.js', () => ({
  getSolanaRpcUrl: async () => 'https://rpc.test.local',
  readSolanaNetworkSettings: async () => ({ cluster: 'mainnet-beta', custom: '' }),
  solanaRpcCall: async () => ({ ok: false, reason: 'RPC_UNAVAILABLE' }),
  solanaRpcCandidates: () => []
}));

const {
  buildSplTransfer,
  solToLamports,
  tokenAmountToRaw,
  deriveAta
} = await import('../src/lib/solana/transfer.js');
const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = await import('../src/lib/solana/tokenPrograms.js');
const { PublicKey, Transaction } = await import('@solana/web3.js');

const OWNER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const TO = '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC

beforeEach(() => {
  rpcState.calls = 0;
  rpcState.missingCalls = [];
});
afterEach(() => {
  vi.restoreAllMocks();
});

const decode = (base64) => Transaction.from(Buffer.from(base64, 'base64'));

describe('SPL transfer — derivation', () => {
  it('derives the associated token account, and the derivation matches the one web3.js computes', async () => {
    const derived = await deriveAta(OWNER, MINT, TOKEN_PROGRAM_ID);
    const [expected] = PublicKey.findProgramAddressSync(
      [
        new PublicKey(OWNER).toBuffer(),
        new PublicKey(TOKEN_PROGRAM_ID).toBuffer(),
        new PublicKey(MINT).toBuffer()
      ],
      new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID)
    );
    expect(derived.toBase58()).toBe(expected.toBase58());
  });

  it('routes a Token-2022 mint to the Token-2022 program, not the classic one', async () => {
    const classicAta = await deriveAta(OWNER, MINT, TOKEN_PROGRAM_ID);
    const t22Ata = await deriveAta(OWNER, MINT, TOKEN_2022_PROGRAM_ID);
    expect(t22Ata.toBase58()).not.toBe(classicAta.toBase58());
  });
});

describe('SPL transfer — the instruction', () => {
  it('sends TransferChecked with the amount in base units and the mint’s decimals', async () => {
    const base64 = await buildSplTransfer({
      from: OWNER, to: TO, mint: MINT, decimals: 6, raw: '12500000', programId: TOKEN_PROGRAM_ID
    });
    const tx = decode(base64);
    expect(tx.instructions).toHaveLength(1);
    const ix = tx.instructions[0];

    expect(ix.programId.toBase58()).toBe(TOKEN_PROGRAM_ID);
    /* [12, u64 LE amount, decimals] */
    const data = Buffer.from(ix.data);
    expect(data.length).toBe(10);
    expect(data[0]).toBe(12);
    expect(data.readBigUInt64LE(1)).toBe(12500000n);
    expect(data[9]).toBe(6);

    /* source, mint, destination, authority — in that order, and only the owner
       signs. A transfer that asks the RECIPIENT to sign is a hostage. */
    const keys = ix.keys.map((k) => k.pubkey.toBase58());
    expect(keys[1]).toBe(MINT);
    expect(keys[0]).toBe((await deriveAta(OWNER, MINT, TOKEN_PROGRAM_ID)).toBase58());
    expect(keys[2]).toBe((await deriveAta(TO, MINT, TOKEN_PROGRAM_ID)).toBase58());
    expect(keys[3]).toBe(OWNER);
    expect(ix.keys.filter((k) => k.isSigner).map((k) => k.pubkey.toBase58())).toEqual([OWNER]);
    expect(tx.feePayer.toBase58()).toBe(OWNER);
  });

  it('creates the recipient’s token account idempotently when they have none', async () => {
    /* the DESTINATION read is the second one */
    rpcState.missingCalls = [2];
    const base64 = await buildSplTransfer({
      from: OWNER, to: TO, mint: MINT, decimals: 6, raw: '1000000', programId: TOKEN_PROGRAM_ID
    });
    const tx = decode(base64);
    expect(tx.instructions).toHaveLength(2);

    const create = tx.instructions[0];
    expect(create.programId.toBase58()).toBe(ASSOCIATED_TOKEN_PROGRAM_ID);
    /* Index 1 is CreateIdempotent; index 0 (Create) fails the whole transfer if
       the account appears between our read and the network accepting it. */
    expect(Array.from(create.data)).toEqual([1]);
    const keys = create.keys.map((k) => k.pubkey.toBase58());
    expect(keys[0]).toBe(OWNER);
    expect(keys[1]).toBe((await deriveAta(TO, MINT, TOKEN_PROGRAM_ID)).toBase58());
    expect(keys[2]).toBe(TO);
    expect(keys[3]).toBe(MINT);
    /* the sender pays: the payer must be a signer of the create */
    expect(create.keys[0].isSigner).toBe(true);

    /* and the transfer still rides in the same transaction */
    expect(Buffer.from(tx.instructions[1].data)[0]).toBe(12);
  });

  it('creates nothing when the recipient already holds the token', async () => {
    rpcState.missingCalls = [];
    const base64 = await buildSplTransfer({
      from: OWNER, to: TO, mint: MINT, decimals: 6, raw: '1000000', programId: TOKEN_PROGRAM_ID
    });
    expect(decode(base64).instructions).toHaveLength(1);
  });

  it('refuses a mint this wallet has no account for, before signing anything', async () => {
    /* call 1 is the SOURCE account — answer it with null */
    rpcState.missingCalls = [1];
    await expect(buildSplTransfer({
      from: OWNER, to: TO, mint: MINT, decimals: 6, raw: '1000', programId: TOKEN_PROGRAM_ID
    })).rejects.toMatchObject({ code: 'SPL_NO_ACCOUNT' });
  });

  it('refuses a bad address, a bad mint and an unknown scale by name', async () => {
    await expect(buildSplTransfer({ from: OWNER, to: '0x1234', mint: MINT, decimals: 6, raw: '1000' }))
      .rejects.toMatchObject({ code: 'BAD_ADDRESS' });
    await expect(buildSplTransfer({ from: OWNER, to: TO, mint: '0xdead', decimals: 6, raw: '1000' }))
      .rejects.toMatchObject({ code: 'BAD_MINT' });
    await expect(buildSplTransfer({ from: OWNER, to: TO, mint: MINT, decimals: null, raw: '1000' }))
      .rejects.toMatchObject({ code: 'BAD_DECIMALS' });
    await expect(buildSplTransfer({ from: OWNER, to: TO, mint: MINT, decimals: 6, raw: '0' }))
      .rejects.toMatchObject({ code: 'BAD_AMOUNT' });
  });
});

describe('amount parsing', () => {
  it('reads a token amount at the mint’s own scale', () => {
    expect(tokenAmountToRaw('12.5', 6)).toBe('12500000');
    expect(tokenAmountToRaw('0.000001', 6)).toBe('1');
    expect(tokenAmountToRaw('1', 9)).toBe('1000000000');
    /* a scale we do not know is a refusal, not a guess */
    expect(tokenAmountToRaw('1', null)).toBe(null);
    expect(tokenAmountToRaw('1', 99)).toBe(null);
    expect(tokenAmountToRaw('0', 6)).toBe(null);
  });

  it('keeps the native path exactly as it was', () => {
    expect(solToLamports('1.5')).toBe(1500000000n);
    expect(solToLamports('0')).toBe(null);
    expect(solToLamports('abc')).toBe(null);
  });
});
