# P0 Slice 3 — اجرای DCA، پیشرفت هدف و ایمنی ویرایش

## محدودهٔ انجام‌شده

این برش فقط مدل محلیِ DCA و نمایش آن را تغییر می‌دهد؛ هیچ scheduler، custody یا integration اجرایی جدیدی در سرور اضافه نشده است.

- DCA جدید با وضعیت `paused` ساخته می‌شود. تا عمل صریح «امضا و فعال‌سازی» انجام نشود فعال نیست و `nextRunAt` هم برای آن ساخته نمی‌شود.
- رفتن از DCA به صفحهٔ swap دیگر `runsDone` را خوش‌بینانه جلو نمی‌برد. hand-off یا draft رسید اجرای واقعی نیست.
- مدل `dcaExecution` رسید را فقط با همهٔ این شروط وارد پیشرفت هدف می‌کند: `verified: true`، `verification: verified`، هش تراکنش، مبلغ واقعی مثبت، chain یکسان، `orderId` یکسان و `goalId` یکسان.
- رسید ناقص، رسید متعلق به هدف/سفارش دیگر، یا رسید providerهای unavailable، صفر پیشرفت می‌دهد؛ هیچ عدد جایگزین یا تخمین نمایش داده نمی‌شود.
- کارت Goal با نبود رسید «— هیچ اجرای تأییدشده‌ای نیست» نشان می‌دهد. برای draft paused پیام «در انتظار تأیید شما» و لینک `/orders`، و برای active بدون receipt پیام «فعال، بدون اجرای تأییدشده» نشان داده می‌شود.
- `failed`، `rejected` و `partial` در کارت هدف و ردیف DCA بدون رنگ success ساختگی دیده می‌شوند. در partial فقط `actualUsd` رسید معتبر محاسبه می‌شود.
- DCA به هدف فعلی اختیاری لینک می‌شود. نگه‌داری پیشرفت از receiptهای DCA همان هدف است، نه موجودی کیف‌پول یا مبلغ برنامه‌ریزی‌شده.
- حذف Goal، order را حذف یا cancel نمی‌کند. وقتی DCA فعالِ متصل وجود دارد، هشدار صریح می‌گوید که لغو باید جداگانه در Orders انجام شود.
- cancel دو مرحله دارد: ابتدا review/request و سپس Confirm cancellation. بدون مرحلهٔ دوم status تغییر نمی‌کند.
- Edit یک revision جداگانه و paused می‌سازد (مبلغ، cadence، chain و deadline)، diff را نشان می‌دهد و order فعال قبلی را تغییر نمی‌دهد. revision نیز باید جداگانه امضا شود.

## مرز صداقت

- «verified» در این slice یک receipt معتبرِ محلی است؛ این تغییر، verification شبکه یا broadcast جدید ایجاد نمی‌کند.
- Solana، dYdX و Ostium adapter اجرای DCA ندارند. مدل receipt آن‌ها را execution معتبر نمی‌پذیرد و execution جعلی تولید نمی‌کند.
- statusهای موجود برای orderهای قدیمی حفظ شده‌اند؛ مدل نمایشی DCA `active / completed / failed / rejected / partial / cancelled / paused` را جدا از پیش‌بینی schedule نگه می‌دارد.

## تست و بررسی

- `test/dca-execution-probe.mjs`: draft/sign، receipt معتبر/نامعتبر و هدف اشتباه، partial واقعی، revision بدون mutation، و cancel دو مرحله‌ای را بررسی می‌کند.
- `test/units.mjs` به‌روزرسانی شد: DCA تازه paused است و فقط پس از sign صریح due می‌شود.
- `npm test` ✅
- `npm run build` ✅

## ذخیره‌سازی و rehydration

Goal با یک `id` پایدار در `fbt-wealth-goal-v1` نگه‌داری می‌شود (goalهای قدیمی در خواندن id سازگار دریافت می‌کنند). orderها در `fbt-orders-v1` و receiptها در `fbt-dca-receipts-v1` هستند؛ پس بعد از refresh، ارتباط goal/order و evidence باقی می‌ماند.
