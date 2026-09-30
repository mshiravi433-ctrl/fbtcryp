#!/usr/bin/env node
/**
 * The copy that changed with the redesign, not with a new feature.
 *
 * Two of these are corrections rather than additions. The old text described
 * behaviour that no longer exists: it told a user whose pair is not listed to
 * pick another pair «از نوار پایین» — a bar this page does not have — and it
 * named an outbound venue as the alternative route, which is precisely the
 * dead end the redesign removed. Shipping a stale sentence next to a new
 * button is how a user ends up tapping something the screen never promised.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SET = {
  /* A pair this app cannot execute. No other venue, no referral, no tab. */
  'perp.terminal.err.MARKET_NOT_LISTED': {
    en: 'This pair is not open for trading in this app yet. Nothing was sent, and no funds moved — pick another pair from the list.',
    fa: 'معامله‌ی این جفت توکن هنوز در این اپ باز نشده است. هیچ چیزی ارسال نشد و هیچ دارایی‌ای جابه‌جا نشد — جفت دیگری را از فهرست انتخاب کن.',
    ar: 'هذه الزوج غير متاحرة للتداول في هذا التطبيق بعد. لم يُرسل شيء ولم تتحرك أي أصول — اختر زوجًا آخر من القائمة.',
    tr: 'Bu çift bu uygulamada henüz işleme açık değil. Hiçbir şey gönderilmedi ve varlık hareket etmedi — listeden başka bir çift seçin.',
    es: 'Este par aún no está disponible para operar en esta app. No se envió nada ni se movieron fondos: elige otro par de la lista.',
    fr: 'Cette paire n’est pas encore ouverte au trading dans cette application. Rien n’a été envoyé, aucun fonds n’a bougé : choisissez une autre paire dans la liste.',
    ru: 'Эта пара пока не доступна для торговли в приложении. Ничего не отправлено, средства не двинулись — выберите другую пару из списка.',
    zh: '该交易对尚未在本应用开放交易。未发送任何内容，也没有任何资金变动 — 请从列表中另选一个交易对。',
    pt: 'Este par ainda não está aberto para negociação neste app. Nada foi enviado e nenhum fundo foi movimentado — escolha outro par na lista.',
    id: 'Pasangan ini belum dibuka untuk diperdagangkan di app ini. Tidak ada yang dikirim dan tidak ada dana yang berpindah — pilih pasangan lain dari daftar.',
    hi: 'यह जोड़ी इस ऐप में अभी तक व्यापार के लिए खुली नहीं है। कुछ भी नहीं भेजा गया और कोई धन नहीं हिला — सूची से कोई दूसरा जोड़ी चुनें।',
    ur: 'یہ جوڑی ابھی اس ایپ میں تجارت کے لیے کھلی نہیں ہے۔ کچھ بھی نہیں بھیجا گیا اور کوئی رقم منتقل نہیں ہوئی — فہرست سے کوئی دوسرا جوڑی منتخب کریں۔'
  },
  /* The review sheet's route line, when the pair has no in-app market. */
  'perp.terminal.route.notListed': {
    en: 'This pair has no market in this app, so it cannot be traded here. Nothing leaves your wallet.',
    fa: 'این جفت توکن در این اپ بازار ندارد، پس اینجا قابل معامله نیست. هیچ چیزی از کیف پول شما خارج نمی‌شود.',
    ar: 'لا يوجد سوق لهذه الزوج في هذا التطبيق، لذا لا يمكن تداولها هنا. لا يخرج شيء من محفظتك.',
    tr: 'Bu çiftin bu uygulamada piyasası yok, dolayısıyla burada işlem görülemez. Cüzdanınızdan hiçbir şey çıkmaz.',
    es: 'Este par no tiene mercado en esta app, así que no se puede operar aquí. No sale nada de tu wallet.',
    fr: 'Cette paire n’a pas de marché dans cette application : elle ne peut pas être négociée ici. Rien ne quitte votre portefeuille.',
    ru: 'Для этой пары нет рынка в приложении, поэтому торговать ей здесь нельзя. Из кошелька ничего не выходит.',
    zh: '该交易对在本应用没有市场，因此无法在此交易。您的钱包不会有任何资产流出。',
    pt: 'Este par não tem mercado neste app, então não pode ser negociado aqui. Nada sai da sua carteira.',
    id: 'Pasangan ini tidak punya pasar di app ini, jadi tidak bisa diperdagangkan di sini. Tidak ada yang keluar dari wallet Anda.',
    hi: 'इस जोड़ी का इस ऐप में बाज़ार नहीं है, इसलिए यहाँ इसे व्यापार नहीं किया जा सकता। आपके वॉलेट से कुछ भी बाहर नहीं जाता।',
    ur: 'اس جوڑی کا اس ایپ میں بازار نہیں، اس لی� یہاں اس کی تجارت نہیں ہو سکتی۔ آپ کے والیٹ سے کچھ بھی باہر نہیں جاتا۔'
  }
};

for (const lang of ['en', 'fa', 'ar', 'tr', 'es', 'fr', 'ru', 'zh', 'pt', 'id', 'hi', 'ur']) {
  const path = `src/i18n/locales/${lang}.json`;
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  for (const [dotted, values] of Object.entries(SET)) {
    const parts = dotted.split('.');
    let node = doc;
    for (const p of parts.slice(0, -1)) node = (node[p] ??= {});
    node[parts.at(-1)] = values[lang] ?? values.en;
  }
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
}
console.log(`updated ${Object.keys(SET).length} keys across 12 locales`);
