import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.CONDITIONAL_ALLOCATION_ENABLED = 'true';

const { narrateIntelligence } = await import('../../server/smartMoney/narration.js');
const { conditionalAllocationReply } = await import('../../server/aiIntentOS.js');

const NOW = Date.now();
const ACCEPT_FA = 'اگر طلا ۵٪ اصلاح کرد و BTC هم بالای ۶۵۰۰۰ بود، ۱۰٪ سرمایه را به طلا اختصاص بده';

const activeRow = {
  symbol: 'BTC', chain: 1, token: '0x0000000000000000000000000000000000000001',
  signal: 'ACCUMULATION', buyers: 3, sellers: 1, independentVotes: 3,
  netFlowUsd: 120000, confidence: 82, momentum: null
};

test('a stale smart-money index is downgraded to an explicit abstention', () => {
  const stale = narrateIntelligence({
    consensus: [activeRow], at: NOW, indexedAt: NOW - 3 * 24 * 3_600_000, window: '24h', coverage: null
  }, { message: 'smart money?', lang: 'en' });
  assert.equal(stale.dataStatus, 'insufficient-evidence', 'days-old consensus is not an observed 24h window');
  assert.match(stale.text, /hours ago/, 'the abstention names the index age');
  assert.equal(stale.evidence.stale, true);

  const fresh = narrateIntelligence({
    consensus: [activeRow], at: NOW, indexedAt: NOW - 60_000, window: '24h', coverage: null
  }, { message: 'smart money?', lang: 'en' });
  assert.equal(fresh.dataStatus, 'observed', 'a freshly indexed consensus still narrates as observed');
});

test('conditional allocation refuses a stale price read instead of evaluating it', async () => {
  const staleReads = async (syms) => Object.fromEntries(syms.map((s) => [s,
    s === 'GOLD'
      ? { ok: true, value: 2650, source: 'stooq:GC.F', at: NOW - 8 * 24 * 3_600_000 }
      : { ok: true, value: 67000, source: 'coingecko', at: NOW }
  ]));
  const reply = await conditionalAllocationReply({
    message: ACCEPT_FA,
    context: { portfolio: { totalValueUsd: 8350, dataStatus: 'client', holdings: [] } },
    locale: 'fa',
    readPrices: staleReads
  });
  assert.equal(reply.ui.state, 'UNREADABLE', 'an ancient quote makes the instruction unreadable');
  assert.match(reply.text, /حدس نمی‌زنم/, 'the abstention is explicit');
  const gold = reply.evidence.reads.find((r) => r.symbol === 'GOLD');
  assert.equal(gold.ok, false);
  assert.equal(gold.code, 'STALE_READ');
  assert.equal(gold.source, 'stooq:GC.F', 'provenance is preserved on the failed read');
});

test('conditional allocation only sizes capital from a trustworthy portfolio read', async () => {
  const freshReads = async (syms) => Object.fromEntries(syms.map((s) => [s,
    { ok: true, value: s === 'GOLD' ? 2650 : 67000, source: 'fixture', at: NOW }
  ]));
  const unavailable = await conditionalAllocationReply({
    message: ACCEPT_FA,
    context: { portfolio: { totalValueUsd: 8350, dataStatus: 'unavailable', holdings: [] } },
    locale: 'fa',
    readPrices: freshReads
  });
  assert.equal(unavailable.evidence.capital.totalValueUsd, null, 'an unavailable portfolio sizes nothing');
  assert.equal(unavailable.evidence.capital.dataStatus, 'unavailable');

  const client = await conditionalAllocationReply({
    message: ACCEPT_FA,
    context: { portfolio: { totalValueUsd: 8350, dataStatus: 'client', holdings: [] } },
    locale: 'fa',
    readPrices: freshReads
  });
  assert.equal(client.evidence.capital.totalValueUsd, 8350, 'a client portfolio read is usable capital');
  assert.equal(client.ui.state, 'ARMING', 'fresh reads still arm the baseline as before');
});

test('a conditional clarification carries an explicit needs-input evidence record', async () => {
  const reply = await conditionalAllocationReply({
    message: 'اگر طلا اصلاح کرد، ۱۰٪ سرمایه را به طلا اختصاص بده',
    context: { portfolio: { totalValueUsd: 8350, dataStatus: 'client', holdings: [] } },
    locale: 'fa',
    readPrices: async () => ({})
  });
  assert.equal(reply.ui.state, 'NEEDS_INPUT');
  assert.equal(reply.evidence.dataStatus, 'needs-input');
  assert.deepEqual(reply.evidence.reads, []);
});
