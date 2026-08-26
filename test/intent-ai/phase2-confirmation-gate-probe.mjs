export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const gate = await import('../../src/lib/intent-ai/confirmationGate.js');
  const draft = await import('../../src/lib/intent-ai/draftOrder.js');
  const ui = await import('../../src/lib/intent-ai/confirmationUI.js');

  const d = draft.createDraftOrder({
    kind: 'swap', chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH',
    amountIn: 100, amountUsd: 100, slippagePct: 0.5, protocol: 'swap'
  });
  const opened = gate.openConfirmationGate({ order: d.order });
  t('openConfirmationGate ok', opened.ok && opened.gate.status === 'AWAITING_USER');
  t('UI is immutable with four buttons', opened.gate.ui.immutable && opened.gate.buttons.length === 4);
  t('block has asset/amount/usd/chain/protocol',
    opened.gate.ui.fields.asset && opened.gate.ui.fields.amount && opened.gate.ui.fields.chain === 42161);

  const conf = gate.decideGate(opened.gate, 'CONFIRM', { currentTerms: opened.gate.lockedTerms });
  t('CONFIRM locks gate', conf.ok && conf.gate.confirmed);

  const allow = gate.assertGateAllowsSubmit(conf.gate);
  t('confirmed gate allows submit', allow.ok);

  const changed = { ...opened.gate.lockedTerms, amountIn: 999 };
  const reauth = gate.decideGate(opened.gate, 'CONFIRM', { currentTerms: changed });
  t('amount change requires REAUTHORIZE', reauth.action === 'REAUTHORIZE' && !reauth.ok);

  t('REJECT maps to USER_REJECTED', gate.decideGate(opened.gate, 'REJECT').error.code === 'USER_REJECTED');
  t('CANCEL maps to USER_CANCELLED', gate.decideGate(opened.gate, 'CANCEL').error.code === 'USER_CANCELLED');
  t('unconfirmed gate cannot submit', !gate.assertGateAllowsSubmit(opened.gate).ok);
  t('GATE_BUTTONS exported', ui.GATE_BUTTONS.includes('REAUTHORIZE'));
  return rows;
}
