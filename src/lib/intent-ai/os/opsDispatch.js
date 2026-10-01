/** Single dispatch contract for Operations Center. Analysis/quotes do work in
 * chat; only an explicit venue action or the separate page button navigates. */
import { opsCardPrompt } from './opsCardPrompts.js';
import { OPERATIONS } from './opsCatalog.js';

export function resolveOpsAction(card, locale = 'fa') {
  // Resolve behaviour by catalog id, never by translated UI text or a caller's
  // overridden action/route. Localization can only change presentation.
  const source = OPERATIONS.find((c) => c.id === card?.id);
  if (!source) return { kind: 'unavailable', reason: 'UNKNOWN_OPERATION' };
  if (source.action === 'unavailable') return { kind: 'unavailable', reason: 'UNAVAILABLE' };
  if (['strategy_build', 'goals_create', 'goals_profit', 'goals_forecast', 'goals_whatif'].includes(source.id)) return { kind: 'intake', formId: 'STRATEGY_GOAL' };
  if (source.id === 'monitor_list') return { kind: 'history', tab: 'monitoring' };
  if (source.id === 'wallet_transactions') return { kind: 'history', tab: 'operations' };
  if (source.category === 'rewards') return { kind: 'rewards', operationId: source.id };
  if (source.action === 'monitor') return { kind: 'monitor', initial: {
    metric: source.id === 'auto_condition' ? 'PERCENT_CHANGE' : 'PRICE',
    // Deliberately no threshold/amount seed: those are the user's decisions.
    intervalMinutes: 60
  } };
  if (source.action === 'order') {
    if (['auto_recurring', 'auto_scheduled'].includes(source.id)) return { kind: 'chat', prompt: opsCardPrompt(source, locale) };
    return { kind: 'order' };
  }
  if (source.action === 'opportunity') return { kind: 'opportunity' };
  if (['read', 'quote'].includes(source.action)) {
    const prompt = opsCardPrompt(source, locale);
    return prompt ? { kind: 'chat', prompt } : { kind: 'unavailable', reason: 'PROMPT_REQUIRED' };
  }
  if (source.action === 'history') return { kind: 'history', tab: 'operations' };
  if (source.action === 'navigate' && source.route) return { kind: 'venue', route: source.route };
  return { kind: 'unavailable', reason: 'ACTION_NOT_WIRED' };
}

export function opsActionLabel(card, locale = 'fa') {
  const action = resolveOpsAction(card, locale);
  const fa = String(locale).toLowerCase().startsWith('fa');
  const ar = String(locale).toLowerCase().startsWith('ar');
  const labels = {
    chat: { fa: 'انجام در چت', en: 'Run in chat', ar: 'تنفيذ في الدردشة' },
    intake: { fa: 'ساخت پلن', en: 'Build a plan', ar: 'إنشاء خطة' },
    monitor: { fa: 'ساخت پایش', en: 'Create monitor', ar: 'إنشاء مراقبة' },
    order: { fa: 'تنظیم سفارش', en: 'Prepare order', ar: 'إعداد أمر' },
    opportunity: { fa: 'اسکن زنده', en: 'Live scan', ar: 'مسح حي' },
    history: { fa: 'مشاهدهٔ سوابق', en: 'Read history', ar: 'عرض السجل' },
    rewards: { fa: 'خواندن اطلاعات', en: 'Read data', ar: 'قراءة البيانات' },
    venue: { fa: 'آماده‌سازی در صفحهٔ اجرا', en: 'Prepare at venue', ar: 'إعداد في صفحة التنفيذ' },
    unavailable: { fa: 'در دسترس نیست', en: 'Unavailable', ar: 'غير متاح' }
  };
  return labels[action.kind]?.[fa ? 'fa' : ar ? 'ar' : 'en'] || action.kind;
}
