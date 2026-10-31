import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { fetchIntelligence, fetchVerifiedWallets, fmtUsd, shortAddr, timeAgo, CHAIN_OPTIONS } from '../lib/smartMoneyClient';
import { getTracked, trackWallet } from '../lib/smartMoneyWatch';
import { openUrl } from '../lib/browser';
import TokenIcon from '../lib/tokenIcon';
import ModernSelect from './ModernSelect';
import CopyTradeButton from './smart-money/CopyTradeButton';
import { pollWhileVisible } from '../lib/visibilityPoll';
import {
  SmSignalGlyph, SmWavesGlyph, SmCoinGlyph, SmPulseGlyph, SmSparkGlyph,
  SmVerifiedGlyph, SmBankGlyph
} from './smart-money/SmGlyphs';
import { IconArrowUpRight } from './Icons';

/* 1h/4h joined the rail (upgrade 2026-10-25): buildConsensus already accepts
   every WINDOW_KEYS entry, so these windows cost no new server work — the
   30m→24h jump was simply too coarse to see intraday rotation. 30d is
   deliberately absent: the verified index retains 7 days, so a «30d»
   consensus would silently be a 7-day sample wearing a 30-day label. */
const WINDOWS = ['30m', '1h', '4h', '24h', '7d'];

/* FlowSpark / TrendChip live in ./smartMoneyVisuals.jsx (dependency-light) so
   the per-token card can use them without importing this whole workspace. */
export { FlowSpark, TrendChip } from './smartMoneyVisuals';
import { FlowSpark, TrendChip } from './smartMoneyVisuals';

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
      <div className="smi-teaser-mark" aria-hidden="true"><SmVerifiedGlyph width={22} height={22} /></div>
      <div className="smi-teaser-copy">
        <strong>{t('sm.engine.title')}</strong>
        <span>{active.length ? t('sm.engine.activeCount', { n: active.length })
          : verified?.coverage?.analyzedWallets ? t('sm.engine.teaserSample', { wallets: verified.coverage.analyzedWallets, swaps: verified.coverage.observedSwaps ?? 0 })
            : t('sm.engine.noConsensus')}</span>
        {/* The three strongest names, not just a count: «۳ سیگنال» told the
            reader nothing they could act on, while the symbols + evidence
            strength are the actual answer this card exists to hand over. */}
        {active.length > 0 && (
          <span className="smi-teaser-chips">
            {active.slice(0, 3).map((r) => (
              <span
                key={`${r.chain}:${r.token}`}
                className={`smi-teaser-chip ${r.signal === 'DISTRIBUTION' ? 'is-down' : 'is-up'}`}
              >
                <b>{r.symbol || shortAddr(r.token)}</b>
                <i>{r.confidence}</i>
              </span>
            ))}
          </span>
        )}
      </div>
      <button type="button" onClick={onOpen}>{t('sm.engine.open')} <IconArrowUpRight width={11} height={11} aria-hidden="true" /></button>
    </section>
  );
}

export function VerifiedWallets() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [walletSort, setWalletSort] = useState('score');
  /*
   * «هوش تایید شده برای کیف پول واجد شرایط داده ندارد» — the board used to
   * fetch ONCE. An empty answer on a fresh server is usually a mid-index
   * pass, not a finished verdict, so the reader inherited a static empty board
   * forever. It now re-asks every 30s while it has nothing to show, and while
   * empty it prints WHAT the engine has seen so far — analysed wallets and
   * on-chain receipts — instead of a one-line shrug.
   *
   * Upgrade 2026-10-25: polling used to STOP the moment a wallet qualified,
   * so a board left open froze at its first answer while the index kept
   * qualifying wallets behind it. A populated board now keeps refreshing,
   * just at a calmer 120s cadence.
   */
  useEffect(() => {
    let alive = true;
    const ctrl = new AbortController();
    const stateRef = { empty: true, lastFetchAt: 0 };
    const run = () => {
      stateRef.lastFetchAt = Date.now();
      return fetchVerifiedWallets(ctrl.signal)
        .then((d) => {
          if (!alive) return;
          setData(d);
          stateRef.empty = !(d?.wallets?.length > 0);
        })
        .catch(() => {
          if (alive && !ctrl.signal.aborted) setError(true);
        });
    };
    setError(false);
    run();
    /* Same rule as everywhere else, through one helper: no reads from a hidden
       tab, one immediate run when it comes back (lib/visibilityPoll.js).
       That immediate run goes through `run` directly so a stale board is
       fresh the moment the tab is seen again. */
    const stopPoll = pollWhileVisible(() => {
      if (ctrl.signal.aborted) return;
      const due = stateRef.empty ? 30_000 : 120_000;
      if (Date.now() - stateRef.lastFetchAt >= due - 1_000) run();
    }, 30_000);
    return () => {
      alive = false;
      ctrl.abort();
      stopPoll();
    };
  }, []);

  const sortedWallets = useMemo(() => {
    const rows = [...(data?.wallets || [])];
    const by = {
      score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
      winRate: (a, b) => (b.winRate ?? -1) - (a.winRate ?? -1),
      realized: (a, b) => (b.realizedUsd ?? -Infinity) - (a.realizedUsd ?? -Infinity),
      closes: (a, b) => (b.closedTrades ?? 0) - (a.closedTrades ?? 0)
    }[walletSort] || (() => 0);
    return rows.sort(by);
  }, [data, walletSort]);

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
        {data?.wallets?.length > 1 && (
          <label className="smi-sort">
            {t('sm.engine.sortBy')}
            <select value={walletSort} onChange={(e) => setWalletSort(e.target.value)} aria-label={t('sm.engine.sortBy')} data-testid="sm-wallet-sort">
              <option value="score">{t('sm.engine.score')}</option>
              <option value="winRate">{t('sm.engine.winRate')}</option>
              <option value="realized">{t('sm.engine.realized')}</option>
              <option value="closes">{t('sm.engine.closes')}</option>
            </select>
          </label>
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
        {sortedWallets.slice(0, 15).map((w, i) => {
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

              {/* WHAT the score was measured on. A number with no sample size
                  behind it is the «اطلاعات ناکافی» the board was reported for;
                  these four facts make the confidence auditable in place. */}
              <div className="smi-wcard-sample">
                <span>
                  {t('sm.engine.observedDays')}
                  <b className="mono">{w.sample?.observedDays ?? '—'}</b>
                </span>
                <span>
                  {t('sm.engine.sampleSwaps')}
                  <b className="mono">{w.sample?.swaps ?? '—'}</b>
                </span>
                <span>
                  {t('sm.engine.measuredCoverage')}
                  <b className="mono">{w.measuredCoverage != null ? `${Math.round(w.measuredCoverage * 100)}%` : '—'}</b>
                </span>
                <span>
                  {t('sm.engine.lastMeasured')}
                  <b>{w.updatedAt ? timeAgo(w.updatedAt) : '—'}</b>
                </span>
              </div>

              <div className="smi-wcard-actions">
                <button
                  type="button"
                  className="smi-btn-analyze"
                  onClick={() => navigate(`/smart-money/wallet/${w.chain}/${w.address}`)}
                >
                  {t('sm.analyze', { defaultValue: 'تحلیل کیف‌پول' })} <IconArrowUpRight width={11} height={11} aria-hidden="true" />
                </button>
                {expUrl && (
                  <button
                    type="button"
                    className="smi-btn-explorer"
                    title={t('sm.engine.source', { defaultValue: 'مشاهده در کاوشگر' })}
                    onClick={() => openUrl(expUrl)}
                  >
                    Explorer <IconArrowUpRight width={11} height={11} aria-hidden="true" />
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
                  Proof <IconArrowUpRight width={11} height={11} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Real paired fills with tx receipts, newest first.
 *
 * ─── THE ROW IS ONE LINE AGAIN (2026-10-31) ─────────────────────────────────
 * Reported: «آخرین رسیدهای معاملهٔ تأییدشده … در هر ردیف یک رسید هست که فاصله
 * زیاده و خیلی به‌هم‌ریخته است؛ فاصله و اندازه را درست کن». Every part of that
 * complaint was one layout bug: the row was a wrapping flex with six children
 * (side pill, icon, main, wallet tag, copy CTA, proof link). As soon as the copy
 * CTA joined, the six could not fit a phone, so `flex-wrap` turned each receipt
 * into two or three ragged lines with a 6px row-gap — an address here, a button
 * there, and a receipt list that read as a mess of paragraphs.
 *
 * The row is now a four-track grid that cannot wrap:
 *
 *     [side] [token] [symbol · amount · age ─────────] [actions]
 *
 * with the actions grouped into ONE cell (`smi-feed-actions`) so they size
 * against each other instead of each claiming a line. The amount moved up next
 * to the symbol (it is the number the row exists for), the ROI pill moved up
 * beside the age instead of floating as a third line, and the wallet tag is the
 * only thing allowed to disappear on a narrow screen — nothing else hides, and
 * the address is still one tap away through the row's own token page.
 */
function ReceiptFeed({ rows }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!rows?.length) return <p className="smi-sub">{t('sm.engine.noReceipts')}</p>;

  return (
    <div className="smi-feed">
      {rows.map((r) => {
        const url = txUrl(r.chain, r.hash);
        const buy = r.side === 'BUY';
        return (
          <div className="smi-feed-row" key={`${r.hash}:${r.token}:${r.wallet}`}>
            <span className={`smi-side ${buy ? 'up' : 'down'}`}>
              {buy ? t('sm.engine.buyShort') : t('sm.engine.sellShort')}
            </span>
            <span className="smi-feed-icon">
              <TokenIcon
                token={{ symbol: r.symbol, address: r.token, tokenLogo: r.tokenLogo || r.icon }}
                chainId={r.chain}
                size={26}
              />
            </span>
            {/* The whole middle cell is the tap target for the token page —
                one button, no nested controls, no dead pixels between them. */}
            <button
              type="button"
              className="smi-feed-main"
              onClick={() => navigate(`/smart-money/token/${r.chain}/${r.token}`)}
            >
              <span className="smi-feed-title">
                <strong>{r.symbol}</strong>
                <b className={buy ? 'sm-up' : 'sm-down'}>{fmtUsd(r.valueUsd)}</b>
              </span>
              <span className="smi-feed-meta">
                <small>
                  {chainName(r.chain)} · {timeAgo(r.at)}
                  {r.qualified ? ` · ${t('sm.engine.qualifiedShort')}` : ''}
                </small>
                {/* A realised ROI is the reason this row is interesting — it
                    gets its own pill, inline with the age, never a third line. */}
                {r.realizedRoiPct != null && (
                  <span className={`smi-roi ${r.realizedRoiPct >= 0 ? 'is-up' : 'is-down'}`}>
                    ROI {r.realizedRoiPct > 0 ? '+' : ''}{r.realizedRoiPct}%
                  </span>
                )}
              </span>
            </button>
            <div className="smi-feed-actions">
              <button
                type="button"
                className="smi-feed-wallet"
                onClick={() => navigate(`/smart-money/wallet/${r.chain}/${r.wallet}`)}
                title={r.wallet}
              >
                {shortAddr(r.wallet)}
              </button>
              {/* «کپی تراکنش»: the profitable fill the verification is based on,
                  one tap from here to the same token on the swap screen. */}
              <CopyTradeButton chain={r.chain} token={r.token} side={r.side} className="sm-copy--tight" />
              {url && (
                <button type="button" className="smi-proof" onClick={() => openUrl(url)}>
                  {t('sm.engine.proof')} <IconArrowUpRight width={10} height={10} aria-hidden="true" />
                </button>
              )}
            </div>
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
                {t('sm.engine.proof')} <IconArrowUpRight width={11} height={11} aria-hidden="true" />
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
  const [confidence, setConfidence] = useState(75);
  const [following, setFollowing] = useState(() => getTracked().some((w) => w.target === 'token' && w.chain === row.chain && w.address === row.token));
  const follow = () => {
    /* Reversal thresholds scale to THIS token's observed flow (upgrade
       2026-10-25). They were hardcoded at +$5M → −$3M: on a token whose
       whole qualified window is $200k the reversal leg could never arm, so
       the «follow» the user saved was born half-dead. Derived from the
       row's own |net| (floored so dust cannot arm it, capped at the old
       institutional size), and the evidence-strength bar is now the user's
       choice instead of a buried 75. */
    const base = Math.abs(row.netFlowUsd || 0);
    const fromUsd = Math.min(5_000_000, Math.max(25_000, Math.round(base * 0.8)));
    const toUsd = -Math.min(3_000_000, Math.max(25_000, Math.round(base * 0.5)));
    trackWallet({
      chain: row.chain,
      address: row.token,
      target: 'token',
      label: row.symbol,
      types: ['CONSENSUS_BUY', 'CONSENSUS_SELL', 'NETFLOW_REVERSAL', 'MOMENTUM_REVERSAL'],
      condition: { minWallets: minimum, confidence, fromUsd, toUsd }
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
      <label>
        {t('sm.engine.confidence')}
        <select value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} aria-label={t('sm.engine.confidence')} data-testid="sm-follow-confidence">
          {[60, 70, 75, 80, 85, 90].map((n) => <option key={n} value={n}>{n}/100</option>)}
        </select>
      </label>
      <div className="smi-follow-buttons">
        <button type="button" onClick={follow}>{following ? t('sm.engine.updateRule') : t('sm.engine.follow')}</button>
        <button type="button" className="secondary" onClick={() => onIntent(row)}>{t('sm.engine.intent')} <IconArrowUpRight width={11} height={11} aria-hidden="true" /></button>
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
      icon: SmWavesGlyph,
      badge: t('sm.engine.pipeline.chainBadge'),
      desc: t('sm.engine.pipeline.chainDesc')
    },
    {
      id: 'ledger',
      title: t('sm.engine.pipeline.ledger'),
      icon: SmBankGlyph,
      badge: t('sm.engine.pipeline.ledgerBadge'),
      desc: t('sm.engine.pipeline.ledgerDesc')
    },
    {
      id: 'score',
      title: t('sm.engine.pipeline.score'),
      icon: SmPulseGlyph,
      badge: t('sm.engine.pipeline.scoreBadge'),
      desc: t('sm.engine.pipeline.scoreDesc')
    },
    {
      id: 'consensus',
      title: t('sm.engine.pipeline.consensus'),
      icon: SmVerifiedGlyph,
      badge: t('sm.engine.pipeline.consensusBadge'),
      desc: t('sm.engine.pipeline.consensusDesc')
    },
    {
      id: 'intent',
      title: t('sm.engine.pipeline.intent'),
      icon: SmSignalGlyph,
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
            <span className="smi-pipe-icon" aria-hidden="true"><st.icon width={15} height={15} /></span>
            <span className="smi-pipe-label">{st.title}</span>
          </button>
        ))}
      </div>

      <div className="smi-pipe-detail">
        <div className="smi-pipe-detail-header">
          <div className="smi-pipe-detail-title">
            <span className="smi-pipe-detail-icon" aria-hidden="true"><current.icon width={16} height={16} /></span>
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
  /* Board controls (upgrade 2026-10-25): the consensus list was take-it-or-
     leave-it server order. Search / signal filter / sort now run client-side
     over the rows already fetched — no extra requests, no new data claims. */
  const [query, setQuery] = useState('');
  const [signalFilter, setSignalFilter] = useState('all');
  const [sortKey, setSortKey] = useState('confidence');

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
    const stopPoll = pollWhileVisible(() => load(ctrl.signal), building ? 20_000 : 90_000);
    return () => { stopPoll(); ctrl.abort(); };
  }, [load, building]);

  const chainRows = useMemo(() => (data?.consensus || []).filter((r) => chain === 'all' || String(r.chain) === chain), [data, chain]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = chainRows.filter((r) =>
      (signalFilter === 'all' || r.signal === signalFilter)
      && (!q || String(r.symbol || '').toLowerCase().includes(q) || String(r.token || '').toLowerCase().includes(q)));
    const by = {
      confidence: (a, b) => (b.confidence ?? -1) - (a.confidence ?? -1) || Math.abs(b.netFlowUsd) - Math.abs(a.netFlowUsd),
      net: (a, b) => Math.abs(b.netFlowUsd) - Math.abs(a.netFlowUsd),
      wallets: (a, b) => (b.independentVotes ?? 0) - (a.independentVotes ?? 0) || Math.abs(b.netFlowUsd) - Math.abs(a.netFlowUsd),
      momentum: (a, b) => Math.abs(b.momentum?.deltaUsd ?? -1) - Math.abs(a.momentum?.deltaUsd ?? -1)
    }[sortKey] || (() => 0);
    return [...filtered].sort(by);
  }, [chainRows, query, signalFilter, sortKey]);
  const flow = useMemo(() => (data?.observed?.flow || []).filter((r) => chain === 'all' || String(r.chain) === chain), [data, chain]);
  /* Receipts scoped to the SELECTED window (upgrade 2026-10-25): the server
     has always sent `observed.windowSwaps`, but the feed read `recentSwaps`
     — the newest fills of ANY age — so under a 30m window the «ledger» could
     show trades from yesterday. An old server payload without windowSwaps
     still falls back instead of breaking. */
  const receipts = useMemo(() => (Array.isArray(data?.observed?.windowSwaps) ? data.observed.windowSwaps : (data?.observed?.recentSwaps || [])).filter((r) => chain === 'all' || String(r.chain) === chain).slice(0, 15), [data, chain]);
  const candidates = useMemo(() => (data?.observed?.candidates || []).filter((r) => chain === 'all' || String(r.chain) === chain).slice(0, 10), [data, chain]);
  const earlyEntries = useMemo(() => (data?.earlyEntries || []).filter((e) => chain === 'all' || String(e.chain) === chain), [data, chain]);
  const note = refreshNote(t, data);
  const chosen = rows.find((r) => `${r.chain}:${r.token}` === selected) || rows[0] || null;
  const status = data?.indexedAt ? timeAgo(data.indexedAt) : t('sm.engine.notIndexed');
  const active = chainRows.filter((r) => r.confidence != null).length;
  /* Server breadth tallies ALL chains; next to a single-chain filtered list
     those totals would describe tokens the reader cannot see. It renders
     only unscoped — the list itself stays the scoped truth. */
  const breadth = chain === 'all' && data?.breadth && data.breadth.tokensObserved > 0 ? data.breadth : null;
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
          {/* 01b / پهنای بازار پول هوشمند — شمارش نمونهٔ تأییدشده، نه شاخص بازار */}
          {breadth && (
            <section className="smi-breadth" data-testid="sm-breadth" aria-label={t('sm.engine.breadthTitle')}>
              <div className="smi-breadth-head">
                <span className="smi-eyebrow">{t('sm.engine.breadthTitle')}</span>
                <strong className={breadth.netUsd >= 0 ? 'sm-up' : 'sm-down'}>
                  {breadth.netUsd >= 0 ? '+' : '−'}{fmtUsd(Math.abs(breadth.netUsd))}
                </strong>
              </div>
              <div className="smi-breadth-bar" aria-hidden="true">
                <i className="buy" style={{ width: `${breadth.buyUsd + breadth.sellUsd ? Math.round((breadth.buyUsd / (breadth.buyUsd + breadth.sellUsd)) * 100) : 0}%` }} />
                <i className="sell" />
              </div>
              <div className="smi-breadth-stats">
                <span><b className="sm-up">{breadth.accumulation}</b> {t('sm.engine.signal.ACCUMULATION')}</span>
                <span><b className="sm-down">{breadth.distribution}</b> {t('sm.engine.signal.DISTRIBUTION')}</span>
                <span><b>{breadth.qualifiedWalletsActive}</b> {t('sm.engine.wallets')}</span>
                <span><b>{breadth.swaps}</b> {t('sm.engine.receiptsShort')}</span>
              </div>
              <p className="smi-footnote">{t('sm.engine.breadthNote')}</p>
            </section>
          )}

          {/* 02 / سرمایه واقعاً کجا جابه‌جا شد؟ */}
          <section className="smi-section">
            <div className="smi-head">
              <span className="smi-head-ico" aria-hidden="true"><SmSignalGlyph width={16} height={16} /></span>
              <div>
                <span className="smi-eyebrow">02 / {t('sm.engine.consensus')}</span>
                <h3>{t('sm.engine.where')}</h3>
              </div>
              <span className="smi-count">
                {chainRows.length} {t('sm.engine.observed')} · {active} {t('sm.engine.active')}
              </span>
            </div>

            {chainRows.length > 0 && (
              <div className="smi-board-controls">
                <input
                  className="smi-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('sm.engine.searchTokens')}
                  aria-label={t('sm.engine.searchTokens')}
                  data-testid="sm-consensus-search"
                />
                <div className="smi-board-row">
                  <div className="smi-signal-filter" role="group" aria-label={t('sm.engine.filterBySignal')}>
                    {['all', 'ACCUMULATION', 'DISTRIBUTION', 'INSUFFICIENT_EVIDENCE'].map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={signalFilter === s ? 'active' : ''}
                        aria-pressed={signalFilter === s}
                        onClick={() => setSignalFilter(s)}
                      >
                        {s === 'all' ? t('sm.engine.filterAll')
                          : s === 'INSUFFICIENT_EVIDENCE' ? t('sm.engine.insufficient')
                            : t(`sm.engine.signal.${s}`)}
                      </button>
                    ))}
                  </div>
                  <label className="smi-sort">
                    {t('sm.engine.sortBy')}
                    <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} aria-label={t('sm.engine.sortBy')} data-testid="sm-consensus-sort">
                      <option value="confidence">{t('sm.engine.confidence')}</option>
                      <option value="net">{t('sm.engine.sortNet')}</option>
                      <option value="wallets">{t('sm.engine.sortWallets')}</option>
                      <option value="momentum">{t('sm.engine.momentum')}</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            {!chainRows.length && (
              <div className="smi-empty">
                <strong>{t('sm.engine.emptyTitle')}</strong>
                <p>{flow.length ? t('sm.engine.emptyBodySample') : t('sm.engine.emptyBody')}</p>
              </div>
            )}
            {chainRows.length > 0 && !rows.length && (
              <div className="smi-empty" data-testid="sm-consensus-nomatch">
                <p>{t('sm.engine.noMatch')}</p>
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
                    <span className="smi-votes smi-votes--wide">
                      {r.wallets ?? (r.buyers || 0) + (r.sellers || 0)} {t('sm.engine.wallets')}
                      {` · ${r.swaps ?? 0} ${t('sm.engine.receiptsShort')}`}
                      {r.lastAt ? ` · ${timeAgo(r.lastAt)}` : ''}
                    </span>
                    <span className="smi-row-meta">
                      <FlowSpark buckets={r.flowBuckets} />
                      <TrendChip row={r} />
                    </span>
                  </span>
                  <span className="smi-token-result">
                    <b className={r.netFlowUsd >= 0 ? 'sm-up' : 'sm-down'}>
                      {r.netFlowUsd >= 0 ? '+' : '−'}{fmtUsd(Math.abs(r.netFlowUsd))}
                    </b>
                    <small className={`smi-signal ${badge(r.signal)}`}>
                      {r.confidence == null ? t('sm.engine.insufficient') : `${t(`sm.engine.signal.${r.signal}`)} · ${r.confidence}/100`}
                    </small>
                    {/* Price is live-or-null: an unpriced token says «—» rather
                        than borrowing the flow number as if it were a quote. */}
                    <small className="smi-price-line mono">
                      {r.currentPriceUsd != null ? fmtPrice(r.currentPriceUsd) : t('sm.engine.noPrice')}
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
                <div className="smi-detail-actions">
                  {/* «کپی تراکنش» — the same contract this consensus is about,
                      one tap from here into the swap screen, with the side
                      taken from the observed signal. The amount, slippage and
                      the swap screen's own risk gate stay the user's. */}
                  <CopyTradeButton
                    chain={chosen.chain}
                    token={chosen.token}
                    side={chosen.signal === 'DISTRIBUTION' ? 'SELL' : 'BUY'}
                    className="sm-copy--tight"
                  />
                  <button className="smi-link" type="button" onClick={() => navigate(`/smart-money/token/${chosen.chain}/${chosen.token}`)}>
                    {t('sm.analyze')} <IconArrowUpRight width={11} height={11} aria-hidden="true" />
                  </button>
                </div>
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
              {/* Evidence strength, as a meter — the same 0–100 the row
                  prints, but readable at a glance and impossible to confuse
                  with a price forecast (it is labelled as evidence). */}
              <div className="smi-conf" data-testid="sm-confidence-meter">
                <div className="smi-conf-head">
                  <span>{t('sm.engine.confidence')}</span>
                  <b className="mono">{chosen.confidence == null ? '—' : `${chosen.confidence}/100`}</b>
                </div>
                <span className={`smi-conf-track ${badge(chosen.signal)}`} aria-hidden="true">
                  <i style={{ width: `${Math.max(0, Math.min(100, chosen.confidence || 0))}%` }} />
                </span>
              </div>

              {/* The facts the board used to leave out: what the token is worth,
                  how deep the pool is, how many wallets and receipts stand
                  behind the signal, and when we last saw one. Every cell is
                  live-or-«—». */}
              <div className="smi-facts">
                <div>
                  <small>{t('sm.engine.price')}</small>
                  <b className="mono">{fmtPrice(chosen.currentPriceUsd)}</b>
                </div>
                <div>
                  <small>{t('sm.engine.liquidityShort')}</small>
                  <b className="mono">{chosen.liquidityUsd ? fmtUsd(chosen.liquidityUsd) : '—'}</b>
                </div>
                <div>
                  <small>{t('sm.engine.wallets')}</small>
                  <b className="mono">{chosen.wallets ?? '—'}</b>
                </div>
                <div>
                  <small>{t('sm.engine.receiptsShort')}</small>
                  <b className="mono">{chosen.swaps ?? '—'}</b>
                </div>
                <div>
                  <small>{t('sm.engine.lastTrade')}</small>
                  <b>{chosen.lastAt ? timeAgo(chosen.lastAt) : '—'}</b>
                </div>
                <div>
                  <small>{t('sm.engine.groups')}</small>
                  <b className="mono">{chosen.independentVotes ?? '—'}</b>
                </div>
              </div>

              <div className="smi-split">
                <span className="is-up">{chosen.buyers ?? 0} {t('sm.engine.buy')}</span>
                <span className="smi-split-bar" aria-hidden="true">
                  <i style={{ width: `${chosen.buyers + chosen.sellers ? Math.round((chosen.buyers / (chosen.buyers + chosen.sellers)) * 100) : 0}%` }} />
                </span>
                <span className="is-down">{chosen.sellers ?? 0} {t('sm.engine.sell')}</span>
              </div>

              {chosen.momentum && (
                <div className="smi-detail-metrics smi-momentum-metrics" data-testid="sm-momentum-detail">
                  <div>
                    <small>{t('sm.engine.momentum')}</small>
                    <strong><TrendChip row={chosen} /></strong>
                  </div>
                  <div>
                    <small>{t('sm.engine.prevNet')}</small>
                    <strong className={chosen.momentum.prevNetFlowUsd == null ? '' : chosen.momentum.prevNetFlowUsd >= 0 ? 'sm-up' : 'sm-down'}>
                      {chosen.momentum.prevNetFlowUsd == null ? '—'
                        : `${chosen.momentum.prevNetFlowUsd >= 0 ? '+' : '−'}${fmtUsd(Math.abs(chosen.momentum.prevNetFlowUsd))}`}
                    </strong>
                  </div>
                  <div>
                    <small>{t('sm.engine.delta')}</small>
                    <strong className={chosen.momentum.deltaUsd == null ? '' : chosen.momentum.deltaUsd >= 0 ? 'sm-up' : 'sm-down'}>
                      {chosen.momentum.deltaUsd == null ? '—'
                        : `${chosen.momentum.deltaUsd >= 0 ? '+' : '−'}${fmtUsd(Math.abs(chosen.momentum.deltaUsd))}`}
                    </strong>
                  </div>
                  <div>
                    <small>{t('sm.engine.flowInWindow')}</small>
                    <FlowSpark buckets={chosen.flowBuckets} width={110} height={30} />
                  </div>
                </div>
              )}
              <TokenGraph data={data} tokenRow={chosen} />
              <FollowRule key={`${chosen.chain}:${chosen.token}`} row={chosen} onIntent={monitor} />
              <p className="smi-footnote">{t('sm.engine.copyTradeNote')}</p>
            </section>
          )}

          {/* 03 / لایهٔ جریان مشاهده‌شده */}
          <section className="smi-section" data-testid="sm-observed-flow">
            <div className="smi-head">
              <span className="smi-head-ico" aria-hidden="true"><SmWavesGlyph width={16} height={16} /></span>
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
              <span className="smi-head-ico" aria-hidden="true"><SmCoinGlyph width={16} height={16} /></span>
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
                <span className="smi-head-ico" aria-hidden="true"><SmPulseGlyph width={16} height={16} /></span>
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
              <span className="smi-head-ico" aria-hidden="true"><SmSparkGlyph width={16} height={16} /></span>
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
              <span className="smi-head-ico" aria-hidden="true"><SmSignalGlyph width={16} height={16} /></span>
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
