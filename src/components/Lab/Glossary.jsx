/**
 * Glossary — واژه‌شناسی کریپتو.
 *
 * A searchable list of crypto words with a short, correct Persian definition.
 * "لیکویئد: معنی‌اش چیه؟" is exactly the question this screen answers. The
 * terms are presented simply, in modern card form, and each definition is
 * written to be read by someone new to the market — not by a trader who
 * already knows it.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LabBack, Panel, Notice } from './Shared';

const TERMS = [
  { en: 'Liquidation', fa: 'لیکویید', def: 'بستن اجباری پوزیشن وقتی ضرر از وثیقه بیشتر می‌شود؛ یعنی صرافی دارایی شما را می‌فروشد تا بدهی‌تان را ببندد.' },
  { en: 'ATH (All-Time High)', fa: 'سقف تاریخی', def: 'بالاترین قیمتی که یک دارایی در کل تاریخ خود به آن رسیده است.' },
  { en: 'ATL (All-Time Low)', fa: 'کف تاریخی', def: 'پایین‌ترین قیمتی که یک دارایی در کل تاریخ خود به آن رسیده است.' },
  { en: 'Altcoin', fa: 'آلت‌کوین', def: 'هر کوینی غیر از بیت‌کوین؛ ارزهای رمزنگاری‌شده‌ی جایگزین.' },
  { en: 'Stablecoin', fa: 'استیبل‌کوین', def: 'کوینی که ارزش آن به یک دارایی ثابت (مانند دلار) گره خورده تا نوسان نداشته باشد.' },
  { en: 'DeFi', fa: 'دیفای', def: 'مالی غیرمتمرکز؛ خدمات مالی مثل وام و سواپ بدون بانک و روی بلاک‌چین.' },
  { en: 'DEX', fa: 'صرافی غیرمتمرکز', def: 'صرافی‌ای که بدون واسطه و مستقیماً بین دو کیف‌پول معامله انجام می‌دهد.' },
  { en: 'CEX', fa: 'صرافی متمرکز', def: 'صرافی‌ای که توسط یک شرکت اداره می‌شود و دارایی‌ها را نگهداری می‌کند.' },
  { en: 'Staking', fa: 'استیکینگ', def: 'قفل کردن کوین برای کمک به امنیت شبکه در ازای دریافت سود.' },
  { en: 'Yield', fa: 'بازده', def: 'سودی که از نگه‌داری یا قرض دادن دارایی به دست می‌آید.' },
  { en: 'APY', fa: 'بازده سالانه', def: 'نرخ بازده سالانه‌ی مرکب؛ یعنی سودی که در یک سال روی اصل و سود قبلی محاسبه می‌شود.' },
  { en: 'Gas Fee', fa: 'کارمزد شبکه', def: 'هزینه‌ای که برای پردازش هر تراکنش به شبکه‌ی بلاک‌چین پرداخت می‌شود.' },
  { en: 'Wallet', fa: 'کیف پول', def: 'ابزاری برای نگهداری کلیدهای دارایی و ارسال/دریافت کوین.' },
  { en: 'Private Key', fa: 'کلید خصوصی', def: 'رمز مخفی‌ای که مالکیت دارایی را ثابت می‌کند؛ هرگز به کسی نگویید.' },
  { en: 'Seed Phrase', fa: 'عبارت بازیابی', def: '۱۲ تا ۲۴ کلمه که کیف پول را دوباره می‌سازد؛ مثل کلید اصلی خانه.' },
  { en: 'Blockchain', fa: 'بلاک‌چین', def: 'دفتر کل عمومی و غیرقابل تغییر که همه‌ی تراکنش‌ها را به‌صورت زنجیره ثبت می‌کند.' },
  { en: 'Mining', fa: 'استخراج', def: 'حل مسائل پیچیده برای تأیید تراکنش‌ها و تولید کوین جدید.' },
  { en: 'NFT', fa: 'توکن غیرقابل معاوضه', def: 'کالای دیجیتال یکتا که مالکیت آن روی بلاک‌چین ثبت می‌شود.' },
  { en: 'DAO', fa: 'سازمان غیرمتمرکز', def: 'سازمانی که قوانین و تصمیم‌هایش توسط کد و رأی اعضا اداره می‌شود، نه مدیر.' },
  { en: 'Airdrop', fa: 'ایردراپ', def: 'توزیع رایگان توکن به کاربران برای جذب و تشویق جامعه‌ی پروژه.' },
  { en: 'FOMO', fa: 'فومو', def: 'ترس از جا ماندن؛ خریدن عجولانه به‌خاطر ترس از دست دادن سود.' },
  { en: 'FUD', fa: 'فاد', def: 'ترس، تردید و ناامیدی؛ خبری که برای پایین آوردن قیمت پخش می‌شود.' },
  { en: 'HODL', fa: 'هودل', def: 'نگه‌داشتن دارایی به‌جای فروش، حتی وقتی بازار می‌لرزد.' },
  { en: 'Whale', fa: 'نهنگ', def: 'کاربر یا نهادی که حجم بسیار بزرگی از دارایی را در اختیار دارد.' },
  { en: 'Bull Market', fa: 'بازار صعودی', def: 'بازاری که قیمت‌ها روند رو به رشد و اعتماد بالا دارند.' },
  { en: 'Bear Market', fa: 'بازار نزولی', def: 'بازاری که قیمت‌ها روند نزولی و ترس حاکم است.' },
  { en: 'Market Cap', fa: 'ارزش بازار', def: 'قیمت یک کوین ضرب‌در تعداد کل آن؛ معیاری برای اندازه‌ی پروژه.' },
  { en: 'Token vs Coin', fa: 'توکن در برابر کوین', def: 'کوین روی بلاک‌چین خودش می‌دود؛ توکن روی بلاک‌چین دیگری ساخته می‌شود.' },
  { en: 'Cold Wallet', fa: 'کیف پول سرد', def: 'کیف پول آفلاین مثل دستگاه سخت‌افزاری؛ امن‌ترین حالت نگهداری.' },
  { en: 'Hot Wallet', fa: 'کیف پول گرم', def: 'کیف پول متصل به اینترنت؛ راحت ولی کم‌امن‌تر.' },
  { en: 'Smart Contract', fa: 'قرارداد هوشمند', def: 'برنامه‌ای روی بلاک‌چین که بدون واسطه اجرا و نتیجه را تضمین می‌کند.' },
  { en: 'Layer 2', fa: 'لایه دو', def: 'راهکاری روی بلاک‌چین اصلی که تراکنش‌ها را ارزان‌تر و سریع‌تر پردازش می‌کند.' },
  { en: 'Tokenomics', fa: 'توکنومیکس', def: 'مدل اقتصادی یک توکن: تعداد، توزیع، نرخ انتشار و انگیزه‌ها.' },
  { en: 'Rug Pull', fa: 'راگ‌پول', def: 'حذف نقدینگی یا فرار سازندگان پروژه با پول کاربران؛ نوعی کلاهبرداری.' },
  { en: 'Pump & Dump', fa: 'پامپ و دامپ', def: 'بالا بردن مصنوعی قیمت و فروش حجمی برای سود، که به ضرر خریداران می‌ماند.' },
  { en: 'P2P', fa: 'همتا به همتا', def: 'معامله‌ی مستقیم بین دو شخص بدون واسطه‌ی صرافی.' },
  { en: 'KYC', fa: 'احراز هویت', def: 'فرایند تأیید هویت برای استفاده از خدمات مالی و رعایت قانون.' },
  { en: 'DCA', fa: 'میانگین‌گیری هزینه', def: 'خرید مبلغ ثابت در بازه‌های منظم تا میانگین قیمت خرید آرام شود.' },
  { en: 'Liquidity', fa: 'نقدینگی', def: 'حجم پولی که در بازار یا یک جفت‌ارز برای معامله موجود است.' },
  { en: 'Spread', fa: 'اسپرد', def: 'تفاوت قیمت خرید و فروش؛ هزینه‌ی پنهان در هر معامله.' },
  { en: 'Zk / Zero-Knowledge', fa: 'اثبات دانش صفر', def: 'ثابت کردن درستی یک ادعا بدون لو دادن اطلاعات پشت آن.' },
  { en: 'Bridge', fa: 'پل', def: 'ابزاری برای جابه‌جایی دارایی بین بلاک‌چین‌های مختلف.' },
  { en: 'Oracle', fa: 'اوراکل', def: 'سرویسی که داده‌ی دنیای واقعی را به قراردادهای هوشمند می‌آورد.' },
  { en: 'Slippage', fa: 'اسلیپیج', def: 'اختلاف قیمت لحظه‌ی تأیید تراکنش با قیمت انتظاری شما.' },
  { en: 'Portfolio', fa: 'سبد دارایی', def: 'مجموعه‌ی همه‌ی دارایی‌های شما و درصد هر کدام.' }
];

export default function Glossary({ onBack }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return TERMS;
    return TERMS.filter((term) =>
      term.en.toLowerCase().includes(q) ||
      term.fa.includes(q) ||
      term.def.includes(q)
    );
  }, [q]);

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        title={`📖 ${t('lab2.screens.glossary.title', 'واژه‌شناسی کریپتو')}`}
        sub={t('lab2.screens.glossary.sub', 'معنی واژه‌های پرکاربرد بازار، کوتاه و دقیق')}
      />

      <div className="lab2-glossary-search">
        <input
          className="lab2-glossary-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('lab2.screens.glossary.search', { defaultValue: 'جستجو: مثلاً لیکویید، ATH، کیف پول…' })}
          aria-label={t('lab2.screens.glossary.search', { defaultValue: 'جستجو در واژه‌شناسی' })}
        />
      </div>

      <Panel title={t('lab2.screens.glossary.count', { count: filtered.length, defaultValue: '{{count}} واژه' })}>
        <div className="lab2-glossary-list">
          {filtered.length ? filtered.map((term) => (
            <div className="lab2-glossary-item" key={term.en}>
              <div className="lab2-glossary-term">
                <span className="lab2-glossary-en" dir="ltr">{term.en}</span>
                <span className="lab2-glossary-fa">{term.fa}</span>
              </div>
              <div className="lab2-glossary-def">{term.def}</div>
            </div>
          )) : (
            <div className="lab2-glossary-empty">
              {t('lab2.screens.glossary.empty', { defaultValue: 'چیزی پیدا نشد؛ املای دیگری امتحان کنید.' })}
            </div>
          )}
        </div>
      </Panel>

      <Notice icon="💡">
        {t('lab2.screens.glossary.note', {
          defaultValue: 'این واژه‌ها فقط برای یادگیری‌اند و توصیه‌ی سرمایه‌گذاری نیستند؛ هر قراردادی را پیش از معامله بررسی کنید.'
        })}
      </Notice>
    </div>
  );
}
