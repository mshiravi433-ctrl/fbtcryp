/**
 * Three-stage order / intent alerts that render in the OS shade.
 *
 * Stages (same words on auto-orders and Intent OS):
 *   pending — a new position is waiting
 *   ready   — the target was reached; swap is ready
 *   closed  — the position was closed
 *
 * ─── COLOUR, SOUND AND HAPTICS COME FROM src/lib/notificationDesign.js ──────
 * This module used to own the palette, `server/push.js` owned the web payload
 * and `server/fcm.js` owned the Android payload, so the three drifted apart:
 * a colour changed here reached the shade only if the other two re-read it. The
 * stage table below is now a thin ALIAS over the one design system, so there is
 * exactly one place a tone is defined and the artwork, the icon tint, the
 * channel and the in-app bar all agree by construction.
 *
 * The tone is also what makes the card's background follow the money: a
 * take-profit or a positive P&L resolves to `profit` (mint), a stop-loss or a
 * negative P&L resolves to `loss` (crimson).
 */

import {
  STAGE_TONE,
  resolveTone,
  toneSpec,
  VIBRATE,
  kickerFor,
  formatValue,
  progressFrom
} from '../src/lib/notificationDesign.js';

export const STAGES = ['pending', 'ready', 'closed'];

const stageTone = (stage) => STAGE_TONE[stage] || 'ready';

/** The stage → presentation table, derived — never re-typed. */
export const STAGE_STYLE = {
  pending: {
    color: toneSpec('pending').accent,
    sound: 'pending',
    vibrate: VIBRATE.pending,
    urlOrder: '/#/orders',
    urlIntent: '/#/intent'
  },
  ready: {
    color: toneSpec('ready').accent,
    sound: 'ready',
    vibrate: VIBRATE.ready,
    urlOrder: '/#/orders',
    urlIntent: '/#/swap'
  },
  closed: {
    color: toneSpec('info').accent,
    sound: 'closed',
    vibrate: VIBRATE.info,
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
/*
 * A KEEPER FILL — the network executed the limit order, and we are only
 * reporting it. The copy says what happened and nothing more: no profit claim,
 * no amount, and no «you sold» wording that could be read as a fee or a
 * guarantee. Filled at the minimum the user set, which is the only thing the
 * server can truthfully say.
 */
const FILLED_COPY = {
  fa: { title: 'سفارش حد پر شد', body: 'سفارش حد شما با موفقیت در قیمت هدف پر شد.' },
  en: { title: 'Limit order filled', body: 'Your limit order was filled at the target price.' },
  ar: { title: 'تم تنفيذ أمر الحد', body: 'تم تنفيذ أمر الحد الخاص بك بنجاح عند السعر المستهدف.' }
};

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
  scheduled = false,
  filled = false,
  /* Everything below is optional and only sharpens the card: a signed P&L, the
     bracket side that fired, an explicit tone, and the progress inputs. */
  tone = null,
  pnlPct = null,
  side = null,
  progress = null,
  rung = null,
  ofRungs = null,
  runsLeft = null,
  totalRuns = null
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
  /* A keeper fill is a «closed» stage with its own sentence: the generic
     «position closed» line would tell the user nothing they can act on. */
  const fillLine = filled && st === 'closed' && family === 'order'
    ? (FILLED_COPY[String(lang).split('-')[0]] || FILLED_COPY.en)
    : null;
  const source = scheduleLine
    ? { title: scheduleLine.title, body: scheduleLine.body }
    : fillLine ?? line;

  const title = String(source.title).slice(0, 48);
  const body = String(source.body)
    .replace('{base}', String(base).slice(0, 16) || '—')
    .replace('{quote}', String(quote).slice(0, 16) || '—')
    .replace('{rate}', String(rate || '—').slice(0, 24))
    .slice(0, 140);
  const orderId = id == null ? '' : String(id);
  const readyOrderId = family === 'order' && st === 'ready' && orderId.trim() !== '' && orderId !== 'x'
    ? orderId
    : null;
  const url = family === 'intent'
    ? style.urlIntent
    : readyOrderId !== null
      ? `/#/orders?execute=${encodeURIComponent(readyOrderId)}`
      : style.urlOrder;
  /*
   * ─── THE TONE: WHAT THE CARD'S COLOUR MEANS ─────────────────────────────
   * `side` comes from the watcher (takeProfit / stopLoss) and `pnlPct` from any
   * caller that knows the outcome. `resolveTone` applies the authority order
   * (explicit tone → P&L → side → stage), so a bracket that hits its stop is
   * crimson and the same bracket hitting its target is mint, from the same two
   * lines of code.
   */
  const resolvedTone = resolveTone({
    tone,
    stage: st,
    side,
    pnlPct,
    /* A keeper fill is money that actually moved, so it is `profit` news even
       though its stage is `closed` — `scheduled` keeps a DCA run from claiming
       a price it never checked. */
    ...(filled && st === 'closed' && Number(pnlPct) === 0 ? { tone: 'profit' } : {})
  });
  const spec = toneSpec(resolvedTone);

  /*
   * ONE CARD PER ORDER, NOT ONE PER STAGE.
   *
   * The tag used to carry the stage (`fbt-order-ready-<id>`), so `pending`,
   * `ready` and `closed` produced THREE separate rows in the shade — the exact
   * opposite of «نوتیفیکیشن تا اتمام و به نتیجه رسیدن باید باشد». With the id
   * only, Android and Chrome REPLACE the row in place, so the user watches one
   * card move from «در انتظار» to «آماده» to «بسته شد» and, at the end, the
   * single row that is left is the truthful final state.
   *
   * The tag is also the de-duplication key between the web and FCM transports,
   * which is why it is derived from the family and the id and nothing else.
   */
  const tag = `fbt-${family}-${String(id == null ? 'x' : id).slice(0, 40)}`;

  const pairLabel = base || quote
    ? `${String(base || '—').slice(0, 12)} > ${String(quote || '—').slice(0, 12)}`
    : family === 'intent' ? 'INTENT' : 'FBT SWAP';

  return {
    title,
    body,
    scheduled: Boolean(scheduled),
    filled: Boolean(fillLine),
    url,
    tag,
    stage: st,
    kind: family,
    /* The design system's decisions, in the payload the transports read. */
    tone: resolvedTone,
    color: spec.accent,
    sound: style.sound,
    vibrate: spec.vibrate || style.vibrate,
    icon: '/notification/icon-color-192.png',
    /* What the artwork shows: the number, the pair, the kind of event and (when
       the caller knows it) how far through the plan this card is. */
    value: formatValue({ pnlPct, rate }),
    label: pairLabel,
    kicker: kickerFor({ tone: resolvedTone, stage: st, kind: family, scheduled }),
    progress: progressFrom({ progress, rung, ofRungs, runsLeft, totalRuns }),
    /* The sentence the OS reads out on a headset, and the line a lock-screen
       shows before the artwork loads. */
    ticker: title
  };
}
