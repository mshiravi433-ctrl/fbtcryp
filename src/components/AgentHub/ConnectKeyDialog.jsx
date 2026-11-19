import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  askProviderKey,
  connectProviderKey,
  listProviderKeys,
  removeProviderKey
} from '../../lib/intent-ai/agentHub/client.js';

/**
 * The key popup for an EXTERNAL agent.
 *
 * The rule this component exists to enforce: a card in the directory must do
 * more than open the vendor's homepage. If the vendor exposes a key API that
 * FBT can call, this popup takes the key, asks the server to prove it against
 * the vendor's own host, stores the sealed result, and then lets the user ask
 * the assistant a domain question through that seat.
 *
 * Three honest states, never blurred:
 *   connectable   → key field, real verification, real answers
 *   already keyed → status, model, last use, replace or delete
 *   no bridge     → says so plainly and shows what FBT already does with that
 *                   vendor server-side; it does not pretend to be connected
 */

const COPY = {
  fa: {
    title: 'کلید و اتصال',
    close: 'بستن',
    introConnect:
      'کلید خودتان را برای این ارائه‌دهنده بگذارید. سرور پیش از ذخیره، آن را روی همان میزبان رسمی ارائه‌دهنده امتحان می‌کند؛ فقط اگر واقعاً کار کند، رمزنگاری‌شده ذخیره می‌شود و از آن به بعد پرسش‌های حوزهٔ کریپتو و DeFi شما از همین صندلی پرسیده می‌شود.',
    introNoBridge:
      'این سرویس کلید API عمومی‌ای ندارد که FBT بتواند از طرف شما صدا بزند؛ پس هیچ کلیدی هم از شما گرفته نمی‌شود و هیچ ادعای اتصالی در کار نیست. همان کاری که واقعاً انجام می‌شود در ادامه آمده است.',
    keyLabel: 'کلید API شما',
    keyPlaceholder: 'کلید را اینجا بچسبانید',
    keyHint:
      'کلید فقط یک بار به همین مرورگر→سرور فرستاده می‌شود، در مرورگر ذخیره نمی‌شود و هرگز به شما برنمی‌گردد. تنها اثر آن در پنل، چهار رقم آخر است.',
    getKey: 'دریافت کلید از ارائه‌دهنده',
    site: 'سایت رسمی',
    docs: 'مستندات',
    connect: 'بررسی و اتصال',
    connecting: 'در حال بررسی کلید روی سرور…',
    replace: 'جایگزینی کلید',
    remove: 'قطع اتصال و حذف کلید',
    removing: 'در حال حذف…',
    connected: 'متصل و بررسی‌شده',
    invalid: 'کلید نامعتبر',
    notConnected: 'کلید ذخیره نشده',
    domainHeading: 'این کلید چه کاری برای شما می‌کند',
    verifiedHeading: 'نتیجهٔ بررسی',
    model: 'مدل انتخاب‌شده',
    models: 'مدل‌های موجود',
    latency: 'زمان پاسخ',
    proof: 'پاسخ زندهٔ ارائه‌دهنده',
    askHeading: 'پرسش از این صندلی (با زمینهٔ FBT)',
    askPlaceholder: 'مثلاً: با نرخ فاندینگ فعلی، ریسک پوزیشن لانگ روی ETH چقدر است؟',
    ask: 'بپرس',
    asking: 'در حال پرسش…',
    answerFrom: 'پاسخ از',
    askHint: 'این پرسش از حساب شما و با سهمیهٔ خودتان به ارائه‌دهنده می‌رود؛ FBT فقط زمینهٔ دامنه (کریپتو/DeFi) و صورت پرسش را می‌فرستد.',
    rateLimited: 'سقف پرسش ساعتی پر شد. کمی بعد دوباره تلاش کنید.',
    askUnsupported: 'این صندلی فقط داده می‌خواند و پرسش متنی نمی‌گیرد.',
    a11y: 'پاپ‌اپ کلید و اتصال ایجنت خارجی'
  },
  en: {
    title: 'Key & connection',
    close: 'Close',
    introConnect:
      'Store your own key for this provider. Before saving, the server proves it against the provider’s own host; only a key that actually works is sealed and kept, and from then on your crypto / DeFi questions are asked through that seat.',
    introNoBridge:
      'This service has no public key API that FBT can call on your behalf, so no key is requested and no connection is claimed. What FBT actually does with it is described below.',
    keyLabel: 'Your API key',
    keyPlaceholder: 'Paste the key',
    keyHint:
      'The key travels browser→server once, is not stored in the browser, and never comes back. The panel shows only its last four characters.',
    getKey: 'Get a key from the provider',
    site: 'Official site',
    docs: 'Docs',
    connect: 'Verify and connect',
    connecting: 'Verifying the key on the server…',
    replace: 'Replace key',
    remove: 'Disconnect and delete key',
    removing: 'Removing…',
    connected: 'Connected and verified',
    invalid: 'Key invalid',
    notConnected: 'No key stored',
    domainHeading: 'What this key does for you',
    verifiedHeading: 'Verification result',
    model: 'Selected model',
    models: 'Models available',
    latency: 'Round-trip',
    proof: 'Live provider reply',
    askHeading: 'Ask through this seat (with FBT context)',
    askPlaceholder: 'e.g. Given current funding, how crowded is the ETH long?',
    ask: 'Ask',
    asking: 'Asking…',
    answerFrom: 'Answer from',
    askHint: 'The question is billed to your account and your quota; FBT only sends the domain context (crypto/DeFi) and the question text.',
    rateLimited: 'Hourly question limit reached. Try again shortly.',
    askUnsupported: 'This seat only reads data and takes no text question.',
    a11y: 'External agent key and connection dialog'
  }
};

const ERROR_COPY = {
  PROVIDER_REJECTED_KEY: {
    fa: 'ارائه‌دهنده این کلید را نپذیرفت. کلید را از پنل خودتان دوباره بگیرید و مطمئن شوید برای همین سرویس است.',
    en: 'The provider rejected this key. Re-issue it in their console and make sure it belongs to this service.'
  },
  PROVIDER_RATE_LIMITED: { fa: 'ارائه‌دهنده فعلاً سهمیهٔ درخواست را بسته است.', en: 'The provider is rate-limiting requests right now.' },
  PROVIDER_TIMEOUT: { fa: 'پاسخ ارائه‌دهنده دیر شد و درخواست لغو شد.', en: 'The provider did not answer in time; the request was cancelled.' },
  PROVIDER_UNREACHABLE: { fa: 'ارتباط با میزبان ارائه‌دهنده برقرار نشد.', en: 'The provider host could not be reached.' },
  PROVIDER_ERROR: { fa: 'ارائه‌دهنده خطا برگرداند.', en: 'The provider returned an error.' },
  AGENT_HUB_SECRET_KEY_REQUIRED: {
    fa: 'کلید رمزنگاری سرور (AGENT_HUB_SECRET_KEY) تنظیم نشده است؛ تا آن موقع هیچ کلیدی ذخیره نمی‌شود.',
    en: 'The server sealing key (AGENT_HUB_SECRET_KEY) is not configured, so no key can be stored yet.'
  },
  CREDENTIAL_STORE_REQUIRED: { fa: 'ذخیره‌گاه پایدار سرور تنظیم نشده است.', en: 'The server has no durable store configured.' },
  CREDENTIAL_STORE_UNAVAILABLE: { fa: 'ذخیره‌گاه سرور در دسترس نبود.', en: 'The server store was unavailable.' },
  STRONG_OWNER_REQUIRED: {
    fa: 'برای ذخیرهٔ کلید، هویت دستگاه لازم است؛ صفحه را دوباره باز کنید.',
    en: 'Storing a key needs a device identity; reload the page.'
  },
  RATE_LIMITED: { fa: 'سقف پرسش ساعتی پر شد.', en: 'Hourly question limit reached.' },
  PROVIDER_ASK_UNSUPPORTED: {
    fa: 'این صندلی فقط داده می‌خواند و پرسش متنی نمی‌گیرد.',
    en: 'This seat only reads data and takes no text question.'
  },
  CREDENTIAL_NOT_FOUND: { fa: 'کلیدی برای این سرویس ذخیره نشده است.', en: 'No key is stored for this service.' },
  QUESTION_REQUIRED: { fa: 'پرسش خالی است.', en: 'The question is empty.' }
};

const textFor = (value, fa) => value?.[fa ? 'fa' : 'en'] || '';

const STATUS_TONE = { ACTIVE: 'ok', INVALID: 'bad', REVOKED: 'muted', EXPIRED: 'warn', UNCONNECTED: 'muted' };
const STATUS_COPY = {
  fa: { ACTIVE: 'کلید ذخیره و بررسی شد', INVALID: 'کلید دیگر پذیرفته نمی‌شود', REVOKED: 'حذف شده', EXPIRED: 'منقضی شده', UNCONNECTED: 'کلید ذخیره نشده' },
  en: { ACTIVE: 'Key stored and verified', INVALID: 'Key no longer accepted', REVOKED: 'Removed', EXPIRED: 'Expired', UNCONNECTED: 'No key stored' }
};

export default function ConnectKeyDialog({ fa = false, target = null, onClose = null, onChanged = null }) {
  const t = COPY[fa ? 'fa' : 'en'];
  const c = STATUS_COPY[fa ? 'fa' : 'en'];
  const [list, setList] = useState({ state: 'loading', providers: [], error: null, capability: null });
  const [secret, setSecret] = useState('');
  const [state, setState] = useState('idle');
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [verified, setVerified] = useState(null);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState(null);
  const secretRef = useRef(null);
  const closeRef = useRef(null);

  const bridgeId = target?.bridgeId || null;
  const entry = useMemo(
    () => (bridgeId ? list.providers.find((provider) => provider.id === bridgeId) || null : null),
    [bridgeId, list.providers]
  );

  const load = useCallback(async () => {
    setList((prev) => ({ ...prev, state: prev.providers.length ? prev.state : 'loading' }));
    const out = await listProviderKeys();
    if (out?.ok) {
      setList({ state: 'ready', providers: Array.isArray(out.providers) ? out.providers : [], error: null, capability: out.capability || null });
    } else {
      setList({ state: 'error', providers: [], error: out?.code || 'NETWORK_UNAVAILABLE', capability: null });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const runConnect = async () => {
    if (!bridgeId || secret.trim().length < 8) return;
    setState('working');
    setError(null);
    setDetail(null);
    const out = await connectProviderKey(bridgeId, secret.trim());
    setSecret('');
    if (out?.ok) {
      setState('done');
      setVerified(out.verified || null);
      await load();
      onChanged?.();
    } else {
      setState('error');
      setError(out?.code || 'PROVIDER_ERROR');
      setDetail(out?.detail || out?.status || null);
    }
  };

  const runRemove = async () => {
    if (!bridgeId) return;
    setState('working');
    setError(null);
    const out = await removeProviderKey(bridgeId);
    if (out?.ok) {
      setState('idle');
      setVerified(null);
      setAnswer(null);
      await load();
      onChanged?.();
    } else {
      setState('error');
      setError(out?.code || 'CREDENTIAL_STORE_UNAVAILABLE');
    }
  };

  const runAsk = async () => {
    if (!bridgeId || question.trim().length < 2) return;
    setAsking(true);
    setAnswer(null);
    const out = await askProviderKey(bridgeId, { question: question.trim() });
    setAsking(false);
    if (out?.ok) {
      setAnswer({
        text: out.answer,
        attribution: out.attribution || out.provider?.name || '',
        latencyMs: out.latencyMs,
        remaining: out.asksRemaining
      });
    } else {
      const code = out?.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : out?.code || 'PROVIDER_ERROR';
      setAnswer({ error: textFor(ERROR_COPY[code], fa) || (fa ? 'پرسش انجام نشد.' : 'The question did not go through.'), code, detail: out?.detail || null });
    }
  };

  const statusKey = entry?.status || (entry?.connected ? 'ACTIVE' : 'UNCONNECTED');
  const connected = Boolean(entry?.connected);
  const isAi = (entry?.requiresModel ?? (entry?.kind || 'ai') === 'ai') !== false;
  const errorText = error ? textFor(ERROR_COPY[error], fa) || (fa ? 'انجام نشد.' : 'That did not work.') : null;
  const testId = String(bridgeId || target?.id || 'unknown').replace(/[^A-Za-z0-9_-]+/g, '-');

  return (
    <div
      className="ah-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        className="ah-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t.a11y}
        dir={fa ? 'rtl' : 'ltr'}
        data-testid={`agent-hub-key-dialog-${testId}`}
      >
        <header className="ah-dialog-head">
          <span className="ah-dialog-mark" aria-hidden="true">{target?.mark || '◎'}</span>
          <div className="ah-dialog-id">
            <span className="ah-dialog-vendor">{target?.vendor || entry?.vendor || ''}</span>
            <h4>{target?.name || entry?.name || ''}</h4>
            <span className="ah-dialog-sub">{t.title}</span>
          </div>
          <span className="ah-badge" data-tone={connected ? 'ok' : STATUS_TONE[statusKey] || 'muted'} data-testid="agent-hub-key-status">
            {connected ? t.connected : c[statusKey] || c.UNCONNECTED}
          </span>
          <button ref={closeRef} type="button" className="ah-ghost ah-dialog-close" onClick={() => onClose?.()} aria-label={t.close}>
            ✕
          </button>
        </header>

        {bridgeId ? (
          <p className="ah-dialog-intro">{t.introConnect}</p>
        ) : (
          <p className="ah-dialog-intro" data-testid="agent-hub-key-no-bridge">{t.introNoBridge}</p>
        )}

        {list.state === 'error' ? (
          <p className="ah-error ah-small" role="alert" data-testid="agent-hub-key-list-error">
            {textFor(ERROR_COPY[list.error], fa) || (fa ? 'وضعیت کلیدها خوانده نشد.' : 'Key status could not be read.')}{' '}
            <code className="ah-code">{list.error}</code>
          </p>
        ) : null}

        {/* A key that cannot be sealed must not be requested: the honest answer
            is to say the server is not configured yet, before the user pastes
            anything. */}
        {list.capability && (list.capability.sealingConfigured === false || list.capability.durable === false) ? (
          <p className="ah-note ah-small" role="status" data-testid="agent-hub-key-not-configured">
            {fa
              ? 'ذخیرهٔ امن کلید روی سرور هنوز فعال نیست، پس هیچ کلیدی از شما گرفته نمی‌شود. پس از فعال‌شدن، همین پنجره کلید را می‌پذیرد.'
              : 'Sealed key storage is not enabled on the server yet, so no key is requested. Once it is enabled this same dialog accepts the key.'}
          </p>
        ) : null}

        {entry?.domainUse ? (
          <section className="ah-dialog-block">
            <h5>{t.domainHeading}</h5>
            <p>{textFor(entry.domainUse, fa)}</p>
          </section>
        ) : null}

        {bridgeId && !(list.capability && (list.capability.sealingConfigured === false || list.capability.durable === false)) ? (
          <section className="ah-dialog-block ah-dialog-key-box">
            {connected ? (
              <>
                <div className="ah-dialog-facts">
                  <div>
                    <dt>{fa ? 'کلید' : 'Key'}</dt>
                    <dd><code className="ah-code" dir="ltr">{entry?.hint || '••••'}</code></dd>
                  </div>
                  {entry?.model ? (
                    <div>
                      <dt>{t.model}</dt>
                      <dd><code className="ah-code" dir="ltr">{entry.model}</code></dd>
                    </div>
                  ) : null}
                  {entry?.proof ? (
                    <div>
                      <dt>{textFor(entry.proofLabel, fa) || t.proof}</dt>
                      <dd><code className="ah-code" dir="ltr">{entry.proof}</code></dd>
                    </div>
                  ) : null}
                  {entry?.lastUsedAt ? (
                    <div>
                      <dt>{fa ? 'آخرین استفاده' : 'Last used'}</dt>
                      <dd>{new Date(entry.lastUsedAt).toLocaleString(fa ? 'fa-IR' : 'en-GB')}</dd>
                    </div>
                  ) : null}
                </div>
                <div className="ah-dialog-actions">
                  <button type="button" className="ah-ghost" onClick={() => { setState('idle'); setSecret(''); }} data-testid="agent-hub-key-replace">
                    {t.replace}
                  </button>
                  <button type="button" className="ah-ghost ah-ghost-danger" onClick={() => void runRemove()} disabled={state === 'working'} data-testid="agent-hub-key-remove">
                    {state === 'working' ? t.removing : t.remove}
                  </button>
                </div>
              </>
            ) : (
              <>
                <label className="ah-field">
                  <span>{t.keyLabel}</span>
                  <input
                    ref={secretRef}
                    className="ah-input"
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                    spellCheck="false"
                    value={secret}
                    placeholder={t.keyPlaceholder}
                    onChange={(event) => setSecret(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') void runConnect(); }}
                    data-testid="agent-hub-key-input"
                  />
                </label>
                <p className="ah-muted ah-small">{t.keyHint}</p>
                {entry?.authLabel ? (
                  <p className="ah-muted ah-small">
                    {fa ? 'نحوهٔ ارسال: ' : 'Sent as: '}
                    <code className="ah-code" dir="ltr">{entry.authLabel}</code>
                  </p>
                ) : null}
                <div className="ah-dialog-actions">
                  <button
                    type="button"
                    className="ah-primary ah-primary-sm"
                    onClick={() => void runConnect()}
                    disabled={state === 'working' || secret.trim().length < 8}
                    data-testid="agent-hub-key-connect"
                  >
                    {state === 'working' ? t.connecting : t.connect}
                  </button>
                  {entry?.keyUrl ? (
                    <a className="ah-ghost" href={entry.keyUrl} target="_blank" rel="noopener noreferrer nofollow">
                      {t.getKey} ↗
                    </a>
                  ) : null}
                </div>
              </>
            )}

            {errorText ? (
              <p className="ah-error ah-small" role="alert" data-testid="agent-hub-key-error">
                {errorText} <code className="ah-code">{error}</code>
                {detail ? <span className="ah-dialog-detail" dir="ltr"> · {String(detail).slice(0, 140)}</span> : null}
              </p>
            ) : null}

            {state === 'done' && verified ? (
              <div className="ah-dialog-verified" role="status" data-testid="agent-hub-key-verified">
                🔒 {t.verifiedHeading}:{' '}
                {verified.latencyMs != null ? `${t.latency} ${verified.latencyMs}ms` : ''}
                {verified.modelCount ? ` · ${t.models} ${verified.modelCount}` : ''}
                {verified.proof ? ` · ${verified.proof}` : ''}
              </div>
            ) : null}
          </section>
        ) : null}

        {connected && isAi ? (
          <section className="ah-dialog-block">
            <h5>{t.askHeading}</h5>
            <textarea
              className="ah-input ah-dialog-textarea"
              rows={3}
              value={question}
              placeholder={t.askPlaceholder}
              onChange={(event) => setQuestion(event.target.value)}
              data-testid="agent-hub-key-question"
            />
            <div className="ah-dialog-actions">
              <button
                type="button"
                className="ah-primary ah-primary-sm"
                onClick={() => void runAsk()}
                disabled={asking || question.trim().length < 2}
                data-testid="agent-hub-key-ask"
              >
                {asking ? t.asking : t.ask}
              </button>
            </div>
            <p className="ah-muted ah-small">{t.askHint}</p>
            {answer?.text ? (
              <article className="ah-dialog-answer" data-testid="agent-hub-key-answer">
                <p>{answer.text}</p>
                <footer>
                  {t.answerFrom} <strong>{answer.attribution}</strong>
                  {answer.latencyMs != null ? ` · ${answer.latencyMs}ms` : ''}
                  {answer.remaining != null ? ` · ${fa ? 'باقی‌مانده' : 'remaining'} ${answer.remaining}` : ''}
                </footer>
              </article>
            ) : null}
            {answer?.error ? (
              <p className="ah-error ah-small" role="alert">
                {answer.error} {answer.code ? <code className="ah-code">{answer.code}</code> : null}
              </p>
            ) : null}
          </section>
        ) : null}

        <footer className="ah-dialog-links">
          {entry?.siteUrl || target?.productUrl ? (
            <a href={entry?.siteUrl || target.productUrl} target="_blank" rel="noopener noreferrer nofollow">{t.site} ↗</a>
          ) : null}
          {entry?.docsUrl || target?.docsUrl ? (
            <a href={entry?.docsUrl || target.docsUrl} target="_blank" rel="noopener noreferrer nofollow">{t.docs} ↗</a>
          ) : null}
          {!bridgeId && target?.productUrl ? (
            <span className="ah-muted ah-small">
              {fa
                ? 'FBT برای این حوزه داده را از مسیرهای داخلی خودش می‌خواند؛ کلید شخصی برای آن تعریف نشده است.'
                : 'FBT reads this domain through its own server-side paths; no personal key is defined for it.'}
            </span>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
