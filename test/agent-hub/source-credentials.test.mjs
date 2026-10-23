#!/usr/bin/env node
/**
 * BYO A2A credentials: durable-only storage, owner-scoped unsealing and RPC use.
 * No external provider is called; the adapter's request boundary is inspected.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSourceCredentials } from '../../server/agentHub/sourceCredentials.js';
import { createA2AAdapter } from '../../server/agentHub/adapters/a2a.js';

const OWNER = 'device:credential-test';
const SOURCE = 'u-credential-test';
const SECRET = 'user-key-never-return-this';
const ENV = { AGENT_HUB_SECRET_KEY: 'c'.repeat(64) };

function memoryStore({ isDurable = true, failRead = false, failWrite = false } = {}) {
  const rows = new Map();
  let writeFailure = failWrite;
  return {
    rows,
    durable: () => isDurable,
    failWrites(value) { writeFailure = value === true; },
    async getFresh(key, fallback) {
      if (failRead) throw new Error('fixture store read failed');
      return rows.has(key) ? rows.get(key) : fallback;
    },
    async set(key, value) {
      if (writeFailure) throw new Error('fixture store write failed');
      if (value === null) rows.delete(key);
      else rows.set(key, value);
      return value;
    }
  };
}

const userSources = {
  async providerFor({ owner, providerId }) {
    return owner === OWNER && providerId === SOURCE ? { id: SOURCE, userSupplied: true } : null;
  }
};

const credentialsFor = (storage) => createSourceCredentials({ userSources, env: ENV, storage });

describe('BYO credential storage', () => {
  it('refuses to save a key to an in-memory-only store', async () => {
    const storage = memoryStore({ isDurable: false });
    const credentials = credentialsFor(storage);
    const out = await credentials.save({ owner: OWNER, sourceId: SOURCE, secret: SECRET });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'CREDENTIAL_STORE_REQUIRED');
    assert.equal(storage.rows.size, 0);
    assert.equal(credentials.capability().durable, false);
  });

  it('seals the key durably, returns no secret, and sends its header to the agent RPC', async () => {
    const storage = memoryStore();
    const credentials = credentialsFor(storage);
    const saved = await credentials.save({
      owner: OWNER,
      sourceId: SOURCE,
      headerName: 'authorization',
      scheme: 'bearer',
      secret: SECRET
    });
    assert.equal(saved.ok, true);
    assert.equal(JSON.stringify(saved).includes(SECRET), false);
    assert.equal([...storage.rows.values()].some((value) => String(value).includes(SECRET)), false);

    const recovered = await credentials.credentialFor({ owner: OWNER, sourceId: SOURCE });
    assert.deepEqual(recovered, { ok: true, credential: { headers: { authorization: `Bearer ${SECRET}` } } });

    let rpcRequest;
    const adapter = createA2AAdapter({
      provider: {
        id: SOURCE,
        name: 'User agent',
        allowedHosts: ['agent.example.com'],
        cardUrl: 'https://agent.example.com/card',
        rpcUrl: 'https://agent.example.com/rpc'
      },
      env: {},
      request: async (request) => {
        rpcRequest = request;
        return { ok: true, status: 200, json: { result: { id: 'remote-1', status: { state: 'completed' } } } };
      }
    });
    const task = await adapter.createTask({ text: 'do the requested work', messageId: 'msg-1', remoteAgentId: `${SOURCE}:skill` }, recovered.credential);
    assert.equal(task.ok, true);
    assert.equal(rpcRequest.headers.authorization, `Bearer ${SECRET}`);
    assert.equal(JSON.stringify(rpcRequest.body).includes(SECRET), false);
    assert.equal(rpcRequest.url, 'https://agent.example.com/rpc');
  });

  it('fails closed when the durable store cannot be read', async () => {
    const credentials = credentialsFor(memoryStore({ failRead: true }));
    const out = await credentials.credentialFor({ owner: OWNER, sourceId: SOURCE });
    assert.deepEqual(out, { ok: false, code: 'CREDENTIAL_STORE_UNAVAILABLE' });
  });

  it('reports a damaged authentication tag as unreadable, never as an absent optional key', async () => {
    const storage = memoryStore();
    const credentials = credentialsFor(storage);
    await credentials.save({ owner: OWNER, sourceId: SOURCE, secret: SECRET });
    const [secretStorageKey] = [...storage.rows.keys()].filter((key) => key.includes(':u-credential-test:'));
    assert.ok(secretStorageKey);
    storage.rows.set(secretStorageKey, 'not-a-sealed-credential');
    const out = await credentials.credentialFor({ owner: OWNER, sourceId: SOURCE });
    assert.deepEqual(out, { ok: false, code: 'CREDENTIAL_UNREADABLE' });
  });

  it('keeps the previously committed key active if replacing the durable row fails', async () => {
    const storage = memoryStore();
    const credentials = credentialsFor(storage);
    assert.equal((await credentials.save({ owner: OWNER, sourceId: SOURCE, secret: 'old-user-key-001' })).ok, true);
    const previous = await credentials.credentialFor({ owner: OWNER, sourceId: SOURCE });
    assert.equal(previous.credential.headers.authorization, 'Bearer old-user-key-001');

    storage.failWrites(true);
    const failed = await credentials.save({ owner: OWNER, sourceId: SOURCE, secret: 'new-user-key-002' });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'CREDENTIAL_STORE_UNAVAILABLE');
    const stillActive = await credentials.credentialFor({ owner: OWNER, sourceId: SOURCE });
    assert.equal(stillActive.credential.headers.authorization, 'Bearer old-user-key-001');
  });
});
