import { useMemo, useState } from 'react';
import {
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATIONS_REVIEWED_ON,
  RECOMMENDED_EXTERNAL_AGENTS
} from '../../lib/intent-ai/agentHub/recommendations.js';

const textFor = (value, fa) => value?.[fa ? 'fa' : 'en'] || '';
const testIdPart = (value) => String(value || '').replace(/[^A-Za-z0-9_-]+/g, '-');

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

export default function RecommendedAgents({ fa = false, onAddOwnAgent = null }) {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const locale = fa ? 'fa' : 'en';
  const filtered = useMemo(
    () => RECOMMENDED_EXTERNAL_AGENTS.filter((agent) => matchesRecommendation(agent, query, category, fa)),
    [category, fa, query]
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
            {fa ? 'راهنمای انتخاب · پیوند به منابع رسمی' : 'PRACTICAL PICKS · OFFICIAL SOURCES'}
          </span>
          <h3>{fa ? 'ایجنت‌های پیشنهادی' : 'Recommended external agents'}</h3>
          <p className="ah-muted ah-small">
            {fa
              ? 'گزیده‌ای کاربردی برای پژوهش، کار روزمره، کدنویسی و اتوماسیون؛ انتخاب‌ها بر اساس قابلیت‌های اعلام‌شده در سایت رسمی هر ارائه‌دهنده‌اند، نه رتبه‌بندی یا تبلیغ.'
              : 'A practical shortlist for research, daily work, coding, and automation, based on capabilities described by each provider—not a ranking or advertisement.'}
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

      <aside className="ah-rec-disclaimer" role="note" data-testid="agent-hub-recommendation-note">
        <strong>{fa ? 'پیشنهادی یعنی بررسی امنیتی یا اتصال FBT نیست.' : 'Recommended does not mean FBT-reviewed or connected.'}</strong>
        <p>
          {fa
            ? 'این سرویس‌ها از اینجا اجرا نمی‌شوند و به حساب شما وصل نیستند؛ پیوندها به سایت رسمی می‌روند. برای اجرای ایجنت از داخل FBT باید کارت عمومی A2A سازگار داشته باشید. پیش از اشتراک‌گذاری اطلاعات، شرایط، حریم خصوصی، دسترسی‌ها و قیمتِ قابل‌اعمال در منطقه‌تان را در سایت ارائه‌دهنده بررسی کنید.'
            : 'These services do not run here and are not connected to your account; links go to their official sites. Running an agent inside FBT requires a compatible public A2A card. Before sharing information, review the provider’s terms, privacy policy, permissions, and local pricing.'}
        </p>
      </aside>

      <div className="ah-rec-tools">
        <input
          className="ah-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={fa ? 'جستجوی نام یا کاربرد…' : 'Search by name or use case…'}
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
                <a
                  className="ah-ghost ah-rec-link"
                  href={agent.pricingUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  data-testid={`agent-hub-recommendation-pricing-${agent.id}`}
                >
                  {fa ? 'قیمت و طرح‌ها' : 'Plans & pricing'}
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
