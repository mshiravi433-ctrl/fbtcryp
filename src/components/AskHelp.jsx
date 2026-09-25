import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { localAnswer } from '../lib/faqLocal';
import { useTelegram } from '../context/TelegramContext';
import { IconExternal, IconSparkle } from './Icons';

import { apiBase } from '../lib/apiBase.js';

/*
 * THE API ORIGIN IS NOT A CONSTANT ANY MORE.
 *
 * This used to read `import.meta.env?.VITE_API_BASE || '/api'`. That is the
 * exact expression lib/apiBase.js was written to replace, and it is wrong in
 * one place only — but the place that matters: inside the packaged Android
 * app the WebView serves the bundle from https://localhost, so a relative
 * '/api' resolves to the phone's OWN static asset server and every request
 * 404s. On the website the same expression is correct (same origin), which is
 * precisely why these modules looked fine and quietly died in the APK.
 *
 * apiBase() answers the question once: VITE_API_BASE when it is a usable
 * absolute origin, the canonical origin inside the native shell, '/api'
 * everywhere else.
 */
const API_BASE = apiBase();

/** Starter questions: one about the app, three general. */
const SUGGESTIONS = ['fee', 'blockchain', 'failed', 'safe'];

/**
 * ASK — the help assistant.
 * ---------------------------------------------------------------------------
 * A threaded conversation rather than a single question box, because the
 * follow-up is where the value is: "what is gas?" → "so why is mine so high?"
 * A box that forgets the previous answer forces the user to re-explain
 * themselves every time.
 *
 * ROUTING (the part that keeps it honest)
 *
 *   1. `localAnswer` scores the question against our hand-written FAQ. A
 *      confident hit is answered instantly, offline and free — and it is
 *      *better* than a model, because it was written against what this code
 *      actually does.
 *
 *   2. Otherwise the question goes to /api/ai/ask. If our FAQ matched weakly,
 *      that text is sent as context and the server locks the model to it. If
 *      nothing matched, the server treats it as a general question, searches
 *      the web, and explicitly forbids the model from guessing about FBT Swap.
 *
 *   3. With no key or no network the user still gets the best local match, or
 *      a clear pointer to human support. Never a spinner that never resolves.
 *
 * Every answer carries a provenance label. A user is entitled to know whether
 * they are reading something a person wrote about this app or something a
 * model generated.
 *   3. Every reply carries the engine that produced it. When no external model
 *      answered, the badge reads «موتور قاعده‌محور» and a note says so — a
 *      template sentence is never presented as a model's reading.
 */
export default function AskHelp() {
  const { t, i18n } = useTranslation();
  const { haptic } = useTelegram();

  const [q, setQ] = useState('');
  const [thread, setThread] = useState([]); // { role, text, source?, sources? }
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  // Keep the newest turn in view. `block: 'nearest'` so it never yanks the
  // whole Help page around when the thread is short.
  useEffect(() => {
    if (!thread.length) return;
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [thread]);

  const send = async (raw) => {
    const question = String(raw ?? q).trim();
    if (!question || busy) return;

    haptic?.('light');
    setQ('');
    setBusy(true);
    setThread((cur) => [...cur, { role: 'user', text: question }]);

    const lang = i18n.language;
    const local = localAnswer(question, lang);

    // A confident local hit beats anything generated, about our own app.
    if (local && local.confidence >= 0.5) {
      setThread((cur) => [...cur, { role: 'bot', text: local.answer, source: 'local' }]);
      setBusy(false);
      return;
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const res = await fetch(`${API_BASE}/ai/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          question,
          context: local ? [local.answer] : [],
          lang
        })
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (!data?.answer) throw new Error('EMPTY');

      /*
       * ─── THE SERVER NOW SAYS WHICH BRAIN ANSWERED ───────────────────────
       * `routedChat` never throws: when every keyed provider refuses (a retired
       * model id, a paid model on a free tier, an empty credit balance) the
       * gateway answers from the deterministic rule engine and marks the reply
       * `degraded`. Labelling that text «هوش مصنوعی» is how a fleet with nine
       * keys and one working model kept looking healthy — the badge said AI, the
       * sentence underneath was a template. The badge now follows the engine.
       */
      const degraded = Boolean(data.degraded) || data.source === 'internal-rules' || data.engine === 'internal-rules';
      setThread((cur) => [
        ...cur,
        {
          role: 'bot',
          text: data.answer,
          source: degraded ? 'rules' : (data.source === 'model-grounded' || data.grounded ? 'model' : 'web'),
          degraded,
          provider: degraded ? null : (data.provider || null),
          model: degraded ? null : (data.model || null),
          sources: Array.isArray(data.sources) ? data.sources.filter((s) => s.url) : []
        }
      ]);
    } catch {
      /*
       * Unavailable — no key, no network, or a timeout. Fall back to the weak
       * local match if there is one, otherwise say plainly that we do not know
       * and point at a human. Never a raw status code: "HTTP 503" tells the
       * user nothing they can act on.
       */
      setThread((cur) => [
        ...cur,
        local
          ? { role: 'bot', text: local.answer, source: 'local' }
          : { role: 'bot', text: t('help.ask.noAnswer'), source: 'none' }
      ]);
    }
    setBusy(false);
  };

  return (
    <section className="ask-card">
      <div className="ask-head">
        <span className="ask-badge" aria-hidden="true">
          <IconSparkle width={15} height={15} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="ask-title">{t('help.ask.title')}</div>
          <div className="faint" style={{ lineHeight: 1.55 }}>{t('help.ask.subtitle')}</div>
        </div>
        {thread.length > 0 && (
          <button className="ask-clear" onClick={() => setThread([])} type="button">
            {t('help.ask.clear')}
          </button>
        )}
      </div>

      {/* Starter chips, only before the first question — once a conversation
          exists they are noise competing with the answer. */}
      {thread.length === 0 && (
        <div className="ask-chips">
          {SUGGESTIONS.map((k) => (
            <button key={k} type="button" className="ask-chip" onClick={() => send(t(`help.ask.s.${k}`))}>
              {t(`help.ask.s.${k}`)}
            </button>
          ))}
        </div>
      )}

      {thread.length > 0 && (
        <div className="ask-thread">
          <AnimatePresence initial={false}>
            {thread.map((m, i) => (
              <motion.div
                key={`${i}-${m.text.slice(0, 24)}`}
                className={`ask-msg ask-${m.role}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22 }}
              >
                <div className="ask-bubble">{m.text}</div>

                {/*
                 * A rule-engine reply says so in its own line. It is not an
                 * error toast: the answer is still usable, the user just has to
                 * know no model read their question.
                 */}
                {m.role === 'bot' && m.degraded ? (
                  <p className="ask-degraded" data-testid="ask-degraded-note" role="note">
                    {t('help.ask.degraded')}
                  </p>
                ) : null}

                {m.role === 'bot' && (
                  <div className="ask-meta">
                    <span className={`ask-src ask-src-${m.source}`}>
                      {t(`help.ask.source.${m.source}`)}
                    </span>

                    {/* Real links, so a web-sourced claim can be checked. */}
                    {m.sources?.slice(0, 3).map((s) => (
                      <a
                        key={s.url}
                        className="ask-link"
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {s.title?.slice(0, 28) || s.url}
                        <IconExternal width={10} height={10} />
                      </a>
                    ))}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {busy && (
            <div className="ask-msg ask-bot">
              <div className="ask-bubble ask-typing" aria-label={t('help.ask.thinking')}>
                <i /><i /><i />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('help.ask.placeholder')}
          maxLength={300}
          enterKeyHint="send"
        />
        <button type="submit" className="ask-send" disabled={!q.trim() || busy} aria-label={t('help.ask.send')}>
          {/* Arrow points along the reading direction; RTL flips it in CSS. */}
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h13M12 5l7 7-7 7" />
          </svg>
        </button>
      </form>

      <p className="faint ask-foot">{t('help.ask.disclaimer')}</p>
    </section>
  );
}
