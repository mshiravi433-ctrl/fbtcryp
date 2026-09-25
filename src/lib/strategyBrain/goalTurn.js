/**
 * The unified /intent chat must not let the older Upgrade-8 portfolio
 * suggestion path consume a financial objective before Strategy Brain sees it.
 * This resolver is intentionally pure: the same four-number parser used by the
 * card decides whether the turn is an objective, including Persian numerals.
 * Short answers fill ONLY missing slots in the most recent unfinished goal.
 */
import { parseGoalSpec } from './goalSpec.js';

const STRATEGY_WORDS = /استراتژ[یي]|برنامه\s*(?:سرمایه|پرتفوی)|(?:investment|portfolio)\s*(?:plan|strategy)/i;
const TARGET_WORDS = /سود|بازده|رشد|هدف|profit|return|gain|target/i;
const ANSWER_WORDS = /[\d۰-۹٠-٩]|دلار|تتر|روز|ماه|سال|هفته|ریسک|risk|days?|months?|years?|weeks?|usd|\$/i;

export function resolveGoalTurn({ text = '', messages = [], portfolio = null, wallet = null, balances = null } = {}) {
  const input = String(text || '').trim();
  const context = { portfolio, wallet, balances };
  let spec = parseGoalSpec({ text: input, ...context });
  // A standalone «سودم دو برابر شود» belongs to the existing multiple-goal
  // card, not a four-slot strategy draft with a fabricated capital/horizon.
  const multipleOnly = /دو\s*برابر|[۲2]\s*برابر|double|twice|2\s*[×x]/i.test(input)
    && spec.capitalSource !== 'user' && !STRATEGY_WORDS.test(input);
  const explicitGoal = STRATEGY_WORDS.test(input)
    || (!multipleOnly && spec.targetPct != null && TARGET_WORDS.test(input));
  if (explicitGoal) return { objective: true, text: input, spec, resumed: false };

  // An answer belongs to a draft only while the latest AI strategy card is
  // incomplete. Never merge a fresh portfolio question or an execution command
  // into yesterday's goal, and never alter the user's actual message bubble.
  if (input.length > 120 || !ANSWER_WORDS.test(input) || /انجام\s*بده|اجرا\s*کن|confirm|do\s*it|لغو|cancel|بیخیال/i.test(input)) {
    return { objective: false, text: input, spec, resumed: false };
  }
  const lastAi = [...messages].reverse().find((m) => m?.role === 'ai' || m?.role === 'assistant');
  const previous = lastAi?.strategyDraft?.text || lastAi?.strategyRequest?.text;
  if (!previous || lastAi?.strategyPlan?.ok === true) return { objective: false, text: input, spec, resumed: false };
  const priorSpec = parseGoalSpec({ text: previous, ...context });
  if (priorSpec.ok) return { objective: false, text: input, spec, resumed: false };

  const fills = priorSpec.missing.some((slot) => (
    (slot === 'capitalUsd' && spec.capitalSource === 'user') ||
    (slot === 'targetPct' && spec.targetSource != null) ||
    (slot === 'horizonDays' && spec.horizonSource === 'sentence')
  ));
  if (!fills) return { objective: false, text: input, spec, resumed: false };

  const combined = `${previous} ${input}`;
  spec = parseGoalSpec({ text: combined, ...context });
  return { objective: true, text: combined, spec, resumed: true };
}
