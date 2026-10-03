/**
 * Three-stage order / intent alerts that render in the OS shade.
 *
 * Stages (same words on auto-orders and Intent OS):
 *   pending — a new position is waiting
 *   ready   — the target was reached; swap is ready
 *   closed  — the position was closed
 *
 * Colours, vibrate patterns and sound keys MUST differ from the daily promo
 * (`fbt-daily`, purple, [40,60,40]) so a price event is not mistaken for
 * marketing. Copy is localised here because the OS shade never runs i18next.
 */

export const STAGES = ['pending', 'ready', 'closed'];

export const STAGE_STYLE = {
  pending: {
    color: '#FFB300',
    sound: 'pending',
    vibrate: [30, 40, 30],
    urlOrder: '/#/orders',
    urlIntent: '/#/intent'
  },
  ready: {
    color: '#00C853',
    sound: 'ready',
    vibrate: [80, 50, 80, 50, 160],
    urlOrder: '/#/orders',
    urlIntent: '/#/swap'
  },
  closed: {
    color: '#FF1744',
    sound: 'closed',
    vibrate: [140, 70, 140],
    urlOrder: '/#/orders',
    urlIntent: '/#/intent'
  }
};

const COPY = {
  order: {
    en: {
      pending: { title: 'Position pending', body: '{base}→{quote} is waiting. We will alert you when the target is hit.' },
      ready: { title: 'Target reached — ready to swap', body: '1 {base} reached {rate} {quote}. Open the app to swap.' },
      closed: { title: 'Position closed', body: '{base}→{quote} is closed.' }
    },
    fa: {
      pending: { title: 'پوزیشن در انتظار', body: '{base}→{quote} ثبت شد و در انتظار است. با رسیدن به هدف خبر می‌دهیم.' },
      ready: { title: 'به نتیجه رسید — آمادهٔ سواپ', body: '۱ {base} به {rate} {quote} رسید. برای سواپ اپ را باز کن.' },
      closed: { title: 'پوزیشن بسته شد', body: '{base}→{quote} بسته شد.' }
    },
    ar: {
      pending: { title: 'مركز في الانتظار', body: '{base}→{quote} بانتظار الهدف.' },
      ready: { title: 'تحقق الهدف — جاهز للمبادلة', body: '1 {base} وصل إلى {rate} {quote}. افتح التطبيق.' },
      closed: { title: 'أُغلق المركز', body: '{base}→{quote} أُغلق.' }
    }
  },
  intent: {
    en: {
      pending: { title: 'Intent pending', body: 'A new intent for {base}→{quote} is waiting.' },
      ready: { title: 'Desired result reached', body: 'The intent for {base}→{quote} is ready to complete.' },
      closed: { title: 'Intent position closed', body: '{base}→{quote} has settled and the position is closed.' }
    },
    fa: {
      pending: { title: 'اینتنت در انتظار', body: 'اینتنت جدید {base}→{quote} در انتظار است.' },
      ready: { title: 'رسیدن به نتیجهٔ دلخواه', body: 'اینتنت {base}→{quote} به نتیجه رسید و آمادهٔ تکمیل است.' },
      closed: { title: 'پوزیشن اینتنت بسته شد', body: '{base}→{quote} تسویه و بسته شد.' }
    },
    ar: {
      pending: { title: 'النية في الانتظار', body: 'نية {base}→{quote} بانتظار التنفيذ.' },
      ready: { title: 'تحقق النتيجة المطلوبة', body: 'النية {base}→{quote} جاهزة للإكمال.' },
      closed: { title: 'أُغلق مركز النية', body: '{base}→{quote} أُغلق.' }
    }
  }
};

/**
 * ─── SCHEDULED ALERTS: «زمان سواپ رسید» IS NOT «به هدف رسید» ────────────────
 * A DCA run and a price target produce the same STAGE («ready») and mean two
 * different things. «۱ BTC به ۶۵٬۰۰۰ دلار رسید» is false for a plan whose run
 * simply came due — the price is wherever it is, and the user was told a
 * number. So the trigger reason gets its own copy in every locale below, and
 * the price line is only used where a price actually decided the alert.
 *
 * The body also says what to DO («اپ را باز کن و سواپ را امضا کن») because a
 * notification that only reports a state leaves the person who tapped it one
 * screen away from an answer.
 */
const SCHEDULE_COPY = {
  fa: { title: 'زمان سواپ رسید', body: 'نوبت بعدی برنامهٔ {base}→{quote} رسید. اپ را باز کن و سواپ را امضا کن.' },
  en: { title: 'Time to swap', body: 'The next step of your {base}→{quote} plan is due. Open the app and sign the swap.' },
  ar: { title: 'حان وقت التبديل', body: 'وصل موعد الخطوة التالية لخطتك {base}→{quote}. افتح التطبيق ووقّع التبديل.' },
  es: { title: 'Hora de cambiar', body: 'Toca el siguiente paso de tu plan {base}→{quote}. Abre la app y firma el swap.' },
  fr: { title: 'C’est l’heure du swap', body: 'La prochaine étape de votre plan {base}→{quote} est due. Ouvrez l’app et signez l’échange.' },
  hi: { title: 'स्वैप का समय', body: 'आपकी {base}→{quote} योजना का अगला चरण आ गया है। ऐप खोलें और स्वैप साइन करें।' },
  id: { title: 'Waktunya swap', body: 'Langkah berikutnya dari rencana {base}→{quote} sudah tiba. Buka aplikasi dan tanda tangani swap.' },
  pt: { title: 'Hora de trocar', body: 'A próxima etapa do seu plano {base}→{quote} chegou. Abra o app e assine a troca.' },
  ru: { title: 'Время обмена', body: 'Подошёл следующий шаг плана {base}→{quote}. Откройте приложение и подпишите обмен.' },
  tr: { title: 'Takas zamanı', body: '{base}→{quote} planınızın sıradaki adımı geldi. Uygulamayı açıp takası imzalayın.' },
  ur: { title: 'سواپ کا وقت', body: 'آپ کے {base}→{quote} پلان کا اگلا مرحلہ آ گیا ہے۔ ایپ کھولیں اور سواپ پر دستخط کریں۔' },
  zh: { title: '该兑换了', body: '你的 {base}→{quote} 计划下一步已到期。打开应用并签名兑换。' }
};

export function buildStageAlert({
  stage,
  kind = 'order',
  lang = 'en',
  base = '',
  quote = '',
  rate = '',
  id = 'x',
  scheduled = false
} = {}) {
  const st = STAGES.includes(stage) ? stage : 'ready';
  const family = kind === 'intent' ? 'intent' : 'order';
  const pack = COPY[family][lang] || COPY[family].en;
  const line = pack[st];
  const style = STAGE_STYLE[st];
  /*
   * A scheduled alert replaces the copy wholesale rather than editing the
   * price sentence, because the two share no words: one reports a LEVEL, the
   * other reports a TIME. Only order/intent `ready` alerts can be scheduled —
   * a pending or closed stage never is.
   */
  const scheduleLine = scheduled && st === 'ready'
    ? (SCHEDULE_COPY[String(lang).split('-')[0]] || SCHEDULE_COPY.en)
    : null;
  const source = scheduleLine
    ? { title: scheduleLine.title, body: scheduleLine.body }
    : line;

  const title = String(source.title).slice(0, 48);
  const body = String(source.body)
    .replace('{base}', String(base).slice(0, 16) || '—')
    .replace('{quote}', String(quote).slice(0, 16) || '—')
    .replace('{rate}', String(rate || '—').slice(0, 24))
    .slice(0, 140);
  const url = family === 'intent' ? style.urlIntent : style.urlOrder;
  return {
    title,
    body,
    scheduled: Boolean(scheduled),
    url,
    tag: `fbt-${family}-${st}-${String(id).slice(0, 40)}`,
    stage: st,
    kind: family,
    color: style.color,
    sound: style.sound,
    vibrate: style.vibrate,
    icon: '/icon-192.png'
  };
}
