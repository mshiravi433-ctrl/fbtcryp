# قوس A — اجرای واقعی (فازهای ۵۱–۵۷)

> نسخهٔ مفصل قوس A. سند جامع: `phase-51-100-master-prompt.md`.
> در هر session فقط این قوس (یا بخشی از آن) را انجام بده و برای همان یک PR باز کن.

**زمینه:** فازهای ۱ تا ۵۰ کامل و تست‌شده‌اند. اجرای مالی با signer استاب و «رسید صادقانه» کار می‌کرد؛ سقف‌های محصولی ($400k کل / $5k هر تراکنش / ۶۰٪ سود / ۳۰ روز) با هشدار دوستانه اعمال می‌شوند.

## ۵۱. امضای واقعی کیف پول
کیف پولِ متصلِ دست نیست؛ امضاکننده نیست. `src/lib/intent-ai/walletAdapter.js` signer استاب داشت. کیف متصل در `src/context/WalletContext.jsx` باید به مسیر اجرا وصل شود: با کیف متصل، امضا با EIP-1193 واقعی؛ استاب فقط در تست‌ها. `venueHealth` نباید با کیف متصل به‌دروغ `NO_SIGNER`/`NO_PROVIDER` بگوید.

- خروجی: `src/lib/intent-ai/walletRuntime.js` (`describeWalletRuntime`, `signIntentWithWallet`, `resolveExecutionSigner`, `createEip1193Broadcaster`)، `src/components/IntentAIRoute.jsx`، `getWalletRuntime()` در WalletContext.
- قاعده: `stubSignerAllowed()` در هر runtime مرورگری false است.

## ۵۲. نرخ زنده و بازبینی اسلیپیج
فید قیمت، قابلِ اجرا نیست. قبل از صفحهٔ تأیید quote واقعی گرفته و در lockedTerms ثبت شود؛ لحظهٔ تأیید نهایی دوباره چک شود؛ عبور از حد اسلیپیج = اجرا نکن + REAUTHORIZE از مکانیزم Confirmation Gate موجود.

- خروجی: `liveQuote.js` (`fetchExecutionQuote`, `lockQuoteIntoTerms`, `recheckQuoteBeforeExecute`, `effectiveSlippageLimit`).
- کهنه/بی‌منبع/بدون خروجی = honest-unavailable.

## ۵۳. ارسال و رهگیری واقعی
تراکنش امضاشده، اجراشده نیست. broadcast adapter واقعی؛ هش تراکنش در رسید؛ تأیید بلاک‌به‌بلاک؛ وضعیت صادق (pending/submitted/confirmed/failed). رسید COMPLETED هرگز جعل نشود.

- خروجی: `broadcastAdapter.js` (`broadcastSigned`, `trackTransaction`, `receiptStatusFor`, `normalizeTxHash`).

## ۵۴. اجرای Bridge
مسیر سواپ، مسیر بین‌زنجیره‌ای نیست. `BRIDGE_EXECUTE_UNAVAILABLE` فقط وقتی حذف شود که آداپتور واقعی wired باشد؛ bridge بدون تأیید جداگانهٔ scope=bridge اجرا نشود؛ ارسال روی زنجیرهٔ مبدأ ≠ تحویل روی مقصد.

- خروجی: `bridgeExecution.js` + به‌روزرسانی `venueHealth`.

## ۵۵. سپر MEV و اسلیپیج
تراکنش ارسال‌شده، محافظت‌شده نیست. هر تراکنش deadline و حد اسلیپیج صریح و `minAmountOut`؛ عبور از حد = رد نه امید؛ امکان ارسال خصوصی در معماری.

- خروجی: `mevShield.js` (`applyMevShield`, `assertProtected`, `shieldTransaction`) با سقف سخت اسلیپیج.

## ۵۶. تاکسونومی خطا در رسید (باگ شناخته‌شده)
خطای اجرا، جعبهٔ سیاه نیست. رسید همهٔ خطاها را زیر «در دسترس نیست — هیچ مسیر زنده‌ای نیست» می‌ریخت.

۱) رسید دلیل واقعی بگوید (سقف سیاست جلسه: مبلغ/دارایی/شبکه/پروتکل، خطای مجوز، توقف اضطراری، …).
۲) صفحهٔ تأیید علاوه بر سقف‌های محصولی، **سقف سیاست جلسهٔ فعال** را زیر فیلدها نشان دهد و در صورت نقض دکمهٔ تأیید نهایی را قفل کند.

سناریوی بازتولید: سواپ ۱۰۰ دلاری → تغییر مبلغ به ۵۰۰ (زیر سقف محصولی، بالای سقف ۲۰۰ دلاری سیاست L3) → باید پیام «مبلغ از سقف سیاست جلسه بیشتر است» بیاید.

- خروجی: `executionErrorTaxonomy.js` (`sessionPolicyCaps`, `checkSessionPolicy`, `explainExecutionFailure`) + نمایش در `IntentAIPanel.jsx` + کلیدهای `intentAI.receipt.reason.*` و `intentAI.policyLimits.*`.

## ۵۷. DCA زنده
برنامهٔ زمانی، اجرا نیست. تریگر واقعی؛ هر اجرای دوره‌ای فقط با مجوز صریح قبلیِ کران‌دار و بازبینی سیاست در لحظهٔ تریگر؛ اولین نقض = توقف کل برنامه + اطلاع کاربر.

- خروجی: `liveDcaTrigger.js` (`armLiveDcaProgram`, `tickLiveDca`, `stopLiveDca`) + کلیدهای `intentAI.dca.halt.*`.

## تعریف تمام
`npm run build` بدون خطا + `npm test` کامل سبز + یک probe به ازای هر فاز در `test/intent-ai/` و ثبت در `test/run.mjs` → یک PR برای کل قوس.
