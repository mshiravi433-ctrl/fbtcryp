/* Phase 14 — Intent Genome, explainable matching and local-first memory. */
import {
  createPhase14IntentGenome,
  rejectPhase14SecretGenomeInput,
  matchIntentGenome,
  evolvePhase14IntentGenome,
  createLocalFirstMemory,
  redactMemoryEvent,
  buildPhase14LearningBatch,
  localMemoryCapabilities
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const now = Date.now();
const backing = new Map();
const storage = { getItem: (key) => backing.get(key) || null, setItem: (key, value) => backing.set(key, value), removeItem: (key) => backing.delete(key) };

try {
  check('secret-shaped genome input is rejected', rejectPhase14SecretGenomeInput({ privateKey: '0x' + 'a'.repeat(64) }).ok === false);
  const genome = createPhase14IntentGenome({ id: 'genome-14', preferences: { riskTolerance: 20, feeSensitivity: 80 }, sampleSize: 2 }, { now });
  check('genome stores bounded preference/risk dimensions', genome.schema === 'fbt.intent-genome.v1' && genome.dimensions.riskTolerance === 20 && genome.dimensions.feeSensitivity === 80);
  const match = matchIntentGenome(genome, { riskTolerance: 20, feeSensitivity: 80 });
  check('DNA matching is explainable similarity, not success probability', match.ok && match.similarity === 100 && match.successProbability === null && match.executionPermissionChanged === false);
  const noOptIn = evolvePhase14IntentGenome(genome, { signal: 'positive', magnitude: 10 }, { now });
  check('evolution without learning opt-in is blocked', !noOptIn.ok && noOptIn.code === 'LEARNING_OPT_IN_REQUIRED');
  const evolved = evolvePhase14IntentGenome(genome, { learningOptIn: true, adjustments: { riskTolerance: -5 }, signal: 'negative' }, { now });
  check('opt-in evolution is bounded and cannot change execution permission', evolved.ok && evolved.genome.dimensions.riskTolerance === 15 && evolved.executionPermissionChanged === false && evolved.genome.executionPermission === false);

  const unsafeEvent = redactMemoryEvent({ type: 'feedback.received', payload: { seedPhrase: 'never-store-this' } });
  check('raw secrets never enter structured memory', unsafeEvent === null);
  const safeEvent = redactMemoryEvent({ type: 'feedback.received', at: now, payload: { strategy: 'balanced', outcome: 'unknown' } });
  check('structured memory event is typed and redacted', safeEvent?.schema === 'fbt.local-memory-event.v1' && safeEvent.redacted && safeEvent.uploaded === false);
  const memory = createLocalFirstMemory({ storage, learningOptIn: false, maxEntries: 3 });
  memory.append('intent.created', { strategy: 'balanced' }, { at: now });
  check('memory is local-first and bounded', memory.status().storage === 'local-first' && memory.status().entries === 1 && memory.status().productionReady === false);
  const blockedBatch = buildPhase14LearningBatch(memory, { optIn: false, upload: true });
  check('learning without opt-in cannot upload', !blockedBatch.ok && blockedBatch.code === 'LEARNING_OPT_IN_REQUIRED' && blockedBatch.upload === 'disabled');
  const allowedBatch = buildPhase14LearningBatch(memory, { optIn: true, upload: true });
  check('explicit learning opt-in exports aggregate data only', allowedBatch.ok && allowedBatch.transportAllowed && allowedBatch.entries.length === 0 && allowedBatch.pii === false && allowedBatch.secrets === false);
  check('memory capabilities keep upload and execution separate', localMemoryCapabilities().externalUploadDefault === false && localMemoryCapabilities().executionPermissionInfluenced === false);
  memory.clear();
  check('user can clear local memory', memory.status().entries === 0);
  check('genome/memory output contains no credential material', !/private.?key|seed.?phrase|master.?password|never-store-this/i.test(JSON.stringify({ genome, match, evolved, memory: memory.status() })));

  console.log(JSON.stringify({ probe: 'phase14-genome-memory', passed: results.filter((row) => row.ok).length, results }, null, 2));
  if (results.some((row) => !row.ok)) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ probe: 'phase14-genome-memory', failed: true, results, error: error.message }, null, 2));
  process.exitCode = 1;
}

export default results;
