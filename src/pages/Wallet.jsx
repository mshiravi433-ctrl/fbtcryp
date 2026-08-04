import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
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
import { IconQr } from '../components/Icons';
import SegIndicator from '../components/SegIndicator';
import { useHideBalances } from '../hooks/useHideBalances';
import { useWalletBalances } from '../hooks/useWalletBalances';
import TokenIcon from '../lib/tokenIcon';

const SLICE_COLORS = ['#00e5ff', '#7c4dff', '#ff2d95', '#00ff9d', '#ffb300', '#4dd0e1', '#b388ff'];

export default function Wallet() {
  // Subscribe so the figures re-render the moment the switch moves;
  // the masking itself lives in the formatters.
  useHideBalances();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, haptic } = useTelegram();
  const wallet = useWallet();

  const { priceMap } = usePriceMap(60);
  /*
   * Real on-chain holdings, priced. Before this the screen showed only the
   * native coin as a bare quantity — a user holding 400 USDT saw nothing about
   * it, and there was no fiat total anywhere.
   */
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
  const [tab, setTab] = useState('overview');
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
      <div className="segmented">
        {['overview', 'liquidity', 'practice'].map((k) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} style={{ isolation: 'isolate' }}>
            {tab === k && <SegIndicator id="wtab" />}
            {t(`wallet.tab.${k}`)}
          </button>
        ))}
      </div>

      {/*
        ---------- PRACTICE ACCOUNT (virtual NX) ----------

        This card used to render on EVERY tab, directly above the real
        on-chain wallet. Two different kinds of money — play credits and
        actual funds — sat stacked on one screen with similar styling, and the
        virtual one came first.

        Reported by the owner: users cannot tell them apart, and on a
        non-custodial exchange that confusion is expensive. Practice now lives
        behind its own tab with its own history, so the Overview tab shows
        real funds and nothing else.
      */}
      {tab === 'practice' && (
      <>
      <div className="notice" style={{ marginBottom: 12 }}>
        {t('wallet.practiceNotice')}
      </div>
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
      </>
      )}

      {/*
        THE REAL WALLET.

        This used to sit BELOW the virtual NX balance, the allocation pie and
        the paper-trading history — so on a non-custodial exchange the first
        numbers a user saw were play money. It was moved above them, and the
        practice account has now moved out of this tab entirely.

        Order is a claim about what matters. Overview is real funds only.
      */}
      {tab !== 'practice' && (
      <>
      {/* ---------- on-chain wallet (non-custodial) ---------- */}
      {/*
        ─── THE WALLET HERO ──────────────────────────────────────────────────
        Requested: a distinct, beautiful treatment «مثل wallet connect».

        What that look actually is, structurally: ONE surface that leads with
        the balance, with the address and network as quiet metadata above it
        and the actions as the only bright thing below. The old card had the
        section label first, then a small address row, then the actions, then
        the number — so the least important element was at the top and the
        most important was fourth.

        The reordering is the design. `.wal-hero` supplies the depth (an
        aurora wash and a soft rim) and everything inside is the same markup
        as before, so nothing about the logic or the data flow changed.
      */}
      <motion.section className="card wal-hero" variants={riseIn} initial="hidden" animate="show">
        <div className="wal-hero-aurora" aria-hidden="true" />

        {wallet.address ? (
          <div className="stack" style={{ gap: 9, position: 'relative' }}>
            <div className="row-between">
              <span className="wal-chip">
                <span
                  className={`wal-chip-dot ${wallet.locked ? '' : 'is-live'}`}
                  style={{ background: wallet.locked ? 'var(--rgb-5)' : 'var(--up)' }}
                />
                <span className="mono">{shortAddress(wallet.address)}</span>
              </span>
              <span className="row" style={{ gap: 6 }}>
                <span className="pill pill-rgb">{wallet.chain?.short ?? 'BSC'}</span>
                <span className={`pill ${wallet.locked ? 'pill-down' : 'pill-up'}`}>
                  {wallet.locked ? '🔒' : t(`wallet.mode.${wallet.mode}`)}
                </span>
              </span>
            </div>

            {/*
              ---------- TOTAL VALUE ----------
              The number people open a wallet to see. It used to sit BELOW the
              action buttons, which put the reason for the visit fourth on the
              screen. It now leads.
            */}
            <div className="wal-hero-value">
              <div className="faint">{t('wallet.onchainValue')}</div>
              <div className="stat-value wal-hero-total">
                {onchain.loading && !onchain.rows.length ? '…' : fmtUsd(onchain.total)}
              </div>
              {/*
                Honest about coverage. A holding we cannot price is still
                listed below, so silently leaving it out of the total would
                under-report someone's money without telling them.
              */}
              {onchain.partial && (
                <div className="faint" style={{ fontSize: 11, marginTop: 3 }}>
                  {t('wallet.partialValue')}
                </div>
              )}
            </div>

            {/*
              Send / Receive, directly under the address they act on.
              These are the two things a wallet is FOR, so they get the
              largest, highest-contrast controls on the screen rather than
              sitting among the row of small ghost buttons below — which is
              where they were invisible.
            */}
            <div className="wal-actions">
              <button className="wal-action wal-recv" onClick={() => setReceiveOpen(true)}>
                <span className="wal-action-icon" aria-hidden="true">
                  <IconQr width={18} height={18} />
                </span>
                <span className="wal-action-label">{t('receive.title')}</span>
              </button>
              <button
                className="wal-action wal-send"
                onClick={() => setSendOpen(true)}
                /* Locked means no signer, so a send could only fail at the
                   final step. Better to disable it than to let someone fill
                   in an address and an amount for nothing. */
                disabled={wallet.locked}
              >
                <span className="wal-action-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
                       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </span>
                <span className="wal-action-label">{t('send.title')}</span>
              </button>
            </div>

            {/*
              Buy & sell, directly under Receive/Send.

              This is where someone looks after seeing an empty balance — the
              question "how do I get some" is asked from this exact spot, and
              the answer was buried three taps deep in the More menu. Full
              width rather than a third column: Receive and Send act on the
              address above them, while this one leaves for a different screen,
              so it reads better as its own row than as a sibling.
            */}
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: '100%' }}
              onClick={() => navigate('/buy')}
            >
              {t('nav.buy')}
            </button>

            {/*
              ---------- TOTAL VALUE ----------
              The number people open a wallet to see. It used to not exist:
              the screen showed one bare quantity ("0.4183") and left the
              user to price it themselves.
            */}

            {/*
              ---------- PER-TOKEN HOLDINGS ----------

              Asked for the token TYPE and AMOUNT under the total, not just a
              total. The rows existed but read as a cramped two-column list:
              ticker on the left, number on the right, no logo and no full
              name. "USDT 400" tells you less than it looks like it does when
              four rows are stacked.

              Now each holding gets the same coin-row treatment as the market
              screen — logo, symbol, full name, quantity, and fiat value —
              because a wallet list and a market list answer the same question
              and should not look like different apps.
            */}
            {onchain.rows.length > 0 ? (
              <div className="stack" style={{ gap: 8, marginTop: 6 }}>
                <div className="faint" style={{ fontSize: 11 }}>{t('wallet.yourTokens')}</div>
                {onchain.rows.map((r) => (
                  <div key={r.symbol} className="row-between" style={{ gap: 10 }}>
                    <span className="row" style={{ gap: 9, minWidth: 0 }}>
                      <TokenIcon
                        token={{ symbol: r.symbol, address: r.address, native: r.native }}
                        chainId={wallet.chainId}
                        size={28}
                      />
                      <span style={{ minWidth: 0 }}>
                        <div className="row" style={{ gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700 }}>{r.symbol}</span>
                          {r.native && (
                            <span className="pill pill-rgb" style={{ fontSize: 9 }}>{t('wallet.gasCoin')}</span>
                          )}
                        </div>
                        {/* The full name disambiguates look-alike tickers. */}
                        <div
                          className="faint"
                          style={{
                            fontSize: 10.5,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {r.name}
                        </div>
                      </span>
                    </span>
                    <span style={{ textAlign: 'end', flexShrink: 0 }}>
                      <div className="mono" style={{ fontSize: 13 }}>{fmtQty(r.amount)}</div>
                      <div className="faint mono" style={{ fontSize: 10.5 }}>
                        {/*
                          An unpriced token shows a dash rather than nothing.
                          A blank space reads as a loading state that never
                          finishes; "—" says we looked and there is no price.
                        */}
                        {r.value != null ? fmtUsd(r.value) : '—'}
                      </div>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              !onchain.loading && (
                <p className="faint" style={{ fontSize: 12, marginTop: 4 }}>
                  {onchain.error ? t('wallet.balancesFailed') : t('wallet.noOnchainTokens')}
                </p>
              )
            )}

            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-ghost btn-sm"
                style={{ flex: 1 }}
                onClick={() => {
                  // Both, or the token list silently goes stale after a swap
                  // while the header total refreshes — two numbers on one
                  // screen disagreeing about the same wallet.
                  wallet.refreshBalance?.();
                  onchain.refresh();
                }}
              >
                {onchain.loading ? '…' : t('common.refresh')}
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
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setSeedSheet(true)}>
                  {t('wallet.revealSeed')}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setBackupResult(null);
                    setBackupErr(null);
                    setBackupSheet(true);
                  }}
                >
                  {t('wallet.backupFile')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <button className="btn btn-primary" onClick={() => setConnectOpen(true)}>
            {t('wallet.connect')}
          </button>
        )}

        <p className="notice" style={{ marginTop: 12 }}>{t('wallet.custodyNotice')}</p>
      </motion.section>
      </>
      )}

      {tab === 'liquidity' && (
        <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
          <p className="section-label" style={{ marginBottom: 10 }}>{t('wallet.tab.liquidity')}</p>
          <p className="muted" style={{ fontSize: 12.3 }}>{t('wallet.liquidityBody')}</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/farm')}>
            {t('wallet.viewPools')}
          </button>
        </motion.section>
      )}

      {tab === 'practice' && (
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

      {/*
        Everything from here to the closing fragment is VIRTUAL money — the
        allocation pie, the NX cash/positions/staked tiles, the paper holdings
        and the paper-trading stats. It was rendered under `overview`, i.e.
        directly below the real on-chain wallet, which is exactly the mix-up
        this restructure removes.
      */}
      {tab === 'practice' && <>
      <AdBanner slot="farm" compact />
      {/* ---------- allocation (virtual) ---------- */}
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


      {/* ---------- recent activity (virtual trades) ---------- */}
      {tab === 'practice' && orders.length > 0 && (
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

      {/* ---------- encrypted file backup ---------- */}
      <Sheet open={backupSheet} onClose={() => setBackupSheet(false)} title={t('wallet.backupFile')}>
        <p className="notice notice-danger">{t('wallet.backupWarn')}</p>

        <div className="card card-tight" style={{ marginTop: 11 }}>
          <p className="muted" style={{ fontSize: 12.2, margin: 0 }}>{t('wallet.backupWhat')}</p>
        </div>

        {backupResult && (
          <motion.div
            className="card card-tight"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginTop: 11, borderColor: 'var(--up)' }}
          >
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 5 }} className="up">
              ✓ {t('wallet.backupSaved')}
            </div>
            <div className="faint">{t('wallet.backupLocation')}</div>
            <div className="mono" style={{ fontSize: 11.5, marginTop: 3, wordBreak: 'break-all' }}>
              {backupResult.hint} / {BACKUP_FILENAME}
            </div>
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
              await shareWalletBackup();
              haptic?.('success');
            } catch {
              setBackupErr('FAILED');
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
