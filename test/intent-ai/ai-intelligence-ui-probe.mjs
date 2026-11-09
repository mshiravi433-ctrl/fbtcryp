/**
 * Smartest-mode WIRING probe (source-level, no browser, no network).
 * ---------------------------------------------------------------------------
 * The mode is only real if the chain is closed end to end:
 *
 *   panel button → localStorage helper → chat transport → HTTP body →
 *   /v1/ai/chat → planCollaboration(floor) → runCollaborativeAnalysis →
 *   executeProviderChat(model ladder) → provider request body
 *
 * The node tests in `ai-intelligence-mode.test.mjs` prove the server half with
 * stubbed fetch. This probe proves the half a unit test cannot reach: that the
 * UI and the transport actually WIRE that half up. A missing `intelligence`
 * field anywhere in that chain would ship a switch that changes nothing.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let passed = 0;
const ok = (label) => {
  passed += 1;
  console.log(`  ✓ ${label}`);
};

console.log('\n--- AI smartest mode: UI → transport → route wiring ---');

const panel = read('src/components/IntentOpsPanels.jsx');
assert.ok(panel.includes('intel-intelligence-mode'), 'the intelligence panel must expose the mode row');
assert.ok(panel.includes('intel-mode-${m.id}'), 'each mode must have its own testable button');
assert.ok(panel.includes('setIntelligenceMode'), 'the buttons must WRITE the shared preference, not only render');
assert.ok(!/onClick=\{\(\) => \{\}\}/.test(panel), 'no decorative no-op button in the mode row');
ok('intelligence panel renders a real three-way mode selector');

const unified = read('src/components/IntentAIUnified.jsx');
assert.ok(unified.includes('neural-intelligence-chip'), 'the chat header must show which mode is active');
assert.ok(unified.includes("opts.deepThinking === true ? 'max' : undefined"), 'deep-thinking turns must explicitly ask for max');
assert.match(unified, /import \{[^}]*getIntelligenceMode[^}]*intelligenceModeLabel[^}]*\} from '\.\.\/lib\/aiIntelligenceMode\.js'/,
  'the chip reads the same shared preference');
ok('chat header shows the mode and the deep-thinking path requests max');

/*
 * ─── REACHABILITY, PINNED ─────────────────────────────────────────────────
 * WHY THESE CHECKS EXIST: «هنوز نشده اصلاً سه نقطه نمیاد». The mode was live,
 * defaulted to `max`, and unreachable — the header chip carried
 * `fbt-chip-hide-sm` (display:none at ≤560px) while the tab bar that held the
 * panel's only other entry point is hidden at ≥900px. So the control existed in
 * the source and nowhere on the user's screen, and a report that told them to
 * open a menu that was never shipped.
 *
 * A behaviour test cannot see this: nothing fails when an affordance is
 * display:none. So the markup itself is pinned here — the two entry points that
 * must survive every breakpoint, and the rule that no control is ever allowed
 * to be the decoration-shed's victim.
 */
/* The chip's own opening tag, and nothing else — prose about the class above it
   must not be able to satisfy (or break) this check. */
const chipTagStart = unified.lastIndexOf('<button', unified.indexOf('data-testid="neural-intelligence-chip"'));
const chipTagEnd = unified.indexOf('>', unified.indexOf('data-testid="neural-intelligence-chip"'));
const chipTag = unified.slice(chipTagStart, chipTagEnd);
assert.ok(chipTag.includes('className="fbt-chip"'), 'the mode chip must be a real chip in the header');
assert.ok(chipTag.length > 40 && !chipTag.includes('fbt-chip-hide-sm'),
  'the intelligence chip must NEVER be hidden on a small screen — it is a control, not decoration');
assert.ok(/data-testid="neural-intelligence-chip"[\s\S]{0,200}onClick=\{\(\) => openPanel\('intelligence'\)\}/.test(unified),
  'the chip must open the panel through openPanel, which also loads the fleet read the panel shows');
assert.ok(unified.includes('neural-intelligence-composer'),
  'the composer needs its own mode affordance: the header can be scrolled or keyboard-covered');
assert.ok(/data-testid="neural-intelligence-composer"[\s\S]{0,200}onClick=\{\(\) => openPanel\('intelligence'\)\}/.test(unified),
  'the composer pill opens the same panel — one control, two handles, no divergent switch');
assert.ok(/<NeuralMoreMenu[\s\S]{0,600}onIntelligenceMode=\{\(id\) => setIntelligenceModeState\(setIntelligenceMode\(id\)\)\}/.test(unified),
  'the mode picker inside the More menu must WRITE the shared preference, not render three dead buttons');
ok('the mode is reachable on a phone, on a desktop, and while typing');

const moreMenu = read('src/components/intent-neural/NeuralMoreMenu.jsx');
assert.ok(moreMenu.includes('neural-more-mode-${m.id}'), 'each mode gets its own testable button in the More menu');
assert.ok(moreMenu.includes('onIntelligenceMode(m.id)'), 'a pressed button must report the id it carries');
assert.ok(moreMenu.includes('INTELLIGENCE_MODES'), 'the More menu must render the published modes, not its own list');
assert.ok(!/onClick=\{\(\) => \{\}\}/.test(moreMenu), 'no decorative no-op button in the More menu');
ok('the More menu owns a real mode picker');

const styles = read('src/styles/fbt-neural-command.css');
assert.ok(!/\[data-testid='neural-intelligence-chip'\][^{]*\{[^}]*display:\s*none/.test(styles)
  && !/\[data-testid="neural-intelligence-chip"\][^{]*\{[^}]*display:\s*none/.test(styles),
  'the stylesheet must not hide the intelligence control at any width');
assert.match(styles, /\.fbt-head-meta\s*\{[^}]*flex-wrap:\s*wrap/, 'the chip cluster must wrap instead of overflowing once the mode chip stays visible');
assert.ok(styles.includes('.iaos-mode-pill'), 'the composer pill needs real styling next to the send button');
ok('the CSS keeps the mode visible and the header intact');

const client = read('src/lib/aiIntentClient.js');
assert.ok(client.includes('getIntelligenceMode'), 'the transport must read the stored mode');
assert.ok(/intelligence: mode\b/.test(client), 'the chat body must carry the mode');
assert.ok(/const mode = normalizeRequestedIntelligence\(intelligence\)/.test(client), 'the mode must be resolved once, by the transport');
assert.ok(client.includes("intelligence === true) return 'max'"), 'a boolean request must mean max, not a silent default');
/* The mode decides how long the turn may take, so the wait must follow it: a
   fixed 30 s window throws away the deep answer before it lands, and that reads
   to the user as «هیچ تغییری نکرده». */
assert.ok(/timeout: intelligenceTurnBudgetMs\(mode\)/.test(client), 'the chat timeout must be the mode’s, not a constant');
ok('every chat request carries the resolved mode — and waits as long as that mode needs');

const helper = read('src/lib/aiIntelligenceMode.js');
assert.ok(helper.includes('fbt.ai.intelligence.v1'), 'the choice must survive a reload');
assert.ok(helper.includes("DEFAULT_INTELLIGENCE_MODE = 'max'"), 'the client default must match the server default');
assert.ok(helper.includes('fbt:ai-intelligence'), 'the same-tab event keeps the chip and the panel in sync');
ok('the preference is persistent, defaulted to max and observable');

const route = read('server/aiIntentOS.js');
assert.ok(route.includes('resolveIntelligenceMode(req.body?.intelligence'), 'the chat route must resolve the request mode');
assert.ok(route.includes('intelligenceFloor: intelligenceProfile.collaborationFloor'), 'the depth floor must reach the plan');
assert.ok(route.includes('intelligence: resolvedIntelligence.mode,'), 'the run must receive the same mode as the plan');
assert.ok(route.includes("router.get('/intelligence'"), 'the contract must be readable without spending a token');
assert.ok(route.includes('authority: { canExecute: false, canSign: false, canMoveFunds: false }'), 'the mode must publish its authority boundary');
ok('the chat route resolves, applies and reports the mode');

const collab = read('server/aiCollaboration.js');
assert.ok(collab.includes('intelligenceGeneration(mode'), 'role budgets must follow the mode');
assert.ok(collab.includes('intelligence: mode'), 'the mode must reach the provider executor');
assert.ok(collab.includes('intelligence: {\n      mode,'), 'the result must name the mode that produced it');
ok('collaboration scales budgets and passes the mode down');

/*
 * The DEPTH half: a stronger model alone still answers once. These checks pin
 * that the self-review actually exists, is bounded, and cannot replace a draft
 * with a stub.
 */
assert.ok(collab.includes('CRITIQUE_SYSTEM'), 'the adversarial reviewer prompt must exist');
assert.ok(collab.includes('adversarial self-reviewer'), 'the reviewer must be a separate voice');
assert.ok(collab.includes('VERIFIER FINDINGS (resolve every point'), 'the synthesiser must be told to resolve findings');
assert.ok(collab.includes("reason: 'REPAIRED'"), 'a used repair must be reported');
assert.ok(collab.includes("'STUB_OR_TRUNCATED'"), 'a stub repair must be refused');
assert.ok(collab.includes('DEEP REASONING (FBT smartest mode)'), 'the deep-reasoning contract must reach every role');
ok('the smartest mode reviews the draft and can only keep a substantial repair');

const routeDepth = read('server/aiIntentOS.js');
assert.ok(routeDepth.includes('depth: collaboration ?'), 'the reply must report the depth that actually happened');
assert.ok(routeDepth.includes('reviewed: collaboration.critique?.used === true'), 'the UI must be able to say the answer was reviewed');
ok('the chat reply publishes how deep the turn actually went');

const gateway = read('server/aiGateway.js');
assert.ok(gateway.includes('intelligenceModelLadder'), 'the gateway must use the flagship ladder');
assert.ok(gateway.includes('intelligenceReasoningFields'), 'reasoning fields must come from the guarded helper');
assert.ok(gateway.includes('intelligenceAnthropicThinking'), 'anthropic thinking must be budgeted');
assert.ok(gateway.includes('intelligenceGeminiThinking'), 'gemini thinking must be model-gated');
assert.ok(gateway.includes('intelligence: {\n          mode,'), 'a routed answer must report the mode it used');
ok('the gateway applies the ladder, the reasoning knobs and the attribution');

const router = read('src/lib/intent-ai/os/collaborationRouter.js');
assert.ok(router.includes('intelligenceFloor'), 'the plan must accept a depth floor');
assert.ok(router.includes('smallTalkProtected'), 'the plan must state that small talk was protected');
assert.ok(router.includes('const pureSocial'), 'small talk must be detected before the floor is applied');
assert.ok(router.includes('smallTalkProtected: pureSocial'), 'the plan must name the protection');
ok('the pure router owns depth, and says so');

console.log(`\nAI smartest-mode wiring probe: ${passed}/${passed} passed\n`);
