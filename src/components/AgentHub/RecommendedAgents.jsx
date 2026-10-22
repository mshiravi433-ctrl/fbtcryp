import { useMemo, useState } from 'react';
import {
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_COUNTS,
  RECOMMENDATIONS_REVIEWED_ON,
  RECOMMENDED_EXTERNAL_AGENTS
} from '../../lib/intent-ai/agentHub/recommendations.js';

const textFor = (value, fa) => value?.[fa ? 'fa' : 'en'] || '';
const testIdPart = (value) => String(value || '').replace(/[^A-Za-z0-9_-]+/g, '-');

/* The same three groups the product brief names. A group is only rendered when
   the server actually returned an agent for it — an empty heading would be a
   claim about a capability that is not on screen. */
const NATIVE_GROUPS = [
  {
    id: 'analysis',
    fa: 'ایجنت‌های تحلیل و معامله',
    en: 'Analysis & trading agents',
    categories: ['trading', 'research'],
    noteFa: 'بازار را توصیف می‌کنند؛ سفارش نمی‌گذارند.',
    noteEn: 'They describe the market. They never place an order.'
  },
  {
    id: 'defi',
    fa: 'ایجنت‌های DeFi',
    en: 'DeFi agents',
    categories: ['defi'],
    noteFa: 'بازده، نقدینگی و ریسکِ وام‌دهی را مقایسه می‌کنند؛ تراکنش نمی‌سازند.',
    noteEn: 'They compare yield, liquidity and lending risk. They build no transaction.'
  },
  {
    id: 'security',
    fa: 'ایجنت‌های امنیت و پژوهش',
    en: 'Security & research agents',
    categories: ['security'],
    noteFa: 'ریسکِ توکن، کیف پول و پروتکل را از دادهٔ عمومی می‌خوانند.',
    noteEn: 'They read token, wallet and protocol risk from public data.'
  }
];

const NATIVE_MARKS = {
  trading: '◈',
  research: '◎',
  defi: '◇',
  security: '⌘',
  custom: '✳'
};

function matchesRecommendation(agent, query, category, fa) {
  if (category !== 'all' && agent.category !== category) return false;
  if (!query.trim()) return true;

  const needle = query.trim().toLocaleLowerCase(fa ? 'fa-IR' : 'en');
  const haystack = [
    agent.name,
    agent.vendor,
    textFor(agent.kind, fa),
    textFor(agent.summary, fa),
    textFor(agent.bestFor, fa),
    textFor(agent.freeAccess, fa),
    textFor(agent.paidAccess, fa)
  ].join(' ').toLocaleLowerCase(fa ? 'fa-IR' : 'en');
  return haystack.includes(needle);
}

function matchesNative(agent, query, fa) {
  if (!query.trim()) return true;
  const needle = query.trim().toLocaleLowerCase(fa ? 'fa-IR' : 'en');
  return [
    agent.name,
    agent.nameFa,
    agent.summary,
    agent.summaryFa,
    agent.category,
    ...(agent.capabilities || []),
    ...(agent.dataSources || [])
  ].filter(Boolean).join(' ').toLocaleLowerCase(fa ? 'fa-IR' : 'en').includes(needle);
}

/**
 * The landing view: what can run HERE, then what exists OUT THERE.
 *
 * The order matters. A directory of links is a blog post; an agent a user can
 * press and get a real answer from is the product. The native rail is printed
 * first, labelled `FBT native`, and carries only agents the server actually
 * listed — never a placeholder card while the catalogue is loading.
 */
export default function RecommendedAgents({ fa = false, onAddOwnAgent = null, nativeAgents = [], onRunAgent = null }) {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const locale = fa ? 'fa' : 'en';
  const filtered = useMemo(
    () => RECOMMENDED_EXTERNAL_AGENTS.filter((agent) => matchesRecommendation(agent, query, category, fa)),
    [category, fa, query]
  );
  const native = useMemo(
    // Only agents the server returned get a card. No local copy of the list:
    // a native agent that is switched off server-side must disappear here too.
    () => (nativeAgents || []).filter((agent) => agent && agent.source === 'native' && matchesNative(agent, query, fa)),
    [nativeAgents, query, fa]
  );
  const reviewedDate = new Date(`${RECOMMENDATIONS_REVIEWED_ON}T00:00:00.000Z`);
  const formattedReviewDate = reviewedDate.toLocaleDateString(
    fa ? 'fa-IR-u-ca-persian' : 'en-GB',
    { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
  );

  return (
    <section className="ah-recommendations" data-testid="agent-hub-recommended" dir={fa ? 'rtl' : 'ltr'}>
      <header className="ah-rec-hero">
        <div className="ah-rec-hero-copy">
          <span className="ah-rec-kicker">
            <span className="ah-rec-kicker-dot" aria-hidden="true" />
            {fa ? 'مِش ایجنت کریپتو · اجرا داخل FBT' : 'CRYPTO AGENT MESH · RUNS INSIDE FBT'}
          </span>
          <h3>{fa ? 'ایجنت‌های پیشنهادی کریپتو' : 'Crypto agents, ready or one link away'}</h3>
          <p className="ah-muted ah-small">
            {fa
              ? 'دو لایهٔ جدا: ایجنت‌های خودِ FBT که همین‌جا و بدون حساب اجرا می‌شوند، و فهرست راهنمای سرویس‌های کریپتو (سواپ، پورتفوی، بازده، داده، استراتژی و امنیت) با پیوند سایت و تعرفهٔ رسمی خودشان. هیچ‌کدام از فهرست دوم به حساب شما وصل نمی‌شود و FBT اجرایش نمی‌کند.'
              : 'Two separate layers: FBT’s own agents, which run here with no account, and an editorial crypto directory (swap, portfolio, yield, data, strategy, security) linking to each vendor’s official site and pricing. Nothing in the second layer is connected to your account or executed by FBT.'}
          </p>
          <span className="ah-rec-updated">
            {fa ? 'بازبینی پیوندها و طرح‌ها: ' : 'Official pages checked: '}
            <time dateTime={RECOMMENDATIONS_REVIEWED_ON}>{formattedReviewDate}</time>
          </span>
        </div>
        {onAddOwnAgent ? (
          <button
            type="button"
            className="ah-primary ah-primary-sm ah-rec-add"
            onClick={onAddOwnAgent}
            data-testid="agent-hub-recommended-add"
          >
            {fa ? 'افزودن کارت A2A خودم' : 'Add my A2A agent card'}
          </button>
        ) : null}
      </header>

      <section className="ah-native" data-testid="agent-hub-native">
        <header className="ah-native-head">
          <div>
            <span className="ah-native-kicker">{fa ? 'آمادهٔ اجرا · بدون تغییر مسیر داده' : 'READY TO RUN · NO EXTERNAL ACCOUNT'}</span>
            <h4>{fa ? 'ایجنت‌های بومی FBT' : 'FBT native agents'}</h4>
            <p className="ah-muted ah-small">
              {fa
                ? 'این تحلیل‌ها را خودِ FBT روی دادهٔ عمومی بازار (CoinGecko، DefiLlama، GoPlus، LI.FI) محاسبه می‌کند. نیازی به اتصال حساب نیست و چیزی به سرویس دیگری فرستاده نمی‌شود. هر کارت می‌گوید داده از کجاست.'
                : 'FBT computes these itself over public market data (CoinGecko, DefiLlama, GoPlus, LI.FI). No account connection, and nothing is sent to another service. Each card names its data source.'}
            </p>
          </div>
          <span className="ah-native-count" data-testid="agent-hub-native-count">
            {native.length ? `${native.length}` : '—'}
            <small>{fa ? 'ایگنت' : 'agents'}</small>
          </span>
        </header>

        {native.length ? (
          <div className="ah-native-groups" data-testid="agent-hub-native-list">
            {NATIVE_GROUPS.map((group) => {
              const members = native.filter((agent) => group.categories.includes(agent.category));
              if (!members.length) return null;
              return (
                <section key={group.id} className="ah-native-group" data-testid={`agent-hub-native-group-${group.id}`}>
                  <header className="ah-native-group-head">
                    <h5>{fa ? group.fa : group.en}</h5>
                    <span>{fa ? group.noteFa : group.noteEn}</span>
                  </header>
                  <ul className="ah-native-grid">
                    {members.map((agent) => {
                      const id = testIdPart(agent.id);
                      return (
                        <li key={agent.id} className="ah-native-card" data-testid={`agent-hub-native-${id}`}>
                          <div className="ah-native-card-head">
                            <span className="ah-native-mark" aria-hidden="true">{NATIVE_MARKS[agent.category] || '✦'}</span>
                            <div className="ah-native-name-wrap">
                              <strong className="ah-native-name">{fa ? (agent.nameFa || agent.name) : agent.name}</strong>
                              <span className="ah-native-sub">{fa ? agent.name : (agent.nameFa || '')}</span>
                            </div>
                            <span className="ah-badge" data-tone="ok">{fa ? 'بومی FBT' : 'FBT native'}</span>
                          </div>
                          <p className="ah-native-summary">{fa ? (agent.summaryFa || agent.summary) : agent.summary}</p>
                          {agent.dataSources?.length ? (
                            <div className="ah-native-sources">
                              <span>{fa ? 'داده:' : 'Data:'}</span>
                              {agent.dataSources.slice(0, 4).map((source) => <span key={source} className="ah-native-source">{source}</span>)}
                            </div>
                          ) : null}
                          <div className="ah-native-actions">
                            <button
                              type="button"
                              className="ah-primary ah-primary-sm"
                              onClick={() => onRunAgent?.(agent)}
                              data-testid={`agent-hub-native-run-${id}`}
                            >
                              {fa ? 'اجرا و مشاهدهٔ تحلیل' : 'Run the analysis'}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <p className="ah-note ah-small" role="status" data-testid="agent-hub-native-empty">
            {fa
              ? 'در این لحظه فهرست ایجنت‌های بومی از سرور نیامده یا با جستجوی شما هم‌خوان نیست. بدون فهرست سرور، کارتی نمایش داده نمی‌شود.'
              : 'The native list did not arrive from the server, or nothing matches this search. Without the server list no card is shown.'}
          </p>
        )}
      </section>

      <aside className="ah-rec-disclaimer" role="note" data-testid="agent-hub-recommendation-note">
        <strong>{fa ? 'فهرست زیر «پیشنهادی» است، نه «تأییدشده» یا «متصل».' : 'The directory below is suggested, not reviewed or connected.'}</strong>
        <p>
          {fa
            ? 'این سرویس‌ها از اینجا اجرا نمی‌شوند و به حساب شما وصل نیستند؛ پیوندها به سایت رسمی می‌روند. برای اجرای ایجنت‌های خودتان از داخل FBT باید کارت عمومی A2A سازگار داشته باشند (تب «کشف / افزودن»). پیش از اشتراک‌گذاری اطلاعات، شرایط، حریم خصوصی، دسترسی‌ها و قیمتِ قابل‌اعمال در منطقه‌تان را در سایت ارائه‌دهنده بررسی کنید.'
            : 'These services do not run here and are not connected to your account; links go to their official sites. Running your own agent inside FBT requires a compatible public A2A card (Discover / Add). Before sharing information, review the provider’s terms, privacy policy, permissions and local pricing.'}
        </p>
      </aside>

      <div className="ah-rec-tools">
        <input
          className="ah-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={fa ? 'جستجوی نام، کاربرد یا منبع داده…' : 'Search by name, use case or data source…'}
          aria-label={fa ? 'جستجوی ایجنت‌های پیشنهادی' : 'Search recommended agents'}
          data-testid="agent-hub-recommendation-search"
        />
        <div className="ah-filters" role="group" aria-label={fa ? 'دسته‌بندی ایجنت پیشنهادی' : 'Recommended agent category'}>
          {RECOMMENDATION_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className="ah-chip"
              aria-pressed={category === item.id}
              data-active={category === item.id}
              onClick={() => setCategory(item.id)}
              data-testid={`agent-hub-recommendation-filter-${item.id}`}
            >
              {item[locale]}
              <span className="ah-chip-count">{RECOMMENDATION_COUNTS[item.id] || 0}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length ? (
        <ul className="ah-rec-grid" data-testid="agent-hub-recommendation-list">
          {filtered.map((agent) => (
            <li
              key={agent.id}
              className="ah-rec-card"
              data-testid={`agent-hub-recommendation-${testIdPart(agent.id)}`}
            >
              <div className="ah-rec-card-head">
                <span className="ah-rec-brand" aria-hidden="true">{agent.mark}</span>
                <div className="ah-rec-name-wrap">
                  <span className="ah-rec-vendor">{agent.vendor}</span>
                  <h4 className="ah-rec-name">{agent.name}</h4>
                </div>
                <span className="ah-rec-recommended">
                  {fa ? 'پیشنهادی' : 'Suggested'}
                </span>
              </div>

              <div className="ah-rec-tags">
                <span className="ah-rec-tag ah-rec-tag-category">{textFor(agent.kind, fa)}</span>
                <span className="ah-rec-tag ah-rec-tag-free">{fa ? 'دسترسی رایگان دارد' : 'Free access'}</span>
                <span className="ah-rec-tag ah-rec-tag-paid">{fa ? 'گزینهٔ پولی دارد' : 'Paid option'}</span>
              </div>

              <p className="ah-rec-summary">{textFor(agent.summary, fa)}</p>

              <dl className="ah-rec-facts">
                <div>
                  <dt>{fa ? 'مناسب برای' : 'Best for'}</dt>
                  <dd>{textFor(agent.bestFor, fa)}</dd>
                </div>
                <div>
                  <dt>{fa ? 'دسترسی رایگان' : 'Free access'}</dt>
                  <dd>{textFor(agent.freeAccess, fa)}</dd>
                </div>
                <div>
                  <dt>{fa ? 'طرح‌های پولی' : 'Paid plans'}</dt>
                  <dd>{textFor(agent.paidAccess, fa)}</dd>
                </div>
              </dl>

              <div className="ah-rec-actions">
                <a
                  className="ah-primary ah-primary-sm ah-rec-link-primary"
                  href={agent.productUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  data-testid={`agent-hub-recommendation-site-${agent.id}`}
                >
                  {fa ? 'سایت رسمی' : 'Official site'}
                  <span className="ah-rec-external-mark" aria-hidden="true">↗</span>
                </a>
                {agent.docsUrl ? (
                  <a
                    className="ah-ghost ah-rec-link"
                    href={agent.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    data-testid={`agent-hub-recommendation-docs-${agent.id}`}
                  >
                    {fa ? 'مستندات' : 'Docs'}
                    <span className="ah-rec-external-mark" aria-hidden="true">↗</span>
                  </a>
                ) : null}
                <a
                  className="ah-ghost ah-rec-link"
                  href={agent.pricingUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  data-testid={`agent-hub-recommendation-pricing-${agent.id}`}
                >
                  {fa ? 'تعرفه و دسترسی' : 'Plans & access'}
                  <span className="ah-rec-external-mark" aria-hidden="true">↗</span>
                </a>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ah-note" role="status" data-testid="agent-hub-recommendation-empty">
          {fa ? 'ایجنت پیشنهادی‌ای با این جستجو پیدا نشد.' : 'No recommended agents match that search.'}
        </p>
      )}
    </section>
  );
}
