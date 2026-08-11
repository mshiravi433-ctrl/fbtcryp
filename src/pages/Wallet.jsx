import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import HardwareWalletCard from '../components/HardwareWalletCard';
import AnimatedNumber from '../components/AnimatedNumber';
import Sheet from '../components/Sheet';
import { usePriceMap } from '../hooks/useMarket';
import { fmtNum, fmtPct, fmtPrice, fmtQty, fmtUsd, fmtDateTime } from '../lib/format';
import { useAppStore, valuePortfolio, START_BALANCE_CONST } from '../store/useAppStore';
import { shortAddress, useWallet } from '../context/WalletContext';
import { useTelegram } from '../context/TelegramContext';
import WalletConnectSheet from '../components/WalletConnectSheet';
import SendSheet from '../components/SendSheet';
import ReceiveSheet from '../components/ReceiveSheet';
import { revealMnemonic } from '../lib/localWallet';
import { exportWallet, shareWalletBackup, BACKUP_FILENAME } from '../lib/walletBackup';
import AdBanner from '../components/AdBanner';
import { explorerAddr } from '../lib/chains';
import SegIndicator from '../components/SegIndicator';
import { IconReceive, IconSend, WalletMesh } from '../components/WalletArt';
import { useHideBalances } from '../hooks/useHideBalances';
import { useWalletBalances } from '../hooks/useWalletBalances';
import TokenIcon from '../lib/tokenIcon';
import '../styles/wallet-modern.css';

const SLICE_COLORS = ['#00e5ff', '#7c4dff', '#ff2d95', '#00ff9d', '#ffb300', '#4dd0e1', '#b388ff'];

export default function Wallet() {
  useHideBalances();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, haptic } = useTelegram();
  const wallet = useWallet();

  const { priceMap } = usePriceMap(60);
  const onchain = useWalletBalances(wallet);
  const balance = useAppStore((s) => s.balance);
  const positions = useAppStore((s) => s.positions);
  const investments = useAppStore((s) => s.investments);
  const orders = useAppStore((s) => s.orders);
  const bets = useAppStore((s) => s.bets);
  const level = useAppStore((s) => s.level);
  const resetAccount = useAppStore((s) => s.resetAccount);

  const [confirmReset, setConfirmReset] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [tab, setTab] = useState('real');
  const [connectOpen, setConnectOpen] = useState(false);
  const [seedSheet, setSeedSheet] = useState(false);
  const [seedPw, setSeedPw] = useState('');
  const [seedWords, setSeedWords] = useState(null);
  const [seedErr, setSeedErr] = useState(null);
  const [backupSheet, setBackupSheet] = useState(false);
  const [backupResult, setBackupResult] = useState(null);
  const [backupErr, setBackupErr] = useState(null);

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
      {/* Modern segmented — larger */}
      <div className="segmented" style={{ padding: 5, borderRadius: 18, gap: 4 }}>
        {['real', 'practice'].map((k) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} style={{ isolation: 'isolate', minHeight: 38, borderRadius: 13, fontWeight: 800, fontSize: 13 }}>
            {tab === k && <SegIndicator id="wtab" />}
            {t(`wallet.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'practice' && (
        <>
          <motion.div variants={riseIn} initial="hidden" animate="show" className="notice" style={{ marginTop: 14, borderRadius: 14, padding: '12px 14px', fontSize: 12.5 }}>
            {t('wallet.practiceNotice')}
          </motion.div>
          <motion.section className="wallet-hero-modern wal-hero" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 14 }}>
            <div className="wallet-hero-aurora" aria-hidden="true" />
            <div className="row-between">
              <div className="row" style={{ gap: 12 }}>
                <div
                  className="coin-logo"
                  style={{ width: 48, height: 48, fontSize: 18, background: 'linear-gradient(135deg,var(--rgb-2),var(--rgb-3))', color: '#fff', borderRadius: 14, boxShadow: '0 10px 24px rgba(124,77,255,0.24)' }}
                >
                  {(user?.first_name ?? 'N')[0].toUpperCase()}
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{user?.first_name ?? t('wallet.guest')}</div>
                  <div className="faint" style={{ fontSize: 12 }}>
                    {user?.username ? `@${user.username}` : t('wallet.localSession')} · L{level}
                  </div>
                </div>
              </div>
              <button className="icon-btn" onClick={() => setConfirmReset(true)}>⚙</button>
            </div>

            <div style={{ marginTop: 18 }}>
              <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.7 }}>{t('wallet.netWorth')}</div>
              <div className="wallet-total-modern" style={{ marginTop: 4 }}>
                <AnimatedNumber value={netWorth} format={(v) => `${fmtNum(v, 2)} NX`} />
              </div>
              <div className={`mono ${allTimePnl >= 0 ? 'up' : 'down'}`} style={{ fontSize: 12.5, marginTop: 6, fontWeight: 700 }}>
                {allTimePnl >= 0 ? '+' : ''}{fmtNum(allTimePnl, 2)} ({fmtPct((allTimePnl / START_BALANCE_CONST) * 100)}) {t('wallet.allTime')}
              </div>
            </div>
          </motion.section>
        </>
      )}

      {/* ----------------- on-chain wallet (non-custodial) ----------------- */}
      {tab !== 'practice' && (
        <>
          <motion.section className="wallet-hero-modern wal-hero" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 14 }}>
            <div className="wallet-hero-aurora" aria-hidden="true" />
            <WalletMesh />

            {wallet.address ? (
              <div className="stack" style={{ gap: 12, position: 'relative' }}>
                <div className="row-between">
                  <span className="wallet-chip-modern">
                    <span className={`wal-chip-dot ${wallet.locked ? '' : 'is-live'}`} style={{ background: wallet.locked ? 'var(--rgb-5)' : 'var(--up)', width: 8, height: 8, borderRadius: '50%', display: 'inline-block', boxShadow: wallet.locked ? 'none' : '0 0 8px var(--up)' }} />
                    <span className="mono" style={{ fontWeight: 700 }}>{shortAddress(wallet.address)}</span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <span className="pill pill-rgb" style={{ fontSize: 10.5, padding: '4px 8px' }}>{wallet.chain?.short ?? 'BSC'}</span>
                    <span className={`pill ${wallet.locked ? 'pill-down' : 'pill-up'}`} style={{ fontSize: 10.5 }}>{wallet.locked ? '🔒' : t(`wallet.mode.${wallet.mode}`)}</span>
                  </span>
                </div>

                <div>
                  <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.7 }}>{t('wallet.onchainValue')}</div>
                  <div className="wallet-total-modern" style={{ marginTop: 4 }}>
                    {onchain.loading && !onchain.rows.length ? '…' : fmtUsd(onchain.total)}
                  </div>
                  {onchain.partial && (
                    <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{t('wallet.partialValue')}</div>
                  )}
                </div>

                <div className="wallet-actions-modern">
                  <button className="wallet-action-modern recv" onClick={() => setReceiveOpen(true)}>
                    <span className="wallet-action-icon-modern" aria-hidden="true"><IconReceive /></span>
                    <span style={{ fontWeight: 800, fontSize: 12 }}>{t('receive.title')}</span>
                  </button>
                  <button className="wallet-action-modern send" onClick={() => setSendOpen(true)} disabled={wallet.locked}>
                    <span className="wallet-action-icon-modern" aria-hidden="true"><IconSend /></span>
                    <span style={{ fontWeight: 800, fontSize: 12 }}>{t('send.title')}</span>
                  </button>
                </div>

                <button className="wallet-buy-modern wal-buy" onClick={() => navigate('/buy')}>
                  {t('nav.buy')} →
                </button>

                {onchain.rows.length > 0 ? (
                  <div className="stack" style={{ gap: 10, marginTop: 8 }}>
                    <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.7 }}>{t('wallet.yourTokens')}</div>
                    {onchain.rows.map((r) => (
                      <div key={r.symbol} className="wallet-token-row-modern">
                        <TokenIcon token={{ symbol: r.symbol, address: r.address, native: r.native }} chainId={wallet.chainId} size={32} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <div className="row" style={{ gap: 6 }}>
                            <span style={{ fontSize: 13.5, fontWeight: 800 }}>{r.symbol}</span>
                            {r.native && <span className="pill pill-rgb" style={{ fontSize: 9 }}>{t('wallet.gasCoin')}</span>}
                          </div>
                          <div className="faint" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                        </span>
                        <span style={{ textAlign: 'end', flexShrink: 0 }}>
                          <div className="mono" style={{ fontSize: 13.5, fontWeight: 800 }}>{fmtQty(r.amount)}</div>
                          <div className="faint mono" style={{ fontSize: 11 }}>{r.value != null ? fmtUsd(r.value) : '—'}</div>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  !onchain.loading && (
                    <p className="faint" style={{ fontSize: 12.5, marginTop: 4, textAlign: 'center', padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px dashed var(--line)' }}>
                      {onchain.error ? t('wallet.balancesFailed') : t('wallet.noOnchainTokens')}
                    </p>
                  )
                )}

                <div className="row" style={{ gap: 8, marginTop: 4 }}>
                  <button className="btn btn-ghost" style={{ flex: 1, minHeight: 36, borderRadius: 12 }} onClick={() => { wallet.refreshBalance?.(); onchain.refresh(); }}>
                    {onchain.loading ? '…' : t('common.refresh')}
                  </button>
                  {wallet.mode === 'local' && !wallet.locked && (
                    <button className="btn btn-ghost" style={{ flex: 1, minHeight: 36, borderRadius: 12 }} onClick={wallet.lock}>{t('wallet.lock')}</button>
                  )}
                  {wallet.locked ? (
                    <button className="btn btn-primary" style={{ flex: 1, minHeight: 36, borderRadius: 12 }} onClick={() => setConnectOpen(true)}>{t('wallet.unlock')}</button>
                  ) : (
                    <button className="btn btn-ghost" style={{ flex: 1, minHeight: 36, borderRadius: 12, color: 'var(--down)', borderColor: 'rgba(255,59,107,0.18)' }} onClick={wallet.disconnect}>{t('wallet.disconnect')}</button>
                  )}
                </div>

                <a href={explorerAddr(wallet.chainId, wallet.address)} target="_blank" rel="noopener noreferrer" className="faint" style={{ fontSize: 11, textAlign: 'center', textDecoration: 'none', display: 'block', marginTop: 4 }}>
                  {t('swap.viewOnExplorer')} ↗
                </a>

                {wallet.mode === 'local' && (
                  <div className="row" style={{ gap: 8, marginTop: 4 }}>
                    <button className="btn btn-ghost btn-sm" style={{ flex: 1, borderRadius: 12 }} onClick={() => setSeedSheet(true)}>{t('wallet.revealSeed')}</button>
                    <button className="btn btn-ghost btn-sm" style={{ flex: 1, borderRadius: 12 }} onClick={() => { setBackupResult(null); setBackupErr(null); setBackupSheet(true); }}>{t('wallet.backupFile')}</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="wal-empty" style={{ position: 'relative', textAlign: 'center', padding: '8px 0' }}>
                <div style={{ width: 72, height: 72, borderRadius: 20, margin: '0 auto 14px', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))', color: '#fff', fontSize: 28, boxShadow: '0 12px 32px rgba(0,229,255,0.24)' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" /><path d="M4 6v12c0 1.1.9 2 2 2h14v-4" /><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" /></svg>
                </div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{t('wallet.emptyTitle')}</div>
                <p className="muted" style={{ fontSize: 13, lineHeight: 1.85, margin: '8px 0 0' }}>{t('wallet.emptyBody')}</p>
                <button className="btn btn-primary" style={{ marginTop: 16, minHeight: 46, borderRadius: 14, padding: '0 24px' }} onClick={() => setConnectOpen(true)}>{t('wallet.connect')}</button>
                <p className="faint" style={{ fontSize: 11.5, marginTop: 12, lineHeight: 1.7 }}>{t('wallet.emptyReassure')}</p>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <InfoBox title={t('wallet.custodyTitle')} tone="info" id="wallet-custody">
                <p style={{ fontSize: 12.5, lineHeight: 1.85 }}>{t('wallet.custodyNotice')}</p>
              </InfoBox>
            </div>
          </motion.section>
        </>
      )}

      {tab === 'real' && (
        <motion.section className="wallet-pie-card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <span style={{ fontWeight: 800, fontSize: 13.5 }}>{t('wallet.holdingsMore')}</span>
            <span className="faint" style={{ fontSize: 11 }}>واقعی</span>
          </div>
          <p className="muted" style={{ fontSize: 12.7, lineHeight: 1.85, margin: '0 0 14px' }}>{t('wallet.liquidityBody')}</p>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-ghost" style={{ flex: 1, minHeight: 42, borderRadius: 12 }} onClick={() => navigate('/farm')}>{t('wallet.viewPools')}</button>
            <button className="btn btn-ghost" style={{ flex: 1, minHeight: 42, borderRadius: 12 }} onClick={() => navigate('/nft')}>{t('nav.nft')}</button>
          </div>
        </motion.section>
      )}

      {tab === 'real' && <HardwareWalletCard />}

      {tab === 'practice' && (
        <motion.section className="wallet-pie-card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 12 }}>{t('wallet.tab.history')}</div>
          {orders.length === 0 ? (
            <div className="empty" style={{ padding: 18 }}>
              <span className="empty-icon">🗒</span>
              <div className="faint" style={{ marginTop: 8 }}>{t('wallet.noHistory')}</div>
            </div>
          ) : (
            orders.slice(0, 20).map((o) => (
              <div key={o.id} className="row-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <span className={`pill ${o.side === 'buy' ? 'pill-up' : 'pill-down'}`} style={{ fontSize: 11 }}>{t(`trade.${o.side}`)}</span>
                <span className="mono" style={{ fontSize: 12 }}>{fmtQty(o.qty)} {o.symbol}</span>
                <span className="faint mono" style={{ fontSize: 10.5 }}>{fmtDateTime(o.at)}</span>
              </div>
            ))
          )}
        </motion.section>
      )}

      {/* ----------------- allocation ----------------- */}
      {tab === 'practice' && <>
          <AdBanner slot="farm" compact />
          <AdBanner slot="farm" compact />
          <motion.section className="wallet-pie-card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 12 }}>{t('wallet.allocation')}</div>
            <div className="row" style={{ gap: 16, alignItems: 'center' }}>
              <div style={{ width: 126, height: 126, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" innerRadius={38} outerRadius={60} paddingAngle={3} stroke="none" animationDuration={900}>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="stack" style={{ gap: 8, flex: 1 }}>
                {pieData.slice(0, 5).map((d, i) => (
                  <div key={d.name} className="row-between" style={{ fontSize: 12.5 }}>
                    <span className="row" style={{ gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: SLICE_COLORS[i % SLICE_COLORS.length], boxShadow: `0 0 8px ${SLICE_COLORS[i % SLICE_COLORS.length]}55` }} />
                      {d.name}
                    </span>
                    <span className="mono" style={{ fontWeight: 700 }}>{((d.value / (netWorth || 1)) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.section>

          <motion.div className="wallet-bento" variants={stagger} initial="hidden" animate="show" style={{ marginTop: 14 }}>
            {[
              { label: t('wallet.cash'), value: fmtNum(balance, 0), hue: 'var(--rgb-1)' },
              { label: t('wallet.positions'), value: fmtNum(portfolio.value, 0), hue: 'var(--rgb-2)' },
              { label: t('wallet.staked'), value: fmtNum(staked, 0), hue: 'var(--rgb-4)' },
            ].map((c) => (
              <motion.div key={c.label} className="wallet-pie-card" variants={riseIn} style={{ padding: 14, textAlign: 'center', borderColor: `color-mix(in srgb, ${c.hue} 14%, transparent)` }}>
                <div className="faint" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6 }}>{c.label}</div>
                <div className="mono" style={{ fontSize: 18, fontWeight: 900, marginTop: 6, color: c.hue }}>{c.value}</div>
              </motion.div>
            ))}
          </motion.div>

          <section style={{ marginTop: 16 }}>
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span style={{ fontWeight: 800, fontSize: 13.5 }}>{t('wallet.holdings')}</span>
              <span className="faint" style={{ fontSize: 11 }}>{portfolio.rows.length} دارایی</span>
            </div>
            {portfolio.rows.length === 0 ? (
              <div className="empty" style={{ padding: 18, borderRadius: 16, border: '1px dashed var(--line)' }}>
                <span className="empty-icon">📭</span>
                <div className="faint" style={{ marginTop: 8 }}>{t('wallet.noHoldings')}</div>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => navigate('/trade')}>{t('wallet.startTrading')}</button>
              </div>
            ) : (
              <motion.div className="stack" style={{ gap: 10, marginTop: 8 }} variants={stagger} initial="hidden" animate="show">
                {portfolio.rows.map((r) => (
                  <motion.div key={r.id} className="wallet-token-row-modern" variants={riseIn} onClick={() => navigate(`/coin/${r.coinId}`)} style={{ cursor: 'pointer' }}>
                    <div className="coin-logo" style={{ width: 36, height: 36, fontSize: 12, borderRadius: 11 }}>{r.symbol.slice(0, 3)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{r.symbol}</div>
                      <div className="faint mono" style={{ fontSize: 11 }}>{fmtQty(r.qty)} @ ${fmtPrice(r.avgPrice)}</div>
                    </div>
                    <div style={{ textAlign: 'end' }}>
                      <div className="mono" style={{ fontSize: 13, fontWeight: 800 }}>{fmtNum(r.value, 2)}</div>
                      <div className={`mono ${r.pnl >= 0 ? 'up' : 'down'}`} style={{ fontSize: 11, fontWeight: 700 }}>{fmtPct(r.pnlPct, 1)}</div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </section>

          <motion.section className="wallet-pie-card" variants={riseIn} initial="hidden" animate="show" style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 12 }}>{t('wallet.stats')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { k: t('wallet.trades'), v: orders.length },
                { k: t('wallet.betsPlaced'), v: bets.length },
                { k: t('wallet.winRate'), v: `${betStats.rate.toFixed(0)}%` },
                { k: t('wallet.plans'), v: investments.length },
              ].map((s) => (
                <div key={s.k} className="card card-tight" style={{ padding: 12, textAlign: 'center', borderRadius: 12 }}>
                  <div className="faint" style={{ fontSize: 11, fontWeight: 700 }}>{s.k}</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 900, marginTop: 4 }}>{s.v}</div>
                </div>
              ))}
            </div>
          </motion.section>
        </>}

      <Sheet open={backupSheet} onClose={() => setBackupSheet(false)} title={t('wallet.backupFile')}>
        <p className="notice notice-danger">{t('wallet.backupWarn')}</p>
        <div className="card card-tight" style={{ marginTop: 11 }}>
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{t('wallet.backupWhat')}</p>
        </div>
        {backupResult && (
          <motion.div className="card card-tight" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 11, borderColor: 'var(--up)' }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5 }} className="up">✓ {t('wallet.backupSaved')}</div>
            <div className="faint">{t('wallet.backupLocation')}</div>
            <div className="mono" style={{ fontSize: 11.5, marginTop: 3, wordBreak: 'break-all' }}>{backupResult.hint} / {BACKUP_FILENAME}</div>
          </motion.div>
        )}
        {backupErr && <p className="notice notice-danger" style={{ marginTop: 10 }}>{t(`wallet.backupErr.${backupErr}`)}</p>}
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            setBackupErr(null);
            try {
              const res = await exportWallet();
              setBackupResult(res);
              useAppStore.getState().completeQuest('backupWallet');
              haptic?.('success');
            } catch (e) {
              setBackupErr(e.message === 'NO_VAULT' ? 'NO_VAULT' : 'FAILED');
              haptic?.('error');
            }
          }}
        >
          {t('wallet.backupSave')}
        </button>
        <button
          className="btn btn-ghost"
          style={{ marginTop: 9 }}
          onClick={async () => {
            try {
              const res = await shareWalletBackup();
              if (res?.ok) {
                useAppStore.getState().notify(res.downloaded ? 'فایل دانلود شد — پوشه Downloads را ببین' : res.webShared ? 'اشتراک‌گذاری انجام شد' : 'آماده شد', 'success');
                haptic?.('success');
              } else {
                setBackupErr('FAILED');
                haptic?.('error');
              }
            } catch (e) {
              setBackupErr('FAILED');
              haptic?.('error');
            }
          }}
        >
          {t('wallet.backupShare')}
        </button>
        <p className="notice" style={{ marginTop: 12 }}>{t('wallet.backupPaperNote')}</p>
      </Sheet>

      <WalletConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />
      <SendSheet open={sendOpen} onClose={() => setSendOpen(false)} />
      <ReceiveSheet open={receiveOpen} onClose={() => setReceiveOpen(false)} />

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
        <button className="btn btn-danger" style={{ marginTop: 14 }} onClick={() => { resetAccount(); setConfirmReset(false); haptic?.('warning'); }}>
          {t('wallet.resetAccount')}
        </button>
        {wallet.hasLocalVault && (
          <>
            <p className="notice notice-danger" style={{ marginTop: 14 }}>{t('wallet.forgetWarning')}</p>
            <button className="btn btn-danger" style={{ marginTop: 10 }} onClick={() => { wallet.forgetLocalWallet?.(); setConfirmReset(false); }}>
              {t('wallet.forgetWallet')}
            </button>
          </>
        )}
        <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setConfirmReset(false)}>{t('common.cancel')}</button>
      </Sheet>
    </PageTransition>
  );
}
