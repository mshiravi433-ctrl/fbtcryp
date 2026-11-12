/* THE LOCAL-FIRST GATE, END TO END.
 *
 * The gate's contract is about PROVIDER CALLS, so it is tested against the
 * real pipeline with a counting fleet: a covered question must cost zero
 * calls, and an uncovered one must cost exactly what it cost before.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { runCollaborativeAnalysis } from '../../server/aiCollaboration.js';

function makeCountingFleet() {
  const calls = [];
  const execute = async (providerId, opts = {}) => {
    calls.push({ providerId, system: String(opts.system || '') });
    return {
      provider: providerId,
      model: 'fake',
      durationMs: 2,
      text: JSON.stringify({ answer: 'پاسخ آزمایشی.', claims: [], uncertainty: '' })
    };
  };
  return { execute, selectProviders: () => ['fake-a', 'fake-b', 'fake-c'], calls };
}

test('a covered question costs ZERO provider calls and says so', async () => {
  const fleet = makeCountingFleet();
  const out = await runCollaborativeAnalysis({
    message: 'کارمزد پلتفرم FBT چقدر است',
    locale: 'fa',
    intelligence: 'max',
    deps: fleet
  });

  assert.equal(fleet.calls.length, 0, `the gate must spend no calls, spent ${fleet.calls.length}`);
  assert.equal(out.localFirst?.used, true);
  assert.equal(out.localFirst?.reason, 'answered-from-verified-knowledge');
  assert.equal(out.localFirst?.providerCallsSaved, 6);
  /* The answer is the VERIFIED figure from the corpus. */
  assert.match(out.answer, /۰٫۷|0\.7|70\s*bps/i);
  /* And the turn reports no providers, because it used none. */
  assert.deepEqual(out.providersUsed, []);
});

test('an uncovered question still reaches the model, and costs what it used to', async () => {
  const fleet = makeCountingFleet();
  const out = await runCollaborativeAnalysis({
    message: 'قیمت بیت کوین چنده؟',
    locale: 'fa',
    intelligence: 'max',
    deps: fleet
  });

  assert.ok(fleet.calls.length > 0, 'the model must still be consulted');
  assert.equal(out.localFirst?.used, false);
  assert.ok(out.localFirst?.reason, 'the gate must record why it stood aside');
});

test('a judgement question still reaches the model', async () => {
  const fleet = makeCountingFleet();
  const out = await runCollaborativeAnalysis({
    message: 'با این داده، ریسک ورود به بیت‌کوین چیست؟',
    locale: 'fa',
    intelligence: 'max',
    deps: fleet
  });

  assert.ok(fleet.calls.length > 0);
  assert.equal(out.localFirst?.used, false);
  assert.equal(out.localFirst?.reason, 'judgement-question');
});

test('the gate can be switched off and the pipeline behaves exactly as before', async () => {
  const previous = process.env.AI_LOCAL_FIRST_GATE;
  process.env.AI_LOCAL_FIRST_GATE = '0';
  try {
    const fleet = makeCountingFleet();
    const out = await runCollaborativeAnalysis({
      message: 'کارمزد پلتفرم FBT چقدر است',
      locale: 'fa',
      intelligence: 'max',
      deps: fleet
    });
    assert.ok(fleet.calls.length > 0, 'with the gate off, the model must be consulted');
    assert.equal(out.localFirst?.used, false);
    assert.equal(out.localFirst?.reason, 'disabled');
  } finally {
    if (previous === undefined) delete process.env.AI_LOCAL_FIRST_GATE;
    else process.env.AI_LOCAL_FIRST_GATE = previous;
  }
});
