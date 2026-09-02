import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import { IconChevronLeft } from '../components/Icons';
import {
  fetchWallet, fmtUsd, shortAddr, timeAgo, CHAIN_OPTIONS
} from '../lib/smartMoneyClient';
import { isTracked, trackWallet, untrackWallet } from '../lib/smartMoneyWatch';
import { useTelegram } from '../context/TelegramContext';

function ScoreRing({ value, color = '#7c7dff', label }) {
  const v = value ?? 0;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="sm-score">
      <div className="ring">
        <svg width="64" height="64">
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
          <circle
            cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c - (c * v) / 100}
          />
        </svg>
        <div className="n">{value == null ? '—' : value}</div>
      </div>
      <div className="lab">{label}</div>
    </div>
  );
}

const RISK_COLORS = { LOW: '#2ee6a8', MEDIUM: '#ffc24b', HIGH: '#ff5c7a' };

export default function SmartMoneyWallet({ embedded = false, onBack, chainProp, addressProp }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const params = useParams();
  const chain = chainProp || params.chain;
  const address = (addressProp || params.address || '').toLowerCase();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tracked, setTracked] = useState(isTracked(chain, address));
  const [chainId, setChainId] = useState(chain);

  const load = useCallback(async (c) => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchWallet(c === 'solana' ? 'solana' : Number(c) || 1, address);
      setData(d);
    } catch (e) {
      /*
       * The client surfaces `HTTP 502 {"error":"WALLET_INTEL_UNAVAILABLE",...}`.
       * Dumping that raw line on a Persian screen is neither readable nor
       * useful, so the status code is kept and the payload detail dropped
       * unless it says something a human could act on.
       */
      const msg = String(e?.message || '');
      const status = msg.match(/^HTTP\s(\d+)/)?.[1] || null;
      const detail = msg.match(/"detail"\s*:\s*"([^"]{3,120})"/)?.[1] || null;
      const err = new Error(detail || (status ? `HTTP ${status}` : msg) || 'SMART_MONEY_FAILED');
      err.status = e?.status ?? (status ? Number(status) : undefined);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { if (address) load(chainId); }, [address, chainId, load]);

  const goBack = () => (onBack ? onBack() : navigate(-1));
  const chainMeta = CHAIN_OPTIONS.find((c) => String(c.id) === String(chainId));

  const toggleTrack = () => {
    haptic?.('light');
    if (tracked) { untrackWallet(chainId, address); setTracked(false); }
    else {
      trackWallet({ chain: chainId, address, label: shortAddr(address, chainId === 'solana' ? 'solana' : 'evm') });
      setTracked(true);
    }
  };

  const pnl = data?.pnl;
  const risk = data?.risk;
  /*
   * A score nobody measured must not render as a zero. The server reports
   * `coverage` precisely so this page can tell "low" from "unknown".
   */
  const shownScore = (s) => (s && s.coverage > 0 ? s.score : null);
  const src = data?.sources || {};
  const deadSources = Object.entries(src).filter(([, v]) => v !== 'live').map(([k]) => k);
  const historyLive = !Object.keys(src).length || src.history === 'live';
  const holdingsList = data?.holdings || [];
  const holdingsPriced = holdingsList.some((h) => h.valueUsd != null);
  const unverifiedTokens = holdingsList.filter((h) => h.symbol === '???').length;

  return (
    <PageTransition>
      <div className="sm-page" style={embedded ? { padding: 0 } : undefined}>
        <motion.div className="row" style={{ gap: 10, marginBottom: 12 }} variants={riseIn} initial="hidden" animate="show">
          <button className="icon-btn" onClick={goBack} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 16 }} className="mono">
              {shortAddr(address, chainId === 'solana' ? 'solana' : 'evm')}
            </div>
            <div className="faint" style={{ fontSize: 11 }}>{chainMeta?.name || chainId}</div>
          </div>
          {chainId !== 'solana' && (
            <select
              value={chainId}
              onChange={(e) => setChainId(e.target.value)}
              style={{ background: 'rgba(255,255,255,0.08)', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, padding: '6px 8px', fontSize: 12 }}
            >
              {CHAIN_OPTIONS.filter((c) => c.id !== 'solana').map((c) => (
                <option key={c.id} value={c.id}>{c.short}</option>
              ))}
            </select>
          )}
        </motion.div>

        {loading && (
          <div className="sm-section">
            {[...Array(6)].map((_, i) => <div key={i} className="sm-skel" style={{ width: `${80 - i * 8}%` }} />)}
          </div>
        )}

        {error && !loading && (
          <div className="sm-section sm-empty">
            {t('sm.errorWallet')}
            <br />
            <span className="faint">
              {/* 502 here means an upstream indexer was down, not that the
                  address is wrong — say so, it is the difference between
                  "try again in a second" and "this wallet is broken". */}
              {error.status === 429 ? t('sm.rateLimited')
                : error.status >= 500 || error.status == null ? t('sm.dataSourceOffline')
                : t('sm.errorWalletDetail')}
              {error.message ? ` (${error.message})` : ''}
            </span>
            <div style={{ marginTop: 12 }}><button className="sm-btn" onClick={() => load(chainId)}>{t('sm.retry')}</button></div>
          </div>
        )}

        {data && !loading && (
          <>
            {data.dataStatus !== 'live' && (
              <div className="sm-section sm-empty" style={{ padding: '12px 14px', textAlign: 'start' }}>
                {deadSources.length === Object.keys(src).length && Object.keys(src).length > 0
                  ? t('sm.dataSourceOffline')
                  : t('sm.noHistory')}
                {deadSources.length > 0 && (
                  <div className="faint" style={{ fontSize: 11, marginTop: 6 }}>
                    {t('sm.offlineSources', { list: deadSources.join(' · ') })}
                  </div>
                )}
                {/*
                  * Retry has to be reachable from the empty state too: the old
                  * page only offered it on a thrown error, so a wallet that
                  * answered 200-with-nothing looked permanent.
                  */}
                <div style={{ marginTop: 10 }}>
                  <button className="sm-btn" onClick={() => load(chainId)}>{t('sm.retry')}</button>
                </div>
              </div>
            )}

            <motion.div variants={riseIn} initial="hidden" animate="show">
              {data.tags?.length > 0 && (
                <div className="sm-tags">
                  {data.tags.map((tag) => (
                    <span key={tag} className={`sm-tag ${tag.includes('INSIDER') ? 'warn' : ''}`}>
                      {tag.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}

              <div className="sm-scores">
                <ScoreRing value={shownScore(data.smartMoney)} color="#7c7dff" label={t('sm.smartScore')} />
                <ScoreRing value={shownScore(data.reputation)} color="#00e5ff" label={t('sm.reputation')} />
                <ScoreRing
                  value={shownScore(risk)}
                  color={risk?.coverage > 0 ? (RISK_COLORS[risk?.band] || '#888') : '#888'}
                  label={t('sm.risk')}
                />
              </div>
              {risk?.band && risk?.coverage > 0 && (
                <div className="faint" style={{ fontSize: 11, textAlign: 'center', marginTop: -8, marginBottom: 10 }}>
                  <b className={`sm-risk-${risk.band}`}>{t(`sm.riskBand.${risk.band}`)}</b>
                  {' · '}{t('sm.coverage', { n: Math.round((risk.coverage || 0) * 100) })}
                </div>
              )}
              {/*
                * The evidence line: what this page could actually observe.
                * Age and transaction count come from the wallet route; an
                * unknown count says so instead of showing 0, which would read
                * as "this wallet has never transacted".
               */}
              <div className="faint" style={{ fontSize: 11, textAlign: 'center', marginTop: risk?.coverage > 0 ? -4 : 2, marginBottom: 10 }}>
                {t('sm.evidenceLine', {
                  txs: data.txCount != null ? data.txCount : t('sm.unknown'),
                  age: data.ageMs != null ? timeAgo(Date.now() - data.ageMs) : t('sm.unknown')
                })}
              </div>

              {/* Key stats */}
              <div className="sm-metrics">
                <div className="sm-metric">
                  <div className="lab">{t('sm.portfolio')}</div>
                  <div className="val">
                    {holdingsPriced ? fmtUsd(data.portfolioUsd) : t('sm.unknown')}
                  </div>
                </div>
                <div className="sm-metric">
                  <div className="lab">{t('sm.totalPnl')}</div>
                  <div className={`val ${pnl?.totalUsd > 0 ? 'sm-up' : pnl?.totalUsd < 0 ? 'sm-down' : ''}`}>
                    {pnl?.totalUsd != null ? fmtUsd(pnl.totalUsd) : '—'}
                  </div>
                </div>
                <div className="sm-metric">
                  <div className="lab">{t('sm.winRate')}</div>
                  <div className="val">{pnl?.winRate != null ? `${pnl.winRate}%` : '—'}</div>
                </div>
              </div>

              <div className="sm-section">
                <h3>{t('sm.pnlBreakdown')}</h3>
                <div className="sm-row" style={{ cursor: 'default' }}>
                  <div className="mid"><div className="name">{t('sm.realized')}</div></div>
                  <div className={`right usd ${pnl?.realizedUsd > 0 ? 'sm-up' : 'sm-down'}`}>{fmtUsd(pnl?.realizedUsd)}</div>
                </div>
                <div className="sm-row" style={{ cursor: 'default' }}>
                  <div className="mid"><div className="name">{t('sm.unrealized')}</div></div>
                  <div className={`right usd ${pnl?.unrealizedUsd > 0 ? 'sm-up' : 'sm-down'}`}>{fmtUsd(pnl?.unrealizedUsd)}</div>
                </div>
                {pnl?.closedTrades > 0 && (
                  <div className="sm-row" style={{ cursor: 'default' }}>
                    <div className="mid"><div className="name">{t('sm.closedTrades')}</div><div className="sub">{t('sm.closedTradesSub')}</div></div>
                    <div className="right"><div className="usd">{pnl.closedTrades}</div></div>
                  </div>
                )}
                {pnl?.best && (
                  <div className="sm-row" style={{ cursor: 'default' }}>
                    <div className="mid"><div className="name">{t('sm.bestTrade')}</div><div className="sub">{pnl.best.symbol}</div></div>
                    <div className="right usd sm-up">{fmtUsd(pnl.best.pnlUsd)}</div>
                  </div>
                )}
                {pnl?.worst && (
                  <div className="sm-row" style={{ cursor: 'default' }}>
                    <div className="mid"><div className="name">{t('sm.worstTrade')}</div><div className="sub">{pnl.worst.symbol}</div></div>
                    <div className="right usd sm-down">{fmtUsd(pnl.worst.pnlUsd)}</div>
                  </div>
                )}
                {/*
                  * Three honest states, not one: prices loaded but no round-trip
                  * closed inside the fetched window («partial») is a different
                  * sentence from the history source being dead.
                 */}
                {pnl?.dataStatus === 'partial' && (
                  <div className="sm-empty" style={{ padding: '8px 0' }}>{t('sm.pnlPartial')}</div>
                )}
                {pnl?.dataStatus === 'unavailable' && (
                  <div className="sm-empty" style={{ padding: '8px 0' }}>
                    {pnl.reason === 'NO_HISTORY' ? t('sm.pnlNoHistory') : t('sm.pnlUnavailable')}
                  </div>
                )}
              </div>

              {/* Risk reasons */}
              {risk?.reasons && (risk.reasons.plus.length > 0 || risk.reasons.minus.length > 0) && (
                <div className="sm-section">
                  <h3>{t('sm.whyRisk')}</h3>
                  <ul className="sm-factors">
                    {risk.reasons.plus.map((r, i) => <li key={`p${i}`} className="good">{r}</li>)}
                    {risk.reasons.minus.map((r, i) => <li key={`m${i}`} className="bad">{r}</li>)}
                  </ul>
                </div>
              )}

              {/* Holdings */}
              {data.holdings?.length > 0 && (
                <div className="sm-section">
                  <h3>{t('sm.holdings')}</h3>
                  <div className="sm-holdings">
                    {data.holdings.slice(0, 16).map((h, i) => (
                      <span key={i} className="sm-chip">
                        {h.symbol}
                        {h.valueUsd != null && <span className="faint" style={{ fontSize: 10.5 }}>{fmtUsd(h.valueUsd)}</span>}
                      </span>
                    ))}
                  </div>
                  {unverifiedTokens > 0 && (
                    <div className="faint" style={{ fontSize: 11, marginTop: 8 }}>
                      {t('sm.unverifiedTokens', { n: unverifiedTokens })}
                    </div>
                  )}
                </div>
              )}

              {/* Recent activity */}
              <div className="sm-section">
                <h3>{t('sm.recentActivity')}</h3>
                {data.activity?.length === 0 && (
                  <div className="sm-empty">
                    {/*
                      * "No activity" and "we could not read any" are different
                      * sentences; saying the first when the indexer was down is
                      * how this page used to look confidently empty.
                     */}
                    {historyLive ? t('sm.noActivity') : t('sm.activityBlocked')}
                  </div>
                )}
                {data.activity?.slice(0, 20).map((a) => (
                  <div key={a.id} className="sm-row" onClick={() => a.hash && navigate(`/smart-money`)}>
                    <div className="mid">
                      <div className="name">{a.label}</div>
                      <div className="sub mono">{a.counterpartyLabel || shortAddr(a.counterparty)}</div>
                    </div>
                    <div className="right">
                      <div className={`usd ${a.type?.includes('SELL') || a.type?.includes('DEPOSIT') ? 'sm-down' : a.type?.includes('BUY') || a.type?.includes('WITHDRAWAL') ? 'sm-up' : ''}`}>
                        {fmtUsd(a.valueUsd)}
                      </div>
                      <div className="sub faint">{timeAgo(a.timestamp)}</div>
                    </div>
                  </div>
                ))}
              </div>

              <button className={`sm-btn ${tracked ? 'ghost' : ''}`} onClick={toggleTrack} style={{ marginBottom: 14 }}>
                {tracked ? `✓ ${t('sm.tracking')}` : `+ ${t('sm.trackWallet')}`}
              </button>

              <div className="sm-disclaimer">{t('sm.disclaimer')}</div>
            </motion.div>
          </>
        )}
      </div>
    </PageTransition>
  );
}
