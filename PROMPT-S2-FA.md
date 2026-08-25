# پرامپت سیزن ۲ — P0 Slice 2: Goal → DCA execution

## زمینه

سِیزن ۱ با یک درِ سبز تمام شده است: **P0 Wealth Hub / Goal Card** در
`docs/P0-SLICE-FA.md` مستند شده و ریاضی هدف در
`src/lib/goalMath.js`، ذخیره‌سازی هدف در `localStorage` و نمایش progress
واقعی در `src/pages/Portfolio.jsx` وجود دارد.

کار بعدی باید تنها ادامهٔ منطقی همان slice باشد:

> **P0 slice 2: Goal → DCA execution**

هدف این سشن وصل کردن Goal Card به یک **draft DCA** و رساندن کاربر به محل
تأیید آن در `/orders` است؛ نه ساختن یک اجرای خودکار مبهم و نه گسترش هم‌زمان
به همهٔ زنجیره‌ها.

---

## هفت قانون غیرقابل‌مذاکره

این قوانین همان قوانین سِیزن قبل‌اند و در این slice نیز بدون استثنا برقرارند:

1. **Non-custodial و approval-only:** کلید خصوصی، seed phrase و دارایی کاربر
   هرگز به سرور نمی‌رود. ساخت draft مجاز است، اما فعال‌سازی DCA فقط پس از
   مشاهدهٔ جزئیات و sign صریح کاربر در `/orders` انجام می‌شود. هیچ scheduler یا
   relayer حق امضای تراکنش به‌جای کاربر را ندارد.
2. **Unavailable صادقانه:** اگر زنجیره/venue برای DCA خودکار پشتیبانی نمی‌شود،
   همان را واضح اعلام کن. برای Solana، dYdX و Ostium fake route، fake quote یا
   دکمه‌ای که وانمود کند کار می‌کند نساز.
3. **عدد بدون منبع ممنوع:** `requiredMonthlyContribution` فقط از
   `goalMath` و ورودی‌های معتبر نمایش داده شود. اگر `null` است، دکمهٔ ساخت DCA
   غایب یا disabled با توضیح روشن باشد؛ PMT را گرد نکن و عدد ساختگی نشان نده.
4. **هیچ عمل مخرب یا ضمنی:** حذف Goal Card نباید DCA فعال را بی‌صدا لغو کند.
   وقتی DCA فعال است، حذف باید دو مرحله‌ای و با توضیح اثر واقعی آن باشد؛
   لغو/توقف DCA عمل جداگانه‌ای در `/orders` است.
5. **سبز جعلی ممنوع:** draft ساخته‌شده «executed»، «active» یا «confirmed»
   نیست. فقط وضعیت واقعی (`draft` / `paused` / `active` / `failed`) نمایش داده
   شود و banner نیز دقیقاً همان وضعیت را بگوید.
6. **رفتار موجود حفظ شود:** تغییرات باید کم‌دامنه، RTL-safe، سازگار با 360px،
   دارای touch target حداقل 44px و دارای رشته‌های i18n حداقل در `fa` و `en`
   باشند. مسیرها و orderهای فعلی نباید شکسته شوند.
7. **قابل‌آزمایش و قابل‌تحویل:** قبل از پایان `npm test` و `npm run build`
   باید سبز باشند. تست‌های pure/wiring برای state transition، عدم نمایش PMT
   نامعتبر، unavailable chain، draft persistence و delete safety اضافه شوند.

---

## اسکوپ اصلی سشن

چهار نقطهٔ لمس باید یک جریان منسجم بسازند:

1. **Goal Card** در `/portfolio` — CTA ساخت برنامهٔ DCA بر اساس هدف و PMT معتبر.
2. **Sheet** — انتخاب/تأیید دارایی، مقدار ماهانه، دوره، chain و نمایش واضح
   وضعیت پشتیبانی؛ بدون امضا و بدون broadcast.
3. **`/orders`** — draft DCA در order store/history قابل مشاهده باشد و banner
   کاربر را برای review و sign هدایت کند.
4. **Progress** — پس از وضعیت واقعی order، Goal Card تا حدی که دادهٔ واقعی
   موجود است وضعیت را نشان دهد؛ progress مالی نباید از یک draft به‌عنوان اجرای
   موفق نتیجه‌گیری کند.

### نقطهٔ برش قطعی در صورت کوتاه بودن سشن

- **A+B، کوچک‌ترین واحد قابل‌لایو:** ساخت و ذخیرهٔ draft DCA به‌صورت `paused`
  + نمایش banner قابل‌کلیک در `/orders` برای review/sign.
- **C+D برای slice بعدی:** مطلع شدن Goal Card از order اجراشده، progress ناشی
  از execution، و edit/delete safety کامل برای DCA فعال.

اگر A+B کامل و تست‌شده شد، به C+D وارد نشو مگر اینکه تمام acceptanceهای A+B
سبز باشند.

---

## قرارداد رفتار

### ساخت draft

- ورودی‌های حداقلی: goal id، source/target asset، chain، PMT معتبر، cadence
  ماهانه و deadline/تعداد اجراها.
- draft باید شناسهٔ پایدار، timestamp، نسخهٔ schema و وضعیت `paused` داشته
  باشد.
- ذخیره‌سازی باید با الگوی order موجود (`src/lib/orders.js`) هماهنگ باشد و
  در refresh از بین نرود.
- ساخت draft به‌تنهایی هیچ تراکنش، approval یا allowance ایجاد نمی‌کند.
- از duplicate draft برای همان goal و همان پارامترها جلوگیری کن یا رفتار
  idempotent و قابل‌فهم ارائه بده.

### sheet

Sheet باید پیش از ساخت draft نشان دهد:

- «این برنامه هنوز فعال نیست»؛
- مبلغ ماهانهٔ واقعی و asset آن؛
- chain و venue؛
- تعداد/زمان اجرا و deadline؛
- اینکه فعال‌سازی بعداً نیازمند sign کاربر در `/orders` است.

اگر wallet فقط Solana دارد، یا chain انتخابی برای automated DCA پشتیبانی
نمی‌شود، متن دقیق و قابل‌فهمی مانند زیر نمایش بده:

> `chain not supported for automated DCA yet`

در این حالت CTA ساخت draft خودکار نباید وانمود کند DCA قابل اجراست. اگر طراحی
اجازهٔ ساخت یک draft صرفاً برای اطلاع‌رسانی می‌دهد، آن draft باید صریحاً
unavailable/paused باشد و هرگز active نشان داده نشود.

### `/orders`

- draft در فهرست orderها با badge `Paused` / `Needs your signature` دیده شود.
- banner باید کاربر را به review همان draft ببرد، نه اینکه success toast جعلی
  بدهد.
- فقط action امضای صریح کاربر می‌تواند وضعیت را به `active` تغییر دهد؛ خطا،
  rejection، timeout و chain mismatch باید به وضعیت و پیام واقعی تبدیل شوند.
- تا پیش از sign هیچ `broadcast`, `approve`, allowance یا API ادعاییِ execution
  نباید رخ دهد.

### Goal Card و حذف

- در slice A+B، Goal Card پس از ساخت فقط باید بگوید «DCA draft ساخته شد و
  منتظر تأیید شماست»؛ از ادعای پیشرفت ناشی از آن خودداری کند.
- اگر DCA `active` است، Remove هدف بلافاصله حذف نکند. ابتدا توضیح بدهد که حذف
  هدف، DCA را لغو نمی‌کند و گزینه‌های جداگانهٔ Cancel DCA و Keep DCA ارائه کند
  یا کاربر را به `/orders` ببرد.
- لغو DCA تنها با تأیید دوم و فقط در order flow انجام شود.

---

## مسیرهای پیاده‌سازی پیشنهادی

پیش از تغییر، این فایل‌ها و قراردادهایشان را بخوان:

- `src/pages/Portfolio.jsx`
- `src/lib/goalMath.js`
- `src/lib/orders.js`
- route/page مربوط به `/orders`
- store/context فعلی orderها
- `src/i18n/locales/fa.json` و `src/i18n/locales/en.json`
- `docs/P0-SLICE-FA.md`

از ساخت abstraction تازه در صورتی که order store موجود نیاز را پوشش می‌دهد
خودداری کن. state machine کوچک و صریح بهتر از چند boolean مبهم است. هر
تغییر schema را version کن و migration یا fallback برای draftهای قدیمی در نظر
بگیر.

---

## acceptance criteria

### A+B — این سشن

- [ ] CTA فقط وقتی PMT عدد معتبر دارد نمایش داده می‌شود.
- [ ] sheet همهٔ جزئیات مؤثر را نشان می‌دهد و هیچ امضایی انجام نمی‌دهد.
- [ ] chainهای پشتیبانی‌نشده صادقانه unavailable هستند؛ fake DCA وجود ندارد.
- [ ] draft با وضعیت `paused` و schema version در order store ذخیره می‌شود.
- [ ] refresh draft را حفظ می‌کند و ساخت دوباره duplicate ناخواسته نمی‌سازد.
- [ ] `/orders` draft را نشان می‌دهد و banner review/sign دارد.
- [ ] قبل از sign هیچ broadcast یا approval اتفاق نمی‌افتد.
- [ ] رشته‌های جدید در `fa` و `en` وجود دارند و wiring test آن‌ها را تأیید می‌کند.
- [ ] `npm test` و `npm run build` سبز هستند.
- [ ] گزارش فارسی تغییرات، محدودیت‌ها و چیزهایی که عمداً انجام نشده‌اند نوشته
      می‌شود.

### C+D — فقط slice بعدی، مگر با اجازهٔ صریح و وقت کافی

- [ ] execution receipt واقعی به Goal Card وصل می‌شود.
- [ ] progress فقط از execution واقعی تغذیه می‌شود.
- [ ] edit/delete/cancel برای DCA فعال با تأییدهای لازم ایمن می‌شود.
- [ ] failure/rejection/partial execution صادقانه در Goal Card و `/orders`
      نمایش داده می‌شود.

---

## خروجی مورد انتظار

در پایان سشن، یا A+B را به‌طور کامل و تست‌شده تحویل بده، یا اگر زمان کافی
نیست در مرز A+B متوقف شو. در هر دو حالت، `git diff`، تست‌ها، build و فایل
گزارش را به‌روشنی ثبت کن. هر قابلیت خارج از این slice، از جمله Solana/dYdX/
Ostium integration واقعی، vault خودکار، scheduler server-side، simulator و
strategy composer، عمداً خارج از scope است.
