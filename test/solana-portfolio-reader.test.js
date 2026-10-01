import { afterEach, describe, expect, it, vi } from 'vitest';

const rpcState = vi.hoisted(() => ({ handler: null }));

vi.mock('../src/lib/solanaRpc.js', () => ({
  readSolanaNetworkSettings: vi.fn(async () => ({ network: 'mainnet-beta' })),
  solanaRpcCandidates: vi.fn(() => ['https://rpc.test']),
  solanaRpcCall: vi.fn((url, method, params) => rpcState.handler(url, method, params))
}));

import { readSolanaPortfolio, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '../src/lib/solana/portfolio.js';

const OWNER = 'AMU6pRs8Hs9FEcA2hgcvrWeVprqvMPSJoQzEkB3kqFoR';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const UNKNOWN = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

const tokenAccount = (mint, amount, decimals) => ({
  account: {
    data: {
      parsed: {
        info: {
          mint,
          tokenAmount: { amount, decimals }
        }
      }
    }
  }
});

afterEach(() => {
  rpcState.handler = null;
  vi.clearAllMocks();
});

describe('readSolanaPortfolio', () => {
  it('reads native SOL and non-zero SPL holdings from both token programs', async () => {
    const calledPrograms = [];
    rpcState.handler = async (_url, method, params) => {
      if (method === 'getBalance') return { ok: true, result: { value: 2_500_000_000 } };
      const program = params?.[1]?.programId;
      calledPrograms.push(program);
      return {
        ok: true,
        result: { value: program === TOKEN_PROGRAM_ID ? [tokenAccount(USDC, '12500000', 6)] : [tokenAccount(UNKNOWN, '900', 2)] }
      };
    };

    const result = await readSolanaPortfolio(OWNER);
    expect(result.ok).toBe(true);
    expect(result.partial).toBe(false);
    expect(calledPrograms).toEqual(expect.arrayContaining([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]));
    expect(result.holdings).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: 'SOL', native: true, amount: '2.5' }),
      expect.objectContaining({ symbol: 'USDC', amount: '12.5', mint: USDC }),
      expect.objectContaining({ mint: UNKNOWN, amount: '9' })
    ]));
  });

  it('preserves readable balances but marks a failed token-program read partial', async () => {
    rpcState.handler = async (_url, method, params) => {
      if (method === 'getBalance') return { ok: true, result: { value: 1_000_000_000 } };
      if (params?.[1]?.programId === TOKEN_2022_PROGRAM_ID) return { ok: false, reason: 'RPC_UNAVAILABLE' };
      return { ok: true, result: { value: [tokenAccount(USDC, '5000000', 6)] } };
    };

    const result = await readSolanaPortfolio(OWNER);
    expect(result.ok).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.holdings).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: 'SOL', amount: '1' }),
      expect.objectContaining({ symbol: 'USDC', amount: '5' })
    ]));
  });

  it('never reports failed reads as an empty wallet', async () => {
    rpcState.handler = async () => ({ ok: false, reason: 'RPC_UNAVAILABLE' });
    const result = await readSolanaPortfolio(OWNER);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RPC_UNAVAILABLE');
    expect(result.holdings).toEqual([]);
  });
});
