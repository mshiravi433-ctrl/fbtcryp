import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Sheet from './Sheet';
import CoinLogo from './CoinLogo';
import Sparkline from './Sparkline';
import { fmtCompact, fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { feePercentString, FEE_BPS } from '../lib/feeBps';
import { EVM_CHAINS } from '../lib/chains';
import { IconCheck, IconCopy, IconExternal, IconShield, IconSwap } from './Icons';
import { useTelegram } from '../context/TelegramContext';

/**
 * RwaDetailSheet — Comprehensive breakdown of one Real-World Asset (RWA) token.
 * Displays issuer backing, legal custody details, smart contract links,
 * platform fee transparency (0.70%), and direct non-custodial buy actions.
 */
export default function RwaDetailSheet({
  open,
  onClose,
  token,
  onBuy,
  amountUsd = 1000
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const [copied, setCopied] = useState(false);
  const [calcAmount, setCalcAmount] = useState(amountUsd || 1000);

  if (!token) return null;

  const up = (token.change24h ?? 0) >= 0;
  const price = Number(token.price);
  const feePct = feePercentString(token.feeBps || FEE_BPS);
  const feeDecimal = (token.feeBps || FEE_BPS) / 10000;

  const units = Number.isFinite(price) && price > 0 && calcAmount > 0
    ? (Number(calcAmount) * (1 - feeDecimal)) / price
    : null;

  const chainCfg = EVM_CHAINS[token.chainId];
  const explorerUrl = token.address && chainCfg?.explorer
    ? `${chainCfg.explorer}/token/${token.address}`
    : null;

  const copyAddress = async () => {
    if (!token.address) return;
    try {
      await navigator.clipboard.writeText(token.address);
      setCopied(true);
      haptic?.('notification', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const shortAddr = token.address
    ? `${token.address.slice(0, 6)}...${token.address.slice(-4)}`
    : null;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={token.symbol || t('stocks.rwaDetailsTitle')}
      anchor="bottom"
      size="lg"
    >
      <div className="stack" style={{ gap: 14 }}>
        {/* Header: Logo, Name, Symbol, Category & Chain Badges */}
        <div className="row-between" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div className="row" style={{ gap: 12, minWidth: 0 }}>
            <CoinLogo
              coin={token.coingeckoId ? { id: token.coingeckoId, symbol: token.symbol } : undefined}
              ticker={token.symbol}
              px={42}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{token.name}</div>
              <div className="mono faint" style={{ fontSize: 12, marginTop: 2 }}>
                {token.symbol} · {token.chainName || (chainCfg ? chainCfg.name : 'Ethereum')}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'end', flexShrink: 0 }}>
            <div className="mono" style={{ fontWeight: 800, fontSize: 16 }}>
              {price > 0 ? `$${fmtPrice(price)}` : '—'}
            </div>
            <div className={`mono ${up ? 'up' : 'down'}`} style={{ fontSize: 12 }}>
              {token.change24h != null ? fmtPct(token.change24h, 1) : '—'}
            </div>
          </div>
        </div>

        {/* Category, Chain, Standard, Fee Chips */}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="pill pill-neutral">
            {t(`stocks.rwaCategory.${token.category}`, token.category)}
          </span>
          <span className="pill pill-neutral">
            {token.chainName}
          </span>
          {token.standard && (
            <span className="pill pill-neutral mono">
              {token.standard}
            </span>
          )}
          <span className="pill pill-success mono" style={{ fontSize: 11 }}>
            {feePct}% {t('swap.platformFeeLabel', 'کارمزد FBT')}
          </span>
          {token.mcap > 0 && (
            <span className="pill pill-neutral faint">
              {t('stocks.stats.mcap')}: {fmtCompact(token.mcap)}
            </span>
          )}
        </div>

        {/* Sparkline if available */}
        {Array.isArray(token.sparkline) && token.sparkline.length > 2 && (
          <div
            className="card card-tight"
            style={{
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12
            }}
          >
            <div className="faint" style={{ fontSize: 11.5 }}>
              {t('stocks.sparkline7d', 'روند ۷ روزه قیمت')}
            </div>
            <Sparkline data={token.sparkline.slice(-40)} up={up} width={100} height={28} />
          </div>
        )}

        {/* Legal Backing & Custody Structure */}
        <div
          className="card card-tight"
          style={{
            padding: '12px 14px',
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            borderRadius: 12
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 12.8, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconShield width={14} height={14} style={{ color: 'var(--rgb-cyan)' }} />
            <span>{t('stocks.rwaBackingTitle', 'شفافیت پشتوانه و صادرکننده')}</span>
          </div>

          <div className="stack" style={{ gap: 6, fontSize: 12 }}>
            <div className="row-between">
              <span className="muted">{t('stocks.rwaIssuer', 'صادرکننده / امین')}:</span>
              <span className="mono" style={{ fontWeight: 600 }}>{token.issuer || '—'}</span>
            </div>
            <div className="row-between">
              <span className="muted">{t('stocks.rwaBackingModel', 'پشتوانه دارایی')}:</span>
              <span style={{ fontWeight: 600, textAlign: 'end', maxWidth: '65%' }}>{token.backing}</span>
            </div>
            {token.description && (
              <p className="faint" style={{ margin: '4px 0 0', lineHeight: 1.6, fontSize: 11.4 }}>
                {token.description}
              </p>
            )}
          </div>
        </div>

        {/* Smart Contract Box */}
        {token.address && (
          <div
            className="card card-tight row-between"
            style={{
              padding: '10px 14px',
              background: 'var(--surface-2)',
              border: '1px solid var(--line)',
              borderRadius: 12,
              gap: 8
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="muted" style={{ fontSize: 11 }}>{t('stocks.rwaContract', 'آدرس قرارداد هوشمند')}</div>
              <div className="mono" style={{ fontSize: 12, marginTop: 2 }}>{shortAddr}</div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: '6px 10px', fontSize: 11.5 }}
                onClick={copyAddress}
              >
                {copied ? <IconCheck width={13} height={13} /> : <IconCopy width={13} height={13} />}
                <span>{copied ? t('stocks.rwaCopied', 'کپی شد') : t('stocks.rwaCopyAddress', 'کپی')}</span>
              </button>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
                  style={{ padding: '6px 10px', fontSize: 11.5 }}
                >
                  <IconExternal width={13} height={13} />
                </a>
              )}
            </div>
          </div>
        )}

        {/* Non-Custodial Platform Fee Guarantee Notice */}
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(34, 197, 94, 0.08)',
            border: '1px solid rgba(34, 197, 94, 0.25)',
            fontSize: 11.6,
            lineHeight: 1.65
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--rgb-green)', marginBottom: 2 }}>
            {feePct}% {t('swap.platformFeeLabel', 'کارمزد FBT')} — {t('stocks.rwaNonCustodialHeader', 'معامله غیرحضانتی مستقیم')}
          </div>
          <div className="muted" style={{ fontSize: 11.2 }}>
            {t('stocks.rwaNonCustodialBody', 'تراکنش‌ها بدون نیاز به KYC و بدون واسطه از طریق استخرهای نقدینگی انجام شده و توکن‌ها مستقیماً در کیف پول شخصی شما قرار می‌گیرند.')}
          </div>
        </div>

        {/* Amount Quick-Calculator */}
        <div>
          <div className="row-between" style={{ marginBottom: 6 }}>
            <span className="faint" style={{ fontSize: 11.5 }}>{t('stocks.ifIBuy')}</span>
            <div className="row" style={{ gap: 5 }}>
              {[100, 500, 1000, 5000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={`tag ${calcAmount === amt ? 'active' : ''}`}
                  style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => {
                    haptic?.('select');
                    setCalcAmount(amt);
                  }}
                >
                  {fmtUsd(amt)}
                </button>
              ))}
            </div>
          </div>

          {units != null && (
            <div className="farm-calc" style={{ marginTop: 4 }}>
              <span className="faint">{t('stocks.wouldGet', { amount: fmtUsd(calcAmount) })}</span>
              <span className="mono farm-calc-num">
                {units < 0.01 ? units.toFixed(4) : units.toFixed(2)}
                <span className="faint"> {token.symbol}</span>
              </span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="stack" style={{ gap: 8, marginTop: 4 }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', height: 44, fontWeight: 700, fontSize: 13.5 }}
            onClick={() => {
              onBuy?.(token, calcAmount);
            }}
          >
            <IconSwap width={16} height={16} />
            <span>{t('stocks.rwaQuickBuy', { sym: token.symbol, fee: feePct })}</span>
          </button>

          {token.coingeckoId && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%', height: 38, fontSize: 12.5 }}
              onClick={() => {
                onClose?.();
                navigate(`/coin/${token.coingeckoId}`);
              }}
            >
              {t('stocks.rwaViewChart', 'مشاهده صفحه تحلیل و بازار')}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
