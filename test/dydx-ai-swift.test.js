// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { executeAiGatewayChat } from '../src/lib/aiGatewayClient.js';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.localStorage.clear(); });

it('uses the explicit swift timeout even if the global AI setting is deep', async () => {
  vi.useFakeTimers();
  window.localStorage.setItem('fbt.ai.intelligence.v1', 'max');
  const fetcher = vi.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  vi.stubGlobal('fetch', fetcher);
  const result = executeAiGatewayChat({ taskType: 'fast', intelligence: 'swift', user: 'test' });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).intelligence).toBe('swift');
  await vi.advanceTimersByTimeAsync(15_000);
  expect((await result).error).toBe('TIMEOUT');
});
