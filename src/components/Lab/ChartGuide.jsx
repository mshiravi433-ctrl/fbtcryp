/**
 * CHART GUIDE v3 — «راهنمای نمودار»
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── THE REPORT THIS VERSION ANSWERS ─────────────────────────────────────
 * «صفحه آموزش نمودار خیلی زشته، دکمه‌ها کار نمیده، زیر تب‌ها خیلی زشته،
 *  چندتا نمودار داره … صفحه رو شلوغ نکنی، یک نمودار باشه … و معلم هوش مصنوعی
 *  هم باشد.»
 *
 * That is five requirements, and they are all structural rather than cosmetic:
 *
 *   1. ONE CHART.          The page renders exactly one chart frame. No second
 *                          canvas, no stacked panes, no sparklines competing
 *                          with it. Volume is translucent bars inside the price
 *                          pane and RSI is a strip along its bottom edge, so
 *                          "which chart am I looking at?" never has an answer
 *                          other than "the only one".
 *   2. BUTTONS THAT WORK.  Every control on the screen changes the chart in the
 *                          same frame it is pressed — see `GuideChart`, which
 *                          is pure React + arithmetic and waits for nothing.
 *   3. IT SHOWS AND TELLS. Pressing a tool draws the tool on the candles AND
 *                          opens its explanation card. Neither happens alone.
 *   4. PROFIT / LOSS / TIME. Every tool's card answers the same four questions
 *                          in the same order: what it is · when it argues for
 *                          profit · when it warns of loss · whether it speaks
 *                          about the past (fact) or the future (guess).
 *   5. AN AI TEACHER.      A teacher that runs on the device (see
 *                          `chartGuideTeacher.js`), reads the same numbers as
 *                          the chart, answers questions about the open tool,
 *                          and — this is the part that makes it a teacher and
 *                          not a chat box — can put its answer on the chart by
 *                          switching the tool for you.
 *
 * ─── WHAT WAS DELETED, AND WHY ────────────────────────────────────────────
 * The tab rail, the chapter rail, the six-cell facts grid and the numbered step
 * list are gone. Each of them was individually reasonable; together they made
 * the reader choose a tab, choose a chapter, scroll a chart, scroll a facts
 * strip and then read four paragraphs before anything was explained. The unit
 * of this screen is now a TOOL, and a tool is one button with one card.
 *
 * ─── THE HONESTY RULES, IN THE UI ─────────────────────────────────────────
 *   · The practice-data banner sits ABOVE the chart, before any pixels.
 *   · The AI panel says «روی دستگاه» — nothing is uploaded.
 *   · No copy anywhere suggests a trade, an entry, or a target price. The P&L
 *     tool draws risk geometry, not a recommendation, and says so.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import PageTransition from '../PageTransition';
import { LAB_EASE, LabBack, Notice, useIsRtl } from './Shared';
import { LabIcon } from './LabIcons';
import { useStill } from '../AnimatedIcon';
import GuideChart, { guideSnapshot } from './GuideChart';
import {
  CHART_TYPES,
  DEFAULT_STATE,
  RANGES,
  TOOL_BY_ID,
  TOOLS,
  applyTool,
  stateFor
} from './chartGuideData';
import { QUICK_PROMPTS, ask, briefing, quickPromptText } from './chartGuideTeacher';
import '../../styles/lab-chart-guide.css';

/** A tiny typing effect for the teacher's latest line (instant when still). */
function useTyped(text, enabled = true) {
  const still = useStill();
  const [shown, setShown] = useState(() => (still || !enabled ? text : ''));
  useEffect(() => {
    if (!enabled || still) {
      setShown(text);
      return undefined;
    }
    let i = 0;
    let raf = 0;
    setShown('');
    const step = () => {
      i = Math.min(text.length, i + 3);
      setShown(text.slice(0, i));
      if (i < text.length) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, still, enabled]);
  return enabled ? shown : text;
}

/** One teacher bubble. Only the newest teacher line types out. */
function TeacherBubble({ message, typing, t }) {
  const still = useStill();
  const text = useTyped(message.text, typing && message.role === 'teacher');
  const isReader = message.role === 'reader';
  return (
    <motion.div
      className={`cgx-msg ${isReader ? 'is-reader' : 'is-teacher'}`}
      initial={still ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: LAB_EASE }}
    >
      {!isReader && (
        <span className="cgx-msg-avatar" aria-hidden="true">
          <LabIcon name="robot" width={13} height={13} />
        </span>
      )}
      <div className="cgx-msg-body">
        <p className="cgx-msg-text">
          {text}
          {typing && message.role === 'teacher' && text.length < message.text.length && (
            <span className="cgx-caret" aria-hidden="true" />
          )}
        </p>
        {Array.isArray(message.chips) && message.chips.length > 0 && (
          <div className="cgx-msg-chips">
            {message.chips.map((chip, i) => (
              <span key={`${chip.label}-${i}`} className={`cgx-msg-chip ${chip.tone ? `is-${chip.tone}` : ''}`}>
                <span>{chip.label}</span>
                <b className="lab2-num">{chip.value}</b>
              </span>
            ))}
          </div>
        )}
        {message.action && (
          <button
            type="button"
            className="cgx-msg-action"
            data-testid={`cgx-teacher-action-${message.action.tool}`}
            onClick={() => message.onAction?.(message.action.tool)}
          >
            <LabIcon name="target" width={12} height={12} />
            {message.action.label}
          </button>
        )}
      </div>
    </motion.div>
  );
}

export default function ChartGuide({ onBack }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const still = useStill();
  const rtl = useIsRtl();

  /* `/lab/chart-guide` is its own route: "back" is a navigation, not a state
     reset. A caller that passes `onBack` (a test or an embedded host) wins. */
  const goBack = onBack ?? (() => navigate('/lab?tab=advanced'));

  const [state, setState] = useState(DEFAULT_STATE);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const scroller = useRef(null);
  const tool = TOOL_BY_ID[state.tool] ?? TOOLS[0];

  /* The numbers on screen and the numbers the teacher quotes are one object. */
  const live = useMemo(() => guideSnapshot(state.range), [state.range]);

  const setTool = (id) => setState((s) => stateFor(id, s));
  const setRange = (range) => setState((s) => ({ ...s, range, zoom: 0, rangePinned: true }));

  /* ── the teacher is told what the reader just opened ───────────────────── */
  useEffect(() => {
    const next = briefing(tool.id, live, t);
    setMessages((prev) => [...prev, next].slice(-8));
    /* Deliberately keyed on the tool only: re-briefing on every range change
       would spam the log with five near-identical sentences. The live number a
       reader checks is on the chart header. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool.id]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = (question) => {
    const q = String(question ?? '').trim();
    if (!q) return;
    const reply = ask(q, { toolId: tool.id, live }, t);
    /* The teacher's jump button only changes the tool. The tool effect above
       posts the new briefing, so appending one here as well would double it —
       the same sentence twice reads as a chat that is not listening. */
    reply.onAction = (id) => setState((s) => applyTool(id, s));
    setMessages((prev) => [...prev, { role: 'reader', text: q }, reply].slice(-8));
    setDraft('');
  };

  /* The last teacher bubble types; every earlier one is settled text. */
  const lastTeacherIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'teacher') return i;
    return -1;
  }, [messages]);

  const lessonKeys = ['what', 'profit', 'loss', 'time'];
  const lessonTone = { what: 'info', profit: 'profit', loss: 'loss', time: 'time' };

  return (
    /* `PageTransition` supplies the shell padding (`.page`) and the route's
       enter motion. This screen has its own URL, so unlike the Lab's child
       simulators it is not already inside that wrapper — without it the cards
       sit flush against the edge of the phone. */
    <PageTransition>
    <div
      className={`lab2 lab2-cgx ${still ? 'is-still' : ''}`}
      style={{ '--cgx-accent': tool.accent }}
      dir={rtl ? 'rtl' : 'ltr'}
    >
      <LabBack
        onBack={goBack}
        icon="activity"
        accent="cyan"
        title={t('lab2.screens.chartGuide.title')}
        sub={t('lab2.screens.chartGuide.sub')}
      />

      {/* ═══ THE SINGLE CHART ═══════════════════════════════════════════════
          One frame, one plot, one place the reader ever has to look. The
          practice-data badge is inside this card, above the pixels. */}
      <section className="cgx-hero" aria-label={t('lab2.cgx.heroTitle')}>
        <header className="cgx-hero-head">
          <div className="cgx-hero-title">
            <span className="cgx-live-dot" aria-hidden="true" />
            <span>{t('lab2.cgx.heroTitle')}</span>
          </div>
          <div className="cgx-hero-price" dir="ltr">
            <b className="lab2-num">{live.price.toFixed(2)}</b>
            <em className={`lab2-num ${live.change >= 0 ? 'up' : 'down'}`}>
              {live.change >= 0 ? '+' : ''}{live.change.toFixed(2)}%
            </em>
          </div>
        </header>

        <div className="cgx-badges">
          <span className="cgx-badge is-practice" data-testid="chart-guide-sample">
            <LabIcon name="flask" width={12} height={12} />
            {t('lab2.cgx.badge.practice')}
          </span>
          <span className="cgx-badge">
            <LabIcon name="layers" width={12} height={12} />
            {t('lab2.cgx.badge.oneChart')}
          </span>
          <span className="cgx-badge is-ai">
            <LabIcon name="robot" width={12} height={12} />
            {t('lab2.cgx.badge.teacher')}
          </span>
        </div>

        <GuideChart
          tool={tool.id}
          range={state.range}
          chartType={state.chartType}
          grid={state.grid}
          zoom={state.zoom}
          height={360}
        />

        {/* The controls sit UNDER the chart they move, not above it: the eye
            lands on the candles first and finds the dials underneath. */}
        <div className="cgx-controls">
          <div className="cgx-seg" role="group" aria-label={t('lab2.cgx.toolbar.range')}>
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className={`cgx-seg-btn ${state.range === r ? 'on' : ''}`}
                aria-pressed={state.range === r}
                onClick={() => setRange(r)}
                data-testid={`cgx-range-${r}`}
              >
                {t(`lab2.cgx.range.${r}`, { defaultValue: r })}
              </button>
            ))}
          </div>

          <div className="cgx-viewbtns">
            {CHART_TYPES.map((ty) => (
              <button
                key={ty}
                type="button"
                className={`cgx-ico-btn ${state.chartType === ty ? 'on' : ''}`}
                aria-pressed={state.chartType === ty}
                aria-label={t(`lab2.cgx.types.${ty}`)}
                title={t(`lab2.cgx.types.${ty}`)}
                onClick={() => setState((s) => ({ ...s, chartType: ty, chartTypePinned: true }))}
                data-testid={`cgx-type-${ty}`}
              >
                <LabIcon name={ty === 'candles' ? 'candles' : ty === 'line' ? 'wave' : 'bands'} width={14} height={14} />
              </button>
            ))}
            <button
              type="button"
              className={`cgx-ico-btn ${state.grid ? 'on' : ''}`}
              aria-pressed={state.grid}
              aria-label={t('lab2.cgx.toolbar.grid')}
              title={t('lab2.cgx.toolbar.grid')}
              onClick={() => setState((s) => ({ ...s, grid: !s.grid }))}
              data-testid="cgx-grid"
            >
              <LabIcon name="ruler" width={14} height={14} />
            </button>
            <button
              type="button"
              className="cgx-ico-btn"
              aria-label={t('lab2.cgx.toolbar.zoomIn')}
              title={t('lab2.cgx.toolbar.zoomIn')}
              onClick={() => setState((s) => ({ ...s, zoom: s.zoom + 12 }))}
              data-testid="cgx-zoom"
            >
              <LabIcon name="plus" width={14} height={14} />
            </button>
            <button
              type="button"
              className="cgx-ico-btn"
              aria-label={t('lab2.cgx.toolbar.fit')}
              title={t('lab2.cgx.toolbar.fit')}
              onClick={() => setState((s) => ({ ...s, zoom: 0 }))}
              data-testid="cgx-fit"
            >
              <LabIcon name="refresh" width={14} height={14} />
            </button>
          </div>
        </div>
      </section>

      {/* ═══ THE TOOL RAIL ═════════════════════════════════════════════════
          The only navigation on the page. One row, one control per lesson, no
          second level. Horizontal scroll keeps the row from wrapping and
          changing the chart's position under the reader's thumb. */}
      <section className="cgx-rail" aria-label={t('lab2.cgx.rail.title')}>
        <div className="cgx-rail-head">
          <h2>{t('lab2.cgx.rail.title')}</h2>
          <p>{t('lab2.cgx.rail.hint')}</p>
        </div>
        <div className="cgx-rail-track" role="tablist" aria-label={t('lab2.cgx.rail.title')}>
          {TOOLS.map((item) => {
            const on = item.id === tool.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={on}
                className={`cgx-tool ${on ? 'on' : ''}`}
                style={{ '--tool-acc': item.accent }}
                onClick={() => setTool(item.id)}
                data-testid={`cgx-tool-${item.id}`}
              >
                <span className="cgx-tool-glyph" aria-hidden="true">
                  <LabIcon name={item.icon} width={16} height={16} />
                </span>
                <span className="cgx-tool-label">{t(`lab2.cgx.tools.${item.id}.label`)}</span>
                {on && !still && (
                  <motion.span
                    layoutId="cgx-tool-pill"
                    className="cgx-tool-pill"
                    transition={{ type: 'spring', stiffness: 460, damping: 38 }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* ═══ THE EXPLANATION CARD ══════════════════════════════════════════
          Opens with the tool and answers four questions in a fixed order. The
          "shown on the chart" line is not decoration: it is the promise of the
          button being kept, stated. */}
      <motion.section
        className="cgx-lesson"
        key={tool.id}
        initial={still ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: LAB_EASE }}
        aria-live="polite"
        data-testid="cgx-lesson"
      >
        <header className="cgx-lesson-head">
          <span className="cgx-lesson-glyph" aria-hidden="true">
            <LabIcon name={tool.icon} width={16} height={16} />
          </span>
          <div className="cgx-lesson-title">
            <h2>{t(`lab2.cgx.tools.${tool.id}.label`)}</h2>
            <span className="cgx-lesson-shown">
              <LabIcon name="check" width={11} height={11} />
              {t('lab2.cgx.lesson.shown')}
            </span>
          </div>
        </header>

        <div className="cgx-lesson-grid">
          {lessonKeys.map((key) => (
            <div key={key} className={`cgx-card is-${lessonTone[key]}`} data-testid={`cgx-lesson-${key}`}>
              <div className="cgx-card-k">
                <LabIcon
                  name={key === 'what' ? 'info' : key === 'profit' ? 'up' : key === 'loss' ? 'down' : 'clock'}
                  width={12}
                  height={12}
                />
                {t(`lab2.cgx.lesson.${key}`)}
              </div>
              <p className="cgx-card-v">{t(`lab2.cgx.tools.${tool.id}.${key}`)}</p>
            </div>
          ))}
        </div>

        <div className="cgx-time">
          <div className="cgx-time-bar" aria-hidden="true">
            <span className="cgx-time-past" />
            <span className="cgx-time-now" />
            <span className="cgx-time-future" />
          </div>
          <div className="cgx-time-legend">
            <span>{t('lab2.cgx.chart.past')}</span>
            <span className="is-now">{t('lab2.cgx.chart.now')}</span>
            <span className="is-future">{t('lab2.cgx.chart.future')}</span>
          </div>
        </div>

        <div className="cgx-where">
          <LabIcon name="target" width={12} height={12} />
          <span>{t(`lab2.cgx.tools.${tool.id}.where`)}</span>
        </div>
      </motion.section>

      {/* ═══ THE AI TEACHER ════════════════════════════════════════════════
          On-device, deterministic, and honest about both. It answers from the
          same five fields the card uses plus the live numbers, and its answers
          can move the chart — which is the difference between a chat bubble and
          a teacher. */}
      <section className="cgx-teacher" aria-label={t('lab2.cgx.teacher.name')} data-testid="cgx-teacher">
        <header className="cgx-teacher-head">
          <span className="cgx-orb" aria-hidden="true">
            <LabIcon name="brain" width={17} height={17} />
          </span>
          <div className="cgx-teacher-who">
            <h2>{t('lab2.cgx.teacher.name')}</h2>
            <span>{t('lab2.cgx.teacher.role')}</span>
          </div>
          <span className="cgx-badge is-ai" title={t('lab2.cgx.teacher.onDeviceHint')}>
            <LabIcon name="shield" width={11} height={11} />
            {t('lab2.cgx.teacher.onDevice')}
          </span>
        </header>

        <div className="cgx-log" ref={scroller} role="log" aria-live="polite" data-testid="cgx-teacher-log">
          {messages.map((m, i) => (
            <TeacherBubble key={`${i}-${m.role}`} message={m} typing={i === lastTeacherIdx} t={t} />
          ))}
        </div>

        <div className="cgx-quick">
          {QUICK_PROMPTS.map((id) => (
            <button
              key={id}
              type="button"
              className="cgx-quick-btn"
              onClick={() => send(quickPromptText(id, tool.id, t))}
              data-testid={`cgx-quick-${id}`}
            >
              {quickPromptText(id, tool.id, t)}
            </button>
          ))}
        </div>

        <form
          className="cgx-ask"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <input
            type="text"
            className="cgx-ask-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('lab2.cgx.teacher.placeholder')}
            aria-label={t('lab2.cgx.teacher.placeholder')}
            data-testid="cgx-teacher-input"
          />
          <button type="submit" className="cgx-ask-send" aria-label={t('lab2.cgx.teacher.send')} data-testid="cgx-teacher-send">
            <LabIcon name="next" width={16} height={16} />
          </button>
        </form>

        <p className="cgx-teacher-note">{t('lab2.cgx.teacher.disclaimer')}</p>
      </section>

      <Notice variant="tip" icon="bulb" title={t('lab2.cgx.noteTitle')}>
        {t('lab2.cgx.note')}
      </Notice>

      <div className="cgx-exit">
        <Link className="cgx-exit-link" to="/lab?tab=advanced">
          <LabIcon name="back" width={14} height={14} />
          {t('lab2.cgx.backToLab')}
        </Link>
      </div>
    </div>
    </PageTransition>
  );
}
