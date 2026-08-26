export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const memMod = await import('../../src/lib/intent-ai/adaptiveMemory.js');

  // Mock localStorage so we can observe persistence + clear.
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k)
  };

  // Without opt-in → memory empty.
  memMod.rememberOutcome({ learningOptIn: false, audit: [] }, { kind: 'outcome', strategy: 'spot_swap', outcome: 'COMPLETED', confirmed: true });
  t('no opt-in → memory empty', memMod.loadMemory().length === 0);

  // With opt-in → memory has records.
  const rec = memMod.rememberOutcome({ learningOptIn: true, audit: [] }, { kind: 'outcome', strategy: 'spot_swap', outcome: 'COMPLETED', confirmed: true, confidence: 40 });
  t('opt-in record stored', rec.ok && rec.stored);
  const loaded = memMod.loadMemory();
  t('memory holds the record', loaded.length === 1);

  // Aggregate stats are PII-free and honest.
  const stats = memMod.memoryStats(loaded);
  t('memory stats are PII-free', stats.pii === false);
  t('memory stats carry honest disclaimer', stats.disclaimer === 'NOT_GUARANTEED');
  t('memory stats are bounded/aggregate', stats.sampleSize === 1 && 'successRate' in stats);

  // Memory capabilities are local + opt-in.
  const caps = memMod.memoryCapabilities({ learningOptIn: true });
  t('memory capabilities are local', caps.local === true && caps.optInRequired === true);
  t('memory never syncs externally', caps.externalSync === false);

  // User can clear.
  const cleared = memMod.clearMemory();
  t('user can clear memory', cleared.ok === true && memMod.loadMemory().length === 0);

  // A fabricated success is not recorded even with opt-in.
  const fake = memMod.rememberOutcome({ learningOptIn: true, audit: [] }, { kind: 'outcome', strategy: 'x', outcome: 'COMPLETED', confirmed: false });
  t('fabricated success refused', fake.ok === false);

  delete globalThis.localStorage;
  return rows;
}
