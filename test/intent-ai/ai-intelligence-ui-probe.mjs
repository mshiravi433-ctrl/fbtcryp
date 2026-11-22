/**
 * Auto-depth and evidence honesty UI/wiring probe (source-level, no browser).
 *
 * The public contract is now automatic: the server reads the question, selects
 * a depth and reports the decision. The browser may not persist or send a mode.
 * This probe pins that contract end-to-end and guards the evidence fallback and
 * financial-confirmation boundaries that share the chat response path.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let passed = 0;
const ok = (label) => { passed += 1; console.log(`  ✓ ${label}`); };
console.log('\n--- AI auto-depth + evidence policy: UI → transport → route ---');

const panel = read('src/components/IntentOpsPanels.jsx');
assert.ok(panel.includes('intel-intelligence-auto'), 'the intelligence panel must publish the Auto status');
assert.ok(panel.includes("data-mode=\"auto\""), 'the panel must identify Auto, not a user-picked tier');
assert.ok(panel.includes('Selected automatically for every question'), 'the panel explains server-side selection');
assert.ok(panel.includes('If evidence is missing'), 'the panel explains the no-evidence response');
assert.ok(!panel.includes('intel-mode-${m.id}') && !panel.includes('setIntelligenceMode'),
  'the panel must not expose or persist an obsolete tier selector');
ok('the operations panel reports Auto and the evidence limitation');

const unified = read('src/components/IntentAIUnified.jsx');
assert.ok(unified.includes('neural-intelligence-chip'), 'the header reports response depth');
assert.ok(unified.includes('Answer depth: Auto') && unified.includes('عمق پاسخ: خودکار'), 'the header is explicitly Auto');
assert.ok(!unified.includes('neural-intelligence-composer'), 'the composer stays uncluttered');
assert.ok(!unified.includes('setIntelligenceMode') && !unified.includes('onIntelligenceMode'),
  'chat controls cannot override the per-question choice');
const chipAt = unified.indexOf('data-testid="neural-intelligence-chip"');
assert.ok(chipAt >= 0 && unified.slice(chipAt - 500, chipAt + 500).includes('role="status"'),
  'the header badge is informational status, not a mode control');
ok('the navigation drawer reports Auto without a selector');

const moreMenu = read('src/components/intent-neural/NeuralMoreMenu.jsx');
assert.ok(!moreMenu.includes('INTELLIGENCE_MODES') && !moreMenu.includes('onIntelligenceMode'),
  'the More menu cannot reintroduce a hidden mode preference');
ok('the More menu has no obsolete mode picker');

const helper = read('src/lib/aiIntelligenceMode.js');
assert.ok(helper.includes('DEFAULT_INTELLIGENCE_MODE = AUTO_INTELLIGENCE_MODE'), 'client default is Auto');
assert.ok(helper.includes("AUTO_INTELLIGENCE_MODE = 'auto'"), 'Auto is an explicit response-depth state');
assert.ok(helper.includes("auto: 70000"), 'the browser waits for the deepest automatically selected turn');
assert.ok(helper.includes('purpose,') && helper.includes('freshness, completeness and safety context'),
  'the client contract documents message-specific depth selection');
ok('the shared client contract defaults to Auto and keeps a safe timeout');

const client = read('src/lib/aiIntentClient.js');
assert.ok(!client.includes('getIntelligenceMode') && !/intelligence\s*:\s*mode\b/.test(client),
  'the chat transport neither reads local mode preference nor sends a chosen tier');
assert.ok(client.includes("timeout: intelligenceTurnBudgetMs('max')"), 'chat waits long enough for automatic deep turns');
const gatewayClient = read('src/lib/aiGatewayClient.js');
assert.ok(!/body:\s*\{[^}]*intelligence\s*:/s.test(gatewayClient), 'gateway requests do not carry a client-selected mode');
assert.ok(gatewayClient.includes("intelligenceTurnBudgetMs('max')"), 'gateway waits for the server-selected depth');
ok('chat and Gateway clients leave tier selection to the server');

const route = read('server/aiIntentOS.js');
assert.ok(route.includes('proposeIntelligenceMode(tierRead'), 'the actual chat route proposes from the message read');
assert.ok(route.includes('resolveIntelligenceMode(req.body?.intelligence ?? null, { auto: autoTier })'),
  'only a valid operator pin can override the automatic proposal');
assert.ok(route.includes('autoTier: resolvedIntelligence.auto'), 'the chosen tier and reason are reported');
assert.ok(route.includes('authority: { canExecute: false, canSign: false, canMoveFunds: false }'),
  'depth metadata cannot grant execution authority');
assert.ok(route.includes('proposeIntelligenceMode(read'), 'the direct Gateway chat also reads and selects per message');
ok('both public chat paths resolve and report automatic depth');

const gateway = read('server/aiGateway.js');
assert.ok(gateway.includes('intelligenceModelLadder'), 'the selected tier reaches the provider model ladder');
assert.ok(gateway.includes('intelligenceReasoningFields'), 'reasoning knobs are guarded by provider/model');
assert.ok(gateway.includes('intelligence: {\n          mode,'), 'the actual provider response reports its resolved tier');
ok('the server selection still controls provider depth');

const policy = read('server/aiEvidenceFallback.js');
assert.ok(policy.includes('assessAnswerEvidence'), 'the policy distinguishes independent evidence from model text');
assert.ok(policy.includes('NO_TRUSTED_EVIDENCE'), 'missing evidence has a named, explicit state');
assert.ok(policy.includes('providerAnswered'), 'the no-provider outcome is distinguished');
assert.ok(policy.includes('clarificationOnly'), 'the incomplete-input path preserves one slot question');
assert.ok(policy.includes('internalSynthesis'), 'internal synthesis is not counted unless independently grounded');
assert.ok(route.includes("from './aiEvidenceFallback.js'"), 'the real chat route uses the evidence policy');
assert.ok(route.includes('const evidenceFallbackApplied = Boolean(evidenceRequired && !answerEvidence.available)'),
  'a required but unsupported response is replaced before shipping');
assert.ok(route.includes('fallbackApplied: evidenceFallbackApplied'), 'the reply reports when the evidence gate changed it');
assert.ok(route.includes('pendingIntent: Boolean(pendingIntent)'), 'pending execution is excluded from the factual-answer fallback');
assert.ok(route.includes('actionPlan: Boolean(human.actionPlan)'), 'staged financial actions keep their confirmation path');
assert.ok(route.includes('withPartialReading(finalText, partialRead'), 'the fallback retains the partial-input read-back');
ok('the chat refuses unsupported factual claims without disturbing gated actions');

const partial = read('src/lib/intent-ai/os/conversation/partialInput.js');
const suggestions = read('src/lib/intent-ai/os/suggestionEngine.js');
assert.ok(partial.includes('questionBudget: ask ? 1 : 0'), 'incomplete input has a one-question budget');
assert.ok(suggestions.includes('missingInformation') && suggestions.includes('minimalQuestion'),
  'clarification suggestions are tied to the actually missing slot');
assert.ok(!suggestions.includes('unknown ?'), 'unknown values must not be filled by a guessed default');
ok('partial input asks for the missing slot and does not invent one');

console.log(`\nAuto-depth/evidence wiring probe: ${passed}/${passed} passed\n`);
