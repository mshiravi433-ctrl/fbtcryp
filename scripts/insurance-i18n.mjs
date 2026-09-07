#!/usr/bin/env node
/**
 * Injects/refreshes the `insurance` i18n namespace into every locale file.
 * Run: node scripts/insurance-i18n.mjs
 * Keeps a deterministic key order so diffs stay reviewable.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const en = {
  tabs: { dashboard: 'Dashboard', marketplace: 'Marketplace', coverage: 'Coverage', claims: 'Claims', risk: 'Risk', providers: 'Providers', ariaLabel: 'Insurance sections' },
  common: { confirm: 'Confirm', cancel: 'Cancel', close: 'Close', done: 'Done' },
  shell: {
    brand: 'FBT Protection', walletStatus: 'Wallet / server status', apiOffline: 'API offline', notConnected: 'Not connected',
    alerts: 'Alerts', connectTitle: 'Connect your wallet', connectBody: 'Quotes run against a real address and purchases are signed by you. FBT never sees your key.',
    browserWallet: 'Browser wallet', walletConnect: 'WalletConnect', inAppWallet: 'In-app wallet', manualAddress: 'Use address manually',
    disconnect: 'Disconnect', notConnectedYet: 'Not connected yet', invalidAddress: 'Enter a valid 0x EVM address, or connect a wallet.',
    injectedConnected: 'Injected wallet connected', wcConnected: 'WalletConnect connected', connectFailed: 'Wallet connect failed',
    useInAppWallet: 'Unlock your in-app wallet from the Wallet tab, then return here.', wallet: 'Wallet', connectedAs: 'Connected',
    disconnected: 'Wallet disconnected', chooseSigning: 'Choose how you sign. In every mode your private key stays with you.',
    metamask: 'MetaMask / browser wallet', wcQr: 'WalletConnect (QR / Telegram)', orEnterAddress: 'Or enter an address (view-only):',
    useAddress: 'Use address', noAlerts: 'No alerts.', server: 'Server', checking: 'checking…', serverOnline: 'connected · API online', serverOffline: 'offline'
  },
  alerts: {
    serverDownTitle: 'Server unreachable', serverDownBody: 'Could not reach /api/insurance. Live quotes are unavailable.',
    noProviderTitle: 'Provider temporarily unavailable', noProviderBody: 'No verified live protection provider is configured right now, so no new quotes or purchases are possible. Existing coverage stays visible.',
    sandboxTitle: 'Sandbox environment', sandboxBody: 'Sandbox providers are simulations for testing. Nothing here is a live underwriting offer and FBT never custodies funds.',
    healthTitle: '{{name}} health: {{status}}', healthBody: 'Not recommended for new purchases while degraded.',
    noWalletTitle: 'No wallet', noWalletBody: 'Connect a wallet to quote against a real address and to sign.'
  },
  market: {
    title: 'Protection Marketplace',
    subtitle: 'Compare protection across verified providers. Every fee is shown before signing, your wallet signs every purchase, and FBT never custodies funds.',
    sandboxOnlyNote: 'This environment runs sandbox (simulation) providers for testing — nothing here is a live underwriting offer.',
    protectionType: 'Protection type', chain: 'Chain', coverageAmount: 'Coverage amount (USD)', duration: 'Duration (days)',
    termsAccept: 'I have reviewed the provider terms, the annex and the jurisdiction notice, and accept them.',
    gettingQuotes: 'Getting quotes…', getQuotes: 'Get Protection Quotes', needWallet: 'Set a wallet address first.',
    noEligible: 'Provider temporarily unavailable — no eligible protection is currently available. Live quote not available; no purchase possible.',
    liveQuoteUnavailable: 'Live quote not available right now. No purchase is possible until a provider responds.',
    compare: 'Compare providers ({{count}})', health: 'Health', coverage: 'Coverage', settlement: 'Settlement',
    nonCustodial: 'non-custodial', claimMethod: 'Claim method', termsHash: 'Terms hash', reviewBuy: 'Review & Buy',
    howItWorks: 'How it works, fees & claims'
  },
  info: {
    walletTitle: 'Your wallet, your keys', walletBody: 'You connect with your own wallet. FBT never receives a private key or seed phrase, never holds premiums, and never signs for you.',
    flowTitle: 'How a purchase works',
    flow1: 'Real products are discovered from the provider API.', flow2: 'You request a live quote.',
    flow3: 'Providers are compared on price, health, capacity and terms.', flow4: 'You review the real terms and fees.',
    flow5: 'You confirm.', flow6: 'Your wallet signs the unsigned transaction.',
    flow7: 'The blockchain receipt is independently verified.', flow8: 'Coverage activates only after verification.',
    riskTitle: 'Risk criteria', riskIntro: 'Risk is calculated from these inputs — never from guesswork:',
    risk1: 'Protocol risk', risk2: 'Smart contract risk', risk3: 'Chain risk', risk4: 'Oracle dependency',
    risk5: 'Bridge dependency', risk6: 'Asset risk', risk7: 'Liquidity', risk8: 'Concentration',
    risk9: 'Provider health', risk10: 'Provider capacity', risk11: 'Historical incidents', risk12: 'Coverage exclusions',
    feesTitle: 'Fees, fully itemised', claimsTitle: 'Claims, honestly handled',
    claim1: 'A claim is never auto-approved.', claim2: 'Real evidence is required.',
    claim3: 'Transaction hashes and blocks are checked.', claim4: 'The provider’s real terms are the basis.',
    claim5: 'Payouts are recorded only after independent on-chain verification.'
  },
  fee: {
    providerPremium: 'Provider premium', fbtFee: 'FBT Marketplace Fee', fbtFeeShort: 'FBT fee', networkFee: 'Network fee (est.)',
    commission: 'Provider commission', total: 'Total user cost', zero: 'FBT Marketplace Fee: $0'
  },
  source: { label: 'Source', providerApi: 'Provider API', updated: 'Updated', freshness: 'Freshness', live: 'Live', cached: 'Cached', stale: 'STALE DATA — REFRESH REQUIRED', unknown: 'Unknown' },
  quote: {
    confirmTitle: 'Confirm purchase?',
    confirmBody: 'You are preparing ${{coverage}} of protection for ${{total}} total (all fees included). Nothing is charged until you sign.',
    confirmPrepare: 'Confirm & Prepare', preparedToast: 'Purchase prepared (unsigned). Review and sign to activate.',
    prepareFailed: 'Prepare failed', unavailable: 'Quote unavailable: {{error}}', backToMarket: 'Back to marketplace',
    loading: 'Loading quote…', title: 'Checkout',
    subtitle: 'Review coverage, every fee, terms and exclusions before signing. The premium goes directly to the provider — FBT is a non-custodial interface.',
    protection: 'Protection', days: '{{count}} days', provider: 'Provider', currency: 'Currency',
    feeNote: 'The FBT marketplace fee is $0 until a real fee agreement exists — and it is always shown before you sign. No hidden fees.',
    coverageBox: 'What this covers',
    coverageExplain: 'This certificate protects against the listed {{type}} exploit risk for the covered wallet/asset and chain, per the provider’s real terms. It does not cover ordinary market loss or excluded events. Maximum eligible payout: ${{max}}.',
    exclusions: 'Exclusions', termsLink: 'Terms & wording', annexLink: 'Annex',
    walletConnected: 'Wallet connected on {{chain}}.', walletNotConnected: 'Wallet NOT connected — connect a wallet to sign for real.',
    preparedTitle: 'Prepared (unsigned).', preparedBody: 'Non-custodial hand-off: the premium moves from your wallet directly to the provider contract. FBT never holds funds.',
    coverageId: 'Coverage ID', contract: 'Provider contract', mode: 'Mode', unsigned: 'unsigned',
    liveSignNote: 'Your wallet will sign the real provider transaction (approval if needed, then the purchase). The server verifies the on-chain receipt before activating coverage.',
    signLive: 'Sign with wallet & broadcast', sendTo: 'Send to', sandboxNote: 'Sandbox: simulated premium transfer prepared for wallet signature (dev/test only).',
    signSandbox: 'Sign & verify (sandbox)', signing: 'Signing / verifying…', connectToSign: 'Connect a wallet first — purchases always need your signature.',
    signTitle: 'Sign with your wallet', signBodyLive: 'Your wallet will now sign the provider purchase transaction. Check the contract and amount in your wallet before confirming.',
    openWallet: 'Open wallet to sign',
    sandboxSignTitle: 'Sandbox signature', sandboxSignBody: 'This is a simulated sandbox signature for testing (dev only). Nothing is purchased on-chain.', sandboxSignGo: 'Simulate anyway',
    activatedToast: 'Coverage activated', activationFailed: 'Activation failed',
    doneTitle: 'Coverage activated.', signedBy: 'Signed by', txHash: 'Transaction hash', viewCoverage: 'View coverage'
  },
  types: { 'smart-contract': 'Smart contract', bridge: 'Bridge', stablecoin: 'Stablecoin / depeg', lending: 'Lending', lp: 'LP position', wallet: 'Wallet / custody', oracle: 'Oracle', 'defi-protocol': 'DeFi protocol' },
  claims: { created: 'Claim {{number}} created ({{status}}). Now submit it.', createdToast: 'Claim {{number}} created' },
  providerUnavailable: 'Provider temporarily unavailable', unknown: 'Unknown'
};

const overrides = {
  fa: {
    tabs: { dashboard: 'داشبورد', marketplace: 'بازار', coverage: 'پوشش‌ها', claims: 'درخواست‌ها', risk: 'ریسک', providers: 'ارائه‌دهندگان', ariaLabel: 'بخش‌های بیمه' },
    common: { confirm: 'تأیید', cancel: 'لغو', close: 'بستن', done: 'تمام' },
    shell: {
      brand: 'محافظت FBT', walletStatus: 'وضعیت کیف پول / سرور', apiOffline: 'API آفلاین', notConnected: 'متصل نیست',
      alerts: 'هشدارها', connectTitle: 'کیف پول خود را متصل کنید', connectBody: 'استعلام‌ها با آدرس واقعی انجام می‌شود و خرید را خودتان امضا می‌کنید. FBT هرگز کلید شما را نمی‌بیند.',
      browserWallet: 'کیف پول مرورگر', walletConnect: 'WalletConnect', inAppWallet: 'کیف پول داخلی', manualAddress: 'ورود دستی آدرس',
      disconnect: 'قطع اتصال', notConnectedYet: 'هنوز متصل نشده', invalidAddress: 'یک آدرس 0x معتبر وارد کنید یا کیف پول متصل کنید.',
      injectedConnected: 'کیف پول مرورگر متصل شد', wcConnected: 'WalletConnect متصل شد', connectFailed: 'اتصال کیف پول ناموفق بود',
      useInAppWallet: 'کیف پول داخلی را از تب کیف پول باز کنید و به اینجا برگردید.', wallet: 'کیف پول', connectedAs: 'متصل',
      disconnected: 'کیف پول قطع شد', chooseSigning: 'روش امضا را انتخاب کنید. در همه حالت‌ها کلید خصوصی نزد خود شما می‌ماند.',
      metamask: 'MetaMask / کیف پول مرورگر', wcQr: 'WalletConnect (QR / تلگرام)', orEnterAddress: 'یا آدرس وارد کنید (فقط مشاهده):',
      useAddress: 'استفاده از آدرس', noAlerts: 'هشداری نیست.', server: 'سرور', checking: 'در حال بررسی…', serverOnline: 'متصل · آنلاین', serverOffline: 'آفلاین'
    },
    alerts: {
      serverDownTitle: 'سرور در دسترس نیست', serverDownBody: 'دسترسی به /api/insurance ممکن نیست. استعلام زنده در دسترس نیست.',
      noProviderTitle: 'ارائه‌دهنده موقتاً در دسترس نیست', noProviderBody: 'در حال حاضر هیچ ارائه‌دهنده واقعی تأییدشده‌ای پیکربندی نشده است؛ بنابراین استعلام و خرید جدید ممکن نیست. پوشش‌های موجود همچنان نمایش داده می‌شوند.',
      sandboxTitle: 'محیط آزمایشی', sandboxBody: 'ارائه‌دهنده‌های Sandbox شبیه‌سازی هستند و فقط برای تست‌اند. هیچ پیشنهاد واقعی بیمه‌ای اینجا وجود ندارد و FBT هرگز نگهدارنده وجوه نیست.',
      healthTitle: 'وضعیت {{name}}: {{status}}', healthBody: 'تا زمان بهبود وضعیت، برای خرید جدید توصیه نمی‌شود.',
      noWalletTitle: 'بدون کیف پول', noWalletBody: 'برای استعلام با آدرس واقعی و امضا، کیف پول را متصل کنید.'
    },
    market: {
      title: 'بازار محافظت', subtitle: 'مقایسه محافظت میان ارائه‌دهندگان تأییدشده. همه کارمزدها قبل از امضا نمایش داده می‌شوند، هر خرید را کیف پول خودتان امضا می‌کند و FBT هرگز نگهدارنده وجوه نیست.',
      sandboxOnlyNote: 'این محیط فقط ارائه‌دهنده Sandbox (شبیه‌سازی) برای تست دارد — هیچ پیشنهاد بیمه واقعی اینجا وجود ندارد.',
      protectionType: 'نوع محافظت', chain: 'زنجیره', coverageAmount: 'مبلغ پوشش (دلار)', duration: 'مدت (روز)',
      termsAccept: 'شرایط ارائه‌دهنده، الحاقیه و اعلان صلاحیت قضایی را مرور کرده و می‌پذیرم.',
      gettingQuotes: 'دریافت استعلام‌ها…', getQuotes: 'دریافت استعلام محافظت', needWallet: 'ابتدا آدرس کیف پول را تنظیم کنید.',
      noEligible: 'ارائه‌دهنده موقتاً در دسترس نیست — در حال حاضر هیچ محافظت واجد شرایطی موجود نیست. استعلام زنده در دسترس نیست؛ خرید ممکن نیست.',
      liveQuoteUnavailable: 'استعلام زنده در حال حاضر در دسترس نیست. تا پاسخ ارائه‌دهنده، خرید ممکن نیست.',
      compare: 'مقایسه ارائه‌دهندگان ({{count}})', health: 'سلامت', coverage: 'پوشش', settlement: 'تسویه',
      nonCustodial: 'بدون امانت‌داری', claimMethod: 'روش مطالبه', termsHash: 'هش شرایط', reviewBuy: 'بررسی و خرید',
      howItWorks: 'نحوه کار، کارمزدها و مطالبات'
    },
    info: {
      walletTitle: 'کیف پول شما، کلیدهای شما', walletBody: 'کاربر با کیف پول خودش متصل می‌شود. FBT هیچ کلید خصوصی یا عبارت بازیابی دریافت نمی‌کند، حق بیمه را نگه نمی‌دارد و برای شما امضا نمی‌کند.',
      flowTitle: 'مراحل خرید',
      flow1: 'محصولات واقعی از API ارائه‌دهنده کشف می‌شوند.', flow2: 'استعلام زنده دریافت می‌کنید.',
      flow3: 'ارائه‌دهندگان بر اساس قیمت، سلامت، ظرفیت و شرایط مقایسه می‌شوند.', flow4: 'شرایط و کارمزدهای واقعی را مرور می‌کنید.',
      flow5: 'تأیید می‌کنید.', flow6: 'کیف پول شما تراکنشِ آماده‌شده را امضا می‌کند.',
      flow7: 'رسید تراکنش به‌صورت مستقل از بلاک‌چین بررسی می‌شود.', flow8: 'پوشش فقط بعد از تأیید فعال می‌شود.',
      riskTitle: 'معیارهای ریسک', riskIntro: 'ریسک بر اساس این ورودی‌ها محاسبه می‌شود — هرگز حدسی نیست:',
      risk1: 'ریسک پروتکل', risk2: 'ریسک قرارداد هوشمند', risk3: 'ریسک زنجیره', risk4: 'وابستگی به اوراکل',
      risk5: 'وابستگی به پل', risk6: 'ریسک دارایی', risk7: 'نقدشوندگی', risk8: 'تمرکز',
      risk9: 'سلامت ارائه‌دهنده', risk10: 'ظرفیت ارائه‌دهنده', risk11: 'حوادث تاریخی', risk12: 'استثناهای پوشش',
      feesTitle: 'کارمزدها، کامل و شفاف', claimsTitle: 'مطالبات، صادقانه',
      claim1: 'هیچ مطالبه‌ای خودکار تأیید نمی‌شود.', claim2: 'مدارک واقعی لازم است.',
      claim3: 'هش تراکنش و بلاک بررسی می‌شود.', claim4: 'شرایط واقعی ارائه‌دهنده ملاک است.',
      claim5: 'پرداخت فقط پس از تأیید مستقل بلاک‌چینی ثبت می‌شود.'
    },
    fee: { providerPremium: 'حق بیمه ارائه‌دهنده', fbtFee: 'کارمزد بازار FBT', fbtFeeShort: 'کارمزد FBT', networkFee: 'کارمزد شبکه (تخمینی)', commission: 'کمیسیون ارائه‌دهنده', total: 'هزینه کل کاربر', zero: 'کارمزد بازار FBT: ۰ دلار' },
    source: { label: 'منبع', providerApi: 'API ارائه‌دهنده', updated: 'به‌روزرسانی', freshness: 'تازگی', live: 'زنده', cached: 'کش‌شده', stale: 'داده منقضی — نوسازی لازم است', unknown: 'نامشخص' },
    quote: {
      confirmTitle: 'خرید تأیید شود؟', confirmBody: 'در حال آماده‌سازی ${{coverage}} محافظت با هزینه کل ${{total}} (شامل همه کارمزدها) هستید. تا امضای شما چیزی کسر نمی‌شود.',
      confirmPrepare: 'تأیید و آماده‌سازی', preparedToast: 'خرید آماده شد (بدون امضا). مرور کرده و برای فعال‌سازی امضا کنید.',
      prepareFailed: 'آماده‌سازی ناموفق', unavailable: 'استعلام در دسترس نیست: {{error}}', backToMarket: 'بازگشت به بازار',
      loading: 'در حال بارگذاری استعلام…', title: 'پرداخت',
      subtitle: 'قبل از امضا، پوشش، همه کارمزدها، شرایط و استثناها را مرور کنید. حق بیمه مستقیماً به ارائه‌دهنده می‌رود — FBT یک رابط بدون امانت‌داری است.',
      protection: 'محافظت', days: '{{count}} روز', provider: 'ارائه‌دهنده', currency: 'ارز',
      feeNote: 'کارمزد بازار FBT تا وجود قرارداد کارمزد واقعی، ۰ دلار است — و همیشه قبل از امضا نمایش داده می‌شود. هیچ هزینه پنهانی وجود ندارد.',
      coverageBox: 'این پوشش چه چیزی را شامل می‌شود',
      coverageExplain: 'این گواهی بر اساس شرایط واقعی ارائه‌دهنده، ریسک حمله {{type}} برای کیف پول/دارایی و زنجیره مشخص‌شده را پوشش می‌دهد. زیان عادی بازار و موارد مستثنا را پوشش نمی‌دهد. حداکثر پرداخت: ${{max}}.',
      exclusions: 'استثناها', termsLink: 'شرایط و سند پوشش', annexLink: 'الحاقیه',
      walletConnected: 'کیف پول روی {{chain}} متصل است.', walletNotConnected: 'کیف پول متصل نیست — برای امضای واقعی کیف پول متصل کنید.',
      preparedTitle: 'آماده شد (بدون امضا).', preparedBody: 'تحویل بدون امانت‌داری: حق بیمه مستقیماً از کیف پول شما به قرارداد ارائه‌دهنده می‌رود. FBT هرگز وجوه را نگه نمی‌دارد.',
      coverageId: 'شناسه پوشش', contract: 'قرارداد ارائه‌دهنده', mode: 'حالت', unsigned: 'بدون امضا',
      liveSignNote: 'کیف پول شما تراکنش واقعی ارائه‌دهنده را امضا می‌کند (در صورت نیاز تأییه، سپس خرید). سرور قبل از فعال‌سازی، رسید بلاک‌چینی را بررسی می‌کند.',
      signLive: 'امضا با کیف پول و ارسال', sendTo: 'ارسال به', sandboxNote: 'Sandbox: انتقال شبیه‌سازی‌شده حق بیمه برای امضای کیف پول (فقط توسعه/تست).',
      signSandbox: 'امضا و بررسی (آزمایشی)', signing: 'در حال امضا / بررسی…', connectToSign: 'ابتدا کیف پول متصل کنید — خرید همیشه نیاز به امضای شما دارد.',
      signTitle: 'امضا با کیف پول شما', signBodyLive: 'کیف پول شما تراکنش خرید ارائه‌دهنده را امضا می‌کند. قبل از تأیید، قرارداد و مبلغ را در کیف پول بررسی کنید.',
      openWallet: 'باز کردن کیف پول برای امضا',
      sandboxSignTitle: 'امضای آزمایشی', sandboxSignBody: 'این یک امضای شبیه‌سازی‌شده Sandbox برای تست است (فقط توسعه). چیزی روی بلاک‌چین خریداری نمی‌شود.', sandboxSignGo: 'با این حال شبیه‌سازی کن',
      activatedToast: 'پوشش فعال شد', activationFailed: 'فعال‌سازی ناموفق',
      doneTitle: 'پوشش فعال شد.', signedBy: 'امضا شده توسط', txHash: 'هش تراکنش', viewCoverage: 'مشاهده پوشش'
    },
    types: { 'smart-contract': 'قرارداد هوشمند', bridge: 'پل', stablecoin: 'استیبل‌کوین / دی‌پگ', lending: 'وام‌دهی', lp: 'موقعیت LP', wallet: 'کیف پول / امانت', oracle: 'اوراکل', 'defi-protocol': 'پروتکل DeFi' },
    claims: { created: 'مطالبه {{number}} ایجاد شد ({{status}}). اکنون آن را ثبت کنید.', createdToast: 'مطالبه {{number}} ایجاد شد' },
    providerUnavailable: 'ارائه‌دهنده موقتاً در دسترس نیست', unknown: 'نامشخص'
  },
  ar: {
    tabs: { dashboard: 'الرئيسية', marketplace: 'السوق', coverage: 'التغطية', claims: 'المطالبات', risk: 'المخاطر', providers: 'المزودون', ariaLabel: 'أقسام الحماية' },
    common: { confirm: 'تأكيد', cancel: 'إلغاء', close: 'إغلاق', done: 'تم' },
    shell: {
      brand: 'حماية FBT', walletStatus: 'حالة المحفظة/الخادم', apiOffline: 'واجهة غير متصلة', notConnected: 'غير متصل',
      alerts: 'التنبيهات', connectTitle: 'قم بتوصيل محفظتك', connectBody: 'تعمل عروض الأسعار على عنوان حقيقي وتوقّع المشتريات بنفسك. لا يرى FBT مفتاحك أبدًا.',
      browserWallet: 'محفظة المتصفح', walletConnect: 'WalletConnect', inAppWallet: 'المحفظة الداخلية', manualAddress: 'إدخال العنوان يدويًا',
      disconnect: 'قطع الاتصال', notConnectedYet: 'غير متصل بعد', invalidAddress: 'أدخل عنوان 0x صالحًا أو وصّل محفظة.',
      injectedConnected: 'تم توصيل محفظة المتصفح', wcConnected: 'تم توصيل WalletConnect', connectFailed: 'فشل الاتصال بالمحفظة',
      useInAppWallet: 'افتح محفظتك الداخلية من تبويب المحفظة ثم عد إلى هنا.', wallet: 'المحفظة', connectedAs: 'متصل',
      disconnected: 'تم قطع المحفظة', chooseSigning: 'اختر طريقة التوقيع. في كل الأوضاع يبقى مفتاحك الخاص معك.',
      metamask: 'MetaMask / محفظة المتصفح', wcQr: 'WalletConnect (QR / تيليجرام)', orEnterAddress: 'أو أدخل عنوانًا (للمشاهدة فقط):',
      useAddress: 'استخدام العنوان', noAlerts: 'لا تنبيهات.', server: 'الخادم', checking: 'جارٍ التحقق…', serverOnline: 'متصل · واجهة تعمل', serverOffline: 'غير متصل'
    },
    alerts: {
      serverDownTitle: 'الخادم غير متاح', serverDownBody: 'لا يمكن الوصول إلى /api/insurance. عروض الأسعار المباشرة غير متاحة.',
      noProviderTitle: 'المزود غير متاح مؤقتًا', noProviderBody: 'لا يوجد مزود حماية حقيقي مُعتمد مُهيّأ حاليًا، لذا لا عروض أسعار ولا مشتريات جديدة. تبقى التغطيات القائمة ظاهرة.',
      sandboxTitle: 'بيئة تجريبية', sandboxBody: 'مزودو Sandbox محاكاة للاختبار فقط. لا يوجد هنا أي عرض تأمين حقيقي، و FBT لا يحتجز الأموال أبدًا.',
      healthTitle: 'حالة {{name}}: {{status}}', healthBody: 'لا يُنصح به للمشتريات الجديدة أثناء التدهور.',
      noWalletTitle: 'لا محفظة', noWalletBody: 'صّل محفظة لعرض الأسعار على عنوان حقيقي وللتوقيع.'
    },
    market: {
      title: 'سوق الحماية', subtitle: 'قارن الحماية بين مزودين موثوقين. تُعرض كل الرسوم قبل التوقيع، ومحفظتك توقّع كل عملية شراء، ولا يحتجز FBT الأموال أبدًا.',
      sandboxOnlyNote: 'تعمل هذه البيئة بمزودي Sandbox (محاكاة) للاختبار — لا يوجد هنا أي عرض تأمين حقيقي.',
      protectionType: 'نوع الحماية', chain: 'السلسلة', coverageAmount: 'مبلغ التغطية (دولار)', duration: 'المدة (أيام)',
      termsAccept: 'راجعت شروط المزود والملحق وإشعار الاختصاص القضائي وأوافق عليها.',
      gettingQuotes: 'جارٍ جلب العروض…', getQuotes: 'الحصول على عروض حماية', needWallet: 'عيّن عنوان المحفظة أولًا.',
      noEligible: 'المزود غير متاح مؤقتًا — لا توجد حماية مؤهلة حاليًا. عرض السعر المباشر غير متاح؛ الشراء غير ممكن.',
      liveQuoteUnavailable: 'عرض السعر المباشر غير متاح حاليًا. لا شراء ممكن حتى يستجيب مزود.',
      compare: 'مقارنة المزودين ({{count}})', health: 'الصحة', coverage: 'التغطية', settlement: 'التسوية',
      nonCustodial: 'غير احتجازي', claimMethod: 'طريقة المطالبة', termsHash: 'هاش الشروط', reviewBuy: 'مراجعة وشراء',
      howItWorks: 'كيف يعمل، الرسوم والمطالبات'
    },
    info: {
      walletTitle: 'محفظتك، مفاتيحك', walletBody: 'تتصل بمحفظتك الخاصة. لا يستلم FBT مفتاحًا خاصًا أو عبارة استرداد، ولا يحتفظ بأقساط التأمين، ولا يوقّع نيابةً عنك.',
      flowTitle: 'مراحل الشراء',
      flow1: 'تُكتشف المنتجات الحقيقية من واجهة المزود.', flow2: 'تطلب عرض سعر مباشرًا.',
      flow3: 'تُقارن المزودون بالسعر والصحة والسعة والشروط.', flow4: 'تراجع الشروط والرسوم الحقيقية.',
      flow5: 'تؤكد.', flow6: 'محفظتك توقّع المعاملة المُعدّة.',
      flow7: 'يُتحقق من إيصال البلوكتشين بشكل مستقل.', flow8: 'تُفعّل التغطية فقط بعد التحقق.',
      riskTitle: 'معايير المخاطر', riskIntro: 'يُحسب الخطر من هذه المدخلات — وليس أبدًا بالتخمين:',
      risk1: 'مخاطر البروتوكول', risk2: 'مخاطر العقد الذكي', risk3: 'مخاطر السلسلة', risk4: 'الاعتماد على الأوراكل',
      risk5: 'الاعتماد على الجسور', risk6: 'مخاطر الأصل', risk7: 'السيولة', risk8: 'التركّز',
      risk9: 'صحة المزود', risk10: 'سعة المزود', risk11: 'الحوادث التاريخية', risk12: 'استثناءات التغطية',
      feesTitle: 'الرسوم مفصّلة بالكامل', claimsTitle: 'المطالبات بصدق',
      claim1: 'لا تُقبل أي مطالبة تلقائيًا.', claim2: 'الأدلة الحقيقية مطلوبة.',
      claim3: 'تُفحص هاشات المعاملات والكتل.', claim4: 'شروط المزود الحقيقية هي الأساس.',
      claim5: 'لا يُسجّل الدفع إلا بعد تحقق مستقل من البلوكتشين.'
    },
    fee: { providerPremium: 'قسط المزود', fbtFee: 'رسوم سوق FBT', fbtFeeShort: 'رسوم FBT', networkFee: 'رسوم الشبكة (تقديرية)', commission: 'عمولة المزود', total: 'إجمالي تكلفة المستخدم', zero: 'رسوم سوق FBT: 0$' },
    source: { label: 'المصدر', providerApi: 'واجهة المزود', updated: 'محدَّث', freshness: 'الحداثة', live: 'مباشر', cached: 'مخزّن مؤقتًا', stale: 'بيانات منتهية — يلزم التحديث', unknown: 'غير معروف' },
    quote: {
      confirmTitle: 'تأكيد الشراء؟', confirmBody: 'أنت تُعد تغطية بقيمة ${{coverage}} بتكلفة إجمالية ${{total}} (شاملة كل الرسوم). لا يُخصم شيء حتى توقّع.',
      confirmPrepare: 'تأكيد وتجهيز', preparedToast: 'تم تجهيز الشراء (غير موقّع). راجع ووقّع للتفعيل.',
      prepareFailed: 'فشل التجهيز', unavailable: 'عرض السعر غير متاح: {{error}}', backToMarket: 'العودة إلى السوق',
      loading: 'جارٍ تحميل عرض السعر…', title: 'الدفع',
      subtitle: 'راجع التغطية وكل رسوم وشروط واستثناءات قبل التوقيع. يذهب القسط مباشرة إلى المزود — FBT واجهة غير احتجازية.',
      protection: 'الحماية', days: '{{count}} أيام', provider: 'المزود', currency: 'العملة',
      feeNote: 'رسوم سوق FBT هي 0$ إلى حين وجود اتفاق رسوم حقيقي — وتُعرض دائمًا قبل التوقيع. لا رسوم خفية.',
      coverageBox: 'ما تغطيه هذه الشهادة',
      coverageExplain: 'تحمي هذه الشهادة وفق شروط المزود الحقيقية من خطر اختراق {{type}} للمحفظة/الأصل والسلسلة المحددة. لا تغطي خسائر السوق العادية أو الأحداث المستثناة. الحد الأقصى للتعويض: ${{max}}.',
      exclusions: 'الاستثناءات', termsLink: 'الشروط والصياغة', annexLink: 'الملحق',
      walletConnected: 'المحفظة متصلة على {{chain}}.', walletNotConnected: 'المحفظة غير متصلة — صّل محفظة للتوقيع الحقيقي.',
      preparedTitle: 'تم التجهيز (غير موقّع).', preparedBody: 'تسليم غير احتجازي: ينتقل القسط من محفظتك مباشرة إلى عقد المزود. لا يحتجز FBT الأموال.',
      coverageId: 'معرّف التغطية', contract: 'عقد المزود', mode: 'الوضع', unsigned: 'غير موقّعة',
      liveSignNote: 'محفظتك ستوقّع معاملة المزود الحقيقية (موافقة إن لزم، ثم الشراء). يتحقق الخادم من إيصال البلوكتشين قبل التفعيل.',
      signLive: 'وقّع بالمحفظة وأرسل', sendTo: 'إرسال إلى', sandboxNote: 'Sandbox: تحويل قسط محاكى لتوقيع المحفظة (تطوير/اختبار فقط).',
      signSandbox: 'وقّع وتحقق (تجريبي)', signing: 'جارٍ التوقيع/التحقق…', connectToSign: 'صّل محفظة أولًا — الشراء يحتاج دائمًا توقيعك.',
      signTitle: 'وقّع بمحفظتك', signBodyLive: 'محفظتك ستوقّع الآن معاملة شراء المزود. تحقق من العقد والمبلغ في محفظتك قبل التأكيد.',
      openWallet: 'افتح المحفظة للتوقيع',
      sandboxSignTitle: 'توقيع تجريبي', sandboxSignBody: 'هذا توقيع Sandbox محاكى للاختبار (تطوير فقط). لا يُشترى شيء على البلوكتشين.', sandboxSignGo: 'محاكاة على أي حال',
      activatedToast: 'تم تفعيل التغطية', activationFailed: 'فشل التفعيل',
      doneTitle: 'تم تفعيل التغطية.', signedBy: 'موقّع بواسطة', txHash: 'هاش المعاملة', viewCoverage: 'عرض التغطية'
    },
    types: { 'smart-contract': 'عقد ذكي', bridge: 'جسر', stablecoin: 'عملة مستقرة / انفكاك', lending: 'الإقراض', lp: 'مركز LP', wallet: 'محفظة / حجز', oracle: 'أوراكل', 'defi-protocol': 'بروتوكول DeFi' },
    claims: { created: 'تم إنشاء المطالبة {{number}} ({{status}}). قدّمها الآن.', createdToast: 'تم إنشاء المطالبة {{number}}' },
    providerUnavailable: 'المزود غير متاح مؤقتًا', unknown: 'غير معروف'
  },
  es: {
    tabs: { dashboard: 'Panel', marketplace: 'Mercado', coverage: 'Cobertura', claims: 'Reclamaciones', risk: 'Riesgo', providers: 'Proveedores', ariaLabel: 'Secciones de protección' },
    common: { confirm: 'Confirmar', cancel: 'Cancelar', close: 'Cerrar', done: 'Hecho' },
    shell: {
      brand: 'Protección FBT', walletStatus: 'Estado de cartera/servidor', apiOffline: 'API sin conexión', notConnected: 'No conectado',
      alerts: 'Alertas', connectTitle: 'Conecta tu cartera', connectBody: 'Las cotizaciones usan una dirección real y tú firmas las compras. FBT nunca ve tu clave.',
      browserWallet: 'Cartera del navegador', walletConnect: 'WalletConnect', inAppWallet: 'Cartera integrada', manualAddress: 'Usar dirección manualmente',
      disconnect: 'Desconectar', notConnectedYet: 'Aún no conectado', invalidAddress: 'Introduce una dirección 0x válida o conecta una cartera.',
      injectedConnected: 'Cartera del navegador conectada', wcConnected: 'WalletConnect conectado', connectFailed: 'Fallo al conectar la cartera',
      useInAppWallet: 'Desbloquea tu cartera integrada en la pestaña Cartera y vuelve aquí.', wallet: 'Cartera', connectedAs: 'Conectado',
      disconnected: 'Cartera desconectada', chooseSigning: 'Elige cómo firmas. En todos los modos tu clave privada se queda contigo.',
      metamask: 'MetaMask / cartera del navegador', wcQr: 'WalletConnect (QR / Telegram)', orEnterAddress: 'O introduce una dirección (solo lectura):',
      useAddress: 'Usar dirección', noAlerts: 'Sin alertas.', server: 'Servidor', checking: 'comprobando…', serverOnline: 'conectado · API en línea', serverOffline: 'sin conexión'
    },
    alerts: {
      serverDownTitle: 'Servidor inaccesible', serverDownBody: 'No se pudo alcanzar /api/insurance. Cotizaciones en vivo no disponibles.',
      noProviderTitle: 'Proveedor no disponible temporalmente', noProviderBody: 'No hay ningún proveedor de protección real verificado configurado ahora mismo, por lo que no hay cotizaciones ni compras nuevas. La cobertura existente sigue visible.',
      sandboxTitle: 'Entorno de pruebas', sandboxBody: 'Los proveedores sandbox son simulaciones para pruebas. Nada aquí es una oferta real de cobertura y FBT nunca custodia fondos.',
      healthTitle: 'Estado de {{name}}: {{status}}', healthBody: 'No se recomienda para compras nuevas mientras esté degradado.',
      noWalletTitle: 'Sin cartera', noWalletBody: 'Conecta una cartera para cotizar con una dirección real y para firmar.'
    },
    market: {
      title: 'Mercado de Protección', subtitle: 'Compara protección entre proveedores verificados. Cada tarifa se muestra antes de firmar, tu cartera firma cada compra y FBT nunca custodia fondos.',
      sandboxOnlyNote: 'Este entorno usa proveedores sandbox (simulación) para pruebas — nada aquí es una oferta real de cobertura.',
      protectionType: 'Tipo de protección', chain: 'Cadena', coverageAmount: 'Importe de cobertura (USD)', duration: 'Duración (días)',
      termsAccept: 'He revisado los términos del proveedor, el anexo y el aviso de jurisdicción, y los acepto.',
      gettingQuotes: 'Obteniendo cotizaciones…', getQuotes: 'Obtener cotizaciones', needWallet: 'Configura primero una dirección de cartera.',
      noEligible: 'Proveedor no disponible temporalmente — no hay protección elegible disponible ahora. Cotización en vivo no disponible; compra imposible.',
      liveQuoteUnavailable: 'Cotización en vivo no disponible ahora mismo. No es posible comprar hasta que un proveedor responda.',
      compare: 'Comparar proveedores ({{count}})', health: 'Salud', coverage: 'Cobertura', settlement: 'Liquidación',
      nonCustodial: 'sin custodia', claimMethod: 'Método de reclamación', termsHash: 'Hash de términos', reviewBuy: 'Revisar y comprar',
      howItWorks: 'Cómo funciona, tarifas y reclamaciones'
    },
    info: {
      walletTitle: 'Tu cartera, tus claves', walletBody: 'Te conectas con tu propia cartera. FBT nunca recibe una clave privada ni frase semilla, nunca retiene primas ni firma por ti.',
      flowTitle: 'Cómo funciona una compra',
      flow1: 'Los productos reales se descubren desde la API del proveedor.', flow2: 'Solicitas una cotización en vivo.',
      flow3: 'Los proveedores se comparan por precio, salud, capacidad y términos.', flow4: 'Revisas los términos y tarifas reales.',
      flow5: 'Confirmas.', flow6: 'Tu cartera firma la transacción preparada.',
      flow7: 'El recibo de blockchain se verifica de forma independiente.', flow8: 'La cobertura se activa solo tras la verificación.',
      riskTitle: 'Criterios de riesgo', riskIntro: 'El riesgo se calcula a partir de estos insumos — nunca por suposición:',
      risk1: 'Riesgo del protocolo', risk2: 'Riesgo de contrato inteligente', risk3: 'Riesgo de cadena', risk4: 'Dependencia de oráculos',
      risk5: 'Dependencia de puentes', risk6: 'Riesgo del activo', risk7: 'Liquidez', risk8: 'Concentración',
      risk9: 'Salud del proveedor', risk10: 'Capacidad del proveedor', risk11: 'Incidentes históricos', risk12: 'Exclusiones de cobertura',
      feesTitle: 'Tarifas, totalmente detalladas', claimsTitle: 'Reclamaciones, tratadas con honestidad',
      claim1: 'Una reclamación nunca se aprueba automáticamente.', claim2: 'Se requiere evidencia real.',
      claim3: 'Se verifican los hashes de transacción y los bloques.', claim4: 'Los términos reales del proveedor son la base.',
      claim5: 'Los pagos se registran solo tras verificación independiente en la cadena.'
    },
    fee: { providerPremium: 'Prima del proveedor', fbtFee: 'Comisión del mercado FBT', fbtFeeShort: 'Comisión FBT', networkFee: 'Tarifa de red (est.)', commission: 'Comisión del proveedor', total: 'Coste total del usuario', zero: 'Comisión del mercado FBT: $0' },
    source: { label: 'Fuente', providerApi: 'API del proveedor', updated: 'Actualizado', freshness: 'Frescura', live: 'En vivo', cached: 'En caché', stale: 'DATOS OBSOLETOS — ACTUALIZAR', unknown: 'Desconocido' },
    quote: {
      confirmTitle: '¿Confirmar compra?', confirmBody: 'Estás preparando ${{coverage}} de protección por un total de ${{total}} (todas las tarifas incluidas). No se cobra nada hasta que firmes.',
      confirmPrepare: 'Confirmar y preparar', preparedToast: 'Compra preparada (sin firmar). Revisa y firma para activar.',
      prepareFailed: 'Fallo al preparar', unavailable: 'Cotización no disponible: {{error}}', backToMarket: 'Volver al mercado',
      loading: 'Cargando cotización…', title: 'Pago',
      subtitle: 'Revisa cobertura, cada tarifa, términos y exclusiones antes de firmar. La prima va directamente al proveedor — FBT es una interfaz sin custodia.',
      protection: 'Protección', days: '{{count}} días', provider: 'Proveedor', currency: 'Moneda',
      feeNote: 'La comisión del mercado FBT es $0 hasta que exista un acuerdo real — y siempre se muestra antes de firmar. Sin tarifas ocultas.',
      coverageBox: 'Qué cubre esto',
      coverageExplain: 'Este certificado protege contra el riesgo de exploit de {{type}} listado para la cartera/activo y cadena cubiertos, según los términos reales del proveedor. No cubre pérdidas ordinarias de mercado ni eventos excluidos. Pago máximo elegible: ${{max}}.',
      exclusions: 'Exclusiones', termsLink: 'Términos y redacción', annexLink: 'Anexo',
      walletConnected: 'Cartera conectada en {{chain}}.', walletNotConnected: 'Cartera NO conectada — conecta una cartera para firmar de verdad.',
      preparedTitle: 'Preparada (sin firmar).', preparedBody: 'Entrega sin custodia: la prima va de tu cartera directamente al contrato del proveedor. FBT nunca retiene fondos.',
      coverageId: 'ID de cobertura', contract: 'Contrato del proveedor', mode: 'Modo', unsigned: 'sin firmar',
      liveSignNote: 'Tu cartera firmará la transacción real del proveedor (aprobación si es necesaria, luego la compra). El servidor verifica el recibo en cadena antes de activar la cobertura.',
      signLive: 'Firmar con cartera y transmitir', sendTo: 'Enviar a', sandboxNote: 'Sandbox: transferencia de prima simulada para firma de cartera (solo desarrollo/pruebas).',
      signSandbox: 'Firmar y verificar (sandbox)', signing: 'Firmando / verificando…', connectToSign: 'Conecta una cartera primero — comprar siempre requiere tu firma.',
      signTitle: 'Firma con tu cartera', signBodyLive: 'Tu cartera firmará ahora la transacción de compra del proveedor. Verifica el contrato y el importe en tu cartera antes de confirmar.',
      openWallet: 'Abrir cartera para firmar',
      sandboxSignTitle: 'Firma sandbox', sandboxSignBody: 'Esta es una firma sandbox simulada para pruebas (solo desarrollo). No se compra nada en la cadena.', sandboxSignGo: 'Simular de todos modos',
      activatedToast: 'Cobertura activada', activationFailed: 'Fallo de activación',
      doneTitle: 'Cobertura activada.', signedBy: 'Firmado por', txHash: 'Hash de transacción', viewCoverage: 'Ver cobertura'
    },
    types: { 'smart-contract': 'Contrato inteligente', bridge: 'Puente', stablecoin: 'Stablecoin / despegue', lending: 'Préstamos', lp: 'Posición LP', wallet: 'Cartera / custodia', oracle: 'Oráculo', 'defi-protocol': 'Protocolo DeFi' },
    claims: { created: 'Reclamación {{number}} creada ({{status}}). Ahora envíala.', createdToast: 'Reclamación {{number}} creada' },
    providerUnavailable: 'Proveedor no disponible temporalmente', unknown: 'Desconocido'
  },
  fr: {
    tabs: { dashboard: 'Tableau de bord', marketplace: 'Marché', coverage: 'Couverture', claims: 'Réclamations', risk: 'Risque', providers: 'Fournisseurs', ariaLabel: 'Sections de protection' },
    common: { confirm: 'Confirmer', cancel: 'Annuler', close: 'Fermer', done: 'Terminé' },
    shell: {
      brand: 'Protection FBT', walletStatus: 'Statut portefeuille/serveur', apiOffline: 'API hors ligne', notConnected: 'Non connecté',
      alerts: 'Alertes', connectTitle: 'Connectez votre portefeuille', connectBody: 'Les cotations utilisent une adresse réelle et vous signez les achats. FBT ne voit jamais votre clé.',
      browserWallet: 'Portefeuille du navigateur', walletConnect: 'WalletConnect', inAppWallet: 'Portefeuille intégré', manualAddress: 'Saisir une adresse manuellement',
      disconnect: 'Déconnecter', notConnectedYet: 'Pas encore connecté', invalidAddress: 'Saisissez une adresse 0x valide ou connectez un portefeuille.',
      injectedConnected: 'Portefeuille du navigateur connecté', wcConnected: 'WalletConnect connecté', connectFailed: 'Échec de connexion du portefeuille',
      useInAppWallet: 'Déverrouillez votre portefeuille intégré depuis l’onglet Portefeuille, puis revenez ici.', wallet: 'Portefeuille', connectedAs: 'Connecté',
      disconnected: 'Portefeuille déconnecté', chooseSigning: 'Choisissez votre mode de signature. Dans tous les cas, votre clé privée reste chez vous.',
      metamask: 'MetaMask / portefeuille navigateur', wcQr: 'WalletConnect (QR / Telegram)', orEnterAddress: 'Ou saisissez une adresse (lecture seule) :',
      useAddress: 'Utiliser l’adresse', noAlerts: 'Aucune alerte.', server: 'Serveur', checking: 'vérification…', serverOnline: 'connecté · API en ligne', serverOffline: 'hors ligne'
    },
    alerts: {
      serverDownTitle: 'Serveur inaccessible', serverDownBody: 'Impossible de joindre /api/insurance. Cotations en direct indisponibles.',
      noProviderTitle: 'Fournisseur temporairement indisponible', noProviderBody: 'Aucun fournisseur de protection réel vérifié n’est configuré pour le moment — ni cotations ni achats possibles. Les couvertures existantes restent visibles.',
      sandboxTitle: 'Environnement sandbox', sandboxBody: 'Les fournisseurs sandbox sont des simulations de test. Rien ici n’est une offre réelle et FBT ne garde jamais de fonds.',
      healthTitle: 'Santé de {{name}} : {{status}}', healthBody: 'Non recommandé pour de nouveaux achats tant que dégradé.',
      noWalletTitle: 'Pas de portefeuille', noWalletBody: 'Connectez un portefeuille pour coter sur une adresse réelle et signer.'
    },
    market: {
      title: 'Marché de la Protection', subtitle: 'Comparez la protection entre fournisseurs vérifiés. Chaque frais est affiché avant signature, votre portefeuille signe chaque achat et FBT ne garde jamais de fonds.',
      sandboxOnlyNote: 'Cet environnement utilise des fournisseurs sandbox (simulation) pour les tests — rien ici n’est une offre réelle.',
      protectionType: 'Type de protection', chain: 'Chaîne', coverageAmount: 'Montant couvert (USD)', duration: 'Durée (jours)',
      termsAccept: 'J’ai examiné les conditions du fournisseur, l’annexe et l’avis de juridiction, et je les accepte.',
      gettingQuotes: 'Obtention des cotations…', getQuotes: 'Obtenir des cotations', needWallet: 'Définissez d’abord une adresse de portefeuille.',
      noEligible: 'Fournisseur temporairement indisponible — aucune protection éligible disponible actuellement. Cotation en direct indisponible ; achat impossible.',
      liveQuoteUnavailable: 'Cotation en direct indisponible pour le moment. Achat impossible jusqu’à réponse d’un fournisseur.',
      compare: 'Comparer les fournisseurs ({{count}})', health: 'Santé', coverage: 'Couverture', settlement: 'Règlement',
      nonCustodial: 'sans garde', claimMethod: 'Méthode de réclamation', termsHash: 'Hash des conditions', reviewBuy: 'Vérifier et acheter',
      howItWorks: 'Fonctionnement, frais et réclamations'
    },
    info: {
      walletTitle: 'Votre portefeuille, vos clés', walletBody: 'Vous vous connectez avec votre propre portefeuille. FBT ne reçoit jamais de clé privée ni de phrase de récupération, ne garde aucune prime et ne signe jamais pour vous.',
      flowTitle: 'Déroulé d’un achat',
      flow1: 'Les produits réels sont découverts via l’API du fournisseur.', flow2: 'Vous demandez une cotation en direct.',
      flow3: 'Les fournisseurs sont comparés par prix, santé, capacité et conditions.', flow4: 'Vous examinez les conditions et frais réels.',
      flow5: 'Vous confirmez.', flow6: 'Votre portefeuille signe la transaction préparée.',
      flow7: 'Le reçu blockchain est vérifié de manière indépendante.', flow8: 'La couverture ne s’active qu’après vérification.',
      riskTitle: 'Critères de risque', riskIntro: 'Le risque est calculé à partir de ces entrées — jamais au doigt mouillé :',
      risk1: 'Risque du protocole', risk2: 'Risque du contrat intelligent', risk3: 'Risque de chaîne', risk4: 'Dépendance aux oracles',
      risk5: 'Dépendance aux ponts', risk6: 'Risque de l’actif', risk7: 'Liquidité', risk8: 'Concentration',
      risk9: 'Santé du fournisseur', risk10: 'Capacité du fournisseur', risk11: 'Incidents historiques', risk12: 'Exclusions de couverture',
      feesTitle: 'Frais, entièrement détaillés', claimsTitle: 'Réclamations, gérées honnêtement',
      claim1: 'Une réclamation n’est jamais approuvée automatiquement.', claim2: 'Des preuves réelles sont exigées.',
      claim3: 'Les hash de transaction et blocs sont vérifiés.', claim4: 'Les conditions réelles du fournisseur font foi.',
      claim5: 'Les paiements ne sont enregistrés qu’après vérification indépendante on-chain.'
    },
    fee: { providerPremium: 'Prime du fournisseur', fbtFee: 'Frais de place FBT', fbtFeeShort: 'Frais FBT', networkFee: 'Frais réseau (est.)', commission: 'Commission du fournisseur', total: 'Coût total utilisateur', zero: 'Frais de place FBT : 0 $' },
    source: { label: 'Source', providerApi: 'API du fournisseur', updated: 'Mis à jour', freshness: 'Fraîcheur', live: 'Direct', cached: 'En cache', stale: 'DONNÉES PÉRIMÉES — ACTUALISER', unknown: 'Inconnu' },
    quote: {
      confirmTitle: 'Confirmer l’achat ?', confirmBody: 'Vous préparez ${{coverage}} de protection pour un total de ${{total}} (tous frais inclus). Rien n’est débité avant votre signature.',
      confirmPrepare: 'Confirmer et préparer', preparedToast: 'Achat préparé (non signé). Vérifiez puis signez pour activer.',
      prepareFailed: 'Échec de la préparation', unavailable: 'Cotation indisponible : {{error}}', backToMarket: 'Retour au marché',
      loading: 'Chargement de la cotation…', title: 'Paiement',
      subtitle: 'Vérifiez la couverture, chaque frais, les conditions et exclusions avant de signer. La prime va directement au fournisseur — FBT est une interface sans garde.',
      protection: 'Protection', days: '{{count}} jours', provider: 'Fournisseur', currency: 'Devise',
      feeNote: 'Les frais de place FBT sont de 0 $ tant qu’aucun accord réel n’existe — et toujours affichés avant signature. Aucun frais caché.',
      coverageBox: 'Ce que cela couvre',
      coverageExplain: 'Ce certificat protège contre le risque d’exploit {{type}} listé, pour le portefeuille/actif et la chaîne couverts, selon les conditions réelles du fournisseur. Il ne couvre pas les pertes de marché ordinaires ni les événements exclus. Paiement maximum éligible : ${{max}}.',
      exclusions: 'Exclusions', termsLink: 'Conditions et libellé', annexLink: 'Annexe',
      walletConnected: 'Portefeuille connecté sur {{chain}}.', walletNotConnected: 'Portefeuille NON connecté — connectez-en un pour signer réellement.',
      preparedTitle: 'Préparé (non signé).', preparedBody: 'Transfert sans garde : la prime passe de votre portefeuille directement au contrat du fournisseur. FBT ne garde jamais de fonds.',
      coverageId: 'ID de couverture', contract: 'Contrat du fournisseur', mode: 'Mode', unsigned: 'non signée',
      liveSignNote: 'Votre portefeuille signera la vraie transaction du fournisseur (approbation si besoin, puis l’achat). Le serveur vérifie le reçu on-chain avant d’activer la couverture.',
      signLive: 'Signer avec le portefeuille et diffuser', sendTo: 'Envoyer à', sandboxNote: 'Sandbox : transfert de prime simulé pour signature (développement/test uniquement).',
      signSandbox: 'Signer et vérifier (sandbox)', signing: 'Signature / vérification…', connectToSign: 'Connectez d’abord un portefeuille — tout achat exige votre signature.',
      signTitle: 'Signez avec votre portefeuille', signBodyLive: 'Votre portefeuille va signer la transaction d’achat du fournisseur. Vérifiez le contrat et le montant avant de confirmer.',
      openWallet: 'Ouvrir le portefeuille pour signer',
      sandboxSignTitle: 'Signature sandbox', sandboxSignBody: 'Signature sandbox simulée pour test (développement uniquement). Rien n’est acheté on-chain.', sandboxSignGo: 'Simuler quand même',
      activatedToast: 'Couverture activée', activationFailed: 'Échec de l’activation',
      doneTitle: 'Couverture activée.', signedBy: 'Signé par', txHash: 'Hash de transaction', viewCoverage: 'Voir la couverture'
    },
    types: { 'smart-contract': 'Contrat intelligent', bridge: 'Pont', stablecoin: 'Stablecoin / dépeg', lending: 'Prêt', lp: 'Position LP', wallet: 'Portefeuille / garde', oracle: 'Oracle', 'defi-protocol': 'Protocole DeFi' },
    claims: { created: 'Réclamation {{number}} créée ({{status}}). Soumettez-la maintenant.', createdToast: 'Réclamation {{number}} créée' },
    providerUnavailable: 'Fournisseur temporairement indisponible', unknown: 'Inconnu'
  },
  de: {
    tabs: { dashboard: 'Übersicht', marketplace: 'Marktplatz', coverage: 'Deckung', claims: 'Ansprüche', risk: 'Risiko', providers: 'Anbieter', ariaLabel: 'Schutzbereiche' },
    common: { confirm: 'Bestätigen', cancel: 'Abbrechen', close: 'Schließen', done: 'Fertig' },
    shell: {
      brand: 'FBT-Schutz', walletStatus: 'Wallet-/Serverstatus', apiOffline: 'API offline', notConnected: 'Nicht verbunden',
      alerts: 'Hinweise', connectTitle: 'Wallet verbinden', connectBody: 'Angebote laufen auf eine echte Adresse, und du unterschreibst jeden Kauf selbst. FBT sieht deinen Schlüssel nie.',
      browserWallet: 'Browser-Wallet', walletConnect: 'WalletConnect', inAppWallet: 'Interne Wallet', manualAddress: 'Adresse manuell eingeben',
      disconnect: 'Trennen', notConnectedYet: 'Noch nicht verbunden', invalidAddress: 'Gib eine gültige 0x-Adresse ein oder verbinde eine Wallet.',
      injectedConnected: 'Browser-Wallet verbunden', wcConnected: 'WalletConnect verbunden', connectFailed: 'Wallet-Verbindung fehlgeschlagen',
      useInAppWallet: 'Entsperre deine interne Wallet im Wallet-Tab und komm hierher zurück.', wallet: 'Wallet', connectedAs: 'Verbunden',
      disconnected: 'Wallet getrennt', chooseSigning: 'Wähle, wie du unterschreibst. In jedem Modus bleibt dein privater Schlüssel bei dir.',
      metamask: 'MetaMask / Browser-Wallet', wcQr: 'WalletConnect (QR / Telegram)', orEnterAddress: 'Oder Adresse eingeben (nur Ansicht):',
      useAddress: 'Adresse verwenden', noAlerts: 'Keine Hinweise.', server: 'Server', checking: 'prüfe…', serverOnline: 'verbunden · API online', serverOffline: 'offline'
    },
    alerts: {
      serverDownTitle: 'Server nicht erreichbar', serverDownBody: '/api/insurance nicht erreichbar. Live-Angebote nicht verfügbar.',
      noProviderTitle: 'Anbieter vorübergehend nicht verfügbar', noProviderBody: 'Derzeit ist kein verifizierter Echt-Anbieter konfiguriert — keine neuen Angebote oder Käufe möglich. Bestehende Deckungen bleiben sichtbar.',
      sandboxTitle: 'Sandbox-Umgebung', sandboxBody: 'Sandbox-Anbieter sind Testsimulationen. Nichts hier ist ein echtes Angebot, und FBT verwahrt nie Guthaben.',
      healthTitle: '{{name}}-Status: {{status}}', healthBody: 'Bei Einschränkung für neue Käufe nicht empfohlen.',
      noWalletTitle: 'Keine Wallet', noWalletBody: 'Verbinde eine Wallet, um mit echter Adresse zu kalkulieren und zu unterschreiben.'
    },
    market: {
      title: 'Schutz-Marktplatz', subtitle: 'Vergleiche Schutz über geprüfte Anbieter. Jede Gebühr wird vor der Unterschrift angezeigt, deine Wallet signiert jeden Kauf, und FBT verwahrt nie Guthaben.',
      sandboxOnlyNote: 'Diese Umgebung nutzt Sandbox-Anbieter (Simulation) zum Testen — nichts hier ist ein echtes Angebot.',
      protectionType: 'Schutzart', chain: 'Chain', coverageAmount: 'Deckungssumme (USD)', duration: 'Laufzeit (Tage)',
      termsAccept: 'Ich habe die Anbieterbedingungen, den Anhang und den Jurisdiktionshinweis geprüft und akzeptiere sie.',
      gettingQuotes: 'Angebote werden geladen…', getQuotes: 'Schutzangebote abrufen', needWallet: 'Zuerst eine Wallet-Adresse festlegen.',
      noEligible: 'Anbieter vorübergehend nicht verfügbar — derzeit kein geeigneter Schutz verfügbar. Live-Angebot nicht verfügbar; Kauf nicht möglich.',
      liveQuoteUnavailable: 'Live-Angebot derzeit nicht verfügbar. Kein Kauf möglich, bis ein Anbieter antwortet.',
      compare: 'Anbieter vergleichen ({{count}})', health: 'Status', coverage: 'Deckung', settlement: 'Abwicklung',
      nonCustodial: 'ohne Verwahrung', claimMethod: 'Anspruchsmethode', termsHash: 'Bedingungen-Hash', reviewBuy: 'Prüfen & kaufen',
      howItWorks: 'Ablauf, Gebühren & Ansprüche'
    },
    info: {
      walletTitle: 'Deine Wallet, deine Schlüssel', walletBody: 'Du verbindest deine eigene Wallet. FBT erhält nie einen privaten Schlüssel oder eine Seed-Phrase, hält keine Prämien zurück und unterschreibt nie für dich.',
      flowTitle: 'So läuft ein Kauf',
      flow1: 'Echte Produkte werden über die Anbieter-API ermittelt.', flow2: 'Du forderst ein Live-Angebot an.',
      flow3: 'Anbieter werden nach Preis, Status, Kapazität und Bedingungen verglichen.', flow4: 'Du prüfst echte Bedingungen und Gebühren.',
      flow5: 'Du bestätigst.', flow6: 'Deine Wallet signiert die vorbereitete Transaktion.',
      flow7: 'Der Blockchain-Beleg wird unabhängig verifiziert.', flow8: 'Deckung wird erst nach Verifizierung aktiviert.',
      riskTitle: 'Risokriterien', riskIntro: 'Risiko wird aus diesen Eingaben berechnet — nie geschätzt:',
      risk1: 'Protokollrisiko', risk2: 'Smart-Contract-Risiko', risk3: 'Chain-Risiko', risk4: 'Oracle-Abhängigkeit',
      risk5: 'Bridge-Abhängigkeit', risk6: 'Asset-Risiko', risk7: 'Liquidität', risk8: 'Konzentration',
      risk9: 'Anbieterstatus', risk10: 'Anbieterkapazität', risk11: 'Historische Vorfälle', risk12: 'Deckungsausschlüsse',
      feesTitle: 'Gebühren, vollständig aufgeschlüsselt', claimsTitle: 'Ansprüche, ehrlich behandelt',
      claim1: 'Ein Anspruch wird nie automatisch genehmigt.', claim2: 'Echte Nachweise sind erforderlich.',
      claim3: 'Transaktions-Hashes und Blöcke werden geprüft.', claim4: 'Die echten Bedingungen des Anbieters gelten.',
      claim5: 'Auszahlungen werden erst nach unabhängiger On-Chain-Verifizierung erfasst.'
    },
    fee: { providerPremium: 'Anbieterprämie', fbtFee: 'FBT-Marktplatzgebühr', fbtFeeShort: 'FBT-Gebühr', networkFee: 'Netzwerkgebühr (geschätzt)', commission: 'Anbieterprovision', total: 'Gesamtkosten', zero: 'FBT-Marktplatzgebühr: 0 $' },
    source: { label: 'Quelle', providerApi: 'Anbieter-API', updated: 'Aktualisiert', freshness: 'Aktualität', live: 'Live', cached: 'Zwischengespeichert', stale: 'VERALTETE DATEN — AKTUALISIEREN', unknown: 'Unbekannt' },
    quote: {
      confirmTitle: 'Kauf bestätigen?', confirmBody: 'Du bereitest ${{coverage}} Schutz für insgesamt ${{total}} vor (alle Gebühren inklusive). Bis zu deiner Unterschrift wird nichts abgebucht.',
      confirmPrepare: 'Bestätigen & vorbereiten', preparedToast: 'Kauf vorbereitet (uns signiert). Prüfen und zur Aktivierung unterschreiben.',
      prepareFailed: 'Vorbereitung fehlgeschlagen', unavailable: 'Angebot nicht verfügbar: {{error}}', backToMarket: 'Zurück zum Marktplatz',
      loading: 'Angebot wird geladen…', title: 'Kasse',
      subtitle: 'Prüfe Deckung, jede Gebühr, Bedingungen und Ausschlüsse vor der Unterschrift. Die Prämie geht direkt an den Anbieter — FBT ist eine Schnittstelle ohne Verwahrung.',
      protection: 'Schutz', days: '{{count}} Tage', provider: 'Anbieter', currency: 'Währung',
      feeNote: 'Die FBT-Marktplatzgebühr beträgt 0 $, solange keine echte Vereinbarung besteht — und wird immer vor der Unterschrift angezeigt. Keine versteckten Gebühren.',
      coverageBox: 'Was das abdeckt',
      coverageExplain: 'Dieses Zertifikat schützt gemäß den echten Anbieterbedingungen vor dem aufgelisteten {{type}}-Exploitrisiko für die abgedeckte Wallet/Asset und Chain. Gewöhnliche Marktverluste und ausgeschlossene Ereignisse sind nicht gedeckt. Maximaler Anspruch: ${{max}}.',
      exclusions: 'Ausschlüsse', termsLink: 'Bedingungen & Wortlaut', annexLink: 'Anhang',
      walletConnected: 'Wallet verbunden auf {{chain}}.', walletNotConnected: 'Wallet NICHT verbunden — verbinde eine Wallet zum echten Signieren.',
      preparedTitle: 'Vorbereitet (uns signiert).', preparedBody: 'Übergabe ohne Verwahrung: Die Prämie geht direkt von deiner Wallet zum Anbietervertrag. FBT hält nie Guthaben.',
      coverageId: 'Deckungs-ID', contract: 'Anbietervertrag', mode: 'Modus', unsigned: 'uns signiert',
      liveSignNote: 'Deine Wallet signiert die echte Anbieter-Transaktion (ggf. Genehmigung, dann Kauf). Der Server verifiziert den On-Chain-Beleg vor der Aktivierung.',
      signLive: 'Mit Wallet signieren & senden', sendTo: 'Senden an', sandboxNote: 'Sandbox: simulierte Prämienübertragung zur Wallet-Signatur (nur Entwicklung/Test).',
      signSandbox: 'Signieren & prüfen (Sandbox)', signing: 'Signieren / Prüfen…', connectToSign: 'Zuerst eine Wallet verbinden — jeder Kauf braucht deine Signatur.',
      signTitle: 'Mit deiner Wallet signieren', signBodyLive: 'Deine Wallet signiert jetzt die Anbieter-Kauftransaktion. Prüfe Vertrag und Betrag in der Wallet, bevor du bestätigst.',
      openWallet: 'Wallet zum Signieren öffnen',
      sandboxSignTitle: 'Sandbox-Signatur', sandboxSignBody: 'Dies ist eine simulierte Sandbox-Signatur zum Testen (nur Entwicklung). Es wird nichts on-chain gekauft.', sandboxSignGo: 'Trotzdem simulieren',
      activatedToast: 'Deckung aktiviert', activationFailed: 'Aktivierung fehlgeschlagen',
      doneTitle: 'Deckung aktiviert.', signedBy: 'Signiert von', txHash: 'Transaktions-Hash', viewCoverage: 'Deckung ansehen'
    },
    types: { 'smart-contract': 'Smart Contract', bridge: 'Bridge', stablecoin: 'Stablecoin / Depeg', lending: 'Lending', lp: 'LP-Position', wallet: 'Wallet / Verwahrung', oracle: 'Oracle', 'defi-protocol': 'DeFi-Protokoll' },
    claims: { created: 'Anspruch {{number}} erstellt ({{status}}). Jetzt einreichen.', createdToast: 'Anspruch {{number}} erstellt' },
    providerUnavailable: 'Anbieter vorübergehend nicht verfügbar', unknown: 'Unbekannt'
  },
  tr: {
    tabs: { dashboard: 'Panel', marketplace: 'Pazar', coverage: 'Teminat', claims: 'Talepler', risk: 'Risk', providers: 'Sağlayıcılar', ariaLabel: 'Koruma bölümleri' },
    common: { confirm: 'Onayla', cancel: 'İptal', close: 'Kapat', done: 'Tamam' },
    shell: {
      brand: 'FBT Koruması', walletStatus: 'Cüzdan/sunucu durumu', apiOffline: 'API çevrimdışı', notConnected: 'Bağlı değil',
      alerts: 'Uyarılar', connectTitle: 'Cüzdanını bağla', connectBody: 'Teklifler gerçek adresle çalışır ve satın almaları sen imzalarsın. FBT anahtarını asla görmez.',
      browserWallet: 'Tarayıcı cüzdanı', walletConnect: 'WalletConnect', inAppWallet: 'Yerleşik cüzdan', manualAddress: 'Adresi elle gir',
      disconnect: 'Bağlantıyı kes', notConnectedYet: 'Henüz bağlı değil', invalidAddress: 'Geçerli bir 0x adresi gir veya cüzdan bağla.',
      injectedConnected: 'Tarayıcı cüzdanı bağlandı', wcConnected: 'WalletConnect bağlandı', connectFailed: 'Cüzdan bağlantısı başarısız',
      useInAppWallet: 'Yerleşik cüzdanını Cüzdan sekmesinden aç ve buraya dön.', wallet: 'Cüzdan', connectedAs: 'Bağlı',
      disconnected: 'Cüzdan bağlantısı kesildi', chooseSigning: 'İmzalama yöntemini seç. Her modda özel anahtar sende kalır.',
      metamask: 'MetaMask / tarayıcı cüzdanı', wcQr: 'WalletConnect (QR / Telegram)', orEnterAddress: 'Ya da adres gir (yalnızca görüntüleme):',
      useAddress: 'Adresi kullan', noAlerts: 'Uyarı yok.', server: 'Sunucu', checking: 'kontrol ediliyor…', serverOnline: 'bağlı · API çevrimiçi', serverOffline: 'çevrimdışı'
    },
    alerts: {
      serverDownTitle: 'Sunucuya ulaşılamıyor', serverDownBody: '/api/insurance erişilemiyor. Canlı teklifler kullanılamıyor.',
      noProviderTitle: 'Sağlayıcı geçici olarak kullanılamıyor', noProviderBody: 'Şu anda doğrulanmış canlı bir koruma sağlayıcısı yapılandırılmamış; yeni teklif ve satın alma mümkün değil. Mevcut teminatlar görünür kalır.',
      sandboxTitle: 'Sandbox ortamı', sandboxBody: 'Sandbox sağlayıcılar test amaçlı simülasyondur. Burada gerçek bir sigorta teklifi yoktur ve FBT hiçbir zaman fon tutmaz.',
      healthTitle: '{{name}} durumu: {{status}}', healthBody: 'Sorun sürerken yeni satın alımlar için önerilmez.',
      noWalletTitle: 'Cüzdan yok', noWalletBody: 'Gerçek adresle teklif almak ve imzalamak için cüzdan bağla.'
    },
    market: {
      title: 'Koruma Pazarı', subtitle: 'Doğrulanmış sağlayıcılar arasında korumayı karşılaştır. Her ücret imzalamadan önce gösterilir, her satın almayı cüzdanın imzalar ve FBT hiçbir zaman fon tutmaz.',
      sandboxOnlyNote: 'Bu ortam yalnızca test için sandbox (simülasyon) sağlayıcılar kullanır — burada gerçek bir sigorta teklifi yoktur.',
      protectionType: 'Koruma türü', chain: 'Zincir', coverageAmount: 'Teminat tutarı (USD)', duration: 'Süre (gün)',
      termsAccept: 'Sağlayıcının şartlarını, eklerini ve yargı yetkisi bildirimini inceledim ve kabul ediyorum.',
      gettingQuotes: 'Teklifler alınıyor…', getQuotes: 'Koruma teklifleri al', needWallet: 'Önce cüzdan adresi ayarla.',
      noEligible: 'Sağlayıcı geçici olarak kullanılamıyor — şu anda uygun koruma yok. Canlı teklif mevcut değil; satın alma mümkün değil.',
      liveQuoteUnavailable: 'Canlı teklif şu anda mevcut değil. Bir sağlayıcı yanıt verene kadar satın alma mümkün değil.',
      compare: 'Sağlayıcıları karşılaştır ({{count}})', health: 'Durum', coverage: 'Teminat', settlement: 'Mutabakat',
      nonCustodial: 'emanetsiz', claimMethod: 'Talep yöntemi', termsHash: 'Şartlar hash’i', reviewBuy: 'İncele & satın al',
      howItWorks: 'Nasıl çalışır, ücretler ve talepler'
    },
    info: {
      walletTitle: 'Cüzdanın, anahtarların', walletBody: 'Kendi cüzdanınla bağlanırsın. FBT özel anahtar veya kurtarma ifadesi almaz, prim tutmaz ve senin adına imza atmaz.',
      flowTitle: 'Satın alma nasıl işler',
      flow1: 'Gerçek ürünler sağlayıcı API’sinden keşfedilir.', flow2: 'Canlı teklif istersin.',
      flow3: 'Sağlayıcılar fiyat, durum, kapasite ve şartlara göre karşılaştırılır.', flow4: 'Gerçek şartları ve ücretleri incelersin.',
      flow5: 'Onaylarsın.', flow6: 'Cüzdanın hazırlanan işlemi imzalar.',
      flow7: 'Blockchain makbuzu bağımsız olarak doğrulanır.', flow8: 'Teminat yalnızca doğrulamadan sonra aktifleşir.',
      riskTitle: 'Risk kriterleri', riskIntro: 'Risk bu girdilerden hesaplanır — asla tahminle değil:',
      risk1: 'Protokol riski', risk2: 'Akıllı sözleşme riski', risk3: 'Zincir riski', risk4: 'Oracle bağımlılığı',
      risk5: 'Köprü bağımlılığı', risk6: 'Varlık riski', risk7: 'Likidite', risk8: 'Yoğunlaşma',
      risk9: 'Sağlayıcı sağlığı', risk10: 'Sağlayıcı kapasitesi', risk11: 'Geçmiş olaylar', risk12: 'Teminat istisnaları',
      feesTitle: 'Ücretler, tam dökümlü', claimsTitle: 'Talepler, dürüstçe yönetilir',
      claim1: 'Hiçbir talep otomatik onaylanmaz.', claim2: 'Gerçek kanıt gerekir.',
      claim3: 'İşlem hash’leri ve bloklar kontrol edilir.', claim4: 'Sağlayıcının gerçek şartları esas alınır.',
      claim5: 'Ödemeler yalnızca bağımsız zincir üstü doğrulamadan sonra kaydedilir.'
    },
    fee: { providerPremium: 'Sağlayıcı primi', fbtFee: 'FBT Pazar Ücreti', fbtFeeShort: 'FBT ücreti', networkFee: 'Ağ ücreti (tahmini)', commission: 'Sağlayıcı komisyonu', total: 'Toplam kullanıcı maliyeti', zero: 'FBT Pazar Ücreti: 0$' },
    source: { label: 'Kaynak', providerApi: 'Sağlayıcı API', updated: 'Güncellendi', freshness: 'Tazelik', live: 'Canlı', cached: 'Önbellek', stale: 'VERİ ESKİMİŞ — YENİLE', unknown: 'Bilinmiyor' },
    quote: {
      confirmTitle: 'Satın alma onaylansın mı?', confirmBody: '${{coverage}} koruma için toplam ${{total}} (tüm ücretler dahil) hazırlıyorsun. Sen imzalayana kadar hiçbir ücret alınmaz.',
      confirmPrepare: 'Onayla & hazırla', preparedToast: 'Satın alma hazırlandı (imzasız). İncele ve etkinleştirmek için imzala.',
      prepareFailed: 'Hazırlama başarısız', unavailable: 'Teklif kullanılamıyor: {{error}}', backToMarket: 'Pazara dön',
      loading: 'Teklif yükleniyor…', title: 'Ödeme',
      subtitle: 'İmzalamadan önce teminatı, her ücreti, şartları ve istisnaları incele. Prim doğrudan sağlayıcıya gider — FBT emanetsiz bir arayüzdür.',
      protection: 'Koruma', days: '{{count}} gün', provider: 'Sağlayıcı', currency: 'Para birimi',
      feeNote: 'Gerçek bir ücret anlaşması olana kadar FBT Pazar Ücreti 0$’dır — ve her zaman imzadan önce gösterilir. Gizli ücret yoktur.',
      coverageBox: 'Bu neyi kapsar',
      coverageExplain: 'Bu sertifika, sağlayıcının gerçek şartlarına göre, kapsanan cüzdan/varlık ve zincir için listelenen {{type}} sömürü riskini korur. Normal piyasa kayıplarını ve istisna olayları kapsamaz. Maksimum ödeme: ${{max}}.',
      exclusions: 'İstisnalar', termsLink: 'Şartlar & metin', annexLink: 'Ek',
      walletConnected: 'Cüzdan {{chain}} üzerinde bağlı.', walletNotConnected: 'Cüzdan BAĞLI DEĞİL — gerçek imza için cüzdan bağla.',
      preparedTitle: 'Hazırlandı (imzasız).', preparedBody: 'Emanetsiz teslim: prim cüzdanından doğrudan sağlayıcı sözleşmesine gider. FBT hiçbir zaman fon tutmaz.',
      coverageId: 'Teminat kimliği', contract: 'Sağlayıcı sözleşmesi', mode: 'Mod', unsigned: 'imzasız',
      liveSignNote: 'Cüzdanın sağlayıcının gerçek işlemini imzalayacak (gerekirse onay, sonra satın alma). Sunucu, teminatı etkinleştirmeden önce zincir üstü makbuzu doğrular.',
      signLive: 'Cüzdanla imzala & yayınla', sendTo: 'Gönderilecek adres', sandboxNote: 'Sandbox: cüzdan imzası için simüle edilmiş prim transferi (yalnızca geliştirme/test).',
      signSandbox: 'İmzala & doğrula (sandbox)', signing: 'İmzalanıyor / doğrulanıyor…', connectToSign: 'Önce cüzdan bağla — satın alma her zaman imzanı gerektirir.',
      signTitle: 'Cüzdanınla imzala', signBodyLive: 'Cüzdanın şimdi sağlayıcı satın alma işlemini imzalayacak. Onaylamadan önce sözleşmeyi ve tutarı cüzdanda kontrol et.',
      openWallet: 'İmzalamak için cüzdanı aç',
      sandboxSignTitle: 'Sandbox imzası', sandboxSignBody: 'Bu, test için simüle edilmiş bir sandbox imzasıdır (yalnızca geliştirme). Zincirde hiçbir satın alma yapılmaz.', sandboxSignGo: 'Yine de simüle et',
      activatedToast: 'Teminat etkinleştirildi', activationFailed: 'Etkinleştirme başarısız',
      doneTitle: 'Teminat etkinleştirildi.', signedBy: 'İmzalayan', txHash: 'İşlem hash’i', viewCoverage: 'Teminatı gör'
    },
    types: { 'smart-contract': 'Akıllı sözleşme', bridge: 'Köprü', stablecoin: 'Stablecoin / depeg', lending: 'Borç verme', lp: 'LP pozisyonu', wallet: 'Cüzdan / emanet', oracle: 'Oracle', 'defi-protocol': 'DeFi protokolü' },
    claims: { created: 'Talep {{number}} oluşturuldu ({{status}}). Şimdi gönder.', createdToast: 'Talep {{number}} oluşturuldu' },
    providerUnavailable: 'Sağlayıcı geçici olarak kullanılamıyor', unknown: 'Bilinmiyor'
  },
  ru: {
    tabs: { dashboard: 'Панель', marketplace: 'Маркетплейс', coverage: 'Покрытие', claims: 'Претензии', risk: 'Риск', providers: 'Провайдеры', ariaLabel: 'Разделы защиты' },
    common: { confirm: 'Подтвердить', cancel: 'Отмена', close: 'Закрыть', done: 'Готово' },
    shell: {
      brand: 'Защита FBT', walletStatus: 'Статус кошелька/сервера', apiOffline: 'API недоступен', notConnected: 'Не подключено',
      alerts: 'Оповещения', connectTitle: 'Подключите кошелёк', connectBody: 'Котировки выполняются на реальный адрес, а покупки подписываете вы. FBT никогда не видит ваш ключ.',
      browserWallet: 'Кошелёк браузера', walletConnect: 'WalletConnect', inAppWallet: 'Встроенный кошелёк', manualAddress: 'Ввести адрес вручную',
      disconnect: 'Отключить', notConnectedYet: 'Ещё не подключено', invalidAddress: 'Введите корректный адрес 0x или подключите кошелёк.',
      injectedConnected: 'Кошелёк браузера подключён', wcConnected: 'WalletConnect подключён', connectFailed: 'Не удалось подключить кошелёк',
      useInAppWallet: 'Разблокируйте встроенный кошелёк во вкладке «Кошелёк» и вернитесь сюда.', wallet: 'Кошелёк', connectedAs: 'Подключено',
      disconnected: 'Кошелёк отключён', chooseSigning: 'Выберите способ подписи. В любом режиме приватный ключ остаётся у вас.',
      metamask: 'MetaMask / кошелёк браузера', wcQr: 'WalletConnect (QR / Telegram)', orEnterAddress: 'Или введите адрес (только просмотр):',
      useAddress: 'Использовать адрес', noAlerts: 'Нет оповещений.', server: 'Сервер', checking: 'проверка…', serverOnline: 'подключено · API онлайн', serverOffline: 'офлайн'
    },
    alerts: {
      serverDownTitle: 'Сервер недоступен', serverDownBody: 'Не удалось подключиться к /api/insurance. Живые котировки недоступны.',
      noProviderTitle: 'Провайдер временно недоступен', noProviderBody: 'Сейчас не настроен ни один проверенный реальный провайдер защиты, поэтому новые котировки и покупки невозможны. Существующие покрытия остаются видимыми.',
      sandboxTitle: 'Песочница', sandboxBody: 'Sandbox-провайдеры — симуляции для тестирования. Здесь нет реальных предложений, и FBT никогда не хранит средства.',
      healthTitle: 'Состояние {{name}}: {{status}}', healthBody: 'Не рекомендуется для новых покупок, пока статус понижен.',
      noWalletTitle: 'Нет кошелька', noWalletBody: 'Подключите кошелёк, чтобы котировать на реальный адрес и подписывать.'
    },
    market: {
      title: 'Маркетплейс защиты', subtitle: 'Сравнивайте защиту между проверенными провайдерами. Все комиссии показываются до подписи, каждую покупку подписывает ваш кошелёк, и FBT никогда не хранит средства.',
      sandboxOnlyNote: 'Эта среда использует sandbox-провайдеров (симуляцию) для тестирования — здесь нет реальных предложений.',
      protectionType: 'Тип защиты', chain: 'Сеть', coverageAmount: 'Сумма покрытия (USD)', duration: 'Срок (дней)',
      termsAccept: 'Я ознакомился с условиями провайдера, приложением и уведомлением о юрисдикции и принимаю их.',
      gettingQuotes: 'Получение котировок…', getQuotes: 'Получить котировки', needWallet: 'Сначала задайте адрес кошелька.',
      noEligible: 'Провайдер временно недоступен — подходящей защиты сейчас нет. Живая котировка недоступна; покупка невозможна.',
      liveQuoteUnavailable: 'Живая котировка сейчас недоступна. Покупка невозможна, пока провайдер не ответит.',
      compare: 'Сравнить провайдеров ({{count}})', health: 'Состояние', coverage: 'Покрытие', settlement: 'Расчёты',
      nonCustodial: 'без опеки', claimMethod: 'Метод претензии', termsHash: 'Хэш условий', reviewBuy: 'Проверить и купить',
      howItWorks: 'Как это работает, комиссии и претензии'
    },
    info: {
      walletTitle: 'Ваш кошелёк — ваши ключи', walletBody: 'Вы подключаетесь собственным кошельком. FBT никогда не получает приватный ключ или seed-фразу, не удерживает премии и не подписывает за вас.',
      flowTitle: 'Как проходит покупка',
      flow1: 'Реальные продукты обнаруживаются через API провайдера.', flow2: 'Вы запрашиваете живую котировку.',
      flow3: 'Провайдеры сравниваются по цене, состоянию, ёмкости и условиям.', flow4: 'Вы изучаете реальные условия и комиссии.',
      flow5: 'Подтверждаете.', flow6: 'Ваш кошелёк подписывает подготовленную транзакцию.',
      flow7: 'Квитанция блокчейна проверяется независимо.', flow8: 'Покрытие активируется только после проверки.',
      riskTitle: 'Критерии риска', riskIntro: 'Риск рассчитывается по этим входным данным — никогда не наугад:',
      risk1: 'Риск протокола', risk2: 'Риск смарт-контракта', risk3: 'Риск сети', risk4: 'Зависимость от оракула',
      risk5: 'Зависимость от мостов', risk6: 'Риск актива', risk7: 'Ликвидность', risk8: 'Концентрация',
      risk9: 'Состояние провайдера', risk10: 'Ёмкость провайдера', risk11: 'Исторические инциденты', risk12: 'Исключения покрытия',
      feesTitle: 'Комиссии, полная детализация', claimsTitle: 'Претензии, честно',
      claim1: 'Претензия никогда не одобряется автоматически.', claim2: 'Требуются реальные доказательства.',
      claim3: 'Проверяются хэши транзакций и блоки.', claim4: 'Основа — реальные условия провайдера.',
      claim5: 'Выплаты фиксируются только после независимой проверки в блокчейне.'
    },
    fee: { providerPremium: 'Премия провайдера', fbtFee: 'Комиссия маркетплейса FBT', fbtFeeShort: 'Комиссия FBT', networkFee: 'Сетевая комиссия (оценка)', commission: 'Комиссия провайдера', total: 'Итоговая стоимость', zero: 'Комиссия маркетплейса FBT: $0' },
    source: { label: 'Источник', providerApi: 'API провайдера', updated: 'Обновлено', freshness: 'Свежесть', live: 'Живые', cached: 'Из кэша', stale: 'ДАННЫЕ УСТАРЕЛИ — ОБНОВИТЕ', unknown: 'Неизвестно' },
    quote: {
      confirmTitle: 'Подтвердить покупку?', confirmBody: 'Вы готовите защиту на ${{coverage}} общей стоимостью ${{total}} (все комиссии включены). Ничего не списывается до вашей подписи.',
      confirmPrepare: 'Подтвердить и подготовить', preparedToast: 'Покупка подготовлена (не подписана). Проверьте и подпишите для активации.',
      prepareFailed: 'Не удалось подготовить', unavailable: 'Котировка недоступна: {{error}}', backToMarket: 'Назад к маркетплейсу',
      loading: 'Загрузка котировки…', title: 'Оплата',
      subtitle: 'Перед подписью проверьте покрытие, каждую комиссию, условия и исключения. Премия идёт напрямую провайдеру — FBT интерфейс без опеки.',
      protection: 'Защита', days: '{{count}} дн.', provider: 'Провайдер', currency: 'Валюта',
      feeNote: 'Комиссия маркетплейса FBT равна $0, пока нет реального соглашения — и всегда отображается до подписи. Скрытых комиссий нет.',
      coverageBox: 'Что покрывается',
      coverageExplain: 'Этот сертификат защищает от указанного риска эксплойта {{type}} для покрываемого кошелька/актива и сети — по реальным условиям провайдера. Обычные рыночные убытки и исключённые события не покрываются. Максимум выплаты: ${{max}}.',
      exclusions: 'Исключения', termsLink: 'Условия и формулировка', annexLink: 'Приложение',
      walletConnected: 'Кошелёк подключён в {{chain}}.', walletNotConnected: 'Кошелёк НЕ подключён — подключите кошелёк для реальной подписи.',
      preparedTitle: 'Подготовлено (не подписано).', preparedBody: 'Передача без опеки: премия идёт из вашего кошелька напрямую в контракт провайдера. FBT никогда не хранит средства.',
      coverageId: 'ID покрытия', contract: 'Контракт провайдера', mode: 'Режим', unsigned: 'не подписана',
      liveSignNote: 'Ваш кошелёк подпишет реальную транзакцию провайдера (одобрение при необходимости, затем покупка). Сервер проверит квитанцию в блокчейне перед активацией покрытия.',
      signLive: 'Подписать кошельком и отправить', sendTo: 'Отправить на', sandboxNote: 'Sandbox: симулированный перевод премии для подписи кошельком (только разработка/тест).',
      signSandbox: 'Подписать и проверить (песочница)', signing: 'Подпись / проверка…', connectToSign: 'Сначала подключите кошелёк — покупка всегда требует вашей подписи.',
      signTitle: 'Подпишите своим кошельком', signBodyLive: 'Ваш кошелёк сейчас подпишет транзакцию покупки провайдера. Проверьте контракт и сумму в кошельке перед подтверждением.',
      openWallet: 'Открыть кошелёк для подписи',
      sandboxSignTitle: 'Песочная подпись', sandboxSignBody: 'Это симулированная подпись песочницы для теста (только разработка). Ничего не покупается в блокчейне.', sandboxSignGo: 'Всё равно симулировать',
      activatedToast: 'Покрытие активировано', activationFailed: 'Ошибка активации',
      doneTitle: 'Покрытие активировано.', signedBy: 'Подписал', txHash: 'Хэш транзакции', viewCoverage: 'Просмотреть покрытие'
    },
    types: { 'smart-contract': 'Смарт-контракт', bridge: 'Мост', stablecoin: 'Стейблкоин / депег', lending: 'Кредитование', lp: 'LP-позиция', wallet: 'Кошелёк / опека', oracle: 'Оракул', 'defi-protocol': 'DeFi-протокол' },
    claims: { created: 'Претензия {{number}} создана ({{status}}). Теперь отправьте её.', createdToast: 'Претензия {{number}} создана' },
    providerUnavailable: 'Провайдер временно недоступен', unknown: 'Неизвестно'
  }
};

const others = ['hi', 'id', 'pt', 'ur', 'zh'];

function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = deepMerge({ ...(target[k] || {}) }, v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

for (const locale of ['en', 'fa', 'ar', 'es', 'fr', 'de', 'tr', 'ru', ...others]) {
  const path = `src/i18n/locales/${locale}.json`;
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const base = JSON.parse(JSON.stringify(en));
  doc.insurance = deepMerge(base, overrides[locale] || {});
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  console.log(`✓ ${locale}: insurance namespace (${Object.keys(doc.insurance).length} groups)`);
}
