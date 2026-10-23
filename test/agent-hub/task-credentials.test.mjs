#!/usr/bin/env node
/**
 * User-supplied A2A credentials remain owner-scoped across poll and cancel.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createTaskBroker } from '../../server/agentHub/tasks.js';

const OWNER = 'device:task-credential-test';
const PROVIDER_ID = 'u-task-credential-test';
const REMOTE_ID = 'remote-task-42';
const CREDENTIAL = { headers: { authorization: 'Bearer user-owned-secret' } };

function harness({ userCredentialUsed, credentialResult = { ok: true, credential: CREDENTIAL } } = {}) {
  let task = {
    id: 'task_credential_test',
    owner: OWNER,
    providerId: PROVIDER_ID,
    providerName: 'User-owned agent',
    agentId: `${PROVIDER_ID}:skill`,
    agentName: 'User-owned skill',
    state: 'running',
    remoteTaskId: REMOTE_ID,
    createdAt: 1,
    lastProviderSyncAt: 1,
    supportsCancellation: true,
    ...(userCredentialUsed === undefined ? {} : { userCredentialUsed })
  };
  const credentialCalls = [];
  const getTaskCredentials = [];
  const cancelCredentials = [];
  const provider = { id: PROVIDER_ID, name: 'User-owned agent', userSupplied: true, accessModel: 'FREE_PUBLIC' };
  const store = {
    durable: () => true,
    async getTask(owner, taskId) {
      return owner === OWNER && taskId === task.id
        ? { ok: true, task }
        : { ok: false, code: 'TASK_NOT_FOUND' };
    },
    async putTask(owner, nextTask) {
      if (owner === OWNER) task = nextTask;
      return { ok: true, durable: true };
    },
    async appendEvent() { return { ok: true }; },
    async listEvents() { return { events: [] }; },
    async linkRemoteTask() { return { ok: true }; },
    async appendUsage() { return { ok: true }; }
  };
  const adapter = {
    async getTask(remoteTaskId, credential) {
      getTaskCredentials.push({ remoteTaskId, credential });
      return { ok: true, state: 'running', providerStatus: 'working' };
    },
    async cancelTask(remoteTaskId, credential) {
      cancelCredentials.push({ remoteTaskId, credential });
      return { ok: true, state: 'canceled' };
    }
  };
  const broker = createTaskBroker({
    registry: { get: () => null },
    adapters: { for: () => adapter },
    store,
    connections: { async credentialFor() { return { ok: false, code: 'CREDENTIAL_NOT_FOUND' }; } },
    userSources: {
      async providerFor({ owner, providerId }) {
        return owner === OWNER && providerId === PROVIDER_ID ? provider : null;
      }
    },
    sourceCredentials: {
      async credentialFor(args) {
        credentialCalls.push(args);
        return credentialResult;
      }
    },
    env: { AGENT_HUB_ENABLED: 'true' },
    now: () => 50_000
  });
  return { broker, credentialCalls, getTaskCredentials, cancelCredentials, get task() { return task; } };
}

describe('A2A task credentials', () => {
  it('recovers the saved owner key for legacy tasks, polling and cancellation', async () => {
    const test = harness();
    const polled = await test.broker.getTask({ owner: OWNER, taskId: 'task_credential_test' });
    assert.equal(polled.ok, true);
    assert.deepEqual(test.getTaskCredentials, [{ remoteTaskId: REMOTE_ID, credential: CREDENTIAL }]);

    const canceled = await test.broker.cancelTask({ owner: OWNER, taskId: 'task_credential_test' });
    assert.equal(canceled.ok, true);
    assert.deepEqual(test.cancelCredentials, [{ remoteTaskId: REMOTE_ID, credential: CREDENTIAL }]);
    assert.equal(test.credentialCalls.length, 2);
    assert.equal(JSON.stringify(polled).includes('user-owned-secret'), false);
  });

  it('does not attach a key added after a task explicitly started without one', async () => {
    const test = harness({ userCredentialUsed: false });
    const polled = await test.broker.getTask({ owner: OWNER, taskId: 'task_credential_test' });
    assert.equal(polled.ok, true);
    const canceled = await test.broker.cancelTask({ owner: OWNER, taskId: 'task_credential_test' });
    assert.equal(canceled.ok, true);
    assert.deepEqual(test.getTaskCredentials, [{ remoteTaskId: REMOTE_ID, credential: null }]);
    assert.deepEqual(test.cancelCredentials, [{ remoteTaskId: REMOTE_ID, credential: null }]);
    assert.equal(test.credentialCalls.length, 0);
  });

  it('never polls without a key when a task records that the key was used', async () => {
    const test = harness({ userCredentialUsed: true, credentialResult: { ok: false, code: 'CREDENTIAL_STORE_UNAVAILABLE' } });
    const polled = await test.broker.getTask({ owner: OWNER, taskId: 'task_credential_test' });
    assert.equal(polled.ok, true);
    assert.equal(polled.task.state, 'reconciling');
    assert.equal(polled.task.errorCode, 'SOURCE_CREDENTIAL_UNAVAILABLE');
    assert.deepEqual(test.getTaskCredentials, []);
  });
});
