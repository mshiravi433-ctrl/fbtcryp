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

export function buildStageAlert({
  stage,
  kind = 'order',
  lang = 'en',
  base = '',
  quote = '',
  rate = '',
  id = 'x'
} = {}) {
  const st = STAGES.includes(stage) ? stage : 'ready';
  const family = kind === 'intent' ? 'intent' : 'order';
  const pack = COPY[family][lang] || COPY[family].en;
  const line = pack[st];
  const style = STAGE_STYLE[st];
  const title = String(line.title).slice(0, 48);
  const body = String(line.body)
    .replace('{base}', String(base).slice(0, 16) || '—')
    .replace('{quote}', String(quote).slice(0, 16) || '—')
    .replace('{rate}', String(rate || '—').slice(0, 24))
    .slice(0, 140);
  const url = family === 'intent' ? style.urlIntent : style.urlOrder;
  return {
    title,
    body,
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
