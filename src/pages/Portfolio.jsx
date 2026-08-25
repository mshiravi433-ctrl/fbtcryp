import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import { IconChevronLeft } from '../components/Icons';
import { useWallet } from '../context/WalletContext';
import { useWalletBalances } from '../hooks/useWalletBalances';
import { useMultiChainPortfolio } from '../hooks/useMultiChainPortfolio';
import { buildIntelligence, taxCsv } from '../lib/portfolioIntel';
import { goalProgress, requiredMonthlyContribution } from '../lib/goalMath';
import { fmtPct, fmtUsd } from '../lib/format';
import { useHideBalances } from '../hooks/useHideBalances';
import { EVM_CHAIN_ORDER } from '../lib/chains';
import { loadOrders } from '../lib/orders';
import { loadDcaReceipts, verifiedGoalExecution, dcaDisplayStatus } from '../lib/dcaExecution';
import { loadGoal, saveGoal } from '../lib/goalStore';

/**
 * Wealth Hub (formerly Portfolio Intelligence).
 *
 * Extends the existing P&L / allocation / risk dashboard with two honest
 * features from the P0 plan:
 *
 *   1. Multi-chain source for EVM wallets. When the connected wallet
 *      exposes a read provider, holdings are aggregated across every
 *      supported EVM chain (the same hook the Wallet screen uses). When
 *      not — a Solana wallet, an unconnected state, an injected provider
 *      that does not implement getReadProvider — we fall back to the
 *      single-chain hook and the screen still works.
 *
 *   2. A coverage badge that says out loud how much of what is on screen
 *      is actually verified. "8 of 9 chains read, 23 of 41 priced" is the
 *      honest shape. The bar can never claim a total that the
 *      underneath numbers do not support.
 *
 *   3. A Goal Card that reads progress strictly from the live total. The
 *      math lives in lib/goalMath (pure, unit-tested); the card asks
 *      once and never re-projects from forecasts.
 *
 * What it still does NOT do (and will not until those modules are real):
 *   - no on-chain Solana / dYdX / Ostium balance reads (the multi-chain
 *     hook is EVM only — see useMultiChainPortfolio.js);
 *   - no draft intent for an automatic DCA from the goal card (that
 *     wires up in a later slice; the card surfaces the math only).
 */

const GOAL_STORAGE_KEY = 'fbt-wealth-goal-v1';

function readGoalFromStorage() { return loadGoal(); }

function writeGoalToStorage(goal) { saveGoal(goal); }

export default function Portfolio({ embedded = false, onBack }) {
  useHideBalances();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wallet = useWallet();

  /*
   * The hook selector.
   *
   * useMultiChainPortfolio aggregates every EVM chain in one call, but it
   * needs a function that returns a read provider for a chainId. Only an
   * EVM-style wallet exposes that (it is the wallet's own multi-chain
   * provider switcher). For everything else we keep the single-chain
   * behaviour the screen always had, so the page still renders for
   * non-EVM wallets and for the unconnected state.
   */
  const useMulti = Boolean(wallet?.address && typeof wallet.getReadProvider === 'function');
  const single = useWalletBalances(useMulti ? null : wallet);
  const multi = useMultiChainPortfolio(useMulti ? wallet : null);

  const source = useMulti ? multi : single;
  const rows = source.rows ?? [];
  const total = source.total ?? 0;

  const intel = useMemo(
    () => buildIntelligence({
      holdings: rows.map((r) => ({ ...r, chainId: r.chainId ?? wallet.chainId ?? null }))
    }),
    [rows, wallet.chainId]
  );

  const [expand, setExpand] = useState(false);
  const [goal, setGoal] = useState(() => readGoalFromStorage());
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalDraft, setGoalDraft] = useState({ targetUsd: '', deadlineDays: 365, annualYieldPct: 0 });

  useEffect(() => { writeGoalToStorage(goal); }, [goal]);

  const ch24 = intel.change24h;
  const ch7 = intel.change7d;
  const goBack = () => (onBack ? onBack() : navigate(-1));

  const downloadTax = () => {
    const csv = taxCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'fbt-tax-lots.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  /*
   * Coverage numbers. The badge says "X of Y read, M of N priced" only
   * when the multi-chain hook is the source — for the single-chain case
   * the page already says "partial" through intel.partial, so the badge
   * is suppressed to avoid two overlapping honesty signals.
   */
  const coverage = useMemo(() => {
    if (!useMulti) return null;
    const totalChains = EVM_CHAIN_ORDER.length;
    const readChains = (source.chains ?? []).filter((c) => !c.error).length;
    const pricedRows = (source.rows ?? []).filter((r) => r.value != null).length;
    const totalRows = (source.rows ?? []).length;
    return { readChains, totalChains, pricedRows, totalRows };
  }, [useMulti, source]);

  const goalExecution = useMemo(() => goal ? verifiedGoalExecution({ goalId: goal.id, orders: loadOrders(), receipts: loadDcaReceipts() }) : null, [goal]);
  const linkedDcas = useMemo(() => goal ? loadOrders().filter((o) => o.type === 'dca' && o.goalId === goal.id) : [], [goal]);
  // Goal progress is execution evidence only. Wallet holdings can include funds
  // unrelated to this goal, and a planned DCA is not a completed purchase.
  const progress = goal && goalExecution?.hasVerifiedExecution
    ? goalProgress({ targetUsd: goal.targetUsd, currentUsd: goalExecution.totalUsd }) : null;
  const requiredPmt = goal && goalExecution?.hasVerifiedExecution
    ? requiredMonthlyContribution({
        targetUsd: goal.targetUsd,
        currentUsd: goalExecution.totalUsd,
        deadlineMs: goal.deadlineMs,
        annualYield: goal.annualYield
      })
    : null;
  const goalMissed = goal && goal.deadlineMs <= Date.now();

  const submitGoalDraft = () => {
    const tNum = Number(goalDraft.targetUsd);
    const days = Number(goalDraft.deadlineDays);
    const yPct = Number(goalDraft.annualYieldPct);
    if (!Number.isFinite(tNum) || tNum <= 0) return;
    if (!Number.isFinite(days) || days <= 0) return;
    const y = Number.isFinite(yPct) ? Math.max(0, Math.min(1, yPct / 100)) : 0;
    setGoal({
      id: goal?.id || `g_${Date.now().toString(36)}`,
      createdAt: goal?.createdAt || Date.now(),
      targetUsd: tNum,
      deadlineMs: Date.now() + days * 86400000,
      annualYield: y
    });
    setGoalEditing(false);
  };

  const content = (
    <>
      {!embedded && (
        <motion.div className="row" style={{ gap: 10 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={goBack} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <h1 className="h1" style={{ fontSize: 19 }}>{t('wealth.title')}</h1>
        </motion.div>
      )}

      {/* ── COVERAGE BADGE ────────────────────────────────────── */}
      {coverage && (coverage.readChains < coverage.totalChains || coverage.pricedRows < coverage.totalRows) && (
        <motion.div
          variants={riseIn}
          initial="hidden"
          animate="show"
          style={{
            marginTop: embedded ? 0 : 10,
            padding: '8px 12px',
            borderRadius: 12,
            background: 'rgba(255, 200, 80, 0.08)',
            border: '1px solid rgba(255, 200, 80, 0.25)',
            fontSize: 11.5
          }}
        >
          <span style={{ fontWeight: 700 }}>{t('wealth.coverage.partial')}</span>
          <span className="faint" style={{ marginInlineStart: 8 }}>
            {t('wealth.coverage.reads', { read: coverage.readChains, total: coverage.totalChains })}
            {' · '}
            {t('wealth.coverage.priced', { priced: coverage.pricedRows, total: coverage.totalRows })}
          </span>
        </motion.div>
      )}

      {/* ── HERO ─────────────────────────────────────────────── */}
      <motion.section
        className="wallet-hero-modern"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{
          marginTop: embedded ? 0 : 12,
          padding: 22,
          borderRadius: 22,
          background: 'linear-gradient(135deg, rgba(0,229,255,0.22), rgba(124,77,255,0.18) 60%, rgba(0,255,157,0.15))',
          border: '1px solid rgba(255,255,255,0.08)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div className="wallet-hero-aurora" aria-hidden="true" />
        <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.7, position: 'relative' }}>
          {t('wealth.netWorth')}
        </div>
        <div className="wallet-total-modern" style={{ marginTop: 4, fontSize: 34, position: 'relative' }}>
          {fmtUsd(intel.total)}
        </div>
        <div className="row" style={{ gap: 10, marginTop: 14, position: 'relative' }}>
          <span className={`pill ${ch24 && ch24.abs >= 0 ? 'pill-up' : 'pill-down'}`} style={{ fontSize: 11, padding: '6px 10px' }}>
            24H {ch24 ? `${ch24.abs >= 0 ? '+' : ''}${fmtUsd(ch24.abs)}` : '—'}
          </span>
          <span className={`pill ${ch7 && ch7.abs >= 0 ? 'pill-up' : 'pill-down'}`} style={{ fontSize: 11, padding: '6px 10px' }}>
            7D {ch7 ? (ch7.from ? fmtPct((ch7.abs / ch7.from) * 100) : fmtUsd(ch7.abs)) : '—'}
          </span>
        </div>
      </motion.section>

      {/* ── BENTO STATS ──────────────────────────────────────── */}
      <motion.div
        className="wallet-bento"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ marginTop: 14, gridTemplateColumns: '1fr 1fr' }}
      >
        {[
          { k: t('intel.pnl'), v: intel.pnl ? fmtUsd(intel.pnl) : '—', hue: '#00e5ff' },
          { k: t('intel.cost'), v: intel.cost ? fmtUsd(intel.cost) : '—', hue: '#7c4dff' },
          { k: t('intel.risk'), v: `${intel.riskScore} · ${t(`intel.band.${intel.riskBand}`)}`, hue: '#ff2d95' },
          { k: t('intel.stables'), v: `${intel.stablePct.toFixed(0)}%`, hue: '#00ff9d' }
        ].map((c) => (
          <div
            key={c.k}
            className="wallet-pie-card"
            style={{
              padding: 14,
              borderRadius: 16,
              textAlign: 'center',
              borderColor: `color-mix(in srgb, ${c.hue} 20%, transparent)`,
              background: `linear-gradient(145deg, color-mix(in srgb, ${c.hue} 10%, rgba(255,255,255,0.04)), rgba(255,255,255,0.02))`
            }}
          >
            <div className="faint" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5 }}>{c.k}</div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 900, marginTop: 6, color: c.hue }}>{c.v}</div>
          </div>
        ))}
      </motion.div>

      {/* ── GOAL CARD ────────────────────────────────────────── */}
      <motion.section
        className="wallet-pie-card"
        variants={riseIn}
        initial="hidden"
        animate="show"
        style={{ marginTop: 14, padding: 16, borderRadius: 18 }}
      >
        <div className="row-between" style={{ marginBottom: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 13 }}>{t('wealth.goal.title')}</span>
          {!goal && !goalEditing && (
            <button
              type="button"
              className="row"
              onClick={() => {
                setGoalDraft({ targetUsd: '', deadlineDays: 365, annualYieldPct: 0 });
                setGoalEditing(true);
              }}
              style={{
                background: 'rgba(0,229,255,0.12)',
                border: '1px solid rgba(0,229,255,0.4)',
                borderRadius: 10,
                padding: '6px 12px',
                minHeight: 36,
                fontSize: 12,
                fontWeight: 700,
                color: '#00e5ff'
              }}
            >
              {t('wealth.goal.set')}
            </button>
          )}
          {goal && !goalEditing && (
            <button
              type="button"
              onClick={() => {
                const days = Math.max(1, Math.round((goal.deadlineMs - Date.now()) / 86400000));
                setGoalDraft({
                  targetUsd: String(goal.targetUsd),
                  deadlineDays: days,
                  annualYieldPct: Math.round(goal.annualYield * 100)
                });
                setGoalEditing(true);
              }}
              className="faint"
              style={{ background: 'transparent', border: 0, fontSize: 11, padding: 4, minHeight: 32 }}
            >
              {t('wealth.goal.edit')}
            </button>
          )}
        </div>

        {!goal && !goalEditing && (
          <p className="faint" style={{ fontSize: 12, lineHeight: 1.55 }}>
            {t('wealth.goal.empty')}
          </p>
        )}

        {goalEditing && (
          <div style={{ display: 'grid', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="faint" style={{ fontSize: 11, fontWeight: 700 }}>
                {t('wealth.goal.targetLabel')}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={goalDraft.targetUsd}
                onChange={(e) => setGoalDraft((d) => ({ ...d, targetUsd: e.target.value }))}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  minHeight: 44,
                  fontSize: 14,
                  color: 'inherit',
                  width: '100%'
                }}
                placeholder="10000"
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="faint" style={{ fontSize: 11, fontWeight: 700 }}>
                {t('wealth.goal.deadlineLabel')}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={goalDraft.deadlineDays}
                onChange={(e) => setGoalDraft((d) => ({ ...d, deadlineDays: e.target.value }))}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  minHeight: 44,
                  fontSize: 14,
                  color: 'inherit',
                  width: '100%'
                }}
                placeholder="365"
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="faint" style={{ fontSize: 11, fontWeight: 700 }}>
                {t('wealth.goal.yieldLabel')}
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.1"
                value={goalDraft.annualYieldPct}
                onChange={(e) => setGoalDraft((d) => ({ ...d, annualYieldPct: e.target.value }))}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  minHeight: 44,
                  fontSize: 14,
                  color: 'inherit',
                  width: '100%'
                }}
                placeholder="0"
              />
            </label>
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={submitGoalDraft}
                className="btn btn-primary"
                style={{ flex: 1, minHeight: 44, borderRadius: 12 }}
              >
                {t('wealth.goal.save')}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (loadOrders().some((o) => o.type === 'dca' && o.goalId === goal?.id && o.status === 'active') && !window.confirm(t('wealth.goal.removeWarning'))) return;
                  setGoal(null);
                  setGoalEditing(false);
                }}
                className="btn"
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid var(--line)'
                }}
              >
                {t('wealth.goal.remove')}
              </button>
            </div>
          </div>
        )}

        {goal && !goalEditing && (
          <div className="notice" style={{ marginTop: 10, fontSize: 12, lineHeight: 1.55 }}>
            {linkedDcas.length === 0 ? (
              <><span>{t('wealth.goal.noVerifiedExecution')}</span> <button type="button" className="wal-link-btn" onClick={() => navigate('/orders')}>{t('wealth.goal.ordersLink')}</button></>
            ) : linkedDcas.some((o) => o.status === 'paused') ? (
              <><span>{t('wealth.goal.awaitingConfirmation')}</span> <button type="button" className="wal-link-btn" onClick={() => navigate('/orders')}>{t('wealth.goal.ordersLink')}</button></>
            ) : linkedDcas.some((o) => o.status === 'active') && !goalExecution?.hasVerifiedExecution ? (
              t('wealth.goal.activeNoExecution')
            ) : goalExecution?.hasVerifiedExecution ? (
              t('wealth.goal.verifiedExecution', { amount: fmtUsd(goalExecution.totalUsd) })
            ) : t('wealth.goal.noVerifiedExecution')}
            {linkedDcas.map((o) => ['failed', 'rejected', 'partial'].includes(dcaDisplayStatus(o, loadDcaReceipts())) && (
              <p key={o.id} style={{ margin: '6px 0 0' }}>{t(`wealth.goal.execution.${dcaDisplayStatus(o, loadDcaReceipts())}`)}</p>
            ))}
          </div>
        )}

        {goal && !goalEditing && progress && (
          <div>
            {goalMissed ? (
              <p className="faint" style={{ fontSize: 12, lineHeight: 1.55 }}>
                {t('wealth.goal.missed')}
              </p>
            ) : (
              <>
                <div className="row-between" style={{ marginBottom: 6 }}>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {t('wealth.goal.progressLabel', { pct: Math.round(progress.progress * 100) })}
                  </span>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700 }}>
                    {fmtUsd(goalExecution.totalUsd)} / {fmtUsd(goal.targetUsd)}
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, Math.round(progress.progress * 100))}%` }}
                    transition={{ type: 'spring', stiffness: 110, damping: 20 }}
                    style={{
                      height: '100%',
                      borderRadius: 999,
                      background: 'linear-gradient(90deg, #00e5ff, #7c4dff)'
                    }}
                  />
                </div>
                {progress.reached ? (
                  <p className="faint" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.55 }}>
                    {t('wealth.goal.reached')}
                  </p>
                ) : requiredPmt == null ? (
                  <p className="faint" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.55 }}>
                    {t('wealth.goal.noSchedule')}
                  </p>
                ) : requiredPmt === 0 ? (
                  <p className="faint" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.55 }}>
                    {t('wealth.goal.funded')}
                  </p>
                ) : (
                  <p className="faint" style={{ fontSize: 12, marginTop: 10, lineHeight: 1.55 }}>
                    {t('wealth.goal.requiredMonthly', { amount: fmtUsd(requiredPmt) })}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </motion.section>

      {/* ── BEST/WORST/WHALE ─────────────────────────────────── */}
      {intel.best && (
        <motion.section
          className="wallet-pie-card"
          variants={riseIn}
          initial="hidden"
          animate="show"
          style={{ marginTop: 14, padding: 14, borderRadius: 18 }}
        >
          <div className="row-between" style={{ padding: '6px 4px' }}>
            <span className="faint" style={{ fontSize: 11.5 }}>{t('intel.best')}</span>
            <span className="mono up" style={{ fontWeight: 800 }}>{intel.best.symbol} {fmtPct(intel.best.pnlPct)}</span>
          </div>
          {intel.worst && intel.worst !== intel.best && (
            <div className="row-between" style={{ padding: '6px 4px', borderTop: '1px solid var(--line)' }}>
              <span className="faint" style={{ fontSize: 11.5 }}>{t('intel.worst')}</span>
              <span className="mono down" style={{ fontWeight: 800 }}>{intel.worst.symbol} {fmtPct(intel.worst.pnlPct)}</span>
            </div>
          )}
          <div className="row-between" style={{ padding: '6px 4px', borderTop: '1px solid var(--line)' }}>
            <span className="faint" style={{ fontSize: 11.5 }}>{t('intel.whale')}</span>
            <span className="mono" style={{ fontWeight: 800 }}>{intel.topShare.toFixed(0)}%</span>
          </div>
        </motion.section>
      )}

      {/* ── ALLOCATION (collapsible bars) ───────────────────── */}
      <section style={{ marginTop: 14 }}>
        <button
          type="button"
          onClick={() => setExpand((v) => !v)}
          className="row-between card"
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 16,
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line)', textAlign: 'start'
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 13 }}>{t('intel.allocation')}</span>
          <span className="faint" style={{ fontSize: 11 }}>
            {intel.rows.length} {expand ? '▾' : '▸'}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {expand && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={{ overflow: 'hidden' }}
            >
              <div className="wallet-pie-card" style={{ marginTop: 8, padding: 14, borderRadius: 18 }}>
                {intel.rows.length === 0 ? (
                  <p className="faint">{t('intel.empty')}</p>
                ) : (
                  intel.rows.map((r, i) => (
                    <div key={r.symbol} style={{ marginBottom: i === intel.rows.length - 1 ? 0 : 10 }}>
                      <div className="row-between" style={{ marginBottom: 4 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700 }}>
                          {r.symbol}
                          <span className="faint" style={{ marginInlineStart: 8, fontWeight: 500, fontSize: 11 }}>
                            {r.weight.toFixed(1)}%
                          </span>
                        </span>
                        <span className="mono" style={{ fontSize: 12 }}>
                          {fmtUsd(r.value)}
                          {r.pnlPct != null && (
                            <span className={r.pnlPct >= 0 ? 'up' : 'down'} style={{ marginInlineStart: 8 }}>
                              {fmtPct(r.pnlPct, 1)}
                            </span>
                          )}
                        </span>
                      </div>
                      <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, r.weight)}%` }}
                          transition={{ type: 'spring', stiffness: 110, damping: 20, delay: i * 0.03 }}
                          style={{
                            height: '100%', borderRadius: 999,
                            background: `linear-gradient(90deg, hsl(${(i * 52) % 360} 90% 60%), hsl(${(i * 52 + 40) % 360} 85% 55%))`
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {intel.partial && <p className="notice" style={{ marginTop: 12 }}>{t('intel.partial')}</p>}

      <button
        className="btn btn-primary"
        style={{ marginTop: 16, width: '100%', minHeight: 46, borderRadius: 14 }}
        onClick={downloadTax}
      >
        {t('intel.taxExport')} ↓
      </button>

      <InfoBox title={t('intel.taxTitle')} tone="warn" id="intel-tax">
        <p>{t('intel.taxBody')}</p>
      </InfoBox>
    </>
  );

  if (embedded) return <div>{content}</div>;
  return <PageTransition>{content}</PageTransition>;
}
