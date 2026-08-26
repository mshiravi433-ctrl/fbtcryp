export default async function run() {
  const rows = [];
  const t = (n, ok) => rows.push([n, Boolean(ok)]);
  const scoreMod = await import('../../src/lib/intent-ai/agentScore.js');

  // Thin sample (< MIN) → insufficient_data, no fabricated success rate.
  const thin = scoreMod.observedScore([{ outcome: 'success', confirmed: true }, { outcome: 'failure' }]);
  t('thin sample is insufficient_data', thin.status === 'insufficient_data');
  t('thin sample has no successRate', thin.successRate === null);
  t('thin sample has no score number', thin.score === null);
  t('thin sample still counted for sampleSize', thin.sampleSize === 2);

  // Adequate sample → rated, bounded, observed.
  const samples = Array.from({ length: 7 }, (_, i) => ({ outcome: i < 5 ? 'success' : 'failure', confirmed: true, latencyMs: 120 }));
  const rated = scoreMod.observedScore(samples);
  t('adequate sample is rated', rated.status === 'rated');
  t('rated sample has a bounded successRate', rated.successRate > 0 && rated.successRate <= 1);
  t('rated score is 0..100', rated.score >= 0 && rated.score <= 100);
  t('score is observed', rated.observed === true);
  t('score never verifies', rated.verifiedByScore === false);

  // Score never replaces Guardian.
  t('score is not guardian replacement', rated.guardianReplacement === false);
  t('SCORE_NEVER_VERIFIES exported', scoreMod.SCORE_NEVER_VERIFIES === true);

  // Fabricated success (unconfirmed) is not counted.
  const fabricated = scoreMod.observedScore([{ outcome: 'success', confirmed: false }]);
  t('fabricated success is not scored', fabricated.status === 'insufficient_data' && fabricated.sampleSize === 0);

  // Display label honesty: unknown for thin, rated for adequate.
  const lblThin = scoreMod.scoreDisplayLabel(thin);
  const lblRated = scoreMod.scoreDisplayLabel(rated);
  t('thin display is unknown, not 0 or 100', lblThin.status === 'unknown' && lblThin.label === null);
  t('rated display is honest percent', lblRated.status === 'rated' && lblRated.label === `${Math.round(rated.score)}%`);

  // No samples → insufficient.
  t('no samples is insufficient', scoreMod.observedScore([]).status === 'insufficient_data');
  t('non-array is insufficient', scoreMod.observedScore(null).status === 'insufficient_data');

  return rows;
}
