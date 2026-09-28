import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { fetchIntelligence, fetchVerifiedWallets, fmtUsd, shortAddr, timeAgo, CHAIN_OPTIONS } from '../lib/smartMoneyClient';
import { getTracked, trackWallet } from '../lib/smartMoneyWatch';
import { openUrl } from '../lib/browser';

const WINDOWS = ['30m', '24h', '7d'];
const badge = (signal) => signal === 'ACCUMULATION' ? 'up' : signal === 'DISTRIBUTION' ? 'down' : 'idle';
const chainName = (id) => CHAIN_OPTIONS.find((c) => String(c.id) === String(id))?.short || String(id);

/** Honest top-of-overview handoff: this uses the overview's indexed evidence;
 * no extra RPC calls or fake prices while the user reads the whale feed. */
export function IntelligenceTeaser({ verified, onOpen }) {
  const { t } = useTranslation();
  const active = (verified?.consensus || []).filter((r) => r.confidence != null);
  return (
    <section className="smi-teaser" aria-label={t('sm.engine.title')}>
      <div className="smi-teaser-mark" aria-hidden="true">◇</div>
      <div className="smi-teaser-copy">
        <strong>{t('sm.engine.title')}</strong>
        <span>{active.length ? t('sm.engine.activeCount', { n: active.length }) : t('sm.engine.noConsensus')}</span>
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
  useEffect(() => {
    const ctrl = new AbortController();
    fetchVerifiedWallets(ctrl.signal).then(setData).catch(() => { if (!ctrl.signal.aborted) setError(true); });
    return () => ctrl.abort();
  }, []);
  return (
    <section className="sm-section smi-board" aria-label={t('sm.engine.verifiedBoard')}>
      <div className="smi-head"><div><span className="smi-eyebrow">01 / {t('sm.engine.evidence')}</span><h3>{t('sm.engine.verifiedBoard')}</h3></div></div>
      {error && <p className="smi-sub">{t('sm.engine.unavailable')}</p>}
      {!error && !data && <div className="sm-skel" />}
      {data && !data.wallets?.length && <p className="smi-sub">{t('sm.engine.noQualified')}</p>}
      {(data?.wallets || []).slice(0, 12).map((w, i) => (
        <button key={`${w.chain}:${w.address}`} className="smi-board-row" type="button"
          onClick={() => navigate(`/smart-money/wallet/${w.chain}/${w.address}`)}>
          <span className="smi-rank">{String(i + 1).padStart(2, '0')}</span>
          <span className="smi-board-person"><strong>{w.label || shortAddr(w.address)}</strong><small>{chainName(w.chain)} · {w.kind || t('sm.engine.behaviourOnly')} · {w.closedTrades} {t('sm.engine.closes')}</small></span>
          <span className="smi-board-score">{w.score}<small>/{Math.round(w.coverage * 100)}% {t('sm.engine.coverageShort')}</small></span>
        </button>
      ))}
      <p className="smi-footnote">{t('sm.engine.whaleNotSmart')}</p>
    </section>
  );
}

/** SVG is only a view of real graph edges. Accessible receipt rows underneath
 * provide the same links without relying on a touch-sized visualisation. */
function TokenGraph({ data, tokenRow }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const edges = (data?.graph?.edges || [])
    .filter((e) => e.to === `${tokenRow.chain}:${tokenRow.token}`)
    .sort((a, b) => b.buyUsd + b.sellUsd - a.buyUsd - a.sellUsd).slice(0, 6);
  const nodes = new Map((data?.graph?.nodes || []).map((n) => [n.id, n]));
  const points = edges.map((edge, i) => ({ ...edge,
    x: i % 2 === 0 ? 42 : 318,
    y: 39 + Math.floor(i / 2) * 83, wallet: nodes.get(edge.from) }));
  const openWallet = (edge) => edge.wallet && navigate(`/smart-money/wallet/${edge.wallet.chain}/${edge.wallet.address}`);
  return (
    <div className="smi-graph-panel">
      <div className="smi-graph-title"><span>{t('sm.engine.graphTitle')}</span><small>{chainName(tokenRow.chain)} · {shortAddr(tokenRow.token)}</small></div>
      {points.length > 0 ? (
        <svg className="smi-graph" viewBox="0 0 360 280" role="img" aria-label={t('sm.engine.graphAlt', { n: points.length, token: tokenRow.symbol })}>
          <defs><radialGradient id="smi-core"><stop stopColor="#3459ab" /><stop offset="1" stopColor="#0d1831" /></radialGradient></defs>
          {points.map((p) => <path key={`line:${p.from}`} d={`M ${p.x} ${p.y} Q 180 ${p.y} 180 139`}
            fill="none" stroke={p.buyUsd >= p.sellUsd ? '#48dca8' : '#fd789a'} strokeOpacity=".72"
            strokeWidth={Math.min(4, Math.max(1.4, (p.buyUsd + p.sellUsd) / 100_000))} />)}
          <circle cx="180" cy="139" r="38" fill="url(#smi-core)" stroke="#92b3ff" strokeWidth="1.5" />
          <text x="180" y="144" className="smi-svg-core" textAnchor="middle">{String(tokenRow.symbol || 'TOKEN').slice(0, 8)}</text>
          {points.map((p) => <g key={p.from} role="button" tabIndex="0" aria-label={`${p.wallet?.label || shortAddr(p.wallet?.address)} ${fmtUsd(p.buyUsd - p.sellUsd)}`}
            className="smi-svg-wallet" onClick={() => openWallet(p)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWallet(p); } }}>
            <title>{p.wallet?.label || p.wallet?.address} · {fmtUsd(p.buyUsd)} {t('sm.engine.buy')} / {fmtUsd(p.sellUsd)} {t('sm.engine.sell')}</title>
            <circle cx={p.x} cy={p.y} r="22" fill="#192841" stroke={p.buyUsd >= p.sellUsd ? '#48dca8' : '#fd789a'} strokeWidth="1.5" />
            <text x={p.x} y={p.y + 4} className="smi-svg-initial" textAnchor="middle">{p.wallet?.score ?? '—'}</text>
          </g>)}
        </svg>
      ) : <p className="smi-sub">{t('sm.engine.graphEmpty')}</p>}
      <div className="smi-receipts">
        {points.map((p) => <div className="smi-receipt" key={`receipt:${p.from}`}>
          <button type="button" onClick={() => openWallet(p)}><strong>{p.wallet?.label || shortAddr(p.wallet?.address)}</strong><small>{chainName(p.wallet?.chain)} · {t('sm.engine.score')} {p.wallet?.score ?? '—'}</small></button>
          <span className={p.buyUsd >= p.sellUsd ? 'sm-up' : 'sm-down'}>{p.buyUsd >= p.sellUsd ? '+' : '−'}{fmtUsd(Math.abs(p.buyUsd - p.sellUsd))}</span>
          {p.hashes?.[0] && <button type="button" className="smi-proof" onClick={() => {
            const base = CHAIN_OPTIONS.find((c) => c.id === p.wallet?.chain);
            const explorers = { 1: 'https://etherscan.io', 56: 'https://bscscan.com', 137: 'https://polygonscan.com', 42161: 'https://arbiscan.io', 8453: 'https://basescan.org', 10: 'https://optimistic.etherscan.io', 43114: 'https://snowtrace.io' };
            if (base && explorers[base.id]) openUrl(`${explorers[base.id]}/tx/${p.hashes[0]}`);
          }}>{t('sm.engine.proof')} ↗</button>}
        </div>)}
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
    trackWallet({ chain: row.chain, address: row.token, target: 'token', label: row.symbol,
      types: ['CONSENSUS_BUY', 'CONSENSUS_SELL', 'NETFLOW_REVERSAL'],
      condition: { minWallets: minimum, confidence: 75, fromUsd: 5_000_000, toUsd: -3_000_000 } });
    setFollowing(true);
  };
  return <div className="smi-follow">
    <div><strong>{t('sm.engine.watchTitle')}</strong><small>{t('sm.engine.watchCondition', { n: minimum })}</small></div>
    <label>{t('sm.engine.minWallets')} <select value={minimum} onChange={(e) => setMinimum(Number(e.target.value))} aria-label={t('sm.engine.minWallets')}>
      {[3, 4, 5, 6, 7, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}
    </select></label>
    <div className="smi-follow-buttons">
      <button type="button" onClick={follow}>{following ? t('sm.engine.updateRule') : t('sm.engine.follow')}</button>
      <button type="button" className="secondary" onClick={() => onIntent(row)}>{t('sm.engine.intent')} ↗</button>
    </div>
    <small className="smi-note">{t('sm.engine.watchNote')}</small>
  </div>;
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
    setBusy(true); setError(null);
    fetchIntelligence(win, signal).then((d) => {
      if (signal.aborted) return;
      setData(d); setBusy(false);
    }).catch((e) => {
      if (signal.aborted) return;
      setError(e.message); setBusy(false);
    });
  }, [win]);
  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    const interval = setInterval(() => load(ctrl.signal), 90_000);
    return () => { clearInterval(interval); ctrl.abort(); };
  }, [load]);
  const rows = useMemo(() => (data?.consensus || []).filter((r) => chain === 'all' || String(r.chain) === chain), [data, chain]);
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
          <div><span>{t('sm.engine.qualified')}</span><strong>{data?.coverage?.classifiedWallets ?? '—'}</strong></div>
          <div><span>{t('sm.engine.active')}</span><strong>{data ? active : '—'}</strong></div>
          <div><span>{t('sm.engine.swaps')}</span><strong>{data?.coverage?.swapsInWindow ?? '—'}</strong></div>
        </div>
        <div className="smi-stamp">{t('sm.engine.indexed')} · {status}{data && !data.durable ? ` · ${t('sm.engine.ephemeral')}` : ''}</div>
      </section>

      <div className="smi-controls">
        <div className="smi-window" role="group" aria-label={t('sm.windowAria')}>
          {WINDOWS.map((w) => <button type="button" key={w} className={w === win ? 'active' : ''} onClick={() => setWin(w)} aria-pressed={w === win}>{t(`sm.engine.windows.${w}`)}</button>)}
        </div>
        <select value={chain} onChange={(e) => { setChain(e.target.value); setSelected(null); }} aria-label={t('sm.engine.chain')}>
          <option value="all">{t('sm.engine.allChains')}</option>
          {CHAIN_OPTIONS.filter((c) => c.id !== 'solana').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {busy && !data && <div className="sm-section"><div className="sm-skel" /><div className="sm-skel" /></div>}
      {error && <div className="sm-section smi-error" role="alert"><span>{t('sm.engine.unavailable')}</span><button type="button" onClick={() => { const ctrl = new AbortController(); load(ctrl.signal); }}>{t('sm.retry')}</button></div>}
      {data && <>
        <section className="smi-section">
          <div className="smi-head"><div><span className="smi-eyebrow">02 / {t('sm.engine.consensus')}</span><h3>{t('sm.engine.where')}</h3></div><span className="smi-count">{rows.length} {t('sm.engine.observed')}</span></div>
          {!rows.length && <div className="smi-empty"><strong>{t('sm.engine.emptyTitle')}</strong><p>{t('sm.engine.emptyBody')}</p></div>}
          <div className="smi-consensus-list">
            {rows.map((r) => <button type="button" key={`${r.chain}:${r.token}`} className={`smi-consensus ${chosen === r ? 'selected' : ''}`}
              aria-pressed={chosen === r} onClick={() => setSelected(`${r.chain}:${r.token}`)}>
              <span className={`smi-token-glyph ${badge(r.signal)}`}>{String(r.symbol || '?').slice(0, 1)}</span>
              <span className="smi-token-body"><strong>{r.symbol}<small>{chainName(r.chain)} · {shortAddr(r.token)}</small></strong>
                <span className="smi-vote-track"><i style={{ width: `${r.buyers + r.sellers ? Math.round(r.buyers / (r.buyers + r.sellers) * 100) : 0}%` }} /></span>
                <span className="smi-votes">{r.buyers} {t('sm.engine.buy')} · {r.sellers} {t('sm.engine.sell')} · {r.independentVotes} {t('sm.engine.groups')}</span>
              </span>
              <span className="smi-token-result"><b className={r.netFlowUsd >= 0 ? 'sm-up' : 'sm-down'}>{r.netFlowUsd >= 0 ? '+' : '−'}{fmtUsd(Math.abs(r.netFlowUsd))}</b>
                <small className={`smi-signal ${badge(r.signal)}`}>{r.confidence == null ? t('sm.engine.insufficient') : `${t(`sm.engine.signal.${r.signal}`)} · ${r.confidence}/100`}</small>
              </span>
            </button>)}
          </div>
          <p className="smi-footnote">{t('sm.engine.consensusNote')}</p>
        </section>

        {chosen && <section className="smi-section smi-detail">
          <div className="smi-head"><div><span className="smi-eyebrow">03 / {t('sm.engine.graph')}</span><h3>{chosen.symbol} <small>· {chainName(chosen.chain)}</small></h3></div>
            <button className="smi-link" type="button" onClick={() => navigate(`/smart-money/token/${chosen.chain}/${chosen.token}`)}>{t('sm.analyze')} ↗</button></div>
          <div className="smi-detail-metrics"><div><small>{t('sm.engine.inflow')}</small><strong className="sm-up">{fmtUsd(chosen.capitalEnteringUsd)}</strong></div>
            <div><small>{t('sm.engine.outflow')}</small><strong className="sm-down">{fmtUsd(chosen.capitalExitingUsd)}</strong></div>
            <div><small>{t('sm.engine.confidence')}</small><strong>{chosen.confidence == null ? '—' : `${chosen.confidence}/100`}</strong></div></div>
          <TokenGraph data={data} tokenRow={chosen} />
          <FollowRule key={`${chosen.chain}:${chosen.token}`} row={chosen} onIntent={monitor} />
        </section>}

        <section className="smi-section">
          <div className="smi-head"><div><span className="smi-eyebrow">04 / {t('sm.engine.discovery')}</span><h3>{t('sm.engine.early')}</h3></div></div>
          {!data.earlyEntries?.length && <p className="smi-sub">{t('sm.engine.noEarly')}</p>}
          <div className="smi-early-list">{(data.earlyEntries || []).map((e) => <button key={`${e.chain}:${e.token}`} type="button"
            onClick={() => navigate(`/smart-money/token/${e.chain}/${e.token}`)}>
            <div><strong>{e.symbol}</strong><small>{chainName(e.chain)} · {e.wallets} {t('sm.engine.wallets')}</small></div>
            <div><small>{t('sm.engine.avgEntry')}</small><b>{e.averageEntryUsd != null ? `$${Number(e.averageEntryUsd).toPrecision(4)}` : '—'}</b></div>
            <div><small>{t('sm.engine.now')}</small><b>{e.currentPriceUsd != null ? `$${Number(e.currentPriceUsd).toPrecision(4)}` : '—'}</b></div>
            <span className={e.changePct == null ? '' : e.changePct >= 0 ? 'sm-up' : 'sm-down'}>{e.changePct == null ? '—' : `${e.changePct > 0 ? '+' : ''}${e.changePct}%`}</span>
          </button>)}</div>
          <p className="smi-footnote">{t('sm.engine.earlyNote')}</p>
        </section>

        <section className="smi-section smi-method"><span className="smi-eyebrow">05 / {t('sm.engine.method')}</span><h3>{t('sm.engine.methodTitle')}</h3>
          <div className="smi-pipeline">{['chain', 'ledger', 'score', 'consensus', 'intent'].map((step) => <span key={step}>{t(`sm.engine.pipeline.${step}`)}</span>)}</div>
          <p>{t('sm.engine.methodNote')}</p>
          <div className="smi-method-pills"><span>{t('sm.engine.identityCaveat')}</span><span>{t('sm.engine.noAutoTrade')}</span><span>{t('sm.engine.notRealtime')}</span></div>
        </section>
      </>}
    </div>
  );
}
