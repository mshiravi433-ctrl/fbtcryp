export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const learning = await import('../../src/lib/intent-ai/learningOptIn.js');

  // Mock localStorage so we can observe persistence + clear, in-memory.
  const mem = new Map();
  const store = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  };
  globalThis.localStorage = store;

  const session = { id: 's1', learningOptIn: true, audit: [] };

  // Without opt-in → no store, no send.
  learning.recordLearningSample({ id: 's0', learningOptIn: false, audit: [] }, { kind: 'outcome', strategy: 'spot_swap', outcome: 'COMPLETED', confirmed: true });
  t('no opt-in → nothing stored', learning.loadLearningSamples().length === 0);

  // Opt-in stored record is anonymous.
  const rec = learning.recordLearningSample(session, {
    kind: 'outcome', intent: 'swap', strategy: 'spot_swap', outcome: 'COMPLETED', confirmed: true, confidence: 40
  });
  t('opt-in record stored', rec.ok && rec.stored);
  const samples = learning.loadLearningSamples();
  t('one sample present', samples.length === 1);

  t('record carry no forbidden keys', !('address' in samples[0]) && !('userId' in samples[0]) && !('ip' in samples[0]) && !('txHash' in samples[0]));
  t('record carries honest disclaimer', samples[0].disclaimer === 'NOT_GUARANTEED');

  // Fabricated success refused even with opt-in.
  const fake = learning.recordLearningSample(session, { kind: 'outcome', strategy: 'x', outcome: 'COMPLETED', confirmed: false });
  t('fabricated success refused', fake.ok === false);

  // User can clear.
  learning.clearLearningSamples();
  t('user can clear samples', learning.loadLearningSamples().length === 0);

  // Consent reflective helper.
  t('learningConsent reflects opt-in', learning.learningConsent(session) === true && learning.learningConsent({ learningOptIn: false }) === false);

  // Missing record fails closed.
  t('missing record fails closed', learning.recordLearningSample(session, {}).ok === false);

  delete globalThis.localStorage;
  return rows;
}
