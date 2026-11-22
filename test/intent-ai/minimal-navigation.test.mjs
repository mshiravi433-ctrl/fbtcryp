import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const ui = readFileSync('src/components/IntentAIUnified.jsx', 'utf8');
const more = readFileSync('src/components/intent-neural/NeuralMoreMenu.jsx', 'utf8');
test('minimal chat keeps navigation and actions available in the drawer', () => {
  const header = ui.slice(ui.indexOf('<header className="iaos-header">'), ui.indexOf("{aiTab === 'chat' && ("));
  for (const term of ['intent-ai-nav-toggle', 'iaos-nav-drawer', "'agents'", "'activity'", "'more'", 'AI Trade', 'کورتکس', 'فرماندهی عصبی', 'عمق پاسخ', 'serverReachable', 'setDrawerOpen(true)', 'setAiTab(tab)']) assert.ok(header.includes(term), term);
  assert.doesNotMatch(header, /ThinkingOrb|NeuralCore/);
  assert.doesNotMatch(ui, /className="tag-tabbar"|className="fbt-sidebar"|className="iaos-action-btn"|data-testid="neural-intelligence-composer"/);
  assert.doesNotMatch(more, /id: 'multimodel'/);
});
test('thinking has a single accessible indicator and gateway status is independent of monitors', () => {
  assert.match(ui, /className="iaos-thinking-indicator" role="status"/);
  assert.doesNotMatch(ui, /className="iaos-bubble iaos-thinking-v6"/);
  assert.match(ui, /setServerReachable\(gateway\.status === 'fulfilled' && gateway\.value\?\.ok === true\)/);
});
