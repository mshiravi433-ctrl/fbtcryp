// Short, cautious interpretations, not trading signals. The teacher receives the
// same explanation and the current practice-chart state as context.
export const teachingCopy = {
  fa: {
    insight: 'راهنمای ابزار', teacher: 'معلم هوش مصنوعی', teacherSub: 'درباره همین نمودار تمرینی سؤال بپرسید.', placeholder: 'مثلاً RSI چه چیزی را نشان می‌دهد؟', send: 'بپرس', wait: 'در حال پاسخ…', ai: 'پاسخ هوش مصنوعی', rules: 'پاسخ موتور قاعده‌محور، نه مدل هوش مصنوعی', unavailable: 'پاسخ در دسترس نیست', error: 'معلم فعلاً در دسترس نیست. لطفاً دوباره تلاش کنید.', context: 'این نمودار داده ساختگی و صرفاً آموزشی دارد. به فارسی آموزش بده، توصیه خرید و فروش نکن و عدم قطعیت را توضیح بده.',
    lessons: {
      candles: 'هر کندل قیمت آغاز، پایان، بیشینه و کمینه یک بازه را نشان می‌دهد. سبز یعنی پایان بالاتر از آغاز و قرمز برعکس؛ این به‌تنهایی سود یا ضرر معامله شما نیست.',
      line: 'خط، قیمت پایانی هر بازه را به هم وصل می‌کند و روند گذشته را ساده‌تر نشان می‌دهد؛ نوسان داخل هر بازه دیده نمی‌شود.',
      area: 'نمودار ناحیه‌ای همان قیمت‌های پایانی را با سطح رنگی نمایش می‌دهد؛ رنگ زیر خط پیش‌بینی آینده نیست.',
      range: 'بازه زمانی مقدار تاریخچه و مدت هر کندل را تغییر می‌دهد. نمودار از چپ به راست از گذشته به جدیدترین داده می‌رود؛ آینده هنوز معلوم نیست.',
      ma7: 'MA7 میانگین ساده ۷ کندل است. خط سریع‌تر به تغییر قیمت واکنش می‌دهد؛ عبور قیمت از آن تضمین سود یا تغییر روند نیست.',
      ma25: 'MA25 میانگین ساده ۲۵ کندل است و نویز کوتاه‌مدت را کم می‌کند. بالا یا پایین بودن قیمت نسبت به آن فقط یک نشانه احتمالی است.',
      ma99: 'MA99 میانگین ساده ۹۹ کندل است و روند بلندتر را هموار می‌کند. برای نمایش به تاریخچه کافی نیاز دارد و از قیمت عقب می‌ماند.',
      ema21: 'EMA21 میانگین نمایی ۲۱ کندل است؛ به قیمت‌های اخیر وزن بیشتری می‌دهد. تغییر جهت آن به تنهایی سیگنال قطعی نیست.',
      ema55: 'EMA55 میانگین نمایی ۵۵ کندل است و معمولاً از EMA21 کندتر حرکت می‌کند. فاصله یا تقاطع خطوط می‌تواند تغییر مومنتوم را نشان دهد، نه سود تضمینی.',
      bb: 'باند بولینگر محدوده‌ای پیرامون میانگین را بر اساس نوسان نشان می‌دهد. فشردگی یعنی نوسان کمتر؛ برخورد به باند لزوماً برگشت قیمت نیست.',
      fib: 'سطوح فیبوناچی نسبت‌هایی از فاصله سقف تا کف بازه‌اند. ممکن است نواحی واکنش باشند، اما حمایت و مقاومت قطعی نیستند.',
      volume: 'میله‌های حجم فعالیت هر بازه را نشان می‌دهند. حجم بالا می‌تواند اهمیت حرکت را بیشتر کند، اما جهت بعدی یا سود را تضمین نمی‌کند.',
      rsi: 'RSI قدرت حرکت را از ۰ تا ۱۰۰ می‌سنجد. بالای ۷۰ یا زیر ۳۰ می‌تواند نشانه شرایط افراطی باشد؛ قیمت ممکن است همچنان در همان جهت حرکت کند.',
      macd: 'MACD اختلاف میانگین‌های نمایی و خط سیگنال را نشان می‌دهد. تقاطع‌ها می‌توانند تغییر مومنتوم را نشان دهند اما با تأخیر و خطا همراه‌اند.',
      log: 'مقیاس لگاریتمی فاصله‌های برابر را به تغییرات درصدی برابر اختصاص می‌دهد؛ قیمت‌ها و سود واقعی تغییر نمی‌کنند.',
      grid: 'شبکه خطوط راهنما را روشن یا خاموش می‌کند تا خواندن زمان و قیمت آسان‌تر شود؛ روی داده اثری ندارد.',
      priceLine: 'خط قیمت، آخرین قیمت نمونه را روی محور مشخص می‌کند؛ نقطه ورود یا هدف معامله نیست.',
      zoom: 'بزرگ‌نمایی کندل‌های اخیر را با جزئیات بیشتر نشان می‌دهد و بخشی از گذشته را از قاب خارج می‌کند.',
      fit: 'نمای کامل بازه انتخاب‌شده را بازمی‌گرداند؛ داده جدید یا پیش‌بینی نمی‌سازد.',
      reset: 'تنظیمات نمودار تمرینی به حالت اولیه بازگشت. داده‌ها ساختگی‌اند و بر دارایی واقعی اثری ندارند.'
    }
  },
  en: {
    insight: 'TOOL GUIDE', teacher: 'AI teacher', teacherSub: 'Ask a question about this practice chart.', placeholder: 'For example, what does RSI show?', send: 'Ask', wait: 'Thinking…', ai: 'AI response', rules: 'Rule-based response, not an AI model', unavailable: 'Answer unavailable', error: 'The teacher is unavailable right now. Please try again.', context: 'This chart uses fictional practice data. Teach chart reading, do not recommend trades, and explain uncertainty.',
    lessons: {
      candles: 'Each candle shows open, close, high and low for a period. Green means close above open, red the opposite; neither alone is your trade profit or loss.',
      line: 'The line connects closing prices, simplifying past price action but hiding movement within each period.',
      area: 'The area chart fills below the closing-price line. The shaded area is not a forecast.',
      range: 'The range changes the amount of history and candle duration. Time runs from older data on the left to the latest on the right; the future is unknown.',
      ma7: 'MA7 is the simple average of 7 candles. It reacts quickly; a price crossing is not a guarantee of profit or a trend change.',
      ma25: 'MA25 averages 25 candles and smooths short-term noise. Price above or below it is only a possible clue.',
      ma99: 'MA99 averages 99 candles to smooth a longer trend. It needs enough history and lags price.',
      ema21: 'EMA21 weights recent prices more heavily over 21 candles. A turn alone is not a reliable signal.',
      ema55: 'EMA55 is a slower exponential average. Its distance or crossing with EMA21 can suggest momentum changes, not guaranteed profit.',
      bb: 'Bollinger bands show a volatility-based envelope around an average. Narrow bands mean lower volatility; touching a band does not guarantee reversal.',
      fib: 'Fibonacci levels divide the distance between the visible high and low. They are potential reaction zones, not guaranteed support or resistance.',
      volume: 'Volume bars show activity in each period. High volume may give a move context, but does not guarantee direction or profit.',
      rsi: 'RSI measures momentum from 0 to 100. Above 70 or below 30 can indicate extremes, but price can continue in the same direction.',
      macd: 'MACD compares exponential averages with a signal line. Crossings can suggest momentum changes, but may lag or be false.',
      log: 'A logarithmic scale gives equal distances to equal percentage changes. It does not change the prices or actual profit.',
      grid: 'Grid toggles visual guides for reading price and time; it does not change the data.',
      priceLine: 'The price line marks the latest practice price, not a trade entry or target.',
      zoom: 'Zoom shows recent candles in greater detail while moving some history outside the view.',
      fit: 'Fit restores the selected range; it does not create new data or a forecast.',
      reset: 'The practice chart has returned to its initial settings. Its fictional data does not affect real assets.'
    }
  }
};
