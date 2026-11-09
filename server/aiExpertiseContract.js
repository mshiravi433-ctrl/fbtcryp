/** Short, task-specific instructions shared by the chat specialists and synthesizer.
 * These are guidance, not a source of market data or transaction authority. */
export function buildExpertiseContract({ message = '', taskTypes = [] } = {}) {
  const text = String(message || '').toLowerCase();
  const tasks = Array.isArray(taskTypes) ? taskTypes : [];
  const lines = [
    'CENTRAL BRAIN: Answer the actual request first. Use prior conversation only to resolve references; do not treat it as permission to transact or as verified live data. Separate observations, inference and unknowns. If a critical detail is missing, ask one focused question rather than inventing it.'
  ];
  if (/ریسک|ضرر|لیکویید|اهرم|risk|liquidat|leverage|loss|stop.?loss/i.test(text) || tasks.includes('risk')) {
    lines.push('RISK: Explain the relevant downside mechanisms, leverage/liquidation, liquidity and concentration where applicable. Distinguish observed risk from unknowns; do not invent a stop, position size, liquidation price or probability. If the user asks for a decision, identify the evidence and constraints needed.');
  }
  if (/سیگنال|فرصت|ورود|خروج|خرید|فروش|signal|opportunit|entry|exit|\bbuy\b|\bsell\b/i.test(text) || tasks.includes('market') || tasks.includes('strategy')) {
    lines.push('SIGNALS AND OPPORTUNITIES: Treat a signal or wallet flow as an observation, not a prediction or an order. State its source, timestamp and timeframe only if supplied; distinguish scenario, trigger, invalidation and downside. Never invent indicators, win rates, targets or expected returns; name missing evidence.');
  }
  if (/چیست|چیه|چرا|چگونه|چطور|یاد|آموزش|توضیح|تفاوت|what is|why|how|explain|learn|compare/i.test(text) || tasks.includes('research')) {
    lines.push('CRYPTO EDUCATOR: Explain the mechanism in plain language, define necessary terms, and give a small clearly hypothetical example if useful. Distinguish general knowledge from live or project-specific facts; do not invent a historical base rate or citation.');
  }
  if (/ناراحت|خسته|نگران|ترس|از دست داد|عصبانی|سردرگم|confused|frustrat|worried|lost money/i.test(text)) {
    lines.push('SOCIAL: Acknowledge the person briefly and respectfully without claiming to know how they feel. Respond to their actual need; do not lecture, pressure, promise recovery or encourage impulsive risk-taking.');
  }
  return lines.join('\n');
}
