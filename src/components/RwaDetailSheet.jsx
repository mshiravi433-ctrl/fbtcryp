import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Sheet from './Sheet';
import ShareSheet from './ShareSheet';
import Sparkline from './Sparkline';
import RwaRiskPanel from './RwaRiskPanel';
import TokenIcon from '../lib/tokenIcon';
import { fmtCompact, fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { feePercentString, FEE_BPS } from '../lib/feeBps';
import { EVM_CHAINS } from '../lib/chains';
import { canonicalizeRwa, rwaCounterSymbol } from '../lib/rwaTokens';
import { copyText } from '../lib/share';
import { useShare } from '../hooks/useShare';
import { IconCheck, IconCopy, IconExternal, IconShield, IconSwap } from './Icons';
import { useTelegram } from '../context/TelegramContext';

const QUICK = [100, 500, 1000, 5000];

function chipUsd(n) {
  if (n >= 1000 && n % 1000 === 0) return `$${n / 1000}k`;
  return `$${n}`;
}

/**
 * RWA specification sheet.
 *
 * Contract share + copy sit in `.btn-row` (equal width, one line, 44px).
 * A `.btn` next to another `.btn` without that class collapses the share
 * control — the same trap documented on the Earn invite row.
 */
export default function RwaDetailSheet({
  open,
  onClose,
  token: raw,
  onBuy,
  amountUsd = 1000
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [share, shareSheet] = useShare();
  const [copied, setCopied] = useState(false);
  const [calcAmount, setCalcAmount] = useState(amountUsd || 1000);
  const token = canonicalizeRwa(raw);

  useEffect(() => {
    setCalcAmount(amountUsd || 1000);
    setCopied(false);
  }, [token?.id, amountUsd]);

  if (!token) return null;

  const up = (token.change24h ?? 0) >= 0;
  const price = Number(token.price);
  const feePct = feePercentString(token.feeBps || FEE_BPS);
  const feeDecimal = (token.feeBps || FEE_BPS) / 10000;
  const pay = rwaCounterSymbol(token);
  const units = Number.isFinite(price) && price > 0 && calcAmount > 0
    ? (Number(calcAmount) * (1 - feeDecimal)) / price
    : null;

  const chainCfg = EVM_CHAINS[token.chainId];
  const chainLabel = t(`stocks.rwaChain.${token.chainId}`, {
    defaultValue: token.chainName || chainCfg?.name || '—'
  });
  const explorerUrl = token.address && chainCfg?.explorer
    ? `${chainCfg.explorer}/token/${token.address}`
    : null;
  const typeLabel = token.backingType
    ? t(`stocks.rwaBackingType.${token.backingType}`, { defaultValue: token.backingType })
    : null;

  const copyAddress = async () => {
    if (!token.address) return;
    const ok = await copyText(token.address);
    if (!ok) return;
    setCopied(true);
    haptic?.('notification', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const shareAddress = () => {
    const url = explorerUrl || (typeof window !== 'undefined' ? `${window.location.origin}/stocks` : 'https://fbtcryp.example/stocks');
    share({
      url,
      title: token.symbol || 'RWA',
      text: t('stocks.rwaShareText', {
        name: token.name,
        symbol: token.symbol,
        address: token.address
      })
    });
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={token.symbol || t('stocks.rwaDetailsTitle')}
        anchor="bottom"
        size="lg"
      >
        <div className="rwa-detail">
          <div className="rwa-card-head">
            <span className="rwa-logo" aria-hidden="true">
              <TokenIcon token={token} chainId={token.chainId} size={44} />
            </span>
            <div className="rwa-card-id">
              <div className="rwa-card-name rwa-name-full">{token.name}</div>
              <div className="rwa-card-sym mono">
                <span>{token.symbol}</span>
                <span className="faint">·</span>
                <span className="faint">{chainLabel}</span>
              </div>
            </div>
            <div className="rwa-card-px">
              <div className="mono eq-price">{Number.isFinite(price) && price > 0 ? `$${fmtPrice(price)}` : '—'}</div>
              <div className={`mono ${up ? 'up' : 'down'}`}>
                {token.change24h != null ? fmtPct(token.change24h, 1) : '—'}
              </div>
            </div>
          </div>

          <div className="rwa-chips">
            <span className="pill pill-neutral">{t(`stocks.rwaCategory.${token.category}`, token.category)}</span>
            <span className="pill pill-neutral">{chainLabel}</span>
            {token.standard && <span className="pill pill-neutral mono">{token.standard}</span>}
            <span className="pill pill-up mono">{feePct}% {t('stocks.rwaFeeChip')}</span>
            {token.mcap > 0 && (
              <span className="pill pill-neutral">{t('stocks.stats.mcap')}: {fmtCompact(token.mcap)}</span>
            )}
          </div>

          {Array.isArray(token.sparkline) && token.sparkline.length > 2 && (
            <div className="rwa-spark">
              <span>{t('stocks.sparkline7d')}</span>
              <Sparkline data={token.sparkline.slice(-40)} up={up} width={108} height={28} />
            </div>
          )}

          <RwaRiskPanel token={token} />

          <section className="rwa-spec">
            <div className="rwa-spec-title">
              <IconShield width={15} height={15} />
              <span>{t('stocks.rwaBackingTitle')}</span>
            </div>
            <div className="rwa-spec-row">
              <span className="rwa-spec-k">{t('stocks.rwaIssuer')}</span>
              <span className="rwa-spec-v">{token.issuer || '—'}</span>
            </div>
            <div className="rwa-spec-row">
              <span className="rwa-spec-k">{t('stocks.rwaBackingModel')}</span>
              <span className="rwa-spec-v">{token.backing || '—'}</span>
            </div>
            {typeLabel && (
              <div className="rwa-spec-row">
                <span className="rwa-spec-k">{t('stocks.rwaSpecType')}</span>
                <span className="rwa-spec-v">{typeLabel}</span>
              </div>
            )}
            <div className="rwa-spec-row">
              <span className="rwa-spec-k">{t('stocks.rwaSpecChain')}</span>
              <span className="rwa-spec-v">{chainLabel}</span>
            </div>
            <div className="rwa-spec-row">
              <span className="rwa-spec-k">{t('stocks.rwaSpecStandard')}</span>
              <span className="rwa-spec-v mono">{token.standard || 'ERC-20'}</span>
            </div>
            <div className="rwa-spec-row">
              <span className="rwa-spec-k">{t('stocks.rwaSpecFee')}</span>
              <span className="rwa-spec-v mono">{feePct}%</span>
            </div>
            {token.description && <p className="rwa-spec-note">{token.description}</p>}
          </section>

          {token.address && (
            <section className="rwa-contract">
              <div className="rwa-spec-k">{t('stocks.rwaContract')}</div>
              <div className="rwa-addr" dir="ltr" title={token.address}>{token.address}</div>
              <div className="btn-row rwa-contract-actions">
                <button type="button" className="btn btn-primary" onClick={shareAddress}>
                  {t('receive.share')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={copyAddress}>
                  {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
                  <span>{copied ? t('common.copied') : t('common.copy')}</span>
                </button>
              </div>
              {explorerUrl && (
                <a className="rwa-explorer" href={explorerUrl} target="_blank" rel="noopener noreferrer">
                  <IconExternal width={14} height={14} />
                  <span>{t('stocks.rwaExplorer')}</span>
                </a>
              )}
            </section>
          )}

          <div className="rwa-custody">
            <div className="rwa-custody-title">
              {feePct}% {t('stocks.rwaFeeChip')} — {t('stocks.rwaNonCustodialHeader')}
            </div>
            <p>{t('stocks.rwaNonCustodialBody')}</p>
          </div>

          <div className="rwa-amounts">
            <span className="rwa-amounts-label">{t('stocks.ifIBuy')}</span>
            <div className="rwa-amounts-picks">
              {QUICK.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={`tag ${calcAmount === amt ? 'active' : ''}`}
                  onClick={() => {
                    haptic?.('select');
                    setCalcAmount(amt);
                  }}
                >
                  {chipUsd(amt)}
                </button>
              ))}
            </div>
          </div>

          {units != null && (
            <div className="rwa-calc">
              <span className="rwa-calc-label">{t('stocks.wouldGet', { amount: fmtUsd(calcAmount) })}</span>
              <span className="mono rwa-calc-num">
                {units < 0.01 ? units.toFixed(4) : units.toFixed(2)}
                <span className="faint"> {token.symbol}</span>
              </span>
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary rwa-quick"
            onClick={() => onBuy?.(token, calcAmount)}
          >
            <IconSwap width={16} height={16} />
            <span>{t('stocks.rwaQuickBuy', { sym: token.symbol, pay, fee: feePct })}</span>
          </button>

          {token.coingeckoId && (
            <button
              type="button"
              className="btn btn-ghost rwa-chart"
              onClick={() => {
                onClose?.();
                navigate(`/coin/${token.coingeckoId}`);
              }}
            >
              {t('stocks.rwaViewChart')}
            </button>
          )}
        </div>
      </Sheet>
      <ShareSheet {...shareSheet} />
    </>
  );
}
