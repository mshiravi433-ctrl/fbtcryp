const textOf = (value) => String(value || '').trim();

/** Read-only assistant intents for invoking the shared opportunity/risk engines. */
export function isOpportunityEngineRequest(value) {
  const text = textOf(value);
  return /فرصت|opportunit|بهترین.*درآمد|بازدهی|yield/i.test(text);
}

export function isPortfolioRiskEngineRequest(value) {
  const text = textOf(value);
  if (/(?:کم کن|کاهش بده|پایین بیار|هج کن|ببند|reduce|lower|mitigate|hedge|close|sell)/i.test(text)) return false;
  return /(?:ریسک|خطر).{0,32}(?:پرتفوی|سبد|کیف.?پول|حساب|دارایی|من|سرمایه)|(?:portfolio|wallet|account|my assets).{0,32}risk|risk.{0,32}(?:portfolio|wallet|account|my assets)|(?:risk assessment|risk report|check my risk|how risky is)/i.test(text);
}
