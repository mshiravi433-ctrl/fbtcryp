/**
 * Local FAQ matching + gas readiness.
 *
 * The FAQ answers questions about people's money, so a confident wrong match
 * is worse than no match. These tests check both that real questions hit the
 * right topic AND that nonsense returns null.
 */
export async function run() {
  const results = [];
  const check = (n, ok, d) => results.push([d ? `${n} — ${d}` : n, Boolean(ok)]);

  const { findLocalAnswer } = await import('../src/lib/localFaq.js');
  const { hasEnoughGas, gasBufferFor, suggestChain } = await import('../src/lib/gas.js');
  const fa = (await import('../src/i18n/locales/fa.json', { with: { type: 'json' } })).default;

  /* ------------------------------ FAQ ------------------------------ */

  const cases = [
    ['کارمزد چقدر است؟', 'fee'],
    ['چقدر کارمز میگیرید', 'fee'],
    ['what is the fee', 'fee'],
    ['گس یعنی چی', 'gas'],
    ['I have no BNB for gas', 'gas'],
    ['چرا سواپ من رد شد', 'swapFailed'],
    ['my swap failed', 'swapFailed'],
    ['لغزش چیست', 'slippage'],
    ['پول من امن است؟', 'custody'],
    ['is my money safe', 'custody'],
    ['عبارت بازیابی را کجا نگه دارم', 'seed'],
    ['کیف پول وصل نمیشه', 'connect'],
    ['موجودی صفر نشون میده', 'balanceZero'],
    ['تراکنش پندینگ مونده', 'pending'],
    ['امتیاز به چه درد میخوره', 'points'],
    ['توکن جدید رو چطور اضافه کنم', 'newToken'],
    ['چطور به ریال تبدیل کنم', 'withdraw'],
    ['حداقل مبلغ چقدره', 'minimum'],
    ['این کلاهبرداری نیست؟', 'scam'],
    ['how do I approve a token', 'approve']
  ];

  let hits = 0;
  const misses = [];
  for (const [q, expected] of cases) {
    const got = findLocalAnswer(q);
    if (got?.id === expected) hits += 1;
    else misses.push(`"${q}" → ${got?.id ?? 'null'} (wanted ${expected})`);
  }
  check(`FAQ matches ${hits}/${cases.length} real questions`, misses.length === 0, misses.slice(0, 3).join(' | '));

  // Every answer key must actually resolve, or the user sees a raw key string.
  const unresolved = [];
  for (const [q] of cases) {
    const hit = findLocalAnswer(q);
    if (!hit) continue;
    const val = hit.key.split('.').reduce((o, k) => (o ? o[k] : undefined), fa);
    if (typeof val !== 'string' || val.length < 40) unresolved.push(hit.key);
  }
  check('every matched answer resolves to real Persian text', unresolved.length === 0, unresolved.join(' | '));

  // Must NOT answer things it doesn't know.
  const shouldMiss = ['zzzz', 'قیمت بیت کوین فردا چند میشه دقیقا', 'x', ''];
  const wrongHits = shouldMiss.filter((q) => findLocalAnswer(q) !== null);
  check('returns null rather than guessing', wrongHits.length <= 1, `answered: ${wrongHits.join(', ')}`);

  // Persian/Arabic character variants must normalise.
  check('handles Arabic-script variants (كارمزد → کارمزد)', findLocalAnswer('كارمزد چقدر است')?.id === 'fee');

  /* ------------------------------ gas ------------------------------ */

  check('BSC needs less gas than Ethereum', gasBufferFor(56) < gasBufferFor(1));
  check('0 balance is never enough', !hasEnoughGas(56, 0));
  check('a healthy balance is enough', hasEnoughGas(56, 0.05));
  check('exactly the buffer counts as enough', hasEnoughGas(56, gasBufferFor(56)));
  check('unknown chain gets a default buffer', gasBufferFor(99999) > 0);

  const scan = [
    { chainId: 1, ready: false, balance: 0 },
    { chainId: 56, ready: false, balance: 0.0001 },
    { chainId: 137, ready: true, balance: 12 }
  ];
  check('suggests a funded chain when the current one is dry', suggestChain(scan, 56)?.chainId === 137);
  check('suggests nothing when the current chain is fine', suggestChain(scan, 137) === null);

  return results;
}
