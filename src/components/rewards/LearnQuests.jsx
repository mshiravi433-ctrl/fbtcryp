import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { useTelegram } from '../../context/TelegramContext';
import { LEARN_POINT_VALUE } from '../../lib/rewards/economy';
import { LEARN_TOPICS, learnDone } from '../../lib/rewards/learnQuests';
import { IconCheck, IconChevronRight, IconSparkle } from '../Icons';

/**
 * Deterministic 4-option order. Seeded by the question id so React re-renders
 * do not reshuffle under the user's finger, but the correct answer is not
 * always option A.
 */
function optionOrder(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i -= 1) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * LEARN-TO-EARN — four short lessons on assets this app actually lists.
 *
 * A topic pays LEARN_POINT_VALUE exactly once, after every answer is correct.
 * The credit goes through `awardPointsOnce('learn:<topic>')`, which maps to the
 * server's canonical `learn` action; a retry cannot mint twice. Wrong answers
 * cost nothing and never lock the topic.
 */
export default function LearnQuests() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const pointsLog = useAppStore((s) => s.pointsLog);
  const awardPointsOnce = useAppStore((s) => s.awardPointsOnce);

  const [openId, setOpenId] = useState(null);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState(null);
  const [wrong, setWrong] = useState(false);
  const [justPaid, setJustPaid] = useState(null);

  const doneMap = useMemo(() => {
    const map = {};
    for (const topic of LEARN_TOPICS) map[topic.id] = learnDone(pointsLog, topic.id);
    return map;
  }, [pointsLog]);

  const doneCount = Object.values(doneMap).filter(Boolean).length;

  useEffect(() => {
    if (!wrong) return undefined;
    const id = setTimeout(() => { setWrong(false); setPicked(null); }, 1400);
    return () => clearTimeout(id);
  }, [wrong]);

  const open = (topic) => {
    haptic?.('light');
    setOpenId(topic.id);
    setStep(0);
    setPicked(null);
    setWrong(false);
    setJustPaid(null);
  };

  const close = () => { setOpenId(null); setStep(0); setPicked(null); setWrong(false); };

  const choose = (topic, question, index) => {
    if (picked != null || wrong) return;
    setPicked(index);
    if (index !== question.correct) {
      setWrong(true);
      haptic?.('error');
      return;
    }
    haptic?.('select');
    const last = step === topic.questions.length - 1;
    setTimeout(() => {
      if (!last) {
        setStep((s) => s + 1);
        setPicked(null);
        return;
      }
      const paid = awardPointsOnce(
        `learn:${topic.id}`,
        LEARN_POINT_VALUE,
        { rewardId: `learn-${topic.id}`, topic: topic.id }
      );
      if (paid) {
        useAppStore.getState().notify('pointsEarned', 'success');
        setJustPaid(topic.id);
        haptic?.('success');
      }
      setPicked(null);
      setStep(topic.questions.length);
    }, 650);
  };

  const active = LEARN_TOPICS.find((topic) => topic.id === openId) || null;
  const question = active ? active.questions[step] : null;
  const order = useMemo(
    () => optionOrder(active && question ? `${active.id}:${question.id}` : 'none'),
    [active, question]
  );

  return (
    <section className="rwd-card rwd-learn-card" id="rwd-learn">
      <header className="rwd-sec-head">
        <div>
          <div className="rwd-kicker">{t('rewards.v2.learn.kicker')}</div>
          <h3 className="rwd-sec-title">
            <IconSparkle width={17} height={17} style={{ color: 'var(--rgb-5)' }} />
            {t('rewards.v2.learn.title')}
          </h3>
        </div>
        <span className="rwd-chip">{t('rewards.v2.learn.progressChip', { n: doneCount, total: LEARN_TOPICS.length })}</span>
      </header>

      <p className="rwd-prose">{t('rewards.v2.learn.sub')}</p>

      <div className="rwd-learn-grid">
        {LEARN_TOPICS.map((topic) => {
          const done = doneMap[topic.id];
          const isOpen = openId === topic.id;
          return (
            <button
              key={topic.id}
              type="button"
              className={`rwd-learn-topic${done ? ' done' : ''}${isOpen ? ' open' : ''}`}
              style={{ '--topic': topic.color }}
              onClick={() => open(topic)}
            >
              <span className="rwd-learn-symbol" aria-hidden="true">{topic.symbol.slice(0, 1)}</span>
              <span className="rwd-learn-meta">
                <span className="rwd-learn-name">{t(`rewards.v2.learn.${topic.id}.title`)}</span>
                <span className="rwd-learn-desc">{t(`rewards.v2.learn.${topic.id}.desc`)}</span>
              </span>
              <span className={`rwd-learn-state${done ? ' up' : ''}`}>
                {done ? <IconCheck width={14} height={14} /> : <IconChevronRight width={14} height={14} />}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {active && (
          <motion.div
            className="rwd-quiz"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <div className="rwd-quiz-head">
              <div>
                <div className="rwd-kicker">{t('rewards.v2.learn.quizKicker')}</div>
                <div className="rwd-quiz-title">{t(`rewards.v2.learn.${active.id}.title`)}</div>
              </div>
              <span className="rwd-pill">
                +{LEARN_POINT_VALUE} {t('rank.pts')}
              </span>
            </div>

            {step < active.questions.length ? (
              <>
                <div className="rwd-quiz-progress">
                  <span>{t('rewards.v2.learn.question', { n: step + 1, total: active.questions.length })}</span>
                  <span className="rwd-quiz-dots">
                    {active.questions.map((_, index) => (
                      <i key={index} className={index < step ? 'done' : index === step ? 'active' : ''} />
                    ))}
                  </span>
                </div>
                <div className="rwd-quiz-q">
                  {t(`rewards.v2.learn.${active.id}.${question.id}.q`)}
                </div>
                <div className="rwd-quiz-answers">
                  {order.map((answerIndex, displayIndex) => {
                    const isPicked = picked === answerIndex;
                    const isRight = answerIndex === question.correct;
                    const cls = wrong && isPicked
                      ? 'wrong'
                      : isPicked && isRight
                        ? 'right'
                        : '';
                    return (
                      <button
                        key={answerIndex}
                        type="button"
                        className={`rwd-quiz-answer ${cls}`}
                        onClick={() => choose(active, question, answerIndex)}
                        disabled={picked != null}
                      >
                        <span className="rwd-quiz-letter">{String.fromCharCode(65 + displayIndex)}</span>
                        <span>{t(`rewards.v2.learn.${active.id}.${question.id}.a${answerIndex + 1}`)}</span>
                      </button>
                    );
                  })}
                </div>
                {wrong && <p className="rwd-quiz-hint">{t('rewards.v2.learn.wrong')}</p>}
              </>
            ) : (
              <div className="rwd-quiz-done">
                <span className="rwd-quiz-done-ico" aria-hidden="true">◈</span>
                <div>
                  <div className="rwd-quiz-done-title">
                    {doneMap[active.id]
                      ? t('rewards.v2.learn.doneTitle')
                      : t('rewards.v2.learn.earnedTitle', { n: LEARN_POINT_VALUE })}
                  </div>
                  <p className="rwd-prose">{t('rewards.v2.learn.doneSub')}</p>
                </div>
              </div>
            )}

            <div className="rwd-quiz-foot">
              {justPaid === active.id && (
                <span className="rwd-pill up">+{LEARN_POINT_VALUE} {t('rank.pts')}</span>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(active.route)}>
                {t('rewards.v2.learn.openAsset', { sym: active.symbol })}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
                {t('common.close')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="rwd-fine">{t('rewards.v2.learn.note')}</p>
    </section>
  );
}
