import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fetchToken, fmtUsd, shortAddr } from '../lib/smartMoneyClient';
import { FlowBar } from '../pages/SmartMoney';

/**
 * Token-level Smart Money card — embedded in the token detail page AND in the
 * /smart-money/token/:chain/:address route. Read-only on-chain signals:
 * buying/selling net flow, smart wallets, whale concentration, accumulation vs
 * distribution confidence, top buyers/sellers, holders, liquidity, exchange
 * flow. Never a buy recommendation.
 */
export default function TokenSmartMoney({ chainId = 1, address, embedded = true }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [win, setWin] = useState('24h');

  useEffect(() => {
    if (!address) return undefined;
    let on = true;
    setLoading(true);
    fetchToken(chainId, address, win)
      .then((d) => { if (on) { setData(d); setError(null); } })
      .catch((e) => { if (on) setError(e.message); })
      .finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [chainId, address, win]);

  if (!address) return null;

  const flow = data?.smartMoneyFlow;
  const accum = data?.accumulation;
  const distrib = data?.distribution;
  const holders = data?.holders;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="sm-section"
      style={embedded ? { margin: 0 } : undefined}
    >
      <h3>
        ✦ {t('sm.title')}
        <span className="spacer" />
        <span className="sm-seg">
          {['1h', '4h', '24h', '7d'].map((w) => (
            <button key={w} className={win === w ? 'active' : ''} onClick={() => setWin(w)}>{w}</button>
          ))}
        </span>
      </h3>

      {loading && (
        <>
          <div className="sm-skel" style={{ width: '70%' }} />
          <div className="sm-skel" style={{ width: '50%' }} />
        </>
      )}

      {error && <div className="sm-empty">{t('sm.tokenUnavailable')}</div>}

      {data && !loading && (
        <>
          {data.dataStatus !== 'live' && (
            <div className="sm-empty" style={{ padding: '8px 0' }}>{t('sm.tokenNoDex')}</div>
          )}

          {/* Buying / selling / net */}
          <div className="sm-metrics" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <div className="sm-metric">
              <div className="lab">{t('sm.buying')}</div>
              <div className="val sm-up" style={{ fontSize: 15 }}>{fmtUsd(flow?.buyUsd)}</div>
            </div>
            <div className="sm-metric">
              <div className="lab">{t('sm.selling')}</div>
              <div className="val sm-down" style={{ fontSize: 15 }}>{fmtUsd(flow?.sellUsd)}</div>
            </div>
            <div className="sm-metric">
              <div className="lab">{t('sm.netFlow')}</div>
              <div className={`val ${(flow?.netUsd || 0) >= 0 ? 'sm-up' : 'sm-down'}`} style={{ fontSize: 15 }}>
                {fmtUsd(flow?.netUsd)}
              </div>
            </div>
          </div>

          {/* Accumulation vs distribution */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <div style={{ flex: 1 }}>
              <div className="faint" style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>{t('sm.accumulation')}</div>
              <div className="sm-meter" style={{ marginTop: 6 }}><i style={{ width: `${accum?.confidence || 0}%`, background: '#2ee6a8' }} /></div>
              <div className="sm-up" style={{ fontSize: 12, fontWeight: 900, marginTop: 4 }}>{accum?.confidence ?? 0}%</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="faint" style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase' }}>{t('sm.distribution')}</div>
              <div className="sm-meter" style={{ marginTop: 6 }}><i style={{ width: `${distrib?.confidence || 0}%`, background: '#ff5c7a' }} /></div>
              <div className="sm-down" style={{ fontSize: 12, fontWeight: 900, marginTop: 4 }}>{distrib?.confidence ?? 0}%</div>
            </div>
          </div>

          {/* Holder analysis */}
          {holders?.dataStatus === 'live' && (
            <div className="sm-metrics" style={{ gridTemplateColumns: 'repeat(2,1fr)', marginTop: 12 }}>
              <div className="sm-metric">
                <div className="lab">{t('sm.totalHolders')}</div>
                <div className="val" style={{ fontSize: 16 }}>{holders.total?.toLocaleString() ?? '—'}</div>
              </div>
              <div className="sm-metric">
                <div className="lab">{t('sm.top10')}</div>
                <div className="val" style={{ fontSize: 16 }}>{holders.top10Share != null ? `${holders.top10Share}%` : '—'}</div>
              </div>
              <div className="sm-metric">
                <div className="lab">{t('sm.whaleConcentration')}</div>
                <div className={`val ${holders.whaleConcentration === 'HIGH' ? 'sm-down' : holders.whaleConcentration === 'MEDIUM' ? 'sm-risk-MEDIUM' : 'sm-up'}`} style={{ fontSize: 14 }}>
                  {holders.whaleConcentration || '—'}
                </div>
              </div>
              <div className="sm-metric">
                <div className="lab">{t('sm.exchangeSupply')}</div>
                <div className="val" style={{ fontSize: 16 }}>{holders.exchangeSupplyPct != null ? `${holders.exchangeSupplyPct}%` : '—'}</div>
              </div>
            </div>
          )}

          {/* Smart wallets count */}
          <div className="sm-row" style={{ cursor: 'default' }}>
            <div className="mid"><div className="name">{t('sm.smartWalletsTitle')}</div></div>
            <div className="right usd">{flow?.smartWallets ?? '—'}</div>
          </div>
          <div className="sm-row" style={{ cursor: 'default' }}>
            <div className="mid"><div className="name">{t('sm.liquidity')}</div></div>
            <div className="right usd">{fmtUsd(data.liquidityUsd)}</div>
          </div>

          {/* Top buyers / sellers */}
          {flow?.topBuyers?.length > 0 && (
            <>
              <div className="faint" style={{ fontSize: 11, fontWeight: 800, marginTop: 10, textTransform: 'uppercase' }}>{t('sm.topBuyers')}</div>
              {flow.topBuyers.slice(0, 5).map((b) => (
                <div key={b.address} className="sm-row">
                  <div className="mid mono"><div className="name">{b.short || shortAddr(b.address)}</div></div>
                  <div className="right usd sm-up">{fmtUsd(b.usd)}</div>
                </div>
              ))}
            </>
          )}
          {flow?.topSellers?.length > 0 && (
            <>
              <div className="faint" style={{ fontSize: 11, fontWeight: 800, marginTop: 10, textTransform: 'uppercase' }}>{t('sm.topSellers')}</div>
              {flow.topSellers.slice(0, 5).map((s) => (
                <div key={s.address} className="sm-row">
                  <div className="mid mono"><div className="name">{s.short || shortAddr(s.address)}</div></div>
                  <div className="right usd sm-down">{fmtUsd(s.usd)}</div>
                </div>
              ))}
            </>
          )}

          {data.risk && (
            <div style={{ marginTop: 10 }}>
              <span className={`sm-tag ${data.risk === 'HIGH' ? 'warn' : ''}`} style={{ float: 'none' }}>
                {t('sm.risk')}: {data.risk}
              </span>
            </div>
          )}

          <div className="sm-disclaimer">{t('sm.tokenDisclaimer')}</div>
        </>
      )}
    </motion.div>
  );
}
