#!/usr/bin/env node
/**
 * FBT INTENT AI — MARKET ANALYSIS CHAT · LOCAL TX HISTORY · PREPARATION GATE
 * ---------------------------------------------------------------------------
 * Locks in the behaviour added with the deep-analysis chat and the mobile
 * history surface:
 *
 *   · the parser now carries EVERY named asset on the intent (intent.assets)
 *     and understands "market brief" as an analysis request
 *   · analysis replies ship with a PENDING market block and the sync
 *     chatTurn stays I/O-free; buildChatMarketAnalysis fills it with real,
 *     injected market data — and honestly degrades to unavailable/offline
 *   · a symbol the feed cannot price stays visible, marked unavailable —
 *     never silently dropped
 *   · the local transaction history writes honest receipt states to
 *     localStorage, validates on read-back and wipes on demand
 *   · preparation (quote/draft) is NOT gated to L3: Guardian only refuses
 *     `execution: true` below L3, and an unsupported chain at preparation
 *     time is a warning, while at execution time it stays a hard rejection
 *
 * No network: every market source is injected.
 */
import { readFileSync } from 'node:fs';

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  const parser = await import('../../src/lib/intent-ai/intentParser.js');
  const chat = await import('../../src/lib/intent-ai/liveMarketChat.js');
  const hist = await import('../../src/lib/intent-ai/txHistory.js');
  const human = await import('../../src/lib/intent-ai/humanAi.js');
  const guardian = await import('../../src/lib/intent-ai/guardian.js');
  const perm = await import('../../src/lib/intent-ai/permissions.js');

  /* ====================== 1. PARSER: full asset list ====================== */

  const multi = parser.parseUserIntent('analyze BTC ETH BNB SOL XRP', { defaultChainId: 42161 });
  t('a five-symbol analyze carries all five assets in order',
    JSON.stringify(multi.intent.assets) === JSON.stringify(['BTC', 'ETH', 'BNB', 'SOL', 'XRP']));

  const brief = parser.parseUserIntent('market brief', { defaultChainId: 42161 });
  t('"market brief" parses as a complete analysis request',
    brief.ok === true && brief.intent.kind === 'analysis' && brief.intent.action === 'analyze');

  t('"market brief" invents no assets (the brief basket is a chat-layer default)',
    Array.isArray(brief.intent.assets) && brief.intent.assets.length === 0
    && brief.intent.fromSymbol == null && brief.intent.toSymbol == null);

  const faAssets = parser.parseUserIntent('تحلیل بیت کوین و اتریوم', { defaultChainId: 42161 });
  t('a Persian analysis carries the named assets too',
    JSON.stringify(faAssets.intent.assets) === JSON.stringify(['BTC', 'ETH']));

  /* ====================== 2. PENDING MARKET BLOCK ON ANALYSIS REPLIES ==== */

  const s1 = human.startSession({ mode: 'human-ai', level: 1, defaultChainId: 42161 });
  const r1 = human.chatTurn(s1, 'analyze BTC ETH BNB SOL XRP');
  t('an analysis reply carries a PENDING market block (sync turn stays I/O-free)',
    r1.reply.type === 'analysis'
    && r1.reply.payload.marketAnalysis?.dataStatus === 'pending'
    && JSON.stringify(r1.reply.payload.marketAnalysis?.requestedAssets) === JSON.stringify(['BTC', 'ETH', 'BNB', 'SOL', 'XRP']));
  t('the analysis reply never authorizes execution',
    r1.reply.payload.financialExecutionAuthorized === false && r1.reply.payload.canExecute === false);

  /* ====================== 3. DEEP MARKET ANALYSIS (injected sources) ===== */

  const liveRows = [
    { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', price: 100000, change24h: 3.4, change7d: 6.1, volume: 1.2e9, mcap: 2e12, sparkline: Array.from({ length: 40 }, (_, i) => 95000 + i * 140), dataProvenance: 'live' },
    { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', price: 3500, change24h: -3.2, change7d: -5.4, volume: 6e8, mcap: 4e11, sparkline: Array.from({ length: 40 }, (_, i) => 3800 - i * 12), dataProvenance: 'live' }
  ];
  const built = await chat.buildChatMarketAnalysis({
    symbols: ['BTC', 'ETH', 'ZZZ'],
    marketsSource: async () => liveRows,
    priceSource: async () => Array.from({ length: 30 }, (_, i) => ({ t: Date.now() - (29 - i) * 3600e3, p: 100 + i * 0.4 })),
    now: Date.now()
  });
  t('requested symbols resolve into per-asset blocks with sourced numbers',
    built.dataStatus === 'live'
    && built.assets[0].symbol === 'BTC' && built.assets[0].priceUsd === 100000
    && built.assets[1].symbol === 'ETH' && built.assets[1].change24hPct === -3.2);
  t('an unpriceable symbol stays listed, honestly marked unavailable',
    built.assets[2].symbol === 'ZZZ' && built.assets[2].dataStatus === 'unavailable');
  t('signals follow the documented 24h thresholds (±2%)',
    built.assets[0].signal === 'up' && built.assets[1].signal === 'down');
  t('the payload is review data, never advice and never permission',
    built.notAdvice === true && built.executionAuthorized === false);
  t('a live regime is described with the existing i18n summary key',
    built.regime.i18nKey === 'intentAI.regime.summary' && built.regime.available === true);

  const offline = await chat.buildChatMarketAnalysis({
    symbols: ['BTC'],
    marketsSource: async () => [{ ...liveRows[0], dataProvenance: 'offline' }],
    priceSource: async () => []
  });
  t('an offline snapshot is labelled offline, never dressed up as live',
    offline.dataStatus === 'offline' && offline.assets[0].dataStatus === 'offline');

  const dead = await chat.buildChatMarketAnalysis({ symbols: ['BTC'], marketsSource: null });
  t('a missing market source is an explicit unavailable, not a crash',
    dead.dataStatus === 'unavailable' && dead.ok === false && dead.reason === 'NO_MARKET_SOURCE');

  const failed = await chat.buildChatMarketAnalysis({ symbols: ['BTC'], marketsSource: async () => { throw new Error('down'); } });
  t('a throwing feed degrades to unavailable',
    failed.dataStatus === 'unavailable' && failed.ok === false);

  const basket = await chat.buildChatMarketAnalysis({ symbols: [], marketsSource: async () => liveRows, priceSource: async () => [] });
  t('an empty request shows the majors brief basket and says so',
    basket.briefBasket === true && basket.assets.length === chat.BRIEF_DEFAULT_SYMBOLS.length);

  /* ====================== 4. LOCAL TX HISTORY ============================= */

  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k)
  };

  const rec1 = hist.recordIntentTx({
    status: 'authorized', action: 'swap', fromSymbol: 'USDC', toSymbol: 'ETH',
    amountUsd: 150, chainId: 42161, signerKind: 'wallet'
  }, storage);
  t('a decided receipt is appended to the local history',
    rec1.ok === true && rec1.rows.length === 1 && rec1.rows[0].status === 'authorized');

  hist.recordIntentTx({ status: 'submitted', action: 'bridge', fromSymbol: 'USDC', toSymbol: 'USDC', amountUsd: 50, chainId: 1, txHash: `0x${'ab'.repeat(32)}` }, storage);
  const loaded = hist.loadIntentTxHistory(storage);
  t('history reads back newest-first and keeps the real tx hash',
    loaded.length === 2 && loaded[0].status === 'submitted' && loaded[0].txHash === `0x${'ab'.repeat(32)}`);

  t('the storage key is the documented one',
    hist.TX_HISTORY_KEY === 'fbt.intent.txHistory' && mem.has('fbt.intent.txHistory'));

  mem.set('fbt.intent.txHistory', '[{"at": "garbage"}, {"at": 1, "status": "bogus"}, 42]');
  const repaired = hist.loadIntentTxHistory(storage);
  t('read-back re-validates: junk rows drop, unknown statuses collapse to unavailable',
    repaired.length === 1 && repaired[0].status === 'unavailable');

  mem.set('fbt.intent.txHistory', 'not json');
  t('corrupt storage reads as an empty history, never an exception',
    hist.loadIntentTxHistory(storage).length === 0);

  const big = { status: 'authorized', action: 'swap', fromSymbol: 'USDC', toSymbol: 'ETH', amountUsd: 10, chainId: 42161 };
  for (let i = 0; i < hist.TX_HISTORY_MAX + 10; i += 1) hist.recordIntentTx(big, storage);
  t('history is capped at the documented maximum',
    hist.loadIntentTxHistory(storage).length === hist.TX_HISTORY_MAX);

  hist.clearIntentTxHistory(storage);
  t('the user can wipe the record',
    hist.loadIntentTxHistory(storage).length === 0);

  t('a null storage (SSR/private mode) never throws',
    hist.loadIntentTxHistory(null).length === 0
    && hist.recordIntentTx(big, null).ok === true
    && hist.clearIntentTxHistory(null).length === 0);

  /* ====================== 5. PREPARATION IS NOT AN EXECUTION GATE ======== */

  const polL1 = perm.sanitizePolicy({}, 1).policy;
  const polL2 = perm.sanitizePolicy({}, 2).policy;
  const quoteL2 = guardian.guardianReview(
    { action: 'swap', chainId: 42161, protocol: 'swap', amountUsd: 100 },
    polL2,
    {}
  );
  t('a quote/draft at L2 passes without any permission refusal (preparation is not gated to L3)',
    !quoteL2.reasons.some((r) => r.startsWith('INSUFFICIENT_PERMISSION')));

  const quoteL1 = guardian.guardianReview(
    { action: 'swap', chainId: 42161, protocol: 'swap', amountUsd: 100, execution: false },
    polL1,
    {}
  );
  t('L1 stays analysis-only for sensitive actions — that gate is L2, never L3',
    quoteL1.reasons.includes('INSUFFICIENT_PERMISSION:NEED_PREPARE')
    && !quoteL1.reasons.includes('INSUFFICIENT_PERMISSION:NEED_CONTROLLED'));

  const exec = guardian.guardianReview(
    { action: 'swap', chainId: 42161, protocol: 'swap', amountUsd: 100, execution: true },
    polL1,
    {}
  );
  t('execution still requires L3 (unchanged hard line)',
    exec.approved === false && exec.reasons.includes('INSUFFICIENT_PERMISSION:NEED_CONTROLLED'));

  const unknownChainPrep = guardian.guardianReview(
    { action: 'swap', chainId: 999999, protocol: 'swap', amountUsd: 100 },
    polL1,
    {}
  );
  t('an unsupported chain at preparation time is a warning, not a block',
    unknownChainPrep.warnings.some((w) => w.startsWith('CHAIN_NOT_SUPPORTED'))
    && !unknownChainPrep.reasons.some((r) => r.startsWith('CHAIN_NOT_SUPPORTED')));

  const polL3 = perm.sanitizePolicy({
    maxCapitalUsd: 5000, maxTransactionUsd: 1000, maxLossUsd: 500,
    allowedChains: [42161], allowedProtocols: ['swap']
  }, 3).policy;
  const unknownChainExec = guardian.guardianReview(
    { action: 'swap', chainId: 999999, protocol: 'swap', amountUsd: 100, execution: true },
    polL3,
    { sessionStartAt: Date.now(), now: Date.now() }
  );
  t('an unsupported chain at EXECUTION time stays a hard rejection',
    unknownChainExec.approved === false && unknownChainExec.reasons.includes('CHAIN_NOT_SUPPORTED'));

  t('the extended chain allowlist covers the majors + new L2s',
    [1, 56, 137, 42161, 8453, 10, 43114, 59144, 146, 130, 324, 5000, 81457, 534352]
      .every((id) => perm.ALLOWED_CHAINS.has(id)));

  /* ====================== 6. UI SOURCE WIRING ============================= */

  const panel = readFileSync('src/components/IntentAIPanel.jsx', 'utf8');
  const os = readFileSync('src/pages/IntentOS.jsx', 'utf8');
  const histView = readFileSync('src/components/IntentTxHistory.jsx', 'utf8');

  t('the panel enriches pending analysis replies with real market data',
    panel.includes('buildChatMarketAnalysis') && panel.includes('dataStatus === \'pending\''));
  t('the panel records receipts into the local history',
    panel.includes('recordIntentTx') && panel.includes('recordHistory('));
  t('the panel renders a dedicated market card for analysis replies',
    panel.includes('MarketAnalysisCard') && panel.includes('data-testid="market-analysis"'));
  t('the panel is always live (no activation banner gating the chat)',
    panel.includes('const intentIsLive = true'));
  t('the panel auto-fires a market brief on open',
    panel.includes('autoBriefRef') && panel.includes('intentAI.quick.phrase.marketBrief'));
  /*
   * Owner decision: the quick-action chip row above the chat (swap / market
   * brief / futures / lend / goal / Intent OS) and the pipeline stage rail
   * were removed — everything they offered is one sentence in the composer,
   * and they pushed the conversation below the fold. What must NOT regress is
   * the localized market brief that still fires once on open, which is why the
   * phrase key above is still asserted.
   */
  t('the quick-chip row and the pipeline stage rail are gone from the panel',
    !panel.includes('QUICK_CHIPS') && !panel.includes('ia-quick-row')
    && !panel.includes('AiStageRail') && !panel.includes('ia-stage-chip'));
  t('the history tab exists on the Intent OS page and renders the read view',
    os.includes("'history'") && os.includes('IntentTxHistory'));
  t('the history view is local-only with a user-controlled wipe',
    histView.includes('loadIntentTxHistory') && histView.includes('clearIntentTxHistory')
    && histView.includes('intentAI.history.clear'));

  const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  const fa = JSON.parse(readFileSync('src/i18n/locales/fa.json', 'utf8'));
  const ar = JSON.parse(readFileSync('src/i18n/locales/ar.json', 'utf8'));
  const pick = (o, p) => p.split('.').reduce((c, k) => (c ? c[k] : undefined), o);
  const needKeys = [
    'intentAI.setup.title', 'intentAI.quick.title', 'intentAI.quick.phrase.marketBrief',
    'intentAI.history.title', 'intentAI.history.status.authorized', 'intentAI.history.clear',
    'intentAI.analysis.loading', 'intentAI.analysis.notAdvice', 'intentAI.analysis.signal.up',
    'intentAI.examples.futures.title', 'intentAI.examples.lending.title', 'intentAI.examples.staking.title',
    'intentOS.tab.history'
  ];
  t('all new keys exist in en, fa and ar',
    needKeys.every((k) => ['en', 'fa', 'ar'].every((c) => typeof pick(c === 'en' ? en : c === 'fa' ? fa : ar, k) === 'string')));
  t('the Persian quick phrases are really Persian',
    /[\u0600-\u06ff]/.test(pick(fa, 'intentAI.quick.phrase.marketBrief'))
    && /[\u0600-\u06ff]/.test(pick(fa, 'intentAI.quick.phrase.goal')));

  return rows;
}
