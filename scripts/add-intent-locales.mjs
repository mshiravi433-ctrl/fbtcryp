import fs from 'node:fs';
import path from 'node:path';

const base = path.resolve('src/i18n/locales');

const en = {
  eyebrow: 'Financial intent control plane',
  title: 'Declare the outcome. Keep control.',
  subtitle: 'FBT turns an explicit financial goal into policy checks, solver candidates, a user-signed execution and a verifiable receipt — without giving AI unrestricted access to funds.',
  badge: { nonCustodial: 'Non-custodial', policyBound: 'Bound by policy', verifiable: 'Verifiable receipts' },
  pipelineTitle: 'Intent execution pipeline',
  stage: { intent: 'Intent', risk: 'Risk', solvers: 'Solvers', simulation: 'Simulate', execution: 'Execute', verification: 'Verify' },
  tab: { compose: 'Compose', memory: 'Memory', proofs: 'Proofs', network: 'Network' },
  compose: {
    choose: 'Choose an outcome',
    structured: 'Money fields stay deterministic',
    localOnly: 'Local draft',
    compile: 'Compile through risk engine'
  },
  template: {
    swap: { title: 'Best-route swap', body: 'Compare executable DEX routes under one fee and slippage policy.' },
    outcome: { title: 'Outcome request', body: 'Set a minimum receive amount and a deadline for competing solvers.' },
    automation: { title: 'Rule-based intent', body: 'Watch a condition, then require your review and signature.' },
    workflow: { title: 'Composable workflow', body: 'Model swap, bridge, deposit, borrow and send as one plan.' }
  },
  field: {
    pay: 'You provide', receive: 'Desired outcome', fromToken: 'Input token', toToken: 'Output token',
    bestAvailable: 'Best available', chain: 'Starting network', deadline: 'Deadline', hours: '{{n}} hours',
    usdValue: 'Declared USD estimate', usdValueHint: 'Context only. Policy checks trust this automatically only for stablecoin input.', slippage: 'Maximum slippage (%)', privacy: 'Privacy requirement',
    condition: 'Trigger rule', targetPrice: '{{symbol}} target price', scheduleSignature: 'The schedule prepares a review; it never signs in the background.',
    workflowAction: 'Action {{n}}', workflowTarget: 'Asset, chain or destination', addStep: 'Add workflow step', removeStep: 'Remove step',
    note: 'Intent note (optional)', notePlaceholder: 'Explain the outcome in your own words…',
    noteSafety: 'The note is context only. Execution is compiled from the structured fields above.'
  },
  condition: { priceBelow: 'Price falls below', priceAbove: 'Price rises above', daily: 'Every day', weekly: 'Every week', monthly: 'Every month' },
  privacy: {
    standard: { title: 'Standard', body: 'Normal wallet broadcast. Token, amount and strategy may become public before or during settlement.' },
    relay: { title: 'Private relay', body: 'A private mempool can reduce public exposure, but this app cannot attest which RPC an external wallet used.' },
    confidential: { title: 'Confidential', body: 'Requires commit-reveal, an enclave or threshold encryption. No such transport is connected yet.' }
  },
  action: { swap: 'Swap', bridge: 'Bridge', deposit: 'Deposit', borrow: 'Borrow', send: 'Send' },
  result: {
    title: 'Compiled execution plan', 'ready-for-review': 'Ready for review', 'draft-only': 'Draft only',
    solverCandidates: 'Solver and adapter coverage', reviewHandoff: 'Open the user-signed review',
    draftOnly: 'This outcome is saved as a local draft. FBT will not pretend an unavailable privacy, outcome or atomic-workflow adapter is live.'
  },
  solverStatus: {
    eligible: 'Eligible', ineligible: 'Not a match', unavailable: 'Not connected', partial: 'Partial', 'manual-signature': 'Manual sign'
  },
  solver: {
    'fbt-evm-aggregator': { title: 'DEX route solver', body: 'Parallel live routes with same-fee, same-slippage comparison.' },
    'fbt-order-watcher': { title: 'Local rule watcher', body: 'Watches price or time and asks you to sign; it never holds a key.' },
    'fbt-cross-chain-adapter': { title: 'Cross-chain adapter', body: 'Prepares a separately signed bridge route; not one atomic workflow.' },
    'external-outcome-market': { title: 'Open outcome marketplace', body: 'CEX, OTC, inventory and composite solver bids need bonded settlement.' },
    'confidential-intent-transport': { title: 'Confidential intent transport', body: 'Threshold encryption or confidential compute is required before this can be called private.' }
  },
  check: {
    SELF_CUSTODY: { title: 'Self-custody preserved', body: 'FBT receives no seed phrase and holds no user balance.' },
    USER_SIGNATURE_REQUIRED: { title: 'Final signature stays with you', body: 'No plan can bypass the wallet confirmation.' },
    PROOF_REQUESTED: { title: 'Execution receipt policy', body: 'A content-addressed receipt is requested after confirmed settlement.' },
    SLIPPAGE_ABOVE_MEMORY: { title: 'Slippage exceeds your memory rule', body: '{{requested}}% requested; your maximum is {{maximum}}%.' },
    SLIPPAGE_WITHIN_MEMORY: { title: 'Slippage is inside your rule', body: 'Your stored maximum is {{maximum}}%.' },
    USD_VALUE_UNKNOWN: { title: 'USD value is not verified', body: 'The spend and privacy thresholds cannot be evaluated from a ticker alone.' },
    OVER_SPEND_LIMIT: { title: 'Spend cap blocks this intent', body: '${{amountUsd}} is above your ${{maximum}} per-intent limit.' },
    SPEND_WITHIN_LIMIT: { title: 'Spend is inside your limit', body: 'Estimated value: ${{amountUsd}}.' },
    QUIET_HOURS: { title: 'Quiet-hours rule is active', body: 'Your memory says not to prepare executions at this local time.' },
    OUTSIDE_QUIET_HOURS: { title: 'Outside quiet hours', body: 'The local time rule permits review.' },
    CONFIDENTIAL_TRANSPORT_UNAVAILABLE: { title: 'Confidential transport is unavailable', body: 'No threshold-encrypted or confidential-compute solver channel is connected.' },
    PRIVATE_RELAY_NOT_ATTESTED: { title: 'Private relay cannot be attested', body: 'Ethereum has protect RPCs, but an external wallet chooses the broadcaster and returns no transport proof.' },
    PRIVATE_RELAY_UNAVAILABLE: { title: 'No verified private relay on this network', body: 'FBT will not label a normal broadcast as private.' },
    STANDARD_BROADCAST_DISCLOSED: { title: 'Public-transport risk disclosed', body: 'The transaction may be visible to validators and routing services.' },
    OUTCOME_SOLVER_NETWORK_UNAVAILABLE: { title: 'Outcome market is not live yet', body: 'No bonded CEX, OTC or inventory solver network is connected.' },
    WORKFLOW_NOT_ATOMIC: { title: 'Workflow is not atomic', body: '{{steps}} steps can be modelled, but today they require separate reviews and signatures.' },
    AUTOMATION_REQUIRES_FINAL_SIGNATURE: { title: 'Automation stops before spending', body: 'The watcher can notify and prefill; it cannot sign or spend for you.' }
  },
  error: {
    BAD_KIND: 'Choose a supported intent type.', BAD_CHAIN: 'Choose a supported starting network.', BAD_TOKENS: 'Enter both token symbols.',
    SAME_TOKEN: 'Input and output tokens must differ.', BAD_AMOUNT: 'Enter an amount greater than zero.', BAD_OUTCOME: 'An outcome request needs a positive minimum receive amount.', BAD_CONDITION: 'Choose a valid trigger and target.', BAD_WORKFLOW: 'A workflow needs two to eight valid actions.'
  },
  saved: { title: 'Recent local drafts', local: 'On this device', remove: 'Remove draft' },
  memory: {
    title: 'Memory Wallet', subtitle: 'Explicit preferences become enforceable local rules. FBT does not silently learn permission to spend.',
    preferredChain: 'Preferred network', maxSlippage: 'Maximum slippage (%)', privateAbove: 'Require private handling above (USD)',
    maxSpend: 'Maximum per intent (USD)', quietHours: 'Quiet hours', quietBody: 'Block plan hand-off between two local hours.',
    from: 'From hour', to: 'Until hour', requireProof: 'Require execution receipt', requireProofBody: 'Ask the execution path to save its route decision evidence.',
    save: 'Save memory rules', localNotice: 'These rules are stored on this device. They are policy for this app, not an on-chain account-abstraction contract and not permission for AI to move funds.'
  },
  proof: {
    title: 'Proof-of-Execution receipts', subtitle: 'Constraints, observed solver responses, route selection and confirmed transaction in one canonical document.',
    confirmed: 'Confirmed', scope: 'Best executable response among usable responses observed in that quote round — not a claim of global optimality.',
    verify: 'Recompute digest', download: 'Download JSON', empty: 'No receipts yet',
    emptyBody: 'A receipt is created after a supported EVM swap confirms on-chain.', openSwap: 'Open swap',
    limit: 'The SHA-256 digest is a reproducible content fingerprint, not an FBT signature or a zero-knowledge proof. Protocol authenticity requires signed solver commitments and an external anchor.',
    DIGEST_MATCH: 'Digest matches the canonical receipt', DIGEST_MISMATCH: 'Receipt content does not match its digest', BAD_PROOF: 'This is not a valid FBT receipt', CRYPTO_UNAVAILABLE: 'Secure hashing is unavailable in this browser'
  },
  network: {
    title: 'DEX-to-DEX execution network', subtitle: 'A versioned discovery surface lets wallets, DEXs and market makers integrate as solver roles instead of hidden liquidity sources.',
    live: 'Live', roadmap: 'Roadmap', aiTitle: 'AI proposes. Policy authorises.',
    aiBody: 'Models may explain or propose a structured intent. Deterministic limits, simulation, wallet signatures and smart contracts control every real execution.',
    safetyNotice: 'Public bid submission remains closed until solver authentication, replay protection, quote commitments, bonding and dispute rules exist. Opening it earlier would add attack surface, not decentralisation.'
  }
};

const fa = {
  eyebrow: 'مرکز کنترل نیت مالی',
  title: 'نتیجه را تعریف کن؛ کنترل را نگه دار.',
  subtitle: 'FBT هدف مالی شفاف را به کنترل ریسک، رقابت Solverها، اجرای امضاشده توسط خودت و رسید قابل‌بررسی تبدیل می‌کند؛ بدون اینکه AI اختیار آزاد پول را بگیرد.',
  badge: { nonCustodial: 'غیرامانی', policyBound: 'مقید به قانون', verifiable: 'رسید قابل‌بررسی' },
  pipelineTitle: 'خط اجرای Intent',
  stage: { intent: 'نیت', risk: 'ریسک', solvers: 'Solver', simulation: 'شبیه‌سازی', execution: 'اجرا', verification: 'اثبات' },
  tab: { compose: 'ساخت', memory: 'حافظه', proofs: 'اثبات‌ها', network: 'شبکه' },
  compose: { choose: 'نتیجه را انتخاب کن', structured: 'اعداد مالی قطعی می‌مانند', localOnly: 'پیش‌نویس محلی', compile: 'عبور از موتور ریسک' },
  template: {
    swap: { title: 'سواپ با بهترین مسیر', body: 'مقایسه مسیرهای قابل‌اجرا با کارمزد و اسلیپیج یکسان.' },
    outcome: { title: 'درخواست نتیجه', body: 'حداقل دریافتی و مهلت را برای رقابت Solverها تعیین کن.' },
    automation: { title: 'نیت قانون‌محور', body: 'شرط را پایش کن؛ سپس بازبینی و امضای تو لازم است.' },
    workflow: { title: 'گردش‌کار ترکیبی', body: 'سواپ، پل، سپرده، وام و ارسال را در یک طرح مدل کن.' }
  },
  field: {
    pay: 'دارایی ورودی', receive: 'نتیجه دلخواه', fromToken: 'توکن ورودی', toToken: 'توکن خروجی', bestAvailable: 'بهترین مقدار موجود',
    chain: 'شبکه شروع', deadline: 'مهلت', hours: '{{n}} ساعت', usdValue: 'تخمین دلاری اعلامی', usdValueHint: 'فقط برای زمینه؛ موتور Policy آن را فقط برای ورودی استیبل‌کوین معتبر می‌داند.', slippage: 'حداکثر اسلیپیج (٪)',
    privacy: 'نیاز حریم خصوصی', condition: 'قانون فعال‌سازی', targetPrice: 'قیمت هدف {{symbol}}', scheduleSignature: 'برنامه فقط صفحه بازبینی را آماده می‌کند و در پس‌زمینه امضا نمی‌کند.', workflowAction: 'عمل {{n}}', workflowTarget: 'دارایی، شبکه یا مقصد', addStep: 'افزودن مرحله', removeStep: 'حذف مرحله', note: 'یادداشت Intent (اختیاری)', notePlaceholder: 'نتیجه‌ای را که می‌خواهی با زبان خودت توضیح بده…',
    noteSafety: 'یادداشت فقط برای زمینه است؛ اجرای واقعی از فیلدهای ساختاریافته بالا ساخته می‌شود.'
  },
  condition: { priceBelow: 'قیمت پایین‌تر برود', priceAbove: 'قیمت بالاتر برود', daily: 'هر روز', weekly: 'هر هفته', monthly: 'هر ماه' },
  privacy: {
    standard: { title: 'عادی', body: 'ارسال معمول کیف پول؛ توکن، مبلغ و راهبرد ممکن است پیش از تسویه یا حین آن عمومی شود.' },
    relay: { title: 'رله خصوصی', body: 'ممپول خصوصی دیده‌شدن عمومی را کم می‌کند؛ اما این اپ نمی‌تواند RPC انتخابی کیف بیرونی را اثبات کند.' },
    confidential: { title: 'محرمانه', body: 'به commit-reveal، محیط امن یا رمزنگاری آستانه‌ای نیاز دارد. هنوز چنین انتقالی وصل نیست.' }
  },
  action: { swap: 'سواپ', bridge: 'پل', deposit: 'سپرده', borrow: 'وام', send: 'ارسال' },
  result: {
    title: 'طرح اجرای کامپایل‌شده', 'ready-for-review': 'آماده بازبینی', 'draft-only': 'فقط پیش‌نویس', solverCandidates: 'پوشش Solver و Adapter',
    reviewHandoff: 'باز کردن بازبینی و امضای کاربر', draftOnly: 'این نتیجه به‌صورت پیش‌نویس محلی ذخیره شد. FBT قابلیت محرمانه، بازار نتیجه یا اجرای اتمیکِ متصل‌نشده را زنده جا نمی‌زند.'
  },
  solverStatus: { eligible: 'مجاز', ineligible: 'نامرتبط', unavailable: 'وصل نیست', partial: 'ناقص', 'manual-signature': 'امضای دستی' },
  solver: {
    'fbt-evm-aggregator': { title: 'Solver مسیر DEX', body: 'مسیرهای زنده موازی با کارمزد و اسلیپیج یکسان.' },
    'fbt-order-watcher': { title: 'پایشگر قانون محلی', body: 'قیمت یا زمان را می‌پاید و از تو امضا می‌خواهد؛ کلید نگه نمی‌دارد.' },
    'fbt-cross-chain-adapter': { title: 'Adapter میان‌زنجیره‌ای', body: 'مسیر پل با امضای جدا آماده می‌کند؛ هنوز گردش‌کار اتمیک نیست.' },
    'external-outcome-market': { title: 'بازار باز نتیجه', body: 'پیشنهاد CEX، OTC، موجودی و Solver ترکیبی به تسویه وثیقه‌دار نیاز دارد.' },
    'confidential-intent-transport': { title: 'انتقال Intent محرمانه', body: 'پیش از نام‌گذاری «خصوصی»، رمزنگاری آستانه‌ای یا رایانش محرمانه لازم است.' }
  },
  check: {
    SELF_CUSTODY: { title: 'خودامانی حفظ می‌شود', body: 'FBT عبارت بازیابی یا موجودی کاربر را دریافت نمی‌کند.' },
    USER_SIGNATURE_REQUIRED: { title: 'امضای نهایی دست توست', body: 'هیچ طرحی تأیید کیف پول را دور نمی‌زند.' },
    PROOF_REQUESTED: { title: 'قانون رسید اجرا', body: 'بعد از تسویه تأییدشده، رسید محتوامحور درخواست می‌شود.' },
    SLIPPAGE_ABOVE_MEMORY: { title: 'اسلیپیج بالاتر از قانون حافظه', body: '{{requested}}٪ درخواست شده؛ سقف تو {{maximum}}٪ است.' },
    SLIPPAGE_WITHIN_MEMORY: { title: 'اسلیپیج داخل سقف است', body: 'سقف ذخیره‌شده تو {{maximum}}٪ است.' },
    USD_VALUE_UNKNOWN: { title: 'ارزش دلاری تأیید نشده', body: 'فقط از روی نماد توکن نمی‌توان سقف خرج و حریم خصوصی را سنجید.' },
    OVER_SPEND_LIMIT: { title: 'سقف خرج این Intent را مسدود کرد', body: '${{amountUsd}} از سقف ${{maximum}} بیشتر است.' },
    SPEND_WITHIN_LIMIT: { title: 'خرج داخل سقف توست', body: 'ارزش تخمینی: ${{amountUsd}}.' },
    QUIET_HOURS: { title: 'ساعت سکوت فعال است', body: 'حافظه تو در این ساعت محلی آماده‌سازی اجرا را ممنوع کرده.' },
    OUTSIDE_QUIET_HOURS: { title: 'بیرون از ساعت سکوت', body: 'قانون زمان محلی اجازه بازبینی می‌دهد.' },
    CONFIDENTIAL_TRANSPORT_UNAVAILABLE: { title: 'انتقال محرمانه موجود نیست', body: 'کانال رمزنگاری آستانه‌ای یا رایانش محرمانه‌ای وصل نشده.' },
    PRIVATE_RELAY_NOT_ATTESTED: { title: 'رله خصوصی قابل اثبات نیست', body: 'اتریوم RPC محافظ دارد، اما کیف بیرونی فرستنده را انتخاب می‌کند و مدرک انتقال نمی‌دهد.' },
    PRIVATE_RELAY_UNAVAILABLE: { title: 'رله خصوصی تأییدشده نیست', body: 'FBT ارسال عادی را خصوصی نام‌گذاری نمی‌کند.' },
    STANDARD_BROADCAST_DISCLOSED: { title: 'ریسک انتشار عمومی اعلام شد', body: 'تراکنش ممکن است برای اعتبارسنج‌ها و سرویس‌های مسیریابی دیده شود.' },
    OUTCOME_SOLVER_NETWORK_UNAVAILABLE: { title: 'بازار نتیجه هنوز زنده نیست', body: 'شبکه Solver وثیقه‌دار CEX، OTC یا موجودی متصل نشده.' },
    WORKFLOW_NOT_ATOMIC: { title: 'گردش‌کار اتمیک نیست', body: '{{steps}} مرحله قابل مدل‌سازی است، اما امروز امضاهای جدا لازم دارد.' },
    AUTOMATION_REQUIRES_FINAL_SIGNATURE: { title: 'اتوماسیون پیش از خرج متوقف می‌شود', body: 'پایشگر اعلان و پیش‌پرکردن انجام می‌دهد؛ امضا یا خرج نمی‌کند.' }
  },
  error: { BAD_KIND: 'نوع Intent معتبر انتخاب کن.', BAD_CHAIN: 'شبکه شروع پشتیبانی‌شده انتخاب کن.', BAD_TOKENS: 'نماد هر دو توکن را وارد کن.', SAME_TOKEN: 'توکن ورودی و خروجی باید متفاوت باشند.', BAD_AMOUNT: 'مبلغی بزرگ‌تر از صفر وارد کن.', BAD_OUTCOME: 'برای درخواست نتیجه، حداقل دریافتی مثبت وارد کن.', BAD_CONDITION: 'شرط و قیمت هدف معتبر انتخاب کن.', BAD_WORKFLOW: 'گردش‌کار به ۲ تا ۸ عمل معتبر نیاز دارد.' },
  saved: { title: 'پیش‌نویس‌های محلی اخیر', local: 'روی همین دستگاه', remove: 'حذف پیش‌نویس' },
  memory: {
    title: 'Memory Wallet', subtitle: 'ترجیحات صریح به قانون محلی قابل‌اجرا تبدیل می‌شوند؛ FBT بی‌صدا اجازه خرج‌کردن یاد نمی‌گیرد.',
    preferredChain: 'شبکه ترجیحی', maxSlippage: 'حداکثر اسلیپیج (٪)', privateAbove: 'الزام حریم خصوصی بالاتر از (دلار)', maxSpend: 'سقف هر Intent (دلار)',
    quietHours: 'ساعت سکوت', quietBody: 'تحویل طرح را بین دو ساعت محلی مسدود کن.', from: 'از ساعت', to: 'تا ساعت',
    requireProof: 'الزام رسید اجرا', requireProofBody: 'از مسیر اجرا بخواه شواهد تصمیم مسیریابی را ذخیره کند.', save: 'ذخیره قوانین حافظه',
    localNotice: 'این قوانین روی همین دستگاه ذخیره می‌شوند. این‌ها قانون همین اپ هستند، نه قرارداد Account Abstraction روی زنجیره و نه اجازه AI برای جابه‌جایی پول.'
  },
  proof: {
    title: 'رسیدهای Proof-of-Execution', subtitle: 'محدودیت‌ها، پاسخ Solverهای دیده‌شده، انتخاب مسیر و تراکنش تأییدشده در یک سند استاندارد.',
    confirmed: 'تأییدشده', scope: 'بهترین پاسخ قابل‌اجرا میان پاسخ‌های قابل‌استفاده همان دور Quote؛ نه ادعای بهینگی جهانی.',
    verify: 'محاسبه دوباره هش', download: 'دانلود JSON', empty: 'هنوز رسیدی نیست', emptyBody: 'بعد از تأیید یک سواپ EVM پشتیبانی‌شده، رسید ساخته می‌شود.',
    openSwap: 'باز کردن سواپ', limit: 'هش SHA-256 اثرانگشت قابل‌بازتولید محتواست؛ نه امضای FBT و نه اثبات دانش صفر. اصالت پروتکل به تعهد امضاشده Solver و لنگر خارجی نیاز دارد.',
    DIGEST_MATCH: 'هش با سند استاندارد یکسان است', DIGEST_MISMATCH: 'محتوای رسید با هش آن یکسان نیست', BAD_PROOF: 'این رسید معتبر FBT نیست', CRYPTO_UNAVAILABLE: 'هش امن در این مرورگر در دسترس نیست'
  },
  network: {
    title: 'شبکه اجرای DEX-to-DEX', subtitle: 'سطح کشف نسخه‌دار به کیف‌ها، DEXها و Market Makerها اجازه می‌دهد به‌عنوان Solver متصل شوند، نه منبع نقدینگی پنهان.',
    live: 'زنده', roadmap: 'نقشه راه', aiTitle: 'AI پیشنهاد می‌دهد؛ Policy اجازه می‌دهد.',
    aiBody: 'مدل می‌تواند Intent ساختاریافته را توضیح دهد یا پیشنهاد کند. محدودیت قطعی، شبیه‌سازی، امضای کیف و قرارداد هوشمند اجرای واقعی را کنترل می‌کنند.',
    safetyNotice: 'ارسال عمومی Bid تا زمان احراز Solver، جلوگیری از Replay، تعهد Quote، وثیقه و قانون اختلاف بسته می‌ماند. بازکردن زودتر، سطح حمله اضافه می‌کند نه تمرکززدایی.'
  }
};

const navNames = {
  en: 'Intent OS', fa: 'سیستم Intent', ar: 'نظام النوايا', zh: '意图系统', hi: 'इंटेंट OS', es: 'Sistema de intents',
  fr: 'Système d’intentions', ru: 'ОС намерений', tr: 'Niyet sistemi', ur: 'ارادہ نظام', id: 'Sistem intent', pt: 'Sistema de intents'
};

for (const file of fs.readdirSync(base).filter((name) => name.endsWith('.json'))) {
  const code = file.replace('.json', '');
  const full = path.join(base, file);
  const data = JSON.parse(fs.readFileSync(full, 'utf8'));
  data.nav ||= {};
  data.nav.intentOS = navNames[code] || 'Intent OS';
  if (code === 'en') data.intentOS = en;
  if (code === 'fa') data.intentOS = fa;
  fs.writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`);
}
