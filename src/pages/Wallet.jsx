import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AnimatedNumber from '../components/AnimatedNumber';
import Sheet from '../components/Sheet';
import { usePriceMap } from '../hooks/useMarket';
import { fmtNum, fmtPct, fmtPrice, fmtQty, fmtDateTime } from '../lib/format';
import { useAppStore, valuePortfolio, START_BALANCE_CONST } from '../store/useAppStore';
import { shortAddress, useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import WalletConnectSheet from '../components/WalletConnectSheet';
import { revealMnemonic } from '../lib/localWallet';
import { explorerAddr } from '../lib/chains';

const SLICE_COLORS = ['#00e5ff', '#7c4dff', '#ff2d95', '#00ff9d', '#ffb300', '#4dd0e1', '#b388ff'];

export default function Wallet() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, haptic } = useTelegram();
  const wallet = useWallet();

  const { priceMap } = usePriceMap(60);
  const balance = useAppStore((s) => s.balance);
  const positions = useAppStore((s) => s.positions);
  const investments = useAppStore((s) => s.investments);
  const orders = useAppStore((s) => s.orders);
  const bets = useAppStore((s) => s.bets);
  const level = useAppStore((s) => s.level);
  const resetAccount = useAppStore((s) => s.resetAccount);

  const [confirmReset, setConfirmReset] = useState(false);
  const [tab, setTab] = useState('overview');
  const [connectOpen, setConnectOpen] = useState(false);
  const [seedSheet, setSeedSheet] = useState(false);
  const [seedPw, setSeedPw] = useState('');
  const [seedWords, setSeedWords] = useState(null);
  const [seedErr, setSeedErr] = useState(null);

  const portfolio = useMemo(() => valuePortfolio(positions, priceMap), [positions, priceMap]);
  const staked = investments.filter((i) => !i.claimedAt).reduce((s, i) => s + i.amount, 0);
  const netWorth = balance + portfolio.value + staked;
  const allTimePnl = netWorth - START_BALANCE_CONST;

  const pieData = useMemo(() => {
    const rows = [
      { name: t('wallet.cash'), value: balance },
      ...portfolio.rows.map((r) => ({ name: r.symbol, value: r.value })),
      ...(staked > 0 ? [{ name: t('wallet.staked'), value: staked }] : [])
    ].filter((r) => r.value > 0.01);
    return rows;
  }, [balance, portfolio.rows, staked, t]);

  const betStats = useMemo(() => {
    const done = bets.filter((b) => b.settled);
    const wins = done.filter((b) => b.won).length;
    return { total: done.length, wins, rate: done.length ? (wins / done.length) * 100 : 0 };
  }, [bets]);

  return (
    <PageTransition>
      <div className="segmented">
        {['overview', 'liquidity', 'history'].map((k) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} style={{ isolation: 'isolate' }}>
            {tab === k && <motion.span layoutId="wtab" className="seg-indicator" />}
            {t(`wallet.tab.${k}`)}
          </button>
        ))}
      </div>

      {/* ---------- profile ---------- */}
      <motion.section className="card card-rgb card-glow-magenta" variants={riseIn} initial="hidden" animate="show">
        <div className="sheen" />
        <div className="row-between">
          <div className="row" style={{ gap: 11 }}>
            <div
              className="coin-logo"
              style={{ width: 44, height: 44, fontSize: 18, background: 'linear-gradient(135deg,var(--rgb-2),var(--rgb-3))', color: '#fff' }}
            >
              {(user?.first_name ?? 'N')[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{user?.first_name ?? t('wallet.guest')}</div>
              <div className="faint">
                {user?.username ? `@${user.username}` : t('wallet.localSession')} · L{level}
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={() => setConfirmReset(true)}>⚙</button>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="faint">{t('wallet.netWorth')}</div>
          <div className="stat-value">
            <AnimatedNumber value={netWorth} format={(v) => `${fmtNum(v, 2)} NX`} />
          </div>
          <div className={`mono ${allTimePnl >= 0 ? 'up' : 'down'}`} style={{ fontSize: 12, marginTop: 3 }}>
            {allTimePnl >= 0 ? '+' : ''}{fmtNum(allTimePnl, 2)} ({fmtPct((allTimePnl / START_BALANCE_CONST) * 100)}) {t('wallet.allTime')}
          </div>
        </div>
      </motion.section>

      {tab === 'liquidity' && (
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 10 }}>{t('wallet.tab.liquidity')}</p>
          <p className="muted" style={{ fontSize: 12.3 }}>{t('wallet.liquidityBody')}</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/farm')}>
            {t('wallet.viewPools')}
          </button>
        </motion.section>
      )}

      {tab === 'history' && (
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 10 }}>{t('wallet.tab.history')}</p>
          {orders.length === 0 ? (
            <div className="empty">
              <span className="empty-icon">🗒</span>
              {t('wallet.noHistory')}
            </div>
          ) : (
            orders.slice(0, 20).map((o) => (
              <div key={o.id} className="row-between" style={{ padding: '9px 0', borderBottom: '1px solid var(--line)' }}>
                <span className={`pill ${o.side === 'buy' ? 'pill-up' : 'pill-down'}`}>{t(`trade.${o.side}`)}</span>
                <span className="mono" style={{ fontSize: 11.5 }}>{fmtQty(o.qty)} {o.symbol}</span>
                <span className="faint mono" style={{ fontSize: 10 }}>{fmtDateTime(o.at)}</span>
              </div>
            ))
          )}
          {wallet.address && (
            <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 11 }}
              onClick={() => window.open(explorerAddr(wallet.chainId, wallet.address), '_blank', 'noopener')}>
              {t('wallet.onchainHistory')}
            </button>
          )}
        </motion.section>
      )}

      {tab === 'overview' && <>
      {/* ---------- allocation ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 8 }}>{t('wallet.allocation')}</p>
        <div className="row" style={{ gap: 14 }}>
          <div style={{ width: 118, height: 118, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  innerRadius={34}
                  outerRadius={56}
                  paddingAngle={3}
                  stroke="none"
                  animationDuration={900}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="stack" style={{ gap: 6, flex: 1 }}>
            {pieData.slice(0, 5).map((d, i) => (
              <div key={d.name} className="row-between">
                <span className="row" style={{ gap: 7, fontSize: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 3, background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                  {d.name}
                </span>
                <span className="mono" style={{ fontSize: 11.5 }}>
                  {((d.value / (netWorth || 1)) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ---------- balances ---------- */}
      <motion.div className="grid-3" variants={stagger} initial="hidden" animate="show">
        <motion.div className="card card-tight" variants={riseIn}>
          <div className="faint">{t('wallet.cash')}</div>
          <div className="mono" style={{ fontSize: 13 }}>{fmtNum(balance, 0)}</div>
        </motion.div>
        <motion.div className="card card-tight" variants={riseIn}>
          <div className="faint">{t('wallet.positions')}</div>
          <div className="mono" style={{ fontSize: 13 }}>{fmtNum(portfolio.value, 0)}</div>
        </motion.div>
        <motion.div className="card card-tight" variants={riseIn}>
          <div className="faint">{t('wallet.staked')}</div>
          <div className="mono" style={{ fontSize: 13 }}>{fmtNum(staked, 0)}</div>
        </motion.div>
      </motion.div>

      {/* ---------- holdings ---------- */}
      <section>
        <p className="section-label">{t('wallet.holdings')}</p>
        {portfolio.rows.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">📭</span>
            {t('wallet.noHoldings')}
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/trade')}>{t('wallet.startTrading')}</button>
            </div>
          </div>
        ) : (
          <motion.div className="stack" style={{ gap: 8, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
            {portfolio.rows.map((r) => (
              <motion.div key={r.id} className="coin-row" variants={riseIn} onClick={() => navigate(`/coin/${r.coinId}`)}>
                <div className="coin-logo">{r.symbol.slice(0, 3)}</div>
                <div className="coin-meta">
                  <div className="coin-sym">{r.symbol}</div>
                  <div className="coin-name mono">{fmtQty(r.qty)} @ ${fmtPrice(r.avgPrice)}</div>
                </div>
                <div className="coin-right">
                  <div className="mono" style={{ fontSize: 12.5 }}>{fmtNum(r.value, 2)}</div>
                  <div className={`mono ${r.pnl >= 0 ? 'up' : 'down'}`} style={{ fontSize: 10.5 }}>
                    {fmtPct(r.pnlPct, 1)}
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </section>

      {/* ---------- stats ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 10 }}>{t('wallet.stats')}</p>
        <div className="grid-2" style={{ gap: 9 }}>
          <div className="row-between">
            <span className="faint">{t('wallet.trades')}</span>
            <span className="mono" style={{ fontSize: 12.5 }}>{orders.length}</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('wallet.betsPlaced')}</span>
            <span className="mono" style={{ fontSize: 12.5 }}>{bets.length}</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('wallet.winRate')}</span>
            <span className="mono" style={{ fontSize: 12.5 }}>{betStats.rate.toFixed(0)}%</span>
          </div>
          <div className="row-between">
            <span className="faint">{t('wallet.plans')}</span>
            <span className="mono" style={{ fontSize: 12.5 }}>{investments.length}</span>
          </div>
        </div>
      </motion.section>

      </>}

      {/* ---------- on-chain wallet (non-custodial) ---------- */}
      <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
        <p className="section-label" style={{ marginBottom: 10 }}>{t('wallet.onchain')}</p>

        {wallet.address ? (
          <div className="stack" style={{ gap: 9 }}>
            <div className="row-between">
              <span className="row" style={{ gap: 7 }}>
                <span className="dot" style={{ background: wallet.locked ? 'var(--rgb-5)' : 'var(--up)' }} />
                <span className="mono" style={{ fontSize: 12.5 }}>{shortAddress(wallet.address)}</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span className="pill pill-rgb">{wallet.chain?.short ?? 'BSC'}</span>
                <span className={`pill ${wallet.locked ? 'pill-down' : 'pill-up'}`}>
                  {wallet.locked ? '🔒' : t(`wallet.mode.${wallet.mode}`)}
                </span>
              </span>
            </div>

            {wallet.nativeBalance != null && (
              <div className="row-between">
                <span className="faint">{wallet.chain?.native?.symbol ?? 'BNB'}</span>
                <span className="mono" style={{ fontSize: 12.5 }}>{fmtQty(wallet.nativeBalance)}</span>
              </div>
            )}

            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => wallet.refreshBalance?.()}>
                {t('common.refresh')}
              </button>
              {wallet.mode === 'local' && !wallet.locked && (
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={wallet.lock}>
                  {t('wallet.lock')}
                </button>
              )}
              {wallet.locked ? (
                <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => setConnectOpen(true)}>
                  {t('wallet.unlock')}
                </button>
              ) : (
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={wallet.disconnect}>
                  {t('wallet.disconnect')}
                </button>
              )}
            </div>

            <a
              href={explorerAddr(wallet.chainId, wallet.address)}
              target="_blank"
              rel="noopener noreferrer"
              className="faint"
              style={{ fontSize: 11, textAlign: 'center', textDecoration: 'none' }}
            >
              {t('swap.viewOnExplorer')} ↗
            </a>

            {wallet.mode === 'local' && (
              <button className="btn btn-ghost btn-sm" onClick={() => setSeedSheet(true)}>
                {t('wallet.revealSeed')}
              </button>
            )}
          </div>
        ) : (
          <button className="btn btn-primary" onClick={() => setConnectOpen(true)}>
            {t('wallet.connect')}
          </button>
        )}

        <p className="notice" style={{ marginTop: 12 }}>{t('wallet.custodyNotice')}</p>
      </motion.section>

      {/* ---------- recent activity ---------- */}
      {orders.length > 0 && (
        <section>
          <p className="section-label">{t('wallet.activity')}</p>
          <div className="card card-tight" style={{ marginTop: 8 }}>
            {orders.slice(0, 6).map((o) => (
              <div key={o.id} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <span className={`pill ${o.side === 'buy' ? 'pill-up' : 'pill-down'}`}>{t(`trade.${o.side}`)}</span>
                <span className="mono" style={{ fontSize: 11.5 }}>{fmtQty(o.qty)} {o.symbol}</span>
                <span className="faint mono" style={{ fontSize: 10 }}>{fmtDateTime(o.at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />

      {/* ---------- reveal seed ---------- */}
      <Sheet
        title={t('wallet.revealSeed')}
        open={seedSheet}
        onClose={() => {
          setSeedSheet(false);
          setSeedWords(null);
          setSeedPw('');
          setSeedErr(null);
        }}
      >
        
        <p className="notice notice-danger" style={{ marginBottom: 12 }}>{t('wallet.backupWarning')}</p>

        {!seedWords ? (
          <>
            <label className="field-label">{t('wallet.password')}</label>
            <input type="password" value={seedPw} onChange={(e) => setSeedPw(e.target.value)} />
            {seedErr && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t('wallet.err.BAD_PASSWORD')}</p>}
            <button
              className="btn btn-primary"
              style={{ marginTop: 12 }}
              disabled={!seedPw}
              onClick={async () => {
                try {
                  setSeedWords(await revealMnemonic(seedPw));
                  setSeedErr(null);
                } catch {
                  setSeedErr(true);
                }
              }}
            >
              {t('wallet.revealSeed')}
            </button>
          </>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 7 }}>
            {seedWords.split(' ').map((w, i) => (
              <div key={i} className="mono" style={{ fontSize: 11.5, padding: '6px 8px', borderRadius: 8, background: 'rgba(0,0,0,.4)', border: '1px solid var(--line)' }}>
                <span style={{ color: 'var(--text-3)', marginInlineEnd: 5 }}>{i + 1}</span>
                {w}
              </div>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title={t('wallet.settings')}>
        
        <p className="muted">{t('wallet.resetDesc')}</p>
        <button
          className="btn btn-danger"
          style={{ marginTop: 14 }}
          onClick={() => {
            resetAccount();
            setConfirmReset(false);
            haptic?.('warning');
          }}
        >
          {t('wallet.resetAccount')}
        </button>
        {wallet.hasLocalVault && (
          <>
            <p className="notice notice-danger" style={{ marginTop: 14 }}>{t('wallet.forgetWarning')}</p>
            <button
              className="btn btn-danger"
              style={{ marginTop: 10 }}
              onClick={() => {
                wallet.forgetLocalWallet?.();
                setConfirmReset(false);
              }}
            >
              {t('wallet.forgetWallet')}
            </button>
          </>
        )}
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setConfirmReset(false)}>
          {t('common.cancel')}
        </button>
      </Sheet>
    </PageTransition>
  );
}
