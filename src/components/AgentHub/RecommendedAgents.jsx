import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCatalog } from '../../lib/intent-ai/agentHub/client.js';
import { BRIDGE_CATEGORIES } from '../../lib/intent-ai/agentHub/keyBridges.js';

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

/* A directory entry is a provider the server can actually connect. The only
   reason it appears here is that `providerKeys.providers` listed it — there is
   no local list to drift, and no card can exist without a working key path. */
function matchesBridge(provider, query, category, fa) {
  if (category !== 'all' && provider.category !== category) return false;
  if (!query.trim()) return true;
  const needle = query.trim().toLocaleLowerCase(fa ? 'fa-IR' : 'en');
  return [
    provider.name,
    provider.vendor,
    provider.id,
    textFor(provider.domainUse, fa),
    textFor(provider.domainUse, !fa),
    provider.kind === 'ai' ? 'ai model' : 'data'
  ].join(' ').toLocaleLowerCase(fa ? 'fa-IR' : 'en').includes(needle);
}

const KIND_LABEL = {
  ai: { fa: 'صندلی هوش مصنوعی', en: 'AI seat' },
  data: { fa: 'دادهٔ واقعی', en: 'Live data' }
};

/**
 * The landing view: what can run HERE, then what we can CONNECT.
 *
 * The second rail used to be a link directory, which is why most cards said
 * "this service has no public key API". That was honest but useless. Now the
 * rail only contains providers the server can genuinely reach with a key the
 * user owns: every card opens a real verification, and a provider that cannot
 * be connected simply has no card. Its website, docs and pricing live inside
 * the popup instead of on the page, so the page shows capability, not links.
 */
export default function RecommendedAgents({
  fa = false,
  onAddOwnAgent = null,
  nativeAgents = [],
  onRunAgent = null,
  onOpenKey = null,
  keyStatus = {},
  connectable = null
}) {
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState(() => ({
    state: Array.isArray(connectable) && connectable.length ? 'ready' : 'idle',
    providers: Array.isArray(connectable) ? connectable : [],
    error: null
  }));
  const locale = fa ? 'fa' : 'en';

  /* The panel already holds the catalogue; when it does not (standalone render,
     or a panel that opened before the catalogue loaded) read it here. */
  useEffect(() => {
    if (Array.isArray(connectable) && connectable.length) {
      setDirectory({ state: 'ready', providers: connectable, error: null });
      return;
    }
    let alive = true;
    setDirectory((prev) => ({ ...prev, state: prev.providers.length ? prev.state : 'loading' }));
    void (async () => {
      const out = await getCatalog();
      if (!alive) return;
      const providers = Array.isArray(out?.providerKeys?.providers) ? out.providerKeys.providers : [];
      setDirectory({
        state: providers.length ? 'ready' : 'empty',
        providers,
        error: out?.ok ? null : out?.code || 'NETWORK_UNAVAILABLE'
      });
    })();
    return () => { alive = false; };
  }, [connectable]);

  const native = useMemo(
    // Only agents the server returned get a card. No local copy of the list:
    // a native agent that is switched off server-side must disappear here too.
    () => (nativeAgents || []).filter((agent) => agent && agent.source === 'native' && matchesNative(agent, query, fa)),
    [nativeAgents, query, fa]
  );

  const filtered = useMemo(
    () => directory.providers.filter((provider) => matchesBridge(provider, query, category, fa)),
    [category, directory.providers, fa, query]
  );

  const chips = useMemo(() => {
    const counts = {};
    for (const provider of directory.providers) {
      counts[provider.category] = (counts[provider.category] || 0) + 1;
    }
    return BRIDGE_CATEGORIES
      .filter((item) => item.id === 'all' || counts[item.id])
      .map((item) => ({ ...item, count: item.id === 'all' ? directory.providers.length : counts[item.id] }));
  }, [directory.providers]);

  const connectedCount = useMemo(
    () => directory.providers.filter((provider) => keyStatus[provider.id]?.connected).length,
    [directory.providers, keyStatus]
  );

  return (
    <section className="ah-recommendations" data-testid="agent-hub-recommended" dir={fa ? 'rtl' : 'ltr'}>
      <header className="ah-rec-hero">
        <div className="ah-rec-hero-copy">
          <span className="ah-rec-kicker">
            <span className="ah-rec-kicker-dot" aria-hidden="true" />
            {fa ? 'مِش ایجنت کریپتو · اتصال واقعی با کلید خودتان' : 'CRYPTO AGENT MESH · REAL KEY CONNECTIONS'}
          </span>
          <h3>{fa ? 'ایجنت‌های پیشنهادی کریپتو' : 'Crypto agents you can actually connect'}</h3>
          <p className="ah-muted ah-small">
            {fa
              ? 'دو لایهٔ جدا: ایجنت‌های خودِ FBT که همین‌جا و بدون حساب اجرا می‌شوند، و ارائه‌دهندگانی که FBT مسیر کلید واقعی‌شان را می‌شناسد. هر کارتِ لایهٔ دوم یک دکمه دارد: کلید خودتان را می‌گذارید، سرور پیش از ذخیره آن را روی میزبان رسمی همان ارائه‌دهنده امتحان می‌کند و بعد پرسش‌های کریپتو/DeFi از همان صندلی پرسیده می‌شود. سرویسی که مسیر کلید ندارد در این فهرست کارت ندارد — سایت، مستندات و تعرفه هم داخل همان پاپ‌اپ است، نه روی صفحه.'
              : 'Two separate layers: FBT’s own agents, which run here with no account, and providers whose key path FBT actually knows. Every card in the second layer has one action: paste your key, the server proves it against that provider’s own host before storing it, and your crypto/DeFi questions are then asked through that seat. A service with no key path has no card here — and its website, docs and pricing live inside the popup, not on the page.'}
          </p>
          <span className="ah-rec-updated" data-testid="agent-hub-connectable-count">
            {fa ? 'قابل اتصال: ' : 'Connectable: '}
            <strong>{directory.providers.length}</strong>
            {connectedCount ? (fa ? ` · متصل: ${connectedCount}` : ` · connected: ${connectedCount}`) : ''}
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
                ? 'منطق این ایجنت‌ها داخل خودِ FBT اجرا می‌شود و به اتصال حساب نیازی نیست. پیش از هر پرس‌وجوی دادهٔ عمومی، نام منبع (CoinGecko، DefiLlama، GoPlus) و فیلدهایی که فرستاده می‌شود نمایش داده می‌شود و تا تأیید نکنید هیچ درخواستی به بیرون نمی‌رود. هر کارت می‌گوید داده از کجاست.'
                : 'Their logic runs inside FBT and needs no account connection. Before any public-data query, the named source (CoinGecko, DefiLlama, GoPlus) and the fields that are sent are shown; nothing leaves FBT until you approve them. Each card names its data source.'}
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

      <section className="ah-connectable" data-testid="agent-hub-connectable">
        <header className="ah-connectable-head">
          <div>
            <span className="ah-native-kicker">{fa ? 'اتصال با کلید خودتان · بررسی روی میزبان رسمی' : 'YOUR KEY · PROVEN AGAINST THE VENDOR'}</span>
            <h4>{fa ? 'ارائه‌دهندگان قابل اتصال' : 'Providers you can connect'}</h4>
            <p className="ah-muted ah-small">
              {fa
                ? 'فقط سرویس‌هایی اینجا هستند که مسیر کلیدشان واقعاً کار می‌کند. دکمهٔ هر کارت همان یک کار را می‌کند: کلید را می‌گیرد، روی همان میزبان امتحان می‌کند و اگر جواب داد رمزنگاری‌شده ذخیره می‌کند. سایت، مستندات و تعرفه داخل پاپ‌اپ همان کارت است.'
                : 'Only services whose key path genuinely works are listed. A card has exactly one action: take the key, prove it on the vendor’s own host, and store it sealed if it answers. Website, docs and pricing live inside that card’s popup.'}
            </p>
          </div>
        </header>

        {chips.length > 1 ? (
          <div className="ah-filters" role="group" aria-label={fa ? 'دسته‌بندی ارائه‌دهنده' : 'Provider category'}>
            {chips.map((item) => (
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
                <span className="ah-chip-count">{item.count}</span>
              </button>
            ))}
          </div>
        ) : null}

        <input
          className="ah-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={fa ? 'جستجوی نام ارائه‌دهنده یا کاربرد دامنه…' : 'Search a provider or what it does…'}
          aria-label={fa ? 'جستجوی ارائه‌دهندهٔ قابل اتصال' : 'Search a connectable provider'}
          data-testid="agent-hub-recommendation-search"
        />

        {directory.state === 'loading' || directory.state === 'idle' ? (
          <p className="ah-muted" role="status">{fa ? 'در حال خواندن فهرست قابل اتصال…' : 'Reading the connectable list…'}</p>
        ) : null}

        {directory.state === 'empty' ? (
          <p className="ah-note ah-small" role="status" data-testid="agent-hub-connectable-empty">
            {fa
              ? 'در این لحظه سرور هیچ ارائه‌دهندهٔ قابل اتصالی برنگرداند؛ پس هیچ کارتی نمایش داده نمی‌شود. (اگر کلید رمزنگاری سرور تنظیم نشده باشد، همین اتفاق می‌افتد.)'
              : 'The server returned no connectable provider right now, so no card is shown. (A server without a sealing key produces exactly this.)'}
          </p>
        ) : null}

        {directory.state === 'ready' && !filtered.length ? (
          <p className="ah-note" role="status" data-testid="agent-hub-recommendation-empty">
            {fa ? 'ارائه‌دهنده‌ای با این جستجو پیدا نشد.' : 'No connectable provider matches that search.'}
          </p>
        ) : null}

        {filtered.length ? (
          <ul className="ah-rec-grid" data-testid="agent-hub-recommendation-list">
            {filtered.map((provider) => {
              const id = testIdPart(provider.id);
              const status = keyStatus[provider.id] || { connected: Boolean(provider.connected), status: provider.status };
              const connected = Boolean(status.connected);
              return (
                <li key={provider.id} className="ah-rec-card" data-testid={`agent-hub-recommendation-${id}`}>
                  <div className="ah-rec-card-head">
                    <span className="ah-rec-brand" aria-hidden="true">{provider.mark || '◎'}</span>
                    <div className="ah-rec-name-wrap">
                      <span className="ah-rec-vendor">{provider.vendor}</span>
                      <h4 className="ah-rec-name">{provider.name}</h4>
                    </div>
                    <span className="ah-badge" data-tone={connected ? 'ok' : 'muted'} data-testid={`agent-hub-recommendation-status-${id}`}>
                      {connected ? (fa ? 'کلید شما وصل است' : 'Your key is live') : status.status === 'INVALID' ? (fa ? 'کلید نامعتبر' : 'Key invalid') : (fa ? 'آمادهٔ اتصال' : 'Ready to connect')}
                    </span>
                  </div>

                  <div className="ah-rec-tags">
                    <span className="ah-rec-tag ah-rec-tag-category">{textFor(KIND_LABEL[provider.kind] || KIND_LABEL.data, fa)}</span>
                    <span className="ah-rec-tag">{provider.requiresModel === false ? (fa ? 'فقط خواندن داده' : 'Data only') : (fa ? 'پرسش متنی' : 'Text questions')}</span>
                    <span className="ah-rec-tag">{provider.authLabel}</span>
                  </div>

                  <p className="ah-rec-summary">{textFor(provider.domainUse, fa)}</p>

                  <div className="ah-rec-actions">
                    {onOpenKey ? (
                      <button
                        type="button"
                        className={`ah-primary ah-primary-sm ah-rec-key-btn${connected ? ' ah-rec-key-btn-live' : ''}`}
                        onClick={() => onOpenKey(provider)}
                        data-testid={`agent-hub-recommendation-key-${id}`}
                      >
                        {connected
                          ? (fa ? 'کلید و بررسی اتصال · متصل' : 'Key & connection · live')
                          : (fa ? 'بررسی اتصال' : 'Check connection')}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
