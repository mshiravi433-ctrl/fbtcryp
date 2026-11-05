import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const app = readFileSync('src/App.jsx', 'utf8');
const ai = readFileSync('src/components/IntentAIUnified.jsx', 'utf8');
const perp = readFileSync('src/pages/Perp.jsx', 'utf8');

test('AI Trade replaces the Mission Control entry without exposing it in the futures rail', () => {
  assert.match(ai, /AI_TRADE_ENABLED && \([\s\S]*?navigate\('\/ai-trade'\)/);
  assert.doesNotMatch(ai, /navigate\('\/missions'\)/);
  assert.match(app, /path="\/missions" element=\{<Navigate to="\/intent" replace \/>\}/);
  assert.match(app, /path="\/ai-trade" element=\{AiTradePanel/);
  assert.match(perp, /navigate\('\/ai-trade', \{ replace: true \}\)/);
  assert.doesNotMatch(perp, /LazyAiTrade|['"]aitrade['"]\s*,?\s*\]/);
});
