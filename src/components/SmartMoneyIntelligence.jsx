import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { fetchIntelligence, fetchVerifiedWallets, fmtUsd, shortAddr, timeAgo, CHAIN_OPTIONS } from '../lib/smartMoneyClient';
import { getTracked, trackWallet } from '../lib/smartMoneyWatch';
import { openUrl } from '../lib/browser';
import TokenIcon from '../lib/tokenIcon';
import ModernSelect from './ModernSelect';

const WINDOWS = ['30m', '24h', '7d'];
const badge = (signal) => signal === 'ACCUMULATION' ? 'up' : signal === 'DISTRIBUTION' ? 'down' : 'idle';
const chainName = (id) => CHAIN_OPTIONS.find((c) => String(c.id) === String(id))?.short || String(id);
const EXPLORERS = {
  1: 'https://etherscan.io',
  56: 'https://bscscan.com',
  137: 'https://polygonscan.com',
  42161: 'https://arbiscan.io',
  8453: 'https://basescan.org',
  10: 'https://optimistic.etherscan.io',
  43114: 'https://snowtrace.io'
};
const txUrl = (chain, hash) => (EXPLORERS[chain] && /^0x[a-fA-F0-9]{64}$/.test(String(hash || ''))) ? `${EXPLORERS[chain]}/tx/${hash}` : null;
const walletExplorerUrl = (chain, addr) => (EXPLORERS[chain] && /^0x[a-fA-F0-9]{40}$/.test(String(addr || ''))) ? `${EXPLORERS[chain]}/address/${addr}` : null;
const pct = (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Math.round(Number(v))}%`);

/** Format price cleanly with appropriate precision */
function fmtPrice(val) {
  if (val == null || !Number.isFinite(Number(val))) return '—';
  const num = Number(val);
  if (num === 0) return '$0.00';
  if (num < 0.0001) return `$${num.toFixed(8)}`;
  if (num < 0.01) return `$${num.toFixed(6)}`;
  if (num < 1) return `$${num.toFixed(4)}`;
  if (num < 100) return `$${num.toFixed(2)}`;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** «در حال به‌روزرسانی از زنجیره» / last-attempt honesty for the index stamp. */
function refreshNote(t, data) {
  const st = data?.refresh?.status;
  if (st === 'refreshing' || st === 'refreshed') return t('sm.engine.refreshing');
  const last = data?.lastCycle;
  if (last && last.status && last.status !== 'sampled') return t('sm.engine.lastAttemptFailed', { ago: timeAgo(last.at) });
  return null;
}

/** Honest top-of-overview handoff: this uses the overview's indexed evidence */
export function IntelligenceTeaser({ verified, onOpen }) {
  const { t } = useTranslation();
  const active = (verified?.consensus || []).filter((r) => r.confidence != null);
  return (
    <section className="smi-teaser" aria-label={t('sm.engine.title')}>
      <div className="smi-teaser-mark" aria-hidden="true">◇</div>
      <div className="smi-teaser-copy">
        <strong>{t('sm.engine.title')}</strong>
        <span>{active.length ? t('sm.engine.activeCount', { n: active.length })
          : verified?.coverage?.analyzedWallets ? t('sm.engine.teaserSample', { wallets: verified.coverage.analyzedWallets, swaps: verified.coverage.observedSwaps ?? 0 })
            : t('sm.engine.noConsensus')}</span>
      </div>
      <button type="button" onClick={onOpen}>{t('sm.engine.open')} <span aria-hidden="true">↗</span></button>
    </section>
  );
}

export function VerifiedWallets() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  /*
   * «هوش تایید شده برای کیف پول واجد شرایط داده ندارد» — the board used to
   * fetch ONCE. An empty answer on a fresh server is usually a mid-index
   * pass, not a finished verdict, so the reader inherited a static empty board
   * forever. It now re-asks every 30s while it has nothing to show (and stops
   * the moment a wallet qualifies), and while empty it prints WHAT the engine
   * has seen so far — analysed wallets and on-chain receipts — instead of a
   * one-line shrug.
   */
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const emptyRef = { current: true };
    const run = () =>
      fetchVerifiedWallets(ctrl.signal)
        .then((d) => {
          if (!alive) return;
          setData(d);
          emptyRef.current = !(d?.wallets?.length > 0);
        })
        .catch(() => {
          if (alive && !ctrl.signal.aborted) setError(true);
        });
    setError(false);
    run();
    const iv = setInterval(() => {
      if (ctrl.signal.aborted || typeof document !== 'undefined' && document.hidden) return;
      if (emptyRef.current) run();
    }, 30_000);
    return () => {
      alive = false;
      ctrl.abort();
      clearInterval(iv);
    };
  }, []);

  return (
    <section className="sm-section smi-board" aria-label={t('sm.engine.verifiedBoard')}>
      <div className="smi-head">
        <div>
          <span className="smi-eyebrow">01 / {t('sm.engine.evidence')}</span>
          <h3>{t('sm.engine.verifiedBoard')}</h3>
        </div>
        {data?.wallets?.length > 0 && (
          <span className="smi-count">{data.wallets.length} {t('sm.engine.wallets')}</span>
        )}
      </div>

      {error && <p className="smi-sub">{t('sm.engine.unavailable')}</p>}
      {!error && !data && <div className="sm-skel" />}
      {/* While the board is empty: not «داده ندارد», but what the engine has
          measured so far, the index stamp, and the fact that it is STILL
          scanning (the 30s re-poll above). Candidates render below this. */}
      {data && !data.wallets?.length && (
        <div className="smi-scanning" data-testid="sm-verified-scanning">
          <div className="smi-scanning-head">
            <span className="smi-live-dot" aria-hidden="true" />
            <span>{t('sm.engine.noQualified')}</span>
          </div>
          <div className="smi-scanning-stats">
            <div>
              <b className="mono">{data.coverage?.analyzedWallets ?? '—'}</b>
              <span>{t('sm.engine.analysed')}</span>
            </div>
            <div>
              <b className="mono">{data.coverage?.observedSwaps ?? data.coverage?.swapsInWindow ?? '—'}</b>
              <span>{t('sm.engine.receiptsShort', { defaultValue: 'معامله' })}</span>
            </div>
            <div>
              <b className="mono">{data.indexedAt ? '✓' : '…'}</b>
              <span>{t('sm.engine.indexed')}</span>
            </div>
          </div>
          <small>
            {refreshNote(t, data) || (data.indexedAt ? t('sm.engine.emptyBody') : t('sm.engine.notIndexed'))}
          </small>
        </div>
      )}

      <div className="smi-wallet-grid">
        {(data?.wallets || []).slice(0, 15).map((w, i) => {
          const expUrl = walletExplorerUrl(w.chain, w.address);
          return (
            <div key={`${w.chain}:${w.address}`} className="smi-wallet-card">
              <div className="smi-wcard-head">
                <div className="smi-wcard-rank">#{String(i + 1).padStart(2, '0')}</div>
                <div className="smi-wcard-info">
                  <div className="smi-wcard-title">
                    <strong className="mono" title={w.address}>{w.label || shortAddr(w.address)}</strong>
                    <span className="smi-wcard-badge">✓ {t('sm.engine.qualifiedShort', { defaultValue: 'تایید شده' })}</span>
                  </div>
                  <div className="smi-wcard-sub">
                    <span className="smi-chain-pill">{chainName(w.chain)}</span>
                    <span className="smi-kind-pill">{w.kind || t('sm.engine.behaviourOnly')}</span>
                  </div>
                </div>
                <div className="smi-wcard-score-box">
                  <span className="smi-wcard-score-val">{w.score}</span>
                  <span className="smi-wcard-score-lab">{t('sm.engine.score')}</span>
                </div>
              </div>

              <div className="smi-wcard-metrics">
                <div className="smi-wcard-m-item">
                  <span className="k">{t('sm.engine.closes')}</span>
                  <span className="v">{w.closedTrades}</span>
                </div>
                <div className="smi-wcard-m-item">
                  <span className="k">{t('sm.engine.coverageShort')}</span>
                  <span className="v">{Math.round((w.coverage || 0) * 100)}%</span>
                </div>
                {w.winRate != null && (
                  <div className="smi-wcard-m-item">
                    <span className="k">{t('sm.engine.winRate', { defaultValue: 'نرخ برد' })}</span>
                    <span className="v sm-up">{pct(w.winRate)}</span>
                  </div>
                )}
                {w.realizedUsd != null && w.realizedUsd !== 0 && (
                  <div className="smi-wcard-m-item">
                    <span className="k">{t('sm.engine.realized', { defaultValue: 'سود محقق‌شده' })}</span>
                    <span className={`v ${w.realizedUsd >= 0 ? 'sm-up' : 'sm-down'}`}>{fmtUsd(w.realizedUsd)}</span>
                  </div>
                )}
              </div>

              <div className="smi-wcard-actions">
                <button
                  type="button"
                  className="smi-btn-analyze"
                  onClick={() => navigate(`/smart-money/wallet/${w.chain}/${w.address}`)}
                >
                  {t('sm.analyze', { defaultValue: 'تحلیل کیف‌پول' })} ↗
                </button>
                {expUrl && (
                  <button
                    type="button"
                    className="smi-btn-explorer"
                    title={t('sm.engine.source', { defaultValue: 'مشاهده در کاوشگر' })}
                    onClick={() => openUrl(expUrl)}
                  >
                    Explorer ↗
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {data?.candidates?.length > 0 && (
        <>
          <div className="smi-subhead" style={{ marginTop: 20 }}>{t('sm.engine.underEvaluation')}</div>
          <CandidateRows rows={data.candidates.slice(0, 8)} />
        </>
      )}
      <p className="smi-footnote">{t('sm.engine.whaleNotSmart')}</p>
    </section>
  );
}

/** Analysed wallets with their MEASURED stats */
function CandidateRows({ rows }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="smi-candidates-grid">
      {rows.map((w) => {
        const expUrl = walletExplorerUrl(w.chain, w.address);
        return (
          <div key={`${w.chain}:${w.address}`} className="smi-candidate-box">
            <div className="smi-candidate-top">
              <span className={`smi-rank-pill ${w.qualified ? 'ok' : 'pending'}`}>
                {w.qualified ? '✓' : '●'}
              </span>
              <div className="smi-cand-name" onClick={() => navigate(`/smart-money/wallet/${w.chain}/${w.address}`)}>
                <strong className="mono">{w.label || shortAddr(w.address)}</strong>
                <small>{chainName(w.chain)} · {w.kind || 'EOA'}</small>
              </div>
              <div className="smi-cand-score">
                <b>{w.score ?? '—'}</b>
                <small>{w.qualified ? t('sm.engine.qualifiedShort') : t(`sm.engine.status.${w.status}`, { defaultValue: w.status })}</small>
              </div>
            </div>
            <div className="smi-cand-meta">
              <span>{w.closedTrades} {t('sm.engine.closes')}</span>
              <span>{t('sm.engine.winRate')} {pct(w.winRate)}</span>
              <span>{w.swaps} {t('sm.engine.receiptsShort')}</span>
              {expUrl && (
                <button type="button" className="smi-cand-exp" onClick={() => openUrl(expUrl)}>
                  Proof ↗
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Real paired fills with tx receipts, newest first */
function ReceiptFeed({ rows }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!rows?.length) return <p className="smi-sub">{t('sm.engine.noReceipts')}</p>;

  return (
    <div className="smi-feed">
      {rows.map((r) => {
        const url = txUrl(r.chain, r.hash);
        return (
          <div className="smi-feed-row" key={`${r.hash}:${r.token}:${r.wallet}`}>
            <span className={`smi-side ${r.side === 'BUY' ? 'up' : 'down'}`}>
              {r.side === 'BUY' ? t('sm.engine.buyShort') : t('sm.engine.sellShort')}
            </span>
            <div className="smi-feed-icon">
              <TokenIcon
                token={{ symbol: r.symbol, address: r.token, tokenLogo: r.tokenLogo || r.icon }}
                chainId={r.chain}
                size={28}
              />
            </div>
            <button
              type="button"
              className="smi-feed-main"
              onClick={() => navigate(`/smart-money/token/${r.chain}/${r.token}`)}
            >
              <div className="smi-feed-title">
                <strong>{r.symbol}</strong>
                <b className={r.side === 'BUY' ? 'sm-up' : 'sm-down'}>{fmtUsd(r.valueUsd)}</b>
              </div>
              <small>
                {chainName(r.chain)} · {timeAgo(r.at)}
                {r.qualified ? ` · ${t('sm.engine.qualifiedShort')}` : ''}
                {r.realizedRoiPct != null ? ` · ROI ${r.realizedRoiPct > 0 ? '+' : ''}${r.realizedRoiPct}%` : ''}
              </small>
            </button>
            <button
              type="button"
              className="smi-feed-wallet"
              onClick={() => navigate(`/smart-money/wallet/${r.chain}/${r.wallet}`)}
            >
              {shortAddr(r.wallet)}
            </button>
            {url && (
              <button type="button" className="smi-proof" onClick={() => openUrl(url)}>
                {t('sm.engine.proof')} ↗
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** SVG view of real graph edges */
function TokenGraph({ data, tokenRow }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const edges = (data?.graph?.edges || [])
    .filter((e) => e.to === `${tokenRow.chain}:${tokenRow.token}`)
    .sort((a, b) => b.buyUsd + b.sellUsd - a.buyUsd - a.sellUsd).slice(0, 6);
  const nodes = new Map((data?.graph?.nodes || []).map((n) => [n.id, n]));
  const points = edges.map((edge, i) => ({
    ...edge,
    x: i % 2 === 0 ? 42 : 318,
    y: 39 + Math.floor(i / 2) * 83,
    wallet: nodes.get(edge.from)
  }));
  const openWallet = (edge) => edge.wallet && navigate(`/smart-money/wallet/${edge.wallet.chain}/${edge.wallet.address}`);

  return (
    <div className="smi-graph-panel">
      <div className="smi-graph-title">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TokenIcon
            token={{ symbol: tokenRow.symbol, address: tokenRow.token, tokenLogo: tokenRow.tokenLogo || tokenRow.icon }}
            chainId={tokenRow.chain}
            size={24}
          />
          <span>{t('sm.engine.graphTitle')}</span>
        </div>
        <small>{chainName(tokenRow.chain)} · {shortAddr(tokenRow.token)}</small>
      </div>
      {points.length > 0 ? (
        <svg className="smi-graph" viewBox="0 0 360 280" role="img" aria-label={t('sm.engine.graphAlt', { n: points.length, token: tokenRow.symbol })}>
          <defs>
            <radialGradient id="smi-core">
              <stop stopColor="#3459ab" />
              <stop offset="1" stopColor="#0d1831" />
            </radialGradient>
          </defs>
          {points.map((p) => (
            <path
              key={`line:${p.from}`}
              d={`M ${p.x} ${p.y} Q 180 ${p.y} 180 139`}
              fill="none"
              stroke={p.buyUsd >= p.sellUsd ? '#48dca8' : '#fd789a'}
              strokeOpacity=".72"
              strokeWidth={Math.min(4, Math.max(1.4, (p.buyUsd + p.sellUsd) / 100_000))}
            />
          ))}
          <circle cx="180" cy="139" r="38" fill="url(#smi-core)" stroke="#92b3ff" strokeWidth="1.5" />
          <text x="180" y="144" className="smi-svg-core" textAnchor="middle">{String(tokenRow.symbol || 'TOKEN').slice(0, 8)}</text>
          {points.map((p) => (
            <g
              key={p.from}
              role="button"
              tabIndex="0"
              aria-label={`${p.wallet?.label || shortAddr(p.wallet?.address)} ${fmtUsd(p.buyUsd - p.sellUsd)}`}
              className="smi-svg-wallet"
              onClick={() => openWallet(p)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWallet(p); } }}
            >
              <title>{p.wallet?.label || p.wallet?.address} · {fmtUsd(p.buyUsd)} {t('sm.engine.buy')} / {fmtUsd(p.sellUsd)} {t('sm.engine.sell')}</title>
              <circle cx={p.x} cy={p.y} r="22" fill="#192841" stroke={p.buyUsd >= p.sellUsd ? '#48dca8' : '#fd789a'} strokeWidth="1.5" />
              <text x={p.x} y={p.y + 4} className="smi-svg-initial" textAnchor="middle">{p.wallet?.score ?? '—'}</text>
            </g>
          ))}
        </svg>
      ) : <p className="smi-sub">{t('sm.engine.graphEmpty')}</p>}
      <div className="smi-receipts">
        {points.map((p) => (
          <div className="smi-receipt" key={`receipt:${p.from}`}>
            <button type="button" onClick={() => openWallet(p)}>
              <strong>{p.wallet?.label || shortAddr(p.wallet?.address)}</strong>
              <small>{chainName(p.wallet?.chain)} · {t('sm.engine.score')} {p.wallet?.score ?? '—'}</small>
            </button>
            <span className={p.buyUsd >= p.sellUsd ? 'sm-up' : 'sm-down'}>
              {p.buyUsd >= p.sellUsd ? '+' : '−'}{fmtUsd(Math.abs(p.buyUsd - p.sellUsd))}
            </span>
            {p.hashes?.[0] && txUrl(p.wallet?.chain, p.hashes[0]) && (
              <button type="button" className="smi-proof" onClick={() => openUrl(txUrl(p.wallet?.chain, p.hashes[0]))}>
                {t('sm.engine.proof')} ↗
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="smi-footnote">{t('sm.engine.graphNote')}</p>
    </div>
  );
}

function FollowRule({ row, onIntent }) {
  const { t } = useTranslation();
  const [minimum, setMinimum] = useState(3);
  const [following, setFollowing] = useState(() => getTracked().some((w) => w.target === 'token' && w.chain === row.chain && w.address === row.token));
  const follow = () => {
    trackWallet({
      chain: row.chain,
      address: row.token,
      target: 'token',
      label: row.symbol,
      types: ['CONSENSUS_BUY', 'CONSENSUS_SELL', 'NETFLOW_REVERSAL'],
      condition: { minWallets: minimum, confidence: 75, fromUsd: 5_000_000, toUsd: -3_000_000 }
    });
    setFollowing(true);
  };

  return (
    <div className="smi-follow">
      <div>
        <strong>{t('sm.engine.watchTitle')}</strong>
        <small>{t('sm.engine.watchCondition', { n: minimum })}</small>
      </div>
      <label>
        {t('sm.engine.minWallets')}
        <select value={minimum} onChange={(e) => setMinimum(Number(e.target.value))} aria-label={t('sm.engine.minWallets')}>
          {[3, 4, 5, 6, 7, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="smi-follow-buttons">
        <button type="button" onClick={follow}>{following ? t('sm.engine.updateRule') : t('sm.engine.follow')}</button>
        <button type="button" className="secondary" onClick={() => onIntent(row)}>{t('sm.engine.intent')} ↗</button>
      </div>
      <small className="smi-note">{t('sm.engine.watchNote')}</small>
    </div>
  );
}

/** Interactive visual pipeline: "از رسید تا سیگنال قابل‌پیگیری" */
function PipelineVisualizer() {
  const { t } = useTranslation();
  const [activeStep, setActiveStep] = useState('chain');

  const steps = [
    {
      id: 'chain',
      title: t('sm.engine.pipeline.chain'),
      icon: '⛓️',
      badge: t('sm.engine.pipeline.chainBadge'),
      desc: t('sm.engine.pipeline.chainDesc')
    },
    {
      id: 'ledger',
      title: t('sm.engine.pipeline.ledger'),
      icon: '📑',
      badge: t('sm.engine.pipeline.ledgerBadge'),
      desc: t('sm.engine.pipeline.ledgerDesc')
    },
    {
      id: 'score',
      title: t('sm.engine.pipeline.score'),
      icon: '🎯',
      badge: t('sm.engine.pipeline.scoreBadge'),
      desc: t('sm.engine.pipeline.scoreDesc')
    },
    {
      id: 'consensus',
      title: t('sm.engine.pipeline.consensus'),
      icon: '🤝',
      badge: t('sm.engine.pipeline.consensusBadge'),
      desc: t('sm.engine.pipeline.consensusDesc')
    },
    {
      id: 'intent',
      title: t('sm.engine.pipeline.intent'),
      icon: '⚡',
      badge: t('sm.engine.pipeline.intentBadge'),
      desc: t('sm.engine.pipeline.intentDesc')
    }
  ];

  const current = steps.find((s) => s.id === activeStep) || steps[0];

  return (
    <div className="smi-pipeline-box">
      <div className="smi-pipeline-rail">
        {steps.map((st, idx) => (
          <button
            key={st.id}
            type="button"
            className={`smi-pipe-btn ${activeStep === st.id ? 'active' : ''}`}
            onClick={() => setActiveStep(st.id)}
          >
            <span className="smi-pipe-num">0{idx + 1}</span>
            <span className="smi-pipe-icon">{st.icon}</span>
            <span className="smi-pipe-label">{st.title}</span>
          </button>
        ))}
      </div>

      <div className="smi-pipe-detail">
        <div className="smi-pipe-detail-header">
          <div className="smi-pipe-detail-title">
            <span className="smi-pipe-detail-icon">{current.icon}</span>
            <div>
              <strong>{current.title}</strong>
              <small>{current.badge}</small>
            </div>
          </div>
          <span className="smi-pipe-step-tag">{t('sm.engine.pipeline.step', {
            step: steps.findIndex((s) => s.id === activeStep) + 1,
            total: steps.length
          })}</span>
        </div>
        <p className="smi-pipe-detail-desc">{current.desc}</p>
      </div>
    </div>
  );
}

export default function SmartMoneyIntelligence() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [win, setWin] = useState('24h');
  const [chain, setChain] = useState('all');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const load = useCallback((signal) => {
    setBusy(true);
    setError(null);
    fetchIntelligence(win, signal).then((d) => {
      if (signal.aborted) return;
      setData(d);
      setBusy(false);
    }).catch((e) => {
      if (signal.aborted) return;
      setError(e.message);
      setBusy(false);
    });
  }, [win]);

  const building = !data?.indexedAt || data?.refresh?.status === 'refreshing';

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    const ctrl = new AbortController();
    const interval = setInterval(() => load(ctrl.signal), building ? 20_000 : 90_000);
    return () => { clearInterval(interval); ctrl.abort(); };
  }, [load, building]);

  const rows = useMemo(() => (data?.consensus || []).filter((r) => chain === 'all' || String(r.chain) === chain), [data, chain]);
  const flow = useMemo(() => (data?.observed?.flow || []).filter((r) => chain === 'all' || String(r.chain) === chain), [data, chain]);
  const receipts = useMemo(() => (data?.observed?.recentSwaps || []).filter((r) => chain === 'all' || String(r.chain) === chain).slice(0, 15), [data, chain]);
  const candidates = useMemo(() => (data?.observed?.candidates || []).filter((r) => chain === 'all' || String(r.chain) === chain).slice(0, 10), [data, chain]);
  const earlyEntries = useMemo(() => (data?.earlyEntries || []).filter((e) => chain === 'all' || String(e.chain) === chain), [data, chain]);
  const note = refreshNote(t, data);
  const chosen = rows.find((r) => `${r.chain}:${r.token}` === selected) || rows[0] || null;
  const status = data?.indexedAt ? timeAgo(data.indexedAt) : t('sm.engine.notIndexed');
  const active = rows.filter((r) => r.confidence != null).length;
  const monitor = (row) => navigate(`/intent?smMonitor=${row.signal === 'DISTRIBUTION' ? 'sell' : 'buyers'}&smChain=${row.chain}&smToken=${encodeURIComponent(row.token)}&smSymbol=${encodeURIComponent(row.symbol || 'TOKEN')}`);

  return (
    <div className="smi-workspace" data-testid="sm-intelligence">
      <section className="smi-hero">
        <div className="smi-hero-glow" aria-hidden="true" />
        <div className="smi-eyebrow"><span className="smi-signal-dot" /> FBT / {t('sm.engine.label')}</div>
        <h2>{t('sm.engine.headline')}</h2>
        <p>{t('sm.engine.intro')}</p>
        <div className="smi-hero-stats">
          <div><span>{t('sm.engine.analysed')}</span><strong>{data?.coverage?.analyzedWallets ?? '—'}</strong></div>
          <div><span>{t('sm.engine.qualified')}</span><strong>{data?.coverage?.classifiedWallets ?? '—'}</strong></div>
          <div><span>{t('sm.engine.swaps')}</span><strong>{data?.coverage?.observedSwapsInWindow ?? data?.coverage?.swapsInWindow ?? '—'}</strong></div>
        </div>
        <div className="smi-stamp" aria-live="polite">
          {note && <span className="smi-live-dot" aria-hidden="true" />}
          {t('sm.engine.indexed')} · {status}
          {note ? ` · ${note}` : ''}
          {data && !data.durable ? ` · ${t('sm.engine.ephemeral')}` : ''}
        </div>
      </section>

      <div className="smi-controls">
        <div className="smi-window" role="group" aria-label={t('sm.windowAria')}>
          {WINDOWS.map((w) => (
            <button
              type="button"
              key={w}
              className={w === win ? 'active' : ''}
              onClick={() => setWin(w)}
              aria-pressed={w === win}
            >
              {t(`sm.engine.windows.${w}`)}
            </button>
          ))}
        </div>
        {/*
          ─── THE NETWORK BOX, BROUGHT IN LINE WITH EVERY OTHER ONE ──────────
          Reported: «در باکس انتخاب شبکه باید مانند بقیهٔ پاپ‌اپ‌های دیگر به‌روز
          و مدرن همراه با ایکون شبکه باشد و فیلد جستجو نمی‌خواهد».

          It was a native `<select>`: the operating system drew the list, so the
          networks had no marks, the open list looked nothing like the rest of
          the app, and on Android the sheet that appears is the platform's own.
          It is now the SAME picker as everywhere else — logo, full name, short
          tag, a check on the current one — and because this screen is a filter,
          not a transfer, `searchable` is left off: eight rows fit on any phone
          and a keyboard here would only cover them.
        */}
        <ModernSelect
          value={chain}
          onChange={(v) => { setChain(String(v)); setSelected(null); }}
          options={[
            {
              value: 'all',
              label: t('sm.engine.allChains'),
              /* The count, not a second copy of the label: the row says
                 "all networks" and this says how many that actually is. */
              sublabel: t('sm.engine.networkCount', {
                n: CHAIN_OPTIONS.filter((c) => c.id !== 'solana').length
              }),
              /* A globe, drawn here: the "all networks" row has no chain to
                 borrow a logo from, and a monogram («AL») would read as one. */
              iconNode: (
                <svg viewBox="0 0 24 24" width={30} height={30} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--rgb-1)' }}>
                  <circle cx="12" cy="12" r="8.6" />
                  <path d="M3.4 12h17.2" />
                  <path d="M12 3.4c2.3 2.4 3.5 5.3 3.5 8.6S14.3 18.2 12 20.6C9.7 18.2 8.5 15.3 8.5 12S9.7 5.8 12 3.4Z" />
                </svg>
              )
            },
            ...CHAIN_OPTIONS.filter((c) => c.id !== 'solana').map((c) => ({
              value: c.id,
              label: c.name,
              sublabel: c.short,
              chain: c.id
            }))
          ]}
          title={t('sm.engine.chain')}
          placeholder={t('sm.engine.allChains')}
          compact
          ariaLabel={t('sm.engine.chain')}
          testId="sm-chain-select"
        />
      </div>

      {busy && !data && <div className="sm-section"><div className="sm-skel" /><div className="sm-skel" /></div>}
      {error && (
        <div className="sm-section smi-error" role="alert">
          <span>{t('sm.engine.unavailable')}</span>
          <button type="button" onClick={() => { const ctrl = new AbortController(); load(ctrl.signal); }}>
            {t('sm.retry')}
          </button>
        </div>
      )}

      {data && (
        <>
          {/* 02 / سرمایه واقعاً کجا جابه‌جا شد؟ */}
          <section className="smi-section">
            <div className="smi-head">
              <div>
                <span className="smi-eyebrow">02 / {t('sm.engine.consensus')}</span>
                <h3>{t('sm.engine.where')}</h3>
              </div>
              <span className="smi-count">
                {rows.length} {t('sm.engine.observed')} · {active} {t('sm.engine.active')}
              </span>
            </div>

            {!rows.length && (
              <div className="smi-empty">
                <strong>{t('sm.engine.emptyTitle')}</strong>
                <p>{flow.length ? t('sm.engine.emptyBodySample') : t('sm.engine.emptyBody')}</p>
              </div>
            )}

            <div className="smi-consensus-list">
              {rows.map((r) => (
                <button
                  type="button"
                  key={`${r.chain}:${r.token}`}
                  className={`smi-consensus ${chosen === r ? 'selected' : ''}`}
                  aria-pressed={chosen === r}
                  onClick={() => setSelected(`${r.chain}:${r.token}`)}
                >
                  <div className="smi-token-avatar">
                    <TokenIcon
                      token={{ symbol: r.symbol, address: r.token, tokenLogo: r.tokenLogo || r.icon }}
                      chainId={r.chain}
                      size={36}
                    />
                  </div>
                  <span className="smi-token-body">
                    <strong>
                      {r.symbol}
                      <small>{chainName(r.chain)} · {shortAddr(r.token)}</small>
                    </strong>
                    <span className="smi-vote-track">
                      <i style={{ width: `${r.buyers + r.sellers ? Math.round(r.buyers / (r.buyers + r.sellers) * 100) : 0}%` }} />
                    </span>
                    <span className="smi-votes">
                      {r.buyers} {t('sm.engine.buy')} · {r.sellers} {t('sm.engine.sell')} · {r.independentVotes} {t('sm.engine.groups')}
                    </span>
                  </span>
                  <span className="smi-token-result">
                    <b className={r.netFlowUsd >= 0 ? 'sm-up' : 'sm-down'}>
                      {r.netFlowUsd >= 0 ? '+' : '−'}{fmtUsd(Math.abs(r.netFlowUsd))}
                    </b>
                    <small className={`smi-signal ${badge(r.signal)}`}>
                      {r.confidence == null ? t('sm.engine.insufficient') : `${t(`sm.engine.signal.${r.signal}`)} · ${r.confidence}/100`}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <p className="smi-footnote">{t('sm.engine.consensusNote')}</p>
          </section>

          {chosen && (
            <section className="smi-section smi-detail">
              <div className="smi-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <TokenIcon
                    token={{ symbol: chosen.symbol, address: chosen.token, tokenLogo: chosen.tokenLogo || chosen.icon }}
                    chainId={chosen.chain}
                    size={32}
                  />
                  <div>
                    <span className="smi-eyebrow">02b / {t('sm.engine.graph')}</span>
                    <h3>{chosen.symbol} <small>· {chainName(chosen.chain)}</small></h3>
                  </div>
                </div>
                <button className="smi-link" type="button" onClick={() => navigate(`/smart-money/token/${chosen.chain}/${chosen.token}`)}>
                  {t('sm.analyze')} ↗
                </button>
              </div>
              <div className="smi-detail-metrics">
                <div>
                  <small>{t('sm.engine.inflow')}</small>
                  <strong className="sm-up">{fmtUsd(chosen.capitalEnteringUsd)}</strong>
                </div>
                <div>
                  <small>{t('sm.engine.outflow')}</small>
                  <strong className="sm-down">{fmtUsd(chosen.capitalExitingUsd)}</strong>
                </div>
                <div>
                  <small>{t('sm.engine.confidence')}</small>
                  <strong>{chosen.confidence == null ? '—' : `${chosen.confidence}/100`}</strong>
                </div>
              </div>
              <TokenGraph data={data} tokenRow={chosen} />
              <FollowRule key={`${chosen.chain}:${chosen.token}`} row={chosen} onIntent={monitor} />
            </section>
          )}

          {/* 03 / لایهٔ جریان مشاهده‌شده */}
          <section className="smi-section" data-testid="sm-observed-flow">
            <div className="smi-head">
              <div>
                <span className="smi-eyebrow">03 / {t('sm.engine.observedLayer')}</span>
                <h3>{t('sm.engine.observedFlowTitle')}</h3>
              </div>
              <span className="smi-count">{flow.length} {t('sm.engine.observed')}</span>
            </div>
            {!flow.length && <p className="smi-sub">{data.indexedAt ? t('sm.engine.noObservedFlow') : (note || t('sm.engine.notIndexed'))}</p>}
            <div className="smi-consensus-list">
              {flow.slice(0, 12).map((r) => (
                <button
                  type="button"
                  key={`flow:${r.chain}:${r.token}`}
                  className="smi-consensus"
                  onClick={() => navigate(`/smart-money/token/${r.chain}/${r.token}`)}
                >
                  <div className="smi-token-avatar">
                    <TokenIcon
                      token={{ symbol: r.symbol, address: r.token, tokenLogo: r.tokenLogo || r.icon }}
                      chainId={r.chain}
                      size={36}
                    />
                  </div>
                  <span className="smi-token-body">
                    <strong>{r.symbol}<small>{chainName(r.chain)} · {shortAddr(r.token)}</small></strong>
                    <span className="smi-vote-track">
                      <i style={{ width: `${r.buyUsd + r.sellUsd ? Math.round(r.buyUsd / (r.buyUsd + r.sellUsd) * 100) : 0}%` }} />
                    </span>
                    <span className="smi-votes">
                      {r.buyers} {t('sm.engine.buy')} · {r.sellers} {t('sm.engine.sell')} · {r.swaps} {t('sm.engine.receiptsShort')}
                      {r.qualifiedWallets ? ` · ${r.qualifiedWallets} ${t('sm.engine.qualifiedShort')}` : ''}
                    </span>
                  </span>
                  <span className="smi-token-result">
                    <b className={r.netFlowUsd >= 0 ? 'sm-up' : 'sm-down'}>
                      {r.netFlowUsd >= 0 ? '+' : '−'}{fmtUsd(Math.abs(r.netFlowUsd))}
                    </b>
                    <small className="smi-signal idle">
                      {r.currentPriceUsd != null ? fmtPrice(r.currentPriceUsd) : t('sm.engine.notConsensus')}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <p className="smi-footnote">{t('sm.engine.observedNote')}</p>
          </section>

          {/* 04 / معاملات جفت‌شدهٔ کیف‌پول‌های تحلیل‌شده (دفتر رسیدها) */}
          <section className="smi-section" data-testid="sm-receipts">
            <div className="smi-head">
              <div>
                <span className="smi-eyebrow">04 / {t('sm.engine.ledger')}</span>
                <h3>{t('sm.engine.receiptsTitle')}</h3>
              </div>
              <span className="smi-count">{receipts.length} {t('sm.engine.receiptsShort', { defaultValue: 'معامله' })}</span>
            </div>
            <ReceiptFeed rows={receipts} />
            <p className="smi-footnote">{t('sm.engine.receiptsNote')}</p>
          </section>

          {/* 05 / کیف‌پول‌های در حال ارزیابی */}
          {candidates.length > 0 && (
            <section className="smi-section" data-testid="sm-candidates">
              <div className="smi-head">
                <div>
                  <span className="smi-eyebrow">05 / {t('sm.engine.evidence')}</span>
                  <h3>{t('sm.engine.underEvaluation')}</h3>
                </div>
              </div>
              <CandidateRows rows={candidates} />
              <p className="smi-footnote">{t('sm.engine.candidatesNote')}</p>
            </section>
          )}

          {/* 06 / قیمت ورود در برابر قیمت فعلی */}
          <section className="smi-section">
            <div className="smi-head">
              <div>
                <span className="smi-eyebrow">06 / {t('sm.engine.discovery')}</span>
                <h3>{t('sm.engine.early')}</h3>
              </div>
              {earlyEntries.length > 0 && (
                <span className="smi-count">{earlyEntries.length} {t('sm.tokens', { defaultValue: 'توکن' })}</span>
              )}
            </div>
            {!earlyEntries.length && <p className="smi-sub">{t('sm.engine.noEarly')}</p>}

            <div className="smi-early-entries-grid">
              {earlyEntries.map((e) => (
                <div
                  key={`${e.chain}:${e.token}`}
                  className="smi-early-entry-card"
                  onClick={() => navigate(`/smart-money/token/${e.chain}/${e.token}`)}
                >
                  <div className="smi-entry-head">
                    <div className="smi-entry-avatar">
                      <TokenIcon
                        token={{ symbol: e.symbol, address: e.token, tokenLogo: e.icon || e.tokenLogo }}
                        chainId={e.chain}
                        size={32}
                      />
                    </div>
                    <div className="smi-entry-title">
                      <strong>{e.symbol}</strong>
                      <small>{chainName(e.chain)} · {e.wallets} {t('sm.engine.wallets')}</small>
                    </div>
                    <span className={`smi-entry-roi ${e.changePct == null ? '' : e.changePct >= 0 ? 'up' : 'down'}`}>
                      {e.changePct == null ? '—' : `${e.changePct > 0 ? '+' : ''}${e.changePct}%`}
                    </span>
                  </div>

                  <div className="smi-entry-prices">
                    <div className="smi-price-col">
                      <span className="k">{t('sm.engine.avgEntry')}</span>
                      <span className="v mono">{fmtPrice(e.averageEntryUsd)}</span>
                    </div>
                    <div className="smi-price-divider">→</div>
                    <div className="smi-price-col">
                      <span className="k">{t('sm.engine.now')}</span>
                      <span className="v mono">{fmtPrice(e.currentPriceUsd)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="smi-footnote">{t('sm.engine.earlyNote')}</p>
          </section>

          {/* 07 / از رسید تا سیگنال قابل‌پیگیری */}
          <section className="smi-section smi-method">
            <div className="smi-head">
              <div>
                <span className="smi-eyebrow">07 / {t('sm.engine.method')}</span>
                <h3>{t('sm.engine.methodTitle')}</h3>
              </div>
            </div>

            <PipelineVisualizer />

            <p>{t('sm.engine.methodNote')}</p>
            <div className="smi-method-pills">
              <span>{t('sm.engine.identityCaveat')}</span>
              <span>{t('sm.engine.noAutoTrade')}</span>
              <span>{t('sm.engine.notRealtime')}</span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
