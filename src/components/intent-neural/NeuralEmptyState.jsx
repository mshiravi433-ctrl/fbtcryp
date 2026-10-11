/**
 * NEURAL EMPTY STATE — the welcome surface for a fresh Intent OS thread.
 * ---------------------------------------------------------------------------
 * Rendered only when the thread holds nothing but the greeting (the greeting
 * itself stays in state — this is purely visual). Every quick action invokes
 * REAL application functionality through the parent's handlers; there are no
 * decorative buttons. Copy is bilingual via the locale prop — no locale-file
 * changes, so no other screen's wording can shift.
 */
import { memo } from 'react';
import NeuralCore from './NeuralCore';

export const NEURAL_QUICK_ACTIONS = Object.freeze([
  { id: 'markets', fa: 'تحلیل بازارهای جهانی', en: 'Analyze Global Markets' },
  { id: 'smartmoney', fa: 'بررسی اسمارت‌مانی', en: 'Investigate Smart Money' },
  { id: 'futures', fa: 'تحلیل فیوچرز', en: 'Analyze Futures' },
  { id: 'risk', fa: 'بازبینی ریسک پرتفوی', en: 'Review Portfolio Risk' },
  { id: 'swap', fa: 'مقایسه مسیرهای سواپ', en: 'Compare Swap Routes' },
  { id: 'strategy', fa: 'ساخت استراتژی سرمایه‌گذاری', en: 'Build an Investment Strategy' }
]);

const ACTION_GLYPH = Object.freeze({
  markets: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9S14.5 18.4 12 21c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3Z" /></svg>
  ),
  smartmoney: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 17l5.5-5.5 3.5 3.5L21 6" /><path d="M15 6h6v6" /></svg>
  ),
  futures: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-9M22 19H2" /></svg>
  ),
  risk: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6L12 3Z" /><path d="M12 9v4M12 16.5v.5" /></svg>
  ),
  swap: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" /></svg>
  ),
  strategy: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></svg>
  )
});

const NeuralEmptyState = memo(function NeuralEmptyState({
  locale = 'fa',
  coreState = 'idle',
  onAction,
  disabled = false
}) {
  const fa = String(locale || 'fa').startsWith('fa');
  return (
    <div className="fbt-empty" data-testid="neural-empty-state">
      <div className="fbt-empty-core">
        <NeuralCore state={coreState} size={76} label={fa ? 'هسته عصبی FBT' : 'FBT Neural Core'} />
      </div>
      <h2 className="fbt-empty-title">
        {fa ? 'فرمانده‌ی هوشمند FBT' : 'FBT Neural Command'}
      </h2>
      <p className="fbt-empty-sub">
        {fa
          ? 'بازار، کیف پول و ایجنت‌ها را از یک‌جا فرمان بده — هر اجرا با تأیید و امضای خودت.'
          : 'Command markets, wallet and agents from one place — every execution needs your confirmation and signature.'}
      </p>
      <div className="fbt-empty-grid" role="list">
        {NEURAL_QUICK_ACTIONS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="listitem"
            className="fbt-empty-action"
            data-action={a.id}
            disabled={disabled}
            onClick={() => onAction?.(a.id)}
          >
            <span className="fbt-empty-glyph" aria-hidden="true">{ACTION_GLYPH[a.id]}</span>
            <span className="fbt-empty-label">{fa ? a.fa : a.en}</span>
          </button>
        ))}
      </div>
      <p className="fbt-empty-hint">
        {fa
          ? 'یا مستقیم بنویس: «اتریوم را تحلیل کن» — «اگر BTC زیر ۹۰هزار شد خبر بده»'
          : 'Or just type: “analyze Ethereum” — “alert me if BTC drops below 90k”'}
      </p>
    </div>
  );
});

export default NeuralEmptyState;
