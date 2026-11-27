import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createWcSession } from '../src/lib/wc/session.js';

const metadata = { url: 'https://example.com', icons: [] };
function storage() {
  const data = new Map([['wc@2:client:0.3//session', '[{}]']]);
  return { get length() { return data.size; }, key: i => [...data.keys()][i],
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key) };
}
function provider(session = { self: { metadata }, namespaces: {} }) {
  return { session, accounts: ['0x1111111111111111111111111111111111111111'],
    signer: { client: { metadata: { ...metadata } } },
    disconnects: 0, async disconnect() { this.disconnects++; }, on() {}, removeListener() {} };
}
afterEach(() => { delete globalThis.localStorage; });

test('restore does not disconnect the provider that just initialized; explicit disconnect does', async () => {
  globalThis.localStorage = storage();
  const instance = provider();
  const manager = createWcSession({ metadata, chains: [56], initEthereumProvider: async () => instance });
  const result = await manager.restore();
  assert.equal(result.ok, true);
  assert.equal(result.address, instance.accounts[0]);
  assert.equal(instance.disconnects, 0);
  assert.equal((await manager.restore()).provider, instance);
  await manager.disconnect();
  assert.equal(instance.disconnects, 1);
});

test('a failed silent restore does not revoke a session', async () => {
  globalThis.localStorage = storage();
  const instance = provider(null);
  const manager = createWcSession({ metadata, chains: [56], initEthereumProvider: async () => instance });
  assert.equal((await manager.restore()).code, 'WC_NO_SESSION');
  assert.equal(instance.disconnects, 0);
});
