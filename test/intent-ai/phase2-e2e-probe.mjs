export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const human = await import('../../src/lib/intent-ai/humanAi.js');
  const broker = await import('../../src/lib/intent-ai/brokerAdapter.js');
  const rec = await import('../../src/lib/intent-ai/reconciliation.js');

  let sess = human.startSession({
    level: 3,
    defaultChainId: 42161,
    policyInput: {
      maxCapitalUsd: 5000, maxTransactionUsd: 1000, maxLossUsd: 500,
      allowedChains: [42161], allowedProtocols: ['swap'], allowedAssets: ['USDC', 'ETH']
    }
  });
  sess = human.confirmSessionPolicy(sess).session;
  const turn = human.chatTurn(sess, 'swap 100 USDC to ETH on Arbitrum');
  sess = turn.session;
  t('session produces confirmation-ready drafts', turn.reply?.type === 'ready-for-confirmation' && sess.drafts.length >= 1);

  const vague = human.startSession({ level: 2 });
  const c = human.chatTurn(vague, 'hi');
  const answered = human.answerClarifications(c.session, {
    FROM_ASSET: 'USDC', TO_ASSET: 'ETH', AMOUNT: '50', CHAIN_ID: '42161'
  });
  t('answerClarifications continues the session', answered.reply && answered.reply.type !== 'nothing-to-clarify');

  broker.bindBrokerHandle('h_test');
  const sub = broker.brokerSubmit({
    draftOrder: { kind: 'swap', chainId: 42161, amountUsd: 10 },
    handle: 'h_test',
    idempotencyKey: 'abc-1'
  });
  t('broker submit with handle ok and unconfirmed', sub.ok && sub.confirmed === false);
  const again = broker.brokerSubmit({
    draftOrder: { kind: 'swap' }, handle: 'h_test', idempotencyKey: 'abc-1'
  });
  t('idempotent broker replay', again.idempotent === true);
  const wd = broker.brokerSubmit({
    draftOrder: { kind: 'swap' }, handle: 'h_test', op: 'withdraw', idempotencyKey: 'wd1'
  });
  t('withdraw without extra policy fail-closed', wd.ok === false);

  const partial = rec.reconcile({
    observation: { filledAmount: 40, requestedAmount: 100, confirmed: true }
  });
  t('partial fill is honest PARTIAL_EXECUTION', partial.partial && partial.receipt.status === 'PARTIAL_EXECUTION');

  const done = rec.reconcile({
    observation: { filledAmount: 100, requestedAmount: 100, confirmed: true }
  });
  t('completed only when confirmed', done.receipt.status === 'COMPLETED' && done.receipt.confirmed);

  const exec = human.executeConfirmed(sess, {
    action: 'CONFIRM',
    riskInput: {
      tokenRisk: { level: 'low' },
      walletRisk: { level: 'low' },
      simulation: { status: 'simulated-clean' },
      priceImpactPct: 0.1,
      slippagePct: 0.5,
      acknowledgedHigh: true
    },
    observation: { confirmations: 1, confirmed: true, filledAmount: 100, requestedAmount: 100 }
  });
  t('e2e executeConfirmed returns a non-fabricated receipt',
    exec.receipt && exec.receipt.fabricated === false);

  const stopped = human.userStop(sess);
  t('emergency stop freezes session', stopped.status === 'STOPPED');
  const afterStop = human.executeConfirmed(stopped, { action: 'CONFIRM' });
  t('no submit after emergency stop', afterStop.ok === false);
  return rows;
}
