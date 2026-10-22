/**
 * FBT EXTERNAL AGENT HUB — the in-app surface (§14).
 * ---------------------------------------------------------------------------
 * Discover · Connected · Activity, inside the existing Agents area of the AI
 * page. Three behaviours are non-negotiable here:
 *
 *   1. THE EXECUTION LIST IS THE SERVER'S LIST. The separate recommendations
 *      directory is editorial, links only to official sites, and can never be
 *      mistaken for an approved or executable provider listing.
 *   2. THE PREVIEW IS THE PAYLOAD. The context preview is produced by the same
 *      `composeConsentMessage` the server calls, so what the user reads is
 *      byte-for-byte the message the provider receives.
 *   3. THE RESULT IS THE PROVIDER'S. It is rendered as text (never HTML), always
 *      attributed, and its warnings — including prompt-injection shape — are
 *      shown next to it rather than swallowed.
 *
 * There is no payment UI here: this build cannot charge, and a disabled button
 * that explains why is more honest than a flow that would fail at the last step.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CONSENT_CATEGORIES, composeConsentMessage } from '../../lib/intent-ai/agentHub/consent.js';
import { HUB_STATUS_COPY, parseResultBlocks, stateLabel } from '../../lib/intent-ai/agentHub/render.js';
import {
  addSource,
  cancelTask,
  createTask,
  getCatalog,
  primeCatalogCache,
  getTask,
  listConnections,
  listTasks,
  newIdempotencyKey,
  removeSource,
  revokeConnection
} from '../../lib/intent-ai/agentHub/client.js';
import RecommendedAgents from './RecommendedAgents.jsx';
import '../../styles/agent-hub.css';

const ACCESS_FILTERS = [
  { id: 'all', fa: 'همه', en: 'All' },
  { id: 'free', fa: 'رایگان', en: 'Free' },
  { id: 'account', fa: 'با حساب', en: 'Account' },
  { id: 'paid', fa: 'پرداخت مستقیم', en: 'Paid' }
];

const ACCESS_LABELS = {
  USER_SUPPLIED: { fa: 'ایجنت خودتان', en: 'Your own agent' },
  FREE_PUBLIC: { fa: 'رایگان', en: 'Free' },
  PROVIDER_SPONSORED: { fa: 'حمایت ارائه‌دهنده', en: 'Provider sponsored' },
  FREE_ACCOUNT: { fa: 'با حساب ارائه‌دهنده', en: 'Provider account' },
  EXTERNAL_SUBSCRIPTION: { fa: 'با اشتراک ارائه‌دهنده', en: 'Provider subscription' },
  DIRECT_CRYPTO_PAYMENT: { fa: 'پرداخت مستقیم به ارائه‌دهنده', en: 'Pay provider directly' }
};

const STATUS_TONE = {
  LIVE: 'ok',
  DEGRADED: 'warn',
  ACCOUNT_REQUIRED: 'info',
  PAYMENT_REQUIRED: 'info',
  UNAVAILABLE: 'bad',
  REGION_RESTRICTED: 'bad',
  UNCONFIGURED: 'muted',
  DISABLED: 'muted'
};

const STATUS_LABELS = {
  LIVE: { fa: 'فعال', en: 'Live' },
  DEGRADED: { fa: 'کند', en: 'Degraded' },
  ACCOUNT_REQUIRED: { fa: 'نیازمند حساب', en: 'Account required' },
  PAYMENT_REQUIRED: { fa: 'نیازمند پرداخت', en: 'Payment required' },
  UNAVAILABLE: { fa: 'در دسترس نیست', en: 'Unavailable' },
  REGION_RESTRICTED: { fa: 'محدودیت منطقه', en: 'Region restricted' },
  UNCONFIGURED: { fa: 'پیکربندی نشده', en: 'Not configured' },
  DISABLED: { fa: 'خاموش', en: 'Disabled' }
};

const accessKey = (model) => (model === 'DIRECT_CRYPTO_PAYMENT' ? 'paid' : (model === 'FREE_ACCOUNT' || model === 'EXTERNAL_SUBSCRIPTION') ? 'account' : 'free');

/* The add-source form is the one place a user types a URL, so every refusal
   the server can produce has a sentence that tells them what to fix. The raw
   code is printed next to it — an operator pasting it into a ticket is how
   these get diagnosed — but the sentence is what the user acts on. */
const SOURCE_ERROR_COPY = Object.freeze({
  SOURCE_URL_REQUIRED: { fa: 'نشانی کارت ایجنت را وارد کنید.', en: 'Enter the agent card URL.' },
  SOURCE_URL_INVALID: { fa: 'نشانی معتبر نیست؛ باید با https:// شروع شود.', en: 'That is not a valid URL. It must start with https://.' },
  PROVIDER_URL_NOT_HTTPS: { fa: 'فقط نشانی‌های https:// پذیرفته می‌شود.', en: 'Only https:// addresses are accepted.' },
  PROVIDER_URL_IS_IP: { fa: 'به‌جای IP عددی، دامنهٔ ارائه‌دهنده را وارد کنید.', en: 'Use the provider domain, not a numeric IP.' },
  PROVIDER_URL_PRIVATE_HOST: { fa: 'این میزبان خصوصی است و از اینجا در دسترس نیست.', en: 'That host is private and cannot be reached from here.' },
  PROVIDER_URL_HAS_CREDENTIALS: { fa: 'نام‌کاربری یا گذرواژه را از نشانی بردارید.', en: 'Remove the username or password from the URL.' },
  PROVIDER_URL_HAS_QUERY: { fa: 'بخش پرس‌وجو (?) را از نشانی بردارید.', en: 'Remove the query string from the URL.' },
  PROVIDER_URL_NONSTANDARD_PORT: { fa: 'فقط پورت استاندارد https (443) پذیرفته می‌شود.', en: 'Only the standard https port (443) is accepted.' },
  SOURCE_CARD_UNREACHABLE: {
    fa: 'از آن نشانی کارت ایجنتی نیامد. نشانی را بررسی کنید و مطمئن شوید ارائه‌دهنده درخواست از بیرون را می‌پذیرد.',
    en: 'Nothing answered with an agent card at that address. Check the URL and that the provider accepts external requests.'
  },
  SOURCE_CARD_INVALID: { fa: 'آن صفحه کارت ایجنت A2A معتبر نیست (نام ایجنت ندارد).', en: 'That page is not a valid A2A agent card (no agent name).' },
  SOURCE_LIMIT_REACHED: { fa: 'به سقف ایجنت‌های قابل‌افزودن رسیده‌اید؛ اول یکی را حذف کنید.', en: 'You have reached the number of agents you can add. Remove one first.' },
  SOURCE_RATE_LIMITED: { fa: 'افزودن ایجنت بیش از حد پشت‌سرهم بود؛ چند دقیقه بعد دوباره امتحان کنید.', en: 'Too many new agents in a short time. Try again in a few minutes.' },
  STRONG_OWNER_REQUIRED: { fa: 'این کار را از اپ روی دستگاه خودتان انجام دهید تا حساب شما شناسایی شود.', en: 'Do this from the app on your device so FBT can identify your account.' }
});

export function sourceErrorText(code, fa, detail = null) {
  const row = SOURCE_ERROR_COPY[code];
  if (row) return fa ? row.fa : row.en;
  return detail || (fa ? 'افزودن ایجنت انجام نشد.' : 'The agent could not be added.');
}
const testIdPart = (id) => String(id || '').replace(/[^A-Za-z0-9_-]+/g, '-');
const fmt = (value, fa) => {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(fa ? 'fa-IR' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function Badge({ status, fa }) {
  const label = STATUS_LABELS[status]?.[fa ? 'fa' : 'en'] || status;
  return <span className="ah-badge" data-tone={STATUS_TONE[status] || 'muted'}>{label}</span>;
}

function Segments({ items, value, onChange, testPrefix, ariaLabel = 'Agent hub views' }) {
  return (
    <div className="ah-segments" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className="ah-segment"
          data-active={value === item.id}
          onClick={() => onChange(item.id)}
          data-testid={`${testPrefix}-${item.id}`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Sanitized, attributed result: text nodes and https links, nothing else. */
export function ResultView({ result, fa }) {
  const blocks = useMemo(() => parseResultBlocks(result?.text || ''), [result?.text]);
  if (!result?.text) return null;
  return (
    <div className="ah-result" data-testid="agent-hub-result">
      {result.warnings?.length ? (
        <div className="ah-warn" role="alert" data-testid="agent-hub-result-warning">
          <strong>{fa ? 'هشدار: متن ارائه‌دهنده شبیه دستور است' : 'Warning: the provider text reads like an instruction'}</strong>
          <p>{fa
            ? 'این متن از یک سرویس خارجی است. FBT آن را فقط نمایش می‌دهد؛ نمی‌تواند ابزار اجرا کند، تراکنش بسازد یا پرداخت آغاز کند.'
            : 'This text came from an external service. FBT only displays it: it cannot run tools, build a transaction or start a payment on its own.'}</p>
          <ul>{result.warnings.slice(0, 3).map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      ) : null}

      <div className="ah-result-body">
        {blocks.map((block, index) => {
          if (block.type === 'heading') {
            const Tag = block.level === 1 ? 'h4' : 'h5';
            return <Tag key={index}>{block.segments.map((seg, i) => seg.type === 'link'
              ? <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer nofollow">{seg.text}</a>
              : <span key={i}>{seg.text}</span>)}</Tag>;
          }
          if (block.type === 'list') {
            return (
              <ul key={index}>
                {block.items.map((item, i) => (
                  <li key={i}>{item.segments.map((seg, j) => seg.type === 'link'
                    ? <a key={j} href={seg.href} target="_blank" rel="noopener noreferrer nofollow">{seg.text}</a>
                    : <span key={j}>{seg.text}</span>)}</li>
                ))}
              </ul>
            );
          }
          if (block.type === 'code') return <pre key={index}><code>{block.text}</code></pre>;
          return (
            <p key={index}>
              {block.segments.map((seg, i) => seg.type === 'link'
                ? <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer nofollow">{seg.text}</a>
                : <span key={i}>{seg.text}</span>)}
            </p>
          );
        })}
      </div>

      {result.citations?.length ? (
        <div className="ah-citations" data-testid="agent-hub-citations">
          <span>{fa ? 'منابع' : 'Sources'}</span>
          <ul>
            {result.citations.slice(0, 8).map((url) => (
              <li key={url}><a href={url} target="_blank" rel="noopener noreferrer nofollow">{url.replace(/^https:\/\//, '').slice(0, 90)}</a></li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What this surface is, in three sentences, before any list.
 *
 * It is here because the honest possible states of this page used to be "a
 * single line saying nothing is enabled" and that reads like a broken screen.
 * The reviewed execution catalogue remains server-owned; a separate editorial
 * directory is clearly labelled and never promotes a provider as FBT-approved.
 * This explains the user-supplied A2A path and its consent boundary.
 */
export function HubIntro({ fa }) {
  const steps = fa
    ? [
      { n: '۱', t: 'کارت ایجنت', d: 'نشانی کارت A2A ایجنت را می‌دهید؛ FBT همان کارت را می‌خواند و مهارت‌های اعلام‌شده را فهرست می‌کند.' },
      { n: '۲', t: 'رضایت شما', d: 'پیش از هر ارسال، دقیقاً همان متنی را که فرستاده می‌شود می‌بینید و انتخاب می‌کنید چه چیزی به اشتراک گذاشته شود.' },
      { n: '۳', t: 'اجرا نزد ارائه‌دهنده', d: 'هوش و اجرای ایجنت روی زیرساخت خودِ ارائه‌دهنده می‌ماند. FBT واسط است، نه مالک و نه واسطهٔ پول.' }
    ]
    : [
      { n: '1', t: 'Agent card', d: 'You supply an A2A card URL; FBT reads that card and lists the skills it declares.' },
      { n: '2', t: 'Your consent', d: 'Before anything is sent you see the exact message, and you choose what is shared.' },
      { n: '3', t: 'Runs at the provider', d: 'The agent and its intelligence stay on the provider’s infrastructure. FBT is the interface, not the owner and not a payment intermediary.' }
    ];
  return (
    <section className="ah-intro" data-testid="agent-hub-intro">
      <div className="ah-intro-head">
        <h3>{fa ? 'ایجنت خارجی چیست؟' : 'What is an external agent?'}</h3>
        <p className="ah-muted ah-small">
          {fa
            ? 'ایجنت خارجی، ایجنتی است که شخص دیگری آن را اجرا می‌کند. FBT آن را نمی‌سازد، نمی‌فروشد و کمیسیون نمی‌گیرد؛ فقط رابط، بروکرِ وظیفه و رضایت شماست.'
            : 'An external agent is one somebody else runs. FBT does not build it, sell it or take a commission — it is the interface, the task broker and your consent.'}
        </p>
      </div>
      <ol className="ah-steps">
        {steps.map((step) => (
          <li key={step.n} className="ah-step">
            <span className="ah-step-n" aria-hidden="true">{step.n}</span>
            <div>
              <strong>{step.t}</strong>
              <p className="ah-muted ah-small">{step.d}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function AgentHubPanel({ fa = false, onClose = null }) {
  /* Recommendations are useful even while the reviewed execution registry is
     empty, so make that honest, source-linked view the landing subtab. */
  const [tab, setTab] = useState('recommended');
  const [catalog, setCatalog] = useState({ state: 'loading', data: null, error: null });
  const [query, setQuery] = useState('');
  const [access, setAccess] = useState('all');
  const [selected, setSelected] = useState(null); // the agent object from the catalogue
  const [detail, setDetail] = useState({ state: 'idle', agent: null, error: null });
  const [taskText, setTaskText] = useState('');
  const [sharing, setSharing] = useState({ wallet_address: false, portfolio_summary: false, conversation_excerpt: false });
  const [values, setValues] = useState({ walletAddress: '', totalUsd: '', ethUsd: '', excerpt: '' });
  const [approved, setApproved] = useState(false);
  const [run, setRun] = useState({ state: 'idle', task: null, error: null, code: null, detail: null });
  const [activity, setActivity] = useState({ state: 'idle', tasks: [] });
  const [connections, setConnections] = useState({ state: 'idle', list: [], capability: null });
  const [notice, setNotice] = useState(null);
  const [sourceForm, setSourceForm] = useState({ url: '', label: '', state: 'idle', error: null, detail: null });
  const keyRef = useRef(newIdempotencyKey('hub'));
  const inflightRef = useRef(false);

  const reloadCatalog = useCallback(async () => {
    setCatalog((prev) => ({ ...prev, state: 'loading', error: null }));
    const out = await getCatalog();
    if (!out.ok) {
      setCatalog({ state: 'error', data: null, error: out.code || 'CATALOG_UNAVAILABLE' });
      return;
    }
    /* The tab switch reads the same answer, so it never shows a count that
       disagrees with the list right below it. */
    primeCatalogCache(out);
    setCatalog({ state: 'ready', data: out, error: null });
  }, []);

  useEffect(() => { void reloadCatalog(); }, [reloadCatalog]);

  const loadActivity = useCallback(async () => {
    setActivity((prev) => ({ ...prev, state: 'loading' }));
    const out = await listTasks(30);
    setActivity({ state: out.ok ? 'ready' : 'error', tasks: out.ok ? out.tasks || [] : [] });
  }, []);

  const loadConnections = useCallback(async () => {
    setConnections((prev) => ({ ...prev, state: 'loading' }));
    const out = await listConnections();
    setConnections({
      state: out.ok ? 'ready' : 'error',
      list: out.ok ? out.connections || [] : [],
      capability: out.ok ? out.capability || null : null
    });
  }, []);

  useEffect(() => {
    if (tab === 'activity') void loadActivity();
    if (tab === 'connected') void loadConnections();
  }, [tab, loadActivity, loadConnections]);

  /* Poll only while a task is genuinely moving. A terminal task costs nothing;
     an unknown one (`reconciling`) keeps checking, because the provider may
     still finish it. */
  const taskId = run.task?.id;
  const taskActive = run.task?.active === true || run.task?.state === 'reconciling';
  useEffect(() => {
    if (!taskId || !taskActive) return undefined;
    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped) return;
      const out = await getTask(taskId);
      if (!stopped && out.ok) setRun((prev) => ({ ...prev, task: out.task }));
    }, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [taskId, taskActive]);

  const agents = catalog.data?.agents || [];
  const providers = catalog.data?.providers || [];
  const sources = providers.filter((provider) => provider.source === 'user');
  const filtered = useMemo(() => agents.filter((agent) => {
    if (access !== 'all' && accessKey(agent.accessModel) !== access) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    return [agent.name, agent.summary, agent.providerName, ...(agent.capabilities || [])]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  }), [agents, access, query]);

  const categories = useMemo(() => [
    'task_text',
    ...CONSENT_CATEGORIES.filter((c) => c !== 'task_text' && sharing[c])
  ], [sharing]);

  const context = useMemo(() => {
    const out = {};
    if (sharing.wallet_address) out.walletAddress = values.walletAddress.trim();
    if (sharing.portfolio_summary) {
      const portfolio = {};
      if (values.totalUsd !== '') portfolio.totalUsd = Number(values.totalUsd);
      if (values.ethUsd !== '') portfolio.ethUsd = Number(values.ethUsd);
      if (Object.keys(portfolio).length) out.portfolio = portfolio;
    }
    if (sharing.conversation_excerpt) out.excerpt = values.excerpt.trim();
    return out;
  }, [sharing, values]);

  const preview = useMemo(
    () => composeConsentMessage({ taskText, categories, context }),
    [taskText, categories, context]
  );

  const openAgent = useCallback(async (agent) => {
    setSelected(agent);
    setRun({ state: 'idle', task: null, error: null, code: null, detail: null });
    setApproved(false);
    setTaskText('');
    keyRef.current = newIdempotencyKey('hub');
    setDetail({ state: 'loading', agent, error: null });
    const out = await getCatalog();
    if (out.ok) {
      const fresh = (out.agents || []).find((a) => a.id === agent.id);
      if (fresh) setSelected(fresh);
      setCatalog({ state: 'ready', data: out, error: null });
    }
    setDetail({ state: 'ready', agent, error: null });
  }, []);

  const startTask = useCallback(async () => {
    if (!selected || !preview.ok || !approved || inflightRef.current) return;
    inflightRef.current = true;
    setRun({ state: 'starting', task: null, error: null, code: null, detail: null });
    const out = await createTask({
      agentId: selected.id,
      taskText,
      categories: preview.categories,
      context,
      idempotencyKey: keyRef.current
    });
    inflightRef.current = false;
    if (!out.ok) {
      setRun({ state: 'error', task: null, error: out.code || 'TASK_FAILED', code: out.code || null, detail: out.detail || null });
      return;
    }
    setRun({ state: 'ready', task: out.task, error: null, code: null, detail: null });
  }, [selected, preview, approved, taskText, context]);

  /* Adding or removing a source re-reads the catalogue instead of patching the
     local copy: the server is the only place that knows whether the card was
     reachable, and a card that fails verification must never appear as if it
     had been added. */
  const addSourceToHub = useCallback(async () => {
    const cardUrl = sourceForm.url.trim();
    if (!cardUrl) {
      setSourceForm((prev) => ({ ...prev, state: 'error', error: 'SOURCE_URL_REQUIRED', detail: null }));
      return;
    }
    setSourceForm((prev) => ({ ...prev, state: 'working', error: null, detail: null }));
    const out = await addSource({ cardUrl, label: sourceForm.label.trim() });
    if (!out.ok) {
      setSourceForm((prev) => ({ ...prev, state: 'error', error: out.code || 'SOURCE_CARD_UNREACHABLE', detail: out.detail || out.reason || null }));
      return;
    }
    setSourceForm({ url: '', label: '', state: 'idle', error: null, detail: null });
    setNotice({
      tone: 'ok',
      text: fa
        ? `ایجنت «${out.source?.card?.name || cardUrl}» اضافه و کارتش بررسی شد.`
        : `“${out.source?.card?.name || cardUrl}” was added and its card verified.`
    });
    await reloadCatalog();
  }, [sourceForm.url, sourceForm.label, fa, reloadCatalog]);

  const removeSourceFromHub = useCallback(async (sourceId) => {
    const out = await removeSource(sourceId);
    if (!out.ok) {
      setNotice({ tone: 'warn', text: out.detail || out.code || (fa ? 'حذف انجام نشد.' : 'The agent could not be removed.') });
      return;
    }
    await reloadCatalog();
  }, [fa, reloadCatalog]);

  const stopTask = useCallback(async () => {
    if (!run.task?.id) return;
    const out = await cancelTask(run.task.id);
    if (out.ok) setRun((prev) => ({ ...prev, task: out.task }));
    else setNotice({ tone: 'warn', text: out.detail || (fa ? 'ارائه‌دهنده لغو را تأیید نکرد.' : 'The provider did not confirm the cancellation.') });
  }, [run.task?.id, fa]);

  const previewLines = preview.ok ? preview.text : null;
  const detailAgent = selected;
  const canStart = Boolean(preview.ok && approved && run.state !== 'starting' && detailAgent?.status === 'LIVE');

  /* ── detail view ───────────────────────────────────────────────────────── */
  if (detailAgent) {
    const provider = detailAgent.provider || {};
    return (
      <div className="ah-panel" data-testid="agent-hub-detail">
        <div className="ah-detail-head">
          <button type="button" className="ah-ghost" onClick={() => { setSelected(null); setRun({ state: 'idle', task: null, error: null }); }}>
            {fa ? '→ بازگشت' : '← Back'}
          </button>
          <Badge status={detailAgent.status} fa={fa} />
        </div>

        <h3>{detailAgent.name}</h3>
        <p className="ah-muted">{detailAgent.summary}</p>
        <div className="ah-attrib" data-testid="agent-hub-attribution">
          {fa ? 'ارائه‌دهنده: ' : 'Provider: '}
          <strong>{detailAgent.providerName}</strong>
          {provider.websiteUrl ? <a href={provider.websiteUrl} target="_blank" rel="noopener noreferrer nofollow">{fa ? 'سایت' : 'site'}</a> : null}
          {provider.documentationUrl ? <a href={provider.documentationUrl} target="_blank" rel="noopener noreferrer nofollow">{fa ? 'مستندات' : 'docs'}</a> : null}
          {provider.termsUrl ? <a href={provider.termsUrl} target="_blank" rel="noopener noreferrer nofollow">{fa ? 'شرایط' : 'terms'}</a> : null}
          {provider.privacyUrl ? <a href={provider.privacyUrl} target="_blank" rel="noopener noreferrer nofollow">{fa ? 'حریم خصوصی' : 'privacy'}</a> : null}
        </div>

        <dl className="ah-facts">
          <div><dt>{fa ? 'دسترسی' : 'Access'}</dt><dd>{ACCESS_LABELS[detailAgent.accessModel]?.[fa ? 'fa' : 'en'] || detailAgent.accessModel}</dd></div>
          <div><dt>{fa ? 'هزینه' : 'Cost'}</dt><dd>{detailAgent.costSummary || (fa ? 'اعلام نشده' : 'Not stated')}</dd></div>
          <div><dt>{fa ? 'آخرین بررسی زنده' : 'Last live check'}</dt><dd>{fmt(detailAgent.lastLiveCheckAt, fa)}</dd></div>
          <div><dt>{fa ? 'بازبینی ارائه‌دهنده' : 'Provider review'}</dt><dd>{provider.reviewedAt || '—'}</dd></div>
          <div><dt>{fa ? 'آموزش مدل روی پرامپت' : 'Prompts used for training'}</dt><dd>{provider.dataPolicy?.promptTraining || (fa ? 'نامشخص' : 'unknown')}</dd></div>
          <div><dt>{fa ? 'نگهداری داده' : 'Data retention'}</dt><dd>{provider.dataPolicy?.dataRetention || (fa ? 'نامشخص' : 'unknown')}</dd></div>
        </dl>

        {provider.jurisdiction?.providerRestrictions?.length ? (
          <p className="ah-note">
            {fa ? 'شرایط ارائه‌دهنده: ' : 'Provider restrictions: '}
            {provider.jurisdiction.providerRestrictions.join(' · ')}
          </p>
        ) : null}
        {detailAgent.requiresPayment ? (
          <p className="ah-note ah-note-warn" data-testid="agent-hub-paid-note">
            {fa
              ? 'این ایجنت مستقیم از ارائه‌دهنده خریداری می‌شود. در این نسخه پرداخت فعال نیست؛ هیچ مبلغی از شما گرفته نمی‌شود.'
              : 'This agent is paid directly to the provider. Paid invocation is not enabled in this build; nothing will be charged.'}
          </p>
        ) : null}
        {detailAgent.requiresAccount ? (
          <p className="ah-note" data-testid="agent-hub-account-note">
            {fa
              ? 'این ایجنت به حساب خودتان نزد ارائه‌دهنده نیاز دارد و در تب «متصل‌ها» مدیریت می‌شود.'
              : 'This agent needs your own provider account. Manage it in the Connected tab.'}
          </p>
        ) : null}

        {/* ── run form ── */}
        {run.task ? (
          <div className="ah-run" data-testid="agent-hub-run">
            <div className="ah-run-head">
              <span className="ah-state" data-state={run.task.state} data-testid="agent-hub-task-state">
                {stateLabel(run.task.state, fa)}
              </span>
              {run.task.terminal ? null : (
                <button type="button" className="ah-ghost" onClick={stopTask}>{fa ? 'لغو' : 'Cancel'}</button>
              )}
            </div>
            {run.task.needsReconciliation ? (
              <p className="ah-note ah-note-warn" role="status">
                {fa
                  ? 'نتیجه نامشخص است. FBT عمداً درخواست دومی نمی‌سازد چون ممکن است نسخه اول نزد ارائه‌دهنده در حال اجرا باشد.'
                  : 'The outcome is unknown. FBT deliberately does not send a second request: the first may still be running at the provider.'}
              </p>
            ) : null}
            {run.task.errorCode ? <p className="ah-note ah-note-warn">{run.task.safeErrorMessage || run.task.errorCode}</p> : null}
            {run.task.result ? <ResultView result={run.task.result} fa={fa} /> : null}
            <p className="ah-muted ah-small">
              {fa ? 'ارجاع وظیفه نزد ارائه‌دهنده: ' : 'Provider task reference: '}
              <code>{run.task.remoteTaskRef || '—'}</code>
              {' · '}
              {fa ? 'هزینه گزارش‌شده: ' : 'Reported cost: '}
              {run.task.costReported?.amount != null ? `${run.task.costReported.amount} ${run.task.costReported.asset || ''}` : (fa ? 'صفر (بدون کارمزد FBT)' : 'zero (no FBT fee)')}
            </p>
            <button type="button" className="ah-primary" onClick={() => { setRun({ state: 'idle', task: null, error: null }); keyRef.current = newIdempotencyKey('hub'); setApproved(false); }}>
              {fa ? 'درخواست جدید' : 'New request'}
            </button>
          </div>
        ) : (
          <div className="ah-form">
            <label className="ah-label" htmlFor="ah-task">
              {fa ? 'درخواست شما از این ایجنت' : 'Your request to this agent'}
            </label>
            <textarea
              id="ah-task"
              className="ah-input ah-textarea"
              data-testid="agent-hub-task-text"
              value={taskText}
              maxLength={2000}
              onChange={(event) => { setTaskText(event.target.value); setApproved(false); keyRef.current = newIdempotencyKey('hub'); }}
              placeholder={fa ? 'مثلاً: ریسک تمرکز این کیف پول را بررسی کن' : 'e.g. Review the concentration risk of this wallet'}
            />
            {detailAgent.examples?.length ? (
              <div className="ah-suggest">
                {detailAgent.examples.slice(0, 3).map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="ah-chip"
                    onClick={() => { setTaskText(example); setApproved(false); keyRef.current = newIdempotencyKey('hub'); }}
                  >
                    {example}
                  </button>
                ))}
              </div>
            ) : null}

            <fieldset className="ah-context">
              <legend>{fa ? 'چه چیزی با ارائه‌دهنده به اشتراک گذاشته شود؟' : 'What is shared with the provider?'}</legend>
              <p className="ah-muted ah-small">
                {fa
                  ? 'متن درخواست همیشه ارسال می‌شود. بقیه موارد فقط اگر خودتان تیک بزنید. FBT هیچ داده‌ای را بدون انتخاب شما اضافه نمی‌کند.'
                  : 'The request text is always sent. Everything else only if you tick it. FBT adds no data you did not choose.'}
              </p>
              <label className="ah-check">
                <input type="checkbox" checked readOnly data-testid="agent-hub-context-task" />
                <span>{fa ? 'متن درخواست' : 'Request text'} ({CONSENT_CATEGORIES.includes('task_text') ? 'task_text' : ''})</span>
              </label>
              <label className="ah-check">
                <input
                  type="checkbox"
                  checked={sharing.wallet_address}
                  onChange={(event) => { setSharing((prev) => ({ ...prev, wallet_address: event.target.checked })); setApproved(false); }}
                  data-testid="agent-hub-context-wallet"
                />
                <span>{fa ? 'آدرس عمومی کیف پول' : 'Public wallet address'}</span>
              </label>
              {sharing.wallet_address ? (
                <input
                  className="ah-input"
                  value={values.walletAddress}
                  onChange={(event) => { setValues((prev) => ({ ...prev, walletAddress: event.target.value })); setApproved(false); }}
                  placeholder="0x… / Solana address"
                  aria-label={fa ? 'آدرس کیف پول' : 'Wallet address'}
                  data-testid="agent-hub-wallet-value"
                />
              ) : null}
              <label className="ah-check">
                <input
                  type="checkbox"
                  checked={sharing.portfolio_summary}
                  onChange={(event) => { setSharing((prev) => ({ ...prev, portfolio_summary: event.target.checked })); setApproved(false); }}
                  data-testid="agent-hub-context-portfolio"
                />
                <span>{fa ? 'جمع پورتفوی (عددی که خودتان وارد می‌کنید)' : 'Portfolio totals (numbers you type)'}</span>
              </label>
              {sharing.portfolio_summary ? (
                <div className="ah-row">
                  <input
                    className="ah-input"
                    inputMode="decimal"
                    value={values.totalUsd}
                    onChange={(event) => { setValues((prev) => ({ ...prev, totalUsd: event.target.value })); setApproved(false); }}
                    placeholder={fa ? 'ارزش کل (دلار)' : 'total USD'}
                    aria-label={fa ? 'ارزش کل' : 'Total USD'}
                  />
                  <input
                    className="ah-input"
                    inputMode="decimal"
                    value={values.ethUsd}
                    onChange={(event) => { setValues((prev) => ({ ...prev, ethUsd: event.target.value })); setApproved(false); }}
                    placeholder={fa ? 'بخش ETH (دلار)' : 'ETH USD'}
                    aria-label={fa ? 'بخش ETH' : 'ETH USD'}
                  />
                </div>
              ) : null}
              <label className="ah-check">
                <input
                  type="checkbox"
                  checked={sharing.conversation_excerpt}
                  onChange={(event) => { setSharing((prev) => ({ ...prev, conversation_excerpt: event.target.checked })); setApproved(false); }}
                  data-testid="agent-hub-context-excerpt"
                />
                <span>{fa ? 'بخشی از این گفتگو' : 'An excerpt of this chat'}</span>
              </label>
              {sharing.conversation_excerpt ? (
                <textarea
                  className="ah-input ah-textarea ah-textarea-sm"
                  value={values.excerpt}
                  maxLength={1200}
                  onChange={(event) => { setValues((prev) => ({ ...prev, excerpt: event.target.value })); setApproved(false); }}
                  placeholder={fa ? 'متنی را که اجازه می‌دهید ارسال شود بچسبانید' : 'Paste the text you allow to be sent'}
                  aria-label={fa ? 'بخش گفتگو' : 'Conversation excerpt'}
                />
              ) : null}
            </fieldset>

            <div className="ah-preview" data-testid="agent-hub-preview">
              <div className="ah-preview-head">
                <strong>{fa ? 'دقیقاً این متن ارسال می‌شود' : 'Exactly this text is sent'}</strong>
                <span className="ah-muted ah-small">{preview.ok ? `${preview.bytes} B · ${preview.categories.join(' · ')}` : (fa ? 'ناقص' : 'incomplete')}</span>
              </div>
              {previewLines ? <pre className="ah-pre">{previewLines}</pre> : (
                <p className="ah-muted ah-small" role="status">
                  {fa ? 'برای دیدن پیش‌نمایش، درخواست را بنویسید و مقادیر انتخاب‌شده را کامل کنید.' : 'Write the request and complete the selected values to see the preview.'}
                </p>
              )}
            </div>

            <label className="ah-check ah-check-strong">
              <input
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
                data-testid="agent-hub-consent-approve"
              />
              <span>
                {fa
                  ? 'می‌دانم این متن به ارائه‌دهنده خارجی ارسال می‌شود و شرایط و حریم خصوصی او اعمال می‌شود.'
                  : 'I understand this text goes to an external provider, under their terms and privacy policy.'}
              </span>
            </label>

            {run.state === 'error' ? (
              <p className="ah-error" role="alert" data-testid="agent-hub-error">
                {run.detail || run.error}
              </p>
            ) : null}

            <button
              type="button"
              className="ah-primary"
              disabled={!canStart}
              onClick={startTask}
              data-testid="agent-hub-start"
            >
              {run.state === 'starting'
                ? (fa ? 'در حال ارسال…' : 'Sending…')
                : detailAgent.status !== 'LIVE'
                  ? (STATUS_LABELS[detailAgent.status]?.[fa ? 'fa' : 'en'] || detailAgent.status)
                  : (fa ? 'شروع وظیفه' : 'Start task')}
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ── list view ─────────────────────────────────────────────────────────── */
  const disabled = catalog.state === 'ready' && catalog.data?.enabled === false;
  const empty = catalog.state === 'ready' && catalog.data?.enabled === true && agents.length === 0;

  return (
    <div className="ah-panel" data-testid="agent-hub-panel">
      <div className="ah-top">
        <Segments
          items={[
            { id: 'recommended', label: fa ? 'پیشنهادی' : 'Recommended' },
            { id: 'discover', label: fa ? 'کشف / افزودن' : 'Discover / Add' },
            { id: 'connected', label: fa ? 'متصل‌ها' : 'Connected' },
            { id: 'activity', label: fa ? 'فعالیت' : 'Activity' }
          ]}
          value={tab}
          onChange={setTab}
          testPrefix="agent-hub-tab"
          ariaLabel={fa ? 'بخش‌های ایجنت خارجی' : 'External agent sections'}
        />
        {onClose ? <button type="button" className="ah-ghost" onClick={onClose}>{fa ? 'بستن' : 'Close'}</button> : null}
      </div>

      {notice ? (
        <p className={`ah-note ${notice.tone === 'ok' ? 'ah-note-ok' : 'ah-note-warn'}`} role="status" data-testid="agent-hub-notice">
          {notice.text}
        </p>
      ) : null}

      {tab === 'recommended' ? (
        <RecommendedAgents fa={fa} onAddOwnAgent={() => setTab('discover')} />
      ) : null}

      {tab === 'discover' ? (
        <>
          {catalog.state === 'loading' ? <p className="ah-muted" role="status">{fa ? 'در حال خواندن فهرست…' : 'Loading the catalogue…'}</p> : null}
          {catalog.state === 'error' ? (
            <p className="ah-error" role="alert" data-testid="agent-hub-status">
              {fa ? 'فهرست خوانده نشد.' : 'The catalogue could not be read.'} ({catalog.error})
            </p>
          ) : null}
          {disabled ? (
            <p className="ah-note" role="status" data-testid="agent-hub-status">
              {fa ? HUB_STATUS_COPY.DISABLED.fa : HUB_STATUS_COPY.DISABLED.en}
              {catalog.data?.detail ? ` — ${catalog.data.detail}` : ''}
            </p>
          ) : null}

          {!disabled ? (
            <HubIntro fa={fa} />
          ) : null}

          {!disabled ? (
            <>
              {empty ? (
                <p className="ah-note" role="status" data-testid="agent-hub-status">
                  {fa ? HUB_STATUS_COPY.EMPTY.fa : HUB_STATUS_COPY.EMPTY.en}
                </p>
              ) : null}

              {/* ── YOUR OWN AGENTS ────────────────────────────────────────
                  The reviewed catalogue can be empty for a whole deployment.
                  This block is what makes the page useful in that state: the
                  user names an A2A agent card, FBT verifies the address and
                  the card, and the agent appears below labelled as THEIRS —
                  never as an FBT-reviewed listing. */}
              <section className="ah-sources" data-testid="agent-hub-sources">
                <div className="ah-sources-head">
                  <div>
                    <strong>{fa ? 'ایجنت خودتان را اضافه کنید' : 'Add your own agent'}</strong>
                    <p className="ah-muted ah-small">
                      {fa
                        ? 'نشانی «کارت ایجنت» (A2A) را وارد کنید. FBT نشانی و کارت را بررسی می‌کند، اما این ایجنت را خودتان انتخاب کرده‌اید و تأییدِ FBT نیست.'
                        : 'Paste an A2A agent-card URL. FBT checks the address and the card; the agent is your choice, not an FBT-reviewed listing.'}
                    </p>
                  </div>
                  <span className="ah-badge" data-tone="muted" data-testid="agent-hub-source-count">
                    {sources.length}/{catalog.data?.sources?.cap ?? 8}
                  </span>
                </div>

                <div className="ah-row">
                  <input
                    className="ah-input"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    dir="ltr"
                    value={sourceForm.url}
                    onChange={(event) => setSourceForm((prev) => ({ ...prev, url: event.target.value, error: null }))}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addSourceToHub(); } }}
                    placeholder="https://agent.example.com/.well-known/agent-card.json"
                    aria-label={fa ? 'نشانی کارت ایجنت' : 'Agent card URL'}
                    data-testid="agent-hub-source-url"
                  />
                  <input
                    className="ah-input"
                    value={sourceForm.label}
                    onChange={(event) => setSourceForm((prev) => ({ ...prev, label: event.target.value }))}
                    maxLength={60}
                    placeholder={fa ? 'نام دلخواه (اختیاری)' : 'Label (optional)'}
                    aria-label={fa ? 'نام دلخواه' : 'Label'}
                    data-testid="agent-hub-source-label"
                  />
                </div>

                <button
                  type="button"
                  className="ah-primary ah-primary-sm"
                  disabled={sourceForm.state === 'working' || !sourceForm.url.trim()}
                  onClick={() => void addSourceToHub()}
                  data-testid="agent-hub-source-add"
                >
                  {sourceForm.state === 'working'
                    ? (fa ? 'در حال بررسی کارت…' : 'Checking the card…')
                    : (fa ? 'افزودن و بررسی' : 'Add and verify')}
                </button>

                {sourceForm.error ? (
                  <p className="ah-error" role="alert" data-testid="agent-hub-source-error">
                    {sourceErrorText(sourceForm.error, fa, sourceForm.detail)}
                    <code className="ah-code">{sourceForm.error}</code>
                  </p>
                ) : null}

                {catalog.data?.durable === false ? (
                  <p className="ah-note ah-note-warn" data-testid="agent-hub-sources-durability">
                    {fa
                      ? 'این نسخه ذخیره‌سازی پایدار ندارد؛ ایجنت‌هایی که اضافه می‌کنید ممکن است با راه‌اندازی مجدد سرور از فهرست بروند. وظیفه‌ها هم در همان حالت فقط در حافظهٔ همین پروسه می‌مانند.'
                      : 'This deployment has no durable store: an agent you add may disappear when the server restarts, and task history stays in this process only.'}
                  </p>
                ) : null}

                {sources.length === 0 ? (
                  <p className="ah-muted ah-small" data-testid="agent-hub-sources-empty">
                    {fa
                      ? 'هنوز ایجنتی اضافه نکرده‌اید. هر ایجنتی که پروتکل A2A دارد و کارت عمومی منتشر می‌کند قابل افزودن است.'
                      : 'You have not added an agent yet. Anything that speaks A2A and publishes a public agent card can be added.'}
                  </p>
                ) : (
                  <ul className="ah-list">
                    {sources.map((provider) => (
                      <li key={provider.id} className="ah-card ah-card-compact" data-testid={`agent-hub-source-${testIdPart(provider.id)}`}>
                        <div className="ah-card-head">
                          <span className="ah-card-name">{provider.name}</span>
                          <span className="ah-badge" data-tone="info">{fa ? 'افزودهٔ شما' : 'Added by you'}</span>
                          <Badge status={provider.health?.ok ? 'LIVE' : 'UNAVAILABLE'} fa={fa} />
                        </div>
                        <div className="ah-card-meta">
                          <span dir="ltr">{provider.host || provider.websiteUrl || provider.id}</span>
                          <span>
                            {fa ? 'بررسی: ' : 'checked '}
                            {fmt(provider.health?.checkedAt, fa)}
                          </span>
                          {provider.health?.code ? <span dir="ltr">{provider.health.code}</span> : null}
                        </div>
                        <div className="ah-card-actions">
                          <a
                            className="ah-ghost"
                            href={provider.websiteUrl || '#'}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            onClick={(event) => { if (!provider.websiteUrl) event.preventDefault(); }}
                          >
                            {fa ? 'سایت ارائه‌دهنده' : 'Provider site'}
                          </a>
                          <button
                            type="button"
                            className="ah-ghost"
                            onClick={() => void removeSourceFromHub(provider.id)}
                            data-testid={`agent-hub-source-remove-${testIdPart(provider.id)}`}
                          >
                            {fa ? 'حذف' : 'Remove'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {agents.length ? (
                <div className="ah-tools">
                  <input
                    className="ah-input"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={fa ? 'جستجوی ایجنت یا قابلیت…' : 'Search agents or capabilities…'}
                    aria-label={fa ? 'جستجو' : 'Search'}
                    data-testid="agent-hub-search"
                  />
                  <div className="ah-filters" role="group" aria-label={fa ? 'نوع دسترسی' : 'Access type'}>
                    {ACCESS_FILTERS.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        className="ah-chip"
                        data-active={access === filter.id}
                        onClick={() => setAccess(filter.id)}
                        data-testid={`agent-hub-filter-${filter.id}`}
                      >
                        {fa ? filter.fa : filter.en}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {filtered.length === 0 ? (
                agents.length === 0 ? null : (
                  <p className="ah-muted" role="status">{fa ? 'چیزی با این جستجو پیدا نشد.' : 'Nothing matches that search.'}</p>
                )
              ) : (
                <ul className="ah-list">
                  {filtered.map((agent) => (
                    <li key={agent.id} className="ah-card" data-testid={`agent-hub-card-${testIdPart(agent.id)}`}>
                      <div className="ah-card-head">
                        <span className="ah-card-name">{agent.name}</span>
                        <Badge status={agent.status} fa={fa} />
                        {agent.source === 'user'
                          ? <span className="ah-badge" data-tone="info">{fa ? 'افزودهٔ شما' : 'Added by you'}</span>
                          : <span className="ah-badge" data-tone="muted">{fa ? 'بازبینی‌شده' : 'Reviewed'}</span>}
                      </div>
                      <p className="ah-card-summary">{agent.summary}</p>
                      <div className="ah-card-meta">
                        <span data-testid="agent-hub-provider">{agent.providerName}</span>
                        <span>{ACCESS_LABELS[agent.accessModel]?.[fa ? 'fa' : 'en'] || agent.accessModel}</span>
                        <span>{agent.costSummary || (fa ? 'هزینه اعلام نشده' : 'cost not stated')}</span>
                        {agent.supportsCancellation ? <span>{fa ? 'قابل لغو' : 'cancellable'}</span> : null}
                      </div>
                      <button type="button" className="ah-primary ah-primary-sm" onClick={() => void openAgent(agent)} data-testid={`agent-hub-open-${testIdPart(agent.id)}`}>
                        {fa ? 'جزئیات و اجرا' : 'Details and run'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'connected' ? (
        <div data-testid="agent-hub-connected">
          {connections.state === 'loading' ? <p className="ah-muted" role="status">{fa ? 'در حال خواندن…' : 'Loading…'}</p> : null}
          {connections.state === 'ready' && connections.list.length === 0 ? (
            <p className="ah-note" data-testid="agent-hub-connections-empty">
              {fa
                ? 'اتصال حساب فعلاً برای هیچ ارائه‌دهنده‌ای پیکربندی نشده است. اتصال فقط وقتی ممکن می‌شود که ارائه‌دهنده‌ای OAuth رسمی داشته باشد و در رجیستری تأیید شده باشد.'
                : 'No provider account connection is configured yet. A connection becomes possible only when a reviewed provider offers official OAuth.'}
            </p>
          ) : null}
          {connections.state === 'ready' && connections.list.length > 0 ? (
            <ul className="ah-list">
              {connections.list.map((connection) => (
                <li key={connection.id} className="ah-card">
                  <div className="ah-card-head">
                    <span className="ah-card-name">{connection.providerId}</span>
                    <Badge status="LIVE" fa={fa} />
                  </div>
                  <div className="ah-card-meta">
                    <span>{connection.externalAccountLabel || (fa ? 'حساب ارائه‌دهنده' : 'provider account')}</span>
                    <span>{connection.scopes.join(' · ')}</span>
                    <span>{connection.expiresAt ? `${fa ? 'انقضا: ' : 'expires '}${fmt(connection.expiresAt, fa)}` : (fa ? 'بدون تاریخ انقضا' : 'no expiry reported')}</span>
                  </div>
                  <button
                    type="button"
                    className="ah-ghost"
                    onClick={async () => {
                      const out = await revokeConnection(connection.id);
                      if (out.ok) void loadConnections();
                      else setNotice({ tone: 'warn', text: out.detail || out.code });
                    }}
                  >
                    {fa ? 'قطع اتصال' : 'Disconnect'}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {tab === 'activity' ? (
        <div data-testid="agent-hub-activity">
          {activity.state === 'loading' ? <p className="ah-muted" role="status">{fa ? 'در حال خواندن…' : 'Loading…'}</p> : null}
          {activity.state === 'ready' && activity.tasks.length === 0 ? (
            <p className="ah-note">{fa ? 'هنوز وظیفه‌ای اجرا نکرده‌اید.' : 'You have not run a task yet.'}</p>
          ) : null}
          <ul className="ah-list">
            {activity.tasks.map((task) => (
              <li key={task.id} className="ah-card">
                <div className="ah-card-head">
                  <span className="ah-card-name">{task.taskTitle || task.agentName}</span>
                  <span className="ah-state" data-state={task.state}>{stateLabel(task.state, fa)}</span>
                </div>
                <div className="ah-card-meta">
                  <span>{task.providerName}</span>
                  <span>{fmt(task.createdAt, fa)}</span>
                  {task.contextCategories?.length ? <span>{task.contextCategories.join(' · ')}</span> : null}
                </div>
                <button
                  type="button"
                  className="ah-ghost"
                  onClick={async () => {
                    const out = await getTask(task.id);
                    if (!out.ok) { setNotice({ tone: 'warn', text: out.detail || out.code }); return; }
                    setSelected({ id: task.agentId, name: task.agentName, providerName: task.providerName, provider: {}, status: 'LIVE', accessModel: task.priceQuote?.model || 'FREE_PUBLIC', summary: '' });
                    setRun({ state: 'ready', task: out.task, error: null });
                  }}
                >
                  {fa ? 'مشاهده نتیجه' : 'Open result'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
