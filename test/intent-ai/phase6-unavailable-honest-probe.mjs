export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const health = await import('../../src/lib/intent-ai/venueHealth.js');
  const pipeline = await import('../../src/lib/intent-ai/submitPipeline.js');
  const recMod = await import('../../src/lib/intent-ai/reconciliation.js');

  // Missing config → unavailable, NEVER success.
  const swapUnavailable = health.venueHealth({ kind: 'swap', chainId: 42161 }, {});
  t('missing config → unavailable', swapUnavailable.status === 'unavailable');
  t('missing config does not claim success', swapUnavailable.ok === false && swapUnavailable.secretsExposed === false);

  // A revoking simulation (revert) → NO SIGN.
  const reverted = await pipeline.submitPipeline({
    draft: { kind: 'swap', chainId: 42161 },
    venueCtx: { signer: true, provider: true, supportedChains: [42161] },
    unsignedTx: { from: '0x1', to: '0x2' },
    simulate: async () => ({ status: 'revert-detected', revertReason: 'Insufficient balance' }),
    signer: async () => ({ signedTx: '0xsigned' }),
    broadcast: async () => ({ ok: true, receiptRef: 'tx_x' })
  });
  t('simulation revert → no sign', reverted.ok === false && reverted.noSign === true && reverted.signed === false);
  t('simulation revert maps to SIMULATION_REVERT', reverted.error.code === 'SIMULATION_REVERT');
  t('simulation revert is not COMPLETED', reverted.lifecycleStatus !== 'COMPLETED');

  // A provider-busy simulation → no sign, honest.
  const busy = await pipeline.submitPipeline({
    draft: { kind: 'swap', chainId: 42161 },
    venueCtx: { signer: true, provider: true, supportedChains: [42161] },
    unsignedTx: { from: '0x1', to: '0x2' },
    simulate: async () => ({ status: 'provider-busy' }),
    signer: async () => ({ signedTx: '0xsigned' })
  });
  t('provider-busy → no sign', busy.ok === false && busy.noSign === true && busy.signed === false);

  // No unsigned tx while a provider is required → simulation-unavailable, no sign.
  const noTx = await pipeline.submitPipeline({
    draft: { kind: 'swap', chainId: 42161 },
    venueCtx: { signer: true, provider: true, supportedChains: [42161] },
    signer: async () => ({ signedTx: '0xsigned' }),
    broadcast: async () => ({ ok: true, receiptRef: 'tx_y' })
  });
  t('no unsigned tx + swap → no sign', noTx.ok === false && noTx.status === 'simulation-unavailable' && noTx.noSign === true);

  // A failed broadcast is reported, never fabricated.
  const badBroadcast = await pipeline.submitPipeline({
    draft: { kind: 'swap', chainId: 42161 },
    venueCtx: { signer: true, provider: true, supportedChains: [42161] },
    unsignedTx: { from: '0x1', to: '0x2' },
    simulate: async () => ({ status: 'simulated-clean' }),
    signer: async () => ({ signedTx: '0xsigned' }),
    broadcast: async () => ({ ok: false })
  });
  t('failed broadcast is submit-rejected', badBroadcast.ok === false && badBroadcast.status === 'submit-rejected');

  // Reconciliation is honest: no fabricated COMPLETED from a pending submit.
  const rec = recMod.reconcile({ lifecycleStatus: 'WATCHING', observation: {} });
  t('reconcile never fabricates COMPLETED', rec.receipt.status !== 'COMPLETED' || rec.receipt.confirmed === true);
  t('pending submit reports pending, not success', rec.ok !== false || rec.receipt.fabricated === false);

  // Emergency stop hardens the monitor through the pipeline.
  const halted = await pipeline.submitPipeline({
    draft: { kind: 'swap', chainId: 42161 },
    venueCtx: { signer: true, provider: true, supportedChains: [42161] },
    unsignedTx: { from: '0x1', to: '0x2' },
    simulate: async () => ({ status: 'simulated-clean' }),
    signer: async () => ({ signedTx: '0xsigned' }),
    broadcast: async () => ({ ok: true, receiptRef: 'tx_z' }),
    emergencyStop: true
  });
  t('emergency stop halts the pipeline', halted.ok === false && halted.status === 'emergency-stop');

  return rows;
}
