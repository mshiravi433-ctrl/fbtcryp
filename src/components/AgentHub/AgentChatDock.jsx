/**
 * THE ACTIVE EXTERNAL AGENT — inside the chat.
 * ---------------------------------------------------------------------------
 * An agent that can only be used inside its own panel is a demo. Once a user
 * activates one, three things have to be true in the CHAT:
 *
 *   1. the chat says WHICH agent is listening (name, provider, and whether it
 *      runs inside FBT or at a third party);
 *   2. the suggestion chips come from THAT agent's declared examples, not from
 *      the generic intent catalogue;
 *   3. the answer arrives in the conversation, attributed, with the same
 *      consent boundary the hub panel enforces — the run still goes through
 *      `/api/ai/agent-hub`, the same broker, the same kill switches.
 *
 * What this dock deliberately does NOT do: keep a copy of the result on the
 * server, send anything the user did not type, or offer a wallet action. It is
 * a runner, not a second agent runtime.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clearActiveAgent,
  consumeAgentPrompt,
  subscribeAgentPrompt,
  useActiveAgent
} from '../../lib/intent-ai/agentHub/activeAgent.js';
import { composeConsentMessage } from '../../lib/intent-ai/agentHub/consent.js';
import { createTask, getTask, newIdempotencyKey } from '../../lib/intent-ai/agentHub/client.js';
import { internalHash, ResultView } from './AgentHubPanel.jsx';
import '../../styles/agent-hub.css';

/* Results live for this tab only. Not localStorage: a provider answer is
   session content, not a preference, and it can be long. */
const sessionResults = new Map();

const ERROR_COPY = Object.freeze({
  AGENT_UNAVAILABLE: {
    fa: 'این ایجنت در این لحظه در دسترس نیست. وضعیت ارائه‌دهنده را در تب ایجنت‌های خارجی ببینید.',
    en: 'This agent is not available right now. Check the provider status in the external agents tab.'
  },
  RATE_LIMITED: {
    fa: 'درخواست‌ها پشت‌سرهم بود؛ یک دقیقه بعد دوباره بفرستید.',
    en: 'Too many requests in a row. Try again in a minute.'
  },
  TASK_TEXT_REQUIRED: {
    fa: 'متن درخواست خیلی کوتاه است؛ کمی بیشتر توضیح بدهید.',
    en: 'The request is too short. Add a little more detail.'
  },
  CONSENT_REQUIRED: {
    fa: 'برای ایجنت خارجی، تأیید ارسال لازم است.',
    en: 'An external agent needs the send approved first.'
  },
  PAYMENT_REQUIRED: {
    fa: 'این ایجنت پرداخت مستقیم می‌خواهد و در این نسخه پرداخت فعال نیست؛ چیزی از شما کم نشد.',
    en: 'This agent requires a direct payment, which is not enabled in this build. Nothing was charged.'
  },
  AUTH_REQUIRED: {
    fa: 'این ایجنت به حساب ارائه‌دهندهٔ خودتان نیاز دارد؛ در تب «متصل‌ها» وصل کنید.',
    en: 'This agent needs your own provider account. Connect it in the Connected tab.'
  },
  AGENT_NOT_FOUND: {
    fa: 'این ایجنت دیگر در فهرست نیست. دوباره از تب ایجنت‌های خارجی انتخاب کنید.',
    en: 'That agent is no longer listed. Pick it again from the external agents tab.'
  },
  HUB_DISABLED: {
    fa: 'ایجنت‌های خارجی روی این نسخه خاموش‌اند.',
    en: 'External agents are switched off on this deployment.'
  },
  STRONG_OWNER_REQUIRED: {
    fa: 'این کار باید از اپ روی دستگاه خودتان انجام شود تا حساب شما شناسایی شود.',
    en: 'Run this from the app on your own device so FBT can identify your account.'
  },
  NETWORK_UNAVAILABLE: {
    fa: 'ارتباط با سرور FBT برقرار نشد. اتصال را بررسی کنید.',
    en: 'FBT could not be reached. Check the connection.'
  },
  TIMEOUT: {
    fa: 'پاسخ دیر آمد. درخواست دوباره ساخته نشد؛ می‌توانید دوباره بفرستید.',
    en: 'The reply took too long. No duplicate request was created; you can send again.'
  },
  REQUEST_IN_PROGRESS: {
    fa: 'همین درخواست در حال اجراست؛ چند لحظه صبر کنید.',
    en: 'That request is already in progress. Wait a moment.'
  }
});

export function taskErrorCopy(code, fa, detail = null) {
  const row = ERROR_COPY[code];
  if (row) return fa ? row.fa : row.en;
  return detail || (fa ? 'درخواست انجام نشد.' : 'The request could not be completed.');
}

const timeLabel = (at, fa) => {
  try {
    return new Date(at).toLocaleTimeString(fa ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

export default function AgentChatDock({ fa = false, onOpenHub = null }) {
  const active = useActiveAgent();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [consented, setConsented] = useState(false);
  const [tick, setTick] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; }, []);

  const messages = useMemo(() => (active ? (sessionResults.get(active.id) || []) : []), [active, tick]);

  const push = useCallback((agentId, message) => {
    const list = sessionResults.get(agentId) || [];
    sessionResults.set(agentId, [...list, message].slice(-24));
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    setError(null);
    setConsented(false);
    setDraft('');
  }, [active?.id]);

  useEffect(() => {
    const node = listRef.current;
    if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [messages.length, busy]);

  const toExternal = active ? (active.native !== true && active.source !== 'native') : false;

  const run = useCallback(async (text) => {
    const trimmed = String(text || '').trim();
    if (!active || !trimmed || busy) return;
    if (toExternal && !consented) {
      setError(taskErrorCopy('CONSENT_REQUIRED', fa));
      return;
    }
    setError(null);
    setBusy(true);
    setDraft('');
    push(active.id, { id: `u-${Date.now()}`, role: 'user', text: trimmed, at: Date.now() });
    const out = await createTask({
      agentId: active.id,
      taskText: trimmed,
      categories: ['task_text'],
      context: {},
      idempotencyKey: newIdempotencyKey('chat')
    });
    if (!out.ok) {
      setBusy(false);
      push(active.id, {
        id: `e-${Date.now()}`,
        role: 'agent',
        error: true,
        code: out.code || null,
        text: taskErrorCopy(out.code, fa, out.detail),
        at: Date.now()
      });
      return;
    }
    let task = out.task;
    push(active.id, { id: `a-${Date.now()}`, role: 'agent', task, at: Date.now() });
    /* A2A providers may finish later. Poll the same task row — never create a
       second one for the same question. */
    const started = Date.now();
    while (aliveRef.current && task && (task.active === true || task.state === 'reconciling') && Date.now() - started < 45_000) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      if (!aliveRef.current) break;
      const refreshed = await getTask(task.id);
      if (!refreshed.ok) break;
      task = refreshed.task;
      const list = sessionResults.get(active.id) || [];
      sessionResults.set(active.id, list.map((m) => (m.role === 'agent' && m.task?.id === task.id ? { ...m, task } : m)));
      setTick((n) => n + 1);
    }
    setBusy(false);
  }, [active, busy, consented, fa, push, toExternal]);

  /* The main chat's suggestion row hands a prompt to this dock. */
  useEffect(() => subscribeAgentPrompt(({ prompt }) => { void run(prompt); }), [run]);
  useEffect(() => {
    const ready = consumeAgentPrompt();
    if (ready && active) void run(ready.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  if (!active) return null;

  const name = fa ? (active.nameFa || active.name) : (active.name || active.nameFa);
  const chips = (fa ? (active.examplesFa?.length ? active.examplesFa : active.examples) : (active.examples?.length ? active.examples : active.examplesFa)) || [];
  const preview = toExternal ? composeConsentMessage({ taskText: draft, categories: ['task_text'] }) : null;

  return (
    <section className="agentchat" data-testid="agent-chat-dock" dir={fa ? 'rtl' : 'ltr'}>
      <header className="agentchat-head">
        <span className="agentchat-mark" aria-hidden="true">✦</span>
        <div className="agentchat-id">
          <strong>{name}</strong>
          <span className="agentchat-meta">
            {active.native || active.source === 'native'
              ? (fa ? 'اجرا داخل FBT · بدون ارسال به سرویس خارجی' : 'Runs inside FBT · nothing sent to a third party')
              : (fa ? `ارائه‌دهنده: ${active.providerName || active.providerId}` : `Provider: ${active.providerName || active.providerId}`)}
          </span>
        </div>
        <span className="agentchat-state" data-live={active.status === 'LIVE' ? 'true' : 'false'}>
          {active.status === 'LIVE' ? (fa ? 'فعال' : 'active') : (active.status || '—')}
        </span>
        <button
          type="button"
          className="agentchat-ghost"
          onClick={() => { clearActiveAgent(); setConsented(false); }}
          data-testid="agent-chat-deactivate"
        >
          {fa ? 'پایان' : 'Done'}
        </button>
      </header>

      {messages.length ? (
        <div className="agentchat-log" ref={listRef} role="log" aria-live="polite" data-testid="agent-chat-log">
          {messages.map((message) => (
            <div key={message.id} className="agentchat-turn" data-role={message.role} data-error={message.error ? 'true' : 'false'}>
              <div className="agentchat-bubble">
                {message.role === 'user' ? (
                  <p>{message.text}</p>
                ) : message.task ? (
                  <>
                    <div className="agentchat-bubble-head">
                      <span>{message.task.agentName || name}</span>
                      <span className="agentchat-time">{timeLabel(message.at, fa)}</span>
                    </div>
                    {message.task.result?.data?.needsInput ? (
                      <p className="agentchat-hint" data-testid="agent-chat-needs-input">
                        {fa ? 'این ایجنت برای جواب دقیق به یک ورودی روشن‌تر نیاز دارد. یکی از نمونه‌ها را بزنید یا نماد/آدرس را بنویسید.' : 'This agent needs a clearer input. Tap an example or include the symbol/address.'}
                      </p>
                    ) : null}
                    {message.task.result ? (
                      <ResultView result={message.task.result} fa={fa} />
                    ) : (
                      <p className="agentchat-muted">{fa ? 'در حال اجرا نزد ارائه‌دهنده…' : 'Running at the provider…'}</p>
                    )}
                    {message.task.errorCode ? (
                      <p className="agentchat-error">{message.task.safeErrorMessage || message.task.errorCode}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="agentchat-error">{message.text}</p>
                )}
              </div>
            </div>
          ))}
          {busy ? (
            <div className="agentchat-turn" data-role="agent">
              <div className="agentchat-bubble agentchat-working" role="status">
                <span className="agentchat-dot" aria-hidden="true" />
                {fa ? 'در حال اجرا…' : 'Running…'}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="agentchat-empty">
          {fa
            ? 'این ایجنت در چت فعال است. یکی از پیشنهادهای زیر را بزنید یا درخواست خودتان را بنویسید — نتیجه همین‌جا نمایش داده می‌شود.'
            : 'This agent is active in the chat. Tap a suggestion or write your own request; the result appears right here.'}
        </p>
      )}

      {chips.length ? (
        <div className="agentchat-chips" role="group" aria-label={fa ? 'نمونه درخواست‌ها' : 'Example requests'}>
          {chips.slice(0, 4).map((chip, index) => (
            <button
              key={`${chip}-${index}`}
              type="button"
              className="agentchat-chip"
              onClick={() => void run(chip)}
              disabled={busy}
              data-testid={`agent-chat-chip-${index}`}
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="agentchat-form"
        onSubmit={(event) => { event.preventDefault(); void run(draft); }}
      >
        <input
          ref={inputRef}
          className="agentchat-input"
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setError(null); }}
          placeholder={fa ? `از ${name} بپرسید…` : `Ask ${name}…`}
          aria-label={fa ? 'درخواست از ایجنت فعال' : 'Request to the active agent'}
          maxLength={2000}
          dir="auto"
          data-testid="agent-chat-input"
        />
        <button
          type="submit"
          className="agentchat-send"
          disabled={busy || !draft.trim() || (toExternal && !consented)}
          data-testid="agent-chat-send"
        >
          {busy ? '…' : (fa ? 'ارسال' : 'Send')}
        </button>
      </form>

      {toExternal ? (
        <div className="agentchat-consent" data-testid="agent-chat-consent">
          <label className="ah-approve" data-on={consented ? 'true' : 'false'}>
            <input
              className="ah-approve-input"
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
              data-testid="agent-chat-consent-approve"
            />
            <span className="ah-approve-box" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </span>
            <span className="ah-approve-copy">
              <strong>{fa ? 'تأیید ارسال به ارائه‌دهنده' : 'Approve sending to the provider'}</strong>
              <span>
                {fa
                  ? 'متن درخواست به ارائه‌دهندهٔ خارجی می‌رود و شرایط و حریم خصوصی او اعمال می‌شود.'
                  : 'The request text goes to an external provider, under their terms and privacy policy.'}
              </span>
            </span>
          </label>
          {active.provider?.termsUrl || active.provider?.privacyUrl ? (
            <nav className="agentchat-policy" aria-label={fa ? 'شرایط و حریم خصوصی' : 'Terms and privacy'}>
              {active.provider?.termsUrl ? <a href={internalHash(active.provider.termsUrl) || active.provider.termsUrl} {...(internalHash(active.provider.termsUrl) ? {} : { target: '_blank', rel: 'noopener noreferrer nofollow' })}>{fa ? 'شرایط' : 'terms'}</a> : null}
              {active.provider?.privacyUrl ? <a href={internalHash(active.provider.privacyUrl) || active.provider.privacyUrl} {...(internalHash(active.provider.privacyUrl) ? {} : { target: '_blank', rel: 'noopener noreferrer nofollow' })}>{fa ? 'حریم خصوصی' : 'privacy'}</a> : null}
            </nav>
          ) : null}
          {draft.trim().length >= 4 && preview?.ok ? (
            <details className="agentchat-preview" data-testid="agent-chat-preview">
              <summary>{fa ? 'دقیقاً این متن ارسال می‌شود' : 'Exactly this text is sent'}</summary>
              <pre className="ah-pre">{preview.text}</pre>
            </details>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="agentchat-error" role="alert" data-testid="agent-chat-error">{error}</p> : null}

      <footer className="agentchat-foot">
        <span>{fa ? 'همان بروکر و همان کلید توقف تب ایجنت‌های خارجی.' : 'Same broker and kill switches as the external agents tab.'}</span>
        {onOpenHub ? (
          <button type="button" className="agentchat-ghost" onClick={onOpenHub}>
            {fa ? 'مدیریت ایجنت‌ها' : 'Manage agents'}
          </button>
        ) : null}
      </footer>
    </section>
  );
}
