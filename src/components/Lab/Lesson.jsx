/**
 * Interactive Lessons — "Learning by Doing" quizzes.
 * Each lesson is one question with four options.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { LabBack, Panel, Row, Notice } from './Shared';
import { LESSONS } from '../../lib/lab/scenarios';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

export default function Lesson({ onBack }) {
  const { t } = useTranslation();
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

  const question = t(`lab2.lessons.${active.id}.question`);
  const options = t(`lab2.lessons.${active.id}.options`, { returnObjects: true }) || [];
  const explanation = t(`lab2.lessons.${active.id}.explanation`);

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
      <LabBack onBack={onBack} title={`🧠 ${t('lab2.screens.lessons.title')}`} sub={t('lab2.screens.lessons.sub')} />

      <Panel title={t('lab2.lesson.progress')}>
        <Row label={t('lab2.level.lessonsCompleted')} value={<span className="lab2-num">{lessonState.completed.length} / {LESSONS.length}</span>} />
        <Row label={t('lab2.lesson.totalXp')} value={<span className="lab2-num">{xp.toLocaleString()}</span>} />
      </Panel>

      <Panel title={t('lab2.lesson.pick')}>
        <div className="lab2-defi-tabs">
          {LESSONS.map((l) => {
            const done = lessonState.completed.includes(l.id);
            return (
              <button
                key={l.id}
                className={`lab2-defi-tab ${activeId === l.id ? 'active' : ''}`}
                onClick={() => { setActiveId(l.id); setSelected(null); setRevealed(false); }}
              >
                {done ? '✓ ' : ''}{l.icon} {t(`lab2.lessons.${l.id}.title`)}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title={`${active.icon} ${t(`lab2.lessons.${active.id}.title`)}`}>
        <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500, marginBottom: 10 }}>
          {question}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map((opt, idx) => {
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
              explanation={explanation}
              score={selected === active.correct ? 100 : 25}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="lab2-btn ghost full" onClick={() => { setSelected(null); setRevealed(false); }}>
                {t('lab2.tryAgain')}
              </button>
              <button className="lab2-btn primary full" onClick={next}>
                {t('lab2.nextLesson')} <span className="lab2-arrow">→</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isDone && (
        <Notice icon="🏆">
          {t('lab2.lesson.alreadyDone', { score: bestScore })}
        </Notice>
      )}
    </div>
  );
}

function ResultInline({ correct, explanation, score }) {
  const { t } = useTranslation();
  return (
    <div className={`lab2-result ${correct ? 'win' : 'loss'}`}>
      <div className="lab2-result-emoji">{correct ? '✅' : '❌'}</div>
      <div className="lab2-result-title">{correct ? t('lab2.lesson.correct') : t('lab2.lesson.notQuite')}</div>
      <div className="lab2-result-sub lab2-num">{t('lab2.lesson.score', { score })}</div>
      <div style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 8, textAlign: 'start' }}>
        {explanation}
      </div>
    </div>
  );
}
