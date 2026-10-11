/**
 * NEURAL MORE MENU — grouped destinations for the Intent OS "More" tab.
 * ---------------------------------------------------------------------------
 * Every row resolves against routes/panels that REALLY exist (audited against
 * src/App.jsx on 2026-10-11). Kinds:
 *
 *   route — react-router destination, opened via onNavigate(route).
 *   panel — in-page Intent OS panel, opened via onPanel(name[, section]).
 *   chat  — a real in-chat capability (prompt sent / intake form started).
 *   na    — verified missing: rendered disabled with an honest note + a chat
 *           alternative. NEVER a dead link.
 *
 * Audit notes (kept here so the next redesign does not re-invent them):
 *   · Goals/Strategies has no standalone route (FinancialGoals lives only in
 *     the unrouted legacy IntentOS page) → in-chat strategy intake instead.
 *   · Risk Center has no standalone route → in-chat portfolio-risk analysis
 *     plus a Portfolio shortcut.
 *   · RWA has no standalone route (RwaRow renders inside /stocks) → /stocks
 *     with a note, plus a chat alternative.
 *   · /perp exists only when SPECULATION_ENABLED (website default ON; store
 *     builds may ship it OFF) → hidden-with-note when gated.
 */
import { memo } from 'react';
import { SPECULATION_ENABLED } from '../../lib/features';

const glyph = (paths) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
);
const G = {
  globe: glyph(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.9 5.7 3.9 9s-1.4 6.4-3.9 9c-2.5-2.6-3.9-5.7-3.9-9S9.5 5.6 12 3Z" /></>),
  whale: glyph(<><path d="M3 17l5.5-5.5 3.5 3.5L21 6" /><path d="M15 6h6v6" /></>),
  chart: glyph(<><path d="M4 19V9M10 19V5M16 19v-9M22 19H2" /></>),
  spark: glyph(<><path d="M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4M4.9 19.1l2.9-2.9M16.2 7.8l2.9-2.9" /></>),
  pie: glyph(<><path d="M21.2 15.9A10 10 0 1 1 8 2.8" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></>),
  target: glyph(<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></>),
  shield: glyph(<><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6L12 3Z" /><path d="M12 9v4M12 16.5v.5" /></>),
  wallet: glyph(<><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" /><path d="M4 6v12c0 1.1.9 2 2 2h14v-4" /><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" /></>),
  swap: glyph(<><path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" /></>),
  bridge: glyph(<><path d="M4 17h16M6 17V9m4 8V5m4 12v-8m4 8V9" /><path d="M2 21h20" /></>),
  candle: glyph(<><path d="M7 4v16M7 8h0M17 4v16" /><rect x="4.5" y="9" width="5" height="7" rx="1" /><rect x="14.5" y="6" width="5" height="6" rx="1" /></>),
  sprout: glyph(<><path d="M12 21v-8m0 0c0-4 3-6 8-6 0 5-3 6-8 6Zm0 0c0-3-2.5-5-7-5 0 4 2.5 5 7 5Z" /></>),
  bank: glyph(<><path d="M3 10l9-6 9 6M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18" /></>),
  gem: glyph(<><path d="M6 3h12l4 6-10 12L2 9l4-6Z" /><path d="M2 9h20M12 21L8 9l4-6 4 6-4 12" /></>),
  bolt: glyph(<><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></>),
  clock: glyph(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>),
  pulse: glyph(<><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>),
  lock: glyph(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>)
};

function buildGroups(fa, speculationOn) {
  const t = (faStr, enStr) => (fa ? faStr : enStr);
  return [
    {
      id: 'intelligence',
      title: t('هوشمندی', 'Intelligence'),
      items: [
        { id: 'market-overview', icon: 'chart', title: t('بازار', 'Market'), sub: t('قیمت‌ها و جریان بازار', 'Prices & market flow'), kind: 'route', target: '/' },
        { id: 'global', icon: 'globe', title: t('هوش جهانی', 'Global Intelligence'), sub: t('افق جهانی بازارها', 'Global market horizon'), kind: 'route', target: '/global' },
        { id: 'smartmoney', icon: 'whale', title: t('اسمارت‌مانی', 'Smart Money'), sub: t('ردیابی پول هوشمند', 'Smart-money tracking'), kind: 'route', target: '/smart-money' },
        { id: 'market', icon: 'chart', title: t('تحلیل بازار', 'Market Analysis'), sub: t('سیگنال‌ها و تحلیل‌ها', 'Signals & analysis'), kind: 'route', target: '/signals' },
        { id: 'multimodel', icon: 'spark', title: t('هوش چندمدلی', 'Multi-Model Intelligence'), sub: t('مدل‌ها، اجماع و اعتماد', 'Models, consensus & trust'), kind: 'panel', target: 'intelligence', testid: 'intent-ai-intelligence' }
      ]
    },
    {
      id: 'capital',
      title: t('مدیریت سرمایه', 'Capital Management'),
      items: [
        { id: 'portfolio', icon: 'pie', title: t('پرتفوی', 'Portfolio'), sub: t('دارایی‌ها و عملکرد', 'Holdings & performance'), kind: 'route', target: '/portfolio' },
        { id: 'goals', icon: 'target', title: t('اهداف و استراتژی‌ها', 'Goals & Strategies'), sub: t('ساخت پلن در همین چت', 'Build a plan right in chat'), kind: 'chat', target: 'strategy-intake', note: t('صفحه جدا ندارد — در چت ساخته می‌شود', 'No standalone page — built in chat') },
        { id: 'risk', icon: 'shield', title: t('مرکز ریسک', 'Risk Center'), sub: t('تحلیل ریسک پرتفوی در چت', 'Portfolio-risk analysis in chat'), kind: 'chat', target: 'risk-review', note: t('صفحه جدا ندارد — تحلیل در چت', 'No standalone page — analyzed in chat') }
      ]
    },
    {
      id: 'trading',
      title: t('معامله', 'Trading'),
      items: [
        { id: 'wallet', icon: 'wallet', title: t('کیف پول', 'Wallet'), sub: t('موجودی و تراکنش‌ها', 'Balances & transactions'), kind: 'route', target: '/wallet' },
        { id: 'swap', icon: 'swap', title: t('سواپ', 'Swap'), sub: t('تبادل توکن', 'Token exchange'), kind: 'route', target: '/swap' },
        { id: 'bridge', icon: 'bridge', title: t('بریج', 'Bridge'), sub: t('انتقال بین زنجیره‌ها', 'Cross-chain transfers'), kind: 'route', target: '/bridge' },
        speculationOn
          ? { id: 'futures', icon: 'candle', title: t('فیوچرز', 'Futures'), sub: t('بازار مشتقات', 'Derivatives market'), kind: 'route', target: '/perp' }
          : { id: 'futures', icon: 'candle', title: t('فیوچرز', 'Futures'), sub: t('در این نسخه غیرفعال است', 'Disabled in this build'), kind: 'na', note: t('در بیلد استور عرضه نشده', 'Not shipped in this build') },
        { id: 'farm', icon: 'sprout', title: t('فارم', 'Farm'), sub: t('کشت سود', 'Yield farming'), kind: 'route', target: '/farm' },
        { id: 'lending', icon: 'bank', title: t('وام‌دهی', 'Lending'), sub: t('وام و سپرده', 'Loans & deposits'), kind: 'route', target: '/loan' },
        { id: 'rwa', icon: 'gem', title: t('دارایی واقعی (RWA)', 'RWA'), sub: t('داخل صفحه سهام', 'Inside the Stocks page'), kind: 'route', target: '/stocks', note: t('صفحه جدا ندارد — بخش RWA سهام', 'No standalone page — Stocks › RWA') }
      ]
    },
    {
      id: 'system',
      title: t('سیستم', 'System'),
      items: [
        { id: 'ops', icon: 'bolt', title: t('عملیات', 'Operations'), sub: t('مونیتور، سفارش و خودکارسازی', 'Monitors, orders & automations'), kind: 'panel', target: 'operations', testid: 'intent-ai-operations' },
        { id: 'history', icon: 'clock', title: t('تاریخچه و حسابرسی', 'History & Audit'), sub: t('سشن‌ها و عملیات‌ها', 'Seasons & operations'), kind: 'panel', target: 'history', testid: 'intent-ai-history' },
        { id: 'health', icon: 'pulse', title: t('سلامت سیستم', 'System Health'), sub: t('موتور، ابزارها و اتصال', 'Engine, tools & link'), kind: 'panel', target: 'status' },
        { id: 'security', icon: 'lock', title: t('امنیت و دسترسی‌ها', 'Security & Permissions'), sub: t('ممیزی و امنیت', 'Audit & security'), kind: 'route', target: '/security' },
        { id: 'ecosystem', icon: 'spark', title: t('اکوسیستم ایجنت‌ها', 'Agent Ecosystem'), sub: t('ایجنت‌ها و استراتژی‌های ثبت‌شده', 'Registered agents & strategies'), kind: 'eco', target: 'agent', testid: 'intent-ai-ecosystem' }
      ]
    }
  ];
}

const NeuralMoreMenu = memo(function NeuralMoreMenu({
  locale = 'fa',
  onNavigate,
  onPanel,
  onChatAction,
  onEcosystem
}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const groups = buildGroups(fa, SPECULATION_ENABLED);
  return (
    <div className="fbt-more" data-testid="neural-more-menu">
      {groups.map((g) => (
        <section key={g.id} className="fbt-more-group" aria-label={g.title}>
          <h3 className="fbt-more-title">{g.title}</h3>
          <div className="fbt-more-rows">
            {g.items.map((item) => {
              const disabled = item.kind === 'na';
              const fire = () => {
                if (disabled) return;
                if (item.kind === 'route') onNavigate?.(item.target);
                else if (item.kind === 'panel') onPanel?.(item.target);
                else if (item.kind === 'chat') onChatAction?.(item.target);
                else if (item.kind === 'eco') onEcosystem?.(item.target);
              };
              return (
                <button
                  key={item.id}
                  type="button"
                  className="fbt-more-row"
                  data-kind={item.kind}
                  disabled={disabled}
                  onClick={fire}
                  aria-disabled={disabled}
                  {...(item.testid ? { 'data-testid': item.testid } : {})}
                >
                  <span className="fbt-more-glyph" aria-hidden="true">{G[item.icon]}</span>
                  <span className="fbt-more-copy">
                    <span className="fbt-more-name">{item.title}</span>
                    <span className="fbt-more-sub">{item.note || item.sub}</span>
                  </span>
                  {item.note && !disabled ? (
                    <span className="fbt-more-tag">{fa ? 'در چت' : 'in chat'}</span>
                  ) : null}
                  {!disabled ? (
                    <span className="fbt-more-chevron" aria-hidden="true">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
});

export default NeuralMoreMenu;
