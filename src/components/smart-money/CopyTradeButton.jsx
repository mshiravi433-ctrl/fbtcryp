import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SmSwapGlyph } from './SmGlyphs';
import { swapDeepLink } from '../../lib/smartMoneySwap';
import { useTelegram } from '../../context/TelegramContext';

/**
 * «کپی تراکنش» — the one-tap bridge from an observed fill to our own swap.
 *
 * Placed on receipts and token-activity rows, it does exactly two things:
 *
 *   1. puts the CONTRACT on the clipboard (best effort — the button is named
 *      "copy", so it should behave like one even where the clipboard is
 *      blocked by the WebView), and
 *   2. opens /swap (or /solana) with that same token preselected and the side
 *      already set, so the user is not asked to search for it again.
 *
 * It is deliberately NOT a "copy this wallet's trade" execution button: the
 * amount, slippage, gas and risk gate stay the user's, on the swap screen.
 * Renders nothing when the row has no usable contract — a dead button is
 * worse than no button.
 */
export default function CopyTradeButton({ chain, token, side, className = '' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const href = swapDeepLink({ chain, token, side });

  const go = useCallback((event) => {
    event?.stopPropagation?.();
    event?.preventDefault?.();
    haptic?.('light');
    try {
      navigator.clipboard?.writeText?.(String(token));
    } catch { /* clipboard is a nicety, never a requirement */ }
    if (href) navigate(href);
  }, [haptic, href, navigate, token]);

  if (!href) return null;

  const label = t('sm.copyTrade');

  return (
    <button
      type="button"
      className={`sm-copy ${className}`.trim()}
      onClick={go}
      title={t('sm.copyTradeHint')}
      aria-label={`${label} — ${t('sm.copyTradeHint')}`}
      data-testid="sm-copy-trade"
    >
      <SmSwapGlyph width={13} height={13} />
      <span>{label}</span>
    </button>
  );
}
