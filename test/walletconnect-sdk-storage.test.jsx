// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { storedSessionStatus } from '../src/lib/wc/storage.js';

afterEach(() => { delete globalThis.indexedDB; localStorage.clear(); });

it('detects the exact IndexedDB key written by the real WalletConnect SDK', async () => {
  const idb = new IDBFactory();
  globalThis.indexedDB = idb;
  const { KeyValueStorage } = await import('../node_modules/@walletconnect/core/node_modules/@walletconnect/keyvaluestorage/dist/index.es.js');
  const sdkStore = new KeyValueStorage();
  await sdkStore.setItem('wc@2:client:0.3//session', [{ topic: 'sdk-session' }]);
  const keys = await sdkStore.getKeys();
  expect(keys).toContain('wc@2:client:0.3:session');
  expect(await storedSessionStatus({ indexedDb: idb })).toBe('found');
});
