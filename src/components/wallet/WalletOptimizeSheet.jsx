import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Sheet from '../Sheet';
import { analyzeWallet } from '../../lib/walletOptimizer';
import { EVM_CHAINS } from '../../lib/chains';
import { fmtUsd } from '../../lib/format';
import '../../styles/wallet-command.css';

/**
 * OPTIMIZE — a real diagnosis of the holdings already on screen.
 *
 * The old button fired a Navigate into a blank intent draft, which is why it
 * read as «کار نمیده». Here the score, the concentration, the stable buffer,
 * the gas reserve and the chain coverage are recomputed from the same rows
 * the hero paints, and each finding carries a concrete next step. Nothing is
 * signed, swapped or rebalanced without the user opening that step.
 */
export default function WalletOptimizeSheet({ open, onClose, portfolio = {}, wallet = {} }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const report = useMemo(() => analyzeWallet({
    rows: portfolio.rows || [],
    chains: portfolio.chains || [],
    totalValue: portfolio.totalValue,
    activeChainId: wallet.chainId
  }), [portfolio.rows, portfolio.chains, portfolio.totalValue, wallet.chainId]);

  const go = (to) => { onClose?.(); navigate(to); };

  const actionFor = (id) => {
    const symbol = report.top?.symbol || 'ETH';
    switch (id) {
      case 'concentration': return `/intent?tab=compose&from=${encodeURIComponent(symbol)}&to=USDC`;
      case 'stableBuffer': return '/intent?tab=compose&to=USDC';
      case 'gasReserve': return `/intent?tab=compose&from=USDC&to=${encodeURIComponent(EVM_CHAINS[wallet.chainId]?.native?.symbol || 'ETH')}`;
      case 'singleChain': return '/bridge';
      case 'unpriced': return '/wallet';
      case 'noPricedHoldings': return '/market';
      default: return null;
    }
  };

  const ring = report.score == null ? 0 : Math.min(100, Math.max(0, report.score));
  const circumference = 2 * Math.PI * 42;

  return (
    <Sheet open={open} onClose={onClose} title={t('wnew.opt.title')} anchor="bottom" size="lg" className="sheet-full" testId="wallet-optimize-sheet">
      <div className="wopt">
        <div className="wopt-head">
          <div className="wopt-ring" role="img" aria-label={`${t('wnew.opt.score')}: ${report.score ?? '—'}`}>
            <svg viewBox="0 0 100 100" width="100" height="100" aria-hidden="true">
              <circle cx="50" cy="50" r="42" className="wopt-ring-track" />
              <circle
                cx="50" cy="50" r="42" className="wopt-ring-fill"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - ring / 100)}
              />
            </svg>
            <span className="mono">{report.score ?? '—'}</span>
            <small>{t('wnew.opt.score')}</small>
          </div>
          <div className="wopt-stats">
            <div><span>{t('wnew.opt.total')}</span><b className="mono">{fmtUsd(report.total)}</b></div>
            <div><span>{t('wnew.opt.top')}</span><b className="mono">{report.top ? `${report.top.symbol} · ${report.top.pct?.toFixed(0) ?? '—'}%` : '—'}</b></div>
            <div><span>{t('wnew.opt.stable')}</span><b className="mono">{report.stable.pct == null ? '—' : `${report.stable.pct.toFixed(0)}%`}</b></div>
            <div><span>{t('wnew.opt.chains')}</span><b className="mono">{report.chainCount || '—'}</b></div>
          </div>
        </div>

        <div className="wopt-section-title">{t('wnew.opt.findings')}</div>
        <div className="wopt-findings">
          {report.findings.map((f) => {
            const to = actionFor(f.id);
            return (
              <article key={f.id} className={`wopt-finding is-${f.severity}`} data-testid={`wallet-opt-${f.id}`}>
                <span className="wopt-dot" aria-hidden="true" />
                <span className="wopt-copy">
                  <strong>{t(`wnew.opt.${f.id}.title`)}</strong>
                  <p>{t(`wnew.opt.${f.id}.body`, { symbol: report.top?.symbol ?? '—', pct: f.id === 'concentration' ? (report.top?.pct ?? 0).toFixed(0) : report.stable.pct?.toFixed(0) ?? '—' })}</p>
                </span>
                {to && <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(to)}>{t('wnew.opt.open')}</button>}
              </article>
            );
          })}
        </div>

        {report.chains.length > 1 && (
          <div className="wopt-chainbars" role="list" aria-label={t('wnew.opt.chains')}>
            {report.chains.slice(0, 6).map((c) => (
              <div key={c.chainId} role="listitem">
                <span>{c.label}</span>
                <span className="wopt-bar"><i style={{ width: `${report.total ? Math.max(2, (c.value / report.total) * 100) : 0}%` }} /></span>
                <b className="mono">{fmtUsd(c.value)}</b>
              </div>
            ))}
          </div>
        )}

        <p className="notice" style={{ margin: '12px 0 0' }}>{t('wnew.opt.disclaimer')}</p>
        <button type="button" className="btn btn-primary" style={{ width: '100%', minHeight: 46, borderRadius: 14, marginTop: 10 }} onClick={() => go('/intent?tab=compose')}>
          {t('wnew.opt.openManual')}
        </button>
      </div>
    </Sheet>
  );
}
