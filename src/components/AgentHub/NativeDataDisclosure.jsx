import React from 'react';

/** Public-provider disclosure shown before any native-agent data read. */
export default function NativeDataDisclosure({ agent, fa = false }) {
  if (!agent || !(agent.native === true || agent.source === 'native')) return null;
  const rows = Array.isArray(agent.dataDisclosure) ? agent.dataDisclosure.slice(0, 8) : [];
  const sources = Array.isArray(agent.dataSources) ? agent.dataSources.filter(Boolean).slice(0, 8) : [];
  const localOnly = sources.length === 0;

  return (
    <section className="ah-native-data" data-testid="native-data-disclosure" aria-label={fa ? 'افشای منابع داده' : 'Public data disclosure'}>
      <strong>{fa ? 'منابع داده و اطلاعات ارسالی' : 'Data sources and query fields'}</strong>
      <p className="ah-native-data-lead">
        {localOnly
          ? (fa
            ? 'این ایجنت متن درخواست را داخل FBT به پیش‌نویس محلی تبدیل می‌کند و در این مرحله هیچ سرویس دادهٔ خارجی را صدا نمی‌زند.'
            : 'This agent turns your request into a local draft inside FBT. It makes no third-party data call at this stage.')
          : (fa
            ? 'منطق ایجنت در FBT اجرا می‌شود؛ برای دریافت دادهٔ عمومی، فقط پرس‌وجوی لازم به منابع نام‌برده‌شده می‌رود. این با ارسال متن کامل چت یا دسترسی به کیف‌پول فرق دارد.'
            : 'The agent logic runs inside FBT. To fetch public data, only the necessary query goes to the named sources—not the full chat or wallet access.')}
      </p>
      {rows.length ? (
        <ul>
          {rows.map((row, index) => (
            <li key={`${row.source || 'source'}-${index}`}>
              <b>{row.source || sources[index] || (fa ? 'منبع عمومی' : 'Public source')}</b>
              <span>{(fa ? row.fa : row.en) || (fa
                ? 'پرس‌وجوی عمومی مرتبط با همین درخواست به این منبع فرستاده می‌شود.'
                : 'A public query relevant to this request is sent to this source.')}</span>
            </li>
          ))}
        </ul>
      ) : sources.length ? (
        <ul>
          {sources.map((source) => (
            <li key={source}>
              <b>{source}</b>
              <span>{fa
                ? 'فقط فیلدهای عمومی لازم—مانند نماد/شناسهٔ دارایی، زنجیره، بازهٔ زمانی یا آدرس عمومی—برای پرس‌وجو ارسال می‌شود.'
                : 'Only public query fields—such as asset symbol/ID, chain, time range or a public address—are sent.'}</span>
            </li>
          ))}
        </ul>
      ) : rows.length ? null : (
        <ul>
          <li>
            <b>{fa ? 'گام بعدی' : 'Next step'}</b>
            <span>{fa
              ? 'اگر Bridge/Swap را باز کنید، پیش از قیمت‌گیری رضایت جداگانه نشان می‌دهد چه جزئیاتی به LI.FI می‌رود.'
              : 'If you open Bridge/Swap, a separate consent step will show the exact details sent to LI.FI before requesting a quote.'}</span>
          </li>
        </ul>
      )}
      <p className="ah-native-data-foot">
        {fa
          ? 'هیچ کلید خصوصی، عبارت بازیابی، امضا یا اتصال کیف‌پولی برای این پرس‌وجو لازم نیست.'
          : 'No private key, recovery phrase, signature or wallet connection is needed for these reads.'}
      </p>
    </section>
  );
}
