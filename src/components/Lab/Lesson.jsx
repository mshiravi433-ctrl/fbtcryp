/**
 * Interactive Lessons — "Learning by Doing" quizzes.
 * Each lesson is one question with four options.
 *
 * VISUAL PASS: the correct answer pops and turns mint, a wrong one shakes and
 * turns rose — the body learns from the motion before the explanation is read.
 * Completed lessons carry a tick inside their chip, so the strip doubles as a
 * progress list.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { LAB_EASE, LabBack, LabChips, Meter, Notice, Panel, ResultCard, Row } from './Shared';
import { LabIcon } from './LabIcons';
import { LESSONS } from '../../lib/lab/scenarios';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

/* Same idea as the scenario table: ids → registry names, data file untouched. */
const LESSON_ICON = {
  'lesson-01': 'book',
  'lesson-02': 'shield',
  'lesson-03': 'trend',
  'lesson-04': 'flame',
  'lesson-05': 'droplet',
  'lesson-06': 'pie',
  'lesson-07': 'alert',
  'lesson-08': 'scale'
};

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
  const doneCount = lessonState.completed.length;

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

  const lessonChips = LESSONS.map((l) => ({
    id: l.id,
    label: t(`lab2.lessons.${l.id}.title`),
    icon: LESSON_ICON[l.id] ?? 'book',
    tick: lessonState.completed.includes(l.id)
  }));

  const correct = selected === active.correct;

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        icon="brain"
        accent="amber"
        title={t('lab2.screens.lessons.title')}
        sub={t('lab2.screens.lessons.sub')}
      />

      <Panel title={t('lab2.lesson.progress')} icon="trophy" accent="amber">
        <Row
          label={t('lab2.level.lessonsCompleted')}
          value={<span className="lab2-num">{doneCount} / {LESSONS.length}</span>}
        />
        <Meter value={(doneCount / LESSONS.length) * 100} accent="amber" />
        <Row label={t('lab2.lesson.totalXp')} value={<span className="lab2-num">{xp.toLocaleString()}</span>} />
      </Panel>

      <Panel title={t('lab2.lesson.pick')} icon="layers" accent="violet">
        <LabChips
          items={lessonChips}
          value={activeId}
          layoutId="lesson-pick"
          accent="violet"
          onChange={(id) => { setActiveId(id); setSelected(null); setRevealed(false); }}
        />
      </Panel>

      <Panel
        title={t(`lab2.lessons.${active.id}.title`)}
        icon={LESSON_ICON[active.id] ?? 'book'}
        accent="cyan"
      >
        <div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 600, lineHeight: 1.7 }}>
          {question}
        </div>
        <div className="lab2-stack">
          {(Array.isArray(options) ? options : []).map((opt, idx) => {
            const isCorrect = idx === active.correct;
            const isPicked = selected === idx;
            let cls = 'lab2-quiz-option';
            if (revealed) {
              if (isCorrect) cls += ' correct';
              else if (isPicked) cls += ' wrong';
            }
            return (
              <motion.button
                key={idx}
                type="button"
                className={cls}
                onClick={() => handle(idx)}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.32, ease: LAB_EASE, delay: idx * 0.05 }}
              >
                <span className="lab2-quiz-letter">
                  {revealed && (isCorrect || isPicked) ? (
                    <LabIcon name={isCorrect ? 'check' : 'close'} width={13} height={13} />
                  ) : (
                    String.fromCharCode(65 + idx)
                  )}
                </span>
                <span>{opt}</span>
              </motion.button>
            );
          })}
        </div>
      </Panel>

      <AnimatePresence mode="wait">
        {revealed && (
          <motion.div
            key={`lesson-result-${active.id}-${selected}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.36, ease: LAB_EASE }}
          >
            <ResultCard
              kind={correct ? 'win' : 'loss'}
              icon={correct ? 'checkCircle' : 'xCircle'}
              figure={<span className="lab2-num">{t('lab2.lesson.score', { score: correct ? 100 : 25 })}</span>}
              title={correct ? t('lab2.lesson.correct') : t('lab2.lesson.notQuite')}
              sub={explanation}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                className="lab2-btn ghost full"
                type="button"
                onClick={() => { setSelected(null); setRevealed(false); }}
              >
                <LabIcon name="refresh" width={15} height={15} />
                {t('lab2.tryAgain')}
              </button>
              <button className="lab2-btn primary full" type="button" onClick={next}>
                {t('lab2.nextLesson')}
                <span className="lab2-arrow">
                  <LabIcon name="next" width={15} height={15} />
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isDone && (
        <Notice variant="success" icon="trophy">
          {t('lab2.lesson.alreadyDone', { score: bestScore })}
        </Notice>
      )}
    </div>
  );
}
