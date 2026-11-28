import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { storedSessionStatus, purgeIndexedWcKeys } from '../src/lib/wc/storage.js';
import { createWcSession } from '../src/lib/wc/session.js';

const DB = 'WALLET_CONNECT_V2_INDEXED_DB';
const KEY = 'wc@2:client:0.3:session';
async function database() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keyvaluestorage');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function put(key, value) {
  const db = await database();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('keyvaluestorage', 'readwrite');
    tx.objectStore('keyvaluestorage').put(value, key);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
}
afterEach(async () => {
  delete globalThis.indexedDB;
  await new Promise((resolve) => { const req = indexedDB.deleteDatabase(DB); req.onsuccess = req.onerror = resolve; });
});

test('detects the SDK normalized IndexedDB session and clears it only on explicit reset', async () => {
  await put(KEY, JSON.stringify([{ topic: 'abc' }]));
  await put('unrelated', 'keep');
  assert.equal(await storedSessionStatus({ indexedDb: indexedDB }), 'found');
  assert.equal(await purgeIndexedWcKeys({ indexedDb: indexedDB }), true);
  assert.equal(await storedSessionStatus({ indexedDb: indexedDB }), 'missing');
  const db = await database();
  const value = await new Promise(resolve => { const req = db.transaction('keyvaluestorage').objectStore('keyvaluestorage').get('unrelated'); req.onsuccess = () => resolve(req.result); });
  assert.equal(value, 'keep'); db.close();
});

test('restores an SDK session stored exclusively in IndexedDB', async () => {
  globalThis.indexedDB = indexedDB;
  await put(KEY, JSON.stringify([{ topic: 'abc' }]));
  const metadata = { url: 'https://example.com', icons: [] };
  const provider = { session: { self: { metadata }, namespaces: {} },
    accounts: ['0x1111111111111111111111111111111111111111'],
    signer: { client: { metadata: { ...metadata } } }, on() {}, removeListener() {},
    async disconnect() { throw new Error('must not revoke on restore'); } };
  const session = createWcSession({ metadata, chains: [56], initEthereumProvider: async () => provider });
  const result = await session.restore();
  assert.equal(result.ok, true);
  assert.equal(result.address, provider.accounts[0]);
  assert.equal(await storedSessionStatus({ indexedDb: indexedDB }), 'found');
});

test('an unreadable database is not mistaken for a missing session', async () => {
  const broken = { open() { throw new Error('blocked'); } };
  assert.equal(await storedSessionStatus({ indexedDb: broken }), 'unknown');
});
