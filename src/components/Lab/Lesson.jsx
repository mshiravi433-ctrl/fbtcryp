/**
 * Interactive Lessons — "Learning by Doing" quizzes.
 *
 * Each lesson is one question with four options. The user picks one, gets
 * instant feedback, and the lesson is marked complete (one shot — the spec
 * is explicit that re-doing a lesson should not give more XP, because the
 * point is to learn, not to grind).
 *
 * Why one question per lesson and not a longer quiz: the spec calls for
 * bite-sized "Learning by Doing" units. A long quiz feels like homework; a
 * single good question with a good explanation feels like a useful coffee
 * break.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LabBack, AICoach, Panel, Row, Notice } from './Shared';
import { LESSONS } from '../../lib/lab/scenarios';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

export default function Lesson({ onBack }) {
  const { haptic } = useTelegram();
  const completeLesson = useLabStore((s) => s.completeLesson);
  const lessonState = useLabStore((s) => s.lessons);
  const xp = useLabStore((s) => s.xp);

  const [activeId, setActiveId] = useState(LESSONS[0].id);
  const [selected, setSelected] = useState(null);
  const [revealed, setRevealed] = useState(false);

  const active = LESSONS.find((l) => l.id === activeId) ?? LESSONS[0];
  const isDone = lessonState.completed.includes(active.id);
  const bestScore = lessonState.scores[active.id] ?? 0;

  const handle = (idx) => {
    if (revealed) return;
    haptic?.('select');
    setSelected(idx);
    setRevealed(true);
    const correct = idx === active.correct;
    const score = correct ? 100 : 25;
    completeLesson(active.id, score);
    if (correct) haptic?.('success');
  };

  const next = () => {
    const idx = LESSONS.findIndex((l) => l.id === activeId);
    const nxt = LESSONS[(idx + 1) % LESSONS.length];
    setActiveId(nxt.id);
    setSelected(null);
    setRevealed(false);
  };

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title="🧠 Lessons" sub="Bite-sized. One question, one lesson." />

      <Panel title="Progress">
        <Row label="Completed" value={`${lessonState.completed.length} / ${LESSONS.length}`} />
        <Row label="Total XP" value={xp.toLocaleString()} />
      </Panel>

      <Panel title="Pick a lesson">
        <div className="lab2-defi-tabs">
          {LESSONS.map((l) => {
            const done = lessonState.completed.includes(l.id);
            return (
              <button
                key={l.id}
                className={`lab2-defi-tab ${activeId === l.id ? 'active' : ''}`}
                onClick={() => { setActiveId(l.id); setSelected(null); setRevealed(false); }}
              >
                {done ? '✓ ' : ''}{l.icon} {l.title}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title={`${active.icon} ${active.title}`}>
        <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500, marginBottom: 10 }}>
          {active.question}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {active.options.map((opt, idx) => {
            const isCorrect = idx === active.correct;
            const isPicked = selected === idx;
            let cls = 'lab2-quiz-option';
            if (revealed) {
              if (isCorrect) cls += ' correct';
              else if (isPicked) cls += ' wrong';
            }
            return (
              <button key={idx} className={cls} onClick={() => handle(idx)}>
                <span className="lab2-quiz-letter">{String.fromCharCode(65 + idx)}</span>
                <span>{opt}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      <AnimatePresence>
        {revealed && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
            <ResultInline
              correct={selected === active.correct}
              explanation={active.explanation}
              score={selected === active.correct ? 100 : 25}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="lab2-btn ghost full" onClick={() => { setSelected(null); setRevealed(false); }}>
                Try again
              </button>
              <button className="lab2-btn primary full" onClick={next}>
                Next lesson →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isDone && (
        <Notice icon="🏆">
          You have already completed this lesson (best score: {bestScore}%).
          You can review the explanation any time.
        </Notice>
      )}
    </div>
  );
}

function ResultInline({ correct, explanation, score }) {
  return (
    <div className={`lab2-result ${correct ? 'win' : 'loss'}`}>
      <div className="lab2-result-emoji">{correct ? '✅' : '❌'}</div>
      <div className="lab2-result-title">{correct ? 'Correct' : 'Not quite'}</div>
      <div className="lab2-result-sub">Score: {score}/100</div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 8, textAlign: 'left' }}>
        {explanation}
      </div>
    </div>
  );
}
