import test from 'node:test';
import assert from 'node:assert/strict';
import { isConversationalOnly, isBareWhatsUp } from '../../src/lib/intent-ai/chat/conversationRoute.js';
import { escalateToProviders } from '../../server/aiEscalation.js';

test('social requests go to models but financial mixed requests stay on the guarded path', () => {
  for (const text of ['چطوری با دوستم آشتی کنم؟', 'احمق', 'how do I apologize to my friend?']) assert.equal(isConversationalOnly(text), true, text);
  for (const text of ['دوستم گفت بیت کوین بخر', 'احمق کیف پولم را انتقال بده', 'اپ چه امکاناتی داره', 'قیمت بیت کوین']) assert.equal(isConversationalOnly(text), false, text);
  assert.equal(isBareWhatsUp('چخبرا؟'), true);
  assert.equal(isBareWhatsUp('چخبرا بازار بیت کوین؟'), false);
});

test('conversational model instruction is used and failure does not invent an answer', async () => {
  let system;
  const result = await escalateToProviders({message: 'چطوری با دوستم آشتی کنم؟', systemPrompt: 'Respectful relationship advice', deps: {providers: ['mock'], execute: async (_id, options) => { system = options.system; return { text: 'با آرامش از دوستت بپرس چه احساسی دارد و به حرفش گوش بده.' }; }}});
  assert.equal(system, 'Respectful relationship advice');
  assert.equal(result.ok, true);
  assert.match(result.answer, /دوستت/);
});
