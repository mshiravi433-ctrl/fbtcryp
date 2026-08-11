import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AnimatedNumber from '../components/AnimatedNumber';
import Sheet from '../components/Sheet';
import { fmtNum, fmtPct } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import '../styles/lab-modern.css';

/**
 * Simulated yield products. APRs are fixed, deterministic and paid from the
 * virtual NX balance — there is no pooling of real user funds anywhere in this
 * codebase, and adding one would require an investment-services licence.
 */
export const PLANS = [
  { id: 'flex', emoji: '💧', apr: 6.5, days: 7, min: 100, risk: 'low', color: 'var(--rgb-1)' },
  { id: 'core', emoji: '🔷', apr: 14, days: 30, min: 500, risk: 'low', color: 'var(--rgb-2)' },
  { id: 'growth', emoji: '🚀', apr: 28, days: 90, min: 1000, risk: 'medium', color: 'var(--rgb-3)' },
  { id: 'alpha', emoji: '⚡', apr: 52, days: 180, min: 2500, risk: 'high', color: 'var(--rgb-5)' }
];

function progressOf(inv) {
  const total = inv.days * 86400000;
  return Math.min(100, ((Date.now() - inv.startedAt) / total) * 100);
}

export default function Invest({ embedded = false }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();

  const balance = useAppStore((s) => s.balance);
  const investments = useAppStore((s) => s.investments);
  const openInvestment = useAppStore((s) => s.openInvestment);
  const claimInvestment = useAppStore((s) => s.claimInvestment);

  const [plan, setPlan] = useState(null);
  const [amount, setAmount] = useState('');

  const active = investments.filter((i) => !i.claimedAt);
  const closed = investments.filter((i) => i.claimedAt);

  const totals = useMemo(() => {
    const staked = active.reduce((s, i) => s + i.amount, 0);
    const projected = active.reduce((s, i) => s + i.amount * (i.apr / 100) * (i.days / 365), 0);
    const earned = closed.reduce((s, i) => s + Math.max(0, (i.payout ?? 0) - i.amount), 0);
    return { staked, projected, earned };
  }, [active, closed]);

  const amt = Number(amount) || 0;
  const projectedYield = plan ? amt * (plan.apr / 100) * (plan.days / 365) : 0;
  const canOpen = plan && amt >= plan.min && amt <= balance;

  const confirm = () => {
    if (!canOpen) return;
    const ok = openInvestment({ planId: plan.id, amount: amt, apr: plan.apr, days: plan.days });
    if (ok) {
      haptic?.('success');
      setPlan(null);
      setAmount('');
    }
  };

  return (
    <PageTransition embedded={embedded}>
      {!embedded && (
        <motion.div variants={riseIn} initial="hidden" animate="show">
          <h1 className="h1">{t('invest.title')}</h1>
          <p className="muted">{t('invest.subtitle')}</p>
        </motion.div>
      )}

      <div className="lab-modern" style={{ marginTop: embedded ? 2 : 8 }}>
        <p className="notice">{t('invest.simNotice')}</p>

        {/* ---------- summary hero ---------- */}
        <motion.section className="lab-hero" variants={riseIn} initial="hidden" animate="show" style={{ padding: 18 }}>
          <div className="lab-aurora" aria-hidden="true" />
          <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, position: 'relative' }}>
            {t('invest.totalStaked')}
          </div>
          <div className="lab-hero-price" style={{ position: 'relative' }}>
            <AnimatedNumber value={totals.staked} format={(v) => `${fmtNum(v, 2)} NX`} />
          </div>
          <div className="grid-2" style={{ marginTop: 16, position: 'relative', gap: 10 }}>
            <div className="lab-stat">
              <div className="faint" style={{ fontSize: 10.5 }}>{t('invest.projectedYield')}</div>
              <div className="mono up" style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>
                +{fmtNum(totals.projected, 2)} NX
              </div>
            </div>
            <div className="lab-stat">
              <div className="faint" style={{ fontSize: 10.5 }}>{t('invest.lifetimeEarned')}</div>
              <div className="mono" style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>
                {fmtNum(totals.earned, 2)} NX
              </div>
            </div>
          </div>
        </motion.section>

        {/* ---------- plans ---------- */}
        <section>
          <p className="section-label">{t('invest.plans')}</p>
          <motion.div className="stack" style={{ gap: 10, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
            {PLANS.map((p) => (
              <motion.button
                key={p.id}
                className="lab-plan"
                variants={riseIn}
                whileTap={{ scale: 0.985 }}
                onClick={() => {
                  haptic?.('light');
                  setPlan(p);
                  setAmount(String(p.min));
                }}
                style={{ '--plan-glow': p.color }}
              >
                <div className="row-between">
                  <div className="row" style={{ gap: 11 }}>
                    <div
                      className="coin-logo"
                      style={{ background: `${p.color}22`, borderColor: p.color, fontSize: 18 }}
                    >
                      {p.emoji}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 14.5 }}>{t(`invest.plan.${p.id}.name`)}</div>
                      <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.5 }}>{t(`invest.plan.${p.id}.desc`)}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'end' }}>
                    <div className="lab-plan-apr" style={{ color: p.color }}>
                      {p.apr}%
                    </div>
                    <div className="faint" style={{ fontSize: 10 }}>APR</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 6, marginTop: 12 }}>
                  <span className="lab-chip">{t('invest.lockDays', { days: p.days })}</span>
                  <span className="lab-chip">{t('invest.min')}: {fmtNum(p.min)} NX</span>
                  <span className={`lab-chip ${p.risk === 'high' ? 'pill-down' : p.risk === 'medium' ? 'pill-rgb' : 'pill-up'}`}>
                    {t(`invest.risk.${p.risk}`)}
                  </span>
                </div>
              </motion.button>
            ))}
          </motion.div>
        </section>

        {/* ---------- active positions ---------- */}
        {active.length > 0 && (
          <section>
            <p className="section-label">{t('invest.active')}</p>
            <motion.div className="stack" style={{ gap: 10, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
              <AnimatePresence>
                {active.map((inv) => {
                  const pr = progressOf(inv);
                  const matured = pr >= 100;
                  const meta = PLANS.find((p) => p.id === inv.planId);
                  return (
                    <motion.div key={inv.id} className="lab-card" variants={riseIn} layout exit={{ opacity: 0, scale: 0.95 }} style={{ padding: 14 }}>
                      <div className="row-between">
                        <div className="row" style={{ gap: 9 }}>
                          <span style={{ fontSize: 19 }}>{meta?.emoji ?? '💠'}</span>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 13.5 }}>{t(`invest.plan.${inv.planId}.name`)}</div>
                            <div className="faint mono" style={{ fontSize: 11 }}>
                              {fmtNum(inv.amount, 2)} NX · {inv.apr}% · {inv.days}d
                            </div>
                          </div>
                        </div>
                        <span className={`pill ${matured ? 'pill-up' : 'pill-rgb'}`}>
                          {matured ? t('invest.matured') : `${pr.toFixed(1)}%`}
                        </span>
                      </div>

                      <div className="progress" style={{ marginTop: 11 }}>
                        <motion.div
                          className="progress-fill"
                          initial={{ width: 0 }}
                          animate={{ width: `${pr}%` }}
                          transition={{ duration: 0.9, ease: 'easeOut' }}
                          style={{ background: `linear-gradient(90deg, ${meta?.color ?? 'var(--rgb-1)'}, var(--rgb-1))` }}
                        />
                      </div>

                      <button
                        className={`btn ${matured ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ marginTop: 10, padding: 10, fontSize: 12.5, width: '100%' }}
                        onClick={() => {
                          haptic?.(matured ? 'success' : 'warning');
                          claimInvestment(inv.id);
                        }}
                      >
                        {matured ? t('invest.claim') : t('invest.earlyExit')}
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          </section>
        )}

        {/* ---------- open plan sheet ---------- */}
        <Sheet open={Boolean(plan)} onClose={() => setPlan(null)}>
          {plan && (
            <>
              <h2 className="h2" style={{ marginBottom: 4 }}>
                {plan.emoji} {t(`invest.plan.${plan.id}.name`)}
              </h2>
              <p className="muted" style={{ marginBottom: 12 }}>{t(`invest.plan.${plan.id}.desc`)}</p>

              <label className="field-label">{t('invest.amount')}</label>
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                min={plan.min}
                onChange={(e) => setAmount(e.target.value)}
              />

              <div className="row" style={{ gap: 6, marginTop: 9 }}>
                {[plan.min, plan.min * 2, plan.min * 5].map((v) => (
                  <button key={v} className="tag" style={{ flex: 1, textAlign: 'center' }} onClick={() => setAmount(String(v))}>
                    {fmtNum(v)}
                  </button>
                ))}
                <button className="tag" style={{ flex: 1, textAlign: 'center' }} onClick={() => setAmount(String(Math.floor(balance)))}>
                  MAX
                </button>
              </div>

              <div className="card card-tight stack" style={{ gap: 7, marginTop: 14 }}>
                <div className="row-between">
                  <span className="faint">APR</span>
                  <span className="mono up">{fmtPct(plan.apr, 1)}</span>
                </div>
                <div className="row-between">
                  <span className="faint">{t('invest.lockPeriod')}</span>
                  <span className="mono">{plan.days} {t('common.days')}</span>
                </div>
                <div className="row-between">
                  <span className="faint">{t('invest.estimatedReturn')}</span>
                  <span className="mono up">+{fmtNum(projectedYield, 2)} NX</span>
                </div>
                <div className="row-between">
                  <span className="faint">{t('invest.totalAtMaturity')}</span>
                  <span className="mono" style={{ fontWeight: 700 }}>{fmtNum(amt + projectedYield, 2)} NX</span>
                </div>
              </div>

              <p className="notice notice-danger" style={{ marginTop: 12 }}>{t('invest.earlyExitWarning')}</p>

              <button className="btn btn-primary" style={{ marginTop: 12, width: '100%' }} disabled={!canOpen} onClick={confirm}>
                {amt < plan.min
                  ? t('invest.minRequired', { min: fmtNum(plan.min) })
                  : amt > balance
                    ? t('toast.insufficientBalance')
                    : t('invest.confirmStake')}
              </button>
            </>
          )}
        </Sheet>

        {/* ---------- closed ---------- */}
        {closed.length > 0 && (
          <section>
            <p className="section-label">{t('invest.closed')}</p>
            <div className="lab-card" style={{ marginTop: 8, padding: '4px 14px' }}>
              {closed.slice(0, 6).map((inv) => (
                <div key={inv.id} className="row-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{t(`invest.plan.${inv.planId}.name`)}</span>
                  <span className="mono" style={{ fontSize: 11.5 }}>{fmtNum(inv.amount, 2)} NX</span>
                  <span className={`mono ${(inv.payout ?? 0) >= inv.amount ? 'up' : 'down'}`} style={{ fontSize: 11.5, fontWeight: 700 }}>
                    {(inv.payout ?? 0) >= inv.amount ? '+' : ''}
                    {fmtNum((inv.payout ?? 0) - inv.amount, 2)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </PageTransition>
  );
}
