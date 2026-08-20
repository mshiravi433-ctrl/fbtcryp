/**
 * Fire a three-stage order/intent alert: local shade + server push.
 * Best-effort. Never throws into a money path.
 */
import { apiBase } from './apiBase.js';
import { playSound, pushIdentity, showLocalNotification, vibrate } from './notify.js';

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
  haptic
} = {}) {
  const st = stage === 'pending' || stage === 'closed' ? stage : 'ready';
  playSound(st);
  vibrate(VIBRATE[st], haptic);

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
          lang: document.documentElement.lang || 'fa'
        })
      });
      return true;
    } catch {
      /* fall through to local */
    }
  }

  showLocalNotification(st, {
    body: `${base}→${quote}`,
    tag: `fbt-${kind}-${st}-${id}`,
    vibrate: VIBRATE[st]
  });
  return false;
}
