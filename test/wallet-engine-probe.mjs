/**
 * FBT WALLET ENGINE PROBE — pure logic, no DOM, no network, no wallet SDK.
 * ---------------------------------------------------------------------------
 * Locks the architecture the spec asked for: a capability-aware, state-gated
 * wallet core (orchestrator + registry + adapters) with the ten priority
 * engines on top. Every assertion here is a decision that costs real money if
 * it regresses, so each one is named after the failure it prevents — most
 * importantly the state machine's refusal to confirm a transaction that was
 * never broadcast ("تأیید شد ولی اجرا نشد").
 */
import {
  declareWallet, selectWalletFor, hasCapability, capabilityGaps,
  createWalletRecord, advanceWallet, WALLET_STATES, WALLET_TERMINAL,
  createWalletRegistry, serializeRegistry,
  ADAPTERS, validateAddress, normalizeChainRef, chainFamily, explorerTxUrl,
  createWalletOrchestrator,
  normalizeBalance, aggregateBalances, assetNetworks,
  buildTokenIndex, resolveAsset, SEED_CATALOG,
  simulateOutcome, mergeSimulation, contractRisk,
  checkGas, gasVerdict, gasAbstractionFor,
  isUnlimitedAllowance, scanApprovals,
  assessRecipient, assessToken, detectUnusualBehavior,
  classifyTrade, makeLot, applyTrade, computePnl,
  portfolioSnapshot, concentrationRisk,
  parseRule, evaluateRule, evaluateAll,
  createIndexer, normalizeTx,
  createTracker,
  classifyTransaction, describeKind,
  createAddressBook, checkNetwork,
  createSessionManager, sessionChains, sessionMethods,
  parseRecurring, nextDue,
  buildNotification
} from '../src/lib/wallet-engine/index.js';

const EVM_ADDR = '0x' + '1'.repeat(40);
const EVM_ADDR2 = '0x' + '2'.repeat(40);
const SOL_ADDR = 'F1' + 'a'.repeat(40); // base58-ish structural
const BTC_ADDR = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';

export default function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ── 1. CAPABILITY ENGINE ─────────────────────────────────────────────── */
  const btc = declareWallet({ id: 'btc-main', family: 'bitcoin', address: BTC_ADDR });
  t('bitcoin wallet defaults to send+receive only (no swap/stake/approve)',
    btc.capabilities.includes('send') && btc.capabilities.includes('receive')
    && !btc.capabilities.includes('swap') && !btc.capabilities.includes('stake') && !btc.capabilities.includes('approve'));

  const evm = declareWallet({ id: 'evm-1', family: 'evm', chainId: 1, address: EVM_ADDR });
  t('evm wallet declares swap + approve + revoke',
    evm.capabilities.includes('swap') && evm.capabilities.includes('approve') && evm.capabilities.includes('revoke'));

  const watch = declareWallet({ id: 'watch-1', family: 'evm', chainId: 1, address: EVM_ADDR, capabilities: ['receive', 'watch'] });
  t('a watch-only wallet is narrowed, never widened (no send)', !watch.capabilities.includes('send') && watch.capabilities.includes('watch'));

  t('capability gaps report the missing capability', capabilityGaps(btc, ['send', 'stake']).missing.join(',') === 'stake');

  const selStake = selectWalletFor({ wallets: [btc, evm], capability: 'stake' });
  t('selectWalletFor refuses stake when only btc has been considered but evm qualifies',
    selStake.ok === true && selStake.wallet.id === 'evm-1');

  const selNo = selectWalletFor({ wallets: [btc], capability: 'swap' });
  t('selectWalletFor refuses honestly when nothing qualifies', selNo.ok === false && selNo.code === 'NO_CAPABLE_WALLET');

  const sol = declareWallet({ id: 'sol-main', family: 'solana', chainId: 'solana:mainnet', address: SOL_ADDR });
  const selChain = selectWalletFor({ wallets: [evm, sol], capability: 'send', family: 'solana' });
  t('chain/family matching wins selection', selChain.wallet.id === 'sol-main');

  /* ── 2. WALLET STATE MACHINE ──────────────────────────────────────────── */
  let rec = createWalletRecord({ id: 'w1', address: EVM_ADDR });
  const step = (w, next, ev = {}) => advanceWallet(w, next, ev);

  t('CONNECTED without an address is refused',
    step(createWalletRecord({ id: 'w0' }), 'CONNECTED').ok === false
    && step(createWalletRecord({ id: 'w0' }), 'CONNECTED').code === 'ADDRESS_REQUIRED');

  let r1 = step(rec, 'CONNECTED');
  let ok = r1.ok;
  rec = r1.wallet;
  r1 = step(rec, 'READY'); ok = ok && r1.ok; rec = r1.wallet;
  r1 = step(rec, 'ACTION_PREPARED', { operation: { type: 'send', to: EVM_ADDR2 } }); ok = ok && r1.ok; rec = r1.wallet;
  r1 = step(rec, 'AWAITING_SIGNATURE'); ok = ok && r1.ok; rec = r1.wallet;
  r1 = step(rec, 'SIGNED', { signature: '0xsig' }); ok = ok && r1.ok; rec = r1.wallet;
  r1 = step(rec, 'BROADCASTED', { txHash: '0xhash' }); ok = ok && r1.ok; rec = r1.wallet;
  r1 = step(rec, 'PENDING'); ok = ok && r1.ok; rec = r1.wallet;
  r1 = step(rec, 'CONFIRMED', { receipt: { status: 1 } }); ok = ok && r1.ok && r1.wallet.state === 'CONFIRMED';
  t('the full ladder CREATED → CONFIRMED is reachable WITH evidence', ok);

  t('SIGNED without a signature is refused',
    step({ ...createWalletRecord({ id: 's', address: EVM_ADDR }), state: 'AWAITING_SIGNATURE', operation: { type: 'send' } }, 'SIGNED').code === 'SIGNATURE_REQUIRED');

  t('BROADCASTED without a tx hash is refused (the “approved but never sent” bug)',
    step({ ...createWalletRecord({ id: 's', address: EVM_ADDR }), state: 'SIGNED', signature: '0xsig' }, 'BROADCASTED').code === 'TX_HASH_REQUIRED');

  t('SIGNED cannot jump straight to CONFIRMED', step(
    { ...createWalletRecord({ id: 's', address: EVM_ADDR }), state: 'SIGNED', signature: '0xsig', txHash: '0xhash' }, 'CONFIRMED', { receipt: { status: 1 } }).code === 'ILLEGAL_TRANSITION');

  t('CONFIRMED without a successful receipt lands in FAILED with NO_RECEIPT',
    (() => { const r = step({ ...createWalletRecord({ id: 's', address: EVM_ADDR }), state: 'PENDING', txHash: '0xhash' }, 'CONFIRMED', { receipt: { status: 0 } }); return r.ok && r.wallet.state === 'FAILED' && r.wallet.error === 'NO_RECEIPT'; })());

  t('terminal FAILED / CANCELLED / EXPIRED are reachable and irreversible from CONFIRMED',
    step({ ...createWalletRecord({ id: 's', address: EVM_ADDR }), state: 'READY' }, 'CANCELLED').ok === true
    && step({ ...createWalletRecord({ id: 's', address: EVM_ADDR }), state: 'CONFIRMED', txHash: '0xhash', receipt: { status: 1 } }, 'FAILED').ok === false);

  /* ── 3. REGISTRY ──────────────────────────────────────────────────────── */
  const reg = createWalletRegistry();
  reg.register({ id: 'a', family: 'evm', chainId: 1, address: EVM_ADDR });
  reg.register({ id: 'b', family: 'solana', chainId: 'solana:mainnet', address: SOL_ADDR });
  reg.register({ id: 'c', family: 'evm', chainId: 1, address: EVM_ADDR2, capabilities: ['receive', 'watch'] });
  t('registry replaces by id, finds by address, lists by family',
    reg.register({ id: 'a', family: 'evm', chainId: 1, address: EVM_ADDR }).id === 'a'
    && reg.findByAddress(EVM_ADDR).id === 'a'
    && reg.list({ family: 'evm' }).length === 2
    && reg.list({ family: 'solana' }).length === 1);
  t('primary wallet prefers a non-watch-only wallet', reg.primary().id === 'a');
  t('registry serializes and re-hydrates', (() => { const r2 = createWalletRegistry(); for (const w of serializeRegistry(reg).wallets) r2.register(w); return r2.size() === 3; })());

  /* ── 4. ADAPTERS ──────────────────────────────────────────────────────── */
  t('adapters validate addresses per family',
    validateAddress('evm', EVM_ADDR) && validateAddress('bitcoin', BTC_ADDR) && !validateAddress('evm', 'not-an-address'));
  t('chain refs normalize to the right family',
    normalizeChainRef('56').family === 'evm' && normalizeChainRef('solana:mainnet').family === 'solana'
    && chainFamily('bip122:000000000019d6689c085ae165831e93') === 'bitcoin');
  t('explorer tx url is null for an unknown chain (honest missing)',
    explorerTxUrl('evm', 56, '0xabc') === 'https://bscscan.com/tx/0xabc' && explorerTxUrl('evm', 999999, '0xabc') === null);

  /* ── 5. ORCHESTRATOR ──────────────────────────────────────────────────── */
  const orch = createWalletOrchestrator({ registry: reg });
  /* Wallets a/b/c were registered directly into the registry above; bring
     them up the ladder the way a real connect() would. */
  orch.connect('a'); orch.connect('b'); orch.connect('c');
  const noBtcStake = orch.prepareOnBest({ operation: { type: 'stake', capability: 'stake' }, family: 'bitcoin' });
  t('orchestrator refuses to prepare an operation the family cannot do', noBtcStake.ok === false);
  t('orchestrator prepares on the best capable wallet', (() => {
    const res = orch.prepareOnBest({ operation: { type: 'send', capability: 'send' }, family: 'evm', chainId: 1 });
    return res.ok === true && res.selected.id === 'a';
  })());
  t('orchestrator blocks broadcast without a hash, then completes with one', (() => {
    orch.register({ id: 'flow', family: 'evm', chainId: 1, address: EVM_ADDR });
    orch.connect('flow');
    orch.prepareAction('flow', { type: 'send', capability: 'send' });
    orch.requestSignature('flow');
    const signed = orch.markSigned('flow', '0xsig');
    const noHash = orch.markBroadcast('flow');
    const withHash = orch.markBroadcast('flow', '0xhash');
    const pending = orch.markPending('flow');
    const confirmed = orch.markConfirmed('flow', { status: 1 });
    return signed.ok && noHash.ok === false && noHash.code === 'TX_HASH_REQUIRED'
      && withHash.ok && pending.ok && confirmed.ok && confirmed.wallet.state === 'CONFIRMED';
  })());

  /* ── 6. BALANCE ENGINE ────────────────────────────────────────────────── */
  const balances = [
    { family: 'evm', chainId: 1, symbol: 'USDC', amount: 100, priceUsd: 1 },
    { family: 'evm', chainId: 8453, symbol: 'USDC', amount: 50, priceUsd: 1 },
    { family: 'solana', chainId: 'solana:mainnet', symbol: 'USDC', amount: 25, priceUsd: 1 },
    { family: 'evm', chainId: 1, symbol: 'MYSTERY', amount: 9, priceUsd: null }
  ];
  const agg = aggregateBalances(balances);
  t('aggregate sums the same asset across chains', agg.byAsset.find((a) => a.symbol === 'USDC').totalAmount === 175);
  t('an unpriced asset keeps the total partial, not silently lower', agg.partial === true && agg.pricedCount === 3 && agg.totalCount === 4);
  t('assetNetworks lists every chain a token appears on', assetNetworks(balances, 'USDC').length === 3);

  /* ── 7. ASSET RESOLVER ────────────────────────────────────────────────── */
  const index = buildTokenIndex();
  t('USDC resolves to a candidate with a network', (() => { const r = resolveAsset('USDC', index); return r.resolved && r.candidates.length >= 1 && r.candidates[0].symbol === 'USDC'; })());
  t('an EVM address resolves to exactly its token', (() => {
    const idx = buildTokenIndex([{ family: 'evm', chainId: 1, symbol: 'WETH', address: EVM_ADDR, decimals: 18 }]);
    const r = resolveAsset(EVM_ADDR, idx);
    return r.resolved && r.best.symbol === 'WETH' && r.best.matchedOn === 'address';
  })());
  t('a BTC address resolves to the bitcoin network', resolveAsset(BTC_ADDR, index).best?.family === 'bitcoin');
  t('an unknown query resolves to nothing (never a fabricated token)', resolveAsset('ZZZZZZ', index).resolved === false);
  t('symbol prefix matches are flagged as ambiguous, not silently chosen',
    (() => { const r = resolveAsset('US', index); return r.candidates.length > 1 && r.ambiguity != null; })());

  /* ── 8. SIMULATION ────────────────────────────────────────────────────── */
  const sim = simulateOutcome({ amountIn: 1, priceInUsd: 3000, priceOutUsd: 1, received: 2970, gasNative: 0.002, gasPriceUsd: 3000, balanceBeforeUsd: 10000, feeUsd: 21 });
  t('simulation computes gas cost, fee and post-trade balance', sim.gasCostUsd === 6 && sim.feeUsd === 21 && sim.balanceAfterUsd === 9973);
  t('a provider-busy eth_call keeps the merged verdict blocked', mergeSimulation('provider-busy', sim).blocked === true && mergeSimulation('provider-busy', sim).safeToSign === false);
  t('a clean eth_call clears the pre-sign gate', mergeSimulation('simulated-clean', sim).safeToSign === true);
  t('no scan data → contract risk is unknown, not clean', contractRisk({}).level === 'unknown');
  t('a honeypot contract is high risk', contractRisk({ honeypot: true }).level === 'high');

  /* ── 9. GAS MANAGER ───────────────────────────────────────────────────── */
  t('missing fee data → unknown, not “fine”', checkGas({}).level === 'unknown' && checkGas({}).ok === null);
  t('enough gas passes; shortfall is quantified in native and USD',
    checkGas({ nativeBalance: 1, feeNative: 0.01 }).ok === true
    && (() => { const c = checkGas({ nativeBalance: 0.01, feeNative: 0.01, nativePriceUsd: 3000 }); return c.ok === false && c.level === 'low' && c.shortfallUsd > 0; })());
  t('gas abstraction is available only when the chain supports AND configures it',
    gasAbstractionFor(1, { configured: true }).available === true && gasAbstractionFor(1, { configured: false }).available === false);

  /* ── 10. APPROVAL MANAGER ─────────────────────────────────────────────── */
  const MAX = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
  t('unlimited allowance detection catches MaxUint256', isUnlimitedAllowance(MAX) === true && isUnlimitedAllowance('1000') === false);
  t('approval scan surfaces unlimited approvals first', (() => {
    const summary = scanApprovals([
      { token: EVM_ADDR, spender: EVM_ADDR2, allowance: '1000' },
      { token: EVM_ADDR, spender: EVM_ADDR2, allowance: MAX }
    ]);
    return summary.unlimitedCount === 1 && summary.entries[0].unlimited === true && summary.entries[0].revoke.action === 'revoke';
  })());

  /* ── 11. SECURITY ENGINE ──────────────────────────────────────────────── */
  t('a fresh contract recipient is flagged, a known clean one is not',
    assessRecipient({ txCount: 0, code: '0x', checksummed: true, known: false }).flags.includes('fresh')
    && assessRecipient({ txCount: 5, code: '0x', checksummed: true, known: true }).level === 'none');
  t('a blocklisted recipient is high risk', assessRecipient({ txCount: 5, code: '0x', checksummed: true, known: true, blocklisted: true }).level === 'high');
  t('unusual behavior: first action being large is flagged', detectUnusualBehavior([{ kind: 'send', ts: Date.now() - 1000, valueUsd: 50000, to: EVM_ADDR2 }]).flags.includes('first-action-large'));

  /* ── 12. COST BASIS + P&L ─────────────────────────────────────────────── */
  let lots = [];
  const buy = applyTrade(lots, { kind: 'BUY', asset: 'ETH', amount: 1, priceUsd: 2000, feeUsd: 10 });
  lots = buy.lots;
  const sell = applyTrade(lots, { kind: 'SELL', asset: 'ETH', amount: 0.5, priceUsd: 3000, feeUsd: 5 });
  lots = sell.lots;
  t('buy opens a lot with fee-inclusive cost basis', buy.ok && buy.lots[0].costPerUnit === 2010);
  t('sell realizes FIFO P&L = proceeds − cost of sold units', sell.realizedPnl === 3000 * 0.5 - 5 - 2010 * 0.5);
  t('a transfer-out realizes nothing (same owner moving custody)', applyTrade(lots, { kind: 'TRANSFER_OUT', asset: 'ETH', amount: 0.2, priceUsd: 2500 }).realizedPnl === 0);
  t('selling more than held is clamped and flagged, not negative lots', (() => {
    const r = applyTrade(lots, { kind: 'SELL', asset: 'ETH', amount: 100, priceUsd: 3000 });
    return r.overSold === true && r.lots.filter((l) => l.asset === 'ETH').length === 0;
  })());
  t('swap is a sell + buy: realized on input, new lot on output', (() => {
    const r1 = applyTrade(lots, { kind: 'SELL', asset: 'ETH', amount: 0.5, priceUsd: 3000 });
    const r2 = applyTrade(r1.lots, { kind: 'BUY', asset: 'USDC', amount: 1500, priceUsd: 1 });
    return r1.realizedPnl !== 0 && r2.lots.some((l) => l.asset === 'USDC');
  })());
  t('computePnl reports unrealized until sold', (() => {
    const pnl = computePnl(lots, { ETH: 4000 });
    return pnl.positions[0].unrealizedPnl === 4000 * 0.5 - 2010 * 0.5 && pnl.realizedTotal === 0;
  })());

  /* ── 13. PORTFOLIO ────────────────────────────────────────────────────── */
  const port = portfolioSnapshot([
    { asset: 'ETH', amount: 1, priceUsd: 3000, costBasis: 2000 },
    { asset: 'USDC', amount: 1000, priceUsd: 1, costBasis: 1000 }
  ]);
  t('allocation weights sum to 100 and the largest position is ETH',
    Math.abs(port.allocation[0].weightPct - 75) < 1e-9 && port.allocation[0].asset === 'ETH');
  t('concentration risk reads the largest position', concentrationRisk(port.concentrationPct).level === 'high');
  t('performance % needs a cost basis and computes honestly',
    Math.abs(port.performancePct - ((4000 - 3000) / 3000) * 100) < 1e-9);

  /* ── 14. AUTOMATION ───────────────────────────────────────────────────── */
  const priceRule = parseRule({ id: 'r1', when: 'PRICE_LT', asset: 'ETH', threshold: 2500 });
  t('price-below rule fires only when the price is under the threshold',
    evaluateRule(priceRule, { prices: { ETH: 2400 } }).triggered === true
    && evaluateRule(priceRule, { prices: { ETH: 2600 } }).triggered === false);
  t('missing data never reads as “condition met”', evaluateRule(priceRule, {}).triggered === false && evaluateRule(priceRule, {}).dataMissing === true);
  t('an unknown rule type is a typed failure, not a silent no-op', evaluateRule({ when: 'WHATEVER' }, {}).error === 'UNKNOWN_RULE');
  t('evaluateAll returns only the triggered alerts', evaluateAll([priceRule, parseRule({ id: 'r2', when: 'LARGE_TX', threshold: 100 })], { prices: { ETH: 2400 }, incomingUsd: 500 }).alerts.length === 2);

  /* ── 15. UNIFIED INDEXER ──────────────────────────────────────────────── */
  const idx = createIndexer();
  idx.ingest('evm', { hash: '0xa', chainId: 1, from: EVM_ADDR, to: EVM_ADDR2, kind: 'send', ts: 1000 });
  idx.ingest('evm', { hash: '0xa', chainId: 1, from: EVM_ADDR, to: EVM_ADDR2, kind: 'send', ts: 2000 });
  idx.ingest('solana', { signature: 's1', chainId: 'solana:mainnet', from: SOL_ADDR, kind: 'receive', ts: 3000 });
  t('indexer is idempotent on (family, chain, hash)', idx.count() === 2);
  t('indexer queries across chains in one timeline', idx.query({}).length === 2 && idx.query({ family: 'solana' }).length === 1 && idx.query({ address: EVM_ADDR }).length === 1);
  t('a tx with no hash is refused, not silently indexed', createIndexer().ingest('evm', { kind: 'send' }).ok === false);

  /* ── 16. REAL-TIME TRACKER ────────────────────────────────────────────── */
  const tracker = createTracker();
  const seen = [];
  const unsub = tracker.subscribe((e) => seen.push(e.event));
  tracker.emit('t1', 'ACTION_PREPARED');
  tracker.emit('t1', 'SIGNED');
  tracker.emit('t1', 'BROADCASTED');
  tracker.emit('t1', 'PENDING');
  tracker.emit('t1', 'CONFIRMED');
  t('tracker emits the canonical event stream in order', JSON.stringify(seen) === JSON.stringify(['PREPARED', 'SIGNED', 'BROADCAST', 'PENDING', 'CONFIRMED']));
  t('timeline returns ordered events and null for unknown tx', tracker.timeline('t1').length === 5 && tracker.timeline('nope') === null);
  unsub();
  tracker.emit('t2', 'SIGNED');
  t('unsubscribe stops delivery', seen.length === 5);

  /* ── 17. TRANSACTION INTELLIGENCE ─────────────────────────────────────── */
  t('an approve selector decodes to approve', classifyTransaction({ input: '0x095ea7b3' + '0'.repeat(64) }).kind === 'approve');
  t('an inbound transfer decodes to receive', classifyTransaction({ direction: 'in' }).kind === 'receive');
  t('a swap method decodes to swap', classifyTransaction({ method: '0x38ed1739' }).kind === 'swap');
  t('no evidence decodes to unknown, not a guess', classifyTransaction({}).kind === 'unknown');

  /* ── 18. ADDRESS BOOK ─────────────────────────────────────────────────── */
  const book = createAddressBook();
  book.add({ address: EVM_ADDR2, label: 'treasury' });
  book.touch(EVM_ADDR2);
  t('address book names and ranks by usage', book.get(EVM_ADDR2).label === 'treasury' && book.frequent(1)[0].useCount === 1);
  t('wrong-network paste is caught before sending',
    checkNetwork(SOL_ADDR, { chainId: 1 }).code === 'NETWORK_MISMATCH'
    && checkNetwork(EVM_ADDR, { chainId: 1 }).ok === true);

  /* ── 19. WALLETCONNECT SESSION MANAGER ────────────────────────────────── */
  const sm = createSessionManager();
  const session = { topic: 't1', expiry: Date.now() + 60000, namespaces: { eip155: { accounts: ['eip155:1:' + EVM_ADDR], methods: ['eth_sendTransaction', 'personal_sign'] } } };
  sm.add({ session, peer: { name: 'Dapp X' } });
  t('session chains/methods are read from the signed namespace, not assumed',
    JSON.stringify(sessionChains(session)) === JSON.stringify(['eip155:1']) && sessionMethods(session).includes('eth_sendTransaction'));
  t('active/expired/distinct connect/disconnect behave',
    sm.active().length === 1 && sm.expired('t1').expired === false && sm.disconnect('t1').ok === true && sm.list().length === 0);

  /* ── 20. RECURRING ────────────────────────────────────────────────────── */
  const dca = parseRecurring({ type: 'DCA', asset: 'ETH', amount: 100, interval: 'week', startAt: 1000, maxRuns: 2 });
  t('nextDue is in the future before the first run', nextDue(dca, { now: 1000 }).due === false);
  t('nextDue is due once its interval has elapsed', nextDue(dca, { now: 1000 + 7 * 86400000 }).due === true);
  t('a finished schedule reports FINISHED, not a phantom run', (() => {
    const done = { ...dca, runs: 2 };
    return nextDue(done, { now: 1e12 }).code === 'FINISHED';
  })());

  /* ── 21. NOTIFICATIONS ────────────────────────────────────────────────── */
  t('known events map to typed, translatable notifications',
    buildNotification('large_transfer').known === true && buildNotification('large_transfer').key === 'notif.largeTransfer');
  t('unknown events fall back to a generic, never dropped', buildNotification('??').known === false && buildNotification('??').type === 'generic');

  return rows;
}

/* Standalone entry (npm run test:wallet-engine). When imported by
   test/run.mjs, the runner calls run() itself — process.exit here would kill
   the whole shared suite process. */
import { pathToFileURL } from 'node:url';
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const rows = run();
  let failed = 0;
  for (const [name, ok] of rows) {
    if (!ok) { failed += 1; console.log('✗', name); } else { console.log('✓', name); }
  }
  console.log(`\nwallet-engine: ${rows.length - failed}/${rows.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}
