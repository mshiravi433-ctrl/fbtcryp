/**
 * Fire a three-stage order/intent alert: local shade + server push.
 * Best-effort. Never throws into a money path.
 */
import { apiBase } from './apiBase.js';
import { playToneSound, pushIdentity, showLocalNotification, vibrate } from './notify.js';
import { formatValue, kickerFor, progressFrom, resolveTone, toneSpec, vibrateForTone } from './notificationDesign.js';

const VIBRATE = {
  pending: [30, 40, 30],
  ready: [80, 50, 80, 50, 160],
  closed: [140, 70, 140]
};

export async function dispatchStageAlert({
  stage,
  kind = 'order',
  base = '',
  quote = '',
  rate = '',
  id = 'x',
  haptic,
  minAmountOut = null,
  quoteOut = null,
  /* Presentation the caller may know better than the server does: a signed
     P&L, which side of a bracket fired, how far through a plan this is. All
     optional — the design system falls back to the stage's tone. */
  pnlPct = null,
  side = null,
  tone = null,
  progress = null,
  rung = null,
  ofRungs = null
} = {}) {
  const st = stage === 'pending' || stage === 'closed' ? stage : 'ready';
  /*
   * LEVEL 2: the quotation figures travel with the alert so the notification
   * can say what was checked. They are optional; a stage without a quotation
   * simply omits them.
   */
  const hasQuote = Number.isFinite(Number(quoteOut)) && Number.isFinite(Number(minAmountOut));
  const quoteBody = hasQuote ? ` · ${Number(quoteOut)} ≥ ${Number(minAmountOut)}` : '';

  /*
   * ONE TONE, THREE SURFACES.
   *
   * The chime, the buzz, the card in the app and the payload sent to the server
   * are all keyed off the same resolved tone — so a bracket that hits its
   * take-profit sounds like money made, shows mint, and lands mint in the shade,
   * while the same bracket hitting its stop-loss does all four in crimson. That
   * equality is the whole point: the user learns one colour language and it
   * holds everywhere.
   */
  const resolved = resolveTone({ tone, stage: st, side, pnlPct, scheduled: false });
  const spec = toneSpec(resolved);
  playToneSound(resolved);
  vibrate(vibrateForTone(resolved) || VIBRATE[st], haptic);

  const identity = await pushIdentity().catch(() => null);
  if (identity?.endpoint) {
    try {
      await fetch(`${apiBase()}/push/event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint: identity.endpoint,
          stage: st,
          kind,
          base,
          quote,
          rate: rate == null ? '' : String(rate),
          id,
          /* Presentation only — bounded and clamped server-side. They make the
             shade's artwork carry the right colour, number and rail; they can
             never change the copy, the destination or the amount. */
          tone: resolved,
          side: side || null,
          pnlPct: Number.isFinite(Number(pnlPct)) ? Number(pnlPct) : null,
          progress: progressFrom({ progress, rung, ofRungs }),
          rung: rung == null ? null : Number(rung),
          ofRungs: ofRungs == null ? null : Number(ofRungs),
          ...(hasQuote ? { minAmountOut: String(minAmountOut), quoteOut: String(quoteOut) } : {}),
          lang: document.documentElement.lang || 'fa'
        })
      });
      return true;
    } catch {
      /* fall through to local */
    }
  }

  const orderId = id == null ? '' : String(id);
  const readyOrderId = kind !== 'intent' && st === 'ready' && orderId.trim() !== '' && orderId !== 'x'
    ? orderId
    : null;
  const url = kind === 'intent'
    ? st === 'ready' ? '/#/swap' : '/#/intent'
    : readyOrderId !== null
      ? `/#/orders?execute=${encodeURIComponent(readyOrderId)}`
      : '/#/orders';
  /*
   * The local card. The TAG no longer carries the stage: pending → ready →
   * closed is ONE notification that updates, which is what «نوتیفیکیشن تا اتمام
   * و به نتیجه رسیدن» means on a phone that will otherwise stack three rows.
   */
  showLocalNotification(st, {
    body: `${base}→${quote}${quoteBody}`,
    tag: `fbt-${kind}-${String(id == null ? 'x' : id).slice(0, 40)}`,
    data: { url },
    vibrate: spec.vibrate,
    tone: resolved,
    stage: st,
    value: formatValue({ pnlPct, rate }),
    label: `${base} > ${quote}`,
    kicker: kickerFor({ tone: resolved, stage: st, kind }),
    progress: progressFrom({ progress, rung, ofRungs })
  });
  return false;
}
