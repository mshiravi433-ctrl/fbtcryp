import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Sheet from './Sheet';
import Sparkline from './Sparkline';
import TokenRiskCard from './TokenRiskCard';
import TokenIcon from '../lib/tokenIcon';
import { EVM_CHAINS } from '../lib/chains';
import { getChart } from '../lib/api';
import { fmtPct, fmtUsd } from '../lib/format';
import { vsOf } from '../lib/currency';
import { useSettingsStore } from '../store/useSettingsStore';
import { IconExternal, IconSwap, IconChevronRight } from './Icons';
import { IconSend } from './WalletArt';

/**
 * TOKEN DETAIL SHEET — tapped from the unified asset list.
 * ---------------------------------------------------------------------------
 * Shows everything we actually know about one asset across every chain it is
 * held on: price + sparkline (from the same /api/chart the coin page uses),
 * per-chain balances, portfolio weight, cost basis / P&L from the local lot
 * ledger (labelled partial when incomplete), the contract link, the real
 * token-risk scan, and the existing actions (Swap / Send / Bridge).
 *
 * ─── HONESTY ────────────────────────────────────────────────────────────────
 * price / sparkline / cost / P&L are `—` + an explicit `not indexed` /
 * `partial` label when the source is missing. No zeros are invented.
 */
export default function TokenDetailSheet({
  open,
  onClose,
  group = null,
  intel = null,
  wallet = null,
  currency = null,
  onSend = null
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currencyCode = useSettingsStore((s) => s.currency);
  const vs = vsOf(currencyCode);
  const [spark, setSpark] = useState(null);
  const [sparkErr, setSparkErr] = useState(false);

  const items = useMemo(() => (group?.items || []), [group]);
  const primary = items[0] || null;
  const price = useMemo(() => {
    for (const r of items) if (r.price != null) return r.price;
    return null;
  }, [items]);
  const coingeckoId = primary?.coingeckoId || null;

  const intelRow = useMemo(() => {
    if (!intel?.rows || !primary) return null;
    return intel.rows.find((r) => r.symbol === primary.symbol) || null;
  }, [intel, primary]);

  const weight = intelRow?.weight ?? null;
  const cost = intelRow?.cost ?? null;
  const pnl = intelRow?.pnl ?? null;
  const pnlPct = intelRow?.pnlPct ?? null;

  const contractItem = items.find((r) => r.address) || null;
  const contractUrl = useMemo(() => {
    if (!contractItem?.address || !EVM_CHAINS[contractItem.chainId]) return null;
    return `${EVM_CHAINS[contractItem.chainId].explorer}/token/${contractItem.address}`;
  }, [contractItem]);

  useEffect(() => {
    let alive = true;
    if (!open) return undefined;
    setSpark(null);
    setSparkErr(false);
    if (!coingeckoId) return undefined;
    getChart(coingeckoId, 7, vs)
      .then((pts) => {
        if (!alive) return;
        const series = (pts || []).map((d) => Number(d.p)).filter(Number.isFinite);
        setSpark(series.length >= 2 ? series : null);
      })
      .catch(() => { if (alive) setSparkErr(true); });
    return () => { alive = false; };
  }, [open, coingeckoId, vs]);

  const goSwap = () => {
    if (!primary) return;
    onClose?.();
    navigate(`/swap?from=${encodeURIComponent(primary.symbol)}&chain=${primary.chainId}`);
  };
  const goBridge = () => {
    onClose?.();
    navigate('/bridge');
  };
  const goSend = () => {
    if (!primary) return;
    onClose?.();
    onSend?.(primary);
  };

  const chain = (cid) => EVM_CHAINS[cid];
  const sparkUp = spark && spark.length > 1 ? spark[spark.length - 1] >= spark[0] : true;

  return (
    <Sheet open={open} onClose={onClose} title={primary ? primary.symbol : ''} anchor="bottom" size="lg">
      {primary && (
        <div className="stack" style={{ gap: 12 }}>
          {/* header: icon + name + chain chips */}
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            <TokenIcon token={{ symbol: primary.symbol, address: primary.address, native: primary.native }} chainId={primary.chainId} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>{primary.symbol}</div>
              <div className="faint" style={{ fontSize: 11.5 }}>{primary.name}</div>
              <div className="row" style={{ gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                {items.map((r) => (
                  <span key={r.chainId} className="wal-chip-net" style={{ background: chain(r.chainId)?.color ? `${chain(r.chainId).color}22` : 'rgba(255,255,255,0.06)', color: chain(r.chainId)?.color || 'var(--text-2)' }}>
                    {chain(r.chainId)?.short}
                  </span>
                ))}
                {primary.native && <span className="pill pill-rgb" style={{ fontSize: 9 }}>{t('wallet.gasCoin')}</span>}
              </div>
            </div>
          </div>

          {/* price + sparkline */}
          <div className="wallet-pie-card" style={{ padding: 14, borderRadius: 16 }}>
            <div className="row-between">
              <div>
                <div className="faint" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5 }}>{t('wallet.tok.price')}</div>
                <div className="mono" style={{ fontSize: 20, fontWeight: 900, marginTop: 3 }}>
                  {price != null ? fmtUsd(price) : <span className="faint">— <span style={{ fontSize: 10.5, fontWeight: 600 }}>{t('wallet.notIndexed')}</span></span>}
                </div>
              </div>
              <div style={{ flexShrink: 0 }}>
                {spark ? <Sparkline data={spark} up={sparkUp} width={104} height={40} /> : (
                  <div className="faint" style={{ fontSize: 10.5 }}>
                    {sparkErr ? t('wallet.tok.noChart') : '…'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* per-chain balances */}
          <div className="wallet-pie-card" style={{ padding: 14, borderRadius: 16 }}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span className="wallet-section-title">{t('wallet.tok.balances')}</span>
              <span className="faint" style={{ fontSize: 11 }}>{group?.total || 0} {t('wallet.assetsUnit')}</span>
            </div>
            {items.map((r) => (
              <div key={r.key} className="row-between" style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="row" style={{ gap: 7 }}>
                  <span className="wal-chip-net" style={{ background: chain(r.chainId)?.color ? `${chain(r.chainId).color}22` : 'rgba(255,255,255,0.06)', color: chain(r.chainId)?.color || 'var(--text-2)' }}>
                    {chain(r.chainId)?.short}
                  </span>
                  <span className="mono" style={{ fontWeight: 700, fontSize: 12.5 }}>{r.amount.toFixed(6)} {r.symbol}</span>
                </span>
                <span className="mono faint" style={{ fontSize: 11.5 }}>
                  {r.value != null ? fmtUsd(r.value) : '—'}
                </span>
              </div>
            ))}
            {group && (
              <div className="row-between" style={{ paddingTop: 9 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800 }}>{t('wallet.tok.total')}</span>
                <span className="mono" style={{ fontWeight: 900, fontSize: 13 }}>
                  {group.value != null ? fmtUsd(group.value) : <span className="faint">— <span style={{ fontSize: 10.5 }}>{t('wallet.notIndexed')}</span></span>}
                </span>
              </div>
            )}
          </div>

          {/* portfolio weight + cost / P&L */}
          <div className="wallet-pie-card" style={{ padding: 14, borderRadius: 16 }}>
            <div className="row-between" style={{ padding: '5px 0' }}>
              <span className="faint" style={{ fontSize: 11.5 }}>{t('wallet.tok.weight')}</span>
              <span className="mono" style={{ fontWeight: 800 }}>
                {weight != null ? `${weight.toFixed(1)}%` : <span className="faint">—</span>}
              </span>
            </div>
            <div className="row-between" style={{ padding: '5px 0', borderTop: '1px solid var(--line)' }}>
              <span className="faint" style={{ fontSize: 11.5 }}>{t('intel.cost')}</span>
              <span className="mono" style={{ fontWeight: 800 }}>
                {cost != null ? fmtUsd(cost) : <span className="faint">— <span style={{ fontSize: 10.5 }}>{t('wallet.partialCost')}</span></span>}
              </span>
            </div>
            <div className="row-between" style={{ padding: '5px 0', borderTop: '1px solid var(--line)' }}>
              <span className="faint" style={{ fontSize: 11.5 }}>{t('intel.pnl')}</span>
              <span className="mono" style={{ fontWeight: 800, color: pnl == null ? undefined : pnl >= 0 ? 'var(--up)' : 'var(--down)' }}>
                {pnl != null
                  ? `${pnl >= 0 ? '+' : ''}${fmtUsd(pnl)} ${pnlPct != null ? `(${fmtPct(pnlPct)})` : ''}`
                  : <span className="faint">— <span style={{ fontSize: 10.5 }}>{t('wallet.partialCost')}</span></span>}
              </span>
            </div>
          </div>

          {/* contract + risk */}
          {contractUrl && (
            <button
              type="button"
              className="row-between wal-link-row"
              onClick={() => window.open(contractUrl, '_blank', 'noopener,noreferrer')}
            >
              <span className="row" style={{ gap: 8 }}>
                <IconExternal width={14} height={14} />
                <span style={{ fontSize: 12.5, fontWeight: 700 }}>{t('wallet.tok.contract')}</span>
              </span>
              <IconChevronRight width={14} height={14} />
            </button>
          )}
          {contractItem && (
            <TokenRiskCard chainId={contractItem.chainId} address={contractItem.address} symbol={primary.symbol} />
          )}

          {/* actions */}
          <div className="row" style={{ gap: 8 }}>
            <button className="wallet-action-modern send" style={{ flex: 1, minHeight: 52 }} onClick={goSend}>
              <span className="wallet-action-icon-modern" aria-hidden="true"><IconSend /></span>
              <span className="wallet-action-label">{t('send.title')}</span>
            </button>
            <button className="wallet-action-modern recv" style={{ flex: 1, minHeight: 52 }} onClick={goSwap}>
              <span className="wallet-action-icon-modern" aria-hidden="true"><IconSwap width={17} height={17} /></span>
              <span className="wallet-action-label">{t('swap.title')}</span>
            </button>
          </div>
          <button className="btn btn-ghost" style={{ minHeight: 46, borderRadius: 14 }} onClick={goBridge}>
            {t('nav.bridge')} →
          </button>
        </div>
      )}
    </Sheet>
  );
}
