/** Read-only reward operations, displayed in-place rather than linking away. */
import { surfaceMessage } from '../chat/osSurface.js';
import { num } from '../../strategyBrain/numeric.js';

const MISSION_FA = { checkin: 'حضور روزانه', swap1: 'یک سواپ', swap5: 'پنج سواپ', bridge1: 'بریج', lend1: 'وام‌دهی', borrow1: 'وام', lp1: 'نقدینگی', dydx1: 'معامله dYdX', futures1: 'فیوچرز', goals1: 'هدف مالی', lab1: 'آزمایشگاه', analysis1: 'تحلیل', share1: 'اشتراک‌گذاری', firstSwapEver: 'اولین سواپ', referralEver: 'دعوت دوستان', streak3: 'سه روز حضور', streak7: 'هفت روز حضور' };
const LEVEL_FA = { bronze: 'برنزی', silver: 'نقره‌ای', gold: 'طلایی', platinum: 'پلاتینی', diamond: 'الماسی' };
const format = (v) => num(v) == null ? '—' : num(v).toLocaleString('en-US');

export async function readOpsRewards(card, { locale = 'fa', services = {}, timeoutMs = 10_000 } = {}) {
  const fa = String(locale).toLowerCase().startsWith('fa');
  const method = { rewards_dashboard: 'summary', rewards_points: 'summary', rewards_missions: 'missions', rewards_referral: 'referral' }[card?.id];
  let result;
  let timer;
  try {
    result = await Promise.race([
      Promise.resolve().then(() => services[method]?.()),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ ok: false, code: 'TIMEOUT' }), timeoutMs); })
    ]);
  } catch { result = { ok: false, code: 'UNAVAILABLE' }; }
  finally { clearTimeout(timer); }
  const lines = [];
  const available = result?.ok === true && !!result.data && typeof result.data === 'object' && !Array.isArray(result.data);
  if (!available) {
    lines.push(fa ? 'اطلاعات پاداش از سرور خوانده نشد؛ موجودی یا امتیاز حدس نمی‌زنم. دوباره تلاش کن.' : 'Reward data could not be read from the server; no points or balance were guessed. Retry.');
  } else {
    const data = result.data;
    if (method === 'summary') {
      lines.push(fa ? `امتیاز ثبت‌شده: ${format(data.points)}` : `Recorded points: ${format(data.points)}`);
      const level = data.level?.current?.id;
      if (level) lines.push(fa ? `سطح: ${LEVEL_FA[level] || 'ثبت‌شده در سرور'}` : `Level: ${level}`);
      if (card.id === 'rewards_dashboard') {
        lines.push(fa ? `دعوت‌های ثبت‌شده: ${format(data.referrals?.total)}` : `Recorded referrals: ${format(data.referrals?.total)}`);
        const missions = data.missions?.today;
        if (Array.isArray(missions)) lines.push(fa ? `مأموریت‌های امروز: ${missions.filter((m) => m.done).length} از ${missions.length} تکمیل شده` : `Today's missions: ${missions.filter((m) => m.done).length} of ${missions.length} completed`);
      }
    }
    if (method === 'missions') {
      const today = Array.isArray(data.today) ? data.today : [];
      if (!today.length) lines.push(fa ? 'سرور مأموریت روزانه‌ای برنگرداند.' : 'No daily mission was returned.');
      for (const row of today.slice(0, 20)) lines.push(`${fa ? MISSION_FA[row.id] || 'مأموریت' : row.id}: ${format(row.progress)} / ${format(row.target)} · ${format(row.pts)} ${fa ? 'امتیاز' : 'points'}${row.done ? ' ✓' : ''}`);
    }
    if (method === 'referral') {
      lines.push(fa ? `کد دعوت: ${data.code || 'هنوز ثبت نشده'}` : `Referral code: ${data.code || 'not registered'}`);
      lines.push(fa ? `اتصال کد تأیید شده: ${data.bound === true ? 'بله' : 'خیر'}` : `Code binding confirmed: ${data.bound === true ? 'yes' : 'no'}`);
      lines.push(fa ? `دعوت‌های ثبت‌شده: ${format(data.total)}` : `Recorded referrals: ${format(data.total)}`);
    }
  }
  lines.push(fa ? 'امتیاز وفاداری، موجودی نقدی یا سود تضمینی نیست؛ این عملیات فقط اطلاعات را می‌خواند.' : 'Loyalty points are not a cash balance or guaranteed profit; this operation only reads data.');
  return surfaceMessage({ kind: 'NOTICE', title: card.title, lines, tone: available ? 'info' : 'warn',
    chips: card.route ? [{ id: 'rewards-page', label: fa ? 'صفحهٔ پاداش‌ها' : 'Rewards page', route: card.route }] : [],
    payload: { readOnly: true, available, fundsMoved: false } });
}
