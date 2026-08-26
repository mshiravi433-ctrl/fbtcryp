export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const refine = await import('../../src/lib/intent-ai/strategyRefine.js');

  // No opt-in memory → refine is a no-op, honest note.
  const noOp = refine.refineStrategies([{ id: 'p1', strategy: 'spot_swap', confidence: 40 }], { samples: [] });
  t('no memory → no-op refine', noOp.ok && noOp.refined === 0);
  t('no memory → honest note', noOp.note === 'NO_LOCAL_MEMORY');

  // With memory, refine nudges confidence but caps it.
  const samples = [
    { strategy: 'spot_swap', outcome: 'success', confirmed: true },
    { strategy: 'spot_swap', outcome: 'success', confirmed: true },
    { strategy: 'spot_swap', outcome: 'success', confirmed: true },
    { strategy: 'spot_swap', outcome: 'success', confirmed: true },
    { strategy: 'spot_swap', outcome: 'failure', confirmed: true },
    { strategy: 'spot_swap', outcome: 'success', confirmed: true },
    { strategy: 'spot_swap', outcome: 'success', confirmed: true }
  ];
  const res = refine.refineStrategies([{ id: 'p1', strategy: 'spot_swap', confidence: 40 }], { samples });
  t('refine runs with memory', res.ok);
  t('refined proposal carries capped confidence', res.proposals[0].confidence <= refine.MAX_REFINED_CONFIDENCE);
  t('refined proposal is never 100%', res.proposals[0].confidence < 100);
  t('refine embeds honest disclaimers', res.proposals[0].disclaimers.includes('NOT_GUARANTEED') && res.proposals[0].disclaimers.includes('PARTIAL_LOSS_POSSIBLE'));

  // Refine never claims guaranteed profit. The honest NOT_GUARANTEED disclaimer is
  // allowed; any POSITIVE guarantee claim is not.
  const json = JSON.stringify(res.proposals[0]);
  t('refine never claims guaranteed profit', !/guaranteed profit|risk-free|zero risk|100% guaranteed|returns? guaranteed/i.test(json));

  // Refine is a suggestion only; it returns proposals unchanged in safety terms.
  t('refine is suggestion-only', res.ok && res.proposals[0].refinedByMemory === true);

  // Invalid input fails closed.
  t('non-array proposals fails closed', refine.refineStrategies(null).ok === false);

  // MAX_REFINED_CONFIDENCE is a hard ceiling.
  t('MAX_REFINED_CONFIDENCE is a guarded ceiling', refine.MAX_REFINED_CONFIDENCE <= 80);

  return rows;
}
