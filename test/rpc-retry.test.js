import { describe, expect, it } from 'vitest';
import { withRpcRetry } from '../src/lib/defi/rpcRetry';
import { EVM_CHAINS } from '../src/lib/chains.js';

describe('rpc read retry (the «شبکه در دسترس نیست» fix)', () => {
  it('returns the first successful attempt and retries transient failures', async () => {
    let attempts = 0;
    const result = await withRpcRetry(
      () => { attempts += 1; if (attempts < 3) throw new Error('socket hang up'); return 'stETH position'; },
      { attempts: 3, delayMs: 1, label: 'unit' }
    );
    expect(result).toBe('stETH position');
    expect(attempts).toBe(3);
  });

  it('rethrows the last error after exhausting attempts', async () => {
    let attempts = 0;
    await expect(withRpcRetry(
      () => { attempts += 1; throw new Error('429 Too Many Requests'); },
      { attempts: 3, delayMs: 1, label: 'unit' }
    )).rejects.toThrow('429');
    expect(attempts).toBe(3);
  });

  it('never retries when the first read succeeds', async () => {
    let attempts = 0;
    const result = await withRpcRetry(() => { attempts += 1; return 42n; }, { attempts: 3, delayMs: 1, label: 'unit' });
    expect(result).toBe(42n);
    expect(attempts).toBe(1);
  });

  it('clamps nonsensical attempt counts to at least one', async () => {
    await expect(withRpcRetry(async () => 'ok', { attempts: 0, delayMs: 1, label: 'unit' })).resolves.toBe('ok');
  });

  it('gives every farm execution chain at least three public RPC endpoints', () => {
    // Ethereum (Lido), Base (Aave/Compound/Morpho), Arbitrum (Aave). Two
    // endpoints meant a single rate-limited provider could take the whole
    // read path down; the widened lists are the other half of this fix.
    for (const chainId of [1, 8453, 42161]) {
      const chain = EVM_CHAINS[chainId];
      expect(chain, `chain ${chainId} missing from EVM_CHAINS`).toBeTruthy();
      const urls = chain.rpc || [];
      expect(urls.length, `chain ${chainId} should have >=3 rpc urls`).toBeGreaterThanOrEqual(3);
      for (const url of urls) expect(url.startsWith('https://')).toBe(true);
    }
  });
});
