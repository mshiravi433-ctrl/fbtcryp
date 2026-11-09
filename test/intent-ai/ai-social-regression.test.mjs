import test from 'node:test';
import assert from 'node:assert/strict';
import { composeSocialReply } from '../../src/lib/intent-ai/chat/socialChat.js';
import { classifySocialAct } from '../../src/lib/intent-ai/os/conversation/socialIntent.js';
import { classifyConversationKind, CONVERSATION_KINDS } from '../../src/lib/intent-ai/os/collaborationRouter.js';
import { composeSocialTurn } from '../../server/aiSocial.js';

const mixed = [
  'سلام میشه در مورد تورم توضیح بدی؟',
  'ممنون، چطور کار می‌کند؟',
  'سلام من را یادت هست؟',
  'hello, explain inflation',
  'thanks, how does it work?',
  'سلام درباره تورم توضیح بده'
];
for (const text of mixed) test(`politeness does not swallow a request: ${text}`, () => {
  const local = composeSocialReply(text, { locale: 'fa' });
  assert.equal(local.ok, false);
  const social = classifySocialAct(text, { locale: 'fa' });
  assert.equal(social.pure, false);
  assert.equal(classifyConversationKind(text, { locale: 'fa' }), CONVERSATION_KINDS.QUESTION);
  assert.equal(composeSocialTurn({ u5: { social, conversationKind: 'GREETING' } }).handled, false);
});

test('simple social exchanges still get a warm reply without a trade', () => {
  for (const text of ['سلام', 'سلام خوبی؟', 'ممنون', 'نه ممنون']) {
    const result = composeSocialReply(text, { locale: 'fa' });
    assert.equal(result.ok, true, text);
    assert.equal(result.executionAuthorized, false);
    assert.ok(result.text.length > 0);
  }
});

test('a greeting with a financial instruction cannot authorize or replace it', () => {
  const text = 'سلام لطفا ۵۰ دلار تتر بخر';
  const result = composeSocialReply(text, { locale: 'fa' });
  assert.equal(result.ok, false);
  assert.equal(result.executionAuthorized, false);
  assert.notEqual(classifyConversationKind(text, { locale: 'fa' }), CONVERSATION_KINDS.GREETING);
});
