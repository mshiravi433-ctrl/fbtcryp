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
  removeSourceCredential,
  revokeConnection,
  saveSourceCredential
} from '../../lib/intent-ai/agentHub/client.js';
import RecommendedAgents from './RecommendedAgents.jsx';
import NativeDataDisclosure from './NativeDataDisclosure.jsx';
import { setActiveAgent } from '../../lib/intent-ai/agentHub/activeAgent.js';
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
  STRONG_OWNER_REQUIRED: { fa: 'این کار را از اپ روی دستگاه خودتان انجام دهید تا حساب شما شناسایی شود.', en: 'Do this from the app on your device so FBT can identify your account.' },
  CREDENTIAL_STORE_UNCONFIGURED: {
    fa: 'برای ذخیرهٔ امن کلید، سرور باید AGENT_HUB_SECRET_KEY داشته باشد. بدون آن هیچ کلیدی ذخیره نمی‌شود.',
    en: 'Storing a key safely needs AGENT_HUB_SECRET_KEY on the server. Without it nothing is stored.'
  },
  AGENT_HUB_SECRET_KEY_REQUIRED: {
    fa: 'کلید رمزنگاری سرور تنظیم نشده است؛ ذخیرهٔ کلید غیرفعال است.',
    en: 'The server sealing key is not configured, so key storage is disabled.'
  },
  CREDENTIAL_SECRET_REQUIRED: { fa: 'کلید را وارد کنید (حداقل ۶ نویسه).', en: 'Enter the key (at least 6 characters).' },
  CREDENTIAL_SECRET_TOO_LONG: { fa: 'این مقدار بیش از حد بلند است.', en: 'That value is too long.' },
  CREDENTIAL_SECRET_INVALID: { fa: 'کلید نباید خط جدید یا نویسهٔ کنترلی داشته باشد.', en: 'A key cannot contain newlines or control characters.' },
  CREDENTIAL_HEADER_UNSUPPORTED: { fa: 'نام هدر پشتیبانی نمی‌شود.', en: 'That header name is not supported.' },
  CREDENTIAL_SCHEME_UNSUPPORTED: { fa: 'نوع احراز هویت پشتیبانی نمی‌شود.', en: 'That authentication scheme is not supported.' },
  CREDENTIAL_NOT_FOUND: { fa: 'کلیدی برای این ایجنت ذخیره نشده است.', en: 'No key is stored for this agent.' },
  CREDENTIAL_UNREADABLE: {
    fa: 'کلید ذخیره‌شده قابل خواندن نیست (کلید سرور عوض شده است). دوباره ذخیره کنید.',
    en: 'The stored key cannot be decrypted (the server key changed). Store it again.'
  },
  SOURCE_NOT_FOUND: { fa: 'این ایجنت دیگر در فهرست شما نیست.', en: 'That agent is no longer in your list.' }
});

/**
 * Task failures, in the user's language.
 *
 * The server's `detail` is English on purpose (it is the support-facing
 * sentence). A Persian UI that printed it read like a broken provider
 * connection, when the real message was "this agent is rate-limited" or "you
 * have not approved the share yet". Each code below says what happened and
 * what to do; the raw code stays on screen for a ticket.
 */
const TASK_ERROR_COPY = Object.freeze({
  AGENT_UNAVAILABLE: { fa: 'این ایجنت در این لحظه در دسترس نیست. وضعیت ارائه‌دهنده را در فهرست بالا ببینید.', en: 'This agent is not available right now. Check the provider status above.' },
  RATE_LIMITED: { fa: 'درخواست‌ها پشت‌سرهم بود؛ یک دقیقه بعد دوباره امتحان کنید.', en: 'Too many requests in a row. Try again in a minute.' },
  TASK_TEXT_REQUIRED: { fa: 'متن درخواست خیلی کوتاه است (حداقل ۴ نویسه).', en: 'The request is too short (4 characters minimum).' },
  TASK_TEXT_TOO_LONG: { fa: 'متن درخواست بلندتر از حد مجاز است.', en: 'The request is longer than the limit.' },
  CONSENT_REQUIRED: { fa: 'تأیید ارسال را تیک بزنید.', en: 'Tick the approval box first.' },
  NATIVE_DATA_CONSENT_REQUIRED: { fa: 'رضایت منابع داده ناقص یا قدیمی است؛ افشای فعلی را دوباره بررسی و تأیید کنید.', en: 'Data-source consent is missing or out of date. Review the current disclosure and approve it again.' },
  CONTEXT_REQUIRED: { fa: 'حداقل یک مورد برای اشتراک انتخاب کنید.', en: 'Choose at least one item to share.' },
  CONTEXT_WALLET_INVALID: { fa: 'آدرس کیف پول معتبر نیست (EVM یا Solana).', en: 'That wallet address is not valid (EVM or Solana).' },
  CONTEXT_PORTFOLIO_INVALID: { fa: 'جمع پورتفوی باید عدد باشد.', en: 'Portfolio totals must be numbers.' },
  CONTEXT_EXCERPT_INVALID: { fa: 'بخش گفتگو باید حداقل ۱۰ نویسه باشد.', en: 'The chat excerpt must be at least 10 characters.' },
  CONTEXT_CATEGORY_UNKNOWN: { fa: 'یکی از موارد انتخابی پشتیبانی نمی‌شود.', en: 'One of the selected items is not supported.' },
  PAYMENT_REQUIRED: { fa: 'این ایجنت پرداخت مستقیم می‌خواهد و پرداخت در این نسخه فعال نیست؛ چیزی از شما کم نشد.', en: 'This agent needs a direct payment, which is not enabled here. Nothing was charged.' },
  AUTH_REQUIRED: { fa: 'این ایجنت به حساب ارائه‌دهنده نیاز دارد؛ در تب «متصل‌ها» وصل کنید.', en: 'This agent needs your provider account. Connect it in the Connected tab.' },
  AGENT_NOT_FOUND: { fa: 'این ایجنت دیگر در فهرست نیست.', en: 'That agent is no longer listed.' },
  HUB_DISABLED: { fa: 'ایجنت‌های خارجی روی این نسخه خاموش‌اند.', en: 'External agents are switched off on this deployment.' },
  STRONG_OWNER_REQUIRED: { fa: 'این کار را از اپ روی دستگاه خودتان انجام دهید تا حساب شما شناسایی شود.', en: 'Do this from the app on your device so FBT can identify your account.' },
  IDEMPOTENCY_CONFLICT: { fa: 'همین درخواست با متن دیگری ثبت شده؛ فرم را تازه کنید.', en: 'That request was already used with different text. Refresh the form.' },
  REQUEST_IN_PROGRESS: { fa: 'همین درخواست در حال اجراست؛ چند لحظه صبر کنید.', en: 'That request is already running. Wait a moment.' },
  PROVIDER_TIMEOUT: { fa: 'ارائه‌دهنده در زمان مقرر پاسخ نداد؛ نتیجه نامشخص است و FBT درخواست دوم نمی‌سازد.', en: 'The provider did not answer in time. The outcome is unknown and FBT will not send a second request.' },
  PROVIDER_UNREACHABLE: { fa: 'به ارائه‌دهنده نرسیدیم؛ درخواست دوباره ساخته نشد.', en: 'The provider could not be reached. No duplicate request was created.' },
  PROVIDER_ERROR: { fa: 'ارائه‌دهنده درخواست را رد کرد.', en: 'The provider rejected the request.' },
  NETWORK_UNAVAILABLE: { fa: 'ارتباط با سرور FBT برقرار نشد.', en: 'FBT could not be reached.' },
  TIMEOUT: { fa: 'پاسخ دیر آمد؛ دوباره بفرستید.', en: 'The reply took too long. Send it again.' }
});

export function taskErrorText(code, fa, detail = null) {
  const row = TASK_ERROR_COPY[code];
  if (row) return fa ? row.fa : row.en;
  return detail || (fa ? 'درخواست انجام نشد.' : 'The request could not be completed.');
}

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

/**
 * A provider link, with one correction that fixes every broken link on this
 * screen: FBT's own pages are HASH routes inside a single-page app. The server
 * used to publish `https://fbtswap.ir/help`, which is a 404 — the page only
 * exists at `/#/help`. Absolute same-origin links are therefore reduced to
 * their hash (which the router understands and which still works when the URL
 * is copied), and only genuinely external links open in a new tab.
 */
export function internalHash(url) {
  try {
    const here = typeof window !== 'undefined' && window.location ? window.location.origin : null;
    const parsed = new URL(String(url), here || 'https://fbtswap.ir/');
    const isFbt = /(^|\.)fbtswap\.ir$/i.test(parsed.hostname) || (here && parsed.origin === here);
    if (!isFbt) return null;
    if (!parsed.hash || parsed.hash === '#') return parsed.pathname === '/' ? '#/' : null;
    return parsed.hash;
  } catch {
    return null;
  }
}

function ProviderLink({ href, children, testId = null }) {
  if (!href) return null;
  const hash = internalHash(href);
  return (
    <a
      className="ah-link"
      href={hash || href}
      {...(hash ? {} : { target: '_blank', rel: 'noopener noreferrer nofollow' })}
      data-internal={hash ? 'true' : 'false'}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {children}
    </a>
  );
}

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

export default function AgentHubPanel({ fa = false, onClose = null, onActivateInChat = null }) {
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
  const [credentialForm, setCredentialForm] = useState({
    sourceId: null, open: false, secret: '', headerName: 'authorization', scheme: 'bearer',
    state: 'idle', error: null, detail: null, message: null
  });
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
  /* One place decides how an agent is NAMED on screen, so the list, the detail
     header and the run result cannot disagree — and so a Persian UI never
     prints the English name as the primary label. The English string stays as
     the secondary line, because an operator or a support reply needs it. */
  const agentName = useCallback((agent) => (
    fa ? (agent?.nameFa || agent?.name || '') : (agent?.name || agent?.nameFa || '')
  ), [fa]);
  const agentSummary = useCallback((agent) => (
    fa ? (agent?.summaryFa || agent?.summary || '') : (agent?.summary || agent?.summaryFa || '')
  ), [fa]);
  const agentExamples = useCallback((agent) => {
    const list = fa ? (agent?.examplesFa?.length ? agent.examplesFa : agent?.examples) : (agent?.examples?.length ? agent.examples : agent?.examplesFa);
    return Array.isArray(list) ? list : [];
  }, [fa]);

  const filtered = useMemo(() => agents.filter((agent) => {
    if (access !== 'all' && accessKey(agent.accessModel) !== access) return false;
    if (!query.trim()) return true;
    const needle = query.trim().toLowerCase();
    /* Both languages are searchable in both directions: an Iranian user may
       type "اتریوم" or "ETH", and an English one may paste a Persian label. */
    return [
      agent.name, agent.nameFa, agent.summary, agent.summaryFa,
      agent.providerName, ...(agent.capabilities || []), ...(agent.dataSources || [])
    ]
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
      nativeDataApproved: selected.source === 'native' && (selected.dataSources || []).length > 0,
      nativeDataSources: selected.source === 'native' ? (selected.dataSources || []) : null,
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

  const saveKeyForSource = useCallback(async () => {
    const sourceId = credentialForm.sourceId;
    if (!sourceId) return;
    if (credentialForm.secret.trim().length < 6) {
      setCredentialForm((prev) => ({ ...prev, state: 'error', error: 'CREDENTIAL_SECRET_REQUIRED', detail: null }));
      return;
    }
    setCredentialForm((prev) => ({ ...prev, state: 'working', error: null, detail: null, message: null }));
    const out = await saveSourceCredential(sourceId, {
      secret: credentialForm.secret.trim(),
      headerName: credentialForm.headerName,
      scheme: credentialForm.scheme
    });
    if (!out.ok) {
      setCredentialForm((prev) => ({ ...prev, state: 'error', error: out.code || 'CREDENTIAL_STORE_UNCONFIGURED', detail: out.detail || null }));
      return;
    }
    /* The secret never goes back into component state after the request. */
    setCredentialForm({ sourceId: null, open: false, secret: '', headerName: 'authorization', scheme: 'bearer', state: 'idle', error: null, detail: null, message: null });
    setNotice({
      tone: 'info',
      text: fa
        ? 'کلید ذخیره و رمزنگاری شد. فقط هنگام اجرای همین ایجنت، در سرور باز و به همان میزبان فرستاده می‌شود.'
        : 'Key stored and encrypted. It is unsealed only while running this agent, and sent only to its host.'
    });
    void loadConnections();
  }, [credentialForm, fa, loadConnections]);

  const removeKeyForSource = useCallback(async (sourceId) => {
    const out = await removeSourceCredential(sourceId);
    if (!out.ok) {
      setNotice({ tone: 'warn', text: sourceErrorText(out.code, fa, out.detail) });
      return;
    }
    setNotice({ tone: 'info', text: fa ? 'کلید ذخیره‌شده حذف شد.' : 'The stored key was deleted.' });
    if (credentialForm.sourceId === sourceId) {
      setCredentialForm({ sourceId: null, open: false, secret: '', headerName: 'authorization', scheme: 'bearer', state: 'idle', error: null, detail: null, message: null });
    }
    void loadConnections();
  }, [credentialForm.sourceId, fa, loadConnections]);

  const removeSourceFromHub = useCallback(async (sourceId) => {
    if (credentialForm.sourceId === sourceId) {
      setCredentialForm({ sourceId: null, open: false, secret: '', headerName: 'authorization', scheme: 'bearer', state: 'idle', error: null, detail: null, message: null });
    }
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

  /* Activation is a UI fact, not a run: it stores a small snapshot and hands
     the chat the agent's own examples. Every execution still goes through the
     broker, so activating nothing here can bypass consent or a kill switch. */
  const activateInChat = useCallback(() => {
    if (!selected) return;
    try {
      setActiveAgent({ ...selected, native: selected.source === 'native' });
      setNotice({
        tone: 'ok',
        text: fa
          ? `«${selected.nameFa || selected.name}» در چت فعال شد. حالا در تب گفتگو پیشنهادها و نتایج همین ایجنت را می‌بینید.`
          : `“${selected.name}” is active in the chat. Its suggestions and results now appear in the chat tab.`
      });
      onActivateInChat?.(selected);
    } catch {
      setNotice({ tone: 'warn', text: fa ? 'فعال‌سازی در چت انجام نشد.' : 'The agent could not be activated for the chat.' });
    }
  }, [selected, fa, onActivateInChat]);

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
          <div className="ah-detail-head-right">
            <Badge status={detailAgent.status} fa={fa} />
            {detailAgent.status === 'LIVE' ? (
              <button
                type="button"
                className="ah-ghost ah-activate"
                onClick={activateInChat}
                data-testid="agent-hub-use-in-chat"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>
                {fa ? 'استفاده در چت' : 'Use in chat'}
              </button>
            ) : null}
          </div>
        </div>

        <h3>{agentName(detailAgent)}</h3>
        {fa && detailAgent.name && detailAgent.nameFa ? <p className="ah-sublabel" dir="ltr">{detailAgent.name}</p> : null}
        <p className="ah-muted">{agentSummary(detailAgent)}</p>
        <div className="ah-attrib" data-testid="agent-hub-attribution">
          <span className="ah-attrib-name">
            {fa ? 'ارائه‌دهنده: ' : 'Provider: '}
            <strong>{detailAgent.providerName}</strong>
          </span>
          <nav className="ah-attrib-links" aria-label={fa ? 'پیوندهای ارائه‌دهنده' : 'Provider links'}>
            <ProviderLink href={provider.websiteUrl} testId="agent-hub-link-site">{fa ? 'سایت' : 'site'}</ProviderLink>
            <ProviderLink href={provider.documentationUrl} testId="agent-hub-link-docs">{fa ? 'مستندات' : 'docs'}</ProviderLink>
            <ProviderLink href={provider.termsUrl} testId="agent-hub-link-terms">{fa ? 'شرایط' : 'terms'}</ProviderLink>
            <ProviderLink href={provider.privacyUrl} testId="agent-hub-link-privacy">{fa ? 'حریم خصوصی' : 'privacy'}</ProviderLink>
            <ProviderLink href={provider.supportUrl} testId="agent-hub-link-support">{fa ? 'پشتیبانی' : 'support'}</ProviderLink>
          </nav>
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
            {run.task.errorCode ? <p className="ah-note ah-note-warn">{taskErrorText(run.task.errorCode, fa, run.task.safeErrorMessage)}</p> : null}
            {run.task.result?.data?.needsInput ? (
              <p className="ah-note" role="status" data-testid="agent-hub-needs-input">
                {fa
                  ? 'این اجرا کامل شد، اما ایجنت برای پاسخ دقیق به یک ورودی روشن‌تر نیاز دارد: نماد کوین (مثل BTC یا اتریوم)، آدرس، یا نام پروتکل را بنویسید. یکی از نمونه‌های زیر را هم می‌توانید بزنید.'
                  : 'The run completed, but the agent needs a clearer input: a coin symbol (e.g. BTC or ETH), an address, or a protocol name. You can also tap one of the examples below.'}
              </p>
            ) : null}
            {run.task.replay ? <p className="ah-note">{fa ? 'این پاسخ از همان درخواست قبلی است؛ درخواست تازه‌ای ساخته نشد.' : 'This is the same earlier request; no new task was created.'}</p> : null}
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
            {agentExamples(detailAgent).length ? (
              <div className="ah-suggest">
                {agentExamples(detailAgent).slice(0, 3).map((example) => (
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

            <fieldset className="ah-consent" aria-labelledby="ah-consent-title" data-testid="agent-hub-context">
              {/* A legend is not a flex item in several engines, so the visible
                  header is a normal row and the legend stays for screen readers
                  (it still names the group). */}
              <legend className="ah-sr-only">
                {fa ? 'چه چیزی با ارائه‌دهنده به اشتراک گذاشته شود؟' : 'What is shared with the provider?'}
              </legend>
              <div className="ah-consent-legend">
                <span className="ah-consent-title" id="ah-consent-title">
                  {fa ? 'چه چیزی با ارائه‌دهنده به اشتراک گذاشته شود؟' : 'What is shared with the provider?'}
                </span>
                <span className="ah-consent-count" data-on={categories.length > 1 ? 'true' : 'false'}>
                  {fa
                    ? `${categories.length} مورد`
                    : `${categories.length} item${categories.length === 1 ? '' : 's'}`}
                </span>
              </div>
              <p className="ah-consent-lead">
                {detailAgent.source === 'native'
                  ? (fa
                    ? 'این ایجنت داخل خودِ FBT اجرا می‌شود؛ متن درخواست به هیچ ارائه‌دهندهٔ خارجی فرستاده نمی‌شود. بقیهٔ موارد را فقط اگر خودتان بخواهید اضافه می‌کنید.'
                    : 'This agent runs inside FBT; the request is not sent to any third-party provider. Everything else is added only if you switch it on.')
                  : (fa
                    ? 'متن درخواست همیشه ارسال می‌شود. بقیهٔ موارد فقط اگر خودتان روشن کنید. FBT هیچ داده‌ای را بدون انتخاب شما اضافه نمی‌کند.'
                    : 'The request text is always sent. Everything else only if you switch it on. FBT adds no data you did not choose.')}
              </p>

              <div className="ah-share-list">
                <div className="ah-share" data-on="true" data-locked="true">
                  <span className="ah-share-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16" /><path d="M4 12h10" /><path d="M4 17h13" /></svg>
                  </span>
                  <span className="ah-share-body">
                    <span className="ah-share-title">
                      {fa ? 'متن درخواست' : 'Request text'}
                      <code className="ah-share-code">task_text</code>
                    </span>
                    <span className="ah-share-note">{fa ? 'همیشه ارسال می‌شود و قابل خاموش‌کردن نیست' : 'Always sent; it cannot be switched off'}</span>
                  </span>
                  <input
                    className="ah-share-input"
                    type="checkbox"
                    checked
                    readOnly
                    aria-label={fa ? 'متن درخواست (همیشه ارسال می‌شود)' : 'Request text (always sent)'}
                    data-testid="agent-hub-context-task"
                  />
                </div>

                <div className="ah-share" data-on={sharing.wallet_address ? 'true' : 'false'}>
                  <span className="ah-share-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M16 12h.01" /></svg>
                  </span>
                  <label className="ah-share-body" htmlFor="ah-share-wallet">
                    <span className="ah-share-title">{fa ? 'آدرس عمومی کیف پول' : 'Public wallet address'}</span>
                    <span className="ah-share-note">{fa ? 'فقط آدرس عمومی؛ هیچ کلید خصوصی پذیرفته نمی‌شود' : 'A public address only; no private key is ever accepted'}</span>
                  </label>
                  <input
                    id="ah-share-wallet"
                    className="ah-share-input"
                    type="checkbox"
                    checked={sharing.wallet_address}
                    onChange={(event) => { setSharing((prev) => ({ ...prev, wallet_address: event.target.checked })); setApproved(false); }}
                    aria-label={fa ? 'ارسال آدرس عمومی کیف پول' : 'Share a public wallet address'}
                    data-testid="agent-hub-context-wallet"
                  />
                </div>
                {sharing.wallet_address ? (
                  <div className="ah-share-field">
                    <input
                      className="ah-input"
                      dir="ltr"
                      value={values.walletAddress}
                      onChange={(event) => { setValues((prev) => ({ ...prev, walletAddress: event.target.value })); setApproved(false); }}
                      placeholder="0x… / Solana address"
                      aria-label={fa ? 'آدرس کیف پول' : 'Wallet address'}
                      data-testid="agent-hub-wallet-value"
                    />
                  </div>
                ) : null}

                <div className="ah-share" data-on={sharing.portfolio_summary ? 'true' : 'false'}>
                  <span className="ah-share-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m7 14 4-4 3 3 5-6" /></svg>
                  </span>
                  <label className="ah-share-body" htmlFor="ah-share-portfolio">
                    <span className="ah-share-title">{fa ? 'جمع پورتفوی' : 'Portfolio totals'}</span>
                    <span className="ah-share-note">{fa ? 'فقط عددهایی که خودتان وارد می‌کنید؛ هیچ دارایی‌ای خوانده نمی‌شود' : 'Only numbers you type; no holding is read from any wallet'}</span>
                  </label>
                  <input
                    id="ah-share-portfolio"
                    className="ah-share-input"
                    type="checkbox"
                    checked={sharing.portfolio_summary}
                    onChange={(event) => { setSharing((prev) => ({ ...prev, portfolio_summary: event.target.checked })); setApproved(false); }}
                    aria-label={fa ? 'ارسال جمع پورتفوی' : 'Share portfolio totals'}
                    data-testid="agent-hub-context-portfolio"
                  />
                </div>
                {sharing.portfolio_summary ? (
                  <div className="ah-share-field ah-share-field-split">
                    <label className="ah-share-mini">
                      <span>{fa ? 'ارزش کل (دلار)' : 'Total USD'}</span>
                      <input
                        className="ah-input"
                        inputMode="decimal"
                        dir="ltr"
                        value={values.totalUsd}
                        onChange={(event) => { setValues((prev) => ({ ...prev, totalUsd: event.target.value })); setApproved(false); }}
                        placeholder="0"
                        aria-label={fa ? 'ارزش کل' : 'Total USD'}
                      />
                    </label>
                    <label className="ah-share-mini">
                      <span>{fa ? 'بخش ETH (دلار)' : 'ETH USD'}</span>
                      <input
                        className="ah-input"
                        inputMode="decimal"
                        dir="ltr"
                        value={values.ethUsd}
                        onChange={(event) => { setValues((prev) => ({ ...prev, ethUsd: event.target.value })); setApproved(false); }}
                        placeholder="0"
                        aria-label={fa ? 'بخش ETH' : 'ETH USD'}
                      />
                    </label>
                  </div>
                ) : null}

                <div className="ah-share" data-on={sharing.conversation_excerpt ? 'true' : 'false'}>
                  <span className="ah-share-icon" aria-hidden="true">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V6a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>
                  </span>
                  <label className="ah-share-body" htmlFor="ah-share-excerpt">
                    <span className="ah-share-title">{fa ? 'بخشی از این گفتگو' : 'An excerpt of this chat'}</span>
                    <span className="ah-share-note">{fa ? 'متنی را که اجازه می‌دهید ارسال شود، خودتان می‌چسبانید' : 'You paste the exact text you allow to be sent'}</span>
                  </label>
                  <input
                    id="ah-share-excerpt"
                    className="ah-share-input"
                    type="checkbox"
                    checked={sharing.conversation_excerpt}
                    onChange={(event) => { setSharing((prev) => ({ ...prev, conversation_excerpt: event.target.checked })); setApproved(false); }}
                    aria-label={fa ? 'ارسال بخشی از گفتگو' : 'Share a chat excerpt'}
                    data-testid="agent-hub-context-excerpt"
                  />
                </div>
                {sharing.conversation_excerpt ? (
                  <div className="ah-share-field">
                    <textarea
                      className="ah-input ah-textarea ah-textarea-sm"
                      value={values.excerpt}
                      maxLength={1200}
                      onChange={(event) => { setValues((prev) => ({ ...prev, excerpt: event.target.value })); setApproved(false); }}
                      placeholder={fa ? 'متنی را که اجازه می‌دهید ارسال شود بچسبانید' : 'Paste the text you allow to be sent'}
                      aria-label={fa ? 'بخش گفتگو' : 'Conversation excerpt'}
                    />
                  </div>
                ) : null}
              </div>
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

            {detailAgent.source === 'native' ? <NativeDataDisclosure agent={detailAgent} fa={fa} /> : null}

            <label className="ah-approve" data-on={approved ? 'true' : 'false'}>
              <input
                className="ah-approve-input"
                type="checkbox"
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
                data-testid="agent-hub-consent-approve"
              />
              <span className="ah-approve-box" aria-hidden="true">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </span>
              <span className="ah-approve-copy">
                <strong>
                  {detailAgent.source === 'native'
                    ? ((detailAgent.dataSources || []).length
                      ? (fa ? 'اجرای FBT و پرس‌وجوهای عمومیِ فهرست‌شده را تأیید می‌کنم' : 'Approve FBT and the listed public-data queries')
                      : (fa ? 'ساخت پیش‌نویس محلی در FBT را تأیید می‌کنم' : 'Approve creating this local draft in FBT'))
                    : (fa ? 'تأیید ارسال به ارائه‌دهنده' : 'Approve sending to the provider')}
                </strong>
                <span>
                  {detailAgent.source === 'native'
                    ? ((detailAgent.dataSources || []).length
                      ? (fa
                        ? 'منابع و فیلدهای ارسالی بالا مشخص‌اند؛ فقط پس از این تأیید خوانده می‌شوند. متن کامل به مدل ثالث فرستاده نمی‌شود و هیچ هزینه یا تراکنشی ایجاد نمی‌شود.'
                        : 'The sources and query fields are listed above; reads start only after approval. The full prompt is not sent to a third-party model, and no fee or transaction is created.')
                      : (fa
                        ? 'این ایجنت فقط درخواست را داخل FBT به پیش‌نویس تبدیل می‌کند. برای قیمت‌گیری Bridge/Swap رضایت جداگانه می‌گیرد.'
                        : 'This agent only turns your request into a draft inside FBT. Bridge/Swap asks separately before requesting a quote.'))
                    : (fa
                      ? 'می‌دانم این متن به ارائه‌دهندهٔ خارجی ارسال می‌شود و شرایط و حریم خصوصی او اعمال می‌شود.'
                      : 'I understand this text goes to an external provider, under their terms and privacy policy.')}
                </span>
              </span>
            </label>

            {run.state === 'error' ? (
              <p className="ah-error" role="alert" data-testid="agent-hub-error">
                {taskErrorText(run.code || run.error, fa, run.detail)}
                <code className="ah-code">{run.code || run.error}</code>
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
        <RecommendedAgents
          fa={fa}
          onAddOwnAgent={() => setTab('discover')}
          nativeAgents={agents}
          onRunAgent={(agent) => { setTab('discover'); void openAgent(agent); }}
        />
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
                            onClick={() => {
                              setCredentialForm((prev) => {
                                if (prev.sourceId === provider.id) {
                                  return { ...prev, open: !prev.open, secret: '', error: null, detail: null };
                                }
                                return { sourceId: provider.id, open: true, secret: '', headerName: 'authorization', scheme: 'bearer', state: 'idle', error: null, detail: null, message: null };
                              });
                            }}
                            data-testid={`agent-hub-source-key-toggle-${testIdPart(provider.id)}`}
                          >
                            {fa ? 'کلید دسترسی (اختیاری)' : 'Access key (optional)'}
                          </button>
                          <button
                            type="button"
                            className="ah-ghost"
                            onClick={() => void removeSourceFromHub(provider.id)}
                            data-testid={`agent-hub-source-remove-${testIdPart(provider.id)}`}
                          >
                            {fa ? 'حذف' : 'Remove'}
                          </button>
                        </div>
                        {credentialForm.open && credentialForm.sourceId === provider.id ? (
                          <div className="ah-key" data-testid={`agent-hub-source-key-${testIdPart(provider.id)}`}>
                            <p className="ah-muted ah-small">
                              {fa
                                ? 'اگر این ایجنت به کلید ساختهٔ خودتان نیاز دارد، اینجا بگذارید. کلید با AES-256-GCM روی سرور رمز می‌شود، در مرورگر نگه داشته نمی‌شود و فقط برای همین ایجنت به همان میزبان فرستاده می‌شود. اگر ایجنت عمومی است، خالی بگذارید.'
                                : 'If this agent needs a key you were issued, store it here. It is sealed with AES-256-GCM on the server, never kept in the browser, and sent only for this agent to the host you already added. If the agent is public, leave this empty.'}
                            </p>
                            <div className="ah-key-row">
                              <label className="ah-field">
                                <span>{fa ? 'هدر' : 'Header'}</span>
                                <select
                                  className="ah-input"
                                  value={credentialForm.headerName}
                                  onChange={(event) => setCredentialForm((prev) => ({ ...prev, headerName: event.target.value }))}
                                  data-testid="agent-hub-source-key-header"
                                >
                                  <option value="authorization">Authorization</option>
                                  <option value="x-api-key">X-API-Key</option>
                                  <option value="api-key">Api-Key</option>
                                  <option value="x-auth-token">X-Auth-Token</option>
                                </select>
                              </label>
                              <label className="ah-field">
                                <span>{fa ? 'نوع' : 'Scheme'}</span>
                                <select
                                  className="ah-input"
                                  value={credentialForm.scheme}
                                  onChange={(event) => setCredentialForm((prev) => ({ ...prev, scheme: event.target.value }))}
                                  data-testid="agent-hub-source-key-scheme"
                                >
                                  <option value="bearer">Bearer</option>
                                  <option value="token">Token</option>
                                  <option value="key">Key</option>
                                  <option value="raw">{fa ? 'خام' : 'Raw value'}</option>
                                </select>
                              </label>
                            </div>
                            <label className="ah-field">
                              <span>{fa ? 'کلید' : 'Key'}</span>
                              <input
                                className="ah-input"
                                type="password"
                                autoComplete="off"
                                spellCheck={false}
                                value={credentialForm.secret}
                                onChange={(event) => setCredentialForm((prev) => ({ ...prev, secret: event.target.value, error: null }))}
                                placeholder={fa ? 'مقدار کلید خودتان' : 'The key you were issued'}
                                data-testid="agent-hub-source-key-secret"
                              />
                            </label>
                            {credentialForm.error ? (
                              <p className="ah-error" role="alert" data-testid="agent-hub-source-key-error">
                                {sourceErrorText(credentialForm.error, fa, credentialForm.detail)}
                                <code className="ah-code">{credentialForm.error}</code>
                              </p>
                            ) : null}
                            <div className="ah-key-actions">
                              <button
                                type="button"
                                className="ah-primary ah-primary-sm"
                                disabled={credentialForm.state === 'working' || credentialForm.secret.trim().length < 6}
                                onClick={() => void saveKeyForSource()}
                                data-testid="agent-hub-source-key-save"
                              >
                                {credentialForm.state === 'working' ? (fa ? 'در حال ذخیره…' : 'Saving…') : (fa ? 'ذخیره و رمزنگاری' : 'Store and encrypt')}
                              </button>
                              <button
                                type="button"
                                className="ah-ghost"
                                onClick={() => {
                                  setCredentialForm((prev) => ({ ...prev, open: false, secret: '', error: null, detail: null }));
                                  void removeKeyForSource(provider.id);
                                }}
                                data-testid="agent-hub-source-key-remove"
                              >
                                {fa ? 'حذف کلید ذخیره‌شده' : 'Delete stored key'}
                              </button>
                            </div>
                          </div>
                        ) : null}
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
                        <span className="ah-card-name">{agentName(agent)}</span>
                        <Badge status={agent.status} fa={fa} />
                        {agent.source === 'user'
                          ? <span className="ah-badge" data-tone="info">{fa ? 'افزودهٔ شما' : 'Added by you'}</span>
                          : agent.source === 'native'
                            ? <span className="ah-badge" data-tone="ok">{fa ? 'بومی FBT' : 'FBT native'}</span>
                            : <span className="ah-badge" data-tone="muted">{fa ? 'بازبینی‌شده' : 'Reviewed'}</span>}
                      </div>
                      {fa && agent.nameFa ? <span className="ah-card-sub" dir="ltr">{agent.name}</span> : null}
                      <p className="ah-card-summary">{agentSummary(agent)}</p>
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
            <div className="ah-connect-empty" data-testid="agent-hub-connections-empty">
              <h4>{fa ? 'هیچ حسابی وصل نیست — و برای شروع لازم هم نیست' : 'Nothing is connected — and you do not need a connection to start'}</h4>
              <p>
                {fa
                  ? 'دو راه جدا وجود دارد. ایجنت‌های بومی FBT همین حالا و بدون هیچ اتصالی کار می‌کنند. برای ایجنتی که خودتان اضافه کرده‌اید، اگر سازنده‌اش به کلید نیاز داشته باشد، می‌توانید کلید خودتان را ذخیره کنید؛ این کلید رمزنگاری‌شده و فقط برای همان ایجنت استفاده می‌شود.'
                  : 'There are two separate paths. FBT’s native agents run right now with no connection at all. For an agent you added yourself, if its author requires a key, you can store the key you were issued; it is encrypted and used only for that agent.'}
              </p>
              <p className="ah-muted ah-small">
                {fa
                  ? 'اتصال OAuth فقط برای ارائه‌دهنده‌ای فعال می‌شود که در رجیستری بازبینی‌شدهٔ FBT ثبت شده باشد. تا آن زمان هیچ دکمهٔ «اتصال» جعلی نمایش داده نمی‌شود.'
                  : 'OAuth connects only to a provider registered in FBT’s reviewed registry. Until then no fake “Connect” button is shown.'}
              </p>
              <div className="ah-connect-actions">
                <button type="button" className="ah-primary ah-primary-sm" onClick={() => setTab('recommended')} data-testid="agent-hub-connections-go-native">
                  {fa ? 'دیدن ایجنت‌های بومی' : 'See native agents'}
                </button>
                <button type="button" className="ah-ghost" onClick={() => setTab('discover')} data-testid="agent-hub-connections-go-sources">
                  {fa ? 'افزودن ایجنت خودم' : 'Add my own agent'}
                </button>
              </div>
            </div>
          ) : null}
          {connections.state === 'ready' && connections.list.length > 0 ? (
            <ul className="ah-list">
              {connections.list.map((connection) => {
                const isKey = connection.kind === 'api_key';
                return (
                  <li key={connection.id} className="ah-card" data-testid={`agent-hub-connection-${testIdPart(connection.id)}`}>
                    <div className="ah-card-head">
                      <span className="ah-card-name">{isKey ? (fa ? 'کلید ایجنت شما' : 'Your agent key') : connection.providerId}</span>
                      <Badge status="LIVE" fa={fa} />
                      {isKey ? <span className="ah-badge" data-tone="info">{fa ? 'رمزنگاری‌شده' : 'Encrypted'}</span> : null}
                    </div>
                    <div className="ah-card-meta">
                      <span>{isKey ? `${connection.providerId}` : (connection.externalAccountLabel || (fa ? 'حساب ارائه‌دهنده' : 'provider account'))}</span>
                      {isKey ? (
                        <span dir="ltr">{connection.headerName}{connection.scheme !== 'raw' ? ` · ${connection.scheme}` : ''}</span>
                      ) : connection.scopes.length ? (
                        <span>{connection.scopes.join(' · ')}</span>
                      ) : null}
                      <span>{connection.expiresAt ? `${fa ? 'انقضا: ' : 'expires '}${fmt(connection.expiresAt, fa)}` : (fa ? 'بدون تاریخ انقضا' : 'no expiry reported')}</span>
                    </div>
                    <button
                      type="button"
                      className="ah-ghost"
                      onClick={async () => {
                        const out = isKey
                          ? await removeSourceCredential(connection.providerId)
                          : await revokeConnection(connection.id);
                        if (out.ok) void loadConnections();
                        else setNotice({ tone: 'warn', text: sourceErrorText(out.code, fa, out.detail) });
                      }}
                      data-testid={`agent-hub-connection-revoke-${testIdPart(connection.id)}`}
                    >
                      {isKey ? (fa ? 'حذف کلید' : 'Delete key') : (fa ? 'قطع اتصال' : 'Disconnect')}
                    </button>
                  </li>
                );
              })}
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
                    if (!out.ok) { setNotice({ tone: 'warn', text: taskErrorText(out.code, fa, out.detail) }); return; }
                    /* Open the REAL agent when it is still listed, so the result
                       is attributed with its provider links and its Persian
                       name. The minimal fallback keeps history readable for an
                       agent the user has since removed; it never invents a
                       provider URL, and it says so by carrying no provider. */
                    const known = agents.find((agent) => agent.id === task.agentId);
                    setSelected(known || {
                      id: task.agentId,
                      name: task.agentName,
                      nameFa: null,
                      providerName: task.providerName,
                      provider: {},
                      status: 'LIVE',
                      accessModel: task.priceQuote?.model || 'FREE_PUBLIC',
                      source: task.providerId === 'fbt-native' ? 'native' : 'reviewed',
                      summary: ''
                    });
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
