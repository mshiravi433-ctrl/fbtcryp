/** Deterministic, evidence-cited AI Command Center answer. The LLM may help
 * translate/explain elsewhere; it cannot manufacture wallets or confidence. */

/** An alert instruction is not a research question. Return a route to the
 * *reviewable* Intent monitor draft ONLY for an unambiguous chain + contract;
 * a ticker alone must never become a contract-scoped alert. */
export function smartMoneyMonitorHandoff(message = '') {
  const text = String(message || '');
  if (!/\b(monitor|alert|notify|watch|track|remind)\b|مانیتور|هشدار|خبرم|خبر بده|بپای|پایش|ردیابی/i.test(text)) return null;
  const address = text.match(/0x[a-fA-F0-9]{40}\b/)?.[0]?.toLowerCase() || null;
  const chainNames = [
    [1, /\b(ethereum|mainnet)\b|اتریوم/i],
    [56, /\b(bsc|bnb chain)\b|بایننس|بی‌ان‌بی/i],
    [137, /\bpolygon\b|پالیگان/i],
    [42161, /\barbitrum\b|آربیتروم/i],
    [8453, /\bbase\b|شبکه بیس/i],
    [10, /\boptimism\b|آپتیمیزم/i],
    [43114, /\bavalanche\b|آوالانچ/i]
  ];
  const matches = chainNames.filter(([, re]) => re.test(text)).map(([id]) => id);
  const numeric = text.match(/(?:\b(?:chain|network)\s*|شبکه\s*)(1|56|137|42161|8453|10|43114)\b/i);
  if (numeric) matches.push(Number(numeric[1]));
  const chain = [...new Set(matches)].length === 1 ? matches[0] : null;
  const mode = /\b(revers(?:al|e)|turnaround)\b|برگشت|معکوس|چرخش/i.test(text) ? 'reversal'
    : /\b(sell|sells|selling|distribution|outflow)\b|فروش|توزیع|خروج/i.test(text) ? 'sell' : 'buyers';
  return { chain, address, mode, ready: Boolean(chain && address),
    route: chain && address ? `/intent?smMonitor=${mode}&smChain=${chain}&smToken=${address}` : null };
}

export function narrateIntelligence(intel, { message = '', lang = 'fa' } = {}) {
  const fa = String(lang).toLowerCase().startsWith('fa');
  const rows = Array.isArray(intel?.consensus) ? intel.consensus : [];
  const address = String(message).match(/0x[a-fA-F0-9]{40}/)?.[0]?.toLowerCase();
  const requested = address
    ? rows.filter((r) => r.token === address)
    : rows.filter((r) => r.symbol && r.symbol.length >= 2
      && new RegExp(`(^|[^A-Za-z0-9])${String(r.symbol).replace(/[^A-Za-z0-9]/g, '')}([^A-Za-z0-9]|$)`, 'i').test(message));
  const selected = (address || requested.length) ? requested : rows.slice(0, 5);
  const active = selected.filter((r) => r.signal === 'ACCUMULATION' || r.signal === 'DISTRIBUTION');
  const basis = fa
    ? 'این امتیاز قدرت همگرایی شواهد است، نه احتمال سود. انتقال نهنگ، خروج از صرافی و برچسب VC به‌تنهایی خرید تأییدشده نیستند.'
    : 'Evidence strength describes observed convergence, not expected profit. Whale transfers, CEX outflows and VC labels alone are not confirmed buys.';
  const cadence = fa
    ? 'اسکن در استقرار فعلی زمان‌بندی‌شده و نمونه‌ای است، نه پوشش ۲۴ساعتهٔ بلادرنگ.'
    : 'Indexing on this deployment is scheduled and sampled, not 24/7 real-time coverage.';
  if (!active.length) {
    return {
      text: fa
        ? `در دادهٔ قابل‌دسترسی فعلاً اجماع پول هوشمندِ قابل‌تأیید${address ? ' برای این قرارداد' : ''} ندارم؛ «دادهٔ ناکافی» معادل «هیچ‌کس نخریده» نیست. ${selected.length ? `${selected.length} توکن دارای معاملهٔ جفت‌شده دیده شد، اما حداقل ۳ گروه مستقلِ واجد امتیاز لازم فراهم نبود. ` : ''}${basis} ${cadence}`
        : `No independently verified smart-money consensus${address ? ' for that contract' : ''} is available in the sampled window. Missing data is not proof nobody bought. ${selected.length ? `${selected.length} token(s) have paired swaps but fewer than three independent qualified groups. ` : ''}${basis} ${cadence}`,
      evidence: { at: intel?.at || null, indexedAt: intel?.indexedAt || null, coverage: intel?.coverage || null, rows: selected.slice(0, 5) },
      dataStatus: 'insufficient-evidence'
    };
  }
  const lines = active.slice(0, 5).map((r) => {
    const label = `${r.symbol} (${r.chain}:${r.token.slice(0, 8)}…)`;
    const net = `$${Math.abs(Math.round(r.netFlowUsd)).toLocaleString('en-US')}`;
    return fa
      ? `${label}: ${r.signal === 'ACCUMULATION' ? 'انباشت' : 'توزیع'}؛ ${r.buyers} خریدار، ${r.sellers} فروشنده، ${r.independentVotes} گروه مستقل؛ خالص ${r.netFlowUsd >= 0 ? '+' : '−'}${net}؛ قدرت شواهد ${r.confidence}/۱۰۰.`
      : `${label}: ${r.signal.toLowerCase()}; ${r.buyers} buyer(s), ${r.sellers} seller(s), ${r.independentVotes} independent group(s); net ${r.netFlowUsd >= 0 ? '+' : '-'}${net}; evidence ${r.confidence}/100.`;
  });
  return {
    text: `${fa ? 'از معاملات جفت‌شدهٔ تأییدشده در بازهٔ مشاهده‌شده:' : 'From verified paired swaps in the observed window:'}\n${lines.join('\n')}\n${basis} ${cadence}`,
    evidence: { at: intel?.at || null, indexedAt: intel?.indexedAt || null, coverage: intel?.coverage || null, rows: active.slice(0, 5) },
    dataStatus: 'observed'
  };
}
