import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import FullScreenSheet from './FullScreenSheet';
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
import { IconCheck, IconCopy, IconExternal, IconShield, IconSwap, IconTrend } from './Icons';
import { useTelegram } from '../context/TelegramContext';
import '../styles/rwa-detail-modern.css';

const QUICK = [100, 500, 1000, 5000];

function chipUsd(n) {
  if (n >= 1000 && n % 1000 === 0) return `$${n / 1000}k`;
  return `$${n}`;
}

/**
 * RWA specification — now a FULL-SCREEN surface.
 * ---------------------------------------------------------------------------
 * REPORTED: «در توکن‌های rwa پاپ‌اپ مشخصات هر توکن تمام‌صفحه باشد و اندازه و
 * مدرن بودن چیز بی‌نظیر ازش بساز با فاصله و اندازه و تم درست».
 *
 * It used to open in the shared 560px dialog (`<Sheet size="lg" anchor="bottom">`):
 * a token's backing model, issuer, chain, contract, fee, calculator and risk
 * panel all stacked inside a card that covers under half of a phone screen, so
 * the reader scrolled a letterbox and the actions were always half off the
 * bottom. A specification is a PAGE, and this app already has the surface for
 * one — `FullScreenSheet` (portalled, safe-area aware, one scroller, one pinned
 * footer).
 *
 * ─── WHAT THE REDESIGN CHANGES, AND NOT ONLY VISUALLY ──────────────────────
 *   • A HERO: the token's mark, name, ticker, chain and live price lead, with
 *     the 7-day sparkline beside them. The screen says WHAT you opened before
 *     it says anything else.
 *   • FACT CELLS, not a run-on chip row: category, chain, standard, our fee and
 *     market cap each get a tile with a label, so a value is never a floating
 *     word.
 *   • THE CONTRACT IS READABLE: the address is a monospace line that wraps
 *     instead of scrolling away, with copy / share / explorer as real controls.
 *   • THE CALCULATOR IS A SECTION, not three loose blocks: pick an amount, read
 *     what it buys at the real price minus the real fee.
 *   • THE ACTION IS PINNED: quick-buy lives in the footer, so it is reachable
 *     without scrolling to the end of the specification.
 *
 * Everything the old sheet asserted about honesty is kept: no estimate is shown
 * where a number is missing ('—'), the fee is printed from the same `feeBps`
 * the router charges, and the non-custodial note stays on the screen.
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

  const priceLabel = Number.isFinite(price) && price > 0 ? `$${fmtPrice(price)}` : '—';

  return (
    <>
      <FullScreenSheet
        open={open}
        onClose={onClose}
        testId="rwa-detail-sheet"
        className="rwa-fs"
        kicker={t('stocks.rwaDetailsTitle')}
        title={token.name || token.symbol}
        subtitle={`${token.symbol || ''} · ${chainLabel}`}
        icon={<TokenIcon token={token} chainId={token.chainId} size={26} />}
        footer={(
          <div className="rwa-fs-foot">
            <button
              type="button"
              className="btn btn-primary rwa-fs-buy"
              onClick={() => onBuy?.(token, calcAmount)}
            >
              <IconSwap width={16} height={16} />
              <span>{t('stocks.rwaQuickBuy', { sym: token.symbol, pay, fee: feePct })}</span>
            </button>
            {token.coingeckoId && (
              <button
                type="button"
                className="btn btn-ghost rwa-fs-chart"
                aria-label={t('stocks.rwaViewChart')}
                title={t('stocks.rwaViewChart')}
                onClick={() => {
                  onClose?.();
                  navigate(`/coin/${token.coingeckoId}`);
                }}
              >
                <IconTrend width={16} height={16} />
              </button>
            )}
          </div>
        )}
      >
        {/* ─── HERO: what this is, and what it is doing ─────────────────── */}
        <section className="rwa-fs-hero">
          <span className="rwa-fs-mark" aria-hidden="true">
            <TokenIcon token={token} chainId={token.chainId} size={62} />
          </span>
          <div className="rwa-fs-hero-copy">
            <span className="rwa-fs-hero-name">{token.name}</span>
            <span className="rwa-fs-hero-sym mono" dir="ltr">
              {token.symbol}
              {token.standard ? <em>{token.standard}</em> : null}
            </span>
            <span className="rwa-fs-hero-chain">{chainLabel}</span>
          </div>
          <div className="rwa-fs-hero-price">
            <span className="mono rwa-fs-price" dir="ltr">{priceLabel}</span>
            <span className={`mono rwa-fs-chg ${up ? 'up' : 'down'}`} dir="ltr">
              {token.change24h != null ? fmtPct(token.change24h, 1) : '—'}
            </span>
          </div>
          {Array.isArray(token.sparkline) && token.sparkline.length > 2 && (
            <div className="rwa-fs-spark" aria-hidden="true">
              <Sparkline data={token.sparkline.slice(-40)} up={up} width={132} height={34} />
            </div>
          )}
        </section>

        {/* ─── THE FACTS, AS CELLS ──────────────────────────────────────── */}
        <section className="fsh-section">
          <div className="fsh-section-head">
            <span className="fsh-section-icon" aria-hidden="true"><IconShield width={14} height={14} /></span>
            <h3 className="fsh-section-title">{t('stocks.rwaBackingTitle')}</h3>
          </div>
          <div className="fsh-grid rwa-fs-grid">
            <div className="fsh-cell">
              <span className="fsh-cell-k">{t('stocks.rwaSpecType')}</span>
              <span className="fsh-cell-v">{t(`stocks.rwaCategory.${token.category}`, token.category)}</span>
            </div>
            <div className="fsh-cell">
              <span className="fsh-cell-k">{t('stocks.rwaSpecChain')}</span>
              <span className="fsh-cell-v">{chainLabel}</span>
            </div>
            <div className="fsh-cell">
              <span className="fsh-cell-k">{t('stocks.rwaSpecStandard')}</span>
              <span className="fsh-cell-v mono" dir="ltr">{token.standard || 'ERC-20'}</span>
            </div>
            <div className="fsh-cell">
              <span className="fsh-cell-k">{t('stocks.rwaSpecFee')}</span>
              <span className="fsh-cell-v mono" dir="ltr">{feePct}%</span>
            </div>
            <div className="fsh-cell">
              <span className="fsh-cell-k">{t('stocks.rwaIssuer')}</span>
              <span className="fsh-cell-v">{token.issuer || '—'}</span>
            </div>
            <div className="fsh-cell">
              <span className="fsh-cell-k">{t('stocks.stats.mcap')}</span>
              <span className="fsh-cell-v">{token.mcap > 0 ? fmtCompact(token.mcap) : '—'}</span>
            </div>
          </div>
          {(token.backing || typeLabel) && (
            <p className="fsh-section-note">
              {token.backing || typeLabel}
              {token.backing && typeLabel ? ` · ${typeLabel}` : ''}
            </p>
          )}
          {token.description && <p className="fsh-section-note">{token.description}</p>}
        </section>

        {/* ─── RISK: the panel keeps its own honest renderer ────────────── */}
        <RwaRiskPanel token={token} />

        {/* ─── THE CONTRACT ─────────────────────────────────────────────── */}
        {token.address && (
          <section className="fsh-section">
            <div className="fsh-section-head">
              <span className="fsh-section-icon" aria-hidden="true"><IconExternal width={14} height={14} /></span>
              <h3 className="fsh-section-title">{t('stocks.rwaContract')}</h3>
            </div>
            <code className="rwa-fs-addr" dir="ltr">{token.address}</code>
            <div className="btn-row rwa-fs-contract-actions">
              <button type="button" className="btn btn-primary" onClick={shareAddress}>
                {t('receive.share')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={copyAddress}>
                {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
                <span>{copied ? t('common.copied') : t('common.copy')}</span>
              </button>
            </div>
            {explorerUrl && (
              <a className="rwa-fs-explorer" href={explorerUrl} target="_blank" rel="noopener noreferrer">
                <IconExternal width={14} height={14} />
                <span>{t('stocks.rwaExplorer')}</span>
              </a>
            )}
          </section>
        )}

        {/* ─── WHAT AN AMOUNT BUYS ──────────────────────────────────────── */}
        <section className="fsh-section rwa-fs-calc">
          <div className="fsh-section-head">
            <span className="fsh-section-icon" aria-hidden="true"><IconSwap width={14} height={14} /></span>
            <h3 className="fsh-section-title">{t('stocks.ifIBuy')}</h3>
          </div>
          <div className="rwa-fs-picks">
            {QUICK.map((amt) => (
              <button
                key={amt}
                type="button"
                className={`rwa-fs-pick${calcAmount === amt ? ' is-active' : ''}`}
                aria-pressed={calcAmount === amt}
                onClick={() => {
                  haptic?.('select');
                  setCalcAmount(amt);
                }}
              >
                {chipUsd(amt)}
              </button>
            ))}
          </div>
          {units != null && (
            <div className="rwa-fs-result">
              <span className="rwa-fs-result-label">{t('stocks.wouldGet', { amount: fmtUsd(calcAmount) })}</span>
              <span className="mono rwa-fs-result-num" dir="ltr">
                {units < 0.01 ? units.toFixed(4) : units.toFixed(2)}
                <span className="faint"> {token.symbol}</span>
              </span>
            </div>
          )}
        </section>

        {/* ─── THE CUSTODY NOTE, LAST SO IT IS NOT A FOOTER NOBODY READS ── */}
        <section className="rwa-fs-custody">
          <p className="rwa-fs-custody-title">
            {feePct}% {t('stocks.rwaFeeChip')} — {t('stocks.rwaNonCustodialHeader')}
          </p>
          <p className="rwa-fs-custody-body">{t('stocks.rwaNonCustodialBody')}</p>
        </section>
      </FullScreenSheet>
      <ShareSheet {...shareSheet} />
    </>
  );
}
