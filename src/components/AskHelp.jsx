import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { localAnswer } from '../lib/faqLocal';
import { IconInfo } from './Icons';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * ASK A QUESTION
 * ---------------------------------------------------------------------------
 * This was removed once before, for a good reason: it was a chat box wired to
 * a model that was usually not configured, so it answered nothing — and when
 * it *was* configured it would happily invent a fee percentage. On a finance
 * app an invented fee is not a wrong answer, it is a lie the user may act on.
 *
 * It comes back with a different design that fixes both problems:
 *
 * 1. LOCAL FIRST. `localAnswer` scores the question against twelve
 *    hand-written entries about this exact app. If it matches confidently,
 *    that answer is shown instantly — offline, free, and verified against
 *    what the code actually does. Most questions land here.
 *
 * 2. THE MODEL IS NEVER THE SOURCE OF FACTS. On a weak local match we send the
 *    question AND the closest FAQ text to /api/ai/ask, where the prompt
 *    forbids answering beyond that supplied text. The model rewords our facts
 *    to fit the question; it does not supply new ones.
 *
 * 3. IT DEGRADES TO SOMETHING USEFUL. No backend, no key, no network — the
 *    user still gets the best local match, or a clear "ask support" with the
 *    link. It never shows an empty box or a spinner that never resolves.
 *
 * Every answer is labelled with where it came from. A user is entitled to know
 * whether they are reading something a human wrote about this app or something
 * a model generated.
 */
export default function AskHelp() {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState('');
  const [state, setState] = useState('idle'); // idle | thinking | done
  const [result, setResult] = useState(null); // { text, source }

  const ask = async (e) => {
    e?.preventDefault?.();
    const question = q.trim();
    if (!question || state === 'thinking') return;

    setState('thinking');
    setResult(null);

    const lang = i18n.language;
    const local = localAnswer(question, lang);

    // A confident local hit is better than anything a model can produce about
    // our own fee structure, and it costs nothing. Take it and stop.
    if (local && local.confidence >= 0.5) {
      setResult({ text: local.answer, source: 'local' });
      setState('done');
      return;
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(`${API_BASE}/ai/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          question,
          // Ground the model in our own text. Without this it invents.
          context: local ? [local.answer] : [],
          lang
        })
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      if (!data?.answer) throw new Error('EMPTY');
      setResult({ text: data.answer, source: 'model' });
    } catch {
      /*
       * The model is unavailable — no key, no network, or a timeout. Fall back
       * to the weak local match if there is one, otherwise say plainly that we
       * do not know and point at a human. Never a raw error code: "HTTP 503"
       * tells the user nothing they can act on.
       */
      setResult(
        local
          ? { text: local.answer, source: 'local' }
          : { text: t('help.ask.noAnswer'), source: 'none' }
      );
    }
    setState('done');
  };

  return (
    <section className="card">
      <div className="row" style={{ gap: 9, marginBottom: 8 }}>
        <span style={{ color: 'var(--rgb-1)', flexShrink: 0 }}>
          <IconInfo width={17} height={17} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('help.ask.title')}</div>
          <div className="faint" style={{ lineHeight: 1.6 }}>{t('help.ask.subtitle')}</div>
        </div>
      </div>

      <form onSubmit={ask} className="row" style={{ gap: 7 }}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('help.ask.placeholder')}
          maxLength={300}
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={!q.trim() || state === 'thinking'}
          style={{ flexShrink: 0 }}
        >
          {state === 'thinking' ? t('help.ask.thinking') : t('help.ask.send')}
        </button>
      </form>

      <AnimatePresence mode="wait">
        {state === 'done' && result && (
          <motion.div
            key={result.text}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ marginTop: 11 }}
          >
            <p className="ask-a">{result.text}</p>

            {/* Provenance is not decoration. The user should know whether a
                human wrote this about this app, or a model generated it. */}
            <span className="pill" style={{ fontSize: 9.5 }}>
              {t(`help.ask.source.${result.source}`)}
            </span>

            {result.source !== 'local' && (
              <p className="faint" style={{ marginTop: 8, lineHeight: 1.7 }}>
                {t('help.ask.verify')}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
